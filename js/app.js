// Earthset — application UI.
// SI disclosure: written with the assistance of an SI coding tool (Claude).
import { loadEphemeris, makeSite, azel, subPoint, R_SUN, R_EARTH, R_MOON } from './ephem.js';
import { horizonAt, discVisible } from './terrain.js';
import { buildSeries, windowMetrics, verdict, calendar, nextEvent, fmtDur, HOUR, DAY, DEFAULT_RULES, LIT_MIN, COMM_MIN } from './analysis.js';

const $ = (q) => document.querySelector(q);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const COLORS = ['#ffc857', '#5aa9ff', '#c58bff', '#3ddc97'];
const SPAN_DAYS = 730, MAX_DUR = 180;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const st = { sel: ['ridge', 'im2', 'im1'], focus: 'ridge', base: Date.UTC(2027, 0, 15), slip: 0, dur: 14, cur: 0, rules: { ...DEFAULT_RULES }, mode: 'explorer', map: 'south' };
let eph, sites = [], worker, reqN = 0, playing = null, nearby = null, customN = 0;
const pending = {}, seriesCache = new Map(), imgs = {};

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
function fmtDate(ms, short) { const d = new Date(ms); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` + (short ? '' : ` ${pad(d.getUTCHours())}:00 UTC`); }
function toLocalInput(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00`; }
function fromLocalInput(v) { const m = v.match(/(\d+)-(\d+)-(\d+)T(\d+)/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]) : NaN; }
function fmtLL(s) { return `${Math.abs(s.lat).toFixed(4)}°${s.lat < 0 ? 'S' : 'N'}  ${Math.abs(s.lon).toFixed(4)}°${s.lon < 0 ? 'W' : 'E'}`; }
function toast(t, ms = 2200) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); if (ms) toast.t = setTimeout(() => e.hidden = true, ms); }
function fit(cv, hCss) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || cv.parentElement.clientWidth, h = hCss || cv.clientHeight;
  if (hCss) cv.style.height = hCss + 'px';
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  return { c, w, h };
}
const site = (id) => sites.find(s => s.id === id);
const colorOf = (id) => COLORS[st.sel.indexOf(id) % COLORS.length] || '#fff';
const landMs = () => st.base + st.slip * DAY;
const L = () => st.slip * 24;                       // landing index into a series
const N = () => st.dur * 24;                        // mission length in steps

function series(s) {
  const key = s.id + '|' + st.base;
  let S = seriesCache.get(key);
  if (!S) { S = buildSeries(eph, s.geom, s.hzo, st.base, st.base + (SPAN_DAYS + MAX_DUR + 1) * DAY, HOUR); if (seriesCache.size > 40) seriesCache.clear(); seriesCache.set(key, S); }
  return S;
}
function cal(s) {
  const S = series(s), key = st.dur + JSON.stringify(st.rules);
  if (S._calKey !== key) { S._cal = calendar({ ...S, n: SPAN_DAYS * 24 + N() }, N(), 24, st.rules); S._calKey = key; }
  return S._cal;
}
function prepSite(s) {
  s.hzo = { el: s.hzo ? s.hzo.el : Float32Array.from(s.hz, v => v / 100), ground: s.ground, mast: s.mast };
  s.geom = makeSite(s.lat, s.lon, (s.ground + s.mast) / 1000);
  return s;
}

// ---------- site list ----------
function renderSites() {
  const groups = {};
  for (const s of sites) (groups[s.group] = groups[s.group] || []).push(s);
  let h = '';
  for (const g of Object.keys(groups)) {
    h += `<div class="sgroup"><h3>${g}</h3>`;
    for (const s of groups[g]) {
      const on = st.sel.includes(s.id);
      h += `<div class="site${s.id === st.focus ? ' focus' : ''}" data-id="${s.id}"><input type="checkbox" ${on ? 'checked' : ''} aria-label="Compare ${s.name}"><span class="dot" style="background:${on ? colorOf(s.id) : 'transparent'}"></span><span class="nm">${s.name}</span>${s.custom ? '<button class="rm" title="Remove">×</button>' : ''}</div>`;
    }
    h += '</div>';
  }
  $('#siteList').innerHTML = h;
}
$('#siteList').addEventListener('click', (e) => {
  const row = e.target.closest('.site'); if (!row) return; const id = row.dataset.id;
  if (e.target.classList.contains('rm')) { sites = sites.filter(s => s.id !== id); st.sel = st.sel.filter(x => x !== id); if (st.focus === id) st.focus = st.sel[0] || sites[0].id; if (!st.sel.length) st.sel = [st.focus]; update(); return; }
  if (e.target.tagName === 'INPUT') {
    if (e.target.checked) { if (st.sel.length >= 4) { e.target.checked = false; toast('Compare up to four sites at once'); return; } st.sel.push(id); st.focus = id; }
    else { if (st.sel.length === 1) { e.target.checked = true; return; } st.sel = st.sel.filter(x => x !== id); if (st.focus === id) st.focus = st.sel[0]; }
  } else { if (!st.sel.includes(id)) { if (st.sel.length >= 4) st.sel.pop(); st.sel.push(id); } st.focus = id; }
  nearby = null; update();
});

