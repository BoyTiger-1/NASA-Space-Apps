// Earthset: mission-window analysis (shared by the app, the worker and Node tests).
// SI disclosure: written with the assistance of an SI coding tool (Claude).
import { azel, makeSite, R_SUN, R_EARTH } from './ephem.js';
import { discVisible } from './terrain.js';

const R2D = 180 / Math.PI;
export const HOUR = 3600e3, DAY = 86400e3;
export const LIT_MIN = 0.02;     // Sun disc fraction above which the site counts as sunlit
export const COMM_MIN = 0.5;     // Earth disc fraction (centre above terrain) for a DTE link

export const DEFAULT_RULES = { minSunPct: 70, maxDarkH: 48, minCommPct: 50, needSunAtLanding: true, needEarthAtLanding: true };

// Hourly (or `step` ms) time series of Sun/Earth geometry at a site, including
// the fraction of each disc that clears the terrain horizon `hz`.
export function buildSeries(eph, site, hz, msStart, msEnd, step = HOUR) {
  const g = site.p ? site : makeSite(site.lat, site.lon, ((hz.ground || 0) + (hz.mast || 0)) / 1000);
  const n = Math.max(1, Math.floor((msEnd - msStart) / step) + 1);
  const S = { t0: msStart, step, n, sunEl: new Float32Array(n), sunAz: new Float32Array(n), sunVis: new Float32Array(n), earthEl: new Float32Array(n), earthAz: new Float32Array(n), earthVis: new Float32Array(n), ecl: new Float32Array(n) };
  const o = {};
  for (let i = 0; i < n; i++) {
    const t = msStart + i * step;
    azel(eph, 0, t, g, o);
    S.sunEl[i] = o.el; S.sunAz[i] = o.az;
    const rS = Math.asin(R_SUN / o.dist) * R2D;
    S.sunVis[i] = discVisible(hz, o.az, o.el, rS);
    azel(eph, 1, t, g, o);
    S.earthEl[i] = o.el; S.earthAz[i] = o.az;
    const rE = Math.asin(R_EARTH / o.dist) * R2D;
    S.earthVis[i] = discVisible(hz, o.az, o.el, rE);
    // Earth passing in front of the Sun (a lunar eclipse seen from the Moon):
    // geometric fraction of the solar disc covered by Earth's disc.
    const cs = Math.sin(S.sunEl[i] / R2D) * Math.sin(o.el / R2D) + Math.cos(S.sunEl[i] / R2D) * Math.cos(o.el / R2D) * Math.cos((S.sunAz[i] - o.az) / R2D);
    const sep = Math.acos(Math.max(-1, Math.min(1, cs))) * R2D;
    const cov = sep < rE + rS ? discOverlap(sep, rS, rE) : 0;
    S.ecl[i] = cov; if (cov > 0) S.sunVis[i] *= 1 - cov;
  }
  // prefix sums for O(1) window averages
  S.cSun = new Float64Array(n + 1); S.cComm = new Float64Array(n + 1); S.cFlat = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    S.cSun[i + 1] = S.cSun[i] + S.sunVis[i];
    S.cComm[i + 1] = S.cComm[i] + (S.earthVis[i] >= COMM_MIN ? 1 : 0);
    S.cFlat[i + 1] = S.cFlat[i] + S.sunVis[i] * Math.max(0, Math.sin(S.sunEl[i] / R2D));
  }
  return S;
}

// Fraction of a disc of radius r covered by a disc of radius R whose centre is d away.
export function discOverlap(d, r, R) {
  if (d >= r + R) return 0;
  if (d <= Math.abs(R - r)) return R >= r ? 1 : (R * R) / (r * r);
  const a = r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r)) + R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R))
    - 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  return a / (Math.PI * r * r);
}

// Metrics for the mission window [i0, i1) (indices into the series).
export function windowMetrics(S, i0, i1) {
  i0 = Math.max(0, i0); i1 = Math.min(S.n, i1);
  const len = Math.max(1, i1 - i0), hStep = S.step / HOUR;
  let dark = 0, maxDark = 0, out = 0, maxOut = 0, toSunset = -1, toEarthset = -1, peak = -90, ecl = 0;
  for (let i = i0; i < i1; i++) {
    if (S.sunVis[i] < LIT_MIN) { dark++; if (dark > maxDark) maxDark = dark; if (toSunset < 0) toSunset = i - i0; } else dark = 0;
    if (S.earthVis[i] < COMM_MIN) { out++; if (out > maxOut) maxOut = out; if (toEarthset < 0) toEarthset = i - i0; } else out = 0;
    if (S.sunEl[i] > peak) peak = S.sunEl[i];
    if (S.ecl[i] > ecl) ecl = S.ecl[i];
  }
  return {
    sunPct: 100 * (S.cSun[i1] - S.cSun[i0]) / len,
    commPct: 100 * (S.cComm[i1] - S.cComm[i0]) / len,
    flatPct: 100 * (S.cFlat[i1] - S.cFlat[i0]) / len,   // horizontal-panel power index
    maxDarkH: maxDark * hStep, maxOutageH: maxOut * hStep,
    toSunsetH: toSunset < 0 ? null : toSunset * hStep,   // null = Sun never sets in window
    toEarthsetH: toEarthset < 0 ? null : toEarthset * hStep,
    sunAtLanding: S.sunVis[i0] >= LIT_MIN, earthAtLanding: S.earthVis[i0] >= COMM_MIN,
    peakSunEl: peak, hours: len * hStep, eclipse: ecl,
  };
}

