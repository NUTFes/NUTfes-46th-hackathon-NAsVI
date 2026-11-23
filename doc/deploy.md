# デプロイの準備と人が行う手順（D-01）

このタスクは設定・手順・オフライン検査まで。以下の Cloudflare 操作は、人が D-02 / D-03 で実施する。現在のリポジトリはプレースホルダのままで、公開できる状態ではない。認証・リモート D1 操作・デプロイはこのタスクでは実行しない。

## 設定の対応

| 設定 | production | preview |
| --- | --- | --- |
| Worker 名 | `nasvi-api-production` | `nasvi-api-preview` |
| D1 名 / binding | `nasvi-production` / `DB` | `nasvi-preview` / `DB` |
| D1 ID | `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID` | `REPLACE_WITH_PREVIEW_D1_DATABASE_ID` |
| Access チームドメイン | `REPLACE_WITH_PRODUCTION_ACCESS_TEAM_DOMAIN` | `REPLACE_WITH_PREVIEW_ACCESS_TEAM_DOMAIN` |
| Access AUD | `REPLACE_WITH_PRODUCTION_ACCESS_AUD` | `REPLACE_WITH_PREVIEW_ACCESS_AUD` |
| Durable Object | `HUB` → 同じ Worker の `Hub` | `HUB` → 同じ Worker の `Hub` |

ルートの設定は既存のローカル開発用。環境を省略するとそちらを使うため、公開用の操作には必ず `--env production` または `--env preview` を付ける。既存の `pnpm --filter api migrate` は `--local` 専用で、リモート DB を更新しない。

Wrangler の D1・DO binding・vars は環境ごとに明示する。両環境の `migrations` に `v1` / `new_sqlite_classes: ["Hub"]` を置き、無料プラン用の SQLite DO として作成する。Worker 名が違うので Hub の名前空間も別になり、D1 と接続先を共有しない。`script_name` で他環境を参照しない。これは DO の作成履歴であり、`api/migrations/` の D1 SQL とは別。公開後は適用済みの DO タグを変更せず、変更時に新しいタグを追加する。

公開環境では `ENABLE_DEV_EMIT=false`、`ACCESS_BYPASS` は設定しない。Access を経由しない入口を作らないよう `workers_dev=false` / `preview_urls=false` としている。これは Worker 自身のプレビュー URL の設定で、Pages の PR プレビューとは別。

## アカウント・D1（人が実施）

- [ ] Cloudflare アカウント、対象 DNS ゾーン、Pages / Workers / D1 / SQLite Durable Objects の利用権限と無料枠を確認する。
- [ ] 人が Cloudflare の画面または認証済み端末で、本番用・プレビュー用の D1 を別々に作成する。CLI の場合はリポジトリ直下で次を実行する。

  ```sh
  corepack pnpm --filter api exec wrangler d1 create nasvi-production
  corepack pnpm --filter api exec wrangler d1 create nasvi-preview
  ```

