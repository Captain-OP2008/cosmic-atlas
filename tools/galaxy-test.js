#!/usr/bin/env node
/* ============================================================
 * COSMOS ATLAS · 06 章 星系碰撞 · 模型自测（Node，零依赖、零网络）
 * ------------------------------------------------------------
 * 用法：node tools/galaxy-test.js
 * 覆盖契约 §3：场景完整性、恒星数/半径、圆速度量级、100 Myr 能量守恒
 * （<1%）、passer vs retrograde 潮汐尾长度差异、bullseye 环形成、
 * 序列化往返，共 30+ 断言。全 PASS 退出码 0，否则 1。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const MODEL_PATH = path.join(ROOT, 'js', 'galaxy-model.js');
const source = fs.readFileSync(MODEL_PATH, 'utf8');

const sandbox = { window: {}, console, btoa, atob, escape, unescape };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'js/galaxy-model.js' });
const M = sandbox.window.COSMOS && sandbox.window.COSMOS.galaxyModel;

let pass = 0;
let fail = 0;
const rows = [];

function ok(cond, label, detail) {
  const good = !!cond;
  if (good) pass++; else fail++;
  rows.push((good ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  ·  ' + detail : ''));
  console.log(rows[rows.length - 1]);
  return good;
}

function num(v, d) { return Number(v).toFixed(d === undefined ? 3 : d); }
function pct(v, d) { return num(v, d === undefined ? 4 : d) + '%'; }
function typeOf(a) { return Object.prototype.toString.call(a); }

function maxAbs(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function dist3(p, q) {
  const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/* ---------- 恒星诊断量 ---------- */
function starRadius(sim, i, coreIdx) {
  const c = sim.cores[coreIdx || 0];
  const k = i * 3;
  return dist3([sim.stars.pos[k], sim.stars.pos[k + 1], sim.stars.pos[k + 2]], c.pos);
}

function ownerRadii(sim, ownerId, coreIdx) {
  const out = [];
  for (let i = 0; i < sim.stars.count; i++) {
    if (sim.stars.owner[i] === ownerId) out.push(starRadius(sim, i, coreIdx));
  }
  return out;
}

function percentile(arr, p) {
  const a = arr.slice().sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return a[idx];
}

function fractionIn(arr, lo, hi) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] >= lo && arr[i] < hi) n++;
  return n / arr.length;
}

/* 径向直方图（0..maxR，bin 宽 binW），返回 {counts, peakR} */

/* 核最近距离扫描 */
function minCoreDistance(sim, totalMyr, stepMyr) {
  let minD = Infinity;
  const n = Math.ceil(totalMyr / stepMyr);
  for (let i = 0; i < n; i++) {
    M.step(sim, stepMyr);
    minD = Math.min(minD, M.coreDistance(sim));
  }
  return minD;
}

/* ============================================================ */
console.log('== COSMOS ATLAS · galaxy-model 自测 ==\n');

console.log('-- 1. API 表面 --');
ok(M && typeof M === 'object', 'COSMOS.galaxyModel 存在');
ok(M.G === 4.5e-12, 'G = 4.5e-12 kpc³/(M☉·Myr²)', String(M.G));
['sceneList', 'buildScene', 'step', 'coreDistance', 'energy', 'formatMyr', 'b64urlEncode', 'b64urlDecode'].forEach((fn) => {
  ok(typeof M[fn] === 'function', 'API ' + fn + '() 是函数');
});
ok(M.sceneList().length === 6, 'sceneList() 返回 6 个场景');
const ids = M.sceneList().map((s) => s.id).join(',');
ok(ids === 'collide,custom,passer,retrograde,bullseye,spiral', '场景 id 齐全且顺序一致', ids);
ok(M.sceneList('nope') === null, '未知场景 id 返回 null');

