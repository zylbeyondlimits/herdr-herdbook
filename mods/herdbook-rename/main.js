// Names one pane (`herdbook-rename`).
// Stores the name on the terminal's `pane-name` label in herdr-core (`hc label t3 pane-name=api`),
// so it stays across restarts and `park`/`keep` cross-space moves, AND when Herdr 0.1.17+'s
// `pane.rename` command is present, also writes `pane.rename { pane, name }` (allowing non-terminal
// mod panes to be renamed too). Opened with props `{ target: { pane, terminal } }` or none (`Alt-F2`).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import * as herdr from "herdr";
import { resolveRenameTarget, savePaneName } from "./rename.js";

export default class PaneRename extends View {
  init(_props, cx) {
    this.target = resolveRenameTarget(herdr);
    this.saving = false;
    this.text = this.target.currentName;
    this.input = InputState.new({ value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    if (typeof herdr.checking !== "function" || !herdr.checking()) {
      cx.timer.after(600, () => this.input.focus());
    }
    this.handle = cx.focus_handle();
  }

  // Not close(): Herdr calls a View's close(cx) itself when the overlay goes.
  dismiss() { herdr.closeOverlay(herdr.props()?.overlay); }

  submit(cx) {
    if (this.saving || !this.target?.canRename) return;
    this.saving = true;
    cx.spawn(async () => {
      const r = await savePaneName(herdr, this.target, this.text);
      if (!r.ok) herdr.notify({ title: "Couldn't rename the pane", body: r.error, level: "error" });
      this.dismiss();
    });
  }

  render() {
    const t = herdr.theme();
    const can = Boolean(this.target?.canRename);
    const hint = this.target?.isModPane
      ? "Empty: the pane's default title again."
      : "Empty: the program's own name again.";
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("herdbook-rename").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.dismiss(); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Rename pane"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(!can, (el) => el.child(div().pt(16).text_size(12.5).text_color(t.dim).child("Only terminal panes can be renamed on this Herdr version.")))
      .when(can, (el) => el
        .child(label("Name"))
        .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(div().pt(6).text_size(11.5).text_color(t.dim).child(hint)))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("pr-cancel", "Cancel", false, () => this.dismiss()))
        .when(can, (el) => el.child(button("pr-save", "Save", true, (_e, cx) => this.submit(cx)))));
  }
}
