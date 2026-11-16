// Earthset: accessibility settings, shared by the website and the planner.
// Text size, high contrast, colour-blind-safe colours, reduced motion, easier-to-read
// spacing, and reading answers aloud. Settings are remembered in this browser only.
// SI disclosure: written with the assistance of an SI coding tool (Claude).
const KEY = 'earthset.a11y';
const DEF = { size: 0, contrast: false, cb: false, motion: matchMedia('(prefers-reduced-motion: reduce)').matches, spacing: false, speak: false };
export const a11y = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { ...DEF }; } })();

function apply() {
  const h = document.documentElement;
  h.classList.toggle('a-size1', a11y.size === 1); h.classList.toggle('a-size2', a11y.size === 2);
  h.classList.toggle('a-contrast', a11y.contrast); h.classList.toggle('a-cb', a11y.cb);
  h.classList.toggle('a-motion', a11y.motion); h.classList.toggle('a-spacing', a11y.spacing);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(a11y)); } catch (e) { /* private mode: settings last for this visit */ } apply(); dispatchEvent(new CustomEvent('a11ychange')); }

// Colours for GO / MARGINAL / NO-GO that also work for red-green colour blindness.
export function levelColor(level) { return a11y.cb ? ['#7c2d12', '#facc15', '#3b82f6'][level] : ['#4a1f1a', '#e9a91c', '#2fae62'][level]; }

export function speak(text) {
  if (!('speechSynthesis' in window)) return false;
  speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ').trim()); u.rate = 1; u.lang = 'en-US'; speechSynthesis.speak(u); return true;
}

export function mountA11y(opts = {}) {
  apply();
  const btn = document.createElement('button');
  btn.className = 'a11yBtn'; btn.type = 'button'; btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'a11yPanel');
  btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="4" r="2"/><path d="M4 8l8 2 8-2M12 10v5m0 0l-3 6m3-6l3 6"/></svg><span>Accessibility</span>';
  const pan = document.createElement('div');
  pan.id = 'a11yPanel'; pan.className = 'a11yPanel'; pan.hidden = true; pan.setAttribute('role', 'dialog'); pan.setAttribute('aria-label', 'Accessibility settings');
  const row = (id, label, help) => `<label class="a11yRow"><span><b>${label}</b><small>${help}</small></span><input type="checkbox" id="${id}" role="switch"></label>`;
  pan.innerHTML = `<h2>Accessibility</h2>
    <div class="a11yRow"><span><b>Text size</b><small>Make all text bigger</small></span><div class="seg" role="group" aria-label="Text size"><button type="button" data-s="0">A</button><button type="button" data-s="1">A+</button><button type="button" data-s="2">A++</button></div></div>
    ${row('aContrast', 'High contrast', 'Darker text and stronger borders')}
    ${row('aCb', 'Colour-blind friendly', 'Blue and orange instead of green and red')}
    ${row('aMotion', 'Reduce motion', 'Turn off animations and smooth scrolling')}
    ${row('aSpacing', 'Easier reading', 'More space between letters, words and lines')}
    ${opts.speak && 'speechSynthesis' in window ? row('aSpeak', 'Read answers aloud', 'Speak each new answer when you ask a question') : ''}
    <button type="button" class="ghost a11yReset">Reset</button>`;
  document.body.append(btn, pan);
  const sync = () => {
    for (const b of pan.querySelectorAll('[data-s]')) { b.classList.toggle('on', +b.dataset.s === a11y.size); b.setAttribute('aria-pressed', String(+b.dataset.s === a11y.size)); }
    pan.querySelector('#aContrast').checked = a11y.contrast; pan.querySelector('#aCb').checked = a11y.cb; pan.querySelector('#aMotion').checked = a11y.motion; pan.querySelector('#aSpacing').checked = a11y.spacing;
    const sp = pan.querySelector('#aSpeak'); if (sp) sp.checked = a11y.speak;
  };
  sync();
  const open = (v) => { pan.hidden = !v; btn.setAttribute('aria-expanded', String(v)); if (v) pan.querySelector('button, input').focus(); };
  btn.addEventListener('click', () => open(pan.hidden));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pan.hidden) { open(false); btn.focus(); } });
  document.addEventListener('click', (e) => { if (!pan.hidden && !pan.contains(e.target) && !btn.contains(e.target)) open(false); });
  pan.addEventListener('click', (e) => {
    const s = e.target.closest('[data-s]'); if (s) { a11y.size = +s.dataset.s; save(); sync(); }
    if (e.target.classList.contains('a11yReset')) { Object.assign(a11y, DEF, { motion: matchMedia('(prefers-reduced-motion: reduce)').matches }); save(); sync(); }
  });
  for (const [id, k] of [['aContrast', 'contrast'], ['aCb', 'cb'], ['aMotion', 'motion'], ['aSpacing', 'spacing'], ['aSpeak', 'speak']]) {
    const el = pan.querySelector('#' + id); if (el) el.addEventListener('change', () => { a11y[k] = el.checked; save(); });
  }
}
