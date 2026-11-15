# Knollstack

![Knollstack](docs/screenshot.png)

A tower of project bookshelves. Each category is a level, each level holds projects, each project is an infinite board where you place documents — notes, code, PDFs, images, video, 3D models — anywhere, at any size, and edit the text ones in place.

Local only. No account, no sync service, no telemetry. Your board is a directory on your disk that you can back up, copy between machines, or open with a text editor.

Windows and Linux.

## Install

Grab the installer for your system from [Releases](../../releases).

**Windows** — run `Knollstack_*_x64-setup.exe`. It installs per-user, so no administrator rights are needed. The `.msi` is there if you prefer MSI deployment.

**Linux** — take the `.AppImage`, make it executable, run it:

```bash
chmod +x Knollstack_*.AppImage
./Knollstack_*.AppImage
```

Or use the `.deb` / `.rpm` for your distribution's package manager. Both pull in `libwebkit2gtk-4.1`, which the app renders with.

## Where your data lives

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Knollstack\vault` |
| Linux | `~/.local/share/Knollstack/vault` |

Inside is the whole board:

```
state.json          every level, project, region and document
state.json.bak      the previous save
history/            rolling snapshots, the last 40 saves
blobs/              imported files, one file per import
```

Saves are atomic — written to a temp file, fsynced, then renamed — so an interrupted write can't corrupt `state.json`. Set `KNOLLSTACK_VAULT=/some/path` to keep the vault somewhere else, such as a synced folder.

## Using it

| | |
|---|---|
| `↑` `↓` | change level |
| `←` `→` | change project |
| `N` | new note where the cursor is |
| `G` | draw a region around things |
| double-click a note | edit it, click away to save |
| right-drag | pan the board |
| wheel | zoom; over a scrollable document or a model, it scrolls or zooms that instead |
| double-click a model | nothing — drag to orbit, wheel to zoom |

Regions get moved by their label, resized by their corner handles, renamed by double-clicking the label, and deleted with the ✕ inside it.

## Build from source

You need Rust 1.77 or newer. Then:

```bash
cd src-tauri
cargo build --release
```

On Linux you also need the WebKit headers:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
```

Installers:

```bash
cargo install tauri-cli --version "^2"
cd src-tauri && cargo tauri build
```

Output lands in `src-tauri/target/release/bundle/`. On Linux that's `deb/`, `rpm/` and `appimage/`; on Windows, `nsis/` and `msi/`. Each OS builds its own installers — CI does both in `.github/workflows/build.yml`, and pushing a `v*` tag publishes them to a draft release.

## How it's put together

The same web bundle runs in two shells:

```
web/                 the entire interface, plain ES modules, no build step
src-tauri/           the desktop shell: Rust, file system, installers
dev/server.py        a small HTTP server with the same API, for browser dev
```

`web/app.js` has one storage interface (`vault`) with two implementations. Inside the Tauri window it calls Rust over IPC; in a browser it calls `/api/*` on the dev server. Both write the identical on-disk format, so a vault is portable between the app and the dev server.

Three.js, the `.blend` parser and the Zstandard decoder are vendored under `web/vendor/`, so there is no `npm install` and no bundler anywhere in the build.

Working on the interface without rebuilding Rust:

```bash
python3 dev/server.py 8787   # then open http://localhost:8787
```

## License

MIT. See [LICENSE](LICENSE).
