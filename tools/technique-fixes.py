"""Hand-written automation for innate techniques, one technique at a time (Midi-QOL + DAE).

Each technique has a function below, written from its manual text. The script edits the compendium sources
(src/packs/...) and the fallback data (data/...) identically, so the audit's source/fallback checks stay green.

  python3 tools/technique-fixes.py "Antigravity System"
  python3 tools/technique-fixes.py --all
"""
import hashlib, json, os, re, sys

ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
PACKS = {"jjk5e-techniques": "data/jjk5e-techniques.json", "jjk5e-feats": "data/jjk5e-feats.json",
         "jjk5e-equipment": "data/jjk5e-equipment.json", "jjk5e-class-features": "data/jjk5e-class-features.json"}
CE = "max(@abilities.wis.mod, @abilities.cha.mod)"
NON_PSYCHIC = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison",
               "radiant", "slashing", "thunder"]


def sid(*parts):
    h = hashlib.sha256("|".join(parts).encode()).digest()
    return "".join(ALPHA[b % 62] for b in h[:16])


class Store:
    def __init__(self):
        self.src = {}     # _id -> (path, doc)
        self.agg = {}     # pack -> aggregate json
        self.dirty = set()
        for pack, agg in PACKS.items():
            self.agg[pack] = json.load(open(agg, encoding="utf-8"))
            folder = f"src/packs/{pack}"
            for fn in os.listdir(folder):
                if fn.endswith(".json") and not fn.startswith("_folder"):
                    p = os.path.join(folder, fn)
                    d = json.load(open(p, encoding="utf-8"))
                    self.src[d["_id"]] = (pack, p, d)

    def get(self, name, pack="jjk5e-techniques", technique=None):
        hits = [d for (pk, _, d) in self.src.values() if pk == pack and d["name"] == name
                and (technique is None or d.get("flags", {}).get("jjk5e", {}).get("technique") == technique)]
        if len(hits) != 1: raise KeyError(f"{name}: {len(hits)} matches in {pack}")
        self.dirty.add(hits[0]["_id"])
        return hits[0]

    def by_id(self, _id):
        self.dirty.add(_id)
        return self.src[_id][2]

    def save(self):
        for _id in sorted(self.dirty):
            pack, p, d = self.src[_id]
            acts = d.get("system", {}).get("activities", {})
            fl = d.get("flags", {}).get("jjk5e", {})
            for k in ("ceCosts", "ceSteps", "dmgScale"):
                if isinstance(fl.get(k), dict):
                    for aid in [a for a in fl[k] if a not in acts]: fl[k].pop(aid)
            for e in d.get("effects", []):
                e["_key"] = f"!items.effects!{d['_id']}.{e['_id']}"
            nl = "\n" if open(p, encoding="utf-8").read().endswith("\n") else ""
            with open(p, "w", encoding="utf-8") as f: f.write(json.dumps(d, ensure_ascii=False, indent=1) + nl)
            clean = json.loads(json.dumps(d))
            clean.pop("_key", None)
            for e in clean.get("effects", []): e.pop("_key", None)
            docs = self.agg[pack]["documents"]
            i = next(i for i, x in enumerate(docs) if x["_id"] == _id)
            docs[i] = clean
        for pack, agg in PACKS.items():
            if not any(self.src[i][0] == pack for i in self.dirty): continue
            with open(agg, "w", encoding="utf-8") as f: f.write(json.dumps(self.agg[pack], ensure_ascii=False))
        print(f"updated {len(self.dirty)} documents")


# ---------------------------------------------------------------- building blocks

def act(item, key, typ, name, activation="special", **extra):
    """Create or replace the activity with a stable id derived from (item, key)."""
    acts = item["system"].setdefault("activities", {})
    aid = key if key in acts else sid(item["_id"], "act", key)
    a = {"_id": aid, "type": typ, "name": name, "sort": 0, "img": acts.get(aid, {}).get("img"),
         "activation": {"type": activation, "value": 1 if activation in ("action", "bonus", "reaction") else None,
                        "condition": "", "override": True},
         "consumption": {"targets": [], "scaling": {"allowed": False, "max": ""}, "spellSlot": False},
         "duration": {"units": "inst", "override": True},
         "range": {"units": "spec", "override": True},
         "target": {"affects": {"type": "creature"}, "override": True},
         "effects": []}
    for k, v in extra.items(): a[k] = v
    acts[aid] = a
    return a


def save(abilities, onsave="none", parts=()):
    return {"ability": list(abilities), "dc": {"calculation": "spellcasting", "formula": ""}}, \
           {"onSave": onsave, "parts": list(parts)}


def dice(n, d, types, bonus="", scale=None):
    p = {"number": n, "denomination": d, "bonus": bonus, "types": list(types),
         "custom": {"enabled": False, "formula": ""}, "scaling": {}}
    if scale: p["scaling"] = {"number": scale}
    return p


def fx(item, key, name, changes=(), statuses=(), rounds=1, special=(), desc="", turns=None):
    effs = item.setdefault("effects", [])
    eid = sid(item["_id"], "fx", key)
    e = {"_id": eid, "name": name, "img": item.get("img"), "type": "base", "transfer": False, "disabled": False,
         "statuses": list(statuses), "description": f"<p>{desc}</p>" if desc else "",
         "changes": [{"key": k, "mode": m, "value": str(v), "priority": 20} for k, m, v in changes],
         "duration": {"rounds": rounds, **({"turns": turns} if turns else {})},
         "flags": {"jjk5e": {"technique": item.setdefault("flags", {}).setdefault("jjk5e", {}).get("technique")}}}
    if special: e["flags"]["dae"] = {"specialDuration": list(special)}
    effs[:] = [x for x in effs if x["_id"] != eid] + [e]
    return eid


def apply(a, *effect_ids, on_save=False):
    a["effects"] = [{"_id": e, "onSave": on_save} for e in effect_ids]


def cost(item, a, ce, step=0, max_=""):
    fl = item["flags"].setdefault("jjk5e", {})
    fl.setdefault("ceCosts", {})[a["_id"]] = ce
    if step:
        fl.setdefault("ceSteps", {})[a["_id"]] = step
        a["consumption"]["scaling"] = {"allowed": True, "max": max_}
    else:
        fl.get("ceSteps", {}).pop(a["_id"], None)


def free(item, a):
    item["flags"]["jjk5e"].get("ceCosts", {}).pop(a["_id"], None)
    item["flags"]["jjk5e"].get("ceSteps", {}).pop(a["_id"], None)


def trigger(a, target_activity, targets="failedSaves", condition=""):
    """Midi-QOL: run another activity of the same item right after this one (ignored without Midi)."""
    a["midiProperties"] = {"triggeredActivityId": target_activity["_id"], "triggeredActivityTargets": targets,
                           "triggeredActivityRollAs": "self", "triggeredActivityConsume": False,
                           "triggeredActivityConfigure": False, "triggeredActivityConditionText": condition}


def scale(item, a, tiers):
    item["flags"]["jjk5e"].setdefault("dmgScale", {})[a["_id"]] = tiers


def note(item, text):
    item["flags"]["jjk5e"]["automationNotes"] = text


def mark(item, status="automated"):
    item["flags"]["jjk5e"]["automation"] = status


def sphere(size, units="ft", kind="radius"):
    return {"template": {"type": kind, "size": str(size), "units": units, "count": "1", "contiguous": False},
            "affects": {"type": "creature", "choice": False}, "override": True}


SELF = {"affects": {"type": "self"}, "override": True}
RANGE_SELF = {"units": "self", "override": True}


def has_feature(name):
    return f'items.some(i => i.name === "{name}")'


# ---------------------------------------------------------------- techniques

def antigravity_system(S):
    # --- Antigravity (1st): reverse gravity in a 10-ft cylinder until the start of your next turn.
    ag = S.get("Antigravity")
    main = ag["system"]["activities"]["MMpYKCffDsrJ2Qfk"]
    lifted = fx(ag, "lifted", "Lifted (Antigravity)", rounds=1, special=["turnStartSource"],
                desc="Falls upward inside the antigravity cylinder (30/50/100/200 ft by level) and floats until the "
                     "start of the caster's next turn, then falls back down. Use \"Fall damage\" when it ends.")
    main["save"], main["damage"] = save(["dex"])
    main["target"] = sphere(10, kind="cylinder")
    main["target"]["affects"]["choice"] = True       # Focused System: choose creatures to leave out
    main["duration"] = {"value": "1", "units": "round", "override": True}
    apply(main, lifted)
    fall = act(ag, "fall", "damage", "Fall damage (field ends)", "special",
               damage={"parts": [dice(3, 6, ["bludgeoning"])]},
               target={"affects": {"type": "creature", "choice": True}, "override": True})
    free(ag, fall)
    # height/10 dice; d8 at 3rd, d10 at 6th, d12 at 11th (Hard Fall), 200 ft at 18th
    scale(ag, fall, [[1, "3d6"], [3, "5d8"], [6, "5d10"], [11, "10d12"], [18, "20d12"]])
    # Disorienting Gravity (Gravity Field, 3rd) and Nauseating Gravity (Boosted System, 11th) follow automatically.
    dis_fx = fx(ag, "disoriented", "Disoriented (Antigravity)", rounds=1, special=["turnStartSource"],
                changes=[("flags.midi-qol.disadvantage.attack.all", 0, "1")],
                desc="Attacks at disadvantage and cannot maintain concentration while within the field.")
    dis = act(ag, "disorienting", "save", "Disorienting Gravity (Gravity Field)", "special",
              target={"affects": {"type": "creature", "choice": True}, "override": True})
    dis["save"], dis["damage"] = save(["con"])
    apply(dis, dis_fx)
    free(ag, dis)
    stun_fx = fx(ag, "nauseated", "Nauseated (Antigravity)", statuses=["stunned"], rounds=1, special=["turnEnd"],
                 desc="Stunned until the end of its next turn (Nauseating Gravity).")
    nau = act(ag, "nauseating", "utility", "Nauseating Gravity (Boosted System)", "special",
              target={"affects": {"type": "creature", "choice": True}, "override": True})
    apply(nau, stun_fx)
    free(ag, nau)
    trigger(main, dis, "failedSaves", has_feature("Gravity Field"))
    trigger(dis, nau, "failedSaves", has_feature("Boosted System"))
    note(ag, "Midi-QOL: failed Dexterity save applies Lifted; with Gravity Field the lifted creatures roll the "
             "Disorienting Gravity save; with Boosted System a failure there also stuns. Fall damage scales with "
             "level and is applied with 'Fall damage (field ends)'. Sweeping Gravity (no save below the DC) is GM-ruled.")
    mark(ag)

    # --- Gravity Field (3rd): Light Fall reaction; Focused/Disorienting are handled by Antigravity.
    gf = S.get("Gravity Field")
    lf = gf["system"]["activities"]["OuJ0Q9ywU3SspZxe"]
    lf_fx = fx(gf, "lightfall", "Light Fall", rounds=10,
               desc="Descends at 60 feet per round and takes no fall damage on landing.")
    act(gf, "OuJ0Q9ywU3SspZxe", "utility", "Light Fall — Reaction (1 CE)", "reaction",
        range={"value": "120", "units": "ft", "override": True},
        target={"affects": {"type": "creature", "count": "@prof", "choice": True}, "override": True})
    lf = gf["system"]["activities"]["OuJ0Q9ywU3SspZxe"]
    lf["activation"]["condition"] = "When you or a creature within 120 ft falls"
    apply(lf, lf_fx)
    cost(gf, lf, 1)
    note(gf, "Disorienting Gravity runs from Antigravity automatically. Focused System: choose the creatures "
             "you exclude when placing Antigravity.")
    mark(gf)

    # --- Antigravity Shield (6th): reaction, disadvantage to attackers, reduce non-psychic damage.
    sh = S.get("Antigravity Shield")
    a = sh["system"]["activities"]["HHt4hG5MQzCTafuK"]
    amount = f"-({CE} + @details.level)"
    shield = fx(sh, "shield", "Antigravity Shield", rounds=1, special=["turnStartSource"],
                changes=[("flags.midi-qol.grants.disadvantage.attack.all", 0, "1")]
                        + [(f"system.traits.dm.amount.{t}", 2, amount) for t in NON_PSYCHIC],
                desc="Attack rolls against you have disadvantage and non-psychic damage is reduced by your CE "
                     "modifier + your level until the start of your next turn.")
    a["range"], a["target"] = RANGE_SELF, SELF
    a["activation"]["condition"] = "When you are attacked (Dodge: a creature within 5 ft)"
    a["useConditionText"] = 'reaction === "isAttacked"'
    apply(a, shield)
    mark(sh)

    # --- Boosted System (11th): Lasting Field extra CE; Nauseating handled by Antigravity.
    bs = S.get("Boosted System")
    b = bs["system"]["activities"]["Yqj6r63O9Ffq54ux"]
    act(bs, "Yqj6r63O9Ffq54ux", "utility", "Lasting Field (1+ CE)", "special")
    b = bs["system"]["activities"]["Yqj6r63O9Ffq54ux"]
    b["activation"]["condition"] = "When you use Antigravity: +10 ft and +1 round per extra CE"
    cost(bs, b, 1, 1, CE)
    note(bs, "Nauseating Gravity and Hard Fall (d12) are applied by Antigravity automatically.")
    mark(bs)

    # --- Domain Expansion: Zero Gravity (18th): creatures of your choice fail saves vs Antigravity at initiative 20.
    dz = S.get("Domain Expansion: Zero Gravity")
    z = act(dz, "init20", "utility", "Initiative 20: Antigravity (sure-hit)", "special",
            target={"affects": {"type": "enemy", "choice": True}, "override": True})
    z_fx = fx(dz, "lifted", "Lifted (Zero Gravity)", rounds=1, special=["turnStartSource"],
              desc="Affected by Antigravity and fails every saving throw against it while the domain lasts.")
    z_fail = fx(dz, "fail", "Zero Gravity: fails saves", rounds=10,
                changes=[("flags.midi-qol.fail.ability.save.dex", 0, "1"), ("flags.midi-qol.fail.ability.save.con", 0, "1")],
                desc="Automatically fails Dexterity and Constitution saving throws against Antigravity in the domain.")
    apply(z, z_fx, z_fail)
    free(dz, z)
    mark(dz)

    # --- Reversal: Gravity System (feat)
    gs = S.get("Gravity System")
    g = gs["system"]["activities"]["Was3HiWmu550Xw12"]
    crushed = fx(gs, "crushed", "Crushed (Gravity System)", statuses=["prone", "restrained"], rounds=1,
                 special=["turnStartSource"], changes=[("flags.midi-qol.fail.attack.mwak", 0, "1"),
                                                       ("flags.midi-qol.fail.attack.msak", 0, "1")],
                 desc="Prone and restrained, its melee attacks automatically fail, until the start of your next turn "
                      "or until it leaves the area.")
    heavy = fx(gs, "heavy", "Heavy Gravity", rounds=1, special=["turnStartSource"],
               changes=[("flags.midi-qol.disadvantage.attack.mwak", 0, "1"), ("flags.midi-qol.disadvantage.attack.msak", 0, "1")],
               desc="Melee attack rolls are made with disadvantage inside Gravity System.")
    g["target"] = sphere(10)
    g["range"] = RANGE_SELF
    g["effects"] = [{"_id": crushed, "onSave": False}, {"_id": heavy, "onSave": True}]
    gs["effects"] = [e for e in gs.get("effects", []) if e["_id"] != "Z4ZoxeMInInP5ko8"]
    scale(gs, g, [[1, "10d10"], [11, "15d10"], [18, "20d10"], [20, "25d10"]])
    r = gs["system"]["activities"]["opXNTcnURCTa93yu"]
    act(gs, "opXNTcnURCTa93yu", "utility", "Reaction (6 CE)", "reaction", range=RANGE_SELF, target=SELF)
    r = gs["system"]["activities"]["opXNTcnURCTa93yu"]
    r["activation"]["condition"] = "When attacked or forced to make a physical saving throw"
    r["useConditionText"] = 'reaction === "isAttacked" || reaction === "isSave"'
    cost(gs, r, 6)
    note(gs, "Reaction: reduce the triggering damage by a Gravity System damage roll (GM applies). Perfect Gravity "
             "(18th) disadvantage/exhaustion is GM-ruled.")
    mark(gs)


def auspicious_beast_summon(S):
    # --- Kaichi (1st): summon costs 1 CE; the horn then attacks for free (an extra attack on your turn).
    k = S.get("Auspicious Beast #1: Kaichi")
    old = k["system"]["activities"]["GCHuJRcdm5YBLZVK"]
    tiers = k["flags"]["jjk5e"].get("dmgScale", {}).pop("GCHuJRcdm5YBLZVK", None) \
        or [[0, "1d6"], [3, "1d8"], [6, "1d10"], [11, "1d12"], [18, "3d6"]]
    horn_fx = fx(k, "kaichi", "Kaichi (summoned)", rounds=10,
                 desc="The yellow drill horn is summoned for 1 minute: use 'Kaichi Horn' once on each of your turns.")
    summon = act(k, "GCHuJRcdm5YBLZVK", "utility", "Summon Kaichi — Action (1 CE)", "action",
                 range=RANGE_SELF, target=SELF, duration={"value": "1", "units": "minute", "override": True})
    apply(summon, horn_fx)
    cost(k, summon, 1)
    horn = act(k, "horn", "attack", "Kaichi Horn (extra attack)", "special",
               attack={"ability": "", "bonus": "", "critical": {"threshold": None}, "flat": False,
                       "type": {"value": "melee", "classification": "spell"}},
               damage={"includeBase": False, "parts": [dice(1, 6, ["piercing"])]},
               range={"value": "30", "units": "ft", "override": True},
               target={"affects": {"type": "creature", "count": "1"}, "override": True})
    horn["activation"]["condition"] = "Once per turn while Kaichi is summoned"
    free(k, horn)
    scale(k, horn, tiers)
    mark(k)

    # --- Reiki (3rd): bonus action double movement; reaction +5 AC.
    r = S.get("Auspicious Beast #2: Reiki")
    r["effects"] = [e for e in r.get("effects", []) if e["_id"] != "454LFPLROeF8Z1Cm"]   # old manual toggle
    speed = fx(r, "speed", "Reiki: dark water (double speed)", rounds=1, special=["turnEndSource"],
               changes=[(f"system.attributes.movement.{m}", 1, "2") for m in ("walk", "swim", "fly", "climb")],
               desc="Your movement is doubled until the end of your next turn.")
    b = r["system"]["activities"]["TOiqVr1p4VytfTdo"]
    b["range"], b["target"] = RANGE_SELF, SELF
    apply(b, speed)
    ward = fx(r, "ac", "Reiki: dark water (+5 AC)", rounds=1, special=["turnStartSource"],
              changes=[("system.attributes.ac.bonus", 2, "+5")],
              desc="+5 bonus to AC until the start of your next turn.")
    re_ = r["system"]["activities"]["b2gex8XcWCXeP4G3"]
    re_["range"], re_["target"] = RANGE_SELF, SELF
    re_["activation"]["condition"] = "When you are hit by an attack"
    re_["useConditionText"] = 'reaction === "isHit"'
    apply(re_, ward)
    mark(r)

    # --- Kirin (6th): 5 temp HP per CE, movement 0 until the start of your next turn.
    ki = S.get("Auspicious Beast #3: Kirin")
    h = ki["system"]["activities"]["5Zbe2Fgjfbs6ILFe"]
    h["range"], h["target"] = RANGE_SELF, SELF
    root = fx(ki, "root", "Kirin: rooted", rounds=1, special=["turnStartSource"],
              changes=[(f"system.attributes.movement.{m}", 5, "0") for m in ("walk", "swim", "fly", "climb", "burrow")],
              desc="Movement 0 until the start of your next turn. While you keep Kirin's temporary hit points you "
                   "ignore exhaustion (GM).")
    apply(h, root)
    mark(ki)

    # --- Ryu (11th): 8d10 piercing (STR save) where it lands, within 30 ft.
    ry = S.get("Auspicious Beast #4: Ryu")
    a = ry["system"]["activities"]["bNBcgNDbBlDvJeU3"]
    a["range"] = {"value": "30", "units": "ft", "override": True}
    a["target"] = {"affects": {"type": "creature", "count": "1"}, "override": True}
    a["damage"]["onSave"] = "none"
    ry_fx = fx(ry, "ryu", "Ryu (summoned)", rounds=100,
               desc="Ryu stays up to 10 minutes or until you fall unconscious; command it as a bonus action, "
                    "otherwise it Dodges. After it is destroyed you cannot summon it for 10 minutes.")
    self_ = act(ry, "ryu-self", "utility", "Ryu: command (bonus action)", "bonus", range=RANGE_SELF, target=SELF)
    free(ry, self_)
    a["effects"] = []
    apply(self_, ry_fx)
    trigger(a, self_, "self")
    mark(ry)

    # --- Domain: beasts always active; at initiative 20 Kirin refreshes as if CE = your CE modifier.
    d = S.get("Domain Expansion: Auspicious Beasts’ Realm")
    realm = fx(d, "realm", "Auspicious Beasts' Realm", rounds=10,
               desc="All four beasts are active without side effects; Kaichi and Ryu attacks always hit (domain "
                    "sure-hit, applied by the module to technique attacks).")
    kirin = act(d, "init20", "heal", "Initiative 20: Kirin refresh", "special",
                healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                         "custom": {"enabled": True, "formula": f"5 * {CE}"}, "scaling": {}},
                range=RANGE_SELF, target=SELF)
    apply(kirin, realm)
    free(d, kirin)
    mark(d)

    # --- Reversal: Inauspicious Beast Banishment — summoners within 60 ft save or lose their summons.
    rv = S.get("Inauspicious Beast Banishment")
    act(rv, "eGBc09FV9WqJ83U1", "save", "Action or Reaction (5 CE)", "reaction",
        range=RANGE_SELF, target=sphere(60),
        save={"ability": ["wis", "cha"], "dc": {"calculation": "spellcasting", "formula": ""}},
        damage={"onSave": "none", "parts": []})
    v = rv["system"]["activities"]["eGBc09FV9WqJ83U1"]
    v["useConditionText"] = "false"
    gone = fx(rv, "banished", "Summons undone", rounds=1,
              desc="On a failed Cursed Energy save, this creature's summons, shikigami and familiars are undone.")
    apply(v, gone)
    cost(rv, v, 5)
    mark(rv)


def black_bird_manipulation(S):
    # --- Cursed Crows (1st): imbue a crow (charmed); see through a crow (you are blinded).
    c = S.get("Cursed Crows")
    see_fx = fx(c, "see", "Seeing through a crow", statuses=["blinded"], rounds=0,
                desc="Your eyes are closed (blinded unless you have blindsight) while you see through one crow; "
                     "use its senses and your passive Perception. Delete this effect to stop (bonus action).")
    c["effects"] = [e if e["_id"] != see_fx else {**e, "duration": {}} for e in c["effects"]]
    see = act(c, "see", "utility", "See through a crow (Action)", "action", range=RANGE_SELF, target=SELF)
    apply(see, see_fx)
    free(c, see)
    note(c, "Crow count is tracked by the player (you start with 3).")
    mark(c)

    # --- Omen of Death (3rd): frightened for 1 minute (repeat save, Midi OverTime); advantage vs frightened.
    o = S.get("Omen of Death")
    a = o["system"]["activities"]["7iJWff7wrgkdEqqV"]
    a["range"] = RANGE_SELF
    a["target"] = sphere(30)
    a["target"]["affects"]["choice"] = True
    for e in o["effects"]:
        if e["_id"] == "ic6dPQKN7voOmx4g": e["duration"] = {"rounds": 10}
    aura = fx(o, "adv", "Omen of Death: advantage vs frightened", rounds=0,
              changes=[("flags.midi-qol.advantage.attack.all", 0, "target.statuses?.frightened")],
              desc="You have advantage on attack rolls against frightened creatures.")
    for e in o["effects"]:
        if e["_id"] == aura: e.update({"transfer": True, "duration": {}})
    mark(o)

    # --- Raven's Eye (6th): +1 passive Perception per crow; switch crows as a bonus action.
    rv = S.get("Raven’s Eye")
    eye = fx(rv, "eye", "Raven's Eye (+1 passive Perception per crow)", rounds=0,
             changes=[("system.skills.prc.bonuses.passive", 2, "@flags.jjk5e.crows")],
             desc="Set the actor flag jjk5e.crows to your current number of crows (default 3).")
    for e in rv["effects"]:
        if e["_id"] == eye: e.update({"transfer": True, "duration": {}})
    note(rv, "Passive Perception bonus reads flags.jjk5e.crows (number of crows).")
    mark(rv)

    # --- Bird Strike (11th): 10d10 necrotic, half on a DEX save; a failure damages a limb (d6).
    b = S.get("Bird Strike")
    bs = b["system"]["activities"]["QwWYu4v3lWvMwTb9"]
    bs["target"] = {"affects": {"type": "creature", "count": "1"}, "override": True}
    bs["damage"]["onSave"] = "half"
    limb = fx(b, "limb", "Bird Strike: damaged limb", rounds=0,
              desc="One limb is damaged: roll 1d6 for which (1 right arm, 2 left arm, 3 right leg, 4 left leg, "
                   "5 torso, 6 head; GM applies the effect). The crow dies.")
    for e in b["effects"]:
        if e["_id"] == limb: e["duration"] = {}
    apply(bs, limb)
    roll = act(b, "limb-roll", "utility", "Damaged limb (d6)", "special", roll={"formula": "1d6", "name": "Limb", "prompt": False, "visible": True},
               range=RANGE_SELF, target=SELF)
    free(b, roll)
    trigger(bs, roll, "failedSaves")
    mark(b)

    # --- Black Mahakala (18th): at initiative 20, Bird Strike on up to three targets for free.
    d = S.get("Domain Expansion: Black Mahakala")
    i20 = act(d, "init20", "save", "Initiative 20: Bird Strike ×3 (free)", "special",
              range={"units": "spec", "override": True},
              target={"affects": {"type": "creature", "count": "3", "choice": True}, "override": True},
              save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
              damage={"onSave": "half", "parts": [dice(10, 10, ["necrotic"])]})
    limb2 = fx(d, "limb", "Bird Strike: damaged limb", rounds=0, desc="Roll 1d6 for the damaged limb (GM).")
    for e in d["effects"]:
        if e["_id"] == limb2: e["duration"] = {}
    apply(i20, limb2)
    free(d, i20)
    mark(d)

    # --- Reversal: White Bird Manipulation — doves; sacrifice a dove to heal 1d8 per CE.
    w = S.get("White Bird Manipulation")
    conv = w["system"]["activities"]["xX0DRqjTwBBubzWs"]
    conv["name"] = "Turn crows into doves — Bonus Action (2 CE each)"
    conv["effects"] = []
    w["effects"] = [e for e in w.get("effects", []) if e["_id"] != "zmUYBXHKwqE9te79"]
    conv["range"], conv["target"] = RANGE_SELF, SELF
    heal = act(w, "dove-heal", "heal", "Sacrifice a dove: heal (1+ CE)", "special",
               healing={"number": 1, "denomination": 8, "bonus": "", "types": ["healing"],
                        "custom": {"enabled": False, "formula": ""}, "scaling": {"number": 1}},
               range={"value": "5", "units": "ft", "override": True},
               target={"affects": {"type": "creature", "count": "1"}, "override": True})
    cost(w, heal, 1, 1, f"2 * {CE}")
    ward = fx(w, "ward", "Dove ward", rounds=0,
              changes=[("flags.midi-qol.advantage.ability.save.all", 0, "1")],
              desc="Within 30 ft of a dove: advantage on saves against charmed and frightened; dying allies are "
                   "stabilised; a dove can suppress a charm or fright effect (GM).")
    for e in w["effects"]:
        if e["_id"] == ward: e.update({"transfer": False, "duration": {}})
    aura = act(w, "ward", "utility", "Dove ward (allies within 30 ft)", "special",
               range=RANGE_SELF, target=sphere(30))
    aura["target"]["affects"]["type"] = "ally"
    apply(aura, ward)
    free(w, aura)
    note(w, "Dove ward gives advantage on all saves as an approximation of 'against charmed and frightened'; remove "
            "it when the dove leaves.")
    mark(w)


def black_box(S):
    cube_stats = ("Cube: AC = your CE save DC + 5 (+1 per 2 reinforcements), HP = proficiency × 2 × CE modifier "
                  "(+10 per reinforcement), immune to psychic and poison; −1 damage taken per reinforcement.")
    # --- Dark Cube (1st): DEX save or trapped (blinded without light); reinforcements as extra CE.
    d = S.get("Dark Cube")
    a = d["system"]["activities"]["UNgkJB1hNYCx1HyF"]
    a["range"] = {"value": "30", "units": "ft", "override": True}
    a["target"] = sphere(10, kind="cube")
    a["duration"] = {"value": "1", "units": "minute", "override": True}
    for e in d["effects"]:
        if e["_id"] == "FC6A5IxdtB0bgbYq":
            e.update({"name": "Trapped in Dark Cube", "duration": {"rounds": 10},
                      "description": "<p>Trapped inside the cube: full cover against attacks from outside; blinded "
                                     "unless there is a light inside. " + cube_stats + "</p>"})
    cost(d, a, 2, 1, CE)
    a["name"] = "Action (2+ CE)"
    note(d, "Extra CE = reinforcements (Black Box Reinforcement, up to your CE modifier; twice at 11th). " + cube_stats)
    mark(d)

    # --- Perfect Cube (6th): +5 CE, resistance to all damage, cannot be seen into or invaded.
    pc = S.get("Perfect Cube")
    note(pc, "Spend with Dark Cube: the cube (not you) resists all damage and ignores abilities that would destroy, "
             "see into or invade it. Counts as 5 reinforcements.")
    mark(pc)

    # --- Maximum: Midnight Armor (11th): cube HP as temp HP, AC = cube AC, CE unarmed strikes 3d8 + mod necrotic.
    m = S.get("Maximum: Midnight Armor")
    arm = fx(m, "armor", "Midnight Armor", rounds=10,
             changes=[("system.attributes.ac.calc", 5, "custom"),
                      ("system.attributes.ac.formula", 5, "@attributes.spell.dc + 5")],
             desc="AC equals your Dark Cube's AC for 1 minute or until the temporary hit points are gone. "
                  "Use 'Midnight Armor strike' for unarmed strikes.")
    act(m, "nRKiEvk8BGn2WkHh", "heal", "Action (6+ CE)", "action",
        healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                 "custom": {"enabled": True, "formula": f"@prof * 2 * {CE}"}, "scaling": {"mode": "whole", "formula": "10"}},
        range=RANGE_SELF, target=SELF, duration={"value": "1", "units": "minute", "override": True})
    h = m["system"]["activities"]["nRKiEvk8BGn2WkHh"]
    apply(h, arm)
    cost(m, h, 6, 1, f"2 * {CE}")
    strike = act(m, "strike", "attack", "Midnight Armor strike (unarmed)", "action",
                 attack={"ability": "", "bonus": "", "critical": {"threshold": None}, "flat": False,
                         "type": {"value": "melee", "classification": "spell"}},
                 damage={"includeBase": False, "parts": [dice(3, 8, ["necrotic"], "@mod")]},
                 range={"value": "5", "units": "ft", "override": True},
                 target={"affects": {"type": "creature", "count": "1"}, "override": True})
    free(m, strike)
    mark(m)

    # --- Primordial Gap (18th): at initiative 20, three Perfect Cubes trap up to three creatures.
    pg = S.get("Domain Expansion: Primordial Gap")
    trap = fx(pg, "trap", "Trapped in a Perfect Cube", rounds=10,
              desc="Trapped in a Perfect Cube with reinforcements up to the caster's CE modifier, until the domain "
                   "ends. " + cube_stats)
    i20 = act(pg, "init20", "save", "Initiative 20: three Perfect Cubes", "special",
              target={"affects": {"type": "creature", "count": "3", "choice": True}, "override": True},
              save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
              damage={"onSave": "none", "parts": []})
    apply(i20, trap)
    free(pg, i20)
    mark(pg)

    # --- Reversal: Glass Box — brittle cube; shatters for (CE + prof)d8 slashing in 5 ft.
    g = S.get("Glass Box")
    gtrap = fx(g, "trap", "Trapped in Glass Box", rounds=10,
               desc="Trapped inside a see-through cube with full cover from outside. Cube AC = CE save DC − 5, "
                    "HP = 2 × proficiency. Creatures inside save against its shards with disadvantage.")
    for aid, act_name, rng, activation in [("wzFfstEZv4KfN2ty", "Action (4 CE)", "30", "action"),
                                           ("Z6NkFzlwwXNqq4K0", "Reaction (6 CE)", "10", "reaction")]:
        act(g, aid, "save", act_name, activation,
            range={"value": rng, "units": "ft", "override": True}, target=sphere(10, kind="cube"),
            save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
            damage={"onSave": "none", "parts": []}, duration={"value": "1", "units": "minute", "override": True})
        ga = g["system"]["activities"][aid]
        apply(ga, gtrap)
    g["system"]["activities"]["Z6NkFzlwwXNqq4K0"]["useConditionText"] = "false"
    shatter = act(g, "shatter", "save", "Shatter (cube reaches 0 HP)", "special",
                  target=sphere(5), save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
                  damage={"onSave": "half", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["slashing"],
                          "custom": {"enabled": True, "formula": f"({CE} + @prof)d8"}, "scaling": {}}]})
    free(g, shatter)
    mark(g)

    # --- Glass Weakening: every 2 CE adds CE-modifier slashing to the shatter (and −1 AC/HP, +5 ft size).
    w = S.get("Glass Weakening")
    act(w, "RisoxJ2Bam0AlTUe", "damage", "Shatterability (2+ CE)", "special",
        damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["slashing"],
                           "custom": {"enabled": True, "formula": CE}, "scaling": {"mode": "whole", "formula": CE}}]},
        target=sphere(5))
    ww = w["system"]["activities"]["RisoxJ2Bam0AlTUe"]
    cost(w, ww, 2, 2, f"2 * {CE}")
    note(w, "Roll with Glass Box's shatter: extra slashing per weakening. Fragility/Size are applied by the GM.")
    mark(w)


def hp_cost(a, hp, scale_step=0):
    """Blood techniques also cost hit points (untick it in the usage dialog with another blood source)."""
    t = {"type": "attribute", "target": "attributes.hp.value", "value": str(hp)}
    if scale_step: t["scaling"] = {"mode": "amount", "formula": str(scale_step)}
    a["consumption"]["targets"] = [t]


def blood_manipulation(S):
    atk = lambda kind: {"ability": "", "bonus": "", "critical": {"threshold": None}, "flat": False,
                        "type": {"value": kind, "classification": "spell"}}
    one = {"affects": {"type": "creature", "count": "1"}, "override": True}
    ft = lambda n: {"value": str(n), "units": "ft", "override": True}

    # --- Blood Constructs (1st): 1 CE + 1 HP per 5 ft of construct.
    c = S.get("Blood Constructs")
    ca = c["system"]["activities"]["wVNUhJj3IichuJs5"]
    ca["name"] = "Action (1+ CE, 1+ HP)"
    cost(c, ca, 1, 1, "20")
    hp_cost(ca, 1, 1)
    note(c, "Construct HP = your level × CE spent. Untick the HP cost when you use another blood source. "
            "Blood Bags are tracked as inventory.")
    mark(c)

    # --- Blood Techniques (1st): each technique as its own activity with its CE and HP cost.
    b = S.get("Blood Techniques")
    rest = fx(b, "bind", "Restrained (Crimson Binding)", statuses=["restrained"], rounds=10,
              desc="Bound by a blood net; repeats the Strength save at the start of each of its turns.")
    for e in b["effects"]:
        if e["_id"] == rest:
            e["changes"] = [{"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                             "value": 'turn=start, saveAbility=str, saveDC=JJKORIGINDC, saveCount=1-, label="Crimson Binding"'}]
    b["effects"] = [e for e in b["effects"] if e["_id"] not in ("uJDin3pB0j6Pt2KK", "FiMuV25bcEXdbaP1")]
    cb = act(b, "pyzvctFBrnf7glUx", "save", "Crimson Binding (1 CE, 1 HP)", "action", range=ft(30), target=one,
             save={"ability": ["str"], "dc": {"calculation": "spellcasting", "formula": ""}}, damage={"onSave": "none", "parts": []})
    apply(cb, rest); cost(b, cb, 1); hp_cost(cb, 1)
    se = act(b, "slicing", "attack", "Slicing Exorcism (1 CE, 1 HP)", "action", range=ft(60), target=one,
             attack=atk("ranged"), damage={"includeBase": False, "parts": [dice(1, 10, ["necrotic"], "@mod")]})
    cost(b, se, 1); hp_cost(se, 1)
    edge_fx = fx(b, "edge", "Blood Edge", rounds=10,
                 desc="A blood weapon (magical for overcoming resistance): +1 damage tier per 2 CE spent "
                      "(d10 → d12 → 2d8), lasts 1 minute.")
    edge = act(b, "edge", "utility", "Blood Edge (free, CE up to your modifier)", "special", range=RANGE_SELF, target=SELF)
    apply(edge, edge_fx); cost(b, edge, 1, 1, CE)
    cr = act(b, "F4wHJtXWhPY2U4aV", "save", "Crimson Rain (3 CE, 2 HP)", "action", range=ft(60), target=sphere(15),
             save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
             damage={"onSave": "half", "parts": [dice(3, 10, ["piercing"])]})
    cost(b, cr, 3); hp_cost(cr, 2)
    burst = act(b, "burst", "save", "Blood Burst (1 CE, 1 HP)", "special", range=ft(5), target=one,
                save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
                damage={"onSave": "none", "parts": [dice(4, 6, ["necrotic"])]})
    burst["activation"]["condition"] = "Once per turn when you hit with a weapon attack"
    cost(b, burst, 1); hp_cost(burst, 1)
    met = act(b, "meteor", "attack", "Blood Meteorite (1 CE, 3 HP)", "action", range=ft(30), target=one,
              attack=atk("ranged"), damage={"includeBase": False, "parts": [dice(4, 4, ["bludgeoning"], "@mod")]})
    cost(b, met, 1); hp_cost(met, 3)
    gey = act(b, "geyser", "save", "Blood Geyser (3 CE, 3 HP)", "action", range=ft(10), target=sphere(5),
              save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
              damage={"onSave": "half", "parts": [dice(5, 10, ["bludgeoning"])]})
    gey["activation"]["condition"] = "Also when a creature starts its turn in or enters the area (launched 30 ft up)"
    cost(b, gey, 3); hp_cost(gey, 3)
    note(b, "You know three techniques (+2 at 6th and 11th): use only the ones you chose. With Convergence, Crimson "
            "Rain also knocks prone (GM).")
    mark(b)

    # --- Flowing Red Scale (3rd): keep the module's AC/speed buff; add the advantages; drop the old toggle.
    f = S.get("Flowing Red Scale")
    f["effects"] = [e for e in f.get("effects", []) if e["_id"] != "ZHLStW986TAesiju"]
    adv = fx(f, "adv", "Flowing Red Scale: advantages", rounds=10,
             changes=[("flags.midi-qol.advantage.ability.save.dex", 0, "1"),
                      ("flags.midi-qol.advantage.ability.check.str", 0, "1")],
             desc="Advantage on Dexterity saving throws and Strength checks for 1 minute (speed and AC come from the "
                  "technique's own buff). Extra limited action each turn: GM.")
    fa = f["system"]["activities"]["SBbp4UPlSVhFiioL"]
    fa["range"], fa["target"] = RANGE_SELF, SELF
    apply(fa, adv)
    mark(f)

    # --- Convergence (6th): charged technique: +prof damage dice (Midi optional bonus) for the next technique.
    cv = S.get("Convergence")
    charge = fx(cv, "charge", "Convergence (charged)", rounds=1, special=["1Spell"],
                changes=[("flags.midi-qol.optional.Convergence.damage.all", 0, "(@prof)d10"),
                         ("flags.midi-qol.optional.Convergence.count", 0, "1"),
                         ("flags.midi-qol.optional.Convergence.label", 0, "Convergence: +prof damage dice")],
                desc="Your next Blood technique this turn: +proficiency damage dice, damage die one step larger, "
                     "+30 ft range (Midi offers the extra dice as an optional bonus).")
    ca = cv["system"]["activities"]["qNvp8X1IeGQJn56M"]
    ca["name"] = "Charge (bonus action, reaction and movement)"
    ca["range"], ca["target"] = RANGE_SELF, SELF
    apply(ca, charge)
    quick = act(cv, "quick", "utility", "Quick Convergence (1+ CE)", "special", range=RANGE_SELF, target=SELF)
    quick["activation"]["condition"] = "When you use a Blood Technique: +1 die (Slicing, Burst, Meteorite), +1 DC "\
                                       "(Binding) or +1 per die (Rain, Geyser) per CE; max 1/2/3 CE at 1st/11th/18th"
    cost(cv, quick, 1, 1, "3")
    mark(cv)

    # --- Piercing Blood (11th): 100-ft line, 8 CE + 5 HP; Convergence sweep in a 130-ft cone.
    pb = S.get("Piercing Blood")
    p1 = pb["system"]["activities"]["4LA53X4gsUOzmo1s"]
    p1["target"] = {"template": {"type": "line", "size": "100", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                    "affects": {"type": "creature", "choice": False}, "override": True}
    p1["range"] = RANGE_SELF
    hp_cost(p1, 5)
    p2 = pb["system"]["activities"]["VwHHoCDnTNKGLfKH"]
    p2["target"] = {"template": {"type": "cone", "size": "130", "units": "ft", "count": "1", "contiguous": False},
                    "affects": {"type": "creature", "choice": False}, "override": True}
    p2["range"] = RANGE_SELF
    mark(pb)

    # --- Bloodbath (18th): 4d12 necrotic to all creatures at initiative 20.
    bb = S.get("Domain Expansion: Bloodbath")
    d = bb["system"]["activities"]["Buq47Z33ocVziK66"]
    d["name"] = "Initiative 20: blood attacks from inside"
    d["target"] = {"affects": {"type": "creature", "choice": True}, "override": True}
    note(bb, "Inside the domain your blood techniques may take their HP cost from other creatures in it (GM).")
    mark(bb)

    # --- Reversal: Blood Puppet — CON save or incapacitated puppet (concentration), repeat save each turn.
    bp = S.get("Blood Puppet")
    pup = fx(bp, "puppet", "Blood Puppet", statuses=["incapacitated"], rounds=10,
             changes=[("flags.midi-qol.OverTime", 0,
                       'turn=start, saveAbility=con, saveDC=JJKORIGINDC, saveCount=1-, label="Blood Puppet"')],
             desc="Cannot control its body or use its cursed technique; the puppeteer moves it 30 ft or makes it "
                  "attack with its weapons (action or bonus action). Repeats the CON save at the start of its turns.")
    a1 = bp["system"]["activities"]["FDkIfSPeFZDwdErl"]
    a1["range"], a1["target"] = ft(60), one
    a1["duration"] = {"value": "1", "units": "minute", "concentration": True, "override": True}
    apply(a1, pup)
    act(bp, "nFiAWtEmSARotYEs", "utility", "Command puppet (bonus action)", "bonus", range=ft(60), target=one)
    free(bp, bp["system"]["activities"]["nFiAWtEmSARotYEs"])
    mark(bp)


def boogie_woogie(S):
    ft = lambda n: {"value": str(n), "units": "ft", "override": True}
    one = {"affects": {"type": "creature", "count": "1", "choice": True}, "override": True}
    # --- Boogie (1st): the module swaps tokens; range 30 ft; enemies swapped with Woogie lose their reaction.
    b = S.get("Boogie")
    for aid in ("ih4MTTL3k7FulYvj", "bwBonusAction001", "bwReaction002CE"):
        a = b["system"]["activities"][aid]
        a["range"], a["target"] = ft(30), one
        a["effects"] = []
    w = S.get("Woogie")
    w.setdefault("effects", [])
    lost = fx(w, "disoriented", "Disoriented (Boogie Woogie)", rounds=1, special=["turnStartSource"],
              desc="Teleported by Boogie Woogie: loses its reaction until your next turn.")
    dis = act(w, "disorient", "utility", "Swapped enemy loses its reaction", "special", range=ft(60), target=one)
    apply(dis, lost)
    mark(w)
    b["system"]["activities"]["bwReaction002CE"]["useConditionText"] = "false"
    note(b, "The token swap is done by the module (range from the activity). Woogie (3rd): unwilling creatures, swap "
            "two others; enemies lose their reaction (Woogie item). Round of Applause (11th): 60 ft, up to four "
            "creatures, advantage on the next attack after a favourable swap (GM).")
    mark(b)

    # --- Clap Back (6th): once per turn free-action Boogie for 1 CE at 45 ft (swap handled by the module).
    c = S.get("Clap Back")
    ca = c["system"]["activities"]["ouA0eQeNTPbAg5Zb"]
    ca["name"] = "Free-action Boogie (1 CE, once per turn)"
    ca["range"], ca["target"] = ft(45), one
    c["flags"]["jjk5e"].setdefault("tokenSwap", {})["ouA0eQeNTPbAg5Zb"] = True
    note(c, "Also reduces every Boogie Woogie cost by 1 (min 1): pay the lower cost (GM).")
    mark(c)

    # --- Standing Ovation (18th): unlimited free Boogie without CE inside the domain.
    d = S.get("Domain Expansion: Standing Ovation")
    da = d["system"]["activities"]["LEryQhWsnH8HS9rS"]
    da["name"] = "Free Boogie (no CE, unlimited)"
    da["range"], da["target"] = ft(175), one
    free(d, da)
    d["flags"]["jjk5e"].setdefault("tokenSwap", {})["LEryQhWsnH8HS9rS"] = True
    mark(d)

    # --- Reversal: Slow Dance — you and two others stunned until your next turn; later CE saves to end it.
    sd = S.get("Slow Dance")
    for e in sd["effects"]:
        if e["_id"] == "nipdvIZgJypmVzha":
            e["duration"] = {"rounds": 1}
            e.setdefault("flags", {})["dae"] = {"specialDuration": ["turnStartSource"]}
            e["changes"] = [{"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                             "value": 'turn=end, saveAbility=wis, saveDC=JJKORIGINDC, saveCount=1-, label="Slow Dance"'}]
            e["description"] = ("<p>Stunned until the start of the caster's next turn; after the first use an affected "
                                "creature may make a CE saving throw at the end of its turns to end it.</p>")
    base = sd["system"]["activities"]["bBXvb2CNLAATvN2K"]
    base["range"] = ft(60)
    base["target"] = {"affects": {"type": "creature", "count": "3", "choice": True}, "override": True}
    for key, label, kind in [("bonus", "Bonus Action (2 CE)", "bonus"), ("reaction", "Reaction (2 CE)", "reaction")]:
        a = act(sd, key, "utility", label, kind, range=ft(60),
                target={"affects": {"type": "creature", "count": "3", "choice": True}, "override": True})
        apply(a, "nipdvIZgJypmVzha")
        cost(sd, a, 2)
        if kind == "reaction": a["useConditionText"] = "false"
    note(sd, "Targets: yourself and two other creatures or objects.")
    mark(sd)


def cursed_speech(S):
    ft = lambda n: {"value": str(n), "units": "ft", "override": True}
    one = {"affects": {"type": "creature", "count": "1", "choice": True}, "override": True}
    cha = lambda: {"ability": ["cha"], "dc": {"calculation": "spellcasting", "formula": ""}}
    X = CE
    p = S.get("Power of Words")
    keep = {}
    for old in list(p["system"]["activities"]):
        p["system"]["activities"].pop(old)
    p["flags"]["jjk5e"]["ceCosts"] = {}
    p["flags"]["jjk5e"]["ceSteps"] = {}
    p["effects"] = []

    def word(key, label, cost_, typ, **kw):
        a = act(p, key, typ, label, "action", **kw)
        cost(p, a, cost_, 1, "4")
        return a

    sl = word("sleep", "Sleep (1+ CE): 5d8 HP of creatures", 1, "utility", range=ft(60),
              target=sphere(20), roll={"formula": "5d8", "name": "Sleep HP", "prompt": False, "visible": True})
    asleep = fx(p, "sleep", "Asleep (Cursed Speech)", statuses=["unconscious"], rounds=10,
                desc="Falls asleep (Sleep): ends if it takes damage or someone uses an action to wake it. Affect "
                     "creatures in ascending HP order up to the rolled total (+3d8 per extra CE).")
    apply(sl, asleep)
    sl["activation"]["condition"] = "Replaces one attack"
    ret = word("return", "Return (1+ CE): unsummon", 1, "save", range=ft(60), target=one, save=cha(),
               damage={"onSave": "none", "parts": []})
    apply(ret, fx(p, "return", "Unsummoned", rounds=1, desc="This summoned creature is unsummoned."))
    run = word("run", "Run Away (2+ CE)", 2, "utility", range=ft(60), target=one)
    apply(run, fx(p, "run", "Run Away (Cursed Speech)", rounds=1, special=["turnEnd"],
                  desc="Must use its movement to run away from you on its next turn (not into harm). +1 target or "
                       "+1 DC per extra CE."))
    blast = word("blast", "Blast Away (4+ CE)", 4, "save", range=ft(60), target=one, save=cha(),
                 damage={"onSave": "none", "parts": [dice(6, 8, ["force"], "", 1)]})
    blast["activation"]["condition"] = "Launched 60 ft (+10 ft and +1d8 per extra CE)"
    plum = word("plummet", "Plummet (6+ CE)", 6, "save", range=ft(60), target=one, save=cha(),
                damage={"onSave": "none", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["force"],
                        "custom": {"enabled": True, "formula": f"({X})d10"}, "scaling": {"mode": "whole", "formula": f"({X})d10"}}]})
    apply(plum, fx(p, "plummet", "Plummet: crushed prone", statuses=["prone"], rounds=10,
                   changes=[("flags.midi-qol.OverTime", 0,
                             'turn=end, saveAbility=str, saveDC=JJKORIGINDC, saveCount=1-, label="Plummet"')],
                   desc="Prone for 1 minute under crushing gravity; ends with a Strength save on its turn."))
    tw = word("twist", "Get Twisted (8+ CE)", 8, "save", range=ft(60), target=one, save=cha(),
              damage={"onSave": "none", "parts": []})
    apply(tw, fx(p, "twist", "Twisted limb", rounds=0,
                 desc="One limb broken: an arm cannot be used and −2 Strength, or a leg halves speed and −2 Dexterity. "
                      "Loses HP = its Constitution score × half your proficiency bonus (GM)."))
    cr = word("crush", "Get Crushed (10+ CE)", 10, "save", range=ft(60), target=one, save=cha(),
              damage={"onSave": "none", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["force"],
                      "custom": {"enabled": True, "formula": f"({X})d12"}, "scaling": {"mode": "whole", "formula": "1d12"}}]})
    apply(cr, fx(p, "crush", "Imploding", statuses=["paralyzed"], rounds=10,
                 changes=[("flags.midi-qol.OverTime", 0,
                           'turn=end, saveAbility=str, saveDC=JJKORIGINDC, saveCount=1-, label="Get Crushed"')],
                 desc="Paralyzed for 1 minute (Strength save at the end of its turns ends it). The damage is lost "
                      "maximum HP (regained on a long rest); it repeats at the start of its turns (GM rolls)."))
    stun = word("stun", "Don't Move (12+ CE): Power Word Stun", 12, "utility", range=ft(60), target=one)
    apply(stun, fx(p, "stun", "Don't Move (stunned)", statuses=["stunned"], rounds=10,
                   changes=[("flags.midi-qol.OverTime", 0,
                             'turn=end, saveAbility=con, saveDC=JJKORIGINDC, saveCount=1-, label="Don\'t Move"')],
                   desc="Power Word Stun: only if it has 150 HP or fewer (+25 per extra CE). Constitution save at the "
                        "end of each of its turns ends it."))
    ex = word("explode", "Explode (14+ CE)", 14, "save", range=ft(60), target=sphere(5), save=cha(),
              damage={"onSave": "none", "parts": [dice(3, 8, ["force"], "", 1),
                      {"number": None, "denomination": None, "bonus": "", "types": ["fire"],
                       "custom": {"enabled": True, "formula": f"({X})d6"}, "scaling": {}}]})
    die = word("die", "Die (16+ CE)", 16, "save", range=ft(60), target=one, save=cha(),
               damage={"onSave": "none", "parts": []})
    apply(die, fx(p, "die", "Die (Cursed Speech)", statuses=["dead"], rounds=0,
                  desc="Dies instantly if it has at most 30 × your CE modifier HP (+10 and +1 DC per extra CE)."))
    note(p, "Every word also damages your vocal cords (1 HP per CE). Extra CE: +1 DC where the word says so (GM).")
    mark(p)

    i = S.get("Interjection")
    note(i, "Use the chosen word's activity as a bonus action or reaction.")
    mark(i)

    e = S.get("Domain Expansion: Echo Chamber")
    w = act(e, "init20", "utility", "Initiative 20: a word on everyone (free)", "special",
            target={"affects": {"type": "creature", "choice": True}, "override": True})
    free(e, w)
    note(e, "At initiative 20, use any Power of Words activity on all chosen creatures without paying CE "
            "(the domain sure-hit makes them fail the save).")
    mark(e)

    cs = S.get("Cursed Silence")
    sil = cs["system"]["activities"]["M78rbnTh6yG7lnkv"]
    sil["name"] = "Silence (2 CE)"
    sil["range"], sil["target"] = ft(120), sphere(20)
    apply(sil, fx(cs, "silence", "Silence", rounds=100, desc="Silence spell: no sound in a 20-ft sphere for 10 minutes."))
    big = cs["system"]["activities"]["W2HtQiO9cO2OMF6d"]
    big["name"] = "Cursed Silence (8 CE)"
    big["save"] = {"ability": ["wis", "cha"], "dc": {"calculation": "spellcasting", "formula": ""}}
    big["range"], big["target"] = ft(120), one
    big["duration"] = {"value": "1", "units": "minute", "concentration": True, "override": True}
    apply(big, fx(cs, "cursed", "Cursed Silence", rounds=10,
                  desc="Cannot speak. Must make a Wisdom save each time it tries to take an action or skips it. "
                       "On a success against the technique it is immune for 1 minute."))
    mark(cs)


DIE_BY_LEVEL = "(6 + 2 * (floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18)))"
DIE_BY_LEVEL_3 = "(6 + 2 * (floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11)))"


def blazing_courage(S):
    ft = lambda n: {"value": str(n), "units": "ft", "override": True}
    custom = lambda formula, t: {"number": None, "denomination": None, "bonus": "", "types": [t],
                                 "custom": {"enabled": True, "formula": formula}, "scaling": {}}
    # --- Ignition (1st): bonus action, 1..prof CE; +Nd6 fire per CE on melee weapon hits for 1 minute.
    ig = S.get("Ignition")
    ig["system"]["activities"] = {}
    ig["flags"]["jjk5e"]["ceCosts"], ig["flags"]["jjk5e"]["ceSteps"] = {}, {}
    ig["effects"] = []
    for n in range(1, 7):
        e = fx(ig, f"ign{n}", f"Ignition ({n} CE)", rounds=10,
               changes=[("system.bonuses.mwak.damage", 2, f"+ {n}d{DIE_BY_LEVEL}[fire]"),
                        ("flags.jjk5e.ignition", 5, str(n))],
               desc=f"Your melee weapon burns for 1 minute: +{n} fire damage dice on a hit (d6, d8 at 6th, d10 at "
                    "11th, d12 at 18th); bright light 5 ft, dim 10 ft.")
        a = act(ig, "OKvwwUwpanZQnU9d" if n == 1 else f"ign{n}", "utility", f"Ignition — {n} CE", "bonus",
                range=RANGE_SELF, target=SELF, duration={"value": "1", "units": "minute", "override": True})
        a["activation"]["condition"] = f"Proficiency bonus ≥ {n}" if n > 1 else "While holding a melee weapon"
        apply(a, e)
        cost(ig, a, n)
    mark(ig)

    # --- Mantle of Courage (3rd): free action 3 CE, aura 10 ft: resist fire/cold; enemies CON save vs Ignition dice.
    m = S.get("Mantle of Courage")
    m["effects"] = [e for e in m.get("effects", []) if e["_id"] != "fMhgS7ampc0pY9Q3"]
    res = fx(m, "res", "Mantle of Courage", rounds=10,
             changes=[("system.traits.dr.value", 2, "fire"), ("system.traits.dr.value", 2, "cold")],
             desc="Aura of flames (10 ft) for 1 minute: resistance to fire and cold. Enemies entering or starting "
                  "their turn there use 'Mantle: burn'.")
    on = act(m, "tOmjfZVwLHC54lbH", "utility", "Mantle on — free action (3 CE)", "special", range=RANGE_SELF, target=SELF)
    on["activation"]["condition"] = "While Ignition is active"
    apply(on, res)
    cost(m, on, 3)
    burn = act(m, "burn", "save", "Mantle: burn (enters / starts turn)", "special", range=RANGE_SELF, target=sphere(10),
               save={"ability": ["con"], "dc": {"calculation": "spellcasting", "formula": ""}},
               damage={"onSave": "half", "parts": [custom(f"(@flags.jjk5e.ignition)d{DIE_BY_LEVEL}", "fire")]})
    burn["target"]["affects"]["type"] = "enemy"
    free(m, burn)
    mark(m)

    # --- Maximum: Conflagration (11th): 30-ft cone, 10d12 fire + prone; severe burns on fail by 5+.
    c = S.get("Maximum: Conflagration")
    ca = c["system"]["activities"]["PjW4MhuJXtZcWTEL"]
    ca["target"] = {"template": {"type": "cone", "size": "30", "units": "ft", "count": "1", "contiguous": False},
                    "affects": {"type": "creature"}, "override": True}
    ca["range"] = RANGE_SELF
    ca["damage"]["onSave"] = "half"
    burns = fx(c, "burns", "Severe burns", rounds=0,
               changes=[("system.traits.dm.amount.fire", 2, "+@prof")],
               desc="Failed by 5 or more: takes extra fire damage equal to the caster's proficiency bonus from any "
                    "fire until it finishes a long rest (apply by hand on a fail by 5+).")
    sb = act(c, "burns", "utility", "Severe burns (failed by 5+)", "special", target=one_creature())
    apply(sb, burns)
    free(c, sb)
    mark(c)

    # --- Fire of the Heart (18th): max Ignition; at initiative 20 the Mantle damage hits all chosen creatures.
    d = S.get("Domain Expansion: Fire of the Heart")
    i20 = act(d, "init20", "save", "Initiative 20: Mantle of Courage", "special",
              target={"affects": {"type": "enemy", "choice": True}, "override": True},
              save={"ability": ["con"], "dc": {"calculation": "spellcasting", "formula": ""}},
              damage={"onSave": "half", "parts": [custom(f"(@prof)d{DIE_BY_LEVEL}", "fire")]})
    free(d, i20)
    note(d, "Your held melee weapon counts as Ignition at maximum CE and gets the domain's sure-hit.")
    mark(d)

    # --- Reversal: Freezing Resolve — 2..2×CE CE: +N d6 cold per 2 CE (d8 at 6th, d10 at 11th).
    f = S.get("Freezing Resolve")
    f["system"]["activities"] = {}
    f["flags"]["jjk5e"]["ceCosts"], f["flags"]["jjk5e"]["ceSteps"] = {}, {}
    f["effects"] = []
    for n in (2, 4, 6, 8, 10):
        e = fx(f, f"frz{n}", f"Freezing Resolve ({n} CE)", rounds=10,
               changes=[("system.bonuses.mwak.damage", 2, f"+ {n}d{DIE_BY_LEVEL_3}[cold]"),
                        ("flags.jjk5e.freezing", 5, str(n))],
               desc=f"Your melee weapon freezes for 1 minute: +{n} cold damage dice on a hit (2 dice per 2 CE).")
        a = act(f, "qtyDXA6HZfw6i9Wr" if n == 2 else f"frz{n}", "utility", f"Freezing Resolve — {n} CE", "bonus",
                range=RANGE_SELF, target=SELF, duration={"value": "1", "units": "minute", "override": True})
        a["activation"]["condition"] = f"Up to 2 × CE modifier ({n} CE)"
        apply(a, e)
        cost(f, a, n)
    mark(f)

    # --- Mantle of Resolve: 6 CE aura of ice: resist cold/fire; CON save vs Freezing dice, speed 0 on a failure.
    mr = S.get("Mantle of Resolve")
    on2 = act(mr, "xROz3gAcBRYclR9H", "utility", "Mantle of ice — Action (6 CE)", "action", range=RANGE_SELF, target=SELF)
    apply(on2, fx(mr, "res", "Mantle of Resolve", rounds=10,
                  changes=[("system.traits.dr.value", 2, "cold"), ("system.traits.dr.value", 2, "fire")],
                  desc="Ring of ice (10 ft) for 1 minute: resistance to cold and fire."))
    cost(mr, on2, 6)
    frz = act(mr, "freeze", "save", "Ring of ice (enters / starts turn)", "special", range=RANGE_SELF, target=sphere(10),
              save={"ability": ["con"], "dc": {"calculation": "spellcasting", "formula": ""}},
              damage={"onSave": "half", "parts": [custom(f"(@flags.jjk5e.freezing)d{DIE_BY_LEVEL_3}", "cold")]})
    frz["target"]["affects"]["type"] = "enemy"
    apply(frz, fx(mr, "stop", "Frozen in place", rounds=1, special=["turnEnd"],
                  changes=[(f"system.attributes.movement.{k}", 5, "0") for k in ("walk", "fly", "swim", "climb", "burrow")],
                  desc="Speed 0 (failed the ring of ice save)."))
    free(mr, frz)
    mark(mr)


def one_creature():
    return {"affects": {"type": "creature", "count": "1", "choice": True}, "override": True}


def body_manipulation(S):
    g = S.get("Graverobber")
    a = g["system"]["activities"]["P9IpMoskuDAa5VWI"]
    a["name"] = "Transfer into a corpse (1 CE, long rest)"
    a["activation"] = {"type": "special", "value": None, "condition": "During a long rest, with a humanoid corpse", "override": True}
    a["range"], a["target"] = {"value": "5", "units": "ft", "override": True}, one_creature()
    a["check"] = {"ability": "wis", "dc": {"calculation": "", "formula": "30"}}
    note(g, "Body swap is a character-sheet change (ability scores except INT/WIS/CHA, racial features, technique). "
            "Others spot it with a DC 30 Insight check (advantage if they knew the body's owner).")
    mark(g)
    br = S.get("Brain Manipulation")
    b = br["system"]["activities"]["rv0eJkh5Z7W5C7uN"]
    b["range"], b["target"] = {"value": "5", "units": "ft", "override": True}, one_creature()
    b["damage"]["onSave"] = "none"
    apply(b, fx(br, "disrupt", "Neural disruption", rounds=10,
                changes=[("flags.midi-qol.OverTime", 0,
                          'turn=end, saveAbility=con, saveDC=JJKORIGINDC, saveCount=1-, label="Neural disruption"')],
                desc="For 1 minute: each time it uses an innate technique it makes a CON save or the CE is wasted. "
                     "Repeats the save at the end of its turns."))
    mark(br)


def centipede_shroud(S):
    ft = lambda n: {"value": str(n), "units": "ft", "override": True}
    c = S.get("Cursed Centipede")
    shroud = fx(c, "shroud", "Centipede Shroud", rounds=0,
                changes=[("system.bonuses.mwak.damage", 2, "+ 1d10"), ("system.attributes.ac.bonus", 2, "+@prof")],
                desc="The centipede floats around you: +1d10 on melee hits, +proficiency to AC, an extra melee attack "
                     "as a bonus action, and you can redirect damage between you and it. Delete when dismissed. With "
                     "two centipedes (11th): AC +3 + proficiency and two bonus-action attacks (GM).")
    for e in c["effects"]:
        if e["_id"] == shroud: e["duration"] = {}
    for aid in ("SbWpjaFLpf5qQ5YQ", "KE4lL8uxh0YyqQcB"):
        a = c["system"]["activities"][aid]
        a["range"], a["target"] = RANGE_SELF, SELF
        apply(a, shroud)
    mark(c)

    e = S.get("Earthquake")
    q = e["system"]["activities"]["7pKnjFDhrMXc50tL"]
    q["range"], q["target"] = RANGE_SELF, sphere(30)
    q["damage"]["onSave"] = "half"
    scale(e, q, [[1, "6d6"], [11, "10d6"], [18, "14d6"]])
    qb = act(e, "bonus", "save", "Bonus Action with centipede summoned (3 CE)", "bonus", range=RANGE_SELF, target=sphere(30),
             save={"ability": ["str"], "dc": {"calculation": "spellcasting", "formula": ""}},
             damage={"onSave": "half", "parts": [dice(6, 6, ["bludgeoning"])]})
    apply(qb, "Ee9gfV18JnUyHIlt")
    cost(e, qb, 3)
    scale(e, qb, [[1, "6d6"], [11, "10d6"], [18, "14d6"]])
    note(e, "Only creatures on the ground. Centipede stat points: edit your centipede actor.")
    mark(e)

    h = S.get("Hundred Leg Catastrophe")
    a = h["system"]["activities"]["Xxh4SKTAnNz37Osw"]
    sv = act(h, "push", "save", "Pushed or pulled 30 ft and prone", "special", range=ft(120), target=one_creature(),
             save={"ability": ["str"], "dc": {"calculation": "spellcasting", "formula": ""}}, damage={"onSave": "none", "parts": []})
    apply(sv, "e5sccugYjQz2rIrq")
    free(h, sv)
    a["type"] = "attack"
    a["attack"] = {"ability": "", "bonus": "", "critical": {"threshold": None}, "flat": False,
                   "type": {"value": "ranged", "classification": "spell"}}
    a.pop("save", None)
    a["effects"] = []
    a["damage"] = {"includeBase": False, "parts": [dice(8, 10, ["necrotic"])]}
    a["range"] = ft(120)
    a["target"] = {"affects": {"type": "creature", "count": "3", "choice": True}, "override": True}
    trigger(a, sv, "hitTargets")
    mark(h)

    d = S.get("Domain Expansion: Oomukade Banzai")
    da = d["system"]["activities"]["CElllpRCkEQhgmv7"]
    da["name"] = "Initiative 20: centipedes restrain everyone"
    da["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    for x in d["effects"]:
        if x["_id"] == "GlGyR2r3uyAPzhDG":
            x["changes"] = [{"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                             "value": 'turn=start, saveAbility=str, saveDC=JJKORIGINDC, saveCount=1-, label="Oomukade Banzai (Athletics)"'}]
            x["duration"] = {"rounds": 10}
            x["description"] = ("<p>Restrained by centipedes: escape with Strength (Athletics) at the start of its turns. "
                                "Attacks against it deal +2d10 (GM adds).</p>")
    mark(d)

    m = S.get("Millipede Spear")
    act(m, "A8pAG8r49o9qWNyO", "utility", "Summon millipede — Bonus Action (6 CE)", "bonus", range=RANGE_SELF, target=SELF)
    ma = m["system"]["activities"]["A8pAG8r49o9qWNyO"]
    mil = fx(m, "mill", "Millipede Shroud", rounds=0,
             changes=[("system.bonuses.mwak.damage", 2, "+ 2d10"), ("system.bonuses.rwak.damage", 2, "+ 2d10"),
                      ("system.attributes.ac.bonus", 2, "-@prof")],
             desc="+2d10 on melee and ranged hits, AC −proficiency, damage can be redirected; once per turn replace "
                  "an attack with two millipede attacks (+2d10 piercing). Delete when dismissed.")
    for x in m["effects"]:
        if x["_id"] == mil: x["duration"] = {}
    apply(ma, mil)
    cost(m, ma, 6)
    mark(m)


def clone(S):
    for n in ("One Man Army", "Twice the Fun"):
        x = S.get(n)
        note(x, "Clone tokens are created on the scene by the module (HP 1/4, 1/2 at 6th, full at 11th; 8 hours).")
        mark(x)
    f = S.get("Four is a Party")
    a = f["system"]["activities"]["RXgYAERWoLMPOHZ8"]
    a["name"] = "Swap bodies with a clone (1 CE)"
    a["range"], a["target"] = {"units": "spec", "override": True}, one_creature()
    note(f, "Swap your token position and current HP with the chosen clone; on dropping to 0 HP you can move into a "
            "clone instead (GM).")
    mark(f)
    d = S.get("Domain Expansion: Divide and Conquer")
    b = d["system"]["activities"]["haVK6Y2XrWnA1sBw"]
    b["name"] = "Free clone (bonus action, once per turn)"
    b["range"], b["target"] = RANGE_SELF, SELF
    free(d, b)
    i20 = act(d, "init20", "utility", "Initiative 20: extra clone", "special", range=RANGE_SELF, target=SELF)
    free(d, i20)
    d["flags"]["jjk5e"]["cloneSpawn"] = {b["_id"]: True, i20["_id"]: True}
    note(d, "Unlimited clones inside the domain; clone attacks get the domain sure-hit. Delete domain clones when it ends.")
    mark(d)
    o = S.get("Object Cloning")
    for key, label, c_ in [("XwmFtNdk688spebl", "Clone object or structure (4 CE, +2 per size above Medium)", 4),
                           ("hEZ2JmK5WSwaD0cX", "Clone common magic item / semi-grade tool (6 CE)", 6),
                           ("uncommon", "Clone uncommon item / grade 3 tool (8 CE)", 8),
                           ("rare", "Clone rare item / grade 2 tool (10 CE)", 10)]:
        a = act(o, key, "utility", label, "action", range={"units": "spec", "override": True},
                target={"affects": {"type": "object", "count": "1"}, "override": True})
        cost(o, a, c_, 2 if c_ == 4 else 0, "8" if c_ == 4 else "")
    mark(o)


def comedian(S):
    ft = lambda n: {"value": str(n), "units": "ft", "override": True}
    conc = {"value": "1", "units": "minute", "concentration": True, "override": True}
    c = S.get("Comedy")
    c["effects"] = [e for e in c.get("effects", []) if e["_id"] != "KkglstNCV3h664dH"]
    on = c["system"]["activities"]["QoOS1sIRL8Cqt5zX"]
    on["range"], on["target"], on["duration"] = RANGE_SELF, SELF, conc
    apply(on, fx(c, "on", "Comedy (active)", rounds=10,
                 changes=[("system.skills.prf.value", 4, "1")],
                 desc="Reality bends to your comedy for 1 minute (concentration). Performance proficiency "
                      "(expertise at 11th: set by hand)."))
    gag = act(c, "gag", "utility", "Gag dodge — Reaction (1 CE)", "reaction", range=RANGE_SELF, target=SELF)
    gag["activation"]["condition"] = "When you take damage while Comedy is active"
    gag["useConditionText"] = 'reaction === "isDamaged"'
    apply(gag, fx(c, "gag", "Gag dodge", rounds=1, special=["isDamaged"],
                  changes=[("system.traits.di.all", 5, "true")],
                  desc="You take no damage from the triggering hit (a slapstick escape)."))
    cost(c, gag, 1)
    rg = c["system"]["activities"]["Ofx2k99ZDib0k6fO"]
    rg["name"] = "Regain control (end of turn, DC 15 WIS)"
    rg["save"] = {"ability": ["wis"], "dc": {"calculation": "", "formula": "15"}}
    rg["activation"]["type"] = "special"
    rg["range"], rg["target"] = RANGE_SELF, SELF
    mark(c)

    b = S.get("Commit to the Bit")
    bo = b["system"]["activities"]["WSkfhE5kG2RIjgJf"]
    bo["name"] = "Blasting Off — on a melee hit (1 CE)"
    bo["activation"] = {"type": "special", "value": None, "condition": "On a melee hit while Comedy is active", "override": True}
    bo["range"], bo["target"] = ft(5), one_creature()
    pr = b["system"]["activities"]["sqZU5kXKLOuvCqF4"]
    pr["name"] = "Props — Bonus Action (2 CE)"
    pr["range"], pr["target"] = RANGE_SELF, SELF
    pu = b["system"]["activities"]["uenzuFk571nNCSdD"]
    pu["name"] = "Powerful Punchline (3 CE)"
    pu["save"] = {"ability": ["str", "dex", "con"], "dc": {"calculation": "spellcasting", "formula": ""}}
    pu["damage"] = {"onSave": "none", "parts": [{"number": None, "denomination": None, "bonus": "",
                    "types": ["bludgeoning", "piercing", "slashing", "psychic"],
                    "custom": {"enabled": True, "formula": f"(@prof + {CE})d8"}, "scaling": {}}]}
    pu["range"] = ft(80)
    pu["target"] = sphere(15)
    note(b, "Punchline area: 30-ft sphere within 80 ft, 60×5-ft line or 30-ft cone; pick the save and damage type "
            "that fit the joke, extra effect by the GM. Blasting Off distance: 60/90/120/200 ft by level.")
    mark(b)

    pk = S.get("Maximum: Peak Comedy")
    a = pk["system"]["activities"]["n7uJBt6ZtFcH011J"]
    a["range"], a["target"] = RANGE_SELF, SELF
    a["duration"] = {"value": "1", "units": "minute", "override": True}
    apply(a, fx(pk, "peak", "Peak Comedy", rounds=10,
                desc="One free gag per turn; free gag dodges equal to your CE modifier each round; props ×2 (×3 at "
                     "18th); Punchline range and area doubled."))
    ex = pk["system"]["activities"]["DA02NMtOwowPF6JD"]
    act(pk, "DA02NMtOwowPF6JD", "damage", "Punchline: extra dice (2 CE)", "special",
        damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["bludgeoning", "piercing", "slashing", "psychic"],
                           "custom": {"enabled": True, "formula": "(@prof)d8"}, "scaling": {}}]},
        target={"affects": {"type": "creature", "choice": True}, "override": True})
    cut = pk["system"]["activities"]["25SomdojAg6Z124L"]
    cut["name"] = "Cutaway (Action)"
    cut["range"], cut["target"] = RANGE_SELF, sphere(100)
    cut["damage"] = {"onSave": "none", "parts": []}
    apply(cut, fx(pk, "cut", "Cutaway", rounds=10,
                  desc="Cannot attack unless the attack fits the cutaway gag."))
    mark(pk)

    d = S.get("Domain Expansion: Stand Up Comedy")
    boo = d["system"]["activities"]["9WjeHauKpt0kOIgs"]
    boo["name"] = "Booed (once per round)"
    boo["activation"]["type"] = "special"
    boo["target"] = {"affects": {"type": "creature", "choice": True}, "override": True}
    free(d, boo)
    i20 = act(d, "init20", "utility", "Initiative 20: cutaway", "special",
              target={"affects": {"type": "enemy", "choice": True}, "override": True})
    apply(i20, fx(d, "cut", "Cutaway (Stand Up Comedy)", rounds=10,
                  desc="Cannot attack you unless it fits the gag; acting against the joke means 8d8 psychic (Booed)."))
    free(d, i20)
    joke = act(d, "joke", "utility", "Tell a joke (full turn): Persuasion vs Insight", "special",
               range=RANGE_SELF, target=SELF, roll={"formula": "1d20 + @skills.per.total", "name": "Joke (Persuasion)",
                                                    "prompt": False, "visible": True})
    free(d, joke)
    note(d, "Creatures that roll lower on Insight (or do not roll) take 'Booed'.")
    mark(d)

    st = S.get("Straight Man")
    a = st["system"]["activities"]["C5z0pFYun9FQgV6E"]
    a["range"], a["target"], a["duration"] = RANGE_SELF, sphere(20), conc
    a["target"]["affects"].update({"type": "ally", "choice": True})
    apply(a, fx(st, "real", "Straight Man", rounds=10,
                changes=[("system.traits.ci.value", 2, "frightened"), ("system.traits.ci.value", 2, "charmed")],
                desc="Immune to frightened and charmed while the reversal lasts (you + up to CE modifier creatures)."))
    mark(st)

    dp = S.get("Deadpan")
    act(dp, "Y4YJ3hjkkDPDMKRq", "save", "Deadpan — Reaction (5 CE)", "reaction", range=ft(60), target=one_creature(),
        save={"ability": ["wis", "cha"], "dc": {"calculation": "spellcasting", "formula": ""}},
        damage={"onSave": "none", "parts": [dice(2, 8, ["psychic"])]})
    dp["system"]["activities"]["Y4YJ3hjkkDPDMKRq"]["activation"]["condition"] = \
        "A creature tries to teleport, avoid damage or do something impossible (it fails on a failed save)"
    dp["system"]["activities"]["Y4YJ3hjkkDPDMKRq"]["useConditionText"] = "false"
    mark(dp)


def construction(S):
    c = S.get("Construct")
    a = c["system"]["activities"]["BYmBLfm5BYDJi6wX"]
    a["name"] = "Construct — Bonus Action (3+ CE)"
    a["range"], a["target"] = {"value": "5", "units": "ft", "override": True}, SELF
    cost(c, a, 3, 1, "20")
    note(c, "Each extra CE: one more object's properties or +1 ft cube. Add the created weapon to your inventory.")
    mark(c)
    cc = S.get("Cursed Creation")
    a = cc["system"]["activities"]["QcgNIk4rbHwUWGOy"]
    a["name"] = "Create a cursed tool (3 CE, +2 per grade above 4)"
    a["range"], a["target"] = RANGE_SELF, SELF
    cost(cc, a, 3, 2, "6")
    note(cc, "Lasts CE-modifier hours. A Special Grade tool kills you afterwards (no revival).")
    mark(cc)
    lm = S.get("Liquid Metal")
    a = lm["system"]["activities"]["QAL2FXDt3LBc2P1d"]
    a["name"] = "Liquid Metal (1–4 CE extra)"
    a["range"], a["target"] = RANGE_SELF, SELF
    a["duration"] = {"value": "1", "units": "minute", "override": True}
    cost(lm, a, 1, 1, "3")
    apply(a, fx(lm, "liquid", "Liquid Metal", rounds=10,
                desc="For 1 minute the constructed melee weapon reaches +10 ft per CE spent; at extended reach its "
                     "damage die grows one tier per CE (d8 → d10 → d12 → 2d6 → 2d8)."))
    mark(lm)
    ia = S.get("Insectoid Armor")
    a = ia["system"]["activities"]["zDVP8kBDUxuwVc4I"]
    a["range"], a["target"] = RANGE_SELF, SELF
    a["duration"] = {"value": "1", "units": "hour", "override": True}
    apply(a, fx(ia, "armor", "Insectoid Armor", rounds=600,
                changes=[("system.abilities.str.value", 2, "4"), ("system.abilities.dex.value", 2, "4"),
                         ("system.attributes.ac.bonus", 2, "+4"),
                         ("system.traits.dr.value", 2, "bludgeoning"), ("system.traits.dr.value", 2, "piercing"),
                         ("system.traits.dr.value", 2, "slashing"),
                         ("system.traits.dr.bypasses", 2, "mgc"),
                         ("system.attributes.movement.fly", 4, "@attributes.movement.walk")],
                desc="1 hour: +4 STR, DEX and AC; resistance to non-magical bludgeoning, piercing and slashing "
                     "(immunity at 18th, GM); fly speed = walking speed; free-action Dash; unarmed strikes +2 damage "
                     "dice (+1 on a critical)."))
    mark(ia)
    d = S.get("Domain Expansion: Threefold Affliction")
    f = act(d, "free", "utility", "Create an item (free in the domain)", "bonus", range=RANGE_SELF, target=SELF)
    apply(f, fx(d, "items", "Threefold Affliction weapons", rounds=10,
                desc="Created items deal two extra damage dice and their attacks cannot miss (domain sure-hit); they "
                     "vanish when the domain ends."))
    free(d, f)
    mark(d)
    dc = S.get("Deconstruction")
    dc["system"]["activities"] = {k: v for k, v in dc["system"]["activities"].items() if k == "VJVQ8pefr46RHrBe"}
    dc["flags"]["jjk5e"]["ceCosts"] = {"VJVQ8pefr46RHrBe": 10}
    m = dc["system"]["activities"]["VJVQ8pefr46RHrBe"]
    m["name"] = "Deconstruct magical / cursed object (10 CE, CE check)"
    m["roll"] = {"formula": f"1d20 + {CE}", "name": "CE check (DC 5/10/15/20/25 by rarity)", "prompt": False, "visible": True}
    m["range"] = {"value": "5", "units": "ft", "override": True}
    for size, c_ in (("Tiny", 1), ("Small", 2), ("Medium", 4), ("Large", 8)):
        a = act(dc, f"size{c_}", "utility", f"Vaporize a {size} object ({c_} CE)", "action",
                range={"value": "5", "units": "ft", "override": True},
                target={"affects": {"type": "object", "count": "1"}, "override": True})
        cost(dc, a, c_)
    note(dc, "Also usable as a bonus action or reaction. Destroying your own Construction tool refunds half its CE; "
             "a 4th-grade tool gives 5 CE (+5 per grade above).")
    mark(dc)


SIZES = [("Tiny", 2), ("Small", 4), ("Medium", 6), ("Large", 8), ("Huge", 10), ("Gargantuan", 20)]


def contractual_recreation(S):
    ft = lambda n: {"value": str(n), "units": "ft", "override": True}
    r = S.get("Recreation")
    keep = r["system"]["activities"]
    res = keep["vzVK16H72nDncqyb"]
    res["name"] = "Reservation receipt (4 CE)"
    res["range"], res["target"] = RANGE_SELF, SELF
    st = keep["UvaaphKlwkGp9O6f"]
    st["name"] = "Structure receipt (20 CE)"
    st["range"], st["target"] = ft(100), sphere(20)
    st["damage"] = {"onSave": "half", "parts": [dice(10, 6, ["bludgeoning"])]}
    pinned = fx(r, "pinned", "Pinned under a materialization", statuses=["prone", "restrained"], rounds=0,
                desc="Prone and restrained under a Huge or larger materialization until freed (GM).")
    for e in r["effects"]:
        if e["_id"] == pinned: e["duration"] = {}
    r["effects"] = [e for e in r["effects"] if e["_id"] != "HsPEvpT91A1Dt4Gk"]
    apply(st, pinned)
    for i, (size, c_) in enumerate(SIZES):
        dmg = [dice(2 * i, 6, ["bludgeoning"])] if i else []
        a = act(r, f"obj{size}", "save" if i else "utility", f"Object / vehicle receipt — {size} ({c_} CE)", "action",
                range=ft(100), target=one_creature())
        if i:
            a["save"] = {"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}}
            a["damage"] = {"onSave": "half" if i >= 4 else "none", "parts": dmg}
            if i >= 4: apply(a, pinned)
        cost(r, a, c_)
    note(r, "Damage applies only if you drop the materialization on a creature (2d6 per size above Tiny). "
            "Receipts are inventory items; wet receipts cannot be used.")
    mark(r)

    q = S.get("Quick Spender")
    note(q, "Use any Recreation activity as a bonus action (free action at 18th).")
    mark(q)

    cc = S.get("Contractual Control")
    v = cc["system"]["activities"]["9N70spOoRTEVVi7O"]
    v["name"] = "Vehicle charge 60 ft (3 CE)"
    v["target"] = {"template": {"type": "line", "size": "60", "width": "10", "units": "ft", "count": "1", "contiguous": False},
                   "affects": {"type": "creature"}, "override": True}
    v["damage"] = {"onSave": "none", "parts": [dice(4, 6, ["bludgeoning"])]}
    w = act(cc, "weapon", "attack", "Telekinetic weapon (3 CE)", "special",
            attack={"ability": "", "bonus": "", "critical": {"threshold": None}, "flat": False,
                    "type": {"value": "melee", "classification": "spell"}},
            damage={"includeBase": False, "parts": [dice(5, 8, ["slashing", "piercing", "bludgeoning"])]},
            range=ft(60), target=one_creature())
    w["activation"]["condition"] = "Replaces one attack (once per turn); use the weapon's die"
    cost(cc, w, 3)
    scale(cc, w, [[11, "5d8"], [15, "7d8"], [18, "10d8"]])
    obj = act(cc, "objects", "utility", "Move summoned objects 60 ft (3 CE each)", "bonus", range=ft(60),
              target={"affects": {"type": "object"}, "override": True})
    cost(cc, obj, 3, 3, "60")
    note(cc, "Vehicle damage uses the size dice of Recreation (adjust the dice). Everything used disappears afterwards.")
    mark(cc)

    d = S.get("Domain Expansion: Black Friday")
    i20 = act(d, "init20", "utility", "Initiative 20: random receipt (d4)", "special", range=RANGE_SELF, target=SELF,
              roll={"formula": "1d4", "name": "Receipt: 1 Object, 2 Vehicle, 3 Reservation, 4 Structure",
                    "prompt": False, "visible": True})
    free(d, i20)
    note(d, "Recreation and Contractual Control cost no CE inside the domain (skip the CE in the usage dialog).")
    mark(d)

    t = S.get("Contractual Transformation")
    t["system"]["activities"] = {}
    t["flags"]["jjk5e"]["ceCosts"] = {}
    for size, c_ in SIZES:
        a = act(t, f"t{size}", "utility", f"Turn a {size} object into a receipt ({c_} CE)", "bonus",
                range={"value": "5", "units": "ft", "override": True},
                target={"affects": {"type": "object", "count": "1"}, "override": True})
        cost(t, a, c_)
    mark(t)


GRANITE = [[1, "2d6"], [3, "3d6"], [6, "4d8"], [11, "5d10"], [18, "6d12"]]


def cursed_cannon(S):
    g = S.get("Granite Blast")
    a = g["system"]["activities"]["GRtFwNVKyLM2wqbq"]
    a["consumption"]["scaling"]["max"] = CE
    split = act(g, "split", "attack", "Grape Choux: split blast (+1 CE)", "action",
                attack={"ability": "", "bonus": "", "critical": {"threshold": None}, "flat": False,
                        "type": {"value": "ranged", "classification": "spell"}},
                damage={"includeBase": False, "parts": [dice(1, 6, ["necrotic"], "@mod", 1)]},
                range={"value": "150", "units": "ft", "override": True},
                target={"affects": {"type": "creature", "count": "1"}, "override": True})
    split["activation"]["condition"] = "Grape Choux (3rd): roll once per target, dividing the dice; only two add the modifier"
    cost(g, split, 2, 1, CE)
    mark(g)

    dd = S.get("Dessert Deluge")
    dd.setdefault("effects", [])
    for n in range(1, 6):
        bo = act(dd, f"boost{n}", "utility", f"Boost next attack roll +{n} ({n} CE)", "special", range=RANGE_SELF, target=SELF)
        apply(bo, fx(dd, f"boost{n}", f"Dessert Deluge +{n}", rounds=1, special=["1Attack"],
                     changes=[("system.bonuses.rsak.attack", 2, f"+ {n}"), ("system.bonuses.msak.attack", 2, f"+ {n}")],
                     desc=f"+{n} to your next cursed energy attack roll."))
        cost(dd, bo, n)
    mark(dd)

    l = S.get("Maximum: Granita Lusso")
    a = l["system"]["activities"]["K5tMSDrkCbisKcMD"]
    a["target"] = {"template": {"type": "line", "size": "60", "width": "10", "units": "ft", "count": "1", "contiguous": False},
                   "affects": {"type": "creature"}, "override": True}
    a["range"] = RANGE_SELF
    a["damage"] = {"onSave": "half", "parts": [dice(4, 6, ["necrotic"], "2 * @mod", 1)]}
    a["consumption"]["scaling"]["max"] = CE
    scale(l, a, [[11, "10d10"], [18, "12d12"]])
    burn = act(l, "burnout", "utility", "Technique Burnout (until end of next turn)", "special", range=RANGE_SELF, target=SELF)
    apply(burn, fx(l, "burnout", "Technique Burnout (Granita Lusso)", rounds=1, special=["turnEndSource"],
                   desc="Technique Burnout until the end of your next turn."))
    free(l, burn)
    trigger(a, burn, "self")
    mark(l)

    d = S.get("Domain Expansion: Il Gran Dolce")
    i20 = act(d, "init20", "attack", "Initiative 20: Granite Blast ×3", "special",
              attack={"ability": "", "bonus": "", "critical": {"threshold": None}, "flat": False,
                      "type": {"value": "ranged", "classification": "spell"}},
              damage={"includeBase": False, "parts": [dice(6, 12, ["necrotic"], "@mod")]},
              range={"units": "spec", "override": True},
              target={"affects": {"type": "creature", "count": "3", "choice": True}, "override": True})
    free(d, i20)
    mark(d)

    cs = S.get("Cursed Shield")
    a = cs["system"]["activities"]["qWHnHecd13R6ExwJ"]
    a["save"] = {"ability": ["con"], "dc": {"calculation": "", "formula": "10"}}
    a["range"], a["target"] = RANGE_SELF, SELF
    a["useConditionText"] = 'reaction === "isAttacked" || reaction === "isSave"'
    note(cs, "DC = 10 + half the CE spent on the incoming effect (the activity uses 10: add the rest when rolling). Success: gain that CE and "
             "negate it; failure: it hits / you fail the save. Not against Maximums, barriers or domains.")
    mark(cs)


def set_flag(item, eid, **kv):
    for e in item["effects"]:
        if e["_id"] == eid: e["flags"].setdefault("jjk5e", {}).update(kv)


def cursed_circuitry(S):
    touch = {"value": "5", "units": "ft", "override": True}
    c = S.get("Circuit")
    me = fx(c, "self", "Circuit", rounds=10,
            desc="Efficiency: other features cost 1 CE less (min 1, applied by the module); CE that scales counts "
                 "double; you may spend extra CE up to half your proficiency bonus.")
    set_flag(c, me, circuit=1)
    other = fx(c, "other", "Circuit (other creature)", rounds=5, desc="Same Circuit on a willing creature for 30 seconds.")
    set_flag(c, other, circuit=1)
    a = c["system"]["activities"]
    a["ujsQ0PvPcpojMKjh"]["name"] = "Circuit on yourself — Bonus Action (2 CE)"
    a["ujsQ0PvPcpojMKjh"]["range"], a["ujsQ0PvPcpojMKjh"]["target"] = RANGE_SELF, SELF
    apply(a["ujsQ0PvPcpojMKjh"], me)
    a["XKdQmZyISEExLJRY"]["name"] = "Circuit on a willing creature (5 CE)"
    a["XKdQmZyISEExLJRY"]["range"], a["XKdQmZyISEExLJRY"]["target"] = touch, one_creature()
    apply(a["XKdQmZyISEExLJRY"], other)
    act(c, "DlaqK6vPGGgwBpGh", "utility", "Circuit on an item (2 CE)", "bonus", range=touch, target=SELF)
    it = c["system"]["activities"]["DlaqK6vPGGgwBpGh"]
    apply(it, fx(c, "item", "Circuit: enhanced item", rounds=10,
                 changes=[("system.bonuses.mwak.damage", 2, "+ 2d4[necrotic]"), ("system.bonuses.rwak.damage", 2, "+ 2d4[necrotic]")],
                 desc="Enhancement chosen: +2d4 necrotic on hits with the item (alternatives: +2 AC, or the tool costs "
                      "1 CE less — swap the change if you pick those)."))
    mark(c)

    p = S.get("Pure Energy Efficiency")
    p["system"]["activities"] = {}
    p["flags"]["jjk5e"]["ceCosts"] = {}
    note(p, "Passive: while a Circuit is active, the module charges 1 CE less per 5 CE of a cost.")
    mark(p)

    h = S.get("High Performance Circuit")
    h["effects"] = [e for e in h.get("effects", []) if e["_id"] != "wftLXfHdXPvGV4EQ"]
    hp_ = fx(h, "self", "High Performance Circuit", rounds=600,
             desc="Improved Efficiency: other features cost 3 CE less (min 1, applied by the module); scaling CE "
                  "counts triple; extra CE up to your proficiency bonus. 1 hour (8 hours at 11th).")
    set_flag(h, hp_, circuit=3)
    a = h["system"]["activities"]
    a["2NVKEHapFnbt8le4"]["name"] = "High Performance Circuit — Bonus Action (2 CE)"
    a["2NVKEHapFnbt8le4"]["range"], a["2NVKEHapFnbt8le4"]["target"] = RANGE_SELF, SELF
    a["2NVKEHapFnbt8le4"]["duration"] = {"value": "1", "units": "hour", "override": True}
    apply(a["2NVKEHapFnbt8le4"], hp_)
    act(h, "35NYwF70yqZU3pJU", "utility", "High Performance item (2 CE)", "bonus", range=touch, target=SELF)
    apply(h["system"]["activities"]["35NYwF70yqZU3pJU"],
          fx(h, "item", "High Performance item", rounds=600,
             changes=[("system.bonuses.mwak.damage", 2, "+ 2d(6 + 4 * floor(min(@details.level, 11) / 11))[necrotic]"),
                      ("system.attributes.ac.bonus", 2, "+ (3 + 2 * floor(min(@details.level, 11) / 11))")],
             desc="Two enhancements: +2d6 necrotic on hits (2d10 at 11th) and +3 AC (+5 at 11th)."))
    o = act(h, "other", "utility", "High Performance on a willing creature (5 CE)", "action", range=touch, target=one_creature())
    o_fx = fx(h, "other", "High Performance Circuit (other)", rounds=100, desc="Lasts 10 minutes on another creature.")
    set_flag(h, o_fx, circuit=3)
    apply(o, o_fx)
    cost(h, o, 5)
    mark(h)

    b = S.get("Circuit Breaker")
    act(b, "iRqx406U0RSXjtZb", "utility", "Release a circuit (bonus action)", "bonus", range=RANGE_SELF, target=SELF)
    apply(b["system"]["activities"]["iRqx406U0RSXjtZb"],
          fx(b, "charge", "Circuit Breaker", rounds=1, special=["1Hit"],
             changes=[("system.bonuses.mwak.damage", 2, "+ 5d10[necrotic]")],
             desc="Your next unarmed strike or attack with that item deals +5d10 necrotic on a hit."))
    note(b, "Circuits now last 8 hours (adjust the effect duration).")
    mark(b)

    d = S.get("Domain Expansion: Deus ex Machina")
    alw = act(d, "always", "utility", "Domain: permanent Circuit", "special", range=RANGE_SELF, target=SELF)
    on = fx(d, "circuit", "Deus ex Machina: Circuit", rounds=10, desc="You are always under your Circuit in the domain.")
    set_flag(d, on, circuit=3)
    apply(alw, on)
    free(d, alw)
    sap = act(d, "init20", "damage", "Initiative 20: sap cursed energy", "special",
              damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["necrotic"],
                                 "custom": {"enabled": True, "formula": "0"}, "scaling": {}}]},
              target={"affects": {"type": "enemy", "choice": True}, "override": True})
    sap["activation"]["condition"] = "Damage = each target's current CE (enter it per target)"
    free(d, sap)
    mark(d)

    oc = S.get("Open Circuit")
    a = oc["system"]["activities"]["E46etEU7UM9lLuNR"]
    act(oc, "E46etEU7UM9lLuNR", "save", "Open Circuit — Action (10 CE)", "action", range=touch, target=one_creature(),
        save={"ability": ["wis", "cha"], "dc": {"calculation": "spellcasting", "formula": ""}},
        damage={"onSave": "none", "parts": []})
    oc["flags"]["jjk5e"].get("ceSteps", {}).pop("E46etEU7UM9lLuNR", None)
    apply(oc["system"]["activities"]["E46etEU7UM9lLuNR"],
          fx(oc, "open", "Open Circuit", rounds=600,
             desc="For 1 hour it takes the caster's CE modifier in necrotic damage for every CE it spends (GM applies)."))
    mark(oc)


def cursed_corpse_creation(S):
    c = S.get("Cursed Corpse Creation")
    act(c, "KqygVhuTM4tZcTPS", "utility", "Imbue a core (action)", "action",
        range={"value": "5", "units": "ft", "override": True}, target=one_creature())
    note(c, "Imbue: transfer any CE to the core (deduct it manually; core max by size table).")
    mark(c)

    t = S.get("Corpse Tactics")
    t["system"]["activities"] = {}
    tgt = one_creature()
    for key, name, ch in [
        ("coop", "Cooperative Tactics", [("flags.midi-qol.advantage.attack.all", 0, "1"), ("flags.midi-qol.advantage.ability.save.all", 0, "1")]),
        ("off", "Offensive Tactics", [("system.bonuses.mwak.damage", 2, "+ 1d8")]),
        ("def", "Defensive Tactics", [("flags.midi-qol.grants.disadvantage.attack.all", 0, "1")]),
    ]:
        a = act(t, key, "utility", f"{name} (part of command)", "bonus", range={"value": "60", "units": "ft", "override": True}, target=tgt)
        apply(a, fx(t, key, name, changes=ch, special=["turnStartSource"], desc=f"{name} until the start of your next turn."))
        free(t, a)
    for key, name in [("gue", "Guerilla Tactics (Disengage)"), ("mob", "Mobility Tactics (Dash)")]:
        a = act(t, key, "utility", name, "bonus", range={"value": "60", "units": "ft", "override": True}, target=tgt)
        apply(a, fx(t, key, name, special=["turnStartSource"], desc=name + " granted to one corpse."))
        free(t, a)
    mark(t)

    m = S.get("Cursed Corpse Mutation")
    m["effects"] = [e for e in m.get("effects", []) if e["_id"] != "xWGgnGFOkKKmqVZl"]
    r = act(m, "roll", "utility", "Roll mutation (d20 then d12)", "special", range=RANGE_SELF, target=SELF,
            roll={"formula": "1d20", "name": "Mutation check (20 = mutate)", "prompt": False, "visible": True})
    free(m, r)
    r2 = act(m, "table", "utility", "Mutation table (d12)", "special", range=RANGE_SELF, target=SELF,
             roll={"formula": "1d12", "name": "Mutation", "prompt": False, "visible": True})
    free(m, r2)
    mark(m)

    pc = S.get("Perfect Creations")
    act(pc, "fgf4JxUYNhnq7aBE", "utility", "Command all corpses (bonus action)", "bonus", range=RANGE_SELF, target=SELF)
    mark(pc)
    pz = S.get("Maximum: Prized Creation")
    note(pz, "Apply to the favorite corpse's actor: +4 to two abilities and max, damage die +1 tier, 3 chosen mutations.")
    mark(pz)


def cursed_spirit_manipulation(S):
    r120 = {"value": "120", "units": "ft", "override": True}
    a = S.get("Cursed Spirit Absorption")
    act(a, "5vgr5IVvwIXwGnMd", "utility", "Absorb a cursed spirit (1 CE, action/reaction)", "reaction", range=r120, target=one_creature())
    a["system"]["activities"]["5vgr5IVvwIXwGnMd"]["activation"]["condition"] = "A cursed spirit at 0 HP, or CR below your proficiency bonus"
    note(a, "Summon a stored spirit: action, CE = its CR. The CON save activity is the eating save.")
    mark(a)

    ci = S.get("Curse Infused Spirits")
    sac = act(ci, "aZSGsRETuS1H0fLZ", "heal", "Sacrifice a spirit: reduce damage (X CE)", "reaction", range=RANGE_SELF, target=SELF,
              healing={"number": 1, "denomination": 20, "bonus": "", "types": ["temphp"],
                       "custom": {"enabled": False, "formula": ""}, "scaling": {"mode": "whole", "number": 1}})
    sac["useConditionText"] = 'reaction === "isDamaged"'
    sac["activation"]["condition"] = "X = sacrificed spirit's CR (scale the usage); the d20s soak the incoming damage"
    cost(ci, sac, 1, 1)
    note(ci, "Spirits: +CE mod to STR/DEX/CON, full HP on short rest, immune charmed/frightened (apply on their actors).")
    mark(ci)

    pc = S.get("Perfect Control")
    act(pc, "oBmcLc9J65fFoJg4", "utility", "Summon cursed spirit (bonus action)", "bonus", range={"value": "30", "units": "ft", "override": True}, target=SELF)
    note(pc, "Spirit summon cost is reduced by your CE modifier (min 1); 20 spirits before the WIS save.")
    mark(pc)

    u = S.get("Maximum: Uzumaki")
    ua = u["system"]["activities"]["21BCJjjeljm7BkO9"]
    ua["name"] = "Uzumaki (2+ spirits)"
    ua["target"] = sphere(30, kind="cone")
    ua["damage"] = {"onSave": "half", "parts": [dice(2, 12, ["necrotic"], scale=1)]}
    ua["activation"]["condition"] = "Scale +1 per spirit above 2: +1d12 (add 5 ft to the cone by hand)"
    mark(u)

    d = S.get("Domain Expansion: Womb Profusion")
    ab = d["system"]["activities"]["UvragSJbMzkhBjsI"]
    ab["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    free(d, ab)
    note(d, "Difficult terrain in the domain; your spirits cost no CE; enemy spirits save CHA at turn start or are absorbed.")
    mark(d)

    an = S.get("Cursed Spirit Annihilation")
    aa = an["system"]["activities"]["iDDMRSZhS7reJKiU"]
    aa["range"], aa["target"] = {"value": "60", "units": "ft", "override": True}, one_creature()
    eid = fx(an, "die", "Annihilated", statuses=["dead"], desc="Overloaded with positive energy and destroyed.")
    apply(aa, eid)
    cost(an, aa, 1, 1)
    aa["activation"]["condition"] = "CE = half the spirit's CR (rounded up); only if its HP ≤ 4 × CE mod × prof"
    mark(an)


def cursed_transmutation(S):
    touch = {"value": "5", "units": "ft", "override": True}
    b = S.get("Basic Transmutation")
    bb = b["system"]["activities"]["2q42DDn3IAl5Gug3"]
    bb["range"] = touch
    bb["target"] = {"template": {"type": "cube", "size": "5", "units": "ft", "count": "1", "contiguous": True},
                    "affects": {"type": "", "choice": False}, "override": True}
    cost(b, bb, 1, 1, "max(@abilities.wis.mod, @abilities.cha.mod)")
    note(b, "One 5-ft cube per CE (metal +1 CE per cube); cover, difficult terrain, walls, platforms.")
    mark(b)

    c = S.get("Chemical Formulae")
    c["effects"] = [e for e in c.get("effects", []) if e["_id"] != "o5FRr5zmHXVSM4Ng"]
    ex = c["system"]["activities"]["71OpcvHoIIoXxl4s"]
    ex["name"] = "Transmute Explosion (on hit, 2 CE)"
    ex["activation"]["type"] = "special"
    ex["useConditionText"] = 'reaction === "isHit"'
    ex["target"] = one_creature()
    ex["damage"] = {"onSave": "half", "parts": [dice(2, 6, ["fire"])]}
    scale(c, ex, [[1, "2d6"], [6, "3d6"], [11, "4d6"], [18, "6d6"]])
    sh = c["system"]["activities"]["vXAXQp4RV4HyCbqB"]
    sh["name"] = "Shell (X CE): 5 temp HP per CE"
    sh["range"], sh["target"] = RANGE_SELF, SELF
    sh["useConditionText"] = 'reaction === "isAttacked"'
    for key, name, n, ch in [
        ("harden", "Harden (2 CE)", "Harden", [("system.attributes.ac.bonus", 2, "+4")]),
        ("slick", "Slick (2 CE)", "Slick", [("system.attributes.movement.walk", 2, "+20")]),
    ]:
        a = act(c, key, "utility", name, "reaction", range=RANGE_SELF, target=SELF)
        if key == "harden": a["useConditionText"] = 'reaction === "isAttacked"'
        apply(a, fx(c, key, n, changes=ch, special=["turnStartSource"],
                    desc=n + (": +4 AC" if key == "harden" else ": +20 ft speed, no opportunity attacks") + " until your turn."))
        cost(c, a, 2)
    mark(c)

    ar = S.get("Areal Transmute")
    sl = ar["system"]["activities"]["2UD59HgF24X60TJX"]
    sl["name"] = "Slippery (6 CE)"
    sl["target"] = sphere(30)
    boom = ar["system"]["activities"]["AtIu9kGGzCe2w3Fr"]
    boom["name"] = "Explosive: detonate (next turn)"
    boom["target"] = sphere(30)
    boom["damage"] = {"onSave": "half", "parts": [dice(4, 6, ["fire"])]}
    scale(ar, boom, [[1, "4d6"], [11, "6d6"], [18, "8d6"]])
    free(ar, boom)
    sp = act(ar, "spikey", "damage", "Spikey: 2d4 per 5 ft walked", "special",
             damage={"parts": [dice(2, 4, ["piercing"])]}, target=one_creature())
    free(ar, sp)
    note(ar, "Pick one: Slippery (DEX or prone), Explosive (set now with the 6 CE, detonate next turn), "
             "Spikey, or Shifting (difficult terrain). The 6 CE is charged on Slippery; use it for the others too.")
    mark(ar)

    rg = S.get("Maximum: Railgun")
    ra = rg["system"]["activities"]["IM9qKBX6wgzaffo1"]
    ra["range"] = {"value": "120", "units": "ft", "override": True}
    ra.setdefault("midiProperties", {})["otherActivityCompatible"] = True
    push = rg["system"]["activities"]["9GVsHWBEldEVcJvW"]
    trigger(ra, push, "hitTargets")
    imp = act(rg, "impact", "damage", "Impact with object: 2d12", "special", damage={"parts": [dice(2, 12, ["bludgeoning"])]}, target=one_creature())
    free(rg, imp)
    path = act(rg, "path", "save", "Creatures in the path (DEX)", "special",
               save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
               damage={"onSave": "half", "parts": [dice(4, 12, ["thunder"])]},
               target={"template": {"type": "line", "size": "120", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                       "affects": {"type": "creature", "choice": True}, "override": True})
    free(rg, path)
    note(rg, "Half damage on a miss (roll damage anyway). Hit triggers the STR save: push 30 ft and prone.")
    mark(rg)

    dm = S.get("Domain Expansion: Mandala of Dependant Origination")
    i20 = act(dm, "init20", "save", "Initiative 20: domain-wide Slippery", "special",
              save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
              damage={"onSave": "none", "parts": []}, target={"affects": {"type": "enemy", "choice": True}, "override": True})
    apply(i20, fx(dm, "prone", "Prone (Mandala)", statuses=["prone"]))
    free(dm, i20)
    note(dm, "Any Areal Transmute may be chosen instead; Transmute Self works on willing creatures in the domain.")
    mark(dm)

    im = S.get("Cursed Immutation")
    ia = act(im, "L3G1u2szCEVZuHDz", "heal", "Cursed Immutation (CE up to 2× mod)", "action", range=touch, target=one_creature(),
             healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                      "custom": {"enabled": True, "formula": "(@scaling)d8 + @abilities.con.mod"}, "scaling": {}})
    cost(im, ia, 1, 1, "2 * max(@abilities.wis.mod, @abilities.cha.mod)")
    apply(ia, fx(im, "imm", "Immutable", rounds=600,
                 changes=[("flags.midi-qol.advantage.ability.save.all", 0, "1")],
                 desc="While the temp HP last: immune to limb damage, advantage on saves against form-altering effects (the module grants all saves; remove when the temp HP are gone)."))
    note(im, "Temp HP formula approximates RCT healing (1d8 per CE + CON); adjust if your RCT table differs.")
    mark(im)


def dark_claw(S):
    melee = {"value": "5", "units": "ft", "override": True}
    c = S.get("Claw")
    form = c["system"]["activities"]["BV6prZgzvg7vJ9kx"]
    act(c, "BV6prZgzvg7vJ9kx", "utility", "Form claw — Bonus Action (1 CE)", "bonus", range=RANGE_SELF, target=SELF)
    apply(c["system"]["activities"]["BV6prZgzvg7vJ9kx"], fx(c, "on", "Dark Claw", rounds=600, desc="Claws formed for 1 hour."))
    atk = act(c, "strike", "attack", "Claw strike", "action", range=melee, target=one_creature(),
              attack={"ability": "", "bonus": "max(@abilities.wis.mod, @abilities.cha.mod) - @abilities.str.mod * 0",
                      "critical": {"threshold": None}, "flat": False, "type": {"value": "melee", "classification": "weapon"}},
              damage={"includeBase": False, "parts": [dice(1, 6, ["slashing"], bonus="max(@abilities.wis.mod, @abilities.cha.mod)")]})
    atk["attack"]["ability"] = "spellcasting"
    atk["attack"]["bonus"] = ""
    scale(c, atk, [[1, "1d6"], [3, "1d8"], [6, "1d10"], [11, "1d12"], [18, "2d8"]])
    free(c, atk)
    mark(c)

    for nm, base, absorb, bleed, absorb_d, bleed_d, tiers in [
        ("Claws Modifications", "MjsiHNzAHZ8qqEhE", "55NndOxWTSkPhqhE", "mPzLOB6LwDMub0oR", 1, 1, None),
        ("Ultimate Claws", "lv4QfOu1qu8xFQ2K", "ESTS1iLHgsGqA5o2", "zWZRzJ7xwCIZO67r", 2, 2, [[1, "2d6"], [11, "3d6"]]),
    ]:
        m = S.get(nm)
        a = m["system"]["activities"]
        ab = a[absorb]
        ab["name"] = f"Absorbing Claws (on hit, 1 CE): +{absorb_d}d6 necrotic, heal that much"
        ab["activation"]["type"] = "special"
        ab["useConditionText"] = 'reaction === "isHit"'
        ab["target"] = one_creature()
        if tiers: scale(m, ab, tiers)
        bl = a[bleed]
        bl["name"] = "Barbed Claws (on hit, 2 CE): CON or bleeding"
        bl["activation"]["type"] = "special"
        bl["useConditionText"] = 'reaction === "isHit"'
        bl["target"] = one_creature()
        bl["damage"] = {"onSave": "none", "parts": []}
        die = f"{bleed_d}d6"
        bid = fx(m, "bleed", "Bleeding (Barbed Claws)", rounds=600, statuses=["bleeding"],
                 changes=[("flags.midi-qol.OverTime", 0, f"turn=start, damageRoll={die}, damageType=slashing, label=Bleeding")],
                 desc=f"{die} slashing at the start of its turn; ends when staunched (action) or healed.")
        apply(bl, bid)
        opt = a[base]
        opt["name"] = "Brutal / Elemental / Pure (passive options)"
        brutal = fx(m, "brutal", "Brutal Claws", rounds=None,
                    changes=[("system.bonuses.mwak.damage", 2, "+ 1d6")] + (
                        [("system.bonuses.mwak.attack", 2, "+ (2 + floor(min(@details.level, 11) / 11))"),
                         ("system.bonuses.mwak.damage", 2, "+ (2 + floor(min(@details.level, 11) / 11))")] if bleed_d == 2 else []),
                    desc="Extra damage die on claw hits (toggle when chosen).")
        for e in m["effects"]:
            if e["_id"] == brutal: e["transfer"], e["disabled"] = True, True; e["duration"] = {}
        note(m, "Brutal is a toggle effect on the item; Elemental/Pure: change the claw damage type or tick 'ignore resistance' "
                "(Midi: DamageReduction bypass) by hand. Healing from Absorbing: enter the necrotic total.")
        mark(m)

    z = S.get("Maximum: Zenith Claw Option")
    zz = act(z, "oDmto0UToZTftTUX", "utility", "Crush a cursed tool (3/4/6/10 CE by grade)", "action", range=RANGE_SELF, target=SELF)
    cost(z, zz, 3, 1, "10")
    mark(z)

    d = S.get("Domain Expansion: Hall of the Five Clawed Dragon")
    st = act(d, "init20", "damage", "Initiative 20: guaranteed critical claw", "special", target=one_creature(),
             damage={"critical": {"allow": True}, "parts": [dice(4, 8, ["slashing"], bonus="max(@abilities.wis.mod, @abilities.cha.mod)")]})
    free(d, st)
    sure = act(d, "sure", "utility", "Domain: claws always hit", "special", range=RANGE_SELF, target=SELF)
    apply(sure, fx(d, "sure", "Five Clawed Dragon", rounds=10, changes=[("flags.midi-qol.max.attack.mwak", 0, "1"),
                                                                   ("flags.midi-qol.advantage.attack.mwak", 0, "1")],
                   desc="Claw attacks auto-hit in the domain (Midi max attack roll as proxy)."))
    free(d, sure)
    note(d, "Initiative-20 strike: doubled claw dice already in the formula (2d8 → 4d8 at 18th) — no Black Flash.")
    mark(d)

    sb = S.get("Soft Beats Hard")
    on = sb["system"]["activities"]["Jwx6Nh8ta3KxG7Bm"]
    on["range"], on["target"] = RANGE_SELF, SELF
    apply(on, fx(sb, "on", "Soft Beats Hard", rounds=1200, desc="2 hours: no claws; special parry reaction."))
    re_ = sb["system"]["activities"]["Tmh3pCHViOtoPrbe"]
    act(sb, "Tmh3pCHViOtoPrbe", "attack", "Soft parry (attack vs. damage roll)", "reaction", range=RANGE_SELF, target=SELF,
        attack={"ability": "", "bonus": "(2 * floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))",
                "critical": {"threshold": None}, "flat": False, "type": {"value": "melee", "classification": "unarmed"}})
    r = sb["system"]["activities"]["Tmh3pCHViOtoPrbe"]
    r["useConditionText"] = 'reaction === "isAttacked"'
    r["activation"]["condition"] = "If your roll beats the damage roll, the damage is nullified. 2 CE: repeat without a reaction."
    sb["flags"]["jjk5e"]["ceCosts"]["Tmh3pCHViOtoPrbe"] = 0
    again = act(sb, "again", "attack", "Soft parry again (2 CE, no reaction)", "special", range=RANGE_SELF, target=SELF,
                attack=dict(r["attack"]))
    cost(sb, again, 2)
    mark(sb)


def deadly_sentencing(S):
    g = S.get("Judge’s Gavel")
    for key, nm, die, rng in [("light", "Light hammer", 4, 5), ("maul", "Maul", 6, 5), ("pole", "Pole hammer (reach)", 10, 10)]:
        a = act(g, key, "attack", f"Gavel: {nm}", "action", range={"value": str(rng), "units": "ft", "override": True},
                target=one_creature(),
                attack={"ability": "str", "bonus": "", "critical": {"threshold": None}, "flat": False,
                        "type": {"value": "melee", "classification": "weapon"}},
                damage={"includeBase": False, "parts": [dice(2 if key == "maul" else 1, die, ["bludgeoning"], bonus="@mod")]})
        free(g, a)
    note(g, "First summon per long rest is free (limited-use activity); later summons cost 1 CE. Gavel Improvements makes it free.")
    mark(g)

    d = S.get("Domain Expansion: Deadly Sentencing")
    ev = act(d, "ntA78JqzibjeNcT8", "utility", "Evidence roll (d20)", "special", range=RANGE_SELF, target=SELF,
             roll={"formula": "1d20", "name": "Evidence", "prompt": False, "visible": True})
    trial = act(d, "trial", "utility", "Trial: contested Persuasion", "special", range=RANGE_SELF, target=SELF,
                roll={"formula": "1d20 + @skills.per.total", "name": "Persuasion (contested)", "prompt": False, "visible": True})
    free(d, trial)
    pen = act(d, "conf", "utility", "Sentence: Confiscation", "special", target=one_creature())
    apply(pen, fx(d, "conf", "Confiscation", rounds=10, desc="Loses its innate technique (or magic items first; else its CE) for 1 minute."))
    free(d, pen)
    dp = act(d, "death", "attack", "Executioner's Sword (kills on hit)", "action", range={"value": "5", "units": "ft", "override": True},
             target=one_creature(), attack={"ability": "str", "bonus": "", "critical": {"threshold": None}, "flat": False,
                                            "type": {"value": "melee", "classification": "weapon"}})
    apply(dp, fx(d, "dead", "Executed", statuses=["dead"]))
    free(d, dp)
    peace = act(d, "peace", "utility", "Domain: no offensive actions", "special",
                target={"affects": {"type": "creature", "choice": False}, "override": True})
    apply(peace, fx(d, "peace", "Courtroom", rounds=10, changes=[("flags.midi-qol.fail.attack.all", 0, "1")],
                    desc="No offensive action can be taken by either party inside the domain."))
    free(d, peace)
    note(d, "Evidence: 1 innocent · 2–9 guilty · 10–15 advantage, Confiscation · 15–19 Death Penalty · 20 instant, both. "
            "Conviction with Confiscation/Death Penalty: no Technique Burnout (remove it by hand).")
    mark(d)

    gi = S.get("Gavel Improvements")
    en = gi["system"]["activities"]["i3XrSuMfGBZEYwb7"]
    en["range"], en["target"] = RANGE_SELF, SELF
    apply(en, fx(gi, "big", "Enlarged Gavel", rounds=10, changes=[("system.bonuses.mwak.damage", 2, "+ 1d2")],
                 desc="Damage die one tier higher for 1 minute (+1d2 approximates the tier step)."))
    sw = gi["system"]["activities"]["YcdY6qSwX3tuOvYg"]
    sw["target"] = {"template": {"type": "cube", "size": "10", "units": "ft", "count": "1", "contiguous": False},
                    "affects": {"type": "creature", "choice": False}, "override": True}
    sw["damage"] = {"onSave": "none", "parts": [dice(4, 8, ["bludgeoning"], bonus="2 * @abilities.str.mod")]}
    sw["activation"]["condition"] = "Only while enlarged. Twice the gavel's damage (4d8 assumes maul tier d8→2d8 doubled)."
    mark(gi)

    be = S.get("Better Evidence")
    r = act(be, "roll", "utility", "Evidence (best of 2, 3 at 18th)", "special", range=RANGE_SELF, target=SELF,
            roll={"formula": "{1d20, 1d20, (floor(min(@details.level, 18) / 18))d20}kh", "name": "Evidence", "prompt": False, "visible": True})
    free(be, r)
    mark(be)

    u = S.get("Unstopping Justice")
    uz = u["system"]["activities"]["zbRdrCYbDoFUEXsi"]
    uz["name"] = "Free Deadly Sentencing (CE mod per long rest)"
    u["system"]["uses"] = {"max": "max(@abilities.wis.mod, @abilities.cha.mod)", "spent": 0,
                           "recovery": [{"period": "lr", "type": "recoverAll"}]}
    uz["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}], "scaling": {"allowed": False}}
    mark(u)

    pi = S.get("Proven Innocence")
    pr = pi["system"]["activities"]["WXaJ2kTOUtBHKcxS"]
    pr["name"] = "Open reversed domain (on witnessing a death)"
    cost(pi, pr, 20)
    note(pi, "Uses the same trial and Evidence rolls as Deadly Sentencing; costs 20 CE without a free use.")
    mark(pi)


CONE_TIERS = [[1, "2d8"], [5, "3d8"], [11, "4d8"], [17, "5d8"]]


def _cone(item, aid, nm, types):
    a = item["system"]["activities"][aid]
    a["name"] = nm
    a["range"], a["target"] = RANGE_SELF, sphere(15, kind="cone")
    a["damage"] = {"onSave": "half", "parts": [dice(2, 8, types)]}
    scale(item, a, CONE_TIERS)
    mark(item)
    return a


def _domain_burst(item, aid, nm):
    a = item["system"]["activities"][aid]
    a["name"] = nm
    a["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    free(item, a)
    mark(item)


def disaster_flames(S):
    f = S.get("Flames of Disaster")
    _cone(f, "tVl7onQZVcwWibt1", "Wave of flames — Bonus Action (1 CE)", ["fire"])

    v = S.get("Erupting Volcanoes")
    mk = v["system"]["activities"]["3Z7NwylVtsjnbOEp"]
    mk["name"] = "Create volcanoes (2 CE each)"
    mk["range"] = {"value": "60", "units": "ft", "override": True}
    mk["target"] = {"template": {"type": "circle", "size": "2.5", "units": "ft", "count": "1", "contiguous": False},
                    "affects": {"type": "", "choice": False}, "override": True}
    cost(v, mk, 2, 2, "2 * max(@abilities.wis.mod, @abilities.cha.mod)")
    er = v["system"]["activities"]["AuEcnTkTPSeA0KJa"]
    er["name"] = "Erupt (bonus action, per volcano)"
    er["target"] = {"template": {"type": "line", "size": "30", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                    "affects": {"type": "creature", "choice": False}, "override": True}
    er["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": 10, "bonus": "", "types": ["fire"],
                                                  "custom": {"enabled": True, "formula": "(@prof)d10"}, "scaling": {}}]}
    free(v, er)
    for e in v["effects"]:
        if e["_id"] == "wPSk250Rrx6Njjxk":
            e["duration"] = {"rounds": 10}
            e["changes"] = [{"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                             "value": "turn=start, saveAbility=str, saveDC=JJKORIGINDC, label=Magma"}]
    mark(v)

    ei = S.get("Ember Insects")
    a = ei["system"]["activities"]["B0ox2OBVuO4ILdAJ"]
    a["range"] = {"value": "5", "units": "ft", "override": True}
    note(ei, "Summons the Ember Insects Swarm (drag its actor from the compendium); it acts right after your turn.")
    mark(ei)

    m = S.get("Maximum: Meteor")
    me = m["system"]["activities"]["455HEYu0KXZmQGyn"]
    me["range"], me["target"] = RANGE_SELF, sphere(120)
    me["target"]["affects"]["type"] = "enemy"
    me["damage"] = {"onSave": "half", "parts": [dice(10, 4, ["bludgeoning"]), dice(10, 6, ["fire"])]}
    fly = act(m, "fly", "utility", "Rise 120 ft (until end of next turn)", "special", range=RANGE_SELF, target=SELF)
    apply(fly, fx(m, "fly", "Meteor ascent", rounds=2, changes=[("system.attributes.movement.fly", 4, "120")],
                  desc="Float 120 ft up, then down harmlessly next turn."))
    free(m, fly)
    mark(m)

    _domain_burst(S.get("Domain Expansion: Coffin of the Iron Mountain"), "t4HtZDdn7lJaJ9i3", "Initiative 20: 10d8 fire to all others")

    h = S.get("Heat Extinguishment")
    ex = h["system"]["activities"]["g24VOuJAXhXeFMkD"]
    ex["name"] = "Extinguish flames / reduce fire 6d8 (2 CE)"
    ex["useConditionText"] = 'reaction === "isAttacked" || reaction === "isSave"'
    ex["range"] = {"value": "30", "units": "ft", "override": True}
    red = act(h, "reduce", "heal", "Reduce incoming fire damage (6d8)", "special", range=RANGE_SELF, target=SELF,
              healing={"number": 6, "denomination": 8, "bonus": "", "types": ["temphp"],
                       "custom": {"enabled": False, "formula": ""}, "scaling": {}})
    trigger(ex, red, "self")
    free(h, red)
    ht = h["system"]["activities"]["gb27jJ6YPij5sC8U"]
    ht["name"] = "Hypothermic Touch (attack)"
    ht["range"], ht["target"] = {"value": "5", "units": "ft", "override": True}, one_creature()
    ht.setdefault("attack", {})["ability"] = "spellcasting"
    ht["attack"].setdefault("type", {})["value"] = "melee"
    free(h, ht)
    sv = h["system"]["activities"]["TwHrX3jWHk1dqtBs"]
    sv["name"] = "Hypothermic Touch: CON save (2d8 cold per CE)"
    sv["activation"]["type"] = "special"
    sv["damage"] = {"onSave": "half", "parts": [dice(2, 8, ["cold"], scale=2)]}
    trigger(ht, sv, "hitTargets")
    cost(h, sv, 1, 1, "2 * max(@abilities.wis.mod, @abilities.cha.mod)")
    note(h, "Fail by 5+: speed 0 until end of its turn (GM). Fire reduction shows as temp HP soaking the hit.")
    mark(h)


def disaster_storms(S):
    st = S.get("Storms of Disaster")
    a = _cone(st, "ikVHbTkz7MEdGtag", "Cutting winds — Bonus Action (1 CE)", ["slashing", "thunder"])

    l = S.get("Lightning")
    la = l["system"]["activities"]["QQS0doGNBq7dmJc8"]
    la["range"] = {"value": "60", "units": "ft", "override": True}
    la["target"] = one_creature()
    la.setdefault("attack", {})["ability"] = "spellcasting"
    scale(l, la, [[1, "3d6"], [6, "4d6"], [11, "6d6"], [18, "8d6"]])
    ch = act(l, "chain", "attack", "Chain to a creature within 10 ft (half damage)", "special",
             range={"value": "10", "units": "ft", "override": True}, target=one_creature(),
             attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False,
                     "type": {"value": "ranged", "classification": "spell"}},
             damage={"includeBase": False, "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["lightning"],
                     "custom": {"enabled": True, "formula": "floor(((3 + floor(min(@details.level, 6) / 6) + 2 * floor(min(@details.level, 11) / 11) + 2 * floor(min(@details.level, 18) / 18)))d6 / 2)"}, "scaling": {}}]})
    ch["damage"]["parts"][0]["custom"]["formula"] = "floor((3 + floor(min(@details.level, 6) / 6) + 2 * floor(min(@details.level, 11) / 11) + 2 * floor(min(@details.level, 18) / 18)) * 3.5 / 2)"
    free(l, ch)
    mark(l)

    sc = S.get("Storm Creation")
    sa = sc["system"]["activities"]["r4vulKLiD0Z95JXC"]
    sa["name"] = "Create storm (3+ CE): 10 ft + 5 ft per extra CE"
    sa["range"], sa["target"] = RANGE_SELF, sphere(10)
    sa["save"] = {"ability": [], "dc": {"calculation": "spellcasting", "formula": ""}}
    sa["type"] = "utility"
    for k in ("damage",): sa.pop(k, None)
    sc["effects"] = [e for e in sc["effects"] if e["_id"] != "3w2T1Fbl8PyqdLl2"]
    zone = fx(sc, "zone", "Storm (caught)", rounds=10,
              changes=[("flags.midi-qol.OverTime", 0, "turn=start, saveAbility=str, saveDC=JJKORIGINDC, label=Storm (prone on fail)"),
                       ("flags.midi-qol.grants.disadvantage.attack.rwak", 0, "1"),
                       ("flags.midi-qol.grants.disadvantage.attack.rsak", 0, "1")],
              desc="Difficult terrain; STR save at turn start or prone; ranged attacks against it have disadvantage.")
    apply(sa, zone)
    own = fx(sc, "own", "Storm Creation (caster)", rounds=10,
             changes=[("system.bonuses.rsak.damage", 2, "+ max(@abilities.wis.mod, @abilities.cha.mod)")],
             desc="+CE mod to lightning/thunder damage on creatures in the storm (applies to your CE attacks).")
    sa["effects"].append({"_id": own, "onSave": False})
    cost(sc, sa, 3, 1, "3 + @prof")
    sa["type"] = "save"
    sa["save"] = {"ability": ["str"], "dc": {"calculation": "spellcasting", "formula": ""}}
    sa["damage"] = {"onSave": "none", "parts": []}
    mark(sc)

    d = S.get("Maximum: Divine Storm Sovereign")
    ds = d["system"]["activities"]["h5IE1UtNwUcdaIdN"]
    ds["type"] = "utility"
    ds.pop("damage", None)
    ds["name"] = "Divine Storm Sovereign (10 CE)"
    ds["range"] = {"value": "300", "units": "ft", "override": True}
    ds["target"] = sphere(50)
    ds["target"]["affects"]["type"] = "enemy"
    apply(ds, fx(d, "storm", "Divine Storm", rounds=10,
                 changes=[("flags.midi-qol.OverTime", 0, "turn=start, damageRoll=3d10, damageType=lightning, label=Divine Storm")],
                 desc="Heavily obscured, difficult terrain; 3d10 lightning at turn start."))
    rp = d["system"]["activities"]["MnsCHVI8HS7kbXrd"]
    rp["name"] = "Replace an attack with Lightning (2 CE, no sight needed)"
    rp["activation"]["type"] = "special"
    note(d, "Use Lightning's attack after paying the 2 CE here.")
    mark(d)

    _domain_burst(S.get("Domain Expansion: Heavenly Throne of the Raging Tempest"), "W34gUJDAv6OCDkM2", "Initiative 20: 6d12 lightning to all")

    sd = S.get("Sunny Day")
    su = sd["system"]["activities"]["OM31HL66a1JtFZY2"]
    su["range"], su["target"] = RANGE_SELF, sphere(20)
    su["target"]["affects"]["type"] = "ally"
    su["duration"] = {"value": "2", "units": "minute", "override": True}
    apply(su, fx(sd, "sun", "Sunny Day", rounds=20,
                 changes=[("system.traits.dr.value", 2, "fire")],
                 desc="Resistance to fire; temp HP = 2 × CE mod (min 2) at the start of the caster's turn."))
    cost(sd, su, 6, 1, "6 + 2 * @prof")
    tmp = act(sd, "thp", "heal", "Sunny Day: start-of-turn temp HP", "special", range=RANGE_SELF, target=sphere(20),
              healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                       "custom": {"enabled": True, "formula": "max(2, 2 * max(@abilities.wis.mod, @abilities.cha.mod))"}, "scaling": {}})
    tmp["target"]["affects"]["type"] = "ally"
    free(sd, tmp)
    mark(sd)

    sh = S.get("Sunshine")
    ra = sh["system"]["activities"]["vvg0y1Ga9QXl6bXU"]
    ra["name"] = "Burning ray (replaces an attack, 4 CE)"
    ra["activation"]["type"] = "special"
    ra["range"], ra["target"] = {"value": "120", "units": "ft", "override": True}, one_creature()
    ra.setdefault("attack", {})["ability"] = "spellcasting"
    scale(sh, ra, [[1, "6d6"], [6, "8d6"], [11, "12d6"]])
    note(sh, "Target inside the Sunny Day radius: add your CE modifier to the damage.")
    mark(sh)


CEMOD = "max(@abilities.wis.mod, @abilities.cha.mod)"


def _ce_attack(a, rng):
    a["range"], a["target"] = {"value": str(rng), "units": "ft", "override": True}, one_creature()
    a.setdefault("attack", {})["ability"] = "spellcasting"
    a["attack"].setdefault("type", {})["value"] = "ranged"


def _scaling_touch(item, aid, nm, ex_fail=None):
    a = item["system"]["activities"][aid]
    a["name"] = nm
    a["range"], a["target"] = {"value": "5", "units": "ft", "override": True}, one_creature()
    a["damage"] = {"onSave": "half", "parts": [dice(2, 8, ["necrotic"], scale=2)]}
    cost(item, a, 1, 1, "2 * " + CEMOD)
    return a


def disaster_tides(S):
    t = S.get("Tides of Disaster")
    a = t["system"]["activities"]["8VEriIq1GcuVBmFT"]
    _ce_attack(a, 80)
    scale(t, a, [[1, "2d8"], [5, "3d8"], [11, "4d8"], [18, "5d8"]])
    mark(t)

    d = S.get("Domain Expansion: Horizon of Captivating Skhanda")
    fr = d["system"]["activities"]["PL6dqN3e7hSY5JKm"]
    fr["name"] = "Free expansion (2 per long rest)"
    d["system"]["uses"] = {"max": "2", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    fr["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}], "scaling": {"allowed": False}}
    sw = act(d, "swarm", "utility", "Death Swarm (X CE by shikigami)", "action", range={"value": "120", "units": "ft", "override": True},
             target=SELF)
    cost(d, sw, 1, 1, "12")
    note(d, "Death Swarm costs: eel 1, piranhas 2, serpent 4, killer whale 6, sperm whale 12 CE; each summon makes one guaranteed hit. "
            "Lasts indefinitely if no hostile creature is caught.")
    mark(d)

    w = S.get("Water Defensive Ring")
    w["effects"] = [e for e in w["effects"] if e["_id"] != "M0tHCJw5J8GRPw9t"]
    ring = fx(w, "ring", "Water Defensive Ring", rounds=600,
              changes=[("system.traits.di.value", 2, "cold"), ("system.traits.dr.value", 2, "bludgeoning"),
                       ("system.traits.dr.value", 2, "slashing"), ("system.traits.dr.value", 2, "piercing")],
              desc="Cold immunity and B/P/S resistance while the ring's temp HP last (remove when they are gone).")
    thp = {"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
           "custom": {"enabled": True, "formula": "15 * " + CEMOD}, "scaling": {}}
    a1 = w["system"]["activities"]["aLczDcFEaSepCqSW"]
    a1["name"], a1["healing"] = "Water ring (6 CE)", dict(thp)
    a1["range"], a1["target"] = RANGE_SELF, SELF
    apply(a1, ring)
    act(w, "9UsTF81pn5oUAYgE", "heal", "Water ring as reaction (8 CE)", "reaction", range=RANGE_SELF, target=SELF, healing=dict(thp))
    r = w["system"]["activities"]["9UsTF81pn5oUAYgE"]
    r["useConditionText"] = 'reaction === "isDamaged"'
    apply(r, ring)
    mark(w)

    f = S.get("Flash Flood")
    b = f["system"]["activities"]["MobgRH7arUrSxRwt"]
    _ce_attack(b, 30)
    b["name"] = "Water ball (6 CE): 10d8 cold, push 80 ft"
    c = f["system"]["activities"]["9cSExV3daZJ4NcQJ"]
    c["range"], c["target"] = {"value": "30", "units": "ft", "override": True}, sphere(10)
    c["damage"]["onSave"] = "half"
    mark(f)

    ts = S.get("Maximum: Tsunami")
    tt = ts["system"]["activities"]["49jmvydcAg9jYSQl"]
    act(ts, "49jmvydcAg9jYSQl", "save", "Tsunami (8 CE, as 8th-level spell)", "action",
        save={"ability": ["str"], "dc": {"calculation": "spellcasting", "formula": ""}},
        damage={"onSave": "half", "parts": [dice(6, 10, ["bludgeoning"])]},
        range={"value": "1", "units": "mi", "override": True},
        target={"template": {"type": "wall", "size": "300", "width": "50", "height": "300", "units": "ft", "count": "1", "contiguous": False},
                "affects": {"type": "creature", "choice": False}, "override": True})
    note(ts, "Tsunami spell: concentration 6 rounds; wall loses 50 ft height and 1d10 damage each round (track by hand).")
    mark(ts)

    dh = S.get("Dehydration")
    dd = dh["system"]["activities"]["FbMipC8WWqQSgfdW"]
    dd["name"] = "Destroy water / fog (2 CE per 10 gal)"
    dd["range"], dd["target"] = {"value": "60", "units": "ft", "override": True}, {"template": {"type": "cube", "size": "30", "units": "ft", "count": "1", "contiguous": False}, "affects": {"type": "", "choice": False}, "override": True}
    cost(dh, dd, 2, 2, "2 * " + CEMOD)
    sv = _scaling_touch(dh, "xAteEEccbxv1k3ub", "Dehydrate a creature (CE up to 2× mod)")
    note(dh, "Fail by 5+: gain 1 exhaustion level (GM). No effect on creatures without water.")
    mark(dh)


def disaster_verdure(S):
    f = S.get("Forests of Disaster")
    a = f["system"]["activities"]
    bind = a["rfqiDE2D1qWv9TeJ"]
    bind["name"] = "Binding Plants (1 CE)"
    bind["range"], bind["target"] = {"value": "30", "units": "ft", "override": True}, one_creature()
    bind["damage"] = {"onSave": "none", "parts": []}
    for e in f["effects"]:
        if e["_id"] == "Ex5F2IrqMMZF5RrV":
            e["changes"] = [{"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                             "value": "turn=end, saveAbility=str, saveDC=JJKORIGINDC, label=Binding Plants (STR check in RAW)"}]
            e["duration"] = {"rounds": 10}
    roots = act(f, "roots", "save", "Piercing Roots (1 CE)", "action",
                save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
                damage={"onSave": "half", "parts": [dice(1, 12, ["piercing"])]},
                range=RANGE_SELF,
                target={"template": {"type": "line", "size": "50", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                        "affects": {"type": "creature", "choice": False}, "override": True})
    cost(f, roots, 1)
    scale(f, roots, [[1, "1d12"], [5, "2d12"], [11, "3d12"], [18, "4d12"]])
    wall = a["V6swR8hZFSeJkXVb"]
    wall["name"] = "Wall of Roots (reaction, 1 CE)"
    wall["useConditionText"] = 'reaction === "isAttacked"'
    wall["target"] = {"template": {"type": "wall", "size": "5", "width": "1", "height": "10", "units": "ft", "count": "1", "contiguous": False},
                      "affects": {"type": "", "choice": False}, "override": True}
    wall["activation"]["condition"] = "You or an ally is targeted by an attack. Wall HP = CE mod × proficiency."
    mark(f)

    rb = S.get("Root Bundle")
    mk = act(rb, "make", "utility", "Create two wooden balls (2 CE)", "action", range=RANGE_SELF, target=SELF)
    cost(rb, mk, 2)
    apply(mk, fx(rb, "balls", "Root Bundle balls", rounds=600, desc="Two floating balls (HP = CE mod, AC 10 + CE mod)."))
    shot = rb["system"]["activities"]["lxIvbpHMossbpRUd"]
    _ce_attack(shot, 30)
    shot["name"] = "Send a ball (bonus action)"
    free(rb, shot)
    ride = act(rb, "ride", "utility", "Stand on a ball (bonus action)", "bonus", range=RANGE_SELF, target=SELF)
    apply(ride, fx(rb, "ride", "Riding a root ball", rounds=10,
                   changes=[("system.attributes.movement.fly", 4, "floor(@attributes.movement.walk / 2)")],
                   desc="Fly speed = half your walking speed while standing on a ball."))
    free(rb, ride)
    mark(rb)

    ff = S.get("Flower Field")
    fl = ff["system"]["activities"]["l7JoSf52R5Q74d2w"]
    fl["range"], fl["target"] = {"value": "100", "units": "ft", "override": True}, sphere(15)
    for e in ff["effects"]:
        if e["_id"] == "51wXQEJbwvjC2CY1":
            e["duration"] = {"rounds": 10}
            e["changes"] = [
                {"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                 "value": "turn=start, saveAbility=wis, saveDC=JJKORIGINDC, label=Flower Field"},
                {"key": "flags.midi-qol.grants.advantage.attack.all", "mode": 0, "value": "1", "priority": 20},
                {"key": "flags.dae.specialDuration", "mode": 2, "value": "isDamaged", "priority": 20}]
    note(ff, "Ends on damage (simplified: RAW allows a repeat save). Disadvantage on other saves: apply by hand.")
    mark(ff)

    cb = S.get("Cursed Buds")
    bud = cb["system"]["activities"]["OA6xjF2Db7g141RC"]
    _ce_attack(bud, 30)
    bud["name"] = "Cursed buds (6 CE): one attack per bud"
    bud["damage"] = {"includeBase": False, "parts": []}
    apply(bud, fx(cb, "bud", "Cursed Bud", rounds=None,
                  changes=[("flags.midi-qol.OverTime", 0,
                            "turn=start, damageRoll=JJKORIGINCEMOD, damageType=none, label=Cursed Bud (caster steals 1 CE)")],
                  desc="Loses HP = caster's CE mod at turn start; caster steals 1 CE; using CE costs it HP = prof. "
                       "Remove: action, STR check vs your DC."))
    tree = cb["system"]["activities"]["DBdzEheQjsHH67SS"]
    tree["name"] = "Bud tree (10 CE): one bud at each hostile within 30 ft"
    tree["range"] = {"value": "10", "units": "ft", "override": True}
    note(cb, "Tree: AC = your CE DC, HP = prof × level, 1 minute; use the bud attack against each hostile at your turn start.")
    mark(cb)

    sea = S.get("Domain Expansion: Ceremonial Sea of Light")
    sl = sea["system"]["activities"]["Yv33kKE2ljCkjyPj"]
    sl["name"] = "Initiative 20: Flower Field + 2d4 necrotic"
    sl["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    free(sea, sl)
    note(sea, "Also roll Flower Field's WIS save for everyone; you gain half the damage as temporary CE.")
    mark(sea)

    dc = S.get("Decay", technique="Disaster Verdure")
    ar = dc["system"]["activities"]["QEU26LaIdL97ieGV"]
    ar["name"] = "Decay plants (6 CE): 5d12 to plant creatures"
    ar["range"], ar["target"] = RANGE_SELF, sphere(30)
    ar["damage"]["onSave"] = "half"
    _scaling_touch(dc, "6CIjisR6JwyKaY4o", "Withering Plant (open wound, CE up to 2× mod)")
    hit = act(dc, "touch", "attack", "Withering Plant: melee attack", "action", range={"value": "5", "units": "ft", "override": True},
              target=one_creature(), attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False,
                                             "type": {"value": "melee", "classification": "spell"}})
    trigger(hit, dc["system"]["activities"]["6CIjisR6JwyKaY4o"], "hitTargets")
    free(dc, hit)
    mark(dc)


def _summon(item, aid, nm, rng=5, ce=None, note_txt=""):
    a = item["system"]["activities"][aid]
    a["name"] = nm
    a["range"], a["target"] = {"value": str(rng), "units": "ft", "override": True}, SELF
    if note_txt: note(item, note_txt)
    mark(item)
    return a


def disaster_vermin(S):
    _summon(S.get("Vermin of Disaster"), "gPedh4LMUYgWqxzh", "Create Insect Swarm (2 CE)",
            note_txt="Drag the Insect Swarm actor from the compendium; one at a time; command it as a bonus action or it Dodges.")
    e = S.get("Earthen Insect Trance")
    a = _summon(e, "fF1W1iUfbBN0i5bR", "Summon pouch insect (2 CE each, up to 2)", rng=10,
                note_txt="Swarms allowed = proficiency bonus; command all swarms and shikigami with one bonus action.")
    cost(e, a, 2, 2, "4")
    al = S.get("Almighty Swarm")
    m = act(al, "merge", "utility", "Merge swarms (part of command)", "bonus", range=RANGE_SELF, target=SELF)
    free(al, m)
    note(al, "Merged Vermin Swarm: +1 size per extra swarm, combined HP and damage dice (edit the swarm actor).")
    mark(al)
    pg = S.get("Parthenogenesis")
    eg = _summon(pg, "53YDe0Ck0x7iSj6P", "Lay egg (8 CE, −1 per creature devoured in 8 h)",
                 note_txt="Egg AC = your CE DC, HP = 2 × level. Die within 1 hour: reborn at half max HP with remaining CE, no gear.")
    cost(pg, eg, 8)
    eg["consumption"]["scaling"] = {"allowed": False}
    d = S.get("Domain Expansion: Brood Cathedral of the Crawling God")
    b = d["system"]["activities"]["fsZvjThbLlmGO7cM"]
    b["name"] = "Initiative 20: eggs burst (3 creatures, 6d10)"
    b["target"] = {"affects": {"type": "enemy", "count": "3", "choice": True}, "override": True}
    free(d, b)
    note(d, "A creature that dies in the domain becomes an extra Insect Swarm (doesn't count against the limit).")
    mark(d)
    sc = S.get("Stillbirth Colony")
    au = sc["system"]["activities"]["cJMZgHAf949E6ydV"]
    au["type"] = "utility"
    au["name"] = "Stillbirth Colony aura (6 CE)"
    au["range"], au["target"] = RANGE_SELF, sphere(15)
    au["target"]["affects"]["type"] = "enemy"
    apply(au, fx(sc, "aura", "Stillbirth Colony", rounds=10,
                 desc="CON save whenever it would gain HP or temp HP (DC = caster's CE DC): fail wastes the healing; "
                      "fail by 5+: disadvantage on CON saves, no bonus action or reaction until end of its next turn."))
    au["damage"] = {"onSave": "none", "parts": []}
    mark(sc)


def divergent_fist(S):
    df = S.get("Divergent Flow")
    a = df["system"]["activities"]["gZAPVoQZiZ4rkhTu"]
    act(df, "gZAPVoQZiZ4rkhTu", "damage", "Divergent Flow (on hit, 1 CE): delayed necrotic", "special", target=one_creature(),
        damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["necrotic"],
                           "custom": {"enabled": True, "formula": "0"}, "scaling": {}}]})
    d = df["system"]["activities"]["gZAPVoQZiZ4rkhTu"]
    d["useConditionText"] = 'reaction === "isHit"'
    d["activation"]["condition"] = "Roll the attack's damage as necrotic at the start of the creature's turn (edit 0 → the damage). Not a Black Flash."
    apply(d, fx(df, "mark", "Divergent Flow (delayed hit)", rounds=1, special=["turnStart"],
                desc="Takes the stored hit's damage as necrotic at the start of its turn."))
    mark(df)

    ex = S.get("Extreme Divergent Flow")
    sv = act(ex, "disorient", "save", "Disorient (CON on Divergent Flow damage)", "special", target=one_creature(),
             save={"ability": ["con"], "dc": {"calculation": "spellcasting", "formula": ""}}, damage={"onSave": "none", "parts": []})
    apply(sv, fx(ex, "dis", "Disoriented", rounds=10, special=["1Attack"],
                 changes=[("flags.midi-qol.disadvantage.attack.all", 0, "1")],
                 desc="Next attack at disadvantage (or targets get advantage on its next forced save)."))
    free(ex, sv)
    note(ex, "Divergent Flow twice per turn.")
    mark(ex)

    mp = S.get("Martial Prowess")
    acts = mp["system"]["activities"]
    acts["D941KeaQof2fVEWL"]["name"] = "One-Two (bonus action: two unarmed strikes)"
    mk = acts["nRz5TtM7pnHLQl3u"]
    mk["name"] = "Manji Kick (on unarmed hit)"
    mk["useConditionText"] = 'reaction === "isHit"'
    mk["target"] = one_creature()
    mk["save"]["dc"] = {"calculation": "", "formula": "8 + @prof + max(@abilities.str.mod, @abilities.dex.mod)"}
    for e in mp["effects"]:
        if e["_id"] == "JJKManjiStun0001":
            e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnStart"]
    two = act(mp, "second", "damage", "One-Two: second hit bonus (+3× mod)", "special", target=one_creature(),
              damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["bludgeoning"],
                                 "custom": {"enabled": True, "formula": "3 * max(@abilities.str.mod, @abilities.dex.mod)"}, "scaling": {}}]})
    free(mp, two)
    wv = act(mp, "weave", "utility", "Weave (Dodge as a reaction)", "reaction", range=RANGE_SELF, target=SELF)
    wv["useConditionText"] = 'reaction === "isAttacked"'
    apply(wv, fx(mp, "weave", "Weave", special=["turnStartSource"],
                 changes=[("flags.midi-qol.grants.disadvantage.attack.all", 0, "1"), ("flags.midi-qol.advantage.ability.save.dex", 0, "1")],
                 desc="Dodging until the start of your turn."))
    free(mp, wv)
    note(mp, "Once per round, one option. Manji Kick: failed save also doubles the kick's bludgeoning damage.")
    mark(mp)

    st = S.get("Stance of the Sparks")
    sa = st["system"]["activities"]["9XRPWqUPwSnDQjjn"]
    act(st, "9XRPWqUPwSnDQjjn", "utility", "Enter Stance of the Sparks (action)", "action", range=RANGE_SELF, target=SELF)
    apply(st["system"]["activities"]["9XRPWqUPwSnDQjjn"],
          fx(st, "stance", "Stance of the Sparks", rounds=2, special=["1Attack"],
             changes=[("system.attributes.movement.all", 0, "0")],
             desc="Speed 0; one attack next turn that rolls for Black Flash even without a crit, at advantage."))
    mark(st)
    cs = S.get("Chosen by the Sparks")
    note(cs, "Crits and Stance of the Sparks attacks are always Black Flashes (resolve without rolling).")
    mark(cs)


def dragon_vein(S):
    fd = S.get("Flow of the Dragon")
    fd.setdefault("effects", [])
    pid = fx(fd, "ground", "Flow of the Dragon", rounds=None,
             changes=[("system.bonuses.mwak.damage", 2, "+ @prof"), ("system.bonuses.msak.damage", 2, "+ @prof")],
             desc="While your feet touch the ground: +prof to melee damage; advantage vs forced movement.")
    for e in fd["effects"]:
        if e["_id"] == pid: e["transfer"], e["disabled"], e["duration"] = True, False, {}
    mark(fd)

    ll = S.get("Ley Line Command")
    a = ll["system"]["activities"]
    on = a["vIv57Pz5aTC7XNQu"]
    on["name"] = "Ley Line (3 CE, 1 minute)"
    on["range"], on["target"] = RANGE_SELF, SELF
    ch = [("system.traits.dm.amount.all", 2, "-@prof")]
    apply(on, fx(ll, "ley", "Ley Line", rounds=10, changes=ch,
                 desc="Immune to forced movement/teleport; −prof to all damage; at 11th immune to grappled/restrained/prone. Ends off the ground."))
    rs = a["e6DAqsMKaDe7MZSY"]
    rs["name"] = "Reinforce: resist triggering damage (1 CE)"
    rs["useConditionText"] = 'reaction === "isDamaged"'
    rs["range"], rs["target"] = RANGE_SELF, SELF
    apply(rs, fx(ll, "res", "Ley Line resistance", special=["turnStartSource"],
                 desc="Resistance to the triggering damage type (pick it in the effect) until your next turn."))
    mark(ll)

    ed = S.get("Earth Dragon Soul")
    ex = act(ed, "extra", "damage", "Earth Dragon Soul (once per turn on melee hit)", "special", target=one_creature(),
             damage={"parts": [dice(1, 8, ["force"])]})
    ex["useConditionText"] = 'reaction === "isHit"'
    scale(ed, ex, [[1, "1d8"], [11, "2d8"], [18, "3d8"]])
    free(ed, ex)
    lk = ed["system"]["activities"]["wjL00Dr9ku7MhBsV"]
    lk["name"] = "Lock resistance until Ley Line ends (3 CE)"
    lk["useConditionText"] = 'reaction === "isDamaged"'
    lk["range"], lk["target"] = RANGE_SELF, SELF
    apply(lk, fx(ed, "lock", "Locked Ley resistance", rounds=10, desc="Resistance (pick the type) until the Ley Line ends."))
    note(ed, "Hasn't moved since last turn: extra damage twice per turn, speed 0 until your next turn.")
    mark(ed)

    wa = S.get("World Anchor")
    th = act(wa, "thp", "heal", "Start of turn: temp HP (grounded)", "special", range=RANGE_SELF, target=SELF,
             healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                      "custom": {"enabled": True, "formula": "@prof + max(@abilities.wis.mod, @abilities.cha.mod)"}, "scaling": {}})
    free(wa, th)
    ra = wa["system"]["activities"]["dYq3q5REb4nwq0XE"]
    ra["name"] = "Resist all damage (≤ half HP, 3 CE)"
    ra["activation"]["type"] = "special"
    ra["range"], ra["target"] = RANGE_SELF, SELF
    apply(ra, fx(wa, "all", "World Anchor", special=["turnStartSource"],
                 changes=[("system.traits.dr.all", 0, "1")], desc="Resistance to all damage until your next turn."))
    mark(wa)

    av = S.get("Ascetic Void")
    vv = av["system"]["activities"]["wwxlvDEmsEJ9EfF1"]
    vv["type"] = "utility"
    vv.pop("damage", None)
    vv["name"] = "Ascetic Void (6 CE, 2 minutes)"
    vv["range"], vv["target"] = RANGE_SELF, SELF
    apply(vv, fx(av, "fly", "Ascetic Void", rounds=20,
                 changes=[("system.attributes.movement.fly", 4, "2 * @attributes.movement.walk"),
                          ("system.attributes.movement.hover", 5, "true"),
                          ("flags.midi-qol.OverTime", 0, "turn=start, damageRoll=2 * max(@abilities.wis.mod, @abilities.cha.mod), damageType=healing, label=Ascetic Void"),
                          ("flags.midi-qol.superSaver.dex", 0, "floor(min(@details.level, 11) / 11)")],
                 desc="Fly 2× speed and hover; regain 2 × CE mod HP at turn start while airborne; at 11th, DEX saves: success 0, fail half."))
    mark(av)

    pw = S.get("Domain Expansion: Of Primordial World")
    cr = pw["system"]["activities"]["snl3KBJuHFmvdVAU"]
    cr["name"] = "Crushed: teleport or fly >10 ft (5d10 force, once per turn)"
    cr["target"] = one_creature()
    free(pw, cr)
    al = act(pw, "ley", "utility", "Domain: permanent Ley Line", "special", range=RANGE_SELF, target=SELF)
    apply(al, fx(pw, "ley", "Ley Line (domain)", rounds=10, changes=[("system.traits.dm.amount.all", 2, "-@prof")]))
    free(pw, al)
    mark(pw)


def _r(n): return {"value": str(n), "units": "ft", "override": True}


def _cube(n=5): return {"template": {"type": "cube", "size": str(n), "units": "ft", "count": "1", "contiguous": True},
                        "affects": {"type": "creature", "choice": False}, "override": True}


def earth_manipulation(S):
    ex = S.get("Excavation")
    a = ex["system"]["activities"]["iekatqZz8ODvkP4j"]
    a["name"] = "Stone cubes (1 CE each, up to CE mod)"
    a["range"], a["target"] = _r(30), _cube()
    cost(ex, a, 1, 1, CEMOD)
    note(ex, "Cubes: AC = your CE DC, HP = 5 × CE mod. Failed DEX: pushed to the end of the connected cubes.")
    mark(ex)

    sc = S.get("Sculpted Earth")
    acts = sc["system"]["activities"]
    rb = acts["ublSHi2hUYDOpiM5"]
    act(sc, "ublSHi2hUYDOpiM5", "attack", "Rock Blast (1 CE)", "action", range=_r(30), target=one_creature(),
        attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False,
                "type": {"value": "ranged", "classification": "spell"}},
        damage={"includeBase": False, "parts": [dice(1, 12, ["bludgeoning"], bonus="@mod")]})
    nec = act(sc, "nec", "attack", "Rock Blast, necrotic (2 CE)", "action", range=_r(30), target=one_creature(),
              attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False,
                      "type": {"value": "ranged", "classification": "spell"}},
              damage={"includeBase": False, "parts": [dice(1, 12, ["necrotic"], bonus="@mod")]})
    cost(sc, nec, 2)
    arm = act(sc, "armor", "utility", "Earthen Armor (1 CE per +1 AC, max prof)", "bonus", range=RANGE_SELF, target=SELF)
    apply(arm, fx(sc, "armor", "Earthen Armor", rounds=10, changes=[("system.attributes.ac.bonus", 2, "+ @scaling")],
                  desc="+AC equal to the CE spent for 1 minute."))
    cost(sc, arm, 1, 1, "@prof")
    tr = acts["1XNwZ1O9tP5b8SvC"]
    tr["name"] = "Tremor (3 CE)"
    tr["range"], tr["target"] = RANGE_SELF, sphere(20)
    tr["damage"]["onSave"] = "half"
    scale(sc, tr, [[1, "3d10"], [6, "4d10"], [11, "5d10"], [18, "6d10"]])
    mark(sc)

    ws = S.get("Wall of Stone")
    w = ws["system"]["activities"]["LxT1q9GWcJ6jkbiV"]
    w["name"] = "Wall of Stone (4 CE, ten 10×10 panels)"
    w["range"] = _r(60)
    w["target"] = {"template": {"type": "wall", "size": "100", "width": "1", "height": "10", "units": "ft", "count": "1", "contiguous": False},
                   "affects": {"type": "", "choice": False}, "override": True}
    mv = ws["system"]["activities"]["tvcu87Oi4rbeVmim"]
    mv["name"] = "Move panels 30 ft (1 CE, DEX or pushed)"
    mv["range"], mv["target"] = _r(60), one_creature()
    note(ws, "Wall AC = your CE DC, HP = 10 × CE mod.")
    mark(ws)

    sa = S.get("Stone Arms")
    acts = sa["system"]["activities"]
    g = acts["sO3Lme5lrVeBPDWw"]
    g["range"], g["target"] = _r(60), one_creature()
    g["damage"]["onSave"] = "half"
    for e in sa["effects"]:
        if e["_id"] == "4ruxGJwk5WBSM0JE": e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnStartSource"]
    acts["LbEeM13IHnhDCjZS"]["name"] = "Keep arms (1 CE, start of turn)"
    acts["LbEeM13IHnhDCjZS"]["activation"]["type"] = "special"
    cr = acts["0DSo7QJVhzKO5mLg"]
    cr["name"] = "Crush restrained target"
    cr["target"] = one_creature()
    cr["damage"]["onSave"] = "half"
    free(sa, cr)
    note(sa, "Concentration; arms AC 18, HP = your max HP. Escape: action, Athletics/Acrobatics vs your CE DC.")
    mark(sa)

    d = S.get("Domain Expansion: Trichiliocosm")
    b = d["system"]["activities"]["Nwpqjb5OiM9CQVuc"]
    b["type"] = "damage"
    b["name"] = "Initiative 20: 6d12 + restrained"
    b["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    for e in d["effects"]:
        if e["_id"] == "L0ozQWYn1agn85Ad": e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnStart"]
    free(d, b)
    ch = act(d, "chasm", "utility", "Reshape: 20-ft chasm (1d10 × 10 ft deep)", "action", target=sphere(20),
             roll={"formula": "1d10 * 10", "name": "Chasm depth (ft)", "prompt": False, "visible": True})
    free(d, ch)
    sp = act(d, "spikes", "damage", "Spiked terrain: 2d4 per 5 ft moved", "special", target=one_creature(),
             damage={"parts": [dice(2, 4, ["piercing"])]})
    free(d, sp)
    mark(d)

    di = S.get("Disintegration")
    a = di["system"]["activities"]["ibC7B6Tdns9WTowu"]
    a["name"] = "Disintegrate 5-ft cube (2 CE, +1 metal)"
    a["range"], a["target"] = _r(20), _cube()
    di["system"]["activities"]["IbBqNTKHiobR2R95"]["name"] = "Metal surcharge (+1 CE)"
    mark(di)

    md = S.get("Mass Disintegration")
    m = md["system"]["activities"]["5rKgXD7CCIyON09Q"]
    m["name"] = "Mass Disintegration (2 CE per cube)"
    m["range"], m["target"] = _r(5), _cube()
    m["damage"]["onSave"] = "none"
    cost(md, m, 2, 2, "2 * " + CEMOD)
    scale(md, m, [[1, "2d10"], [3, "3d10"], [6, "4d10"], [11, "6d10"], [18, "10d10"]])
    mark(md)

    du = S.get("Dustify")
    acts = du["system"]["activities"]
    acts["p7fcuymVzpAu8NwL"]["name"] = "Dustify small object (1 CE, holder DEX)"
    acts["p7fcuymVzpAu8NwL"]["range"], acts["p7fcuymVzpAu8NwL"]["target"] = _r(5), one_creature()
    acts["p7fcuymVzpAu8NwL"]["damage"] = {"onSave": "none", "parts": []}
    for aid, nm in [("Jkp96IkWbBmwVRmQ", "Weaken cursed tool ≤ 2nd grade (2 CE)"), ("7snVRA0htNuDtBgA", "Weaken 1st-grade tool (3 CE)")]:
        acts[aid]["name"] = nm
        acts[aid]["range"] = _r(5)
    sg = act(du, "special", "utility", "Weaken special-grade tool (6 CE, 18th)", "action", range=_r(5), target=SELF)
    cost(du, sg, 6)
    note(du, "Each touch: −1 attack/damage (weapon) or AC (armor); at −3 it crumbles.")
    mark(du)


def eight_heads(S):
    el = S.get("Eight Lives")
    a = el["system"]["activities"]["5SmXcppT0Hr5HzUQ"]
    a["name"] = "Spend a life (1 CE): revive at half HP"
    a["activation"]["type"] = "special"
    a["type"] = "heal"
    a["range"], a["target"] = RANGE_SELF, SELF
    a["healing"] = {"number": None, "denomination": None, "bonus": "", "types": ["healing"],
                    "custom": {"enabled": True, "formula": "floor(@attributes.hp.max / 2)"}, "scaling": {}}
    el["system"]["uses"] = {"max": "3 + floor(min(@details.level, 3) / 3) + 4 * floor(min(@details.level, 6) / 6)",
                            "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    a.setdefault("consumption", {"targets": [], "scaling": {"allowed": False}})["targets"].append(
        {"type": "itemUses", "target": "", "value": "1", "scaling": {}})
    a["activation"]["condition"] = "On dropping to 0 HP or dying outright; removes harmful conditions except exhaustion. 8 lives total (track them; one returns every 8 days)."
    mark(el)

    cw = S.get("Collective Will")
    r = cw["system"]["activities"]["2kNNSi7n5371fZoR"]
    r["useConditionText"] = 'reaction === "isSave"'
    cw["system"]["uses"] = {"max": "8", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    r.setdefault("consumption", {"targets": [], "scaling": {"allowed": False}})
    if not any(t.get("type") == "itemUses" for t in r["consumption"]["targets"]):
        r["consumption"]["targets"].append({"type": "itemUses", "target": "", "value": "1", "scaling": {}})
    note(cw, "INT/WIS/CHA checks or saves only; must use the new roll.")
    mark(cw)

    fo = S.get("Fangs of Orochi")
    f = fo["system"]["activities"]["7d2VFbEUkGc1ICIn"]
    f["name"] = "Summon Fangs (1 CE each, up to 8)"
    f["range"], f["target"] = _r(10), SELF
    cost(fo, f, 1, 1, "8")
    note(fo, "Drag the Fang of Orochi actor; command all as a bonus action; HP 20 at 11th; destroyed fangs return after 1 minute.")
    mark(fo)

    sf = S.get("Maximum: Sacrifice")
    s_ = sf["system"]["activities"]["TngmakB38s9XNX33"]
    s_["type"] = "utility"
    s_.pop("damage", None)
    s_["name"] = "Sacrifice barrier (6 CE, needs 3+ Fangs)"
    s_["range"], s_["target"] = _r(40), one_creature()
    apply(s_, fx(sf, "trap", "Sacrifice barrier", rounds=None,
                 changes=[("flags.midi-qol.OverTime", 0,
                           "turn=start, saveAbility=wis|cha, saveDC=JJKORIGINDC, saveDamage=halfdamage, damageRoll=10d4, damageType=necrotic, label=Sacrifice")],
                 desc="Trapped: CE save at turn start, 10d4 necrotic (half on save). Humanoid killed: you regain a life (1/week)."))
    mark(sf)

    d = S.get("Domain Expansion: Ama ga Fuchi")
    n = act(d, "count", "utility", "Initiative 20: Orochi bites (1d8 creatures)", "special", range=RANGE_SELF, target=SELF,
            roll={"formula": "1d8", "name": "Creatures bitten", "prompt": False, "visible": True})
    free(d, n)
    bite = act(d, "bite", "damage", "Orochi bite", "special", target={"affects": {"type": "enemy", "choice": True}, "override": True},
               damage={"parts": [dice(4, 10, ["piercing"])]})
    free(d, bite)
    note(d, "Bite damage uses 4d10 piercing as a stand-in; use the Yamata no Orochi stat block's bite if you have it.")
    mark(d)

    rv = S.get("Reverse Scale")
    m = rv["system"]["activities"]["JF4s8lUAEraNzZGp"]
    m["type"] = "utility"
    m.pop("damage", None)
    m["name"] = "Reinforce mortality (10 CE)"
    m["range"], m["target"] = _r(60), one_creature()
    apply(m, fx(rv, "mortal", "Mortal", rounds=None,
                changes=[("system.traits.di.value", 2, "healing"),
                         ("flags.midi-qol.fail.deathSave", 0, "1"),
                         ("system.traits.dm.amount.necrotic", 2, "JJKORIGINCEMOD")],
                desc="Until a long rest: no healing, auto-fail death saves, +caster's CE mod on necrotic damage taken."))
    of = rv["system"]["activities"]["frXuserErmvPh55O"]
    of["name"] = "Offering barrier (12 CE): ally heals 10d4 per turn"
    of["target"] = one_creature()
    apply(of, fx(rv, "offer", "Offering", rounds=None,
                 changes=[("flags.midi-qol.OverTime", 0, "turn=start, damageRoll=10d4, damageType=healing, label=Offering")]))
    mark(rv)


def esoteric_art(S):
    cp = S.get("Cursed Painting")
    a = cp["system"]["activities"]["jTp8GXWnG9RHFgGl"]
    a["name"] = "Cursed Painting (1 CE): DEX or sucked in"
    a["range"], a["target"] = _r(30), one_creature()
    a["damage"] = {"onSave": "none", "parts": []}
    apply(a, fx(cp, "in", "Inside a painting", rounds=None, desc="In the subspace; caster pays 1 CE at their turn start to keep it there."))
    keep = act(cp, "keep", "utility", "Keep creatures inside (1 CE, start of turn)", "special", range=RANGE_SELF, target=SELF)
    cost(cp, keep, 1)
    mark(cp)

    ic = S.get("Impasto Canvas")
    t = ic["system"]["activities"]["OCUpf0dX1NW95qdb"]
    t["name"] = "Ink trap"
    t["damage"]["onSave"] = "none"
    wolves = act(ic, "wolves", "utility", "Ink Shikigami: Ink Wolves (1 CE each)", "action", range=RANGE_SELF, target=SELF)
    cost(ic, wolves, 1, 1, CEMOD)
    for k, nm in [("shift", "Exit Shift (80 ft)"), ("terrain", "Difficult terrain (15 ft)"), ("struct", "Structure Generation (30 ft cube)")]:
        x = act(ic, k, "utility", nm, "action", range=RANGE_SELF, target=SELF)
        free(ic, x)
    mark(ic)

    sg = S.get("Sgraffito")
    w = sg["system"]["activities"]["6Nh37jJYKZ5aLuc4"]
    w["name"] = "Ink Wave (2 CE): 30-ft cone"
    w["range"], w["target"] = RANGE_SELF, sphere(30, kind="cone")
    w["damage"] = {"onSave": "none", "parts": [{"number": None, "denomination": 6, "bonus": "", "types": ["necrotic"],
                                                "custom": {"enabled": True, "formula": "(@prof)d6"}, "scaling": {}}]}
    for e in sg["effects"]:
        if e["_id"] == "6fWEhCa9V7wwa9MB": e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnEnd"]
    for k, nm, ce in [("gwolf", "Greater Ink Wolf (2 CE)", 2), ("crow", "Ink Crow (3 CE)", 3)]:
        x = act(sg, k, "utility", nm, "bonus", range=RANGE_SELF, target=SELF)
        cost(sg, x, ce)
    note(sg, "Painting manipulation is now a bonus action; traps +2 dice (+4 at 11th); 30-ft terrain; sturdier structures.")
    mark(sg)

    pc = S.get("Panoramic Composition")
    p = pc["system"]["activities"]["P6OcM4dm9NqJuBYB"]
    p["name"] = "Panoramic Composition (1 CE per creature)"
    p["range"] = _r(60)
    p["target"] = {"affects": {"type": "creature", "count": "1", "choice": True}, "override": True}
    p["damage"] = {"onSave": "none", "parts": []}
    cost(pc, p, 1, 1, "2 * " + CEMOD)
    mark(pc)

    d = S.get("Domain Expansion: Magnum Opus")
    two = act(d, "init20", "utility", "Initiative 20: two Impasto Canvas effects", "special", range=RANGE_SELF, target=SELF)
    free(d, two)
    note(d, "Domain = your subspace; Ink Shikigami and traps hit automatically.")
    mark(d)

    av = S.get("Artistic Vandalism")
    v = av["system"]["activities"]["gqJLJFDmqWTiSyFt"]
    act(av, "gqJLJFDmqWTiSyFt", "damage", "Artistic Vandalism (2 CE): object", "action", range=_r(5), target=one_creature(),
        damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["necrotic"],
                           "custom": {"enabled": True, "formula": "50 + 25 * (@scaling - 1)"}, "scaling": {}}]})
    cost(av, av["system"]["activities"]["gqJLJFDmqWTiSyFt"], 2, 2)
    note(av, "Objects/structures only: +2 CE per size above Medium (that extra CE does not add damage); destroyed objects turn to ink.")
    mark(av)

    sf = S.get("Sfumato")
    s_ = sf["system"]["activities"]["dU7rYj2gszT21wPa"]
    s_["range"], s_["target"] = _r(30), one_creature()
    s_["damage"] = {"onSave": "none", "parts": []}
    blur = fx(sf, "blur", "Sfumato", rounds=10,
              changes=[("flags.midi-qol.disadvantage.attack.all", 0, "1"),
                       ("flags.midi-qol.grants.disadvantage.attack.all", 0, "1"),
                       ("flags.midi-qol.OverTime", 0, "turn=start, damageRoll=2 * JJKORIGINLEVEL, damageType=necrotic, label=Sfumato")],
              desc="Blurred: attacks by and against it at disadvantage; caster may deal 2× level necrotic and −5 ft speed at its turn start Speed 0: restrained.")
    s_["effects"] = [{"_id": blur, "onSave": False}]
    mark(sf)


BODY = [("tiny", "Tiny part (tooth, finger, hair)", 1, "@abilities.con.mod", 120, 5, 6, False, "special"),
        ("small", "Small part (ear, nose)", 2, "max(1, @abilities.con.mod) * floor(@details.level / 2)", 100, 10, 8, True, "bonus"),
        ("medium", "Medium part (hand, foot)", 4, "max(1, @abilities.con.mod) * @details.level", 80, 15, 10, True, "action"),
        ("large", "Large part (arm, leg)", 6, "max(1, @abilities.con.mod) * @details.level", 60, 20, 12, True, "action")]


def explosive_flesh(S):
    sd = S.get("Self-Destruction")
    sd["system"]["activities"] = {}
    prone = "Ia19f9JKcxiglWi8"
    for key, nm, ce, hp, rng, rad, die, pr, at in BODY:
        a = act(sd, key, "save", f"Throw {nm} ({ce} CE + HP)", at,
                save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
                damage={"onSave": "half", "parts": [{"number": None, "denomination": die, "bonus": "", "types": ["force"],
                        "custom": {"enabled": True, "formula": f"({CEMOD})d{die}"}, "scaling": {}}]},
                range=_r(rng), target=sphere(rad))
        if pr: apply(a, prone)
        cost(sd, a, ce)
        a["consumption"]["targets"].append({"type": "attribute", "target": "attributes.hp.value", "value": hp, "scaling": {}})
        if key == "large": a["activation"]["condition"] = "Full-turn action"
    note(sd, "The body part is removed (regrow with RCT). Double damage to objects.")
    mark(sd)

    ft = S.get("Faster Throws")
    note(ft, "Small, Medium and Large throws may be an action or a bonus action (change the activation when you throw).")
    ft["system"]["activities"] = {}
    mark(ft)

    gt = S.get("Guerilla Tactics")
    g = gt["system"]["activities"]["cDZqmBgEf1AjCNHG"]
    g["name"] = "Instant explosion (reaction on melee hit given/received)"
    g["useConditionText"] = 'reaction === "isHit"'
    g["range"], g["target"] = RANGE_SELF, sphere(10)
    g["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": 8, "bonus": "", "types": ["force"],
                   "custom": {"enabled": True, "formula": f"({CEMOD})d8"}, "scaling": {}}]}
    g["activation"]["condition"] = "Pay the body part's cost; size = small here (change radius/die for others). Disadvantage unless their passive Perception beats your DC."
    cost(gt, g, 2)
    mark(gt)

    se = S.get("Stronger Explosions")
    sv = se["system"]["activities"]["wENdbq2O9vRdPcPp"]
    sv["name"] = "Explosion aftermath (on failed DEX)"
    sv["target"] = one_creature()
    for e in se["effects"]:
        e["duration"] = {"rounds": 10}
        e["changes"] = [{"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                         "value": f"turn=start, saveAbility=con, saveDC=JJKORIGINDC, label={e['name']}"}]
    sv["effects"] = [{"_id": "oavaaJ63thw5ibXF", "onSave": False}]
    bl = act(se, "blind", "save", "Aftermath at 18th (deafened + blinded)", "special", target=one_creature(),
             save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}}, damage={"onSave": "none", "parts": []})
    apply(bl, "oavaaJ63thw5ibXF", "T5GLe3zyx3FjMbHC")
    free(se, bl)
    free(se, sv)
    note(se, "Explosions +5 ft radius and triple damage to objects.")
    mark(se)

    lb = S.get("Living Bomb")
    lb.setdefault("system", {}).setdefault("activities", {})
    b = act(lb, "bomb", "save", "Living Bomb (on melee hit): CE save", "special", target=one_creature(),
            save={"ability": ["wis", "cha"], "dc": {"calculation": "spellcasting", "formula": ""}},
            damage={"onSave": "none", "parts": [{"number": None, "denomination": 10, "bonus": "", "types": ["force"],
                    "custom": {"enabled": True, "formula": f"(2 * {CEMOD})d10"}, "scaling": {}}]})
    b["useConditionText"] = 'reaction === "isHit"'
    cost(lb, b, 8, 2, "12")
    b["activation"]["condition"] = "Cost = 2× the part's cost (small 4, medium 8, large 12); damage dice doubled (shown for a hand/foot). Not skull/neck/torso."
    mark(lb)

    d = S.get("Domain Expansion: True Art")
    li = act(d, "init20", "save", "Initiative 20: detonate a creature's limb", "special", target=one_creature(),
             save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
             damage={"onSave": "half", "parts": [{"number": None, "denomination": 12, "bonus": "", "types": ["force"],
                     "custom": {"enabled": True, "formula": f"({CEMOD})d12"}, "scaling": {}}]})
    apply(li, prone_fx(d))
    free(d, li)
    note(d, "Your own body parts cost no CE inside the domain.")
    mark(d)


def prone_fx(item):
    return fx(item, "prone", "Prone", statuses=["prone"])


def fa_jin(S):
    sr = S.get("Store and Release")
    sr["system"]["uses"] = {"max": "@prof + @details.level", "spent": "@prof + @details.level",
                            "recovery": [{"period": "lr", "type": "formula", "formula": "-(@prof + @details.level)"}]}
    sr["system"]["uses"]["spent"] = 0
    sr["system"]["uses"]["recovery"] = [{"period": "lr", "type": "recoverAll"}]
    sr["system"]["activities"] = {}
    gain = act(sr, "gain", "utility", "Gain a Jin charge (melee miss)", "special", range=RANGE_SELF, target=SELF)
    gain["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "-1", "scaling": {}}], "scaling": {"allowed": False}}
    gain["useConditionText"] = "false"
    for key, nm, ch in [
        ("atk", "Spend charges: +2 attack each", [("system.bonuses.mwak.attack", 2, "+ (2 * @scaling)"), ("system.bonuses.msak.attack", 2, "+ (2 * @scaling)")]),
        ("dmg", "Spend charges: +1 damage die each", [("system.bonuses.mwak.damage", 2, "+ (@scaling)d6"), ("system.bonuses.msak.damage", 2, "+ (@scaling)d6")])]:
        a = act(sr, key, "utility", nm, "special", range=RANGE_SELF, target=SELF)
        a["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {"mode": "amount", "formula": "1"}}],
                            "scaling": {"allowed": True, "max": "@prof"}}
        apply(a, fx(sr, key, nm.split(":")[1].strip(), rounds=1, special=["1Attack"], changes=ch,
                    desc="Applies to your next melee or CE attack; wasted on a miss."))
    note(sr, "Item uses = Jin charges (max prof + level, empty after a long rest). Paying 1 CE instead of a charge: use the CE spend in the dialog. "
             "Damage die shown as d6; swap for your weapon die.")
    sr["system"]["uses"]["spent"] = "@prof + @details.level"
    sr["system"]["uses"]["spent"] = 0
    mark(sr)

    im = S.get("Instantaneous Movement")
    g = im["system"]["activities"]["cbOplIjiLd2Rj3Iu"]
    g["name"] = "Gain a Jin charge (start of turn, 1 CE or forgo movement)"
    g["activation"]["type"] = "special"
    g["range"], g["target"] = RANGE_SELF, SELF
    sp = act(im, "speed", "utility", "Spend a charge: +10 ft speed, triple jump", "special", range=RANGE_SELF, target=SELF)
    apply(sp, fx(im, "speed", "Jin burst", special=["turnEnd"], changes=[("system.attributes.movement.walk", 2, "+10")]))
    free(im, sp)
    bl = act(im, "blink", "utility", "Spend charges: move 10 ft each (reaction, no OA)", "reaction", range=RANGE_SELF, target=SELF)
    free(im, bl)
    note(im, "Adjust Jin charges on Store and Release's uses.")
    mark(im)

    ep = S.get("Fist of Explosive Power")
    a = ep["system"]["activities"]["fZFMhutSZEES7qco"]
    act(ep, "fZFMhutSZEES7qco", "save", "Blunt blast: 15-ft cone, CON (3 CE)", "action",
        save={"ability": ["con"], "dc": {"calculation": "spellcasting", "formula": ""}},
        damage={"onSave": "half", "parts": [dice(2, 6, ["bludgeoning"], scale=2)]}, range=RANGE_SELF, target=sphere(15, kind="cone"))
    apply(ep["system"]["activities"]["fZFMhutSZEES7qco"], "UYCFda7CTIFy4V1L")
    ep["system"]["activities"]["fZFMhutSZEES7qco"]["activation"]["condition"] = "Scale = Jin charges spent (2d6 each); deduct them on Store and Release"
    ep["flags"]["jjk5e"].setdefault("ceSteps", {})["fZFMhutSZEES7qco"] = 0
    ln = act(ep, "line", "save", "Edged blast: 30-ft line, DEX (3 CE)", "action",
             save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
             damage={"onSave": "half", "parts": [dice(2, 10, ["slashing"], scale=2)]}, range=RANGE_SELF,
             target={"template": {"type": "line", "size": "30", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                     "affects": {"type": "creature", "choice": False}, "override": True})
    cost(ep, ln, 3)
    mark(ep)

    mx = S.get("Maximize Potential Energy")
    g = mx["system"]["activities"]["gg6Cm5uMOgzvt7fn"]
    g["name"] = "Give Jin charges by touch (up to CE mod)"
    g["range"], g["target"] = _r(5), one_creature()
    note(mx, "Keep up to CE mod charges on a miss; 3+ charges on Explosive Power: +30 ft and thunder damage; 1 CE buys 2 charges.")
    mark(mx)

    d = S.get("Domain Expansion: Hall of Divine Bagua")
    n = act(d, "init20", "utility", "Initiative 20: negative Jin on all", "special",
            target={"affects": {"type": "enemy", "choice": True}, "override": True})
    apply(n, fx(d, "neg", "Negative Jin (domain)", rounds=10,
                changes=[("system.bonuses.mwak.damage", 2, "- 1d6"), ("system.bonuses.rwak.damage", 2, "- 1d6"),
                         ("system.bonuses.msak.damage", 2, "- 1d6"), ("system.bonuses.rsak.damage", 2, "- 1d6")],
                desc="−1d6 damage per charge; unlimited Jin charges for you while the domain lasts."))
    free(d, n)
    mark(d)

    nj = S.get("Negative Jin")
    a = nj["system"]["activities"]["ZeEZxJQIvCJbhNXh"]
    act(nj, "ZeEZxJQIvCJbhNXh", "utility", "Negative Jin (on unarmed hit, 2 CE)", "special", target=one_creature())
    x = nj["system"]["activities"]["ZeEZxJQIvCJbhNXh"]
    x["useConditionText"] = 'reaction === "isHit"'
    apply(x, fx(nj, "neg", "Negative Jin ×3", rounds=None, special=["1Attack"],
                changes=[("system.bonuses.mwak.damage", 2, "- 3d6"), ("system.bonuses.rwak.damage", 2, "- 3d6"),
                         ("system.bonuses.msak.damage", 2, "- 3d6"), ("system.bonuses.rsak.damage", 2, "- 3d6")],
                desc="Its next damaging attack/technique deals up to 3d6 less; 0 damage nullifies it."))
    mark(nj)

    ab = S.get("Fist of Absorbing Power")
    a = ab["system"]["activities"]["PhdF1hklt1xRyPCE"]
    act(ab, "PhdF1hklt1xRyPCE", "save", "Absorbing blast: 30-ft cone (6 CE)", "action",
        save={"ability": ["wis", "cha"], "dc": {"calculation": "spellcasting", "formula": ""}},
        damage={"onSave": "none", "parts": [dice(6, 8, ["necrotic"])]}, range=RANGE_SELF, target=sphere(30, kind="cone"))
    apply(ab["system"]["activities"]["PhdF1hklt1xRyPCE"],
          fx(ab, "neg", "Negative Jin ×3 (absorbed)", rounds=None, special=["1Attack"],
             changes=[("system.bonuses.mwak.damage", 2, "- 3d6"), ("system.bonuses.msak.damage", 2, "- 3d6")]))
    line = act(ab, "line", "save", "Absorbing blast: 60-ft line (edged weapon, 6 CE)", "action",
               save={"ability": ["wis", "cha"], "dc": {"calculation": "spellcasting", "formula": ""}},
               damage={"onSave": "none", "parts": [dice(6, 8, ["necrotic"])]}, range=RANGE_SELF,
               target={"template": {"type": "line", "size": "60", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                       "affects": {"type": "creature", "choice": False}, "override": True})
    cost(ab, line, 6)
    note(ab, "You gain 3 Jin charges per creature that fails.")
    mark(ab)


MC = "Mental Corruption"


def _mc(item, key, pct, desc=""):
    return fx(item, key, f"{MC} +{pct}%", rounds=None,
              desc=(desc or f"+{pct}% {MC}.") + " Track the total on the creature (10% −1 AC · 20% −1 saves · 40% −2 AC/saves · "
                   "50% no concentration · 60% disadv. skills · 70% charmed · 80% −4 AC/saves).")


def faceless_god(S):
    mi = S.get("Madness Inducement")
    a = mi["system"]["activities"]["bNsokXCoOhCb9NUg"]
    a["type"] = "utility"
    a.pop("damage", None)
    a["name"] = "Activate madness (3 CE, 1 minute)"
    a["range"], a["target"] = RANGE_SELF, sphere(60)
    a["target"]["affects"]["type"] = "enemy"
    apply(a, fx(mi, "aura", "Madness Inducement", rounds=10,
                changes=[("flags.midi-qol.OverTime", 0, "turn=end, label=Mental Corruption +5% (sees the caster)")],
                desc="Ends its turn within 60 ft seeing you: +5% Mental Corruption."))
    for pct in (5, 10, 25):
        x = act(mi, f"mc{pct}", "utility", f"Add {pct}% Mental Corruption", "special", target=one_creature())
        apply(x, _mc(mi, f"mc{pct}", pct))
        free(mi, x)
    pa = act(mi, "para", "utility", "Paranoia roll (d10; 1–2 attacks nearest)", "special", target=SELF, range=RANGE_SELF,
             roll={"formula": "1d10", "name": "Paranoia", "prompt": False, "visible": True})
    free(mi, pa)
    mark(mi)

    me = S.get("Madness Enhancement")
    h = act(me, "hit", "utility", "Madness on hit (+5%, +5% per extra CE)", "special", target=one_creature())
    h["useConditionText"] = 'reaction === "isHit"'
    apply(h, _mc(me, "hit", 5))
    cost(me, h, 0, 1, "@prof")
    mark(me)

    oi = S.get("Obsession and Insanity")
    note(oi, "Corruption cap 50% (75% at 11th, 100% at 18th). Paranoia die: d10 → d6 (50%) → d4 (75%) → automatic (100%). 90%: WIS save or random movement.")
    rd = act(oi, "rand", "save", "90%: random direction (WIS)", "special", target=one_creature(),
             save={"ability": ["wis"], "dc": {"calculation": "spellcasting", "formula": ""}}, damage={"onSave": "none", "parts": []})
    free(oi, rd)
    mark(oi)

    ru = S.get("Maximum: Rumination")
    r = ru["system"]["activities"]["jKkmtNfACcxkLF9P"]
    r["name"] = "Rumination (6 CE): 1d10 per 10% corruption"
    r["range"], r["target"] = _r(30), one_creature()
    r["damage"] = {"onSave": "none", "parts": [dice(1, 10, ["psychic"], scale=1)]}
    r["activation"]["condition"] = "Scale = corruption tens (e.g. 40% → 4d10, enter +3). Over 50%: the save has disadvantage."
    ru["flags"]["jjk5e"].setdefault("ceSteps", {})["jKkmtNfACcxkLF9P"] = 0
    mark(ru)

    d = S.get("Domain Expansion: Theia Mania")
    i = act(d, "init20", "utility", "Initiative 20: +5% corruption to all", "special",
            target={"affects": {"type": "enemy", "choice": True}, "override": True})
    apply(i, _mc(d, "dom", 5, "+5% Mental Corruption; −1 to all rolls per 10% inside the domain."))
    free(d, i)
    mark(d)

    fw = S.get("Face of Wisdom")
    w = fw["system"]["activities"]["3O1JYTxWlbNuFZgX"]
    w["range"], w["target"] = RANGE_SELF, sphere(30)
    w["target"]["affects"]["type"] = "ally"
    apply(w, fx(fw, "wise", "Face of Wisdom", rounds=20,
                changes=[("system.traits.ci.value", 2, "charmed"), ("system.traits.ci.value", 2, "frightened"),
                         ("system.traits.dr.value", 2, "psychic"),
                         ("flags.midi-qol.advantage.ability.save.int", 0, "1"), ("flags.midi-qol.advantage.ability.save.wis", 0, "1"),
                         ("flags.midi-qol.advantage.ability.save.cha", 0, "1")]))
    mark(fw)


FATES = [("bonds", "Bonds: +2 AC", [("system.attributes.ac.bonus", 2, "+2")]),
         ("promise", "Promised Time: adv./disadv. vs each other", []),
         ("mirror", "Mirrored: opposite rolls on 20/1", []),
         ("magnet", "Magnetic: pulled 10 ft together", []),
         ("share", "Shared Strengths (touch)", []),
         ("suffer", "Linked Suffering (6th, touch): split damage", []),
         ("death", "Destined Death (11th, touch): adv./disadv. on saves vs each other", [])]


def fate(S):
    fm = S.get("Fate Manipulation")
    fm["effects"] = [e for e in fm["effects"] if e["_id"] != "gvIMz85YIK6Emwtc"]
    base = fm["system"]["activities"]["y0xkFff9ta46MTeq"]
    base["name"] = "Bind two creatures (2 CE, +1 Fate per 2 CE)"
    base["range"] = _r(30)
    base["target"] = {"affects": {"type": "creature", "count": "2", "choice": True}, "override": True}
    base["duration"] = {"value": "1", "units": "minute", "override": True}
    cost(fm, base, 2, 2, "2 * @prof")
    base["effects"] = []
    for key, nm, ch in FATES:
        base["effects"].append({"_id": fx(fm, key, f"Fate — {nm}", rounds=10, changes=ch,
                                          desc=nm + ". Active while both are within 30 ft."), "onSave": False})
    note(fm, "Pick the Fate effects in the usage dialog (one per 2 CE above the base, up to prof). Soul damage cuts the thread; no effect on creatures without CE.")
    mark(fm)

    ce = S.get("Cursed Eyes of Fate")
    e = ce["system"]["activities"]["WVjxC1vFewIJD6uf"]
    e["range"], e["target"] = _r(60), one_creature()
    note(ce, "GM reveals one: resistances/immunities, CR/level, current HP, AC or an ability mod, emotions — or the target's threads.")
    mark(ce)

    sd = S.get("Strong Destiny")
    a = sd["system"]["activities"]["LBVlO7eNrfULztpx"]
    a["name"] = "Unlucky phenomena (reaction at its turn start, 2 CE)"
    a["target"] = one_creature()
    a["damage"] = {"onSave": "none", "parts": [{"number": None, "denomination": 8, "bonus": "", "types": ["bludgeoning", "slashing", "piercing"],
                   "custom": {"enabled": True, "formula": "(@prof)d8"}, "scaling": {}}]}
    a["activation"]["condition"] = "A creature under your Fate starts its turn. Damage always; DEX save vs prone."
    note(sd, "+1 minute per extra CE on Fates (1 hour, +1 hour per CE at 11th): edit the Fate duration.")
    mark(sd)

    ke = S.get("Karmic Entanglement")
    k = ke["system"]["activities"]["dz82WwVrCykNwCWW"]
    k["name"] = "Karmic Entanglement (1 week ritual, 8 CE)"
    k["activation"]["condition"] = "Uninterrupted week; up to prof creatures (you included)."
    mark(ke)

    d = S.get("Domain Expansion: Road of Karma")
    f = act(d, "foe", "utility", "Initiative 20: choose Destined Foe", "special", target=one_creature())
    apply(f, fx(d, "foe", "Destined Foe", rounds=10, changes=[("flags.midi-qol.grants.advantage.attack.all", 0, "1")],
                desc="Caster's attacks against it are guaranteed hits (Midi advantage as proxy). Fates ignore range/touch in the domain."))
    free(d, f)
    mark(d)

    fr = S.get("Freedom")
    a = fr["system"]["activities"]["HspT4B97VzoXgETZ"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(fr, "free", "Freedom", rounds=10,
                desc="Cannot use CE (don't spend any); immune to domain guaranteed hits, CE-targeting effects, and disadvantage/penalties on attacks, checks and saves "
                     "(remove disadvantage effects by hand)."))
    mark(fr)


TIER5 = "(floor(min(@details.level, 3) / 3) + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))"


def _ce_melee(rng, dmg_parts, bonus=""):
    return dict(range=_r(rng), target=one_creature(),
                attack={"ability": "spellcasting", "bonus": bonus, "critical": {"threshold": None}, "flat": False,
                        "type": {"value": "melee", "classification": "spell"}},
                damage={"includeBase": False, "parts": dmg_parts})


def g_warstaff(S):
    w = S.get("Warstaff")
    a = w["system"]["activities"]
    m = a["m4ZxTvPNLGndeoSD"]
    act(w, "m4ZxTvPNLGndeoSD", "utility", "Summon Warstaff (2 CE)", "bonus", range=RANGE_SELF, target=SELF)
    hit = act(w, "strike", "attack", "Warstaff strike (reach)", "action",
              **_ce_melee(10, [dice(1, 4, ["piercing"], bonus=CEMOD)]))
    free(w, hit)
    ink = act(w, "ink", "utility", "Ink: +1 second marked (on hit)", "special", target=one_creature())
    ink["useConditionText"] = 'reaction === "isHit"'
    apply(ink, fx(w, "ink", "Manga panel (+1 s)", rounds=None,
                  desc="+1 second of future visible (stack one effect per second, max = your proficiency bonus)."))
    free(w, ink)
    trigger(hit, ink, "hitTargets")
    view = a["nn5GJvMMdLGh7KZu"]
    view["name"] = "View the future (1 CE, bonus/reaction)"
    view["target"] = one_creature()
    view["range"] = _r(120)
    for sec, nm, ch in [(1, "1 s: its attacks vs you at disadvantage", [("flags.midi-qol.disadvantage.attack.all", 0, "1")]),
                        (3, "3 s: you have advantage vs it", [("flags.midi-qol.grants.advantage.attack.all", 0, "1")])]:
        x = act(w, f"see{sec}", "utility", f"Foresight {nm} (1 CE)", "bonus", range=_r(120), target=one_creature())
        apply(x, fx(w, f"see{sec}", f"Foresight ({sec} s)", special=["turnStartSource"], changes=ch, desc=nm))
        cost(w, x, 1)
    note(w, "2 s: advantage on saves vs it; 4–6 s: the GM tells you its next actions. Affects up to CE mod creatures.")
    mark(w)

    hp_ = S.get("Highlighted Panels")
    note(hp_, "Saves forced by a creature you see 2+ s into: half on fail, none on success (Midi: tick superSaver).")
    mark(hp_)
    ps = S.get("Predictable Strikes")
    c = act(ps, "crit", "utility", "Turn Warstaff hit into a critical (3+ s, once per turn)", "special", range=RANGE_SELF, target=SELF)
    c["useConditionText"] = 'reaction === "isHit"'
    free(ps, c)
    mark(ps)
    pc = S.get("Precognition")
    pc.setdefault("effects", [])
    e = fx(pc, "crit", "Precognition", rounds=None,
           changes=[("flags.midi-qol.critical.all", 0, "0")],
           desc="Crit range +½ CE mod when rolling with advantage from your technique; foes' fumble range +½ CE mod.")
    pc["effects"] = [x for x in pc["effects"] if x["_id"] != e]
    note(pc, "Midi has no per-source crit range; lower the crit threshold by ½ CE mod on the Warstaff when you have advantage.")
    mark(pc)

    d = S.get("Domain Expansion: Storyboard Dominion")
    f = act(d, "init20", "utility", "Initiative 20: see 6 s into everyone's future", "special",
            target={"affects": {"type": "enemy", "choice": False}, "override": True})
    apply(f, fx(d, "six", "Storyboard (6 s marked)", rounds=10,
                changes=[("flags.midi-qol.disadvantage.attack.all", 0, "1"), ("flags.midi-qol.grants.advantage.attack.all", 0, "1")],
                desc="All 6 seconds of foresight against the caster."))
    free(d, f)
    mark(d)

    bf = S.get("Backstory Flashback")
    b = bf["system"]["activities"]["1irvq4NUXJqrRk2p"]
    b["target"] = one_creature()
    note(bf, "See its past: 1 week per second marked.")
    mark(bf)


def golden_hour(S):
    stop = [("flags.midi-qol.advantage.attack.all", 0, "1")]
    g = S.get("Golden Hour")
    a = g["system"]["activities"]["kZc1uthKYagtyfvi"]
    a["name"] = "Stop time (1 CE) until end of turn"
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(g, "stop", "Time Stop", special=["turnEnd"], changes=stop,
                desc="You can't use CE; advantage vs creatures; they auto-fail STR/DEX saves and have no reactions."))
    frz = act(g, "frozen", "utility", "Frozen creatures (stopped time)", "special",
              target={"affects": {"type": "creature", "choice": True}, "override": True})
    apply(frz, fx(g, "frozen", "In stopped time", special=["turnEndSource"],
                  changes=[("flags.midi-qol.fail.ability.save.str", 0, "1"), ("flags.midi-qol.fail.ability.save.dex", 0, "1"),
                           ("flags.midi-qol.grants.advantage.attack.all", 0, "1")],
                  statuses=["incapacitated"]))
    free(g, frz)
    mark(g)

    mp = S.get("Majestic Pose")
    mp["effects"] = [e for e in mp["effects"] if e["_id"] != "t6QPc9SyrYsahyy1"]
    pose = mp["system"]["activities"]["8vWFnEg9QnfiwtPh"]
    pose["name"] = "Majestic Pose (full turn): 1 extra turn per 3 CE"
    pose["activation"]["type"] = "action"
    pose["range"], pose["target"] = RANGE_SELF, SELF
    cost(mp, pose, 3, 3, "2 * @prof")
    apply(pose, fx(mp, "spd", "Stopped-time speed", rounds=2,
                   changes=[("system.attributes.movement.walk", 2, f"+ (10 + 5 * (floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18)))")]))
    after = act(mp, "after", "utility", "Strain: speed 0 after time resumes", "special", range=RANGE_SELF, target=SELF)
    apply(after, fx(mp, "after", "Pose strain", rounds=2, special=["turnEnd"], changes=[("system.attributes.movement.all", 0, "0")]))
    free(mp, after)
    mark(mp)

    gw = S.get("Golden Week")
    gw["effects"] = [e for e in gw["effects"] if e["_id"] != "6CQLJ4Mi2URq1UL6"]
    w = gw["system"]["activities"]["egehxj5u7W8TYE5K"]
    w["range"], w["target"] = RANGE_SELF, SELF
    apply(w, fx(gw, "week", "Golden Week", rounds=10,
                changes=[("system.attributes.ac.bonus", 2, "+3"), ("flags.midi-qol.advantage.ability.save.dex", 0, "1"),
                         ("system.attributes.movement.all", 1, "2")],
                desc="Speed doubled, +3 AC, advantage on DEX saves, extra limited action (haste-like); no time stop meanwhile."))
    mark(gw)

    sr = S.get("Samsara Rewind")
    r = sr["system"]["activities"]["DqujXlB0omasjWGo"]
    r["activation"]["type"] = "action"
    r["name"] = "Samsara Rewind (full turn, 8 CE): rewind 1 round within 100 ft"
    r["range"], r["target"] = RANGE_SELF, sphere(100)
    note(sr, "Undo damage and CE spent (except this) and positions in 100 ft since the start of your previous turn — GM resets.")
    mark(sr)

    d = S.get("Domain Expansion: The World")
    t = act(d, "init20", "utility", "Initiative 20: stop time, take a turn", "special", range=RANGE_SELF, target=SELF)
    apply(t, fx(d, "stop", "The World", special=["turnEnd"], changes=stop))
    free(d, t)
    note(d, "Each time stop in the domain lasts one extra turn.")
    mark(d)

    bh = S.get("Blue Hour")
    b = bh["system"]["activities"]["BbMsDIlRoSMylz1C"]
    act(bh, "BbMsDIlRoSMylz1C", "save", "Blue Hour (on melee hit): slowed", "special", target=one_creature(),
        save={"ability": ["con"], "dc": {"calculation": "spellcasting", "formula": ""}}, damage={"onSave": "none", "parts": []})
    b = bh["system"]["activities"]["BbMsDIlRoSMylz1C"]
    b["useConditionText"] = 'reaction === "isHit"'
    apply(b, fx(bh, "slow", "Slowed (Blue Hour)", rounds=None,
                changes=[("system.attributes.movement.all", 1, "0.5"), ("system.attributes.ac.bonus", 2, "-2"),
                         ("system.abilities.dex.bonuses.save", 2, "-2"),
                         ("flags.midi-qol.OverTime", 0, "turn=end, saveAbility=con, saveDC=JJKORIGINDC, label=Blue Hour")],
                desc="Slow spell effects: half speed, −2 AC/DEX saves, no reactions, action or bonus action, one attack. 1 turn per 2 CE."))
    cost(bh, b, 2, 2, "2 * " + CEMOD)
    mark(bh)

    lt = S.get("Leisure Time")
    l = lt["system"]["activities"]["Ace4lJ3fTqUVE65i"]
    l["range"], l["target"] = RANGE_SELF, SELF
    apply(l, fx(lt, "slow", "Leisure Time", special=["turnStart"],
                changes=[("flags.midi-qol.advantage.skill.prc", 0, "1"), ("flags.midi-qol.advantage.ability.save.dex", 0, "1")]))
    mark(lt)


def hair_manipulation(S):
    sc = S.get("Scorpion Hair")
    a = sc["system"]["activities"]["651MhZdeI7xhonCW"]
    act(sc, "651MhZdeI7xhonCW", "attack", "Scorpion stinger (1 CE, replaces an attack)", "special",
        **_ce_melee(10, [dice(1, 10, ["piercing"], bonus=CEMOD + " + " + TIER5)], bonus=TIER5))
    mark(sc)

    dr = S.get("Drill Hair")
    acts = dr["system"]["activities"]
    act(dr, "BiUJjyUJ5oqD5tRp", "attack", "Drill shot (1 CE, replaces an attack)", "special",
        range={"value": "30 + 30 * floor(min(@details.level, 6) / 6)", "units": "ft", "override": True}, target=one_creature(),
        attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False,
                "type": {"value": "ranged", "classification": "spell"}},
        damage={"includeBase": False, "parts": [dice(1, 6, ["piercing"], bonus=CEMOD)]})
    act(dr, "1QKHOQ1KZ49cbcxr", "save", "Explosive drill (+2 CE): 5-ft burst", "special",
        save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
        damage={"onSave": "half", "parts": [dice(3, 6, ["fire"])]}, target=sphere(5))
    scale(dr, acts["1QKHOQ1KZ49cbcxr"], [[1, "3d6"], [6, "5d6"], [11, "8d6"], [18, "10d6"]])
    trigger(acts["BiUJjyUJ5oqD5tRp"], acts["1QKHOQ1KZ49cbcxr"], "hitTargets",
            "false")
    acts["BiUJjyUJ5oqD5tRp"].pop("midiProperties", None)
    mark(dr)

    ah = S.get("Aircraft Hair")
    acts = ah["system"]["activities"]
    acts["eOcvntLcnlzOiafX"]["name"] = "Helicopter Hair (3 CE, 1 minute)"
    acts["eOcvntLcnlzOiafX"]["range"], acts["eOcvntLcnlzOiafX"]["target"] = RANGE_SELF, SELF
    apply(acts["eOcvntLcnlzOiafX"], fx(ah, "heli", "Helicopter Hair", rounds=10,
                                         changes=[("system.attributes.movement.fly", 4, "@attributes.movement.walk")],
                                         desc="Fly = walk; Dash as bonus action; OA attackers take CE mod (2× at 11th) slashing."))
    jet = act(ah, "jet", "utility", "Jet Hair (3 CE, 1 minute)", "action", range=RANGE_SELF, target=SELF)
    apply(jet, fx(ah, "jet", "Jet Hair", rounds=10, changes=[("system.attributes.movement.fly", 4, "@attributes.movement.walk")],
                  desc="Fly = walk; Dash while flying: no OAs and can ram in a line (2× fly at 11th, 3× at 18th)."))
    cost(ah, jet, 3)
    keep = act(ah, "keep", "utility", "Keep form 1 more minute (1 CE)", "special", range=RANGE_SELF, target=SELF)
    cost(ah, keep, 1)
    bl = acts["4paFjPNu3b466ZR7"]
    act(ah, "4paFjPNu3b466ZR7", "attack", "Rotor blades (2 CE, replaces an attack)", "special",
        **_ce_melee(5, [dice(6, 8, ["slashing"], bonus=CEMOD)]))
    scale(ah, acts["4paFjPNu3b466ZR7"], [[1, "6d8"], [11, "8d8"], [18, "10d8"]])
    ram = acts["jQiw29edvLAZPulD"]
    ram["name"] = "Jet ram (DEX): push 30 ft, prone"
    ram["target"] = {"template": {"type": "line", "size": "60", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                     "affects": {"type": "creature", "choice": False}, "override": True}
    ram["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": 8, "bonus": "", "types": ["bludgeoning"],
                     "custom": {"enabled": True, "formula": f"({CEMOD})d8"}, "scaling": {}}]}
    free(ah, ram)
    note(ah, "Impact with a surface: +1d4 bludgeoning per 10 ft travelled.")
    mark(ah)

    hs = S.get("Hair Spray")
    a = hs["system"]["activities"]["JVgDGXhMR3fNB5BQ"]
    a["name"] = "Save technique as bonus action (4 CE, target disadvantage)"
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(hs, "save", "Hair Spray (save)", rounds=1, special=["1Spell"],
                changes=[("flags.midi-qol.grants.disadvantage.save.all", 0, "1")]))
    atk = act(hs, "atk", "utility", "Attack technique as bonus action (+2 CE, advantage)", "bonus", range=RANGE_SELF, target=SELF)
    apply(atk, fx(hs, "atk", "Hair Spray (attack)", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.advantage.attack.all", 0, "1")]))
    cost(hs, atk, 2)
    note(hs, "+5 ft reach on hair techniques; hair = Grade 1 tool (Special Grade at 18th).")
    mark(hs)

    d = S.get("Domain Expansion: Silken Strand Execution Ground")
    c = d["system"]["activities"]["sjMhQBxYfnW8VLez"]
    c["name"] = "Hair cuts: 2d10 per 5 ft moved"
    c["target"] = one_creature()
    free(d, c)
    note(d, "Difficult terrain for everyone but you.")
    mark(d)

    dh = S.get("Doll Hairs")
    a = dh["system"]["activities"]["O8Nk2PrZ1n3LEdde"]
    a["range"], a["target"] = _r(10), one_creature()
    a["damage"] = {"onSave": "none", "parts": []}
    apply(a, fx(dh, "doll", "Doll Hairs", rounds=None,
                desc="Caster can use Hair Manipulation through its hair 2 × CE mod times. Hair AC = caster's DC; fire/slashing ≥ caster level destroys it."))
    mark(dh)


def ot_save(item, eid, ability, label, rounds=10, when="start"):
    for e in item["effects"]:
        if e["_id"] == eid:
            e["duration"] = {"rounds": rounds}
            e["changes"] = [c for c in e.get("changes", []) if c["key"] != "flags.midi-qol.OverTime"] + [
                {"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                 "value": f"turn={when}, saveAbility={ability}, saveDC=JJKORIGINDC, label={label}"}]


def heart_catch(S):
    h = S.get("Hands of Love")
    a = h["system"]["activities"]["CN6TTssteOaassfF"]
    a["name"] = "Create Love Hands (1 CE)"
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(h, "hands", "Love Hands", rounds=None,
                desc="Two hands within 15 ft (30 ft at 3rd): AC = CE DC (+prof at 3rd), HP = 2/3/4 × CE score; you take 1/10 of their damage."))
    hit = act(h, "punch", "attack", "Love Hand strike (replaces an attack)", "special",
              range={"value": "15 + 15 * floor(min(@details.level, 3) / 3)", "units": "ft", "override": True}, target=one_creature(),
              attack={"ability": "str", "bonus": "", "critical": {"threshold": None}, "flat": False, "type": {"value": "melee", "classification": "unarmed"}},
              damage={"includeBase": False, "parts": [dice(1, 4, ["bludgeoning"], bonus="@mod + floor(min(@details.level, 3) / 3) * " + CEMOD)]})
    free(h, hit)
    gr = act(h, "grab", "utility", "Grapple/shove with a hand (advantage)", "special", target=one_creature(),
             roll={"formula": "2d20kh + @skills.ath.total", "name": "Athletics (advantage)", "prompt": False, "visible": True})
    free(h, gr)
    note(h, "Hand damage uses 1d4 + STR; replace with your unarmed/martial die. At 3rd: +CE mod damage, grappled = restrained.")
    mark(h)

    hd = S.get("Handy")
    r = hd["system"]["activities"]["ZFV8r0xzxQdNPza1"]
    r["name"] = "Grappled by a hand: restrained"
    r["target"] = one_creature()
    free(hd, r)
    mark(hd)
    hs = S.get("Hand Shield")
    c = act(hs, "cover", "utility", "Guard a creature (¾ cover)", "special", range=_r(15), target=one_creature())
    apply(c, fx(hs, "cover", "Hand Shield", rounds=None, changes=[("system.attributes.ac.bonus", 2, "+5"), ("system.abilities.dex.bonuses.save", 2, "+5")],
                desc="Three-quarters cover (+5 AC/DEX saves). Half cover if each hand guards someone (edit to +2)."))
    free(hs, c)
    mark(hs)

    ch = S.get("Cutie Honey")
    a = ch["system"]["activities"]["OW8P8BPdrsaflpEH"]
    a["name"] = "Cutie Honey (on melee hit, 5 CE)"
    a["activation"]["type"] = "special"
    a["useConditionText"] = 'reaction === "isHit"'
    a["target"] = one_creature()
    a["damage"] = {"onSave": "none", "parts": []}
    ot_save(ch, "7wvMBfX5EbXrTJI2", "wis", "Cutie Honey")
    mark(ch)

    d = S.get("Domain Expansion: Lover’s Grasp")
    i = d["system"]["activities"]["AOT9zvgsSauWbLgR"]
    i["name"] = "Initiative 20: all restrained + charmed"
    i["target"] = {"affects": {"type": "enemy", "choice": False}, "override": True}
    i["effects"].append({"_id": fx(d, "charm", "Charmed (Lover's Grasp)", statuses=["charmed"], special=["turnEnd"]), "onSave": False})
    for e in d["effects"]:
        if e["_id"] == "I7GR0j7PzujJayoL": e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnEnd"]
    free(d, i)
    note(d, "Love Hands auto-hit; creatures auto-fail grapple/shove contests and saves forced by the hands.")
    mark(d)

    fl = S.get("Fine Line")
    a = fl["system"]["activities"]["1fxW5LIOvnfrRs1h"]
    a["range"], a["target"] = RANGE_SELF, sphere(30, kind="cone")
    a["damage"]["onSave"] = "half"
    ot_save(fl, "SIjTJ4wq95JwbFpW", "wis", "Fine Line", when="end")
    mark(fl)


def ice_formation(S):
    ic = S.get("Ice Creation")
    a = ic["system"]["activities"]
    c = a["5gL47zMatNoMr4T3"]
    c["name"] = "Ice cone (1 CE): 10 ft"
    c["range"], c["target"] = RANGE_SELF, sphere(10, kind="cone")
    c["damage"]["onSave"] = "half"
    scale(ic, c, [[1, "1d10"], [3, "2d10"], [6, "3d10"], [10, "4d10"], [14, "5d10"], [20, "6d10"]])
    ot_save(ic, "9dgt9hnF33yz3Uyu", "str", "Ice (break free)", rounds=600)
    stray = a.pop("I8RJht3EZwSVUxVC", None)
    ic["effects"] = [e for e in ic["effects"] if e["_id"] != "pbtcDbH76bTmZjnj"]
    ic["flags"]["jjk5e"].get("ceCosts", {}).pop("I8RJht3EZwSVUxVC", None)
    note(ic, "Ice lasts until you end it, it's broken, or you are poisoned/incapacitated/unconscious.")
    mark(ic)

    ec = S.get("Extreme Cold")
    t = act(ec, "trapped", "utility", "Encased: 1 exhaustion while in ice", "special", target=one_creature())
    apply(t, fx(ec, "ex", "Extreme Cold (in ice)", rounds=None, changes=[("system.attributes.exhaustion", 2, "1")],
                desc="One level of exhaustion while inside your ice; remove when freed."))
    free(ec, t)
    n = act(ec, "near", "utility", "Near ice: speed halved", "special", target=one_creature())
    apply(n, fx(ec, "near", "Extreme Cold (near ice)", rounds=None, changes=[("system.attributes.movement.all", 1, "0.5")],
                desc="Within 5 ft of your ice without cold resistance/immunity."))
    free(ec, n)
    mark(ec)

    fc = S.get("Frost Calm")
    a = fc["system"]["activities"]["qlZCvvTLSeKyofm6"]
    a["range"], a["target"] = _r(60), sphere(30)
    a["damage"]["onSave"] = "half"
    ot_save(fc, "PeB6XH93ahsmArJd", "str", "Ice layer", rounds=600)
    mark(fc)

    f = S.get("Ice Fall")
    a = f["system"]["activities"]["XXqVRtHuHqkmPL8j"]
    act(f, "XXqVRtHuHqkmPL8j", "attack", "Ice Fall (8 CE): shard at each chosen creature", "action",
        range=_r(30), target={"affects": {"type": "enemy", "choice": True}, "override": True},
        attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False, "type": {"value": "ranged", "classification": "spell"}},
        damage={"includeBase": False, "parts": [dice(1, 10, ["cold"])]})
    a = f["system"]["activities"]["XXqVRtHuHqkmPL8j"]
    a["effects"] = [{"_id": "zHG47wYGd8WKGahy", "onSave": False}]
    ot_save(f, "zHG47wYGd8WKGahy", "str", "Ice Fall", rounds=600)
    sp = act(f, "spikes", "save", "Falling spikes (DEX, hit or miss)", "special",
             save={"ability": ["dex"], "dc": {"calculation": "spellcasting", "formula": ""}},
             damage={"onSave": "half", "parts": [dice(6, 8, ["cold"]), dice(6, 8, ["piercing"])]},
             target={"affects": {"type": "enemy", "choice": True}, "override": True})
    free(f, sp)
    a.setdefault("midiProperties", {})
    trigger(a, sp, "self")
    a["midiProperties"]["triggeredActivityTargets"] = "targets"
    me = act(f, "self", "utility", "You lie prone until your next turn", "special", range=RANGE_SELF, target=SELF)
    apply(me, "izMKZvLQhIcYxIav")
    for e in f["effects"]:
        if e["_id"] == "izMKZvLQhIcYxIav": e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnStart"]
    free(f, me)
    mark(f)

    d = S.get("Domain Expansion: White Abyss")
    b = d["system"]["activities"]["baNd4KsTqloG3jFL"]
    b["name"] = "End of each turn: 10d8 cold + restrained"
    b["target"] = {"affects": {"type": "enemy", "choice": False}, "override": True}
    ot_save(d, "GQz8GKEdPn3HU1pM", "str", "White Abyss (Athletics)", rounds=1)
    free(d, b)
    mark(d)

    hd = S.get("Heat Dissociation")
    a = hd["system"]["activities"]["SzjOEAamhOfqhc6z"]
    a["range"] = _r(30)
    a["target"] = {"affects": {"type": "creature", "count": CEMOD, "choice": True}, "override": True}
    a["damage"]["onSave"] = "half"
    scale(hd, a, [[1, "8d10"], [18, "10d10"], [20, "16d10"]])
    apply(a, fx(hd, "exh", "Boiled (exhaustion)", rounds=None, changes=[("system.attributes.exhaustion", 2, "1")]))
    note(hd, "Damage also lowers max HP until a long rest (apply as HP max reduction).")
    mark(hd)


def idle_transfiguration(S):
    t = S.get("Transfiguration")
    a = t["system"]["activities"]["PDD97g8ETyVvBxYc"]
    a["name"] = "Transfigure (1 CE): CON save"
    a["range"], a["target"] = _r(5), one_creature()
    a["damage"]["onSave"] = "half"
    scale(t, a, [[1, "1d10"], [3, "2d10"], [6, "3d10"], [11, "4d10"], [18, "5d10"]])
    touch = act(t, "touch", "damage", "Soul touch (+1d6 necrotic on unarmed/natural hit)", "special", target=one_creature(),
                damage={"parts": [dice(1, 6, ["necrotic"])]})
    touch["useConditionText"] = 'reaction === "isHit"'
    free(t, touch)
    note(t, "Necrotic from this technique lowers max HP until a long rest; at 0 HP the creature becomes a Transfigured Creature (not constructs).")
    mark(t)

    al = S.get("Alteration")
    al["effects"] = [e for e in al["effects"] if e["_id"] != "AyyxRu9CmSsHVXWO"]
    al["system"]["activities"] = {}
    for key, nm, ch in [
        ("sword", "Sword Arms", []),
        ("spike", "Spike Hands", [("system.bonuses.mwak.damage", 2, "+ @prof")]),
        ("shield", "Arm Shields", [("system.attributes.ac.bonus", 2, "+2")]),
        ("long", "Long Arms", []),
        ("wings", "Wings", [("system.attributes.movement.fly", 4, "@attributes.movement.walk")]),
    ]:
        x = act(al, key, "utility", f"Self-Alteration: {nm} (2 CE)", "bonus", range=RANGE_SELF, target=SELF)
        apply(x, fx(al, key, nm, rounds=None, changes=ch, desc=f"{nm} (see the table for restrictions)."))
        cost(al, x, 2)
    ally = act(al, "ally", "utility", "Ally Alteration (rest)", "special", range=_r(5), target=one_creature())
    free(al, ally)
    note(al, "Wings' exact benefit: check the table (fly speed assumed = walking). Ally alterations: up to prof per creature.")
    mark(al)

    bc = S.get("Body Clone")
    note(bc, "Duplicate your actor with half current/max HP and CE; it acts after you and can only use Self-Alteration.")
    mark(bc)

    sm = S.get("Soul Multiplicity")
    a = sm["system"]["activities"]["Qa1Z5K8PGagni1yp"]
    a["name"] = "Body Repel (5 CE, 2+ transfigured)"
    a["range"] = {"value": "60", "long": "120", "units": "ft", "override": True}
    a["target"] = one_creature()
    a.setdefault("attack", {})["ability"] = "spellcasting"
    a["damage"] = {"includeBase": False, "parts": [dice(4, 8, ["necrotic"], scale=1)]}
    iso = act(sm, "iso", "utility", "Polymorphic Soul Isomer (5 CE, 1 minute)", "action", range=_r(5), target=SELF)
    cost(sm, iso, 5)
    note(sm, "Scale +1d8 per extra transfigured creature; split dice for extra attacks. Self-Alteration is free on your turn.")
    mark(sm)

    d = S.get("Domain Expansion: Self Embodiment of Perfection")
    x = act(d, "init20", "save", "Initiative 20: double Transfiguration", "special",
            save={"ability": ["con"], "dc": {"calculation": "spellcasting", "formula": ""}},
            damage={"onSave": "half", "parts": [dice(10, 10, ["necrotic"])]},
            target={"affects": {"type": "enemy", "choice": True}, "override": True})
    free(d, x)
    note(d, "10d10 = twice the 18th-level touch (5d10).")
    mark(d)

    ot = S.get("Object Transfiguration")
    a = ot["system"]["activities"]
    a["vEcHzLX4wvXVsrEe"]["name"] = "Transfigure object (1 CE per property, special 3)"
    a["vEcHzLX4wvXVsrEe"]["activation"]["type"] = "bonus"
    a["vEcHzLX4wvXVsrEe"]["range"] = _r(5)
    cost(ot, a["vEcHzLX4wvXVsrEe"], 1, 1, "2 * @prof")
    ssw = a["NkfJzYQfdGx0r59c"]
    act(ot, "NkfJzYQfdGx0r59c", "save", "Soul Splitting Weapon (on hit, 4 CE)", "special",
        save={"ability": ["con"], "dc": {"calculation": "spellcasting", "formula": ""}},
        damage={"onSave": "half", "parts": [dice(3, 10, ["necrotic"])]}, target=one_creature())
    a["NkfJzYQfdGx0r59c"]["useConditionText"] = 'reaction === "isHit"'
    scale(ot, a["NkfJzYQfdGx0r59c"], [[1, "1d10"], [3, "2d10"], [6, "3d10"], [11, "4d10"], [18, "5d10"]])
    mark(ot)


def _sv(ab): return {"ability": [ab] if isinstance(ab, str) else ab, "dc": {"calculation": "spellcasting", "formula": ""}}


def illusive_mirage(S):
    ci = S.get("Cursed Illusion")
    a = ci["system"]["activities"]["8hp6SOVXqIlsCq8r"]
    a["range"] = _r(60)
    a["target"] = {"affects": {"type": "creature", "count": "1", "choice": True}, "override": True}
    a["damage"] = {"onSave": "none", "parts": []}
    cost(ci, a, 2, 2, "2 * " + CEMOD)
    apply(a, fx(ci, "curse", "Cursed Illusion", rounds=None,
                changes=[("flags.midi-qol.OverTime", 0, "turn=end, saveAbility=cha, saveDC=JJKORIGINDC, label=Cursed Illusion")],
                desc="Sees distorted faces; tracked up to 400 ft. At 6th: disadvantage on INT/WIS/CHA saves and loses concentration."))
    conf = act(ci, "confuse", "save", "First distorted face: INT or confused", "special", target=one_creature(),
               save=_sv("int"), damage={"onSave": "none", "parts": []})
    apply(conf, fx(ci, "conf", "Confused (distorted face)", rounds=2, special=["turnEnd"],
                   changes=[("flags.midi-qol.disadvantage.attack.all", 0, "1"), ("flags.midi-qol.disadvantage.ability.check.int", 0, "1"),
                            ("flags.midi-qol.disadvantage.ability.check.wis", 0, "1"), ("flags.midi-qol.disadvantage.ability.check.cha", 0, "1")]))
    free(ci, conf)
    note(ci, "At 6th: up to CE mod targets (scale 2 CE each).")
    mark(ci)

    sd = S.get("Self Distortion")
    a = sd["system"]["activities"]["yAE44QI4ejp7wB7M"]
    act(sd, "yAE44QI4ejp7wB7M", "attack", "Phase Fist (3 CE): phantom attack at disadvantage", "special",
        **_ce_melee(5, []))
    a = sd["system"]["activities"]["yAE44QI4ejp7wB7M"]
    a["attack"]["type"]["classification"] = "spell"
    a["activation"]["condition"] = "Phantom misses: real attack doubles damage dice on hit. Phantom hits: real attack at advantage."
    for key, nm, ch, rnd in [
        ("blur", "Blurring (3 CE)", [("flags.midi-qol.grants.disadvantage.attack.all", 0, "1")], 10),
        ("disguise", "Distorting Disguise (3 CE)", [], 600),
    ]:
        x = act(sd, key, "utility", nm, "action", range=RANGE_SELF, target=SELF)
        apply(x, fx(sd, key, nm.split(" (")[0], rounds=rnd, changes=ch,
                    desc="Lasts CE mod rounds (hours for the disguise); no effect on blindsight/truesight."))
        cost(sd, x, 3)
    mark(sd)

    od = S.get("Object Distortion")
    acts = od["system"]["activities"]
    acts["KvPOGDenY3iIN2OO"]["name"] = "Bump into invisible object: 1d6, lose reaction"
    acts["KvPOGDenY3iIN2OO"]["activation"]["type"] = "special"
    acts["KvPOGDenY3iIN2OO"]["target"] = one_creature()
    free(od, acts["KvPOGDenY3iIN2OO"])
    dist = act(od, "distort", "utility", "Distort object (1–10 CE by size)", "action", range=_r(60), target=SELF)
    cost(od, dist, 1, 1, "10")
    acts["VjvgH7c9gYQjon71"]["name"] = "Make it invisible (+3 CE)"
    note(od, "Tiny 1, Small 2, Medium 3, Large 4, Huge 6, Gargantuan 10 CE. Investigation vs your DC to discern.")
    mark(od)

    it = S.get("Illusive Terrain")
    a = it["system"]["activities"]["nEXujY3lN2V10UUJ"]
    a["range"], a["target"] = RANGE_SELF, sphere(150)
    a["target"]["affects"]["type"] = "enemy"
    apply(a, fx(it, "rough", "Illusive Terrain", rounds=10, changes=[("system.attributes.movement.all", 1, "0.5")],
                desc="Rough Ground: movement costs double. Obstructing Illusion: Investigation/Perception vs your DC."))
    mark(it)

    d = S.get("Domain Expansion: House of Mirrors")
    r = d["system"]["activities"]["YViYoxBURaJd434p"]
    r["name"] = "Redirect an attack (roll for new target)"
    r["useConditionText"] = 'reaction === "isAttacked"'
    r["roll"] = {"formula": "1d(max(2, @scaling))", "name": "Redirect (1 = still you)", "prompt": True, "visible": True}
    free(d, r)
    il = act(d, "init20", "save", "Initiative 20: illusion on everyone (CHA)", "special", save=_sv("cha"),
             damage={"onSave": "none", "parts": []}, target={"affects": {"type": "enemy", "choice": False}, "override": True})
    apply(il, fx(d, "ill", "House of Mirrors illusion", rounds=10, desc="Under an illusion of the caster's choice."))
    free(d, il)
    mark(d)

    m = S.get("Materialization")
    a = m["system"]["activities"]["buy7xLUGiVd5thGC"]
    act(m, "buy7xLUGiVd5thGC", "save", "Materialization (4 CE)", "action", save=_sv(["wis", "cha"]),
        damage={"onSave": "none", "parts": []}, range=_r(60), target=one_creature())
    apply(m["system"]["activities"]["buy7xLUGiVd5thGC"],
          fx(m, "real", "Face distorted (real)", rounds=None,
             changes=[("flags.midi-qol.disadvantage.ability.check.int", 0, "1"), ("flags.midi-qol.disadvantage.ability.check.wis", 0, "1"),
                      ("flags.midi-qol.disadvantage.ability.check.cha", 0, "1"), ("flags.midi-qol.disadvantage.ability.save.int", 0, "1"),
                      ("flags.midi-qol.disadvantage.ability.save.wis", 0, "1"), ("flags.midi-qol.disadvantage.ability.save.cha", 0, "1"),
                      ("flags.midi-qol.OverTime", 0, "turn=end, saveAbility=wis|cha, saveDC=JJKORIGINDC, label=Materialization")]))
    mark(m)


def inverse(S):
    iv = S.get("Inversion")
    a = iv["system"]["activities"]
    on = a["i2BRWdWmFvbiSpO7"]
    on["name"] = "Activate Inverse (2 CE, 1 minute)"
    on["range"], on["target"] = RANGE_SELF, SELF
    apply(on, fx(iv, "on", "Inverse", rounds=10,
                 desc="Threshold = prof × CE mod; limit = prof × CE score. Above threshold: take damage − threshold. "
                      "Below: take limit − damage (unchanged if negative). Apply by hand."))
    a["UWhXh7EE14xJwXs0"]["name"] = "Extend 1 minute (1 CE)"
    calc = act(iv, "calc", "utility", "Show threshold and limit", "special", range=RANGE_SELF, target=SELF,
               roll={"formula": f"@prof * {CEMOD}", "name": "Threshold (limit = prof × CE score)", "prompt": False, "visible": True})
    free(iv, calc)
    mark(iv)

    for nm, txt in [("Extreme Opposites", "Below threshold: vulnerable; above: resistant (even vs bypass)."),
                    ("Break the Strong", "Damaging save: advantage if the damage is above your threshold, disadvantage below.")]:
        x = S.get(nm)
        note(x, txt + " Resolve while Inverse is active.")
        mark(x)

    q = S.get("Quick Inversion")
    r = q["system"]["activities"]["PGfjGscigHI5RyTB"]
    r["name"] = "Activate/deactivate Inverse (reaction)"
    r["useConditionText"] = 'reaction === "isDamaged"'
    apply(r, fx(q, "on", "Inverse (quick)", rounds=10))
    cost(q, r, 2)
    note(q, "Extra Inverse-only reactions: ½ prof (prof at 18th).")
    mark(q)

    d = S.get("Domain Expansion: Synesthesia")
    x = d["system"]["activities"]["ne7CBK5oUp34sNnZ"]
    x["name"] = "Initiative 20: invert a sense (d4)"
    x["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    x["roll"] = {"formula": "1d4", "name": "Sense: 1 taste, 2 smell, 3 touch, 4 sight", "prompt": False, "visible": True}
    free(d, x)
    note(d, "Sight lost = blinded. CE check at end of its turn to recover. Inverse is free and unlimited in the domain.")
    mark(d)

    pi = S.get("Power Inversion")
    a = pi["system"]["activities"]
    a["2246Pp7cSYce93YC"]["range"], a["2246Pp7cSYce93YC"]["target"] = RANGE_SELF, SELF
    apply(a["2246Pp7cSYce93YC"], fx(pi, "on", "Power Inversion", rounds=20,
                                     desc="Your damage: above threshold → damage − threshold; below → + (limit − damage). Apply by hand."))
    a["qIib3E8DkVWEhv4W"]["name"] = "Extend 2 minutes (2 CE)"
    mark(pi)


def laplaces_demon(S):
    di = S.get("Demonic Intellect")
    di["effects"] = [e for e in di["effects"] if e["_id"] != "aawCcIgVjHchOkj0"]
    a = di["system"]["activities"]["d6TJzaH1XAfXpiJ0"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(di, "oc", "Overclocked", rounds=10,
                changes=[("flags.midi-qol.advantage.ability.check.int", 0, "1"), ("system.attributes.ac.bonus", 2, "+ @abilities.int.mod"),
                         ("system.abilities.dex.bonuses.save", 2, "+ @abilities.int.mod")],
                desc="Advantage on INT checks, +INT to AC and DEX saves; 2 CE: take an action as a reaction."))
    re_ = act(di, "react", "utility", "Action as a reaction (2 CE)", "reaction", range=RANGE_SELF, target=SELF)
    cost(di, re_, 2)
    mark(di)

    fp = S.get("Future and Past")
    a = fp["system"]["activities"]
    fp["system"]["uses"] = {"max": "3", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    roll = act(fp, "foretell", "utility", "Long rest: roll two foretelling d20s", "special", range=RANGE_SELF, target=SELF,
               roll={"formula": "2d20", "name": "Foretelling rolls (record both)", "prompt": False, "visible": True})
    free(fp, roll)
    use = a["hSZWONcn4CVabFLO"]
    use["name"] = "Replace a roll with a foretelling (1 CE)"
    use["useConditionText"] = 'reaction === "isAttacked" || reaction === "isSave"'
    use.setdefault("consumption", {"targets": [], "scaling": {"allowed": False}})["targets"].append(
        {"type": "itemUses", "target": "", "value": "1", "scaling": {}})
    a["5jJZwQ04W30INTzj"]["name"] = "Short rest: gain a foretelling roll (1 CE)"
    a["5jJZwQ04W30INTzj"]["activation"]["type"] = "special"
    a["5jJZwQ04W30INTzj"]["roll"] = {"formula": "1d20", "name": "Foretelling", "prompt": False, "visible": True}
    note(fp, "Uses track foretelling rolls (2 per long rest + 1 from a short rest). Declare before the roll.")
    mark(fp)

    ov = S.get("Overload")
    a = ov["system"]["activities"]["tS0tCzG54ZOcmyBA"]
    a["range"], a["target"] = _r(5), one_creature()
    a["damage"]["onSave"] = "half"
    for e in ov["effects"]:
        if e["_id"] == "N3FOtjwNCSdvcau5": e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnEnd"]
    mark(ov)

    im = S.get("Imaginary Demon Brain")
    a = im["system"]["activities"]["OrQWkPQeSEHnEua1"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(im, "brain", "Imaginary Demon Brain", rounds=600,
                changes=[("flags.midi-qol.advantage.all", 0, "1"), ("flags.midi-qol.grants.disadvantage.attack.all", 0, "1")],
                desc="All your rolls at advantage, rolls against you at disadvantage (attacks automated)."))
    add = act(im, "add", "utility", "Add INT to a roll (reaction, 15 ft)", "reaction", range=_r(15), target=one_creature(),
              roll={"formula": "@abilities.int.mod", "name": "Add to the roll", "prompt": False, "visible": True})
    free(im, add)
    mark(im)

    d = S.get("Domain Expansion: Laplace Threshold")
    x = act(d, "init20", "utility", "Initiative 20: −2 to all rolls vs you (stacks)", "special",
            target={"affects": {"type": "enemy", "choice": True}, "override": True})
    apply(x, fx(d, "pen", "Laplace Threshold −2", rounds=10,
                changes=[("system.bonuses.mwak.attack", 2, "-2"), ("system.bonuses.rwak.attack", 2, "-2"),
                         ("system.bonuses.msak.attack", 2, "-2"), ("system.bonuses.rsak.attack", 2, "-2"),
                         ("system.bonuses.abilities.save", 2, "-2"),
                         ("system.bonuses.abilities.check", 2, "-2")],
                desc="−2 per application (stacks each initiative 20). Applies to all its rolls here — the RAW limits it to rolls against you."))
    free(d, x)
    note(d, "You know HP, CE, effects and defences of everyone inside; invisibility and hiding give no advantage against you.")
    mark(d)

    bf = S.get("Butterfly Effect")
    b = bf["system"]["activities"]["GQncrWbMc9ZWG4DP"]
    b["name"] = "Replace another creature's roll with a foretelling (2 CE)"
    b["target"] = one_creature()
    b["range"] = _r(60)
    cost(bf, b, 2)
    fail = act(bf, "fail", "utility", "It failed: disadvantage until end of its next turn", "special", target=one_creature())
    apply(fail, fx(bf, "fail", "Butterfly (failed)", rounds=2, special=["turnEnd"],
                   changes=[("flags.midi-qol.disadvantage.all", 0, "1")]))
    free(bf, fail)
    ok = act(bf, "ok", "utility", "It succeeded: advantage until end of its next turn", "special", target=one_creature())
    apply(ok, fx(bf, "ok", "Butterfly (succeeded)", rounds=2, special=["turnEnd"], changes=[("flags.midi-qol.advantage.all", 0, "1")]))
    free(bf, ok)
    mark(bf)

    ct = S.get("Chaos Theory")
    a = ct["system"]["activities"]["Ovo9aSb2P8IrfR9F"]
    a["range"], a["target"] = RANGE_SELF, SELF
    a["useConditionText"] = "false"
    apply(a, fx(ct, "chaos", "Chaos Theory", rounds=20,
                changes=[("system.bonuses.mwak.attack", 2, "+ @abilities.int.mod"), ("system.bonuses.rwak.attack", 2, "+ @abilities.int.mod"),
                         ("system.bonuses.msak.attack", 2, "+ @abilities.int.mod"), ("system.bonuses.rsak.attack", 2, "+ @abilities.int.mod")],
                desc="Targets' AC −INT (as +INT to hit); advantage after a miss vs that creature; d4 forced bonus action each turn."))
    d4 = act(ct, "d4", "utility", "Start of turn: chaos d4", "special", range=RANGE_SELF, target=SELF,
             roll={"formula": "1d4", "name": "1 Hide · 2 Disengage · 3 Dash · 4 one melee attack", "prompt": False, "visible": True})
    free(ct, d4)
    mark(ct)


def limitless(S):
    inf = S.get("Infinity")
    a = inf["system"]["activities"]
    on = a["57UvuIahfVf5dojK"]
    on["name"] = "Activate Infinity (1 CE, +1 CE per turn)"
    on["range"], on["target"] = RANGE_SELF, SELF
    apply(on, fx(inf, "on", "Infinity", rounds=None, desc="Each attack/spell/save from outside: d6 roll (4+ / 3+ at 6th / 2+ at 11th) to negate."))
    chk = act(inf, "roll", "utility", "Infinity roll (d6)", "special", range=RANGE_SELF, target=SELF,
              roll={"formula": "1d6", "name": "Infinity (≥ 4 / 3 / 2 negates)", "prompt": False, "visible": True})
    chk["useConditionText"] = 'reaction === "isAttacked" || reaction === "isSave"'
    free(inf, chk)
    a["5U2nqwCaRX6vM4sS"]["name"] = "Upkeep / auto-6 (1 CE)"
    a["5U2nqwCaRX6vM4sS"]["activation"]["type"] = "special"
    r = a["bnixF7T8xqXctZ5h"]
    r["name"] = "Auto-6 for the round / reactive Infinity (2 CE, 11th)"
    r["useConditionText"] = 'reaction === "isAttacked"'
    note(inf, "Dodge with Infinity: advantage on the d6 and share it within reach. No effect vs poison or unseen attacks before 6th.")
    mark(inf)

    lb = S.get("Lapse Blue")
    a = lb["system"]["activities"]["0XCLedJf9yzGwtvr"]
    a["name"] = "Lapse Blue (1+ CE): 5-ft pull radius per CE"
    a["range"], a["target"] = _r(30), sphere(5)
    a["damage"] = {"onSave": "half", "parts": [dice(2, 8, ["force"]), dice(1, 8, ["force"], scale=1)]}
    cost(lb, a, 1, 1, CEMOD)
    for e in lb["effects"]:
        if e["_id"] == "YaBVmd9NLkY17soF": e["statuses"] = ["grappled"]; e["name"] = "Grappled (Lapse Blue)"
    mv = act(lb, "move", "utility", "Maximum Output: move the sphere 30 ft", "bonus", range=RANGE_SELF, target=SELF)
    free(lb, mv)
    note(lb, "5+ CE: Maximum Output (concentration, 1 minute; save at turn start inside). At 11th: fail by 5+ = max damage and restrained.")
    mark(lb)

    tp = S.get("Teleportation")
    a = tp["system"]["activities"]["JwvU7XUNyvApOkhe"]
    a["name"] = "Teleport (10 ft per CE; ×2 for another creature)"
    a["range"], a["target"] = _r(5), SELF
    cost(tp, a, 1, 1, CEMOD)
    circ = act(tp, "circle", "utility", "Teleport to a prepared circle (5 CE)", "action", range=_r(5), target=one_creature())
    cost(tp, circ, 5)
    mark(tp)

    oi = S.get("Offensive Infinity")
    a = oi["system"]["activities"]["080Ss5xCYIYFDac7"]
    a["name"] = "Repel (CE up to mod): 10-ft burst, 2d8 per CE"
    a["range"], a["target"] = RANGE_SELF, sphere(10)
    a["target"]["affects"]["type"] = "enemy"
    a["damage"] = {"onSave": "half", "parts": [dice(2, 8, ["force"], scale=2)]}
    a["effects"] = []
    cost(oi, a, 1, 1, CEMOD)
    crush = act(oi, "crush", "save", "Crush against a wall (CE up to mod): 3d8 per CE", "action", save=_sv("str"),
                damage={"onSave": "half", "parts": [dice(3, 8, ["force"], scale=3)]}, range=_r(5), target=one_creature())
    apply(crush, "5qH2Hjd2KG8siwpn")
    for e in oi["effects"]:
        if e["_id"] == "5qH2Hjd2KG8siwpn":
            e["changes"] = []
            e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnStartSource"]
    cost(oi, crush, 1, 1, CEMOD)
    mark(oi)

    d = S.get("Domain Expansion: Unlimited Void")
    a = d["system"]["activities"]["YFTe31UdxKjUNspy"]
    a["name"] = "Initiative 20: Unlimited Void (INT)"
    a["target"] = {"affects": {"type": "enemy", "choice": False}, "override": True}
    a["damage"]["onSave"] = "none"
    for e in d["effects"]:
        if e["_id"] == "v6mp8UNvQDEABiC3":
            e["duration"] = {"rounds": 10}
            e["changes"] = [{"key": "system.abilities.int.value", "mode": 5, "value": "1", "priority": 30},
                            {"key": "system.abilities.wis.value", "mode": 5, "value": "1", "priority": 30},
                            {"key": "system.abilities.cha.value", "mode": 5, "value": "1", "priority": 30}]
    free(d, a)
    note(d, "Repeat the save every minute; Greater Restoration or Wish ends it. Creatures touching you are excluded.")
    mark(d)

    rr = S.get("Reversal Red")
    a = rr["system"]["activities"]["douy3a4rcRjk6FVc"]
    a["range"] = RANGE_SELF
    a["target"] = sphere("15 + 15 * floor(min(@details.level, 11) / 11)", kind="cone")
    a["damage"] = {"onSave": "half", "parts": [dice(4, 8, ["force"]), dice(2, 8, ["force"], scale=2)]}
    cost(rr, a, 2, 2, "2 * " + CEMOD)
    rr["system"]["activities"]["ZiuBeW7MdsFDONgb"]["name"] = "Impact: remaining launch distance as falling damage + prone"
    note(rr, "Launched 20 ft per 2 CE (half on save).")
    mark(rr)


def _pool(item, mx, recover=None):
    item["system"]["uses"] = {"max": str(mx), "spent": 0, "recovery": recover or []}


def _spend(a, n=1):
    a.setdefault("consumption", {"targets": [], "scaling": {"allowed": False}})
    a["consumption"].setdefault("targets", [])
    a["consumption"]["targets"] = [t for t in a["consumption"]["targets"] if t.get("type") != "itemUses"]


def _spend_from(a, item_name, n=1):
    _spend(a)
    a["consumption"]["targets"].append({"type": "itemUses", "target": "", "value": str(n), "scaling": {},
                                        "_jjkPool": item_name})


STARS = ["Imai", "Acrux", "Mimosa", "Ginan", "Gacrux"]


def love_rendezvous(S):
    lr = S.get("Love Rendezvous")
    lr["system"]["activities"] = {}
    for st in STARS:
        a = act(lr, f"star{st.lower()}", "utility", f"Mark ★{st} (1 CE, touch or unarmed hit)", "special", range=_r(5), target=one_creature())
        apply(a, fx(lr, st.lower(), f"★{st}", rounds=None,
                    desc=f"Marked with ★{st} (order Imai → Acrux → Mimosa → Ginan → Gacrux). Must touch the next star in order before approaching others."))
        cost(lr, a, 1)
    col = act(lr, "collide", "damage", "Star collision (2 dice per 10 ft)", "special", target=one_creature(),
              damage={"parts": [dice(2, 6, ["bludgeoning"], scale=2)]})
    free(lr, col)
    note(lr, "Marks per star = CE mod (2× at 11th). Collision die by size: edit (d6 assumed). Scale +1 per extra 10 ft.")
    mark(lr)

    em = S.get("Effective Marking")
    r = em["system"]["activities"]["No9KmbGtcneLQgGi"]
    r["name"] = "Mark as a reaction (+CE mod extra mark-only reactions)"
    r["useConditionText"] = "false"
    mark(em)
    g = S.get("Gravity")
    note(g, "Collision damage ignores bludgeoning resistance; force at 11th; ignores force resistance at 18th (change the collision damage type).")
    mark(g)
    ss = S.get("Shining Stars")
    note(ss, "Marks per star: 2 × CE mod.")
    mark(ss)
    d = S.get("Domain Expansion: Star Crossed Lovers")
    a = d["system"]["activities"]["ufGCwUODQvDzJ5Dm"]
    a["name"] = "Pull a marked creature 30 ft toward another (guaranteed hit)"
    a["target"] = one_creature()
    free(d, a)
    note(d, "Initiative 20: mark any creatures with your stars (use the mark activities, free).")
    mark(d)
    hs = S.get("Hate Separation")
    a = hs["system"]["activities"]["IAWf5c0GzZEGGzyy"]
    a["name"] = "Invert to Hate Separation (2 CE)"
    a["activation"]["type"] = "special"
    rep = act(hs, "repel", "damage", "Repelled impact on lowest-CE creature (2 dice per 10 ft)", "special", target=one_creature(),
              damage={"parts": [dice(2, 6, ["bludgeoning"], scale=2)]})
    free(hs, rep)
    note(hs, "Reverse order; crashing objects/creatures take half.")
    mark(hs)


def miracle(S):
    lm = S.get("Little Miracles")
    _pool(lm, 6)
    lm["system"]["activities"] = {}
    g = act(lm, "gain", "utility", "Gain Miracles (witnessed fortune)", "special", range=RANGE_SELF, target=SELF)
    g["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "-(1 + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))", "scaling": {}}],
                        "scaling": {"allowed": False}}
    note(lm, "Item uses = Miracles held (max 6). Other Miracle features spend from here: lower the uses by hand when they say 'spend a Miracle'.")
    lm["system"]["uses"]["spent"] = 6
    mark(lm)

    bl = S.get("Blind Luck")
    a = bl["system"]["activities"]["7I2bFGdGpPZaTmFh"]
    act(bl, "7I2bFGdGpPZaTmFh", "heal", "Blind Luck (Miracle): reduce damage CE-mod d4 + prof", "special", range=RANGE_SELF, target=SELF,
        healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                 "custom": {"enabled": True, "formula": f"({CEMOD})d4 + @prof"}, "scaling": {}})
    bl["system"]["activities"]["7I2bFGdGpPZaTmFh"]["useConditionText"] = 'reaction === "isDamaged"'
    free(bl, bl["system"]["activities"]["7I2bFGdGpPZaTmFh"])
    rx = act(bl, "react", "heal", "Blind Luck reaction (Miracle + 1 CE): d6s + 2× prof", "reaction", range=RANGE_SELF, target=SELF,
             healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                      "custom": {"enabled": True, "formula": f"({CEMOD})d6 + 2 * @prof"}, "scaling": {}})
    rx["useConditionText"] = 'reaction === "isDamaged"'
    cost(bl, rx, 1)
    note(bl, "Reduction applied as temp HP. Spend the Miracle on Little Miracles.")
    mark(bl)

    mo = S.get("Miraculous Outcome")
    a = mo["system"]["activities"]["4aEwGySubtb2WGSz"]
    a["name"] = "Add a die to a failed roll (Miracle + 1 CE)"
    a["useConditionText"] = 'reaction === "isSave"'
    a["roll"] = {"formula": "1d(6 + 2 * floor(min(@details.level, 6) / 6) + 2 * floor(min(@details.level, 11) / 11))", "name": "Miraculous Outcome", "prompt": False, "visible": True}
    cost(mo, a, 1)
    mark(mo)

    dm = S.get("Deadly Miracle")
    x = act(dm, "save", "utility", "Survive by a miracle (2 Miracles + 2 CE)", "reaction", range=RANGE_SELF, target=SELF)
    x["useConditionText"] = 'reaction === "isDamaged" || reaction === "isSave"'
    cost(dm, x, 2)
    dm.setdefault("effects", [])
    eid = fx(dm, "death", "Deadly Miracle (death saves)", rounds=None, changes=[("flags.midi-qol.advantage.deathSave", 0, "1")],
             desc="Advantage on death saves while you have at least 1 Miracle.")
    for e in dm["effects"]:
        if e["_id"] == eid: e["transfer"], e["disabled"], e["duration"] = True, False, {}
    note(dm, "Lethal hit or failed save: succeed / take no damage. At 11th: also vs anything dropping you to half HP or less.")
    mark(dm)

    ff = S.get("Fated for Fortune")
    note(ff, "Miraculous Outcome total of 20+ counts as a natural 20 (no Black Flash, no Miracle).")
    mark(ff)

    d = S.get("Domain Expansion: Luck of the Draw")
    r = act(d, "cost", "utility", "Domain cost (2d20 CE) and duration (1d4 min)", "special", range=RANGE_SELF, target=SELF,
            roll={"formula": "2d20", "name": "Domain CE cost (then roll 1d4 minutes)", "prompt": False, "visible": True})
    free(d, r)
    i = act(d, "init20", "utility", "Initiative 20: gain 3 Miracles", "special", range=RANGE_SELF, target=SELF)
    free(d, i)
    note(d, "Expansion activity charges 20 CE: refund/adjust to the 2d20 roll. No Miracle cap inside; spend a Miracle to give an attack/technique a guaranteed hit.")
    mark(d)

    c = S.get("Calamity")
    _pool(c, 6)
    c["system"]["uses"]["spent"] = 6
    a = c["system"]["activities"]["tapxN4JtczFg5XZk"]
    a["name"] = "Spend a Calamity Mark (reaction to a success)"
    a["useConditionText"] = "false"
    a.setdefault("consumption", {"targets": [], "scaling": {"allowed": False}})["targets"].append({"type": "itemUses", "target": "", "value": "1", "scaling": {}})
    cost(c, a, 2)
    gain = act(c, "gain", "utility", "Gain a Calamity Mark", "special", range=RANGE_SELF, target=SELF)
    gain["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "-1", "scaling": {}}], "scaling": {"allowed": False}}
    note(c, "Item uses = Calamity Marks held (max 6).")
    mark(c)


MF_DIE = [[1, "1d8"], [6, "2d8"], [11, "3d8"], [18, "4d8"]]


def missile_fist(S):
    mi = S.get("Missile Impact")
    a = mi["system"]["activities"]["euBB1jHwDj5pSPJe"]
    a["name"] = "Missile Fist (1 CE activates for the turn)"
    a["range"] = {"value": "20 + 10 * floor(min(@details.level, 3) / 3) + 20 * (floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))", "units": "ft", "override": True}
    a["target"] = one_creature()
    a.setdefault("attack", {})["ability"] = "spellcasting"
    a["damage"] = {"includeBase": False, "parts": [dice(1, 8, ["necrotic"], bonus=CEMOD)]}
    scale(mi, a, MF_DIE)
    more = act(mi, "more", "attack", "Missile Fist (replaces an attack, free)", "special", range=dict(a["range"]), target=one_creature(),
               attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False, "type": {"value": "ranged", "classification": "spell"}},
               damage={"includeBase": False, "parts": [dice(1, 8, ["necrotic"], bonus=CEMOD)]})
    scale(mi, more, MF_DIE)
    free(mi, more)
    mark(mi)

    db = S.get("Devastating Barrage")
    b = db["system"]["activities"]["GXrlPFNMcRUpwl4V"]
    b["type"] = "utility"
    b.pop("damage", None)
    b["name"] = "Extra Missile Fists (1 CE each, up to CE mod)"
    cost(db, b, 1, 1, CEMOD)
    for key, nm, st in [("grap", "Grab instead of damage (grappled)", "grappled"), ("rest", "Grab a grappled target (restrained)", "restrained")]:
        x = act(db, key, "utility", nm, "special", target=one_creature())
        e = fx(db, key, nm.split("(")[1].rstrip(")").title() + " (Missile Fist)", rounds=10, statuses=[st])
        ot_save(db, e, "str", "Missile Fist grip", when="end")
        apply(x, e)
        free(db, x)
    mark(db)

    uf = S.get("Unrelenting Fury")
    a = uf["system"]["activities"]["hfrVz0zJOTUV1Y4k"]
    a["range"], a["target"] = RANGE_SELF, sphere(30, kind="cone")
    a["damage"]["onSave"] = "half"
    mark(uf)

    bb = S.get("Maximum: Brutal Bombardment")
    acts = bb["system"]["activities"]
    w = acts["hEA4OYlwEM5hHr1X"]
    w["name"] = "Brutal Bombardment (full turn, 6 CE): main target"
    w["activation"]["type"] = "action"
    w["range"], w["target"] = _r(50), one_creature()
    w["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": 8, "bonus": "", "types": ["necrotic"],
                   "custom": {"enabled": True, "formula": "(3 + 3 * (1 + floor(min(@details.level, 5) / 5)))d8"}, "scaling": {}},
                   dice(4, 10, ["bludgeoning"])]}
    w["effects"] = [{"_id": "D9tvLXURflWQbQ4u", "onSave": False}]
    sp = acts["S2O4IOTQtshbOEC8"]
    sp["name"] = "Splash: creatures near the target (STR)"
    sp["activation"]["type"] = "special"
    sp["target"] = sphere(5)
    sp["damage"] = {"onSave": "half", "parts": [dice(3, 8, ["necrotic"], scale=3)]}
    free(bb, sp)
    note(bb, "Main necrotic assumes attacks per action = 1 (+1 with Extra Attack at 5th). +3d8 per extra CE (scale). "
             "Bludgeoning only on a failed save (Midi halves it: remove on success).")
    mark(bb)

    d = S.get("Domain Expansion: Unrelenting Ring of Spirit")
    i = d["system"]["activities"]["X6fdmYkZ2CvQvSg4"]
    i["target"] = {"affects": {"type": "enemy", "choice": False}, "override": True}
    apply(i, fx(d, "prone", "Prone (Ring of Spirit)", statuses=["prone"]))
    free(d, i)
    f = d["system"]["activities"]["zoIOpZsM7t1RRZBD"]
    act(d, "zoIOpZsM7t1RRZBD", "attack", "Free Missile Fist anywhere in the domain", "action", target=one_creature(),
        attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False, "type": {"value": "ranged", "classification": "spell"}},
        damage={"includeBase": False, "parts": [dice(4, 8, ["necrotic"], bonus=CEMOD)]})
    free(d, d["system"]["activities"]["zoIOpZsM7t1RRZBD"])
    mark(d)

    la = S.get("Leg Aegis")
    a = la["system"]["activities"]["FvH5I4W3ZUZWcWcO"]
    act(la, "FvH5I4W3ZUZWcWcO", "heal", "Leg Aegis (CE up to 2× mod): 10 HP per CE", "reaction", range=RANGE_SELF, target=SELF,
        healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                 "custom": {"enabled": True, "formula": "10 * @scaling"}, "scaling": {}})
    a = la["system"]["activities"]["FvH5I4W3ZUZWcWcO"]
    a["useConditionText"] = 'reaction === "isAttacked"'
    cost(la, a, 1, 1, "2 * " + CEMOD)
    note(la, "Absorption as temp HP until the start of your next turn (remove the rest then). Leg AC = your CE DC.")
    mark(la)


def moon_dregs(S):
    lj = S.get("Lunar Jellyfish")
    a = lj["system"]["activities"]
    a["dq2jkz88K1ENjer5"]["name"] = "Summon Moon Dregs (5 CE)"
    a["6EhaTiNh5i430gxE"]["name"] = "Summon Moon Dregs (free, 1 per long rest)"
    size = act(lj, "size", "utility", "Resize Moon Dregs (1 CE)", "action", range=_r(60), target=SELF)
    cost(lj, size, 1)
    note(lj, "Drag the Moon Dregs actor; it Dodges unless commanded (bonus action). Destroyed: 1 minute before resummoning.")
    mark(lj)

    pc = S.get("Poisonous Cursed Energy")
    a = pc["system"]["activities"]["NmXVtv6gLY8sVL2e"]
    a["name"] = "Poisonous hit (1 CE, once per turn)"
    a["activation"]["type"] = "special"
    a["useConditionText"] = 'reaction === "isHit"'
    a["target"] = one_creature()
    a["damage"]["critical"] = {"allow": False}
    scale(pc, a, [[1, "2d6"], [6, "4d6"], [11, "6d8"], [18, "6d10"]])
    mark(pc)

    npz = S.get("Noxious Poison")
    a = npz["system"]["activities"]["JAkRy5x5J986g5i9"]
    a["name"] = "Noxious: CON or poisoned (with the poisonous hit)"
    a["target"] = one_creature()
    a["damage"] = {"onSave": "none", "parts": []}
    for e in npz["effects"]:
        if e["_id"] == "F1BV5oRL0dTPPjSw":
            e["duration"] = {"rounds": 10}
            e["changes"].append({"key": "system.attributes.exhaustion", "mode": 2, "value": "1", "priority": 20})
    free(npz, a)
    note(npz, "Moon Dregs: 2 attacks; ¾ cover while in a creature's space (full at 11th).")
    mark(npz)

    cp = S.get("Cleansing of Purity")
    note(cp, "Edit the Moon Dregs actor: +CE mod to AC, STR, DEX, CON; 3 attacks.")
    mark(cp)

    d = S.get("Domain Expansion: Liberation Rite of Water and Land")
    a = d["system"]["activities"]["8r4a3xWzf8AvZK3J"]
    a["name"] = "Command the tiny jellyfish (guaranteed hits)"
    burst = act(d, "init20", "damage", "Initiative 20: 8d6 poison/acid", "special",
                damage={"parts": [dice(8, 6, ["poison", "acid"])]}, target={"affects": {"type": "enemy", "choice": False}, "override": True})
    free(d, burst)
    note(d, "Difficult terrain without swim speed. Jellyfish: CE mod of them, 30 HP, 1 attack each, count as Moon Dregs.")
    mark(d)

    sj = S.get("Solar Jellyfish")
    a = sj["system"]["activities"]["atOXd8RilzAdWkxZ"]
    a["name"] = "Summon Sun Dregs (10 CE)"
    note(sj, "Not alongside Moon Dregs before 18th. 2 attacks at 6th. Destroyed: 2 minutes before resummoning.")
    mark(sj)

    av = S.get("Anti-Venom Cursed Energy")
    a = av["system"]["activities"]["vFnZHPwvVYSItiHa"]
    a["name"] = "Sun Dregs radiant hit (2 CE): +4d6"
    a["activation"]["type"] = "special"
    a["useConditionText"] = 'reaction === "isHit"'
    a["target"] = one_creature()
    mark(av)


EE_TIERS = [[1, "1d10"], [3, "2d10"], [6, "3d10"], [11, "4d10"], [14, "5d10"], [18, "6d10"]]
AMBER = [(1, 2, 20, 10, "1"), (2, 3, 40, 15, "2"), (3, 4, 60, 20, "3"), (4, 5, 80, 25, "4"), (5, 6, 100, 30, "6")]


def mythical_beast_amber(S):
    ee = S.get("Electric Energy")
    a = ee["system"]["activities"]["RTkzKBIlRPkP4yDy"]
    a["name"] = "Electric Energy (on melee damage, 1 CE)"
    a["activation"]["type"] = "special"
    a["useConditionText"] = 'reaction === "isHit"'
    a["target"] = one_creature()
    scale(ee, a, EE_TIERS)
    mark(ee)

    lb = S.get("Lightning Body")
    lb.setdefault("effects", [])
    e = fx(lb, "init", "Lightning Body", rounds=None, changes=[("system.attributes.init.bonus", 2, "+ " + CEMOD)])
    for x in lb["effects"]:
        if x["_id"] == e: x["transfer"], x["disabled"], x["duration"] = True, False, {}
    mark(lb)

    ld = S.get("Lightning Discharge")
    mk = act(ld, "mark", "utility", "Positive charge (on Electric Energy hit)", "special", target=one_creature())
    apply(mk, fx(ld, "charge", "Positive charge", rounds=10, desc="One charge (stack one effect per charge, max 2 × CE mod)."))
    free(ld, mk)
    bolt = ld["system"]["activities"]["ixdRf2qdEBTsV0aX"]
    act(ld, "ixdRf2qdEBTsV0aX", "damage", "Discharge bolt (1d12 per charge)", "action", range=_r(60), target=one_creature(),
        damage={"parts": [dice(1, 12, ["lightning"], scale=1)]})
    note(ld, "Scale = charges spent − 1; remove the charge effects. At 11th: roll on the Limb Damage table.")
    mark(ld)

    r = S.get("Mythical Beast Amber Release")
    acts = r["system"]["activities"]
    acts["KCuyWY0C4k6wvr81"]["name"] = "Release (8 CE): enter Stage 1"
    acts["KCuyWY0C4k6wvr81"]["range"], acts["KCuyWY0C4k6wvr81"]["target"] = RANGE_SELF, SELF
    for st, ab, spd, dc, exh in AMBER:
        ch = [("system.abilities.str.value", 2, f"+{ab}"), ("system.abilities.dex.value", 2, f"+{ab}"),
              ("system.abilities.con.value", 2, f"+{ab}"), ("system.traits.di.value", 2, "lightning"),
              ("system.attributes.movement.walk", 2, f"+{spd}"),
              ("system.bonuses.mwak.damage", 2, "+ 1d10[lightning]")]
        if st >= 3: ch.append(("system.traits.dm.amount.all", 2, "-" + CEMOD))
        if st >= 4: ch.append(("system.attributes.senses.truesight", 4, "120"))
        eid = fx(r, f"s{st}", f"Amber Stage {st}", rounds=None, changes=ch,
                 desc=f"Stage {st}. Deactivation: DC {dc} CON or {exh} exhaustion levels.")
        if st == 1:
            acts["KCuyWY0C4k6wvr81"]["effects"] = [{"_id": eid, "onSave": False}]
        else:
            x = act(r, f"stage{st}", "utility", f"Advance to Stage {st}", "special", range=RANGE_SELF, target=SELF)
            apply(x, eid)
            free(r, x)
        off = act(r, f"off{st}", "save", f"Deactivate at Stage {st} (DC {dc} CON)", "bonus", range=RANGE_SELF, target=SELF,
                  save={"ability": ["con"], "dc": {"calculation": "", "formula": str(dc)}}, damage={"onSave": "none", "parts": []})
        apply(off, fx(r, f"exh{st}", f"Amber backlash (Stage {st})", rounds=None, changes=[("system.attributes.exhaustion", 2, exh)]))
        free(r, off)
    fast = act(r, "fast", "utility", "Expedite: 1 round per 2 CE", "bonus", range=RANGE_SELF, target=SELF)
    cost(r, fast, 2, 2, "40")
    blast = acts["v32k7Qixy55vE2b9"]
    blast["name"] = "Loud Blast area (Stage 2+): 6d6 thunder + deafened"
    blast["target"] = sphere(15)
    blast["damage"] = {"onSave": "half", "parts": [dice(6, 6, ["thunder"])]}
    free(r, blast)
    lbh = act(r, "loud", "attack", "Loud Blast (Stage 2+): 6d10 lightning", "action", range=_r(30), target=one_creature(),
              attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False, "type": {"value": "ranged", "classification": "spell"}},
              damage={"includeBase": False, "parts": [dice(6, 10, ["lightning"])]})
    free(r, lbh)
    trigger(lbh, blast, "self")
    beam = acts["mF6qqggdpt7QB4d9"]
    beam["name"] = "Cursed Beam (Stage 5, 6 CE): 30-ft line"
    beam["target"] = {"template": {"type": "line", "size": "30", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                      "affects": {"type": "creature", "choice": False}, "override": True}
    beam["damage"]["onSave"] = "half"
    for x in r["effects"]:
        if x["_id"] in ("JQ0jRF3WMJOTT4wI", "WcnbOol0bc0uwQhM"):
            x.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnStartSource"]
    acts["uigNdvV8c7WRvFkn"]["name"] = "Cursed Claw extra (legacy)"
    r["system"]["activities"].pop("uigNdvV8c7WRvFkn", None)
    note(r, "Each stage lasts 5 rounds; after 5 rounds in Stage 5 you die. Remove the previous stage's effect when advancing. "
            "Extra attacks/actions per stage: track by hand. Usable once in your life.")
    mark(r)

    ms = S.get("Mythical Beast Suppression")
    a = ms["system"]["activities"]["4X6RNuHFao1ebYqd"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(ms, "rev", "Reversing Amber", rounds=None, desc="Concentration; wait as long as the Release lasted to end it safely."))
    mark(ms)

    d = S.get("Domain Expansion: Lightning God’s Realm")
    x = act(d, "init20", "utility", "Initiative 20: 3 positive charges on all", "special",
            target={"affects": {"type": "enemy", "choice": False}, "override": True})
    apply(x, fx(d, "ch", "Positive charges ×3", rounds=10, desc="3 charges (no limit inside the domain)."))
    free(d, x)
    mark(d)


def new_shadow_style(S):
    sd = S.get("New Shadow Style: Simple Domain")
    sd["system"]["uses"] = {"max": "@prof", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    a = sd["system"]["activities"]["7e9fHJhPwYm4YhHv"]
    a["name"] = "Simple Domain (free use, bonus action, 15 ft)"
    a["range"], a["target"] = RANGE_SELF, sphere(15)
    a.setdefault("consumption", {"targets": [], "scaling": {"allowed": False}})["targets"] = [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}]
    apply(a, fx(sd, "sd", "Simple Domain", rounds=10, desc="Simple Domain active (15 ft): see the Simple Domain feat for its effects."))
    mark(sd)

    bt = S.get("Batto Sword Draw")
    a = bt["system"]["activities"]["zwBY4gywJIbOJGXk"]
    a["name"] = "Batto (3 CE): one attack vs up to prof targets, advantage"
    a["range"] = {"value": "floor(@attributes.movement.walk / 2)", "units": "ft", "override": True}
    a["target"] = {"affects": {"type": "creature", "count": "@prof", "choice": True}, "override": True}
    a.setdefault("attack", {})["ability"] = ""
    a["attack"].setdefault("type", {})["value"] = "melee"
    a["attack"]["type"]["classification"] = "weapon"
    a["damage"] = {"includeBase": True, "parts": []}
    apply(a, fx(bt, "adv", "Batto stance", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.advantage.attack.all", 0, "1")]))
    note(bt, "Uses your weapon damage (attack from the weapon if Midi can't read it here). End your turn behind the farthest target, no OAs.")
    mark(bt)

    ev = S.get("Evening Moon Sword Drawing")
    o = act(ev, "draw", "utility", "Interception draw (creature crosses your Simple Domain)", "reaction", range=_r(15), target=one_creature())
    o["useConditionText"] = "false"
    free(ev, o)
    dmg = act(ev, "dmg", "damage", "On hit: +1 weapon die per CE", "special", target=one_creature(),
              damage={"parts": [dice(1, 8, ["slashing"], scale=1)]})
    cost(ev, dmg, 1, 1, CEMOD)
    dfn = act(ev, "def", "utility", "On hit: +AC/saves per CE until your turn", "special", range=RANGE_SELF, target=SELF)
    apply(dfn, fx(ev, "def", "Evening Moon guard", special=["turnStartSource"],
                  changes=[("system.attributes.ac.bonus", 2, "+ @scaling"), ("system.bonuses.abilities.save", 2, "+ @scaling")]))
    cost(ev, dfn, 1, 1, CEMOD)
    note(ev, "Once per round per creature. Die shown as d8: use your weapon's.")
    mark(ev)

    mv = S.get("Moonlight Veil")
    a = mv["system"]["activities"]["ySn9I0P30nQZ2e2n"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(mv, "veil", "Moonlight Veil", rounds=10,
                changes=[("system.bonuses.mwak.attack", 2, "+ " + CEMOD), ("system.bonuses.mwak.damage", 2, "+ " + CEMOD)],
                desc="+CE mod to melee weapon/unarmed attack and damage; broken weapons work normally."))
    mark(mv)

    pf = S.get("Perfect Shadow Style")
    pf["system"]["uses"] = {"max": "@prof", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    a = pf["system"]["activities"]["GvyKyWKjmfVvOBOC"]
    a["name"] = "Extend techniques to 60 ft (bonus action)"
    two = act(pf, "two", "utility", "Two free weapon attacks (prof per long rest)", "special", target=one_creature())
    two["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}], "scaling": {"allowed": False}}
    note(pf, "Simple Domain costs no CE and moves with you.")
    mark(pf)


def pachinko_fever(S):
    d = S.get("Domain Expansion: Idle Death Gamble")
    acts = d["system"]["activities"]
    d["system"]["uses"] = {"max": "1", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    acts["wvrmw4fvEn5EbuDC"]["name"] = "Free expansion (1 per long rest)"
    acts["wvrmw4fvEn5EbuDC"]["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}], "scaling": {"allowed": False}}
    for aid, rng, kind, exp in [("TXwXx9fXzICCIwJX", 30, "ranged", 10), ("2YBYxZ5VY36SuFOh", 5, "melee", 25)]:
        a = acts[aid]
        a["range"], a["target"] = _r(rng), one_creature()
        a.setdefault("attack", {})["ability"] = "spellcasting"
        a["attack"].setdefault("type", {})["value"] = kind
        a["name"] = a["name"].split(" (")[0] + f" (+{exp}% expectation)"
    gd = acts["9tZPXV2hWCQnKAV3"]
    act(d, "9tZPXV2hWCQnKAV3", "attack", "Golden Train Door (4 CE, +50%)", "bonus", range=_r(30), target=one_creature(),
        attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False, "type": {"value": "ranged", "classification": "spell"}},
        damage={"includeBase": False, "parts": [dice(1, 12, ["bludgeoning"])]})
    sv = act(d, "door", "save", "Train door: STR or restrained", "special", save=_sv("str"), damage={"onSave": "none", "parts": []}, target=one_creature())
    apply(sv, "IOEoSqxJ7etd6f6j")
    for e in d["effects"]:
        if e["_id"] == "IOEoSqxJ7etd6f6j": e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnEndSource"]
    free(d, sv)
    trigger(acts["9tZPXV2hWCQnKAV3"], sv, "hitTargets")
    ev = act(d, "event", "utility", "Bet: event roll (d20 + expectation)", "bonus", range=RANGE_SELF, target=SELF,
             roll={"formula": "1d20 + @scaling - 1", "name": "Event: 1–9 d12 · 10–14 d10 · 15–18 d8 · 19–20 d6", "prompt": True, "visible": True})
    free(d, ev)
    rounds = act(d, "len", "utility", "Event length (d10 rounds)", "special", range=RANGE_SELF, target=SELF,
                 roll={"formula": "1d10", "name": "Event rounds", "prompt": False, "visible": True})
    free(d, rounds)
    mult = act(d, "mult", "utility", "Multiplier roll (d20 + expectation)", "special", range=RANGE_SELF, target=SELF,
               roll={"formula": "1d20 + @scaling - 1", "name": "1–12 ×3 · 13–15 ×4 · 16–17 ×5 · 18–19 ×10 · 20 Rainbow", "prompt": True, "visible": True})
    free(d, mult)
    for die in (12, 10, 8, 6):
        j = act(d, f"jp{die}", "utility", f"Jackpot dice (3d{die}: triples win)", "special", range=RANGE_SELF, target=SELF,
                roll={"formula": f"3d{die}", "name": "Jackpot", "prompt": False, "visible": True})
        free(d, j)
    win = act(d, "jackpot", "utility", "JACKPOT: 4 rounds of immortality", "special", range=RANGE_SELF, target=SELF)
    apply(win, fx(d, "jp", "Jackpot", rounds=4, changes=[("flags.midi-qol.OverTime", 0, "turn=start, label=Jackpot: refill CE, RCT heal")],
                  desc="CE refills each turn; free RCT (CE mod) at turn start; can't drop below 1 HP; heal injuries. No Technique Burnout; regain a free use."))
    free(d, win)
    note(d, "Expectation: enter it as the scale (+1 per 10%, max +19) when rolling. Non-lethal domain with Anti-Domain Clash.")
    mark(d)

    gl = S.get("Great Luck")
    gl["system"]["uses"] = {"max": "1", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    a = gl["system"]["activities"]["glSZei3Ae16pW6Ap"]
    a["name"] = "Force a critical (1 per long rest, no Black Flash)"
    a["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}], "scaling": {"allowed": False}}
    apply(a, fx(gl, "crit", "Great Luck", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.critical.all", 0, "1")]))
    mark(gl)

    oar = S.get("On a Roll")
    note(oar, "After a Jackpot: advantage on the next domain's Event or Multiplier roll (roll 2d20kh).")
    mark(oar)

    fv = S.get("The Fever")
    fv["system"]["uses"] = {"max": "@prof", "spent": "@prof", "recovery": []}
    fv["system"]["uses"]["spent"] = 0
    fv["system"]["activities"] = {}
    for key, nm, ch in [("crit", "Fever: land a critical", [("flags.midi-qol.critical.all", 0, "1")]),
                        ("ten", "Fever: +10 to a save or check", [("system.bonuses.abilities.save", 2, "+10"), ("system.bonuses.abilities.check", 2, "+10")])]:
        x = act(fv, key, "utility", nm, "special", range=RANGE_SELF, target=SELF)
        x["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}], "scaling": {"allowed": False}}
        apply(x, fx(fv, key, nm.split(": ")[1], rounds=1, special=["1Attack"] if key == "crit" else ["isSave"], changes=ch))
    act_ = act(fv, "action", "utility", "Fever: an additional action", "special", range=RANGE_SELF, target=SELF)
    act_["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}], "scaling": {"allowed": False}}
    note(fv, "Uses = fever points (gain one per round when dropped to 1 HP during the Jackpot; lost at the end of combat).")
    mark(fv)

    ls = S.get("Luckiest Sorcerer Alive")
    a = ls["system"]["activities"]["1Vzkeb3xIOtzq6y4"]
    a["name"] = "Multiplier roll (best of 3d20)"
    a["roll"] = {"formula": "3d20kh + @scaling - 1", "name": "Multiplier", "prompt": True, "visible": True}
    note(ls, "Jackpot lasts CE mod minutes; RCT as if 2 × CE mod spent, as a free action.")
    mark(ls)

    jb = S.get("Joint Bankruptcy")
    jb.setdefault("system", {}).setdefault("activities", {})
    x = act(jb, "roll", "utility", "Everyone rolls for a Jackpot", "special",
            target={"affects": {"type": "creature", "choice": False}, "override": True})
    free(jb, x)
    note(jb, "Jackpot: +10 CE. Fail: loses all CE and can't regain it for 1 minute.")
    mark(jb)


def _passive(item, key, name, changes, desc=""):
    item.setdefault("effects", [])
    eid = fx(item, key, name, rounds=None, changes=changes, desc=desc)
    for e in item["effects"]:
        if e["_id"] == eid: e["transfer"], e["disabled"], e["duration"] = True, False, {}
    return eid


def _drop_fx(item, *ids):
    item["effects"] = [e for e in item.get("effects", []) if e["_id"] not in ids]


def pain_killer(S):
    pk = S.get("Pain Killer")
    _drop_fx(pk, "7OzLVmP6uZLQWKKt")
    _passive(pk, "med", "Medicine proficiency", [("system.skills.med.value", 4, "1")])
    a = pk["system"]["activities"]["2YF1OrneWFTeGyE4"]
    a["name"] = "Pain Killer (1 CE): stop ongoing damage + temp HP"
    a["range"], a["target"] = _r(5), one_creature()
    a["healing"] = {"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                    "custom": {"enabled": True, "formula": f"{CEMOD} + @details.level"}, "scaling": {}}
    note(pk, "Remove the target's damage-over-time effects (bleeding, OverTime damage) by hand; temp HP last 1 hour.")
    mark(pk)

    ph = S.get("Practiced Hands")
    a = ph["system"]["activities"]["Jf6kX6ukS0BzcayA"]
    a["name"] = "Pain Killer on all willing nearby (1 CE each)"
    a["range"], a["target"] = RANGE_SELF, sphere("5 + 5 * floor(min(@details.level, 6) / 6) + 5 * floor(min(@details.level, 11) / 11)")
    a["target"]["affects"]["type"] = "ally"
    a["type"] = "heal"
    a["healing"] = {"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                    "custom": {"enabled": True, "formula": f"{CEMOD} + @details.level"}, "scaling": {}}
    cost(ph, a, 1, 1, "20")
    mark(ph)

    pb = S.get("Pain Breaker")
    _drop_fx(pb, "BHnWgBjavazx8UBf")
    _passive(pb, "med", "Medicine expertise", [("system.skills.med.value", 4, "2")])
    note(pb, "Pain Killer also removes one condition and stabilizes a dying creature.")
    mark(pb)

    an = S.get("Analgesic")
    a = an["system"]["activities"]["c5fwBy4Igz2S5uCZ"]
    a["name"] = "Analgesic (4 CE): halve damage to a creature within 10 ft"
    a["range"], a["target"] = _r(10), one_creature()
    a["useConditionText"] = 'reaction === "isDamaged"'
    apply(a, fx(an, "half", "Analgesic", rounds=1, special=["isDamaged"],
                changes=[("system.traits.dr.all", 0, "1")], desc="Resistance to the triggering damage (halved)."))
    mark(an)

    d = S.get("Domain Expansion: Medical Clinic")
    x = d["system"]["activities"]["A5Xa3C8jrRwuQgM6"]
    x["name"] = "Free Analgesic (once per damage instance)"
    x["useConditionText"] = 'reaction === "isDamaged"'
    x["target"] = one_creature()
    apply(x, fx(d, "half", "Analgesic (domain)", rounds=1, special=["isDamaged"], changes=[("system.traits.dr.all", 0, "1")]))
    free(d, x)
    i = act(d, "init20", "heal", "Initiative 20: Pain Killer on chosen creatures", "special",
            target={"affects": {"type": "ally", "choice": True}, "override": True},
            healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                     "custom": {"enabled": True, "formula": f"{CEMOD} + @details.level"}, "scaling": {}})
    free(d, i)
    mark(d)

    kp = S.get("Killer Pain")
    kp.setdefault("system", {}).setdefault("activities", {})
    t = act(kp, "touch", "utility", "Killer Pain touch (Sleight of Hand vs AC)", "action", range=_r(5), target=one_creature(),
            roll={"formula": "1d20 + @skills.slt.total", "name": "Sleight of Hand vs AC", "prompt": False, "visible": True})
    apply(t, fx(kp, "pain", "Killer Pain", rounds=600,
                desc="+5 psychic damage per 2 CE spent from every damage source for 1 hour (add by hand)."))
    cost(kp, t, 2, 2, CEMOD)
    mark(kp)

    pm = S.get("Pain Maker")
    a = pm["system"]["activities"]
    a["BRh59QweJIfmXUqc"]["name"] = "Wounded target: 10 psychic"
    a["BRh59QweJIfmXUqc"]["type"] = "damage"
    a["BRh59QweJIfmXUqc"]["damage"] = {"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["psychic"],
                                          "custom": {"enabled": True, "formula": "10"}, "scaling": {}}]}
    a["BRh59QweJIfmXUqc"]["effects"] = []
    a["BRh59QweJIfmXUqc"]["target"] = one_creature()
    free(pm, a["BRh59QweJIfmXUqc"])
    a["GpJZVSnz42cOd07Z"]["name"] = "Also poison it (+6 CE)"
    a["GpJZVSnz42cOd07Z"]["target"] = one_creature()
    apply(a["GpJZVSnz42cOd07Z"], "0KmyToxB0HWEE3zZ")
    for e in pm["effects"]:
        if e["_id"] == "0KmyToxB0HWEE3zZ":
            e["duration"] = {"rounds": 600}
            e["changes"] = [{"key": "flags.midi-qol.disadvantage.deathSave", "mode": 0, "value": "1", "priority": 20}]
    mark(pm)


def paralyzing_gaze(S):
    ie = S.get("Immobilizing Eyes")
    a = ie["system"]["activities"]
    g = a["hHZRC41mn5brBCkQ"]
    g["range"], g["target"] = _r(60), one_creature()
    g["damage"] = {"onSave": "none", "parts": []}
    slow = fx(ie, "slow", "Immobilized (gaze)", special=["turnStartSource"],
              changes=[("system.attributes.movement.all", 1, "0.5"), ("system.attributes.ac.bonus", 2, "-JJKORIGINCEMOD"),
                       ("system.bonuses.mwak.attack", 2, "-JJKORIGINCEMOD"), ("system.bonuses.rwak.attack", 2, "-JJKORIGINCEMOD"),
                       ("system.bonuses.msak.attack", 2, "-JJKORIGINCEMOD"), ("system.bonuses.rsak.attack", 2, "-JJKORIGINCEMOD")],
              desc="Half speed; AC and attack rolls −caster's CE mod until the caster's next turn.")
    apply(g, slow)
    m = a["gADipBTrvXlRPeDi"]
    m["name"] = "Maintain gaze (1 CE, bonus action)"
    m["target"] = one_creature()
    m["effects"] = [{"_id": slow, "onSave": False}]
    eyes = act(ie, "eyes", "utility", "Eyes at 0 HP: blinded", "special", range=RANGE_SELF, target=SELF)
    apply(eyes, "JH2A80fyDuCz6WAT")
    free(ie, eyes)
    ie["system"]["uses"] = {"max": "ceil(@attributes.hp.max / 3)", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    note(ie, "Item uses = eye HP (⅓ max HP; ½ at 11th). Eyes lose 1 per point a target beats your DC by; regain 1 at your turn start.")
    mark(ie)

    pv = S.get("Peripheral Vision")
    a = pv["system"]["activities"]
    a["By1iifz3o9klqhw7"]["name"] = "Gaze at several (full turn, +1 CE per extra creature)"
    a["By1iifz3o9klqhw7"]["range"] = _r(60)
    a["By1iifz3o9klqhw7"]["target"] = {"affects": {"type": "creature", "count": CEMOD, "choice": True}, "override": True}
    cost(pv, a["By1iifz3o9klqhw7"], 1, 1, CEMOD)
    a["DTINx1WfX2xsnk4f"]["name"] = "Maintain on each extra creature (1 CE each)"
    note(pv, "Use Immobilizing Eyes' save for each target.")
    mark(pv)

    re_ = S.get("Reactive Eye Movement")
    a = re_["system"]["activities"]["5rA6Nn0tE6dkoFCV"]
    a["name"] = "Reactive gaze (2 CE): DEX or disadvantage on its attack"
    a["activation"]["type"] = "reaction"
    a["useConditionText"] = 'reaction === "isAttacked"'
    a["range"], a["target"] = _r(60), one_creature()
    a["damage"] = {"onSave": "none", "parts": []}
    apply(a, fx(re_, "dis", "Gaze-locked", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.disadvantage.attack.all", 0, "1")]))
    note(re_, "Creatures under Immobilizing Eyes fail automatically.")
    mark(re_)

    mx = S.get("Maximum: Paralyzing Gaze")
    a = mx["system"]["activities"]
    p = a["1DZCHVnlatlYFYfG"]
    p["range"], p["target"] = _r(120), one_creature()
    p["damage"] = {"onSave": "none", "parts": []}
    for e in mx["effects"]:
        if e["_id"] == "Qo6WErARjd9ahkuW":
            e["duration"] = {"rounds": 10}
            e["changes"] = [{"key": "system.attributes.ac.bonus", "mode": 2, "value": "-JJKORIGINCEMOD", "priority": 20},
                            {"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                             "value": "turn=end, saveAbility=str, saveDC=JJKORIGINDC, label=Paralyzing Gaze (Athletics)"}]
    a["S3EuFdYe8bgPf0Cl"]["name"] = "Maintain paralysis (2 CE, bonus action)"
    a["S3EuFdYe8bgPf0Cl"]["activation"]["type"] = "special"
    note(mx, "Concentration. Escape check: your eyes take 2 per point it beats your DC. Eye HP = ½ max HP.")
    mark(mx)

    d = S.get("Domain Expansion: Chamber of Fractured Reflections")
    x = act(d, "init20", "save", "Initiative 20: gaze on 3 creatures", "special", save=_sv("dex"),
            damage={"onSave": "none", "parts": []}, target={"affects": {"type": "enemy", "count": "3", "choice": True}, "override": True})
    x["effects"] = [{"_id": fx(d, "slow", "Immobilized (domain)", special=["turnStartSource"],
                               changes=[("system.attributes.movement.all", 1, "0.5"), ("system.attributes.ac.bonus", 2, "-JJKORIGINCEMOD")]),
                     "onSave": False}]
    x["save"] = {"ability": [], "dc": {"calculation": "spellcasting", "formula": ""}}
    x["type"] = "utility"
    x.pop("damage", None)
    free(d, x)
    note(d, "Guaranteed hit: domain effect (no save). Line of sight can't be broken inside.")
    mark(d)

    eg = S.get("Energizing Gaze")
    a = eg["system"]["activities"]
    a["Ri01OLpTb9kW8AR9"]["range"], a["Ri01OLpTb9kW8AR9"]["target"] = _r(30), one_creature()
    q = fx(eg, "fast", "Energized", special=["turnStartSource"],
           changes=[("system.attributes.movement.all", 1, "2"), ("system.attributes.ac.bonus", 2, "+JJKORIGINCEMOD")],
           desc="Double speed, +caster's CE mod AC, an extra bonus action.")
    apply(a["Ri01OLpTb9kW8AR9"], q)
    a["rZTE8uPTRoUmB24x"]["target"] = one_creature()
    apply(a["rZTE8uPTRoUmB24x"], q)
    mark(eg)


PRAYER = [
    (1, [("system.attributes.ac.bonus", 2, "+2"), ("system.abilities.dex.bonuses.save", 2, "+2")], "+2 AC and DEX saves"),
    (2, [], "Enemies' AC −2 (apply to them)"),
    (3, [("system.bonuses.mwak.attack", 2, "+ " + CEMOD), ("system.bonuses.rwak.attack", 2, "+ " + CEMOD)], "+CE mod to attack rolls"),
    (4, [("flags.midi-qol.grants.disadvantage.attack.all", 0, "1"), ("flags.midi-qol.advantage.ability.save.all", 0, "1")], "Opponent attacks at disadvantage; you save at advantage"),
    (5, [("system.bonuses.mwak.damage", 2, "+ @prof"), ("system.bonuses.rwak.damage", 2, "+ @prof")], "+prof damage"),
]
CRESC = [
    (1, [("system.attributes.ac.bonus", 2, "+3"), ("system.abilities.dex.bonuses.save", 2, "+3")], "+3 AC and DEX saves"),
    (3, [("system.bonuses.mwak.damage", 2, "+ " + CEMOD), ("system.bonuses.rwak.damage", 2, "+ " + CEMOD),
         ("system.bonuses.mwak.attack", 2, "+ " + CEMOD), ("system.bonuses.rwak.attack", 2, "+ " + CEMOD)], "+CE mod to attack and damage"),
    (9, [("flags.midi-qol.critical.range", 2, "-2")], "Critical range +2"),
]


def _cumulative(rows, upto):
    ch, txt = [], []
    for t, c, d in rows:
        if t <= upto: ch += c; txt.append(f"T{t}: {d}")
    return ch, "; ".join(txt)


def prayer_song(S):
    pr = S.get("Prayer")
    a = pr["system"]["activities"]["JFf7uuFbevBJos36"]
    a["name"] = "Start Prayer (1 CE): turn 1"
    a["range"], a["target"] = RANGE_SELF, SELF
    a["effects"] = []
    _drop_fx(pr, "3nY872WGP5eEjNaG")
    for t in range(1, 6):
        ch, txt = _cumulative(PRAYER, t)
        eid = fx(pr, f"t{t}", f"Prayer (turn {t})", rounds=None, changes=ch,
                 desc=txt + ". Ends if you're stunned, paralyzed, grappled, restrained or prone.")
        if t == 1:
            apply(a, eid)
        else:
            x = act(pr, f"turn{t}", "utility", f"Prayer: advance to turn {t}", "special", range=RANGE_SELF, target=SELF)
            apply(x, eid)
            free(pr, x)
    debuff = act(pr, "enemy", "utility", "Prayer turn 2+: your opponent's AC −2", "special", target=one_creature())
    apply(debuff, fx(pr, "enemy", "Off-beat (−2 AC)", rounds=None, changes=[("system.attributes.ac.bonus", 2, "-2")]))
    free(pr, debuff)
    note(pr, "Remove the previous turn's effect when advancing (each one includes the earlier benefits).")
    mark(pr)

    mc = S.get("Marcado")
    a = mc["system"]["activities"]["6vfB7yNFal6DmnTZ"]
    act(mc, "6vfB7yNFal6DmnTZ", "damage", "Marcado (on hit, 1 CE): +2 damage dice", "special", target=one_creature(),
        damage={"parts": [dice(2, 8, ["bludgeoning"])]})
    mc["system"]["activities"]["6vfB7yNFal6DmnTZ"]["useConditionText"] = 'reaction === "isHit"'
    note(mc, "Dice shown as 2d8: use your weapon's die and damage type.")
    mark(mc)

    cz = S.get("Caesura")
    a = cz["system"]["activities"]["GyzMO0Gq5npdBKci"]
    a["name"] = "Caesura: force a reroll (while dancing)"
    a["useConditionText"] = 'reaction === "isAttacked" || reaction === "isDamaged"'
    a["target"] = one_creature()
    a["range"] = _r(60)
    mark(cz)

    cr = S.get("Crescendo")
    cr.setdefault("system", {}).setdefault("activities", {})
    for t in (1, 3, 9):
        ch, txt = _cumulative(CRESC, t)
        x = act(cr, f"t{t}", "utility", f"Crescendo (turn {t}+)", "special", range=RANGE_SELF, target=SELF)
        apply(x, fx(cr, f"t{t}", f"Crescendo (turn {t}+)", rounds=None, changes=ch, desc=txt))
        free(cr, x)
    note(cr, "Replaces Prayer's table at 11th. Other turns (enemy −3 AC, disadvantage, +prof, −prof to its damage, extra attack, −5 AC/saves, "
             "action economy limit): apply by hand.")
    mark(cr)

    d = S.get("Domain Expansion: Dance Dance Revolution")
    ch, txt = _cumulative(CRESC, 10)
    x = act(d, "full", "utility", "Domain: all ten Prayer turns", "special", range=RANGE_SELF, target=SELF)
    apply(x, fx(d, "full", "Dance Dance Revolution", rounds=10,
                changes=ch + [("flags.midi-qol.grants.disadvantage.attack.all", 0, "1"), ("flags.midi-qol.advantage.ability.save.all", 0, "1"),
                              ("system.bonuses.mwak.damage", 2, "+ @prof")],
                desc="Counts as ten turns of Prayer."))
    free(d, x)
    mark(d)

    sd = S.get("Sad Song")
    a = sd["system"]["activities"]["uWopKwYgMekMXnVs"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(sd, "sad", "Sad Song", rounds=10,
                changes=[("flags.midi-qol.disadvantage.ability.save.all", 0, "1"), ("flags.midi-qol.disadvantage.attack.all", 0, "1"),
                         ("flags.midi-qol.grants.advantage.attack.all", 0, "1")],
                desc="Regain CE mod CE at turn start in life-threatening combat (add by hand)."))
    mark(sd)


def projection_sorcery(S):
    pj = S.get("Projection")
    _drop_fx(pj, "aXRRi8ccKgpV5q5D")
    a = pj["system"]["activities"]
    on = a["gL74cA8zuvksOhbn"]
    on["name"] = "Activate Projection (1 CE)"
    on["range"], on["target"] = RANGE_SELF, SELF
    apply(on, fx(pj, "on", "Projection", rounds=None, changes=[("system.attributes.movement.walk", 2, "+10")],
                 desc="+10 ft speed and +1 attack on the Attack action. Commit your end point; deviating sets speed 0 until end of next turn."))
    a["I3xaPqqLKDp84C76"]["name"] = "Upkeep (1 CE, start of turn)"
    a["I3xaPqqLKDp84C76"]["activation"]["type"] = "special"
    fr = act(pj, "frozen", "utility", "Missed the frame: speed 0", "special", range=RANGE_SELF, target=SELF)
    apply(fr, fx(pj, "frz", "Frame missed", rounds=2, special=["turnEnd"], changes=[("system.attributes.movement.all", 0, "0")]))
    free(pj, fr)
    mark(pj)

    ac = S.get("Acceleration")
    _drop_fx(ac, "pTAydcaXQZpWq5Fe")
    ac.setdefault("system", {}).setdefault("activities", {})
    st = act(ac, "stack", "utility", "Consecutive turn: +10 ft speed", "special", range=RANGE_SELF, target=SELF)
    apply(st, fx(ac, "stack", "Acceleration +10 ft", rounds=None, changes=[("system.attributes.movement.walk", 2, "+10")],
                 desc="Stack one per consecutive Projection turn."))
    free(ac, st)
    ch = act(ac, "charge", "damage", "Momentum strike (+1d6 per 10 ft charged)", "special", target=one_creature(),
             damage={"parts": [dice(1, 6, ["bludgeoning"], scale=1)]})
    free(ac, ch)
    mark(ac)

    fr = S.get("24 Frame Rule")
    a = fr["system"]["activities"]["mwDEHQCHlIp7d432"]
    a["name"] = "Freeze frame (on unarmed hit, 2 CE, no damage)"
    a["activation"]["type"] = "special"
    a["useConditionText"] = 'reaction === "isHit"'
    a["target"] = one_creature()
    a["damage"] = {"onSave": "none", "parts": []}
    for e in fr["effects"]:
        if e["_id"] == "lyxFE4igXqxsmxeV":
            e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnStartSource", "isAttacked"]
            e["changes"] = [{"key": "flags.midi-qol.grants.critical.all", "mode": 0, "value": "1", "priority": 20}]
    note(fr, "Next hit on it is a critical that ignores resistance (immunity → resistance) and ends the stun.")
    mark(fr)

    fs = S.get("Fastest Sorcerer Alive")
    for e in fs["effects"]:
        if e["_id"] == "lWoMx5IJmSeIUzmy":
            e["changes"] = [{"key": "flags.midi-qol.advantage.ability.save.dex", "mode": 0, "value": "1", "priority": 20},
                            {"key": "system.attributes.movement.walk", "mode": 2, "value": "+30", "priority": 20},
                            {"key": "system.abilities.dex.value", "mode": 2, "value": "+2", "priority": 20}]
            e["name"] = "Fastest Sorcerer Alive (Projection active)"
            e["disabled"] = True
    note(fs, "Toggle the effect while Projection is active. +20 ft more at the start of each turn (Acceleration stacks).")
    mark(fs)

    d = S.get("Domain Expansion: Lunar Palace Womb of Time")
    x = d["system"]["activities"]["qseTIQ0W3Se2Ycwc"]
    x["name"] = "Moves or acts: 8d10 necrotic"
    x["target"] = one_creature()
    free(d, x)
    mark(d)

    rp = S.get("Replay Sorcery")
    rp.setdefault("system", {}).setdefault("activities", {})
    x = act(rp, "replay", "utility", "Replay (full turn): 6 s back per 2 CE", "action", range=RANGE_SELF, target=SELF)
    cost(rp, x, 2, 2, "2 * " + CEMOD)
    note(rp, "Teleport to where you were that many rounds ago. Not while Projection is active.")
    mark(rp)


def puppet_manipulation(S):
    um = S.get("Ultimate Mechamaru")
    a = um["system"]["activities"]
    a["EKcGWGZTKptdIRSC"]["name"] = "Imbue a puppet (1 CE, 2 Minor traits)"
    a["EKcGWGZTKptdIRSC"]["range"] = _r(60)
    for aid, nm, rng in [("jzPwmId29fqDnLPW", "Energy Cannon (Absolute Mech, 6 CE): 20d6", 120),
                         ("EVUDlPLUjdvCguIS", "Energy Volley (Absolute Mech, 4 CE): 5 orbs × 6d6", 120)]:
        x = a[aid]
        x["name"] = nm
        x["range"], x["target"] = _r(rng), one_creature()
        x["attack"]["ability"] = "dex" if "Cannon" in nm else "spellcasting"
        x["attack"]["bonus"] = "@prof + 3" if "Cannon" in nm else "3"
        x["attack"]["flat"] = False
        x["uses"] = {"max": "1", "spent": 0, "recovery": [{"period": "recharge", "formula": "5"}]}
        x.setdefault("consumption", {"targets": [], "scaling": {"allowed": False}})["targets"].append({"type": "activityUses", "target": "", "value": "1", "scaling": {}})
    if "EVUDlPLUjdvCguIS" in a: a["EVUDlPLUjdvCguIS"]["target"] = {"affects": {"type": "creature", "count": "5", "choice": True}, "override": True}
    dm = a["pdv5BU842aD3j9bS"]
    dm["name"] = "Deflect Missiles (puppet reaction): reduce 1d12 + level"
    dm["type"] = "heal"
    dm["healing"] = {"number": 1, "denomination": 12, "bonus": "@details.level", "types": ["temphp"],
                     "custom": {"enabled": False, "formula": ""}, "scaling": {}}
    dm.pop("damage", None)
    dm["useConditionText"] = 'reaction === "isAttacked"'
    dm["range"], dm["target"] = _r(60), one_creature()
    note(um, "Build the puppet as a Construct actor (STR 15 / CON 14 / DEX 13 + CE mod points, AC 10 + DEX, your HD by material). "
             "Command: bonus action (actions), reaction (reactions). Cannon/Volley recharge 5–6; attack bonuses follow the text.")
    mark(um)

    for nm, aid, ce, traits in [("Lesser Puppet", "ONuQCDWThGyf0Zjw", 3, "2 Minor + 2 Lesser"),
                                ("Advanced Puppet", "f7qA14YARgv3w3AZ", 6, "2 Minor + 2 Lesser + 2 Advanced"),
                                ("Absolute Puppet", "lT8Ipbu685h91Gkt", 10, "2 of each tier incl. Absolute")]:
        it = S.get(nm)
        x = it["system"]["activities"][aid]
        x["name"] = f"Summon {nm.split()[0]} Puppet ({ce} CE)"
        x["range"], x["target"] = _r(30), SELF
        note(it, f"Puppet traits: {traits}. Drag its actor onto the scene.")
        mark(it)

    d = S.get("Domain Expansion: Puppet Show")
    x = act(d, "init20", "utility", "Initiative 20: every creature takes an action you choose (no CE)", "special",
            target={"affects": {"type": "creature", "choice": False}, "override": True})
    free(d, x)
    mark(d)

    ss = S.get("Severed Strings")
    a = ss["system"]["activities"]["LGhvgjCC0hLUDH6s"]
    act(ss, "LGhvgjCC0hLUDH6s", "save", "Severed Strings (5 CE)", "action", save=_sv(["wis", "cha"]),
        damage={"onSave": "none", "parts": []}, range=_r(60), target=one_creature())
    apply(ss["system"]["activities"]["LGhvgjCC0hLUDH6s"],
          fx(ss, "cut", "Strings severed", rounds=10,
             changes=[("flags.midi-qol.OverTime", 0, "turn=end, saveAbility=wis|cha, saveDC=JJKORIGINDC, label=Severed Strings")],
             desc="Its summons go berserk and attack the nearest creature."))
    mark(ss)


RATIO = "flags.midi-qol.critical.range"


def ratio(S):
    cf = S.get("Critical Focus")
    _passive(cf, "crit", "Critical Focus", [("flags.dnd5e.weaponCriticalThreshold", 3, "19"), ("flags.dnd5e.spellCriticalThreshold", 3, "19")],
             desc="+1 critical range. Extra crit dice: 1 (+2 at 3rd, +3 at 6th, +4 at 11th, +5 in the domain).")
    note(cf, "Extra critical dice: add them on the weapon (Extra Critical Damage field), e.g. 1 at 1st, 3 at 3rd, 4 at 6th, 5 at 11th.")
    mark(cf)

    r = S.get("Ratio")
    a = r["system"]["activities"]["O3ZJjRkxSG0e9WMs"]
    a["name"] = "Ratio roll (on hit, 1 CE): 3 or 7 = critical"
    a["activation"]["type"] = "special"
    a["useConditionText"] = 'reaction === "isHit"'
    a["range"], a["target"] = RANGE_SELF, SELF
    a["roll"] = {"formula": "(floor(min(@details.level, 11) / 11) + @scaling)d10", "name": "Ratio (any 3 or 7 = crit)", "prompt": False, "visible": True}
    cost(r, a, 1, 1, "1 + " + CEMOD)
    note(r, "At 11th: 2d10 plus one more per extra CE. On 3/7 re-roll damage as a critical.")
    mark(r)

    co = S.get("Collapse")
    a = co["system"]["activities"]["G3dpZLmajvGLLBkj"]
    a["range"], a["target"] = RANGE_SELF, sphere(30)
    a["damage"] = {"onSave": "half", "parts": [dice(3, 10, ["bludgeoning"]),
                   {"number": None, "denomination": None, "bonus": "", "types": ["bludgeoning"],
                    "custom": {"enabled": True, "formula": "2 * (1d8 + @abilities.str.mod)"}, "scaling": {}}]}
    a["damage"]["critical"] = {"allow": True}
    note(co, "Second part = your attack's damage doubled as a critical (d8 + STR assumed). Area becomes difficult terrain.")
    mark(co)

    ir = S.get("Improved Ratio")
    note(ir, "Ratio rolls 2d10 (+1d10 per extra CE up to CE mod); +4 critical dice.")
    mark(ir)

    d = S.get("Domain Expansion: Golden Ratio")
    x = act(d, "crit", "utility", "Domain: every attack is a critical", "special", range=RANGE_SELF, target=SELF)
    apply(x, fx(d, "crit", "Golden Ratio", rounds=10, changes=[("flags.midi-qol.critical.all", 0, "1")],
                desc="All your attacks are critical hits (+5 crit dice)."))
    free(d, x)
    mark(d)

    iv = S.get("Inverse Ratio")
    a = iv["system"]["activities"]["h3qR8T6z2MB3v5Dm"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(iv, "inv", "Inverse Ratio", rounds=None,
                desc="Each attack/save vs you: d10. Not 3/7: resistance to all, DR ½ level, resistances become immunities. 3/7: auto-hit / auto-fail. CE mod rounds."))
    roll = act(iv, "roll", "utility", "Inverse Ratio d10", "special", range=RANGE_SELF, target=SELF,
               roll={"formula": "1d10", "name": "3 or 7 = weak point", "prompt": False, "visible": True})
    roll["useConditionText"] = 'reaction === "isAttacked" || reaction === "isSave"'
    free(iv, roll)
    good = act(iv, "good", "utility", "Reinforced (not 3/7)", "special", range=RANGE_SELF, target=SELF)
    apply(good, fx(iv, "good", "Reinforced", rounds=1, special=["isDamaged"],
                   changes=[("system.traits.dr.all", 0, "1"), ("system.traits.dm.amount.all", 2, "-floor(@details.level / 2)")]))
    free(iv, good)
    mark(iv)


RG_TIERS = [[1, "1d8"], [3, "2d8"], [6, "3d8"], [11, "4d8"], [18, "6d8"]]


def regalia(S):
    rg = S.get("Regalia")
    a = rg["system"]["activities"]
    a["4ZYehpeGjC443jyo"]["name"] = "Manifest Regalia (2 CE, CE mod hours)"
    a["4ZYehpeGjC443jyo"]["range"], a["4ZYehpeGjC443jyo"]["target"] = RANGE_SELF, SELF
    apply(a["4ZYehpeGjC443jyo"], fx(rg, "on", "Regalia", rounds=None,
                                    changes=[("system.bonuses.mwak.attack", 2, "+ (1 + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))"),
                                             ("system.bonuses.mwak.damage", 2, "+ (1 + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18) + floor(min(@details.level, 6) / 6))")],
                                    desc="+1 to attack/damage with the Regalia (+2/+3/+4 at 6th/11th/18th). Applies to all melee weapon attacks: equip only the Regalia."))
    x = a["6n7ztqbNWA03K4hw"]
    x["name"] = "Regalia necrotic (on hit, 1 CE)"
    x["activation"]["type"] = "special"
    x["useConditionText"] = 'reaction === "isHit"'
    x["target"] = one_creature()
    scale(rg, x, RG_TIERS)
    mark(rg)

    cw = S.get("Cursed Wave")
    a = cw["system"]["activities"]["nOdC7wtQzMRR5L7C"]
    a["name"] = "Cursed Wave (1 CE, replaces an attack)"
    a["activation"]["type"] = "special"
    a["range"] = RANGE_SELF
    a["target"] = {"template": {"type": "line", "size": "30", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                   "affects": {"type": "creature", "choice": False}, "override": True}
    a["damage"] = {"onSave": "none", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["necrotic"],
                   "custom": {"enabled": True, "formula": "1d8 + @abilities.str.mod + 1"}, "scaling": {}}]}
    note(cw, "Damage = your Regalia's damage (1d8 + STR + bonus assumed).")
    mark(cw)

    dp = S.get("Divine Protection")
    dp["system"]["uses"] = {"max": "5 * @details.level", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    a = dp["system"]["activities"]
    sh = a["ondRfHfUcPJupVeM"]
    sh["name"] = "Redirect damage to the Regalia pool (1 CE)"
    sh["useConditionText"] = 'reaction === "isDamaged"'
    sh["type"] = "heal"
    sh["healing"] = {"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                     "custom": {"enabled": True, "formula": "@item.uses.value"}, "scaling": {}}
    a["baCgyVARl6Q8wep5"]["name"] = "Resummon broken Regalia (CE mod per long rest)"
    note(dp, "Item uses = Regalia HP pool (5 × level): lower it by the damage absorbed. The shield is shown as temp HP equal to the pool.")
    mark(dp)

    sb = S.get("Soul Bound Treasure")
    a = sb["system"]["activities"]
    a["xnni6zG7OVk4esQS"]["name"] = "Hover the Regalia (10 CE, 1 minute)"
    a["xnni6zG7OVk4esQS"]["range"] = _r(100)
    apply(a["xnni6zG7OVk4esQS"], fx(sb, "hover", "Regalia hovering", rounds=10, desc="AC 12 + CE mod + prof; HP = the pool. Attack from it with CE mod."))
    ln = a["GSvAwjMEvRKGbmGw"]
    ln["name"] = "Regalia line (100 ft, DEX)"
    ln["target"] = {"template": {"type": "line", "size": "100", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                    "affects": {"type": "creature", "choice": False}, "override": True}
    ln["damage"] = {"onSave": "none", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["slashing"],
                    "custom": {"enabled": True, "formula": f"1d8 + {CEMOD} + 4"}, "scaling": {}}]}
    free(sb, ln)
    st = act(sb, "strike", "attack", "Attack from the hovering Regalia", "action", range=_r(100), target=one_creature(),
             attack={"ability": "spellcasting", "bonus": "", "critical": {"threshold": None}, "flat": False, "type": {"value": "melee", "classification": "weapon"}},
             damage={"includeBase": False, "parts": [dice(1, 8, ["slashing"], bonus=CEMOD)]})
    free(sb, st)
    mark(sb)

    d = S.get("Domain Expansion: Cursed Soul Armory")
    i = d["system"]["activities"]["e2jFI68e746zTO4m"]
    i["target"] = {"affects": {"type": "enemy", "choice": False}, "override": True}
    free(d, i)
    fr = d["system"]["activities"]["M1S8tPimSEOTeQAG"]
    fr["name"] = "Soul Bound Treasure free (immune to damage)"
    free(d, fr)
    mark(d)

    rr = S.get("Riches to Rags")
    a = rr["system"]["activities"]["WM0j8F1YA0qCZcLT"]
    act(rr, "WM0j8F1YA0qCZcLT", "save", "Riches to Rags (on hit, 4 CE)", "special", save=_sv(["wis", "cha"]),
        damage={"onSave": "none", "parts": []}, target=one_creature())
    x = rr["system"]["activities"]["WM0j8F1YA0qCZcLT"]
    x["useConditionText"] = 'reaction === "isHit"'
    apply(x, fx(rr, "seal", "Cursed tool sealed", rounds=600, desc="A chosen cursed tool is non-functional for 1 hour (unattune it). −2 to the save per grade below Special."))
    mark(rr)


def _atk(kind="ranged", ability="spellcasting", bonus=""):
    return {"ability": ability, "bonus": bonus, "critical": {"threshold": None}, "flat": False,
            "type": {"value": kind, "classification": "spell"}}


REV_BONUS = "(2 * floor(min(@details.level, 3) / 3) + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))"


def retrograde(S):
    rv = S.get("Reversion")
    a = rv["system"]["activities"]
    r = a["pZKg6UrTUuDaEMX6"]
    act(rv, "pZKg6UrTUuDaEMX6", "utility", "Reversion (1 CE): reroll your attack/save", "reaction", range=RANGE_SELF, target=SELF,
        roll={"formula": "1d20 + " + REV_BONUS, "name": "Reroll bonus (+2→+5 from 3rd; add your normal modifier)", "prompt": False, "visible": True})
    r = a["pZKg6UrTUuDaEMX6"]
    r["useConditionText"] = 'reaction === "isAttacked" || reaction === "isSave"'
    a["V1XYlDRPVyUKryna"]["name"] = "Reversion on a creature within 30 ft (+2 CE, no bonus)"
    a["V1XYlDRPVyUKryna"]["range"], a["V1XYlDRPVyUKryna"]["target"] = _r(30), one_creature()
    mark(rv)

    rg = S.get("Regression")
    a = rg["system"]["activities"]["3dGdrp5GCuYHtWE4"]
    a["name"] = "Regression (3 CE): retrace to turn start"
    a["type"] = "utility"
    a.pop("damage", None)
    a["range"], a["target"] = RANGE_SELF, SELF
    blk = act(rg, "block", "save", "Blocking creature (DEX): prof d8 + pushed", "special", save=_sv("dex"),
              damage={"onSave": "none", "parts": [{"number": None, "denomination": 8, "bonus": "", "types": ["bludgeoning"],
                      "custom": {"enabled": True, "formula": "(@prof)d8"}, "scaling": {}}]}, target=one_creature())
    free(rg, blk)
    far = act(rg, "far", "utility", "Regress to previous turn start (+3 CE, 6th)", "special", range=RANGE_SELF, target=SELF)
    cost(rg, far, 3)
    note(rg, "OAs against the regression have disadvantage. Objects: CE check DC 10 + 3 per size above Medium.")
    mark(rg)

    er = S.get("Enhanced Reversion")
    er["system"]["uses"] = {"max": "@prof", "spent": 0, "recovery": [{"period": "turnStart", "type": "recoverAll"}]}
    a = er["system"]["activities"]
    a["lzbo6ZrJFbpS0kof"]["name"] = "Reversion without a reaction (prof per round)"
    a["lzbo6ZrJFbpS0kof"]["activation"]["type"] = "special"
    a["lzbo6ZrJFbpS0kof"]["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}], "scaling": {"allowed": False}}
    a["ueJph2JGyPKrbpjB"]["name"] = "Reroll with advantage (+3 CE)"
    a["ueJph2JGyPKrbpjB"]["roll"] = {"formula": "2d20kh + " + REV_BONUS, "name": "Reversion (advantage)", "prompt": False, "visible": True}
    mark(er)

    ic = S.get("Invert Causality")
    a = ic["system"]["activities"]["UQbIGoR0Bxusrp9j"]
    a["name"] = "Invert Causality (8 CE): rewind and strike first"
    a["useConditionText"] = 'reaction === "isDamaged"'
    a["range"], a["target"] = _r(30), one_creature()
    a.setdefault("attack", {})["ability"] = "spellcasting"
    note(ic, "Guaranteed hit (treat the attack as a hit); ignore range; the trigger is wasted (undo its damage).")
    mark(ic)

    d = S.get("Domain Expansion: Requiem of Retrograde")
    x = act(d, "init20", "utility", "Initiative 20: reverse a creature's first act", "special", target=one_creature())
    apply(x, fx(d, "rev", "Requiem: first act reversed", rounds=1, special=["turnEnd"], desc="Its first move/action this turn is undone and wasted."))
    free(d, x)
    note(d, "Your Reversion attack rerolls are guaranteed hits; chosen creatures get Reversion's base effect.")
    mark(d)

    pg = S.get("Prograde")
    a = pg["system"]["activities"]["Ng1uuVHOtu1YXXkK"]
    a["name"] = "Certain Defeat (6 CE)"
    a["range"], a["target"] = _r(30), one_creature()
    apply(a, fx(pg, "defeat", "Certain Defeat", rounds=10,
                changes=[("flags.midi-qol.disadvantage.attack.all", 0, "0")],
                desc="No advantage or rerolls; first damage or failed save each round: prof d10 necrotic (use the damage activity)."))
    pg["effects"][-1]["changes"] = []
    dmg = act(pg, "dmg", "damage", "Certain Defeat damage (once per round)", "special", target=one_creature(),
              damage={"parts": [{"number": None, "denomination": 10, "bonus": "", "types": ["necrotic"],
                      "custom": {"enabled": True, "formula": "(@prof)d10"}, "scaling": {}}]})
    free(pg, dmg)
    v = act(pg, "victory", "utility", "Certain Victory (6 CE)", "action", range=_r(30), target=one_creature())
    apply(v, fx(pg, "win", "Certain Victory", rounds=10, desc="Can't gain disadvantage; advantage rolls 3 dice, keep the best."))
    cost(pg, v, 6)
    mark(pg)


SB_TIERS = [[1, "2d10"], [6, "3d10"], [11, "4d10"], [18, "6d10"]]


def rockstar(S):
    sa = S.get("Sound Amplification")
    _drop_fx(sa, "2MmdQsBa0MjAIHRg")
    _passive(sa, "prf", "Performance proficiency", [("system.skills.prf.value", 4, "1")])
    a = sa["system"]["activities"]
    b = a["CdEOvhfEdsw1Axiq"]
    b["name"] = "Sound Blast (1 CE)"
    b["range"] = {"value": "30 + 30 * floor(min(@details.level, 6) / 6)", "units": "ft", "override": True}
    b["target"] = one_creature()
    b["attack"] = _atk()
    scale(sa, b, SB_TIERS)
    pu = a["4rqeXMwiiEKlho4p"]
    pu["name"] = "Sound Blast push (STR or 10 ft)"
    pu["target"] = one_creature()
    pu["damage"] = {"onSave": "none", "parts": []}
    free(sa, pu)
    trigger(b, pu, "hitTargets")
    mark(sa)

    ja = S.get("Jacked Audio")
    a = ja["system"]["activities"]["QZslfH06BotZdDRL"]
    a["name"] = "Extra Sound Blast (1 CE each; 2, or 3 at 11th)"
    a["activation"]["type"] = "special"
    mark(ja)

    rm = S.get("Resonating Music")
    a = rm["system"]["activities"]["kvvCnOOckSlxEV93"]
    a["range"] = RANGE_SELF
    a["target"] = sphere("15 + 15 * floor(min(@details.level, 11) / 11)", kind="cone")
    a["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": 10, "bonus": "", "types": ["thunder"],
                   "custom": {"enabled": True, "formula": "(2 + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + 2 * floor(min(@details.level, 18) / 18) + @prof)d10"}, "scaling": {}}]}
    for e in rm["effects"]:
        if e["_id"] == "jjkSoundWaveDeaf": e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnEnd"]
    note(rm, "Failed save: pushed 20 ft. Sound Blast range is 60 ft from 6th.")
    mark(rm)

    es = S.get("Maximum: Epic Solo")
    a = es["system"]["activities"]["tgeBW16oNUq6SVid"]
    act(es, "tgeBW16oNUq6SVid", "utility", "Epic Solo (8 CE, +2d10 per extra CE)", "action", range=RANGE_SELF, target=SELF)
    a = es["system"]["activities"]["tgeBW16oNUq6SVid"]
    apply(a, fx(es, "solo", "Epic Solo", rounds=10,
                changes=[("system.bonuses.mwak.damage", 2, "+ (2 + 2 * @scaling)d10[thunder]"), ("system.bonuses.rwak.damage", 2, "+ (2 + 2 * @scaling)d10[thunder]"),
                         ("system.bonuses.msak.damage", 2, "+ (2 + 2 * @scaling)d10[thunder]"), ("system.bonuses.rsak.damage", 2, "+ (2 + 2 * @scaling)d10[thunder]")],
                desc="+2d10 thunder on attacks (+2d10 per extra CE). Failed saves vs your technique: disadvantage on its next attack/check."))
    cost(es, a, 8, 1, "8 + ceil(@prof / 2)")
    aura = act(es, "aura", "damage", "Solo aura: ends turn within 15 ft", "special", target=one_creature(),
               damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["thunder"],
                       "custom": {"enabled": True, "formula": f"{CEMOD} + @prof"}, "scaling": {}}]})
    free(es, aura)
    note(es, "@scaling in the effect is fixed when applied: re-apply if you change the extra CE.")
    mark(es)

    d = S.get("Domain Expansion: Hall of Fame")
    x = d["system"]["activities"]["B6IVNe90qPm8dJhZ"]
    x["type"] = "damage"
    x["name"] = "Initiative 20: Sound Blast damage + deafened"
    x["damage"] = {"parts": [dice(6, 10, ["thunder"])]}
    x["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    for e in d["effects"]:
        if e["_id"] == "rce1JcnUqkglCO2O": e["duration"] = {"rounds": 10}
    free(d, x)
    mark(d)

    sj = S.get("Smooth Jazz")
    a = sj["system"]["activities"]["NvEh1lLuCxnIKlFh"]
    a["range"], a["target"] = RANGE_SELF, sphere(30)
    for e in sj["effects"]:
        if e["_id"] == "krStrU3zjr5sy7AX":
            e["duration"] = {"rounds": 10}
            e["changes"] = [{"key": "system.traits.di.value", "mode": 2, "value": "thunder", "priority": 20}]
    mark(sj)


def rot(S):
    rb = S.get("Rotten Blood")
    _drop_fx(rb, "NNBe8t6D2Oom0eRC")
    _passive(rb, "res", "Rotten Blood", [("system.traits.dr.value", 2, "poison"), ("system.traits.dr.value", 2, "acid"),
                                         ("flags.midi-qol.advantage.ability.save.con", 0, "0")])
    rb["effects"][-1]["changes"] = rb["effects"][-1]["changes"][:2]
    a = rb["system"]["activities"]["qxwr7MCLQF64tLOc"]
    a["name"] = "Rotten Blood (once per turn on hit while hurt)"
    a["useConditionText"] = 'reaction === "isHit"'
    a["target"] = one_creature()
    scale(rb, a, [[1, "1d8"], [3, "2d8"], [6, "3d8"], [11, "4d8"]])
    free(rb, a)
    note(rb, "Advantage on saves vs poisoned (GM). Blood Bags: alternate HP source for Rot costs (untick the HP cost).")
    mark(rb)

    rt = S.get("Rot Techniques")
    _drop_fx(rt, "iRCwpF7nAJ8IBWMv", "9bVy7WKxTZ12kDrf")
    rt["system"]["activities"] = {}
    rt["flags"]["jjk5e"]["ceCosts"] = {}
    blind = "jjkBloodSpitBlnd"
    for e in rt["effects"]:
        if e["_id"] == blind: e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnEnd"]
    spec = [
        ("spit", "save", "Blood Spit (1 CE, 2 HP)", "action", 1, 2, dict(save=_sv("con"), damage={"onSave": "none", "parts": [dice(2, 6, ["acid"])]},
                                                                       range=_r(15), target=one_creature()), [blind]),
        ("burst", "damage", "Rot Burst (on melee hit, 1 CE, 1 HP)", "special", 1, 1, dict(damage={"parts": [dice(2, 8, ["acid"])]}, target=one_creature()), []),
        ("beam", "attack", "Rotten Blood Beam (3 CE, 4 HP)", "action", 3, 4, dict(attack=_atk(), damage={"includeBase": False, "parts": [dice(2, 8, ["piercing"]), dice(2, 10, ["acid"])]},
                                                                                 range=_r(30), target=one_creature()), []),
        ("wave", "save", "Corrosive Wave (3 CE, 5 HP)", "action", 3, 5, dict(save=_sv("con"), damage={"onSave": "half", "parts": [dice(5, 8, ["acid"])]},
                                                                            range=RANGE_SELF, target=sphere(15, kind="cone")), []),
        ("missile", "attack", "Homing Blood Missile (4 CE, 5 HP; 6th)", "action", 4, 5, dict(attack=_atk(), damage={"includeBase": False, "parts": [dice(5, 10, ["acid"], bonus=CEMOD)]},
                                                                                            range=_r(60), target=one_creature()), []),
        ("soak", "utility", "Blood Soak (3 CE, 3 HP; 6th)", "bonus", 3, 3, dict(range=RANGE_SELF, target=SELF), []),
        ("spear", "attack", "Crimson Spear (2 CE, 3 HP; 11th)", "action", 2, 3, dict(attack=_atk(), damage={"includeBase": False, "parts": [dice(1, 6, ["piercing"]), dice(2, 10, ["acid"], bonus=CEMOD)]},
                                                                                     range={"value": "30", "long": "90", "units": "ft", "override": True}, target=one_creature()), []),
        ("rain", "save", "Crimson Rain (2 CE, 3 HP; 11th)", "action", 2, 3, dict(save=_sv("dex"), damage={"onSave": "half", "parts": [dice(1, 10, ["acid"])]},
                                                                                range=_r(60), target=sphere(15)), []),
    ]
    for key, typ, nm, at, ce, hp, kw, fxs in spec:
        x = act(rt, key, typ, nm, at, **kw)
        if fxs: apply(x, *fxs)
        hp_cost(x, hp)
        cost(rt, x, ce)
        if key == "burst": x["useConditionText"] = 'reaction === "isHit"'
        if key == "soak":
            apply(x, fx(rt, "soak", "Blood Soak", rounds=10, changes=[("system.attributes.movement.walk", 2, "+10")],
                        desc="Unarmed strikes deal 2d6 + CE mod acid."))
    sh = act(rt, "shield", "heal", "Blood Shield (reaction): 10 HP per CE, 2 HP per CE", "reaction", range=RANGE_SELF, target=SELF,
             healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                      "custom": {"enabled": True, "formula": "10 * @scaling"}, "scaling": {}})
    sh["useConditionText"] = 'reaction === "isDamaged"'
    hp_cost(sh, 2, 2)
    cost(rt, sh, 1, 1, CEMOD)
    note(rt, "HP costs are charged automatically: untick them in the dialog when using a Blood Bag. Crimson Rain damage: check the full text "
             "(1d10 shown). Blood Shield reducing a melee hit to 0: attacker CON or 2d8 acid.")
    mark(rt)

    dc = S.get("Decay", technique="Rot")
    a = dc["system"]["activities"]
    on = a["BOJsbDVm4WDuB6Fd"]
    on["name"] = "Decay (3 CE): infect everyone you hurt this minute"
    on["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    dfx = fx(dc, "rot", "Decay", rounds=10,
             changes=[("flags.midi-qol.OverTime", 0, "turn=start, damageRoll=(1 + floor(min(JJKORIGINLEVEL, 3) / 3) + floor(min(JJKORIGINLEVEL, 6) / 6) + floor(min(JJKORIGINLEVEL, 11) / 11))d8, damageType=acid, label=Decay")],
             desc="Rotten Blood damage at the start of the caster's turn (applied at its own turn start). At 6th: poisoned and max HP reduced.")
    apply(on, dfx)
    a["ZLbekNXVENiDTvps"]["name"] = "Continue Decay (3 CE)"
    apply(a["ZLbekNXVENiDTvps"], dfx, "OYJHMek81mP6nhQL")
    for e in dc["effects"]:
        if e["_id"] == "OYJHMek81mP6nhQL": e["duration"] = {"rounds": 10}
    mark(dc)

    sr = S.get("Scarlet Rot")
    _drop_fx(sr, "DqYDGSrvprQayJZW")
    _passive(sr, "imm", "Scarlet Rot", [("system.traits.di.value", 2, "poison"), ("system.traits.di.value", 2, "acid"),
                                        ("system.traits.ci.value", 2, "poisoned")])
    a = sr["system"]["activities"]["MlQVR5ZUCE8FRAzA"]
    a["name"] = "Failed save vs Rot: poisoned 1 minute"
    a["target"] = one_creature()
    a["type"] = "utility"
    a.pop("damage", None)
    a.pop("save", None)
    ot_save(sr, "gb3txyFerIE5LEO8", "con", "Scarlet Rot", when="end")
    free(sr, a)
    note(sr, "Your Rot techniques ignore acid resistance (18th: immunity → resistance).")
    mark(sr)

    wk = S.get("Maximum: Wing King")
    _drop_fx(wk, "rOTqIOlWWnZtasa5")
    a = wk["system"]["activities"]
    on = a["OdcZP46Jv7sO5dYd"]
    on["range"], on["target"] = RANGE_SELF, SELF
    apply(on, fx(wk, "wings", "Wing King", rounds=10,
                 changes=[("system.attributes.movement.walk", 1, "4"), ("system.attributes.movement.fly", 4, "floor(@attributes.movement.walk * 2)"),
                          ("flags.midi-qol.advantage.ability.save.dex", 0, "1")],
                 desc="Speed ×4, fly = half that, advantage on DEX saves; three free blood-line attacks per turn; no Decay."))
    ln = a["UFgrZvfA5S0POj5u"]
    ln["name"] = "Line of blood (3 free per turn)"
    ln["range"], ln["target"] = _r(60), one_creature()
    ln["attack"] = _atk()
    ln["damage"] = {"includeBase": False, "parts": [dice(4, 10, ["acid", "necrotic"], bonus=CEMOD)]}
    free(wk, ln)
    mark(wk)

    d = S.get("Domain Expansion: Mind Palace of Corrupted Ego")
    x = act(d, "init20", "damage", "Initiative 20: extra Decay damage (all)", "special",
            damage={"parts": [dice(4, 8, ["acid"])]}, target={"affects": {"type": "enemy", "choice": False}, "override": True})
    free(d, x)
    note(d, "Everyone is under Decay; your Rot HP costs can be paid by other creatures in the domain.")
    mark(d)

    lb = S.get("Lifeblood")
    lb.setdefault("system", {}).setdefault("activities", {})
    h = act(lb, "heal", "heal", "Lifeblood: heal instead of damage", "special", target=one_creature(),
            healing={"number": None, "denomination": None, "bonus": "", "types": ["healing"],
                     "custom": {"enabled": True, "formula": "0"}, "scaling": {}})
    free(lb, h)
    note(lb, "Enter the technique's damage as the heal. +2 CE: the target saves CON; on a success it regains 2 × Rotten Blood damage more.")
    mark(lb)


def schrift_x(S):
    ps = S.get("Piercing Schrift")
    a = ps["system"]["activities"]["LfH3LW4pEsZnebcw"]
    act(ps, "LfH3LW4pEsZnebcw", "utility", "Phase through cover (1 CE, on a ranged attack)", "special", range=RANGE_SELF, target=SELF)
    apply(ps["system"]["activities"]["LfH3LW4pEsZnebcw"],
          fx(ps, "phase", "Piercing shot", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.ignoreCover", 5, "1")],
             desc="Ignore cover (5 ft of 1/2/3/4 objects at 1st/3rd/6th/11th)."))
    _passive(ps, "ce", "Piercing Schrift (CE mod for ranged)", [("system.bonuses.rwak.attack", 2, f"+ max(0, {CEMOD} - @abilities.dex.mod)"),
                                                               ("system.bonuses.rwak.damage", 2, f"+ max(0, {CEMOD} - @abilities.dex.mod)")])
    mark(ps)

    xs = S.get("X-Axis Shot")
    a = xs["system"]["activities"]["iuRxDAeUgMb2vW57"]
    a["name"] = "X-Axis Shot (3 CE): auto-hit + necrotic"
    a["range"] = _r(150)
    a["target"] = one_creature()
    scale(xs, a, [[1, "2d6"], [6, "3d6"], [11, "5d6"], [18, "7d6"]])
    apply(a, fx(xs, "stop", "X-Axis stance", special=["turnEnd"], changes=[("system.attributes.movement.all", 0, "0")]))
    a["effects"] = []
    me = act(xs, "self", "utility", "After the shot: speed 0 this turn", "special", range=RANGE_SELF, target=SELF)
    apply(me, xs["effects"][-1]["_id"])
    free(xs, me)
    note(xs, "Also roll your weapon damage (automatic hit, no attack roll). Only if you haven't moved this turn.")
    mark(xs)

    cm = S.get("Cursed Mark")
    a = cm["system"]["activities"]["zqMCIv6aDmtyaGTc"]
    a["name"] = "Critical Mark (3 CE)"
    a["range"], a["target"] = _r(30), one_creature()
    apply(a, fx(cm, "crit", "Critical Mark", rounds=10, changes=[("flags.midi-qol.grants.advantage.attack.all", 0, "1"),
                                                               ("flags.midi-qol.grants.critical.all", 0, "1")],
                special=["isHit"], desc="Next hit by the caster is at advantage and deals critical damage, then the mark ends (simplified: from the first hit)."))
    mm = act(cm, "multi", "utility", "Multi-Mark (3 CE, up to CE mod targets)", "bonus", range=_r(30),
             target={"affects": {"type": "creature", "count": CEMOD, "choice": True}, "override": True})
    apply(mm, fx(cm, "multi", "Multi-Mark", rounds=10, desc="One split ranged attack hits each marked creature (attack each)."))
    cost(cm, mm, 3)
    mark(cm)

    it = S.get("Intangibility")
    a = it["system"]["activities"]["g0O4BVsbYrP8wuHQ"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(it, "ghost", "Intangible", rounds=10,
                changes=[("system.traits.di.value", 2, "bludgeoning"), ("system.traits.di.value", 2, "piercing"), ("system.traits.di.value", 2, "slashing"),
                         ("system.traits.dr.all", 0, "1")],
                desc="Concentration; no innate technique features. Psychic damage is not resisted (remove by hand if relevant)."))
    mark(it)

    d = S.get("Domain Expansion: Divine Sight")
    x = act(d, "init20", "utility", "Initiative 20: Cursed Mark on everyone", "special",
            target={"affects": {"type": "enemy", "choice": False}, "override": True})
    apply(x, fx(d, "mark", "Divine Sight mark", rounds=10, changes=[("flags.midi-qol.grants.advantage.attack.all", 0, "1")]))
    free(d, x)
    mark(d)

    sy = S.get("Schrift Y")
    a = sy["system"]["activities"]["jaLUqT7JrFbjYlre"]
    a["range"], a["target"] = _r(30), one_creature()
    apply(a, fx(sy, "cover", "Schrift Y", rounds=2, special=["turnEnd"],
                changes=[("system.bonuses.mwak.attack", 2, "-(2 + 3 * floor(min(@details.level, 11) / 11))"),
                         ("system.bonuses.rwak.attack", 2, "-(2 + 3 * floor(min(@details.level, 11) / 11))"),
                         ("system.bonuses.msak.attack", 2, "-(2 + 3 * floor(min(@details.level, 11) / 11))"),
                         ("system.bonuses.rsak.attack", 2, "-(2 + 3 * floor(min(@details.level, 11) / 11))")],
                desc="Its attacks treat everyone as behind half cover (¾ at 11th)."))
    mark(sy)

    yb = S.get("Y-Axis Block")
    a = yb["system"]["activities"]["kFSP0E0XaviUEKfl"]
    a["name"] = "Y-Axis Block (6 CE): a ranged attack misses"
    a["activation"]["type"] = "reaction"
    a["useConditionText"] = 'reaction === "isAttacked"'
    a["range"], a["target"] = _r(120), one_creature()
    a["activation"]["condition"] = "Target the attacker: its attack automatically misses."
    apply(a, fx(yb, "miss", "Y-Axis Block", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.fail.attack.all", 0, "1")]))
    mark(yb)


def seance(S):
    se = S.get("Seance")
    a = se["system"]["activities"]
    on = a["yn7JrUsDc5H8JdGr"]
    on["name"] = "Seance (full turn, 2 CE per information)"
    on["range"], on["target"] = _r(15), one_creature()
    on["type"] = "heal"
    on["healing"] = {"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                     "custom": {"enabled": True, "formula": "@prof"}, "scaling": {}}
    cost(se, on, 2, 2, "4")
    apply(on, fx(se, "seance", "Seance", rounds=None, desc="Channelling a dead humanoid (Physical: body, traits, STR/DEX/CON; Soul: memories + 1 feature). "
                                                         "No own innate technique. 1 CE per turn to maintain."))
    ch = a["JitvMjiNFYyLPFjU"]
    ch["name"] = "Soul Information: CHA save vs the dead (upkeep 1 CE)"
    ch["activation"]["type"] = "special"
    ch["target"] = one_creature()
    ch["save"]["dc"] = {"calculation": "", "formula": "8 + @prof + @abilities.cha.mod"}
    ch["damage"] = {"onSave": "none", "parts": []}
    note(se, "Soul save DC should use the dead humanoid's prof + CHA: edit the formula.")
    mark(se)

    bg = S.get("Blessing of the Grateful Dead")
    a = bg["system"]["activities"]["8cRxZpTSthq8DyY2"]
    a["name"] = "Physical channelling: temp HP (level + prof)"
    a["target"] = one_creature()
    a["healing"] = {"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                    "custom": {"enabled": True, "formula": "@details.level + @prof"}, "scaling": {}}
    free(bg, a)
    note(bg, "Soul channelling: 2 of the dead's features, keeping your own (not from two techniques at once).")
    mark(bg)

    rr = S.get("Ritual of Resurrection")
    rr.setdefault("system", {}).setdefault("activities", {})
    x = act(rr, "ritual", "utility", "Ritual (full turn each round, 1 minute)", "action", range=_r(30), target=one_creature())
    apply(x, fx(rr, "rit", "Resurrection ritual", rounds=10, desc="Concentration; then transform into a dead humanoid of CR/level ≤ your level + prof."))
    free(rr, x)
    mark(rr)

    bs = S.get("Maximum: Black Seance")
    a = bs["system"]["activities"]["721nZ5oYwxoP5WfB"]
    a["name"] = "Overload (+5 CE after the ritual)"
    a["type"] = "heal"
    a["target"] = one_creature()
    a["healing"] = {"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                    "custom": {"enabled": True, "formula": "0"}, "scaling": {}}
    note(bs, "Physical Overload: enter the dead's HP as temp HP. Soul Overload: all its features (minimum CE costs, no domain).")
    mark(bs)

    d = S.get("Domain Expansion: Seance Parlor")
    x = act(d, "init20", "utility", "Initiative 20: Seance on a willing creature (free)", "special", range=_r(175), target=one_creature())
    free(d, x)
    note(d, "No upkeep; auto-succeed the soul save; seance techniques get the guaranteed hit. Body part need only be held.")
    mark(d)

    po = S.get("Possession")
    a = po["system"]["activities"]
    a["886Pnz5kN0SnYAWF"]["name"] = "Possess (full turn, 8 CE)"
    a["886Pnz5kN0SnYAWF"]["range"], a["886Pnz5kN0SnYAWF"]["target"] = _r(5), one_creature()
    a["886Pnz5kN0SnYAWF"]["effects"] = []
    body = act(po, "body", "utility", "Your body falls unconscious", "special", range=RANGE_SELF, target=SELF)
    apply(body, "oALlN7r7MOQmcoD1")
    free(po, body)
    a["dEqDSnBQ0OyqQ900"]["name"] = "Keep control (1 CE, start of turn)"
    a["dEqDSnBQ0OyqQ900"]["activation"]["type"] = "special"
    note(po, "Willing or helpless target. Control its token; you keep your stats except its technique features and CE.")
    mark(po)


def shadow_killer(S):
    ss = S.get("Shadow Strike")
    a = ss["system"]["activities"]["HlmIkdzNN0hw6cen"]
    act(ss, "HlmIkdzNN0hw6cen", "damage", "Shadow Strike (on attack, 1 CE): necrotic + CE mod", "special", target=one_creature(),
        damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["necrotic"],
                "custom": {"enabled": True, "formula": f"(1 + floor(min(@details.level, 3) / 3) + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11)) * {CEMOD}"}, "scaling": {}}]})
    ss["system"]["activities"]["HlmIkdzNN0hw6cen"]["useConditionText"] = 'reaction === "isHit"'
    note(ss, "Bonus necrotic = CE mod (×2/×3/×4 at 3rd/6th/11th); the attack's own damage becomes necrotic. Unaware target: automatic hit. "
             "Attack roll > its passive Perception: it doesn't know how it was hurt.")
    mark(ss)

    db = S.get("Dark Binding")
    a = db["system"]["activities"]["Zcv5CmDFLDrHq7ee"]
    a["name"] = "Pin the shadow (on hit, 3 CE, no damage)"
    a["activation"]["type"] = "special"
    a["useConditionText"] = 'reaction === "isHit"'
    a["target"] = one_creature()
    a["effects"].append({"_id": fx(db, "rest", "Restrained (shadow pinned)", rounds=None, statuses=["restrained"]), "onSave": False})
    mark(db)

    vs = S.get("Void Steps")
    a = vs["system"]["activities"]["fGhCrm4JNr846uYP"]
    a["name"] = "Pass Without Trace (2 CE)"
    a["range"], a["target"] = RANGE_SELF, sphere(30)
    a["target"]["affects"]["type"] = "ally"
    a["effects"] = [{"_id": fx(vs, "pwt", "Pass Without Trace", rounds=600, changes=[("system.skills.ste.bonuses.check", 2, "+10")]), "onSave": False}]
    hide = act(vs, "hide", "utility", "Hide in dim light: invisible", "special", range=RANGE_SELF, target=SELF)
    apply(hide, "7iV76RQuDuBBE9qM")
    for e in vs["effects"]:
        if e["_id"] == "7iV76RQuDuBBE9qM": e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["1Attack", "1Spell"]
        if e["_id"] == "LQOpXmQkMQA0kGRj": e["disabled"] = False
    free(vs, hide)
    mark(vs)

    sm = S.get("Shadows of Mortality")
    a = sm["system"]["activities"]["11e01xD5dgvWWq2W"]
    a["name"] = "Free Shadow Strike (1 CE, once per turn)"
    apply(a, fx(sm, "crit", "Shadows of Mortality", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.critical.all", 0, "1")],
                desc="Critical if the target hasn't acted yet or is surprised (remove otherwise); no Black Flash."))
    mark(sm)

    d = S.get("Domain Expansion: Zero Hour")
    x = act(d, "init20", "damage", "Initiative 20: full Shadow Strike on 3 creatures", "special",
            target={"affects": {"type": "enemy", "count": "3", "choice": True}, "override": True},
            damage={"parts": [{"number": 1, "denomination": 8, "bonus": "", "types": ["necrotic"],
                    "custom": {"enabled": True, "formula": f"1d8 + @mod + 4 * {CEMOD}"}, "scaling": {}}]})
    free(d, x)
    note(d, "Weapon die shown as d8. Every shadow can be targeted inside the domain.")
    mark(d)

    mf = S.get("Merciful Shadow")
    a = mf["system"]["activities"]["4GIP7jlbxOCUYosw"]
    act(mf, "4GIP7jlbxOCUYosw", "heal", "Merciful Shadow (on hit, 2 CE): heal", "special", target=one_creature(),
        healing={"number": None, "denomination": None, "bonus": "", "types": ["healing"],
                 "custom": {"enabled": True, "formula": f"1d8 + @mod + (1 + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11)) * {CEMOD}"}, "scaling": {}})
    note(mf, "Healing = your attack's damage (weapon die d8 shown) + CE mod (×2 at 6th, ×3 at 11th).")
    mark(mf)

    sr = S.get("Shadow Release")
    a = sr["system"]["activities"]["jwGAvYjpOP58OqlB"]
    a["range"], a["target"] = _r(10), one_creature()
    a["roll"] = {"formula": f"1d20 + {CEMOD} + @prof", "name": "CE check vs binding DC", "prompt": False, "visible": True}
    mark(sr)


DIS_BASE = "(1 + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))"


def shrine(S):
    dm = S.get("Dismantle")
    a = dm["system"]["activities"]["JFolT83oXSYI2EbK"]
    a["name"] = "Dismantle (1+ CE, replaces an attack)"
    a["activation"]["type"] = "special"
    a["range"] = {"value": "120", "long": "250", "units": "ft", "override": True}
    a["target"] = one_creature()
    a["attack"] = _atk()
    a["damage"] = {"includeBase": False, "parts": [{"number": None, "denomination": 12, "bonus": "", "types": ["slashing"],
                   "custom": {"enabled": True, "formula": f"({DIS_BASE} + @scaling - 1)d12"}, "scaling": {}}]}
    cost(dm, a, 1, 1, "@prof")
    a["attack"]["critical"]["threshold"] = None
    note(dm, "Damage: base dice (1/2/3/4 at 1st/6th/11th/18th) + 1d12 per extra CE. Advantage vs creatures whose passive Perception < your DC. "
             "Crit range +1 at 3rd, 6th, 11th and 18th (set the threshold).")
    mark(dm)

    cl = S.get("Cleave")
    a = cl["system"]["activities"]
    c = a["CSZMCFNURLLanC5o"]
    c["name"] = "Cleave (1–10 CE)"
    c["range"], c["target"] = _r(5), one_creature()
    c["attack"] = _atk("melee")
    c["damage"] = {"includeBase": False, "parts": [{"number": None, "denomination": 10, "bonus": "", "types": ["slashing"],
                   "custom": {"enabled": True, "formula": "(@prof + @scaling)d10"}, "scaling": {}}]}
    cost(cl, c, 1, 1, "10")
    sv = a["yYEZ6bLNOZFpVS1A"]
    sv["name"] = "Cleave: CON or adapted (ignores its resistances)"
    sv["target"] = one_creature()
    sv["damage"] = {"onSave": "none", "parts": []}
    apply(sv, fx(cl, "adapt", "Cleave-adapted", rounds=None, desc="Later Cleaves ignore its resistances (11th: immunity → resistance)."))
    free(cl, sv)
    trigger(c, sv, "hitTargets")
    mark(cl)

    df = S.get("Divine Flame Open")
    a = df["system"]["activities"]["u7pikmLFeX1CnNuV"]
    a["range"] = {"value": "150", "long": "600", "units": "ft", "override": True}
    a["target"] = sphere(15)
    a["damage"] = {"onSave": "half", "parts": [dice(1, 12, ["fire"], scale=1)]}
    cost(df, a, 1, 1, "2 * @prof")
    note(df, "Creatures beyond 150 ft save at advantage.")
    mark(df)

    sl = S.get("Slicing and Severing")
    a = sl["system"]["activities"]["QsakKkiLYbg9IwKI"]
    a["name"] = "Dismantle as bonus action / reaction"
    note(sl, "Use Dismantle's activity, changing its activation. Max Cleave (10 CE) can target a limb (Limb Damage table).")
    mark(sl)

    d = S.get("Domain Expansion: Malevolent Shrine")
    for key, nm, die, n, typ in [("dis", "Initiative 20: max Dismantle (everything)", 12, "(" + DIS_BASE + " + @prof - 1)", "slashing"),
                                 ("cle", "Initiative 20: max Cleave (creatures with CE)", 10, "(@prof + 10)", "slashing")]:
        x = act(d, key, "damage", nm, "special", target={"affects": {"type": "enemy", "choice": False}, "override": True},
                damage={"parts": [{"number": None, "denomination": die, "bonus": "", "types": [typ],
                        "custom": {"enabled": True, "formula": f"{n}d{die}"}, "scaling": {}}]})
        free(d, x)
    mark(d)

    asb = S.get("Assemble")
    asb.setdefault("system", {}).setdefault("activities", {})
    h = act(asb, "heal", "heal", "Assemble (replaces a Dismantle): 2d8 per 2 CE", "special",
            range={"value": "120", "long": "250", "units": "ft", "override": True}, target=one_creature(),
            healing={"number": 2, "denomination": 8, "bonus": "", "types": ["healing"], "custom": {"enabled": False, "formula": ""},
                     "scaling": {"mode": "whole", "number": 1}})
    cost(asb, h, 2, 2, f"2 * {CEMOD} + floor(min(@details.level, 18) / 18) * {CEMOD}")
    note(asb, "Wounded limbs receive double.")
    mark(asb)


def sky_manipulation(S):
    sk = S.get("Sky Shape")
    a = sk["system"]["activities"]["65BKEHCfUk8GGVuH"]
    act(sk, "65BKEHCfUk8GGVuH", "utility", "Sky Shape (1 CE): +4 AC", "reaction", range=RANGE_SELF, target=SELF)
    a = sk["system"]["activities"]["65BKEHCfUk8GGVuH"]
    a["useConditionText"] = 'reaction === "isAttacked"'
    apply(a, fx(sk, "ac", "Sky Shape", special=["turnStartSource"], changes=[("system.attributes.ac.bonus", 2, "+4")]))
    red = act(sk, "redirect", "attack", "Redirect a missed ranged attack", "special", target=one_creature(), attack=_atk())
    free(sk, red)
    stuck = act(sk, "stuck", "utility", "Missed melee: limb stuck", "special", target=one_creature())
    apply(stuck, fx(sk, "stuck", "Limb stuck in the sky", special=["turnStart"], desc="That limb is unusable until its next turn."))
    free(sk, stuck)
    note(sk, "Redirect deals the missed attack's damage and effects (enter them). While Dodging: protect allies within 5 ft.")
    mark(sk)

    sa = S.get("Sky Armor")
    a = sa["system"]["activities"]["s0Kr9fzi8LOIBbKi"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(sa, "armor", "Sky Armor", rounds=600,
                changes=[("system.attributes.ac.calc", 5, "custom"), ("system.attributes.ac.formula", 5, f"11 + {CEMOD} + @prof"),
                         ("system.attributes.movement.fly", 4, "@attributes.movement.walk")],
                desc="AC 11 + CE mod + prof; fly = walk; covered parts invisible."))
    mark(sa)

    si = S.get("Sky Shape Improvement")
    a = si["system"]["activities"]["5EJNgzTlXThWRMQJ"]
    a["name"] = "Redirect a cone/line save (3 CE, on success)"
    a["useConditionText"] = 'reaction === "isSave"'
    note(si, "Sky Shape also works against CE attack rolls.")
    mark(si)

    ti = S.get("Thin Ice Breaker")
    a = ti["system"]["activities"]["9BMtt8kVD9uxtCUt"]
    a["range"] = RANGE_SELF
    a["target"] = {"template": {"type": "line", "size": "30", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                   "affects": {"type": "creature", "choice": False}, "override": True}
    a["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": 10, "bonus": "", "types": ["force"],
                   "custom": {"enabled": True, "formula": f"(2 * {CEMOD})d10"}, "scaling": {}}]}
    note(ti, "While you fly, creatures save at disadvantage.")
    mark(ti)

    d = S.get("Domain Expansion: Heaven’s Gate")
    x = act(d, "end", "damage", "Domain ends: maximum falling damage", "special",
            target={"affects": {"type": "enemy", "choice": False}, "override": True},
            damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["bludgeoning"],
                    "custom": {"enabled": True, "formula": "120"}, "scaling": {}}]})
    free(d, x)
    note(d, "Hostiles without fly speed are falling throughout (20d6 max = 120).")
    mark(d)

    sd = S.get("Sky Destruction")
    a = sd["system"]["activities"]["VpOKyQ5a2t0ycPpz"]
    a["range"], a["target"] = _r(60), sphere(20)
    a["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["bludgeoning"],
                   "custom": {"enabled": True, "formula": f"2 * {CEMOD} * @scaling"}, "scaling": {}}]}
    a["damage"]["parts"][0]["custom"]["formula"] = f"2 * {CEMOD}"
    st = act(sd, "stun", "utility", "Failed by 5+: stunned", "special", target=one_creature())
    apply(st, fx(sd, "stun", "Stunned (Sky Destruction)", statuses=["stunned"], special=["turnStartSource"]))
    free(sd, st)
    note(sd, "Damage: 2 × CE mod per creature/size it collides with (shown once — multiply).")
    mark(sd)


def solo_forbidden_zone(S):
    fz = S.get("Forbidden Zone")
    a = fz["system"]["activities"]["crsVEjXnAjWFoEnP"]
    a["range"], a["target"] = RANGE_SELF, sphere(30)
    a["target"]["affects"]["type"] = "ally"
    zone = fx(fz, "zone", "Forbidden Zone", rounds=10, changes=[("flags.midi-qol.advantage.all", 0, "1")],
              desc="Advantage on all rolls. Caster maintains with a bonus action.")
    apply(a, zone)
    keep = act(fz, "keep", "utility", "Maintain the Zone (bonus action)", "bonus", range=RANGE_SELF, target=SELF)
    free(fz, keep)
    mark(fz)

    bl = S.get("Bless", technique="Solo Forbidden Zone")
    a = bl["system"]["activities"]["8rBkNLHOAFcQBe5m"]
    a["range"], a["target"] = _r(60), one_creature()
    apply(a, fx(bl, "z", "Forbidden Zone (blessed)", rounds=10, changes=[("flags.midi-qol.advantage.all", 0, "1")]))
    mark(bl)

    rd = S.get("Ritual Dance")
    a = rd["system"]["activities"]["8g1i0F03tSYGgeU1"]
    a["name"] = "Seal the zone: hostiles WIS or can't enter/leave"
    a["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    a["damage"] = {"onSave": "none", "parts": []}
    apply(a, fx(rd, "seal", "Sealed by the Ritual Zone", rounds=10))
    free(rd, a)
    on = act(rd, "zone", "utility", "Ritual Zone (full turn, CE up to mod + prof)", "action", range=RANGE_SELF, target=sphere(50))
    on["target"]["affects"]["type"] = "ally"
    apply(on, fx(rd, "rz", "Ritual Zone", rounds=10,
                 changes=[("flags.midi-qol.advantage.all", 0, "1"), ("system.bonuses.msak.damage", 2, "+ (5 * @scaling)"),
                          ("system.bonuses.rsak.damage", 2, "+ (5 * @scaling)")],
                 desc="Advantage; +5 technique damage per CE; temp CE = CE spent; extra CE spending up to the caster's CE mod."))
    cost(rd, on, 1, 1, f"{CEMOD} + @prof")
    note(rd, "Concentration; move ≤ 10 ft; maintain with a bonus action.")
    mark(rd)

    mo = S.get("Maximize Output")
    a = mo["system"]["activities"]["V7fED709mCReQflf"]
    a["name"] = "Maximize an ally's technique damage (5 CE)"
    a["activation"]["type"] = "special"
    a["target"] = one_creature()
    apply(a, fx(mo, "max", "Maximized", rounds=1, special=["1Spell"], changes=[("flags.midi-qol.max.damage.all", 0, "1")]))
    mark(mo)

    d = S.get("Domain Expansion: Hallowed Zone")
    x = act(d, "zone", "utility", "Domain: max Ritual Zone for all allies", "special",
            target={"affects": {"type": "ally", "choice": False}, "override": True})
    apply(x, fx(d, "rz", "Hallowed Zone", rounds=10, changes=[("flags.midi-qol.advantage.all", 0, "1")],
                desc="Ritual Zone at maximum CE; allies' techniques are guaranteed hits."))
    free(d, x)
    mark(d)

    dz = S.get("Depletion Zone")
    a = dz["system"]["activities"]["hyuZ1bsrWzieYdoK"]
    a["name"] = "Depletion Zone (CE up to mod + prof)"
    a["range"], a["target"] = RANGE_SELF, sphere(15)
    a["target"]["affects"]["type"] = "enemy"
    apply(a, fx(dz, "drain", "Depletion Zone", rounds=10,
                changes=[("flags.midi-qol.OverTime", 0, "turn=start, saveAbility=wis|cha, saveDC=JJKORIGINDC, label=Depletion Zone (lose CE = caster's spend)")]))
    cost(dz, a, 1, 1, f"{CEMOD} + @prof")
    mark(dz)


def star_dictator(S):
    mi = S.get("Minor Star Shikigami")
    a = mi["system"]["activities"]["JhTld6NhLQKLlaBT"]
    a["name"] = "Summon minor stars (1 CE each, up to prof)"
    a["range"], a["target"] = _r(5), SELF
    cost(mi, a, 1, 1, "@prof")
    a["effects"] = []
    sh = act(mi, "senses", "utility", "Share senses with a star (blinded & deafened)", "action", range=RANGE_SELF, target=SELF)
    apply(sh, "3bD0fcEhNYxV2krG")
    sh["effects"].append({"_id": fx(mi, "deaf", "Deafened (sharing senses)", rounds=None, statuses=["deafened"]), "onSave": False})
    free(mi, sh)
    note(mi, "Command all with a bonus action; otherwise they Dodge. Max prof minor stars (3 × prof at 11th).")
    mark(mi)

    pd = S.get("Pseudo-Domain Constitution")
    a = pd["system"]["activities"]["cdUZnJ88N5QDCwP8"]
    a["name"] = "Pseudo-domain (end of your turn): DEX, 1d6 per orbiting star"
    a["activation"]["type"] = "special"
    a["target"] = sphere(5)
    a["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["slashing"],
                   "custom": {"enabled": True, "formula": "(@scaling)d(6 + 2 * floor(min(@details.level, 6) / 6) + 2 * floor(min(@details.level, 11) / 11))"}, "scaling": {}}]}
    free(pd, a)
    note(pd, "Scale = orbiting stars (enter it). Radius ≤ 5 ft × stars (10 ft × at 11th); +5 ft per bonus action.")
    mark(pd)

    mj = S.get("Major Star Shikigami")
    a = mj["system"]["activities"]["sb7OhoI9bvpaEuhF"]
    a["name"] = "Summon the major star (6 CE)"
    note(mj, "One at a time (two at 11th); killed: 1 hour before resummoning. Full turn: special pseudo-domain where minor stars move freely.")
    mark(mj)

    ar = S.get("Army of the Dictator")
    a = ar["system"]["activities"]["lKkrGWN2fudFZv1s"]
    a["name"] = "Army pseudo-domain (1d10 per star, ignores slashing resistance)"
    a["damage"] = {"parts": [dice(1, 10, ["slashing"], scale=1)]}
    a["target"] = sphere(10)
    free(ar, a)
    mark(ar)

    d = S.get("Domain Expansion: Divine Mandate")
    x = d["system"]["activities"]["vvbMyowtvHkpfGxJ"]
    x["name"] = "Initiative 20: 1d12 per star shikigami"
    x["target"] = {"affects": {"type": "enemy", "choice": True}, "override": True}
    x["damage"] = {"parts": [dice(1, 12, ["slashing"], scale=1)]}
    free(d, x)
    mark(d)

    sg = S.get("Star Guardian")
    a = sg["system"]["activities"]["gn5lWOYUUa8j6WTx"]
    a["type"] = "utility"
    a.pop("damage", None)
    a["name"] = "Anti-domain (4 CE)"
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(sg, "anti", "Star Guardian anti-domain", rounds=None, desc="Guaranteed hits and auto-fails don't work inside or on the orbiting stars."))
    hit = act(sg, "thorn", "damage", "Hitting an orbiting star: 1d12 slashing", "special", target=one_creature(),
              damage={"parts": [dice(1, 12, ["slashing"])]})
    free(sg, hit)
    mark(sg)


MASS_MAX = f"(2 + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11)) * {CEMOD}"


def star_rage(S):
    vm = S.get("Virtual Mass Increase")
    a = vm["system"]["activities"]["cuxPRyAQGDEgB5Up"]
    act(vm, "cuxPRyAQGDEgB5Up", "utility", "Virtual Mass Increase (X CE = X mass)", "bonus", range=RANGE_SELF, target=SELF)
    a = vm["system"]["activities"]["cuxPRyAQGDEgB5Up"]
    a["effects"] = []
    apply(a, fx(vm, "mass", "Virtual Mass", rounds=None,
                changes=[("system.bonuses.mwak.damage", 2, "+ @scaling"), ("flags.midi-qol.advantage.ability.check.str", 0, "0")],
                desc="+1 unarmed damage per mass (applied as melee damage); unarmed die +1 tier per 2 mass; +1 size per 2 mass for grapples. "
                     "Duration: CE mod rounds (×2/×3/×4 at 3rd/11th/18th). At 6th with 5+ mass: advantage on STR/CON checks and saves."))
    vm["effects"][-1]["changes"] = vm["effects"][-1]["changes"][:1]
    cost(vm, a, 1, 1, MASS_MAX)
    pr = act(vm, "impact", "save", "Mass Impact (on unarmed crit): CON or prone", "special", save=_sv("con"),
             damage={"onSave": "none", "parts": []}, target=one_creature())
    apply(pr, "8OKBKcaw9GgTDcde")
    free(vm, pr)
    note(vm, "Mass 2+: a creature within 5 ft also saves or takes half; 3: speed halved; 4: speed 0. Can't reactivate until the duration ends.")
    mark(vm)

    for nm, txt in [("Improved Duration", "Virtual Mass lasts 2 × CE mod rounds (3× at 11th, 4× at 18th)."),
                    ("Virtual Mass Improvement", "Up to 3 × CE mod mass; with 5+ mass: advantage on STR/CON checks and saves, +1 per further mass.")]:
        it = S.get(nm); note(it, txt); mark(it)
    vi = S.get("Virtual Mass Improvement")
    _passive(vi, "str", "Virtual Mass: Increased Strength (toggle)", [("flags.midi-qol.advantage.ability.save.str", 0, "1"),
             ("flags.midi-qol.advantage.ability.save.con", 0, "1"), ("flags.midi-qol.advantage.ability.check.str", 0, "1"),
             ("flags.midi-qol.advantage.ability.check.con", 0, "1")])
    vi["effects"][-1]["disabled"] = True

    mm = S.get("Virtual Mass Mastery")
    a = mm["system"]["activities"]["NoFMZTpqmPsDl0T9"]
    a["name"] = "Quick activation (free action)"
    note(mm, "Up to 4 × CE mod mass; works with melee weapons; crit range +1 per 4 mass; max damage to objects.")
    mark(mm)

    d = S.get("Domain Expansion: Event Horizon")
    x = d["system"]["activities"]["4Kinngzzx56fO6IL"]
    x["target"] = {"affects": {"type": "enemy", "choice": False}, "override": True}
    for e in d["effects"]:
        if e["_id"] == "2kllomSKc8EPOd0U":
            e["duration"] = {"rounds": 10}
            e["changes"] = [{"key": "system.attributes.movement.all", "mode": 1, "value": "0.25", "priority": 20},
                            {"key": "flags.midi-qol.OverTime", "mode": 0, "priority": 20,
                             "value": "turn=start, saveAbility=str, saveDC=JJKORIGINDC, label=Event Horizon (Athletics to stand)"}]
    free(d, x)
    mark(d)

    vd = S.get("Virtual Mass Decrease")
    a = vd["system"]["activities"]["MBFVtqxWvJil5f3W"]
    a["name"] = "Virtual Mass Decrease (X CE)"
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(vd, "light", "Mass Decrease", rounds=None,
                changes=[("system.attributes.movement.walk", 2, "+ (10 * @scaling)"), ("system.bonuses.mwak.attack", 2, "+ @scaling"),
                         ("system.bonuses.mwak.damage", 2, "- @scaling")]))
    cost(vd, a, 1, 1, "99")
    mark(vd)


def starlight_symphony(S):
    cf = S.get("Cursed Fog")
    a = cf["system"]["activities"]["B59JyS0jgQ8whyQG"]
    a["name"] = "Cursed Fog (1 CE per 10 ft)"
    a["range"], a["target"] = RANGE_SELF, sphere(10)
    apply(a, fx(cf, "fog", "In the Cursed Fog", rounds=10,
                changes=[("flags.midi-qol.disadvantage.skill.prc", 0, "1"), ("flags.midi-qol.disadvantage.skill.inv", 0, "1")],
                desc="Heavily obscured; can't detect CE."))
    cost(cf, a, 1, 1, f"(1 + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11)) * {CEMOD}")
    sw = act(cf, "sway", "utility", "Fog reaction (6th): advantage/disadvantage to a roll", "reaction", target=one_creature())
    sw["useConditionText"] = 'reaction === "isAttacked" || reaction === "isSave"'
    free(cf, sw)
    note(cf, "Radius = 10 ft per CE (enlarge the template).")
    mark(cf)

    kc = S.get("Kitsune Creation")
    a = kc["system"]["activities"]["hqsMkT3umtujwRFp"]
    a["name"] = "Summon a fox shikigami (2 CE)"
    a["range"], a["target"] = _r(10), SELF
    note(kc, "Up to prof foxes, 24 h; command all as a bonus action.")
    mark(kc)

    lf = S.get("Living Fog")
    a = lf["system"]["activities"]
    on = a["KCqJ5jPUyH5LMlo2"]
    on["name"] = "Become fog (3 CE, concentration 1 hour)"
    on["activation"]["type"] = "action"
    on["range"], on["target"] = RANGE_SELF, SELF
    apply(on, fx(lf, "mist", "Living Fog", rounds=600,
                 changes=[("system.attributes.movement.fly", 5, "30"), ("system.attributes.movement.walk", 5, "0"),
                          ("system.traits.dr.value", 2, "bludgeoning"), ("system.traits.dr.value", 2, "piercing"), ("system.traits.dr.value", 2, "slashing"),
                          ("flags.midi-qol.advantage.ability.save.str", 0, "1"), ("flags.midi-qol.advantage.ability.save.dex", 0, "1"),
                          ("flags.midi-qol.advantage.ability.save.con", 0, "1")]))
    ch = a["9o7rSli7874Z2Hgj"]
    ch["name"] = "Choke a creature whose space you occupy (CON)"
    ch["activation"]["type"] = "special"
    ch["target"] = one_creature()
    ch["effects"] = []
    ch["damage"] = {"onSave": "none", "parts": [{"number": None, "denomination": 8, "bonus": "", "types": ["cold"],
                    "custom": {"enabled": True, "formula": f"({CEMOD})d8"}, "scaling": {}}]}
    free(lf, ch)
    mark(lf)

    ia = S.get("Inari")
    a = ia["system"]["activities"]["BWeIMjTm6woMQob1"]
    a["name"] = "Summon Inari (full turn, 8 CE, 1 minute)"
    a["range"], a["target"] = _r(10), SELF
    mark(ia)

    d = S.get("Domain Expansion: Heaven and Earth")
    x = d["system"]["activities"]["gQ4rvsWTaXEAfjf5"]
    x["target"] = {"affects": {"type": "enemy", "choice": False}, "override": True}
    free(d, x)
    bl = act(d, "blind", "utility", "Domain: everyone else blinded in the fog", "special",
             target={"affects": {"type": "creature", "choice": False}, "override": True})
    apply(bl, fx(d, "blind", "Blinded (Heaven and Earth)", rounds=10, statuses=["blinded"]))
    free(d, bl)
    mark(d)

    df = S.get("Dark Fog")
    a = df["system"]["activities"]["3XdxfxM4hf2eM4ct"]
    a["name"] = "Dark Fog (2 CE per 10 ft): magical darkness"
    a["range"], a["target"] = RANGE_SELF, sphere(10)
    apply(a, fx(df, "dark", "In the Dark Fog", rounds=20,
                changes=[("flags.midi-qol.disadvantage.skill.prc", 0, "1"), ("flags.midi-qol.disadvantage.skill.inv", 0, "1")],
                desc="Magical darkness; auto-fail checks to detect CE."))
    cost(df, a, 2, 2, f"2 * {CEMOD}")
    mark(df)


RES_TABLE = [("minor", "Minor (blood/hair): disadvantage on attacks", "(@prof)d6", [("flags.midi-qol.disadvantage.attack.all", 0, "1")], None, "piercing"),
             ("medium", "Medium (teeth/skin/bone): no reactions", f"({CEMOD} + @prof)d8", [], None, "piercing"),
             ("major", "Major (limb): CON or stunned 1 minute", f"(2 * {CEMOD} + @prof)d10", [], "con", "piercing")]


def straw_doll(S):
    np_ = S.get("Nail Projectile")
    a = np_["system"]["activities"]["fQhKGcKWsr5KPuJW"]
    a["name"] = "Nail Projectile (1 CE): one of two nail attacks"
    a["range"] = {"value": "20", "long": "60", "units": "ft", "override": True}
    a["target"] = one_creature()
    a["attack"] = _atk()
    a["damage"] = {"includeBase": False, "parts": [dice(1, 6, ["piercing"], bonus=CEMOD)]}
    two = act(np_, "second", "attack", "Second nail (free, same action)", "special",
              range=dict(a["range"]), target=one_creature(), attack=_atk(),
              damage={"includeBase": False, "parts": [dice(1, 6, ["piercing"], bonus=CEMOD)]})
    free(np_, two)
    more = act(np_, "more", "utility", "Two more nails (+2 CE; reuse the attacks)", "special", range=RANGE_SELF, target=SELF)
    cost(np_, more, 2)
    note(np_, "Starts with 1 hammer, 24 nails, 1 straw doll (track nails). 6th: DC 10 DEX to recover nails by touch.")
    mark(np_)

    rs = S.get("Resonance")
    rs["system"]["activities"] = {}
    grab = act(rs, "grab", "utility", "Take a piece (reaction, Sleight of Hand vs AC)", "reaction", range=_r(5), target=one_creature(),
               roll={"formula": "1d20 + @skills.slt.total", "name": "Sleight of Hand vs AC", "prompt": False, "visible": True})
    grab["useConditionText"] = 'reaction === "isDamaged"'
    free(rs, grab)
    mix = act(rs, "mix", "utility", "Mix it into the doll (3 CE)", "special", range=RANGE_SELF, target=SELF)
    cost(rs, mix, 3)
    for key, nm, formula, ch, sv, typ in RES_TABLE:
        kw = dict(range=_r(200), target=one_creature())
        if sv:
            x = act(rs, key, "save", f"Resonate — {nm}", "action", save=_sv(sv),
                    damage={"onSave": "none", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["necrotic"],
                            "custom": {"enabled": True, "formula": formula}, "scaling": {}}]}, **kw)
            e = fx(rs, key, "Stunned (Resonance spikes)", rounds=10, statuses=["stunned"])
            ot_save(rs, e, "con", "Resonance spikes", when="end")
            apply(x, e)
            x["damage"]["onSave"] = "full"
        else:
            x = act(rs, key, "damage", f"Resonate — {nm}", "action",
                    damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["necrotic"],
                            "custom": {"enabled": True, "formula": formula}, "scaling": {}}]}, **kw)
            apply(x, fx(rs, key, nm.split(":")[0], rounds=2, special=["turnEnd"], changes=ch, desc=nm))
        free(rs, x)
    note(rs, "Piece size by damage taken: <10% minor, 25%+ medium, 50%+ major. 18th: Resonance also lowers max HP. "
             "Major part: the damage applies whether or not it saves.")
    mark(rs)

    hp_ = S.get("Hair Pin")
    a = hp_["system"]["activities"]
    a["dcQm0JQlx7Bps7r8"]["name"] = "Drive a nail (1 CE, +1d8 per extra CE)"
    a["dcQm0JQlx7Bps7r8"]["range"] = _r(60)
    cost(hp_, a["dcQm0JQlx7Bps7r8"], 1, 1, "20")
    b = a["eYayPO9O7w18fnMl"]
    b["name"] = "Hair Pin: detonate (bonus action or reaction)"
    b["target"] = sphere(10)
    b["damage"] = {"onSave": "half", "parts": [dice(1, 8, ["necrotic"], scale=1)]}
    free(hp_, b)
    note(hp_, "Detonation: 1d8 per nail plus extra CE invested (enter as scale).")
    mark(hp_)

    ir = S.get("Improved Resonance")
    a = ir["system"]["activities"]["EUvE5BEqnpxLhCtY"]
    act(ir, "EUvE5BEqnpxLhCtY", "attack", "Improved Resonance (6 CE): helpless target", "action", range=_r(5), target=one_creature(),
        attack=_atk("melee"), damage={"includeBase": False, "parts": [{"number": None, "denomination": 12, "bonus": "", "types": ["necrotic"],
                                      "custom": {"enabled": True, "formula": f"(2 * {CEMOD} + @prof)d12"}, "scaling": {}}]})
    a = ir["system"]["activities"]["EUvE5BEqnpxLhCtY"]
    a["effects"] = []
    apply(a, "6JIXMYW8Cl9z8NIa", fx(ir, "seal", "Resonance seal", rounds=10,
                                    changes=[("flags.midi-qol.OverTime", 0, "turn=end, saveAbility=cha, saveDC=JJKORIGINDC, label=Resonance seal (disadvantage)")],
                                    desc="Using CE: CHA save at disadvantage or the feature fails and the CE is wasted."))
    note(ir, "Only vs incapacitated, restrained, stunned, petrified or paralyzed creatures.")
    mark(ir)

    d = S.get("Domain Expansion: Wara Ningyo")
    x = act(d, "init20", "damage", "Initiative 20: full Improved Resonance on all", "special",
            target={"affects": {"type": "enemy", "choice": False}, "override": True},
            damage={"parts": [{"number": None, "denomination": 12, "bonus": "", "types": ["necrotic"],
                    "custom": {"enabled": True, "formula": f"(2 * {CEMOD} + @prof)d12"}, "scaling": {}}]})
    apply(x, fx(d, "prone", "Prone (Wara Ningyo)", statuses=["prone"]))
    free(d, x)
    mark(d)

    cd = S.get("Cursed Doll Transformation")
    a = cd["system"]["activities"]["eeUeptYrPITakZuR"]
    a["name"] = "Living straw doll (8 CE, with Resonance's reaction)"
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(cd, "doll", "Living Straw Doll", rounds=10, desc="The linked creature takes ¼ of the damage you take (rounded up), ignoring resistances."))
    share = act(cd, "share", "damage", "Shared pain: ¼ of your damage to the linked creature", "special", target=one_creature(),
                damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["necrotic"],
                        "custom": {"enabled": True, "formula": "0"}, "scaling": {}}]})
    free(cd, share)
    mark(cd)


def technique_extermination(S):
    ex = S.get("Extinguishment")
    a = ex["system"]["activities"]["Bqu7NpZJKf3s2nSO"]
    a["range"], a["target"] = _r(30), one_creature()
    a["damage"]["onSave"] = "half"
    scale(ex, a, [[1, "2d12"], [6, "5d12"]])
    apply(a, fx(ex, "null", "Extinguished", rounds=10,
                changes=[("flags.midi-qol.OverTime", 0, "turn=start, saveAbility=cha, saveDC=JJKORIGINDC, label=Extinguishment")],
                desc="Can't use Cursed Energy (6th: its cursed tools are suppressed too)."))
    mark(ex)
    ie = S.get("Improved Extinguishment")
    ie["system"]["activities"].pop("LXHgT0u724MFokVv", None)
    note(ie, "Extinguishment now deals 5d12 (already scaled) and suppresses the target's cursed tools.")
    mark(ie)

    ab = S.get("Angel’s Blessing")
    _drop_fx(ab, "gS44aDQtPAOuLsWn")
    _passive(ab, "res", "Radiant resistance", [("system.traits.dr.value", 2, "radiant")])
    a = ab["system"]["activities"]["0nxTBCkURsXi2ZOJ"]
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(ab, "wings", "Angel's wings", rounds=10,
                changes=[("system.attributes.movement.fly", 4, "floor(@attributes.movement.walk / (2 - floor(min(@details.level, 11) / 11)))")],
                desc="Pass through curtains and barriers made with CE ≤ your prof. +1 CE to extend 1 minute."))
    mark(ab)

    jl = S.get("Maximum: Jacob’s Ladder")
    a = jl["system"]["activities"]
    b = a["g5wT5D5gGs3zfogG"]
    b["range"], b["target"] = _r(200), sphere(10)
    b["damage"]["onSave"] = "half"
    apply(b, fx(jl, "null", "Extinguished (Jacob's Ladder)", rounds=20,
                changes=[("flags.midi-qol.OverTime", 0, "turn=start, saveAbility=cha, saveDC=JJKORIGINDC, label=Extinguishment")]))
    t = a["d4NcKOrJ2ZMIyrGf"]
    t["name"] = "Destroy a cursed object/barrier (6 CE): CE attack vs its DC"
    t["range"], t["target"] = _r(30), one_creature()
    t["attack"] = _atk()
    t["damage"] = {"includeBase": False, "parts": []}
    mo = act(jl, "maxout", "utility", "With Maximum Output: 30-ft circle, ignores damage reduction", "special", range=_r(200), target=sphere(30))
    free(jl, mo)
    note(jl, "Undead, cursed spirits and evil creatures save at disadvantage. On a hit the object/barrier is destroyed and neutralized.")
    mark(jl)

    d = S.get("Domain Expansion: Garden of Eden")
    x = act(d, "init20", "save", "Initiative 20: full Jacob's Ladder on all", "special", save=_sv("cha"),
            damage={"onSave": "half", "parts": [dice(10, 12, ["radiant"])]}, target={"affects": {"type": "enemy", "choice": False}, "override": True})
    apply(x, fx(d, "null", "Extinguished (Garden of Eden)", rounds=20,
                changes=[("flags.midi-qol.OverTime", 0, "turn=start, saveAbility=cha, saveDC=JJKORIGINDC, label=Extinguishment")]))
    free(d, x)
    mark(d)

    ti = S.get("Technique Ignition")
    a = ti["system"]["activities"]["E92xM6bYUV79BRkT"]
    a["range"], a["target"] = _r(60), one_creature()
    apply(a, fx(ti, "ign", "Ignited", rounds=10,
                changes=[("system.bonuses.msak.damage", 2, "+ JJKORIGINCEMOD"), ("system.bonuses.rsak.damage", 2, "+ JJKORIGINCEMOD")],
                desc="Technique damage dice +1 tier (by hand) and + caster's CE mod. Afterwards: Extinguishment effects."))
    mark(ti)


def teleportation(S):
    tp = S.get("Teleport", technique="Teleportation")
    a = tp["system"]["activities"]
    m = a["wqrqC6e1z4KlqTfS"]
    m["name"] = "Mark (1 CE, touch)"
    m["range"], m["target"] = _r(5), one_creature()
    apply(m, fx(tp, "mark", "Teleport mark", rounds=7200, desc="Marked (12 h; 1 week at 6th; indefinite with Improved Marking)."))
    tp["system"]["uses"] = {"max": "2 * " + CEMOD, "spent": 0, "recovery": []}
    m.setdefault("consumption", {"targets": [], "scaling": {"allowed": False}})["targets"].append({"type": "itemUses", "target": "", "value": "1", "scaling": {}})
    g = a["HDAzFniPvfLmVc8K"]
    g["name"] = "Teleport to a mark (2 CE, unseen)"
    g["range"] = {"value": f"500 * (1 - floor(min(@details.level, 3) / 3)) + 100 * ({CEMOD} + @prof + @details.level) * floor(min(@details.level, 3) / 3)",
                  "units": "ft", "override": True}
    g["target"] = sphere(5)
    g["target"]["affects"]["type"] = "ally"
    note(tp, "Item uses = active marks (2 × CE mod; 3 × at 11th): restore a use when a mark is removed.")
    mark(tp)

    it = S.get("Improved Teleport")
    r = it["system"]["activities"]["ZYDoOOjcalF9uP1m"]
    r["name"] = "Teleport as a reaction (2 CE, hidden from view)"
    r["useConditionText"] = 'reaction === "isAttacked" || reaction === "isSave"'
    cost(it, r, 2)
    mark(it)

    mt = S.get("Mastered Teleport")
    a = mt["system"]["activities"]["Lu6UGCZdxpVaSSdR"]
    a["name"] = "Teleport spell to a mark (8 CE, exact)"
    a["range"] = {"units": "any", "override": True}
    un = act(mt, "unwilling", "save", "Teleport an unwilling creature (CE save)", "action", save=_sv(["wis", "cha"]),
             damage={"onSave": "none", "parts": []}, range=_r(5), target=one_creature())
    cost(mt, un, 2)
    mark(mt)

    im = S.get("Improved Marking")
    a = im["system"]["activities"]["q2UBntDo4yawiuxr"]
    a["name"] = "Permanent mark (5 CE)"
    a["activation"]["type"] = "special"
    note(im, "Marking is a free action; up to 3 × CE mod marks (raise Teleport's uses max).")
    mark(im)

    d = S.get("Domain Expansion: Crossroads of Instance")
    x = d["system"]["activities"]["7XOi7avGmoip40nk"]
    x["name"] = "Teleport a creature (reaction, domain)"
    x["target"] = one_creature()
    free(d, x)
    i = act(d, "init20", "utility", "Initiative 20: relocate up to 2 × CE mod creatures", "special",
            target={"affects": {"type": "creature", "count": "2 * " + CEMOD, "choice": True}, "override": True})
    free(d, i)
    mark(d)

    gr = S.get("Grounding")
    a = gr["system"]["activities"]["14o9RFO6KUqSMXCP"]
    act(gr, "14o9RFO6KUqSMXCP", "save", "Grounding (2 CE): speed 0", "bonus", save=_sv(["wis", "cha"]),
        damage={"onSave": "none", "parts": []}, range=_r(5), target=one_creature())
    apply(gr["system"]["activities"]["14o9RFO6KUqSMXCP"],
          fx(gr, "stay", "Grounded", rounds=10, changes=[("system.attributes.movement.all", 0, "0"),
             ("flags.midi-qol.OverTime", 0, "turn=end, saveAbility=wis|cha, saveDC=JJKORIGINDC, label=Grounding")]))
    mark(gr)


def tool_manipulation(S):
    gc = S.get("Guided Control")
    for e in gc["effects"]:
        if e["_id"] == "uWC4DhaCdYoyYehD": e["transfer"] = False
    a = gc["system"]["activities"]["gC0eBQ0A4zsYoz5F"]
    a["name"] = "Imbue held tool (1 CE per hour, up to CE mod)"
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(gc, "imb", "Imbued tool", rounds=600,
                changes=[("system.bonuses.mwak.attack", 2, "+2"), ("system.bonuses.rwak.attack", 2, "+2")],
                desc="+2 attack with the tool (or +1 AC if armor/defensive); damage die +1 tier (again at 6th and 11th)."))
    cost(gc, a, 1, 1, CEMOD)
    gc["effects"] = [e for e in gc["effects"] if e["_id"] != "uWC4DhaCdYoyYehD"]
    mark(gc)

    ft = S.get("Floating Tool")
    a = ft["system"]["activities"]
    a["U55lRROmCeODfjoZ"]["name"] = "Create Floating Tool (+2 CE; 1 CE at 6th)"
    a["Lzlk2ZqnzFIceqvs"]["name"] = "Floating Tool extra (legacy cost)"
    ft["system"]["activities"].pop("Lzlk2ZqnzFIceqvs", None)
    st = a["Im9iQPF49NGk56zC"]
    st["name"] = "Command Floating Tool: move 35 ft and attack"
    st["range"] = _r(120)
    st["target"] = one_creature()
    st["attack"] = _atk("melee")
    st["damage"] = {"includeBase": False, "parts": [dice(1, 4, ["bludgeoning"], bonus=CEMOD)]}
    free(ft, st)
    note(ft, "Weapon tools use their own damage (1d4 improvised shown). Tool AC = your CE DC, HP 5 × prof (+10 per cursed grade above 4th).")
    mark(ft)

    fi = S.get("Floating Tool Improvement")
    for e in fi["effects"]:
        if e["_id"] == "rbGUNT6ozXzx8rhX": e["name"] = "Riding a Floating Tool (toggle)"; e["disabled"] = True
    note(fi, "Toggle the fly effect while mounted. 2 tools at once; move 40 ft.")
    mark(fi)

    ct = S.get("Combat Tool Improvement")
    a = ct["system"]["activities"]["akoyaBelu1j40XNt"]
    a["name"] = "Tool guard (reaction): +AC by size"
    a["useConditionText"] = 'reaction === "isAttacked"'
    a["range"], a["target"] = RANGE_SELF, SELF
    a["roll"] = {"formula": "1d1", "name": "", "prompt": False, "visible": False}
    a.pop("roll")
    apply(a, fx(ct, "ac", "Tool guard", rounds=1, special=["isAttacked"],
                changes=[("system.attributes.ac.bonus", 2, "+3")], desc="Medium tool assumed (+3): Tiny +1 … Huge +5 (+1 at 11th)."))
    red = act(ct, "reduce", "heal", "Tool guard: reduce damage (2d6 medium)", "reaction", range=RANGE_SELF, target=SELF,
              healing={"number": 2, "denomination": 6, "bonus": "", "types": ["temphp"], "custom": {"enabled": False, "formula": ""}, "scaling": {}})
    red["useConditionText"] = 'reaction === "isDamaged"'
    free(ct, red)
    note(ct, "+1 attack/damage with imbued tools per CE spent on the imbuement.")
    mark(ct)

    ws = S.get("Wind Scythe")
    a = ws["system"]["activities"]["FFSv2ilzd3aMzoWD"]
    a["range"] = RANGE_SELF
    a["target"] = {"template": {"type": "line", "size": "60", "width": "10", "units": "ft", "count": "1", "contiguous": False},
                   "affects": {"type": "creature", "choice": False}, "override": True}
    a["damage"]["onSave"] = "half"
    scale(ws, a, [[1, "3d10"], [11, "6d10"]])
    a["effects"] = [{"_id": "SPvJIHzOEtBVslR7", "onSave": False}] if False else []
    note(ws, "Pushed 10 ft (20 ft and prone at 11th: apply the prone effect then).")
    pr = act(ws, "prone", "utility", "11th: knocked prone", "special", target=one_creature())
    apply(pr, "SPvJIHzOEtBVslR7")
    free(ws, pr)
    mark(ws)

    tm = S.get("Tool Mastery")
    a = tm["system"]["activities"]["CUFleHZOj9zv72Zf"]
    a["name"] = "Command two Floating Tools (bonus action)"
    note(tm, "Riders on Floating Tools: advantage on DEX saves. Combat Tool Improvement: +1 AC, +1 reduction die, extra guard reaction.")
    mark(tm)

    d = S.get("Domain Expansion: Tsukumogami Spirit World")
    x = act(d, "miss", "utility", "Domain: others' weapon attacks miss", "special",
            target={"affects": {"type": "creature", "choice": False}, "override": True})
    apply(x, fx(d, "miss", "Tsukumogami (weapons fail)", rounds=10, changes=[("flags.midi-qol.fail.attack.mwak", 0, "1"), ("flags.midi-qol.fail.attack.rwak", 0, "1")]))
    free(d, x)
    i = act(d, "init20", "utility", "Initiative 20: all Floating Tools attack (or Wind Scythe)", "special", range=RANGE_SELF, target=SELF)
    free(d, i)
    mark(d)

    cm = S.get("Creature Manipulation")
    a = cm["system"]["activities"]["vwrCtHKftm0gQW66"]
    a["range"], a["target"] = _r(60), one_creature()
    a["damage"] = {"onSave": "none", "parts": []}
    for e in cm["effects"]:
        if e["_id"] == "cPypsBmIXwRsbscA":
            e["duration"] = {"rounds": 10}
            e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = []
    note(cm, "Concentration; telepathic commands as a bonus action; repeats the save when damaged.")
    mark(cm)


CORE_TIERS = [[1, "2d6"]]


def triple_core(S):
    fc = S.get("First Core")
    _drop_fx(fc, "Uw7DxNjlqswkMpNe")
    a = fc["system"]["activities"]
    ub = a["ttjyPQhLJHFeGaog"]
    ub["name"] = "Unblockable Blows (on melee hit, 1 CE)"
    ub["activation"]["type"] = "special"
    ub["useConditionText"] = 'reaction === "isHit"'
    ub["target"] = one_creature()
    ub["flags"] = ub.get("flags", {})
    fc["flags"]["jjk5e"].get("ceSteps", {}).pop("ttjyPQhLJHFeGaog", None)
    apply(ub, fx(fc, "vul", "Unblockable", rounds=1, special=["isDamaged"],
                 desc="Ignores its resistance to this hit; if it had none, it is vulnerable (double the damage)."))
    eb = a["2lr4Xtp24Jv8ajRW"]
    eb["name"] = "Energy Blast (CE up to mod): 2d6 per CE"
    eb["range"], eb["target"] = _r(80), one_creature()
    eb["attack"] = _atk()
    eb["damage"] = {"includeBase": False, "parts": [dice(2, 6, ["necrotic"], scale=2)]}
    cost(fc, eb, 1, 1, CEMOD)
    dfn = act(fc, "def", "heal", "Defensive Form (bonus action): temp HP = 2 × current CE", "bonus", range=RANGE_SELF, target=SELF,
              healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                       "custom": {"enabled": True, "formula": "2 * (@resources.tertiary.value || 0)"}, "scaling": {}})
    apply(dfn, fx(fc, "def", "Defensive Form", rounds=10, desc="Refresh the temp HP for 1 CE at the start of your turn."))
    free(fc, dfn)
    dv = act(fc, "dive", "utility", "Divebomb (bonus action, CE up to mod)", "bonus", range=RANGE_SELF, target=SELF)
    apply(dv, fx(fc, "dive", "Divebomb", rounds=10, changes=[("system.attributes.movement.walk", 2, "+ (10 * (@scaling + 1))"),
                                                             ("system.attributes.ac.bonus", 2, "+2")],
                 desc="+10 ft per CE, +2 AC; +1d4 per 15 ft straight-line approach on a melee hit."))
    cost(fc, dv, 1, 1, CEMOD)
    note(fc, "One core form at a time (1 minute). Defensive temp HP uses your CE resource: uses the CE resource slot (tertiary by default).")
    mark(fc)

    tt = S.get("Triple Threat")
    note(tt, "Choose two more core options (see First Core); only one active at a time.")
    mark(tt)

    uf = S.get("Upgraded Form")
    a = uf["system"]["activities"]["w2tmNpEIdLgXtUyG"]
    a["name"] = "Divebomb upgrade: Dash/Disengage/Dodge (1 CE, bonus)"
    dfr = act(uf, "def", "heal", "Defensive upgrade: reduce damage (reaction)", "reaction", range=RANGE_SELF, target=SELF,
              healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                       "custom": {"enabled": True, "formula": f"{CEMOD} + @prof"}, "scaling": {}})
    dfr["useConditionText"] = 'reaction === "isDamaged"'
    free(uf, dfr)
    miss = act(uf, "miss", "damage", "Unblockable upgrade: damage on a miss", "special", target=one_creature(),
               damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["force"],
                       "custom": {"enabled": True, "formula": "max(@abilities.str.mod, @abilities.dex.mod)"}, "scaling": {}}]})
    free(uf, miss)
    note(uf, "Energy Blast upgrade: add CE mod once per turn to ranged CE damage. Upgrades always on unless in another core's form.")
    mark(uf)

    ce = S.get("Core Exhaustion")
    ce.setdefault("system", {}).setdefault("activities", {})
    x = act(ce, "back", "heal", "Burn a core: return to half HP", "special", range=RANGE_SELF, target=SELF,
            healing={"number": None, "denomination": None, "bonus": "", "types": ["healing"],
                     "custom": {"enabled": True, "formula": "floor(@attributes.hp.max / 2)"}, "scaling": {}})
    x["useConditionText"] = 'reaction === "isDamaged"'
    free(ce, x)
    note(ce, "That core form is unavailable for 1 week.")
    mark(ce)

    d = S.get("Domain Expansion: Rule of Three")
    x = act(d, "all", "utility", "Domain: all three cores active", "special", range=RANGE_SELF, target=SELF)
    apply(x, fx(d, "all", "Rule of Three", rounds=10, changes=[("system.attributes.ac.bonus", 2, "+2")]))
    free(d, x)
    mark(d)

    cr = S.get("Core Reversal")
    a = cr["system"]["activities"]
    bb = a["VYmTtxWPdiN9XqyP"]
    bb["name"] = "Blocking Blows (on melee hit taken, 2 CE): resistance"
    bb["activation"]["type"] = "reaction"
    bb["useConditionText"] = 'reaction === "isDamaged"'
    bb["range"], bb["target"] = RANGE_SELF, SELF
    apply(bb, fx(cr, "block", "Blocking Blows", rounds=1, special=["isDamaged"], changes=[("system.traits.dr.all", 0, "1")]))
    rb = a["ZUh6EU02MfRqZzgt"]
    rb["name"] = "Reverse Energy Blast: 4d6 radiant per 2 CE"
    rb["range"], rb["target"] = _r(160), one_creature()
    rb["attack"] = _atk()
    rb["damage"] = {"includeBase": False, "parts": [dice(4, 6, ["radiant"], scale=4)]}
    cs = a["87JLFJv6c9zHie2b"]
    cs["name"] = "Crash: moved 20+ ft → DEX or prone"
    cs["activation"]["type"] = "special"
    cs["target"] = one_creature()
    cs["damage"] = {"onSave": "none", "parts": []}
    free(cr, cs)
    of = act(cr, "off", "utility", "Offensive Form (bonus action; 2 CE per turn)", "bonus", range=RANGE_SELF, target=SELF)
    apply(of, fx(cr, "off", "Offensive Form", rounds=10, changes=[("system.bonuses.mwak.damage", 2, "+ (2 * (@resources.tertiary.value || 0))")],
                 desc="Extra damage = 2 × current CE (tertiary resource slot by default)."))
    free(cr, of)
    mark(cr)


def ten_shadows(S):
    sm = S.get("Shadow Manipulation", technique="Ten Shadows")
    a = sm["system"]["activities"]
    a["48qkc8s1CPwBVvK0"]["name"] = "Shadow Storage: interact (1 CE)"
    a["48qkc8s1CPwBVvK0"]["range"], a["48qkc8s1CPwBVvK0"]["target"] = RANGE_SELF, SELF
    t = a["mHQIg1Nb1IHki6pW"]
    t["name"] = "Trap in your shadow (2 CE): Acrobatics vs DC"
    t["range"], t["target"] = _r(5), one_creature()
    t["damage"] = {"onSave": "none", "parts": []}
    apply(t, fx(sm, "trap", "Trapped in a shadow", rounds=None, statuses=["restrained"],
                changes=[("flags.midi-qol.OverTime", 0, "turn=end, saveAbility=str|dex, saveDC=JJKORIGINDC, label=Shadow prison")],
                desc="Holds breath CON mod minutes. Freed: prone within 5 ft. Disadvantage in darkness; auto-fail in the domain."))
    mark(sm)

    lm = S.get("Light Manipulation")
    a = lm["system"]["activities"]
    a["owERaLJRp4nQCRC0"]["range"], a["owERaLJRp4nQCRC0"]["target"] = _r(120), one_creature()
    a["owERaLJRp4nQCRC0"]["damage"] = {"onSave": "none", "parts": []}
    r = a["9RB9GWZCe7RgRGt9"]
    r["name"] = "Light Ridge (2 CE): attacker misses and is blinded"
    r["useConditionText"] = 'reaction === "isAttacked"'
    r["range"], r["target"] = _r(10), one_creature()
    r["damage"] = {"onSave": "none", "parts": []}
    r["effects"].append({"_id": fx(lm, "miss", "Light Ridge: attack misses", rounds=1, special=["1Attack"],
                                   changes=[("flags.midi-qol.fail.attack.all", 0, "1")]), "onSave": False})
    sd = a["Yvnov7vqStqVLRed"]
    sd["name"] = "Summon Dispelling (½ CR CE): summoner's CE save"
    sd["save"]["ability"] = ["wis", "cha"]
    sd["range"], sd["target"] = _r(120), one_creature()
    sd["damage"] = {"onSave": "none", "parts": []}
    apply(sd, fx(lm, "inc", "Summon inverted", special=["turnEndSource"], statuses=["incapacitated"],
                 changes=[("system.attributes.movement.all", 0, "0")], desc="Fail by 5+: unsummoned for CE mod rounds."))
    for e in lm["effects"]:
        if e["_id"] in ("YFaDKHCHPR8uZuoE", "DP2DF3UP2G9hCl20"):
            e["changes"] = []
            e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnEndSource"]
    mark(lm)

    d = S.get("Domain Expansion: Chimera Shadow Garden")
    sink = act(d, "sink", "save", "End of turn in the domain: Acrobatics or sink", "special", save=_sv("dex"),
               damage={"onSave": "none", "parts": []}, target={"affects": {"type": "enemy", "choice": False}, "override": True})
    apply(sink, fx(d, "sink", "Sinking (Shadow Garden)", rounds=None, statuses=["restrained"],
                   changes=[("flags.midi-qol.OverTime", 0, "turn=start, saveAbility=str, saveDC=JJKORIGINDC, label=Escape the shadows (Athletics)")]))
    free(d, sink)
    fm = act(d, "fom", "utility", "Domain: Freedom of Movement", "special", range=RANGE_SELF, target=SELF)
    apply(fm, fx(d, "fom", "Freedom of Movement (domain)", rounds=10, changes=[("system.traits.ci.value", 2, "restrained"),
                                                                              ("system.traits.ci.value", 2, "paralyzed"), ("system.traits.ci.value", 2, "grappled")]))
    free(d, fm)
    d["system"]["activities"]["sRX9BbTTQJ3Dyvq3"]["name"] = "Shadow Clones (bonus action, CE)"
    mark(d)

    wu = S.get("Well’s Unknown Abyss")
    a = wu["system"]["activities"]["hNJjLKYxQtIoCxkj"]
    a["name"] = "Combine shikigami (½ base CE each, up to prof)"
    cost(wu, a, 1, 1, "20")
    note(wu, "Altered shikigami: half the base's HP; −1 CE per size step down. Shikigami summons stay on Divine Dogs / Trial / Totality.")
    mark(wu)


CHAOS_BOLT = "(1 + 2 * (floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11)) + 3 * floor(min(@details.level, 18) / 18))"


def vairocana(S):
    h = S.get("Harmony")
    a = h["system"]["activities"]
    a["NJRqobgMxqK7LgVu"]["name"] = "Locate Creature (3 CE)"
    a["NJRqobgMxqK7LgVu"]["range"] = {"value": "1000", "units": "ft", "override": True}
    a["VPsbZw4pGUGe4iHI"]["name"] = "Speak with Animals / Tongues (2 CE)"
    a["VPsbZw4pGUGe4iHI"]["duration"] = {"value": "1", "units": "hour", "override": True}
    apply(a["VPsbZw4pGUGe4iHI"], fx(h, "tongues", "Tongues", rounds=600, desc="Understand/speak any language (6th: + CE mod creatures)."))
    note(h, "Locate Creature range: 1,000 ft (1 / 5 / 30 miles at 6th / 11th / 18th).")
    mark(h)

    c = S.get("Chaos", technique="Vairocana")
    a = c["system"]["activities"]["fppuZf662RZQtCi6"]
    act(c, "fppuZf662RZQtCi6", "attack", "Chaos Bolt (2 CE)", "action", range=_r(120), target=one_creature(), attack=_atk(),
        damage={"includeBase": False, "parts": [{"number": None, "denomination": 8, "bonus": "", "types": ["acid", "cold", "fire", "force", "lightning", "poison", "psychic", "thunder"],
                "custom": {"enabled": True, "formula": f"2d8 + ({CHAOS_BOLT} - 1 + @scaling)d6"}, "scaling": {}}]})
    tbl = act(c, "table", "utility", "Chaos (2 CE): roll the Chaos Table", "action", range=RANGE_SELF, target=SELF,
              roll={"formula": "1d100", "name": "Chaos Table", "prompt": False, "visible": True})
    cost(c, tbl, 2)
    note(c, "Chaos Bolt auto-casts at 3rd/5th/8th level (6th/11th/18th): 2d8 + 1d6 per spell level above 1st. Doubles on the d8s: it leaps.")
    mark(c)

    am = S.get("Chaos Amplification")
    a = am["system"]["activities"]["I1SyCWcDjCAYCYdl"]
    a["name"] = "Amplify: +CE mod dice or double duration (1 CE)"
    a["activation"]["type"] = "special"
    a["roll"] = {"formula": f"({CEMOD})d6", "name": "Extra Chaos dice (use the effect's die)", "prompt": False, "visible": True}
    note(am, "Upcast Chaos Bolt: spend up to prof extra CE (enter as the bolt's scale).")
    mark(am)

    b = S.get("Balance", technique="Vairocana")
    b["system"]["uses"] = {"max": "@prof", "spent": 0, "recovery": [{"period": "lr", "type": "recoverAll"}]}
    a = b["system"]["activities"]["AuSnWlVoTyGnbENt"]
    a["name"] = "Order / Equilibrium (prof per long rest)"
    a["consumption"] = {"targets": [{"type": "itemUses", "target": "", "value": "1", "scaling": {}}], "scaling": {"allowed": False}}
    mark(b)

    d = S.get("Domain Expansion: Mandala of Mutual Paradox")
    x = act(d, "init20", "utility", "Initiative 20: chosen Chaos effect (≤ 90) on chosen creatures", "special",
            target={"affects": {"type": "creature", "choice": True}, "override": True})
    free(d, x)
    mark(d)

    cg = S.get("Cosmic Genesis (Reversal)")
    a = cg["system"]["activities"]["V9CwF0Urv5nbWupG"]
    a["range"], a["target"] = RANGE_SELF, sphere(30)
    apply(a, fx(cg, "rule", "Cosmic Genesis rule", rounds=10, desc="A new rule of reality applies here (describe it)."))
    mark(cg)
    en = S.get("Entropy (Reversal)")
    a = en["system"]["activities"]["yEvqd8kYWry0gKIl"]
    a["name"] = "Entropy (1 CE, start of turn)"
    a["activation"]["type"] = "special"
    mark(en)


def vengeful_spirit(S):
    pm = S.get("Partial Manifestation")
    a = pm["system"]["activities"]["Mxbd9ukf5kpkbMqD"]
    a["range"], a["target"] = _r(5), one_creature()
    a["attack"] = _atk("melee")
    a["damage"] = {"includeBase": False, "parts": [dice(1, 12, ["slashing"], bonus=CEMOD)]}
    note(pm, "Once per turn: 1 claw (2 at 6th, 3 at 11th), 1 CE each.")
    mark(pm)

    vm = S.get("Vengeful Spirit Manifestation")
    a = vm["system"]["activities"]["gmSJPcsVfWBCCoiy"]
    act(vm, "gmSJPcsVfWBCCoiy", "save", "Big hit: DC 20 WIS or the spirit manifests", "special",
        save={"ability": ["wis"], "dc": {"calculation": "", "formula": "20"}}, damage={"onSave": "none", "parts": []},
        range=RANGE_SELF, target=SELF)
    vm["system"]["activities"]["gmSJPcsVfWBCCoiy"]["useConditionText"] = 'reaction === "isDamaged"'
    note(vm, "Trigger: damage above your level + CE mod. Spirit acts berserk on your turn, charmed by you, within 200 ft.")
    mark(vm)

    mi = S.get("Mimicry")
    a = mi["system"]["activities"]["4fgZQbTNRVg0yeXw"]
    a["name"] = "Replicate a technique feature (3 CE, CE check)"
    a["roll"] = {"formula": f"1d20 + {CEMOD}", "name": "CE check vs replication DC", "prompt": False, "visible": True}
    claw = act(mi, "claw", "attack", "Spirit claw: extract DNA (bonus action)", "bonus", range=_r(10), target=one_creature(),
               attack=_atk("melee"), damage={"includeBase": False, "parts": [dice(1, 12, ["slashing"], bonus=CEMOD)]})
    free(mi, claw)
    mark(mi)

    sb = S.get("Stronger Bond")
    sb.setdefault("system", {}).setdefault("activities", {})
    x = act(sb, "thp", "heal", "Spirit summoned: temp HP = half your current HP", "special", target=one_creature(),
            healing={"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                     "custom": {"enabled": True, "formula": "floor(@attributes.hp.value / 2)"}, "scaling": {}})
    free(sb, x)
    note(sb, "Spirit: +2 to two abilities (and max). You: +2 CE score while it's summoned (edit the actor).")
    mark(sb)

    d = S.get("Domain Expansion: True Mutual Love")
    x = act(d, "init20", "utility", "Initiative 20: extra action for a copied technique (all hostiles)", "special", range=RANGE_SELF, target=SELF)
    free(d, x)
    note(d, "Copied techniques cost no CE inside the domain.")
    mark(d)

    dr = S.get("Duplicated Reversal")
    note(dr, "You can copy the reversal features of techniques you've copied.")
    mark(dr)


def voracity(S):
    hg = S.get("Hunger of the Accursed")
    a = hg["system"]["activities"]
    a["nCXaUY7ZzL3xGLo4"]["name"] = "Devour a corpse (reaction, 3 CE; 2 at 6th)"
    a["nCXaUY7ZzL3xGLo4"]["useConditionText"] = "false"
    a["nCXaUY7ZzL3xGLo4"]["range"], a["nCXaUY7ZzL3xGLo4"]["target"] = _r(5), one_creature()
    apply(a["nCXaUY7ZzL3xGLo4"], fx(hg, "eat", "Devoured ability", rounds=600, desc="One stolen feature/trait/stat for 1 hour (edit this effect to add it)."))
    a["RLvJZSjxqfsF9Swz"]["name"] = "Steal another ability (+3 CE)"
    mark(hg)

    rg = S.get("Regurgitation")
    a = rg["system"]["activities"]["Ve8rA5LYWi4pxv0v"]
    a["name"] = "Regurgitate a past ability (4 CE; 3 at 6th, 1 hour)"
    a["range"], a["target"] = RANGE_SELF, SELF
    apply(a, fx(rg, "ab", "Regurgitated ability", rounds=600, desc="Edit to add the stolen ability."))
    mark(rg)

    dg = S.get("Digestion")
    a = dg["system"]["activities"]
    a["l71aF9Qo5eXCITwG"]["name"] = "Efficiency: stolen ability costs 1 less"
    a["l71aF9Qo5eXCITwG"]["activation"]["type"] = "special"
    a["QYRnTygBGHGnzYOb"]["name"] = "Output: spend more CE on a stolen ability"
    a["QYRnTygBGHGnzYOb"]["activation"]["type"] = "special"
    note(dg, "Hunger of the Accursed and Regurgitation cost 1 less (min 1): adjust when using them.")
    mark(dg)

    bd = S.get("Maximum: Body of the Devourer")
    a = bd["system"]["activities"]["mhfBeFLgedquCkLf"]
    a["name"] = "Transform into a devoured creature (2 × CR CE)"
    a["type"] = "heal"
    a["healing"] = {"number": None, "denomination": None, "bonus": "", "types": ["temphp"],
                    "custom": {"enabled": True, "formula": "0"}, "scaling": {}}
    a["range"], a["target"] = RANGE_SELF, SELF
    cost(bd, a, 2, 1, "40")
    note(bd, "Use its stat block (keep mental scores, CE, HP); enter its HP as the temp HP.")
    mark(bd)

    d = S.get("Domain Expansion: Tomb of the Devoured")
    x = act(d, "init20", "utility", "Initiative 20: regurgitate a devoured creature (ally)", "special", range=_r(5), target=SELF)
    free(d, x)
    mark(d)

    ig = S.get("Indigestion")
    a = ig["system"]["activities"]["hiEIVuUx3uZX9ZAk"]
    a["range"], a["target"] = RANGE_SELF, sphere(30)
    a["target"]["affects"]["type"] = "enemy"
    a["damage"] = {"onSave": "none", "parts": []}
    apply(a, fx(ig, "sick", "Indigestion", rounds=10,
                changes=[("system.attributes.movement.all", 1, "0.5"),
                         ("flags.midi-qol.OverTime", 0, "turn=end, saveAbility=con, saveDC=JJKORIGINDC, label=Indigestion")],
                desc="Half speed; wastes its action vomiting."))
    mark(ig)


LC_TIERS = [[1, "2d8"]]
RAIN = [[1, "3d10"], [6, "5d10"], [11, "8d10"], [18, "10d10"]]
DAWN = [[1, "2d10"], [6, "3d10"], [11, "5d10"], [18, "8d10"]]


def light(S):
    lc = S.get("Light Constructs")
    a = lc["system"]["activities"]["S6EdYAtrPkgs1rHd"]
    act(lc, "S6EdYAtrPkgs1rHd", "utility", "Form a bar of light (2 CE, 1 minute)", "bonus", range=RANGE_SELF, target=SELF)
    apply(lc["system"]["activities"]["S6EdYAtrPkgs1rHd"], fx(lc, "bar", "Light Construct", rounds=10))
    st = act(lc, "strike", "attack", "Light Construct strike / throw (20/60)", "action",
             range={"value": "5", "long": "60", "units": "ft", "override": True}, target=one_creature(),
             attack=_atk("melee"), damage={"includeBase": False, "parts": [dice(2, 8, ["radiant"], bonus=CEMOD)]})
    free(lc, st)
    note(lc, "Finesse, light, thrown (20/60); reappears in your hand. You know the Light cantrip.")
    mark(lc)

    lt = S.get("Light Techniques")
    a = lt["system"]["activities"]
    r = a["DoKKYxnV31QiXUSk"]
    r["name"] = "Rain of Light (3 CE): 10-ft radius"
    r["range"], r["target"] = RANGE_SELF, sphere("10 + 5 * (floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))")
    r["target"]["affects"]["type"] = "creature"
    r["damage"]["onSave"] = "none"
    scale(lt, r, RAIN)
    cone = act(lt, "cone", "save", "Rain of Light (3 CE): 15-ft cone", "action", save=_sv("dex"),
               damage={"onSave": "none", "parts": [dice(3, 10, ["radiant"])]}, range=RANGE_SELF,
               target=sphere("15 + 15 * (floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))", kind="cone"))
    apply(cone, "7pPnBAsvCt4Uan8g")
    scale(lt, cone, RAIN)
    cost(lt, cone, 3, 1, f"3 + {CEMOD}")
    dw = a["dVjIsbJKfQ0R0yOC"]
    dw["name"] = "████ of Dawn (2 CE): 30 ft"
    dw["range"], dw["target"] = RANGE_SELF, sphere(30)
    dw["target"]["affects"]["type"] = "enemy"
    dw["damage"] = {"onSave": "half", "parts": [dice(2, 10, ["radiant"], bonus=CEMOD)]}
    scale(lt, dw, DAWN)
    for e in lt["effects"]:
        if e["_id"] == "NSo2T0ad2zKYwIpB":
            e["changes"] = []
            e.setdefault("flags", {}).setdefault("dae", {})["specialDuration"] = ["turnEnd"]
    note(lt, "Hyperspeed (6th): +1 die per extra CE (2 at 11th, 3 at 18th) up to CE mod — use the CE spend.")
    mark(lt)

    hs = S.get("Hyperspeed")
    _drop_fx(hs, "0ReZlkxUw6lTDcep")
    _passive(hs, "res", "Radiant resistance", [("system.traits.dr.value", 2, "radiant")])
    a = hs["system"]["activities"]["IF6ShpMab1LGYOdF"]
    a["name"] = "Light Beam (1 CE): ranged construct attack at advantage"
    a["range"], a["target"] = _r(60), one_creature()
    a["attack"] = _atk()
    a["attack"]["type"]["value"] = "ranged"
    a["damage"] = {"includeBase": False, "parts": [dice(2, 8, ["radiant"], bonus=CEMOD)]}
    hs["flags"]["jjk5e"].get("ceSteps", {}).pop("IF6ShpMab1LGYOdF", None)
    apply(a, fx(hs, "adv", "Light Beam", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.advantage.attack.all", 0, "1")]))
    note(hs, "Melee hit with the construct: teleport 10 ft.")
    mark(hs)

    ls = S.get("Maximum: Light Speed")
    a = ls["system"]["activities"]["tW4lM8f36bJueMrg"]
    a["range"] = RANGE_SELF
    a["target"] = {"template": {"type": "line", "size": "120", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                   "affects": {"type": "creature", "choice": False}, "override": True}
    a["damage"]["onSave"] = "half"
    risk = act(ls, "risk", "save", "Per thing passed through: CON vs your own DC", "special",
               save={"ability": ["con"], "dc": {"calculation": "spellcasting", "formula": ""}}, damage={"onSave": "none", "parts": []},
               range=RANGE_SELF, target=SELF)
    free(ls, risk)
    mark(ls)

    d = S.get("Domain Expansion: Reverse Transcendence")
    i = act(d, "init20", "damage", "Initiative 20: 6d12 radiant to all", "special", damage={"parts": [dice(6, 12, ["radiant"])]},
            target={"affects": {"type": "enemy", "choice": False}, "override": True})
    free(d, i)
    t = d["system"]["activities"]["uGMRYbw6JHekj9j3"]
    t["name"] = "Light-speed teleport: 4d12 to a creature at either end"
    t["target"] = one_creature()
    free(d, t)
    sp = act(d, "speed", "utility", "Domain: double speed, movement can't be reacted to", "special", range=RANGE_SELF, target=SELF)
    apply(sp, fx(d, "spd", "Reverse Transcendence", rounds=10, changes=[("system.attributes.movement.all", 1, "2")]))
    free(d, sp)
    mark(d)

    dk = S.get("████ and Dark")
    a = dk["system"]["activities"]["8LJXdv7in6ukvTx8"]
    a["name"] = "Darkness (2 CE)"
    a["range"], a["target"] = _r(60), sphere(15)
    a["duration"] = {"value": "10", "units": "minute", "override": True}
    mark(dk)
    dc = S.get("Dark Constructs (Reversal)")
    a = dc["system"]["activities"]["7B4chJWglItc6EQW"]
    act(dc, "7B4chJWglItc6EQW", "utility", "Form a bar of darkness (4 CE, 1 minute)", "bonus", range=RANGE_SELF, target=SELF)
    st = act(dc, "strike", "attack", "Dark Construct strike / throw (20/60)", "action",
             range={"value": "5", "long": "60", "units": "ft", "override": True}, target=one_creature(),
             attack=_atk("melee"), damage={"includeBase": False, "parts": [dice(4, 8, ["necrotic"], bonus=CEMOD)]})
    free(dc, st)
    mark(dc)
    dv = S.get("Dark Vortex (Reversal)")
    a = dv["system"]["activities"]["z0ZuXBlsQJj8QDH1"]
    a["range"], a["target"] = RANGE_SELF, sphere(60)
    a["target"]["affects"]["type"] = "creature"
    a["damage"]["onSave"] = "half"
    keep = act(dv, "keep", "save", "Maintain the vortex (action): repeat the save", "action", save=_sv("str"),
               damage={"onSave": "half", "parts": [dice(6, 10, ["necrotic"])]}, range=RANGE_SELF, target=sphere(60))
    free(dv, keep)
    note(dv, "Concentration; failed save: pulled 10 ft closer.")
    mark(dv)


LEFTOVER_FX = {
    "Regain control (end of turn, DC 15 WIS)": ("Back in control", "Success: you regain control of yourself."),
    "Bonus Action": ("Absorbed spirit", "Failed CON: the spirit is eaten/absorbed (store it)."),
    "Absorb cursed spirits": ("Absorbed (domain)", "Failed CHA: absorbed into your spirit stock."),
    "Stone cubes (1 CE each, up to CE mod)": ("Pushed by stone", "Failed DEX: pushed to the end of the connected cubes."),
    "Move panels 30 ft (1 CE, DEX or pushed)": ("Pushed by the wall", "Failed DEX: pushed with the panel."),
    "Panoramic Composition (1 CE per creature)": ("In the panorama", "Failed save: drawn into your painting."),
    "Sound Blast push (STR or 10 ft)": ("Pushed 10 ft", "Failed STR: pushed 10 ft away."),
    "Soul Information: CHA save vs the dead (upkeep 1 CE)": ("Possessed by the dead", "Failed CHA: the dead takes control until your CE runs out."),
    "Teleport an unwilling creature (CE save)": ("Teleported to a mark", "Failed: teleported to one of your marks."),
    "Big hit: DC 20 WIS or the spirit manifests": ("Vengeful Spirit loose", "Failed WIS: your spirit manifests berserk."),
    "Action (8 CE)": ("Light Speed impact", "Failed CON: takes the damage and is knocked prone."),
    "Per thing passed through: CON vs your own DC": ("Body tearing", "Failed: you take damage from moving through it (GM)."),
}
LEFTOVER_ITEMS = ["Comedy", "Cursed Spirit Absorption", "Domain Expansion: Womb Profusion", "Excavation", "Wall of Stone",
                  "Panoramic Composition", "Sound Amplification", "Seance", "Mastered Teleport", "Vengeful Spirit Manifestation",
                  "Maximum: Light Speed", "Domain Expansion: Deadly Sentencing", "Cursed Buds", "Self Distortion", "Invert Causality",
                  "Sky Shape", "Divine Dogs", "Trial", "Totality"]


def leftovers(S):
    for nm in LEFTOVER_ITEMS:
        it = S.get(nm)
        for aid, a in it["system"]["activities"].items():
            if a["type"] == "save" and not a.get("damage", {}).get("parts") and not a.get("effects"):
                title, desc = LEFTOVER_FX.get(a.get("name"), ("Failed save", "Failed save: apply the feature's result."))
                apply(a, fx(it, "fail" + aid[:4], title, rounds=1, desc=desc))
            if a["type"] == "attack" and not a.get("damage", {}).get("parts") and not a.get("damage", {}).get("includeBase"):
                a.setdefault("damage", {})["includeBase"] = True
                a["damage"].setdefault("parts", [])
        mark(it)


MOD_SUB = "max(@abilities.str.mod, @abilities.dex.mod)"
# Activities whose scale is a count the player enters (stars, charges, feet...), not extra CE: scaling costs nothing.
COUNT_SCALED = {
    "Momentum strike (+1d6 per 10 ft charged)", "Army pseudo-domain (1d10 per star, ignores slashing resistance)",
    "Initiative 20: 1d12 per star shikigami", "Redirect an attack (roll for new target)",
    "Bet: event roll (d20 + expectation)", "Multiplier roll (d20 + expectation)", "Multiplier roll (best of 3d20)",
    "Hair Pin: detonate (bonus action or reaction)", "Repelled impact on lowest-CE creature (2 dice per 10 ft)",
    "Discharge bolt (1d12 per charge)", "Star collision (2 dice per 10 ft)", "Uzumaki (2+ spirits)",
    "Pseudo-domain (end of your turn): DEX, 1d6 per orbiting star", "Body Repel (5 CE, 2+ transfigured)",
    "Blunt blast: 15-ft cone, CON (3 CE)", "Rumination (6 CE): 1d10 per 10% corruption"}


def sanitize(S):
    """Store-wide pass for engine-level mistakes found by tools/validate-packs.py."""
    for _id, (pack, _, d) in S.src.items():
        before = json.dumps(d, sort_keys=True)
        acts = d.get("system", {}).get("activities", {}) or {}
        for e in d.get("effects", []) or []:
            keep = []
            for c in e.get("changes", []) or []:
                k, v = c["key"], str(c.get("value"))
                if "@scaling" in v: c["value"] = v = v.replace("@scaling", "JJKSCALING")
                if k == "flags.midi-qol.OverTime" and "saveAbility=wis|cha" in v:
                    c["value"] = v = v.replace("saveAbility=wis|cha", "saveAbility=JJKCESAVE")
                m = re.search(r"saveAbility=([a-z]{3})\|([a-z]{3})", v) if k == "flags.midi-qol.OverTime" else None
                if m: c["value"] = v.replace(m.group(0), f"saveAbility=JJKBEST_{m.group(1)}_{m.group(2)}")
                if k.endswith("traits.dm.amount.all"):
                    c["key"], c["value"] = "flags.midi-qol.DR.all", v.lstrip("-").strip()
                    c["mode"] = 2
                if k == "flags.midi-qol.critical.range":
                    c["key"], c["mode"], c["value"] = "flags.dnd5e.weaponCriticalThreshold", 3, "18"
                if k == "flags.midi-qol.grants.fail.attack.all": c["key"] = "flags.midi-qol.fail.attack.all"
                if k.startswith("flags.midi-qol.max.attack"): continue
                if k == "system.traits.di.value" and v == "healing": continue
                keep.append(c)
            e["changes"] = keep
        for a in acts.values():
            if a.get("type") not in ("attack", "save"):
                for blk in ("damage", "healing"):
                    b = a.get(blk) or {}
                    parts = b.get("parts", []) if blk == "damage" else [b]
                    for pt in parts:
                        if not isinstance(pt, dict): continue
                        if "@mod" in str(pt.get("bonus", "")): pt["bonus"] = pt["bonus"].replace("@mod", MOD_SUB)
                        cu = pt.get("custom") or {}
                        if "@mod" in str(cu.get("formula", "")): cu["formula"] = cu["formula"].replace("@mod", MOD_SUB)
            # damage-part scaling or @scaling in a formula only works when the usage dialog lets you scale
            blob = json.dumps({k: a.get(k) for k in ("damage", "healing", "roll")})
            scaled_parts = any((pt.get("scaling") or {}).get("number") for pt in (a.get("damage") or {}).get("parts", []) or [])
            sc = (a.get("consumption") or {}).get("scaling") or {}
            if (scaled_parts or "@scaling" in blob) and not sc.get("allowed") and a.get("name") in COUNT_SCALED:
                cons = a.setdefault("consumption", {"targets": []})
                cons["scaling"] = {**sc, "allowed": True, "max": sc.get("max") or "20"}
            if a.get("effects"):
                seen, refs = set(), []
                for ref in a["effects"]:
                    if ref.get("_id") in seen: continue
                    seen.add(ref.get("_id")); refs.append(ref)
                a["effects"] = refs
            if a.get("type") == "attack" and not (a.get("damage") or {}).get("parts") and not (a.get("damage") or {}).get("includeBase"):
                a.setdefault("damage", {})["includeBase"] = True
                a["damage"].setdefault("parts", [])
            if a.get("type") == "save" and not (a.get("damage") or {}).get("parts") and not a.get("effects"):
                apply(a, fx(d, "fail" + a["_id"][:5], "Failed save: " + (a.get("name") or d["name"])[:60], rounds=1,
                            desc="Failed save: apply the result described in the feature."))
        if json.dumps(d, sort_keys=True) != before: S.dirty.add(_id)


def _f(S, _id): return S.by_id(_id)


def _fx_on(item, aid, key, name, **kw):
    a = item["system"]["activities"][aid]
    apply(a, fx(item, key, name, **kw))
    return a


def _base(a):
    a.setdefault("damage", {})["includeBase"] = True
    a["damage"].setdefault("parts", [])


def feat_fixes(S):
    """Technique and general feats: saves without results, attacks without damage, CE costs missing (manual audit)."""
    # --- saves that had no damage/effect ---
    it = _f(S, "Q1qqOPPEbJEfzmXK")  # Aerokinesis
    a = it["system"]["activities"]["LLpvCGK1cFWc0aJF"]
    a["range"], a["target"] = _r(30), one_creature()
    a["damage"] = {"onSave": "none", "parts": [{"number": None, "denomination": 6, "bonus": "", "types": ["necrotic"],
                   "custom": {"enabled": True, "formula": "(@prof)d6"}, "scaling": {}}]}
    apply(a, fx(it, "suff", "Suffocating", rounds=10, changes=[("system.attributes.movement.all", 1, "0.5"),
                                                              ("flags.midi-qol.disadvantage.attack.all", 0, "1")],
                desc="Ends if the caster is more than 30 ft away or loses concentration."))
    mark(it)
    it = _f(S, "W5duwlBV6Eo8CO4a")  # Air Bomber
    a = it["system"]["activities"]["yEQoJcApquibG2ry"]
    a["range"], a["target"] = RANGE_SELF, sphere(15)
    a["damage"] = {"onSave": "half", "parts": [dice(6, 8, ["slashing"], bonus=CEMOD)]}
    scale(it, a, [[1, "6d8"], [11, "8d8"], [18, "10d8"]])
    mark(it)
    it = _f(S, "fwuPOkYpGbemJ4mA")  # Black Belt
    a = it["system"]["activities"]["vLQ6ytZvDHlnFz03"]
    a["name"] = "Judo Throw (STR): prone; fail by 5+ stunned"
    a["target"] = one_creature()
    apply(a, fx(it, "prone", "Prone (Judo Throw)", statuses=["prone"]))
    st = act(it, "stun", "utility", "Judo Throw: failed by 5+ → stunned", "special", target=one_creature())
    apply(st, fx(it, "stun", "Stunned (Judo Throw)", statuses=["stunned"], rounds=2, special=["turnEnd"]))
    mark(it)
    it = _f(S, "UuX2ZFBhZvKrKfQH")  # Corona Macaron
    a = it["system"]["activities"]["LmttiJzj4t54PglX"]
    a["range"], a["target"] = RANGE_SELF, sphere(10)
    apply(a, fx(it, "ring", "Pulled into the ring", rounds=10, desc="Inside the Corona Macaron; touching the ring deals your Granite Blast damage."))
    mark(it)
    it = _f(S, "KEROfKHaMqMxzTfu")  # Fox Fire
    a = it["system"]["activities"]["spOEanRx5Pw4fa9a"]
    a["name"] = "Detonate the fog (CON)"
    a["target"] = {"affects": {"type": "creature", "choice": True}, "override": True}
    a["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": 8, "bonus": "", "types": ["cold"],
                   "custom": {"enabled": True, "formula": f"(2 * {CEMOD})d8"}, "scaling": {}}]}
    mark(it)
    it = _f(S, "pOllUPH2K4i7mWW7")  # Funny Faces
    for aid, nm in [("PjGgfNwCDWYBRRJg", "Goofy face (2 CE): INT at disadvantage"), ("vWjJ9P5cZCofYPDv", "Change distortion (1 CE): another INT next turn")]:
        a = it["system"]["activities"][aid]
        a["name"], a["activation"]["type"], a["target"] = nm, "special", one_creature()
        apply(a, fx(it, "c" + aid[:3], "Confused (distorted face)", rounds=2, special=["turnEnd"],
                    changes=[("flags.midi-qol.disadvantage.attack.all", 0, "1")]))
    mark(it)
    it = _f(S, "Ph7qLr8HcwdAjrIJ")  # Imbued Weapon
    a = it["system"]["activities"]["dPfNwfDDp5XEG2nu"]
    a["target"] = {"template": {"type": "line", "size": "60", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                   "affects": {"type": "creature", "choice": True}, "override": True}
    a["damage"] = {"onSave": "half", "parts": [dice(1, 12, ["lightning"], scale=1)]}
    a["consumption"].setdefault("scaling", {})["allowed"] = True
    a["consumption"]["scaling"]["max"] = "20"
    note(it, "Imbued Weapon bolt: 1d12 per charge (scale = charges − 1).")
    mark(it)
    it = _f(S, "XkXlP9QKMkgotHci")  # Improved Bindings
    a = it["system"]["activities"]["F77fTkM0Wg1vvKWq"]
    a["name"] = "End of its turn: CON or stunned"
    a["target"] = one_creature()
    apply(a, fx(it, "stun", "Stunned (Improved Bindings)", statuses=["stunned"], special=["turnStart"]))
    ex = act(it, "exh", "utility", "Bound: two levels of exhaustion", "special", target=one_creature())
    apply(ex, fx(it, "exh", "Shadow bindings", rounds=None, changes=[("system.attributes.exhaustion", 2, "2")]))
    mark(it)
    it = _f(S, "UGacSC80MoG0deAE")  # Black Hole
    a = it["system"]["activities"]["OXYLIUIDnZkcZyQg"]
    a["name"] = "End of your turn: pulled 50 ft (25 on save)"
    a["range"], a["target"] = RANGE_SELF, sphere(100)
    apply(a, fx(it, "pull", "Pulled by the Black Hole", rounds=1, desc="Pulled 50 ft (25 ft on a success); within 5 ft: dies."))
    me = act(it, "self", "utility", "Become a Black Hole (you die after 1 minute)", "action", range=RANGE_SELF, target=SELF)
    apply(me, fx(it, "bh", "Black Hole", rounds=10, desc="You die when this ends."))
    mark(it)
    it = _f(S, "2OwxAUf9B8LHPmRf")  # Hurricane
    a = it["system"]["activities"]["qoGbPh8r9dEtutfO"]
    a["range"], a["target"] = RANGE_SELF, sphere(30)
    apply(a, fx(it, "launch", "Launched 1000 ft", rounds=1, desc="Launched 1,000 ft up (falls: 20d6 bludgeoning)."))
    fall = act(it, "fall", "damage", "Fall damage (20d6)", "special", target=one_creature(), damage={"parts": [dice(20, 6, ["bludgeoning"])]})
    free(it, fall)
    mark(it)
    it = _f(S, "QMm76WsIVe8dbThb")  # World Cutting Slash
    a = it["system"]["activities"]["Ma9Xn3ATLzZzVBv0"]
    a["range"], a["target"] = _r(60), one_creature()
    a["damage"] = {"onSave": "half", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["slashing"],
                   "custom": {"enabled": True, "formula": "12 * (@prof + floor(min(@details.level, 6) / 6) + floor(min(@details.level, 11) / 11) + floor(min(@details.level, 18) / 18))"}, "scaling": {}}]}
    note(it, "Maximum Dismantle damage (12 per die: base dice + prof extra CE), ignoring resistances, immunities and temp HP. Limb damaging.")
    mark(it)
    it = _f(S, "Biapn4UQqElS0UZs")  # Nail Volley
    a = it["system"]["activities"]["FuwD32PXDnCWS2LR"]
    a["range"], a["target"] = RANGE_SELF, sphere(10, kind="cone")
    a["damage"] = {"onSave": "none", "parts": [dice(1, 6, ["piercing"], scale=1)]}
    cost(it, a, 1, 1, "24")
    note(it, "1 CE per nail; cone = 10 ft × nails (enlarge the template).")
    mark(it)
    it = _f(S, "NwKIStf7NFVWznPx")  # Shield Master
    a = it["system"]["activities"]
    sh = a["u3lSZYWizw8CTbQB"]
    sh["name"] = "Shield shove (contested)"
    sh["target"] = one_creature()
    apply(sh, fx(it, "prone", "Shoved prone", statuses=["prone"]))
    r = a["scKwxXb1hFgBOxPf"]
    r["name"] = "Interpose shield: no damage on a successful DEX save"
    r["useConditionText"] = 'reaction === "isSave"'
    r["range"], r["target"] = RANGE_SELF, SELF
    apply(r, fx(it, "evade", "Interposed shield", rounds=1, special=["isSave"], changes=[("flags.midi-qol.superSaver.dex", 0, "1")]))
    mark(it)
    it = _f(S, "K3ECG09F5qxLV88I")  # Shooting Star (Star Rage)
    a = it["system"]["activities"]["fLz0HrhMYVdW03nQ"]
    a["name"] = "Shooting Star (3 CE): 60-ft line"
    a["activation"]["type"] = "special"
    a["range"] = RANGE_SELF
    a["target"] = {"template": {"type": "line", "size": "60", "width": "5", "units": "ft", "count": "1", "contiguous": False},
                   "affects": {"type": "creature", "choice": False}, "override": True}
    a["damage"] = {"onSave": "none", "parts": [{"number": None, "denomination": None, "bonus": "", "types": ["bludgeoning"],
                   "custom": {"enabled": True, "formula": "2 * (1d8 + @abilities.str.mod)"}, "scaling": {}}]}
    note(it, "Damage = twice your unarmed strike (d8 + STR shown: use your mass-increased die). Limb damaging on a failed save.")
    mark(it)
    it = _f(S, "XGgh8DE8cMTgqOun")  # Surprise Present
    a = it["system"]["activities"]["VEM2rDGIcThDiozK"]
    a["useConditionText"] = 'reaction === "isAttacked"'
    a["target"] = one_creature()
    a["damage"] = {"onSave": "half", "parts": [dice(2, 10, ["bludgeoning"])]}
    note(it, "Object damage by size (2d10 shown, Medium). Weapon instead: attack the attacker at advantage. Cost: twice the receipt's CE.")
    mark(it)
    it = _f(S, "uplvYFKOh990lLUt")  # Veil
    a = it["system"]["activities"]["e5APyZK7Ri8YUITa"]
    a["name"] = "Veil of the Faceless God (3 CE, 1 minute)"
    a["range"], a["target"] = RANGE_SELF, sphere(60)
    a["target"]["affects"]["type"] = "enemy"
    apply(a, fx(it, "veil", "Veiled dread", rounds=10,
                changes=[("flags.midi-qol.OverTime", 0, "turn=start, saveAbility=int, saveDC=JJKORIGINDC, label=Veil of the Faceless God")],
                desc="−1 to all rolls per 10% corruption while it fails (apply by hand); auto-success if it can't see the caster."))
    mark(it)
    it = _f(S, "Gf0XI8lwB5ayrSQJ")  # Weapon Breaker
    a = it["system"]["activities"]["mO03FVBZbC4mtnDz"]
    a["useConditionText"] = 'reaction === "isAttacked"'
    a["target"] = one_creature()
    apply(a, fx(it, "broken", "Weapon broken", rounds=None, desc="Its weapon breaks (cursed tools: needs an equal or higher grade). The attack deals no damage."))
    mark(it)
    it = _f(S, "HjIZcb7XtjtE2ocF")  # Weight of Judgment
    a = it["system"]["activities"]["9hyTC5wKxPZS7EVt"]
    a["name"] = "Weight of Judgment (on gavel hit, 2 CE): STR or prone"
    a["activation"]["type"] = "special"
    a["useConditionText"] = 'reaction === "isHit"'
    a["target"] = one_creature()
    a["damage"] = {"onSave": "full", "parts": [dice(1, 6, ["bludgeoning"])]}
    apply(a, fx(it, "prone", "Prone (Weight of Judgment)", statuses=["prone"]))
    note(it, "Extra damage = one more weapon damage die (d6 shown: use your gavel's).")
    mark(it)
    it = _f(S, "RG4L3OJERkIdy1X6")  # Blast Away
    a = it["system"]["activities"]["AyHTNj7qBAkMgGQz"]
    a["name"] = "Blast Away (Energy Blast ≥ 4 CE): STR or pushed 10 ft and prone"
    a["target"] = one_creature()
    mark(it)

    # --- attacks without damage ---
    for _id, aid in [("9wL6klgi4eJ7iBDT", "IzT1v2jQiJcth44V"), ("WmWj1cxPRw9c9Uc9", "6myPwHvhmbp9J5bi"),
                     ("tLxC2U4qoWIey3rA", "gD4vUQQAiYyMLXan"), ("f4PSKSys0cXpHlqq", "IFXp8uqTP12H8U9q"),
                     ("IcwUsYlidHL5HY6a", "8xYlLAZU0ykT5Q4u"), ("1Y20N2NZKbqyPu9e", "g0crIV5HS69T5PLs")]:
        it = _f(S, _id); a = it["system"]["activities"][aid]
        _base(a); a["target"] = one_creature()
        if not a.get("range", {}).get("value"): a["range"] = _r(5)
        mark(it)
    it = _f(S, "WmWj1cxPRw9c9Uc9")  # Opportunistic Blow
    apply(it["system"]["activities"]["6myPwHvhmbp9J5bi"], fx(it, "adv", "Opportunistic Blow", rounds=1, special=["1Attack"],
                                                             changes=[("flags.midi-qol.advantage.attack.all", 0, "1")]))
    it = _f(S, "tLxC2U4qoWIey3rA")  # Charger
    it["system"]["activities"]["gD4vUQQAiYyMLXan"]["damage"]["parts"] = [{"number": None, "denomination": None, "bonus": "",
        "types": [], "custom": {"enabled": True, "formula": "5"}, "scaling": {}}]
    note(it, "+5 damage only after a 10-ft straight-line move (remove the +5 otherwise).")
    it = _f(S, "4cVW3whZxaX8drIr")  # Polearm Master
    a = it["system"]["activities"]["137m0OJ1MTIpo7cw"]
    a["range"], a["target"] = _r(10), one_creature()
    a["attack"]["ability"] = ""
    a["damage"] = {"includeBase": False, "parts": [dice(1, 4, ["bludgeoning"], bonus="@mod")]}
    mark(it)
    it = _f(S, "IcwUsYlidHL5HY6a")  # GWM
    gw = act(it, "power", "utility", "Power attack: −5 to hit, +10 damage (next attack)", "special", range=RANGE_SELF, target=SELF)
    apply(gw, fx(it, "pw", "Great Weapon Master", rounds=1, special=["1Attack"],
                 changes=[("system.bonuses.mwak.attack", 2, "-5"), ("system.bonuses.mwak.damage", 2, "+10")]))
    free(it, gw)
    it = _f(S, "mmXJ2K9quT01hkQ1")  # Cadence
    a = it["system"]["activities"]["u8QnBvsioiOIFzqU"]
    act(it, "u8QnBvsioiOIFzqU", "utility", "Cadence (3 CE): the attack misses", "reaction", range=_r(60), target=one_creature())
    a = it["system"]["activities"]["u8QnBvsioiOIFzqU"]
    a["useConditionText"] = 'reaction === "isAttacked"'
    apply(a, fx(it, "miss", "Cadence: miss", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.fail.attack.all", 0, "1")]))
    f5 = act(it, "fail", "utility", "Cadence (5 CE): a creature fails its save", "reaction", range=_r(60), target=one_creature())
    apply(f5, fx(it, "fail", "Cadence: fail", rounds=1, special=["isSave"], changes=[("flags.midi-qol.fail.ability.save.all", 0, "1")]))
    cost(it, f5, 5)
    mark(it)
    it = _f(S, "DDXBbBTdzQNCzfBp")  # Offensive Creations: Block Strike
    a = it["system"]["activities"]["ChC5AhkO9RUqc50p"]
    a["name"] = "Block Strike (2 CE): cube-covered unarmed strike"
    a["range"], a["target"] = _r(5), one_creature()
    a["attack"] = _atk("melee")
    a["damage"] = {"includeBase": False, "parts": [dice(2, 8, ["bludgeoning"], bonus=CEMOD)]}
    note(it, "Block Strike damage shown as 2d8 + CE mod: check the full text.")
    mark(it)
    it = _f(S, "1szivA3tVCPn0poY")  # Instant Spirit Body
    a = it["system"]["activities"]
    on = a["enNw25iDlwHChB9h"]
    on["range"], on["target"] = RANGE_SELF, SELF
    apply(on, fx(it, "body", "Instant Spirit Body", rounds=600,
                 changes=[("system.attributes.ac.min", 4, "25"), ("flags.midi-qol.DR.all", 2, CEMOD)],
                 desc="AC at least 25; damage reduction = CE mod; elbow blades."))
    bl = a["ia8qHWFhVPuVV9YR"]
    bl["name"] = "Elbow Blade (1 CE): advantage, 15 ft reach"
    bl["range"], bl["target"] = _r(15), one_creature()
    bl["attack"] = _atk("melee")
    bl["attack"]["flat"] = False
    bl["damage"] = {"includeBase": False, "parts": [dice(1, 12, ["piercing"], bonus=CEMOD)]}
    apply(bl, fx(it, "adv", "Elbow Blade (advantage)", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.advantage.attack.all", 0, "1")]))
    mark(it)
    it = _f(S, "E1x5rroCXkdnRV2p")  # Minimum: Uzumaki
    a = it["system"]["activities"]["bjQNjov0ucG06ILz"]
    a["range"], a["target"] = _r(30), one_creature()
    a["attack"] = _atk()
    a["damage"] = {"includeBase": False, "parts": [dice(2, 12, ["necrotic"], scale=1)]}
    a["consumption"].setdefault("scaling", {})
    a["consumption"]["scaling"].update({"allowed": True, "max": "40"})
    a["name"] = "Minimum: Uzumaki (5 CE): Xd12 (X = combined CR)"
    it["flags"]["jjk5e"].setdefault("ceSteps", {}).pop("bjQNjov0ucG06ILz", None)
    note(it, "Scale = combined CR − 2 (no CE). Ignores resistance like Maximum: Uzumaki.")
    mark(it)
    it = _f(S, "kP7O0eTDhfNUku5J")  # Sword of Michael
    a = it["system"]["activities"]["teDztV4apu9WTrK7"]
    a["range"], a["target"] = _r(5), one_creature()
    a["attack"] = _atk("melee")
    a["damage"] = {"includeBase": False, "parts": [dice(10, 12, ["radiant"])]}
    apply(a, fx(it, "null", "Extinguished (Sword of Michael)", rounds=20,
                changes=[("flags.midi-qol.OverTime", 0, "turn=start, saveAbility=cha, saveDC=JJKORIGINDC, label=Extinguishment")]))
    mark(it)
    it = _f(S, "1Y20N2NZKbqyPu9e")  # Spatial Shatter
    a = it["system"]["activities"]["g0crIV5HS69T5PLs"]
    a["attack"] = _atk("melee")
    extra = act(it, "ice", "save", "Spatial Shatter: Thin Ice Breaker on the target", "special", save=_sv("dex"),
                damage={"onSave": "half", "parts": [{"number": None, "denomination": 10, "bonus": "", "types": ["force"],
                        "custom": {"enabled": True, "formula": f"(2 * {CEMOD})d10"}, "scaling": {}}]}, target=one_creature())
    apply(extra, fx(it, "prone", "Prone (Spatial Shatter)", statuses=["prone"]))
    free(it, extra)
    trigger(a, extra, "hitTargets")
    mark(it)

    # --- CE costs stated in the manual but missing ---
    it = _f(S, "SB9abj3aHRhwq4hL")  # Flowing Red Scale: Stack
    for e in it["effects"]:
        if e["_id"] == "tsOdgWTg8DKf5RTx": e["transfer"] = False
    stack = fx(it, "stack", "Flowing Red Scale: Stack", rounds=10,
               changes=[("system.attributes.ac.bonus", 2, "+4"), ("system.attributes.movement.all", 1, "3"),
                        ("flags.midi-qol.advantage.ability.save.dex", 0, "1"), ("flags.midi-qol.advantage.ability.save.str", 0, "1"),
                        ("flags.midi-qol.advantage.ability.check.str", 0, "1")],
               desc="Speed ×3, +4 AC, advantage on DEX/STR saves and STR checks, one reroll per round, +1 action and reaction.")
    it["effects"] = [e for e in it["effects"] if e["_id"] != "tsOdgWTg8DKf5RTx"]
    a = it["system"]["activities"]["t5X8c1RKR66NtqAe"]
    a["range"], a["target"] = RANGE_SELF, SELF
    a["effects"] = [{"_id": stack, "onSave": False}]
    b = act(it, "active", "utility", "Stack while Flowing Red Scale is active (3 CE)", "bonus", range=RANGE_SELF, target=SELF)
    apply(b, stack)
    cost(it, b, 3)
    mark(it)
    it = _f(S, "HpNz9JDqjejv7kjA")  # Crippling Neurotoxin
    a = it["system"]["activities"]["3cba2pcNizaydYT7"]
    a["name"] = "Enhance Poisonous Cursed Energy (+8 CE)"
    a["target"] = one_creature()
    cost(it, a, 8)
    mark(it)
    it = _f(S, "wueBNQftiq2TNnEp")  # Immobilized Limbs
    a = it["system"]["activities"]["0OG7tDUCtVYkIgzB"]
    a["name"] = "Legs: moving past speed → DEX or prone"
    a["target"] = one_creature()
    free(it, a)
    for key, nm, ch in [("legs", "Immobilized: legs", [("system.attributes.movement.all", 1, "0.5")]),
                        ("arms", "Immobilized: arms", [("system.bonuses.mwak.attack", 2, "-3"), ("system.bonuses.rwak.attack", 2, "-3"),
                                                      ("system.bonuses.msak.attack", 2, "-3"), ("system.bonuses.rsak.attack", 2, "-3")]),
                        ("torso", "Immobilized: torso", [("system.attributes.ac.bonus", 2, "-3")])]:
        x = act(it, key, "utility", f"Focus on {key} (+1 CE)", "special", target=one_creature())
        apply(x, fx(it, key, nm, rounds=None, changes=ch, desc="While you maintain Immobilizing Eyes."))
        cost(it, x, 1)
    mark(it)
    it = _f(S, "JTgtkz5kerB8bPLi")  # Tyrant Shikigami
    it["system"].setdefault("activities", {})
    for key, nm, ce in [("large", "Large (+1 CE)", 1), ("huge", "Huge (+2 CE, 11th)", 2), ("garg", "Gargantuan (+4 CE, 18th)", 4)]:
        x = act(it, key, "utility", f"Tyrant Shikigami: {nm}", "special", range=RANGE_SELF, target=SELF)
        cost(it, x, ce)
    note(it, "Per size step above Medium: +4 STR, +1d8 bite, +30 HP (edit the Major Star actor).")
    mark(it)
    it = _f(S, "QfLOEctmQ31XUVzQ")  # Crippling Strikes
    it["system"].setdefault("activities", {})
    x = act(it, "imm", "utility", "Immunity → resistance on this hit (+1 CE)", "special", target=one_creature())
    cost(it, x, 1)
    mark(it)
    it = _f(S, "dVbv4HFQOj5IzHa2")  # Blessing of Fortune
    a = it["system"]["activities"]["dDn14mENHutzpIc0"]
    a["name"] = "Turn a failed death save into a natural 20 (1 Miracle + 1 CE)"
    a["target"] = one_creature()
    cost(it, a, 1)
    mark(it)
    it = _f(S, "IceBoustbhnfJLd1")  # Maculation
    a = it["system"]["activities"]["M7SThcbJ6cXlHZdy"]
    a["name"] = "Maculation (1 CE per 5-ft Simple Domain, up to 6)"
    a["range"] = _r(30)
    cost(it, a, 1, 1, "6")
    g = act(it, "guard", "utility", "Maculation guard (reaction): +3 AC", "reaction", range=RANGE_SELF, target=SELF)
    g["useConditionText"] = 'reaction === "isAttacked"'
    apply(g, fx(it, "ac", "Maculation guard", special=["turnStartSource"], changes=[("system.attributes.ac.bonus", 2, "+3")]))
    free(it, g)
    mark(it)
    it = _f(S, "PHwPWELj9jl92FHN")  # Typhoon
    a = it["system"]["activities"]["pLtu13s5ZPKDJYTu"]
    a["range"], a["target"] = _r(60), one_creature()
    a["attack"] = _atk()
    free(it, a)
    sph = act(it, "storm", "save", "Typhoon sphere (+2 CE): STR or 2d6", "special", save=_sv("str"),
              damage={"onSave": "none", "parts": [dice(2, 6, ["bludgeoning"])]}, range=RANGE_SELF, target=sphere(20))
    cost(it, sph, 2)
    mark(it)
    it = _f(S, "Me90W7kGtBmtDa4X")  # Perfected Teleport
    note(it, "Teleport costs 1 CE; casting Teleport costs 8 − CE mod (adjust when using).")
    mark(it)
    it = _f(S, "Ag3jW3dNyAYU4Xjl")
    note(it, "Split the Dismantle dice into several attack rolls (roll Dismantle once per slash with fewer dice).")
    mark(it)
    it = _f(S, "yo0JVtjDuc8iwO5r")
    note(it, "Regression: no OAs; up to prof CE, +1 DC/check per extra CE.")
    mark(it)
    it = _f(S, "NqRyYQMgFucx13fq")
    note(it, "Pachinko attacks outside the domain: 30 ft, +CE mod damage, −1 CE (Green Balls free). No Expectation.")
    mark(it)


def review_fixes(S):
    """Technique-by-technique review against the manual (Nov 2026)."""
    # Antigravity: Disorienting Gravity (3rd) and Nauseating Gravity (Boosted System)
    gf = S.get("Gravity Field")
    dg = act(gf, "disorient", "save", "Disorienting Gravity: lifted creature (CON)", "special", save=_sv("con"),
             damage={"onSave": "none", "parts": []}, target=one_creature())
    apply(dg, fx(gf, "dis", "Disoriented by gravity", rounds=None, changes=[("flags.midi-qol.disadvantage.attack.all", 0, "1")],
                 desc="Attacks at disadvantage and can't maintain concentration while inside the field."))
    free(gf, dg)
    note(gf, "Focused System: exclude up to CE mod + prof creatures from your technique (don't target them).")
    mark(gf)
    bs = S.get("Boosted System")
    ns = act(bs, "stun", "utility", "Nauseating Gravity: failed Disorienting save → stunned", "special", target=one_creature())
    apply(ns, fx(bs, "stun", "Stunned (Nauseating Gravity)", rounds=2, statuses=["stunned"], special=["turnEnd"]))
    free(bs, ns)
    note(bs, "Sweeping Gravity: creatures with DEX score below your DC can't make DEX saves vs your technique. Hard Fall: fall damage d12.")
    mark(bs)

    # Blood Manipulation: Crimson Rain + Convergence prone
    bt = S.get("Blood Techniques")
    cr = act(bt, "rainprone", "utility", "Crimson Rain with Convergence: failed save → prone", "special", target=one_creature())
    apply(cr, fx(bt, "prone", "Prone (Crimson Rain)", statuses=["prone"]))
    free(bt, cr)
    mark(bt)

    # Comedian: punchline shapes; Comedic Foil aura
    cb = S.get("Commit to the Bit")
    base = cb["system"]["activities"]["uenzuFk571nNCSdD"]
    base["name"] = "Powerful Punchline (3 CE): 30-ft sphere within 80 ft"
    for key, nm, tgt in [("line", "Powerful Punchline (3 CE): 60-ft line", {"template": {"type": "line", "size": "60", "width": "5", "units": "ft", "count": "1", "contiguous": False}, "affects": {"type": "creature", "choice": False}, "override": True}),
                         ("cone", "Powerful Punchline (3 CE): 30-ft cone", sphere(30, kind="cone"))]:
        x = act(cb, key, "save", nm, "action", save=_sv(["str", "dex", "con"]), damage=json.loads(json.dumps(base["damage"])),
                range=RANGE_SELF, target=tgt)
        cost(cb, x, 3)
    note(cb, "Punchline damage can't kill (stop at 1 HP).")
    mark(cb)
    cf = S.get("Comedic Foil")
    cf.setdefault("system", {}).setdefault("activities", {})
    au = act(cf, "aura", "utility", "Comedic Foil aura (while the technique is active)", "special", range=RANGE_SELF, target=sphere(300))
    au["target"]["affects"]["type"] = "enemy"
    apply(au, fx(cf, "foil", "Comedic Foil", rounds=10,
                 changes=[("flags.midi-qol.OverTime", 0, "turn=start, saveAbility=JJKCESAVE, saveDC=JJKORIGINDC, label=Comedic Foil (can't interfere with the joke)")],
                 desc="Failed CE save: can't use techniques that would interfere with the current joke until its next turn."))
    free(cf, au)
    mark(cf)

    # Cursed Speech: 35-ft cone (11th)
    rv = S.get("Resounding Voice")
    rv.setdefault("system", {}).setdefault("activities", {})
    x = act(rv, "cone", "utility", "Speak in a 35-ft cone (+3 CE)", "special", range=RANGE_SELF, target=sphere(35, kind="cone"))
    cost(rv, x, 3)
    note(rv, "Use the cone template with the Cursed Speech command you speak.")
    mark(rv)

    # Esoteric Art: the four Impasto traps
    ic = S.get("Impasto Canvas")
    ic["system"]["activities"]["OCUpf0dX1NW95qdb"]["name"] = "Pit Trap (DEX): 2d6 + prone"
    ic["system"]["activities"]["OCUpf0dX1NW95qdb"]["effects"] = [{"_id": "5x8CYrTMV4LHqdiE", "onSave": False}]
    ic["system"]["activities"]["OCUpf0dX1NW95qdb"]["target"] = one_creature()
    for key, nm, dmg, fxid, tgt in [
        ("spike", "Spike Trap (DEX): 2d10 piercing + prone", [dice(2, 10, ["piercing"])], "5x8CYrTMV4LHqdiE", one_creature()),
        ("snare", "Snare Trap (DEX): restrained", [], "VnwjNLPHF7f26e7y", one_creature()),
        ("boulder", "Boulder Trap (DEX): 30-ft line, 4d10 + prone", [dice(4, 10, ["bludgeoning"])], "5x8CYrTMV4LHqdiE",
         {"template": {"type": "line", "size": "30", "width": "5", "units": "ft", "count": "1", "contiguous": False}, "affects": {"type": "creature", "choice": False}, "override": True})]:
        x = act(ic, key, "save", nm, "special", save=_sv("dex"), damage={"onSave": "half" if dmg else "none", "parts": dmg}, target=tgt)
        apply(x, fxid)
        free(ic, x)
    ot_save(ic, "VnwjNLPHF7f26e7y", "str", "Snare Trap (Athletics/Acrobatics)", when="start")
    mark(ic)

    # Faceless God: WIS save to shed corruption
    mi = S.get("Madness Inducement")
    rd = act(mi, "reduce", "save", "Out of sight: WIS save to reduce corruption by 5%", "special", save=_sv("wis"),
             damage={"onSave": "none", "parts": []}, range=RANGE_SELF, target=SELF)
    rd["save"]["dc"] = {"calculation": "", "formula": "@flags.jjk5e.corruptionDC || 15"}
    rd["activation"]["condition"] = "Repeat at the start of each turn without line of sight to the caster; on a success remove 5% (down to 25%)."
    free(mi, rd)
    rd["save"]["dc"] = {"calculation": "spellcasting", "formula": ""}
    note(mi, "Madness Removal: use the WIS save activity (DC = caster's CE DC; roll it from the caster's sheet or set the DC by hand).")
    mark(mi)

    # G Warstaff: foresight as a reaction too
    w = S.get("Warstaff")
    for src, key in [("goNV077dC7CKHtnH", "re1"), ("U7F4yTcIZ447z471", "re3")]:
        o = w["system"]["activities"][src]
        x = act(w, key, "utility", o["name"].replace("(1 CE)", "(1 CE, reaction)"), "reaction", range=_r(120), target=one_creature())
        x["useConditionText"] = 'reaction === "isAttacked"'
        x["effects"] = [dict(e) for e in o["effects"]]
        cost(w, x, 1)
    mark(w)

    # Idle Transfiguration: full Self-Alteration table
    al = S.get("Alteration")
    wings = al["system"]["activities"]["D62ba08tj9lXTXNW"]
    wings["name"] = "Self-Alteration: Wings (4 CE)"
    al["flags"]["jjk5e"]["ceCosts"]["D62ba08tj9lXTXNW"] = 4
    for e in al["effects"]:
        if e["_id"] == "xOueQF38LSoHmu8d":
            e["changes"] = [{"key": "system.attributes.movement.fly", "mode": 4, "value": "60", "priority": 20}]
            e["description"] = "60 ft fly speed; +2 AC while at least 15 ft away from enemies (add by hand)."
    for e in al["effects"]:
        if e["_id"] == "73JDsjL5UaIYtIMf": e["description"] = "Unarmed strikes deal piercing damage and + proficiency."
        if e["_id"] == "1K3HwhLv8yhXv94g": e["description"] = "Unarmed strikes deal slashing and count as light, finesse, martial melee weapons."
        if e["_id"] == "Gh79cTXIIPEKHaVd": e["description"] = "Melee reach +10 ft."
    hh = act(al, "hooves", "utility", "Self-Alteration: Horse Hooves (3 CE)", "bonus", range=RANGE_SELF, target=SELF)
    apply(hh, fx(al, "hooves", "Horse Hooves", rounds=None, changes=[("system.attributes.movement.walk", 2, "+10")], desc="+10 ft speed; Dash as a bonus action."))
    cost(al, hh, 3)
    sk = act(al, "spiked", "utility", "Self-Alteration: Spiked Skin (2 CE)", "bonus", range=RANGE_SELF, target=SELF)
    apply(sk, fx(al, "spiked", "Spiked Skin", rounds=None))
    cost(al, sk, 2)
    rx = act(al, "spikes", "damage", "Spiked Skin (reaction to a melee attack within 5 ft)", "reaction", target=one_creature(),
             damage={"parts": [{"number": None, "denomination": None, "bonus": "", "types": ["piercing"],
                     "custom": {"enabled": True, "formula": "4 * @prof"}, "scaling": {}}]})
    rx["useConditionText"] = 'reaction === "isAttacked"'
    free(al, rx)
    for key, nm, ch in [("big", "Size Change: enlarge (2 CE, 6th)", [("flags.midi-qol.advantage.ability.check.str", 0, "1"), ("flags.midi-qol.advantage.ability.save.str", 0, "1"),
                                                                   ("system.bonuses.mwak.damage", 2, "+ 1d4")]),
                        ("small", "Size Change: reduce (2 CE, 6th)", [("flags.midi-qol.advantage.ability.check.dex", 0, "1"), ("flags.midi-qol.advantage.ability.save.dex", 0, "1"),
                                                                     ("system.attributes.ac.bonus", 2, "+1")])]:
        x = act(al, key, "utility", nm, "bonus", range=RANGE_SELF, target=SELF)
        apply(x, fx(al, key, nm.split(" (")[0], rounds=10, changes=ch, desc="One size category bigger/smaller for 1 minute (resize the token)."))
        cost(al, x, 2)
    note(al, "Restrictions: Sword Arms ✗ Spike Hands/Wings; Spike Hands ✗ Sword Arms/Wings; Arm Shields and Long Arms ✗ Wings.")
    mark(al)

    # Ten Shadows: Divine Dogs appear within 10 ft
    dd = S.get("Divine Dogs")
    for a in dd["system"]["activities"].values():
        if a["type"] == "summon": a["range"] = _r(10)
    mark(dd)

    # Paralyzing Gaze: maintain with a bonus action
    pg = S.get("Maximum: Paralyzing Gaze")
    pg["system"]["activities"]["S3EuFdYe8bgPf0Cl"]["activation"]["type"] = "bonus"
    mark(pg)

    # Straw Doll: Hair Pin reaction detonation
    hp_ = S.get("Hair Pin")
    o = hp_["system"]["activities"]["eYayPO9O7w18fnMl"]
    o["name"] = "Hair Pin: detonate (bonus action)"
    x = act(hp_, "react", "save", "Hair Pin: detonate (reaction: creature within 5 ft of a nail)", "reaction", save=_sv("dex"),
            damage=json.loads(json.dumps(o["damage"])), range=_r(5), target=sphere(10))
    free(hp_, x)
    mark(hp_)

    # Ten Shadows domain: swap with a shadow clone
    d = S.get("Domain Expansion: Chimera Shadow Garden")
    x = act(d, "swap", "utility", "Swap places with a Shadow Clone when hit (reaction)", "reaction", range=RANGE_SELF, target=SELF)
    x["useConditionText"] = 'reaction === "isHit"'
    free(d, x)
    mark(d)

    # Tool Mastery: grant advantage with an imbued tool
    tm = S.get("Tool Mastery")
    x = act(tm, "adv", "utility", "Grant advantage to an attack with your imbued tool (reaction)", "reaction", range=_r(60), target=one_creature())
    apply(x, fx(tm, "adv", "Imbued tool: advantage", rounds=1, special=["1Attack"], changes=[("flags.midi-qol.advantage.attack.all", 0, "1")]))
    free(tm, x)
    mark(tm)

    # Vengeful Spirit: persuasion to unmanifest
    vs = S.get("Vengeful Spirit Manifestation")
    x = act(vs, "calm", "utility", "Calm the spirit: DC 20 Persuasion (free, once per round)", "special", range=RANGE_SELF, target=SELF,
            roll={"formula": "1d20 + @skills.per.total", "name": "Persuasion vs DC 20", "prompt": False, "visible": True})
    free(vs, x)
    mark(vs)


TECHNIQUES = {"Antigravity System": antigravity_system,
              "Auspicious Beast Summon": auspicious_beast_summon,
              "Black Bird Manipulation": black_bird_manipulation,
              "Black Box": black_box,
              "Blood Manipulation": blood_manipulation,
              "Boogie Woogie": boogie_woogie,
              "Cursed Speech": cursed_speech,
              "Blazing Courage": blazing_courage,
              "Body Manipulation": body_manipulation,
              "Centipede Shroud": centipede_shroud,
              "Clone": clone,
              "Comedian": comedian,
              "Construction": construction,
              "Contractual Recreation": contractual_recreation,
              "Cursed Cannon": cursed_cannon,
              "Cursed Circuitry": cursed_circuitry,
              "Cursed Corpse Creation": cursed_corpse_creation,
              "Cursed Spirit Manipulation": cursed_spirit_manipulation,
              "Cursed Transmutation": cursed_transmutation,
              "Dark Claw": dark_claw,
              "Deadly Sentencing": deadly_sentencing,
              "Disaster Flames": disaster_flames,
              "Disaster Storms": disaster_storms,
              "Disaster Tides": disaster_tides,
              "Disaster Verdure": disaster_verdure,
              "Disaster Vermin": disaster_vermin,
              "Divergent Fist": divergent_fist,
              "Dragon Vein": dragon_vein,
              "Earth Manipulation": earth_manipulation,
              "Eight Heads": eight_heads,
              "Esoteric Art": esoteric_art,
              "Explosive Flesh": explosive_flesh,
              "Fa Jin": fa_jin,
              "Faceless God": faceless_god,
              "Fate": fate,
              "G Warstaff": g_warstaff,
              "Golden Hour": golden_hour,
              "Hair Manipulation": hair_manipulation,
              "Heart Catch": heart_catch,
              "Ice Formation": ice_formation,
              "Idle Transfiguration": idle_transfiguration,
              "Illusive Mirage": illusive_mirage,
              "Inverse": inverse,
              "Laplace’s Demon": laplaces_demon,
              "Limitless": limitless,
              "Love Rendezvous": love_rendezvous,
              "Miracle": miracle,
              "Missile Fist": missile_fist,
              "Moon Dregs": moon_dregs,
              "Mythical Beast Amber": mythical_beast_amber,
              "New Shadow Style": new_shadow_style,
              "Pachinko Fever": pachinko_fever,
              "Pain Killer": pain_killer,
              "Paralyzing Gaze": paralyzing_gaze,
              "Prayer Song": prayer_song,
              "Projection Sorcery": projection_sorcery,
              "Puppet Manipulation": puppet_manipulation,
              "Ratio": ratio,
              "Regalia": regalia,
              "Retrograde": retrograde,
              "Rockstar": rockstar,
              "Rot": rot,
              "Schrift X": schrift_x,
              "Seance": seance,
              "Shadow Killer": shadow_killer,
              "Shrine": shrine,
              "Sky Manipulation": sky_manipulation,
              "Solo Forbidden Zone": solo_forbidden_zone,
              "Star Dictator": star_dictator,
              "Star Rage": star_rage,
              "Starlight Symphony": starlight_symphony,
              "Straw Doll Technique": straw_doll,
              "Technique Extermination": technique_extermination,
              "Teleportation": teleportation,
              "Tool Manipulation": tool_manipulation,
              "Triple Core": triple_core,
              "Ten Shadows": ten_shadows,
              "Vairocana": vairocana,
              "Vengeful Spirit Manipulation": vengeful_spirit,
              "Voracity": voracity,
              "████ and Light": light,
              "_leftovers": leftovers,
              "_sanitize": sanitize,
              "_feats": feat_fixes,
              "_review": review_fixes}

if __name__ == "__main__":
    args = sys.argv[1:]
    names = list(TECHNIQUES) if "--all" in args else args
    S = Store()
    for n in names: TECHNIQUES[n](S)
    S.save()
