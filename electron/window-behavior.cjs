// All geometry is in Electron's device-independent screen coordinates.
const POSITIONS = new Set(['top-left', 'bottom-left', 'top-right', 'bottom-right', 'center']);
const EDGES = ['left', 'right', 'top', 'bottom'];
const positionSizes = new WeakMap();
function trackWindowSize(win, requested = win.getBounds()) {
  if(positionSizes.has(win)) return;
  const size={width:requested.width,height:requested.height};positionSizes.set(win,size);
  // Only user resizing changes the logical size. setPosition on fractional-DPI
  // Windows feeds rounded getBounds back as a new size and grows every frame.
  win.on?.('will-resize',(_event,next)=>{const current=win.getBounds();size.width=Math.max(1,next.width-(current.width-size.width));size.height=Math.max(1,next.height-(current.height-size.height));});
}
function moveWindow(win,x,y){
  if(!win.setBounds){win.setPosition(x,y,false);return;}
  if(!positionSizes.has(win)) trackWindowSize(win);
  win.setBounds({x,y,...positionSizes.get(win)},false);
}
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

function clampBounds(bounds, area) {
  return { ...bounds,
    x: Math.round(clamp(bounds.x, area.x, area.x + area.width - bounds.width)),
    y: Math.round(clamp(bounds.y, area.y, area.y + area.height - bounds.height)) };
}
function placementBounds(bounds, area, position = 'center', margin = 16) {
  if (!POSITIONS.has(position)) position = 'center';
  const insetX = Math.min(margin, Math.max(0, (area.width - bounds.width) / 2));
  const insetY = Math.min(margin, Math.max(0, (area.height - bounds.height) / 2));
  const x = position.endsWith('left') ? area.x + insetX : position.endsWith('right') ? area.x + area.width - bounds.width - insetX : area.x + (area.width - bounds.width) / 2;
  const y = position.startsWith('top') ? area.y + insetY : position.startsWith('bottom') ? area.y + area.height - bounds.height - insetY : area.y + (area.height - bounds.height) / 2;
  return clampBounds({ ...bounds, x, y }, area);
}
function chooseDockEdge(bounds, area, threshold = 24) {
  const distances = [Math.abs(bounds.x - area.x), Math.abs(area.x + area.width - bounds.x - bounds.width), Math.abs(bounds.y - area.y), Math.abs(area.y + area.height - bounds.y - bounds.height)];
  const nearest = Math.min(...distances);
  return nearest <= threshold ? EDGES[distances.indexOf(nearest)] : null;
}
function dockBounds(bounds, area, edge) {
  const result = clampBounds(bounds, area);
  if (edge === 'left') result.x = area.x;
  if (edge === 'right') result.x = area.x + area.width - bounds.width;
  if (edge === 'top') result.y = area.y;
  if (edge === 'bottom') result.y = area.y + area.height - bounds.height;
  return { ...result, x: Math.round(result.x), y: Math.round(result.y) };
}
function containsPoint(bounds, point, margin = 0) {
  return point.x >= bounds.x - margin && point.x <= bounds.x + bounds.width + margin && point.y >= bounds.y - margin && point.y <= bounds.y + bounds.height + margin;
}
function nearDock(point, bounds, edge, margin = 14) {
  const centerX = bounds.x + bounds.width / 2, centerY = bounds.y + bounds.height / 2;
  const handle = edge === 'left' ? { x: bounds.x, y: centerY - 25, width: 5, height: 50 }
    : edge === 'right' ? { x: bounds.x + bounds.width - 5, y: centerY - 25, width: 5, height: 50 }
    : edge === 'top' ? { x: centerX - 25, y: bounds.y, width: 50, height: 5 }
    : edge === 'bottom' ? { x: centerX - 25, y: bounds.y + bounds.height - 5, width: 50, height: 5 } : null;
  return !!handle && containsPoint(handle, point, margin);
}
function displayForBounds(screen, bounds) {
  return screen.getDisplayMatching?.(bounds) || screen.getDisplayNearestPoint({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }) || screen.getPrimaryDisplay();
}
function placeWindow(win, screen, position = 'center') {
  if (!win || win.isDestroyed()) return null;
  const bounds = win.getBounds();
  const placed = placementBounds(bounds, displayForBounds(screen, bounds).workArea, position);
  moveWindow(win, placed.x, placed.y);
  return placed;
}

/** Native cursor polling keeps dragging reliable across window moves and DPI boundaries.
 * A docked window stays INSIDE its display's work area. The renderer slides its cube
 * away and leaves a narrow handle, while the native window becomes click-through.
 * This avoids leaking an offscreen cube into a neighbouring monitor or the taskbar.
 */
