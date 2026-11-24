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
    modelSpaceIndex: spaceIndex,
    tabs: (space.tabs ?? []).map((tab, tabIndex) => ({
      tab,
      tabIndex,
      panes: byTab.get(tab.id) ?? [],
      splitPanes: byTab.get(tab.id) ?? [],
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

// ---------------------------------------------------------------------------
// A group (tab) that shrinks from several panes to one stops being a group.
// ---------------------------------------------------------------------------

// Tracks each tab's pane count. A tab that had 2+ panes and now has exactly one:
//   - `unfoldTabIds`: single-pane tabs can't stay folded (there is no header to unfold them);
//   - `dissolveTabIds`: such a tab that still carries a given group name should lose it
//     (`tab.rename { id, name: "" }`), so the sidebar card and the tab chip go back to a plain one.
// A tab with 0 panes (mid-move) keeps its last known count.
export function stepTabGroupCounts(prevCounts, spaces, panes) {
  const cur = new Map();
  for (const p of panes ?? []) cur.set(p.tab, (cur.get(p.tab) ?? 0) + 1);
  const prev = prevCounts && typeof prevCounts === "object" && !Array.isArray(prevCounts) ? prevCounts : {};
  const nextCounts = {};
  const dissolveTabIds = [];
  const unfoldTabIds = [];
  for (const tab of (spaces ?? []).flatMap((s) => s.tabs ?? [])) {
    const count = cur.get(tab.id) ?? 0;
    const before = prev[tab.id] ?? 0;
    if (count === 0) {
      if (tab.id in prev) nextCounts[tab.id] = prev[tab.id];
      continue;
    }
    nextCounts[tab.id] = count;
    if (count === 1) {
      unfoldTabIds.push(tab.id);
      if (before > 1 && frameName(tab, panes)) dissolveTabIds.push(tab.id);
    }
  }
  const a = Object.keys(prev);
  const b = Object.keys(nextCounts);
  const changed = a.length !== b.length || b.some((k) => prev[k] !== nextCounts[k]);
  return { nextCounts, dissolveTabIds, unfoldTabIds, changed };
}

// ---------------------------------------------------------------------------
// Status changes bubble up: pane -> its group -> its workspace -> top of the list.
// Pure state machine; main.js persists `state` in localStorage.
// ---------------------------------------------------------------------------

export const STATUS_RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// A pane's status, counting the unkept sub-agents hung under it (their most urgent state wins).
export function effectivePaneStatus(pane, listed, subStatuses = []) {
  const own = (pane?.terminal && listed?.get?.(pane.terminal)) || pane?.status || null;
  let best = own;
  for (const raw of subStatuses ?? []) {
    const s = raw === "error" ? "blocked" : raw === "done" ? "idle" : raw;
    if ((STATUS_RANK[s] ?? 0) > (STATUS_RANK[best] ?? 0)) best = s;
  }
  return best ?? null;
}

// Whether prev -> next should lift the pane. Looking at a finished pane (done -> idle) must not.
export function isStatusJumpTransition(prev, next) {
  if (!next || prev === next) return false;
  if (prev === "done" && next === "idle") return false;
  return true;
}

function lisKeep(seq) {
  const n = seq.length;
  if (!n) return new Set();
  const len = new Array(n).fill(1);
  const from = new Array(n).fill(-1);
  let best = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j] < seq[i] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        from[i] = j;
      }
    }
    if (len[i] > len[best]) best = i;
  }
  const keep = new Set();
  for (let k = best; k >= 0; k = from[k]) keep.add(k);
  return keep;
}

