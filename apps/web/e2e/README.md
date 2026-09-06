# e2e（Playwright）

配線の事実だけを見る 4 spec。ドメインの意味は `worker/**/*.test.ts` / `src/**/*.test.tsx`（vitest）に置く。

- `golden-path` — WebAuthn 仮想 authenticator（CDP）で初回登録 → リロードでセッションが残る → 苔片を 1 つ積む → タイムラインに復号された本文とタグ → 総草の今日のマスが level 0 → 1（画面と API の両方）→ リロードで残る → ログアウト → 登録したパスキーでログイン → 2 本目の苔片でタグ絞り込み 3 導線と Markdown 描画 → 編集・削除 → 期間絞り込み（今日プリセット → 編集フォームの「日: YYYY/MM/DD」を開いて 2 欄とも昨日にして保存 ＝ PATCH で苔片の「日」（`first_day` / `last_day`）を 1 日戻し、今日の窓から消え重なりを wire で検査、カードは日と「M/D に積む」で時刻無し → カスタム範囲 → 逆転はブラウザの検証で止まりリクエストにならない）→ 総草のマスのタップ（リロード後、Tab 停止は今日のマス 1 つ → ↑ で前日のマスへ移り停止も移る → Enter で投稿一覧がその日に絞られチップ「YYYY/MM/DD ×」→ 今日のマスのクリックは空 → × で戻る）→ 積むダイアログ（右下の丸い「積む」で開く。1 本目はここから、2 本目は `n` キーで開く。前の投稿のタグは持ち越されず、Esc で閉じた本文は次に開くと戻る → 昨日に絞った状態で積むと一覧は動かずバーに「積みました（いまの絞り込みの外）」、苔は濃くなる → 苔片の「同じ石に積む」でタグ欄がその石で埋まり本文は空、先頭に着地）→ 向き（インプット 2 枚で今日のマスの読み上げ・比率・wire・カードの印、編集で未分類へ戻すと追随）→ 過去に積む・続く苔片（「日を選ぶ」で昨日に 1 枚 → 一覧は動かず受領に「YYYY/MM/DD に絞る」ボタン、押すとその日に絞られカードは日 ＋「M/D に積む」、昨日のマス +1・計 +1 → いつ ＝ 昨日・〜いつまで ＝ 今日の続く苔片 → 両日 +1 だが計は +1、年表の行は昨日〜今日で触れる月に 1、今日のマスのクリックで出る（重なり）→ 逆転は「いつ」の rangeOverflow で止まりダイアログは残る → in-page fetch で 未来・非日付・逆転・1900 年・PATCH で明日へ伸ばす が全部 400 で行は不変）。`DEV_BYPASS_USER_ID` は作らない（配線を素通りしたら回帰を拾えない）
- `auth-boundary` — セッション無しの `/api/*` は読み書き・未知パスとも 401 JSON（SPA に落ちない）。偽 Cookie は 401、登録トークン違いは 403、`login/begin` は公開のまま（mount 順の回帰検知）
- `pat` — 設定 UI で発行（一度きり表示）→ Cookie 無しの送り側が `Authorization: Bearer` だけで `POST /api/posts`（Origin 不要 = CSRF 免除。body は `kind: "input"` と `firstDay: 昨日` — mazuoboeru の朝の push の形で、応答は `firstDay` / `lastDay` ＝ 昨日・`postedDay` ＝ 今日。その前に `title` を持つ body は 400 — ADR-0006 で消えた見出しを送る送り側は黙って削られず断られる）→ 積まれた苔片は暗号化されて UI に復号表示（昨日の位置、カードは日）→ post:write はタイムラインを読めない・PAT で PAT は作れない（403 `session_required`）・PAT は同乗 Cookie より先に判定 → UI で失効すると 401。D1 に生トークンが無いこと、`first_day` / `last_day` / `kind` が平文で入っていることも見る
- `security-headers` — `/`・SPA fallback・`/health`・`/api` 401 に本番の strict CSP（`'unsafe-inline'` 無し）/ X-Frame-Options / nosniff / Referrer-Policy が付く。http なので HSTS は無いことを断定。`/api` は `no-store`。非 GET の Origin 不一致は 403

## 動かし方（コンテナ内）

```bash
pnpm e2e            # build → prepare-config → wrangler dev（127.0.0.1:5183、ビルド成果物）→ 4 spec
pnpm e2e:server     # サーバーだけ立てておく。以後の pnpm e2e は再ビルドを飛ばす（reuseExistingServer）
```

