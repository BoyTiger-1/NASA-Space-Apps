import fs from 'node:fs';
import { Ephemeris } from '../js/ephem.js';
import { buildSeries, windowMetrics, HOUR } from '../js/analysis.js';
import { computeHorizon } from '../js/terrain.js';
import { fullStack } from './terrain_node.mjs';
const hdr = JSON.parse(fs.readFileSync('data/ephem.json')); const b = fs.readFileSync('data/ephem.bin');
const eph = new Ephemeris(hdr, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const T = fullStack(); const RM = 1737400, D = Math.PI / 180;
// stereographic offsets around the nominal point
const lat0 = -89.45, lon0 = -137.31; const r0 = 2 * RM * Math.tan((90 + lat0) * D / 2); const x0 = r0 * Math.sin(lon0 * D), y0 = r0 * Math.cos(lon0 * D);
const res = []; const step = +process.argv[2] || 80, half = +process.argv[3] || 10;
for (let i = -half; i <= half; i++) for (let j = -half; j <= half; j++) {
  const x = x0 + i * step, y = y0 + j * step, r = Math.hypot(x, y); const lat = -90 + 2 * Math.atan(r / (2 * RM)) / D, lon = Math.atan2(x, y) / D;
  const hz = computeHorizon(T, lat, lon, 2, { nAz: 360, maxDist: 300e3, growth: 0.004 });
  const se = buildSeries(eph, { lat, lon }, hz, Date.UTC(2024, 0, 2), Date.UTC(2039, 11, 30), 4 * HOUR); const m = windowMetrics(se, 0, se.n);
  res.push([m.sunPct, lat, lon, hz.ground, m.maxDarkH / 24, m.commPct]); }
res.sort((a, b) => b[0] - a[0]);
for (const r of res.slice(0, 8)) console.log('sun%', r[0].toFixed(1), 'lat', r[1].toFixed(4), 'lon', r[2].toFixed(3), 'ground', r[3].toFixed(0), 'maxDark d', r[4].toFixed(1), 'comm%', r[5].toFixed(1));
