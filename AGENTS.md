# AGENTS.md · COSMOS ATLAS

> **标签页切章，动手才能看见剩下的部分。**
> 本文件是项目最高规范。改任何代码前，先读 §1 与 §6。适用范围：`cosmic-atlas/` 全仓库。
> 最后更新 2026-11-24。v3 已上线：11 章标签页、四色斜切幕布转场、精细建模。规则改了，就在同一次改动里更新本文件。

---

## 0. 目标与优先级

**项目**：中文宇宙科普站。v3 是 11 章、五个部分的互动图谱（three.js 场景 + 真实行星贴图与 NASA 照片 + 顶部标签页切换与四色斜切幕布转场，双击 `index.html` 就能看、断网也能看）。v1 的 11 章版本存档在 `.backup-v1/`，不再维护。

**三条硬指标，编号即优先级：**

1. **交互性（第一）**——它不是"一页页幻灯片"，而是"能动手的仪器"。访客 30 秒内必须能操作点什么，并亲眼看到操作改变了什么。
2. **视觉统一（NASA 腔）**——一律以 <https://www.nasa.gov/> 现网为准；§2 已把它的设计语言落成 token。禁止自创配色与字体。
3. **内容密度**——每章都要有货：机制、数字、类比、纠错。形容词不算内容。

**不可妥协（高于以上三条）**：可访问性、性能、零外部依赖。
**冲突裁决**：能同时满足就同时满足；必须取舍时按 1 > 2 > 3，并在交付说明里写出取舍。

---

## 1. 文档地图（先读后写）

| 文件 | 什么时候读 | 权威范围 |
|---|---|---|
| `AGENTS.md` | 每次 | 目标、视觉、交互、内容、工作流 |
| `CONTRACT.md` | 改 scene / 新增 stage | stage 接口、共享库 API、后处理约定 |
| `README.md` | 改章节结构或对外说明 | 章节清单、文件地图 |
| `css/main.css` 的 `:root` | 改 UI | 当前 token（迁移中） |
| `js/boot.js` | 改标签页切换、事件、性能 | 标签页状态机、幕布转场、章节进度 `p`、错误上报 |

- `CONTRACT.md` §6（青/琥珀/品红基调）与 §1（文件归属表）已被本文件 §2、§5.4 取代；其余技术细节仍有效。
- 口径冲突时：本文件 > `CONTRACT.md` > `README.md` > 代码注释。

---

## 2. NASA 腔（视觉规范）

### 2.1 色板（唯一允许的 UI 色）

| 变量 | 值 | 用途 |
|---|---|---|
| `--carbon-black` | `#000000` | 主背景（深色区块） |
| `--ink` | `#1B1B1B` | 浅色区块正文 |
| `--carbon-90` | `#17171B` | 深色表面、浅底标题 |
| `--carbon-80/70/60/50` | `#2E2E32 / #444447 / #58585B / #717173` | 次级表面、分隔线 |
| `--carbon-40/30/20/10/05` | `#959599 / #B9B9BB / #D1D1D1 / #E3E3E3 / #F6F6F6` | 描边、禁用、浅底 |
| `--spacesuit-white` | `#FFFFFF` | 主文字、图标 |
| `--nasa-blue` | `#1C67E3` | 数字端主强调：可交互、当前项 |
| `--nasa-blue-shade` | `#0B3D91` | 深蓝大面积（标识蓝） |
| `--nasa-blue-tint` | `#288BFF` | hover / 高亮 |
| `--nasa-red` | `#F64137` | 次要强调、警示、关键 CTA |
| `--nasa-red-shade` | `#B60109` | 红底的深色状态 |

规则：

- UI 层只用上表 + `rgba(0,0,0,.x)` / `rgba(255,255,255,.x)`。强调色每屏 ≤ 2 处，且只指向"此刻最重要的一个信息"。
- 深色区块：`carbon-black` 底 + `spacesuit-white` 字；浅色区块：`carbon-05`/白底 + `--ink` 字（正文不用纯黑）。
- 对比度：正文 ≥ 4.5:1（目标 7:1），大字 ≥ 3:1，组件边界 ≥ 3:1。
- **3D 场景是唯一例外**：颜色由物理决定（黑体辐射色温、真实光谱、吸积盘多普勒），不套 UI 色板。原则一句话：**颜色来自物理，不来自调色盘。**
- v1 的青色 `#6CE7FF`、琥珀、品红、紫色，以及 CRT 扫描线、强色差：全部退役。

