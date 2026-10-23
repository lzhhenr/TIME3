/** Direct cube dragging with click/drag separation, plus a slim edge-reveal handle. */
export function initMini({ element, desktop, onClick = () => {} }) {
  if (!element) return () => {};
  let active = null, disposed = false, nativeState = null;
  const body = element.ownerDocument.body;
  const doc = element.ownerDocument;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const handle = doc.createElement('span');
  handle.className = 'mini-edge-handle'; handle.setAttribute('aria-hidden', 'true');
  Object.assign(handle.style, { position: 'fixed', display: 'none', pointerEvents: 'none', borderRadius: '999px', background: '#efa75e', boxShadow: 'inset 0 0 0 1px #ffffff55', zIndex: '5' });
  body.append(handle);
  element.style.touchAction = 'none';
  element.style.webkitAppRegion = 'no-drag';
  element.style.userSelect = 'none';
  function renderState(value) {
    if (!value || disposed) return;
    nativeState = value;
    const hidden = value.hidden && value.visible;
    body.dataset.miniDock = value.edge || 'none';
    body.classList.toggle('mini-edge-hidden', !!hidden);
    body.classList.toggle('mini-dragging', !!value.dragging);
    element.style.cursor = value.dragging ? 'grabbing' : 'grab';
    element.style.transition = reduced || !value.visible ? 'none' : 'transform 180ms cubic-bezier(.2,.8,.2,1), opacity 130ms ease-out';
    const movement = { left: 'translateX(-110%)', right: 'translateX(110%)', top: 'translateY(-110%)', bottom: 'translateY(110%)' };
    element.style.transform = hidden ? movement[value.edge] || 'none' : 'none';
    element.style.opacity = hidden ? '0' : '1';
    handle.style.display = hidden ? 'block' : 'none';
    Object.assign(handle.style, { left: 'auto', top: 'auto', right: 'auto', bottom: 'auto', width: '5px', height: '50px', transform: 'none' });
    if (value.edge === 'left' || value.edge === 'right') {
      handle.style[value.edge] = '0'; handle.style.top = '50%'; handle.style.transform = 'translateY(-50%)';
    } else if (value.edge) {
      handle.style[value.edge] = '0'; handle.style.left = '50%'; handle.style.transform = 'translateX(-50%)'; handle.style.width = '50px'; handle.style.height = '5px';
    }
  }
  function pointerDown(event) {
    if (event.button !== 0 || !event.isPrimary || active) return;
    event.preventDefault();
    const start = desktop?.beginMiniDrag?.();
    active = { id: event.pointerId, screenX: event.screenX, screenY: event.screenY, moved: false, start: Promise.resolve(start).catch(() => null) };
    element.setPointerCapture(event.pointerId);
    element.style.cursor = 'grabbing';
  }
  function pointerMove(event) {
    if (active?.id === event.pointerId && Math.hypot(event.screenX - active.screenX, event.screenY - active.screenY) >= 5) active.moved = true;
  }
  async function finish(event, cancelled = false) {
    if (!active || (event.pointerId !== undefined && active.id !== event.pointerId)) return;
    event.preventDefault?.();
    const pointer = active; active = null;
    if (element.hasPointerCapture(pointer.id)) element.releasePointerCapture(pointer.id);
    await pointer.start;
    const result = await desktop?.endMiniDrag?.(cancelled).catch(() => ({ moved: true }));
    if (disposed) return;
    element.style.cursor = 'grab';
    if (!cancelled && !pointer.moved && !result?.moved && !result?.cancelled) onClick();
  }
  const pointerUp = event => finish(event);
  const pointerCancel = event => finish(event, true);
  const click = event => { event.preventDefault(); if (event.detail === 0 && !active) onClick(); };
  const dragStart = event => event.preventDefault();
  const visibility = () => { if (doc.hidden) { if (active) finish({}, true); element.style.transition = 'none'; } else if (nativeState) renderState(nativeState); };
  element.addEventListener('pointerdown', pointerDown); element.addEventListener('pointermove', pointerMove);
  element.addEventListener('pointerup', pointerUp); element.addEventListener('pointercancel', pointerCancel);
  element.addEventListener('lostpointercapture', pointerCancel); element.addEventListener('click', click); element.addEventListener('dragstart', dragStart);
  doc.addEventListener('visibilitychange', visibility);
  const unsubscribe = desktop?.onMiniState?.(renderState);
  desktop?.getMiniState?.().then(renderState).catch(() => {});
  return () => {
    if (disposed) return;
    if (active) finish({}, true);
    disposed = true; unsubscribe?.(); handle.remove();
    element.removeEventListener('pointerdown', pointerDown); element.removeEventListener('pointermove', pointerMove);
    element.removeEventListener('pointerup', pointerUp); element.removeEventListener('pointercancel', pointerCancel);
    element.removeEventListener('lostpointercapture', pointerCancel); element.removeEventListener('click', click); element.removeEventListener('dragstart', dragStart);
    doc.removeEventListener('visibilitychange', visibility);
  };
}
