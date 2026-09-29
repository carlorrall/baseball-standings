import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const R = 1; // ball radius (scene units)

/* ------------------------------------------------------------------ *
 *  Procedural noise — used to bake a clean, slightly imperfect leather
 * ------------------------------------------------------------------ */
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
// frame-rate independent ease towards a target
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  return lerp(
    lerp(lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    lerp(lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w
  );
}

// Seamless colour map: sampled in 3D so there is no UV seam or pole pinching.
function makeLeatherColor(w = 1024, h = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const theta = ((y + 0.5) / h) * Math.PI;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    for (let x = 0; x < w; x++) {
      const phi = ((x + 0.5) / w) * Math.PI * 2;
      const dx = -Math.cos(phi) * sinT, dy = cosT, dz = Math.sin(phi) * sinT;
      const tone =
        noise3(dx * 1.6 + 11, dy * 1.6, dz * 1.6) * 0.6 +
        noise3(dx * 3.7, dy * 3.7 + 5, dz * 3.7) * 0.3 +
        noise3(dx * 8.1, dy * 8.1, dz * 8.1 + 9) * 0.1;
      const scuff = smoothstep(0.6, 0.92, noise3(dx * 5.5 + 40, dy * 5.5, dz * 5.5));
      const fibre = noise3(dx * 90, dy * 90, dz * 90);
      const k = 1 + (tone - 0.5) * 0.03 - scuff * 0.02 - (fibre - 0.5) * 0.02;
      const i = (y * w + x) * 4;
      d[i] = Math.min(255, 247 * k);
      d[i + 1] = Math.min(255, 245 * k);
      d[i + 2] = Math.min(255, 240 * k);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Tileable fine-grain bump so the leather catches the light.
function makeGrainBump(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const pn = (u, v, p, seed) => {
    const x = u * p, y = v * p;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = fade(x - xi), fy = fade(y - yi);
    const m = (n) => ((n % p) + p) % p;
    const a = hash3(m(xi), m(yi), seed), b = hash3(m(xi + 1), m(yi), seed);
    const c = hash3(m(xi), m(yi + 1), seed), e = hash3(m(xi + 1), m(yi + 1), seed);
    return lerp(lerp(a, b, fx), lerp(c, e, fx), fy);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const crease = 1 - Math.abs(pn(u, v, 24, 3) * 2 - 1);
      const pebble = pn(u, v, 48, 7) * 0.65 + pn(u, v, 96, 9) * 0.35;
      const h = crease * 0.3 + pebble * 0.7;
      const g = Math.max(0, Math.min(255, h * 255));
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = g;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 5);
  tex.anisotropy = 8;
  return tex;
}

/* ------------------------------------------------------------------ *
 *  Seam + stitches
 *  The classic baseball / tennis-ball curve, projected onto the sphere.
 * ------------------------------------------------------------------ */
const SEAM_C = 0.34;       // shape of the curve (higher = wigglier)
const STITCH_COUNT = 108;  // a real baseball has 108 double stitches
const STITCH_HALF_W = 0.092; // distance from seam centre to the outer holes
const STITCH_LEAD = 0.088;   // how far along the seam the V's apex sits

function seamRaw(t) {
  const b = 1, c = SEAM_C;
  return new THREE.Vector3(
    b * Math.cos(t) + c * Math.cos(3 * t),
    b * Math.sin(t) - c * Math.sin(3 * t),
    2 * Math.sqrt(b * c) * Math.sin(2 * t)
  ).normalize();
}

function buildSeamFrame() {
  const M = 4000;
  const t = new Float32Array(M + 1);
  const cum = new Float32Array(M + 1);
  let prev = seamRaw(0), total = 0;
  for (let i = 1; i <= M; i++) {
    t[i] = (i / M) * Math.PI * 2;
    const p = seamRaw(t[i]);
    total += p.distanceTo(prev);
    cum[i] = total;
    prev = p;
  }
  // arc-length -> point, tangent and sideways direction
  const at = (s) => {
    s = ((s % total) + total) % total;
    let lo = 0, hi = M;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const f = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const tt = lerp(t[lo], t[hi], f);
    const p = seamRaw(tt);
    const tan = seamRaw(tt + 0.001).sub(seamRaw(tt - 0.001)).normalize();
    const side = new THREE.Vector3().crossVectors(p, tan).normalize();
    return { p, tan, side };
  };
  return { total, at };
}

function buildSeamMeshes(redMat, ridgeMat, holeMat) {
  const { total, at } = buildSeamFrame();
  const group = new THREE.Group();

  // raised ridge where the two leather pieces meet
  const ridgePts = [];
  for (let i = 0; i < 720; i++) ridgePts.push(at((i / 720) * total).p.clone().multiplyScalar(R - 0.006));
  const ridge = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ridgePts, true), 1400, 0.024, 16, true);
  group.add(new THREE.Mesh(ridge, ridgeMat));

  // Each stitch = two threads leaving outer holes on either side of the seam
  // and meeting on the centre line, forming the nested "V" you see on a real ball.
  const step = total / STITCH_COUNT;
  const holes = [];
  const threads = [];
  const thread = (a, b) => {
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const f = k / 16;
      const e = Math.sin((f * Math.PI) / 2); // rises out of the hole, lies flat over the seam
      const r = R + 0.004 + 0.018 * e;
      pts.push(a.clone().lerp(b, f).normalize().multiplyScalar(r));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0135, 12, false);
  };
  for (let i = 0; i < STITCH_COUNT; i++) {
    const s = i * step;
    const { p, side } = at(s);
    const left = p.clone().addScaledVector(side, -STITCH_HALF_W).normalize();
    const right = p.clone().addScaledVector(side, STITCH_HALF_W).normalize();
    const apex = at(s + STITCH_LEAD).p.clone();
    threads.push(thread(left, apex), thread(right, apex));
    holes.push(left, right);
  }
  group.add(new THREE.Mesh(mergeGeometries(threads), redMat));

  // tiny dark holes where the thread enters the leather
  const holeGeos = holes.map((h) => {
    const g = new THREE.SphereGeometry(0.0145, 16, 12);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(...h.clone().multiplyScalar(R - 0.006).toArray()));
    return g;
  });
  group.add(new THREE.Mesh(mergeGeometries(holeGeos), holeMat));

  return group;
}

