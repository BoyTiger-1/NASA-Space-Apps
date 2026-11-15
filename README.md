# Earthset: Lunar Landing Window Navigator

**2026 NASA Space Apps Challenge · Seattle · Challenge: Lunar Landing Site Navigator**

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

Everything runs in the browser. No server, no login, no API keys.

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
an optional Gemini key (see Use of SI tools) lets it read looser questions and add a short spoken-style summary.

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
python3 -m http.server 8000      # then open http://localhost:8000
```

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
- Custom sites and the nearby search use reduced-resolution terrain; treat them as screening.
- LOLA grids contain interpolated gaps, especially away from the poles.
- Some South Pole entries are illustrative points inside NASA's Artemis III candidate regions; NASA has not published site coordinates. These are labelled in the app.

## Data and references

- NASA/JPL Horizons System: https://ssd.jpl.nasa.gov/horizons/ (validation reference)
- NASA/JPL NAIF generic kernels: de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf, pck00011.tpc, naif0012.tls
- NASA LRO LOLA Gridded Data Records, PDS Geosciences Node: LDEM_875S_20M, LDEM_85S_40M, LDEM_80S_80M, LDEM_75S_120M, LDEM_75N_120M, LDEM_64, LDEM_16
- Mazarico et al. (2011), *Illumination conditions of the lunar polar regions using LOLA topography*, Icarus 211, 1066–1081
- Landing-site coordinates: NASA NSSDCA, LROC (ASU), ISRO (Chandrayaan-3), JAXA (SLIM), IAU Gazetteer of Planetary Nomenclature
- Blue Ghost Mission 1 event times: Firefly Aerospace / NASA mission updates (March 2025)
- Libraries: SPICE Toolkit via `spiceypy`, NumPy, Pillow (data preparation only). The web app has no third-party dependencies.

## Use of SI tools

The source code, data-processing scripts, interface text and this README were written with the assistance of an
SI coding tool (Anthropic's Claude), which also helped shape the concept; the team directed, ran and reviewed
the work. Every number the app shows is computed from the NASA data above, not generated by SI. No SI-generated
images, video or audio are used: map imagery is rendered directly from LOLA elevation data. Each source file
carries an SI-disclosure comment. No NASA logos, flags or mission identifiers are used.

The optional assistant in the "Ask" bar (`js/ai.js`) calls Google Gemini at runtime, only when a visitor
pastes their own Gemini API key under **More → AI assistant**. The key is stored in that browser's local
storage and never in this repository. Gemini turns a free-form question into settings and words a short
summary of numbers Earthset has already computed. Without a key, a rule-based offline parser is used.
