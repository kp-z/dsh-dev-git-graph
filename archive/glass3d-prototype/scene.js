/* Prototype scene: round and square glass solids that behave as rigid bodies.
 *
 * This file is inlined into the generated demo page, where the three.js exports
 * (WebGLRenderer, MeshPhysicalMaterial, ...) and the physics helpers from
 * physics.mjs (makeCircle, makeBox, step, extent) already share one module
 * scope. It has no imports on purpose.
 *
 * The point of the prototype is to judge two things at once: whether real
 * refractive glass solids read as "expensive", and whether they can sit behind
 * a text UI without ruining reading. The exposure and scrim controls exist for
 * that second question.
 */

const canvas = document.getElementById('glass3d');
diag('start · canvas ' + canvas.width + 'x' + canvas.height);

let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  diag('RENDERER FAILED · ' + err.message);
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.toneMapping = ACESFilmicToneMapping;
diag('renderer ok · webgl2=' + renderer.capabilities.isWebGL2
  + ' float=' + renderer.extensions.has('EXT_color_buffer_float')
  + ' half=' + renderer.extensions.has('EXT_color_buffer_half_float'));

const scene = new Scene();
const camera = new PerspectiveCamera(40, 1, 0.1, 400);

// The three classes the factories in geometry.mjs need, pulled out of the
// enclosing module scope where the vendored build declared them.
const T = { Shape, ExtrudeGeometry, SphereGeometry, MeshPhysicalMaterial, Color };

/* ── what the glass has to refract ──────────────────────────────────────── */

function backdropTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 576;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1226';
  g.fillRect(0, 0, c.width, c.height);
  // Glass is only visible if there is light behind it to bend, so the backdrop
  // is deliberately bright and saturated — the same four hues the skin uses,
  // plus a pale core for the glass to catch.
  const blobs = [
    ['rgba(0,140,255,0.95)', 0.20, 0.26, 0.44],
    ['rgba(90,205,255,0.90)', 0.78, 0.20, 0.36],
    ['rgba(112,112,255,0.92)', 0.66, 0.80, 0.42],
    ['rgba(215,120,255,0.88)', 0.14, 0.84, 0.34],
    ['rgba(255,255,255,0.50)', 0.50, 0.48, 0.24],
  ];
  for (const [color, cx, cy, r] of blobs) {
    const grad = g.createRadialGradient(cx * c.width, cy * c.height, 0, cx * c.width, cy * c.height, r * c.width);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
  }

  // Soft gradients refract into nothing you can see. Hard edges are what make
  // glass legible: the eye reads the distortion only where there was an edge.
  g.globalAlpha = 0.85;
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i % 2 ? '#eaf4ff' : '#0a1030';
    g.fillRect(0, 40 + i * 74, c.width, 7);
  }
  g.globalAlpha = 0.9;
  const bars = [
    ['#7fe3ff', 70, 90, 210, 300],
    ['#b98bff', 700, 60, 260, 250],
    ['#4d7cff', 430, 300, 300, 220],
    ['#ff8ae0', 120, 330, 200, 190],
  ];
  for (const [color, x, y, w, h] of bars) {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  }
  g.globalAlpha = 1;
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const backdrop = new Mesh(
  new PlaneGeometry(150, 86),
  new MeshBasicMaterial({ map: backdropTexture(), toneMapped: false }),
);
backdrop.position.z = -10;
scene.add(backdrop);

// A tiny emissive room, baked to a PMREM, gives the glass its reflection and
// the coloured edges that make transmission read as glass rather than as fog.
const pmrem = new PMREMGenerator(renderer);

function buildEnvironment() {
  const env = new Scene();
  env.add(new Mesh(new BoxGeometry(300, 300, 300), new MeshBasicMaterial({ color: 0x0a1020, side: BackSide })));
  // Values above 1 survive into the half-float PMREM, which is what gives the
  // glass bright specular rims rather than a dull outline.
  const panel = (hex, x, y, z, size, gain) => {
    const panelMesh = new Mesh(
      new PlaneGeometry(size, size),
      new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(gain) }),
    );
    panelMesh.position.set(x, y, z);
    panelMesh.lookAt(0, 0, 0);
    env.add(panelMesh);
  };
  panel(0x1e6bff, -26, 12, -20, 46, 2.4);
  panel(0x5ad0ff, 22, -14, -22, 40, 2.4);
  panel(0x6f6cff, 28, 16, 10, 36, 2.2);
  panel(0xd07bff, -28, -16, 12, 34, 2.2);
  panel(0xffffff, 8, 22, 18, 20, 3.0);
  return pmrem.fromScene(env, 0.02).texture;
}