function createMiniBehavior({ win, screen, onState = () => {}, now = Date.now, hideDelay = 900, autoStart = true }) {
  let disposed = false, timer = null, drag = null, edge = null, hidden = false, leaveAt = null;
  let lastMoved = false, holdUntil = 0;
  const alive = () => !disposed && !win.isDestroyed();
  const visible = () => alive() && win.isVisible();
  const state = () => ({ edge, hidden, dragging: !!drag, moved: drag?.moved || lastMoved, visible: visible(), bounds: alive() ? win.getBounds() : null });
  function publish() {
    const value = state();
    if (alive() && !win.webContents?.isDestroyed?.()) win.webContents?.send('mini:state', value);
    onState(value);
    return value;
  }
  function inputMode() { if (alive()) win.setIgnoreMouseEvents(hidden, { forward: true }); }
  function stopTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function schedule() {
    stopTimer();
    if (autoStart && visible()) timer = setTimeout(() => { timer = null; tick(); schedule(); }, drag ? 16 : hidden ? 100 : 60);
  }
  function move(bounds) {
    const current = win.getBounds();
    if (current.x !== bounds.x || current.y !== bounds.y) moveWindow(win, Math.round(bounds.x), Math.round(bounds.y));
  }
  function reveal(holdMs = 0) {
    if (!alive()) return;
    holdUntil = Math.max(holdUntil, now() + (Number.isFinite(holdMs) ? holdMs : 0));
    hidden = false; leaveAt = null; inputMode(); publish(); schedule();
  }
  function hideAtEdge() {
    if (!alive() || !edge || drag) return;
    hidden = true; leaveAt = null; inputMode(); publish(); schedule();
  }
  function updateDrag() {
    if (!drag || !visible()) return;
    const point = screen.getCursorScreenPoint();
    const distance = Math.hypot(point.x - drag.start.x, point.y - drag.start.y);
    if (distance >= 5) drag.moved = true;
    if (!drag.moved) return;
    const area = screen.getDisplayNearestPoint(point).workArea;
    move(clampBounds({ ...win.getBounds(), x: point.x - drag.offset.x, y: point.y - drag.offset.y }, area));
  }
  function tick() {
    if (!visible()) return;
    if (drag) { updateDrag(); return; }
    if (!edge) return;
    if(now()<holdUntil){leaveAt=now();return;}
    const point = screen.getCursorScreenPoint(), bounds = win.getBounds();
    if (hidden) { if (nearDock(point, bounds, edge)) reveal(); return; }
    if (containsPoint(bounds, point, 12)) leaveAt = null;
    else if (leaveAt === null) leaveAt = now();
    else if (now() - leaveAt >= hideDelay) hideAtEdge();
  }
  function startDrag() {
    if (!visible()) return state();
    if (drag) return state();
    reveal();
    const point = screen.getCursorScreenPoint(), bounds = win.getBounds();
    // Cursor position is sourced natively rather than trusting renderer coordinates.
    drag = { start: point, offset: { x: point.x - bounds.x, y: point.y - bounds.y }, moved: false };
    edge = null; lastMoved = false; leaveAt = null;
    publish(); schedule(); return state();
  }
  function endDrag(cancelled = false) {
    if (!drag || !alive()) return { ...state(), cancelled: !!cancelled };
    updateDrag();
    lastMoved = drag.moved; drag = null;
    const bounds = win.getBounds(), area = displayForBounds(screen, bounds).workArea;
    edge = chooseDockEdge(bounds, area);
    move(edge ? dockBounds(bounds, area, edge) : clampBounds(bounds, area));
    leaveAt = now();
    publish(); schedule(); return { ...state(), cancelled: !!cancelled };
  }
  function onShow() {
    hidden = false; leaveAt = now(); inputMode(); publish(); schedule();
  }
  function onHide() {
    drag = null; hidden = false; leaveAt = null; inputMode(); stopTimer(); publish();
  }
  function onDisplaysChanged() {
    if (!alive()) return;
    const bounds = win.getBounds(), area = displayForBounds(screen, bounds).workArea;
    move(edge ? dockBounds(bounds, area, edge) : clampBounds(bounds, area));
    publish();
  }
  function dispose() {
    if (disposed) return;
    stopTimer();
    if (alive()) win.setIgnoreMouseEvents(false, { forward: true });
    disposed = true; drag = null;
    win.removeListener('show', onShow); win.removeListener('hide', onHide); win.removeListener('closed', dispose);
    for (const event of ['display-metrics-changed', 'display-removed', 'display-added']) screen.removeListener?.(event, onDisplaysChanged);
  }
  win.on('show', onShow); win.on('hide', onHide); win.on('closed', dispose);
  for (const event of ['display-metrics-changed', 'display-removed', 'display-added']) screen.on?.(event, onDisplaysChanged);
  schedule();
  return { startDrag, endDrag, reveal, state, tick, dispose };
}

module.exports = { placementBounds, clampBounds, chooseDockEdge, dockBounds, containsPoint, nearDock, placeWindow, createMiniBehavior, trackWindowSize, moveWindow };
