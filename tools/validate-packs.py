"""Static checks for compendium sources: activity/effect structure, damage types, formulas, Midi keys."""
import json,glob,re,collections,sys
DMG={"acid","bludgeoning","cold","fire","force","lightning","necrotic","piercing","poison","psychic","radiant","slashing","thunder"}
HEAL={"healing","temphp","maximum"}
ACTT={"attack","save","damage","heal","utility","summon","check","enchant","cast","forward","transform"}
ACTV={"action","bonus","reaction","special","minute","hour","day","legendary","lair","mythic","crew","turnStart","turnEnd","longRest","shortRest","encounter",""}
TPL={"circle","cone","cube","cylinder","line","radius","sphere","square","wall",""}
RU={"self","touch","ft","mi","spec","any","m","km",""}
DUR={"inst","turn","round","minute","hour","day","week","month","year","perm","spec","disp","dstr","",None}
ONS={"none","half","full"}
AB={"str","dex","con","int","wis","cha"}
STAT=set("blinded charmed deafened frightened grappled incapacitated invisible paralyzed petrified poisoned prone restrained stunned unconscious exhaustion dead bleeding burning concentrating cursed dehydration diseased encumbered falling flying hiding malnutrition marked silenced sleeping stable surprised suffocation transformed".split())
ROOTS={"scale","abilities","details","prof","attributes","scaling","mod","skills","resources","item","flags","classes","activity","bonuses","spell","traits"}
issues=collections.Counter(); out=[]
def bad(item,msg):
    issues[msg.split(':')[0]]+=1; out.append(f"{item}: {msg}")
def chkf(item,where,f):
    if not isinstance(f,str): return
    if f.count('(')!=f.count(')'): bad(item,f"parens:{where}:{f}")
    # Objects in dnd5e roll data, not numbers (use .value / .mod), and slots that depend on a world setting.
    for m in re.findall(r'@abilities\.[a-z]{3}\.save(?![.\w])|@resources\.(?:primary|secondary|tertiary)\b|@flags\.jjk5e\.crows\b',f): bad(item,f"rolldata-path:{where}:{m}")
    for r in re.findall(r'@([a-zA-Z]+)',f):
        if r not in ROOTS: bad(item,f"root:{where}:@{r}")
