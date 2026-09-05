use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_updater::UpdaterExt;

mod native_gpu;

#[derive(Default)]
struct UpdateMenuState {
    checking: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenConfig {
    label: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) scale_factor: f64,
    primary_scale_factor: f64,
}

#[derive(Clone)]
struct ScreenTarget {
    config: ScreenConfig,
}

pub(crate) struct WallpaperState {
    screens: Vec<ScreenTarget>,
    pub(crate) fish: Mutex<FishWorld>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FishFrame {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) angle: f64,
    pub(crate) tail: f64,
}

#[derive(Clone, Serialize)]
struct PointerFrame {
    x: f64,
    y: f64,
}

struct PointerTarget {
    x: f64,
    y: f64,
    updated_at: Instant,
}

pub(crate) struct FishWorld {
    x: f64,
    y: f64,
    target_x: f64,
    target_y: f64,
    angle: f64,
    speed: f64,
    tail: f64,
    orbit_direction: f64,
    pointer: Option<PointerTarget>,
    screens: Vec<ScreenConfig>,
    random_state: u64,
}

impl FishWorld {
    fn new(screens: Vec<ScreenConfig>) -> Self {
        let first = &screens[0];
        let x = first.x + first.width * 0.5;
        let y = first.y + first.height * 0.48;
        let mut world = Self {
            x,
            y,
            target_x: x,
            target_y: y,
            angle: 0.0,
            speed: 0.0,
            tail: 0.0,
            orbit_direction: 1.0,
            pointer: None,
            screens,
            random_state: 0x9e37_79b9_7f4a_7c15,
        };
        world.pick_target();
        world
    }

    pub(crate) fn set_pointer(&mut self, x: f64, y: f64) {
        self.pointer = Some(PointerTarget {
            x,
            y,
            updated_at: Instant::now(),
        });
    }

    pub(crate) fn tick(&mut self, dt: f64) -> FishFrame {
        let pointer = self
            .pointer
            .as_ref()
            .filter(|pointer| pointer.updated_at.elapsed() < Duration::from_millis(2600));
        let curious = pointer.is_some();
        if let Some(pointer) = pointer {
            let bearing = (self.y - pointer.y).atan2(self.x - pointer.x);
            let ahead = bearing + self.orbit_direction * 0.8;
            self.target_x = pointer.x + ahead.cos() * 88.0;
            self.target_y = pointer.y + ahead.sin() * 55.0;
        } else if (self.target_x - self.x).hypot(self.target_y - self.y) < 28.0 {
            self.pick_target();
        }

        let dx = self.target_x - self.x;
        let dy = self.target_y - self.y;
        let desired_speed = if curious { 150.0 } else { 105.0 };
        self.speed += (desired_speed - self.speed) * (dt * 2.2).min(1.0);
        let desired_angle = dy.atan2(dx);
        self.angle += wrap_angle(desired_angle - self.angle) * (dt * 4.0).min(1.0);
        self.x += self.angle.cos() * self.speed * dt;
        self.y += self.angle.sin() * self.speed * dt;
        self.tail += dt * (2.6 + self.speed / 40.0 * 5.0);

        FishFrame {
            x: self.x,
            y: self.y,
            angle: self.angle,
            tail: self.tail,
        }
    }

    fn pick_target(&mut self) {
        let index = (self.random() * self.screens.len() as f64) as usize;
        let screen = self.screens[index.min(self.screens.len() - 1)].clone();
        let margin_x = screen.width.min(180.0) * 0.45;
        let margin_y = screen.height.min(180.0) * 0.45;
        self.target_x = screen.x + margin_x + self.random() * (screen.width - margin_x * 2.0);
        self.target_y = screen.y + margin_y + self.random() * (screen.height - margin_y * 2.0);
        if self.random() < 0.08 {
            self.orbit_direction *= -1.0;
        }
    }

