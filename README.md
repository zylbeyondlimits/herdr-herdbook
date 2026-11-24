# Herdbook

Visual **Workspace → Tab → Pane** management, persistent pane naming, and full cross-panel drag-and-drop for GUI users of [Herdr](https://herdr.dev).

![Herdbook](preview.png)

- **Three clear layers (`Workspace → Tab → Pane`).**
  - **Pane:** every terminal (`zsh`, `nvim`, scripts), coding agent CLI (`Claude Code`, `Codex`, etc.), or mod pane. Double-click a pane header or sidebar row, right-click → **Rename pane**, or press `Alt-F2` to give it a persistent `pane-name` label that survives restarts and cross-space moves—with automatic forward compatibility for Herdr 0.1.17's native `pane.rename` (`panes()[i].name` / `agents()[i].pane_name`, including non-terminal mod panes).
  - **Tab:** one or more panes sharing the screen together. Shown as a pill in the top bar (listing every pane's icon and name) and as a space-tinted rounded card in the sidebar **Agents** tree (foldable, double-click to rename, hover `+` to split a new pane right, right-click for tab actions).
  - **Workspace:** a collection of tabs in **Spaces** and in the **Agents** tree, in the order you drag them to (a pane, tab group or workspace whose status changes jumps to the top of its group, workspace and the list; the **Spaces** list and tab bar keep their fixed order), with a hover `+` button on workspace headers to open a new tab (or Launch Menu when active).
- **Groups are real groups.** A tab frame with a header (fold chevron, name, `+`) appears only while a tab holds 2+ panes; when a group shrinks to one pane the stale group name is cleared and it becomes a plain card you can drag out freely.
- **Full tree + Priority view in `Agents`.** Switch between **Grouped by workspace** (every workspace, tab frame, and pane—including plain shells and mod panes—plus sub-agent trees) and **Priority** (status-reporting agents ordered by `Needs you → Done → Working → Idle`).
- **Drag and drop everywhere (mouse & trackpad).** Works out of the box on **official Herdr 0.1.16+** (pure-JS cross-panel drag fallback) and automatically upgrades to floating drag cards + 4-edge main-screen split previews on Herdr builds with native drag APIs:
  - Drag any **Pane** (from a pane header, any top-bar tab's pane icon/name—including the active tab—or any sidebar row) onto another **Pane** (on official Herdr, its `30px` header bar; on native-drag builds, any pane edge/center), onto a **Tab** pill or sidebar **Tab** header to join it, into the **gap** between tabs (or top-bar `+`) to split it into its own tab, or onto any **Workspace** (or `+`) to move it across workspaces on the same machine.
  - Drag any **Tab** (top-bar pill or sidebar tab header) to reorder tabs, place between tabs in another workspace, or move the whole tab to another/new workspace.
  - Drag any **Workspace** row or header to reorder workspaces within its machine.
  - **Trackpad-friendly:** constant-height gap hit zones (`0px` layout shift), viewport-anchored trackpad scroll stability (pressing or dragging a tab/pane halfway down a long list never jumps to the top), stale-drag auto-cleanup, and deliberate edge auto-scrolling.

Works on official Herdr 0.1.16+ (macOS, Linux, Windows). No network.

## Install

Tell your Herdr agent:

> Add the Herdbook layout from github.com/zylbeyondlimits/herdr-herdbook

It copies `layouts/herdbook.json` and the six `mods/herdbook-*` folders into `~/.config/herdr-app`, merges `keys.json` (`Alt-F2` → `mod.open:herdbook-rename`), checks each mod, and switches to `herdbook`.

- **Non-destructive layout switch:** your own layout (`main` or any custom layout) is untouched—press **`Ctrl+Shift+L`** anytime to cycle between Herdbook and your other layouts.
- **Standalone / modular use:** every mod degrades gracefully on its own. You can drop `herdbook-agents`, `herdbook-tabs`, `herdbook-spaces`, or `herdbook-pane` individually into your own layout JSON, set `"terminal_menu": "herdbook-menu"` on the layout root, and add `herdbook-rename` for the rename dialog.

## Co-existence in `tabs-row` (Frost, Usage Meter & Launch Menu)

- **Launch Menu:** when [Launch Menu](https://github.com/zylbeyondlimits/herdr-launch-menu) (`mods/launch-menu`) is installed, `herdbook-tabs`'s `+` button and the active workspace header's hover `+` automatically open `launch-menu` instead of `new-menu`.
- **Frost & Usage Meter:** replace the `"tabs"` block in `layouts/herdbook.json` with a `"tabs-row"` row to mount inline toolbar buttons beside `herdbook-tabs`. `herdbook-tabs` automatically tightens its right padding to `3px` whenever any visible sibling block sits after it in the row:

```json
{
  "id": "tabs-row",
  "type": "row",
  "size": { "px": 42 },
  "resizable": false,
  "window_drag": true,
  "children": [
    { "id": "tabs", "type": "block", "size": { "weight": 1 }, "window_drag": true, "content": { "mod": "herdbook-tabs" } },
    { "id": "frost", "type": "block", "size": { "px": 77 }, "window_drag": true, "content": { "mod": "frost", "props": { "block": "frost" } } },
    { "id": "usage", "type": "block", "size": { "px": 78 }, "window_drag": true, "content": { "mod": "usage-meter", "props": { "block": "usage" } } }
  ]
}
```

## What it touches

- Writes one terminal label, `pane-name`, via `hc label <terminal> pane-name=<name>` (clear with `hc label t3 pane-name=`), plus `pane.rename` when Herdr 0.1.17+ exposes it.
- Uses `shared("herdbook.drag")` transiently during active pointer drags on official Herdr builds without native `startDrag`.
- Runs `git rev-parse` in a space's folder for git status and worktree menu items, matching Herdr's shipped `spaces` and `menu` mods.
- Reads only `mod.json` under `appHome()/mods/` via `readTextFile` to detect optional sibling mods (`herdbook-menu`, `herdbook-rename`, `launch-menu`).

## Tests & Maintenance

```sh
./tests/run.sh
```

Runs the **39-test** Node suite (`tests/drag.test.mjs`, `tests/scroll.test.mjs`, `tests/groups.test.mjs`, `tests/move.test.mjs`, `tests/names.test.mjs`, `tests/rename.test.mjs`) and asserts byte-for-byte parity across all four self-contained `mods/*/drag.js` copies (`herdbook-agents`, `herdbook-tabs`, `herdbook-pane`, `herdbook-spaces`). When editing `mods/herdbook-agents/drag.js`, run `./scripts/sync-drag.sh` first.

## 中文说明

面向喜欢**图形化界面（GUI）与鼠标/触控板直觉操作**的 Herdr 用户，将窗口整理为清晰的 **`Workspace → Tab → Pane`** 三层结构，并支持跨侧边栏、顶栏、主屏自由拖拽移动：

- **Pane（面板）**：每个终端（`zsh`、`nvim`）、运行中的 Agent CLI 或 Mod 面板。双击标题栏/侧栏行、右键 **Rename pane** 或按 `Alt-F2` 即可写入持久化 `pane-name` 标签（跨工作区迁移与重启均保留），并前向兼容 Herdr 0.1.17 原生 `pane.rename`。
- **Tab（标签页）**：同屏分屏显示的 1~N 个 Pane 的聚合。顶栏胶囊显示每个分屏图标与名称；左侧 **Agents** 面板的「Grouped by workspace」视图将其展示为带工作区主题色的圆角卡片框（支持普通终端显示、折叠、双击改名、悬停 `+` 快速向右分屏、固定顺序不乱跳；右上角可随时切回 **Priority** 视图）。
- **全区域鼠标/触控板拖拽（双引擎兼容）**：官方版 Herdr 0.1.16+ 开箱即用，支持在 Spaces、Agents、顶栏与 Pane 标题栏之间互拖合并、拆成独立 Tab、排序或同机跨 Workspace 迁移；针对触控板做了外层 `*-viewport` 视口锚定防跳顶设计（长列表滚到底部按住/拖拽 Tab 或 Pane 保持 `0px` 稳定不回弹）；随时可按 `Ctrl+Shift+L` 无损切回原布局，也能在 `tabs-row` 中与 Frost、Usage Meter、Launch Menu 无缝共存。

安装时对你的 Herdr agent 说：「Add the Herdbook layout from github.com/zylbeyondlimits/herdr-herdbook」。

## Related Mods

| Mod / Layout | Description |
|---|---|
| [herdr-herdbook](https://github.com/zylbeyondlimits/herdr-herdbook) | Visual `Workspace → Tab → Pane` tree, persistent pane naming, and full cross-panel drag-and-drop layout |
| [herdr-usage-meter](https://github.com/zylbeyondlimits/herdr-usage-meter) | Live AI coding subscription & quota meter beside the tab bar (`Claude`, `Codex`, `Antigravity`, `Copilot`, etc.) |
| [herdr-frost](https://github.com/zylbeyondlimits/herdr-frost) | Adjustable frosted-glass window blur and single-layer region translucency with lossless layout restore |
| [herdr-launch-menu](https://github.com/zylbeyondlimits/herdr-launch-menu) | Customizable `+` agent launcher with custom order, extra CLI flags, and per-agent permission bypass toggles |

## License

MIT for `herdbook-rename`, `drag.js`, `layouts/herdbook.json`, `scripts/`, and `tests/`. `herdbook-pane`, `herdbook-tabs`, `herdbook-agents`, `herdbook-spaces`, and `herdbook-menu` are modified copies of Herdr's `pane`, `tabs`, `agents`, `spaces`, and `menu` mods and stay under Apache 2.0 (see each folder's `LICENSE` and `NOTICE`).
