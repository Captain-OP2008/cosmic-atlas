#!/usr/bin/env node
/*!
 * tools/ephem-test.js — COSMOS.ephem 自测（Node v24，零依赖、零网络）
 *
 * 运行：node tools/ephem-test.js
 * 全部 PASS 退出码 0；任一 FAIL 退出码 1 并打印差异。
 *
 * 覆盖契约 §3 与 §3.11：
 *   · 时间换算（JD / Unix ms 往返）
 *   · 坐标函数（eclToEq / gmst / eqToAltAz 昼夜与对象形式）
 *   · 行星位置范围与字段（1800–2100）＋范围外 approx 标记
 *   · 地球 2024-01-01 日心黄经/距离（对 JPL/DE405 参考值）
 *   · 月球距离 356,000–407,000 km、月相（照度/月龄/相名）
 *   · 2024-04-08 18:18Z 月地距离 360,000 km ±1% 且为新月
 *   · 卫星 moonRel / moonIds
 *   · 2024 二分二至（±5 min）、2024-04-08 日全食、2022-11-08 月全食、
 *     2025-01-16 火星冲日、2024 水星大距（±1 天）
 *   · 1800/2100 边界与 20 年窗口上限
 *   · 返回对象 JSON 可序列化、事件不含 HTML、源码无网络/依赖
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var EPHEM_PATH = path.join(ROOT, 'js', 'ephem.js');
var src = fs.readFileSync(EPHEM_PATH, 'utf8');

// 浏览器里 ephem.js 挂 window.COSMOS；vm 沙箱用 { window: {} } 模拟经典脚本环境
var sandbox = { window: {} };
vm.runInNewContext(src, sandbox, { filename: 'js/ephem.js' });
var E = sandbox.window.COSMOS && sandbox.window.COSMOS.ephem;

var results = [];
function T(name, fn) {
  var r;
  try {
    r = fn();
  } catch (e) {
    r = { ok: false, msg: '异常: ' + (e && e.message ? e.message : String(e)) };
  }
  var ok = !!(r && r.ok);
  results.push({ name: name, ok: ok, msg: (r && r.msg) || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (r && r.msg ? '  [' + r.msg + ']' : ''));
}

/* ---------- 小工具 ---------- */
function jdOf(iso) { return E.jdFromMs(Date.parse(iso)); }
function isoOf(jd) { return new Date(E.msFromJd(jd)).toISOString(); }
function norm360(x) { return ((x % 360) + 360) % 360; }
function norm180(x) { return ((x + 180) % 360 + 360) % 360 - 180; }
function hours(a, b) { return (a - b) * 24; }
function num(x) { return typeof x === 'number' && isFinite(x); }

if (!E) {
  console.error('FAIL 无法加载 COSMOS.ephem：js/ephem.js 没有挂载 window.COSMOS.ephem');
  process.exit(1);
}

/* ================================================================
 * 1. 时间换算
 * ================================================================ */
T('时间：JD 换算（1970 / 2000 / 2024 与 ms 往返）', function () {
  var j1970 = E.jdFromMs(0);
  var j2000 = E.jdFromMs(Date.UTC(2000, 0, 1, 12));
  var j2024 = jdOf('2024-01-01T00:00:00Z');
  var back = E.msFromJd(j2024);
  var d1 = Math.abs(j1970 - 2440587.5);
  var d2 = Math.abs(j2000 - 2451545.0);
  var d3 = Math.abs(E.jdFromMs(back) - j2024);
  if (!(E.JD_UNIX_EPOCH === 2440587.5)) return { ok: false, msg: 'JD_UNIX_EPOCH=' + E.JD_UNIX_EPOCH };
  var ok = d1 < 1e-9 && d2 < 1e-9 && d3 < 1e-9;
  return {
    ok: ok,
    msg: 'JD(1970) Δ=' + d1.toExponential(1) + 'd, JD(2000) Δ=' + d2.toExponential(1) +
      'd, 往返 Δ=' + d3.toExponential(1) + 'd'
  };
});

