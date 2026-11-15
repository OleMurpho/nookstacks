// The .nks container.
//
// A board is one file: a zip holding a manifest, the board's state.json and
// every blob the board references, stored by content hash. Because blobs are
// addressed by hash and no path is ever absolute, a board written on Windows
// opens on Linux (or the other way round) with nothing to relink.

use crate::vault::now_ms;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const FORMAT: &str = "nookstacks.bundle";
pub const VERSION: u32 = 1;
const MANIFEST: &str = "nookstacks.json";
const STATE: &str = "state.json";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub app: String,
    /// "board" exports one project, "vault" exports every level
    pub scope: String,
    pub name: String,
    pub exported_ms: u64,
    pub blobs: Vec<String>,
}

#[derive(Serialize)]
pub struct Written {
    pub path: String,
    pub bytes: usize,
    pub blobs: usize,
    pub scope: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct Incoming {
    pub manifest: Manifest,
    pub state: Value,
    /// blobs that were not already in the vault and have just been written
    pub blobs_added: usize,
}

/// Every blob a piece of state refers to, found by walking for `blobId`.
fn referenced_blobs(state: &Value) -> BTreeSet<String> {
    fn walk(v: &Value, set: &mut BTreeSet<String>) {
        match v {
            Value::Object(map) => {
                for (k, val) in map {
                    if k == "blobId" {
                        if let Some(s) = val.as_str() {
                            if !s.is_empty() && !s.contains('/') && !s.contains('\\') {
                                set.insert(s.to_string());
                            }
                        }
                    }
                    walk(val, set);
                }
            }
            Value::Array(items) => items.iter().for_each(|i| walk(i, set)),
            _ => {}
        }
    }
    let mut set = BTreeSet::new();
    walk(state, &mut set);
    set
}

pub fn write_nks(
    blobs_root: &Path,
    state: &Value,
    scope: &str,
    name: &str,
    out: &Path,
) -> Result<Written, String> {
    let ids = referenced_blobs(state);
    let manifest = Manifest {
        format: FORMAT.to_string(),
        version: VERSION,
        app: env!("CARGO_PKG_VERSION").to_string(),
        scope: scope.to_string(),
        name: name.to_string(),
        exported_ms: now_ms(),
        blobs: ids.iter().cloned().collect(),
    };

    let file = std::fs::File::create(out).map_err(|e| format!("cannot write {}: {e}", out.display()))?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    zip.start_file(MANIFEST, opts).map_err(|e| e.to_string())?;
    zip.write_all(&json).map_err(|e| e.to_string())?;

    let body = serde_json::to_vec(state).map_err(|e| e.to_string())?;
    zip.start_file(STATE, opts).map_err(|e| e.to_string())?;
    zip.write_all(&body).map_err(|e| e.to_string())?;

    // media is already compressed; storing it keeps export fast and zip valid
    let store = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let mut packed = 0usize;
    for id in &ids {
        let path = blobs_root.join(id);
        let Ok(mut fh) = std::fs::File::open(&path) else { continue };
        zip.start_file(format!("blobs/{id}"), store).map_err(|e| e.to_string())?;
        std::io::copy(&mut fh, &mut zip).map_err(|e| e.to_string())?;
        packed += 1;
    }

    zip.finish().map_err(|e| e.to_string())?;
    let bytes = std::fs::metadata(out).map(|m| m.len() as usize).unwrap_or(0);
    Ok(Written {
        path: out.to_string_lossy().to_string(),
        bytes,
        blobs: packed,
        scope: scope.to_string(),
        name: name.to_string(),
    })
}

pub fn read_nks(blobs_root: &Path, path: &Path) -> Result<Incoming, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("not a .nks bundle: {e}"))?;

    let manifest: Manifest = {
        let mut f = zip.by_name(MANIFEST).map_err(|_| "bundle has no nookstacks.json".to_string())?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| format!("bad manifest: {e}"))?
    };

    if manifest.format != FORMAT {
        return Err(format!("unknown bundle format '{}'", manifest.format));
    }
    if manifest.version > VERSION {
        return Err(format!(
            "this bundle was written by a newer Nookstacks (v{}, this build reads v{})",
            manifest.version, VERSION
        ));
    }

    let state: Value = {
        let mut f = zip.by_name(STATE).map_err(|_| "bundle has no state.json".to_string())?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| format!("bad state: {e}"))?
    };

    std::fs::create_dir_all(blobs_root).map_err(|e| e.to_string())?;
    let mut added = 0usize;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = f.enclosed_name().map(|p| p.to_string_lossy().to_string()) else { continue };
        let Some(id) = name.strip_prefix("blobs/") else { continue };
        if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
            continue;
        }
        let dest = blobs_root.join(id);
        if dest.exists() {
            continue; // content-addressed: same id means identical bytes
        }
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&dest, &buf).map_err(|e| e.to_string())?;
        added += 1;
    }

    Ok(Incoming { manifest, state, blobs_added: added })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("nookstacks-nks-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("blobs")).unwrap();
        d
    }

    #[test]
    fn round_trip_carries_media_and_metadata() {
        let dir = tmpdir("round");
        std::fs::write(dir.join("blobs").join("abc123"), b"binary payload").unwrap();
        let state = json!({
            "levels": [{ "id": "eng", "name": "Engineering", "shelves": [
                { "id": "s1", "name": "STORMBREAKER", "docs": [
                    { "id": "o1", "kind": "image", "title": "shot.png", "blobId": "abc123" }
                ]}
            ]}]
        });
        let out = dir.join("board.nks");
        let w = write_nks(&dir.join("blobs"), &state, "board", "STORMBREAKER", &out).unwrap();
        assert_eq!(w.blobs, 1);
        assert!(w.bytes > 100);

        let other = tmpdir("round2");
        let back = read_nks(&other.join("blobs"), &out).unwrap();
        assert_eq!(back.manifest.scope, "board");
        assert_eq!(back.manifest.name, "STORMBREAKER");
        assert_eq!(back.manifest.format, FORMAT);
        assert_eq!(back.blobs_added, 1);
        assert_eq!(std::fs::read(other.join("blobs").join("abc123")).unwrap(), b"binary payload");
        assert_eq!(back.state["levels"][0]["shelves"][0]["name"], json!("STORMBREAKER"));
    }

    #[test]
    fn importing_twice_does_not_duplicate_blobs() {
        let dir = tmpdir("dup");
        std::fs::write(dir.join("blobs").join("k1"), b"x").unwrap();
        let state = json!({ "levels": [] , "docs": [{ "blobId": "k1" }] });
        let out = dir.join("b.nks");
        write_nks(&dir.join("blobs"), &state, "vault", "everything", &out).unwrap();
        let target = tmpdir("dup2");
        assert_eq!(read_nks(&target.join("blobs"), &out).unwrap().blobs_added, 1);
        assert_eq!(read_nks(&target.join("blobs"), &out).unwrap().blobs_added, 0);
    }

    #[test]
    fn rejects_a_file_that_is_not_a_bundle() {
        let dir = tmpdir("junk");
        let out = dir.join("junk.nks");
        std::fs::write(&out, b"this is not a zip").unwrap();
        assert!(read_nks(&dir.join("blobs"), &out).is_err());
    }

    #[test]
    fn blob_ids_cannot_escape_the_blob_directory() {
        let dir = tmpdir("trav");
        let state = json!({ "docs": [
            { "blobId": "../../evil" },
            { "blobId": "ok-id" }
        ]});
        std::fs::write(dir.join("blobs").join("ok-id"), b"y").unwrap();
        let out = dir.join("t.nks");
        let w = write_nks(&dir.join("blobs"), &state, "board", "x", &out).unwrap();
        assert_eq!(w.blobs, 1, "only the safe id should be packed");
    }
}
