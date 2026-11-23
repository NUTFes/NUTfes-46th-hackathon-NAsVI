#!/usr/bin/env python3
"""wbs.yaml から、Codex への指示書(tasks/<ID>.md)と、イシュー本文(--issues で指定した場所に <ID>.json)を作る。
使い方: python3 doc/impl/tools/gen.py [--issues OUTDIR]
指示書は毎回上書きされる。手で編集せず、wbs.yaml を直して作り直す。"""
import sys, json, pathlib, yaml
HERE = pathlib.Path(__file__).resolve().parent.parent
WORKTREES = "~/.herdr/worktrees/NUTfes-46th-hackathon-NAsVI"
wbs = yaml.safe_load((HERE / "wbs.yaml").read_text())["tasks"]
rules = "\n".join(l for l in (HERE / "task-rules.md").read_text().split("\n")[2:] if not l.startswith("(各指示書")).strip()
uniq = lambda xs: list(dict.fromkeys(xs))
byid = {t["id"]: t for t in wbs}
bl = lambda xs: "\n".join(f"- {x}" for x in xs) if xs else "- なし"
cb = lambda xs: "\n".join(f"- [ ] {x}" for x in xs)
code = lambda xs: "\n".join(f"- `{x}`" for x in xs) if xs else "- なし(新しいファイルは作らない)"
def sheet(t):
    i = t["id"]; low = i.lower()
    deps = ", ".join(f"{d}({byid[d]['title']})" for d in t["depends"]) or "なし"
    if t["kind"] == "人":
        return f"# {i} {t['title']}\n\n種別: **人が行う**(Codex には頼まない)/ 波: {t['wave']} / 前提: {deps}\n\n## 目的\n{t['goal']}\n\n## やること\n{cb(t['scope'])}\n\n## 完了条件\n{bl(t['acceptance'])}\n"
    return f"""# {i} {t['title']}

種別: Codex / 波: {t['wave']} / 前提(merge 済みであること): {deps}

## 作業場所
- ブランチ: `feat/{low}`(土台 `feat/impl-base`)
- worktree: `{WORKTREES}/{low}`
- `git fetch origin` のあと `git worktree add -b feat/{low} {WORKTREES}/{low} feat/impl-base`

## 目的
{t['goal']}

## 読むもの
{code(uniq(t['reads'] + ['doc/impl/architecture.md', 'doc/impl/contracts.md', 'doc/tech-stack.md']))}

## 担当ファイル(編集してよいのはここだけ)
{code(t['owns'])}

## やること
{cb(t['scope'])}

## 受け入れ条件(それぞれテストで確かめる)
{cb(t['acceptance'])}
{('' if not t['notes'] else chr(10) + '## 注意' + chr(10) + t['notes'] + chr(10))}
## 共通の規則
{rules}
"""
tasks = HERE / "tasks"; tasks.mkdir(exist_ok=True)
for t in wbs: (tasks / f"{t['id']}.md").write_text(sheet(t))
if "--issues" in sys.argv:
    out = pathlib.Path(sys.argv[sys.argv.index("--issues") + 1]); out.mkdir(parents=True, exist_ok=True)
    for t in wbs:
        who = "(人が行う)" if t["kind"] == "人" else ""
        body = f"## 目的\n{t['goal']}\n\n## やること\n{cb(t['scope'])}\n\n## 完了条件\n{cb(t['acceptance'])}\n\n"
        if t["owns"]: body += f"## 担当ファイル(並列の実装で衝突しないよう、ここだけを編集する)\n{code(t['owns'])}\n\n"
        body += "@@DEPS@@\n"
        body += f"指示書: `doc/impl/tasks/{t['id']}.md`(ブランチ `docs/impl-design`。merge 前)。波: {t['wave']}。\n"
        (out / f"{t['id']}.json").write_text(json.dumps({"id": t["id"], "title": f"[{t['id']}] {t['title']}{who}", "depends": t["depends"], "body": body}, ensure_ascii=False))
print(f"{len(wbs)} tasks")
