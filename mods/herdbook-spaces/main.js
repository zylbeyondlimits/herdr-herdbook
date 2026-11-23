// Workspace spaces list (`herdbook-spaces`):
// - Colored workspace avatars, git branch / ahead-behind tails, remote machine grouping.
// - Unified drag-and-drop: reorder workspaces (without worktree auto-snap fighting manual order)
//   and accept dropped Panes or Tabs from any Herdbook panel (Native Route 1 + Pure-JS Route 2).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, appHome, readTextFile } from "herdr";
import * as herdrAll from "herdr";
import {
  activeDrag,
  startModDrag,
  cancelModDrag,
  clearJsDrag,
  reportDragTarget,
  trackDragMove,
  isJsTarget,
  finishJsDrag,
  recentlyDragged,
  autoScrollOnDrag,
} from "./drag.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
const SIDE_MIN = 48;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
const FALLBACK = 60000;
const AT_ONCE = 6;

async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {};
    this.checked = {};
    this.unsure = new Set();
    this.pending = new Set();
    this.busy = {};
    this.ready = {};
    this.at = {};
    this.watching = new Map();
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.menuMod = "menu";
    this.scroll = ScrollHandle.new();
    this.scrollState = { index: 0, lastAt: 0 };
    this.activeAt = -1;
    this.machines = [];
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    // Track worktrees placed once so manual workspace drag order isn't overwritten on later renders.
    try { this.placedWorktrees = new Set(JSON.parse(localStorage.getItem("worktrees.placed") ?? "[]")); } catch { this.placedWorktrees = new Set(); }
    if (typeof herdrAll.checking === "function" && herdrAll.checking()) return;
    clearJsDrag(herdrAll);
    cx.spawn(async (cx) => {
      if (await readTextFile(`${appHome()}/mods/herdbook-menu/mod.json`).catch(() => null)) this.menuMod = "herdbook-menu";
      cx.notify();
    });
    this.refreshMachines(cx);
    cx.timer.every(15000, (cx) => this.refreshMachines(cx));
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  due(now, sp, ps) {
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async (cx) => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const ask = async (args) => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  menu(w) {
    openOverlay({ mod: this.menuMod ?? "menu", kind: "popup", width: this.menuMod === "herdbook-menu" ? 228 : 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // Preserves exact `spaces()` order (so manual drag reordering sticks!) while indenting
  // worktree spaces when they sit beneath a main checkout of the same repo, and placing
  // brand-new unplaced worktrees under their main repo once on first discovery.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);

    const liveIds = new Set(sp.map((w) => w.id));
    let dirtyPlaced = false;
    for (const id of [...this.placedWorktrees]) {
      if (!liveIds.has(id)) {
        this.placedWorktrees.delete(id);
        dirtyPlaced = true;
      }
    }

    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Map();
    for (const r of list) {
      if (r.g && !r.g.linked && !mains.has(r.g.repo)) mains.set(r.g.repo, r.i);
    }

    // One-time placement for newly created worktree spaces.
    for (const r of list) {
      if (r.g?.linked && mains.has(r.g.repo) && !this.placedWorktrees.has(r.w.id)) {
        this.placedWorktrees.add(r.w.id);
        dirtyPlaced = true;
        const mainIdx = mains.get(r.g.repo);
        if (r.i !== mainIdx + 1) run("space.move", { id: r.w.id, index: mainIdx + 2 });
      }
    }
    if (dirtyPlaced) localStorage.setItem("worktrees.placed", JSON.stringify([...this.placedWorktrees]));

    return list
      .filter((r) => this.shown.has(r.w.id))
      .map((r, idx, arr) => {
        const isTree = Boolean(r.g?.linked && mains.has(r.g.repo));
        const nextIsSameTree = Boolean(arr[idx + 1]?.g?.linked && arr[idx + 1]?.g?.repo === r.g?.repo);
        return { ...r, tree: isTree ? (nextIsSameTree ? "├─" : "└─") : null };
      });
  }

  grouped(t, collapsed, dragNow, now) {
    const rows = this.ordered();
    const draw = (r, itemIdx) => (collapsed ? this.compact(r, t, dragNow, now, itemIdx) : this.row(r, t, dragNow, now, itemIdx));
    this.activeAt = -1;
    let before = 0;
    const remote = [...new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...this.machines.map((m) => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = (m) => {
      const l = machines().find((k) => k.name === m)?.layout;
      return l === "loading" || (!l && this.machines.some((k) => k.name === m && k.state === "connected"))
        || spaces().some((s) => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = (m) => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, (el) => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      this.activeAt = rows.findIndex((r) => r.w.active);
      return rows.map((r, idx) => draw(r, idx));
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find((k) => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const iconEl = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const addKey = `sp-new-m-${m ?? "local"}`;
      const addTargeted = isJsTarget(herdrAll, addKey, now);

      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, (el) => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, (el) => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, (el) => el.child(iconEl))
        .when(collapsed, (el) => el.child(div().relative().flex_none().child(iconEl).when(Boolean(m), (el) => el.child(badge))))
        .when(!collapsed, (el) => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, (el) => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, (el) => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover((s) => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, (el) => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4)
            .when(addTargeted, (s) => s.border_1().border_color(t.accent).bg(t.accent + "1f").text_color(t.accent))
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
            .on_mouse_move((e) => {
              if (dragNow && dragNow.kind !== "space" && (dragNow.machine ?? null) === (m ?? null)) {
                reportDragTarget(herdrAll, e, { type: "space", key: addKey, space: "new", name: "New space", machine: m ?? null }, now);
              }
            })
            .on_click((_e, cx) => { if (!recentlyDragged()) { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); } }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));

      const emptyKey = `sp-empty-${m ?? "local"}`;
      const emptyTargeted = isJsTarget(herdrAll, emptyKey, now);
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim)
        .when(emptyTargeted, (s) => s.border_1().border_color(t.accent).bg(t.accent + "1f"))
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_move((e) => {
          if (dragNow && dragNow.kind !== "space" && (dragNow.machine ?? null) === (m ?? null)) {
            reportDragTarget(herdrAll, e, { type: "space", key: emptyKey, space: "new", name: "New space", machine: m ?? null }, now);
          }
        })
        .on_click(() => { if (!recentlyDragged()) run("space.new", { machine: m ?? "" }); })
        .when(collapsed, (el) => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, (el) => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));

      if (!collapsed && rebuilt) { before += 1; return [head]; }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const baseOffset = before + 1 + guidance.length;
      const items = [cell(head), ...guidance, ...(folded ? [] : mine.length ? mine.map((r, idx) => draw(r, baseOffset + idx)) : [loading(m) ? loadingRow(m) : cell(empty)])];
      const first = folded ? -1 : mine.findIndex((r) => r.w.active);
      if (first >= 0) this.activeAt = baseOffset + first;
      before += items.length;
      return items;
    });
  }

  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === (name || "").toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const whereStr = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_auto()
      .min_w(whereStr ? SIDE_MIN : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(whereStr), (el) => el.child(div().min_w(0).truncate().child(whereStr)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree }, t, dragNow, now, itemIdx) {
    const on = w.active;
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const isDraggingThis = dragNow?.kind === "space" && dragNow?.space === w.id;
    const orderKey = `spo-top-${w.id}`;
    const dropKey = `sp-top-${w.id}`;
    const orderTargeted = isJsTarget(herdrAll, orderKey, now);
    const dropTargeted = isJsTarget(herdrAll, dropKey, now);
    const fromIdx = dragNow?.kind === "space" ? spaces().findIndex((s) => s.id === dragNow.space) : -1;

    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(isDraggingThis, (el) => el.opacity(0.5))
      .when(dropTargeted, (el) => el.border_2().border_color(t.accent).bg(t.accent + "1f"))
      .when(orderTargeted, (el) => el.child(
        div().absolute().left(4).right(4).h(2.5).rounded(2).bg(t.accent)
          .when(fromIdx >= 0 && fromIdx < i, (line) => line.bottom(0))
          .when(fromIdx > i, (line) => line.top(0)),
      ))
      .on_mouse_down("left", (e) => {
        startModDrag(herdrAll, { kind: "space", space: w.id, label: w.name, x: e.position.x, y: e.position.y }, now);
      })
      .on_mouse_move((e) => {
        this.scrollState.index = itemIdx;
        if (!dragNow) {
          trackDragMove(herdrAll, e, now);
          return;
        }
        if (dragNow.kind === "space") {
          reportDragTarget(herdrAll, e, { type: "space-order", key: orderKey, space: w.id, index: i + 1, name: w.name, machine: w.machine ?? null }, now);
        } else {
          reportDragTarget(herdrAll, e, { type: "space", key: dropKey, space: w.id, name: w.name, machine: w.machine ?? null }, now);
        }
      })
      .on_click(() => {
        if (!recentlyDragged()) run("space.select", { id: w.id });
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(w); })
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), (el) => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
          .when(!tree, (el) => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...(w.name || "?")][0]?.toUpperCase() ?? "?")))
          .child(div().flex_initial().min_w(SIDE_MIN).truncate().text_color(t.foreground).child(w.name || "Space"))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  compact({ w, i }, t, dragNow, now, itemIdx) {
    const dropKey = `sp-rail-${w.id}`;
    const orderKey = `spo-rail-${w.id}`;
    const dropTargeted = isJsTarget(herdrAll, dropKey, now);
    const orderTargeted = isJsTarget(herdrAll, orderKey, now);
    const isDraggingThis = dragNow?.kind === "space" && dragNow?.space === w.id;
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .tooltip(w.name || `Space ${i + 1}`)
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .when(isDraggingThis, (el) => el.opacity(0.5))
      .when(dropTargeted || orderTargeted, (el) => el.border_1().border_color(t.accent))
      .on_mouse_down("left", (e) => startModDrag(herdrAll, { kind: "space", space: w.id, label: w.name, x: e.position.x, y: e.position.y }, now))
      .on_mouse_move((e) => {
        this.scrollState.index = itemIdx;
        if (!dragNow) {
          trackDragMove(herdrAll, e, now);
          return;
        }
        if (dragNow.kind === "space") {
          reportDragTarget(herdrAll, e, { type: "space-order", key: orderKey, space: w.id, index: i + 1, name: w.name, machine: w.machine ?? null }, now);
        } else {
          reportDragTarget(herdrAll, e, { type: "space", key: dropKey, space: w.id, name: w.name, machine: w.machine ?? null }, now);
        }
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(w); })
      .on_click(() => { if (!recentlyDragged()) run("space.select", { id: w.id }); })
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render() {
    const t = theme();
    const now = Date.now();
    const dragNow = activeDrag(herdrAll, now);
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map((p) => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = (c) => Object.values(kept).filter((v) => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    const list = this.grouped(t, collapsed, dragNow, now);
    const active = sp.find((p) => p.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    const newKey = "sp-new-top";
    const newTargeted = isJsTarget(herdrAll, newKey, now);
    return v_flex()
      .id("spaces-root")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .on_mouse_down_out(() => clearJsDrag(herdrAll))
      .on_mouse_move((e) => trackDragMove(herdrAll, e, now))
      .on_mouse_up("left", (e, cx) => {
        if (finishJsDrag(herdrAll, cx, null, Date.now(), e?.position)) cx.notify();
      })
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, (el) => el.pl(0).pr(0).justify_center())
        .when(!collapsed, (el) => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6)
          .when(newTargeted, (s) => s.border_1().border_color(t.accent).bg(t.accent + "1f").text_color(t.accent))
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cancelModDrag(herdrAll, cx))
          .on_mouse_move((e) => {
            if (dragNow && dragNow.kind !== "space") {
              reportDragTarget(herdrAll, e, { type: "space", key: newKey, space: "new", name: "New space", machine: dragNow.machine ?? null }, now);
            }
          })
          .on_click(() => { if (!recentlyDragged()) run("space.new"); })
          .child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(
        v_flex()
          .id("space-list")
          .flex_1()
          .min_h(0)
          .px(collapsed ? 0 : 8)
          .pb(14)
          .overflow_y_scrollbar()
          .mode("always")
          .track_scroll(this.scroll)
          .on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
          .on_mouse_move((e) => autoScrollOnDrag(herdrAll, this.scroll, this.scrollState, e, list.length, false, Date.now()))
          .children(list),
      );
  }
}
