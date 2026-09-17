/* The manual's small bits of behaviour: the step-by-step animations, pictures
 * opened full size, and Esc handing back to the app when shown inside it. */
(function () {
  'use strict';

  // ---- Animations ----------------------------------------------------------
  // <div class="anim" data-frames="anim/en/log-contact/"> … <ol class="anim-steps">
  // Frames and their timing come from frames.json there (written by
  // scripts/manual-images.js); each frame belongs to a step, and the caption
  // for that step lights up while it plays. Plays by itself once scrolled
  // into view, loops, and stops when scrolled away.

  const PAUSE_AT_END = 1200;

  function setupAnim(box) {
    const base = box.dataset.frames;
    const img = box.querySelector('.anim-screen img');
    const playBtn = box.querySelector('.anim-play');
    const bar = box.querySelector('.anim-progress > div');
    const steps = [...box.querySelectorAll('.anim-steps > li')];
    const caption = document.createElement('div');
    caption.className = 'anim-caption';
    box.querySelector('.anim-screen').appendChild(caption);

    let frames = [];
    let index = 0;
    let timer = null;
    let playing = false;
    let wanted = true;       // false once the reader pressed pause

    fetch(base + 'frames.json')
      .then(res => res.json())
      .then(data => {
        frames = data.frames;
        frames.forEach(f => { const pre = new Image(); pre.src = base + f.src; });
        show(0);
        observer.observe(box);
      })
      .catch(() => { box.hidden = true; });

    function show(i) {
      index = i;
      const f = frames[i];
      img.src = base + f.src;
      bar.style.width = `${((i + 1) / frames.length) * 100}%`;
      steps.forEach((li, n) => li.classList.toggle('is-now', n + 1 === f.step));
      const now = steps[f.step - 1];
      if (now && caption.dataset.step !== String(f.step)) {
        caption.dataset.step = f.step;
        caption.innerHTML = now.innerHTML;
      }
    }

    function tick() {
      const f = frames[index];
      const last = index === frames.length - 1;
      timer = setTimeout(() => {
        show(last ? 0 : index + 1);
        if (playing) tick();
      }, f.ms + (last ? PAUSE_AT_END : 0));
    }

    function play() {
      if (playing || !frames.length) return;
      playing = true;
      playBtn.textContent = '❚❚';
      tick();
    }

    function pause() {
      playing = false;
      clearTimeout(timer);
      playBtn.textContent = '▶';
    }

    playBtn.addEventListener('click', () => {
      wanted = !playing;
      if (playing) pause(); else play();
    });

    // A caption jumps to the start of its step.
    steps.forEach((li, n) => li.addEventListener('click', () => {
      const first = frames.findIndex(f => f.step === n + 1);
      if (first === -1) return;
      clearTimeout(timer);
      show(first);
      if (playing) tick();
    }));

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && wanted) play();
      else if (!entry.isIntersecting) pause();
    }, { threshold: 0.4 });
  }

  document.querySelectorAll('.anim').forEach(setupAnim);

  // ---- Pictures full size --------------------------------------------------

  const zoom = document.createElement('div');
  zoom.className = 'zoom';
  zoom.hidden = true;
  zoom.innerHTML = '<img alt="">';
  document.body.appendChild(zoom);

  document.querySelectorAll('figure img').forEach(img => {
    img.addEventListener('click', () => {
      const big = zoom.querySelector('img');
      big.src = img.src;
      big.alt = img.alt;   // shown at its full pixel size — larger than on the page
      zoom.hidden = false;
    });
  });
  zoom.addEventListener('click', () => { zoom.hidden = true; });

  // ---- Jumping to a section ------------------------------------------------
  // The 📖 links in the app open the manual straight at the section they are
  // about. The first time that loads the page with a #name, so the browser
  // does the jumping; afterwards the frame is already open and the app sends
  // the name over instead. Either way the heading blinks once, so the eye
  // finds where it landed.

  function goto(id) {
    const el = document.getElementById(id);
    if (!el) return;
    // Straight there, not gliding: the manual is long, and a smooth scroll
    // across fifteen sections takes seconds and leaves the reader watching
    // the scenery go by. The heading blinks instead, to say "here".
    // ('auto' on purpose: the page's own CSS scrolls smoothly, which is right
    // for its table of contents but not for a jump across the whole manual.)
    el.scrollIntoView({ block: 'start', behavior: 'auto' });
    document.querySelectorAll('.is-found').forEach(h => h.classList.remove('is-found'));
    void el.offsetWidth;          // restart the blink if it is the same heading
    el.classList.add('is-found');
  }

  if (location.hash.length > 1) {
    const id = decodeURIComponent(location.hash.slice(1));
    goto(id);
    // The pictures have no size until they arrive, so at this moment the page
    // is much shorter than it will be and the section is not where it will
    // end up. Aim again once everything has loaded.
    window.addEventListener('load', () => goto(id));
  }

  window.addEventListener('message', ev => {
    if (ev.origin !== location.origin) return;
    if (ev.data && ev.data.r2fel === 'goto' && typeof ev.data.id === 'string') goto(ev.data.id);
  });

  // ---- Keys ----------------------------------------------------------------

  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (!zoom.hidden) { zoom.hidden = true; return; }
    // Inside the app, the manual is a frame: keys pressed here never reach
    // the app, so Esc is passed on to close it.
    if (window.parent !== window) window.parent.postMessage('r2fel-help-close', location.origin);
  });
})();
