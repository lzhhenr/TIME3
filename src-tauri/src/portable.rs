//! Keep personal records and the WebView profile beside the executable.
use std::{fs, io, path::PathBuf};

pub fn prepare() -> io::Result<PathBuf> {
    if let Some(path) = std::env::var_os("TIME3_SMOKE_DATA") {
        let data = PathBuf::from(path);
        fs::create_dir_all(&data)?;
        return Ok(data);
    }
    // Resolve the executable, never the shortcut's working directory.
    let executable = std::env::current_exe()?;
    let data = executable.parent().ok_or_else(|| io::Error::other("Executable folder unavailable"))?.join("data");
    fs::create_dir_all(&data)?;
    let marker = data.join("portable-data-initialized");
    if marker.exists() { return Ok(data); }

    let names = ["calendar-state.json", "wellness-state.json"];
    let staging = data.join(".legacy-import");
    let ready = staging.join("ready");
    if !ready.exists() && !names.iter().any(|name| data.join(name).exists()) {
        if let Some(root) = std::env::var_os("APPDATA").map(PathBuf::from) {
            // Import both records from one source, preferring the latest Tauri edition.
            let source = [root.join("TIME3-Tauri"), root.join("TIME3")]
                .into_iter().find(|folder| names.iter().any(|name| folder.join(name).is_file()));
            if let Some(source) = source {
                fs::create_dir_all(&staging)?;
                for name in names {
                    if source.join(name).is_file() { fs::copy(source.join(name), staging.join(name))?; }
                }
                // Stage the complete pair before installing either file. An interrupted
                // import can resume on launch without replacing existing portable data.
                fs::write(&ready, "ready")?;
            }
        }
    }
    if ready.exists() {
        for name in names {
            let staged = staging.join(name);
            if staged.is_file() && !data.join(name).exists() { fs::rename(staged, data.join(name))?; }
        }
    }
    fs::write(marker, "Portable data initialized; legacy files preserved.")?;
    Ok(data)
}
