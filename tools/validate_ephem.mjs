// Validates js/ephem.js against the NASA/JPL Horizons API (the challenge's
// reference tool). Writes data/validation.json, which the app displays.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ephemeris, makeSite, azel } from '../js/ephem.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hdr = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ephem.json')));
const buf = fs.readFileSync(path.join(ROOT, 'data/ephem.bin'));
const eph = new Ephemeris(hdr, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const sites = [
  ['Shackleton connecting ridge', -89.45, -137.31, 0],
  ['Mons Mouton (IM-2 region)', -84.79, 29.2, 0],
  ['Malapert A (IM-1)', -80.13, 1.44, 0],
  ['Apollo 11', 0.67416, 23.47314, 0],
  ['Apollo 17', 20.1911, 30.7723, 0],
  ['Chang\'e 4 (far side)', -45.4446, 177.5991, 0],
  ['Lunar north pole region', 89.0, 90.0, 0],
];
const spans = [['2025-01-01', '2025-03-01'], ['2027-06-01', '2027-08-01'], ['2031-01-01', '2031-03-01'], ['2038-10-01', '2038-12-01']];
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

async function horizons(body, lat, lon, h, a, b) {
  const p = new URLSearchParams({
    format: 'text', COMMAND: `'${body}'`, EPHEM_TYPE: "'OBSERVER'", CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'", SITE_COORD: `'${lon},${lat},${h}'`, START_TIME: `'${a}'`, STOP_TIME: `'${b}'`,
    STEP_SIZE: "'3 h'", QUANTITIES: "'4'", ANG_FORMAT: "'DEG'", CSV_FORMAT: "'YES'", APPARENT: "'AIRLESS'",
  });
  for (let k = 0; k < 4; k++) {
    try {
      const t = await (await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + p)).text();
      const m = t.match(/\$\$SOE([\s\S]*?)\$\$EOE/);
      if (!m) throw new Error(t.slice(0, 300));
      return m[1].trim().split('\n').map(l => {
        const f = l.split(',').map(s => s.trim());
        const d = f[0].match(/(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);
        return { ms: Date.UTC(+d[1], MON[d[2]], +d[3], +d[4], +d[5]), az: +f[3], el: +f[4] };
      });
    } catch (e) { if (k === 3) throw e; await new Promise(r => setTimeout(r, 1500)); }
  }
}

const rows = [];
let worst = 0, n = 0;
for (const [name, lat, lon, h] of sites) {
  for (const [bi, id, bname] of [[0, '10', 'Sun'], [1, '399', 'Earth']]) {
    let mEl = 0, mAz = 0, sEl = 0, cnt = 0;
    const site = makeSite(lat, lon, h);
    for (const [a, b] of spans) {
      const ref = await horizons(id, lat, lon, h, a, b);
      for (const r of ref) {
        const o = azel(eph, bi, r.ms, site);
        const dEl = Math.abs(o.el - r.el);
        let dAz = Math.abs(o.az - r.az); if (dAz > 180) dAz = 360 - dAz;
        dAz *= Math.cos(r.el * Math.PI / 180);          // on-sky azimuth difference
        mEl = Math.max(mEl, dEl); mAz = Math.max(mAz, dAz); sEl += dEl * dEl; cnt++;
      }
    }
    worst = Math.max(worst, mEl, mAz); n += cnt;
    rows.push({ site: name, lat, lon, body: bname, samples: cnt, max_el_err_deg: +mEl.toFixed(5), max_az_err_deg: +mAz.toFixed(5), rms_el_err_deg: +Math.sqrt(sEl / cnt).toFixed(5) });
    console.log(rows[rows.length - 1]);
  }
}
const out = { reference: 'NASA/JPL Horizons API (ssd.jpl.nasa.gov), airless apparent az/el, 3-hour steps', spans, total_samples: n, worst_error_deg: +worst.toFixed(5), generated_utc: new Date().toISOString(), rows };
fs.writeFileSync(path.join(ROOT, 'data/validation.json'), JSON.stringify(out, null, 1));
console.log('worst', worst, 'samples', n);
