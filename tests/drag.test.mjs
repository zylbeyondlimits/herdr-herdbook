import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasNativeDrag,
  startModDrag,
  cancelModDrag,
  activeDrag,
  reportDragTarget,
  trackDragMove,
  isJsTarget,
  finishJsDrag,
  executeDrop,
  gapSlotIndex,
  autoScrollOnDrag,
} from "./build/herdbook-agents/drag.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fakeOfficialHost({ commands = [] } = {}) {
  const store = {};
  let clock = 0;
  let seq = 0;
  const nextId = (p) => `${p}${++seq}`;
  const state = {
    spaces: [
      { id: "s1", name: "api", machine: null, tabs: [{ id: "ta1" }, { id: "ta2" }] },
      { id: "s2", name: "web", machine: null, tabs: [{ id: "tb1" }] },
    ],
    panes: [
      { pane: "p1", terminal: "t1", tab: "ta1", focused: true },
      { pane: "p2", terminal: "t2", tab: "ta1", focused: false },
      { pane: "p3", terminal: "t3", tab: "ta2", focused: true },
      { pane: "p4", terminal: "t4", tab: "tb1", focused: true },
    ],
    shown: "s1",
    log: [],
  };
  const dropEmpty = () => {
    for (const s of state.spaces) s.tabs = s.tabs.filter((t) => state.panes.some((p) => p.tab === t.id));
    state.spaces = state.spaces.filter((s) => s.tabs.length > 0);
  };
  const run = (name, args = {}) => {
    state.log.push([name, args]);
    if (name === "space.move") {
      const idx = state.spaces.findIndex((s) => s.id === args.id);
      if (idx >= 0) {
        const [sp] = state.spaces.splice(idx, 1);
        state.spaces.splice(Math.max(0, Math.min(state.spaces.length, args.index - 1)), 0, sp);
      }
    } else if (name === "tab.move") {
      for (const s of state.spaces) {
        const idx = s.tabs.findIndex((t) => t.id === args.id);
        if (idx >= 0) {
          const [tb] = s.tabs.splice(idx, 1);
          if (args.space) {
            const dst = state.spaces.find((x) => x.id === args.space);
            if (dst) dst.tabs.push(tb);
          } else {
            s.tabs.splice(Math.max(0, Math.min(s.tabs.length, args.index - 1)), 0, tb);
          }
          break;
        }
      }
    } else if (name === "pane.move") {
      const p = state.panes.find((x) => x.pane === args.pane || (args.terminal && x.terminal === args.terminal));
      const dst = state.spaces.find((x) => x.id === args.space);
      if (p && dst) {
        const tid = nextId("tm");
        dst.tabs.push({ id: tid });
        p.tab = tid;
        dropEmpty();
      }
    } else if (name === "terminal.park") {
      state.panes = state.panes.filter((p) => p.terminal !== args.terminal);
      dropEmpty();
    } else if (name === "space.select") {
      state.shown = args.id;
    } else if (name === "space.new") {
      const m = args.machine || null;
      const prefix = m ? `${m}/` : "";
      const s = { id: `${prefix}${nextId("sN")}`, name: "new", machine: m, tabs: [{ id: `${prefix}${nextId("tN")}` }] };
      state.spaces.push(s);
      state.panes.push({ pane: `${prefix}${nextId("pN")}`, terminal: `${prefix}${nextId("tN")}`, tab: s.tabs[0].id, focused: true });
      state.shown = s.id;
    } else if (name === "tab.close") {
      state.panes = state.panes.filter((p) => p.tab !== args.id);
      dropEmpty();
    } else if (name === "pane.focus") {
      for (const p of state.panes) p.focused = p.pane === args.pane;
    } else if (name === "pane.swap") {
      const i = state.panes.findIndex((p) => p.pane === args.pane);
      const j = state.panes.findIndex((p) => p.pane === args.target);
      if (i >= 0 && j >= 0) [state.panes[i], state.panes[j]] = [state.panes[j], state.panes[i]];
    } else if (name === "terminal.keep") {
      const sp = state.spaces.find((s) => s.id === state.shown);
      let tabId = null;
      if (args.place === "right" || args.place === "down") {
        tabId = state.panes.find((p) => p.focused && sp.tabs.some((t) => t.id === p.tab))?.tab ?? null;
      }
      if (!tabId) {
        tabId = nextId("tk");
        sp.tabs.push({ id: tabId });
      }
      state.panes.push({ pane: nextId("pk"), terminal: args.terminal, tab: tabId, focused: true });
    }
    return null;
  };
  const h = {
    spaces: () => state.spaces,
    panes: () => state.panes,
    terminals: () => [],
    focused: () => ({ space: state.shown }),
    commands: () => commands,
    shared: (k) => store[k] ?? null,
    setShared: (k, v) => { store[k] = v; return null; },
    run,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  };
  return { h, state, store };
}

