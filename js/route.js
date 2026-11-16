// Earthset: "Follow the light". Finds the drive that keeps a rover in sunlight for
// the most time over a mission, on real LOLA terrain, then compares it with staying
// parked at the landing site.
//
// Input: sunlight frames (0..255 per pixel, one frame every dt hours), the elevation
// grid, the start pixel, rover speed and the steepest slope it can drive.
// Method: dynamic programming over time. Between two frames the rover can move up to
// r pixels through passable ground; each step costs a tiny penalty so it does not
// wander without reason. We keep, for every pixel, the best total sunlight of any
// route that ends there, and where that route came from, then trace back the best.

export function sunRoute(F, T, N, res, H, start, o = {}) {
  const px = N * N, speed = o.speed || 100, dtH = o.dtH || 6, maxSlope = Math.tan((o.maxSlopeDeg || 20) * Math.PI / 180);
  const r = Math.max(1, Math.round(speed * dtH / res)), cost = 0.002;
  // passable = no neighbouring step steeper than the slope limit
  const pass = new Uint8Array(px);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i; let ok = 1;
    for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      if (Math.abs(H[jj * N + ii] - H[k]) / (res * Math.hypot(di, dj)) > maxSlope) { ok = 0; break; }
    }
    pass[k] = ok;
  }
  pass[start] = 1;
  const NEG = -1e9, ORIG = new Int32Array(T * px);
  let V = new Float32Array(px).fill(NEG); V[start] = F[start] / 255;
  let W = new Float32Array(px), W2 = new Float32Array(px), O = new Int32Array(px), O2 = new Int32Array(px);
  const nb = [[-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2], [-1, 0, 1], [1, 0, 1], [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2]];
  for (let n = 1; n < T; n++) {
    W.set(V); for (let k = 0; k < px; k++) O[k] = k;
    for (let step = 0; step < r; step++) {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i; let best = W[k], bo = O[k];
        if (pass[k]) for (const [di, dj, len] of nb) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
          const q = jj * N + ii, v = W[q] - cost * len; if (v > best) { best = v; bo = O[q]; }
        }
        W2[k] = best; O2[k] = bo;
      }
      [W, W2] = [W2, W]; [O, O2] = [O2, O];
    }
    const off = n * px;
    for (let k = 0; k < px; k++) { V[k] = W[k] > NEG / 2 ? W[k] + F[off + k] / 255 : NEG; ORIG[off + k] = O[k]; }
  }
  let end = 0; for (let k = 1; k < px; k++) if (V[k] > V[end]) end = k;
  const path = new Int32Array(T); path[T - 1] = end;
  for (let n = T - 1; n > 0; n--) path[n - 1] = ORIG[n * px + path[n]];
  const litPath = new Float32Array(T), litParked = new Float32Array(T); let dist = 0;
  for (let n = 0; n < T; n++) {
    litPath[n] = F[n * px + path[n]] / 255; litParked[n] = F[n * px + start] / 255;
    if (n) { const a = path[n - 1], b = path[n]; dist += Math.hypot(a % N - b % N, Math.floor(a / N) - Math.floor(b / N)) * res; }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const longestDark = (a) => { let run = 0, best = 0; for (const v of a) { if (v < 0.5) { if (++run > best) best = run; } else run = 0; } return best * dtH; };
  return { path, litPath, litParked, routePct: 100 * mean(litPath), parkedPct: 100 * mean(litParked), routeDarkH: longestDark(litPath), parkedDarkH: longestDark(litParked), distM: dist, r, passPct: 100 * mean(pass) };
}
