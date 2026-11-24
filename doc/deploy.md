# デプロイの準備と人が行う手順（D-01）

このタスクは設定・手順・認証なしの dry-run 検査まで。以下の Cloudflare 操作は、人が D-02 / D-03 で実施する。現在のリポジトリはプレースホルダのままで、公開できる状態ではない。認証・リモート D1 操作・デプロイはこのタスクでは実行しない。

## 設定の対応

| 設定 | production | preview |
| --- | --- | --- |
| Worker 名 | `nasvi-api-production` | `nasvi-api-preview` |
| D1 名 / binding | `nasvi-production` / `DB` | `nasvi-preview` / `DB` |
| D1 ID | `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID` | `REPLACE_WITH_PREVIEW_D1_DATABASE_ID` |
| Access チームドメイン | `REPLACE_WITH_PRODUCTION_ACCESS_TEAM_DOMAIN` | `REPLACE_WITH_PREVIEW_ACCESS_TEAM_DOMAIN` |
| Access AUD | `REPLACE_WITH_PRODUCTION_ACCESS_AUD` | `REPLACE_WITH_PREVIEW_ACCESS_AUD` |
| OSM 連絡先 | `REPLACE_WITH_PRODUCTION_OSM_CONTACT` | `REPLACE_WITH_PREVIEW_OSM_CONTACT` |
| Durable Object | `HUB` → 同じ Worker の `Hub` | `HUB` → 同じ Worker の `Hub` |

**`--env` の付け忘れに注意:** ルートの設定は既存のローカル開発用で、既定値が `ENABLE_DEV_EMIT=true`。環境を省略するとそちらを使うため、本番・プレビューへの操作には必ず `--env production` または `--env preview` を付ける。既存の `pnpm --filter api migrate` は `--local` 専用で、リモート DB を更新しない。

Wrangler の D1・DO binding・vars は環境ごとに明示する。両環境の `migrations` に `v1` / `new_sqlite_classes: ["Hub"]` を置き、無料プラン用の SQLite DO として作成する。Worker 名が違うので Hub の名前空間も別になり、D1 と接続先を共有しない。`script_name` で他環境を参照しない。これは DO の作成履歴であり、`api/migrations/` の D1 SQL とは別。公開後は適用済みの DO タグを変更せず、変更時に新しいタグを追加する。

公開環境では `ENABLE_DEV_EMIT=false`、`ACCESS_BYPASS` は設定しない。公開ホスト以外の入口を作らないよう `workers_dev=false` / `preview_urls=false` としている。これは Worker 自身のプレビュー URL の設定で、Pages の PR プレビューとは別。

## 必要な変数の一覧

production・preview それぞれの `vars` に次を設定する。リポジトリにはプレースホルダだけを置き、公開時の一時設定で実値に置き換える。

| 変数 | 用途 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Access のチームドメイン（`https://` やパスを含まないホスト名） |
| `ACCESS_AUD` | API が受け入れる Access アプリケーションの AUD |
| `OSM_CONTACT` | OSM へのリクエストの User-Agent に含める運営の連絡先。未設定・空文字だと `contact: unset` になるため、公開時は有効な連絡先が必須 |

加えて `ENABLE_DEV_EMIT` は両環境とも `false` に固定する。`VENUE`（会場情報）・`CLOSING_TIME` 等は環境変数ではない。会場座標・範囲は `api/src/config.ts` の `ORIGIN` / `VENUE_BOUNDS`、終了時刻は同ファイルの `CLOSING_TIME` で定義する。

## アカウント・D1（人が実施）

- [ ] Cloudflare アカウント、対象 DNS ゾーン、Pages / Workers / D1 / SQLite Durable Objects の利用権限と無料枠を確認する。
- [ ] 人が Cloudflare の画面または認証済み端末で、本番用・プレビュー用の D1 を別々に作成する。CLI の場合はリポジトリ直下で次を実行する。

  ```sh
  corepack pnpm --filter api exec wrangler d1 create nasvi-production
  corepack pnpm --filter api exec wrangler d1 create nasvi-preview
  ```

