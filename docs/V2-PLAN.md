> **状态：已完成（2026-11-23）**。v2 已上线：14 章、四个队友任务全部交付、file:// 真机验证通过。本文件保留为 v2 的架构契约与历史记录。

# COSMOS ATLAS v2 · 改版契约

> 本文件是 v2 并行开发的唯一契约。动手前先读完 §1–§5；写文件前先看 §6 的归属表。
> 与 `AGENTS.md` 冲突时：交互/视觉/内容红线以 AGENTS 为准，文件与接口以本文件为准。

---

## 1. 目标与信息架构

把 v1 的 11 章长卷改版为 **序章 + 五大部分、14 章**。首页要有全屏动态背景与强视觉冲击；太阳系要有可 360° 旋转的高清 3D 模型与行星科普；其余章节以"能动手的仪器"为标准。

| # | section id | 章名 | stage id | 所属部分 | 章节高度 | 负责人 |
|---|---|---|---|---|---|---|
| 00 | `ch-hero` | 宇宙 | `hero` | 序章 | 100vh | Lead |
| 01 | `ch-overview` | 宇宙总览 | `overview` | I 宇宙 | 200vh | Lead |
| 02 | `ch-scale` | 尺度 | `starfield` | I 宇宙 | 200vh | Lead |
| 03 | `ch-solar` | 太阳系 | `solar` | II 太阳系 | 320vh | T1 |
| 04 | `ch-compare` | 行星对比实验室 | `idle` | II 太阳系 | 200vh | T1 |
| 05 | `ch-missions` | 太阳系探测 | `missions` | II 太阳系 | 240vh | T1 |
| 06 | `ch-compact` | 致密天体 | `compact` | III 深空天体 | 260vh | T2 |
| 07 | `ch-stellar` | 恒星的一生 | `stellar` | IV 宇宙深处 | 300vh | T2 |
| 08 | `ch-galaxies` | 星系动物园 | `galaxies` | IV 宇宙深处 | 260vh | T3 |
| 09 | `ch-extreme` | 极端宇宙 | `extreme` | IV 宇宙深处 | 260vh | T3 |
| 10 | `ch-history` | 航天里程碑 | `explore` | V 人类探索 | 300vh | T4 |
| 11 | `ch-vehicles` | 现役与未来载具 | `explore` | V 人类探索 | 260vh | T4 |
| 12 | `ch-future` | 未来计划 | `explore` | V 人类探索 | 220vh | T4 |
| 13 | `ch-finale` | 暗淡蓝点 | `nebula` | 终章 | 100vh | Lead |

- 章节高度靠 `data-h`（数值，单位 vh）写入；CSS 用 `--ch-h` 读取。`app` 会计算滚动进度 `p` 0→1。
- 每章内容全部渲染在 `.ch-inner` 的 **sticky 视口**（100vh）内；`p` 驱动 3D 镜头与文字淡入淡出，不再用 v1 的"多屏翻页"。
- 章节顺序即 `index.html` 中 `#scroll` 的 DOM 顺序，`boot.js` 自动测量。

---

## 2. 运行形态（不可违反）

- 双击 `index.html`（`file://`）必须可运行；**经典 `<script>`**，禁止 `import/export/type="module"`。
- three.js r169 全局 `window.THREE`；**禁止 addons**（OrbitControls / EffectComposer / GLTFLoader 一律不用）。
- **零网络请求**：纹理、照片、字体全部本地。照片放 `assets/photos/`，WebGL 贴图走 `js/tex-solar.js` 的 data URL。
- 新增 js 文件按 `index.html` 中的顺序加载；新增 stage 必须同时有同名 `data-stage` 与 `js/content-*.js` 条目。
- 所有代码 `node --check` 通过；`update()` 内禁止 `new` 对象；交互中禁止重建几何/编译 shader。

---

## 3. 引擎接口（v2 新增部分）

### 3.1 Stage

```js
COSMOS.registerStage('solar', function (ctx) {
  // ctx.THREE / renderer / width / height / aspect / pixelRatio / quality('high'|'medium'|'low')
  // ctx.index / reduceMotion
  // ctx.input  —— 全局指针/键盘状态（见 §3.3，每帧更新，只读）
  // ctx.section —— 该章 <section> DOM（用于绑定 DOM 交互）
  return {
    scene, camera,
    update(t, dt, p),   // 只在"当前章"和"下一章混合期"调用
    resize(w, h),
    enter(), leave(),
    reset(),            // 可选：Esc / 「复位」按钮时调用
    bloom: false        // 可选
  };
});
```

### 3.2 章节与组件挂载

