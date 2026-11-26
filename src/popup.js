(function () {
  'use strict';

  const DEFAULTS = { blocked: {}, mode: 'placeholder' };

  const listEl = document.getElementById('list');
  const countEl = document.getElementById('count');
  const emptyEl = document.getElementById('empty');
  const pickBtn = document.getElementById('pick');
  const statusEl = document.getElementById('status');
  const modeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-mode]'));

  let blocked = {};
  let mode = DEFAULTS.mode;

  function initial(name) {
    const text = (name || '').trim();
    return text ? Array.from(text)[0] : '?';
  }

  function renderMode() {
    modeButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  function renderList() {
    const ids = Object.keys(blocked).sort(function (a, b) {
      return (blocked[b].ts || 0) - (blocked[a].ts || 0);
    });

    countEl.textContent = String(ids.length);
    emptyEl.hidden = ids.length > 0;
    listEl.textContent = '';

    for (const id of ids) {
      const entry = blocked[id] || {};
      const li = document.createElement('li');

      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = initial(entry.name);

      const meta = document.createElement('div');
      meta.className = 'meta';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = entry.name || '(未命名用户)';

      const uid = document.createElement('div');
      uid.className = 'uid';
      const aliasCount = Array.isArray(entry.aliases) ? entry.aliases.length : 0;
      uid.textContent = 'ID ' + id + (aliasCount ? ' · 别名 ' + aliasCount : '');
      if (aliasCount) uid.title = entry.aliases.join('\n');

      meta.appendChild(name);
      meta.appendChild(uid);

      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.type = 'button';
      remove.textContent = '解除';
      remove.addEventListener('click', function () {
        chrome.storage.local.get(DEFAULTS, function (value) {
          const next = Object.assign({}, value.blocked);
          delete next[id];
          chrome.storage.local.set({ blocked: next });
        });
      });

      li.appendChild(avatar);
      li.appendChild(meta);
      li.appendChild(remove);
      listEl.appendChild(li);
    }
  }

  function apply(value) {
    blocked = value.blocked && typeof value.blocked === 'object' ? value.blocked : {};
    mode = value.mode === 'hide' ? 'hide' : 'placeholder';
    renderMode();
    renderList();
  }

  modeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (mode === btn.dataset.mode) return;
      mode = btn.dataset.mode;
      renderMode();
      chrome.storage.local.set({ mode: mode });
    });
  });

  pickBtn.addEventListener('click', function () {
    chrome.storage.local.set({ pickRequest: Date.now() }, function () {
      if (statusEl) statusEl.textContent = '已进入拾取模式';
      window.close();
    });
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    chrome.storage.local.get(DEFAULTS, apply);
  });

  chrome.storage.local.get(DEFAULTS, apply);
})();
