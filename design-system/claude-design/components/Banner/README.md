# Banner

使えないこと・うまくいかないことと、次の手を示す(原則 P3)。

- 使う画面: noloc(V1-g)、camera(V3-c)、op_places・op_landmarks(削除の確認は DeleteConfirm)
- 見せるもの: Position(位置が使えない)、向きのセンサー(端末)
- 状態: 下書き(チームで確認する前)。※ の付いた所は、概念設計の変更待ち

## 作り

1. アイコン
2. 見出し: 何が起きているか(「現在地が使えません」)
3. 説明: できなくなること、代わりにできること
4. 操作: 1〜2 個の Button

## 渡すもの(props)

| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| tone | 列挙 | ○ | warning | warning(使えない)/ error(失敗) | なし |
| title | 文字列 | ○ | — | | なし |
| body | 文字列 | | なし | | なし |
| actions | Button の配列 | | なし | 2 つまで | なし |

Design System で足した props: icon(仕様には無い。`components/index.d.ts` に【Design System で追加】と書いた)

## 状態

| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | 赤の枠 | danger、danger-bg、danger-text |
| 押下・無効・読み込み中・空 | なし(操作は中の Button) | |
| エラー | tone=error | 同上 |

## 使う / 使わない

- 使う: 機能が使えない・失敗したとき。**通信エラー**のときも、画面の上に tone=error で出し、「もう一度読み込む」を付ける(apply-log ⑫)
- 使わない: 0 件・一致なしは EmptyState(失敗ではない)。操作の結果は Toast

## アクセシビリティ

- 読み上げの文言: role="alert"
- 色だけに頼っていないか: 見出しの文で分かる

## 未確認・要確認

- warning と error で色を分けるか(いまはどちらも赤)
