// Moves terminals to another space with commands every Herdr has: park each
// one (its pane goes, it keeps running), show the target space, keep them
// there again. No herdr import, so node can test it with a fake `api`:
//   { panes(), spaces(), focused(), run(name, args), sleep(ms), now() }

const POLL_MS = 25;

// Waits until test() is true; false once `ms` have gone by.
async function until(api, test, ms) {
  const deadline = api.now() + ms;
  while (!test()) {
    if (api.now() >= deadline) return false;
    await api.sleep(POLL_MS);
  }
  return true;
}

const spaceOfTab = (api, tab) => api.spaces().find((s) => (s.tabs ?? []).some((t) => t.id === tab)) ?? null;
const paneOf = (api, addr) => api.panes().find((p) => p.terminal === addr) ?? null;

// spec: { addrs, space: id | "new", folder?, machine?, tabName?, timeout? }
// Resolves { ok: true, space } or { ok: false, error }. On a failure after
// parking, parked terminals are kept again (in their own space if it's still
// there, else in the one shown), so none is left running without a pane.
export async function moveTerminals(api, spec) {
  const { addrs, space: target, folder = null, machine = null, tabName = null, timeout = 2500 } = spec;
  if (!addrs?.length || !target) return { ok: false, error: "Nothing to move" };
  const origin = spaceOfTab(api, paneOf(api, addrs[0])?.tab)?.id ?? null;
  const parked = [];

  const restore = async (error) => {
    if (parked.length) {
      if (origin && api.spaces().some((s) => s.id === origin)) {
        api.run("space.select", { id: origin });
        await until(api, () => api.focused()?.space === origin, timeout);
      }
      for (const addr of parked) {
        if (paneOf(api, addr)) continue;
        api.run("terminal.keep", { terminal: addr });
        await until(api, () => paneOf(api, addr), timeout);
      }
    }
    return { ok: false, error };
  };

  for (const addr of addrs) {
    if (!paneOf(api, addr)) continue;
    api.run("terminal.park", { terminal: addr });
    parked.push(addr);
    if (!(await until(api, () => !paneOf(api, addr), timeout))) return restore(`Couldn't detach ${addr}`);
  }

  // A new space comes with a shell of its own: note its tab to close it after.
  let space = target, extraTab = null;
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
  } else if (api.focused()?.space !== target) {
    api.run("space.select", { id: target });
    if (!(await until(api, () => api.focused()?.space === target, timeout))) return restore("Couldn't show that space");
  }

  // Kept terminals go to the space shown; check each landed there.
  const landed = (addr) => spaceOfTab(api, paneOf(api, addr)?.tab)?.id === space;
  const [first, ...rest] = parked.length ? parked : addrs;
  api.run("terminal.keep", { terminal: first });
  if (!(await until(api, () => landed(first), timeout))) return restore(`Couldn't attach ${first}`);
  // keep names the new tab after the terminal's address ("t7"): give it the
  // moved tab's name, else Herdr's own ("" = its number).
  api.run("tab.rename", { id: paneOf(api, first).tab, name: tabName ?? "" });
  for (const addr of rest) {
    const anchor = paneOf(api, first);
    if (anchor && !anchor.focused) api.run("pane.focus", { pane: anchor.pane });
    api.run("terminal.keep", { terminal: addr, place: "right" });
    if (!(await until(api, () => landed(addr), timeout))) return restore(`Couldn't attach ${addr}`);
  }
  if (extraTab && extraTab !== paneOf(api, first)?.tab) api.run("tab.close", { id: extraTab, confirmed: true });
  return { ok: true, space };
}
