use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, Window};

use crate::{FishWorld, ScreenConfig};

const SHADER: &str = r#"
struct Scene {
  size_time: vec4<f32>,
  fish: vec4<f32>,
  tail_visible: vec4<f32>,
}
@group(0) @binding(0) var<uniform> scene: Scene;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
  return vec4(p[i], 0., 1.);
}
fn hash(n: f32) -> f32 { return fract(sin(n) * 43758.5453); }
fn stroke(d: f32, w: f32) -> f32 { return 1. - smoothstep(w, w+1.2, abs(d)); }
fn turn(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c=cos(a); let s=sin(a); return vec2(c*p.x+s*p.y, -s*p.x+c*p.y);
}

@fragment fn fs_main(@builtin(position) f: vec4<f32>) -> @location(0) vec4<f32> {
  let size=scene.size_time.xy; let t=scene.size_time.z; let p=f.xy/scene.size_time.w; let uv=p/size;
  var color=mix(vec3(.34,.75,.78), vec3(.04,.16,.27), pow(uv.y,.85));
  var rays=0.;
  for(var i=0; i<5; i++) {
    let n=f32(i); let w=size.x*(.08+.035*f32(i%2));
    let center=size.x*(.12+n*.21)+sin(t*.18+n)*28.+uv.y*w*.45;
    rays += (1.-smoothstep(w*.42,w*.58,abs(p.x-center)))*(1.-uv.y)*.12;
  }
  color += vec3(.52,.86,.78)*rays;
  for(var i=0; i<6; i++) {
    let n=f32(i); let y=size.y*(.12+n*.14)+sin(p.x*.012+t*.42+n*1.7)*16.+sin(p.x*.005-t*.3)*9.;
    color += vec3(.30,.65,.62)*stroke(p.y-y,1.4)*.16;
  }
  let floor_y=size.y-30.; let sand=smoothstep(floor_y-8.,floor_y+25.,p.y);
  color=mix(color,mix(vec3(.67,.56,.38),vec3(.25,.19,.13),clamp((p.y-floor_y)/55.,0.,1.)),sand);
  for(var i=0; i<22; i++) {
    let n=f32(i); let x=hash(n*12.7)*size.x; let h=(.12+hash(n*3.1)*.38)*size.y;
    let rel=(floor_y-p.y)/max(h,1.); let bx=x+sin(t*.9+n)*12.*rel*rel;
    let blade=step(0.,rel)*step(rel,1.)*(1.-smoothstep(2.,7.,abs(p.x-bx)));
    color=mix(color,vec3(.06+.08*hash(n),.38+.25*hash(n+2.),.20),blade*.75);
  }
  for(var i=0; i<18; i++) {
    let n=f32(i); let bx=hash(n*19.3)*size.x;
    let by=size.y-fract(t*(.018+hash(n)*.018)+hash(n+7.))*size.y; let r=1.5+hash(n+4.)*3.;
    color += vec3(.75,.95,1.)*stroke(length(p-vec2(bx,by))-r,.7)*.35;
  }
  if(scene.tail_visible.y>.5) {
    var q=turn(p-scene.fish.xy,scene.fish.z); if(abs(scene.fish.z)>1.5708){q.y=-q.y;}
    let body=1.-smoothstep(.94,1.02,length(vec2((q.x-8.)/102.,q.y/48.)));
    let tx=q.x+105.; let tail=step(0.,tx)*step(tx,80.)*step(abs(q.y-sin(scene.tail_visible.x)*16.),max(0.,52.-tx*.42));
    color=mix(color,vec3(.92,.48,.18),tail*.75);
    color=mix(color,mix(vec3(.93,.31,.08),vec3(1.,.76,.34),clamp((q.y+48.)/96.,0.,1.)),body);
    let eye=1.-smoothstep(7.,8.5,length(q-vec2(62.,-15.))); let pupil=1.-smoothstep(3.,4.,length(q-vec2(63.,-15.)));
    color=mix(color,vec3(.96,.94,.82),eye); color=mix(color,vec3(.03,.05,.06),pupil);
  }
  let vignette=smoothstep(.35,.88,length((uv-.5)*vec2(size.x/size.y,1.)));
  return vec4(color*(1.-vignette*.42),1.);
}
"#;

struct SurfaceState {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    screen: ScreenConfig,
    uniform: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
}

struct RenderControl {
    app: AppHandle,
    ready: mpsc::SyncSender<Result<(), String>>,
    running: Arc<AtomicBool>,
    presented: Arc<AtomicUsize>,
    surface_count: usize,
}

struct Recovery {
    enabled: AtomicBool,
    windows: Vec<Arc<Window>>,
    screens: Vec<ScreenConfig>,
}

