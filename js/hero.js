// Earthset: the live sky at the top of the landing page. The Sun and Earth over the
// real LOLA skyline of a south-pole ridge, right now; drag to move through time.
import { makeSite, azel, R_SUN, R_EARTH } from './ephem.js';
import { horizonAt, discVisible } from './terrain.js';
import { fmtDur, HOUR, DAY, LIT_MIN, COMM_MIN } from './analysis.js';

const $ = (q) => document.querySelector(q);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

export function prepSite(s) {
  s.hzo = { el: s.hzo ? s.hzo.el : Float32Array.from(s.hz, v => v / 100), ground: s.ground, mast: s.mast };
  s.geom = makeSite(s.lat, s.lon, (s.ground + s.mast) / 1000);
  return s;
}

export function startHero(eph, src) {
  const cv = $('#heroCv'), hero = $('#heroWin'), hz = src.hzo, o = {};
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 220 }, () => ({ x: rnd(), y: rnd() * 0.72, a: 0.2 + rnd() * 0.6, r: rnd() < 0.12 ? 2 : 1 }));
  let off = 0, drag = null, G = null;
  const clampT = (t) => Math.max(eph.msMin + DAY, Math.min(eph.msMax - 240 * DAY, t));
  const body = (b, t) => { azel(eph, b, t, src.geom, o); const rad = Math.asin((b ? R_EARTH : R_SUN) / o.dist) * R2D; return { az: o.az, el: o.el, rad, vis: discVisible(hz, o.az, o.el, rad) }; };
  const compute = (t) => {
    const sun = body(0, t), ear = body(1, t), up = sun.vis >= LIT_MIN, path = []; let ev = null;
    for (let k = 1; k <= 24 * 200 && (ev == null || k <= 24 * 30); k++) {
      azel(eph, 0, t + k * HOUR, src.geom, o);
      if (k <= 24 * 30 && k % 3 === 0) path.push(o.az, o.el);
      if (ev == null && (discVisible(hz, o.az, o.el, sun.rad) >= LIT_MIN) !== up) ev = k;
    }
    return { t, sun, ear, up, ev, path };
  };
  const sgn = (v) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2);
  $('#liveSite').textContent = `${Math.abs(src.lat).toFixed(2)}°${src.lat < 0 ? 'S' : 'N'} ${Math.abs(src.lon).toFixed(2)}°${src.lon < 0 ? 'W' : 'E'}`;
  const draw = () => {
    const t = clampT(Date.now() + off); if (!G || Math.abs(G.t - t) > 30e3) G = compute(t);
    const dpr = Math.min(2, devicePixelRatio || 1), w = hero.clientWidth, h = hero.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const base = h - 150, sc = 30, X = (az) => az / 360 * w, Y = (el) => base - el * sc;
    c.fillStyle = '#0b0b0a'; c.fillRect(0, 0, w, h);
    for (const s of stars) { c.fillStyle = `rgba(233,230,220,${s.a})`; c.fillRect(Math.round(s.x * w), Math.round(s.y * h), s.r, s.r); }
    c.font = 'condensed 11px "Martian Mono",monospace'; c.textAlign = 'right';
    for (const e of [0, 2, 4, 6]) { const y = Math.round(Y(e)); c.fillStyle = e ? '#ffffff16' : '#ffffff40'; c.fillRect(0, y, w, 1); c.fillStyle = '#aaa69a'; c.fillText((e ? '+' : '') + e + '°', w - 10, y - 4); }
    // where the Sun will go over the next 30 days
    c.fillStyle = '#ffc857'; for (let k = 0; k < G.path.length; k += 2) c.fillRect(X(G.path[k]) - 1, Y(G.path[k + 1]) - 1, 2, 2);
    const sx = X(G.sun.az), sy = Y(G.sun.el), sr = Math.max(5, G.sun.rad * sc);
    const gl = c.createRadialGradient(sx, sy, sr, sx, sy, sr * 9); gl.addColorStop(0, '#ffc85770'); gl.addColorStop(1, '#ffc85700'); c.fillStyle = gl; c.beginPath(); c.arc(sx, sy, sr * 9, 0, 7); c.fill();
    c.fillStyle = '#fff3cf'; c.beginPath(); c.arc(sx, sy, sr, 0, 7); c.fill();
    // Earth, with the phase it shows from the Moon
    const ex = X(G.ear.az), ey = Y(G.ear.el), er = Math.max(9, G.ear.rad * sc);
    const dAz = (G.sun.az - G.ear.az + 540) % 360 - 180, dEl = G.sun.el - G.ear.el;
    const lit = (1 - (Math.sin(G.sun.el * D2R) * Math.sin(G.ear.el * D2R) + Math.cos(G.sun.el * D2R) * Math.cos(G.ear.el * D2R) * Math.cos(dAz * D2R))) / 2;
    c.fillStyle = '#10233f'; c.beginPath(); c.arc(ex, ey, er, 0, 7); c.fill();
    c.save(); c.translate(ex, ey); c.rotate(Math.atan2(-dEl, dAz)); c.fillStyle = '#58a6ff'; c.beginPath(); c.arc(0, 0, er, -Math.PI / 2, Math.PI / 2, false); c.ellipse(0, 0, Math.max(0.01, er * Math.abs(1 - 2 * lit)), er, 0, Math.PI / 2, -Math.PI / 2, lit < 0.5); c.fill(); c.restore();
    // terrain skyline
    c.beginPath(); c.moveTo(0, h); for (let x = 0; x <= w; x += 2) c.lineTo(x, Y(horizonAt(hz, x / w * 360))); c.lineTo(w, h); c.closePath();
    const tg = c.createLinearGradient(0, base - 3 * sc, 0, h), b = G.up ? 1 : 0.45; tg.addColorStop(0, `rgb(${150 * b | 0},${147 * b | 0},${138 * b | 0})`); tg.addColorStop(1, '#1c1b19'); c.fillStyle = tg; c.fill();
    c.strokeStyle = G.up ? '#efece4' : '#6b6962'; c.lineWidth = 1.25; c.beginPath(); for (let x = 0; x <= w; x += 2) { const y = Y(horizonAt(hz, x / w * 360)); x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
    c.setLineDash([3, 3]); c.lineWidth = 1;
    if (!G.up) { c.strokeStyle = '#ffc857'; c.beginPath(); c.arc(sx, sy, sr + 3, 0, 7); c.stroke(); }
    const earthUp = G.ear.vis >= COMM_MIN; if (!earthUp) { c.strokeStyle = '#58a6ff'; c.beginPath(); c.arc(ex, ey, er, 0, 7); c.stroke(); }
    c.setLineDash([]);
    c.font = '600 13px Archivo,sans-serif';
    const label = (txt, x, y, r, az, col) => { const right = x > w - 200, ly = Math.min(y - r - 6, ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(q => Y(horizonAt(hz, az + (right ? -1 : 1) * q * 5)) - 10)); c.textAlign = right ? 'right' : 'left'; c.fillStyle = col; c.fillText(txt, x + (right ? -r - 8 : r + 8), ly); };
    label(G.up ? 'Sun' : 'Sun, behind terrain', sx, sy, sr, G.sun.az, '#ffc857'); label(earthUp ? 'Earth' : 'Earth, behind terrain', ex, ey, er, G.ear.az, '#8cc4ff');
    c.fillStyle = '#0b0b0a'; c.fillRect(0, h - 46, w, 46); c.fillStyle = '#ffffff40'; c.fillRect(0, h - 46, w, 1);
    c.font = 'condensed 11px "Martian Mono",monospace'; c.fillStyle = '#aaa69a'; c.textAlign = 'center';
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']; for (let a = 0; a <= 8; a++) c.fillText(names[a], Math.max(12, Math.min(w - 12, X(a * 45))), h - 30);
    c.textAlign = 'left'; c.font = '12px Archivo,sans-serif'; const stretch = (sc / (w / 360)).toFixed(0);
    c.fillText(w < 720 ? `LOLA skyline. Elevation stretched ${stretch}×.` : `Skyline at ${src.name}, from NASA LRO LOLA. Yellow dots: the Sun over the next 30 days. Elevation stretched ${stretch}× relative to azimuth.`, Math.max(12, parseFloat(getComputedStyle(hero).paddingLeft)), h - 10);
    const d = new Date(t);
    $('#liveClock').textContent = `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
    $('#liveMode').textContent = off ? `${off > 0 ? '+' : '−'}${fmtDur(Math.abs(off) / HOUR)}` : 'Live'; $('#liveReset').hidden = !off;
    $('#liveSun').textContent = `${sgn(G.sun.el)}° el, ${(G.sun.vis * 100).toFixed(0)}% clear`;
    $('#liveEarth').textContent = `${sgn(G.ear.el)}° el, ${G.ear.vis >= COMM_MIN ? 'in view' : 'hidden'}`;
    $('#liveEvL').textContent = G.up ? 'Sunset in' : 'Sunrise in'; $('#liveEv').textContent = G.ev == null ? 'over 200 d' : fmtDur(G.ev);
  };
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, off }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; off = drag.off + (e.clientX - drag.x) * 20 * 60e3; draw(); });
  const end = () => { drag = null; }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  $('#liveReset').addEventListener('click', () => { off = 0; draw(); });
  addEventListener('resize', draw);
  setInterval(() => { if (!document.hidden && !drag && !anim) draw(); }, 1000);

  // ---- "Watch a lunar month": a 30-day time-lapse with captions from real events ----
  let anim = null;
  const cap = $('#heroCap'), playBtn = $('#heroPlay');
  const events = () => {
    const t0 = Date.now(), out = []; let ps = null, pe = null;
    for (let k = 0; k <= 30 * 24; k++) {
      const t = clampT(t0 + k * HOUR), sv = body(0, t).vis >= LIT_MIN, ev = body(1, t).vis >= COMM_MIN;
      if (ps !== null && sv !== ps) out.push({ k, kind: sv ? 'sunrise' : 'sunset' });
      if (pe !== null && ev !== pe) out.push({ k, kind: ev ? 'earthrise' : 'earthset' });
      ps = sv; pe = ev;
    }
    return out;
  };
  const SAY = { sunrise: 'The Sun clears the hills again. Power is back.', sunset: 'The Sun slips behind the terrain. From here the lander runs on batteries.', earthrise: 'Earth rises over the ridge. The radio link home is back.', earthset: 'Earth sets behind the hills. No direct radio link until it comes back.' };
  const show = (txt) => { if (!cap) return; cap.hidden = false; cap.innerHTML = txt; };
  const stop = (msg) => { if (anim) cancelAnimationFrame(anim.raf); anim = null; if (playBtn) { playBtn.textContent = 'Watch the next 30 days'; playBtn.setAttribute('aria-pressed', 'false'); } if (msg) show(msg); };
  if (playBtn) playBtn.addEventListener('click', () => {
    if (anim) { stop(); return; }
    const evs = events(), start = performance.now(), dur = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('a-motion') ? 12000 : 36000; let next = 0;
    const first = G || compute(clampT(Date.now()));
    show(`<b>Day 0, now.</b> The Sun is ${first.sun.el.toFixed(1)}° above the horizon${first.up ? ' and lighting the ridge' : ', hidden behind the hills'}. Earth is ${first.ear.vis >= COMM_MIN ? 'in view' : 'hidden'}. Watch the next 30 days.`);
    playBtn.textContent = 'Pause'; playBtn.setAttribute('aria-pressed', 'true');
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur), h = p * 30 * 24; off = h * HOUR; draw();
      while (next < evs.length && evs[next].k <= h) { const e = evs[next++]; show(`<b>Day ${Math.floor(e.k / 24)}.</b> ${SAY[e.kind]}`); }
      if (p < 1) anim.raf = requestAnimationFrame(step);
      else stop(evs.length ? `<b>Day 30.</b> ${evs.length} changes in a month, all from real NASA terrain and ephemeris. A few hundred metres away the story is different, which is what Earthset is for.` : '<b>Day 30.</b> The Sun circled the horizon all month and never set here. That is why this ridge is a top candidate for a Moon base.');
    };
    anim = { raf: requestAnimationFrame(step) };
  });
  cv.addEventListener('pointerdown', () => { if (anim) stop(); });
  $('#liveReset').addEventListener('click', () => { stop(); if (cap) cap.hidden = true; });
  draw();
  return { body, clampT };
}
