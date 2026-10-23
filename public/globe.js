// The globe window: both stations and the great-circle path between them, on
// MapLibre's globe with OpenFreeMap's tiles. Everything it draws is told to it
// by the main window over a BroadcastChannel — it knows no callsign of its own.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const BACK_AFTER = 18000;   // ms without a touch before it goes back to the contact
const chan = new BroadcastChannel('r2fel-globe');
const $ = id => document.getElementById(id);

let map = null;
let loading = null;
let state = null;       // the last { me, call, a, b, ... } from the main window
let backTimer = null;
let framedFor = '';

/** Points along the great circle from a to b — the long way round if asked. */
function path(a, b, long) {
  const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
  const vec = p => [Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)), Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)), Math.sin(rad(p.lat))];
  const A = vec(a), B = vec(b);
  const dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const d = Math.acos(dot);
  if (d < 1e-6) return [[a.lon, a.lat]];
  const U = B.map((v, i) => (v - dot * A[i]) / Math.sin(d));
  const span = long ? -(2 * Math.PI - d) : d;
  const out = [];
  const steps = long ? 256 : 128;
  for (let i = 0; i <= steps; i++) {
    const t = (span * i) / steps;
    const p = A.map((v, k) => v * Math.cos(t) + U[k] * Math.sin(t));
    out.push([deg(Math.atan2(p[1], p[0])), deg(Math.atan2(p[2], Math.hypot(p[0], p[1])))]);
  }
  // MapLibre draws a line straight across the date line unless the longitudes keep going past ±180.
  for (let i = 1; i < out.length; i++) {
    while (out[i][0] - out[i - 1][0] > 180) out[i][0] -= 360;
    while (out[i][0] - out[i - 1][0] < -180) out[i][0] += 360;
  }
  return out;
}

async function ensureMap() {
  if (map) return map;
  if (!loading) {
    loading = (async () => {
      if (!document.createElement('canvas').getContext('webgl2')) throw new Error('no WebGL2');
      const lib = await import('/vendor/maplibre/maplibre-gl.mjs');
      const m = new lib.Map({ container: 'map', style: STYLE, center: [20, 50], zoom: 1.2, attributionControl: false });
      m.addControl(new lib.AttributionControl({ compact: true }));
      m.addControl(new lib.NavigationControl({ showCompass: false, showZoom: true }), 'top-right');
      await new Promise((resolve, reject) => {
        m.once('style.load', resolve);
        m.once('error', e => reject(e.error || e));
      });
      m.setProjection({ type: 'globe' });
      m.addSource('arc', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'arc', type: 'line', source: 'arc', paint: { 'line-color': '#e8a23d', 'line-width': 3 } });
      m.addSource('pts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'pts', type: 'circle', source: 'pts',
        paint: { 'circle-radius': 6, 'circle-color': '#e8a23d', 'circle-stroke-color': '#1c1b19', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'lbl', type: 'symbol', source: 'pts',
        layout: { 'text-field': ['get', 'call'], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-offset': [0, 1.3] },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#1c1b19', 'text-halo-width': 2 } });
      // Turned or zoomed by hand: left there for a while, then back to the contact.
      m.on('movestart', ev => {
        if (!ev.originalEvent) return;
        clearTimeout(backTimer);
        backTimer = setTimeout(() => frame(true), BACK_AFTER);
      });
      // The window is a square the user stretches: the globe is as big as the window lets it be.
      new ResizeObserver(() => m.resize()).observe($('map'));
      map = m;
      return m;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/** Points the globe at the contact; `now` skips the flight. */
function frame(now) {
  if (!map || !state) return;
  const { a, b } = state;
  if (!a && !b) return;
  if (!a || !b) {
    const p = a || b;
    map.easeTo({ center: [p.lon, p.lat], zoom: 3, duration: now ? 0 : 1200 });
    return;
  }
  const line = path(a, b, state.long);
  const mid = line[Math.floor(line.length / 2)];
  const span = state.spanKm || 0;
  const zoom = span > 9000 ? 0.6 : span > 4000 ? 1.2 : span > 1500 ? 2.3 : span > 500 ? 3.6 : 5;
  map.easeTo({ center: [mid[0], mid[1]], zoom, duration: now ? 0 : 1500 });
}

async function show(next) {
  const target = `${next.a ? next.a.lat + ',' + next.a.lon : ''}|${next.b ? next.b.lat + ',' + next.b.lon : ''}|${next.long}`;
  state = next;
  document.title = next.title || document.title;
  $('route').textContent = next.route || '';
  $('route').hidden = !next.route;
  $('km').textContent = next.km || '';
  $('km').hidden = !next.km;
  $('long').textContent = next.longLabel || 'LONG PATH';
  $('long').title = next.longTitle || '';
  $('long').hidden = !next.hasTo;
  $('long').classList.toggle('is-on', Boolean(next.long));
  $('note').textContent = '';
  let m;
  try { m = await ensureMap(); } catch (err) {
    $('note').textContent = String(err && err.message) === 'no WebGL2' ? next.noGl : next.noMap;
    return;
  }
  const pts = [];
  if (next.a) pts.push({ type: 'Feature', properties: { call: next.me }, geometry: { type: 'Point', coordinates: [next.a.lon, next.a.lat] } });
  if (next.b) pts.push({ type: 'Feature', properties: { call: next.call }, geometry: { type: 'Point', coordinates: [next.b.lon, next.b.lat] } });
  m.getSource('pts').setData({ type: 'FeatureCollection', features: pts });
  m.getSource('arc').setData({ type: 'FeatureCollection', features: next.a && next.b
    ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path(next.a, next.b, next.long) } }] : [] });
  if (target !== framedFor) { framedFor = target; clearTimeout(backTimer); frame(false); }
}

chan.onmessage = ev => { if (ev.data && ev.data.type === 'state') show(ev.data); };
$('long').addEventListener('click', () => chan.postMessage({ type: 'long', value: !(state && state.long) }));
// In the desktop app the program itself tells the main window; a browser pop-up has only this.
if (!/Electron\//.test(navigator.userAgent)) addEventListener('pagehide', () => chan.postMessage({ type: 'closed' }));
chan.postMessage({ type: 'hello' });
