/* ============================================================
 * COSMOS ATLAS · js/feat-sky.js
 * 02 太阳系 · “今晚天空”模态（#sol-sky）
 *
 * 契约（artifacts/p1-contract.md §6）：
 *   - role="dialog" aria-modal="true"，遮罩 / × / Esc 关闭，焦点陷阱
 *   - 地点：13 个预设城市 + 自定义经纬度（-90..90 / -180..180 校验）
 *   - 时间：默认 COSMOS.state.solar.timeMs；显示 UTC + 当地时；「用现在」
 *   - 2D 地平线图（canvas，按 devicePixelRatio 绘制）：北上、东左、天顶中心
 *   - 数据表：黄经 / 顺逆行 / 高度角 / 方位角；Moon 行附月相、照亮比例、月龄
 *   - 导出 JSON（Blob + a[download]，零网络）
 *   - 暴露 COSMOS.solarLab.openSky（close 由两个模态共用注册）
 *
 * 依赖：COSMOS.ephem（并行实现；缺失时显示“星历未载入”，不抛异常、不改 ephem.js）
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
  var DEG = Math.PI / 180;

  /* ---------------- 地点 ---------------- */
  var CITIES = [
    { key: 'beijing', zh: '北京', en: 'Beijing', lat: 39.9042, lon: 116.4074 },
    { key: 'shanghai', zh: '上海', en: 'Shanghai', lat: 31.2304, lon: 121.4737 },
    { key: 'guangzhou', zh: '广州', en: 'Guangzhou', lat: 23.1291, lon: 113.2644 },
    { key: 'shenzhen', zh: '深圳', en: 'Shenzhen', lat: 22.5431, lon: 114.0579 },
    { key: 'chengdu', zh: '成都', en: 'Chengdu', lat: 30.5728, lon: 104.0668 },
    { key: 'xian', zh: '西安', en: "Xi'an", lat: 34.3416, lon: 108.9398 },
    { key: 'urumqi', zh: '乌鲁木齐', en: 'Urumqi', lat: 43.8256, lon: 87.6168 },
    { key: 'hongkong', zh: '香港', en: 'Hong Kong', lat: 22.3193, lon: 114.1694 },
    { key: 'taipei', zh: '台北', en: 'Taipei', lat: 25.0330, lon: 121.5654 },
    { key: 'tokyo', zh: '东京', en: 'Tokyo', lat: 35.6762, lon: 139.6503 },
    { key: 'london', zh: '伦敦', en: 'London', lat: 51.5074, lon: -0.1278 },
    { key: 'newyork', zh: '纽约', en: 'New York', lat: 40.7128, lon: -74.0060 },
    { key: 'losangeles', zh: '洛杉矶', en: 'Los Angeles', lat: 34.0522, lon: -118.2437 }
  ];

  var PLANET_COLORS = {
    mercury: '#9C8F84', venus: '#D9B382', earth: '#2E6FBF', mars: '#C1440E',
    jupiter: '#C9A88E', saturn: '#E3CFA8', uranus: '#A8D8DE', neptune: '#3C63D1'
  };

  function planetName(id) {
    var list = DATA.planets || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return { zh: list[i].name, en: list[i].en || list[i].name };
    }
    return { zh: id, en: id };
  }

  /* 观测天体：太阳、月球、除地球外的 7 颗行星（地球是观测点本身） */
  function buildBodies() {
    var out = [
      { id: 'sun', zh: '太阳', en: 'Sun', kind: 'sun', color: '#FFFFFF' },
      { id: 'moon', zh: '月球', en: 'Moon', kind: 'moon', color: '#D1D1D1' }
    ];
    (DATA.planets || []).forEach(function (p) {
      if (!p || p.id === 'earth') return;
      out.push({
        id: p.id,
        zh: p.name,
        en: p.en || p.id,
        kind: 'planet',
        color: p.color || PLANET_COLORS[p.id] || '#D1D1D1'
      });
    });
    if (out.length === 2) {
      ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].forEach(function (id) {
        out.push({
          id: id,
          zh: planetName(id).zh,
          en: planetName(id).en,
          kind: 'planet',
          color: PLANET_COLORS[id]
        });
      });
    }
    return out;
  }

  var BODIES = buildBodies();

  var MOON_PHASES = {
    new: { zh: '新月', en: 'New Moon' },
    waxingCrescent: { zh: '蛾眉月', en: 'Waxing Crescent' },
    firstQuarter: { zh: '上弦月', en: 'First Quarter' },
    waxingGibbous: { zh: '盈凸月', en: 'Waxing Gibbous' },
    full: { zh: '满月', en: 'Full Moon' },
    waningGibbous: { zh: '亏凸月', en: 'Waning Gibbous' },
    lastQuarter: { zh: '下弦月', en: 'Last Quarter' },
    waningCrescent: { zh: '残月', en: 'Waning Crescent' }
  };

  function phaseNameFrom(illum, waxing) {
    var i = isFinite(illum) ? illum : 0;
    if (i < 0.045) return 'new';
    if (i > 0.955) return 'full';
    if (waxing) return i < 0.45 ? 'waxingCrescent' : (i < 0.55 ? 'firstQuarter' : 'waxingGibbous');
    return i > 0.55 ? 'waningGibbous' : (i > 0.45 ? 'lastQuarter' : 'waningCrescent');
  }

  /* ---------------- 状态 ---------------- */
  var ui = null;
  var open = false;
  var prevFocus = null;
  var savedPaused = null;
  var hasSaved = false;

  var loc = { name: null, lat: CITIES[0].lat, lon: CITIES[0].lon };
  loc.name = T(CITIES[0].zh, CITIES[0].en);

  var timeMs = NaN;
  var rows = [];
  var moonInfo = null;
  var calcError = '';
  var computing = false;
  var computeToken = 0;
  var drawRaf = 0;
  var ro = null;
  var showEcliptic = true;
  var showGalactic = false;
  var eclPts = null;
  var galPts = [];

  /* ---------------- 小工具 ---------------- */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function fmtUtc(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '—';
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
      ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }

  function tzOffsetHours() {
    return Math.round((loc.lon || 0) / 15);
  }

  function fmtLocal(ms) {
    var off = tzOffsetHours();
    var sign = off >= 0 ? '+' : '-';
    return fmtUtc(ms + off * 3600000) + ' UTC' + sign + Math.abs(off) + '（' +
      T('按经度估算', 'estimated by longitude') + '）';
  }

  function solarState() {
    var S = COSMOS.state || (COSMOS.state = {});
    var st = S.solar || (S.solar = {});
    return st;
  }

  function currentTimeMs() {
    if (typeof timeMs === 'number' && isFinite(timeMs)) return timeMs;
    return Date.now();
  }

  function jdNow() {
    var ep = COSMOS.ephem;
    if (ep && typeof ep.jdFromMs === 'function') {
      var v = ep.jdFromMs(currentTimeMs());
      if (isFinite(v)) return v;
    }
    return currentTimeMs() / DAY_MS + JD_UNIX_EPOCH;
  }

  /* ---------------- 星历计算 ---------------- */
  function bodyGeo(id, jd) {
    var ep = COSMOS.ephem;
    if (!ep) return null;
    try {
      if (id === 'sun' && typeof ep.sunGeo === 'function') {
        var s = ep.sunGeo(jd);
        if (!s) return null;
        return { lon: s.lon, lat: isFinite(s.lat) ? s.lat : 0, ra: s.ra, dec: s.dec };
      }
      if (id === 'moon' && typeof ep.moonGeo === 'function') {
        var m = ep.moonGeo(jd);
        if (!m) return null;
        return { lon: m.lon, lat: isFinite(m.lat) ? m.lat : 0, ra: m.ra, dec: m.dec };
      }
      if (typeof ep.planet !== 'function' || typeof ep.eclToEq !== 'function') return null;
      var earth = null;
      if (typeof ep.earth === 'function') earth = ep.earth(jd);
      else if (typeof ep.planet === 'function') earth = ep.planet('earth', jd);
      var p = ep.planet(id, jd);
      if (!earth || !p) return null;
      var x = p.x - earth.x, y = p.y - earth.y, z = p.z - earth.z;
      var r = Math.sqrt(x * x + y * y + z * z);
      if (!isFinite(r) || r <= 0) return null;
      var lon = Math.atan2(y, x) / DEG;
      var lat = Math.asin(Math.max(-1, Math.min(1, z / r))) / DEG;
      var eq = ep.eclToEq(lon, lat, jd);
      if (!eq) return null;
      return { lon: lon, lat: lat, ra: eq.ra, dec: eq.dec };
    } catch (err) {
      return null;
    }
  }

  function altAzOf(geo, jd) {
    var ep = COSMOS.ephem;
    if (!geo || !ep || typeof ep.eqToAltAz !== 'function') return null;
    try {
      var aa = ep.eqToAltAz(geo.ra, geo.dec, jd, loc.lat, loc.lon);
      if (!aa || !isFinite(aa.alt) || !isFinite(aa.az)) return null;
      return { alt: aa.alt, az: ((aa.az % 360) + 360) % 360 };
    } catch (err) {
      return null;
    }
  }

  function normLonDiff(a, b) {
    var d = ((b - a + 540) % 360) - 180;
    return d;
  }

  function computeSky() {
    var ep = COSMOS.ephem;
    if (!ep || typeof ep.eqToAltAz !== 'function' || typeof ep.eclToEq !== 'function') {
      calcError = 'missing';
      return;
    }
    var jd = jdNow();
    var list = [];

    for (var i = 0; i < BODIES.length; i++) {
      var b = BODIES[i];
      var geo = bodyGeo(b.id, jd);
      if (!geo) continue;
      var aa = altAzOf(geo, jd);
      var l1 = bodyGeo(b.id, jd - 1);
      var l2 = bodyGeo(b.id, jd + 1);
      var retro = false;
      if (l1 && l2 && isFinite(l1.lon) && isFinite(l2.lon)) {
        retro = normLonDiff(l1.lon, l2.lon) < 0;
      }
      list.push({
        id: b.id,
        zh: b.zh,
        en: b.en,
        kind: b.kind,
        color: b.color,
        lon: geo.lon,
        lat: geo.lat,
        ra: geo.ra,
        dec: geo.dec,
        alt: aa ? aa.alt : NaN,
        az: aa ? aa.az : NaN,
        retrograde: retro,
        above: !!(aa && aa.alt > 0)
      });
    }
    rows = list;

    /* 月相：优先 moonPhase，其次 moonGeo 自带字段，最后按照亮比例估算 */
    var mp = null;
    try {
      mp = typeof ep.moonPhase === 'function' ? ep.moonPhase(jd) : null;
    } catch (err) { mp = null; }
    var mg = null;
    try {
      mg = typeof ep.moonGeo === 'function' ? ep.moonGeo(jd) : null;
    } catch (err2) { mg = null; }
    var illum = mp && isFinite(mp.illum) ? mp.illum : (mg && isFinite(mg.illum) ? mg.illum : NaN);
    var age = mp && isFinite(mp.ageDays) ? mp.ageDays : (mg && isFinite(mg.ageDays) ? mg.ageDays : NaN);
    var waxing = mp && typeof mp.waxing === 'boolean' ? mp.waxing :
      (mg && typeof mg.waxing === 'boolean' ? mg.waxing : true);
    var phaseKey = (mp && mp.phaseName) || (mg && mg.phaseName) || null;
    var phaseZh = '', phaseEn = '';
    if (phaseKey && MOON_PHASES[phaseKey]) {
      phaseZh = T(MOON_PHASES[phaseKey].zh, MOON_PHASES[phaseKey].en);
      phaseEn = MOON_PHASES[phaseKey].en;
    } else if (phaseKey) {
      phaseZh = String(phaseKey);
      phaseEn = String(phaseKey);
    } else {
      var k = phaseNameFrom(illum, waxing);
      phaseZh = T(MOON_PHASES[k].zh, MOON_PHASES[k].en);
      phaseEn = MOON_PHASES[k].en;
    }
    moonInfo = {
      phaseKey: phaseKey || phaseNameFrom(illum, waxing),
      phaseZh: phaseZh,
      phaseEn: phaseEn,
      illum: illum,
      ageDays: age,
      waxing: waxing
    };

    /* 黄道 / 银道采样（用于 2D 图叠加） */
    eclPts = sampleEcliptic(jd);
    galPts = showGalactic ? [sampleGalactic(jd, 0), sampleGalactic(jd, 10), sampleGalactic(jd, -10)] : [];

    calcError = rows.length ? '' : 'failed';
  }

  function projectEq(ra, dec, jd) {
    return altAzOf({ ra: ra, dec: dec }, jd);
  }

  function sampleEcliptic(jd) {
    var ep = COSMOS.ephem;
    if (!ep || typeof ep.eclToEq !== 'function') return [];
    var pts = [];
    for (var l = 0; l < 360; l += 2) {
      var eq = null;
      try { eq = ep.eclToEq(l, 0, jd); } catch (err) { eq = null; }
      if (!eq) { pts.push(null); continue; }
      pts.push(projectEq(eq.ra, eq.dec, jd));
    }
    return pts;
  }

  /* 银道坐标 → 赤道坐标（J2000 近似；l=0,b=0 银心 → RA≈266.4°, Dec≈-29°） */
  var DEC_NGP = 27.12825 * DEG;
  var RA_NGP = 192.85948 * DEG;
  var L_NCP = 122.93192 * DEG;

  function galToEq(lDeg, bDeg) {
    var l = lDeg * DEG, b = bDeg * DEG;
    var sinD = Math.sin(DEC_NGP) * Math.sin(b) + Math.cos(DEC_NGP) * Math.cos(b) * Math.cos(L_NCP - l);
    var dec = Math.asin(Math.max(-1, Math.min(1, sinD)));
    var y = Math.cos(b) * Math.sin(L_NCP - l);
    var x = Math.cos(DEC_NGP) * Math.sin(b) - Math.sin(DEC_NGP) * Math.cos(b) * Math.cos(L_NCP - l);
    var ra = RA_NGP + Math.atan2(y, x);
    return { ra: ((ra / DEG) % 360 + 360) % 360, dec: dec / DEG };
  }

  function sampleGalactic(jd, bDeg) {
    var pts = [];
    for (var l = 0; l < 360; l += 3) {
      var eq = galToEq(l, bDeg);
      pts.push(projectEq(eq.ra, eq.dec, jd));
    }
    return pts;
  }

  /* ---------------- DOM ---------------- */
  function mkBtn(cls, zh, en, onClick) {
    var b = h('button', { class: cls, type: 'button', text: T(zh, en) });
    b.addEventListener('click', onClick);
    return b;
  }

  function ensureUI() {
    if (ui) return ui;

    var titleId = 'sol-sky-title';

    var closeBtn = h('button', {
      class: 'sol-sky-close',
      type: 'button',
      'aria-label': T('关闭今晚天空', 'Close tonight sky'),
      title: T('关闭（Esc）', 'Close (Esc)'),
      text: '×'
    });

    /* 地点控件 */
    var citySelect = h('select', {
      class: 'sol-sky-select',
      id: 'sol-sky-city',
      'aria-label': T('预设城市', 'Preset city')
    });
    CITIES.forEach(function (c) {
      citySelect.appendChild(h('option', { value: c.key, text: T(c.zh, c.en) }));
    });
    citySelect.appendChild(h('option', { value: 'custom', text: T('自定义坐标', 'Custom coordinates') }));

    var latInput = h('input', {
      class: 'sol-sky-input',
      id: 'sol-sky-lat',
      type: 'number',
      step: '0.0001',
      min: '-90',
      max: '90',
      inputmode: 'decimal',
      'aria-label': T('纬度（度）', 'Latitude (degrees)'),
      value: String(loc.lat)
    });
    var lonInput = h('input', {
      class: 'sol-sky-input',
      id: 'sol-sky-lon',
      type: 'number',
      step: '0.0001',
      min: '-180',
      max: '180',
      inputmode: 'decimal',
      'aria-label': T('经度（度）', 'Longitude (degrees)'),
      value: String(loc.lon)
    });
    var locErr = h('p', {
      class: 'sol-sky-err',
      role: 'alert',
      hidden: true
    });

    var locRow = h('div', { class: 'sol-sky-row sol-sky-row-loc' }, [
      h('span', { class: 'sol-sky-label', text: T('地点', 'Location') }),
      h('div', { class: 'sol-sky-locctl' }, [
        citySelect,
        h('span', { class: 'sol-sky-coord' }, [
          h('label', { class: 'sol-sky-coordlabel', for: 'sol-sky-lat', text: T('纬度', 'Lat') }),
          latInput,
          h('label', { class: 'sol-sky-coordlabel', for: 'sol-sky-lon', text: T('经度', 'Lon') }),
          lonInput
        ])
      ])
    ]);

    /* 时间行 */
    var timeOut = h('output', {
      class: 'sol-sky-clock',
      id: 'sol-sky-clock',
      'aria-live': 'off'
    }, h('span', { class: 'sol-sky-clock-utc', text: '—' }));
    var timeRow = h('div', { class: 'sol-sky-row sol-sky-row-time' }, [
      h('span', { class: 'sol-sky-label', text: T('时间', 'Time') }),
      timeOut,
      h('div', { class: 'sol-sky-timebtns' }, [
        mkBtn('sol-sky-btn sol-sky-btn-quiet', '用现在', 'Now', function () {
          timeMs = Date.now();
          scheduleCompute();
        }),
        mkBtn('sol-sky-btn sol-sky-btn-primary', '在 3D 中看这一刻', 'View this moment in 3D', function () {
          var st = solarState();
          st.timeMs = currentTimeMs();
          st.paused = true;
          COSMOS.emit('solar:cmd', { type: 'goto', timeMs: st.timeMs });
          closeSky(false);
        })
      ])
    ]);

    /* 叠加选项 */
    var eclToggle = h('input', { type: 'checkbox', id: 'sol-sky-show-ecl', checked: true });
    var galToggle = h('input', { type: 'checkbox', id: 'sol-sky-show-gal' });
    eclToggle.addEventListener('change', function () {
      showEcliptic = !!eclToggle.checked;
      scheduleDraw();
    });
    galToggle.addEventListener('change', function () {
      showGalactic = !!galToggle.checked;
      if (showGalactic && galPts.length === 0) galPts = [sampleGalactic(jdNow(), 0), sampleGalactic(jdNow(), 10), sampleGalactic(jdNow(), -10)];
      else if (!showGalactic) galPts = [];
      scheduleDraw();
    });
    var layersRow = h('div', { class: 'sol-sky-row sol-sky-row-layers' }, [
      h('span', { class: 'sol-sky-label', text: T('叠加', 'Overlays') }),
      h('div', { class: 'sol-sky-checks' }, [
        h('label', { class: 'sol-sky-check', for: 'sol-sky-show-ecl' }, [eclToggle, h('span', { text: T('黄道', 'Ecliptic') })]),
        h('label', { class: 'sol-sky-check', for: 'sol-sky-show-gal' }, [galToggle, h('span', { text: T('银道（简化）', 'Galactic plane (simplified)') })])
      ])
    ]);

    /* 图表 + 表格 */
    var canvas = h('canvas', {
      class: 'sol-sky-canvas',
      role: 'img',
      'aria-label': T('地平线星空图：上方为北、左侧为东、中心为天顶。', 'Horizon sky chart: north at top, east at left, zenith at center.')
    });
    var chartWrap = h('div', { class: 'sol-sky-chartwrap' }, canvas);
    var legend = h('ul', { class: 'sol-sky-legend', 'aria-hidden': 'true' });
    var table = h('table', { class: 'sol-sky-table' }, [
      h('caption', {
        class: 'sol-sky-caption',
        text: T(
          '地平坐标：高度角 0° 为地平线，90° 为天顶；黄经为地心黄经（度）。',
          'Horizontal coordinates: 0° altitude is the horizon, 90° the zenith; longitude is geocentric ecliptic longitude in degrees.'
        )
      }),
      h('thead', {}, h('tr', {}, [
        h('th', { scope: 'col', text: T('天体', 'Body') }),
        h('th', { scope: 'col', text: T('黄经', 'Ecl. lon.') }),
        h('th', { scope: 'col', text: T('视运动', 'Motion') }),
        h('th', { scope: 'col', text: T('高度角', 'Altitude') }),
        h('th', { scope: 'col', text: T('方位角', 'Azimuth') }),
        h('th', { scope: 'col', text: T('月相', 'Moon phase') })
      ])),
      h('tbody', { class: 'sol-sky-tbody' })
    ]);
    var tableWrap = h('div', { class: 'sol-sky-tablewrap' }, table);

    var status = h('p', { class: 'sol-sky-status', role: 'status', 'aria-live': 'polite' });
    var statusRow = h('div', { class: 'sol-sky-statusrow' }, [
      status,
      mkBtn('sol-sky-btn sol-sky-btn-quiet sol-sky-export', '导出 JSON', 'Export JSON', exportJSON)
    ]);

    var foot = h('p', {
      class: 'sol-sky-foot',
      text: T(
        '行星位置为地心视位置；月相与照亮比例来自星历近似解。图与表均为科普用途，不做导航与观测指向。',
        'Planet positions are geocentric apparent; moon phase and illumination come from approximate ephemerides. Chart and table are educational, not for navigation or telescope pointing.'
      )
    });

    var panel = h('section', { class: 'sol-sky-panel' }, [
      h('header', { class: 'sol-sky-head' }, [
        h('div', { class: 'sol-sky-heading' }, [
          h('p', { class: 'sol-sky-kicker', text: T('02 · 太阳系 / 观测', '02 · SOLAR SYSTEM / OBSERVING') }),
          h('h3', { class: 'sol-sky-title', id: titleId, text: T('今晚天空', 'Tonight’s Sky') }),
          h('p', {
            class: 'sol-sky-sub',
            text: T('选一个地点与时刻，看看此刻头顶有什么。', 'Pick a place and a moment to see what is overhead.')
          })
        ]),
        closeBtn
      ]),
      /* 可滚动正文：head 与底部状态行/导出按钮固定在面板内，正文在 sol-sky-body 内滚动 */
      h('div', { class: 'sol-sky-body' }, [
        h('div', { class: 'sol-sky-controls' }, [locRow, locErr, timeRow, layersRow]),
        h('div', { class: 'sol-sky-grid' }, [
          h('div', { class: 'sol-sky-chartcol' }, [chartWrap, legend]),
          tableWrap
        ])
      ]),
      statusRow,
      foot
    ]);

    var root = h('div', {
      class: 'sol-sky-modal',
      id: 'sol-sky',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'data-ui': true,
      hidden: true
    }, [
      h('div', { class: 'sol-sky-scrim', 'aria-hidden': 'true' }),
      panel
    ]);

    closeBtn.addEventListener('click', function () { closeSky(true); });
    root.firstChild.addEventListener('click', function () { closeSky(true); });
    root.addEventListener('click', function (e) {
      if (e.target === root) closeSky(true);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSky(true);
        return;
      }
      if (e.key === 'Tab') trapTab(e);
      e.stopPropagation(); // 模态开启时屏蔽 boot.js 的全局切章快捷键
    });

    /* 地点交互 */
    function applyCity(key) {
      for (var i = 0; i < CITIES.length; i++) {
        if (CITIES[i].key === key) {
          loc = { name: T(CITIES[i].zh, CITIES[i].en), lat: CITIES[i].lat, lon: CITIES[i].lon };
          latInput.value = String(CITIES[i].lat);
          lonInput.value = String(CITIES[i].lon);
          latInput.removeAttribute('aria-invalid');
          lonInput.removeAttribute('aria-invalid');
          locErr.hidden = true;
          scheduleCompute();
          return;
        }
      }
    }

    citySelect.addEventListener('change', function () {
      if (citySelect.value === 'custom') {
        latInput.focus();
        return;
      }
      applyCity(citySelect.value);
    });

    function commitManualCoord() {
      var lat = parseFloat(latInput.value);
      var lon = parseFloat(lonInput.value);
      var bad = null;
      if (!isFinite(lat) || lat < -90 || lat > 90) {
        latInput.setAttribute('aria-invalid', 'true');
        bad = T('纬度必须是 -90 到 90 之间的数字。', 'Latitude must be a number between -90 and 90.');
      } else {
        latInput.removeAttribute('aria-invalid');
      }
      if (!isFinite(lon) || lon < -180 || lon > 180) {
        lonInput.setAttribute('aria-invalid', 'true');
        bad = T('经度必须是 -180 到 180 之间的数字。', 'Longitude must be a number between -180 and 180.');
      } else {
        lonInput.removeAttribute('aria-invalid');
      }
      if (bad) {
        locErr.textContent = bad;
        locErr.hidden = false;
        return;
      }
      loc = { name: T('自定义坐标', 'Custom coordinates'), lat: lat, lon: lon };
      citySelect.value = 'custom';
      locErr.hidden = true;
      locErr.textContent = '';
      scheduleCompute();
    }

    latInput.addEventListener('change', commitManualCoord);
    lonInput.addEventListener('change', commitManualCoord);
    latInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') commitManualCoord();
    });
    lonInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') commitManualCoord();
    });

    document.body.appendChild(root);

    ui = {
      root: root,
      panel: panel,
      canvas: canvas,
      chartWrap: chartWrap,
      legend: legend,
      tableBody: table.querySelector('tbody'),
      table: table,
      status: status,
      timeOut: timeOut,
      closeBtn: closeBtn,
      citySelect: citySelect,
      latInput: latInput,
      lonInput: lonInput,
      locErr: locErr,
      eclToggle: eclToggle,
      galToggle: galToggle
    };

    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(function () { scheduleDraw(); });
      ro.observe(chartWrap);
    } else {
      window.addEventListener('resize', scheduleDraw);
    }

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
  function renderClock() {
    if (!ui) return;
    var ms = currentTimeMs();
    clearEl(ui.timeOut);
    ui.timeOut.appendChild(h('span', { class: 'sol-sky-clock-utc', text: fmtUtc(ms) + ' UTC' }));
    ui.timeOut.appendChild(h('span', { class: 'sol-sky-clock-local', text: fmtLocal(ms) }));
  }

  function azText(v) {
    if (!isFinite(v)) return '—';
    return num(v, 1) + '°';
  }

  function renderTable() {
    if (!ui) return;
    clearEl(ui.tableBody);
    if (!rows.length) {
      var tr0 = h('tr', {}, h('td', { colspan: '6', class: 'sol-sky-empty', text: calcError === 'missing' ? T('星历未载入，无法计算天体位置。', 'Ephemeris not loaded; positions unavailable.') : T('没有可用的天体数据。', 'No body data available.') }));
      ui.tableBody.appendChild(tr0);
      return;
    }
    rows.forEach(function (r) {
      var moonCell = '—';
      if (r.id === 'moon' && moonInfo) {
        var bits = [moonInfo.phaseZh];
        if (isFinite(moonInfo.illum)) bits.push(T('照亮', 'lit') + ' ' + num(moonInfo.illum * 100, 1) + '%');
        if (isFinite(moonInfo.ageDays)) bits.push(T('月龄', 'age') + ' ' + num(moonInfo.ageDays, 1) + ' ' + T('天', 'd'));
        moonCell = bits.join(' · ');
      }
      ui.tableBody.appendChild(h('tr', { 'data-body': r.id }, [
        h('th', { scope: 'row' }, [
          h('span', {
            class: 'sol-sky-dot',
            'aria-hidden': 'true',
            style: { background: r.color }
          }),
          h('span', { class: 'sol-sky-bname', text: T(r.zh, r.en) }),
          !EN ? h('span', { class: 'sol-sky-ben', text: r.en }) : null
        ]),
        h('td', { class: 'sol-sky-mono', text: isFinite(r.lon) ? num(((r.lon % 360) + 360) % 360, 1) + '°' : '—' }),
        h('td', { text: r.retrograde ? T('逆行', 'Retrograde') : T('顺行', 'Direct') }),
        h('td', {
          class: 'sol-sky-mono' + (isFinite(r.alt) && r.alt < 0 ? ' is-below' : ''),
          text: azText(r.alt)
        }),
        h('td', { class: 'sol-sky-mono', text: azText(r.az) }),
        h('td', { class: 'sol-sky-mooncell', text: moonCell })
      ]));
    });
  }

  function renderLegend() {
    if (!ui) return;
    clearEl(ui.legend);
    rows.forEach(function (r) {
      ui.legend.appendChild(h('li', { class: 'sol-sky-legenditem' }, [
        h('span', { class: 'sol-sky-dot', 'aria-hidden': 'true', style: { background: r.color } }),
        h('span', { text: T(r.zh, r.en) })
      ]));
    });
    ui.legend.appendChild(h('li', {
      class: 'sol-sky-legenditem sol-sky-legendnote',
      text: T('空心 = 地平线下', 'Hollow = below horizon')
    }));
  }

  function renderStatus() {
    if (!ui) return;
    if (computing) {
      ui.status.textContent = T('正在计算天体位置…', 'Computing positions…');
      return;
    }
    if (calcError === 'missing') {
      ui.status.textContent = T('星历未载入：js/ephem.js 尚未加载，暂时无法计算今晚天空。', 'Ephemeris not loaded: js/ephem.js is unavailable, so tonight’s sky cannot be computed.');
      return;
    }
    if (calcError === 'failed') {
      ui.status.textContent = T('天体位置计算失败，请换一个时间或地点重试。', 'Position computation failed. Try another time or location.');
      return;
    }
    var above = 0;
    rows.forEach(function (r) { if (r.above) above++; });
    ui.status.textContent = T(
      '已计算 ' + rows.length + ' 个天体，其中 ' + above + ' 个在地平线上 · ' + fmtUtc(currentTimeMs()) + ' UTC',
      rows.length + ' bodies computed, ' + above + ' above the horizon · ' + fmtUtc(currentTimeMs()) + ' UTC'
    );
  }

  function updateCanvasLabel() {
    if (!ui) return;
    ui.canvas.setAttribute('aria-label', T(
      '地平线星空图：上方为北、左侧为东、中心为天顶。' + loc.name + '，' + fmtUtc(currentTimeMs()) + ' UTC。',
      'Horizon sky chart: north at top, east at left, zenith at center. ' + loc.name + ', ' + fmtUtc(currentTimeMs()) + ' UTC.'
    ));
  }

  function renderAll() {
    renderClock();
    renderStatus();
    renderTable();
    renderLegend();
    updateCanvasLabel();
    scheduleDraw();
  }

  /* ---------------- 2D 地平线图 ---------------- */
  function scheduleDraw() {
    if (drawRaf) return;
    drawRaf = requestAnimationFrame(function () {
      drawRaf = 0;
      drawChart();
    });
  }

  function project(az, alt, cx, cy, R) {
    var rr;
    if (alt >= 0) rr = R * (1 - Math.max(0, Math.min(90, alt)) / 90);
    else rr = R * (1 + Math.min(90, -alt) / 90 * 0.28);
    var a = az * DEG;
    return { x: cx - rr * Math.sin(a), y: cy - rr * Math.cos(a) };
  }

  function drawChart() {
    if (!ui) return;
    var wrap = ui.chartWrap;
    var canvas = ui.canvas;
    var w = wrap.clientWidth;
    var hgt = wrap.clientHeight || w;
    if (w < 80 || hgt < 80) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = Math.round(w), ch = Math.round(hgt);
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    var cx = cw / 2, cy = ch / 2;
    var R = Math.min(cw, ch) * 0.38;
    var mono = '500 11px "DM Mono", ui-monospace, monospace';
    var uiFont = '600 11px "Inter", "PingFang SC", "Microsoft YaHei", sans-serif';

    /* 高度圈 */
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.setLineDash([3, 4]);
    [30, 60].forEach(function (alt) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1 - alt / 90), 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    /* 地平圈 */
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    /* 天顶十字 */
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5);
    ctx.stroke();

    /* 方位文字：北上、东左、南下、西右 */
    ctx.font = uiFont;
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy - R - 12);
    ctx.textAlign = 'left';
    ctx.fillText('E', cx - R - 16, cy);
    ctx.textAlign = 'center';
    ctx.fillText('S', cx, cy + R + 12);
    ctx.textAlign = 'right';
    ctx.fillText('W', cx + R + 16, cy);

    /* 高度圈标注 */
    ctx.font = mono;
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.textAlign = 'left';
    ctx.fillText('30°', cx + 4, cy - R * (1 - 30 / 90));
    ctx.fillText('60°', cx + 4, cy - R * (1 - 60 / 90));

    /* 黄道 */
    if (showEcliptic && eclPts && eclPts.length) {
      drawPath(ctx, eclPts, cx, cy, R, 'rgba(28,103,227,.55)', [4, 4], 1.2);
    }

    /* 银道（简化：b=0 中线 + b=±10° 边界） */
    if (showGalactic && galPts && galPts.length) {
      galPts.forEach(function (pts, i) {
        drawPath(ctx, pts, cx, cy, R, i === 0 ? 'rgba(185,185,187,.4)' : 'rgba(185,185,187,.18)', i === 0 ? [2, 5] : [2, 6], 1);
      });
    }

    /* 天体 */
    var labels = [];
    var sorted = rows.slice().sort(function (a, b) {
      var aa = isFinite(a.alt) ? a.alt : -90;
      var bb = isFinite(b.alt) ? b.alt : -90;
      return aa - bb;
    });
    sorted.forEach(function (r) {
      if (!isFinite(r.alt) || !isFinite(r.az)) return;
      var p = project(r.az, r.alt, cx, cy, R);
      var rad = r.kind === 'sun' ? 6 : (r.kind === 'moon' ? 5.5 : 3.6);
      ctx.save();
      if (!r.above) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        if (r.kind === 'sun' || r.kind === 'moon') {
          var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 3);
          g.addColorStop(0, r.kind === 'sun' ? 'rgba(255,255,255,.45)' : 'rgba(209,209,209,.3)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      labels.push({ x: p.x, y: p.y, r: rad, text: T(r.zh, r.en), above: r.above });
    });

    /* 标签避让：8 个候选偏移，放不下就不画 */
    ctx.font = mono;
    ctx.textBaseline = 'middle';
    var placed = [];
    var offsets = [[10, 0], [-10, 0], [0, -13], [0, 13], [10, -10], [-10, -10], [10, 10], [-10, 10]];
    labels.forEach(function (lb) {
      var text = lb.text;
      var tw = ctx.measureText(text).width;
      var best = null;
      for (var i = 0; i < offsets.length; i++) {
        var ox = offsets[i][0], oy = offsets[i][1];
        var align = ox > 0 ? 'left' : (ox < 0 ? 'right' : 'center');
        var x = lb.x + ox, y = lb.y + oy;
        var left = align === 'left' ? x : (align === 'right' ? x - tw : x - tw / 2);
        var rect = { l: left - 2, r: left + tw + 2, t: y - 7, b: y + 7 };
        if (rect.l < 2 || rect.r > cw - 2 || rect.t < 2 || rect.b > ch - 2) continue;
        var hit = false;
        for (var j = 0; j < placed.length; j++) {
          var q = placed[j];
          if (rect.l < q.r && rect.r > q.l && rect.t < q.b && rect.b > q.t) { hit = true; break; }
        }
        if (hit) continue;
        best = { align: align, x: x, y: y, rect: rect };
        break;
      }
      if (!best) return;
      placed.push(best.rect);
      ctx.save();
      ctx.globalAlpha = lb.above ? 0.92 : 0.55;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = best.align;
      ctx.fillText(text, best.x, best.y);
      ctx.restore();
    });

    /* 星历缺失时在图内提示 */
    if (calcError === 'missing') {
      ctx.save();
      ctx.font = uiFont;
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(T('星历未载入', 'Ephemeris not loaded'), cx, cy + R * 0.55);
      ctx.restore();
    }

    /* 图例色块也画一笔边框，避免白底行星看不见 */
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 1;
    sorted.forEach(function (r) {
      if (!r.above || !isFinite(r.alt) || !isFinite(r.az)) return;
      var p = project(r.az, r.alt, cx, cy, R);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (r.kind === 'sun' ? 6 : (r.kind === 'moon' ? 5.5 : 3.6)) + 0.5, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  function drawPath(ctx, pts, cx, cy, R, stroke, dash, width) {
    if (!pts || !pts.length) return;
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width || 1;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p) { started = false; continue; }
      var s = project(p.az, p.alt, cx, cy, R);
      if (!started) { ctx.moveTo(s.x, s.y); started = true; }
      else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- 计算调度 ---------------- */
  function scheduleCompute() {
    computeToken++;
    var token = computeToken;
    computing = true;
    renderClock();
    if (ui) {
      renderStatus();
      updateCanvasLabel();
    }
    setTimeout(function () {
      if (token !== computeToken) return;
      calcError = '';
      rows = [];
      moonInfo = null;
      eclPts = null;
      galPts = [];
      try {
        computeSky();
      } catch (err) {
        calcError = 'failed';
        rows = [];
      }
      computing = false;
      if (ui) renderAll();
    }, 16);
  }

  /* ---------------- 导出 ---------------- */
  function exportJSON() {
    var ms = currentTimeMs();
    var jd = jdNow();
    var payload = {
      schema: 'cosmos-atlas/sky/1',
      generatedAt: new Date().toISOString(),
      location: { name: loc.name, lat: loc.lat, lon: loc.lon },
      time: {
        timeMs: ms,
        utc: fmtUtc(ms) + ' UTC',
        local: fmtLocal(ms),
        jd: jd,
        tzOffsetHours: tzOffsetHours()
      },
      moon: moonInfo ? {
        phaseName: moonInfo.phaseEn,
        phaseNameZh: moonInfo.phaseZh,
        illum: moonInfo.illum,
        ageDays: moonInfo.ageDays,
        waxing: moonInfo.waxing
      } : null,
      bodies: rows.map(function (r) {
        return {
          id: r.id,
          name: r.zh,
          nameEn: r.en,
          kind: r.kind,
          eclipticLonDeg: isFinite(r.lon) ? ((r.lon % 360) + 360) % 360 : null,
          eclipticLatDeg: isFinite(r.lat) ? r.lat : null,
          raDeg: isFinite(r.ra) ? r.ra : null,
          decDeg: isFinite(r.dec) ? r.dec : null,
          altDeg: isFinite(r.alt) ? r.alt : null,
          azDeg: isFinite(r.az) ? r.az : null,
          aboveHorizon: !!r.above,
          retrograde: !!r.retrograde
        };
      })
    };
    var text = JSON.stringify(payload, null, 2);
    var stamp = new Date(ms).toISOString().replace(/[:.]/g, '-');
    var name = 'cosmos-sky-' + stamp + '.json';
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: name, class: 'sol-sky-dl', 'aria-hidden': 'true' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (err) {
      /* 极端环境下 Blob 不可用：保持静默，不影响页面 */
    }
  }

  /* ---------------- 开关 ---------------- */
  function syncControls() {
    if (!ui) return;
    var found = null;
    for (var i = 0; i < CITIES.length; i++) {
      if (Math.abs(CITIES[i].lat - loc.lat) < 1e-4 && Math.abs(CITIES[i].lon - loc.lon) < 1e-4) {
        found = CITIES[i];
        break;
      }
    }
    ui.citySelect.value = found ? found.key : 'custom';
    ui.latInput.value = String(loc.lat);
    ui.lonInput.value = String(loc.lon);
    ui.locErr.hidden = true;
    ui.eclToggle.checked = showEcliptic;
    ui.galToggle.checked = showGalactic;
  }

  function openSky() {
    ensureUI();
    if (open) return;
    COSMOS.emit('solarlab:close'); // 同一时间只开一个模态
    prevFocus = document.activeElement;
    var st = solarState();
    savedPaused = st.paused;
    hasSaved = true;
    st.paused = true;

    timeMs = (typeof st.timeMs === 'number' && isFinite(st.timeMs)) ? st.timeMs : Date.now();
    open = true;
    ui.root.hidden = false;
    ui.root.classList.add('is-open');
    syncControls();
    scheduleCompute();
    ui.closeBtn.focus();
  }

  function closeSky(restorePaused) {
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
      closeSky(true);
      return;
    }
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    else e.stopPropagation();
  });

  /* ---------------- 对外接口 ---------------- */
  var LAB = COSMOS.solarLab || (COSMOS.solarLab = {});
  LAB.openSky = openSky;
  if (typeof LAB.close !== 'function') {
    LAB.close = function () { COSMOS.emit('solarlab:close'); };
  }
  COSMOS.on('solarlab:close', function () {
    if (open) closeSky(true);
  });
})(window.COSMOS = window.COSMOS || {});