console.log('\n-- 2. 场景定义完整性 --');
const fixedDurations = { collide: 400, custom: 400, passer: 400, retrograde: 400, bullseye: 250, spiral: 400 };
M.sceneList().forEach((s) => {
  const good = s.name && s.en && s.desc && typeof s.duration === 'number' &&
    s.duration > 0 && s.duration <= 1000 && s.camera &&
    typeof s.camera.yaw === 'number' && typeof s.camera.pitch === 'number' &&
    typeof s.camera.dist === 'number' && s.camera.dist >= 30 && s.camera.dist <= 300 &&
    s.startPaused === false;
  ok(good, '场景 ' + s.id + ' 元数据完整（name/en/desc/camera/duration/startPaused）');
  ok(s.duration === fixedDurations[s.id], '场景 ' + s.id + ' duration = ' + fixedDurations[s.id] + ' Myr');
});
const sets = M.sceneList();
const spin = sets.filter((s) => s.timeScale === 10).length;
ok(spin === 5, '5 个场景 1 秒 = 10 Myr');
ok(M.sceneList('spiral').timeScale === 5, '螺旋场景 5 Myr/秒');
const customOpts = M.sceneList('custom').options;
ok(customOpts && customOpts.ratio.length === 3 && customOpts.approach.length === 3 &&
  customOpts.spinA.length === 2 && customOpts.spinB.length === 2 &&
  customOpts.leanA.length === 3 && customOpts.leanB.length === 3,
'custom 4 组菜单（ratio 3 / approach 3 / spin ×2 / lean 3）齐全');

console.log('\n-- 3. 构建与恒星分布 --');
let sim = M.buildScene('collide', null, { count: 12000 });
ok(sim && sim.id === 'collide', 'buildScene(collide) 返回 sim');
ok(sim.stars.count === 12000, '默认恒星数 12000', String(sim.stars.count));
ok(typeOf(sim.stars.pos) === '[object Float32Array]' && sim.stars.pos.length === 36000, 'pos 为 Float32Array(3n)');
ok(typeOf(sim.stars.vel) === '[object Float32Array]' && sim.stars.vel.length === 36000, 'vel 为 Float32Array(3n)');
ok(sim.cores.length === 2, '两核场景有 2 个核');
ok(sim.cores[0].mass === 1e11 && sim.cores[1].mass === 1e11, '等质量核 A/B 均 1e11 M☉');
ok(Math.abs(sim.cores[0].radiusKpc - 1.2) < 1e-9, '核 A radiusKpc = 1.2');
ok(Math.abs(M.coreDistance(sim) - 45) < 1e-6, '初始核距 = 45 kpc（d0）', num(M.coreDistance(sim), 4));

let finite = true;
for (let i = 0; i < sim.stars.pos.length; i++) if (!Number.isFinite(sim.stars.pos[i])) { finite = false; break; }
ok(finite, '所有初始坐标有限');

const radiiA = ownerRadii(sim, 0, 0);
const radiiB = ownerRadii(sim, 1, 1);
ok(radiiA.length === 6000 && radiiB.length === 6000, '两星系恒星按质量一分为二', radiiA.length + '/' + radiiB.length);
ok(percentile(radiiA, 1) < 11 * 1.05, 'A 盘恒星 99% 在盘半径 11 kpc 内', num(percentile(radiiA, 0.99), 2) + ' kpc');
ok(percentile(radiiB, 1) < 11 * 1.05, 'B 盘恒星 99% 在盘半径内', num(percentile(radiiB, 0.99), 2) + ' kpc');

let sim6000 = M.buildScene('collide', null, { count: 6000 });
ok(sim6000.stars.count === 6000 && sim6000.stars.pos.length === 18000, 'opts.count = 6000 生效（low 画质）');

console.log('\n-- 4. 圆速度量级与能量守恒 --');
let vSum = 0, vN = 0;
for (let i = 0; i < sim.stars.count; i++) {
  if (sim.stars.owner[i] !== 0) continue;
  const r = starRadius(sim, i, 0);
  if (r < 7 || r > 9) continue;
  const k = i * 3;
  const vx = sim.stars.vel[k] - sim.cores[0].vel[0];
  const vy = sim.stars.vel[k + 1] - sim.cores[0].vel[1];
  const vz = sim.stars.vel[k + 2] - sim.cores[0].vel[2];
  vSum += Math.sqrt(vx * vx + vy * vy + vz * vz);
  vN++;
}
const vMean = vSum / Math.max(vN, 1);
ok(vN > 200 && vMean > 0.15 && vMean < 0.26, '7–9 kpc 恒星圆速度 ≈ 0.20 kpc/Myr', num(vMean, 4) + ' kpc/Myr（' + num(vMean * 977.8, 0) + ' km/s）');

const e0 = M.energy(sim);
ok(Number.isFinite(e0), '能量为有限数值（抛物线初轨 E≈0，软化势下可略正）', 'E = ' + num(e0, 4) + ' M☉·kpc²/Myr²');
ok(Math.abs(sim.meta.baselineEnergy - e0) < 1e-12, 'meta.baselineEnergy = build 时能量');

