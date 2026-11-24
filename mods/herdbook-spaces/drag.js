// Dual-engine cross-surface drag (Workspace / Tab / Pane) + edge auto-scroll.
// Route 1 (Native): uses Herdr's startDrag / dragging / setDrag* when present.
// Route 2 (Pure-JS fallback on official Herdr 0.1.16+): coordinates across mods via
// shared("herdbook.drag") and executes drops with space.move / tab.move / park+keep.
// Canonical source: mods/herdbook-agents/drag.js (synced to sibling mods via scripts/sync-drag.sh).
// No top-level `herdr` import so Node tests can import and verify every path.

const SHARED_KEY = "herdbook.drag";
const UNMOVED_STALE_MS = 1500;
const IDLE_DRAG_MS = 2500;
const MAX_DRAG_MS = 20000;
const THRESHOLD_PX = 5;
const POLL_MS = 25;

let lastEndedAt = 0;

export function hasNativeDrag(h) {
  return (
    typeof h?.startDrag === "function" &&
    typeof h?.dragging === "function" &&
    typeof h?.setDragSpace === "function" &&
    typeof h?.setDragTab === "function" &&
    typeof h?.setDragGroup === "function" &&
    typeof h?.setDragGap === "function"
  );
}

export function gapSlotIndex(tabs, before, after, movingTabId = null) {
  const rest = (tabs ?? []).map((t) => t.id).filter((id) => id !== movingTabId);
  if (before) {
    const i = rest.indexOf(before);
    return (i >= 0 ? i : rest.length) + 1;
  }
  if (after) {
    const i = rest.indexOf(after);
    return (i >= 0 ? i + 1 : rest.length) + 1;
  }
  return rest.length + 1;
}

const spaceOfTab = (spaces, tabId) => (spaces ?? []).find((s) => (s.tabs ?? []).some((t) => t.id === tabId)) ?? null;
const paneOfAddr = (panes, addr) => (addr ? (panes ?? []).find((p) => p.terminal === addr) ?? null : null);
const machineFromAddr = (addr) => (addr && addr.includes("/") ? addr.split("/")[0] : null);

export function pointInBounds(pos, bounds, slop = 2) {
  if (!pos || !bounds) return true;
  const { x, y, width, height } = bounds;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") return true;
  return (
    pos.x >= x - slop &&
    pos.x <= x + width + slop &&
    pos.y >= y - slop &&
    pos.y <= y + height + slop
  );
}

function nativeMoveCommands(h) {
  const cmds = h?.commands?.() ?? [];
  const args = (name) => cmds.find((c) => c.name === name)?.args?.map((a) => a.name) ?? [];
  return args("pane.move").includes("space") && args("tab.move").includes("space");
}

function resolveOrigin(h, spec) {
  const sp = h.spaces?.() ?? [];
  const ps = h.panes?.() ?? [];
  if (spec.kind === "space" && spec.space) {
    const s = sp.find((x) => x.id === spec.space);
    return {
      space: s?.id ?? spec.space,
      machine: s?.machine ?? machineFromAddr(spec.space),
      pane: null,
      terminal: null,
      tab: null,
    };
  }
  if (spec.kind === "tab" && spec.tab) {
    const s = spaceOfTab(sp, spec.tab) ?? (spec.space ? sp.find((x) => x.id === spec.space) : null);
    return {
      space: s?.id ?? spec.space ?? "",
      machine: s?.machine ?? machineFromAddr(spec.tab),
      pane: null,
      terminal: null,
      tab: spec.tab,
    };
  }
  const p = (spec.pane && ps.find((x) => x.pane === spec.pane)) || paneOfAddr(ps, spec.terminal);
  if (p) {
    const s = spaceOfTab(sp, p.tab) ?? (spec.space ? sp.find((x) => x.id === spec.space) : null);
    const addr = spec.terminal ?? p.terminal ?? null;
    return {
      space: s?.id ?? spec.space ?? "",
      machine: s?.machine ?? machineFromAddr(addr) ?? machineFromAddr(p.pane),
      pane: p.pane,
      terminal: addr,
      tab: p.tab,
    };
  }
  const addr = spec.terminal ?? null;
  const term = addr ? (h.terminals?.() ?? []).find((t) => t.address === addr) : null;
  const parentPane = term?.parent ? paneOfAddr(ps, term.parent) : null;
  const parentSpaceObj = parentPane
    ? spaceOfTab(sp, parentPane.tab)
    : spec.space ? sp.find((x) => x.id === spec.space) : null;
  return {
    space: parentSpaceObj?.id ?? spec.space ?? "",
    machine: parentSpaceObj?.machine ?? machineFromAddr(addr) ?? machineFromAddr(spec.space),
    pane: null,
    terminal: addr,
    tab: null,
  };
}