- 每个 chapter 的 `data-stage` 必须已注册，否则 boot 报错。
- **DOM 控件**：在 `js/feat-*.js` 里注册组件：

```js
COSMOS.widgets['solar'] = function (el, data, section) {
  // el: <div class="ch-widget" data-widget="solar">
  // data: COSMOS.CONTENT.solar
  // section: 该章 <section>
  el.innerHTML = '';
  // ...建 DOM、绑事件、读 COSMOS.DATA...
  return {
    update: function (p, o) { /* 可选：每帧进度回调，只做便宜的样式切换 */ }
  };
};
```

`el` 由 ui.js 放在章节 sticky 视口内、3D 画布之上；宽高由 CSS 决定。组件样式写在各自的 `css/<part>.css`，只允许用 `css/main.css :root` 里的 token 与 `.u-* / .c-*` 公共类（§4）。

### 3.3 输入（`ctx.input`，全局单例）

```js
input = {
  x, y,          // 当前指针位置（client px）
  nx, ny,        // 归一化 -1..1（左下角 -1,-1）
  dx, dy,        // 本帧位移（px，已做平滑）
  down,          // 左键/单指按下
  dragging,      // 按下且已移动 > 4px
  click,         // 本帧是否发生"点击"（非拖拽的 pointerup，一次性）
  wheel,         // 本帧滚轮累计（向下为正，一次性）
  pinch,         // 本帧双指缩放累计（>0 放大，一次性）
  keys,          // { 'ArrowLeft': true, ... } 持续状态
  uiTarget       // 指针是否落在按钮/输入/控件等 UI 元素上（此时场景不要响应）
}
```

- 场景在 `update()` 里读 `ctx.input`，**不要自己绑 mousemove/wheel**。需要点击 3D 物体：`if (i.click && !i.uiTarget) { 用 raycaster 从相机 + nx/ny 取交点 }`。
- 键盘：全局方向键上/下与 Space 已被翻章占用；章内交互用 ←/→、+/−、Enter、Esc。
- Esc：boot 会调用当前 stage 的 `reset()`，并 `COSMOS.emit('cosmos:escape')`；组件监听该事件关闭抽屉/弹层。
- 缩放：鼠标用 ±按钮或 Ctrl+滚轮；触屏用双指；键盘 +/−。三种方式必须等价（AGENTS §3.3）。

### 3.4 总线与工具

```js
COSMOS.bus.on(name, fn) / off(name, fn) / emit(name, payload)  // 同义：COSMOS.on/off/emit
COSMOS.dom.h(tag, attrs, children)     // attrs 支持 class/html/text/style
COSMOS.dom.richText(str)               // Unicode 上标 → <sup>
COSMOS.tex.load(key, opts)             // 从 COSMOS.TEX 取 data URL，返回 THREE.Texture（带缓存）
COSMOS.util.raycaster                  // 复用的 THREE.Raycaster 实例
COSMOS.util.num(v, digits)             // 千分位
COSMOS.app.goTo(indexOrId)             // 跳章（字符串按 section id，如 'compare'）
COSMOS.DATA                            // 全站数据源（§5）
```

### 3.5 事件命名

| 事件 | 方向 | payload |
|---|---|---|
| `cosmos:escape` | boot → 组件 | 无 |
| `solar:planet` | scene-solar → feat-solar | `{ id: 'mars' }` |
| `compare:focus` | feat-solar → app | `{ id: 'earth' }` |
| `deep:object` | scene-compact → feat-deep | `{ id: 'blackhole' }` |
| 其他章节自定义，前缀用章节 id，避免撞名 | | |

---

## 4. 视觉与 CSS

- 只用 `AGENTS.md §2` 的 token；**新颜色一律禁止**。3D 里颜色由物理量推导（黑体色温、真实光谱），不套 UI 色板。
- 字体三族（Public Sans / Inter / DM Mono），字号阶 12/14/16/18/22/29/36/48；圆角 0（输入框 2px）；动效 5 档时长 + 2 条缓动。
- 公共组件类（已在 `css/main.css` 提供，直接复用，不要另造）：
  - 按钮 `.btn`（实心 `--nasa-blue`） / `.btn.is-ghost`（白描边） / `.btn.is-small`；`:focus-visible` 已处理。
  - 段控 `.tabs > .tab`（`.is-on` 表示选中）。
  - 滑杆 `.range`（原生 `input[type=range]`，配 `.range-row` 显示当前值与单位）。
  - 卡片 `.data-card`（图 + 眉标 + 标题 + 元信息，整块可点）。
  - 抽屉/弹层 `.drawer` + `.drawer-close` + `.lightbox`（含 `.lightbox-img`、`.lightbox-cap`）。
  - 数据条 `.bar-row > .bar-track > .bar-fill`（宽度由内联 `--v` 控制）。
  - 标签 `.chip`；图例 `.legend > .legend-item`。
  - 通用排版 `.u-kicker`（DM Mono 大写微标签）、`.u-mono`、`.u-dim`（次级文字）。
