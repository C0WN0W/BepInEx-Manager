// ============================================================
// BepInEx Manager - Renderer
// ============================================================

const views = {
  home:   document.getElementById('view-home'),
  games:  document.getElementById('view-games'),
  detail: document.getElementById('view-detail'),
};

const startBtn      = document.getElementById('start-btn');
const backBtn       = document.getElementById('back-btn');
const refreshBtn    = document.getElementById('refresh-btn');
const gamesContent  = document.getElementById('games-content');
const gamesCount    = document.getElementById('games-count');
const detailBackBtn = document.getElementById('detail-back-btn');
const detailTitle   = document.getElementById('detail-title');
const detailLeft    = document.getElementById('detail-left');
const detailRight   = document.getElementById('detail-right');

function showView(name) {
  Object.values(views).forEach(v => {
    v.classList.remove('active', 'leaving', 'entering');
  });
  views[name].classList.add('active');
}

// Fade the current view out, then swap. Returns a promise for chaining.
function transitionTo(fromName, toName) {
  return new Promise(resolve => {
    const from = views[fromName];
    if (!from || !from.classList.contains('active')) {
      showView(toName);
      resolve();
      return;
    }
    from.classList.add('leaving');
    setTimeout(() => {
      showView(toName);
      resolve();
    }, 240);
  });
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function renderState({ icon, title, message }) {
  gamesContent.innerHTML = '';
  const wrap = el('div', 'state');
  const i = el('i', `fa-solid ${icon}`);
  wrap.appendChild(i);
  if (title)   wrap.appendChild(el('div', 'state-title', title));
  if (message) wrap.appendChild(el('div', 'state-msg', message));
  gamesContent.appendChild(wrap);
}

function makeGameItem(g) {
  const item = el('div', 'game-item');
  item.dataset.source = g.source;
  if (g.id)    item.dataset.id    = g.id;
  if (g.appid) item.dataset.appid = g.appid;

  // Icon
  const iconWrap = el('div', 'game-icon');
  if (g.icon) {
    const img = document.createElement('img');
    img.src = g.icon;
    img.alt = '';
    img.onerror = () => {
      iconWrap.innerHTML = '<i class="fa-solid fa-gamepad"></i>';
    };
    iconWrap.appendChild(img);
  } else {
    const fa = g.source === 'custom' ? 'fa-folder' : 'fa-gamepad';
    iconWrap.innerHTML = `<i class="fa-solid ${fa}"></i>`;
  }
  item.appendChild(iconWrap);

  // Info
  const info = el('div', 'game-info');
  info.appendChild(el('div', 'game-name', g.name));
  info.appendChild(el('div', 'game-path', g.path));
  item.appendChild(info);

  // Meta
  const meta = el('div', 'game-meta');
  if (g.source === 'steam' && g.appid) {
    meta.appendChild(el('span', 'game-appid', g.appid));
  } else if (g.source === 'custom') {
    meta.appendChild(el('span', 'game-tag', 'CUSTOM'));
  }
  if (g.exists === false) {
    meta.appendChild(el('span', 'badge-missing', 'MISSING'));
  }
  item.appendChild(meta);

  // Custom-only: remove button
  if (g.source === 'custom') {
    const rm = el('button', 'btn btn-icon btn-remove');
    rm.title = 'Remove from list';
    rm.type = 'button';
    rm.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    rm.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      await window.api.removeCustomGame(g.id);
      loadGames();
    });
    item.appendChild(rm);
  }

  // Click item -> open detail (ignore clicks that came from inner buttons)
  item.addEventListener('click', (ev) => {
    if (ev.defaultPrevented) return;
    if (ev.target.closest('button')) return;
    openDetail(g);
  });

  return item;
}

// Kept so filtering can re-render without a full rescan.
let currentGames = { steam: [], custom: [] };
let currentSearch = '';

function renderGames(steamGames, customGames, opts) {
  currentGames = { steam: steamGames || [], custom: customGames || [] };
  gamesContent.innerHTML = '';

  const wrap = el('div', 'games-wrap');

  if (opts && opts.steamMissing) {
    const notice = el('div', 'state state-inline');
    notice.appendChild(Object.assign(document.createElement('i'), {
      className: 'fa-solid fa-triangle-exclamation',
    }));
    notice.appendChild(el('div', 'state-title', 'Steam not detected'));
    notice.appendChild(el('div', 'state-msg',
      'You can still add games manually below.'));
    wrap.appendChild(notice);
  }

  // Hint row (always visible so users can add even without Steam)
  const hint = el('div', 'add-hint');
  hint.appendChild(el('span', null, "Can't find your game? "));
  const link = el('button', 'link-btn', 'Click here to add!');
  link.type = 'button';
  link.addEventListener('click', addCustomGame);
  hint.appendChild(link);
  wrap.appendChild(hint);

  const total = currentGames.steam.length + currentGames.custom.length;
  if (total === 0) {
    const empty = el('div', 'state state-inline');
    empty.appendChild(Object.assign(document.createElement('i'), {
      className: 'fa-solid fa-folder-open',
    }));
    empty.appendChild(el('div', 'state-title', 'No games yet'));
    empty.appendChild(el('div', 'state-msg',
      'Add a game folder using the link above.'));
    wrap.appendChild(empty);
    gamesContent.appendChild(wrap);
    return;
  }

  wrap.appendChild(makeSearchBar());

  const list = el('div', 'game-list');
  list.id = 'games-list-inner';
  wrap.appendChild(list);

  gamesContent.appendChild(wrap);
  applyGamesFilter();
}