    fn random(&mut self) -> f64 {
        self.random_state = self
            .random_state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.random_state >> 11) as f64) / ((1_u64 << 53) as f64)
    }
}

fn wrap_angle(mut angle: f64) -> f64 {
    while angle > std::f64::consts::PI {
        angle -= std::f64::consts::TAU;
    }
    while angle <= -std::f64::consts::PI {
        angle += std::f64::consts::TAU;
    }
    angle
}

fn logical_coordinate(value: f64, scale_factor: f64) -> f64 {
    value / scale_factor
}

async fn install_available_update(app: &tauri::AppHandle) -> Result<bool, String> {
    let Some(update) = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(false);
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    app.restart();
}

#[cfg(not(debug_assertions))]
fn start_auto_update(app: tauri::AppHandle, state: Arc<Mutex<UpdateMenuState>>) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(15));
        let should_check = match state.lock() {
            Ok(mut state) if !state.checking => {
                state.checking = true;
                true
            }
            _ => false,
        };
        if !should_check {
            return;
        }
        tauri::async_runtime::spawn(async move {
            let result = install_available_update(&app).await;
            if let Ok(mut state) = state.lock() {
                state.checking = false;
            }
            if let Err(error) = result {
                eprintln!("auto-update=failed: {error}");
            }
        });
    });
}

/// macOS 的真正桌面层。桌面图标在它上面，因此壁纸不会挡住 Finder。
fn apply_wallpaper_level(window: &tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;
        let ptr = window.ns_window().map_err(|error| error.to_string())? as *mut AnyObject;
        // CanJoinAllSpaces(1) | Stationary(16) | IgnoresCycle(64)
        let behavior: usize = 1 | 16 | 64;
        unsafe {
            let _: () = objc2::msg_send![ptr, setLevel: DESKTOP_LEVEL];
            let _: () = objc2::msg_send![ptr, setCollectionBehavior: behavior];
            let level: isize = objc2::msg_send![ptr, level];
            if level != DESKTOP_LEVEL {
                return Err(format!("level={level} (want {DESKTOP_LEVEL})"));
            }
            Ok(format!("level={level}"))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok("using always-on-bottom".into())
    }
}

#[cfg(target_os = "macos")]
fn apply_native_wallpaper_level(
    window: &tauri::Window,
    _screen: &ScreenConfig,
) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    let ptr = window.ns_window().map_err(|error| error.to_string())? as *mut AnyObject;
    let behavior: usize = 1 | 16 | 64;
    unsafe {
        let _: () = objc2::msg_send![ptr, setLevel: DESKTOP_LEVEL];
        let _: () = objc2::msg_send![ptr, setCollectionBehavior: behavior];
    }
    Ok(())
}

