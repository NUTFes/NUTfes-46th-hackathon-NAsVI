#!/usr/bin/env python3
"""PR の変更ファイルが、タスクの担当(wbs.yaml の owns)に収まるか確かめる。
使い方: python3 tools/check-owns.py <タスクID> <変更ファイルを 1 行ずつ書いたファイル>"""
import sys, fnmatch, yaml
tid, lst = sys.argv[1].upper(), sys.argv[2]
wbs = {t["id"]: t for t in yaml.safe_load(open("doc/impl/wbs.yaml"))["tasks"]}
if tid not in wbs: sys.exit(f"wbs にないタスク: {tid}")
owns = wbs[tid]["owns"]
bad = [f for f in open(lst).read().split() if not any(fnmatch.fnmatch(f, o.replace("**", "*")) or f == o for o in owns)]
if bad:
    print(f"{tid} の担当外のファイル:"); [print(" -", f) for f in bad]; sys.exit(1)
print(f"{tid}: OK")
