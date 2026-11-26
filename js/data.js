/* ============================================================
 * COSMOS ATLAS — 全站数据源（v2）
 * 口径说明：
 *  - 行星参数：NASA Planetary Fact Sheet（2024 修订）；卫星数为 IAU 2025-03 确认数。
 *  - 宇宙学：Planck 2018（年龄 137.87±0.20 亿年、暗能量 68.3%、暗物质 26.8%、普通物质 4.9%）。
 *  - 可观测宇宙半径 465 亿光年（Planck 2018 参数推导）；星系总数 2 万亿（Conselice et al. 2016）。
 *  - 引力波：GW150914（2015-09-14，LIGO）；GW170817（2017-08-17，LIGO/Virgo）。
 *  - 探测器状态截至 2025 年；未来计划标注"计划"，不写成已发生。
 *  - 本文件只存数据，不写文案；解释性文字在 js/content-*.js。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  const D = {};

  /* ---------------- 总览 ---------------- */
  D.meta = {
    ageUniverse: '137.87 ± 0.20 亿年',
    observableRadius: '465 亿光年',
    galaxyCount: '约 2 万亿',
    starCount: '10²² 量级以上',
    cmbTemp: '2.725 K',
    hubbleConst: '67.4 / 73.0 km/s/Mpc（两种测量，相差约 8%）',
    sunMassShare: '99.86%',
    solarSystemAge: '46 亿年'
  };

  D.components = [
    { key: 'darkEnergy', name: '暗能量', en: 'Dark Energy', pct: 68.3, note: '让宇宙加速膨胀', color: '#1C67E3' },
    { key: 'darkMatter', name: '暗物质', en: 'Dark Matter', pct: 26.8, note: '提供额外引力，不发光', color: '#288BFF' },
    { key: 'matter', name: '普通物质', en: 'Ordinary Matter', pct: 4.9, note: '恒星、气体、你和我', color: '#FFFFFF' }
  ];

  /* ---------------- 太阳 ---------------- */
  D.sun = {
    id: 'sun', kind: 'star',
    name: '太阳', en: 'Sun', symbol: '☉',
    radiusKm: 696340,
    massKg: '1.989×10³⁰',
    surfaceC: 5500,
    coreC: 15000000,
    ageYr: 4600000000,
    rotationDays: 25.4,
    luminosityW: '3.828×10²⁶',
    composition: [
      { name: '氢', pct: 73.5 }, { name: '氦', pct: 24.9 },
      { name: '氧', pct: 0.8 }, { name: '碳', pct: 0.3 }, { name: '其他', pct: 0.5 }
    ],
    texture: 'sun'
  };

  /* ---------------- 行星 ----------------
   * 半径/直径 km；质量 kg；质量以地球=1；重力 m/s²；自转 h；公转 d；距离 AU；
   * 温度 °C（云顶/地表平均）；卫星数；倾角°。
   */
  D.planets = [
    {
      id: 'mercury', name: '水星', en: 'Mercury', symbol: '☿', texture: 'mercury',
      color: '#9C8F84', type: '类地行星',
      radiusKm: 2439.7, diameterKm: 4879, massKg: '3.30×10²³', massEarth: 0.055,
      gravity: 3.7, dayHours: 1407.6, yearDays: 88, au: 0.387,
      tempC: '-173 ~ 427', tempAvgC: 167, moons: 0, rings: false, tilt: 0.03,
      tagline: '离太阳最近，也最像月球',
      desc: '没有真正的大气，白天能把铅熔化，夜里降到 −173 °C。表面布满撞击坑，唯一的"天气"是太阳风把原子从地表剥离。',
      special: '一个太阳日（从日出到下一次日出）长达 176 个地球日，比它的一年还长。',
      atmosphere: [
        { name: '氧', pct: 42 }, { name: '钠', pct: 29 }, { name: '氢', pct: 22 },
        { name: '氦', pct: 6 }, { name: '钾', pct: 0.5 }
      ],
      atmosphereNote: '严格说是"外逸层"，气压不到地球的万亿分之一。',
      missions: ['mariner10', 'messenger', 'bepicolombo']
    },
    {
      id: 'venus', name: '金星', en: 'Venus', symbol: '♀', texture: 'venus',
      color: '#D9B382', type: '类地行星',
      radiusKm: 6051.8, diameterKm: 12104, massKg: '4.87×10²⁴', massEarth: 0.815,
      gravity: 8.87, dayHours: 5832.5, yearDays: 224.7, au: 0.723,
      tempC: '464', tempAvgC: 464, moons: 0, rings: false, tilt: 177.4,
      tagline: '地球的失控温室双胞胎',
      desc: '96.5% 的二氧化碳大气压在地表 92 倍地球大气压，温室效应把地表烤到 464 °C，比水星更热。云层里是硫酸液滴。',
      special: '自转方向与公转相反，在金星上太阳从西边升起，而且一天比一年长。',
      atmosphere: [
        { name: '二氧化碳', pct: 96.5 }, { name: '氮', pct: 3.5 }, { name: '二氧化硫', pct: 0.015 }
      ],
      atmosphereNote: '地表气压约 92 个标准大气压，相当于地球海面下 900 米。',
      missions: ['magellan', 'venusexpress', 'akatsuki']
    },
    {
      id: 'earth', name: '地球', en: 'Earth', symbol: '⊕', texture: 'earth_day',
      color: '#2E6FBF', type: '类地行星',
      radiusKm: 6371, diameterKm: 12742, massKg: '5.97×10²⁴', massEarth: 1,
      gravity: 9.807, dayHours: 23.934, yearDays: 365.25, au: 1,
      tempC: '15（平均）', tempAvgC: 15, moons: 1, rings: false, tilt: 23.44,
      tagline: '目前唯一已知存在生命的地方',
      desc: '液态水、板块运动、磁场与含氧大气同时存在。大气中 21% 的氧气来自光合作用，是生物改造行星的证据。',
      special: '22.6 亿年前的大氧化事件把氧气写进大气，之后才有了复杂生命。',
      atmosphere: [
        { name: '氮', pct: 78.08 }, { name: '氧', pct: 20.95 },
        { name: '氩', pct: 0.93 }, { name: '二氧化碳', pct: 0.042 }
      ],
      atmosphereNote: '水汽含量随地点变化，0.1%–4%。',
      missions: ['apollo11', 'iss', 'landsat']
    },
    {
      id: 'mars', name: '火星', en: 'Mars', symbol: '♂', texture: 'mars',
      color: '#C1440E', type: '类地行星',
      radiusKm: 3389.5, diameterKm: 6779, massKg: '6.42×10²³', massEarth: 0.107,
      gravity: 3.71, dayHours: 24.623, yearDays: 687, au: 1.524,
      tempC: '-63（平均）', tempAvgC: -63, moons: 2, rings: false, tilt: 25.19,
      tagline: '曾经有水，现在有沙尘暴',
      desc: '平均温度 −63 °C，大气只有地球的 0.6%。水手谷长 4,000 公里，奥林帕斯山高 21.9 公里，是太阳系最大的火山。',
      special: '火星一天只比地球长 37 分钟，是最像"可排班"的星球。',
      atmosphere: [
        { name: '二氧化碳', pct: 95.32 }, { name: '氮', pct: 2.7 },
        { name: '氩', pct: 1.6 }, { name: '氧', pct: 0.13 }
      ],
      atmosphereNote: '气压约为地球的 0.6%，无法在液态水表面稳定存在。',
      missions: ['viking1', 'curiosity', 'perseverance', 'tianwen1']
    },
    {
      id: 'jupiter', name: '木星', en: 'Jupiter', symbol: '♃', texture: 'jupiter',
      color: '#C9A88E', type: '气态巨行星',
      radiusKm: 69911, diameterKm: 139820, massKg: '1.898×10²⁷', massEarth: 317.8,
      gravity: 24.79, dayHours: 9.925, yearDays: 4331, au: 5.204,
      tempC: '-108（云顶）', tempAvgC: -108, moons: 95, rings: true, tilt: 3.13,
      tagline: '太阳系的吸尘器与气态巨人',
      desc: '质量是其余七颗行星总和的 2.5 倍。大红斑是持续了至少 190 年的反气旋，如今宽度只剩 1.6 万公里，仍在缩小。',
      special: '自转一圈不到 10 小时，是太阳系自转最快的行星；强大引力替内太阳系挡下了大量彗星。',
      atmosphere: [
        { name: '氢', pct: 89.8 }, { name: '氦', pct: 10.2 }, { name: '甲烷', pct: 0.3 }
      ],
      atmosphereNote: '没有固体表面，大气随深度逐渐变成液态金属氢。',
      missions: ['voyager1', 'galileo', 'juno']
    },
    {
      id: 'saturn', name: '土星', en: 'Saturn', symbol: '♄', texture: 'saturn',
      color: '#E3CFA8', type: '气态巨行星',
      radiusKm: 58232, diameterKm: 116460, massKg: '5.68×10²⁶', massEarth: 95.2,
      gravity: 10.44, dayHours: 10.656, yearDays: 10747, au: 9.583,
      tempC: '-139（云顶）', tempAvgC: -139, moons: 274, rings: true, tilt: 26.73,
      tagline: '密度比水还低的环之王',
      desc: '平均密度 0.687 g/cm³，比水还低。光环宽 28 万公里，厚度平均只有十米，主要由水冰颗粒组成。',
      special: '2025 年 3 月国际天文学联合会确认土星卫星 274 颗，是太阳系卫星最多的行星。',
      atmosphere: [
        { name: '氢', pct: 96.3 }, { name: '氦', pct: 3.25 }, { name: '甲烷', pct: 0.45 }
      ],
      atmosphereNote: '北极存在一个边长约 1.4 万公里的六边形急流。',
      missions: ['voyager2', 'cassini', 'huygens']
    },
    {
      id: 'uranus', name: '天王星', en: 'Uranus', symbol: '♅', texture: 'uranus',
      color: '#A8D8DE', type: '冰巨行星',
      radiusKm: 25362, diameterKm: 50724, massKg: '8.68×10²⁵', massEarth: 14.5,
      gravity: 8.69, dayHours: 17.24, yearDays: 30589, au: 19.19,
      tempC: '-195（云顶）', tempAvgC: -195, moons: 28, rings: true, tilt: 97.77,
      tagline: '躺着自转的冰巨星',
      desc: '自转轴倾斜 98°，几乎躺在轨道平面上，一极连续 42 年朝向太阳，另一极 42 年不见天日。甲烷吸收红光，让它呈青蓝色。',
      special: '人类只近距离看过它一次：1986 年旅行者 2 号飞掠。',
      atmosphere: [
        { name: '氢', pct: 82.5 }, { name: '氦', pct: 15.2 }, { name: '甲烷', pct: 2.3 }
      ],
      atmosphereNote: '内部是水、氨、甲烷组成的高温高压"冰"层。',
      missions: ['voyager2']
    },
    {
      id: 'neptune', name: '海王星', en: 'Neptune', symbol: '♆', texture: 'neptune',
      color: '#3C63D1', type: '冰巨行星',
      radiusKm: 24622, diameterKm: 49244, massKg: '1.02×10²⁶', massEarth: 17.1,
      gravity: 11.15, dayHours: 16.11, yearDays: 59800, au: 30.07,
      tempC: '-201（云顶）', tempAvgC: -201, moons: 16, rings: true, tilt: 28.32,
      tagline: '先算出来、后看见的行星',
      desc: '风速可达 2,100 km/h。1846 年天文学家从天王星轨道的偏差推算出它的位置，当晚就找到了它。',
      special: '它是唯一一颗靠数学预测而不是靠观测发现的行星。',
      atmosphere: [
        { name: '氢', pct: 80 }, { name: '氦', pct: 19 }, { name: '甲烷', pct: 1.5 }
      ],
      atmosphereNote: '接收到的太阳光只有地球的千分之一。',
      missions: ['voyager2']
    }
  ];

  /* 矮行星（对比实验室可选） */
  D.dwarfPlanets = [
    {
      id: 'pluto', name: '冥王星', en: 'Pluto', symbol: '♇', texture: null,
      color: '#C7A98B', type: '矮行星',
      radiusKm: 1188.3, diameterKm: 2377, massKg: '1.30×10²²', massEarth: 0.0022,
      gravity: 0.62, dayHours: 153.3, yearDays: 90560, au: 39.48,
      tempC: '-229', tempAvgC: -229, moons: 5, rings: false, tilt: 122.5,
      tagline: '被重新分类的冰世界',
      desc: '2006 年被 IAU 重新划为矮行星。新视野号 2015 年飞掠时发现了氮冰平原"斯普特尼克平原"和 3,500 公里宽的心形区域。',
      special: '它的"一天"等于 6.4 个地球日，"一年"要 248 个地球年。',
      atmosphere: [{ name: '氮', pct: 90 }, { name: '甲烷', pct: 9 }, { name: '一氧化碳', pct: 1 }],
      atmosphereNote: '极稀薄，近日点升华、远日点冻结。',
      missions: ['newhorizons']
    }
  ];

  /* ---------------- 太阳系卫星（12 颗，02 章选择器/档案用） ----------------
   * 半径 km；质量 kg；重力 m/s²；自转 h（大卫星多潮汐锁定）；公转 d；平均轨道半径 km。
   * 位置不在这里算，由 COSMOS.ephem.moonRel(parent, id, jd) 提供。
   * 口径：NASA Planetary Fact Sheet / JPL Solar System Dynamics（2025）。
   */
  D.moons = [
    {
      id: 'moon', name: '月球', en: 'Moon', parent: 'earth', symbol: '☾', texture: 'moon',
      radiusKm: 1737.4, diameterKm: 3474.8, massKg: '7.35×10²²', gravity: 1.62,
      dayHours: 708.7, periodDays: 27.32, distanceKm: 384400,
      tagline: '地球唯一的天然卫星，也是我们唯一登陆过的另一个世界',
      desc: '潮汐锁定，永远以同一面朝向地球。1969—1972 年，12 名宇航员在月面行走，带回 382 kg 样品。',
      special: '它把地球的自转刹慢到 24 小时：4 亿年前的泥盆纪，一天只有约 22 小时。'
    },
    {
      id: 'phobos', name: '火卫一', en: 'Phobos', parent: 'mars', symbol: '①', texture: 'phobos',
      radiusKm: 11.27, diameterKm: 22.53, massKg: '1.07×10¹⁶', gravity: 0.0037,
      dayHours: 7.65, periodDays: 0.319, distanceKm: 9376,
      tagline: '一天绕火星三圈的碎块',
      desc: '形状不规则，表面布满陨石坑和沟槽，可能是被捕获的小行星或一次巨大撞击的溅射物。',
      special: '它的轨道每月下降约 1.8 cm，约 5000 万年后将撞上火星或碎成一道环。'
    },
    {
      id: 'deimos', name: '火卫二', en: 'Deimos', parent: 'mars', symbol: '②', texture: 'deimos',
      radiusKm: 6.2, diameterKm: 12.4, massKg: '1.48×10¹⁵', gravity: 0.003,
      dayHours: 30.3, periodDays: 1.263, distanceKm: 23463,
      tagline: '火星安静的小同伴',
      desc: '比火卫一小得多，表面覆盖厚层尘土，撞击坑的边缘已被磨平。',
      special: '从火星表面看，它只是一颗缓慢移动的亮星，而不是一轮明显的月亮。'
    },
    {
      id: 'io', name: '木卫一', en: 'Io', parent: 'jupiter', symbol: 'Ⅰ', texture: 'io',
      radiusKm: 1821.6, diameterKm: 3643.2, massKg: '8.93×10²²', gravity: 1.80,
      dayHours: 42.46, periodDays: 1.769, distanceKm: 421700,
      tagline: '太阳系火山活动最剧烈的天体',
      desc: '超过 400 座活火山，硫化物把表面染成黄、橙、红；木星的潮汐加热把内部揉得滚烫。',
      special: '火山羽流能喷到 300 km 高，物质最终被木星磁场电离，形成一圈等离子体环。'
    },
    {
      id: 'europa', name: '木卫二', en: 'Europa', parent: 'jupiter', symbol: 'Ⅱ', texture: 'europa',
      radiusKm: 1560.8, diameterKm: 3121.6, massKg: '4.80×10²²', gravity: 1.31,
      dayHours: 85.23, periodDays: 3.551, distanceKm: 671034,
      tagline: '冰壳下可能藏着比地球更多的液态水',
      desc: '表面是光滑的冰，交错着棕红色裂纹；冰壳下约 100 km 深处可能存在全球性海洋。',
      special: '欧罗巴快船 2024 年发射，计划 2030 年进入木星轨道，评估这片海洋是否宜居。'
    },
    {
      id: 'ganymede', name: '木卫三', en: 'Ganymede', parent: 'jupiter', symbol: 'Ⅲ', texture: 'ganymede',
      radiusKm: 2634.1, diameterKm: 5268.2, massKg: '1.48×10²³', gravity: 1.43,
      dayHours: 171.7, periodDays: 7.155, distanceKm: 1070412,
      tagline: '太阳系最大的卫星，比水星还大',
      desc: '唯一拥有自身磁场的卫星，表面由古老暗区与年轻的亮色沟槽地形拼成。',
      special: '哈勃在 1990 年代发现它有稀薄氧气大气，氧来自冰面被辐射分解。'
    },
    {
      id: 'callisto', name: '木卫四', en: 'Callisto', parent: 'jupiter', symbol: 'Ⅳ', texture: 'callisto',
      radiusKm: 2410.3, diameterKm: 4820.6, massKg: '1.08×10²³', gravity: 1.24,
      dayHours: 400.5, periodDays: 16.689, distanceKm: 1882709,
      tagline: '太阳系撞击坑最密集的表面之一',
      desc: '40 亿年来几乎没有地质活动，表面因此成为一份完整的撞击史档案。',
      special: '它在木星强辐射带之外，被视为未来载人前哨的候选地点。'
    },
    {
      id: 'enceladus', name: '土卫二', en: 'Enceladus', parent: 'saturn', symbol: 'Ⅱ', texture: 'enceladus',
      radiusKm: 252.1, diameterKm: 504, massKg: '1.08×10²⁰', gravity: 0.11,
      dayHours: 32.9, periodDays: 1.370, distanceKm: 237948,
      tagline: '南极喷出冰羽的海洋世界',
      desc: '南极裂缝喷出含盐冰粒，形成土星的一圈小白环；羽流中检出有机分子。',
      special: '卡西尼号曾穿过羽流取样，测到盐水与硅酸盐颗粒，暗示地下存在热液活动。'
    },
    {
      id: 'rhea', name: '土卫五', en: 'Rhea', parent: 'saturn', symbol: 'Ⅴ', texture: 'rhea',
      radiusKm: 763.8, diameterKm: 1527.6, massKg: '2.31×10²¹', gravity: 0.26,
      dayHours: 108.4, periodDays: 4.518, distanceKm: 527108,
      tagline: '冰做的撞击坑世界',
      desc: '密度只有 1.24 g/cm³，主要成分是水冰；表面明亮，却布满古老的撞击坑。',
      special: '卡西尼 2008 年飞掠时测到稀薄氧气大气，来源是冰面被磁层粒子击碎。'
    },
    {
      id: 'titan', name: '土卫六', en: 'Titan', parent: 'saturn', symbol: 'Ⅵ', texture: 'titan',
      radiusKm: 2574.7, diameterKm: 5149.5, massKg: '1.35×10²³', gravity: 1.35,
      dayHours: 382.7, periodDays: 15.945, distanceKm: 1221870,
      tagline: '唯一有稠密大气与地表湖泊的卫星',
      desc: '大气压比地球高约 45%，以氮气为主；甲烷参与降雨、河流与湖泊，形成第二套天气系统。',
      special: '惠更斯号 2005 年降落并拍下地表，是人类首次在外太阳系天体着陆。'
    },
    {
      id: 'triton', name: '海卫一', en: 'Triton', parent: 'neptune', symbol: 'Ⅰ', texture: 'triton',
      radiusKm: 1353.4, diameterKm: 2706.8, massKg: '2.14×10²²', gravity: 0.78,
      dayHours: 141.0, periodDays: 5.877, distanceKm: 354759,
      tagline: '逆行公转的冰火山卫星',
      desc: '唯一逆着母行星自转方向公转的大卫星，几乎可以确定是被海王星捕获的柯伊伯带天体。',
      special: '旅行者 2 号 1989 年拍到黑色氮冰羽流，说明它至今仍有冰火山活动。'
    },
    {
      id: 'charon', name: '冥卫一', en: 'Charon', parent: 'pluto', symbol: 'Ⅰ', texture: 'charon',
      radiusKm: 606, diameterKm: 1212, massKg: '1.586×10²¹', gravity: 0.29,
      dayHours: 153.3, periodDays: 6.387, distanceKm: 19591,
      tagline: '与冥王星互相潮汐锁定的伴侣',
      desc: '质量是冥王星的 12%，两者绕共同质心旋转，因此常被视为一个双矮行星系统。',
      special: '新视野号 2015 年发现它的北极覆盖红棕色物质，来自冥王星逃逸的甲烷。'
    }
  ];

  /* ---------------- 太阳系探测任务 ---------------- */
  D.missions = [
    {
      id: 'voyager1', name: '旅行者 1 号', en: 'Voyager 1', date: '1977-09-05', year: 1977,
      agency: 'NASA', targets: ['木星', '土星'], status: '飞行中 · 星际空间',
      distance: '约 165 AU（2025）', photo: 'probe-voyager',
      desc: '飞掠木星与土星后借助引力弹弓飞出黄道面，2012 年进入星际空间，是目前离地球最远的人造物体。',
      fact: '它与地球的无线电信号单程要走 22 小时以上。'
    },
    {
      id: 'voyager2', name: '旅行者 2 号', en: 'Voyager 2', date: '1977-08-20', year: 1977,
      agency: 'NASA', targets: ['木星', '土星', '天王星', '海王星'], status: '飞行中 · 星际空间',
      distance: '约 137 AU（2025）', photo: null,
      desc: '唯一造访过天王星与海王星的探测器，借 176 年一遇的行星排列完成"大巡游"。',
      fact: '它的相机 1990 年就已关闭，但等离子体与磁场仪器仍在工作。'
    },
    {
      id: 'parker', name: '帕克太阳探测器', en: 'Parker Solar Probe', date: '2018-08-12', year: 2018,
      agency: 'NASA', targets: ['太阳'], status: '飞行中 · 绕日',
      distance: '最近 610 万 km（2024-12-24）', photo: 'probe-parker',
      desc: '人类造得最快的物体，2024 年 12 月以 69 万 km/h 穿过日冕，首次进入太阳大气的磁化区域。',
      fact: '它的碳复合材料隔热罩厚 11.4 cm，朝日面温度约 1,400 °C，背面仪器舱维持 30 °C。'
    },
    {
      id: 'cassini', name: '卡西尼-惠更斯', en: 'Cassini-Huygens', date: '1997-10-15', year: 1997,
      agency: 'NASA / ESA / ASI', targets: ['土星', '土卫六'], status: '已结束（2017）',
      distance: '土星系统 13 年', photo: 'probe-cassini',
      desc: '环绕土星 294 圈，惠更斯号 2005 年降落在土卫六表面。2017 年以"壮丽终章"主动坠入土星大气。',
      fact: '它发现了土卫二南极的冰喷泉，喷出的水汽来自地下海洋。'
    },
    {
      id: 'newhorizons', name: '新视野号', en: 'New Horizons', date: '2006-01-19', year: 2006,
      agency: 'NASA', targets: ['冥王星', '柯伊伯带'], status: '飞行中 · 柯伊伯带',
      distance: '约 60 AU（2025）', photo: 'probe-newhorizons',
      desc: '2015 年 7 月 14 日飞掠冥王星，人类第一次看清这个冰世界；2019 年又飞掠柯伊伯带天体"天空"。',
      fact: '发射时它是史上初速最快的探测器，5 小时就飞过了月球轨道。'
    },
    {
      id: 'juno', name: '朱诺号', en: 'Juno', date: '2011-08-05', year: 2011,
      agency: 'NASA', targets: ['木星'], status: '飞行中 · 绕木星', distance: '木星轨道', photo: null,
      desc: '用极轨反复穿过木星辐射带，测量重力场、磁场与大气深处的氨和水。',
      fact: '它的太阳能板在木星轨道只有地球处的 1/25 效率，却仍能供电。'
    },
    {
      id: 'galileo', name: '伽利略号', en: 'Galileo', date: '1989-10-18', year: 1989,
      agency: 'NASA', targets: ['木星', '木卫二'], status: '已结束（2003）', distance: '木星系统 8 年', photo: null,
      desc: '第一个进入木星轨道的探测器，释放的大气探测器首次直接测量木星大气，并发现木卫二可能存在地下海洋。',
      fact: '主天线未展开，只能以 1/1000 的速率回传数据。'
    },
    {
      id: 'messenger', name: '信使号', en: 'MESSENGER', date: '2004-08-03', year: 2004,
      agency: 'NASA', targets: ['水星'], status: '已结束（2015）', distance: '水星轨道 4 年', photo: null,
      desc: '首个环绕水星的探测器，绘制了完整表面图，并在极区永久阴影坑里发现水冰。',
      fact: '为抵消太阳引力，它绕了地球一次、金星两次、水星三次才进入轨道。'
    },
    {
      id: 'magellan', name: '麦哲伦号', en: 'Magellan', date: '1989-05-04', year: 1989,
      agency: 'NASA', targets: ['金星'], status: '已结束（1994）', distance: '金星轨道 4 年', photo: null,
      desc: '用雷达穿透金星硫酸云，绘制了 98% 的表面，发现大量火山平原与盾状火山。',
      fact: '金星表面气压足以压扁一辆汽车，它靠雷达而不是相机"看"地面。'
    },
    {
      id: 'curiosity', name: '好奇号', en: 'Curiosity', date: '2011-11-26', year: 2011,
      agency: 'NASA', targets: ['火星'], status: '运行中 · 盖尔环形山', distance: '火星表面', photo: null,
      desc: '用空中吊车着陆，钻探岩石并分析有机分子，确认火星曾经存在适合微生物的环境。',
      fact: '它的核电池已工作超过 10 年，行程超过 30 公里。'
    },
    {
      id: 'perseverance', name: '毅力号', en: 'Perseverance', date: '2020-07-30', year: 2020,
      agency: 'NASA', targets: ['火星'], status: '运行中 · 杰泽罗环形山', distance: '火星表面', photo: 'rover-perseverance',
      desc: '在古河流三角洲采集岩芯样本，等待未来任务取回地球；随行的"机智号"直升机完成了 72 次飞行。',
      fact: '它携带的氧气发生器每天能制出约 10 克氧气。'
    },
    {
      id: 'tianwen1', name: '天问一号 / 祝融号', en: 'Tianwen-1', date: '2020-07-23', year: 2020,
      agency: 'CNSA', targets: ['火星'], status: '任务完成（轨道器仍在）', distance: '火星', photo: null,
      desc: '一次发射完成"绕、落、巡"三步，祝融号在乌托邦平原行驶 1,921 米，发现该地区存在水活动迹象。',
      fact: '这是人类第一次在火星任务中同时完成环绕、着陆与巡视。'
    },
    {
      id: 'change5', name: '嫦娥五号', en: "Chang'e 5", date: '2020-11-23', year: 2020,
      agency: 'CNSA', targets: ['月球'], status: '任务完成（2020）', distance: '月球', photo: null,
      desc: '带回 1,731 克月壤，是 1976 年以来人类首次月球采样返回，样品来自月球正面风暴洋。',
      fact: '返回器以接近第二宇宙速度再入，采用"半弹道跳跃"减速。'
    },
    {
      id: 'mariner10', name: '水手 10 号', en: 'Mariner 10', date: '1973-11-03', year: 1973,
      agency: 'NASA', targets: ['水星', '金星'], status: '已结束（1975）', distance: '水星 3 次飞掠', photo: null,
      desc: '首次利用引力弹弓，先后飞掠金星与水星，拍到水星表面约 45% 的范围。',
      fact: '它的轨道周期恰好是水星公转的两倍，因此每次飞掠都面对水星同一面。'
    },
    {
      id: 'venusexpress', name: '金星快车', en: 'Venus Express', date: '2005-11-09', year: 2005,
      agency: 'ESA', targets: ['金星'], status: '已结束（2014）', distance: '金星轨道 9 年', photo: null,
      desc: '首次在金星极轨长期观测，追踪云顶风速与大气逃逸，发现金星大气中可能存在磷化氢的早期线索。',
      fact: '它的大部分仪器是"火星快车"的备件改装的。'
    },
    {
      id: 'akatsuki', name: '拂晓号', en: 'Akatsuki', date: '2010-05-20', year: 2010,
      agency: 'JAXA', targets: ['金星'], status: '运行中（2015 入轨）', distance: '金星轨道', photo: null,
      desc: '首次入轨失败后，用 5 年时间绕太阳重新追上金星，最终成功进入轨道，发现金星云层顶部的"弓形"结构。',
      fact: '它是世界上第一颗靠"绕远路"救回来的行星探测器。'
    },
    {
      id: 'marsExpress', name: '火星快车', en: 'Mars Express', date: '2003-06-02', year: 2003,
      agency: 'ESA', targets: ['火星'], status: '运行中', distance: '火星轨道', photo: null,
      desc: '发现火星南极冰盖下的液态水线索，并释放了"猎兔犬 2 号"着陆器（失联）。',
      fact: '原计划只工作 2 年，如今已运行超过 20 年。'
    },
    {
      id: 'viking1', name: '海盗 1 号', en: 'Viking 1', date: '1975-08-20', year: 1975,
      agency: 'NASA', targets: ['火星'], status: '已结束（1982）', distance: '火星表面 6 年', photo: null,
      desc: '首个成功在火星表面长期工作的着陆器，进行了三项生命探测实验，结果均为阴性但留下争议。',
      fact: '它的轨道器为后来的火星任务拍摄了绝大部分着陆点底图。'
    },
    {
      id: 'bepicolombo', name: '贝皮科伦布', en: 'BepiColombo', date: '2018-10-20', year: 2018,
      agency: 'ESA / JAXA', targets: ['水星'], status: '飞行中 · 2026 入轨', distance: '水星转移轨道', photo: null,
      desc: '由 ESA 的水星行星轨道器（MPO）与 JAXA 的水星磁层轨道器（MMO）组成，计划 2026 年进入水星轨道。',
      fact: '它需要 9 次行星飞掠（1 次地球、2 次金星、6 次水星）才能减速入轨。'
    },
    {
      id: 'lucy', name: '露西号', en: 'Lucy', date: '2021-10-16', year: 2021,
      agency: 'NASA', targets: ['特洛伊小行星'], status: '飞行中', distance: '木星轨道附近', photo: null,
      desc: '前往木星特洛伊群，探测 11 颗不同的小行星，研究太阳系早期的"化石"。',
      fact: '它的太阳能板单块直径 7.3 米，展开后像两扇大翅膀。'
    },
    {
      id: 'rosetta', name: '罗塞塔', en: 'Rosetta', date: '2004-03-02', year: 2004,
      agency: 'ESA', targets: ['彗星 67P'], status: '任务完成（2016）', distance: '彗星 67P', photo: null,
      desc: '首次环绕彗星并投放着陆器的任务，追踪 67P/丘留莫夫-格拉西缅科彗星，全程 10 年、飞行约 79 亿公里。',
      fact: '2014 年菲莱着陆器首次在彗星表面软着陆，虽然弹跳了两次，仍传回了地表图像。'
    },
    {
      id: 'apollo11', name: '阿波罗 11 号', en: 'Apollo 11', date: '1969-07-16', year: 1969,
      agency: 'NASA', targets: ['月球'], status: '任务完成（1969）', distance: '月球', photo: 'human-apollo11',
      desc: '人类第一次载人登月，阿姆斯特朗与奥尔德林在静海行走 2 小时 31 分。',
      fact: '制导计算机内存只有 4 KB，着陆前 30 秒还报警了 1202 程序错误。'
    },
    {
      id: 'iss', name: '国际空间站', en: 'ISS', date: '1998-11-20', year: 1998,
      agency: '多国', targets: ['近地轨道'], status: '运行中', distance: '400 km 轨道', photo: 'human-iss',
      desc: '人类最大的人造轨道设施，自 2000 年起持续有人驻留，已完成 4,000 多项实验。',
      fact: '它每天绕地球约 16 圈，宇航员一天能看到 16 次日出。'
    },
    {
      id: 'landsat', name: '陆地卫星计划', en: 'Landsat', date: '1972-07-23', year: 1972,
      agency: 'NASA / USGS', targets: ['地球'], status: '运行中（Landsat 9）', distance: '705 km 太阳同步轨道', photo: null,
      desc: '连续 50 多年记录地球表面变化，森林砍伐、冰川退缩、城市扩张都可以直接对比。',
      fact: '它的数据全部免费公开，是地球科学最长的连续观测档案。'
    }
  ];

  /* ---------------- 星系 ---------------- */
  D.galaxies = [
    {
      id: 'whirlpool', name: '涡旋星系 M51', en: 'Whirlpool Galaxy', type: 'spiral',
      photo: 'galaxy-whirlpool', distanceLy: '2,300 万光年', diameterLy: '7.6 万光年',
      stars: '千亿级（估算）',
      desc: '正对地球的经典螺旋星系，两条旋臂清晰可见。2020 年观察到大质量恒星在旋臂中被"压缩"形成。'
    },
    {
      id: 'andromeda', name: '仙女座星系 M31', en: 'Andromeda', type: 'spiral',
      photo: 'galaxy-andromeda', distanceLy: '254 万光年', diameterLy: '22 万光年',
      stars: '万亿级（估算）',
      desc: '离银河系最近的大型螺旋星系，本星系群质量最大的成员，约 40 亿年后将与银河系并合。'
    },
    {
      id: 'sombrero', name: '草帽星系 M104', en: 'Sombrero', type: 'spiral',
      photo: 'galaxy-sombrero', distanceLy: '3,100 万光年', diameterLy: '5 万光年',
      stars: '千亿级（估算）',
      desc: '侧向对着我们的螺旋星系，中央隆起与尘埃带让它的轮廓像一顶墨西哥草帽。'
    },
    {
      id: 'barred', name: '棒旋星系 NGC 1300', en: 'Barred Spiral', type: 'spiral',
      photo: 'galaxy-barred', distanceLy: '6,100 万光年', diameterLy: '11 万光年',
      stars: '千亿级（估算）',
      desc: '中央有笔直棒状结构的螺旋星系，棒结构把气体输送到核心，驱动中心黑洞增长。'
    },
    {
      id: 'antennae', name: '触角星系 NGC 4038/39', en: 'Antennae Galaxies', type: 'irregular',
      photo: 'galaxy-antennae', distanceLy: '4,500 万光年', diameterLy: '50 万光年（含潮汐尾）',
      stars: '千亿级（两星系合计，估算）',
      desc: '两个正在碰撞的星系，被潮汐力甩出的恒星与气体形成两根巨大的"触角"，星系动物园里的不规则典型。'
    },
    {
      id: 'lmc', name: '大麦哲伦云', en: 'Large Magellanic Cloud', type: 'irregular',
      photo: 'galaxy-lmc', distanceLy: '16.3 万光年', diameterLy: '3.2 万光年',
      stars: '百亿级（估算）',
      desc: '银河系的不规则伴星系，1987 年这里的超新星 1987A 是近 400 年来最近的一次超新星爆发。'
    },
    {
      id: 'cartwheel', name: '车轮星系', en: 'Cartwheel Galaxy', type: 'irregular',
      photo: 'galaxy-cartwheel', distanceLy: '5 亿光年', diameterLy: '15 万光年',
      stars: '千亿级（估算）',
      desc: '一个小星系垂直穿过另一个星系后形成的环状结构，外环的恒星形成被激波点燃。'
    },
    {
      id: 'deepfield', name: '哈勃超深场', en: 'Hubble Ultra Deep Field', type: 'deep',
      photo: 'galaxy-deepfield', distanceLy: '最远约 132 亿光年', diameterLy: '约 2.4 角分',
      stars: '画面内约 1 万个星系',
      desc: '对着一小片看似空白的天空累积曝光 11.3 天，拍到约 1 万颗星系，每一颗都是一个世界。'
    },
    {
      id: 'm87', name: 'M87 椭圆星系', en: 'Messier 87', type: 'elliptical',
      photo: '', distanceLy: '5,350 万光年', diameterLy: '约 13 万光年',
      stars: '万亿级（估算）',
      desc: '室女座星系团中心的超大质量椭圆星系，几乎不含冷气体与旋臂，恒星沿着随机轨道绕行；中心黑洞 M87* 于 2019 年被事件视界望远镜拍到。'
    }
  ];

  /* ---------------- 致密天体 / 深空概念 ---------------- */
  D.deepObjects = [
    {
      id: 'blackhole', name: '黑洞', en: 'Black Hole', kind: 'compact',
      photo: 'bh-concept',
      stats: [
        { label: '事件视界', value: 'rs = 2GM/c²' },
        { label: '银河系中心黑洞', value: '4.3 百万倍太阳质量' },
        { label: 'M87* 质量', value: '65 亿倍太阳质量' }
      ],
      desc: '引力强到连光都逃不出的天体。2019 年事件视界望远镜拍到 M87* 的阴影，2022 年拍到银心 Sgr A*。'
    },
    {
      id: 'neutronstar', name: '中子星', en: 'Neutron Star', kind: 'compact',
      photo: 'neutronstar-concept',
      stats: [
        { label: '典型质量', value: '1.4 倍太阳质量' },
        { label: '半径', value: '约 12 公里' },
        { label: '密度', value: '约 10¹⁷ kg/m³' }
      ],
      desc: '大质量恒星坍缩后留下的致密核心，一茶匙物质约重 10 亿吨。旋转的中子星发出周期性脉冲，被称为脉冲星。'
    },
    {
      id: 'whitedwarf', name: '白矮星', en: 'White Dwarf', kind: 'compact',
      photo: 'nebula-ring',
      stats: [
        { label: '典型质量', value: '0.6 倍太阳质量' },
        { label: '半径', value: '接近地球' },
        { label: '密度', value: '约 10⁹ kg/m³' }
      ],
      desc: '类太阳恒星燃尽后的余烬，靠电子简并压支撑。质量超过 1.44 倍太阳质量（钱德拉塞卡极限）就会继续坍缩。'
    },
    {
      id: 'quasar', name: '类星体', en: 'Quasar', kind: 'extreme',
      photo: 'deep-quasar',
      stats: [
        { label: '亮度', value: '可达银河系千倍' },
        { label: '典型距离', value: '数十亿光年' },
        { label: '能量来源', value: '超大质量黑洞吸积' }
      ],
      desc: '活跃星系核中最亮的一类，中心黑洞吞噬物质时释放的引力能，让它在整个可观测宇宙里都看得见。'
    },
    {
      id: 'gravwave', name: '引力波', en: 'Gravitational Waves', kind: 'extreme',
      photo: 'deep-gravwave',
      stats: [
        { label: '首次探测', value: 'GW150914（2015-09-14）' },
        { label: '并合产物', value: '62 倍太阳质量黑洞' },
        { label: '辐射能量', value: '约 3 倍太阳质量' }
      ],
      desc: '时空本身的涟漪。两个黑洞并合时，相当于把三个太阳的质量在 0.2 秒内变成引力波，穿过 13 亿光年到达地球。'
    },
    {
      id: 'darkmatter', name: '暗物质', en: 'Dark Matter', kind: 'extreme',
      photo: 'deep-darkmatter',
      stats: [
        { label: '占宇宙能量', value: '26.8%' },
        { label: '证据', value: '星系旋转、引力透镜' },
        { label: '性质', value: '不发光、不与光作用' }
      ],
      desc: '星系旋转得太快，仅靠可见物质的引力无法束缚住外围恒星，必须存在额外的质量。它的本质仍是未解问题。'
    },
    {
      id: 'darkenergy', name: '暗能量', en: 'Dark Energy', kind: 'extreme',
      photo: 'deep-darkenergy',
      stats: [
        { label: '占宇宙能量', value: '68.3%' },
        { label: '发现', value: '1998 年超新星观测' },
        { label: '效应', value: '加速宇宙膨胀' }
      ],
      desc: '1998 年两组天文学家通过 Ia 型超新星发现宇宙膨胀在加速，这一结果获得 2011 年诺贝尔物理学奖。'
    }
  ];

  /* ---------------- 航天里程碑 ---------------- */
  D.milestones = [
    { year: 1957, date: '1957-10-04', title: '斯普特尼克 1 号', en: 'Sputnik 1', agency: '苏联', photo: null,
      desc: '人类第一颗人造卫星，直径 58 厘米，发出 21 天的无线电"哔哔"声，开启太空时代。' },
    { year: 1961, date: '1961-04-12', title: '加加林进入太空', en: 'Vostok 1', agency: '苏联', photo: null,
      desc: '尤里·加加林乘东方 1 号绕地球一圈，成为第一位进入太空的人类，全程 108 分钟。' },
    { year: 1965, date: '1965-03-18', title: '首次太空行走', en: 'Voskhod 2', agency: '苏联', photo: null,
      desc: '列昂诺夫在舱外停留 12 分钟。返回时宇航服在真空中膨胀，他只能先放气才挤进舱门。' },
    { year: 1968, date: '1968-12-24', title: '阿波罗 8 号 · 地出', en: 'Apollo 8', agency: 'NASA', photo: 'human-earthrise-1968',
      desc: '人类第一次绕月飞行，拍下"地出"照片，地球第一次以一颗星球的样子出现在人类视野里。' },
    { year: 1969, date: '1969-07-20', title: '阿波罗 11 号登月', en: 'Apollo 11', agency: 'NASA', photo: 'human-apollo11',
      desc: '阿姆斯特朗与奥尔德林在静海着陆，人类第一次踏上另一个天体，带回 21.5 千克月岩。' },
    { year: 1971, date: '1971-04-19', title: '礼炮 1 号', en: 'Salyut 1', agency: '苏联', photo: null,
      desc: '人类第一座空间站，在轨 175 天，验证了长期在轨生活与科学实验的可行性。' },
    { year: 1977, date: '1977-09-05', title: '旅行者 1 号发射', en: 'Voyager 1', agency: 'NASA', photo: 'probe-voyager',
      desc: '带着金唱片出发，飞掠木星与土星后飞出太阳系，如今仍在星际空间发回数据。' },
    { year: 1981, date: '1981-04-12', title: '航天飞机首飞', en: 'STS-1 Columbia', agency: 'NASA', photo: null,
      desc: '哥伦比亚号完成 54 小时试飞，航天飞机在此后 30 年执行了 135 次任务。' },
    { year: 1990, date: '1990-04-24', title: '哈勃空间望远镜', en: 'Hubble', agency: 'NASA / ESA', photo: 'human-hubble',
      desc: '人类第一台大型空间望远镜，此后 30 多年拍摄了超过 150 万张图像，改写了星系演化与宇宙年龄的认知。' },
    { year: 1998, date: '1998-11-20', title: '国际空间站开建', en: 'ISS', agency: '多国', photo: 'human-iss',
      desc: '首个舱段"曙光号"入轨，此后 40 多次组装任务建成 420 吨的轨道实验室。' },
    { year: 2003, date: '2003-10-15', title: '神舟五号', en: 'Shenzhou 5', agency: 'CNSA', photo: null,
      desc: '杨利伟乘神舟五号绕地球 14 圈，中国成为第三个独立掌握载人航天能力的国家。' },
    { year: 2012, date: '2012-08-06', title: '好奇号登陆火星', en: 'Curiosity', agency: 'NASA', photo: null,
      desc: '"恐怖七分钟"之后，空中吊车把一吨重的火星车放到盖尔环形山；它随后发现了火星曾经宜居的证据。' },
    { year: 2015, date: '2015-07-14', title: '新视野号飞掠冥王星', en: 'New Horizons', agency: 'NASA', photo: 'probe-newhorizons',
      desc: '人类第一次看清冥王星：氮冰平原、水冰山脉与 3,500 公里宽的"心形"区域。' },
    { year: 2015, date: '2015-09-14', title: '首次探测到引力波', en: 'GW150914', agency: 'LIGO', photo: 'deep-gravwave',
      desc: '两个黑洞并合产生的时空涟漪穿过 13 亿光年抵达地球，验证了爱因斯坦 100 年前的预言。' },
    { year: 2020, date: '2020-12-17', title: '嫦娥五号采样返回', en: "Chang'e 5", agency: 'CNSA', photo: null,
      desc: '带回 1,731 克月壤，是人类 44 年后再次取回月球样品。' },
    { year: 2021, date: '2021-02-18', title: '毅力号着陆火星', en: 'Perseverance', agency: 'NASA', photo: 'rover-perseverance',
      desc: '在杰泽罗环形山古三角洲采集岩芯，随行的机智号直升机完成了 72 次地外飞行。' },
    { year: 2021, date: '2021-04-29', title: '天和核心舱', en: 'Tianhe', agency: 'CNSA', photo: null,
      desc: '中国空间站首个舱段入轨，此后问天、梦天实验舱对接，形成 T 字构型。' },
    { year: 2021, date: '2021-12-25', title: '詹姆斯·韦伯望远镜发射', en: 'JWST', agency: 'NASA / ESA / CSA', photo: 'human-jwst',
      desc: '6.5 米红外望远镜进入日地 L2 点，首次捕捉到宇宙诞生后约 3 亿年的星系。' },
    { year: 2022, date: '2022-11-16', title: '阿尔忒弥斯 1 号', en: 'Artemis I', agency: 'NASA', photo: null,
      desc: '无人试飞绕月并返回，为载人重返月球验证了 SLS 火箭与猎户座飞船。' },
    { year: 2023, date: '2023-04-20', title: '星舰首次试飞', en: 'Starship IFT-1', agency: 'SpaceX', photo: 'rocket-starship',
      desc: '人类最大的运载火箭首次升空，虽然 4 分钟后解体，但验证了 33 台发动机并联的可行性。' },
    { year: 2024, date: '2024-06-25', title: '嫦娥六号月背着陆采样', en: "Chang'e 6", agency: 'CNSA', photo: null,
      desc: '人类首次从月球背面取回样品，共 1,935.3 克，为研究月球正面与背面的差异提供关键材料。' },
    { year: 2024, date: '2024-10-13', title: '星舰回收助推器', en: 'Starship IFT-5', agency: 'SpaceX', photo: null,
      desc: '发射塔的"筷子"机械臂第一次在空中夹住返回的超重型助推器，可重复使用进入新阶段。' }
  ];

  /* ---------------- 运载载具 / 观测设备 ---------------- */
  D.vehicles = [
    {
      id: 'starship', name: '星舰', en: 'Starship / Super Heavy', kind: '火箭', country: '美国 · SpaceX',
      heightM: 121, diameterM: 9, leoKg: 150000, firstFlight: '2023-04-20', photo: 'veh-starship',
      photoCap: '星舰鼻锥段 · 肯尼迪航天中心总装厂房 · 2026-10-13', photoCredit: 'NASA',
      desc: '两级全部可重复使用，目标是把 100 吨以上货物送到近地轨道。2024 年首次回收超重型助推器。'
    },
    {
      id: 'sls', name: '太空发射系统', en: 'SLS Block 1', kind: '火箭', country: '美国 · NASA',
      heightM: 98, diameterM: 8.4, leoKg: 95000, firstFlight: '2022-11-16', photo: 'veh-sls',
      photoCap: '阿尔忒弥斯 1 号夜间发射 · 肯尼迪航天中心 39B · 2022-11-16', photoCredit: 'NASA',
      desc: 'NASA 为阿尔忒弥斯计划研制的重型火箭，地月转移轨道运力 27 吨，2022 年首飞成功。'
    },
    {
      id: 'saturn5', name: '土星五号', en: 'Saturn V', kind: '历史火箭', country: '美国 · NASA',
      heightM: 110.6, diameterM: 10.1, leoKg: 140000, firstFlight: '1967-11-09', photo: 'veh-saturn5',
      photoCap: '阿波罗 11 号升空 · 肯尼迪航天中心 39A 塔架相机拍摄 · 1969-07-16', photoCredit: 'NASA',
      desc: '阿波罗登月计划使用的超重型火箭，13 次发射全部成功，把 24 名宇航员送往月球方向。'
    },
    {
      id: 'falconheavy', name: '猎鹰重型', en: 'Falcon Heavy', kind: '火箭', country: '美国 · SpaceX',
      heightM: 70, diameterM: 3.7, leoKg: 63800, firstFlight: '2018-02-06', photo: 'veh-falconheavy',
      photoCap: '猎鹰重型首飞爬升 · 肯尼迪航天中心 39A · 2018-02-06', photoCredit: 'NASA',
      desc: '由三枚猎鹰 9 号芯级并联，首飞把一辆跑车送上日心轨道。目前仍是现役运力最大的可复用火箭之一。'
    },
    {
      id: 'longmarch5', name: '长征五号', en: 'Long March 5', kind: '火箭', country: '中国 · CNSA',
      heightM: 57, diameterM: 5, leoKg: 25000, firstFlight: '2016-11-03', photo: 'veh-longmarch5',
      photoCap: '天问一号发射升空 · 文昌航天发射场 · 2020-07-23', photoCredit: '中新网 / China News Service（CC BY 4.0）',
      desc: '中国最大的现役运载火箭，近地轨道运力 25 吨，嫦娥五号、天问一号都由它送入太空。'
    },
    {
      id: 'longmarch9', name: '长征九号', en: 'Long March 9', kind: '在研火箭', country: '中国 · CNSA',
      heightM: 110, diameterM: 10, leoKg: 150000, firstFlight: '计划 2030 年代', photo: 'veh-longmarch9',
      photoCap: '长征九号 1:50 展示模型 · 2022 珠海航展 · 尚未首飞', photoCredit: '中国航天科技集团展品；Shujianyang 摄（CC0）',
      desc: '面向载人登月与深空探测的超重型火箭，设计近地轨道运力 150 吨，可重复使用方案仍在迭代。'
    },
    {
      id: 'ariane6', name: '阿丽亚娜 6 号', en: 'Ariane 6', kind: '火箭', country: '欧洲 · ESA',
      heightM: 63, diameterM: 5.4, leoKg: 21650, firstFlight: '2024-07-09', photo: 'veh-ariane6',
      photoCap: '阿丽亚娜 6 号首飞离台 · 法属圭亚那库鲁 · 2024-07-09', photoCredit: 'ESA - S. Corvaja',
      desc: '欧洲新一代中型火箭，2024 年首飞，用于接替阿丽亚娜 5 号。'
    },
    {
      id: 'electron', name: '电子号', en: 'Electron', kind: '火箭', country: '新西兰 / 美国 · Rocket Lab',
      heightM: 18, diameterM: 1.2, leoKg: 300, firstFlight: '2017-05-25', photo: 'veh-electron',
      photoCap: '电子号发射 TROPICS 任务 · 新西兰马希亚半岛 · 2023-05-07', photoCredit: 'NASA',
      desc: '小型运载火箭，专攻小卫星与立方星市场，回收复用版本已进行海上打捞试验。'
    },
    {
      id: 'jwst', name: '詹姆斯·韦伯空间望远镜', en: 'JWST', kind: '望远镜', country: 'NASA / ESA / CSA',
      heightM: 20, diameterM: 6.5, leoKg: null, firstFlight: '2021-12-25', photo: 'human-jwst',
      photoCap: '韦布望远镜 18 块主镜 · 戈达德洁净室观测窗 · 2017', photoCredit: 'NASA',
      desc: '主镜口径 6.5 米，工作在日地 L2 点，用红外波段观测宇宙最早期的星系与系外行星大气。'
    },
    {
      id: 'hubble', name: '哈勃空间望远镜', en: 'Hubble', kind: '望远镜', country: 'NASA / ESA',
      heightM: 13.2, diameterM: 2.4, leoKg: null, firstFlight: '1990-04-24', photo: 'human-hubble',
      photoCap: '哈勃空间望远镜 · 亚特兰蒂斯号机械臂捕获后 · 2009', photoCredit: 'NASA',
      desc: '近地轨道上的光学望远镜，30 多年来完成了超过 150 万次观测，是史上最多产的科学仪器之一。'
    },
    {
      id: 'iss', name: '国际空间站', en: 'ISS', kind: '空间站', country: '多国',
      heightM: 109, diameterM: 73, leoKg: 419700, firstFlight: '1998-11-20', photo: 'veh-iss',
      photoCap: '国际空间站完整构型 · 乘员 3 号龙飞船飞掠拍摄 · 2021-11-08', photoCredit: 'NASA',
      desc: '人类最大的在轨结构，翼展 109 米，质量约 420 吨，由 15 个国家合作建造。'
    },
    {
      id: 'tiangong', name: '中国空间站', en: 'Tiangong', kind: '空间站', country: '中国 · CNSA',
      heightM: 55, diameterM: 39, leoKg: 100000, firstFlight: '2021-04-29', photo: 'veh-tiangong',
      photoCap: '中国空间站全貌 · 神舟十六号乘组返回前绕飞拍摄 · 2023-11', photoCredit: '中国载人航天工程办公室（新华社发布）',
      desc: '由天和核心舱与问天、梦天实验舱组成的 T 字构型，2022 年完成在轨建造。'
    }
  ];

  /* ---------------- 未来计划 ---------------- */
  D.future = [
    {
      id: 'artemis', name: '重返月球', en: 'Artemis', horizon: '2020 年代 — 2030 年代', agency: 'NASA / 国际伙伴', photo: 'human-jwst',
      photoCap: '詹姆斯·韦布空间望远镜 · 戈达德总装 · NASA',
      desc: '在月球南极建立可持续存在，利用永久阴影区的水冰，作为前往火星的试验场。',
      items: ['阿尔忒弥斯 2 号：载人绕月', '阿尔忒弥斯 3 号：首次载人登月（计划）', '月球门户空间站：绕月轨道前哨']
    },
    {
      id: 'marscrew', name: '载人登陆火星', en: 'Crewed Mars', horizon: '2030 年代 — 2040 年代', agency: 'NASA / SpaceX / 多国', photo: 'future-mars',
      photoCap: '火星基地概念图 · NASA',
      desc: '单程约 6–9 个月，宇航员要在辐射与失重中生存；火星表面重力只有地球的 38%，返回需要就地制造推进剂。',
      items: ['火星转移窗口每 26 个月一次', '核热推进与在轨加注是关键', '地表栖息地与辐射屏蔽']
    },
    {
      id: 'moonbase', name: '国际月球科研站', en: 'ILRS', horizon: '2035（计划）', agency: '中国 / 俄罗斯 / 多国', photo: 'rocket-starship',
      photoCap: '星舰 HLS 月面概念图 · NASA',
      desc: '在月球南极建设长期科研站，利用太阳能与月壤 3D 打印建材，开展月面天文观测与资源利用试验。',
      items: ['嫦娥七号：2026 年勘察南极', '嫦娥八号：2028 年资源试验', '月壤制氧与建材打印']
    },
    {
      id: 'exoplanet', name: '寻找另一个地球', en: 'Exoplanet Exploration', horizon: '2027 — 2040 年代', agency: 'NASA / ESA / 全球', photo: 'future-exoplanet',
      photoCap: '行星形成概念图 · NASA',
      desc: '已经确认超过 5,900 颗系外行星。下一步是直接成像一颗类地行星，并在它的大气里寻找氧气、水汽与生物标志物。',
      items: ['罗曼空间望远镜：2027 年发射（计划）', '极大望远镜 ELT：39 米主镜', 'LIFE / HabEx：寻找系外生命']
    },
    {
      id: 'tianwen3', name: '火星采样返回', en: 'Mars Sample Return', horizon: '2028 年发射（计划）', agency: 'CNSA', photo: 'rover-perseverance',
      photoCap: '毅力号火星车自拍 · 杰泽罗环形山 · NASA',
      desc: '把火星表面样品带回地球，是寻找古代生命证据最直接的方法。毅力号的样本罐正等待被取走。',
      items: ['天问三号：2028 年发射', 'NASA-ESA 方案正在重新设计', '样品在地球实验室里可反复分析']
    }
  ];

  /* ---------------- 观测数据来源 ---------------- */
  D.sources = [
    { label: 'NASA Planetary Fact Sheet', org: 'NASA Goddard', license: 'Public Domain' },
    { label: 'Planck 2018 宇宙学参数', org: 'ESA / Planck Collaboration', license: 'CC BY-SA' },
    { label: 'NASA / ESA 图像库', org: 'NASA images, ESA Hubble/Webb', license: 'Public Domain' },
    { label: 'Solar System Scope 行星贴图（2048px）', org: 'Solar System Scope', license: 'CC BY 4.0' },
    { label: 'IAU 行星定义与卫星命名（2025）', org: 'IAU', license: 'CC BY 4.0' },
    { label: 'LIGO / Virgo 引力波观测', org: 'LIGO Scientific Collaboration', license: 'CC BY 4.0' },
    { label: '拉尼亚凯亚超星系团（Tully et al. 2014, Nature）', org: 'University of Hawaii', license: '数据引用' },
    { label: '卫星与冥王星全球地图（10 颗，1024×512）', org: 'NASA / JPL / USGS / SwRI / Björn Jónsson / P. Stooke', license: '公有领域 / CC0 1.0 / 署名使用' }
  ];

  D.planetById = function (id) {
    const all = D.planets.concat(D.dwarfPlanets);
    for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  };

  D.moonById = function (id) {
    for (let i = 0; i < D.moons.length; i++) if (D.moons[i].id === id) return D.moons[i];
    return null;
  };

  D.moonsByParent = function (parent) {
    const out = [];
    for (let i = 0; i < D.moons.length; i++) {
      if (D.moons[i].parent === parent) out.push(D.moons[i]);
    }
    return out;
  };

  /* 太阳 / 行星 / 矮行星 / 卫星统一查询，供 02 章档案与标签使用 */
  D.bodyById = function (id) {
    if (!id) return null;
    if (id === 'sun') return D.sun;
    const p = D.planetById(id);
    if (p) return p;
    return D.moonById(id);
  };

  D.missionById = function (id) {
    for (let i = 0; i < D.missions.length; i++) if (D.missions[i].id === id) return D.missions[i];
    return null;
  };

  D.galaxyById = function (id) {
    for (let i = 0; i < D.galaxies.length; i++) if (D.galaxies[i].id === id) return D.galaxies[i];
    return null;
  };

  D.deepById = function (id) {
    for (let i = 0; i < D.deepObjects.length; i++) if (D.deepObjects[i].id === id) return D.deepObjects[i];
    return null;
  };

  COSMOS.DATA = D;
})(window.COSMOS = window.COSMOS || {});