let simE = M.buildScene('collide', null, { count: 2000 });
const Eb0 = M.energy(simE);
for (let i = 0; i < 500; i++) M.step(simE, 0.2);        /* 100 Myr */
const Eb1 = M.energy(simE);
const eDrift = Math.abs((Eb1 - Eb0) / Eb0) * 100;
ok(eDrift < 1, '100 Myr 能量守恒 < 1%', pct(eDrift, 6) + '（' + num(Eb1 - Eb0, 6) + '）');

const sim0 = M.buildScene('collide', null, { count: 500 });
const before = sim0.stars.pos.slice(0, 30);
M.step(sim0, 0);
ok(Math.abs(sim0.myr) < 1e-12 && maxAbs(before, sim0.stars.pos.slice(0, 30)) === 0, 'step(sim, 0) 不改变状态');

let simR = M.buildScene('collide', null, { count: 1500 });
const corePos0 = [simR.cores[0].pos.slice(), simR.cores[1].pos.slice()];
M.step(simR, 40);
M.step(simR, -40);
const backErr = Math.max(dist3(simR.cores[0].pos, corePos0[0]), dist3(simR.cores[1].pos, corePos0[1]));
ok(backErr < 1e-4, 'KDK 时间可逆（±40 Myr 往返）', num(backErr, 9) + ' kpc');

let simM = M.buildScene('collide', null, { count: 800 });
M.step(simM, 1.3);
ok(Math.abs(simM.myr - 1.3) < 1e-9, 'step 正确累计 sim.myr', num(simM.myr, 6) + ' Myr');

let simMin = M.buildScene('collide', null, { count: 2500 });
const minD = minCoreDistance(simMin, 240, 0.2);
ok(minD > 5 && minD < 12, 'collide(9 kpc) 240 Myr 内最近核距 ≈ 9 kpc', num(minD, 3) + ' kpc');

console.log('\n-- 5. custom 参数与倾角 --');
let simC = M.buildScene('custom', { ratio: 0.25, approach: 6, spinA: 1, spinB: -1, leanA: 0, leanB: 0 }, { count: 3000 });
ok(Math.abs(simC.cores[1].mass - 2.5e10) < 1, 'custom ratio=0.25 → B = 2.5e10 M☉', String(simC.cores[1].mass));
const minC = minCoreDistance(simC, 400, 0.2);
ok(minC > 4 && minC < 9, 'custom approach=6 → 最近核距 ≈ 6 kpc', num(minC, 3) + ' kpc');

function zSpread(simX, ownerId, coreIdx) {
  const c = simX.cores[coreIdx].pos;
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < simX.stars.count; i++) {
    if (simX.stars.owner[i] !== ownerId) continue;
    const dz = simX.stars.pos[i * 3 + 2] - c[2];
    s += dz; s2 += dz * dz; n++;
  }
  const mean = s / n;
  return Math.sqrt(Math.max(0, s2 / n - mean * mean));
}
const simFlat = M.buildScene('custom', { ratio: 1, approach: 12, leanA: 0, leanB: 0 }, { count: 3000 });
const simTilt = M.buildScene('custom', { ratio: 1, approach: 12, leanA: 0, leanB: 60 }, { count: 3000 });
const zf = zSpread(simFlat, 1, 1), zt = zSpread(simTilt, 1, 1);
ok(zf < 1.0 && zt > 2.0, 'leanB=0/60 倾角改变 B 盘厚度', num(zf, 2) + ' → ' + num(zt, 2) + ' kpc');

let simFallback = M.buildScene('custom', { ratio: 0.9, approach: 999, spinA: -5, leanA: 47 }, { count: 1000 });
ok(simFallback.params.ratio === 1 && simFallback.params.approach === 20 &&
  simFallback.params.spinA === -1 && simFallback.params.leanA === 60,
'custom 非法档位回落到最近合法值');