/* ================================================================
 * 2. 坐标函数
 * ================================================================ */
T('坐标：eclToEq / gmst 基本正确性', function () {
  var jd = jdOf('2024-01-01T00:00:00Z');
  var a = E.eclToEq(0, 0, jd);
  var b = E.eclToEq(90, 0, jd);
  var g0 = E.gmst(2451545.0);
  var g1 = E.gmst(2451545.0 + 1);
  var dg = norm180(g1 - g0 - 360.98564736629);
  var ok = Math.abs(norm180(a.ra)) < 1e-9 && Math.abs(a.dec) < 1e-9 &&
    Math.abs(norm180(b.ra - 90)) < 1e-9 && Math.abs(norm180(g0 - 280.46061837)) < 1e-6 &&
    Math.abs(dg) < 1e-6;
  return { ok: ok, msg: 'gmst(J2000)=' + g0.toFixed(6) + '°, 日变化偏差=' + dg.toExponential(1) + '°' };
});

T('坐标：eqToAltAz 昼夜 + az 北0东90 + 对象形式兼容', function () {
  var lat = 39.9042, lon = 116.4074;                    // 北京
  var jdNoon = jdOf('2024-01-01T04:00:00Z');            // 北京地方时约 12:00
  var jdNight = jdOf('2024-01-01T16:00:00Z');           // 地方时约 00:00
  var sNoon = E.sunGeo(jdNoon);
  var sNight = E.sunGeo(jdNight);
  var aNoon = E.eqToAltAz(sNoon.ra, sNoon.dec, jdNoon, lat, lon);
  var aNight = E.eqToAltAz(sNight.ra, sNight.dec, jdNight, lat, lon);
  var aObj = E.eqToAltAz(sNoon, lat, lon, jdNoon);       // 契约 §3 的对象形式
  // 北极星：dec≈89.9°，纬度 40°；令时角≈0（ra=gmst），则高度≈40°、方位≈0°（北）
  var pol = E.eqToAltAz(E.gmst(jdNoon), 89.9, jdNoon, 40, 0);
  var azNearNorth = Math.min(norm360(pol.az), 360 - norm360(pol.az));
  var ok = aNoon.alt > 20 && aNight.alt < 0 &&
    Math.abs(norm180(aNoon.az - 180)) < 40 &&
    Math.abs(aObj.alt - aNoon.alt) < 1e-9 && Math.abs(aObj.az - aNoon.az) < 1e-9 &&
    Math.abs(pol.alt - 40) < 0.5 && azNearNorth < 2;
  return {
    ok: ok,
    msg: '北京正午 alt=' + aNoon.alt.toFixed(2) + '°, az=' + aNoon.az.toFixed(1) +
      '°; 午夜 alt=' + aNight.alt.toFixed(2) + '°; 北极星 alt=' + pol.alt.toFixed(2) + '°'
  };
});

/* ================================================================
 * 3. 行星位置范围与字段（1800–2100）+ approx 标记
 * ================================================================ */
