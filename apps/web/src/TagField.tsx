// タグの欄 — chips for the stones chosen, a text input that offers the
// registered stones as it is typed, and a row that makes a new stone when the
// spelling is new (features.md §2, 2026-09-06). Shared by the composer and
// the edit form; controlled by whoever renders it (the composer 退避s every
// change to the draft).
//
// A re-invented widget, on purpose: no native element is a multi-select
// combobox — `<datalist>` completes one value, `<select multiple>` cannot take
// a new spelling — so this follows the WAI-ARIA editable combobox with list
// autocomplete (role="combobox" + aria-activedescendant into a listbox). The
// listbox is an overlay that opens UPWARD from the box (plain absolute
// positioning — no anchor API, no fallback to carry): it must not take part in
// the layout, or closing it on blur would move the 積む button under a press
// (mousedown blurs → the list folds → the button shifts → mouseup lands
// elsewhere and no click fires); and upward, so it never covers the actions
// below the field — the tag field is the last field, with the body and 向き
// above it to cover for a moment.
//
// Keys, in the input: Enter / Tab / a comma commit (the highlighted stone, or
// the text as a new one); Enter with nothing typed does nothing — never the
// form's implicit submit; ⌘/Ctrl+Enter still submits; Backspace on empty text
// takes the last chip back; ↑↓ walk the list; Escape folds the list and only
// the list (the dialog stays). IME composition is left alone until it ends.
import { useRef, useState, type KeyboardEvent } from "react";
import { submitOnCmdEnter } from "./form";
import type { TagSummary } from "./posts-api";
import {
  absorbSeparators,
  commitText,
  removeStone,
  suggestStones,
  type Suggestion,
  type TagsFields,
} from "./tags";

export function TagField(props: {
  id: string;
  /** The garden's registered stones (GET /api/tags) — what the listbox offers. */
  options: TagSummary[];
  value: TagsFields;
  onChange: (next: TagsFields) => void;
}) {
  const { value, onChange } = props;
  const [open, setOpen] = useState(false);
  // The highlighted row, or none. Typing highlights the first row (what Enter
  // takes); arrows move it; an empty field highlights nothing, so a stray
  // Enter adds no stone.
  const [active, setActive] = useState<number | null>(null);
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = `${props.id}-options`;
  const hintId = `${props.id}-hint`;
  const rows = suggestStones(props.options, value);
  const activeIndex = active !== null && active < rows.length ? active : null;
  const expanded = open && rows.length > 0;

  const settle = (next: TagsFields) => {
    onChange(next);
    setActive(next.text.trim() === "" ? null : 0);
  };
  const take = (row: Suggestion) => settle(commitText(value, row.name));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (submitOnCmdEnter(e)) return;
    // Mid-composition keys belong to the IME (Enter confirms a conversion).
    if (e.nativeEvent.isComposing || e.key === "Process") return;
    const typed = value.text.trim() !== "";
    switch (e.key) {
      case "Enter":
        // Never the form's implicit submission — that is ⌘/Ctrl+Enter's.
        e.preventDefault();
        if (activeIndex !== null) take(rows[activeIndex] as Suggestion);
        else if (typed) settle(commitText(value));
        return;
      case "Tab":
        // With text typed, Tab commits and stays (the next stone is likely);
        // with none, it leaves the field as Tab does.
        if (!typed) return;
        e.preventDefault();
        if (activeIndex !== null) take(rows[activeIndex] as Suggestion);
        else settle(commitText(value));
        return;
      case "Backspace":
        if (value.text === "" && value.tags.length > 0) {
          e.preventDefault();
          settle(removeStone(value, value.tags.length - 1));
        }
        return;
      case "ArrowDown":
        if (rows.length === 0) return;
        e.preventDefault();
        setOpen(true);
        setActive(activeIndex === null ? 0 : Math.min(activeIndex + 1, rows.length - 1));
        return;
      case "ArrowUp":
        if (rows.length === 0) return;
        e.preventDefault();
        setActive(activeIndex === null ? rows.length - 1 : Math.max(activeIndex - 1, 0));
        return;
      case "Escape":
        // Folds the list and only the list: a cancelled keydown is not a close
        // request, so the surrounding <dialog> stays up.
        if (expanded) {
          e.preventDefault();
          setOpen(false);
          setActive(null);
        }
        return;
      default:
        return;
    }
  };

  return (
    <div className="field tag-field">
      <label htmlFor={props.id}>タグ（任意）</label>
      {/* The anchor the list hangs from (position: relative); the box is dressed
          as the input, and a tap anywhere in it lands in the text. */}
      <div className="tag-field-anchor">
      <div className="tag-field-box" onClick={() => inputRef.current?.focus()}>
        {value.tags.length > 0 && (
          <ul className="tag-field-chips" role="list">
            {value.tags.map((name, i) => (
              <li key={`${i}-${name}`} className="tag-field-chip">
                <span>{name}</span>
                <button
                  type="button"
                  aria-label={`「${name}」を外す`}
                  onClick={(e) => {
                    e.stopPropagation();
                    settle(removeStone(value, i));
                    inputRef.current?.focus();
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          id={props.id}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex === null ? undefined : `${listId}-${activeIndex}`}
          aria-describedby={hintId}
          autoComplete="off"
          autoCapitalize="none"
          maxLength={100}
          placeholder={value.tags.length === 0 ? "typescript, 読書" : undefined}
          value={value.text}
          onChange={(e) => {
            const text = e.target.value;
            if (composing.current) {
              onChange({ ...value, text });
              return;
            }
            settle(absorbSeparators(value, text));
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(null);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            settle(absorbSeparators(value, e.currentTarget.value));
          }}
        />
      </div>
      {/* Mounted while closed (hidden) so aria-controls always points at it. */}
      <ul id={listId} role="listbox" className="tag-field-options" hidden={!expanded} aria-label="石の候補">
        {rows.map((row, i) => (
          <li
            key={row.kind === "stone" ? row.id : "new"}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            className={row.kind === "new" ? "tag-field-option new" : "tag-field-option"}
            // mousedown would blur the input (closing the list before click lands).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => take(row)}
          >
            {row.kind === "new" ? `「${row.name}」を新しい石に` : row.name}
          </li>
        ))}
      </ul>
      </div>
      <p className="hint" id={hintId}>
        Enter・Tab・カンマで区切ります。登録済みの石は候補から。
      </p>
    </div>
  );
}
