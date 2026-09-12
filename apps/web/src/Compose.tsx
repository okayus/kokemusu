// 積む — the composer as a dialog (features.md §1, 2026-09-05). It left the top
// of the page so the page could be for looking back; it opens from the round
// 積む fixed to the bottom-right corner, from the `n` key, or from a 苔片's
// 同じ石に積む (CONTEXT.md), which seeds the tag field with that 苔片's stones
// and nothing else.
//
// Everything typed — the body, the 向き, the days, the stones — is
// 退避 to the draft on each keystroke (draft.ts), so closing the dialog — Esc,
// the backdrop, a back gesture, 閉じる — saves rather than discards and the next
// open resumes. Success closes it and spends the draft whole: no implicit
// carry-over of tags to the next 苔片 (a forgotten stone would grow moss on the
// wrong rock, and it counts in every visualization), and no carry-over of a
// past day either.
import { useEffect, useId, useRef, useState, type CSSProperties, type Ref } from "react";
import { describeApiError, isApiError } from "./api";
import {
  daysLabel,
  earliestStackDay,
  isRange,
  stackingInput,
  THICKNESS_TICKS,
  thicknessLabel,
  thicknessNote,
  type DaysFields,
} from "./days";
import { EMPTY_DRAFT, loadDraft, saveDraft, type Draft } from "./draft";
import { submitOnCmdEnter } from "./form";
import { KIND_CHOICES, type PostKind } from "./kind";
import { Markdown } from "./markdown";
import { createPost, type PostItem, type TagSummary } from "./posts-api";
import { TagField } from "./TagField";
import { stonesOf } from "./tags";

/**
 * What opens the dialog: `seedTags` is the stones (by name) for 同じ石に積む;
 * null means resume the draft as it was left (積む / `n`).
 */
export type ComposeRequest = { seedTags: string[] | null };

/** A 苔片's stones by name — what 同じ石に積む seeds and the edit form starts from. */
export const stoneNames = (tags: TagSummary[]): string[] => tags.map((t) => t.name);

/**
 * The `n` shortcut (features.md §1) opens the dialog only when the key would
 * otherwise do nothing: a plain `n` (no modifier, not mid-IME), focus outside
 * any field that takes typed text, and no dialog already up — a modal owns the
 * keyboard. Pure, so the table of cases is unit-tested; the DOM reading is in
 * `useComposeShortcut`.
 */
export function isComposeShortcut(key: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  inEditable: boolean;
  dialogOpen: boolean;
}): boolean {
  return (
    key.key === "n" &&
    !key.metaKey &&
    !key.ctrlKey &&
    !key.altKey &&
    !key.isComposing &&
    !key.inEditable &&
    !key.dialogOpen
  );
}

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable]") !== null);

/** Document-level `n` → `open()`. `open` should be stable (useCallback) so the listener is attached once. */
export function useComposeShortcut(open: () => void): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (
        !isComposeShortcut({
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          isComposing: e.isComposing,
          inEditable: isEditableTarget(e.target),
          dialogOpen: document.querySelector("dialog[open]") !== null,
        })
      ) {
        return;
      }
      e.preventDefault();
      open();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
}

/**
 * 本文の入力欄 — textarea ＋ Markdown の案内 ＋ プレビュー。コンポーザと編集フォームで
 * 共有する（プレビューは苔片の表示と同じ描画器を通るので、見えるものが積まれるもの）。
 */
export function BodyField(props: {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (next: string) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  // プレビューは開いている間だけ描く。閉じたまま毎打鍵で字句解析しないためであり、
  // 隠れた本文の写しを DOM に残さないためでもある（削除確認ダイアログと同じ理由）。
  const [open, setOpen] = useState(false);
  const hintId = `${props.id}-hint`;
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <textarea
        id={props.id}
        name="body"
        ref={props.textareaRef}
        required
        maxLength={20000}
        rows={3}
        value={props.value}
        placeholder={props.placeholder}
        aria-describedby={hintId}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={submitOnCmdEnter}
      />
      <p className="hint" id={hintId}>
        Markdown で書けます（見出し・箇条書き・コード・リンク）。
      </p>
      <details className="md-preview" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>プレビュー</summary>
        {open &&
          (props.value.trim() === "" ? (
            <p className="quiet">まだ何も書かれていません。</p>
          ) : (
            <Markdown source={props.value} className="md" />
          ))}
      </details>
    </div>
  );
}

