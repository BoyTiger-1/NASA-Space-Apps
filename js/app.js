// Earthset: application UI.
// SI disclosure: written with the assistance of an SI coding tool (Claude).
import { loadEphemeris, makeSite, azel, subPoint, R_SUN, R_EARTH, R_MOON } from './ephem.js';
import { horizonAt, discVisible, offsetLL } from './terrain.js';
import { STATIONS, MASK_DEG, stationsInView } from './earthside.js';
import { createRelief } from './relief3d.js';
import { prepSite } from './hero.js';
import { getKey, setKey, aiMode, aiParse, aiExplain } from './ai.js';
import { buildSeries, windowMetrics, verdict, calendar, nextEvent, simulateEnergy, fmtDur, HOUR, DAY, DEFAULT_RULES, LIT_MIN, COMM_MIN } from './analysis.js';

const $ = (q) => document.querySelector(q);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const COLORS = ['#f0552f', '#12a889', '#c94f9e', '#8d9b2a'];
const SPAN_DAYS = 730, MAX_DUR = 180;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const st = { sel: ['ridge', 'im2', 'im1'], focus: 'ridge', base: Date.UTC(2027, 0, 15), slip: 0, dur: 14, cur: 0, rules: { ...DEFAULT_RULES }, mode: 'explorer', map: 'south', frac: 0, en: { arrayW: 650, loadW: 300, sleepW: 50, battWh: 1500, mbps: 2, tracking: true } };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let lm = null, lmLayer = 'sun', lmView = '2d', relief = null, lmBusy = false, tourK = -1;
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
const tagOf = (id) => 'ABCD'[st.sel.indexOf(id)] || '';
const tagHtml = (id) => `<i class="tag" style="--c:${colorOf(id)}">${tagOf(id)}</i>`;
const landMs = () => st.base + st.slip * DAY;
const L = () => st.slip * 24;                       // landing index into a series
const N = () => st.dur * 24;                        // mission length in steps

function series(s) {
  const key = s.id + '|' + st.base;
  if (seriesCache.base !== st.base) { seriesCache.clear(); seriesCache.base = st.base; }
  let S = seriesCache.get(key);
  if (!S) { S = buildSeries(eph, s.geom, s.hzo, st.base, st.base + (SPAN_DAYS + MAX_DUR + 1) * DAY, HOUR); if (seriesCache.size > 40) seriesCache.clear(); seriesCache.set(key, S); }
  return S;
}
function cal(s) {
  const S = series(s), key = st.dur + JSON.stringify(st.rules);
  if (S._calKey !== key) { S._cal = calendar({ ...S, n: SPAN_DAYS * 24 + N() }, N(), 24, st.rules); S._calKey = key; }
  return S._cal;
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
      h += `<div class="site${s.id === st.focus ? ' focus' : ''}" data-id="${s.id}"><input type="checkbox" ${on ? 'checked' : ''} aria-label="Compare ${s.name}">${on ? tagHtml(s.id) : '<i class="tag"></i>'}<span class="nm">${s.name}</span>${s.custom ? '<button class="rm" title="Remove">×</button>' : ''}</div>`;
    }
    h += '</div>';
  }
  $('#siteList').innerHTML = h; $('#sitesN').textContent = st.sel.length;
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
  if (m.sunPct < 0.5) out.push('The Sun never clears the surrounding terrain here during this mission, so there is no solar power at all.');
  else if (m.toSunsetH == null) out.push('The Sun stays above the terrain for the entire mission.');
  else if (!m.sunAtLanding) out.push(`It is dark at touchdown, and the longest stretch without sunlight is ${fmtDur(m.maxDarkH)}.`);
  else out.push(`Sunlight is first lost ${fmtDur(m.toSunsetH)} after landing; the longest dark stretch is ${fmtDur(m.maxDarkH)}.`);
  if (m.commPct < 0.5) out.push(Math.abs(s.lon) > 100 && Math.abs(s.lat) < 80 ? 'This is the far side: Earth never rises, so it needs a relay satellite.' : 'Earth stays hidden behind terrain the whole time, so there is no direct radio link.');
  else if (m.toEarthsetH == null) out.push('Earth is in view the whole time, so the lander can always talk directly to Earth.');
  else out.push(`Earth is hidden for up to ${fmtDur(m.maxOutageH)} at a time.`);
  if (m.eclipse > 0.01) out.push(`Note: Earth passes in front of the Sun during this mission (an eclipse), covering up to ${(m.eclipse * 100).toFixed(0)}% of it.`);
  return out.join(' ');
}
const prevVals = new Map(), prevLevel = new Map();
function tweenAll(root) {
  for (const el of root.querySelectorAll('[data-k]')) {
    const k = el.dataset.k, to = +el.dataset.v, from = prevVals.has(k) ? prevVals.get(k) : (el.classList.contains('mfill') ? 0 : to), f = el.dataset.f;
    prevVals.set(k, to);
    if (el.classList.contains('mfill')) { el.style.width = from + '%'; requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = to + '%'; })); continue; }
    const fmt = (v) => f === 'pct' ? v.toFixed(0) + '%' : fmtDur(Math.round(v));
    if (from === to || reduceMotion) { el.textContent = fmt(to); continue; }
    const t0 = performance.now(), D = 420; el._tw = t0; el.textContent = fmt(from);
    const step = (t) => { if (el._tw !== t0 || !el.isConnected) return; const x = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - x, 3); el.textContent = fmt(from + (to - from) * e); if (x < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
function renderCards() {
  let h = '';
  for (const id of st.sel) {
    const s = site(id), S = series(s), m = windowMetrics(S, L(), L() + N()), v = verdict(m, st.rules), sl = slipInfo(s);
    s._m = m; s._v = v;
    const flip = prevLevel.has(id) && prevLevel.get(id) !== v.level; prevLevel.set(id, v.level);
    h += `<article class="card${id === st.focus ? ' focus' : ''}" data-id="${id}">
      <header><h3>${tagHtml(id)}<span>${s.name}</span></h3><span class="badge ${v.level}${flip ? ' flip' : ''}">${v.level === 'go' ? 'GO' : v.level === 'marginal' ? 'MARGINAL' : 'NO-GO'}</span></header>
      <div class="ll">${fmtLL(s)} · ${s.ground >= 0 ? '+' : ''}${s.ground} m${s.approx ? ' · illustrative point' : ''}${s.custom ? ` · ${s.res} m grid` : ''}</div>
      <div class="kv">
        <div><b data-k="${id}:sun" data-v="${m.sunPct}" data-f="pct"></b><i class="meter" style="--m:var(--sun)"><i class="mfill" data-k="${id}:sunm" data-v="${m.sunPct}"></i></i>sunlit</div>
        <div><b data-k="${id}:com" data-v="${m.commPct}" data-f="pct"></b><i class="meter" style="--m:var(--earth)"><i class="mfill" data-k="${id}:comm" data-v="${m.commPct}"></i></i>Earth link</div>
        <div><b data-k="${id}:dark" data-v="${m.maxDarkH}" data-f="dur"></b>longest darkness</div><div><b data-k="${id}:out" data-v="${m.maxOutageH}" data-f="dur"></b>longest link outage</div>
        <div class="planner-only"><b>${sl.ok ? sl.margin + (sl.open ? '+' : '') + ' d' : sl.next == null ? 'none' : sl.next + ' d'}</b>${sl.ok ? 'slip margin before this window closes' : sl.next == null ? 'GO day in the next 24 months' : 'until the next GO landing day'}</div>
        <div class="planner-only"><b>${sl.go}</b>of ${sl.end} landing days are GO</div>
        <div class="planner-only"><b>${m.peakSunEl.toFixed(1)}°</b>peak Sun elevation</div><div class="planner-only"><b>${m.flatPct.toFixed(0)}%</b>flat-panel power index</div>
      </div>
      <p class="say">${sentence(s, m)}</p>
      ${v.fails.length ? `<p class="why">Fails: ${v.fails.join('; ')}</p>` : ''}${v.warns.length ? `<p class="why w">Watch: ${v.warns.join('; ')}</p>` : ''}
    </article>`;
  }
  $('#cards').innerHTML = h; tweenAll($('#cards'));
}
// How much slip the plan can absorb at a site, from the landing-day calendar.
function calStats(C) { if (C._st) return C._st; const end = Math.min(C.count, SPAN_DAYS); let go = 0, run = 0, best = 0; for (let d = 0; d < end; d++) { if (C.level[d] === 2) { go++; if (++run > best) best = run; } else run = 0; } return (C._st = { go, best, end }); }
function slipInfo(s) {
  const C = cal(s), { go, end } = calStats(C), d0 = st.slip;
  if (C.level[d0] === 2) { let m = 0; while (d0 + m + 1 < end && C.level[d0 + m + 1] === 2) m++; return { ok: true, margin: m, open: d0 + m + 1 >= end, go, end }; }
  let d = d0 + 1; while (d < end && C.level[d] !== 2) d++;
  return { ok: false, next: d < end ? d - d0 : null, go, end };
}
$('#cards').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) { st.focus = c.dataset.id; nearby = null; update(); } });