scene.environment = buildEnvironment();
diag('environment ok');
scene.add(new AmbientLight(0x1b2740, 1.4));
const keyLight = new PointLight(0x9ad8ff, 260, 160);
keyLight.position.set(-18, 16, 20);
scene.add(keyLight);
const rimLight = new PointLight(0xd08bff, 190, 160);
rimLight.position.set(20, -13, 14);
scene.add(rimLight);

/* ── the glass ─────────────────────────────────────────────────────────── */

const bodies = SPECS.map((spec, i) => {
  const body = spec.kind === 'circle'
    ? makeCircle({ x: spec.x, y: spec.y, r: spec.r, vx: spec.vx, vy: spec.vy, w: spec.w, restitution: 0.94, friction: 0.12 })
    : makeBox({ x: spec.x, y: spec.y, hw: spec.hw, hh: spec.hh, vx: spec.vx, vy: spec.vy, angle: spec.angle || 0, w: spec.w, restitution: 0.94, friction: 0.12 });
  const mesh = new Mesh(geometryFor(T, spec), glassMaterial(T, spec.tint));
  // Stagger the depth so the group reads as a volume, not a flat plane.
  body.z = -1.4 + (i % 3) * 1.5;
  body.tiltX = spec.tilt[0];
  body.tiltY = spec.tilt[1];
  body.mesh = mesh;
  scene.add(mesh);
  return body;
});

/* ── frame loop ────────────────────────────────────────────────────────── */

let paused = false;
let speed = 1;
let scrim = 0.18;
let last = performance.now();
let frames = 0;
diag('bodies built · ' + bodies.length);

function fitCamera(aspect) {
  const halfH = (DOMAIN.maxY - DOMAIN.minY) / 2;
  const halfW = (DOMAIN.maxX - DOMAIN.minX) / 2;
  const t = Math.tan(((camera.fov * Math.PI) / 180) / 2);
  camera.aspect = aspect;
  camera.position.set(0, 0, Math.max(halfH / t, halfW / (t * aspect)) * 1.03);
  camera.updateProjectionMatrix();
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  fitCamera(window.innerWidth / window.innerHeight);
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  if (!paused && !document.hidden) step(bodies, dt * speed, DOMAIN);
  for (const body of bodies) {
    body.mesh.position.set(body.x, body.y, body.z);
    body.mesh.rotation.set(body.tiltX, body.tiltY, body.angle);
  }
  try {
    renderer.render(scene, camera);
  } catch (err) {
    if (frames === 0) diag('RENDER THREW · ' + err.message);
    throw err;
  }
  frames += 1;
  if (frames === 1) {
    const gl = renderer.getContext();
    diag('frame 1 ok · draw calls ' + renderer.info.render.calls
      + ' tris ' + renderer.info.render.triangles
      + ' glError ' + gl.getError());
  }
  requestAnimationFrame(frame);
}

/* ── controls ──────────────────────────────────────────────────────────── */

const ui = document.getElementById('ui');
const scrimLayer = document.getElementById('scrim');
const pauseButton = document.getElementById('toggle-pause');
const uiButton = document.getElementById('toggle-ui');

function setScrim(value) {
  scrim = value;
  // A scrim is the honest lever here: it buys legibility back by dimming the
  // glass, without touching the glass itself.
  scrimLayer.style.opacity = String(scrim);
}
function setPaused(value) {
  paused = value;
  pauseButton.textContent = paused ? '继续' : '暂停';
  pauseButton.setAttribute('aria-pressed', String(paused));
}
function setUiVisible(value) {
  ui.hidden = !value;
  uiButton.textContent = value ? '隐藏界面' : '显示界面';
  uiButton.setAttribute('aria-pressed', String(value));
}

pauseButton.addEventListener('click', () => setPaused(!paused));
uiButton.addEventListener('click', () => setUiVisible(ui.hidden));
document.getElementById('exposure').addEventListener('input', (e) => {
  renderer.toneMappingExposure = Number(e.target.value);
  document.getElementById('exposure-value').textContent = Number(e.target.value).toFixed(2);
});
document.getElementById('scrim-range').addEventListener('input', (e) => {
  setScrim(Number(e.target.value));
  document.getElementById('scrim-value').textContent = Number(e.target.value).toFixed(2);
});
document.getElementById('speed').addEventListener('input', (e) => {
  speed = Number(e.target.value);
  document.getElementById('speed-value').textContent = Number(e.target.value).toFixed(2) + 'x';
});
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { last = performance.now(); });

renderer.toneMappingExposure = 1.5;
setScrim(scrim);
setUiVisible(true);
resize();
setPaused(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
requestAnimationFrame(frame);