- [ ] 作成結果の ID とアカウント ID は秘密管理先に保存し、コミットしない。リモート操作時だけ、配布する設定のコピーに対象環境の ID を注入する。コピーは既存の ignore 対象である `api/.wrangler/deploy/wrangler.jsonc` に置き、`main` を `../../src/index.ts`、`migrations_dir` を各環境とも `../../migrations` にする（パスは設定ファイルからの相対）。実値入りコピーは終了後に削除する。
- [ ] 自動化の資格情報は対象アカウント・必要なリソースに限定し、下記の Environment secret / 変数に登録する。設定・ログ・ドキュメントに実値を書かない。

## D1 マイグレーション（人が実施）

`package.json` は変更しない。次の Wrangler コマンドを適用手順とする。`api/` に移動し、実値を注入した一時設定を `./.wrangler/deploy/wrangler.jsonc` に用意してから実行する。ignore 対象でも git add を強制せず、操作後に削除する。

- [ ] 環境と D1 の対応、`api/migrations/` の SQL をレビューする。既存 DB は先にバックアップを確保する。
- [ ] プレビューの未適用一覧を確認し、適用後にもう一度一覧を確認する。

  ```sh
  corepack pnpm exec wrangler d1 migrations list DB --env preview --remote --config ./.wrangler/deploy/wrangler.jsonc
  corepack pnpm exec wrangler d1 migrations apply DB --env preview --remote --config ./.wrangler/deploy/wrangler.jsonc
  corepack pnpm exec wrangler d1 migrations list DB --env preview --remote --config ./.wrangler/deploy/wrangler.jsonc
  ```

