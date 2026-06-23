/**
 * app.js — Main application controller
 *
 * Handles boot sequence, settings panel interactions, map style
 * switching, overlay toggles, and terminator mode selection.
 *
 * GeoJSON loading strategy (file:// compatible):
 *   window.COUNTRIES_GEO  — set by assets/data/countries.js
 *   window.TIMEZONES_GEO  — set by assets/data/timezones.js
 *   Both work on file://, http://, https:// via <script src>.
 */
(async () => {
  'use strict';

  // ── DOM refs ─────────────────────────────────────────────────────
  const loadingEl    = document.getElementById('loading');
  const loadingText  = document.getElementById('loading-text');
  const loadingBar   = document.getElementById('loading-bar');
  const btnSettings  = document.getElementById('btn-settings');
  const settingsPanel= document.getElementById('settings-panel');
  const layerBtns    = document.querySelectorAll('.layer-btn[data-mode]');
  const mapOptionEls = document.querySelectorAll('.map-option');
  const overlayRows  = document.querySelectorAll('.overlay-row');
  const termBtns     = document.querySelectorAll('.layer-btn[data-term]');
  const termHint     = document.getElementById('term-hint');
  const attrEl       = document.getElementById('attribution');

  // ── Asset paths ──────────────────────────────────────────────────
  const MAPS_BASE     = 'assets/maps/';
  const COUNTRIES_URL = 'assets/data/countries.geojson';
  const TIMEZONES_URL = 'assets/data/timezones.geojson';

  // ── Map catalogue ────────────────────────────────────────────────
  const MAP_CATALOGUE = [
    { file: 'physical.jpg',          attr: 'Map: Natural Earth II — naturalearthdata.com | Boundaries: Natural Earth' },
    { file: 'physical_21k.jpg',      attr: 'Map: Natural Earth II — naturalearthdata.com | Boundaries: Natural Earth' },
    { file: 'bluemarble.jpg',        attr: 'Map: NASA Blue Marble (GIBS) | Boundaries: Natural Earth' },
    { file: 'esri_dark_ocean.jpg',   attr: 'Map: Esri, DeLorme, USGS, NPS | Boundaries: Natural Earth' },
    { file: 'physical_original.jpg', attr: 'Map: Esri, DeLorme, USGS, NPS | Boundaries: Natural Earth' },
  ];

  // ── State ────────────────────────────────────────────────────────
  let currentMapFile  = 'physical.jpg';
  let currentMode     = 'physical';
  let currentTerm     = 'standard';
  let settingsOpen    = false;
  let mapSwitching    = false;

  // ── Helpers ──────────────────────────────────────────────────────
  function setLoadingText(msg) { loadingText.textContent = msg; }
  function setLoadingBar(pct)  { loadingBar.style.width  = pct + '%'; }

  function loadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => { console.warn('[WorldMap] Image not found:', src); resolve(null); };
      img.src = src;
    });
  }

  async function loadGeoJSON(globalVar, fallbackUrl) {
    if (globalVar &&
        globalVar.type === 'FeatureCollection' &&
        Array.isArray(globalVar.features)) {
      return globalVar;
    }
    try {
      const r = await fetch(fallbackUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('[WorldMap] GeoJSON unavailable:', fallbackUrl, e.message);
      return null;
    }
  }

  async function fileExists(url) {
    if (window.location.protocol === 'file:') return true;
    try { const r = await fetch(url, {method:'HEAD'}); return r.ok; }
    catch { return false; }
  }

  function updateAttribution(file) {
    const entry = MAP_CATALOGUE.find(m => m.file === file);
    if (entry && attrEl) attrEl.textContent = entry.attr;
  }

  // ── Settings panel ────────────────────────────────────────────────
  function openSettings()  {
    settingsOpen = true;
    settingsPanel.classList.add('open');
    btnSettings.setAttribute('aria-expanded', 'true');
    settingsPanel.setAttribute('aria-hidden', 'false');
  }
  function closeSettings() {
    settingsOpen = false;
    settingsPanel.classList.remove('open');
    btnSettings.setAttribute('aria-expanded', 'false');
    settingsPanel.setAttribute('aria-hidden', 'true');
  }

  document.addEventListener('click', e => {
    if (settingsOpen &&
        !settingsPanel.contains(e.target) &&
        e.target !== btnSettings &&
        !btnSettings.contains(e.target)) closeSettings();
  });
  btnSettings.addEventListener('click', e => { e.stopPropagation(); settingsOpen ? closeSettings() : openSettings(); });

  // ── Map layer (Physical / Geopolitical) ───────────────────────────
  function activateLayer(mode) {
    currentMode = mode;
    layerBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    Renderer.setMode(mode);
  }
  layerBtns.forEach(b => b.addEventListener('click', () => activateLayer(b.dataset.mode)));

  // ── Map style switching ───────────────────────────────────────────
  async function activateMapStyle(el) {
    if (mapSwitching) return;
    const file = el.dataset.file;
    if (!file || file === currentMapFile || el.classList.contains('unavailable')) return;
    mapSwitching = true;

    el.classList.add('loading');
    const check = el.querySelector('.map-option-check');
    check.textContent = '';

    const img = await loadImage(MAPS_BASE + file);
    el.classList.remove('loading');
    check.textContent = '○';

    if (!img) {
      el.classList.add('unavailable');
      const m = el.querySelector('.map-option-meta');
      if (m) m.textContent += ' · Not found';
      mapSwitching = false; return;
    }

    mapOptionEls.forEach(e => {
      const on = e.dataset.file === file;
      e.classList.toggle('active', on);
      e.setAttribute('aria-checked', on ? 'true' : 'false');
      const c = e.querySelector('.map-option-check');
      if (c) c.textContent = on ? '◉' : '○';
    });

    currentMapFile = file;
    Renderer.setMapImage(img);
    updateAttribution(file);
    closeSettings();
    mapSwitching = false;
  }

  mapOptionEls.forEach(el => {
    el.addEventListener('click', () => activateMapStyle(el));
    el.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); activateMapStyle(el); }});
  });

  // ── Overlay toggles ───────────────────────────────────────────────
  function toggleOverlay(row) {
    const name    = row.dataset.overlay;
    const visible = !row.classList.contains('active');
    row.classList.toggle('active', visible);
    row.setAttribute('aria-checked', visible ? 'true' : 'false');
    const ind = row.querySelector('.overlay-indicator');
    if (ind) ind.textContent = visible ? '◉' : '○';
    Renderer.setOverlay(name, visible);
  }

  overlayRows.forEach(row => {
    row.addEventListener('click', () => toggleOverlay(row));
    row.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); toggleOverlay(row); }});
  });

  // ── Terminator style ──────────────────────────────────────────────
  function activateTerminator(mode) {
    currentTerm = mode;
    termBtns.forEach(b => b.classList.toggle('active', b.dataset.term === mode));
    if (termHint) {
      termHint.classList.toggle('visible', mode === 'band');
    }
    Renderer.setTerminatorMode(mode);
  }
  termBtns.forEach(b => b.addEventListener('click', () => activateTerminator(b.dataset.term)));

  // ── Keyboard shortcuts ────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSettings(); return; }
    if (e.key === 'p' || e.key === 'P') {
      activateLayer(currentMode === 'physical' ? 'political' : 'physical');
    }
    if (e.key === 'b' || e.key === 'B') {
      activateTerminator(currentTerm === 'standard' ? 'band' : 'standard');
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────
  setLoadingText('Loading map image…');
  setLoadingBar(10);
  Clock.init();

  const [mapImage, countries, timezones] = await Promise.all([
    loadImage(MAPS_BASE + currentMapFile).then(img => { setLoadingBar(45); return img; }),
    loadGeoJSON(window.COUNTRIES_GEO, COUNTRIES_URL).then(g => { setLoadingBar(65); return g; }),
    loadGeoJSON(window.TIMEZONES_GEO,  TIMEZONES_URL).then(g => { setLoadingBar(80); return g; }),
  ]);

  setLoadingText('Rendering…');
  setLoadingBar(92);
  await new Promise(resolve => requestAnimationFrame(resolve));

  Renderer.init(mapImage, countries, timezones);
  setLoadingBar(100);

  // Disable Geopolitical if no countries data
  if (!countries) {
    const pb = document.querySelector('.layer-btn[data-mode="political"]');
    if (pb) { pb.disabled = true; pb.title = 'GeoJSON missing'; pb.style.opacity = '0.3'; pb.style.cursor = 'not-allowed'; }
  }

  // Disable Timezones overlay if no data
  if (!timezones) {
    const tzRow = document.querySelector('.overlay-row[data-overlay="timezones"]');
    if (tzRow) { tzRow.style.opacity = '0.3'; tzRow.style.cursor = 'not-allowed'; tzRow.onclick = null; }
  }

  // Background: probe which map files exist and mark unavailable ones
  (async () => {
    for (const el of mapOptionEls) {
      const file = el.dataset.file;
      if (!file || file === currentMapFile) continue;
      const exists = await fileExists(MAPS_BASE + file);
      if (!exists) {
        el.classList.add('unavailable');
        const c = el.querySelector('.map-option-check');
        const m = el.querySelector('.map-option-meta');
        if (c) c.textContent = '○';
        if (m) m.textContent += ' · Not downloaded';
      }
    }
  })();

  // Fade out loading screen
  await new Promise(resolve => setTimeout(resolve, 250));
  loadingEl.classList.add('fade-out');
  setTimeout(() => loadingEl.remove(), 1000);

})();
