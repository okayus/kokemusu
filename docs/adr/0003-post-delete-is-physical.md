---
status: accepted
date: 2026-09-03
---

# 投稿の削除は物理削除。ソフトデリートはしない

苔片の削除は `DELETE FROM post` 1 文で行う（`post_tags` は FK の `ON DELETE CASCADE` が同時に消す。
D1 は FK enforcement を無効化できないので確実に効く）。`deleted_at` 打刻による論理削除は採用しない。
「画面から見えなくする」は削除ではなく**状態**であり、その需要が出たらタグの `archived_at` と同じ形
（アーカイブ）で別途モデル化する。

初期スキーマの `post.deleted_at` は features.md の「復元可能にする」1 行だけを根拠に入ったが、
復元を成立させる設計（ゴミ箱 UI・復元ルート・purge ポリシー）はどこにもなかった。実装すれば実態は
「UI からは物理削除と区別がつかないまま、暗号文の本文と**平文のメタデータ（日時・タグリンク）**だけが
D1 に無期限に残る」——消したい投稿ほどセンシティブである可能性が高い日記アプリで、最悪の組み合わせになる。

## Considered options

- **ソフトデリート（`deleted_at` 打刻）**: 唯一の効用「復元」が未設計のまま。security.md の
  「平文が D1・Time Travel・バックアップに残る期間を作らない」という原則と逆行し、定期バックアップ
  （Phase 3）開始後は削除済み行が全バックアップへ永続複製される。さらに以後のすべての読みクエリに
  `isNull(deleted_at)` を課す——1 回忘れると「削除したはずの投稿が可視化に蘇る」バグで、単体テストは
  D1 なしなので気づけないクラス（#32 の batch 罠と同種）。
- **ゴミ箱つきソフトデリート（期限つき保持 + 復元 UI + purge Cron）**: 「復元可能」を本当にやる形。
  単一ユーザ + 確認ダイアログという条件では過剰装備で、最大の実装量で最小の必要を満たすことになる。
- **物理削除（採用）**: 誤削除の受け皿は層で持つ——確認ダイアログ（UI、本文プレビューつき）→
  エクスポート（features.md §5、個別の再投稿）→ D1 Time Travel（常時有効・無効化不可。Paid 30 日 /
  Free 7 日、DB 全体の in-place 復元 = 壊滅時専用）→ Phase 3 の定期バックアップ。

## Consequences

- 読み経路の「生存フィルタ」は不要になり、全クエリから `isNull(deleted_at)` を外す（posts / stats）。
- `post.deleted_at` 列と `post_deleted_at_idx` は**後続の migration PR で drop**する（全行 NULL なので
  急がない。index を先に落としてから列。生成 SQL が `post` の再構築になっていないことを
  `migrations.test.ts` で確認——`cloudflare-d1-drizzle-migration` の CASCADE 罠）。それまで
  schema.ts には「決して書かない列」としてコメントつきで残る。
  ✅ 実施済み（2026-09-04、`0003_drop_post_deleted_at`）: 生成 SQL は `DROP INDEX` → `ALTER TABLE ... DROP COLUMN`
  の 2 文だけ（`CREATE TABLE` 無し ＝ 再構築なし）。ローカル D1 に親子行を仕込んで適用し、`post` / `post_tags`
  の行数が変わらないことと FK `ON DELETE CASCADE` が残ることを確認した上で `migrations.test.ts` に固定。
- 物理削除も即時のバイト消去ではない: Time Travel の保持窓と取得済みバックアップには残る（本文は
  暗号文——ADR-0001 が受容済みのライン）。窓の経過後は確実に消える点がソフトデリートとの差。
- 編集（PATCH）はこの決定と独立に、再暗号化 + `updated_at` 打刻の上書きで行う（版の保持はしない。
  「履歴を残す編集」が欲しくなったらそれも状態のモデル化であって、削除の話ではない）。
