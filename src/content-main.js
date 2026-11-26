(function () {
  'use strict';

  if (window.__fblkMainLoaded) return;
  window.__fblkMainLoaded = true;

  const ROW_SELECTOR = '.threadWrapper';
  const MSG_SELECTOR = '.threadMsg[data-message-id]';
  const AUTHOR_SELECTOR = '.threadMsgAuthorName';
  const PANEL_ROW_SELECTOR = '.groupMsgWrap';
  const PANEL_AUTHOR_SELECTOR = '.groupMsgAuthorName';

  const state = { blocked: {}, mode: 'placeholder' };

  const infoCache = new Map();
  let syncScheduled = false;
  let pickMode = false;

  const STYLE_ID = 'fblk-style';
  const STYLE_VERSION = '6';

  function injectStyle() {
    const existing = document.getElementById(STYLE_ID);
    if (existing && existing.getAttribute('data-version') === STYLE_VERSION) return;
    if (existing) existing.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('data-version', STYLE_VERSION);
    style.textContent = [
      '.fblk-bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483001;',
      'display:flex;align-items:center;gap:10px;padding:7px 14px;border-radius:999px;',
      'background:rgba(31,35,41,.93);color:#fff;font-size:13px;',
      'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
      'box-shadow:0 4px 16px rgba(0,0,0,.24);user-select:none;}',
      '.fblk-bar a{color:#8fb4ff;cursor:pointer;text-decoration:none;}',
      '.fblk-bar a:hover{text-decoration:underline;}',
      'body.fblk-picking .threadMsgAuthorName,',
      'body.fblk-picking .threadReplaysItem-author-name,',
      'body.fblk-picking .groupMsgAuthorName{',
      'text-decoration:underline;text-decoration-color:#3370ff;text-decoration-thickness:2px;',
      'text-underline-offset:3px;cursor:pointer;}',
      'body.fblk-picking .threadMsgContentWrapper,',
      'body.fblk-picking .threadReplaysItem,',
      'body.fblk-picking .groupMsgWrap{cursor:pointer;}',
      '.fblk-ph{display:flex;align-items:center;gap:8px;margin:2px 0 2px 44px;padding:2px 10px;',
      'border-left:2px solid #c9cdd3;color:#8f959e;font-size:12px;line-height:20px;',
      'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;user-select:none;}',
      '.fblk-ph-actions{display:flex;gap:10px;}',
      '.fblk-link{color:#8f959e;cursor:pointer;text-decoration:none;transition:color .15s;}',
      '.fblk-link:hover{color:#3370ff;text-decoration:underline;}',
      '.fblk-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:2147483001;',
      'display:flex;align-items:center;gap:12px;padding:8px 14px;border-radius:8px;',
      'background:rgba(31,35,41,.92);color:#fff;font-size:13px;',
      'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
      'box-shadow:0 4px 16px rgba(0,0,0,.24);user-select:none;}',
      '.fblk-toast a{color:#8fb4ff;cursor:pointer;text-decoration:none;}',
      '.fblk-toast a:hover{text-decoration:underline;}',
      '.fblk-panel-mask{position:absolute;inset:0;z-index:2;display:flex;align-items:center;gap:8px;',
      'padding:0 14px;background:#f7f8fa;border-left:2px solid #c9cdd3;color:#8f959e;',
      'font-size:12px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;',
      'user-select:none;cursor:pointer;transition:background-color .15s,color .15s;}',
      '.fblk-panel-mask:hover{background:#eef2f8;color:#3370ff;}',
      '.fblk-panel-hint{color:#b0b4ba;transition:color .15s;}',
      '.fblk-panel-mask:hover .fblk-panel-hint{color:#3370ff;text-decoration:underline;}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function fiberOf(node) {
    const key = Object.keys(node).find(
      (k) => k.indexOf('__reactInternalInstance$') === 0 || k.indexOf('__reactFiber$') === 0
    );
    return key ? node[key] : null;
  }

  function authorFromItem(item) {
    if (!item || !item.author || !item.author.id) return null;
    const author = item.author;
    const names = [];
    const push = (v) => {
      if (typeof v === 'string' && v.trim() && names.indexOf(v.trim()) === -1) names.push(v.trim());
    };
    push(author.localizedName);
    push(author.name);
    push(author.nameWithAnotherName);
    push(author.enUsName);
    push(author.zhCnName);
    push(author.chatExtra && author.chatExtra.nickName);
    return {
      id: String(author.id),
      name: author.localizedName || author.name || '',
      aliases: names,
      isMine: !!item.isMine
    };
  }

  // 主消息：往上的 memoizedProps.messageItem / message
  // 楼中楼回复：深度 1 的 memoizedProps.item，再往上是主消息的 messageItem，不能误用
  function authorOfElement(node, isReplay) {
    let fiber = fiberOf(node);
    if (!fiber) return null;
    const limit = isReplay ? 6 : 20;
    for (let depth = 0; depth < limit && fiber; depth++) {
      const props = fiber.memoizedProps;
      if (props) {
        const item = isReplay ? props.item : props.messageItem || props.message;
        const found = authorFromItem(item);
        if (found) return found;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function getMsgInfo(msgEl) {
    const msgId = msgEl.getAttribute('data-message-id') || '';
    if (msgId && infoCache.has(msgId)) return infoCache.get(msgId);

    const info = authorOfElement(msgEl, false);
    // 只缓存成功结果：fiber 可能稍后才挂上，缓空值会让该条消息永久失效
    if (msgId && info) infoCache.set(msgId, info);
    return info;
  }

  // 帖子详情面板（右侧 .groupMsgWrap，根帖与回复同构）。
  // 实测 messageItem 就在第 1 层 fiber 上，这里只走 4 层：楼层一多容易把回复的点击
  // 归到外层根帖的作者，而屏蔽错人比点不动更糟。
  function authorOfPanelRow(el) {
    let fiber = fiberOf(el);
    for (let depth = 0; depth < 4 && fiber; depth++) {
      const props = fiber.memoizedProps;
      if (props) {
        const found = authorFromItem(props.messageItem);
        if (found) return found;
      }
      fiber = fiber.return;
    }
    return null;
  }

  // 界面显示名才是用户认得的名字（Tanker 的 localizedName 是 Y），
  // 统一并进别名，既能修好提示文案，也能让名字兜底命中。
  function mergeDomName(info, dom) {
    if (!info || !dom) return info;
    if (info.aliases.indexOf(dom) === -1) info.aliases.push(dom);
    if (!info.name || info.name !== dom) info.name = dom;
    return info;
  }

  function domAuthorName(row) {
    const el = row.querySelector(AUTHOR_SELECTOR);
    return el ? (el.textContent || '').trim() : '';
  }

  function rowMessages(row) {
    return row.querySelectorAll(MSG_SELECTOR);
  }

  function decideRow(row) {
    const msgs = rowMessages(row);
    if (!msgs.length) return null;

    let allBlocked = true;
    let blockedName = '';

    for (const msg of msgs) {
      const info = getMsgInfo(msg);
      if (!info || info.isMine) {
        allBlocked = false;
        break;
      }
      const entry = state.blocked[info.id];
      if (!entry) {
        allBlocked = false;
        break;
      }
      if (!blockedName) blockedName = entry.name || info.name || domAuthorName(row);
    }

    if (!allBlocked) return null;
    return { name: blockedName || '该用户' };
  }

  function clearRow(row) {
    row.removeAttribute('data-fblk');
    row.style.removeProperty('display');
    const container = row.querySelector('.message-container');
    if (container) container.style.removeProperty('display');
    const ph = row.querySelector('.fblk-ph');
    if (ph) ph.remove();
  }

  function applyHide(row) {
    row.querySelectorAll('.fblk-ph').forEach((n) => n.remove());
    const container = row.querySelector('.message-container');
    if (container) container.style.removeProperty('display');
    row.style.display = 'none';
  }

  function applyPlaceholder(row, name) {
    row.style.removeProperty('display');
    const container = row.querySelector('.message-container');
    if (container) container.style.display = 'none';

    let ph = row.querySelector('.fblk-ph');
    if (!ph) {
      ph = document.createElement('div');
      ph.className = 'fblk-ph';
      ph.innerHTML =
        '<span class="fblk-ph-text"></span>' +
        '<span class="fblk-ph-actions">' +
        '<a class="fblk-link fblk-show">点击查看</a>' +
        '<a class="fblk-link fblk-unblock">取消屏蔽</a>' +
        '</span>';
      row.appendChild(ph);

      ph.querySelector('.fblk-show').addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        row.setAttribute('data-fblk-expanded', '1');
        clearRow(row);
      });

      ph.querySelector('.fblk-unblock').addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const msgs = rowMessages(row);
        const info = msgs.length ? getMsgInfo(msgs[0]) : null;
        if (!info) return;
        postToBridge('unblock', { id: info.id });
      });
    }

    const text = ph.querySelector('.fblk-ph-text');
    const next = '已屏蔽 ' + name + ' 的消息';
    // 无条件赋值会重建文本节点，触发自身的 MutationObserver 空转
    if (text && text.textContent !== next) text.textContent = next;
  }

  function syncRow(row) {
    const msgs = rowMessages(row);
    if (!msgs.length) return;

    const firstMsgId = msgs[0].getAttribute('data-message-id') || '';
    const lastMsgId = row.getAttribute('data-fblk-msg');
    if (lastMsgId !== firstMsgId) {
      row.removeAttribute('data-fblk-expanded');
      row.setAttribute('data-fblk-msg', firstMsgId);
    }

    if (row.getAttribute('data-fblk-expanded') === '1') {
      clearRow(row);
      return;
    }

    const decision = decideRow(row);
    if (!decision) {
      if (row.getAttribute('data-fblk')) clearRow(row);
      return;
    }

    if (state.mode === 'hide') {
      applyHide(row);
      row.setAttribute('data-fblk', 'hide');
    } else {
      applyPlaceholder(row, decision.name);
      row.setAttribute('data-fblk', 'placeholder');
    }
  }

  function syncAll() {
    syncScheduled = false;
    injectStyle();
    const rows = document.querySelectorAll(ROW_SELECTOR);
    for (const row of rows) {
      try {
        syncRow(row);
      } catch (e) {
        /* 单行失败不影响其他行 */
      }
    }
    syncReplays();
    syncPanel();
  }

  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(syncAll);
  }

  function replayDomName(el) {
    const nameEl = el.querySelector('.threadReplaysItem-author-name');
    if (!nameEl) return '';
    return (nameEl.textContent || '').trim().replace(/[:：]\s*$/, '');
  }

  // 昵称兜底：黑名单条目存了别名数组，界面上看到的名字作为其中一个别名，
  // 因为飞书的 localizedName 与界面显示名经常不一致（谢云 vs kimi客服-kimicode）。
  function nameIsBlocked(domName) {
    if (!domName) return false;
    for (const id of Object.keys(state.blocked)) {
      const entry = state.blocked[id] || {};
      if (entry.name === domName) return true;
      const aliases = entry.aliases;
      if (Array.isArray(aliases) && aliases.indexOf(domName) !== -1) return true;
    }
    return false;
  }

  function replayShouldHide(el) {
    const info = authorOfElement(el, true);
    if (info) {
      // 拿到 ID 就以 ID 为准：同名不同人是常态，按名字兜底会误伤
      if (info.isMine) return false;
      return !!state.blocked[info.id];
    }
    // 只有完全取不到 ID 时，才退回按界面显示名匹配（宁漏不误伤）
    return nameIsBlocked(replayDomName(el));
  }

  function syncReplays() {
    const hasBlocked = Object.keys(state.blocked).length > 0;
    const blocks = document.querySelectorAll('.threadReplays');

    if (!hasBlocked) {
      document.querySelectorAll('.threadReplaysItem[data-fblk]').forEach(function (el) {
        el.removeAttribute('data-fblk');
        el.style.removeProperty('display');
      });
      document.querySelectorAll('.threadReplays[data-fblk]').forEach(function (block) {
        block.removeAttribute('data-fblk');
        block.style.removeProperty('display');
      });
      return;
    }

    blocks.forEach(function (block) {
      const items = block.querySelectorAll('.threadReplaysItem');
      let hiddenCount = 0;

      items.forEach(function (el) {
        const hide = replayShouldHide(el);
        if (hide) {
          hiddenCount++;
          if (el.getAttribute('data-fblk') !== 'replay') {
            el.setAttribute('data-fblk', 'replay');
            el.style.display = 'none';
          }
        } else if (el.getAttribute('data-fblk') === 'replay') {
          el.removeAttribute('data-fblk');
          el.style.removeProperty('display');
        }
      });

      // 整块回复全是目标用户时连容器一起收起，避免留下空框和「查看更早 N 条回复」
      const allHidden = items.length > 0 && hiddenCount === items.length;
      if (allHidden) {
        if (block.getAttribute('data-fblk') !== 'replay-all') {
          block.setAttribute('data-fblk', 'replay-all');
          block.style.display = 'none';
        }
      } else if (block.getAttribute('data-fblk') === 'replay-all') {
        block.removeAttribute('data-fblk');
        block.style.removeProperty('display');
      }
    });
  }

  function panelAuthorName(el) {
    const nameEl = el.querySelector(PANEL_AUTHOR_SELECTOR);
    return nameEl ? (nameEl.textContent || '').trim() : '';
  }

  function clearPanelRow(el) {
    el.removeAttribute('data-fblk');
    el.style.removeProperty('position');
    const mask = el.querySelector('.fblk-panel-mask');
    if (mask) mask.remove();
    const right = el.querySelector('.groupMsgRightWrap');
    if (right) right.style.removeProperty('visibility');
  }

  function applyPanelMask(el, name) {
    const right = el.querySelector('.groupMsgRightWrap');
    if (!right) return false;
    const cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
    right.style.visibility = 'hidden';

    let mask = el.querySelector('.fblk-panel-mask');
    let label = mask ? mask.querySelector('.fblk-panel-label') : null;

    // 遮罩可能在旧版本里创建过（扩展重载后 DOM 里还留着）。
    // 这种遮罩没有 label 结构，重建一次，之后就一直复用。
    if (mask && !label) {
      mask.remove();
      mask = null;
    }

    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'fblk-panel-mask';
      // 用 pointerdown 而不是 click：虚拟列表在交互期间可能重排，
      // click 要求 down/up 落在同一节点，节点一换就整个丢掉。
      mask.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        el.setAttribute('data-fblk-expanded', '1');
        clearPanelRow(el);
      });
      label = document.createElement('span');
      label.className = 'fblk-panel-label';
      const hint = document.createElement('span');
      hint.className = 'fblk-panel-hint';
      hint.textContent = '· 点击查看';
      mask.appendChild(label);
      mask.appendChild(hint);
      el.appendChild(mask);
    }

    // 只在文案真的变了才写：每轮无条件重建文本节点会触发自身的
    // MutationObserver，形成同步死循环，还会把按下中的节点换掉。
    const text = '已屏蔽 ' + name + ' 的回复';
    if (label.textContent !== text) label.textContent = text;
    return true;
  }

  // 楼中楼面板是绝对定位虚拟列表，隐藏行会留空洞且不会重排，
  // 所以这里只做视觉遮盖：尺寸完全由飞书掌管，我们不动行高。
  function syncPanel() {
    const rows = document.querySelectorAll(PANEL_ROW_SELECTOR);
    if (!rows.length) return;

    rows.forEach(function (el) {
      const info = authorOfElement(el, false);
      const authorKey = info ? info.id : 'dom:' + panelAuthorName(el);
      const prevKey = el.getAttribute('data-fblk-author');

      // 虚拟列表会复用节点：换了一条消息就重置「点击查看」的临时展开状态
      if (prevKey !== authorKey) {
        if (prevKey !== null) clearPanelRow(el);
        el.removeAttribute('data-fblk-expanded');
        el.setAttribute('data-fblk-author', authorKey);
      }

      if (el.getAttribute('data-fblk-expanded') === '1') return;

      let blocked = false;
      let name = '';

      if (info) {
        const entry = info.isMine ? null : state.blocked[info.id];
        if (entry) {
          blocked = true;
          name = entry.name || info.name || panelAuthorName(el);
        }
      } else {
        const dom = panelAuthorName(el);
        if (nameIsBlocked(dom)) {
          blocked = true;
          name = dom;
        }
      }

      if (!blocked) {
        if (el.getAttribute('data-fblk') === 'panel') clearPanelRow(el);
        el.removeAttribute('data-fblk-expanded');
        return;
      }

      if (!applyPanelMask(el, name || '该用户')) return;
      el.setAttribute('data-fblk', 'panel');
    });
  }

  function postToBridge(type, payload) {
    window.postMessage({ __fblk: true, from: 'page', type: type, payload: payload || {} }, '*');
  }

  let barEl = null;

  function ensurePickBar() {
    if (barEl && barEl.isConnected) return barEl;
    barEl = document.createElement('div');
    barEl.className = 'fblk-bar';
    barEl.innerHTML =
      '<span>点击某条消息、回复或帖子内容，屏蔽它的作者</span>' +
      '<a class="fblk-cancel">取消 (Esc)</a>';
    barEl.querySelector('.fblk-cancel').addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      exitPickMode();
    });
    document.body.appendChild(barEl);
    return barEl;
  }

  function enterPickMode() {
    pickMode = true;
    injectStyle();
    document.body.classList.add('fblk-picking');
    const bar = ensurePickBar();
    bar.style.removeProperty('display');
  }

  function exitPickMode() {
    pickMode = false;
    document.body.classList.remove('fblk-picking');
    if (barEl) barEl.style.display = 'none';
  }

  // 拾取模式的点击：先决定要不要吞掉这次点击，避免误触飞书自己的图片/引用交互
  function handlePickClick(ev) {
    if (!pickMode) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.fblk-bar, .fblk-toast, .fblk-ph')) return;

    const replayEl = target.closest('.threadReplaysItem');
    const panelRow = target.closest(PANEL_ROW_SELECTOR);
    const msgEl = target.closest(MSG_SELECTOR);
    if (!replayEl && !panelRow && !msgEl) return;

    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();

    let info = null;
    if (replayEl) {
      info = mergeDomName(authorOfElement(replayEl, true), replayDomName(replayEl));
    } else if (panelRow) {
      info = mergeDomName(authorOfPanelRow(panelRow), panelAuthorName(panelRow));
    } else {
      const row = msgEl.closest(ROW_SELECTOR) || msgEl;
      info = mergeDomName(getMsgInfo(msgEl), domAuthorName(row));
    }

    if (info && info.isMine) {
      showToast('这是你自己的消息', '');
      return;
    }

    if (!info) {
      showToast('这条消息读不到发送人，换一条试试', '');
      return;
    }

    exitPickMode();

    if (!info.id) {
      showToast('这条消息读不到用户 ID，暂时无法屏蔽', '');
      return;
    }

    postToBridge('block', { id: info.id, name: info.name, aliases: info.aliases });
    showToast('已屏蔽 ' + (info.name || '该用户'), info.id);
    infoCache.clear();
    scheduleSync();
  }

  let toastTimer = null;

  function showToast(text, userId) {
    const old = document.querySelector('.fblk-toast');
    if (old) old.remove();
    if (toastTimer) clearTimeout(toastTimer);

    const toast = document.createElement('div');
    toast.className = 'fblk-toast';
    const label = document.createElement('span');
    label.textContent = text;
    const undo = document.createElement('a');
    undo.textContent = '撤销';
    undo.addEventListener('click', function () {
      postToBridge('unblock', { id: userId });
      toast.remove();
      if (toastTimer) clearTimeout(toastTimer);
    });
    toast.appendChild(label);
    toast.appendChild(undo);
    document.body.appendChild(toast);

    toastTimer = setTimeout(function () {
      toast.remove();
      toastTimer = null;
    }, 5000);
  }

  document.addEventListener('click', handlePickClick, true);

  document.addEventListener(
    'keydown',
    function (ev) {
      if (ev.key === 'Escape' && pickMode) {
        ev.preventDefault();
        ev.stopPropagation();
        exitPickMode();
      }
    },
    true
  );

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__fblk !== true || data.from !== 'bridge') return;

    if (data.type === 'pick') {
      if (data.payload && data.payload.on) enterPickMode();
      else exitPickMode();
      return;
    }

    if (data.type !== 'state' || !data.payload) return;

    const payload = data.payload;
    const nextBlocked = payload.blocked && typeof payload.blocked === 'object' ? payload.blocked : {};
    const nextMode = payload.mode === 'hide' ? 'hide' : 'placeholder';

    const blockedChanged =
      Object.keys(nextBlocked).join(',') !== Object.keys(state.blocked).join(',') ||
      Object.keys(nextBlocked).some(function (id) {
        const a = nextBlocked[id] || {};
        const b = state.blocked[id] || {};
        return a.name !== b.name;
      });
    const modeChanged = nextMode !== state.mode;

    state.blocked = nextBlocked;
    state.mode = nextMode;

    if (blockedChanged || modeChanged) {
      document.querySelectorAll(ROW_SELECTOR).forEach(function (row) {
        row.removeAttribute('data-fblk-expanded');
      });
      document.querySelectorAll(PANEL_ROW_SELECTOR).forEach(function (el) {
        el.removeAttribute('data-fblk-expanded');
      });
      scheduleSync();
    }
  });

  // 我们自己的节点（占位、遮罩、顶部条、toast）内部的变化不该触发重新同步，
  // 否则每次写文案都会绕回来再写一次，变成死循环。
  const OWN_NODE_SELECTOR = '.fblk-ph, .fblk-panel-mask, .fblk-bar, .fblk-toast';

  function isOwnMutation(m) {
    const target = m.target;
    return target instanceof Element && !!target.closest(OWN_NODE_SELECTOR);
  }

  function startObserving() {
    const observer = new MutationObserver(function (mutations) {
      for (const m of mutations) {
        if (m.type !== 'childList') continue;
        if (!m.addedNodes.length && !m.removedNodes.length) continue;
        if (isOwnMutation(m)) continue;
        scheduleSync();
        return;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const scrollHost = document.querySelector('.scroller');
    if (scrollHost) {
      scrollHost.addEventListener('scroll', scheduleSync, { passive: true });
    }
    document.addEventListener(
      'scroll',
      function (ev) {
        if (ev.target instanceof Element && ev.target.classList.contains('scroller')) scheduleSync();
      },
      true
    );

    setInterval(scheduleSync, 3000);
  }

  function boot() {
    injectStyle();
    startObserving();
    scheduleSync();
    postToBridge('ready', {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