// ---------- sky panorama ----------
function drawPano() {
  const s = site(st.focus), S = series(s), hz = s.hzo, i = L() + st.cur;
  $('#panoSite').textContent = s.name;
  const { c, w, h } = fit($('#pano'), 300);
  const ml = 34, mb = 20, mt = 8, pw = w - ml - 6, ph = h - mb - mt;
  let lo = 90, hi = -90; for (const v of hz.el) { if (v < lo) lo = v; if (v > hi) hi = v; }
  let top = Math.max(hi + 2, 8);
  for (let k = L(); k < L() + N(); k++) { if (S.sunEl[k] + 2 > top) top = S.sunEl[k] + 2; if (S.earthEl[k] + 3 > top) top = S.earthEl[k] + 3; }
  top = Math.min(90, top); const bot = Math.max(-8, Math.floor(lo) - 1.5);
  const X = (az) => ml + az / 360 * pw, Y = (el) => mt + (top - el) / (top - bot) * ph;
  const lit = S.sunVis[i];
  const g = c.createLinearGradient(0, mt, 0, mt + ph); g.addColorStop(0, '#050505'); g.addColorStop(1, '#0b0b0a'); c.fillStyle = g; c.fillRect(ml, mt, pw, ph);
  c.save(); c.beginPath(); c.rect(ml, mt, pw, ph); c.clip();
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 160; k++) { c.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`; c.fillRect(ml + rnd() * pw, mt + rnd() * ph, 1, 1); }
  // elevation grid
  const stepEl = top - bot > 40 ? 15 : top - bot > 16 ? 5 : 2;
  c.strokeStyle = '#ffffff1c'; c.fillStyle = '#aaa69a'; c.font = 'condensed 11px "Martian Mono",monospace'; c.lineWidth = 1;
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
  const fr = st.frac || 0, i2 = Math.min(S.n - 1, i + 1), lerp = (a, k) => a[k] + (a[i2] - a[k]) * fr, lerpAz = (a) => { let d = a[i2] - a[i]; if (d > 180) d -= 360; if (d < -180) d += 360; return (a[i] + d * fr + 360) % 360; };
  const sx = X(lerpAz(S.sunAz)), sy = Y(lerp(S.sunEl, i)), ex = X(lerpAz(S.earthAz)), ey = Y(lerp(S.earthEl, i));
  const gr = 46 * (playing ? 1 + 0.07 * Math.sin(performance.now() / 260) : 1);
  const gl = c.createRadialGradient(sx, sy, 0, sx, sy, gr); gl.addColorStop(0, '#fff6d8'); gl.addColorStop(0.12, '#ffc857'); gl.addColorStop(0.3, '#ffc85755'); gl.addColorStop(1, '#ffc85700');
  c.fillStyle = gl; c.beginPath(); c.arc(sx, sy, gr, 0, 7); c.fill();
  if (S.sunVis[i] >= LIT_MIN) { const fl = c.createLinearGradient(sx - 150, 0, sx + 150, 0); fl.addColorStop(0, '#ffc85700'); fl.addColorStop(0.5, '#ffe9b055'); fl.addColorStop(1, '#ffc85700'); c.fillStyle = fl; c.fillRect(sx - 150, sy - 1, 300, 2); }
  c.fillStyle = '#5aa9ff'; c.beginPath(); c.arc(ex, ey, 7, 0, 7); c.fill(); c.fillStyle = '#bfe0ff'; c.beginPath(); c.arc(ex - 2, ey - 2, 3, 0, 7); c.fill();
  // terrain
  c.beginPath(); c.moveTo(X(0), Y(hz.el[0]));
  for (let a = 1; a <= hz.el.length; a++) c.lineTo(X(a * 360 / hz.el.length), Y(hz.el[a % hz.el.length]));
  c.lineTo(X(360), mt + ph + 2); c.lineTo(X(0), mt + ph + 2); c.closePath();
  const tg = c.createLinearGradient(0, Y(hi), 0, mt + ph);
  const b = 0.25 + 0.75 * lit; tg.addColorStop(0, `rgb(${72 + 108 * b | 0},${71 + 106 * b | 0},${67 + 100 * b | 0})`); tg.addColorStop(1, `rgb(${26 + 40 * b | 0},${25 + 40 * b | 0},${23 + 38 * b | 0})`);
  c.fillStyle = tg; c.fill(); c.strokeStyle = lit > LIT_MIN ? '#f4f1e6' : '#6b6962'; c.lineWidth = 1.2; c.stroke();
  // ghosts when hidden
  if (S.sunVis[i] < LIT_MIN) { c.strokeStyle = '#ffc857'; c.setLineDash([3, 3]); c.beginPath(); c.arc(sx, sy, 7, 0, 7); c.stroke(); c.setLineDash([]); }
  if (S.earthVis[i] < COMM_MIN) { c.strokeStyle = '#5aa9ff'; c.setLineDash([3, 3]); c.beginPath(); c.arc(ex, ey, 7, 0, 7); c.stroke(); c.setLineDash([]); }
  c.font = '11px Archivo,sans-serif'; c.fillStyle = '#ffc857'; c.fillText('Sun', sx + 11, Math.max(mt + 12, sy - 9)); c.fillStyle = '#8cc4ff'; c.fillText('Earth', ex + 11, Math.max(mt + 12, ey - 9));
  c.restore();
  c.fillStyle = '#aaa69a'; c.font = 'condensed 11px "Martian Mono",monospace'; c.textAlign = 'right';
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
  c.fillStyle = '#0b0b0a'; c.fillRect(0, 0, w, h);
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
  c.lineTo(w, h); c.closePath(); c.fillStyle = '#34332f'; c.fill(); c.strokeStyle = '#bdb9ad'; c.lineWidth = 1; c.stroke();
  const vis = body ? S.earthVis[i] : S.sunVis[i];
  (body ? $('#zEarthCap') : $('#zSunCap')).textContent = body ? `Earth, true scale. ${(vis * 100).toFixed(0)}% of disc clear, ${(cv._phase * 100).toFixed(0)}% lit` : `Sun, true scale. ${(vis * 100).toFixed(0)}% of disc clear`;
}

function renderCountdown() {
  const s = site(st.focus), S = series(s), i = L() + st.cur;
  const ev = (vis, thr, upWord, downWord) => { const e = nextEvent(vis, i, thr); return e.idx < 0 ? { t: e.up ? `no ${downWord} for 2+ years` : `no ${upWord} for 2+ years`, l: e.up ? 'Stays up' : 'Stays down' } : { t: fmtDur(e.idx - i), l: (e.up ? downWord : upWord) + ' in' }; };
  const a = ev(S.sunVis, LIT_MIN, 'Sunrise', 'Sunset'), b = ev(S.earthVis, COMM_MIN, 'Earthrise', 'Earthset');
  const sw = (v) => `<i style="background:var(--${v})"></i>`, bits = stationsInView(landMs() + st.cur * HOUR), stn = STATIONS.filter((q, k) => bits >> k & 1).map(q => q.name).join(', ') || 'none';
  $('#countdown').innerHTML = `<div class="cd"><small>${sw('sun')}${a.l}</small><b>${a.t}</b></div><div class="cd"><small>${sw('earth')}${b.l}</small><b>${b.t}</b></div>
    <div class="cd"><small>${sw('sun')}Sun now</small><b>${S.sunEl[i].toFixed(2)}° el · ${S.sunAz[i].toFixed(1)}° az</b></div><div class="cd"><small>${sw('earth')}Earth now</small><b>${S.earthEl[i].toFixed(2)}° el · ${S.earthAz[i].toFixed(1)}° az</b></div>
    <div class="cd"><small><i style="background:#12a889"></i>DSN with the Moon in view</small><b>${stn}</b></div>${S.ecl[i] > 0.001 ? `<div class="cd bad"><small>Eclipse in progress</small><b>Earth covers ${(S.ecl[i] * 100).toFixed(0)}% of the Sun</b></div>` : ''}`;
  $('#cursorLbl').textContent = `T+${fmtDur(st.cur)} · ${fmtDate(landMs() + st.cur * HOUR)}`;
}

// ---------- timeline ----------
function drawTimeline() {
  const rows = st.sel.length, { c, w, h } = fit($('#timeline'), 214 + rows * 34);
  const ml = 40, mr = 26, pw = w - ml - mr, top = 8, ph = 130, n = N(), l0 = L();
  const s = site(st.focus), S = series(s), X = (k) => ml + (k - l0) / n * pw;
  let lo = -2, hi = 4; const hs = new Float32Array(n), he = new Float32Array(n);
  for (let k = 0; k < n; k++) { const i = l0 + k; hs[k] = horizonAt(s.hzo, S.sunAz[i]); he[k] = horizonAt(s.hzo, S.earthAz[i]); lo = Math.min(lo, S.sunEl[i], hs[k], Math.max(S.earthEl[i], -10)); hi = Math.max(hi, S.sunEl[i], hs[k], S.earthEl[i]); }
  lo = Math.max(lo - 1, -12); hi += 1; const Y = (e) => top + (hi - e) / (hi - lo) * ph;
  c.fillStyle = '#0b0b0a'; c.fillRect(ml, top, pw, ph);
  c.save(); c.beginPath(); c.rect(ml, top, pw, ph); c.clip();
  c.beginPath(); c.moveTo(X(l0), top + ph); for (let k = 0; k < n; k++) c.lineTo(X(l0 + k), Y(hs[k])); c.lineTo(X(l0 + n - 1), top + ph); c.closePath(); c.fillStyle = '#3a393666'; c.fill();
  const line = (f, col, dash, lw = 1.6) => { c.strokeStyle = col; c.lineWidth = lw; c.setLineDash(dash || []); c.beginPath(); for (let k = 0; k < n; k++) { const y = Y(f(k)); k ? c.lineTo(X(l0 + k), y) : c.moveTo(X(l0 + k), y); } c.stroke(); c.setLineDash([]); };
  line(k => hs[k], '#8d8a80', null, 1); line(k => he[k], '#5aa9ff88', [3, 3], 1);
  line(k => S.sunEl[l0 + k], '#ffc857'); line(k => S.earthEl[l0 + k], '#5aa9ff');
  c.restore();
  c.font = 'condensed 11px "Martian Mono",monospace'; c.fillStyle = '#aaa69a'; c.textAlign = 'right';
  const stp = hi - lo > 40 ? 20 : hi - lo > 15 ? 5 : 2; for (let e = Math.ceil(lo / stp) * stp; e <= hi; e += stp) { c.fillText(e + '°', ml - 5, Y(e) + 3); c.strokeStyle = '#ffffff10'; c.beginPath(); c.moveTo(ml, Y(e)); c.lineTo(ml + pw, Y(e)); c.stroke(); }
  c.textAlign = 'left';
  // bands per site
  let y = top + ph + 20;
  for (const id of st.sel) {
    const q = site(id), Q = series(q);
    c.fillStyle = colorOf(id); c.fillRect(ml - 34, y + 3, 16, 16); c.fillStyle = '#fff'; c.font = '700 condensed 11px "Martian Mono",monospace'; c.textAlign = 'center'; c.fillText(tagOf(id), ml - 26, y + 15); c.textAlign = 'left'; c.fillStyle = '#e9e6dc'; c.font = '11px Archivo,sans-serif'; c.fillText(q.name, ml, y - 3);
    const cw = Math.max(1, pw / n + 0.6);
    for (let k = 0; k < n; k++) { const i = l0 + k, x = X(i);
      c.fillStyle = `rgba(255,200,87,${Q.sunVis[i] < LIT_MIN ? 0.07 : 0.25 + 0.75 * Q.sunVis[i]})`; c.fillRect(x, y + 2, cw, 8);
      c.fillStyle = `rgba(90,169,255,${Q.earthVis[i] >= COMM_MIN ? 0.95 : 0.08})`; c.fillRect(x, y + 12, cw, 8); }
    y += 34;
  }
  // Earth side: Deep Space Network complexes with the Moon in their sky
  c.fillStyle = '#e9e6dc'; c.font = '11px Archivo,sans-serif'; c.fillText(`Deep Space Network complexes with the Moon above ${MASK_DEG}°`, ml, y - 3);
  { const dsn = dsnSeries(landMs(), n), cw = Math.max(1, pw / n + 0.6); c.font = 'condensed 10px "Martian Mono",monospace';
    STATIONS.forEach((sn, q) => { c.fillStyle = '#aaa69a'; c.textAlign = 'right'; c.fillText(sn.id, ml - 5, y + 9 + q * 10); c.textAlign = 'left';
      for (let k = 0; k < n; k++) { c.fillStyle = dsn[k] >> q & 1 ? '#12a889' : 'rgba(18,168,137,0.12)'; c.fillRect(X(l0 + k), y + 2 + q * 10, cw, 8); } }); }
  // day ticks + cursor
  const dstep = st.dur <= 14 ? 1 : st.dur <= 60 ? 5 : 20; c.fillStyle = '#aaa69a'; c.font = 'condensed 11px "Martian Mono",monospace'; c.textAlign = 'center';
  for (let d = 0; d <= st.dur; d += dstep) { const x = X(l0 + d * 24); c.fillText('T+' + d + 'd', x, h - 4); c.strokeStyle = '#ffffff14'; c.beginPath(); c.moveTo(x, top); c.lineTo(x, h - 16); c.stroke(); }
  c.textAlign = 'left'; const cx = X(l0 + st.cur); c.strokeStyle = '#ff5a36'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx, top); c.lineTo(cx, h - 16); c.stroke();
  $('#timeline')._geo = { ml, pw };
}
function dsnSeries(t0, n) { const key = t0 + '|' + n; if (dsnSeries.key !== key) { const a = new Uint8Array(n); for (let k = 0; k < n; k++) a[k] = stationsInView(t0 + k * HOUR); dsnSeries.key = key; dsnSeries.a = a; } return dsnSeries.a; }
function scrub() { $('#cursor').value = st.cur; rangeFill($('#cursor')); drawPano(); renderCountdown(); drawTimeline(); drawEnergy(); liveLm(); drawMap(); }
function timelinePick(e) { const g = $('#timeline')._geo; if (!g) return; const r = e.target.getBoundingClientRect(); stopPlay(); st.cur = Math.max(0, Math.min(N() - 1, Math.round((e.clientX - r.left - g.ml) / g.pw * N()))); $('#cursor').value = st.cur; rangeFill($('#cursor')); drawPano(); renderCountdown(); drawTimeline(); drawEnergy(); drawMap(); }
$('#timeline').addEventListener('pointerdown', (e) => { timelinePick(e); e.target.setPointerCapture(e.pointerId); e.target.onpointermove = timelinePick; });
$('#timeline').addEventListener('pointerup', (e) => { e.target.onpointermove = null; });

// ---------- calendar ----------
function drawCalendar() {
  const rows = st.sel.length, { c, w, h } = fit($('#cal'), 26 + rows * 50);
  const X = (d) => d / SPAN_DAYS * w, cw = w / SPAN_DAYS + 0.5;
  c.font = 'condensed 11px "Martian Mono",monospace'; c.fillStyle = '#aaa69a';
  const d0 = new Date(st.base); let mth = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1));
  while (mth.getTime() < st.base + SPAN_DAYS * DAY) { const x = X((mth.getTime() - st.base) / DAY); c.strokeStyle = '#ffffff18'; c.beginPath(); c.moveTo(x, 14); c.lineTo(x, h); c.stroke(); if (mth.getUTCMonth() % (w < 700 ? 3 : 1) === 0) c.fillText(mth.getUTCMonth() === 0 ? String(mth.getUTCFullYear()) : MON[mth.getUTCMonth()], x + 3, 10); mth = new Date(Date.UTC(mth.getUTCFullYear(), mth.getUTCMonth() + 1, 1)); }
  let y = 30;
  for (const id of st.sel) {
    const s = site(id), C = cal(s);
    c.fillStyle = colorOf(id); c.fillRect(0, y - 13, 13, 12); c.fillStyle = '#fff'; c.font = '700 condensed 10px "Martian Mono",monospace'; c.fillText(tagOf(id), 3, y - 3); c.fillStyle = '#e9e6dc'; c.font = '11px Archivo,sans-serif'; c.fillText(s.name, 18, y - 3);
    for (let d = 0; d < Math.min(SPAN_DAYS, C.count); d++) { const x = X(d);
      c.fillStyle = C.level[d] === 2 ? '#2fae62' : C.level[d] === 1 ? '#e9a91c' : '#4a1f1a'; c.fillRect(x, y, cw, 18);
      c.fillStyle = `rgba(255,200,87,${C.sunPct[d] / 100})`; c.fillRect(x, y + 20, cw, 5);
      c.fillStyle = `rgba(90,169,255,${C.commPct[d] / 100})`; c.fillRect(x, y + 26, cw, 5); }
    y += 50;
  }
  c.fillStyle = '#fff'; c.fillRect(0, 14, 2, h); c.fillStyle = '#ff5a36'; c.fillRect(X(st.slip) - 1, 14, 3, h);
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
    cdiv += `<table><tr><th>Where</th><th>Sun / link</th><th>Dark</th><th></th></tr>` + nearby.results.map((o, k) => `<tr><td>${dir(o)}</td><td>${o.sunPct.toFixed(0)}% / ${o.commPct.toFixed(0)}%</td><td>${fmtDur(o.maxDarkH)}</td><td>${o.dist ? `<button data-near="${k}">Use</button>` : ''}</td></tr>`).join('') + `</table><p class="hint">${nearby.tested} spots tested on the ${sp} m grid${nearby.here ? `; this exact spot scores ${nearby.here.sunPct.toFixed(0)}% / ${nearby.here.commPct.toFixed(0)}% on that grid` : ''}. Screening only: confirm with full-resolution terrain.</p>`;
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
    c.fillStyle = '#aaa69a'; c.fillText('Loading map…', 12, 20); return;
  }
  c.drawImage(im, 0, 0, w, h);
  const t = landMs() + st.cur * HOUR, sun = subPoint(eph, 0, t), ear = subPoint(eph, 1, t);
  if (st.map === 'global') {
    const sv = [Math.cos(sun.lat * D2R) * Math.cos(sun.lon * D2R), Math.cos(sun.lat * D2R) * Math.sin(sun.lon * D2R), Math.sin(sun.lat * D2R)], nx = 180, ny = 90;
    c.fillStyle = 'rgba(2,4,12,0.62)';
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const la = (90 - (j + 0.5) * 2) * D2R, lo = ((i + 0.5) * 2 - 180) * D2R; if (Math.cos(la) * Math.cos(lo) * sv[0] + Math.cos(la) * Math.sin(lo) * sv[1] + Math.sin(la) * sv[2] < 0) c.fillRect(i * w / nx, j * h / ny, w / nx + 0.5, h / ny + 0.5); }
    for (const [p, col, lbl] of [[sun, '#ffc857', 'Sun overhead'], [ear, '#5aa9ff', 'Earth overhead']]) { const [x, y] = mapXY(p.lat, p.lon, w, h); c.fillStyle = col; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); c.font = '11px Archivo,sans-serif'; c.fillText(lbl, x + 9, y + 4); }
  } else {
    for (const [p, col, lbl] of [[sun, '#ffc857', 'to Sun'], [ear, '#5aa9ff', 'to Earth']]) {
      const a = p.lon * D2R, dx = Math.sin(a), dy = -Math.cos(a), r1 = w / 2 - 54, r2 = w / 2 - 14;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 3; c.beginPath(); c.moveTo(w / 2 + dx * r1, h / 2 + dy * r1); c.lineTo(w / 2 + dx * r2, h / 2 + dy * r2); c.stroke();
      c.beginPath(); c.moveTo(w / 2 + dx * (r2 + 8), h / 2 + dy * (r2 + 8)); c.lineTo(w / 2 + dx * r2 - dy * 7, h / 2 + dy * r2 + dx * 7); c.lineTo(w / 2 + dx * r2 + dy * 7, h / 2 + dy * r2 - dx * 7); c.fill();
      c.font = '600 11px Archivo,sans-serif'; { const tx = `${lbl} · ${Math.abs(p.lat).toFixed(1)}° ${p.lat < 0 ? 'below' : 'above'} the equator`, tw = c.measureText(tx).width, lx = Math.min(w - tw - 6, Math.max(6, w / 2 + dx * (r1 - 10) - tw / 2)), ly = Math.min(h - 8, Math.max(14, h / 2 + dy * (r1 - 10) + (dy > 0.5 ? -4 : 12))); c.lineWidth = 3; c.strokeStyle = '#000c'; c.strokeText(tx, lx, ly); c.fillText(tx, lx, ly); }
    }
    c.strokeStyle = '#ffffff35'; c.lineWidth = 1; c.font = 'condensed 11px "Martian Mono",monospace'; c.fillStyle = '#ffffff90';
    for (const la of st.map === 'south' ? [-82, -84, -86, -88] : [-88, -89, -89.5]) { const r = 2 * R_MOON * Math.tan((90 + la) * D2R / 2) / m.half * w / 2; c.beginPath(); c.arc(w / 2, h / 2, r, 0, 7); c.stroke(); c.fillText(Math.abs(la) + '°S', w / 2 + 3, h / 2 - r - 3); }
  }
  for (const s of sites) { const [x, y] = mapXY(s.lat, s.lon, w, h); if (x < 0 || y < 0 || x > w || y > h) continue; const on = st.sel.includes(s.id);
    c.beginPath(); c.arc(x, y, on ? 6 : 3, 0, 7); c.fillStyle = on ? colorOf(s.id) : '#ffffffcc'; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
    if (on) { c.font = '600 11px Archivo,sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000c'; const tx = x + 9 + c.measureText(s.name).width > w ? x - 9 - c.measureText(s.name).width : x + 9; c.strokeText(s.name, tx, y + 4); c.fillStyle = '#fff'; c.fillText(s.name, tx, y + 4); } }
}
$('#map').addEventListener('click', (e) => {
  const r = e.target.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; let lat, lon;
  if (st.map === 'global') { lon = x * 360 - 180; lat = 90 - y * 180; }
  else { const m = MAPS[st.map], px = (x * 2 - 1) * m.half, py = (1 - y * 2) * m.half; lat = -90 + 2 * Math.atan(Math.hypot(px, py) / (2 * R_MOON)) * R2D; lon = Math.atan2(px, py) * R2D; }
  $('#cLat').value = lat.toFixed(4); $('#cLon').value = lon.toFixed(4); $('#customMsg').textContent = 'Coordinates filled in. Press "Compute horizon from LOLA".';
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
$('#cursor').addEventListener('input', (e) => { stopPlay(); st.cur = +e.target.value; scrub(); });
function stopPlay() { if (playing) cancelAnimationFrame(playing); playing = null; st.frac = 0; $('#play').textContent = 'Play mission'; }
function startPlay() {
  stopPlay(); $('#play').textContent = 'Pause'; if (st.cur >= N() - 2) st.cur = 0;
  let last = performance.now(); const speed = N() / 14000;                    // whole mission in ~14 s
  const tick = (t) => {
    const dt = Math.max(0, Math.min(100, t - last)); last = t; const pos = st.cur + st.frac + dt * speed;
    if (pos >= N() - 1) { st.cur = N() - 1; stopPlay(); $('#cursor').value = st.cur; rangeFill($('#cursor')); drawPano(); renderCountdown(); drawTimeline(); drawEnergy(); drawMap(); return; }
    const cI = Math.floor(pos), changed = cI !== st.cur; st.cur = cI; st.frac = pos - cI; drawPano();
    if (changed) { $('#cursor').value = st.cur; rangeFill($('#cursor')); renderCountdown(); drawTimeline(); drawEnergy(); liveLm(); if (cI % 4 === 0) drawMap(); }
    playing = requestAnimationFrame(tick);
  };
  playing = requestAnimationFrame(tick);
}
$('#play').addEventListener('click', () => { if (playing) { stopPlay(); drawPano(); } else startPlay(); });
function rangeFill(el) { el.style.setProperty('--p', ((el.value - el.min) / Math.max(1, el.max - el.min) * 100) + '%'); }
function setMode(m) { st.mode = m; document.body.classList.toggle('planner', m === 'planner'); $('#modePlanner').classList.toggle('on', m === 'planner'); $('#modeExplorer').classList.toggle('on', m !== 'planner'); writeHash(); requestAnimationFrame(() => { drawPano(); drawTimeline(); drawEnergy(); drawCalendar(); drawLm(); drawMap(); }); }
$('#modePlanner').addEventListener('click', () => setMode('planner')); $('#modeExplorer').addEventListener('click', () => setMode('explorer'));
$('#rulesBtn').addEventListener('click', (e) => { $('#rules').hidden = !$('#rules').hidden; e.target.setAttribute('aria-expanded', String(!$('#rules').hidden)); });
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
// a share link pasted into an already-open tab only changes the hash, so re-read it
// (writeHash uses replaceState, which does not fire this event)
addEventListener('hashchange', async () => { if (!eph) return; await readHash(); setMode(st.mode); st.cur = 0; nearby = null; update(); });

// ---------- energy model ----------
function drawEnergy() {
  const { c, w, h } = fit($('#energy'), 170), ml = 40, pw = w - ml - 26, top = 8, ph = h - 30, n = N(), l0 = L();
  const X = (k) => ml + k / n * pw, Y = (v) => top + (1 - v) * ph;
  c.fillStyle = '#0b0b0a'; c.fillRect(ml, top, pw, ph);
  c.font = 'condensed 11px "Martian Mono",monospace'; c.fillStyle = '#aaa69a'; c.textAlign = 'right';
  for (const v of [0, 0.5, 1]) { c.fillText(v * 100 + '%', ml - 5, Y(v) + 3); c.strokeStyle = '#ffffff12'; c.beginPath(); c.moveTo(ml, Y(v)); c.lineTo(ml + pw, Y(v)); c.stroke(); }
  let out = '';
  for (const id of st.sel) {
    const s = site(id), E = simulateEnergy(series(s), l0, l0 + n, st.en), col = colorOf(id);
    c.beginPath(); for (let k = 0; k < n; k++) k ? c.lineTo(X(k), Y(E.soc[k])) : c.moveTo(X(k), Y(E.soc[k]));
    if (id === st.focus) { c.save(); c.lineTo(X(n - 1), Y(0)); c.lineTo(X(0), Y(0)); c.closePath(); const g = c.createLinearGradient(0, top, 0, top + ph); g.addColorStop(0, col + '44'); g.addColorStop(1, col + '00'); c.fillStyle = g; c.fill(); c.restore(); c.beginPath(); for (let k = 0; k < n; k++) k ? c.lineTo(X(k), Y(E.soc[k])) : c.moveTo(X(k), Y(E.soc[k])); }
    c.strokeStyle = col; c.lineWidth = id === st.focus ? 2.4 : 1.4; c.stroke();
    c.fillStyle = '#ff5d6c'; for (let k = 0; k < n; k++) if (E.soc[k] <= 0) c.fillRect(X(k), Y(0) - 3, Math.max(1, pw / n + 0.5), 3);
    const m = s._m, gb = m ? m.commPct / 100 * m.hours * 3600 * st.en.mbps / 8 / 1000 : 0;
    out += `<div class="cd ${E.deadAtH == null ? 'good' : 'bad'}"><small><i style="background:${col}"></i>${s.name}</small><b>${E.deadAtH == null ? `Survives · lowest charge ${(E.minSoc * 100).toFixed(0)}%` : `Battery empty at T+${fmtDur(E.deadAtH)}`}</b><span>${E.deadAtH == null ? '' : `without power for ${fmtDur(E.deadH)} · `}${(E.generatedWh / 1000).toFixed(1)} kWh generated · up to ${gb < 10 ? gb.toFixed(1) : gb.toFixed(0)} GB sent home</span></div>`;
  }
  const dstep = st.dur <= 14 ? 1 : st.dur <= 60 ? 5 : 20; c.fillStyle = '#aaa69a'; c.textAlign = 'center';
  for (let d = 0; d <= st.dur; d += dstep) c.fillText('T+' + d + 'd', X(d * 24), h - 6);
  c.textAlign = 'left'; c.strokeStyle = '#ff5a36'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(st.cur), top); c.lineTo(X(st.cur), top + ph); c.stroke();
  $('#enOut').innerHTML = out;
}
for (const [id, key] of [['enArr', 'arrayW'], ['enLoad', 'loadW'], ['enSleep', 'sleepW'], ['enBatt', 'battWh'], ['enMbps', 'mbps']]) $('#' + id).addEventListener('input', (e) => { st.en[key] = Math.max(0, +e.target.value || 0); drawEnergy(); });
$('#enTrack').addEventListener('change', (e) => { st.en.tracking = e.target.checked; drawEnergy(); });
$('#enPreset').addEventListener('change', (e) => { const [a, l, sl, b] = e.target.value.split(',').map(Number); Object.assign(st.en, { arrayW: a, loadW: l, sleepW: sl, battWh: b }); syncEnergyInputs(); drawEnergy(); });
function syncEnergyInputs() { $('#enArr').value = st.en.arrayW; $('#enLoad').value = st.en.loadW; $('#enSleep').value = st.en.sleepW; $('#enBatt').value = st.en.battWh; $('#enMbps').value = st.en.mbps; $('#enTrack').checked = st.en.tracking; }

// ---------- shadow map ----------
let lmQueued = null;
function runLm(mode, quiet) {
  if (lmBusy) { if (!quiet) lmQueued = mode; return Promise.resolve(); } const s = site(st.focus), n = mode === 'now' ? 1 : 36, times = [];
  for (let k = 0; k < n; k++) times.push(mode === 'now' ? landMs() + st.cur * HOUR : landMs() + (k + 0.5) / n * N() * HOUR);
  lmBusy = true; if (!quiet) $('#lmNow').disabled = $('#lmMission').disabled = true;
  return ask({ type: 'lightmap', lat: s.lat, lon: s.lon, mast: s.mast, N: 220, times, quiet }).then(r => {
    lm = { N: r.N, res: r.res, lit: r.lit, comm: r.comm, h: r.h, mode, id: s.id, lat: s.lat, lon: s.lon, mast: s.mast, when: times[0], land: landMs(), dur: st.dur, cur: st.cur, sunAz: series(s).sunAz[L() + st.cur] };
    drawLm();
  }).catch(e => toast('Shadow map failed: ' + e.message, 4000)).finally(() => { lmBusy = false; $('#lmNow').disabled = $('#lmMission').disabled = false; if (lmQueued) { const q = lmQueued; lmQueued = null; runLm(q); } });
}
const RAMP = { sun: [[38, 38, 42], [255, 240, 200]], sunAvg: [[30, 29, 32], [196, 84, 28], [255, 226, 120]], earth: [[30, 32, 38], [88, 166, 255]] };
function rampAt(stops, v) { const x = Math.max(0, Math.min(1, v)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i; return [0, 1, 2].map(k => stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f); }
function drawLm() {
  const cv = $('#lm'), wCss = cv.clientWidth || 400, { c, w, h } = fit(cv, wCss), s = site(st.focus);
  const stops = lmLayer === 'earth' ? RAMP.earth : lm && lm.mode === 'mission' ? RAMP.sunAvg : RAMP.sun;
  $('#lmRamp').style.background = `linear-gradient(90deg, ${stops.map(q => `rgb(${q.join(',')})`).join(',')})`;
  if (!lm || lm.id !== st.focus) {
    c.fillStyle = '#0b0b0a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#ffffff10';
    for (let k = 1; k < 8; k++) { c.beginPath(); c.moveTo(k * w / 8, 0); c.lineTo(k * w / 8, h); c.moveTo(0, k * h / 8); c.lineTo(w, k * h / 8); c.stroke(); }
    c.fillStyle = '#aaa69a'; c.font = '13px Archivo,sans-serif'; c.textAlign = 'center'; c.fillText('Press "Cast shadows at this moment"', w / 2, h / 2 - 8); c.fillText('to light the terrain around ' + (s.name.length > 34 ? 'this site' : s.name), w / 2, h / 2 + 12); c.textAlign = 'left';
    $('#lmInfo').textContent = 'Nothing computed yet for this site.'; if (relief) { relief.ready = false; if (lmView === '3d') relief.draw(); } return;
  }
  const n = lm.N, off = drawLm.off || (drawLm.off = document.createElement('canvas')); off.width = off.height = n;
  const oc = off.getContext('2d'), im = oc.createImageData(n, n), d = im.data, val = lmLayer === 'earth' ? lm.comm : lm.lit;
  const la = lm.mode === 'now' ? lm.sunAz * D2R : -45 * D2R, lx = Math.sin(la), ly = Math.cos(la); let sum = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
    const gx = (lm.h[j * n + i1] - lm.h[j * n + i0]) / ((i1 - i0) * lm.res), gy = (lm.h[j0 * n + i] - lm.h[j1 * n + i]) / ((j1 - j0) * lm.res);
    const sh = Math.max(0.12, Math.min(1.2, 0.55 + 3.2 * (-gx * lx - gy * ly))), v = val[k], col = rampAt(stops, v), a = lm.mode === 'now' && lmLayer === 'sun' ? (v > 0.02 ? 0.3 + 0.7 * sh : 0.7 + 0.5 * sh) : 0.45 + 0.6 * sh;
    d[4 * k] = col[0] * a; d[4 * k + 1] = col[1] * a; d[4 * k + 2] = col[2] * a; d[4 * k + 3] = 255; sum += v;
  }
  oc.putImageData(im, 0, 0);
  if (relief) { relief.setData(lm.id + '|' + n + '|' + lm.res, lm.h, n, lm.res, off); if (lmView === '3d') relief.draw(); }
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(off, 0, 0, w, h);
  // site marker, north arrow, scale bar
  c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(w / 2, h / 2, 7, 0, 7); c.moveTo(w / 2 - 13, h / 2); c.lineTo(w / 2 - 4, h / 2); c.moveTo(w / 2 + 4, h / 2); c.lineTo(w / 2 + 13, h / 2); c.moveTo(w / 2, h / 2 - 13); c.lineTo(w / 2, h / 2 - 4); c.moveTo(w / 2, h / 2 + 4); c.lineTo(w / 2, h / 2 + 13); c.stroke();
  const span = n * lm.res, nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000].find(v => v >= span / 5) || 200000, bw = nice / span * w;
  c.fillStyle = '#000a'; c.fillRect(10, h - 30, bw + 16, 22); c.fillStyle = '#fff'; c.fillRect(18, h - 14, bw, 2); c.font = 'condensed 11px "Martian Mono",monospace'; c.fillText(nice >= 1000 ? nice / 1000 + ' km' : nice + ' m', 18, h - 18);
  c.fillStyle = '#000a'; c.fillRect(w - 34, 10, 24, 34); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText('N', w - 22, 23); c.beginPath(); c.moveTo(w - 22, 27); c.lineTo(w - 27, 39); c.lineTo(w - 17, 39); c.fill(); c.textAlign = 'left';
  if (lm.mode === 'now' && lmLayer === 'sun') { const ax = w / 2 + Math.sin(lm.sunAz * D2R) * (w / 2 - 26), ay = h / 2 - Math.cos(lm.sunAz * D2R) * (h / 2 - 26); c.fillStyle = '#ffc857'; c.beginPath(); c.arc(ax, ay, 6, 0, 7); c.fill(); c.strokeStyle = '#ffc85788'; c.setLineDash([2, 5]); c.beginPath(); c.moveTo(ax, ay); c.lineTo(w / 2, h / 2); c.stroke(); c.setLineDash([]); c.fillText('Sun', ax + 9, ay + 4); }
  const stale = lm.land !== landMs() || lm.dur !== st.dur || (lm.mode === 'now' && lm.cur !== st.cur);
  $('#lmInfo').innerHTML = (lm.mode === 'now' ? `Shadows at <b>${fmtDate(lm.when)}</b>.` : `Average of 36 moments across a ${lm.dur}-day mission landing <b>${fmtDate(lm.land, true)}</b>.`) + ` ${(span / 1000).toFixed(span < 30000 ? 1 : 0)} km across, ${Math.round(lm.res)} m per pixel. ${lmLayer === 'earth' ? 'Earth is in view from' : 'Sunlight reaches'} <b>${(sum / (n * n) * 100).toFixed(0)}%</b> of this ground${lm.mode === 'mission' ? ' on average' : ''}.` + (stale ? ' <span style="color:var(--marg)">Settings changed. Recompute to update.</span>' : '');
}
function lmAt(e) { const r = $('#lm').getBoundingClientRect(), n = lm.N, i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / r.width * n))), j = Math.max(0, Math.min(n - 1, Math.floor((e.clientY - r.top) / r.height * n))); return { i, j, k: j * n + i, de: (i - (n - 1) / 2) * lm.res, dn: ((n - 1) / 2 - j) * lm.res, x: e.clientX - r.left, y: e.clientY - r.top }; }
$('#lm').addEventListener('mousemove', (e) => { const t = $('#lmTip'); if (!lm || lm.id !== st.focus) { t.hidden = true; return; } const p = lmAt(e), dist = Math.hypot(p.de, p.dn);
  t.hidden = false; t.innerHTML = `${dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'} from the site · ${lm.h[p.k] >= 0 ? '+' : ''}${Math.round(lm.h[p.k])} m<br><b style="color:var(--sun)">${(lm.lit[p.k] * 100).toFixed(0)}%</b> sunlight · <b style="color:#7db8ff">${(lm.comm[p.k] * 100).toFixed(0)}%</b> Earth link · click to add`;
  t.style.left = Math.min($('#lm').clientWidth - 230, p.x + 14) + 'px'; t.style.top = p.y + 16 + 'px'; });
