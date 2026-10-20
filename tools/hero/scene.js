// Escena del hero de RUKC (v2): semáforo, kart, lastre, dos categorías, mapa de Málaga, ocho rondas, pista y escudo.
// Todo el estado es una función pura de t (0..1): window.renderFrame(t) dibuja ese instante y devuelve
// la posición en pantalla (0..1) de los puntos de anclaje que usa la web para colocar los textos.
// Parámetros de URL: w, h (tamaño del lienzo). Si h > w se usa el encuadre vertical (móvil).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { buildKart } from './kart.js';

const q = new URLSearchParams(location.search);
const W = +q.get('w') || 1600;
const H = +q.get('h') || 900;
const PORTRAIT = H > W;
const pick = (desktop, portrait) => (PORTRAIT ? portrait : desktop);

// ---------- guion (t de 0 a 1) ----------
// render.mjs copia estos valores al manifest: los textos de la web usan los mismos tiempos.
export const CUES = {
  intro: [0, 0.04],
  lights: [0.045, 0.065, 0.085, 0.105, 0.125],
  green: 0.15,
  engine: [0.24, 0.33],
  belt: [0.345, 0.43],
  cats: [0.47, 0.56],
  rise: [0.56, 0.66],
  pins: [0.665, 0.75],
  rounds: [0.76, 0.86],
  dive: [0.865, 0.905],
  fly: [0.905, 0.945],
  crest: [0.94, 0.99],
};
window.CUES = CUES;

// ---------- utilidades ----------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const lerp = (a, b, x) => a + (b - a) * x;
const pulse = (t, a, b) => Math.sin(Math.PI * seg(t, a, b)); // 0 → 1 → 0 dentro del tramo
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(20261017);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const BG = new THREE.Color(0x0a0a0b);
const scene = new THREE.Scene();
scene.background = BG;
const FOG = pick(0.018, 0.02);
scene.fog = new THREE.FogExp2(BG, FOG);
const camera = new THREE.PerspectiveCamera(pick(35, 50), W / H, 0.05, 90000);

// ---------- texturas ----------
function asphaltTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); const img = g.createImageData(256, 256); const r = rng(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 22 + r() * 16 + (r() > 0.985 ? 40 : 0);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 2; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function radialTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  // Caída suave en varios tramos para que el halo no deje un borde visible
  const a = (k) => inner.replace(/[\d.]+\)$/, `${k})`);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, a(0.55)); gr.addColorStop(0.55, a(0.14)); gr.addColorStop(0.8, a(0.03)); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
const asphalt = asphaltTexture();
const glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');

// ---------- luz ----------
const hemi = new THREE.HemisphereLight(0x2a2c33, 0x060606, 0.6); scene.add(hemi);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const ENV = 0.3;
scene.environmentIntensity = ENV;
const key = new THREE.DirectionalLight(0xffe2b8, 1.6); key.position.set(-7, 11, 9); scene.add(key);
const rim = new THREE.DirectionalLight(0x7d93b5, 0.7); rim.position.set(9, 6, -8); scene.add(rim);
// Foco que acompaña a los karts (se recoloca cada frame)
const spot = new THREE.SpotLight(0xffe6c4, 70, 30, 0.55, 0.6, 1.6); scene.add(spot, spot.target);

// ---------- circuito ----------
const world = new THREE.Group(); scene.add(world);
const groundTex = asphalt.clone(); groundTex.repeat.set(90, 90); groundTex.needsUpdate = true;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800),
  new THREE.MeshStandardMaterial({ color: 0x0e0e10, map: groundTex, roughness: 0.75, metalness: 0.05, envMapIntensity: 0, transparent: true }));
ground.rotation.x = -Math.PI / 2; ground.position.z = -150; ground.renderOrder = -1; world.add(ground); // se pinta antes que el escudo

const curve = new THREE.CatmullRomCurve3([
  V(0, 0, 20), V(0, 0, 0), V(0, 0, -28), V(7, 0, -58), V(17, 0, -84), V(11, 0, -114), V(-8, 0, -140),
  V(-15, 0, -170), V(-5, 0, -200), V(5, 0, -230), V(4, 0, -262),
], false, 'centripetal');
const TRACK_LEN = curve.getLength();
function along(s, lateral = 0) {
  const u = clamp01(s / TRACK_LEN); const pos = curve.getPointAt(u);
  const tg = curve.getTangentAt(u); const side = new THREE.Vector3().crossVectors(tg, UP).normalize();
  return { pos: pos.addScaledVector(side, lateral), tg, side };
}