- 每章文字必须在图片/3D 上仍可读：文本区加 `.ch-scrim`（`main.css` 提供，径向/线性遮罩），不要靠调亮画面解决。
- 组件文件只允许写自己 `css/<part>.css`，不要改 `css/main.css`（Lead 独占）。

### 4.1 移动端

- `≤ 900px`：两栏收成一栏；`.ch-inner` 改为纵向，widget 放文字下方；控件热区 ≥44px。
- 触屏不允许 `pointer: fine` 才有的交互（hover 才能看到的信息必须另有入口）。

---

## 5. 数据源 `js/data.js`（Lead 维护，只读引用）

```js
COSMOS.DATA = {
  meta:      { ageUniverse, observableRadius, galaxyCount, ... },
  components:[{ key:'darkEnergy', name:'暗能量', pct:68.3, desc }],
  sun:       { radiusKm, massKg, surfaceC, coreC, ageYr, ... },
  planets:   [{ id, name, en, symbol, texture, radiusKm, diameterKm, massKg, massEarth,
                gravity, dayHours, yearDays, au, tempC, moons, rings, tilt,
                atmosphere:[{name,pct}], tagline, desc, special, missions:['voyager1'] }],
  missions:  [{ id, name, en, year, date, agency, targets:[], status, photo, desc, fact }],
  galaxies:  [{ id, name, en, type, photo, distanceLy, diameterLy, desc }],
  deepObjects:[{ id, name, en, kind, photo, stat:[{label,value,unit}], desc }],
  milestones:[{ year, date, title, en, agency, country, desc, photo }],
  vehicles:  [{ id, name, en, kind, heightM, leoKg, firstFlight, photo, desc }],
  telescopes:[{ id, name, en, aperture, orbit, launched, photo, desc }],
  future:    [{ id, name, en, horizon, agency, photo, desc, items:[] }],
  sources:   [{ label, org, license }]
};
```

- 全部数字以这里为准；组件里不得另写一份（"图文同源"）。
- 单位/标点按 AGENTS §4.2：数字与单位半角空格、千分位逗号、中文全角标点。

---

## 6. 文件归属（写权限）

| 负责人 | 独占写入 | 说明 |
|---|---|---|
| **Lead** | `index.html`、`css/main.css`、`js/boot.js`、`js/ui.js`、`js/lib-core.js`、`js/data.js`、`js/content-core.js`、`js/scene-hero.js`、`js/scene-overview.js`、`js/scene-ambient.js`、`js/scene-nebula.js`、`js/tex-solar.js`、`tools/*`、`docs/*`、`README.md`、`AGENTS.md` | 引擎、核心样式、数据、序章/总览/尺度/终章 |
| **T1** | `js/scene-solarsystem.js`、`js/scene-missions.js`、`js/feat-solar.js`、`js/feat-compare.js`、`js/content-solar.js`、`css/solar.css` | 03/04/05 章 |
| **T2** | `js/scene-compact.js`、`js/scene-stellar.js`、`js/feat-deep.js`、`js/content-deep.js`、`css/deep.css` | 06/07 章 |
| **T3** | `js/scene-galaxies.js`、`js/scene-extreme.js`、`js/feat-cosmos.js`、`js/content-cosmos.js`、`css/cosmos.css` | 08/09 章 |
| **T4** | `js/scene-explore.js`、`js/feat-human.js`、`js/content-human.js`、`css/human.css` | 10/11/12 章 |

- 只写自己名下的文件；需要别人的文件改动时，把需求写进任务/消息给 Lead，不要直接改。
- 旧文件（`scene-sun.js`、`scene-planets2.js`、`scene-earth.js`、`scene-stellar.js` 等）保留作参考，不删除；v2 不再加载的文件不要写。
- 可共用的现成代码：`js/scene-blackhole.js`、`js/scene-spacetime.js`、`js/scene-hero.js`、`js/planet-tex.js`、`js/lib-core.js`、`js/glsl-lib.js`。复制需要的片段到自己的文件里改，不要 `require`。

---

## 7. 每章交互目标（验收口径）

