import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The date of today has one stable identity, independent of theme or selection.
const TODAY_COLOR = '#e87945';
const THEMES = {
  butter: { base: '#e8c86d', sunday: '#efcd67', saturday: '#efcd67', marked: '#d0a33f', muted: '#d6cab0', dot: '#806326' },
  rose: { base: '#db93ad', sunday: '#e1a0b8', saturday: '#e1a0b8', marked: '#bd6b90', muted: '#d1bec8', dot: '#703b59' },
  lavender: { base: '#ad98dc', sunday: '#b5a2e5', saturday: '#b5a2e5', marked: '#8e76c1', muted: '#c3bdd3', dot: '#554276' },
  monochrome: { base: '#ededeb', sunday: '#34363b', saturday: '#34363b', marked: '#777a80', muted: '#bfc0c2', dot: '#51545b', weekendInk: '#fffdf8' },
  green: { base: '#d3e6d8', sunday: '#34866b', saturday: '#34866b', marked: '#31614f', muted: '#bdccc2', dot: '#32664f', weekendInk: '#163c2d' },
  klein: { base: '#ccd6f1', sunday: '#002fa7', saturday: '#002fa7', marked: '#00247f', muted: '#bfc6d8', dot: '#002fa7', weekendInk: '#fffdf8' },
};
const THEME_ALIASES = { macaron: 'butter', garden: 'rose', dusk: 'lavender' };

/**
 * Extruded rounded-square plaque, with an independent flat printed face.
 * The depth is sheared left/down instead of rotating the date grid or labels.
 * A true straight sidewall remains between the shallow front/back bevels.
 */
function createSlabGeometry(extra = 0) {
  const faceSize = 0.76 + extra;
  const half = faceSize / 2;
  const radius = 0.14 + extra / 2;
  const depth = 0.245;
  const bevelSize = 0.068;
  const bevelThickness = 0.064;
  const frontZ = depth + bevelThickness;
  const centerZ = depth / 2;
  const shearX = 0.19;
  const shearY = 0.105;
  const shape = new THREE.Shape();
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.absarc(half - radius, -half + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(half, half - radius);
  shape.absarc(half - radius, half - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-half + radius, half);
  shape.absarc(-half + radius, half - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-half, -half + radius);
  shape.absarc(-half + radius, -half + radius, radius, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, curveSegments: 12,
    bevelEnabled: true, bevelSegments: 8, bevelSize, bevelThickness,
  });
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const normal = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // Analytic normals keep the large front completely flat and blend the
    // elliptical bevel smoothly without triangulation seams or keycap bands.
    const dx = x - THREE.MathUtils.clamp(x, -half + radius, half - radius);
    const dy = y - THREE.MathUtils.clamp(y, -half + radius, half - radius);
    const length = Math.hypot(dx, dy) || 1;
    let radial = 1;
    let nz = 0;
    if (z > depth) {
      const cosine = THREE.MathUtils.clamp((z - depth) / bevelThickness, 0, 1);
      radial = bevelThickness * Math.sqrt(Math.max(0, 1 - cosine * cosine));
      nz = bevelSize * cosine;
    } else if (z < 0) {
      const cosine = THREE.MathUtils.clamp(-z / bevelThickness, 0, 1);
      radial = bevelThickness * Math.sqrt(Math.max(0, 1 - cosine * cosine));
      nz = -bevelSize * cosine;
    }
    const nx = dx / length * radial;
    const ny = dy / length * radial;
    normal.set(nx, ny, nz - shearX * nx - shearY * ny).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
    positions.setXYZ(i, x + (z - frontZ) * shearX, y + (z - frontZ) * shearY, z - centerZ);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createClassicGeometry(){
  const cubeGeometry = new RoundedBoxGeometry(0.94, 0.91, 0.44, 10, 0.20);
  // A barely crowned face removes the perfectly flat keycap highlight while
  // keeping printed numbers front-facing and the calendar silhouette square.
  const positions = cubeGeometry.attributes.position;
  const normals = cubeGeometry.attributes.normal;
  const crownNormal = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    if (z <= 0) continue;
    const cx = Math.max(0, 1 - (x / 0.47) ** 4);
    const cy = Math.max(0, 1 - (y / 0.455) ** 4);
    const crown = cx * cy;
    positions.setZ(i, z + 0.024 * crown * z / 0.22);
    // Transform the existing smooth normal analytically. Recomputing normals
    // on RoundedBoxGeometry's unindexed triangles would introduce faceting.
    const dx = -0.024 * 4 * x ** 3 / 0.47 ** 4 * cy * z / 0.22;
    const dy = -0.024 * 4 * y ** 3 / 0.455 ** 4 * cx * z / 0.22;
    const nz = normals.getZ(i) / (1 + 0.024 * crown / 0.22);
    crownNormal.set(normals.getX(i) - dx * nz, normals.getY(i) - dy * nz, nz).normalize();
    normals.setXYZ(i, crownNormal.x, crownNormal.y, crownNormal.z);
  }
  return cubeGeometry;
}