function carriedPane(h, d) {
  if (!d) return null;
  if (d.pane) return d.pane;
  if (d.tab) {
    const inTab = (h.panes?.() ?? []).filter((p) => p.tab === d.tab);
    if (inTab.length === 1) return inTab[0].pane;
  }
  return null;
}

export function isJsDragStale(d, now = Date.now()) {
  if (!d || typeof d !== "object") return true;
  const lastAt = d.at ?? 0;
  const startedAt = d.startedAt ?? lastAt;
  if (now - startedAt > MAX_DRAG_MS) return true;
  if (!d.moving && now - startedAt > UNMOVED_STALE_MS) return true;
  if (d.moving && now - lastAt > IDLE_DRAG_MS) return true;
  return false;
}

function readJsDrag(h, now = Date.now(), prune = false) {
  const d = h?.shared?.(SHARED_KEY);
  if (!d || typeof d !== "object") return null;
  if (isJsDragStale(d, now)) {
    if (prune) h.setShared?.(SHARED_KEY, null);
    return null;
  }
  return d;
}

export function activeDrag(h, now = Date.now()) {
  if (hasNativeDrag(h)) return h.dragging();
  const d = readJsDrag(h, now, false);
  return d?.moving ? d : null;
}

export function clearJsDrag(h) {
  if (hasNativeDrag(h)) return;
  if (h?.shared?.(SHARED_KEY) != null) h.setShared?.(SHARED_KEY, null);
}

export function cancelModDrag(h, cx) {
  clearJsDrag(h);
  cx?.stop_propagation?.();
}

export function startModDrag(h, spec, now = Date.now()) {
  if (hasNativeDrag(h)) {
    h.startDrag(spec);
    return;
  }
  const origin = resolveOrigin(h, spec);
  h.setShared?.(SHARED_KEY, {
    kind: spec.kind ?? "pane",
    space: origin.space,
    machine: origin.machine ?? null,
    pane: origin.pane,
    terminal: origin.terminal,
    tab: origin.tab,
    label: spec.label ?? "",
    down: { x: spec.x ?? 0, y: spec.y ?? 0 },
    moving: false,
    target: null,
    startedAt: now,
    at: now,
  });
}

function stepJsMove(h, pos, now = Date.now()) {
  const d = readJsDrag(h, now, true);
  if (!d || !pos) return null;
  if (d.moving) return d;
  const dist = Math.max(Math.abs(pos.x - (d.down?.x ?? 0)), Math.abs(pos.y - (d.down?.y ?? 0)));
  if (dist < THRESHOLD_PX) return null;
  const next = { ...d, moving: true, at: now };
  h.setShared?.(SHARED_KEY, next);
  return next;
}

function setJsTarget(h, d, target, now = Date.now()) {
  const prevKey = d.target?.key ?? null;
  const nextKey = target?.key ?? null;
  // Refresh heartbeat cleanly during continuous hover (>=250ms) without spamming setShared every frame.
  if (prevKey === nextKey && now - (d.at ?? 0) < 250) return;
  h.setShared?.(SHARED_KEY, { ...d, target: target ?? null, at: now });
}

