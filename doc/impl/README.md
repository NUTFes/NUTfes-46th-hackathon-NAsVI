# 実装の分割・指示書(並列の実装用)

状態: **下書き**(チームの確認前)。決定の正は `doc/tech-stack.md`(T1〜T13)。

| ファイル | 内容 |
|---|---|
| `architecture.md` | ディレクトリ構成、共有ファイル、ブランチ・worktree・マージの運用、波(Wave) |
| `contracts.md` | タスク間の契約(共通関数、型、座標、保存のキー、地図の層) |
| `wbs.yaml` | **分割の元データ**。タスクごとの目的・担当ファイル・前提・受け入れ条件。ここを直す |
| `task-rules.md` | すべての Codex タスクに共通の規則 |
| `tasks/<ID>.md` | Codex への指示書(`tools/gen.py` が `wbs.yaml` から生成。手で編集しない) |
| `tools/gen.py` | 指示書(と、イシュー本文)を生成する |

## 使い方
1. 波 0 の F-2・F-3(基盤)を、worktree を分けて並列に頼む。完了したら `feat/impl-base` に取り込む。
2. 波 1 のタスクを、`depends` が満たされたものから、worktree ごとに並列で頼む。頼むときは `tasks/<ID>.md` をそのまま渡す(自己完結)。
3. 完了したブランチを `feat/impl-integration` に順に merge し、型検査・テスト・ビルドを通す。
4. 次の波へ。人の作業(D-02・D-03・V-01〜V-03)は、イシューで人に頼む。

分割を直すとき: `wbs.yaml` を直し、`python3 doc/impl/tools/gen.py` で指示書を作り直す。
