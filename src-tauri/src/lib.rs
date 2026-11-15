// Nookstacks desktop shell.
//
// The app is the same web bundle that runs in a browser; this crate only
// replaces the HTTP API with direct file access. All file system work lives in
// `vault`, which is unit-tested without a window.

mod nks;
mod vault;

use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct StateEnvelope {
    state: Option<serde_json::Value>,
    saved_ms: u64,
    vault: String,
}

#[derive(Serialize)]
struct Saved {
    bytes: usize,
    saved_ms: u64,
}

#[tauri::command]
fn vault_info() -> StateEnvelope {
    StateEnvelope {
        state: None,
        saved_ms: 0,
        vault: vault::vault_dir().to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn get_state() -> Result<StateEnvelope, String> {
    let (state, saved) = vault::current().read_state()?;
    Ok(StateEnvelope {
        state,
        saved_ms: saved,
        vault: vault::vault_dir().to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn put_state(state: serde_json::Value) -> Result<Saved, String> {
    let bytes = vault::current().write_state(&state)?;
    Ok(Saved {
        bytes,
        saved_ms: vault::now_ms(),
    })
}

#[tauri::command]
fn get_blob(id: String) -> Result<tauri::ipc::Response, String> {
    let bytes = vault::current().read_blob(&id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn put_blob(id: String, bytes: Vec<u8>) -> Result<(), String> {
    vault::current().write_blob(&id, &bytes)
}

#[tauri::command]
fn delete_blob(id: String) -> Result<(), String> {
    vault::current().remove_blob(&id)
}

#[tauri::command]
fn import_files(paths: Vec<String>) -> Result<Vec<vault::Imported>, String> {
    vault::current().import(&paths)
}

#[tauri::command]
fn pick_files() -> Vec<String> {
    rfd::FileDialog::new()
        .set_title("Add files to this board")
        .pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn open_vault() -> Result<(), String> {
    vault::current().ensure_dirs().map_err(|e| e.to_string())?;
    let dir = vault::vault_dir().to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(not(target_os = "windows"))]
    let opener = "xdg-open";
    std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn export_nks(state: serde_json::Value, scope: String, name: String) -> Result<nks::Written, String> {
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let suggested = format!("{}.nks", if safe.trim().is_empty() { "board".into() } else { safe.trim().to_string() });
    let out = rfd::FileDialog::new()
        .set_title("Export board as .nks")
        .add_filter("Nookstacks bundle", &["nks"])
        .set_file_name(&suggested)
        .save_file()
        .ok_or("cancelled")?;
    let blobs = vault::current().blobs_dir();
    nks::write_nks(&blobs, &state, &scope, &name, &out)
}

#[tauri::command]
fn import_nks() -> Result<nks::Incoming, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Open a .nks board")
        .add_filter("Nookstacks bundle", &["nks"])
        .pick_file()
        .ok_or("cancelled")?;
    let blobs = vault::current().blobs_dir();
    vault::current().ensure_dirs().map_err(|e| e.to_string())?;
    nks::read_nks(&blobs, &picked)
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) links can be opened".into());
    }
    #[cfg(target_os = "windows")]
    let how = ("cmd", vec!["/C", "start", "", &url]);
    #[cfg(target_os = "macos")]
    let how = ("open", vec![url.as_str()]);
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let how = ("xdg-open", vec![url.as_str()]);
    std::process::Command::new(how.0)
        .args(how.1)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = vault::current().ensure_dirs();

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .on_window_event(|window, event| {
            // an OS drop arrives as paths; the page never sees File objects here
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let list: Vec<String> = paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                let _ = window.emit("nookstacks://drop", list);
            }
        })
        .invoke_handler(tauri::generate_handler![
            vault_info,
            get_state,
            put_state,
            get_blob,
            put_blob,
            delete_blob,
            import_files,
            pick_files,
            open_vault,
            export_nks,
            import_nks,
            open_url,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nookstacks");
}
