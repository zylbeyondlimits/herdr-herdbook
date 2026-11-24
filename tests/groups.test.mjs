import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceTree, frameName, tabPaneNames, paneNames, customPaneName } from "./build/herdbook-agents/groups.mjs";

const shell = { name: "zsh", key: "zsh", shell: true };
const claude = { name: "Claude Code", key: "claude", agent: true };

test("workspaceTree preserves exact workspace, tab, and pane split order without jumping on status changes", () => {
  const spaces = [
    { id: "s1", name: "api", tabs: [{ id: "t1" }, { id: "t2" }] },
    { id: "s2", name: "web", tabs: [{ id: "t3" }] },
  ];
  const panes = [
    { pane: "p1", terminal: "a1", tab: "t1", program: shell },
    { pane: "p2", terminal: "a2", tab: "t1", program: claude },
    { pane: "p3", terminal: "a3", tab: "t2", program: shell },
    { pane: "p4", terminal: "a4", tab: "t3", program: claude },
  ];
  const tree = workspaceTree(spaces, panes);
  assert.deepEqual(tree.map((w) => w.space.id), ["s1", "s2"]);
  assert.deepEqual(tree[0].tabs.map((t) => [t.tab.id, t.panes.map((p) => p.pane)]), [
    ["t1", ["p1", "p2"]],
    ["t2", ["p3"]],
  ]);
  assert.deepEqual(tree[1].tabs[0].panes.map((p) => p.pane), ["p4"]);
});

test("a tab named after its program isn't a custom tab name", () => {
  const panes = [{ tab: "t1", program: { name: "Claude Code" } }];
  assert.equal(frameName({ id: "t1", named: true, name: "Claude Code" }, panes), null);
  assert.equal(frameName({ id: "t1", named: true, name: "login fix" }, panes), "login fix");
  assert.equal(frameName({ id: "t1", named: false, name: "1" }, panes), null);
});

test("tabPaneNames honors custom pane-name, 0.1.17 pane.name / pane_name fallback, live agent titles, mod panes, and numbers duplicates", () => {
  const inTab = [
    { pane: "p1", terminal: "t1", tab: "tb1", title: "~/code", program: shell },
    { pane: "p2", terminal: "t2", tab: "tb1", title: "~/code", program: shell },
    { pane: "p3", terminal: "t3", tab: "tb1", title: "✦ Fix auth token", program: claude },
    { pane: "p4", terminal: "t4", tab: "tb1", title: "zsh", name: "pane-fallback", program: shell },
    { pane: "p5", terminal: "t5", tab: "tb1", title: "zsh", name: "native-pane-name", program: shell },
    { pane: "p6", terminal: "t6", tab: "tb1", title: "✦ Working", pane_name: "agent-pane-name", program: claude },
    { pane: "p7", terminal: null, mod: "files", tab: "tb1", title: "Files", name: "Repo browser" },
  ];
  // t4 has both terminal label and pane.name -> terminal label wins.
  const named = new Map([["t4", "server"]]);
  const out = tabPaneNames(inTab, named);
  assert.deepEqual(Object.fromEntries(out), {
    p1: "zsh 1",
    p2: "zsh 2",
    p3: "Fix auth token",
    p4: "server",
    p5: "native-pane-name",
    p6: "agent-pane-name",
    p7: "Repo browser",
  });
  assert.equal(customPaneName({ terminal: "t4", name: "old", pane_name: "older" }, named), "server");
  assert.equal(customPaneName({ terminal: "t5", name: "native", pane_name: "older" }, named), "native");
  assert.equal(customPaneName({ terminal: "t6", pane_name: "from-agent" }, named), "from-agent");
});

test("paneNames wrapper numbers duplicate labels in split order", () => {
  const list = [
    { address: "t2", space: "A", tab: "t1", program: { name: "zsh" } },
    { address: "t1", space: "A", tab: "t1", program: { name: "zsh" } },
    { address: "t3", space: "A", tab: "t1", program: { name: "Codex" } },
  ];
  const order = new Map([["t1", 0], ["t2", 1], ["t3", 2]]);
  const out = paneNames(list, order, () => "1");
  assert.deepEqual(Object.fromEntries(out), { t1: "zsh 1", t2: "zsh 2", t3: "Codex" });
});

// ---------------------------------------------------------------------------
// Group shrink + status bubbling
// ---------------------------------------------------------------------------
import {
  stepTabGroupCounts,
  isStatusJumpTransition,
  effectivePaneStatus,
  reconcileOrder,
  createTreeOrderState,
  stepWorkspaceTree,
  applyManualDropToTreeOrder,
} from "./build/herdbook-agents/groups.mjs";

