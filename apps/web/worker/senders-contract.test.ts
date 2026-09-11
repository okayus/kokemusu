import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_TAGS_PER_POST } from "./core/tag";
import { createPostSchema } from "./routes/posts";

// The contract a 送り側 reads (docs/senders.md, ADR-0008) has two halves: the
// prose, and docs/senders/posts.schema.json — `createPostSchema` as JSON
// Schema. That file is GENERATED here and pinned by a file snapshot, so the
// published shape can never say something the route does not: change the
// zod schema and `pnpm test` fails until the file is regenerated
// (`pnpm --filter @kokemusu/web exec vitest run -u worker/senders-contract.test.ts`)
// and docs/senders.md's 変更履歴 gets its line. A sender vendors the file and
// checks its own builder against it with `z.fromJSONSchema` — the drift that
// a hand-copied contract let through (mazuoboeru kept sending the 見出し
// ADR-0006 had retired; both test suites stayed green) fails a test instead.
//
// What JSON Schema cannot say — the order of the days, "not after today",
// the 厚み ⇔ range rule (core/stacking.ts) — lives in the descriptions and in
// docs/senders.md. The descriptions are keyed by the schema's own fields, so
// adding a field without describing it is a type error, not a silent gap.

/** Published location — what `$id` says and what a sender curls. */
const SCHEMA_URL = "https://raw.githubusercontent.com/okayus/kokemusu/main/docs/senders/posts.schema.json";

/** Where the generated file lives, relative to this test (repo root `docs/`). */
const SNAPSHOT_PATH = "../../../docs/senders/posts.schema.json";

type Field = keyof z.infer<typeof createPostSchema>;

// One entry per body key — `Record<Field, …>` makes a new key in
// createPostSchema fail `tsc` here until it is described.
const FIELD_DOCS: Record<Field, string> = {
  body: "本文（Markdown）。1〜20,000 文字（UTF-16 単位）で、空白だけの本文は 400。保存時に受け側が暗号化する（ADR-0001）。",
  tags: `石（タグ）の名前の配列。最大 ${MAX_TAGS_PER_POST} 個、各 1〜100 文字。表記ゆれは受け側が正規化（trim ＋ NFKC ＋ 小文字）して同じ石に落とし、正規化して空になる名前は 400（重複は正規化後にまとめる）。省略 ＝ タグなし。送り側は出所をここで名乗る（例: ["mazuoboeru"]）。`,
  kind: "向き: input（吸う）/ output（出す）/ both。省略または null ＝ 未分類。",
  firstDay:
    "積む最初の「日」（日本時間の YYYY-MM-DD、実在する暦日）。省略 ＝ 受け側の今日。lastDay 以前で、今日より後は 400、今日から 1200 か月より前も 400。前日分を翌日に送るならここに前日を入れる（苔片は送った日ではなく在った日に積む）。",
  lastDay:
    "最後の「日」（同じ形式）。省略 ＝ firstDay（単日）。firstDay より後なら続く苔片で、thickness が必須。今日より後は 400。",
  thickness:
    "厚み: 1〜100 の整数（%）。続く苔片（firstDay < lastDay）には必須、単日（firstDay ＝ lastDay）には付けられない（付けると 400）。null ＝ 無し（単日と同じ意味）。",
};

// The day keys are `.refine(isDayKey)` in zod, which JSON Schema cannot carry;
// `format: date` + the pattern say the same thing in its own words.
const DAY_KEY_FIELDS: readonly Field[] = ["firstDay", "lastDay"];
const DAY_KEY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

type JsonSchemaObject = {
  $schema?: string;
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties: boolean;
};

/** `createPostSchema` as the JSON Schema text a sender reads — pretty, deterministic. */
export function sendersPostSchemaJson(): string {
  const base = z.toJSONSchema(createPostSchema) as unknown as JsonSchemaObject;
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [name, property] of Object.entries(base.properties)) {
    const extra = DAY_KEY_FIELDS.includes(name as Field)
      ? { format: "date", pattern: DAY_KEY_PATTERN }
      : {};
    properties[name] = { ...property, ...extra, description: FIELD_DOCS[name as Field] };
  }
  const { $schema, ...rest } = base;
  const schema = {
    $schema,
    $id: SCHEMA_URL,
    title: "kokemusu — POST /api/posts の body",
    description:
      "apps/web/worker/routes/posts.ts の createPostSchema から apps/web/worker/senders-contract.test.ts が生成する。" +
      "手で編集しない（pnpm test が一致を検査し、更新は vitest -u）。" +
      "日の順序と「今日まで」、厚みと日数の関係は JSON Schema では表せないので、各 description と docs/senders.md にある。",
    ...rest,
    properties,
  };
  return `${JSON.stringify(schema, null, 2)}\n`;
}

describe("docs/senders/posts.schema.json (the published sender contract)", () => {
  it("is createPostSchema, generated — regenerate with `vitest -u` when the route changes", async () => {
    await expect(sendersPostSchemaJson()).toMatchFileSnapshot(SNAPSHOT_PATH);
  });

  it("describes every body key and nothing else", () => {
    const schema = JSON.parse(sendersPostSchemaJson()) as JsonSchemaObject;
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(FIELD_DOCS).sort());
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["body"]);
  });

  it("read back with z.fromJSONSchema, refuses what the route refuses", () => {
    const published = z.fromJSONSchema(
      JSON.parse(sendersPostSchemaJson()) as Parameters<typeof z.fromJSONSchema>[0],
    );
    const accepts = (body: unknown) => published.safeParse(body).success;

    // The mazuoboeru daily shape, and the smallest body.
    expect(accepts({ body: "- 回答: 3問", tags: ["mazuoboeru"], firstDay: "2026-09-08" })).toBe(true);
    expect(accepts({ body: "苔" })).toBe(true);
    // The tag cap as published: full is fine, one more is not (core/tag.ts derives it).
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(accepts({ body: "苔", tags: tags(MAX_TAGS_PER_POST) })).toBe(true);
    expect(accepts({ body: "苔", tags: tags(MAX_TAGS_PER_POST + 1) })).toBe(false);
    // The retired 見出し (ADR-0006) — the drift this file exists to catch.
    expect(accepts({ body: "苔", title: "まず覚える 2026-09-03" })).toBe(false);
    // Shapes the route's zod refuses before the handler: the schema agrees.
    expect(accepts({ body: "苔", firstDay: "2026-13-40" })).toBe(false);
    expect(accepts({ body: "苔", firstDay: "20260908" })).toBe(false);
    expect(accepts({ body: "苔", thickness: 101 })).toBe(false);
    expect(accepts({ body: "苔", kind: "sideways" })).toBe(false);
    expect(accepts({ body: "" })).toBe(false);
  });
});
