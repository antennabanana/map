/**
 * clock.js — UTC and local time display
 *
 * Uses TimeSync.now() for synced UTC time with fallback to local.
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
  let syncStatusEl = null;
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
    const now = TimeSync.now();

    const utcH = now.getUTCHours();
    const utcM = now.getUTCMinutes();
    const utcS = now.getUTCSeconds();
    utcTimeEl.textContent = formatHMS(utcH, utcM, utcS) + ' UTC';

    const locH = now.getHours();
    const locM = now.getMinutes();
    const locS = now.getSeconds();
    let tzLabel = 'Local';
    try {
      const parts = new Intl.DateTimeFormat('en', {
        timeZoneName: 'short',
      }).formatToParts(now);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      if (tzPart) tzLabel = tzPart.value;
    } catch (_) {}

    localTimeEl.textContent = formatHMS(locH, locM, locS) + ' ' + tzLabel;

    const day  = DAYS[now.getUTCDay()];
    const date = pad2(now.getUTCDate());
    const mon  = MONTHS[now.getUTCMonth()];
    const yr   = now.getUTCFullYear();
    utcDateEl.textContent = `${day} ${date} ${mon} ${yr}`;

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

    if (syncStatusEl) {
      if (TimeSync.isSynced()) {
        var src = TimeSync.getSource();
        var off = TimeSync.getOffset();
        var offStr = off >= 0 ? '+' + off : '' + off;
        syncStatusEl.className = 'ready';
        syncStatusEl.innerHTML =
          '<span class="sync-dot ready">●</span>' +
          '<span class="sync-label">' + src + ' · ' + offStr + ' ms</span>';
      } else {
        syncStatusEl.className = '';
        syncStatusEl.innerHTML =
          '<span class="sync-dot pending">○</span>' +
          '<span class="sync-label">Time sync&hellip;</span>';
      }
    }
  }

  function init() {
    utcTimeEl    = document.getElementById('utc-time');
    localTimeEl  = document.getElementById('local-time');
    utcDateEl    = document.getElementById('utc-date');
    debugSubEl   = document.getElementById('debug-subsolar');
    debugTermEl  = document.getElementById('debug-term');
    syncStatusEl = document.getElementById('timesync-status');

    TimeSync.init();

    tick();
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
