# 概念設計のハーネス(道具)の使い方

NAsVI の概念設計は、公開リポジトリ **[naoto-anzai/concept-design](https://github.com/naoto-anzai/concept-design)** の道具で作っている。
概念設計の現状は [`concept-design.md`](concept-design.md)。元になっているファイル(`concepts.yaml` など)は、上のリポジトリの `examples/hackathon/` にある。

## 手に入れる

```
git clone https://github.com/naoto-anzai/concept-design.git
cd concept-design/examples/hackathon
pip install -r tools/requirements.txt
make lint      # 概念設計を検査する
make open      # 未決事項だけを見る
```

## AI(Claude Code)で使う

このリポジトリには、skill `concept-design` が入っている(`.claude/skills/concept-design/SKILL.md`)。
Claude Code でこのリポジトリを開き、「概念を検査して」「未決事項を見せて」「ジャーニーの雛形を作って」と頼むと、使い方に沿って進める。
skill は、上のリポジトリを clone してある前提で書いてある。

## 何が見られるか

| 見たいもの | 場所(concept-design リポジトリ) |
|---|---|
| 機能(F1〜F4) | `examples/hackathon/input.yaml` |
| 概念と同期 | `examples/hackathon/concepts.yaml` |
| 評価基準 | `examples/hackathon/criteria.yaml` |
| 未決事項(OQ-1〜7) | `examples/hackathon/open-questions.yaml` |
| 設計上の判断の記録 | `examples/hackathon/decisions.yaml` |
| ジャーニーの雛形 | `examples/hackathon/journey/` |
| 概念設計の説明(ジャクソンの著作にもとづく) | `docs/concept-design-deductive.md` |

内容を変えるときは、concept-design リポジトリに PR を出す。決めるのはチーム。未決事項は、AI が推測で決めない。