function makeSearchBar() {
  const bar = el('div', 'games-search');
  bar.innerHTML =
    '<i class="fa-solid fa-magnifying-glass search-icon"></i>' +
    '<input type="text" class="search-input" placeholder="Search games..." spellcheck="false" autocomplete="off">' +
    '<button class="btn btn-icon search-clear" type="button" title="Clear" hidden>' +
      '<i class="fa-solid fa-xmark"></i>' +
    '</button>';

  const input = bar.querySelector('.search-input');
  const clear = bar.querySelector('.search-clear');

  input.value = currentSearch;
  clear.hidden = !currentSearch;

  input.addEventListener('input', () => {
    currentSearch = input.value;
    clear.hidden = !currentSearch;
    applyGamesFilter();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    currentSearch = '';
    clear.hidden = true;
    applyGamesFilter();
    input.focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentSearch) {
      input.value = '';
      currentSearch = '';
      clear.hidden = true;
      applyGamesFilter();
    }
  });

  return bar;
}

function applyGamesFilter() {
  const list = document.getElementById('games-list-inner');
  if (!list) return;

  const q = currentSearch.trim().toLowerCase();
  const all = [...currentGames.steam, ...currentGames.custom];
  const matched = q
    ? all.filter(g =>
        (g.name  || '').toLowerCase().includes(q) ||
        (g.path  || '').toLowerCase().includes(q))
    : all;

  list.innerHTML = '';

  // Update chip count to reflect filter state.
  const total = all.length;
  gamesCount.textContent = q
    ? `${matched.length} / ${total}`
    : String(total);

  if (matched.length === 0) {
    const empty = el('div', 'state state-inline');
    empty.appendChild(Object.assign(document.createElement('i'), {
      className: 'fa-solid fa-magnifying-glass',
    }));
    empty.appendChild(el('div', 'state-title', 'No matches'));
    const msg = el('div', 'state-msg', '');
    msg.textContent = `No games match "${currentSearch}".`;
    empty.appendChild(msg);
    list.appendChild(empty);
    return;
  }

  for (const g of matched) list.appendChild(makeGameItem(g));
}

