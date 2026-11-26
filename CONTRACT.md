# COSMOS ATLAS — 开发契约（所有成员必读）

一个中文天文学科普沉浸式网页。技术核心是 three.js 程序化场景 + 滚动驱动的电影化叙事。
**目标：尽可能震撼。** 用户明确说了 token 不限量，请把每个场景做到"截图能当壁纸"的品质。

---

## 1. 目录结构与文件归属（严禁越界写别人的文件）

```
cosmic-atlas/
  index.html              ← Lead
  css/main.css            ← Lead
  vendor/three.global.js  ← 已就绪（three r169，全局 window.THREE）
  js/glsl-lib.js          ← 已就绪（共享 GLSL 代码块）
  js/lib-core.js          ← 已就绪（共享工具/纹理/星空）
  js/boot.js              ← Lead（渲染器、主循环、滚动、转场）
  js/postfx.js            ← Lead（泛光后处理）
  js/ui.js                ← Lead（HUD、导航、打字机、数字滚动）
  js/scene-hero.js        ← 成员：nebula-artist（stage: hero）
  js/scene-sun.js         ← 成员：solar-artist（stage: sun）
  js/scene-planets.js     ← 成员：planet-artist（stage: planets）
  js/scene-blackhole.js   ← 成员：void-artist（stage: blackhole）
  js/scene-nebula.js      ← 成员：nebula-artist（stage: deepfield）
  js/content.js           ← 成员：science-writer
```

只写分配给你的文件。需要共享的东西先看 `js/lib-core.js` 有没有；没有就自己文件内私有实现，不要改公共库（如确需扩展，发消息给 lead）。

---

## 2. 技术约束（硬性）

1. **经典脚本，不是 ES Module。** 不能写 `import` / `export` / `type="module"`。
   文件形态固定为：
   ```js
   (function (COSMOS) {
     'use strict';
     const THREE = window.THREE;
     COSMOS.registerStage('sun', function (ctx) {
       const scene = new THREE.Scene();
       const camera = COSMOS.util.makeCamera(45, ctx.aspect);
       // ... 构建 ...
       return {
         scene, camera,
         update(t, dt, p) { /* 每帧 */ },
         resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
       };
     });
   })(window.COSMOS = window.COSMOS || {});
   ```

2. **没有 three.js addons。** 没有 OrbitControls / EffectComposer / GLTFLoader / TextGeometry。
   只能用 `window.THREE` 核心 API（BufferGeometry、ShaderMaterial、Points、Mesh、InstancedMesh、RenderTarget、各类 Light…）。

3. **所有纹理必须程序化生成。** 不许引用外部图片文件。用 `COSMOS.tex.*`（Canvas2D 生成）或 `new THREE.DataTexture(...)`。

4. **GLSL 用 ES 1.00 语法**：`attribute` / `varying` / `texture2D` / `gl_FragColor`。
   共享噪声函数用 `COSMOS.GLSL.noise` / `COSMOS.GLSL.fbm` 等字符串拼接，不要重复造轮子：
   ```js
   fragmentShader: COSMOS.GLSL.standard + `
     varying vec3 vPos;
     void main() { float n = fbm5(vPos * 3.0); ... }
   `
   ```
   `COSMOS.GLSL.standard` 包含：`snoise`、`fbm`、`ridged`、`hash11/12/13/33`、`rot2`、`fresnel`、`acesApprox`、`linearToSRGB`、`blackbody`、`circleMask`。

5. **`update()` 里禁止每帧 `new` 对象**（会 GC 抖动）。所有 uniform 预先创建，每帧只改 `.value`。临时 Vector3 在文件顶层预分配。

6. **性能预算**：单场景 draw call ≤ 60，粒子总数 ≤ 25 万（`ctx.quality === 'low'` 时减半），几何面数 ≤ 30 万三角。

7. 文件名/变量名用英文，**注释和面向用户的文案用中文**。

---

## 3. 场景接口（Stage）

```js
COSMOS.registerStage(id, function (ctx) {
  // ctx = {
  //   THREE, renderer, scene?（无，自己建）,
  //   width, height, aspect, pixelRatio,
  //   quality: 'high' | 'medium' | 'low'
  // }
  return {
    scene,                              // 必须：THREE.Scene
    camera,                             // 必须：THREE.PerspectiveCamera
    update(t, dt, p) {},                // 必须
    resize(w, h) {},                    // 可选
    enter() {},                         // 可选：成为当前章节时调用
    leave() {},                         // 可选：离开时调用
    dispose() {},                       // 可选
    bloom: { strength, radius, threshold }  // 可选：覆盖默认泛光
  };
});
```

- `t` — 页面启动至今的秒数（浮点）
- `dt` — 上一帧耗时秒数，用于帧率无关插值：`v = COSMOS.util.damp(v, target, 8, dt)`
- `p` — **当前章节的滚动进度，0 → 1**。这是章节内镜头运动的主驱动。
  当 `p = 0` 章节刚铺满视口，`p = 1` 章节即将滚出。请用 `p` 设计"镜头推进"：
  例如 `camera.position.z = lerp(14, 6, ease.inOutCubic(p))`。