/** A quiet, actual 3D calendar. The host owns dates, accessibility and reminders. */
export function createScene(container, { onSelect = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.domElement.className = 'calendar-webgl';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'manipulation' });
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 50);
  camera.position.set(0, 0, 15);
  camera.lookAt(0, 0, 0);
  const calendar = new THREE.Group();
  // A front-on, orthographic grid: perspective must never move weekday columns.
  calendar.rotation.set(0, 0, 0);
  scene.add(calendar);
  const environmentRoom = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environmentRoom, 0.06);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.65;
  environmentRoom.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xfff9f0, 0x9b97a5, 0.35));
  const keyLight = new THREE.DirectionalLight(0xfff9ee, 2.0);
  keyLight.position.set(-3, 5, 7);
  scene.add(keyLight);
  const coolFill = new THREE.DirectionalLight(0xe0e6ff, 0.42);
  coolFill.position.set(4, -2, 5);
  scene.add(coolFill);
  const warmRim = new THREE.DirectionalLight(0xffead8, 0.7);
  warmRim.position.set(4, 3, 0.7);
  scene.add(warmRim);

  let shapeName="classic";
  let cubeGeometry = createClassicGeometry();
  let rimGeometry = new RoundedBoxGeometry(0.973,0.943,0.38,10,0.19);
  const labelGeometry = new THREE.PlaneGeometry(0.83, 0.83);
  const shadowGeometry = new THREE.PlaneGeometry(1.40, 1.37);
  const dotGeometry = new THREE.SphereGeometry(0.042, 16, 12);
  const shadowTexture = makeContactShadow();
  const entries = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let hoveredKey = null;
  let selectedKey = null;
  let todayKey = null;
  let frame = 0;
  let lastTime = 0;
  let destroyed = false;
  let rows = 5;
  let width = 1;
  let height = 1;
  let downPoint = null;
  let themeName = 'butter';
  let lastCells = [];
  let lastReminders = {};

  function makeContactShadow() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    // Only a soft contact penumbra. Directional shadow maps produced hard,
    // displaced squares and looked like a second set of calendar tiles.
    ctx.filter = 'blur(26px)';
    ctx.fillStyle = 'rgba(43, 34, 51, 0.38)';
    ctx.beginPath();
    ctx.roundRect(105, 112, 302, 294, 52);
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function createEntry(cell) {
    const group = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xf5efe7,
      roughness: 0.43,
      metalness: 0,
      clearcoat: 0.16,
      clearcoatRoughness: 0.38,
      sheen: 0.04,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(0xffffff),
    });
    const cube = new THREE.Mesh(cubeGeometry, material);
    cube.userData.dateKey = cell.key;
    group.add(cube);
    const rimMaterial = new THREE.MeshBasicMaterial({ color: 0xfff9ec, transparent: true, opacity: 0, depthWrite: false });
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.position.z = -0.025;
    group.add(rim);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    // Dates are front-facing decals. Avoid driver-dependent depth precision
    // clipping when a transparent desktop surface is recomposited.
    const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const label = new THREE.Mesh(labelGeometry, labelMaterial);
    label.position.set(0, 0.002, 0.20);
    label.renderOrder = 2;
    group.add(label);

    const dotMaterial = new THREE.MeshPhysicalMaterial({ color: 0x74b4ef, roughness: 0.24, emissive: 0x326ba2, emissiveIntensity: 0.1 });
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.position.set(0, -0.285, 0.207);
    group.add(dot);
    calendar.add(group);

    const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.76, depthWrite: false, toneMapped: false });
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.position.z = -0.24;
    calendar.add(shadow);
    const entry = { cell, group, cube, material, rim, rimMaterial, canvas, texture, label, labelMaterial, dot, dotMaterial, shadow, shadowMaterial, targetColor: new THREE.Color(), labelState: '', baseX: 0, baseY: 0 };
    entries.set(cell.key, entry);
    return entry;
  }

  function hasReminders(reminders, key) {
    const value = reminders instanceof Map ? reminders.get(key) : Array.isArray(reminders)
      ? reminders.filter(item => (item.date || item.dateKey || item.dayKey || item.key) === key)
      : reminders?.[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }

  function paintLabel(entry, selected) {
    const isToday = entry.cell.key === todayKey;
    const notes=entry.cell.notes||[];
    const state = `${entry.cell.day}:${entry.cell.inMonth}:${selected}:${isToday}:${themeName}:${notes.join()}`;
    if (state === entry.labelState) return;
    entry.labelState = state;
    const ctx = entry.canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${isToday ? 600 : selected ? 550 : 500} 163px "Segoe UI Variable", "Segoe UI", Arial, sans-serif`;
    const weekend = [0,6].includes(entry.cell.date.getDay());
    ctx.fillStyle = isToday ? '#fffaf4' : !entry.cell.inMonth ? '#787582' : weekend && THEMES[themeName].weekendInk ? THEMES[themeName].weekendInk : '#292735';
    if (isToday) {
      ctx.shadowColor = 'rgba(121, 57, 27, 0.12)';
      ctx.shadowBlur = 2;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = ctx.shadowOffsetY = 0;
    }
    ctx.fillText(String(entry.cell.day), 256, notes.length?205:266);
    ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    notes.slice(0,3).forEach((note,i)=>{ctx.font="500 52px Segoe UI, Microsoft YaHei, sans-serif";const w=ctx.measureText(note).width;if(w>420)ctx.font=`500 ${Math.max(30,52*420/w)}px Segoe UI, Microsoft YaHei, sans-serif`;ctx.fillText(note,256,310+i*58);});
    entry.texture.needsUpdate = true;
  }

  function setDates(cells, selection, today, reminders = {}) {
    lastCells = cells;
    lastReminders = reminders;
    selectedKey = selection;
    todayKey = today;
    rows = Math.ceil(cells.length / 7) || 5;
    const liveKeys = new Set(cells.map(cell => cell.key));
    for (const [key, entry] of entries) {
      if (!liveKeys.has(key)) {
        disposeEntry(entry);
        entries.delete(key);
      }
    }
    cells.forEach((cell, index) => {
      const isNew = !entries.has(cell.key);
      const entry = entries.get(cell.key) || createEntry(cell);
      entry.cell = cell;
      entry.baseX = (index % 7 - 3) * 1.015;
      entry.baseY = ((rows - 1) / 2 - Math.floor(index / 7)) * 0.99;
      entry.group.position.x = entry.baseX;
      entry.group.position.y = entry.baseY;
      entry.shadow.position.x = entry.baseX;
      entry.shadow.position.y = entry.baseY - 0.055;
      const selected = cell.key === selectedKey;
      const marked = hasReminders(reminders, cell.key);
      const column = index % 7;
      const theme = THEMES[themeName];
      const color = cell.key === todayKey ? TODAY_COLOR
        : !cell.inMonth ? theme.muted
        : column === 0 ? theme.sunday
        : column === 6 ? theme.saturday
        : '#e8dfd0';
      entry.targetColor.set(color);
      if (isNew || reducedMotion.matches) entry.material.color.copy(entry.targetColor);
      entry.dot.visible = cell.inMonth && marked;
      entry.dotMaterial.color.set(cell.key === todayKey ? '#fff2cf' : [0,6].includes(column)&&theme.weekendInk ? '#e8eee9' : theme.dot);
      paintLabel(entry, selected);
    });
    resize();
    invalidate();
  }

  function setShape(name){
    const next=name==='slab'?'slab':'classic';if(next===shapeName)return;shapeName=next;const oldCube=cubeGeometry,oldRim=rimGeometry;cubeGeometry=next==='slab'?createSlabGeometry():createClassicGeometry();rimGeometry=next==='slab'?createSlabGeometry(.024):new RoundedBoxGeometry(.973,.943,.38,10,.19);entries.forEach(e=>{e.cube.geometry=cubeGeometry;e.rim.geometry=rimGeometry;});oldCube.dispose();oldRim.dispose();invalidate();
  }

  function setTheme(name) {
    const normalized = THEME_ALIASES[name] || name;
    const next = Object.hasOwn(THEMES, normalized) ? normalized : 'butter';
    if (themeName === next) return;
    themeName = next;
    setDates(lastCells, selectedKey, todayKey, lastReminders);
  }

  function render(time = 0) {
    frame = 0;
    if (destroyed) return;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 1 / 60;
    lastTime = time;
    const ease = reducedMotion.matches ? 1 : 1 - Math.exp(-15 * dt);
    let moving = false;
    entries.forEach(entry => {
      const selected = entry.cell.key === selectedKey;
      const hovered = entry.cell.key === hoveredKey;
      const targetZ = selected ? 0.32 : hovered ? 0.09 : 0;
      const targetScale = selected ? 1.085 : hovered ? 1.025 : 1;
      entry.group.position.z = THREE.MathUtils.lerp(entry.group.position.z, targetZ, ease);
      entry.group.scale.setScalar(THREE.MathUtils.lerp(entry.group.scale.x, targetScale, ease));
      entry.group.rotation.set(0, 0, 0);
      entry.rimMaterial.opacity = THREE.MathUtils.lerp(entry.rimMaterial.opacity, selected ? 0.90 : 0, ease);
      entry.material.color.lerp(entry.targetColor, ease);
      entry.shadow.scale.setScalar(1 + entry.group.position.z * 0.65);
      entry.shadowMaterial.opacity = 0.76 - entry.group.position.z * 0.85;
      entry.shadow.position.y = entry.baseY - 0.055 - entry.group.position.z * 0.13;
      const colorDelta = Math.abs(entry.material.color.r - entry.targetColor.r) + Math.abs(entry.material.color.g - entry.targetColor.g) + Math.abs(entry.material.color.b - entry.targetColor.b);
      if (Math.abs(entry.group.position.z - targetZ) > 0.0004 || Math.abs(entry.group.scale.x - targetScale) > 0.0004 || colorDelta > 0.001) moving = true;
    });
    renderer.render(scene, camera);
    if (moving) frame = requestAnimationFrame(render);
    else lastTime = 0;
  }

  function invalidate() {
    if (!destroyed && !frame) frame = requestAnimationFrame(render);
  }

  function resize() {
    if (destroyed) return;
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const sceneWidth = 7.48;
    const sceneHeight = rows * 0.99 + 0.38;
    const halfHeight = Math.max(sceneHeight / 2, sceneWidth / aspect / 2);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    invalidate();
  }

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects([...entries.values()].map(entry => entry.cube), false)[0]?.object.userData.dateKey || null;
  }

  function setHover(key) {
    if (hoveredKey === key) return;
    hoveredKey = key;
    renderer.domElement.style.cursor = key ? 'pointer' : 'default';
    invalidate();
  }
  const onMove = event => setHover(pick(event));
  const onLeave = () => setHover(null);
  const onDown = event => { downPoint = { x: event.clientX, y: event.clientY }; };
  const onUp = event => {
    if (downPoint && Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y) < 8) {
      const key = pick(event);
      if (key) onSelect(key);
    }
    downPoint = null;
  };
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerleave', onLeave);
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  /** Canvas-local pixel rect; optional invisible HTML targets can align to each cube. */
  function getCellRect(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    scene.updateMatrixWorld(true);
    projected.set(0, 0, 0).applyMatrix4(entry.group.matrixWorld).project(camera);
    const unitPixels = width / (camera.right - camera.left);
    const w = 0.94 * unitPixels;
    const h = 0.91 * unitPixels;
    return { x: (projected.x + 1) / 2 * width - w / 2, y: (1 - projected.y) / 2 * height - h / 2, width: w, height: h };
  }

  /** Use these exact canvas-local x values for HTML weekday headings. */
  function getColumnCenters() {
    const unitPixels = width / (camera.right - camera.left);
    return Array.from({ length: 7 }, (_, column) => width / 2 + (column - 3) * 1.015 * unitPixels);
  }

  function disposeEntry(entry) {
    calendar.remove(entry.group, entry.shadow);
    entry.material.dispose();
    entry.rimMaterial.dispose();
    entry.texture.dispose();
    entry.labelMaterial.dispose();
    entry.dotMaterial.dispose();
    entry.shadowMaterial.dispose();
  }
  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    renderer.domElement.removeEventListener('pointermove', onMove);
    renderer.domElement.removeEventListener('pointerleave', onLeave);
    renderer.domElement.removeEventListener('pointerdown', onDown);
    renderer.domElement.removeEventListener('pointerup', onUp);
    entries.forEach(disposeEntry);
    entries.clear();
    cubeGeometry.dispose();
    rimGeometry.dispose();
    labelGeometry.dispose();
    shadowGeometry.dispose();
    dotGeometry.dispose();
    shadowTexture.dispose();
    environmentTarget.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  resize();
  return { setDates, setTheme, setShape, resize, destroy, setHover, getCellRect, getColumnCenters };
}
