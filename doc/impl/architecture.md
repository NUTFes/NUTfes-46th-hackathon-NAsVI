# 実装の構成と、並列で衝突しない規則

状態: **下書き**(チームの確認前)。決定の正は `doc/tech-stack.md`。この文書は、その決定を並列で実装するための構成を決める。

## 1. 原則
1. **1 タスク = 1 つの worktree = 1 つのブランチ = 1 つの PR。** 持ち主のファイルが重ならないように分ける(`wbs.yaml` の `owns`)。
2. **共有ファイルを編集してよいのは、基盤タスク(F-2・F-3)だけ。** 以降のタスクは、自分の `owns` だけを編集する。
3. **先に骨組みを置く。** 基盤タスクが、操作ごと・画面ごと・層ごとの「空のファイル」と、それらを読み込む index を作る。並列のタスクは、空のファイルを**置き換える**だけで済み、index を触らない。
4. **契約を先に固定する。** タスク間でやりとりする関数・型・形は `contracts.md` に書く。実装の都合で契約を変えたいときは、変えずに報告する。

## 2. リポジトリの構成(目標)
```
api/                     Cloudflare Workers(Hono)。T3
  src/
    index.ts             export default app; export { Hub }(基盤のみ)
    app.ts               Hono アプリを組み立て、各ルーターを載せる(基盤のみ)
    env.ts               Env の型(基盤のみ)
    config.ts            定数(基盤のみ)
    lib/                 errors.ts ids.ts time.ts db.ts normalize.ts changes.ts(基盤のみ)
    middleware/          access.ts(A-12)  ratelimit.ts(A-13)  ← 基盤が空の実装を置く
    hub/Hub.ts           Durable Object(基盤が雛形から移す。H-01 が直す)
    osm/                 index.ts(基盤が空の実装)  overpass.ts(A-10)
    routes/
      places/            index.ts(基盤)  list.ts create.ts update.ts delete.ts search.ts
      labels/            index.ts(基盤)  list.ts create.ts delete.ts attach.ts
      stamps/            index.ts(基盤)  press.ts list.ts retract.ts
      landmarks/         index.ts(基盤)  crud.ts footprint.ts floors.ts places.ts
      changes.ts         GET /changes(基盤。Hub に渡す)
  migrations/            0001_init.sql(雛形。新しいマイグレーションは基盤だけが足す)
  test/                  helpers.ts(基盤)  ← 各タスクが自分のテストを足す
web/                     Vue 3 + Vite + TypeScript。T1
  src/
    main.ts App.vue router/index.ts types.ts(基盤のみ)
    api/                 W-01
    storage/             W-02
    sync/                cache.ts bootstrap.ts(W-03)  changes.ts(W-04)  orchestrator.ts(W-09)
    stores/              W-05
    domain/              geo.ts(基盤が toXY のみ。W-07)  filter.ts(W-06)  floorplan.ts stamps.ts(W-07)
    services/            position.ts(W-08)  orientation.ts(R-03)
    map/                 core/(M-01)  MapCanvas.vue interaction.ts(M-02)  layers/(types.ts と index.ts は基盤。各層は M-03〜05)
    ar/                  geometry.ts(R-01)  ArView.vue(R-02)
    components/          FilterChips.vue FilterBand.vue(M-06)  PlaceRow.vue(S-01)  FloorPlan.vue(S-07)
    views/               画面ごとに 1 ファイル(基盤が空で置く。S-* が置き換える)  admin/(O-*)
tools/loadtest/          H-02
doc/impl/                この設計書、wbs.yaml、tasks/(指示書)
```

## 3. 共有ファイル(基盤タスクだけが編集する)
`api/src/{index,app,env,config}.ts`、`api/src/lib/**`、各 `routes/*/index.ts`、`api/wrangler.jsonc`(D-01 は環境の節だけ)、`api/migrations/**`、`web/src/{main.ts,App.vue,types.ts}`、`web/src/router/index.ts`、`web/src/map/layers/{types,index}.ts`、各 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`mise.toml`。

**依存パッケージが足りないとき:** 追加しない。報告に書き、統合の担当が基盤に足す。基盤タスクは、全タスクが必要とする分を先に入れる。
**スキーマの変更が要るとき:** マイグレーションを足さない。報告に書く(`doc/d1-schema.md` と整合させて、基盤が直す)。

## 4. ブランチ・worktree・マージの運用
- 土台のブランチ: `feat/impl-base`(雛形の 3 コミット + 設計書 + 基盤 F-2・F-3)。
- タスクのブランチ: `feat/<id を小文字>`(例: `feat/a-01`)。worktree は `~/.herdr/worktrees/NUTfes-46th-hackathon-NAsVI/<id を小文字>`。土台は `feat/impl-base`。
- 統合: ローカルのブランチ `feat/impl-integration` に、完了したタスクのブランチを順に merge し、`corepack pnpm -r typecheck`・`test`・`build` を通す(push しない)。衝突したら、衝突の内容を報告する(自動で解決しない)。
- push・PR・merge は、利用者の指示があるときだけ。

## 5. 波(Wave)
`wbs.yaml` の `wave` と `depends` が正。要約:

| 波 | 内容 | 並列度 |
|---|---|---|
| 0 | F-2(API の基盤)、F-3(Web の基盤)。雛形(#39)は完了 | 2 並列 |
| 1 | API(A-01〜A-13)、Hub(H-01・H-02)、契約テスト(F-4)、Web の土台(W-01〜W-08)、地図の核(M-01)、AR の幾何・方位(R-01・R-03)、デプロイ設定(D-01) | 約 28 並列(実際は同時に走らせる数を絞る) |
| 2 | 同期の取りまとめ(W-09)、地図の層と操作(M-02〜M-06)、AR 画面(R-02)、来場者の画面(S-01〜S-07)、運営の骨格(O-01) | 約 15 並列 |
| 3 | 遷移の結線(S-08)、運営の画面(O-02〜O-05)、人の作業(D-02・D-03・V-01〜V-03) | 約 5 並列 + 人 |

## 6. 標準の検証コマンド
```
corepack pnpm install
corepack pnpm -r typecheck
corepack pnpm --filter api test
corepack pnpm --filter web test
corepack pnpm --filter web build
```
pnpm が無いので `corepack pnpm`(または `npx -y pnpm@10.32.1`)を使う。グローバルのインストールはしない。