// Keeps the order the person sees (`visual`, which status jumps changed) while following real
// changes in Herdr's own order (`prevModel` -> `nextModel`): items that were moved there are
// placed next to their new neighbour, new items beside theirs, gone ones dropped.
export function reconcileOrder(visual, prevModel, nextModel) {
  const next = nextModel ?? [];
  const prev = prevModel ?? [];
  const inNext = new Set(next);
  const inPrev = new Set(prev);
  const seen = new Set();
  const out = (visual ?? []).filter((id) => inNext.has(id) && !seen.has(id) && seen.add(id));
  const commonPrev = prev.filter((id) => inNext.has(id));
  const commonNext = next.filter((id) => inPrev.has(id));
  if (commonPrev.length > 1 && commonPrev.join("\u0000") !== commonNext.join("\u0000")) {
    const pos = new Map(commonPrev.map((id, i) => [id, i]));
    const keep = lisKeep(commonNext.map((id) => pos.get(id)));
    const moved = commonNext.filter((_, i) => !keep.has(i));
    for (const id of moved) {
      const at = out.indexOf(id);
      if (at >= 0) out.splice(at, 1);
    }
    for (const id of moved) {
      const idx = commonNext.indexOf(id);
      let at = 0;
      if (idx > 0) {
        const ref = out.indexOf(commonNext[idx - 1]);
        at = ref >= 0 ? ref + 1 : out.length;
      } else {
        const ref = idx + 1 < commonNext.length ? out.indexOf(commonNext[idx + 1]) : -1;
        at = ref >= 0 ? ref : 0;
      }
      out.splice(at, 0, id);
    }
  }
  next.forEach((id, idx) => {
    if (out.includes(id)) return;
    let at = out.length;
    if (idx === next.length - 1) at = out.length; // appended in Herdr's order: it goes last here too
    else if (idx === 0 && next.length > 1 && out.includes(next[1])) at = out.indexOf(next[1]);
    else if (idx > 0 && out.includes(next[idx - 1])) at = out.indexOf(next[idx - 1]) + 1;
    out.splice(at, 0, id);
  });
  return out;
}

const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arrMap = (v) => Object.fromEntries(Object.entries(plain(v)).map(([k, a]) => [k, strArr(a)]));
const statusMap = (v) => Object.fromEntries(Object.entries(plain(v)).filter(([, s]) => s === null || typeof s === "string"));

// Safe copy / normalization of persisted state.
export function createTreeOrderState(saved = null) {
  const s = plain(saved);
  return {
    seeded: s.seeded === true,
    paneStatus: statusMap(s.paneStatus),
    tabStatus: statusMap(s.tabStatus),
    spaceOrder: strArr(s.spaceOrder),
    tabOrder: arrMap(s.tabOrder),
    paneOrder: arrMap(s.paneOrder),
    modelSpaces: strArr(s.modelSpaces),
    modelTabs: arrMap(s.modelTabs),
    modelPanes: arrMap(s.modelPanes),
  };
}

function placeIn(list, id, before, after) {
  const out = list.filter((x) => x !== id);
  let at = out.length;
  if (before && out.includes(before)) at = out.indexOf(before);
  else if (after && out.includes(after)) at = out.indexOf(after) + 1;
  out.splice(at, 0, id);
  return out;
}

const toFront = (list, ids) => {
  const set = new Set(ids);
  return [...list.filter((x) => set.has(x)), ...list.filter((x) => !set.has(x))];
};

// A drop the person made in the sidebar puts the thing exactly where it was dropped in the
// order shown (which may differ from Herdr's own after status jumps). Mutates `state`; true if changed.
export function applyManualDropToTreeOrder(state, drag, target, panes = []) {
  if (!state || !drag || !target) return false;
  if (target.type === "space-order") {
    const list = state.spaceOrder;
    const from = list.indexOf(drag.space);
    const to = list.indexOf(target.space);
    if (from < 0 || to < 0 || from === to) return false;
    list.splice(from, 1);
    list.splice(to, 0, drag.space);
    return true;
  }
  const dragPane = drag.pane ?? (drag.terminal ? panes.find((p) => p.terminal === drag.terminal)?.pane : null) ?? null;
  const srcTab = dragPane ? panes.find((p) => p.pane === dragPane)?.tab ?? null : null;
  if (target.type === "gap") {
    const lone = srcTab && panes.filter((p) => p.tab === srcTab).length === 1 ? srcTab : null;
    const wholeTab = drag.kind === "tab" ? drag.tab : lone;
    const list = wholeTab && state.tabOrder[target.space];
    if (!list) return false;
    state.tabOrder[target.space] = placeIn(list, wholeTab, target.before, target.after);
    return true;
  }
  if (target.type === "group" && target.pane && dragPane && srcTab === target.tab) {
    const list = state.paneOrder[target.tab];
    if (!list || !list.includes(dragPane) || !list.includes(target.pane)) return false;
    state.paneOrder[target.tab] = placeIn(list, dragPane, null, target.pane);
    return true;
  }
  return false;
}

