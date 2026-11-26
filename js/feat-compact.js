/* ============================================================
 * COSMOS ATLAS · 04 致密天体 / 黑洞模拟器 · 控制台
 * ------------------------------------------------------------
 * 契约：artifacts/p2-contract.md §1（状态）/§3（事件）/§4（UI）
 *
 * 只做三件事：
 *   1. 把 COSMOS.state.compact 渲染成 NASA 腔的右侧控制台；
 *   2. 用户操作一律 COSMOS.emit('compact:cmd', {...})，不直接改 bodies；
 *   3. 数字只来自 'compact:tick'（≥6Hz）。tick 缺失时用
 *      requestAnimationFrame 以 state 粗读兜底（≤10Hz），tick 恢复即停。
 *
 * 结构（自上而下，Details 是唯一滚动区）：
 *   toolbar → scenes(8) → cam → time → status → details → hint
 * 全部根节点带 data-ui，boot.js 的输入层据此判定 uiTarget。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const D = COSMOS.DATA || {};
  const BM = COSMOS.bhModel || {};
  const state = COSMOS.state || (COSMOS.state = {});
  const h = COSMOS.dom && COSMOS.dom.h;
  const EN = !!(COSMOS.i18n && COSMOS.i18n.en);

  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
  const QUALITY = [
    { id: 'auto', zh: '自动', en: 'Auto' },
    { id: 'high', zh: '高', en: 'High' },
    { id: 'low', zh: '低', en: 'Low' }
  ];
  const STAR_NAMES = {
    star_red: ['红矮星', 'Red dwarf'],
    star_sun: ['太阳', 'Sun'],
    star_blue: ['蓝巨星', 'Blue giant']
  };
  const NOTICES = {
    'no-bodies': ['场景里还没有天体，用「添加」放一个。', 'No bodies yet — use Add to place one.'],
    added: ['已添加。点画面里的天体可以选中它。', 'Added — click the object in the scene to select it.'],
    merged: ['并合完成，两个黑洞合成一个更大的黑洞。', 'Merger complete — the two black holes became one.'],
    fallin: ['已越过光子球，远处看到的你几乎停住。', 'Past the photon sphere — distant observers see you nearly frozen.']
  };

  function T(zh, en) {
    if (COSMOS.i18n && typeof COSMOS.i18n.T === 'function') return COSMOS.i18n.T(zh, en);
    return EN ? en : zh;
  }
  function cs() { return state.compact || {}; }
  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }
  function emitCmd(payload) {
    if (payload && payload.type) COSMOS.emit('compact:cmd', payload);
  }

  /* ---------------- 数字与单位（全部委托 bh-model，保证与画面同源） ---------------- */
  function num(v, digits) {
    if (!finite(v)) return '—';
    if (BM.group) return BM.group(v, digits);
    return String(Math.round(v * 100) / 100);
  }
  function fmtMass(m) {
    if (!finite(m)) return '—';
    return BM.fmtMass ? BM.fmtMass(m, EN) : (num(m, 1) + ' M☉');
  }
  function fmtKm(km) {
    if (!finite(km)) return '—';
    return BM.fmtKm ? BM.fmtKm(km, EN) : (num(km, 0) + ' km');
  }
  function fmtDur(sec) {
    if (!finite(sec)) return '—';
    return BM.fmtDuration ? BM.fmtDuration(sec, EN) : (num(sec, 2) + ' s');
  }
  function fmtPct(x, digits) {
    if (!finite(x)) return '—';
    return BM.fmtPct ? BM.fmtPct(x, digits) : (num(x * 100, 1) + '%');
  }
  function rsKmOf(mass) {
    return BM.rsKm ? BM.rsKm(mass) : 2.95325008 * Math.max(0, mass || 0);
  }
  function unitKmOf(mass) {
    return BM.unitKm ? BM.unitKm(mass) : rsKmOf(mass);
  }
  function primaryMassOf(bodies) {
    if (BM.primaryMass) return BM.primaryMass(bodies);
    for (let i = 0; i < bodies.length; i++) if (bodies[i] && bodies[i].kind === 'bh') return bodies[i].mass;
    return 30;
  }
  function sig3(v) {
    if (!finite(v) || v === 0) return v;
    const d = Math.ceil(Math.log10(Math.abs(v)));
    const p = Math.pow(10, 3 - d);
    return Math.round(v * p) / p;
  }
  function fmtSimTime(sec) {
    if (!finite(sec)) return 't = —';
    const a = Math.abs(sec);
    const sign = sec < 0 ? '−' : '';
    if (a < 10) return 't = ' + sign + num(a, 2) + ' s';
    return 't = ' + sign + fmtDur(a);
  }
  function discColorCss(tempK) {
    const rgb = BM.blackbodyRGB ? BM.blackbodyRGB(tempK) : [1, 1, 1];
    return 'rgb(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ',' + Math.round(rgb[2] * 255) + ')';
  }
  function fmtDist(distRs, distKm) {
    const parts = [];
    if (finite(distRs)) parts.push(num(distRs, 1) + ' rs');
    if (finite(distKm)) parts.push(fmtKm(distKm));
    return parts.length ? parts.join(' · ') : '—';
  }
  function distance3(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /* 全局 bm 缺函数时的兜底（正常不会走到） */
  function bhPrimaryOf(bodies) {
    for (let i = 0; i < bodies.length; i++) if (bodies[i] && bodies[i].kind === 'bh') return bodies[i];
    return null;
  }

  COSMOS.registerWidget('compact', function (elRoot) {
    if (typeof h !== 'function' || !elRoot) {
      return { update: function () {}, reset: function () {} };
    }

    /* ============================================================
     * 局部状态（全部在闭包，禁止每帧 new）
     * ============================================================ */
    let mounted = true;
    let rafId = 0;
    let pendingRaf = 0;
    let pendingCmd = null;
    let lastTick = null;
    let lastTickAt = 0;
    let lastFallbackAt = 0;
    let statusTimer = 0;
    let statusKind = '';
    let objSig = '';
    let objRows = [];
    let menus = [];
    let chips = [];
    let modeBtns = {};
    let qualityBtns = {};
    let swatches = [];
    let offs = [];

    const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
      ? function (fn) { return window.requestAnimationFrame(fn); }
      : function (fn) { return setTimeout(function () { fn(nowMs()); }, 16); };
    const caf = (typeof window !== 'undefined' && window.cancelAnimationFrame)
      ? function (id) { window.cancelAnimationFrame(id); }
      : function (id) { clearTimeout(id); };

    /* ============================================================
     * 小工具
     * ============================================================ */
    function setPressed(btn, on) {
      if (!btn) return;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (btn.classList) {
        if (on) btn.classList.add('is-on');
        else btn.classList.remove('is-on');
      }
    }
    function isPressed(btn) { return !!(btn && btn.getAttribute('aria-pressed') === 'true'); }
    function containsNode(root, node) {
      if (!root || !node) return false;
      if (root === node) return true;
      if (root.contains) { try { return root.contains(node); } catch (e) { return false; } }
      return false;
    }
    function isFocused(el) { return typeof document !== 'undefined' && document.activeElement === el; }
    function bodyById(list, id) {
      if (!list) return null;
      for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
      return null;
    }
    function stateBodies() { return cs().bodies || []; }
    function stateBody(id) { return bodyById(stateBodies(), id); }
    function tickBody(tick, id) {
      return bodyById((tick && tick.bodies) || [], id);
    }
    function anyMenuOpen() {
      for (let i = 0; i < menus.length; i++) if (menus[i].open) return true;
      return false;
    }
    function closeAllMenus() {
      for (let i = 0; i < menus.length; i++) menus[i].setOpen(false);
    }

    /* ============================================================
     * 菜单（添加 / 更多 / 速度共用）
     * ============================================================ */
    function makeMenu(trigger, fill) {
      const menu = h('div', { class: 'cmp-menu', role: 'menu', hidden: true });
      const wrap = h('span', { class: 'cmp-menu-wrap' }, [trigger, menu]);
      const api = { wrap: wrap, menu: menu, trigger: trigger, items: [], open: false };

      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');

      api.label = function (text) {
        menu.appendChild(h('p', { class: 'cmp-menu-label', text: text }));
      };
      api.add = function (label, onClick, opts) {
        opts = opts || {};
        const btn = h('button', {
          class: 'cmp-menu-item' + (opts.sub ? ' is-sub' : ''),
          type: 'button',
          role: 'menuitem',
          'aria-pressed': 'false',
          text: label
        });
        btn.addEventListener('click', function () {
          setOpen(false);
          try { onClick(); } catch (e) { /* 单条命令失败不影响其它控件 */ }
        });
        menu.appendChild(btn);
        api.items.push(btn);
        return btn;
      };
      api.setOpen = setOpen;
      menus.push(api);

      /* 填充条目（fill 只调用一次；菜单内容静态，tick 不重建） */
      if (typeof fill === 'function') {
        try { fill(api); } catch (e) { /* 菜单内容失败不阻断整个控制台 */ }
      }

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
        setOpen(!api.open);
      });
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'Down') {
          e.preventDefault();
          setOpen(true);
        }
      });
      menu.addEventListener('keydown', function (e) {
        if (!api.open) return;
        const items = api.items;
        if (!items.length) return;
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        const idx = items.indexOf(active);
        if (e.key === 'ArrowDown' || e.key === 'Down') {
          e.preventDefault();
          items[(idx + 1) % items.length].focus();
        } else if (e.key === 'ArrowUp' || e.key === 'Up') {
          e.preventDefault();
          items[(idx - 1 + items.length) % items.length].focus();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
          trigger.focus();
        }
      });

      function setOpen(v) {
        v = !!v;
        if (v) {
          for (let i = 0; i < menus.length; i++) {
            if (menus[i] !== api) menus[i].setOpen(false);
          }
        } else if (typeof document !== 'undefined' && api.menu.contains(document.activeElement)) {
          try { trigger.focus(); } catch (e) { /* 无焦点环境 */ }
        }
        api.open = v;
        menu.hidden = !v;
        trigger.setAttribute('aria-expanded', v ? 'true' : 'false');
        if (v && api.items.length) {
          try { api.items[0].focus(); } catch (e) { /* 无焦点环境 */ }
        }
      }
      return api;
    }

    /* ============================================================
     * 结构
     * ============================================================ */
    const root = h('div', { class: 'bh-ui', 'data-ui': '' });
    const consoleEl = h('div', {
      class: 'cmp-console',
      role: 'group',
      'aria-label': T('黑洞模拟器控制台', 'Black hole simulator console')
    });

    /* ----- 抬头 ----- */
    const head = h('div', { class: 'cmp-console-head' }, [
      h('span', { class: 'cmp-kicker', text: T('04 · 致密天体', '04 · Compact objects') }),
      h('span', { class: 'cmp-kicker-latin', text: 'BLACK HOLE LAB' })
    ]);

    /* ----- 工具条 ----- */
    const toggleDisc = makeToggle('disc', T('吸积盘', 'Accretion disc'), T('盘', 'Disc'));
    const toggleDoppler = makeToggle('doppler', T('多普勒增亮', 'Doppler beaming'), T('多普勒', 'Doppler'));
    const toggleLensing = makeToggle('lensing', T('引力透镜', 'Gravitational lensing'), T('引力透镜', 'Lensing'));

    const addTrigger = h('button', {
      class: 'cmp-btn cmp-add',
      type: 'button',
      'aria-label': T('添加天体', 'Add object'),
      'aria-pressed': 'false',
      text: T('添加 ▾', 'Add ▾')
    });
    const addMenu = makeMenu(addTrigger, function (api) {
      const bhPresets = BM.presets ? BM.presets('blackhole') : ((D.compact && D.compact.presets && D.compact.presets.blackhole) || []);
      const starPresets = BM.presets ? BM.presets('star') : ((D.compact && D.compact.presets && D.compact.presets.star) || []);
      api.label(T('黑洞', 'Black hole'));
      for (let i = 0; i < bhPresets.length; i++) {
        (function (p) {
          api.add(fmtMass(p.mass), function () { chooseAdd('bh', p.id); }, { sub: true });
        })(bhPresets[i]);
      }
      api.label(T('恒星', 'Star'));
      for (let j = 0; j < starPresets.length; j++) {
        (function (p) {
          const n = STAR_NAMES[p.id] || ['恒星', 'Star'];
          api.add(T(n[0], n[1]) + ' · ' + fmtMass(p.mass), function () { chooseAdd('star', p.id); }, { sub: true });
        })(starPresets[j]);
      }
    });

    const undoBadge = h('span', { class: 'cmp-badge', text: '0', hidden: true });
    const undoBtn = h('button', {
      class: 'cmp-btn cmp-undo',
      type: 'button',
      'aria-label': T('撤销上一步', 'Undo last step'),
      disabled: true
    }, [T('撤销', 'Undo'), undoBadge]);
    undoBtn.addEventListener('click', function () { emitCmd({ type: 'undo' }); });

    const shareBtn = h('button', {
      class: 'cmp-btn',
      type: 'button',
      'aria-label': T('复制分享链接', 'Copy share link'),
      text: T('分享', 'Share')
    });
    shareBtn.addEventListener('click', shareScene);

    const moreTrigger = h('button', {
      class: 'cmp-btn cmp-more',
      type: 'button',
      'aria-label': T('更多选项', 'More options'),
      'aria-haspopup': 'menu',
      text: T('更多 ▾', 'More ▾')
    });
    const moreMenu = makeMenu(moreTrigger, function (api) {
      api.add(T('重置视图', 'Reset view'), function () { emitCmd({ type: 'resetView' }); });
      api.label(T('渲染质量', 'Render quality'));
      for (let i = 0; i < QUALITY.length; i++) {
        (function (q) {
          const btn = api.add(T(q.zh, q.en), function () { emitCmd({ type: 'quality', q: q.id }); }, { sub: true });
          qualityBtns[q.id] = btn;
        })(QUALITY[i]);
      }
      api.add(T('下载图片', 'Download image'), downloadImage);
    });

    const toolbar = h('div', {
      class: 'cmp-toolbar',
      role: 'toolbar',
      'aria-label': T('模拟器工具', 'Simulator tools')
    }, [
      h('div', { class: 'cmp-tools' }, [toggleDisc, toggleDoppler, toggleLensing]),
      h('div', { class: 'cmp-tools cmp-tools-right' }, [
        addMenu.wrap, undoBtn, shareBtn, moreMenu.wrap
      ])
    ]);

    /* ----- 场景 chips ----- */
    const scenesRow = h('div', {
      class: 'cmp-scenes',
      role: 'group',
      'aria-label': T('预设场景', 'Preset scenes')
    });
    const sceneList = BM.sceneList ? BM.sceneList() : ((D.compact && D.compact.scenes) || []);
    for (let s = 0; s < sceneList.length; s++) {
      (function (scene) {
        const label = EN ? (scene.en || scene.name) : (scene.name || scene.en);
        const chip = h('button', {
          class: 'cmp-btn cmp-scene',
          type: 'button',
          'aria-pressed': 'false',
          text: label
        });
        chip.addEventListener('click', function () {
          setPressed(chip, true);
          emitCmd({ type: 'scene', id: scene.id });
        });
        scenesRow.appendChild(chip);
        chips.push({ id: scene.id, el: chip });
      })(sceneList[s]);
    }

    /* ----- 相机条 ----- */
    const CAM_MODES = [
      { id: 'edge', zh: '侧视', en: 'Edge on' },
      { id: 'tilted', zh: '倾斜', en: 'Tilted' },
      { id: 'above', zh: '俯视', en: 'From above' },
      { id: 'close', zh: '特写', en: 'Close up' }
    ];
    const camRow = h('div', {
      class: 'cmp-cam',
      role: 'group',
      'aria-label': T('相机', 'Camera')
    });
    for (let c = 0; c < CAM_MODES.length; c++) {
      (function (m) {
        const btn = h('button', {
          class: 'cmp-btn',
          type: 'button',
          'aria-pressed': 'false',
          'aria-label': T(m.zh + '视角', m.en + ' view'),
          text: T(m.zh, m.en)
        });
        btn.addEventListener('click', function () {
          setPressed(btn, true);
          emitCmd({ type: 'camera', mode: m.id });
        });
        camRow.appendChild(btn);
        modeBtns[m.id] = btn;
      })(CAM_MODES[c]);
    }
    const zoomOut = h('button', {
      class: 'cmp-btn cmp-zoom',
      type: 'button',
      'aria-label': T('缩小', 'Zoom out'),
      text: '−'
    });
    const zoomIn = h('button', {
      class: 'cmp-btn cmp-zoom',
      type: 'button',
      'aria-label': T('放大', 'Zoom in'),
      text: '+'
    });
    zoomOut.addEventListener('click', function () { emitCmd({ type: 'zoom', dir: -1 }); });
    zoomIn.addEventListener('click', function () { emitCmd({ type: 'zoom', dir: 1 }); });
    const focusBtn = h('button', {
      class: 'cmp-btn',
      type: 'button',
      'aria-label': T('聚焦选中天体', 'Focus selected object'),
      text: T('聚焦', 'Focus')
    });
    focusBtn.addEventListener('click', function () {
      const sel = cs().selected;
      const id = sel != null ? sel : (stateBodies()[0] || {}).id;
      if (id != null) emitCmd({ type: 'focus', id: id });
    });
    const fallBtn = h('button', {
      class: 'cmp-btn',
      type: 'button',
      'aria-label': T('向黑洞坠落', 'Dive into the black hole'),
      text: T('坠落', 'Dive')
    });
    fallBtn.addEventListener('click', function () { emitCmd({ type: 'camera', mode: 'fall' }); });
    camRow.appendChild(zoomOut);
    camRow.appendChild(zoomIn);
    camRow.appendChild(focusBtn);
    camRow.appendChild(fallBtn);

    /* ----- 时间条 ----- */
    const revBtn = h('button', {
      class: 'cmp-btn',
      type: 'button',
      'aria-label': T('倒放', 'Play backwards'),
      'aria-pressed': 'false',
      text: T('倒放', 'Reverse')
    });
    const pauseBtn = h('button', {
      class: 'cmp-btn',
      type: 'button',
      'aria-label': T('暂停', 'Pause'),
      'aria-pressed': 'false',
      text: T('暂停', 'Pause')
    });
    const playBtn = h('button', {
      class: 'cmp-btn',
      type: 'button',
      'aria-label': T('播放', 'Play'),
      'aria-pressed': 'false',
      text: T('播放', 'Play')
    });
    revBtn.addEventListener('click', reverseTime);
    pauseBtn.addEventListener('click', function () { emitCmd({ type: 'playpause' }); });
    playBtn.addEventListener('click', playForward);

    const speedTrigger = h('button', {
      class: 'cmp-btn cmp-speed',
      type: 'button',
      'aria-label': T('播放速度', 'Playback speed'),
      'aria-haspopup': 'menu',
      text: '×1 ▾'
    });
    const speedItems = {};
    const speedMenu = makeMenu(speedTrigger, function (api) {
      for (let i = 0; i < SPEEDS.length; i++) {
        (function (v) {
          speedItems[v] = api.add('×' + v, function () { setSpeed(v); });
        })(SPEEDS[i]);
      }
    });

    const timeReset = h('button', {
      class: 'cmp-btn',
      type: 'button',
      'aria-label': T('重置模拟（同 Esc）', 'Reset simulation (Esc)'),
      text: T('重置', 'Reset')
    });
    timeReset.addEventListener('click', function () { emitCmd({ type: 'reset' }); });
    const timeOut = h('span', { class: 'cmp-time-out', text: 't = 0.00 s' });

    const timeRow = h('div', {
      class: 'cmp-time',
      role: 'group',
      'aria-label': T('时间', 'Time')
    }, [revBtn, pauseBtn, playBtn, speedMenu.wrap, timeReset, timeOut]);

    /* ----- 状态行（aria-live，唯一会主动播报的区域） ----- */
    const statusText = h('span', { class: 'cmp-status-text' });
    const statusAction = h('button', {
      class: 'cmp-btn cmp-status-action',
      type: 'button',
      hidden: true,
      text: T('取消', 'Cancel')
    });
    const statusEl = h('p', {
      class: 'cmp-status',
      role: 'status',
      'aria-live': 'polite',
      hidden: true
    }, [statusText, statusAction]);
    statusAction.addEventListener('click', function () {
      const fn = statusAction.__fn;
      if (typeof fn === 'function') { try { fn(); } catch (e) { /* 忽略 */ } }
    });

    /* ----- Details ----- */
    const detailsEl = h('div', {
      class: 'cmp-details',
      'aria-label': T('物理读数与对象', 'Physics readout and objects')
    });
    const emptyEl = h('p', {
      class: 'cmp-empty',
      hidden: true,
      text: T('场景里还没有天体。用「添加」放一个黑洞或恒星。', 'No bodies in this scene yet. Use Add to place a black hole or a star.')
    });
    const statsEl = h('dl', { class: 'cmp-stats' });
    const rows = {};
    function makeRow(key, zh, en) {
      const val = h('dd', { class: 'cmp-row-v', text: '—' });
      const lab = h('dt', { class: 'cmp-row-k', text: T(zh, en) });
      const row = h('div', { class: 'cmp-row', 'data-row': key, hidden: true }, [lab, val]);
      statsEl.appendChild(row);
      rows[key] = { row: row, val: val };
      return rows[key];
    }
    makeRow('dist', '距离', 'Distance');
    makeRow('clock', '时钟速率', 'Clock rate');
    makeRow('shadow', '阴影角直径', 'Shadow angle');
    makeRow('mass', '质量', 'Mass');
    makeRow('horizon', '事件视界半径', 'Event horizon');
    makeRow('isco', 'ISCO 半径', 'ISCO radius');
    makeRow('period', 'ISCO 周期', 'ISCO period');
    makeRow('gas', '气体速度', 'Gas speed');
    makeRow('doppler', '多普勒', 'Doppler');
    makeRow('sep', '黑洞间距', 'Separation');
    makeRow('orbital', '轨道周期', 'Orbital period');
    makeRow('merge', '并合倒计时', 'Merger in');
    makeRow('temp', '表面温度', 'Surface temperature');
    makeRow('starRadius', '恒星半径', 'Star radius');

    const objectsEl = h('div', {
      class: 'cmp-objects',
      role: 'group',
      'aria-label': T('场景中的天体', 'Objects in the scene')
    });
    const objectsSec = h('div', { class: 'cmp-objects-sec' }, [
      h('p', { class: 'cmp-sub', text: T('对象', 'Objects') }),
      objectsEl
    ]);

    const editTitle = h('p', { class: 'cmp-sub cmp-edit-title', text: T('编辑选中', 'Edit selection') });
    const editMassOut = h('span', { class: 'cmp-field-v', text: '—' });
    const editMass = h('input', {
      class: 'cmp-range',
      type: 'range',
      min: '0',
      max: '1000',
      step: '1',
      'aria-label': T('质量滑杆', 'Mass slider')
    });
    const editMassField = h('label', { class: 'cmp-field' }, [
      h('span', { class: 'cmp-field-k', text: T('质量', 'Mass') }),
      editMassOut,
      editMass
    ]);

    const discSizeOut = h('span', { class: 'cmp-field-v', text: '—' });
    const discSize = h('input', {
      class: 'cmp-range',
      type: 'range',
      min: '4',
      max: '24',
      step: '0.5',
      'aria-label': T('吸积盘外半径', 'Disc outer radius')
    });
    const discSizeField = h('label', { class: 'cmp-field' }, [
      h('span', { class: 'cmp-field-k', text: T('盘大小', 'Disc size') }),
      discSizeOut,
      discSize
    ]);

    const discTiltOut = h('span', { class: 'cmp-field-v', text: '—' });
    const discTilt = h('input', {
      class: 'cmp-range',
      type: 'range',
      min: '-80',
      max: '80',
      step: '5',
      'aria-label': T('吸积盘倾角', 'Disc tilt')
    });
    const discTiltField = h('label', { class: 'cmp-field' }, [
      h('span', { class: 'cmp-field-k', text: T('盘倾角', 'Disc tilt') }),
      discTiltOut,
      discTilt
    ]);

    const colorsEl = h('div', {
      class: 'cmp-colors',
      role: 'group',
      'aria-label': T('吸积盘颜色', 'Accretion disc color')
    });
    const colorList = BM.discColors ? BM.discColors() : ((D.compact && D.compact.discColors) || []);
    for (let k = 0; k < colorList.length; k++) {
      (function (color) {
        const sw = h('button', {
          class: 'cmp-swatch',
          type: 'button',
          'aria-pressed': 'false',
          'aria-label': T(color.name, color.en),
          title: T(color.name, color.en),
          style: { 'background-color': discColorCss(color.tempK) }
        });
        sw.addEventListener('click', function () { setDiscColor(color.tempK); });
        colorsEl.appendChild(sw);
        swatches.push({ el: sw, tempK: color.tempK });
      })(colorList[k]);
    }
    const colorField = h('div', { class: 'cmp-field' }, [
      h('span', { class: 'cmp-field-k', text: T('盘颜色', 'Disc color') }),
      colorsEl
    ]);

    const discBox = h('div', { class: 'cmp-disc' }, [discSizeField, discTiltField, colorField]);
    const delBtn = h('button', {
      class: 'cmp-btn cmp-del',
      type: 'button',
      text: T('删除选中天体', 'Delete selected object')
    });
    delBtn.addEventListener('click', function () {
      const sel = cs().selected;
      if (sel != null) emitCmd({ type: 'delete', id: sel });
    });
    const editSec = h('div', { class: 'cmp-edit', hidden: true }, [
      editTitle, editMassField, discBox, delBtn
    ]);

    detailsEl.appendChild(emptyEl);
    detailsEl.appendChild(statsEl);
    detailsEl.appendChild(objectsSec);
    detailsEl.appendChild(editSec);

    /* ----- 底部提示 ----- */
    const hintEl = h('p', {
      class: 'cmp-hint',
      text: T('拖拽环绕 · 滚轮缩放 · Space 暂停 · Esc 复位',
        'DRAG TO ORBIT · SCROLL TO ZOOM · SPACE TO PAUSE · ESC TO RESET')
    });

    consoleEl.appendChild(head);
    consoleEl.appendChild(toolbar);
    consoleEl.appendChild(scenesRow);
    consoleEl.appendChild(camRow);
    consoleEl.appendChild(timeRow);
    consoleEl.appendChild(statusEl);
    consoleEl.appendChild(detailsEl);
    consoleEl.appendChild(hintEl);
    root.appendChild(consoleEl);
    elRoot.appendChild(root);

    /* ============================================================
     * 控件行为
     * ============================================================ */
    function makeToggle(key, ariaLabel, text) {
      const btn = h('button', {
        class: 'cmp-btn cmp-tgl',
        type: 'button',
        'aria-label': ariaLabel,
        'aria-pressed': 'true',
        text: text
      });
      btn.addEventListener('click', function () {
        setPressed(btn, !isPressed(btn));
        emitCmd({ type: 'toggle', key: key });
      });
      return btn;
    }

    function chooseAdd(kind, presetId) {
      emitCmd({ type: 'addStart', kind: kind, presetId: presetId });
      setStatus(T('点击画面放置天体', 'Click the scene to place the object'), {
        kind: 'add',
        persist: true,
        action: { label: T('取消', 'Cancel'), fn: function () { emitCmd({ type: 'addCancel' }); clearStatus(); } }
      });
    }

    function currentSpeed() {
      const r = cs().rate;
      return finite(r) ? Math.abs(r) || 1 : 1;
    }
    function reverseTime() {
      const speed = clamp(currentSpeed(), 0.25, 8);
      if (cs().paused) emitCmd({ type: 'playpause' });
      const negative = !(finite(cs().rate) && cs().rate < 0);
      emitCmd({ type: 'rate', value: negative ? -speed : speed });
    }
    function playForward() {
      if (cs().paused) emitCmd({ type: 'playpause' });
      if (finite(cs().rate) && cs().rate < 0) {
        emitCmd({ type: 'rate', value: clamp(Math.abs(cs().rate), 0.25, 8) });
      }
    }
    function setSpeed(v) {
      const sign = finite(cs().rate) && cs().rate < 0 ? -1 : 1;
      const value = clamp(v, 0.25, 8) * sign;
      if (cs().paused) emitCmd({ type: 'playpause' });
      emitCmd({ type: 'rate', value: value });
    }
    function queueCmd(payload) {
      pendingCmd = payload;
      if (!pendingRaf) {
        pendingRaf = raf(function () {
          pendingRaf = 0;
          const p = pendingCmd;
          pendingCmd = null;
          if (p && mounted) emitCmd(p);
        });
      }
    }

    /* ----- 质量滑杆（对数映射；场景是唯一真源，tick 回来才同步） ----- */
    function massBounds(kind) {
      return kind === 'star' ? [0.08, 50] : [0.1, 1e10];
    }
    function massToSlider(mass, kind) {
      const b = massBounds(kind);
      const m = clamp(finite(mass) ? mass : b[0], b[0], b[1]);
      return Math.round(1000 * Math.log(m / b[0]) / Math.log(b[1] / b[0]));
    }
    function sliderToMass(v, kind) {
      const b = massBounds(kind);
      const t = clamp(v / 1000, 0, 1);
      return sig3(b[0] * Math.pow(b[1] / b[0], t));
    }

    editMass.addEventListener('input', function () {
      const sb = stateBody(cs().selected);
      if (!sb) return;
      const mass = sliderToMass(Number(editMass.value), sb.kind);
      editMassOut.textContent = fmtMass(mass);
      queueCmd({ type: 'mass', id: sb.id, mass: mass });
    });
    discSize.addEventListener('input', function () {
      const sb = stateBody(cs().selected);
      if (!sb) return;
      const outer = clamp(Number(discSize.value), 4, 24);
      discSizeOut.textContent = num(outer, 1) + ' rs';
      queueCmd({ type: 'disc', id: sb.id, patch: { outer: outer } });
    });
    discTilt.addEventListener('input', function () {
      const sb = stateBody(cs().selected);
      if (!sb) return;
      const deg = clamp(Number(discTilt.value), -80, 80);
      discTiltOut.textContent = deg + '°';
      queueCmd({ type: 'disc', id: sb.id, patch: { tilt: deg * Math.PI / 180 } });
    });
    function setDiscColor(tempK) {
      const sb = stateBody(cs().selected);
      if (!sb) return;
      emitCmd({ type: 'disc', id: sb.id, patch: { tempK: tempK } });
      for (let i = 0; i < swatches.length; i++) {
        setPressed(swatches[i].el, Math.abs(swatches[i].tempK - tempK) < 1);
      }
    }

    /* ============================================================
     * 状态 / 渲染
     * ============================================================ */
    function setStatus(text, opts) {
      opts = opts || {};
      if (statusTimer) { clearTimeout(statusTimer); statusTimer = 0; }
      statusKind = opts.kind || 'info';
      statusText.textContent = text || '';
      if (opts.action) {
        statusAction.hidden = false;
        statusAction.textContent = opts.action.label;
        statusAction.__fn = opts.action.fn;
      } else {
        statusAction.hidden = true;
        statusAction.__fn = null;
      }
      statusEl.hidden = !text;
      statusEl.setAttribute('data-kind', statusKind);
      if (!opts.persist) {
        statusTimer = setTimeout(function () {
          statusTimer = 0;
          if (mounted) clearStatus();
        }, 4200);
      }
    }
    function clearStatus() {
      if (statusTimer) { clearTimeout(statusTimer); statusTimer = 0; }
      statusKind = '';
      statusText.textContent = '';
      statusAction.hidden = true;
      statusAction.__fn = null;
      statusEl.hidden = true;
    }

    function shareScene() {
      const app = COSMOS.app;
      if (!app || typeof app.shareCompact !== 'function') {
        setStatus(T('分享不可用。', 'Share unavailable.'));
        return;
      }
      let promise = null;
      try { promise = app.shareCompact(); } catch (e) { promise = null; }
      if (!promise || typeof promise.then !== 'function') {
        setStatus(T('分享不可用。', 'Share unavailable.'));
        return;
      }
      setStatus(T('正在生成分享链接…', 'Building share link…'), { persist: true, kind: 'share' });
      promise.then(null, function () {
        if (mounted) setStatus(T('分享失败，请稍后重试。', 'Share failed — try again.'));
      });
    }

    function downloadImage() {
      let canvas = null;
      try {
        canvas = COSMOS.app && COSMOS.app.renderer && COSMOS.app.renderer.domElement;
      } catch (e) {
        canvas = null;
      }
      if (!canvas || typeof canvas.toDataURL !== 'function') {
        setStatus(T('无法下载：渲染器还没准备好。', 'Download unavailable: renderer not ready.'));
        return;
      }
      let url = '';
      try { url = canvas.toDataURL('image/png'); } catch (e2) { url = ''; }
      if (!url || url.length < 128) {
        setStatus(T('无法下载：画布像素没有保留，请稍后再试。', 'Download failed: canvas pixels were not preserved.'));
        return;
      }
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cosmos-atlas-blackhole-' + (cs().scene || 'scene') + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setStatus(T('图片已导出。', 'Image exported.'));
      } catch (e3) {
        setStatus(T('无法下载：浏览器阻止了导出。', 'Download blocked by the browser.'));
      }
    }

    /* ----- 各区域同步 ----- */
    function syncScene(id) {
      for (let i = 0; i < chips.length; i++) {
        setPressed(chips[i].el, chips[i].id === id);
      }
    }
    function syncToggles() {
      const show = cs().show || {};
      setPressed(toggleDisc, show.disc !== false);
      setPressed(toggleDoppler, show.doppler !== false);
      setPressed(toggleLensing, show.lensing !== false);
    }
    function syncQuality() {
      const q = cs().quality || 'auto';
      for (let id in qualityBtns) {
        if (Object.prototype.hasOwnProperty.call(qualityBtns, id)) {
          setPressed(qualityBtns[id], id === q);
        }
      }
    }
    function syncCam() {
      const mode = cs().cam && cs().cam.mode;
      for (let id in modeBtns) {
        if (Object.prototype.hasOwnProperty.call(modeBtns, id)) {
          setPressed(modeBtns[id], id === mode);
        }
      }
      const has = stateBodies().length > 0;
      focusBtn.disabled = !has;
      fallBtn.disabled = !has;
    }
    function syncUndo() {
      const n = cs().undoCount || 0;
      undoBtn.disabled = n <= 0;
      undoBtn.setAttribute('aria-disabled', n <= 0 ? 'true' : 'false');
      undoBtn.setAttribute('aria-label',
        n > 0 ? T('撤销上一步（剩余 ' + n + ' 步）', 'Undo last step (' + n + ' left)') : T('没有可撤销的步骤', 'Nothing to undo'));
      const badge = undoBadge;
      if (badge) {
        badge.textContent = String(n);
        badge.hidden = n <= 0;
      }
    }
    function syncTime(paused, rate, timeSec) {
      const isPaused = paused == null ? !!cs().paused : !!paused;
      const r = finite(rate) ? rate : (finite(cs().rate) ? cs().rate : 1);
      const speed = Math.abs(r) || 1;
      setPressed(pauseBtn, isPaused);
      setPressed(revBtn, r < 0);
      setPressed(playBtn, !isPaused && r > 0);
      speedTrigger.textContent = '×' + speed + ' ▾';
      speedTrigger.setAttribute('aria-label',
        T('播放速度（当前 ×' + speed + '）', 'Playback speed (currently ×' + speed + ')'));
      for (let i = 0; i < SPEEDS.length; i++) {
        const item = speedItems[SPEEDS[i]];
        if (item) setPressed(item, Math.abs(speed - SPEEDS[i]) < 1e-6);
      }
      timeOut.textContent = fmtSimTime(timeSec);
      if (isPaused) timeOut.classList.add('is-paused');
      else timeOut.classList.remove('is-paused');
    }
    function syncAddMode() {
      const on = !!cs().addMode;
      setPressed(addTrigger, on);
      if (on) {
        if (statusKind !== 'add') {
          setStatus(T('点击画面放置天体', 'Click the scene to place the object'), {
            kind: 'add',
            persist: true,
            action: { label: T('取消', 'Cancel'), fn: function () { emitCmd({ type: 'addCancel' }); clearStatus(); } }
          });
        }
      } else if (statusKind === 'add') {
        clearStatus();
      }
    }

    function renderDetails(tick) {
      const tickList = (tick && Array.isArray(tick.bodies)) ? tick.bodies : null;
      const fromTick = !!(tickList && tickList.length > 0);
      const bodies = tickList ? tickList : stateBodies();
      const selected = cs().selected;
      let view = selected != null ? bodyById(bodies, selected) : null;
      if (!view) view = bhPrimaryOf(bodies) || bodies[0] || null;

      const allRows = rows;
      for (let key in allRows) {
        if (Object.prototype.hasOwnProperty.call(allRows, key)) allRows[key].row.hidden = true;
      }
      const sceneId = (tick && tick.scene) || cs().scene;
      /* ns / wd 是固定的演示场景（几何叠加层，不参与对象编辑）；空 bodies 时给一行说明 */
      if (bodies.length === 0 && (sceneId === 'ns' || sceneId === 'wd')) {
        const msg = sceneId === 'ns'
          ? T('中子星演示场景：1.4 秒自转、磁层与射电束。此处为固定展示，切换到其他场景可添加黑洞或恒星。',
              'Neutron star showcase: 1.4 s spin, magnetosphere and radio beams. Fixed demo — switch to another scene to add bodies.')
          : T('白矮星演示场景：结晶表面与伴星磁力线。此处为固定展示，切换到其他场景可添加黑洞或恒星。',
              'White dwarf showcase: crystallized surface and a companion\'s field lines. Fixed demo — switch to another scene to add bodies.');
        if (emptyEl.textContent !== msg) emptyEl.textContent = msg;
        emptyEl.hidden = false;
      } else {
        const msg = T('场景里还没有天体。用「添加」放一个黑洞或恒星。',
                      'No bodies in this scene yet. Use Add to place a black hole or a star.');
        if (emptyEl.textContent !== msg) emptyEl.textContent = msg;
        emptyEl.hidden = bodies.length > 0;
      }
      objectsSec.hidden = bodies.length === 0;
      if (!view) return;

      const sb = stateBody(view.id);
      const mass = finite(view.mass) ? view.mass : (sb && finite(sb.mass) ? sb.mass : 30);
      const primary = fromTick && finite(tick.primaryMass) ? tick.primaryMass : primaryMassOf(bodies);
      const unit = unitKmOf(primary);
      const camDist = cs().cam && finite(cs().cam.dist) ? cs().cam.dist : null;
      const distRs = finite(view.distRs) ? view.distRs : camDist;
      const distKm = finite(view.distKm) ? view.distKm : (finite(distRs) ? distRs * unit : null);
      const isStar = view.kind === 'star';

      rows.dist.row.hidden = false;
      rows.dist.val.textContent = fmtDist(distRs, distKm) + (fromTick ? '' : T('（估算）', ' (approx.)'));
      rows.mass.row.hidden = false;
      rows.mass.val.textContent = fmtMass(mass);

      if (isStar) {
        const tempK = finite(view.tempK) ? view.tempK : (sb && finite(sb.tempK) ? sb.tempK : null);
        if (finite(tempK)) {
          rows.temp.row.hidden = false;
          rows.temp.val.textContent = num(tempK, 0) + ' K';
        }
        const radius = finite(view.radius) ? view.radius : (sb && finite(sb.radius) ? sb.radius : null);
        if (finite(radius)) {
          rows.starRadius.row.hidden = false;
          rows.starRadius.val.textContent = num(radius, 1) + ' rs · ' + fmtKm(radius * unit);
        }
      } else {
        const clock = finite(view.clockRate) ? view.clockRate
          : (finite(distRs) ? (BM.clockRate ? BM.clockRate(distRs) : null) : null);
        if (finite(clock)) {
          rows.clock.row.hidden = false;
          rows.clock.val.textContent = fmtPct(clock, 1);
        }
        const shadow = finite(view.shadowDeg) ? view.shadowDeg
          : (finite(distRs) ? (BM.shadowDeg ? BM.shadowDeg(distRs) : null) : null);
        if (finite(shadow)) {
          rows.shadow.row.hidden = false;
          rows.shadow.val.textContent = num(shadow, 1) + '°';
        }
        const horizon = finite(view.rsKm) ? view.rsKm : rsKmOf(mass);
        rows.horizon.row.hidden = false;
        rows.horizon.val.textContent = fmtKm(horizon) + ' · 1 rs';
        const isco = finite(view.iscoKm) ? view.iscoKm : (BM.iscoKm ? BM.iscoKm(mass) : 3 * rsKmOf(mass));
        rows.isco.row.hidden = false;
        rows.isco.val.textContent = fmtKm(isco) + ' · 3 rs';
        const period = BM.iscoPeriodSec ? BM.iscoPeriodSec(mass) : view.periodSec;
        if (finite(period)) {
          rows.period.row.hidden = false;
          rows.period.val.textContent = fmtDur(period);
        }
        const gas = finite(view.gasSpeedC) ? view.gasSpeedC : 0.5;
        rows.gas.row.hidden = false;
        rows.gas.val.textContent = num(gas, 2) + ' c';
        const doppler = (cs().show || {}).doppler !== false;
        rows.doppler.row.hidden = false;
        rows.doppler.val.textContent = doppler
          ? T('开 · 近侧增亮', 'On · approaching side brighter')
          : T('关 · 两侧等亮', 'Off · both sides equal');
      }

      /* 多黑洞：间距 / 轨道周期 / 并合倒计时 */
      const bhs = [];
      for (let b = 0; b < bodies.length; b++) if (bodies[b] && bodies[b].kind === 'bh') bhs.push(bodies[b]);
      if (bhs.length >= 2) {
        let sepRs = fromTick && finite(tick.sepRs) ? tick.sepRs : null;
        if (!finite(sepRs) && bhs[0].pos && bhs[1].pos && bhs[0].pos.length === 3 && bhs[1].pos.length === 3) {
          sepRs = distance3(bhs[0].pos, bhs[1].pos);
        }
        if (finite(sepRs)) {
          rows.sep.row.hidden = false;
          rows.sep.val.textContent = num(sepRs, 1) + ' rs · ' + fmtKm(sepRs * unit);
        }
        let orbital = fromTick && finite(tick.orbitalPeriodSec) ? tick.orbitalPeriodSec : null;
        if (!finite(orbital) && finite(sepRs) && sepRs > 0) {
          const totalMass = (bhs[0].mass || 0) + (bhs[1].mass || 0);
          const aKm = sepRs * unit;
          const rsTot = rsKmOf(totalMass);
          if (rsTot > 0) orbital = 2 * Math.PI * Math.sqrt((2 * aKm * aKm * aKm) / (rsTot * 299792.458 * 299792.458));
        }
        if (finite(orbital)) {
          rows.orbital.row.hidden = false;
          rows.orbital.val.textContent = fmtDur(orbital);
        }
      }
      const merge = tick && tick.merge;
      if (fromTick && merge) {
        if (merge.merged) {
          rows.merge.row.hidden = false;
          rows.merge.val.textContent = T('已完成', 'Complete');
        } else if (finite(tick.mergeInSec)) {
          rows.merge.row.hidden = false;
          rows.merge.val.textContent = fmtDur(tick.mergeInSec);
        } else if (merge.active && finite(merge.progress)) {
          rows.merge.row.hidden = false;
          rows.merge.val.textContent = fmtPct(merge.progress, 0);
        }
      }
    }

    function objName(body) {
      const list = stateBodies();
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        if (!list[i] || list[i].kind !== body.kind) continue;
        n += 1;
        if (list[i].id === body.id) break;
      }
      return (body.kind === 'bh' ? T('黑洞', 'Black hole') : T('恒星', 'Star')) + ' ' + n;
    }

    function renderObjects(tick) {
      const list = stateBodies();
      let sig = '';
      for (let i = 0; i < list.length; i++) sig += (list[i] ? list[i].id + ':' + list[i].kind : '') + ',';
      if (sig !== objSig) {
        objSig = sig;
        while (objectsEl.firstChild) objectsEl.removeChild(objectsEl.firstChild);
        objRows = [];
        for (let j = 0; j < list.length; j++) {
          (function (body) {
            const btn = h('button', {
              class: 'cmp-obj',
              type: 'button',
              'aria-pressed': 'false',
              'data-id': body.id
            }, [
              h('span', { class: 'cmp-obj-k', text: objName(body) }),
              h('span', { class: 'cmp-obj-m', text: '—' })
            ]);
            btn.addEventListener('click', function () { emitCmd({ type: 'select', id: body.id }); });
            objectsEl.appendChild(btn);
            objRows.push({ el: btn, massEl: btn.children[1] });
          })(list[j]);
        }
      }
      const selected = cs().selected;
      for (let k = 0; k < objRows.length && k < list.length; k++) {
        const body = list[k];
        const tb = tickBody(tick, body.id);
        const mass = tb && finite(tb.mass) ? tb.mass : body.mass;
        objRows[k].massEl.textContent = fmtMass(mass);
        setPressed(objRows[k].el, selected != null && body.id === selected);
      }
    }

    function syncEdit() {
      const selected = cs().selected;
      const sb = selected != null ? stateBody(selected) : null;
      if (!sb) {
        editSec.hidden = true;
        return;
      }
      editSec.hidden = false;
      const isBh = sb.kind === 'bh';
      editTitle.textContent = T('编辑 · ', 'Edit · ') + objName(sb);
      editMassOut.textContent = fmtMass(sb.mass);
      if (!isFocused(editMass)) editMass.value = String(massToSlider(sb.mass, sb.kind));
      discBox.hidden = !isBh;
      if (!isBh) return;
      const disc = sb.disc || {};
      const outer = finite(disc.outer) ? disc.outer : 8;
      if (!isFocused(discSize)) discSize.value = String(outer);
      discSizeOut.textContent = num(outer, 1) + ' rs';
      const deg = finite(disc.tilt) ? Math.round(disc.tilt * 180 / Math.PI) : 0;
      if (!isFocused(discTilt)) discTilt.value = String(deg);
      discTiltOut.textContent = deg + '°';
      for (let i = 0; i < swatches.length; i++) {
        setPressed(swatches[i].el, finite(disc.tempK) && Math.abs(swatches[i].tempK - disc.tempK) < 1);
      }
    }

    function render(tick) {
      if (!mounted) return;
      const S = cs();
      syncScene(tick && tick.scene ? tick.scene : S.scene);
      syncToggles();
      syncQuality();
      syncCam();
      syncUndo();
      syncTime(tick ? tick.paused : undefined, S.rate, tick && finite(tick.timeSec) ? tick.timeSec : S.timeSec);
      renderDetails(tick || null);
      renderObjects(tick || null);
      syncEdit();
      syncAddMode();
    }

    /* ============================================================
     * 事件订阅
     * ============================================================ */
    function onTick(payload) {
      if (!payload || typeof payload !== 'object') return;
      lastTick = payload;
      lastTickAt = nowMs();
      render(payload);
    }
    offs.push(COSMOS.on('compact:tick', onTick));
    offs.push(COSMOS.on('compact:ready', function () { render(lastTick); }));
    offs.push(COSMOS.on('compact:select', function () { render(lastTick); }));
    offs.push(COSMOS.on('compact:scene', function (payload) {
      if (payload && payload.id) syncScene(payload.id);
    }));
    offs.push(COSMOS.on('compact:history', function (payload) {
      if (payload && finite(payload.undoCount)) state.compact && (state.compact.undoCount = payload.undoCount);
      syncUndo();
    }));
    offs.push(COSMOS.on('compact:addPlaced', function () {
      clearStatus();
    }));
    offs.push(COSMOS.on('compact:merged', function () {
      setStatus(T('并合完成，两个黑洞合成一个更大的黑洞。', 'Merger complete — the two black holes became one.'));
    }));
    offs.push(COSMOS.on('compact:notice', function (payload) {
      const key = payload && payload.key;
      const msg = NOTICES[key];
      if (msg) setStatus(T(msg[0], msg[1]), key === 'fallin' ? { persist: true, kind: 'notice' } : {});
    }));
    offs.push(COSMOS.on('compact:share', function (payload) {
      if (!payload) return;
      setStatus(payload.ok
        ? T('分享链接已复制。', 'Share link copied.')
        : T('链接已生成，但复制失败了。', 'Link built, but copying failed.'));
    }));
    offs.push(COSMOS.on('cosmos:reset', function () { reset(); }));

    /* Esc：先关下拉 / 结束添加态，再交给 boot.js 复位场景（capture 抢先） */
    function onKeyCapture(e) {
      const key = e.key;
      const isEsc = key === 'Escape' || key === 'Esc' || e.keyCode === 27;
      if (!isEsc) return;
      if (anyMenuOpen()) {
        closeAllMenus();
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        return;
      }
      if (cs().addMode) {
        emitCmd({ type: 'addCancel' });
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
      }
    }
    function onDocPointerDown(e) {
      if (!anyMenuOpen()) return;
      for (let i = 0; i < menus.length; i++) {
        if (menus[i].open && containsNode(menus[i].wrap, e.target)) return;
      }
      closeAllMenus();
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('keydown', onKeyCapture, true);
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('pointerdown', onDocPointerDown, true);
    }

    /* tick 缺失时的粗读兜底（≤10Hz；tick 恢复后自动停） */
    function fallbackLoop() {
      if (!mounted) return;
      rafId = raf(fallbackLoop);
      const t = nowMs();
      if (lastTickAt && t - lastTickAt < 600) return;
      if (t - lastFallbackAt < 120) return;
      lastFallbackAt = t;
      render(null);
    }
    rafId = raf(fallbackLoop);

    /* ============================================================
     * 生命周期
     * ============================================================ */
    function reset() {
      closeAllMenus();
      clearStatus();
      if (pendingRaf) { caf(pendingRaf); pendingRaf = 0; }
      pendingCmd = null;
      lastTick = null;
      lastTickAt = 0;
      render(null);
    }
    function destroy() {
      if (!mounted) return;
      mounted = false;
      for (let i = 0; i < offs.length; i++) {
        try { offs[i](); } catch (e) { /* 已注销 */ }
      }
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('keydown', onKeyCapture, true);
      }
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('pointerdown', onDocPointerDown, true);
      }
      if (rafId) { caf(rafId); rafId = 0; }
      if (pendingRaf) { caf(pendingRaf); pendingRaf = 0; }
      if (statusTimer) { clearTimeout(statusTimer); statusTimer = 0; }
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    /* 首次同步：场景可能已发过 tick，也可能还没发 */
    render(lastTick);
    if (cs().undoCount == null && state.compact) state.compact.undoCount = 0;

    return { update: function () { /* 无滚动驱动状态 */ }, reset: reset, destroy: destroy };
  });
})(window.COSMOS = window.COSMOS || {});
