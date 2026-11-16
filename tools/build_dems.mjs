// Packs reduced-resolution LOLA grids for in-browser horizon computation at custom sites.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { dem, ROOT } from './terrain_node.mjs';
function down(d, f) { const n = Math.floor(d.n / f), o = new Int16Array(n * n), off = Math.floor((d.n - n * f) / 2);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { let s = 0; for (let i = 0; i < f; i++) { const b = (off + r * f + i) * d.n + off + c * f; for (let j = 0; j < f; j++) s += d.d[b + j]; } o[r * n + c] = Math.round(s / (f * f)); }
  return { o, n }; }
function pack(name, i16, n, m, meta) { const e = new Int16Array(i16.length);
  for (let r = 0; r < m; r++) { e[r * n] = i16[r * n]; for (let c = 1; c < n; c++) e[r * n + c] = i16[r * n + c] - i16[r * n + c - 1]; }
  const gz = zlib.gzipSync(Buffer.from(e.buffer), { level: 9 }); fs.writeFileSync(path.join(ROOT, 'data', name + '.i16.gz'), gz);
  console.log(name, n, m, (gz.length / 1e6).toFixed(2), 'MB'); return { file: name + '.i16.gz', n, m, ...meta }; }
const man = { generator: 'tools/build_dems.mjs', source: 'NASA LRO LOLA GDR (block-averaged)', dems: [] };
let x = down(dem('s40'), 3);  man.dems.push(pack('sp85_120m', x.o, x.n, x.n, { type: 'polar', pole: -1, res: 120, latLimit: 85 }));
x = down(dem('s120'), 4);     man.dems.push(pack('sp75_480m', x.o, x.n, x.n, { type: 'polar', pole: -1, res: 480, latLimit: 75 }));
x = down(dem('n120'), 4);     man.dems.push(pack('np75_480m', x.o, x.n, x.n, { type: 'polar', pole: 1, res: 480, latLimit: 75 }));
const g = dem('g16'), W = g.w / 2, H = g.hgt / 2, o8 = new Int16Array(W * H);
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) o8[r * W + c] = Math.round((g.d[2 * r * g.w + 2 * c] + g.d[2 * r * g.w + 2 * c + 1] + g.d[(2 * r + 1) * g.w + 2 * c] + g.d[(2 * r + 1) * g.w + 2 * c + 1]) / 4);
man.dems.push(pack('global_8ppd', o8, W, H, { type: 'cyl', ppd: 8 }));
fs.writeFileSync(path.join(ROOT, 'data/dems.json'), JSON.stringify(man, null, 1));