/**
 * 向き の欄 — native radios, three words and 未分類 (features.md §1: pressing
 * nothing is 未分類, and the fourth radio is the way back to it). Shared by the
 * composer (controlled: every change is 退避 to the draft) and the edit form
 * (uncontrolled: `FormData` reads `kind`, やめる discards) — pass `onChange`
 * for the former, `defaultValue` for the latter. Native radios on purpose
 * (modern-web-guidance/forms: 1–5 exclusive choices = visible radios; the
 * moss `accent-color` dresses them) — no re-invented chip widget.
 */
export function KindField(props: {
  value?: PostKind | null;
  defaultValue?: PostKind | null;
  onChange?: (next: PostKind | null) => void;
}) {
  const { onChange } = props;
  return (
    <fieldset className="kind-field">
      <legend>向き（任意）</legend>
      <div className="kind-choices">
        {KIND_CHOICES.map((choice) => (
          <label key={choice.value ?? ""}>
            <input
              type="radio"
              name="kind"
              value={choice.value ?? ""}
              {...(onChange
                ? {
                    checked: (props.value ?? null) === choice.value,
                    onChange: () => onChange(choice.value),
                  }
                : { defaultChecked: (props.defaultValue ?? null) === choice.value })}
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export type { DaysFields } from "./days";

type DaysFieldProps = DaysFields & {
  /** Prefix for the two ids (the composer's and each edit form's must differ). */
  idPrefix: string;
  /** The server's today (the feed's) — the ceiling of both fields; null while unknown. */
  today: string | null;
  /** What the fields mean here: 積む and 直す read a blank pair differently. */
  hint: string;
  /**
   * 見える見出し。フォームに直に置くときは 向き / タグ と並ぶ見出しとして渡す。
   * 省略すると visually-hidden の「積む日」— 畳める `<details>` の中では summary が
   * 名を持つので、見出しは読み上げにだけ要る。
   */
  legend?: string;
  onChange: (next: DaysFields) => void;
};

/**
 * 日を選ぶ — the days to stack on, as two native date fields (features.md §1):
 * いつ and 〜いつまで. One filled = that single day, both = a 続く苔片. They bound
 * each other (`min` / `max`) and `today` caps both, so an inverted pair or a
 * day that has not come is the browser's own rangeUnderflow / rangeOverflow —
 * the form never submits it and no request is made (modern-web-guidance/forms:
 * native constraints first; the server's check is the security half). `min`
 * is the Worker's floor spelled client-side (days.ts). Controlled by whoever
 * renders it — the fields must hold values to bound each other.
 *
 * The third part, 厚み (ADR-0007), is there only while the two make a range —
 * a single day has no 厚み, so a single day shows no slider. A native range
 * (1..100, the moss `accent-color` dresses it — modern-web-guidance/
 * brand-consistent-forms; no re-invented slider) with its 目盛り as a
 * `<datalist>` (tick marks, and the thumb snaps to them where the browser
 * does), the 換算 「60% · 731 日のうち 439 日分」 in an `<output for>` that follows
 * the fields, and the 目盛り's names under the track — each a small button
 * that sets the value, since dragging to exactly 60 on a phone is hard and a
 * word is not. `thickness` is always held (the draft keeps it); only a range
 * shows and sends it (days.ts stackingInput).
 */
export function DaysField(props: DaysFieldProps) {
  const floor = props.today === null ? undefined : earliestStackDay(props.today);
  const firstId = `${props.idPrefix}-first-day`;
  const lastId = `${props.idPrefix}-last-day`;
  const hintId = `${props.idPrefix}-days-hint`;
  const thicknessId = `${props.idPrefix}-thickness`;
  const ticksId = `${props.idPrefix}-thickness-ticks`;
  const noteId = `${props.idPrefix}-thickness-note`;
  const fields: DaysFields = {
    firstDay: props.firstDay,
    lastDay: props.lastDay,
    thickness: props.thickness,
  };
  return (
    <fieldset className="days-field">
      {props.legend === undefined ? (
        <legend className="visually-hidden">積む日</legend>
      ) : (
        <legend>{props.legend}</legend>
      )}
      <div className="days-field-part">
        <label htmlFor={firstId}>いつ</label>
        <input
          type="date"
          id={firstId}
          name="firstDay"
          value={props.firstDay}
          min={floor}
          max={props.lastDay || props.today || undefined}
          aria-describedby={hintId}
          onChange={(e) => props.onChange({ ...fields, firstDay: e.target.value })}
          onKeyDown={submitOnCmdEnter}
        />
      </div>
      <div className="days-field-part">
        <label htmlFor={lastId}>〜いつまで</label>
        <input
          type="date"
          id={lastId}
          name="lastDay"
          value={props.lastDay}
          min={props.firstDay || floor}
          max={props.today ?? undefined}
          aria-describedby={hintId}
          onChange={(e) => props.onChange({ ...fields, lastDay: e.target.value })}
          onKeyDown={submitOnCmdEnter}
        />
      </div>
      {isRange(props.firstDay, props.lastDay) && (
        <div className="days-field-part thickness-field">
          <div className="thickness-head">
            <label htmlFor={thicknessId}>厚み</label>
            <output id={noteId} htmlFor={thicknessId}>
              {thicknessNote(props.thickness, props.firstDay, props.lastDay)}
            </output>
          </div>
          <input
            type="range"
            id={thicknessId}
            name="thickness"
            min={1}
            max={100}
            step={1}
            list={ticksId}
            value={props.thickness}
            aria-describedby={noteId}
            onChange={(e) => props.onChange({ ...fields, thickness: e.target.valueAsNumber })}
            onKeyDown={submitOnCmdEnter}
          />
          <datalist id={ticksId}>
            {THICKNESS_TICKS.map((tick) => (
              <option key={tick.value} value={tick.value} label={tick.label} />
            ))}
          </datalist>
          <div className="thickness-ticks">
            {THICKNESS_TICKS.map((tick) => (
              <button
                key={tick.value}
                type="button"
                className="thickness-tick"
                // Where the tick sits along the track, 0..1 (styles.css places it under the thumb's centre).
                style={{ "--at": (tick.value - 1) / 99 } as CSSProperties}
                aria-label={`${tick.label} ${tick.value}%`}
                title={`${tick.value}%`}
                onClick={() => props.onChange({ ...fields, thickness: tick.value })}
              >
                {tick.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="hint" id={hintId}>
        {props.hint}
      </p>
    </fieldset>
  );
}

/**
 * `DaysField` folded into a `<details>` 「日を選ぶ」. The edit form's face: a 苔片
 * already has its days, and 直す is usually about the words — folded, the
 * summary names the days (and a range's 厚み) so none of them ride along
 * unseen, and opening it is how a 続く苔片 is lengthened or its 厚み moved. The
 * composer shows the fields unfolded instead (2026-09-06): there, the day is
 * part of writing the 苔片, not a correction.
 */
export function DaysDisclosure(props: DaysFieldProps & { defaultOpen?: boolean }) {
  const { defaultOpen, ...field } = props;
  const [open, setOpen] = useState(defaultOpen ?? false);
  const chosen = props.firstDay !== "" || props.lastDay !== "";
  return (
    <details className="compose-days" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{open || !chosen ? "日を選ぶ" : `日: ${foldedDays(props)}`}</summary>
      <DaysField {...field} />
    </details>
  );
}

/** 「2026/09/01 〜 2026/09/05 · 厚み 60%」 — the fields as the folded summary names them; a single day has no 厚み. */
const foldedDays = (fields: DaysFields): string => {
  const days = daysLabel(fields.firstDay || fields.lastDay, fields.lastDay || fields.firstDay);
  return isRange(fields.firstDay, fields.lastDay)
    ? `${days} · ${thicknessLabel(fields.thickness)}`
    : days;
};

/** What the composer's date fields mean: blank = today; the edit form says its own (App.tsx). */
export const COMPOSE_DAYS_HINT =
  "空のままなら今日に。1 日だけならその日に、範囲にすると続く苔片として積まれ、厚み（そのうち打ち込んでいた日の割合）を添えます。今日より先には積めません。";

/**
 * The 積む dialog. Mounted only while open (Garden), so opening is mounting:
 * `showModal()` runs on mount — the `open` attribute would show it non-modal,
 * without backdrop or focus trap — and the caret goes to the body. `closedby=
 * "any"` adds the backdrop tap and the mobile back gesture to Esc where
 * supported (progressive enhancement; Esc and 閉じる are always there).
 *
 * The decision travels in `returnValue`, as the delete confirm's does: only a
 * successful submit closes with "posted", and `onCreated` fires from the close
 * handler — after the browser has given focus back to whatever opened the
 * dialog — so the garden can travel to the new 苔片 without being undone.
 */
export function ComposeDialog(props: {
  seedTags: string[] | null;
  /** The garden's registered stones — the tag field's suggestions. */
  tagOptions: TagSummary[];
  /** The feed's server-decided today — the date fields' ceiling. */
  today: string | null;
  onCreated: (created: PostItem) => void;
  onClose: () => void;
  onSessionLost: () => void;
}) {
  // The whole entry is one Draft: resumed from storage, and 同じ石に積む replaces
  // the stones only — the body, 向き and days are whatever was left there.
  const [fields, setFields] = useState<Draft>(() => {
    const draft = loadDraft() ?? EMPTY_DRAFT;
    return props.seedTags === null ? draft : { ...draft, tags: props.seedTags, tagText: "" };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const createdRef = useRef<PostItem | null>(null);
  const headingId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
    // The body is first in the form, so showModal would land here anyway — say
    // it out loud rather than lean on the field order.
    bodyRef.current?.focus();
  }, []);

  // 同じ石に積む replaced the tag field: the draft must say so too, or a close
  // before any keystroke would resume the previous stones. Mount only.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || props.seedTags === null) return;
    seeded.current = true;
    saveDraft(fields);
  }, [props.seedTags, fields]);

  const update = (patch: Partial<Draft>) => {
    const next = { ...fields, ...patch };
    setFields(next);
    saveDraft(next);
  };

  const submit = async () => {
    if (busy) return;
    if (fields.body.trim().length === 0) {
      setError("本文が空です。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createPost({
        body: fields.body,
        // The text still in the tag field is a stone too — nothing typed is lost.
        tags: stonesOf({ tags: fields.tags, text: fields.tagText }),
        kind: fields.kind,
        ...stackingInput(fields),
      });
      // Spent: nothing carries over (features.md §1).
      update(EMPTY_DRAFT);
      createdRef.current = created;
      dialogRef.current?.close("posted");
    } catch (e) {
      // The entry stays in the fields (and in the saved draft) on failure.
      if (isApiError(e) && e.status === 401) props.onSessionLost();
      else setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="compose"
      closedby="any"
      aria-labelledby={headingId}
      onClose={() => {
        const created = dialogRef.current?.returnValue === "posted" ? createdRef.current : null;
        props.onClose();
        if (created !== null) props.onCreated(created);
      }}
    >
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id={headingId}>積む</h2>
        <BodyField
          id="post-body"
          label="いまの苔片"
          placeholder="なにを積む？"
          value={fields.body}
          textareaRef={bodyRef}
          onChange={(next) => update({ body: next })}
        />
        <KindField value={fields.kind} onChange={(next) => update({ kind: next })} />
        <TagField
          id="post-tags"
          options={props.tagOptions}
          value={{ tags: fields.tags, text: fields.tagText }}
          onChange={(next) => update({ tags: next.tags, tagText: next.text })}
        />
        {/* 積む日 (features.md §1): last, under the stones, and always in view —
            blank is today, so the everyday 苔片 walks past it. `today` is the
            feed's; while it is still unknown the fields carry no ceiling and the
            server's check (400) is the only one — a moment at most. */}
        <DaysField
          idPrefix="post"
          firstDay={fields.firstDay}
          lastDay={fields.lastDay}
          thickness={fields.thickness}
          today={props.today}
          hint={COMPOSE_DAYS_HINT}
          legend="積む日（任意）"
          onChange={(next) => update(next)}
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="composer-actions">
          <button type="submit" className="primary" disabled={busy}>
            積む
          </button>
          {/* 閉じる, not やめる: the draft stays (closing is saving). */}
          <button type="button" disabled={busy} onClick={() => dialogRef.current?.close()}>
            閉じる
          </button>
          <span className="hint">⌘/Ctrl + Enter でも積めます</span>
        </div>
      </form>
    </dialog>
  );
}
