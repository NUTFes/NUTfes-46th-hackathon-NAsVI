# MapLocateButton

- status: proposed
- 目的(1 文): 地図の表示を現在地へ戻す
- 使う画面: map(I-3、issue #177)
- 見せる概念・項目: Position(現在地)。位置の取得・許可の判断は画面の側

- 出典: [Figma ファイル FIAsdXNhkURiVxDV9lHVnB の Components キャンバス(ノード 17:2)](https://www.figma.com/design/FIAsdXNhkURiVxDV9lHVnB?node-id=17-2)の `MapLocateButton` と [GitHub issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)。見た目・値の根拠は保存済みスクリーンショットであり、Figma MCP での再確認はしていない(未確認)。正確な設計値・variant 名・description は未確認。
- I-3 の配置根拠: [issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)と [issue #173](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/173)の figma-diff 方針(H3・H4)。`doc/impl/figma-diff.md` は本ブランチ `docs/map-parts-spec` に無いため、issue を参照する。地図全面に重ねる配置は画面の側で行う。
- トークンは [tokens.json](../tokens.json) の意味の名前で記載する(色は `color.dark.*` / `color.light.*`)。画像の変数との一致を保証するものではなく、既存仕様に沿った proposed の対応づけ。
- テーマは OS に追従し、ライトでは同じ意味の light トークンを使う(暫定判断、[#197 事項 4](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197)で確認中)。保存済みスクリーンショットからライトの見た目は確認できない。

## 構造(anatomy)
1. 枠つきの角丸の面
2. 現在地へ向かう矢印のアイコン
3. 保存済みスクリーンショット右は薄いアイコンに斜線

地図の右側の縦並びに重ねる。

- [IconButton](IconButton.md) との関係: locate を内包し、地図固有の移動要求と無効判定の受け渡しをこの部品で扱う案。斜線つきの無効アイコンの表現は要確認。

## props
既存の [IconButton](IconButton.md) の操作・無効表示を参考にした UI 案。MapState に無い値の採否・名前・受け渡しは末尾の要確認を解消してから確定する。

| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| label | 文字列 | ○ | — | 読み上げ用。「現在地へ戻る」。無効時は理由も含める | なし |
| disabled | 真偽 | | false | UI 案。現在地が使えない場合の無効表示。判定条件は要確認 | なし(MapState.position からの判定は要確認) |
| onPress | 関数 | ○ | — | 現在地への移動を画面の側へ依頼。位置の取得処理は持たない | なし |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | 明るい矢印のアイコン | bg-surface、text-primary、border-subtle |
| 押下 | 有効時だけ onPress を実行。面に色を重ねる案 | state-pressed |
| 無効 | 保存済みスクリーンショット右の薄い斜線つきアイコンを無効とみなす案。onPress を実行しない | opacity.disabled、text-disabled |
| 読み込み中・空・エラー | この部品固有の表示は未確認。取得中・失敗の案内は画面の側 | 未確認 |

## 使う / 使わない
- 使う: 地図を動かしたあと現在地へ戻る操作
- 使わない: 位置の許可や「地図で指定」の入力そのもの

## アクセシビリティ
- 操作方法: タップ、キーボードの Enter・Space。ボタンとして扱い、フォーカスを視認できるようにする。
- 読み上げの文言: 「現在地へ戻る」。無効時の例「現在地へ戻る、現在地が使えません」
- 押せる大きさ: 各ボタンの押下領域を幅・高さとも 44 px 以上にする(`size.touch-target`)。見た目が小さい場合は周囲で補い、隣の押下領域と重ねない。
- 色だけに頼っていないか: アイコンの形で操作を区別する。無効時は操作を止め、無効状態を支援技術へ伝える。装飾アイコンは読み上げを重複させない。

## 未確認・要確認
- 画像右が示す正式な状態は未確認。MapState.position は Position または null だが、null・古い位置・許可拒否・取得中をどう無効表示へ対応させるかは要確認。
- 現在地へ移動する公開メソッド名は未確認([#173](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/173)の figma-diff 方針 H4 は flyToMe、[#177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)の I-3 担当欄は flyTo)。位置が使えないときの既存の案内・設定への遷移を画面の側で維持する。

- Figma の正確な幅・高さ・角丸・余白・アイコン寸法・線幅・文字サイズ・色の値・description 文・variant 名は未確認。画像のピクセル数を設計値として使わない。
- 押下・フォーカス・ライトの見た目は画像で未確認。実機でコントラストと屋外の見え方を確認する。新しいトークンは追加しない。
