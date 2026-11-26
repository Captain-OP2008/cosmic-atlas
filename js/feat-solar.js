/* ============================================================
 * COSMOS ATLAS · feat-solar.js
 * 02 太阳系 · 右侧控制台 + 天体档案抽屉（widget: solar）
 *
 * 契约（artifacts/p1-contract.md §2 / §4.3 / §6）：
 *   COSMOS.registerWidget('solar', function (el, content, section) → { update(p, o), reset() })
 *   状态：读 COSMOS.state.solar
 *     { timeMs, daysPerSec, paused, view, focus, selected, labels, orbits, enlarge }
 *   发：COSMOS.emit('solar:cmd', { type:'view'|'focus'|'select'|'goto'|'reset'|'enlarge', … })
 *   收：solar:tick / solar:ready / solar:focus / solar:hover / cosmos:escape
 * 不写 #sol-labels（归 scene-solarsystem.js），不写 #sol-events / #sol-sky（归 feat-sky/events）。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var T = (COSMOS.i18n && COSMOS.i18n.T) || function (zh) { return zh; };
  var EN = !!(COSMOS.i18n && COSMOS.i18n.en);
  var h = (COSMOS.dom && COSMOS.dom.h) || null;
  var U = COSMOS.util || {};
  var D = COSMOS.DATA || null;

  if (!h || !D) return;

  var uNum = U.num || function (v) { return String(v); };
  var richText = U.richText || function (v) { return String(v); };
  var clear = (COSMOS.dom && COSMOS.dom.clear) || function (node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  };

  var MISSING = '—';
  var DATE = new Date(0);
  var ATM_COLORS = ['#288BFF', '#1C67E3', '#0B3D91', '#B9B9BB', '#717173', '#444447'];

  /* 速度预设：daysPerSec = 每个现实秒推进的模拟天数 */
  var PRESETS = [
    { rate: 1 / 86400, zh: '实时', en: 'Real time' },
    { rate: 1 / 1440, zh: '1 分/秒', en: '1 min/s' },
    { rate: 1 / 144, zh: '10 分/秒', en: '10 min/s' },
    { rate: 1 / 24, zh: '1 小时/秒', en: '1 hr/s' },
    { rate: 1 / 12, zh: '2 小时/秒', en: '2 hr/s' },
    { rate: 1 / 4, zh: '6 小时/秒', en: '6 hr/s' },
    { rate: 1, zh: '1 天/秒', en: '1 day/s' },
    { rate: 7, zh: '1 周/秒', en: '1 week/s' },
    { rate: 30, zh: '1 月/秒', en: '1 month/s' },
    { rate: 365.25, zh: '1 年/秒', en: '1 year/s' }
  ];

  /* ---------------- 小工具 ---------------- */

  function pad2(v) { return (v < 10 ? '0' : '') + v; }
  function pad4(v) {
    var s = String(Math.abs(v));
    while (s.length < 4) s = '0' + s;
    return (v < 0 ? '-' : '') + s;
  }

  function decimalsFor(v) {
    var a = Math.abs(v);
    if (a === 0) return 0;
    if (a < 0.01) return 4;
    if (a < 1) return 3;
    if (a < 1000) return 2;
    return (Math.round(v) === v) ? 0 : 1;
  }

  function fmtNum(v) {
    var n = Number(v);
    if (!isFinite(n)) return MISSING;
    return trimNum(n, decimalsFor(n));
  }

  function trimNum(v, digits) {
    var s = uNum(v, digits);
    if (s.indexOf('.') >= 0) {
      s = s.replace(/0+$/, '');
      if (s.charAt(s.length - 1) === '.') s = s.slice(0, -1);
    }
    return s;
  }

  function matchPreset(rate) {
    for (var i = 0; i < PRESETS.length; i++) {
      var r = PRESETS[i].rate;
      if (Math.abs(rate - r) <= Math.abs(r) * 1e-6 + 1e-12) return PRESETS[i];
    }
    return null;
  }

  /* 当前速度的可得读法：预设命中直接用预设文案，其余按量级换算 */
  function rateLabel(rate) {
    var r = Number(rate);
    if (!isFinite(r) || r === 0) return T('暂停', 'Paused');
    var sign = r < 0 ? '-' : '';
    var a = Math.abs(r);
    var preset = matchPreset(a);
    if (preset) return sign + T(preset.zh, preset.en);
    if (Math.abs(a - 1 / 86400) <= (1 / 86400) * 0.02) return T('实时', 'Real time');
    var unitZh = '天';
    var unitEn = 'day';
    var x = a;
    if (a >= 300) { unitZh = '年'; unitEn = 'year'; x = a / 365.25; }
    else if (a >= 29) { unitZh = '月'; unitEn = 'month'; x = a / 30; }
    else if (a >= 6) { unitZh = '周'; unitEn = 'week'; x = a / 7; }
    else if (a >= 0.9) { unitZh = '天'; unitEn = 'day'; x = a; }
    else if (a >= 0.9 / 24) { unitZh = '小时'; unitEn = 'hour'; x = a * 24; }
    else if (a >= 0.9 / 1440) { unitZh = '分'; unitEn = 'minute'; x = a * 1440; }
    else { unitZh = '秒'; unitEn = 'second'; x = a * 86400; }
    return sign + trimNum(r < 0 ? -x : x, 2) + ' ' + T(unitZh, unitEn) + T('/秒', '/s');
  }

  function setPressed(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  /* ---------------- 控件 ---------------- */

  COSMOS.registerWidget('solar', function (el, content, section) {
    /* ---- 状态（只读为主；写前判 undefined，不覆盖 boot/scene 已建的默认） ---- */
    var S = COSMOS.state || (COSMOS.state = {});
    var st = S.solar || (S.solar = {});
    if (st.timeMs === undefined) st.timeMs = Date.now();
    if (st.daysPerSec === undefined) st.daysPerSec = 1;
    if (st.paused === undefined) st.paused = false;
    if (st.view === undefined) st.view = 'whole';
    if (st.focus === undefined) st.focus = null;
    if (st.selected === undefined) st.selected = null;
    if (st.labels === undefined) st.labels = true;
    if (st.orbits === undefined) st.orbits = true;
    if (st.enlarge === undefined) st.enlarge = false;

    var planets = D.planets || [];
    var dwarfs = D.dwarfPlanets || [];
    var allMoons = D.moons || [];

    /* ---- 天体索引 ---- */
    var INFO = Object.create(null);
    var bodyChips = Object.create(null);
    var moonChips = Object.create(null);

    function reg(id, kind, data, parent) {
      INFO[id] = {
        id: id,
        kind: kind,
        data: data,
        parent: parent || null,
        name: T(data.name, (data.en || data.name))
      };
    }

    reg('sun', 'sun', D.sun, null);
    for (var pi = 0; pi < planets.length; pi++) reg(planets[pi].id, 'planet', planets[pi], null);
    for (var di = 0; di < dwarfs.length; di++) reg(dwarfs[di].id, 'dwarf', dwarfs[di], null);
    for (var mi = 0; mi < allMoons.length; mi++) {
      reg(allMoons[mi].id, 'moon', allMoons[mi], allMoons[mi].parent || null);
    }

    function moonsOf(parentId) {
      if (!parentId) return [];
      if (typeof D.moonsByParent === 'function') return D.moonsByParent(parentId) || [];
      var out = [];
      for (var i = 0; i < allMoons.length; i++) {
        if (allMoons[i].parent === parentId) out.push(allMoons[i]);
      }
      return out;
    }

    function currentFocus() {
      var id = st.focus || st.selected || null;
      return id && INFO[id] ? id : null;
    }

    var locals = {
      visible: false,
      hoverId: null,
      hoverEmit: null,
      moonParent: null,
      clockMs: isFinite(st.timeMs) ? st.timeMs : Date.now(),
      clockText: '',
      localText: '',
      clockMinute: '',
      lastTickAt: 0,
      lastPaintAt: 0,
      rafId: 0,
      readout: { id: null, ok: false, approx: false, helio: NaN, geo: NaN, light: NaN },
      open: false,
      drawerId: null,
      lastFocus: null,
      closeTimer: 0,
      statusTimer: 0
    };

    /* ---- 时间区 ---- */
    var refs = {
      clock: null, local: null, dateInput: null, timeInput: null,
      playBtn: null, revBtn: null, pauseBtn: null,
      rateNow: null, rateBtns: [],
      viewBtns: Object.create(null), followBtn: null,
      labelsBtn: null, orbitsBtn: null, enlargeBtn: null, enlargeNote: null,
      bodies: null, moonsBlock: null, moonsLabel: null, moonList: null,
      status: null,
      consoleBody: null, more: null,
      consoleLive: null, drawerLive: null,
      drawer: null, scrim: null, drawerBody: null, drawerTitleName: null,
      drawerEn: null, drawerKicker: null, drawerClose: null,
      thumb: null, tagline: null, statGrid: null, statSlots: [],
      brief: null, special: null, atmoBlock: null, atmoTitle: null,
      atmoBar: null, atmoLegend: null, atmoNote: null,
      moonsHeading: null
    };

    refs.clock = h('div', { class: 'solar-clock u-mono', id: 'sol-clock', text: '—' });
    refs.local = h('div', { class: 'solar-local u-mono', text: '' });

    var gotoBtn = h('button', {
      class: 'btn is-ghost is-small',
      type: 'button',
      'aria-label': T('跳转到输入的 UTC 时间', 'Jump to the entered UTC time'),
      text: T('跳转', 'Go')
    });
    var nowBtn = h('button', {
      class: 'btn is-ghost is-small',
      type: 'button',
      'aria-label': T('回到当前时刻', 'Jump to now'),
      text: T('现在', 'Now')
    });

    refs.dateInput = h('input', {
      class: 'solar-input solar-input-date u-mono',
      type: 'date',
      id: 'sol-date',
      min: '1800-01-01',
      max: '2100-12-31',
      step: '1',
      'aria-label': T('日期（UTC，1800–2100）', 'Date (UTC, 1800–2100)')
    });
    refs.timeInput = h('input', {
      class: 'solar-input solar-input-time u-mono',
      type: 'time',
      id: 'sol-time',
      step: '60',
      'aria-label': T('时间（UTC，24 小时制）', 'Time (UTC, 24-hour)')
    });

    var timeForm = h('div', { class: 'solar-time-form' }, [
      h('label', { class: 'solar-field solar-field-date', 'for': 'sol-date' }, [
        h('span', { class: 'solar-field-label u-mono', text: T('日期 UTC', 'DATE UTC') }),
        refs.dateInput
      ]),
      h('label', { class: 'solar-field solar-field-time', 'for': 'sol-time' }, [
        h('span', { class: 'solar-field-label u-mono', text: T('时间 UTC', 'TIME UTC') }),
        refs.timeInput
      ])
    ]);

    var timeSection = h('section', { class: 'solar-sec solar-sec-time', 'aria-label': T('时间', 'Time') }, [
      h('p', { class: 'solar-sec-label u-mono', text: T('时间', 'TIME') }),
      refs.clock,
      refs.local,
      timeForm,
      h('div', { class: 'solar-btn-row solar-time-actions' }, [gotoBtn, nowBtn])
    ]);

    /* ---- 播放区 ---- */
    refs.revBtn = h('button', {
      class: 'btn is-ghost is-small solar-play', type: 'button',
      'aria-label': T('倒放公转', 'Run the simulation backwards'),
      'aria-pressed': 'false',
      text: T('倒放', 'Reverse')
    });
    refs.playBtn = h('button', {
      class: 'btn is-ghost is-small solar-play', type: 'button',
      'aria-label': T('正向播放公转', 'Play the simulation forwards'),
      'aria-pressed': 'false',
      text: T('播放', 'Play')
    });
    refs.pauseBtn = h('button', {
      class: 'btn is-ghost is-small solar-play', type: 'button',
      'aria-label': T('暂停公转', 'Pause the simulation'),
      'aria-pressed': 'false',
      text: T('暂停', 'Pause')
    });

    var rateGrid = h('div', {
      class: 'solar-rates',
      role: 'group',
      'aria-label': T('速度预设', 'Speed presets')
    });
    for (var rp = 0; rp < PRESETS.length; rp++) {
      (function (preset) {
        var b = h('button', {
          class: 'btn is-ghost is-small solar-rate',
          type: 'button',
          'aria-pressed': 'false',
          'aria-label': T('速度设为 ' + preset.zh, 'Set speed to ' + preset.en),
          text: T(preset.zh, preset.en)
        });
        b.__rate = preset.rate;
        b.addEventListener('click', function () { setRate(preset.rate); });
        refs.rateBtns.push(b);
        rateGrid.appendChild(b);
      })(PRESETS[rp]);
    }

    refs.rateNow = h('output', {
      class: 'solar-rate-now u-mono',
      'aria-live': 'polite',
      text: ''
    });
    var slowerBtn = h('button', {
      class: 'btn is-ghost is-small solar-rate-step', type: 'button',
      'aria-label': T('减慢一档', 'Slower'), text: '−'
    });
    var fasterBtn = h('button', {
      class: 'btn is-ghost is-small solar-rate-step', type: 'button',
      'aria-label': T('加快一档', 'Faster'), text: '+'
    });
    slowerBtn.addEventListener('click', function () { stepRate(-1); });
    fasterBtn.addEventListener('click', function () { stepRate(1); });

    var playSection = h('section', { class: 'solar-sec solar-sec-play', 'aria-label': T('播放与速度', 'Playback and speed') }, [
      h('p', { class: 'solar-sec-label u-mono', text: T('播放', 'PLAYBACK') }),
      h('div', { class: 'solar-btn-row solar-play-row' }, [refs.revBtn, refs.playBtn, refs.pauseBtn]),
      rateGrid,
      h('div', { class: 'solar-rate-row' }, [slowerBtn, refs.rateNow, fasterBtn])
    ]);

    /* ---- 视图区 ---- */
    function makeViewBtn(view, zh, en) {
      var b = h('button', {
        class: 'btn is-ghost is-small solar-view',
        type: 'button',
        'aria-pressed': 'false',
        'aria-label': T(zh, en),
        text: T(zh, en)
      });
      b.__view = view;
      b.addEventListener('click', function () { setView(view); });
      refs.viewBtns[view] = b;
      return b;
    }

    var viewRow = h('div', { class: 'solar-views' }, [
      makeViewBtn('whole', '全系统', 'Whole system'),
      makeViewBtn('inner', '内行星', 'Inner planets'),
      makeViewBtn('planet', '跟随天体', 'Follow body')
    ]);

    refs.labelsBtn = h('button', {
      class: 'btn is-ghost is-small', type: 'button',
      'aria-pressed': 'true',
      'aria-label': T('显示或隐藏天体标签', 'Show or hide body labels'),
      text: T('标签', 'Labels')
    });
    refs.orbitsBtn = h('button', {
      class: 'btn is-ghost is-small', type: 'button',
      'aria-pressed': 'true',
      'aria-label': T('显示或隐藏轨道线', 'Show or hide orbit lines'),
      text: T('轨道', 'Orbits')
    });
    refs.enlargeBtn = h('button', {
      class: 'btn is-ghost is-small', type: 'button',
      'aria-pressed': 'false',
      'aria-label': T('放大行星尺寸以便观察', 'Enlarge planet sizes for visibility'),
      text: T('放大行星', 'Enlarge')
    });
    var resetBtn = h('button', {
      class: 'btn is-ghost is-small', type: 'button',
      'aria-label': T('复位视角与时间（Esc）', 'Reset view and time (Esc)'),
      text: T('复位', 'Reset')
    });
    refs.enlargeNote = h('p', {
      class: 'solar-scale-note u-mono',
      text: T('尺寸放大，不按比例', 'Sizes enlarged, not to scale')
    });
    refs.enlargeNote.hidden = true;

    var viewSection = h('section', { class: 'solar-sec solar-sec-view', 'aria-label': T('视图', 'View') }, [
      h('p', { class: 'solar-sec-label u-mono', text: T('视图', 'VIEW') }),
      viewRow,
      h('div', { class: 'solar-toggles' }, [resetBtn, refs.labelsBtn, refs.orbitsBtn, refs.enlargeBtn]),
      refs.enlargeNote
    ]);

    /* ---- 天体区 ---- */
    refs.bodies = h('div', {
      class: 'solar-bodies',
      role: 'group',
      'aria-label': T('天体列表', 'Bodies')
    });

    function makeBodyChip(id) {
      var info = INFO[id];
      if (!info) return null;
      var data = info.data;
      var btn = h('button', {
        class: 'solar-body',
        type: 'button',
        'data-id': id,
        'aria-pressed': 'false',
        'aria-label': T('聚焦并查看' + info.name + '档案', 'Focus and open the ' + info.name + ' profile'),
        title: T(info.name + '（' + (data.en || '') + '）', info.name)
      }, [
        h('span', { class: 'solar-body-sym', 'aria-hidden': 'true', text: data.symbol || '•' }),
        h('span', { class: 'solar-body-name', text: info.name })
      ]);
      btn.addEventListener('click', function () { pickBody(id); });
      btn.addEventListener('pointerenter', function () { emitHover(id); });
      btn.addEventListener('pointerleave', function () { emitHover(null); });
      btn.addEventListener('focus', function () { emitHover(id); });
      btn.addEventListener('blur', function () { emitHover(null); });
      bodyChips[id] = btn;
      return btn;
    }

    var bodyOrder = ['sun'];
    for (var bo = 0; bo < planets.length; bo++) bodyOrder.push(planets[bo].id);
    for (var bd = 0; bd < dwarfs.length; bd++) bodyOrder.push(dwarfs[bd].id);
    for (var bi = 0; bi < bodyOrder.length; bi++) {
      var chipEl = makeBodyChip(bodyOrder[bi]);
      if (chipEl) refs.bodies.appendChild(chipEl);
    }

    refs.moonsLabel = h('p', { class: 'solar-moons-label u-mono', text: '' });
    refs.moonList = h('div', { class: 'solar-moon-list', role: 'group', 'aria-label': T('卫星列表', 'Moons') });
    refs.moonsBlock = h('div', { class: 'solar-moons' }, [refs.moonsLabel, refs.moonList]);
    refs.moonsBlock.hidden = true;

    var bodiesSection = h('section', { class: 'solar-sec solar-sec-bodies', 'aria-label': T('天体', 'Bodies') }, [
      h('p', { class: 'solar-sec-label u-mono', text: T('天体', 'BODIES') }),
      refs.bodies,
      refs.moonsBlock
    ]);

    function makeMoonChip(moon) {
      var info = INFO[moon.id];
      var btn = h('button', {
        class: 'solar-moon',
        type: 'button',
        'data-id': moon.id,
        'aria-pressed': 'false',
        'aria-label': T('聚焦并查看' + info.name + '档案', 'Focus and open the ' + info.name + ' profile')
      }, [
        h('span', { class: 'solar-moon-sym', 'aria-hidden': 'true', text: moon.symbol || '•' }),
        h('span', { class: 'solar-moon-name', text: info.name })
      ]);
      btn.addEventListener('click', function () { pickBody(moon.id); });
      btn.addEventListener('pointerenter', function () { emitHover(moon.id); });
      btn.addEventListener('pointerleave', function () { emitHover(null); });
      btn.addEventListener('focus', function () { emitHover(moon.id); });
      btn.addEventListener('blur', function () { emitHover(null); });
      moonChips[moon.id] = btn;
      return btn;
    }

    /* ---- 实时读数条 ---- */
    function createLive(extraClass) {
      var cells = [];
      var grid = h('dl', { class: 'solar-live-grid' });
      var defs = [
        { zh: '日心距', en: 'HELIO', unit: 'AU' },
        { zh: '地心距', en: 'GEO', unit: 'AU' },
        { zh: '光行时', en: 'LIGHT TIME', unit: 'min' }
      ];
      for (var i = 0; i < defs.length; i++) {
        var v = h('span', { class: 'solar-live-v u-mono', text: MISSING });
        var u = h('span', { class: 'solar-live-u u-mono', text: defs[i].unit });
        grid.appendChild(h('div', { class: 'solar-live-cell' }, [
          h('dt', { class: 'solar-live-dt u-mono', text: T(defs[i].zh, defs[i].en) }),
          h('dd', { class: 'solar-live-dd' }, [v, u])
        ]));
        cells.push(v);
      }
      var name = h('p', { class: 'solar-live-name', text: '' });
      var note = h('p', { class: 'solar-live-note u-dim', text: '' });
      var node = h('div', {
        class: 'solar-live' + (extraClass ? ' ' + extraClass : ''),
        role: 'status',
        'aria-live': 'off'
      }, [name, grid, note]);
      node.hidden = true;
      return { el: node, name: name, cells: cells, note: note };
    }

    refs.consoleLive = createLive('solar-live-console');

    /* ---- 动作区 ---- */
    var eventsBtn = h('button', {
      class: 'btn is-ghost is-small solar-action', type: 'button',
      'aria-label': T('打开事件面板：近期天象', 'Open the events panel'),
      text: T('事件', 'Events')
    });
    var skyBtn = h('button', {
      class: 'btn is-ghost is-small solar-action', type: 'button',
      'aria-label': T('打开天空面板：此刻星空', 'Open the sky panel'),
      text: T('天空', 'Sky')
    });
    var shareBtn = h('button', {
      class: 'btn is-ghost is-small solar-action', type: 'button',
      'aria-label': T('复制当前时刻的分享链接', 'Copy a link to the current moment'),
      text: T('分享', 'Share')
    });
    var compareBtn = h('button', {
      class: 'btn is-small solar-compare', type: 'button',
      'aria-label': T('前往行星对比实验室', 'Go to the Planet Lab'),
      text: T('行星对比 →', 'Planet Lab →')
    });

    var actionsSection = h('section', { class: 'solar-sec solar-sec-actions', 'aria-label': T('动作', 'Actions') }, [
      h('p', { class: 'solar-sec-label u-mono', text: T('动作', 'ACTIONS') }),
      h('div', { class: 'solar-btn-row solar-actions' }, [eventsBtn, skyBtn, shareBtn, compareBtn])
    ]);

    refs.status = h('p', { class: 'solar-status', role: 'status', 'aria-live': 'polite', text: '' });

    var note = h('p', {
      class: 'solar-note u-dim',
      text: T(
        '距离与太阳尺寸已压缩；行星相对大小按真实直径比例缩放，默认开启「放大行星」以便观察。',
        'Distances and the Sun are compressed; planet sizes keep their true diameter ratios. Use Enlarge to widen the small worlds.'
      )
    });
    var hint = h('p', {
      class: 'solar-hint u-dim',
      text: T(
        '拖拽旋转 · Ctrl+滚轮/双指缩放 · ←/→ 旋转 · Q/E 俯仰 · +/− 缩放 · 点行星开档案 · Esc 复位',
        'Drag to orbit · Ctrl+wheel or pinch to zoom · ←/→ rotate · Q/E pitch · +/− zoom · Click a body for its profile · Esc resets'
      )
    });

    /* 滚动区只放 时间/播放/视图 + 说明；实时读数、天体 chips、动作区固定在下方，720p 首屏可见 */
    var moreHint = h('div', {
      class: 'solar-console-more u-mono',
      'aria-hidden': 'true',
      text: T('↓ 更多说明', '↓ More')
    });

    var consoleBody = h('div', { class: 'solar-console-body' }, [
      timeSection,
      playSection,
      viewSection,
      note,
      hint
    ]);
    refs.consoleBody = consoleBody;
    refs.more = moreHint;

    var consoleScroll = h('div', { class: 'solar-console-scroll' }, [consoleBody, moreHint]);

    var consoleFoot = h('div', { class: 'solar-console-foot' }, [
      refs.status,
      actionsSection
    ]);

    var consoleEl = h('div', { class: 'solar-console' }, [
      h('div', { class: 'solar-console-head' }, [
        h('p', { class: 'solar-console-kicker u-mono', text: T('02 · 太阳系', '02 · SOLAR SYSTEM') }),
        h('p', { class: 'solar-console-sub u-mono', text: T('星历控制台', 'EPHEMERIS CONSOLE') })
      ]),
      consoleScroll,
      refs.consoleLive.el,
      bodiesSection,
      consoleFoot
    ]);

    function updateMore() {
      if (!refs.consoleBody || !refs.more) return;
      var box = refs.consoleBody;
      var overflow = box.scrollHeight - box.clientHeight > 6;
      var atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 6;
      refs.more.classList.toggle('is-on', !!overflow && !atEnd);
    }

    refs.consoleBody.addEventListener('scroll', updateMore, { passive: true });
    window.addEventListener('resize', updateMore);

    var root = h('div', { class: 'sol-ui solar-ui', 'data-ui': '' }, [consoleEl]);
    el.appendChild(root);

    /* ============================================================
     * 档案抽屉（body 级，role=dialog）
     * ============================================================ */
    var staleScrim = document.getElementById('sol-scrim');
    if (staleScrim && staleScrim.parentNode) staleScrim.parentNode.removeChild(staleScrim);
    var staleDrawer = document.getElementById('sol-drawer');
    if (staleDrawer && staleDrawer.parentNode) staleDrawer.parentNode.removeChild(staleDrawer);

    refs.drawerKicker = h('p', { class: 'solar-drawer-kicker u-mono', text: T('02 · 太阳系 / 天体档案', '02 · Solar System / Body profile') });
    refs.drawerTitleName = h('span', { class: 'solar-drawer-name' });
    refs.drawerEn = h('span', { class: 'solar-drawer-en u-mono' });
    var drawerTitle = h('h3', { class: 'solar-drawer-title', id: 'sol-drawer-title' }, [refs.drawerTitleName, refs.drawerEn]);
    refs.drawerClose = h('button', {
      class: 'solar-drawer-close',
      type: 'button',
      'aria-label': T('关闭档案（Esc）', 'Close profile (Esc)'),
      title: T('关闭（Esc）', 'Close (Esc)'),
      text: '×'
    });

    var drawerHead = h('header', { class: 'solar-drawer-head' }, [
      refs.drawerKicker,
      drawerTitle,
      refs.drawerClose
    ]);

    refs.thumb = h('figure', { class: 'solar-thumb', 'aria-hidden': 'true' });
    refs.tagline = h('p', { class: 'solar-tagline' });
    refs.statGrid = h('dl', { class: 'solar-stats' });

    var STAT_ROWS = [
      {
        key: 'diameter', zh: '直径', en: 'DIAMETER', unit: 'km',
        get: function (d) { return d.diameterKm != null ? d.diameterKm : (d.radiusKm != null ? d.radiusKm * 2 : null); }
      },
      {
        key: 'mass', zh: '质量', en: 'MASS', unit: 'kg', rich: true,
        get: function (d) { return d.massKg; }
      },
      {
        key: 'gravity', zh: '表面重力', en: 'GRAVITY', unit: 'm/s²',
        get: function (d) { return d.gravity; }
      },
      {
        key: 'rotation', zh: '自转周期', en: 'ROTATION', unit: 'h',
        get: function (d) {
          if (d.dayHours != null) return d.dayHours;
          if (d.rotationDays != null) return d.rotationDays * 24;
          return null;
        }
      },
      {
        key: 'orbit', zh: '公转周期', en: 'ORBIT', unit: 'd',
        get: function (d) {
          if (d.yearDays != null) return d.yearDays;
          if (d.periodDays != null) return d.periodDays;
          return null;
        }
      },
      {
        key: 'temp', zh: '平均温度', en: 'MEAN TEMP', unit: '°C',
        get: function (d) { return d.tempAvgC != null ? d.tempAvgC : (d.surfaceC != null ? d.surfaceC : null); }
      },
      {
        key: 'distance', zh: '轨道半径', en: 'ORBIT RADIUS', unit: 'km',
        get: function (d) { return d.distanceKm; }
      },
      {
        key: 'moons', zh: '卫星数', en: 'MOONS', unit: T('颗', ''),
        get: function (d) {
          if (d.moons != null) return d.moons;
          var n = moonsOf(d.id).length;
          return n || null;
        }
      }
    ];

    for (var sr = 0; sr < STAT_ROWS.length; sr++) {
      var row = STAT_ROWS[sr];
      var vEl = h('span', { class: 'stat-v u-mono' });
      var uEl = h('span', { class: 'stat-u u-mono' });
      var cell = h('div', { class: 'solar-stat' }, [
        h('dt', { class: 'stat-l u-mono', text: T(row.zh, row.en) }),
        h('dd', { class: 'solar-stat-val' }, [vEl, uEl])
      ]);
      refs.statSlots.push({ row: row, cell: cell, v: vEl, u: uEl });
      refs.statGrid.appendChild(cell);
    }

    var drawerTop = h('div', { class: 'solar-drawer-top' }, [
      refs.thumb,
      h('div', { class: 'solar-drawer-intro' }, [refs.tagline, refs.statGrid])
    ]);

    refs.drawerLive = createLive('solar-live-drawer');

    refs.brief = h('p', { class: 'solar-brief' });
    refs.special = h('p', { class: 'solar-special' });

    refs.moonsHeading = h('h4', { class: 'solar-drawer-h u-mono', text: T('卫星', 'MOONS') });
    var drawerMoonList = h('div', { class: 'solar-drawer-moons-list' });
    var drawerMoonsBlock = h('div', { class: 'solar-drawer-moons' }, [refs.moonsHeading, drawerMoonList]);
    drawerMoonsBlock.hidden = true;

    refs.followBtn = h('button', {
      class: 'btn solar-follow',
      type: 'button',
      'aria-pressed': 'false',
      'aria-label': T('让镜头跟随此天体', 'Make the camera follow this body'),
      text: T('跟随此天体', 'Follow this body')
    });

    refs.atmoTitle = h('h4', { class: 'solar-drawer-h u-mono', text: T('大气成分', 'ATMOSPHERE') });
    refs.atmoBar = h('div', { class: 'solar-atmo-bar', 'aria-hidden': 'true' });
    refs.atmoLegend = h('ul', { class: 'solar-atmo-legend' });
    refs.atmoNote = h('p', { class: 'solar-atmo-note u-dim' });
    refs.atmoBlock = h('div', { class: 'solar-atmo' }, [refs.atmoTitle, refs.atmoBar, refs.atmoLegend, refs.atmoNote]);

    refs.drawerBody = h('div', { class: 'solar-drawer-body' }, [
      drawerTop,
      refs.drawerLive.el,
      refs.followBtn,
      refs.brief,
      refs.special,
      drawerMoonsBlock,
      refs.atmoBlock
    ]);

    var drawerInner = h('div', { class: 'solar-drawer-inner' }, [drawerHead, refs.drawerBody]);
    refs.drawer = h('section', {
      class: 'solar-drawer',
      id: 'sol-drawer',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'sol-drawer-title',
      'data-ui': '',
      hidden: true
    }, [drawerInner]);
    refs.scrim = h('div', { class: 'solar-scrim', id: 'sol-scrim', 'data-ui': '', hidden: true });

    document.body.appendChild(refs.scrim);
    document.body.appendChild(refs.drawer);

    /* ============================================================
     * 时间显示
     * ============================================================ */
    function paintClock(ms) {
      var n = Number(ms);
      if (!isFinite(n)) return;
      var d = DATE;
      d.setTime(n);
      if (isNaN(d.getTime())) return;

      var clock = pad4(d.getUTCFullYear()) + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
        ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
      setText(refs.clock, clock);

      var localText = T('本地', 'Local') + ' ' + pad4(d.getFullYear()) + '-' + pad2(d.getMonth() + 1) + '-' +
        pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      setText(refs.local, localText);

      var minuteKey = clock.slice(0, 16);
      if (minuteKey !== locals.clockMinute) {
        locals.clockMinute = minuteKey;
        if (document.activeElement !== refs.dateInput && document.activeElement !== refs.timeInput) {
          syncClockInputs(n);
        }
      }
    }

    function syncClockInputs(ms) {
      var n = Number(ms);
      if (!isFinite(n)) n = Date.now();
      var d = DATE;
      d.setTime(n);
      if (isNaN(d.getTime())) return;
      refs.dateInput.value = pad4(d.getUTCFullYear()) + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
      refs.timeInput.value = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
    }

    function jumpTo(ms) {
      var n = Number(ms);
      if (!isFinite(n)) return;
      COSMOS.emit('solar:cmd', { type: 'goto', timeMs: n });
      locals.clockMs = n;
      locals.clockMinute = '';
      paintClock(n);
      syncClockInputs(n);
    }

    function readDateInputs() {
      var ds = refs.dateInput.value || '';
      var ts = refs.timeInput.value || '';
      var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ds);
      var tm = /^(\d{1,2}):(\d{2})$/.exec(ts);
      var y, m, day, hh, min;
      if (!dm) {
        flash(T('日期格式无效，请用 YYYY-MM-DD', 'Invalid date — use YYYY-MM-DD'));
        syncClockInputs(locals.clockMs);
        return null;
      }
      y = parseInt(dm[1], 10);
      m = parseInt(dm[2], 10);
      day = parseInt(dm[3], 10);
      if (tm) {
        hh = parseInt(tm[1], 10);
        min = parseInt(tm[2], 10);
      } else {
        hh = 0;
        min = 0;
      }
      if (y < 1800 || y > 2100 || m < 1 || m > 12 || day < 1 || day > 31 || hh > 23 || min > 59) {
        flash(T('超出范围：1800-01-01 至 2100-12-31（UTC）', 'Out of range: 1800-01-01 to 2100-12-31 (UTC)'));
        syncClockInputs(locals.clockMs);
        return null;
      }
      var ms = Date.UTC(y, m - 1, day, hh, min);
      var check = DATE;
      check.setTime(ms);
      if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) {
        flash(T('该日期不存在，请检查', 'That date does not exist'));
        syncClockInputs(locals.clockMs);
        return null;
      }
      return ms;
    }

    gotoBtn.addEventListener('click', function () {
      var ms = readDateInputs();
      if (ms == null) return;
      jumpTo(ms);
      flash(T('已跳转：', 'Jumped to ') + refs.clock.textContent);
    });
    nowBtn.addEventListener('click', function () {
      jumpTo(Date.now());
      flash(T('已回到当前时刻', 'Back to now'));
    });
    refs.dateInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); gotoBtn.click(); }
    });
    refs.timeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); gotoBtn.click(); }
    });

    /* ============================================================
     * 播放 / 速度 / 视图 / 开关
     * ============================================================ */
    function syncPlay() {
      var paused = !!st.paused;
      var rate = Number(st.daysPerSec) || 0;
      setPressed(refs.playBtn, !paused && rate > 0);
      setPressed(refs.revBtn, !paused && rate < 0);
      setPressed(refs.pauseBtn, paused);
    }

    function syncRate() {
      var rate = Number(st.daysPerSec) || 0;
      setText(refs.rateNow, rateLabel(rate));
      for (var i = 0; i < refs.rateBtns.length; i++) {
        var b = refs.rateBtns[i];
        setPressed(b, Math.abs(rate - b.__rate) <= Math.abs(b.__rate) * 1e-6 + 1e-12);
      }
      syncPlay();
    }

    function setRate(rate) {
      var r = Number(rate);
      if (!isFinite(r) || r === 0) return;
      st.daysPerSec = r;
      syncRate();
    }

    function stepRate(dir) {
      var rate = Number(st.daysPerSec) || 1;
      var a = Math.abs(rate);
      var idx = -1;
      for (var i = 0; i < PRESETS.length; i++) {
        if (Math.abs(a - PRESETS[i].rate) <= PRESETS[i].rate * 1e-6 + 1e-12) { idx = i; break; }
      }
      var next;
      if (idx >= 0) {
        next = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, idx + dir))].rate;
      } else if (dir > 0) {
        next = PRESETS[PRESETS.length - 1].rate;
        for (var j = 0; j < PRESETS.length; j++) {
          if (PRESETS[j].rate > a) { next = PRESETS[j].rate; break; }
        }
      } else {
        next = PRESETS[0].rate;
        for (var k = PRESETS.length - 1; k >= 0; k--) {
          if (PRESETS[k].rate < a) { next = PRESETS[k].rate; break; }
        }
      }
      st.daysPerSec = rate < 0 ? -next : next;
      syncRate();
      flash(T('速度：', 'Speed: ') + rateLabel(st.daysPerSec));
    }

    refs.revBtn.addEventListener('click', function () {
      st.paused = false;
      st.daysPerSec = -Math.abs(Number(st.daysPerSec) || 1);
      syncPlay();
      syncRate();
    });
    refs.playBtn.addEventListener('click', function () {
      st.paused = false;
      st.daysPerSec = Math.abs(Number(st.daysPerSec) || 1);
      syncPlay();
      syncRate();
    });
    refs.pauseBtn.addEventListener('click', function () {
      st.paused = true;
      syncPlay();
    });

    function syncView() {
      var view = st.view || 'whole';
      for (var key in refs.viewBtns) {
        setPressed(refs.viewBtns[key], key === view);
      }
      syncFollow();
    }

    function setView(view) {
      if (view === 'planet' && !currentFocus()) {
        flash(T('先在下方选一个天体，再点「跟随天体」', 'Pick a body below first, then choose Follow body'));
        return;
      }
      st.view = view;
      COSMOS.emit('solar:cmd', { type: 'view', view: view });
      syncView();
      syncSelection();
    }

    function syncToggles() {
      setPressed(refs.labelsBtn, st.labels !== false);
      setPressed(refs.orbitsBtn, st.orbits !== false);
      setPressed(refs.enlargeBtn, !!st.enlarge);
      refs.enlargeNote.hidden = !st.enlarge;
    }

    refs.labelsBtn.addEventListener('click', function () {
      st.labels = !(st.labels !== false);
      syncToggles();
    });
    refs.orbitsBtn.addEventListener('click', function () {
      st.orbits = !(st.orbits !== false);
      syncToggles();
    });
    refs.enlargeBtn.addEventListener('click', function () {
      st.enlarge = !st.enlarge;
      COSMOS.emit('solar:cmd', { type: 'enlarge', on: !!st.enlarge });
      syncToggles();
      flash(st.enlarge ? T('行星尺寸已放大，不按比例', 'Planet sizes enlarged, not to scale') : T('行星尺寸恢复按比例', 'Planet sizes back to scale'));
    });
    resetBtn.addEventListener('click', function () {
      COSMOS.emit('solar:cmd', { type: 'reset' });
      reset();
      flash(T('已复位', 'Reset'));
    });
    compareBtn.addEventListener('click', function () {
      closeDrawer(false);
      if (COSMOS.app && typeof COSMOS.app.goTo === 'function') {
        COSMOS.app.goTo('compare');
        return;
      }
      var ch = document.getElementById('ch-compare');
      if (ch && ch.scrollIntoView) ch.scrollIntoView({ behavior: 'smooth' });
    });

    /* ============================================================
     * 天体选择 / 高亮
     * ============================================================ */
    function emitHover(id) {
      if (locals.hoverEmit === id) return;
      locals.hoverEmit = id;
      COSMOS.emit('solar:hover', { id: id });
    }

    function syncHighlight() {
      var focus = currentFocus();
      var parentOfFocus = focus && INFO[focus] ? INFO[focus].parent : null;
      var id;
      for (id in bodyChips) {
        var active = id === focus;
        var hot = !active && id === locals.hoverId;
        var isParent = !active && id === parentOfFocus;
        var chip = bodyChips[id];
        chip.classList.toggle('is-active', active);
        chip.classList.toggle('is-hot', hot);
        chip.classList.toggle('is-parent', isParent);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      for (id in moonChips) {
        var mActive = id === focus;
        var mHot = !mActive && id === locals.hoverId;
        var mChip = moonChips[id];
        mChip.classList.toggle('is-active', mActive);
        mChip.classList.toggle('is-hot', mHot);
        mChip.setAttribute('aria-pressed', mActive ? 'true' : 'false');
      }
    }

    function updateMoons() {
      var focus = currentFocus();
      var parent = null;
      if (focus && INFO[focus]) {
        if (INFO[focus].kind === 'moon') parent = INFO[focus].parent;
        else if (INFO[focus].kind !== 'sun') parent = focus;
      }
      var list = moonsOf(parent);
      if (!parent || !list.length) {
        refs.moonsBlock.hidden = true;
        locals.moonParent = null;
        return;
      }
      refs.moonsBlock.hidden = false;
      var parentInfo = INFO[parent];
      setText(refs.moonsLabel, T('卫星 · ', 'MOONS · ') + (parentInfo ? parentInfo.name : parent));
      if (locals.moonParent !== parent) {
        locals.moonParent = parent;
        clear(refs.moonList);
        moonChips = Object.create(null);
        for (var i = 0; i < list.length; i++) {
          refs.moonList.appendChild(makeMoonChip(list[i]));
        }
      }
    }

    function syncSelection() {
      syncHighlight();
      updateMoons();
      syncHighlight();
      refreshReadout();
      syncFollow();
      updateMore();
    }

    function syncFollow() {
      if (!refs.followBtn) return;
      var on = !!locals.drawerId && st.view === 'planet' && currentFocus() === locals.drawerId;
      setPressed(refs.followBtn, on);
    }

    function pickBody(id) {
      if (!INFO[id]) return;
      st.focus = id;
      st.selected = id;
      COSMOS.emit('solar:cmd', { type: 'focus', id: id });
      COSMOS.emit('solar:cmd', { type: 'select', id: id });
      refreshReadout();
      syncSelection();
      openDrawer(id);
    }

    /* ============================================================
     * 实时读数（solar:tick → 只保存数字，不持有 payload 引用）
     * ============================================================ */
    function findBody(bodies, id) {
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (b && b.id === id) return b;
      }
      return null;
    }

    function fillReadout(bodies, id) {
      var r = locals.readout;
      r.id = id || null;
      r.ok = false;
      r.approx = false;
      r.helio = NaN;
      r.geo = NaN;
      r.light = NaN;
      if (!id || !bodies || !bodies.length) return;
      var b = findBody(bodies, id);
      if (!b) {
        var info = INFO[id];
        if (info && info.parent) {
          b = findBody(bodies, info.parent);
          if (b) r.approx = true;
        }
      }
      if (!b) return;
      r.helio = Number(b.helioAU);
      r.geo = Number(b.geoAU);
      r.light = Number(b.lightMin);
      r.ok = isFinite(r.helio) || isFinite(r.geo);
    }

    function refreshReadout() {
      var r = locals.readout;
      r.id = null;
      r.ok = false;
      r.approx = false;
      r.helio = NaN;
      r.geo = NaN;
      r.light = NaN;
      paintLive();
    }

    function paintLive() {
      var id = currentFocus();
      paintLiveBlock(refs.consoleLive, id);
      paintLiveBlock(refs.drawerLive, id);
    }

    function paintLiveBlock(block, id) {
      if (!block) return;
      if (!id) {
        block.el.hidden = true;
        return;
      }
      block.el.hidden = false;
      var info = INFO[id];
      var name = info ? info.name : id;
      if (st.view === 'planet' && st.focus === id) name += T(' · 跟随中', ' · following');
      setText(block.name, name);
      var r = locals.readout;
      var ok = r.id === id && r.ok;
      block.cells[0].textContent = ok && isFinite(r.helio) ? uNum(r.helio, 3) : MISSING;
      block.cells[1].textContent = ok && isFinite(r.geo) ? uNum(r.geo, 3) : MISSING;
      block.cells[2].textContent = ok && isFinite(r.light) ? uNum(r.light, 2) : MISSING;
      var note = '';
      if (ok && r.approx) note = T('该卫星的实时距离按母行星计算', 'Moon distances are those of the parent planet');
      else if (!ok) note = T('正在读取星历…', 'Reading ephemeris…');
      setText(block.note, note);
      block.note.hidden = !note;
    }

    /* ============================================================
     * 档案抽屉
     * ============================================================ */
    function typeLine(info) {
      var d = info.data;
      if (info.kind === 'sun') return T('恒星', 'Star');
      if (info.kind === 'moon') {
        var p = info.parent && INFO[info.parent] ? INFO[info.parent] : null;
        return T('卫星', 'Moon') + (p ? T(' · 环绕', ' · orbits') + ' ' + p.name : '');
      }
      return d.type || T('行星', 'Planet');
    }

    function fillStats(info) {
      var d = info.data;
      for (var i = 0; i < refs.statSlots.length; i++) {
        var slot = refs.statSlots[i];
        var row = slot.row;
        var val = row.get(d);
        var missing = val === null || val === undefined || val === '' ||
          (typeof val === 'number' && !isFinite(val));
        slot.cell.hidden = missing;
        if (missing) continue;
        if (row.rich) slot.v.innerHTML = richText(String(val));
        else slot.v.textContent = (typeof val === 'number') ? fmtNum(val) : String(val);
        slot.u.textContent = row.unit || '';
        slot.u.hidden = !row.unit;
      }
    }

    function fillAtmo(info) {
      var d = info.data;
      var list = d.atmosphere || (info.kind === 'sun' ? d.composition : null) || [];
      if (!list.length) {
        refs.atmoBlock.hidden = true;
        return;
      }
      refs.atmoBlock.hidden = false;
      refs.atmoTitle.textContent = info.kind === 'sun' ? T('主要成分', 'COMPOSITION') : T('大气成分', 'ATMOSPHERE');
      clear(refs.atmoBar);
      clear(refs.atmoLegend);
      for (var i = 0; i < list.length; i++) {
        var item = list[i] || {};
        var pct = Number(item.pct);
        if (!isFinite(pct) || pct <= 0) continue;
        var color = ATM_COLORS[i % ATM_COLORS.length];
        refs.atmoBar.appendChild(h('span', {
          class: 'solar-atmo-seg',
          style: { width: Math.max(pct, 0.6) + '%', background: color }
        }));
        refs.atmoLegend.appendChild(h('li', { class: 'solar-atmo-item' }, [
          h('i', { class: 'solar-atmo-swatch', 'aria-hidden': 'true', style: { background: color } }),
          h('span', { class: 'solar-atmo-name', text: T(item.name, item.name) }),
          h('span', { class: 'solar-atmo-pct u-mono', text: (pct >= 1 ? uNum(pct, 1) : uNum(pct, 2)) + '%' })
        ]));
      }
      var noteText = d.atmosphereNote || '';
      refs.atmoNote.textContent = noteText;
      refs.atmoNote.hidden = !noteText;
    }

    function makeMoonItemHandler(moonId) {
      return function () { pickBody(moonId); };
    }

    function fillDrawer(id) {
      var info = INFO[id];
      if (!info) return;
      var d = info.data;
      setText(refs.drawerTitleName, info.name);
      var sub = typeLine(info);
      setText(refs.drawerEn, EN ? sub : ((d.en ? d.en + ' · ' : '') + sub));
      refs.drawerKicker.textContent = T('02 · 太阳系 / 天体档案', '02 · Solar System / Body profile');

      var src = (COSMOS.TEX || {})[d.texture];
      if (src) {
        refs.thumb.style.backgroundImage = 'url("' + src + '")';
        refs.thumb.style.backgroundColor = 'transparent';
      } else {
        refs.thumb.style.backgroundImage = 'none';
        refs.thumb.style.backgroundColor = d.color || 'var(--carbon-80)';
      }
      refs.thumb.hidden = false;

      setText(refs.tagline, d.tagline || '');
      refs.tagline.hidden = !d.tagline;
      fillStats(info);
      fillAtmo(info);

      setText(refs.brief, d.desc || '');
      refs.brief.hidden = !d.desc;
      setText(refs.special, d.special || '');
      refs.special.hidden = !d.special;

      /* 卫星（行星/矮行星 → 子卫星；卫星 → 所属行星） */
      var list = [];
      var headingZh = '卫星';
      var headingEn = 'MOONS';
      if (info.kind === 'moon') {
        if (info.parent && INFO[info.parent]) list = [INFO[info.parent].data];
        headingZh = '所属';
        headingEn = 'PARENT';
      } else {
        list = moonsOf(id);
      }
      var block = drawerMoonsBlock;
      block.hidden = !list.length;
      if (list.length) {
        refs.moonsHeading.textContent = T(headingZh, headingEn);
        clear(drawerMoonList);
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          var itemInfo = INFO[item.id];
          if (!itemInfo) continue;
          var meta = '';
          if (item.distanceKm != null) meta += uNum(item.distanceKm, 0) + ' km';
          else if (item.au != null) meta += uNum(item.au, 2) + ' AU';
          var period = item.periodDays != null ? item.periodDays : item.yearDays;
          if (period != null) meta += (meta ? ' · ' : '') + fmtNum(period) + ' d';
          var btn = h('button', { class: 'solar-moon-item', type: 'button' }, [
            h('span', { class: 'solar-moon-item-name', text: itemInfo.name }),
            h('span', { class: 'solar-moon-item-meta u-mono', text: meta })
          ]);
          btn.addEventListener('click', makeMoonItemHandler(item.id));
          drawerMoonList.appendChild(btn);
        }
      }

      syncFollow();
      paintLive();
    }

    function drawerFocusables() {
      var nodes = refs.drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      var out = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.disabled) continue;
        if (n.offsetParent === null && n !== document.activeElement) continue;
        out.push(n);
      }
      return out;
    }

    function openDrawer(id) {
      if (!INFO[id]) return;
      if (locals.open && locals.drawerId === id) return;
      locals.drawerId = id;
      fillDrawer(id);
      locals.open = true;
      locals.lastFocus = document.activeElement;
      refs.scrim.hidden = false;
      refs.drawer.hidden = false;
      refs.drawer.setAttribute('aria-hidden', 'false');
      /* 强制一次布局，保证 is-open 的过渡生效 */
      refs.drawer.offsetWidth; /* 强制布局，保证 is-open 过渡生效 */
      refs.drawer.classList.add('is-open');
      syncFollow();
      try { refs.drawerClose.focus({ preventScroll: true }); }
      catch (e) { refs.drawerClose.focus(); }
    }

    function closeDrawer(returnFocus) {
      if (!locals.open) return;
      locals.open = false;
      locals.drawerId = null;
      refs.drawer.classList.remove('is-open');
      refs.scrim.hidden = true;
      if (locals.closeTimer) clearTimeout(locals.closeTimer);
      locals.closeTimer = setTimeout(function () {
        locals.closeTimer = 0;
        if (!locals.open) {
          refs.drawer.hidden = true;
          refs.drawer.setAttribute('aria-hidden', 'true');
        }
      }, 520);
      syncFollow();
      if (returnFocus !== false) {
        var back = locals.lastFocus;
        if (back && back.focus && document.contains(back) &&
            (!document.activeElement || refs.drawer.contains(document.activeElement))) {
          try { back.focus({ preventScroll: true }); } catch (e2) { back.focus(); }
        }
      }
      locals.lastFocus = null;
    }

    refs.drawerClose.addEventListener('click', function () { closeDrawer(true); });
    refs.scrim.addEventListener('click', function () { closeDrawer(true); });
    refs.drawer.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var list = drawerFocusables();
      if (!list.length) return;
      var first = list[0];
      var last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    refs.followBtn.addEventListener('click', function () {
      var id = locals.drawerId;
      if (!id) return;
      st.focus = id;
      st.selected = id;
      st.view = 'planet';
      COSMOS.emit('solar:cmd', { type: 'focus', id: id });
      COSMOS.emit('solar:cmd', { type: 'view', view: 'planet' });
      syncView();
      syncSelection();
      flash(T('镜头跟随：', 'Following: ') + INFO[id].name);
    });

    /* ============================================================
     * 动作区
     * ============================================================ */
    function flash(text) {
      if (!refs.status) return;
      refs.status.textContent = text;
      refs.status.classList.add('is-on');
      if (locals.statusTimer) clearTimeout(locals.statusTimer);
      locals.statusTimer = setTimeout(function () {
        locals.statusTimer = 0;
        refs.status.textContent = '';
        refs.status.classList.remove('is-on');
      }, 2800);
    }

    function openLab(kind) {
      var lab = COSMOS.solarLab;
      var fn = lab && (kind === 'events' ? lab.openEvents : lab.openSky);
      if (typeof fn !== 'function') {
        flash(kind === 'events'
          ? T('事件面板尚未就绪', 'Events panel is not ready yet')
          : T('天空面板尚未就绪', 'Sky panel is not ready yet'));
        return;
      }
      try { fn.call(lab); }
      catch (e) { flash(T('面板打开失败', 'Could not open the panel')); }
    }

    eventsBtn.addEventListener('click', function () { openLab('events'); });
    skyBtn.addEventListener('click', function () { openLab('sky'); });
    shareBtn.addEventListener('click', function () {
      var app = COSMOS.app;
      if (!app || typeof app.shareSolar !== 'function') {
        flash(T('分享不可用，请手动复制地址栏链接', 'Sharing unavailable — copy the URL manually'));
        return;
      }
      var res;
      try { res = app.shareSolar(); }
      catch (e) { flash(T('复制失败，请手动复制地址栏链接', 'Copy failed — copy the URL manually')); return; }
      if (res && typeof res.then === 'function') {
        res.then(function (ok) {
          flash(ok ? T('链接已复制', 'Link copied') : T('复制失败，请手动复制地址栏链接', 'Copy failed — copy the URL manually'));
        }, function () {
          flash(T('复制失败，请手动复制地址栏链接', 'Copy failed — copy the URL manually'));
        });
      } else {
        flash(T('链接已复制', 'Link copied'));
      }
    });

    /* ============================================================
     * 事件总线
     * ============================================================ */
    function onTick(payload) {
      if (!payload || !payload.bodies) return;
      locals.lastTickAt = Date.now();
      var ms = Number(payload.timeMs);
      if (isFinite(ms)) locals.clockMs = ms;
      fillReadout(payload.bodies, currentFocus());
      paintClock(locals.clockMs);
      paintLive();
      updateMore();
    }

    function onFocus(payload) {
      var id = payload && payload.id ? payload.id : null;
      if (!id || !INFO[id]) {
        if (!id) closeDrawer(true);
        return;
      }
      st.focus = id;
      st.selected = id;
      refreshReadout();
      syncSelection();
      openDrawer(id);
    }

    function onHover(payload) {
      var id = payload && payload.id ? payload.id : null;
      if (!id || !INFO[id]) id = null;
      if (locals.hoverId === id) return;
      locals.hoverId = id;
      syncHighlight();
    }

    var offTick = COSMOS.on('solar:tick', onTick);
    var offFocus = COSMOS.on('solar:focus', onFocus);
    var offHover = COSMOS.on('solar:hover', onHover);
    var offReady = COSMOS.on('solar:ready', function () { syncAll(); });
    var offEscape = COSMOS.on('cosmos:escape', function () {
      if (locals.open) closeDrawer(true);
    });

    /* ============================================================
     * 同步 / 每帧
     * ============================================================ */
    function syncAll() {
      locals.clockMs = isFinite(Number(st.timeMs)) ? Number(st.timeMs) : locals.clockMs;
      locals.clockMinute = '';
      paintClock(locals.clockMs);
      syncClockInputs(locals.clockMs);
      syncPlay();
      syncRate();
      syncView();
      syncToggles();
      syncSelection();
      syncClockInputs(locals.clockMs);
    }

    /* 场景 tick 缺失时的兜底（旧场景/加载中）：4Hz 从 state 刷新时钟 */
    function frameLoop(ts) {
      locals.rafId = 0;
      if (!locals.visible) return;
      locals.rafId = requestAnimationFrame(frameLoop);
      if (ts - locals.lastPaintAt < 250) return;
      locals.lastPaintAt = ts;
      if (ts - locals.lastTickAt < 600) return;
      var ms = Number(st.timeMs);
      if (!isFinite(ms)) return;
      locals.clockMs = ms;
      paintClock(ms);
      paintLive();
    }

    function startLoop() {
      if (locals.rafId) return;
      locals.lastPaintAt = 0;
      locals.rafId = requestAnimationFrame(frameLoop);
    }

    function stopLoop() {
      if (locals.rafId) cancelAnimationFrame(locals.rafId);
      locals.rafId = 0;
    }

    function update(p, o) {
      var vis = (o === undefined || o === null) ? true : o > 0.02;
      if (vis === locals.visible) return;
      locals.visible = vis;
      if (vis) {
        syncAll();
        startLoop();
      } else {
        stopLoop();
        closeDrawer(false);
      }
    }

    function reset() {
      /* 状态复位（scene 也会在 Esc 链上复位 timeMs/相机；这里只同步 UI 语义） */
      st.daysPerSec = 1;
      st.paused = false;
      st.view = 'whole';
      st.focus = null;
      st.selected = null;
      st.labels = true;
      st.orbits = true;
      st.enlarge = false;
      locals.hoverId = null;
      locals.hoverEmit = null;
      locals.readout.id = null;
      locals.readout.ok = false;
      locals.readout.approx = false;
      locals.readout.helio = NaN;
      locals.readout.geo = NaN;
      locals.readout.light = NaN;
      locals.clockMs = Date.now();
      locals.clockMinute = '';
      closeDrawer(false);
      paintClock(locals.clockMs);
      syncClockInputs(locals.clockMs);
      syncPlay();
      syncRate();
      syncView();
      syncToggles();
      syncSelection();
    }

    /* 初始同步（场景可能已发过 ready/tick；没有也不报错） */
    syncAll();

    return { update: update, reset: reset };
  });
})(window.COSMOS = window.COSMOS || {});
