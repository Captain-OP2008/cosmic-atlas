/* ============================================================
 * COSMOS ATLAS — 核心运行时库
 * 提供：场景注册表、数学/缓动工具、程序化纹理工厂、星空构建器
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;

  /* ---------------- 场景注册表 ---------------- */
  COSMOS.stages = {};
  COSMOS.stageOrder = [];
  COSMOS.registerStage = function (id, factory) {
    COSMOS.stages[id] = factory;
    if (COSMOS.stageOrder.indexOf(id) < 0) COSMOS.stageOrder.push(id);
  };

  /* ---------------- 质量档位 ---------------- */
  COSMOS.QUALITY = 'high';

  /* ---------------- 数学 / 缓动 ---------------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // 帧率无关的指数平滑
  const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

  const ease = {
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inCubic: t => t * t * t,
    outQuint: t => 1 - Math.pow(1 - t, 5),
    inOutQuint: t => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
    outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2
  };

  let _seed = 1337;
  function rand() {
    // xorshift32，保证每次刷新画面一致
    _seed ^= _seed << 13; _seed >>>= 0;
    _seed ^= _seed >> 17;
    _seed ^= _seed << 5; _seed >>>= 0;
    return _seed / 4294967296;
  }
  const randRange = (a, b) => a + rand() * (b - a);
  const reseed = s => { _seed = s >>> 0 || 1; };

  /* ---------------- 程序化纹理 ---------------- */
  const texCache = {};

  function canvasTexture(w, h, draw, opts) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = (opts && opts.srgb) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (opts && opts.wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.needsUpdate = true;
    return t;
  }

  // 径向光晕（用于发光 sprite / 粒子）
  function glowTexture(size = 256, inner = '#ffffff', outer = 'rgba(255,255,255,0)') {
    const key = 'glow' + size + inner + outer;
    if (texCache[key]) return texCache[key];
    const t = canvasTexture(size, size, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0.0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.18, 'rgba(255,255,255,0.85)');
      grd.addColorStop(0.42, 'rgba(255,255,255,0.32)');
      grd.addColorStop(0.72, 'rgba(255,255,255,0.06)');
      grd.addColorStop(1.0, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    texCache[key] = t;
    return t;
  }

  // 柔和云团（星云 sprite）
  function cloudTexture(size = 256) {
    const key = 'cloud' + size;
    if (texCache[key]) return texCache[key];
    const t = canvasTexture(size, size, (g, w, h) => {
      const img = g.createImageData(w, h);
      // 多层圆斑叠加 + 噪声
      const blobs = [];
      for (let i = 0; i < 26; i++) {
        blobs.push({
          x: rand() * w, y: rand() * h,
          r: (0.06 + rand() * 0.22) * w,
          a: 0.12 + rand() * 0.35
        });
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = 0;
          for (let b = 0; b < blobs.length; b++) {
            const bl = blobs[b];
            let dx = Math.abs(x - bl.x); dx = Math.min(dx, w - dx);
            let dy = Math.abs(y - bl.y); dy = Math.min(dy, h - dy);
            const d = Math.sqrt(dx * dx + dy * dy) / bl.r;
            v += bl.a * Math.exp(-d * d * 2.2);
          }
          // 边缘衰减，避免 sprite 硬边
          const nx = (x / w - 0.5) * 2, ny = (y / h - 0.5) * 2;
          const edge = 1 - smoothstep(0.55, 1.0, Math.sqrt(nx * nx + ny * ny));
          const a = clamp(v * edge, 0, 1);
          const i = (y * w + x) * 4;
          img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
          img.data[i + 3] = a * 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
    texCache[key] = t;
    return t;
  }

  // 环形颗粒纹理（用于行星环 / 吸积盘贴图）
  function ringTexture(size = 512) {
    const key = 'ring' + size;
    if (texCache[key]) return texCache[key];
    const t = canvasTexture(size, 8, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i <= 40; i++) {
        const p = i / 40;
        const v = 0.35 + 0.65 * Math.abs(Math.sin(p * 21.3) * Math.sin(p * 6.7 + 1.2));
        const a = 0.15 + 0.85 * Math.pow(Math.abs(Math.sin(p * 13.1 + 0.4)), 1.6);
        grd.addColorStop(p, `rgba(255,255,255,${(v * a).toFixed(3)})`);
      }
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }, { wrap: true });
    texCache[key] = t;
    return t;
  }

  /* ---------------- 星空构建器 ---------------- */
  // 生成球壳状星点；返回 { geometry, material }（可复用）
  function starfieldGeometry(opts) {
    opts = opts || {};
    const count = opts.count || 9000;
    const rMin = opts.rMin || 400;
    const rMax = opts.rMax || 1400;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);

    const palette = [
      [0.62, 0.76, 1.0],   // 蓝白（热星）
      [0.86, 0.91, 1.0],   // 白
      [1.0, 0.97, 0.88],   // 淡黄
      [1.0, 0.82, 0.55],   // 橙
      [1.0, 0.62, 0.45]    // 红（冷巨星）
    ];

    for (let i = 0; i < count; i++) {
      // 球面均匀分布
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = rMin + Math.pow(rand(), 0.55) * (rMax - rMin);
      const x = s * Math.cos(theta) * r;
      const y = u * r;
      const z = s * Math.sin(theta) * r;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;

      // 颜色分布：大部分偏蓝白，少量暖色
      const pick = rand();
      let c;
      if (pick < 0.55) c = palette[0];
      else if (pick < 0.8) c = palette[1];
      else if (pick < 0.92) c = palette[2];
      else if (pick < 0.98) c = palette[3];
      else c = palette[4];

      const bright = 0.45 + Math.pow(rand(), 2.2) * 0.85;
      col[i * 3] = c[0] * bright;
      col[i * 3 + 1] = c[1] * bright;
      col[i * 3 + 2] = c[2] * bright;

      size[i] = 0.9 + Math.pow(rand(), 3.5) * 5.2;
      phase[i] = rand();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    return geo;
  }

  const starfieldMaterialCache = [];
  function starfieldMaterial() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uOpacity: { value: 1 }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.72 + 0.28 * sin(uTime * 1.3 + aPhase * 43.0);
          gl_PointSize = aSize * uPixelRatio * (420.0 / max(-mv.z, 1.0)) * (0.8 + 0.4 * tw);
          vColor = aColor;
          vTwinkle = tw;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = 1.0 - smoothstep(0.0, 1.0, d);
          a = pow(a, 2.2);
          // 中心十字星芒
          float spike = max(0.0, 1.0 - min(abs(c.x), abs(c.y)) * 26.0) * (1.0 - d);
          a += spike * 0.35;
          gl_FragColor = vec4(vColor * (0.9 + vTwinkle * 0.6), a * uOpacity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });
    starfieldMaterialCache.push(mat);
    return mat;
  }

  // 创建星空对象（每个场景各持有一个）
  function makeStarfield(opts) {
    const geo = starfieldGeometry(opts);
    const mat = starfieldMaterial();
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -10;
    pts.userData.isStarfield = true;
    return pts;
  }

  // 每帧更新所有星空的 uniform（由主循环调用）
  function updateStarfields(t) {
    for (let i = 0; i < starfieldMaterialCache.length; i++) {
      starfieldMaterialCache[i].uniforms.uTime.value = t;
    }
  }

  /* ---------------- 通用小工具 ---------------- */
  function disposeGroup(obj) {
    if (!obj) return;
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          if (m.map) m.map.dispose();
          if (m.uniforms) {
            Object.keys(m.uniforms).forEach(k => {
              const v = m.uniforms[k].value;
              if (v && v.isTexture) v.dispose();
            });
          }
          m.dispose();
        });
      }
    });
  }

  // 创建一台统一规格的相机
  //
  // fov 一律按【横屏】的含义理解：竖屏（aspect < 1）时自动放大垂直视角，
  // 保证水平视野不缩水 —— 否则手机上银河、太阳、行星会被裁掉两侧。
  function makeCamera(fov, aspect) {
    const a = aspect || 1;
    let vFov = fov || 50;
    if (a < 1) {
      const half = THREE.MathUtils.degToRad(vFov) * 0.5;
      vFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / a));
      vFov = Math.min(vFov, 108); // 别把鱼眼推到畸形
    }
    const cam = new THREE.PerspectiveCamera(vFov, a, 0.1, 20000);
    cam.position.set(0, 0, 5);
    cam.userData.baseFov = fov || 50;
    return cam;
  }

  // 竖屏时同步更新相机（供各 stage 的 resize 调用）
  function fitCamera(cam, fov, aspect) {
    if (!cam || !cam.isPerspectiveCamera) return;
    const a = aspect || 1;
    let vFov = fov;
    if (a < 1) {
      const half = THREE.MathUtils.degToRad(vFov) * 0.5;
      vFov = Math.min(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / a)), 108);
    }
    cam.fov = vFov;
    cam.aspect = a;
    cam.updateProjectionMatrix();
  }

  // 全屏四边形（后处理用）
  function makeFullscreenQuad() {
    const geo = new THREE.PlaneGeometry(2, 2);
    return new THREE.Mesh(geo, null);
  }

  /* 全屏 fbm 层的离屏低分辨率渲染
   * ------------------------------------------------------------
   * 星云本体是两片覆盖全屏的 ShaderMaterial 平面（每个像素约 23 次 fbm），
   * 是 07/08/09/10 四章唯一的大头。把这两片移进独立场景，先按 scale
   * 渲染进一张 HalfFloat 渲染目标，再用 additive 全屏四边形贴回主场景：
   * 片元计算量降到 scale²，星云是低频画面，视觉上看不出差别。
   *
   * opts: { planes:[Mesh], scene, camera, renderer, scale, renderOrder }
   * 返回 { quad, render(), dispose() }；调用方在 update() 里调用 render()。
   */
  function makeLowResLayer(opts) {
    const planes = opts.planes || [];
    const mainScene = opts.scene;
    const camera = opts.camera;
    const renderer = opts.renderer;
    const scale = opts.scale || 0.5;
    const order = opts.renderOrder === undefined ? 0 : opts.renderOrder;
    /* every>1 时每 N 帧才重渲一次离屏层（慢速演化的大气/星云够用），其余帧复用上一张 */
    const every = Math.max(1, opts.every || 1);
    let tick = 0;

    const bgScene = new THREE.Scene();
    for (let i = 0; i < planes.length; i++) bgScene.add(planes[i]);

    const rt = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });

    const mat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: rt.texture } },
      vertexShader: [
        'varying vec2 vUv;',
        'void main () { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tSrc;',
        'varying vec2 vUv;',
        'void main () { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }'
      ].join('\n'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    quad.renderOrder = order;
    mainScene.add(quad);

    const _sz = new THREE.Vector2();
    let curW = 0;
    let curH = 0;
    let disposed = false;

    function render() {
      if (disposed) return;
      tick++;
      if (every > 1 && tick > every && tick % every !== 0) return;
      renderer.getDrawingBufferSize(_sz);
      const w = Math.max(2, Math.round(_sz.x * scale));
      const hh = Math.max(2, Math.round(_sz.y * scale));
      if (w !== curW || hh !== curH) {
        curW = w;
        curH = hh;
        rt.setSize(w, hh);
      }
      const prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(rt);
      renderer.clear(true, false, false);
      renderer.render(bgScene, camera);
      renderer.setRenderTarget(null);
      renderer.autoClear = prevAuto;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      rt.dispose();
      quad.geometry.dispose();
      mat.dispose();
    }

    return { quad: quad, scene: bgScene, render: render, dispose: dispose };
  }

  /* ============================================================
   * 事件总线（v2）
   * ============================================================ */
  const _bus = {};
  function on(name, fn) {
    (_bus[name] || (_bus[name] = [])).push(fn);
    return function () { off(name, fn); };
  }
  function off(name, fn) {
    const arr = _bus[name];
    if (!arr) return;
    const k = arr.indexOf(fn);
    if (k >= 0) arr.splice(k, 1);
  }
  function emit(name, payload) {
    const arr = _bus[name];
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (e) {
        if (window.console) console.error('[COSMOS] bus ' + name, e);
      }
    }
  }

  /* ============================================================
   * DOM 工具（v2，ui.js 与各 feature 共用）
   * ============================================================ */
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (p) { el.style.setProperty(p, v[p]); });
        } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      });
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return el;
  }

  // 中文字体缺上标字形，统一把 Unicode 上标转 <sup>
  const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '−', '⁺': '+' };
  function richText(str) {
    return String(str === null || str === undefined ? '' : str).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, function (m) {
      let out = '<sup>';
      for (let i = 0; i < m.length; i++) out += SUP[m[i]] || '';
      return out + '</sup>';
    });
  }

  function clear(el) {
    if (!el) return el;
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function num(v, digits) {
    const d = digits === undefined ? 0 : digits;
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return n.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ============================================================
   * 真实贴图加载（v2：从 COSMOS.TEX 的 data URL 取）
   * ============================================================ */
  const loader = new THREE.TextureLoader();
  const loadedTex = {};

  function loadTexture(key, opts) {
    opts = opts || {};
    const ck = key + '|' + (opts.repeatX || 1) + ',' + (opts.repeatY || 1) + '|' + (opts.wrap ? 1 : 0);
    if (loadedTex[ck]) return loadedTex[ck];

    const src = (COSMOS.TEX && COSMOS.TEX[key]) || null;
    // 缺图时返回 1x1 中灰，界面不至于崩溃
    if (!src) {
      const t = canvasTexture(2, 2, function (g, w, hh) {
        g.fillStyle = '#555';
        g.fillRect(0, 0, w, hh);
      }, { srgb: true });
      loadedTex[ck] = t;
      return t;
    }

    // 触屏/小屏：把 4K 贴图在加载后降采样，避免移动端显存爆掉
    const maxW = COSMOS.tex && COSMOS.tex.maxWidth;
    if (maxW && maxW < 4096) {
      const tex = new THREE.Texture();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      if (opts.wrap) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(opts.repeatX || 1, opts.repeatY || 1);
      }
      const im = new Image();
      im.onload = function () {
        try {
          const w = Math.min(maxW, im.width);
          const hh = Math.max(1, Math.round(im.height * w / im.width));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = hh;
          c.getContext('2d').drawImage(im, 0, 0, w, hh);
          tex.image = c;
          tex.needsUpdate = true;
        } catch (e) { /* 降采样失败就保持空纹理，不阻断运行 */ }
      };
      im.src = src;
      loadedTex[ck] = tex;
      return tex;
    }

    const t = loader.load(src);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (opts.wrap) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(opts.repeatX || 1, opts.repeatY || 1);
    }
    loadedTex[ck] = t;
    return t;
  }

  /* ============================================================
   * 拾取 / 投影（v2，场景点击与标签共用）
   * ============================================================ */
  const raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();

  function pick(objects, camera, nx, ny) {
    if (!objects || !objects.length) return null;
    _ndc.set(nx, ny);
    raycaster.setFromCamera(_ndc, camera);
    const hits = raycaster.intersectObjects(objects, true);
    return hits.length ? hits[0] : null;
  }

  const _proj = new THREE.Vector3();
  function project(camera, v3, width, height) {
    _proj.copy(v3).project(camera);
    return {
      x: (_proj.x * 0.5 + 0.5) * width,
      y: (-_proj.y * 0.5 + 0.5) * height,
      z: _proj.z,
      visible: _proj.z < 1 && _proj.z > -1
    };
  }

  /* ============================================================
   * 内容 / 组件注册表（v2）
   * ============================================================ */
  COSMOS.CONTENT = COSMOS.CONTENT || {};
  COSMOS.state = COSMOS.state || {};
  COSMOS.addContent = function (id, obj) {
    if (!id || !obj) return;
    COSMOS.CONTENT[id] = obj;
  };

  COSMOS.widgets = {};
  COSMOS.registerWidget = function (id, factory) {
    if (!id || typeof factory !== 'function') return;
    COSMOS.widgets[id] = factory;
  };

  COSMOS.bus = { on: on, off: off, emit: emit };
  COSMOS.on = on;
  COSMOS.off = off;
  COSMOS.emit = emit;

  COSMOS.dom = { h: h, richText: richText, clear: clear, num: num };

  COSMOS.util = {
    clamp, lerp, smoothstep, damp, ease,
    rand, randRange, reseed,
    disposeGroup, makeCamera, fitCamera, makeFullscreenQuad, makeLowResLayer,
    pick: pick, project: project, raycaster: raycaster,
    num: num, richText: richText
  };

  COSMOS.tex = {
    canvasTexture, glowTexture, cloudTexture, ringTexture,
    load: loadTexture
  };
  // 兼容别名：部分场景按 COSMOS.util.tex 取纹理工具
  COSMOS.util.tex = COSMOS.tex;

  COSMOS.builders = {
    makeStarfield, starfieldGeometry, updateStarfields, starfieldMaterial
  };
})(window.COSMOS = window.COSMOS || {});