| 章 | 最低级别 | 必须能做的事 | 记忆点 / 隐藏瞬间 |
|---|---|---|---|
| 03 太阳系 | L3/L4 | 拖拽 360° 旋转、缩放、点行星开科普、时间加速滑杆、暂停/复位 | 点"土星"看环倾角与 274 颗卫星；把时间调到最快看水星转 4 圈而海王星只走一点 |
| 04 对比 | L3 | 选两颗行星、切大小/重力/大气三种对比、数值同帧更新 | 重力模式显示"同一个人能跳多高" |
| 05 探测 | L3 | 时间轴 scrub 到任一任务、点任务看卡 | 把 scrub 拉到 2012-08 看好奇号着陆 |
| 06 致密 | L3 | 黑洞/中子星/白矮星切换、质量滑杆改半径与透镜 | 中子星一秒自转 700 圈（视觉假象需标注） |
| 07 恒星 | L3 | 质量滑杆 + 阶段 scrub，命运分叉 | 1.4 M☉ 的白矮星与 20 M☉ 的黑洞同屏对比 |
| 08 星系 | L2/L3 | 拖拽旋转三类星系、切换类型、照片灯箱 | 不规则星系碰撞后的潮汐尾 |
| 09 极端 | L3 | 引力波应变滑杆/暗物质晕开关/膨胀速率 | 把应变调到最大看到 LIGO 尺度的形变 |
| 10 历史 | L3 | 时间轴 scrub 1957→2026、点节点看事件 | 同一年中美苏两件事同屏 |
| 11 载具 | L3 | 选火箭 → 与真人/自由女神比高、切换载荷条 | 星舰 121 m 与土星五号 110.6 m 同框 |
| 12 未来 | L2 | 选计划、看时间窗、火星旅行时间换算 | 输入体重换算火星体重 |

---

## 8. 性能与质量红线

- 单场景 draw call ≤ 60；粒子 ≤ 25 万（`low` 减半）；三角 ≤ 30 万；交互中不卡顿 > 80ms。
- 纹理一律 `COSMOS.tex.load(key)` 取，尺寸已在 2048 内。
- 动画只用 `requestAnimationFrame` 的 `update(t,dt,p)`；不要 `setInterval` 改 WebGL。
- 所有可交互元素：键盘可达、`focus-visible` 可见、有 `aria-label`；canvas 由 boot 统一给 `aria-label`。
- 尊重 `ctx.reduceMotion`（关闭自动旋转/漂移/打字机，状态切换仍即时）。
- 完成后自测：
  1. `for f in js/*.js; do node --check "$f" || echo FAIL $f; done`
  2. `grep -rnE '^\s*(import|export)\b' js/` 无输出
  3. Playwright 打开 `file:///.../index.html`，控制台 0 报错；`window.__COSMOS_ERRORS` 为空
  4. 截图存 `shots/v2-<章节>-<序号>.png`

---

## 9. 交付说明（每个任务结束时写给 Lead）

固定四行：**改了什么 / 为什么 / 怎么验证 / 已知风险**。附：新增文件清单、依赖的 Lead 接口是否已就绪、未完成的 TODO。

---

## 10. v2 内容与组件 Schema（补充，最终版）

### 10.1 章节文案

`js/content-<part>.js` 里调用：

```js
COSMOS.addContent('solar', {
  num: '03',
  title: '太阳系',
  titleEn: 'SOLAR SYSTEM',
  part: 'II · 太阳系',
  kicker: '按真实测量重建的 3D 太阳系',
  lead: '把太阳系装进浏览器：八颗行星、真实贴图，和一条可以拨动的时间。',  // ≤40 字
  paragraphs: ['…', '…'],          // 每段 60–140 字，建议 2 段
  facts: [                          // 3–4 条
    { v: '8', u: '颗行星', l: '另有 5 颗矮行星' },
    { v: '4.6', u: '十亿年', l: '太阳系年龄' }
  ],
  quote: { text: '…', cite: '…' },  // 可选
  widget: 'solar',                  // 可选：组件 id
  layout: 'split',                  // split（文字左、组件右）/ wide / center / full
});
```

- id 与 `index.html` 的 section 对应：`ch-<id>`；`hero`/`finale` 也用同一 schema（`layout: 'hero' | 'finale'`）。
- 长文案（行星档案、任务详情、事件详情）不要塞进 paragraphs，放进组件的抽屉/卡片里（数据从 `COSMOS.DATA` 取）。
- 每章 ≥1 组结构化数据（`facts` 或组件里的数据）、≥1 处日常类比、≥1 处误解纠正，写进 paragraphs 或 quote。

### 10.2 Widget 挂载

ui.js 渲染章节时，如果 `content.widget` 存在：