test("a named group that shrinks to one pane is unfolded and dissolved; others are left alone", () => {
  const spaces = [{ id: "s1", tabs: [{ id: "t1", named: true, name: "login fix" }, { id: "t2", named: false, name: "2" }, { id: "t3", named: true, name: "Claude Code" }] }];
  const two = (tab) => [{ pane: `${tab}a`, tab, program: claude }, { pane: `${tab}b`, tab, program: claude }];
  const before = stepTabGroupCounts({}, spaces, [...two("t1"), ...two("t2"), ...two("t3")]);
  assert.deepEqual(before.dissolveTabIds, []);
  assert.deepEqual(before.nextCounts, { t1: 2, t2: 2, t3: 2 });
  const after = stepTabGroupCounts(before.nextCounts, spaces, [
    { pane: "t1a", tab: "t1", program: claude }, { pane: "t2a", tab: "t2", program: claude }, { pane: "t3a", tab: "t3", program: claude },
  ]);
  assert.deepEqual(after.dissolveTabIds, ["t1"], "only the tab with a given name dissolves (not unnamed, not program-named)");
  assert.deepEqual(after.unfoldTabIds.sort(), ["t1", "t2", "t3"]);
  const again = stepTabGroupCounts(after.nextCounts, spaces, [{ pane: "t1a", tab: "t1", program: claude }]);
  assert.deepEqual(again.dissolveTabIds, [], "1 -> 1 does nothing");
  const mid = stepTabGroupCounts(before.nextCounts, spaces, []);
  assert.deepEqual(mid.nextCounts, before.nextCounts, "a tab with no panes keeps its last count (mid-move)");
});

test("status jump rules: done -> idle (just looked) never lifts", () => {
  assert.equal(isStatusJumpTransition("done", "idle"), false);
  assert.equal(isStatusJumpTransition("idle", "done"), true);
  assert.equal(isStatusJumpTransition("working", "done"), true);
  assert.equal(isStatusJumpTransition("working", "blocked"), true);
  assert.equal(isStatusJumpTransition("blocked", "working"), true);
  assert.equal(isStatusJumpTransition("working", "idle"), true);
  assert.equal(isStatusJumpTransition(null, "working"), true);
  assert.equal(isStatusJumpTransition("idle", "idle"), false);
  assert.equal(isStatusJumpTransition("working", null), false);
  assert.equal(effectivePaneStatus({ terminal: "a" }, new Map([["a", "idle"]]), ["working", "error"]), "blocked");
  assert.equal(effectivePaneStatus({ terminal: "a" }, new Map([["a", "idle"]]), ["done"]), "idle");
});

const tabsOf = (tree, id) => tree.find((w) => w.space.id === id).tabs;

function world(status = {}) {
  const spaces = [
    { id: "s1", name: "api", tabs: [{ id: "t1", status: null }] },
    { id: "s2", name: "web", tabs: [{ id: "t2", status: null }, { id: "t3", status: null }] },
  ];
  const panes = [
    { pane: "p1", terminal: "a1", tab: "t1", status: status.p1 ?? "idle", program: claude },
    { pane: "p2", terminal: "a2", tab: "t2", status: status.p2 ?? "idle", program: claude },
    { pane: "p3", terminal: "a3", tab: "t3", status: status.p3 ?? "idle", program: claude },
    { pane: "p4", terminal: "a4", tab: "t3", status: status.p4 ?? "idle", program: claude },
  ];
  return { spaces, panes };
}

