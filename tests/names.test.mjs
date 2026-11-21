import { test } from "node:test";
import assert from "node:assert/strict";
import { chip, label } from "./build/herdbook-tabs/names.mjs";

const shell = { name: "zsh", key: "zsh", shell: true, icon: "icons/shell.svg", tint: true };
const claude = { name: "Claude Code", key: "claude", agent: true, icon: "icons/claude.svg" };
const pane = (terminal, program, extra = {}) => ({ terminal, program, title: program.name, ...extra });

test("one pane, unnamed: Herdr's label", () => {
  const k = chip({ id: "a", named: false, name: "1" }, [pane("t1", shell)], new Map());
  assert.deepEqual([k.kind, k.name], ["one", "zsh"]);
});

test("one pane with a given name: that name", () => {
  const k = chip({ id: "a", named: false, name: "1" }, [pane("t1", shell)], new Map([["t1", "api"]]));
  assert.equal(k.name, "api");
});

test("several panes: each pane's name in split order", () => {
  const k = chip({ id: "a", named: false, name: "1" }, [pane("t1", claude), pane("t2", shell)], new Map([["t2", "logs"]]));
  assert.equal(k.kind, "many");
  assert.equal(k.name, "Claude Code · logs");
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
