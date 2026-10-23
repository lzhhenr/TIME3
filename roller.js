import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSoundEngine } from './sound.mjs';

const shell = document.getElementById('roller');
const visual = document.getElementById('cubeVisual');
const hit = document.getElementById('cubeHit');
const dismiss = document.getElementById('dismiss');
const payload = await window.desktop.getToast();
const english = payload.language === 'en';
const health = payload.kind === 'wellness';
const sound = createSoundEngine(payload.soundEnabled !== false);
const acknowledgement = document.getElementById('acknowledge');
shell.classList.toggle('health',health);acknowledgement.hidden=!health;acknowledgement.textContent=english?'Got it':'收到';
window.desktop.onStateChanged(raw=>sound.setEnabled(raw?.settings?.soundEnabled!==false));
document.documentElement.lang = english ? 'en' : 'zh-CN';
document.getElementById('title').textContent = payload.title;
document.getElementById('time').textContent = `TIME³  ·  ${payload.time}`;
document.getElementById('help').textContent = english ? 'Click the cube to open this day' : '点一下方块，打开这一天';
if(health) document.getElementById('help').textContent=payload.preview?(english?'Preview · your timer stays unchanged':'试播 · 不改变正在进行的计时'):(english?'Got it or dismiss to restart the timer':'点击收到或关闭提示，重新开始计时');
hit.setAttribute('aria-label', `${english ? 'Open reminder' : '打开提醒'}：${payload.title}`);
dismiss.title = english ? 'Dismiss reminder' : '关闭提醒';
dismiss.setAttribute('aria-label', dismiss.title);
const day = String(Number(payload.date.slice(-2)));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SIZE = 76, HEIGHT = 360, HALF = 90;
// Windows may add non-client pixels to a frameless window at fractional DPI.
// Place the model in actual content coordinates against the monitor work area.
const contentFloor = payload.floor - window.screenY;
shell.style.top = `${contentFloor - HEIGHT}px`;
const endX = payload.area.x + payload.area.width / 2 - window.screenX;
const startX = payload.area.x + payload.area.width - window.screenX + HALF;
const distance = startX - endX;
const turns = Math.max(1, Math.round(distance / (4 * SIZE)));
const duration = 2200;
let hovered = false, settled = false, start = 0, frame = 0, stopped = false;
let hoverStarted = 0, pausedDuration = 0;
let lastRollStep=-1,lastBouncePhase='',lastBounceCycle=-1;
let renderer, scene, camera, cube, shadow, label, geometry, material, environment;
const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(.15, -.28, 0));
const axis = new THREE.Vector3(0, 0, 1), rotation = new THREE.Quaternion(), vertex = new THREE.Vector3();
let low = -SIZE / 2, high = SIZE / 2, right = SIZE / 2, left = -SIZE / 2;

try {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(180, HEIGHT);
  renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  visual.appendChild(renderer.domElement);
  scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-HALF, HALF, HEIGHT, 0, .1, 2000);
  camera.position.set(0, 0, 600); camera.lookAt(0, 0, 0);
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  environment = pmrem.fromScene(room, .04); scene.environment = environment.texture; room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xfff5e5, 0x72656a, 1.1));
  const key = new THREE.DirectionalLight(0xfff8ec, 3.1); key.position.set(-120, 240, 260); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc2d7ff, 1.0); fill.position.set(140, 80, 150); scene.add(fill);
  cube = new THREE.Group(); scene.add(cube);
  geometry = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 6, 12);
  material = new THREE.MeshPhysicalMaterial({ color: '#de7546', roughness: .29, metalness: .03, clearcoat: .28, clearcoatRoughness: .32, envMapIntensity: .65 });
  cube.add(new THREE.Mesh(geometry, material));
  const face = document.createElement('canvas'); face.width = 256; face.height = 256;
  const ctx = face.getContext('2d'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 108px "Segoe UI", sans-serif'; ctx.fillStyle = '#b8572e'; ctx.fillText(day, 128, 125);
  ctx.fillStyle = '#fff4dd'; ctx.fillText(day, 127, 122);
  // A tiny embossed dot keeps the reminder cube distinct from a calendar cell.
  ctx.beginPath(); ctx.arc(128, 194, 6, 0, Math.PI * 2); ctx.fill();
  const textTexture = new THREE.CanvasTexture(face); textTexture.colorSpace = THREE.SRGBColorSpace;
  label = new THREE.Mesh(new THREE.PlaneGeometry(62, 62), new THREE.MeshBasicMaterial({ map: textTexture, transparent: true, depthWrite: false }));
  label.position.z = SIZE / 2 + .15; cube.add(label);
  const shadowMap = document.createElement('canvas'); shadowMap.width = 256; shadowMap.height = 64;
  const brush = shadowMap.getContext('2d'); const gradient = brush.createRadialGradient(128, 32, 0, 128, 32, 125);
  gradient.addColorStop(0, 'rgba(70,37,25,.32)'); gradient.addColorStop(1, 'rgba(70,37,25,0)');
  brush.scale(1, .25); brush.fillStyle = gradient; brush.fillRect(0, 0, 256, 256);
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(110, 9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowMap), transparent: true, depthWrite: false }));
  shadow.position.set(0, 2, -80); scene.add(shadow);
} catch (error) {
  console.error('Reminder WebGL fallback:', error.message);
  visual.innerHTML = ''; const fallback = document.createElement('div'); fallback.className = 'fallback-cube'; fallback.textContent = day; visual.appendChild(fallback);
}

