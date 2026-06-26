/**
 * inclination.js — 3D orthographic globe with axial tilt visualisation
 *
 * Earth as seen from the ecliptic plane, Sun to the right.
 * Shows continents, terminator, equator, tropics, polar circles,
 * and the current axial tilt (subsolar reference).
 *
 * Public API:
 *   Inclination.setData(countriesGeo)
 *   Inclination.init()
 *   Inclination.setVisible(v)
 *   Inclination.draw()
 */
const Inclination = (() => {
  'use strict';

  let canvas       = null;
  let ctx          = null;
  let timerId      = null;
  let countriesGeo = null;
  let visible      = true;

  const PANEL_SIZE = 260;
  let size = PANEL_SIZE;
  let DPR  = 1;

  let proj   = null;
  let pathFn = null;

  // ── Setup D3 projection ──────────────────────────────────────────
  function setupProjection(sub) {
    const R = size * 0.38;
    const cx = size * 0.47;
    const cy = size * 0.50;

    proj = d3.geoOrthographic()
      .rotate([sub.lon - 90, 0])
      .fitSize([R * 2 * 0.97, R * 2 * 0.97], { type: 'Sphere' })
      .translate([cx, cy]);

    pathFn = d3.geoPath(proj, ctx);
  }

  // ── Drawing ──────────────────────────────────────────────────────
  function draw() {
    if (!ctx || !visible) return;

    const sub = Solar.getSubsolarPoint(TimeSync.now());
    const decRad = sub.decRad;
    const decDeg = sub.lat;

    setupProjection(sub);

    const R = size * 0.38;
    const cx = size * 0.47;
    const cy = size * 0.50;

    ctx.clearRect(0, 0, size, size);

    // ── Background panel ───────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.beginPath();
    roundRect(ctx, 2, 2, size - 4, size - 4, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRect(ctx, 2, 2, size - 4, size - 4, 6);
    ctx.stroke();

    // ── Title ──────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${Math.round(8 * DPR)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('EARTH INCLINATION', cx, 6 * DPR);

    // ── Rotate canvas to show Earth's axial tilt ───────────────────
    // Matches reference: transform:rotate(Declination deg)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(decRad);
    ctx.translate(-cx, -cy);

    // ── Day/night shading (clip to sphere) ─────────────────────────
    ctx.save();
    ctx.beginPath();
    pathFn({ type: 'Sphere' });
    ctx.clip();

    // Light from right — gradient from bright (right) to dark (left)
    const grad = ctx.createLinearGradient(cx + R * 0.9, cy, cx - R * 0.9, cy);
    grad.addColorStop(0.0, 'rgba(255,235,200,0.14)');
    grad.addColorStop(0.4, 'rgba(255,235,200,0.04)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(0.6, 'rgba(0,5,22,0.25)');
    grad.addColorStop(1.0, 'rgba(0,5,22,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - R * 1.5, cy - R * 1.5, R * 3, R * 3);

    ctx.restore();

    // ── Continents ─────────────────────────────────────────────────
    if (countriesGeo) {
      ctx.save();
      ctx.beginPath();
      pathFn({ type: 'Sphere' });
      ctx.clip();

      ctx.fillStyle = 'rgba(140,180,120,0.40)';
      for (const feat of countriesGeo.features) {
        ctx.beginPath();
        pathFn(feat);
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(140,180,120,0.55)';
      ctx.lineWidth = Math.max(0.5, 0.6 * DPR);
      for (const feat of countriesGeo.features) {
        ctx.beginPath();
        pathFn(feat);
        ctx.stroke();
      }

      ctx.restore();
    }

    // ── Sphere outline ─────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = Math.max(1, 1.2 * DPR);
    ctx.beginPath();
    pathFn({ type: 'Sphere' });
    ctx.stroke();

    // ── Equator ────────────────────────────────────────────────────
    const equator = { type: 'LineString', coordinates: [] };
    for (let lon = -180; lon <= 180; lon += 1) {
      equator.coordinates.push([lon, 0]);
    }
    ctx.strokeStyle = 'rgba(120,220,160,0.45)';
    ctx.lineWidth = Math.max(0.8, 0.9 * DPR);
    ctx.beginPath();
    pathFn(equator);
    ctx.stroke();

    const eqLabelPt = proj([sub.lon - 50, 0]);
    if (eqLabelPt) {
      ctx.fillStyle = 'rgba(120,220,160,0.50)';
      ctx.font = `${Math.round(6.5 * DPR)}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('Equator', eqLabelPt[0], eqLabelPt[1] + 3 * DPR);
    }

    // ── Tropics ────────────────────────────────────────────────────
    const tropLat = 23.44;
    const tropicNorth = { type: 'LineString', coordinates: [] };
    const tropicSouth = { type: 'LineString', coordinates: [] };
    for (let lon = -180; lon <= 180; lon += 1) {
      tropicNorth.coordinates.push([lon,  tropLat]);
      tropicSouth.coordinates.push([lon, -tropLat]);
    }
    ctx.strokeStyle = 'rgba(255,210,100,0.35)';
    ctx.lineWidth = Math.max(0.5, 0.6 * DPR);
    ctx.setLineDash([3 * DPR, 3 * DPR]);
    ctx.beginPath(); pathFn(tropicNorth); ctx.stroke();
    ctx.beginPath(); pathFn(tropicSouth); ctx.stroke();
    ctx.setLineDash([]);

    // ── Polar circles ──────────────────────────────────────────────
    const polarLat = 66.56;
    const polarNorth = { type: 'LineString', coordinates: [] };
    const polarSouth = { type: 'LineString', coordinates: [] };
    for (let lon = -180; lon <= 180; lon += 1) {
      polarNorth.coordinates.push([lon,  polarLat]);
      polarSouth.coordinates.push([lon, -polarLat]);
    }
    ctx.strokeStyle = 'rgba(140,200,255,0.30)';
    ctx.lineWidth = Math.max(0.5, 0.6 * DPR);
    ctx.setLineDash([2 * DPR, 3 * DPR]);
    ctx.beginPath(); pathFn(polarNorth); ctx.stroke();
    ctx.beginPath(); pathFn(polarSouth); ctx.stroke();
    ctx.setLineDash([]);

    // ── Axis line ──────────────────────────────────────────────────
    const np = proj([sub.lon - 90,  90]);
    const sp = proj([sub.lon - 90, -90]);

    if (np && sp) {
      const dx = np[0] - sp[0];
      const dy = np[1] - sp[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const axisExt = R * 0.08;
      const ux = dx / len;
      const uy = dy / len;
      const nx = np[0] + ux * axisExt;
      const ny = np[1] + uy * axisExt;
      const sx = sp[0] - ux * axisExt;
      const sy = sp[1] - uy * axisExt;

      ctx.strokeStyle = 'rgba(255,200,100,0.60)';
      ctx.lineWidth = Math.max(1.2, 1.5 * DPR);
      ctx.setLineDash([4 * DPR, 4 * DPR]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      ctx.setLineDash([]);

      // N / S labels
      const lblOff = 7 * DPR;
      ctx.font = `bold ${Math.round(9 * DPR)}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,200,100,0.80)';
      ctx.textBaseline = 'bottom';
      ctx.fillText('N', np[0], np[1] - lblOff);
      ctx.fillStyle = 'rgba(255,200,100,0.60)';
      ctx.textBaseline = 'top';
      ctx.fillText('S', sp[0], sp[1] + lblOff);
    }

    // ── Subsolar point ─────────────────────────────────────────────
    const ss = proj([sub.lon, sub.lat]);
    if (ss && isFinite(ss[0]) && isFinite(ss[1]) &&
        Math.abs(ss[0] - cx) < R * 1.05 && Math.abs(ss[1] - cy) < R * 1.05) {
      const glow = ctx.createRadialGradient(ss[0], ss[1], 0, ss[0], ss[1], 7 * DPR);
      glow.addColorStop(0, 'rgba(255,200,80,0.60)');
      glow.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ss[0], ss[1], 7 * DPR, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = '#ffcc44';
      ctx.beginPath();
      ctx.arc(ss[0], ss[1], 2.5 * DPR, 0, 2 * Math.PI);
      ctx.fill();
    }

    // ── End of rotated section ─────────────────────────────────────
    ctx.restore();

    // ── Subtitle ───────────────────────────────────────────────────
    const ns = decDeg >= 0 ? 'N' : 'S';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = `${Math.round(7 * DPR)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      `Subsolar ${Math.abs(decDeg).toFixed(1)}°${ns}`,
      cx, size - 6 * DPR
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function resize() {
    DPR = window.devicePixelRatio || 1;
    size = PANEL_SIZE;
    const dprSize = Math.round(size * DPR);
    if (canvas.width !== dprSize || canvas.height !== dprSize) {
      canvas.width  = dprSize;
      canvas.height = dprSize;
      canvas.style.width  = size + 'px';
      canvas.style.height = size + 'px';
    }
    ctx = canvas.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // ── Public API ───────────────────────────────────────────────────
  function setData(data) {
    countriesGeo = data;
    if (ctx) draw();
  }

  function setVisible(v) {
    visible = v;
    const el = document.getElementById('inclination-panel');
    if (el) el.style.display = v ? '' : 'none';
    if (v && ctx) draw();
  }

  function isVisible() { return visible; }

  function refresh() {
    resize();
    draw();
  }

  function init() {
    canvas = document.getElementById('inclination-canvas');
    if (!canvas) return;

    refresh();

    timerId = setInterval(draw, 60000);
    window.addEventListener('resize', refresh);

    // Fullscreen API (F11 may fire this in some browsers; covers programmatic fullscreen)
    document.addEventListener('fullscreenchange', refresh);
    document.addEventListener('webkitfullscreenchange', refresh);
  }

  function destroy() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return { init, destroy, draw, setData, setVisible, isVisible };

})();