- [ ] プレビューの動作確認後、人が本番への適用を承認する。適用直前に `date -u` で UTC の復旧時刻を記録する（[D1 のロールバック](#d1-のロールバック人が実施d1-time-travel-前提)参照）。本番について同じ順序で実行する。

  ```sh
  corepack pnpm exec wrangler d1 migrations list DB --env production --remote --config ./.wrangler/deploy/wrangler.jsonc
  corepack pnpm exec wrangler d1 migrations apply DB --env production --remote --config ./.wrangler/deploy/wrangler.jsonc
  corepack pnpm exec wrangler d1 migrations list DB --env production --remote --config ./.wrangler/deploy/wrangler.jsonc
  ```

- [ ] 未適用がないことを確認してから Worker を更新する。D1 の適用は `wrangler deploy` に含まれない。適用は環境ごとに直列で行い、失敗時は公開を止める。既存の SQL を書き換えて再適用しない。
- [ ] 一時設定を削除し、git diff / git status に実値や生成物がないことを確認する。

コマンドを短縮する必要が出た場合、統合担当が `api/package.json` に `migrate:preview` / `migrate:production` を追加できる。内容はそれぞれ `wrangler d1 migrations apply DB --env preview --remote` / `wrangler d1 migrations apply DB --env production --remote`（実値を注入した設定を `--config` で渡す）。D-01 では追加しない。

## D1 のロールバック（人が実施、D1 Time Travel 前提）

以下は復旧手順だけを記載し、このタスクでは実行しない。事前に対象 DB の Time Travel の利用可否と復元可能期間を確認し、マイグレーション直前の時刻を UTC で記録する。障害時は公開・更新操作を止め、対象環境・DB・復元時刻を確認する。復元時刻以降の書き込みは失われるため、人が復元範囲を確認してから進める。

`api/` で実値を注入した一時設定を用意し、`RESTORE_TIMESTAMP` に復元可能期間内の障害前の時刻（RFC3339、UTC）を指定する。まず `info` で復元地点を確認し、その後 `restore` を実行する。対象環境の組だけを使う。

```sh
# preview
corepack pnpm exec wrangler d1 time-travel info DB --env preview --timestamp "$RESTORE_TIMESTAMP" --config ./.wrangler/deploy/wrangler.jsonc
corepack pnpm exec wrangler d1 time-travel restore DB --env preview --timestamp "$RESTORE_TIMESTAMP" --config ./.wrangler/deploy/wrangler.jsonc

# production
corepack pnpm exec wrangler d1 time-travel info DB --env production --timestamp "$RESTORE_TIMESTAMP" --config ./.wrangler/deploy/wrangler.jsonc
corepack pnpm exec wrangler d1 time-travel restore DB --env production --timestamp "$RESTORE_TIMESTAMP" --config ./.wrangler/deploy/wrangler.jsonc
```

復元後はデータ・スキーマ・マイグレーション履歴と Worker の互換性を確認し、必要なら対応する Worker バージョンへ戻す。D1 Time Travel は Worker や Hub の状態を戻さない。両環境の動作確認後に公開・更新を再開し、一時設定を削除する。

## Pages・Workers の公開準備（D-02、人が実施）

- [ ] Pages を GitHub リポジトリに連携し、本番ブランチ `main` と PR プレビューを設定する（T2）。本タスクでは連携や自動デプロイを有効化しない。
- [ ] Node `22.22.1` / pnpm `10.32.1`、ビルドルートをリポジトリ直下、ビルドを `corepack pnpm install --frozen-lockfile && corepack pnpm --filter web build`、出力を `web/dist` にする。
- [ ] SPA の深い URL（`/admin/` を含む）を直接開いても表示できること、HTTPS で配信されることを確認する。
- [ ] 本番とプレビューの Worker に環境ごとの D1 / Hub / Access 値と `OSM_CONTACT` を設定する。Workers の公開コマンドには必ず対応する `--env` と実値を注入した `--config` を指定する。両環境への D1 適用を別途行う。
- [ ] #165 の決定に従い、Web と API は同一オリジンで配信する。workflow は `SITE_HOST/api/*` の Worker route を一時設定に組み立てる。`SITE_HOST` と `ZONE_NAME` は環境ごとに異なり実値をリポジトリに置かないため、`api/wrangler.jsonc` に route を固定しない。DNS / Pages カスタムドメインと route の実際の疎通は人が検証する。Vite の proxy は開発時だけ有効。
- [ ] PR ごとの Pages URL と API の対応・データ分離を決める。現在の `preview` は単一の Worker / D1 / Hub であり、PR ごとの独立環境は自動生成しない。本番 DB をプレビューにつながない。
- [ ] 下記 workflow の手動デプロイと、Pages の Git 連携が二重に公開しないよう、運用開始前に人が確認する。

## Access（D-03、人が実施）

- [ ] 決定済みの選択肢 D に従い、`/admin/*` だけを保護する。本番・プレビューの双方で Access アプリケーションを作り、実行委員のメールだけを許可する。`/admin` 自体や Pages の別名 URL / プレビュー URL から保護を迂回できないことも確認する。
- [ ] チームドメイン（`https://` やパスを含まないホスト名）と API が受け入れる AUD を環境ごとに設定する。Web と API へのログイン・JWT の受け渡しを確認する。`ACCESS_BYPASS` は公開環境に設定しない。
- [ ] 決定した保護範囲で実際の運営操作に JWT が届き、公開の GET / SSE は来場者が認証なしで利用できることを確認する。
- [ ] 未ログイン・許可外の人の管理操作が拒否され、許可された実行委員の操作だけが成功することを両環境で確認する。直通 URL・Pages の別名からも同じ結果になることを確認する。

## #165 の決定と未決事項

選択肢 D を採用する。Access の保護対象は `/admin/*` のみで、API の認可は API 内の JWT 検証で行う。Web と API は同一オリジンとし、Cookie 経由の JWT は `Sec-Fetch-Site: same-origin` の場合だけ受け入れる。未認証の `GET /api/places` は 200、`POST /api/places` は 401、`GET /admin/` は Access の 302 を期待する。workflow の curl はリダイレクトを追わず、期待値から外れた場合は停止する。

未決: PR ごとの Pages URL と API の対応・データ分離、および `/admin` 自体や Pages 別名 URL の迂回防止の具体的な設定と検証。単一 preview を PR ごとの独立環境とは扱わない。

## 認証なしの検証

`.github/workflows/deploy-config-check.yml` は PR / 手動起動で、環境・ID・開発機能の設定を検査し、両環境を dry-run する。UUID・長い ID / トークンらしい文字列も grep で調べる（既存のローカル DB のゼロ UUID とプレースホルダだけを除外）。実値を注入した設定はこの検査に入れない。検査は秘密情報の網羅的な検知を保証するものではない。

GitHub の checkout・ランタイム準備の後、資格情報なしで通常の `pnpm install --frozen-lockfile` を実行し、必要な依存をネットワークから取得する。既存 CI のキャッシュ準備には依存しない。その後、`env -i` と専用の空の HOME / 設定ディレクトリを使い、`CLOUDFLARE_*` 環境変数・保存済みの認証情報を渡さずに両環境の `wrangler deploy --dry-run` だけを実行する。出力先は runner の一時ディレクトリ。テレメトリは `WRANGLER_SEND_METRICS=false` で無効化し、Cloudflare secrets は一切参照しない。CI 自体をオフラインにする構成ではない。

依存がローカルにある場合の検証例（リポジトリ直下、インストールは実行しない）:

```sh
mkdir -p /tmp/claude-1000/scratch-d01-dry2/home /tmp/claude-1000/scratch-d01-dry2/config
env -i PATH="$PATH" COREPACK_ENABLE_NETWORK=0 WRANGLER_SEND_METRICS=false CI=true \
  HOME=/tmp/claude-1000/scratch-d01-dry2/home \
  XDG_CONFIG_HOME=/tmp/claude-1000/scratch-d01-dry2/config \
  WRANGLER_LOG_PATH=/tmp/claude-1000/scratch-d01-dry2/logs \
  corepack pnpm --filter api exec wrangler deploy --dry-run --env production --outdir /tmp/claude-1000/scratch-d01-dry2/production
env -i PATH="$PATH" COREPACK_ENABLE_NETWORK=0 WRANGLER_SEND_METRICS=false CI=true \
  HOME=/tmp/claude-1000/scratch-d01-dry2/home \
  XDG_CONFIG_HOME=/tmp/claude-1000/scratch-d01-dry2/config \
  WRANGLER_LOG_PATH=/tmp/claude-1000/scratch-d01-dry2/logs \
  corepack pnpm --filter api exec wrangler deploy --dry-run --env preview --outdir /tmp/claude-1000/scratch-d01-dry2/preview
```

ローカルで外部通信を禁止する場合は、依存を事前に用意し、OS 側でも通信を遮断して検証する。ログ・バンドル等の生成物は scratch 配下に置き、worktree に残さない。dry-run はバンドルと設定の検査であり、D1 ID の存在、SQL のリモート適用、Pages の経路、Access の動作や無料枠を検証しない。

## GitHub Actions での自動デプロイ

`.github/workflows/deploy.yml` が、Worker・D1 のマイグレーション・Web(Pages)を、まとめてデプロイする。実値はリポジトリに置かず、GitHub の Secrets と Environments の変数から受け取る(上の「実値を注入した一時設定」と同じ方針。設定ファイルは workflow が実行中に組み立て、コミットしない)。

| 契機 | 動作 |
| --- | --- |
| 手動(Actions の `deploy` → Run workflow) | 環境(`preview` / `production`)を選んで実行する。本番はこちらだけ |
| `impl/main` への push | `preview` だけ。リポジトリの変数 `AUTO_DEPLOY_PREVIEW` が `true` のときだけ動く(既定は止まっている) |

実行の順序は、検査(型・テスト)→ Web のビルド → 設定の組み立て → D1 のマイグレーション → Worker → Pages → 動作確認(読み取りと、認証なしの書き込みが 401 になること)。マイグレーションが失敗すると、Worker は更新されない。

### 登録する値

| 種類 | 名前 | 置く場所 | 内容 |
| --- | --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Environment ごと（別トークン必須） | アカウントの API トークン(Workers・D1・Pages の編集、対象ゾーンの Workers Routes の編集) |
| 変数 | `CLOUDFLARE_ACCOUNT_ID` | リポジトリ | Cloudflare のアカウント ID |
| 変数 | `AUTO_DEPLOY_PREVIEW` | リポジトリ | `true` で、`impl/main` への push の自動デプロイが有効になる |
| 変数 | `D1_DATABASE_ID` | Environment(`preview`・`production` ごと) | その環境の D1 の ID |
| 変数 | `ACCESS_TEAM_DOMAIN` | Environment ごと | Access のチームドメイン(ホスト名だけ) |
| 変数 | `ACCESS_AUD` | Environment ごと | その環境の Access アプリの AUD |
| 変数 | `OSM_CONTACT` | Environment ごと | OSM へのリクエストに含める連絡先 |
| 変数 | `SITE_HOST` | Environment ごと | 公開するホスト名(Worker は `<ホスト名>/api/*` に置く) |
| 変数 | `ZONE_NAME` | Environment ごと | ホスト名が属する Cloudflare のゾーン名 |
| 変数 | `PAGES_PROJECT` | Environment ごと | Pages のプロジェクト名 |

- 設定値の欠落は組み立て時、トークン・アカウント ID の欠落は最初の Wrangler ステップで止まる(Cloudflare には何も送られない)。
- Environment `preview` / `production` の Deployment branches は **`impl/main` だけに限定することが必須**。本番 `production` の **Required reviewers も必須**。手動実行でもこのブランチ制限と承認を通す。
- トークンを持つ workflow は、アカウントの Workers・D1・Pages を操作できる。`.github/workflows/` の変更は、必ず PR のレビューを通す。
- フォークからの PR には、Secrets は渡されない(GitHub の仕様)。
- 初回は、`preview` を手動で実行して、権限のエラーが出ないかを確かめる。足りない権限は、その時点で分かる。

### 環境分離とトークン移行（人が必ず実施）

1. GitHub Settings の Environments で `preview` / `production` を用意し、上記の Deployment branches と Required reviewers を設定する。
2. Cloudflare で環境ごとに別の最小権限トークンを用意し、それぞれの Environment secret `CLOUDFLARE_API_TOKEN` に登録する。Repository secret への保存は不可。既存 secret の値は取得・表示せず、新しいトークンで移行する。
3. 非秘密の比較台帳として Repository variables に、接頭辞 `PREVIEW_` / `PRODUCTION_` を付けた `PAGES_PROJECT`・`SITE_HOST`・`D1_DATABASE_ID` の計6個を登録する。対応する Environment variables と一致させる。環境間では3項目すべて別の値が必須。Environment に比較台帳の同名変数を作らない。
4. 両 Environment の secret と変数を確認後、旧 Repository secret `CLOUDFLARE_API_TOKEN` を削除し、旧共用トークンを失効させる。Repository secret が残ると Environment secret の欠落時にフォールバックするため、削除は必須。preview の手動検証後、本番は Required reviewers の承認を経て実行する。

workflow は台帳の空値・環境間重複・選択先 Environment との不一致で停止し、値は表示しない。Pages は両環境とも `--branch main` で配信するため、同じプロジェクトを指定すると本番を上書きし得る。トークンとアカウント ID は Wrangler の3ステップだけに渡し、install・型検査・テスト・ビルドには渡さない。

本番 D1 の適用直前に UTC の復旧時刻を `date -u` でログに記録する。障害時は [D1 のロールバック](#d1-のロールバック人が実施d1-time-travel-前提) を参照する。この時刻の記録はバックアップ作成や復元可能期間の保証ではない。

D-02 指示書は「人が行う」「main push で本番」「PR にプレビュー URL」を目的としているが、この workflow は手動実行を提供し、本番は手動のみ、`impl/main` push は preview のみで既定停止。PR URL の投稿・PR ごとの環境作成は実装していない。D-02 の完了条件を満たしたとは扱わず、運用差分として管理する。

### Wrangler ログの検証結果

Wrangler 4.124.0 で、資格情報を渡さず、workflow の Python でダミー値の一時設定を組み立て、`wrangler deploy --dry-run --env preview --config` で検証した。binding 一覧に `ACCESS_AUD` と `OSM_CONTACT` の値が表示された。D1 は DB 名が表示され、ID は今回の通常出力には出なかったが、他のコマンドやエラー出力も考慮し、D1 ID も含めた3値を設定組み立て時に `::add-mask::` 登録する。登録は D1 操作・Worker deploy より前に行う。実デプロイ時の出力は未検証。

既存プレースホルダ設定の production / preview の dry-run は両方成功した。ローカルで空の HOME を使う場合、Corepack の pnpm キャッシュも切り替わるため、必要なら `COREPACK_HOME` に既存のパッケージマネージャー専用キャッシュを指定する（認証情報の HOME / 設定ディレクトリは空のまま）。
