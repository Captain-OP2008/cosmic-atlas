/* ============================================================
 * COSMOS ATLAS · js/scene-explore.js
 * 09 航天里程碑 / 10 现役与未来载具 / 11 未来计划（stage: explore1/2/3）
 * ------------------------------------------------------------
 * v3.5 起这三章的 3D 背景统一换成「抽象星云」：
 *   - 视觉族与 12 终章一致（js/nebula-bg.js 参数化工厂，与 scene-nebula.js 同源）
 *   - 09 冷蓝 / 10 青金 / 11 紫红，三章各一套调色板与构图
 *   - 原写实主体（地球弧、月面地平线、卫星、尾迹、基地穹顶）全部移除
 *
 * 交互：
 *   - 拖拽小幅环绕（L2）、指针视差、p 驱动的缓慢推镜；Esc 复位
 *   - 09 章额外读 COSMOS.state.explore.year（history 控件写入，场景只读），
 *     年份推进时星云亮度与恒星形成区缓慢增亮，保证「参数 → 画面」同帧可见
 *
 * 对外接口（feat-human.js 的 history 控件读取，勿删）：
 *   COSMOS.explore.satCount(year)  指定年份的示意在轨目标数
 *   COSMOS.explore.satTotal        示意总数（420）
 *   COSMOS.explore.yearRange       [1957, 2024]
 *   COSMOS.state.explore.year      当前年份（1957–2024）
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const THREE = window.THREE;
  if (!THREE) return;

  const YEAR_MIN = 1957;
  const YEAR_MAX = 2024;
  const SAT_N = 420;          // 示意在轨目标数上限（原场景口径，保留）
  const SAT_START_CURVE = 0.55;

  /* 共享状态：场景只读，history 控件写 */
  function exploreState() {
    COSMOS.state = COSMOS.state || {};
    let s = COSMOS.state.explore;
    if (!s) s = COSMOS.state.explore = { year: 1969 };
    return s;
  }

  /* 给定年份的示意目标数（控件复用，保证数字口径一致） */
  function satCount(year) {
    if (year <= YEAR_MIN) return 1;
    if (year >= YEAR_MAX) return SAT_N;
    const f = Math.pow((year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN), 1 / SAT_START_CURVE);
    return Math.max(1, Math.round(f * (SAT_N - 1) + 1));
  }

  COSMOS.explore = COSMOS.explore || {};
  COSMOS.explore.satCount = satCount;
  COSMOS.explore.satTotal = SAT_N;
  COSMOS.explore.yearRange = [YEAR_MIN, YEAR_MAX];

  /* --------------------------------------------------------------------------
   * 三章配色（线性空间；与 12 终章同一族 Hα / OIII / 紫 的三色结构）
   *   09 冷蓝：地球轨道时代的冷光
   *   10 青金：工程金属与推进器的青白 + 暗金
   *   11 紫红：火星未来的暖紫与品红
   * ------------------------------------------------------------------------ */
  const VARIANTS = {
    /* 09 航天里程碑 · 冷蓝 */
    1: {
      palette: {
        ha: [0.340, 0.620, 1.450],
        o3: [0.140, 0.620, 1.100],
        vio: [0.300, 0.440, 1.150],
        ion: [0.700, 1.150, 1.650],
        warm: [1.050, 1.350, 1.600],
        regions: [
          [0.95, 1.45, 2.40],
          [0.65, 1.10, 1.95],
          [1.15, 1.45, 2.20]
        ]
      },
      starCool: [0.82, 0.95, 1.35],
      starWarm: [1.05, 0.95, 0.85],
      nebSx: 0.600, nebSy: 0.740,
      spreadX: 1.70, spreadY: 1.60,
      cloudScale: 1.35,
      gain: 2.90,
      leftEdge: 0.32, leftSpan: 0.24,
      rightA: 0.98, rightB: 1.10,
      camTravel: 190,
      yearLink: true
    },
    /* 10 现役与未来载具 · 青金 */
    2: {
      palette: {
        ha: [0.560, 0.380, 0.100],
        o3: [0.060, 0.420, 0.400],
        vio: [0.140, 0.200, 0.340],
        ion: [0.720, 1.050, 1.000],
        warm: [1.200, 0.950, 0.550],
        regions: [
          [1.30, 1.00, 0.45],
          [0.55, 1.10, 1.05],
          [0.90, 0.85, 0.55]
        ]
      },
      starCool: [0.80, 1.10, 1.10],
      starWarm: [1.25, 1.05, 0.80],
      nebSx: 0.610, nebSy: 0.780,
      spreadX: 1.46, spreadY: 1.32,
      cloudScale: 1.10,
      gain: 2.20,
      leftEdge: 0.32, leftSpan: 0.24,
      rightA: 0.98, rightB: 1.10,
      camTravel: 190
    },
    /* 11 未来计划 · 紫红 */
    3: {
      palette: {
        ha: [0.760, 0.140, 0.240],
        o3: [0.180, 0.100, 0.480],
        vio: [0.540, 0.130, 0.460],
        ion: [1.200, 0.620, 0.800],
        warm: [1.150, 0.800, 0.520],
        regions: [
          [1.45, 0.50, 0.65],
          [0.85, 0.50, 1.35],
          [1.15, 0.75, 0.45]
        ]
      },
      starCool: [1.05, 0.90, 1.25],
      starWarm: [1.25, 0.90, 0.75],
      nebSx: 0.590, nebSy: 0.820,
      spreadX: 1.50, spreadY: 1.36,
      cloudScale: 1.15,
      gain: 2.25,
      leftEdge: 0.32, leftSpan: 0.24,
      rightA: 0.98, rightB: 1.10,
      camTravel: 185
    }
  };

  function create(ctx, variant) {
    exploreState();
    return COSMOS.nebulaBackdrop(ctx, VARIANTS[variant]);
  }

  /* 三个 stage 共用同一工厂，靠 variant 区分色调与构图 */
  COSMOS.registerStage('explore1', function (ctx) { return create(ctx, 1); });
  COSMOS.registerStage('explore2', function (ctx) { return create(ctx, 2); });
  COSMOS.registerStage('explore3', function (ctx) { return create(ctx, 3); });
})(window.COSMOS = window.COSMOS || {});
