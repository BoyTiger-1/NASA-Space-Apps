// Earthset automated tests (no network needed). Run: node tools/test.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { Ephemeris, makeSite, azel, subPoint, R_MOON } from '../js/ephem.js';
import { TerrainStack, computeHorizon, horizonAt, discVisible, offsetLL, lightMap } from '../js/terrain.js';
import { buildSeries, windowMetrics, verdict, calendar, discOverlap, simulateEnergy, DEFAULT_RULES, HOUR, DAY } from '../js/analysis.js';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hdr = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ephem.json'))); const b = fs.readFileSync(path.join(ROOT, 'data/ephem.bin'));
const eph = new Ephemeris(hdr, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const sites = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sites.json'))).sites;
const hzOf = (s) => ({ el: Float32Array.from(s.hz, v => v / 100), ground: s.ground, mast: s.mast });
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { cond ? pass++ : fail++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  [' + info + ']' : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('Ephemeris');
{ const t = Date.UTC(2027, 5, 1), sun = subPoint(eph, 0, t), ear = subPoint(eph, 1, t);
  ok('Sun distance is about 1 au', near(sun.dist, 1.496e8, 4e6), sun.dist.toFixed(0) + ' km');
  ok('Earth distance is 356-407 thousand km', ear.dist > 356000 && ear.dist < 407000, ear.dist.toFixed(0) + ' km');
  let mx = 0, my = 0, ms = 0; for (let d = 0; d < 5000; d += 3) { const e = subPoint(eph, 1, Date.UTC(2024, 0, 5) + d * DAY), s = subPoint(eph, 0, Date.UTC(2024, 0, 5) + d * DAY); mx = Math.max(mx, Math.abs(e.lon)); my = Math.max(my, Math.abs(e.lat)); ms = Math.max(ms, Math.abs(s.lat)); }
  ok('Earth libration in longitude stays within 8.2 deg', mx < 8.2 && mx > 6, mx.toFixed(2));
  ok('Earth libration in latitude stays within 7 deg', my < 7.0 && my > 5.5, my.toFixed(2));
  ok('Sub-solar latitude stays within 1.6 deg (lunar axial tilt)', ms < 1.62 && ms > 1.4, ms.toFixed(3));
  const s0 = subPoint(eph, 0, t), s1 = subPoint(eph, 0, t + 29.530589 * DAY); let dl = Math.abs(s1.lon - s0.lon); if (dl > 180) dl = 360 - dl;
  ok('Sun returns to the same longitude after one synodic month', dl < 3.5, dl.toFixed(2) + ' deg');
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/validation.json')));
  ok('Recorded JPL Horizons comparison is within 0.001 deg', v.worst_error_deg < 0.001 && v.total_samples > 20000, v.worst_error_deg + ' deg over ' + v.total_samples); }

console.log('Geometry');
{ ok('Disc overlap: none when apart', discOverlap(3, 1, 1) === 0);
  ok('Disc overlap: full when covered', discOverlap(0.1, 0.27, 0.95) === 1);
  ok('Disc overlap: half-way case', near(discOverlap(1, 1, 1), 0.391, 0.002), discOverlap(1, 1, 1).toFixed(4));
  const flat = new TerrainStack([{ res: 100, height: () => 0 }]);
  const h = computeHorizon(flat, -45, 30, 2), dip = -Math.acos(1737400 / 1737402) * 180 / Math.PI;
  ok('Smooth sphere: horizon dip matches the analytic value', near(Math.max(...h.el), dip, 0.004) && near(Math.min(...h.el), dip, 0.004), `${h.el[0].toFixed(4)} vs ${dip.toFixed(4)}`);
  const hz = { el: new Float32Array(720).fill(1) };
  ok('Disc on the horizon is half visible', near(discVisible(hz, 100, 1, 0.266), 0.5, 0.01));
  ok('Disc above / below the horizon', discVisible(hz, 100, 1.3, 0.266) === 1 && discVisible(hz, 100, 0.7, 0.266) === 0);
  const o = offsetLL(-89.45, -137.31, 300, -400), back = offsetLL(o.lat, o.lon, 0, 0);
  const d = Math.acos(Math.min(1, offsetLL(-89.45, -137.31, 0, 0).q.reduce((a, x, i) => a + x * back.q[i], 0))) * 1737400;
  ok('Offsets move the right distance on the sphere', near(d, 500, 1), d.toFixed(2) + ' m');
  const cone = new TerrainStack([{ res: 100, height: (x, y, z) => { const ang = 2 * Math.asin(Math.hypot(x - 1, y, z) / 2) * 1737400; return Math.max(0, 1000 - ang); } }]);
  const lm = lightMap(cone, 0, 0, 0, 21, 400, [0], () => ({ s: [Math.sin(0.05), -Math.cos(0.05), 0], rS: 0.00465, e: [3.8e8, 0, 0] }));
  const row = 10, east = lm.lit[row * 21 + 16], west = lm.lit[row * 21 + 4];
  ok('Light map: a hill shadows the side away from the low Sun', west === 1 && east === 0, `sunward ${west}, lee ${east}`); }

console.log('Sites and mission logic');
{ const t0 = Date.UTC(2026, 0, 1), t1 = Date.UTC(2028, 0, 1);
  const S = Object.fromEntries(sites.map(s => [s.id, buildSeries(eph, s, hzOf(s), t0, t1, HOUR)]));
  const M = Object.fromEntries(sites.map(s => [s.id, windowMetrics(S[s.id], 0, S[s.id].n)]));
  ok('Equatorial site is sunlit half the time', near(M.a11.sunPct, 50, 1.5), M.a11.sunPct.toFixed(1) + '%');
  ok('Equatorial night lasts about 14.8 days', near(M.a11.maxDarkH / 24, 14.77, 0.4), (M.a11.maxDarkH / 24).toFixed(2) + ' d');
  ok('Near side always sees Earth', M.a11.commPct === 100 && M.a17.commPct === 100);
  ok('Far side never sees Earth', M.ce4.commPct === 0 && M.ce6.commPct === 0);
  ok('Permanently shadowed crater floor gets no Sun', M.shack.sunPct === 0);
  ok('Connecting ridge beats every other site for sunlight', sites.every(s => s.id === 'ridge' || M.ridge.sunPct > M[s.id].sunPct), M.ridge.sunPct.toFixed(1) + '%');
  ok('Apollo 11 peak Sun elevation is near 90 deg', M.a11.peakSunEl > 87);
  const bg = buildSeries(eph, sites.find(s => s.id === 'bg1'), hzOf(sites.find(s => s.id === 'bg1')), Date.UTC(2025, 2, 14), Date.UTC(2025, 2, 14, 12), 60e3);
  let end = -1; for (let i = 0; i < bg.n; i++) if (bg.ecl[i] >= 0.9999) end = i;
  ok('14 Mar 2025 eclipse at Blue Ghost: totality ends 08:30 UTC +/- 10 min', near(end, 8 * 60 + 30, 10), new Date(bg.t0 + end * 60e3).toISOString().slice(11, 16));
  const m = windowMetrics(S.ce4, 0, 24 * 14), v = verdict(m, DEFAULT_RULES);
  ok('Far-side landing is NO-GO under default rules', v.level === 'nogo');
  const C = calendar(S.a11, 14 * 24, 24, DEFAULT_RULES); let go = 0; for (let d = 0; d < 365; d++) if (C.level[d] === 2) go++;
  ok('Apollo 11 site has GO landing days each month, but not every day', go > 12 && go < 200, go + ' GO days per year');
  const hot = simulateEnergy(S.a11, 0, 24 * 60, { arrayW: 600, loadW: 300, sleepW: 60, battWh: 1500, tracking: true });
  ok('Energy model: small battery dies in the 14-day night', hot.deadAtH != null && hot.minSoc === 0, 'dead at T+' + hot.deadAtH + ' h');
  const big = simulateEnergy(S.a11, 0, 24 * 60, { arrayW: 600, loadW: 300, sleepW: 60, battWh: 30000, tracking: true });
  ok('Energy model: a big enough battery survives the night', big.deadAtH == null && big.minSoc > 0, 'min ' + (big.minSoc * 100).toFixed(0) + '%');
  ok('Energy model: charge stays between 0 and 100%', hot.soc.every(x => x >= 0 && x <= 1)); }

{ console.log('Follow the light');
  const { sunRoute } = await import('../js/route.js');
  // 15x15 flat grid, 120 m pixels. The landing pixel (centre) is dark every other frame;
  // a pixel 3 east is always lit. A rover fast enough to get there should find it.
  const N = 15, px = N * N, T = 9, c = 7 * N + 7, tgt = 7 * N + 10, F = new Uint8Array(T * px), H = new Float32Array(px);
  for (let n = 0; n < T; n++) { F[n * px + c] = n % 2 ? 0 : 255; F[n * px + tgt] = 255; }
  const R = sunRoute(F, T, N, 120, H, c, { speed: 120, dtH: 3, maxSlopeDeg: 20 });
  ok('Route: parked rover gets the sunlight it should', Math.abs(R.parkedPct - 100 * 5 / 9) < 0.5, R.parkedPct.toFixed(1) + '%');
  ok('Route: rover drives to the always-lit spot and beats parking', R.routePct > 85 && R.path[T - 1] === tgt, R.routePct.toFixed(1) + '%');
  const wall = new Float32Array(px); for (let j = 0; j < N; j++) wall[j * N + 9] = 500;   // a cliff between start and target
  const R2 = sunRoute(F, T, N, 120, wall, c, { speed: 120, dtH: 3, maxSlopeDeg: 20 });
  ok('Route: a cliff steeper than the limit cannot be crossed', !Array.from(R2.path).some(k => k % N >= 9)); }

{ console.log('Base camp finder');
  const { findBaseCamps } = await import('../js/basecamp.js');
  // 21x21 flat grid. Sun+Earth is best at one pixel; a dark patch sits 4 pixels west of it.
  const N = 21, px = N * N, z = () => new Float32Array(px), r = { N, res: 100, both: z(), lit: z(), comm: z(), h: z(), maxLit: z() };
  for (let k = 0; k < px; k++) { r.both[k] = 0.3; r.lit[k] = 0.5; r.comm[k] = 0.6; r.maxLit[k] = 1; }
  const best = 10 * N + 14; r.both[best] = 0.9;
  for (let j = 9; j <= 11; j++) for (let i = 8; i <= 10; i++) r.maxLit[j * N + i] = 0;
  const B = findBaseCamps(r, { maxSlopeDeg: 10, spacingM: 500, top: 3 });
  ok('Base camp: picks the spot with the most Sun + Earth', B.spots[0].k === best, (B.spots[0].both * 100).toFixed(0) + '%');
  ok('Base camp: measures the distance to always-dark ground', Math.abs(B.spots[0].iceM - 400) < 1, B.spots[0].iceM + ' m');
  ok('Base camp: never puts a base in always-dark ground', B.spots.every(s => r.maxLit[s.k] > 0));
  const steep = { ...r, h: Float32Array.from({ length: px }, (_, k) => (k % N) === 14 ? 300 : 0) };
  ok('Base camp: rejects steep ground', !findBaseCamps(steep, { maxSlopeDeg: 10, spacingM: 500, top: 3 }).spots.some(s => s.k === best)); }

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