### 2.2 字体与字号

三族，不许第四种（中文另有回退族）：

| 角色 | 族 | 用法 |
|---|---|---|
| 大标题、正文 | **Public Sans** 400 / 700 | 章标题、H1/H2、段落、说明 |
| 二级标题、按钮、导航 | **Inter** 500 / 600 / 700 | 卡片标题、CTA、tab、卡片元信息 |
| 技术微标签、数字 | **DM Mono** 500 | 全大写 + 字距 0.32em；数据大数字 |

- 字体栈必须"拉丁在前、中文在后"：`"Inter","PingFang SC","HarmonyOS Sans SC","Noto Sans SC","Microsoft YaHei",sans-serif`。中文族不得用于西文与数字。
- 字号阶（px）：`12 · 14 · 16 · 18 · 22 · 29 · 36 · 48`；移动端整阶降一档。中文正文 17px / 行高 1.75。
- 字距：中文 `0.02em`；DM Mono 微标签 `0.32em`；标题 `0`。
- 行宽：正文 36–42 个汉字/行（≈ 68ch）；标题 ≤ 18 字/行。
- 三族均为 OFL 开源字体，可本地打包进 `vendor/fonts/` 并保持零网络；未打包前用系统回退栈，靠字号、字重、字距维持同一调性。

### 2.3 栅格与版面

- 宽度三档：inline `840px`、wide `1100px`、full `100%`（nasa.gov 实测的 inline/wide 内容宽）；页面左右 padding `clamp(20px,5vw,96px)`。
- 12 栏，gutter `24px`（≤768px 时 `16px`）。
- 垂直节奏以 8px 为基：只用 `8/16/24/32/48/64/96/128`。
- 图像全幅出血；文字压图时必须加 `carbon-black` 遮罩，保证 4.5:1。
- 构图沿用 v1：文字默认在左（≈42%），主体偏右；黑洞章可居中。

### 2.4 组件

- **直角**：圆角 0（输入框 2px）。禁止胶囊、大圆角、玻璃拟态、多层投影。
- **按钮**：Inter 600 / 17.6px，内边距 `11.2px 24px`，直角；实心（`nasa-blue` 底 + 白字）或描边（1px `spacesuit-white`）。hover 提亮 12%，press 下沉 1px，focus 2px outline + 2px offset。NASA 也常用"文字 + 箭头"的低噪 CTA，能用它就别加重按钮。
- **卡片**：透明底、直角、图 3:2 满幅（`object-fit:cover`）、标题 Inter 700、图下 DM Mono 元信息（`5 MIN READ`）。
- **眉标（eyebrow）**：Inter 700 / 12px 大写，或 DM Mono 11px 大写宽字距。
- **数据卡**：DM Mono 大数字 + Public Sans 小标签 + 单位；千分位用逗号，数字与单位间半角空格。
- **链接**：正文内必须下划线（1px，`offset 3px`），hover 变 `nasa-blue-tint`；卡片/导航这类整块链接不加下划线。

### 2.5 动效

- 时长只 5 档：`120 / 200 / 320 / 480 / 720ms`；缓动只两条：`cubic-bezier(.16,1,.3,1)`（进入/状态）、`cubic-bezier(.65,0,.35,1)`（呼吸/循环）。
- 入场只用"位移 ≤ 24px + 透明度"；禁止弹跳、旋转入场、> 800ms 的入场。
- 呼吸/漂移周期 4–8s；禁止 > 2Hz 的闪烁（3D 内真实物理旋转除外）。
- `prefers-reduced-motion: reduce` 或 `ctx.reduceMotion`：关闭视差、自动漂移、打字机、光标跟随；状态切换仍即时生效。

### 2.6 画面（3D 与全屏叠层）

- 每帧至少三层信息：主体 / 中景 / 背景粒子。
- 相机动作用 `damp`，禁止跳变；章节进度 `p` 由标签页驻留时间驱动（flow 章额外叠加章内滚动），仍是镜头主驱动。
- 全屏叠层只保留：暗角 + 轻颗粒（不透明度 ≤ 0.12）。扫描线、强色差退役。
- 发光只给物理上真的亮的东西（恒星、日冕、吸积盘、光子环），其余用菲涅尔边缘光。

### 2.7 可访问性（硬性）

