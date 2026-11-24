#!/usr/bin/env python3
"""Build the "Rules of Thumb" and "Optional Rules" journal entries (EN + ES) from tools/chapters/*.md.

Each `##### **Title**`, `### Title` or `#### Title` heading starts a journal page. Writes the entries into
src/packs/jjk5e-rules and the data/jjk5e-rules.json aggregate. Ids are stable, so re-running only updates.

  python3 tools/rules-chapters.py
"""
import hashlib, html, json, os, re

ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
AGG = "data/jjk5e-rules.json"
SRC = "src/packs/jjk5e-rules"
ES_FOLDER = "IXMKct7fx9qz8bdj"

CHAPTERS = [
    # file stem, sort, EN name, ES name
    ("rules-of-thumb", 15500, "15.1 — Rules of Thumb", "15.1 — Reglas generales"),
    ("optional-rules", 15700, "15.2 — Optional Rules", "15.2 — Reglas opcionales"),
]


def sid(*parts):
    h = hashlib.sha256("|".join(parts).encode()).digest()
    return "".join(ALPHA[b % 62] for b in h[:16])


def inline(text):
    t = html.escape(text.replace("\\", ""), quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", t)
    return t.strip()


def table(rows):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    head, body = cells[0], [r for r in cells[1:] if not all(re.fullmatch(r":?-+:?", c.replace(" ", "")) for c in r)]
    out = ["<table>", "<thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead>", "<tbody>"]
    out += ["<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body]
    return "\n".join(out + ["</tbody>", "</table>"])


def to_html(lines):
    out, i = [], 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1; continue
        if line.lstrip().startswith("|"):
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                rows.append(lines[i]); i += 1
            out.append(table(rows)); continue
        if re.match(r"^\s*[*-] ", line):
            items = []
            while i < len(lines) and re.match(r"^\s*[*-] ", lines[i]):
                items.append(f"<li>{inline(re.sub(r'^\s*[*-] ', '', lines[i]))}</li>"); i += 1
            out.append("<ul>" + "".join(items) + "</ul>"); continue
        out.append(f"<p>{inline(line)}</p>"); i += 1
    return "\n".join(out)


HEADING = re.compile(r"^(?:#####\s+\*\*(.+?)\*\*|###\s+(.+?)|####\s+(.+?))\s*$")


def pages_of(md):
    lines = md.splitlines()
    title_line = next(i for i, l in enumerate(lines) if l.startswith("## "))
    intro, pages, cur = [], [], None
    for l in lines[title_line + 1:]:
        m = HEADING.match(l)
        if m:
            cur = [(m.group(1) or m.group(2) or m.group(3)).strip(), []]
            pages.append(cur)
        elif cur is None: intro.append(l)
        else: cur[1].append(l)
    return lines[title_line][3:].strip(), intro, pages


def build(stem, sort, name, lang, source_id=None):
    md = open(f"tools/chapters/{stem}.{lang}.md", encoding="utf-8").read()
    _, intro, pages = pages_of(md)
    eid = sid("chapter", stem, lang)
    out = []
    if any(l.strip() for l in intro):
        pages = [[name.split("— ")[-1], intro]] + pages
    for n, (title, body) in enumerate(pages):
        pid = sid("chapter", stem, lang, str(n))
        out.append({"_id": pid, "name": title, "type": "text", "sort": (n + 1) * 1000,
                    "title": {"show": True, "level": 1}, "text": {"format": 1, "content": to_html(body)},
                    "_key": f"!journal.pages!{eid}.{pid}"})
    flags = {"jjk5e": {"lang": lang}}
    if source_id: flags["jjk5e"]["source"] = source_id
    return {"_id": eid, "name": name, "sort": sort, "flags": flags, "folder": ES_FOLDER if lang == "es" else None,
            "pages": out, "_key": f"!journal!{eid}"}


def slug(s):
    s = s.lower().replace("—", "").replace(".", "-")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def main():
    agg = json.load(open(AGG, encoding="utf-8"))
    docs = agg["documents"]
    for stem, sort, en, es in CHAPTERS:
        e = build(stem, sort, en, "en")
        s = build(stem, sort, es, "es", e["_id"])
        for doc in (e, s):
            path = f"{SRC}/{slug(doc['name'])}_{doc['_id']}.json"
            with open(path, "w", encoding="utf-8") as f: f.write(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
            clean = json.loads(json.dumps(doc)); clean.pop("_key", None)
            for p in clean["pages"]: p.pop("_key", None)
            i = next((k for k, d in enumerate(docs) if d["_id"] == doc["_id"]), None)
            if i is None: docs.append(clean)
            else: docs[i] = clean
            print(f"{doc['name']}: {len(doc['pages'])} pages")
    docs.sort(key=lambda d: (d.get("flags", {}).get("jjk5e", {}).get("lang") == "es", d.get("sort", 0)))
    with open(AGG, "w", encoding="utf-8") as f: f.write(json.dumps(agg, ensure_ascii=False))


if __name__ == "__main__":
    main()