T('行星：九行星位置范围/字段/速度（1800–2100 采样）', function () {
  var ranges = {
    mercury: [0.30, 0.48], venus: [0.71, 0.74], earth: [0.98, 1.02],
    mars: [1.37, 1.68], jupiter: [4.90, 5.50], saturn: [8.90, 10.10],
    uranus: [18.20, 20.20], neptune: [29.70, 30.50], pluto: [29.50, 49.50]
  };
  var jds = ['1800-01-01T00:00:00Z', '1900-06-15T00:00:00Z', '2000-01-01T12:00:00Z',
    '2024-01-01T00:00:00Z', '2050-12-31T00:00:00Z', '2100-01-01T00:00:00Z'].map(jdOf);
  var bad = [], maxLat = 0;
  E.planetIds.forEach(function (id) {
    for (var i = 0; i < jds.length; i++) {
      var p = E.planet(id, jds[i]);
      if (!num(p.x) || !num(p.y) || !num(p.z) || !num(p.vx) || !num(p.vy) || !num(p.vz) ||
        !num(p.r) || !num(p.lon) || !num(p.lat) || !num(p.au)) { bad.push(id + '@' + i + ' 字段非数值'); continue; }
      if (p.r < ranges[id][0] || p.r > ranges[id][1]) bad.push(id + '@' + i + ' r=' + p.r.toFixed(4));
      if (Math.abs(p.lat) > 18) bad.push(id + '@' + i + ' lat=' + p.lat.toFixed(2));
      if (p.lon < 0 || p.lon >= 360) bad.push(id + '@' + i + ' lon=' + p.lon);
      if (Math.abs(p.au - p.r) > 1e-12) bad.push(id + '@' + i + ' au≠r');
      if (typeof p.approx !== 'boolean') bad.push(id + '@' + i + ' 缺 approx');
      maxLat = Math.max(maxLat, Math.abs(p.lat));
    }
  });
  var ev = E.earth(jdOf('2024-01-01T00:00:00Z'));
  var earthSpeed = Math.hypot(ev.vx, ev.vy, ev.vz);
  // 1 月初地球近近日点，公转速度约 0.0175 AU/day（30.3 km/s）
  var speedOk = earthSpeed > 0.0165 && earthSpeed < 0.0180;
  // 范围外标记：1700 年应 approx=true；2024 年应为 false
  var apOld = E.planet('mercury', jdOf('1700-01-01T00:00:00Z'));
  var apNow = E.planet('mars', jdOf('2024-01-01T00:00:00Z'));
  var ok = bad.length === 0 && speedOk && apOld.approx === true && apNow.approx === false;
  return {
    ok: ok,
    msg: bad.length ? bad.slice(0, 3).join('; ') :
      '最大|lat|=' + maxLat.toFixed(2) + '°，地球|v|=' + earthSpeed.toFixed(5) +
      ' AU/d，越界 approx=' + apOld.approx
  };
});

/* ================================================================
 * 4. 契约③：2024-01-01T00:00Z 地球日心黄经 / 距离
 * ================================================================ */
T('契约③ 地球：2024-01-01T00:00Z 日心 J2000 黄经 / 日心距', function () {
  var jd = jdOf('2024-01-01T00:00:00Z');
  var e = E.earth(jd);
  // 参考：AstroPixels（Fred Espenak, DE405）太阳视赤经 18h43m41.04s、视赤纬 -23°03'30.5"、距离 0.983318 AU。
  // 由视赤道坐标反算 J2000 日心黄经（简化：忽略章动 Δψ，误差 <0.01°）。
  var ra = (18 + 43 / 60 + 41.04 / 3600) * 15 * Math.PI / 180;
  var dec = -(23 + 3 / 60 + 30.5 / 3600) * Math.PI / 180;
  var eps = (23 + 26 / 60 + 21.448 / 3600) - 0.0130041667 * 0.2400;  // 2024.0 平黄赤交角
  var epsR = eps * Math.PI / 180;
  var lamApp = Math.atan2(Math.sin(ra) * Math.cos(epsR) + Math.tan(dec) * Math.sin(epsR), Math.cos(ra)) * 180 / Math.PI;
  var lamGeo = lamApp + 20.4898 / 0.983318 / 3600;                  // 去光行差
  var prec = 5028.796195 / 3600 / 100 * 24.0018;                    // 岁差（黄经，度）
  var lamJ2000 = norm360(lamGeo - prec);
  var lonRef = norm360(lamJ2000 + 180);                             // 地球日心黄经 = 太阳地心黄经 + 180
  var dLon = Math.abs(norm180(e.lon - lonRef));
  var distRef = 0.983318;                                           // AU（DE405）
  var dDist = Math.abs(e.r - distRef) / distRef * 100;
  var ok = dLon < 0.05 && dDist < 0.2;
  return {
    ok: ok,
    msg: 'lon=' + e.lon.toFixed(4) + '° (参考 ' + lonRef.toFixed(4) + '°, Δ=' +
      (dLon * 3600).toFixed(1) + '″), r=' + e.r.toFixed(6) + ' AU (Δ=' + dDist.toFixed(4) + '%)'
  };
});

