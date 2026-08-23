---
name: handoff
description: セッションの区切りで進捗を書き戻す。docs/status.md を「いま」だけに書き換え、完了した節目を docs/log.md の先頭へ 1 行で移し、上限（40 行 / 3 KB・見出し 4 つ固定）を検査して commit する。ユーザが /handoff と打ったときだけ実行する。
disable-model-invocation: true
argument-hint: "[一言メモ（任意）]"
---

ユーザからの一言メモ: $ARGUMENTS（空なら無視）。

## 手順（この順で。省略しない）

1. **現状把握**: `git status -sb`、`git log --oneline -10`、`gh pr list --state open`（使えない環境なら飛ばす）、`docs/status.md`、`head -10 docs/log.md` を読む。このセッションで「終わったこと / 残ったこと / 詰まったこと」を 3 行で整理する。
2. **`docs/log.md`**: 終わった節目を**先頭に** 1 行ずつ足す（`- YYYY-MM-DD 何を（#PR / ADR / skill）`）。既存行は編集しない。節目 = PR の merge・ADR・人手作業の完了・本番の状態変化。作業中の試行錯誤は書かない。
3. **`docs/status.md` を書き換える**（追記しない）: 見出し 4 つ（フェーズ / 次の 3 手 / 詰まり・人手待ち / 進行中 PR）は固定のまま、中身を現在の状態に置き換える。完了項目は消す（取り消し線は禁止）。8 行を超える節は `docs/plans/<topic>.md` に切り出して 1 行のポインタにする。「次の 3 手」の 1 手目は、次のセッションが最初に着手する具体的な作業にする。
4. **`docs/plans/`** の完了した計画は削除する（結論は ADR か log の 1 行に残っている前提）。`docs/roadmap.md` はチェックボックスだけ更新し、経緯は書かない。
5. `bash .claude/hooks/check-status.sh` を実行し、OK になるまで 3 を直す。
6. **commit**: 現在のブランチが `main` なら `claude/handoff-YYYY-MM-DD` を切ってから、`docs(status): <要約>` で commit する。push と PR はユーザに確認してから（CLAUDE.md の git 規約どおり）。
7. 最後に「次セッションの出発点」（status.md「次の 3 手」の 1 手目）を 1 行で報告する。

## 書かないもの

- `CLAUDE.md` に進捗・履歴（規約だけ）
- `docs/status.md` に完了項目・経緯・調査結果（plans / ADR / log へ）
- `docs/log.md` に作業中の細かい出来事（git log と PR にある）
