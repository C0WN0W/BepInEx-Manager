// Runs before the main renderer so the correct theme is applied before
// the first paint (avoids a color flash on load).
(function () {
  try {
    const t = localStorage.getItem('bepinmgr-theme');
    if (t) document.documentElement.dataset.theme = t;
  } catch (_) {}
})();