$('#lm').addEventListener('mouseleave', () => { $('#lmTip').hidden = true; });
$('#lm').addEventListener('click', (e) => { if (!lm || lm.id !== st.focus) return; const p = lmAt(e), o = offsetLL(lm.lat, lm.lon, p.de, p.dn); addCustom(o.lat, o.lon, lm.mast); });
$('#lmNow').addEventListener('click', () => runLm('now')); $('#lmMission').addEventListener('click', () => runLm('mission'));
$('#lmLayer').addEventListener('click', (e) => { if (e.target.dataset.l) { lmLayer = e.target.dataset.l; for (const b of $('#lmLayer').children) b.classList.toggle('on', b === e.target); drawLm(); } });

$('#lmView').addEventListener('click', (e) => {
  const v = e.target.dataset.v; if (!v) return;
  if (v === '3d' && !relief) { toast('3D relief needs WebGL, which is not available in this browser', 4000); return; }
  lmView = v; for (const b of $('#lmView').children) b.classList.toggle('on', b === e.target);
  $('#lm').hidden = v === '3d'; $('#lm3d').hidden = $('#lmExWrap').hidden = v !== '3d'; $('#lmTip').hidden = true;
  if (v === '3d' && (!lm || lm.id !== st.focus)) runLm('now'); drawLm();
});
$('#lmEx').addEventListener('input', (e) => { $('#lmExLbl').textContent = e.target.value + '×'; rangeFill(e.target); if (relief) { relief.exag = +e.target.value; relief.draw(); } });

