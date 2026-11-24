# MapEyeButton

- status: proposed
- 目的(1 文): 地図で非表示にする層を切り替える操作の入口を示す
- 使う画面: map(I-3、issue #177)
- 見せる概念・項目: 見せ方の設定(画面の言葉は「表示する印」)。新しい概念にはしない

- 出典: [Figma ファイル FIAsdXNhkURiVxDV9lHVnB の Components キャンバス(ノード 17:2)](https://www.figma.com/design/FIAsdXNhkURiVxDV9lHVnB?node-id=17-2)の `MapEyeButton` と [GitHub issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)。見た目・値の根拠は保存済みスクリーンショットであり、Figma MCP での再確認はしていない(未確認)。正確な設計値・variant 名・description は未確認。
- I-3 の配置根拠: [issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)と [issue #173](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/173)の figma-diff 方針(H3・H4)。`doc/impl/figma-diff.md` は本ブランチ `docs/map-parts-spec` に無いため、issue を参照する。地図全面に重ねる配置は画面の側で行う。
- トークンは [tokens.json](../tokens.json) の意味の名前で記載する(色は `color.dark.*` / `color.light.*`)。画像の変数との一致を保証するものではなく、既存仕様に沿った proposed の対応づけ。
- テーマは OS に追従し、ライトでは同じ意味の light トークンを使う(暫定判断、[#197 事項 4](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197)で確認中)。保存済みスクリーンショットからライトの見た目は確認できない。

## 構造(anatomy)
1. 枠つきの角丸の面
2. 上に目のアイコン
3. 下に「表示」

地図の右側の縦並びに重ねる。

- [IconButton](IconButton.md) との関係: 要確認。既存の layers と役割が重なるが、目アイコンと文字を持ち、直接切り替えかシートを開くかも未決のため、内包するか layers の地図用途を置き換えるかを確認する。

## props
既存の [IconButton](IconButton.md) の操作・無効表示を参考にした UI 案。MapState に無い値の採否・名前・受け渡しは末尾の要確認を解消してから確定する。

| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| label | 文字列 | ○ | — | 読み上げ用。「表示する印を切り替える」(案) | なし |
| onPress | 関数 | ○ | — | 非表示にする層の切り替えを画面の側へ依頼。直接切り替えか設定を開くかは要確認 | なし |
| 層の状態・変更通知用 props(名前未定) | 要確認 | 要確認 | 要確認 | 対象層、値の形、初期値、切り替え順、通知する値を確定後に追加するか要確認 | なし(MapState に表示状態無し) |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | 目のアイコンと「表示」。保存済みスクリーンショットはこの見た目 1 つだけ | bg-surface、text-primary、border-subtle |
| 押下 | 有効時に onPress を実行。面に色を重ねる案 | state-pressed |
| 選択中・無効 | 有無・見た目・必要な props は要確認。画像から入・切を決めない | 未確認 |
| 読み込み中・空・エラー | この部品固有の表示は未確認。層のデータ取得とは分ける | 未確認 |

## 使う / 使わない
- 使う: 地図の「表示する印」を切り替える入口
- 使わない: 企画の種類・タグの絞り込みは Chip・FilterBand

## アクセシビリティ
- 操作方法: タップ、キーボードの Enter・Space。ボタンとして扱い、フォーカスを視認できるようにする。
- 読み上げの文言: 「表示する印を切り替える」(案)。対象と方式が決まったら操作後の状態も読める文言を確定する
- 押せる大きさ: 各ボタンの押下領域を幅・高さとも 44 px 以上にする(`size.touch-target`)。見た目が小さい場合は周囲で補い、隣の押下領域と重ねない。
- 色だけに頼っていないか: アイコンの形と文字で操作を区別する。無効時は操作を止め、無効状態を支援技術へ伝える。装飾アイコンは読み上げを重複させない。

## 未確認・要確認
- [contracts.md §9](../../doc/impl/contracts.md)の層は `buildings`・`labels`・`route`・`me`・`stamps`(読み込み順もこの順)。これは内部名の一覧であり、Eye がすべてを切り替えるという決定ではない。対象層、画面上の名前、個別切り替えか一括か、初期表示・切り替え順は要確認。
- MapState は `places`・`stamps`・`landmarks`・`position`・`destination`・`filter`・`now` のみ。表示状態は無い。層の状態を持つ場所と props の追加が要確認(#177)。`filter` を表示状態として流用しない。
- シートを開く方式か直接切り替える方式かは未確認。確定前に aria-pressed・aria-expanded のどちらかを推測で付けない。方式に合わせて状態通知とフォーカスの移動・復帰を決める。

- Figma の正確な幅・高さ・角丸・余白・アイコン寸法・線幅・文字サイズ・色の値・description 文・variant 名は未確認。画像のピクセル数を設計値として使わない。
- 押下・フォーカス・ライトの見た目は画像で未確認。実機でコントラストと屋外の見え方を確認する。新しいトークンは追加しない。
