# API の元表(導出結果。毎回上書きされるので手で編集しない)

導出元: concepts.yaml。手で書く仕様は `api/spec.md` に置く。
メソッドとパスは概念から機械的に付けた仮の値で、決める作業は TODO として残る。

## 1. 外から呼ぶ操作(`Request.*` で始まる同期)

| 要求 | 機能 | 実行する概念のアクション | メソッド(仮) | パス(仮) | 権限・条件(where) | 事前条件 → エラーの候補 |
|---|---|---|---|---|---|---|
| registerPlace | F1 | Place.register | POST | /place TODO | 実行者が場所を管理できる | - |
| updatePlace | F1 | Place.update | POST | /place TODO | 実行者が場所を管理できる | Place.update: place が places に含まれる |
| removePlace | F1 | Place.remove | POST | /place TODO | 実行者が場所を管理できる | Place.remove: place が places に含まれる |
| showPlaces | F1 | Request.respond | GET | /request TODO | p が Place.places に含まれ、Place の name・kind・location・description・building・floor・hours と、p に付いた運営の種類(labelIds)を返す。 絞り込みは端末でまとめて行う(API-8、D-012・D-014)。運営の種類どうしは OR、自分用のタグは AND(D-016)。設備は絞り込まない | - |
| search | F1 | Request.respond | GET | /request TODO | p が Search.indexed に含まれ、Search.text of p が keyword を含む | - |
| searchNatural | F1 | Request.respond | GET | /request TODO | p が Search.indexed に含まれ、Laya.matches(sentence, Search.text of p) | - |
| defineLabel | F4 | Labeling.define | POST | /labeling TODO | 実行者が場所を管理できる | - |
| showLabels | F4 | Request.respond | GET | /request TODO | l が Labeling.labels に含まれ、Labeling.owner of l が無い(運営の種類) | - |
| removeLabel | F4 | Labeling.undefine | POST | /labeling TODO | 実行者が場所を管理できる | Labeling.undefine: label が labels に含まれ、どの item にも label が付いていない |
| assignLabel | F4 | Labeling.attach | POST | /labeling TODO | place が Place.places に含まれ、実行者が場所を管理できる | Labeling.attach: label が labels に含まれ、label に owner が無いか、owner が u である |
| defineMyTag | F4 | Labeling.defineFor | POST | /labeling TODO | - | - |
| markPlace | F4 | Labeling.attach | POST | /labeling TODO | place が Place.places に含まれる | Labeling.attach: label が labels に含まれ、label に owner が無いか、owner が u である |
| unmarkPlace | F4 | Labeling.detach | POST | /labeling TODO | - | Labeling.detach: item に label が付いていて、label に owner が無いか、owner が u である |
| applyFilter | F4 | Labeling.applyFilter | POST | /labeling TODO | - | Labeling.applyFilter: label が labels に含まれ、label に owner が無いか、owner が u である |
| clearFilter | F4 | Labeling.clearFilter | POST | /labeling TODO | - | - |
| browse | F4 | Request.respond | GET | /request TODO | p が、label の付いた項目(Labeling.labeled)である | - |
| allowLocation | F2 | Position.allow | POST | /position TODO | - | Position.allow: u が refused に含まれない |
| refuseLocation | F2 | Position.refuse | POST | /position TODO | - | - |
| reportPosition | F2 | Position.update | POST | /position TODO | - | Position.update: u が allowed に含まれる |
| setPosition | F2 | Position.setManually | POST | /position TODO | - | - |
| chooseDestination | F2 | Destination.choose | POST | /destination TODO | place が Place.places に含まれる | - |
| showRoute | F2 | Request.respond | GET | /request TODO | Destination.chosen of u が d で、Destination.heading・remaining・guidedAt of u がある | - |
| pressStamp | F3 | Stamp.press | POST | /stamp TODO | Position.at of u が p である | - |
| retractStamp | F3 | Stamp.retract | POST | /stamp TODO | - | Stamp.retract: stamp が stamps に含まれ、stamp の proof が与えられた proof と一致する |
| showStamps | F3 | Request.respond | GET | /request TODO | s が Stamp.stamps に含まれ、混雑スタンプなら(now - Stamp.pressedAt of s)が 30 分以内、感想のスタンプ(面白い・美味しい・よさ)ならその日の閉場まで   # 仮置きの値(D-022)。OQ-4 | - |
| registerLandmark | F5 | Landmark.register | POST | /landmark TODO | 実行者が場所を管理できる。輪郭は OpenStreetMap から取る(Osm.outline(建物の位置)。外部の計算。D-019) | - |
| updateLandmark | F5 | Landmark.update | POST | /landmark TODO | 実行者が場所を管理できる | Landmark.update: landmark が landmarks に含まれる |
| reloadFootprint | F5 | Landmark.update | POST | /landmark TODO | 実行者が場所を管理できる。l が Landmark.landmarks に含まれ、Osm.outline(Landmark.location of l)が輪郭を返す | Landmark.update: landmark が landmarks に含まれる |
| removeLandmark | F5 | Landmark.remove | POST | /landmark TODO | 実行者が場所を管理できる | Landmark.remove: landmark が landmarks に含まれる |
| recognizeBuilding | F5 | Request.respond | POST | /request TODO | l が Landmark.landmarks に含まれ、Geometry.facing(Position.at of u, 向き, Landmark.footprint of l) | - |
| showLandmarks | F5 | Request.respond | GET | /request TODO | l が Landmark.landmarks に含まれる | - |
| showBuildingEvents | F5 | Request.respond | GET | /request TODO | 一致した建物 l の近く(Landmark.location of l)に、Place.places に含まれる p がある | - |
| showBuildingEvents | F5 | Request.respond | GET | /request TODO | 一致した建物 l の近くに、Place.places に含まれる p が無い | - |

