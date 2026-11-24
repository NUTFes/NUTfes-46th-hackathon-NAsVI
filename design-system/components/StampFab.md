# StampFab

- status: proposed
- 目的(1 文): スタンプを押す画面を開く
- 使う画面: map(I-3、issue #177)
- 見せる概念・項目: Stamp(混雑・感想)。このボタン自体ではスタンプを送信しない

- 出典: [Figma ファイル FIAsdXNhkURiVxDV9lHVnB の Components キャンバス(ノード 17:2)](https://www.figma.com/design/FIAsdXNhkURiVxDV9lHVnB?node-id=17-2)の `StampFab` と [GitHub issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)。見た目・値の根拠は保存済みスクリーンショットであり、Figma MCP での再確認はしていない(未確認)。正確な設計値・variant 名・description は未確認。
- I-3 の配置根拠: [issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)と [issue #173](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/173)の figma-diff 方針(H3・H4)。`doc/impl/figma-diff.md` は本ブランチ `docs/map-parts-spec` に無いため、issue を参照する。地図全面に重ねる配置は画面の側で行う。
- トークンは [tokens.json](../tokens.json) の意味の名前で記載する(色は `color.dark.*` / `color.light.*`)。画像の変数との一致を保証するものではなく、既存仕様に沿った proposed の対応づけ。
- テーマは OS に追従し、ライトでは同じ意味の light トークンを使う(暫定判断、[#197 事項 4](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197)で確認中)。保存済みスクリーンショットからライトの見た目は確認できない。

## 構造(anatomy)
1. lilac の角丸の面
2. 上にスタンプのアイコン
3. 下に「スタンプ」

地図の右下に重ねる。

- [IconButton](IconButton.md) との関係: 要確認。文字つきの専用入口であり、既存の icon 値に stamp が無いため、そのまま内包できるか・独立したボタンとするかを確定できない。

## props
既存の [IconButton](IconButton.md) の操作・無効表示を参考にした UI 案。MapState に無い値の採否・名前・受け渡しは末尾の要確認を解消してから確定する。

| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| label | 文字列 | ○ | — | 読み上げ用。「スタンプを押す」。無効時は理由も含める | なし |
| disabled | 真偽 | | false | 無効表示のための UI 案。無効になる条件は要確認 | なし(MapState に無し。要確認) |
| onPress | 関数 | ○ | — | スタンプの画面を開く。経路・位置の可否の判断は画面の側 | なし |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | スタンプのアイコンと文字が濃い lilac の面 | action-primary、action-on-primary |
| 押下 | 有効時だけ onPress を実行。面に色を重ねる案 | state-pressed |
| 無効 | 画像右は薄い面・アイコン・文字(無効とみなす案)。onPress を実行しない | opacity.disabled、text-disabled |
| 読み込み中・空・エラー | この部品では出さない。位置が使えない場合の遷移・案内は画面の側で維持 | — |

## 使う / 使わない
- 使う: 地図からスタンプの画面へ進む入口
- 使わない: スタンプの種類選択や送信には StampCongestionPicker・StampFeelingButton を使う

## アクセシビリティ
- 操作方法: タップ、キーボードの Enter・Space。ボタンとして扱い、フォーカスを視認できるようにする。
- 読み上げの文言: 「スタンプを押す」。無効時の例「スタンプを押す、現在地が使えません」(無効条件と採用文言は要確認)
- 押せる大きさ: 各ボタンの押下領域を幅・高さとも 44 px 以上にする(`size.touch-target`)。見た目が小さい場合は周囲で補い、隣の押下領域と重ねない。
- 色だけに頼っていないか: アイコンの形と文字で操作を区別する。無効時は操作を止め、無効状態を支援技術へ伝える。装飾アイコンは読み上げを重複させない。

## 未確認・要確認
- 画像右の状態の正式な意味と、位置が使えないときに無効にするか、位置の設定へ進めるかは要確認。I-3 は既存の「位置が使えない」遷移を失わないこと。

- Figma の正確な幅・高さ・角丸・余白・アイコン寸法・線幅・文字サイズ・色の値・description 文・variant 名は未確認。画像のピクセル数を設計値として使わない。
- 押下・フォーカス・ライトの見た目は画像で未確認。実機でコントラストと屋外の見え方を確認する。新しいトークンは追加しない。
