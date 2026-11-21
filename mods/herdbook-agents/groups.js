// How the grouped view orders and names agents. No herdr import, so node can test it.

// Grouped: the space where an agent's state changed last comes first, and within
// a tab (a group) so does that agent, so a finished or newly working one rises to
// the top. Tabs keep their order in a space. `list` is in agents() order (a
// space's agents together, a tab's together); since(a) is when a changed (ms).
export function groupedOrder(list, since) {
  const runs = [];
  for (const a of list) {
    const r = runs.find((x) => x.space === a.space);
    if (r) r.members.push(a);
    else runs.push({ space: a.space, members: [a] });
  }
  const latest = (r) => Math.max(0, ...r.members.map(since));
  // sort is stable: ties keep Herdr's order.
  runs.sort((x, y) => latest(y) - latest(x));
  return runs.flatMap((r) => {
    const tabs = [];
    for (const a of r.members) {
      if (tabs.at(-1)?.[0].tab === a.tab) tabs.at(-1).push(a);
      else tabs.push([a]);
    }
    return tabs.flatMap((t) => t.sort((x, y) => since(y) - since(x)));
  });
}

// A tab someone named, not just after its program (Herdr names a tab after its
// first agent): its name, else null.
export function frameName(tab, panes) {
  return tab.named && !panes.some((p) => p.tab === tab.id && p.program?.name === tab.name) ? tab.name : null;
}

// In a frame each row names its pane: label(a), or its program's name where the
// label is only an automatic tab number; two that read the same get numbers in
// split order ("zsh 1", "zsh 2"). order: Map terminal address -> split position.
export function paneNames(list, order, label) {
  const out = new Map();
  for (const tab of new Set(list.map((a) => a.tab))) {
    const inTab = list.filter((a) => a.tab === tab).sort((x, y) => (order.get(x.address) ?? 0) - (order.get(y.address) ?? 0));
    const base = new Map(inTab.map((a) => [a.address, /^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a)]));
    const count = {}, nth = {};
    for (const n of base.values()) count[n] = (count[n] ?? 0) + 1;
    for (const a of inTab) {
      const n = base.get(a.address);
      nth[n] = (nth[n] ?? 0) + 1;
      out.set(a.address, count[n] > 1 ? `${n} ${nth[n]}` : n);
    }
  }
  return out;
}
