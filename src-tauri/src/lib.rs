use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;

#[derive(Serialize, Clone)]
struct MonitorInfo {
    id: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

const MAX_MONITORS: usize = 6;

struct Overlays(Mutex<HashMap<String, WebviewWindow>>);
struct DimValues(Mutex<HashMap<String, u8>>);
struct CloseBehavior(AtomicBool);

fn monitor_id(index: usize, name: Option<&String>) -> String {
    name.cloned().unwrap_or_else(|| format!("monitor-{index}"))
}

fn create_overlay(
    app: &AppHandle,
    index: usize,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> tauri::Result<WebviewWindow> {
    let label = format!("overlay-{index}");
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("overlay.html".into()))
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build()?;

    window.set_position(position)?;
    window.set_size(size)?;
    window.set_ignore_cursor_events(true)?;

    Ok(window)
}

fn apply_dim(window: &WebviewWindow, value: u8) -> tauri::Result<()> {
    let value = value.min(100);
    if value == 0 {
        window.hide()?;
    } else {
        let ratio = value as f64 / 100.0;
        window.eval(&format!("setDim({ratio})"))?;
        window.show()?;
        window.set_always_on_top(true)?;
    }
    Ok(())
}

#[tauri::command]
fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let mut infos: Vec<MonitorInfo> = monitors
        .iter()
        .take(MAX_MONITORS)
        .enumerate()
        .map(|(i, m)| MonitorInfo {
            id: monitor_id(i, m.name()),
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect();
    // Sensible default order until the user picks their own in the UI.
    infos.sort_by_key(|m| m.x);
    Ok(infos)
}

#[tauri::command]
fn set_dim(
    overlays: tauri::State<Overlays>,
    dims: tauri::State<DimValues>,
    id: String,
    value: u8,
) -> Result<(), String> {
    let windows = overlays.0.lock().map_err(|e| e.to_string())?;
    if let Some(window) = windows.get(&id) {
        apply_dim(window, value).map_err(|e| e.to_string())?;
    }
    dims.0.lock().map_err(|e| e.to_string())?.insert(id, value.min(100));
    Ok(())
}

#[tauri::command]
async fn identify_displays(
    overlays: tauri::State<'_, Overlays>,
    dims: tauri::State<'_, DimValues>,
    order: Vec<String>,
) -> Result<(), String> {
    const DURATION_MS: u64 = 1800;

    let ids: Vec<String> = order.into_iter().take(MAX_MONITORS).collect();

    {
        let windows = overlays.0.lock().map_err(|e| e.to_string())?;
        for (i, id) in ids.iter().enumerate() {
            if let Some(window) = windows.get(id) {
                let _ = window.show();
                let _ = window.set_always_on_top(true);
                let _ = window.eval(&format!("identify({}, {DURATION_MS})", i + 1));
            }
        }
    }

    tokio::time::sleep(std::time::Duration::from_millis(DURATION_MS)).await;

    let windows = overlays.0.lock().map_err(|e| e.to_string())?;
    let dim_values = dims.0.lock().map_err(|e| e.to_string())?;
    for id in &ids {
        if let Some(window) = windows.get(id) {
            let value = dim_values.get(id).copied().unwrap_or(0);
            let _ = apply_dim(window, value);
        }
    }

    Ok(())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_close_behavior(state: tauri::State<CloseBehavior>, minimize: bool) {
    state.0.store(minimize, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(Overlays(Mutex::new(HashMap::new())))
        .manage(DimValues(Mutex::new(HashMap::new())))
        .manage(CloseBehavior(AtomicBool::new(true)))
        .invoke_handler(tauri::generate_handler![
            list_monitors,
            set_dim,
            identify_displays,
            set_autostart,
            get_autostart,
            set_close_behavior
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            let monitors = handle.available_monitors()?;
            {
                let state = handle.state::<Overlays>();
                let mut overlays = state.0.lock().unwrap();
                for (i, m) in monitors.iter().take(MAX_MONITORS).enumerate() {
                    let window = create_overlay(&handle, i, *m.position(), *m.size())?;
                    overlays.insert(monitor_id(i, m.name()), window);
                }
            }

            // Windows can silently demote a topmost window (another app briefly
            // claims topmost, a fullscreen-borderless app launches, etc.). Keep
            // re-asserting it on every visible overlay so dimming stays above
            // regular and fullscreen-windowed apps, not just the desktop.
            let topmost_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                    let state = topmost_handle.state::<Overlays>();
                    let Ok(windows) = state.0.lock() else { continue };
                    for window in windows.values() {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.set_always_on_top(true);
                        }
                    }
                }
            });

            if let Some(main) = app.get_webview_window("main") {
                let start_hidden = std::env::args().any(|a| a == "--hidden");
                if !start_hidden {
                    let _ = main.show();
                }

                let close_target = main.clone();
                let app_handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let minimize = app_handle
                            .state::<CloseBehavior>()
                            .0
                            .load(Ordering::Relaxed);
                        if minimize {
                            let _ = close_target.hide();
                        } else {
                            app_handle.exit(0);
                        }
                    }
                });
            }

            let show_item = MenuItem::with_id(app, "show", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
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