async function addCustomGame() {
  try {
    const res = await window.api.addCustomGame();
    if (res.added) {
      loadGames();
    } else if (res.reason === 'duplicate') {
      // Silent for now; could show a toast later.
      console.info('Already in list:', res.name);
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadGames() {
  gamesCount.textContent = '';
  renderState({ icon: 'fa-spinner fa-spin', title: 'Scanning Steam library...' });

  try {
    const result = await window.api.scanGames();

    const steam  = result.steamGames  || [];
    const custom = result.customGames || [];
    gamesCount.textContent = String(steam.length + custom.length);
    renderGames(steam, custom, { steamMissing: !result.installed });
  } catch (e) {
    renderState({
      icon: 'fa-circle-exclamation',
      title: 'Scan failed',
      message: e.message || String(e),
    });
  }
}

// ============================================================
// Detail view: fade out list -> slide in left + right panels
// ============================================================

function fadeOutGamesThen(cb) {
  const wrap = gamesContent.firstElementChild;
  if (!wrap) { cb(); return; }
  wrap.classList.add('is-leaving');
  setTimeout(cb, 220);
}

function openDetail(game) {
  fadeOutGamesThen(() => {
    renderDetailShell(game);
    showView('detail');
    // Trigger the enter animations on the next frame so the initial
    // (offscreen) state has been committed.
    requestAnimationFrame(() => {
      detailLeft.classList.add('enter');
      // Right panel enters slightly after -> reveals when inspection resolves
      inspectAndRenderRight(game);
    });
  });
}

function closeDetail() {
  detailLeft.classList.remove('enter');
  detailRight.classList.remove('enter');
  showView('games');
  // Rebuild the list wrapper without the "leaving" class
  const wrap = gamesContent.firstElementChild;
  if (wrap) wrap.classList.remove('is-leaving');
}

function renderDetailShell(g) {
  // ----- Left panel: game info -----
  detailLeft.innerHTML = '';
  detailLeft.className = 'detail-panel detail-left';

  const header = el('div', 'detail-header');
  const bigIcon = el('div', 'detail-icon');
  if (g.icon) {
    const img = document.createElement('img');
    img.src = g.icon;
    img.alt = '';
    img.onerror = () => { bigIcon.innerHTML = '<i class="fa-solid fa-gamepad"></i>'; };
    bigIcon.appendChild(img);
  } else {
    const fa = g.source === 'custom' ? 'fa-folder' : 'fa-gamepad';
    bigIcon.innerHTML = `<i class="fa-solid ${fa}"></i>`;
  }
  header.appendChild(bigIcon);

  const meta = el('div', 'detail-meta');
  meta.appendChild(el('h3', 'detail-name', g.name));
  meta.appendChild(el('div', 'detail-path', g.path));
  const tags = el('div', 'detail-tags');
  if (g.source === 'steam' && g.appid) tags.appendChild(el('span', 'game-appid', g.appid));
  else if (g.source === 'custom')      tags.appendChild(el('span', 'game-tag', 'CUSTOM'));
  meta.appendChild(tags);
  header.appendChild(meta);
  detailLeft.appendChild(header);

  const rows = el('div', 'detail-rows');
  rows.appendChild(makeRow('engine',  'Engine',  'Detecting...',       'loading'));
  rows.appendChild(makeRow('bepinex', 'BepInEx', 'Waiting for engine...', 'loading'));
  detailLeft.appendChild(rows);

  // ----- Right panel: shell only, populated after inspection -----
  detailRight.innerHTML = '';
  detailRight.className = 'detail-panel detail-right';
  detailRight.appendChild(el('div', 'detail-actions-header', 'ACTIONS'));
  const spinner = el('div', 'detail-loading');
  spinner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Inspecting game...</span>';
  detailRight.appendChild(spinner);
}

function makeRow(id, label, value, statusClass) {
  const row = el('div', 'detail-row');
  row.dataset.rowId = id;
  row.appendChild(el('div', 'detail-row-label', label));
  const v = el('div', `detail-row-value status-${statusClass}`, value);
  row.appendChild(v);
  return row;
}

function setRow(id, value, statusClass, iconClass) {
  const row = detailLeft.querySelector(`[data-row-id="${id}"]`);
  if (!row) return;
  const v = row.querySelector('.detail-row-value');
  v.className = `detail-row-value status-${statusClass}`;
  v.innerHTML = '';
  if (iconClass) {
    const i = document.createElement('i');
    i.className = `fa-solid ${iconClass}`;
    v.appendChild(i);
  }
  v.appendChild(document.createTextNode(value));
}

async function inspectAndRenderRight(g) {
  let result;
  try {
    result = await window.api.inspectGame(g.path);
  } catch (e) {
    result = { ok: false, error: e.message || String(e) };
  }

  // Fill left rows first
  if (!result.ok) {
    setRow('engine',  'Inspection failed', 'error', 'fa-circle-exclamation');
    setRow('bepinex', result.error || 'Unknown error', 'error', 'fa-circle-exclamation');
  } else if (!result.exists) {
    setRow('engine',  'Game folder is missing', 'error', 'fa-triangle-exclamation');
    setRow('bepinex', 'N/A', 'muted', 'fa-minus');
  } else {
    const eng = result.engine || {};
    if (eng.supported) {
      setRow('engine', eng.label || 'Supported', 'ok', 'fa-check-circle');
    } else {
      setRow('engine', eng.label || 'Not supported', 'error', 'fa-circle-xmark');
    }
    const bep = result.bepinex || { installed: false };
    if (!eng.supported) {
      setRow('bepinex', 'Not applicable', 'muted', 'fa-minus');
    } else if (bep.installed) {
      const v = bep.version ? `v${bep.version}` : 'Installed';
      if (bep.initialized) {
        setRow('bepinex', v, 'ok', 'fa-check-circle');
      } else {
        setRow('bepinex', `${v} (not initialized)`, 'warn', 'fa-triangle-exclamation');
      }
    } else {
      setRow('bepinex', 'Not installed', 'warn', 'fa-circle-info');
    }
  }

  renderDetailRight(g, result);
  requestAnimationFrame(() => detailRight.classList.add('enter'));
}

function renderDetailRight(g, result) {
  detailRight.innerHTML = '';
  detailRight.appendChild(el('div', 'detail-actions-header', 'ACTIONS'));

  const eng = result?.engine;
  const bep = result?.bepinex;

  if (!result?.ok || !result?.exists) {
    const box = el('div', 'action-box action-error');
    box.innerHTML = `
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div class="action-title">Cannot inspect this game</div>
      <div class="action-desc">${result?.error || 'The game folder was not found.'}</div>
    `;
    detailRight.appendChild(box);
    return;
  }

  if (!eng?.supported) {
    const box = el('div', 'action-box action-error');
    box.innerHTML = `
      <i class="fa-solid fa-ban"></i>
      <div class="action-title">Not compatible with BepInEx</div>
      <div class="action-desc">
        BepInEx requires a game running on a Mono / .NET runtime
        (typically a Unity game with the Mono scripting backend).
        This game was detected as: <strong></strong>.
      </div>
    `;
    box.querySelector('strong').textContent = eng.label || 'unsupported';
    detailRight.appendChild(box);
    return;
  }

  if (bep?.installed && bep.initialized) {
    const box = el('div', 'action-box');
    box.innerHTML = `
      <i class="fa-solid fa-plug-circle-check status-ok-icon"></i>
      <div class="action-title">BepInEx is installed</div>
      <div class="action-desc">Version: <strong></strong></div>
    `;
    box.querySelector('strong').textContent = bep.version ? `v${bep.version}` : 'unknown';
    detailRight.appendChild(box);

    const btn = el('button', 'btn btn-filled btn-wide');
    btn.type = 'button';
    btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><span>SCAN PLUGINS</span>';
    btn.addEventListener('click', () => scanAndShowPlugins(g));
    detailRight.appendChild(btn);
    appendUninstallButton(g);
  } else if (bep?.installed && !bep.initialized) {
    // Installed on disk but the game has never launched with the proxy loaded,
    // so BepInEx has not created its plugins/config/patchers structure yet.
    const box = el('div', 'action-box action-warn');
    box.innerHTML = `
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div class="action-title">BepInEx is not initialized</div>
      <div class="action-desc">
        The loader is present but has never run. Launch the game once
        so BepInEx can create the <code>plugins/</code>, <code>config/</code>
        and <code>patchers/</code> folders, then come back and refresh.
      </div>
    `;
    detailRight.appendChild(box);

    const btn = el('button', 'btn btn-filled btn-wide');
    btn.type = 'button';
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i><span>REFRESH</span>';
    btn.addEventListener('click', () => refreshDetail(g));
    detailRight.appendChild(btn);
    appendUninstallButton(g);
  } else {
    const box = el('div', 'action-box');
    box.innerHTML = `
      <i class="fa-solid fa-plug-circle-xmark status-warn-icon"></i>
      <div class="action-title">BepInEx is not installed</div>
      <div class="action-desc">Install BepInEx to enable plugin loading for this game.</div>
    `;
    detailRight.appendChild(box);

    const btn = el('button', 'btn btn-filled btn-wide');
    btn.type = 'button';
    btn.innerHTML = '<i class="fa-solid fa-download"></i><span>INSTALL BEPINEX</span>';
    btn.addEventListener('click', () => showVersionSelector(g, result));
    detailRight.appendChild(btn);
  }
}

// ============================================================
// Version selector / install flow
// ============================================================

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function refreshDetail(g) {
  // Reset left rows to loading
  setRow('engine',  'Detecting...',          'loading', 'fa-spinner fa-spin');
  setRow('bepinex', 'Waiting for engine...', 'loading', 'fa-spinner fa-spin');
  // Reset right to a fresh inspection
  detailRight.innerHTML = '';
  detailRight.appendChild(el('div', 'detail-actions-header', 'ACTIONS'));
  const spin = el('div', 'detail-loading');
  spin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Rescanning...</span>';
  detailRight.appendChild(spin);
  inspectAndRenderRight(g);
}

async function showVersionSelector(g, inspectResult) {
  detailRight.innerHTML = '';
  detailRight.appendChild(el('div', 'detail-actions-header', 'SELECT VERSION'));
  const loading = el('div', 'detail-loading');
  loading.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Fetching releases...</span>';
  detailRight.appendChild(loading);

  const res = await window.api.fetchReleases();
  loading.remove();

  if (!res.ok) {
    const box = el('div', 'action-box action-error');
    box.innerHTML = `
      <i class="fa-solid fa-circle-exclamation"></i>
      <div class="action-title">Failed to fetch releases</div>
      <div class="action-desc"></div>`;
    box.querySelector('.action-desc').textContent = res.error || '';
    detailRight.appendChild(box);
    appendCancel(g, inspectResult);
    return;
  }
  if (!res.releases?.length) {
    const empty = el('div', 'release-empty', 'No Windows releases found.');
    detailRight.appendChild(empty);
    appendCancel(g, inspectResult);
    return;
  }

  const engineBackend = inspectResult?.engine?.backend || null;
  const gameArch      = inspectResult?.arch            || null;

  const list = el('div', 'release-list');
  for (const r of res.releases) {
    list.appendChild(makeReleaseCard(r, g, engineBackend, gameArch));
  }
  detailRight.appendChild(list);
  appendCancel(g, inspectResult);
}

function appendCancel(g, inspectResult) {
  const cancel = el('button', 'btn btn-tonal btn-wide');
  cancel.type = 'button';
  cancel.innerHTML = '<i class="fa-solid fa-xmark"></i><span>CANCEL</span>';
  cancel.addEventListener('click', () => renderDetailRight(g, inspectResult));
  detailRight.appendChild(cancel);
}

function makeReleaseCard(release, game, backend, gameArch) {
  const card = el('div', 'release-card');
  const head = el('div', 'release-head');
  head.appendChild(el('span', 'release-tag', release.tag));
  if (release.prerelease) head.appendChild(el('span', 'pill pre', 'PRE'));
  card.appendChild(head);

  const date = release.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString('en-CA')
    : '';
  if (date) card.appendChild(el('div', 'release-date', date));

  const assets = el('div', 'release-assets');
  for (const a of release.assets) {
    const btn = el('button', 'btn-asset');
    btn.type = 'button';
    const label = a.variant && a.variant !== 'default'
      ? `${a.variant} ${a.arch}`
      : a.arch;
    btn.innerHTML =
      `<i class="fa-solid fa-download"></i>` +
      `<span>${label}</span>` +
      `<span class="asset-size">${formatBytes(a.size)}</span>`;
    // Recommend the asset that matches both the detected backend and arch.
    const backendMatch = !backend || a.variant === 'default'
      || a.variant?.toLowerCase() === backend.toLowerCase();
    const archMatch    = !gameArch || a.arch === gameArch;
    if (backendMatch && archMatch && a.arch !== 'unknown') {
      btn.classList.add('btn-recommended');
    }
    btn.addEventListener('click', () => startInstall(game, release, a));
    assets.appendChild(btn);
  }
  card.appendChild(assets);
  return card;
}

async function startInstall(g, release, asset) {
  detailRight.innerHTML = '';
  detailRight.appendChild(el('div', 'detail-actions-header',
    `INSTALLING ${release.tag}`));

  const status = el('div', 'install-status');
  const phase  = el('div', 'install-phase', 'Preparing download...');
  const bar    = el('div', 'progress-bar');
  const fill   = el('div', 'progress-fill');
  bar.appendChild(fill);
  const info   = el('div', 'install-info', asset.name);
  status.appendChild(phase);
  status.appendChild(bar);
  status.appendChild(info);
  detailRight.appendChild(status);

  const off = window.api.onInstallProgress((msg) => {
    if (msg.phase === 'download') {
      phase.textContent = 'Downloading...';
      const pct = Math.max(0, Math.min(1, msg.percent || 0));
      fill.style.width = `${(pct * 100).toFixed(1)}%`;
      if (msg.total) {
        info.textContent = `${formatBytes(msg.received)} / ${formatBytes(msg.total)}`;
      } else {
        info.textContent = `${formatBytes(msg.received)} downloaded`;
      }
    } else if (msg.phase === 'extract') {
      phase.textContent = 'Extracting archive...';
      fill.style.width = '100%';
      info.textContent = '';
    } else if (msg.phase === 'done') {
      phase.textContent = 'Done';
    }
  });

  let res;
  try {
    res = await window.api.installBepInEx({
      gamePath: g.path,
      url:      asset.url,
      fileName: asset.name,
    });
  } catch (e) {
    res = { ok: false, error: e.message || String(e) };
  }
  off();

  if (!res.ok) {
    detailRight.innerHTML = '';
    detailRight.appendChild(el('div', 'detail-actions-header', 'ERROR'));
    const box = el('div', 'action-box action-error');
    box.innerHTML = `
      <i class="fa-solid fa-circle-exclamation"></i>
      <div class="action-title">Installation failed</div>
      <div class="action-desc"></div>`;
    box.querySelector('.action-desc').textContent = res.error || 'Unknown error';
    detailRight.appendChild(box);

    const retry = el('button', 'btn btn-tonal btn-wide');
    retry.type = 'button';
    retry.innerHTML = '<i class="fa-solid fa-arrow-left"></i><span>BACK</span>';
    retry.addEventListener('click', () => refreshDetail(g));
    detailRight.appendChild(retry);
    return;
  }

  // Success screen
  detailRight.innerHTML = '';
  detailRight.appendChild(el('div', 'detail-actions-header', 'DONE'));
  const box = el('div', 'action-box action-success');
  box.innerHTML = `
    <i class="fa-solid fa-circle-check"></i>
    <div class="action-title">Installation complete</div>
    <div class="action-desc">
      BepInEx <strong></strong> has been extracted into the game folder.<br><br>
      Please launch the game once so BepInEx can create its
      <code>plugins/</code>, <code>config/</code> and <code>patchers/</code>
      folders, then click Refresh.
    </div>`;
  box.querySelector('strong').textContent = release.tag;
  detailRight.appendChild(box);

  const refresh = el('button', 'btn btn-filled btn-wide');
  refresh.type = 'button';
  refresh.innerHTML = '<i class="fa-solid fa-rotate"></i><span>REFRESH</span>';
  refresh.addEventListener('click', () => refreshDetail(g));
  detailRight.appendChild(refresh);
}

// ============================================================
// Uninstall flow + confirm modal
// ============================================================

function appendUninstallButton(g) {
  const btn = el('button', 'btn btn-tonal btn-wide btn-uninstall');
  btn.type = 'button';
  btn.innerHTML = '<i class="fa-solid fa-trash-can"></i><span>UNINSTALL BEPINEX</span>';
  btn.addEventListener('click', () => confirmUninstall(g));
  detailRight.appendChild(btn);
}

function openConfirm({ title, message, danger, confirmText, cancelText, icon }) {
  return new Promise((resolve) => {
    const scrim = el('div', 'modal-scrim');
    const card  = el('div', 'modal-card');

    const iconWrap = el('div', 'modal-icon');
    const iconClass = icon || (danger ? 'fa-triangle-exclamation' : 'fa-circle-info');
    iconWrap.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    if (!danger) iconWrap.classList.add('modal-icon-info');
    card.appendChild(iconWrap);

    card.appendChild(el('h3', 'modal-title', title));

    const msgBox = el('div', 'modal-message');
    if (typeof message === 'string')       msgBox.textContent = message;
    else if (message instanceof Node)      msgBox.appendChild(message);
    card.appendChild(msgBox);

    const btns = el('div', 'modal-buttons');
    const showCancel = cancelText !== null;
    const cancelBtn = el('button', 'btn btn-tonal', cancelText || 'CANCEL');
    cancelBtn.type = 'button';
    const okBtn = el('button',
      `btn ${danger ? 'btn-danger' : 'btn-filled'}`,
      confirmText || 'CONFIRM');
    okBtn.type = 'button';
    if (showCancel) btns.appendChild(cancelBtn);
    btns.appendChild(okBtn);
    card.appendChild(btns);

    scrim.appendChild(card);
    document.body.appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add('open'));

    const close = (result) => {
      scrim.classList.remove('open');
      setTimeout(() => scrim.remove(), 220);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click',      () => close(true));
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) close(false);
    });
    document.addEventListener('keydown', onKey);
    // Focus CANCEL by default for destructive dialogs, else OK.
    setTimeout(() => (danger && showCancel ? cancelBtn : okBtn).focus(), 60);
  });
}