function ribbon(offsetA, offsetB, y, samples, material) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples; const p = curve.getPointAt(u); const tg = curve.getTangentAt(u);
    const side = new THREE.Vector3().crossVectors(tg, UP).normalize();
    const a = p.clone().addScaledVector(side, offsetA); const b = p.clone().addScaledVector(side, offsetB);
    pos.push(a.x, y, a.z, b.x, y, b.z); uv.push(0, u * 60, 1, u * 60);
    if (i < samples) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); world.add(m); return m;
}
const trackTex = asphalt.clone(); trackTex.repeat.set(4, 1); trackTex.needsUpdate = true;
ribbon(-4.2, 4.2, 0.01, 700, new THREE.MeshStandardMaterial({ color: 0x1a1a1e, map: trackTex, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.3, side: THREE.DoubleSide }));
const lineMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.6, emissive: 0x777777, emissiveIntensity: 0.25, side: THREE.DoubleSide });
ribbon(-4.0, -3.82, 0.02, 700, lineMat);
ribbon(3.82, 4.0, 0.02, 700, lineMat);
{ // pianos en el interior de las curvas
  const red = new THREE.MeshStandardMaterial({ color: 0xc8100e, roughness: 0.5, emissive: 0x600000, emissiveIntensity: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 });
  const box = new THREE.BoxGeometry(1.1, 0.07, 0.8); const N = 520; let n = 0;
  for (let i = 1; i < N; i++) {
    const u = i / N; const t1 = curve.getTangentAt(Math.max(0, u - 0.004)); const t2 = curve.getTangentAt(Math.min(1, u + 0.004));
    const turn = t1.x * t2.z - t1.z * t2.x; if (Math.abs(turn) < 0.0016) continue;
    const p = curve.getPointAt(u); const tg = curve.getTangentAt(u); const side = new THREE.Vector3().crossVectors(tg, UP).normalize();
    const k = new THREE.Mesh(box, n++ % 2 ? white : red);
    k.position.copy(p).addScaledVector(side, (turn > 0 ? 1 : -1) * 4.55); k.position.y = 0.035;
    k.rotation.y = Math.atan2(tg.x, tg.z) + Math.PI / 2; world.add(k);
  }
}
{ // línea de salida a cuadros y casillas de parrilla
  const c = document.createElement('canvas'); c.width = 320; c.height = 32; const g = c.getContext('2d');
  for (let x = 0; x < 20; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#a9a9a9'; g.fillRect(x * 16, y * 16, 16, 16); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  m.rotation.x = -Math.PI / 2; m.position.set(0, 0.025, 0.6); world.add(m);
  const slot = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.6 });
  for (const [x, z] of [[-1.4, 7.4], [1.6, 11.4], [-1.4, 15.4]]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.08), slot); a.position.set(x, 0.02, z); world.add(a);
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.6), slot); b.position.set(x + s * 0.71, 0.02, z + 0.3); world.add(b); }
  }
}

// ---------- pórtico de salida ----------
const SP = 1.36, GY = 4.7;
const gantry = new THREE.Group(); world.add(gantry);
const metal = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.32, metalness: 0.85 });
const metalDark = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.5, metalness: 0.6 });
const beamW = 11.2;
{ const beam = new THREE.Mesh(new THREE.BoxGeometry(beamW, 0.5, 0.55), metal); beam.position.set(0, GY + 1.33, -0.05); gantry.add(beam); }
{ const back = new THREE.Mesh(new THREE.BoxGeometry(SP * 5 + 0.3, 2.4, 0.2), metalDark); back.position.set(0, GY, -0.3); gantry.add(back); }
for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.38, GY + 1.6, 0.38), metal); post.position.set(s * (beamW / 2 - 0.2), (GY + 1.6) / 2, -0.05); gantry.add(post); }
const lampMats = [], lampLights = [], lampGlows = [];
const RED = new THREE.Color(0xff1a0a), GREEN = new THREE.Color(0x14ff4e);
for (let i = 0; i < 5; i++) {
  const x = (i - 2) * SP;
  const pod = new THREE.Mesh(new THREE.BoxGeometry(SP * 0.8, 2.15, 0.55), metal); pod.position.set(x, GY, 0); gantry.add(pod);
  const mat = new THREE.MeshStandardMaterial({ color: 0x120202, emissive: RED.clone(), emissiveIntensity: 0, roughness: 0.6, envMapIntensity: 0.05 });
  lampMats.push(mat);
  for (const dy of [0.5, -0.5]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.33, 48), mat); lamp.position.set(x, GY + dy, 0.281); gantry.add(lamp);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.41, 48), metalDark); ring.position.set(x, GY + dy, 0.282); gantry.add(ring);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.36, 32, 1, true, Math.PI / 2, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide }));
    visor.rotation.x = Math.PI / 2; visor.position.set(x, GY + dy, 0.46); gantry.add(visor);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff3020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.7); glow.position.set(x, GY + dy, 0.5); gantry.add(glow); lampGlows.push({ glow, i });
  }
  const pl = new THREE.PointLight(0xff2210, 0, 14, 2); pl.position.set(x, GY, 1.2); gantry.add(pl); lampLights.push(pl);
}