pub fn start(windows: Vec<(Window, ScreenConfig)>, app: AppHandle) -> Result<(), String> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let windows = windows
        .into_iter()
        .map(|(window, screen)| (Arc::new(window), screen))
        .collect::<Vec<_>>();
    let cleanup_windows = windows
        .iter()
        .map(|(window, _)| window.clone())
        .collect::<Vec<_>>();
    let recovery_screens = windows.iter().map(|(_, screen)| screen.clone()).collect();
    let surfaces = windows
        .into_iter()
        .map(|(window, screen)| {
            let size = window.inner_size().map_err(|error| error.to_string())?;
            let surface = instance
                .create_surface(window.clone())
                .map_err(|error| error.to_string())?;
            Ok((window, surface, size, screen))
        })
        .collect::<Result<Vec<_>, String>>();
    let surfaces = match surfaces {
        Ok(surfaces) => surfaces,
        Err(error) => {
            for window in &cleanup_windows {
                let _ = window.close();
            }
            return Err(error);
        }
    };
    let physical_screens = surfaces
        .iter()
        .map(|(_, _, _, screen)| {
            let mut screen = screen.clone();
            screen.x *= screen.scale_factor;
            screen.y *= screen.scale_factor;
            screen.width *= screen.scale_factor;
            screen.height *= screen.scale_factor;
            screen
        })
        .collect();
    let fish = Arc::new(Mutex::new(FishWorld::new(physical_screens)));
    let frame = Arc::new(Mutex::new(
        fish.lock().map_err(|_| "fish lock poisoned")?.tick(0.0),
    ));
    let running = Arc::new(AtomicBool::new(true));
    let recovery = Arc::new(Recovery {
        enabled: AtomicBool::new(false),
        windows: cleanup_windows,
        screens: recovery_screens,
    });
    let presented = Arc::new(AtomicUsize::new(0));
    let surface_count = recovery.windows.len();
    for surface in surfaces {
        let instance = instance.clone();
        let frame = frame.clone();
        let render_app = app.clone();
        let render_running = running.clone();
        let render_presented = presented.clone();
        let render_recovery = recovery.clone();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let error_tx = ready_tx.clone();
        thread::spawn(move || {
            if let Err(error) = pollster::block_on(render(
                instance,
                vec![surface],
                frame,
                RenderControl {
                    app: render_app.clone(),
                    ready: ready_tx,
                    running: render_running.clone(),
                    presented: render_presented,
                    surface_count,
                },
            )) {
                let was_running = render_running.swap(false, Ordering::SeqCst);
                let _ = error_tx.send(Err(error.clone()));
                eprintln!("native-gpu=failed: {error}");
                if was_running && render_recovery.enabled.load(Ordering::SeqCst) {
                    let recovery_app = render_app.clone();
                    let recovery = render_recovery.clone();
                    let _ = render_app.run_on_main_thread(move || {
                        for window in &recovery.windows {
                            let _ = window.close();
                        }
                        if let Err(error) =
                            crate::start_webview_renderer(&recovery_app, &recovery.screens)
                        {
                            eprintln!("webview-fallback=failed: {error}");
                        }
                    });
                }
            }
        });
        let ready = ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "native GPU initialization timed out".to_string())
            .and_then(|result| result);
        if let Err(error) = ready {
            running.store(false, Ordering::Release);
            for window in &recovery.windows {
                let _ = window.close();
            }
            return Err(error);
        }
    }
    recovery.enabled.store(true, Ordering::SeqCst);
    if !running.load(Ordering::SeqCst) {
        for window in &recovery.windows {
            let _ = window.close();
        }
        return Err("native renderer failed during initialization".into());
    }
    let pointer_fish = fish.clone();
    let pointer_app = app.clone();
    let pointer_running = running.clone();
    thread::spawn(move || {
        while pointer_running.load(Ordering::Acquire) {
            thread::sleep(Duration::from_millis(70));
            if let Ok(position) = pointer_app.cursor_position() {
                if let Ok(mut fish) = pointer_fish.lock() {
                    fish.set_pointer(position.x, position.y);
                }
            }
        }
    });
    let simulation_frame = frame.clone();
    thread::spawn(move || {
        let mut last = Instant::now();
        while running.load(Ordering::Acquire) {
            let now = Instant::now();
            let dt = now.duration_since(last).as_secs_f64().min(0.08);
            last = now;
            let next = match fish.lock() {
                Ok(mut fish) => fish.tick(dt),
                Err(_) => break,
            };
            match simulation_frame.lock() {
                Ok(mut frame) => *frame = next,
                Err(_) => break,
            }
            thread::sleep(Duration::from_millis(16));
        }
    });
    Ok(())
}