- WCAG 2.1 AA；全键盘可达；`focus-visible` 2px；提供"跳到正文"skip link。
- 每章一个 `h2`（可同时是视觉上的章标题），小节 `h3`；章节标题中英并列（现状保留）。
- `<canvas>` 给 `aria-label`；装饰层 `aria-hidden`。
- 自绘光标只在 `(pointer:fine)` 且非 reduced-motion 时启用，其余回退系统光标。

### 2.8 迁移规则（v1 → NASA 腔）

- 新代码直接用 token：先把 §2.1 的变量补进 `css/main.css :root`，再引变量，不写裸色值。
- 旧代码"顺手迁移"：改到哪个文件，就把该文件的青色/品红/扫描线换掉；一次最多迁 1–2 个文件，不做无边界大 diff。
- 交付说明里写清"已迁移 / 未迁移"。

---

## 3. 交互规范（第一优先级）

### 3.1 五级交互模型

| 级 | 名字 | 用户能做什么 | 判定 |
|---|---|---|---|
| L0 | 标签页 | 点击顶部章节标签切换，四色斜切幕布转场 | 骨架，必须有 |
| L1 | 指针 | 视差、hover 高亮、光标反馈 | 有响应，但不可操纵 |
| L2 | 直接操纵 | 拖拽旋转、滚轮/双指缩放、点击切换视角 | 用户的手改变画面 |
| L3 | 参数探索 | 滑杆 / 时间轴 / 开关改变物理量，数值与画面同步 | 参数 → 现象可解释 |
| L4 | 自由探索 | 章内热点、自由相机、全局索引、URL 深链 | 用户自己决定看什么 |

### 3.2 全站配额（硬指标）

- 除终章外每章 ≥ L2；至少 5 章达到 L3；终章允许只到 L1（克制）。
- 序章（00）**3 秒内**出现第一个可操作对象，不许只有静态画面。
- 全站 ≥ 3 个**记忆点**（读者会截图发给朋友的交互）。
- 每章 ≥ 1 处"**只有动手才看得见的瞬间**"：隐藏状态、稀有时刻、数值解锁。
- 全站 1 个跨章全局控件（章节索引 / 时间轴 / 搜索），键盘可用。

逐章目标（级别是硬要求；"可玩点"是示例，可以换更好的）：

| # | 章节 | 级别 | 可玩点示例 |
|---|---|---|---|
| 00 | 序章 · COSMOS | L2 | 拖动银河（惯性）、双指/滚轮缩放、点击核球俯冲进第一章 |
| 01 | 宇宙总览 · THE COSMOS | L2 | 拖动拉尼亚凯亚丝绸质感金色纤维流（ribbon 单 pass，约 25 万三角）、滚轮缩放、点击金色标签展开说明 |
| 02 | 太阳系 · THE SOLAR SYSTEM | L3 | 360° 拖拽、时间滑杆、点击行星开档案抽屉 |
| 03 | 行星对比 · PLANET LAB | L3 | 地球 vs 任意行星：大小 / 体重 / 大气堆叠条 |
| 04 | 致密天体 · COMPACT OBJECTS | L3 | 天体切换 + 质量滑杆：史瓦西半径与吸积盘实时变化 |
| 05 | 星系动物园 · GALAXY ZOO | L2 | 形态切换 + 照片灯箱（哈勃 / 韦布原图） |
| 06 | 极端宇宙 · EXTREME UNIVERSE | L3 | 引力波 / 暗物质 / 暗能量三模式 + 参数滑杆 |
| 07 | 航天里程碑 · HISTORY | L3 | 1957–2024 时间轴拖动与播放，星云里的目标点逐颗点亮 |
| 08 | 现役与未来载具 · VEHICLES | L2 | 真实高度条形图、按类型筛选（火箭 / 望远镜 / 空间站）、点开档案抽屉 |
| 09 | 未来计划 · WHAT'S NEXT | L3 | 火星旅行时间与体重计算器 |
| 10 | 终章 · PALE BLUE DOT | L1 | 地球缓慢自转（约 100 秒/圈），回望那张 1990 年的照片 |

### 3.3 质量红线（逐条可验）

