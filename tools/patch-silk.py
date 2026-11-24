import io, re
p = 'js/scene-overview.js'
s = io.open(p, encoding='utf-8').read()

# 1) 着色器常量（插在粒子 FS 之后）
anchor = "  function mulberry32(a) {"
assert anchor in s
silk = '''  /* ---------- 丝绸纤维（ribbon）着色器 ----------
   * 每条纤维是一条面向相机的软边带子：顶点着色器里用「切线 × 视线」
   * 展开左右两条边，片元按到中线的距离做高斯衰减（窄亮芯 + 宽柔光晕），
   * 再沿纤维长度叠加缓慢的丝绸光泽波动，避免出现钢丝一样的硬边。 */
  const SILK_VS = `
    attribute vec3  aCenter;
    attribute vec3  aTangent;
    attribute float aSide;
    attribute float aU;
    attribute float aWidth;
    attribute vec3  aColor;
    attribute float aSpin;
    attribute float aPhase;
    uniform float uTime;
    uniform float uWidthMul;
    varying float vSide;
    varying float vU;
    varying vec3  vColor;
    varying float vSeed;
    varying float vFade;
    void main() {
      vec3 p = aCenter;
      float r = max(length(p.xz), 0.001);
      float ang = uTime * aSpin * 0.055 / (0.75 + r * 0.035) + aPhase * 0.55;
      float ca = cos(ang), sa = sin(ang);
      vec3 c = vec3(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca);
      c *= 1.0 + 0.0065 * sin(uTime * 0.26 - r * 0.105);
      vec3 t = vec3(aTangent.x * ca - aTangent.z * sa, aTangent.y, aTangent.x * sa + aTangent.z * ca);
      vec4 mv = modelViewMatrix * vec4(c, 1.0);
      vec3 tv = mat3(modelViewMatrix) * t;
      vec3 vd = normalize(-mv.xyz);
      vec3 sd = cross(tv, vd);
      float sl = length(sd);
      sd = sl > 1e-5 ? sd / sl : vec3(1.0, 0.0, 0.0);
      mv.xyz += sd * aSide * aWidth * uWidthMul;
      gl_Position = projectionMatrix * mv;
      vSide = aSide;
      vU = aU;
      vColor = aColor;
      vSeed = aPhase;
      float depth = clamp(-mv.z / 165.0 + 0.50, 0.0, 1.0);
      vFade = pow(depth, 0.62);
    }
  `;
  const SILK_FS = `
    varying float vSide;
    varying float vU;
    varying vec3  vColor;
    varying float vSeed;
    varying float vFade;
    uniform float uTime;
    uniform float uAlpha;
    void main() {
      float e = abs(vSide);
      float core = exp(-e * e * 18.0);
      float halo = exp(-e * e * 2.2);
      float wave = 0.55 + 0.45 * sin(vU + vSeed * 6.283 + uTime * 0.35);
      float a = (core * 1.25 + halo * 0.10) * (0.55 + 0.65 * wave) * uAlpha * vFade;
      vec3 col = vColor * (0.85 + 0.45 * wave);
      gl_FragColor = vec4(col, a);
    }
  `;

'''
s = s.replace(anchor, silk + anchor, 1)

# 2) 声明换成 ribbon 缓冲
old = "    const linePos = [];\n    const lineCol = [];"
new = """    /* 丝绸纤维 ribbon 缓冲：每个采样点两个顶点（左右边缘） */
    const silkCenter = [];
    const silkTangent = [];
    const silkSide = [];
    const silkWidth = [];
    const silkColor = [];
    const silkU = [];
    const silkSpin = [];
    const silkPhase = [];
    const silkIndex = [];
    let silkVerts = 0;"""
assert old in s
s = s.replace(old, new, 1)

