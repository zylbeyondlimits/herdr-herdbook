import { test } from "node:test";
import assert from "node:assert/strict";
import { chip, label, hasTrailingSibling, tabChipDropAction } from "./build/herdbook-tabs/names.mjs";

const shell = { name: "zsh", key: "zsh", shell: true, icon: "icons/shell.svg", tint: true };
const claude = { name: "Claude Code", key: "claude", agent: true, icon: "icons/claude.svg" };
const pane = (terminal, program, extra = {}) => ({ terminal, program, title: program?.name ?? "", ...extra });

test("one pane, unnamed: Herdr's label", () => {
  const k = chip({ id: "a", named: false, name: "1" }, [pane("t1", shell)], new Map());
  assert.deepEqual([k.kind, k.name], ["one", "zsh"]);
});

test("one pane with a given name: terminal label -> pane.name -> agent.pane_name", () => {
  const kLabel = chip({ id: "a", named: false, name: "1" }, [pane("t1", shell, { name: "from-pane" })], new Map([["t1", "api"]]));
  assert.equal(kLabel.name, "api");

  const kPane = chip({ id: "a", named: false, name: "1" }, [pane("t1", shell, { name: "from-pane", pane_name: "from-agent" })], new Map());
  assert.equal(kPane.name, "from-pane");

  const kAgent = chip({ id: "a", named: false, name: "1" }, [pane("t1", claude, { pane_name: "from-agent" })], new Map());
  assert.equal(kAgent.name, "from-agent");

  const kMod = chip({ id: "a", named: false, name: "1" }, [{ pane: "p5", terminal: null, mod: "files", title: "Files", name: "Docs" }], new Map());
  assert.equal(kMod.name, "Docs");
});

test("several panes: each pane's name in split order (including 0.1.17 pane.name)", () => {
  const k = chip(
    { id: "a", named: false, name: "1" },
    [pane("t1", claude, { name: "reviewer" }), pane("t2", shell)],
    new Map([["t2", "logs"]]),
  );
  assert.equal(k.kind, "many");
  assert.equal(k.name, "reviewer · logs");
  assert.equal(k.segments.length, 2);
});

test("several panes in a tab someone named: a group, its name, every icon", () => {
  const k = chip({ id: "a", named: true, name: "login fix" }, [pane("t1", claude), pane("t2", shell)], new Map());
  assert.deepEqual([k.kind, k.name, k.icons.length, k.tip], ["group", "login fix", 2, "Claude Code · zsh"]);
});

test("a tab Herdr named after its program isn't a group", () => {
  const k = chip({ id: "a", named: true, name: "Claude Code" }, [pane("t1", claude), pane("t2", shell)], new Map());
  assert.equal(k.kind, "many");
});

test("zoomed: only the zoomed pane", () => {
  const k = chip({ id: "a", named: false, zoomed: true }, [pane("t1", claude), pane("t2", shell, { zoomed: true })], new Map([["t2", "logs"]]));
  assert.deepEqual([k.kind, k.name], ["one", "logs"]);
});

test("an agent's live title shows on an unnamed tab, as Herdr does", () => {
  assert.equal(label({ named: false }, pane("t1", claude, { title: "✳ Fix the login form" })), "Fix the login form");
  assert.equal(label({ named: false }, pane("t1", claude, { title: "~/code/app" })), "Claude Code");
});

test("segments and a group's icons carry their pane, so each can be dragged", () => {
  const panes = [pane("t1", claude, { pane: "p1" }), pane("t2", shell, { pane: "p2" })];
  const many = chip({ id: "a", named: false, name: "1" }, panes, new Map());
  assert.deepEqual(many.segments.map((g) => [g.pane, g.terminal]), [["p1", "t1"], ["p2", "t2"]]);
  const group = chip({ id: "a", named: true, name: "login fix" }, panes, new Map());
  assert.deepEqual(group.members.map((g) => [g.pane, g.terminal, g.name]), [["p1", "t1", "Claude Code"], ["p2", "t2", "zsh"]]);
});

test("hasTrailingSibling detects usage-meter, frost, or both in tabs-row and ignores hidden siblings", () => {
  const standalone = {
    type: "column",
    children: [{ id: "tabs", type: "block", content: { mod: "herdbook-tabs" } }],
  };
  assert.equal(hasTrailingSibling(standalone), false);

  const withFrostThenUsage = {
    type: "column",
    children: [
      {
        id: "tabs-row",
        type: "row",
        children: [
          { id: "tabs", type: "block", content: { mod: "herdbook-tabs" } },
          { id: "frost", type: "block", content: { mod: "frost", props: { block: "frost" } } },
          { id: "usage", type: "block", content: { mod: "usage-meter", props: { block: "usage" } } },
        ],
      },
    ],
  };
  assert.equal(hasTrailingSibling(withFrostThenUsage), true);

  const withFrostOnly = {
    type: "row",
    children: [
      { id: "tabs", type: "block", content: { mod: "herdbook-tabs" } },
      { id: "frost", type: "block", content: { mod: "frost" } },
    ],
  };
  assert.equal(hasTrailingSibling(withFrostOnly), true);

  const withHiddenTrailing = {
    type: "row",
    children: [
      { id: "tabs", type: "block", content: { mod: "herdbook-tabs" } },
      { id: "usage", type: "block", hidden: true, content: { mod: "usage-meter" } },
    ],
  };
  assert.equal(hasTrailingSibling(withHiddenTrailing), false);
});

