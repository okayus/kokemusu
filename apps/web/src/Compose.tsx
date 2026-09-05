// 積む — the composer as a dialog (features.md §1, 2026-09-05). It left the top
// of the page so the page could be for looking back; it opens from the bar's
// 積む, from the `n` key, or from a 苔片's 同じ石に積む (CONTEXT.md), which seeds
// the tag field with that 苔片's stones and nothing else.
//
// Everything typed is 退避 to the draft on each keystroke (draft.ts), so closing
// the dialog — Esc, the backdrop, a back gesture, 閉じる — saves rather than
// discards and the next open resumes. Success closes it and spends the draft
// whole: no implicit carry-over of tags to the next 苔片 (a forgotten stone
// would grow moss on the wrong rock, and it counts in every visualization).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { describeApiError, isApiError } from "./api";
import { loadDraft, saveDraft, type Draft } from "./draft";
import { Markdown } from "./markdown";
import { createPost, splitTagField, type PostItem, type TagSummary } from "./posts-api";

/**
 * What opens the dialog: `seedTags` is the tag field's text for 同じ石に積む;
 * null means resume the draft as it was left (積む / `n`).
 */
export type ComposeRequest = { seedTags: string | null };

/** A 苔片's stones as the tag field's text — the edit form's spelling too. */
export const tagsField = (tags: TagSummary[]): string => tags.map((t) => t.name).join(", ");

/** ⌘/Ctrl+Enter submits the surrounding form (composer と編集フォームで共用). */
export const submitOnCmdEnter = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
};

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
  seedTags: string | null;
  onCreated: (created: PostItem) => void;
  onClose: () => void;
  onSessionLost: () => void;
}) {
  const [draft] = useState(loadDraft);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [tagField, setTagField] = useState(props.seedTags ?? draft?.tags ?? "");
  // The 見出し toggle (roadmap 決めること 7): one field, folded away by default,
  // unfolded when a draft already carries a heading.
  const [titleOpen, setTitleOpen] = useState(title !== "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const createdRef = useRef<PostItem | null>(null);
  const headingId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
    // showModal's own pick would be the first focusable — the 見出し summary.
    bodyRef.current?.focus();
  }, []);

  // 同じ石に積む replaced the tag field: the draft must say so too, or a close
  // before any keystroke would resume the previous stones. Mount only.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || props.seedTags === null) return;
    seeded.current = true;
    saveDraft({ title, body, tags: props.seedTags });
  }, [props.seedTags, title, body]);

  const update = (next: Draft) => {
    setTitle(next.title);
    setBody(next.body);
    setTagField(next.tags);
    saveDraft(next);
  };

  const submit = async () => {
    if (busy) return;
    if (body.trim().length === 0) {
      setError("本文が空です。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const heading = title.trim();
      const created = await createPost({
        body,
        tags: splitTagField(tagField),
        ...(heading ? { title: heading } : {}),
      });
      // Spent: nothing carries over (features.md §1).
      update({ title: "", body: "", tags: "" });
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
        <details
          className="compose-title"
          open={titleOpen}
          onToggle={(e) => setTitleOpen(e.currentTarget.open)}
        >
          {/* Folded with a heading inside, the summary shows it — a hidden
              heading must not ride along unseen. */}
          <summary>{titleOpen || title === "" ? "見出しを付ける" : `見出し: ${title}`}</summary>
          <div className="field">
            <label htmlFor="post-title">見出し（任意）</label>
            <input
              id="post-title"
              name="title"
              maxLength={200}
              autoComplete="off"
              value={title}
              onChange={(e) => update({ title: e.target.value, body, tags: tagField })}
              onKeyDown={submitOnCmdEnter}
            />
          </div>
        </details>
        <BodyField
          id="post-body"
          label="いまの苔片"
          placeholder="なにを積む？"
          value={body}
          textareaRef={bodyRef}
          onChange={(next) => update({ title, body: next, tags: tagField })}
        />
        <div className="field">
          <label htmlFor="post-tags">タグ（コンマ区切り・任意）</label>
          {/* list: the garden's one datalist — completion shared with the edit forms. */}
          <input
            id="post-tags"
            name="tags"
            list="tag-options"
            autoComplete="off"
            maxLength={500}
            value={tagField}
            placeholder="typescript, 読書"
            onChange={(e) => update({ title, body, tags: e.target.value })}
            onKeyDown={submitOnCmdEnter}
          />
        </div>
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
