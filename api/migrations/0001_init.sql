-- id は Worker が作る不透明な文字列(UUID v4。Q-D4)。削除した id は再び使わない(API-31)ので、連番の再利用はしない。

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
  search_text TEXT NOT NULL,        -- 検索用に正規化した名前(Q-D5)。name を NFKC 正規化して小文字にしたもの。Worker が登録・更新のときに作る
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
