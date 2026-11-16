"""Renders shaded-relief basemaps from NASA LOLA topography for the app."""
import os, numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
L = os.path.join(ROOT, "raw", "lola"); OUT = os.path.join(ROOT, "img"); os.makedirs(OUT, exist_ok=True)

def shade(h, res, az=315.0, alt=35.0, z=1.0):
    gy, gx = np.gradient(h.astype(np.float32), res)
    slope = np.arctan(z * np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
    a, e = np.radians(az), np.radians(alt)
    return np.clip(np.sin(e) * np.cos(slope) + np.cos(e) * np.sin(slope) * np.cos(a - aspect), 0, 1)

def render(h, res, lo, hi, z):
    s = shade(h, res, z=z)
    t = np.clip((h - lo) / (hi - lo), 0, 1)[..., None]
    c0 = np.array([38, 44, 66], np.float32); c1 = np.array([150, 150, 158], np.float32); c2 = np.array([238, 232, 220], np.float32)
    col = np.where(t < 0.5, c0 + (c1 - c0) * (t * 2), c1 + (c2 - c1) * ((t - 0.5) * 2))
    return (col * (0.35 + 0.75 * s[..., None])).clip(0, 255).astype(np.uint8)

def block(a, f):
    n0, n1 = a.shape[0] // f, a.shape[1] // f
    o0, o1 = (a.shape[0] - n0 * f) // 2, (a.shape[1] - n1 * f) // 2
    return a[o0:o0 + n0 * f, o1:o1 + n1 * f].reshape(n0, f, n1, f).mean(axis=(1, 3))

# South pole, 80S cap, 80 m -> 400 m/px (1520 px)
a = np.fromfile(os.path.join(L, "ldem_80s_80m.img"), dtype="<i2").reshape(7600, 7600) * 0.5
h = block(a, 5); Image.fromarray(render(h, 400.0, -4500, 6500, 1.6)).save(os.path.join(OUT, "south_pole.jpg"), quality=86)
print("south", h.shape)
# South pole close-up, 87.5S cap, 20 m -> 100 m/px (1516 px)
a = np.fromfile(os.path.join(L, "ldem_875s_20m.img"), dtype="<i2").reshape(7584, 7584) * 0.5
h = block(a, 5); Image.fromarray(render(h, 100.0, -4000, 2500, 1.3)).save(os.path.join(OUT, "south_pole_zoom.jpg"), quality=86)
print("zoom", h.shape)
# Global, 16 ppd -> 8 ppd (2880 x 1440), longitude re-centred on 0 (near side in the middle)
a = np.fromfile(os.path.join(L, "ldem_16.img"), dtype="<i2").reshape(2880, 5760) * 0.5
h = block(a, 2); h = np.roll(h, h.shape[1] // 2, axis=1)
Image.fromarray(render(h, 3790.0, -6000, 7000, 6.0)).save(os.path.join(OUT, "global.jpg"), quality=84)
print("global", h.shape)
