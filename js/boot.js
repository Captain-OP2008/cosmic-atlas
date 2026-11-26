/* ============================================================
 * COSMOS ATLAS — 运行时核心
 * 渲染器 / 主循环 / 滚动驱动 / Stage 生命周期 / 性能自适应
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const T = (COSMOS.i18n && COSMOS.i18n.T) || function (zh) { return zh; };

  const THREE = window.THREE;
  const U = COSMOS.util;
  const clamp = U.clamp;
  const smoothstep = U.smoothstep;

  /* ============================================================
   * 环境探测
   * ============================================================ */
  const mq = function (q) { return window.matchMedia(q).matches; };
  const isTouch = mq('(hover: none), (pointer: coarse)');
  const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) < 700;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|BlackBerry/i.test(navigator.userAgent) ||
                   (isTouch && isSmallScreen);
  const reduceMotion = mq('(prefers-reduced-motion: reduce)');

  /* 02 章时间范围与日期输入保持同一口径：1800—2100 UTC */
  const SOLAR_MS_MIN = Date.UTC(1800, 0, 1);
  const SOLAR_MS_MAX = Date.UTC(2100, 11, 31, 23, 59, 0);

  /* 触屏设备：关掉自定义光标、加大点击热区 */
  if (isTouch || isMobile || isSmallScreen) document.body.classList.add('is-touch');
  if (isMobile) document.body.classList.add('is-mobile');

  const CFG = {
    maxDPR: isMobile ? 1.5 : 1.9,
    minDPR: 0.90,
    preloadAhead: 1,        // 提前预建后面几个 stage（v2 补齐，之前是 undefined）
    blendWindow: 0.5,       // 转场窗口，单位：视口高度
                            // 必须 ≤0.5，才能让 blend=1 与「下一章到视口中心、activeIndex 切换」对齐
    preloadDelay: 150,      // 后台预建 stage 的间隔（ms）
    perfWarmup: 3.2,        // 启动后多少秒才看帧率
    perfWindow: 72          // 多少帧统计一次
  };

  /* ============================================================
   * 状态
   * ============================================================ */
  let renderer = null;
  let canvas = null;
  let postfx = null;
  let mixRT = null;
  let rtB = null;
  let mixScene = null;
  let mixCam = null;
  let mixQuad = null;
  let mixMat = null;

  let sections = [];
  const sectionP = [];
  const sectionO = [];
  const lastP = [];
  const lastO = [];
  const metas = [];

  const stages = [];
  const stageErrors = [];

  let vw = 0, vh = 0, dpr = 1;
  let activeIndex = 0, prevActiveIndex = -1, lastUI = -1;
  /* v3：章节是「标签页」，不再有滚动进度。
   * p 由「进入本章后的停留时长」驱动出一段入场推镜，flow 章节再叠加内部滚动。
   * blend 保留给旧代码读，恒为 0。 */
  let blend = 0;
  let activeAt = 0;
  let transitioning = false;
  let pendingTarget = -1;
  let curtainTimer = 0, curtainTimer2 = 0;

  let elapsed = 0, lastT = 0, rafId = 0;
  let paused = false, started = false;
  let resizeTimer = 0;
  let warpHideTimer = 0;

  let mouseTX = 0, mouseTY = 0, mouseX = 0, mouseY = 0;

  let perfAcc = 0, perfN = 0, dprCeil = CFG.maxDPR;
  let degraded = false;

  const QUALITY = { always: 'high' };

  /* 每章后期参数（可随章节调） */
  const POST = {
    strength: 0.80,
    threshold: 0.78,
    vignette: 0.70,
    grain: 0.016,
    // 色差先关掉：太空题材里背景全是 1px 星点，任何 RGB 分离都会
    // 变成满屏红绿蓝散点，代价远大于那一点点镜头味。
    aberration: 0.0
  };

  /* 全局输入状态（v2）：boot 统一收集，场景只读。
   * click / wheel / pinch 是一次性量，每帧 updateStages 之后清零。 */
  const input = {
    x: 0, y: 0,
    nx: 0, ny: 0,
    dx: 0, dy: 0,
    down: false,
    dragging: false,
    click: null,
    wheel: 0,
    wheelCtrl: 0,
    pinch: 0,
    keys: {},
    uiTarget: false
  };
  COSMOS.input = input;

  /* 显存闸门：移动端把 4K 贴图在加载时降到 2K（lib-core 的 tex.load 会读取这个值） */
  if (COSMOS.tex) COSMOS.tex.maxWidth = (isMobile || (isTouch && isSmallScreen)) ? 2048 : 4096;

  let pointerId = -1;
  let pointerStartX = 0, pointerStartY = 0, pointerStartT = 0;
  const pointers = {};
  let pinchLastDist = 0;

  /* HUD 坐标改为从 section 的 data-coord 读取，避免再维护一份数组 */
  function coordFor(i) {
    const s = sections[i];
    return (s && s.dataset.coord) || '';
  }


  /* ============================================================
   * 小工具
   * ============================================================ */
  function $(id) { return document.getElementById(id); }

  function tick() {
    return new Promise(function (r) { setTimeout(r, 14); });
  }

  function setLoader(p, text) {
    const fill = $('loader-bar-fill');
    const hint = $('loader-hint');
    if (fill) fill.style.width = (Math.round(p * 1000) / 10) + '%';
    if (hint && text) hint.textContent = text;
  }

  function reportError(where, err) {
    if (window.__COSMOS_ERRORS === undefined) window.__COSMOS_ERRORS = [];
    window.__COSMOS_ERRORS.push(where + ': ' + (err && err.message ? err.message : String(err)));
    if (window.console && console.error) console.error('[COSMOS] ' + where, err);
  }

  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  }

  /* ============================================================
   * 02 太阳系：共享状态默认值 + URL 深链 + 分享
   * 状态结构见 artifacts/p1-contract.md §2；scene 是唯一时间推进者。
   * ============================================================ */
  function initSolarState() {
    const S = COSMOS.state;
    if (!S) return;
    const now = Date.now();
    if (!S.solar) {
      S.solar = {
        timeMs: now,
        daysPerSec: 1,
        paused: false,
        view: 'whole',
        focus: null,
        selected: null,
        labels: true,
        orbits: true,
        enlarge: false,
        qualityHint: 'auto'
      };
    }
    applySolarDeepLink(S.solar);
  }

  /* ?date=2024-04-08T18:18Z | ?rate=1 | ?paused=1 | ?view=inner|planet|whole
   * ?body=earth | ?enlarge=1 | ?orbits=0 | ?labels=0 | ?reverse=1
   * date 支持裸日期（按 UTC 00:00 解释）与带时区的 ISO 串。
   */
  function applySolarDeepLink(st) {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (!q || !q.has) return;

    if (q.has('date')) {
      const raw = q.get('date') || '';
      let ms = NaN;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) ms = Date.parse(raw + 'T00:00:00Z');
      else ms = Date.parse(raw);
      if (isFinite(ms)) st.timeMs = clamp(ms, SOLAR_MS_MIN, SOLAR_MS_MAX);
    }
    if (q.has('rate')) {
      const r = parseFloat(q.get('rate'));
      if (isFinite(r) && r !== 0) st.daysPerSec = clamp(Math.abs(r), 0.000011574, 365 * 3);
    }
    if (q.get('paused') === '1') st.paused = true;
    if (q.get('reverse') === '1') st.daysPerSec = -Math.abs(st.daysPerSec);
    const view = q.get('view');
    if (view === 'whole' || view === 'inner' || view === 'planet' || view === 'free') st.view = view;
    const body = q.get('body') || q.get('focus');
    if (body && COSMOS.DATA && COSMOS.DATA.bodyById && COSMOS.DATA.bodyById(body)) {
      st.focus = body;
      st.selected = body;
    }
    if (q.get('enlarge') === '1') st.enlarge = true;
    if (q.get('orbits') === '0') st.orbits = false;
    if (q.get('labels') === '0') st.labels = false;
  }

  function solarShareUrl() {
    const st = (COSMOS.state && COSMOS.state.solar) || {};
    const parts = [];
    const d = new Date(isFinite(st.timeMs) ? st.timeMs : Date.now());
    parts.push('date=' + encodeURIComponent(d.toISOString().replace(/\.\d{3}Z$/, 'Z')));
    if (st.daysPerSec && st.daysPerSec !== 1) parts.push('rate=' + encodeURIComponent(st.daysPerSec));
    if (st.paused) parts.push('paused=1');
    if (st.view && st.view !== 'whole') parts.push('view=' + encodeURIComponent(st.view));
    if (st.focus) parts.push('body=' + encodeURIComponent(st.focus));
    if (st.enlarge) parts.push('enlarge=1');
    if (st.orbits === false) parts.push('orbits=0');
    if (st.labels === false) parts.push('labels=0');
    const base = location.href.split('#')[0].split('?')[0];
    const hash = (location.hash && /^#ch-/.test(location.hash)) ? location.hash : '#ch-solar';
    return base + '?' + parts.join('&') + hash;
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      let done = false;
      function finish(ok) { if (!done) { done = true; resolve(ok); } }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { finish(true); }, function () { finish(false); });
          return;
        }
      } catch (e) { /* 降级 */ }
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        finish(!!ok);
      } catch (e2) { finish(false); }
    });
  }

  function shareSolar() {
    const url = solarShareUrl();
    return copyText(url).then(function (ok) {
      COSMOS.emit('solar:share', { ok: ok, url: url });
      return ok;
    });
  }

  /* base64url 编解码（06 章分享链接复用） */
  function b64urlDecode(str) {
    try {
      let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      return decodeURIComponent(escape(atob(s)));
    } catch (e) { return null; }
  }

  function b64urlEncode(str) {
    try {
      return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { return ''; }
  }

  /* ============================================================
   * 06 星系碰撞（collision）：默认值、深链、分享
   * ============================================================ */
  const COLLISION_SCENES = ['collide', 'custom', 'passer', 'retrograde', 'bullseye', 'spiral'];

  function initCollisionState() {
    const S = COSMOS.state;
    const M = COSMOS.galaxyModel;
    if (!S || !M) return;
    if (!S.collision) {
      S.collision = {
        scene: 'collide',
        paused: false,
        speed: 1,
        myr: 0,
        params: { ratio: 1, approach: 9, spinA: 1, spinB: 1, leanA: 0, leanB: 0 },
        show: { trails: true, velocity: false, names: true },
        cam: { yaw: 0.6, pitch: 0.9, dist: 120 },
        stats: { count: 0, coreDist: 0, energyPct: 0 },
        ver: 0
      };
    }
    applyCollisionDeepLink(S.collision);
  }

  /* ?cscene=collide | ?c=<base64url JSON {scene,params,speed,myr,show,cam}> */
  function applyCollisionDeepLink(st) {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (!q || !q.has) return;

    const raw = q.get('c');
    if (raw) {
      let payload = null;
      const json = b64urlDecode(raw);
      if (json) { try { payload = JSON.parse(json); } catch (e) { payload = null; } }
      if (payload && typeof payload === 'object') {
        if (payload.scene && COLLISION_SCENES.indexOf(payload.scene) >= 0) st.scene = payload.scene;
        if (payload.params && typeof payload.params === 'object') {
          const P = payload.params;
          const ratio = parseFloat(P.ratio); if (ratio === 1 || ratio === 0.5 || ratio === 0.25) st.params.ratio = ratio;
          const ap = parseFloat(P.approach); if (ap === 6 || ap === 12 || ap === 20) st.params.approach = ap;
          ['spinA', 'spinB'].forEach(function (k) { if (P[k] === 1 || P[k] === -1) st.params[k] = P[k]; });
          ['leanA', 'leanB'].forEach(function (k) { const v = parseFloat(P[k]); if (v === 0 || v === 30 || v === 60) st.params[k] = v; });
        }
        if (payload.show) {
          ['trails', 'velocity', 'names'].forEach(function (k) {
            if (typeof payload.show[k] === 'boolean') st.show[k] = payload.show[k];
          });
        }
        if (payload.cam) {
          st.cam.yaw = (parseFloat(payload.cam.yaw) || 0) % (Math.PI * 2);
          st.cam.pitch = clamp(parseFloat(payload.cam.pitch) || 0.9, 0.05, 1.52);
          st.cam.dist = clamp(parseFloat(payload.cam.dist) || 120, 12, 900);
        }
        const speed = parseFloat(payload.speed);
        if (isFinite(speed) && speed !== 0) st.speed = clamp(speed, -4, 4) || 1;
        const myr = parseFloat(payload.myr);
        if (isFinite(myr) && myr >= 0) st.myr = Math.min(4000, myr);
        st.paused = payload.paused !== false;
      }
    }

    const sceneId = q.get('cscene');
    if (sceneId && COLLISION_SCENES.indexOf(sceneId) >= 0) st.scene = sceneId;
    if (q.get('paused') === '1') st.paused = true;
  }

  function collisionShareUrl() {
    const M = COSMOS.galaxyModel;
    const st = (COSMOS.state && COSMOS.state.collision) || {};
    const payload = {
      v: 1,
      scene: st.scene || 'collide',
      params: st.params || {},
      paused: true,
      speed: +(st.speed || 1),
      myr: +(st.myr || 0).toFixed(2),
      show: {
        trails: !!(st.show && st.show.trails),
        velocity: !!(st.show && st.show.velocity),
        names: !!(st.show && st.show.names)
      },
      cam: {
        yaw: +((st.cam && st.cam.yaw) || 0).toFixed(3),
        pitch: +((st.cam && st.cam.pitch) || 0.9).toFixed(3),
        dist: +((st.cam && st.cam.dist) || 120).toFixed(2)
      }
    };
    let encoded = '';
    try {
      encoded = (M && M.b64urlEncode) ? M.b64urlEncode(JSON.stringify(payload)) : b64urlEncode(JSON.stringify(payload));
    } catch (e) { encoded = ''; }
    const base = location.href.split('#')[0].split('?')[0];
    return base + '?c=' + encoded + '#ch-collision';
  }

  function shareCollision() {
    const url = collisionShareUrl();
    return copyText(url).then(function (ok) {
      COSMOS.emit('collision:share', { ok: ok, url: url });
      return ok;
    });
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  async function boot() {
    document.documentElement.classList.add('is-loading');

    // 0) 02 / 06 章共享状态（默认值 + URL 深链），必须早于控件挂载
    try { initSolarState(); } catch (e) { reportError('solar-init', e); }
    try { initCollisionState(); } catch (e) { reportError('collision-init', e); }

    // 1) 界面 + 内容
    setLoader(0.04, T('正在排版图文…', 'Laying out the text…'));
    let meta = [];
    try {
      meta = COSMOS.UI.init(function (i) { goTo(i); });
    } catch (e) {
      reportError('UI.init', e);
    }
    for (let i = 0; i < meta.length; i++) metas[i] = meta[i];

    vw = window.innerWidth;
    vh = window.innerHeight;
    collectSections();
    activeIndex = hashIndex();
    activeAt = performance.now() - 10000;   // 首屏不做入场推镜
    COSMOS.UI.setActive(activeIndex, metas);
    // 保持 -1：让首帧 syncUI 走一次完整分支，把 HUD 坐标写对、把邻章场景预载上
    lastUI = -1;

    await tick();

    // 2) WebGL
    canvas = $('gl');
    if (!canvas) { failHard(T('页面缺少画布元素。', 'The canvas element is missing.')); return; }
    if (!hasWebGL()) { failHard(T('这个浏览器或显卡不支持 WebGL，无法渲染三维宇宙。', 'This browser or GPU does not support WebGL, so the 3D universe cannot be rendered.')); return; }

    setLoader(0.12, T('正在初始化渲染器…', 'Initializing the renderer…'));
    await tick();

    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: false,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true
      });
    } catch (e) {
      reportError('WebGLRenderer', e);
      failHard(T('显卡渲染器初始化失败。', 'The GPU renderer failed to initialize.'));
      return;
    }

    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    // 3) 混合缓冲
    const type = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    mixRT = new THREE.WebGLRenderTarget(1, 1, {
      type: type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });
    mixRT.texture.generateMipmaps = false;

    rtB = new THREE.WebGLRenderTarget(1, 1, {
      type: type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });
    rtB.texture.generateMipmaps = false;

    // 混合四边形
    mixScene = new THREE.Scene();
    mixCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    mixQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    mixQuad.frustumCulled = false;
    mixScene.add(mixQuad);

    mixMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null },
        uAlpha: { value: 1 }
      },
      vertexShader:
        'varying vec2 vUv;\n' +
        'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader:
        'uniform sampler2D tSrc;\n' +
        'uniform float uAlpha;\n' +
        'varying vec2 vUv;\n' +
        'void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, uAlpha); }',
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.NormalBlending
    });

    setLoader(0.24, T('正在架设光学系统…', 'Setting up the optics…'));
    await tick();

    // 4) 后处理
    try {
      postfx = new COSMOS.PostFX(renderer, {
        strength: POST.strength,
        threshold: POST.threshold,
        vignette: POST.vignette,
        grain: POST.grain,
        aberration: POST.aberration
      });
    } catch (e) {
      reportError('PostFX', e);
    }

    applySize();

    // 5) 预建当前章与下一章
    setLoader(0.38, T('正在点燃第一颗恒星…', 'Igniting the first star…'));
    await tick();
    getStage(activeIndex);

    setLoader(0.62, T('正在铺开星际介质…', 'Spreading the interstellar medium…'));
    await tick();
    getStage(Math.min(sections.length - 1, activeIndex + 1));

    setLoader(0.84, T('正在校准曝光…', 'Calibrating exposure…'));
    await tick();

    // 6) 首帧
    updateProgress();
    try {
      renderFrame();
    } catch (e) {
      reportError('首帧渲染', e);
    }

    setLoader(1.0, T('进入宇宙', 'Entering the cosmos'));
    await tick();
    await tick();

    hideLoader();
    startLoop();
    preloadRest();
  }

  function failHard(msg) {
    const l = $('loader');
    if (l) {
      l.innerHTML =
        '<div class="loader-inner">' +
        '<div class="loader-title">NO SIGNAL</div>' +
        '<div class="loader-sub" style="margin-top:18px;letter-spacing:.1em;max-width:40ch;line-height:2;">' +
        msg + '</div>' +
        '</div>';
      l.classList.remove('is-done');
    }
    document.documentElement.classList.remove('is-loading');
  }

  /* ============================================================
   * 尺寸
   * ============================================================ */
  function applySize() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    // 低 DPI 屏幕做 1.5× 超采样再交给浏览器缩小，显著提升线条与文字锐度
    const baseDPR = window.devicePixelRatio || 1;
    const ss = isMobile ? 1 : (baseDPR <= 1.1 ? 1.5 : 1);
    dpr = Math.min(baseDPR * ss, dprCeil);

    // 超大视口兜底：高 DPI 大窗口 / 低 DPI 超采样叠加后画布物理像素会到 300 万以上，
    // 部分 GPU / 合成路径会漏掉一块合成区域，表现为画面中央一块纯黑矩形（用户实测：窗口缩小就消失）。
    // 这里按「最终输出像素」而不是 baseDPR 判断（低 DPI 超采样也要算进去），
    // 超出时按比例压低渲染像素比（不低于 1:1；视口本身已超上限时只能维持 1:1）。
    const MAX_CANVAS_PIXELS = 3500000;
    if (vw * vh * dpr * dpr > MAX_CANVAS_PIXELS) {
      dpr = Math.max(1, Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (vw * vh))));
    }

    if (renderer) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(vw, vh, false);
    }
    if (canvas) {
      canvas.style.width = vw + 'px';
      canvas.style.height = vh + 'px';
    }

    const bw = Math.max(1, Math.floor(vw * dpr));
    const bh = Math.max(1, Math.floor(vh * dpr));
    if (mixRT) mixRT.setSize(bw, bh);
    if (rtB) rtB.setSize(bw, bh);
    if (postfx) postfx.setSize(vw, vh, dpr);

    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      if (st && typeof st.resize === 'function') {
        try { st.resize(vw, vh); } catch (e) { reportError('resize#' + i, e); }
      }
      // 竖屏补偿：各 stage 的 resize 只管 aspect，这里统一把垂直视角放大，
      // 保证手机上水平视野不缩水（否则银河/太阳/行星两侧被裁）
      if (st && st.camera && st.camera.isPerspectiveCamera && COSMOS.util.fitCamera) {
        try {
          const base = st.camera.userData.baseFov || st.camera.fov;
          st.camera.userData.baseFov = base;
          COSMOS.util.fitCamera(st.camera, base, vw / Math.max(vh, 1));
        } catch (e) { reportError('fitcam#' + i, e); }
      }
    }
  }

  /* ============================================================
   * 章节（标签页）状态
   * ============================================================ */
  function collectSections() {
    sections = Array.prototype.slice.call(document.querySelectorAll('#scroll .chapter'));
    for (let i = 0; i < sections.length; i++) {
      if (sectionP[i] === undefined) sectionP[i] = 0;
      if (sectionO[i] === undefined) sectionO[i] = 0;
      if (lastP[i] === undefined) lastP[i] = -1;
      if (lastO[i] === undefined) lastO[i] = -1;
    }
  }

  function hashIndex() {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return 0;
    const el = document.getElementById(hash) || document.getElementById('ch-' + hash);
    const i = sections.indexOf(el);
    return i > 0 ? i : 0;
  }

  function isFlowChapter(i) {
    const s = sections[i];
    return !!(s && s.classList.contains('is-flow'));
  }

  function updateProgress() {
    if (!sections.length) return;
    const now = performance.now();
    const dwell = reduceMotion ? 1 : clamp((now - activeAt) / 2000, 0, 1);
    const e = 1 - Math.pow(1 - dwell, 3);

    // 入场推镜：p 从 0.10 推到 0.86；flow 章节再叠加内部滚动，让画面跟着内容走
    let p = 0.10 + 0.76 * e;
    const sec = sections[activeIndex];
    if (sec && sec.classList.contains('is-flow')) {
      const max = Math.max(1, sec.scrollHeight - sec.clientHeight);
      const frac = clamp((sec.scrollTop || 0) / max, 0, 1);
      p = 0.16 + 0.70 * e + frac * 0.14;
    }
    sectionP[activeIndex] = clamp(p, 0, 1);
    sectionO[activeIndex] = clamp((now - activeAt) / 360, 0, 1);

    for (let i = 0; i < sections.length; i++) {
      if (i !== activeIndex) { sectionP[i] = 0; sectionO[i] = 0; }
      const po = sectionP[i], oo = sectionO[i];
      if (Math.abs(po - lastP[i]) > 0.0008 || Math.abs(oo - lastO[i]) > 0.004) {
        lastP[i] = po;
        lastO[i] = oo;
        const st = sections[i].style;
        st.setProperty('--p', po.toFixed(4));
        st.setProperty('--o', oo.toFixed(4));
      }
    }

    // 鼠标平滑（部分场景读 COSMOS.input，这里保留旧的平滑值供兼容）
    mouseX += (mouseTX - mouseX) * 0.06;
    mouseY += (mouseTY - mouseY) * 0.06;
  }

  /* ============================================================
   * 幕布转场（四色斜切色块，参照学习中心）
   * ============================================================ */
  function playCurtain(inOut) {
    const el = $('curtain');
    if (!el || reduceMotion) return;
    if (inOut === 'in') {
      el.classList.add('on', 'in');
      el.classList.remove('out');
    } else {
      el.classList.remove('in');
      el.classList.add('on', 'out');
      clearTimeout(curtainTimer2);
      curtainTimer2 = setTimeout(function () {
        el.classList.remove('on', 'out');
      }, 560);
    }
  }

  function commitTab(i) {
    if (i === activeIndex) { transitionEnd(); return; }
    const leaving = stages[activeIndex];
    if (leaving && typeof leaving.leave === 'function') {
      try { leaving.leave(); } catch (e) { reportError('leave#' + activeIndex, e); }
    }
    activeIndex = i;
    activeAt = performance.now();
    prevActiveIndex = -1;

    // flow 章节回到顶部
    const sec = sections[activeIndex];
    if (sec && sec.scrollTop) sec.scrollTop = 0;

    ensureAround(activeIndex);
    const entering = stages[activeIndex];
    if (entering && typeof entering.enter === 'function') {
      try { entering.enter(); } catch (e) { reportError('enter#' + activeIndex, e); }
    }
    try {
      if (sec && sec.id) history.replaceState(null, '', '#' + sec.id);
    } catch (e) { /* file:// 忽略 */ }

    playCurtain('out');
    // 等幕布完全撤走再解锁，避免第二次点击与动画重启打架
    clearTimeout(curtainTimer);
    curtainTimer = setTimeout(transitionEnd, 520);
  }

  function transitionEnd() {
    transitioning = false;
    // 转场期间用户又点了别的标签：等幕布完全撤走再补一次
    if (pendingTarget >= 0) {
      const t = pendingTarget;
      pendingTarget = -1;
      tabGo(t);
    }
  }

  function tabGo(i, instant) {
    if (!sections.length) return;
    if (typeof i === 'string') {
      const el = document.getElementById(i) || document.getElementById('ch-' + i);
      if (!el) {
        const n = parseInt(i, 10);
        if (isNaN(n)) return;
        i = n;
      } else {
        i = sections.indexOf(el);
      }
    }
    i = clamp(Math.round(i), 0, sections.length - 1);

    if (instant || reduceMotion) {
      const leaving = stages[activeIndex];
      if (leaving && typeof leaving.leave === 'function') {
        try { leaving.leave(); } catch (e) { reportError('leave#instant', e); }
      }
      activeIndex = i;
      activeAt = performance.now() - 10000;
      ensureAround(activeIndex);
      const entering = stages[activeIndex];
      if (entering && typeof entering.enter === 'function') {
        try { entering.enter(); } catch (e) { reportError('enter#instant', e); }
      }
      try {
        if (sections[i] && sections[i].id) history.replaceState(null, '', '#' + sections[i].id);
      } catch (e) { /* ignore */ }
      updateProgress();
      renderFrame();
      return;
    }

    if (transitioning) { pendingTarget = i; return; }
    if (i === activeIndex) return;

    transitioning = true;
    playCurtain('in');
    clearTimeout(curtainTimer);
    // 幕布完全盖住屏幕后再切换场景，换完再从另一侧揭开
    curtainTimer = setTimeout(function () { commitTab(i); }, reduceMotion ? 0 : 430);
  }

  /* ============================================================
   * Stage 管理
   * ============================================================ */
  function qualityFor() {
    if (isMobile) return 'medium';
    if (dprCeil < 1.15) return 'low';
    return 'high';
  }

  function getStage(i) {
    if (i < 0 || i >= sections.length) return null;
    if (stages[i]) return stages[i];
    if (stageErrors[i]) return null;

    const id = sections[i].dataset.stage;
    const factory = COSMOS.stages && COSMOS.stages[id];
    if (typeof factory !== 'function') {
      stageErrors[i] = '未注册的 stage: ' + id;
      reportError('stage#' + i, new Error('未注册: ' + id));
      return null;
    }

    const stageCtx = {
      THREE: THREE,
      renderer: renderer,
      width: vw,
      height: vh,
      aspect: vw / Math.max(vh, 1),
      pixelRatio: dpr,
      quality: qualityFor(),
      index: i,
      reduceMotion: reduceMotion,
      input: input,
      section: sections[i],
      ui: COSMOS.UI
    };

    let st = null;
    try {
      st = factory(stageCtx);
    } catch (e) {
      stageErrors[i] = String(e && e.message || e);
      reportError('stage#' + i + '(' + id + ')', e);
      return null;
    }

    if (!st || !st.scene || !st.camera) {
      stageErrors[i] = '缺少 scene/camera';
      reportError('stage#' + i + '(' + id + ')', new Error('缺少 scene 或 camera'));
      return null;
    }
    if (typeof st.update !== 'function') st.update = function () {};
    if (typeof st.resize !== 'function') {
      st.resize = function (w, h) {
        if (st.camera.isPerspectiveCamera) {
          st.camera.aspect = w / Math.max(h, 1);
          st.camera.updateProjectionMatrix();
        }
      };
    } else {
      try { st.resize(vw, vh); } catch (e) { reportError('stage.resize#' + i, e); }
    }

    st.__broken = false;
    stages[i] = st;
    stageErrors[i] = null;

    // 新建的 stage 补一次竖屏视角补偿（它不会再经历 applySize 的循环）
    if (st.camera && st.camera.isPerspectiveCamera && COSMOS.util.fitCamera) {
      try {
        const base = st.camera.userData.baseFov || st.camera.fov;
        st.camera.userData.baseFov = base;
        st.camera.aspect = vw / Math.max(vh, 1);
        COSMOS.util.fitCamera(st.camera, base, vw / Math.max(vh, 1));
      } catch (e) { reportError('fitcam-init#' + i, e); }
    }

    // 预编译 shader，避免首次进入时卡顿
    try {
      if (renderer) renderer.compile(st.scene, st.camera);
    } catch (e) {
      reportError('compile#' + i, e);
    }

    // 多 pass 场景（黑洞）返回的 scene 只是显示四边形，内部管线要自己预热
    if (typeof st.warmup === 'function') {
      try { st.warmup(); } catch (e) { reportError('warmup#' + i, e); }
    }

    return st;
  }

  function ensureAround(i) {
    const from = Math.max(0, i - 1);
    const to = Math.min(sections.length - 1, i + CFG.preloadAhead);
    for (let k = from; k <= to; k++) getStage(k);
  }

  async function preloadRest() {
    for (let i = 2; i < sections.length; i++) {
      if (stages[i]) continue;
      // 建一个 stage 要 100–280ms（着色器编译 + 几何上传），放在空闲时段做，
      // 避免和首批交互抢主线程；不支持 requestIdleCallback 时用更长的定时兜底。
      await new Promise(function (r) {
        if (document.hidden) { r(); return; }
        if (window.requestIdleCallback) {
          window.requestIdleCallback(function () { r(); }, { timeout: 2500 });
        } else {
          setTimeout(r, CFG.preloadDelay * 2);
        }
      });
      if (document.hidden) return;
      getStage(i);
    }
  }

  function updateStages(dt) {
    // 章节切换的 leave/enter 由 commitTab/tabGo 立即处理，这里只跑当前场景
    prevActiveIndex = activeIndex;

    const a = stages[activeIndex];
    if (a) {
      try {
        a.update(elapsed, dt, sectionP[activeIndex]);
      } catch (e) {
        if (!a.__broken) { a.__broken = true; reportError('update#' + activeIndex, e); }
      }
    }
  }

  /* ============================================================
   * 渲染
   * ============================================================ */
  function renderFrame() {
    if (!renderer || !mixRT) return;

    const a = stages[activeIndex];
    const bIdx = activeIndex + 1;
    const b = (blend > 0.002 && bIdx < sections.length) ? stages[bIdx] : null;

    // —— 场景 A ——
    renderer.setRenderTarget(mixRT);
    renderer.clear(true, true, false);
    if (a) {
      try { renderer.render(a.scene, a.camera); } catch (e) { reportError('render#' + activeIndex, e); }
    }

    // —— 场景 B 叠加 ——
    if (b) {
      renderer.setRenderTarget(rtB);
      renderer.clear(true, true, false);
      try { renderer.render(b.scene, b.camera); } catch (e) { reportError('render#' + bIdx, e); }

      mixMat.uniforms.tSrc.value = rtB.texture;
      mixMat.uniforms.uAlpha.value = blend;
      mixQuad.material = mixMat;
      renderer.setRenderTarget(mixRT);
      renderer.render(mixScene, mixCam);
    }

    // —— 后期 ——
    if (postfx) {
      postfx.renderFrom(mixRT.texture, {
        time: elapsed,
        strength: POST.strength,
        threshold: POST.threshold,
        vignette: POST.vignette,
        grain: POST.grain,
        aberration: POST.aberration
      });
    }
  }

  /* ============================================================
   * 主循环
   * ============================================================ */
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (paused) return;

    if (!now) now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;

    if (!isFinite(dt) || dt < 0) dt = 1 / 60;
    if (dt > 0.12) dt = 0.12;   // 切标签页回来时不要跳变

    elapsed += dt;

    updateProgress();
    updateStages(dt);
    renderFrame();
    syncUI();
    adaptPerf(dt);

    // 一次性输入量：本帧消费完即清零
    input.click = null;
    input.wheel = 0;
    input.wheelCtrl = 0;
    input.pinch = 0;
    input.dx = 0;
    input.dy = 0;
  }

  function syncUI() {
    if (activeIndex !== lastUI) {
      const leaving = lastUI;
      lastUI = activeIndex;
      // 章节离开视口时把它的 o 归零，让 body 级浮层（行星标签等）自行收起
      if (leaving >= 0 && leaving !== activeIndex && COSMOS.UI.setChapterProgress) {
        COSMOS.UI.setChapterProgress(leaving, 0, 0);
      }
      COSMOS.UI.setActive(activeIndex, metas);

      const coord = $('hud-coord');
      if (coord) coord.textContent = coordFor(activeIndex);

      // 提前把相邻场景建好
      ensureAround(activeIndex);
    }

    if (COSMOS.UI.setChapterProgress) {
      COSMOS.UI.setChapterProgress(activeIndex, sectionP[activeIndex], sectionO[activeIndex]);
    }
    COSMOS.UI.setProgress((activeIndex + 1) / Math.max(1, sections.length));
  }

  function adaptPerf(dt) {
    if (elapsed < CFG.perfWarmup) return;
    perfAcc += dt;
    perfN++;
    if (perfN < CFG.perfWindow) return;

    const avg = perfAcc / perfN;
    perfAcc = 0;
    perfN = 0;

    if (avg > 0.0235 && dprCeil > CFG.minDPR) {
      dprCeil = Math.max(CFG.minDPR, dprCeil - 0.20);
      applySize();
      if (window.console) console.info('[COSMOS] 帧率不足，渲染分辨率调整为 ' + dprCeil.toFixed(2) + 'x');
    } else if (avg > 0.032 && !degraded) {
      degraded = true;
      POST.strength = 0.72;
      POST.vignette = 0.55;
      if (window.console) console.info('[COSMOS] 进一步提升性能：降低泛光开销');
    }
  }

  function startLoop() {
    if (started) return;
    started = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function hideLoader() {
    const l = $('loader');
    if (l) l.classList.add('is-done');
    document.documentElement.classList.remove('is-loading');
  }

  /* ============================================================
   * 导航
   * ============================================================ */
  function goTo(i, instant) {
    return tabGo(i, instant);
  }

  /* ============================================================
   * 事件
   * ============================================================ */
  function isUITarget(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('.ch-copy, .finale-copy, .hud, .nav, .rail, .warp, .loader, a, button, input, textarea, select, label, summary, [role="button"], [data-ui]');
  }

  function updatePointerPos(e) {
    input.x = e.clientX;
    input.y = e.clientY;
    input.nx = (e.clientX / Math.max(vw, 1)) * 2 - 1;
    input.ny = -((e.clientY / Math.max(vh, 1)) * 2 - 1);
  }

  function bindInput() {
    window.addEventListener('pointerdown', function (e) {
      updatePointerPos(e);
      input.uiTarget = isUITarget(e.target);
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // 场景拖拽时阻止浏览器启动文本选择（不拦 UI 上的按钮/链接）
      if (!input.uiTarget && e.cancelable) e.preventDefault();
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length === 1) {
        pointerId = e.pointerId;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        pointerStartT = performance.now();
        input.down = true;
        input.dragging = false;
        input.dx = 0; input.dy = 0;
      }
      const ids = Object.keys(pointers);
      if (ids.length === 2) {
        const a = pointers[ids[0]], b = pointers[ids[1]];
        pinchLastDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    }, { passive: false });

    window.addEventListener('pointermove', function (e) {
      const prevX = input.x, prevY = input.y;
      updatePointerPos(e);
      input.dx += input.x - prevX;
      input.dy += input.y - prevY;
      if (pointers[e.pointerId]) {
        pointers[e.pointerId].x = e.clientX;
        pointers[e.pointerId].y = e.clientY;
      }
      if (input.down && !input.dragging) {
        if (Math.hypot(input.x - pointerStartX, input.y - pointerStartY) > 4) {
          input.dragging = true;
          document.body.classList.add('is-dragging');
          const sel = window.getSelection && window.getSelection();
          if (sel && sel.rangeCount && sel.toString()) sel.removeAllRanges();
        }
      }
      const ids = Object.keys(pointers);
      if (ids.length === 2) {
        const a = pointers[ids[0]], b = pointers[ids[1]];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchLastDist > 1) input.pinch += (d / pinchLastDist) - 1;
        pinchLastDist = d;
      }
    }, { passive: true });

    function endPointer(e) {
      updatePointerPos(e);
      const wasDown = input.down;
      const moved = Math.hypot(e.clientX - pointerStartX, e.clientY - pointerStartY);
      const quick = performance.now() - pointerStartT < 700;
      if (wasDown && e.pointerId === pointerId && moved <= 6 && quick) {
        input.click = { x: e.clientX, y: e.clientY, nx: input.nx, ny: input.ny };
      }
      delete pointers[e.pointerId];
      const ids = Object.keys(pointers);
      if (ids.length === 0) {
        input.down = false;
        input.dragging = false;
        document.body.classList.remove('is-dragging');
        pointerId = -1;
        pinchLastDist = 0;
      } else if (ids.length === 1) {
        pointerId = ids[0];
        pointerStartX = pointers[ids[0]].x;
        pointerStartY = pointers[ids[0]].y;
        pinchLastDist = 0;
      }
    }
    window.addEventListener('pointerup', endPointer, { passive: true });
    window.addEventListener('pointercancel', endPointer, { passive: true });

    // Ctrl/⌘ + 滚轮与 [data-wheel] 区域由场景消费，普通滚轮仍归页面滚动
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey) {
        input.wheelCtrl += e.deltaY;
        if (e.cancelable) e.preventDefault();
      } else if (e.target && e.target.closest && e.target.closest('[data-wheel]')) {
        input.wheel += e.deltaY;
        if (e.cancelable) e.preventDefault();
      } else if (!isUITarget(e.target) && !isFlowChapter(activeIndex)) {
        // 标签页模式下整页不滚动：指针在 3D 场景上时，普通滚轮用于缩放
        input.wheel += e.deltaY;
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('blur', resetInput);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) resetInput();
    });
  }

  function resetInput() {
    input.down = false;
    input.dragging = false;
    input.click = null;
    input.wheel = 0;
    input.wheelCtrl = 0;
    input.pinch = 0;
    input.keys = {};
    for (let k in pointers) delete pointers[k];
    pointerId = -1;
  }

  function bindEvents() {
    /* 控件请求生成分享链接（06 章星系碰撞） */
    COSMOS.on('collision:shareReq', function () {
      shareCollision();
    });

    window.addEventListener('scroll', function () {
      // 实际计算在 rAF 内，这里只保证滚动一发生就更新 UI 状态
    }, { passive: true });

    let rt = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        applySize();
        if (postfx && mixRT) {
          // 尺寸变化后需要重绘一帧
          updateProgress();
          renderFrame();
        }
      }, 120);
    }, { passive: true });

    window.addEventListener('orientationchange', function () {
      setTimeout(function () { applySize(); }, 320);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        paused = true;
      } else {
        paused = false;
        lastT = performance.now();
      }
    });

    window.addEventListener('mousemove', function (e) {
      mouseTX = (e.clientX / Math.max(vw, 1)) * 2 - 1;
      mouseTY = -((e.clientY / Math.max(vh, 1)) * 2 - 1);
    }, { passive: true });

    window.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      const tag = (active && active.tagName) || '';
      const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        !!(active && active.isContentEditable);

      const k = e.key;

      // Esc 先于输入框早退：滑杆/输入框聚焦时也要能复位（§3.3 可逆）
      if (k === 'Escape') {
        const st = stages[activeIndex];
        if (st && typeof st.reset === 'function') {
          try { st.reset(); } catch (err) { reportError('reset#' + activeIndex, err); }
        }
        // 场景复位后把同章控件参数也交回默认（ui.js 监听）
        COSMOS.emit('cosmos:reset');
        COSMOS.emit('cosmos:escape');
        return;
      }

      if (isField) return;
      // 控件（tab / 滑杆 / 按钮）已处理过这个键，别重复响应
      if (e.defaultPrevented) return;

      input.keys[k] = true;
      if (k.length === 1) input.keys[k.toLowerCase()] = true;

      const isBtn = tag === 'BUTTON';
      const isArrow = k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowUp';
      const stage = stages[activeIndex];
      // 场景声明消费方向键时，方向键归场景（键盘等价操纵，§3.3）；切章用 PageUp/PageDown/j/k/Home/End
      if (isArrow && !isBtn && stage && stage.arrowKeys === true) return;
      // 场景声明消费空格时（06 章播放/暂停），空格不再切章
      if (k === ' ' && !isBtn && stage && stage.handlesSpace === true) {
        e.preventDefault();
        if (sections[activeIndex] && sections[activeIndex].id === 'ch-collision') {
          COSMOS.emit('collision:cmd', { type: 'pause' });
        }
        return;
      }
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (!isBtn && (k === ' ' || k === 'j'))) {
        e.preventDefault();
        goTo(activeIndex + 1);
      } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (!isBtn && k === 'k')) {
        e.preventDefault();
        goTo(activeIndex - 1);
      } else if (k === 'Home') {
        e.preventDefault();
        goTo(0);
      } else if (k === 'End') {
        e.preventDefault();
        goTo(sections.length - 1);
      }
    });

    window.addEventListener('keyup', function (e) {
      input.keys[e.key] = false;
      if (e.key.length === 1) input.keys[e.key.toLowerCase()] = false;
    });

    window.addEventListener('error', function (e) {
      if (e && e.message) reportError('window', e.message);
    });

    bindInput();
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  function start() {
    bindEvents();

    // 首屏先收集章节，尺寸留给 boot()/applySize 处理
    vw = window.innerWidth;
    vh = window.innerHeight;
    collectSections();

    boot().catch(function (e) {
      reportError('boot', e);
      failHard(T('启动过程中出现异常，宇宙暂时无法展开。', 'Something went wrong during startup; the universe cannot unfold right now.'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* 暴露给调试 */
  COSMOS.app = {
    goTo: goTo,
    shareSolar: shareSolar,
    solarShareUrl: solarShareUrl,
    shareCollision: shareCollision,
    collisionShareUrl: collisionShareUrl,
    get activeIndex() { return activeIndex; },
    get stages() { return stages; },
    get blend() { return blend; },
    get sections() { return sections; },
    get tops() { return []; },
    get heights() { return []; },
    get p() { return sectionP.slice(); },
    get o() { return sectionO.slice(); },
    get errors() { return window.__COSMOS_ERRORS || []; },
    get renderer() { return renderer; },
    get postfx() { return postfx; },
    get input() { return input; }
  };
})(window.COSMOS = window.COSMOS || {});