function validTarget(h, d, target) {
  if (!d || !target) return null;
  const sp = h.spaces?.() ?? [];
  const ps = h.panes?.() ?? [];
  const dragPane = carriedPane(h, d);
  const srcPaneObj = (dragPane && ps.find((p) => p.pane === dragPane)) || paneOfAddr(ps, d.terminal);
  const hasSingleAddr = Boolean(d.terminal || srcPaneObj?.terminal);
  const hasNativeMove = nativeMoveCommands(h);

  switch (target.type) {
    case "space-order": {
      if (d.kind !== "space") return null;
      if (!target.space || target.space === "new" || target.space === d.space) return null;
      if ((target.machine ?? null) !== (d.machine ?? null)) return null;
      return target;
    }
    case "space": {
      if (d.kind === "space") return null;
      if (!target.space || target.space === d.space) return null;
      if (target.space !== "new" && (target.machine ?? null) !== (d.machine ?? null)) return null;
      if (!hasNativeMove) {
        if (d.kind === "tab") {
          const hasTermInTab = ps.some((p) => p.tab === d.tab && p.terminal);
          if (!hasTermInTab) return null;
        } else if (!hasSingleAddr) {
          return null;
        }
      } else if (!dragPane && !d.tab && !hasSingleAddr) {
        return null;
      }
      return target;
    }
    case "tab": {
      if (d.kind !== "tab" || !d.tab || !target.tab || target.tab === d.tab) return null;
      const srcSpace = spaceOfTab(sp, d.tab);
      const dstSpace = spaceOfTab(sp, target.tab);
      if (srcSpace && dstSpace && srcSpace.id !== dstSpace.id) return null;
      return target;
    }
    case "group":
    case "pane-head": {
      if (d.kind === "space") return null;
      if (!dragPane && !d.terminal) return null;
      const dstSpace = spaceOfTab(sp, target.tab);
      if (!dstSpace || (dstSpace.machine ?? null) !== (d.machine ?? null)) return null;
      if (target.pane && dragPane && target.pane === dragPane) return null;
      const curTab = srcPaneObj?.tab ?? null;
      if (!target.pane && curTab && curTab === target.tab) return null;
      // Moving across tabs on Route 2 requires a terminal (same-tab swap works on mod panes too).
      if (curTab !== target.tab && !hasSingleAddr) return null;
      return target;
    }
    case "gap": {
      if (d.kind === "space") return null;
      if (!dragPane && !d.tab && !d.terminal) return null;
      const dstSpace = sp.find((s) => s.id === target.space);
      if (!dstSpace || (dstSpace.machine ?? null) !== (d.machine ?? null)) return null;
      const inSrcTab = srcPaneObj ? ps.filter((p) => p.tab === srcPaneObj.tab) : [];
      const wholeTabId = d.kind === "tab" ? d.tab : inSrcTab.length === 1 ? srcPaneObj.tab : null;
      if (wholeTabId) {
        const curSpace = spaceOfTab(sp, wholeTabId);
        if (curSpace?.id !== dstSpace.id && !hasNativeMove) {
          const hasTermInTab = ps.some((p) => p.tab === wholeTabId && p.terminal);
          if (!hasTermInTab) return null;
        }
      } else if (!hasSingleAddr) {
        return null;
      }
      return target;
    }
    default:
      return null;
  }
}

export function reportDragTarget(h, e, target, now = Date.now()) {
  const bounds = e?.bounds;
  const pos = e?.position;
  if (hasNativeDrag(h)) {
    const d = h.dragging();
    if (!d || !bounds || !target) return;
    const rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    if (target.type === "space-order") {
      if (d.kind === "space") h.setDragSpace({ space: target.space, index: target.index, name: target.name ?? "Space", machine: target.machine ?? null, ...rect });
    } else if (target.type === "space") {
      if (d.kind !== "space") h.setDragSpace({ space: target.space, name: target.name ?? "Space", machine: target.machine ?? null, ...rect });
    } else if (target.type === "tab") {
      if (d.kind === "tab") h.setDragTab({ tab: target.tab, index: target.index, ...rect });
    } else if (target.type === "group") {
      if (d.kind !== "space") h.setDragGroup({ tab: target.tab, pane: target.pane ?? null, name: target.name ?? "Tab", ...rect });
    } else if (target.type === "gap") {
      if (d.kind !== "space") h.setDragGap({ space: target.space, before: target.before ?? null, after: target.after ?? null, ...rect });
    }
    return;
  }
  const d = stepJsMove(h, pos, now);
  if (!d) return;
  const checked = validTarget(h, d, target);
  const withBounds = checked && bounds
    ? { ...checked, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } }
    : checked;
  setJsTarget(h, d, withBounds, now);
}