async function confirmUninstall(g) {
  const msg = document.createElement('div');
  msg.innerHTML =
    '<p>This will remove BepInEx and all installed plugins/configs from:</p>' +
    '<div class="modal-path"></div>' +
    '<p>Files that will be deleted:</p>' +
    '<ul class="modal-list">' +
    '  <li><code>BepInEx/</code> (folder — plugins &amp; configs included)</li>' +
    '  <li><code>winhttp.dll</code></li>' +
    '  <li><code>doorstop_config.ini</code></li>' +
    '  <li><code>.doorstop_version</code></li>' +
    '</ul>' +
    '<p class="modal-warn">This action cannot be undone.</p>';
  msg.querySelector('.modal-path').textContent = g.path;

  const ok = await openConfirm({
    title:       'Uninstall BepInEx?',
    message:     msg,
    danger:      true,
    confirmText: 'UNINSTALL',
    cancelText:  'CANCEL',
  });
  if (!ok) return;

  detailRight.innerHTML = '';
  detailRight.appendChild(el('div', 'detail-actions-header', 'UNINSTALLING'));
  const spin = el('div', 'detail-loading');
  spin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Removing files...</span>';
  detailRight.appendChild(spin);

  let res;
  try { res = await window.api.uninstallBepInEx(g.path); }
  catch (e) { res = { ok: false, error: e.message || String(e) }; }

  if (!res.ok) {
    showUninstallError(g, res);
    return;
  }
  refreshDetail(g);
}