// keep the 'this moment' map in step with the mission clock once it has been turned on
function liveLm() { if (lm && lm.mode === 'now' && lm.id === st.focus && !lmBusy && (lm.cur !== st.cur || lm.land !== landMs())) runLm('now', true); }

// ---------- guided tour ----------
const TOUR = [
  { sel: '#cards', title: 'Three sites, one landing date', text: 'These are three real places near the Moon’s south pole. For a 14-day mission landing on 15 January 2027, all three are GO: enough sunlight for power, and enough view of Earth to talk home.', run() { Object.assign(st, { sel: ['ridge', 'im2', 'malapert'], focus: 'ridge', base: Date.UTC(2027, 0, 15), slip: 0, dur: 14, cur: 0, rules: { ...DEFAULT_RULES } }); } },
  { sel: '#panoPanel', title: 'Stand on the surface', text: 'This is the true horizon around the lander, built from NASA’s LOLA laser measurements. The Sun never rises more than a degree or two here. It just circles the horizon, ducking behind hills. Watch the mission play.', after() { startPlay(); } },
  { sel: '#cards', title: 'Then the launch slips 20 days', text: 'Same sites, same mission, three weeks later, and every one is NO-GO. Two would land in darkness; the third would land with Earth out of sight. This is the problem real mission planners face.', run() { st.slip = 20; st.cur = 0; } },
  { sel: '#calPanel', title: 'Two years of landing days at a glance', text: 'Each column is a possible landing day, coloured by whether the mission would meet the rules. The white line is the plan; the blue line is where the slip put us. Click any green day to land then.' },
  { sel: '#rankPanel', title: 'Which site forgives a slip?', text: 'The same calendar, run for every site in the list and ranked. A site with long green stretches can absorb a delay. One with thin slivers leaves no room for error.' },
  { sel: '#rescuePanel', title: 'Rescue the mission', text: 'Earthset searches for a way out: the next good date at this site (here, just three days later), a better site for the same date, or a better-lit spot a short drive away.' },
  { sel: '#lmPanel', title: 'Real shadows on real terrain', text: 'Now it casts shadows across the terrain around the site, pixel by pixel, and plays the mission so you can watch them sweep. With the Sun this low, a small ridge throws a shadow kilometres long. Click any bright spot to try it as a landing site, or switch to 3D relief and orbit the terrain.', after() { runLm('now').then(() => { if (tourK === TOUR.findIndex(q => q.sel === '#lmPanel')) startPlay(); }); } },
  { sel: '#enPanel', title: 'Sunlight becomes survival', text: 'Give the lander a solar array and a battery. The charge falls whenever terrain hides the Sun; if it reaches zero, the mission is over. Change the numbers to design a lander that survives.' },
  { sel: '#about', title: 'Check our numbers', text: 'Every Sun and Earth position matches NASA/JPL Horizons to 0.00003°. The tool reproduces the eclipse that Blue Ghost photographed from the Moon in March 2025 to within four minutes. 28 automated checks guard the maths.' },
];
function showTour(k) {
  stopPlay(); tourK = k; const step = TOUR[k];
  if (step.run) { step.run(); nearby = null; update(); }
  document.querySelectorAll('.spot').forEach(e => e.classList.remove('spot'));
  const el = $(step.sel); revealFor(el); el.classList.add('spot');
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: el.offsetHeight > innerHeight * 0.7 ? 'start' : 'center' });
  $('#tour').hidden = false; $('#tourStep').textContent = `Step ${k + 1} of ${TOUR.length}`; $('#tourTitle').textContent = step.title; $('#tourText').textContent = step.text;
  $('#tourProg').style.width = ((k + 1) / TOUR.length * 100) + '%'; $('#tourBack').disabled = k === 0; $('#tourNext').textContent = k === TOUR.length - 1 ? 'Finish' : 'Next';
  clearTimeout(showTour.t); if (step.after) showTour.t = setTimeout(() => { if (tourK === k) step.after(); }, 900);
}
function endTour() { tourK = -1; clearTimeout(showTour.t); $('#tour').hidden = true; document.querySelectorAll('.spot').forEach(e => e.classList.remove('spot')); }
$('#tourBtn').addEventListener('click', () => showTour(0));
$('#tourNext').addEventListener('click', () => tourK >= TOUR.length - 1 ? endTour() : showTour(tourK + 1));
$('#tourBack').addEventListener('click', () => tourK > 0 && showTour(tourK - 1)); $('#tourClose').addEventListener('click', endTour);
addEventListener('keydown', (e) => { if (tourK < 0) return; if (e.key === 'Escape') endTour(); else if (e.key === 'ArrowRight') $('#tourNext').click(); else if (e.key === 'ArrowLeft') $('#tourBack').click(); });