- [ ] 作成結果の ID とアカウント ID は秘密管理先に保存し、コミットしない。リモート操作時だけ、配布する設定のコピーに対象環境の ID を注入する。コピーは既存の ignore 対象である `api/.wrangler/deploy/wrangler.jsonc` に置き、`main` を `../../src/index.ts`、`migrations_dir` を各環境とも `../../migrations` にする（パスは設定ファイルからの相対）。実値入りコピーは終了後に削除する。
- [ ] 自動化する場合の資格情報は対象アカウント・必要なリソースに限定し、`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を CI の secrets に登録する。設定・ログ・ドキュメントに実値を書かない。この変更にはリモート操作の workflow は含めていない。

## D1 マイグレーション（人が実施）

`package.json` は変更しない。次の Wrangler コマンドを適用手順とする。`api/` に移動し、実値を注入した一時設定を `./.wrangler/deploy/wrangler.jsonc` に用意してから実行する。ignore 対象でも git add を強制せず、操作後に削除する。

- [ ] 環境と D1 の対応、`api/migrations/` の SQL をレビューする。既存 DB は先にバックアップを確保する。
- [ ] プレビューの未適用一覧を確認し、適用後にもう一度一覧を確認する。

  ```sh
  corepack pnpm exec wrangler d1 migrations list DB --env preview --remote --config ./.wrangler/deploy/wrangler.jsonc
  corepack pnpm exec wrangler d1 migrations apply DB --env preview --remote --config ./.wrangler/deploy/wrangler.jsonc
  corepack pnpm exec wrangler d1 migrations list DB --env preview --remote --config ./.wrangler/deploy/wrangler.jsonc
  ```

- [ ] プレビューの動作確認後、人が本番への適用を承認し、本番について同じ順序で実行する。

  ```sh
  corepack pnpm exec wrangler d1 migrations list DB --env production --remote --config ./.wrangler/deploy/wrangler.jsonc
  corepack pnpm exec wrangler d1 migrations apply DB --env production --remote --config ./.wrangler/deploy/wrangler.jsonc
  corepack pnpm exec wrangler d1 migrations list DB --env production --remote --config ./.wrangler/deploy/wrangler.jsonc
  ```

- [ ] 未適用がないことを確認してから Worker を更新する。D1 の適用は `wrangler deploy` に含まれない。適用は環境ごとに直列で行い、失敗時は公開を止める。既存の SQL を書き換えて再適用しない。
- [ ] 一時設定を削除し、git diff / git status に実値や生成物がないことを確認する。

コマンドを短縮する必要が出た場合、統合担当が `api/package.json` に `migrate:preview` / `migrate:production` を追加できる。内容はそれぞれ `wrangler d1 migrations apply DB --env preview --remote` / `wrangler d1 migrations apply DB --env production --remote`（実値を注入した設定を `--config` で渡す）。D-01 では追加しない。

## Pages・Workers の公開準備（D-02、人が実施）

- [ ] Pages を GitHub リポジトリに連携し、本番ブランチ `main` と PR プレビューを設定する（T2）。本タスクでは連携や自動デプロイを有効化しない。
- [ ] Node `22.22.1` / pnpm `10.32.1`、ビルドルートをリポジトリ直下、ビルドを `corepack pnpm install --frozen-lockfile && corepack pnpm --filter web build`、出力を `web/dist` にする。
- [ ] SPA の深い URL（`/admin/` を含む）を直接開いても表示できること、HTTPS で配信されることを確認する。
- [ ] 本番とプレビューの Worker に環境ごとの D1 / Hub / Access 値を設定する。Workers の公開コマンドには必ず対応する `--env` と実値を注入した `--config` を指定する。両環境への D1 適用を別途行う。
- [ ] Pages の `/api/*` を対応する Worker に接続する経路・ドメインを決め、実装して検証する。現在の Web は同一オリジンの `/api` を使い、Vite の proxy は開発時だけ有効。本番用の経路は未設定。`VITE_API_BASE` を別オリジンに変えるだけでは、CORS と Access 認証の問題は解決しない。
- [ ] PR ごとの Pages URL と API の対応・データ分離を決める。現在の `preview` は単一の Worker / D1 / Hub であり、PR ごとの独立環境は自動生成しない。本番 DB をプレビューにつながない。
- [ ] API の `main` push / PR デプロイの連携を人が別途用意する。今回追加する workflow は設定検査だけで、`wrangler deploy` の実行は必ず `--dry-run` 付き。

## Access（D-03、人が実施）

- [ ] 本番・プレビューの双方で `/admin/*` と `/api/admin/*` を対象にした Access アプリケーションを作り、実行委員のメールだけを許可する。`/admin` 自体や Pages の別名 URL / プレビュー URL から保護を迂回できないことも確認する。
- [ ] チームドメイン（`https://` やパスを含まないホスト名）と API が受け入れる AUD を環境ごとに設定する。Web と API へのログイン・JWT の受け渡しを確認する。`ACCESS_BYPASS` は公開環境に設定しない。
- [ ] **公開前の要解決事項:** 現在の更新 API は `/api/places`、`/api/labels`、`/api/landmarks` などで、`/api/admin/*` 配下ではない。`requireOperator` は JWT を検証するが、Access の対象パスだけでは JWT の付与まで保証できない。契約やルートを D-01 で変えず、D-03 で実際の操作に JWT が届く構成を確認する。公開の GET / SSE は来場者が認証なしで利用できることも確認する。
- [ ] 未ログイン・許可外の人の管理操作が拒否され、許可された実行委員の操作だけが成功することを両環境で確認する。直通 URL・Pages の別名からも同じ結果になることを確認する。

## 認証なしの検証

`.github/workflows/deploy-config-check.yml` は PR / 手動起動で、環境・ID・開発機能の設定を検査し、両環境を dry-run する。UUID・長い ID / トークンらしい文字列も grep で調べる（既存のローカル DB のゼロ UUID とプレースホルダだけを除外）。実値を注入した設定はこの検査に入れない。検査は秘密情報の網羅的な検知を保証するものではない。

GitHub の checkout・ランタイム準備・キャッシュ復元の後は、ネットワーク名前空間で外部通信を遮断し、資格情報を渡さずに `pnpm install --offline --frozen-lockfile --ignore-scripts` と dry-run を実行する。依存キャッシュは既存の `ci.yml` と共有する。キャッシュ未作成・不足時は外部へ取得せず失敗するので、人が既存 CI のキャッシュを準備してから再実行する。テレメトリは無効で、Cloudflare secrets は一切参照しない。

Linux で依存がローカルにある場合の検証例（リポジトリ直下、外部ネットワークなし）:

```sh
unshare --user --map-current-user --net env -i PATH="$PATH" COREPACK_ENABLE_NETWORK=0 WRANGLER_SEND_METRICS=false CI=true \
  XDG_CONFIG_HOME=/tmp/claude-1000/scratch-d01-out/config \
  WRANGLER_LOG_PATH=/tmp/claude-1000/scratch-d01-out/logs \
  corepack pnpm --filter api exec wrangler deploy --dry-run --env production --outdir /tmp/claude-1000/scratch-d01-out/production
unshare --user --map-current-user --net env -i PATH="$PATH" COREPACK_ENABLE_NETWORK=0 WRANGLER_SEND_METRICS=false CI=true \
  XDG_CONFIG_HOME=/tmp/claude-1000/scratch-d01-out/config \
  WRANGLER_LOG_PATH=/tmp/claude-1000/scratch-d01-out/logs \
  corepack pnpm --filter api exec wrangler deploy --dry-run --env preview --outdir /tmp/claude-1000/scratch-d01-out/preview
```

依存が worktree にない場合は、ソースと lockfile を上記 scratch 配下へ複写し、ローカルキャッシュからオフラインで依存を復元して同じ検証を行う。生成物は worktree に残さない。dry-run はバンドルと設定の検査であり、D1 ID の存在、SQL のリモート適用、Pages の経路、Access の動作や無料枠を検証しない。
