// Curated landing sites. Coordinates: planetocentric lat, east-positive lon (deg), MOON_ME.
// `src` records where each coordinate came from; `approx` marks illustrative points.
// SI disclosure: compiled with the assistance of an SI coding tool (Claude); sources listed per entry.
export const SITES = [
  // --- South pole: future / candidate ---
  { id: 'ridge', name: 'Shackleton–de Gerlache Connecting Ridge', group: 'South Pole', lat: -89.4519, lon: -137.123, note: 'Best-lit point Earthset found within 800 m of the highly illuminated site reported by Mazarico et al. 2011 (89.45°S 222.69°E). Moving just 80 m changes long-term sunlight from ~64% to ~86%.', src: 'Mazarico et al. 2011, Icarus 211' },
  { id: 'malapert', name: 'Malapert Massif (summit area)', group: 'South Pole', lat: -85.99, lon: 2.93, approx: true, note: 'Illustrative point inside the Artemis III "Malapert Massif" candidate region; NASA has not published site coordinates.', src: 'LOLA topography (summit), region name from NASA Artemis III candidate regions (Oct 2024)' },
  { id: 'mouton', name: 'Mons Mouton', group: 'South Pole', lat: -84.6, lon: 31.0, approx: true, note: 'IAU feature coordinates; Artemis III candidate regions "Mons Mouton" and "Mons Mouton Plateau" lie on this mountain.', src: 'IAU Gazetteer of Planetary Nomenclature' },
  { id: 'im2', name: 'IM-2 Athena (CLPS, 2025)', group: 'South Pole', lat: -84.7906, lon: 29.1957, note: 'Intuitive Machines IM-2, landed 6 Mar 2025 on Mons Mouton; came to rest on its side in a shadowed crater.', src: 'LROC / mission reports' },
  { id: 'im1', name: 'IM-1 Odysseus (CLPS, 2024)', group: 'South Pole', lat: -80.13, lon: 1.44, note: 'Intuitive Machines IM-1, landed 22 Feb 2024 near Malapert A.', src: 'NASA NSSDCA' },
  { id: 'shack', name: 'Shackleton Crater floor (PSR)', group: 'South Pole', lat: -89.67, lon: 129.78, note: 'Permanently shadowed region: the Sun never clears the rim. Included as a contrast case.', src: 'IAU Gazetteer (crater centre)' },
  { id: 'cy3', name: 'Chandrayaan-3 Vikram (ISRO, 2023)', group: 'South Pole', lat: -69.373, lon: 32.319, note: 'ISRO Chandrayaan-3, landed 23 Aug 2023 ("Shiv Shakti Point").', src: 'ISRO' },
  // --- Apollo ---
  { id: 'a11', name: 'Apollo 11 — Tranquility Base', group: 'Apollo', lat: 0.67416, lon: 23.47314, src: 'NASA NSSDCA / LROC' },
  { id: 'a12', name: 'Apollo 12', group: 'Apollo', lat: -3.0128, lon: -23.4219, src: 'NASA NSSDCA / LROC' },
  { id: 'a14', name: 'Apollo 14 — Fra Mauro', group: 'Apollo', lat: -3.64589, lon: -17.47194, src: 'NASA NSSDCA / LROC' },
  { id: 'a15', name: 'Apollo 15 — Hadley Rille', group: 'Apollo', lat: 26.13239, lon: 3.6333, src: 'NASA NSSDCA / LROC' },
  { id: 'a16', name: 'Apollo 16 — Descartes', group: 'Apollo', lat: -8.9734, lon: 15.5011, src: 'NASA NSSDCA / LROC' },
  { id: 'a17', name: 'Apollo 17 — Taurus–Littrow', group: 'Apollo', lat: 20.1911, lon: 30.7723, src: 'NASA NSSDCA / LROC' },
  // --- Commercial & international ---
  { id: 'bg1', name: 'Blue Ghost M1 (CLPS, 2025)', group: 'Commercial & International', lat: 18.56, lon: 61.81, note: 'Firefly Blue Ghost Mission 1, Mare Crisium, landed 2 Mar 2025 (target coordinates).', src: 'Firefly / NASA (landing target)' },
  { id: 'slim', name: 'SLIM (JAXA, 2024)', group: 'Commercial & International', lat: -13.316, lon: 25.251, note: 'JAXA Smart Lander for Investigating Moon, near Shioli crater.', src: 'JAXA' },
  { id: 'ce3', name: "Chang'e 3 (CNSA, 2013)", group: 'Commercial & International', lat: 44.1214, lon: -19.5116, src: 'NASA NSSDCA / LROC' },
  { id: 'ce4', name: "Chang'e 4 (CNSA, 2019) — far side", group: 'Commercial & International', lat: -45.4446, lon: 177.5991, note: 'Far side: Earth never rises here, so direct-to-Earth communication is impossible.', src: 'NASA NSSDCA / LROC' },
  { id: 'ce5', name: "Chang'e 5 (CNSA, 2020)", group: 'Commercial & International', lat: 43.0576, lon: -51.9161, src: 'NASA NSSDCA / LROC' },
  { id: 'ce6', name: "Chang'e 6 (CNSA, 2024) — far side", group: 'Commercial & International', lat: -41.6385, lon: -153.9852, note: 'Far side sample return, Apollo basin.', src: 'NASA LRO team' },
];
