// Earthset: Vercel function that asks NASA/JPL Horizons where the Sun and Earth are,
// as seen from a point on the Moon at a given minute. The browser then compares the
// answer with Earthset's own calculation, live. (Horizons does not allow direct
// browser requests, so this small proxy is needed.) No key or secret involved.
// SI disclosure: written with the assistance of an SI coding tool (Claude).
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

async function ask(body, lat, lon, t) {
  const p = new URLSearchParams({
    format: 'json', COMMAND: `'${body}'`, EPHEM_TYPE: "'OBSERVER'", CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${lon},${lat},0'`, START_TIME: `'${t}'`, STOP_TIME: `'${t.slice(0, 11)}${t.slice(11, 13)}:${String(+t.slice(14, 16) + 1).padStart(2, '0')}'`,
    STEP_SIZE: "'1 m'", QUANTITIES: "'4'", ANG_FORMAT: "'DEG'", CSV_FORMAT: "'YES'", APPARENT: "'AIRLESS'",
  });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + p, { signal: ctl.signal });
    const j = await r.json();
    const m = String(j.result || '').match(/\$\$SOE\s*([\s\S]*?)\$\$EOE/);
    if (!m) throw new Error('Horizons did not return data');
    const f = m[1].trim().split('\n')[0].split(',').map(s => s.trim());
    const d = f[0].match(/(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);
    return { ms: Date.UTC(+d[1], MON[d[2]], +d[3], +d[4], +d[5]), az: +f[3], el: +f[4] };
  } finally { clearTimeout(timer); }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const lat = Number(q.lat), lon = Number(q.lon), t = String(q.t || '');
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 360) || !/^\d{4}-\d{2}-\d{2} \d{2}:[0-5]\d$/.test(t) || t.slice(14, 16) === '59') {
    res.status(400).json({ error: 'bad request' }); return;
  }
  try {
    const [sun, earth] = await Promise.all([ask('10', lat, lon, t), ask('399', lat, lon, t)]);
    res.status(200).json({ source: 'NASA/JPL Horizons API (ssd.jpl.nasa.gov), airless apparent azimuth/elevation', lat, lon, sun, earth });
  } catch (e) {
    res.status(502).json({ error: 'NASA/JPL Horizons did not answer, try again' });
  }
}