// ---------- karts ----------
const kartA = buildKart({ number: '07', helmet: 0xd4a62a, build: 1 });
const kartB = buildKart({ number: '18', helmet: 0xc40a0a, build: 1.12 });
world.add(kartA.group, kartB.group);
const LANE_A = -1.4, LANE_B = 1.6, GRID_S = 14; // la casilla de salida está en z = 6
// Distancia recorrida: parado hasta el verde, acelera y luego rueda a ritmo constante
const sA = (t) => GRID_S + (t < CUES.green ? 0 : 22 * Math.pow(seg(t, CUES.green, CUES.engine[0]), 2) + 48 * seg(t, CUES.engine[0], CUES.rise[0]));
// El kart B llega desde atrás y se pone en paralelo
const sB = (t) => sA(t) - 0.5 - 30 * (1 - easeOutCubic(seg(t, CUES.belt[1], CUES.cats[0] + 0.04)));
function placeKart(k, s, lane) {
  const { pos, tg } = along(s, lane);
  k.group.position.copy(pos);
  k.group.lookAt(pos.clone().add(tg));
  for (const w of k.wheels) w.g.rotation.x = (s - GRID_S) / w.r;
}
const toWorld = (k, local) => k.group.localToWorld(local.clone());

// ---------- trazada dorada y partículas (vuelo final) ----------
const GOLD = new THREE.Color(0xf2c14e);
const racing = new THREE.Mesh(
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve.getSpacedPoints(900).map((p) => p.setY(0.06))), 1600, 0.075, 6, false),
  new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(1.6) }));
world.add(racing);
const RACING_COUNT = racing.geometry.index.count;
const tip = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd36a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
tip.scale.setScalar(1.6); world.add(tip);
const dust = (() => {
  const n = 700, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = (rand() - 0.5) * 18; a[i * 3 + 1] = rand() * 10; a[i * 3 + 2] = -10 + rand() * 30; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd8a0, size: 0.035, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  world.add(p); return p;
})();
const streaks = (() => {
  const n = 1100, a = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const u = 0.03 + rand() * 0.97; const p = curve.getPointAt(u); const tg = curve.getTangentAt(u);
    const side = new THREE.Vector3().crossVectors(tg, UP).normalize();
    const lateral = (rand() < 0.5 ? -1 : 1) * (3 + rand() * 9); const y = 0.25 + rand() * 6.5; const len = 2 + rand() * 6;
    const s = p.clone().addScaledVector(side, lateral); s.y = y; const e = s.clone().addScaledVector(tg, len);
    a.set([s.x, s.y, s.z, e.x, e.y, e.z], i * 6);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffdc9a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  world.add(l); return l;
})();

// ---------- mapa de la provincia de Málaga ----------
// Proyección equirectangular local; 1 km = KM unidades. El karting de Mijas cae sobre el circuito 3D,
// así que al alejarse la cámara el circuito se convierte en el punto de Mijas.
const KM = 50;
const LON0 = -4.64, LAT0 = 36.548, ORIGIN = V(6, 0, -56);
const project = (lon, lat, y = 0) => V(
  ORIGIN.x + (lon - LON0) * Math.cos(LAT0 * Math.PI / 180) * 111.32 * KM, y,
  ORIGIN.z - (lat - LAT0) * 110.57 * KM);
