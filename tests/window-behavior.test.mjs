import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { placementBounds, clampBounds, chooseDockEdge, dockBounds, nearDock, createMiniBehavior } = require('../electron/window-behavior.cjs');

test('all five placements use current work area, including a negative-coordinate display', () => {
  const area = { x: -1920, y: -140, width: 1920, height: 1040 };
  const bounds = { x: 0, y: 0, width: 1180, height: 820 };
  const expected = { 'top-left': [-1904, -124], 'top-right': [-1196, -124], 'bottom-left': [-1904, 64], 'bottom-right': [-1196, 64], center: [-1550, -30] };
  for (const [position, [x, y]] of Object.entries(expected)) assert.deepEqual(placementBounds(bounds, area, position), { ...bounds, x, y });
  assert.deepEqual(placementBounds(bounds, area, 'invalid'), placementBounds(bounds, area, 'center'));
});
test('edge docking stays inside work area; handles reveal only near the docked edge', () => {
  const area = { x: 100, y: 30, width: 2134, height: 1160 };
  const bounds = { x: 2100, y: 400, width: 112, height: 130 };
  assert.equal(chooseDockEdge(bounds, area), 'right');
  const docked = dockBounds(bounds, area, 'right');
  assert.equal(docked.x + docked.width, area.x + area.width);
  assert.equal(nearDock({ x: 2233, y: 466 }, docked, 'right'), true);
  assert.equal(nearDock({ x: 2150, y: 466 }, docked, 'right'), false);
  assert.equal(nearDock({ x: 2233, y: 700 }, docked, 'right'), false);
  assert.deepEqual(clampBounds({ ...bounds, x: -500, y: 2000 }, area), { ...bounds, x: 100, y: 1060 });
});
function fixture() {
  let point = { x: 165, y: 165 }, time = 0;
  const primary = { workArea: { x: 0, y: 0, width: 1200, height: 800 } };
  const secondary = { workArea: { x: -1600, y: -100, width: 1600, height: 900 } };
  const win = new EventEmitter();
  win.bounds = { x: 100, y: 100, width: 112, height: 130 }; win.visible = true; win.destroyed = false;
  win.getBounds = () => ({ ...win.bounds }); win.isDestroyed = () => win.destroyed; win.isVisible = () => win.visible;
  win.setPosition = (x, y) => { win.bounds.x = x; win.bounds.y = y; };
  win.setIgnoreMouseEvents = value => { win.ignoring = value; };
  win.webContents = { send() {}, isDestroyed: () => false };
  const screen = new EventEmitter();
  screen.getCursorScreenPoint = () => ({ ...point });
  screen.getDisplayNearestPoint = p => p.x < 0 ? secondary : primary;
  screen.getDisplayMatching = b => b.x < 0 ? secondary : primary;
  const controller = createMiniBehavior({ win, screen, autoStart: false, now: () => time });
  return { win, screen, controller, move: p => { point = p; }, advance: ms => { time += ms; controller.tick(); } };
}
test('a click stays a click; a drag follows native screen coordinates across displays', () => {
  const f = fixture();
  f.controller.startDrag(); f.move({ x: 167, y: 166 });
  assert.equal(f.controller.endDrag().moved, false);
  assert.deepEqual(f.win.getBounds(), { x: 100, y: 100, width: 112, height: 130 });
  f.controller.startDrag(); f.move({ x: -500, y: 300 }); f.controller.tick();
  assert.deepEqual(f.win.getBounds(), { x: -567, y: 234, width: 112, height: 130 });
  assert.equal(f.controller.endDrag().moved, true);
  f.controller.dispose();
});
test('dock waits before hiding, becomes click-through, reveals near edge and stops when hidden', () => {
  const f = fixture();
  f.controller.startDrag(); f.move({ x: 1195, y: 300 }); f.controller.tick();
  assert.equal(f.controller.endDrag().edge, 'right');
  assert.equal(f.win.bounds.x, 1088);
  f.move({ x: 600, y: 500 }); f.advance(899);
  assert.equal(f.controller.state().hidden, false);
  f.advance(2); assert.equal(f.controller.state().hidden, true); assert.equal(f.win.ignoring, true);
  f.move({ x: 1199, y: 300 }); f.controller.tick();
  assert.equal(f.controller.state().hidden, false); assert.equal(f.win.ignoring, false);
  f.win.visible = false; f.win.emit('hide'); f.move({ x: 0, y: 0 }); f.advance(2000);
  assert.equal(f.controller.state().visible, false); assert.equal(f.controller.state().hidden, false);
  f.controller.dispose(); assert.equal(f.win.listenerCount('show'), 0); assert.equal(f.screen.listenerCount('display-removed'), 0);
});
test('display changes keep the mini cube within a remaining display', () => {
  const f = fixture();
  f.win.bounds = { x: -1400, y: 50, width: 112, height: 130 };
  f.screen.getDisplayMatching = () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } });
  f.screen.emit('display-removed');
  assert.equal(f.win.bounds.x, 0);
  f.controller.dispose();
});

test('repeated moves retain logical dimensions instead of feeding fractional-DPI bounds back',()=>{
 const {trackWindowSize,moveWindow}=require('../electron/window-behavior.cjs');
 let bounds={x:0,y:0,width:114,height:114};const win={getBounds:()=>({...bounds}),on:()=>{},setBounds:next=>{bounds={...next,width:next.width+2,height:next.height+2};}};
 trackWindowSize(win,{width:112,height:112});for(let n=0;n<100;n++)moveWindow(win,n,n);assert.equal(bounds.width,114);assert.equal(bounds.height,114);
});
