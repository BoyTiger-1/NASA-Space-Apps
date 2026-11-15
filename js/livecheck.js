// Earthset: "check it live" against NASA/JPL Horizons. Asks Horizons (through the
// /api/horizons function) where the Sun and Earth are right now from a lunar site,
// computes the same thing with Earthset's own ephemeris, and shows the difference.
// SI disclosure: written with the assistance of an SI coding tool (Claude).
import { makeSite, azel } from './ephem.js';

const pad = (n) => String(n).padStart(2, '0');
const fmtAs = (deg) => { const a = deg * 3600; return a < 1 ? a.toFixed(2) + '″' : a < 60 ? a.toFixed(1) + '″' : (deg).toFixed(4) + '°'; };

export async function liveCheck(eph, s) {
  let now = new Date(Math.floor(Date.now() / 60000) * 60000); if (now.getUTCMinutes() === 59) now = new Date(now.getTime() - 60000);
  const t = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  const r = await fetch(`api/horizons?lat=${s.lat}&lon=${s.lon}&t=${encodeURIComponent(t)}`);
  if (r.status === 404) throw new Error('The live check runs on the hosted version of Earthset.');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'NASA/JPL Horizons did not answer, try again');
  const site = makeSite(s.lat, s.lon, 0), rows = [];
  for (const [b, ref, name] of [[0, j.sun, 'Sun'], [1, j.earth, 'Earth']]) {
    const o = azel(eph, b, ref.ms, site);
    let dAz = Math.abs(o.az - ref.az); if (dAz > 180) dAz = 360 - dAz; dAz *= Math.cos(ref.el * Math.PI / 180);
    rows.push({ name, ours: o, nasa: ref, diff: Math.max(dAz, Math.abs(o.el - ref.el)) });
  }
  return { t, rows };
}

export function liveCheckHtml(res, siteName) {
  const worst = Math.max(...res.rows.map(r => r.diff));
  return `<p class="lcHead">${res.t} UTC, from ${siteName}. Biggest difference: <b>${fmtAs(worst)}</b>.</p>
  <table class="lcT"><tr><th></th><th>Earthset</th><th>NASA/JPL Horizons</th><th>Difference</th></tr>${res.rows.map(r => `<tr><td>${r.name}</td><td>az ${r.ours.az.toFixed(4)}°, el ${r.ours.el.toFixed(4)}°</td><td>az ${r.nasa.az.toFixed(4)}°, el ${r.nasa.el.toFixed(4)}°</td><td>${fmtAs(r.diff)}</td></tr>`).join('')}</table>`;
}