## 2. 1 回の要求で複数の概念が動く連動(整合の扱いを決める)

連動の途中で失敗したとき、全体を失敗にするか、一部だけ成功にするか。決めてから API の応答を書く。

- `Place.register` のあと `Search.index`  TODO: 失敗時の扱い
- `Place.update` のあと `Search.index`(条件: name が更新された)  TODO: 失敗時の扱い
- `Place.remove` のあと `Search.unindex`  TODO: 失敗時の扱い
- `Place.remove` のあと `Labeling.release`  TODO: 失敗時の扱い
- `Place.remove` のあと `Destination.clear`(条件: Destination.chosen が、取り除かれた place である)  TODO: 失敗時の扱い
- `Destination.choose` のあと `Destination.updateGuide`(条件: Position.at of u が a で、Place.location of 行き先 が b である)  TODO: 失敗時の扱い
- `Position.update` のあと `Destination.updateGuide`(条件: Destination.chosen of u が d で、Place.location of d が b である)  TODO: 失敗時の扱い

## 3. 外から呼ばない操作(`system: true`)


## 4. 概念の状態 → リソースの候補

### Place

```
places: set Place
name: Place -> one String
kind: Place -> one Kind          // Kind = {企画, 駐車場, 案内所, トイレ, 休憩所, ゴミ箱}(案内所〜ゴミ箱は設備。OQ-3)
location: Place -> one Point
description: Place -> one String
building: Place -> lone Building // 場所がある建物。屋外の企画・駐車場には無い
floor: Place -> lone Number      // 階(1 = 1 階、地下は負)。建物の外には無い
hours: Place -> set Period       // 開催時間。Period = {開始: Time, 終了: Time}。企画は複数の時間帯を持てる(D-020)
```

### Search

```
indexed: set Item
text: Item -> one String
```

### Labeling

```
labels: set Label
title: Label -> one String
owner: Label -> lone User         // 自分用タグの持ち主。無ければ、運営の種類
labeled: Item -> set Label
filtering: User -> set Label      // 絞り込みステータス(来場者ごとの、いまの絞り込み)
```

### Position

```
allowed: set User
refused: set User
at: User -> lone Point
accuracy: User -> lone Number
takenAt: User -> lone Time
```

### Destination

```
chosen: User -> lone Item
heading: User -> lone Number     // 行き先への方角
remaining: User -> lone Number   // 行き先までの距離
guidedAt: User -> lone Time      // 道案内を更新した時刻
```

### Stamp

```
stamps: set Stamp
kind: Stamp -> one StampKind    // StampKind = {混雑1, 混雑2, 混雑3, 混雑4, 混雑5, 面白い, 美味しい, よさ}(OQ-4)
at: Stamp -> one Point
proof: Stamp -> one Proof       // 取り消しの証。押した端末だけが持つ。誰が押したかは持たない(D-021)
pressedAt: Stamp -> one Time
```

### Landmark

```
landmarks: set Landmark
name: Landmark -> one String
location: Landmark -> one Point
footprint: Landmark -> one Polygon  // 建物の輪郭(地図上の多角形の頂点列)
```

## 5. 決まっていない前提

- OQ-1: 場所の登録を行う運営を、どう識別するか(運営者用の登録ページの認証。運営のみか、出展者も含めるか)。スタンプは来場者が押すので、報告者の権限は要らない
- OQ-2: GPS が取れないとき、現在地を手で指定する操作を P1 に入れるか
- OQ-3: 種類(カテゴリ)で選ぶ F4 を P1 に入れるか。Place.kind(企画 / 駐車場)との線引きはどうするか
- OQ-4: スタンプの種類(混雑 1〜5、面白い、美味しい、よさ など)と、混雑スタンプを古いとみなす時間。感想のスタンプに期限を付けるか
- OQ-7: input.yaml の課題・機能 F1〜F5 は、ボードの P1 案と合っているか(F1〜F4 は画像から推測した下書き。F3・F4 の広げ方と F5 は Slack の発言から)
- OQ-8: タグ検索を入れるか。Laya(自然言語から曖昧検索できる小規模言語モデル)の入出力形式と、動かす場所(端末かサーバか)
- OQ-9: 待ち合わせ(周囲のオンライン者に合言葉を共有する案)を入れるか。入れる場合、位置の共有を許可した相手にだけ見せる形にするか(現在地は自分のみ、という原理と衝突する)
- OQ-10: 「迷っている」をどう判定するか(行き先から遠ざかる、同じ所に長く留まる、など)。建物の近くとみなす範囲(near)
- OQ-12: 来場者(User)を誰が供給するか。識別しない場合、現在地・行き先・自分用タグ・絞り込みは端末内に置く形になる(自分用タグは D-014 で端末内に決まった。残りが未決)。その場合、これらを概念として残すかも決める
- OQ-13: 自作タグの名前のルール(空欄・重複・文字数)と、タグの上限数。名前の変更・削除ができるか、固定の 2 つを消せるか
- OQ-14: 階ごとの見取り図(階の画像と、四隅の緯度経度)を、新しい概念にするか。Place・Landmark とは目的が違う(API-29・30、wireframe の ※)
- OQ-16: 建物の輪郭を、端末へ静的ファイルで同梱するか、サーバー(API)から返すか
- OQ-17: 運営が修正した建物の輪郭を、地図データからの読み込み直し(reload-footprint)で上書きしてよいか。修正した建物は、読み込み直しの対象から外すか