// ---------- live hero: the real sky over the ridge, this minute ----------
// ---------- site ranking: the calendar for every site ----------
let rankJob = 0, rankKey = '', rankRows = [];
function scheduleRank() {
  const key = [st.base, st.dur, JSON.stringify(st.rules), sites.map(s => s.id).join()].join('|');
  if (key === rankKey) { renderRank(); return; }
  rankKey = key; rankRows = []; const job = ++rankJob, list = sites.slice(); let k = 0;
  $('#rankInfo').textContent = `scoring ${list.length} sites…`;
  const step = () => {
    if (job !== rankJob) return;
    const s = list[k++], C = cal(s); rankRows.push({ s, C, ...calStats(C) });
    if (k < list.length) setTimeout(step, 0); else { rankRows.sort((a, b) => b.go - a.go || b.best - a.best); renderRank(); }
  };
  setTimeout(step, 150);
}
function renderRank() {
  if (rankRows.length < sites.length) return;
  $('#rankInfo').textContent = `${st.dur}-day mission, 730 landing days from ${fmtDate(st.base, true)}`;
  let h = '<table><tr><th></th><th>Site</th><th>Each landing day, left to right</th><th class="num">GO days</th><th class="num hideS">Longest window</th><th class="num hideS">Slip margin</th><th></th></tr>';
  rankRows.forEach((r, i) => {
    const on = st.sel.includes(r.s.id), sl = slipInfo(r.s);
    h += `<tr class="${on ? 'sel' : ''}"><td class="rk">${i + 1}</td><td class="nmc">${on ? tagHtml(r.s.id) : ''}${r.s.name}</td><td class="strip"><canvas width="730" height="14" data-i="${i}"></canvas></td><td class="num">${r.go} (${(r.go / r.end * 100).toFixed(0)}%)</td><td class="num hideS">${r.best} d</td><td class="num hideS">${sl.ok ? sl.margin + (sl.open ? '+' : '') + ' d' : sl.next == null ? 'no GO day' : 'GO in ' + sl.next + ' d'}</td><td>${on ? '' : `<button class="ghost" data-cmp="${r.s.id}">Compare</button>`}</td></tr>`;
  });
  $('#rank').innerHTML = h + '</table>';
  for (const cv of $('#rank').querySelectorAll('canvas')) {
    const r = rankRows[+cv.dataset.i], c = cv.getContext('2d');
    for (let d = 0; d < r.end; d++) { c.fillStyle = r.C.level[d] === 2 ? '#2fae62' : r.C.level[d] === 1 ? '#e9a91c' : '#4a1f1a'; c.fillRect(d, 0, 1, 14); }
    c.fillStyle = '#fff'; c.fillRect(st.slip, 0, 3, 14);
  }
}
$('#rank').addEventListener('click', (e) => { const id = e.target.dataset.cmp; if (!id) return; if (st.sel.length >= 4) st.sel.pop(); st.sel.push(id); st.focus = id; nearby = null; update(); });

