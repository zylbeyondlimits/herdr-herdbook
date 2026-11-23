// Sidebar "Agents" panel (`herdbook-agents`):
// - "Grouped by workspace": full Workspace -> Tab -> Pane graphical tree (including shells,
//   editors, mod panes, agents, and sub-agents) in fixed structural/split order so drag-and-drop
//   placements stay put, with hover `+` quick-actions on Workspace headers and Tab frames.
// - "Priority": status-reporting agents ordered by urgency (Needs you -> Done -> Working -> Idle).
// Supports both Native Herdr drag (Route 1) and Pure-JS shared-state drag on official Herdr (Route 2),
// and reads custom pane names from `labels["pane-name"] || pane.name || agent.pane_name`.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, appHome, readTextFile } from "herdr";
import * as herdrAll from "herdr";
import { workspaceTree, frameName, tabPaneNames, cleanTitle } from "./groups.js";
import {
  activeDrag,
  startModDrag,
  cancelModDrag,
  clearJsDrag,
  reportDragTarget,
  trackDragMove,
  isJsTarget,
  finishJsDrag,
  recentlyDragged,
  autoScrollOnDrag,
} from "./drag.js";

const installed = (name) => readTextFile(`${appHome()}/mods/${name}/mod.json`).then((s) => s !== null, () => false);

const LABEL = "pane-name";
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = cleanTitle(l?.title);
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

