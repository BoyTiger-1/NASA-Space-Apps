// Earthset: base camp finder. Given a year of sunlight and Earth visibility for every
// pixel around a site, find the best places for a long-stay base: lit and in view of
// Earth at the same time as often as possible, on gentle slopes, and a short drive
// from ground that stayed dark all year (where water ice can survive).
// SI disclosure: written with the assistance of an SI coding tool (Claude).

export function findBaseCamps(r, o = {}) {
  const { N, res, both, lit, comm, h, maxLit } = r, px = N * N;
  const maxSlope = Math.tan((o.maxSlopeDeg || 10) * Math.PI / 180), spacing = o.spacingM || 1000;
  // slope from the elevation grid
  const slope = new Float32Array(px);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // steepest step to any neighbour, so a sharp ridge top is not mistaken for flat ground
    let m = 0; const k = j * N + i;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; m = Math.max(m, Math.abs(h[jj * N + ii] - h[k]) / (res * Math.hypot(di, dj))); }
    slope[k] = m;
  }
  // ground that never saw any Sun in the year sampled: likely permanently shadowed
  const dark = new Uint8Array(px); let nDark = 0;
  for (let k = 0; k < px; k++) if (maxLit[k] < 0.01) { dark[k] = 1; nDark++; }
  // distance (m) to the nearest always-dark pixel, by a two-pass chamfer transform
  const D = new Float32Array(px).fill(1e9), a = res, b = res * Math.SQRT2;
  for (let k = 0; k < px; k++) if (dark[k]) D[k] = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; let d = D[k];
    if (i > 0) d = Math.min(d, D[k - 1] + a); if (j > 0) { d = Math.min(d, D[k - N] + a); if (i > 0) d = Math.min(d, D[k - N - 1] + b); if (i < N - 1) d = Math.min(d, D[k - N + 1] + b); } D[k] = d; }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) { const k = j * N + i; let d = D[k];
    if (i < N - 1) d = Math.min(d, D[k + 1] + a); if (j < N - 1) { d = Math.min(d, D[k + N] + a); if (i < N - 1) d = Math.min(d, D[k + N + 1] + b); if (i > 0) d = Math.min(d, D[k + N - 1] + b); } D[k] = d; }
  // score: time with Sun AND Earth, with a bonus for being within 5 km of always-dark ground
  const score = new Float32Array(px), c = (N - 1) / 2;
  for (let k = 0; k < px; k++) {
    const i = k % N, j = Math.floor(k / N), edge = Math.min(i, j, N - 1 - i, N - 1 - j);
    score[k] = (slope[k] > maxSlope || dark[k] || edge < 3) ? -1 : both[k] + (D[k] <= 5000 ? 0.05 * (1 - D[k] / 5000) : 0);
  }
  const order = Array.from({ length: px }, (_, k) => k).filter(k => score[k] >= 0).sort((x, y) => score[y] - score[x]);
  const spots = [];
  for (const k of order) {
    const i = k % N, j = Math.floor(k / N);
    if (spots.some(s => Math.hypot(s.i - i, s.j - j) * res < spacing)) continue;
    spots.push({ k, i, j, de: (i - c) * res, dn: (c - j) * res, both: both[k], lit: lit[k], comm: comm[k], iceM: D[k] < 1e8 ? D[k] : null, slopeDeg: Math.atan(slope[k]) * 180 / Math.PI, h: h[k] });
    if (spots.length >= (o.top || 5)) break;
  }
  const here = Math.round(c) * N + Math.round(c);
  return { spots, dark, nDarkPct: 100 * nDark / px, here: { both: both[here], lit: lit[here], comm: comm[here], iceM: D[here] < 1e8 ? D[here] : null } };
}