- **响应**：hover ≤ 100ms；按下 ≤ 50ms 有视觉反馈；拖拽 1:1 跟手（不许平滑滞后）；松手惯性 ≤ 600ms。
- **结果**：任何操作 2s 内必须出现可见结果；超过 2s 给进度反馈，不许无反馈等待。
- **三通道等价**：鼠标 / 触摸 / 键盘都能完成同一 L2+ 操作（方向键 + Enter/Space 激活 + Esc 复位）。
- **可逆**：Esc 或"复位"控件回到初始视角/参数；任何路径都不能把用户卡住。
- **可发现**：可交互对象 hover 变光标 + 出现名称或提示；隐藏手势不能是唯一入口。
- **数值可见**：L3 参数必须显示当前值与单位，且与画面同帧更新。
- **帧率**：high ≥ 50fps、low ≥ 30fps；交互期间不得出现 > 80ms 的卡顿帧。
- **零编译**：交互中禁止创建/销毁几何、编译着色器（首帧或进入章节时预热）。
- **触摸**：`touch-action` 精确设置；横向拖拽不拦截纵向滚动，双指缩放不触发页面缩放。
- **状态**：章节内保持参数，离开再回来恢复默认（或 URL 记忆，二选一，写进交付说明）。

### 3.4 交互与叙事的关系

- 标签页是骨架，交互是"深入"；章节间不再用滚动推进，章内长文（flow 章与文案栏）可以滚动阅读。
- 转场期间锁定输入（`transitioning`）、幕布遮盖画面；交互不得打断章节切换。
- 松手/复位后镜头用 `damp` 平滑回到 `p` 驱动的轨道，不许瞬移。
- 交互状态不得写回章节进度 `p`；`p` 只由驻留时间（与 flow 章内滚动）决定。

### 3.5 输入通道（唯一入口）

- 指针/滚轮/双指/键盘状态由 `boot.js` 统一收集，注入 `ctx.input`：`{ x, y, nx, ny, dx, dy, down, dragging, click, wheel, wheelCtrl, pinch, keys, uiTarget }`（**状态**不是事件；`click/wheel/wheelCtrl/pinch/dx/dy` 每帧末清零）。场景在 `update()` 里只读，不得自行绑定 window 级监听。
- `uiTarget` 为真表示指针落在 UI 层（导航、按钮、面板），场景应忽略该次拖拽。`Esc` 会调用当前 stage 的 `reset()`，再广播 `cosmos:reset`（`ui.js` 用它复位本章控件参数）与 `cosmos:escape`（浮层统一监听收起）；Esc 的判定早于输入框早退，滑杆聚焦时同样生效。stage 返回 `arrowKeys: true` 表示方向键归场景（键盘等价拖拽），此时切章改用 `PageUp/PageDown`、`j/k`、`Home/End`；键盘切章只在 `e.defaultPrevented` 为假时执行（控件已处理过的键不再切章）。
- 滚轮路由：`Ctrl/⌘ + 滚轮` → `wheelCtrl`；带 `[data-wheel]` 的区域 → `wheel`；其余在非文档流章节里 → `wheel` 且 `preventDefault`（标签页模式下页面本身不滚，滚轮用于场景缩放）。
- 拖拽防选字：非 UI 目标上 `pointerdown` 会 `preventDefault`；拖拽阈值达成后给 `body` 加 `is-dragging` 并清空 `window.getSelection()`，松手移除。
- 场景内交互状态放闭包，禁止每帧 `new`。

---

## 4. 内容规范

### 4.1 每章骨架（数据驱动 `js/content-*.js`）

- 文案按部分拆分到 `js/content-core.js`（序章 / 总览 / 终章）、`content-solar.js`、`content-deep.js`、`content-cosmos.js`、`content-human.js`，统一用 `COSMOS.addContent(id, obj)` 注册；字段：`num / title / titleEn / part / kicker / lead / paragraphs` + 可选 `facts / quote / hint / cta / widget / layout`。
- 交互控件用 `COSMOS.registerWidget(id, factory)` 注册，由 `ui.js` 挂到章节的 `.ch-widget` 里；控件与场景共享 `COSMOS.state`，数字只从 `js/data.js` 取。
- 篇幅：正文 600–1200 字；`lead` ≤ 40 字；每段 60–140 字。
- 每章必须有：≥ 1 组结构化数据（`facts` 或 `timeline`）、≥ 1 个日常类比、≥ 1 个常见误解纠正、结尾一句"回扣"（把尺度拉回人）。
- **图文同源**：3D 参数（温度、半径、质量、颜色）从同一份数据推导；文字改了，画面必须同步改。
- **双语成对**：所有用户可见文案必须中英成对——代码内文案用 `COSMOS.i18n.T(zh, en)`，数据与章节文案同步进 `js/data-en.js` / `js/content-en.js`；英文不是机器直译，按 NASA 腔重写，数字与单位换英文习惯（million / billion light-years）。

