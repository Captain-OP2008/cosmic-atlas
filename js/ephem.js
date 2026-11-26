/*!
 * js/ephem.js — COSMOS ATLAS 星历与天象库 v1.0
 * ------------------------------------------------------------------
 * 经典脚本（IIFE），挂载 window.COSMOS.ephem。
 * 零依赖：无 DOM / THREE / 网络 / ESM。
 *
 * 坐标约定
 *   · 黄道坐标：J2000 黄道，+x 指向春分点，+z 指向黄道北。
 *   · 距离单位 AU；角度单位度（deg）；时间单位儒略日（JD，UTC 近似 TT）。
 *   · 行星/月球位置为几何位置（行星为日心，太阳/月球为地心）。
 *   · 赤道坐标 ra/dec 的单位也是「度」（0–360 / −90–90），不做小时换算。
 *   · eqToAltAz 支持两种形式：(raDeg, decDeg, jd, latDeg, lonDeg) 与
 *     ({ra, dec}, latDeg, lonDeg, jd)；az 以北为 0°、向东为 90°。
 *
 * 主要算法来源
 *   · 行星：JPL "Approximate Positions of the Major Planets"
 *     Table 1（1800–2050，开普勒根数 + 每世纪变率）、
 *     Table 2（木/土/天/海 M 的附加项 b,c,s,f）；Pluto 用 Meeus 平均根数。
 *   · 月球：Meeus, Astronomical Algorithms, 2nd ed., ch.47（60+60+60 周期项）。
 *   · 二分二至：太阳视黄经（含岁差/章动/光行差）过 0/90/180/270。
 *   · 日月食：新月/满月时刻 + 月影轴/地影轴与地球/月球距离 + 半径判据。
 *   · 卫星：JPL Planetary Satellite Mean Elements（火星/木星）与
 *     已知恒星周期（土/天/冥）的平均轨道根数，简化到黄道面内。
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var COSMOS = root.COSMOS = root.COSMOS || {};

  /* ================================================================
   * 0. 常量与小工具
   * ================================================================ */
  var JD_UNIX_EPOCH = 2440587.5;          // 1970-01-01T00:00:00Z 的 JD
  var JD_J2000 = 2451545.0;               // 2000-01-01T12:00:00Z
  var DAY_MS = 86400000;
  var AU_KM = 149597870.7;                // 1 AU 的公里数（IAU 2012）
  var R_DEG = Math.PI / 180;
  var ARCSEC = 1 / 3600;                  // 角秒 → 度
  var GM_SUN = 0.0002959122082855911;     // 太阳引力常数（AU^3 / day^2）
  var MASS_RATIO = 1 / 81.30056;          // 月球 / 地球质量比
  var MOON_FRAC = MASS_RATIO / (1 + MASS_RATIO); // 地月质心 → 地心修正因子
  var R_EARTH_KM = 6378.137;
  var R_SUN_KM = 696000;
  var R_MOON_KM = 1737.4;
  var SYNODIC_MONTH = 29.530588853;       // 朔望月（日）

  // 行星表：JPL Table 1（J2000 黄道，1800–2050）。
  // 每项 = [a(AU), e, I(deg), L(deg), 近日点经度 ϖ(deg), 升交点经度 Ω(deg)]，
  // 数值形如 [J2000 值, 每儒略世纪变率]。
  var PLANET_TABLE = {
    mercury: {
      a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906],
      i: [7.00497902, -0.00594749], L: [252.25032350, 149472.67411175],
      w: [77.45779628, 0.16047689], o: [48.33076593, -0.12534081],
      from: 1800, to: 2050
    },
    venus: {
      a: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107],
      i: [3.39467605, -0.00078890], L: [181.97909950, 58517.81538729],
      w: [131.60246718, 0.00268329], o: [76.67984255, -0.27769418],
      from: 1800, to: 2050
    },
    earth: {  // 地月质心（EM Barycenter）
      a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392],
      i: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981],
      w: [102.93768193, 0.32327364], o: [0.0, 0.0],
      from: 1800, to: 2050
    },
    mars: {
      a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882],
      i: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499],
      w: [-23.94362959, 0.44441088], o: [49.55953891, -0.29257343],
      from: 1800, to: 2050
    },
    jupiter: {
      a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253],
      i: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775],
      w: [14.72847983, 0.21252668], o: [100.47390909, 0.20469106],
      b: -0.00012452, c: 0.06064060, s: -0.35635438, f: 38.35125,
      from: 1800, to: 2050
    },
    saturn: {
      a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991],
      i: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201],
      w: [92.59887831, -0.41897216], o: [113.66242448, -0.28867794],
      b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125,
      from: 1800, to: 2050
    },
    uranus: {
      a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397],
      i: [0.77263783, -0.00242939], L: [313.23810451, 428.48202785],
      w: [170.95427630, 0.40805281], o: [74.01692503, 0.04240589],
      b: 0.00058331, c: -0.97731848, s: 0.17689245, f: 7.67025,
      from: 1800, to: 2050
    },
    neptune: {
      a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105],
      i: [1.77004347, 0.00035372], L: [-55.12002969, 218.45945325],
      w: [44.96476227, -0.32241464], o: [131.78422574, -0.00508664],
      b: -0.00041348, c: 0.68346318, s: -0.10162547, f: 7.67025,
      from: 1800, to: 2050
    },
    pluto: {  // Meeus 平均根数（1800–2100 近似可用）
      a: [39.48211675, -0.00031596], e: [0.24882730, 0.00005170],
      i: [17.14001206, 0.00004818], L: [238.92903833, 145.20780515],
      w: [224.06891629, -0.04062942], o: [110.30393684, -0.01183482],
      from: 1800, to: 2100
    }
  };

  var PLANET_IDS = ['mercury', 'venus', 'earth', 'mars', 'jupiter',
    'saturn', 'uranus', 'neptune', 'pluto'];
  var OUTER_IDS = ['mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  var ELONG_IDS = ['mercury', 'venus'];

  // 卫星平均根数（J2000 黄道面内简化；a: km，P: 日，负值=逆行，lam0: J2000 平黄经 deg）。
  // 火星/木星数据取 JPL Planetary Satellite Mean Elements（epoch 2000-01-01.5 TDB）；
  // 土卫/海卫/冥卫的 JPL 表行未取得，历元相位用均匀占位（见 artifacts/ephem/ 说明），
  // 轨道半径与恒星周期为实测值，位置误差不影响主功能（月相/日月食/行星事件）。
  var MOON_TABLE = {
    mars: {
      phobos: { a: 9400, e: 0.015, P: 0.31891023, M0: 189.6, lam0: 215.1 },
      deimos: { a: 23500, e: 0.000, P: 1.26341, M0: 205.0, lam0: 259.4 }
    },
    jupiter: {
      io: { a: 421800, e: 0.004, P: 1.76913779, M0: 330.9, lam0: 20.0 },
      europa: { a: 671100, e: 0.009, P: 3.55118104, M0: 345.4, lam0: 214.4 },
      ganymede: { a: 1070400, e: 0.001, P: 7.15455296, M0: 324.8, lam0: 221.6 },
      callisto: { a: 1882700, e: 0.007, P: 16.6890184, M0: 87.4, lam0: 80.3 }
    },
    saturn: {
      titan: { a: 1221870, e: 0.0288, P: 15.945421, M0: 0.0, lam0: 90.0 },
      enceladus: { a: 238040, e: 0.0047, P: 1.370218, M0: 0.0, lam0: 0.0 },
      rhea: { a: 527108, e: 0.0013, P: 4.518212, M0: 0.0, lam0: 210.0 }
    },
    neptune: {
      triton: { a: 354759, e: 0.000016, P: -5.876854, M0: 0.0, lam0: 45.0 }
    },
    pluto: {
      charon: { a: 19591.4, e: 0.0002, P: 6.387230, M0: 0.0, lam0: 120.0 }
    }
  };

  function rad(d) { return d * R_DEG; }
  function deg(r) { return r / R_DEG; }
  function sinD(d) { return Math.sin(d * R_DEG); }
  function cosD(d) { return Math.cos(d * R_DEG); }
  function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }
  function norm180(x) { x = norm360(x); return x > 180 ? x - 360 : x; }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function asinD(x) { return deg(Math.asin(clamp(x, -1, 1))); }
  function atan2D(y, x) { return deg(Math.atan2(y, x)); }
  function hypot3(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }
  function centuries(jd) { return (jd - JD_J2000) / 36525; }

  /* ================================================================
   * 1. 时间
   * ================================================================ */
  function jdFromMs(ms) {
    var t = (ms && typeof ms.getTime === 'function') ? ms.getTime() : Number(ms);
    if (!isFinite(t)) throw new Error('ephem.jdFromMs: ms 不是有效时间');
    return t / DAY_MS + JD_UNIX_EPOCH;
  }

  function msFromJd(jd) {
    var j = Number(jd);
    if (!isFinite(j)) throw new Error('ephem.msFromJd: jd 不是有效数值');
    return (j - JD_UNIX_EPOCH) * DAY_MS;
  }

  /* ================================================================
   * 2. 岁差、章动、黄赤交角、坐标转换、恒星时
   * ================================================================ */

  // 平黄赤交角（Meeus 22.2），度
  function meanObliquity(jd) {
    var t = centuries(jd);
    return 23.4392911 - 0.0130042 * t - 1.64e-7 * t * t + 5.04e-7 * t * t * t;
  }

  // 章动（Meeus 22.2 低精度级数，精度约 0.5″），返回 {dpsi, deps}，度
  function nutation(jd) {
    var t = centuries(jd);
    var om = 125.04452 - 1934.136261 * t + 0.0020708 * t * t + t * t * t / 450000;
    var Ls = 280.4665 + 36000.7698 * t;
    var Lm = 218.3165 + 481267.8813 * t;
    var dpsi = -17.20 * sinD(om) - 1.32 * sinD(2 * Ls) - 0.23 * sinD(2 * Lm) + 0.21 * sinD(2 * om);
    var deps = 9.20 * cosD(om) + 0.57 * cosD(2 * Ls) + 0.10 * cosD(2 * Lm) - 0.09 * cosD(2 * om);
    return { dpsi: dpsi * ARCSEC, deps: deps * ARCSEC };
  }

  // 从 J2000 平黄经到当日平黄经的岁差（黄经总岁差，Meeus 21.5），度
  function precessionLongitude(jd) {
    var t = centuries(jd);
    return (5029.0966 * t + 1.11113 * t * t - 0.000006 * t * t * t) * ARCSEC;
  }

  // 给定黄赤交角，把黄道坐标 (lon,lat,deg) 转赤道坐标 (ra,dec,deg)
  function eclToEqOblique(lonDeg, latDeg, epsDeg) {
    var l = rad(lonDeg), b = rad(latDeg), e = rad(epsDeg);
    var cb = Math.cos(b);
    var x = cb * Math.cos(l);
    var y = cb * Math.sin(l) * Math.cos(e) - Math.sin(b) * Math.sin(e);
    var z = cb * Math.sin(l) * Math.sin(e) + Math.sin(b) * Math.cos(e);
    return { ra: norm360(atan2D(y, x)), dec: asinD(z) };
  }

  // 黄道（当日黄道，含日期黄赤交角）→ 赤道
  function eclToEq(lonDeg, latDeg, jd) {
    return eclToEqOblique(Number(lonDeg), Number(latDeg), meanObliquity(jd));
  }

  // 赤道 → 黄道（当日平黄道），内部用
  function eqToEclOblique(raDeg, decDeg, epsDeg) {
    var a = rad(raDeg), d = rad(decDeg), e = rad(epsDeg);
    var cd = Math.cos(d);
    var x = cd * Math.cos(a);
    var y = cd * Math.sin(a) * Math.cos(e) + Math.sin(d) * Math.sin(e);
    var z = -cd * Math.sin(a) * Math.sin(e) + Math.sin(d) * Math.cos(e);
    return { lon: norm360(atan2D(y, x)), lat: asinD(z) };
  }

  // 格林尼治平恒星时（Meeus 12.4），度
  function gmst(jd) {
    var t = centuries(jd);
    return norm360(280.46061837 + 360.98564736629 * (jd - JD_J2000) +
      0.000387933 * t * t - t * t * t / 38710000);
  }

  /**
   * 赤道坐标 → 地平坐标（返回 {alt, az}，单位度；az 以北为 0°、向东为 90°）。
   * ra/dec 均为「度」，不做小时/度换算。
   * 支持两种调用形式（向后兼容）：
   *   eqToAltAz(raDeg, decDeg, jd, latDeg, lonDeg)                 // 推荐
   *   eqToAltAz({ ra: raDeg, dec: decDeg }, latDeg, lonDeg, jd)    // 契约 §3 的对象形式
   */
  function eqToAltAz(raDeg, decDeg, jd, latDeg, lonDeg) {
    var ra, dec, t, lat, lon;
    if (raDeg !== null && typeof raDeg === 'object') {
      ra = Number(raDeg.ra);
      dec = Number(raDeg.dec);
      lat = Number(decDeg);
      lon = Number(jd);
      t = Number(latDeg);
    } else {
      ra = Number(raDeg);
      dec = Number(decDeg);
      t = Number(jd);
      lat = Number(latDeg);
      lon = Number(lonDeg);
    }
    var lst = norm360(gmst(t) + lon);
    var H = rad(norm360(lst - ra));
    var phi = rad(lat);
    var decl = rad(dec);
    var sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    var alt = asinD(sinAlt);
    var az = norm360(atan2D(-Math.sin(H),
      Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.sin(phi) * Math.cos(H)));
    return { alt: alt, az: az };
  }

  /* ================================================================
   * 3. 行星：JPL 近似根数 + 开普勒方程
   * ================================================================ */

  // 解 E - e sin E = M（M 单位度），返回 E（弧度）
  function solveKepler(Mdeg, e) {
    var M = rad(norm180(Mdeg));
    var E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
    for (var i = 0; i < 15; i++) {
      var dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-13) break;
    }
    return E;
  }

  function jdBounds(year) {
    // 每年 1 月 1 日 0h UT 的 JD（足够用于近似范围标记）
    return 2451544.5 + (year - 2000) * 365.25;
  }

  function planet(id, jd) {
    var key = String(id || '').toLowerCase();
    var el = PLANET_TABLE[key];
    if (!el) throw new Error('ephem.planet: 未知天体 "' + id + '"');
    var j = Number(jd);
    if (!isFinite(j)) throw new Error('ephem.planet: jd 不是有效数值');

    var t = centuries(j);
    var a = el.a[0] + el.a[1] * t;
    var e = el.e[0] + el.e[1] * t;
    var inc = el.i[0] + el.i[1] * t;
    var L = el.L[0] + el.L[1] * t;
    var peri = el.w[0] + el.w[1] * t;      // ϖ 近日点经度
    var node = el.o[0] + el.o[1] * t;      // Ω 升交点经度

    var M = L - peri;
    if (el.b !== undefined) {              // 木/土/天/海附加项
      M += el.b * t * t + el.c * cosD(el.f * t) + el.s * sinD(el.f * t);
    }
    M = norm180(M);
    var w = peri - node;                   // ω 近日点角距

    var E = solveKepler(M, e);
    var cosE = Math.cos(E), sinE = Math.sin(E);
    var xp = a * (cosE - e);
    var yp = a * Math.sqrt(1 - e * e) * sinE;

    // 轨道面 → J2000 黄道
    var cw = cosD(w), sw = sinD(w), co = cosD(node), so = sinD(node);
    var ci = cosD(inc), si = sinD(inc);
    var Px = cw * co - sw * so * ci, Py = cw * so + sw * co * ci, Pz = sw * si;
    var Qx = -sw * co - cw * so * ci, Qy = -sw * so + cw * co * ci, Qz = cw * si;
    var x = Px * xp + Qx * yp;
    var y = Py * xp + Qy * yp;
    var z = Pz * xp + Qz * yp;
    var r = hypot3(x, y, z);

    // 速度（仅开普勒项，AU/day）
    var n = Math.sqrt(GM_SUN / (a * a * a));
    var dEdt = n / (1 - e * cosE);
    var vxp = -a * sinE * dEdt;
    var vyp = a * Math.sqrt(1 - e * e) * cosE * dEdt;
    var vx = Px * vxp + Qx * vyp;
    var vy = Py * vxp + Qy * vyp;
    var vz = Pz * vxp + Qz * vyp;

    var year = 2000 + (j - JD_J2000) / 365.25;
    return {
      x: x, y: y, z: z,
      vx: vx, vy: vy, vz: vz,
      r: r, lon: norm360(atan2D(y, x)), lat: asinD(z / r), au: r,
      approx: year < el.from || year > el.to
    };
  }

  /* ================================================================
   * 4. 月球：Meeus ch.47 完整周期项
   * ================================================================ */

  // Table 47.A：D, M, M', F, Σl(1e-6 deg), Σr(1e-3 km)
  var MOON_LR = [
    0, 0, 1, 0, 6288774, -20905355,
    2, 0, -1, 0, 1274027, -3699111,
    2, 0, 0, 0, 658314, -2955968,
    0, 0, 2, 0, 213618, -569925,
    0, 1, 0, 0, -185116, 48888,
    0, 0, 0, 2, -114332, -3149,
    2, 0, -2, 0, 58793, 246158,
    2, -1, -1, 0, 57066, -152138,
    2, 0, 1, 0, 53322, -170733,
    2, -1, 0, 0, 45758, -204586,
    0, 1, -1, 0, -40923, -129620,
    1, 0, 0, 0, -34720, 108743,
    0, 1, 1, 0, -30383, 104755,
    2, 0, 0, -2, 15327, 10321,
    0, 0, 1, 2, -12528, 0,
    0, 0, 1, -2, 10980, 79661,
    4, 0, -1, 0, 10675, -34782,
    0, 0, 3, 0, 10034, -23210,
    4, 0, -2, 0, 8548, -21636,
    2, 1, -1, 0, -7888, 24208,
    2, 1, 0, 0, -6766, 30824,
    1, 0, -1, 0, -5163, -8379,
    1, 1, 0, 0, 4987, -16675,
    2, -1, 1, 0, 4036, -12831,
    2, 0, 2, 0, 3994, -10445,
    4, 0, 0, 0, 3861, -11650,
    2, 0, -3, 0, 3665, 14403,
    0, 1, -2, 0, -2689, -7003,
    2, 0, -1, 2, -2602, 0,
    2, -1, -2, 0, 2390, 10056,
    1, 0, 1, 0, -2348, 6322,
    2, -2, 0, 0, 2236, -9884,
    0, 1, 2, 0, -2120, 5751,
    0, 2, 0, 0, -2069, 0,
    2, -2, -1, 0, 2048, -4950,
    2, 0, 1, -2, -1773, 4130,
    2, 0, 0, 2, -1595, 0,
    4, -1, -1, 0, 1215, -3958,
    0, 0, 2, 2, -1110, 0,
    3, 0, -1, 0, -892, 3258,
    2, 1, 1, 0, -810, 2616,
    4, -1, -2, 0, 759, -1897,
    0, 2, -1, 0, -713, -2117,
    2, 2, -1, 0, -700, 2354,
    2, 1, -2, 0, 691, 0,
    2, -1, 0, -2, 596, 0,
    4, 0, 1, 0, 549, -1423,
    0, 0, 4, 0, 537, -1117,
    4, -1, 0, 0, 520, -1571,
    1, 0, -2, 0, -487, -1739,
    2, 1, 0, -2, -399, 0,
    0, 0, 2, -2, -381, -4421,
    1, 1, 1, 0, 351, 0,
    3, 0, -2, 0, -340, 0,
    4, 0, -3, 0, 330, 0,
    2, -1, 2, 0, 327, 0,
    0, 2, 1, 0, -323, 1165,
    1, 1, -1, 0, 299, 0,
    2, 0, 3, 0, 294, 0,
    2, 0, -1, -2, 0, 8752
  ];

  // Table 47.B：D, M, M', F, Σb(1e-6 deg)
  var MOON_B = [
    0, 0, 0, 1, 5128122,
    0, 0, 1, 1, 280602,
    0, 0, 1, -1, 277693,
    2, 0, 0, -1, 173237,
    2, 0, -1, 1, 55413,
    2, 0, -1, -1, 46271,
    2, 0, 0, 1, 32573,
    0, 0, 2, 1, 17198,
    2, 0, 1, -1, 9266,
    0, 0, 2, -1, 8822,
    2, -1, 0, -1, 8216,
    2, 0, -2, -1, 4324,
    2, 0, 1, 1, 4200,
    2, 1, 0, -1, -3359,
    2, -1, -1, 1, 2463,
    2, -1, 0, 1, 2211,
    2, -1, -1, -1, 2065,
    0, 1, -1, -1, -1870,
    4, 0, -1, -1, 1828,
    0, 1, 0, 1, -1794,
    0, 0, 0, 3, -1749,
    0, 1, -1, 1, -1565,
    1, 0, 0, 1, -1491,
    0, 1, 1, 1, -1475,
    0, 1, 1, -1, -1410,
    0, 1, 0, -1, -1344,
    1, 0, 0, -1, -1335,
    0, 0, 3, 1, 1107,
    4, 0, 0, -1, 1021,
    4, 0, -1, 1, 833,
    0, 0, 1, -3, 777,
    4, 0, -2, 1, 671,
    2, 0, 0, -3, 607,
    2, 0, 2, -1, 596,
    2, -1, 1, -1, 491,
    2, 0, -2, 1, -451,
    0, 0, 3, -1, 439,
    2, 0, 2, 1, 422,
    2, 0, -3, -1, 421,
    2, 1, -1, 1, -366,
    2, 1, 0, 1, -351,
    4, 0, 0, 1, 331,
    2, -1, 1, 1, 315,
    2, -2, 0, -1, 302,
    0, 0, 1, 3, -283,
    2, 1, 1, -1, -229,
    1, 1, 0, -1, 223,
    1, 1, 0, 1, 223,
    0, 1, -2, -1, -220,
    2, 1, -1, -1, -220,
    1, 0, 1, 1, -185,
    2, -1, -2, -1, 181,
    0, 1, 2, 1, -177,
    4, 0, -2, -1, 176,
    4, -1, -1, -1, 166,
    1, 0, 1, -1, -164,
    4, 0, 1, -1, 132,
    1, 0, -1, -1, -119,
    4, -1, 0, -1, 115,
    2, -2, 0, 1, 107
  ];

  // 月球黄经/距离/黄纬（Meeus 47.1–47.5），返回 {lonDate, latDate, distKm, Lp, ...}
  function moonSeries(jd) {
    var t = centuries(jd);
    var Lp = norm360(218.3164477 + 481267.88123421 * t - 0.0015786 * t * t +
      t * t * t / 538841 - t * t * t * t / 65194000);
    var D = norm360(297.8501921 + 445267.1114034 * t - 0.0018819 * t * t +
      t * t * t / 545868 - t * t * t * t / 113065000);
    var M = norm360(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t +
      t * t * t / 24490000);
    var Mp = norm360(134.9633964 + 477198.8675055 * t + 0.0087414 * t * t +
      t * t * t / 69699 - t * t * t * t / 14712000);
    var F = norm360(93.2720950 + 483202.0175233 * t - 0.0036539 * t * t -
      t * t * t / 3526000 + t * t * t * t / 863310000);
    var A1 = norm360(119.75 + 131.849 * t);
    var A2 = norm360(53.09 + 479264.290 * t);
    var A3 = norm360(313.45 + 481266.484 * t);
    var E = 1 - 0.002516 * t - 0.0000074 * t * t;

    var sl = 0, sr = 0, i;
    for (i = 0; i < MOON_LR.length; i += 6) {
      var d = MOON_LR[i], m = MOON_LR[i + 1], mp = MOON_LR[i + 2], f = MOON_LR[i + 3];
      var ef = 1;
      if (m === 1 || m === -1) ef = E;
      else if (m === 2 || m === -2) ef = E * E;
      var arg = d * D + m * M + mp * Mp + f * F;
      sl += MOON_LR[i + 4] * ef * sinD(arg);
      sr += MOON_LR[i + 5] * ef * cosD(arg);
    }
    var sb = 0;
    for (i = 0; i < MOON_B.length; i += 5) {
      var d2 = MOON_B[i], m2 = MOON_B[i + 1], mp2 = MOON_B[i + 2], f2 = MOON_B[i + 3];
      var ef2 = 1;
      if (m2 === 1 || m2 === -1) ef2 = E;
      else if (m2 === 2 || m2 === -2) ef2 = E * E;
      sb += MOON_B[i + 4] * ef2 * sinD(d2 * D + m2 * M + mp2 * Mp + f2 * F);
    }

    // 金星/木星摄动附加项
    sl += 3958 * sinD(A1) + 1962 * sinD(Lp - F) + 318 * sinD(A2);
    sb += -2235 * sinD(Lp) + 382 * sinD(A3) + 175 * sinD(A1 - F) +
      175 * sinD(A1 + F) + 127 * sinD(Lp - Mp) - 115 * sinD(Lp + Mp);

    var lonDate = norm360(Lp + sl / 1e6);
    var latDate = sb / 1e6;
    var distKm = 385000.56 + sr / 1000;
    return { lonDate: lonDate, latDate: latDate, distKm: distKm };
  }

  // 月相名称（八相，按距角 7.5° 一档细分）
  function phaseNameFromElong(elongDeg) {
    var e = norm360(elongDeg);
    if (e < 3.75 || e >= 356.25) return 'new';
    if (e < 86.25) return 'waxingCrescent';
    if (e < 93.75) return 'firstQuarter';
    if (e < 176.25) return 'waxingGibbous';
    if (e < 183.75) return 'full';
    if (e < 266.25) return 'waningGibbous';
    if (e < 273.75) return 'lastQuarter';
    return 'waningCrescent';
  }

  // 月球地心位置（J2000 黄道，AU）——纯位置，供事件搜索高频调用
  function moonPosition(jd) {
    var j = Number(jd);
    if (!isFinite(j)) throw new Error('ephem.moonGeo: jd 不是有效数值');
    var s = moonSeries(j);
    var p = precessionLongitude(j);
    var lonJ = norm360(s.lonDate - p);
    var latJ = s.latDate;
    var rAU = s.distKm / AU_KM;
    return {
      x: rAU * cosD(latJ) * cosD(lonJ),
      y: rAU * cosD(latJ) * sinD(lonJ),
      z: rAU * sinD(latJ),
      lon: lonJ, lat: latJ,
      lonDate: norm360(s.lonDate), latDate: s.latDate,
      distKm: s.distKm, distAU: rAU
    };
  }

  // 月-日地心黄经差（J2000，0–360 度），用于朔望/月龄
  function moonSunElongAt(jd) {
    var s = moonSeries(jd);
    var e = planet('earth', jd);
    var moonLon = norm360(s.lonDate - precessionLongitude(jd));
    var sunLon = norm360(atan2D(-e.y, -e.x));
    return norm360(moonLon - sunLon);
  }

  // 月球地心位置（J2000 黄道，AU）+ 视赤道坐标 + 月相
  function moonGeo(jd) {
    var j = Number(jd);
    if (!isFinite(j)) throw new Error('ephem.moonGeo: jd 不是有效数值');
    var mp = moonPosition(j);
    var x = mp.x, y = mp.y, z = mp.z;

    // 视赤道坐标（含章动）
    var nut = nutation(j);
    var eps = meanObliquity(j) + nut.deps;
    var eq = eclToEqOblique(norm360(mp.lonDate + nut.dpsi), mp.latDate, eps);

    // 月相：用日心视角，以地月质心近似地球（相位角对 4700 km 不敏感）
    var emb = planet('earth', j);
    var sx = -emb.x, sy = -emb.y, sz = -emb.z;
    var mx = x, my = y, mz = z;
    var smx = sx - mx, smy = sy - my, smz = sz - mz;
    var smR = hypot3(smx, smy, smz);
    var cosPhase = clamp(-(smx * mx + smy * my + smz * mz) / (smR * mp.distAU), -1, 1);
    var phaseAngle = deg(Math.acos(cosPhase));       // 0=满月，180=新月
    var illum = (1 + cosPhase) / 2;

    var sunLon = norm360(atan2D(sy, sx));
    var elong = norm360(mp.lon - sunLon);             // 月-日地心黄经差（J2000）
    var waxing = elong < 180;

    // 月龄 = 距上一次新月的天数（先按平朔望月估计，再做 3 次牛顿修正）
    var rate = 360 / SYNODIC_MONTH;                   // deg/day
    var ageDays = elong / 360 * SYNODIC_MONTH;
    for (var k = 0; k < 3; k++) {
      var residual = norm180(moonSunElongAt(j - ageDays));
      ageDays += residual / rate;
      if (Math.abs(residual) < 0.002) break;
    }
    if (ageDays < 0) ageDays += SYNODIC_MONTH;
    if (ageDays >= SYNODIC_MONTH) ageDays -= SYNODIC_MONTH;

    return {
      x: x, y: y, z: z,
      lon: mp.lon, lat: mp.lat,
      lonDate: mp.lonDate, latDate: mp.latDate,
      distKm: mp.distKm, distAU: mp.distAU,
      ra: eq.ra, dec: eq.dec,
      phaseAngleDeg: phaseAngle,
      elongDeg: elong,
      illum: illum,
      ageDays: ageDays,
      waxing: waxing,
      phaseName: phaseNameFromElong(elong)
    };
  }

  /* ================================================================
   * 5. 地球、太阳、卫星
   * ================================================================ */

  // 同时求地月质心、地心、月球（避免重复计算）
  function earthMoon(jd) {
    var emb = planet('earth', jd);
    var moon = moonPosition(jd);
    var h = 0.02;
    // 月球速度由地心位置差分（Meeus 级数无解析速度）
    var mv = moonVelocity(moon, jd, h);
    var x = emb.x - MOON_FRAC * moon.x;
    var y = emb.y - MOON_FRAC * moon.y;
    var z = emb.z - MOON_FRAC * moon.z;
    var r = hypot3(x, y, z);
    return {
      emb: emb,
      moon: moon,
      earth: {
        x: x, y: y, z: z,
        vx: emb.vx - MOON_FRAC * mv.vx,
        vy: emb.vy - MOON_FRAC * mv.vy,
        vz: emb.vz - MOON_FRAC * mv.vz,
        r: r, lon: norm360(atan2D(y, x)), lat: asinD(z / r), au: r,
        approx: emb.approx
      }
    };
  }

  // 月球速度：对 J2000 位置做中心差分（AU/day）
  function moonVelocity(moon, jd, h) {
    var hh = h || 0.02;
    // 用月球黄经/黄纬/距离直接差分，避免递归调用 moonGeo
    var a = moonSeries(jd - hh), b = moonSeries(jd + hh);
    var p1 = precessionLongitude(jd - hh), p2 = precessionLongitude(jd + hh);
    function cart(sr, pr) {
      var lon = norm360(sr.lonDate - pr);
      var r = sr.distKm / AU_KM;
      return {
        x: r * cosD(sr.latDate) * cosD(lon),
        y: r * cosD(sr.latDate) * sinD(lon),
        z: r * sinD(sr.latDate)
      };
    }
    var c1 = cart(a, p1), c2 = cart(b, p2);
    return {
      vx: (c2.x - c1.x) / (2 * hh),
      vy: (c2.y - c1.y) / (2 * hh),
      vz: (c2.z - c1.z) / (2 * hh)
    };
  }

  function earth(jd) {
    return earthMoon(jd).earth;
  }

  // 太阳视黄经（当日平黄道，含岁差/章动/光行差），度
  function sunApparentLon(jd) {
    var em = earthMoon(jd);
    var e = em.earth;
    var lonJ = norm360(atan2D(-e.y, -e.x));
    var r = hypot3(e.x, e.y, e.z);
    var nut = nutation(jd);
    return norm360(lonJ + precessionLongitude(jd) + nut.dpsi - 20.4898 * ARCSEC / r);
  }

  function sunGeo(jd) {
    var em = earthMoon(jd);
    var e = em.earth;
    var x = -e.x, y = -e.y, z = -e.z;
    var r = hypot3(x, y, z);
    var lonJ = norm360(atan2D(y, x));
    var latJ = asinD(z / r);
    var nut = nutation(jd);
    var lonDate = norm360(lonJ + precessionLongitude(jd) + nut.dpsi - 20.4898 * ARCSEC / r);
    var eq = eclToEqOblique(lonDate, latJ, meanObliquity(jd) + nut.deps);
    return {
      x: x, y: y, z: z,
      ra: eq.ra, dec: eq.dec,
      lon: lonJ, lat: latJ,
      lonDate: lonDate,
      distAU: r, r: r,
      approx: e.approx
    };
  }

  function moonIds(planetId) {
    var key = String(planetId || '').toLowerCase();
    if (key === 'earth') return ['moon'];
    var fam = MOON_TABLE[key];
    return fam ? Object.keys(fam) : [];
  }

  // 卫星相对母行星的位置（J2000 黄道，AU）
  function moonRel(planetId, moonId, jd) {
    var pid = String(planetId || '').toLowerCase();
    var mid = String(moonId || '').toLowerCase();
    var j = Number(jd);
    if (!isFinite(j)) throw new Error('ephem.moonRel: jd 不是有效数值');
    if (pid === 'earth') {
      if (mid !== 'moon') throw new Error('ephem.moonRel: 地球只有 moon');
      var mg = moonGeo(j);
      return { x: mg.x, y: mg.y, z: mg.z, distKm: mg.distKm, jd: j };
    }
    var fam = MOON_TABLE[pid];
    if (!fam) throw new Error('ephem.moonRel: 未知母行星 "' + planetId + '"');
    var def = fam[mid];
    if (!def) throw new Error('ephem.moonRel: ' + pid + ' 没有卫星 "' + moonId + '"');
    var dt = j - JD_J2000;
    var n = 360 / def.P;                       // deg/day（P<0 表示逆行）
    var M0 = def.M0 || 0;
    var M = norm360(M0 + n * dt);              // 平近点角
    var Mrad = rad(M);
    var nu = M + 2 * def.e * deg(Math.sin(Mrad)) +
      1.25 * def.e * def.e * deg(Math.sin(2 * Mrad));
    var lam = norm360(def.lam0 + n * dt + (nu - M));
    var rKm = def.a * (1 - def.e * Math.cos(Mrad));
    var rAU = rKm / AU_KM;
    return {
      x: rAU * cosD(lam), y: rAU * sinD(lam), z: 0,
      distKm: rKm, lon: lam, jd: j
    };
  }

  function moonPhase(jd) {
    var m = moonGeo(jd);
    return {
      illum: m.illum,
      ageDays: m.ageDays,
      waxing: m.waxing,
      phaseName: m.phaseName,
      phaseAngleDeg: m.phaseAngleDeg
    };
  }

  /* ================================================================
   * 6. 天象搜索
   * ================================================================ */

  function stateAt(jd) {
    var em = earthMoon(jd);
    var e = em.earth, moon = em.moon;
    var sx = -e.x, sy = -e.y, sz = -e.z;
    var sunR = hypot3(sx, sy, sz);
    var sunLon = norm360(atan2D(sy, sx));
    var sunLonDate = sunApparentLon(jd);
    var planets = {};
    for (var i = 0; i < PLANET_IDS.length; i++) {
      var id = PLANET_IDS[i];
      var p = planet(id, jd);
      var gx = p.x - e.x, gy = p.y - e.y, gz = p.z - e.z;
      planets[id] = {
        x: gx, y: gy, z: gz,
        dist: hypot3(gx, gy, gz),
        lon: norm360(atan2D(gy, gx)),
        helio: p.r
      };
    }
    return {
      jd: jd, earth: e, moon: moon,
      sun: { x: sx, y: sy, z: sz, r: sunR, lon: sunLon },
      sunLonDate: sunLonDate,
      planets: planets,
      dLon: norm180(moon.lon - sunLon)
    };
  }

  // 二分/二至：在 [lo,hi] 内二分太阳视黄经过 target
  function refineSunLongitude(lo, hi, target) {
    var flo = norm180(sunApparentLon(lo) - target);
    for (var i = 0; i < 60 && hi - lo > 1e-7; i++) {
      var mid = 0.5 * (lo + hi);
      var fm = norm180(sunApparentLon(mid) - target);
      if ((flo < 0 && fm < 0) || (flo >= 0 && fm >= 0)) { lo = mid; flo = fm; }
      else { hi = mid; }
    }
    return 0.5 * (lo + hi);
  }

  function seasonEvent(jd, target) {
    var type = (target % 180 === 0) ? 'equinox' : 'solstice';
    var kind, season;
    if (type === 'equinox') {
      kind = (target === 0) ? 'march' : 'september';
      season = (target === 0) ? 'spring' : 'autumn';
    } else {
      kind = (target === 90) ? 'june' : 'december';
      season = (target === 90) ? 'summer' : 'winter';
    }
    return {
      jd: jd, type: type, body: 'sun', kind: kind,
      data: { lonDeg: target, season: season }
    };
  }

  // 日食几何（给定 jd），无食返回 null
  function solarEclipseGeometry(jd) {
    var st = stateAt(jd);
    var m = st.moon, s = st.sun;
    var sR = st.sun.r;
    var sx = s.x / sR, sy = s.y / sR, sz = s.z / sR;   // 太阳方向单位矢量
    var mDotS = m.x * sx + m.y * sy + m.z * sz;
    var mR = hypot3(m.x, m.y, m.z);
    var dAU2 = mR * mR - mDotS * mDotS;
    var dAU = Math.sqrt(Math.max(0, dAU2));
    var dKm = dAU * AU_KM;
    var xKm = mDotS * AU_KM;                            // 月心到基本面距离
    var sunMoonKm = hypot3(s.x - m.x, s.y - m.y, s.z - m.z) * AU_KM;
    var tanU = (R_SUN_KM - R_MOON_KM) / sunMoonKm;
    var tanP = (R_SUN_KM + R_MOON_KM) / sunMoonKm;
    var ru = R_MOON_KM - xKm * tanU;
    var rp = R_MOON_KM + xKm * tanP;
    if (dKm > R_EARTH_KM + rp) return null;

    // 最大食处的取点：地球表面最靠近影轴的点。
    // 影轴穿过地球（中心食）时取迎日侧交点；否则取地表到影轴的最近点。
    var pAU = R_EARTH_KM / AU_KM;
    var px, py, pz;
    if (dKm < R_EARTH_KM) {
      var tStarKm = mDotS * AU_KM;                        // 月心到影轴垂足
      var tSurfKm = tStarKm - Math.sqrt(R_EARTH_KM * R_EARTH_KM - dKm * dKm);
      px = m.x - (tSurfKm / AU_KM) * sx;
      py = m.y - (tSurfKm / AU_KM) * sy;
      pz = m.z - (tSurfKm / AU_KM) * sz;
    } else {
      px = pAU * (m.x - mDotS * sx) / dAU;
      py = pAU * (m.y - mDotS * sy) / dAU;
      pz = pAU * (m.z - mDotS * sz) / dAU;
    }

    // 表面点到日/月的角半径与角距
    var vmx = m.x - px, vmy = m.y - py, vmz = m.z - pz;
    var vMr = hypot3(vmx, vmy, vmz);
    var vsx = s.x - px, vsy = s.y - py, vsz = s.z - pz;
    var vSr = hypot3(vsx, vsy, vsz);
    var rhoM = deg(Math.asin(clamp(R_MOON_KM / (vMr * AU_KM), -1, 1)));
    var rhoS = deg(Math.asin(clamp(R_SUN_KM / (vSr * AU_KM), -1, 1)));
    var sep = deg(Math.acos(clamp((vmx * vsx + vmy * vsy + vmz * vsz) / (vMr * vSr), -1, 1)));
    // 食分：中心食取视半径比（total >1 / annular <1），偏食取太阳视直径被遮比例
    var magnitude;
    if (sep <= Math.abs(rhoS - rhoM)) magnitude = rhoM / rhoS;
    else magnitude = (rhoS + rhoM - sep) / (2 * rhoS);

    // 表面处的本影/半影半径（沿影轴到表面点的距离）
    var xSurfKm = (m.x - px) * sx + (m.y - py) * sy + (m.z - pz) * sz;
    var ruSurf = R_MOON_KM - xSurfKm * AU_KM * tanU;
    var central = dKm <= R_EARTH_KM;

    var kind;
    if (central) kind = (rhoM >= rhoS) ? 'total' : 'annular';
    else kind = 'partial';
    if (!central && magnitude <= 0) return null;

    return {
      jd: jd,
      type: 'solar-eclipse', body: 'sun', kind: kind,
      data: {
        magnitude: magnitude,
        central: central,
        axisDistEarthRadii: dKm / R_EARTH_KM,
        sunAngRadiusDeg: rhoS,
        moonAngRadiusDeg: rhoM,
        moonDistanceKm: mR * AU_KM,
        sunDistanceAU: sR,
        umbraRadiusKm: ruSurf,
        penumbraRadiusKm: rp
      }
    };
  }

  // 月食几何（给定 jd），无食返回 null
  function lunarEclipseGeometry(jd) {
    var st = stateAt(jd);
    var m = st.moon, s = st.sun;
    var sR = st.sun.r;
    var sx = s.x / sR, sy = s.y / sR, sz = s.z / sR;
    var mDotS = m.x * sx + m.y * sy + m.z * sz;
    var mR = hypot3(m.x, m.y, m.z);
    var dKm = Math.sqrt(Math.max(0, mR * mR - mDotS * mDotS)) * AU_KM;
    var xKm = -mDotS * AU_KM;                    // 地心到月心沿反日方向的距离
    var sunEarthKm = sR * AU_KM;
    var tanU = (R_SUN_KM - R_EARTH_KM) / sunEarthKm;
    var tanP = (R_SUN_KM + R_EARTH_KM) / sunEarthKm;
    var ru = R_EARTH_KM - xKm * tanU;            // 本影半径
    var rp = R_EARTH_KM + xKm * tanP;            // 半影半径
    var mag = (ru + R_MOON_KM - dKm) / (2 * R_MOON_KM);
    var pmag = (rp + R_MOON_KM - dKm) / (2 * R_MOON_KM);
    if (pmag <= 0 || xKm <= 0) return null;

    var kind;
    if (dKm < ru - R_MOON_KM) kind = 'total';
    else if (dKm < ru + R_MOON_KM) kind = 'partial';
    else kind = 'penumbral';

    return {
      jd: jd,
      type: 'lunar-eclipse', body: 'moon', kind: kind,
      data: {
        magnitude: mag,
        penumbralMagnitude: pmag,
        axisDistEarthRadii: dKm / R_EARTH_KM,
        moonDistanceKm: mR * AU_KM,
        umbraRadiusKm: ru,
        penumbraRadiusKm: rp
      }
    };
  }

  // 三分搜索：在 [lo,hi] 内最小化 fn，返回 (lo+hi)/2
  function ternaryMin(fn, lo, hi, iters) {
    for (var i = 0; i < (iters || 60); i++) {
      var m1 = lo + (hi - lo) / 3;
      var m2 = hi - (hi - lo) / 3;
      if (fn(m1) < fn(m2)) hi = m2; else lo = m1;
    }
    return 0.5 * (lo + hi);
  }

  // 由新月时刻求日食
  function solarEclipseNear(jdNew) {
    var jdMin = ternaryMin(function (x) {
      var m = moonPosition(x), e = planet('earth', x);
      var sx = -e.x, sy = -e.y, sz = -e.z;
      var sR = hypot3(sx, sy, sz);
      var mx = m.x, my = m.y, mz = m.z;
      var dot = (mx * sx + my * sy + mz * sz) / sR;
      var d2 = mx * mx + my * my + mz * mz - dot * dot;
      return Math.sqrt(Math.max(0, d2));
    }, jdNew - 0.6, jdNew + 0.6, 60);
    return solarEclipseGeometry(jdMin);
  }

  // 由满月时刻求月食
  function lunarEclipseNear(jdFull) {
    var jdMin = ternaryMin(function (x) {
      var m = moonPosition(x), e = planet('earth', x);
      var sx = -e.x, sy = -e.y, sz = -e.z;
      var sR = hypot3(sx, sy, sz);
      var mx = m.x, my = m.y, mz = m.z;
      var dot = (mx * sx + my * sy + mz * sz) / sR;
      var d2 = mx * mx + my * my + mz * mz - dot * dot;
      return Math.sqrt(Math.max(0, d2));
    }, jdFull - 0.6, jdFull + 0.6, 60);
    return lunarEclipseGeometry(jdMin);
  }

  // 二分找月-日黄经差 = 0（新月）或 = 180（满月）
  function refineConjunction(lo, hi, offset) {
    var flo = norm180(moonSunDiff(lo) - offset);
    for (var i = 0; i < 60 && hi - lo > 1e-7; i++) {
      var mid = 0.5 * (lo + hi);
      var fm = norm180(moonSunDiff(mid) - offset);
      if ((flo < 0 && fm < 0) || (flo >= 0 && fm >= 0)) { lo = mid; flo = fm; }
      else { hi = mid; }
    }
    return 0.5 * (lo + hi);
  }

  function moonSunDiff(jd) {
    var m = moonPosition(jd);
    var e = planet('earth', jd);
    var sunLon = norm360(atan2D(-e.y, -e.x));
    return norm180(m.lon - sunLon);
  }

  function pushSeasonEvents(out, want, start, end) {
    var targets = [0, 90, 180, 270];
    var prev = norm360(sunApparentLon(start));
    for (var jd = start + 1; jd <= end + 1; jd += 1) {
      var cur = norm360(sunApparentLon(jd));
      for (var k = 0; k < targets.length; k++) {
        var target = targets[k];
        var type = (target % 180 === 0) ? 'equinox' : 'solstice';
        if (!want(type)) continue;
        var dPrev = norm180(prev - target);
        var dCur = norm180(cur - target);
        if (dPrev < 0 && dCur >= 0 && Math.abs(dPrev) < 20 && Math.abs(dCur) < 20) {
          out.push(seasonEvent(refineSunLongitude(jd - 1, jd, target), target));
        }
      }
      prev = cur;
    }
  }

  function eventsBetween(jd0, jd1, opts) {
    var o = opts || {};
    var types = o.types || null;
    function want(t) {
      if (!types) return true;
      if (typeof types === 'string') return types === t;
      return types.indexOf(t) >= 0;
    }
    var start = Math.max(Number(jd0), jdBounds(1800));
    var end = Math.min(Number(jd1), jdBounds(2101));
    if (!isFinite(start) || !isFinite(end) || end <= start) return [];
    if (end - start > 7305.5) end = start + 7305.5;   // 单次最多 20 年

    var out = [];

    // 二分/二至
    if (want('equinox') || want('solstice')) pushSeasonEvents(out, want, start, end);

    // 行星事件 + 月食/日食（逐日采样）
    var needPlanets = want('opposition') || want('elongation');
    var needMoon = want('solar-eclipse') || want('lunar-eclipse');
    if (needPlanets || needMoon) {
      var prev = stateAt(start);
      var prevPrev = null;
      for (var jd = start + 1; jd <= end + 1; jd += 1) {
        var cur = stateAt(jd);

        if (needPlanets) {
          // 冲日：外行星地心黄经 - 太阳黄经 = 180°
          for (var i = 0; i < OUTER_IDS.length; i++) {
            var pid = OUTER_IDS[i];
            if (!want('opposition')) continue;
            var relPrev = norm180(prev.planets[pid].lon - prev.sun.lon - 180);
            var relCur = norm180(cur.planets[pid].lon - cur.sun.lon - 180);
            if (((relPrev < 0 && relCur >= 0) || (relPrev > 0 && relCur <= 0)) &&
              Math.abs(relPrev) < 10 && Math.abs(relCur) < 10) {
              var jdOpp = refineOpposition(jd - 1, jd, pid);
              var st = stateAt(jdOpp);
              out.push({
                jd: jdOpp, type: 'opposition', body: pid, kind: 'opposition',
                data: {
                  geoDistanceAU: st.planets[pid].dist,
                  helioDistanceAU: st.planets[pid].helio,
                  elongationDeg: 180
                }
              });
            }
          }
          // 水金大距：地心角距的局部极大
          if (want('elongation') && prevPrev) {
            for (var k2 = 0; k2 < ELONG_IDS.length; k2++) {
              var vid = ELONG_IDS[k2];
              var e0 = elongationOf(prevPrev.planets[vid], prevPrev.sun);
              var e1 = elongationOf(prev.planets[vid], prev.sun);
              var e2 = elongationOf(cur.planets[vid], cur.sun);
              if (e1 >= e0 && e1 > e2 && e1 > 5) {
                var jdEl = ternaryMin(function (x) {
                  var stx = stateAt(x);
                  return -elongationOf(stx.planets[vid], stx.sun);
                }, jd - 2, jd, 50);
                var st2 = stateAt(jdEl);
                var dLon = norm180(st2.planets[vid].lon - st2.sun.lon);
                out.push({
                  jd: jdEl, type: 'elongation', body: vid,
                  kind: dLon > 0 ? 'max-east' : 'max-west',
                  data: {
                    elongationDeg: elongationOf(st2.planets[vid], st2.sun),
                    geoDistanceAU: st2.planets[vid].dist,
                    helioDistanceAU: st2.planets[vid].helio,
                    east: dLon > 0
                  }
                });
              }
            }
          }
        }

        if (needMoon) {
          var dPrev = prev.dLon, dCur = cur.dLon;
          // 新月（月-日黄经差由负变正）
          if (want('solar-eclipse') && dPrev < 0 && dCur >= 0) {
            var jdNew = refineConjunction(jd - 1, jd, 0);
            var se = solarEclipseNear(jdNew);
            if (se) out.push(se);
          }
          // 满月（黄经差在 ±180 处跳变；日步长最大约 15°，阈值取 90°）
          if (want('lunar-eclipse') && dPrev > 90 && dCur < -90) {
            var jdFull = refineConjunction(jd - 1, jd, 180);
            var le = lunarEclipseNear(jdFull);
            if (le) out.push(le);
          }
        }

        prevPrev = prev;
        prev = cur;
      }
    }

    out.sort(function (a, b) { return a.jd - b.jd; });
    return out;
  }

  function elongationOf(planetState, sun) {
    var p = planetState, s = sun;
    var dot = p.x * s.x + p.y * s.y + p.z * s.z;
    var cosE = dot / (p.dist * s.r);
    return deg(Math.acos(clamp(cosE, -1, 1)));
  }

  function refineOpposition(lo, hi, pid) {
    function f(jd) {
      var st = stateAt(jd);
      return norm180(st.planets[pid].lon - st.sun.lon - 180);
    }
    var flo = f(lo);
    for (var i = 0; i < 60 && hi - lo > 1e-7; i++) {
      var mid = 0.5 * (lo + hi);
      var fm = f(mid);
      if ((flo < 0 && fm < 0) || (flo >= 0 && fm >= 0)) { lo = mid; flo = fm; }
      else { hi = mid; }
    }
    return 0.5 * (lo + hi);
  }

  function nextEvents(fromMs, count, types) {
    var n = Math.max(1, Math.floor(Number(count) || 1));
    var jd = jdFromMs(fromMs);
    var out = [];
    var seen = {};
    var span = 366;
    for (var i = 0; i < 240 && out.length < n; i++) {
      var evs = eventsBetween(jd, jd + span, { types: types });
      for (var k = 0; k < evs.length; k++) {
        var e = evs[k];
        var key = e.type + '|' + e.body + '|' + e.kind + '|' + e.jd.toFixed(3);
        if (seen[key]) continue;
        if (e.jd <= jd + 1e-9) continue;
        seen[key] = true;
        out.push(e);
      }
      jd += span;
      if (jd > jdBounds(2100)) break;
    }
    out.sort(function (a, b) { return a.jd - b.jd; });
    return out.slice(0, n);
  }

  /* ================================================================
   * 7. 导出
   * ================================================================ */
  var api = {
    version: '1.0',
    JD_UNIX_EPOCH: JD_UNIX_EPOCH,
    JD_J2000: JD_J2000,
    AU_KM: AU_KM,
    planetIds: PLANET_IDS.slice(),
    jdFromMs: jdFromMs,
    msFromJd: msFromJd,
    planet: planet,
    earth: earth,
    sunGeo: sunGeo,
    moonGeo: moonGeo,
    moonRel: moonRel,
    moonIds: moonIds,
    eclToEq: eclToEq,
    eqToAltAz: eqToAltAz,
    gmst: gmst,
    moonPhase: moonPhase,
    eventsBetween: eventsBetween,
    nextEvents: nextEvents
  };

  COSMOS.ephem = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this));