function showUninstallError(g, res) {
  detailRight.innerHTML = '';
  detailRight.appendChild(el('div', 'detail-actions-header', 'ERROR'));
  const box = el('div', 'action-box action-error');
  box.innerHTML =
    '<i class="fa-solid fa-circle-exclamation"></i>' +
    '<div class="action-title">Uninstall failed</div>' +
    '<div class="action-desc"></div>';
  const failedNames = (res.failed || []).map(f => f.file || f).join(', ');
  box.querySelector('.action-desc').textContent =
    failedNames ? `Could not remove: ${failedNames}` :
                  (res.error || 'Unknown error');
  detailRight.appendChild(box);

  const back = el('button', 'btn btn-tonal btn-wide');
  back.type = 'button';
  back.innerHTML = '<i class="fa-solid fa-arrow-left"></i><span>BACK</span>';
  back.addEventListener('click', () => refreshDetail(g));
  detailRight.appendChild(back);
}

// ============================================================
// Plugin scanning
// ============================================================

async function scanAndShowPlugins(g, opts) {
  if (!opts || !opts.keepPage) pluginPageState.page = 0;
  detailRight.innerHTML = '';
  detailRight.appendChild(el('div', 'detail-actions-header', 'PLUGINS'));

  const spin = el('div', 'detail-loading');
  spin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>' +
                   '<span>Scanning plugins...</span>';
  detailRight.appendChild(spin);

  let res;
  try { res = await window.api.scanPlugins(g.path); }
  catch (e) { res = { ok: false, error: e.message || String(e) }; }
  spin.remove();

  if (!res.ok) { showPluginScanError(g, res.error || 'Unknown error'); return; }
  renderPluginList(g, res);
}

