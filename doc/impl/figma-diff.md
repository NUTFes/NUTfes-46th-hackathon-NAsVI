# Figma(デザインシステム)と実装の差分

Figma「NAsVI デザインシステム」(ファイル FIAsdXNhkURiVxDV9lHVnB、Components ページ 17:2 と 地図を暗く 45:727)と、`impl/main` の実装を照合した結果。
- 照合の対象(以下「照合時点」): `impl/main` 7405dbb(S-08 merge 直後)のコード。読み取りのみ。Figma は部品ごとの PNG 44 枚。
- 照合は 2026-11-24 に、画像・`design-system/` の仕様・コードだけで行った。ワイヤーフレーム版 37 の画像、実機、ブラウザの描画は見ていない。
- その後 `impl/main` に I-0・I-1・I-4・I-6・I-7・I-9 が merge され、I-5 がレビュー中(§6 の進捗)。差分の記述は照合時点のもので、直った項目は §6 で示す。
- パスは `web/src/` からの相対。「確認」はコードと画像から読み取れた事実、「推測」は実機で見ていない判断、「未確認」は画像・実機で確かめていないもの。

## 方針と決定の状態

方針は「実装を Figma に合わせる」。ただし、チームが確認した範囲は次までで、方針の全体は未確認。
- 確認済み: `design-system/decisions.md`(2026-11-22・23)の「トークンと部品の元は Figma にする」。looky-looky と naoto-anzai が確認した。チーム全体は未確認(同ファイルに「チームは未確認」とある)。
- 未確認: 「画面の構成・文言まで全部 Figma に合わせる」こと。これは上の決定を実装全体に広げた方針で、チームの確認は #167 に挙げてある。
- Figma と DS 仕様・ワイヤーフレームが食い違う項目は、DS 仕様を先に更新(または Figma を直す)してから合わせる。実装を先に Figma へ寄せない。
  - L1: FilterBand.md は「『〇〇』で絞り込み中・N 件」、Figma は「〇〇で絞り込み中」。
  - L2: StampCongestionPicker.md と ワイヤーフレーム V1f は「とても混んでいる」、Figma は「混んでいる」。

