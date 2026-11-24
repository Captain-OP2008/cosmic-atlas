/* ============================================================
 * COSMOS ATLAS · 界面层（v2）
 * ------------------------------------------------------------
 * 职责：
 *   1) 按 COSMOS.CONTENT 把 13 个 section 渲染成 sticky 全屏版式；
 *   2) 挂载 COSMOS.widgets 注册的章节组件（DOM 控件）；
 *   3) 章节导航 / HUD / 光标 / 进度条 / 灯箱 / 深链按钮；
 *   4) 把滚动进度 p 与可见度 o 分发到章节与 widget。
 *
 * 契约：docs/V2-PLAN.md §10
 *   - 章节结构：.ch-inner[layout-*] > .ch-scrim + .ch-copy + .ch-widget
 *   - .ch-widget 绝对铺满视口（pointer-events:none），子元素自行开启 auto
 *   - 组件：COSMOS.widgets[id](el, content, section) → { update(p, o) }
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const doc = document;
  const U = COSMOS.util;
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
    scroll.appendChild(t('span', 'hero-scroll-label', '点击顶部标签切换章节'));
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
    back.appendChild(t('span', 'btn-label', '回到开头'));
    back.appendChild(t('span', 'btn-arrow', '↑'));
    actions.appendChild(back);
    copy.appendChild(actions);

    inner.appendChild(copy);
    section.appendChild(inner);
  }

  function buildCredits() {
    const box = t('div', 'credits');
    box.appendChild(t('p', 'credits-title', '影像与数据来源'));

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
      li.appendChild(t('span', 'credits-name', '行星贴图'));
      li.appendChild(t('span', 'credits-note', 'Solar System Scope（CC BY 4.0），本地打包'));
      list.appendChild(li);
    }
    box.appendChild(list);
    box.appendChild(t('p', 'credits-foot', '本站不联网、不追踪；所有影像均存储于本地。'));
    return box;
  }

  /* 章节版式：lab 类章节内容较长，改为文档流（3D 留在背景），不锁一屏 */
  const FLOW_CHAPTERS = { compare: 1, history: 1, vehicles: 1, future: 1 };
  /* 文档流章节的右栏影像：让首屏不是纯文字，同时给实验室一个视觉锚点 */
  const FLOW_BANNERS = {
    compare: { src: 'assets/photos/human-blue-marble.jpg', cap: '阿波罗 17 号 · 蓝色弹珠，1972 · NASA' },
    history: { src: 'assets/photos/human-apollo11.jpg', cap: '阿波罗 11 号 · 月面，1969 · NASA' },
    vehicles: { src: 'assets/photos/rocket-starship.jpg', cap: '星舰 HLS · 月面概念图 · NASA' },
    future: { src: 'assets/photos/future-mars.jpg', cap: '火星基地概念图 · NASA' }
  };

  function renderStandard(section, c) {
    const layout = c.layout || 'split';
    const flow = !!(FLOW_CHAPTERS[section.id.replace('ch-', '')] || c.flow);
    if (flow) section.classList.add('is-flow');
    const inner = t('div', 'ch-inner layout-' + layout);

    const scrim = t('div', 'ch-scrim');
    scrim.setAttribute('aria-hidden', 'true');
    inner.appendChild(scrim);

    const copy = t('div', 'ch-copy');
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

    if (flow) {
      const ban = FLOW_BANNERS[section.id.replace('ch-', '')];
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

    inner.appendChild(copy);

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
        el.appendChild(t('p', 'u-dim widget-missing', '组件 ' + id + ' 尚未载入'));
        return null;
      }
      try {
        const api = factory(el, c, section);
        return { el: el, api: api || null };
      } catch (e) {
        if (window.console && console.warn) console.warn('[COSMOS] widget "' + id + '" 初始化失败', e);
        el.appendChild(t('p', 'u-dim widget-missing', '组件 ' + id + ' 初始化失败'));
        return null;
      }
    });
  }

  /* ============================================================
   * 导航 / HUD
   * ============================================================ */
  const PART_KEYS = { '序章': 0, 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, '终章': 6 };

  function renderNav() {
    navEl = doc.getElementById('nav');
    if (!navEl) return;
    clear(navEl);
    navItems = [];
    navEl.setAttribute('role', 'tablist');
    navEl.setAttribute('aria-label', '章节标签');
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

  function ensureLightbox() {
    if (lightbox) return lightbox;
    lightbox = t('div', 'lightbox');
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', '影像查看');
    lightbox.hidden = true;
    const img = t('img', 'lightbox-img');
    img.alt = '';
    const cap = t('p', 'lightbox-cap');
    const close = t('button', 'lightbox-close');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
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
    img.src = src;
    img.alt = caption || '';
    lb.querySelector('.lightbox-cap').textContent = caption || '';
    lb.hidden = false;
    doc.documentElement.classList.add('has-lightbox');
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    doc.documentElement.classList.remove('has-lightbox');
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
      if (e.key === 'Escape') closeLightbox();
    });
    COSMOS.on('cosmos:escape', closeLightbox);

    COSMOS.UI.meta = metas;
    COSMOS.UI.sections = sections;
    return metas;
  }

  function setActive(index, metaArr) {
    if (metaArr && metaArr.length) metas = metaArr;
    if (index === currentIndex) return;
    currentIndex = index;

    sections.forEach(function (section, i) {
      section.classList.toggle('is-active', i === index);
    });
    navItems.forEach(function (b, i) {
      const on = i === index;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    updateHud(sections[index]);
    // 太阳系场景的行星标签挂在 body 上：离开本章必须收起，避免串到别的章
    const solLabels = doc.getElementById('sol-labels');
    if (solLabels) {
      const onSolar = !!(sections[index] && sections[index].id === 'ch-solar');
      solLabels.style.display = onSolar ? '' : 'none';
    }
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
