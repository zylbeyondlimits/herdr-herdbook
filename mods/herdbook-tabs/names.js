// What a tab chip says. No herdr import, so node can test it.

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
export const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
export function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

// A pane in a chip: its given name (the terminal's `pane-name` label), else
// what an unnamed tab with only it would say.
export function paneLabel(p, named) {
  if (p.terminal && named.has(p.terminal)) return named.get(p.terminal);
  if (p.mod) return p.title || p.mod;
  return label({ named: false }, p);
}

// tab: one of spaces()[i].tabs; inTab: its panes() in split order; named:
// Map terminal address -> given name. Returns
//   { kind: "one", name, icons }       one pane on screen: Herdr's label, or the pane's given name
//   { kind: "many", name, segments }   several: each pane's icon and name, joined with " · "
//   { kind: "group", name, icons, tip }  several in a tab someone named: all icons, the tab's name
export function chip(tab, inTab, named) {
  // Zoomed, only that pane is on screen.
  const onScreen = tab.zoomed ? inTab.filter((p) => p.zoomed) : inTab;
  const names = onScreen.map((p) => paneLabel(p, named));
  // A tab named after its program (Herdr does that) isn't a group name.
  if (onScreen.length > 1 && tab.named && !inTab.some((p) => p.program?.name === tab.name)) {
    return { kind: "group", name: tab.name, icons: onScreen.map((p) => p.program).filter((g) => g?.icon), tip: names.join(" · ") };
  }
  if (onScreen.length > 1) {
    return { kind: "many", name: names.join(" · "), segments: onScreen.map((p, i) => ({ program: p.program, name: names[i] })) };
  }
  const lead = onScreen[0] && tab.zoomed ? onScreen[0] : inTab.find((p) => p.program?.agent) ?? inTab[0];
  const name = lead?.terminal && named.has(lead.terminal) ? named.get(lead.terminal) : label(tab, lead);
  return { kind: "one", name, icons: lead?.program?.icon ? [lead.program] : [] };
}
