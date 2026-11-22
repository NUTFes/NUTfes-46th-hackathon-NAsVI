# StampFeelingButton

- status: proposed
- 目的(1 文): 感想(面白い・美味しい・よさ)のスタンプを押す
- 使う画面: stamp(V1-f)
- 見せる概念・項目: stamps の種類(感想)

## 構造(anatomy)
1. マーク(地図と同じ)
2. 名前

## props
| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| feeling | 列挙 | ○ | — | fun / food / good | stamps.kind |
| disabled | 真偽 |  | false |  | なし |
| onPress | 関数 | ○ | — | pressStamp | stamps(POST) |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 |  | feeling、feeling-on、border-subtle |
| 押下 |  | state-pressed |
| 無効 |  | opacity.disabled |
| その他(押下・無効・読み込み中・空・エラーのうち上に無いもの) | なし(この部品では起きない、または中の部品で出す) | |

## 使う / 使わない
- 使う: スタンプのシートの中
- 使わない: —

## アクセシビリティ
- 操作方法: タップ
- 読み上げの文言: 「面白い」
- 押せる大きさ: 高さ 48 px
- 色だけに頼っていないか: マークと文字

## 未確認・要確認
- 感想に期限を付けるか(OQ-4)