/* ================================================================
 * 5. 月球距离范围 / 契约④ / 月相
 * ================================================================ */
T('月球：地心距离在 356,000–407,000 km 内（2024 全年采样）', function () {
  var jd0 = jdOf('2024-01-01T00:00:00Z');
  var minD = 1e9, maxD = 0, bad = 0, jdMin = 0, jdMax = 0;
  for (var i = 0; i <= 200; i++) {
    var jd = jd0 + i * 1.83;
    var m = E.moonGeo(jd);
    if (m.distKm < 356000 || m.distKm > 407000) bad++;
    if (m.distKm < minD) { minD = m.distKm; jdMin = jd; }
    if (m.distKm > maxD) { maxD = m.distKm; jdMax = jd; }
  }
  var ok = bad === 0 && minD < 360000 && maxD > 404000;
  return {
    ok: ok,
    msg: 'min=' + minD.toFixed(0) + ' km (' + isoOf(jdMin).slice(0, 10) + '), max=' +
      maxD.toFixed(0) + ' km (' + isoOf(jdMax).slice(0, 10) + ')，越界 ' + bad + ' 个'
  };
});

T('契约④ 月球：2024-04-08T18:18Z 距离 ≈360,000 km（±1%）且为新月', function () {
  var jd = jdOf('2024-04-08T18:18:00Z');
  var m = E.moonGeo(jd);
  var dPct = Math.abs(m.distKm - 360000) / 360000 * 100;
  var ok = dPct < 1 && m.illum < 0.02 && m.phaseName === 'new';
  return {
    ok: ok,
    msg: 'dist=' + m.distKm.toFixed(0) + ' km (Δ=' + dPct.toFixed(3) + '%), illum=' +
      m.illum.toExponential(2) + ', phase=' + m.phaseName
  };
});

T('月相：照度 / 月龄 / 相名 / 盈亏（2024 三个已知时刻）', function () {
  var jan1 = E.moonPhase(jdOf('2024-01-01T00:00:00Z'));       // 亏凸月，月龄约 19.0
  var jan15 = E.moonPhase(jdOf('2024-01-15T00:00:00Z'));      // 娥眉月（新月后 3.6 天）
  var full = E.moonPhase(jdOf('2024-04-23T23:49:00Z'));       // 满月
  var ok = Math.abs(jan1.illum - 0.780) < 0.02 && Math.abs(jan1.ageDays - 19.0) < 0.5 &&
    jan1.phaseName === 'waningGibbous' && jan1.waxing === false &&
    jan15.waxing === true && jan15.phaseName === 'waxingCrescent' &&
    full.illum > 0.98 && full.phaseName === 'full';
  return {
    ok: ok,
    msg: '01-01 illum=' + jan1.illum.toFixed(3) + ' age=' + jan1.ageDays.toFixed(2) +
      ' ' + jan1.phaseName + '; 01-15 illum=' + jan15.illum.toFixed(2) + ' ' + jan15.phaseName +
      '; 04-23 illum=' + full.illum.toFixed(3) + ' ' + full.phaseName
  };
});

/* ================================================================
 * 6. 卫星
 * ================================================================ */
