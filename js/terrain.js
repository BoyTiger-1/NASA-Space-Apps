// Earthset — terrain + horizon engine (runs in Node for precomputation and in
// the browser / Web Worker for custom sites).
// Topography: NASA LRO Lunar Orbiter Laser Altimeter (LOLA) gridded radius
// products, heights in metres relative to the 1737.4 km reference sphere.
// SI disclosure: written with the assistance of an SI coding tool (Claude).

import { R_MOON } from './ephem.js';
const RM = R_MOON * 1000;                 // metres
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// Polar stereographic (spherical, true scale at pole) LOLA grid.
export class PolarDEM {
  // data: Int16Array (n*n), res: metres/pixel, pole: -1 south / +1 north,
  // scale: metres per DN, latLimit: |lat| beyond which the grid is valid.
  constructor(data, n, res, pole, scale = 0.5, latLimit = 0, name = '') {
    this.d = data; this.n = n; this.res = res; this.pole = pole; this.scale = scale; this.name = name;
    this.off = n / 2 - 0.5;
    // largest stereographic radius (m) guaranteed inside the valid cap
    this.rmax = Math.min(2 * RM * Math.tan((90 - Math.abs(latLimit)) * D2R / 2), (n / 2 - 2) * res);
  }
  // q = unit vector in MOON_ME. Returns height (m) or NaN if outside the grid.
  height(qx, qy, qz) {
    const k = 2 * RM / (1 + this.pole * qz);
    const x = k * qy, y = -this.pole * k * qx;
    if (x * x + y * y > this.rmax * this.rmax) return NaN;
    const c = this.off + x / this.res, r = this.off - y / this.res;
    const c0 = Math.floor(c), r0 = Math.floor(r);
    const fc = c - c0, fr = r - r0, n = this.n, d = this.d, i = r0 * n + c0;
    return this.scale * ((d[i] * (1 - fc) + d[i + 1] * fc) * (1 - fr) + (d[i + n] * (1 - fc) + d[i + n + 1] * fc) * fr);
  }
}

// Simple cylindrical global LOLA grid (ppd pixels per degree, lon 0..360E).
export class CylDEM {
  constructor(data, ppd, scale = 0.5, name = '') {
    this.d = data; this.ppd = ppd; this.w = 360 * ppd; this.hgt = 180 * ppd; this.scale = scale; this.name = name;
    this.res = RM * D2R / ppd;
  }
  height(qx, qy, qz) {
    const lat = Math.asin(Math.max(-1, Math.min(1, qz))) * R2D;
    let lon = Math.atan2(qy, qx) * R2D; if (lon < 0) lon += 360;
    let c = lon * this.ppd - 0.5, r = (90 - lat) * this.ppd - 0.5;
    if (r < 0) r = 0; if (r > this.hgt - 1.001) r = this.hgt - 1.001;
    const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0, w = this.w, d = this.d;
    const ca = ((c0 % w) + w) % w, cb = (ca + 1) % w;
    return this.scale * ((d[r0 * w + ca] * (1 - fc) + d[r0 * w + cb] * fc) * (1 - fr) + (d[(r0 + 1) * w + ca] * (1 - fc) + d[(r0 + 1) * w + cb] * fc) * fr);
  }
}

