// Kart de alquiler con piloto y cinturón de lastre, construido con primitivas.
// Ejes locales: +z hacia delante, +y arriba, -x es el lado derecho (donde va el motor).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const GOLD = new THREE.Color(0xf2c14e);

// Materiales compartidos
const M = {
  body: new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.28, metalness: 0.15 }),
  bumper: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.55, metalness: 0.05 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xd4a62a, roughness: 0.35, metalness: 0.6 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc40a0a, roughness: 0.35 }),
  tube: new THREE.MeshStandardMaterial({ color: 0x8a8d93, roughness: 0.35, metalness: 0.9 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.85 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x8a8e96, roughness: 0.35, metalness: 1 }),
  seat: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.45, metalness: 0.2 }),
  suit: new THREE.MeshStandardMaterial({ color: 0x2c2f37, roughness: 0.7 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.7 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.9 }),
};

function cyl(r, a, b, mat, seg = 16) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), seg), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}
function capsule(r, a, b, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, dir.length()), 6, 14), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}
function rbox(w, h, d, r, mat) { return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat); }
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function numberTexture(num) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#bdb9b0'; g.beginPath(); g.roundRect(6, 6, 244, 148, 26); g.fill();
  g.fillStyle = '#0a0a0b'; g.font = '900 118px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(num, 128, 86);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// Grupo resaltable: los materiales se clonan para poder iluminarlos sin afectar al resto,
// y se añaden aristas doradas que aparecen al resaltar.
function makeHighlightable(group) {
  const mats = [], edges = [], shells = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone(); mats.push(o.material);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 28),
      new THREE.LineBasicMaterial({ color: GOLD.clone().multiplyScalar(2.2), transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    e.renderOrder = 11;
    e.position.copy(o.position); e.quaternion.copy(o.quaternion); e.scale.copy(o.scale);
    edges.push(e);
    const shell = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(0.9), transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    shell.position.copy(o.position); shell.quaternion.copy(o.quaternion); shell.scale.copy(o.scale).multiplyScalar(1.08); shell.renderOrder = 10;
    shells.push(shell);
  });
  edges.forEach((e) => group.add(e)); shells.forEach((s) => group.add(s));
  return (h) => {
    for (const m of mats) { m.emissive = GOLD; m.emissiveIntensity = 0.1 * h; }
    for (const e of edges) e.material.opacity = h;
    for (const s of shells) s.material.opacity = 0.1 * h;
  };
}