const CIRCUITS = [ // ubicación aproximada de cada circuito
  { id: 'mijas', lon: -4.64, lat: 36.548 },
  { id: 'campillos', lon: -4.83, lat: 37.045 },
  { id: 'kfmalaga', lon: -4.475, lat: 36.66 },
  { id: 'delsol', lon: -4.12, lat: 36.735 },
  { id: 'kfestepona', lon: -5.153, lat: 36.432 },
];
const ROUNDS = ['mijas', 'campillos', 'kfmalaga', 'delsol', 'kfmalaga', 'kfestepona', 'mijas', 'campillos'];
const mapGroup = new THREE.Group(); mapGroup.position.y = -0.4; scene.add(mapGroup);
const mapMats = [];
const lineMats = [];
const mapData = await (await fetch('./assets/map.json')).json();
function fatLine(color, width, opacity) {
  const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0, worldUnits: false, depthWrite: false });
  m.resolution.set(W, H); m.userData.max = opacity; lineMats.push(m); return m;
}
for (const [name, polys] of Object.entries(mapData.provinces)) {
  const isMalaga = name === 'Málaga';
  for (const ring of polys) {
    const pts = ring.map(([lon, lat]) => project(lon, lat));
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const fillMat = new THREE.MeshBasicMaterial({ color: isMalaga ? 0x1d1912 : 0x100f0d, transparent: true, opacity: 0, depthWrite: false, fog: false });
    fillMat.userData.max = 1; mapMats.push(fillMat);
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat);
    fill.rotation.x = -Math.PI / 2; fill.position.y = isMalaga ? 0.2 : 0; fill.renderOrder = isMalaga ? 2 : 1; mapGroup.add(fill);
    const lg = new LineGeometry(); lg.setPositions(pts.flatMap((p) => [p.x, isMalaga ? 2 : 1, p.z]));
    const line = new Line2(lg, isMalaga ? fatLine(0xf2c14e, pick(2.6, 2.2), 1) : fatLine(0x4a4335, 1.2, 0.8));
    line.renderOrder = 3; mapGroup.add(line);
  }
}
{ // retícula de fondo
  const pts = []; const b = { x0: -6.4, x1: -3.0, y0: 35.9, y1: 37.7 };
  for (let lon = b.x0; lon <= b.x1 + 1e-6; lon += 0.2) { const a = project(lon, b.y0), c = project(lon, b.y1); pts.push(a.x, -1, a.z, c.x, -1, c.z); }
  for (let lat = b.y0; lat <= b.y1 + 1e-6; lat += 0.18) { const a = project(b.x0, lat), c = project(b.x1, lat); pts.push(a.x, -1, a.z, c.x, -1, c.z); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const m = new THREE.LineBasicMaterial({ color: 0x24211b, transparent: true, opacity: 0, fog: false }); m.userData.max = 0.7; mapMats.push(m);
  mapGroup.add(new THREE.LineSegments(g, m));
}
// Marcadores de circuito: aro en el suelo, haz vertical y punto de luz
const PIN_H = 900;
const pins = {};
CIRCUITS.forEach((c, i) => {
  const base = project(c.lon, c.lat, 3);
  const g = new THREE.Group(); g.position.copy(base); mapGroup.add(g);
  g.renderOrder = 5;
  const ringM = new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(1.5), transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(170, 250, 48), ringM); ring.rotation.x = -Math.PI / 2; ring.renderOrder = 5; g.add(ring);
  const beamM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a14).multiplyScalar(1.4), transparent: true, opacity: 0, fog: false, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, PIN_H, 12, 1, true), beamM); beam.position.y = PIN_H / 2; beam.renderOrder = 5; g.add(beam);
  const dotM = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc04a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const dot = new THREE.Sprite(dotM); dot.scale.setScalar(900); dot.position.y = PIN_H; dot.renderOrder = 6; g.add(dot);
  pins[c.id] = { g, ringM, beamM, dotM, beam, dot, i, base };
});
// Arcos entre rondas consecutivas, que se dibujan en orden
const arcs = [];
for (let i = 0; i < ROUNDS.length - 1; i++) {
  const a = pins[ROUNDS[i]].base.clone().setY(8), b = pins[ROUNDS[i + 1]].base.clone().setY(8);
  const mid = a.clone().lerp(b, 0.5); mid.y = a.distanceTo(b) * 0.28;
  const geo = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 120, 30, 6, false);
  const m = new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(1.5), transparent: true, opacity: 0, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, m); mesh.renderOrder = 6; mapGroup.add(mesh); arcs.push({ mesh, m, count: geo.index.count });
}
const MAP_CENTER = project(-4.69, 36.8);