// GO / MARGINAL / NO-GO against the planner's rules.
export function verdict(m, rules = DEFAULT_RULES) {
  const fails = [], warns = [];
  if (rules.needSunAtLanding && !m.sunAtLanding) fails.push('Sun is below the terrain horizon at touchdown');
  if (rules.needEarthAtLanding && !m.earthAtLanding) fails.push('Earth is not in view at touchdown (no direct link)');
  if (m.sunPct < rules.minSunPct) (m.sunPct < rules.minSunPct * 0.8 ? fails : warns).push(`sunlit ${m.sunPct.toFixed(0)}% of the mission (need ${rules.minSunPct}%)`);
  if (m.maxDarkH > rules.maxDarkH) (m.maxDarkH > rules.maxDarkH * 1.5 ? fails : warns).push(`${fmtDur(m.maxDarkH)} of continuous darkness (limit ${fmtDur(rules.maxDarkH)})`);
  if (m.commPct < rules.minCommPct) (m.commPct < rules.minCommPct * 0.8 ? fails : warns).push(`Earth link ${m.commPct.toFixed(0)}% of the mission (need ${rules.minCommPct}%)`);
  const level = fails.length ? 'nogo' : warns.length ? 'marginal' : 'go';
  // 0..100 score used for ranking alternatives
  const score = Math.max(0, Math.min(100,
    0.45 * Math.min(100, m.sunPct) + 0.30 * Math.min(100, m.commPct) + 0.25 * 100 * Math.max(0, 1 - m.maxDarkH / Math.max(1, m.hours))
    - (m.sunAtLanding ? 0 : 25) - (m.earthAtLanding ? 0 : 15)));
  return { level, fails, warns, score };
}

// Landing-date calendar: evaluate a mission of `durH` hours starting at each
// `everyH` hours across the series. Returns per-start arrays.
export function calendar(S, durH, everyH = 24, rules = DEFAULT_RULES) {
  const hStep = S.step / HOUR, dur = Math.round(durH / hStep), ev = Math.max(1, Math.round(everyH / hStep));
  const count = Math.max(0, Math.floor((S.n - dur) / ev) + 1);
  const C = { count, t0: S.t0, every: ev * S.step, sunPct: new Float32Array(count), commPct: new Float32Array(count), maxDarkH: new Float32Array(count), score: new Float32Array(count), level: new Uint8Array(count) };
  for (let k = 0; k < count; k++) {
    const m = windowMetrics(S, k * ev, k * ev + dur), v = verdict(m, rules);
    C.sunPct[k] = m.sunPct; C.commPct[k] = m.commPct; C.maxDarkH[k] = m.maxDarkH; C.score[k] = v.score;
    C.level[k] = v.level === 'go' ? 2 : v.level === 'marginal' ? 1 : 0;
  }
  return C;
}

// Simple lander energy model over the window [i0, i1): a battery charged by a
// solar array and drained by the lander. `cfg`: arrayW (output in full Sun),
// loadW (awake), sleepW (when the Sun is hidden), battWh, tracking (true = the
// array faces the Sun; false = flat on the deck). Returns state of charge 0..1.
export function simulateEnergy(S, i0, i1, cfg) {
  i0 = Math.max(0, i0); i1 = Math.min(S.n, i1);
  const n = i1 - i0, soc = new Float32Array(n), hStep = S.step / HOUR, cap = Math.max(1, cfg.battWh);
  let e = cap * (cfg.startSoc == null ? 1 : cfg.startSoc), dead = -1, deadH = 0, min = 1, gen = 0;
  for (let k = 0; k < n; k++) {
    const i = i0 + k, vis = S.sunVis[i];
    const pin = cfg.arrayW * vis * (cfg.tracking ? 1 : Math.max(0, Math.sin(S.sunEl[i] / R2D)));
    const load = vis >= LIT_MIN ? cfg.loadW : cfg.sleepW;
    gen += pin * hStep;
    e += (pin - load) * hStep; if (e > cap) e = cap;
    if (e <= 0) { e = 0; deadH += hStep; if (dead < 0) dead = k; }
    soc[k] = e / cap; if (soc[k] < min) min = soc[k];
  }
  return { soc, deadAtH: dead < 0 ? null : dead * hStep, deadH, minSoc: min, generatedWh: gen };
}

// Next change of state (rise/set) after index i for a visibility array.
export function nextEvent(vis, i, thr) {
  const up = vis[i] >= thr;
  for (let j = i + 1; j < vis.length; j++) if ((vis[j] >= thr) !== up) return { up, idx: j };
  return { up, idx: -1 };
}

export function fmtDur(h) {
  if (h == null) return 'none';
  if (h < 1) return Math.round(h * 60) + ' min';
  if (h < 48) return (Math.round(h * 10) / 10) + ' h';
  const d = Math.floor(h / 24), r = Math.round(h - d * 24);
  return d + ' d ' + r + ' h';
}
