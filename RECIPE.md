# Herdbook

Herdr's window organized around three visible layers—**Workspace → Tab → Pane**—with persistent names for every pane, space-tinted tab frames in the sidebar, hover quick-actions, and mouse/trackpad drag-and-drop across the sidebar, tab bar, and pane headers.

![Herdbook](preview.png)

## What you see

`layouts/herdbook.json` mirrors Herdr 0.1.16's `main` layout (`titlebar: "none"`, `traffic_lights: [12, 16]`, 268px `chrome` sidebar on the left, `work` column on the right) with five Herdbook blocks swapped in (`herdbook-spaces`, `herdbook-agents`, `herdbook-tabs`, `herdbook-pane`, and root `"terminal_menu": "herdbook-menu"`) plus `herdbook-rename` as an on-demand dialog (`Alt-F2`). `workspace-chrome`, `files`, `changes`, and `workspace-status` remain Herdr's shipped mods.

- **Spaces list** (`herdbook-spaces`, top half of sidebar, `chrome`): colored 18px rounded workspace avatars (`shared("space.colors")`), workspace name (`min_w(48)`), git repo/branch and `↑ahead`/`↓behind` tail, remote SSH machine headers, worktree indentation (`├─` / `└─`), and a header `+` button (`26px`). Narrower than `160px`, it renders a `32px`-cell compact numbered rail with status dots and tooltips.
- **Agents / Workspace tree** (`herdbook-agents`, bottom half of sidebar, `chrome`, `1px` top `border`):
  - **Header** (`41px`): `"Agents"` on the left and a view-switcher icon (`layers.svg` / `clock.svg`) on the right that opens a `212×140` popup to pick **Grouped by workspace** or **Priority**.
  - **Grouped by workspace** (default): full `Workspace → Tab → Pane` tree in fixed structural and split order (shells, editors, mod panes, agents, and unkept sub-agent trees), preceded by an optional **Pinned** shortcut strip when any agent is pinned.
    - **Workspace headers** (`30px`, or `36px` with top divider after the first): 14px color tile with initial, 12px semibold workspace name, optional remote machine tag, hover `18px` `+` quick-action (`New tab`, or `New tab or agent` when active with `launch-menu`), and folded pane count + status + right chevron when collapsed (`localStorage` `"spacesFolded"`).
    - **Tab frames**: rounded cards (`10px` radius, `2px` padding, `1px` border in workspace color at `a6` alpha when active, `59` when inactive). Multi-pane tabs and custom-named tabs render a foldable `22px` header (`26px` when folded, `localStorage` `"groupsFolded"`) with chevron, `layers.svg` (or program icons when folded), tab name (or `"N panes"`), and a hover `16px` `+` button (`Split pane right`). Single-pane unnamed tabs render their pane row directly inside the card and show a `17px` hover `+` button (`Split pane right`) on the row. Duplicate pane names within one tab are numbered in split order (`"zsh 1"`, `"zsh 2"`).
  - **Priority**: status-reporting agents grouped into `Pinned`, `Needs you` (`blocked`), `Done`, `Working`, and `Idle`, with sub-agent fold badges, hover pin buttons, and elapsed state durations.
  - **Compact rail** (`sidebar` `< 160px`): numbered `26px` rows with compact status indicators, tooltips (`Workspace · Pane`), drag support, and a bottom `»` expand button.
