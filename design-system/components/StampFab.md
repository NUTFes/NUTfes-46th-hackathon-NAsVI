# StampFab

- status: proposed
- 目的(1 文): スタンプを押す画面を開く
- 使う画面: map(I-3、issue #177)
- 見せる概念・項目: Stamp(混雑・感想)。このボタン自体ではスタンプを送信しない

- 出典: [Figma ファイル FIAsdXNhkURiVxDV9lHVnB の Components キャンバス(ノード 17:2)](https://www.figma.com/design/FIAsdXNhkURiVxDV9lHVnB?node-id=17-2)の `StampFab` と [GitHub issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)。見た目・値は Figma MCP で再確認した(2026-11-24、ノード 42:2953(variant 42:2941・42:2947)、`get_design_context`・`get_variable_defs`。Figma は変更していない)。
- I-3 の配置根拠: [issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)と [issue #173](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/173)の figma-diff 方針(H3・H4)。`doc/impl/figma-diff.md` は本ブランチ `docs/map-parts-spec` に無いため、issue を参照する。地図全面に重ねる配置は画面の側で行う。
- トークンは [tokens.json](../tokens.json) の意味の名前で記載する。Figma の変数(`color/action-primary`・`color/action-on-primary`・`radius/2xl`)と名前が一致することを確認した。
- テーマは OS に追従し、ライトでは同じ意味の light トークンを使う(暫定判断、[#197 事項 4](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197)で確認中)。Figma の Components キャンバスのこの部品はダーク(色変数の既定値)のみで、ライトの見た目は Figma で確認できない(未確認)。

## 構造(anatomy)
1. lilac の角丸の面(幅 56・高さ 60 px、角丸 `radius.2xl`=18)。縦並び(中央寄せ)・要素の間隔 2 px
2. 上にスタンプのアイコン(`stamp`、22 px)
3. 下に「スタンプ」(太字 11 px・行高 1)

地図の右下に重ねる。

- [IconButton](IconButton.md) との関係: 独立した部品とする。Figma でも IconButton の instance ではなく、56×60 の専用の面に Icon の `stamp`(Icon の name=stamp は Figma の Icon に存在する)と文字を置いている。IconButton は 44×44 で文字を持たない。

## props
既存の [IconButton](IconButton.md) の操作・無効表示を参考にした UI 案。MapState に無い値の採否・名前・受け渡しは末尾の要確認を解消してから確定する。

| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| label | 文字列 | ○ | — | 読み上げ用。「スタンプを押す」。無効時は理由も含める(見た目の文字は固定で「スタンプ」) | なし |
| disabled | 真偽 | | false | Figma の variant `disabled=false・true`。Figma の description は「disabled は現在地が無いとき」。判定は MapState.position が null のときと読めるが、古い位置・許可拒否の扱いは未確認 | なし(MapState.position から画面の側で導く) |
| onPress | 関数 | ○ | — | スタンプの画面を開く。経路・位置の可否の判断は画面の側 | なし |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | 面 `action-primary`(#a78bfa)、アイコンと文字 `action-on-primary`(#1e0b3a) | action-primary、action-on-primary、radius.2xl |
| 押下 | 有効時だけ onPress を実行。面に色を重ねる案 | state-pressed |
| 無効 | 部品全体の不透明度 45%(`opacity.disabled`=0.45 と同値。Figma の変数は付いていない)。色の置き換えは無い。onPress を実行しない | opacity.disabled |
| 読み込み中・空・エラー | この部品では出さない。位置が使えない場合の遷移・案内は画面の側で維持 | — |

## 使う / 使わない
- 使う: 地図からスタンプの画面へ進む入口
- 使わない: スタンプの種類選択や送信には StampCongestionPicker・StampFeelingButton を使う

## アクセシビリティ
- 操作方法: タップ、キーボードの Enter・Space。ボタンとして扱い、フォーカスを視認できるようにする。
- 読み上げの文言: 「スタンプを押す」。無効時の例「スタンプを押す、現在地が使えません」(Figma に読み上げ文言は無い。この文言は案)
- 押せる大きさ: 各ボタンの押下領域を幅・高さとも 44 px 以上にする(`size.touch-target`)。見た目が小さい場合は周囲で補い、隣の押下領域と重ねない。
- 色だけに頼っていないか: アイコンの形と文字「スタンプ」で操作を区別する。無効時は操作を止め、無効状態を支援技術へ伝える。装飾アイコンは読み上げを重複させない。

## 未確認・要確認
- Figma の description は「disabled は現在地が無いとき」。無効時に押せない(位置の設定へ進めない)のか、押すと案内へ進むのかは Figma に無く、未確認。I-3 は既存の「位置が使えない」遷移を失わないこと。

- Figma に押下・フォーカス・ライトの variant は無く、見た目は未確認。押下は既存の `state-pressed` を使う案のまま。実機でコントラストと屋外の見え方を確認する。新しいトークンは追加しない。