// ---------- cards ----------
function sentence(s, m) {
  const out = [];
  if (m.sunPct < 0.5) out.push('The Sun never clears the surrounding terrain here during this mission — no solar power at all.');
  else if (m.toSunsetH == null) out.push('The Sun stays above the terrain for the entire mission.');
  else if (!m.sunAtLanding) out.push(`It is dark at touchdown, and the longest stretch without sunlight is ${fmtDur(m.maxDarkH)}.`);
  else out.push(`Sunlight is first lost ${fmtDur(m.toSunsetH)} after landing; the longest dark stretch is ${fmtDur(m.maxDarkH)}.`);
  if (m.commPct < 0.5) out.push(Math.abs(s.lon) > 100 && Math.abs(s.lat) < 80 ? 'This is the far side: Earth never rises, so it needs a relay satellite.' : 'Earth stays hidden behind terrain the whole time — no direct radio link.');
  else if (m.toEarthsetH == null) out.push('Earth is in view the whole time, so the lander can always talk directly to Earth.');
  else out.push(`Earth is hidden for up to ${fmtDur(m.maxOutageH)} at a time.`);
  if (m.eclipse > 0.01) out.push(`Heads-up: Earth passes in front of the Sun during this mission (an eclipse), covering up to ${(m.eclipse * 100).toFixed(0)}% of it.`);
  return out.join(' ');
}
function renderCards() {
  let h = '';
  for (const id of st.sel) {
    const s = site(id), S = series(s), m = windowMetrics(S, L(), L() + N()), v = verdict(m, st.rules);
    s._m = m; s._v = v;
    h += `<article class="card${id === st.focus ? ' focus' : ''}" data-id="${id}" style="--c:${colorOf(id)}">
      <h3><span>${s.name}</span><span class="badge ${v.level}">${v.level === 'go' ? 'GO' : v.level === 'marginal' ? 'MARGINAL' : 'NO-GO'}</span></h3>
      <div class="ll">${fmtLL(s)} · ${s.ground >= 0 ? '+' : ''}${s.ground} m${s.approx ? ' · illustrative point' : ''}${s.custom ? ` · ${s.res} m grid` : ''}</div>
      <div class="kv">
        <div><b class="sun">${m.sunPct.toFixed(0)}%</b>sunlit</div><div><b class="earth">${m.commPct.toFixed(0)}%</b>Earth link</div>
        <div><b>${fmtDur(m.maxDarkH)}</b>longest darkness</div><div><b>${fmtDur(m.maxOutageH)}</b>longest link outage</div>
        <div class="planner-only"><b>${m.peakSunEl.toFixed(1)}°</b>peak Sun elevation</div><div class="planner-only"><b>${m.flatPct.toFixed(0)}%</b>flat-panel power index</div>
      </div>
      <p class="say">${sentence(s, m)}</p>
      ${v.fails.length ? `<p class="why">✕ ${v.fails.join('; ')}</p>` : ''}${v.warns.length ? `<p class="why w">! ${v.warns.join('; ')}</p>` : ''}
    </article>`;
  }
  $('#cards').innerHTML = h;
}
$('#cards').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) { st.focus = c.dataset.id; nearby = null; update(); } });

