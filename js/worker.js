// Earthset — Web Worker: terrain horizons for custom sites and the "nearby
// spots" rescue search, computed in the browser from reduced LOLA grids.
// SI disclosure: written with the assistance of an SI coding tool (Claude).
import { Ephemeris } from './ephem.js';
import { PolarDEM, CylDEM, TerrainStack, computeHorizon, deltaDecode, fetchGzI16, offsetLL, lightMap } from './terrain.js';
import { R_SUN } from './ephem.js';
import { buildSeries, windowMetrics, verdict, HOUR } from './analysis.js';

let eph = null, manifest = null;
const dems = {};
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

async function getDem(file) {
  if (dems[file]) return dems[file];
  if (!manifest) manifest = await (await fetch('../data/dems.json')).json();
  const m = manifest.dems.find(d => d.file === file);
  postMessage({ type: 'status', text: 'Downloading LOLA terrain (' + file.replace('.i16.gz', '') + ')…' });
  const raw = await fetchGzI16('../data/' + file);
  deltaDecode(raw, m.n, m.m);
  dems[file] = m.type === 'polar' ? new PolarDEM(raw, m.n, m.res, m.pole, 0.5, m.latLimit, file) : new CylDEM(raw, m.ppd, 0.5, file);
  return dems[file];
}
async function stackFor(lat) {
  const list = lat < -60 ? ['sp85_120m.i16.gz', 'sp75_480m.i16.gz', 'global_8ppd.i16.gz'] : lat > 60 ? ['np75_480m.i16.gz', 'global_8ppd.i16.gz'] : ['global_8ppd.i16.gz'];
  const ds = []; for (const f of list) ds.push(await getDem(f));
  return new TerrainStack(ds);
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') { eph = new Ephemeris(m.hdr, m.buf); return; }
    if (m.type === 'horizon') {
      const T = await stackFor(m.lat);
      postMessage({ type: 'status', text: 'Tracing the horizon in 720 directions…' });
      const hz = computeHorizon(T, m.lat, m.lon, m.mast, { nAz: 720, maxDist: Math.abs(m.lat) > 60 ? 450e3 : 300e3 });
      const up = [Math.cos(m.lat * D2R) * Math.cos(m.lon * D2R), Math.cos(m.lat * D2R) * Math.sin(m.lon * D2R), Math.sin(m.lat * D2R)];
      postMessage({ type: 'horizon', req: m.req, el: hz.el, dist: hz.dist, ground: hz.ground, res: T.resAt(up[0], up[1], up[2]) });
      return;
    }
    if (m.type === 'nearby') {
      const T = await stackFor(m.lat);
      const out = [], n = m.n, tot = (2 * n + 1) ** 2; let k = 0;
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const de = i * m.spacing, dn = j * m.spacing;
        const { lat, lon } = offsetLL(m.lat, m.lon, de, dn);
        const hz = computeHorizon(T, lat, lon, m.mast, { nAz: 360, maxDist: 300e3, growth: 0.004 });
        const S = buildSeries(eph, { lat, lon }, hz, m.landMs, m.landMs + m.durH * HOUR, HOUR);
        const met = windowMetrics(S, 0, S.n), v = verdict(met, m.rules);
        out.push({ lat, lon, ground: hz.ground, de, dn, dist: Math.hypot(de, dn), sunPct: met.sunPct, commPct: met.commPct, maxDarkH: met.maxDarkH, level: v.level, score: v.score });
        if (++k % 8 === 0) postMessage({ type: 'status', text: `Testing nearby spots… ${k}/${tot}` });
      }
      out.sort((a, b) => b.score - a.score || a.dist - b.dist);
      postMessage({ type: 'nearby', req: m.req, results: out.slice(0, 6), tested: tot, here: out.find(o => o.de === 0 && o.dn === 0) });
      return;
    }
    if (m.type === 'lightmap') {
      const T = await stackFor(m.lat);
      const o = offsetLL(m.lat, m.lon, 0, 0), res = Math.max(m.res || 0, T.resAt(o.q[0], o.q[1], o.q[2]));
      const v = [0, 0, 0];
      const sunEarth = (t) => {
        eph.pos(0, t, v); const d = Math.hypot(v[0], v[1], v[2]); const s = [v[0] / d, v[1] / d, v[2] / d], rS = Math.asin(R_SUN / d);
        eph.pos(1, t, v); return { s, rS, e: [v[0] * 1000, v[1] * 1000, v[2] * 1000] };
      };
      if (!m.quiet) postMessage({ type: 'status', text: 'Casting terrain shadows…' });
      const r = lightMap(T, m.lat, m.lon, m.mast, m.N, res, m.times, sunEarth, { maxDist: m.maxDist || 150e3, onProgress: (a, b) => { if (b > 1) postMessage({ type: 'status', text: `Casting terrain shadows… ${a}/${b} moments` }); } });
      postMessage({ type: 'lightmap', req: m.req, ...r }, [r.lit.buffer, r.comm.buffer, r.h.buffer]);
      return;
    }
  } catch (err) { postMessage({ type: 'error', req: m.req, text: String(err && err.message || err) }); }
};
