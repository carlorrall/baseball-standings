// Home Run Derby: time your swing as the pitch reaches the plate.
// Ten outs; anything that isn't a home run is an out.

import * as THREE from 'three';
import { makeBaseball } from './ball.js';

const OUTS = 10;
const BALL_R = 0.085;          // a real ball is 0.037 m; bigger reads better from behind the plate
const PLATE_Z = 0.2;           // where the bat meets the ball
const RELEASE = new THREE.Vector3(0.1, 1.8, -16.8);
const SLOW = 1.7;              // pitches travel slower than real ones so the timing is humanly possible
const WINDOW = 0.13;           // seconds either side of perfect timing that still make contact
const SWING_TO_CONTACT = 0.07; // seconds from pressing to the bat reaching the plate
const BEST_KEY = 'hr-derby-best';

const PITCHES = [
  { name: 'Fastball', mph: [91, 98], arc: 0.12, drop: 0 },
  { name: 'Sinker', mph: [88, 94], arc: 0.06, drop: 0.22 },
  { name: 'Changeup', mph: [80, 86], arc: 0.25, drop: 0.12 },
  { name: 'Curveball', mph: [74, 80], arc: 0.5, drop: 0.3 },
];

const FT = 0.3048;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
// fence: 330 ft down the lines, 400 ft to centre (spray in degrees, 0 = centre field)
const fenceFt = (deg) => 330 + 70 * Math.cos((Math.abs(deg) / 45) * (Math.PI / 2));
const sprayDir = (deg) => new THREE.Vector3(Math.sin((deg * Math.PI) / 180), 0, -Math.cos((deg * Math.PI) / 180));

const COLORS = {
  sky: 0xfbf8f0,
  foul: 0xf3eee2,
  grass: 0xdfe5cc,
  dirt: 0xeadcc0,
  ink: 0x1a2634,
  wood: 0xc79a5e,
};

function readBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
function saveBest(n) {
  try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* private mode: just don't remember */ }
}

/* ---------- the field ---------- */

function flat(geometry, color, y = 0) {
  const m = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

// a pie slice from home plate, from -45° to 45°, radius given per angle (metres)
function sector(radiusAt, steps = 64) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i <= steps; i++) {
    const deg = -45 + (90 * i) / steps;
    const d = sprayDir(deg).multiplyScalar(radiusAt(deg));
    shape.lineTo(d.x, -d.z); // shape is drawn in the XY plane, then laid flat
  }
  shape.lineTo(0, 0);
  return new THREE.ShapeGeometry(shape);
}

function line(from, to, width, color, opacity = 1) {
  const len = from.distanceTo(to);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, len),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity })
  );
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.atan2(to.x - from.x, -(to.z - from.z)) * -1;
  m.position.set((from.x + to.x) / 2, 0.012, (from.z + to.z) / 2);
  return m;
}

