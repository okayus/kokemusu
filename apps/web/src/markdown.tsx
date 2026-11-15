import { marked, type MarkedToken, type Token, type Tokens } from "marked";
import { Fragment, memo, type ReactNode } from "react";

/**
 * 苔片の本文（Markdown）を React 要素として描く。
 *
 * **安全性の要 — HTML 文字列を一度も作らない。** marked は「トークン化」だけに使い、
 * 下の `block` / `inlineOne` の対応表が唯一の出口になる。結果として
 * `dangerouslySetInnerHTML` / `innerHTML` がどこにも無く、本文の文字列は必ず React の
 * テキストノードとして着地する（タグが生えようがない）。生 HTML はトークンとしては
 * 届くが「そのままの文字」として描くだけ ＝ security.md 「生 HTML を許さない」。
 * リンクは `safeHref` のスキーム allowlist を通ったものだけが `<a>` になる。
 *
 * サニタイザ（DOMPurify 等）を挟んで innerHTML に流す形は採らない（[ADR-0004]）:
 * サニタイザは「危ない HTML を落とす」フィルタで、取りこぼし（mXSS 等）が攻撃面に
 * なる。要素を組み立てる側に回れば、その攻撃面ごと存在しなくなる。CSP も
 * `script-src 'self'` のまま触らずに済む。
 *
 * [ADR-0004]: ../../../docs/adr/0004-markdown-renders-to-react-elements.md
 */

// ---------------------------------------------------------------- 文字レベル

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z][\dA-Za-z]{1,31}));/g;

/** 不正な符号位置は U+FFFD（CommonMark の作法。`&#0;` も含む）。 */
function fromCodePoint(cp: number): string {
  const bad = !Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff);
  return bad ? "�" : String.fromCodePoint(cp);
}

/**
 * marked のトークンは実体参照を素通しする（HTML 出力ならブラウザが解く）。React は
 * 文字列をそのまま出すので、ここで解いておかないと `&amp;` が字面のまま残る。
 * 名前つきは Markdown で実際に打たれる 6 つだけ — 未知の名前は字面のまま残す
 * （＝ 過剰に解いて意味を変えるより、解かない方に倒す）。
 */
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name) => {
    if (typeof name === "string") return NAMED_ENTITIES[name] ?? whole;
    return dec !== undefined
      ? fromCodePoint(Number.parseInt(dec, 10))
      : fromCodePoint(Number.parseInt(hex ?? "", 16));
  });
}

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);
/** 相対 URL を解決してスキームを見るためだけの土台（実在しないホスト）。 */
const HREF_BASE = "https://kokemusu.invalid/";

/**
 * `<a href>` に載せてよい URL だけを返す。`javascript:` `data:` `vbscript:` などは
 * null ＝ リンクにしない。`new URL()` に判定させるのは、`java\0script:` のような
 * 小細工をブラウザと同じ正規化で潰すため（自前の文字列判定はここで負ける）。
 */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href === "") return null;
  try {
    return SAFE_SCHEMES.has(new URL(href, HREF_BASE).protocol) ? href : null;
  } catch {
    return null;
  }
}

