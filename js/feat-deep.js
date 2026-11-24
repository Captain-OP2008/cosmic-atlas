/* ============================================================
 * COSMOS ATLAS · 06 致密天体 / 07 恒星的一生 —— 互动组件
 * ------------------------------------------------------------
 * 组件约定（js/ui.js）：
 *   COSMOS.registerWidget(id, function (el, content, section) { ... })
 *   el = 章节内 .ch-widget（绝对铺满视口，pointer-events:none）
 *   返回 { update(p, o) }，p = 本章滚动进度，o = 可见度
 *
 * 组件只写 COSMOS.state，不直接碰 3D：
 *   COSMOS.state.compact = { mode:'blackhole'|'neutronstar'|'whitedwarf', mass }
 *   COSMOS.state.stellar = { mass, phase }
 * scene-compact.js / scene-stellar-life.js 每帧读取并做插值。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const D = COSMOS.DATA || {};
  const M = COSMOS.deepModel || null;
  const h = COSMOS.dom.h;
  const state = (COSMOS.state = COSMOS.state || {});
  const clamp = (COSMOS.util && COSMOS.util.clamp) || function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  if (!state.compact) state.compact = { mode: 'blackhole', mass: 10 };
  if (!state.stellar) state.stellar = { mass: 1, phase: 1 };

  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

  function sup(n) {
    return String(n).split('').map(function (c) { return SUP[c] || c; }).join('');
  }

  function fmtNum(v, digits) {
    if (M) return M.fmtNum(v, digits);
    if (v == null || !isFinite(v)) return '—';
    const d = digits == null ? 2 : digits;
    const parts = (Math.abs(v) >= 1000 ? String(Math.round(v)) : v.toFixed(d)).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function fmtMass(mass) {
    if (mass < 0.1) return mass.toFixed(2);
    if (mass < 1) return mass.toFixed(2);
    if (mass < 10) return mass.toFixed(1);
    return String(Math.round(mass));
  }

  function fmtRadiusSun(r) {
    if (r >= 1) return fmtNum(r, r >= 10 ? 0 : 2);
    if (r >= 0.01) return fmtNum(r, 4);
    const e = Math.floor(Math.log10(r));
    return fmtNum(r / Math.pow(10, e), 1) + ' × 10' + sup(e);
  }

  function fmtTemp(k) {
    if (k >= 10000) return fmtNum(k, 0);
    if (k >= 1000) return fmtNum(k, 0);
    return fmtNum(k, 0);
  }

  function emit(name, data) {
    if (COSMOS.emit) COSMOS.emit(name, data);
  }

  function el(tag, cls, text) {
    const attrs = {};
    if (cls) attrs.class = cls;
    if (text != null) attrs.text = text;
    return h(tag, attrs);
  }

  function photoPath(name) {
    return 'assets/photos/' + name + '.jpg';
  }

  function openPhoto(src, caption) {
    if (COSMOS.UI && typeof COSMOS.UI.openLightbox === 'function') {
      COSMOS.UI.openLightbox(src, caption);
      return true;
    }
    return false;
  }

  /* 图片按钮：可点击 + 键盘 Enter/Space 打开灯箱 */
  function photoButton(src, alt, caption) {
    const img = h('img', {
      class: 'data-card-media deep-photo-img',
      src: src,
      alt: alt,
      loading: 'lazy',
      decoding: 'async'
    });
    const btn = h('button', {
      class: 'deep-photo-btn',
      type: 'button',
      'aria-label': '放大查看：' + alt
    }, [img]);
    btn.addEventListener('click', function () { openPhoto(src, caption); });
    return btn;
  }

  /* ============================================================
   * 06 致密天体组件
   * ============================================================ */
  COSMOS.registerWidget('compact', function (elRoot, content) {
    const TABS = [
      { id: 'blackhole', label: '黑洞', en: 'BLACK HOLE' },
      { id: 'neutronstar', label: '中子星', en: 'NEUTRON STAR' },
      { id: 'whitedwarf', label: '白矮星', en: 'WHITE DWARF' }
    ];

    const PHOTOS = {
      blackhole: {
        src: photoPath('bh-concept'),
        alt: '黑洞吸积盘与光子环的艺术想象图',
        cap: '黑洞吸积盘与光子环示意（艺术图，非实测照片）'
      },
      neutronstar: {
        src: photoPath('neutronstar-concept'),
        alt: '中子星磁极射束与磁场线的艺术想象图',
        cap: '中子星与双极射束示意（艺术图）'
      },
      whitedwarf: {
        src: photoPath('nebula-ring'),
        alt: '环状星云 M57 的照片',
        cap: '环状星云（M57）：类太阳恒星抛出的行星状星云，中心是一颗白矮星'
      }
    };

    const root = h('div', { class: 'deep-widget deep-compact', 'data-ui': true });
    const panel = h('section', { class: 'deep-panel panel', 'aria-label': '致密天体互动档案' });

    /* --- 标题 --- */
    panel.appendChild(h('header', { class: 'deep-head' }, [
      h('p', { class: 'u-kicker', text: 'INTERACTIVE · 对比三种残骸' }),
      h('h3', { class: 'deep-title' }, [
        h('span', { text: '同样一颗太阳，三种结局' }),
        h('span', { class: 'deep-title-sub', text: 'COMPACT OBJECTS' })
      ])
    ]));

    /* --- 页签 --- */
    const tablist = h('div', { class: 'tabs deep-tabs', role: 'tablist', 'aria-label': '选择致密天体' });
    const tabBtns = [];
    TABS.forEach(function (tab) {
      const btn = h('button', {
        class: 'tab',
        type: 'button',
        role: 'tab',
        id: 'deep-c-tab-' + tab.id,
        'aria-controls': 'deep-c-panel-' + tab.id,
        'aria-selected': 'false',
        tabindex: '-1',
        'data-mode': tab.id
      }, tab.label);
      tablist.appendChild(btn);
      tabBtns.push(btn);
    });
    panel.appendChild(tablist);

    /* --- 黑洞面板 --- */
    const massInput = h('input', {
      class: 'range',
      id: 'deep-c-mass',
      type: 'range',
      min: '1',
      max: '50',
      step: '0.5',
      value: String(state.compact.mass || 10),
      'aria-label': '黑洞质量，单位太阳质量'
    });
    const massVal = h('output', { class: 'range-val', for: 'deep-c-mass', text: '10 M☉' });
    const massRow = h('div', { class: 'range-row' }, [
      h('label', { for: 'deep-c-mass', text: '质量 / M☉' }),
      massInput,
      massVal
    ]);

    function statRow(label, value, unit) {
      return h('div', { class: 'deep-stat' }, [
        h('dt', { text: label }),
        h('dd', { class: 'deep-stat-v' }, [
          h('span', { class: 'deep-stat-n', text: value }),
          h('span', { class: 'deep-stat-u', text: unit })
        ])
      ]);
    }

    const outMass = h('span', { class: 'deep-stat-n', text: '10.0' });
    const outRs = h('span', { class: 'deep-stat-n', text: '29.5' });
    const outDiam = h('span', { class: 'deep-stat-n', text: '59.1' });
    const bhStats = h('dl', { class: 'deep-stats' }, [
      h('div', { class: 'deep-stat' }, [h('dt', { text: '质量' }), h('dd', { class: 'deep-stat-v' }, [outMass, h('span', { class: 'deep-stat-u', text: 'M☉' })])]),
      h('div', { class: 'deep-stat' }, [h('dt', { text: '史瓦西半径' }), h('dd', { class: 'deep-stat-v' }, [outRs, h('span', { class: 'deep-stat-u', text: 'km' })])]),
      h('div', { class: 'deep-stat' }, [h('dt', { text: '事件视界直径' }), h('dd', { class: 'deep-stat-v' }, [outDiam, h('span', { class: 'deep-stat-u', text: 'km' })])])
    ]);

    const bhPane = h('div', {
      class: 'deep-pane',
      id: 'deep-c-panel-blackhole',
      role: 'tabpanel',
      'aria-labelledby': 'deep-c-tab-blackhole'
    }, [
      massRow,
      bhStats,
      h('p', { class: 'deep-note', text: 'rs = 2GM/c²：每 1 倍太阳质量约 2.95 km。吸积盘内缘取 3 rs（最内稳定圆轨道 ISCO）。' })
    ]);

    /* --- 中子星面板 --- */
    const zoomOut = h('button', {
      class: 'btn btn-sm btn-ghost deep-zoom-btn',
      type: 'button',
      'aria-label': '缩小中子星视角'
    }, '−');
    const zoomIn = h('button', {
      class: 'btn btn-sm btn-ghost deep-zoom-btn',
      type: 'button',
      'aria-label': '放大中子星视角'
    }, '+');
    zoomOut.addEventListener('click', function () { emit('cosmos:compact:zoom', { step: -1 }); });
    zoomIn.addEventListener('click', function () { emit('cosmos:compact:zoom', { step: 1 }); });

    const nsPane = h('div', {
      class: 'deep-pane',
      id: 'deep-c-panel-neutronstar',
      role: 'tabpanel',
      'aria-labelledby': 'deep-c-tab-neutronstar',
      hidden: true
    }, [
      h('dl', { class: 'deep-stats' }, [
        statRow('自转周期', '1.4', 's'),
        statRow('磁场量级', '10⁸', 'T'),
        statRow('半径', '12', 'km')
      ]),
      h('div', { class: 'deep-zoom' }, [
        h('span', { class: 'deep-zoom-label', text: '视角缩放' }),
        zoomOut,
        zoomIn,
        h('span', { class: 'deep-zoom-hint', text: '滚轮 / 双指 也可缩放' })
      ]),
      h('p', { class: 'deep-note', text: '一茶匙中子星物质约重 10 亿吨；自转周期取自典型脉冲星的数量级（0.001–10 s），此处以 1.4 s 示意。' })
    ]);

    /* --- 白矮星面板 --- */
    const wdPane = h('div', {
      class: 'deep-pane',
      id: 'deep-c-panel-whitedwarf',
      role: 'tabpanel',
      'aria-labelledby': 'deep-c-tab-whitedwarf',
      hidden: true
    }, [
      h('dl', { class: 'deep-stats' }, [
        statRow('表面温度', '约 10,000', 'K'),
        statRow('半径', '约 6,400', 'km'),
        statRow('密度', '10⁹', 'kg/m³')
      ]),
      h('p', { class: 'deep-note', text: '半径与地球相当，质量却接近太阳；靠电子简并压支撑，超过 1.44 倍太阳质量（钱德拉塞卡极限）会继续坍缩。' })
    ]);

    panel.appendChild(bhPane);
    panel.appendChild(nsPane);
    panel.appendChild(wdPane);

    /* --- 数据卡（照片 + DATA 档案） --- */
    const cardImg = h('img', { class: 'data-card-media deep-photo-img', alt: '', loading: 'lazy', decoding: 'async' });
    const cardBtn = h('button', { class: 'deep-photo-btn', type: 'button', 'aria-label': '放大查看照片' }, [cardImg]);
    const cardTitle = h('h4', { class: 'data-card-title' });
    const cardTag = h('span', { class: 'data-card-tag' });
    const cardDesc = h('p', { class: 'deep-desc' });
    const cardDl = h('dl', { class: 'deep-card-stats' });
    const cardRows = [
      { dt: h('dt'), dd: h('dd') },
      { dt: h('dt'), dd: h('dd') },
      { dt: h('dt'), dd: h('dd') }
    ];
    cardRows.forEach(function (row) {
      cardDl.appendChild(h('div', { class: 'deep-card-row' }, [row.dt, row.dd]));
    });
    const card = h('article', { class: 'data-card deep-card' }, [
      cardBtn,
      h('div', { class: 'data-card-body' }, [
        h('div', { class: 'data-card-head' }, [cardTitle, cardTag]),
        cardDesc,
        cardDl,
        h('span', { class: 'u-kicker deep-photo-hint', text: '点击图片放大 · 数据出自站内档案' })
      ])
    ]);
    panel.appendChild(card);

    /* --- 操作 --- */
    const resetBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, '复位');
    resetBtn.addEventListener('click', function () { reset(); });
    panel.appendChild(h('div', { class: 'deep-actions' }, [resetBtn]));

    root.appendChild(panel);
    elRoot.appendChild(root);

    /* --- 状态 --- */
    let mode = state.compact.mode || 'blackhole';
    if (!TABS.some(function (t) { return t.id === mode; })) mode = 'blackhole';

    function applyMode(next, silent) {
      if (!TABS.some(function (t) { return t.id === next; })) next = 'blackhole';
      mode = next;
      state.compact.mode = next;
      tabBtns.forEach(function (btn) {
        const on = btn.getAttribute('data-mode') === next;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.tabIndex = on ? 0 : -1;
      });
      bhPane.hidden = next !== 'blackhole';
      nsPane.hidden = next !== 'neutronstar';
      wdPane.hidden = next !== 'whitedwarf';
      updateCard(next);
      if (!silent) emit('cosmos:compact:mode', { mode: next });
    }

    function applyMass(next, silent) {
      const mass = clamp(isFinite(next) ? next : 10, 1, 50);
      state.compact.mass = mass;
      const readout = M
        ? M.compactReadout(mass)
        : { rsKm: 2.953 * mass, diameterKm: 2 * 2.953 * mass };
      state.compact.screen = {
        mass: mass,
        rsKm: readout.rsKm,
        diameterKm: readout.diameterKm,
        mode: mode
      };
      massInput.value = String(mass);
      massVal.textContent = fmtMass(mass) + ' M☉';
      outMass.textContent = fmtMass(mass);
      outRs.textContent = fmtNum(readout.rsKm, 2);
      outDiam.textContent = fmtNum(readout.diameterKm, 1);
      if (!silent) emit('cosmos:compact:mass', { mass: mass, rsKm: readout.rsKm });
    }

    let cardPhoto = PHOTOS[mode] || PHOTOS.blackhole;
    cardBtn.addEventListener('click', function () {
      openPhoto(cardPhoto.src, cardPhoto.cap);
    });

    function updateCard(id) {
      const d = (D.deepById && D.deepById(id)) || null;
      const photo = PHOTOS[id] || PHOTOS.blackhole;
      cardPhoto = photo;
      cardImg.src = photo.src;
      cardImg.alt = photo.alt;
      cardBtn.setAttribute('aria-label', '放大查看：' + photo.alt);
      cardTitle.textContent = d ? d.name : id;
      cardTag.textContent = d ? String(d.en || '').toUpperCase() : '';
      cardDesc.textContent = d ? d.desc : '';
      const stats = (d && d.stats) || [];
      cardRows.forEach(function (row, i) {
        const s = stats[i];
        row.dt.textContent = s ? s.label : '';
        row.dd.textContent = s ? s.value : '';
        row.dt.hidden = !s;
        row.dd.hidden = !s;
      });
    }

    function reset() {
      applyMode('blackhole', true);
      applyMass(10, true);
      emit('cosmos:compact:reset');
    }

    /* --- 事件 --- */
    massInput.addEventListener('input', function () { applyMass(parseFloat(massInput.value), false); });

    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () { applyMode(btn.getAttribute('data-mode'), false); });
    });

    tablist.addEventListener('keydown', function (e) {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (keys.indexOf(e.key) < 0) return;
      e.preventDefault();
      const cur = tabBtns.findIndex(function (b) { return b.getAttribute('data-mode') === mode; });
      let next;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabBtns.length - 1;
      else if (e.key === 'ArrowLeft') next = (cur - 1 + tabBtns.length) % tabBtns.length;
      else next = (cur + 1) % tabBtns.length;
      applyMode(tabBtns[next].getAttribute('data-mode'), false);
      tabBtns[next].focus();
    });

    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      const t = e.target;
      if (t && t.closest && t.closest('.deep-widget')) reset();
    });

    if (COSMOS.on) {
      COSMOS.on('cosmos:escape', function () {
        const active = document.activeElement;
        if (active && root.contains(active)) reset();
      });
    }

    /* 初始同步 */
    applyMode(mode, true);
    applyMass(state.compact.mass || 10, true);

    return {
      el: root,
      update: function () { /* 组件无滚动驱动状态；淡入淡出由 .ch-inner --o 控制 */ }
    };
  });

})(window.COSMOS = window.COSMOS || {});
