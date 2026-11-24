// 将 three.cjs 包装为浏览器可直接用 <script> 加载的全局 IIFE（file:// 协议也可用）
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'node_modules/three/build/three.cjs';
const OUT = 'vendor/three.global.js';

const code = fs.readFileSync(SRC, 'utf8');

const wrapped = `/* three.js r169 — packaged as global IIFE for file:// usage */
(function (global) {
'use strict';
var module = { exports: {} };
var exports = module.exports;
${code}
global.THREE = module.exports;
})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, wrapped, 'utf8');
console.log('wrote', OUT, (wrapped.length / 1024 / 1024).toFixed(2) + 'MB');