- **Tab bar** (`herdbook-tabs`, `42px` high in `herdbook.json`, `chrome`, `1px` bottom `border`, `window_drag: true`):
  - Leaves room on macOS for traffic lights when the sidebar is narrow or hidden.
  - **Single-pane chip** (`29px` high, `7px` radius): 14px icon + custom pane name (else Herdr's live agent title or tab/program label, max `170px`), status spinner/dot, and active close `×`.
  - **Multi-pane unnamed chip**: lists each pane's 14px icon and name (`max_w(96)` each) separated by `dim` `"·"` in split order; each segment is individually clickable and draggable.
  - **Multi-pane named group chip**: shows all pane icons (each individually draggable) followed by the tab's custom name, with every pane's name joined by `" · "` in the tooltip.
  - **Zoomed tab**: shows only the zoomed pane with `" Z"`.
  - **Trailing controls**: `26px` `+` button (opens `launch-menu` `268×512` when installed, else Herdr's `new-menu` `250×512`), `Files` and `Changes` panel toggles, and window buttons where `window().buttons` is true. When placed inside a `tabs-row` `row` with any visible sibling after it (`frost`, `usage-meter`, or both), right padding automatically tightens from `10px` to `3px`.
- **Pane headers** (`herdbook-pane`, `30px` high on every pane via `lone: true`): 14px program icon, custom pane name (`max_w(260)`, `font_medium`, `foreground`), `~`-shortened folder in `dim`, status indicator (`12px` spinning ring, `"Needs you"` pill, or `done` dot), and on hover: Move to another workspace (`move-space.svg`), Split right, Split down, Zoom/Unzoom, and Close. During a pure-JS pane drag, hovering the left 65% or right 35% of another pane's header highlights it in `accent` with `"→ Split right"` or `"↓ Split down"`.
- **Context menu** (`herdbook-menu`, popup `228×320`, `popover`): keyboard (`↑`/`↓`/`Enter`/`→`/`←`/`Esc`) and mouse menu for panes, sidebar agent/pane rows, tabs, workspaces, and `Move to space…` submenu (listing same-machine workspaces with colored tiles plus `"Move to new space"`).
- **Rename dialog** (`herdbook-rename`, dialog `380px` wide, `18px` padding, `popover`): `"Rename pane"` header with `"Esc"` hint, `36px` `Input` (`9px` radius, `accent` focus border), hint text, and `Cancel` / `Save` buttons (`32px` high).

## How it behaves

- **Pane naming & Herdr 0.1.17 forward compatibility:**
  - Reading a pane's custom name everywhere (`herdbook-pane`, `herdbook-tabs`, `herdbook-agents` grouped tree, priority view, pinned strip, sub-agents, and `herdbook-rename` initial value) checks `terminal.labels?.["pane-name"] || pane.name || agent.pane_name`.
  - Saving in `herdbook-rename` collapses whitespace, trims, writes `hc(["label", terminal, "pane-name=<name>"])` for terminal panes (including remote SSH `machine/tN` addresses, surviving restarts and `park`/`keep` cross-space moves), AND when `commands()` includes `"pane.rename"` (Herdr 0.1.17+), also runs `run("pane.rename", { pane, name })`. On Herdr 0.1.17+, non-terminal mod panes (`pane.split { mod }`) can be renamed via `pane.rename` too. Submitting an empty string clears both back to the default title/program name.
- **Pure-GUI quick actions:**
  - Hovering a Workspace header in `herdbook-agents` reveals `+`: opens `launch-menu` when installed and that workspace is active, else runs `tab.new { space }`.
  - Hovering a Tab frame header (or a single-pane tab's row) reveals `+`: runs `pane.split { direction: "right", pane: firstPane }`.
  - Every inline button (`+`, fold chevron, pin, sort, close, split, zoom, move) stops `on_mouse_down("left")` propagation and clears any pending JS drag state so clicking a button never triggers a drag.
- **Dual-engine drag and drop (`drag.js`):**
  - **Route 1 (Native Herdr drag):** when `startDrag`, `dragging`, `setDragSpace`, `setDragTab`, `setDragGroup`, and `setDragGap` exist on `"herdr"`, delegates directly to Herdr's native drag overlay and 4-edge pane drop zones.
  - **Route 2 (Pure-JS fallback on official Herdr 0.1.16+):** coordinates across `herdbook-spaces`, `herdbook-agents`, `herdbook-tabs`, and `herdbook-pane` via `shared("herdbook.drag")` after a `5px` movement threshold:
    - **Workspace reorder:** `space.move { id, index }` within the same machine; newly discovered git worktrees snap under their main checkout once (`localStorage` `"worktrees.placed"`) and never overwrite subsequent manual drags.
    - **Tab reorder & cross-space move:** `tab.move { id, index }` within a space; cross-space tab/pane drops use `tab.move` / `pane.move` with `{ space }` when present in `commands()`, else `moveTerminals` (`terminal.park` → `space.select` / `space.new { folder, machine }` → `terminal.keep` + `tab.rename` + `terminal.keep { place: "right" }`, closing `space.new`'s extra shell tab and rolling back parked terminals if any step times out).
    - **Pane merge / swap / split-to-gap:** dropping on a same-tab pane runs `pane.swap`; dropping on another tab chip, tab frame header, or pane header parks and keeps beside the target pane (`right` or `down`); dropping into a gap between tab frames (or onto top-bar `+`) splits the pane into a new tab at that exact slot (`gapSlotIndex`).
    - **Safety & cleanup:** unmoved presses expire after `1.5s`, idle drags without pointer movement expire after `2.5s`, pointer exit from target bounds clears the highlight immediately, `on_mouse_down_out` clears leftover state on outside clicks, cross-machine drops are blocked, and scrolling lists auto-scroll near top/bottom/left/right edges (`autoScrollOnDrag`).
- **Layout switching & graceful degradation:**
  - Switching layouts with `Ctrl+Shift+L` (`layout.switch`) leaves `main` and personal layouts untouched.
  - Without `herdbook-menu`, right-clicks in `herdbook-tabs` and `herdbook-spaces` fall back to Herdr's `"menu"`, and `herdbook-pane` / `herdbook-agents` hide menu-only actions without errors. Without `herdbook-rename`, double-click falls back to `pane.rename` when available in `commands()`, else focuses the pane.

## Built from

- `layouts/herdbook.json` (MIT) and `keys.json` (`{ "global": { "alt-f2": "mod.open:herdbook-rename" } }`).
- Six mods under `mods/`:
  - `herdbook-rename` (MIT): `main.js` + pure `rename.js` (`resolveRenameTarget`, `savePaneName`, `normalizePaneName`).
  - `herdbook-agents` (Apache 2.0, cloned from `agents` 0.1.16): `main.js` + pure `groups.js` (`workspaceTree`, `frameName`, `tabPaneNames`, `customPaneName`, `paneNames`) + `drag.js`.
  - `herdbook-tabs` (Apache 2.0, cloned from `tabs` 0.1.16): `main.js` + pure `names.js` (`chip`, `label`, `paneLabel`, `customPaneName`, `hasTrailingSibling`) + `drag.js` + Windows titlebar SVGs.
  - `herdbook-pane` (Apache 2.0, cloned from `pane` 0.1.16): `main.js` + `drag.js` + `move-space.svg`, `split-right.svg`, `split-down.svg`, `zoom.svg`, `unzoom.svg`, `close.svg`.
  - `herdbook-spaces` (Apache 2.0, cloned from `spaces` 0.1.16): `main.js` + `drag.js`.
  - `herdbook-menu` (Apache 2.0, cloned from `menu` 0.1.16): `main.js` + pure `move.js` (`moveTerminals`).
- `scripts/sync-drag.sh`: copies canonical `mods/herdbook-agents/drag.js` into `herdbook-tabs`, `herdbook-pane`, and `herdbook-spaces`; `tests/run.sh` asserts byte-for-byte parity before running Node tests.
- Co-existence in `tabs-row`: wrap `herdbook-tabs` (`weight: 1`) with `frost` (`px: 68`, `props: { block: "frost" }`) and/or `usage-meter` (`px: 78`, `props: { block: "usage" }`) inside a `42px` `row` (`resizable: false`, `window_drag: true`).
- `herdr` APIs used: `spaces`, `machines`, `agents`, `panes`, `terminals`, `focused`, `layout`, `theme`, `settings`, `window`, `keys`, `commands`, `run`, `openOverlay`, `closeOverlay`, `notify`, `shared`, `setShared`, `setAgentOrder`, `hc`, `exec`, `watchFolder`, `appHome`, `home`, `readTextFile`, `checking`, and optional native drag functions via namespace import.

## Watch out

- **Guard `init()` with `checking()`:** `herdr-app check` executes `init()` for real and warns if `hc`, `exec`, or `writeTextFile` run. Every Herdbook mod checks `herdr.checking()` before starting background tasks or timers.
- **Namespace-import optional Herdr exports:** `startDrag`, `dragging`, `setDrag*`, and `checking` may not exist on older builds; access them via `import * as herdrAll from "herdr"` with `typeof ... === "function"` checks so module loading never fails.
- **Keep `drag.js` copies in sync:** Herdr mods cannot import `../other-mod/drag.js` across mod folders. Edit `mods/herdbook-agents/drag.js` and run `./scripts/sync-drag.sh`.
- **Use `readTextFile(appHome() + "/mods/<name>/mod.json")` for mod detection:** `fs/promises` only reads inside the user's home directory, whereas `HERDR_APP_HOME` may live under `/tmp` or a custom config path.
- **Never name a helper method `close()` on a `View`:** Herdr invokes `View.prototype.close(cx)` when an overlay or block unmounts (`herdbook-rename` names its helper `dismiss()`).
- **Model panes vs layout terminal blocks:** only pass `pane` to `pane.rename` when `panes().some(p => p.pane === id)` is true; floating/layout terminal blocks carry block IDs outside `panes()`.

## Done when

- `./tests/run.sh` passes 100% (including `drag.js` sync parity, `0.1.17` `pane.name` / `pane_name` fallback, `herdbook-rename`, mod-pane & remote SSH drag rules, stale-drag cleanup, and `tabs-row` trailing sibling detection).
- `herdr-app check` passes with 0 errors and 0 `WARN` lines on all six `mods/herdbook-*` folders on both official Herdr and native-drag Herdr builds.
- Setting `hc label t3 pane-name=api` (or `pane.rename` on 0.1.17+) updates the pane header, tab chip, and sidebar grouped/priority rows within a second; clearing it restores the default program/title label.
- Hovering a workspace header or tab frame in `herdbook-agents` reveals `+` and creates a tab or right split without starting a drag.
- Dragging panes, tabs, and workspaces reorders or moves them cleanly in both dark and light (`"paper"`) themes, and `herdr-app status` reports `"errors": []` both with all six mods installed and when optional `herdbook-menu` / `herdbook-rename` are omitted.