function buildField() {
  const field = new THREE.Group();
  field.add(flat(new THREE.PlaneGeometry(600, 600), COLORS.foul, -0.01));
  field.add(flat(sector((deg) => fenceFt(deg) * FT), COLORS.grass, 0));
  field.add(flat(sector(() => 29), COLORS.dirt, 0.004));

  // infield grass diamond
  const base = 27.43 / Math.SQRT2;
  const diamond = new THREE.Shape([
    new THREE.Vector2(0, 2.5), new THREE.Vector2(base - 2.2, base), new THREE.Vector2(0, 2 * base - 2.5), new THREE.Vector2(-base + 2.2, base),
  ]);
  field.add(flat(new THREE.ShapeGeometry(diamond), COLORS.grass, 0.008));

  // mound + bases + plate
  const mound = flat(new THREE.CircleGeometry(2.7, 48), COLORS.dirt, 0.01);
  mound.position.z = -18.44;
  field.add(mound);
  for (const [x, z] of [[base, -base], [0, -2 * base], [-base, -base]]) {
    const b = flat(new THREE.PlaneGeometry(0.5, 0.5), 0xffffff, 0.02);
    b.rotation.z = Math.PI / 4;
    b.position.set(x, 0.02, z);
    field.add(b);
  }
  // point faces the catcher (+z)
  const plate = new THREE.Shape([
    new THREE.Vector2(-0.22, 0), new THREE.Vector2(0.22, 0), new THREE.Vector2(0.22, -0.22), new THREE.Vector2(0, -0.43), new THREE.Vector2(-0.22, -0.22),
  ]);
  const p = flat(new THREE.ShapeGeometry(plate), 0xffffff, 0.02);
  p.position.z = PLATE_Z - 0.2;
  field.add(p);

  // foul lines
  const o = new THREE.Vector3(0, 0, 0);
  field.add(line(o, sprayDir(-45).multiplyScalar(fenceFt(45) * FT), 0.12, 0xffffff));
  field.add(line(o, sprayDir(45).multiplyScalar(fenceFt(45) * FT), 0.12, 0xffffff));

  // outfield wall: a navy ribbon following the fence
  const pts = [];
  const idx = [];
  const steps = 90;
  for (let i = 0; i <= steps; i++) {
    const deg = -45 + (90 * i) / steps;
    const d = sprayDir(deg).multiplyScalar(fenceFt(deg) * FT);
    pts.push(d.x, 0, d.z, d.x, 3.2, d.z);
    if (i < steps) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  wallGeo.setIndex(idx);
  field.add(new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ color: COLORS.ink, side: THREE.DoubleSide })));

  return field;
}

function buildBat() {
  // profile along the bat: knob, thin handle, swelling barrel, rounded end (radius, length) in metres
  const profile = [
    [0, -0.02], [0.03, -0.02], [0.032, 0], [0.013, 0.02], [0.012, 0.3], [0.02, 0.48], [0.031, 0.62], [0.033, 0.8], [0.03, 0.84], [0, 0.85],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(profile, 24);
  geo.rotateZ(-Math.PI / 2); // lie along +x
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.55 }));
  const tilt = new THREE.Group();   // raises the barrel: held up when waiting, nearly level through the zone
  tilt.add(mesh);
  const pivot = new THREE.Group();  // hands of a right-handed hitter, third-base side of the plate
  pivot.position.set(-0.62, 0.98, PLATE_Z);
  pivot.add(tilt);
  pivot.userData.tilt = tilt;
  return pivot;
}

/* ---------- the game ---------- */