// ---------- views (tabs), sites drawer, "what is this?" help ----------
let tab = 'answer';
function setTab(t, scrollTo) {
  tab = t;
  for (const el of document.querySelectorAll('[data-tab]')) { if (el.tagName === 'BUTTON') continue; el.classList.toggle('off', el.dataset.tab !== t); }
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === t);
  if (scrollTo !== false) { const top = $('#tabs').getBoundingClientRect().top + scrollY - 90; if (scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' }); }
}
function revealFor(el) { const h = el.closest('[data-tab]'); if (h && h.dataset.tab !== tab) setTab(h.dataset.tab, false); }
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]'); if (!a || a.getAttribute('href') === '#') return;
  const t = document.getElementById(a.getAttribute('href').slice(1)); if (!t) return;
  e.preventDefault(); revealFor(t); requestAnimationFrame(() => t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }));
});
$('#sitesBtn').addEventListener('click', (e) => { const d = $('#sitesDrawer'); d.hidden = !d.hidden; e.currentTarget.setAttribute('aria-expanded', String(!d.hidden)); if (!d.hidden) d.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }); });
function setupHelp() {
  for (const ex of document.querySelectorAll('.panel .explain')) {
    const hd = ex.parentElement.querySelector('.phead'); if (!hd) continue;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'help ghost'; b.textContent = 'What is this?'; b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => { const o = ex.classList.toggle('open'); b.setAttribute('aria-expanded', String(o)); b.textContent = o ? 'Hide' : 'What is this?'; });
    hd.appendChild(b);
  }
}
setupHelp(); setTab('answer', false);

// ---------- AI key (optional, stays in this browser) ----------
function syncAiUi() { const m = aiMode(), own = !!getKey(); $('#aiState').textContent = own ? 'Your key' : m === 'server' ? 'Built in' : 'Off'; $('#aiState').classList.toggle('on', !!m); $('#aiForget').hidden = !own; $('#askMode').hidden = !m; }
$('#aiSave').addEventListener('click', () => { const v = $('#aiKey').value.trim(); if (!v) { toast('Paste a Gemini API key first'); return; } if (!setKey(v)) { toast('This browser blocks local storage, so the key cannot be saved'); return; } $('#aiKey').value = ''; syncAiUi(); toast('AI assistant on. The key is stored only in this browser.'); });
$('#aiForget').addEventListener('click', () => { setKey(''); syncAiUi(); toast('AI key removed from this browser'); });
syncAiUi();

