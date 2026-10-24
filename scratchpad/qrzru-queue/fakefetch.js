// Pretends to be the network: the first request to api.qrz.ru times out (as in the
// user's log), every later one succeeds. Counts the requests so a test can see
// whether the program even tried again.
const real = global.fetch;
let ruCalls = 0;
global.__ruCalls = () => ruCalls;
global.fetch = async function (url, opts) {
  const u = String(url);
  if (!u.includes('api.qrz.ru')) return real.apply(this, arguments);
  ruCalls += 1;
  if (ruCalls === 1) {
    const e = new TypeError('fetch failed');
    e.cause = { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout Error (attempted address: api.qrz.ru:443, timeout: 10000ms)' };
    throw e;
  }
  const xml = u.includes('/login')
    ? '<QRZDatabase><Session><session_id>abc123</session_id></Session></QRZDatabase>'
    : '<QRZDatabase><Callsign><call>R3RBF</call><ename>Sergey</ename><esurname>Velikanov</esurname><country>Russia</country><city>Moscow</city></Callsign></QRZDatabase>';
  return new Response(xml, { status: 200 });
};
