// Pure helpers for the Workspace -> Tab -> Pane tree and pane row labels.
// No `herdr` import so Node tests can import and verify every rule.

// Drops status glyphs / spinners before an agent's title ("✦ Working", "⠋ - Thinking", "[ ! ] ").
// Preserves leading brackets or quotes ("[web] login").
export const cleanTitle = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// Custom name precedence across Herdr 0.1.16 (`hc label` -> `labels["pane-name"]`)
// and Herdr 0.1.17+ (`panes()[i].name` / `agents()[i].pane_name`).
export function customPaneName(p, named) {
  if (!p) return null;
  const addr = p.terminal ?? p.address ?? null;
  const fromMap = (addr && named?.get(addr)) || (p.pane && named?.get(`pane:${p.pane}`)) || null;
  return fromMap || p.labels?.["pane-name"] || p.name || p.pane_name || null;
}

// Fixed order for the grouped view: exact Workspace order -> exact Tab order -> exact Pane split order,
// so dragging a workspace, tab, or pane stays right where it was dropped instead of jumping on status updates.
export function workspaceTree(spaces, panes) {
  const byTab = new Map();
  for (const p of panes ?? []) {
    let list = byTab.get(p.tab);
    if (!list) {
      list = [];
      byTab.set(p.tab, list);
    }
    list.push(p);
  }
  return (spaces ?? []).map((space, spaceIndex) => ({
    space,
    spaceIndex,
    tabs: (space.tabs ?? []).map((tab, tabIndex) => ({
      tab,
      tabIndex,
      panes: byTab.get(tab.id) ?? [],
    })),
  }));
}

// Legacy signature preserved for compatibility when callers pass a flat list: keeps fixed input order.
export function groupedOrder(list) {
  return [...(list ?? [])];
}

// A tab someone named (not just Herdr's automatic program name): its name, else null.
export function frameName(tab, panes) {
  return tab?.named && !(panes ?? []).some((p) => p.tab === tab.id && p.program?.name === tab.name) ? tab.name : null;
}

// Base label for one pane inside a tab frame (before duplicate numbering).
export function basePaneName(p, named) {
  const custom = customPaneName(p, named);
  if (custom) return custom;
  const addr = p.terminal ?? p.address ?? null;
  if (p.mod && !addr) return p.title || p.mod;
  const prog = p.program?.name;
  const live = cleanTitle(p.title);
  const isPath = /^[~/]|^[A-Za-z]:\\/.test((p.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling =
    Boolean(live) &&
    live !== addr &&
    live !== prog &&
    !isPath &&
    !live.includes("@") &&
    live.toLowerCase() !== (p.program?.key ?? "").toLowerCase();
  if (p.program?.agent && telling) return live;
  if (!p.program?.agent && !p.program?.shell && prog) return prog;
  return prog || (telling ? live : "") || "Terminal";
}

// Numbers duplicate pane names within each tab in split order ("zsh 1", "zsh 2").
// Keyed by `p.pane ?? p.address`.
export function tabPaneNames(inTab, named = new Map()) {
  const out = new Map();
  const keyOf = (p) => p.pane ?? p.address;
  const bases = (inTab ?? []).map((p) => [keyOf(p), basePaneName(p, named)]);
  const count = {};
  const nth = {};
  for (const [, n] of bases) count[n] = (count[n] ?? 0) + 1;
  for (const [k, n] of bases) {
    nth[n] = (nth[n] ?? 0) + 1;
    out.set(k, count[n] > 1 ? `${n} ${nth[n]}` : n);
  }
  return out;
}

// Compatible wrapper over flat agent/pane lists with explicit split-order map.
export function paneNames(list, order, label) {
  const out = new Map();
  for (const tab of new Set((list ?? []).map((a) => a.tab))) {
    const inTab = list
      .filter((a) => a.tab === tab)
      .sort((x, y) => (order.get(x.address ?? x.pane) ?? 0) - (order.get(y.address ?? y.pane) ?? 0));
    const base = new Map(
      inTab.map((a) => {
        const key = a.address ?? a.pane;
        const raw = label ? label(a) : basePaneName(a);
        return [key, /^\d+$/.test(raw) ? a.program?.name || raw : raw];
      }),
    );
    const count = {};
    const nth = {};
    for (const n of base.values()) count[n] = (count[n] ?? 0) + 1;
    for (const a of inTab) {
      const key = a.address ?? a.pane;
      const n = base.get(key);
      nth[n] = (nth[n] ?? 0) + 1;
      out.set(key, count[n] > 1 ? `${n} ${nth[n]}` : n);
    }
  }
  return out;
}
