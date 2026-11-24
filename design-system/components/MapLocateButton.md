# MapLocateButton

- status: proposed
- 目的(1 文): 地図の表示を現在地へ戻す
- 使う画面: map(I-3、issue #177)
- 見せる概念・項目: Position(現在地)。位置の取得・許可の判断は画面の側

- 出典: [Figma ファイル FIAsdXNhkURiVxDV9lHVnB の Components キャンバス(ノード 17:2)](https://www.figma.com/design/FIAsdXNhkURiVxDV9lHVnB?node-id=17-2)の `MapLocateButton` と [GitHub issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)。見た目・値は Figma MCP で再確認した(2026-11-24、ノード 42:2990(variant 42:2981・42:2985)、`get_design_context`・`get_variable_defs`。Figma は変更していない)。
- I-3 の配置根拠: [issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)と [issue #173](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/173)の figma-diff 方針(H3・H4)。`doc/impl/figma-diff.md` は本ブランチ `docs/map-parts-spec` に無いため、issue を参照する。地図全面に重ねる配置は画面の側で行う。
- トークンは [tokens.json](../tokens.json) の意味の名前で記載する(色は `color.dark.*` / `color.light.*`)。Figma の変数(`color/bg-surface`・`color/border-subtle`・`radius/xl`)と名前が一致することを確認した。
- テーマは OS に追従し、ライトでは同じ意味の light トークンを使う(暫定判断、[#197 事項 4](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197)で確認中)。Figma の Components キャンバスのこの部品はダーク(色変数の既定値)のみで、ライトの見た目は Figma で確認できない(未確認)。

## 構造(anatomy)
1. 枠つきの角丸の面(幅・高さ 44 px、面 `bg-surface`、枠 1 px `border-subtle`、角丸 `radius.xl`=14)
2. 中央に現在地へ向かう矢印のアイコン(`locate`、20 px)
3. 無効(`state=off`)ではアイコンが `locate-off`(斜線つき)に替わる。面の色・不透明度は変わらない

地図の右側の縦並びに重ねる。

- [IconButton](IconButton.md) との関係: 見た目は IconButton(44×44・`bg-surface`・枠)と同じ構成だが、Figma では instance でなく専用の面に Icon を直接置く。無効の表現は Icon の `locate-off` への差し替え。実装で IconButton を内包するかは任意。

## props
既存の [IconButton](IconButton.md) の操作・無効表示を参考にした UI 案。MapState に無い値の採否・名前・受け渡しは末尾の要確認を解消してから確定する。

| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| label | 文字列 | ○ | — | 読み上げ用。「現在地へ戻る」。無効時は理由も含める | なし |
| disabled | 真偽 | | false | Figma の variant `state=default・off` に対応(Figma の description は「state=off は位置が使えないとき(V1-g)」)。判定は MapState.position が null のときと読めるが、古い位置・許可拒否・取得中の扱いは未確認 | なし(MapState.position から画面の側で導く) |
| onPress | 関数 | ○ | — | 現在地への移動を画面の側へ依頼。位置の取得処理は持たない | なし |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | `locate` アイコン(`text-primary`) | bg-surface、text-primary、border-subtle、radius.xl |
| 押下 | 有効時だけ onPress を実行。面に色を重ねる案 | state-pressed |
| 無効 | `locate-off` アイコン(斜線つき)。Figma の変数は `text-disabled` を参照。面・枠は通常と同じで、部品全体の不透明度は変えない(StampFab と違う)。onPress を実行しない | text-disabled |
| 読み込み中・空・エラー | この部品固有の表示は未確認。取得中・失敗の案内は画面の側 | 未確認 |

## 使う / 使わない
- 使う: 地図を動かしたあと現在地へ戻る操作
- 使わない: 位置の許可や「地図で指定」の入力そのもの

## アクセシビリティ
- 操作方法: タップ、キーボードの Enter・Space。ボタンとして扱い、フォーカスを視認できるようにする。
- 読み上げの文言: 「現在地へ戻る」。無効時の例「現在地へ戻る、現在地が使えません」(Figma に読み上げ文言は無い。案)
- 押せる大きさ: 各ボタンの押下領域を幅・高さとも 44 px 以上にする(`size.touch-target`)。見た目が小さい場合は周囲で補い、隣の押下領域と重ねない。
- 色だけに頼っていないか: アイコンの形で操作を区別する。無効時は操作を止め、無効状態を支援技術へ伝える。装飾アイコンは読み上げを重複させない。

## 実装との差(2026-11-24 にコードで確認)
- [MapView.vue](../../web/src/views/MapView.vue) と [MapCanvas.vue](../../web/src/map/MapCanvas.vue) に現在地へ戻るボタンも、現在地へ移動する公開メソッドも無い。位置が無いときは MapView が「noloc」への `RouterLink` を出す。
- Figma を正とする範囲は未決([#197 事項 1](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197))。この部品を Figma に合わせて作るかは、その決定待ち。

## 未確認・要確認
- Figma の description は「位置が使えないとき」。MapState.position は Position または null だが、null・古い位置・許可拒否・取得中をどう無効表示へ対応させるかは Figma に無く、未確認。
- 現在地へ移動する公開メソッド名は未確認([#173](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/173)の figma-diff 方針 H4 は flyToMe、[#177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)の I-3 担当欄は flyTo)。位置が使えないときの既存の案内・設定への遷移を画面の側で維持する。

- Figma に押下・フォーカス・ライトの variant は無く、見た目は未確認。押下は既存の `state-pressed` を使う案のまま。実機でコントラストと屋外の見え方を確認する。新しいトークンは追加しない。