async fn render(
    instance: wgpu::Instance,
    surfaces: Vec<(
        Arc<Window>,
        wgpu::Surface<'static>,
        tauri::PhysicalSize<u32>,
        ScreenConfig,
    )>,
    frame: Arc<Mutex<crate::FishFrame>>,
    control: RenderControl,
) -> Result<(), String> {
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::LowPower,
            compatible_surface: surfaces.first().map(|value| &value.1),
            force_fallback_adapter: false,
            ..Default::default()
        })
        .await
        .map_err(|error| error.to_string())?;
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default())
        .await
        .map_err(|error| error.to_string())?;
    let format = surfaces[0].1.get_capabilities(&adapter).formats[0];
    let bind_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("scene-layout"),
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        }],
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: &[Some(&bind_layout)],
        immediate_size: 0,
    });
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("aquarium-shader"),
        source: wgpu::ShaderSource::Wgsl(SHADER.into()),
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("aquarium-pipeline"),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: format.add_srgb_suffix(),
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    });
    let mut states = surfaces
        .into_iter()
        .map(|(window, surface, size, screen)| {
            let config = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width: size.width.max(1),
                height: size.height.max(1),
                present_mode: wgpu::PresentMode::AutoVsync,
                desired_maximum_frame_latency: 2,
                alpha_mode: wgpu::CompositeAlphaMode::Auto,
                view_formats: vec![format.add_srgb_suffix()],
                color_space: wgpu::SurfaceColorSpace::Auto,
            };
            surface.configure(&device, &config);
            let uniform = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("scene-uniform"),
                size: 48,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &bind_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                }],
            });
            SurfaceState {
                window,
                surface,
                config,
                screen,
                uniform,
                bind_group,
            }
        })
        .collect::<Vec<_>>();
    let _ = control.ready.send(Ok(()));
    let mut first_present = true;
    let started = Instant::now();
    while control.running.load(Ordering::Acquire) {
        let frame = frame
            .lock()
            .map_err(|_| "fish frame lock poisoned")?
            .clone();
        for state in &mut states {
            let scale = state.screen.scale_factor;
            let screen_x = state.screen.x * scale;
            let screen_y = state.screen.y * scale;
            let screen_width = state.screen.width * scale;
            let screen_height = state.screen.height * scale;
            let visible = frame.x > screen_x - 220.0 * scale
                && frame.x < screen_x + screen_width + 220.0 * scale
                && frame.y > screen_y - 220.0 * scale
                && frame.y < screen_y + screen_height + 220.0 * scale;
            let data = [
                state.screen.width as f32,
                state.screen.height as f32,
                started.elapsed().as_secs_f32(),
                state.screen.scale_factor as f32,
                ((frame.x - screen_x) / scale) as f32,
                ((frame.y - screen_y) / scale) as f32,
                frame.angle as f32,
                0.0,
                frame.tail as f32,
                u8::from(visible) as f32,
                0.0,
                0.0,
            ];
            queue.write_buffer(&state.uniform, 0, bytemuck::cast_slice(&data));
            let (texture, reconfigure_after_present) = match state.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(value) => (value, false),
                wgpu::CurrentSurfaceTexture::Suboptimal(value) => (value, true),
                wgpu::CurrentSurfaceTexture::Occluded | wgpu::CurrentSurfaceTexture::Timeout => {
                    continue;
                }
                wgpu::CurrentSurfaceTexture::Outdated => {
                    state.surface.configure(&device, &state.config);
                    continue;
                }
                wgpu::CurrentSurfaceTexture::Lost => {
                    let (surface_tx, surface_rx) = mpsc::sync_channel(1);
                    let surface_instance = instance.clone();
                    let surface_window = state.window.clone();
                    control
                        .app
                        .run_on_main_thread(move || {
                            let result = surface_instance
                                .create_surface(surface_window)
                                .map_err(|error| error.to_string());
                            let _ = surface_tx.send(result);
                        })
                        .map_err(|error| error.to_string())?;
                    state.surface = surface_rx
                        .recv_timeout(Duration::from_secs(5))
                        .map_err(|_| "surface recreation timed out".to_string())??;
                    state.surface.configure(&device, &state.config);
                    continue;
                }
                wgpu::CurrentSurfaceTexture::Validation => {
                    return Err("surface validation failed".into());
                }
            };
            let view = texture.texture.create_view(&wgpu::TextureViewDescriptor {
                format: Some(state.config.format.add_srgb_suffix()),
                ..Default::default()
            });
            let mut encoder = device.create_command_encoder(&Default::default());
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("native-wallpaper-draw"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &state.bind_group, &[]);
            pass.draw(0..3, 0..1);
            drop(pass);
            queue.submit([encoder.finish()]);
            queue.present(texture);
            if first_present {
                first_present = false;
                if control.presented.fetch_add(1, Ordering::AcqRel) + 1 == control.surface_count {
                    let close_app = control.app.clone();
                    let main_app = close_app.clone();
                    close_app
                        .run_on_main_thread(move || {
                            if let Some(main) = main_app.get_webview_window("main") {
                                let _ = main.close();
                            }
                        })
                        .map_err(|error| error.to_string())?;
                }
            }
            if reconfigure_after_present {
                state.surface.configure(&device, &state.config);
            }
        }
        thread::sleep(Duration::from_millis(16));
    }
    Ok(())
}
