# Project page text: copy into spaceappschallenge.org

Check every link in a private browser window before submitting.

## Project Name

Earthset: Lunar Landing Window Navigator

## High-Level Project Summary

Earthset is a web tool that tells you, in seconds, whether a lunar lander will have sunlight and a direct radio link to Earth at any site on any date, and what to do when the launch slips. It shows the Sun and Earth moving over the real terrain horizon measured by NASA's LOLA laser altimeter, compares up to four sites side by side, and turns two years of geometry into a GO / NO-GO landing-window calendar. When a delay breaks the plan, it finds a later date, a better site, or a better spot a few hundred metres away. At the Moon's south pole the Sun never rises more than about 1.5° above the horizon, so one hill can decide whether a mission lives or dies; Earthset makes that visible to mission planners, students and the public, and its Sun and Earth positions match NASA/JPL Horizons to 0.00003°.

## Link to Project Demo

https://boytiger-1.github.io/NASA-Space-Apps/demo/

(7 slides.)

## Link to Final Project

https://boytiger-1.github.io/NASA-Space-Apps/

Source code: https://github.com/BoyTiger-1/NASA-Space-Apps

## Detailed Project Description

**What it does**

- **Site comparison.** Choose from Apollo sites, NASA CLPS landings (IM-1, IM-2, Blue Ghost), ISRO's Chandrayaan-3, JAXA's SLIM, Chang'e landers and south-pole candidates, or click the map / type coordinates for a custom site. Up to four sites are compared at once.
- **Sky view.** A 360° panorama of the actual terrain horizon at the site with the Sun's and Earth's paths over the mission, plus true-scale close-ups showing how much of the Sun's disc clears the terrain and the phase of Earth. A play button animates the mission.
- **Countdowns.** Time until sunset, sunrise, Earthset or Earthrise from any moment in the mission.
- **Verdict cards.** Sunlit time, Earth-link time, longest darkness and longest link outage, with a plain-language sentence and a GO / MARGINAL / NO-GO badge against rules the user can change (minimum sunlight, survivable darkness, minimum link time, Sun and Earth at touchdown).
- **Launch-slip slider and landing-window calendar.** Every possible landing day for the next 24 months is scored for each site, so the effect of a schedule slip is visible immediately.
- **Rescue the mission.** For a broken plan, Earthset proposes the next GO date at the same site, ranks every other site for the same date, and tests 121 nearby spots on the LOLA grid to find a better-lit location.
- **Two audiences.** Explorer mode explains each panel in plain language; Planner mode adds peak Sun elevation, a flat-panel power index, CSV export and shareable links that reproduce an exact scenario.
- **Shadow map.** Real shadows cast across the LOLA terrain around a site, pixel by pixel: live at any moment (press Play and they sweep across the ground) or averaged over the mission to reveal the best-lit ground. A second layer shows where Earth is in view. Click any pixel to make it a landing site.
- **Battery survival model.** Give the lander a solar array, loads and a battery; Earthset plots the state of charge on the real lighting for every compared site, says whether it survives, and estimates the data it can send home.
- **60-second guided tour.** Nine steps walk a newcomer from "three sites are GO" through a launch slip to the rescue, the shadows and the validation.
- **Live view.** The page opens on the real skyline of the Shackleton-de Gerlache ridge with the Sun and Earth where they are this minute. Drag it to move through time.
- **Site ranking and slip margin.** The landing-window calendar is run for every site and sorted by how many of the next 730 landing days are GO, and every verdict card says how many days of slip the plan can absorb.
- **3D relief.** The shadow map can be draped over the terrain and orbited in 3D.
- **Ground stations.** The timeline shows when Goldstone, Madrid and Canberra have the Moon above 10°.
- **Printable brief.** One button turns the current scenario into a PDF.
- **Eclipses.** It also catches the hours when Earth passes in front of the Sun as seen from the Moon.

**How it works**

1. Sun and Earth positions come from NASA/JPL's DE440 ephemeris and lunar orientation kernels (SPICE), with light-time and stellar aberration, in the Moon's Mean-Earth frame. We compress them into Chebyshev polynomials (fit error below 0.02 arcseconds) so the app needs no server and covers 2024–2039.
2. For each site we trace the terrain horizon through NASA LRO LOLA elevation grids (20 m to 474 m per pixel) in 720 directions out to 450 km, including the Moon's curvature, from 2 m above the surface. There is no atmosphere, so no refraction.
3. The Sun is treated as a 0.53° disc: we integrate the part above the terrain. Earth is "in view" when its centre clears the terrain.
4. Hourly geometry is scored against the mission rules to build the cards, calendar and rescue search. Custom sites are computed live in a Web Worker.

