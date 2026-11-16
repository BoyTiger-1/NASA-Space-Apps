"""Build the compact ephemeris used by the web app.

Fits Chebyshev polynomials to the apparent (light-time + stellar aberration
corrected) positions of the Sun and the Earth as seen from the Moon's centre,
expressed in the lunar Mean-Earth/Polar-Axis body-fixed frame (MOON_ME, the same
frame LOLA topography uses). Source: NASA/JPL DE440 + lunar PCK via SPICE.

Output: data/ephem.bin (Float32, little endian) and data/ephem.json (header).

"""
import json, os, sys
import numpy as np
import spiceypy as sp
from numpy.polynomial import chebyshev as C

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K = os.path.join(ROOT, "raw", "kernels")
for k in ["naif0012.tls", "pck00011.tpc", "moon_pa_de440_200625.bpc",
          "moon_de440_250416.tf", "de440s.bsp"]:
    sp.furnsh(os.path.join(K, k))

START = "2024-01-01T00:00:00"   # TDB
YEARS = 16
SEG_DAYS = 4.0
DEG = 13                        # polynomial degree -> DEG+1 coefficients
NSAMP = 48                      # samples per segment for the fit

et0 = sp.str2et(START.replace("T", " ") + " TDB")
nseg = int(round(YEARS * 365.25 / SEG_DAYS))
seg = SEG_DAYS * 86400.0

# Chebyshev nodes on [-1, 1]
x = np.cos(np.pi * (np.arange(NSAMP) + 0.5) / NSAMP)
xt = np.linspace(-1, 1, 41)     # independent check points

coef = np.zeros((nseg, 2, 3, DEG + 1), dtype=np.float64)
maxerr_km = [0.0, 0.0]
maxerr_ang = [0.0, 0.0]
for i in range(nseg):
    a = et0 + i * seg
    for b, body in enumerate(("SUN", "EARTH")):
        ets = a + (x + 1) * 0.5 * seg
        pos = np.array([sp.spkpos(body, t, "MOON_ME", "LT+S", "MOON")[0] for t in ets])
        c = C.chebfit(x, pos, DEG)            # (DEG+1, 3)
        coef[i, b] = c.T
        c32 = c.astype(np.float32).astype(np.float64)
        ett = a + (xt + 1) * 0.5 * seg
        truth = np.array([sp.spkpos(body, t, "MOON_ME", "LT+S", "MOON")[0] for t in ett])
        fit = C.chebval(xt, c32).T
        d = np.linalg.norm(fit - truth, axis=1)
        maxerr_km[b] = max(maxerr_km[b], d.max())
        maxerr_ang[b] = max(maxerr_ang[b], (d / np.linalg.norm(truth, axis=1)).max())
    if i % 200 == 0:
        print(i, nseg, maxerr_ang, file=sys.stderr)

out = os.path.join(ROOT, "data")
os.makedirs(out, exist_ok=True)
coef.astype("<f4").tofile(os.path.join(out, "ephem.bin"))
hdr = {
    "generator": "tools/build_ephem.py",
    "source": "NASA/JPL DE440 (de440s.bsp), moon_pa_de440_200625.bpc, moon_de440_250416.tf via SPICE",
    "frame": "MOON_ME (mean Earth / polar axis), km",
    "correction": "LT+S, observer = Moon centre",
    "start_tdb": START, "et0": et0, "seg_seconds": seg, "nseg": nseg,
    "ncoef": DEG + 1, "bodies": ["SUN", "EARTH"],
    "layout": "[seg][body][xyz][coef] float32 LE",
    "fit_max_error_arcsec": [e * 206264.8 for e in maxerr_ang],
    "fit_max_error_km": maxerr_km,
}
json.dump(hdr, open(os.path.join(out, "ephem.json"), "w"), indent=1)
print(json.dumps(hdr, indent=1))
