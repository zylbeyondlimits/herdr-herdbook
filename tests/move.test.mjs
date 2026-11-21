// node --test tests/   (run.mjs copies each mod's pure .js to .mjs first)
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveTerminals } from "./build/herdbook-menu/move.mjs";

// A tiny Herdr: commands land `lag` ms after they're run, like the real one.
function fakeHerdr({ lag = 60, broken = [] } = {}) {
  let clock = 0, n = 0;
  const id = (p) => `${p}${++n}`;
  const st = {
    spaces: [
      { id: "sA", tabs: [{ id: "tA1" }, { id: "tA2" }] },
      { id: "sB", tabs: [{ id: "tB1" }] },
    ],
    panes: [
      { pane: "p1", terminal: "t1", tab: "tA1", focused: true },
      { pane: "p2", terminal: "t2", tab: "tA2", focused: false },
      { pane: "p3", terminal: "t3", tab: "tA2", focused: false },
      { pane: "p4", terminal: "t4", tab: "tB1", focused: false },
    ],
    shown: "sA",
    log: [],
  };
  const pending = [];
  const later = (fn) => pending.push({ at: clock + lag, fn });
  const dropEmpty = () => {
    for (const s of st.spaces) s.tabs = s.tabs.filter((t) => st.panes.some((p) => p.tab === t.id));
    st.spaces = st.spaces.filter((s) => s.tabs.length);
  };
  const shownTab = () => st.spaces.find((s) => s.id === st.shown)?.tabs[0]?.id;
  const handlers = {
    "terminal.park": ({ terminal }) => { st.panes = st.panes.filter((p) => p.terminal !== terminal); dropEmpty(); },
    "space.select": ({ id }) => { st.shown = id; },
    "space.new": () => {
      const s = { id: id("sN"), tabs: [{ id: id("tN") }] };
      st.spaces.push(s);
      st.panes.push({ pane: id("pN"), terminal: id("tN"), tab: s.tabs[0].id, focused: true });
      st.shown = s.id;
    },
    "terminal.keep": ({ terminal, place }) => {
      const space = st.spaces.find((s) => s.id === st.shown);
      let tab;
      if (place === "right") tab = st.panes.find((p) => p.focused && space.tabs.some((t) => t.id === p.tab))?.tab;
      if (!tab) { tab = id("tK"); space.tabs.push({ id: tab }); }
      st.panes.push({ pane: id("pK"), terminal, tab, focused: false });
    },
    "pane.focus": ({ pane }) => { for (const p of st.panes) p.focused = p.pane === pane; },
    "tab.close": ({ id: tab }) => { st.panes = st.panes.filter((p) => p.tab !== tab); dropEmpty(); },
    "tab.rename": () => {},
  };
  const api = {
    panes: () => st.panes,
    spaces: () => st.spaces,
    focused: () => ({ space: st.shown }),
    run: (name, args) => {
      st.log.push(name);
      if (!broken.includes(name)) later(() => handlers[name](args ?? {}));
      return null;
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      for (const p of pending.splice(0).sort((a, b) => a.at - b.at)) {
        if (p.at <= clock) p.fn(); else pending.push(p);
      }
    },
  };
  return { api, st };
}

const where = (st, addr) => {
  const tab = st.panes.find((p) => p.terminal === addr)?.tab;
  return st.spaces.find((s) => s.tabs.some((t) => t.id === tab))?.id ?? null;
};

test("a pane moves to another space and nothing else does", async () => {
  const { api, st } = fakeHerdr();
  const r = await moveTerminals(api, { addrs: ["t2"], space: "sB" });
  assert.deepEqual(r, { ok: true, space: "sB" });
  assert.equal(where(st, "t2"), "sB");
  assert.equal(where(st, "t3"), "sA");
});

test("keep waits for the target space to show (the old fixed 30 ms raced)", async () => {
  const { api, st } = fakeHerdr({ lag: 200 });
  const r = await moveTerminals(api, { addrs: ["t2"], space: "sB" });
  assert.equal(r.ok, true);
  assert.equal(where(st, "t2"), "sB");
});

test("a tab's terminals move together, side by side", async () => {
  const { api, st } = fakeHerdr();
  const r = await moveTerminals(api, { addrs: ["t2", "t3"], space: "sB" });
  assert.equal(r.ok, true);
  const tabs = ["t2", "t3"].map((a) => st.panes.find((p) => p.terminal === a).tab);
  assert.equal(tabs[0], tabs[1]);
  assert.equal(where(st, "t3"), "sB");
});

test("a new space keeps only the moved pane, not its own extra shell", async () => {
  const { api, st } = fakeHerdr();
  const r = await moveTerminals(api, { addrs: ["t2"], space: "new" });
  assert.equal(r.ok, true);
  await api.sleep(100); // the extra tab's close lands
  const s = st.spaces.find((x) => x.id === r.space);
  assert.equal(s.tabs.length, 1);
  assert.deepEqual(st.panes.filter((p) => p.tab === s.tabs[0].id).map((p) => p.terminal), ["t2"]);
});

test("if keep never lands, the parked terminal goes back to its own space", async () => {
  const { api, st } = fakeHerdr({ broken: ["space.select"] });
  const r = await moveTerminals(api, { addrs: ["t2"], space: "sB", timeout: 500 });
  assert.equal(r.ok, false);
  assert.ok(st.panes.some((p) => p.terminal === "t2"), "t2 still has a pane");
});

test("nothing to move is an error, not a run", async () => {
  const { api, st } = fakeHerdr();
  assert.equal((await moveTerminals(api, { addrs: [], space: "sB" })).ok, false);
  assert.deepEqual(st.log, []);
});
