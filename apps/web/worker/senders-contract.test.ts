import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readHandedPost } from "../src/handover";
import { parseStacking } from "./core/stacking";
import { MAX_TAGS_PER_POST, normalizeTagName } from "./core/tag";
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

// The second door (docs/senders.md「リンクで渡す」, ADR-0009): a link hands the
// 積む dialog the same body, as JSON in its fragment, and src/handover.ts reads
// it in the browser with the route's rules spelled once more (the SPA must not
// import Worker modules). The table holds the two to one answer — a body opens
// through the link exactly when the route would take it — for every rule that
// needs no today. The ones that do are pinned after it, each to its stated
// difference.

/** A today later than every day in the table, so the route's today-bound rules decide nothing there. */
const TODAY = "2026-11-24";

/** The route's answer to a body (routes/posts.ts POST /): the schema, a stone that folds to nothing, the days. */
function routeTakes(body: unknown): boolean {
  const parsed = createPostSchema.safeParse(body);
  if (!parsed.success) return false;
  if ((parsed.data.tags ?? []).some((name) => normalizeTagName(name) === "")) return false;
  return parseStacking(parsed.data, TODAY) !== null;
}

const linkOpens = (body: unknown): boolean => readHandedPost(JSON.stringify(body)).ok;

const range = { firstDay: "2026-11-01", lastDay: "2026-11-20" };
const names = (n: number, width = 2) => Array.from({ length: n }, (_, i) => `${i}`.padStart(width, "x"));

const BODIES: [string, unknown][] = [
  ["the smallest body", { body: "苔" }],
  ["a note handed over by 透き通る", { body: "[題](https://example.com/n)", tags: ["os", "透き通る"], kind: "input", firstDay: "2026-11-23" }],
  ["every key", { body: "苔", tags: ["a"], kind: "both", ...range, thickness: 60 }],
  ["an unknown key", { body: "苔", source: "sukitooru" }],
  ["the retired 見出し", { body: "苔", title: "題" }],
  ["no body", { tags: ["a"] }],
  ["a numeric body", { body: 1 }],
  ["an empty body", { body: "" }],
  ["a blank body", { body: " \n　" }],
  ["a body of 20,000", { body: "苔".repeat(20_000) }],
  ["a body of 20,001", { body: "苔".repeat(20_001) }],
  ["tags as text", { body: "苔", tags: "a" }],
  ["tags: null", { body: "苔", tags: null }],
  ["no tags", { body: "苔", tags: [] }],
  [`${MAX_TAGS_PER_POST} tags`, { body: "苔", tags: names(MAX_TAGS_PER_POST) }],
  [`${MAX_TAGS_PER_POST + 1} tags`, { body: "苔", tags: names(MAX_TAGS_PER_POST + 1) }],
  ["an empty tag", { body: "苔", tags: [""] }],
  ["a tag that folds to nothing", { body: "苔", tags: ["　 "] }],
  ["a tag of 100", { body: "苔", tags: names(1, 100) }],
  ["a tag of 101", { body: "苔", tags: names(1, 101) }],
  ["a numeric tag", { body: "苔", tags: [1] }],
  ["one stone spelled twice", { body: "苔", tags: ["TS", "ts"] }],
  ["kind input", { body: "苔", kind: "input" }],
  ["kind output", { body: "苔", kind: "output" }],
  ["kind null", { body: "苔", kind: null }],
  ["a kind it does not know", { body: "苔", kind: "read" }],
  ["a numeric kind", { body: "苔", kind: 1 }],
  ["a past day", { body: "苔", firstDay: "2026-11-23" }],
  ["today, named", { body: "苔", firstDay: TODAY }],
  ["a day the calendar lacks", { body: "苔", firstDay: "2026-02-30" }],
  ["a day spelled with slashes", { body: "苔", firstDay: "2026/11/23" }],
  ["firstDay: null", { body: "苔", firstDay: null }],
  ["a single day named twice", { body: "苔", firstDay: "2026-11-20", lastDay: "2026-11-20" }],
  ["a single day with a null 厚み", { body: "苔", firstDay: "2026-11-20", thickness: null }],
  ["a single day with a 厚み", { body: "苔", firstDay: "2026-11-20", thickness: 60 }],
  ["today with a 厚み", { body: "苔", thickness: 100 }],
  ["a range with its 厚み", { body: "苔", ...range, thickness: 60 }],
  ["a range without a 厚み", { body: "苔", ...range }],
  ["a range with a null 厚み", { body: "苔", ...range, thickness: null }],
  ["a 厚み of 0", { body: "苔", ...range, thickness: 0 }],
  ["a 厚み of 101", { body: "苔", ...range, thickness: 101 }],
  ["a 厚み of 60.5", { body: "苔", ...range, thickness: 60.5 }],
  ["a 厚み as text", { body: "苔", ...range, thickness: "60" }],
  ["an inverted pair", { body: "苔", firstDay: "2026-11-20", lastDay: "2026-11-01", thickness: 60 }],
  ["an array", [{ body: "苔" }]],
  ["a string", "苔"],
  ["null", null],
];

describe("the link door (リンクで渡す) reads the body POST /api/posts reads", () => {
  it.each(BODIES)("%s: the link opens exactly when the route takes it", (_label, body) => {
    expect(linkOpens(body)).toBe(routeTakes(body));
  });

  it("leaves the rules that need today to the dialog's date fields, and refuses lastDay alone", () => {
    // The route refuses a day not yet come and one past the 1200-month floor;
    // the link opens them, and the date field's max / min stop 積む.
    expect([routeTakes({ body: "苔", firstDay: "2026-11-25" }), linkOpens({ body: "苔", firstDay: "2026-11-25" })]).toEqual([false, true]);
    expect([routeTakes({ body: "苔", firstDay: "1900-01-01" }), linkOpens({ body: "苔", firstDay: "1900-01-01" })]).toEqual([false, true]);
    // lastDay alone means today 〜 lastDay to the route, taken only when it IS
    // today; the dialog would read it as that one day, so the link refuses it.
    expect([routeTakes({ body: "苔", lastDay: TODAY }), linkOpens({ body: "苔", lastDay: TODAY })]).toEqual([true, false]);
  });
});
