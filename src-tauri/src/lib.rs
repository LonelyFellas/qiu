use semver::Version;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_opener::OpenerExt;

const GITEE_RELEASE_API: &str = "https://gitee.com/api/v5/repos/yu-shengming/qiu/releases/latest";
const GITHUB_RELEASE_API: &str = "https://api.github.com/repos/LonelyFellas/qiu/releases/latest";

#[derive(Deserialize)]
struct ReleaseResponse {
    tag_name: String,
    html_url: Option<String>,
}

enum UpdateCheck {
    Available { version: String, url: String },
    Current,
    NoRelease,
}

#[derive(Default)]
struct UpdateMenuState {
    checking: bool,
    release_url: Option<String>,
}

async fn fetch_release(
    client: &reqwest::Client,
    api: &str,
    fallback_url: impl FnOnce(&str) -> String,
) -> Result<Option<(String, String)>, String> {
    let response = client
        .get(api)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "LittleFishTank")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let release = response
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<ReleaseResponse>()
        .await
        .map_err(|error| error.to_string())?;
    let url = release
        .html_url
        .unwrap_or_else(|| fallback_url(&release.tag_name));
    Ok(Some((release.tag_name, url)))
}

async fn check_latest_release(current: &Version) -> Result<UpdateCheck, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| error.to_string())?;
    let release = match fetch_release(&client, GITEE_RELEASE_API, |tag| {
        format!("https://gitee.com/yu-shengming/qiu/releases/tag/{tag}")
    })
    .await
    {
        Ok(Some(release)) => Some(release),
        Ok(None) | Err(_) => {
            fetch_release(&client, GITHUB_RELEASE_API, |_| {
                "https://github.com/LonelyFellas/qiu/releases/latest".into()
            })
            .await?
        }
    };
    let Some((tag, url)) = release else {
        return Ok(UpdateCheck::NoRelease);
    };
    let latest = Version::parse(tag.trim_start_matches('v')).map_err(|error| error.to_string())?;

    if latest > *current {
        Ok(UpdateCheck::Available { version: tag, url })
    } else {
        Ok(UpdateCheck::Current)
    }
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
const DESKTOP_LEVEL: isize = -2147483623;

#[tauri::command]
fn enter_wallpaper(window: tauri::WebviewWindow) -> Result<String, String> {
    // 隐藏窗口没有可靠的“当前显示器”，登录启动时始终铺到系统主显示器。
    let monitor = window
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "current monitor not found".to_string())?;
    let position = *monitor.position();
    let size = *monitor.size();

    #[cfg(not(target_os = "macos"))]
    window
        .set_always_on_bottom(true)
        .map_err(|error| error.to_string())?;
    window
        .set_position(position)
        .map_err(|error| error.to_string())?;
    window.set_size(size).map_err(|error| error.to_string())?;
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
    let level = apply_wallpaper_level(&window)?;

    let actual = window.inner_size().map_err(|error| error.to_string())?;
    Ok(format!(
        "monitor={}x{}, window={}x{}, {level}",
        size.width, size.height, actual.width, actual.height,
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![enter_wallpaper])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
            let update = MenuItem::with_id(app, "check-update", "检查更新", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出壁纸", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&update, &quit])?;
            let update_item = update.clone();
            let update_state = Arc::new(Mutex::new(UpdateMenuState::default()));
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
                        if let Some(url) = state.release_url.clone() {
                            let _ = app.opener().open_url(url, None::<&str>);
                            return;
                        }
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
                            let result = check_latest_release(&current).await;
                            if let Ok(mut menu_state) = state.lock() {
                                menu_state.checking = false;
                                match result {
                                    Ok(UpdateCheck::Available { version, url }) => {
                                        menu_state.release_url = Some(url);
                                        let _ = item.set_text(format!("发现 {version}，点击下载"));
                                    }
                                    Ok(UpdateCheck::Current) => {
                                        let _ = item.set_text(format!("已是最新 v{current}"));
                                    }
                                    Ok(UpdateCheck::NoRelease) => {
                                        let _ = item.set_text("暂无发布版本，点击重试");
                                    }
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_tags_compare_as_semver() {
        let current = Version::parse("0.1.0").unwrap();
        assert!(Version::parse("0.2.0").unwrap() > current);
        assert!(Version::parse("0.1.0").unwrap() <= current);
    }
}