### 4.2 数据口径

- 一个数字全站只有一个口径，统一登记在 `js/data.js` 的 `meta` / `sources`（现有：Planck 2018、IAU/NASA、GW150914、EHT 2019/2022 等）。
- 新数字必须带来源与年份；拿不准的数不写。
- 单位：SI + 中文习惯（亿公里、光年、开尔文），全站统一，不混用"公里/km"。
- 数字与单位间半角空格（`465 亿光年`），千分位用逗号；不用 Unicode 上标（中文字体缺字，统一交给 `richText()`）。
- 中文全角标点；破折号用"——"。

### 4.3 语气（NASA 腔）

- 具体 > 宏大：先讲机制和数字，再讲意义。
- 短句、主动语态、少形容词；禁止"炸裂、震撼、逆天、史诗级"。
- 术语首次出现：中文（English 原名 / 缩写），之后可只用缩写。
- 类比必须可比：给出换算过程，不文学化。
- 萨根式结尾可用，全站 ≤ 2 处。

---

## 5. 技术架构（硬约束；接口细节见 `CONTRACT.md`）

### 5.1 运行形态

- 双击 `index.html` 即可运行（`file://`）；经典 `<script>`，禁止 ESM / `import` / `export` / `type="module"`。
- three.js r169 全局 `window.THREE`；**无 addons**（OrbitControls / EffectComposer / GLTFLoader 等都不用）。
- 零网络请求：纹理、字体、数据全部本地或程序化；禁止字体 CDN、第三方脚本、新 npm 依赖、构建步骤。
- **真实影像例外（v2 起）**：允许使用公共领域的真实影像，但必须本地打包、仍然零网络。行星贴图以 data URL 内联进 `js/tex-solar.js`（`file://` 下 WebGL 读本地图片会 taint）；照片放 `assets/photos/` 由 `<img>` 加载。08 章载具档案另允许"署名即可使用"的官方素材（CC BY / CC0 / ESA Standard Licence / 中国官方发布），必须在图注与抽屉来源行写明出处；不得引入版权受限素材（如 ESO 的 EHT 照片）。使用范围与署名全部登记在 README「数据与影像来源」。

### 5.2 舞台接口

```js
COSMOS.registerStage('sun', function (ctx) {
  // 构建...
  return { scene, camera, update(t, dt, p), resize, enter, leave, dispose, bloom };
});
```

- `ctx` 现有：`{ THREE, renderer, width, height, aspect, pixelRatio, quality, index, reduceMotion, input, section, ui }`（`input` 见 §3.5）。
- 共享能力：`COSMOS.state`（跨场景/控件状态）、`COSMOS.on/emit`（事件总线）、`COSMOS.tex.load(key)`（读 `js/tex-solar.js` 的 data URL）、`COSMOS.util.pick/project`（拾取与投影）、`COSMOS.widgets` / `COSMOS.addContent`（控件与文案注册）。
- `p` = 当前章节进度 0→1：普通章由驻留时间在约 2s 内从 0.10 推到 0.86；flow 章再叠加章内滚动（最多 +0.14）。它是镜头主驱动；`update()` 里禁止每帧 `new` 对象，uniform 全部预建。
- GLSL 用 ES 1.00 语法；噪声、色温等函数从 `COSMOS.GLSL.*` 取，不重复造轮子。
- 场景把颜色写进线性空间，> 1.0 视为 HDR，由统一后处理泛光。

### 5.3 性能预算

- 单场景：draw call ≤ 60；粒子 ≤ 25 万（`quality === 'low'` 时减半）；三角 ≤ 30 万。
- 帧时间连续超预算时自动降分辨率（现有机制，不要绕过）。
- 页面隐藏时暂停（现有机制）；恢复时重置计时，避免时间跳变。

### 5.4 文件地图（当前准确版）

