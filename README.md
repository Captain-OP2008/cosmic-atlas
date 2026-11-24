# COSMOS ATLAS · 宇宙图谱

一场从太阳系到可观测宇宙边缘的中英双语互动科普。11 个章节、五个部分，全部由 three.js 实时渲染；顶部标签页切换章节，四色斜切幕布负责转场，右上角 `EN / 中文` 一键切换语言。双击 `index.html` 就能看，断网也能看。

---

## 你会看到什么

首页是一整屏可以拖动的银河：镜头在 3 秒内从远处推进，拖动可旋转，滚轮 / 双指可放大也可缩小，点击核球会俯冲并进入第一章。

之后不再是"向下滚"，而是顶部的 11 个标签：点哪个章节，四色斜切幕布从左侧扫过，换场完成。每章是一块固定视口的面板（文档流章节除外），文字在左、3D 在右或铺满，长文案在文案栏内滚动阅读，整页不滚。

| # | 章节 | 所属部分 | 3D 场景 | 你能动手做什么 |
|---|------|---------|---------|----------------|
| 00 | 序章 · COSMOS | 开场 | 对数螺旋银河：按光谱型着色的恒星 + 尘埃带 + 核球辉光 + HII 区 | 拖动旋转、缩放、点击核球俯冲 |
| 01 | 宇宙总览 · THE COSMOS | I 宇宙 | 拉尼亚凯亚超星系团：丝绸质感金色纤维流（面向相机 ribbon、软边与宽窄渐变，1000+ 条、约 25 万三角单 pass）+ 蓝色外围宇宙网 + 4 个可点击标签（亚像素跟随、与 3D 同帧更新） | 拖动旋转、滚轮缩放、点击金色标签看说明 |
| 02 | 太阳系 · THE SOLAR SYSTEM | II 太阳系 | 八颗行星真实贴图、太阳米粒组织、土星环、地球云层与月球、小行星带 | 360° 拖拽、缩放、时间滑杆、点击行星开档案 |
| 03 | 行星对比 · PLANET LAB | II 太阳系 | — | 把地球与任意行星比大小、比体重、比大气成分 |
| 04 | 致密天体 · COMPACT OBJECTS | III 天体 | 黑洞吸积盘与光子环、中子星脉冲、白矮星 | 切换天体、拖动质量滑杆看史瓦西半径实时变化 |
| 05 | 星系动物园 · GALAXY ZOO | IV 深空 | 螺旋 / 椭圆 / 不规则三套星系粒子 | 切换形态，打开哈勃与韦布照片的原图灯箱 |
| 06 | 极端宇宙 · EXTREME UNIVERSE | IV 深空 | 引力波时空网格；NFW 暗物质晕 + 双螺旋盘 + 子晕 + 引力透镜弧；宇宙网节点/丝 + 膨胀标尺环 | 三模式切换；应变、M200、尺度因子三个滑杆 + 晕/透镜开关，旋转曲线与膨胀速率曲线同帧联动 |
| 07 | 航天里程碑 · HISTORY | V 人类 | 冷蓝抽象星云（与旧终章 nebula 同源的参数化氛围），年份推进时星点逐颗点亮 | 拖动 1957–2024 时间轴，看目标点一颗颗出现 |
| 08 | 现役与未来载具 · VEHICLES | V 人类 | 青金抽象星云背景 | 按真实高度对比、按类型筛选（火箭 / 望远镜 / 空间站）、点开档案抽屉 |
| 09 | 未来计划 · WHAT'S NEXT | V 人类 | 紫红抽象星云背景 | 算一算你去火星要飞多久、在火星上有多重 |
| 10 | 终章 · PALE BLUE DOT | 收束 | 3D 自动自转地球：日面贴图、夜面城市灯光、独立云层、大气边缘散射 + 背景星野（约 100 秒/圈） | 回望那张 1990 年的照片 |

---

## 技术

