---
status: accepted
date: 2026-09-06
---

# 苔片に見出しは持たない（`post.title` を廃止し、決めること 7 を撤回する）

苔片は Twitter の投稿のように**思ったこと・メモに石（タグ）を付けるだけ**のものにする。2026-08-23 の決めること 7 は
「任意の見出し。手動でも API でも付けられ、UI は既定で隠す」だったが、ダイアログ化（#41）で `<details>`「見出しを付ける」
として載せてみて、書き手（人）が使う場面が無かった。題が要るほどの文章は本文の Markdown の見出し（`##`）で足り、
苔片を束ねる軸はタグ（[CONTEXT.md](../../CONTEXT.md)）で、年表の行も総草のマスも見出しを読まない。
**`post.title` 列を落とし（`0005`、`ALTER TABLE post DROP COLUMN title` の 1 文 —— 0003 と同じ引き算で再構築ではない）、
UI の欄とカードの表示を消し、`POST` / `PATCH /api/posts` は `title` を含む知らないキーを 400 で拒む。**
既存の見出しは消えてよい（利用者は 1 人で、消えて困るデータは無いと持ち主が判断）。

## Considered options

- **列を残して使わない**: migration は不要だが、暗号文だけが入った死んだ列が残り、schema と data-model.md が嘘になる。
  引き算の migration は再構築ではない（`cloudflare-d1-drizzle-migration` の罠に当たらない）ので、残す理由が無い。
- **API だけ `title` を黙って捨てる**（zod の `object` の既定）: 送り側（mazuoboeru の日次 push）は壊れないが、送った題が
  黙って消え、送り側は気づけない。受け側は検証するだけ（[ADR-0002](0002-api-posting-via-receiver-side-pat.md)）という
  立場なら、知らないキーは断る方が正直 —— `strictObject`。
- **既存の見出しを本文の 1 行目へ写してから落とす**: 見出しは暗号文なので SQL の migration では写せず、Worker か手作業になる。
  消えてよいデータなので、やらない。
- **廃止する（採用）**。

## Consequences

- `post` の列は `id / user_id / body / body_format / first_day / last_day / kind / created_at / updated_at`。暗号文は `body`
  だけになる（[ADR-0001](0001-body-encrypted-at-app-layer.md) の「（と見出し）」は無くなる）。
- `POST` / `PATCH /api/posts` の body は `body`・`tags?`・`kind?`・`firstDay?`・`lastDay?` の 5 つで、それ以外のキーは
  `400 validation_error`。ADR-0002 の「手動投稿と同じ（`title?` `body` `tags`）」から `title?` が消える。
  mazuoboeru が `title` を送っていれば直すまで 400 になる（題を残したければ本文の 1 行目に書く）。
- 積むダイアログと編集フォームから「見出しを付ける」が消える。端末に残っていた下書きの `title` は、読むときに本文の先頭へ
  写す（書きかけを黙って捨てない）。カードの `.post-title` と削除確認の見出し表示も消える。
- 全文検索（未実装）の対象は本文とタグ。
- 「見出し」は用語集（CONTEXT.md）から消す。本文の中の Markdown の見出しは別物で、そのまま。