test("first render only seeds; a status change lifts pane -> group -> workspace, numbering stays by split order", () => {
  const w0 = world();
  const first = stepWorkspaceTree(createTreeOrderState(), w0.spaces, w0.panes);
  assert.deepEqual(first.tree.map((w) => w.space.id), ["s1", "s2"]);
  assert.deepEqual(tabsOf(first.tree, "s2").map((t) => t.tab.id), ["t2", "t3"]);
  assert.deepEqual(tabsOf(first.tree, "s2")[1].panes.map((p) => p.pane), ["p3", "p4"]);

  const w1 = world({ p4: "working" });
  const second = stepWorkspaceTree(first.state, w1.spaces, w1.panes);
  assert.deepEqual(second.tree.map((w) => w.space.id), ["s2", "s1"], "workspace lifted to the top");
  assert.equal(second.tree[0].spaceIndex, 0);
  assert.equal(second.tree[0].modelSpaceIndex, 1);
  assert.equal(second.tree[1].modelSpaceIndex, 0);
  assert.deepEqual(tabsOf(second.tree, "s2").map((t) => t.tab.id), ["t3", "t2"], "group lifted to the top of its workspace");
  const g = tabsOf(second.tree, "s2")[0];
  assert.deepEqual(g.panes.map((p) => p.pane), ["p4", "p3"], "pane lifted to the top of its group");
  assert.deepEqual(g.splitPanes.map((p) => p.pane), ["p3", "p4"], "split order kept for stable numbering");
  assert.deepEqual(Object.fromEntries(tabPaneNames(g.splitPanes)), { p3: "Claude Code 1", p4: "Claude Code 2" });

  // Nothing changed: the order stays.
  const third = stepWorkspaceTree(second.state, w1.spaces, w1.panes);
  assert.deepEqual(third.tree.map((x) => x.space.id), ["s2", "s1"]);
  assert.equal(third.dirty, false);

  // A single-pane tab in another workspace changes (working -> done): its group and workspace lift.
  const w2 = world({ p4: "working", p1: "done" });
  const fourth = stepWorkspaceTree(third.state, w2.spaces, w2.panes);
  assert.deepEqual(fourth.tree.map((x) => x.space.id), ["s1", "s2"]);

  // done -> idle (the person looked): no lift.
  const w3 = world({ p4: "working", p1: "idle" });
  const fifth = stepWorkspaceTree(fourth.state, w3.spaces, w3.panes);
  assert.deepEqual(fifth.tree.map((x) => x.space.id), ["s1", "s2"]);
  assert.equal(fifth.state.paneStatus.p1, "idle");
});

test("reconcileOrder follows Herdr's own moves, new and gone items, and keeps the shown order otherwise", () => {
  assert.deepEqual(reconcileOrder(["c", "a", "b"], ["a", "b", "c"], ["a", "b", "c"]), ["c", "a", "b"]);
  assert.deepEqual(reconcileOrder(["c", "a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"]), ["c", "a", "b", "d"]);
  assert.deepEqual(reconcileOrder(["c", "a", "b"], ["a", "b", "c"], ["a", "c"]), ["c", "a"]);
  // Herdr moved a to the end (space.move / tab.move): a lands after c in the shown order.
  assert.deepEqual(reconcileOrder(["a", "b", "c"], ["a", "b", "c"], ["b", "c", "a"]), ["b", "c", "a"]);
  assert.deepEqual(reconcileOrder([], [], ["x", "y"]), ["x", "y"]);
});

test("a manual drop stays where it was dropped across later renders, until a status change", () => {
  const w0 = world();
  let step = stepWorkspaceTree(createTreeOrderState(), w0.spaces, w0.panes);
  const w1 = world({ p4: "working" });
  step = stepWorkspaceTree(step.state, w1.spaces, w1.panes); // s2 first, t3 first
  assert.deepEqual(tabsOf(step.tree, "s2").map((t) => t.tab.id), ["t3", "t2"]);

  // Drag t3 into the gap before t2 is a no-op visually; drag it below t2 ("after t2"):
  const moved = applyManualDropToTreeOrder(step.state, { kind: "tab", tab: "t3" }, { type: "gap", space: "s2", after: "t2" }, w1.panes);
  assert.equal(moved, true);
  // Herdr's own order for the same drop is [t2, t3]:
  const m1 = { spaces: [w1.spaces[0], { ...w1.spaces[1], tabs: [w1.spaces[1].tabs[0], w1.spaces[1].tabs[1]] }], panes: w1.panes };
  step = stepWorkspaceTree(step.state, m1.spaces, m1.panes);
  assert.deepEqual(tabsOf(step.tree, "s2").map((t) => t.tab.id), ["t2", "t3"]);
  step = stepWorkspaceTree(step.state, m1.spaces, m1.panes);
  assert.deepEqual(tabsOf(step.tree, "s2").map((t) => t.tab.id), ["t2", "t3"], "stays put on later renders");

  // Workspace drop.
  assert.equal(applyManualDropToTreeOrder(step.state, { kind: "space", space: "s2" }, { type: "space-order", space: "s1" }, w1.panes), true);
  assert.deepEqual(step.state.spaceOrder, ["s1", "s2"]);
  step = stepWorkspaceTree(step.state, m1.spaces, m1.panes);
  assert.deepEqual(step.tree.map((x) => x.space.id), ["s1", "s2"], "dropped workspace order sticks");

  // A new status change lifts again.
  const w2 = world({ p4: "working", p2: "blocked" });
  step = stepWorkspaceTree(step.state, m1.spaces, w2.panes);
  assert.deepEqual(tabsOf(step.tree, "s2").map((t) => t.tab.id), ["t2", "t3"]);
  assert.equal(step.tree[0].space.id, "s2");
});