const SORTS = [
  { id: "grouped", label: "Grouped by workspace", icon: "layers" },
  { id: "priority", label: "Priority", icon: "clock" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.scroll = ScrollHandle.new();
    this.scrollState = { index: 0, lastAt: 0 };
    this.folded = new Set();
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}"); } catch { this.changed = {}; }
    if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    try { this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]"); } catch { this.pendingPins = []; }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    try { this.groupsFolded = new Set(JSON.parse(localStorage.getItem("groupsFolded") ?? "[]")); } catch { this.groupsFolded = new Set(); }
    try { this.spacesFolded = new Set(JSON.parse(localStorage.getItem("spacesFolded") ?? "[]")); } catch { this.spacesFolded = new Set(); }
    this.hasMenu = false;
    this.hasRename = false;
    this.hasLaunchMenu = false;
    if (typeof herdrAll.checking === "function" && herdrAll.checking()) return;
    clearJsDrag(herdrAll);
    cx.spawn(async (cx) => {
      const [menu, rename, launch] = await Promise.all([
        installed("herdbook-menu"),
        installed("herdbook-rename"),
        installed("launch-menu"),
      ]);
      this.hasMenu = menu;
      this.hasRename = rename;
      this.hasLaunchMenu = launch;
      cx.notify();
    });
    cx.timer.every(30000, (cx) => cx.notify());
  }

  menu(tab, target) {
    if (this.hasMenu) openOverlay({ mod: "herdbook-menu", kind: "popup", width: 228, height: 320, props: { tab, target } });
  }

  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(addr) {
    return (addr && this.changed[addr]?.at) ?? 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("View"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents without their own pane (kept sub-agents already appear as real panes in their tab).
  tree(all, addr, panesByAddr, keepKept = false, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live" && (keepKept || !panesByAddr.has(k.address)));
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, panesByAddr, keepKept, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact, dragNow, panesNow, agentByAddr, rowIndex) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    const ownPaneObj = panesNow.find((p) => p.terminal === k.address) ?? null;
    const ownPane = ownPaneObj?.pane ?? null;
    const subAg = agentByAddr.get(k.address);
    const name = k.labels?.[LABEL] || ownPaneObj?.name || subAg?.pane_name || k.name || k.template || k.program?.name || k.address;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .when(dragNow?.terminal === k.address, (el) => el.opacity(0.55))
      .hover((el) => el.bg(t.hover))
      .on_mouse_down("left", (e) => startModDrag(herdrAll, { kind: "agent", pane: ownPane, terminal: k.address, label: name, x: e.position.x, y: e.position.y }))
      .on_mouse_move((e) => {
        this.scrollState.index = rowIndex;
        trackDragMove(herdrAll, e);
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.menu("agent", { pane: ownPane, terminal: k.address, space: null, sub: true, isAgent: true });
      })
      .on_click(() => {
        if (recentlyDragged()) return;
        if (ownPane) run("pane.focus", { pane: ownPane });
        else this.peek(k.address);
      })
      .children(s.lines.map((l) => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), (el) => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(name))
      .child(this.status(t, { status: st }, compact));
  }

  status(t, a, compact = false) {
    if (!a?.status) return div().size(7).mx(3).flex_none();
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  foldBadge(t, addr, subs) {
    const sts = subs.map((s) => kidStatus(s.t, this.listed));
    const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
    const open = !this.folded.has(addr);
    return div()
      .id(`fold-${addr}`)
      .h(18)
      .px(3)
      .gap(3)
      .flex()
      .items_center()
      .rounded(4)
      .text_size(11)
      .text_color(open ? t.dim : (t[top] ?? t.dim))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? this.folded.add(addr) : this.folded.delete(addr);
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .when(!open, (el) => el.child(String(subs.length)));
  }

  pinButton(t, addr, isPinned) {
    return div()
      .id(`pin-${addr}`)
      .flex_none()
      .p(2)
      .rounded(4)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(isPinned ? "Unpin" : "Pin to the top")
      .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("terminal.pin", { terminal: addr, pinned: !isPinned });
        this.hovered = null;
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
  }

  plusButton(t, id, tip, action, size = 18) {
    return div()
      .id(id)
      .flex_none()
      .size(size)
      .rounded(4)
      .flex()
      .items_center()
      .justify_center()
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.raised).text_color(t.foreground))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!recentlyDragged()) action();
      })
      .child(svg("mods/workspace-chrome/plus.svg").size(11));
  }

  render() {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    const byPriority = sort.id === "priority";
    const now = Date.now();
    const dragNow = activeDrag(herdrAll, now);
    const hasPaneRename = (herdrAll.commands?.() ?? []).some((c) => c.name === "pane.rename");

    const rawAgents = agents();
    this.listed = new Map(rawAgents.map((a) => [a.address, a.status]));
    const agentByAddr = new Map(rawAgents.map((a) => [a.address, a]));
    const agentByPane = new Map(rawAgents.map((a) => [a.pane, a]));
    const all = terminals();
    this.migratePins(all);
    this.track(rawAgents, now);
    const shown = focused()?.agent;
    const focusedPane = focused()?.pane ?? null;
    let focusedRowAt = -1;
    const panesNow = panes().map((p) => {
      const ag = (p.terminal && agentByAddr.get(p.terminal)) || agentByPane.get(p.pane);
      return ag?.pane_name && !p.pane_name ? { ...p, pane_name: ag.pane_name } : p;
    });
    const panesById = new Map(panesNow.map((p) => [p.pane, p]));
    const panesByAddr = new Map(panesNow.filter((p) => p.terminal).map((p) => [p.terminal, p]));
    const spacesNow = spaces();
    const named = new Map(all.filter((k) => k.labels?.[LABEL]).map((k) => [k.address, k.labels[LABEL]]));

    const spaceColors = shared("space.colors") ?? {};
    const spaceFill = (id) => {
      const c = spaceColors[id] ?? "ansi6";
      return c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent);
    };

    let rows = [];

    if (byPriority) {
      // --- Priority View: status-reporting agents by urgency ---
      const nested = new Set(collapsed ? [] : rawAgents.flatMap((a) => this.tree(all, a.address, panesByAddr, true).map((s) => s.t.address)));
      let list = rawAgents.filter((a) => a.pinned || !nested.has(a.address));
      const tabCounts = new Map();
      for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
      const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address, panesByAddr, true).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
      const rankOf = (a) => urgency.get(a.address);
      list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y.address) - this.since(x.address) || y.seq - x.seq);
      const pinned = list.filter((a) => a.pinned);
      const rest = list.filter((a) => !a.pinned);
      list = [...pinned, ...rest];
      setAgentOrder(list.map((a) => a.address));

      const leads = leadPanes(panesNow);
      const tabs = new Map(spacesNow.flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
      const labels = new Map(list.map((a) => {
        const paneObj = panesById.get(a.pane) ?? panesByAddr.get(a.address);
        const custom = named.get(a.address) || paneObj?.name || a.pane_name;
        if (custom) return [a.address, custom];
        const tab = tabs.get(a.tab);
        const many = tabCounts.get(a.tab) > 1 || tab?.panes > 1 || Boolean(tab && frameName(tab, panesNow));
        return [a.address, tab ? title(many ? { ...tab, named: false, name: a.program?.name || tab.name } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
      }));
      const label = (a) => labels.get(a.address);
      const detail = new Map(list.map((a) => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
      const seen = {};
      for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
      for (const a of list) if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));

      const prioRow = (a, i, subs, rIdx) => {
        const pic = icon(a.program, 16, t.foreground);
        const more = detail.get(a.address);
        const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
        const isDragging = dragNow?.terminal === a.address || dragNow?.pane === a.pane;
        const targetKey = `row-${a.pane}`;
        const targeted = isJsTarget(herdrAll, targetKey, now);
        const start = (e) => startModDrag(herdrAll, { kind: "agent", pane: a.pane, terminal: a.address, label: `${a.program?.name || "Agent"} · ${label(a) || a.address}`, x: e.position.x, y: e.position.y });
        const move = (e) => {
          this.scrollState.index = rIdx;
          if (a.pane) reportDragTarget(herdrAll, e, { type: "group", key: targetKey, tab: a.tab, pane: a.pane, name: label(a) || a.program?.name || "pane" }, now);
        };
        const openMenu = (_e, cx) => {
          cx.stop_propagation();
          this.menu("agent", { pane: a.pane, terminal: a.address, space: a.space, pinned: a.pinned, isAgent: true });
        };
        if (collapsed) {
          return h_flex().id(`ag-${a.address}`).h(26).px(8).flex_none().items_center().gap(4)
            .tooltip(`${a.space_name || "Space"} · ${label(a) || a.program?.name || a.address}`)
            .when(isDragging, (el) => el.opacity(0.55))
            .when(targeted, (el) => el.border_1().border_color(t.accent))
            .hover((s) => s.bg(t.hover))
            .on_mouse_down("left", start).on_mouse_move(move).on_mouse_down("right", openMenu)
            .on_click(() => { if (!recentlyDragged()) run("pane.focus", { pane: a.pane }); })
            .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
            .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
        }
        const when = this.since(a.address);
        const idle = a.status === "idle" && !a.focused;
        const isPinned = a.pinned;
        return h_flex().id(`ag-${a.address}`).px(8).h(30).flex_none().rounded(8).items_center().gap(9)
          .when(a.focused, (el) => el.bg(t.selected))
          .when(targeted, (el) => el.border_1().border_color(t.accent).bg(t.hover))
          .cursor_pointer().hover((s) => s.bg(t.hover))
          .on_hover((on, cx) => {
            if (on) this.hovered = a.address;
            else if (this.hovered === a.address) this.hovered = null;
            cx.notify();
          })
          .when(isDragging, (el) => el.opacity(0.55))
          .on_mouse_down("left", start).on_mouse_move(move).on_mouse_down("right", openMenu)
          .on_click((e) => {
            if (recentlyDragged()) return;
            if (e.click_count === 2) {
              if (this.hasRename) openOverlay({ mod: "herdbook-rename", kind: "dialog", width: 380, props: { target: { pane: a.pane, terminal: a.address } } });
              else if (hasPaneRename && a.pane) run("pane.rename", { pane: a.pane });
              else run("pane.focus", { pane: a.pane });
            } else {
              run("pane.focus", { pane: a.pane });
            }
          })
          .when(Boolean(pic), (el) => el.child(div().id(`agent-fold-${a.address}`)
            .when(subs.length > 0, (el) => el.on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx)).on_click((_e, cx) => {
              cx.stop_propagation();
              this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
              cx.notify();
            })).child(pic)))
          .child(h_flex().flex_1().min_w(0).gap(5).items_center()
            .child(div().min_w(0).max_w(more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(a.space_name || label(a)))
            .when(Boolean(more), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
          .when(Boolean(machine), (el) => el.child(div().text_size(10).text_color(t.dim).child(machine)))
          .when(subs.length > 0, (el) => el.child(this.foldBadge(t, a.address, subs)))
          .when(!dragNow && this.hovered === a.address, (el) => el.child(this.pinButton(t, a.address, isPinned)))
          .when(this.hovered !== a.address && Boolean(when), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
          .child(this.status(t, a, !isPinned));
      };

      const withKids = (a, i) => {
        const subs = collapsed ? [] : this.tree(all, a.address, panesByAddr, true);
        const rIdx = rows.length;
        const r = prioRow(a, i, subs, rIdx);
        if (this.folded.has(a.address)) return [r];
        return [r, ...subs.map((s, si) => this.subRow(t, s, shown, true, dragNow, panesNow, agentByAddr, rIdx + 1 + si))];
      };

      const sections = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
      for (const a of rest) {
        const r = rankOf(a) || RANK.idle;
        const id = `sec-${r}`;
        if (sections.at(-1)?.id === id) sections.at(-1).members.push(a);
        else sections.push({ id, label: SECTION[r], status: SECTION_STATUS[r], members: [a] });
      }
      const secHeader = (g) => {
        const open = !this.folded.has(g.id);
        return h_flex().id(g.id).px(8).pt(8).h(30).flex_none().gap(6).items_center().text_size(11).font_medium().cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { open ? this.folded.add(g.id) : this.folded.delete(g.id); cx.notify(); })
          .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
          .child(div().text_color(t.dim).child(String(g.members.length)))
          .child(div().flex_1())
          .when(!open, (el) => el.child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
      };

      if (collapsed) {
        rows = list.flatMap(withKids);
      } else {
        for (const g of sections) {
          rows.push(secHeader(g));
          if (!this.folded.has(g.id)) g.members.forEach((a, i) => rows.push(...withKids(a, i)));
        }
      }
    } else {
      // --- Grouped by workspace: Full Workspace -> Tab -> Pane graphical tree ---
      const treeData = workspaceTree(spacesNow, panesNow);
      const orderedAgentAddrs = [];
      const pinnedAgents = rawAgents.filter((a) => a.pinned);
      for (const a of pinnedAgents) orderedAgentAddrs.push(a.address);
      for (const ws of treeData) {
        for (const tb of ws.tabs) {
          for (const p of tb.panes) {
            if (p.terminal && this.listed.has(p.terminal) && !orderedAgentAddrs.includes(p.terminal)) {
              orderedAgentAddrs.push(p.terminal);
            }
          }
        }
      }
      setAgentOrder(orderedAgentAddrs);

      const toggleGroup = (id, cx) => {
        this.groupsFolded.has(id) ? this.groupsFolded.delete(id) : this.groupsFolded.add(id);
        localStorage.setItem("groupsFolded", JSON.stringify([...this.groupsFolded]));
        cx.notify();
      };

      const toggleSpace = (id, cx) => {
        this.spacesFolded.has(id) ? this.spacesFolded.delete(id) : this.spacesFolded.add(id);
        localStorage.setItem("spacesFolded", JSON.stringify([...this.spacesFolded]));
        cx.notify();
      };

      let compactIndex = 0;

      const paneRow = (p, tab, space, nameMap, rIdx, headed = false) => {
        if (p.pane === focusedPane) focusedRowAt = rIdx;
        const addr = p.terminal ?? null;
        const ag = (addr && agentByAddr.get(addr)) || agentByPane.get(p.pane) || null;
        const subs = !collapsed && addr ? this.tree(all, addr, panesByAddr, false) : [];
        const rowName = nameMap.get(p.pane) ?? (p.title || p.program?.name || p.mod || "Pane");
        const pic = icon(p.program, 15, ag || p.focused ? t.foreground : t.muted)
          ?? (p.mod ? svg("mods/workspace-chrome/square.svg").size(14).flex_none().text_color(t.muted) : null);
        const machine = !space.machine && addr && addr.includes("/") ? addr.split("/")[0] : null;
        const isDragging = (addr && dragNow?.terminal === addr) || dragNow?.pane === p.pane;
        const targetKey = `row-${p.pane}`;
        const targeted = isJsTarget(herdrAll, targetKey, now);
        const start = (e) => startModDrag(herdrAll, {
          kind: ag ? "agent" : "pane",
          pane: p.pane,
          terminal: addr,
          label: `${p.program?.name || p.mod || "Pane"} · ${rowName}`,
          x: e.position.x,
          y: e.position.y,
        });
        const move = (e) => {
          this.scrollState.index = rIdx;
          reportDragTarget(herdrAll, e, { type: "group", key: targetKey, tab: tab.id, pane: p.pane, name: rowName }, now);
        };
        const openMenu = (_e, cx) => {
          cx.stop_propagation();
          if (addr) this.menu("agent", { pane: p.pane, terminal: addr, space: space.id, pinned: Boolean(ag?.pinned), isAgent: Boolean(ag) });
          else this.menu("pane", { pane: p.pane, terminal: null });
        };

        if (collapsed) {
          const n = ++compactIndex;
          return [
            h_flex().id(`pn-${p.pane}`).h(26).px(8).flex_none().items_center().gap(4)
              .tooltip(`${space.name || "Space"} · ${rowName}`)
              .when(p.focused, (el) => el.bg(t.selected))
              .when(isDragging, (el) => el.opacity(0.55))
              .when(targeted, (el) => el.border_1().border_color(t.accent))
              .hover((s) => s.bg(t.hover))
              .on_mouse_down("left", start).on_mouse_move(move).on_mouse_down("right", openMenu)
              .on_click(() => { if (!recentlyDragged()) run("pane.focus", { pane: p.pane }); })
              .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(p.focused ? t.foreground : t.muted).child(String(n)))
              .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, ag ?? { status: p.status }, true))),
          ];
        }

        const when = this.since(addr);
        const dimText = !p.focused && (!ag || ag.status === "idle");
        const isPinned = Boolean(ag?.pinned);
        const hoverId = `pn:${p.pane}`;
        const rowHovered = !dragNow && this.hovered === hoverId;
        const mainRow = h_flex()
          .id(`pn-${p.pane}`)
          .px(8)
          .h(29)
          .flex_none()
          .rounded(8)
          .items_center()
          .gap(8)
          .when(p.focused, (el) => el.bg(t.selected))
          .when(targeted, (el) => el.border_1().border_color(t.accent).bg(t.hover))
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_hover((on, cx) => {
            if (on) this.hovered = hoverId;
            else if (this.hovered === hoverId) this.hovered = null;
            cx.notify();
          })
          .when(isDragging, (el) => el.opacity(0.55))
          .on_mouse_down("left", start)
          .on_mouse_move(move)
          .on_mouse_down("right", openMenu)
          .on_click((e) => {
            if (recentlyDragged()) return;
            if (e.click_count === 2) {
              if ((addr || hasPaneRename) && this.hasRename) {
                openOverlay({ mod: "herdbook-rename", kind: "dialog", width: 380, props: { target: { pane: p.pane, terminal: addr } } });
              } else if (hasPaneRename) {
                run("pane.rename", { pane: p.pane });
              } else {
                run("pane.focus", { pane: p.pane });
              }
            } else {
              run("pane.focus", { pane: p.pane });
            }
          })
          .when(Boolean(pic), (el) => el.child(div().id(`pane-icon-${p.pane}`)
            .when(subs.length > 0 && Boolean(addr), (el) => el.on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx)).on_click((_e, cx) => {
              cx.stop_propagation();
              this.folded.has(addr) ? this.folded.delete(addr) : this.folded.add(addr);
              cx.notify();
            })).child(pic)))
          .child(div().flex_1().min_w(0).truncate().text_color(dimText ? t.muted : t.foreground).child(rowName))
          .when(Boolean(machine), (el) => el.child(div().text_size(10).text_color(t.dim).child(machine)))
          .when(subs.length > 0 && Boolean(addr), (el) => el.child(this.foldBadge(t, addr, subs)))
          .when(!headed && rowHovered, (el) => el.child(this.plusButton(t, `pn-split-${p.pane}`, "Split pane right", () => run("pane.split", { direction: "right", pane: p.pane }), 17)))
          .when(Boolean(ag) && rowHovered, (el) => el.child(this.pinButton(t, addr, isPinned)))
          .when(Boolean(ag) && !rowHovered && Boolean(when), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
          .when(Boolean(ag || p.status), (el) => el.child(this.status(t, ag ?? { status: p.status }, false)));

        if (!addr || this.folded.has(addr) || !subs.length) return [mainRow];
        return [mainRow, ...subs.map((s, si) => this.subRow(t, s, shown, false, dragNow, panesNow, agentByAddr, rIdx + 1 + si))];
      };

      const tabFrame = (tab, space, inTab, rIdx) => {
        const name = frameName(tab, panesNow);
        const first = inTab[0] ?? null;
        const headed = Boolean(name) || inTab.length > 1;
        const shut = headed && this.groupsFolded.has(tab.id);
        const top = inTab.reduce((m, p) => {
          const st = (p.terminal && this.listed.get(p.terminal)) || p.status;
          return (RANK[st] ?? 0) > (RANK[m] ?? 0) ? st : m;
        }, null);
        const pics = inTab.map((p) => icon(p.program, 13, t.foreground)).filter(Boolean);
        const grpKey = `grp-${tab.id}`;
        const grpTargeted = isJsTarget(herdrAll, grpKey, now);
        const nameMap = tabPaneNames(inTab, named);
        if (shut && inTab.some((p) => p.pane === focusedPane)) focusedRowAt = rIdx;
        const body = shut ? [] : inTab.flatMap((p) => paneRow(p, tab, space, nameMap, rIdx, headed));
        const grpHoverKey = `grp:${tab.id}`;
        const grpHovered = !dragNow && this.hovered === grpHoverKey;

        const chevron = div().id(`grp-f-${tab.id}`).flex_none().p(1).rounded(4).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(shut ? "Show panes" : "Fold panes")
          .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
          .on_click((_e, cx) => { cx.stop_propagation(); toggleGroup(tab.id, cx); })
          .child(svg(`mods/workspace-chrome/chevron-${shut ? "right" : "down"}.svg`).size(11));

        return v_flex()
          .id(`grp-${tab.id}`)
          .flex_none()
          .p(2)
          .rounded(10)
          .border(grpTargeted ? 2 : 1)
          .border_color(grpTargeted ? t.accent : (tab.active && space.active ? spaceFill(space.id) + "a6" : spaceFill(space.id) + "59"))
          .when(grpTargeted, (el) => el.bg(t.accent + "14"))
          .when(headed, (el) => el.child(h_flex()
            .id(`grp-h-${tab.id}`)
            .h(shut ? 26 : 22)
            .px(6)
            .gap(5)
            .items_center()
            .rounded(6)
            .text_size(shut ? 12 : 10.8)
            .cursor_pointer()
            .when(shut && inTab.some((p) => p.focused), (el) => el.bg(t.selected))
            .text_color(name || shut ? t.foreground : t.dim)
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_hover((on, cx) => {
              if (on) this.hovered = grpHoverKey;
              else if (this.hovered === grpHoverKey) this.hovered = null;
              cx.notify();
            })
            .tooltip(name ? "Double-click to rename tab" : "Double-click to name this tab")
            .when(dragNow?.tab === tab.id, (el) => el.opacity(0.55))
            .on_mouse_down("left", (e) => startModDrag(herdrAll, { kind: "tab", tab: tab.id, label: name ?? `${inTab.length} panes`, x: e.position.x, y: e.position.y }))
            .on_mouse_move((e) => {
              this.scrollState.index = rIdx;
              reportDragTarget(herdrAll, e, { type: "group", key: grpKey, tab: tab.id, name: name ?? `${inTab.length} panes` }, now);
            })
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("tab", { id: tab.id, space: space.id }); })
            .on_click((e) => {
              if (recentlyDragged()) return;
              if (e.click_count === 2) run("tab.rename", { id: tab.id });
              else if (first) run("pane.focus", { pane: first.pane });
              else run("tab.select", { id: tab.id });
            })
            .child(chevron)
            .when(!shut, (el) => el.child(svg("mods/workspace-chrome/layers.svg").size(11).flex_none()))
            .when(shut, (el) => el.child(h_flex().flex_none().gap(3).items_center().children(pics)))
            .child(div().flex_1().min_w(0).truncate().when(Boolean(name), (el) => el.font_medium()).child(name ?? `${inTab.length} panes`))
            .when(grpHovered, (el) => el.child(this.plusButton(
              t,
              `grp-add-${tab.id}`,
              first ? "Split pane right" : "New pane",
              () => {
                if (first) run("pane.split", { direction: "right", pane: first.pane });
                else run("tab.new", { space: space.id });
              },
              16,
            )))
            .when(!grpHovered && shut && inTab.length > 1, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(inTab.length))))
            .when(shut && Boolean(top), (el) => el.child(this.status(t, { status: top }, true)))))
          .when(!shut, (el) => el.children(body));
      };

      const gapRow = (spaceId, place, baseH, rIdx) => {
        const key = `gap-${spaceId}-${place.before ?? ""}-${place.after ?? ""}`;
        const targeted = isJsTarget(herdrAll, key, now);
        const expanded = Boolean(dragNow);
        return h_flex()
          .id(key)
          .h(expanded ? baseH + 6 : baseH)
          .when(expanded, (el) => el.my(-3))
          .flex_none()
          .items_center()
          .px(4)
          .on_mouse_move((e) => {
            this.scrollState.index = rIdx;
            reportDragTarget(herdrAll, e, { type: "gap", key, space: spaceId, ...place }, now);
          })
          .when(targeted, (el) => el.child(div().w_full().h(3).rounded(2).bg(t.accent)));
      };

      const spaceHeader = (space, spaceIndex, totalPanes, topStatus, rIdx) => {
        const open = !this.spacesFolded.has(space.id);
        const fill = spaceFill(space.id);
        const spDropKey = `sp-${space.id}`;
        const spOrderKey = `spo-${space.id}`;
        const dropTargeted = isJsTarget(herdrAll, spDropKey, now);
        const orderTargeted = isJsTarget(herdrAll, spOrderKey, now);
        const spHoverKey = `sp:${space.id}`;
        const spHovered = !dragNow && this.hovered === spHoverKey;
        return h_flex()
          .id(`sp-head-${space.id}`)
          .px(8)
          .pt(8)
          .h(30)
          .flex_none()
          .gap(6)
          .rounded(7)
          .items_center()
          .text_size(11)
          .font_medium()
          .when(spaceIndex > 0, (el) => el.mt(6).border_t(1).border_color(t.border).h(36).pt(10))
          .when(dragNow?.kind === "space" && dragNow?.space === space.id, (el) => el.opacity(0.55))
          .when(dropTargeted, (el) => el.border_1().border_color(t.accent).bg(t.accent + "18"))
          .when(orderTargeted, (el) => el.border_b(2).border_color(t.accent))
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground).bg(t.hover))
          .on_hover((on, cx) => {
            if (on) this.hovered = spHoverKey;
            else if (this.hovered === spHoverKey) this.hovered = null;
            cx.notify();
          })
          .on_mouse_down("left", (e) => startModDrag(herdrAll, { kind: "space", space: space.id, label: space.name, x: e.position.x, y: e.position.y }))
          .on_mouse_move((e) => {
            this.scrollState.index = rIdx;
            if (dragNow?.kind === "space") {
              reportDragTarget(herdrAll, e, { type: "space-order", key: spOrderKey, space: space.id, index: spaceIndex + 1, name: space.name, machine: space.machine ?? null }, now);
            } else {
              reportDragTarget(herdrAll, e, { type: "space", key: spDropKey, space: space.id, name: space.name, machine: space.machine ?? null }, now);
            }
          })
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("space", { id: space.id }); })
          .on_click((_e, cx) => {
            if (recentlyDragged()) return;
            toggleSpace(space.id, cx);
          })
          .child(h_flex().size(14).flex_none().rounded(4).bg(fill).items_center().justify_center()
            .text_size(9).font_bold().text_color("#ffffff").child([...(space.name || "?")][0].toUpperCase()))
          .child(div().truncate().text_color(space.active ? t.foreground : t.muted).text_size(12).font_semibold().child(space.name || "Space"))
          .when(Boolean(space.machine), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(space.machine)))
          .when(!open, (el) => el.child(div().text_color(t.dim).child(String(totalPanes))))
          .child(div().flex_1())
          .when(spHovered, (el) => el.child(this.plusButton(
            t,
            `sp-add-${space.id}`,
            space.active && this.hasLaunchMenu ? "New tab or agent" : "New tab",
            () => {
              if (space.active && this.hasLaunchMenu) {
                openOverlay({ mod: "launch-menu", kind: "popup", width: 268, height: 512 });
              } else {
                run("tab.new", { space: space.id });
              }
            },
            18,
          )))
          .when(!open, (el) => el
            .when(Boolean(topStatus) && topStatus !== "idle", (el) => el.child(this.status(t, { status: topStatus }, true)))
            .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
      };

      if (collapsed) {
        for (const ws of treeData) {
          for (const tb of ws.tabs) {
            const nameMap = tabPaneNames(tb.panes, named);
            for (const p of tb.panes) {
              rows.push(...paneRow(p, tb.tab, ws.space, nameMap, rows.length, false));
            }
          }
        }
      } else {
        // Optional Pinned shortcut strip at the very top when agents are pinned.
        if (pinnedAgents.length > 0) {
          const pinOpen = !this.folded.has("pinned");
          rows.push(
            h_flex().id("pinned").px(8).pt(6).h(26).flex_none().gap(6).items_center().text_size(11).font_medium().cursor_pointer()
              .text_color(t.dim).hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => { pinOpen ? this.folded.add("pinned") : this.folded.delete("pinned"); cx.notify(); })
              .child(div().child("Pinned"))
              .child(div().child(String(pinnedAgents.length)))
              .child(div().flex_1())
              .when(!pinOpen, (el) => el.child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim))),
          );
          if (pinOpen) {
            for (const a of pinnedAgents) {
              const p = panesById.get(a.pane);
              if (!p) continue;
              const nm = named.get(a.address) || p.name || a.pane_name || cleanTitle(a.title) || a.program?.name || a.address;
              rows.push(
                h_flex().id(`pin-row-${a.address}`).px(8).h(28).flex_none().rounded(8).items_center().gap(8)
                  .when(a.focused, (el) => el.bg(t.selected))
                  .cursor_pointer().hover((s) => s.bg(t.hover))
                  .on_click(() => run("pane.focus", { pane: a.pane }))
                  .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("agent", { pane: a.pane, terminal: a.address, space: a.space, pinned: true, isAgent: true }); })
                  .when(Boolean(icon(a.program, 15, t.foreground)), (el) => el.child(icon(a.program, 15, t.foreground)))
                  .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(`${a.space_name} · ${nm}`))
                  .child(this.pinButton(t, a.address, true))
                  .child(this.status(t, a, false)),
              );
            }
          }
        }

        for (const ws of treeData) {
          const allSpacePanes = ws.tabs.flatMap((tb) => tb.panes);
          const topStatus = allSpacePanes.reduce((m, p) => {
            const st = (p.terminal && this.listed.get(p.terminal)) || p.status;
            return (RANK[st] ?? 0) > (RANK[m] ?? 0) ? st : m;
          }, null);
          rows.push(spaceHeader(ws.space, ws.spaceIndex, allSpacePanes.length, topStatus, rows.length));
          if (this.spacesFolded.has(ws.space.id)) continue;
          if (ws.tabs.length === 0) {
            rows.push(gapRow(ws.space.id, {}, 8, rows.length));
            continue;
          }
          ws.tabs.forEach((tb, ti) => {
            if (ti === 0) rows.push(gapRow(ws.space.id, { before: tb.tab.id }, 6, rows.length));
            rows.push(tabFrame(tb.tab, ws.space, tb.panes, rows.length));
            rows.push(gapRow(ws.space.id, { after: tb.tab.id }, ti < ws.tabs.length - 1 ? 8 : 6, rows.length));
          });
        }
      }
    }

    if (!dragNow && focusedPane && (focusedPane !== this.revealedPane || focusedRowAt !== this.revealedRowAt)) {
      this.revealedPane = focusedPane;
      this.revealedRowAt = focusedRowAt;
      if (focusedRowAt >= 0) this.scroll.scroll_to_item(focusedRowAt);
    }

    const emptyPriority = byPriority && rawAgents.length === 0 && !collapsed;
    const emptyTree = !byPriority && spacesNow.length === 0 && !collapsed;

    return v_flex()
      .id("agents-root")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .on_mouse_down_out(() => clearJsDrag(herdrAll))
      .on_mouse_move((e) => trackDragMove(herdrAll, e, now))
      .on_mouse_up("left", (e, cx) => {
        if (finishJsDrag(herdrAll, cx, null, Date.now(), e?.position)) cx.notify();
      })
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
                .on_click(() => openOverlay({ mod: "herdbook-agents", kind: "popup", width: 212, height: 140, props: { sortMenu: true } }))
                .tooltip(`View: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(emptyPriority, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Switch view (top right) to see all workspace tabs and panes.")),
      )
      .when(emptyTree, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No workspaces open yet.")),
      )
      .child(
        v_flex()
          .id("ag-list")
          .flex_1()
          .min_h(0)
          .pl(collapsed ? 0 : 8)
          .pr(collapsed ? 0 : 14)
          .overflow_y_scrollbar()
          .mode("always")
          .track_scroll(this.scroll)
          .on_mouse_move((e) => autoScrollOnDrag(herdrAll, this.scroll, this.scrollState, e, rows.length, false, Date.now()))
          .children(rows),
      )
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
