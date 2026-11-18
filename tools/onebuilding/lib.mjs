// shared helpers: game-local frame <-> lon/lat <-> web mercator (I3S)
export const LAT0 = 56.9515, LON0 = 24.1133, M_LAT = 111320, M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
export const toLocal = (lon, lat) => ({ x: (lon - LON0) * M_LON, z: -(lat - LAT0) * M_LAT });
const R = 6378137, D2R = Math.PI / 180;
export const MX0 = LON0 * D2R * R, MY0 = Math.log(Math.tan(Math.PI / 4 + LAT0 * D2R / 2)) * R, K = 1 / Math.cos(LAT0 * D2R);
export const Y0 = 5; // the realistic/c.html convention: y = mesh z - 5
