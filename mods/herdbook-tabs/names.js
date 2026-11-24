// What a tab chip says, plus layout row helpers. No herdr import, so node can test it.

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
export const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// Custom name precedence: terminal.labels?.["pane-name"] || pane.name || agent.pane_name.
export function customPaneName(p, named) {
  if (!p) return null;
  const fromMap = (p.terminal && named?.get(p.terminal)) || (p.pane && named?.get(`pane:${p.pane}`)) || null;
  return fromMap || p.labels?.["pane-name"] || p.name || p.pane_name || null;
}

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
export function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? lead?.title ?? lead?.mod ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

// A pane in a chip: its custom name (`pane-name` label or 0.1.17 `pane.name`),
// else mod title, else what an unnamed tab with only it would say.
export function paneLabel(p, named) {
  const custom = customPaneName(p, named);
  if (custom) return custom;
  if (p.mod) return p.title || p.mod;
  return label({ named: false }, p);
}

// tab: one of spaces()[i].tabs; inTab: its panes() in split order; named:
// Map terminal address -> given name. Returns
//   { kind: "one", name, icons }       one pane on screen: Herdr's label, or the pane's given name
//   { kind: "many", name, segments }   several: each pane's icon and name, joined with " · "
//   { kind: "group", name, icons, tip, members }  several in a tab someone named: all icons, the tab's name
// Segments and members carry their pane and terminal, so each can be dragged.
export function chip(tab, inTab, named) {
  // Zoomed, only that pane is on screen.
  const onScreen = tab.zoomed ? inTab.filter((p) => p.zoomed) : inTab;
  const names = onScreen.map((p) => paneLabel(p, named));
  // A tab named after its program (Herdr does that) isn't a group name.
  if (onScreen.length > 1 && tab.named && !inTab.some((p) => p.program?.name === tab.name)) {
    return {
      kind: "group", name: tab.name, icons: onScreen.map((p) => p.program).filter((g) => g?.icon), tip: names.join(" · "),
      members: onScreen.map((p, i) => ({ program: p.program, name: names[i], pane: p.pane, terminal: p.terminal })),
    };
  }
  if (onScreen.length > 1) {
    return { kind: "many", name: names.join(" · "), segments: onScreen.map((p, i) => ({ program: p.program, name: names[i], pane: p.pane, terminal: p.terminal })) };
  }
  const lead = onScreen[0] && tab.zoomed ? onScreen[0] : inTab.find((p) => p.program?.agent) ?? inTab[0];
  const custom = customPaneName(lead, named);
  const name = custom || label(tab, lead);
  return { kind: "one", name, icons: lead?.program?.icon ? [lead.program] : [] };
}

// True when `modName` sits inside a layout row with at least one visible sibling after it
// (such as `frost`, `usage-meter`, or both in `tabs-row`), tightening right padding to 3px.
export function hasTrailingSibling(node, modName = "herdbook-tabs") {
  if (!node || node.hidden) return false;
  const kids = node.children ?? [];
  if (node.type === "row") {
    const i = kids.findIndex((k) => !k?.hidden && k?.content?.mod === modName);
    if (i >= 0 && kids.slice(i + 1).some((k) => k && !k.hidden)) return true;
  }
  return kids.some((k) => hasTrailingSibling(k, modName));
}

// Decides what dropping onto a top-bar tab chip at `localX` means while dragging:
//   - Single-pane drag (from a pane header, sidebar row, multi-pane segment, OR 1-pane tab):
//     center joins the target tab (`type: "group"`), left/right edges insert beside it (`type: "gap"`).
//   - Pane dragged out of a multi-pane tab onto its OWN tab's left/right edge splits out beside it;
//     center of its own tab cancels (`null`).
//   - Multi-pane tab (`kind: "tab"`, 2+ panes) reorders left/right (`type: "gap"`).
export function tabChipDropAction({ drag, tab, tabLabel = null, spaceId = null, panes = [], bounds = null, localX = null }) {
  if (!drag || drag.kind === "space" || !tab || !spaceId || !bounds || !(bounds.width > 0)) return null;
  const allPanes = panes ?? [];
  let srcTabId = null;
  let carriesSinglePane = false;
  let isSplittingFromMulti = false;

  if (drag.kind === "tab" && drag.tab) {
    srcTabId = drag.tab;
    const srcCount = allPanes.filter((p) => p.tab === drag.tab).length;
    carriesSinglePane = srcCount === 1;
  } else {
    const srcPane =
      (drag.pane && allPanes.find((p) => p.pane === drag.pane)) ||
      (drag.terminal && allPanes.find((p) => p.terminal === drag.terminal)) ||
      null;
    srcTabId = srcPane?.tab ?? null;
    const srcCount = srcTabId ? allPanes.filter((p) => p.tab === srcTabId).length : 0;
    carriesSinglePane = Boolean(drag.pane || drag.terminal);
    isSplittingFromMulti = srcCount > 1;
  }

  const W = bounds.width;
  const lx = Math.max(0, Math.min(W, typeof localX === "number" ? localX : W / 2));
  const edgeRect = (side, w) => {
    const cw = Math.min(W, w + 1);
    return {
      x: side === "left" ? bounds.x : bounds.x + W - cw,
      y: bounds.y,
      width: cw,
      height: bounds.height,
    };
  };
  const edgeGap = (side, w) => ({
    type: "gap",
    key: `tabgap-${side === "left" ? "before" : "after"}-${tab.id}`,
    space: spaceId,
    ...(side === "left" ? { before: tab.id } : { after: tab.id }),
    bounds: edgeRect(side, w),
  });

  if (tab.id === srcTabId) {
    if (!isSplittingFromMulti) return null;
    const edgeW = Math.min(22, Math.max(12, Math.floor(W * 0.2)));
    if (lx < edgeW) return edgeGap("left", edgeW);
    if (lx > W - edgeW) return edgeGap("right", edgeW);
    return null;
  }

  if (!carriesSinglePane) {
    const half = W / 2;
    return lx < half ? edgeGap("left", Math.max(16, half)) : edgeGap("right", Math.max(16, W - half));
  }

  const edgeW = Math.min(22, Math.max(12, Math.floor(W * 0.22)));
  if (lx < edgeW) return edgeGap("left", edgeW);
  if (lx > W - edgeW) return edgeGap("right", edgeW);
  return {
    type: "group",
    key: `tabgrp-${tab.id}`,
    tab: tab.id,
    name: tabLabel ?? tab.name ?? "Tab",
    bounds,
  };
}