# 3) 重写 pushStream
start = s.index("    function pushStream(lay) {")
end = s.index("    /* 三层发丝：核心密织 / 主纤维 / 外梢，均按螺旋流线生成 */")
new_fn = '''    function pushStream(lay) {
      // 一条弯曲的“丝绸纤维”：从核心附近出发，边向外扩张边绕轴旋转，
      // 60% 的纤维集中在“风向扇形”里，形成不对称的流泻感。
      const wind = 0.95 + (rnd() - 0.5) * 0.9;
      const th0 = rnd() < 0.62 ? wind + (rnd() - 0.5) * 1.9 : rnd() * TAU;
      const highLat = rnd() < 0.10;
      const y0 = highLat ? (rnd() - 0.5) * 8.0 : (rnd() * 2 - 1) * 1.6;
      const r0 = 1.4 + rnd() * 3.2;
      const len = lay.len * (0.78 + rnd() * 0.95);
      const sign = rnd() < 0.82 ? 1 : -1;
      const curl = sign * (0.55 + rnd() * 1.15) * lay.curl;
      const phase = rnd() * TAU;
      const waveAmp = lay.spread * (0.55 + rnd() * 0.85);
      const waveFreq = 2.2 + rnd() * 3.2;
      const brightBias = 0.86 + rnd() * 0.30;
      const strandW = 0.70 + rnd() * 0.65;
      const spin = lay.spin * (0.92 + rnd() * 0.16);
      const ph2 = rnd();
      const colorAt = [0, 0, 0];
      const N = lay.samples;
      const cx = new Float32Array(N), cy = new Float32Array(N), cz = new Float32Array(N);
      const cw = new Float32Array(N), cu = new Float32Array(N);
      const cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);

      for (let k = 0; k < N; k++) {
        const t = k / (N - 1);
        const r = r0 + len * Math.pow(t, 0.86);
        const th = th0 + curl * t + 0.16 * Math.sin(t * 5.2 + phase);
        const y = y0 * (1 - t * 0.55) +
          Math.sin(t * waveFreq * Math.PI + phase) * waveAmp * (0.25 + t * 0.75);
        const braid = Math.sin(t * 24 + phase) * lay.spread * 0.16;
        const x = Math.cos(th) * r + braid;
        const z = Math.sin(th) * r - braid * 0.6;

        // 颜色：核心白热 → 金 → 奶油 → 淡蓝尾迹
        const q = t;
        if (q < 0.20) mix3(colorAt, C_HOT, C_GOLD, q / 0.20);
        else if (q < 0.55) mix3(colorAt, C_GOLD, C_CREAM, (q - 0.20) / 0.35);
        else mix3(colorAt, C_CREAM, C_TIP, (q - 0.55) / 0.45);

        // 亮度沿纤维平滑变化（丝绸的光泽），不要逐点随机噪点
        const sheen = 0.82 + 0.18 * Math.sin(t * 9.0 + phase * 2.0);
        const bright = (1.06 - t * 0.34) * brightBias * (lay.dim || 1) * sheen;
        // 两端收细、中段饱满；整条纤维还有各自的粗细
        const taper = 0.34 + 0.66 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.12)), 0.55);
        cx[k] = x; cy[k] = y * 0.68; cz[k] = z;
        cw[k] = lay.width * strandW * taper;
        cu[k] = t * lay.uf + ph2 * 6.283;
        cr[k] = colorAt[0] * bright;
        cg[k] = colorAt[1] * bright;
        cb[k] = colorAt[2] * bright;

        // 伴随稀疏尘埃，补充纤维的厚度
        if (rnd() < 0.09) {
          const rr2 = r + (rnd() - 0.5) * lay.spread * 1.28;
          pushGold(
            Math.cos(th) * rr2,
            y * 0.68 + (rnd() - 0.5) * lay.spread * 0.55,
            Math.sin(th) * rr2,
            [colorAt[0] * bright * 0.24, colorAt[1] * bright * 0.22, colorAt[2] * bright * 0.20],
            lay.size * 0.55,
            spin
          );
        }
      }

      // 生成 ribbon 顶点：每个采样点两条边，顶点着色器里按切线展开成面向相机的带子
      const base = silkVerts;
      for (let k = 0; k < N; k++) {
        let ax, ay, az;
        if (k === 0) { ax = cx[1] - cx[0]; ay = cy[1] - cy[0]; az = cz[1] - cz[0]; }
        else if (k === N - 1) { ax = cx[N - 1] - cx[N - 2]; ay = cy[N - 1] - cy[N - 2]; az = cz[N - 1] - cz[N - 2]; }
        else { ax = cx[k + 1] - cx[k - 1]; ay = cy[k + 1] - cy[k - 1]; az = cz[k + 1] - cz[k - 1]; }
        const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        ax /= al; ay /= al; az /= al;
        for (let ss = 0; ss < 2; ss++) {
          silkCenter.push(cx[k], cy[k], cz[k]);
          silkTangent.push(ax, ay, az);
          silkSide.push(ss === 0 ? -1 : 1);
          silkWidth.push(cw[k]);
          silkColor.push(cr[k], cg[k], cb[k]);
          silkU.push(cu[k]);
          silkSpin.push(spin);
          silkPhase.push(ph2);
          silkVerts++;
        }
      }
      for (let k = 0; k < N - 1; k++) {
        const a = base + k * 2;
        silkIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

'''
s = s[:start] + new_fn + s[end:]