test("all 4 copies of drag.js across mods stay byte-for-byte identical", () => {
  const paths = [
    "mods/herdbook-agents/drag.js",
    "mods/herdbook-tabs/drag.js",
    "mods/herdbook-pane/drag.js",
    "mods/herdbook-spaces/drag.js",
  ];
  const canon = readFileSync(resolve(rootDir, paths[0]), "utf8");
  for (const rel of paths.slice(1)) {
    const content = readFileSync(resolve(rootDir, rel), "utf8");
    assert.equal(content, canon, `${rel} drifted from ${paths[0]}`);
  }
});

test("Route 2 (official Herdr pure-JS): threshold, target validation, and cross-tab pane merge", async () => {
  const { h, state } = fakeOfficialHost();
  assert.equal(hasNativeDrag(h), false);

  startModDrag(h, { kind: "pane", pane: "p2", terminal: "t2", label: "zsh", x: 10, y: 10 }, 100);
  assert.equal(activeDrag(h, 100), null, "below 5px threshold does not activate drag");

  const evt = { position: { x: 20, y: 80 }, bounds: { x: 0, y: 70, width: 200, height: 24 } };
  reportDragTarget(h, evt, { type: "group", key: "grp-ta2", tab: "ta2", name: "ta2" }, 120);
  assert.equal(isJsTarget(h, "grp-ta2", 120), true);

  const d = activeDrag(h, 120);
  const res = await executeDrop(h, d, d.target);
  assert.equal(res.ok, true);
  assert.equal(state.panes.find((p) => p.terminal === "t2")?.tab, "ta2");
});

test("Route 2 (official Herdr pure-JS): splitting a pane into a gap places the new tab at the exact slot", async () => {
  const { h, state } = fakeOfficialHost();
  startModDrag(h, { kind: "pane", pane: "p2", terminal: "t2", label: "zsh", x: 10, y: 10 }, 100);
  const evt = { position: { x: 20, y: 50 }, bounds: { x: 0, y: 45, width: 200, height: 12 } };
  reportDragTarget(h, evt, { type: "gap", key: "gap-s1-after-ta1", space: "s1", after: "ta1" }, 120);

  const d = activeDrag(h, 120);
  const res = await executeDrop(h, d, d.target);
  assert.equal(res.ok, true);
  const s1Tabs = state.spaces.find((s) => s.id === "s1").tabs.map((t) => t.id);
  const t2Tab = state.panes.find((p) => p.terminal === "t2").tab;
  assert.deepEqual(s1Tabs, ["ta1", t2Tab, "ta2"]);
});

test("Route 2 (official Herdr pure-JS): workspace drag reorder via space-order", async () => {
  const { h, state } = fakeOfficialHost();
  startModDrag(h, { kind: "space", space: "s1", label: "api", x: 10, y: 10 }, 100);
  const evt = { position: { x: 10, y: 60 }, bounds: { x: 0, y: 50, width: 200, height: 28 } };
  reportDragTarget(h, evt, { type: "space-order", key: "spo-s2", space: "s2", index: 2, name: "web", machine: null }, 120);

  const d = activeDrag(h, 120);
  const res = await executeDrop(h, d, d.target);
  assert.equal(res.ok, true);
  assert.deepEqual(state.spaces.map((s) => s.id), ["s2", "s1"]);
});

