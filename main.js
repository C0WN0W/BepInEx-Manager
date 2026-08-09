const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const https = require('https');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#181310',
    autoHideMenuBar: true,
    title: 'BepInEx Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// -------- Minimal VDF / ACF parser --------
function parseVDF(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length) {
          const n = text[j + 1];
          s += (n === 'n') ? '\n' : (n === 't') ? '\t' : n;
          j += 2;
        } else {
          s += text[j];
          j++;
        }
      }
      tokens.push({ type: 'str', value: s });
      i = j + 1;
    } else if (c === '{' || c === '}') {
      tokens.push({ type: c });
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else {
      i++;
    }
  }

  let pos = 0;
  function parseObject() {
    const obj = {};
    while (pos < tokens.length && tokens[pos].type !== '}') {
      if (tokens[pos].type !== 'str') { pos++; continue; }
      const key = tokens[pos].value;
      pos++;
      if (pos >= tokens.length) break;
      if (tokens[pos].type === '{') {
        pos++;
        obj[key] = parseObject();
        if (pos < tokens.length && tokens[pos].type === '}') pos++;
      } else if (tokens[pos].type === 'str') {
        obj[key] = tokens[pos].value;
        pos++;
      }
    }
    return obj;
  }
  return parseObject();
}

// -------- Locate Steam --------
function findSteamPath() {
  const tryReg = (hive, key, value) => {
    try {
      const out = execSync(`reg query "${hive}\\${key}" /v ${value}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const m = out.match(new RegExp(`${value}\\s+REG_SZ\\s+(.+)`));
      if (m) return m[1].trim().replace(/\//g, '\\');
    } catch (_) {}
    return null;
  };
  const candidates = [
    tryReg('HKCU', 'Software\\Valve\\Steam', 'SteamPath'),
    tryReg('HKLM', 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    tryReg('HKLM', 'SOFTWARE\\Valve\\Steam', 'InstallPath'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

// -------- Steam icon lookup --------
function findGameIcon(steamPath, appid) {
  const candidates = [
    // Newer client: appcache/librarycache/<appid>/*
    path.join(steamPath, 'appcache', 'librarycache', String(appid), 'icon.jpg'),
    path.join(steamPath, 'appcache', 'librarycache', String(appid), 'logo.png'),
    path.join(steamPath, 'appcache', 'librarycache', String(appid), 'header.jpg'),
    // Legacy flat layout
    path.join(steamPath, 'appcache', 'librarycache', `${appid}_icon.jpg`),
    path.join(steamPath, 'appcache', 'librarycache', `${appid}_logo.png`),
    path.join(steamPath, 'appcache', 'librarycache', `${appid}_header.jpg`),
    // Original client icons
    path.join(steamPath, 'steam', 'games', `${appid}.ico`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function iconToDataUrl(iconPath) {
  if (!iconPath) return null;
  try {
    const ext = path.extname(iconPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
              : ext === '.ico' ? 'image/x-icon'
              : 'image/jpeg';
    const b64 = fs.readFileSync(iconPath).toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch { return null; }
}

// -------- Custom (user-added) games store --------
function customStorePath() {
  return path.join(app.getPath('userData'), 'custom-games.json');
}
function readCustomGames() {
  try {
    const p = customStorePath();
    if (!fs.existsSync(p)) return [];
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeCustomGames(list) {
  try {
    fs.mkdirSync(path.dirname(customStorePath()), { recursive: true });
    fs.writeFileSync(customStorePath(), JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch { return false; }
}

// Try to find a Windows executable in the folder to use as an icon source.
function firstExeIn(dir) {
  try {
    const files = fs.readdirSync(dir);
    const exe = files.find(f => f.toLowerCase().endsWith('.exe'));
    return exe ? path.join(dir, exe) : null;
  } catch { return null; }
}

// -------- Scan installed games --------
ipcMain.handle('scan-games', async () => {
  const steamPath = findSteamPath();
  const custom = readCustomGames();

  if (!steamPath) {
    return { installed: false, steamGames: [], customGames: custom };
  }

  const libraryVdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (!fs.existsSync(libraryVdfPath)) {
    return {
      installed: true, steamPath, steamGames: [], customGames: custom,
      error: 'libraryfolders.vdf not found',
    };
  }

  const vdfText = fs.readFileSync(libraryVdfPath, 'utf8');
  const parsed = parseVDF(vdfText);
  const folders = parsed.libraryfolders || parsed.LibraryFolders || {};

  const libraryPaths = new Set();
  for (const key of Object.keys(folders)) {
    const entry = folders[key];
    if (entry && typeof entry === 'object' && entry.path) {
      libraryPaths.add(entry.path);
    } else if (typeof entry === 'string' && /^\d+$/.test(key)) {
      libraryPaths.add(entry);
    }
  }
  libraryPaths.add(steamPath);

  const steamGames = [];
  const seen = new Set();
  for (const libPath of libraryPaths) {
    const steamappsDir = path.join(libPath, 'steamapps');
    if (!fs.existsSync(steamappsDir)) continue;

    let files;
    try { files = fs.readdirSync(steamappsDir); } catch { continue; }

    for (const f of files) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
      try {
        const acfText = fs.readFileSync(path.join(steamappsDir, f), 'utf8');
        const acf = parseVDF(acfText);
        const state = acf.AppState || acf.appstate || {};
        const name = state.name;
        const installdir = state.installdir;
        const appid = state.appid || (f.match(/\d+/) || [''])[0];
        if (!name || !installdir) continue;
        if (seen.has(appid)) continue;
        seen.add(appid);
        const gamePath = path.join(libPath, 'steamapps', 'common', installdir);
        steamGames.push({
          appid: String(appid),
          name: String(name),
          installdir: String(installdir),
          path: gamePath,
          library: libPath,
          exists: fs.existsSync(gamePath),
          icon: iconToDataUrl(findGameIcon(steamPath, appid)),
          source: 'steam',
        });
      } catch (_) {}
    }
  }

  steamGames.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  // Refresh existence flag for custom entries every scan.
  for (const g of custom) g.exists = fs.existsSync(g.path);

  return { installed: true, steamPath, steamGames, customGames: custom };
});

// -------- Pick + add a custom game folder --------
ipcMain.handle('add-custom-game', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select game folder',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return { added: false };

  const folder = res.filePaths[0];
  const name = path.basename(folder);

  const list = readCustomGames();
  if (list.some(g => g.path.toLowerCase() === folder.toLowerCase())) {
    return { added: false, reason: 'duplicate', name };
  }

  const entry = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    path: folder,
    exists: true,
    source: 'custom',
    addedAt: new Date().toISOString(),
  };
  list.push(entry);
  writeCustomGames(list);
  return { added: true, entry };
});

// -------- Remove a custom game --------
ipcMain.handle('remove-custom-game', async (_e, id) => {
  const list = readCustomGames();
  const next = list.filter(g => g.id !== id);
  writeCustomGames(next);
  return { removed: list.length - next.length };
});

// -------- Detect engine (Mono / .NET / IL2CPP) --------
function detectEngine(gamePath) {
  if (!fs.existsSync(gamePath)) return { supported: false, label: 'Game folder missing' };
  let entries;
  try { entries = fs.readdirSync(gamePath, { withFileTypes: true }); }
  catch { return { supported: false, label: 'Cannot read folder' }; }
  const hasUnityPlayer = entries.some(e =>
    e.isFile() && e.name.toLowerCase() === 'unityplayer.dll');
  const dataDirs = entries.filter(e =>
    e.isDirectory() && /_Data$/i.test(e.name));
  if (!hasUnityPlayer && dataDirs.length === 0) {
    return { supported: false, label: 'Not a Unity / Mono game' };
  }
  for (const dd of dataDirs) {
    const p = path.join(gamePath, dd.name);
    if (fs.existsSync(path.join(p, 'Managed'))) {
      return { supported: true, engine: 'Unity', backend: 'Mono', label: 'Unity (Mono)' };
    }
    if (fs.existsSync(path.join(p, 'il2cpp_data'))) {
      return { supported: true, engine: 'Unity', backend: 'IL2CPP', label: 'Unity (IL2CPP)' };
    }
  }
  return { supported: true, engine: 'Unity', backend: 'Unknown', label: 'Unity (Unknown backend)' };
}

// -------- Read Windows PE file version via PowerShell --------
function readFileVersion(filePath) {
  try {
    const p = filePath.replace(/'/g, "''");
    const out = execSync(
      `powershell -NoProfile -Command "(Get-Item '${p}').VersionInfo.FileVersion"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return out || null;
  } catch { return null; }
}

// -------- Detect BepInEx --------
function detectBepInEx(gamePath) {
  const bepDir = path.join(gamePath, 'BepInEx');
  const winhttp = path.join(gamePath, 'winhttp.dll');
  const hasDir = fs.existsSync(bepDir);
  const hasProxy = fs.existsSync(winhttp);
  if (!hasDir && !hasProxy) return { installed: false };

  // Try each known core DLL and pick the first that returns a version.
  const coreCandidates = [
    path.join(bepDir, 'core', 'BepInEx.Core.dll'),
    path.join(bepDir, 'core', 'BepInEx.dll'),
  ];
  let version = null;
  let coreFile = null;
  for (const c of coreCandidates) {
    if (fs.existsSync(c)) {
      coreFile = c;
      version = readFileVersion(c);
      if (version) break;
    }
  }
  // Fallback: parse the header line in LogOutput.log
  if (!version) {
    const logFile = path.join(bepDir, 'LogOutput.log');
    if (fs.existsSync(logFile)) {
      try {
        const head = fs.readFileSync(logFile, 'utf8').slice(0, 2048);
        const m = head.match(/BepInEx\s+v?(\d+\.\d+(?:\.\d+)?(?:[-.\w]+)?)/i);
        if (m) version = m[1];
      } catch {}
    }
  }
  // BepInEx creates plugins/ + LogOutput.log on first run.
  // A fresh install has only core/ + winhttp.dll and needs the game launched once.
  const pluginsDir = path.join(bepDir, 'plugins');
  const logFile    = path.join(bepDir, 'LogOutput.log');
  const initialized = fs.existsSync(logFile) || fs.existsSync(pluginsDir);
  return {
    installed: true,
    initialized,
    version: version || null,
    hasProxy,
    hasDir,
    coreFile: coreFile || null,
  };
}

// -------- Find primary game executable & detect PE arch --------
function findGameExe(gamePath) {
  try {
    const entries = fs.readdirSync(gamePath, { withFileTypes: true });
    const dataDir = entries.find(e => e.isDirectory() && /_Data$/i.test(e.name));
    const stem = dataDir ? dataDir.name.replace(/_Data$/i, '').toLowerCase() : null;
    const exes = entries
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
      .filter(e => !/UnityCrashHandler|CrashReporter|UnityPlayer/i.test(e.name));
    if (stem) {
      const match = exes.find(e => e.name.toLowerCase() === `${stem}.exe`);
      if (match) return path.join(gamePath, match.name);
    }
    return exes[0] ? path.join(gamePath, exes[0].name) : null;
  } catch { return null; }
}

function detectPEArch(exePath) {
  try {
    const fd = fs.openSync(exePath, 'r');
    const buf = Buffer.alloc(4096);
    fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const peOffset = buf.readUInt32LE(0x3C);
    if (peOffset + 6 > buf.length) return null;
    if (buf.readUInt32LE(peOffset) !== 0x00004550) return null; // 'PE\0\0'
    const machine = buf.readUInt16LE(peOffset + 4);
    if (machine === 0x8664) return 'x64';
    if (machine === 0x014c) return 'x86';
    return null;
  } catch { return null; }
}

// -------- Inspect a single game --------
ipcMain.handle('inspect-game', async (_e, gamePath) => {
  if (!gamePath || typeof gamePath !== 'string') {
    return { ok: false, error: 'Invalid path' };
  }
  const exists = fs.existsSync(gamePath);
  if (!exists) return { ok: true, exists: false };
  const engine  = detectEngine(gamePath);
  const bepinex = engine.supported ? detectBepInEx(gamePath) : { installed: false };
  const arch    = engine.supported ? detectPEArch(findGameExe(gamePath) || '') : null;
  return { ok: true, exists: true, engine, bepinex, arch };
});

// -------- HTTPS helpers (JSON + streaming download) --------
function httpsGetJson(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Too many redirects'));
    https.get(url, {
      headers: {
        'User-Agent': 'BepInEx-Manager',
        'Accept': 'application/vnd.github+json',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpsGetJson(res.headers.location, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

function classifyAsset(name) {
  const arch =
    /(?:^|[^0-9a-z])x64(?:[^0-9a-z]|$)|amd64|win64/i.test(name) ? 'x64' :
    /(?:^|[^0-9a-z])x86(?:[^0-9a-z]|$)|x32|win32/i.test(name)   ? 'x86' :
    'unknown';
  const variant =
    /il2cpp/i.test(name) ? 'IL2CPP' :
    /nunit|mono/i.test(name) ? 'Mono' :
    'default';
  return { arch, variant };
}

// -------- Fetch releases from BepInEx repo --------
ipcMain.handle('fetch-releases', async () => {
  try {
    const raw = await httpsGetJson(
      'https://api.github.com/repos/BepInEx/BepInEx/releases?per_page=30'
    );
    const releases = raw.map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      prerelease: !!r.prerelease,
      publishedAt: r.published_at,
      htmlUrl: r.html_url,
      assets: (r.assets || [])
        .filter((a) => /\.zip$/i.test(a.name))
        .filter((a) => !/(?:unix|linux|osx|mac|nix)/i.test(a.name))
        .map((a) => ({
          name: a.name,
          url: a.browser_download_url,
          size: a.size,
          ...classifyAsset(a.name),
        })),
    })).filter((r) => r.assets.length > 0);
    return { ok: true, releases };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// -------- Download a file with progress callbacks --------
function downloadFile(url, dest, onProgress, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));
    const req = require('https').get(url, {
      headers: { 'User-Agent': 'BepInEx-Manager', 'Accept': '*/*' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, dest, onProgress, maxRedirects - 1)
          .then(resolve, reject);
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        onProgress({ received, total, percent: total ? received / total : 0 });
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve({ received, total })));
      file.on('error', (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
    });
    req.on('error', reject);
  });
}

// Extract a .zip archive to a directory using PowerShell's Expand-Archive.
function extractZip(zipPath, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const zp = zipPath.replace(/'/g, "''");
  const dp = dest.replace(/'/g, "''");
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zp}' -DestinationPath '${dp}' -Force"`,
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

// -------- Uninstall BepInEx from a game folder --------
// Only removes files/folders that BepInEx itself creates. Anything the user
// dropped in (plugins, configs) lives under BepInEx/ and goes with it.
ipcMain.handle('uninstall-bepinex', async (_e, gamePath) => {
  if (!gamePath || typeof gamePath !== 'string') {
    return { ok: false, error: 'Invalid path' };
  }
  if (!fs.existsSync(gamePath)) {
    return { ok: false, error: 'Game folder does not exist' };
  }
  const targets = [
    { p: path.join(gamePath, 'BepInEx'),             kind: 'dir'  },
    { p: path.join(gamePath, 'dotnet'),              kind: 'dir'  },
    { p: path.join(gamePath, 'winhttp.dll'),         kind: 'file' },
    { p: path.join(gamePath, 'doorstop_config.ini'), kind: 'file' },
    { p: path.join(gamePath, '.doorstop_version'),   kind: 'file' },
    { p: path.join(gamePath, 'changelog.txt'),       kind: 'file' },
  ];
  const removed = [];
  const failed  = [];
  for (const t of targets) {
    if (!fs.existsSync(t.p)) continue;
    try {
      if (t.kind === 'dir') fs.rmSync(t.p, { recursive: true, force: true });
      else                  fs.rmSync(t.p, { force: true });
      removed.push(path.basename(t.p));
    } catch (e) {
      failed.push({ name: path.basename(t.p), error: e.message });
    }
  }
  if (failed.length && removed.length === 0) {
    return { ok: false, error: failed.map(f => `${f.name}: ${f.error}`).join('; ') };
  }
  return { ok: true, removed, failed };
});

// -------- Install BepInEx into a game folder --------
ipcMain.handle('install-bepinex', async (_e, args) => {
  const { gamePath, url, fileName } = args || {};
  const send = (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('install-progress', msg);
    }
  };
  if (!gamePath || !url) return { ok: false, error: 'Missing gamePath or url' };
  if (!fs.existsSync(gamePath)) return { ok: false, error: 'Game folder does not exist' };

  const tmpDir  = app.getPath('temp');
  const zipPath = path.join(tmpDir, fileName || `bepinex-${Date.now()}.zip`);

  try {
    send({ phase: 'download', percent: 0, received: 0, total: 0 });
    await downloadFile(url, zipPath, (p) => send({ phase: 'download', ...p }));
    send({ phase: 'extract', percent: 1 });
    extractZip(zipPath, gamePath);
    try { fs.unlinkSync(zipPath); } catch {}
    send({ phase: 'done', percent: 1 });
    return { ok: true };
  } catch (e) {
    try { fs.unlinkSync(zipPath); } catch {}
    send({ phase: 'error', message: e.message || String(e) });
    return { ok: false, error: e.message || String(e) };
  }
});

// -------- Plugin scanning: PE header + .NET check + BepInPlugin marker --------
function isValidBepInExPlugin(dllPath) {
  try {
    const stat = fs.statSync(dllPath);
    if (stat.size < 512) return { valid: false, reason: 'File too small' };
    const scanSize = Math.min(stat.size, 2 * 1024 * 1024);
    const buf = Buffer.alloc(scanSize);
    const fd = fs.openSync(dllPath, 'r');
    try { fs.readSync(fd, buf, 0, scanSize, 0); }
    finally { fs.closeSync(fd); }

    if (buf[0] !== 0x4D || buf[1] !== 0x5A) {
      return { valid: false, reason: 'Not a PE file' };
    }
    const peOff = buf.readUInt32LE(0x3C);
    if (peOff + 24 > buf.length ||
        buf.readUInt32LE(peOff) !== 0x00004550) {
      return { valid: false, reason: 'Not a PE file' };
    }
    const optOff = peOff + 24;
    if (optOff + 96 > buf.length) {
      return { valid: false, reason: 'Truncated PE header' };
    }
    const isPE32Plus = buf.readUInt16LE(optOff) === 0x20B;
    const numDD = buf.readUInt32LE(optOff + (isPE32Plus ? 108 : 92));
    if (numDD < 15) return { valid: false, reason: 'Native DLL (not .NET)' };
    const ddBase = optOff + (isPE32Plus ? 112 : 96);
    if (buf.readUInt32LE(ddBase + 14 * 8) === 0) {
      return { valid: false, reason: 'Native DLL (not .NET)' };
    }
    const isBepIn = buf.indexOf('BepInPlugin', 0, 'utf8') !== -1;
    return { valid: isBepIn, isDotNet: true,
             reason: isBepIn ? null : 'Not a BepInEx plugin' };
  } catch (e) {
    return { valid: false, reason: e.message || String(e) };
  }
}

function walkForPlugins(root) {
  const results = [];
  const walk = (dir, relPrefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel  = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(full, rel); continue; }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      const isDll      = lower.endsWith('.dll');
      const isDisabled = lower.endsWith('.dll.disabled');
      if (!isDll && !isDisabled) continue;
      results.push({
        fullPath: full,
        relativePath: rel,
        fileName: e.name,
        enabled: isDll,
        baseName: isDisabled
          ? e.name.slice(0, -'.dll.disabled'.length)
          : e.name.slice(0, -'.dll'.length),
      });
    }
  };
  walk(root, '');
  return results;
}

// -------- Scan plugins in BepInEx/plugins (recursive) --------
ipcMain.handle('scan-plugins', async (_e, gamePath) => {
  if (!gamePath || typeof gamePath !== 'string')
    return { ok: false, error: 'Invalid path' };
  const pluginsDir = path.join(gamePath, 'BepInEx', 'plugins');
  if (!fs.existsSync(pluginsDir))
    return { ok: true, plugins: [], noPluginsDir: true };

  const files = walkForPlugins(pluginsDir);
  const plugins = files.map(f => {
    const info = isValidBepInExPlugin(f.fullPath);
    return {
      name: f.baseName,
      fileName: f.fileName,
      path: f.fullPath,
      relativePath: f.relativePath,
      enabled: f.enabled,
      valid: !!info.valid,
      isDotNet: !!info.isDotNet,
      reason: info.valid ? null : (info.reason || 'Invalid'),
    };
  });
  plugins.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return { ok: true, plugins };
});

// -------- Toggle plugin: .dll <-> .dll.disabled --------
ipcMain.handle('toggle-plugin', async (_e, filePath) => {
  if (!filePath || typeof filePath !== 'string')
    return { ok: false, error: 'Invalid path' };
  if (!fs.existsSync(filePath)) return { ok: false, error: 'File not found' };
  try {
    const lower = filePath.toLowerCase();
    let newPath;
    if (lower.endsWith('.dll.disabled')) {
      newPath = filePath.slice(0, -'.disabled'.length);
    } else if (lower.endsWith('.dll')) {
      newPath = filePath + '.disabled';
    } else {
      return { ok: false, error: 'Not a plugin file' };
    }
    if (fs.existsSync(newPath))
      return { ok: false, error: 'Target file already exists' };
    fs.renameSync(filePath, newPath);
    return { ok: true, newPath };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// -------- Delete a plugin file --------
ipcMain.handle('delete-plugin', async (_e, filePath) => {
  if (!filePath || typeof filePath !== 'string')
    return { ok: false, error: 'Invalid path' };
  if (!fs.existsSync(filePath)) return { ok: true };
  try {
    fs.unlinkSync(filePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// -------- Import plugin: pick a .dll or .zip and install into BepInEx/plugins --------
// Copy a file, refusing to overwrite unless the caller says so.
function copyUnique(src, destDir, fileName) {
  fs.mkdirSync(destDir, { recursive: true });
  let target = path.join(destDir, fileName);
  if (fs.existsSync(target)) {
    const ext  = path.extname(fileName);
    const stem = fileName.slice(0, fileName.length - ext.length);
    let i = 1;
    while (fs.existsSync(target)) {
      target = path.join(destDir, `${stem} (${i})${ext}`);
      i++;
    }
  }
  fs.copyFileSync(src, target);
  return target;
}

// Recursively walk a directory returning every .dll file (extracted archive).
function walkAllDlls(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (e.isFile() && e.name.toLowerCase().endsWith('.dll')) out.push(full);
    }
  };
  walk(root);
  return out;
}

// Recursive copy of a directory tree (all files, preserving structure).
function copyDirTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src,  e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDirTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

ipcMain.handle('import-plugin', async (_e, gamePath) => {
  if (!gamePath || typeof gamePath !== 'string')
    return { ok: false, error: 'Invalid game path' };

  const pluginsDir = path.join(gamePath, 'BepInEx', 'plugins');
  if (!fs.existsSync(path.join(gamePath, 'BepInEx')))
    return { ok: false, error: 'BepInEx is not installed for this game' };
  fs.mkdirSync(pluginsDir, { recursive: true });

  const pick = await dialog.showOpenDialog(mainWindow, {
    title: 'Import plugin',
    properties: ['openFile'],
    filters: [
      { name: 'Plugin files', extensions: ['dll', 'zip'] },
      { name: 'BepInEx plugin (.dll)', extensions: ['dll'] },
      { name: 'Zip archive (.zip)',    extensions: ['zip'] },
    ],
  });
  if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };

  const srcPath = pick.filePaths[0];
  const lower   = srcPath.toLowerCase();
  const imported = [];
  const skipped  = [];

  try {
    if (lower.endsWith('.dll')) {
      // Single-file import: validate then copy.
      const check = isValidBepInExPlugin(srcPath);
      if (!check.valid) {
        return {
          ok: false,
          error: `Not a valid BepInEx plugin: ${check.reason || 'unknown'}`,
        };
      }
      const target = copyUnique(srcPath, pluginsDir, path.basename(srcPath));
      imported.push({ name: path.basename(target), path: target });
      return { ok: true, imported, skipped };
    }

    if (lower.endsWith('.zip')) {
      // Extract into a temp dir first so we can validate before installing.
      const tmpRoot = path.join(
        app.getPath('temp'),
        `bepin-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      try {
        extractZip(srcPath, tmpRoot);
      } catch (e) {
        return { ok: false, error: `Failed to extract zip: ${e.message || e}` };
      }

      // Any .dll inside must be a valid BepInEx plugin. We collect at least one
      // valid entry, and reject the whole archive if it contains a non-plugin DLL.
      const dlls = walkAllDlls(tmpRoot);
      if (dlls.length === 0) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        return { ok: false, error: 'Archive contains no .dll files' };
      }

      let hasValid = false;
      const invalidNames = [];
      for (const dll of dlls) {
        const check = isValidBepInExPlugin(dll);
        if (check.valid) hasValid = true;
        else invalidNames.push(`${path.basename(dll)} — ${check.reason || 'invalid'}`);
      }
      if (!hasValid) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        return {
          ok: false,
          error: 'Archive does not contain any valid BepInEx plugin',
          details: invalidNames,
        };
      }

      // Install: place archive contents under plugins/<archiveStem>/, avoiding
      // overwrites by suffixing (2), (3), etc.
      const stem = path.basename(srcPath, path.extname(srcPath));
      let destDir = path.join(pluginsDir, stem);
      let i = 1;
      while (fs.existsSync(destDir)) {
        destDir = path.join(pluginsDir, `${stem} (${i})`);
        i++;
      }

      try {
        copyDirTree(tmpRoot, destDir);
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }

      for (const dll of walkAllDlls(destDir))
        imported.push({ name: path.basename(dll), path: dll });
      for (const n of invalidNames) skipped.push(n);

      return { ok: true, imported, skipped, destDir };
    }

    return { ok: false, error: 'Unsupported file type (only .dll and .zip)' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});