- 対象は **ビルド成果物**（`dist/kokemusu/`）。`vite dev` には向けない — HMR の inline script を本番 CSP が弾いて React が立ち上がらない。
- Worker の vars は `e2e/env.ts`（`RP_ID=localhost` / `ORIGIN=http://localhost:5183` / SESSION_SECRET / INITIAL_REGISTRATION_TOKEN / BODY_KEY / PAT_PEPPER、すべてテスト専用値）。`prepare-config.ts` が派生 config `dist/kokemusu/wrangler.json` に書き、ビルドがそこへコピーする `.dev.vars` を消す。`.dev.vars` も `wrangler.jsonc` も触らない。
- D1 は **e2e 専用の `.wrangler/e2e`**（global-setup が migrate → 全消し）。`pnpm dev` の `.wrangler/state` は触らない。
- Chromium はイメージに焼き込み済み（`.docker/Dockerfile`、`PLAYWRIGHT_VERSION` = `@playwright/test` の版）。`playwright install` は不要で、CDN は firewall で不達。
- `pnpm dev`（5173）とは別ポートなので同居できる。
- CI では回さない（`playwright.config.ts` 冒頭の理由）。`pnpm check` が spec の型だけ CI で見る。merge 前にここで流す。
- 失敗時は `test-results/` に trace（`retain-on-failure`）。ホストで `pnpm exec playwright show-trace test-results/<...>/trace.zip`。

## 詰まったら

| 症状 | 原因 |
|---|---|
| `D1_ERROR: no such table` | `--persist-to .wrangler/e2e` が server か helper のどちらかで外れている（両方が同じ dir を見ること） |
| `Executing inline script violates CSP` | `vite dev` に向いている。ビルド成果物を配信すること |
| verify が `challenge_mismatch`、begin は 200 | `ORIGIN` と `baseURL` の不一致（scheme / host / port）。`dist/kokemusu/.dev.vars` が残っていないか |
| 全 POST が 403 `csrf_origin_mismatch` | 同上（`ORIGIN` が 5273 のまま = `.dev.vars` が効いている） |
| 接続はできるが応答が来ない | `--ip 127.0.0.1` が外れている（localhost bind はコンテナで止まる）か、`ratelimits` が config に残っている |
| `Executable doesn't exist at .../chromium-XXXX` | image の Chromium と `@playwright/test` の版ずれ。`docker-compose.yml` の `PLAYWRIGHT_VERSION` と揃えて rebuild |
| あるリクエストの **次** が 500 `Network connection lost` になり、直後に `wrangler dev` が `✘ [ERROR]` で exit する | 直前のリクエストが **body 付きなのに Worker が body を読まずに応答した**（例: セッション門で 401、CSRF で 403）。wrangler dev の proxy（ProxyWorker → user worker の keep-alive）が壊れる。4.125.0 / 4.128.0 で実測（2026-09-02）、本番の runtime では起きない。**spec の規約: body を読む前に拒否されるリクエストには body を付けない**（Worker は変えない） |
| 新しく足した UI / spec **だけ**が「要素が見つからない」で落ちる（他は green） | 前のセッションの `pnpm e2e:server` が生き残り、`reuseExistingServer: true` が**古いビルド**を掴んでいる。`ss -tlnp \| grep 5183` で workerd を見つけて親の `wrangler dev` ごと kill → 次の `pnpm e2e` が作り直す（2026-09-03 実測） |
| Chromium が起動しない（sandbox） | `DEVCONTAINER` が無い環境。コンテナ内で流すか、ホストなら Playwright の Chromium を `playwright install` |
| 単独では通る spec が `pnpm e2e`（全 spec）だと at-rest の件数検査（`toHaveLength(1)` 等）で落ちる | 4 spec は **1 つの sqlite を共有**する（global-setup のリセットは 1 回だけ、以後は積み上がる。登録も「既存 user にパスキーを足す」で通る）。`WHERE kind = 'input'` のような形の条件は前の spec の行も拾う → 自分が作った行の `id` で引く（2026-09-05、当時のゴールデンパスが見出し付き苔片を残すようになって PAT spec の `WHERE title IS NOT NULL` が落ちた。見出しは ADR-0006 で消えたが教訓は同じ） |
