# D1 の表の設計(下書き)

作成: 2026-11-23 / 状態: **下書き**(チーム確認前。実装で合わなければ直す)
元: `concept-design/api/openapi.yaml`(PR #32 までの版)、`review-ledger.yaml`、`concepts.yaml`
原則: API の応答は DB の構造と切り離す。ここは、API を満たすための保存の形を決めるだけ。

## 1. 表の一覧

| 表 | 役割 | 出どころ |
|---|---|---|
| `landmarks` | 建物(名前、位置、OSM の輪郭) | `Landmark`、D-019 |
| `floor_plans` | 建物の階ごとの見取り図 | `FloorPlan`、API-29・30 |
| `places` | 場所(企画、駐車場、設備) | `Place`、API-14・28・31 |
| `place_hours` | 場所の開催時間(複数の時間帯) | `Period`、D-020 |
| `labels` | 運営の種類(飲食、展示など) | `Label` |
| `place_labels` | 場所に付いた運営の種類 | `Place.labelIds` |
| `stamps` | スタンプ | `Stamp`、D-021・22、API-17・19・38 |
| `changes` | 変更の履歴。SSE の版の番号(cursor)の元 | `/changes`、API-24・25・42 |
| `meta` | アプリの版など | `appVersionChanged`、API-20 |

端末内に置くもの(現在地、行き先、自分用タグ、絞り込み、自分のスタンプの proof)は、D1 に置かない(D-014・D-021)。

## 2. SQL の下書き

```sql
-- id は Worker が作る不透明な文字列(ULID など)。削除した id は再び使わない(API-31)ので、連番の再利用はしない。

CREATE TABLE landmarks (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  lat           REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng           REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  footprint     TEXT,                 -- 輪郭の頂点の JSON 配列 [{lat,lng},...]。OSM から取れなければ NULL(API-37)
  footprint_at  TEXT                  -- 輪郭を取った時刻(ISO 8601)。取り直しの目安
);

CREATE TABLE floor_plans (
  landmark_id TEXT NOT NULL REFERENCES landmarks(id) ON DELETE CASCADE,
  floor       INTEGER NOT NULL,
  view_box    TEXT NOT NULL,          -- SVG の viewBox
  d           TEXT NOT NULL,          -- SVG の path の d
  north REAL NOT NULL, south REAL NOT NULL, east REAL NOT NULL, west REAL NOT NULL,
  PRIMARY KEY (landmark_id, floor)
);

CREATE TABLE places (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  kind        TEXT NOT NULL CHECK (kind IN ('event','parking','info','wc','rest','trash')),  -- 変更不可(PlacePatch)
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  landmark_id TEXT REFERENCES landmarks(id),   -- 屋外・駐車場は NULL。建物を消す前に場所の付け替えが要る(要確認 Q-D1)
  floor       INTEGER CHECK (floor BETWEEN -5 AND 20),
  updated_at  TEXT NOT NULL,
  CHECK (landmark_id IS NOT NULL OR floor IS NULL)   -- 階は建物の中だけ(API-14)
);
CREATE INDEX places_landmark ON places(landmark_id);
CREATE INDEX places_name ON places(name);

CREATE TABLE place_hours (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,             -- ISO 8601(date-time)
  end_at   TEXT NOT NULL,
  PRIMARY KEY (place_id, start_at)
);

CREATE TABLE labels (
  id    TEXT PRIMARY KEY,
  title TEXT NOT NULL UNIQUE CHECK (length(title) BETWEEN 1 AND 20)   -- 重複不可(API-14)
);

CREATE TABLE place_labels (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,       -- 場所の削除で種類が外れる(release)
  label_id TEXT NOT NULL REFERENCES labels(id),                         -- 付いている種類は消せない(undefine の事前条件)
  PRIMARY KEY (place_id, label_id)
);

CREATE TABLE stamps (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('congestion-1','congestion-2','congestion-3','congestion-4','congestion-5','fun','food','good')),
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  pressed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,           -- 混雑は押した時刻 + 30 分(仮置き、D-022)、感想はその日の閉場
  proof_hash TEXT NOT NULL            -- 取り消しの証(proof)そのものは持たず、ハッシュだけ持つ(推奨)。押した人(by)・通信元は持たない(API-19)
);
CREATE INDEX stamps_expires ON stamps(expires_at);

CREATE TABLE changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,   -- 版の番号。cursor と Last-Event-ID に使う(API-42)
  type       TEXT NOT NULL CHECK (type IN ('stampPressed','stampRetracted','placeAdded','placeUpdated','placeRemoved','appVersionChanged')),
  payload    TEXT NOT NULL,                       -- 出来事の本文(JSON)。stampPressed に proof は入れない(API-25)
  created_at TEXT NOT NULL
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,             -- 例: 'app_version'
  value TEXT NOT NULL
);
```

## 3. 設計の要点

- **書き込みと履歴は、1 回の `batch()` で行う。** 場所やスタンプの登録・更新・削除は、本体の表の更新と `changes` への追記を、同じ D1 の batch(1 つのトランザクション)で行う。履歴だけ抜ける、本体だけ変わる、を避ける。
- **cursor は `changes.id` の最大値。** 一覧(`GET /places`、`GET /stamps`)は、その時点の最大の `id` を cursor として返す。SSE は `id > since` を引いて流す。
- **履歴の保持。** `changes` は古い行を定期的に消す(保持範囲の長さは実装が決める)。範囲外の `since` が来たら `resync` を流す(API-42)。
- **期限切れのスタンプ。** 流さない。端末が `expires_at` から消す(API-38)。D1 側の掃除は、一覧に出さない条件(`expires_at > now`)と、まとめて消す処理で分ける。
- **検索(`Search`)。** 場所の `name`(必要なら `description`)に対する `LIKE` で足りる。場所は数百件程度のため、専用の索引表は持たない。日本語の表記ゆれ(全角・半角、ひらがな・カタカナ)の正規化は、アプリ側で行うかを別に決める。
- **建物の輪郭は JSON の文字列で持つ。** 頂点の数が少なく、点ごとに行を持たせる必要がない。

## 4. 見積もり(仮定つき。実測で直す)

前提: 想定来場者 10000 人(2 日間。前回の実績、OQ-6)。次の仮定は**私の置いたもので、根拠はない**。
- 場所は 100 件、有効なスタンプは同時に 200 件程度。
- 来場者 1 人が、1 日に 3 回アプリを開く。
- スタンプを押すのは来場者の 10%、1 人 5 回。

| 項目 | 概算 | 無料枠(1 日、5,000,000 行読み取り・100,000 行書き込み)との関係 |
|---|---|---|
| 初期表示(`GET /places`・`GET /stamps`)の読み取り | 来場者 5,000 人/日 × 3 回 × 約 300 行 ≒ 450 万行/日 | **無料枠にほぼ達する。** `GET /places` をエッジでキャッシュする(場所の変更は SSE で知らせる)と、大きく減らせる |
| スタンプの書き込み | 1,000 人 × 5 回 × 2 日 ≒ 1 万スタンプ。1 件あたり本体 + 索引 + `changes` の数行 | 1 日 数万行以内。収まる見込み |
| SSE の D1 への問い合わせ | 同時接続 N × (3〜5 秒に 1 回) | 同時接続が数百を超えると、D1 への問い合わせが集中する。**Durable Objects を中継にする設計も、候補に残す** |

→ 結論: 無料プランは、読み取り行数で足りなくなる可能性がある。**有料プラン(Workers Paid)を前提にする**か、`GET /places` のキャッシュを設計に入れる。

## 5. 要確認(台帳に載せる候補)

| # | 質問 | 推し |
|---|---|---|
| Q-D1 | 建物を削除するとき、その建物にある場所をどうするか(外部キーで拒否、場所を屋外に付け替え、連動して削除) | 拒否する(運営に、先に場所を直すよう促す)。API 設計(DELETE /landmarks/{id})の応答に合わせる |
| Q-D2 | `proof` のハッシュ化(SHA-256 など)を採るか | 採る。D1 が流出しても取り消せなくなるだけで済む |
| Q-D3 | `changes` の保持期間(件数か時間か) | 会期(2 日)全体を保持する。件数は数万行の見込み |
| Q-D4 | 場所の ID の形(ULID など) | 時刻順に並ぶ ULID。並べ替えに使える |
| Q-D5 | 日本語の検索の正規化(全角・半角、かな) | 最小限(全角・半角と大文字・小文字)。かなの揺れは P1 では扱わない |

## 6. この下書きが前提にしていること
- 場所と建物の API は、`openapi.yaml`(PR #32 までの版)のとおり。今後の変更に合わせて直す。
- スタンプの期限は仮置き(D-022、OQ-4)。値が変わっても、表の形は変わらない(`expires_at` を計算する側が変わるだけ)。
- D1 の外部キーが標準で有効かと、`batch()` のトランザクションの扱いは、実装の最初に試作で確かめる(私の知識によるもので、現行の公式ドキュメントでは未確認)。
