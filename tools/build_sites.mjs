// Precomputes terrain horizon masks for the curated sites from full-resolution
// NASA LOLA topography (20 m - 474 m grids) and writes data/sites.json.
// SI disclosure: written with the assistance of an SI coding tool (Claude).
import fs from 'node:fs'; import path from 'node:path';
import { fullStack, ROOT } from './terrain_node.mjs';
import { computeHorizon } from '../js/terrain.js';
import { SITES } from '../js/sitelist.js';
const T = fullStack(); const out = [];
for (const s of SITES) {
  const t = Date.now();
  const polar = Math.abs(s.lat) > 60;
  const hz = computeHorizon(T, s.lat, s.lon, 2, { nAz: 720, maxDist: polar ? 450e3 : 300e3, growth: 0.002 });
  out.push({ ...s, ground: Math.round(hz.ground), mast: 2, hz: Array.from(hz.el, v => Math.round(v * 100)), hzd: Array.from(hz.dist, v => Math.round(v * 10) / 10) });
  console.log(s.id.padEnd(9), 'ground', Math.round(hz.ground), 'm  horizon', Math.min(...hz.el).toFixed(2), '..', Math.max(...hz.el).toFixed(2), 'deg', Date.now() - t, 'ms');
}
fs.writeFileSync(path.join(ROOT, 'data/sites.json'), JSON.stringify({ generator: 'tools/build_sites.mjs (SI-assisted code)', source: 'NASA LRO LOLA GDR: LDEM_875S_20M, LDEM_85S_40M, LDEM_80S_80M, LDEM_75S_120M, LDEM_75N_120M, LDEM_64', hz_units: 'centi-degrees, 720 azimuths clockwise from north, observer 2 m above surface', sites: out }));
