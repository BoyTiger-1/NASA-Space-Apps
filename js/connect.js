// Earthset: "Can the Moon see you?" For a city (or the visitor's own location, which
// never leaves the browser), is the Moon in their sky right now, and can a lander on
// the Shackleton ridge see Earth? If both, they are in line of sight of each other.
// Also finds the next time that happens in the coming 30 days.
import { moonElevation } from './earthside.js';
import { LIT_MIN, COMM_MIN, HOUR } from './analysis.js';

export const CITIES = [
  ['Seattle', 47.61, -122.33], ['New York', 40.71, -74.01], ['Mexico City', 19.43, -99.13], ['São Paulo', -23.55, -46.63],
  ['London', 51.51, -0.13], ['Lagos', 6.52, 3.38], ['Nairobi', -1.29, 36.82], ['Cairo', 30.04, 31.24],
  ['Mumbai', 19.08, 72.88], ['Bengaluru', 12.97, 77.59], ['Beijing', 39.90, 116.41], ['Tokyo', 35.68, 139.69], ['Sydney', -33.87, 151.21],
];

const fmt = (ms) => { const d = new Date(ms); return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

export function canSee(hero, place, t = Date.now()) {
  const moonEl = moonElevation({ lat: place.lat, lon: place.lon }, t), earth = hero.body(1, hero.clampT(t)), earthUp = earth.vis >= COMM_MIN;
  let next = null;
  if (!(moonEl > 0 && earthUp)) for (let k = 1; k <= 30 * 24 * 4; k++) { const tt = t + k * HOUR / 4; if (moonElevation({ lat: place.lat, lon: place.lon }, tt) > 5 && hero.body(1, hero.clampT(tt)).vis >= COMM_MIN) { next = tt; break; } }
  return { moonEl, earthUp, both: moonEl > 0 && earthUp, next };
}

export function mountConnect(hero) {
  const box = document.querySelector('#seeYou'); if (!box) return;
  const sel = box.querySelector('select'), out = box.querySelector('.syOut'), geo = box.querySelector('.syGeo');
  sel.innerHTML = CITIES.map(([n], i) => `<option value="${i}">${n}</option>`).join('');
  const run = (place) => {
    const r = canSee(hero, place);
    out.innerHTML = r.both
      ? `<b>Yes, right now.</b> The Moon is ${r.moonEl.toFixed(0)}° up in ${place.name}'s sky, and from the Shackleton ridge Earth is above the hills. A lander there and you are in each other's line of sight.`
      : `<b>Not right now.</b> ${r.moonEl > 0 ? `The Moon is up in ${place.name} (${r.moonEl.toFixed(0)}°), but from the ridge Earth is hidden behind the hills.` : `The Moon is below ${place.name}'s horizon${r.earthUp ? ', even though the ridge can see Earth' : ', and from the ridge Earth is hidden behind the hills too'}.`} ${r.next ? `Next chance: <b>${fmt(r.next)}</b> (your time).` : 'No chance in the next 30 days.'}`;
  };
  sel.addEventListener('change', () => { const [name, lat, lon] = CITIES[+sel.value]; run({ name, lat, lon }); });
  if (geo) geo.addEventListener('click', () => {
    if (!navigator.geolocation) { out.textContent = 'Your browser does not share location. Pick a city instead.'; return; }
    out.textContent = 'Finding you (this stays on your device)…';
    navigator.geolocation.getCurrentPosition((p) => run({ name: 'your location', lat: p.coords.latitude, lon: p.coords.longitude }), () => { out.textContent = 'Location was not shared. Pick a city instead.'; }, { timeout: 8000, maximumAge: 600000 });
  });
  run({ name: CITIES[0][0], lat: CITIES[0][1], lon: CITIES[0][2] });
}