// ---------- sky panorama ----------
function drawPano() {
  const s = site(st.focus), S = series(s), hz = s.hzo, i = L() + st.cur;
  $('#panoSite').textContent = '· ' + s.name;
  const { c, w, h } = fit($('#pano'), 300);
  const ml = 34, mb = 20, mt = 8, pw = w - ml - 6, ph = h - mb - mt;
  let lo = 90, hi = -90; for (const v of hz.el) { if (v < lo) lo = v; if (v > hi) hi = v; }
  let top = Math.max(hi + 2, 8);
  for (let k = L(); k < L() + N(); k++) { if (S.sunEl[k] + 2 > top) top = S.sunEl[k] + 2; if (S.earthEl[k] + 3 > top) top = S.earthEl[k] + 3; }
  top = Math.min(90, top); const bot = Math.max(-8, Math.floor(lo) - 1.5);
  const X = (az) => ml + az / 360 * pw, Y = (el) => mt + (top - el) / (top - bot) * ph;
  const lit = S.sunVis[i];
  const g = c.createLinearGradient(0, mt, 0, mt + ph); g.addColorStop(0, '#02030a'); g.addColorStop(1, '#0a1020'); c.fillStyle = g; c.fillRect(ml, mt, pw, ph);
  c.save(); c.beginPath(); c.rect(ml, mt, pw, ph); c.clip();
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 160; k++) { c.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`; c.fillRect(ml + rnd() * pw, mt + rnd() * ph, 1, 1); }
  // elevation grid
  const stepEl = top - bot > 40 ? 15 : top - bot > 16 ? 5 : 2;
  c.strokeStyle = '#ffffff12'; c.fillStyle = '#8f9ab6'; c.font = '10px ui-monospace,Menlo,monospace'; c.lineWidth = 1;
  for (let e = Math.ceil(bot / stepEl) * stepEl; e <= top; e += stepEl) { c.beginPath(); c.moveTo(ml, Y(e)); c.lineTo(ml + pw, Y(e)); c.stroke(); }
  c.strokeStyle = '#ffffff30'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(ml, Y(0)); c.lineTo(ml + pw, Y(0)); c.stroke(); c.setLineDash([]);
  // tracks over the mission
  const track = (az, el, vis, thr, col) => {
    for (let k = L(); k < L() + N() - 1; k++) {
      if (Math.abs(az[k + 1] - az[k]) > 180) continue;
      c.strokeStyle = col; c.globalAlpha = vis[k] >= thr ? 0.95 : 0.28; c.lineWidth = vis[k] >= thr ? 2 : 1;
      c.beginPath(); c.moveTo(X(az[k]), Y(el[k])); c.lineTo(X(az[k + 1]), Y(el[k + 1])); c.stroke();
    }
    c.globalAlpha = 1;
  };
  track(S.sunAz, S.sunEl, S.sunVis, LIT_MIN, '#ffc857'); track(S.earthAz, S.earthEl, S.earthVis, COMM_MIN, '#5aa9ff');
  // Sun and Earth (drawn before terrain so terrain hides them correctly)
  const sx = X(S.sunAz[i]), sy = Y(S.sunEl[i]), ex = X(S.earthAz[i]), ey = Y(S.earthEl[i]);
  const gl = c.createRadialGradient(sx, sy, 0, sx, sy, 46); gl.addColorStop(0, '#fff6d8'); gl.addColorStop(0.12, '#ffc857'); gl.addColorStop(0.3, '#ffc85755'); gl.addColorStop(1, '#ffc85700');
  c.fillStyle = gl; c.beginPath(); c.arc(sx, sy, 46, 0, 7); c.fill();
  c.fillStyle = '#5aa9ff'; c.beginPath(); c.arc(ex, ey, 7, 0, 7); c.fill(); c.fillStyle = '#bfe0ff'; c.beginPath(); c.arc(ex - 2, ey - 2, 3, 0, 7); c.fill();
  // terrain
  c.beginPath(); c.moveTo(X(0), Y(hz.el[0]));
  for (let a = 1; a <= hz.el.length; a++) c.lineTo(X(a * 360 / hz.el.length), Y(hz.el[a % hz.el.length]));
  c.lineTo(X(360), mt + ph + 2); c.lineTo(X(0), mt + ph + 2); c.closePath();
  const tg = c.createLinearGradient(0, Y(hi), 0, mt + ph);
  const b = 0.25 + 0.75 * lit; tg.addColorStop(0, `rgb(${70 + 110 * b | 0},${72 + 108 * b | 0},${82 + 104 * b | 0})`); tg.addColorStop(1, `rgb(${22 + 40 * b | 0},${24 + 40 * b | 0},${32 + 40 * b | 0})`);
  c.fillStyle = tg; c.fill(); c.strokeStyle = lit > LIT_MIN ? '#f4f1e6' : '#59607a'; c.lineWidth = 1.2; c.stroke();
  // ghosts when hidden
  if (S.sunVis[i] < LIT_MIN) { c.strokeStyle = '#ffc857'; c.setLineDash([3, 3]); c.beginPath(); c.arc(sx, sy, 7, 0, 7); c.stroke(); c.setLineDash([]); }
  if (S.earthVis[i] < COMM_MIN) { c.strokeStyle = '#5aa9ff'; c.setLineDash([3, 3]); c.beginPath(); c.arc(ex, ey, 7, 0, 7); c.stroke(); c.setLineDash([]); }
  c.font = '11px -apple-system,Segoe UI,sans-serif'; c.fillStyle = '#ffc857'; c.fillText('Sun', sx + 11, Math.max(mt + 12, sy - 9)); c.fillStyle = '#8cc4ff'; c.fillText('Earth', ex + 11, Math.max(mt + 12, ey - 9));
  c.restore();
  c.fillStyle = '#8f9ab6'; c.font = '10px ui-monospace,Menlo,monospace'; c.textAlign = 'right';
  for (let e = Math.ceil(bot / stepEl) * stepEl; e <= top; e += stepEl) c.fillText(e + '°', ml - 5, Y(e) + 3);
  c.textAlign = 'center'; const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' };
  for (let a = 0; a <= 360; a += 45) c.fillText(names[a] || a + '°', X(a), h - 6);
  c.textAlign = 'left';
  drawZoom($('#zSun'), s, S, i, 0); drawZoom($('#zEarth'), s, S, i, 1);
}

function drawZoom(cv, s, S, i, body) {
  const { c, w, h } = fit(cv, 141);
  const az0 = body ? S.earthAz[i] : S.sunAz[i], el0 = body ? S.earthEl[i] : S.sunEl[i];
  const o = azel(eph, body, S.t0 + i * S.step, s.geom), rad = Math.asin((body ? R_EARTH : R_SUN) / o.dist) * R2D;
  const span = body ? 3.2 : 1.4, sc = w / (2 * span), ce = Math.max(0.02, Math.cos(el0 * D2R));
  c.fillStyle = '#03050c'; c.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  if (!body) { const g = c.createRadialGradient(cx, cy, rad * sc, cx, cy, w * 0.7); g.addColorStop(0, '#ffc85755'); g.addColorStop(1, '#ffc85700'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = '#fff3cf'; c.beginPath(); c.arc(cx, cy, rad * sc, 0, 7); c.fill(); }
  else {
    const dAz = ((S.sunAz[i] - az0 + 540) % 360 - 180) * ce, dEl = S.sunEl[i] - el0;
    const cosPsi = Math.sin(S.sunEl[i] * D2R) * Math.sin(el0 * D2R) + Math.cos(S.sunEl[i] * D2R) * Math.cos(el0 * D2R) * Math.cos((S.sunAz[i] - az0) * D2R);
    const k = (1 - cosPsi) / 2, r = rad * sc;
    c.fillStyle = '#0c1c3a'; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
    c.save(); c.translate(cx, cy); c.rotate(Math.atan2(-dEl, dAz));
    c.fillStyle = '#5aa9ff'; c.beginPath(); c.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false); c.ellipse(0, 0, Math.max(0.01, r * Math.abs(1 - 2 * k)), r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5); c.fill(); c.restore();
    cv._phase = k;
  }
  c.beginPath(); c.moveTo(0, h);
  for (let p = 0; p <= 60; p++) { const x = p / 60 * w, az = az0 + (x - cx) / sc / ce; c.lineTo(x, cy - (horizonAt(s.hzo, az) - el0) * sc); }
  c.lineTo(w, h); c.closePath(); c.fillStyle = '#2b3040'; c.fill(); c.strokeStyle = '#aab0c2'; c.lineWidth = 1; c.stroke();
  const vis = body ? S.earthVis[i] : S.sunVis[i];
  (body ? $('#zEarthCap') : $('#zSunCap')).textContent = body ? `Earth · ${(vis * 100).toFixed(0)}% of disc clear · ${(cv._phase * 100).toFixed(0)}% lit` : `Sun · ${(vis * 100).toFixed(0)}% of disc clear`;
}

function renderCountdown() {
  const s = site(st.focus), S = series(s), i = L() + st.cur;
  const ev = (vis, thr, upWord, downWord) => { const e = nextEvent(vis, i, thr); return e.idx < 0 ? { t: e.up ? `no ${downWord} for 2+ years` : `no ${upWord} for 2+ years`, l: e.up ? 'Stays up' : 'Stays down' } : { t: fmtDur(e.idx - i), l: (e.up ? downWord : upWord) + ' in' }; };
  const a = ev(S.sunVis, LIT_MIN, 'Sunrise', 'Sunset'), b = ev(S.earthVis, COMM_MIN, 'Earthrise', 'Earthset');
  $('#countdown').innerHTML = `<div class="cd sun"><small>${a.l}</small><b>${a.t}</b></div><div class="cd earth"><small>${b.l}</small><b>${b.t}</b></div>
    <div class="cd sun"><small>Sun now</small><b>${S.sunEl[i].toFixed(2)}° el · ${S.sunAz[i].toFixed(1)}° az</b></div><div class="cd earth"><small>Earth now</small><b>${S.earthEl[i].toFixed(2)}° el · ${S.earthAz[i].toFixed(1)}° az</b></div>${S.ecl[i] > 0.001 ? `<div class="cd"><small>Eclipse in progress</small><b>Earth covers ${(S.ecl[i] * 100).toFixed(0)}% of the Sun</b></div>` : ''}`;
  $('#cursorLbl').textContent = `T+${fmtDur(st.cur)} · ${fmtDate(landMs() + st.cur * HOUR)}`;
}

// ---------- timeline ----------
function drawTimeline() {
  const rows = st.sel.length, { c, w, h } = fit($('#timeline'), 170 + rows * 34);
  const ml = 40, mr = 8, pw = w - ml - mr, top = 8, ph = 130, n = N(), l0 = L();
  const s = site(st.focus), S = series(s), X = (k) => ml + (k - l0) / n * pw;
  let lo = -2, hi = 4; const hs = new Float32Array(n), he = new Float32Array(n);
  for (let k = 0; k < n; k++) { const i = l0 + k; hs[k] = horizonAt(s.hzo, S.sunAz[i]); he[k] = horizonAt(s.hzo, S.earthAz[i]); lo = Math.min(lo, S.sunEl[i], hs[k], Math.max(S.earthEl[i], -10)); hi = Math.max(hi, S.sunEl[i], hs[k], S.earthEl[i]); }
  lo = Math.max(lo - 1, -12); hi += 1; const Y = (e) => top + (hi - e) / (hi - lo) * ph;
  c.fillStyle = '#070a13'; c.fillRect(ml, top, pw, ph);
  c.save(); c.beginPath(); c.rect(ml, top, pw, ph); c.clip();
  c.beginPath(); c.moveTo(X(l0), top + ph); for (let k = 0; k < n; k++) c.lineTo(X(l0 + k), Y(hs[k])); c.lineTo(X(l0 + n - 1), top + ph); c.closePath(); c.fillStyle = '#2b304066'; c.fill();
  const line = (f, col, dash, lw = 1.6) => { c.strokeStyle = col; c.lineWidth = lw; c.setLineDash(dash || []); c.beginPath(); for (let k = 0; k < n; k++) { const y = Y(f(k)); k ? c.lineTo(X(l0 + k), y) : c.moveTo(X(l0 + k), y); } c.stroke(); c.setLineDash([]); };
  line(k => hs[k], '#9aa1b5', null, 1); line(k => he[k], '#5aa9ff88', [3, 3], 1);
  line(k => S.sunEl[l0 + k], '#ffc857'); line(k => S.earthEl[l0 + k], '#5aa9ff');
  c.restore();
  c.font = '10px ui-monospace,Menlo,monospace'; c.fillStyle = '#8f9ab6'; c.textAlign = 'right';
  const stp = hi - lo > 40 ? 20 : hi - lo > 15 ? 5 : 2; for (let e = Math.ceil(lo / stp) * stp; e <= hi; e += stp) { c.fillText(e + '°', ml - 5, Y(e) + 3); c.strokeStyle = '#ffffff10'; c.beginPath(); c.moveTo(ml, Y(e)); c.lineTo(ml + pw, Y(e)); c.stroke(); }
  c.textAlign = 'left';
  // bands per site
  let y = top + ph + 20;
  for (const id of st.sel) {
    const q = site(id), Q = series(q);
    c.fillStyle = colorOf(id); c.fillRect(ml - 34, y + 3, 6, 16); c.fillStyle = '#c6cee2'; c.font = '11px -apple-system,Segoe UI,sans-serif'; c.fillText(q.name, ml, y - 3);
    const cw = Math.max(1, pw / n + 0.6);
    for (let k = 0; k < n; k++) { const i = l0 + k, x = X(i);
      c.fillStyle = `rgba(255,200,87,${Q.sunVis[i] < LIT_MIN ? 0.07 : 0.25 + 0.75 * Q.sunVis[i]})`; c.fillRect(x, y + 2, cw, 8);
      c.fillStyle = `rgba(90,169,255,${Q.earthVis[i] >= COMM_MIN ? 0.95 : 0.08})`; c.fillRect(x, y + 12, cw, 8); }
    y += 34;
  }
  // day ticks + cursor
  const dstep = st.dur <= 14 ? 1 : st.dur <= 60 ? 5 : 20; c.fillStyle = '#8f9ab6'; c.font = '10px ui-monospace,Menlo,monospace'; c.textAlign = 'center';
  for (let d = 0; d <= st.dur; d += dstep) { const x = X(l0 + d * 24); c.fillText('T+' + d + 'd', x, h - 4); c.strokeStyle = '#ffffff14'; c.beginPath(); c.moveTo(x, top); c.lineTo(x, h - 16); c.stroke(); }
  c.textAlign = 'left'; const cx = X(l0 + st.cur); c.strokeStyle = '#7fe3ff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx, top); c.lineTo(cx, h - 16); c.stroke();
  $('#timeline')._geo = { ml, pw };
}
function timelinePick(e) { const g = $('#timeline')._geo; if (!g) return; const r = e.target.getBoundingClientRect(); st.cur = Math.max(0, Math.min(N() - 1, Math.round((e.clientX - r.left - g.ml) / g.pw * N()))); $('#cursor').value = st.cur; drawPano(); renderCountdown(); drawTimeline(); drawMap(); }
$('#timeline').addEventListener('pointerdown', (e) => { timelinePick(e); e.target.setPointerCapture(e.pointerId); e.target.onpointermove = timelinePick; });
$('#timeline').addEventListener('pointerup', (e) => { e.target.onpointermove = null; });

// ---------- calendar ----------
function drawCalendar() {
  const rows = st.sel.length, { c, w, h } = fit($('#cal'), 26 + rows * 50);
  const X = (d) => d / SPAN_DAYS * w, cw = w / SPAN_DAYS + 0.5;
  c.font = '10px ui-monospace,Menlo,monospace'; c.fillStyle = '#8f9ab6';
  const d0 = new Date(st.base); let mth = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1));
  while (mth.getTime() < st.base + SPAN_DAYS * DAY) { const x = X((mth.getTime() - st.base) / DAY); c.strokeStyle = '#ffffff18'; c.beginPath(); c.moveTo(x, 14); c.lineTo(x, h); c.stroke(); if (mth.getUTCMonth() % (w < 700 ? 3 : 1) === 0) c.fillText(MON[mth.getUTCMonth()] + (mth.getUTCMonth() === 0 ? ' ' + mth.getUTCFullYear() : ''), x + 3, 10); mth = new Date(Date.UTC(mth.getUTCFullYear(), mth.getUTCMonth() + 1, 1)); }
  let y = 30;
  for (const id of st.sel) {
    const s = site(id), C = cal(s);
    c.fillStyle = colorOf(id); c.fillRect(0, y - 11, 6, 9); c.fillStyle = '#c6cee2'; c.font = '11px -apple-system,Segoe UI,sans-serif'; c.fillText(s.name, 10, y - 3);
    for (let d = 0; d < Math.min(SPAN_DAYS, C.count); d++) { const x = X(d);
      c.fillStyle = C.level[d] === 2 ? '#3ddc97' : C.level[d] === 1 ? '#f5b83d' : '#47232c'; c.fillRect(x, y, cw, 18);
      c.fillStyle = `rgba(255,200,87,${C.sunPct[d] / 100})`; c.fillRect(x, y + 20, cw, 5);
      c.fillStyle = `rgba(90,169,255,${C.commPct[d] / 100})`; c.fillRect(x, y + 26, cw, 5); }
    y += 50;
  }
  c.fillStyle = '#fff'; c.fillRect(0, 14, 2, h); c.fillStyle = '#7fe3ff'; c.fillRect(X(st.slip) - 1, 14, 2, h);
}
function calAt(e) { const r = $('#cal').getBoundingClientRect(); return { d: Math.max(0, Math.min(SPAN_DAYS - 1, Math.floor((e.clientX - r.left) / r.width * SPAN_DAYS))), row: Math.floor((e.clientY - r.top - 18) / 50), x: e.clientX - r.left, y: e.clientY - r.top }; }
$('#cal').addEventListener('mousemove', (e) => { const p = calAt(e), id = st.sel[Math.max(0, Math.min(st.sel.length - 1, p.row))], C = cal(site(id)), t = $('#calTip');
  t.hidden = false; t.innerHTML = `<b>${fmtDate(st.base + p.d * DAY, true)}</b> · ${site(id).name}<br>${['NO-GO', 'MARGINAL', 'GO'][C.level[p.d]]} · sunlit ${C.sunPct[p.d].toFixed(0)}% · link ${C.commPct[p.d].toFixed(0)}% · dark ≤ ${fmtDur(C.maxDarkH[p.d])}`;
  const cv = $('#cal'); t.style.left = Math.min(cv.clientWidth - 300, p.x + 14) + cv.offsetLeft + 'px'; t.style.top = cv.offsetTop + p.y + 16 + 'px'; });
$('#cal').addEventListener('mouseleave', () => $('#calTip').hidden = true);
$('#cal').addEventListener('click', (e) => { landOn(calAt(e).d); });
function landOn(day) { if (day <= 180) st.slip = day; else { st.base += day * DAY; st.slip = 0; } st.cur = 0; nearby = null; update(); }

// ---------- rescue ----------
function renderRescue() {
  const s = site(st.focus), C = cal(s), v = s._v || { level: 'go' };
  let next = -1, best = -1; const end = Math.min(C.count, SPAN_DAYS);
  for (let d = st.slip + 1; d < end; d++) { if (next < 0 && C.level[d] === 2) next = d; if (d <= st.slip + 365 && (best < 0 || C.score[d] > C.score[best])) best = d; }
  const row = (d, lbl) => d < 0 ? '' : `<tr><td>${lbl}</td><td>${fmtDate(st.base + d * DAY, true)} <small>(+${d - st.slip} d)</small></td><td>${C.sunPct[d].toFixed(0)}% / ${C.commPct[d].toFixed(0)}%</td><td><button data-day="${d}">Land then</button></td></tr>`;
  let a = `<div><h3>Same site, different date</h3><p>${v.level === 'go' ? 'This date already meets the rules.' : `<b>${s.name}</b> does not meet the rules on ${fmtDate(landMs(), true)}.`} ${next < 0 ? 'No fully GO date in the next 24 months with the current rules.' : ''}</p>
    <table><tr><th></th><th>Landing day</th><th>Sun / link</th><th></th></tr>${row(next, 'Next GO')}${best !== next ? row(best, 'Best in 12 mo') : ''}</table></div>`;
  // other curated sites on this date
  const others = sites.filter(q => q.id !== s.id).map(q => { const Q = buildSeries(eph, q.geom, q.hzo, landMs(), landMs() + N() * HOUR, HOUR), m = windowMetrics(Q, 0, Q.n), vv = verdict(m, st.rules); return { q, m, vv }; }).sort((x, y) => y.vv.score - x.vv.score).slice(0, 5);
  let b = `<div><h3>Same date, other sites</h3><p>Every site in the list, ranked for a ${st.dur}-day mission landing ${fmtDate(landMs(), true)}.</p><table><tr><th>Site</th><th>Sun / link</th><th></th><th></th></tr>` +
    others.map(o => `<tr><td>${o.q.name}</td><td>${o.m.sunPct.toFixed(0)}% / ${o.m.commPct.toFixed(0)}%</td><td><span class="badge ${o.vv.level}">${o.vv.level === 'go' ? 'GO' : o.vv.level === 'marginal' ? 'MARG' : 'NO-GO'}</span></td><td><button data-cmp="${o.q.id}">Compare</button></td></tr>`).join('') + '</table></div>';
  const sp = Math.abs(s.lat) > 85 ? 120 : Math.abs(s.lat) > 75 ? 480 : 4000;
  let cdiv = `<div><h3>Same date, a short drive away</h3><p>Near the poles a few hundred metres can be the difference between sunlight and darkness. Search a ${(sp * 10 / 1000).toFixed(1)} km box around this site on the LOLA grid.</p>`;
  if (nearby && nearby.id === s.id && nearby.results) {
    const dir = (o) => { if (!o.dist) return 'here'; const brg = (Math.atan2(o.de, o.dn) * R2D + 360) % 360; return `${o.dist < 1000 ? Math.round(o.dist) + ' m' : (o.dist / 1000).toFixed(1) + ' km'} ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(brg / 45) % 8]}`; };
    cdiv += `<table><tr><th>Where</th><th>Sun / link</th><th>Dark</th><th></th></tr>` + nearby.results.map((o, k) => `<tr><td>${dir(o)}</td><td>${o.sunPct.toFixed(0)}% / ${o.commPct.toFixed(0)}%</td><td>${fmtDur(o.maxDarkH)}</td><td>${o.dist ? `<button data-near="${k}">Use</button>` : ''}</td></tr>`).join('') + `</table><p class="hint">${nearby.tested} spots tested on the ${sp} m grid${nearby.here ? `; this exact spot scores ${nearby.here.sunPct.toFixed(0)}% / ${nearby.here.commPct.toFixed(0)}% on that grid` : ''}. Screening only — confirm with full-resolution terrain.</p>`;
  } else cdiv += `<button id="nearBtn"${nearby && nearby.id === s.id ? ' disabled' : ''}>${nearby && nearby.id === s.id ? 'Searching…' : 'Search nearby spots'}</button>`;
  cdiv += '</div>';
  $('#rescue').innerHTML = `<div class="resc">${a}${b}${cdiv}</div>`;
}
$('#rescue').addEventListener('click', (e) => {
  const t = e.target; if (t.tagName !== 'BUTTON') return;
  if (t.dataset.day) landOn(+t.dataset.day);
  else if (t.dataset.cmp) { if (st.sel.length >= 4) st.sel.pop(); st.sel.push(t.dataset.cmp); update(); }
  else if (t.id === 'nearBtn') { const s = site(st.focus), sp = Math.abs(s.lat) > 85 ? 120 : Math.abs(s.lat) > 75 ? 480 : 4000; nearby = { id: s.id }; ask({ type: 'nearby', lat: s.lat, lon: s.lon, mast: s.mast, spacing: sp, n: 5, landMs: landMs(), durH: N(), rules: st.rules }).then(r => { nearby = { id: s.id, results: r.results, tested: r.tested, here: r.here }; toast('Nearby search finished'); renderRescue(); }).catch(err => { nearby = null; toast('Search failed: ' + err.message, 4000); renderRescue(); }); renderRescue(); }
  else if (t.dataset.near) { const o = nearby.results[+t.dataset.near]; addCustom(o.lat, o.lon, site(st.focus).mast); }
});

// ---------- map ----------
const MAPS = { south: { img: 'img/south_pole.jpg', half: 304.0 }, zoom: { img: 'img/south_pole_zoom.jpg', half: 75.84 }, global: { img: 'img/global.jpg' } };
function mapXY(lat, lon, w, h) {
  const m = MAPS[st.map];
  if (st.map === 'global') return [((lon + 540) % 360) / 360 * w, (90 - lat) / 180 * h];
  const r = 2 * R_MOON * Math.tan((90 + lat) * D2R / 2);
  return [w / 2 + r * Math.sin(lon * D2R) / m.half * w / 2, h / 2 - r * Math.cos(lon * D2R) / m.half * h / 2];
}
function drawMap() {
  const cv = $('#map'), m = MAPS[st.map], wCss = cv.parentElement.clientWidth, { c, w, h } = fit(cv, st.map === 'global' ? wCss / 2 : wCss);
  const im = imgs[st.map];
  if (!im || im === 'loading') {
    if (!im) { const key = st.map, i = new Image(); imgs[key] = 'loading'; i.onload = () => { imgs[key] = i; drawMap(); }; i.src = m.img; }
    c.fillStyle = '#8f9ab6'; c.fillText('Loading map…', 12, 20); return;
  }
  c.drawImage(im, 0, 0, w, h);
  const t = landMs() + st.cur * HOUR, sun = subPoint(eph, 0, t), ear = subPoint(eph, 1, t);
  if (st.map === 'global') {
    const sv = [Math.cos(sun.lat * D2R) * Math.cos(sun.lon * D2R), Math.cos(sun.lat * D2R) * Math.sin(sun.lon * D2R), Math.sin(sun.lat * D2R)], nx = 180, ny = 90;
    c.fillStyle = 'rgba(2,4,12,0.62)';
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const la = (90 - (j + 0.5) * 2) * D2R, lo = ((i + 0.5) * 2 - 180) * D2R; if (Math.cos(la) * Math.cos(lo) * sv[0] + Math.cos(la) * Math.sin(lo) * sv[1] + Math.sin(la) * sv[2] < 0) c.fillRect(i * w / nx, j * h / ny, w / nx + 0.5, h / ny + 0.5); }
    for (const [p, col, lbl] of [[sun, '#ffc857', 'Sun overhead'], [ear, '#5aa9ff', 'Earth overhead']]) { const [x, y] = mapXY(p.lat, p.lon, w, h); c.fillStyle = col; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); c.font = '11px -apple-system,Segoe UI,sans-serif'; c.fillText(lbl, x + 9, y + 4); }
  } else {
    for (const [p, col, lbl] of [[sun, '#ffc857', 'to Sun'], [ear, '#5aa9ff', 'to Earth']]) {
      const a = p.lon * D2R, dx = Math.sin(a), dy = -Math.cos(a), r1 = w / 2 - 54, r2 = w / 2 - 14;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 3; c.beginPath(); c.moveTo(w / 2 + dx * r1, h / 2 + dy * r1); c.lineTo(w / 2 + dx * r2, h / 2 + dy * r2); c.stroke();
      c.beginPath(); c.moveTo(w / 2 + dx * (r2 + 8), h / 2 + dy * (r2 + 8)); c.lineTo(w / 2 + dx * r2 - dy * 7, h / 2 + dy * r2 + dx * 7); c.lineTo(w / 2 + dx * r2 + dy * 7, h / 2 + dy * r2 - dx * 7); c.fill();
      c.font = '600 11px -apple-system,Segoe UI,sans-serif'; { const tx = `${lbl} · ${Math.abs(p.lat).toFixed(1)}° ${p.lat < 0 ? 'below' : 'above'} the equator`, tw = c.measureText(tx).width, lx = Math.min(w - tw - 6, Math.max(6, w / 2 + dx * (r1 - 10) - tw / 2)), ly = Math.min(h - 8, Math.max(14, h / 2 + dy * (r1 - 10) + (dy > 0.5 ? -4 : 12))); c.lineWidth = 3; c.strokeStyle = '#000c'; c.strokeText(tx, lx, ly); c.fillText(tx, lx, ly); }
    }
    c.strokeStyle = '#ffffff35'; c.lineWidth = 1; c.font = '10px ui-monospace,Menlo,monospace'; c.fillStyle = '#ffffff90';
    for (const la of st.map === 'south' ? [-82, -84, -86, -88] : [-88, -89, -89.5]) { const r = 2 * R_MOON * Math.tan((90 + la) * D2R / 2) / m.half * w / 2; c.beginPath(); c.arc(w / 2, h / 2, r, 0, 7); c.stroke(); c.fillText(Math.abs(la) + '°S', w / 2 + 3, h / 2 - r - 3); }
  }
  for (const s of sites) { const [x, y] = mapXY(s.lat, s.lon, w, h); if (x < 0 || y < 0 || x > w || y > h) continue; const on = st.sel.includes(s.id);
    c.beginPath(); c.arc(x, y, on ? 6 : 3, 0, 7); c.fillStyle = on ? colorOf(s.id) : '#ffffffcc'; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
    if (on) { c.font = '600 11px -apple-system,Segoe UI,sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000c'; const tx = x + 9 + c.measureText(s.name).width > w ? x - 9 - c.measureText(s.name).width : x + 9; c.strokeText(s.name, tx, y + 4); c.fillStyle = '#fff'; c.fillText(s.name, tx, y + 4); } }
}
$('#map').addEventListener('click', (e) => {
  const r = e.target.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; let lat, lon;
  if (st.map === 'global') { lon = x * 360 - 180; lat = 90 - y * 180; }
  else { const m = MAPS[st.map], px = (x * 2 - 1) * m.half, py = (1 - y * 2) * m.half; lat = -90 + 2 * Math.atan(Math.hypot(px, py) / (2 * R_MOON)) * R2D; lon = Math.atan2(px, py) * R2D; }
  $('#cLat').value = lat.toFixed(4); $('#cLon').value = lon.toFixed(4); $('#customMsg').textContent = 'Coordinates filled in — press “Compute horizon”.';
});
$('#mapTabs').addEventListener('click', (e) => { if (e.target.dataset.m) { st.map = e.target.dataset.m; for (const b of $('#mapTabs').children) b.classList.toggle('on', b === e.target); drawMap(); } });

// ---------- worker / custom sites ----------
function ask(msg) { return new Promise((res, rej) => { const req = ++reqN; pending[req] = { res, rej }; worker.postMessage({ ...msg, req }); }); }
function addCustom(lat, lon, mast) {
  $('#customMsg').textContent = 'Working…';
  return ask({ type: 'horizon', lat, lon, mast }).then(r => {
    const s = prepSite({ id: 'c' + (++customN), name: `Custom ${customN} (${lat.toFixed(3)}°, ${lon.toFixed(3)}°)`, group: 'Custom', lat, lon, custom: true, ground: Math.round(r.ground), mast, res: Math.round(r.res), hzo: { el: r.el } });
    sites.push(s); if (st.sel.length >= 4) st.sel.pop(); st.sel.push(s.id); st.focus = s.id; nearby = null;
    $('#customMsg').textContent = `Added. Horizon traced on the ${s.res} m LOLA grid.`; toast('Custom site added'); update(); return s;
  }).catch(err => { $('#customMsg').textContent = 'Could not compute: ' + err.message; });
}
$('#customForm').addEventListener('submit', (e) => { e.preventDefault(); let lon = +$('#cLon').value; lon = ((lon + 540) % 360) - 180; const lat = Math.max(-89.999, Math.min(89.999, +$('#cLat').value)); addCustom(lat, lon, +$('#cMast').value || 0); });

// ---------- controls ----------
function clampBase(ms) { return Math.max(eph.msMin + DAY, Math.min(eph.msMax - (SPAN_DAYS + MAX_DUR + 3) * DAY, ms)); }
$('#date').addEventListener('change', (e) => { const v = fromLocalInput(e.target.value); if (isNaN(v)) return; st.base = clampBase(v); st.slip = 0; st.cur = 0; nearby = null; update(); });
$('#dur').addEventListener('change', (e) => { st.dur = +e.target.value; st.cur = 0; nearby = null; update(); });
$('#slip').addEventListener('input', (e) => { st.slip = +e.target.value; st.cur = 0; nearby = null; update(true); });
$('#slip').addEventListener('change', () => update());
$('#cursor').addEventListener('input', (e) => { st.cur = +e.target.value; drawPano(); renderCountdown(); drawTimeline(); drawMap(); });
$('#play').addEventListener('click', () => {
  if (playing) { clearInterval(playing); playing = null; $('#play').textContent = '▶ Play mission'; return; }
  $('#play').textContent = '❚❚ Pause'; if (st.cur >= N() - 2) st.cur = 0;
  const stepH = Math.max(1, Math.round(N() / 240));
  playing = setInterval(() => { st.cur += stepH; if (st.cur >= N() - 1) { st.cur = N() - 1; clearInterval(playing); playing = null; $('#play').textContent = '▶ Play mission'; } $('#cursor').value = st.cur; drawPano(); renderCountdown(); drawTimeline(); drawMap(); }, 50);
});
function setMode(m) { st.mode = m; document.body.classList.toggle('planner', m === 'planner'); $('#modePlanner').classList.toggle('on', m === 'planner'); $('#modeExplorer').classList.toggle('on', m !== 'planner'); writeHash(); requestAnimationFrame(() => { drawPano(); drawTimeline(); drawCalendar(); drawMap(); }); }
$('#modePlanner').addEventListener('click', () => setMode('planner')); $('#modeExplorer').addEventListener('click', () => setMode('explorer'));
$('#rulesBtn').addEventListener('click', () => { $('#rules').hidden = !$('#rules').hidden; });
for (const [id, key, chk] of [['rSun', 'minSunPct'], ['rDark', 'maxDarkH'], ['rComm', 'minCommPct'], ['rSunL', 'needSunAtLanding', 1], ['rEarthL', 'needEarthAtLanding', 1]])
  $('#' + id).addEventListener('change', (e) => { st.rules[key] = chk ? e.target.checked : Math.max(0, +e.target.value || 0); update(); });
$('#shareBtn').addEventListener('click', () => { writeHash(); navigator.clipboard?.writeText(location.href).then(() => toast('Link copied'), () => toast('Copy the address bar link')); });
$('#csv').addEventListener('click', () => {
  const s = site(st.focus), S = series(s); let out = 'utc,hours_after_landing,sun_az_deg,sun_el_deg,sun_disc_visible,earth_az_deg,earth_el_deg,earth_disc_visible\n';
  for (let k = 0; k < N(); k++) { const i = L() + k; out += `${new Date(S.t0 + i * S.step).toISOString()},${k},${S.sunAz[i].toFixed(3)},${S.sunEl[i].toFixed(3)},${S.sunVis[i].toFixed(3)},${S.earthAz[i].toFixed(3)},${S.earthEl[i].toFixed(3)},${S.earthVis[i].toFixed(3)}\n`; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`# Earthset export: ${s.name} (${s.lat}, ${s.lon}), landing ${new Date(landMs()).toISOString()}. Data: NASA/JPL DE440 + NASA LRO LOLA.\n` + out], { type: 'text/csv' })); a.download = `earthset_${s.id}_${toLocalInput(landMs()).replace(/[:T]/g, '-')}.csv`; a.click();
});

