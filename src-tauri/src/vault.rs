// The vault: everything that touches the file system.
//
// Kept apart from the Tauri commands so it can be tested without a window.
// Layout (identical to the dev server's, so a vault moves between them):
//
//   vault/state.json          the board
//   vault/state.json.bak      the previous save
//   vault/history/<ms>.json   rolling snapshots, last KEEP_HISTORY
//   vault/blobs/<id>          imported files

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub const KEEP_HISTORY: usize = 40;
pub const MAX_BLOB: u64 = 4 * 1024 * 1024 * 1024;

static VAULT: OnceLock<PathBuf> = OnceLock::new();

/// A vault rooted at a directory. The app uses `current()`; tests build their own.
pub struct Vault {
    pub root: PathBuf,
}

impl Vault {
    pub fn at(root: PathBuf) -> Vault {
        Vault { root }
    }

    pub fn state_path(&self) -> PathBuf {
        self.root.join("state.json")
    }

    pub fn blobs_dir(&self) -> PathBuf {
        self.root.join("blobs")
    }

    pub fn history_dir(&self) -> PathBuf {
        self.root.join("history")
    }

    pub fn ensure_dirs(&self) -> std::io::Result<()> {
        fs::create_dir_all(self.blobs_dir())?;
        fs::create_dir_all(self.history_dir())?;
        Ok(())
    }

    pub fn read_state(&self) -> Result<(Option<serde_json::Value>, u64), String> {
        let path = self.state_path();
        if !path.exists() {
            return Ok((None, 0));
        }
        let raw = fs::read(&path).map_err(|e| e.to_string())?;
        let value: serde_json::Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
        Ok((Some(value), mtime_ms(&path)))
    }

    pub fn write_state(&self, state: &serde_json::Value) -> Result<usize, String> {
        self.ensure_dirs().map_err(|e| e.to_string())?;
        let path = self.state_path();
        let payload = serde_json::to_vec(state).map_err(|e| e.to_string())?;

        if path.exists() {
            let _ = fs::copy(&path, self.root.join("state.json.bak"));
            let _ = fs::copy(&path, self.history_dir().join(format!("{}.json", now_ms())));

            let mut all: Vec<PathBuf> = fs::read_dir(self.history_dir())
                .map(|rd| {
                    rd.filter_map(|e| e.ok().map(|e| e.path()))
                        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
                        .collect()
                })
                .unwrap_or_default();
            all.sort();
            while all.len() > KEEP_HISTORY {
                let old = all.remove(0);
                let _ = fs::remove_file(old);
            }
        }

        atomic_write(&path, &payload).map_err(|e| e.to_string())?;
        Ok(payload.len())
    }

    pub fn read_blob(&self, id: &str) -> Result<Vec<u8>, String> {
        let id = safe_id(id)?;
        fs::read(self.blobs_dir().join(id)).map_err(|e| e.to_string())
    }

    pub fn write_blob(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        let id = safe_id(id)?;
        if bytes.len() as u64 > MAX_BLOB {
            return Err("file too large".into());
        }
        self.ensure_dirs().map_err(|e| e.to_string())?;
        atomic_write(&self.blobs_dir().join(id), bytes).map_err(|e| e.to_string())
    }

    pub fn remove_blob(&self, id: &str) -> Result<(), String> {
        let id = safe_id(id)?;
        let path = self.blobs_dir().join(id);
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Copy files into the vault and return metadata only: bytes never cross into JS.
    pub fn import(&self, paths: &[String]) -> Result<Vec<Imported>, String> {
        self.ensure_dirs().map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for p in paths {
            let src = PathBuf::from(p);
            let meta = match fs::metadata(&src) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if !meta.is_file() {
                continue;
            }
            if meta.len() > MAX_BLOB {
                return Err(format!("{} is too large", src.display()));
            }
            let name = src
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".into());
            let id = format!("b{}{:03}", now_ms(), out.len() % 1000);
            fs::copy(&src, self.blobs_dir().join(&id)).map_err(|e| e.to_string())?;
            out.push(Imported {
                blob_id: id,
                ext: Path::new(&name)
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default(),
                name,
                size: meta.len(),
                path: p.clone(),
            });
        }
        Ok(out)
    }
}

pub fn current() -> Vault {
    Vault::at(vault_dir().to_path_buf())
}

fn data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(p) = std::env::var("APPDATA") {
            return PathBuf::from(p);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(p) = std::env::var("XDG_DATA_HOME") {
            if !p.trim().is_empty() {
                return PathBuf::from(p);
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(".local").join("share");
        }
    }
    std::env::temp_dir()
}

pub fn vault_dir() -> &'static Path {
    VAULT.get_or_init(|| {
        if let Ok(p) = std::env::var("TARTAROS_VAULT") {
            if !p.trim().is_empty() {
                return PathBuf::from(p);
            }
        }
        data_dir().join("Tartaros").join("vault")
    })
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// temp file + fsync + rename: a crash mid-write cannot truncate the vault
fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

pub fn safe_id(id: &str) -> Result<String, String> {
    let ok = !id.is_empty()
        && id.len() <= 96
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(id.to_string())
    } else {
        Err("bad id".into())
    }
}

fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize)]
pub struct Imported {
    pub blob_id: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub path: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(tag: &str) -> (Vault, PathBuf) {
        let dir = std::env::temp_dir().join(format!("tartaros-test-{}-{}", tag, now_ms()));
        let _ = fs::remove_dir_all(&dir);
        (Vault::at(dir.clone()), dir)
    }

    #[test]
    fn state_roundtrip_backs_up_and_keeps_history() {
        let (v, dir) = vault("state");
        v.ensure_dirs().unwrap();

        let first = serde_json::json!({ "levels": [ { "name": "one", "n": 1 } ] });
        let n = v.write_state(&first).unwrap();
        assert!(n > 10);
        assert!(v.state_path().exists());
        assert!(!v.root.join("state.json.bak").exists(), "no backup on the first save");

        let (back, saved) = v.read_state().unwrap();
        assert_eq!(back.unwrap(), first);
        assert!(saved > 0);

        std::thread::sleep(std::time::Duration::from_millis(15));
        let second = serde_json::json!({ "levels": [ { "name": "two", "n": 2 } ] });
        v.write_state(&second).unwrap();
        assert!(v.root.join("state.json.bak").exists());
        let bak: serde_json::Value =
            serde_json::from_slice(&fs::read(v.root.join("state.json.bak")).unwrap()).unwrap();
        assert_eq!(bak, first, "backup holds the previous save");
        assert_eq!(v.read_state().unwrap().0.unwrap(), second);

        for _ in 0..KEEP_HISTORY + 6 {
            std::thread::sleep(std::time::Duration::from_millis(3));
            v.write_state(&serde_json::json!({ "levels": [] })).unwrap();
        }
        let snaps = fs::read_dir(v.history_dir()).unwrap().count();
        assert!(snaps <= KEEP_HISTORY, "history capped at {}, found {}", KEEP_HISTORY, snaps);
        assert!(snaps >= KEEP_HISTORY - 2, "history should sit near the cap, found {}", snaps);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupt_state_is_an_error_not_a_silent_empty_board() {
        let (v, dir) = vault("corrupt");
        v.ensure_dirs().unwrap();
        fs::write(v.state_path(), b"{ not json").unwrap();
        assert!(v.read_state().is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn blobs_roundtrip_and_delete() {
        let (v, dir) = vault("blobs");
        v.ensure_dirs().unwrap();
        v.write_blob("b123", b"hello world").unwrap();
        assert_eq!(v.read_blob("b123").unwrap(), b"hello world");
        assert_eq!(fs::metadata(v.blobs_dir().join("b123")).unwrap().len(), 11);
        v.remove_blob("b123").unwrap();
        assert!(v.read_blob("b123").is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ids_cannot_escape_the_vault() {
        let (v, dir) = vault("ids");
        v.ensure_dirs().unwrap();
        for bad in ["../state.json", "..", "a/b", "", "x y", "a\\b"] {
            assert!(safe_id(bad).is_err(), "{} should be rejected", bad);
            assert!(v.read_blob(bad).is_err());
        }
        assert!(safe_id("b1a2-b3_c4").is_ok());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn import_copies_files_and_reports_metadata() {
        let (v, dir) = vault("import");
        v.ensure_dirs().unwrap();
        let src = std::env::temp_dir().join(format!("tartaros-src-{}.stl", now_ms()));
        fs::write(&src, vec![0u8; 2048]).unwrap();

        let got = v.import(&[src.to_string_lossy().to_string()]).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].ext, "stl");
        assert_eq!(got[0].size, 2048);
        assert!(got[0].name.ends_with(".stl"));
        assert_eq!(v.read_blob(&got[0].blob_id).unwrap().len(), 2048);

        let missing = v.import(&["/nope/missing.bin".to_string()]).unwrap();
        assert!(missing.is_empty(), "a missing path is skipped, not fatal");

        let _ = fs::remove_file(src);
        let _ = fs::remove_dir_all(dir);
    }
}
