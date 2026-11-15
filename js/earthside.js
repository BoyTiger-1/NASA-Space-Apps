// Earthset: the Earth end of the link. Which Deep Space Network complexes have
// the Moon in their sky at a given moment.
// The Moon's position uses the low-precision series from the Astronomical
// Almanac (about 0.3 deg in longitude, 0.2 deg in latitude), which moves a
// station's moonrise or moonset by a minute or two. This is geometry only,
// not a DSN schedule.
// SI disclosure: written with the assistance of an SI coding tool (Claude).

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const sd = (d) => Math.sin(d * D2R), cd = (d) => Math.cos(d * D2R);

export const MASK_DEG = 10;      // lowest elevation at which a station is counted as tracking
export const STATIONS = [
  { id: 'GDS', name: 'Goldstone', lat: 35.4267, lon: -116.89 },
  { id: 'MAD', name: 'Madrid', lat: 40.4314, lon: -4.2481 },
  { id: 'CBR', name: 'Canberra', lat: -35.4014, lon: 148.9817 },
];

// Geocentric right ascension and declination of the Moon (deg), ecliptic
// longitude/latitude (deg) and horizontal parallax (deg).
export function moonRaDec(ms) {
  const T = (ms - J2000_MS) / 86400e3 / 36525;
  const lam = 218.32 + 481267.881 * T + 6.29 * sd(135.0 + 477198.87 * T) - 1.27 * sd(259.3 - 413335.36 * T) + 0.66 * sd(235.7 + 890534.22 * T)
    + 0.21 * sd(269.9 + 954397.74 * T) - 0.19 * sd(357.5 + 35999.05 * T) - 0.11 * sd(186.5 + 966404.03 * T);
  const bet = 5.13 * sd(93.3 + 483202.02 * T) + 0.28 * sd(228.2 + 960400.89 * T) - 0.28 * sd(318.3 + 6003.15 * T) - 0.17 * sd(217.6 - 407332.21 * T);
  const par = 0.9508 + 0.0518 * cd(135.0 + 477198.87 * T) + 0.0095 * cd(259.3 - 413335.36 * T) + 0.0078 * cd(235.7 + 890534.22 * T) + 0.0028 * cd(269.9 + 954397.74 * T);
  const eps = 23.439 - 0.013 * T;
  const l = cd(bet) * cd(lam), m = cd(eps) * cd(bet) * sd(lam) - sd(eps) * sd(bet), n = sd(eps) * cd(bet) * sd(lam) + cd(eps) * sd(bet);
  return { ra: (Math.atan2(m, l) * R2D + 360) % 360, dec: Math.asin(n) * R2D, lam: ((lam % 360) + 360) % 360, bet, par };
}

// Apparent ecliptic longitude of the Sun (deg), low precision (about 0.01 deg).
export function sunLongitude(ms) {
  const d = (ms - J2000_MS) / 86400e3, g = 357.528 + 0.9856003 * d;
  return (((280.46 + 0.9856474 * d + 1.915 * sd(g) + 0.02 * sd(2 * g)) % 360) + 360) % 360;
}

// Greenwich mean sidereal time (deg).
export function gmst(ms) { return (((280.46061837 + 360.98564736629 * (ms - J2000_MS) / 86400e3) % 360) + 360) % 360; }

// Point on Earth with the Moon overhead (deg, east-positive longitude).
export function subLunarPoint(ms) {
  const m = moonRaDec(ms);
  return { lat: m.dec, lon: ((m.ra - gmst(ms) + 540) % 360) - 180 };
}

// Elevation (deg) of the Moon above a station's horizon, corrected for parallax.
export function moonElevation(station, ms, moon = moonRaDec(ms)) {
  const H = gmst(ms) + station.lon - moon.ra;
  const el = Math.asin(sd(station.lat) * sd(moon.dec) + cd(station.lat) * cd(moon.dec) * cd(H)) * R2D;
  return el - moon.par * cd(el);
}

// Bit mask of stations with the Moon above the elevation mask (bit k = STATIONS[k]).
export function stationsInView(ms) {
  const moon = moonRaDec(ms); let bits = 0;
  for (let k = 0; k < STATIONS.length; k++) if (moonElevation(STATIONS[k], ms, moon) >= MASK_DEG) bits |= 1 << k;
  return bits;
}
