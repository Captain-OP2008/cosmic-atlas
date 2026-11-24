/* ============================================================
 * COSMOS ATLAS — 后处理管线
 * 渲染到 HDR 缓冲 → 亮度提取 → 三级高斯模糊泛光 → ACES 色调映射
 * 附带：暗角、胶片颗粒、轻微色差、暗部冷调
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;

  const FULLSCREEN_VS = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const BRIGHT_FS = `
    uniform sampler2D tDiffuse;
    uniform float uThreshold;
    uniform float uSoftKnee;
    varying vec2 vUv;

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // 软阈值：保留一点阈值附近的过渡，避免硬边
      float knee = uThreshold * uSoftKnee + 1e-5;
      float soft = clamp(lum - uThreshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee);
      float contribution = max(soft, lum - uThreshold) / max(lum, 1e-5);
      gl_FragColor = vec4(c * contribution, 1.0);
    }
  `;

  const BLUR_FS = `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform vec2 uDir;
    varying vec2 vUv;

    void main() {
      // 9-tap 可分离高斯（sigma ≈ 2）
      vec2 o = uTexel * uDir;
      vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
      sum += texture2D(tDiffuse, vUv + o * 1.3846153846).rgb * 0.3162162162;
      sum += texture2D(tDiffuse, vUv - o * 1.3846153846).rgb * 0.3162162162;
      sum += texture2D(tDiffuse, vUv + o * 3.2307692308).rgb * 0.0702702703;
      sum += texture2D(tDiffuse, vUv - o * 3.2307692308).rgb * 0.0702702703;
      gl_FragColor = vec4(sum, 1.0);
    }
  `;

  const COMPOSITE_FS = `
    uniform sampler2D tScene;
    uniform sampler2D tBloom0;
    uniform sampler2D tBloom1;
    uniform sampler2D tBloom2;
    uniform float uStrength;
    uniform float uBloomWeights0;
    uniform float uBloomWeights1;
    uniform float uBloomWeights2;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform vec2 uResolution;
    varying vec2 vUv;

    vec3 acesApprox(vec3 x) {
      const float a = 2.51; const float b = 0.03;
      const float c = 2.43; const float d = 0.59;
      const float e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    vec3 linearToSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float r2 = dot(center, center);

      // ---- 色差（径向）----
      // 只在「画面外圈 + 本身够亮」的地方出现。否则暗场里的单像素星点
      // 会被三个通道撕成红绿蓝散点，整个太空背景显脏。
      vec2 rad = uv - 0.5;
      float radLen = length(rad);
      vec3 base = texture2D(tScene, uv).rgb;
      float baseLum = dot(base, vec3(0.2126, 0.7152, 0.0722));
      vec2 ab = rad * uAberration
              * smoothstep(0.16, 0.62, radLen)
              * smoothstep(0.015, 0.20, baseLum);
      vec3 col;
      col.r = texture2D(tScene, uv + ab).r;
      col.g = base.g;
      col.b = texture2D(tScene, uv - ab).b;

      // ---- 多级泛光 ----
      vec3 bloom = texture2D(tBloom0, uv).rgb * uBloomWeights0
                 + texture2D(tBloom1, uv).rgb * uBloomWeights1
                 + texture2D(tBloom2, uv).rgb * uBloomWeights2;
      col += bloom * uStrength;

      // ---- 色调映射 ----
      col = acesApprox(col);

      // ---- 暗部轻微冷调 + 抬升（电影感）----
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 coolShadow = vec3(0.0032, 0.0056, 0.0112);
      col = mix(coolShadow * (1.0 - smoothstep(0.0, 0.22, lum)), col, smoothstep(0.0, 0.12, lum) * 0.85 + 0.15);
      col = max(col, vec3(0.0));

      // ---- 暗角 ----
      float vig = 1.0 - smoothstep(0.28, 0.95, length(center) * 1.35);
      col *= mix(1.0 - uVignette, 1.0, vig);

      // ---- 胶片颗粒（随时间抖动）----
      // 乘一层亮度掩码：纯黑区域几乎不加颗粒，否则太空背景会浮出一层灰噪。
      float grain = hash12(uv * uResolution + fract(uTime) * 91.7) - 0.5;
      float grainMask = 0.10 + 0.90 * smoothstep(0.0, 0.05, lum);
      col += grain * uGrain * grainMask;

      // ---- 输出 ----
      col = linearToSRGB(col);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  class PostFX {
    constructor(renderer, opts) {
      opts = opts || {};
      this.renderer = renderer;
      this.enabled = true;
      this.width = 1;
      this.height = 1;

      const type = (renderer.capabilities.isWebGL2 || renderer.extensions.has('EXT_color_buffer_half_float'))
        ? THREE.HalfFloatType
        : THREE.UnsignedByteType;
      this.bufferType = type;

      // 场景 HDR 缓冲
      this.rtScene = new THREE.WebGLRenderTarget(1, 1, {
        type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: true, stencilBuffer: false
      });
      this.rtScene.texture.generateMipmaps = false;

      // 泛光缓冲：三级（1/2, 1/4, 1/8）
      this.levels = [2, 4, 8];
      this.rtBright = this._makeRT(type);
      this.blurA = this.levels.map(() => this._makeRT(type));
      this.blurB = this.levels.map(() => this._makeRT(type));

      // 全屏四边形
      this.quadScene = new THREE.Scene();
      this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.geometry = new THREE.PlaneGeometry(2, 2);
      this.quad = new THREE.Mesh(this.geometry, null);
      this.quad.frustumCulled = false;
      this.quadScene.add(this.quad);

      // 材质
      this.brightMat = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uThreshold: { value: opts.threshold !== undefined ? opts.threshold : 0.72 },
          uSoftKnee: { value: 0.6 }
        },
        vertexShader: FULLSCREEN_VS,
        fragmentShader: BRIGHT_FS,
        depthTest: false, depthWrite: false
      });

      this.blurMat = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uTexel: { value: new THREE.Vector2(1, 1) },
          uDir: { value: new THREE.Vector2(1, 0) }
        },
        vertexShader: FULLSCREEN_VS,
        fragmentShader: BLUR_FS,
        depthTest: false, depthWrite: false
      });

      this.compositeMat = new THREE.ShaderMaterial({
        uniforms: {
          tScene: { value: this.rtScene.texture },
          tBloom0: { value: this.blurA[0].texture },
          tBloom1: { value: this.blurA[1].texture },
          tBloom2: { value: this.blurA[2].texture },
          uStrength: { value: opts.strength !== undefined ? opts.strength : 0.85 },
          uBloomWeights0: { value: 0.55 },
          uBloomWeights1: { value: 0.42 },
          uBloomWeights2: { value: 0.32 },
          uTime: { value: 0 },
          uVignette: { value: opts.vignette !== undefined ? opts.vignette : 0.55 },
          uGrain: { value: opts.grain !== undefined ? opts.grain : 0.030 },
          uAberration: { value: opts.aberration !== undefined ? opts.aberration : 0.014 },
          uResolution: { value: new THREE.Vector2(1, 1) }
        },
        vertexShader: FULLSCREEN_VS,
        fragmentShader: COMPOSITE_FS,
        depthTest: false, depthWrite: false
      });
    }

    _makeRT(type) {
      const rt = new THREE.WebGLRenderTarget(1, 1, {
        type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false
      });
      rt.texture.generateMipmaps = false;
      return rt;
    }

    setSize(w, h, pixelRatio) {
      const pr = pixelRatio || 1;
      this.width = Math.max(1, Math.floor(w * pr));
      this.height = Math.max(1, Math.floor(h * pr));

      this.rtScene.setSize(this.width, this.height);
      for (let i = 0; i < this.levels.length; i++) {
        const lw = Math.max(1, Math.floor(this.width / this.levels[i]));
        const lh = Math.max(1, Math.floor(this.height / this.levels[i]));
        this.blurA[i].setSize(lw, lh);
        this.blurB[i].setSize(lw, lh);
      }
      this.compositeMat.uniforms.uResolution.value.set(this.width, this.height);
    }

    _blit(material, target) {
      this.quad.material = material;
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.quadScene, this.quadCamera);
    }

    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {Object} p  { time, strength, threshold, vignette, grain, aberration, bloomWeights }
     */
    render(scene, camera, p) {
      const r = this.renderer;
      const prevTarget = r.getRenderTarget();

      // 1. 场景渲染到 HDR 缓冲
      r.setRenderTarget(this.rtScene);
      r.clear();
      r.render(scene, camera);

      this._post(this.rtScene.texture, p);
      r.setRenderTarget(prevTarget);
    }

    /**
     * 从外部纹理开始后期（供多场景混合后调用），跳过场景渲染步骤
     * @param {THREE.Texture} srcTexture
     * @param {Object} p
     */
    renderFrom(srcTexture, p) {
      const r = this.renderer;
      const prevTarget = r.getRenderTarget();
      this._post(srcTexture, p);
      r.setRenderTarget(prevTarget);
    }

    _post(srcTexture, p) {
      const r = this.renderer;
      p = p || {};

      // 2. 亮度提取（半分辨率）
      this.brightMat.uniforms.tDiffuse.value = srcTexture;
      this.brightMat.uniforms.uThreshold.value = p.threshold !== undefined ? p.threshold : 0.72;
      this._blit(this.brightMat, this.blurA[0]);

      // 3. 每级模糊
      for (let i = 0; i < this.levels.length; i++) {
        const src = (i === 0) ? this.blurA[0] : this.blurB[i - 1];
        // 若上一级尺寸不同，先降采样
        if (i > 0) {
          this.blurMat.uniforms.tDiffuse.value = this.blurB[i - 1].texture;
          this.blurMat.uniforms.uTexel.value.set(1 / this.blurB[i - 1].width, 1 / this.blurB[i - 1].height);
          this.blurMat.uniforms.uDir.value.set(1, 0);
          this._blit(this.blurMat, this.blurA[i]);
        }
        const rtW = this.blurA[i].width, rtH = this.blurA[i].height;

        // 水平
        this.blurMat.uniforms.tDiffuse.value = this.blurA[i].texture;
        this.blurMat.uniforms.uTexel.value.set(1 / rtW, 1 / rtH);
        this.blurMat.uniforms.uDir.value.set(1, 0);
        this._blit(this.blurMat, this.blurB[i]);

        // 垂直
        this.blurMat.uniforms.tDiffuse.value = this.blurB[i].texture;
        this.blurMat.uniforms.uTexel.value.set(1 / rtW, 1 / rtH);
        this.blurMat.uniforms.uDir.value.set(0, 1);
        this._blit(this.blurMat, this.blurA[i]);
      }

      // 4. 合成到屏幕
      const cu = this.compositeMat.uniforms;
      cu.tScene.value = srcTexture;
      cu.tBloom0.value = this.blurA[0].texture;
      cu.tBloom1.value = this.blurA[1].texture;
      cu.tBloom2.value = this.blurA[2].texture;
      cu.uTime.value = p.time || 0;
      if (p.strength !== undefined) cu.uStrength.value = p.strength;
      if (p.vignette !== undefined) cu.uVignette.value = p.vignette;
      if (p.grain !== undefined) cu.uGrain.value = p.grain;
      if (p.aberration !== undefined) cu.uAberration.value = p.aberration;
      if (p.bloomWeights) {
        cu.uBloomWeights0.value = p.bloomWeights[0];
        cu.uBloomWeights1.value = p.bloomWeights[1];
        cu.uBloomWeights2.value = p.bloomWeights[2];
      }

      this.quad.material = this.compositeMat;
      r.setRenderTarget(null);
      r.render(this.quadScene, this.quadCamera);
    }

    dispose() {
      this.rtScene.dispose();
      this.rtBright.dispose();
      this.blurA.forEach(rt => rt.dispose());
      this.blurB.forEach(rt => rt.dispose());
      this.geometry.dispose();
      this.brightMat.dispose();
      this.blurMat.dispose();
      this.compositeMat.dispose();
    }
  }

  COSMOS.PostFX = PostFX;
})(window.COSMOS = window.COSMOS || {});
