# デザインシステムの「記述の仕方」資料

出どころ: 別セッションの調査(リンクは 2026-11-20 に検索で確認した時点のもの。リンク切れの可能性がある)。この skill 作成時に、こちらで開いて再確認はしていない。使う前に確かめる。

結論: 書籍は「何を言葉にすべきか」を扱い、形式の規定は標準化団体や実践者の記事が担う。形式の面を 1 つで決定的に述べる本はない。

## 記述の層と、この skill のステップとの対応

| 層 | 問い | 主な資料 | ステップ |
|---|---|---|---|
| 概念 | 何でできているか | Kholmatova『Design Systems』 | 1 |
| 構造・分類 | 部品をどう分類・階層化するか | Frost『Atomic Design』、Curtis「Classification in Design Systems」 | 2 |
| 値(トークン) | 色・余白を機械可読にどう書くか | DTCG 仕様 2025.10、Curtis のトークン命名記事 | 3 |
| コンポーネント | 構造・振る舞い・API をどう仕様化するか | Curtis「Documenting Components」連載、「Component Specifications」 | 4 |
| 実例 | 実際の記述はどうなっているか | デジタル庁デザインシステム | 全体の参考 |

## 1. 概念(ステップ 1)

- Alla Kholmatova『Design Systems』(Smashing Media, 2017)
- 要点: デザインシステムは、相互に関連するパターンと共有された実践が、プロダクトの目的に合わせて整理されたもの。
- パターンは 2 種類。**機能的パターン**: ボタン、ヘッダー、フォーム要素など具体的なモジュール(→ステップ 2・4)。**知覚的パターン**: 色、タイポグラフィ、アイコン、形状、アニメーションなど、個性を伝えるスタイル(→ステップ 3)。
- 目次: Design Principles / Functional Patterns / Perceptual Patterns / Shared Language / Parameters Of Your System / Planning And Practicalities / Systemizing Functional Patterns / Systemizing Perceptual Patterns / Pattern Libraries
- 紹介と無料サンプル PDF: https://www.smashingmagazine.com/design-systems/
- 性格: 実務者への取材に基づく記述的な内容。記述形式を規定する本ではない。

## 2. 構造・分類(ステップ 2)

- Brad Frost『Atomic Design』(原子 → 分子 → 有機体 → テンプレート → ページ)。階層の語彙を与えるが、記述形式の規定ではない。本のオンライン版の URL は未確認。
- Nathan Curtis「Classification in Design Systems」(2016) https://eightshapes.com/articles/on-classification-in-design-systems/

## 3. 値の記述: デザイントークン(ステップ 3)

- Design Tokens Community Group(DTCG)仕様 2025.10。2025-10-28 に最初の安定版。ツール間でトークンを交換する JSON 形式の標準化が目的。
- 仕様: https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/
- 公式: https://www.designtokens.org / FAQ: https://www.designtokens.org/faq/
- Resolver Module(ライト/ダークなど複数コンテキスト): https://www.w3.org/community/reports/design-tokens/CG-FINAL-resolver-20251028/
- リポジトリ: https://github.com/design-tokens/community-group
- 注意: W3C 標準ではなく、W3C Community Group の最終報告書。命名規則は仕様で直接は制約していない(初期の編集者草案の記述)。
- Nathan Curtis「Naming Tokens in Design Systems」(2020)、「Reimagining a Token Taxonomy」(2022)。記事一覧: https://medium.com/eightshapes-llc/tagged/design-systems

## 4. コンポーネントの記述(ステップ 4)

- Nathan Curtis「Documenting Components」(全 7 回: 概要、紹介文、例、デザイン、コード、執筆、誤解)
  - 第 1 回: https://medium.com/eightshapes-llc/9fe59b80c015
  - 解説: https://eightshapes.com/articles/documenting-components/
- 「Component Design Guidelines」: https://eightshapes.com/articles/component-design-guidelines/
- 「Component Specifications」(2023): 何を含め、どこに置くか。https://medium.com/eightshapes-llc/tagged/components から参照。
- 「Crafting Component API, Together」(2021): コードとデザインツールで構造(anatomy)と props を揃える方法。同上のタグページから参照。
- 発表資料「Designing and Automating Component Specifications」(2023) https://speakerdeck.com/nathanacurtis/designing-and-automating-component-specifications
- 記事一覧: https://eightshapes.com/articles

## 5. 実例: デジタル庁デザインシステム

- 構成: デザイン言語、UI コンポーネント、設計・実装のガイドライン。
- 専用サイト: https://design.digital.go.jp/ / 政策ページ: https://www.digital.go.jp/policies/servicedesign/designsystem
- 利用条件: https://design.digital.go.jp/introduction/notices/(Figma データは Figma Community で公開、CC BY 4.0 の記載)
- ライセンスの三層構造(本体・Figma・コード)や更新頻度の整理は二次情報による。**利用前に公式の利用条件ページで確認する**。

## 未確認

- Frost『Atomic Design』オンライン版の URL
- Material Design、GOV.UK Design System などの記述形式(調査していない)
- DTCG の値の書式の細部(色の `$value` の形など)。テンプレートの JSON は書式の例で、仕様 2025.10 で確認してから確定する。
- 書籍の無断転載 PDF は含めていない。
