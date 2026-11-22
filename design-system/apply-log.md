# 画面に当てて確かめる(ステップ 5)

作成: 2026-11-22 / 状態: 机の上での確認まで(AI)。Figma での組み直しと、実機での確認は、まだ(人間の作業)
もと: `concept-design/screens.yaml` の 12 画面、ワイヤーフレーム版 41、`components/` の 34 部品、`tokens.json`

## 1. 画面ごとの部品(画面だけの特別な部品がないか)

| 画面 | 盤 | 使う部品 | 画面だけの部品 |
|---|---|---|---|
| map | V1-a・i・m・o | SearchField、Chip、FilterBand(0 件の形を含む)、IconButton、Button(スタンプ)、TabBar、地図の印 7 つ | なし |
| search | V1-b・c | SearchField、Chip、FilterBand、PlaceRow、EmptyState、Button | なし |
| card | V1-d | PlaceCard(中に Button・IconButton) | なし |
| tags | V1-l | Sheet、CheckRow、TagCreateField(補足に注意書き)、Button | なし |
| guide | V1-e・n | DestinationCard、DestinationMark | なし |
| stamp | V1-f | Sheet、StampCongestionPicker、StampFeelingButton、Toast、MyStampRow | なし |
| noloc | V1-g | Banner、Button | なし |
| layers | V1-h | Sheet、CheckRow、Button | なし |
| building | V1-j・k | Sheet、BuildingFloorTabs、BuildingFloorPlan ※、PlaceRow、EmptyState | なし |
| list | V2 | SearchField、Chip、FilterBand、PlaceRow、Badge、EmptyState、TabBar | なし |
| camera | V3-a・b・c | BuildingCameraOverlay、DestinationBar、PlaceRow、EmptyState、Banner、Button | なし |
| op_places・op_landmarks | O1・O2 | DataTable、FormField、LocationPicker、BuildingShapePreview、DeleteConfirm、Chip、Button、Badge | なし |

## 2. うまくいかないとき・極端なデータのとき

| # | 場合 | どこで | 当てた部品・状態 | 結果 | 対処 |
|---|---|---|---|---|---|
| ① | 検索の一致がない | search | EmptyState(絞り込み中は「解除して探す」を先頭) | 問題なし | — |
| ② | 位置が使えない | noloc | Banner | 問題なし | — |
| ③ | 正面の建物に企画がない | camera | EmptyState | 問題なし | — |
| ④ | 向きが分からない | camera | BuildingCameraOverlay の状態 + Banner | 問題なし | — |
| ⑤ | 企画名がとても長い(例: 40 文字) | list・card・guide・camera | PlaceRow は 2 行まで。PlaceCard は折り返す。DestinationBar・DestinationCard は 1 行 | 矛盾: DestinationBar と DestinationCard に、長い名前の扱いが無かった | 直した: 仕様に「末尾を … にする」を足した |
| ⑥ | 自分が押したスタンプが何個もある | stamp | 部品が無い(ワイヤーフレームの行だけ) | 矛盾: 画面だけの部品になっていた | 直した: 新しい部品 MyStampRow を足した。新しい順に 3 件まで、古いものは「ほか N 件」(V1-f を描き直した) |
| ⑦ | タグが端末の中だけ、という注意書き | tags | 部品が無い(ただの文と枠) | 小さい矛盾 | 直した: 枠にはせず、TagCreateField の補足の文に書く(V1-l を描き直した) |
| ⑧ | 絞り込みの結果が 0 件 | map・list | list は EmptyState。map(V1-m)は FilterBand に「0 件」と出るだけ | 矛盾: 地図には印が 1 つも無くなり、理由が分かりにくかった | 直した: FilterBand に 0 件の形を足し、理由と次の手を出す(新しい盤 V1-o) |
| ⑨ | お気に入りが 0 件で「お気に入り」を選ぶ | map・list | ⑧ と同じ | ⑧ と同じ | 直した(⑧ と同じ。V1-o はこの場合を描いた) |
| ⑩ | 同じ場所にスタンプが多数重なる | map | StampMark に、重なりの扱いが無かった | 矛盾 | 直した: StampMark に、まとめ方(代表と「+N」)を足した(地図の部品を描き直した) |
| ⑪ | 読み込み中 | list・search・card | skeleton のトークンはある。PlaceRow・PlaceCard に「読み込み中」の状態を書いた | 問題なし(見た目は Figma で描く) | — |
| ⑫ | 通信エラー | 全画面 | どの部品にも状態が無い | 矛盾: どの部品にも状態が無かった | 直した: Banner の仕様に「通信エラーは画面の上に tone=error で出す」を足した |
| ⑬ | ライトで行き先の黄が見えにくい | map | DestinationMark に濃い縁(トークンの決定) | 機械では確認済み | 実機の屋外で確かめる(人間) |

## 3. まとめ

- 画面だけの特別な部品は、⑥(自分が押したスタンプの行)と ⑦(注意書き)の 2 つだった。⑥ は部品 MyStampRow にし、⑦ は TagCreateField の補足にした
- 矛盾は 6 件(⑤⑥⑦⑧⑩⑫)。すべて直した(⑥⑦⑧⑩ は 2026-11-22 に looky-looky が決めた)
- 人間の作業として残っているもの:
  - Figma で、部品とトークンだけで F1〜F3 の画面を組み直す
  - 実機で、明るい場所・片手操作で見る(トイレのアイコン、ライトの行き先の黄を含む)
