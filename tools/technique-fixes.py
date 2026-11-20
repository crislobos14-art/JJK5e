"""Hand-written automation for innate techniques, one technique at a time (Midi-QOL + DAE).

Each technique has a function below, written from its manual text. The script edits the compendium sources
(src/packs/...) and the fallback data (data/...) identically, so the audit's source/fallback checks stay green.

  python3 tools/technique-fixes.py "Antigravity System"
  python3 tools/technique-fixes.py --all
"""
import hashlib, json, os, sys

ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
PACKS = {"jjk5e-techniques": "data/jjk5e-techniques.json", "jjk5e-feats": "data/jjk5e-feats.json"}
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

    def get(self, name, pack="jjk5e-techniques"):
        hits = [d for (pk, _, d) in self.src.values() if pk == pack and d["name"] == name]
        if len(hits) != 1: raise KeyError(f"{name}: {len(hits)} matches in {pack}")
        self.dirty.add(hits[0]["_id"])
        return hits[0]

    def save(self):
        for _id in sorted(self.dirty):
            pack, p, d = self.src[_id]
            for e in d.get("effects", []):
                e["_key"] = f"!items.effects!{d['_id']}.{e['_id']}"
            with open(p, "w", encoding="utf-8") as f: f.write(json.dumps(d, ensure_ascii=False, indent=1) + "\n")
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
         "flags": {"jjk5e": {"technique": item["flags"]["jjk5e"].get("technique")}}}
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


TECHNIQUES = {"Antigravity System": antigravity_system,
              "Auspicious Beast Summon": auspicious_beast_summon,
              "Black Bird Manipulation": black_bird_manipulation,
              "Black Box": black_box,
              "Blood Manipulation": blood_manipulation,
              "Boogie Woogie": boogie_woogie,
              "Cursed Speech": cursed_speech}

if __name__ == "__main__":
    args = sys.argv[1:]
    names = list(TECHNIQUES) if "--all" in args else args
    S = Store()
    for n in names: TECHNIQUES[n](S)
    S.save()
