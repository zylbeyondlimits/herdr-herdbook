// Names one pane. The name is the terminal's `pane-name` label in herdr-core,
// so it stays with the terminal (restarts, moves to another space) and
// `hc label t3 pane-name=api` works too. Opened with props { target: { pane, terminal } },
// or with none (mod.open:herdbook-rename) for the focused pane. Enter saves, Esc cancels,
// an empty name goes back to the program's own.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import * as herdr from "herdr";

const LABEL = "pane-name";

function target() {
  const tg = herdr.props()?.target;
  if (tg?.terminal) return tg.terminal;
  const pane = herdr.panes().find((p) => p.pane === (tg?.pane ?? herdr.focused()?.pane));
  return pane?.terminal ?? null;
}

export default class PaneRename extends View {
  init(_props, cx) {
    this.terminal = target();
    this.saving = false;
    const term = herdr.terminals().find((t) => t.address === this.terminal);
    this.text = term?.labels?.[LABEL] ?? "";
    this.input = InputState.new({ value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  // Not close(): Herdr calls a View's close(cx) itself when the overlay goes.
  dismiss() { herdr.closeOverlay(herdr.props()?.overlay); }

  submit(cx) {
    if (this.saving || !this.terminal) return;
    this.saving = true;
    const name = this.text.replace(/\s+/g, " ").trim();
    cx.spawn(async () => {
      const r = await herdr.hc(["label", this.terminal, `${LABEL}=${name}`]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) herdr.notify({ title: "Couldn't rename the pane", body: r.stderr.trim(), level: "error" });
      this.dismiss();
    });
  }

  render(cx) {
    const t = herdr.theme();
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("herdbook-rename").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.dismiss(); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Rename pane"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(!this.terminal, el => el.child(div().pt(16).text_size(12.5).text_color(t.dim).child("Only terminal panes can be renamed.")))
      .when(Boolean(this.terminal), el => el
        .child(label("Name"))
        .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(div().pt(6).text_size(11.5).text_color(t.dim).child("Empty: the program's own name again.")))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("pr-cancel", "Cancel", false, () => this.dismiss()))
        .when(Boolean(this.terminal), el => el.child(button("pr-save", "Save", true, (_e, cx) => this.submit(cx)))));
  }
}