// Ordered list of DEMs, finest first; the first one covering a point wins.
export class TerrainStack {
  constructor(dems) { this.dems = dems; }
  height(qx, qy, qz) {
    for (const d of this.dems) { const h = d.height(qx, qy, qz); if (h === h) return h; }
    return 0;
  }
  // resolution (m) of the finest DEM covering q
  resAt(qx, qy, qz) {
    for (const d of this.dems) { const h = d.height(qx, qy, qz); if (h === h) return d.res; }
    return 1e4;
  }
  heightLL(lat, lon) {
    const la = lat * D2R, lo = lon * D2R;
    return this.height(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  }
}

// Horizon mask: for each azimuth (clockwise from north) the elevation angle of
// the highest terrain along that bearing, as seen from `mast` metres above the
// surface. Accounts for the Moon's curvature; there is no atmosphere so no
// refraction. Returns { el: Float32Array(nAz) deg, dist: Float32Array km,
// ground: site surface height m }.
export function computeHorizon(terrain, latDeg, lonDeg, mast = 2, opts = {}) {
  const nAz = opts.nAz || 720, maxDist = opts.maxDist || 400e3, growth = opts.growth || 0.003;
  const la = latDeg * D2R, lo = lonDeg * D2R;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  const up = [cl * co, cl * so, sl], east = [-so, co, 0], north = [-sl * co, -sl * so, cl];
  const ground = terrain.height(up[0], up[1], up[2]);
  const rp = RM + ground + mast;
  const res0 = terrain.resAt(up[0], up[1], up[2]);
  const el = new Float32Array(nAz), dist = new Float32Array(nAz);
  for (let a = 0; a < nAz; a++) {
    const az = (a * 360 / nAz) * D2R, ca = Math.cos(az), sa = Math.sin(az);
    const tx = ca * north[0] + sa * east[0], ty = ca * north[1] + sa * east[1], tz = ca * north[2] + sa * east[2];
    let best = -Infinity, bd = 0, s = res0 * 0.5;
    while (s < maxDist) {
      const th = s / RM, ct = Math.cos(th), st = Math.sin(th);
      const qx = ct * up[0] + st * tx, qy = ct * up[1] + st * ty, qz = ct * up[2] + st * tz;
      const rq = RM + terrain.height(qx, qy, qz);
      const t = (rq * ct - rp) / (rq * st);          // tan(elevation)
      if (t > best) { best = t; bd = s; }
      // nothing beyond can beat `best` once even an 11 km peak would sit below it
      if (s > 20e3 && ((RM + 11000) * ct - rp) / ((RM + 11000) * st) < best) break;
      s += Math.max(res0 * 0.5, s * growth);
    }
    el[a] = Math.atan(best) * R2D; dist[a] = bd / 1000;
  }
  return { el, dist, ground, mast, nAz };
}

// Interpolated horizon elevation (deg) at azimuth az (deg).
export function horizonAt(hz, az) {
  const n = hz.el.length, x = (((az % 360) + 360) % 360) * n / 360;
  const i = Math.floor(x), f = x - i;
  return hz.el[i % n] * (1 - f) + hz.el[(i + 1) % n] * f;
}

// Fraction (0..1) of a disc of angular radius `rad` (deg) centred at (az, el)
// that is above the terrain horizon. Integrates in vertical strips.
export function discVisible(hz, az, el, rad) {
  const top = el + rad;
  // quick outs using a conservative horizon sample
  const h0 = horizonAt(hz, az);
  if (rad <= 0) return el > h0 ? 1 : 0;
  const cosEl = Math.max(0.05, Math.cos(el * D2R));
  const N = 9; let vis = 0, tot = 0;
  for (let k = 0; k < N; k++) {
    const u = ((k + 0.5) / N) * 2 - 1;            // -1..1 across the disc
    const half = Math.sqrt(1 - u * u) * rad;      // half-height of strip
    const h = horizonAt(hz, az + u * rad / cosEl);
    const lo = el - half, hi = el + half;
    tot += 2 * half;
    if (h <= lo) vis += 2 * half; else if (h < hi) vis += hi - h;
  }
  return top <= -90 ? 0 : vis / tot;
}

// Lat/lon (deg) of the point `de` metres east and `dn` metres north of a site.
export function offsetLL(latDeg, lonDeg, de, dn) {
  const la = latDeg * D2R, lo = lonDeg * D2R, cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  const x = cl * co * RM - so * de - sl * co * dn, y = cl * so * RM + co * de - sl * so * dn, z = sl * RM + cl * dn;
  const r = Math.hypot(x, y, z);
  return { lat: Math.asin(z / r) * R2D, lon: Math.atan2(y, x) * R2D, q: [x / r, y / r, z / r] };
}

// Light map: for an N x N grid of points around a site, the fraction of the
// Sun's disc above the terrain and whether Earth's centre is visible, averaged
// over the given times. Every pixel uses its own local vertical, so the result
// is geometrically exact for the DEM (terrain considered out to maxDist).
// sunEarth(t) must return { s: [x,y,z] unit Sun direction, rS: Sun angular
// radius (rad), e: [x,y,z] Earth position in metres } in MOON_ME.
export function lightMap(terrain, latDeg, lonDeg, mast, N, res, times, sunEarth, opts = {}) {
  const maxDist = opts.maxDist || 150e3, growth = opts.growth || 0.04, onProgress = opts.onProgress;
  const px = N * N, U = new Float64Array(px * 3), RP = new Float64Array(px), H = new Float32Array(px);
  for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++, k++) {
    const o = offsetLL(latDeg, lonDeg, (i - (N - 1) / 2) * res, ((N - 1) / 2 - j) * res);
    U[3 * k] = o.q[0]; U[3 * k + 1] = o.q[1]; U[3 * k + 2] = o.q[2];
    H[k] = terrain.height(o.q[0], o.q[1], o.q[2]); RP[k] = RM + H[k] + mast;
  }
  // the marching distances are the same for every ray: precompute their trig
  const CT = [], ST = [];
  for (let s = res * 0.7; s < maxDist; s += Math.max(res * 0.7, s * growth)) { CT.push(Math.cos(s / RM)); ST.push(Math.sin(s / RM)); }
  const M = CT.length;
  const march = (ux, uy, uz, tx, ty, tz, rp, stop) => {
    let best = -Infinity;
    for (let m = 0; m < M; m++) {
      const ct = CT[m], st = ST[m];
      const rq = RM + terrain.height(ct * ux + st * tx, ct * uy + st * ty, ct * uz + st * tz);
      const tn = (rq * ct - rp) / (rq * st);
      if (tn > best) { best = tn; if (best >= stop) return best; }
    }
    return best;
  };
  const lit = new Float32Array(px), comm = new Float32Array(px);
  for (let n = 0; n < times.length; n++) {
    const { s, rS, e } = sunEarth(times[n]);
    for (let k = 0; k < px; k++) {
      const ux = U[3 * k], uy = U[3 * k + 1], uz = U[3 * k + 2], rp = RP[k];
      const su = s[0] * ux + s[1] * uy + s[2] * uz, el = Math.asin(su);
      if (el > -rS - 0.2) {
        let tx = s[0] - su * ux, ty = s[1] - su * uy, tz = s[2] - su * uz; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const hmax = Math.atan(march(ux, uy, uz, tx, ty, tz, rp, Math.tan(Math.min(1.55, el + rS))));
        const f = (el + rS - hmax) / (2 * rS); lit[k] += f <= 0 ? 0 : f >= 1 ? 1 : f;
      }
      let dx = e[0] - rp * ux, dy = e[1] - rp * uy, dz = e[2] - rp * uz; const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      const eu = dx * ux + dy * uy + dz * uz;
      if (eu > -0.2) {
        let tx = dx - eu * ux, ty = dy - eu * uy, tz = dz - eu * uz; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const stop = eu / Math.sqrt(Math.max(1e-12, 1 - eu * eu));
        if (march(ux, uy, uz, tx, ty, tz, rp, stop) < stop) comm[k] += 1;
      }
    }
    if (onProgress) onProgress(n + 1, times.length);
  }
  for (let k = 0; k < px; k++) { lit[k] /= times.length; comm[k] /= times.length; }
  return { N, res, lit, comm, h: H };
}

// ---- compact DEM container used by the browser (row-delta int16, gzip) ----
export function deltaDecode(i16, n, m) {
  for (let r = 0; r < m; r++) { let o = r * n; for (let c = 1; c < n; c++) i16[o + c] = (i16[o + c] + i16[o + c - 1]) | 0; }
  return i16;
}
export async function fetchGzI16(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch ' + url + ' ' + res.status);
  let buf;
  const ab = await res.arrayBuffer();
  const u8 = new Uint8Array(ab);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    buf = await new Response(new Blob([ab]).stream().pipeThrough(ds)).arrayBuffer();
  } else buf = ab;                               // server already decompressed it
  return new Int16Array(buf);
}