for fn in glob.glob('src/packs/jjk5e-*/*.json'):
    d=json.load(open(fn)); n=d.get('name'); sysd=d.get('system',{})
    effs={e['_id']:e for e in d.get('effects',[])}
    acts=sysd.get('activities',{}) or {}
    for e in effs.values():
        for s in e.get('statuses',[]) or []:
            if s not in STAT: bad(n,f"status:{s}")
        for c in e.get('changes',[]):
            if c.get('mode') not in range(0,6): bad(n,f"mode:{c}")
            v=str(c.get('value')); chkf(n,'fx '+c['key'],v)
            if '@scaling' in v: bad(n,f"scaling-in-effect:{e['name']}:{c['key']}")
            if c['key'].endswith('dm.amount.all'): bad(n,f"dm.all:{e['name']}")
            if 'critical.range' in c['key'] or 'max.attack' in c['key'] or 'grants.fail' in c['key']: bad(n,f"badkey:{c['key']}")
            if c['key'].startswith('system.traits.d') and c['key'].endswith('.value') and v not in DMG|{'physical'} and 'traits.ci' not in c['key']: bad(n,f"trait:{c['key']}={v}")
            if c['key']=='system.traits.ci.value' and v not in STAT: bad(n,f"ci:{v}")
            if c['key']=='flags.midi-qol.OverTime':
                m=re.search(r'damageType=([a-z]+)',v)
                if m and m.group(1) not in DMG|HEAL|{'none'}: bad(n,f"ot-type:{m.group(1)}")
                if '|' in v: bad(n,f"ot-multi:{e['name']}")
    for eid in effs:
        if not re.fullmatch(r'[A-Za-z0-9]{16}',str(eid)): bad(n,f"effect-id:{eid}")
    for e in (d.get('effects') or []):
        k=e.get('_key')
        if k and not re.search(r'[.!]'+re.escape(str(e.get('_id')))+'$',k): bad(n,f"effect-key:{k}")
    for aid,a in acts.items():
        w=f"{a.get('name')}"
        if not re.fullmatch(r'[A-Za-z0-9]{16}',str(aid)) or a.get('_id',aid)!=aid: bad(n,f"activity-id:{aid}")
        calc=((a.get('save') or {}).get('dc') or {}).get('calculation')
        if calc not in {None,'','initial','spellcasting'}|AB: bad(n,f"dc-calculation:{w}:{calc}")
        if a.get('type') not in ACTT: bad(n,f"acttype:{a.get('type')}")
        if (a.get('activation') or {}).get('type') not in ACTV: bad(n,f"activation:{a['activation'].get('type')}")
        for ref in a.get('effects',[]) or []:
            if ref.get('_id') not in effs: bad(n,f"missing-effect:{w}:{ref.get('_id')}")
        t=(a.get('target') or {}).get('template') or {}
        if t.get('type') not in TPL and t: bad(n,f"tpl:{t.get('type')}")
        chkf(n,w+' tplsize',t.get('size'))
        du=a.get('duration') or {}
        if du.get('units') not in DUR: bad(n,f"duration-units:{w}:{du.get('units')}")
        if du.get('concentration') and du.get('units') in ('inst',None,''): bad(n,f"concentration-inst:{w}")
        r=a.get('range') or {}
        if r.get('units') not in RU|{None}: bad(n,f"range-units:{r.get('units')}")
        chkf(n,w+' range',r.get('value'))
        dm=a.get('damage') or {}
        if 'onSave' in dm and dm['onSave'] not in ONS: bad(n,f"onSave:{dm['onSave']}")
        for p in dm.get('parts',[]) or []:
            for ty in p.get('types',[]):
                if ty not in DMG: bad(n,f"dmgtype:{w}:{ty}")
            if (p.get('custom') or {}).get('enabled'): chkf(n,w+' dmg',p['custom']['formula'])
            chkf(n,w+' bonus',p.get('bonus'))
            if '@mod' in str(p.get('bonus'))+str((p.get('custom') or {}).get('formula')) and a['type'] not in ('attack','save'): bad(n,f"mod-nonattack:{w}")
        h=a.get('healing') or {}
        for ty in h.get('types',[]) or []:
            if ty not in HEAL: bad(n,f"healtype:{ty}")
        if (h.get('custom') or {}).get('enabled'): chkf(n,w+' heal',h['custom']['formula'])
        if a.get('type')=='heal' and not h: bad(n,f"heal-no-healing:{w}")
        if a.get('type')=='save':
            ab=(a.get('save') or {}).get('ability',[])
            if not ab: bad(n,f"save-no-ability:{w}")
            for x in ab:
                if x not in AB: bad(n,f"save-ab:{x}")
            chkf(n,w+' dc',((a.get('save') or {}).get('dc') or {}).get('formula'))
        if a.get('type')=='attack' and not a.get('attack'): bad(n,f"attack-no-attack:{w}")
        if a.get('roll'): chkf(n,w+' roll',a['roll'].get('formula'))
        for tg in (a.get('consumption') or {}).get('targets',[]) or []:
            if tg.get('type')=='itemUses' and not (sysd.get('uses') or {}).get('max'): bad(n,f"itemUses-no-max:{w}")
            if tg.get('type')=='activityUses' and not (a.get('uses') or {}).get('max'): bad(n,f"activityUses-no-max:{w}")
            chkf(n,w+' cons',tg.get('value'))
        mp=a.get('midiProperties') or {}
        tid=mp.get('triggeredActivityId')
        if tid and tid not in acts: bad(n,f"trigger-missing:{w}")
    fl=d.get('flags',{}).get('jjk5e',{})
    for k in ('ceCosts','ceSteps','dmgScale','trackerUse','trackerDice','ceRegain','reload','tokenSwap','summonRules','activityLevel'):
        for aid in (fl.get(k) or {}):
            if aid not in acts: bad(n,f"{k}-orphan:{aid}")
    if (sysd.get('uses') or {}).get('max'): chkf(n,'uses',sysd['uses']['max'])
print(dict(issues) or "ok"); print("\n".join(out[:400])); sys.exit(1 if out else 0)