// ---------- escudo RUKC ----------
const END = curve.getPointAt(1);
const CREST = V(END.x, 6.6, END.z - 30);
const CS = 7;
const crest = new THREE.Group(); crest.position.copy(CREST); scene.add(crest);
const loader = new THREE.TextureLoader();
const sheenMats = [];
function crestPart(name, z) {
  const tex = loader.load(`./assets/crest-${name}.png`); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const pivot = new THREE.Group(); crest.add(pivot);
  const base = new THREE.Mesh(new THREE.PlaneGeometry(CS, CS), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
  base.position.z = z; pivot.add(base);
  const sheen = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, pos: { value: -1 }, amount: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float pos; uniform float amount; varying vec2 vUv;
      void main(){ float a = texture2D(map, vUv).a; float d = abs((vUv.x + (1.0 - vUv.y) * 0.55) - pos);
        float band = smoothstep(0.16, 0.0, d); gl_FragColor = vec4(vec3(1.0, 0.88, 0.6) * band * a * amount, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  sheenMats.push(sheen);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(CS, CS), sheen); s.position.z = z + 0.001; pivot.add(s);
  return { pivot, base };
}
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xd4a62a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
halo.scale.set(CS * 1.5, CS * 1.5, 1); halo.position.z = -0.4; crest.add(halo);
const discFlare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a14, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
discFlare.position.set(0, CS * 0.1177, 0.05); discFlare.scale.setScalar(CS * 0.6); crest.add(discFlare);
const P = { wingL: crestPart('wingL', 0), wingR: crestPart('wingR', 0), crown: crestPart('crown', 0.01), disc: crestPart('disc', 0.02), word: crestPart('word', 0) };

// ---------- post-proceso ----------
const composer = new EffectComposer(renderer);
composer.setPixelRatio(1); composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.72, 0.45, 0.86));
composer.addPass(new OutputPass());
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null }, bg: { value: V(10 / 255, 10 / 255, 11 / 255) }, aspect: { value: W / H } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 bg; uniform float aspect; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 p = (vUv - 0.5) * vec2(aspect > 1.0 ? aspect : 1.0, aspect > 1.0 ? 1.0 : 1.0 / aspect);
      float r = length(p) / (aspect > 1.0 ? aspect * 0.62 : 0.62 / aspect);
      float v = smoothstep(0.55, 1.05, r); gl_FragColor = vec4(mix(c.rgb, bg, v * 0.92), 1.0); }`,
}));

// ---------- cámara ----------
// Fase de karts: claves en coordenadas locales del kart A (F delante, R derecha, U arriba).
// En escritorio el sujeto se desplaza para dejar sitio al titular; en vertical queda abajo y el titular arriba.
const KEYS = pick([
  { t: 0.0, cam: [-7.4, 0.5, 2.0], look: [6, 0, 1.45] },
  { t: 0.14, cam: [-6.6, 0.4, 1.85], look: [6, 0, 1.6] },
  { t: 0.165, cam: [-6.6, 0.4, 1.85], look: [6, 0, 1.4] },
  { t: 0.215, cam: [-5.2, 1.5, 1.8], look: [3.0, 0, 0.5] },
  { t: 0.255, cam: [-1.1, 3.1, 1.1], look: [-0.8, 0.42, 0.35] },
  { t: 0.325, cam: [-0.7, 2.8, 1.0], look: [-0.75, 0.4, 0.35] },
  { t: 0.36, cam: [0.6, -2.2, 1.25], look: [-1.05, -0.1, 0.36] },
  { t: 0.425, cam: [0.4, -1.95, 1.15], look: [-1.0, -0.1, 0.38] },
  { t: 0.495, cam: [6.8, -1.4, 2.6], look: [0.4, 1.5, 0.95] },
  { t: 0.56, cam: [7.6, -1.0, 3.1], look: [0.4, 1.5, 0.85] },
], [
  { t: 0.0, cam: [-5.2, 0.5, 1.35], look: [6.5, 0, 2.6] },
  { t: 0.14, cam: [-4.4, 0.35, 1.15], look: [6.5, 0, 2.9] },
  { t: 0.165, cam: [-4.5, 0.4, 1.2], look: [6.5, 0, 2.6] },
  { t: 0.215, cam: [-6.0, 1.5, 2.0], look: [3.0, 0, 0.9] },
  { t: 0.255, cam: [-0.6, 2.9, 1.05], look: [-0.42, 0.42, 0.62] },
  { t: 0.325, cam: [-0.2, 2.6, 0.95], look: [-0.35, 0.4, 0.6] },
  { t: 0.36, cam: [0.8, -2.6, 1.4], look: [-0.25, -0.1, 0.62] },
  { t: 0.425, cam: [0.6, -2.3, 1.3], look: [-0.25, -0.1, 0.62] },
  { t: 0.495, cam: [8.6, 1.5, 3.4], look: [0.3, 1.5, 1.35] },
  { t: 0.56, cam: [9.4, 1.5, 3.8], look: [0.3, 1.5, 1.25] },
]);
let sA_cur = GRID_S;
function kartCamera(t) {
  let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1]; const x = easeInOutCubic(seg(t, a.t, b.t));
  const mix = (p, q) => p.map((v, k) => lerp(v, q[k], x));
  const { pos: o, tg: f, side: r } = along(sA(Math.min(t, CUES.rise[0])), LANE_A);
  const at = ([F, R, U]) => o.clone().addScaledVector(f, F).addScaledVector(r, R).addScaledVector(UP, U);
  return { pos: at(mix(a.cam, b.cam)), look: at(mix(a.look, b.look)) };
}
const MAP_VIEW = pick(
  { look: MAP_CENTER.clone().add(V(0, 0, 700)), dist: 9800, pitch: 0.95 },
  { look: MAP_CENTER.clone().add(V(-150, 0, 2600)), dist: 19500, pitch: 1.18 },
);
function mapCam(drift = 0) {
  const dir = V(0, Math.sin(MAP_VIEW.pitch), Math.cos(MAP_VIEW.pitch));
  const look = MAP_VIEW.look.clone().add(V(drift, 0, 0));
  return { pos: look.clone().addScaledVector(dir, MAP_VIEW.dist), look };
}
// Zoom continuo entre dos vistas: interpola el punto mirado y la distancia en escala logarítmica
function zoom(from, to, x, xLook = x) {
  const look = from.look.clone().lerp(to.look, xLook);
  const d0 = from.pos.clone().sub(from.look), d1 = to.pos.clone().sub(to.look);
  const len = Math.exp(lerp(Math.log(d0.length()), Math.log(d1.length()), x));
  const dir = d0.normalize().lerp(d1.normalize(), smooth(x)).normalize();
  return { pos: look.clone().addScaledVector(dir, len), look };
}
const FLY_U0 = 0.33;
const flyStart = () => ({ pos: curve.getPointAt(FLY_U0).setY(1.3), look: curve.getPointAt(FLY_U0 + 0.035).setY(1.05) });
function cameraAt(t) {
  if (t < CUES.rise[0]) return { ...kartCamera(t), roll: 0 };
  if (t < CUES.rise[1]) {
    const x = seg(t, CUES.rise[0], CUES.rise[1]);
    return { ...zoom(kartCamera(CUES.rise[0]), mapCam(-250), easeInOutCubic(x), easeInOutCubic(seg(x, 0.15, 1))), roll: 0 };
  }
  if (t < CUES.dive[0]) return { ...mapCam(lerp(-250, 250, seg(t, CUES.rise[1], CUES.dive[0]))), roll: 0 }; // deriva lenta
  if (t < CUES.dive[1]) {
    const x = seg(t, CUES.dive[0], CUES.dive[1]);
    return { ...zoom(mapCam(250), flyStart(), easeInOutCubic(x), easeInOutCubic(seg(x, 0, 0.85))), roll: 0 };
  }
  if (t < CUES.fly[1]) {
    const s = seg(t, CUES.fly[0], CUES.fly[1]); const u = lerp(FLY_U0, 1, s * s * (1.5 - 0.5 * s));
    const pos = curve.getPointAt(u).setY(1.3); const look = curve.getPointAt(Math.min(1, u + 0.035)).setY(1.05);
    look.lerp(CREST, 0.35 * smooth(seg(s, 0.8, 1)));
    const t1 = curve.getTangentAt(u), t2 = curve.getTangentAt(Math.min(1, u + 0.02));
    return { pos, look, roll: THREE.MathUtils.clamp((t1.x * t2.z - t1.z * t2.x) * 9, -0.22, 0.22) };
  }
  const x = easeOutCubic(seg(t, CUES.fly[1], CUES.crest[1] - 0.015));
  const start = END.clone(); start.y = 1.3;
  const dist = pick(14.6, 13.6), lookOff = pick(-0.35, -0.95);
  const final = CREST.clone().add(V(0, lookOff, dist));
  const pos = start.clone().lerp(final, x); pos.y = lerp(1.3, final.y, smooth(x));
  const startLook = END.clone().add(V(0, 1.0, -8)).lerp(CREST, 0.35);
  return { pos, look: startLook.lerp(CREST.clone().add(V(0, lookOff, 0)), smooth(x)), roll: 0 };
}

// ---------- anclajes para la web ----------
const tmpV = V(0, 0, 0);
function screenOf(p) {
  tmpV.copy(p).applyMatrix4(camera.matrixWorldInverse);
  if (tmpV.z > -0.01) return null; // detrás de la cámara
  tmpV.copy(p).project(camera);
  const x = (tmpV.x + 1) / 2, y = (1 - tmpV.y) / 2;
  return x < -0.15 || x > 1.15 || y < -0.15 || y > 1.15 ? null : [+x.toFixed(4), +y.toFixed(4)];
}

// ---------- frame ----------
const setOpacity = (mats, k) => mats.forEach((m) => { m.opacity = (m.userData.max ?? 1) * k; });
window.renderFrame = (t) => {
  t = clamp01(t);

  // Semáforo: rojas una a una, después todas en verde; se apagan cuando el kart ya ha salido
  const green = smooth(seg(t, CUES.green, CUES.green + 0.006));
  for (let i = 0; i < 5; i++) {
    const on = Math.max(smooth(seg(t, CUES.lights[i], CUES.lights[i] + 0.012)), green) * (1 - seg(t, CUES.green + 0.04, CUES.green + 0.06));
    lampMats[i].emissive.copy(RED).lerp(GREEN, green);
    lampMats[i].emissiveIntensity = on * lerp(2.6, 1.5, green);
    lampLights[i].color.copy(RED).lerp(GREEN, green);
    lampLights[i].intensity = on * lerp(5, 3, green);
  }
  for (const { glow, i } of lampGlows) { glow.material.opacity = (lampMats[i].emissiveIntensity / 2.6) * 0.22; glow.material.color.copy(lampLights[i].color); }

  // Karts
  const tk = Math.min(t, CUES.rise[1]);
  sA_cur = sA(tk);
  placeKart(kartA, sA_cur, LANE_A);
  placeKart(kartB, sB(tk), LANE_B);
  kartA.group.visible = t < CUES.dive[0];
  kartB.group.visible = t > CUES.belt[1] - 0.01 && t < CUES.dive[0];
  kartA.highlightEngine(Math.min(1, 2.2 * pulse(t, CUES.engine[0], CUES.engine[1] + 0.02)));
  kartA.highlightBelt(Math.min(1, 2.2 * pulse(t, CUES.belt[0], CUES.belt[1] + 0.02)));
  spot.position.copy(kartA.group.position).add(V(-4, 9, 5)); spot.target.position.copy(kartA.group.position);

  // Suelo y mapa: el suelo desaparece al subir y vuelve al bajar
  const mapIn = smooth(seg(t, CUES.rise[0] + 0.03, CUES.rise[1] - 0.02)) * (1 - smooth(seg(t, CUES.dive[0] + 0.004, CUES.dive[0] + 0.022)));
  const groundIn = 1 - smooth(seg(t, CUES.rise[0] + 0.004, CUES.rise[0] + 0.03)) * (1 - smooth(seg(t, CUES.dive[1] - 0.02, CUES.dive[1] - 0.004)));
  ground.material.opacity = groundIn;
  ground.visible = groundIn > 0.001;
  setOpacity(mapMats, mapIn); setOpacity(lineMats, mapIn);
  mapGroup.visible = mapIn > 0.001;
  scene.fog.density = FOG * (1 - smooth(seg(t, CUES.rise[0], CUES.rise[0] + 0.03)))
    + FOG * smooth(seg(t, CUES.dive[1] - 0.02, CUES.dive[1]))
    + 0.05 * smooth(seg(t, CUES.fly[1] - 0.02, CUES.fly[1] + 0.06));

  // Marcadores de circuito y arcos de las rondas
  const [p0, p1] = CUES.pins;
  for (const c of CIRCUITS) {
    const p = pins[c.id]; const a = p0 + (p.i * (p1 - p0)) / 6; const k = clamp01(easeOutBack(seg(t, a, a + 0.02))) * mapIn;
    p.ringM.opacity = k;
    p.beam.scale.y = Math.max(0.001, k); p.beam.position.y = (PIN_H / 2) * k;
    p.beamM.opacity = 0.75 * k; p.dotM.opacity = k; p.dot.position.y = PIN_H * k;
  }
  const [r0, r1] = CUES.rounds;
  arcs.forEach((a, i) => {
    const x = seg(t, r0 + (i * (r1 - r0)) / 7.5, r0 + ((i + 1) * (r1 - r0)) / 7.5);
    a.mesh.geometry.setDrawRange(0, Math.floor((a.count * x) / 3) * 3); a.m.opacity = mapIn;
  });

  // Vuelo final con la trazada dorada
  const fs = seg(t, CUES.fly[0], CUES.fly[1]);
  const reveal = t < CUES.dive[1] - 0.01 ? 0 : Math.min(1, FLY_U0 + 0.02 + fs * (1 - FLY_U0) + 0.28 * smooth(seg(fs, 0, 0.2)));
  racing.geometry.setDrawRange(0, Math.floor((RACING_COUNT * reveal) / 3) * 3);
  curve.getPointAt(Math.max(0.0001, reveal), tip.position); tip.position.y = 0.12;
  tip.material.opacity = reveal === 0 ? 0 : 0.9 * (1 - seg(t, CUES.fly[1] - 0.012, CUES.fly[1]));
  dust.material.opacity = 0.5 * (1 - seg(t, CUES.green, CUES.green + 0.05));
  streaks.material.opacity = 0.42 * smooth(seg(t, CUES.fly[0], CUES.fly[0] + 0.012)) * (1 - smooth(seg(t, CUES.fly[1] - 0.008, CUES.fly[1] + 0.006)));

  // Escena a oscuras durante el escudo
  const dim = 1 - smooth(seg(t, CUES.fly[1] - 0.012, CUES.fly[1] + 0.008));
  hemi.intensity = 0.6 * dim; key.intensity = 1.6 * dim; rim.intensity = 0.7 * dim; spot.intensity = 70 * dim; scene.environmentIntensity = ENV * dim;

  // Escudo
  const c = seg(t, CUES.crest[0], CUES.crest[1]);
  crest.visible = t > CUES.fly[0];
  const disc = seg(c, 0, 0.35), wings = seg(c, 0.18, 0.62), crown = seg(c, 0.42, 0.78), word = seg(c, 0.62, 0.92), sh = seg(c, 0.78, 1);
  P.disc.pivot.scale.setScalar(lerp(0.4, 1, easeOutBack(disc)));
  P.disc.pivot.rotation.z = lerp(-Math.PI * 1.5, 0, easeOutCubic(disc));
  P.disc.base.material.opacity = smooth(seg(disc, 0, 0.4));
  P.wingL.pivot.rotation.y = lerp(-Math.PI / 2, 0, easeOutCubic(wings));
  P.wingR.pivot.rotation.y = lerp(Math.PI / 2, 0, easeOutCubic(wings));
  P.wingL.base.material.opacity = P.wingR.base.material.opacity = smooth(seg(wings, 0, 0.25));
  P.crown.pivot.position.y = lerp(2.6, 0, easeOutCubic(crown)); P.crown.base.material.opacity = smooth(seg(crown, 0, 0.5));
  P.word.pivot.position.y = lerp(-0.5, 0, easeOutCubic(word)); P.word.base.material.opacity = smooth(word);
  for (const m of sheenMats) { m.uniforms.pos.value = lerp(-0.3, 1.9, sh); m.uniforms.amount.value = Math.sin(Math.PI * sh) * 0.55; }
  discFlare.material.opacity = 0.75 * Math.sin(Math.PI * seg(c, 0, 0.45));
  halo.material.opacity = 0.09 * smooth(seg(c, 0.1, 0.7));

  // Cámara
  const { pos, look, roll } = cameraAt(t);
  camera.position.copy(pos); camera.up.set(0, 1, 0); camera.lookAt(look); camera.rotateZ(roll);
  camera.updateMatrixWorld();
  composer.render();

  // Anclajes (posición en pantalla para colocar los textos en la web)
  const anchors = {
    engine: screenOf(toWorld(kartA, kartA.anchors.engine)),
    belt: screenOf(toWorld(kartA, kartA.anchors.belt)),
    kartA: screenOf(toWorld(kartA, kartA.anchors.top)),
    kartB: kartB.group.visible ? screenOf(toWorld(kartB, kartB.anchors.top)) : null,
  };
  for (const cc of CIRCUITS) anchors[cc.id] = screenOf(pins[cc.id].base.clone().add(V(0, PIN_H, 0)).add(mapGroup.position));
  return anchors;
};

// Espera a que carguen las texturas del escudo
THREE.DefaultLoadingManager.onLoad = () => { window.sceneReady = true; };
