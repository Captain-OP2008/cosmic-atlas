/* ============================================================
 * COSMOS ATLAS · js/feat-events.js
 * 02 太阳系 · 天象事件模态（#sol-events）
 *
 * 契约（artifacts/p1-contract.md §6）：
 *   - role="dialog" aria-modal="true"，遮罩 / × / Esc 关闭，焦点陷阱
 *   - 日期升序；默认 12 条 + “更多”；顶部筛选：全部 / 日月食 / 行星 / 季节
 *   - 数据来自 COSMOS.ephem.nextEvents(COSMOS.state.solar.timeMs, 80)
 *   - 「跳转」→ 写 state.timeMs + paused=true，发 solar:cmd goto/focus，关闭模态
 *   - 暴露 COSMOS.solarLab.openEvents（close 由两个模态共用注册）
 *
 * 依赖：COSMOS.ephem（并行实现；缺失时只显示“星历未载入”，不抛异常、不改 ephem.js）
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var T = (COSMOS.i18n && COSMOS.i18n.T) || function (zh) { return zh; };
  var EN = !!(COSMOS.i18n && COSMOS.i18n.en);
  var h = COSMOS.dom.h;
  var clearEl = COSMOS.dom.clear;
  var num = COSMOS.util.num;

  var DATA = COSMOS.DATA || {};
  var JD_UNIX_EPOCH = 2440587.5;
  var DAY_MS = 86400000;
  var YEAR_MIN = 1800;
  var YEAR_MAX = 2100;
  var PAGE = 12;
  var FETCH_COUNT = 80;

  var planets = (DATA.planets || []).concat(DATA.dwarfPlanets || []);

  /* ---------------- 小工具 ---------------- */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function fmtUtc(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '—';
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
      ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
  }

  function msFromJd(jd) {
    var ep = COSMOS.ephem;
    if (ep && typeof ep.msFromJd === 'function') {
      var v = ep.msFromJd(jd);
      if (isFinite(v)) return v;
    }
    return (jd - JD_UNIX_EPOCH) * DAY_MS;
  }

  function planetById(id) {
    for (var i = 0; i < planets.length; i++) {
      if (planets[i].id === id) return planets[i];
    }
    return null;
  }

  function solarState() {
    var S = COSMOS.state || (COSMOS.state = {});
    var st = S.solar || (S.solar = {});
    if (typeof st.timeMs !== 'number' || !isFinite(st.timeMs)) st.timeMs = Date.now();
    return st;
  }

  /* ---------------- 类型 / 文案 ---------------- */
  var TYPE_TAGS = {
    'equinox': { zh: '二分', en: 'EQUINOX' },
    'solstice': { zh: '二至', en: 'SOLSTICE' },
    'opposition': { zh: '冲日', en: 'OPPOSITION' },
    'elongation': { zh: '大距', en: 'ELONGATION' },
    'solar-eclipse': { zh: '日食', en: 'SOLAR ECLIPSE' },
    'lunar-eclipse': { zh: '月食', en: 'LUNAR ECLIPSE' }
  };

  var ECLIPSE_KIND = {
    'total': { zh: '全', en: 'Total' },
    'annular': { zh: '环', en: 'Annular' },
    'partial': { zh: '偏', en: 'Partial' },
    'penumbral': { zh: '半影', en: 'Penumbral' }
  };

  function seasonInfo(type, month, kind, lonDeg) {
    if (type === 'equinox') {
      var autumn = kind === 'september' || (kind !== 'march' && (lonDeg >= 90 && lonDeg < 270 || (lonDeg == null && month >= 7)));
      if (autumn) {
        return {
          zh: '秋分', en: 'September equinox',
          descZh: '太阳由北向南穿过天赤道，全球昼夜接近等长。',
          descEn: 'The Sun crosses the celestial equator heading south; day and night are nearly equal worldwide.'
        };
      }
      return {
        zh: '春分', en: 'March equinox',
        descZh: '太阳由南向北穿过天赤道，全球昼夜接近等长。',
        descEn: 'The Sun crosses the celestial equator heading north; day and night are nearly equal worldwide.'
      };
    }
    var winter = kind === 'december' || (kind !== 'june' && (lonDeg >= 180 || (lonDeg == null && month >= 10)));
    if (winter) {
      return {
        zh: '冬至', en: 'December solstice',
        descZh: '太阳黄经 270°，北半球白昼最短、南半球最长。',
        descEn: 'Solar ecliptic longitude 270°: the shortest day in the north, the longest in the south.'
      };
    }
    return {
      zh: '夏至', en: 'June solstice',
      descZh: '太阳黄经 90°，北半球白昼最长、南半球最短。',
      descEn: 'Solar ecliptic longitude 90°: the longest day in the north, the shortest in the south.'
    };
  }

  function eclipseInfo(type, kind) {
    var solar = type === 'solar-eclipse';
    var k = ECLIPSE_KIND[kind] || { zh: '', en: '' };
    var nameZh, nameEn, descZh, descEn;
    if (solar) {
      nameZh = '日' + k.zh + '食';
      nameEn = (k.en ? k.en + ' ' : '') + 'solar eclipse';
      if (kind === 'total') {
        descZh = '月球完全遮住日面，全食带内可见日冕，持续数分钟。';
        descEn = 'The Moon covers the Sun completely; the corona appears inside the path of totality for a few minutes.';
      } else if (kind === 'annular') {
        descZh = '月球离地球较远，视直径略小于太阳，日面边缘留下一圈亮环。';
        descEn = 'The Moon is too far to cover the Sun; a thin ring of sunlight remains around the lunar silhouette.';
      } else {
        descZh = '月球只遮住日面的一部分，偏食带内可见缺口。';
        descEn = 'The Moon covers only part of the solar disk; a bite-shaped crescent is visible along the partial path.';
      }
    } else {
      if (kind === 'penumbral') {
        nameZh = '半影月食';
        nameEn = 'Penumbral lunar eclipse';
        descZh = '月球只经过地球半影，亮度轻微下降，肉眼不易察觉。';
        descEn = 'The Moon passes only through Earth’s penumbra; its brightness drops slightly, hard to notice by eye.';
      } else {
        nameZh = '月' + k.zh + '食';
        nameEn = (k.en ? k.en + ' ' : '') + 'lunar eclipse';
        if (kind === 'total') {
          descZh = '月球完全进入地球本影，呈暗红色，持续可达一小时以上。';
          descEn = 'The Moon enters Earth’s umbra completely and turns dark red for up to an hour or more.';
        } else {
          descZh = '月球一部分进入地球本影，可见地影的弧形边缘扫过月面。';
          descEn = 'Part of the Moon enters Earth’s umbra; the curved edge of the shadow sweeps across the lunar disk.';
        }
      }
    }
    return { zh: nameZh, en: nameEn, descZh: descZh, descEn: descEn };
  }

  function numericText(ev) {
    var d = ev.data || {};
    var parts = [];
    /* 冲日的距角恒为 180°（定义使然），条目里不必重复展示 */
    if (ev.type !== 'opposition' && typeof d.elongationDeg === 'number' && isFinite(d.elongationDeg)) {
      parts.push(T('距角', 'Elongation') + ' ' + num(d.elongationDeg, 1) + '°');
    }
    if (typeof d.magnitude === 'number' && isFinite(d.magnitude)) {
      parts.push(T('食分', 'Magnitude') + ' ' + num(d.magnitude, 2));
    }
    if (typeof d.penumbralMagnitude === 'number' && isFinite(d.penumbralMagnitude)) {
      parts.push(T('半影食分', 'Penumbral mag.') + ' ' + num(d.penumbralMagnitude, 2));
    }
    var dist = typeof d.geoDistanceAU === 'number' && isFinite(d.geoDistanceAU) ? d.geoDistanceAU :
      (typeof d.distanceAU === 'number' && isFinite(d.distanceAU) ? d.distanceAU : NaN);
    if (isFinite(dist)) {
      parts.push(T('地心距', 'Distance') + ' ' + num(dist, 3) + ' AU');
    }
    return parts.join(' · ');
  }

  /* 把一条 ephem 事件翻译成展示字段 */
  function describe(ev) {
    var tag = TYPE_TAGS[ev.type] || { zh: '天象', en: 'EVENT' };
    var out = {
      tagZh: tag.zh, tagEn: tag.en,
      nameZh: T('天象', 'Sky event'), nameEn: 'Sky event',
      descZh: '', descEn: '', enShort: '', nums: ''
    };
    var month = new Date(msFromJd(ev.jd)).getUTCMonth() + 1;
    var d = ev.data || {};

    if (ev.type === 'equinox' || ev.type === 'solstice') {
      var s = seasonInfo(ev.type, month, ev.kind, typeof d.lonDeg === 'number' ? d.lonDeg : null);
      out.nameZh = s.zh;
      out.nameEn = s.en;
      out.enShort = s.en;
      out.descZh = s.descZh;
      out.descEn = s.descEn;
    } else if (ev.type === 'solar-eclipse' || ev.type === 'lunar-eclipse') {
      var e = eclipseInfo(ev.type, ev.kind);
      out.nameZh = e.zh;
      out.nameEn = e.en;
      out.enShort = e.en;
      out.descZh = e.descZh;
      out.descEn = e.descEn;
      out.nums = numericText(ev);
    } else if (ev.type === 'opposition') {
      var p = planetById(ev.body);
      var pn = p ? T(p.name, p.en) : T('行星', 'planet');
      out.nameZh = pn + '冲日';
      out.nameEn = (p ? p.en : 'Planet') + ' at opposition';
      out.enShort = p ? p.en : 'Planet';
      out.descZh = pn + '与太阳分处地球两侧，午夜前后上中天，整夜可见，且距离最近、最亮。';
      out.descEn = 'The planet sits opposite the Sun from Earth, rises at dusk, peaks at midnight and stays visible all night at its closest and brightest.';
      out.nums = numericText(ev);
    } else if (ev.type === 'elongation') {
      var p2 = planetById(ev.body);
      var pn2 = p2 ? T(p2.name, p2.en) : T('行星', 'planet');
      var kind = String(ev.kind || '');
      var east = kind.indexOf('east') >= 0 || d.east === true;
      var west = kind.indexOf('west') >= 0 || d.east === false;
      if (east) {
        out.nameZh = pn2 + '东大距';
        out.nameEn = (p2 ? p2.en : 'Planet') + ' at greatest eastern elongation';
      } else if (west) {
        out.nameZh = pn2 + '西大距';
        out.nameEn = (p2 ? p2.en : 'Planet') + ' at greatest western elongation';
      } else {
        out.nameZh = pn2 + '大距';
        out.nameEn = (p2 ? p2.en : 'Planet') + ' at greatest elongation';
      }
      out.enShort = p2 ? p2.en : 'Planet';
      out.descZh = pn2 + '离太阳的视角距达到最大，是观测这颗内行星的最佳窗口。';
      out.descEn = 'The planet reaches its greatest angular separation from the Sun, the best window to observe this inner planet.';
      out.nums = numericText(ev);
    }
    return out;
  }

  function focusIdFor(ev) {
    var id = ev.body;
    if (id === 'sun' || id === 'moon') return id;
    var list = DATA.planets || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return id;
    }
    if (ev.type === 'lunar-eclipse') return 'moon';
    return 'sun';
  }

  /* ---------------- 数据结构 ---------------- */
  var ui = null;
  var open = false;
  var prevFocus = null;
  var savedPaused = null;
  var hasSaved = false;
  var items = null;
  var itemsBase = NaN;
  var computing = false;
  var loadError = '';
  var filter = 'all';
  var shown = PAGE;

  var FILTERS = [
    { key: 'all', zh: '全部', en: 'All' },
    { key: 'eclipse', zh: '日月食', en: 'Eclipses' },
    { key: 'planet', zh: '行星', en: 'Planets' },
    { key: 'season', zh: '季节', en: 'Seasons' }
  ];

  function inFilter(entry) {
    var t = entry.ev.type;
    if (filter === 'all') return true;
    if (filter === 'eclipse') return t === 'solar-eclipse' || t === 'lunar-eclipse';
    if (filter === 'planet') return t === 'opposition' || t === 'elongation';
    if (filter === 'season') return t === 'equinox' || t === 'solstice';
    return true;
  }

  function normalizeEvents(raw) {
    var list = [];
    if (!raw || !raw.length) return list;
    for (var i = 0; i < raw.length; i++) {
      var ev = raw[i];
      if (!ev || typeof ev.jd !== 'number' || !isFinite(ev.jd)) continue;
      if (!TYPE_TAGS[ev.type]) continue;
      var ms = msFromJd(ev.jd);
      if (!isFinite(ms)) continue;
      var y = new Date(ms).getUTCFullYear();
      if (y < YEAR_MIN || y > YEAR_MAX) continue;
      list.push({ ev: ev, ms: ms });
    }
    list.sort(function (a, b) { return a.ms - b.ms; });
    return list;
  }

  /* ---------------- DOM ---------------- */
  function ensureUI() {
    if (ui) return ui;

    var titleId = 'sol-evt-title';

    var closeBtn = h('button', {
      class: 'sol-evt-close',
      type: 'button',
      'aria-label': T('关闭天象事件', 'Close sky events'),
      title: T('关闭（Esc）', 'Close (Esc)'),
      text: '×'
    });

    var filterBtns = {};
    var filters = h('div', {
      class: 'sol-evt-filters',
      role: 'group',
      'aria-label': T('按类型筛选天象', 'Filter events by type')
    });
    FILTERS.forEach(function (f) {
      var b = h('button', {
        class: 'sol-evt-filter',
        type: 'button',
        'data-filter': f.key,
        'aria-pressed': f.key === filter ? 'true' : 'false',
        text: T(f.zh, f.en)
      });
      b.addEventListener('click', function () { setFilter(f.key); });
      filterBtns[f.key] = b;
      filters.appendChild(b);
    });

    var status = h('p', { class: 'sol-evt-status', role: 'status', 'aria-live': 'polite' });
    var list = h('ol', { class: 'sol-evt-list' });
    var listwrap = h('div', { class: 'sol-evt-listwrap' }, [list]);

    var more = h('button', {
      class: 'sol-evt-more',
      type: 'button',
      text: T('更多', 'More')
    });
    more.addEventListener('click', function () {
      if (!items) return;
      shown += PAGE;
      render();
    });

    var foot = h('p', {
      class: 'sol-evt-range',
      text: T(
        '仅显示 1800–2100 年内的天象；星历为 JPL 近似解，日期供科普参考。',
        'Only events between 1800 and 2100 are shown; dates come from JPL approximate ephemerides for educational use.'
      )
    });

    var panel = h('section', { class: 'sol-evt-panel' }, [
      h('header', { class: 'sol-evt-head' }, [
        h('div', { class: 'sol-evt-heading' }, [
          h('p', { class: 'sol-evt-kicker', text: T('02 · 太阳系 / 星历', '02 · SOLAR SYSTEM / EPHEMERIS') }),
          h('h3', { class: 'sol-evt-title', id: titleId, text: T('未来天象事件', 'Upcoming Sky Events') })
        ]),
        closeBtn
      ]),
      h('div', { class: 'sol-evt-toolbar' }, [filters, status]),
      listwrap,
      more,
      foot
    ]);

    var root = h('div', {
      class: 'sol-evt-modal',
      id: 'sol-events',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'data-ui': true,
      hidden: true
    }, [
      h('div', { class: 'sol-evt-scrim', 'aria-hidden': 'true' }),
      panel
    ]);

    closeBtn.addEventListener('click', function () { closeEvents(true); });
    root.firstChild.addEventListener('click', function () { closeEvents(true); });
    root.addEventListener('click', function (e) {
      if (e.target === root) closeEvents(true);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeEvents(true);
        return;
      }
      if (e.key === 'Tab') trapTab(e);
      e.stopPropagation(); // 模态开启时屏蔽 boot.js 的全局切章快捷键
    });

    document.body.appendChild(root);

    ui = {
      root: root,
      panel: panel,
      list: list,
      status: status,
      more: more,
      closeBtn: closeBtn,
      filterBtns: filterBtns
    };
    return ui;
  }

  function focusables() {
    if (!ui) return [];
    var nodes = ui.root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].disabled && nodes[i].getClientRects().length) out.push(nodes[i]);
    }
    return out;
  }

  function trapTab(e) {
    var f = focusables();
    if (!f.length) return;
    var idx = f.indexOf(document.activeElement);
    if (e.shiftKey) {
      if (idx <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    } else if (idx === -1 || idx === f.length - 1) {
      e.preventDefault();
      f[0].focus();
    }
  }

  /* ---------------- 渲染 ---------------- */
  function syncFilter() {
    FILTERS.forEach(function (f) {
      var b = ui.filterBtns[f.key];
      if (!b) return;
      b.setAttribute('aria-pressed', filter === f.key ? 'true' : 'false');
    });
  }

  function buildItem(entry) {
    var ev = entry.ev;
    var info = describe(ev);
    var dateStr = fmtUtc(entry.ms);
    var jump = h('button', {
      class: 'sol-evt-jump',
      type: 'button',
      'aria-label': T('跳转到 ' + dateStr + ' 的' + info.nameZh, 'Jump to ' + info.nameEn + ' on ' + dateStr),
      text: T('跳转 →', 'Jump →')
    });
    jump.addEventListener('click', function () { jumpTo(entry); });

    var line = [
      h('span', { class: 'sol-evt-tag', text: T(info.tagZh, info.tagEn) }),
      h('span', { class: 'sol-evt-name', text: T(info.nameZh, info.nameEn) })
    ];
    /* 中文模式只补一个极短英文名括注；英文整句（nameEn）只在英文模式出现 */
    if (!EN && info.enShort) {
      line.push(h('span', { class: 'sol-evt-en', text: info.enShort }));
    }

    return h('li', { class: 'sol-evt-item', 'data-type': ev.type }, [
      h('div', { class: 'sol-evt-when' }, [
        h('time', {
          class: 'sol-evt-date',
          datetime: new Date(entry.ms).toISOString(),
          text: dateStr
        })
      ]),
      h('div', { class: 'sol-evt-main' }, [
        h('div', { class: 'sol-evt-line' }, line),
        h('p', { class: 'sol-evt-desc', text: T(info.descZh, info.descEn) }),
        info.nums ? h('p', { class: 'sol-evt-nums', text: info.nums }) : null
      ]),
      jump
    ]);
  }

  function render() {
    if (!ui) return;
    clearEl(ui.list);
    syncFilter();

    if (computing) {
      ui.status.textContent = T('正在计算未来 10 年的天象…', 'Computing events for the next decade…');
      ui.more.hidden = true;
      return;
    }
    if (loadError === 'missing') {
      ui.status.textContent = T('星历未载入：js/ephem.js 尚未加载，暂时无法计算天象。', 'Ephemeris not loaded: js/ephem.js is unavailable, so events cannot be computed.');
      ui.more.hidden = true;
      return;
    }
    if (loadError === 'failed') {
      ui.status.textContent = T('天象计算失败，请关闭后重试。', 'Event computation failed. Please close and try again.');
      ui.more.hidden = true;
      return;
    }
    if (!items) {
      ui.status.textContent = T('暂无天象数据。', 'No event data available.');
      ui.more.hidden = true;
      return;
    }

    var filtered = items.filter(inFilter);
    var rows = filtered.slice(0, shown);
    for (var i = 0; i < rows.length; i++) ui.list.appendChild(buildItem(rows[i]));

    if (!rows.length) {
      ui.status.textContent = T('没有符合该筛选条件的天象。', 'No events match this filter.');
    } else {
      ui.status.textContent = T(
        '共 ' + filtered.length + ' 条，显示 ' + rows.length + ' 条',
        filtered.length + ' events, showing ' + rows.length
      );
    }

    var rest = filtered.length - rows.length;
    ui.more.hidden = rest <= 0;
    ui.more.textContent = T('更多（还有 ' + rest + ' 条）', 'More (' + rest + ' remaining)');
  }

  function setFilter(key) {
    filter = key;
    shown = PAGE;
    render();
  }

  /* ---------------- 数据 ---------------- */
  function ensureData(force) {
    var base = solarState().timeMs;
    if (!force && items && isFinite(itemsBase) && Math.abs(base - itemsBase) < DAY_MS) return;
    itemsBase = base;
    items = null;
    computing = true;
    loadError = '';
    if (ui) render();

    var ep = COSMOS.ephem;
    if (!ep || typeof ep.nextEvents !== 'function') {
      computing = false;
      loadError = 'missing';
      if (ui && open) render();
      return;
    }

    setTimeout(function () {
      var raw = null;
      var failed = false;
      try {
        raw = ep.nextEvents(itemsBase, FETCH_COUNT);
      } catch (err) {
        failed = true;
      }
      if (failed || !raw || typeof raw.length !== 'number') {
        items = null;
        loadError = failed ? 'failed' : 'empty';
      } else {
        items = normalizeEvents(raw);
        loadError = '';
      }
      computing = false;
      if (ui && open) render();
    }, 16);
  }

  /* ---------------- 跳转 ---------------- */
  function jumpTo(entry) {
    var st = solarState();
    st.timeMs = entry.ms;
    st.paused = true;
    COSMOS.emit('solar:cmd', { type: 'goto', timeMs: entry.ms });
    COSMOS.emit('solar:cmd', { type: 'focus', id: focusIdFor(entry.ev) });
    closeEvents(false);
  }

  /* ---------------- 开关 ---------------- */
  function openEvents() {
    ensureUI();
    if (open) return;
    COSMOS.emit('solarlab:close'); // 同一时间只开一个模态
    prevFocus = document.activeElement;
    var st = solarState();
    savedPaused = st.paused;
    hasSaved = true;
    st.paused = true;

    filter = 'all';
    shown = PAGE;
    open = true;
    ui.root.hidden = false;
    ui.root.classList.add('is-open');
    ensureData(true);
    ui.closeBtn.focus();
  }

  function closeEvents(restorePaused) {
    if (!open) return;
    open = false;
    if (ui) {
      ui.root.hidden = true;
      ui.root.classList.remove('is-open');
    }
    if (restorePaused !== false && hasSaved) {
      var st = solarState();
      st.paused = savedPaused;
    }
    hasSaved = false;
    var f = prevFocus;
    prevFocus = null;
    if (f && typeof f.focus === 'function' && document.contains(f)) {
      try { f.focus(); } catch (err) { /* 触发按钮可能已被移除 */ }
    }
  }

  /* ---------------- 全局键盘兜底 ---------------- */
  window.addEventListener('keydown', function (e) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      else e.stopPropagation();
      closeEvents(true);
      return;
    }
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    else e.stopPropagation();
  });

  /* ---------------- 对外接口 ---------------- */
  var LAB = COSMOS.solarLab || (COSMOS.solarLab = {});
  LAB.openEvents = openEvents;
  if (typeof LAB.close !== 'function') {
    LAB.close = function () { COSMOS.emit('solarlab:close'); };
  }
  COSMOS.on('solarlab:close', function () {
    if (open) closeEvents(true);
  });
})(window.COSMOS = window.COSMOS || {});
