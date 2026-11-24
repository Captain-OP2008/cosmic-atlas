/* ============================================================
 * COSMOS ATLAS · feat-compare.js
 * 04 行星对比实验室  widget: compare
 * ------------------------------------------------------------
 * 纯 DOM / SVG，不创建 3D 场景。所有数值来自 COSMOS.DATA，
 * 派生值（倍数、体重）现场计算，不写死第二套数字。
 * 工厂只建一次 DOM；update(p,o) 只更新文本、宽度与可见性。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var D = COSMOS.DATA || {};
  var h = COSMOS.dom.h;
  var num = COSMOS.util.num;
  var rich = COSMOS.dom.richText;
  var S = COSMOS.state = COSMOS.state || {};

  var PLANETS = D.planets || [];
  var EARTH = null;
  for (var e = 0; e < PLANETS.length; e++) {
    if (PLANETS[e].id === 'earth') EARTH = PLANETS[e];
  }
  var G0 = EARTH ? EARTH.gravity : 9.807;
  var EARTH_D = EARTH ? EARTH.diameterKm : 12742;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function byId(id, list) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function svg(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, String(attrs[k]));
      }
    }
    return el;
  }

  function setText(el, txt) {
    txt = String(txt);
    if (el.textContent !== txt) el.textContent = txt;
  }

  /* ============================================================
   * widget: compare
   * ============================================================ */
  COSMOS.registerWidget('compare', function (el, content) {
    var C = S.compare = S.compare || {};
    if (!C.tab) C.tab = 'size';
    if (!C.planet) C.planet = 'mars';
    if (!C.atmo) C.atmo = 'venus';
    if (typeof C.massKg !== 'number') C.massKg = 60;

    var root = h('div', { class: 'cmp-lab' });

    /* ---------- 顶部 ---------- */
    var head = h('div', { class: 'cmp-head' }, [
      h('p', { class: 'u-kicker', text: '04 · 行星对比 / 实验台' }),
      h('p', { class: 'cmp-guide u-dim', text: (content && content.hint) || '切换标签，比较大小、重力与大气。' })
    ]);

    /* ---------- tabs ---------- */
    var TABS = [
      { id: 'size', label: '大小', desc: '按真实直径比例' },
      { id: 'gravity', label: '重力', desc: '你在各行星上的体重' },
      { id: 'atmos', label: '大气', desc: '成分与气压' }
    ];
    var tablist = h('div', { class: 'tabs cmp-tabs', role: 'tablist', 'aria-label': '行星对比维度' });
    var tabBtn = {};
    var panels = {};
    var panelWrap = h('div', { class: 'cmp-panels' });

    function setTab(id, focus) {
      C.tab = id;
      for (var i = 0; i < TABS.length; i++) {
        var t = TABS[i];
        var on = t.id === id;
        var b = tabBtn[t.id];
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (panels[t.id]) panels[t.id].hidden = !on;
        if (on && focus) b.focus();
      }
    }

    for (var ti = 0; ti < TABS.length; ti++) {
      (function (t) {
        var b = h('button', {
          class: 'tab cmp-tab',
          type: 'button',
          role: 'tab',
          id: 'cmp-tab-' + t.id,
          'aria-controls': 'cmp-panel-' + t.id,
          'aria-selected': 'false'
        }, [h('span', { text: t.label }), h('small', { text: t.desc })]);
        b.addEventListener('click', function () { setTab(t.id, false); });
        b.addEventListener('keydown', function (ev) {
          var idx = -1;
          for (var i = 0; i < TABS.length; i++) if (TABS[i].id === t.id) idx = i;
          if (ev.key === 'ArrowRight') {
            ev.preventDefault();
            setTab(TABS[(idx + 1) % TABS.length].id, true);
          } else if (ev.key === 'ArrowLeft') {
            ev.preventDefault();
            setTab(TABS[(idx + TABS.length - 1) % TABS.length].id, true);
          } else if (ev.key === 'Home') {
            ev.preventDefault();
            setTab(TABS[0].id, true);
          } else if (ev.key === 'End') {
            ev.preventDefault();
            setTab(TABS[TABS.length - 1].id, true);
          }
        });
        tabBtn[t.id] = b;
        tablist.appendChild(b);
      })(TABS[ti]);
    }

    /* ---------- 行星选择器（复用） ---------- */
    function planetChips(currentId, onPick, label) {
      var row = h('div', { class: 'cmp-planets', role: 'group', 'aria-label': label });
      var map = {};
      for (var i = 0; i < PLANETS.length; i++) {
        (function (p) {
          var b = h('button', {
            class: 'chip cmp-chip' + (p.id === currentId ? ' is-on' : ''),
            type: 'button',
            'aria-pressed': p.id === currentId ? 'true' : 'false',
            'aria-label': p.name + '，直径 ' + num(p.diameterKm) + ' 公里',
            text: p.name
          });
          b.addEventListener('click', function () { onPick(p.id, map); });
          map[p.id] = b;
          row.appendChild(b);
        })(PLANETS[i]);
      }
      return { row: row, map: map };
    }

    function syncChips(map, id) {
      for (var k in map) {
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        var on = k === id;
        map[k].classList.toggle('is-on', on);
        map[k].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    /* ============================================================
     * 面板 1 · 大小
     * ============================================================ */
    var sizePanel = h('section', {
      class: 'cmp-panel cmp-size-panel', id: 'cmp-panel-size', role: 'tabpanel', 'aria-labelledby': 'cmp-tab-size'
    });
    var sizePick = planetChips(C.planet, function (id, map) {
      C.planet = id;
      syncChips(map, id);
      renderSize();
    }, '选择要对比的行星');
    var sizeSvg = svg('svg', { class: 'cmp-size-svg', viewBox: '0 0 760 412', role: 'img', 'aria-label': '' });
    var earthCircle = svg('circle', { cx: 220, cy: 200, r: 100, class: 'cmp-circle cmp-circle-earth' });
    var otherCircle = svg('circle', { cx: 545, cy: 200, r: 60, class: 'cmp-circle cmp-circle-other' });
    var earthLabel = svg('text', { x: 220, y: 378, class: 'cmp-circle-label', 'text-anchor': 'middle' });
    var otherLabel = svg('text', { x: 545, y: 378, class: 'cmp-circle-label', 'text-anchor': 'middle' });
    var earthSub = svg('text', { x: 220, y: 400, class: 'cmp-circle-sub', 'text-anchor': 'middle' });
    var otherSub = svg('text', { x: 545, y: 400, class: 'cmp-circle-sub', 'text-anchor': 'middle' });
    sizeSvg.appendChild(earthCircle);
    sizeSvg.appendChild(otherCircle);
    sizeSvg.appendChild(earthLabel);
    sizeSvg.appendChild(otherLabel);
    sizeSvg.appendChild(earthSub);
    sizeSvg.appendChild(otherSub);

    var sizeCap = h('figcaption', { class: 'cmp-size-cap' });
    var sizePanelBody = h('div', { class: 'cmp-panel-body' }, [
      sizePick.row,
      h('figure', { class: 'cmp-size' }, [sizeSvg, sizeCap])
    ]);
    sizePanel.appendChild(sizePanelBody);

    function renderSize() {
      var p = byId(C.planet, PLANETS) || EARTH;
      if (!p) return;
      var ratio = p.diameterKm / EARTH_D;
      var maxRatio = Math.max(1, ratio);
      var R = 150 / maxRatio;
      var rEarth = R;
      var rOther = R * ratio;
      earthCircle.setAttribute('r', rEarth.toFixed(2));
      otherCircle.setAttribute('r', rOther.toFixed(2));
      setText(earthLabel, '地球');
      setText(otherLabel, p.name);
      setText(earthSub, num(EARTH_D) + ' km');
      setText(otherSub, num(p.diameterKm) + ' km');
      var cap = p.id === 'earth'
        ? '地球与自身对比：直径 ' + num(p.diameterKm) + ' km。'
        : p.name + '直径 ' + num(p.diameterKm) + ' km，是地球的 ' + ratio.toFixed(2) + ' 倍。';
      setText(sizeCap, cap);
      sizeSvg.setAttribute('aria-label', '地球与' + p.name + '的直径比例示意，' + cap);
    }

    /* ============================================================
     * 面板 2 · 重力
     * ============================================================ */
    var gravityPanel = h('section', {
      class: 'cmp-panel cmp-gravity-panel', id: 'cmp-panel-gravity', role: 'tabpanel', 'aria-labelledby': 'cmp-tab-gravity'
    });
    var maxG = 0;
    for (var gi = 0; gi < PLANETS.length; gi++) maxG = Math.max(maxG, PLANETS[gi].gravity);

    var massInput = h('input', {
      class: 'cmp-mass-input u-mono', id: 'cmp-mass', type: 'number',
      min: '1', max: '300', step: '1', value: String(C.massKg), inputmode: 'decimal'
    });
    massInput.setAttribute('aria-label', '输入体重，单位千克');
    var massRow = h('div', { class: 'cmp-mass-row' }, [
      h('label', { class: 'u-mono', 'for': 'cmp-mass', text: '体重（质量）' }),
      h('span', { class: 'cmp-mass-wrap' }, [massInput, h('span', { class: 'u-mono', text: 'kg' })]),
      h('span', { class: 'u-dim cmp-mass-hint', text: '质量在哪儿都一样，重量会变。' })
    ]);
    massInput.value = String(C.massKg);

    var gRows = [];
    var gList = h('div', { class: 'cmp-g-list' });
    for (var pj = 0; pj < PLANETS.length; pj++) {
      (function (p) {
        var fill = h('i', { class: 'bar-fill cmp-g-fill' });
        var track = h('div', { class: 'bar-track cmp-g-track' }, [fill]);
        var gv = h('span', { class: 'cmp-g-val u-mono' });
        var wv = h('span', { class: 'cmp-g-weight u-mono' });
        var row = h('div', { class: 'bar-row cmp-g-row' + (p.id === 'earth' ? ' is-earth' : '') }, [
          h('span', { class: 'cmp-g-name', text: p.name }),
          track,
          gv,
          wv
        ]);
        gRows.push({ p: p, fill: fill, gv: gv, wv: wv });
        gList.appendChild(row);
      })(PLANETS[pj]);
    }
    var gSum = h('p', { class: 'cmp-g-sum' });
    var gNote = h('p', { class: 'u-dim cmp-g-note', text: '重量 = 质量 × 表面重力。1 千克力（kgf）= 9.807 N，就是地球上 1 千克质量受到的重量。' });
    gravityPanel.appendChild(h('div', { class: 'cmp-panel-body' }, [
      massRow,
      h('div', { class: 'cmp-g-scale u-mono', 'aria-hidden': 'true' }, [
        h('span', { text: '0 m/s²' }), h('span', { text: maxG.toFixed(1) + ' m/s²' })
      ]),
      gList,
      gSum,
      gNote
    ]));

    function renderGravity() {
      var m = C.massKg;
      for (var i = 0; i < gRows.length; i++) {
        var r = gRows[i];
        var pct = (r.p.gravity / maxG) * 100;
        r.fill.style.width = pct.toFixed(1) + '%';
        setText(r.gv, r.p.gravity.toFixed(2) + ' m/s²');
        var w = m * r.p.gravity;
        setText(r.wv, num(w.toFixed(0)) + ' N · ' + (w / G0).toFixed(1) + ' kgf');
      }
      var mars = byId('mars', PLANETS);
      var planet = byId(C.planet, PLANETS);
      var a = planet || mars || EARTH;
      var wn = m * a.gravity;
      var line = '在' + a.name + '上，' + m + ' kg 的体重是 ' + num(wn.toFixed(0)) + ' N（' + (wn / G0).toFixed(1) + ' kgf）';
      if (mars && a.id !== 'mars') {
        line += '；同样质量在火星上是 ' + num((m * mars.gravity).toFixed(0)) + ' N。';
      } else {
        line += '。';
      }
      setText(gSum, line);
    }

    massInput.addEventListener('input', function () {
      var v = parseFloat(massInput.value);
      if (!isFinite(v) || v <= 0) return;
      C.massKg = Math.min(300, Math.max(1, Math.round(v)));
      renderGravity();
    });
    massInput.addEventListener('change', function () {
      massInput.value = String(C.massKg);
    });

    /* ============================================================
     * 面板 3 · 大气
     * ============================================================ */
    var atmosPanel = h('section', {
      class: 'cmp-panel cmp-atmos-panel', id: 'cmp-panel-atmos', role: 'tabpanel', 'aria-labelledby': 'cmp-tab-atmos'
    });
    var ATMO_COLORS = ['#288BFF', '#1C67E3', '#0B3D91', '#B9B9BB', '#959599', '#444447'];
    var atmoPick = planetChips(C.atmo, function (id, map) {
      C.atmo = id;
      syncChips(map, id);
      renderAtmo();
    }, '选择要查看大气的行星');

    var atmoBarEl = h('div', { class: 'cmp-atmo-bar', 'aria-hidden': 'true' });
    var atmoSegs = [];
    for (var si = 0; si < 6; si++) {
      var seg = h('i', { class: 'cmp-atmo-seg' });
      seg.style.background = ATMO_COLORS[si];
      atmoSegs.push(seg);
      atmoBarEl.appendChild(seg);
    }
    var atmoLegend = h('ul', { class: 'legend cmp-atmo-legend' });
    var atmoLegendRows = [];
    for (var li = 0; li < 6; li++) {
      var sw = h('i', { class: 'cmp-atmo-swatch', 'aria-hidden': 'true' });
      sw.style.background = ATMO_COLORS[li];
      var nm = h('span', { class: 'cmp-atmo-name' });
      var pc = h('span', { class: 'cmp-atmo-pct u-mono' });
      var lrow = h('li', { class: 'legend-item' }, [sw, nm, pc]);
      atmoLegendRows.push({ li: lrow, nm: nm, pc: pc });
      atmoLegend.appendChild(lrow);
    }
    var atmoTitle = h('p', { class: 'cmp-atmo-title u-mono' });
    var atmoNote = h('p', { class: 'u-dim cmp-atmo-note' });
    var atmoTable = h('p', { class: 'cmp-atmo-facts u-dim' });

    atmosPanel.appendChild(h('div', { class: 'cmp-panel-body' }, [
      atmoPick.row,
      atmoTitle,
      atmoBarEl,
      atmoLegend,
      atmoNote,
      atmoTable
    ]));

    function renderAtmo() {
      var p = byId(C.atmo, PLANETS);
      if (!p) return;
      var list = p.atmosphere || [];
      var total = 0;
      for (var i = 0; i < list.length; i++) total += list[i].pct;
      var shown = list.slice(0, 6);
      var used = 0;
      for (var s2 = 0; s2 < atmoSegs.length; s2++) {
        var item = shown[s2];
        if (!item) {
          atmoSegs[s2].style.display = 'none';
          atmoLegendRows[s2].li.hidden = true;
          continue;
        }
        used += item.pct;
        atmoSegs[s2].style.display = '';
        atmoSegs[s2].style.width = (item.pct / total * 100).toFixed(2) + '%';
        atmoLegendRows[s2].li.hidden = false;
        setText(atmoLegendRows[s2].nm, item.name);
        setText(atmoLegendRows[s2].pc, (item.pct < 1 ? item.pct.toFixed(3) : item.pct.toFixed(2)) + '%');
      }
      setText(atmoTitle, p.name + '（' + p.en + '）大气成分 · 合计 ' + total.toFixed(2) + '%');
      setText(atmoNote, p.atmosphereNote || '本数据表暂无该行星的气压说明。');
      var earthTxt = '地球：氮 78.08%、氧 20.95%，其余为氩与二氧化碳等。';
      var jupiter = byId('jupiter', PLANETS);
      var extra = p.id === 'earth' ? '' : '对照 ' + earthTxt;
      if (p.id !== 'earth' && jupiter && p.id !== 'jupiter') {
        extra += ' 木星、土星则以氢、氦为主。';
      }
      if (p.moons === 0 && p.id === 'mercury') extra = '水星几乎没有大气，严格说是外逸层。';
      setText(atmoTable, extra);
    }

    /* ---------- 组装 ---------- */
    panels.size = sizePanel;
    panels.gravity = gravityPanel;
    panels.atmos = atmosPanel;
    panelWrap.appendChild(sizePanel);
    panelWrap.appendChild(gravityPanel);
    panelWrap.appendChild(atmosPanel);

    root.appendChild(head);
    root.appendChild(tablist);
    root.appendChild(panelWrap);
    el.appendChild(root);

    setTab(C.tab, false);
    renderSize();
    renderGravity();
    renderAtmo();

    return {
      update: function (p, o) {
        root.style.setProperty('--o', String(o));
      },
      reset: function () {
        C.planet = 'mars';
        C.atmo = 'venus';
        C.massKg = 60;
        massInput.value = '60';
        syncChips(sizePick.map, C.planet);
        syncChips(atmoPick.map, C.atmo);
        setTab('size', false);
        renderSize();
        renderGravity();
        renderAtmo();
      }
    };
  });

})(window.COSMOS = window.COSMOS || {});