console.log('\n-- 6. 潮汐尾：顺行 vs 逆行 --');
function tidalStats(sceneId) {
  const s = M.buildScene(sceneId, null, { count: 6000 });
  M.step(s, 400);                       /* 整个场景时长 */
  const bCore = s.cores[1].pos;
  const dists = [];
  for (let i = 0; i < s.stars.count; i++) {
    if (s.stars.owner[i] !== 1) continue;
    const k = i * 3;
    dists.push(dist3([s.stars.pos[k], s.stars.pos[k + 1], s.stars.pos[k + 2]], bCore));
  }
  return { p95: percentile(dists, 0.95), max: percentile(dists, 1), intact: fractionIn(dists, 0, 3 * 9) };
}
const pro = tidalStats('passer');
const retro = tidalStats('retrograde');
const factor = pro.p95 / retro.p95;
console.log('       顺行 B 潮汐尾 p95 = ' + num(pro.p95, 2) + ' kpc，逆行 = ' + num(retro.p95, 2) + ' kpc，比值 = ' + num(factor, 3));
ok(pro.p95 > retro.p95 * 1.3, '顺行潮汐尾显著长于逆行（>30%）', '×' + num(factor, 3));
ok(pro.max > retro.max * 1.2, '顺行最大拖尾 > 逆行', num(pro.max, 2) + ' vs ' + num(retro.max, 2) + ' kpc');
ok(retro.intact >= pro.intact, '逆行盘保持更完整（3 倍盘半径内恒星比例）', pct(retro.intact * 100, 1) + ' vs ' + pct(pro.intact * 100, 1));

console.log('\n-- 7. bullseye 穿心成环（4–12 kpc 径向密度局部极大）--');
/* 契约判据：t∈[90,200] 连续 ≥30 Myr，A 盘 1 kpc 环带面积密度在 4–12 kpc 有
 * 局部极大、峰值 / 内侧 1–3 kpc 均值 ≥3.0，且环峰落在 5–10 kpc；t=0 仍是螺旋盘。 */
const bull = M.buildScene('bullseye', null, { count: 12000 });

function diskRingProfile(sim) {
  const bins = new Array(16).fill(0);
  const pos = sim.stars.pos, own = sim.stars.owner;
  for (let i = 0; i < sim.stars.count; i++) {
    if (own[i] !== 0) continue;
    bins[Math.min(15, Math.floor(starRadius(sim, i, 0)))]++;
  }
  const dens = bins.map((c, b) => c / (2 * Math.PI * (b + 0.5)));
  const inner = (dens[1] + dens[2] + dens[3]) / 3;
  const peaks = [];
  for (let b = 4; b <= 12; b++) {
    if (dens[b] >= dens[b - 1] && dens[b] >= dens[b + 1]) {
      peaks.push({ b: b, dens: dens[b], contrast: dens[b] / Math.max(inner, 1e-9) });
    }
  }
  return { inner: inner, dens: dens, peaks: peaks };
}
const ringPeaks = (pr) => pr.peaks.filter((p) => p.b >= 5 && p.b <= 9 && p.contrast >= 3);

const p0 = diskRingProfile(bull);
ok(ringPeaks(p0).length === 0, 't=0 是螺旋盘：4–12 kpc 无环（无 ≥3× 局部极大）',
  '内侧 1–3 kpc 均值 ' + num(p0.inner, 1) + '，环峰 ' + (ringPeaks(p0).length ? '有' : '无'));

let stretch = 0, bestStretch = 0, bestPeak = null, firstRingT = -1, lastRingT = -1;
for (let t = 5; t <= 200; t += 5) {
  M.step(bull, 5);
  if (t < 90) continue;
  const pr = diskRingProfile(bull);
  const hit = ringPeaks(pr);
  if (hit.length) {
    stretch += 5;
    bestStretch = Math.max(bestStretch, stretch);
    if (firstRingT < 0) firstRingT = t;
    lastRingT = t;
    hit.forEach((p) => {
      if (!bestPeak || p.contrast > bestPeak.contrast) {
        bestPeak = { t: t, b: p.b, contrast: p.contrast, dens: p.dens };
      }
    });
  } else {
    stretch = 0;
  }
}
ok(bestStretch >= 30, 't∈[90,200] 环判据连续成立 ≥30 Myr',
  bestStretch + ' Myr（' + firstRingT + '–' + lastRingT + ' Myr）');
ok(bestPeak !== null && bestPeak.b >= 5 && bestPeak.b <= 9, '环峰半径落在 5–10 kpc',
  bestPeak ? 'b=' + bestPeak.b + '（' + num(bestPeak.b + 0.5, 1) + ' kpc），t=' + bestPeak.t + ' Myr' : '无环峰');
ok(bestPeak !== null && bestPeak.contrast >= 3, '峰值 / 内侧 1–3 kpc 均值 ≥3.0',
  bestPeak ? num(bestPeak.contrast, 1) + '×（峰值密度 ' + num(bestPeak.dens, 1) + '）' : '无环峰');
