# タスク間の契約

状態: **下書き**(チームの確認前)。API の形の正は `concept-design/api/openapi.yaml`。ここには、実装のタスク間でやりとりする関数・型・規則だけを書く。変えたくなったら、変えずに報告する。

## API 側

### 1. 接頭辞と応答
- すべての経路は `/api` の下(`openapi.yaml` の `servers: /api`)。`app.ts` が `basePath('/api')` で載せる。
- エラーは `application/problem+json` の `{ code, message, field? }`(API-15)。標準の項目(type・title・status・detail)は使わない。`field` は 400 のときだけで、誤っている項目 1 つ。
- 使うコード: `invalid_input`、`unauthorized`、`not_found`、`label_not_found`、`label_title_taken`、`label_in_use`、`landmark_in_use`、`out_of_venue`、`not_stamp_owner`、`too_many_requests`、`payload_too_large`、`footprint_unavailable`、`internal_error`。ステータスと使い分けは openapi の各操作に従う。
- 共通関数: `problem(c, status, code, message, field?)`(`lib/errors.ts`)。

### 2. ID・時刻
- ID は UUID v4(`newId()` = `crypto.randomUUID()`)。最初に入れるデータの slug(`kougi` など)は、そのまま ID にしてよい。削除した ID は再び使わない。
- 時刻は ISO 8601 の UTC 文字列。`nowIso(env)`(`lib/time.ts`)から取る。テストでは固定できる(`env.NOW` があればそれを返す)。

### 3. 変更の履歴(`changes`)と配信
```ts
// api/src/lib/changes.ts
export type ChangeType = 'stampPressed'|'stampRetracted'|'placeAdded'|'placeUpdated'|'placeRemoved'|'appVersionChanged'
export interface ChangeEvent { id: number; type: ChangeType; payload: unknown; createdAt: string }
// 本体の更新(stmts)と changes への追記を、1 回の D1 batch で行い、続けて Hub に publish する。
// publish の失敗は、リクエストを失敗にしない(接続中の端末は、つなぎ直しで続きを受け取る)。
export async function commitWithChange(
  env: Env, stmts: D1PreparedStatement[],
  change: { type: ChangeType; payload: unknown } | { type: ChangeType; payloadSql: { sql: string; params: unknown[] } },
  ctx?: { waitUntil(p: Promise<unknown>): void }
): Promise<{ changeId: number; payload: unknown }>
```
- 固定の `payload` は従来通り渡せる。更新後の DB 値から本文を作る場合は、代わりに JSON 文字列を返す `payloadSql: { sql, params }` を渡す。同じ batch の最後に `INSERT INTO changes (type, payload, created_at) SELECT ?, (<sql>), ? RETURNING payload` を実行し、bind 順は `type, ...params, createdAt`。
- `payloadSql.sql` は SQL に文字列展開されるため、呼び出し側は固定リテラルだけを渡し、値は必ず `params` で bind する。`json_group_array` などで作る配列の並びは SQL の `ORDER BY` で明示する。SQL が NULL を返す場合は `changes.payload` の NOT NULL 制約で batch 全体が失敗し、`stmts` の更新もロールバックされる。
- この SELECT 内の `last_insert_rowid()` は、`stmts` の最後の INSERT の行を指す。最後が `place_labels` などの子テーブルへの INSERT なら親の行は指さない。親の行を参照したい場合は INSERT の並びに注意するか、SQL 内で親の ID を明示して参照する。
- `payloadSql` の場合は D1 batch の最終結果の `results[last].results[0].payload` を `JSON.parse` し、Hub の `ChangeEvent.payload` と戻り値の `payload` に使う。batch 後の読み戻しクエリは行わない。固定の場合の戻り値の `payload` は渡した値。`ctx` があれば publish を `ctx.waitUntil` に渡し、なければ完了を待つ。publish の失敗でリクエストを失敗にしない。
- `payload` の形は `openapi.yaml` の `/changes` の説明に従う。`stampPressed` に `proof` を含めない。
- cursor は `changes` の最大の id を文字列にしたもの。`GET /places`・`GET /stamps` は、一覧と同じ時点の値を返す。
- Hub: Worker の `GET /api/changes` は Hub(Durable Object。`idFromName('main')`)へ渡す。発行は Hub の `POST /publish`(本文は `ChangeEvent`)。接続中の端末に `id: <id>\nevent: <type>\ndata: <payload>` で流す。合図(`: ping`)は 30 秒以内の間隔で送る。