- **three.js r169**（`vendor/three.global.js`，本地打包成全局变量），**不使用任何 addons**
- **零网络请求**：所有贴图、照片、字体、数据都在本地。断网、`file://` 双击都能看
- **真实影像**：行星表面来自 Solar System Scope 的 2K/8K 贴图（CC BY 4.0），本地重采样后以 data URL 内联进 `js/tex-solar.js`（地球 / 木星 / 火星 / 土星 4096 px 宽，太阳 / 月球 / 云层 3072 px，其余 2048 px）；哈勃 / 韦布 / 阿波罗 / 探测器照片来自 NASA 公共领域图库，存放在 `assets/photos/`；08 章载具档案的 12 张图另含 ESA、中国官方与 CC BY / CC0 署名素材（见「数据与影像来源」）
- **手写后处理管线**（`js/postfx.js`）：HDR 渲染 → 三级高斯泛光 → ACES 色调映射 → 暗角 → 胶片颗粒 → sRGB
- **标签页引擎**（`js/boot.js`）：`tabGo(i)` 播放四色斜切幕布（460ms 切入 / 500ms 切出）→ 换 stage → 切出；章节进度 `p` 由驻留时间在约 2 秒内推满，文档流章节再叠加章内滚动
- **统一输入层**（`js/boot.js`）：指针 / 滚轮 / 双指 / 键盘归一化成状态对象，所有场景只读 `ctx.input`
- **中英双语**（`js/i18n.js` + `js/data-en.js` + `js/content-en.js`）：语言按 `?lang=` → `localStorage` → 默认中文决定；中文原文留在 `data.js` / `content-*.js`，英文层只在英文模式覆盖，切换时带当前章节 hash 整页重载，由四色幕布过渡
- **两种版式**：3D 分割章（整章固定 100vh + 左侧文案栏内部滚动 + 右侧控件）与文档流章（实验室与画廊可以自然滚动；对比 / 航天史 / 载具 / 未来四章在右栏配一张 NASA 公共领域照片，窄屏时照片移到文案上方）
- **性能自适应**：连续 72 帧均帧时间超过 23.5ms 时自动降低渲染分辨率（步长 0.2，下限 0.9×DPR）；桌面实测 144fps（vsync 封顶），最慢帧 < 8ms
- **低 DPI 超采样**：设备像素比 ≤ 1.1 的屏幕（常见 1080p）自动按 1.3× 渲染再交给浏览器缩小，线条与细小文字明显更锐；高 DPI 屏保持原样不额外开销

### 文件结构

```
index.html              页面骨架：11 个 section + 顶部标签栏 + #curtain 幕布 + HUD 语言切换
css/
  main.css              token、HUD、标签栏、四色幕布、面板布局、公共组件
  solar.css / deep.css / cosmos.css / human.css
                        各部分的专属样式
js/
  glsl-lib.js           共享 GLSL
  lib-core.js           stage/widget/content 注册表、事件总线、DOM、纹理加载、拾取
  i18n.js               双语层：语言检测（?lang / localStorage）、T(zh,en)、静态文案与章节名替换、HUD 切换按钮
  tex-solar.js          13 张行星贴图（data URL）
  data.js               全站唯一数据源
  data-en.js            英文模式的数据覆盖层（data.js 之后加载）
  content-core/solar/deep/cosmos/human.js   文案与控件
  content-en.js         英文模式的 11 章文案覆盖层（content-*.js 之后加载）
  scene-ambient.js      starfield / idle
  scene-hero.js         hero
  scene-overview.js     overview
  scene-finale-earth.js paleblue（终章：自动自转地球，日面/夜灯/云层/大气）
  scene-nebula.js       nebula（旧终章星云，现无章节引用）
  nebula-bg.js          星云背景工厂：航天里程碑 / 载具 / 未来计划三章共用（标签 09–11，data-stage explore1/2/3），配色 / 构图 / 年份联动参数化
  scene-solarsystem.js  solar
  scene-compact.js      compact
  scene-galaxies.js     galaxies
  scene-extreme.js      extreme
  scene-explore.js      explore1/2/3（三章共用 nebula-bg 的星云背景）
  feat-solar/compare/deep/cosmos/human.js   各章控件
  postfx.js             后处理
  ui.js                 11 章 DOM 渲染、顶部标签栏、HUD、灯箱、光标
  boot.js               渲染器、主循环、标签页状态机、四色幕布、懒加载、输入层、性能自适应
assets/photos/          49 张照片（NASA 公共领域为主，另有 ESA / CC BY / CC0 / 中国官方署名图）
tools/                  贴图与照片构建脚本（Python + Pillow）
vendor/three.global.js  three.js r169
shots/                  验收截图
.backup-v1/             v1 存档（11 章长卷），不参与构建
```