T('卫星：moonIds / moonRel 距离范围', function () {
  var jd = jdOf('2024-01-01T00:00:00Z');
  var emb = E.moonGeo(jd);
  var relEarth = E.moonRel('earth', 'moon', jd);
  var io = E.moonRel('jupiter', 'io', jd);
  var titan = E.moonRel('saturn', 'titan', jd);
  var triton = E.moonRel('neptune', 'triton', jd);
  var charon = E.moonRel('pluto', 'charon', jd);
  var idsJ = E.moonIds('jupiter'), idsS = E.moonIds('saturn');
  var dEarth = Math.abs(relEarth.distKm - emb.distKm);
  var ok = E.moonIds('earth').join(',') === 'moon' && idsJ.length === 4 && idsS.length === 3 &&
    dEarth < 1e-6 &&
    io.distKm > 400000 && io.distKm < 450000 &&
    titan.distKm > 1150000 && titan.distKm < 1300000 &&
    Math.abs(triton.distKm - 354759) < 20000 &&
    Math.abs(charon.distKm - 19591) < 1000;
  return {
    ok: ok,
    msg: 'earth-moon Δ=' + dEarth.toExponential(1) + ' km, io=' + io.distKm.toFixed(0) +
      ' km, titan=' + titan.distKm.toFixed(0) + ' km, triton=' + triton.distKm.toFixed(0) +
      ' km, charon=' + charon.distKm.toFixed(0) + ' km'
  };
});

/* ================================================================
 * 7. 天象事件（契约①②⑤⑥）
 * ================================================================ */
T('契约② 二分二至 2024（±5 min）', function () {
  var ev = E.eventsBetween(jdOf('2024-01-01T00:00:00Z'), jdOf('2025-01-01T00:00:00Z'),
    { types: ['equinox', 'solstice'] });
  var ref = {
    march: jdOf('2024-03-20T03:06:00Z'), june: jdOf('2024-06-20T20:51:00Z'),
    september: jdOf('2024-09-22T12:44:00Z'), december: jdOf('2024-12-21T09:20:00Z')
  };
  var found = {};
  ev.forEach(function (e) { found[e.kind] = e; });
  var worst = 0, miss = [];
  Object.keys(ref).forEach(function (k) {
    if (!found[k]) { miss.push(k); return; }
    worst = Math.max(worst, Math.abs(hours(found[k].jd, ref[k])) * 60);
  });
  var ok = miss.length === 0 && worst < 5;
  return {
    ok: ok,
    msg: miss.length ? '缺 ' + miss.join(',') : '最大偏差 ' + worst.toFixed(2) + ' min（' + ev.length + ' 个事件）'
  };
});

T('契约① 2024-04-08 日全食 / 2022-11-08 月全食（±6 h，kind 正确）', function () {
  var se = E.eventsBetween(jdOf('2024-04-01T00:00:00Z'), jdOf('2024-04-20T00:00:00Z'),
    { types: ['solar-eclipse'] });
  var le = E.eventsBetween(jdOf('2022-11-01T00:00:00Z'), jdOf('2022-11-20T00:00:00Z'),
    { types: ['lunar-eclipse'] });
  var seRef = jdOf('2024-04-08T18:17:00Z');
  var leRef = jdOf('2022-11-08T10:59:00Z');
  var dS = 1e9, dL = 1e9, seKind = '', leKind = '';
  se.forEach(function (e) { var d = Math.abs(hours(e.jd, seRef)); if (d < dS) { dS = d; seKind = e.kind; } });
  le.forEach(function (e) { var d = Math.abs(hours(e.jd, leRef)); if (d < dL) { dL = d; leKind = e.kind; } });
  var ok = dS < 6 && seKind === 'total' && dL < 6 && leKind === 'total';
  return {
    ok: ok,
    msg: '日食 Δ=' + dS.toFixed(2) + ' h kind=' + seKind + '; 月食 Δ=' + dL.toFixed(2) + ' h kind=' + leKind
  };
});

T('契约⑤ 2025-01-16 火星冲日（±12 h）', function () {
  var ev = E.eventsBetween(jdOf('2025-01-01T00:00:00Z'), jdOf('2025-02-01T00:00:00Z'),
    { types: ['opposition'] });
  var mars = ev.filter(function (e) { return e.body === 'mars'; })[0];
  var d = mars ? Math.abs(hours(mars.jd, jdOf('2025-01-16T01:00:00Z'))) : 1e9;
  var ok = !!mars && d < 12;
  return {
    ok: ok,
    msg: mars ? '冲日 ' + isoOf(mars.jd) + '（Δ=' + d.toFixed(2) + ' h, 地心距=' +
      mars.data.geoDistanceAU.toFixed(3) + ' AU）' : '未找到火星冲日'
  };
});

