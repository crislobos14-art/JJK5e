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

    def get(self, name, pack="jjk5e-techniques", technique=None):
        hits = [d for (pk, _, d) in self.src.values() if pk == pack and d["name"] == name
                and (technique is None or d.get("flags", {}).get("jjk5e", {}).get("technique") == technique)]
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
              "Esoteric Art": esoteric_art}

if __name__ == "__main__":
    args = sys.argv[1:]
    names = list(TECHNIQUES) if "--all" in args else args
    S = Store()
    for n in names: TECHNIQUES[n](S)
    S.save()
