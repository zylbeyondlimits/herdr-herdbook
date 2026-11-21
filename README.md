# Herdbook

Name your panes and keep your tabs as groups in [Herdr](https://herdr.dev).

![Herdbook](preview.png)

- **Pane names.** Double-click a pane header, right-click → Rename pane, or
  press Alt-F2. The name shows in the pane header, the tab bar and the
  Agents list, and stays with the terminal through restarts and moves.
- **Tab chips that list their panes.** A tab with several panes shows each
  pane's icon and name; a tab you named shows its name and every icon.
- **Groups in the Agents list.** In "Grouped by space", each tab's agents sit
  in one frame tinted with the space's color. Fold a frame, double-click it
  to name it, or right-click for the tab menu. The space and the agent that
  changed last come first.
- **Move to another space.** Right-click a pane, an agent or a tab → Move to
  space…, or use the header's move button. The terminals keep running. On a
  Herdr build with cross-space drag (not official Herdr yet), drag a pane
  header, an agent row or a tab onto a space in the sidebar, or onto "+" for a
  new one.

Works on official Herdr 0.1.16 (tested on macOS). No network.

## Install

Tell your Herdr agent:

> Add the Herdbook layout from github.com/zylbeyondlimits/herdr-herdbook

It copies `layouts/herdbook.json` and the six `mods/herdbook-*` folders,
merges `keys.json` (Alt-F2), and switches to the layout. Your own layout stays
as it was: `ctrl-shift-l` switches back.

With [Launch Menu](https://github.com/zylbeyondlimits/herdr-launch-menu)
installed, the tab bar's + opens it instead of Herdr's menu.

Only want part of it? Each mod works alone. Put `herdbook-agents`,
`herdbook-tabs` or `herdbook-pane` in your own layout's agents block, tab
block or pane header, and set `"terminal_menu": "herdbook-menu"` for the
right-click menu. Copy `herdbook-rename` (and `herdbook-menu` for moving) to
get the rename and move entries; without them those entries don't show.

## What it touches

- Writes one terminal label, `pane-name`, with `hc label`. Clear one with
  `hc label t3 pane-name=`.
- Runs `git rev-parse` in a space's folder for the worktree menu items, as
  Herdr's own menu does.
- Reads only its own mods' `mod.json` to see which are installed.

Moving on official Herdr parks the terminals and keeps them in the other
space. A moved tab's panes land side by side: its split layout isn't kept.

## Tests

```sh
tests/run.sh
```

## 中文说明

Herdbook 让你给 Herdr 里的每个 pane 起名字，并把 tab 当成分组来整理。

- 起名：双击 pane 标题栏、右键 Rename pane，或者按 Alt-F2。名字会同时显示在 pane 标题栏、顶栏 tab 和 Agents 列表里，重启或移动后也不会丢。
- 顶栏：有多个 pane 的 tab 会列出每个 pane 的图标和名字；你命名过的 tab 显示 tab 名和所有图标。
- Agents 列表的「Grouped by space」视图里，每个 tab 的 agent 放在一个带 space 颜色的圆角框里，可以折叠、双击改名、右键打开菜单。最近有状态变化的 space 和 agent 排在最前。
- 右键 pane、agent 或 tab，选 Move to space… 可以移到别的 space，终端不会中断。

安装时对你的 Herdr agent 说：「Add the Herdbook layout from github.com/zylbeyondlimits/herdr-herdbook」。

## License

MIT for `herdbook-rename`, the layout and the tests. `herdbook-pane`,
`herdbook-tabs`, `herdbook-agents`, `herdbook-spaces` and `herdbook-menu` are
modified copies of Herdr's `pane`, `tabs`, `agents`, `spaces` and `menu` mods and stay under Apache 2.0 (see
each folder's `LICENSE` and `NOTICE`).
