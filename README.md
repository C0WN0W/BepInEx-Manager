# BepInEx Manager

A web-based (Electron) BepInEx plugin manager.

## Run

```powershell
npm install
npm start
```

## Build (Windows)

Package the app into a standalone executable using **electron-builder**.

```powershell
npm install
npm run dist:portable      # single-file portable exe (dist/BepInEx Manager-<ver>-portable.exe)
npm run dist:installer     # NSIS installer (dist/BepInEx Manager-<ver>-setup.exe)
npm run dist               # both of the above
npm run pack               # unpacked dir only (dist/win-unpacked), useful for debugging
```

Notes:
- On first build, electron-builder downloads `winCodeSign` which contains macOS symlinks. Standard Windows accounts cannot create symlinks, causing extraction to fail. If you hit this, pre-populate the cache:
  ```powershell
  $cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0"
  # download winCodeSign-2.6.0.7z manually from
  # https://github.com/electron-userland/electron-builder-binaries/releases
  # then extract WITHOUT the darwin/ folder into $cache
  ```
  Alternatively, enable Windows Developer Mode (Settings → For developers → Developer Mode) so non-admin users can create symlinks.
- The output is unsigned. Windows SmartScreen may warn on first run; click **More info → Run anyway**.
- To use a custom icon, drop a 256×256 `.ico` at `build/icon.ico` and add `"icon": "build/icon.ico"` under `build.win` in `package.json`.

---

### Pics

<img width="418" height="284" alt="image" src="https://github.com/user-attachments/assets/4aec6f4b-798c-4e20-a355-380217606118" />
<img width="418" height="284" alt="image" src="https://github.com/user-attachments/assets/9db0fba7-476f-44c1-9b70-7570b2cb1257" />

<img width="418" height="284" alt="image" src="https://github.com/user-attachments/assets/a0d0a6a6-01cc-45c8-a7fb-f00e8d123ecd" />
<img width="418" height="284" alt="image" src="https://github.com/user-attachments/assets/e1b2bd3a-d1cb-4d39-9c5b-d2434c323a64" />
