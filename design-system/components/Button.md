# Button

- status: proposed
- 目的(1 文): 操作を 1 つ実行する
- 使う画面: map、search、card、guide、stamp、noloc、tags、list、camera、op_places、op_landmarks(ほぼ全画面)
- 見せる概念・項目: なし(文言は画面が渡す)

## 構造(anatomy)
1. 面: 種類ごとの背景・枠
2. アイコン(任意): 文字の左
3. 文字: 1 行。動詞で書く(「ここへ向かう」「解除」)

## props
| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| variant | 列挙 | ○ | primary | primary(主な操作)/ secondary(枠だけ)/ destination(行き先にだけ使う黄)/ danger(削除) | なし |
| label | 文字列 | ○ | — | 押すと起きることを動詞で | なし |
| icon | アイコン名 | | なし | 文字の左に出す | なし |
| size | 列挙 | | md | md(高さ 44 px)/ lg(48 px)/ sm(36 px。表の中だけ) | なし |
| disabled | 真偽 | | false | 押せないとき。理由は近くの文で示す | なし |
| onPress | 関数 | ○ | — | | なし |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | 種類ごとの面と文字 | color.{dark,light}.action-primary・action-on-primary、destination・destination-on、danger |
| 押下 | 面を少し暗く | (トークン未定。ステップ 3 で足す) |
| 無効 | 面の不透明度を下げ、押せない | (同上) |
| 読み込み中 | なし(この版は押した結果がすぐ出る操作だけ) | |
| 空 | なし | |
| エラー | なし(結果は Banner か Toast で出す) | |

## 使う / 使わない
- 使う: 画面の主な操作(1 画面に primary は 1 つまで)
- 使わない: 閉じる・拡大などアイコンだけの操作は IconButton。「行き先」以外に黄を使わない

## アクセシビリティ
- 操作方法: タップ。PC(運営)は Enter・Space でも押せる
- 読み上げの文言: label をそのまま
- 押せる大きさ: 高さ 44 px 以上(size.touch-target)。sm は運営の表の中だけ
- 色だけに頼っていないか: 種類の違いは文字で分かる(色は補助)

## 未確認・要確認
- 押下・無効のトークンが、tokens.json にまだ無い
