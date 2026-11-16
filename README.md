# Earthset: Lunar Landing Window Navigator

**2026 NASA Space Apps Challenge · Universal Event · Challenge: Lunar Landing Site Navigator**

Earthset answers one question fast: *if we land here, on this day, will the lander have sunlight and a
direct line to Earth, and what do we do if the launch slips?*

It shows the Sun and Earth over the **real terrain horizon** at any lunar landing site, compares up to four
sites side by side, turns two years of geometry into a GO / NO-GO **landing-window calendar**, and when a
schedule slip breaks the plan it searches for a later date, a better site, or a better spot a few hundred
metres away. It also casts **real shadows across the terrain** around a site (live, as the mission plays, or
averaged over the mission, flat or as a **3D relief** you can orbit), runs a simple **battery survival model**
on the actual lighting, and has a **60-second guided tour**.

It also opens on a **live view**: the real skyline of the Shackleton-de Gerlache ridge with the Sun and Earth where
they are this minute (drag it to move through time). A **site ranking** runs the landing-window calendar for every
site and sorts them by how much launch slip they can absorb, each verdict card shows its **slip margin** in days,
the timeline shows which **Deep Space Network complexes** have the Moon in their sky, and **Print brief** turns the
current scenario into a PDF.

The site has two pages: **`index.html`** is the website (what it is, why it matters, how it works, the data)
and **`app.html`** is the planner itself. All the numbers are computed in the browser from NASA data; no
login is needed. The only server piece is optional: an AI helper for the Ask bar (see below).

## NASA Space Apps Challenge submission

**Project:** Earthset: Lunar Landing Window Navigator
**Challenge:** 2026 NASA Space Apps Challenge, Lunar Landing Site Navigator
**Website:** https://boytiger-1.github.io/NASA-Space-Apps/
**Project demo:** https://drive.google.com/file/d/1Wi_oaRwbbQ3BdMiC5q5s_HzA9GgTKL9V/view?usp=sharing
**Source code:** https://github.com/BoyTiger-1/NASA-Space-Apps

Earthset helps mission planners, students and the public see whether a lunar lander will have sunlight and
a direct radio link to Earth at a given site and date, and what options remain when a launch slips. At the
Moon's south pole, the Sun stays close to the horizon, so small changes in terrain can make a large difference.

### Project capabilities

- Compare up to four Apollo, CLPS, international and south-pole candidate sites, or choose a custom location
  from the map or by entering coordinates.
- Explore a 360° terrain-horizon sky view, the Sun and Earth's paths, true-scale views of the Sun and Earth,
  and countdowns to sunrise, sunset, Earthrise and Earthset.
- Review sunlight, Earth-link time, longest darkness and link outage, and adjustable GO / MARGINAL / NO-GO
  rules; animate the mission and inspect hourly conditions.
- Compare launch dates with the landing-window calendar, rank sites by available GO days and view each plan's
  launch-slip margin.
- Recover from a broken plan by searching for the next GO date, ranking alternative sites and testing 121 nearby
  LOLA-grid locations.
- Explore terrain shadows live or averaged over a mission, view Earth visibility, and select map pixels as sites;
  optionally orbit the terrain in 3D.
- Estimate battery survival using configurable solar-array, load and battery values.
- Find candidate long-stay base-camp areas with sunlight, Earth visibility, gentle slopes and proximity to
  permanently shadowed ground.
- Plan a rover route that maximizes sunlight while avoiding steep slopes, and compare it with remaining parked.
- Use the live Shackleton–de Gerlache ridge view, play a 30-day lunar-month time-lapse, or check whether a
  selected city and the ridge can see the Moon/Earth at the same time.
- Re-run recent mission scenarios, inspect eclipses, and check current Sun/Earth positions live against
  NASA/JPL Horizons.
- Ask questions in plain English, download mission calendars, export CSV data, share scenarios, save a PNG
  mission card or print a PDF brief.
- Use Explorer or Planner mode, a guided tour, and accessibility settings including text scaling, high contrast,
  reduced motion, read-aloud answers, keyboard navigation and chart descriptions.
- Open the free teacher page with three printable activities for grades 6–12, answer keys and NGSS connections.

## What makes the numbers trustworthy

