# MapEyeButton

- status: proposed
- 目的(1 文): 地図で非表示にする層を切り替える操作の入口を示す
- 使う画面: map(I-3、issue #177)
- 見せる概念・項目: 見せ方の設定(画面の言葉は「表示する印」)。新しい概念にはしない

- 出典: [Figma ファイル FIAsdXNhkURiVxDV9lHVnB の Components キャンバス(ノード 17:2)](https://www.figma.com/design/FIAsdXNhkURiVxDV9lHVnB?node-id=17-2)の `MapEyeButton` と [GitHub issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)。見た目・値は Figma MCP で再確認した(2026-11-24、ノード 42:2954、`get_design_context`・`get_variable_defs`。Figma は変更していない)。
- I-3 の配置根拠: [issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)と [issue #173](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/173)の figma-diff 方針(H3・H4)。`doc/impl/figma-diff.md` は本ブランチ `docs/map-parts-spec` に無いため、issue を参照する。地図全面に重ねる配置は画面の側で行う。
- トークンは [tokens.json](../tokens.json) の意味の名前で記載する(色は `color.dark.*` / `color.light.*`)。Figma の変数(`color/bg-surface`・`color/border-subtle`・`color/text-primary`・`radius/xl`)と名前が一致することを確認した。
- テーマは OS に追従し、ライトでは同じ意味の light トークンを使う(暫定判断、[#197 事項 4](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197)で確認中)。Figma の Components キャンバスのこの部品はダーク(色変数の既定値)のみで、ライトの見た目は Figma で確認できない(未確認)。

## 構造(anatomy)
1. 枠つきの角丸の面(幅 44・高さ 50 px、面 `bg-surface`、枠 1 px `border-subtle`、角丸 `radius.xl`=14)。縦並び(中央寄せ)・要素の間隔 2 px
2. 上にアイコン(20 px)。Figma の instance 名は `icon layers`(重なりの形)。描画は目の形に見えるが、Figma 上のアイコン名は layers(`name=layers` の Icon)。実装のアイコンは Figma の Icon に合わせる
3. 下に「表示」(太字 11 px・`text-primary`)

地図の右側の縦並びに重ねる。

- [IconButton](IconButton.md) との関係: 独立した部品とする(44×50 で文字を持ち、IconButton の 44×44 と違う)。アイコンは Icon の `layers` を使う。

## props
既存の [IconButton](IconButton.md) の操作・無効表示を参考にした UI 案。MapState に無い値の採否・名前・受け渡しは末尾の要確認を解消してから確定する。

| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| label | 文字列 | ○ | — | 読み上げ用。「表示する印を切り替える」(案) | なし |
| onPress | 関数 | ○ | — | 地図に出す印を選ぶシートを開くことを画面の側へ依頼(Figma の description による。直接切り替えではない) | なし |
| (層の状態の props) | — | — | — | この部品には不要。層の選択はシート(内容は Figma に無く未確認)が持つ。シートの内容・層の一覧は別の部品の課題 | なし(MapState に表示状態無し) |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | アイコン `layers` と「表示」。Figma の variant は無く、この 1 つだけ | bg-surface、text-primary、border-subtle、radius.xl |
| 押下 | 有効時に onPress を実行。面に色を重ねる案 | state-pressed |
| 選択中・無効 | Figma に無い(variant なし)。無くてよい。シートを開くだけで、入・切の状態を持たない | — |
| 読み込み中・空・エラー | Figma に無い。この部品では出さない | — |

## 使う / 使わない
- 使う: 地図の「表示する印」を切り替える入口
- 使わない: 企画の種類・タグの絞り込みは Chip・FilterBand

## アクセシビリティ
- 操作方法: タップ、キーボードの Enter・Space。ボタンとして扱い、フォーカスを視認できるようにする。
- 読み上げの文言: 「表示する印を選ぶ」を提案する(Figma の description は「地図に出す印を選ぶシートを開くボタン」。シートを開くため、切り替えの語を避ける)。ボタンの aria は `aria-haspopup="dialog"` を付ける案。シートを開くとフォーカスをシートへ移し、閉じたらボタンへ戻す。
- 押せる大きさ: 各ボタンの押下領域を幅・高さとも 44 px 以上にする(`size.touch-target`)。見た目が小さい場合は周囲で補い、隣の押下領域と重ねない。
- 色だけに頼っていないか: アイコンの形と文字で操作を区別する。無効時は操作を止め、無効状態を支援技術へ伝える。装飾アイコンは読み上げを重複させない。

## 未確認・要確認
- 確認できた: Figma の description は「地図に出す印を選ぶシートを開くボタン」。方式は「シートを開く」であり、直接切り替えではない(aria-pressed は不要)。
- 確認できなかった: シート(何を並べるか)は Components に無い。対象の層・画面上の名前・初期表示は Figma から決められず、未確認。[contracts.md §9](../../doc/impl/contracts.md)の層 `buildings`・`labels`・`route`・`me`・`stamps` は内部名の一覧であり、Eye がすべてを切り替えるという決定ではない(推測で当てない)。
- MapState は `places`・`stamps`・`landmarks`・`position`・`destination`・`filter`・`now` のみ。表示状態は無い。層の状態を持つ場所(画面の側かシート)は要確認(#177)。`filter` を表示状態として流用しない。

- Figma に押下・フォーカス・ライトの variant は無く、見た目は未確認。押下は既存の `state-pressed` を使う案のまま。実機でコントラストと屋外の見え方を確認する。新しいトークンは追加しない。
