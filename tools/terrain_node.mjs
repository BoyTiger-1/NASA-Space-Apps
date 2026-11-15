// Loads full-resolution LOLA rasters from raw/lola for precomputation (Node).
// SI disclosure: written with the assistance of an SI coding tool (Claude).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolarDEM, CylDEM, TerrainStack } from '../js/terrain.js';
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const L = path.join(ROOT, 'raw/lola');
function i16(f) { const b = fs.readFileSync(path.join(L, f)); return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2); }
const cache = {};
export function dem(name) {
  if (cache[name]) return cache[name];
  const P = { s20: ['ldem_875s_20m.img', 7584, 20, -1, 87.5], s40: ['ldem_85s_40m.img', 7584, 40, -1, 85], s80: ['ldem_80s_80m.img', 7600, 80, -1, 80], s120: ['ldem_75s_120m.img', 7624, 120, -1, 75], n120: ['ldem_75n_120m.img', 7624, 120, 1, 75] };
  const C = { g64: ['ldem_64.img', 64], g16: ['ldem_16.img', 16], g4: ['ldem_4.img', 4] };
  if (P[name]) { const [f, n, res, pole, lim] = P[name]; return cache[name] = new PolarDEM(i16(f), n, res, pole, 0.5, lim, name); }
  const [f, ppd] = C[name]; return cache[name] = new CylDEM(i16(f), ppd, 0.5, name);
}
export function fullStack() { return new TerrainStack(['s20', 's40', 's80', 's120', 'n120', 'g64'].map(dem)); }