#[cfg(windows)]
fn apply_native_wallpaper_level(
    window: &tauri::Window,
    screen: &ScreenConfig,
) -> Result<(), String> {
    use std::{ffi::c_void, ptr};
    use windows_sys::Win32::{
        Foundation::{GetLastError, SetLastError, BOOL, HWND, LPARAM, POINT},
        UI::WindowsAndMessaging::{
            EnumWindows, FindWindowExW, FindWindowW, GetWindowLongPtrW, ScreenToClient,
            SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos, GWL_STYLE,
            SMTO_NORMAL, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, WS_CHILD,
            WS_POPUP,
        },
    };

    const SPAWN_WORKER: u32 = 0x052c;
    const PROGMAN: &[u16] = &[80, 114, 111, 103, 109, 97, 110, 0];
    const WORKER_W: &[u16] = &[87, 111, 114, 107, 101, 114, 87, 0];
    const SHELL_VIEW: &[u16] = &[
        83, 72, 69, 76, 76, 68, 76, 76, 95, 68, 101, 102, 86, 105, 101, 119, 0,
    ];

    unsafe extern "system" fn find_worker(window: HWND, target: LPARAM) -> BOOL {
        let shell_view = FindWindowExW(window, ptr::null_mut(), SHELL_VIEW.as_ptr(), ptr::null());
        if !shell_view.is_null() {
            let worker = FindWindowExW(ptr::null_mut(), window, WORKER_W.as_ptr(), ptr::null());
            if !worker.is_null() {
                *(target as *mut HWND) = worker;
                return 0;
            }
        }
        1
    }

    unsafe {
        let progman = FindWindowW(PROGMAN.as_ptr(), ptr::null());
        if progman.is_null() {
            return Err("Windows Progman window not found".into());
        }
        let mut ignored = 0;
        SendMessageTimeoutW(progman, SPAWN_WORKER, 0, 0, SMTO_NORMAL, 1000, &mut ignored);
        let mut worker: HWND = ptr::null_mut::<c_void>();
        EnumWindows(Some(find_worker), &mut worker as *mut HWND as LPARAM);
        if worker.is_null() {
            return Err("Windows WorkerW wallpaper window not found".into());
        }
        let child = window.hwnd().map_err(|error| error.to_string())?.0;
        let style = GetWindowLongPtrW(child, GWL_STYLE) as u32;
        SetLastError(0);
        if SetWindowLongPtrW(child, GWL_STYLE, ((style & !WS_POPUP) | WS_CHILD) as isize) == 0 {
            let error = GetLastError();
            if error != 0 {
                return Err(format!("failed to set WorkerW child style: {error}"));
            }
        }
        SetLastError(0);
        if SetParent(child, worker).is_null() {
            let error = GetLastError();
            if error != 0 {
                return Err(format!(
                    "failed to attach native window to WorkerW: {error}"
                ));
            }
        }
        let mut origin = POINT {
            x: (screen.x * screen.scale_factor).round() as i32,
            y: (screen.y * screen.scale_factor).round() as i32,
        };
        if ScreenToClient(worker, &mut origin) == 0 {
            return Err(format!(
                "failed to convert WorkerW coordinates: {}",
                GetLastError()
            ));
        }
        let width = (screen.width * screen.scale_factor).round() as i32;
        let height = (screen.height * screen.scale_factor).round() as i32;
        if SetWindowPos(
            child,
            ptr::null_mut(),
            origin.x,
            origin.y,
            width,
            height,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW,
        ) == 0
        {
            return Err(format!(
                "failed to place WorkerW child window: {}",
                GetLastError()
            ));
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn apply_native_wallpaper_level(
    window: &tauri::Window,
    _screen: &ScreenConfig,
) -> Result<(), String> {
    window
        .set_always_on_bottom(true)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
const DESKTOP_LEVEL: isize = -2147483623;

#[tauri::command]
fn enter_wallpaper(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WallpaperState>,
) -> Result<ScreenConfig, String> {
    let target = state
        .screens
        .iter()
        .find(|screen| screen.config.label == window.label())
        .cloned()
        .ok_or_else(|| format!("screen config not found for {}", window.label()))?;

    #[cfg(not(target_os = "macos"))]
    window
        .set_always_on_bottom(true)
        .map_err(|error| error.to_string())?;
    window
        .set_position(tauri::LogicalPosition::new(
            target.config.x,
            target.config.y,
        ))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(
            target.config.width,
            target.config.height,
        ))
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;
    window
        .set_focusable(false)
        .map_err(|error| error.to_string())?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;

    // show() 会让窗口重新参与 macOS 排序；真正的桌面层必须是最后一个窗口操作。
    apply_wallpaper_level(&window)?;
    Ok(target.config)
}

#[tauri::command]
fn set_world_pointer(
    app: tauri::AppHandle,
    state: tauri::State<'_, WallpaperState>,
    x: f64,
    y: f64,
) {
    if let Ok(mut fish) = state.fish.lock() {
        fish.set_pointer(x, y);
    }
    let _ = app.emit("world-pointer", PointerFrame { x, y });
}

fn start_fish_loop(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(33));
            let now = Instant::now();
            let dt = now.duration_since(last).as_secs_f64().min(0.08);
            last = now;
            let frame = {
                let state = app.state::<WallpaperState>();
                let frame = match state.fish.lock() {
                    Ok(mut fish) => fish.tick(dt),
                    Err(_) => break,
                };
                frame
            };
            if app.emit("fish-frame", frame).is_err() {
                break;
            }
        }
    });
}