export function trackDragMove(h, e, now = Date.now()) {
  if (hasNativeDrag(h)) return;
  const pos = e?.position;
  const d = stepJsMove(h, pos, now);
  if (!d || !pos) return;
  if (d.target?.bounds && !pointInBounds(pos, d.target.bounds)) {
    h.setShared?.(SHARED_KEY, { ...d, target: null, at: now });
  } else if (now - (d.at ?? 0) >= 250) {
    h.setShared?.(SHARED_KEY, { ...d, at: now });
  }
}

export function isJsTarget(h, key, now = Date.now()) {
  if (hasNativeDrag(h)) return false;
  const d = readJsDrag(h, now, false);
  return Boolean(d?.moving && d.target?.key === key);
}

export function jsTargetOf(h, now = Date.now()) {
  if (hasNativeDrag(h)) return null;
  const d = readJsDrag(h, now, false);
  return d?.moving ? d.target ?? null : null;
}

export function recentlyDragged(now = Date.now()) {
  return now - lastEndedAt < 180;
}

// --- Pure-JS Fallback Move Executor (Official Herdr 0.1.16+ commands) ---

async function until(api, pred, ms) {
  const deadline = api.now() + ms;
  while (!pred()) {
    if (api.now() >= deadline) return false;
    await api.sleep(POLL_MS);
  }
  return true;
}

export async function moveTerminals(api, spec) {
  const { addrs, space: target, folder = null, machine = null, tabName = null, timeout = 2500 } = spec;
  if (!addrs?.length || !target) return { ok: false, error: "Nothing to move" };
  const origin = spaceOfTab(api.spaces(), paneOfAddr(api.panes(), addrs[0])?.tab)?.id ?? null;
  const parked = [];

  const restore = async (error) => {
    if (parked.length) {
      if (origin && api.spaces().some((s) => s.id === origin)) {
        api.run("space.select", { id: origin });
        await until(api, () => api.focused()?.space === origin, timeout);
      }
      for (const addr of parked) {
        if (paneOfAddr(api.panes(), addr)) continue;
        api.run("terminal.keep", { terminal: addr });
        await until(api, () => paneOfAddr(api.panes(), addr), timeout);
      }
    }
    return { ok: false, error };
  };

  for (const addr of addrs) {
    if (!paneOfAddr(api.panes(), addr)) continue;
    api.run("terminal.park", { terminal: addr });
    parked.push(addr);
    if (!(await until(api, () => !paneOfAddr(api.panes(), addr), timeout))) return restore(`Couldn't detach ${addr}`);
  }

  let space = target;
  let extraTab = null;
  if (target === "new") {
    const before = new Set(api.spaces().map((s) => s.id));
    const args = {};
    if (folder) args.folder = folder;
    if (machine) args.machine = machine;
    api.run("space.new", args);
    const made = () => api.spaces().find((s) => !before.has(s.id));
    if (!(await until(api, () => made() && api.focused()?.space === made().id, timeout))) return restore("Couldn't make the new space");
    space = made().id;
    extraTab = made().tabs?.[0]?.id ?? null;
  } else {
    if (api.focused()?.space !== target) {
      api.run("space.select", { id: target });
      if (!(await until(api, () => api.focused()?.space === target, timeout))) return restore("Couldn't show that space");
    }
  }

  const landed = (addr) => spaceOfTab(api.spaces(), paneOfAddr(api.panes(), addr)?.tab)?.id === space;
  const [first, ...rest] = parked.length ? parked : addrs;
  api.run("terminal.keep", { terminal: first });
  if (!(await until(api, () => landed(first), timeout))) return restore(`Couldn't attach ${first}`);
  const tabId = paneOfAddr(api.panes(), first).tab;
  api.run("tab.rename", { id: tabId, name: tabName ?? "" });
  for (const addr of rest) {
    const anchor = paneOfAddr(api.panes(), first);
    if (anchor && !anchor.focused) api.run("pane.focus", { pane: anchor.pane });
    api.run("terminal.keep", { terminal: addr, place: "right" });
    if (!(await until(api, () => landed(addr), timeout))) return restore(`Couldn't attach ${addr}`);
  }
  if (extraTab && extraTab !== tabId) api.run("tab.close", { id: extraTab, confirmed: true });
  return { ok: true, space, tab: tabId };
}