export function buildKart({ number = '07', helmet = 0xd4a62a, build = 1 } = {}) {
  const kart = new THREE.Group();

  // --- chasis ---
  for (const s of [1, -1]) kart.add(cyl(0.017, V(0.3 * s, 0.11, -0.85), V(0.3 * s, 0.11, 0.62), M.tube));
  kart.add(cyl(0.017, V(-0.3, 0.11, 0.62), V(0.3, 0.11, 0.62), M.tube));
  kart.add(cyl(0.02, V(-0.66, 0.14, -0.55), V(0.66, 0.14, -0.55), M.tube)); // eje trasero
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 1.0), M.tube); floor.position.set(0, 0.1, 0.05); kart.add(floor);

  // --- ruedas ---
  const wheels = [];
  const wheel = (x, z, r, w) => {
    const g = new THREE.Group(); g.position.set(x, r, z);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 36), M.tyre); tyre.rotation.z = Math.PI / 2; g.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 1.04, 24), M.rim); rim.rotation.z = Math.PI / 2; g.add(rim);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(w * 1.08, r * 0.95, 0.03), M.seat); g.add(hub); // radio visible para notar el giro
    kart.add(g); wheels.push({ g, r });
  };
  wheel(0.63, -0.55, 0.14, 0.2); wheel(-0.63, -0.55, 0.14, 0.2);
  wheel(0.56, 0.55, 0.13, 0.13); wheel(-0.56, 0.55, 0.13, 0.13);

  // --- carrocería y paragolpes (estilo kart de alquiler) ---
  const front = rbox(1.02, 0.17, 0.24, 0.06, M.bumper); front.position.set(0, 0.16, 0.9); kart.add(front);
  const nose = rbox(0.62, 0.12, 0.42, 0.05, M.body); nose.position.set(0, 0.24, 0.76); nose.rotation.x = 0.12; kart.add(nose);
  const stripe = rbox(0.1, 0.125, 0.43, 0.03, M.stripe); stripe.position.set(0, 0.245, 0.76); stripe.rotation.x = 0.12; kart.add(stripe);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), new THREE.MeshStandardMaterial({ map: numberTexture(number), roughness: 0.5 }));
  plate.position.set(0, 0.25, 1.025); kart.add(plate);
  const fairing = rbox(0.4, 0.3, 0.05, 0.02, M.body); fairing.position.set(0, 0.34, 0.56); fairing.rotation.x = -0.35; kart.add(fairing);
  const fstripe = rbox(0.41, 0.04, 0.052, 0.01, M.red); fstripe.position.set(0, 0.43, 0.53); fstripe.rotation.x = -0.35; kart.add(fstripe);
  for (const s of [1, -1]) {
    const pod = rbox(0.24, 0.17, 0.72, 0.06, M.bumper); pod.position.set(0.63 * s, 0.16, 0.0); kart.add(pod);
    const podTop = rbox(0.18, 0.04, 0.6, 0.02, M.red); podTop.position.set(0.63 * s, 0.255, 0.0); kart.add(podTop);
  }
  const rear = rbox(1.5, 0.2, 0.24, 0.07, M.bumper); rear.position.set(0, 0.2, -0.86); kart.add(rear);

  // --- dirección, depósito y asiento ---
  kart.add(cyl(0.016, V(0, 0.14, 0.58), V(0, 0.44, 0.3), M.tube));
  const wheelS = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 10, 36), M.glove); wheelS.position.set(0, 0.46, 0.28); wheelS.rotation.x = -0.95; kart.add(wheelS);
  const tank = rbox(0.2, 0.1, 0.24, 0.03, new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.4 })); tank.position.set(0, 0.17, 0.36); kart.add(tank);
  const seatB = rbox(0.38, 0.07, 0.36, 0.03, M.seat); seatB.position.set(0, 0.15, -0.22); kart.add(seatB);
  const seatK = rbox(0.42, 0.44, 0.06, 0.03, M.seat); seatK.position.set(0, 0.38, -0.44); seatK.rotation.x = -0.42; kart.add(seatK);
  for (const s of [1, -1]) { const w = rbox(0.05, 0.12, 0.34, 0.02, M.seat); w.position.set(0.2 * s, 0.2, -0.27); kart.add(w); }

  // --- motor (lado derecho) ---
  const engine = new THREE.Group(); engine.position.set(-0.42, 0, -0.42); kart.add(engine);
  const alu = new THREE.MeshStandardMaterial({ color: 0xa7abb2, roughness: 0.4, metalness: 0.85 });
  const block = rbox(0.24, 0.22, 0.26, 0.03, alu); block.position.set(0, 0.24, 0); engine.add(block);
  for (let i = 0; i < 6; i++) { const fin = rbox(0.22, 0.012, 0.22, 0.004, alu); fin.position.set(0.02, 0.38 + i * 0.022, 0.01); fin.rotation.z = 0.25; engine.add(fin); }
  const air = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.13, 28), M.seat); air.rotation.z = Math.PI / 2; air.position.set(-0.17, 0.33, 0.1); engine.add(air);
  const muffler = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 24), M.rim); muffler.rotation.x = Math.PI / 2; muffler.position.set(0.03, 0.36, -0.26); engine.add(muffler);
  const guard = rbox(0.04, 0.14, 0.32, 0.01, M.seat); guard.position.set(0.12, 0.18, -0.16); engine.add(guard);

  // --- piloto ---
  const driver = new THREE.Group(); driver.scale.set(build, 1, build); kart.add(driver);
  const hip = V(0, 0.3, -0.24), sh = V(0, 0.73, -0.42);
  driver.add(capsule(0.12, V(-0.09, 0.3, -0.24), V(0.09, 0.3, -0.24), M.suit)); // pelvis
  driver.add(capsule(0.15, V(0, 0.38, -0.29), V(0, 0.62, -0.39), M.suit)); // torso
  driver.add(capsule(0.06, V(0, 0.7, -0.41), V(0, 0.8, -0.42), M.suit)); // cuello
  for (const s of [1, -1]) {
    const shoulder = V(0.19 * s, 0.7, -0.38), elbow = V(0.23 * s, 0.53, -0.1), hand = V(0.13 * s, 0.48, 0.25);
    driver.add(capsule(0.05, shoulder, elbow, M.suit)); driver.add(capsule(0.045, elbow, hand, M.suit));
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), M.glove); g.position.copy(hand); driver.add(g);
    const knee = V(0.15 * s, 0.42, 0.2), foot = V(0.1 * s, 0.19, 0.62);
    driver.add(capsule(0.07, V(0.09 * s, 0.3, -0.18), knee, M.suit)); driver.add(capsule(0.055, knee, foot, M.suit));
    const shoe = rbox(0.09, 0.08, 0.16, 0.03, M.glove); shoe.position.copy(foot).add(V(0, -0.01, 0.06)); driver.add(shoe);
  }
  const helmetMat = new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.22, metalness: 0.55 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 32, 24), helmetMat); head.position.set(0, 0.92, -0.41); driver.add(head);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.142, 32, 16, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2), M.visor);
  visor.position.copy(head.position); driver.add(visor);

  // --- cinturón de lastre en la cadera: plomos sobre caderas y zona lumbar, hebilla delante ---
  const belt = new THREE.Group(); belt.position.copy(hip); driver.add(belt);
  const webbing = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.8 });
  const lead = new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.55, metalness: 0.6 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.075, 40, 1, true), webbing);
  band.scale.set(1.12, 1, 0.92); band.material.side = THREE.DoubleSide; belt.add(band);
  for (const [x, z, ry] of [[0.2, -0.02, Math.PI / 2], [-0.2, -0.02, Math.PI / 2], [0.1, -0.15, 0.5], [-0.1, -0.15, -0.5]]) {
    const b = rbox(0.11, 0.085, 0.05, 0.015, lead); b.position.set(x, 0, z); b.rotation.y = ry; belt.add(b);
  }
  const buckle = rbox(0.07, 0.06, 0.025, 0.008, M.rim); buckle.position.set(0, 0, 0.165); belt.add(buckle);

  return {
    group: kart, wheels,
    highlightEngine: makeHighlightable(engine),
    highlightBelt: makeHighlightable(belt),
    // puntos de anclaje (locales) para las etiquetas de la web
    anchors: { engine: V(-0.45, 0.42, -0.42), belt: V(0.2 * build, 0.3, -0.26), top: V(0, 1.15, -0.3) },
    driver,
  };
}