pub(crate) fn start_webview_renderer(
    app: &tauri::AppHandle,
    screens: &[ScreenConfig],
) -> Result<(), String> {
    for screen in screens {
        if app.get_webview_window(&screen.label).is_some() {
            continue;
        }
        WebviewWindowBuilder::new(app, &screen.label, WebviewUrl::App("index.html".into()))
            .title("小鱼缸壁纸")
            .visible(false)
            .focused(false)
            .focusable(false)
            .decorations(false)
            .transparent(false)
            .resizable(false)
            .build()
            .map_err(|error| error.to_string())?;
    }
    start_fish_loop(app.clone());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![enter_wallpaper, set_world_pointer])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let main = app
                .get_webview_window("main")
                .ok_or_else(|| "main window not found".to_string())?;
            let primary = main
                .primary_monitor()?
                .ok_or_else(|| "primary monitor not found".to_string())?;
            let primary_scale_factor = primary.scale_factor();
            let mut monitors = main.available_monitors()?;
            monitors.sort_by_key(|monitor| {
                if monitor.position() == primary.position() && monitor.size() == primary.size() {
                    0
                } else {
                    1
                }
            });
            let screens = monitors
                .iter()
                .enumerate()
                .map(|(index, monitor)| {
                    let scale = monitor.scale_factor();
                    let position = *monitor.position();
                    let size = *monitor.size();
                    ScreenTarget {
                        config: ScreenConfig {
                            label: if index == 0 {
                                "main".into()
                            } else {
                                format!("wallpaper-{index}")
                            },
                            x: logical_coordinate(position.x as f64, scale),
                            y: logical_coordinate(position.y as f64, scale),
                            width: logical_coordinate(size.width as f64, scale),
                            height: logical_coordinate(size.height as f64, scale),
                            scale_factor: scale,
                            primary_scale_factor,
                        },
                    }
                })
                .collect::<Vec<_>>();
            if screens.is_empty() {
                return Err("no monitors found".into());
            }
            let fish_screens = screens.iter().map(|screen| screen.config.clone()).collect();
            app.manage(WallpaperState {
                screens: screens.clone(),
                fish: Mutex::new(FishWorld::new(fish_screens)),
            });

            let mut use_webview = std::env::var_os("QIU_WEBVIEW_RENDERER").is_some();
            if !use_webview {
                let native_result = (|| -> Result<(), String> {
                    let mut native_windows: Vec<(tauri::Window, ScreenConfig)> =
                        Vec::with_capacity(screens.len());
                    for (index, screen) in screens.iter().enumerate() {
                        let window =
                            tauri::window::WindowBuilder::new(app, format!("native-{index}"))
                                .title("小鱼缸壁纸")
                                .position(screen.config.x, screen.config.y)
                                .inner_size(screen.config.width, screen.config.height)
                                .visible(false)
                                .focused(false)
                                .focusable(false)
                                .decorations(false)
                                .transparent(false)
                                .resizable(false)
                                .build()
                                .map_err(|error| error.to_string())?;
                        let configured = window
                            .set_ignore_cursor_events(true)
                            .and_then(|_| window.show())
                            .map_err(|error| error.to_string())
                            .and_then(|_| apply_native_wallpaper_level(&window, &screen.config));
                        if let Err(error) = configured {
                            let _ = window.close();
                            for (window, _) in &native_windows {
                                let _ = window.close();
                            }
                            return Err(error);
                        }
                        native_windows.push((window, screen.config.clone()));
                    }
                    native_gpu::start(native_windows, app.handle().clone())
                })();
                if let Err(error) = native_result {
                    eprintln!("native-gpu=fallback: {error}");
                    use_webview = true;
                }
            }
            if use_webview {
                let webview_screens = screens
                    .iter()
                    .map(|screen| screen.config.clone())
                    .collect::<Vec<_>>();
                start_webview_renderer(app.handle(), &webview_screens)?;
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::ManagerExt;
                let autostart = app.autolaunch();
                match autostart.enable() {
                    Ok(()) => eprintln!("autostart=enabled"),
                    Err(error) => eprintln!("autostart=failed: {error}"),
                }
            }

            // 壁纸没有普通窗口，只保留更新检查和一个可靠的退出入口。
            let update = MenuItem::with_id(
                app,
                "check-update",
                if cfg!(debug_assertions) {
                    "开发模式不检查更新"
                } else {
                    "检查更新"
                },
                !cfg!(debug_assertions),
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "退出壁纸", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&update, &quit])?;
            let update_item = update.clone();
            let update_state = Arc::new(Mutex::new(UpdateMenuState::default()));
            #[cfg(not(debug_assertions))]
            let auto_update_state = Arc::clone(&update_state);
            TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/32x32.png"))
                .tooltip("小鱼缸壁纸")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "check-update" => {
                        let mut state = match update_state.lock() {
                            Ok(state) => state,
                            Err(_) => return,
                        };
                        if state.checking {
                            return;
                        }
                        state.checking = true;
                        drop(state);

                        let _ = update_item.set_enabled(false);
                        let _ = update_item.set_text("正在检查…");
                        let app = app.clone();
                        let item = update_item.clone();
                        let state = Arc::clone(&update_state);
                        let current = app.package_info().version.clone();
                        tauri::async_runtime::spawn(async move {
                            let result = install_available_update(&app).await;
                            if let Ok(mut menu_state) = state.lock() {
                                menu_state.checking = false;
                                match result {
                                    Ok(false) => {
                                        let _ = item.set_text(format!("已是最新 v{current}"));
                                    }
                                    Ok(true) => unreachable!("安装更新后应用会立即重启"),
                                    Err(_) => {
                                        let _ = item.set_text("检查失败，点击重试");
                                    }
                                }
                            }
                            let _ = item.set_enabled(true);
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            #[cfg(not(debug_assertions))]
            start_auto_update(app.handle().clone(), auto_update_state);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(label: &str, x: f64) -> ScreenConfig {
        ScreenConfig {
            label: label.into(),
            x,
            y: 0.0,
            width: 800.0,
            height: 600.0,
            scale_factor: 1.0,
            primary_scale_factor: 2.0,
        }
    }

    #[test]
    fn shared_fish_world_can_cross_a_screen_boundary() {
        let mut world = FishWorld::new(vec![screen("main", 0.0), screen("wallpaper-1", 800.0)]);
        world.x = 400.0;
        world.y = 300.0;
        world.target_x = 1_200.0;
        world.target_y = 300.0;
        world.angle = 0.0;
        world.speed = 105.0;

        let mut crossed = false;
        for _ in 0..150 {
            let frame = world.tick(0.033);
            if frame.x > 800.0 {
                crossed = true;
                break;
            }
        }

        assert!(crossed, "fish should enter the neighboring screen");
    }

    #[test]
    fn monitor_and_cursor_coordinates_share_appkit_logical_units() {
        // Tao turns AppKit's global logical coordinates into physical values with
        // the owning monitor scale, while cursor positions use the primary scale.
        assert_eq!(logical_coordinate(-3444.0, 2.0), -1722.0);
        assert_eq!(logical_coordinate(5120.0, 2.0), 2560.0);
        assert_eq!(logical_coordinate(-1722.0, 1.0), -1722.0);
        assert_eq!(logical_coordinate(2560.0, 1.0), 2560.0);
    }
}
