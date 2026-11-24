/* ============================================================
 * COSMOS ATLAS — 公共星空舞台（ambient starfield）
 * 用于「尺度」「时间」「终章」三章：安静、深邃、有呼吸感
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;

  /* ---------- 可复现随机 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 星色（近似真实恒星色温分布）---------- */
  const STAR_TINT = [
    [0.60, 0.72, 1.00, 0.06],  // O/B 蓝白
    [0.74, 0.83, 1.00, 0.13],  // A 蓝白
    [0.92, 0.95, 1.00, 0.20],  // F 白
    [1.00, 0.98, 0.92, 0.26],  // G 黄白
    [1.00, 0.90, 0.74, 0.20],  // K 橙
    [1.00, 0.76, 0.56, 0.15]   // M 红橙
  ];

  function pickTint(r) {
    let acc = 0;
    for (let i = 0; i < STAR_TINT.length; i++) {
      acc += STAR_TINT[i][3];
      if (r <= acc) return STAR_TINT[i];
    }
    return STAR_TINT[3];
  }

  /* ---------- 变体：不同章节不同气质 ---------- */
  const VARIANTS = {
    // 01 尺度 —— 空旷、冷、辽阔
    1: { seed: 1101, density: 1.00, band: 0.55, core: 0.9, web: 0.10, tint: 0x24406e, tint2: 0x6f5fb8, drift: 1.00, fov: 62 },
    // 04 时间 —— 更深、偏紫、缓慢，宇宙网最明显（讲的就是大尺度结构的演化）
    4: { seed: 4404, density: 1.18, band: 0.72, core: 0.7, web: 0.17, tint: 0x3a2a66, tint2: 0x8a5fc0, drift: 0.72, fov: 58 },
    // 07 终章 —— 稀疏、安静、微冷
    7: { seed: 7707, density: 0.66, band: 0.32, core: 0.5, web: 0.04, tint: 0x1c2c48, tint2: 0x4a6fa8, drift: 0.48, fov: 64 }
  };

  const DEFAULTS = { seed: 5150, density: 1.0, band: 0.6, core: 0.8, web: 0.18, tint: 0x24365e, tint2: 0x6a5aa8, drift: 0.85, fov: 60 };

  /* ---------- 背景天球 ---------- */
  const BG_VS = `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const BG_FS = `
    uniform vec3  uTint;
    uniform vec3  uTint2;
    uniform float uBand;
    uniform float uCore;
    uniform float uWeb;
    uniform float uTime;
    varying vec3 vDir;

    float hash13(vec3 p) {
      p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float vnoise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = mix(hash13(i),                    hash13(i + vec3(1.0, 0.0, 0.0)), f.x);
      float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x);
      float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x);
      float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x);
      return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
    }

    float fbm2(vec3 p) {
      return vnoise(p) * 0.62 + vnoise(p * 2.13 + 7.7) * 0.38;
    }

    void main() {
      vec3 d = normalize(vDir);

      // 基础深空色（极暗，靠后处理的暗部抬升出层次）
      vec3 col = vec3(0.0018, 0.0028, 0.0062);

      // 银河大圆带
      vec3 bandN = normalize(vec3(0.36, 0.78, -0.51));
      float bd = abs(dot(d, bandN));
      float band = exp(-bd * bd * 22.0) * 0.85 + exp(-bd * bd * 5.5) * 0.15;
      col += uTint * band * uBand;

      // 银心方向
      vec3 coreDir = normalize(vec3(-0.66, 0.10, 0.74));
      float core = pow(max(dot(d, coreDir), 0.0), 6.0);
      col += uTint2 * core * uCore * 0.11;

      // ---- 宇宙大尺度结构 ----
      // fbm 的「等值面」附近连成纤维，纤维之间是巨大的空洞。
      // 这是宇宙网（cosmic web）最粗的一层观感：丝状 + 空腔，而不是均匀的雾。
      vec3 q = d * 2.4 + vec3(0.0, 0.0, uTime * 0.0035);
      float f1 = fbm2(q);
      float ridge = 1.0 - abs(f1 - 0.5) * 2.0;
      float web = pow(max(ridge, 0.0), 13.0);
      web *= 0.55 + 0.45 * fbm2(q * 3.1 + 19.0);
      col += uTint2 * web * uWeb * 1.5;
      col += uTint * web * uWeb * 0.4;

      // 大尺度雾气起伏
      float n1 = hash13(floor(d * 12.0));
      float n2 = hash13(floor(d * 31.0) + 7.0);
      col *= 0.86 + 0.20 * n1 + 0.10 * n2;

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `;

  /* ---------- 星点 ---------- */
  const STAR_VS = `
    attribute float aSize;
    attribute vec3  aColor;
    attribute float aSeed;
    attribute float aTwinkle;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uOpacity;
    uniform float uSizeScale;

    varying vec3  vColor;
    varying float vAlpha;
    varying float vGlow;

    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;

      float dist = max(-mv.z, 1.0);
      gl_PointSize = aSize * uSizeScale * uPixelRatio * (420.0 / dist);

      // 闪烁：频率和相位都由种子决定
      float ph = aSeed * 91.7;
      float fq = 0.55 + aSeed * 2.4;
      float tw = 0.78 + 0.22 * sin(uTime * fq + ph);
      tw *= 0.94 + 0.06 * sin(uTime * fq * 2.7 + ph * 1.9);

      vAlpha = tw * aTwinkle * uOpacity;
      vColor = aColor;
      vGlow = aTwinkle;
    }
  `;

  const STAR_FS = `
    varying vec3  vColor;
    varying float vAlpha;
    varying float vGlow;

    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float r = length(c);

      // 核心 + 柔和外晕
      float core = smoothstep(0.5, 0.06, r);
      float halo = smoothstep(0.5, 0.0, r);
      float a = core * core * 0.85 + halo * halo * halo * 0.45;

      // 亮星加一点点十字星芒
      float spikes = 0.0;
      if (vGlow > 0.72) {
        vec2 ax = abs(c);
        float h = max(ax.x, ax.y * 0.62);
        spikes = smoothstep(0.5, 0.0, h) * smoothstep(0.5, 0.1, min(ax.x, ax.y) * 9.0) * 0.35;
      }

      float v = (a + spikes) * vAlpha;
      gl_FragColor = vec4(vColor * v, 1.0);
    }
  `;

  /* ============================================================
   * Stage 工厂
   * ============================================================ */
  function ambientStage(ctx) {
    const v = VARIANTS[ctx.index] || DEFAULTS;
    const rnd = mulberry32(v.seed);
    const quality = ctx.quality || 'high';

    const scene = new THREE.Scene();
    const camera = COSMOS.util.makeCamera(v.fov, ctx.aspect || 1);
    camera.near = 0.1;
    camera.far = 4000;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, 0);
    camera.rotation.order = 'YXZ';

    const disposables = [];

    /* ---------- 背景天球 ---------- */
    const bgGeo = new THREE.SphereGeometry(1600, 48, 32);
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uTint: { value: new THREE.Color(v.tint) },
        uTint2: { value: new THREE.Color(v.tint2) },
        uBand: { value: v.band },
        uCore: { value: v.core },
        uWeb: { value: v.web },
        uTime: { value: 0 }
      },
      vertexShader: BG_VS,
      fragmentShader: BG_FS,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.frustumCulled = false;
    bg.renderOrder = -1000;
    scene.add(bg);
    disposables.push(bgGeo, bgMat);

    /* ---------- 星点几何构建 ---------- */
    function buildStars(count, radiusMin, radiusMax, sizeMin, sizeMax, isBand) {
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const size = new Float32Array(count);
      const seed = new Float32Array(count);
      const twk = new Float32Array(count);

      // 银河带法线
      const bn = new THREE.Vector3(0.36, 0.78, -0.51).normalize();
      const tmp = new THREE.Vector3();
      const helper = new THREE.Vector3();

      for (let i = 0; i < count; i++) {
        let x, y, z;

        if (isBand) {
          // 沿大圆生成：先取与法线正交的两个基向量
          tmp.set(1, 0, 0);
          if (Math.abs(bn.dot(tmp)) > 0.9) tmp.set(0, 1, 0);
          const u = new THREE.Vector3().crossVectors(bn, tmp).normalize();
          helper.crossVectors(bn, u).normalize();

          const ang = rnd() * Math.PI * 2;
          // 高斯型法向偏移
          const off = (rnd() + rnd() + rnd() - 1.5) * 0.30;

          const cu = Math.cos(ang) * 1.0;
          const su = Math.sin(ang) * 1.0;

          x = u.x * cu + helper.x * su + bn.x * off;
          y = u.y * cu + helper.y * su + bn.y * off;
          z = u.z * cu + helper.z * su + bn.z * off;

          const r = radiusMin + rnd() * (radiusMax - radiusMin);
          const len = Math.sqrt(x * x + y * y + z * z) || 1;
          x = (x / len) * r;
          y = (y / len) * r;
          z = (z / len) * r;
        } else {
          // 均匀球面
          const u1 = rnd() * 2 - 1;
          const th = rnd() * Math.PI * 2;
          const sq = Math.sqrt(1 - u1 * u1);
          const r = radiusMin + rnd() * (radiusMax - radiusMin);
          x = sq * Math.cos(th) * r;
          y = u1 * r;
          z = sq * Math.sin(th) * r;
        }

        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = z;

        const tint = pickTint(rnd());
        const k = 0.72 + rnd() * 0.28;
        col[i * 3] = tint[0] * k;
        col[i * 3 + 1] = tint[1] * k;
        col[i * 3 + 2] = tint[2] * k;

        // 少数亮星
        const bright = rnd();
        const isBright = bright > 0.972;
        let s = sizeMin + Math.pow(rnd(), 2.4) * (sizeMax - sizeMin);
        if (isBright) s *= 2.3;

        size[i] = s;
        seed[i] = rnd();
        twk[i] = isBright ? 0.95 + rnd() * 0.05 : 0.35 + rnd() * 0.55;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twk, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radiusMax * 1.2);

      return geo;
    }

    function makeStarMat(opacity, sizeScale) {
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: ctx.pixelRatio || 1 },
          uOpacity: { value: opacity },
          uSizeScale: { value: sizeScale }
        },
        vertexShader: STAR_VS,
        fragmentShader: STAR_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      });
      return m;
    }

    // 三层层级，制造纵深
    const layerCfg = [
      { count: 3400, rMin: 620, rMax: 1500, sMin: 0.9, sMax: 3.4, op: 0.62, scale: 1.0, band: false },
      { count: 2400, rMin: 380, rMax: 720, sMin: 1.2, sMax: 4.6, op: 0.80, scale: 1.15, band: false },
      { count: 1600, rMin: 260, rMax: 460, sMin: 1.4, sMax: 5.2, op: 0.55, scale: 1.3, band: false }
    ];

    // 银河带粒子
    const bandCount = Math.floor(2600 * v.density);
    const starLayers = [];

    const qMul = quality === 'low' ? 0.45 : (quality === 'medium' ? 0.7 : 1);
    for (let i = 0; i < layerCfg.length; i++) {
      const c = layerCfg[i];
      const geo = buildStars(Math.floor(c.count * v.density * qMul),
        c.rMin, c.rMax, c.sMin, c.sMax, false);
      const mat = makeStarMat(c.op, c.scale);
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 10 + i;
      scene.add(pts);
      starLayers.push({ pts: pts, mat: mat, geo: geo });
      disposables.push(geo, mat);
    }

    // 银河带
    const bandGeo = buildStars(Math.floor(bandCount * qMul), 700, 1450, 0.8, 2.6, true);
    const bandMat = makeStarMat(0.34, 0.9);
    const bandPts = new THREE.Points(bandGeo, bandMat);
    bandPts.frustumCulled = false;
    bandPts.renderOrder = 20;
    scene.add(bandPts);
    starLayers.push({ pts: bandPts, mat: bandMat, geo: bandGeo });
    disposables.push(bandGeo, bandMat);

    /* ---------- 星云薄雾（sprite）---------- */
    const hazeTex = COSMOS.tex.glowTexture(256, 0.28);
    disposables.push(hazeTex);

    // 星云薄雾：只做极淡的色偏，sprite 中心一律推到画面外，
    // 避免径向渐变的边界在加法混合下被看成「色带」。
    const hazeDefs = [
      { color: v.tint2, scale: 880, pos: [-1180, 620, -1500], op: 0.020 },
      { color: v.tint, scale: 1150, pos: [1080, -760, -1650], op: 0.015 },
      { color: v.tint2, scale: 620, pos: [760, 980, -1200], op: 0.012 }
    ];

    const hazes = [];
    for (let i = 0; i < hazeDefs.length; i++) {
      const d = hazeDefs[i];
      const mat = new THREE.SpriteMaterial({
        map: hazeTex,
        color: new THREE.Color(d.color),
        transparent: true,
        opacity: d.op,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(d.pos[0], d.pos[1], d.pos[2]);
      sp.scale.set(d.scale, d.scale, 1);
      sp.renderOrder = -10;
      scene.add(sp);
      hazes.push(sp);
      disposables.push(mat);
    }

    /* ---------- 交互状态 ---------- */
    let mx = 0, my = 0, tmx = 0, tmy = 0;
    function onMove(e) {
      tmx = (e.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
      tmy = -((e.clientY / Math.max(window.innerHeight, 1)) * 2 - 1);
    }
    window.addEventListener('mousemove', onMove, { passive: true });

    const state = {
      yaw: rnd() * Math.PI * 2,
      pitch: (rnd() - 0.5) * 0.25,
      roll: 0,
      fovNow: v.fov
    };

    /* ---------- 帧更新 ---------- */
    function update(t, dt, p) {
      mx += (tmx - mx) * 0.045;
      my += (tmy - my) * 0.045;

      // 极慢自转，制造「漂浮」
      state.yaw += dt * 0.0075 * v.drift;
      state.pitch += dt * 0.0016 * v.drift;

      const e = p * p * (3 - 2 * p);   // 章节进度 → 平滑

      camera.rotation.y = state.yaw + mx * 0.055 + e * 0.12;
      camera.rotation.x = state.pitch + my * 0.040 - e * 0.05;
      camera.rotation.z = Math.sin(t * 0.05) * 0.008;

      // 推镜：fov 随章节进度收紧。注意走 fitCamera 而不是直接写 camera.fov，
      // 这样竖屏时仍会自动放大垂直视角，保持水平视野不被裁。
      const base = camera.userData.baseFov || v.fov;
      camera.userData.baseFov = base;
      const targetFov = base - e * 6.5;
      if (Math.abs((camera.userData.dynFov || 0) - targetFov) > 0.02) {
        camera.userData.dynFov = targetFov;
        if (COSMOS.util.fitCamera) COSMOS.util.fitCamera(camera, targetFov, camera.aspect);
        else { camera.fov = targetFov; camera.updateProjectionMatrix(); }
      }

      bgMat.uniforms.uTime.value = t;

      for (let i = 0; i < starLayers.length; i++) {
        starLayers[i].mat.uniforms.uTime.value = t;
      }

      // 星云缓慢呼吸
      for (let i = 0; i < hazes.length; i++) {
        hazes[i].material.opacity = hazeDefs[i].op * (0.86 + 0.14 * Math.sin(t * 0.18 + i * 2.1));
      }
    }

    function resize(w, h) {
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      const pr = ctx.pixelRatio || 1;
      for (let i = 0; i < starLayers.length; i++) {
        starLayers[i].mat.uniforms.uPixelRatio.value = pr;
      }
    }

    function dispose() {
      window.removeEventListener('mousemove', onMove);
      for (let i = 0; i < disposables.length; i++) {
        try { disposables[i].dispose(); } catch (e) {}
      }
      scene.clear();
    }

    return {
      scene: scene,
      camera: camera,
      update: update,
      resize: resize,
      dispose: dispose
    };
  }

  COSMOS.registerStage('starfield', ambientStage);
  COSMOS.registerStage('idle', ambientStage);
})(window.COSMOS = window.COSMOS || {});