// ---------- headline answer ----------
function renderAnswer() {
  const el = $('#answer'), list = st.sel.map(site), tot = list.length;
  const go = list.filter(s => s._v && s._v.level === 'go'), marg = list.filter(s => s._v && s._v.level === 'marginal');
  const planned = list.filter(s => cal(s).level[0] === 2).length;
  const cls = go.length === tot ? 'good' : go.length + marg.length ? 'mid' : 'bad';
  const margins = go.map(s => slipInfo(s)).filter(x => x.ok).map(x => x.margin);
  let t = `Landing <b>${fmtDate(landMs())}</b>, ${st.dur}-day mission. `;
  t += go.length ? `<b>${go.map(s => s.name.replace(/ \(.*/, '')).join(', ')}</b> ${go.length === 1 ? 'meets' : 'meet'} your rules. ` : 'No site meets your rules on this date. ';
  if (st.slip) t += `At the planned date, <b>${planned} of ${tot}</b> ${tot === 1 ? 'was' : 'were'} GO: a <b>${st.slip}-day slip</b> ${go.length < planned ? 'costs you ' + (planned - go.length) + ' site' + (planned - go.length > 1 ? 's' : '') : 'did not change that'}. `;
  else if (margins.length) { const mm = Math.min(...margins); t += mm === 0 ? 'There is no slack: a one-day slip would break at least one GO site. ' : `The plan absorbs a launch slip of up to <b>${mm}</b> day${mm === 1 ? '' : 's'} at every GO site. `; }
  el.hidden = false;
  el.innerHTML = `<div class="big ${cls}">${go.length}/${tot} <small>sites GO</small></div><p>${t}</p><div class="acts"><button id="cardBtn" title="Download a shareable PNG of this scenario">Download mission card</button><a class="ghost" href="#rescuePanel">Find a rescue</a></div>`;
}
$('#answer').addEventListener('click', (e) => { if (e.target.id === 'cardBtn') missionCard(); });

// ---------- shareable mission card (PNG) ----------
function missionCard() {
  const W = 1200, H = 630, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#07080d'); g.addColorStop(1, '#10162a'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  const rg = c.createRadialGradient(W - 120, 90, 0, W - 120, 90, 420); rg.addColorStop(0, 'rgba(255,190,90,.28)'); rg.addColorStop(1, 'rgba(255,190,90,0)'); c.fillStyle = rg; c.fillRect(0, 0, W, H);
  c.fillStyle = '#5aa9ff'; c.beginPath(); c.arc(64, 66, 16, 0, 7); c.fill(); c.fillStyle = '#f2f4fa'; c.font = '800 30px Archivo, sans-serif'; c.fillText('EARTHSET', 94, 78);
  c.fillStyle = '#a3abc0'; c.font = '20px Archivo, sans-serif'; c.fillText(`Landing ${fmtDate(landMs())} · ${st.dur}-day mission${st.slip ? ` · slipped ${st.slip} d` : ''}`, 64, 128);
  const list = st.sel.map(site); const rowH = Math.min(100, 380 / list.length);
  list.forEach((s, k) => {
    const y = 170 + k * rowH, m = s._m, v = s._v, col = v.level === 'go' ? '#3ddc97' : v.level === 'marginal' ? '#ffc857' : '#ff6b7a';
    c.fillStyle = 'rgba(255,255,255,.06)'; c.beginPath(); c.roundRect(64, y, W - 128, rowH - 12, 16); c.fill();
    c.fillStyle = col; c.fillRect(64, y + 10, 5, rowH - 32);
    c.fillStyle = '#f2f4fa'; c.font = '700 24px Archivo, sans-serif'; c.fillText(s.name.length > 38 ? s.name.slice(0, 37) + '…' : s.name, 90, y + 38);
    c.fillStyle = '#a3abc0'; c.font = '15px "Martian Mono", monospace'; c.fillText(fmtLL(s).replace(/  /g, ' '), 90, y + 62);
    c.font = '700 26px "Martian Mono", monospace'; c.fillStyle = '#ffc857'; c.fillText(m.sunPct.toFixed(0) + '%', 640, y + 40); c.fillStyle = '#5aa9ff'; c.fillText(m.commPct.toFixed(0) + '%', 780, y + 40);
    c.fillStyle = '#6f778c'; c.font = '13px Archivo, sans-serif'; c.fillText('sunlit', 640, y + 60); c.fillText('Earth link', 780, y + 60);
    c.fillStyle = '#a3abc0'; c.font = '700 20px "Martian Mono", monospace'; c.fillText(fmtDur(m.maxDarkH), 910, y + 40); c.font = '13px Archivo, sans-serif'; c.fillStyle = '#6f778c'; c.fillText('longest dark', 910, y + 60);
    c.fillStyle = col; c.font = '800 20px "Martian Mono", monospace'; c.textAlign = 'right'; c.fillText(v.level === 'go' ? 'GO' : v.level === 'marginal' ? 'MARGINAL' : 'NO-GO', W - 92, y + 48); c.textAlign = 'left';
  });
  c.fillStyle = '#6f778c'; c.font = '15px Archivo, sans-serif'; c.fillText('Sun & Earth from NASA/JPL DE440 (within 0.00003° of Horizons) · terrain from NASA LRO LOLA · Not an official NASA product', 64, H - 40);
  c.fillText('Built for the 2026 NASA Space Apps Challenge · Lunar Landing Site Navigator', 64, H - 18);
  cv.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'earthset-mission-card.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Mission card saved'); });
}