**How we checked it**

- Against NASA/JPL Horizons at 7 sites, 2025–2038, 26,936 samples: worst difference 0.00003° in azimuth or elevation.
- Polar LOLA grids against the independent global LOLA grid: no bias, 14–20 m RMS.
- An automated suite of 28 checks (ephemeris sanity, analytic horizon dip, eclipse geometry, shadow casting, site behaviour, battery model) passes; run `node tools/test.mjs`.
- Against a real mission: for Blue Ghost Mission 1's site, Earthset predicts totality of the 14 March 2025 eclipse ending at 08:34 UTC (the lander photographed the "diamond ring" at about 08:30 UTC) and lunar sunset on 16 March at 20:23 UTC (Firefly's reports imply about 18:15 UTC, a difference of roughly 1° of Sun elevation on the coarser terrain grid used at that latitude).
- At the Shackleton–de Gerlache connecting ridge, two points 80 m apart receive 64% and 86% sunlight over 16 years, showing why terrain-true horizons matter.

**Benefits and goals**

Mission teams can compare site and date options together in minutes when schedules change, and share a scenario as a link. Teachers and the public can see why the lunar south pole is so demanding. Next steps: full-resolution terrain for every custom site, relay-satellite links, thermal limits and rover traverses between lit spots.

**Limits**

Lighting and direct-to-Earth line of sight only. Custom sites, the nearby search and the shadow map use reduced-resolution terrain and are for screening. The battery model is a simple energy balance with example numbers, not any real spacecraft. Some south-pole entries are illustrative points inside NASA's Artemis III candidate regions and are labelled as such.

**Tools**

JavaScript (ES modules, Canvas, WebGL, Web Workers), HTML and CSS with no third-party runtime libraries; two open-licensed typefaces (Archivo, Martian Mono) served from the site; Python (NumPy, spiceypy, Pillow) and Node.js for data preparation and validation; GitHub Pages for hosting.

## Use of Super Intelligence (SI)

Yes. We used an SI coding assistant (Anthropic's Claude) to help choose and shape the concept, to write the source code, data-processing and validation scripts, interface text, README, slide text and this project description, and to search the web for references. The team directed the work, ran it and reviewed the results. All numbers in the app are computed from NASA data, not generated by SI. No SI-generated images, video or audio are used; map imagery is rendered from LOLA elevation data and slide images are screenshots of the working app. SI use is acknowledged in the app's "Data, method & validation" panel, in the README, in a comment at the top of every source file and in HTML metadata. No NASA logos, flags or mission identifiers are used.

## NASA Data

- **NASA/JPL Horizons System** (https://ssd.jpl.nasa.gov/horizons/): reference for validating every Sun and Earth position.
- **NASA/JPL NAIF SPICE kernels** (https://naif.jpl.nasa.gov/naif/data_generic.html): DE440 planetary ephemeris (de440s.bsp), lunar orientation (moon_pa_de440_200625.bpc), lunar frames (moon_de440_250416.tf), pck00011.tpc, naif0012.tls. These are the source of all Sun and Earth geometry.
- **NASA Lunar Reconnaissance Orbiter, LOLA Gridded Data Records** (PDS Geosciences Node, https://pds-geosciences.wustl.edu/missions/lro/lola.htm): LDEM_875S_20M, LDEM_85S_40M, LDEM_80S_80M, LDEM_75S_120M, LDEM_75N_120M, LDEM_64, LDEM_16. Used for terrain horizons and all map imagery.
- **NASA NSSDCA and LROC** landing-site coordinates for Apollo, CLPS and international landers.
- Challenge resources consulted: Quickmap (https://quickmap.lroc.asu.edu/) and Moon Trek (https://trek.nasa.gov/moon/).

## Space Agency Partner Data and Other References

- **ISRO**: Chandrayaan-3 Vikram landing coordinates.
- **JAXA**: SLIM landing coordinates.
- IAU Gazetteer of Planetary Nomenclature (USGS): feature coordinates.
- Mazarico, E., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066–1081.
- Firefly Aerospace and NASA mission updates for Blue Ghost Mission 1 (March 2025): event times used for the real-mission check.
- Software: SPICE Toolkit via spiceypy, NumPy, Pillow, Node.js, Python, Google Chrome (testing).
- SI tool: Anthropic Claude (see above).
