// Real-world sanity checks against documented events at the Blue Ghost Mission 1 site.
import fs from 'node:fs';
import { Ephemeris } from '../js/ephem.js';
import { buildSeries } from '../js/analysis.js';
const hdr = JSON.parse(fs.readFileSync('data/ephem.json')); const b = fs.readFileSync('data/ephem.bin');
const eph = new Ephemeris(hdr, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const s = JSON.parse(fs.readFileSync('data/sites.json')).sites.find(x => x.id === 'bg1');
const hz = { el: Float32Array.from(s.hz, v => v / 100), ground: s.ground, mast: s.mast };
const S = buildSeries(eph, s, hz, Date.UTC(2025, 2, 1), Date.UTC(2025, 2, 18), 60e3);
const iso = (i) => new Date(S.t0 + i * S.step).toISOString().slice(0, 16);
let e0 = -1, e1 = -1, t0 = -1, t1 = -1, rise = -1, set = -1;
for (let i = 1; i < S.n; i++) {
  if (S.ecl[i] > 0 && e0 < 0) e0 = i; if (S.ecl[i] > 0) e1 = i;
  if (S.ecl[i] >= 0.9999 && t0 < 0) t0 = i; if (S.ecl[i] >= 0.9999) t1 = i;
  if (S.sunVis[i] > 0 && S.sunVis[i - 1] === 0 && S.ecl[i] === 0 && rise < 0) rise = i;
  if (S.sunVis[i] === 0 && S.sunVis[i - 1] > 0 && S.ecl[i] === 0) set = i;
}
console.log('sunrise (first limb):', iso(rise), ' Sun el at landing 2025-03-02T08:34:', S.sunEl[(Date.UTC(2025, 2, 2, 8, 34) - S.t0) / 60e3].toFixed(2));
console.log('eclipse partial:', iso(e0), '->', iso(e1), ' total:', iso(t0), '->', iso(t1));
console.log('sunset (last limb):', iso(set));