```
index.html              页面骨架：11 个 section，data-stage 决定场景
css/
  main.css              token、HUD、顶部标签栏、四色幕布、v3 面板布局与公共组件
  solar.css / deep.css / cosmos.css / human.css
                        各部分的专属样式（只写 .xx-* 前缀类，不覆盖公共类）
js/
  glsl-lib.js           共享 GLSL
  lib-core.js           stage/widget/content 注册表、事件总线、DOM、纹理加载、拾取
  tex-solar.js          13 张行星贴图（data URL）
  data.js               全站唯一数据源
  i18n.js               双语层：语言检测（`?lang=` / localStorage）、`T(zh,en)` 双参数翻译、静态文案与章节名替换、HUD 切换按钮
  data-en.js            英文模式的数据覆盖层（紧随 data.js，按 id / 数组索引覆盖英文字段）
  content-en.js         英文模式的 11 章文案覆盖层（紧随 content-*.js，覆盖 title / part / lead / paragraphs / facts 等）
  content-core/solar/deep/cosmos/human.js   文案与控件
  scene-ambient.js      starfield / idle
  scene-hero.js         hero
  scene-overview.js     overview（拉尼亚凯亚超星系团：丝绸 ribbon 纤维 1000+ 条/约 25 万三角 + 金色标签，标签亚像素同帧跟随）
  scene-finale-earth.js paleblue（终章：自动自转地球，日面/夜灯/云层/大气）
  scene-nebula.js       nebula（旧终章星云，现无章节引用，保留 deepfield 别名）
  nebula-bg.js          星云背景工厂：航天里程碑 / 载具 / 未来计划三章共用（标签 09–11，data-stage explore1/2/3），配色 / 构图 / 年份联动参数化
  scene-solarsystem.js  solar
  scene-compact.js      compact
  scene-galaxies.js     galaxies
  scene-extreme.js      extreme
  scene-explore.js      explore1/2/3
  feat-solar/compare/deep/cosmos/human.js   各章控件
  postfx.js             后处理
  ui.js                 11 章 DOM 渲染、顶部标签栏、HUD、灯箱、光标
  boot.js               渲染器、主循环、标签页状态机、四色幕布转场、懒加载、输入层、性能自适应
assets/photos/          49 张照片（NASA 公共领域为主，另有 ESA / CC BY / CC0 / 中国官方署名图）
tools/                  贴图与照片构建脚本（Python + Pillow）
vendor/three.global.js  three.js r169
shots/                  验收截图
.backup-v1/             v1 存档，不参与构建
```

- 新增 `js` 文件必须按依赖顺序加进 `index.html`（在 `boot.js` 之前）；新增 stage 必须同时有同名 `data-stage` 章节和对应的 `content-*.js` 条目。
- 双语：`i18n.js` 在 `lib-core.js` 之后、其余脚本之前加载，确定 `COSMOS.i18n.lang`（`?lang=` > localStorage > 默认中文）；`data-en.js` 紧随 `data.js`、`content-en.js` 紧随 `content-*.js`，只在英文模式覆盖英文层，不改中文原文。HUD 右侧 `#lang-toggle` 切换语言：写 localStorage → 带 hash 整页重载（当前章节保持），幕布负责过渡。
- 改章节结构要三处同改：`index.html`、对应的 `js/content-*.js`、`README.md` 表格。
- 版式有两套：默认 3D 分割章（整章固定 100vh，文案栏内部滚动），以及 `ui.js` 的 `FLOW_CHAPTERS`（compare / history / vehicles / future）走文档流（整章滚动）；新增文档流章节要把 id 加进那张表。
- 章节切换只走 `boot.js` 的 `tabGo(i)`：四色幕布 `#curtain` 切入 → `commitTab` 换 stage → 幕布切出；`goTo` 是 `tabGo` 的别名。`#nav` 是 `role="tablist"` 的顶部标签栏，键盘 `j/k`、`PageUp/PageDown`、`Home/End` 可切章；`←/→/↑/↓` 在声明 `arrowKeys` 的场景章归场景旋转。
- 幕布动画时长 460ms / 500ms 是品牌动效（参照学习中心），不属于 §2.5 的 5 档时长，改动需同步更新此说明。

---

## 6. 工作流（每步都有完成标准）

1. **读**：本文件；改场景加读 `CONTRACT.md` §3；改 UI 加读 `:root`。完成标准：说得出要动哪 1–3 个文件、属于哪一章。
2. **定位**：先 `grep` 章节 id / class / stage 名。完成标准：找到全部引用点，不凭印象改。
3. **改**：一次只做一件可验证的事；跨文件先列清单。完成标准：diff 里没有无关改动。
4. **静态检查**：
   ```bash
   for f in js/*.js; do node --check "$f" || echo "FAIL $f"; done
   grep -rnE '^\s*(import|export)\b' js/   # 期望无输出
   ```
   完成标准：全部通过，无 ESM 残留。