function showPluginScanError(g, message) {
  const box = el('div', 'action-box action-error');
  box.innerHTML =
    '<i class="fa-solid fa-circle-exclamation"></i>' +
    '<div class="action-title">Scan failed</div>' +
    '<div class="action-desc"></div>';
  box.querySelector('.action-desc').textContent = message;
  detailRight.appendChild(box);
  const back = el('button', 'btn btn-tonal btn-wide');
  back.type = 'button';
  back.innerHTML = '<i class="fa-solid fa-arrow-left"></i><span>BACK</span>';
  back.addEventListener('click', () => refreshDetail(g));
  detailRight.appendChild(back);
}

let pluginPageState = { page: 0 };

// Compute how many plugin rows fit given the viewport's available height.
// Each row is ~54px (padding + content) + 6px gap. Header + pager ~= 90px.
function calcPluginsPerPage() {
  // Available height = viewport - top hero/header/footer chrome (~200px)
  const availH = Math.max(240, (window.innerHeight || 800) - 220);
  const reserved = 90 + 24; // header + pager + panel padding bottom
  const rowH    = 54 + 6;
  const fit = Math.floor((availH - reserved) / rowH);
  return Math.max(3, Math.min(20, fit || 6));
}

function renderPluginList(g, res) {
  const header = el('div', 'plugin-list-header');
  const backBtn = el('button', 'btn btn-icon');
  backBtn.type  = 'button';
  backBtn.title = 'Back to actions';
  backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
  backBtn.addEventListener('click', () => refreshDetail(g));
  header.appendChild(backBtn);
  const label = `${res.plugins.length} plugin${res.plugins.length !== 1 ? 's' : ''}`;
  header.appendChild(el('span', 'plugin-count', label));
  detailRight.appendChild(header);

  if (res.plugins.length === 0) {
    const empty = el('div', 'action-box');
    const missing = !!res.noPluginsDir;
    empty.innerHTML =
      `<i class="fa-solid ${missing ? 'fa-folder-plus' : 'fa-puzzle-piece'}"></i>` +
      '<div class="action-title"></div>' +
      '<div class="action-desc"></div>';
    empty.querySelector('.action-title').textContent =
      missing ? 'No plugins folder' : 'No plugins installed';
    empty.querySelector('.action-desc').textContent = missing
      ? 'The BepInEx/plugins folder has not been created yet.'
      : 'Drop .dll files into BepInEx/plugins/ to add mods.';
    detailRight.appendChild(empty);
    detailRight.appendChild(makeImportButton(g));
    return;
  }

  const perPage = calcPluginsPerPage();
  const totalPages = Math.max(1, Math.ceil(res.plugins.length / perPage));
  if (pluginPageState.page >= totalPages) pluginPageState.page = totalPages - 1;
  if (pluginPageState.page < 0) pluginPageState.page = 0;

  const list = el('div', 'plugin-list');
  detailRight.appendChild(list);

  const pager = el('div', 'plugin-pager');
  detailRight.appendChild(pager);

  const drawPage = () => {
    list.innerHTML = '';
    const start = pluginPageState.page * perPage;
    const end   = Math.min(start + perPage, res.plugins.length);
    for (let i = start; i < end; i++) list.appendChild(makePluginItem(g, res.plugins[i]));

    pager.innerHTML = '';
    const info = el('span', 'plugin-pager-info',
      `${start + 1}–${end} / ${res.plugins.length}`);
    const btns = el('div', 'plugin-pager-btns');

    const prev = el('button', 'btn btn-icon');
    prev.type = 'button';
    prev.title = 'Previous page';
    prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    prev.disabled = pluginPageState.page <= 0;
    prev.addEventListener('click', () => {
      if (pluginPageState.page > 0) { pluginPageState.page--; drawPage(); }
    });

    const pageLabel = el('span', 'plugin-pager-info',
      `${pluginPageState.page + 1} / ${totalPages}`);
    pageLabel.style.padding = '0 8px';
    pageLabel.style.alignSelf = 'center';

    const next = el('button', 'btn btn-icon');
    next.type = 'button';
    next.title = 'Next page';
    next.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    next.disabled = pluginPageState.page >= totalPages - 1;
    next.addEventListener('click', () => {
      if (pluginPageState.page < totalPages - 1) { pluginPageState.page++; drawPage(); }
    });

    btns.appendChild(prev);
    btns.appendChild(pageLabel);
    btns.appendChild(next);
    pager.appendChild(info);
    pager.appendChild(btns);

    // Hide pager if only one page
    pager.style.display = totalPages > 1 ? '' : 'none';
  };
  drawPage();

  detailRight.appendChild(makeImportButton(g));
}

