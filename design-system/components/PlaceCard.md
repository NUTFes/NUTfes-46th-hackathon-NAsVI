# PlaceCard

- status: proposed
- 目的(1 文): 場所 1 件の情報を見せ、行き先にする・タグを付ける
- 使う画面: card(V1-d)
- 見せる概念・項目: Place(places の名前・種類・建物・階・説明・開催時間。D-017・D-020)、Destination、Labeling(タグ、端末)

## 構造(anatomy)
1. 上の小さい字: 建物と階・種別
2. 名前
3. 説明・時間
4. 距離と「直線」
5. タグのボタン: 行きたい場所・お気に入り・＋タグ
6. 「ここへ向かう」(Button destination)と閉じる

## props
| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| placeId | 文字列 | ○ | — | | places.id |
| name | 文字列 | ○ | — | | places.name |
| kind | 列挙 | ○ | — | event / parking / facility(設備。D-017) | places.kind(API の info・wc・rest・trash は、画面の側で facility にまとめて渡す。#21 の API-36) |
| building・floor | 文字列 | | なし | 表示用の文字列(「総合研究棟」「2階」) | places.building(Landmark の id。名前にして渡す)・floor(数。「2階」にして渡す) |
| description | 文字列 | | なし | | places.description |
| hours | 文字列 | | なし | 表示用の文字列(「両日 10:00〜16:00」)。places.hours(開始と終了の組、複数可)から、画面の側の 1 つの関数で作って渡す | places.hours(D-020) |
| distanceM | 数 | | なし | | なし(端末で計算) |
| tags | {wantToGo, favorite} | ○ | — | | なし(端末) |
| onGo | 関数 | ○ | — | chooseDestination | なし(OQ-12 が決まるまで端末) |
| onToggleTag・onOpenTags・onClose | 関数 | ○ | — | | なし |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | | bg-surface、text-primary、destination |
| 押下・無効 | なし(中の Button) | |
| 読み込み中 | 文の所に灰色の帯 | (未定) |
| 空 | なし | |
| エラー | 場所が消された(運営が削除)とき「この場所は見られなくなりました」 | danger-text |

## 使う / 使わない
- 使う: 場所 1 件を開いたとき。開いただけでは行き先にしない(D-013)
- 使わない: 何件も並べるときは PlaceRow

## アクセシビリティ
- 読み上げの文言: 名前を見出しにする
- 押せる大きさ: タグのボタン 36 px(上下の余白で 44 px)
- 色だけに頼っていないか: タグの入・切は塗りと形

## 未確認・要確認
- 解消(D-020): 開催時間は Place.hours(開始と終了の組)として持つ。この部品は表示用の文字列を受ける(組から文字列への整形は、画面の側で 1 か所にまとめる)。「いまやっている企画」で絞るときは、部品ではなく絞り込みの側で組を使う
- API(#21)は hours を開始と終了の日時の組で返す。「両日 10:00〜16:00」の文字列は、画面の側で組み立てる(API-35)