test("stale JS drag cleanup, out-of-bounds pointer exit, and cancelModDrag safety", () => {
  const { h, state, store } = fakeOfficialHost();
  let stopped = 0;
  const cx = { stop_propagation: () => { stopped++; }, spawn: (fn) => fn({ sleep: async () => {} }) };

  // Unmoved press expires after 1500ms and is pruned on next move.
  startModDrag(h, { kind: "pane", pane: "p1", terminal: "t1", x: 10, y: 10 }, 100);
  trackDragMove(h, { position: { x: 30, y: 30 } }, 1700);
  assert.equal(store["herdbook.drag"], null);

  // Active drag clears target when pointer leaves target bounds, and release outside bounds cancels drop.
  startModDrag(h, { kind: "pane", pane: "p2", terminal: "t2", x: 10, y: 10 }, 2000);
  reportDragTarget(
    h,
    { position: { x: 20, y: 80 }, bounds: { x: 0, y: 70, width: 200, height: 24 } },
    { type: "space", key: "sp-s2", space: "s2", name: "web", machine: null },
    2050,
  );
  assert.equal(isJsTarget(h, "sp-s2", 2050), true);

  trackDragMove(h, { position: { x: 20, y: 200 } }, 2100);
  assert.equal(isJsTarget(h, "sp-s2", 2100), false);

  // Re-enter target, then idle past 2500ms (e.g. mouse released over terminal): finishJsDrag ignores stale drag.
  reportDragTarget(
    h,
    { position: { x: 20, y: 80 }, bounds: { x: 0, y: 70, width: 200, height: 24 } },
    { type: "space", key: "sp-s2", space: "s2", name: "web", machine: null },
    2150,
  );
  assert.equal(activeDrag(h, 4800), null, "idle drag past 2500ms expires");
  assert.equal(finishJsDrag(h, cx, null, 4800, { x: 20, y: 80 }), false);
  assert.equal(state.log.length, 0);

  // cancelModDrag clears shared state and stops propagation so buttons never start drags.
  startModDrag(h, { kind: "pane", pane: "p1", terminal: "t1", x: 5, y: 5 }, 5000);
  cancelModDrag(h, cx);
  assert.equal(store["herdbook.drag"], null);
  assert.equal(stopped, 1);
});

test("mod panes without terminals: same-tab swap works on 0.1.16, cross-space gated until pane.move exists", async () => {
  const { h: hOld, state: stOld } = fakeOfficialHost();
  stOld.panes.push({ pane: "pmod", terminal: null, mod: "files", tab: "ta1", focused: false });

  // Cross-space drop target rejected on 0.1.16 (no terminal to park/keep).
  startModDrag(hOld, { kind: "pane", pane: "pmod", terminal: null, label: "Files", x: 10, y: 10 }, 100);
  reportDragTarget(
    hOld,
    { position: { x: 20, y: 80 }, bounds: { x: 0, y: 70, width: 200, height: 24 } },
    { type: "space", key: "sp-s2", space: "s2", name: "web", machine: null },
    120,
  );
  assert.equal(isJsTarget(hOld, "sp-s2", 120), false);

  // Same-tab swap with p1 IS allowed on 0.1.16!
  reportDragTarget(
    hOld,
    { position: { x: 20, y: 40 }, bounds: { x: 0, y: 30, width: 200, height: 24 } },
    { type: "pane-head", key: "ph-p1-right", tab: "ta1", pane: "p1", name: "zsh", place: "right" },
    140,
  );
  assert.equal(isJsTarget(hOld, "ph-p1-right", 140), true);
  const swapRes = await executeDrop(hOld, activeDrag(hOld, 140), activeDrag(hOld, 140).target);
  assert.equal(swapRes.ok, true);
  assert.deepEqual(stOld.log.at(-1), ["pane.swap", { pane: "pmod", target: "p1" }]);

  // On builds WITH native pane.move & tab.move { space }, mod panes move across spaces with clean string args.
  const { h: hNew, state: stNew } = fakeOfficialHost({
    commands: [
      { name: "pane.move", args: [{ name: "pane" }, { name: "terminal" }, { name: "space" }] },
      { name: "tab.move", args: [{ name: "id" }, { name: "space" }] },
    ],
  });
  stNew.panes.push({ pane: "pmod", terminal: null, mod: "files", tab: "ta1", focused: false });
  startModDrag(hNew, { kind: "pane", pane: "pmod", terminal: null, x: 10, y: 10 }, 100);
  reportDragTarget(
    hNew,
    { position: { x: 20, y: 80 }, bounds: { x: 0, y: 70, width: 200, height: 24 } },
    { type: "space", key: "sp-s2", space: "s2", name: "web", machine: null },
    120,
  );
  assert.equal(isJsTarget(hNew, "sp-s2", 120), true);
  const moveRes = await executeDrop(hNew, activeDrag(hNew, 120), activeDrag(hNew, 120).target);
  assert.equal(moveRes.ok, true);
  assert.deepEqual(stNew.log.at(-1), ["pane.move", { pane: "pmod", space: "s2" }]);
});

