# 用語集(ステップ 1)

状態: 言葉は確認済(2026-11-22、looky-looky)。API の列は API 設計(#15)で変わりうる / 作成: 2026-11-21

同じものを、概念設計・画面・API で同じ言葉にそろえるための表。「画面の言葉」は来場者が見る言葉。API の名前は `concept-design/api/actions.generated.md` の要求名(仮の値)。

## 用語

| 概念設計 | 画面の言葉(来場者が見る) | API の要求名 | 使わない言い方 | 備考 |
|---|---|---|---|---|
| Place | 場所 / 企画(企画のときだけ)| showPlaces | 店舗、スポット | 種別は 企画・駐車場・設備(D-017) |
| Place.kind = 設備 | 設備(案内所・トイレ・休憩所・ゴミ箱) | showPlaces | 施設 | 概念に入った(D-017)。検索・絞り込みの対象にしない |
| Search | 検索、探す | search(searchNatural は拡張) | 検索する場所 | 検索窓の言葉は「企画・場所を検索」 |
| Labeling(運営が付ける) | 種類(飲食・展示・体験・ステージ) | browse、applyFilter、clearFilter | カテゴリ、ジャンル | |
| Labeling(来場者が付ける) | タグ(行きたい場所・お気に入り・自作のタグ) | なし(端末の中で行う。D-014) | ラベル、ブックマーク | 要求名 markPlace・unmarkPlace・defineMyTag は概念設計にはあるが、API には載せない |
| Labeling.filtering | 絞り込み、絞り込み中、解除 | (applyFilter・clearFilter。端末の中) | フィルター | 検索結果にも効く(D-012) |
| Position | 現在地、位置の利用、精度 | allowLocation、refuseLocation、reportPosition、setPosition | GPS、自分の場所 | 「地図で指定」は OQ-2 |
| Destination | 行き先、ここへ向かう、案内、案内をやめる | chooseDestination、showRoute | 目的地、ナビ | 方角と直線距離だけ(D-003) |
| Stamp | スタンプ、混雑(1〜5)、感想(面白い・美味しい・よさ)、押す、取り消す | pressStamp、retractStamp、showStamps | 口コミ、評価 | |
| Landmark | 建物 | recognizeBuilding、showBuildingEvents、showLandmarks、reloadFootprint | ランドマーク、棟(建物の名前の中だけで使う) | 「この建物」「この建物の企画」。正面の建物は、現在地・向き・建物の輪郭で決める(D-018)。内部の名前は Landmark のまま(下の表) |
| (見せ方の設定)| 表示する印 | なし | レイヤー | 概念にしない |
| 建物と階・見取り図 ※ | 建物の中の地図、階 | (showPlaces を建物と階で絞る) | フロアマップ | 建物と階は概念に入った(D-017)。見取り図を概念にするかは未決(OQ-14) |

## 内部の名前と、画面の言葉・部品の名前(D-020)

概念設計と API は内部の名前、画面は来場者の言葉、部品は画面の言葉の英語にそろえる。

| 内部の名前(概念設計・API) | 画面の言葉 | 部品の名前 | 備考 |
|---|---|---|---|
| Landmark(API は `landmarks`) | 建物 | `Building*`(BuildingFlag、BuildingFloorTabs、BuildingFloorPlan、BuildingCameraOverlay、BuildingShapePreview) | 名前は Landmark のまま(D-020)。部品の props も API と同じ `landmarkId` にする(BuildingFlag) |
| Place.building(Landmark の id。API は `landmarkId`) | 建物(「総合研究棟 2階」) | PlaceRow・PlaceCard の `building` | 部品には建物の名前(表示用の文字列)を渡す |
| Place.floor(数。1 = 1 階、地下は負) | 階(「2階」) | PlaceRow・PlaceCard の `floor`、BuildingFloorTabs | 部品には「2階」の形で渡す |
| Place.hours(開始と終了の組、複数可) | 開催時間(「両日 10:00〜16:00」) | PlaceCard の `hours` | 部品には表示用の文字列を渡す(D-020) |
| Landmark.footprint(輪郭) | 建物の形 | BuildingShapePreview の `shape`、BuildingCameraOverlay | OpenStreetMap を正にする(D-019) |
| Stamp.proof(取り消しの証) | (画面には出さない) | MyStampRow・Toast の取り消し | 押した端末だけが持つ(D-021) |

## そろっていなかった言い方(2026-11-22 に決定)

ワイヤーフレーム(版 37)で、同じものを別の言葉で呼んでいる所。

| どこ | 言い方 | 決定 | 理由 |
|---|---|---|---|
| 行き先を外す操作 | 「案内をやめる」(V1-e・V3-a)と「案内を終える」(V1-n) | 着く前は「案内をやめる」、着いたあとは「案内を終える」と分けて残す | 同じ操作(Destination.clear)だが、来場者の気持ちが違う(途中でやめる / 着いて終わる)。【推論】 |
| 混雑の見出し | 「混み具合」(V1-f のスタンプの画面)と「混雑」(ほかすべて) | 「混雑」にそろえる | 地図・凡例・数字の札がすべて「混雑」 |
| 場所の呼び方 | 「場所」と「企画」 | 企画だけのときは「企画」、駐車場や設備を含むときは「場所」 | 検索窓の「企画・場所を検索」と同じ使い分け |
| 建物の呼び方 | 「建物」と「棟」 | **すべて「建物」にそろえる**(「この建物の企画」)。「〜棟」は建物の名前の中だけ | 決定(案から変更) |
