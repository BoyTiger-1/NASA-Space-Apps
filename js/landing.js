// Earthset: landing page. Draws the live sky in the hero; everything else is static.
// SI disclosure: written with the assistance of an SI coding tool (Claude).
import { loadEphemeris } from './ephem.js';
import { startHero, prepSite } from './hero.js';
import { liveCheck, liveCheckHtml } from './livecheck.js';
import { mountA11y } from './a11y.js';
import { mountConnect } from './connect.js';

mountA11y();

document.querySelector('#landAsk').addEventListener('submit', (e) => {
  const v = e.target.q.value.trim(); if (!v) { e.preventDefault(); location.href = 'app.html'; }
});

(async () => {
  try {
    const [eph, sj] = await Promise.all([loadEphemeris('data/'), fetch('data/sites.json').then(r => r.json())]);
    const src = sj.sites.find(s => s.id === 'ridge') || sj.sites[0];
    const hero = startHero(eph, prepSite(src));
    mountConnect(hero);
    const btn = document.querySelector('#lcBtn'), out = document.querySelector('#lcOut');
    btn.addEventListener('click', async () => {
      btn.disabled = true; out.hidden = false; out.textContent = 'Asking NASA/JPL Horizons where the Sun and Earth are right now…';
      try { out.innerHTML = liveCheckHtml(await liveCheck(eph, src), 'the Shackleton ridge'); }
      catch (e) { out.textContent = e.message; } finally { btn.disabled = false; }
    });
  } catch (err) { console.error(err); document.querySelector('#live').hidden = true; }
})();
