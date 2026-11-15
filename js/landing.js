// Earthset: landing page. Draws the live sky in the hero; everything else is static.
// SI disclosure: written with the assistance of an SI coding tool (Claude).
import { loadEphemeris } from './ephem.js';
import { startHero, prepSite } from './hero.js';

document.querySelector('#landAsk').addEventListener('submit', (e) => {
  const v = e.target.q.value.trim(); if (!v) { e.preventDefault(); location.href = 'app.html'; }
});

(async () => {
  try {
    const [eph, sj] = await Promise.all([loadEphemeris('data/'), fetch('data/sites.json').then(r => r.json())]);
    const src = sj.sites.find(s => s.id === 'ridge') || sj.sites[0];
    startHero(eph, prepSite(src));
  } catch (err) { console.error(err); document.querySelector('#live').hidden = true; }
})();