export async function executeDrop(api, d, target, timeout = 2500) {
  if (!d || !target) return { ok: false, error: "No target" };

  if (target.type === "space-order") {
    if (!d.space || !target.index) return { ok: false, error: "Missing space index" };
    api.run("space.move", { id: d.space, index: target.index });
    return { ok: true };
  }

  if (target.type === "tab") {
    if (!d.tab || !target.index) return { ok: false, error: "Missing tab index" };
    api.run("tab.move", { id: d.tab, index: target.index });
    return { ok: true };
  }

  const ps = api.panes();
  const sp = api.spaces();
  const solePane = d.tab ? (() => {
    const inTab = ps.filter((p) => p.tab === d.tab);
    return inTab.length === 1 ? inTab[0] : null;
  })() : null;
  const srcPaneObj = (d.pane && ps.find((p) => p.pane === d.pane)) || solePane || paneOfAddr(ps, d.terminal);
  const singleAddr = d.terminal || srcPaneObj?.terminal || null;

  if (target.type === "space") {
    if (nativeMoveCommands(api)) {
      if (d.kind === "tab" && d.tab) {
        api.run("tab.move", { id: d.tab, space: target.space });
      } else {
        const moveArgs = { space: target.space };
        if (srcPaneObj?.pane) moveArgs.pane = srcPaneObj.pane;
        if (singleAddr) moveArgs.terminal = singleAddr;
        api.run("pane.move", moveArgs);
      }
      return { ok: true };
    }
    const addrs = d.kind === "tab" && d.tab
      ? [...new Set(ps.filter((p) => p.tab === d.tab && p.terminal).map((p) => p.terminal))]
      : singleAddr ? [singleAddr] : [];
    if (!addrs.length) return { ok: false, error: "Only terminal panes can move across workspaces on this Herdr version" };
    const fromSpace = d.space ? sp.find((s) => s.id === d.space) : null;
    const tabObj = d.kind === "tab" && d.tab ? fromSpace?.tabs?.find((t) => t.id === d.tab) : null;
    const lead = ps.find((p) => addrs.includes(p.terminal) && p.cwd);
    return moveTerminals(api, {
      addrs,
      space: target.space,
      folder: lead?.cwd ?? null,
      machine: d.machine ?? null,
      tabName: tabObj?.named ? tabObj.name : null,
      timeout,
    });
  }

  if (target.type === "group" || target.type === "pane-head") {
    // Same-tab swap/move (works on both terminal panes and mod panes).
    if (srcPaneObj && srcPaneObj.tab === target.tab) {
      if (target.pane && target.pane !== srcPaneObj.pane) {
        api.run("pane.swap", { pane: srcPaneObj.pane, target: target.pane });
      }
      return { ok: true };
    }
    if (!singleAddr) return { ok: false, error: "Only terminal panes can move across tabs on this Herdr version" };
    const dstSpace = spaceOfTab(sp, target.tab);
    if (!dstSpace) return { ok: false, error: "Target tab not found" };
    const originSpace = spaceOfTab(sp, srcPaneObj?.tab)?.id ?? d.space ?? null;
    let parked = false;
    const restoreSingle = async (error) => {
      if (parked && !paneOfAddr(api.panes(), singleAddr)) {
        if (originSpace && api.spaces().some((s) => s.id === originSpace)) {
          api.run("space.select", { id: originSpace });
          await until(api, () => api.focused()?.space === originSpace, timeout);
        }
        api.run("terminal.keep", { terminal: singleAddr });
        await until(api, () => paneOfAddr(api.panes(), singleAddr), timeout);
      }
      return { ok: false, error };
    };
    if (paneOfAddr(api.panes(), singleAddr)) {
      api.run("terminal.park", { terminal: singleAddr });
      parked = true;
      if (!(await until(api, () => !paneOfAddr(api.panes(), singleAddr), timeout))) {
        return restoreSingle(`Couldn't detach ${singleAddr}`);
      }
    }
    if (api.focused()?.space !== dstSpace.id) {
      api.run("space.select", { id: dstSpace.id });
      if (!(await until(api, () => api.focused()?.space === dstSpace.id, timeout))) {
        return restoreSingle("Couldn't show target space");
      }
    }
    api.run("tab.select", { id: target.tab });
    await until(
      api,
      () => {
        const tabs = api.spaces().find((s) => s.id === dstSpace.id)?.tabs ?? [];
        const t = tabs.find((x) => x.id === target.tab);
        return !t || t.active === undefined || Boolean(t.active);
      },
      Math.min(400, timeout),
    );
    const anchor = (target.pane && api.panes().find((p) => p.pane === target.pane))
      || api.panes().find((p) => p.tab === target.tab && p.focused)
      || api.panes().find((p) => p.tab === target.tab);
    if (anchor) {
      api.run("pane.focus", { pane: anchor.pane });
      await until(api, () => api.panes().find((p) => p.pane === anchor.pane)?.focused, Math.min(400, timeout));
      api.run("terminal.keep", { terminal: singleAddr, place: target.place ?? "right" });
    } else {
      api.run("terminal.keep", { terminal: singleAddr });
    }
    if (!(await until(api, () => paneOfAddr(api.panes(), singleAddr)?.tab === target.tab, timeout))) {
      return restoreSingle("Couldn't join tab");
    }
    return { ok: true };
  }

  if (target.type === "gap") {
    const dstSpace = sp.find((s) => s.id === target.space);
    if (!dstSpace) return { ok: false, error: "Target space not found" };
    const inSrcTab = srcPaneObj ? ps.filter((p) => p.tab === srcPaneObj.tab) : [];
    const wholeTabId = d.kind === "tab" ? d.tab : inSrcTab.length === 1 ? srcPaneObj.tab : null;

    if (wholeTabId) {
      const curSpace = spaceOfTab(sp, wholeTabId);
      // A pane (not the tab header) taken out of a one-pane group leaves the group's name behind.
      const srcTabObj = curSpace?.tabs?.find((t) => t.id === wholeTabId) ?? null;
      const clearLoneGroupName = Boolean(
        d.kind !== "tab" &&
        inSrcTab.length === 1 &&
        srcTabObj?.named &&
        !inSrcTab.some((p) => p.program?.name === srcTabObj.name),
      );
      if (curSpace?.id === dstSpace.id) {
        const index = gapSlotIndex(dstSpace.tabs, target.before, target.after, wholeTabId);
        if (clearLoneGroupName) api.run("tab.rename", { id: wholeTabId, name: "" });
        api.run("tab.move", { id: wholeTabId, index });
        return { ok: true };
      }
      if (nativeMoveCommands(api)) {
        if (clearLoneGroupName) api.run("tab.rename", { id: wholeTabId, name: "" });
        api.run("tab.move", { id: wholeTabId, space: dstSpace.id });
        const fresh = api.spaces().find((s) => s.id === dstSpace.id);
        api.run("tab.move", { id: wholeTabId, index: gapSlotIndex(fresh?.tabs, target.before, target.after, wholeTabId) });
        return { ok: true };
      }
      const addrs = [...new Set(ps.filter((p) => p.tab === wholeTabId && p.terminal).map((p) => p.terminal))];
      if (!addrs.length) return { ok: false, error: "Only terminal tabs can move across workspaces on this Herdr version" };
      const tabObj = curSpace?.tabs?.find((t) => t.id === wholeTabId);
      const lead = ps.find((p) => addrs.includes(p.terminal) && p.cwd);
      const r = await moveTerminals(api, {
        addrs,
        space: dstSpace.id,
        folder: lead?.cwd ?? null,
        machine: d.machine ?? null,
        tabName: !clearLoneGroupName && tabObj?.named ? tabObj.name : null,
        timeout,
      });
      if (!r.ok) return r;
      const fresh = api.spaces().find((s) => s.id === dstSpace.id);
      if (r.tab) api.run("tab.move", { id: r.tab, index: gapSlotIndex(fresh?.tabs, target.before, target.after, r.tab) });
      return { ok: true };
    }

    if (!singleAddr) return { ok: false, error: "Only terminal panes can split into a new tab on this Herdr version" };
    const r = await moveTerminals(api, {
      addrs: [singleAddr],
      space: dstSpace.id,
      folder: srcPaneObj?.cwd ?? null,
      machine: d.machine ?? null,
      tabName: null,
      timeout,
    });
    if (!r.ok) return r;
    const fresh = api.spaces().find((s) => s.id === dstSpace.id);
    if (r.tab) api.run("tab.move", { id: r.tab, index: gapSlotIndex(fresh?.tabs, target.before, target.after, r.tab) });
    return { ok: true };
  }

  return { ok: false, error: "Unsupported drop target" };
}

