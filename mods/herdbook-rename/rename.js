// Pure helpers for `herdbook-rename` (no top-level `herdr` import so Node tests can verify every path).
// Bridges Herdr's persistent terminal label (`hc label <addr> pane-name=<name>`, which survives
// cross-space `park`/`keep` moves and restarts) with Herdr 0.1.17+'s layout-level `pane.rename`.

export const LABEL = "pane-name";

export function hasPaneRenameCommand(commands) {
  return (commands ?? []).some((c) => c?.name === "pane.rename");
}

export function normalizePaneName(raw) {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

export function resolveRenameTarget(h) {
  const tg = h?.props?.()?.target ?? null;
  const ps = h?.panes?.() ?? [];
  const foc = h?.focused?.() ?? null;
  const terms = h?.terminals?.() ?? [];
  const ags = h?.agents?.() ?? [];
  const hasPaneRename = hasPaneRenameCommand(h?.commands?.());

  const paneObj = tg
    ? (tg.pane && ps.find((p) => p.pane === tg.pane)) || (tg.terminal && ps.find((p) => p.terminal === tg.terminal)) || null
    : (foc?.pane && ps.find((p) => p.pane === foc.pane)) || (foc?.terminal && ps.find((p) => p.terminal === foc.terminal)) || null;

  // Only pass a real model pane ID from panes() to pane.rename (layout terminal blocks aren't in panes()).
  const pane = paneObj?.pane ?? null;
  const terminal = (tg ? (tg.terminal ?? paneObj?.terminal) : (paneObj?.terminal ?? foc?.terminal)) ?? null;
  const canRename = Boolean(terminal) || (Boolean(pane) && hasPaneRename);

  const termObj = terminal ? terms.find((t) => t.address === terminal) : null;
  const agentObj = ags.find((a) => (terminal && a.address === terminal) || (pane && a.pane === pane)) ?? null;
  const currentName = termObj?.labels?.[LABEL] || paneObj?.name || agentObj?.pane_name || "";

  return {
    pane,
    terminal,
    hasPaneRename,
    canRename,
    isModPane: Boolean(paneObj?.mod && !terminal),
    currentName,
  };
}

export async function savePaneName(h, target, rawText) {
  if (!target?.canRename) {
    return { ok: false, error: "Only terminal panes can be renamed on this Herdr version." };
  }
  const name = normalizePaneName(rawText);
  if (target.terminal) {
    const r = await h.hc(["label", target.terminal, `${LABEL}=${name}`]).catch((e) => ({ code: 1, stderr: String(e) }));
    if (r.code !== 0) {
      return { ok: false, error: (r.stderr || "").trim() || "Couldn't write terminal label." };
    }
  }
  if (target.hasPaneRename && target.pane) {
    h.run("pane.rename", { pane: target.pane, name });
  }
  return { ok: true, name };
}