const LANG = /^[\w+#-]{1,24}$/;

/** ``` の後ろは何でも書けるので、class に載せるのは素性のわかる 1 語だけ。 */
function langClass(lang: string | undefined): string | undefined {
  const first = (lang ?? "").trim().split(/\s+/)[0] ?? "";
  return LANG.test(first) ? `language-${first}` : undefined;
}

/** 見出しは苔片の中の話。投稿一覧が h2 なので h3 から始め、深いものは h6 で頭打ち。 */
function headingTag(depth: number): "h3" | "h4" | "h5" | "h6" {
  return (["h3", "h4", "h5", "h6"] as const)[Math.min(Math.max(depth, 1), 4) - 1] ?? "h3";
}

// -------------------------------------------------------------- インライン

/**
 * marked の `Token` は拡張トークン用の `Tokens.Generic`（`type: string` ＋ 何でもあり）を
 * 含む union なので、そのままでは `switch` が型を絞れない。拡張は登録していない ＝
 * 実際に出てくるのは既知の型だけなので、再帰の入口でここだけ言い直す。
 */
const known = (tokens: Token[] | undefined): MarkedToken[] => (tokens ?? []) as MarkedToken[];

function inline(tokens: Token[] | undefined, key: string): ReactNode[] {
  return known(tokens).map((t, i) => inlineOne(t, `${key}.${i}`));
}

function inlineOne(t: MarkedToken, key: string): ReactNode {
  switch (t.type) {
    // 素の文字。React が置けば必ずテキストノード ＝ ここが安全性の底。
    case "text":
      return t.tokens ? (
        <Fragment key={key}>{inline(t.tokens, key)}</Fragment>
      ) : (
        decodeEntities(t.text)
      );
    // `\*` の類。text は既に「その 1 文字」なので実体参照は解かない。
    case "escape":
      return t.text;
    case "br":
      return <br key={key} />;
    case "strong":
      return <strong key={key}>{inline(t.tokens, key)}</strong>;
    case "em":
      return <em key={key}>{inline(t.tokens, key)}</em>;
    case "del":
      return <del key={key}>{inline(t.tokens, key)}</del>;
    // コードスパンの中の実体参照は解かない（CommonMark 6.1）。
    case "codespan":
      return (
        <code key={key} className="md-code">
          {t.text}
        </code>
      );
    case "link":
      return link(t, key);
    // 画像は貼らずリンクにする。CSP は `img-src 'self' data:` で外部画像を
    // そもそも通さないし、通したら「日記を開いた」ことが配信元に漏れる。
    case "image":
      return link(
        { type: "link", raw: t.raw, href: t.href, title: t.title, text: t.text, tokens: t.tokens },
        key,
        "md-image-link",
      );
    // 生 HTML: 字面のまま。ここが「解釈しない」の実体。
    case "html":
      return t.text;
    default:
      return null;
  }
}

function link(t: Tokens.Link, key: string, className?: string): ReactNode {
  const href = safeHref(t.href);
  const children = t.tokens.length > 0 ? inline(t.tokens, key) : [decodeEntities(t.text)];
  // ラベルの無いリンク（`![](url)` など）は URL 自体を字にする — 中身の無い <a> を作らない。
  const label = children.some((n) => n !== "") ? children : [t.href];
  // 通せない URL はリンクにせず、ラベルだけを字にする（リンク先は消える）。
  if (href === null) return <Fragment key={key}>{label}</Fragment>;
  return (
    <a
      key={key}
      className={className}
      href={href}
      title={t.title ?? undefined}
      // 外に出す先に referrer も opener も渡さない（私的な日記から出ていく導線）。
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  );
}

// ------------------------------------------------------------------ ブロック

function blocks(tokens: Token[], key: string): ReactNode[] {
  return known(tokens).map((t, i) => block(t, `${key}.${i}`));
}

function block(t: MarkedToken, key: string): ReactNode {
  switch (t.type) {
    // 空行とリンク参照定義は何も描かない。
    case "space":
    case "def":
      return null;
    case "heading": {
      const Tag = headingTag(t.depth);
      return <Tag key={key}>{inline(t.tokens, key)}</Tag>;
    }
    case "paragraph":
      return <p key={key}>{inline(t.tokens, key)}</p>;
    // 見出しにもリストにもならなかった行の受け皿。
    case "text":
      return <p key={key}>{t.tokens ? inline(t.tokens, key) : decodeEntities(t.text)}</p>;
    case "blockquote":
      return <blockquote key={key}>{blocks(t.tokens, key)}</blockquote>;
    case "hr":
      return <hr key={key} />;
    case "code":
      return (
        <pre key={key} className="md-pre">
          <code className={langClass(t.lang)}>{t.text}</code>
        </pre>
      );
    case "list":
      return list(t, key);
    case "table":
      return table(t, key);
    // 生 HTML のブロック（`<script>…</script>` を含む）は、打った通りの字として置く。
    case "html":
      return (
        <p key={key} className="md-raw">
          {t.text}
        </p>
      );
    default:
      return null;
  }
}

function list(t: Tokens.List, key: string): ReactNode {
  const items = t.items.map((item, i) => listItem(item, `${key}.${i}`));
  return t.ordered ? (
    <ol key={key} start={typeof t.start === "number" ? t.start : undefined}>
      {items}
    </ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

function listItem(item: Tokens.ListItem, key: string): ReactNode {
  // tight な項目の中身は `text` トークン ＝ <p> で包まない（それが tight の意味）。
  // checkbox トークンは item.task / item.checked と同じ情報なので読み飛ばす。
  const content = known(item.tokens).flatMap((t, i): ReactNode[] => {
    const k = `${key}.${i}`;
    if (t.type === "checkbox") return [];
    if (t.type === "text") return [<Fragment key={k}>{inline(t.tokens ?? [t], k)}</Fragment>];
    return [block(t, k)];
  });
  return (
    <li key={key} className={item.task ? "md-task" : undefined}>
      {item.task && (
        // 読み物としてのチェック印。押しても本文は変わらない（編集は編集フォームで）。
        <input
          type="checkbox"
          checked={item.checked === true}
          readOnly
          disabled
          aria-label={item.checked === true ? "済み" : "未了"}
        />
      )}
      {content}
    </li>
  );
}

function table(t: Tokens.Table, key: string): ReactNode {
  const align = (a: "center" | "left" | "right" | null) => (a === null ? undefined : `md-al-${a}`);
  return (
    // 幅の広い表は枠内で横スクロールさせる（本文が版から溢れないように）。
    <div key={key} className="md-table-scroll">
      <table>
        <thead>
          <tr>
            {t.header.map((cell, i) => (
              <th key={i} className={align(t.align[i] ?? null)} scope="col">
                {inline(cell.tokens, `${key}.h.${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className={align(t.align[i] ?? null)}>
                  {inline(cell.tokens, `${key}.${r}.${i}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------------- 入口

/**
 * `breaks: true` — 1 つの改行をそのまま改行として描く。苔片はツイート感覚の短文で、
 * これまで本文は `white-space: pre-wrap` の素描きだった。GFM 既定（改行を潰して
 * 1 段落にする）に倒すと、既存の苔片の見え方が黙って変わってしまう。
 */
const LEX_OPTIONS = { gfm: true, breaks: true } as const;

/** Markdown 文字列 → React ノード列。副作用なし（DOM を触らない）＝ そのままテスト可能。 */
export function renderMarkdown(source: string): ReactNode[] {
  return blocks(marked.lexer(source, LEX_OPTIONS), "b");
}

/**
 * 苔片の本文と、コンポーザのプレビューが共有する描画。memo: 一覧の再描画（絞り込み
 * 切替など）のたびに全苔片を字句解析し直さないため。
 */
export const Markdown = memo(function Markdown(props: { source: string; className?: string }) {
  return <div className={props.className}>{renderMarkdown(props.source)}</div>;
});