| Check | Result |
|---|---|
| Sun/Earth azimuth & elevation vs **NASA/JPL Horizons** (7 sites, 2025–2038, 26,936 samples) | worst difference **0.00003°** (0.1 arcsecond) |
| Chebyshev compression of DE440 | < 0.02 arcsecond |
| Polar LOLA grids vs independent global LOLA grid (projection check) | no bias, 14–20 m RMS |
| Blue Ghost Mission 1, 14 Mar 2025 eclipse: end of totality | Earthset 08:34 UTC; lander photographed the "diamond ring" ≈ 08:30 UTC |
| Blue Ghost Mission 1, lunar sunset 16 Mar 2025 | Earthset 20:23 UTC; Firefly's reports imply ≈ 18:15 UTC (≈ 2 h, about 1° of Sun elevation) |

| Automated test suite (`node tools/test.mjs`, no network needed) | 28 of 28 checks pass |

Reproduce: `node tools/test.mjs`, `node tools/validate_ephem.mjs`, `node tools/check_terrain.mjs`, `node tools/check_events.mjs`.

## Ask in plain English

Type a scenario such as "Apollo 17 and IM-2 on 3 March for 10 days" or "best south pole site if we slip
30 days". Earthset sets the sites, date, mission length and slip, then shows the verdict. It works offline;
an optional Gemini key lets it read looser questions and add a short spoken-style summary.

## How it works

1. **Ephemeris**: `tools/build_ephem.py` uses NASA/JPL SPICE kernels (DE440, lunar orientation `moon_pa_de440`,
   Mean-Earth frame) to get apparent Sun and Earth positions from the Moon, and fits Chebyshev polynomials
   (`data/ephem.bin`, 490 kB, 2024–2039). `js/ephem.js` evaluates them and converts to azimuth/elevation at a site.
2. **Terrain horizon**: `js/terrain.js` ray-marches NASA LRO **LOLA** elevation grids out to 450 km in 720
   directions, with lunar curvature, from 2 m above the surface. Curated sites are precomputed from
   full-resolution grids (20–474 m) by `tools/build_sites.mjs`; custom sites are computed live in a Web Worker
   from reduced grids (120 m inside 85°S).
3. **Visibility**: the Sun is a 0.53° disc: we integrate the part above the terrain and subtract the part
   covered by Earth during eclipses. Earth is "in view" when its centre clears the terrain.
4. **Windows**: `js/analysis.js` scores hourly geometry against adjustable mission rules (minimum sunlit time,
   longest survivable darkness, minimum Earth-link time, Sun/Earth at touchdown).
5. **Shadow map**: `lightMap` in `js/terrain.js` marches from every pixel of a grid around the site toward the
   Sun and toward Earth, using each pixel's own local vertical, to find what is lit and what has a link.
6. **Battery model**: `simulateEnergy` in `js/analysis.js`: array output scales with the visible fraction of the
   Sun; the lander sleeps when the Sun is hidden. Deliberately simple, with example values the user can change.
7. **Ground stations**: `js/earthside.js` finds when the Moon is more than 10° above Goldstone, Madrid and Canberra,
   using the Astronomical Almanac low-precision lunar series (about 0.3°; it agrees with the DE440 elongation to 0.3°).
8. **3D relief**: `js/relief3d.js` drapes the shadow map over the same LOLA grid in plain WebGL, no libraries.

## Run locally

```
python3 -m http.server 8000      # then open http://localhost:8000  (planner: /app.html)
```

## Deploy on Vercel (with the AI assistant)

1. On vercel.com, **Add New → Project**, import this GitHub repository (private repos work). No build
   settings are needed: it is a static site plus one function, `api/ask.js`.
2. In the project's **Settings → Environment Variables**, add `GEMINI_API_KEY` with a Google Gemini API
   key, then redeploy.
3. `api/horizons.js` (no key needed) powers the "Check it live against NASA" button: it asks NASA/JPL Horizons
   for the current Sun and Earth position and the page compares it with Earthset's own result.
4. The planner's Ask bar now calls `/api/ask`; the key stays on Vercel and never reaches the browser. The
   function accepts only Earthset's two request types, limits question size and rate-limits each visitor.

Without the variable (or on GitHub Pages) the Ask bar uses its offline parser, and visitors can still paste
their own key under **More → AI assistant**.

## Rebuild the data (optional)

