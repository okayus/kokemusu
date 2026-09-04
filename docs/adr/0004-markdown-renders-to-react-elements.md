---
status: accepted
date: 2026-09-04
---

# Markdown は「サニタイズして innerHTML」ではなく、React 要素として描く

苔片の本文は復号後にクライアントで Markdown として描く。その描き方として、**HTML 文字列を
一度も作らない**方式を採る（`apps/web/src/markdown.tsx`）。marked は**字句解析だけ**に使い、
トークン → React 要素の対応表（allowlist の switch）を唯一の出口にする。DOMPurify 等の
サニタイザは使わない。tech-stack.md / security.md が想定していた「パーサ ＋ DOMPurify」から、
ここで方針を変える。

security.md の要求は「サニタイズ必須・**生 HTML を許さない**」。生 HTML を一切許さないなら、
サニタイザに求める仕事は「ほぼ全部落とす」であり、フィルタを 1 枚挟む価値より、そもそも
危険な出口（`innerHTML`）を持たない方が要求に素直に一致する。

## Considered options

- **marked ＋ DOMPurify ＋ `dangerouslySetInnerHTML`**（当初の想定）: 定番で、実績も多い。
  ただし本質的に「危険な HTML を落とすフィルタ」であり、**取りこぼしが攻撃面になる**
  （mXSS ——「サニタイズ後の文字列を innerHTML でパースし直すと別の木になる」クラスの回避は
  実際に何度も見つかっている）。依存も 2 つに増え、既定の許可リストは広いので結局
  「生 HTML を許さない」ための設定を書くことになる。
- **ネイティブ Sanitizer API（`Element.setHTML()`）**: 出口をブラウザ実装に任せられるが
  Baseline widely available ではなく、非対応ブラウザ用に結局サニタイザを積むことになる。
- **トークン → React 要素（採用）**: React が文字列を DOM に置くときは常にテキストノードなので、
  本文の中身がどう書かれていてもタグは生えない。攻撃面は「対応表に危険な要素を書いてしまう」
  ことだけになり、それはコードレビューとテストが見張れる。依存は marked 1 つ（依存ゼロ）。

## Consequences

- `dangerouslySetInnerHTML` / `innerHTML` / `outerHTML` は `apps/web/src/` のどこにも書かない。
  **この不在を単体テストで固定する**（`markdown.test.tsx`。コメント中の言及は剥がしてから検査）。
  新しい描画で必要になったら、それはこの ADR を覆す判断であって、その場の実装判断ではない。
- **CSP は緩めない**。`script-src 'self'` のまま（e2e `security-headers.spec` が本番の CSP を
  検査しているので、緩めれば落ちる）。CSP は保険であって主防御ではない、という関係も変わらない。
- **生 HTML はタグにならず、打った通りの字として出る**（`<script>…</script>` も同じ）。捨てないので
  何を書いたかは失われず、解釈しないので何も起きない。
- **画像は `<img>` にせずリンクとして出す**。CSP が `img-src 'self' data:` なので外部画像はどのみち
  表示できず、仮に通せば「日記を開いた時刻」が配信元に漏れる（プライベート前提のアプリで
  受け入れられない）。alt をラベルにしたリンクにして、URL は失わない。
- **リンクは `http` / `https` / `mailto` と相対のみ**。それ以外（`javascript:` `data:` `vbscript:` …）は
  リンクにせず、ラベルだけを字として残す。判定は `new URL()` に任せる（`java&#9;script:` のような
  小細工はブラウザと同じ正規化でしか潰せない）。外部リンクは `target="_blank"` ＋
  `rel="noopener noreferrer"`（referrer も opener も渡さない）。
- **改行は `breaks: true`**（1 つの改行 = 改行）。これまでの本文は `white-space: pre-wrap` の素描き
  だったので、GFM 既定（改行を潰す）に倒すと既存の苔片の見え方が黙って変わる。
- marked の字句解析器は実体参照を解かない（HTML 出力ならブラウザが解く前提）。React は文字列を
  そのまま出すので、**実体参照を解くのは描画器の仕事**になる。解いた結果もテキストノードなので
  安全性には効かない（`&lt;script&gt;` を解いて `<script>` という**文字列**にしても、タグにはならない）。
- 見出しは苔片の中の階層なので h3〜h6 に写す（投稿一覧が h2）。文書アウトラインを壊さない。
- 本文の描画に必要なのは marked の字句解析器だけ。将来これが重荷になったら、対応表側は
  そのままにパーサを差し替えられる（出口の設計がパーサに依存していない）。
