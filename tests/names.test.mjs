import { test } from "node:test";
import assert from "node:assert/strict";
import { chip, label, hasTrailingSibling } from "./build/herdbook-tabs/names.mjs";

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
