/* ============================================================
 * COSMOS ATLAS · 界面层（v2）
 * ------------------------------------------------------------
 * 职责：
 *   1) 按 COSMOS.CONTENT 把 12 个 section 渲染成 sticky 全屏版式；
 *   2) 挂载 COSMOS.widgets 注册的章节组件（DOM 控件）；
 *   3) 章节导航 / HUD / 光标 / 进度条 / 灯箱 / 深链按钮；
 *   4) 把滚动进度 p 与可见度 o 分发到章节与 widget。
 *
 * 契约：docs/V2-PLAN.md §10
 *   - 章节结构：.ch-inner[layout-*] > .ch-scrim + .ch-copy + .ch-widget
 *   - 互动章（BRIEF_CHAPTERS）：.ch-inner > .ch-brief（一句话）+ .ch-widget，
 *     不生成 .ch-scrim/.ch-copy；正文收进 body 级 .ch-archive 浮层
 *   - .ch-widget 绝对铺满视口（pointer-events:none），子元素自行开启 auto
 *   - 组件：COSMOS.widgets[id](el, content, section) → { update(p, o) }
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const doc = document;
  const U = COSMOS.util;
  const T = (COSMOS.i18n && COSMOS.i18n.T) || function (zh) { return zh; };
  const h = (COSMOS.dom && COSMOS.dom.h) || COSMOS.h;
  const richText = (COSMOS.util && COSMOS.util.richText) || (COSMOS.dom && COSMOS.dom.richText) || function (s) { return String(s == null ? '' : s); };

  let sections = [];
  let metas = [];
  let mounted = [];       // 与 sections 等长：{ el, api } 或 null
  let goToFn = null;
  let currentIndex = -1;
  let railFill = null;
  let hudPart = null;
  let hudCoord = null;
  let hudChapter = null;
  let navEl = null;
  let navItems = [];

  const TOTAL_PAD = 2;

  /* ============================================================
   * 小工具
   * ============================================================ */
  function t(tag, cls, text) {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function num(v) {
    return typeof v === 'number' ? String(v) : (v == null ? '' : String(v));
  }

  function tagLine(c, section) {
    const row = t('div', 'ch-tag');
    row.appendChild(t('span', 'ch-num', c.num || section.dataset.num || ''));
    const part = c.part || section.dataset.part || '';
    if (part) row.appendChild(t('span', 'ch-part', part));
    row.appendChild(t('span', 'ch-rule'));
    const en = c.titleEn || section.dataset.en || '';
    if (en) row.appendChild(t('span', 'ch-en', en));
    return row;
  }

  function factList(facts) {
    const ul = t('ul', 'ch-facts');
    (facts || []).forEach(function (f) {
      if (!f) return;
      const li = t('li', 'fact');
      const val = t('span', 'fact-v', num(f.v));
      if (f.u) val.appendChild(t('span', 'fact-u', f.u));
      li.appendChild(val);
      if (f.l) li.appendChild(t('span', 'fact-l', f.l));
      ul.appendChild(li);
    });
    return ul;
  }

  function quoteBlock(q) {
    if (!q || !q.text) return null;
    const bq = t('blockquote', 'ch-quote');
    bq.appendChild(t('p', 'ch-quote-text', q.text));
    if (q.cite) bq.appendChild(t('cite', 'ch-quote-cite', '— ' + q.cite));
    return bq;
  }

  function hintLine(text) {
    if (!text) return null;
    const p = t('p', 'ch-hint');
    p.appendChild(t('span', 'ch-hint-mark', '↗'));
    p.appendChild(t('span', 'ch-hint-text', text));
    return p;
  }

  /* ============================================================
   * 三种版式
   * ============================================================ */
  function renderHero(section, c) {
    const inner = t('div', 'ch-inner layout-hero');
    const copy = t('div', 'hero-copy');

    if (c.kicker) copy.appendChild(t('p', 'u-kicker hero-kicker', c.kicker));

    const title = t('h1', 'hero-title');
    title.appendChild(t('span', 'hero-title-cn', c.title || '宇宙'));
    title.appendChild(t('span', 'hero-title-en', c.titleEn || 'THE UNIVERSE'));
    copy.appendChild(title);

    if (c.lead) copy.appendChild(t('p', 'hero-lead', c.lead));

    if (c.paragraphs && c.paragraphs[0]) {
      copy.appendChild(t('p', 'hero-desc', c.paragraphs[0]));
    }

    if (c.facts && c.facts.length) {
      const dl = t('dl', 'hero-facts');
      c.facts.forEach(function (f) {
        const box = t('div', 'hero-fact');
        const dd = t('dd', 'hero-fact-v', num(f.v));
        if (f.u) dd.appendChild(t('span', 'hero-fact-u', f.u));
        box.appendChild(dd);
        box.appendChild(t('dt', 'hero-fact-l', f.l || ''));
        dl.appendChild(box);
      });
      copy.appendChild(dl);
    }

    const actions = t('div', 'hero-actions');
    if (c.cta && c.cta.label) {
      const btn = t('button', 'btn btn-primary hero-cta');
      btn.type = 'button';
      btn.dataset.goto = c.cta.goto || 'overview';
      btn.appendChild(t('span', 'btn-label', c.cta.label));
      btn.appendChild(t('span', 'btn-arrow', '→'));
      actions.appendChild(btn);
    }
    if (c.hint) actions.appendChild(t('p', 'hero-hint', c.hint));
    copy.appendChild(actions);

    inner.appendChild(copy);

    const scroll = t('div', 'hero-scroll');
    scroll.setAttribute('aria-hidden', 'true');
    scroll.appendChild(t('span', 'hero-scroll-rule'));
    scroll.appendChild(t('span', 'hero-scroll-label', T('点击顶部标签切换章节', 'Use the chapter tabs to navigate')));
    inner.appendChild(scroll);

    section.appendChild(inner);
  }

  function renderFinale(section, c) {
    const inner = t('div', 'ch-inner layout-finale');
    const copy = t('div', 'finale-copy');

    if (c.kicker) copy.appendChild(t('p', 'u-kicker', c.kicker));
    const title = t('h2', 'finale-title', c.title || section.dataset.name || '');
    copy.appendChild(title);
    if (c.titleEn) copy.appendChild(t('p', 'finale-en', c.titleEn));
    if (c.lead) copy.appendChild(t('p', 'finale-lead', c.lead));

    (c.paragraphs || []).forEach(function (p) {
      const el = t('p', 'finale-text');
      el.innerHTML = richText(p);
      copy.appendChild(el);
    });

    if (c.facts && c.facts.length) copy.appendChild(factList(c.facts));

    const q = quoteBlock(c.quote);
    if (q) copy.appendChild(q);

    copy.appendChild(buildCredits());

    const actions = t('div', 'finale-actions');
    const back = t('button', 'btn btn-ghost');
    back.type = 'button';
    back.dataset.goto = 'hero';
    back.appendChild(t('span', 'btn-label', T('回到开头', 'Back to the start')));
    back.appendChild(t('span', 'btn-arrow', '↑'));
    actions.appendChild(back);
    copy.appendChild(actions);

    inner.appendChild(copy);
    section.appendChild(inner);
  }

  function buildCredits() {
    const box = t('div', 'credits');
    box.appendChild(t('p', 'credits-title', T('影像与数据来源', 'Images & Data Sources')));

    const list = t('ul', 'credits-list');
    const sources = (COSMOS.DATA && COSMOS.DATA.sources) || [];
    sources.forEach(function (s) {
      if (!s) return;
      const li = t('li', 'credits-item');
      li.appendChild(t('span', 'credits-name', s.label || s.name || ''));
      const note = s.note || [s.org, s.license].filter(Boolean).join(' · ') || s.url || '';
      li.appendChild(t('span', 'credits-note', note));
      list.appendChild(li);
    });

    const tex = COSMOS.TEX_SOURCES || [];
    if (tex.length) {
      const li = t('li', 'credits-item');
      li.appendChild(t('span', 'credits-name', T('行星贴图', 'Planet textures')));
      li.appendChild(t('span', 'credits-note', T('Solar System Scope（CC BY 4.0），本地打包', 'Solar System Scope (CC BY 4.0), bundled locally')));
      list.appendChild(li);
    }
    if (COSMOS.TEX && COSMOS.TEX.io) {
      const li = t('li', 'credits-item');
      li.appendChild(t('span', 'credits-name', T('卫星与冥王星贴图', 'Moon & Pluto textures')));
      li.appendChild(t('span', 'credits-note', T('NASA / JPL / USGS / SwRI 派生地图；Ganymede、Callisto 由 Björn Jónsson 制作；Deimos 为 P. Stooke（CC0 1.0）', 'Derived NASA / JPL / USGS / SwRI maps; Ganymede & Callisto by Björn Jónsson; Deimos by P. Stooke (CC0 1.0)')));
      list.appendChild(li);
    }
    box.appendChild(list);
    box.appendChild(t('p', 'credits-foot', T('本站不联网、不追踪；所有影像均存储于本地。', 'No network requests, no tracking — all imagery is stored locally.')));
    return box;
  }

  /* 章节版式：lab 类章节内容较长，改为文档流（3D 留在背景），不锁一屏 */
  const FLOW_CHAPTERS = { compare: 1, history: 1, vehicles: 1, future: 1 };
  /* 互动章：首屏只留左上角一句话，长正文收进「章节档案」浮层。
     只认这两个 section id，其余章节仍走 .ch-scrim + .ch-copy 原路径。 */
  const BRIEF_CHAPTERS = { solar: 1, collision: 1 };
  /* 文档流章节的右栏影像：让首屏不是纯文字，同时给实验室一个视觉锚点 */
  const FLOW_BANNERS = {
    compare: { src: 'assets/photos/human-blue-marble.jpg', cap: T('阿波罗 17 号 · 蓝色弹珠，1972 · NASA', 'Apollo 17 · Blue Marble, 1972 · NASA') },
    history: { src: 'assets/photos/human-apollo11.jpg', cap: T('阿波罗 11 号 · 月面，1969 · NASA', 'Apollo 11 · Lunar surface, 1969 · NASA') },
    vehicles: { src: 'assets/photos/rocket-starship.jpg', cap: T('星舰 HLS · 月面概念图 · NASA', 'Starship HLS · Lunar concept · NASA') },
    future: { src: 'assets/photos/future-mars.jpg', cap: T('火星基地概念图 · NASA', 'Mars base concept · NASA') }
  };

  function renderStandard(section, c) {
    const key = section.id.replace('ch-', '');
    const layout = c.layout || 'split';
    const flow = !!(FLOW_CHAPTERS[key] || c.flow);
    // 互动章只保留左上角一句话；h2 语义保留，正文进「章节档案」浮层
    const brief = !flow && !!BRIEF_CHAPTERS[key];
    if (flow) section.classList.add('is-flow');
    if (brief) section.classList.add('is-brief');
    const inner = t('div', 'ch-inner layout-' + layout);

    if (!brief) {
      const scrim = t('div', 'ch-scrim');
      scrim.setAttribute('aria-hidden', 'true');
      inner.appendChild(scrim);
    }

    let copy = null;
    if (!brief) {
      copy = t('div', 'ch-copy');
      copy.appendChild(tagLine(c, section));
      const title = t('h2', 'ch-title');
      title.appendChild(t('span', 'ch-title-cn', c.title || section.dataset.name || ''));
      if (c.titleEn) title.appendChild(t('span', 'ch-title-en', c.titleEn));
      copy.appendChild(title);

      if (c.lead) copy.appendChild(t('p', 'ch-lead', c.lead));

      (c.paragraphs || []).forEach(function (p) {
        const el = t('p', 'ch-text');
        el.innerHTML = richText(p);
        copy.appendChild(el);
      });

      if (c.facts && c.facts.length) copy.appendChild(factList(c.facts));

      const q = quoteBlock(c.quote);
      if (q) copy.appendChild(q);

      const hint = hintLine(c.hint);
      if (hint) copy.appendChild(hint);
    }

    if (flow) {
      const ban = FLOW_BANNERS[key];
      if (ban) {
        const fig = t('figure', 'ch-banner');
        const img = t('img', 'ch-banner-img');
        img.src = ban.src;
        img.alt = ban.cap;
        img.loading = 'lazy';
        fig.appendChild(img);
        fig.appendChild(t('figcaption', 'ch-banner-cap', ban.cap));
        inner.appendChild(fig);
      }
    }

    if (brief) {
      inner.appendChild(briefBlock(section, c));
    } else {
      inner.appendChild(copy);
    }

    if (c.widget) {
      const w = t('div', 'ch-widget');
      w.dataset.widget = c.widget;
      inner.appendChild(w);
    }

    section.appendChild(inner);
  }

  /* ============================================================
   * 组件挂载
   * ============================================================ */
  function mountWidgets() {
    mounted = sections.map(function (section, index) {
      const el = section.querySelector('.ch-widget');
      if (!el) return null;
      const id = el.dataset.widget;
      const c = (COSMOS.CONTENT || {})[id === 'compare' ? 'compare' : section.id.replace('ch-', '')] || {};
      const factory = COSMOS.widgets && COSMOS.widgets[id];
      if (typeof factory !== 'function') {
        el.appendChild(t('p', 'u-dim widget-missing', T('组件 ' + id + ' 尚未载入', 'Widget ' + id + ' is not loaded')));
        return null;
      }
      try {
        const api = factory(el, c, section);
        return { el: el, api: api || null };
      } catch (e) {
        if (window.console && console.warn) console.warn('[COSMOS] widget "' + id + '" 初始化失败', e);
        el.appendChild(t('p', 'u-dim widget-missing', T('组件 ' + id + ' 初始化失败', 'Widget ' + id + ' failed to initialize')));
        return null;
      }
    });
  }

  /* ============================================================
   * 导航 / HUD
   * ============================================================ */
  const PART_KEYS = { '序章': 0, 'Prologue': 0, 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 5, '终章': 6, 'Finale': 6 };

  function renderNav() {
    navEl = doc.getElementById('nav');
    if (!navEl) return;
    clear(navEl);
    navItems = [];
    navEl.setAttribute('role', 'tablist');
    navEl.setAttribute('aria-label', T('章节标签', 'Chapter tabs'));
    sections.forEach(function (section, i) {
      const b = t('button', 'nav-item');
      b.type = 'button';
      b.dataset.index = String(i);
      const pk = ((section.dataset.part || '').split('·')[0] || '').trim();
      b.dataset.part = String(PART_KEYS[pk] != null ? PART_KEYS[pk] : 0);
      b.setAttribute('role', 'tab');
      const _num = section.dataset.num || String(i).padStart(2, '0');
      b.setAttribute('aria-label', _num + ' ' + (metas[i].name || section.dataset.name || ''));
      b.appendChild(t('span', 'nav-num', _num));
      b.appendChild(t('span', 'nav-txt', metas[i].name));
      b.appendChild(t('span', 'nav-bar'));
      const nextPart = sections[i + 1] ? ((sections[i + 1].dataset.part || '').split('·')[0] || '').trim() : null;
      if (i === sections.length - 1 || (nextPart && nextPart !== pk)) b.classList.add('is-part-end');
      b.addEventListener('click', function () {
        if (goToFn) goToFn(i);
      });
      navEl.appendChild(b);
      navItems.push(b);
    });
  }

  function bindGoto() {
    doc.addEventListener('click', function (e) {
      const el = e.target.closest ? e.target.closest('[data-goto]') : null;
      if (!el) return;
      const raw = el.getAttribute('data-goto');
      if (raw == null || raw === '') return;
      e.preventDefault();
      if (!goToFn) return;
      const n = parseInt(raw, 10);
      goToFn(isNaN(n) ? raw : n);
    });
    const brand = doc.querySelector('.brand');
    if (brand) {
      brand.addEventListener('click', function (e) {
        e.preventDefault();
        if (goToFn) goToFn(0);
      });
    }
  }

  function updateHud(section) {
    if (!section) return;
    if (hudPart) hudPart.textContent = section.dataset.part || '';
    if (hudCoord) hudCoord.textContent = section.dataset.coord || '';
    if (hudChapter) {
      const name = section.dataset.name || '';
      hudChapter.textContent = ((section.dataset.num || '00') + ' / ' +
        String(sections.length - 1).padStart(2, '0')) + (name ? ' · ' + name : '');
    }
  }

  /* ============================================================
   * 灯箱 / 抽屉（各章节组件可复用）
   * ============================================================ */
  let lightbox = null;
  let lightboxOpener = null;

  /* 灯箱内可聚焦元素（用于 Tab 焦点陷阱） */
  function lightboxFocusables(root) {
    return Array.prototype.slice.call(
      root.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])')
    ).filter(function (el) { return !el.hidden && el.offsetParent !== null; });
  }

  function ensureLightbox() {
    if (lightbox) return lightbox;
    lightbox = t('div', 'lightbox');
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', T('影像查看', 'Image viewer'));
    lightbox.hidden = true;
    const img = t('img', 'lightbox-img');
    img.alt = '';
    const cap = t('p', 'lightbox-cap');
    const close = t('button', 'lightbox-close');
    close.type = 'button';
    close.setAttribute('aria-label', T('关闭', 'Close'));
    close.textContent = '×';
    lightbox.appendChild(img);
    lightbox.appendChild(cap);
    lightbox.appendChild(close);
    doc.body.appendChild(lightbox);
    close.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });
    return lightbox;
  }

  function openLightbox(src, caption) {
    const lb = ensureLightbox();
    const img = lb.querySelector('.lightbox-img');
    const active = doc.activeElement;
    lightboxOpener = active && active !== doc.body && !lb.contains(active) ? active : null;
    img.src = src;
    img.alt = caption || '';
    lb.querySelector('.lightbox-cap').textContent = caption || '';
    lb.hidden = false;
    doc.documentElement.classList.add('has-lightbox');
    // 焦点移入对话框，关闭后归还（WCAG 2.4.3）
    const close = lb.querySelector('.lightbox-close');
    if (close) close.focus();
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    doc.documentElement.classList.remove('has-lightbox');
    const back = lightboxOpener;
    lightboxOpener = null;
    if (back && back.focus && doc.contains(back)) back.focus();
  }

  /* Tab 在灯箱内循环，不逃到背后的页面 */
  function trapLightboxTab(e) {
    if (!lightbox || lightbox.hidden) return;
    const items = lightboxFocusables(lightbox);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const cur = doc.activeElement;
    if (e.shiftKey && (cur === first || !lightbox.contains(cur))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (cur === last || !lightbox.contains(cur))) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ============================================================
   * 互动章（02/04/06/08）：左上角一句话 + 章节档案浮层
   * - 首屏不出现正文，只有「章号 · 章名 / 英文名」+ 一句话 + 小按钮
   * - 正文（lead/paragraphs/facts/quote/hint）收进 body 级 role=dialog
   * - 焦点管理与 Esc/遮罩关闭沿用灯箱同一套做法
   * ============================================================ */
  /* 章标签：中文模式中英并列，英文模式不回显中文，避免中英混排 */
  function fillChapterLabel(el, c, section) {
    el.appendChild(t('span', 'ch-brief-num', c.num || section.dataset.num || ''));
    el.appendChild(t('span', 'ch-brief-sep', '·'));
    el.appendChild(t('span', 'ch-brief-name', c.title || section.dataset.name || ''));
    const alt = COSMOS.i18n && COSMOS.i18n.en ? '' : (c.titleEn || '');
    if (alt) el.appendChild(t('span', 'ch-brief-en', '/ ' + alt));
    return el;
  }

  /* 一句话：优先 oneLiner；字段缺失时从 lead 截一句，不新增文案来源 */
  function oneLinerOf(c) {
    if (c.oneLiner) return c.oneLiner;
    const cut = (c.lead || '').split(/[。！？]/)[0];
    return cut.length > 40 ? cut.slice(0, 39) + '…' : cut;
  }

  function briefBlock(section, c) {
    const box = t('div', 'ch-brief');
    box.appendChild(fillChapterLabel(t('h2', 'ch-brief-title'), c, section));
    const line = oneLinerOf(c);
    if (line) box.appendChild(t('p', 'ch-brief-line', line));
    const btn = t('button', 'ch-brief-btn');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-label', T('打开章节档案：', 'Open chapter file: ') + (c.title || section.dataset.name || ''));
    btn.appendChild(t('span', 'ch-brief-btn-icon', 'ⓘ'));
    btn.appendChild(t('span', 'ch-brief-btn-label', T('章节档案', 'Chapter file')));
    btn.addEventListener('click', function () { openArchive(section, c, btn); });
    box.appendChild(btn);
    return box;
  }

  let archive = null;
  let archiveOpener = null;

  function ensureArchive() {
    if (archive) return archive;
    archive = t('div', 'ch-archive');
    archive.setAttribute('role', 'dialog');
    archive.setAttribute('aria-modal', 'true');
    archive.setAttribute('aria-labelledby', 'ch-archive-title');
    // data-ui：boot.js 据此把指针/滚轮让给浮层，不落到背后的 3D 场景
    archive.setAttribute('data-ui', 'archive');
    archive.hidden = true;
    const panel = t('div', 'ch-archive-panel');
    const head = t('div', 'ch-archive-head');
    head.appendChild(t('p', 'ch-archive-kicker', T('章节档案', 'CHAPTER FILE')));
    const title = t('h3', 'ch-archive-title');
    title.id = 'ch-archive-title';
    head.appendChild(title);
    const close = t('button', 'ch-archive-close');
    close.type = 'button';
    close.setAttribute('aria-label', T('关闭章节档案', 'Close chapter file'));
    close.textContent = '×';
    close.addEventListener('click', closeArchive);
    head.appendChild(close);
    panel.appendChild(head);
    panel.appendChild(t('div', 'ch-archive-body'));
    archive.appendChild(panel);
    doc.body.appendChild(archive);
    archive.addEventListener('click', function (e) {
      if (e.target === archive) closeArchive();
    });
    return archive;
  }

  function openArchive(section, c, opener) {
    const m = ensureArchive();
    const title = m.querySelector('.ch-archive-title');
    clear(title);
    fillChapterLabel(title, c, section);
    const body = m.querySelector('.ch-archive-body');
    clear(body);
    if (c.lead) body.appendChild(t('p', 'ch-lead', c.lead));
    (c.paragraphs || []).forEach(function (p) {
      const el = t('p', 'ch-text');
      el.innerHTML = richText(p);
      body.appendChild(el);
    });
    if (c.facts && c.facts.length) body.appendChild(factList(c.facts));
    const q = quoteBlock(c.quote);
    if (q) body.appendChild(q);
    const hint = hintLine(c.hint);
    if (hint) body.appendChild(hint);

    const active = doc.activeElement;
    archiveOpener = opener || (active && active !== doc.body && !m.contains(active) ? active : null);
    m.hidden = false;
    const panel = m.querySelector('.ch-archive-panel');
    if (panel) panel.scrollTop = 0;
    doc.documentElement.classList.add('has-archive');
    // 浮层打开期间由 keydown 捕获阶段独占键盘（boot.js 的 window 监听在冒泡阶段）
    window.addEventListener('keydown', archiveKeyGuard, true);
    // 焦点移入对话框，关闭后归还触发按钮（WCAG 2.4.3）
    const close = m.querySelector('.ch-archive-close');
    if (close) close.focus();
  }

  function closeArchive() {
    if (!archive || archive.hidden) return;
    archive.hidden = true;
    doc.documentElement.classList.remove('has-archive');
    window.removeEventListener('keydown', archiveKeyGuard, true);
    const back = archiveOpener;
    archiveOpener = null;
    if (back && back.focus && doc.contains(back)) back.focus();
  }

  /* 浮层打开时键盘只归浮层：Tab 循环、Esc 只收浮层，其余键不外泄到场景/标签页 */
  function archiveKeyGuard(e) {
    if (!archive || archive.hidden) return;
    if (e.key === 'Tab') {
      trapArchiveTab(e);
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeArchive();
      return;
    }
    e.stopPropagation();
  }

  /* Tab 在浮层内循环，不逃到背后的页面 */
  function trapArchiveTab(e) {
    if (!archive || archive.hidden) return false;
    const items = lightboxFocusables(archive);
    if (!items.length) return false;
    const first = items[0];
    const last = items[items.length - 1];
    const cur = doc.activeElement;
    if (e.shiftKey && (cur === first || !archive.contains(cur))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (cur === last || !archive.contains(cur))) {
      e.preventDefault();
      first.focus();
    }
    return true;
  }

  /* ============================================================
   * 光标（沿用 v1 行为，仅 pointer:fine 启用）
   * ============================================================ */
  function initCursor() {
    const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    const reduce = COSMOS.reduceMotion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const el = doc.getElementById('cursor');
    if (!el || !fine || reduce) {
      if (el) el.remove();
      doc.documentElement.classList.add('no-custom-cursor');
      return;
    }
    const ring = el.querySelector('.cursor-ring');
    const dot = el.querySelector('.cursor-dot');
    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;
    doc.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      if (dot) dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
    }, { passive: true });
    (function loop() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      if (ring) ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
      requestAnimationFrame(loop);
    })();
    doc.addEventListener('mouseover', function (e) {
      const hot = e.target.closest && e.target.closest('a,button,[data-cursor],.tab,.lightbox-close');
      el.classList.toggle('is-hot', !!hot);
    }, { passive: true });
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  function init(goTo) {
    goToFn = goTo;
    sections = Array.prototype.slice.call(doc.querySelectorAll('#scroll .chapter'));
    metas = [];
    mounted = [];

    sections.forEach(function (section, i) {
      const id = section.id.replace(/^ch-/, '');
      const c = (COSMOS.CONTENT || {})[id] || null;
      const meta = {
        index: i,
        num: (c && c.num) || section.dataset.num || String(i).padStart(2, '0'),
        name: (c && c.title) || section.dataset.name || id,
        en: (c && c.titleEn) || section.dataset.en || '',
        stage: section.dataset.stage || 'idle',
        part: (c && c.part) || section.dataset.part || ''
      };
      metas.push(meta);

      clear(section);
      section.classList.add('is-rendered');
      section.style.setProperty('--i', String(i));
      section.style.setProperty('--h', section.dataset.h || '200');

      if (meta.stage === 'hero') {
        renderHero(section, c || {});
      } else if (id === 'finale' || (c && c.layout === 'finale')) {
        renderFinale(section, c || {});
      } else {
        renderStandard(section, c || { title: meta.name, titleEn: meta.en, num: meta.num, part: meta.part, layout: 'split' });
      }
    });

    hudPart = doc.getElementById('hud-part');
    hudCoord = doc.getElementById('hud-coord');
    hudChapter = doc.getElementById('hud-chapter');
    railFill = doc.getElementById('rail-fill');

    renderNav();
    mountWidgets();
    bindGoto();
    initCursor();

    doc.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.lightbox-close')) closeLightbox();
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        if (trapArchiveTab(e)) return;
        trapLightboxTab(e);
        return;
      }
      if (e.key === 'Escape') {
        // 浮层优先：有档案先收档案，再收灯箱（场景 reset 由 boot.js 广播）
        closeArchive();
        closeLightbox();
      }
    });
    COSMOS.on('cosmos:escape', function () {
      closeArchive();
      closeLightbox();
    });
    // Esc 复位：场景之外，把本章控件的参数也交回默认（boot.js 广播）
    COSMOS.on('cosmos:reset', function () {
      const m = mounted[currentIndex];
      if (m && m.api && typeof m.api.reset === 'function') {
        try { m.api.reset(); } catch (e) {
          if (window.console && console.warn) console.warn('[COSMOS] widget reset 失败（已静默）', e);
        }
      }
    });

    COSMOS.UI.meta = metas;
    COSMOS.UI.sections = sections;
    return metas;
  }

  // 3D 场景的投影标签层挂在 body 上（不是章节 DOM 内）：只在本章显示，避免串到别的章。
  // 这些层由 scene-*.js 懒创建（preloadRest 之后才追加到 body），所以除了 setActive 时同步，
  // 还要监听 body 新增节点，命中即按当前章节校正一次（否则深链直达时会残留上一层的标签）。
  const BODY_LABEL_LAYERS = { 'sol-labels': 'ch-solar', 'coll-labels': 'ch-collision' };
  function syncBodyLabelLayers(index) {
    Object.keys(BODY_LABEL_LAYERS).forEach(function (layerId) {
      const layer = doc.getElementById(layerId);
      if (!layer) return;
      layer.style.display = (sections[index] && sections[index].id === BODY_LABEL_LAYERS[layerId]) ? '' : 'none';
    });
  }

  function setActive(index, metaArr) {
    if (metaArr && metaArr.length) metas = metaArr;
    if (index === currentIndex) return;
    currentIndex = index;

    sections.forEach(function (section, i) {
      section.classList.toggle('is-active', i === index);
    });
    const isFlowNow = !!(sections[index] && sections[index].classList.contains('is-flow'));
    doc.documentElement.classList.toggle('flow-active', isFlowNow);
    navItems.forEach(function (b, i) {
      const on = i === index;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    // 12 章在窄视口下标签栏可横向滚动：键盘切章/深链进入时把当前标签滚进视野
    const activeNav = navItems[index];
    if (activeNav && activeNav.scrollIntoView) {
      const reduce = COSMOS.ctx && COSMOS.ctx.reduceMotion;
      try {
        activeNav.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      } catch (e) {
        activeNav.scrollIntoView(false);
      }
    }
    updateHud(sections[index]);
    syncBodyLabelLayers(index);
    closeLightbox();
    // 队友组件自建的灯箱/抽屉：广播一次 escape，让它们收起
    try { COSMOS.emit('cosmos:escape'); } catch (e) {}
    if (window.console && document.documentElement.dataset.debug) {
      console.log('[COSMOS] chapter', index, metas[index] && metas[index].name);
    }
  }

  function setChapterProgress(i, p, o) {
    const section = sections[i];
    if (!section) return;
    section.style.setProperty('--p', (p || 0).toFixed(4));
    section.style.setProperty('--o', (o == null ? 1 : o).toFixed(4));
    const m = mounted[i];
    if (m && m.api && typeof m.api.update === 'function') {
      try { m.api.update(p || 0, o == null ? 1 : o); } catch (e) {
        if (!m._err) {
          m._err = true;
          if (window.console && console.warn) console.warn('[COSMOS] widget update 失败（已静默）', e);
        }
      }
    }
  }

  function setProgress(v) {
    if (railFill) railFill.style.transform = 'scaleY(' + Math.max(0, Math.min(1, v || 0)).toFixed(4) + ')';
  }

  // 懒加载的 stage 启动后会往 body 追加标签层：新增即按当前章节校正（深链直达时尤其必要）
  if (typeof MutationObserver === 'function') {
    const labelHost = doc.body || doc.documentElement;
    if (labelHost) {
      new MutationObserver(function (records) {
        for (let i = 0; i < records.length; i++) {
          const added = records[i].addedNodes;
          for (let j = 0; j < added.length; j++) {
            const node = added[j];
            if (node && node.id && BODY_LABEL_LAYERS[node.id]) {
              syncBodyLabelLayers(currentIndex);
              return;
            }
          }
        }
      }).observe(labelHost, { childList: true });
    }
  }

  COSMOS.UI = {
    meta: metas,
    sections: sections,
    currentIndex: -1,
    init: init,
    setActive: function (index, metaArr) { setActive(index, metaArr); COSMOS.UI.currentIndex = index; },
    setChapterProgress: setChapterProgress,
    setProgress: setProgress,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox,
    metas: metas
  };
})(window.COSMOS);