### 浏览器要求

支持 WebGL2 的现代浏览器（Chrome / Edge / Firefox / Safari 15+）。
移动端会降低渲染分辨率（`COSMOS.tex.maxWidth` 降到 2048）并把视角按竖屏重新取景；标签栏可横向滚动，右侧面板改为底部抽屉或文档流。

---

## 交互速查

- 鼠标：拖拽旋转、滚轮缩放（可放大可缩小）、悬停高亮、点击选择；拖动不会选中文字
- 滚轮：非文档流章节里普通滚轮直接缩放场景；`Ctrl/⌘ + 滚轮` 是备用缩放通道
- 触摸：单指旋转、双指缩放、横向滑动标签栏
- 键盘：`j k / PageUp PageDown / Home End` 切章；`← → / ↑ ↓` 在声明了 `arrowKeys` 的场景章（00/01/02/05/06）里旋转/俯仰画面，其余章（03/04/07/08/09/10）用于切章；`Esc` 复位当前章（场景视角 + 本章控件参数），`Tab` 可达所有控件，`Enter / Space` 激活
- 切章：点击顶部标签，或由 Hero 的「开始旅程」按钮进入第一章
- 语言：右上角 `EN / 中文` 切换中英版；切换会记住选择（`localStorage`）并保持当前章节，URL 里也会带上 `?lang=`
- 当前章节的进度条、章名与坐标在 HUD 同步
- URL 深链：`index.html#ch-solar` 直接落在太阳系章；切章会更新 hash；`index.html?lang=en#ch-solar` 直接落在英文版太阳系章

---

## 数据与影像来源

- 行星、太阳、任务、载具的数字统一登记在 `js/data.js`，口径来自 NASA / ESA / IAU 公开数据：宇宙年龄 137.87 亿年（Planck 2018）、可观测宇宙半径 465 亿光年、太阳质量占太阳系 99.86%、LIGO 首次探测引力波 2015-09-14、M87* 首张照片 2019-04-10、Sgr A* 2022-05-12 等。
- 行星贴图：Solar System Scope Textures（CC BY 4.0），本地重采样（4096 / 3072 / 2048 px 三档）后内联。
- 照片：NASA Image and Video Library，公共领域，共 49 张，存放在 `assets/photos/`。包括哈勃 / 韦布深空照片、阿波罗 11 与阿波罗 17 原始帧、旅行者号 / 卡西尼 / 帕克 / 新视野 / 毅力号；08 章载具档案新增 6 张 NASA 图：SLS（`NHQ202211160002`）、土星五号（`S69-39959`）、猎鹰重型（`KSC-20180206-PH_KLS02_0199`）、电子号（`KSC-20230507-PH-RLS01_0001-reupload`）、国际空间站（`iss066e081189`）、星舰鼻锥段（`SpaceX Starship Nose Cones`）。
- 08 章载具档案另有 4 张非 NASA 图，均本地打包、抽屉内图注与来源行注明出处：长征五号（天问一号发射，中新网 / China News Service，CC BY 4.0）；阿丽亚娜 6 号首飞（ESA - S. Corvaja，ESA Standard Licence，科普非商业用途）；中国空间站全貌（中国载人航天工程办公室在轨影像，保留 CMS 标识）；长征九号尚未首飞，使用 2022 珠海航展官方 1:50 展示模型照片（Shujianyang 摄，CC0），并明确标注「展示模型 · 尚未首飞」。
- 未能收录的影像：EHT 的黑洞照片（ESO 版权限制）。页面对应的叙述不配误导性图片；M87 使用的是 Spitzer 拍摄的喷流照片，并明确标注为喷流。
- 「暗淡蓝点」一节改写自卡尔·萨根 1994 年的演讲。

---

COSMOS ATLAS · 完
