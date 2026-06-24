/**
 * renderer.js — Canvas layer manager and rendering pipeline
 *
 * Six stacked <canvas> elements (back → front):
 *   map-canvas       — base map image
 *   shadow-canvas    — day/night + twilight overlay
 *   debug-canvas     — subsolar point + terminator great circle
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
 *   Renderer.setDebugOverlay(visible)
 */
const Renderer = (() => {
  'use strict';

  // ── Canvases & contexts ─────────────────────────────────────────
  let mapCanvas, mapCtx;
  let shadowCanvas, shadowCtx;
  let debugCanvas, debugCtx;
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
    'twilight-bounds': false,
  };
  let shadowTimer = null;
  let debugVisible = false;

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

    [mapCanvas, shadowCanvas, debugCanvas, graticuleCanvas, timezoneCanvas, politicalCanvas].forEach(c => {
      c.width = canvasW; c.height = canvasH;
      c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    });

    const rect = calcMapRect(canvasW, canvasH);
    mapX = rect.x; mapY = rect.y; mapW = rect.w; mapH = rect.h;

    projection = d3.geoEquirectangular()
      .fitExtent([[0,0],[mapW,mapH]], {type:'Sphere'});

    drawMap();
    drawShadow();
    if (debugVisible) drawDebugOverlay();
    if (overlays['twilight-bounds']) drawTwilightBounds(Solar.getSubsolarPoint(new Date()));
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

    if (overlays['twilight-bounds']) drawTwilightBounds(sub);

    if (!shadowCanvas.classList.contains('visible'))
      shadowCanvas.classList.add('visible');
  }

  // ── drawTwilightBounds ───────────────────────────────────────────
  function drawTwilightBounds(sub) {
    const DEG = Math.PI / 180;
    const SIN_CIVIL    = Math.sin(6 * DEG);
    const SIN_NAUTICAL = Math.sin(12 * DEG);
    const SIN_ASTRO    = Math.sin(18 * DEG);
    const sinDec = Math.sin(sub.decRad);
    const cosDec = Math.cos(sub.decRad);
    if (cosDec < 0.01) return;
    const sunLonDeg = sub.lon;

    const boundaries = [
      { threshold: 0,          color: 'rgba(0,200,200,0.50)',  dash: [4,4], label: null },
      { threshold: -SIN_CIVIL, color: 'rgba(60,160,255,0.50)', dash: [6,4], label: null },
      { threshold: -SIN_NAUTICAL, color: 'rgba(120,100,255,0.50)', dash: [6,4], label: null },
      { threshold: -SIN_ASTRO, color: 'rgba(200,80,220,0.50)', dash: [6,4], label: null },
    ];

    shadowCtx.save();
    shadowCtx.translate(mapX, mapY);

    for (const b of boundaries) {
      const C = b.threshold;
      const pts = [];

      for (let lon = -180; lon <= 180; lon += 0.5) {
        const dLon = lon - sunLonDeg;
        const dLonRad = dLon * DEG;
        const A = sinDec;
        const B = cosDec * Math.cos(dLonRad);
        const R = Math.sqrt(A * A + B * B);
        const C_OVER_R = C / R;
        if (Math.abs(C_OVER_R) > 1) continue;
        const phi = Math.atan2(B, A);
        const latRad = Math.asin(C_OVER_R) - phi;
        const latDeg = latRad / DEG;
        pts.push({ x: lonToX(lon), y: latToY(latDeg) });
      }

      if (pts.length < 2) continue;
      shadowCtx.beginPath();
      shadowCtx.strokeStyle = b.color;
      shadowCtx.lineWidth = Math.max(1, 1.2 * DPR);
      shadowCtx.setLineDash(b.dash.map(d => d * DPR));
      shadowCtx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) shadowCtx.lineTo(pts[i].x, pts[i].y);
      shadowCtx.stroke();
      shadowCtx.setLineDash([]);
    }

    // ── Labels at zone centers ──────────────────────────────────────
    const dLons = [
      { dLon: Math.acos(-SIN_CIVIL    / (2 * cosDec)), text: 'CIVIL'  },
      { dLon: Math.acos(-(SIN_CIVIL + SIN_NAUTICAL) / (2 * cosDec)), text: 'NAUT'  },
      { dLon: Math.acos(-(SIN_NAUTICAL + SIN_ASTRO) / (2 * cosDec)), text: 'ASTRO' },
    ];

    const fSz = Math.round(9 * DPR);
    shadowCtx.font = `${fSz}px "Courier New", monospace`;
    shadowCtx.textAlign = 'center';
    shadowCtx.textBaseline = 'middle';
    const ly = latToY(0);

    for (const z of dLons) {
      for (const sign of [-1, 1]) {
        const lon = sunLonDeg + sign * z.dLon / DEG;
        const lx = lonToX(lon);
        if (lx < 0 || lx > mapW || ly < 0 || ly > mapH) continue;
        shadowCtx.fillStyle = 'rgba(220,230,240,0.75)';
        shadowCtx.fillText(z.text, lx, ly);
      }
    }

    shadowCtx.restore();
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
      graticuleCtx.lineWidth   = Math.max(0.8, 1.0 * DPR);
      graticuleCtx.strokeStyle = 'rgba(255,255,255,0.55)';
      graticuleCtx.setLineDash([6 * DPR, 8 * DPR]);
      graticuleCtx.stroke();
      graticuleCtx.setLineDash([]);

      // Degree labels every 30° on the left and bottom edges
      const fSz = Math.round(9.5 * DPR);
      graticuleCtx.font = `${fSz}px "Courier New", monospace`;
      graticuleCtx.textAlign   = 'left';
      graticuleCtx.textBaseline = 'middle';

      for (let lat = -60; lat <= 60; lat += 30) {
        if (lat === 0) continue;
        const y = latToY(lat);
        if (y < 0 || y > mapH) continue;
        const label = `${Math.abs(lat)}°${lat>0?'N':'S'}`;
        graticuleCtx.fillStyle = 'rgba(120,220,160,0.85)';
        graticuleCtx.fillText(label, 4 * DPR, y);
      }
      graticuleCtx.textAlign = 'center';
      graticuleCtx.textBaseline = 'bottom';
      for (let lon = -150; lon <= 180; lon += 30) {
        if (lon === 0) continue;
        const x = lonToX(lon);
        if (x < 0 || x > mapW) continue;
        const label = lon < 0 ? `${-lon}°W` : `${lon}°E`;
        graticuleCtx.fillStyle = 'rgba(120,220,160,0.85)';
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
    timezoneCtx.lineWidth   = Math.max(0.6, 0.8 * DPR);
    timezoneCtx.strokeStyle = 'rgba(255,100,100,0.65)';
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
      timezoneCtx.lineWidth   = 3 * DPR;
      timezoneCtx.strokeStyle = 'rgba(0,0,0,0.85)';
      timezoneCtx.strokeText(label, cx, cy);
      // Fill
      timezoneCtx.fillStyle = 'rgba(255,130,130,0.90)';
      timezoneCtx.fillText(label, cx, cy);
    }

    timezoneCtx.restore();

    if (!timezoneCanvas.classList.contains('visible'))
      timezoneCanvas.classList.add('visible');
  }

  // ── drawDebugOverlay ──────────────────────────────────────────────
  function drawDebugOverlay() {
    debugCtx.clearRect(0, 0, canvasW, canvasH);
    if (!debugVisible) return;

    const sub = Solar.getSubsolarPoint(new Date());
    const sunLonDeg = sub.lon;
    const decRad = sub.decRad;

    debugCtx.save();
    debugCtx.translate(mapX, mapY);

    // ── Subsolar point (red dot + glow) ──────────────────────────
    const sx = lonToX(sunLonDeg);
    const sy = latToY(sub.lat);

    const glow = debugCtx.createRadialGradient(sx, sy, 0, sx, sy, 22 * DPR);
    glow.addColorStop(0, 'rgba(255,60,60,0.50)');
    glow.addColorStop(1, 'rgba(255,60,60,0)');
    debugCtx.fillStyle = glow;
    debugCtx.beginPath();
    debugCtx.arc(sx, sy, 22 * DPR, 0, 2 * Math.PI);
    debugCtx.fill();

    debugCtx.fillStyle = '#ff3333';
    debugCtx.beginPath();
    debugCtx.arc(sx, sy, 4 * DPR, 0, 2 * Math.PI);
    debugCtx.fill();

    // ── Antipode dot ─────────────────────────────────────────────
    const aLon = sunLonDeg + (sunLonDeg > 0 ? -180 : 180);
    const aLat = -sub.lat;
    const ax = lonToX(aLon);
    const ay = latToY(aLat);
    debugCtx.fillStyle = 'rgba(255,100,100,0.35)';
    debugCtx.beginPath();
    debugCtx.arc(ax, ay, 2.5 * DPR, 0, 2 * Math.PI);
    debugCtx.fill();

    // ── Terminator great circle (dashed red line) ───────────────
    if (Math.abs(decRad) > 0.001) {
      const tanDec = Math.tan(decRad);
      const step = 1;
      const points = [];

      for (let lon = -180; lon <= 180; lon += step) {
        let dLon = lon - sunLonDeg;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const dLonRad = dLon * Math.PI / 180;

        const ratio = Math.cos(dLonRad) / tanDec;
        const latDeg = Math.atan(-ratio) * 180 / Math.PI;

        points.push({ x: lonToX(lon), y: latToY(latDeg) });
      }

      debugCtx.beginPath();
      debugCtx.strokeStyle = 'rgba(255,80,80,0.65)';
      debugCtx.lineWidth = Math.max(1.2, 1.5 * DPR);
      debugCtx.setLineDash([8 * DPR, 5 * DPR]);

      let first = true;
      for (const p of points) {
        if (first) { debugCtx.moveTo(p.x, p.y); first = false; }
        else       { debugCtx.lineTo(p.x, p.y); }
      }
      debugCtx.stroke();
      debugCtx.setLineDash([]);
    }

    debugCtx.restore();

    if (!debugCanvas.classList.contains('visible'))
      debugCanvas.classList.add('visible');
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
    debugCanvas     = document.getElementById('debug-canvas');
    graticuleCanvas = document.getElementById('graticule-canvas');
    timezoneCanvas  = document.getElementById('timezone-canvas');
    politicalCanvas = document.getElementById('political-canvas');

    mapCtx       = mapCanvas.getContext('2d', {alpha: false});
    shadowCtx    = shadowCanvas.getContext('2d');
    debugCtx     = debugCanvas.getContext('2d');
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

    if (name === 'twilight-bounds') {
      if (visible) {
        drawShadow();
      } else {
        drawShadow();
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

  /** Toggle the debug overlay (subsolar point + terminator line). */
  function setDebugOverlay(visible) {
    debugVisible = visible;
    if (visible) {
      debugCanvas.style.display = 'block';
      requestAnimationFrame(() => drawDebugOverlay());
    } else {
      debugCanvas.classList.remove('visible');
      setTimeout(() => { debugCanvas.style.display = 'none'; }, 100);
    }
  }

  return { init, setMode, setMapImage, setOverlay, setTerminatorMode, setDebugOverlay };

})();
