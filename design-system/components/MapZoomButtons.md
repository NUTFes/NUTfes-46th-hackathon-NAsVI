# MapZoomButtons

- status: proposed
- 目的(1 文): 地図を拡大・縮小する
- 使う画面: map(I-3、issue #177)
- 見せる概念・項目: 地図の表示倍率。場所や行き先のデータは変えない

- 出典: [Figma ファイル FIAsdXNhkURiVxDV9lHVnB の Components キャンバス(ノード 17:2)](https://www.figma.com/design/FIAsdXNhkURiVxDV9lHVnB?node-id=17-2)の `MapZoomButtons` と [GitHub issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)。見た目・値は Figma MCP で再確認した(2026-11-24、ノード 42:2980(variant 42:2960・42:2970・64:3208)、`get_design_context`・`get_variable_defs`。Figma は変更していない)。
- I-3 の配置根拠: [issue #177](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/177)と [issue #173](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/173)の figma-diff 方針(H3・H4)。`doc/impl/figma-diff.md` は本ブランチ `docs/map-parts-spec` に無いため、issue を参照する。地図全面に重ねる配置は画面の側で行う。
- トークンは [tokens.json](../tokens.json) の意味の名前で記載する(色は `color.dark.*` / `color.light.*`)。Figma の変数(`color/bg-surface`・`color/border-subtle`・`radius/xl`)と名前が一致することを確認した。
- テーマは OS に追従し、ライトでは同じ意味の light トークンを使う(暫定判断、[#197 事項 4](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197)で確認中)。Figma の Components キャンバスのこの部品はダーク(色変数の既定値)のみで、ライトの見た目は Figma で確認できない(未確認)。

## 構造(anatomy)
1. 縦に連結した角丸の面(幅 44・高さ 88 px、面 `bg-surface`、枠 1 px `border-subtle`、角丸 `radius.xl`=14)
2. 上に「＋」(拡大、領域 44×43、アイコン `zoom-in` 20 px)
3. 中央の区切り線(高さ 1 px・幅 44、色 `border-subtle`)
4. 下に「−」(縮小、領域 44×43、アイコン `zoom-out` 20 px)

地図の右側の縦並びに重ねる。上と下は別のボタンにする。

- [IconButton](IconButton.md) との関係: IconButton の instance ではなく、Icon の `zoom-in`・`zoom-out` を直接置いた専用の面。縦の連結面と区切り線をこの部品で扱う。IconButton の汎用定義は置き換えない。

## props
既存の [IconButton](IconButton.md) の操作・無効表示を参考にした UI 案。MapState に無い値の採否・名前・受け渡しは末尾の要確認を解消してから確定する。

| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| onZoomIn・onZoomOut | 関数 | ○ | — | 拡大・縮小を画面の側へ依頼。倍率の操作は地図の側 | なし |
| zoomInDisabled・zoomOutDisabled | 真偽 | | false | Figma の variant の `plusDisabled`(拡大の限界)・`minusDisabled`(縮小の限界)に対応。実装では上の名前でよい(Figma と名前が違うため対応を残す)。判定の受け渡しは未確認 | なし(MapState に無し。倍率は地図の側) |

## 状態
| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常 | 両方有効(`minusDisabled=false, plusDisabled=false`、ノード 42:2960)。アイコンは `text-primary`。Figma 上の見た目は無効でないときの 1 つ | bg-surface、text-primary、border-subtle、radius.xl |
| 押下 | 押した有効な側だけ対応する関数を実行。面に色を重ねる案 | state-pressed |
| 無効 | 無効な側の領域(44×43)だけ不透明度 40%(Figma の値。tokens の `opacity.disabled`=0.45 とは別の値で、Figma 側に変数は付いていない。差・未決: 実装でどちらを使うかは決まっていない。tokens の 0.45 を使う案だが、#197 事項 1 の決定待ち)。もう片方は通常のまま。両方同時に無効な variant は無い。無効な操作は実行しない | text-disabled の変数は Figma で参照されるが、不透明度 40% が実際の見た目 |
| 読み込み中・空・エラー | この部品では出さない | — |

## 使う / 使わない
- 使う: 地図の拡大・縮小
- 使わない: 初期の向きに戻す操作や現在地への移動は別の操作

## アクセシビリティ
- 操作方法: タップ、キーボードの Enter・Space。ボタンとして扱い、フォーカスを視認できるようにする。
- 読み上げの文言: 上は「地図を拡大」、下は「地図を縮小」。無効時は「これ以上は拡大できません」「これ以上は縮小できません」(Figma に読み上げ文言は無い。案)
- 押せる大きさ: 各ボタンの押下領域を幅・高さとも 44 px 以上にする(`size.touch-target`)。見た目が小さい場合は周囲で補い、隣の押下領域と重ねない。
- 色だけに頼っていないか: アイコンの形で操作を区別する。無効時は操作を止め、無効状態を支援技術へ伝える。装飾アイコンは読み上げを重複させない。

## 実装で確認済み
- [interaction.ts](../../web/src/map/interaction.ts) の `K_MIN = 0.9`・`K_MAX = 7` を `clampScale` が適用し、`zoomAt` とピンチの倍率を 0.9〜7 に制限する。
- `zoomAt` は現在の倍率に引数 `f` を掛ける。ホイールは `exp(-deltaY × 0.0018)`、ピンチは指間距離の比で変化する。これらは＋・−ボタン 1 回の変化量を定義するものではない。

## 実装との差(2026-11-24 にコードで確認)
- 押せる大きさの差: Figma の＋・−の各領域は 44×43 で、`size.touch-target`(44)に高さが 1 px 足りない。実装では各ボタンを 44 px 以上にする案(Figma の値との差として記録。#197 事項 1 の決定待ち)。
- 不透明度の差・未決: 無効の不透明度は Figma が 40%、tokens の `opacity.disabled` が 0.45。実装は tokens の 0.45 を使う想定だが未決(#197 事項 1)。
- [MapView.vue](../../web/src/views/MapView.vue) と [MapCanvas.vue](../../web/src/map/MapCanvas.vue) に＋・−ボタンは無い(ホイールとピンチのみ)。向きを戻すコンパスのボタン(aria-label「向きを戻す」)だけがある。
- Figma を正とする範囲は未決([#197 事項 1](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197))。この部品を Figma に合わせて作るかは、その決定待ち。

## 未確認・要確認
- ＋・−ボタン 1 回の変化量・長押しの有無は、Figma にも確認した実装にも定義が無く未確認。MapState に倍率は無く、契約の View.k が表示倍率に関わる。上限・下限での無効判定の受け渡しと地図への接続を要確認。Figma の description は「minusDisabled は縮小の限界、plusDisabled は拡大の限界(V1-i)」で、限界は上の `K_MIN`・`K_MAX` に当たると読める。
- Figma に無い差: コンパスは残す(暫定判断、[#197 事項 3](https://github.com/NUTFes/NUTfes-46th-hackathon-NAsVI/issues/197)で確認中)。[MapCanvas.vue](../../web/src/map/MapCanvas.vue) の aria-label は「向きを戻す」。`resetNorth` は名前にかかわらず `TH0 = -0.5` rad(初期角度)へ戻す実装であり、この操作を＋・−とは別に維持する案。配置・外観と Figma への反映を含め、#197 の確認待ち。

- Figma に押下・フォーカス・ライトの variant は無く、見た目は未確認。押下は既存の `state-pressed` を使う案のまま。実機でコントラストと屋外の見え方を確認する。新しいトークンは追加しない。
