/* ==========================================================================
   06 · 星系碰撞 / GALAXY COLLISION —— 控件（右侧控制面板）
   --------------------------------------------------------------------------
   归属：ui-console。只负责界面与事件，不做物理、不碰场景 / 模型文件。
   通信：
     · 所有操作一律 COSMOS.emit('collision:cmd', {...})，按 p4-contract §4 的
       type 走（scene / params / paused / speed / show / reset / shareReq）。
     · 数字只吃 scene 的 'collision:tick'：{myr,paused,speed,count,coreDist,energyPct}；
       首次挂载后再来 'collision:ready'（模型 / 场景就绪，补场景元信息）。
     · 分享：emit {type:'shareReq'}，听 'collision:share'；若 900ms 内无回应，
       回退 COSMOS.app.collisionShareUrl() / shareCollision()，再不行给提示。
     · Esc / cosmos:reset 由 boot 广播，widget 的 reset() 只回填状态，不再 emit。
   性能：无 requestAnimationFrame、无 setInterval；文本更新由 8Hz tick 驱动。
   ========================================================================== */
(function (COSMOS) {
  'use strict';

  var T = (COSMOS.i18n && COSMOS.i18n.T) || function (zh) { return zh; };
  var H = (COSMOS.dom && COSMOS.dom.h) || function (tag) { return document.createElement(tag); };
  var numFmt = (COSMOS.dom && COSMOS.dom.num) || function (v) { return String(v); };

  /* 速度档位（×base，契约 §2：0.25 / 0.5 / 1 / 2 / 4 倍，可负） */
  var SPEEDS = [0.25, 0.5, 1, 2, 4];
  /* 契约 §2：默认 1 真实秒 = 10 Myr；模型 / 场景就绪后优先读 sceneList 的 timeScale */
  var FALLBACK_TIMESCALE = 10;

  var DEFAULT_PARAMS = { ratio: 1, approach: 9, spinA: 1, spinB: 1, leanA: 0, leanB: 0 };
  var DEFAULT_SHOW = { trails: true, velocity: false, names: true };

  var SCENE_LIST = [
    { id: 'collide', zh: '双旋碰撞', en: 'HEAD-ON ENCOUNTER' },
    { id: 'custom', zh: '自设碰撞', en: 'CUSTOM COLLISION' },
    { id: 'passer', zh: '小星系掠过', en: 'SMALL PASSER' },
    { id: 'retrograde', zh: '逆向掠过', en: 'RETROGRADE PASS' },
    { id: 'bullseye', zh: '穿心成环', en: 'BULLSEYE RING' },
    { id: 'spiral', zh: '螺旋缠绕', en: 'SPIRAL WIND-UP' }
  ];

  var PARAM_DEFS = [
    {
      key: 'ratio', zh: '质量比', en: 'MASS RATIO',
      opts: [
        { value: 1, zh: '1 : 1（等质量）', en: '1 : 1 equal mass' },
        { value: 0.5, zh: '1 : 0.5', en: '1 : 0.5' },
        { value: 0.25, zh: '1 : 0.25', en: '1 : 0.25' }
      ]
    },
    {
      key: 'approach', zh: '最近距离', en: 'CLOSEST APPROACH',
      opts: [
        { value: 6, zh: '6 kpc', en: '6 kpc' },
        { value: 12, zh: '12 kpc', en: '12 kpc' },
        { value: 20, zh: '20 kpc', en: '20 kpc' }
      ]
    },
    {
      key: 'spinA', zh: '主星系自旋', en: 'PRIMARY SPIN',
      opts: [
        { value: 1, zh: '顺行', en: 'PROGRADE' },
        { value: -1, zh: '逆行', en: 'RETROGRADE' }
      ]
    },
    {
      key: 'spinB', zh: '伴星系自旋', en: 'COMPANION SPIN',
      opts: [
        { value: 1, zh: '顺行', en: 'PROGRADE' },
        { value: -1, zh: '逆行', en: 'RETROGRADE' }
      ]
    },
    {
      key: 'leanA', zh: '主星系倾角', en: 'PRIMARY TILT',
      opts: [
        { value: 0, zh: '0°', en: '0°' },
        { value: 30, zh: '30°', en: '30°' },
        { value: 60, zh: '60°', en: '60°' }
      ]
    },
    {
      key: 'leanB', zh: '伴星系倾角', en: 'COMPANION TILT',
      opts: [
        { value: 0, zh: '0°', en: '0°' },
        { value: 30, zh: '30°', en: '30°' },
        { value: 60, zh: '60°', en: '60°' }
      ]
    }
  ];

  var SHOW_DEFS = [
    { key: 'trails', zh: '轨迹', en: 'TRAILS' },
    { key: 'velocity', zh: '速度着色', en: 'VELOCITY COLOR' },
    { key: 'names', zh: '名称', en: 'LABELS' }
  ];

  /* ---------- 小工具 ---------- */
  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function setPressed(node, on) {
    if (!node) return;
    if (on) node.classList.add('is-on');
    else node.classList.remove('is-on');
    node.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function fmtRate(v) {
    var a = Math.abs(v);
    if (!isFinite(a)) return '—';
    if (a >= 100) return String(Math.round(a));
    if (a >= 10) return a.toFixed(1);
    return a.toFixed(2);
  }

  function fmtMyrLocal(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    var sign = v < 0 ? '-' : '';
    var a = Math.abs(v);
    if (a >= 1000) return sign + (a / 1000).toFixed(2) + ' Gyr';
    return sign + Math.round(a) + ' Myr';
  }

  function fmtMyr(v) {
    var gal = COSMOS.galaxyModel;
    if (gal && typeof gal.formatMyr === 'function') {
      try { return String(gal.formatMyr(v)); } catch (e) { /* fallthrough */ }
    }
    return fmtMyrLocal(v);
  }

  function fmtSignedPct(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    var sign = v > 0 ? '+' : (v < 0 ? '-' : '');
    var a = Math.abs(v);
    return sign + a.toFixed(a >= 10 ? 1 : 2) + ' %';
  }

  /* ---------- 剪贴板回退（零网络，file:// 下 navigator.clipboard 可能不可用） ---------- */
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      var ok = false;
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function copyText(text) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard
        && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).then(function () {
          return true;
        }, function () {
          return legacyCopy(text);
        });
      }
    } catch (e) { /* fallthrough */ }
    return Promise.resolve(legacyCopy(text));
  }

  /* ==========================================================================
     控件工厂
     ========================================================================== */
  COSMOS.registerWidget('collision', function (el, content, section) {
    var destroyed = false;
    var offs = [];
    var toastTimer = 0;
    var shareTimer = 0;
    var shareSettled = false;
    /* 场景元信息：静态表打底，模型就绪后用 sceneList() 覆盖（名称 / 时长 / 时间倍率） */
    var SCENE_META = {};

    /* ---------- 状态：缺字段才补默认，绝不覆盖 Lead / boot 已写入的值 ---------- */
    function getState() {
      var holder = COSMOS.state || (COSMOS.state = {});
      var st = holder.collision;
      if (!st || typeof st !== 'object') st = holder.collision = {};

      if (typeof st.scene !== 'string' || !st.scene) st.scene = 'collide';
      if (typeof st.paused !== 'boolean') st.paused = false;
      if (typeof st.speed !== 'number' || !isFinite(st.speed) || st.speed === 0) st.speed = 1;
      if (typeof st.myr !== 'number' || !isFinite(st.myr)) st.myr = 0;

      if (!st.params || typeof st.params !== 'object') st.params = {};
      for (var pk in DEFAULT_PARAMS) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_PARAMS, pk)) continue;
        if (typeof st.params[pk] !== 'number') st.params[pk] = DEFAULT_PARAMS[pk];
      }
      if (!st.show || typeof st.show !== 'object') st.show = {};
      for (var sk in DEFAULT_SHOW) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_SHOW, sk)) continue;
        if (typeof st.show[sk] !== 'boolean') st.show[sk] = DEFAULT_SHOW[sk];
      }
      if (!st.stats || typeof st.stats !== 'object') st.stats = { count: 0, coreDist: 0, energyPct: null };
      return st;
    }

    function copyParams(p) {
      return {
        ratio: p.ratio, approach: p.approach,
        spinA: p.spinA, spinB: p.spinB,
        leanA: p.leanA, leanB: p.leanB
      };
    }

    function copyShow(show) {
      return { trails: !!show.trails, velocity: !!show.velocity, names: !!show.names };
    }

    function emitCmd(payload) {
      if (COSMOS.emit) COSMOS.emit('collision:cmd', payload);
    }

    /* ---------- 场景元信息 ---------- */
    function syncScenes() {
      var next = {};
      for (var i = 0; i < SCENE_LIST.length; i++) {
        next[SCENE_LIST[i].id] = { zh: SCENE_LIST[i].zh, en: SCENE_LIST[i].en, timeScale: 0, duration: 0 };
      }
      SCENE_META = next;

      var gal = COSMOS.galaxyModel;
      if (!gal || typeof gal.sceneList !== 'function') return;
      var list = null;
      try { list = gal.sceneList(); } catch (e) { list = null; }
      if (!list) return;

      function take(id, item) {
        if (!id || typeof id !== 'string') return;
        if (!item || typeof item !== 'object') return;
        var m = SCENE_META[id];
        if (!m) return; /* 只认 6 个已知场景，未知 id 静默忽略 */
        if (typeof item.timeScale === 'number' && isFinite(item.timeScale) && item.timeScale > 0) {
          m.timeScale = item.timeScale;
        }
        if (typeof item.duration === 'number' && isFinite(item.duration)) m.duration = item.duration;
      }

      if (Object.prototype.toString.call(list) === '[object Array]') {
        for (var j = 0; j < list.length; j++) {
          var it = list[j];
          if (it && typeof it === 'object') take(it.id, it);
        }
      } else if (typeof list === 'object') {
        for (var key in list) {
          if (!Object.prototype.hasOwnProperty.call(list, key)) continue;
          take(key, list[key]);
        }
      }
    }

    function sceneTimeScale(id) {
      var m = SCENE_META[id];
      return (m && m.timeScale > 0) ? m.timeScale : FALLBACK_TIMESCALE;
    }

    /* ---------- DOM：头部 ---------- */
    var root = H('div', {
      class: 'coll-ui',
      'data-ui': true,
      role: 'region',
      'aria-label': T('星系碰撞控制台', 'Galaxy collision controls')
    });
    var panel = H('aside', { class: 'coll-panel' });

    var btnFold = H('button', {
      class: 'coll-fold',
      type: 'button',
      'aria-expanded': 'true',
      text: T('收起', 'FOLD')
    });
    var head = H('div', { class: 'coll-head' }, [
      H('p', { class: 'coll-kicker', text: T('06 · 星系碰撞', '06 · GALAXY COLLISION') }),
      H('div', { class: 'coll-head-row' }, [
        H('h2', { class: 'coll-title', text: T('控制台', 'CONTROLS') }),
        btnFold
      ])
    ]);
    panel.appendChild(head);

    function makeSection(zh, en) {
      var sec = H('section', { class: 'coll-sec' });
      sec.appendChild(H('h3', { class: 'coll-sec-title', text: T(zh, en) }));
      return sec;
    }

    /* ---------- DOM：场景 ---------- */
    var secScene = makeSection('场景', 'SCENE');
    var selScene = H('select', { class: 'coll-sel', 'aria-label': T('选择场景', 'Choose scene') });
    secScene.appendChild(selScene);
    var sceneNote = H('p', { class: 'coll-desc', hidden: true });
    secScene.appendChild(sceneNote);
    panel.appendChild(secScene);

    /* ---------- DOM：自设参数（仅 custom） ---------- */
    var secParams = makeSection('自设参数', 'CUSTOM PARAMETERS');
    var paramSels = {};
    for (var pi = 0; pi < PARAM_DEFS.length; pi++) {
      (function (def) {
        var field = H('div', { class: 'coll-field' });
        field.appendChild(H('span', { class: 'coll-lab', text: T(def.zh, def.en) }));
        var sel = H('select', { class: 'coll-sel', 'aria-label': T(def.zh, def.en) });
        for (var oi = 0; oi < def.opts.length; oi++) {
          sel.appendChild(H('option', {
            value: String(def.opts[oi].value),
            text: T(def.opts[oi].zh, def.opts[oi].en)
          }));
        }
        field.appendChild(sel);
        secParams.appendChild(field);
        paramSels[def.key] = sel;
        sel.addEventListener('change', function () {
          if (destroyed) return;
          var st = getState();
          var value = parseFloat(sel.value);
          if (!isFinite(value)) return;
          st.params[def.key] = value;
          st.myr = 0;
          emitCmd({ type: 'params', params: copyParams(st.params) });
          setText(outElapsed, fmtMyr(0));
        });
      })(PARAM_DEFS[pi]);
    }
    panel.appendChild(secParams);

    /* ---------- DOM：时间 ---------- */
    var secTime = makeSection('时间', 'TIME');
    var btnBack = H('button', {
      class: 'coll-btn', type: 'button', 'aria-pressed': 'false',
      text: T('倒放', 'REVERSE'), 'aria-label': T('倒放', 'Reverse time')
    });
    var btnSlow = H('button', {
      class: 'coll-btn', type: 'button',
      text: '−', 'aria-label': T('减速', 'Slower')
    });
    var btnPlay = H('button', {
      class: 'coll-btn coll-play', type: 'button', 'aria-pressed': 'false',
      text: T('暂停', 'PAUSE')
    });
    var btnFast = H('button', {
      class: 'coll-btn', type: 'button',
      text: '+', 'aria-label': T('加速', 'Faster')
    });
    secTime.appendChild(H('div', { class: 'coll-row' }, [btnBack, btnSlow, btnPlay, btnFast]));
    var outRate = H('span', { class: 'coll-rate-v', id: 'coll-rate', text: '—' });
    secTime.appendChild(H('div', { class: 'coll-rate' }, [
      H('span', { class: 'coll-rate-k', text: T('速度', 'SPEED') }),
      outRate
    ]));
    panel.appendChild(secTime);

    /* ---------- DOM：显示开关 ---------- */
    var secShow = makeSection('显示', 'DISPLAY');
    var toggleBtns = {};
    var toggleRow = H('div', { class: 'coll-tgls' });
    for (var si = 0; si < SHOW_DEFS.length; si++) {
      (function (def) {
        var btn = H('button', {
          class: 'coll-tgl', type: 'button', 'aria-pressed': 'false',
          text: T(def.zh, def.en)
        });
        toggleRow.appendChild(btn);
        toggleBtns[def.key] = btn;
        btn.addEventListener('click', function () {
          if (destroyed) return;
          var st = getState();
          st.show[def.key] = !st.show[def.key];
          emitCmd({ type: 'show', show: copyShow(st.show) });
          syncShow();
        });
      })(SHOW_DEFS[si]);
    }
    secShow.appendChild(toggleRow);
    panel.appendChild(secShow);

    /* ---------- DOM：详情 ---------- */
    var secDetail = makeSection('详情', 'DETAILS');
    var kv = H('dl', { class: 'coll-kv' });
    function kvRow(zh, en, id) {
      kv.appendChild(H('dt', { text: T(zh, en) }));
      var dd = H('dd', { id: id, text: '—' });
      kv.appendChild(dd);
      return dd;
    }
    var outElapsed = kvRow('已运行', 'TIME ELAPSED', 'coll-elapsed');
    var outBodies = kvRow('天体', 'BODIES', 'coll-bodies');
    var outEnergy = kvRow('能量变化', 'ENERGY CHANGE', 'coll-energy');
    secDetail.appendChild(kv);
    panel.appendChild(secDetail);

    /* ---------- DOM：工具 ---------- */
    var secTools = makeSection('工具', 'TOOLS');
    var btnResetView = H('button', { class: 'coll-btn', type: 'button', text: T('复位视角', 'RESET VIEW') });
    var btnShare = H('button', { class: 'coll-btn', type: 'button', text: T('分享', 'SHARE') });
    secTools.appendChild(H('div', { class: 'coll-grid' }, [btnResetView, btnShare]));
    panel.appendChild(secTools);

    panel.appendChild(H('p', {
      class: 'coll-hint',
      text: T(
        '拖拽旋转 · 滚轮缩放 · 空格暂停 · Esc 复位',
        'Drag to orbit · scroll to zoom · Space to pause · Esc to reset'
      )
    }));

    var toast = H('div', { class: 'coll-toast', role: 'status', 'aria-live': 'polite', hidden: true });
    root.appendChild(panel);
    root.appendChild(toast);

    /* ---------- Toast ---------- */
    function hideToast() {
      toast.hidden = true;
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
    }

    function showToast(msg, ms) {
      if (destroyed) return;
      toast.textContent = msg;
      toast.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, ms || 2400);
    }

    /* ---------- 同步 UI ---------- */
    function rebuildSceneSel() {
      var st = getState();
      var keep = st.scene;
      while (selScene.firstChild) selScene.removeChild(selScene.firstChild);
      for (var i = 0; i < SCENE_LIST.length; i++) {
        var id = SCENE_LIST[i].id;
        var meta = SCENE_META[id] || SCENE_LIST[i];
        selScene.appendChild(H('option', { value: id, text: T(meta.zh, meta.en) }));
      }
      var has = false;
      for (var j = 0; j < SCENE_LIST.length; j++) if (SCENE_LIST[j].id === keep) has = true;
      if (!has) keep = SCENE_LIST[0].id;
      st.scene = keep;
      selScene.value = keep;

      var m = SCENE_META[keep];
      if (m && m.duration > 0) {
        sceneNote.textContent = T('时长 ', 'DURATION ') + Math.round(m.duration) + ' Myr';
        sceneNote.hidden = false;
      } else {
        sceneNote.hidden = true;
      }
      secParams.hidden = keep !== 'custom';
    }

    function syncParams() {
      var st = getState();
      for (var i = 0; i < PARAM_DEFS.length; i++) {
        var key = PARAM_DEFS[i].key;
        var sel = paramSels[key];
        if (sel) sel.value = String(st.params[key]);
      }
    }

    function syncShow() {
      var st = getState();
      for (var i = 0; i < SHOW_DEFS.length; i++) {
        var key = SHOW_DEFS[i].key;
        var btn = toggleBtns[key];
        if (!btn) continue;
        setPressed(btn, !!st.show[key]);
      }
    }

    function syncSpeed() {
      var st = getState();
      var paused = !!st.paused;
      var speed = (typeof st.speed === 'number' && isFinite(st.speed) && st.speed !== 0) ? st.speed : 1;

      btnPlay.textContent = paused ? T('继续', 'PLAY') : T('暂停', 'PAUSE');
      setPressed(btnPlay, paused);
      setPressed(btnBack, speed < 0);

      var perSec = sceneTimeScale(st.scene) * Math.abs(speed);
      setText(outRate, (speed < 0 ? '-' : '') + fmtRate(perSec) + ' ' + T('Myr/秒', 'Myr/s'));
    }

    function syncAll() {
      rebuildSceneSel();
      syncParams();
      syncShow();
      syncSpeed();
    }

    /* ---------- tick / ready / share ---------- */
    function renderTick(t) {
      if (!t || destroyed) return;
      var st = getState();

      if (typeof t.myr === 'number' && isFinite(t.myr)) {
        st.myr = t.myr;
        setText(outElapsed, fmtMyr(t.myr));
      }
      /* 场景与 UI 共享同一份 state：scene 会直接改 st.paused/st.speed，
         因此不能只比较“值变没变”，否则 scene 侧变化永远刷不到按钮标签。 */
      if (typeof t.paused === 'boolean') {
        st.paused = t.paused;
        syncSpeed();
      }
      if (typeof t.speed === 'number' && isFinite(t.speed) && t.speed !== 0) {
        st.speed = t.speed;
        syncSpeed();
      }
      if (typeof t.count === 'number' && isFinite(t.count)) {
        st.stats.count = t.count;
        setText(outBodies, numFmt(t.count) + ' + 2');
      }
      if (typeof t.coreDist === 'number' && isFinite(t.coreDist)) {
        st.stats.coreDist = t.coreDist;
      }
      if (typeof t.energyPct === 'number' && isFinite(t.energyPct)) {
        st.stats.energyPct = t.energyPct;
        setText(outEnergy, fmtSignedPct(t.energyPct));
      }
    }

    /* ---------- 分享 ---------- */
    function finishShare(ok, msg) {
      shareSettled = true;
      if (shareTimer) { clearTimeout(shareTimer); shareTimer = 0; }
      if (destroyed) return;
      if (msg) { showToast(msg); return; }
      showToast(ok
        ? T('链接已复制', 'Link copied')
        : T('复制失败，请手动复制地址栏链接', 'Copy failed — copy the address-bar link'));
    }

    function fallbackShare() {
      var app = COSMOS.app || {};

      if (typeof app.collisionShareUrl === 'function') {
        var url = '';
        try { url = app.collisionShareUrl() || ''; } catch (e) { url = ''; }
        if (url) {
          copyText(url).then(function (ok) { finishShare(!!ok); });
          return;
        }
      }
      if (typeof app.shareCollision === 'function') {
        var res = null;
        try { res = app.shareCollision(); } catch (e) { res = null; }
        if (res && typeof res.then === 'function') {
          res.then(function (ok) { finishShare(!!ok); }, function () { finishShare(false); });
          return;
        }
        if (typeof res === 'boolean') { finishShare(res); return; }
      }
      finishShare(false, T('分享链接尚未就绪，请稍后重试', 'Share link is not ready yet — try again shortly'));
    }

    function onShareClick() {
      if (destroyed) return;
      shareSettled = false;
      if (shareTimer) clearTimeout(shareTimer);
      emitCmd({ type: 'shareReq' });
      shareTimer = setTimeout(function () {
        shareTimer = 0;
        if (shareSettled || destroyed) return;
        fallbackShare();
      }, 900);
    }

    function onShareEvent(detail) {
      if (destroyed) return;
      var ok = !(detail && detail.ok === false);
      shareSettled = true;
      if (shareTimer) { clearTimeout(shareTimer); shareTimer = 0; }
      if (ok && !(detail && detail.url)) {
        /* scene / boot 只说“已复制”，不再回退 */
        finishShare(true);
        return;
      }
      if (ok) { finishShare(true); return; }
      fallbackShare();
    }

    /* ---------- 按钮 ---------- */
    btnFold.addEventListener('click', function () {
      if (destroyed) return;
      var folded = panel.classList.toggle('is-folded');
      btnFold.setAttribute('aria-expanded', folded ? 'false' : 'true');
      btnFold.textContent = folded ? T('展开', 'OPEN') : T('收起', 'FOLD');
    });

    selScene.addEventListener('change', function () {
      if (destroyed) return;
      var st = getState();
      var id = selScene.value;
      if (!id) return;
      st.scene = id;
      st.myr = 0;
      st.paused = false;
      /* 新场景从起点正放：若此前在倒放，切场景后按键“继续”不应立即撞到 0 点暂停 */
      st.speed = Math.abs(st.speed) || 1;
      emitCmd({ type: 'scene', id: id });
      emitCmd({ type: 'speed', speed: st.speed });
      syncAll();
      setText(outElapsed, fmtMyr(0));
    });

    function setSpeed(value) {
      var st = getState();
      st.speed = value;
      emitCmd({ type: 'speed', speed: value });
      syncSpeed();
    }

    function stepSpeed(dir) {
      var st = getState();
      var sign = st.speed < 0 ? -1 : 1;
      var a = Math.abs(st.speed);
      var idx = 0;
      var best = Infinity;
      for (var i = 0; i < SPEEDS.length; i++) {
        var d = Math.abs(SPEEDS[i] - a);
        if (d < best) { best = d; idx = i; }
      }
      idx = Math.max(0, Math.min(SPEEDS.length - 1, idx + dir));
      setSpeed(SPEEDS[idx] * sign);
    }

    btnBack.addEventListener('click', function () {
      if (destroyed) return;
      var st = getState();
      setSpeed(st.speed < 0 ? Math.abs(st.speed) : -Math.abs(st.speed));
    });

    btnSlow.addEventListener('click', function () {
      if (!destroyed) stepSpeed(-1);
    });

    btnFast.addEventListener('click', function () {
      if (!destroyed) stepSpeed(1);
    });

    btnPlay.addEventListener('click', function () {
      if (destroyed) return;
      var st = getState();
      st.paused = !st.paused;
      emitCmd({ type: 'paused', paused: st.paused });
      syncSpeed();
    });

    btnResetView.addEventListener('click', function () {
      if (destroyed) return;
      var st = getState();
      st.myr = 0;
      st.paused = false;
      hideToast();
      emitCmd({ type: 'reset' });
      setText(outElapsed, fmtMyr(0));
      syncSpeed();
      showToast(T('已复位到场景起点', 'Reset to scene start'));
    });

    btnShare.addEventListener('click', onShareClick);

    /* ---------- 事件总线 ---------- */
    function listen(name, fn) {
      if (!COSMOS.on) return;
      var off = COSMOS.on(name, fn);
      if (typeof off === 'function') offs.push(off);
    }

    listen('collision:tick', renderTick);

    listen('collision:ready', function () {
      if (destroyed) return;
      syncScenes();
      syncAll();
    });

    listen('collision:share', onShareEvent);

    listen('cosmos:reset', function () {
      if (destroyed) return;
      syncScenes();
      syncAll();
      setText(outElapsed, fmtMyr(getState().myr));
    });

    /* 场景 / 模型可能在控件挂载后才补状态（例如深链），做一次轻量回填 */
    function bootstrap() {
      syncScenes();
      syncAll();
      var st = getState();
      setText(outElapsed, fmtMyr(st.myr));
    }

    /* ---------- 生命周期（ui.js 直接调用 update / reset） ---------- */
    function update() {
      /* 全部数值由 8Hz 的 collision:tick 驱动；这里不写 DOM，也不做物理 */
    }

    function reset() {
      if (destroyed) return;
      hideToast();
      shareSettled = false;
      if (shareTimer) { clearTimeout(shareTimer); shareTimer = 0; }
      syncScenes();
      syncAll();
      var st = getState();
      setText(outElapsed, fmtMyr(st.myr));
      setText(outBodies, '—');
      setText(outEnergy, '—');
      panel.classList.remove('is-folded');
      btnFold.setAttribute('aria-expanded', 'true');
      btnFold.textContent = T('收起', 'FOLD');
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
      if (shareTimer) { clearTimeout(shareTimer); shareTimer = 0; }
      for (var i = 0; i < offs.length; i++) {
        try { offs[i](); } catch (e) { /* ignore */ }
      }
      offs.length = 0;
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    el.appendChild(root);
    bootstrap();

    return { update: update, reset: reset, destroy: destroy };
  });
})(window.COSMOS = window.COSMOS || {});