export function finishJsDrag(h, cx, targetOverride = null, now = Date.now(), releasePos = null) {
  if (hasNativeDrag(h)) return false;
  const raw = h?.shared?.(SHARED_KEY);
  if (!raw) return false;
  h.setShared?.(SHARED_KEY, null);
  if (isJsDragStale(raw, now) || !raw.moving) return false;
  lastEndedAt = now;
  let chosen = targetOverride ? validTarget(h, raw, targetOverride) : raw.target;
  if (!targetOverride && chosen?.bounds && releasePos && !pointInBounds(releasePos, chosen.bounds)) {
    chosen = null;
  }
  if (!chosen) return true;
  cx.spawn(async (cx) => {
    const api = {
      panes: () => h.panes(),
      spaces: () => h.spaces(),
      focused: () => h.focused(),
      commands: () => h.commands?.() ?? [],
      run: (name, args) => h.run(name, args),
      sleep: (ms) => cx.sleep(ms),
      now: () => Date.now(),
    };
    const r = await executeDrop(api, raw, chosen);
    if (!r.ok && r.error) h.notify?.({ title: "Couldn't move", body: r.error, level: "error" });
  });
  return true;
}

export function createScrollState() {
  return { index: null, downPos: null, lastAt: 0, updatedAt: 0 };
}