### 后处理说明
Lead 统一做 ACES 色调映射 + sRGB 输出 + 泛光。你只要把颜色写进 `gl_FragColor` 的**线性空间**，
高亮部分自然会被泛光晕开。想让某个物体强发光就把颜色值推到 1.0 以上（HDR，比如 `vec3(3.0, 1.6, 0.5)`）。

### 相机
用 `COSMOS.util.makeCamera(fov, aspect)` 创建。相机由你自己完全控制（位置、朝向、fov）。
默认 fov 50，建议太阳特写 45，行星全景 55。

---

## 4. 共享库 API 速查

```js
COSMOS.util.clamp(v,a,b) / lerp(a,b,t) / smoothstep(a,b,x) / damp(cur,target,lambda,dt)
COSMOS.util.ease.inOutCubic / outCubic / inCubic / outQuint / inOutQuint / outExpo / inOutSine
COSMOS.util.rand()            // 确定性随机 0..1（全局种子，刷新一致）
COSMOS.util.randRange(a,b)
COSMOS.util.reseed(n)         // 想独立随机序列时自己 reseed
COSMOS.util.disposeGroup(obj)
COSMOS.util.makeCamera(fov, aspect)
COSMOS.util.makeFullscreenQuad()   // PlaneGeometry(2,2)

COSMOS.tex.canvasTexture(w,h,drawFn,{srgb,wrap})
COSMOS.tex.glowTexture(size)       // 白色径向光晕（alpha 纹理）
COSMOS.tex.cloudTexture(size)      // 柔和云团
COSMOS.tex.ringTexture()           // 横向环形颗粒条带

COSMOS.builders.makeStarfield({count, rMin, rMax})   // 球壳星空 Points（自带闪烁 shader）
COSMOS.builders.starfieldGeometry / starfieldMaterial
```

---

## 5. 章节清单（整站结构）

> **注**：下表是 v1（8 章）结构，已过时。当前为 12 章（00–11），以 `AGENTS.md` §5.4 与 `README.md` 的章节表为准。

| # | stage id | 章节 | 负责 |
|---|----------|------|------|
| 0 | `hero` | 序章 · 银河全景，标题 "宇宙：你能看到的一切" | nebula-artist |
| 1 | `starfield` | 01 尺度 · 可观测宇宙 930 亿光年（HTML 可视化） | Lead（通用星空） |
| 2 | `sun` | 02 太阳 · 恒星特写 | solar-artist |
| 3 | `planets` | 03 行星 · 八大行星队列 | planet-artist |
| 4 | `starfield` | 04 时间 · 138 亿年时间线（HTML） | Lead |
| 5 | `blackhole` | 05 黑洞 · 事件视界与吸积盘 | void-artist |
| 6 | `deepfield` | 06 深空 · 星云与星系 | nebula-artist |
| 7 | `starfield` | 终章 · 暗淡蓝点 | Lead |

**画面构图必须给左/右的文字留白**：文字默认在左侧（宽度 ~42%），所以主体天体请偏右放置或居中偏右，
不要被文字挡住。第 5 章黑洞可以居中（文字在下方）。

---

## 6. 视觉基调

- 背景接近纯黑：`#000000` → `#05060a`，带极轻微冷色
- 高对比：黑色要够黑，亮部要敢推到 HDR（1.0~5.0）
- 主色板：UI 层一律用 `AGENTS.md` §2.1 的 carbon / spacesuit-white / nasa-blue / nasa-red token；3D 场景颜色由物理决定（黑体色温、真实光谱），不受色板限制
- 质感关键词：**体积感、颗粒、丝状结构、菲涅尔边缘光、缓慢呼吸感**
- 动画节奏：缓慢、庄严、有呼吸感。不要快速抖动（除了黑洞吸积盘可以参考高速旋转）
- 每个场景加入**细小的持续运动**（星尘漂移、微光脉动、粒子闪烁），静止画面会显得廉价

---

## 7. 自测要求

1. 写完运行 `node --check js/你的文件.js`，必须通过。
2. 自查清单：
   - `COSMOS.registerStage` 的 id 与契约一致
   - 返回对象含 `scene` / `camera` / `update`
   - 没有 `import` / `export`
   - 没有引用外部图片
   - `update` 里没有对象分配
   - 所有 uniform 在创建时定义完整（漏了会报 "uniform not found" 不影响，但 .value 会 undefined）
3. 完成后给 lead 发消息，说明：实现了什么、视觉亮点、可调参数、已知风险。
4. Lead 会统一截图审查并回传修改意见，请准备好在收到反馈后继续迭代。

---

## 8. 交付质量红线

- 场景不能"空"：每帧画面必须有 3 层以上的视觉信息（主体 + 中景 + 背景粒子）
- 不能出现锯齿硬边（用 smoothstep 做抗锯齿）
- 不能出现明显的几何接缝（球体 UV 接缝、环的多边形边）
- 相机运动必须平滑，不能有跳变（用 damp + ease）
