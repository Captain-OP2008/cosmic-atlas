/* ============================================================
 * COSMOS ATLAS — GLSL 共享着色器库
 * 所有 GLSL 片段以字符串常量形式提供，供 ShaderMaterial 拼接使用。
 * 语法：GLSL ES 1.00（three.js ShaderMaterial 默认版本，WebGL2 下自动兼容）
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  /* ---------- 3D 单纯形噪声（Ashima Arts / Stefan Gustavson, MIT） ---------- */
  const NOISE = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}
`;

  /* ---------- 分形布朗运动（可配置 octave） ---------- */
  const FBM = `
float fbm(vec3 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p * freq);
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}
float fbm3(vec3 p) { return fbm(p, 3, 2.0, 0.5); }
float fbm5(vec3 p) { return fbm(p, 5, 2.0, 0.5); }
float fbm6(vec3 p) { return fbm(p, 6, 2.0, 0.5); }

// 脊状噪声：适合岩石 / 云带 / 星云丝状结构
float ridged(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(snoise(p * freq));
    n *= n;
    sum += amp * n;
    freq *= 2.0;
    amp *= 0.5;
  }
  return sum;
}
`;

  /* ---------- 哈希 / 随机 ---------- */
  const HASH = `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
`;

  /* ---------- 常用光照 / 颜色工具 ---------- */
  const COLOR = `
// 菲涅尔边缘光
float fresnel(vec3 viewDir, vec3 normal, float power) {
  return pow(1.0 - clamp(dot(viewDir, normal), 0.0, 1.0), power);
}

// ACES 近似色调映射（与主后处理保持一致）
vec3 acesApprox(vec3 x) {
  const float a = 2.51; const float b = 0.03;
  const float c = 2.43; const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// 线性 -> sRGB
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}

// 简易黑体色温（1000K ~ 40000K 近似），返回线性 RGB
vec3 blackbody(float kelvin) {
  float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
  vec3 col;
  if (t <= 66.0) {
    col.r = 1.0;
    col.g = 0.39008157876901960784 * log(t) - 0.63184144378862745098;
    col.b = (t <= 19.0) ? 0.0 : (0.54320678911019607843 * log(t - 10.0) - 1.19625408914);
  } else {
    col.r = 1.29293618606274509804 * pow(t - 60.0, -0.1332047592);
    col.g = 1.12989086089529411765 * pow(t - 60.0, -0.0755148492);
    col.b = 1.0;
  }
  return pow(clamp(col, vec3(0.0), vec3(1.0)), vec3(2.2));
}

// 抗锯齿的圆点精灵
float circleMask(vec2 uv, float softness) {
  float d = length(uv - 0.5) * 2.0;
  return 1.0 - smoothstep(1.0 - softness, 1.0, d);
}
`;

  /* ---------- 顶点着色器通用片段 ---------- */
  const VS_COMMON = `
uniform float uTime;
uniform float uPixelRatio;
`;

  COSMOS.GLSL = {
    noise: NOISE,
    fbm: FBM,
    hash: HASH,
    color: COLOR,
    vsCommon: VS_COMMON,
    // 一次性拼接常用块
    standard: NOISE + FBM + HASH + COLOR,
    noiseFbm: NOISE + FBM,
    noiseHash: NOISE + HASH
  };
})(window.COSMOS = window.COSMOS || {});
