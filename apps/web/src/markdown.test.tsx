import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

// 描画器は純関数（Markdown 文字列 → React ノード）なので、静的マークアップに
// 起こして読む。Heatmap.test.tsx と同じ流儀 — 見た目ではなく構造の検査。
const md = (source: string) => renderToStaticMarkup(<>{renderMarkdown(source)}</>);

describe("Markdown の構造", () => {
  it("見出しは苔片の中の階層 — h3 から始めて h6 で頭打ち", () => {
    expect(md("# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n\n###### 六")).toBe(
      "<h3>一</h3><h4>二</h4><h5>三</h5><h6>四</h6><h6>五</h6><h6>六</h6>",
    );
  });

  it("リスト・入れ子・番号つきの開始番号", () => {
    expect(md("- a\n- b\n  - c")).toBe("<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>");
    expect(md("3. x\n4. y")).toBe('<ol start="3"><li>x</li><li>y</li></ol>');
  });

  it("チェックリストは読み取り専用のチェック印になる", () => {
    const html = md("- [x] 済\n- [ ] まだ");
    expect(html).toContain('<li class="md-task"><input type="checkbox"');
    // 押せない印にも名前が要る（axe の label）。名前は状態そのもの。
    expect(html).toContain('aria-label="済み" checked=""/>済');
    expect(html).toContain('aria-label="未了"/>まだ');
    expect(html.match(/checked/g)).toHaveLength(1);
    expect(html.match(/disabled/g)).toHaveLength(2);
  });

  it("コードブロックは lang を class に、中身は素のまま", () => {
    expect(md("```ts\nconst a = 1 & 2 < 3;\n```")).toBe(
      '<pre class="md-pre"><code class="language-ts">const a = 1 &amp; 2 &lt; 3;</code></pre>',
    );
    // ``` の後ろは何でも書けるので、素性のわからない lang は class にしない。
    expect(md('```ts" onload="alert(1)\nx\n```')).toBe('<pre class="md-pre"><code>x</code></pre>');
  });

  it("引用・水平線・表", () => {
    expect(md("> **強い**引用")).toBe("<blockquote><p><strong>強い</strong>引用</p></blockquote>");
    expect(md("---")).toBe("<hr/>");
    const table = md("| a | b |\n|---|--:|\n| 1 | 2 |");
    expect(table).toContain('<th scope="col">a</th>');
    expect(table).toContain('<th class="md-al-right" scope="col">b</th>');
    expect(table).toContain('<td class="md-al-right">2</td>');
    // 広い表は本文の版から溢れず、枠の中で横に流れる。
    expect(table).toContain('<div class="md-table-scroll">');
  });

  it("1 つの改行はそのまま改行（breaks: true）— 素描きだった既存の苔片が崩れない", () => {
    expect(md("一行目\n二行目")).toBe("<p>一行目<br/>二行目</p>");
  });

  it("実体参照を解く（React は文字列をそのまま出すので描画器の仕事）", () => {
    expect(md("&#x3053;&#12428; &nbsp;x")).toBe("<p>これ  x</p>");
    // 不正な符号位置は U+FFFD。
    expect(md("&#0;")).toBe("<p>�</p>");
    // 知らない名前は字面のまま（過剰に解いて意味を変えない）。
    expect(md("&copy;")).toBe("<p>&amp;copy;</p>");
    // コードスパンの中は解かない（CommonMark 6.1）。
    expect(md("`&amp;`")).toBe('<p><code class="md-code">&amp;amp;</code></p>');
  });

  it("バックスラッシュ退避は記号として出る", () => {
    expect(md(String.raw`\*強調ではない\*`)).toBe("<p>*強調ではない*</p>");
  });
});

describe("Markdown の安全性 — 本文は許した要素の外に出られない", () => {
  it("生 HTML は解釈せず、打った通りの字として出る", () => {
    const html = md('<img src=x onerror="alert(1)"> と <b>太字</b>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;b&gt;太字&lt;/b&gt;");
  });

  it("<script> ブロックも字のまま（block html トークン）", () => {
    const html = md("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toBe('<p class="md-raw">&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it("実体参照を解いた結果もタグにはならない（React のテキストノードで着地する）", () => {
    const html = md("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script");
    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("危険なスキームはリンクにしない — ラベルだけが残る", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\0script:alert(1)",
      "data:text/html,<script>1</script>",
      "vbscript:msgbox(1)",
      "blob:https://x.test/1",
      "file:///etc/passwd",
    ]) {
      const html = md(`[ラベル](${href})`);
      expect(html, href).not.toContain("<a");
      expect(html, href).toContain("ラベル");
    }
  });

  it("http / https / mailto と相対リンクは通る（新しいタブ・referrer なし）", () => {
    expect(md("[x](https://a.test/?q=1&r=2)")).toBe(
      '<p><a href="https://a.test/?q=1&amp;r=2" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    expect(md("<mail@a.test>")).toContain('href="mailto:mail@a.test"');
    expect(md("[x](/foo)")).toContain('href="/foo"');
  });

  it("画像は貼らずリンクにする — 外部画像は CSP が通さず、通れば閲覧が漏れる", () => {
    const html = md('![代替文](https://evil.test/pixel.png "題")');
    expect(html).not.toContain("<img");
    expect(html).toBe(
      '<p><a class="md-image-link" href="https://evil.test/pixel.png" title="題"' +
        ' target="_blank" rel="noopener noreferrer">代替文</a></p>',
    );
  });

  it("危険なスキームの画像もリンクにならない", () => {
    expect(md("![alt](javascript:alert(1))")).toBe("<p>alt</p>");
  });

  it("ラベルの無いリンクは URL を字にする — 中身の無い <a> を作らない", () => {
    expect(md("![](https://a.test/x.png)")).toContain(">https://a.test/x.png</a>");
    expect(md("[](https://a.test/)")).toContain(">https://a.test/</a>");
  });
});

describe("Markdown の描画に HTML シンクが無い", () => {
  // ADR-0004 の実体。サニタイザの取りこぼしが攻撃面になるのは innerHTML 系の
  // シンクがあるときだけなので、「シンクが 1 つも無い」ことを機械で固定する。
  it("src/ のどこにも dangerouslySetInnerHTML / innerHTML を書かない", () => {
    // コメントは剥がしてから見る — シンクの話を「書く」のは自由、「使う」のが禁。
    const code = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const root = new URL(".", import.meta.url).pathname;
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
      (f) => /\.(ts|tsx)$/.test(f) && f !== "markdown.test.tsx",
    );
    const offenders = files.filter((f) =>
      /dangerouslySetInnerHTML|innerHTML|outerHTML/.test(code(readFileSync(root + f, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });
});