const pEnd = diskRingProfile(bull);
ok(pEnd.inner < p0.inner * 0.05, '穿心后盘心（<3 kpc）被清空',
  num(p0.inner, 1) + ' → ' + num(pEnd.inner, 1));
ok(M.energy(bull) === 0 && bull.meta.baselineEnergy === 0, '受驱场景 energy() 只计自由核（返回 0，UI 不漂移）',
  'E = ' + M.energy(bull) + '，baseline = ' + bull.meta.baselineEnergy);

console.log('\n-- 8. 序列化与格式化 --');
ok(M.formatMyr(0) === '0 Myr', "formatMyr(0) = '0 Myr'", M.formatMyr(0));
ok(M.formatMyr(123) === '123 Myr', "formatMyr(123) = '123 Myr'", M.formatMyr(123));
ok(M.formatMyr(1234) === '1.2 Gyr', "formatMyr(1234) = '1.2 Gyr'", M.formatMyr(1234));
ok(M.formatMyr(-50) === '-50 Myr', "formatMyr(-50) = '-50 Myr'", M.formatMyr(-50));
const payload = {
  v: 1, scene: 'bullseye', paused: false, speed: 2, myr: 120,
  params: { ratio: 1, approach: 20, spinA: 1, spinB: -1, leanA: 30, leanB: 60 },
  show: { trails: true, velocity: false, names: true },
  cam: { yaw: 0.4, pitch: 1.35, dist: 105 },
  note: '中文往返'
};
const enc = M.b64urlEncode(JSON.stringify(payload));
const dec = M.b64urlDecode(enc);
ok(enc.length > 0 && dec === JSON.stringify(payload), 'b64url JSON 往返一致', enc.length + ' 字符');
ok(M.b64urlDecode('!!!not-base64!!!') === null, '非法 b64url 返回 null');
ok(!/[+/=]/.test(enc), 'b64url 不含 + / =（URL 安全）');

console.log('\n-- 9. 确定性与工程卫生 --');
const d1 = M.buildScene('bulge-loss-check', null, {});   /* 未知场景 */
ok(d1 === null, 'buildScene(未知) 返回 null');
const g1 = M.buildScene('collide', null, { count: 2000 });
const g2 = M.buildScene('collide', null, { count: 2000 });
ok(maxAbs(g1.stars.pos, g2.stars.pos) === 0, '同参数场景可复现（种子确定性）');
let allScenesRun = true;
M.sceneList().forEach((s) => {
  const sm = M.buildScene(s.id, null, { count: 800 });
  if (!sm) { allScenesRun = false; return; }
  M.step(sm, 5);
  for (let k = 0; k < 30; k++) if (!Number.isFinite(sm.stars.pos[k])) { allScenesRun = false; return; }
});
ok(allScenesRun, '6 个场景均可构建并推进 5 Myr（无 NaN）');

const forbidden = [
  [/\bdocument\b/, 'document'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bfetch\s*\(/, 'fetch('],
  [/\brequire\s*\(/, 'require('],
  [/\bTHREE\b/, 'THREE'],
  [/^\s*(?:import|export)\b/m, 'import/export']
];
const found = forbidden.filter((f) => f[0].test(source)).map((f) => f[1]);
ok(found.length === 0, '源码无 DOM / THREE / 网络 / ESM 依赖', found.length ? '发现: ' + found.join(', ') : '干净');
ok(/use strict/.test(source), "源码含 'use strict'");
ok(source.split('\n').length > 300, '模型实现规模合理（' + source.split('\n').length + ' 行）');

/* ============================================================ */
console.log('\n============================================');
console.log((fail === 0 ? 'PASS' : 'FAIL') + '  ' + pass + '/' + (pass + fail) +
  ' 断言通过，' + fail + ' 失败');
console.log('最大误差：能量漂移 ' + pct(eDrift, 6) + ' · 时间可逆 ' + num(backErr, 9) +
  ' kpc · 潮汐比 ' + num(factor, 3) + ' · 环窗口 ' + bestStretch + ' Myr' +
  (bestPeak ? '（' + num(bestPeak.contrast, 1) + '×）' : '') +
  ' · 最近核距 ' + num(minD, 3) + ' kpc');
console.log('============================================');
process.exit(fail === 0 ? 0 : 1);
