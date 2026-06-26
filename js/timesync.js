/**
 * timesync.js — HTTP-based time synchronisation (browser NTP approximation)
 *
 * Fetches time from multiple server sources with fallback chain.
 * Exposes TimeSync.now() → Date (adjusted by sync offset).
 *
 * Public API:
 *   TimeSync.init()
 *   TimeSync.now()       → Date (synced or fallback to local)
 *   TimeSync.getOffset() → number (ms, 0 if unsynced)
 *   TimeSync.isSynced()  → boolean
 *   TimeSync.getSource() → string | null
 */
const TimeSync = (() => {
  'use strict';

  let _offset  = 0;        // ms to add to local Date.now() to get true UTC
  let _synced  = false;
  let _source  = null;
  let _syncing = false;

  const SOURCES = [
    { name:'timeapi.io',
      url:'https://timeapi.io/api/time/current/zone?timeZone=UTC',
      parse: function(txt) {
        var j = JSON.parse(txt);
        var dt = j.dateTime || j.datetime;
        if (!dt) return null;
        if (dt.indexOf('Z') < 0 && dt.indexOf('+') < 0) dt += 'Z';
        return new Date(dt).getTime();
      }
    },
    { name:'worldtimeapi',
      url:'https://worldtimeapi.org/api/timezone/UTC',
      parse: function(txt) {
        var j = JSON.parse(txt);
        if (j.utc_datetime) return new Date(j.utc_datetime).getTime();
        return j.unixtime ? j.unixtime * 1000 : null;
      }
    },
    { name:'cloudflare',
      url:'https://www.cloudflare.com/cdn-cgi/trace',
      parse: function(txt) {
        var m = txt.match(/ts=(\d+\.\d+)/);
        return m ? Math.round(parseFloat(m[1]) * 1000) : null;
      }
    },
    { name:'1.1.1.1',
      url:'https://1.1.1.1/cdn-cgi/trace',
      parse: function(txt) {
        var m = txt.match(/ts=(\d+\.\d+)/);
        return m ? Math.round(parseFloat(m[1]) * 1000) : null;
      }
    },
    { name:'akamai',
      url:'https://time.akamai.com/?ms',
      parse: function(txt) {
        var n = parseFloat(txt.trim());
        return isNaN(n) ? null : Math.round(n);
      }
    },
    { name:'jsontest',
      url:'https://time.jsontest.com/',
      parse: function(txt) {
        var j = JSON.parse(txt);
        return j.milliseconds_since_epoch ? parseInt(j.milliseconds_since_epoch) : null;
      }
    },
    /* Date-header fallbacks (parse:null → read Date header) */
    { name:'httpbin',       url:'https://httpbin.org/headers',                 parse: null },
    { name:'github-api',    url:'https://api.github.com/',                     parse: null },
    { name:'cfapi',         url:'https://api.cloudflare.com/client/v4/',       parse: null },
    { name:'googleapis',    url:'https://www.googleapis.com/discovery/v1/apis', parse: null },
  ];

  function syncOne(src) {
    return new Promise(function(resolve, reject) {
      var t0 = Date.now();
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var tid = setTimeout(function() {
        if (controller) controller.abort();
        reject(new Error('timeout'));
      }, 4000);
      var opts = { cache: 'no-store' };
      if (controller) opts.signal = controller.signal;
      fetch(src.url, opts)
        .then(function(resp) {
          clearTimeout(tid);
          var t1 = Date.now();
          if (src.parse) {
            return resp.text().then(function(txt) {
              var serverMs = src.parse(txt);
              if (serverMs === null || isNaN(serverMs)) throw new Error('parse fail');
              var rtt = t1 - t0;
              resolve({ name: src.name, offset: Math.round(serverMs - t1 + rtt / 2) });
            });
          } else {
            var dateHdr = resp.headers.get('Date');
            if (!dateHdr) { reject(new Error('no Date header')); return; }
            var serverMs2 = new Date(dateHdr).getTime();
            var rtt2 = t1 - t0;
            resolve({ name: src.name, offset: Math.round(serverMs2 - t1 + rtt2 / 2) });
          }
        })
        .catch(function(err) { clearTimeout(tid); reject(err); });
    });
  }

  function syncFromList() {
    if (_syncing) return;
    _syncing = true;
    var i = 0;
    function tryNext() {
      if (i >= SOURCES.length) {
        _syncing = false;
        return;
      }
      var src = SOURCES[i++];
      syncOne(src).then(function(result) {
        _offset = result.offset;
        _source = result.name;
        _synced = true;
        _syncing = false;
        var el = document.getElementById('timesync-status');
        if (el) el.classList.add('ready');
      }).catch(function() { tryNext(); });
    }
    tryNext();
  }

  function now() {
    return new Date(Date.now() + getOffset());
  }

  function getOffset() {
    return _synced ? _offset : 0;
  }

  function isSynced() {
    return _synced;
  }

  function getSource() {
    return _source;
  }

  function init() {
    syncFromList();
  }

  return { init, now, getOffset, isSynced, getSource };

})();
