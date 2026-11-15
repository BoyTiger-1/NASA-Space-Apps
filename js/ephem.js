// Earthset: ephemeris core.
// Evaluates Chebyshev fits of NASA/JPL DE440 (see tools/build_ephem.py) to get
// the apparent Sun and Earth vectors in the lunar Mean-Earth body-fixed frame,
// then converts them to azimuth/elevation at a surface site.
// SI disclosure: written with the assistance of an SI coding tool (Claude).

export const R_MOON = 1737.4;            // km, LOLA / IAU reference sphere
export const R_SUN = 695700.0;           // km (IAU nominal solar radius)
export const R_EARTH = 6378.137;         // km
const J2000_UTC_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const TT_MINUS_UTC = 69.184;             // s, valid 2017-01-01 onward (37 leap s + 32.184)
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export class Ephemeris {
  constructor(header, buffer) {
    this.h = header;
    this.c = new Float32Array(buffer);
    this.n = header.ncoef;
    this.t0 = header.et0;
    this.seg = header.seg_seconds;
    this.nseg = header.nseg;
    this.msMin = etToMs(this.t0);
    this.msMax = etToMs(this.t0 + this.seg * this.nseg) - 1000;
  }
  // body: 0 = Sun, 1 = Earth. Returns [x,y,z] km, Moon-centred, MOON_ME frame.
  pos(body, ms, out) {
    const et = msToEt(ms);
    let i = Math.floor((et - this.t0) / this.seg);
    if (i < 0) i = 0; else if (i >= this.nseg) i = this.nseg - 1;
    const x = 2 * (et - (this.t0 + i * this.seg)) / this.seg - 1;
    const n = this.n, c = this.c;
    let base = ((i * 2 + body) * 3) * n;
    out = out || [0, 0, 0];
    const x2 = 2 * x;
    for (let k = 0; k < 3; k++, base += n) {
      // Clenshaw recurrence
      let b1 = 0, b2 = 0;
      for (let j = n - 1; j >= 1; j--) { const t = x2 * b1 - b2 + c[base + j]; b2 = b1; b1 = t; }
      out[k] = x * b1 - b2 + c[base];
    }
    return out;
  }
}

export function msToEt(ms) { return (ms - J2000_UTC_MS) / 1000 + TT_MINUS_UTC; }
export function etToMs(et) { return (et - TT_MINUS_UTC) * 1000 + J2000_UTC_MS; }

// Local east/north/up basis for a site on the reference sphere + height (km).
export function makeSite(latDeg, lonDeg, hKm = 0) {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  const r = R_MOON + hKm;
  return {
    lat: latDeg, lon: lonDeg, h: hKm,
    p: [r * cl * co, r * cl * so, r * sl],
    up: [cl * co, cl * so, sl],
    east: [-so, co, 0],
    north: [-sl * co, -sl * so, cl],
  };
}

// Azimuth (deg, clockwise from north), elevation (deg), distance (km) of a body.
const _v = [0, 0, 0];
export function azel(eph, body, ms, site, out) {
  eph.pos(body, ms, _v);
  const dx = _v[0] - site.p[0], dy = _v[1] - site.p[1], dz = _v[2] - site.p[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const u = (dx * site.up[0] + dy * site.up[1] + dz * site.up[2]) / d;
  const e = dx * site.east[0] + dy * site.east[1];
  const n = dx * site.north[0] + dy * site.north[1] + dz * site.north[2];
  let az = Math.atan2(e, n) * R2D; if (az < 0) az += 360;
  out = out || {};
  out.az = az; out.el = Math.asin(u) * R2D; out.dist = d;
  return out;
}

// Sub-solar / sub-Earth point (deg).
export function subPoint(eph, body, ms) {
  const v = eph.pos(body, ms);
  const d = Math.hypot(v[0], v[1], v[2]);
  return { lat: Math.asin(v[2] / d) * R2D, lon: Math.atan2(v[1], v[0]) * R2D, dist: d };
}

export async function loadEphemeris(base = 'data/') {
  const [h, b] = await Promise.all([
    fetch(base + 'ephem.json').then(r => r.json()),
    fetch(base + 'ephem.bin').then(r => r.arrayBuffer()),
  ]);
  return new Ephemeris(h, b);
}
