/* ============================================================
 * COSMOS ATLAS · feat-solar.js
 * 03 太阳系 · 控制台 + 科普抽屉（widget: solar）
 *
 * 契约：COSMOS.registerWidget('solar', function (el, d, section) → { update(p, o), reset() })
 * 状态：写 COSMOS.state.solar（scene-solarsystem.js 只读）
 * 事件：监听 solar:focus / solar:hover / cosmos:escape；
 *       发 solar:zoom / solar:reset / solar:hover（chip 悬停）
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var U = COSMOS.util;
  var h = COSMOS.dom.h;
  var num = U.num;
  var DATA = COSMOS.DATA;
  var TEX = COSMOS.TEX || {};

  var SPEED_MAX = 3650;
  var ATM_COLORS = ['#288BFF', '#1C67E3', '#0B3D91', '#B9B9BB', '#717173', '#444447'];

  var STAT_ROWS = [
    { key: 'diameterKm', label: '直径', unit: 'km', fmt: function (p) { return num(p.diameterKm); }, rich: false },
    { key: 'massKg', label: '质量', unit: 'kg', fmt: function (p) { return p.massKg; }, rich: true },
    { key: 'gravity', label: '表面重力', unit: 'm/s²', fmt: function (p) { return p.gravity; }, rich: false },
    { key: 'dayHours', label: '自转周期', unit: '小时', fmt: function (p) { return num(p.dayHours, 1); }, rich: false },
    { key: 'yearDays', label: '公转周期', unit: '天', fmt: function (p) { return num(p.yearDays); }, rich: false },
    { key: 'tempAvgC', label: '平均温度', unit: '°C', fmt: function (p) { return p.tempAvgC; }, rich: false },
    { key: 'moons', label: '卫星数', unit: '颗', fmt: function (p) { return p.moons; }, rich: false }
  ];

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function goToChapter(id) {
    if (COSMOS.app && typeof COSMOS.app.goTo === 'function') {
      COSMOS.app.goTo(id);
      return;
    }
    var el = document.getElementById('ch-' + id);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth' });
  }

  COSMOS.registerWidget('solar', function (el, content, section) {
    var S = COSMOS.state || (COSMOS.state = {});
    var st = S.solar || (S.solar = {});
    if (st.daysPerSec === undefined) st.daysPerSec = 5;
    if (st.paused === undefined) st.paused = false;
    if (st.labels === undefined) st.labels = true;
    if (st.orbits === undefined) st.orbits = true;
    if (st.selected === undefined) st.selected = null;

    var planets = DATA.planets;
    var locals = { hoverId: null, selectedId: st.selected, drawerId: null, lastFocus: null, open: false };

    /* ---------------- 控制台 ---------------- */
    var speedOut = h('output', {
      class: 'range-val u-mono',
      'for': 'sol-speed',
      text: num(st.daysPerSec) + ' 天/秒'
    });
    var speed = h('input', {
      class: 'range',
      id: 'sol-speed',
      type: 'range',
      min: '0',
      max: String(SPEED_MAX),
      step: '1',
      value: String(st.daysPerSec),
      'aria-label': '模拟速度：每秒推进多少天（0 到 3650）'
    });

    var playBtn = h('button', {
      class: 'btn is-small solar-play',
      type: 'button',
      'aria-label': st.paused ? '继续公转' : '暂停公转',
      text: st.paused ? '播放' : '暂停'
    });
    var labelBtn = h('button', {
      class: 'btn is-ghost is-small' + (st.labels !== false ? ' is-on' : ''),
      type: 'button',
      'aria-pressed': st.labels !== false ? 'true' : 'false',
      text: '标签'
    });
    var orbitBtn = h('button', {
      class: 'btn is-ghost is-small' + (st.orbits !== false ? ' is-on' : ''),
      type: 'button',
      'aria-pressed': st.orbits !== false ? 'true' : 'false',
      text: '轨道'
    });
    var resetBtn = h('button', {
      class: 'btn is-ghost is-small',
      type: 'button',
      'aria-label': '复位视角（Esc）',
      text: '复位'
    });
    var zoomOutBtn = h('button', {
      class: 'btn is-ghost is-small solar-zoom',
      type: 'button',
      'aria-label': '缩小视图（键盘减号）',
      text: '−'
    });
    var zoomInBtn = h('button', {
      class: 'btn is-ghost is-small solar-zoom',
      type: 'button',
      'aria-label': '放大视图（键盘加号）',
      text: '+'
    });
    zoomOutBtn.addEventListener('click', function () {
      COSMOS.emit('solar:zoom', { dir: -1 });
    });
    zoomInBtn.addEventListener('click', function () {
      COSMOS.emit('solar:zoom', { dir: 1 });
    });
    var compareBtn = h('button', {
      class: 'btn is-small solar-compare',
      type: 'button',
      'aria-label': '前往行星对比实验室',
      text: '行星对比 →'
    });

    var consoleEl = h('div', { class: 'solar-console' }, [
      h('div', { class: 'solar-row solar-row-speed' }, [
        playBtn,
        h('div', { class: 'range-row solar-speed' }, [
          h('label', { class: 'u-mono solar-speed-label', 'for': 'sol-speed', text: '速度' }),
          speed,
          speedOut
        ])
      ]),
      h('div', { class: 'solar-row solar-row-toggles' }, [
        zoomOutBtn, zoomInBtn, labelBtn, orbitBtn, resetBtn, compareBtn
      ])
    ]);

    /* ---------------- 行星 chips ---------------- */
    var chipEls = {};
    var chips = h('div', { class: 'solar-chips', role: 'group', 'aria-label': '行星快捷列表' });
    planets.forEach(function (p) {
      var chip = h('button', {
        class: 'chip solar-chip',
        type: 'button',
        'data-planet': p.id,
        'aria-label': '聚焦并查看' + p.name + '档案',
        title: p.name + '（' + p.en + '）'
      }, [
        h('span', { class: 'solar-chip-sym u-mono', 'aria-hidden': 'true', html: p.symbol }),
        h('span', { class: 'solar-chip-name', text: p.name })
      ]);
      chip.addEventListener('click', function () {
        openDrawer(p.id);
      });
      chip.addEventListener('pointerenter', function () {
        COSMOS.emit('solar:hover', { id: p.id });
      });
      chip.addEventListener('pointerleave', function () {
        COSMOS.emit('solar:hover', { id: null });
      });
      chip.addEventListener('focus', function () {
        COSMOS.emit('solar:hover', { id: p.id });
      });
      chip.addEventListener('blur', function () {
        COSMOS.emit('solar:hover', { id: null });
      });
      chipEls[p.id] = chip;
      chips.appendChild(chip);
    });

    var note = h('p', {
      class: 'solar-note u-dim',
      text: '距离与太阳尺寸已压缩；行星相对大小按真实直径比例缩放。'
    });
    var hint = h('p', {
      class: 'solar-hint u-dim',
      text: '拖拽 360° 旋转 · Ctrl+滚轮 / 双指缩放 · ←/→ 旋转 · Q/E 俯仰 · +/− 缩放 · 点行星查看档案 · Esc 复位'
    });

    var root = h('div', { class: 'sol-ui solar-ui' }, [consoleEl, chips, note, hint]);
    el.appendChild(root);

    /* ---------------- 行星标签层（body 级，不随滚动） ---------------- */
    var old = document.getElementById('sol-labels');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var labelsLayer = h('div', { class: 'sol-labels', id: 'sol-labels', 'aria-hidden': 'true' });
    var labelEls = {};
    planets.forEach(function (p) {
      var lab = h('span', { class: 'sol-label', 'data-planet': p.id }, [
        h('i', { class: 'sol-label-dot', 'aria-hidden': 'true' }),
        h('b', { class: 'sol-label-name', text: p.name })
      ]);
      labelEls[p.id] = lab;
      labelsLayer.appendChild(lab);
    });
    document.body.appendChild(labelsLayer);

    /* ---------------- 抽屉（body 级） ---------------- */
    var oldScrim = document.getElementById('sol-scrim');
    if (oldScrim && oldScrim.parentNode) oldScrim.parentNode.removeChild(oldScrim);
    var scrim = h('div', { class: 'sol-scrim ch-scrim', id: 'sol-scrim', hidden: true });
    document.body.appendChild(scrim);

    var oldDrawer = document.getElementById('sol-drawer');
    if (oldDrawer && oldDrawer.parentNode) oldDrawer.parentNode.removeChild(oldDrawer);

    var dTitle = h('h3', { class: 'solar-drawer-title', id: 'sol-drawer-title' });
    var dName = h('span', { class: 'solar-drawer-name' });
    var dEn = h('span', { class: 'solar-drawer-en u-mono' });
    dTitle.appendChild(dName);
    dTitle.appendChild(dEn);

    var closeBtn = h('button', {
      class: 'drawer-close btn is-ghost is-small',
      type: 'button',
      'aria-label': '关闭行星档案',
      text: '关闭'
    });

    var thumb = h('figure', { class: 'solar-thumb', 'aria-hidden': 'true' });
    var tagline = h('p', { class: 'solar-tagline u-dim' });

    var statVals = [];
    var statGrid = h('dl', { class: 'solar-stats' });
    STAT_ROWS.forEach(function (row) {
      var v = h('span', { class: 'stat-v u-mono' });
      var u = h('span', { class: 'stat-u' });
      var dd = h('dd', { class: 'solar-stat-val' }, [v, u]);
      var dt = h('dt', { class: 'stat-l', text: row.label });
      statVals.push({ v: v, u: u });
      statGrid.appendChild(h('div', { class: 'stat' }, [dt, dd]));
    });

    var brief = h('p', { class: 'solar-brief ch-text' });
    var special = h('p', { class: 'solar-special' });
    var atmoBar = h('div', { class: 'solar-atmo-bar', 'aria-hidden': 'true' });
    var atmoLegend = h('ul', { class: 'legend solar-atmo-legend' });
    var atmoNote = h('p', { class: 'solar-atmo-note u-dim' });

    var drawerBody = h('div', { class: 'drawer-body solar-drawer-body' }, [
      h('div', { class: 'solar-drawer-top' }, [thumb, h('div', { class: 'solar-drawer-intro' }, [tagline, statGrid])]),
      brief,
      special,
      h('div', { class: 'solar-atmo' }, [
        h('h4', { class: 'u-kicker', text: '大气成分' }),
        atmoBar,
        atmoLegend,
        atmoNote
      ])
    ]);

    var drawer = h('section', {
      class: 'sol-ui solar-drawer drawer',
      id: 'sol-drawer',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'sol-drawer-title',
      hidden: true
    }, [
      h('div', { class: 'solar-drawer-inner drawer-inner' }, [
        h('header', { class: 'drawer-head solar-drawer-head' }, [
          h('p', { class: 'u-kicker', text: '02 · 太阳系 / 行星星历' }),
          dTitle,
          closeBtn
        ]),
        drawerBody
      ])
    ]);
    document.body.appendChild(drawer);

    /* ---------------- 抽屉内容（打开时填一次） ---------------- */
    function fillDrawer(p) {
      dName.textContent = p.name;
      dEn.textContent = ' ' + p.en + ' · ' + p.type;
      var src = TEX[p.texture];
      if (src) thumb.style.backgroundImage = 'url("' + src + '")';
      else thumb.style.backgroundImage = 'none';
      thumb.style.backgroundColor = p.color || '#17171B';
      tagline.textContent = p.tagline || '';
      STAT_ROWS.forEach(function (row, i) {
        var val = row.fmt(p);
        var slot = statVals[i];
        if (row.rich) slot.v.innerHTML = U.richText(val);
        else slot.v.textContent = String(val);
        slot.u.textContent = row.unit;
      });
      brief.textContent = p.desc || '';
      special.textContent = p.special || '';
      special.hidden = !p.special;

      COSMOS.dom.clear(atmoBar);
      COSMOS.dom.clear(atmoLegend);
      var list = p.atmosphere || [];
      list.forEach(function (item, i) {
        var color = ATM_COLORS[i % ATM_COLORS.length];
        atmoBar.appendChild(h('span', {
          class: 'solar-atmo-seg',
          style: { width: Math.max(item.pct, 0.6) + '%', background: color }
        }));
        atmoLegend.appendChild(h('li', { class: 'legend-item' }, [
          h('i', { class: 'solar-atmo-swatch', 'aria-hidden': 'true', style: { background: color } }),
          h('span', { class: 'solar-atmo-name', text: item.name }),
          h('span', { class: 'solar-atmo-pct u-mono', text: num(item.pct, item.pct < 1 ? 3 : 2) + '%' })
        ]));
      });
      atmoNote.textContent = p.atmosphereNote || '';

    }

    /* ---------------- 抽屉开关 ---------------- */
    function focusables() {
      return drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    }

    function openDrawer(id) {
      var p = byId(planets, id);
      if (!p) return;
      fillDrawer(p);
      locals.drawerId = id;
      locals.open = true;
      locals.lastFocus = document.activeElement;
      st.selected = id;
      drawer.hidden = false;
      /* 不显示全屏黑色遮罩：抽屉打开时场景保持可见，避免遮挡太阳与行星 */
      drawer.classList.add('is-open');
      if (labelsLayer) labelsLayer.classList.add('is-dim');
      closeBtn.focus();
    }

    function closeDrawer(returnFocus) {
      if (!locals.open) return;
      var prev = locals.drawerId;
      locals.open = false;
      locals.drawerId = null;
      drawer.hidden = true;
      scrim.hidden = true;
      drawer.classList.remove('is-open');
      if (labelsLayer) labelsLayer.classList.remove('is-dim');
      st.selected = null;
      if (returnFocus !== false) {
        var f = locals.lastFocus;
        if (f && f.focus && document.contains(f)) f.focus();
        else if (prev && chipEls[prev]) chipEls[prev].focus();
      }
    }

    closeBtn.addEventListener('click', function () { closeDrawer(true); });
    scrim.addEventListener('click', function () { closeDrawer(true); });
    drawer.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var list = focusables();
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

    /* ---------------- 控制条事件 ---------------- */
    playBtn.addEventListener('click', function () {
      st.paused = !st.paused;
      syncPlay();
    });

    function syncPlay() {
      playBtn.textContent = st.paused ? '播放' : '暂停';
      playBtn.setAttribute('aria-label', st.paused ? '继续公转' : '暂停公转');
      playBtn.classList.toggle('is-on', !st.paused);
    }

    speed.addEventListener('input', function () {
      var v = parseInt(speed.value, 10) || 0;
      st.daysPerSec = v;
      speedOut.textContent = num(v) + ' 天/秒';
      speed.setAttribute('aria-valuetext', num(v) + ' 天每秒');
    });

    labelBtn.addEventListener('click', function () {
      var on = st.labels === false;
      st.labels = on;
      labelBtn.classList.toggle('is-on', on);
      labelBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    orbitBtn.addEventListener('click', function () {
      var on = st.orbits === false;
      st.orbits = on;
      orbitBtn.classList.toggle('is-on', on);
      orbitBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    resetBtn.addEventListener('click', function () {
      closeDrawer(false);
      COSMOS.emit('solar:reset');
      st.selected = null;
    });

    compareBtn.addEventListener('click', function () {
      closeDrawer(false);
      goToChapter('compare');
    });

    var offFocus = COSMOS.on('solar:focus', function (payload) {
      var id = payload && payload.id;
      if (id) {
        if (locals.selectedId !== id) openDrawer(id);
      } else {
        closeDrawer(false);
      }
    });
    var offHover = COSMOS.on('solar:hover', function (payload) {
      var id = payload && payload.id ? payload.id : null;
      if (locals.hoverId === id) return;
      locals.hoverId = id;
      syncHighlight();
    });
    var offEsc = COSMOS.on('cosmos:escape', function () {
      closeDrawer(false);
    });

    /* ---------------- 高亮同步 ---------------- */
    function syncHighlight() {
      var order = planets;
      for (var i = 0; i < order.length; i++) {
        var id = order[i].id;
        var active = id === st.selected;
        var hot = id === locals.hoverId && id !== st.selected;
        var chip = chipEls[id];
        if (chip) {
          chip.classList.toggle('is-active', active);
          chip.classList.toggle('is-hot', hot);
          chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
        var lab = labelEls[id];
        if (lab) {
          lab.classList.toggle('is-active', active);
          lab.classList.toggle('is-hot', hot);
        }
      }
    }

    /* ---------------- 每帧 ---------------- */
    function update(p, o) {
      // 章节不在视口时不显示 body 级标签，避免盖住别的章
      var visible = o > 0.06 && locals.open !== true;
      if (visible !== locals.labelsVisible) {
        locals.labelsVisible = visible;
        labelsLayer.style.display = visible ? '' : 'none';
      }
      if (!visible) {
        if (locals.open && o < 0.06) closeDrawer(false);
        return;
      }

      var arr = st.labels;
      if (arr && arr.length) {
        for (var i = 0; i < arr.length; i++) {
          var item = arr[i];
          var lab = labelEls[item.id];
          if (!lab) continue;
          if (item.visible) {
            lab.style.transform = 'translate3d(' + (item.x | 0) + 'px,' + (item.y | 0) + 'px,0) translate(-50%,-150%)';
            lab.classList.remove('is-off');
          } else {
            lab.classList.add('is-off');
          }
        }
      }

      if (locals.selectedId !== st.selected || locals.syncedPaused !== st.paused) {
        locals.selectedId = st.selected;
        locals.syncedPaused = st.paused;
        if (!locals.open) syncPlay();
        syncHighlight();
      }
    }

    function reset() {
      closeDrawer(false);
    }

    // 初始同步
    syncPlay();
    syncHighlight();
    speed.setAttribute('aria-valuetext', num(st.daysPerSec) + ' 天每秒');

    return { update: update, reset: reset };
  });
})(window.COSMOS = window.COSMOS || {});