### 決定済み(ユーザー、2026-11-24)
1. コンパスボタンは残す。M-02 の受け入れ条件「コンパスで北に戻す」を満たす手段がほかに無い(`map/interaction.ts` の回転は Shift+ドラッグと右ボタンだけ)。Figma には無い差として記録する。Figma 側に足すかはチーム確認(#167)。
2. ライトテーマは、`data-theme` を OS の設定(prefers-color-scheme)に追従させて使う。根拠と、実機で見比べて確定する条件は §1 の「配色の切り替え」に書く。
3. 混雑スタンプの丸の数字は、DS(StampMark.md)を正として戻す。Figma の StampMark は数字なしなので、Figma 側の更新が要る。「Figma に合わせる」の例外。

### 方針(ユーザーの意向、チーム未確認)
4. スタンプを押す画面の緯度・経度の数値は外す(Figma に無い。個人の位置を画面に出す必要が薄い)。ただし I-8 の受け入れ条件に、「この地点が公開されます」の開示と精度の表示を残すことを入れる。
5. 地図の建物を Figma の MapBackdrop に合わせて平面にするか(M23)は、地図の層の別 PR で扱う。立体が意図的か(モック由来)を確認する。
6. Noto Sans JP を使うか、使う場合の同梱方法(§6「決める事項」)。
7. カメラ画面でもタブバーを出す(Figma の TabBar に「カメラ」選択の状態がある)。ワイヤーフレームでの確認が要る。

「要確認・未決」の一覧は §4 に 1 か所にまとめる(#167 と対応)。

---

# Figma と来場者アプリの差分レポート

## 0. 要約

- 高の差分: 10 件(§2)。中: 18 件前後、低: 10 件前後(§2〜§3)。
- ユーザーの「画面が Figma に即していない」感覚の主因は 3 つ。
  1. アイコンの部品が無く、記号の文字(✓ × ⚑ ☆ ＃ ⌕ ＋ ↑ 楽 食 良)で代用している。
  2. 地図画面が「地図を全面に置き、部品を重ねる」形でなく、見出し・検索・ボタン・地図を縦に並べたページになっている。地図の部品(StampFab・MapEyeButton・MapZoomButtons・MapLocateButton・DestinationBar)が無い。
  3. 地図の印(EventMark・FacilityMark・ParkingMark・BuildingFlag)が点と文字の札で、Figma の旗・アイコン付きの印になっていない。
- 実装は色・余白・角丸・文字の大きさをトークン経由で正しく使っている部品が多い(PlaceRow、FilterBand、FilterChips、StampView の混雑の色)。差は「部品の構成・アイコン・配置」に集中している。
- 検証の限界は冒頭のとおり。画像で確かめていない判定は「未確認」とした。

### 画像を読めなかった・読みにくかった部品
- Icon: 淡色の背景に淡色のアイコンで、ほぼ判別できなかった(個々のアイコンの形は未確認)。
- PlaceRow・Button・IconButton・TagCreateField・CheckRow・MyStampRow・MapBackdrop の一部: 画像の背景が明るく、ダーク用の淡い文字が背景に溶けて読めない箇所がある。形・色・並びは確認できたが、読めない箇所の判定は「未確認」を含む。
- map-backdrop-dark-45-727: 単色の暗い面だけ(地図背景の色見本)。

### 部品ごとの合致・不一致(44 部品)
凡例: 合致 / 一部(合致しない点あり)/ 不一致 / 未実装(実装に部品が無い)/ 未確認(画像で確かめられていない)。判定は照合時点のもの。

| # | 部品 | 判定 | 一言 |
|---|---|---|---|
| 1 | Button | 不一致(形・変種は確認、文字色は未確認) | 共通部品が無い。画面ごとに外枠だけのボタンを再定義。塗り(主)・黄・赤の変種が無い |
| 2 | Chip | 合致 | FilterChips。32px の見た目と 44px の押下領域、選択時の ✓ まで一致 |
| 3 | Badge | 一部 | 部品が無い。PlaceRow の種別は外枠のみ(Figma は塗りの丸薬)。MyStamp の札は角丸が丸薬でない |
| 4 | CheckRow | 不一致 | TagsView。チェックの箱が文字 ✓、行頭アイコンは文字 |
| 5 | SearchField | 不一致 | 虫眼鏡・消去 × が無い。見出しの文字が常時見える。枠が action-primary |
| 6 | Banner | 一部 | NoLocation は色が合うが、アイコンが文字 `!` `i`。App の app-banner は角丸・アイコン無し |
| 7 | Toast | 不一致 | StampView の panel に埋め込み。画面下に浮かない |
| 8 | EmptyState | 一部 | VisitorList の中に埋め込み。アイコンが文字 ⌕。Guide・Tags は別々の自前 |
| 9 | FilterBand | 合致 | 文言だけ差(Figma「飲食で絞り込み中」/ 実装「『飲食』で絞り込み中」) |
| 10 | TabBar | 不一致 | アイコン無し・選択時の mint 色無し(§2 H1) |
| 11 | Icon | 未実装(アイコンの形は未確認) | 部品が無い。SVG はインラインで 6 ファイルに散在。Figma の Icon 画像が読めず、形は未確認 |
| 12 | IconButton | 未実装 | × は文字。PlaceCard の「閉じる」は文字ボタン |
| 13 | Sheet | 不一致 | 取っ手が中央(Figma は左の短い線)。TagsView だけがシート風。Stamp・PlaceCard は別の作り |
| 14 | PlaceRow | 一部(文字が読めない箇所は未確認) | 種別の塗り・全高の黄線・タグの選択表現が違う |
| 15 | DestinationBar | 未実装 | 地図に出す黄の帯が無い |
| 16 | StampCongestionPicker | 一部 | 色は一致。形(角の丸め・押下)と下の文言は近い。ボタンの外枠は congestion-border |
| 17 | StampFeelingButton | 不一致 | アイコン(顔・フォーク・親指)の代わりに 楽・食・良。ボタンが縦並び |
| 18 | MyStampRow | 一部 | 札の形・文言の組み立て・取り消しボタンの置き方が違う |
| 19 | TagCreateField | 不一致 | 「作る」が入力欄の右に並ぶ形でなく、下の長いボタン「タグを作って付ける」 |
| 20 | BuildingFloorTabs | 一部 | 選択色は一致。件数が mint の丸でなく「N 件」の文字 |
| 21 | BuildingFlag | 未実装 | 旗+企画数の札が無い。企画名の札で代用 |
| 22 | EventMark | 未実装 | 旗の丸が無い。点と名前の札 |
| 23 | FacilityMark | 未実装 | 白い丸+設備アイコンが無い。点のみ |
| 24 | ParkingMark | 未実装 | 青い四角+P が無い。点のみ |
| 25 | StampMark | 一部 | 混雑は丸+数字で近い。感想は漢字、拡大時の札・「+N」まとめが無い |
| 26 | PositionMark | 一部 | 矢印・mint の円・波紋はある。古い(灰色)の状態が無い |
| 27 | DestinationMark | 一部 | 点線・黄の輪はある。旗の丸の印が無い |
| 28 | FormField | 不一致 | 運営画面が素の input/select。枠は border-subtle(Figma は border-control)、エラーの見せ方も別 |
| 29 | LocationPicker | 未実装 | 緯度・経度の文字入力のみ |
| 30 | BuildingShapePreview | 一部 | 輪郭の線だけ。mint の輪郭+塗りの暗い面が無い |
| 31 | DeleteConfirm | 一部 | `<dialog>`。文言は詳細だが、Figma の赤い面・「削除する」を先に置く並びと違う |
| 32 | BuildingFloorPlan | 一部 | 設備の印・名前の吹き出し・「1階・見取り図は仮」の札が無い |
| 33 | MapBackdrop | 一部(道路・建物の詳細は未確認) | 道路・建物の平面図でなく、立ち上げた立体の建物(推測: 意図的な立体表示か要確認) |
| 34 | StampFab | 未実装 | 浮かぶ「スタンプ」ボタンが無い。文字リンク「スタンプを押す」 |
| 35 | MapEyeButton | 未実装 | 「表示」ボタンが無い |
| 36 | MapZoomButtons | 未実装 | ＋/− が無い(ホイール・ピンチのみ) |
| 37 | MapLocateButton | 未実装 | 現在地ボタンが無い |
| 38 | PlaceCard | 一部 | 距離の大きさ、タグのアイコン・選択色、閉じるが文字 |
| 39 | DestinationCard | 不一致 | GuideView。構成(大きな距離・北・黄の文字・アイコン)が別物 |
| 40 | CameraLabel | 一部 | 札は mint の面で近いが、固定形でなく状態の札(現在地 ±8m)・ヒントの札が無い |
| 41 | DataTable | 一部 | 列・位置の状態(設定済み/要確認)・種類の札・選択行が違う |
| 42 | MapHighlight | 一部 | 暗い mint の面+明るい縁でなく、event 色の半透明塗り(低) |
| 43 | BuildingCameraOverlay | 一部(丸薬の色は未確認) | 実装は surface 色の全幅ボタン。Figma は丸薬「PMC LIVE 90 m >」。丸薬の色は、ワイヤーフレーム V3a では白灰、保存済みの BuildingCameraOverlay.png の正面の建物では mint と報告されている(黄は行き先だけ)。画像の読み取りが一致していないため未確認 |
| 44 | map-backdrop-dark-45-727 | 合致(色見本として) | 地図背景は透明で、ページ背景 ink-900(#130a22)が出る。色見本と同系統(低: Figma は少し濃い) |

### イシュー案の見出し(§6 に詳細)
- I-0 トークンの整理(border-control・danger-on・destination-text の取り込み、16 進数の直書きの置き換え)
- I-1 共通部品: Icon・IconButton・Button・Badge・SearchField・EmptyState・Toast・Banner
- I-2 アプリの枠: TabBar(アイコン・選択色)・カメラ画面でもタブを出す
- I-3 地図画面の構成: SearchField・DestinationBar・StampFab・MapEyeButton・MapZoomButtons・MapLocateButton
- I-4 地図の印: EventMark・FacilityMark・ParkingMark・BuildingFlag・DestinationMark・PositionMark(古い)
- I-5 スタンプの地図表示: StampMark(感想アイコン・拡大の札・+N)と dpr の不具合
- I-6 場所のカード・一覧の行: PlaceCard・PlaceRow・Badge
- I-7 案内中: DestinationCard
- I-8 スタンプを押す: Sheet・StampCongestionPicker・StampFeelingButton・MyStampRow・Toast
- I-9 タグ・位置が使えない: CheckRow・TagCreateField・Banner
- I-10 カメラ画面: CameraLabel・BuildingCameraOverlay・状態の札・ミニマップ
- I-11 建物の中の地図: BuildingFloorTabs・BuildingFloorPlan・企画の行
- I-12 運営画面: FormField・LocationPicker・DataTable・DeleteConfirm・BuildingShapePreview
- I-13 重複の整理(別枠の提案): VisitorList と ListView の統合ほか

---

## 1. トークンの照合

確認した事実:
- `app/tokens.ts:19-22` は 11 色(bg-page、bg-surface、text-primary、text-secondary、action-primary、action-on-primary、border-subtle、danger 系、event)だけを `--app-*` として出す。destination・facility・parking・feeling・congestion・stale・state-pressed・skeleton・action-selected-bg・border-control(別経路で取得)は含まない。
- そのため各画面が自分用に色の表を持ち、16 進数を直書きしている(値は tokens.json と一致しているが、複製)。
  - `views/GuideView.vue:18-28`、`views/NoLocationView.vue:27-33`、`ar/ArView.vue:71-85`、`components/FloorPlan.vue`(buildingColors)、`map/layers/buildings.ts:10-25`、`map/layers/route.ts:7-18`、`map/layers/stamps.ts:15-62`、`views/StampView.vue:25-37`
- `border-subtle` を GuideView は `#a78bfa47` と直書き(tokens.json のダークは alpha 0.28 = `#a78bfa47`、一致)。ただし BuildingView/FloorPlan は `rgba(167,139,250,0.28)` と別の書き方で、同じ値が 3 通りの書式で存在する。
- Figma の仮置き変数 border-control・danger-on・destination-text は `design-system/claude-design/tokens.json:321-345` と `tokens.css:41-43` に既にある。DTCG の `tokens.json` には無い(`design-system/decisions.md:140` に記載)。実装では `border-control` だけを `app/tokens.ts:25-26` で読んでいる。`danger-on`・`destination-text` はどこからも参照されていない(確認)。
  - `destination-text` はライトで濃い茶(orange-900)。GuideView で「案内中・総合研究棟 2階」の黄の文字を作る箇所が無い(§2 H7)。
- 配色の切り替え(照合時点): `data-theme` を書き込む箇所がコードに無い(読むだけ)。ダークが既定で、ライトは到達しない。運営画面だけ `light-dark()`(`admin/tokens.ts:27-29`)で OS 設定に従うため、OS がライトだと運営画面だけライトになる(Figma の運営画面はダーク)。
  - 決定: OS の設定に追従して使う(冒頭の決定 2)。「Figma にライトの変種がある」だけでは根拠が弱いので、次を前提として明記する。ワイヤーフレームはライトを「昼の屋外の日なた向けの比較用。実機で見比べる」としている(`doc/screen-design/wireframe.md` のライト V1-a)。行き先の黄の縁と、追加トークン 3 点(border-control・danger-on・destination-text)は仮置き。したがって、OS 追従は実機で見比べて確定する。来場者が切り替える案との比較も、その時に行う。
  - 配線の進捗: I-0(#190)で `app/useThemeAttribute.ts` が入ったが、`App.vue` ではまだ呼ばれていない(確認、9cde1c9)。入れるのは I-2。
  - 未決・確認項目: (a) 運営画面を OS 追従に含めるか。(b) canvas の各層(buildings・route・stamps・me・labels)と `StampView`・`ArView` が、テーマ切り替え時に再描画・再取得されるか。照合時点で、`buildings.ts`・`route.ts` は `canvas.closest('[data-theme]')`、`stamps.ts` は `document.documentElement` を読み、`StampView`・`ArView` は MutationObserver を持つ。読む場所と再描画の契機が揃っていない。
- フォント: `index.html` にも CSS にも Noto Sans JP の読み込みが無い(`@font-face` なし)。端末に無ければ sans-serif に落ちる。コードは端末フォントのみを使う方針(`views/PlaceCard.vue:45` に「端末フォントのみ」のコメント。`views/StampView.vue:64`・`ar/ArView.vue:91` は `font.family.base` の値で、読み込みは無い)。Figma は Noto Sans JP で描いている(低〜中。同梱するか・どう同梱するかは §6「決める事項」)。
- `index.html` の `<title>` が「Hub 試作」のまま(低)。

## 2. 差分(重要度つき)

### 高

**H1 TabBar にアイコンが無く、選択状態が違う**(中ではなく高: 全画面に出る)
- 場所: `App.vue:90-96`、`app/app.css:14-17`
- Figma: TabBar(3 状態)。各タブに 一覧=リスト、マップ=重なった面、カメラ=枠付きの円のアイコン。選択中はアイコンが mint、ラベルが白の太字。非選択はアイコン・ラベルともに淡色。
- 実装: 文字だけ。選択は太字のみで色変更なし。
- 直し方: TabBar 部品(props: `items`、`current`)を作る。アイコンは Icon 部品。選択のアイコン色に `event` トークン、ラベル `text-primary` + bold、非選択は `text-secondary`。高さ 72px(`--app-tab-height`)は現状どおり。

**H2 アイコン部品が無い(記号の文字で代用)**
- 場所: `views/TagsView.vue:263,265`(⚑ ☆ ＃ ✓)、`views/TagsView.vue:239`(×)、`views/PlaceCard.vue:197,199`(✓ ＋)、`components/FilterChips.vue`(✓)、`app/VisitorList.vue:31`(⌕)、`views/NoLocationView.vue:61`(! i)、`ar/ArView.vue:401,425`(＋ ↑)、`views/StampView.vue:85-87`(楽 食 良)、`views/GuideView.vue:150-155`(✓ ?)
- Figma: Icon、IconButton、およびほぼ全部品がアイコン付き。
- 直し方: Icon.vue(SVG のインライン、`name` と `size`)を 1 つ作り、PlaceRow(`components/PlaceRow.vue:114-117`)と FilterBand(`components/FilterBand.vue:37-49`)にあるインライン SVG も移す。Figma の Icon 画像が読めなかったため、アイコンの形は Figma の Icon ページを直接開いて決める必要がある。

**H3 地図画面が「全面の地図+重ねた部品」の構成でない**
- 場所: `views/MapView.vue:84-108`、`app/app.css:30-46`
- Figma: 地図が全面。上に SearchField と Chip、FilterBand、DestinationBar を重ね、右に MapEye・Zoom・Locate、右下に StampFab。
- 実装: 縦並びのページ。「マップ」の h1、検索欄+「検索」ボタン、絞り込み、文字ボタン 3 つ(スタンプを押す / 案内を見る / 位置の設定)、その下に地図(高さ `min-height: 132px` から)、最下に出典の行。地図が画面の一部にしかならない。
- 直し方: `.map-view__canvas` を全面にし、`__controls` を絶対配置の重ねにする。h1 は視覚的に隠す(アクセシビリティ用に残す)。出典は地図の右下の小さな札に。

**H4 地図の部品が 5 つ無い(StampFab・MapEyeButton・MapZoomButtons・MapLocateButton・DestinationBar)**
- 前提: 4 部品(StampFab・MapEyeButton・MapZoomButtons・MapLocateButton)は、`design-system/components/` に仕様の md が無い(DestinationBar.md はある)。I-3 の前に仕様 md を足す(§6 の I-3 前提)。
- 場所: 該当ファイル無し(grep で 0 件)。`views/MapView.vue:98-104` が文字リンクで代用。`map/MapCanvas.vue:176-182` に Figma に無いコンパスボタンがある。
- 直し方: `components/map/` に 5 部品を作り MapView に置く。Zoom・Locate は `MapCanvas` に `zoomBy(±)`・`flyToMe()` の公開メソッドが要る(`MapCanvas.vue:16` の `goal` を操作)。DestinationBar は黄の面 + 「お化け屋敷まで 150 m」+ × で、`案内中` の間だけ出す。コンパスは残す(冒頭の決定 1)。Figma に無い差として記録し、足すかはチーム確認(§4)。

**H5 地図の印が Figma と別物(EventMark・FacilityMark・ParkingMark・BuildingFlag)**
- 場所: `map/layers/labels.ts:97-117`(印は点だけ)、`labels.ts:154-174`(札は名前と「+N」)、`map/layers/buildings.ts:141-163`(輪郭なしの企画は小さな円)
- Figma: EventMark=旗(小さな F の図形)入りの mint の丸。FacilityMark=白い丸+設備アイコン(i、トイレ、休憩、ごみ箱)。ParkingMark=青い角丸四角+P。BuildingFlag=mint の丸薬に「旗+数」(行き先は黄)。
- 実装: 3 種とも同じ形の点(色だけ違う)。駐車場の P、設備のアイコンが無い。建物の企画は「名前+N」の札で、数だけの旗が無い。
- 直し方: `labels.ts` の点の描画を、種類ごとの描画関数(丸+アイコンパス、四角+P)に分ける。BuildingFlag は 同じ建物の企画を 1 つにまとめる既存の処理(`labels.ts:131-148`)の出力を、名前でなく「旗+企画数」の丸薬に変える。名前は拡大時だけ出す(EventMark.md「拡大すると名前」)。Canvas に絵文字・SVG を描くなら `Path2D` にする。

**H6 スタンプの描画位置が dpr ≠ 1 でずれる可能性**(確認したのはコード上の不整合)
- 場所: `map/layers/stamps.ts:114-115`(照合時点 impl/main 7405dbb。I-5 #195 で直す予定でレビュー中。9cde1c9 でも同じ)
- `W = ctx.canvas.width` は device px。`buildings.ts` の `canvasSize`(同 102 行)と `labels.ts` は変換から DPR を割って CSS px を出している。`me.ts:50` と `route.ts:61` は `ctx.canvas.clientWidth || ctx.canvas.width`(CSS px を優先し、取れなければ device px)で、`stamps.ts` だけが device px 固定。`MapCanvas.vue:49` は `setTransform(dpr…)` を掛けるため、dpr=2 では `project()` の中心が 2 倍の幅・高さで計算され、スタンプが建物・ラベルと別の位置に出るはず(推測: 実機未確認)。テストは dpr=1 の偽 canvas。
- 直し方: `canvasSize(ctx)` を使う(me・route も `canvasSize` に揃えるかは別判断)。dpr=2 の偽 canvas のテストを足す。
- 併せて `stamps.ts:19-24` の `theme()` は `document.documentElement` から読む。他の層は `canvas.closest('[data-theme]')`。同じ方式にそろえる(低。上の「テーマ切り替え時の再描画」の確認項目と合わせる)。

**H7 案内中(DestinationCard)の構成が別物**
- 場所: `views/GuideView.vue:141-196`
- Figma: DestinationCard(2 状態)。左に黄の角丸の方向アイコン(進行方向の矢印、着いたら ✓)、上に黄の小さな文字「案内中・総合研究棟 2階」、太字の大きな行き先名「お化け屋敷まで」、右上に大きな距離「150 m」と黄の「北」、「10 秒前に更新・精度 ±8 m」。下に「カメラで見る」(アイコン付き外枠)と「案内をやめる」。着いた状態は説明文+黄の主ボタン。
- 実装: 見出し「案内中」、その下に場所名、「直線距離 約 150 m」「方角:北(北を基準)」の別々の行。距離が目立たない。黄のアクセントは方向アイコンの面のみ。アイコンは SVG の三角(`GuideView.vue:153`)で形も違う。「カメラで見る」にアイコン無し。
- 直し方: 距離を右上に 28px(token の `font.size.4xl`)の太字+単位 m を小さく、方角は黄の文字で距離の下。eyebrow に `destination-text`(ライトで濃い茶)を使う。方向アイコンは Icon の「ナビ矢印」に。

**H8 スタンプを押す画面(StampView)が Figma のシートと別物**
- 場所: `views/StampView.vue:298-372`
- Figma: Sheet(取っ手・「混雑を足元に押す」・説明・閉じる ×)の中に StampCongestionPicker(1〜5、両端に「空いている」「混んでいる」)、StampFeelingButton(顔 / フォーク / 親指のアイコン、桃色の丸)、MyStampRow、Toast「混雑3 を足元に押しました [取り消す]」を画面下に浮かせる。
- 実装: 全画面のページ。「スタンプを押す」の h1+「マップへ戻る」リンク、枠付きの panel が縦に並ぶ(押す地点 / 混雑 / 感想 / 自分が押したスタンプ)。「押す地点」に緯度・経度の数値を出している(`StampView.vue:307`)。感想は 楽 / 食 / 良 の漢字の札+文字を縦に並べる。Toast は panel の 1 つで、浮かない。
- 注: 緯度・経度の数値は Figma に無いので外す(冒頭の方針 4)。ただし「この地点が公開されます」の開示と、位置の精度の表示は残す(I-8 の受け入れ条件)。ワイヤーフレーム版 37 の記載は未確認。
- 直し方: Sheet 部品に載せ替える(地図の上に重ねる)。感想は Icon で。Toast は `position: fixed; bottom: タブの上`。

**H9 カメラ画面がタブを覆い、部品も Figma と違う**
- 場所: `ar/ArView.vue:442`(`.ar-view { position: fixed; inset: 0 }`)、`ar/ArView.vue:155-157`(`views/CameraView.vue` のスロットで「地図 / 企画一覧」のリンクを別に出している)
- Figma: TabBar の「カメラ」選択状態がある(= カメラ画面でも下のタブが見える)。
- 実装: fixed の全面で、DOM 順で後ろにある `<nav class="visitor-tabs">`(`App.vue:90`)を位置付き要素が覆う(推測: 実機で見て確認)。代わりに画面内に別のリンクが並ぶため、タブの切り替えが 2 系統になる。
- 他の差(カメラ部品): ミニマップが円(`ArView.vue:455` `border-radius:50%`、Figma は角丸四角で枠・コーン付き)、十字が全角文字 `＋`(`:401`)、上の状態表示が角丸の面 `<p>`(Figma は「● 現在地 ±8 m・北東を向いています」の丸薬、●は mint または赤)、ヒント「左右にドラッグして向きを合わせる」の丸薬が無い、正面の建物のボタンが surface 色の全幅(`.ar-front`)で、Figma の丸薬「PMC LIVE 90 m >」と形が別物(丸薬の色は未確認。表の 43 行目。黄は行き先の建物だけ)。
- 直し方: `.ar-view` を `position: absolute`(visitor-stage の中)にして TabBar を見せる、または TabBar を fixed の z-index 上位に置く。CameraLabel・BuildingCameraOverlay・状態の丸薬を部品化。

**H10 LocationPicker が無い(運営の位置の入力)**
- 場所: `views/admin/PlacesAdmin.vue:296-300`(緯度・経度の text 入力 2 つ)
- Figma: LocationPicker。暗い地図に建物の輪郭、押した所に黄の旗の丸、下に「まだ置いていません」。ラベル「位置(地図を押して置く)」。
- 直し方: 地図(建物の輪郭の平面)を押して緯度・経度を決める部品を作る。数値入力は補助として残してよい。

### 中

| ID | 差分 | 場所 | Figma | 直し方 |
|---|---|---|---|---|
| M1 | PlaceCard の距離が小さい | `views/PlaceCard.vue:279` 20px | PlaceCard: 28px 太字、単位 m と「直線」が小さい | `font.size.4xl` と単位の分離 |
| M2 | PlaceCard のタグにアイコン無し、選択色が違う | `PlaceCard.vue:197-199,293` | アイコン(ブックマーク・星・＋)、選択時は薄い violet 面+violet 枠+アイコンが violet | アイコンを足し、`.tag[aria-pressed]` を `action-selected-bg` と `action-primary` の枠に |
| M3 | PlaceCard の「閉じる」が文字ボタン | `PlaceCard.vue:204` | 44px の IconButton(×) | IconButton に置換。「ここへ向かう」にナビのアイコンを足す |
| M4 | PlaceCard が `position: fixed`(App の overlay と二重に位置指定) | `PlaceCard.vue:232`、`app/app.css:9` | シート内の部品 | 位置は呼び出し側(visitor-overlay)に任せ、PlaceCard は中身だけに(推測: 重なりの不具合の元) |
| M5 | PlaceRow の種別が外枠のみ | `components/PlaceRow.vue:172-176` | Badge(薄い violet の塗りの丸薬) | Badge に置換 |
| M6 | PlaceRow の行き先の黄線が短い | `PlaceRow.vue:194-202`(高さ 16px) | 行の全高の 4px の黄線 | `top:0; bottom:0; width:4px` |
| M7 | PlaceRow のタグボタンの選択が面つき | `PlaceRow.vue:190` | アイコンだけが violet に塗られる。面なし | `background` を外し、`color: action-primary` |
| M8 | PlaceRow の距離の太さ | `PlaceRow.vue:177` 通常の太さ・secondary | 太字・secondary | `font-weight: 700` |
| M9 | SearchField にアイコン・消去が無く、枠色が違う | `app/app.css:30-35`(border `action-primary`)、`app/VisitorList.vue:283-288` | 虫眼鏡、入力中は右に ×。枠は border-control。ラベルは見えない | 部品化、見出し文字は `visually-hidden`。map と list の両方で使う |
| M10 | ボタンの共通部品が無い | `app/app.css:14-20`、`views/PlaceCard.vue:281-294`、`VisitorList.vue:353-368`、`TagsView`、`NoLocationView.vue:148-`、`StampView.vue:402-419` | Button(主=violet 塗り、副=外枠、行き先=黄、危険=赤。大・中・小) | Button.vue を作り各画面で置換。主ボタン(「位置の利用を許可」「タグを作って付ける」など)が外枠のままのものを塗りに |
| M11 | StampFeelingButton の見た目 | `StampView.vue:340-345,430` | 横並びの角丸ボタン。左に桃色の丸+アイコン、右に文字。無効は淡色 | 横並び・アイコン、`opacity` でなく Figma の淡色 |
| M12 | MyStampRow | `StampView.vue:353-370,432-434` | 行全体が薄い枠。札は丸薬(感想は桃色+黒の枠+アイコン)、「10 分前・あと 20 分」、右に外枠の取り消し | 札を丸薬+アイコン、時刻と残りを 1 行に |
| M13 | Toast が浮かない | `StampView.vue:348-351` | 画面下に浮かぶ濃い面+「取り消す」 | 部品化して fixed |
| M14 | CheckRow に箱が無い | `views/TagsView.vue:261-266,304-307` | 左に行頭アイコン、右に角丸の箱(選択時は violet 塗り+黒い ✓)。下に「最初からあるタグ」の淡い文字 | 箱の部品。✓ はアイコン |
| M15 | TagCreateField の並び | `TagsView.vue:269-278` | 入力欄+右に「作る」(violet 塗り)の 1 行。エラーは桃色で下 | 1 行にして、ボタンの文言は「作る」(作って付ける説明は補足に) |
| M16 | Sheet の取っ手の位置と TagsView のシート | `TagsView.vue:288`(中央・44px 幅)、`.tags-page { min-height:100dvh }`(`:285`) | 取っ手は左の短い線。見出し+説明+右上 × | 取っ手を左へ。`visitor-overlay` の `max-height:65%`(`app.css:9`)と全高指定がぶつかる(推測) |
| M17 | BuildingFloorTabs の件数 | `views/BuildingView.vue:83-85` | mint の丸の中に数字(「2階 ①」) | 件数を丸いバッジに |
| M18 | BuildingFloorPlan | `components/FloorPlan.vue:86-130` | mint の縁+暗い面+内部の格子、企画は mint の点、選択時は白い吹き出しに名前、設備は白い丸+アイコン、右上に「1階・見取り図は仮」の札 | 設備の印・名前の吹き出し・階の札を足す。設備を企画に含めない決定(D-030)は維持しつつ印としては出す |
| M19 | 建物の中の企画の行が PlaceRow でない | `BuildingView.vue:113-120` | PlaceRow(種別 Badge+距離) | PlaceRow を再利用 |
| M20 | DataTable の列と表現 | `views/admin/PlacesAdmin.vue:254-278` | 名前(上)+建物名(下)、種別、種類(丸薬)、位置の状態(mint の「設定済み」/ 桃の「要確認」)、操作(外枠の「編集」/ 編集中) | 列を Figma に寄せる。位置を緯度・経度の数値でなく状態に |
| M21 | 運営の FormField・DeleteConfirm | `PlacesAdmin.vue:286-312,335-`(dialog) | 暗い入力欄+ border-control、エラーは赤枠+桃の文。削除は赤い面の確認で「削除する」(赤塗り)を左、「やめる」を右 | 枠色を border-control に。削除の確認を Figma の構成に。ボタンの並び順(現状は「キャンセル」が先)を合わせる |
| M22 | BuildingShapePreview | `views/admin/LandmarksAdmin.vue:355-365` | 暗い枠の中に mint の縁+暗い面、無い時は「形なし(カメラの正面に出ない)」を中央に | 部品化(面の塗りと縁) |
| M23 | MapBackdrop(推測) | `map/layers/buildings.ts:136-199` | 建物の面は ink-700 の塗り+violet-400 の縁の平面図。道路の細い帯もある | 現在は立体(壁と屋根)に描く。立体は意図的(モック由来)で、Figma は平面のスナップ。どちらを正とするか要確認(§4) |
| M24 | 古い現在地の状態が無い | `map/layers/me.ts` | PositionMark.md「古い=灰色(text-disabled)」 | `stale` を持たせて色を `text-disabled` に |
| M25 | NoLocation の Banner アイコン | `NoLocationView.vue:61` | 警告の三角アイコン+太字 | Icon の `warning`。なお `idle`・`asking` でも赤い面(`danger`)なのは、Banner の info 変種が無いため(推測) |

### 低
- L1 FilterBand の文言: 「『飲食』で絞り込み中」(`FilterBand.vue:51`)、Figma は「飲食で絞り込み中」。DS(FilterBand.md)は「『〇〇』で絞り込み中・N 件」なので、DS を先に更新するか Figma を直す。
- L2 StampCongestionPicker の下の文言「とても混んでいる」(`StampView.vue:333`)→ Figma は「混んでいる」。DS(StampCongestionPicker.md)と V1f は「とても混んでいる」なので、DS を先に更新するか Figma を直す。
- L3 PlaceCard の地図上の重なり順: `app/app.css:9` の `.place-card { bottom: … }` が `PlaceCard.vue:234` の `bottom` と二重。
- L4 `map/MapCanvas.vue:192` の `var(--panel-solid, #fff)` は未定義の変数。フォールバックの白がダークでも出る。コンパスは残すので `--app-bg-surface` に直す。
- L5 `index.html` の `<title>` が「Hub 試作」。
- L6 Noto Sans JP の読み込み無し(§1)。
- L7 MapHighlight: 実装は event 色の半透明(`buildings.ts:171-185`)、Figma は暗い mint の面+明るい mint の縁。
- L8 `.visitor-app :where(button, a, input):focus-visible` と各画面の個別 outline の太さが混在(2px と 4px)。
- L9 PlaceRow の `min-height: 44+12=56px`(`:128`)。Figma の行高は約 50px(推測、画像からの目測)。
- L10 DestinationMark に旗の丸が無い(輪のみ。`route.ts:92-107`)。

## 3. Figma にあって実装に無い部品 / 実装にあって Figma に無いもの

Figma にあって実装に無い: Icon、IconButton、Button、Badge、SearchField、Toast、EmptyState(部品として)、TabBar(部品として)、Sheet(共通部品として)、DestinationBar、StampFab、MapEyeButton、MapZoomButtons、MapLocateButton、BuildingFlag、EventMark、FacilityMark、ParkingMark、LocationPicker、FormField、DataTable、DeleteConfirm、CameraLabel、BuildingCameraOverlay。

実装にあって Figma に無い:
- コンパスボタン(`map/MapCanvas.vue:176-182`)。残す(冒頭の決定 1)。差として記録し、Figma に足すかはチーム確認。
- StampView の「押す地点:緯度・経度」と「位置の利用を許可する」ブロック(`StampView.vue:304-316`)。緯度・経度の数値は外す(方針 4)。
- GuideView の「方角:北(北を基準)」の独立した行(Figma は距離の横に「北」)。
- ArView の起動前の画面 `.ar-start`(「カメラを起動」)。Figma に無い。許可の取得に必要なため、Figma 側に足すのが筋。
- App の `app-banner`(アプリの更新・場所の取得失敗)。Banner の用途としては合うが、Figma の変種に無い(要追加)。
- VisitorList の「検索語を消す」ボタン(`VisitorList.vue:288`)。SearchField の × に置き換える。
- 運営画面の `AdminErrorBanner`、一覧の「再読み込み」ボタン。

## 4. 要確認・未決
決定済みは冒頭に移した。ここは未決だけ。チームで決める事項は #167(「Figma に合わせる修正で新しく挙げるもの」)に追記してあり、同じ内容。
1. 「全部 Figma に合わせる」方針のチーム確認(`decisions.md` の確認は looky-looky・naoto-anzai まで)。
2. DS 仕様の更新: FilterBand.md(L1)・StampCongestionPicker.md(L2)を Figma に合わせるか。地図の 4 部品(StampFab・MapEye・MapZoom・MapLocate)の仕様 md を足す。
3. 混雑スタンプの数字: Figma の StampMark を DS に合わせて直す。色だけに頼らない方針(縁・形)も決める。
4. コンパス: Figma に足すか、差として記録に留めるか。
5. ライトの OS 追従: 実機で見比べて確定。運営画面を含めるか。canvas 各層のテーマ切り替え時の再描画の確認。
6. 地図の建物を立体のままにするか平面にするか(M23)。I-4(#196)merge 後の建物名の出し場所(Figma の BuildingFlag に名前が無く、F5「いまいる建物が分かる」に影響。DestinationBar と合わせて決める)。
7. Noto Sans JP を使うか、同梱方法。
8. カメラ画面で TabBar を出す想定か(ワイヤーフレームで確認)。
9. Badge の種別ごとの色(I-6)、Banner の info 変種(I-9)を I-1 の部品に足すか。
10. 丸薬が重なりで省かれた建物は押せない(I-4)。

## 5. 実装の重複(共通部品化の提案は別枠)

確認した事実:
- **VisitorList と ListView**: `app/VisitorList.vue` は `views/ListView.vue` の「暫定コピー」(冒頭のコメントで認めている)。差は `useAppTokens` と表示対象の絞り込み。`App.vue:80` は `VisitorList` を使うため、`ListView.vue`(374 行)・`SearchView.vue` は実質使われない。S-01 の owns は ListView・SearchView・PlaceRow だけで、VisitorList は S-08 の owns(`app/**`)。
- **EmptyState** が `VisitorList.vue:23-37` に埋め込み。`GuideView.vue:189-194`、`TagsView.vue:253-257` にも別の自前。
- **ボタンの CSS** が 6 ファイルにほぼ同じ 10 行で複製(M10)。
- **入力欄の CSS** が `app.css:30-35` と `VisitorList.vue:342-355` と `TagsView.vue` で複製。
- **色の表**: GuideView・NoLocation・ArView・FloorPlan・buildings・route・stamps の 7 箇所(§1)。`buildings.ts:10-25` と `route.ts:7-18` は同じ表のコピー(コメントで「一方向で共有」とあるが、実際は別の定数)。`labels.ts:5` は buildings から import。
- **テーマの検出**: `useAppTokens`(`app/tokens.ts`)、`useBuildingTokens`(`FloorPlan.vue`)、`ArView.vue:76-80`、`stamps.ts:19-24`、`buildings.ts:27-31`、`route.ts:23-26`、`StampView.vue` の MutationObserver が、それぞれ同じ処理を持つ。
- **cssColor/dimension 関数**が `app/tokens.ts:6-15` と `views/PlaceCard.vue:11-23` で複製。
- **FloorPlan の座標変換**と **MapCanvas の project** が別実装(別の目的のため重複ではない)。

共通部品化の提案(別枠・Figma の合致とは別の整理):
1. `ui/` に Icon・IconButton・Button・Badge・SearchField・Toast・Banner・EmptyState・Sheet。
2. `app/tokens.ts` が全トークンを CSS 変数で出し、各画面は `var(--app-…)` だけを使う。Canvas 層は `getComputedStyle` で読むか、`mapColors` を 1 つに統合。
3. VisitorList と ListView を統合し、ListView が表示対象を props で受ける(VisitorList のコメントが言う「契約」)。

## 6. 修正のイシュー案(WBS の新規タスクとして)

### 進捗(`gh pr list` で確認、2026-11-24)
| タスク | PR | 状態 |
|---|---|---|
| I-0 トークンの整理 | #190 | merge 済み |
| I-1 共通部品の土台 | #191 | merge 済み |
| I-7 案内中 | #192 | merge 済み |
| I-6 場所のカード・一覧の行 | #193 | merge 済み |
| I-9 タグ・位置が使えない | #194 | merge 済み |
| I-4 地図の印 | #196 | merge 済み |
| I-5 スタンプの地図表示 | #195 | レビュー中 |
| I-2・I-3・I-8・I-10〜I-13 | - | 未着手 |

### owns の扱い(新規 WBS タスクとして定義し直す)
`doc/impl/wbs.yaml` は完了済みタスク(F-3、S-xx、R-02、M-xx、O-xx、S-08 など)の定義だけで、I-0 以降は載っていない。そのため、I-x の担当ファイルの根拠が無く、担当が曖昧になっている。次のとおり、I-0〜I-13 を新しい WBS タスクとして `wbs.yaml` に足し、owns を各タスクの「担当」に書いたファイルとする(足すのは別の PR)。元のタスクはすべて完了済みなので、元の owns との重なりは並行作業の衝突にはならない。重なるのは I-x 同士で、次の「決める事項」で決める。

- 共有の `web/package.json`・`pnpm-lock.yaml`・router は触らない。依存の追加が要るもの(フォントの同梱など)は基盤タスクとして別 PR。
- 新しいファイルは新ディレクトリ(`web/src/components/ui/`、`web/src/components/map/`、`web/src/components/admin/`)に置く。

### 決める事項(着手前に)
1. `app/app.css` は I-0・I-2・I-6 が触る。I-0・I-6 は merge 済みで(I-6 が `.place-card` の重複指定を外したことを 9cde1c9 で確認)、残るのは I-2 だけ。以後 `app.css` は I-2 が持ち、他のタスクが触る必要が出たら I-2 の後に行う。
2. `MapView.vue`(S-08 の owns)は I-3 が担当、`App.vue`(S-08 の owns)は I-2 が担当。I-3 が `App.vue` を触る必要が出たら、I-2 の後に行う。同じファイルを I-2 と I-3 が同時に触らない。
3. canvas 用のアイコンは、I-1 の Icon(SVG のインライン)と別形式の `Path2D`(24 格子のパス文字列)。置き場は、照合後の実装では `map/layers/buildings.ts`(`drawIcon`、134 行付近)にある。I-1 の Icon が持つパスと二重にならないよう、パス文字列の置き場を 1 つにするか(例: `components/ui/iconPaths.ts` を I-1 の Icon と canvas が共に読む)を決める。
4. I-8 の Sheet と I-1 の二重の可能性: Sheet は I-1 の Icon 群に含まれていない(I-1 の merge 済みの部品は Icon・IconButton・Button・Badge・SearchField・Toast・Banner・EmptyState)。Sheet は I-8 で新規に作る。I-2(TabBar)や I-3(地図の上のシート)も Sheet を使うなら、I-8 より先に Sheet を独立したタスクで作る。
5. 担当者: 未割り当て。各タスクを誰が持つかを決める。
6. Noto Sans JP の同梱方法: コードは端末フォントのみ(§1)。同梱するなら、依存(`@fontsource/noto-sans-jp` など)かファイル同梱かを決める。外部から読み込まない方針なら、サブセットのファイルを `web/public/` に置く方法がある。基盤タスク(F-3 相当)として別 PR。
7. 地図の 4 部品の仕様 md(次の I-3 の前提)。

### 前提タスク: 地図の 4 部品の仕様 md の追加
- 担当: 新規 `design-system/components/{StampFab,MapEyeButton,MapZoomButtons,MapLocateButton}.md`(doc のみ)。
- やること: 他の部品の md(DestinationBar.md など)と同じ書式で、props・状態・押下領域・アクセシビリティを書く。Figma の 17:2 を元にする。MapEye が切り替える層の props もここで決める。
- I-3 はこの仕様 md の merge 後に着手する。

### I-0 トークンの整理
- 担当(新規・既存): `web/src/app/tokens.ts`(S-08)、`web/src/app/app.css`(S-08)。
- やること: `border-control`・`danger-on`・`destination-text`・`destination`・`facility`・`parking`・`feeling`・`congestion-*`・`stale`・`state-pressed`・`skeleton`・`action-selected-bg` を `--app-*` として出す(ダーク・ライト)。`design-system/` の DTCG `tokens.json` に 3 つの仮置き変数を入れるかは別判断(本イシューでは claude-design 側の値を読む)。
- 受け入れ条件: `--app-destination` などが `getComputedStyle` で取れる。単体テストで 3 色(border-control、danger-on、destination-text)のダーク・ライトの値が tokens と一致。既存の画面の見た目は変わらない。

### I-1 共通部品の土台
- 担当: 新規 `web/src/components/ui/{Icon,IconButton,Button,Badge,SearchField,Toast,Banner,EmptyState}.vue` と各テスト。既存ファイルは触らない。
- やること: Figma の各部品(状態: default・pressed・disabled、サイズ、変種)を props で再現。Icon は Figma の Icon ページから必要なものを SVG で。押下領域 44px、`aria-label` を必須 props に。
- 受け入れ条件: 各部品が Figma の全状態を描ける(テストまたは Storybook 風の一覧ページを `?` で確認)。Button の 4 変種(主・副・行き先・危険)×3 状態。IconButton は 44px。コントラストは仕様どおり。

### I-2 アプリの枠: TabBar
- 担当: `web/src/App.vue`(S-08)、`web/src/app/app.css`(S-08)、新規 `components/ui/TabBar.vue`。
- やること: H1。アイコン・選択の mint・太字。`App.vue` で `useThemeAttribute`(I-0 で追加済み)を呼び、`data-theme` を OS に追従させる(canvas 各層の再描画の確認は §4-5)。H9 のうち「カメラ画面でもタブを出す」側(`.ar-view` を fixed でなく stage 内に収める変更は I-10)。
- 受け入れ条件: 3 状態が Figma と一致。`aria-current`、押下領域 44px 以上、高さ 72px。`App.test.ts` が通る。

### I-3 地図画面の構成
- 担当: `web/src/views/MapView.vue`(S-08)、`web/src/map/MapCanvas.vue`(M-02: `zoomBy`・`flyTo`。コンパスは残す)、新規 `web/src/components/map/{DestinationBar,StampFab,MapEyeButton,MapZoomButtons,MapLocateButton}.vue`。
- 前提: 地図の 4 部品の仕様 md(上の前提タスク)。
- やること: H3・H4。地図を全面、部品を重ねる。コンパスは残す(`MapCanvas` の北に戻す手段を維持)。SearchField(I-1)・Chip・FilterBand を上に。Eye は 非表示にする層を切り替える(仕様 MapEyeButton の props を `design-system` に追加が必要か要確認)。
- 受け入れ条件: Figma の MapBackdrop 上の配置と一致(右の縦並び、右下の FAB)。Zoom・Locate が動く。既存の遷移(スタンプ・案内・位置が使えない)がすべて残る。`router/journeys.test.ts` が通る。

### I-4 地図の印
- 担当: `web/src/map/layers/labels.ts`・`buildings.ts`(M-03)、`web/src/map/layers/route.ts`・`me.ts`(M-04)、各 `*.test.ts`。
- やること: H5・M24・L10。種類別の印(旗の丸、設備アイコン、P)、BuildingFlag の「旗+数」。DestinationMark の旗の丸。PositionMark の古い状態。色の表は I-0 に寄せる。
- 受け入れ条件: 各印が Figma と一致(ダーク・ライト)。押下領域 44px(`hitTest` で確認)。既存のテストが通り、種類別の描画のテストを追加。

### I-5 スタンプの地図表示
- 担当: `web/src/map/layers/stamps.ts`・`stamps.test.ts`(M-05)。
- やること: H6 の dpr の不具合、感想のアイコン(Path2D、置き場は上の決める事項 3)、拡大時の札「混雑4 6分 +5」、近いスタンプのまとめ(24px)。混雑の丸の数字は DS を正として入れる(Figma は数字なし)。
- 受け入れ条件: dpr=2 の偽 canvas で位置が CSS px 基準。まとめの代表(混雑は新しい方、感想は多い種類)。Figma の StampMark(丸の大きさ・色)と一致。

### I-6 場所のカード・一覧の行
- 担当: `web/src/views/PlaceCard.vue`・`PlaceCard.test.ts`(S-02)、`web/src/components/PlaceRow.vue`・`PlaceRow.test.ts`(S-01)。
- やること: M1〜M8、L3。Badge・Icon・IconButton・Button を使用。`position: fixed` を外し、App の overlay に任せる(`app/app.css` の該当行は I-2 側で一緒に直すか、本イシューで `app.css:9` の 1 行だけを許可)。
- 受け入れ条件: Figma の PlaceCard 4 状態・PlaceRow 8 状態に一致。44px。既存の挙動(タグの切り替え、フォーカスのトラップ)が変わらない。

### I-7 案内中
- 担当: `web/src/views/GuideView.vue`・`GuideView.test.ts`(S-03)。
- やること: H7。DestinationCard の 2 状態(案内中・着いた)。
- 受け入れ条件: Figma と一致。到着の判定と文言(「会場は 2 階の廊下です…」に相当する説明)は既存のロジックを使う。ライトで eyebrow が濃い茶。

### I-8 スタンプを押す
- 担当: `web/src/views/StampView.vue`・`StampView.test.ts`(S-04)。
- やること: H8、M11〜M13、L2。Sheet(新規 `components/ui/Sheet.vue` を I-1 に含めてもよい)。
- 受け入れ条件: Figma の Sheet・Picker・Feeling・MyStampRow・Toast と一致。緯度・経度の数値は外し、「この地点が公開されます」の開示と精度の表示は残す。混雑スタンプの丸の数字は DS(StampMark.md)のとおり(Figma は数字なしだが DS を正とする)。押下・取り消し・期限の既存テストが通る。

### I-9 タグ・位置が使えない
- 担当: `web/src/views/TagsView.vue`・`TagsView.test.ts`(S-05)、`web/src/views/NoLocationView.vue`・`NoLocationView.test.ts`(S-06)。
- やること: M14〜M16、M25。CheckRow・TagCreateField・Banner。
- 受け入れ条件: Figma の CheckRow(2 状態)・TagCreateField(通常・エラー)・Banner と一致。IME の確定中に送信しない既存の挙動が変わらない。

### I-10 カメラ画面
- 担当: `web/src/ar/ArView.vue`・`ArView.test.ts`(R-02)、`web/src/views/CameraView.vue`(R-02)、新規 `components/ui/{CameraLabel,BuildingCameraOverlay}.vue`。
- やること: H9。タブを覆わない、ミニマップを角丸四角、状態の丸薬(● と文言)、ヒントの丸薬、十字、正面の建物の丸薬(色は I-10 の前にワイヤーフレーム V3a と BuildingCameraOverlay.png を突き合わせて決める)。
- 受け入れ条件: Figma の BuildingCameraOverlay・CameraLabel の全状態と一致(丸薬の色は V3a と突き合わせて決める)。カメラ起動前・拒否時の既存の挙動が変わらない。画面にタブが見える。

### I-11 建物の中の地図
- 担当: `web/src/views/BuildingView.vue`・`BuildingView.test.ts`、`web/src/components/FloorPlan.vue`・`FloorPlan.test.ts`(S-07)。
- やること: M17〜M19。FloorTabs の件数バッジ、設備の印、吹き出し、階の札、企画を PlaceRow に。
- 受け入れ条件: Figma の BuildingFloorTabs(3 状態)・BuildingFloorPlan(2 状態)と一致。企画は PlaceRow で出る。

### I-12 運営画面
- 担当: `web/src/views/admin/{PlacesAdmin,LandmarksAdmin,FloorPlansAdmin,LabelsAdmin}.vue` とテスト(O-02〜O-05)、`web/src/admin/tokens.ts`・`views/admin/AdminLayout.vue`(O-01)、新規 `components/admin/{FormField,LocationPicker,DataTable,DeleteConfirm,BuildingShapePreview}.vue`。
- やること: H10、M20〜M22。運営画面をライトの OS 追従に含めるかを §4-5 で判断(含めない場合は `admin/tokens.ts` の `light-dark()` をダーク固定に)。大きいため、2 PR に分ける案(12a: FormField・DataTable・DeleteConfirm、12b: LocationPicker・BuildingShapePreview)。
- 受け入れ条件: Figma の各部品の全状態と一致。位置を地図で置ける。既存の API 呼び出し・検証・フォーカスの挙動が変わらない。

### I-13(別枠・提案)重複の整理
- 担当: `web/src/app/VisitorList.vue`(S-08)、`web/src/views/ListView.vue`・`SearchView.vue`(S-01)。
- やること: §5 の 3。ListView を唯一の一覧にし、VisitorList を削除。
- 受け入れ条件: 一覧・検索の画面の挙動と見た目が変わらず、重複コードが消える。`App.test.ts`・`ListView.test.ts`・`SearchView.test.ts` が通る。
- 注意: S-01 と S-08 の両方の owns を跨ぐため、他のイシュー(I-6 は PlaceRow を触る)と同時に走らせない。

### 担当の衝突の確認
- I-2(App.vue、app.css)と I-0 は `app.css` が重なるが、I-0 は merge 済みで解消。
- I-3(MapView、MapCanvas)・I-4(labels、buildings、route、me)・I-5(stamps)は互いに重ならない。
- I-6(PlaceCard、PlaceRow)・I-13(VisitorList、ListView)は PlaceRow の呼び出し側で接する(挙動は変えないが、I-13 を I-6 の後に)。
