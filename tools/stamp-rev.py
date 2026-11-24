#!/usr/bin/env python3
"""Stamp every compendium Item with flags.jjk5e.rev, a short hash of its automation.

The in-game updater (api.updateAutomation) compares an actor item's rev with the compendium's
rev to find items whose automation changed after they were added to the character.

  python3 tools/stamp-rev.py          # write revs (src/packs and data/ aggregates)
  python3 tools/stamp-rev.py --check  # exit 1 if any rev is missing or stale
"""
import glob, hashlib, json, os, sys

SKIP = {"_id", "_key", "_stats", "folder", "sort", "ownership"}


def rev_of(doc):
    d = {k: v for k, v in doc.items() if k not in SKIP}
    d = json.loads(json.dumps(d))
    d.get("flags", {}).get("jjk5e", {}).pop("rev", None)
    for e in d.get("effects", []):
        for k in ("_key", "_stats"): e.pop(k, None)
    raw = json.dumps(d, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def main(check=False):
    revs, stale = {}, []
    for p in sorted(glob.glob("src/packs/*/*.json")):
        text = open(p, encoding="utf-8").read()
        d = json.loads(text)
        if not str(d.get("_key", "")).startswith("!items!"): continue
        r = rev_of(d)
        revs[d["_id"]] = r
        fl = d.setdefault("flags", {}).setdefault("jjk5e", {})
        if fl.get("rev") == r: continue
        stale.append(p)
        if check: continue
        fl["rev"] = r
        nl = "\n" if text.endswith("\n") else ""
        open(p, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False, indent=1) + nl)
    for p in sorted(glob.glob("data/jjk5e-*.json")):
        agg = json.load(open(p, encoding="utf-8"))
        if agg.get("type") != "Item": continue
        changed = False
        for doc in agg.get("documents", []):
            r = revs.get(doc.get("_id"))
            if not r: continue
            fl = doc.setdefault("flags", {}).setdefault("jjk5e", {})
            if fl.get("rev") != r:
                changed = True
                if check: stale.append(f"{p}:{doc.get('name')}")
                else: fl["rev"] = r
        if changed and not check:
            open(p, "w", encoding="utf-8").write(json.dumps(agg, ensure_ascii=False))
    if check:
        if stale:
            print(f"{len(stale)} item(s) with missing/stale rev; run python3 tools/stamp-rev.py")
            for s in stale[:20]: print(" ", s)
            sys.exit(1)
        print(f"revs ok ({len(revs)} items)")
    else:
        print(f"stamped {len(stale)} file(s), {len(revs)} items")


if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    main("--check" in sys.argv)
