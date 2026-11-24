/* ==========================================================================
   COSMOS ATLAS · 语言层（i18n）
   - 语言在首帧渲染前确定：URL ?lang= > localStorage > 默认中文
   - 切换采用整页重载（复用四色幕布），避免 three.js 场景 / 控件热替换的状态问题
   - 用法：var T = COSMOS.i18n.T; T('中文', 'English')
   ========================================================================== */
(function (COSMOS) {
  'use strict';

  const LS_KEY = 'cosmos-lang';
  const root = document.documentElement;

  function norm(v) {
    v = String(v || '').toLowerCase();
    if (v.indexOf('en') === 0) return 'en';
    if (v.indexOf('zh') === 0) return 'zh';
    return '';
  }

  function fromQuery() {
    try {
      const m = /[?&]lang=([A-Za-z-]+)/.exec(location.search);
      return m ? norm(m[1]) : '';
    } catch (e) { return ''; }
  }

  function fromStore() {
    try { return norm(localStorage.getItem(LS_KEY)); } catch (e) { return ''; }
  }

  const lang = fromQuery() || fromStore() || 'zh';
  const EN = lang === 'en';

  /* 双参数即时翻译：中文模式原样返回，英文模式返回英文 */
  function T(zh, en) {
    return EN ? (en == null ? zh : en) : zh;
  }

  /* 静态界面文案：[中文, English]；由 index.html 的 data-i18n / data-i18n-aria 指向 */
  const STATIC = {
    'skip': ['跳到正文', 'Skip to content'],
    'canvas-aria': ['宇宙场景实时渲染画布', 'Live-rendered cosmic scene'],
    'loader-sub': ['宇宙图谱 · 从太阳系到可观测宇宙边缘', 'COSMOS ATLAS · From the Solar System to the edge of the observable universe'],
    'loader-hint': ['正在绘制星空…', 'Drawing the starfield…'],
    'brand-aria': ['回到序章', 'Back to the prologue'],
    'nav-aria': ['章节导航', 'Chapter navigation'],
    'noscript': ['本站需要 JavaScript 与 WebGL 才能展开三维宇宙。请开启后刷新。', 'This site needs JavaScript and WebGL to unfold the 3D universe. Please enable them and reload.'],
    'lang-label': ['EN', '中文'],
    'lang-aria': ['切换到英文版', 'Switch to Chinese']
  };

  /* 章节元信息：英文模式下改写 section.dataset，HUD / 导航 / 场景标签随之切换 */
  const SECTIONS = {
    'ch-hero': { name: 'The Universe', part: 'Prologue' },
    'ch-overview': { name: 'The Cosmos', part: 'I · The Cosmos' },
    'ch-solar': { name: 'The Solar System', part: 'II · The Solar System' },
    'ch-compare': { name: 'Planetary Comparison', part: 'II · The Solar System' },
    'ch-compact': { name: 'Compact Objects', part: 'III · Deep Space' },
    'ch-galaxies': { name: 'Galaxy Zoo', part: 'IV · The Deep Universe' },
    'ch-extreme': { name: 'Extreme Universe', part: 'IV · The Deep Universe' },
    'ch-history': { name: 'Space Age', part: 'V · Human Exploration' },
    'ch-vehicles': { name: 'Launch Vehicles', part: 'V · Human Exploration' },
    'ch-future': { name: "What's Next", part: 'V · Human Exploration' },
    'ch-finale': { name: 'Pale Blue Dot', part: 'Finale' }
  };

  function applyStatic() {
    root.lang = EN ? 'en' : 'zh-CN';
    document.title = T('COSMOS ATLAS · 宇宙图谱', 'COSMOS ATLAS · The Universe Atlas');

    const desc = document.querySelector('meta[name="description"]');
    if (desc) {
      desc.setAttribute('content', T(
        'COSMOS ATLAS · 宇宙图谱 —— 从太阳系到可观测宇宙边缘的沉浸式天文图谱。3D 太阳系、行星对比、黑洞、恒星一生、星系动物园、航天史与未来计划。',
        'COSMOS ATLAS — an immersive map of the universe, from the Solar System to the edge of the observable cosmos: a 3D Solar System, planetary comparisons, black holes, the life of stars, a galaxy zoo, spaceflight history and future missions.'
      ));
    }

    const nodes = document.querySelectorAll('[data-i18n]');
    for (let i = 0; i < nodes.length; i++) {
      const pair = STATIC[nodes[i].getAttribute('data-i18n')];
      if (pair) nodes[i].textContent = EN ? pair[1] : pair[0];
    }

    const arias = document.querySelectorAll('[data-i18n-aria]');
    for (let j = 0; j < arias.length; j++) {
      const ap = STATIC[arias[j].getAttribute('data-i18n-aria')];
      if (ap) arias[j].setAttribute('aria-label', EN ? ap[1] : ap[0]);
    }

    if (EN) {
      for (const id in SECTIONS) {
        if (!Object.prototype.hasOwnProperty.call(SECTIONS, id)) continue;
        const sec = document.getElementById(id);
        if (!sec) continue;
        sec.dataset.name = SECTIONS[id].name;
        sec.dataset.part = SECTIONS[id].part;
      }
    }
  }

  function reduceMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  /* 切换语言：写 localStorage + 同步 URL 的 lang 参数，然后整页重载（保留章节 hash） */
  function switchTo(next) {
    next = next === 'en' ? 'en' : 'zh';
    if (next === lang) return;

    try { localStorage.setItem(LS_KEY, next); } catch (e) { /* file:// 下可能不可用，URL 参数兜底 */ }

    let url = location.href;
    if (/[?&]lang=/i.test(url)) {
      url = url.replace(/([?&]lang=)[^&#]*/i, '$1' + next);
    } else {
      let hash = '';
      const h = url.indexOf('#');
      if (h >= 0) { hash = url.slice(h); url = url.slice(0, h); }
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 'lang=' + next + hash;
    }

    const go = function () { location.href = url; };
    if (reduceMotion()) { go(); return; }

    const curtain = document.getElementById('curtain');
    if (curtain) curtain.classList.add('on', 'in');
    setTimeout(go, 460);
  }

  function init() {
    applyStatic();
    const btn = document.getElementById('lang-toggle');
    if (!btn) return;
    btn.textContent = EN ? '中文' : 'EN';
    btn.setAttribute('aria-label', EN ? 'Switch to Chinese' : '切换到英文版');
    btn.addEventListener('click', function () { switchTo(EN ? 'zh' : 'en'); });
  }

  COSMOS.i18n = {
    lang: lang,
    en: EN,
    T: T,
    STATIC: STATIC,
    switchTo: switchTo
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.COSMOS = window.COSMOS || {});