```js
const el = document.createElement('div');
el.className = 'ch-widget';
el.dataset.widget = d.widget;
inner.appendChild(el);
const api = COSMOS.widgets[d.widget](el, d, section); // 必须同步返回，可返回 {update}
```

- `update(p, o)` 每帧被调用（仅该章为当前章/混合下一章时）；里面只做样式/位置更新，禁止 DOM 重建。
- 组件如需每帧数据，由场景写到一个约定对象上（例如 `COSMOS.state.solar = { labels: [...] }`），组件在 `update` 里读。
- 组件发出的跨模块事件用 `COSMOS.emit('solar:planet', {id})`；场景监听后改变高亮/镜头。

### 10.3 场景 id（必须与 index.html 一致）

| 文件 | 必须注册的 stage id |
|---|---|
| `js/scene-solarsystem.js`（T1） | `solar` |
| `js/scene-missions.js`（T1） | `missions` |
| `js/scene-compact.js`（T2） | `compact` |
| `js/scene-stellar-life.js`（T2） | `stellar` |
| `js/scene-galaxies.js`（T3） | `galaxies` |
| `js/scene-extreme.js`（T3） | `extreme` |
| `js/scene-explore.js`（T4） | `explore1`、`explore2`、`explore3`（同一工厂，按 `ctx.index` 变化） |
| `js/scene-ambient.js`（Lead） | `starfield`、`idle` |
| `js/scene-hero.js` / `scene-overview.js` / `scene-nebula.js`（Lead） | `hero` / `overview` / `nebula` |

### 10.4 组件 id（必须与 content 的 `widget` 一致）

| 文件 | 注册的 widget id |
|---|---|
| `js/feat-solar.js`（T1） | `solar` |
| `js/feat-compare.js`（T1） | `compare`、`missions` |
| `js/feat-deep.js`（T2） | `compact`、`stellar` |
| `js/feat-cosmos.js`（T3） | `galaxies`、`extreme` |
| `js/feat-human.js`（T4） | `history`、`vehicles`、`future` |

注册方式：`COSMOS.registerWidget(id, function (el, data, section) { … return {update}; });`

### 10.5 可用的真实贴图键（`COSMOS.tex.load(key)`）

`sun`、`mercury`、`venus`、`earth_day`、`earth_night`、`earth_clouds`、`moon`、`mars`、`jupiter`、`saturn`、`saturn_ring`、`uranus`、`neptune`（2048 宽，`COSMOS.TEX` 内为 data URL）。

### 10.6 可用的本地照片（`assets/photos/<name>.jpg`，用普通 `<img>`）

星系：`galaxy-whirlpool`、`galaxy-andromeda`、`galaxy-sombrero`、`galaxy-antennae`、`galaxy-barred`、`galaxy-lmc`、`galaxy-cartwheel`、`galaxy-deepfield`。
星云/恒星：`nebula-pillars`、`nebula-orion`、`nebula-crab`、`nebula-ring`、`nebula-carina`、`star-betelgeuse`、`star-flare`。
致密/深空：`bh-concept`、`bh-m87-jet`（M87 喷流，不是黑洞照片，文案不要写成 EHT 照片）、`neutronstar-concept`、`deep-darkmatter`、`deep-darkenergy`、`deep-gravwave`、`deep-quasar`。
探测史：`probe-voyager`、`probe-parker`、`probe-cassini`、`probe-newhorizons`、`rover-perseverance`。
人类探索：`human-iss`、`human-jwst`、`human-hubble`、`human-earthrise`（阿波罗 17）、`human-earthrise-1968`（阿波罗 8）、`human-apollo11`、`human-blue-marble`、`human-palebluedot`、`rocket-falconheavy`、`rocket-starship`、`future-mars`、`future-exoplanet`。

### 10.7 公共 CSS 组件（main.css 提供，禁止重复造）

`.btn` `.btn.is-ghost` `.btn.is-small` `.tabs` `.tab` `.tab.is-on` `.range` `.range-row` `.range-val`
`.data-card` `.data-card-media` `.data-card-body` `.card-grid` `.drawer` `.drawer-head` `.drawer-body` `.drawer-close`
`.lightbox` `.lightbox-img` `.lightbox-cap` `.bar-row` `.bar-track` `.bar-fill` `.chip` `.legend` `.legend-item`
`.panel` `.panel-head` `.stat` `.stat-v` `.stat-u` `.stat-l` `.u-kicker` `.u-mono` `.u-dim` `.u-row` `.u-hide`
`.ch-scrim` `.ch-copy` `.ch-widget` `.ch-inner`.

组件自己的版式（例如行星标签、时间轴刻度）写进各自 `css/<part>.css`，允许组合上述类名。