test("remote SSH machine/tN addresses enforce same-machine isolation and forward machine on new space", async () => {
  const { h, state } = fakeOfficialHost();
  state.spaces.push(
    { id: "vps/s1", name: "remote-api", machine: "vps", tabs: [{ id: "vps/ta1" }] },
    { id: "vps/s2", name: "remote-worker", machine: "vps", tabs: [{ id: "vps/tb1" }] },
  );
  state.panes.push(
    { pane: "vps/p1", terminal: "vps/t7", tab: "vps/ta1", cwd: "/srv/api", focused: true },
    { pane: "vps/p2", terminal: "vps/t8", tab: "vps/tb1", cwd: "/srv/worker", focused: true },
  );

  startModDrag(h, { kind: "pane", pane: "vps/p1", terminal: "vps/t7", label: "zsh", x: 10, y: 10 }, 100);

  // Local space s1 is rejected for remote pane vps/t7.
  reportDragTarget(
    h,
    { position: { x: 20, y: 40 }, bounds: { x: 0, y: 30, width: 200, height: 24 } },
    { type: "space", key: "sp-local", space: "s1", name: "api", machine: null },
    120,
  );
  assert.equal(isJsTarget(h, "sp-local", 120), false);

  // New space on the same remote machine succeeds and passes machine: "vps" + folder: "/srv/api".
  reportDragTarget(
    h,
    { position: { x: 20, y: 120 }, bounds: { x: 0, y: 110, width: 200, height: 24 } },
    { type: "space", key: "sp-vps-new", space: "new", name: "New space", machine: "vps" },
    140,
  );
  assert.equal(isJsTarget(h, "sp-vps-new", 140), true);
  const d = activeDrag(h, 140);
  const res = await executeDrop(h, d, d.target);
  assert.equal(res.ok, true);
  assert.ok(state.log.some(([cmd, args]) => cmd === "space.new" && args.machine === "vps" && args.folder === "/srv/api"));
});

test("Route 1 (Native Herdr drag) & edge autoScrollOnDrag", () => {
  const calls = [];
  let current = null;
  const nativeHost = {
    startDrag: (s) => { calls.push(["startDrag", s]); current = { ...s, space: "s1", machine: null }; },
    dragging: () => current,
    setDragSpace: (t) => calls.push(["setDragSpace", t]),
    setDragTab: (t) => calls.push(["setDragTab", t]),
    setDragGroup: (t) => calls.push(["setDragGroup", t]),
    setDragGap: (t) => calls.push(["setDragGap", t]),
  };
  assert.equal(hasNativeDrag(nativeHost), true);
  startModDrag(nativeHost, { kind: "pane", pane: "p1", terminal: "t1", x: 5, y: 5 });
  reportDragTarget(nativeHost, { position: { x: 20, y: 20 }, bounds: { x: 10, y: 10, width: 100, height: 24 } }, { type: "group", key: "g1", tab: "ta2", name: "ta2" });
  assert.equal(calls[0][0], "startDrag");
  assert.equal(calls[1][0], "setDragGroup");
  assert.equal(calls[1][1].tab, "ta2");
  assert.equal(gapSlotIndex([{ id: "a" }, { id: "b" }, { id: "c" }], null, "a", "c"), 2);

  const scrolled = [];
  const scrollHandle = { scroll_to_item: (idx) => scrolled.push(idx) };
  const scrollState = { index: 2, lastAt: 0 };
  autoScrollOnDrag(nativeHost, scrollHandle, scrollState, { local_position: { x: 10, y: 190 }, bounds: { x: 0, y: 0, width: 200, height: 200 } }, 10, false, 500);
  assert.deepEqual(scrolled, [4]);
});