test("tabChipDropAction supports merging single-pane tabs, splitting out to edges/own edges, and multi-pane tab reorder", () => {
  const allPanes = [
    { pane: "p1", terminal: "t1", tab: "tb1" },
    { pane: "p2", terminal: "t2", tab: "tb2" },
    { pane: "p3", terminal: "t3", tab: "tb2" },
    { pane: "p4", terminal: "t4", tab: "tb3" },
  ];
  const bounds = { x: 200, y: 8, width: 100, height: 29 };

  // 1) Dragging a 1-pane tab (kind: "tab") onto center of tb2 merges into tb2.
  const mergeTab = tabChipDropAction({
    drag: { kind: "tab", tab: "tb1" },
    tab: { id: "tb2", name: "tb2" },
    tabLabel: "backend",
    spaceId: "s1",
    panes: allPanes,
    bounds,
    localX: 50,
  });
  assert.equal(mergeTab.type, "group");
  assert.equal(mergeTab.tab, "tb2");
  assert.equal(mergeTab.name, "backend");

  // 2) Dragging a 1-pane tab onto left/right edge of tb2 reorders before/after tb2 with edge sub-rect.
  const beforeTab = tabChipDropAction({
    drag: { kind: "tab", tab: "tb1" },
    tab: { id: "tb2", name: "tb2" },
    spaceId: "s1",
    panes: allPanes,
    bounds,
    localX: 5,
  });
  assert.equal(beforeTab.type, "gap");
  assert.equal(beforeTab.before, "tb2");
  assert.equal(beforeTab.bounds.x, 200);
  assert.ok(beforeTab.bounds.width <= 23);

  const afterTab = tabChipDropAction({
    drag: { kind: "tab", tab: "tb1" },
    tab: { id: "tb2", name: "tb2" },
    spaceId: "s1",
    panes: allPanes,
    bounds,
    localX: 95,
  });
  assert.equal(afterTab.type, "gap");
  assert.equal(afterTab.after, "tb2");
  assert.ok(afterTab.bounds.x >= 277 && afterTab.bounds.x + afterTab.bounds.width === 300);

  // 3) Dragging a 1-pane tab over itself is ignored.
  assert.equal(
    tabChipDropAction({ drag: { kind: "tab", tab: "tb1" }, tab: { id: "tb1" }, spaceId: "s1", panes: allPanes, bounds, localX: 5 }),
    null,
  );

  // 4) Dragging a pane segment from multi-pane tb2 onto center of tb3 merges into tb3.
  const segMerge = tabChipDropAction({
    drag: { kind: "pane", pane: "p2", terminal: "t2" },
    tab: { id: "tb3", name: "tb3" },
    tabLabel: "docs",
    spaceId: "s1",
    panes: allPanes,
    bounds,
    localX: 50,
  });
  assert.deepEqual(segMerge, { type: "group", key: "tabgrp-tb3", tab: "tb3", name: "docs", bounds });

  // 5) Dragging a pane segment from tb2 onto tb2's OWN left/right edge splits out before/after tb2; center cancels.
  const ownLeft = tabChipDropAction({
    drag: { kind: "pane", pane: "p2", terminal: "t2" },
    tab: { id: "tb2" },
    spaceId: "s1",
    panes: allPanes,
    bounds,
    localX: 6,
  });
  assert.equal(ownLeft.type, "gap");
  assert.equal(ownLeft.before, "tb2");

  const ownRight = tabChipDropAction({
    drag: { kind: "pane", pane: "p2", terminal: "t2" },
    tab: { id: "tb2" },
    spaceId: "s1",
    panes: allPanes,
    bounds,
    localX: 94,
  });
  assert.equal(ownRight.type, "gap");
  assert.equal(ownRight.after, "tb2");

  assert.equal(
    tabChipDropAction({ drag: { kind: "pane", pane: "p2", terminal: "t2" }, tab: { id: "tb2" }, spaceId: "s1", panes: allPanes, bounds, localX: 50 }),
    null,
  );

  // 6) Dragging a 2-pane whole tab (kind: "tab") over tb3 only reorders left/right, never merges.
  const multiLeft = tabChipDropAction({
    drag: { kind: "tab", tab: "tb2" },
    tab: { id: "tb3" },
    spaceId: "s1",
    panes: allPanes,
    bounds,
    localX: 40,
  });
  assert.equal(multiLeft.type, "gap");
  assert.equal(multiLeft.before, "tb3");

  const multiRight = tabChipDropAction({
    drag: { kind: "tab", tab: "tb2" },
    tab: { id: "tb3" },
    spaceId: "s1",
    panes: allPanes,
    bounds,
    localX: 60,
  });
  assert.equal(multiRight.type, "gap");
  assert.equal(multiRight.after, "tb3");
});