# 4) LAYERS：更密、更细、更多层
lay_old = s[s.index("    const LAYERS = ["):]
lay_old = lay_old[:lay_old.index("];") + 2]
lay_new = '''    const LAYERS = [
      { n: isLow ? 36 : 70, samples: isLow ? 80 : 120, len: 11, size: 1.20, spin: 2.4, spread: 0.35, curl: 1.28, width: 0.42, dim: 1.0, uf: 7.0 },
      { n: isLow ? 52 : 140, samples: isLow ? 170 : 260, len: 33, size: 0.85, spin: 1.3, spread: 0.85, curl: 1.02, width: 0.52, dim: 1.0, uf: 9.0 },
      { n: isLow ? 22 : 52, samples: isLow ? 220 : 340, len: 63, size: 0.58, spin: 0.72, spread: 1.50, curl: 0.82, width: 0.40, dim: 0.82, uf: 11.0 },
      { n: isLow ? 18 : 44, samples: isLow ? 250 : 380, len: 86, size: 0.46, spin: 0.42, spread: 2.50, curl: 1.45, width: 0.32, dim: 0.46, uf: 13.0 }
    ];'''
s = s.replace(lay_old, lay_new, 1)

# 5) 用丝绸 mesh 替换原来的细线
old_lines = s[s.index("    let hairLines = null;"):]
old_lines = old_lines[:old_lines.index("    const webPts = makePoints")]
new_lines = '''    let silkMesh = null;
    const group = new THREE.Group();
    if (silkVerts > 0) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('aCenter', new THREE.BufferAttribute(new Float32Array(silkCenter), 3));
      sg.setAttribute('aTangent', new THREE.BufferAttribute(new Float32Array(silkTangent), 3));
      sg.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(silkSide), 1));
      sg.setAttribute('aWidth', new THREE.BufferAttribute(new Float32Array(silkWidth), 1));
      sg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(silkColor), 3));
      sg.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(silkU), 1));
      sg.setAttribute('aSpin', new THREE.BufferAttribute(new Float32Array(silkSpin), 1));
      sg.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(silkPhase), 1));
      sg.setIndex(new THREE.BufferAttribute(new Uint32Array(silkIndex), 1));
      const sm = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: 1.0 },
          uWidthMul: { value: 1.0 }
        },
        vertexShader: SILK_VS,
        fragmentShader: SILK_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      silkMesh = new THREE.Mesh(sg, sm);
      silkMesh.frustumCulled = false;
      silkMesh.renderOrder = 3;
      group.add(silkMesh);
    }
'''
s = s.replace(old_lines, new_lines, 1)

# 6) update() 里驱动丝绸光泽
old_u = "      bgStars.material.uniforms.uTime.value = t;"
assert old_u in s
s = s.replace(old_u, old_u + "\n      if (silkMesh) silkMesh.material.uniforms.uTime.value = t;", 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', len(s))
