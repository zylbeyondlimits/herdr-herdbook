// Context menus: Herdr's items, plus naming panes and moving panes, agents and
// tabs to another space. Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "agent" | "move-space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes; → opens "Move to space…", ← goes back.
// An item is [label, command, args, meta?]; a command "worktree" opens the
// worktree dialog instead, "action:*" items are this menu's own.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, focused, exec, shared, commands, notify, appHome, readTextFile } from "herdr";
import * as herdrAll from "herdr";
import { moveTerminals } from "./move.js";

// Whether a mod is installed (readTextFile: fs/promises only reads under the home folder).
const installed = (name) => readTextFile(`${appHome()}/mods/${name}/mod.json`).then((s) => s !== null, () => false);

// The spaces list's color marks (shared "space.colors", set by Herdr's spaces mod).
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const MOVE = "action:move";
const RENAME_PANE = "action:rename-pane";
const SUBMENU = "submenu:move-space";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

const spaceOfTab = (tab) => spaces().find((s) => (s.tabs ?? []).some((t) => t.id === tab)) ?? null;
const paneOf = (tg) => panes().find((p) => (tg.pane && p.pane === tg.pane) || (tg.terminal && p.terminal === tg.terminal)) ?? null;
const machineOfId = (id) => (id && id.includes("/") ? id.split("/")[0] : null);

// The space a target is in now: given, its tab's, or its pane's.
function spaceOf(tg) {
  if (tg.space) return spaces().find((s) => s.id === tg.space) ?? null;
  if (tg.kind === "tab") return spaceOfTab(tg.id);
  return spaceOfTab(paneOf(tg)?.tab);
}

// The terminals a move takes: a tab's, else the one pane's.
function terminalsOf(tg) {
  if (tg.kind === "tab") return [...new Set(panes().filter((p) => p.tab === tg.id && p.terminal).map((p) => p.terminal))];
  const addr = tg.terminal ?? paneOf(tg)?.terminal;
  return addr ? [addr] : [];
}

// Moves with Herdr's own commands when it has them (a build with pane.move
// and tab.move's space), else parks and keeps the terminals (move.js).
function nativeMove() {
  const args = (name) => commands().find((c) => c.name === name)?.args?.map((a) => a.name) ?? [];
  return args("pane.move").includes("space") && args("tab.move").includes("space");
}

function hasPaneRenameCmd() {
  return commands().some((c) => c.name === "pane.rename");
}

// Spaces on the target's machine it isn't in, then a new one.
function moveItems(tg) {
  const from = spaceOf(tg);
  const addr = tg.terminal ?? paneOf(tg)?.terminal ?? null;
  const machine = from ? (from.machine ?? null) : (machineOfId(addr) ?? machineOfId(tg.pane) ?? machineOfId(tg.id));
  const others = spaces().filter((s) => (s.machine ?? null) === machine && s.id !== from?.id);
  const colors = shared("space.colors") ?? {};
  return [
    ...others.map((s) => [s.name, MOVE, { target: tg, space: s.id }, { mark: colors[s.id] ?? "ansi6", name: s.name }]),
    ["Move to new space", MOVE, { target: tg, space: "new" }, { icon: "mods/workspace-chrome/folder-plus.svg", dividerBefore: others.length > 0 }],
  ];
}

