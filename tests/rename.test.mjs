import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRenameTarget, savePaneName, normalizePaneName } from "./build/herdbook-rename/rename.mjs";

function makeHost({
  propsTarget = null,
  panes = [],
  terminals = [],
  agents = [],
  focused = null,
  commands = [],
  hcCode = 0,
  hcStderr = "",
} = {}) {
  const hcCalls = [];
  const runCalls = [];
  const h = {
    props: () => (propsTarget ? { target: propsTarget, overlay: "ov1" } : { overlay: "ov1" }),
    panes: () => panes,
    terminals: () => terminals,
    agents: () => agents,
    focused: () => focused,
    commands: () => commands,
    hc: async (args) => {
      hcCalls.push(args);
      return { code: hcCode, stdout: "", stderr: hcStderr };
    },
    run: (name, args) => {
      runCalls.push([name, args]);
      return null;
    },
  };
  return { h, hcCalls, runCalls };
}

test("resolveRenameTarget reads terminal.labels['pane-name'] || pane.name || agent.pane_name in priority order", () => {
  const { h: h1 } = makeHost({
    propsTarget: { pane: "p1", terminal: "t1" },
    panes: [{ pane: "p1", terminal: "t1", name: "from-pane" }],
    terminals: [{ address: "t1", labels: { "pane-name": "from-label" } }],
    agents: [{ address: "t1", pane: "p1", pane_name: "from-agent" }],
  });
  assert.equal(resolveRenameTarget(h1).currentName, "from-label");

  const { h: h2 } = makeHost({
    propsTarget: { pane: "p1", terminal: "t1" },
    panes: [{ pane: "p1", terminal: "t1", name: "from-pane" }],
    terminals: [{ address: "t1", labels: {} }],
    agents: [{ address: "t1", pane: "p1", pane_name: "from-agent" }],
  });
  assert.equal(resolveRenameTarget(h2).currentName, "from-pane");

  const { h: h3 } = makeHost({
    propsTarget: { pane: "p1", terminal: "t1" },
    panes: [{ pane: "p1", terminal: "t1" }],
    terminals: [{ address: "t1", labels: {} }],
    agents: [{ address: "t1", pane: "p1", pane_name: "from-agent" }],
  });
  assert.equal(resolveRenameTarget(h3).currentName, "from-agent");
});

test("savePaneName on official Herdr 0.1.16 writes hc label (including remote SSH machine/tN) and skips pane.rename", async () => {
  const { h, hcCalls, runCalls } = makeHost({
    propsTarget: { pane: "vps/p2", terminal: "vps/t7" },
    panes: [{ pane: "vps/p2", terminal: "vps/t7" }],
    commands: [{ name: "pane.split" }],
  });
  const target = resolveRenameTarget(h);
  assert.equal(target.canRename, true);
  assert.equal(target.hasPaneRename, false);

  const res = await savePaneName(h, target, "  api   worker ");
  assert.deepEqual(res, { ok: true, name: "api worker" });
  assert.deepEqual(hcCalls, [["label", "vps/t7", "pane-name=api worker"]]);
  assert.deepEqual(runCalls, []);
});

test("savePaneName on Herdr 0.1.17+ writes BOTH hc label AND pane.rename (and clears both on empty string)", async () => {
  const { h, hcCalls, runCalls } = makeHost({
    focused: { pane: "p1", terminal: "t1" },
    panes: [{ pane: "p1", terminal: "t1", name: "old" }],
    commands: [{ name: "pane.rename" }],
  });
  const target = resolveRenameTarget(h);
  assert.equal(target.canRename, true);
  assert.equal(target.hasPaneRename, true);
  assert.equal(target.currentName, "old");

  await savePaneName(h, target, "auth-service");
  assert.deepEqual(hcCalls[0], ["label", "t1", "pane-name=auth-service"]);
  assert.deepEqual(runCalls[0], ["pane.rename", { pane: "p1", name: "auth-service" }]);

  await savePaneName(h, target, "   ");
  assert.deepEqual(hcCalls[1], ["label", "t1", "pane-name="]);
  assert.deepEqual(runCalls[1], ["pane.rename", { pane: "p1", name: "" }]);
});

test("non-terminal mod panes: rejected on 0.1.16, allowed via pane.rename on 0.1.17+", async () => {
  const modPane = { pane: "p5", terminal: null, mod: "files", title: "Files", name: "Repo tree" };

  const { h: hOld } = makeHost({
    propsTarget: { pane: "p5", terminal: null },
    panes: [modPane],
    commands: [],
  });
  const tOld = resolveRenameTarget(hOld);
  assert.equal(tOld.canRename, false);
  assert.equal((await savePaneName(hOld, tOld, "Docs")).ok, false);

  const { h: hNew, hcCalls, runCalls } = makeHost({
    propsTarget: { pane: "p5", terminal: null },
    panes: [modPane],
    commands: [{ name: "pane.rename" }],
  });
  const tNew = resolveRenameTarget(hNew);
  assert.equal(tNew.canRename, true);
  assert.equal(tNew.isModPane, true);
  assert.equal(tNew.currentName, "Repo tree");

  const r = await savePaneName(hNew, tNew, "Docs");
  assert.deepEqual(r, { ok: true, name: "Docs" });
  assert.deepEqual(hcCalls, [], "mod pane has no terminal, so hc label is not called");
  assert.deepEqual(runCalls, [["pane.rename", { pane: "p5", name: "Docs" }]]);
});

test("layout terminal block outside panes() only writes hc label and never calls pane.rename with block id", async () => {
  const { h, hcCalls, runCalls } = makeHost({
    propsTarget: { pane: "floating-block", terminal: "t9" },
    panes: [{ pane: "p1", terminal: "t1" }],
    commands: [{ name: "pane.rename" }],
  });
  const target = resolveRenameTarget(h);
  assert.equal(target.pane, null);
  assert.equal(target.terminal, "t9");
  await savePaneName(h, target, "monitor");
  assert.deepEqual(hcCalls, [["label", "t9", "pane-name=monitor"]]);
  assert.deepEqual(runCalls, []);
  assert.equal(normalizePaneName("  a\t\nb  "), "a b");
});
