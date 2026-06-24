/**
 * clock.js — UTC and local time display
 *
 * Updates the DOM elements #utc-time, #local-time, #utc-date
 * every second using the browser's Date API.  No server calls.
 *
 * Public API:
 *   Clock.init()
 *   Clock.destroy()
 */
const Clock = (() => {
  'use strict';

  let utcTimeEl  = null;
  let localTimeEl = null;
  let utcDateEl  = null;
  let debugSubEl = null;
  let debugTermEl = null;
  let timerId    = null;

  const MONTHS = [
    'JAN','FEB','MAR','APR','MAY','JUN',
    'JUL','AUG','SEP','OCT','NOV','DEC'
  ];

  const DAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatHMS(h, m, s) {
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function tick() {
    const now = new Date();

    // UTC time
    const utcH = now.getUTCHours();
    const utcM = now.getUTCMinutes();
    const utcS = now.getUTCSeconds();
    utcTimeEl.textContent = formatHMS(utcH, utcM, utcS) + ' UTC';

    // Local time with timezone abbreviation (best-effort)
    const locH = now.getHours();
    const locM = now.getMinutes();
    const locS = now.getSeconds();
    // Try to extract short timezone name from Intl API
    let tzLabel = 'Local';
    try {
      const parts = new Intl.DateTimeFormat('en', {
        timeZoneName: 'short',
      }).formatToParts(now);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      if (tzPart) tzLabel = tzPart.value;
    } catch (_) { /* Intl not available */ }

    localTimeEl.textContent = formatHMS(locH, locM, locS) + ' ' + tzLabel;

    // UTC date line (updates naturally as H:M:S crosses midnight)
    const day  = DAYS[now.getUTCDay()];
    const date = pad2(now.getUTCDate());
    const mon  = MONTHS[now.getUTCMonth()];
    const yr   = now.getUTCFullYear();
    utcDateEl.textContent = `${day} ${date} ${mon} ${yr}`;

    // Debug info — subsolar position + terminator range
    if (debugSubEl && debugTermEl) {
      const sub = Solar.getSubsolarPoint(now);
      const ns = sub.lat >= 0 ? 'N' : 'S';
      const ew = sub.lon >= 0 ? 'E' : 'W';
      const maxLat = 90 - Math.abs(sub.lat);
      const maxNs = sub.lat >= 0 ? 'N' : 'S';
      debugSubEl.textContent =
        `☀ ${Math.abs(sub.lat).toFixed(1)}°${ns} ${Math.abs(sub.lon).toFixed(1)}°${ew}`;
      debugTermEl.textContent = `⊡ Term max: ${maxLat.toFixed(1)}°${maxNs}`;
    }
  }

  function init() {
    utcTimeEl   = document.getElementById('utc-time');
    localTimeEl = document.getElementById('local-time');
    utcDateEl   = document.getElementById('utc-date');
    debugSubEl  = document.getElementById('debug-subsolar');
    debugTermEl = document.getElementById('debug-term');

    tick(); // immediate first draw, no blank flash
    timerId = setInterval(tick, 1000);
  }

  function destroy() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return { init, destroy };

})();