### 4. 認可・制限
- `requireOperator`(`middleware/access.ts`): 運営の操作に付ける。通れば `c.get('actor')` に `{ email }` が入る。通れなければ 401 `unauthorized`。`ACCESS_BYPASS=true` のときだけ検証を迂回する(開発・テスト。本番に設定しない)。基盤は空の実装、本実装は A-12。
- `rateLimit({ key, limit, windowSec })`(`middleware/ratelimit.ts`): 基盤は何もしない実装、本実装は A-13。値は API-18・API-21(読み取りは 1 分に 60 回、スタンプは 1 分に 5 個、本文は 1 MB)。
- 来場者の操作は認証なし。押した人・通信元・地点をログに残さない(API-19)。

### 5. 設定(`config.ts`。基盤が置く)
`CONGESTION_TTL_MIN = 30`(仮置き。OQ-4・D-022)、`CLOSING_TIME`(感想スタンプの期限の基準。開場 10:00〜16:00 を仮置き)、`VENUE_BOUNDS`(会場の範囲。`ORIGIN` = 緯度 37.4252・経度 138.7788 の周囲を仮置き)。値は変えやすく、テストから上書きできる。

## Web 側

### 6. 共有の型(`web/src/types.ts`。基盤が置く)
`Place`・`PlaceKind`・`Stamp`・`StampKind`・`PressedStamp`・`Landmark`・`FloorPlan`・`Label` は、openapi から生成した型の再 export。加えて端末の型:
```ts
export interface Position { lat: number; lng: number; accuracy: number; takenAt: number }
export interface Destination { placeId: string }
export interface FilterState { labelIds: string[]; tagIds: string[] }   // 種類は OR、自分用タグは AND(D-012・D-016)
export interface MyTag { id: string; title: string; builtin: boolean }  // 最初からある 2 つは builtin
```

### 7. 座標
緯度経度は WGS84。端末の中の計算は、`web/src/domain/geo.ts` の `toXY(lat, lng)`(東が +x、北が +y。単位はメートル)と `fromXY`、`ORIGIN`(基盤が PR #4 の値で実装。他のタスクは変えない)。地図(M-01)と AR(R-01)は、同じ `toXY` を使う。

### 8. 端末内保存(IndexedDB。W-02 が実装)
DB 名 `nasvi`、版 1。ストア: `tags`(`MyTag`)、`tagLinks`(`{placeId, tagId}`)、`destination`(キー `current`)、`filter`(キー `current`)、`proofs`(`{stampId, proof, expiresAt}`)、`cache`(キー `places|stamps|landmarks|labels`、値と cursor)、`meta`(キーと値。方位の補正など)。使えないときはメモリで動く。

### 9. 地図の層(型は `web/src/map/layers/types.ts`、`project` の型 `ProjectFn` は `web/src/map/core/types.ts`。基盤が置く)
```ts
export interface View { fx: number; fy: number; k: number; th: number; cy: number }
export interface MapState { places: Place[]; stamps: Stamp[]; landmarks: Landmark[]; position: Position|null; destination: Destination|null; filter: FilterState; now: number }
export interface Layer { name: string; draw(ctx: CanvasRenderingContext2D, view: View, state: MapState, t: number): void; hitTest?(x: number, y: number): { kind: 'place'|'building'; id: string }|null }
// project は `web/src/map/core/` に M-01 が実装する(型 ProjectFn は基盤が置いた)
export function project(view: View, W: number, H: number, x: number, y: number, z?: number): [number, number, number]  // [X, Y, 奥行き]
```
`layers/index.ts` は、各層(buildings・labels・route・me・stamps)を、この順に読み込む。各層は自分のファイルだけを置き換える。

### 10. 画面(`views/`)
`screens.yaml` の画面ごとに 1 ファイル(基盤が空で置く)。担当タスクが、そのファイルを置き換える。経路は `router/index.ts`(基盤)が全部登録済みで、画面のタスクは触らない。