// ---------- URL state ----------
function writeHash() {
  const ids = st.sel.map(id => { const s = site(id); return s.custom ? `@${s.lat.toFixed(4)}_${s.lon.toFixed(4)}_${s.mast}` : id; });
  const f = site(st.focus), fid = f.custom ? ids[st.sel.indexOf(st.focus)] : st.focus;
  history.replaceState(null, '', `#s=${ids.join(',')}&f=${fid}&t=${toLocalInput(st.base)}&slip=${st.slip}&d=${st.dur}&m=${st.mode[0]}&r=${st.rules.minSunPct}_${st.rules.maxDarkH}_${st.rules.minCommPct}_${+st.rules.needSunAtLanding}${+st.rules.needEarthAtLanding}`);
}
async function readHash() {
  const p = new URLSearchParams(location.hash.slice(1)); if (!p.get('s')) return;
  const t = fromLocalInput(p.get('t') || ''); if (!isNaN(t)) st.base = clampBase(t);
  st.slip = Math.max(0, Math.min(180, +p.get('slip') || 0)); if ([3, 7, 10, 14, 28, 60, 180].includes(+p.get('d'))) st.dur = +p.get('d');
  if (p.get('m') === 'p') st.mode = 'planner';
  const r = (p.get('r') || '').split('_'); if (r.length === 4) st.rules = { minSunPct: +r[0], maxDarkH: +r[1], minCommPct: +r[2], needSunAtLanding: r[3][0] === '1', needEarthAtLanding: r[3][1] === '1' };
  const sel = []; let focus = null;
  for (const tok of p.get('s').split(',').slice(0, 4)) {
    if (tok[0] === '@') { const [la, lo, ma] = tok.slice(1).split('_').map(Number); if ([la, lo, ma].some(isNaN)) continue; st.sel = sel.slice(); const s = await addCustom(la, lo, ma); if (s) { sel.push(s.id); if (tok === p.get('f')) focus = s.id; } }
    else if (site(tok)) { sel.push(tok); if (tok === p.get('f')) focus = tok; }
  }
  if (sel.length) { st.sel = sel; st.focus = focus || sel[0]; }
}

