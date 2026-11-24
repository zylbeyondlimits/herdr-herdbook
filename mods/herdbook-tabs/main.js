import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, terminals, run, openOverlay, theme, window, shared, layout, settings, appHome, readTextFile } from "herdr";
import * as herdrAll from "herdr";
import { chip, hasTrailingSibling, tabChipDropAction } from "./names.js";
import {
  activeDrag,
  startModDrag,
  cancelModDrag,
  clearJsDrag,
  reportDragTarget,
  clearDragTarget,
  trackDragMove,
  isJsTarget,
  finishJsDrag,
  recentlyDragged,
  createScrollState,
  recordDragAnchor,
  recordHoverIndex,
  resetScrollAnchor,
  autoScrollOnDrag,
} from "./drag.js";

const installed = (name) => readTextFile(`${appHome()}/mods/${name}/mod.json`).then((s) => s !== null, () => false);

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.scroll = ScrollHandle.new();
    this.scrollState = createScrollState();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
    this.menu = "menu";
    this.plus = "new-menu";
    if (typeof herdrAll.checking === "function" && herdrAll.checking()) return;
    clearJsDrag(herdrAll);
    cx.spawn(async (cx) => {
      const [menu, launch] = await Promise.all([installed("herdbook-menu"), installed("launch-menu")]);
      if (menu) this.menu = "herdbook-menu";
      if (launch) this.plus = "launch-menu";
      cx.notify();
    });
  }

  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const now = Date.now();
    const dragNow = activeDrag(herdrAll, now);
    const space = spaces().find((p) => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex((tab) => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cancelModDrag(herdrAll, cx);
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(() => { if (!recentlyDragged()) action(); }).child(label);
    const agentByAddr = new Map((herdrAll.agents?.() ?? []).map((a) => [a.address, a]));
    const agentByPane = new Map((herdrAll.agents?.() ?? []).map((a) => [a.pane, a]));
    const all = panes().map((p) => {
      const ag = (p.terminal && agentByAddr.get(p.terminal)) || agentByPane.get(p.pane);
      return ag?.pane_name && !p.pane_name ? { ...p, pane_name: ag.pane_name } : p;
    });
    const named = new Map(terminals().filter((k) => k.labels?.["pane-name"]).map((k) => [k.address, k.labels["pane-name"]]));
    const pic = (program) => program.tint ? svg(program.icon).size(14).flex_none().text_color(t.muted) : image(program.icon).size(14).flex_none();

    const item = (c, i) => {
      const inTab = all.filter((p) => p.tab === c.id);
      const k = chip(c, inTab, named);
      // Every pane in a multi-pane tab (active or inactive) can be dragged out on its own!
      const lone = (g, j, el) => !g.pane || inTab.length <= 1 ? el : el.id(`tab-${c.id}-p${j}`).cursor_grab()
        .when(dragNow?.pane === g.pane, (s) => s.opacity(0.5))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          recordDragAnchor(this.scrollState, e, i, now);
          if (e.click_count === 2) run("tab.rename", { id: c.id });
          else startModDrag(herdrAll, { kind: "pane", pane: g.pane, terminal: g.terminal, label: g.name, x: e.position.x, y: e.position.y }, now);
        })
        .on_click((e, cx) => {
          if (recentlyDragged()) return;
          cx.stop_propagation();
          if (e.click_count === 2) run("tab.rename", { id: c.id });
          else {
            if (!c.active) run("tab.select", { id: c.id });
            run("pane.focus", { pane: g.pane });
          }
        });

      const segment = (g, j) => lone(g, j, h_flex().flex_none().gap(5).items_center()
        .when(j > 0, (el) => el.child(div().text_color(t.dim).child("·")))
        .when(Boolean(g.program?.icon), (el) => el.child(pic(g.program)))
        .child(div().max_w(96).truncate().child(g.name)));

      const grpKey = `tabgrp-${c.id}`;
      const beforeKey = `tabgap-before-${c.id}`;
      const afterKey = `tabgap-after-${c.id}`;
      const grpTargeted = isJsTarget(herdrAll, grpKey, now);
      const beforeTargeted = isJsTarget(herdrAll, beforeKey, now);
      const afterTargeted = isJsTarget(herdrAll, afterKey, now);

      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .when(i <= active, (el) => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(grpTargeted ? 2 : 1)
        .border_color(grpTargeted ? t.accent : (c.active ? t.border : t.chrome))
        .bg(grpTargeted ? t.accent + "1c" : (c.active ? t.raised : t.chrome))
        .when(beforeTargeted, (el) => el.border_l(3).border_color(t.accent))
        .when(afterTargeted, (el) => el.border_r(3).border_color(t.accent))
        .text_color(c.active ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .when(dragNow?.tab === c.id, (el) => el.opacity(0.55))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          recordDragAnchor(this.scrollState, e, i, now);
          if (e.click_count === 2) run("tab.rename", { id: c.id });
          else startModDrag(herdrAll, { kind: "tab", tab: c.id, label: k.name, x: e.position.x, y: e.position.y }, now);
        })
        .on_mouse_move((e) => {
          recordHoverIndex(this.scrollState, i, now);
          if (!dragNow) {
            trackDragMove(herdrAll, e, now);
            return;
          }
          const lx = typeof e?.local_position?.x === "number"
            ? e.local_position.x
            : (e?.position && e?.bounds ? e.position.x - e.bounds.x : null);
          const action = tabChipDropAction({
            drag: dragNow,
            tab: c,
            tabLabel: k.name,
            spaceId: space?.id ?? null,
            panes: all,
            bounds: e?.bounds,
            localX: lx,
          });
          if (action) reportDragTarget(herdrAll, e, action, now);
          else clearDragTarget(herdrAll, now);
        })
        .on_click((e) => {
          if (recentlyDragged()) return;
          if (e.click_count === 2) run("tab.rename", { id: c.id });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: this.menu, kind: "popup", width: this.menu === "menu" ? 200 : 228, props: { tab: "tab", target: { id: c.id, space: space.id } } });
        })
        .when(k.kind === "one", (el) => el.children(k.icons.map(pic)))
        .when(k.kind === "group", (el) => el.children(k.members.map((g, j) => lone(
          g,
          j,
          h_flex()
            .flex_none()
            .p(2)
            .rounded(4)
            .hover((s) => s.bg(t.hover))
            .tooltip(`${g.name} — click to focus, drag to move pane`)
            .child(g.program?.icon ? pic(g.program) : svg("mods/workspace-chrome/square.svg").size(13).flex_none().text_color(t.muted)),
        ))))
        .when(k.kind === "many", (el) => el.children(k.segments.map(segment)).tooltip(k.name))
        .when(k.kind === "group", (el) => el.tooltip(k.tip))
        .when(k.kind !== "many", (el) => el.child(div().max_w(170).truncate().child(c.zoomed ? `${k.name} Z` : k.name)))
        .when(c.status === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", (el) => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, (el) => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };

    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);

    const panelButton = (id, label, iconPath) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(iconPath).size(14)).child(label);
    };

    const plusKey = space ? `tabplus-${space.id}` : "tabplus";
    const plusTargeted = isJsTarget(herdrAll, plusKey, now);
    const plusBtn = div()
      .id("tab-new")
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(plusTargeted ? t.accent : t.dim)
      .when(plusTargeted, (el) => el.border_1().border_color(t.accent).bg(t.accent + "1c"))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_mouse_move((e) => {
        if (space && dragNow && dragNow.kind !== "space") {
          const lastTab = shown.at(-1)?.id ?? null;
          reportDragTarget(herdrAll, e, { type: "gap", key: plusKey, space: space.id, ...(lastTab ? { after: lastTab } : {}) }, now);
        }
      })
      .on_click(() => {
        if (!recentlyDragged()) openOverlay({ mod: this.plus, kind: "popup", width: this.plus === "new-menu" ? 250 : 268, height: 512 });
      })
      .child("+");

    const emptyGapKey = space ? `tabempty-${space.id}` : "tabempty";
    const emptyTargeted = isJsTarget(herdrAll, emptyGapKey, now);
    const siblingNext = hasTrailingSibling(root);
    return h_flex()
      .id("tabs-root")
      .size_full()
      .min_w(0)
      .px(10)
      .pl(lightsPadding)
      .when(siblingNext, (el) => el.pr(3))
      .gap(3)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .on_mouse_down_out(() => clearJsDrag(herdrAll))
      .on_mouse_move((e) => trackDragMove(herdrAll, e, now))
      .on_mouse_up("left", (e, cx) => {
        if (finishJsDrag(herdrAll, cx, null, Date.now(), e?.position)) cx.notify();
      })
      .on_scroll_wheel((e) => this.wheel(e))
      .child(
        h_flex()
          .id("tab-viewport")
          .flex_1()
          .min_w(0)
          .h_full()
          .on_scroll_wheel(() => resetScrollAnchor(this.scrollState))
          .on_mouse_move((e) => autoScrollOnDrag(herdrAll, this.scroll, this.scrollState, e, shown.length, true, Date.now()))
          .child(
            h_flex()
              .id("tab-scroll")
              .size_full()
              .min_w(0)
              .items_center()
              .gap(3)
              .overflow_x_scrollbar()
              .track_scroll(this.scroll)
              .on_size_change((_size, cx) => { if (!activeDrag(herdrAll) && active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
              .children(shown.map(item))
              .child(
                div()
                  .id("tab-empty-drop")
                  .flex_1()
                  .h_full()
                  .min_w(0)
                  .flex()
                  .items_center()
                  .on_mouse_move((e) => {
                    if (!dragNow) return;
                    const lastTab = shown.at(-1)?.id ?? null;
                    if (!space || dragNow.kind === "space" || (dragNow.kind === "tab" && dragNow.tab === lastTab)) {
                      clearDragTarget(herdrAll, now);
                      return;
                    }
                    reportDragTarget(herdrAll, e, { type: "gap", key: emptyGapKey, space: space.id, ...(lastTab ? { after: lastTab } : {}), bounds: e.bounds }, now);
                  })
                  .when(emptyTargeted, (el) => el.child(div().w(3).h(22).ml(2).rounded(2).bg(t.accent))),
              ),
          ),
      )
      .child(plusBtn)
      .when(enabled.includes("files"), (el) => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), (el) => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, (el) => el
        .child(button("minimize", w.platform === "windows" ? svg("mods/herdbook-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/herdbook-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/herdbook-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
