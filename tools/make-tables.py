#!/usr/bin/env python3
"""Roll tables from the V.6 manual's optional rules (src/packs/jjk5e-tables + data/jjk5e-tables.json).

  python3 tools/make-tables.py
"""
import hashlib, json, os

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def sid(*parts):
    h = hashlib.sha1("|".join(parts).encode()).digest()
    return "".join(ALPHA[b % len(ALPHA)] for b in h[:16])


def table(slug, name, formula, rows, description=""):
    tid = sid("table", slug)
    results = []
    for i, (lo, hi, title, text) in enumerate(rows):
        rid = sid("table", slug, str(i))
        html = f"<p><strong>{title}</strong>{' — ' + text if text else ''}</p>"
        results.append({"_id": rid, "type": "text", "name": title, "description": html, "documentUuid": None, "flags": {},
                        "img": "icons/svg/d20-black.svg", "weight": 1, "range": [lo, hi], "drawn": False,
                        "_key": f"!tables.results!{tid}.{rid}"})
    return {"_id": tid, "name": name, "img": "icons/svg/d20-grey.svg", "description": f"<p>{description}</p>" if description else "",
            "formula": formula, "replacement": True, "displayRoll": True, "results": results,
            "flags": {"jjk5e": {"source": "JJK 5e V.6 — Optional Rules"}}, "folder": None, "_key": f"!tables!{tid}"}, slug


TABLES = [
    table("finding-a-cursed-spirit", "Finding a Cursed Spirit", "1d100", [
        (1, 50, "Grade 4", "A weak curse."), (51, 75, "Grade 3", "A lesser cursed spirit."),
        (76, 90, "Semi-Grade 2", ""), (91, 99, "Grade 2", "A strong cursed spirit."), (100, 100, "Semi-Grade 1", "A dangerous cursed spirit.")],
        "Spend 1–2 hours searching and succeed on a DC 20 Wisdom (Perception) or Intelligence (Investigation) check, then roll."),
    table("mission-rewards", "Mission Rewards (Taking Missions)", "1d5", [
        (1, 1, "Grade 4", "[[/r (1d16 + 4) * 100]] dollars ($500–2,000)"),
        (2, 2, "Grade 3", "[[/r (1d71 + 29) * 100]] dollars ($3,000–10,000)"),
        (3, 3, "Grade 2", "[[/r (1d151 + 99) * 100]] dollars ($10,000–25,000)"),
        (4, 4, "Grade 1", "[[/r (1d401 + 99) * 1000]] dollars ($100,000–500,000)"),
        (5, 5, "Special Grade", "$1,000,000 or more (GM)")],
        "Roll the reward of a mission of the given grade with the inline roll, or roll the table for a random mission grade."),
    table("employment-pay", "Employment Pay (Ways to Make Money)", "1d2", [
        (1, 1, "Minimum Wage Employment", "10–40 hours per week: [[/r (1d43 + 7) * 10]] dollars ($80–500). The GM adjusts by proficiencies."),
        (2, 2, "Special Employment", "Innate Technique or RCT: CE modifier × d4 × $100 per workweek (roll [[/r 1d4 * 100]] per point of "
                                     "CE modifier). Reverse Technique Prodigy or Mastered Reverse Technique: $10,000 per week.")],
        "Free-time jobs from the optional rule Ways to Make Money."),
    table("cursed-tool-value", "Cursed Tool Sale Value", "1d4", [
        (1, 1, "Grade 4", "Weapon/armor value × 1"), (2, 2, "Grade 3", "Weapon/armor value × 10"),
        (3, 3, "Grade 2", "Weapon/armor value × 25"), (4, 4, "Grade 1", "Weapon/armor value × 50")],
        "Cursed Tool Creation (requires Tool Maker): price of a cursed tool by grade."),
    table("average-cursed-energy", "Average Cursed Energy", "1d8", [
        (1, 1, "Heavenly Restriction", "0 CE: no cursed energy; relies on physical prowess."),
        (2, 2, "Normal Person", "½ CE: barely detectable; unaware of curses."),
        (3, 3, "Normal Person (Despair)", "1 CE: a temporary surge from intense emotion."),
        (4, 4, "Grade 4", "[[/r 1d5]] CE (1–5)"), (5, 5, "Grade 3", "[[/r 1d10 + 5]] CE (6–15)"),
        (6, 6, "Grade 2", "[[/r 1d15 + 15]] CE (16–30)"), (7, 7, "Grade 1", "[[/r 1d20 + 30]] CE (31–50)"),
        (8, 8, "Special Grade", "50+ CE")],
        "Reference CE pool for NPCs and cursed spirits by classification."),
    table("cursed-upon-death", "Cursed Upon Death (madness check)", "1d20", [
        (1, 20, "Weekly DC 25 Wisdom save", "Failure: gain one level of indefinite madness and repeat next week. Success: lose all "
                                            "madness levels from this and stop saving.")],
        "A sorcerer who dies without cursed energy returns as a Vengeful cursed spirit a week later (see Rules → Optional Rules)."),
]


def main():
    agg_path = "data/jjk5e-tables.json"
    agg = json.load(open(agg_path, encoding="utf-8"))
    docs = {d["_id"]: d for d in agg["documents"]}
    for doc, slug in TABLES:
        p = f"src/packs/jjk5e-tables/{slug}_{doc['_id']}.json"
        open(p, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        clean = json.loads(json.dumps(doc)); clean.pop("_key", None)
        for r in clean["results"]: r.pop("_key", None)
        docs[doc["_id"]] = clean
    agg["documents"] = list(docs.values())
    open(agg_path, "w", encoding="utf-8").write(json.dumps(agg, ensure_ascii=False))
    print(f"{len(TABLES)} tables written")


if __name__ == "__main__":
    main()