T('契约⑥ 2024 水星大距（3/25、7/22，±1 天）', function () {
  var ev = E.eventsBetween(jdOf('2024-01-01T00:00:00Z'), jdOf('2025-01-01T00:00:00Z'),
    { types: ['elongation'] });
  var merc = ev.filter(function (e) { return e.body === 'mercury'; });
  function near(iso) {
    var ref = jdOf(iso), best = null, bd = 1e9;
    merc.forEach(function (e) {
      var d = Math.abs(e.jd - ref);
      if (d < bd) { bd = d; best = e; }
    });
    return { best: best, d: bd };
  }
  var a = near('2024-03-25T00:00:00Z');
  var b = near('2024-07-22T00:00:00Z');
  var ok = merc.length >= 6 && a.d < 1 && b.d < 1 &&
    (a.best.kind === 'max-east' || a.best.kind === 'max-west');
  return {
    ok: ok,
    msg: merc.length + ' 次大距；3/25 最近 ' + (a.best ? isoOf(a.best.jd) + '（Δ=' + (a.d * 24).toFixed(1) + ' h, ' + a.best.kind + '）' : '无') +
      '；7/22 最近 ' + (b.best ? isoOf(b.best.jd) + '（Δ=' + (b.d * 24).toFixed(1) + ' h, ' + b.best.kind + '）' : '无')
  };
});

T('事件：结构完整、按 jd 升序、data 为数值、不含 HTML', function () {
  var ev = E.eventsBetween(jdOf('2024-01-01T00:00:00Z'), jdOf('2024-12-31T00:00:00Z'));
  var sorted = true, bad = null;
  for (var i = 1; i < ev.length; i++) if (ev[i].jd < ev[i - 1].jd) sorted = false;
  ev.forEach(function (e) {
    if (bad) return;
    if (!num(e.jd) || !e.type || !e.body || !e.kind || typeof e.data !== 'object' || e.data === null) bad = '缺字段';
    Object.keys(e.data).forEach(function (k) {
      if (!num(e.data[k]) && typeof e.data[k] !== 'boolean' && typeof e.data[k] !== 'string') bad = 'data.' + k + ' 非数值';
    });
    var j = JSON.stringify(e);
    if (j.indexOf('<') >= 0 || j.indexOf('&') >= 0) bad = '疑似 HTML';
  });
  var ok = ev.length > 5 && sorted && !bad;
  return { ok: ok, msg: bad || (ev.length + ' 个事件，升序 ' + sorted) };
});

/* ================================================================
 * 8. 1800/2100 边界与 20 年窗口上限
 * ================================================================ */
T('边界：1800 / 2100 事件可算，之外返回空，20 年窗口封顶', function () {
  var early = E.eventsBetween(jdOf('1800-01-01T00:00:00Z'), jdOf('1801-01-01T00:00:00Z'),
    { types: ['equinox', 'solstice'] });
  var late = E.eventsBetween(jdOf('2099-01-01T00:00:00Z'), jdOf('2101-01-01T00:00:00Z'),
    { types: ['equinox', 'solstice'] });
  var outside = E.eventsBetween(jdOf('1700-01-01T00:00:00Z'), jdOf('1750-01-01T00:00:00Z'));
  var wide = E.eventsBetween(jdOf('2000-01-01T00:00:00Z'), jdOf('2050-01-01T00:00:00Z'),
    { types: ['equinox', 'solstice'] });
  var lastWide = wide.length ? wide[wide.length - 1].jd : 0;
  var clamped = lastWide < jdOf('2021-01-01T00:00:00Z');
  var ok = early.length >= 4 && late.length >= 4 && outside.length === 0 && clamped;
  return {
    ok: ok,
    msg: '1800 年 ' + early.length + ' 个、2099–2100 年 ' + late.length + ' 个、1700–1750 返回 ' +
      outside.length + ' 个、2000–2050 请求封顶到 ' + isoOf(lastWide).slice(0, 10)
  };
});

