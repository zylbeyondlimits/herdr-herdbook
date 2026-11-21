// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "herdbook-pane" } } } }
// Shows the program's icon (the app's program table), the pane's name, the folder,
// and the agent's status; buttons move to another space, split, zoom and close this
// pane. The name is the terminal's `pane-name` label (set with herdbook-rename),
// else the agent's name or the terminal's title. Props from the app: { pane, terminal }.
// Click: focus the pane. Double-click: rename it. Right-click: the herdbook-menu.
// Without herdbook-rename or herdbook-menu, the entries that open them don't show.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, terminals, spaces, openOverlay, appHome, readTextFile } from "herdr";

// Whether a mod is installed (readTextFile: fs/promises only reads under the home folder).
const installed = (name) => readTextFile(`${appHome()}/mods/${name}/mod.json`).then((s) => s !== null, () => false);

const LABEL = "pane-name";

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
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
    cx.spawn(async (cx) => {
      this.has = { menu: await installed("herdbook-menu"), rename: await installed("herdbook-rename") };
      cx.notify();
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, action, tip) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action();
      })
      .child(svg(`mods/herdbook-pane/${icon}.svg`).size(14));
  }

  menu(tab, target) {
    openOverlay({ mod: "herdbook-menu", kind: "popup", width: 228, height: 320, props: { tab, target } });
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const custom = p.terminal ? terminals().find((k) => k.address === p.terminal)?.labels?.[LABEL] : null;
    const name = custom || ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    const target = { pane, terminal: p.terminal };
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click((e) => {
        run("pane.focus", { pane });
        if (e.click_count === 2 && p.terminal && this.has.rename) {
          openOverlay({ mod: "herdbook-rename", kind: "dialog", width: 380, props: { target } });
        }
      })
      .when(this.has.menu, el => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("pane", target); }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .when(this.has.menu && Boolean(p.terminal), el => el.child(this.button(t, `ph-m-${pane}`, "move-space",
          () => this.menu("move-space", { kind: "pane", ...target, space: spaceOfTab(p.tab) }), "Move to another space")))
        .child(this.button(t, `ph-r-${pane}`, "split-right", () => run("pane.split", { direction: "right", pane })))
        .child(this.button(t, `ph-d-${pane}`, "split-down", () => run("pane.split", { direction: "down", pane })))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", () => run("pane.zoom", { pane })))
        .child(this.button(t, `ph-x-${pane}`, "close", () => run("pane.close", { pane }))));
  }
}