export function createDerby(root) {
  root.innerHTML = `
    <div class="derby-stage">
      <div class="derby-hud">
        <span>Outs <b data-outs>0</b>/${OUTS}</span>
        <span>Home runs <b data-hr>0</b></span>
        <span>Best <b data-best>0</b></span>
      </div>
      <p class="derby-pitch" data-pitch></p>
      <div class="derby-call" data-call><strong></strong><span></span></div>
      <div class="derby-overlay" data-overlay>
        <h2>Ten outs.</h2>
        <p>Swing as the ball reaches the plate. Anything that isn’t a home run is an out.</p>
        <button type="button" class="btn" data-start>Play ball</button>
      </div>
      <p class="derby-hint">Space, click or tap to swing</p>
    </div>`;
  const stage = root.querySelector('.derby-stage');
  const $ = (sel) => root.querySelector(sel);
  const ui = {
    outs: $('[data-outs]'), hr: $('[data-hr]'), best: $('[data-best]'), pitch: $('[data-pitch]'),
    call: $('[data-call]'), overlay: $('[data-overlay]'), start: $('[data-start]'),
  };

  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (err) {
    console.error(err);
    ui.overlay.innerHTML = '<h2>No 3D here.</h2><p>This browser can’t draw the game (WebGL is unavailable).</p>';
    return { start() {}, stop() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.sky, 140, 420);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cfb8, 1.6));
  const sun = new THREE.DirectionalLight(0xfffaf0, 2.2);
  sun.position.set(-20, 30, 15);
  scene.add(sun);
  scene.add(buildField());

  const bat = buildBat();
  scene.add(bat);

  const ball = new THREE.Group();
  const { body } = makeBaseball({ segments: [48, 32] });
  ball.add(body);
  ball.scale.setScalar(BALL_R);
  ball.visible = false;
  scene.add(ball);

  // red trail behind a hit ball, like a broadcast home-run tracer
  const TRAIL = 90;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xb5232b, transparent: true, opacity: 0.85 }));
  trail.frustumCulled = false;
  scene.add(trail);
  let trailCount = 0;
  const resetTrail = () => { trailCount = 0; trailGeo.setDrawRange(0, 0); };
  const pushTrail = (v) => {
    const a = trailGeo.attributes.position;
    if (trailCount < TRAIL) trailCount++;
    else a.array.copyWithin(0, 3); // drop the oldest point
    a.setXYZ(trailCount - 1, v.x, v.y, v.z);
    a.needsUpdate = true;
    trailGeo.setDrawRange(0, trailCount);
  };

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.18, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.visible = false;
  scene.add(shadow);

  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.05, 400);
  const CAM_HOME = new THREE.Vector3(0, 2.1, 4.4);
  const LOOK_HOME = new THREE.Vector3(0, 0.8, -12);
  const look = LOOK_HOME.clone();
  camera.position.copy(CAM_HOME);

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the field's width in view on narrow (portrait) screens
    camera.fov = w / h < 1 ? 64 : 48;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  /* ---------- state ---------- */
  let state = 'idle'; // idle | windup | pitch | flight | result | over
  let clock = 0;      // seconds, game time
  let outs = 0, homers = 0, best = readBest();
  let pitch = null;   // { type, mph, start, T, target }
  let swing = null;   // { at } (game time of the press)
  let hit = null;     // { from, dir, dist, peak, start, dur, label, sub, homer }
  let nextAt = 0;
  let resultUntil = 0;

  const hud = () => {
    ui.outs.textContent = outs;
    ui.hr.textContent = homers;
    ui.best.textContent = best;
  };
  hud();

  function call(title, sub = '', good = false) {
    ui.call.querySelector('strong').textContent = title;
    ui.call.querySelector('span').textContent = sub;
    ui.call.classList.toggle('is-good', good);
    ui.call.classList.add('is-on');
  }
  const clearCall = () => ui.call.classList.remove('is-on');

  function newGame() {
    // on short screens the game can sit partly below the fold
    stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    outs = 0; homers = 0;
    hud();
    ui.overlay.hidden = true;
    clearCall();
    queuePitch(0.9);
  }

  function queuePitch(delay = rand(0.9, 1.7)) {
    state = 'windup';
    pitch = null; swing = null; hit = null;
    nextAt = clock + delay;
    ball.visible = false;
    shadow.visible = false;
    resetTrail();
    ui.pitch.textContent = '';
  }

  function throwPitch() {
    const type = PITCHES[Math.floor(Math.random() * PITCHES.length)];
    const mph = Math.round(rand(...type.mph));
    const dist = RELEASE.z * -1 + PLATE_Z;
    pitch = {
      type, mph,
      start: clock,
      T: (dist / (mph * 0.44704)) * SLOW,
      target: new THREE.Vector3(rand(-0.12, 0.18), rand(0.78, 1.05), PLATE_Z),
    };
    state = 'pitch';
    ball.visible = true;
    shadow.visible = true;
    ui.pitch.textContent = `${mph} mph ${type.name}`;
  }

  // position of the pitch at u (0 = release, 1 = plate)
  const pitchPos = (u, out) => {
    out.lerpVectors(RELEASE, pitch.target, u);
    out.y += pitch.type.arc * 4 * u * (1 - u) - pitch.type.drop * u * u + pitch.type.drop;
    return out;
  };

  function out(title, sub) {
    outs += 1;
    hud();
    call(title, sub);
  }

  function endPlay() {
    state = 'result';
    resultUntil = clock + 1.4;
  }

  // e.timeStamp is when the key/tap actually happened; convert it to game time so the
  // swing isn't rounded to the last drawn frame
  function trySwing(e) {
    if (state !== 'pitch' || swing) return;
    swing = { at: clock + Math.max(0, (e.timeStamp - last) / 1000) };
  }

  // judge the swing the moment the bat reaches the plate
  function resolveContact() {
    const contact = swing.at + SWING_TO_CONTACT;
    const diff = contact - (pitch.start + pitch.T); // < 0 early, > 0 late
    if (Math.abs(diff) > WINDOW) return false; // whiff, handled when the ball passes

    const q = 1 - Math.abs(diff) / WINDOW; // 1 = perfect
    // early swings are pulled to left field, late ones pushed to right (right-handed hitter)
    let spray = (diff / WINDOW) * 58 + rand(-4, 4);
    const foul = Math.abs(spray) > 45;
    if (foul && Math.abs(diff) > WINDOW * 0.8) spray = Math.sign(spray) * rand(70, 110); // tipped back into the stands
    const ev = Math.round(72 + 43 * Math.pow(q, 0.8) + rand(-2, 2));
    const launch = q < 0.35 ? rand(-6, 6) : 8 + 24 * q + rand(-4, 4);
    // steep curve: only swings within ~20 ms of perfect carry the fence
    const ft = Math.round(clamp(150 + 330 * Math.pow(q, 1.6) + rand(-14, 14), 40, 490) * (q < 0.35 ? 0.45 : 1));
    const homer = !foul && ft > fenceFt(spray);

    const from = ball.position.clone();
    const dist = ft * FT;
    hit = {
      from, dir: sprayDir(spray), dist,
      peak: Math.max(0.4, (dist * Math.tan((Math.max(launch, 2) * Math.PI) / 180)) / 4),
      start: clock, dur: 1 + Math.min(dist / 55, 2.6), ground: launch < 8,
    };
    state = 'flight';
    ui.pitch.textContent = '';

    if (homer) {
      homers += 1;
      if (homers > best) { best = homers; saveBest(best); }
      hud();
      hit.result = () => call('Home run.', `${ft} ft · ${ev} mph`, true);
    } else if (foul) {
      hit.result = () => out('Foul ball.', `${OUTS - outs - 1} outs left`);
    } else if (q < 0.35) {
      hit.result = () => out('Ground out.', `${ev} mph off the bat`);
    } else if (ft > fenceFt(spray) - 35) {
      hit.result = () => out('Caught at the wall.', `${ft} ft · so close`);
    } else {
      hit.result = () => out('Fly out.', `${ft} ft`);
    }
    return true;
  }

  /* ---------- input ---------- */
  const onKey = (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (!root.offsetParent) return; // derby isn't on screen
    if (state === 'idle' || state === 'over') return; // let Space press the Play button
    e.preventDefault(); // don't scroll the page
    if (!e.repeat) trySwing(e);
  };
  const onPointer = (e) => {
    if (e.target.closest('button')) return;
    if (state === 'idle' || state === 'over') return;
    e.preventDefault();
    trySwing(e);
  };
  window.addEventListener('keydown', onKey);
  stage.addEventListener('pointerdown', onPointer);
  ui.start.addEventListener('click', newGame);

  /* ---------- loop ---------- */
  let raf = 0, last = 0, running = false;
  const tmp = new THREE.Vector3();
  let batAngle = -2.2; // radians around y: cocked behind the hitter

  function frame(now) {
    raf = requestAnimationFrame(frame);
    // keep game time locked to real time so swing timing is fair even on slow frames;
    // the loop is stopped while the tab is hidden, so long gaps don't happen
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    clock += dt;

    if (state === 'windup' && clock >= nextAt) throwPitch();

    if (state === 'pitch') {
      const u = (clock - pitch.start) / pitch.T;
      pitchPos(u, ball.position);
      body.rotation.x -= dt * 40;
      if (swing && clock >= swing.at + SWING_TO_CONTACT && !swing.judged) {
        swing.judged = true;
        resolveContact();
      }
      if (state === 'pitch' && u > 1.12) {
        ball.visible = false;
        shadow.visible = false;
        if (swing) out('Swing and a miss.', swing.at + SWING_TO_CONTACT < pitch.start + pitch.T ? 'A little early' : 'A little late');
        else out('Strike.', 'Every pitch counts — swing!');
        endPlay();
      }
    }

    if (state === 'flight') {
      const s = Math.min(1, (clock - hit.start) / hit.dur);
      const e = 1 - Math.pow(1 - s, 1.6); // slows a little as it carries
      ball.position.copy(hit.from).addScaledVector(hit.dir, hit.dist * e);
      ball.position.y = hit.ground
        ? Math.max(BALL_R, hit.from.y * (1 - s) + Math.abs(Math.sin(s * Math.PI * 3)) * 0.4 * (1 - s))
        : hit.from.y * (1 - s) + hit.peak * 4 * s * (1 - s);
      body.rotation.x += dt * 25;
      pushTrail(ball.position);
      if (s >= 1) { hit.result(); endPlay(); }
    }

    if (state === 'result' && clock >= resultUntil) {
      clearCall();
      if (outs >= OUTS) {
        state = 'over';
        ui.overlay.innerHTML =
          `<h2>${homers} home run${homers === 1 ? '' : 's'}.</h2>` +
          `<p>${homers && homers >= best ? 'A new personal best.' : `Your best is ${best}.`}</p>` +
          '<button type="button" class="btn" data-start>Play again</button>';
        ui.overlay.hidden = false;
        ui.overlay.querySelector('[data-start]').addEventListener('click', newGame);
      } else {
        queuePitch();
      }
    }

    // bat: cocked -> through the zone -> follow-through, then back
    let target = -2.2;
    if (swing) {
      const k = (clock - swing.at) / SWING_TO_CONTACT; // 1 at contact
      target = k < 1 ? -2.2 + 2.2 * k : Math.min(2.7, (k - 1) * 0.9);
      batAngle = target;
    } else {
      batAngle = damp(batAngle, target, 6, dt);
    }
    bat.rotation.y = batAngle;
    // barrel up over the shoulder while waiting, flattening out as it swings through
    bat.userData.tilt.rotation.z = 0.25 + 0.95 * clamp(-batAngle / 2.2, 0, 1);

    // shadow under the ball helps judge depth
    if (ball.visible) {
      shadow.position.x = ball.position.x;
      shadow.position.z = ball.position.z;
      shadow.scale.setScalar(BALL_R * clamp(1.4 - ball.position.y * 0.02, 0.6, 1.4));
    }

    // camera follows the ball in flight, then settles back behind the plate
    const following = state === 'flight' || (state === 'result' && hit);
    tmp.copy(following ? ball.position : LOOK_HOME);
    if (following) { tmp.lerp(LOOK_HOME, 0.45); tmp.y = Math.min(tmp.y, 6); } // keep some field in view
    look.x = damp(look.x, tmp.x, 3, dt);
    look.y = damp(look.y, tmp.y, 3, dt);
    look.z = damp(look.z, tmp.z, 3, dt);
    camera.position.y = damp(camera.position.y, following ? 3.2 : CAM_HOME.y, 2, dt);
    camera.lookAt(look);

    renderer.render(scene, camera);
  }

  return {
    start() {
      if (running) return;
      running = true;
      resize();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    // for automated tests: when the current pitch reaches the plate, in page time (ms)
    debug: () => ({ state, outs, homers, arrives: pitch ? last + (pitch.start + pitch.T - clock) * 1000 : null }),
  };
}