/* ------------------------------------------------------------------ *
 *  Scene
 * ------------------------------------------------------------------ */
export function createBall(container, { onOpen } = {}) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  // render a little above device resolution so the silhouette and stitches stay smooth
  renderer.setPixelRatio(Math.min(2, Math.max(1.5, window.devicePixelRatio || 1)));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.38;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 0.9, 7);
  camera.lookAt(0, -0.05, 0);

  const key = new THREE.DirectionalLight(0xfffaf2, 3.3);
  key.position.set(-4.5, 4.5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe6eeff, 0.55);
  rim.position.set(4, 1.5, -3);
  scene.add(rim);

  // materials
  const leather = new THREE.MeshPhysicalMaterial({
    map: makeLeatherColor(),
    bumpMap: makeGrainBump(),
    bumpScale: 0.2,
    roughness: 0.66,
    metalness: 0,
    sheen: 0.22,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xfff6e8),
  });
  const thread = new THREE.MeshStandardMaterial({ color: 0xa11f2b, roughness: 0.78, metalness: 0 });
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0xeae6dc, roughness: 0.8 });
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x7a2a2a, roughness: 0.9 });

  // ball = tilted group -> spinning body
  const tilt = new THREE.Group();
  tilt.rotation.set(0.32, 0, -0.42);
  const body = new THREE.Group();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 192, 128), leather);
  body.add(sphere);
  body.add(buildSeamMeshes(thread, ridgeMat, holeMat));
  tilt.add(body);
  const float = new THREE.Group();
  float.add(tilt);
  scene.add(float);

  // soft contact shadow on an invisible floor
  const sc = document.createElement('canvas');
  sc.width = sc.height = 256;
  const sx = sc.getContext('2d');
  const grd = sx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(40,30,20,0.55)');
  grd.addColorStop(0.45, 'rgba(40,30,20,0.22)');
  grd.addColorStop(1, 'rgba(40,30,20,0)');
  sx.fillStyle = grd; sx.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.7, 2.7),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.5;
  scene.add(shadow);

  /* ---------- sizing ---------- */
  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    const frac = w / h >= 1 ? 0.62 : 0.74; // how much of the short side the ball fills
    const visibleShort = 2 / frac;
    const visibleH = w / h >= 1 ? visibleShort : visibleShort / camera.aspect;
    camera.position.z = visibleH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  /* ---------- interaction ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pointer = { x: 0, y: 0, inside: false };
  let hovering = false;
  let spinBoost = 0, spinBoostTarget = 0;
  let scaleTarget = 1, scale = 1;
  let launching = false;

  const hitTest = (clientX, clientY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(sphere, false).length > 0;
  };

  const onMove = (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    pointer.inside = true;
    if (launching) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (hit !== hovering) {
      hovering = hit;
      container.style.cursor = hit ? 'pointer' : 'default';
      spinBoostTarget = hit ? 1 : 0;
      scaleTarget = hit ? 1.045 : 1;
    }
  };
  const onLeave = () => {
    pointer.inside = false; hovering = false;
    container.style.cursor = 'default';
    spinBoostTarget = 0; scaleTarget = 1;
  };
  const onClick = (e) => { if (!launching && hitTest(e.clientX, e.clientY)) open(); };
  const onKey = (e) => { if ((e.key === 'Enter' || e.key === ' ') && !launching) { e.preventDefault(); open(); } };

  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerleave', onLeave);
  container.addEventListener('click', onClick);
  container.addEventListener('keydown', onKey);

  function open() {
    launching = true;
    spinBoostTarget = 6;
    scaleTarget = 1.5;
    container.classList.add('is-launching');
    setTimeout(() => onOpen && onOpen(), 620);
  }

  function reset() {
    launching = false; hovering = false;
    spinBoostTarget = 0; scaleTarget = 1; scale = 1.5; spinBoost = 3;
    container.classList.remove('is-launching');
  }

  /* ---------- loop ---------- */
  let last = performance.now();
  let raf = 0, running = false, time = 0;

  function frame() {
    raf = requestAnimationFrame(frame);
    const nowT = performance.now();
    const dt = Math.min((nowT - last) / 1000, 0.05);
    last = nowT;
    time += dt;

    spinBoost = damp(spinBoost, spinBoostTarget, launching ? 3 : 2.2, dt);
    scale = damp(scale, scaleTarget, launching ? 4 : 6, dt);

    const base = reduceMotion ? 0.18 : 0.62;
    body.rotation.y += dt * (base + spinBoost * 0.9);

    // gentle float + pointer parallax
    const bob = reduceMotion ? 0 : Math.sin(time * 1.15) * 0.05;
    float.position.y = bob;
    float.rotation.y = damp(float.rotation.y, pointer.inside ? pointer.x * 0.25 : 0, 2, dt);
    float.rotation.x = damp(float.rotation.x, pointer.inside ? pointer.y * 0.12 : 0, 2, dt);
    float.scale.setScalar(scale);

    const lift = 1 - bob * 2.2;
    shadow.scale.setScalar(scale * (1 + (0.05 - bob) * 1.2));
    shadow.material.opacity = Math.max(0, 1 - (scale - 1) * 1.4) * (0.9 + (lift - 1) * 0.6);

    renderer.render(scene, camera);
  }

  function start() { if (running) return; running = true; last = performance.now(); frame(); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  return {
    start, stop, reset, resize,
    get canvas() { return renderer.domElement; },
    renderOnce: () => renderer.render(scene, camera),
    dispose() {
      stop(); ro.disconnect();
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('click', onClick);
      container.removeEventListener('keydown', onKey);
      renderer.dispose();
    },
  };
}