export function recordDragAnchor(state, e, index, now = Date.now()) {
  if (!state) return;
  if (typeof index === "number" && index >= 0) state.index = index;
  if (e?.position) state.downPos = { x: e.position.x, y: e.position.y };
  state.updatedAt = now;
}

export function recordHoverIndex(state, index, now = Date.now()) {
  if (!state || typeof index !== "number" || index < 0) return;
  state.index = index;
  state.updatedAt = now;
}

export function resetScrollAnchor(state) {
  if (!state) return;
  state.index = null;
  state.downPos = null;
}

// Edge auto-scroll helper for scrollable lists during an active drag.
// Attach `on_mouse_move` to a non-scrolling outer viewport wrapper around the
// `overflow_*_scrollbar()` element so `e.bounds` / `e.local_position` measure the
// visible viewport rather than GPUI's full-height inner scrolled content box.
export function autoScrollOnDrag(h, scrollHandle, state, e, count, horizontal = false, now = Date.now()) {
  if (!scrollHandle || !count || !state || !activeDrag(h, now)) return;
  if (typeof state.index !== "number" || state.index < 0 || state.index >= count) return;
  const local = e?.local_position;
  const bounds = e?.bounds;
  if (!local || !bounds) return;
  if (now - (state.lastAt ?? 0) < 95) return;
  const pos = horizontal ? local.x : local.y;
  const span = horizontal ? bounds.width : bounds.height;
  const margin = horizontal ? 32 : 24;
  if (span <= margin * 2.5) return;
  let dir = 0;
  if (pos >= 0 && pos < margin) dir = -1;
  else if (pos <= span && pos > span - margin) dir = 1;
  if (!dir) return;
  // Require deliberate pointer travel toward that edge from the initial press point
  // so pressing/selecting an item near the top or bottom edge never jumps the scroll.
  const worldPos = horizontal ? e?.position?.x : e?.position?.y;
  const downAxis = horizontal ? state.downPos?.x : state.downPos?.y;
  if (typeof worldPos === "number" && typeof downAxis === "number") {
    if (dir < 0 && worldPos > downAxis - 12) return;
    if (dir > 0 && worldPos < downAxis + 12) return;
  }
  const next = Math.max(0, Math.min(count - 1, state.index + dir));
  if (next === state.index) return;
  state.index = next;
  state.lastAt = now;
  scrollHandle.scroll_to_item(next);
}
