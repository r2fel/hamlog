/*
 * The second CW decoder at work, off the page's own thread: reading a piece
 * takes a second or two, and the page must not stall while it does. The
 * page sends sound as the microphone hands it over; back come pieces of
 * text, each with the station (by tone) that sent it.
 */
/* global CwSoft */
importScripts('cw-soft.js');

let stream = null;

function send(segments, final) {
  self.postMessage({ type: 'text', segments, stations: stream ? stream.stations : [], final: Boolean(final) });
}

self.onmessage = ev => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'start') {
      stream = CwSoft.makeStream({ knowledge: msg.knowledge });
    } else if (msg.type === 'audio' && stream) {
      const out = stream.push(msg.samples, msg.rate);
      if (out.length) send(out);
    } else if (msg.type === 'flush' && stream) {
      send(stream.flush(), true);
    } else if (msg.type === 'reset' && stream) {
      stream.reset();
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