// ---------- ask Earthset: plain-English scenario parser (rules, no AI service) ----------
const ALIASES = { ridge: ['connecting ridge', 'shackleton-de gerlache', 'de gerlache', 'the ridge', 'ridge'], malapert: ['malapert'], mouton: ['mons mouton', 'mouton'], im2: ['im-2', 'im 2', 'im2', 'athena'], im1: ['im-1', 'im 1', 'im1', 'odysseus'], shack: ['shackleton crater', 'shackleton'], cy3: ['chandrayaan', 'vikram'], a11: ['apollo 11', 'apollo11', 'tranquility'], a12: ['apollo 12'], a14: ['apollo 14', 'fra mauro'], a15: ['apollo 15', 'hadley'], a16: ['apollo 16', 'descartes'], a17: ['apollo 17', 'taurus'], bg1: ['blue ghost', 'firefly'], slim: ['slim', 'jaxa'], ce3: ['change 3', 'chang e 3', 'change3'], ce4: ['change 4', 'chang e 4', 'change4'], ce5: ['change 5', 'chang e 5', 'change5'], ce6: ['change 6', 'chang e 6', 'change6'] };
const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
function parseAsk(raw) {
  let q = ' ' + raw.toLowerCase().replace(/[’'`]/g, ' ').replace(/chang\s?e/g, 'change').replace(/[,;]/g, ' ') + ' ';
  const out = { ids: [], base: null, dur: null, slip: null, best: false };
  const pairs = []; for (const s of sites) for (const a of (ALIASES[s.id] || [s.name.toLowerCase().replace(/ *\(.*/, '')])) pairs.push([a, s.id]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [a, id] of pairs) { const i = q.indexOf(a); if (i >= 0 && !/[a-z0-9]/.test(q[i + a.length] || ' ') && !out.ids.includes(id)) { out.ids.push(id); q = q.slice(0, i) + ' '.repeat(a.length) + q.slice(i + a.length); } }
  if (/\b(best|safest|top|recommend|most forgiving|which site)\b/.test(q)) out.best = true;
  let m = q.match(/\b(?:slip(?:s|ped)?|delay(?:s|ed)?|postpone[d]?)\b[^0-9]{0,12}(\d+)\s*(day|week|month)?/) || q.match(/\b(\d+)[ -]*(day|week|month)s?\s*(?:slip|delay)/);
  if (m) { out.slip = +m[1] * (m[2] === 'week' ? 7 : m[2] === 'month' ? 30 : 1); q = q.replace(m[0], ' '); }
  m = q.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  let ymd = null;
  if (m) ymd = [+m[1], +m[2] - 1, +m[3]]; else {
    const mon = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
    let a = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${mon})\\b(?:\\s+(20\\d\\d))?`)), b = q.match(new RegExp(`\\b(${mon})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(20\\d\\d))?`));
    if (a) ymd = [a[3] ? +a[3] : null, MONTHS[a[2]], +a[1]]; else if (b) ymd = [b[3] ? +b[3] : null, MONTHS[b[1]], +b[2]];
    if (ymd) q = q.replace((a || b)[0], ' ');
  }
  if (ymd) { let y = ymd[0]; if (y == null) { const now = new Date(); y = now.getUTCFullYear(); if (Date.UTC(y, ymd[1], ymd[2]) < now.getTime() - DAY) y++; } out.base = Date.UTC(y, ymd[1], ymd[2]); }
  m = q.match(/\b(\d+)[ -]*(day|week|month)s?\b(?!\s*(?:slip|delay))/) || q.match(/\b(a|one)\s+(week|month)\b/);
  if (m) { const n = /^\d/.test(m[1]) ? +m[1] : 1; out.dur = n * (m[2] === 'week' ? 7 : m[2] === 'month' ? 28 : 1); }
  return out;
}
function applyAsk(p) {
  const bits = [];
  if (p.base != null && !isNaN(p.base)) { st.base = clampBase(p.base); st.slip = 0; st.cur = 0; bits.push('landing ' + fmtDate(st.base, true)); }
  if (p.dur != null && p.dur > 0) { const opts = [3, 7, 10, 14, 28, 60, 180]; st.dur = opts.reduce((a, b) => Math.abs(b - p.dur) < Math.abs(a - p.dur) ? b : a); bits.push(st.dur + '-day mission'); }
  if (p.slip != null && p.slip >= 0) { st.slip = Math.max(0, Math.min(180, Math.round(p.slip))); bits.push(st.slip + '-day slip'); }
  let ids = (p.ids || []).filter(id => site(id));
  if (p.best) {
    // rank among the sites the user named, or among all (polar) sites
    const pool = ids.length ? ids.map(site) : p.pole ? sites.filter(s => s.group === 'South Pole') : sites;
    // GO sites first, ranked by how much extra slip they absorb; if none is GO, the soonest next GO day wins.
    const scored = pool.map(s => { const C = cal(s), d = st.slip, end = Math.min(C.count, SPAN_DAYS); if (C.level[d] === 2) { let r = 0; while (d + r + 1 < end && C.level[d + r + 1] === 2) r++; return { s, k: 1e4 + r }; } let w = d + 1; while (w < end && C.level[w] !== 2) w++; return { s, k: w < end ? -(w - d) : -1e4 }; }).sort((a, b) => b.k - a.k);
    const goNow = scored.filter(x => x.k >= 1e4);
    ids = (goNow.length ? goNow : scored).slice(0, 3).map(x => x.s.id);
    bits.push(goNow.length ? `best ${p.pole ? 'south-pole ' : ''}sites for this date` : `no GO site on this date, so these are the ${p.pole ? 'south-pole ' : ''}sites closest to a GO window`);
  }
  ids = ids.slice(0, 4);
  if (ids.length) { st.sel = ids; st.focus = ids[0]; bits.unshift(ids.map(id => site(id).name.replace(/ \(.*/, '')).join(' + ')); }
  if (bits.length) { nearby = null; setTab('answer', false); update(); }
  return bits;
}
function askFacts() {
  return { landing: fmtDate(landMs()), missionDays: st.dur, slipDays: st.slip, rules: { minSunlitPct: st.rules.minSunPct, maxDarkHours: st.rules.maxDarkH, minEarthLinkPct: st.rules.minCommPct },
    sites: st.sel.map(id => { const s = site(id), m = s._m, v = s._v, sl = slipInfo(s); return { name: s.name, verdict: v.level === 'go' ? 'GO' : v.level === 'marginal' ? 'MARGINAL' : 'NO-GO', sunlitPct: Math.round(m.sunPct), earthLinkPct: Math.round(m.commPct), longestDark: fmtDur(m.maxDarkH), longestLinkOutage: fmtDur(m.maxOutageH), problems: v.fails, warnings: v.warns, ...(sl.ok ? { extraSlipDaysTolerated: sl.margin } : { daysUntilNextGoLanding: sl.next }) }; }) };
}
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let askN = 0;
async function runAsk(text) {
  const msg = $('#askMsg'), n = ++askN, key = aiMode(); msg.hidden = false;
  const show = (bits, note) => { msg.innerHTML = (bits.length ? 'Showing <b>' + bits.join(' · ') + '</b>.' : '') + (note || ''); };
  const offline = (note) => {
    const p = parseAsk(text), q = text.toLowerCase();
    const bits = applyAsk({ ids: p.ids, base: p.base, dur: p.dur, slip: p.slip, best: p.best, pole: /\b(pole|polar|south)\b/.test(q) });
    if (!bits.length) { msg.innerHTML = 'I could not find a site, date or length in that. Try <b>"Apollo 17 and IM-2 on 3 March for 10 days"</b> or <b>"best site if we slip 30 days"</b>.' + (note || ''); return false; }
    show(bits, note); return true;
  };
  if (!key) { if (offline()) $('#answer').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); return; }
  msg.innerHTML = '<span class="aiTag">AI</span> Reading your question…'; $('#askBtn').disabled = true;
  try {
    const now = new Date(), r = await aiParse(text, sites, now.toISOString().slice(0, 10));
    if (n !== askN) return;
    let base = null; const m = r.date && String(r.date).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) base = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const bits = applyAsk({ ids: r.sites || [], base, dur: r.days, slip: r.slip, best: !!r.best, pole: !!r.southPole });
    if (!bits.length) { msg.innerHTML = '<span class="aiTag">AI</span> I could not tell which site, date or mission length you mean. Try naming a site and a date.'; return; }
    show(bits, ' <span class="aiNote">Working out the answer…</span>');
    $('#answer').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    let say = null, why = '';
    try { say = await aiExplain(text, askFacts()); } catch (e) { why = String(e.message || e); }
    if (n !== askN) return;
    show(bits, say ? `<span class="aiSay"><span class="aiTag">AI</span>${esc(say)}</span><span class="aiNote">Summary written by Google Gemini from Earthset's own numbers, which are computed from NASA data.</span>` : `<span class="aiNote">Question read by Google Gemini. No AI summary this time (${esc(why.slice(0, 90))}); the verdict below is Earthset's own.</span>`);
  } catch (err) {
    if (n !== askN) return;
    offline(`<span class="aiNote">The AI assistant is unavailable (${esc(String(err.message || err).slice(0, 90))}), so the offline parser was used.</span>`);
  } finally { if (n === askN) $('#askBtn').disabled = false; syncAiUi(); }
}
$('#askForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#askIn').value.trim(); if (v) runAsk(v); });
$('#askEx').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') { $('#askIn').value = e.target.textContent; runAsk(e.target.textContent); } });

// ---------- update ----------
function update(light) {
  $('#date').value = toLocalInput(st.base); $('#dur').value = st.dur; $('#slip').value = st.slip;
  $('#slipLbl').textContent = st.slip ? `+${st.slip} days, lands ${fmtDate(landMs(), true)}` : 'none';
  if (st.cur > N() - 1) st.cur = 0;
  $('#cursor').max = N() - 1; $('#cursor').value = st.cur; rangeFill($('#cursor')); rangeFill($('#slip')); syncEnergyInputs();
  $('#rSun').value = st.rules.minSunPct; $('#rDark').value = st.rules.maxDarkH; $('#rComm').value = st.rules.minCommPct; $('#rSunL').checked = st.rules.needSunAtLanding; $('#rEarthL').checked = st.rules.needEarthAtLanding;
  if (!light) renderSites();
  renderCards(); renderAnswer(); drawPano(); renderCountdown(); drawTimeline(); drawEnergy(); drawCalendar(); drawMap();
  if (!light) { renderRescue(); drawLm(); liveLm(); writeHash(); scheduleRank();
    $('#printHead').innerHTML = `<b>Mission brief.</b> Landing ${fmtDate(landMs())}${st.slip ? ` (planned ${fmtDate(st.base, true)}, slipped ${st.slip} d)` : ''}, ${st.dur}-day mission. Rules: sunlit at least ${st.rules.minSunPct}%, darkness at most ${st.rules.maxDarkH} h, Earth link at least ${st.rules.minCommPct}%${st.rules.needSunAtLanding ? ', Sun up at touchdown' : ''}${st.rules.needEarthAtLanding ? ', Earth in view at touchdown' : ''}.<br>Reopen this scenario: ${location.href}`; }
}

async function init() {
  const [e, sj, val] = await Promise.all([loadEphemeris('data/'), fetch('data/sites.json').then(r => r.json()), fetch('data/validation.json').then(r => r.json()).catch(() => null)]);
  eph = e; sites = sj.sites.map(prepSite);
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ type: 'init', hdr: eph.h, buf: eph.c.buffer.slice(0) });
  worker.onmessage = (ev) => { const m = ev.data; if (m.type === 'status') { toast(m.text, 0); return; } const p = pending[m.req]; if (!p) return; delete pending[m.req]; $('#toast').hidden = true; m.type === 'error' ? p.rej(new Error(m.text)) : p.res(m); };
  worker.onerror = (ev) => { toast('Worker error: ' + ev.message, 5000); for (const k in pending) { pending[k].rej(new Error(ev.message)); delete pending[k]; } };
  if (val) {
    $('#valid').innerHTML = `<p><span class="vbig">${val.worst_error_deg.toFixed(5)}°</span> worst-case difference in Sun/Earth azimuth or elevation across <b>${val.total_samples.toLocaleString()}</b> comparisons (${val.rows.length / 2} sites, 2025–2038, 3-hour steps). That is ${(val.worst_error_deg * 3600).toFixed(2)} arcseconds, about 1/${Math.round(0.53 / val.worst_error_deg).toLocaleString()} of the Sun's width.</p>
      <table class="vt"><tr><th>Site</th><th>Body</th><th>n</th><th>max Δel °</th><th>max Δaz °</th></tr>${val.rows.map(r => `<tr><td>${r.site}</td><td>${r.body}</td><td>${r.samples}</td><td>${r.max_el_err_deg.toFixed(5)}</td><td>${r.max_az_err_deg.toFixed(5)}</td></tr>`).join('')}</table><p class="hint">Reproduce: <code>node tools/validate_ephem.mjs</code></p>`;
  }
  await readHash();
  relief = createRelief($('#lm3d')); rangeFill($('#lmEx'));
  if (document.fonts && document.fonts.load) await Promise.all([document.fonts.load('condensed 11px "Martian Mono"'), document.fonts.load('700 condensed 11px "Martian Mono"'), document.fonts.load('600 13px Archivo')]).catch(() => {});
  setMode(st.mode); update();
  // arriving from the landing page: ?tour=1 starts the tour, ?q=... runs a question
  const qs = new URLSearchParams(location.search);
  if (qs.get('view') && document.querySelector(`#tabs [data-tab="${qs.get('view')}"]`)) setTab(qs.get('view'), false);
  if (qs.get('tour')) setTimeout(() => showTour(0), 600);
  else if (qs.get('q')) { $('#askIn').value = qs.get('q').slice(0, 300); runAsk($('#askIn').value); }
  if (qs.has('tour') || qs.has('q') || qs.has('view')) history.replaceState(null, '', location.pathname + location.hash);
  $('#printBtn').addEventListener('click', () => window.print());
  addEventListener('keydown', (e) => {
    if (tourK >= 0 || e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input, select, textarea, button, a, #lm3d'))) return;
    if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); stopPlay(); st.cur = Math.max(0, Math.min(N() - 1, st.cur + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 24 : 1))); scrub(); }
  });
  window.addEventListener('resize', () => { clearTimeout(init.t); init.t = setTimeout(() => { drawPano(); drawTimeline(); drawEnergy(); drawCalendar(); drawLm(); drawMap(); }, 120); });
}
init().catch(err => { document.body.insertAdjacentHTML('afterbegin', `<p style="padding:20px;color:#ff5d6c">Earthset could not start: ${err.message}. If you opened the file directly, serve the folder over http (e.g. <code>python3 -m http.server</code>).</p>`); console.error(err); });