function items(p, git, sub, can) {
  if (sub) return moveItems(sub);
  p = p ?? {};
  const tg = p.target ?? {};
  const hasPaneRename = hasPaneRenameCmd();
  const hasNativeMove = nativeMove();
  const rename = (label, target) => [label, RENAME_PANE, { target }, { icon: "mods/workspace-chrome/square-pen.svg" }];
  const nativeRename = (label, pane) => [label, "pane.rename", { pane }, { icon: "mods/workspace-chrome/square-pen.svg" }];
  const move = (target) => [`Move to space…`, SUBMENU, target, { submenu: true }];
  switch (p.tab) {
    case "move-space":
      return moveItems(tg);
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab (a layout terminal block, a window) has
      // no pane to split, zoom, rename, move or close: its pane is the block's id.
      const own = panes().find((pane) => pane.pane === tg.pane);
      const addr = tg.terminal ?? own?.terminal ?? null;
      return [
        ...(own
          ? [
              ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
              ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
              ["Zoom", "pane.zoom", { pane: tg.pane }],
              ...((addr || hasPaneRename) && can.rename
                ? [rename("Rename pane", { pane: tg.pane, terminal: addr })]
                : hasPaneRename ? [nativeRename("Rename pane", tg.pane)] : []),
              ...(addr || hasNativeMove ? [move({ kind: "pane", pane: tg.pane, terminal: addr })] : []),
            ]
          : []),
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ...(own ? [["Close pane", "pane.close", { pane: tg.pane }]] : []),
      ];
    }
    // A sidebar row: target { pane, terminal, space?, pinned?, sub?, isAgent? }.
    case "agent": {
      // The tab it's in: the tab frame shown in the sidebar.
      const tabId = tg.pane ? panes().find((x) => x.pane === tg.pane)?.tab ?? null : null;
      return [
        ...((tg.terminal || (tg.pane && hasPaneRename)) && can.rename
          ? [rename(tg.pane ? "Rename pane" : "Rename", { pane: tg.pane, terminal: tg.terminal })]
          : tg.pane && hasPaneRename ? [nativeRename("Rename pane", tg.pane)] : []),
        ...(tabId ? [["Rename tab", "tab.rename", { id: tabId }]] : []),
        ...(tg.pane && (tg.terminal || hasNativeMove) ? [move({ kind: "pane", pane: tg.pane, terminal: tg.terminal, space: tg.space })] : []),
        ...(!tg.sub && tg.terminal && tg.isAgent !== false
          ? [[tg.pinned ? "Unpin agent" : "Pin to top", "terminal.pin", { terminal: tg.terminal, pinned: !tg.pinned }, { icon: `mods/workspace-chrome/${tg.pinned ? "pin-off" : "pin"}.svg` }]]
          : []),
        ...(tg.sub && !tg.pane && tg.terminal ? [["Open as tab", "terminal.keep", { terminal: tg.terminal }]] : []),
        ...(tg.pane
          ? [["Close pane", "pane.close", { pane: tg.pane }]]
          : tg.terminal ? [["Stop sub-agent", "terminal.kill", { terminal: tg.terminal }]] : []),
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ...(terminalsOf({ kind: "tab", id: tg.id }).length || hasNativeMove ? [move({ kind: "tab", id: tg.id, space: tg.space })] : []),
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Close", "space.close", { id: tg.id }],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command, meta) {
  if (meta?.icon) return meta.icon;
  if (command === SUBMENU || command === MOVE) return "mods/workspace-chrome/layers.svg";
  const name = command.endsWith(".close") || command === "terminal.kill" ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  if (name.includes(":")) return "";
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.sub = null;
    this.moving = false;
    this.can = { rename: false };
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (typeof herdrAll.checking === "function" && herdrAll.checking()) return;
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    cx.spawn(async (cx) => {
      this.can = { rename: await installed("herdbook-rename") };
      if (folder) this.git = await checkout(folder, space.machine).catch(() => null);
      cx.notify();
    });
  }

  move(spec, cx) {
    const tg = spec.target ?? {};
    const overlay = props()?.overlay;
    if (nativeMove()) {
      closeOverlay(overlay);
      if (tg.kind === "tab") {
        run("tab.move", { id: tg.id, space: spec.space });
      } else {
        const moveArgs = { space: spec.space };
        if (tg.pane) moveArgs.pane = tg.pane;
        if (tg.terminal) moveArgs.terminal = tg.terminal;
        run("pane.move", moveArgs);
      }
      return;
    }
    const addrs = terminalsOf(tg);
    const from = spaceOf(tg);
    const addr0 = addrs[0] ?? tg.terminal ?? null;
    const machine = from ? (from.machine ?? null) : machineOfId(addr0);
    const lead = panes().find((p) => addrs.includes(p.terminal) && p.cwd);
    const tab = tg.kind === "tab" ? from?.tabs?.find((t) => t.id === tg.id) : null;
    // Closing the overlay ends this copy and its tasks: hide the menu instead
    // and close it when the move is done.
    this.moving = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const api = { panes, spaces, focused, run, sleep: (ms) => cx.sleep(ms), now: () => Date.now() };
      try {
        const r = await moveTerminals(api, {
          addrs,
          space: spec.space,
          folder: lead?.cwd ?? null,
          machine,
          tabName: tab?.named ? tab.name : null,
        });
        if (!r.ok) notify({ title: "Couldn't move", body: r.error, level: "error" });
      } finally {
        closeOverlay(overlay);
      }
    });
  }

  choose(i, cx) {
    if (this.moving) return;
    const it = items(props(), this.git, this.sub, this.can)[i];
    if (!it) return;
    if (it[1] === SUBMENU) {
      this.sub = it[2];
      this.at = 0;
      cx.notify();
      return;
    }
    if (it[1] === MOVE) return this.move(it[2], cx);
    closeOverlay(props()?.overlay);
    if (it[1] === RENAME_PANE) openOverlay({ mod: "herdbook-rename", kind: "dialog", width: 380, props: it[2] });
    else if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  back(cx) {
    this.sub = null;
    this.at = 0;
    cx.notify();
  }

  render() {
    if (this.moving) return div().size(0).overflow_hidden();
    const t = theme();
    const p = props();
    const list = items(p, this.git, this.sub, this.can);
    const moving = Boolean(this.sub) || p?.tab === "move-space";
    if (this.at >= list.length) this.at = Math.max(0, list.length - 1);
    const leading = (it) => {
      const meta = it[3];
      if (!meta?.mark) return svg(menuIcon(it[1], meta)).size(14).flex_none().text_color(t.muted);
      const fill = meta.mark.startsWith("#") ? meta.mark : (MARK[meta.mark] ?? t[meta.mark] ?? t.accent);
      return h_flex().size(16).flex_none().rounded(4).bg(fill).items_center().justify_center()
        .text_size(9.5).font_bold().text_color("#ffffff").child([...(meta.name || "?")][0].toUpperCase());
    };
    const rows = list.map((it, i) => {
      const meta = it[3];
      const divider = i > 0 && (meta?.dividerBefore || it[1].endsWith(".close") || it[1] === "terminal.kill" || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme"));
      return v_flex()
        .when(divider, (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`mi-${i}`).h(31).px(8).gap(9).rounded(7).items_center().justify_between().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(i, cx))
          .child(leading(it))
          .child(div().flex_1().min_w(0).truncate().child(it[0]))
          .when(Boolean(meta?.submenu), (el) => el.child(svg("mods/workspace-chrome/chevron-right.svg").size(12).flex_none().text_color(t.dim)))
          .when(!meta?.submenu, (el) => el.child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))));
    });
    return v_flex().id("menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (this.moving) return;
        if (e.key === "down") this.at = list.length ? (this.at + 1) % list.length : 0;
        else if (e.key === "up") this.at = list.length ? (this.at + list.length - 1) % list.length : 0;
        else if (e.key === "enter" || (e.key === "right" && list[this.at]?.[3]?.submenu)) return this.choose(this.at, cx);
        else if ((e.key === "left" || e.key === "backspace") && this.sub) return this.back(cx);
        else if (e.key === "escape") return closeOverlay(p?.overlay);
        else return;
        cx.notify();
      })
      .when(moving, (el) => el.child(h_flex().id("menu-move-head").h(27).px(8).mb(3).gap(6).items_center().rounded(6)
        .border_b(1).border_color(t.border).text_size(11.5).text_color(t.dim)
        .when(Boolean(this.sub), (h) => h.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.back(cx))
          .child(svg("mods/workspace-chrome/chevron-left.svg").size(12).flex_none()))
        .child(div().flex_1().truncate().child("Move to space"))))
      .child(v_flex().w_full().min_h(0).when(moving && list.length > 6, (el) => el.max_h(224).overflow_y_scrollbar()).children(rows));
  }
}
