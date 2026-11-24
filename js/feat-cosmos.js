/* ============================================================
 * COSMOS ATLAS v2 · 08 星系动物园 / 09 极端宇宙 · 交互组件
 * ------------------------------------------------------------
 * registerWidget('galaxies')  tabs + 代表星系 + 数据卡 + 画廊 + 灯箱
 * registerWidget('extreme')   tabs + 叠层模式块 + M200/尺度滑杆 + 动态曲线 + 照片 + 灯箱
 *
 * 约定（与 ui.js v2 一致）：
 *   .ch-widget 铺满视口、pointer-events:none；
 *   本文件的面板 .cz-panel 自己 pointer-events:auto。
 * 数值一律从 COSMOS.DATA 读取；照片元数据（望远镜/年份）维护在下面
 * PHOTOS 表内（只写能确认的，不能确认年份就留空）。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var D = COSMOS.DATA || {};
  if (!COSMOS || !COSMOS.dom || !COSMOS.dom.h) return;
  var h = COSMOS.dom.h;
  var U = COSMOS.util || {};
  var PHOTO_DIR = 'assets/photos/';

  function photoSrc(key) { return PHOTO_DIR + key + '.jpg'; }

  /* ============================================================
   * 一、照片元数据（本地文件，NASA/ESA 图库）
   *  - 星系照片：哈勃（可见光）或斯皮策（红外），都不是韦伯
   *  - 深空概念图：NASA/JPL-Caltech 科学示意
   *  - 不确定年份留空，不写猜测值
   * ============================================================ */
  var PHOTOS = {
    'galaxy-whirlpool': {
      telescope: 'NASA / ESA · 哈勃空间望远镜',
      year: '2005',
      note: '涡旋星系 M51 与伴星系 NGC 5195 正在相互作用，旋臂被压缩成一条条恒星形成带。'
    },
    'galaxy-andromeda': {
      telescope: 'NASA / ESA · 哈勃空间望远镜',
      year: '2015',
      note: '哈勃对仙女座星系局部拍摄的拼接图，分辨率足以把单个恒星分辨出来。'
    },
    'galaxy-sombrero': {
      telescope: 'NASA · 斯皮策空间望远镜（红外）',
      year: '',
      note: '红外波段穿过尘埃，露出草帽星系盘面与被恒星加热的尘埃环。'
    },
    'galaxy-antennae': {
      telescope: 'NASA · 斯皮策空间望远镜（红外）',
      year: '2010',
      note: '碰撞中的两个星系，潮汐力把气体与恒星甩成两条长尾，像一对触角。'
    },
    'galaxy-barred': {
      telescope: 'NASA / ESA · 哈勃空间望远镜',
      year: '2005',
      note: 'NGC 1300 的中央棒结构，把气体与恒星输往星系核心。'
    },
    'galaxy-lmc': {
      telescope: 'NASA / ESA · 哈勃空间望远镜',
      year: '',
      note: '大麦哲伦云的恒星形成区；1987A 超新星就诞生在这片不规则伴星系里。'
    },
    'galaxy-cartwheel': {
      telescope: 'NASA / ESA 影像',
      year: '',
      note: '车轮星系：一个小星系垂直穿过盘面后，激波把气体挤压成环状恒星带。'
    },
    'galaxy-deepfield': {
      telescope: 'NASA / ESA · 哈勃空间望远镜',
      year: '2004',
      note: '哈勃超深场：累计曝光 11.3 天，画面里约有 1 万个星系。'
    },
    'deep-gravwave': {
      telescope: 'NASA / JPL-Caltech · 科学示意',
      year: '2016',
      note: '双黑洞并合示意：并合瞬间约有 3 个太阳的质量转化为引力波。'
    },
    'deep-darkmatter': {
      telescope: 'NASA / JPL-Caltech · 科学示意',
      year: '',
      note: '暗物质晕示意：它不发光、不挡光，只在引力上留下痕迹。'
    },
    'deep-darkenergy': {
      telescope: 'NASA / JPL-Caltech · 科学示意',
      year: '',
      note: '暗能量示意：空间本身的能量密度让宇宙膨胀加速。'
    },
    'deep-quasar': {
      telescope: 'NASA / JPL-Caltech · 科学示意',
      year: '',
      note: '类星体示意：中心黑洞吸积物质时释放的引力能，让它比整个星系还亮。'
    }
  };

  function photoMeta(key) {
    return PHOTOS[key] || { telescope: 'NASA / ESA 影像', year: '', note: '' };
  }

  function typeLabel(type) {
    if (type === 'spiral') return '螺旋星系';
    if (type === 'elliptical') return '椭圆星系';
    if (type === 'irregular') return '不规则星系';
    if (type === 'deep') return '深场';
    return '—';
  }

  /* ============================================================
   * 二、共享灯箱（两个章节共用，全屏遮罩 + 键盘切换）
   * ============================================================ */
  var lb = null;

  function buildLightbox() {
    var root = h('div', {
      class: 'lightbox cz-lightbox',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '照片查看器',
      'aria-hidden': 'true',
      hidden: true
    });
    var img = h('img', { class: 'lightbox-img cz-lb-img', alt: '' });
    var title = h('p', { class: 'cz-lb-title' });
    var meta = h('p', { class: 'cz-lb-meta u-mono' });
    var note = h('p', { class: 'cz-lb-note' });
    var cap = h('div', { class: 'lightbox-cap cz-lb-cap' });
    cap.appendChild(title);
    cap.appendChild(meta);
    cap.appendChild(note);

    var fig = h('figure', { class: 'cz-lb-fig' });
    fig.appendChild(img);
    fig.appendChild(cap);

    var btnClose = h('button', { class: 'btn btn-ghost btn-sm cz-lb-close', type: 'button', 'aria-label': '关闭照片查看器' }, ['关闭']);
    var btnPrev = h('button', { class: 'btn btn-ghost cz-lb-nav is-prev', type: 'button', 'aria-label': '上一张照片' }, ['←']);
    var btnNext = h('button', { class: 'btn btn-ghost cz-lb-nav is-next', type: 'button', 'aria-label': '下一张照片' }, ['→']);

    root.appendChild(btnClose);
    root.appendChild(btnPrev);
    root.appendChild(fig);
    root.appendChild(btnNext);
    document.body.appendChild(root);

    lb = {
      root: root,
      img: img,
      title: title,
      meta: meta,
      note: note,
      btnPrev: btnPrev,
      btnNext: btnNext,
      btnClose: btnClose,
      items: [],
      i: 0,
      open: false,
      opener: null
    };

    btnClose.addEventListener('click', closeLightbox);
    btnPrev.addEventListener('click', function () { stepLightbox(-1); });
    btnNext.addEventListener('click', function () { stepLightbox(1); });
    img.addEventListener('error', function () {
      root.classList.add('is-miss');
      note.textContent = '图像暂时不可用。';
    });
    root.addEventListener('click', function (e) {
      if (e.target === root) closeLightbox();
    });

    // Esc / ← / →：只在灯箱打开时接管，避免和章节快捷键打架
    document.addEventListener('keydown', function (e) {
      if (!lb || !lb.open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        stepLightbox(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        stepLightbox(1);
      }
    }, true);

    // boot 在 Esc 时广播；灯箱打开时同样关闭
    COSMOS.on('cosmos:escape', function () {
      if (lb && lb.open) closeLightbox();
    });
  }

  function ensureLightbox() {
    if (!lb) buildLightbox();
    return lb;
  }

  function openLightbox(items, index, opener) {
    ensureLightbox();
    if (!items || !items.length) return;
    lb.items = items;
    lb.i = (index || 0) % items.length;
    lb.opener = opener || null;
    lb.open = true;
    lb.root.hidden = false;
    lb.root.setAttribute('aria-hidden', 'false');
    lb.root.classList.add('is-open');
    document.body.classList.add('has-lightbox');
    showLightboxItem(lb.i);
    if (lb.btnClose.focus) lb.btnClose.focus();
  }

  function showLightboxItem(i) {
    if (!lb || !lb.items.length) return;
    lb.i = (i + lb.items.length) % lb.items.length;
    var it = lb.items[lb.i];
    var meta = photoMeta(it.photo);
    lb.root.classList.remove('is-miss');
    lb.img.alt = it.title || '';
    lb.img.src = photoSrc(it.photo);
    lb.title.textContent = it.title || '';
    lb.meta.textContent = meta.telescope + (meta.year ? ' · ' + meta.year : '');
    lb.note.textContent = it.note || meta.note || '';
  }

  function stepLightbox(d) {
    if (!lb || !lb.open) return;
    showLightboxItem(lb.i + d);
  }

  function closeLightbox() {
    if (!lb || !lb.open) return;
    lb.open = false;
    lb.root.hidden = true;
    lb.root.setAttribute('aria-hidden', 'true');
    lb.root.classList.remove('is-open');
    document.body.classList.remove('has-lightbox');
    if (lb.opener && lb.opener.focus) lb.opener.focus();
  }

  // 灯箱列表项：{ photo, title, note }
  function photoItem(photo, title, note) {
    return { photo: photo, title: title, note: note || '' };
  }

  /* ============================================================
   * 三、08 星系动物园
   * ============================================================ */
  function registerGalaxies(el, content, section) {
    if (!el || el.querySelector('.cz-panel')) return;
    var GAL = D.galaxies || [];
    var TYPES = [
      { id: 'spiral', label: '螺旋' },
      { id: 'elliptical', label: '椭圆' },
      { id: 'irregular', label: '不规则' }
    ];

    COSMOS.state = COSMOS.state || {};
    var GS = COSMOS.state.galaxies = COSMOS.state.galaxies || { type: 'spiral' };
    if (GS.type !== 'elliptical' && GS.type !== 'irregular') GS.type = 'spiral';
    var curType = GS.type;

    function firstOf(type) {
      for (var i = 0; i < GAL.length; i++) if (GAL[i].type === type) return GAL[i];
      return null;
    }

    var galleryList = [];
    for (var gi = 0; gi < GAL.length; gi++) {
      if (GAL[gi].photo) {
        galleryList.push(photoItem(GAL[gi].photo, GAL[gi].name, GAL[gi].desc));
      }
    }

    /* ---- tabs ---- */
    var tabs = h('div', { class: 'tabs cz-tabs', role: 'tablist', 'aria-label': '星系类型' });
    var tabBtns = {};
    TYPES.forEach(function (t) {
      var b = h('button', {
        class: 'tab' + (t.id === curType ? ' is-on' : ''),
        type: 'button',
        role: 'tab',
        'aria-selected': t.id === curType ? 'true' : 'false',
        'data-type': t.id
      }, [t.label]);
      b.addEventListener('click', function () { setType(t.id); });
      tabs.appendChild(b);
      tabBtns[t.id] = b;
    });
    tabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      var idx = 0;
      for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === curType) idx = i;
      idx = (idx + (e.key === 'ArrowRight' ? 1 : TYPES.length - 1)) % TYPES.length;
      setType(TYPES[idx].id);
      tabBtns[TYPES[idx].id].focus();
    });

    /* ---- 代表星系 ---- */
    var featImg = h('img', { class: 'cz-feat-img', alt: '' });
    var featNoImg = h('div', { class: 'cz-noimg' }, ['暂无实拍照片']);
    var featName = h('h3', { class: 'cz-feat-name' });
    var featEn = h('p', { class: 'cz-feat-en u-mono' });
    var featMeta = h('p', { class: 'cz-feat-meta u-dim' });
    var featMedia = h('div', { class: 'cz-feat-media' });
    featMedia.appendChild(featImg);
    featMedia.appendChild(featNoImg);
    var featBtn = h('button', { class: 'cz-feat', type: 'button', 'aria-label': '查看代表星系照片' });
    featBtn.appendChild(featMedia);
    featBtn.appendChild(featName);
    featBtn.appendChild(featEn);
    featBtn.appendChild(featMeta);
    featBtn.addEventListener('click', function () {
      var g = firstOf(curType);
      if (!g || !g.photo) return;
      openLightbox(galleryList, findPhotoIndex(g.photo), featBtn);
    });
    featBtn.addEventListener('mouseenter', function () { featBtn.classList.add('is-hover'); });
    featBtn.addEventListener('mouseleave', function () { featBtn.classList.remove('is-hover'); });

    /* ---- 数据卡 ---- */
    var statDefs = [
      { key: 'form', label: '形态类型' },
      { key: 'diameter', label: '直径' },
      { key: 'stars', label: '恒星数量级（估算）' },
      { key: 'distance', label: '距离' }
    ];
    var statVals = {};
    var stats = h('div', { class: 'cz-stats' });
    statDefs.forEach(function (sd) {
      var v = h('span', { class: 'stat-v cz-stat-v' }, ['—']);
      statVals[sd.key] = v;
      var item = h('div', { class: 'stat cz-stat' });
      item.appendChild(h('span', { class: 'stat-l cz-stat-l' }, [sd.label]));
      item.appendChild(v);
      stats.appendChild(item);
    });

    /* ---- 画廊 ---- */
    var galleryHead = h('p', { class: 'cz-gallery-head' }, [
      '照片 · ' + galleryList.length,
      h('span', { class: 'u-dim' }, [' 点击查看大图'])
    ]);
    var gallery = h('div', { class: 'cz-gallery', role: 'group', 'aria-label': '星系照片画廊' });
    galleryList.forEach(function (it, idx) {
      var img = h('img', { src: photoSrc(it.photo), alt: it.title, loading: 'lazy' });
      var btn = h('button', {
        class: 'cz-thumb',
        type: 'button',
        title: it.title + ' · 打开大图',
        'aria-label': it.title + '，打开大图'
      });
      btn.appendChild(img);
      img.addEventListener('error', function () { btn.classList.add('is-miss'); });
      btn.addEventListener('click', function () { openLightbox(galleryList, idx, btn); });
      gallery.appendChild(btn);
    });

    var hint = h('p', { class: 'cz-hint' }, ['拖拽旋转星系模型 · 1 / 2 / 3 切换类型 · Esc 复位视角']);

    var panel = h('aside', { class: 'panel cz-panel cz-panel--galaxies', 'aria-label': '星系动物园控制面板' });
    panel.appendChild(tabs);
    panel.appendChild(featBtn);
    panel.appendChild(stats);
    panel.appendChild(galleryHead);
    panel.appendChild(gallery);
    panel.appendChild(hint);
    el.appendChild(panel);

    function setType(type) {
      if (type !== 'spiral' && type !== 'elliptical' && type !== 'irregular') return;
      GS.type = type;
      applyType(type);
    }

    function applyType(type) {
      if (type !== 'spiral' && type !== 'elliptical' && type !== 'irregular') return;
      curType = type;
      for (var i = 0; i < TYPES.length; i++) {
        var on = TYPES[i].id === type;
        tabBtns[TYPES[i].id].classList.toggle('is-on', on);
        tabBtns[TYPES[i].id].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      var g = firstOf(type);
      if (!g) {
        featImg.style.display = 'none';
        featNoImg.style.display = 'flex';
        featName.textContent = '暂无数据';
        featEn.textContent = '';
        featMeta.textContent = '';
        statVals.form.textContent = typeLabel(type);
        statVals.diameter.textContent = '—';
        statVals.stars.textContent = '—';
        statVals.distance.textContent = '—';
        return;
      }
      var meta = photoMeta(g.photo);
      if (g.photo) {
        featImg.style.display = 'block';
        featNoImg.style.display = 'none';
        featImg.src = photoSrc(g.photo);
        featImg.alt = g.name;
        featMeta.textContent = meta.telescope + (meta.year ? ' · ' + meta.year : '');
      } else {
        featImg.style.display = 'none';
        featImg.removeAttribute('src');
        featNoImg.style.display = 'flex';
        featMeta.textContent = '这一类没有可用实拍照片，几何形态请看 3D 模型';
      }
      featName.textContent = g.name;
      featEn.textContent = g.en;
      featBtn.setAttribute('aria-label', g.photo ? ('查看 ' + g.name + ' 的照片') : (g.name + '（暂无照片）'));
      featBtn.disabled = !g.photo;
      statVals.form.textContent = typeLabel(g.type);
      statVals.diameter.textContent = g.diameterLy || '—';
      statVals.stars.textContent = g.stars || '—';
      statVals.distance.textContent = g.distanceLy || '—';
    }

    function findPhotoIndex(photo) {
      for (var i = 0; i < galleryList.length; i++) if (galleryList[i].photo === photo) return i;
      return 0;
    }

    // 场景侧键盘切换类型时同步 tabs
    COSMOS.on('galaxies:type', function (e) {
      if (e && e.type && e.type !== curType) applyType(e.type);
    });

    applyType(curType);
    return {};
  }

  /* ============================================================
   * 四、09 极端宇宙
   * ============================================================ */
  function registerExtreme(el, content, section) {
    if (!el || el.querySelector('.cz-panel')) return;

    COSMOS.state = COSMOS.state || {};
    var EX = COSMOS.state.extreme = COSMOS.state.extreme || {};
    if (EX.mode !== 'darkmatter' && EX.mode !== 'darkenergy') EX.mode = 'gravity';
    if (!isFinite(EX.strain)) EX.strain = 1e-21;
    if (!isFinite(EX.scaleFactor)) EX.scaleFactor = 1;
    if (!isFinite(EX.dmMass)) EX.dmMass = 2.0;
    if (EX.dmHalo === undefined) EX.dmHalo = true;
    if (EX.dmLens === undefined) EX.dmLens = true;
    var curMode = EX.mode;

    var MODES = [
      { id: 'gravity', label: '引力波' },
      { id: 'darkmatter', label: '暗物质' },
      { id: 'darkenergy', label: '暗能量' }
    ];

    var photoList = [
      photoItem('deep-gravwave', '双黑洞并合示意', ''),
      photoItem('deep-darkmatter', '暗物质晕示意', ''),
      photoItem('deep-darkenergy', '暗能量与膨胀宇宙示意', ''),
      photoItem('deep-quasar', '类星体示意', '')
    ];

    /* ---- tabs ---- */
    var tabs = h('div', { class: 'tabs cz-tabs', role: 'tablist', 'aria-label': '极端宇宙模式' });
    var tabBtns = {};
    MODES.forEach(function (m) {
      var b = h('button', {
        class: 'tab' + (m.id === curMode ? ' is-on' : ''),
        type: 'button',
        role: 'tab',
        'aria-selected': m.id === curMode ? 'true' : 'false',
        'data-mode': m.id
      }, [m.label]);
      b.addEventListener('click', function () { setMode(m.id); });
      tabs.appendChild(b);
      tabBtns[m.id] = b;
    });
    tabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      var idx = 0;
      for (var i = 0; i < MODES.length; i++) if (MODES[i].id === curMode) idx = i;
      idx = (idx + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length;
      setMode(MODES[idx].id);
      tabBtns[MODES[idx].id].focus();
    });

    /* ---- 三个模式块叠在同一个容器里，切换只改透明度 + 容器高度 ---- */
    var stack = h('div', { class: 'cz-modes' });

    /* ---- 读数（来自 COSMOS.DATA.deepObjects） ---- */
    function readoutBlock(id) {
      var box = h('dl', { class: 'cz-readout' });
      var obj = (D.deepById ? D.deepById(id) : null);
      if (!obj || !obj.stats) return box;
      obj.stats.forEach(function (s) {
        var row = h('div', { class: 'cz-readout-row' });
        row.appendChild(h('dt', { class: 'cz-readout-l u-dim' }, [s.label]));
        row.appendChild(h('dd', { class: 'cz-readout-v u-mono' }, [s.value]));
        box.appendChild(row);
      });
      return box;
    }

    /* ============ 模式 1：引力波 ============ */
    var gravityBlock = h('div', { class: 'cz-mode', 'data-mode': 'gravity' });
    var strainSlider = h('input', {
      class: 'range cz-range', type: 'range',
      min: '0', max: '1000', step: '1',
      value: String(strainToSlider(EX.strain)),
      'aria-label': '引力波应变（对数刻度，1e-22 到 1e-18）'
    });
    var strainOut = h('span', { class: 'cz-range-val u-mono', 'aria-live': 'polite' });
    var strainRow = h('div', { class: 'range-row cz-range-row' });
    strainRow.appendChild(h('span', { class: 'cz-range-label' }, ['应变 h']));
    strainRow.appendChild(strainSlider);
    strainRow.appendChild(strainOut);
    strainSlider.addEventListener('input', function () {
      EX.strain = sliderToStrain(Number(strainSlider.value));
      updateStrainOut();
    });
    gravityBlock.appendChild(strainRow);
    gravityBlock.appendChild(h('p', { class: 'cz-range-note u-dim' }, ['LIGO 的干涉臂长 4 公里；应变 1e-21 时，臂长变化约为 4 × 10⁻¹⁸ 米，不到质子直径的千分之一。']));
    gravityBlock.appendChild(readoutBlock('gravwave'));
    gravityBlock.appendChild(photoButton('deep-gravwave', '引力波：双黑洞并合示意'));
    gravityBlock.appendChild(h('p', { class: 'cz-note' }, ['这意味着什么：时空不是静止的舞台，它会被加速的质量扰动，并以光速把形变传出去。2015 年 9 月 14 日，LIGO 第一次直接"听"到了 13 亿光年外两个黑洞的并合。']));

    /* ============ 模式 2：暗物质 ============ */
    var dmBlock = h('div', { class: 'cz-mode', 'data-mode': 'darkmatter' });

    // ---- M200 质量滑杆（NFW 晕质量，单位 10^12 太阳质量）----
    var massSlider = h('input', {
      class: 'range cz-range', type: 'range',
      min: '0.6', max: '3.0', step: '0.05',
      value: String(EX.dmMass),
      'aria-label': '暗物质晕质量 M200，单位 10 的 12 次方太阳质量'
    });
    var massOut = h('span', { class: 'cz-range-val u-mono', 'aria-live': 'polite' });
    var massRow = h('div', { class: 'range-row cz-range-row' });
    massRow.appendChild(h('span', { class: 'cz-range-label' }, ['M200']));
    massRow.appendChild(massSlider);
    massRow.appendChild(massOut);

    var vOutRow = h('div', { class: 'cz-param-line' });
    vOutRow.appendChild(h('span', { class: 'cz-param-k u-dim' }, ['30 kpc 处预测速度']));
    var vOut = h('span', { class: 'cz-param-v u-mono', 'aria-live': 'polite' }, ['—']);
    vOutRow.appendChild(vOut);

    var curve = buildRotationCurve();
    massSlider.addEventListener('input', function () {
      EX.dmMass = Number(massSlider.value);
      updateDmReadout();
    });

    dmBlock.appendChild(massRow);
    dmBlock.appendChild(vOutRow);
    dmBlock.appendChild(h('p', { class: 'cz-range-note u-dim' }, ['M200 是晕内平均密度达到宇宙临界密度 200 倍的那个球体内的质量。滑杆改变暗物质晕的大小与质量，蓝色曲线是它单独能给出的旋转速度。']));

    // ---- 两个开关：晕 / 透镜弧 ----
    var toggleRow = h('div', { class: 'cz-toggle-row' });
    var haloBtn = h('button', {
      class: 'btn btn-sm cz-toggle', type: 'button',
      'aria-pressed': EX.dmHalo ? 'true' : 'false'
    }, ['暗物质晕']);
    haloBtn.addEventListener('click', function () {
      EX.dmHalo = !EX.dmHalo;
      syncToggles();
    });
    var lensBtn = h('button', {
      class: 'btn btn-sm cz-toggle', type: 'button',
      'aria-pressed': EX.dmLens ? 'true' : 'false'
    }, ['引力透镜弧']);
    lensBtn.addEventListener('click', function () {
      EX.dmLens = !EX.dmLens;
      syncToggles();
    });
    toggleRow.appendChild(haloBtn);
    toggleRow.appendChild(lensBtn);
    dmBlock.appendChild(toggleRow);
    dmBlock.appendChild(h('p', { class: 'cz-range-note u-dim' }, ['关掉晕：画面里只剩恒星和气体，但外围恒星仍转得太快；关掉透镜弧：那些被拉长的背景星系也一起消失——两者都是暗物质存在的间接证据。']));

    dmBlock.appendChild(curve.wrap);
    dmBlock.appendChild(h('div', { class: 'legend cz-legend cz-legend-col' }, [
      legendItem('观测：外围速度几乎不变', 'obs'),
      legendItem('可见物质：按牛顿引力应下降', 'vis'),
      legendItem('NFW 暗物质晕：单独给出的速度', 'nfw')
    ]));
    dmBlock.appendChild(readoutBlock('darkmatter'));
    dmBlock.appendChild(photoButton('deep-darkmatter', '暗物质晕示意'));
    dmBlock.appendChild(h('p', { class: 'cz-note' }, ['这意味着什么：星系转得太快，可见物质的引力拉不住外围恒星，必须存在大量不发光、也不与光作用的物质。它占宇宙总能量的 26.8%，但本质仍是未解问题。']));

    /* ============ 模式 3：暗能量 ============ */
    var deBlock = h('div', { class: 'cz-mode', 'data-mode': 'darkenergy' });
    var aSlider = h('input', {
      class: 'range cz-range', type: 'range',
      min: '1', max: '3', step: '0.01',
      value: String(EX.scaleFactor),
      'aria-label': '宇宙尺度因子 a（1 到 3）'
    });
    var aOut = h('span', { class: 'cz-range-val u-mono', 'aria-live': 'polite' });
    var aRow = h('div', { class: 'range-row cz-range-row' });
    aRow.appendChild(h('span', { class: 'cz-range-label' }, ['尺度 a']));
    aRow.appendChild(aSlider);
    aRow.appendChild(aOut);
    aSlider.addEventListener('input', function () {
      EX.scaleFactor = Number(aSlider.value);
      updateAOut();
    });
    deBlock.appendChild(aRow);

    var aOutRow = h('div', { class: 'cz-param-line' });
    aOutRow.appendChild(h('span', { class: 'cz-param-k u-dim' }, ['膨胀速率 ȧ / H₀']));
    var aRateOut = h('span', { class: 'cz-param-v u-mono', 'aria-live': 'polite' }, ['—']);
    aOutRow.appendChild(aRateOut);

    var expCurve = buildExpansionCurve();
    deBlock.appendChild(aOutRow);
    deBlock.appendChild(expCurve.wrap);
    deBlock.appendChild(h('div', { class: 'legend cz-legend cz-legend-col' }, [
      legendItem('物质主导：膨胀被引力拖慢', 'slow'),
      legendItem('暗能量主导：膨胀开始加速', 'acc')
    ]));
    deBlock.appendChild(h('p', { class: 'cz-formula u-mono', html: 'v = H<sub>0</sub> × d&nbsp;&nbsp;&nbsp;H<sub>0</sub> ≈ 70 km/s/Mpc' }));
    deBlock.appendChild(h('p', { class: 'cz-range-note u-dim' }, ['拖动尺度因子：所有星系随空间一起外移，越远的点退行越快——这正是哈勃定律。曲线是同一套宇宙学参数算出的膨胀速率，圆点标出当前 a。']));
    deBlock.appendChild(readoutBlock('darkenergy'));
    deBlock.appendChild(photoButton('deep-darkenergy', '暗能量与加速膨胀示意'));
    deBlock.appendChild(h('p', { class: 'cz-note' }, ['这意味着什么：1998 年，两组天文学家通过 Ia 型超新星发现宇宙膨胀在加速。把这一加速归因于"暗能量"，占宇宙总能量的 68.3%；它究竟是什么，仍是当代物理学最大的问号之一。']));

    var hint = h('p', { class: 'cz-hint' }, ['拖拽旋转视角 · 滚轮缩放 · 1 / 2 / 3 切换模式 · Esc 复位']);

    stack.appendChild(gravityBlock);
    stack.appendChild(dmBlock);
    stack.appendChild(deBlock);

    var panel = h('aside', { class: 'panel cz-panel cz-panel--extreme', 'aria-label': '极端宇宙控制面板' });
    panel.appendChild(tabs);
    panel.appendChild(stack);
    panel.appendChild(hint);
    el.appendChild(panel);

    /* ---------------- 按钮 / 图片 ---------------- */
    function photoButton(photo, label) {
      var img = h('img', { class: 'cz-photo-img', src: photoSrc(photo), alt: label, loading: 'lazy' });
      var btn = h('button', { class: 'cz-photo', type: 'button', 'aria-label': label + '，打开大图' });
      btn.appendChild(img);
      img.addEventListener('error', function () { btn.classList.add('is-miss'); });
      btn.addEventListener('click', function () {
        var idx = 0;
        for (var i = 0; i < photoList.length; i++) if (photoList[i].photo === photo) idx = i;
        openLightbox(photoList, idx, btn);
      });
      btn.appendChild(h('span', { class: 'cz-photo-meta u-mono' }, [photoMeta(photo).telescope]));
      return btn;
    }

    function legendItem(text, kind) {
      var it = h('span', { class: 'legend-item cz-legend-item' });
      it.appendChild(h('span', { class: 'cz-legend-swatch is-' + kind, 'aria-hidden': 'true' }));
      it.appendChild(document.createTextNode(text));
      return it;
    }

    /* ---------------- 读数 ---------------- */
    function strainToSlider(s) {
      var v = isFinite(s) ? Math.max(1e-22, Math.min(1e-18, s)) : 1e-21;
      return Math.round((Math.log(v) / Math.LN10 + 22) / 4 * 1000);
    }
    function sliderToStrain(v) {
      return Math.pow(10, -22 + (v / 1000) * 4);
    }
    function updateStrainOut() {
      var s = EX.strain;
      var exp = Math.round(Math.log(s) / Math.LN10);
      var mant = s / Math.pow(10, exp);
      strainOut.innerHTML = mant.toFixed(1) + ' × 10<sup>' + exp + '</sup>';
      strainOut.setAttribute('aria-label', mant.toFixed(1) + ' 乘 10 的 ' + exp + ' 次方');
    }
    function updateAOut() {
      var a = Number(EX.scaleFactor);
      aOut.textContent = 'a = ' + a.toFixed(2);
      aOut.setAttribute('aria-label', '尺度因子 ' + a.toFixed(2));
      aRateOut.textContent = expCurve.update(a).toFixed(2);
    }
    function updateDmReadout() {
      var m = Number(EX.dmMass);
      massOut.innerHTML = m.toFixed(2) + ' × 10<sup>12</sup>';
      massOut.setAttribute('aria-label', m.toFixed(2) + ' 乘 10 的 12 次方太阳质量');
      vOut.textContent = curve.update(m).toFixed(0) + ' km/s';
    }
    function syncToggles() {
      haloBtn.textContent = '暗物质晕：' + (EX.dmHalo ? '显示' : '隐藏');
      haloBtn.setAttribute('aria-pressed', EX.dmHalo ? 'true' : 'false');
      lensBtn.textContent = '引力透镜弧：' + (EX.dmLens ? '显示' : '隐藏');
      lensBtn.setAttribute('aria-pressed', EX.dmLens ? 'true' : 'false');
    }

    function syncControls() {
      EX.strain = isFinite(EX.strain) ? Math.max(1e-22, Math.min(1e-18, EX.strain)) : 1e-21;
      EX.scaleFactor = isFinite(EX.scaleFactor) ? Math.max(1, Math.min(3, EX.scaleFactor)) : 1;
      EX.dmMass = isFinite(EX.dmMass) ? Math.max(0.6, Math.min(3, EX.dmMass)) : 2.0;
      strainSlider.value = String(strainToSlider(EX.strain));
      aSlider.value = String(EX.scaleFactor);
      massSlider.value = String(EX.dmMass);
      updateStrainOut();
      updateAOut();
      updateDmReadout();
      syncToggles();
    }

    /* ---------------- 模式切换 ---------------- */
    function blockOf(mode) {
      if (mode === 'darkmatter') return dmBlock;
      if (mode === 'darkenergy') return deBlock;
      return gravityBlock;
    }

    function syncStackHeight(animate) {
      var b = blockOf(curMode);
      var target = b ? b.offsetHeight : 0;
      if (!animate) {
        stack.style.transition = 'none';
        stack.style.height = target + 'px';
        void stack.offsetHeight;
        stack.style.transition = '';
        return;
      }
      var cur = stack.offsetHeight;
      stack.style.transition = 'none';
      stack.style.height = cur + 'px';
      void stack.offsetHeight;
      stack.style.transition = '';
      stack.style.height = target + 'px';
    }

    function applyMode(mode) {
      curMode = mode;
      for (var i = 0; i < MODES.length; i++) {
        var on = MODES[i].id === mode;
        tabBtns[MODES[i].id].classList.toggle('is-on', on);
        tabBtns[MODES[i].id].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      var blocks = stack.querySelectorAll('.cz-mode');
      for (var j = 0; j < blocks.length; j++) {
        blocks[j].classList.toggle('is-on', blocks[j].getAttribute('data-mode') === mode);
      }
      syncStackHeight(true);
    }

    function setMode(mode) {
      if (mode !== 'gravity' && mode !== 'darkmatter' && mode !== 'darkenergy') return;
      if (mode === curMode) return;
      EX.mode = mode;
      applyMode(mode);
    }

    COSMOS.on('extreme:mode', function (e) {
      if (e && e.mode && e.mode !== curMode) applyMode(e.mode);
    });
    COSMOS.on('extreme:reset', function () {
      applyMode(EX.mode);
      syncControls();
    });

    // 字体 / 布局稳定后校准一次高度；窗口尺寸变化时重算
    var rafH = 0;
    function relayout() {
      if (rafH) cancelAnimationFrame(rafH);
      rafH = requestAnimationFrame(function () {
        rafH = 0;
        syncStackHeight(false);
      });
    }
    window.addEventListener('resize', relayout);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { relayout(); });
    }

    syncControls();
    applyMode(curMode);
    relayout();
    return {};
  }

  /* ============================================================
   * 暗物质：旋转曲线（观测 / 可见物质 / NFW 预测）
   * 横轴 0–30 kpc，纵轴 0–300 km/s；NFW 曲线随 M200 更新。
   * ============================================================ */
  function buildRotationCurve() {
    var x0 = 42, x1 = 302, y0 = 148, y1 = 16;
    var rMax = 30, vMax = 300;
    var G_PC = 4.3009e-3; // pc·(km/s)² / M☉

    function sx(r) { return x0 + (r / rMax) * (x1 - x0); }
    function sy(v) { return y0 - (v / vMax) * (y0 - y1); }

    function nfwV(r, m12) {
      var r200 = 205 * Math.pow(m12, 1 / 3);   // kpc
      var c = 10;
      var x = r / r200;
      if (x < 1e-5) return 0;
      var fC = Math.log(1 + c) - c / (1 + c);
      var cx = c * x;
      var fX = Math.log(1 + cx) - cx / (1 + cx);
      var v200 = Math.sqrt(G_PC * (m12 * 1e12) / (r200 * 1000));
      return v200 * Math.sqrt(fX / (fC * x));
    }

    var obs = [], vis = [], grid = '', k, r;
    for (r = 1; r <= rMax + 0.01; r += 0.6) {
      var vObs = 222 * (1 - Math.exp(-r / 2.3));
      var vVis = 228 * Math.sqrt(Math.min(r, 4.5) / 4.5) * (r > 4.5 ? Math.sqrt(4.5 / r) : 1);
      obs.push(sx(r).toFixed(1) + ',' + sy(vObs).toFixed(1));
      vis.push(sx(r).toFixed(1) + ',' + sy(vVis).toFixed(1));
    }
    for (k = 100; k <= 300; k += 100) {
      grid += '<line x1="' + x0 + '" y1="' + sy(k).toFixed(1) + '" x2="' + x1 + '" y2="' + sy(k).toFixed(1) + '"/>';
      grid += '<text x="' + (x0 - 5) + '" y="' + (sy(k) + 3).toFixed(1) + '" text-anchor="end">' + k + '</text>';
    }
    for (k = 10; k <= 30; k += 10) {
      grid += '<line x1="' + sx(k).toFixed(1) + '" y1="' + y1 + '" x2="' + sx(k).toFixed(1) + '" y2="' + y0 + '"/>';
      grid += '<text x="' + sx(k).toFixed(1) + '" y="' + (y0 + 13) + '" text-anchor="middle">' + k + '</text>';
    }

    var svg =
      '<svg class="cz-curve" viewBox="0 0 320 178" role="img" ' +
      'aria-label="星系旋转曲线：观测速度在外围保持平坦；可见物质单独产生的速度随半径下降；NFW 暗物质晕的预测速度随晕质量上升">' +
      '<g class="cz-curve-grid" aria-hidden="true">' + grid + '</g>' +
      '<line class="axis" x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y0 + '"/>' +
      '<line class="axis" x1="' + x0 + '" y1="' + y1 + '" x2="' + x0 + '" y2="' + y0 + '"/>' +
      '<polyline class="cz-curve-vis" points="' + vis.join(' ') + '"/>' +
      '<polyline class="cz-curve-nfw" data-role="nfw" points=""/>' +
      '<polyline class="cz-curve-obs" points="' + obs.join(' ') + '"/>' +
      '<text class="cz-curve-ax" x="' + ((x0 + x1) / 2) + '" y="174" text-anchor="middle">半径（kpc）</text>' +
      '<text class="cz-curve-ax" x="' + (x0 - 2) + '" y="10" text-anchor="middle">km/s</text>' +
      '</svg>';

    var wrap = h('div', { class: 'cz-curve-wrap' });
    wrap.innerHTML = svg;
    var nfwEl = wrap.querySelector('[data-role="nfw"]');

    function update(m12) {
      var m = isFinite(m12) ? Math.max(0.2, Math.min(6, m12)) : 2;
      var pts = [], rr;
      for (rr = 0.8; rr <= rMax + 0.01; rr += 0.6) {
        var v = Math.min(nfwV(rr, m), vMax);
        pts.push(sx(rr).toFixed(1) + ',' + sy(v).toFixed(1));
      }
      nfwEl.setAttribute('points', pts.join(' '));
      return nfwV(rMax, m);
    }

    update((COSMOS.state.extreme || {}).dmMass || 2);
    return { wrap: wrap, update: update };
  }

  /* ============================================================
   * 暗能量：膨胀速率 ȧ/H0 随尺度因子 a 的变化
   * Ωm = 0.317、ΩΛ = 0.683（Planck 2018，见 js/data.js）
   * ============================================================ */
  function buildExpansionCurve() {
    var x0 = 42, x1 = 302, y0 = 148, y1 = 16;
    var aMax = 3, hMax = 3;
    var OM = 0.317, OL = 0.683;

    function sx(a) { return x0 + (a / aMax) * (x1 - x0); }
    function sy(h) { return y0 - (Math.min(h, hMax) / hMax) * (y0 - y1); }
    function rate(a) { return Math.sqrt(OM / a + OL * a * a); }

    var pts = [], grid = '', a;
    for (a = 0.28; a <= aMax + 0.001; a += 0.04) {
      pts.push(sx(a).toFixed(1) + ',' + sy(rate(a)).toFixed(1));
    }
    var k;
    for (k = 1; k <= 2; k++) {
      grid += '<line x1="' + x0 + '" y1="' + sy(k).toFixed(1) + '" x2="' + x1 + '" y2="' + sy(k).toFixed(1) + '"/>';
      grid += '<text x="' + (x0 - 5) + '" y="' + (sy(k) + 3).toFixed(1) + '" text-anchor="end">' + k + '</text>';
    }
    for (k = 1; k <= 3; k++) {
      grid += '<line x1="' + sx(k).toFixed(1) + '" y1="' + y1 + '" x2="' + sx(k).toFixed(1) + '" y2="' + y0 + '"/>';
      grid += '<text x="' + sx(k).toFixed(1) + '" y="' + (y0 + 13) + '" text-anchor="middle">' + k + '</text>';
    }

    var svg =
      '<svg class="cz-curve" viewBox="0 0 320 178" role="img" ' +
      'aria-label="膨胀速率随尺度因子的变化：物质主导期膨胀被拖慢，暗能量主导后转为加速">' +
      '<g class="cz-curve-grid" aria-hidden="true">' + grid + '</g>' +
      '<line class="axis" x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y0 + '"/>' +
      '<line class="axis" x1="' + x0 + '" y1="' + y1 + '" x2="' + x0 + '" y2="' + y0 + '"/>' +
      '<polyline class="cz-curve-acc" points="' + pts.join(' ') + '"/>' +
      '<circle class="cz-curve-dot" data-role="dot" r="3" cx="' + sx(1).toFixed(1) + '" cy="' + sy(rate(1)).toFixed(1) + '"/>' +
      '<text class="cz-curve-ax" x="' + ((x0 + x1) / 2) + '" y="174" text-anchor="middle">尺度因子 a</text>' +
      '<text class="cz-curve-ax" x="' + (x0 - 2) + '" y="10" text-anchor="middle">ȧ / H₀</text>' +
      '</svg>';

    var wrap = h('div', { class: 'cz-curve-wrap' });
    wrap.innerHTML = svg;
    var dotEl = wrap.querySelector('[data-role="dot"]');

    function update(a) {
      var v = isFinite(a) ? Math.max(1, Math.min(3, a)) : 1;
      dotEl.setAttribute('cx', sx(v).toFixed(1));
      dotEl.setAttribute('cy', sy(rate(v)).toFixed(1));
      return rate(v);
    }

    update((COSMOS.state.extreme || {}).scaleFactor || 1);
    return { wrap: wrap, update: update };
  }

  COSMOS.registerWidget('galaxies', registerGalaxies);
  COSMOS.registerWidget('extreme', registerExtreme);

})(window.COSMOS = window.COSMOS || {});