5. **真机验证**：直接开 `index.html`（`file://`，可用 Playwright 截图/取控制台），控制台 0 报错；键鼠 + 触屏模拟各走一遍交互。完成标准：效果可复现，无新增 `console.warn/error`。Playwright 对本地 js/css 有强缓存，改完代码要用 CDP `Network.clearBrowserCache` 再 reload，否则验证的是旧文件；同 URL 只改 hash 不会重新 boot，测试深链时加 `?v=N` 强制重载。本地静态服务器可用 `python -m http.server 8123 --bind 127.0.0.1`（Playwright 禁止 `file://`，真机验证仍走 CDP `Page.navigate` 到 `file://`）。
6. **截图**：≥ 3 张（初始 / 交互中 / 交互后）存 `shots/`，命名 `<章节>-<日期>-<序号>.png`。完成标准：图能证明改动生效。
7. **对照 §7 逐条打勾**，结果写进交付说明。完成标准：没有未说明的 ❌。
8. **同步文档**：章节、接口、数据口径变了就改 `README.md` / `js/data.js` 口径注释 / 本文件。完成标准：文档与代码一致。

交付说明固定四行：**改了什么 / 为什么 / 怎么验证 / 已知风险**。

---

## 7. 验收清单（交付前逐条勾，❌ 必须说明）

**交互**
- [ ] 该章达到 §3.2 的级别，"动手才看得见的瞬间"存在
- [ ] 顶部标签可点击切章，四色幕布转场完整播放且不打断交互；`j/k`、`PageUp/PageDown` 键盘可切章（`←/→` 在 `arrowKeys` 场景章归场景）
- [ ] 鼠标 / 触摸 / 键盘三通道都能完成同一操作
- [ ] Esc 或复位可用；2s 内有可见结果
- [ ] L3 参数显示当前值与单位，画面同帧变化

**视觉**
- [ ] 只用 §2.1 token，无自创色；强调色 ≤ 2 处/屏
- [ ] 只用三族字体、字号在阶内、圆角 0/2；无胶囊、无玻璃拟态
- [ ] 动效时长与缓动在 §2.5 内；reduced-motion 有降级
- [ ] 文字对比度 ≥ 4.5:1；全幅图上的文字有遮罩

**内容**
- [ ] 字数、结构块、数据来源齐全；数字与 `content.js` 一致
- [ ] 中文标点/单位/空格规范；无营销词；术语中英并列

**工程**
- [ ] `node --check` 通过；控制台 0 报错；无新增网络请求
- [ ] high ≥ 50fps；draw call / 粒子数 / 三角数在预算内
- [ ] `file://` 双击可运行；未引入依赖或 addons

**可访问性**
- [ ] 键盘可达 + focus 可见；canvas 有 `aria-label`；装饰层 `aria-hidden`

---

## 8. 硬禁止

- 外部资源：字体 CDN、第三方脚本、任何网络请求。真实影像只能本地打包（见 §5.1 例外）。
- 架构：ESM、three.js addons、新依赖、构建步骤。
- 性能：`update` 里 `new` 对象、每帧编译着色器、交互中重建几何。
- 视觉：自创配色/字体、科幻霓虹与 CRT 扫描线、彩虹渐变、胶囊按钮、玻璃拟态。
- 内容：编造数字、无来源的"最新发现"、营销体、未翻译的英文原文。
- 结构：单方面删改章节（要改就 `index.html` + 对应 `content-*.js` + `README.md` 一起改）。

---

## 附：NASA 规范出处

- 现网样式与 token：<https://www.nasa.gov/>（2026-11 实测：carbon 色阶、nasa-red/blue、DM Mono 大写微标签、3:2 卡片图、0 圆角、840/1100px 内容宽）
- 品牌色与字体：<https://www.rainbrand.com/brand-guidelines/nasa/>（Insignia Blue `#0B3D91`、Insignia Red `#FC3D21`）
- 组件与可访问性对照：<https://nasa.github.io/nasawds-site/>（NASA Web Design System，已停止维护，仅作参考）
- NASA 改版时，以 `nasa.gov` 计算样式实测重新取值，不凭印象自创。