// ---------- update ----------
function update(light) {
  $('#date').value = toLocalInput(st.base); $('#dur').value = st.dur; $('#slip').value = st.slip;
  $('#slipLbl').textContent = st.slip ? `+${st.slip} days → lands ${fmtDate(landMs(), true)}` : 'none';
  $('#cursor').max = N() - 1; $('#cursor').value = st.cur;
  $('#rSun').value = st.rules.minSunPct; $('#rDark').value = st.rules.maxDarkH; $('#rComm').value = st.rules.minCommPct; $('#rSunL').checked = st.rules.needSunAtLanding; $('#rEarthL').checked = st.rules.needEarthAtLanding;
  if (!light) renderSites();
  renderCards(); drawPano(); renderCountdown(); drawTimeline(); drawCalendar(); drawMap();
  if (!light) { renderRescue(); writeHash(); }
}

async function init() {
  const [e, sj, val] = await Promise.all([loadEphemeris('data/'), fetch('data/sites.json').then(r => r.json()), fetch('data/validation.json').then(r => r.json()).catch(() => null)]);
  eph = e; sites = sj.sites.map(prepSite);
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ type: 'init', hdr: eph.h, buf: eph.c.buffer.slice(0) });
  worker.onmessage = (ev) => { const m = ev.data; if (m.type === 'status') { toast(m.text, 0); return; } const p = pending[m.req]; if (!p) return; delete pending[m.req]; $('#toast').hidden = true; m.type === 'error' ? p.rej(new Error(m.text)) : p.res(m); };
  worker.onerror = (ev) => { toast('Worker error: ' + ev.message, 5000); for (const k in pending) { pending[k].rej(new Error(ev.message)); delete pending[k]; } };
  if (val) {
    $('#valid').innerHTML = `<p><span class="vbig">${val.worst_error_deg.toFixed(5)}°</span> worst-case difference in Sun/Earth azimuth or elevation across <b>${val.total_samples.toLocaleString()}</b> comparisons (${val.rows.length / 2} sites, 2025–2038, 3-hour steps). That is ${(val.worst_error_deg * 3600).toFixed(2)} arcseconds — about 1/${Math.round(0.53 / val.worst_error_deg).toLocaleString()} of the Sun's width.</p>
      <table class="vt"><tr><th>Site</th><th>Body</th><th>n</th><th>max Δel °</th><th>max Δaz °</th></tr>${val.rows.map(r => `<tr><td>${r.site}</td><td>${r.body}</td><td>${r.samples}</td><td>${r.max_el_err_deg.toFixed(5)}</td><td>${r.max_az_err_deg.toFixed(5)}</td></tr>`).join('')}</table><p class="hint">Reproduce: <code>node tools/validate_ephem.mjs</code></p>`;
  }
  await readHash();
  setMode(st.mode); update();
  window.addEventListener('resize', () => { clearTimeout(init.t); init.t = setTimeout(() => { drawPano(); drawTimeline(); drawCalendar(); drawMap(); }, 120); });
}
init().catch(err => { document.body.insertAdjacentHTML('afterbegin', `<p style="padding:20px;color:#ff5d6c">Earthset could not start: ${err.message}. If you opened the file directly, serve the folder over http (e.g. <code>python3 -m http.server</code>).</p>`); console.error(err); });
