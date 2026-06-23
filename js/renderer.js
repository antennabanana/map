/**
 * renderer.js — Canvas layer manager and rendering pipeline
 *
 * Five stacked <canvas> elements (back → front):
 *   map-canvas       — base map image
 *   shadow-canvas    — day/night + twilight overlay
 *   graticule-canvas — latitude/longitude reference lines
 *   timezone-canvas  — timezone boundaries
 *   political-canvas — country borders + labels
 *
 * Public API:
 *   Renderer.init(mapImage, countriesGeo, timezonesGeo)
 *   Renderer.setMode('physical' | 'political')
 *   Renderer.setMapImage(img)
 *   Renderer.setOverlay(name, visible)   name: 'timezones' | 'named-parallels' | 'degree-grid'
 *   Renderer.setTerminatorMode('standard' | 'band')
 */
const Renderer = (() => {
  'use strict';

  // ── Canvases & contexts ─────────────────────────────────────────
  let mapCanvas, mapCtx;
  let shadowCanvas, shadowCtx;
  let graticuleCanvas, graticuleCtx;
  let timezoneCanvas, timezoneCtx;
  let politicalCanvas, politicalCtx;

  // ── Assets ──────────────────────────────────────────────────────
  let mapImage      = null;
  let countriesGeo  = null;
  let timezonesGeo  = null;

  // ── Layout (physical pixels) ─────────────────────────────────────
  let DPR = 1, canvasW = 0, canvasH = 0;
  let mapX = 0, mapY = 0, mapW = 0, mapH = 0;

  // ── D3 projection (fitted to current mapW × mapH) ───────────────
  let projection = null;

  // ── State ────────────────────────────────────────────────────────
  let currentMode    = 'physical';
  let terminatorMode = 'standard';   // 'standard' | 'band'
  let overlays = {
    'timezones':       false,
    'named-parallels': false,
    'degree-grid':     false,
  };
  let shadowTimer = null;

  // Named parallels — computed from current solar obliquity
  // These are effectively constant (~23.43°) for any given year.
  const OBLIQUITY_DEG = 23.43;  // axial tilt ≈ constant
  const NAMED_PARALLELS = [
    { lat:  90,                   name: 'North Pole',        short: '90°N',   weight: 'bold',   color: 'rgba(180,220,255,0.70)' },
    { lat:  90 - OBLIQUITY_DEG,   name: 'Arctic Circle',     short: null,     weight: 'normal', color: 'rgba(140,200,255,0.75)' },
    { lat:  OBLIQUITY_DEG,        name: 'Tropic of Cancer',  short: null,     weight: 'normal', color: 'rgba(255,210,100,0.75)' },
    { lat:  0,                    name: 'Equator',           short: '0°',     weight: 'bold',   color: 'rgba(120,220,160,0.85)' },
    { lat: -OBLIQUITY_DEG,        name: 'Tropic of Capricorn', short: null,   weight: 'normal', color: 'rgba(255,210,100,0.75)' },
    { lat: -(90 - OBLIQUITY_DEG), name: 'Antarctic Circle',  short: null,     weight: 'normal', color: 'rgba(140,200,255,0.75)' },
    { lat: -90,                   name: 'South Pole',        short: '90°S',   weight: 'bold',   color: 'rgba(180,220,255,0.70)' },
  ];

  // ── Helpers ──────────────────────────────────────────────────────
  function calcMapRect(cw, ch) {
    let w, h;
    if (cw / ch >= 2) { h = ch; w = h * 2; }
    else              { w = cw; h = w / 2;  }
    return { x: Math.floor((cw-w)/2), y: Math.floor((ch-h)/2),
             w: Math.floor(w),         h: Math.floor(h) };
  }

  function latToY(lat) { return mapH * (0.5 - lat / 180); }
  function lonToX(lon) { return mapW * (lon  / 360 + 0.5); }

  // ── resize ────────────────────────────────────────────────────────
  function resize() {
    DPR     = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = window.innerWidth, cssH = window.innerHeight;
    canvasW = Math.round(cssW * DPR);
    canvasH = Math.round(cssH * DPR);

    [mapCanvas, shadowCanvas, graticuleCanvas, timezoneCanvas, politicalCanvas].forEach(c => {
      c.width = canvasW; c.height = canvasH;
      c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    });

    const rect = calcMapRect(canvasW, canvasH);
    mapX = rect.x; mapY = rect.y; mapW = rect.w; mapH = rect.h;

    projection = d3.geoEquirectangular()
      .fitExtent([[0,0],[mapW,mapH]], {type:'Sphere'});

    drawMap();
    drawShadow();
    if (overlays['named-parallels'] || overlays['degree-grid']) drawGraticule();
    if (overlays['timezones'])                                   drawTimezones();
    if (currentMode === 'political')                             drawPolitical();
  }

  // ── drawMap ───────────────────────────────────────────────────────
  function drawMap() {
    mapCtx.fillStyle = '#000008';
    mapCtx.fillRect(0, 0, canvasW, canvasH);
    if (!mapImage) {
      const g = mapCtx.createLinearGradient(mapX, mapY, mapX, mapY + mapH);
      g.addColorStop(0, '#12294a'); g.addColorStop(0.4, '#1a3a5c'); g.addColorStop(1, '#0d2035');
      mapCtx.fillStyle = g; mapCtx.fillRect(mapX, mapY, mapW, mapH);
      return;
    }
    mapCtx.imageSmoothingEnabled = true; mapCtx.imageSmoothingQuality = 'high';
    mapCtx.drawImage(mapImage, mapX, mapY, mapW, mapH);
  }

  // ── drawShadow ────────────────────────────────────────────────────
  function drawShadow() {
    const sub  = Solar.getSubsolarPoint(new Date());
    const sw = Math.max(2, mapW);
    const sh = Math.max(2, mapH);

    const imageData = Solar.computeShadow(sw, sh, sub, terminatorMode === 'band');

    shadowCtx.clearRect(0, 0, canvasW, canvasH);
    shadowCtx.putImageData(imageData, mapX, mapY);

    if (!shadowCanvas.classList.contains('visible'))
      shadowCanvas.classList.add('visible');
  }

  // ── drawGraticule ─────────────────────────────────────────────────
  function drawGraticule() {
    graticuleCtx.clearRect(0, 0, canvasW, canvasH);
    if (!projection) return;

    graticuleCtx.save();
    graticuleCtx.translate(mapX, mapY);

    // ── Degree grid (every 30°) ─────────────────────────────────
    if (overlays['degree-grid']) {
      const grid = d3.geoGraticule().step([30, 30])();
      const pathGen = d3.geoPath(projection, graticuleCtx);

      graticuleCtx.beginPath();
      pathGen(grid);
      graticuleCtx.lineWidth   = Math.max(0.6, 0.7 * DPR);
      graticuleCtx.strokeStyle = 'rgba(255,255,255,0.35)';
      graticuleCtx.setLineDash([6 * DPR, 8 * DPR]);
      graticuleCtx.stroke();
      graticuleCtx.setLineDash([]);

      // Degree labels every 30° on the left and bottom edges
      const fSz = Math.round(8 * DPR);
      graticuleCtx.font = `${fSz}px "Courier New", monospace`;
      graticuleCtx.fillStyle   = 'rgba(255,255,255,0.32)';
      graticuleCtx.textAlign   = 'left';
      graticuleCtx.textBaseline = 'middle';

      for (let lat = -60; lat <= 60; lat += 30) {
        if (lat === 0) continue; // Equator drawn below with name
        const y = latToY(lat);
        if (y < 0 || y > mapH) continue;
        graticuleCtx.fillText(`${Math.abs(lat)}°${lat>0?'N':'S'}`, 4 * DPR, y);
      }
      graticuleCtx.textAlign = 'center';
      graticuleCtx.textBaseline = 'bottom';
      for (let lon = -150; lon <= 180; lon += 30) {
        if (lon === 0) continue; // Prime Meridian drawn below
        const x = lonToX(lon);
        if (x < 0 || x > mapW) continue;
        const label = lon < 0 ? `${-lon}°W` : `${lon}°E`;
        graticuleCtx.fillText(label, x, mapH - 4 * DPR);
      }
    }

    // ── Named parallels ─────────────────────────────────────────
    if (overlays['named-parallels']) {
      const lineW    = Math.max(0.5, 0.65 * DPR);
      const fontSize = Math.round(9.5 * DPR);
      graticuleCtx.font = `${fontSize}px "Courier New", monospace`;

      for (const p of NAMED_PARALLELS) {
        const y = latToY(p.lat);
        if (y < 0 || y > mapH) continue;

        // Draw horizontal line across full map width
        graticuleCtx.beginPath();
        graticuleCtx.moveTo(0, y); graticuleCtx.lineTo(mapW, y);
        graticuleCtx.lineWidth   = lineW;
        graticuleCtx.strokeStyle = p.color;

        // Poles: dotted; Equator: solid; Tropics/Circles: dashed
        if (Math.abs(p.lat) === 90) {
          graticuleCtx.setLineDash([3 * DPR, 5 * DPR]);
        } else if (p.lat === 0) {
          graticuleCtx.setLineDash([]);
        } else {
          graticuleCtx.setLineDash([8 * DPR, 5 * DPR]);
        }
        graticuleCtx.stroke();
        graticuleCtx.setLineDash([]);

        // Label — right side of map
        const degStr = p.short || `${Math.abs(p.lat).toFixed(1)}°${p.lat>0?'N':p.lat<0?'S':''}`;
        const label  = `${p.name}  ${degStr}`;
        const pad    = 6 * DPR;

        graticuleCtx.textAlign    = 'right';
        graticuleCtx.textBaseline = p.lat >= 0 ? 'bottom' : 'top';
        const vOff = p.lat >= 0 ? -2 * DPR : 2 * DPR;

        // Halo
        graticuleCtx.lineWidth   = 3 * DPR;
        graticuleCtx.strokeStyle = 'rgba(0,0,0,0.85)';
        graticuleCtx.font = `${p.weight === 'bold' ? 'bold ' : ''}${fontSize}px "Courier New", monospace`;
        graticuleCtx.strokeText(label, mapW - pad, y + vOff);
        // Text
        graticuleCtx.fillStyle = p.color;
        graticuleCtx.fillText(label, mapW - pad, y + vOff);
      }

      // Prime Meridian — vertical
      const xPM = lonToX(0);
      graticuleCtx.beginPath();
      graticuleCtx.moveTo(xPM, 0); graticuleCtx.lineTo(xPM, mapH);
      graticuleCtx.lineWidth   = Math.max(0.5, 0.6 * DPR);
      graticuleCtx.strokeStyle = 'rgba(160,200,160,0.60)';
      graticuleCtx.setLineDash([8 * DPR, 5 * DPR]);
      graticuleCtx.stroke();
      graticuleCtx.setLineDash([]);

      // Prime Meridian label
      graticuleCtx.font = `${Math.round(9 * DPR)}px "Courier New", monospace`;
      graticuleCtx.textAlign = 'left'; graticuleCtx.textBaseline = 'top';
      graticuleCtx.lineWidth   = 2.5 * DPR;
      graticuleCtx.strokeStyle = 'rgba(0,0,0,0.85)';
      graticuleCtx.strokeText('Prime Meridian  0°', xPM + 3 * DPR, 4 * DPR);
      graticuleCtx.fillStyle = 'rgba(160,200,160,0.80)';
      graticuleCtx.fillText('Prime Meridian  0°', xPM + 3 * DPR, 4 * DPR);
    }

    graticuleCtx.restore();

    if (!graticuleCanvas.classList.contains('visible'))
      graticuleCanvas.classList.add('visible');
  }

  // ── drawTimezones ─────────────────────────────────────────────────
  function drawTimezones() {
    timezoneCtx.clearRect(0, 0, canvasW, canvasH);
    if (!timezonesGeo || !projection) return;

    timezoneCtx.save();
    timezoneCtx.translate(mapX, mapY);

    const pathGen = d3.geoPath(projection, timezoneCtx);

    // Draw timezone borders
    timezoneCtx.beginPath();
    pathGen(timezonesGeo);
    timezoneCtx.lineWidth   = Math.max(0.4, 0.5 * DPR);
    timezoneCtx.strokeStyle = 'rgba(255,200,80,0.45)';
    timezoneCtx.lineJoin    = 'round';
    timezoneCtx.stroke();

    // UTC offset labels at zone centroids
    const fontSize = Math.round(9 * DPR);
    timezoneCtx.font          = `${fontSize}px "Courier New", monospace`;
    timezoneCtx.textAlign     = 'center';
    timezoneCtx.textBaseline  = 'middle';

    for (const f of timezonesGeo.features) {
      const props = f.properties || {};
      const zone  = props.zone;
      if (zone == null) continue;

      // Only label relatively large zones to avoid clutter
      const area = d3.geoArea(f);
      if (area < 0.008) continue; // skip tiny zones

      const centroid = d3.geoCentroid(f);
      if (!centroid || !isFinite(centroid[0])) continue;
      const [cx, cy] = projection(centroid);
      if (!cx || cx < 0 || cy < 0 || cx > mapW || cy > mapH) continue;

      const label = zone >= 0 ? `UTC+${zone}` : `UTC${zone}`;
      // Halo
      timezoneCtx.lineWidth   = 2.5 * DPR;
      timezoneCtx.strokeStyle = 'rgba(0,0,0,0.80)';
      timezoneCtx.strokeText(label, cx, cy);
      // Fill
      timezoneCtx.fillStyle = 'rgba(255,210,100,0.75)';
      timezoneCtx.fillText(label, cx, cy);
    }

    timezoneCtx.restore();

    if (!timezoneCanvas.classList.contains('visible'))
      timezoneCanvas.classList.add('visible');
  }

  // ── drawPolitical ─────────────────────────────────────────────────
  function drawPolitical() {
    politicalCtx.clearRect(0, 0, canvasW, canvasH);
    if (!countriesGeo || !projection) return;

    politicalCtx.save();
    politicalCtx.translate(mapX, mapY);

    const pathGen = d3.geoPath(projection, politicalCtx);

    politicalCtx.beginPath();
    pathGen(countriesGeo);
    politicalCtx.lineWidth   = Math.max(0.5, 0.7 * DPR);
    politicalCtx.strokeStyle = 'rgba(255,255,255,0.60)';
    politicalCtx.lineJoin    = 'round';
    politicalCtx.stroke();

    // Country name labels
    const fontSize = Math.round(10.5 * DPR);
    politicalCtx.font         = `${fontSize}px "Courier New", monospace`;
    politicalCtx.textAlign    = 'center';
    politicalCtx.textBaseline = 'middle';

    const MIN_AREA = 0.0012;
    for (const f of (countriesGeo.features || [])) {
      if (d3.geoArea(f) < MIN_AREA) continue;
      const props = f.properties || {};
      let geoPoint;
      if (props.LABEL_X != null && props.LABEL_Y != null)
        geoPoint = [+props.LABEL_X, +props.LABEL_Y];
      else
        geoPoint = d3.geoCentroid(f);
      if (!geoPoint || !isFinite(geoPoint[0])) continue;
      const [px, py] = projection(geoPoint) || [];
      if (!px || px < 0 || py < 0 || px > mapW || py > mapH) continue;
      const name = props.NAME || props.ADMIN || '';
      if (!name) continue;
      politicalCtx.lineWidth   = 2.8 * DPR;
      politicalCtx.strokeStyle = 'rgba(0,0,0,0.78)';
      politicalCtx.strokeText(name, px, py);
      politicalCtx.fillStyle = 'rgba(255,252,240,0.90)';
      politicalCtx.fillText(name, px, py);
    }

    politicalCtx.restore();
    if (!politicalCanvas.classList.contains('visible'))
      politicalCanvas.classList.add('visible');
  }

  // ── startShadowLoop ────────────────────────────────────────────────
  function startShadowLoop() {
    shadowTimer = setInterval(() => {
      if (!document.hidden) drawShadow();
    }, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) drawShadow();
    });
  }

  // ── init ──────────────────────────────────────────────────────────
  function init(mapImg, countries, timezones) {
    mapImage     = mapImg;
    countriesGeo = countries;
    timezonesGeo = timezones;

    mapCanvas       = document.getElementById('map-canvas');
    shadowCanvas    = document.getElementById('shadow-canvas');
    graticuleCanvas = document.getElementById('graticule-canvas');
    timezoneCanvas  = document.getElementById('timezone-canvas');
    politicalCanvas = document.getElementById('political-canvas');

    mapCtx       = mapCanvas.getContext('2d', {alpha: false});
    shadowCtx    = shadowCanvas.getContext('2d');
    graticuleCtx = graticuleCanvas.getContext('2d');
    timezoneCtx  = timezoneCanvas.getContext('2d');
    politicalCtx = politicalCanvas.getContext('2d');

    resize();

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 180);
    });

    startShadowLoop();
  }

  // ── Public API ────────────────────────────────────────────────────

  function setMode(mode) {
    currentMode = mode;
    if (mode === 'political') {
      politicalCanvas.style.display = 'block';
      requestAnimationFrame(() => drawPolitical());
    } else {
      politicalCanvas.classList.remove('visible');
      setTimeout(() => {
        if (currentMode !== 'political') politicalCanvas.style.display = 'none';
      }, 450);
    }
  }

  function setMapImage(newImage) {
    mapImage = newImage;
    drawMap();
    if (currentMode === 'political') drawPolitical();
  }

  /** Toggle an overlay layer on or off.
   *  name: 'timezones' | 'named-parallels' | 'degree-grid'
   */
  function setOverlay(name, visible) {
    overlays[name] = visible;

    const affectsGraticule = name === 'named-parallels' || name === 'degree-grid';
    const needsGraticule   = overlays['named-parallels'] || overlays['degree-grid'];

    if (affectsGraticule) {
      if (needsGraticule) {
        graticuleCanvas.style.display = 'block';
        requestAnimationFrame(() => drawGraticule());
      } else {
        graticuleCanvas.classList.remove('visible');
        setTimeout(() => { graticuleCanvas.style.display = 'none'; }, 350);
      }
    }

    if (name === 'timezones') {
      if (visible) {
        timezoneCanvas.style.display = 'block';
        requestAnimationFrame(() => drawTimezones());
      } else {
        timezoneCanvas.classList.remove('visible');
        setTimeout(() => { timezoneCanvas.style.display = 'none'; }, 350);
      }
    }
  }

  /** Switch the terminator rendering mode: 'standard' or 'band'. */
  function setTerminatorMode(mode) {
    terminatorMode = mode;
    drawShadow();
  }

  return { init, setMode, setMapImage, setOverlay, setTerminatorMode };

})();
