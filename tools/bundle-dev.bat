@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" -arch=amd64 -host_arch=amd64 >nul
cd /d C:\Users\mlope\nookstacks-build\nookstacks\src-tauri
set CARGO_TARGET_DIR=C:\Users\mlope\nookstacks-build\target-dev
set NOOKSTACKS_FLAVOUR=dev
"C:\Users\mlope\.cargo\bin\cargo-tauri.exe" build --bundles nsis --config tauri.dev.conf.json
echo EXITCODE=%ERRORLEVEL%