Needs Python 3 (`numpy spiceypy pillow`) and Node 20+. Download the SPICE kernels into `raw/kernels/` and the
LOLA `.img` files into `raw/lola/` (names are listed in `tools/terrain_node.mjs` and `tools/build_ephem.py`), then:

```
python tools/build_ephem.py && node tools/build_sites.mjs && node tools/build_dems.mjs && python tools/build_maps.py
node tools/validate_ephem.mjs
```

## Limits

- Lighting and direct-to-Earth line of sight only: no thermal, slope, hazard, relay-satellite or ground-station modelling.
- The battery model is a teaching-level energy balance with example numbers, not a model of any real spacecraft.
- The shadow map considers terrain within 150 km and approximates partial sunlight linearly across the Sun's disc.
- The live view at the top uses real positions and a real LOLA horizon, but stretches elevation relative to azimuth (the factor is printed on it).
- Ground-station rows are geometry only (Moon above 10°), not a DSN schedule.
- Custom sites, the nearby search and the shadow map use reduced-resolution terrain; treat them as screening.
- LOLA grids contain interpolated gaps, especially away from the poles.
- Some South Pole entries are illustrative points inside NASA's Artemis III candidate regions; NASA has not published site coordinates. These are labelled in the app.

## Benefits and next steps

Recent landers including SLIM, IM-1 and IM-2 faced power loss or early mission endings related to lighting
and lander orientation. Earthset makes site/date tradeoffs and launch-slip alternatives easier to compare,
while helping students and the public understand the lunar south pole environment. Potential extensions include
full-resolution terrain for every custom site, relay-satellite links, thermal limits and rover traverses between
lit areas.

## Data and references

- NASA/JPL Horizons System: https://ssd.jpl.nasa.gov/horizons/ (validation reference)
- NASA/JPL NAIF generic kernels: https://naif.jpl.nasa.gov/naif/data_generic.html (de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf, pck00011.tpc, naif0012.tls)
- NASA LRO LOLA Gridded Data Records, PDS Geosciences Node: https://pds-geosciences.wustl.edu/missions/lro/lola.htm (LDEM_875S_20M, LDEM_85S_40M, LDEM_80S_80M, LDEM_75S_120M, LDEM_75N_120M, LDEM_64, LDEM_16)
- Mazarico et al. (2011), *Illumination conditions of the lunar polar regions using LOLA topography*, Icarus 211, 1066–1081
- Landing-site coordinates: NASA NSSDCA, LROC (ASU), ISRO (Chandrayaan-3), JAXA (SLIM), IAU Gazetteer of Planetary Nomenclature
- Challenge resources: LROC Quickmap (https://quickmap.lroc.asu.edu/) and NASA Moon Trek (https://trek.nasa.gov/moon/)
- Blue Ghost Mission 1 event times: Firefly Aerospace / NASA mission updates (March 2025)
- Mission reporting used for website comparisons: JAXA and NASASpaceflight on SLIM (2024); Spaceflight Now on IM-2 Athena (2025); Universe Today on IM-1 Odysseus (2024)
- Other references: NASA's "VIPER rover will get driving headlights" (Mark Shirley, NASA Ames); FOX Weather on Intuitive Machines' IM-2 statement (March 2025); IAU Gazetteer of Planetary Nomenclature (USGS)
- Deep Space Network locations: NASA/JPL; low-precision lunar position series: *The Astronomical Almanac*
- Libraries: SPICE Toolkit via `spiceypy`, NumPy, Pillow (data preparation only). The web app has no third-party dependencies.

## Development and testing tools

Claude was used primarily for frontend development and also for testing. Manus was also used for testing; its
Linux environment allowed it to interact with the website like a real user. The project uses JavaScript
(ES modules, Canvas, WebGL and Web Workers), HTML, CSS, Python (NumPy, spiceypy, Pillow) and Node.js. Google
Chrome was used for testing; GitHub Pages hosts the website. Google Gemini is an optional runtime assistant
in the Ask bar; it interprets questions and summarizes numbers Earthset has already computed. No NASA logos,
flags or mission identifiers are used.

The optional assistant in the "Ask" bar (`js/ai.js`) calls Google Gemini at runtime, only when a visitor
pastes their own Gemini API key under **More → AI assistant**. The key is stored in that browser's local
storage and never in this repository. Gemini turns a free-form question into settings and words a short
summary of numbers Earthset has already computed. Without a key, a rule-based offline parser is used.
