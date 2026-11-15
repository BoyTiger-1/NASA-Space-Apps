import fs from 'node:fs';
import { Ephemeris } from '../js/ephem.js';
import { buildSeries, windowMetrics, HOUR } from '../js/analysis.js';
const hdr = JSON.parse(fs.readFileSync('data/ephem.json')); const b = fs.readFileSync('data/ephem.bin');
const eph = new Ephemeris(hdr, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const S = JSON.parse(fs.readFileSync('data/sites.json')).sites;
for (const s of S) { const hz = { el: Float32Array.from(s.hz, v => v / 100), ground: s.ground, mast: s.mast };
  let t = Date.now(); const se = buildSeries(eph, s, hz, Date.UTC(2024, 0, 2), Date.UTC(2039, 11, 30), HOUR); const m = windowMetrics(se, 0, se.n);
  console.log(s.id.padEnd(9), 'sun%', m.sunPct.toFixed(1), 'comm%', m.commPct.toFixed(1), 'maxDark', (m.maxDarkH / 24).toFixed(1), 'd  maxOutage', (m.maxOutageH / 24).toFixed(1), 'd  peakEl', m.peakSunEl.toFixed(1), Date.now() - t, 'ms'); }
