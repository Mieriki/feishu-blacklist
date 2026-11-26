(function () {
  'use strict';

  const TAG = '__fblk';
  const DEFAULTS = { blocked: {}, mode: 'placeholder' };

  let state = { blocked: {}, mode: DEFAULTS.mode };
  let pushedAtLeastOnce = false;

  function normalizeMode(mode) {
    return mode === 'hide' ? 'hide' : 'placeholder';
  }

  function normalizeBlocked(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const key of Object.keys(raw)) {
      const entry = raw[key];
      if (!entry || typeof entry !== 'object') continue;
      const aliases = Array.isArray(entry.aliases)
        ? entry.aliases.filter(function (a) {
            return typeof a === 'string' && a;
          })
        : [];
      out[String(key)] = {
        name: typeof entry.name === 'string' ? entry.name : '',
        aliases: aliases,
        ts: Number(entry.ts) || 0
      };
    }
    return out;
  }

  function pushState() {
    pushedAtLeastOnce = true;
    window.postMessage(
      { __fblk: true, from: 'bridge', type: 'state', payload: state },
      '*'
    );
  }

  function loadState() {
    chrome.storage.local.get(DEFAULTS, function (value) {
      state = {
        blocked: normalizeBlocked(value.blocked),
        mode: normalizeMode(value.mode)
      };
      pushState();
    });
  }

  function persistBlocked(blocked) {
    state = { blocked: blocked, mode: state.mode };
    chrome.storage.local.set({ blocked: blocked });
  }

  function handlePageMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__fblk !== true || data.from !== 'page') return;

    switch (data.type) {
      case 'ready':
        if (!pushedAtLeastOnce) loadState();
        else pushState();
        break;

      case 'block': {
        const payload = data.payload || {};
        const id = typeof payload.id === 'string' ? payload.id : '';
        if (!id) return;
        const blocked = Object.assign({}, state.blocked);
        const aliases = Array.isArray(payload.aliases)
          ? payload.aliases.filter(function (a) {
              return typeof a === 'string' && a;
            })
          : [];
        blocked[id] = {
          name: typeof payload.name === 'string' ? payload.name : '',
          aliases: aliases,
          ts: Date.now()
        };
        persistBlocked(blocked);
        break;
      }

      case 'unblock': {
        const payload = data.payload || {};
        const id = typeof payload.id === 'string' ? payload.id : '';
        if (!id || !state.blocked[id]) return;
        const blocked = Object.assign({}, state.blocked);
        delete blocked[id];
        persistBlocked(blocked);
        break;
      }

      case 'setMode': {
        const mode = normalizeMode(data.payload && data.payload.mode);
        state = { blocked: state.blocked, mode: mode };
        chrome.storage.local.set({ mode: mode });
        break;
      }

      default:
        break;
    }
  }

  window.addEventListener('message', handlePageMessage);

  function pushPick() {
    window.postMessage({ __fblk: true, from: 'bridge', type: 'pick', payload: { on: true } }, '*');
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.pickRequest && changes.pickRequest.newValue) {
      pushPick();
      // 消费掉请求，避免刷新页面后再次进入拾取模式
      chrome.storage.local.remove('pickRequest');
    }
    if (changes.blocked) state = { blocked: normalizeBlocked(changes.blocked.newValue), mode: state.mode };
    if (changes.mode) state = { blocked: state.blocked, mode: normalizeMode(changes.mode.newValue) };
    if (changes.blocked || changes.mode) pushState();
  });

  loadState();

  // 页面加载时清掉残留的拾取请求，避免下次打开飞书突然进入拾取模式
  chrome.storage.local.get({ pickRequest: null }, function (value) {
    if (value.pickRequest) chrome.storage.local.remove('pickRequest');
  });
})();
