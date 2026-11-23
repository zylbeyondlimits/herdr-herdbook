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