/* ================================================================
 * 9. JSON 可序列化 + 源码静态自检（无网络/无依赖）
 * ================================================================ */
T('工程：返回对象 JSON 可序列化（无 NaN / 函数）', function () {
  var jd = jdOf('2024-04-08T18:18:00Z');
  var obj = {
    planet: E.planet('mars', jd), earth: E.earth(jd), sun: E.sunGeo(jd),
    moon: E.moonGeo(jd), phase: E.moonPhase(jd),
    rel: E.moonRel('jupiter', 'io', jd),
    events: E.eventsBetween(jdOf('2024-01-01T00:00:00Z'), jdOf('2024-12-31T00:00:00Z'))
  };
  var json = JSON.stringify(obj);
  var back = JSON.parse(json);
  var ok = json.length > 100 && json.indexOf('NaN') < 0 && json.indexOf('null') < 0 &&
    num(back.moon.distKm) && num(back.earth.r) && Array.isArray(back.events);
  return { ok: ok, msg: 'JSON ' + (json.length / 1024).toFixed(1) + ' KB，可解析=' + ok };
});

T('工程：源码零网络 / 零依赖 / 经典脚本挂载 / API 完整', function () {
  var forbidden = [
    /require\s*\(/, /^\s*import\s/m, /^\s*export\s/m, /fetch\s*\(/,
    /XMLHttpRequest/, /new\s+WebSocket/, /document\./, /THREE\./, /navigator\./
  ];
  var hits = [];
  forbidden.forEach(function (re) { if (re.test(src)) hits.push(re.toString()); });
  var needFns = ['jdFromMs', 'msFromJd', 'planet', 'earth', 'sunGeo', 'moonGeo', 'moonRel',
    'moonIds', 'eclToEq', 'eqToAltAz', 'gmst', 'moonPhase', 'eventsBetween', 'nextEvents'];
  var missing = needFns.filter(function (k) { return typeof E[k] !== 'function'; });
  var ok = hits.length === 0 && missing.length === 0 && E.version === '1.0' &&
    E.JD_UNIX_EPOCH === 2440587.5 && Array.isArray(E.planetIds) && E.planetIds.length === 9;
  return {
    ok: ok,
    msg: (hits.length ? '违禁模式 ' + hits.join(',') : '无 require/import/fetch/document/THREE') +
      (missing.length ? '；缺 API ' + missing.join(',') : '；API 完整 v' + E.version)
  };
});

T('工程：nextEvents 按 jd 升序返回（含对象形式类型过滤）', function () {
  var ev = E.nextEvents(Date.UTC(2024, 0, 1, 0), 5, ['solar-eclipse', 'lunar-eclipse']);
  var sorted = true;
  for (var i = 1; i < ev.length; i++) if (ev[i].jd < ev[i - 1].jd) sorted = false;
  var allRightType = ev.every(function (e) {
    return e.type === 'solar-eclipse' || e.type === 'lunar-eclipse';
  });
  var ok = ev.length === 5 && sorted && allRightType &&
    ev.every(function (e) { return e.jd > jdOf('2024-01-01T00:00:00Z'); });
  return {
    ok: ok,
    msg: ev.map(function (e) { return isoOf(e.jd).slice(0, 10) + ' ' + e.type + '/' + e.kind; }).join(', ')
  };
});

/* ================================================================
 * 汇总
 * ================================================================ */
var pass = results.filter(function (r) { return r.ok; }).length;
var fail = results.length - pass;
console.log('');
console.log('----------------------------------------------------------------');
console.log('COSMOS.ephem 自测：共 ' + results.length + ' 项，PASS ' + pass + '，FAIL ' + fail);
if (fail > 0) {
  console.log('FAIL 明细：');
  results.forEach(function (r) { if (!r.ok) console.log('  · ' + r.name + ' — ' + r.msg); });
  process.exit(1);
}
console.log('全部 PASS。');
process.exit(0);
