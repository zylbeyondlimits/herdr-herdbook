// A pane's header bar (`herdbook-pane`):
// Shows program icon, custom `pane-name` (or 0.1.17 `pane.name` / live title / program), folder,
// status, and hover actions. Supports both Native Herdr drag (Route 1) and Pure-JS header drop
// target on official Herdr (Route 2).

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, terminals, spaces, openOverlay, appHome, readTextFile } from "herdr";
import * as herdrAll from "herdr";
import {
  hasNativeDrag,
  activeDrag,
  startModDrag,
  cancelModDrag,
  clearJsDrag,
  reportDragTarget,
  trackDragMove,
  isJsTarget,
  finishJsDrag,
  recentlyDragged,
} from "./drag.js";

const installed = (name) => readTextFile(`${appHome()}/mods/${name}/mod.json`).then((s) => s !== null, () => false);

const LABEL = "pane-name";

function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter((child) => !child.hidden);
    children = [visible.find((child) => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

function spaceOfTab(tabId) {
  return spaces().find((s) => (s.tabs ?? []).some((t) => t.id === tabId))?.id ?? null;
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.has = { menu: false, rename: false };
    if (typeof herdrAll.checking === "function" && herdrAll.checking()) return;
    clearJsDrag(herdrAll);
    cx.spawn(async (cx) => {
      const [menu, rename] = await Promise.all([installed("herdbook-menu"), installed("herdbook-rename")]);
      this.has = { menu, rename };
      cx.notify();
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, iconName, action, tip) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action();
      })
      .child(svg(`mods/herdbook-pane/${iconName}.svg`).size(14));
  }

  menu(tab, target) {
    openOverlay({ mod: "herdbook-menu", kind: "popup", width: 228, height: 320, props: { tab, target } });
  }

  render() {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const now = Date.now();
    const dragNow = activeDrag(herdrAll, now);
    const cmds = herdrAll.commands?.() ?? [];
    const hasPaneRename = cmds.some((c) => c.name === "pane.rename");
    const hasNativeMove = cmds.some((c) => c.name === "pane.move" && (c.args ?? []).some((a) => a.name === "space"));

    const termLabel = p.terminal ? terminals().find((k) => k.address === p.terminal)?.labels?.[LABEL] : null;
    const agentPaneName = herdrAll.agents?.()?.find((a) => (p.terminal && a.address === p.terminal) || a.pane === p.pane)?.pane_name ?? null;
    const custom = termLabel || p.name || agentPaneName || null;
    const name = custom || ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || p.mod || "shell";

    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    const target = { pane, terminal: p.terminal };
    const dropKeyRight = `ph-${pane}-right`;
    const dropKeyDown = `ph-${pane}-down`;
    const rightTargeted = isJsTarget(herdrAll, dropKeyRight, now);
    const downTargeted = isJsTarget(herdrAll, dropKeyDown, now);
    const targeted = rightTargeted || downTargeted;

    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(targeted ? t.accent + "1f" : t.background)
      .when(bottom, (el) => el.border_t(targeted ? 2 : 1))
      .when(!bottom, (el) => el.border_b(targeted ? 2 : 1))
      .border_color(targeted ? t.accent : t.border)
      .text_size(12)
      .when(dragNow?.pane === pane, (el) => el.opacity(0.6))
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_mouse_down("left", (e) => startModDrag(herdrAll, { kind: "pane", pane, terminal: p.terminal, label: name, x: e.position.x, y: e.position.y }, now))
      .on_mouse_move((e) => {
        if (hasNativeDrag(herdrAll)) return;
        const w = e.bounds?.width ?? 0;
        const lx = e.local_position?.x ?? 0;
        const place = w > 0 && lx > w * 0.65 ? "down" : "right";
        const key = place === "down" ? dropKeyDown : dropKeyRight;
        if (dragNow) {
          reportDragTarget(herdrAll, e, { type: "pane-head", key, tab: p.tab, pane, name, place }, now);
        } else {
          trackDragMove(herdrAll, e, now);
        }
      })
      .on_mouse_up("left", (e, cx) => {
        if (finishJsDrag(herdrAll, cx, null, Date.now(), e?.position)) cx.notify();
      })
      .on_click((e) => {
        if (recentlyDragged()) return;
        run("pane.focus", { pane });
        if (e.click_count === 2) {
          if ((p.terminal || hasPaneRename) && this.has.rename) {
            openOverlay({ mod: "herdbook-rename", kind: "dialog", width: 380, props: { target } });
          } else if (hasPaneRename) {
            run("pane.rename", { pane });
          }
        }
      })
      .when(this.has.menu, (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("pane", target); }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(targeted, (el) => el.child(div().flex_none().px(6).h(18).rounded(5).bg(t.accent + "26").text_size(10.5).font_medium().text_color(t.accent).flex().items_center()
        .child(downTargeted ? "↓ Split down" : "→ Split right")))
      .when(!targeted && st === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(!targeted && st === "blocked", (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(!targeted && st === "done", (el) => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(!targeted && this.hovered, (el) => el
        .when(this.has.menu && (Boolean(p.terminal) || hasNativeMove), (el) => el.child(this.button(t, `ph-m-${pane}`, "move-space",
          () => this.menu("move-space", { kind: "pane", ...target, space: spaceOfTab(p.tab) }), "Move to another workspace")))
        .child(this.button(t, `ph-r-${pane}`, "split-right", () => run("pane.split", { direction: "right", pane })))
        .child(this.button(t, `ph-d-${pane}`, "split-down", () => run("pane.split", { direction: "down", pane })))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", () => run("pane.zoom", { pane })))
        .child(this.button(t, `ph-x-${pane}`, "close", () => run("pane.close", { pane }))));
  }
}
