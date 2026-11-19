# 概念設計のハーネス(道具)の使い方

NAsVI の概念設計は、公開リポジトリ **[naoto-anzai/concept-design](https://github.com/naoto-anzai/concept-design)** の道具で作っている。
概念設計の現状は [`concept-design.md`](concept-design.md)。**直す場所は、このリポジトリの [`concept-design/`](../concept-design/)**(`concepts.yaml` など)。直し方は [`concept-design/README.md`](../concept-design/README.md) の「メンバーが直すとき」。

## 検査する

```
cd concept-design
pip install -r tools/requirements.txt
make lint      # 概念設計を検査する
make open      # 未決事項だけを見る
```

## AI(Claude Code)で使う

このリポジトリには、skill `concept-design` が入っている(`.claude/skills/concept-design/SKILL.md`)。
Claude Code でこのリポジトリを開き、「概念を検査して」「未決事項を見せて」「ジャーニーの雛形を作って」と頼むと、使い方に沿って進める。

## 何が見られるか

| 見たいもの | 場所(`concept-design/`) |
|---|---|
| 機能(F1〜F5) | `input.yaml` |
| 概念と同期 | `concepts.yaml` |
| 評価基準 | `criteria.yaml` |
| 未決事項(OQ-1〜12) | `open-questions.yaml` |
| 設計上の判断の記録 | `decisions.yaml` |
| ジャーニーの雛形 | `journey/` |
| 概念設計の説明(ジャクソンの著作にもとづく) | 道具のリポジトリの `docs/concept-design-deductive.md` |

内容を変えるときは、ブランチを切って PR を出す。決めるのはチーム。未決事項は、AI が推測で決めない。
