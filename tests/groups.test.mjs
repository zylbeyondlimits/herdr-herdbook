import { test } from "node:test";
import assert from "node:assert/strict";
import { groupedOrder, frameName, paneNames } from "./build/herdbook-agents/groups.mjs";

const ag = (address, space, tab, extra = {}) => ({ address, space, tab, ...extra });

test("the space with the latest change comes first; its tabs keep their order", () => {
  const list = [ag("a1", "A", "ta1"), ag("a2", "A", "ta2"), ag("b1", "B", "tb1")];
  const at = { a1: 10, a2: 20, b1: 30 };
  const out = groupedOrder(list, (a) => at[a.address]).map((a) => a.address);
  assert.deepEqual(out, ["b1", "a1", "a2"]);
});

test("within a tab, the agent that changed last comes first", () => {
  const list = [ag("x", "A", "t1"), ag("y", "A", "t1"), ag("z", "A", "t1")];
  const at = { x: 1, y: 3, z: 2 };
  assert.deepEqual(groupedOrder(list, (a) => at[a.address]).map((a) => a.address), ["y", "z", "x"]);
});

test("ties keep Herdr's order", () => {
  const list = [ag("a", "A", "t1"), ag("b", "B", "t2")];
  assert.deepEqual(groupedOrder(list, () => 0).map((a) => a.address), ["a", "b"]);
});

test("a tab named after its program isn't a group name", () => {
  const panes = [{ tab: "t1", program: { name: "Claude Code" } }];
  assert.equal(frameName({ id: "t1", named: true, name: "Claude Code" }, panes), null);
  assert.equal(frameName({ id: "t1", named: true, name: "login fix" }, panes), "login fix");
  assert.equal(frameName({ id: "t1", named: false, name: "1" }, panes), null);
});

test("rows reading the same get numbers in split order; tab numbers become program names", () => {
  const list = [ag("t2", "A", "t1", { program: { name: "zsh" } }), ag("t1", "A", "t1", { program: { name: "zsh" } }), ag("t3", "A", "t1", { program: { name: "Codex" } })];
  const order = new Map([["t1", 0], ["t2", 1], ["t3", 2]]);
  const out = paneNames(list, order, () => "1");
  assert.deepEqual(Object.fromEntries(out), { t1: "zsh 1", t2: "zsh 2", t3: "Codex" });
});
