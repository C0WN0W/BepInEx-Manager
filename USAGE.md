# BepInEx Manager — User Guide

This guide walks you through installing BepInEx on your Steam games, managing plugins, and importing plugins with BepInEx Manager.

---

## 1. Getting started

1. Double-click `BepInEx Manager-x.x.x-portable.exe` (or launch from the Start Menu if you used the installer).
2. On first run, the app scans Steam's install location and every library folder to build the game list.
3. The home screen shows a grid of game cards. Use the search box at the top to filter by name; the gear button in the top-right opens Settings (theme color).

> Prerequisite: Steam must be installed. The app locates game libraries via the Steam registry key and `libraryfolders.vdf`. Steam does not need to be logged in or running.

---

## 2. Installing BepInEx on a game

1. Click a game card on the home page to open its detail view.
2. The left panel shows the detected engine (Unity / Mono / IL2CPP / .NET version) and current BepInEx status.
3. If BepInEx is not installed, click **Install BepInEx**:
   - The app picks the correct BepInEx build automatically based on the detected architecture (x86 / x64, Mono / IL2CPP).
   - It downloads the matching archive from GitHub Releases with a live progress bar.
   - The archive is extracted into the game root directory.
4. When installation finishes, the status area shows the BepInEx version and the **Plugins** panel appears on the right.

> After installing BepInEx, **launch the game once** before managing plugins. The first launch creates `BepInEx/plugins/`, `BepInEx/config/`, and other required folders.

### Uninstalling BepInEx

Click **Uninstall BepInEx** on the detail view. After confirmation, the app removes all BepInEx files and directories, returning the game to its original state. This is irreversible — proceed carefully.

---

## 3. Managing installed plugins

The **Plugins** panel on the detail view lists every plugin the app recognizes in `BepInEx/plugins/`:

- **Name / GUID / Version** — parsed automatically from the DLL's `BepInPlugin` metadata.
- **Enable** — the highlighted state means the plugin is active. Disabling renames the file to `.dll.disabled` so BepInEx skips it at load time.
- **Disable** — renames `.dll` to `.dll.disabled`. The plugin is not loaded but the file is preserved.
- **Delete** — removes the file from disk. A confirmation dialog appears; the operation cannot be undone.

### Pagination

If the plugin count exceeds the visible area, pagination controls appear at the bottom. The page size is computed dynamically from the window height and re-flows automatically when the window is resized.

### Invalid files

DLLs in `plugins/` that are not BepInEx plugins (e.g. missing the `BepInPlugin` attribute) are flagged as **Invalid** in gray with a reason. BepInEx will not load these; you can safely delete them.

---

## 4. Importing plugins

The **Import Plugin** button at the bottom of the detail view accepts two file types.

### 4.1 Importing a single `.dll`

- After you pick a DLL, the app validates it:
  - Checks the PE header
  - Verifies it is a .NET assembly (CLR data directory present)
  - Looks for the `BepInPlugin` marker
- On success, the DLL is copied to the root of `BepInEx/plugins/`.
- If a file with the same name already exists, a numeric suffix is appended to avoid overwriting.
- On failure, the import is rejected with a specific reason (not a .NET assembly, missing marker, corrupt PE, etc.).

### 4.2 Importing a `.zip` archive

Many plugins ship as archives that contain multiple DLLs, dependencies, and config templates.

- The archive is extracted to a temporary directory, and every DLL inside is walked recursively.
- The archive is accepted if **at least one** valid BepInEx plugin is found. Other DLLs (dependencies, shared libraries) are kept as-is.
- Once accepted, the whole directory tree is copied to `BepInEx/plugins/<archive-name>/`.
- If the target directory already exists, a numeric suffix is appended.
- The temporary directory is cleaned up automatically when done.

### Import results

Whether the import succeeded or failed, a result dialog appears listing:
- Files that were copied
- Detected plugin GUIDs and versions
- Skipped or warned items (unrelated files, DLLs that failed validation)

The plugin list refreshes automatically — no restart needed.

---

## 5. Switching themes

Open Settings from the gear button on the home page:

- Seven Material 3 palettes are available: Sky Blue, Girly Pink, Sunset Orange, Forest Green, Midnight Black, Deep Indigo, Rose Red.
- Click a swatch to apply immediately. The choice is persisted to local storage and restored on the next launch.

---

## 6. Troubleshooting

**Q: My games are not showing up on the home page.**
A: The app scans only Steam-installed games; non-Steam versions are not detected automatically. If your Steam library is in an unusual location, verify that `%ProgramFiles(x86)%\Steam\steamapps\libraryfolders.vdf` lists the library path.

**Q: The game crashes after I install BepInEx.**
A: The most common cause is the wrong architecture. Auto-detection covers most cases, but for games with mixed architectures you may need to uninstall BepInEx, then download the correct build manually from the [official Releases](https://github.com/BepInEx/BepInEx/releases) and try again.

**Q: A plugin shows as "Invalid" but I'm sure it is a BepInEx plugin.**
A: A plugin built for BepInEx 5 will not load under BepInEx 6 (and vice versa). Check that the game's BepInEx major version matches what the plugin requires.

**Q: Windows Defender / SmartScreen blocks the exe on first run.**
A: The build is not code-signed, so SmartScreen warns you. Click **More info → Run anyway**. The source is open and you can audit or build it yourself.

**Q: Importing a zip fails with "no valid plugin found".**
A: None of the DLLs in the archive contain a `BepInPlugin` marker. The archive may only include resources or dependencies — download the actual plugin build.

---

## 7. Directory layout

The app never modifies system-wide paths. All plugin files are written under the target game's BepInEx directory:

```
<Steam game root>/
├── BepInEx/
│   ├── core/           BepInEx runtime
│   ├── plugins/        Plugins (managed by this tool)
│   │   ├── FooPlugin.dll
│   │   ├── BarPlugin.dll.disabled
│   │   └── SomeMod/    Directory-form plugin (from a zip import)
│   ├── config/         Plugin configuration
│   └── LogOutput.log   BepInEx runtime log
└── ...(original game files)
```