function makeImportButton(g) {
  const btn = el('button', 'btn btn-tonal btn-wide plugin-import-btn');
  btn.type = 'button';
  btn.innerHTML = '<i class="fa-solid fa-file-import"></i><span>IMPORT PLUGIN</span>';
  btn.addEventListener('click', () => importPluginAction(g, btn));
  return btn;
}

async function importPluginAction(g, btn) {
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>IMPORTING...</span>';
  let res;
  try { res = await window.api.importPlugin(g.path); }
  catch (e) { res = { ok: false, error: e.message || String(e) }; }
  btn.disabled = false;
  btn.innerHTML = originalHtml;

  if (res.canceled) return;

  await showImportResult(res);
  if (res.ok && (res.imported && res.imported.length > 0)) {
    scanAndShowPlugins(g, { keepPage: true });
  }
}

async function showImportResult(res) {
  const msg = document.createElement('div');
  const parts = [];

  if (!res.ok) {
    parts.push(`<p class="modal-warn">${escapeHtml(res.error || 'Import failed')}</p>`);
  } else {
    const imp = res.imported || [];
    const skip = res.skipped || [];
    if (imp.length) {
      parts.push(`<p>Imported <b>${imp.length}</b> plugin file${imp.length !== 1 ? 's' : ''}:</p>`);
      parts.push('<div class="modal-list modal-list-ok">' +
        imp.map(f => `<div>${escapeHtml(f)}</div>`).join('') + '</div>');
    }
    if (skip.length) {
      parts.push(`<p class="modal-warn">Skipped <b>${skip.length}</b> file${skip.length !== 1 ? 's' : ''} (not a BepInEx plugin):</p>`);
      parts.push('<div class="modal-list modal-list-warn">' +
        skip.map(s => `<div>${escapeHtml(s.file)} — ${escapeHtml(s.reason)}</div>`).join('') + '</div>');
    }
    if (!imp.length && !skip.length) {
      parts.push('<p>No .dll files were found in the selection.</p>');
    }
  }

  msg.innerHTML = parts.join('');
  await openConfirm({
    title:       res.ok ? 'Import complete' : 'Import failed',
    message:     msg,
    danger:      false,
    confirmText: 'OK',
    cancelText:  null,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function makePluginItem(g, p) {
  const item = el('div', 'plugin-item');
  if (!p.enabled) item.classList.add('plugin-disabled');
  if (!p.valid)   item.classList.add('plugin-invalid');

  const info = el('div', 'plugin-info');
  info.appendChild(el('div', 'plugin-name', p.name));
  const meta = el('div', 'plugin-meta');
  let metaText = p.relativePath || p.fileName;
  if (!p.valid && p.reason) metaText += ` — ${p.reason}`;
  meta.textContent = metaText;
  info.appendChild(meta);
  item.appendChild(info);

  const actions = el('div', 'plugin-actions');

  // Toggle only makes sense for valid plugins; invalid files still get delete.
  if (p.valid) {
    const toggle = el('button', 'btn btn-icon plugin-toggle');
    toggle.type = 'button';
    toggle.title = p.enabled ? 'Disable plugin' : 'Enable plugin';
    toggle.innerHTML = p.enabled
      ? '<i class="fa-solid fa-pause"></i>'
      : '<i class="fa-solid fa-play"></i>';
    toggle.addEventListener('click', () => togglePluginAction(g, p));
    actions.appendChild(toggle);
  }

  const del = el('button', 'btn btn-icon plugin-delete');
  del.type = 'button';
  del.title = 'Delete plugin';
  del.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
  del.addEventListener('click', () => confirmDeletePlugin(g, p));
  actions.appendChild(del);

  item.appendChild(actions);
  return item;
}

async function togglePluginAction(g, p) {
  const res = await window.api.togglePlugin(p.path);
  if (res.ok) scanAndShowPlugins(g, { keepPage: true });
  else console.error('Toggle failed:', res.error);
}

async function confirmDeletePlugin(g, p) {
  const msg = document.createElement('div');
  msg.innerHTML =
    '<p>Delete this plugin file?</p>' +
    '<div class="modal-path"></div>' +
    '<p class="modal-warn">This cannot be undone.</p>';
  msg.querySelector('.modal-path').textContent = p.relativePath || p.fileName;

  const ok = await openConfirm({
    title:       'Delete plugin?',
    message:     msg,
    danger:      true,
    confirmText: 'DELETE',
    cancelText:  'CANCEL',
  });
  if (!ok) return;

  const res = await window.api.deletePlugin(p.path);
  if (res.ok) scanAndShowPlugins(g, { keepPage: true });
  else console.error('Delete failed:', res.error);
}

// ============================================================
// Settings & theme
// ============================================================
const THEMES = [
  { id: 'sky',      name: 'Sky Blue',       swatch: '#0067c6', ring: '#c9e6ff' },
  { id: 'pink',     name: 'Girly Pink',     swatch: '#a83564', ring: '#ffd8e6' },
  { id: 'orange',   name: 'Sunset Orange',  swatch: '#a13d00', ring: '#ffdcc7' },
  { id: 'forest',   name: 'Forest Green',   swatch: '#2b6a37', ring: '#adf2b0' },
  { id: 'midnight', name: 'Midnight Black', swatch: '#2b2b2b', ring: '#5a5a5a' },
  { id: 'indigo',   name: 'Deep Indigo',    swatch: '#2a4bb2', ring: '#dbe2ff' },
  { id: 'rose',     name: 'Rose Red',       swatch: '#b3261e', ring: '#ffdad4' },
];

function currentTheme() {
  try { return localStorage.getItem('bepinmgr-theme') || 'orange'; }
  catch { return 'orange'; }
}
function applyTheme(id) {
  if (id === 'orange') document.documentElement.removeAttribute('data-theme');
  else                 document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem('bepinmgr-theme', id); } catch {}
}

function openSettings() {
  const scrim = el('div', 'modal-scrim');
  const card  = el('div', 'modal-card settings-card');

  const iconWrap = el('div', 'modal-icon modal-icon-info');
  iconWrap.innerHTML = '<i class="fa-solid fa-palette"></i>';
  card.appendChild(iconWrap);

  card.appendChild(el('h3', 'modal-title', 'Settings'));

  card.appendChild(el('div', 'settings-section-title', 'Theme color'));

  const grid = el('div', 'settings-grid');
  const active = currentTheme();

  for (const t of THEMES) {
    const opt = el('button', 'theme-swatch');
    opt.type = 'button';
    opt.setAttribute('data-theme-id', t.id);
    if (t.id === active) opt.classList.add('active');

    const check = el('i', 'fa-solid fa-check theme-swatch-check');
    opt.appendChild(check);

    const disc = el('span', 'theme-swatch-disc');
    disc.style.background = t.swatch;
    disc.style.setProperty('--_accent', t.ring);
    opt.appendChild(disc);
    opt.appendChild(el('span', 'theme-swatch-name', t.name));

    opt.addEventListener('click', () => {
      grid.querySelectorAll('.theme-swatch.active')
        .forEach(e => e.classList.remove('active'));
      opt.classList.add('active');
      applyTheme(t.id);
    });
    grid.appendChild(opt);
  }
  card.appendChild(grid);

  const btns = el('div', 'modal-buttons');
  const doneBtn = el('button', 'btn btn-filled', 'DONE');
  doneBtn.type = 'button';
  btns.appendChild(doneBtn);
  card.appendChild(btns);

  scrim.appendChild(card);
  document.body.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('open'));

  const close = () => {
    scrim.classList.remove('open');
    setTimeout(() => scrim.remove(), 220);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
  doneBtn.addEventListener('click', close);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  setTimeout(() => doneBtn.focus(), 60);
}

// ============================================================
// Event listeners
// ============================================================
const settingsBtn = document.getElementById('settings-btn');

startBtn.addEventListener('click',    () => { showView('games'); loadGames(); });
backBtn.addEventListener('click',     () => showView('home'));
refreshBtn.addEventListener('click',  () => loadGames());
detailBackBtn.addEventListener('click', closeDetail);
if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
