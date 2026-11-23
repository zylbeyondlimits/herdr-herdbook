import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScrollState,
  recordDragAnchor,
  recordHoverIndex,
  resetScrollAnchor,
  autoScrollOnDrag,
  startModDrag,
  reportDragTarget,
} from "./build/herdbook-agents/drag.mjs";

function makeRoute2Host() {
  const store = {};
  return {
    spaces: () => [
      { id: "s1", name: "ws-01", machine: null, tabs: [{ id: "t1" }, { id: "t2" }] },
      { id: "s7", name: "ws-07", machine: null, tabs: [{ id: "t7a" }, { id: "t7b" }] },
    ],
    panes: () => [
      { pane: "p1", terminal: "a1", tab: "t1", focused: true },
      { pane: "p7a", terminal: "a7a", tab: "t7a", focused: false },
      { pane: "p7b", terminal: "a7b", tab: "t7b", focused: false },
    ],
    terminals: () => [],
    shared: (k) => store[k] ?? null,
    setShared: (k, v) => { store[k] = v; return null; },
  };
}

test("trackpad scroll down + press/drag Tab header keeps scroll position 100% steady (never jumps to top)", () => {
  const h = makeRoute2Host();
  const scrolled = [];
  const scrollHandle = { scroll_to_item: (idx) => scrolled.push(idx) };
  const scrollState = createScrollState();

  // 1) User hovers row 1 near top of Agents, then two-finger scrolls down to ws-07 (row 24):
  recordHoverIndex(scrollState, 1, 100);
  assert.equal(scrollState.index, 1);
  resetScrollAnchor(scrollState);
  assert.equal(scrollState.index, null, "wheel scroll clears stale top-row index");

  // 2) User presses Tab header t7b (row 24) at window y=560 (inside viewport y=400..700):
  recordDragAnchor(scrollState, { position: { x: 80, y: 560 } }, 24, 200);
  startModDrag(h, { kind: "tab", tab: "t7b", label: "tab-b", x: 80, y: 560 }, 200);

  // 3) User drags 10px down to reorder t7b within ws-07 (local_position.y=170 in 300px viewport):
  reportDragTarget(
    h,
    { position: { x: 80, y: 570 }, bounds: { x: 8, y: 566, width: 240, height: 8 } },
    { type: "gap", key: "gap-s7-after-t7b", space: "s7", after: "t7b" },
    240,
  );
  autoScrollOnDrag(
    h,
    scrollHandle,
    scrollState,
    { position: { x: 80, y: 570 }, local_position: { x: 80, y: 170 }, bounds: { x: 0, y: 400, width: 268, height: 300 } },
    32,
    false,
    240,
  );
  assert.deepEqual(scrolled, [], "dragging within viewport interior triggers 0 scroll_to_item calls");

  // 4) Even if user pressed Tab header right near the top edge (local_position.y=10) and moved 6px sideways/up:
  recordDragAnchor(scrollState, { position: { x: 80, y: 410 } }, 20, 400);
  autoScrollOnDrag(
    h,
    scrollHandle,
    scrollState,
    { position: { x: 92, y: 404 }, local_position: { x: 92, y: 4 }, bounds: { x: 0, y: 400, width: 268, height: 300 } },
    32,
    false,
    450,
  );
  assert.deepEqual(scrolled, [], "small <12px vertical move near top edge does not jump scroll");

  // 5) Deliberate drag >=12px into top edge scrolls smoothly one row up (20 -> 19), never to 0:
  autoScrollOnDrag(
    h,
    scrollHandle,
    scrollState,
    { position: { x: 92, y: 396 }, local_position: { x: 92, y: 2 }, bounds: { x: 0, y: 400, width: 268, height: 300 } },
    32,
    false,
    600,
  );
  assert.deepEqual(scrolled, [19]);
});
