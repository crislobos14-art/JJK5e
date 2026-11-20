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


TECHNIQUES = {"Antigravity System": antigravity_system,
              "Auspicious Beast Summon": auspicious_beast_summon,
              "Black Bird Manipulation": black_bird_manipulation}

if __name__ == "__main__":
    args = sys.argv[1:]
    names = list(TECHNIQUES) if "--all" in args else args
    S = Store()
    for n in names: TECHNIQUES[n](S)
    S.save()
