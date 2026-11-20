# 棚卸しの実例: マップのモック(`ar-guide/mock/index.html`)

- status: proposed(AI の読み取り。チームの確認前)
- 対象: PR #5(`feat/ar-guide-stamp-filter`、fore0111)のブランチにある `ar-guide/mock/index.html`(841 行)。#4・#5 は `main` に merge されていない(draft)。
- 確認状態: **一部のみ確認**。ソースを読み、色のコントラスト比を計算した。**ブラウザで描画しての見た目、実機での操作は確かめていない。**
- 画面の幅: 390px の端末枠が前提。

## 1. トークンの元(CSS 変数)

| 変数 | 値 | 使われ方(読み取り) | 意味の案(【推論】) |
|---|---|---|---|
| `--bg` | #130a22 | アプリ全体の背景 | `color.surface.base` |
| `--panel` | rgba(28,16,50,.9) | 検索バーなど(半透明) | `color.surface.overlay` |
| `--panel-solid` | #1c1032 | 結果リスト、場所カード | `color.surface.raised` |
| `--line` | rgba(167,139,250,.2) | 枠線 | `color.border.default` |
| `--violet` | #6d28d9 | 強調の背景 | `color.accent.strong` |
| `--lilac` | #a78bfa | 強調 | `color.accent.soft` |
| `--leaf` | #10b981 | 結果行の点 | `color.status.ok` |
| `--mint` | #5eead4 | カードの場所名 | `color.text.accent` |
| `--yel` | #ffd84a | 「ここへ向かう」ボタン | `color.action.primary` |
| `--ink` | #1e0b3a | 黄色ボタン上の文字 | `color.text.on-action` |
| `--text` | #f4f0ff | 本文 | `color.text.default` |
| `--sub` | #b4a9cf | 補足の文字 | `color.text.muted` |
| `--jp` / `--en` | フォント | 日本語 / 英数字 | `font.family.*` |

直書きの値(トークンの候補): 角丸 8 / 12 / 14 / 16 / 18px、文字 12 / 13 / 15 / 18px、ボタンの高さ 32 / 44 / 48px。

## 2. 部品の候補(class・id から。画面は 1 枚のマップ上に重ねる構成)

| 部品(候補名) | 読み取った構造 | 概念との対応(【推論】) | 状態 |
|---|---|---|---|
| 検索バー | 入力 + 消去ボタン(`.clear` 32×32) | Search | 入力あり / なし(消去が出る) |
| 絞り込みチップ | `.chip`(高さ 32、5 個) | Labeling(filtering) | 選択 / 非選択 |
| 結果リスト・結果行 | `.row`(点 + 名前 + 補足) | Place、Search | 空(`.empty`) |
| 操作ボタン群 | スタンプ / 向きを戻す / 現在地(各 44×44) | Stamp、Position | - |
| 位置なしバナー | `.band`: 「位置の利用を許可」「地図で指定する」 | Position(allow / setManually。OQ-2) | 表示 / 非表示 |
| 場所カード | 場所名・見出し・説明・距離と時間・タグ・「ここへ向かう」「案内をやめる」「閉じる」 | Place、Destination、Labeling | 通常 / 案内中 |
| タグボタン | `.tagbtn`(お気に入り、行きたい。`aria-pressed`) | Labeling(自分用の印) | 押している / いない |
| 場所の一覧 | `.list` | Place | - |
| スタンプのシート | 種類のボタン(5 個と 3 個)+ 押したスタンプの一覧(`.stl`) | Stamp(OQ-4 は仮置き) | - |
| トースト | 通知の文 | - | 表示 / 非表示 |

## 3. 機械で確かめたこと(AI が計算。パネルは半透明だが、不透明の色で計算した)

| 文字色 / 背景 | コントラスト比 |
|---|---|
| `--text` / `--panel-solid` | 16.0 |
| `--sub` / `--panel-solid` | 8.1 |
| `--mint` / `--panel-solid` | 12.1 |
| `--lilac` / `--panel-solid` | 6.6 |
| `--ink` / `--yel` | 13.0 |
| `--text` / `--violet` | 6.4 |

→ 文字として、この組はすべて 4.5 を超えている(基準はチームで決める。ここでは WCAG の AA の通常文字を目安にした)。**屋外の明るい場所での見え方は、人間が実機で確かめる。**

## 4. 人間が決めること(AI は決めない)

- [ ] このモックの見た目(紫と黄色)を、デザインシステムの出発点として採るか
- [ ] 押せる大きさの基準。`.clear` と `.chip` は高さ 32px、他のボタンは 44px。揃えるか
- [ ] 補足の文字が 12 / 13px。屋外・歩きながらで足りるか(実機で)
- [ ] 部品の分類・命名の方針(ステップ 2)

## 5. 他の層との食い違い・要確認

- スタンプの種類(5 + 3)と混雑の許容時間 30 分は、PR #5 でも仮置き(OQ-4)。部品の props にするかは、API 設計の回答待ち。
- 位置が取れないときの見せ方(OQ-2)、来場者の識別と保存先(OQ-12)も仮置き。
- AR 画面(`ar-guide/index.html`)の部品は、まだ棚卸ししていない。