// A single 3D cube, with its lowest transformed vertex always on the floor.
// The floor is the native window's bottom = workArea.bottom, never a card edge.
function renderCube(angle, jump, sx, sy) {
  if (!cube) {
    const support = 38 * (Math.abs(Math.cos(angle)) * sy + Math.abs(Math.sin(angle)) * sx);
    visual.firstElementChild.style.transform = `translateY(${-(jump+support-38)}px) rotate(${-angle}rad) scale(${sx},${sy})`;
    low = -support; high = support; left = -support; right = support;
    return;
  }
  rotation.setFromAxisAngle(axis, angle); cube.quaternion.copy(rotation).multiply(base); cube.scale.set(sx, sy, 1);
  low = Infinity; high = -Infinity; left = Infinity; right = -Infinity;
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).multiply(cube.scale).applyQuaternion(cube.quaternion);
    low = Math.min(low, vertex.y); high = Math.max(high, vertex.y); left = Math.min(left, vertex.x); right = Math.max(right, vertex.x);
  }
  cube.position.y = -low + jump;
  shadow.scale.x = 1 + jump / 150; shadow.material.opacity = Math.max(.2, 1 - jump / 90);
  renderer.render(scene, camera);
}
function animate(now) {
  if (stopped) return;
  if (!start) start = now;
  const elapsed = (hovered ? hoverStarted : now) - start - pausedDuration, progress = reduced ? 1 : Math.min(1, elapsed / duration);
  // A long, occasional reminder can be playful; decelerate before settling.
  const ease = 1 - Math.pow(1 - progress, 1.65);
  const x = startX - distance * ease;
  let jump = 0, sx = 1, sy = 1;
  let angle = turns * Math.PI * 2 * ease;
  if (progress >= 1) {
    if (!settled) { settled = true; shell.classList.add('settled'); sound.notify(); }
    angle = turns * Math.PI * 2;
    if (!reduced) {
      // 140ms anticipation, ballistic flight, soft 190ms landing, then rest.
      const t = (elapsed - duration) % 1650;
      const cycle=Math.floor((elapsed-duration)/1650),phase=t<140?'ready':t<720?'air':t<910?'land':'rest';
      if(cycle<2&&(phase!==lastBouncePhase||cycle!==lastBounceCycle)){if(phase==='air')sound.jump();if(phase==='land')sound.land();}lastBouncePhase=phase;lastBounceCycle=cycle;
      if (t < 140) { const k = Math.sin(t / 140 * Math.PI / 2); sx = 1 + .17 * k; sy = 1 - .19 * k; }
      else if (t < 720) { const u = (t - 140) / 580; jump = 55 * 4 * u * (1 - u); const stretch = Math.sin(u * Math.PI); sx = 1 - .08 * stretch; sy = 1 + .13 * stretch; }
      else if (t < 910) { const u = (t - 720) / 190; const squash = Math.sin(u * Math.PI) * (1-u); sx = 1 + .23 * squash; sy = 1 - .21 * squash; }
    }
  }
  if(progress<1){const step=Math.floor(angle/(Math.PI/2));if(step!==lastRollStep){sound.roll(step);lastRollStep=step;}}
  shell.style.transform = `translate3d(${x-HALF}px,0,0)`;
  renderCube(angle, jump, sx, sy);
  const height = high-low;
  hit.style.transform = `translate(${left+HALF-42}px,${-jump}px)`;
  hit.style.width = `${right-left}px`; hit.style.height = `${height}px`;
  // Readable diagnostics used by native smoke tests, no IPC data or coordinates persisted.
  shell.dataset.phase = progress < 1 ? 'rolling' : 'bouncing';
  shell.dataset.centerX = String(x); shell.dataset.floor = String(payload.floor);
  shell.dataset.contactY = String(window.screenY + shell.getBoundingClientRect().bottom-jump); shell.dataset.jump = String(jump);
  shell.dataset.angle = String(angle);
  shell.dataset.soundsPlayed=String(sound.getState().played);
  shell.dataset.audioState=sound.getState().contextState;
  frame = requestAnimationFrame(animate);
}
function interaction(enabled) { window.desktop.setReminderInteractive(enabled).catch(() => {}); }
function hover(enabled) {
  if (enabled === hovered) return;
  if (enabled) hoverStarted = performance.now();
  else pausedDuration += performance.now() - hoverStarted;
  hovered = enabled; shell.classList.toggle('hovered', enabled); interaction(enabled);
}
for (const node of [hit, dismiss, ...(health?[document.getElementById('hint')]:[])]) {
  node.addEventListener('pointerenter', () => hover(true));
  node.addEventListener('pointerleave', () => hover(false));
}
async function acknowledge(){sound.acknowledge();await new Promise(resolve=>setTimeout(resolve,170));window.desktop.acknowledgeReminder();}
hit.addEventListener('click', () => health?acknowledge():window.desktop.openReminder(payload.date));
acknowledgement.addEventListener('click',acknowledge);
dismiss.addEventListener('click', () => window.desktop.dismissToast());
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.desktop.dismissToast(); });
window.addEventListener('blur', () => hover(false));
window.addEventListener('beforeunload', () => { stopped = true; cancelAnimationFrame(frame); sound.dispose();renderer?.dispose(); geometry?.dispose(); material?.dispose(); environment?.dispose(); label?.material.map.dispose(); label?.geometry.dispose(); label?.material.dispose(); });
frame = requestAnimationFrame(animate);
