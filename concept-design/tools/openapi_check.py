#!/usr/bin/env python3
"""OpenAPI 仕様(openapi.yaml)を機械で検査する。

  python3 tools/openapi_check.py api/openapi.yaml [--ledger api/review-ledger.yaml] [--concepts concepts.yaml] [--external]

検査すること(人間の確認の代わりではなく、確認の前に機械で落とせるものを落とす):
  - 構造: openapi / info / paths があるか。全ての $ref が解決できるか
  - 操作: operationId があり重複がないか。成功とエラーのレスポンスがあるか。例(example)があるか
  - 概念との対応: concepts.yaml の `Request.*` 同期ごとに、操作が対応しているか
      操作に `x-request: <要求名>` を付ける。対応させない要求は、トップレベルの
      `x-excluded-requests: {要求名: 理由}` に書く
  - 要確認: `x-needs-review: "API-n: 理由"` が台帳(review-ledger.yaml)の項目を指し、その項目が確定していないか。
      台帳が「確定」なのに印が残っている、「仮置き」なのに仮置きの内容がない、「確定」なのに決定者・日付がない、を検出する
  - 名前: 同じ語が userId と user_id のように揺れていないか。camelCase と snake_case が混在していないか
  - 外部ツール: --external を付けると、入っていれば redocly / spectral を実行する。入っていなければ「未実施」と報告する
    (実行していないのに「検証済み」とは言わない)

終了コード: ERROR があれば 1。
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
REF = re.compile(r"\b([A-Z][A-Za-z]*)\.([a-z][A-Za-z]*)\b")
METHODS = ("get", "put", "post", "delete", "patch", "head", "options", "trace")
LEDGER_STATES = ("要確認", "仮置き", "確定")
MARK = re.compile(r"^\s*(API-\d+)\b")

errors, warns, infos = [], [], []


def err(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


def info(msg):
    infos.append(msg)


def load_yaml(path):
    try:
        return yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except yaml.YAMLError as e:
        err(f"{path}: YAML として読めない: {e}")
        return None


def walk(node, path=""):
    """(パス, ノード) を深さ優先で返す。"""
    yield path, node
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, f"{path}/{i}")


def resolve(doc, ref):
    if not ref.startswith("#/"):
        return None
    cur = doc
    for part in ref[2:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def operations(doc):
    for p, item in (doc.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for m in METHODS:
            if m in item and isinstance(item[m], dict):
                yield p, m, item[m]


def check_structure(doc):
    for key in ("openapi", "info", "paths"):
        if key not in doc:
            err(f"構造: トップレベルに `{key}` がない")
    if "paths" in doc and not isinstance(doc["paths"], dict):
        err("構造: paths が対応表になっていない")
    for p, node in walk(doc):
        if isinstance(node, dict) and isinstance(node.get("$ref"), str):
            if resolve(doc, node["$ref"]) is None:
                err(f"$ref が解決できない: {node['$ref']}(場所 {p or '/'})")


def has_example(op):
    for _, node in walk(op):
        if isinstance(node, dict) and ("example" in node or "examples" in node):
            return True
    return False


def check_operations(doc):
    seen = {}
    n = 0
    for p, m, op in operations(doc):
        n += 1
        label = f"{m.upper()} {p}"
        oid = op.get("operationId")
        if not oid:
            err(f"{label}: operationId がない")
        elif oid in seen:
            err(f"{label}: operationId `{oid}` が {seen[oid]} と重複")
        else:
            seen[oid] = label
        if not op.get("summary"):
            warn(f"{label}: summary がない")
        resp = op.get("responses") or {}
        codes = [str(c) for c in resp]
        if not any(c.startswith("2") for c in codes):
            err(f"{label}: 成功(2xx)のレスポンスがない")
        if not any(c[:1] in ("4", "5") or c == "default" for c in codes):
            err(f"{label}: エラー(4xx/5xx/default)のレスポンスがない")
        if not has_example(op):
            warn(f"{label}: 例(example)がない")
    info(f"操作 {n} 個")


def requests_from_concepts(path):
    out = load_yaml(path)
    if not out:
        err(f"{path} が読めない")
        return {}
    reqs = {}
    for s in out.get("syncs", []):
        m = REF.findall(str(s.get("when")))
        if m and m[0][0] == "Request":
            reqs[m[0][1]] = s["name"]
    return reqs


def check_coverage(doc, concepts_path):
    reqs = requests_from_concepts(concepts_path)
    if not reqs:
        return
    excluded = doc.get("x-excluded-requests") or {}
    covered = {}
    for p, m, op in operations(doc):
        r = op.get("x-request")
        if r is None:
            warn(f"{m.upper()} {p}: x-request がない(どの要求に対応するか分からない。画面にない操作を足していないか確認)")
            continue
        if r not in reqs:
            err(f"{m.upper()} {p}: x-request `{r}` は concepts.yaml の Request.* にない")
        covered.setdefault(r, []).append(f"{m.upper()} {p}")
    for r, sync in reqs.items():
        if r in covered:
            continue
        if r in excluded:
            if not str(excluded[r]).strip():
                err(f"x-excluded-requests の `{r}` に理由がない")
            continue
        err(f"要求 `{r}`(同期 {sync})に対応する操作がない。操作を足すか x-excluded-requests に理由を書く")
    for r in excluded:
        if r not in reqs:
            err(f"x-excluded-requests の `{r}` は concepts.yaml の Request.* にない")
        if r in covered:
            warn(f"要求 `{r}` は操作に対応しているのに x-excluded-requests にもある")
    info(f"要求 {len(reqs)} 個: 対応 {len([r for r in reqs if r in covered])}、除外 {len([r for r in reqs if r in excluded and r not in covered])}")


def check_review(doc, ledger):
    marks = []
    for p, node in walk(doc):
        if isinstance(node, dict) and "x-needs-review" in node:
            marks.append((p, str(node["x-needs-review"])))
    items = {}
    if ledger:
        for it in ledger.get("items", []):
            iid = it.get("id")
            if not iid:
                err("台帳: id のない項目がある")
                continue
            if iid in items:
                err(f"台帳: id `{iid}` が重複")
            items[iid] = it
            st = it.get("state")
            if st not in LEDGER_STATES:
                err(f"台帳 {iid}: state は {LEDGER_STATES} のどれか(いま: {st})")
            if st == "仮置き" and not str(it.get("placeholder") or "").strip():
                err(f"台帳 {iid}: 仮置きなのに placeholder(仮置きの内容)がない")
            if st == "確定" and not (str(it.get("decided_by") or "").strip() and str(it.get("date") or "").strip()):
                err(f"台帳 {iid}: 確定なのに decided_by(決定者)か date(日付)がない")
            if not str(it.get("content") or "").strip():
                err(f"台帳 {iid}: content(内容)がない")
    elif marks:
        err("x-needs-review があるのに台帳(--ledger)が読めない")
    marked_ids = set()
    for p, text in marks:
        m = MARK.match(text)
        if not m:
            err(f"x-needs-review が台帳の id で始まっていない(「API-n: 理由」の形): `{text}`(場所 {p})")
            continue
        iid = m.group(1)
        marked_ids.add(iid)
        if ledger is not None and iid not in items:
            err(f"x-needs-review の `{iid}` が台帳にない(場所 {p})")
        elif iid in items and items[iid].get("state") == "確定":
            err(f"台帳 {iid} は確定なのに、x-needs-review の印が残っている(場所 {p})")
    for iid, it in items.items():
        if it.get("state") in ("要確認", "仮置き") and iid not in marked_ids:
            warn(f"台帳 {iid}({it.get('state')})を指す x-needs-review が仕様にない。仕様のどこの話か分からなくなる")
    open_items = [i for i, it in items.items() if it.get("state") in ("要確認", "仮置き")]
    info(f"x-needs-review の残り {len(marks)} 件 / 台帳の未確定 {len(open_items)} 件(要確認 {len([i for i in open_items if items[i]['state']=='要確認'])}、仮置き {len([i for i in open_items if items[i]['state']=='仮置き'])})")
    return len(marks), len(open_items)


def words(name):
    return re.sub(r"[_\-]", "", name).lower()


def check_naming(doc):
    names = set()
    for p, node in walk(doc):
        if p.endswith("/properties") and isinstance(node, dict):
            names.update(str(k) for k in node)
        if isinstance(node, dict) and node.get("in") in ("query", "header", "cookie") and node.get("name"):
            names.add(str(node["name"]))
    by_word = {}
    for n in names:
        by_word.setdefault(words(n), set()).add(n)
    for w, group in by_word.items():
        if len(group) > 1:
            err(f"名前の揺れ: {sorted(group)} は同じ語に見える。1 つに揃える")
    snake = [n for n in names if "_" in n]
    camel = [n for n in names if re.search(r"[a-z][A-Z]", n)]
    if snake and camel:
        warn(f"名前の書き方が混在: snake_case {sorted(snake)[:3]} と camelCase {sorted(camel)[:3]}")


def check_external(path):
    tools = []
    if shutil.which("redocly"):
        tools.append(["redocly", "lint", str(path)])
    if shutil.which("spectral"):
        tools.append(["spectral", "lint", str(path)])
    if not tools:
        info("外部の lint(redocly / spectral): 未実施(入っていない)。構文・スキーマの検証は済んでいない")
        return
    for cmd in tools:
        r = subprocess.run(cmd, capture_output=True, text=True)
        tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
        if r.returncode != 0:
            err(f"{cmd[0]} lint が失敗: " + " / ".join(tail))
        else:
            info(f"{cmd[0]} lint: 通った")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--ledger")
    ap.add_argument("--concepts")
    ap.add_argument("--external", action="store_true")
    a = ap.parse_args()

    doc = load_yaml(a.spec)
    if doc is None:
        err(f"{a.spec} が読めない") if not errors else None
    else:
        check_structure(doc)
        if isinstance(doc.get("paths"), dict):
            check_operations(doc)
            if a.concepts:
                check_coverage(doc, a.concepts)
            else:
                info("概念との対応: 未実施(--concepts がない)")
            check_naming(doc)
        ledger = load_yaml(a.ledger) if a.ledger else None
        if a.ledger and ledger is None and not errors:
            err(f"台帳 {a.ledger} が読めない")
        check_review(doc, ledger if a.ledger else None)
        if a.external:
            check_external(a.spec)
        else:
            info("外部の lint(redocly / spectral): 未実施(--external なし)")

    for m in errors:
        print("ERROR", m)
    for m in warns:
        print("WARN ", m)
    for m in infos:
        print("INFO ", m)
    print(f"\nERROR {len(errors)} / WARN {len(warns)} / INFO {len(infos)}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
