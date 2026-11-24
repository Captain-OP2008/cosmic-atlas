/* ============================================================
 * COSMOS ATLAS v2 · 人类探索组件（history / vehicles / future）
 * ------------------------------------------------------------
 * 契约（V2-PLAN §10.2 / §10.4）：
 *   COSMOS.registerWidget(id, factory)
 *   factory(hostEl, contentObj, sectionEl) -> { update(p, o) }
 * 数据只读 COSMOS.DATA（milestones / vehicles / future / planets）；
 * 组件不写页面结构，不重建 DOM；交互元素自行 pointer-events:auto。
 * 影像全部来自本地 assets/photos/*.jpg；缺失影像用内联 SVG 示意图代替。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const T = (COSMOS.i18n && COSMOS.i18n.T) || function (zh) { return zh; };
  const EN = !!(COSMOS.i18n && COSMOS.i18n.en);

  const doc = document;
  const DATA = COSMOS.DATA || {};
  const MILESTONES = (DATA.milestones || []).slice().sort(function (a, b) {
    return (a.year - b.year) || String(a.date || '').localeCompare(String(b.date || ''));
  });
  const VEHICLES = (DATA.vehicles || []).slice();
  const FUTURE = (DATA.future || []).slice();

  const YEAR_MIN = MILESTONES.length ? MILESTONES[0].year : 1957;
  const YEAR_MAX = MILESTONES.length ? MILESTONES[MILESTONES.length - 1].year : 2024;
  const MONTH_DAYS = 30.44;

  const reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function prefersReduced() { return !!(reduceMQ && reduceMQ.matches); }

  /* ============================================================
   * 基础工具
   * ============================================================ */
  function el(tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function fmt(n) {
    if (n == null || !isFinite(n)) return '—';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtTons(kg) {
    if (kg == null || !isFinite(kg)) return '—';
    const t = kg / 1000;
    const s = t >= 100 ? String(Math.round(t)) : String(Math.round(t * 100) / 100);
    return s + T(' 吨', ' t');
  }

  function fmtMeters(m) {
    if (m == null || !isFinite(m)) return '—';
    return String(m) + T(' 米', ' m');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function yearOfDate(s) {
    const m = /^(\d{4})/.exec(String(s || ''));
    return m ? m[1] : '';
  }

  function firstYearText(s) {
    if (!s) return '—';
    const y = yearOfDate(s);
    if (y) return y + T(' 年', '');
    return String(s);
  }

  function nearestMilestone(year) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < MILESTONES.length; i++) {
      const d = Math.abs(MILESTONES[i].year - year);
      if (d < bestD) { bestD = d; best = MILESTONES[i]; }
    }
    return best;
  }

  /* ============================================================
   * 共享抽屉（append 到 body，避免 .ch-inner 的 transform 影响 fixed）
   * ============================================================ */
  let drawerEl = null;
  let drawerKicker = null;
  let drawerTitle = null;
  let drawerBody = null;
  let drawerClose = null;
  let drawerOwner = null;
  let drawerReturnFocus = null;

  function ensureDrawer() {
    if (drawerEl) return;
    drawerEl = el('div', 'drawer hm-drawer');
    drawerEl.setAttribute('role', 'dialog');
    drawerEl.setAttribute('aria-modal', 'false');
    drawerEl.setAttribute('aria-label', T('详情', 'Details'));
    drawerEl.setAttribute('aria-hidden', 'true');

    drawerClose = el('button', 'drawer-close hm-drawer-close', '×');
    drawerClose.type = 'button';
    drawerClose.setAttribute('aria-label', T('关闭详情', 'Close details'));
    drawerClose.addEventListener('click', closeDrawer);

    const head = el('div', 'hm-drawer-head');
    drawerKicker = el('p', 'u-kicker hm-drawer-kicker', '');
    drawerTitle = el('h3', 'hm-drawer-title', '');
    head.appendChild(drawerKicker);
    head.appendChild(drawerTitle);

    drawerBody = el('div', 'hm-drawer-body');
    drawerEl.appendChild(drawerClose);
    drawerEl.appendChild(head);
    drawerEl.appendChild(drawerBody);
    doc.body.appendChild(drawerEl);

    if (typeof COSMOS.on === 'function') COSMOS.on('cosmos:escape', closeDrawer);
  }

  function openDrawer(owner, kicker, title, fill) {
    ensureDrawer();
    drawerOwner = owner;
    drawerReturnFocus = doc.activeElement;
    drawerKicker.textContent = kicker || '';
    drawerTitle.textContent = title || '';
    while (drawerBody.firstChild) drawerBody.removeChild(drawerBody.firstChild);
    if (typeof fill === 'function') fill(drawerBody);
    drawerEl.classList.add('is-open');
    drawerEl.removeAttribute('aria-hidden');
    try { drawerClose.focus({ preventScroll: true }); } catch (e) { drawerClose.focus(); }
  }

  function closeDrawer() {
    if (!drawerEl || !drawerEl.classList.contains('is-open')) return;
    drawerEl.classList.remove('is-open');
    drawerEl.setAttribute('aria-hidden', 'true');
    drawerOwner = null;
    if (drawerReturnFocus && drawerReturnFocus.focus && doc.contains(drawerReturnFocus)) {
      try { drawerReturnFocus.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
    }
    drawerReturnFocus = null;
  }

  /* ============================================================
   * 影像 / 示意图
   * ============================================================ */
  function photoFigure(name, caption) {
    if (!name) return null;
    const fig = el('figure', 'hm-fig');
    const img = el('img', 'hm-fig-img');
    img.src = 'assets/photos/' + name + '.jpg';
    img.alt = caption || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', function () {
      const noimg = el('div', 'hm-noimg', T('影像未载入 · ', 'Image not loaded · ') + 'assets/photos/' + name + '.jpg');
      if (img.parentNode) img.parentNode.replaceChild(noimg, img);
    });
    fig.appendChild(img);
    if (caption) fig.appendChild(el('figcaption', 'hm-figcap', caption));
    return fig;
  }

  function schematicFor(m) {
    const key = String((m.title || '') + ' ' + (m.en || '')).toLowerCase();
    if (/sputnik|斯普特尼克/.test(key)) return svgSatellite();
    if (/vostok|加加林/.test(key)) return svgCapsule();
    if (/voskhod|太空行走/.test(key)) return svgEva();
    if (/salyut|礼炮|shenzhou|神舟|tianhe|天和|iss|空间站/.test(key)) return svgStation();
    if (/apollo 8|阿波罗 8|earthrise|地出/.test(key)) return svgEarthrise();
    if (/apollo 11|阿波罗 11|登月/.test(key)) return svgLander();
    if (/curiosity|好奇号|perseverance|毅力号|rover/.test(key)) return svgRover();
    if (/voyager|旅行者|horizons|新视野/.test(key)) return svgProbe();
    if (/gw150914|引力波|ligo/.test(key)) return svgWave();
    if (/starship|星舰|rocket/.test(key)) return svgRocket(T('火箭', 'Rocket'));
    return svgOrbit();
  }

  function schematicNode(m) {
    const box = el('div', 'hm-poster');
    box.innerHTML = schematicFor(m) + '<p class="hm-poster-cap">' + T('示意图 · 非实拍（', 'Diagram · not a photograph (') + esc(m.year) + T('）', ')') + '</p>';
    return box;
  }

  function svgSatellite() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('第一颗人造卫星示意：球体与四根天线', 'Sputnik 1: sphere with four antennas') + '">' +
      '<ellipse class="s-line" cx="200" cy="120" rx="148" ry="56"/>' +
      '<circle class="s-fill" cx="200" cy="120" r="26"/>' +
      '<circle class="s-dot" cx="200" cy="120" r="5"/>' +
      '<line class="s-line" x1="176" y1="106" x2="128" y2="72"/><line class="s-line" x1="224" y1="106" x2="272" y2="72"/>' +
      '<line class="s-line" x1="176" y1="136" x2="128" y2="170"/><line class="s-line" x1="224" y1="136" x2="272" y2="170"/>' +
      '<text class="s-tag" x="200" y="208" text-anchor="middle">' + T('1957 · 直径 58 厘米 · 21 天', '1957 · 58 cm diameter · 21 days') + '</text>' +
      '</svg>';
  }

  function svgCapsule() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('东方 1 号飞船绕地球一圈示意', 'Vostok 1: one orbit around Earth') + '">' +
      '<circle class="s-line" cx="200" cy="150" r="112"/>' +
      '<path class="s-line" d="M84 178 Q200 24 316 178"/>' +
      '<circle class="s-fill" cx="256" cy="80" r="10"/>' +
      '<text class="s-tag" x="200" y="220" text-anchor="middle">' + T('1961 · 108 分钟 · 绕地球一圈', '1961 · 108 minutes · one orbit') + '</text>' +
      '</svg>';
  }

  function svgEva() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('舱外活动示意：宇航员与安全绳', 'Spacewalk: astronaut and tether') + '">' +
      '<path class="s-line" d="M60 176 Q200 26 340 176"/>' +
      '<circle class="s-fill" cx="200" cy="92" r="16"/>' +
      '<path class="s-line" d="M200 108 V146 M200 118 L178 134 M200 118 L222 134 M200 146 L186 164 M200 146 L214 164"/>' +
      '<path class="s-line" d="M200 108 C160 90 120 118 104 156"/>' +
      '<text class="s-tag" x="200" y="216" text-anchor="middle">' + T('1965 · 舱外停留 12 分钟', '1965 · 12-minute spacewalk') + '</text>' +
      '</svg>';
  }

  function svgStation() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('空间站示意：核心舱与两侧太阳翼', 'Space station: core module and solar arrays') + '">' +
      '<rect class="s-line" x="150" y="108" width="100" height="26"/>' +
      '<rect class="s-line" x="120" y="114" width="30" height="14"/>' +
      '<rect class="s-line" x="250" y="114" width="30" height="14"/>' +
      '<rect class="s-fill" x="62" y="104" width="50" height="34"/><rect class="s-fill" x="288" y="104" width="50" height="34"/>' +
      '<line class="s-line" x1="112" y1="121" x2="120" y2="121"/><line class="s-line" x1="280" y1="121" x2="288" y2="121"/>' +
      '<text class="s-tag" x="200" y="200" text-anchor="middle">' + T('1971 / 1998 / 2021 · 长期在轨', '1971 / 1998 / 2021 · long-duration stays in orbit') + '</text>' +
      '</svg>';
  }

  function svgEarthrise() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('地出示意：月面地平线上的地球', 'Earthrise: Earth above the lunar horizon') + '">' +
      '<path class="s-line" d="M0 196 Q200 140 400 196 V240 H0 Z"/>' +
      '<circle class="s-fill" cx="264" cy="86" r="42"/>' +
      '<path class="s-line" d="M236 76 Q264 58 292 78"/>' +
      '<text class="s-tag" x="200" y="226" text-anchor="middle">' + T('1968 · 人类第一次绕月飞行', '1968 · first crewed lunar orbit') + '</text>' +
      '</svg>';
  }

  function svgLander() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('登月舱示意', 'Lunar module') + '">' +
      '<path class="s-line" d="M0 200 Q200 152 400 200 V240 H0 Z"/>' +
      '<path class="s-line" d="M176 108 H224 L216 150 H184 Z"/>' +
      '<line class="s-line" x1="184" y1="150" x2="166" y2="186"/><line class="s-line" x1="216" y1="150" x2="234" y2="186"/>' +
      '<circle class="s-dot" cx="200" cy="94" r="3"/>' +
      '<text class="s-tag" x="200" y="224" text-anchor="middle">' + T('1969 · 21.5 千克月岩', '1969 · 21.5 kg of Moon rock') + '</text>' +
      '</svg>';
  }

  function svgRover() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('火星车示意', 'Mars rover') + '">' +
      '<path class="s-line" d="M0 200 Q200 168 400 200 V240 H0 Z"/>' +
      '<rect class="s-line" x="150" y="138" width="100" height="30"/>' +
      '<circle class="s-line" cx="166" cy="176" r="12"/><circle class="s-line" cx="200" cy="176" r="12"/><circle class="s-line" cx="234" cy="176" r="12"/>' +
      '<line class="s-line" x1="182" y1="138" x2="182" y2="108"/><line class="s-line" x1="218" y1="138" x2="218" y2="108"/>' +
      '<rect class="s-fill" x="176" y="100" width="48" height="8"/>' +
      '<text class="s-tag" x="200" y="220" text-anchor="middle">' + T('火星车 · 轮式移动实验室', 'Mars rover · wheeled mobile laboratory') + '</text>' +
      '</svg>';
  }

  function svgProbe() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('深空探测器示意', 'Deep-space probe') + '">' +
      '<path class="s-line" d="M36 196 Q160 36 360 84"/>' +
      '<circle class="s-fill" cx="250" cy="80" r="14"/>' +
      '<path class="s-line" d="M250 66 L250 48 M236 74 L210 60 M264 74 L290 60"/>' +
      '<circle class="s-line" cx="300" cy="58" r="18"/>' +
      '<text class="s-tag" x="200" y="222" text-anchor="middle">' + T('深空 · 飞掠 / 采样返回', 'Deep space · flyby / sample return') + '</text>' +
      '</svg>';
  }

  function svgWave() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('引力波示意：两条缠绕的轨迹', 'Gravitational waves: two spiraling traces') + '">' +
      '<path class="s-line" d="M40 140 Q100 70 160 120 T280 140 T380 96"/>' +
      '<path class="s-line" d="M40 160 Q100 230 160 180 T280 160 T380 204"/>' +
      '<circle class="s-dot" cx="200" cy="140" r="4"/>' +
      '<text class="s-tag" x="200" y="222" text-anchor="middle">' + T('2015 · 13 亿光年外的并合', '2015 · merger 1.3 billion light-years away') + '</text>' +
      '</svg>';
  }

  function svgOrbit() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('轨道示意', 'Orbit diagram') + '">' +
      '<circle class="s-line" cx="200" cy="120" r="56"/>' +
      '<ellipse class="s-line" cx="200" cy="120" rx="156" ry="52"/>' +
      '<circle class="s-dot" cx="284" cy="86" r="4"/>' +
      '<text class="s-tag" x="200" y="222" text-anchor="middle">' + T('轨道示意', 'Orbital diagram') + '</text>' +
      '</svg>';
  }

  function svgRocket(label) {
    return '<svg class="hm-svg" viewBox="0 0 240 320" role="img" aria-label="' + esc(label || T('火箭', 'Rocket')) + T('示意', ' diagram') + '">' +
      '<path class="s-line" d="M120 26 C146 78 154 152 150 232 H90 C86 152 94 78 120 26 Z"/>' +
      '<path class="s-line" d="M90 196 L62 250 L92 238 Z M150 196 L178 250 L148 238 Z"/>' +
      '<rect class="s-line" x="100" y="120" width="40" height="26"/>' +
      '<line class="s-line" x1="120" y1="232" x2="120" y2="284"/>' +
      '<text class="s-tag" x="120" y="306" text-anchor="middle">' + esc(label || T('火箭', 'Rocket')) + T('示意图 · 非实拍', ' · diagram, not a photograph') + '</text>' +
      '</svg>';
  }

  function svgTelescope() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('空间望远镜示意：主镜与遮阳板', 'Space telescope: primary mirror and sunshield') + '">' +
      '<polygon class="s-line" points="120,120 200,92 280,120 200,148"/>' +
      '<path class="s-line" d="M120 120 L84 168 L200 196 L316 168 L280 120"/>' +
      '<line class="s-line" x1="200" y1="148" x2="200" y2="178"/>' +
      '<text class="s-tag" x="200" y="222" text-anchor="middle">' + T('主镜与遮阳板示意', 'Primary mirror and sunshield') + '</text>' +
      '</svg>';
  }

  function svgStationCraft() {
    return '<svg class="hm-svg" viewBox="0 0 400 240" role="img" aria-label="' + T('空间站示意：舱段与太阳翼', 'Space station: modules and solar arrays') + '">' +
      '<rect class="s-line" x="168" y="104" width="64" height="20"/>' +
      '<rect class="s-line" x="150" y="110" width="18" height="8"/><rect class="s-line" x="232" y="110" width="18" height="8"/>' +
      '<rect class="s-fill" x="96" y="98" width="46" height="32"/><rect class="s-fill" x="258" y="98" width="46" height="32"/>' +
      '<text class="s-tag" x="200" y="196" text-anchor="middle">' + T('空间站 · 结构示意', 'Space station · structure') + '</text>' +
      '</svg>';
  }

  function schematicVehicle(v) {
    const group = kindGroup(v);
    const box = el('div', 'hm-poster');
    const svg = group === 'telescope' ? svgTelescope() : group === 'station' ? svgStationCraft() : svgRocket(v.name);
    box.innerHTML = svg + '<p class="hm-poster-cap">' + T('示意图 · 非实拍', 'Diagram · not a photograph') + '</p>';
    return box;
  }

  /* ============================================================
   * 10 历史 · 航天里程碑
   * ============================================================ */
  COSMOS.registerWidget('history', function (host, content, section) {
    const wrap = el('div', 'hm hm-hist');
    host.appendChild(wrap);
    const panel = el('div', 'hm-panel hm-hist-panel panel');
    wrap.appendChild(panel);

    const state = (COSMOS.state && COSMOS.state.explore) || { year: 1969 };
    if (!COSMOS.state) COSMOS.state = {};
    COSMOS.state.explore = state;

    let year = clamp(Math.round(typeof state.year === 'number' ? state.year : 1969), YEAR_MIN, YEAR_MAX);
    let playing = false;
    let playAcc = 0;
    let lastTick = 0;

    /* 头部 */
    const head = el('div', 'hm-hist-head');
    const yearBox = el('div', 'hm-year');
    const yearV = el('span', 'hm-year-v', String(year));
    yearBox.appendChild(yearV);
    yearBox.appendChild(el('span', 'hm-year-u', T('年', '')));
    const meta = el('div', 'hm-hist-meta');
    meta.appendChild(el('p', 'u-kicker', T('航天里程碑 · 时间轴', 'Space Age · Timeline')));
    meta.appendChild(el('p', 'hm-hist-sub u-mono', YEAR_MIN + ' — ' + YEAR_MAX + ' · ' + MILESTONES.length + T(' 个节点', ' milestones')));
    const play = el('button', 'btn btn-sm hm-play', T('播放', 'Play'));
    play.type = 'button';
    play.setAttribute('aria-pressed', 'false');
    head.appendChild(yearBox);
    head.appendChild(meta);
    head.appendChild(play);
    panel.appendChild(head);

    /* 时间滑杆 + 刻度 */
    const scrub = el('div', 'hm-scrub');
    const rangeRow = el('div', 'range-row');
    const rangeLab = el('label', '', T('年份', 'Year'));
    const range = el('input', 'range hm-range');
    range.type = 'range';
    range.id = 'hm-hist-range';
    range.min = String(YEAR_MIN);
    range.max = String(YEAR_MAX);
    range.step = '1';
    range.value = String(year);
    range.setAttribute('aria-label', T('航天里程碑年份，' + YEAR_MIN + ' 至 ' + YEAR_MAX, 'Space Age timeline year, ' + YEAR_MIN + ' to ' + YEAR_MAX));
    rangeLab.htmlFor = range.id;
    const rangeVal = el('output', 'range-val hm-range-val', String(year));
    rangeVal.htmlFor = range.id;
    rangeRow.appendChild(rangeLab);
    rangeRow.appendChild(range);
    rangeRow.appendChild(rangeVal);
    scrub.appendChild(rangeRow);

    const ticks = el('div', 'hm-ticks');
    ticks.setAttribute('role', 'group');
    ticks.setAttribute('aria-label', T('里程碑节点', 'Milestones'));
    const tickBtns = [];
    const span = Math.max(1, YEAR_MAX - YEAR_MIN);
    MILESTONES.forEach(function (m) {
      const b = el('button', 'hm-tick');
      b.type = 'button';
      b.style.left = ((m.year - YEAR_MIN) / span * 100).toFixed(3) + '%';
      b.setAttribute('aria-label', m.year + ' ' + m.title);
      b.title = m.year + ' ' + m.title;
      b.addEventListener('click', function () {
        stopPlay();
        setYear(m.year, true);
      });
      ticks.appendChild(b);
      tickBtns.push(b);
    });
    scrub.appendChild(ticks);
    panel.appendChild(scrub);

    /* 状态行 */
    const stat = el('p', 'hm-hist-stat u-mono');
    stat.appendChild(el('span', 'u-dim', T('示意在轨目标 ', 'Illustrative satellites in orbit: ')));
    const statN = el('b', 'hm-stat-n', '—');
    stat.appendChild(statN);
    stat.appendChild(el('span', 'u-dim', T(' 颗 · 最近节点 ', ' · nearest event: ')));
    const statEv = el('span', 'hm-stat-ev', '—');
    stat.appendChild(statEv);
    panel.appendChild(stat);

    /* 事件卡列表 */
    const list = el('div', 'hm-events');
    list.setAttribute('aria-label', T('里程碑事件列表', 'Milestone events'));
    const cards = [];
    MILESTONES.forEach(function (m, i) {
      const card = el('button', 'hm-ev');
      card.type = 'button';
      card.setAttribute('aria-label', m.year + ' ' + m.title + T('，查看详情', ' — view details'));
      card.appendChild(el('span', 'hm-ev-year u-mono', String(m.year)));
      const main = el('span', 'hm-ev-main');
      main.appendChild(el('span', 'hm-ev-title', m.title));
      main.appendChild(el('span', 'hm-ev-en', EN ? (m.agency || '') : ((m.en || '') + (m.agency ? ' · ' + m.agency : ''))));
      main.appendChild(el('span', 'hm-ev-desc', m.desc || ''));
      card.appendChild(main);
      card.addEventListener('click', function () { openMilestone(i); });
      list.appendChild(card);
      cards.push(card);
    });
    panel.appendChild(list);

    /* --- 年份与画面同步（只写 COSMOS.state.explore.year，场景只读） --- */
    function setYear(v, user) {
      year = clamp(Math.round(v), YEAR_MIN, YEAR_MAX);
      state.year = year;
      if (COSMOS.explore && typeof COSMOS.explore === 'object') COSMOS.explore.year = year;
      if (range.value !== String(year)) range.value = String(year);
      rangeVal.textContent = String(year);
      paint();
      if (user) followYear();
    }

    function paint() {
      yearV.textContent = String(year);
      const near = nearestMilestone(year);
      statEv.textContent = near ? (near.year + ' ' + near.title) : '—';
      if (COSMOS.explore && typeof COSMOS.explore.satCount === 'function') {
        statN.textContent = fmt(COSMOS.explore.satCount(year));
      }
      for (let i = 0; i < cards.length; i++) {
        const d = Math.abs(MILESTONES[i].year - year);
        cards[i].classList.toggle('is-near', d <= 3);
        cards[i].classList.toggle('is-on', d === 0);
        cards[i].classList.toggle('is-far', d > 3);
        tickBtns[i].classList.toggle('is-near', d <= 3);
        tickBtns[i].classList.toggle('is-on', d === 0);
      }
    }

    function followYear() {
      let idx = 0;
      let best = Infinity;
      for (let i = 0; i < MILESTONES.length; i++) {
        const d = Math.abs(MILESTONES[i].year - year);
        if (d < best) { best = d; idx = i; }
      }
      const card = cards[idx];
      if (!card) return;
      const target = card.offsetTop - list.clientHeight / 2 + card.offsetHeight / 2;
      if (Math.abs(list.scrollTop - target) < 24) return;
      try {
        list.scrollTo({ top: Math.max(0, target), behavior: prefersReduced() ? 'auto' : 'smooth' });
      } catch (e) {
        list.scrollTop = Math.max(0, target);
      }
    }

    function startPlay() {
      if (year >= YEAR_MAX) setYear(YEAR_MIN, true);
      playing = true;
      playAcc = 0;
      lastTick = 0;
      play.textContent = T('暂停', 'Pause');
      play.setAttribute('aria-pressed', 'true');
    }

    function stopPlay() {
      if (!playing) return;
      playing = false;
      play.textContent = T('播放', 'Play');
      play.setAttribute('aria-pressed', 'false');
      lastTick = 0;
    }

    play.addEventListener('click', function () {
      if (playing) stopPlay(); else startPlay();
    });

    range.addEventListener('input', function () {
      stopPlay();
      setYear(parseInt(range.value, 10), true);
    });

    /* 左右键：焦点不在 range 上时也能调年份 */
    panel.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target === range) return;
      e.preventDefault();
      stopPlay();
      setYear(year + (e.key === 'ArrowRight' ? 1 : -1), true);
    });

    if (typeof COSMOS.on === 'function') {
      COSMOS.on('cosmos:escape', function () { stopPlay(); });
    }

    /* --- 里程碑详情 --- */
    function openMilestone(i) {
      const m = MILESTONES[i];
      openDrawer('history', T('航天里程碑 · ', 'Space Age · ') + (m.date || m.year), m.title, function (body) {
        body.appendChild(el('p', 'hm-drawer-meta u-mono', (m.date || String(m.year)) + ' · ' + (m.agency || '—')));
        if (!EN && m.en) body.appendChild(el('p', 'hm-drawer-en u-kicker', m.en));
        if (m.photo) {
          const fig = photoFigure(m.photo, m.title + ' — ' + (m.agency || '') + T('；公开影像，本地存储', ' · public-domain image, stored locally'));
          if (fig) body.appendChild(fig);
        } else {
          body.appendChild(schematicNode(m));
        }
        body.appendChild(el('p', 'hm-drawer-text', m.desc || ''));
        body.appendChild(el('p', 'hm-drawer-src u-dim',
          m.photo ? T('影像来源：NASA / ESA 等公开影像库；文件存于本站本地。',
            'Image source: NASA / ESA and other public image archives; files are stored locally on this site.')
                  : T('该事件没有可用的公有实拍照片，图为本站依据公开资料绘制的示意图。',
            'No public-domain photograph is available for this event; the image is a diagram drawn by this site from public sources.')));
        body.appendChild(el('p', 'hm-drawer-src u-dim', T('数据：COSMOS.DATA.milestones', 'Data: COSMOS.DATA.milestones')));
      });
    }

    /* 初始同步 */
    setYear(year, false);

    function update(p, o) {
      if (drawerOwner === 'history' && o != null && o < 0.55) closeDrawer();
      if (!playing) return;
      if (o != null && o < 0.45) { stopPlay(); return; }
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const dt = lastTick ? Math.min(0.3, (now - lastTick) / 1000) : 0;
      lastTick = now;
      if (!dt) return;
      playAcc += dt * 2; // 约 2 年 / 秒
      if (playAcc < 1) return;
      const step = Math.floor(playAcc);
      playAcc -= step;
      const next = year + step;
      if (next >= YEAR_MAX) {
        setYear(YEAR_MAX, true);
        stopPlay();
      } else {
        setYear(next, true);
      }
    }

    /* Esc / 复位：停播并回到默认年份（1969） */
    function reset() {
      stopPlay();
      setYear(1969, true);
    }

    return { update: update, reset: reset };
  });

  /* ============================================================
   * 11 载具 · 现役与未来
   * ============================================================ */
  function kindGroup(v) {
    var k = String(v.kind || '');
    if (k === '望远镜' || /telescope/i.test(k)) return 'telescope';
    if (k === '空间站' || /station/i.test(k)) return 'station';
    return 'rocket';
  }

  function kindLabel(v) {
    const g = kindGroup(v);
    return g === 'telescope' ? T('空间望远镜', 'Space telescope') : g === 'station' ? T('空间站', 'Space station') : T('运载火箭', 'Launch vehicle');
  }

  function metricText(v) {
    const g = kindGroup(v);
    if (g === 'rocket') return T('高 ', 'Height ') + fmtMeters(v.heightM) + ' · LEO ' + fmtTons(v.leoKg);
    if (g === 'telescope') return T('主镜 ', 'Primary mirror ') + fmtMeters(v.diameterM) + T(' · 长 ', ' · length ') + fmtMeters(v.heightM);
    return T('结构 ', 'Structure ') + fmtMeters(v.heightM) + T(' · 质量 ', ' · mass ') + fmtTons(v.leoKg);
  }

  /* 高度图量程：按最高运载火箭向上取整到 20 米 */
  function chartMaxM() {
    let max = 0;
    for (let i = 0; i < VEHICLES.length; i++) {
      const v = VEHICLES[i];
      if (kindGroup(v) === 'rocket' && v.heightM > max) max = v.heightM;
    }
    return Math.max(20, Math.ceil(max / 20) * 20);
  }

  function buildVehicleChart() {
    const rows = VEHICLES.filter(function (v) { return kindGroup(v) === 'rocket'; })
      .sort(function (a, b) { return b.heightM - a.heightM; });
    if (!rows.length) return '';

    const MAX = chartMaxM();
    const W = 600;
    const LEFT = 118;
    const RIGHT = 56;
    const TOP = 52;
    const ROW = 26;
    const H = TOP + rows.length * ROW + 26;
    const plotW = W - LEFT - RIGHT;
    const scale = plotW / MAX;
    const low = rows[rows.length - 1];

    let svg = '<svg class="hm-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      T('运载火箭高度对比：', 'Launch vehicle height comparison: ') + esc(rows[0].name) + ' ' + rows[0].heightM + T(' 米最高，', ' m tallest; ') +
      esc(low.name) + ' ' + low.heightM + T(' 米最矮', ' m shortest') + '">';
    svg += '<title>' + T('运载火箭高度对比（米）', 'Launch vehicle height comparison (m)') + '</title>';
    svg += '<desc>' + T('按真实高度绘制的横向条形图，共 ', 'Horizontal bar chart drawn to true scale, covering ') + rows.length + T(' 种运载火箭。', ' launch vehicles.') + '</desc>';

    const bottom = TOP + rows.length * ROW;
    for (let m = 0; m <= MAX; m += 20) {
      const x = LEFT + m * scale;
      svg += '<line class="s-grid" x1="' + x + '" y1="' + (TOP - 10) + '" x2="' + x + '" y2="' + bottom + '"/>';
      svg += '<text class="s-tick" x="' + x + '" y="' + (bottom + 16) + '" text-anchor="middle">' + m + '</text>';
    }
    svg += '<line class="s-axis" x1="' + LEFT + '" y1="' + (TOP - 10) + '" x2="' + LEFT + '" y2="' + bottom + '"/>';
    svg += '<text class="s-tick" x="' + (LEFT + plotW + 10) + '" y="' + (bottom + 16) + '">' + T('米', 'm') + '</text>';

    for (let i = 0; i < rows.length; i++) {
      const v = rows[i];
      const y = TOP + i * ROW;
      const w = v.heightM * scale;
      const kd = String(v.kind || '');
      const cls = (kd === '在研火箭' || /develop|planned|concept|在研/i.test(kd)) ? 's-bar s-bar-dev'
        : (kd === '历史火箭' || /histor|retired|legacy|历史/i.test(kd)) ? 's-bar s-bar-hist' : 's-bar';
      svg += '<text class="s-label" x="' + (LEFT - 10) + '" y="' + (y + 16) + '" text-anchor="end">' + esc(v.name) + '</text>';
      svg += '<rect class="' + cls + '" x="' + LEFT + '" y="' + (y + 7) + '" width="' + w.toFixed(1) + '" height="11"/>';
      svg += '<text class="s-val" x="' + (LEFT + w + 7) + '" y="' + (y + 16) + '">' + v.heightM + T(' 米', ' m') + '</text>';
    }
    svg += '</svg>';
    return svg;
  }

  COSMOS.registerWidget('vehicles', function (host, content, section) {
    const wrap = el('div', 'hm hm-veh');
    host.appendChild(wrap);
    const panel = el('div', 'hm-panel hm-veh-panel panel');
    wrap.appendChild(panel);

    const head = el('div', 'hm-panel-head hm-veh-head');
    const headMain = el('div', 'hm-head-main');
    headMain.appendChild(el('p', 'u-kicker', T('载具档案 · VEHICLES', 'Vehicles · Archive')));
    headMain.appendChild(el('p', 'hm-sub', T('真实高度 · 运力 · 口径', 'True height · payload capacity · aperture')));
    const count = el('span', 'hm-count u-mono', VEHICLES.length + T(' 项', ' vehicles'));
    count.setAttribute('aria-live', 'polite');
    head.appendChild(headMain);
    head.appendChild(count);
    panel.appendChild(head);

    const tabs = el('div', 'tabs hm-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', T('载具筛选', 'Vehicle filter'));
    const filters = [
      { id: 'all', label: T('全部', 'All') },
      { id: 'rocket', label: T('运载火箭', 'Launch vehicles') },
      { id: 'telescope', label: T('望远镜', 'Telescopes') },
      { id: 'station', label: T('空间站', 'Space stations') }
    ];
    const filterBtns = [];
    filters.forEach(function (f) {
      const b = el('button', 'tab', f.label);
      b.type = 'button';
      b.dataset.filter = f.id;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { applyFilter(f.id, true); });
      tabs.appendChild(b);
      filterBtns.push(b);
    });
    tabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const idx = filterBtns.indexOf(doc.activeElement);
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = filterBtns[(idx + dir + filterBtns.length) % filterBtns.length];
      if (next) { next.focus(); applyFilter(next.dataset.filter, true); }
    });
    panel.appendChild(tabs);

    const scroll = el('div', 'hm-veh-scroll');
    panel.appendChild(scroll);

    const chartBlock = el('div', 'hm-chart-block');
    chartBlock.innerHTML = buildVehicleChart();
    if (chartBlock.firstChild) {
      scroll.appendChild(chartBlock);
      const legend = el('ul', 'legend hm-legend');
      [
        { cls: '', label: T('已服役', 'In service') },
        { cls: 'is-dev', label: T('在研', 'In development') },
        { cls: 'is-hist', label: T('历史', 'Retired') }
      ].forEach(function (x) {
        const li = el('li', 'legend-item');
        const dot = el('span', 'legend-dot hm-legend-dot ' + x.cls);
        li.appendChild(dot);
        li.appendChild(el('span', '', x.label));
        legend.appendChild(li);
      });
      chartBlock.appendChild(legend);
      chartBlock.appendChild(el('p', 'hm-note u-dim',
        T('按 0 — ' + chartMaxM() + ' 米量程绘制。高度为首飞状态的总高，随构型变化。',
          'Drawn on a 0 — ' + chartMaxM() + ' m scale. Heights are total height in the first-flight configuration and change with the build.')));
    }

    /* 望远镜与空间站：不按高度比较，单独列尺寸 */
    const extra = el('div', 'hm-veh-extra');
    function extraCol(title, filterFn, unitText) {
      const col = el('div', 'hm-extra-col');
      col.appendChild(el('h4', 'hm-sub4', title));
      const rows = VEHICLES.filter(filterFn);
      rows.forEach(function (v) {
        const row = el('div', 'hm-xrow');
        row.appendChild(el('span', 'hm-xrow-name', v.name));
        row.appendChild(el('span', 'hm-xrow-val u-mono', unitText(v)));
        col.appendChild(row);
      });
      return col;
    }
    const colTelescope = extraCol(T('望远镜 · 口径与尺寸', 'Telescopes · aperture and size'), function (v) { return kindGroup(v) === 'telescope'; }, function (v) {
      return T('主镜 ', 'Primary mirror ') + v.diameterM + T(' 米 · 长 ', ' m · length ') + v.heightM + T(' 米', ' m');
    });
    extra.appendChild(colTelescope);
    const colStation = extraCol(T('空间站 · 结构与质量', 'Space stations · structure and mass'), function (v) { return kindGroup(v) === 'station'; }, function (v) {
      return v.heightM + T(' 米 · ', ' m · ') + fmtTons(v.leoKg);
    });
    extra.appendChild(colStation);
    scroll.appendChild(extra);
    const extraNote = el('p', 'hm-note u-dim',
      T('望远镜与空间站不按“高度”参与火箭对比，避免误导；空间站数字为结构尺寸与质量，不是运载能力。',
        'Telescopes and space stations are not ranked by “height” against launch vehicles, to avoid a misleading comparison; station figures are structural size and mass, not launch capacity.'));
    scroll.appendChild(extraNote);

    const grid = el('div', 'hm-veh-grid');
    const cards = [];
    VEHICLES.forEach(function (v) {
      const card = el('button', 'hm-vcard');
      card.type = 'button';
      card.dataset.group = kindGroup(v);
      card.setAttribute('aria-label', EN ? v.name + T(' — 详情', ' — details') : v.name + T('（', ' (') + v.en + T('）详情', ') — details'));
      const topRow = el('span', 'hm-vcard-top');
      topRow.appendChild(el('span', 'hm-vcard-name', v.name));
      topRow.appendChild(el('span', 'hm-vkind', kindLabel(v)));
      card.appendChild(topRow);
      if (!EN) card.appendChild(el('span', 'hm-vcard-en u-kicker', v.en || ''));
      card.appendChild(el('span', 'hm-vcard-metrics u-mono', metricText(v)));
      card.appendChild(el('span', 'hm-vcard-meta', (v.country || '—') + ' · ' + firstYearText(v.firstFlight)));
      card.addEventListener('click', function () { openVehicle(v); });
      grid.appendChild(card);
      cards.push(card);
    });
    scroll.appendChild(grid);

    function applyFilter(id, reveal) {
      const isRocket = id === 'all' || id === 'rocket';
      filterBtns.forEach(function (b) {
        const on = b.dataset.filter === id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      /* 火箭高度图只在“全部 / 运载火箭”时有意义；望远镜、空间站各自只看自己的表 */
      if (chartBlock.firstChild) chartBlock.hidden = !isRocket;
      colTelescope.hidden = !(id === 'all' || id === 'telescope');
      colStation.hidden = !(id === 'all' || id === 'station');
      extraNote.hidden = id !== 'all';
      let shown = 0;
      for (let i = 0; i < cards.length; i++) {
        const ok = id === 'all' || cards[i].dataset.group === id;
        cards[i].hidden = !ok;
        if (ok) shown++;
      }
      count.textContent = (id === 'all' ? VEHICLES.length : shown) + ' / ' + VEHICLES.length + T(' 项', ' vehicles');
      /* 卡片在图表与表格下方，点筛选后把结果滚进视野，否则看起来毫无反应 */
      if (reveal) {
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const target = id === 'all' ? wrap : grid;
        if (target && target.scrollIntoView) {
          target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        }
      }
    }
    applyFilter('all');

    function addFact(dl, label, value) {
      dl.appendChild(el('dt', '', label));
      dl.appendChild(el('dd', '', value));
    }

    function openVehicle(v) {
      const group = kindGroup(v);
      openDrawer('vehicles', kindLabel(v) + ' · ' + (v.country || ''), v.name, function (body) {
        if (!EN && v.en) body.appendChild(el('p', 'hm-drawer-en u-kicker', v.en));
        const fig = v.photo ? photoFigure(v.photo, v.photoCap || (v.name + T(' — 公开影像，本地存储', ' — public-domain image, stored locally'))) : schematicVehicle(v);
        if (fig) body.appendChild(fig);
        const dl = el('dl', 'hm-facts-list');
        addFact(dl, T('机构 / 国家', 'Agency / country'), v.country || '—');
        addFact(dl, T('首飞 / 发射', 'First flight / launch'), firstYearText(v.firstFlight));
        if (group === 'rocket') {
          addFact(dl, T('高度', 'Height'), fmtMeters(v.heightM));
          addFact(dl, T('直径', 'Diameter'), fmtMeters(v.diameterM));
          addFact(dl, T('LEO 运力', 'LEO payload'), fmtTons(v.leoKg));
        } else if (group === 'telescope') {
          addFact(dl, T('主镜口径', 'Primary mirror diameter'), fmtMeters(v.diameterM));
          addFact(dl, T('长度 / 展开', 'Length / deployed'), fmtMeters(v.heightM));
        } else {
          addFact(dl, T('结构尺寸', 'Structural size'), fmtMeters(v.heightM));
          addFact(dl, T('质量', 'Mass'), fmtTons(v.leoKg));
        }
        body.appendChild(dl);
        body.appendChild(el('p', 'hm-drawer-text', v.desc || ''));
        body.appendChild(el('p', 'hm-drawer-src u-dim',
          group === 'station' ? T('数字为结构尺寸与在轨质量，不是运载能力。', 'Figures are structural size and on-orbit mass, not launch capacity.')
                              : T('数据：COSMOS.DATA.vehicles', 'Data: COSMOS.DATA.vehicles')));
        body.appendChild(el('p', 'hm-drawer-src u-dim',
          v.photo ? T('影像来源：', 'Image source: ') + (v.photoCredit || T('公开影像库', 'public image archive')) + T('；文件存于本站本地。', '; files are stored locally on this site.')
                  : T('该载具暂无公有实拍照片，图为本站示意图。', 'No public-domain photograph is available for this vehicle; the image is a site diagram.')));
      });
    }

    function update(p, o) {
      if (drawerOwner === 'vehicles' && o != null && o < 0.55) closeDrawer();
    }

    /* Esc / 复位：回到“全部”，不滚动 */
    function reset() { applyFilter('all'); }

    return { update: update, reset: reset };
  });

  /* ============================================================
   * 12 未来计划
   * ============================================================ */
  COSMOS.registerWidget('future', function (host, content, section) {
    const wrap = el('div', 'hm hm-fut');
    host.appendChild(wrap);
    const panel = el('div', 'hm-panel hm-fut-panel panel');
    wrap.appendChild(panel);

    const plans = (content && content.futurePlans) || {};

    const head = el('div', 'hm-panel-head hm-fut-head');
    const headMain = el('div', 'hm-head-main');
    headMain.appendChild(el('p', 'u-kicker', T('计划档案 · WHAT’S NEXT', 'What’s Next · Archive')));
    headMain.appendChild(el('p', 'hm-sub', T('时间表 · 两道可计算的题', 'Timeline · two calculators')));
    head.appendChild(el('span', 'hm-count u-mono', FUTURE.length + T(' 项', ' plans')));
    panel.appendChild(head);

    const scroll = el('div', 'hm-fut-scroll');
    panel.appendChild(scroll);

    /* 计划卡 */
    const planGrid = el('div', 'hm-plan-grid');
    FUTURE.forEach(function (p) {
      const card = el('button', 'hm-plan');
      card.type = 'button';
      card.setAttribute('aria-label', p.name + T('，查看详情', ' — view details'));
      card.appendChild(el('span', 'hm-plan-hor u-mono', p.horizon || '—'));
      const nameRow = el('span', 'hm-plan-namerow');
      nameRow.appendChild(el('span', 'hm-plan-name', p.name));
      card.appendChild(nameRow);
      if (!EN) card.appendChild(el('span', 'hm-plan-en u-kicker', p.en || ''));
      card.appendChild(el('span', 'hm-plan-agency', p.agency || ''));
      card.appendChild(el('span', 'hm-plan-desc', p.desc || ''));
      card.addEventListener('click', function () { openPlan(p); });
      planGrid.appendChild(card);
    });
    scroll.appendChild(planGrid);

    /* ---------- 计算器 1：火星旅行时间 ---------- */
    const calcTravel = el('div', 'hm-calc');
    const travelHead = el('div', 'hm-calc-head');
    travelHead.appendChild(el('h3', 'hm-sub3', T('火星旅行时间', 'Mars travel time')));
    travelHead.appendChild(el('span', 'u-kicker hm-calc-tag', 'T = S / v'));
    calcTravel.appendChild(travelHead);

    const distRow = el('div', 'range-row');
    const distLab = el('label', '', T('距离', 'Distance'));
    const dist = el('input', 'range hm-range');
    dist.type = 'range';
    dist.id = 'hm-fut-dist';
    dist.min = '55';
    dist.max = '401';
    dist.step = '1';
    dist.value = '225';
    dist.setAttribute('aria-label', T('地火距离，55 至 401 百万千米', 'Earth–Mars distance, 55 to 401 million km'));
    distLab.htmlFor = dist.id;
    const distOut = el('output', 'range-val hm-range-val', T('2.25 亿千米', '225 million km'));
    distOut.htmlFor = dist.id;
    distRow.appendChild(distLab);
    distRow.appendChild(dist);
    distRow.appendChild(distOut);
    calcTravel.appendChild(distRow);

    const speedWrap = el('div', 'hm-speeds');
    speedWrap.setAttribute('role', 'group');
    speedWrap.setAttribute('aria-label', T('平均速度', 'Average speed'));
    const speeds = [4, 7, 12];
    let speed = 7;
    const speedBtns = [];
    speeds.forEach(function (s) {
      const b = el('button', 'chip hm-speed', s + ' km/s');
      b.type = 'button';
      b.dataset.speed = String(s);
      b.setAttribute('aria-pressed', s === speed ? 'true' : 'false');
      b.className += s === speed ? ' is-on' : '';
      b.addEventListener('click', function () {
        speed = s;
        speedBtns.forEach(function (x) {
          const on = parseInt(x.dataset.speed, 10) === s;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        calcTravelResult();
      });
      speedWrap.appendChild(b);
      speedBtns.push(b);
    });
    calcTravel.appendChild(speedWrap);

    const travelResult = el('p', 'hm-calc-result');
    const travelDays = el('b', 'hm-result-v', '—');
    const travelMonths = el('span', 'hm-result-s', '');
    travelResult.appendChild(travelDays);
    travelResult.appendChild(el('span', 'hm-result-l', T(' 天', ' days')));
    travelResult.appendChild(travelMonths);
    calcTravel.appendChild(travelResult);
    calcTravel.appendChild(el('p', 'hm-note u-dim',
      T('按直线距离与恒定速度估算。真实任务沿霍曼转移轨道，单程约 6–9 个月；本计算只作数量级示意。',
        'Straight-line distance at constant speed. Real missions follow a Hohmann transfer orbit — about 6–9 months one way. This calculation only shows the order of magnitude.')));
    scroll.appendChild(calcTravel);

    function calcTravelResult() {
      const mkm = parseInt(dist.value, 10);
      /* mkm 单位是百万千米：百万千米 ÷ (千米/秒) = 秒 */
      const seconds = mkm * 1e6 / speed;
      const days = seconds / 86400;
      const months = days / MONTH_DAYS;
      distOut.textContent = T((mkm / 100).toFixed(2) + ' 亿千米', mkm + ' million km');
      travelDays.textContent = T('约 ', 'About ') + fmt(Math.round(days));
      travelMonths.textContent = T('（' + months.toFixed(1) + ' 个月，速度 ' + speed + ' km/s）',
        '(' + months.toFixed(1) + ' months at ' + speed + ' km/s)');
    }
    dist.addEventListener('input', calcTravelResult);

    /* ---------- 计算器 2：火星体重 ---------- */
    const calcWeight = el('div', 'hm-calc');
    const weightHead = el('div', 'hm-calc-head');
    weightHead.appendChild(el('h3', 'hm-sub3', T('火星体重', 'Weight on Mars')));
    weightHead.appendChild(el('span', 'u-kicker hm-calc-tag', 'W = m · g'));
    calcWeight.appendChild(weightHead);

    const kgRow = el('div', 'hm-kg-row');
    const kgLab = el('label', 'hm-kg-label', T('地球体重', 'Weight on Earth'));
    const kgInput = el('input', 'hm-input');
    kgInput.type = 'number';
    kgInput.id = 'hm-fut-kg';
    kgInput.min = '20';
    kgInput.max = '200';
    kgInput.step = '1';
    kgInput.value = '60';
    kgInput.inputMode = 'numeric';
    kgInput.setAttribute('aria-label', T('地球体重，单位千克', 'Weight on Earth, in kilograms'));
    kgLab.htmlFor = kgInput.id;
    kgRow.appendChild(kgLab);
    kgRow.appendChild(kgInput);
    kgRow.appendChild(el('span', 'hm-kg-unit', 'kg'));
    calcWeight.appendChild(kgRow);

    const wgrid = el('div', 'hm-wgrid');
    function weightCol(label, cls) {
      const box = el('div', 'hm-w ' + cls);
      box.appendChild(el('span', 'u-kicker', label));
      const v = el('span', 'hm-w-v', '—');
      box.appendChild(v);
      box.appendChild(el('span', 'hm-w-u', 'kg'));
      return { box: box, value: v };
    }
    const earthCol = weightCol(T('地球', 'Earth'), 'is-earth');
    const marsCol = weightCol(T('火星', 'Mars'), 'is-mars');
    wgrid.appendChild(earthCol.box);
    wgrid.appendChild(marsCol.box);
    calcWeight.appendChild(wgrid);

    const jumpLine = el('p', 'hm-jump');
    jumpLine.appendChild(el('span', 'hm-jump-l', T('跳高约 ', 'Jump about ')));
    const jumpV = el('b', 'hm-jump-v', '—');
    jumpLine.appendChild(jumpV);
    jumpLine.appendChild(el('span', 'hm-jump-l', T('（同样的蹬地力）', ' (same push-off force)')));
    calcWeight.appendChild(jumpLine);
    const gravityNote = el('p', 'hm-note u-dim', '');
    calcWeight.appendChild(gravityNote);
    calcWeight.appendChild(el('p', 'hm-note u-dim',
      T('质量不变，变的是秤的读数：同一质量在火星上称出来比在地球上轻。',
        'Mass stays the same; only the scale reading changes. The same mass weighs less on Mars than on Earth.')));
    scroll.appendChild(calcWeight);

    function calcWeightResult() {
      let kg = parseFloat(kgInput.value);
      if (!isFinite(kg)) kg = 60;
      kg = clamp(kg, 20, 200);
      const marsPlanet = DATA.planetById ? DATA.planetById('mars') : null;
      const earthPlanet = DATA.planetById ? DATA.planetById('earth') : null;
      const gM = marsPlanet && marsPlanet.gravity ? marsPlanet.gravity : 3.71;
      const gE = earthPlanet && earthPlanet.gravity ? earthPlanet.gravity : 9.807;
      const marsKg = kg * gM / gE;
      earthCol.value.textContent = kg.toFixed(1);
      marsCol.value.textContent = marsKg.toFixed(1);
      jumpV.textContent = T('≈ ', '') + (gE / gM).toFixed(2) + T(' 倍', '× higher');
      gravityNote.textContent = T('火星重力 ' + gM + ' m/s²，是地球 ' + gE + ' m/s² 的 ' + (gM / gE * 100).toFixed(1) + '%。',
        'Mars gravity is ' + gM + ' m/s² — about ' + (gM / gE * 100).toFixed(1) + '% of Earth’s ' + gE + ' m/s².');
    }
    kgInput.addEventListener('input', calcWeightResult);
    kgInput.addEventListener('change', function () {
      let kg = parseFloat(kgInput.value);
      if (!isFinite(kg)) kg = 60;
      kgInput.value = String(clamp(Math.round(kg), 20, 200));
      calcWeightResult();
    });

    /* ---------- 时间线（从 DATA.future[].items / horizon 解析年份） ---------- */
    const tlBlock = el('div', 'hm-tl-block');
    tlBlock.appendChild(el('h3', 'hm-sub3', T('关键时间节点', 'Key dates')));
    const tlList = el('ol', 'hm-tl');
    const tlRows = [];
    FUTURE.forEach(function (p) {
      const itemYears = [];
      (p.items || []).forEach(function (item) {
        const m = /(20\d{2})/.exec(item);
        if (m) {
          itemYears.push(parseInt(m[1], 10));
          tlRows.push({ year: parseInt(m[1], 10), text: item, plan: p.name, p: p });
        }
      });
      const hm = /(20\d{2})/.exec(p.horizon || '');
      if (hm) {
        const hy = parseInt(hm[1], 10);
        if (itemYears.indexOf(hy) === -1) {
          tlRows.push({ year: hy, text: p.horizon + ' · ' + p.name, plan: p.name, p: p });
        }
      }
    });
    tlRows.sort(function (a, b) { return a.year - b.year; });
    tlRows.forEach(function (r) {
      const li = el('li', 'hm-tl-item');
      const b = el('button', 'hm-tl-row');
      b.type = 'button';
      b.setAttribute('aria-label', r.year + T('，', ': ') + r.text);
      b.appendChild(el('span', 'hm-tl-year u-mono', String(r.year)));
      b.appendChild(el('span', 'hm-tl-dot', ''));
      b.appendChild(el('span', 'hm-tl-text', r.text));
      b.appendChild(el('span', 'hm-tl-plan', r.plan));
      b.addEventListener('click', function () { if (r.p) openPlan(r.p); });
      li.appendChild(b);
      tlList.appendChild(li);
    });
    tlBlock.appendChild(tlList);
    if (tlRows.length) {
      tlBlock.appendChild(el('p', 'hm-note u-dim',
        T('年份取自《未来计划》数据条目（' + tlRows[0].year + ' — ' + tlRows[tlRows.length - 1].year + '）；计划时间可能调整。',
          'Years come from the What’s Next dataset (' + tlRows[0].year + ' — ' + tlRows[tlRows.length - 1].year + '); schedules may change.')));
    }
    scroll.appendChild(tlBlock);

    calcTravelResult();
    calcWeightResult();

    /* ---------- 计划详情 ---------- */
    function openPlan(p) {
      const extra = plans[p.id] || {};
      openDrawer('future', T('未来计划 · ', 'What’s Next · ') + (p.horizon || ''), p.name, function (body) {
        body.appendChild(el('p', 'hm-drawer-meta u-mono', (p.agency || '—') + ' · ' + (p.horizon || '—')));
        if (!EN && p.en) body.appendChild(el('p', 'hm-drawer-en u-kicker', p.en));
        if (p.photo) {
          const fig = photoFigure(p.photo, p.photoCap || (p.name + T(' — 公开影像，本地存储', ' — public-domain image, stored locally')));
          if (fig) body.appendChild(fig);
        } else {
          const box = el('div', 'hm-poster');
          box.innerHTML = svgOrbit() + '<p class="hm-poster-cap">' + T('示意图 · 非实拍', 'Diagram · not a photograph') + '</p>';
          body.appendChild(box);
        }
        body.appendChild(el('p', 'hm-drawer-text', p.desc || ''));
        if ((p.items || []).length) {
          body.appendChild(el('h4', 'hm-drawer-h4', T('关键步骤', 'Key steps')));
          const ul = el('ul', 'hm-drawer-list');
          p.items.forEach(function (item) {
            ul.appendChild(el('li', '', item));
          });
          body.appendChild(ul);
        }
        if (extra.status) {
          body.appendChild(el('h4', 'hm-drawer-h4', T('现状', 'Status')));
          body.appendChild(el('p', 'hm-drawer-text', extra.status));
        }
        if (extra.challenge) {
          body.appendChild(el('h4', 'hm-drawer-h4', T('主要挑战', 'Main challenges')));
          body.appendChild(el('p', 'hm-drawer-text', extra.challenge));
        }
        body.appendChild(el('p', 'hm-drawer-src u-dim',
          T('计划时间与机构：COSMOS.DATA.future（NASA / ESA / CNSA 公开计划）；图片为公开影像，本站本地存储。',
            'Timeline and agencies: COSMOS.DATA.future (public NASA / ESA / CNSA plans); images are public-domain and stored locally on this site.')));
      });
    }

    function update(p, o) {
      if (drawerOwner === 'future' && o != null && o < 0.55) closeDrawer();
    }

    return { update: update };
  });
})(window.COSMOS = window.COSMOS || {});