// One render step of the grouped tree. Returns { state, dirty, tree }:
//   tree[i] = { space, spaceIndex (shown), modelSpaceIndex (Herdr's), tabs: [{ tab, tabIndex, panes (shown order),
//   splitPanes (split order, for stable "zsh 1"/"zsh 2" numbers) }] }
export function stepWorkspaceTree(state, spaces, panes, getPaneStatus = null) {
  const get = getPaneStatus ?? ((p) => p?.status ?? null);
  const prev = createTreeOrderState(state);
  const next = createTreeOrderState(prev);
  const spaceList = spaces ?? [];

  const splitByTab = new Map();
  for (const p of panes ?? []) {
    if (!splitByTab.has(p.tab)) splitByTab.set(p.tab, []);
    splitByTab.get(p.tab).push(p);
  }

  const spaceIds = spaceList.map((s) => s.id);
  next.spaceOrder = reconcileOrder(prev.spaceOrder, prev.modelSpaces, spaceIds);
  next.modelSpaces = spaceIds;
  next.tabOrder = {};
  next.modelTabs = {};
  next.paneOrder = {};
  next.modelPanes = {};
  const curPaneStatus = {};
  const curTabStatus = {};
  for (const space of spaceList) {
    const tabIds = (space.tabs ?? []).map((t) => t.id);
    next.tabOrder[space.id] = reconcileOrder(prev.tabOrder[space.id] ?? [], prev.modelTabs[space.id] ?? [], tabIds);
    next.modelTabs[space.id] = tabIds;
    for (const tab of space.tabs ?? []) {
      const ps = splitByTab.get(tab.id) ?? [];
      const ids = ps.map((p) => p.pane);
      next.paneOrder[tab.id] = reconcileOrder(prev.paneOrder[tab.id] ?? [], prev.modelPanes[tab.id] ?? [], ids);
      next.modelPanes[tab.id] = ids;
      for (const p of ps) curPaneStatus[p.pane] = get(p) ?? null;
      curTabStatus[tab.id] = tab.status ?? null;
    }
  }

  if (!prev.seeded) {
    next.seeded = true;
  } else {
    const changedTabsBySpace = new Map();
    for (const space of spaceList) {
      for (const tab of space.tabs ?? []) {
        const order = next.paneOrder[tab.id];
        const changedPanes = order.filter((id) => isStatusJumpTransition(prev.paneStatus[id] ?? null, curPaneStatus[id] ?? null));
        let tabChanged = false;
        if (changedPanes.length) {
          next.paneOrder[tab.id] = toFront(order, changedPanes);
          tabChanged = true;
        } else if (!order.length && isStatusJumpTransition(prev.tabStatus[tab.id] ?? null, curTabStatus[tab.id] ?? null)) {
          tabChanged = true;
        }
        if (tabChanged) {
          if (!changedTabsBySpace.has(space.id)) changedTabsBySpace.set(space.id, []);
          changedTabsBySpace.get(space.id).push(tab.id);
        }
      }
    }
    const changedSpaces = [];
    for (const [spaceId, tabIds] of changedTabsBySpace) {
      next.tabOrder[spaceId] = toFront(next.tabOrder[spaceId], tabIds);
      changedSpaces.push(spaceId);
    }
    if (changedSpaces.length) next.spaceOrder = toFront(next.spaceOrder, changedSpaces);
  }
  next.paneStatus = curPaneStatus;
  next.tabStatus = curTabStatus;

  const dirty = JSON.stringify(next) !== JSON.stringify(prev);
  const spaceById = new Map(spaceList.map((s, i) => [s.id, { space: s, index: i }]));
  const paneById = new Map((panes ?? []).map((p) => [p.pane, p]));
  const tree = next.spaceOrder.map((id, spaceIndex) => {
    const { space, index } = spaceById.get(id);
    const tabById = new Map((space.tabs ?? []).map((t) => [t.id, t]));
    return {
      space,
      spaceIndex,
      modelSpaceIndex: index,
      tabs: next.tabOrder[id].map((tid, tabIndex) => ({
        tab: tabById.get(tid),
        tabIndex,
        panes: next.paneOrder[tid].map((pid) => paneById.get(pid)),
        splitPanes: splitByTab.get(tid) ?? [],
      })),
    };
  });
  return { state: next, dirty, tree };
}
