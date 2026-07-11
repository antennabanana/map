/**
 * solar.js — Sun position and day/night shadow computation
 *
 * No external dependencies. Uses low-precision solar almanac formulas
 * accurate to within ~1° for display purposes (sub-pixel error at 4–6K).
 *
 * Public API:
 *   Solar.getSubsolarPoint(date?)  → { lat, lon, decRad, lonRad }
 *   Solar.computeShadow(w, h, sub) → ImageData
 */
const Solar = (() => {
  'use strict';

  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;

  // Night overlay colour — dark navy
  const NIGHT_R = 0;
  const NIGHT_G = 5;
  const NIGHT_B = 22;
  // Max shadow alpha (0.72 opacity = 184 out of 255)
  const NIGHT_ALPHA = Math.round(0.72 * 255); // 184

  // ── Twilight zone thresholds ────────────────────────────────────
  // The four zones follow the standard astronomical definitions.
  // Thresholds are stored as sin(elevation angle) — the same unit
  // used by the pixel-level shadow formula, so no extra trig per pixel.
  //
  //   Civil twilight      0°  → −6°  (horizon to SIN_CIVIL)
  //   Nautical twilight  −6°  → −12° (SIN_CIVIL   to SIN_NAUTICAL)
  //   Astronomical twil −12°  → −18° (SIN_NAUTICAL to SIN_ASTRO)
  //   Night, no twil.   < −18°        (below SIN_ASTRO)
  //
  const SIN_CIVIL    = Math.sin( 6 * DEG);  // 0.1045
  const SIN_NAUTICAL = Math.sin(12 * DEG);  // 0.2079
  const SIN_ASTRO    = Math.sin(18 * DEG);  // 0.3090

  // Shadow opacity at each zone boundary.
  // NIGHT_ALPHA = 184 (72 % of 255) is the maximum — full night.
  const ALPHA_CIVIL    = Math.round(NIGHT_ALPHA * 0.93);  // 171
  const ALPHA_NAUTICAL = Math.round(NIGHT_ALPHA * 0.97);  // 178
  const ALPHA_ASTRO    = Math.round(NIGHT_ALPHA * 0.99);  // 182
  // Full night → NIGHT_ALPHA = 184 — deepest shadow

  /* ─────────────────────────────────────────────────────────────
   * getSubsolarPoint(date)
   *
   * Returns the geographic point directly beneath the Sun.
   * Algorithm: low-precision solar coordinates from Meeus "Astronomical
   * Algorithms", adapted for JS.
   *
   * Returns:
   *   lat    – subsolar latitude  (degrees, −90 … +90)
   *   lon    – subsolar longitude (degrees, −180 … +180)
   *   decRad – solar declination  (radians)
   *   lonRad – subsolar longitude (radians)
   * ───────────────────────────────────────────────────────────── */
  function getSubsolarPoint(date) {
    const d = date instanceof Date ? date : new Date();

    // Julian date and days since J2000.0
    const JD = d.getTime() / 86400000.0 + 2440587.5;
    const n  = JD - 2451545.0;

    // Solar mean longitude (degrees, normalised)
    const L = ((280.46 + 0.9856474 * n) % 360 + 360) % 360;

    // Solar mean anomaly (radians)
    const g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360 * DEG;

    // Ecliptic longitude (radians) — equation of centre
    const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;

    // Obliquity of the ecliptic (radians) — secular term included
    const eps = (23.439 - 0.0000004 * n) * DEG;

    // Solar declination (radians)
    const decRad = Math.asin(Math.sin(eps) * Math.sin(lambda));

    // Right ascension (radians)
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));

    // Greenwich Mean Sidereal Time (degrees, normalised)
    const GMST = ((280.46061837 + 360.98564736629 * n) % 360 + 360) % 360;

    // Subsolar longitude: lon = RA − GMST, normalised to [−180, +180]
    //
    // Derivation: at the subsolar point, the local hour angle H = 0.
    // H = LST − RA = (GMST + lon) − RA = 0  ⟹  lon = RA − GMST
    //
    // The incorrect form (GMST − RA) gives the Greenwich Hour Angle (GHA),
    // which is westward-positive — the opposite sign to east-positive longitude.
    // GHA and longitude agree only at noon (0°) and midnight (±180°).
    let lon = ((ra * RAD - GMST) % 360 + 360) % 360;
    if (lon > 180) lon -= 360;

    return {
      lat:    decRad * RAD,
      lon:    lon,
      decRad: decRad,
      lonRad: lon * DEG,
    };
  }

  /* ─────────────────────────────────────────────────────────────
   * computeShadow(width, height, sub [, bandMode])
   *
   * Fills an ImageData buffer with the four-zone day/twilight/night
   * overlay for an equirectangular canvas of (width × height) pixels.
   *
   * bandMode = false  Standard: full dark night hemisphere, matching
   *   a traditional day/night map.
   *
   * bandMode = true   Band (Geochron Atlas style): the night side is
   *   fully dark everywhere EXCEPT the "always-night" polar cap, which
   *   fades from NIGHT_ALPHA at the Arctic/Antarctic Circle down to 0
   *   at the pole.  This removes the flat horizontal cap that appears
   *   at solstice and makes the terminator sweep cleanly from map edge
   *   to map edge — exactly as seen in the Geochron September image.
   *   Near the equinox the polar fade zone is tiny, so the result is
   *   visually identical to Standard.
   *
   * Zone mapping (both modes share the same twilight transition):
   *   sinElev ≥  0             → Day               (alpha = 0)
   *   sinElev ∈ [0, −sin 6°]   → Civil twilight    (alpha 0 → 171)
   *   sinElev ∈ [−sin6,−sin12] → Nautical          (alpha 171 → 178)
   *   sinElev ∈ [−sin12,−sin18]→ Astronomical      (alpha 178 → 182)
   *   sinElev ≤ −sin 18°       → Night             (alpha = 184)
   *
   *   Band only — additional polar-cap fade applied after the above:
   *   At the Arctic/Antarctic Circle (lat = ±(90°−|dec|)) the cap
   *   begins, and alpha smoothly falls to 0 at ±90° (the pole).
   * ───────────────────────────────────────────────────────────── */
  function computeShadow(width, height, sub, bandMode) {
    const buf = new Uint8ClampedArray(width * height * 4);

    const sinDec    = Math.sin(sub.decRad);
    const cosDec    = Math.cos(sub.decRad);
    const lonSun    = sub.lonRad;
    const cosLonSun = Math.cos(lonSun);
    const sinLonSun = Math.sin(lonSun);

    // ── Band-mode polar cap parameters ───────────────────────────
    // polarThreshold = latitude of the Arctic/Antarctic Circle
    //   = π/2 − |dec|  (in radians)
    // Beyond this latitude (toward the pole), the shadow fades to 0.
    // Guard: if |dec| < 0.001 rad (≈0.06°, near equinox), the fade
    // zone is sub-pixel; skip it to avoid division-by-zero.
    const absDec         = Math.abs(sub.decRad);
    const doPolarFade    = bandMode && (absDec > 0.001);
    const polarThreshold = doPolarFade ? (Math.PI / 2 - absDec) : Infinity;

    // Precompute cos/sin of each column's longitude — O(width)
    const cosLon = new Float32Array(width);
    const sinLon = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      const lon = (x / width - 0.5) * (2 * Math.PI);
      cosLon[x] = Math.cos(lon);
      sinLon[x] = Math.sin(lon);
    }

    // cos(lon − lonSun) — reused every row
    const cosLonDiff = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      cosLonDiff[x] = cosLon[x] * cosLonSun + sinLon[x] * sinLonSun;
    }

    // Row loop
    for (let y = 0; y < height; y++) {
      const lat    = (0.5 - (y + 0.5) / height) * Math.PI;
      const sinLat = Math.sin(lat);
      const cosLat = Math.cos(lat);

      const rowBase   = sinLat * sinDec;
      const rowFactor = cosLat * cosDec;
      const rowOffset = y * width;

      // Polar-cap fade for this row (band mode only).
      // t = 0 at the Arctic/Antarctic Circle, 1 at the pole.
      // fade = smoothstep from 1 → 0.
      const absLat = lat < 0 ? -lat : lat;
      let polarFade = 1.0;
      if (doPolarFade && absLat > polarThreshold) {
        const t = (absLat - polarThreshold) / absDec; // 0 at circle, 1 at pole
        const ct = t < 1.0 ? t : 1.0;
        polarFade = 1.0 - ct * ct * (3.0 - 2.0 * ct); // smoothstep ↓
      }

      for (let x = 0; x < width; x++) {
        const shadowValue = bandMode
          ? cosLonDiff[x] + rowBase * 0.6
          : rowBase + rowFactor * cosLonDiff[x];

        let alpha;
        if (shadowValue >= 0.3) {
          alpha = 0;

        } else if (shadowValue >= -SIN_CIVIL) {
          const range = SIN_CIVIL + 0.3;
          const t = (0.3 - shadowValue) / range;
          alpha = (ALPHA_CIVIL * t * t * (3.0 - 2.0 * t) + 0.5) | 0;

        } else if (shadowValue >= -SIN_NAUTICAL) {
          const t = (-shadowValue - SIN_CIVIL) / (SIN_NAUTICAL - SIN_CIVIL);
          alpha = (ALPHA_CIVIL + (ALPHA_NAUTICAL - ALPHA_CIVIL) * t * t * (3.0 - 2.0 * t) + 0.5) | 0;

        } else if (shadowValue >= -SIN_ASTRO) {
          const t = (-shadowValue - SIN_NAUTICAL) / (SIN_ASTRO - SIN_NAUTICAL);
          alpha = (ALPHA_NAUTICAL + (ALPHA_ASTRO - ALPHA_NAUTICAL) * t * t * (3.0 - 2.0 * t) + 0.5) | 0;

        } else {
          alpha = NIGHT_ALPHA;
        }

        if (polarFade < 1.0 && alpha > 0) {
          alpha = (alpha * polarFade + 0.5) | 0;
        }

        const i = (rowOffset + x) * 4;
        buf[i]     = NIGHT_R;
        buf[i + 1] = NIGHT_G;
        buf[i + 2] = NIGHT_B;
        buf[i + 3] = alpha;
      }
    }

    return new ImageData(buf, width, height);
  }

  /* ─────────────────────────────────────────────────────────────
   * Public interface
   * ───────────────────────────────────────────────────────────── */
  return { getSubsolarPoint, computeShadow };

})();
