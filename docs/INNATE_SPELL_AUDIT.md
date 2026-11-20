# Auditoría estática individual de spells innatos — JJK5e

> Generado desde el compendio y las fuentes. **No certifica ejecución en Foundry ni fidelidad semántica a cada regla**.

- Spells examinados: **360**; técnicas agrupadas: **81**.
- Utilidad sin efecto configurado: revisar lógica: **112**.
- Utilidad con efecto: comprobar activación: **17**.
- Dominio genérico: resolver propiedades particulares: **53**.
- Salvación sin daño/efecto automático: **29**.
- Ataque sin daño propio: comprobar intención: **10**.
- Mecánica configurada; falta prueba Foundry: **120**.
- Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry: **19**.

## Interpretación

- **Mecánica configurada** significa que existe una actividad de ataque/daño/salvación/curación/invocación, pero aún debe verificarse su regla, objetivo, costo, resultado, duración y comportamiento multijugador.
- **Utilidad sin efecto** puede ser una decisión manual, una habilidad pasiva o una función incompleta. No se rellena con efectos inventados.
- **Dominio** puede usar el motor genérico de expansión, que no implementa necesariamente las peculiaridades de cada dominio.
- **Ataque sin daño propio** puede ser válido cuando su efecto depende del arma u otra actividad; requiere revisión individual.

## Inventario por técnica

### Antigravity System (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Antigravity | 1 | save:Action (3 CE); damage:Fall damage (field ends); save:Disorienting Gravity (Gravity Field); utility:Nauseating Gravity (Boosted System) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/antigravity_YYIXcaNXo5YH89Yp.json) |
| Gravity Field | 3 | utility:Light Fall — Reaction (1 CE) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/gravity-field_XJWuaIPUC0PQuyZ1.json) |
| Antigravity Shield | 6 | utility:Reaction (2 CE) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/antigravity-shield_PeFhjb43m6fIn3JU.json) |
| Boosted System | 11 | utility:Lasting Field (1+ CE) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/boosted-system_7QrXKBBmTXN0jBGO.json) |
| Domain Expansion: Zero Gravity | 18 | utility:Expand Domain (20 CE); utility:Initiative 20: Antigravity (sure-hit) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-zero-gravity_PMfC5O2A8EvH721k.json) |

### Auspicious Beast Summon (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Auspicious Beast #1: Kaichi | 1 | utility:Summon Kaichi — Action (1 CE); attack:Kaichi Horn (extra attack) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/auspicious-beast-1-kaichi_YljWeNwIC8We2aY4.json) |
| Auspicious Beast #2: Reiki | 3 | utility:Bonus Action (1 CE); utility:Reaction (2 CE) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/auspicious-beast-2-reiki_KToQLeKrM7o8UuVK.json) |
| Auspicious Beast #3: Kirin | 6 | heal:Bonus Action (1+ CE) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/auspicious-beast-3-kirin_1rOPHbR5sjBm2zKZ.json) |
| Auspicious Beast #4: Ryu | 11 | save:Action (10 CE); utility:Ryu: command (bonus action) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/auspicious-beast-4-ryu_NcFMNwa5YsVhp9y3.json) |
| Domain Expansion: Auspicious Beasts’ Realm | 18 | utility:Expand Domain (20 CE); heal:Initiative 20: Kirin refresh | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-auspicious-beasts-realm_1YkXcsbuzkLSjva5.json) |

### Black Bird Manipulation (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Cursed Crows | 1 | utility:Action (1 CE); utility:See through a crow (Action) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/cursed-crows_y3LBulYKMnbDwSNs.json) |
| Omen of Death | 3 | save:Bonus Action | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/omen-of-death_aCWMUrg04UP5kxwC.json) |
| Raven’s Eye | 6 | utility:Bonus Action | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/raven-s-eye_VRx1ByQ8bVhRmbdx.json) |
| Bird Strike | 11 | save:Action (8 CE); utility:Damaged limb (d6) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/bird-strike_9Q2ddIFWSmNrpEH8.json) |
| Domain Expansion: Black Mahakala | 18 | utility:Expand Domain (20 CE); save:Initiative 20: Bird Strike ×3 (free) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-black-mahakala_Ao4mm1RP1nEiYzPS.json) |

### Black Box (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Dark Cube | 1 | save:Action (2+ CE) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/dark-cube_gniQgtH4HauRqvgz.json) |
| Perfect Cube | 6 | utility:Extra (5 CE) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/perfect-cube_0VcTooXJ3pi9MX0A.json) |
| Maximum: Midnight Armor | 11 | heal:Action (6+ CE); attack:Midnight Armor strike (unarmed) | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-midnight-armor_LUVi8jTFaORAG7eK.json) |
| Domain Expansion: Primordial Gap | 18 | utility:Expand Domain (20 CE); save:Initiative 20: three Perfect Cubes | Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-primordial-gap_eaPQms8jfUQLLGOl.json) |

### Blazing Courage (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Ignition | 1 | damage:Bonus Action (1+ CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/ignition_frIRVKvBDYwCRUVj.json) |
| Mantle of Courage | 3 | save:Special (3 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/mantle-of-courage_zPJOSM22ueBIRL4q.json) |
| Maximum: Conflagration | 11 | save:Action (10 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-conflagration_aUswLfL2rRp0CXOG.json) |
| Domain Expansion: Fire of the Heart | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-fire-of-the-heart_vGPxt14AJTLy0Gyu.json) |

### Blood Manipulation (6 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Blood Constructs | 1 | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/blood-constructs_NKo4xTL2nxoqeOSt.json) |
| Blood Techniques | 1 | save:Action (1 CE); save:Action (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/blood-techniques_s8hzPznLcMB8vsLg.json) |
| Flowing Red Scale | 3 | utility:Bonus Action (3 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/flowing-red-scale_0LPEMZDITFa9osgY.json) |
| Convergence | 6 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/convergence_NY4mXqV70GgnVRot.json) |
| Piercing Blood | 11 | save:Action (8 CE); save:Convergence: sweep the lingering beam | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/piercing-blood_4tuBpUmDZZPmETHW.json) |
| Domain Expansion: Bloodbath | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-bloodbath_Fbv1XCPZS9QhB6nh.json) |

### Body Manipulation (1 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Graverobber | 1 | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/graverobber_QoIxDJ2ApVfogPIv.json) |

### Boogie Woogie (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Boogie | 1 | utility:Action (1 CE); utility:Bonus Action (1 CE); utility:Reaction (3 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/boogie_5vAGmViQgCS1lFHt.json) |
| Clap Back | 6 | utility:Special (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/clap-back_wh6kIPv5jF9mXwov.json) |
| Domain Expansion: Standing Ovation | 18 | utility:Special; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-standing-ovation_jH3RgblvAF3tyNmI.json) |

### Centipede Shroud (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Cursed Centipede | 1 | utility:Bonus Action (3 CE); utility:Bonus Action (free once per long rest) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/cursed-centipede_21lnu8kbAphhST0q.json) |
| Earthquake | 6 | save:Action (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/earthquake_DkEVmnT5xCcHJWzN.json) |
| Hundred Leg Catastrophe | 11 | save:Action (8 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/hundred-leg-catastrophe_k2z0gWagLw0keUWh.json) |
| Domain Expansion: Oomukade Banzai | 18 | utility:Special; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-oomukade-banzai_AL362dkbXUfLAD8r.json) |

### Clone (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| One Man Army | 1 | utility:Action (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/one-man-army_BTUW78kwj863OxX0.json) |
| Twice the Fun | 3 | utility:Create clones (3 CE each) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/twice-the-fun_huWZEPcUrmqk36im.json) |
| Four is a Party | 11 | utility:Bonus Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/four-is-a-party_SDramqMcTdzcvVKw.json) |
| Domain Expansion: Divide and Conquer | 18 | utility:Bonus Action; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-divide-and-conquer_yHfhhod8QZmTjtWa.json) |

### Comedian (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Comedy | 1 | utility:Action (1 CE); save:Action | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/comedy_Jl4NsvTGrLe6S2DE.json) |
| Commit to the Bit | 3 | utility:Action (1 CE); utility:Bonus Action (2 CE); save:Action (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/commit-to-the-bit_ddEwns90CtDAv2iC.json) |
| Maximum: Peak Comedy | 11 | utility:Action (10 CE); utility:Action (2 CE); save:Action | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/maximum-peak-comedy_8lD36BfUqndCBmNA.json) |
| Domain Expansion: Stand Up Comedy | 18 | damage:Bonus Action; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-stand-up-comedy_kCIBMzUknW2TOySQ.json) |

### Construction (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Construct | 1 | utility:Bonus Action (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/construct_uJBhnTudE8G6T5WK.json) |
| Cursed Creation | 3 | utility:Action (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/cursed-creation_3SKl5qzgphoe5in3.json) |
| Liquid Metal | 6 | utility:Extra (4 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/liquid-metal_O4cN7o6CDngD9xOo.json) |
| Insectoid Armor | 11 | utility:Bonus Action (10 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/insectoid-armor_BQMHIhgw7gdse8gy.json) |
| Domain Expansion: Threefold Affliction | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-threefold-affliction_Z4nVb185TCkskJ4R.json) |

### Contractual Recreation (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Recreation | 1 | utility:Action (4 CE); save:Action (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/recreation_Z9Ni91hHu2mMVtHZ.json) |
| Quick Spender | 3 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/quick-spender_qP8ItUbMudHGs7Ms.json) |
| Contractual Control | 11 | save:Bonus Action (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/contractual-control_KQ0xKxXHF4freo6F.json) |
| Domain Expansion: Black Friday | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-black-friday_h9YVxaMHywr3BtDi.json) |

### Cursed Cannon (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Granite Blast | 1 | attack:Action (1+ CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/granite-blast_TlxFnlnJaW0uDBcH.json) |
| Maximum: Granita Lusso | 11 | save:Action (6+ CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/maximum-granita-lusso_0Vvjb032PUzeQY5O.json) |
| Domain Expansion: Il Gran Dolce | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-il-gran-dolce_fXBj2a32DG28BgH1.json) |

### Cursed Circuitry (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Circuit | 1 | utility:Bonus Action (2 CE); utility:Action (5 CE); damage:Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/circuit_LLsfnjkR98WtV2WQ.json) |
| Pure Energy Efficiency | 3 | utility:Action (10 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/pure-energy-efficiency_4bXHS5NUENSlo5bS.json) |
| High Performance Circuit | 6 | utility:Bonus Action (2 CE); damage:Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/high-performance-circuit_w5mMIEOHpgEp361L.json) |
| Circuit Breaker | 11 | damage:Bonus Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/circuit-breaker_ySExszCtKEff7Lhl.json) |
| Domain Expansion: Deus ex Machina | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-deus-ex-machina_Ga4rJYPGjtSVOdr3.json) |

### Cursed Corpse Creation (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Cursed Corpse Creation | 1 | utility:Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/cursed-corpse-creation_79ap6DgHUVAq6trE.json) |
| Corpse Tactics | 3 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/corpse-tactics_us4vpuR3VHkSqbfn.json) |
| Perfect Creations | 18 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/perfect-creations_FW1g0lrHsR4I2Dfn.json) |

### Cursed Speech (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Power of Words | 1 | save:Action (1 CE); utility:Action (2+ CE); save:Action (4 CE); save:Action (6 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/power-of-words_PYKTN7ypRA7nj61N.json) |
| Interjection | 3 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/interjection_OjriXIhJJ8zduMfC.json) |
| Domain Expansion: Echo Chamber | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-echo-chamber_nBfeiSn64MN1fSES.json) |

### Cursed Spirit Manipulation (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Cursed Spirit Absorption | 1 | utility:Reaction (1 CE); save:Bonus Action | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/cursed-spirit-absorption_xSoW2QmMDoKA0mY2.json) |
| Curse Infused Spirits | 3 | utility:Reaction | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/curse-infused-spirits_sJ7cTapmdLmiABwi.json) |
| Perfect Control | 6 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/perfect-control_W0HmlfoJxTJqDsPv.json) |
| Maximum: Uzumaki | 11 | save:Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-uzumaki_GcIm0q24VQZQPjMl.json) |
| Domain Expansion: Womb Profusion | 18 | utility:Expand Domain (20 CE); save:Absorb cursed spirits | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/domain-expansion-womb-profusion_F55gMSM27KKH5qPV.json) |

### Cursed Transmutation (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Basic Transmutation | 1 | utility:Action (1+ CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/basic-transmutation_JE38jRZe07KGrjZx.json) |
| Chemical Formulae | 3 | save:Action (2 CE); heal:Reaction (2+ CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/chemical-formulae_EK3gaDikW90ogzkX.json) |
| Areal Transmute | 6 | save:Action (6 CE); save:Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/areal-transmute_639LoXhgerK4Iwgw.json) |
| Maximum: Railgun | 11 | attack:Action (8 CE); save:Action — save | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-railgun_7e1MLm2DCQtxl0qA.json) |
| Domain Expansion: Mandala of Dependant Origination | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-mandala-of-dependant-or_Y4dv3CGqUaPgeAZk.json) |

### Dark Claw (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Claw | 1 | damage:Bonus Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/claw_uaZXduMgpa7QEYE3.json) |
| Claws Modifications | 3 | damage:Action (1 CE); save:Action (2 CE); utility:Use (limited, no CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/claws-modifications_QHFUIT3ubv4jRSHX.json) |
| Ultimate Claws | 6 | damage:Action (1 CE); save:Action (2 CE); utility:Use (limited, no CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/ultimate-claws_knygdgMi5lm5yekS.json) |
| Maximum: Zenith Claw Option | 11 | utility:Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/maximum-zenith-claw-option_RwJRQgb1vBORMJE1.json) |
| Domain Expansion: Hall of the Five Clawed Dragon | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-hall-of-the-five-clawed_rccn9Z3zTunjKZM3.json) |

### Deadly Sentencing (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Judge’s Gavel | 1 | utility:Action (1 CE); utility:Use (limited, no CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/judge-s-gavel_BP2dCOForc7QrwFI.json) |
| Domain Expansion: Deadly Sentencing | 3 | utility:Use; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-deadly-sentencing_EdkOzraQgWFnQMJT.json) |
| Gavel Improvements | 6 | utility:Action (2 CE); save:Action | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/gavel-improvements_HrqIX9ihcD7nvEPE.json) |
| Unstopping Justice | 18 | utility:Use | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/unstopping-justice_bxSurrzBgl0GtcSQ.json) |

### Disaster Flames (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Flames of Disaster | 1 | save:Bonus Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/flames-of-disaster_H3zzUtaO4Cap4QOd.json) |
| Erupting Volcanoes | 3 | utility:Action (2 CE); save:Bonus Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/erupting-volcanoes_wqgf4qz5z0zgYZ9K.json) |
| Ember Insects | 6 | utility:Action (4 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/ember-insects_VSqFE0jfDFne8RpL.json) |
| Maximum: Meteor | 11 | save:Action (10 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-meteor_uJD8rltKMIu5fwrr.json) |
| Domain Expansion: Coffin of the Iron Mountain | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-coffin-of-the-iron-moun_KRWrFxJblGacGrpx.json) |

### Disaster Storms (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Storms of Disaster | 1 | save:Bonus Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/storms-of-disaster_1oP2gwQofeJq4BzA.json) |
| Lightning | 3 | attack:Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/lightning_rKANGZ47xLsfVBJD.json) |
| Storm Creation | 6 | save:Action (3+ CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/storm-creation_ujyEsUgfQSrgLbJD.json) |
| Maximum: Divine Storm Sovereign | 11 | damage:Action (10 CE); utility:Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-divine-storm-sovereign_3mJStu8usYRZi2wT.json) |
| Domain Expansion: Heavenly Throne of the Raging Tempest | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-heavenly-throne-of-the-_QYNj4Bn6j6DQy5LH.json) |

### Disaster Tides (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Tides of Disaster | 1 | attack:Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/tides-of-disaster_OswVkVAkUYOOzURL.json) |
| Domain Expansion: Horizon of Captivating Skhanda | 3 | utility:Use (limited, no CE); utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-horizon-of-captivating-_NUoFYdG435JZWnLM.json) |
| Water Defensive Ring | 6 | heal:Action (6 CE); utility:Reaction (8 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/water-defensive-ring_8R4ubskMKSNo9cjj.json) |
| Flash Flood | 11 | attack:Action (6 CE); save:Action (8 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/flash-flood_5EjQTkPsRJ3rKiT9.json) |
| Maximum: Tsunami | 18 | utility:Action (8 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/maximum-tsunami_ht3B9B5NSQBfgmUH.json) |

### Disaster Verdure (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Forests of Disaster | 1 | save:Action (1 CE); utility:Reaction (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/forests-of-disaster_rXXHBBI0bIPLLHsu.json) |
| Root Bundle | 3 | attack:Bonus Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/root-bundle_u7p2yaIifyDSZYtW.json) |
| Flower Field | 6 | save:Action (5 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/flower-field_MLLR1v3HhPAmTEO8.json) |
| Cursed Buds | 11 | attack:Action (6 CE); utility:Action (10 CE) | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/cursed-buds_rAbsflTzfT1qFbq4.json) |
| Domain Expansion: Ceremonial Sea of Light | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-ceremonial-sea-of-light_7clE8rWvh6MVK4iK.json) |

### Disaster Vermin (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Vermin of Disaster | 1 | utility:Action (2 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/vermin-of-disaster_KCq00fhfScjcilZM.json) |
| Earthen Insect Trance | 3 | utility:Action (2 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/earthen-insect-trance_iPsDZpKgj5u032te.json) |
| Parthenogenesis | 11 | utility:Action (8 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/parthenogenesis_2TX7VyPgCnFRXgkD.json) |
| Domain Expansion: Brood Cathedral of the Crawling God | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-brood-cathedral-of-the-_C4DMbvYDumMLyH33.json) |

### Divergent Fist (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Divergent Flow | 1 | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/divergent-flow_WwsOi9d6vXukT6rB.json) |
| Martial Prowess | 3 | utility:Bonus Action; save:Manji Kick | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/martial-prowess_CrWM1xCTd63nJBUq.json) |
| Stance of the Sparks | 11 | attack:Action | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/stance-of-the-sparks_dmeqRRSG8j49BR5r.json) |

### Dragon Vein (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Ley Line Command | 3 | utility:Bonus Action (3 CE); utility:Reaction (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/ley-line-command_qTsOx6OCHUpYLbgX.json) |
| Earth Dragon Soul | 6 | utility:Reaction (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/earth-dragon-soul_XDoCAxQgRPhFISef.json) |
| World Anchor | 11 | utility:Action (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/world-anchor_h8SxUENKo3mSge4y.json) |
| Domain Expansion: Of Primordial World | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-of-primordial-world_BOWeUicZygm9sbIU.json) |

### Earth Manipulation (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Excavation | 1 | save:Action (1 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/excavation_AQpmy5BZluKFUBx2.json) |
| Sculpted Earth | 3 | damage:Action (1 CE); save:Action (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/sculpted-earth_CZ2e6aKrHci9L2Qq.json) |
| Wall of Stone | 6 | utility:Action (4 CE); save:Bonus Action (1 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/wall-of-stone_G5JohGkx3AABfoyH.json) |
| Stone Arms | 11 | save:Action (5 CE); utility:Action (1 CE); save:Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/stone-arms_pTdglNHJKLO2Srb0.json) |
| Domain Expansion: Trichiliocosm | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-trichiliocosm_UrKH3JnnRbRhWS8Q.json) |

### Eight Heads (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Eight Lives | 1 | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/eight-lives_iexwqjWgin5qIIIF.json) |
| Collective Will | 3 | utility:Triggered reroll (1 CE; 1/8 uses) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/collective-will_Gnvd68sXDmEW2FWO.json) |
| Fangs of Orochi | 6 | utility:Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/fangs-of-orochi_3IWNlxcrnJFvNxap.json) |
| Maximum: Sacrifice | 11 | damage:Action (6 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-sacrifice_QG7cUSxrMY5gk5jI.json) |
| Domain Expansion: Ama ga Fuchi | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-ama-ga-fuchi_XZKCNxG6TgtmJLys.json) |

### Esoteric Art (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Cursed Painting | 1 | save:Action (1+ CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/cursed-painting_uTkKYysExKqyTfA0.json) |
| Impasto Canvas | 3 | save:Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/impasto-canvas_geIiULNWftqTgOLM.json) |
| Sgraffito | 6 | save:Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/sgraffito_kxqSZAEhS2KvXJZa.json) |
| Panoramic Composition | 11 | save:Action | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/panoramic-composition_1j8EyDLkddYqXHmE.json) |
| Domain Expansion: Magnum Opus | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-magnum-opus_kUgWQuaoTcYppNWF.json) |

### Explosive Flesh (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Self-Destruction | 1 | utility:Special | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/self-destruction_xHgNg53HKZU5LCTU.json) |
| Faster Throws | 3 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/faster-throws_TeIZqCZDUnfAtHgr.json) |
| Guerilla Tactics | 6 | save:Reaction | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/guerilla-tactics_RQb419zvaYlemuUU.json) |
| Stronger Explosions | 11 | save:Special | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/stronger-explosions_6HchntUbMrRiBTpO.json) |
| Domain Expansion: True Art | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-true-art_Rzlgaj4eRo9sh64x.json) |

### Fa Jin (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Instantaneous Movement | 3 | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/instantaneous-movement_Wk2tHOObH8Up9ocX.json) |
| Fist of Explosive Power | 6 | damage:Action (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/fist-of-explosive-power_Qg7EnOsToGuy1kOy.json) |
| Maximize Potential Energy | 11 | utility:Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/maximize-potential-energy_9mtD8EPd3LMxJE3R.json) |
| Domain Expansion: Hall of Divine Bagua | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-hall-of-divine-bagua_WwelZoITRpIds1NY.json) |

### Faceless God (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Madness Inducement | 1 | save:Action (3 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/madness-inducement_KdemmuLMMISHWRIP.json) |
| Maximum: Rumination | 11 | save:Action (6 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-rumination_Rf5Hd5OWeGdCdMU0.json) |
| Domain Expansion: Theia Mania | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-theia-mania_zSGeI3ieeQad8lzW.json) |

### Fate (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Fate Manipulation | 1 | utility:Action (2 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/fate-manipulation_745MVTDDNhtfctQQ.json) |
| Cursed Eyes of Fate | 3 | utility:Bonus Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/cursed-eyes-of-fate_dpjaBTyscou71Drz.json) |
| Strong Destiny | 6 | save:Reaction (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/strong-destiny_0cwUM0MVo8t1hBck.json) |
| Karmic Entanglement | 11 | utility:Action (8 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/karmic-entanglement_iHFQdjB7DhXF1CEU.json) |
| Domain Expansion: Road of Karma | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-road-of-karma_1bA6LFa3Mo1Ekpqx.json) |

### G Warstaff (2 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Warstaff | 1 | damage:Bonus Action (2 CE); utility:Bonus Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/warstaff_lPvmTuuxb9GiKkQ4.json) |
| Domain Expansion: Storyboard Dominion | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-storyboard-dominion_HxfdcfxdpJridm05.json) |

### Golden Hour (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Golden Hour | 1 | utility:Bonus Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/golden-hour_4q9OGsvSzNAxybcY.json) |
| Majestic Pose | 3 | utility:Bonus Action | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/majestic-pose_by9eHzYOCKk4O6zh.json) |
| Golden Week | 6 | utility:Action (4 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/golden-week_BiQmr9X82yv0uLD4.json) |
| Samsara Rewind | 11 | utility:Bonus Action (8 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/samsara-rewind_GHA3E4TudpXbvdC4.json) |
| Domain Expansion: The World | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-the-world_3bit65lbBkYI7DGN.json) |

### Hair Manipulation (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Scorpion Hair | 1 | attack:Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/scorpion-hair_Y5f6ekgOoItXjNcS.json) |
| Drill Hair | 3 | save:Action (1 CE); utility:Extra (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/drill-hair_SB8gb2EXYIofLXBl.json) |
| Aircraft Hair | 6 | utility:Action (3 CE); attack:Action (2 CE); save:Action — save | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/aircraft-hair_Fg2uQWtBv1hbcKXy.json) |
| Hair Spray | 11 | utility:Bonus Action (4 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/hair-spray_XELY6ZF06NXQTLhs.json) |
| Domain Expansion: Silken Strand Execution Ground | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-silken-strand-execution_2ACdzLEnWCXja6i9.json) |

### Heart Catch (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Hands of Love | 1 | utility:Bonus Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/hands-of-love_hhllCgATbWx58n7P.json) |
| Handy | 3 | utility:Special | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/handy_3jjmhmnaeXtHfWJw.json) |
| Cutie Honey | 11 | save:Action (5 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/cutie-honey_DKJPQD3LXXPc2tHm.json) |
| Domain Expansion: Lover’s Grasp | 18 | utility:Special; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-lover-s-grasp_ZAqh5epfSwH68e8V.json) |

### Ice Formation (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Ice Creation | 1 | save:Action (1 CE); damage:Special | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/ice-creation_6d05GBnkO9d2vAY9.json) |
| Frost Calm | 6 | save:Action (4 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/frost-calm_Jcsw1LCj12wtxbiG.json) |
| Ice Fall | 11 | save:Action (8 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/ice-fall_wkzTg4f1GGLksKAv.json) |
| Domain Expansion: White Abyss | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-white-abyss_dKwXApTwzsxj95yd.json) |

### Idle Transfiguration (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Transfiguration | 1 | save:Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/transfiguration_D6lKzdMZxIzyGlg6.json) |
| Alteration | 3 | utility:Action (2 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/alteration_VAvGtxSod2JL2DbT.json) |
| Body Clone | 6 | utility:Action (6 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/body-clone_LyLbkXAvBNfW1loQ.json) |
| Soul Multiplicity | 11 | attack:Action (5 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/soul-multiplicity_ksjHxv60hPYhyyuJ.json) |
| Domain Expansion: Self Embodiment of Perfection | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-self-embodiment-of-perf_B6X39yIsShm1Q2km.json) |

### Illusive Mirage (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Cursed Illusion | 1 | save:Action (2 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/cursed-illusion_wFUB8DfdT2QqwFQg.json) |
| Self Distortion | 3 | attack:Action (3 CE) | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/self-distortion_7vtgeOWGHfDsoDM5.json) |
| Object Distortion | 6 | damage:Action; utility:Extra (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/object-distortion_nj6asjw6WgTG2Vst.json) |
| Illusive Terrain | 11 | utility:Action (10 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/illusive-terrain_HlWRvtMxlN8OCQD9.json) |
| Domain Expansion: House of Mirrors | 18 | utility:Reaction; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-house-of-mirrors_TDn8CRNZOzsQlu56.json) |

### Inverse (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Inversion | 1 | utility:Bonus Action (2 CE); utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/inversion_M48Lb0FJgSB7lVfk.json) |
| Quick Inversion | 11 | utility:Reaction | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/quick-inversion_nBS99egazwd4cDfZ.json) |
| Domain Expansion: Synesthesia | 18 | utility:Special; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-synesthesia_DrswMpqH5qloWUqP.json) |

### Laplace’s Demon (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Demonic Intellect | 1 | utility:Bonus Action (1 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/demonic-intellect_ys1D7UKVzPiTeAEA.json) |
| Future and Past | 3 | utility:Reaction (1 CE); utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/future-and-past_2oseicP8E0w28WjF.json) |
| Overload | 6 | save:Action (4 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/overload_8nsX5YC7QP3jFS6b.json) |
| Imaginary Demon Brain | 11 | utility:Action (8 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/imaginary-demon-brain_hETxArHfIr95Mghx.json) |
| Domain Expansion: Laplace Threshold | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-laplace-threshold_GgpqwrzwFIiCXpfm.json) |

### Limitless (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Infinity | 1 | utility:Bonus Action (1 CE); utility:Action (1 CE); utility:Reaction (2 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/infinity_Z8th34Qso5xXJcFA.json) |
| Lapse Blue | 3 | save:Action (1+ CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/lapse-blue_kKlEBs83oZmc1GgC.json) |
| Teleportation | 6 | utility:Action (5 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/teleportation_Udk2fPMDLwKx7fER.json) |
| Offensive Infinity | 11 | save:Action (1+ CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/offensive-infinity_EMDjz5QEQDEucr5I.json) |
| Domain Expansion: Unlimited Void | 18 | save:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-unlimited-void_pKNgqGZiGhI1CjxQ.json) |

### Love Rendezvous (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Love Rendezvous | 1 | utility:Special (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/love-rendezvous_HlC6hqoZAtbyQ2hV.json) |
| Effective Marking | 3 | utility:Reaction | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/effective-marking_WabghuPJeXcFn395.json) |
| Domain Expansion: Star Crossed Lovers | 18 | utility:Action; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-star-crossed-lovers_Z9I5KdkmVysGWEBn.json) |

### Miracle (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Blind Luck | 1 | utility:Reaction | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/blind-luck_PzwUt0MCons6qKtx.json) |
| Miraculous Outcome | 3 | utility:Reaction | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/miraculous-outcome_IGdHEkIEb2j1ZSh2.json) |
| Domain Expansion: Luck of the Draw | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-luck-of-the-draw_VRBpLzLuP2FWrulp.json) |

### Missile Fist (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Missile Impact | 1 | attack:Bonus Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/missile-impact_I0xFb7zyyLxQKE7A.json) |
| Devastating Barrage | 3 | save:Special (1+ CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/devastating-barrage_EJrxqMj9OKy7ZhlK.json) |
| Unrelenting Fury | 6 | save:Unrelenting Fury (3 CE; set extra attacks in scaling); damage:Additional Fury damage (1+ CE, same action) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/unrelenting-fury_mBjxZbJJs4CS4osY.json) |
| Maximum: Brutal Bombardment | 11 | save:Bonus Action (6 CE); save:Action (1+ CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/maximum-brutal-bombardment_ExKo8huWEv4TTFFX.json) |
| Domain Expansion: Unrelenting Ring of Spirit | 18 | utility:Action; utility:Expand Domain (20 CE); damage:Initiative 20: Missile Fists | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-unrelenting-ring-of-spi_tEi4q2oYSdR5bUCp.json) |

### Moon Dregs (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Lunar Jellyfish | 1 | utility:Action (5 CE); utility:Use (limited, no CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/lunar-jellyfish_u6sqYNJyHeifcShB.json) |
| Poisonous Cursed Energy | 3 | damage:Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/poisonous-cursed-energy_8iRl9rttNMiSJeyK.json) |
| Noxious Poison | 6 | save:Special | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/noxious-poison_3Dl1NrZNEan9OFpc.json) |
| Domain Expansion: Liberation Rite of Water and Land | 18 | utility:Action; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-liberation-rite-of-wate_TiEYlOhaBmnH1gBW.json) |

### Mythical Beast Amber (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Electric Energy | 1 | damage:Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/electric-energy_Cd0MIDnKJNY1E74w.json) |
| Lightning Discharge | 6 | utility:Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/lightning-discharge_6uqGLAdNxT5G3Tfw.json) |
| Mythical Beast Amber Release | 11 | utility:Action (8 CE); save:Action (6 CE); save:Bonus Action; save:Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/mythical-beast-amber-release_rxvUmHNbggsQeh3C.json) |
| Domain Expansion: Lightning God’s Realm | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-lightning-god-s-realm_Pz1PAtJv8qsrJIGZ.json) |

### New Shadow Style (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| New Shadow Style: Simple Domain | 1 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/new-shadow-style-simple-domain_IpEcKAh0dIJX4o2O.json) |
| Batto Sword Draw | 3 | attack:Action (3 CE) | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/batto-sword-draw_YpGzHiufmF1oU7iu.json) |
| Moonlight Veil | 11 | utility:Bonus Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/moonlight-veil_YRRHIojsCbPDOfoF.json) |
| Perfect Shadow Style | 18 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/perfect-shadow-style_QTcy6dQu1j5Lv2Mu.json) |

### Pachinko Fever (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Great Luck | 1 | utility:Use | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/great-luck_ekaS8GYbKDcFu0i8.json) |
| Domain Expansion: Idle Death Gamble | 3 | attack:Bonus Action (1 CE); attack:Bonus Action (3 CE); save:Bonus Action (4 CE); utility:Use (limited, no CE); utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-idle-death-gamble_JgbhHu3Xdg6y4dKN.json) |
| Luckiest Sorcerer Alive | 18 | utility:Special | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/luckiest-sorcerer-alive_BL0AkVup5SylGoSO.json) |

### Pain Killer (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Pain Killer | 1 | heal:Bonus Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/pain-killer_kiwHEzmGJGB8ucAg.json) |
| Practiced Hands | 3 | utility:Special (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/practiced-hands_bWfoIzaKvg4hfuBH.json) |
| Analgesic | 11 | utility:Reaction (4 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/analgesic_j9yv3LQ6VU4LZZeC.json) |
| Domain Expansion: Medical Clinic | 18 | utility:Reaction; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-medical-clinic_9IgJ0CNa9s1UAeaN.json) |

### Paralyzing Gaze (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Immobilizing Eyes | 1 | save:Action (2 CE); utility:Bonus Action (1 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/immobilizing-eyes_hVxwa4zAWjFsDhiB.json) |
| Peripheral Vision | 3 | utility:Bonus Action (1 CE); utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/peripheral-vision_tUu7Y7Fpc26s97zh.json) |
| Reactive Eye Movement | 6 | save:Action (2 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/reactive-eye-movement_aRhLqFgvq7Kx3qQ2.json) |
| Maximum: Paralyzing Gaze | 11 | save:Action (6 CE); utility:Bonus Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-paralyzing-gaze_L9RcJelTKo86oVLG.json) |
| Domain Expansion: Chamber of Fractured Reflections | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-chamber-of-fractured-re_wvTri5uUZ3FfDuPH.json) |

### Prayer Song (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Prayer | 1 | utility:Bonus Action (1 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/prayer_O8EAishBxZWvLMqb.json) |
| Marcado | 3 | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/marcado_CmjdZjazhBQ3onBG.json) |
| Caesura | 6 | utility:Reaction | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/caesura_tigG746ROVPhGTyr.json) |
| Domain Expansion: Dance Dance Revolution | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-dance-dance-revolution_mnWo4JotkNCbzihS.json) |

### Projection Sorcery (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Projection | 1 | utility:Bonus Action (1 CE); utility:Action (1 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/projection_C5RGYdyoQiko1drM.json) |
| 24 Frame Rule | 6 | save:Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/24-frame-rule_xSSfkLjiDQ8aBAEs.json) |
| Domain Expansion: Lunar Palace Womb of Time | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-lunar-palace-womb-of-ti_aKwBW0FtSBN296Y8.json) |

### Puppet Manipulation (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Ultimate Mechamaru | 1 | utility:Action (1 CE); attack:Action (6 CE); attack:Action (4 CE); damage:Reaction | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/ultimate-mechamaru_lykgQMTyi1PLER7x.json) |
| Lesser Puppet | 3 | utility:Action (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/lesser-puppet_brI7kRSO5w3zcgwM.json) |
| Advanced Puppet | 6 | utility:Action (6 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/advanced-puppet_2hdXZ4El5oK4nKXT.json) |
| Absolute Puppet | 11 | utility:Action (10 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/absolute-puppet_7dMiTpDehniSeq7U.json) |
| Domain Expansion: Puppet Show | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-puppet-show_1SZNbSAkT5kDKvtC.json) |

### Ratio (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Ratio | 3 | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/ratio_2n2TueL9H08LTHZ5.json) |
| Collapse | 6 | save:Action (4 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/collapse_reU5zR7aPdvrc8di.json) |
| Domain Expansion: Golden Ratio | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-golden-ratio_YckjoN5r8h1jyJW8.json) |

### Regalia (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Regalia | 1 | utility:Action (2 CE); damage:Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/regalia_akoptGrJDbodhSRV.json) |
| Cursed Wave | 3 | save:Action (1 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/cursed-wave_PGx9JDu1JoHTHWuk.json) |
| Divine Protection | 6 | utility:Reaction (1 CE); utility:Use (limited, no CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/divine-protection_kErS8w7ITb2KTHxT.json) |
| Soul Bound Treasure | 11 | utility:Action (10 CE); save:Action | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/soul-bound-treasure_jGiSURG0H6aGEgTN.json) |
| Domain Expansion: Cursed Soul Armory | 18 | utility:Action; utility:Expand Domain (20 CE); damage:Initiative 20: Lesser Regalia | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-cursed-soul-armory_0EfuxPmRKXaYG7ms.json) |

### Retrograde (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Reversion | 1 | attack:Reaction (1 CE); utility:Extra (2 CE) | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/reversion_W67pztE5YzdQ8tVp.json) |
| Regression | 3 | save:Bonus Action (3 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/regression_54dzavXGzF80Hu5T.json) |
| Enhanced Reversion | 6 | utility:Reaction; utility:Extra (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/enhanced-reversion_HFuaDzzNauD0VMjN.json) |
| Invert Causality | 11 | attack:Reaction (8 CE) | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/invert-causality_mnTFpMXKYAUFX5Aw.json) |
| Domain Expansion: Requiem of Retrograde | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-requiem-of-retrograde_hgum5VAcDalK1FTK.json) |

### Rockstar (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Sound Amplification | 1 | attack:Action (1 CE); save:Action — save | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/sound-amplification_wmS4XVAE6EL1dJ17.json) |
| Jacked Audio | 3 | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/jacked-audio_EJxDOAJZ1UjcbLR9.json) |
| Resonating Music | 6 | save:Action (5 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/resonating-music_YMUit2oYBKZFVC0u.json) |
| Maximum: Epic Solo | 11 | damage:Action (8+ CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-epic-solo_2KYLeuvZfdjkOvzV.json) |
| Domain Expansion: Hall of Fame | 18 | utility:Special; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-hall-of-fame_QmfPpOxDrEUDCBSU.json) |

### Rot (6 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Rotten Blood | 1 | damage:Special | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/rotten-blood_P3P35yj02Ltq67v3.json) |
| Rot Techniques | 1 | save:Action (1 CE); attack:Action (3 CE); utility:Action (4 CE); damage:Bonus Action (3 CE); save:Action — save | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/rot-techniques_8ob4DIhgqqluRPbD.json) |
| Decay | 3 | utility:Bonus Action (3 CE); utility:Special (3 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/decay_sg0SgAZBqxgPvW74.json) |
| Scarlet Rot | 6 | save:Special | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/scarlet-rot_SisjRsbJMU1CYl6j.json) |
| Maximum: Wing King | 11 | utility:Bonus Action (8 CE); attack:Line of Blood (attack) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-wing-king_xWdQR7gjV6e3o70B.json) |
| Domain Expansion: Mind Palace of Corrupted Ego | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-mind-palace-of-corrupte_pei0xqJxONsFvIou.json) |

### Schrift X (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Piercing Schrift | 1 | attack:Action (1 CE) | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/piercing-schrift_diVgFAJkfw6xhcmJ.json) |
| X-Axis Shot | 3 | damage:Action (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/x-axis-shot_SiPL1Dzm9Ck74Wah.json) |
| Cursed Mark | 6 | utility:Bonus Action (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/cursed-mark_LIyLn3xqjfp3xIBD.json) |
| Intangibility | 11 | utility:Bonus Action (6 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/intangibility_djiYzCUqNqKK4eqo.json) |
| Domain Expansion: Divine Sight | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-divine-sight_RWZxCvu1t7IKQbV3.json) |

### Seance (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Seance | 1 | utility:Action (2 CE); save:Action (1 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/seance_JAeKHJYaOvVKwaEI.json) |
| Blessing of the Grateful Dead | 3 | heal:Special | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/blessing-of-the-grateful-dead_lF18uQBxg4fzpAp2.json) |
| Maximum: Black Seance | 11 | utility:Extra (5 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/maximum-black-seance_04GKHfCeCbyONYQP.json) |
| Domain Expansion: Seance Parlor | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-seance-parlor_emxMfPh3YWvdbE3U.json) |

### Shadow Killer (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Shadow Strike | 1 | save:Action (1 CE) — rider | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/shadow-strike_STzACDlhuJvyy7Il.json) |
| Dark Binding | 3 | utility:Action (3 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/dark-binding_k99PoGAn3z4E5y6l.json) |
| Void Steps | 6 | utility:Action (2 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/void-steps_56DoYOAjvHn5LVtK.json) |
| Shadows of Mortality | 11 | utility:Special (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/shadows-of-mortality_waS7WxGlqH3cHO7I.json) |
| Domain Expansion: Zero Hour | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-zero-hour_dK1MasxExSPNNJSp.json) |

### Shrine (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Dismantle | 1 | attack:Action (1+ CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/dismantle_7EnbbkEp3o7f0VLb.json) |
| Cleave | 3 | attack:Action (1+ CE); save:Action — save | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/cleave_KzRHCk2wttIY8wKv.json) |
| Divine Flame Open | 6 | save:Divine Flame (1+ CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/divine-flame-open_mxwFcvMxYv3CzmBv.json) |
| Slicing and Severing | 11 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/slicing-and-severing_LwQFSsaYhkLR6WV0.json) |
| Domain Expansion: Malevolent Shrine | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-malevolent-shrine_O5AXSTSlqi53tosZ.json) |

### Sky Manipulation (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Sky Shape | 1 | attack:Reaction (1 CE) | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/sky-shape_J9LNnuJcYPznq0zd.json) |
| Sky Armor | 3 | utility:Bonus Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/sky-armor_44NLHabuBSw6VRZ5.json) |
| Sky Shape Improvement | 6 | utility:Reaction (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/sky-shape-improvement_1KKP2bcsJmg1yA0g.json) |
| Thin Ice Breaker | 11 | save:Action (5 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/thin-ice-breaker_fr7czB9pC6rA0hCl.json) |
| Domain Expansion: Heaven’s Gate | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-heaven-s-gate_YJwMFSe1lpxbi8FF.json) |

### Solo Forbidden Zone (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Forbidden Zone | 1 | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/forbidden-zone_9UTHSBip7mmqaupO.json) |
| Bless | 3 | utility:Action (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/bless_afIIyhhgkqx1ldcN.json) |
| Ritual Dance | 6 | save:Bonus Action | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/ritual-dance_uhroQuF4Rbd2kMyx.json) |
| Maximize Output | 11 | utility:Action (5 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/maximize-output_CaRX3lIbroOmofpK.json) |
| Domain Expansion: Hallowed Zone | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-hallowed-zone_9Z4vMDDLb62nB51l.json) |

### Star Dictator (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Minor Star Shikigami | 1 | utility:Action (1+ CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/minor-star-shikigami_VF9rOo0wZKbbBy7s.json) |
| Pseudo-Domain Constitution | 3 | save:Bonus Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/pseudo-domain-constitution_LjQg82tR5YL4UbNQ.json) |
| Major Star Shikigami | 6 | utility:Action (6 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/major-star-shikigami_68zRFEvni8MoZ7To.json) |
| Army of the Dictator | 11 | damage:Special | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/army-of-the-dictator_LSe1S6W9A2O7cWJF.json) |
| Domain Expansion: Divine Mandate | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-divine-mandate_FgyzDjSsxafAoVYo.json) |

### Star Rage (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Virtual Mass Increase | 1 | save:Bonus Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/virtual-mass-increase_IqCosBDfGxvNyaCw.json) |
| Virtual Mass Mastery | 11 | utility:Special | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/virtual-mass-mastery_yYkcM2fCzHLvLzzr.json) |
| Domain Expansion: Event Horizon | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-event-horizon_XjwAhuZxPS1qCUPA.json) |

### Starlight Symphony (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Cursed Fog | 1 | utility:Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/cursed-fog_rrxmgN9E1kMY4Y6C.json) |
| Kitsune Creation | 3 | utility:Action (2 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/kitsune-creation_p2UOibKpvVVJg9bI.json) |
| Living Fog | 6 | save:Action (3 CE); utility:Extra (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/living-fog_JTj0PkI6UX19MGBs.json) |
| Inari | 11 | utility:Action (8 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/inari_orRoUK5XNH9MciAs.json) |
| Domain Expansion: Heaven and Earth | 18 | damage:Special; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-heaven-and-earth_gKmWnQNo0RtBc5t6.json) |

### Straw Doll Technique (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Nail Projectile | 1 | attack:Action (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/nail-projectile_PyipLA81fAY46mo6.json) |
| Resonance | 3 | save:Action | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/resonance_6l2g51jwQdY63PVK.json) |
| Hair Pin | 6 | utility:Bonus Action (1 CE); save:Bonus Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/hair-pin_fDcXasO9qtbZEnXH.json) |
| Improved Resonance | 11 | save:Action (6 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/improved-resonance_xVlUYlQhKObMVAM2.json) |
| Domain Expansion: Wara Ningyo | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-wara-ningyo_5cJeAI1z9NwuCHIx.json) |

### Technique Extermination (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Extinguishment | 1 | save:Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/extinguishment_ksvKQksG46ElTLQX.json) |
| Angel’s Blessing | 3 | utility:Bonus Action (1 CE) | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/angel-s-blessing_7l4nQGOha2dpDXkG.json) |
| Improved Extinguishment | 6 | damage:Special | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/improved-extinguishment_7ntdHb934PcYXYk5.json) |
| Maximum: Jacob’s Ladder | 11 | save:Action (10 CE); attack:Action (6 CE) | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/maximum-jacob-s-ladder_xwJtNVF6QPcHKkK2.json) |
| Domain Expansion: Garden of Eden | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-garden-of-eden_QzNVXitimr4FN9q6.json) |

### Teleportation (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Teleport | 1 | utility:Bonus Action (1 CE); utility:Action (2 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/teleport_XgpkqX2WVbuoEe3W.json) |
| Improved Teleport | 3 | utility:Reaction | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/improved-teleport_BqyAkex2Rh3zkicX.json) |
| Mastered Teleport | 6 | utility:Action (8 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/mastered-teleport_HNOXHeofJKDjUaXx.json) |
| Improved Marking | 11 | utility:Action (5 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/improved-marking_6TuIxZgnzBdihaIn.json) |
| Domain Expansion: Crossroads of Instance | 18 | utility:Reaction; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-crossroads-of-instance_AiOuuvz1Ke0PUE6e.json) |

### Ten Shadows (6 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Divine Dogs | 1 | summon:Summon 1 Divine Dog (1 CE); summon:Summon 2 Divine Dogs (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/divine-dogs_x65tUSq8GjFrdeNz.json) |
| Trial | 3 | utility:Action; summon:Summon Gama (1 CE); summon:Summon Nue (2 CE); summon:Summon Great Serpent (4 CE); summon:Summon Rabbit Escape (6 CE); summon:Summon Mourning Tiger (7 CE); summon:Summon Max Elephant (8 CE); summon:Summon Round Deer (9 CE); summon:Summon Piercing Ox (10 CE); summon:Summon Mahoraga (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/trial_qRCrItVBtBcRJpaC.json) |
| Totality | 3 | summon:Summon Divine Dog Totality (2 CE); summon:Summon Chimera Agito (16 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/totality_z1mJ0orAc2rvKGlW.json) |
| Shadow Manipulation | 6 | utility:Action (1 CE); save:Bonus Action (2 CE) | Salvación sin daño/efecto automático | [JSON](../src/packs/jjk5e-techniques/shadow-manipulation_Msi6iz1TGSA7DnZl.json) |
| Well’s Unknown Abyss | 11 | utility:Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/well-s-unknown-abyss_9LQ4u1eh0eGQileG.json) |
| Domain Expansion: Chimera Shadow Garden | 18 | utility:Bonus Action; utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-chimera-shadow-garden_ico8O7Iw5bcSqC7e.json) |

### Tool Manipulation (6 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Guided Control | 1 | utility:Bonus Action | Utilidad con efecto: comprobar activación | [JSON](../src/packs/jjk5e-techniques/guided-control_st3cozIWTsDaaE5B.json) |
| Floating Tool | 3 | utility:Bonus Action (2 CE); attack:Action; utility:Extra (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/floating-tool_mSD3lm8nPAmP6Uez.json) |
| Wind Scythe | 6 | save:Action (3 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/wind-scythe_gig1BD38hPdQI65H.json) |
| Combat Tool Improvement | 6 | utility:Reaction | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/combat-tool-improvement_tqugDcnrPlxkDgBx.json) |
| Tool Mastery | 11 | utility:Bonus Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/tool-mastery_c2w7ELQ8oGbTnvyF.json) |
| Domain Expansion: Tsukumogami Spirit World | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-tsukumogami-spirit-worl_zZKvJON3anKgwIvl.json) |

### Triple Core (3 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| First Core | 1 | utility:Action (1+ CE); attack:Action | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/first-core_bWsg0w91O42mU8As.json) |
| Upgraded Form | 6 | utility:Bonus Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/upgraded-form_4D6hQtvYSoTdHU4R.json) |
| Domain Expansion: Rule of Three | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-rule-of-three_kVXEl04i6zoZvUq6.json) |

### Vairocana (7 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Harmony | 1 | utility:Action (3 CE); utility:Action (2 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/harmony_yFuudP4sVGA43MxC.json) |
| Chaos | 3 | utility:Action (2 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/chaos_5GIEPo1b6c1zyGl0.json) |
| Chaos Amplification | 6 | utility:Action (1+ CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/chaos-amplification_UATRcguzxf0S7YgE.json) |
| Balance | 11 | utility:Use | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/balance_paRshIeAw9opHQxu.json) |
| Domain Expansion: Mandala of Mutual Paradox | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-mandala-of-mutual-parad_yQ18DyR8axN13pwh.json) |
| Cosmic Genesis (Reversal) | — | utility:Action (4 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/cosmic-genesis-reversal_bUI5DQpp7zvbRciW.json) |
| Entropy (Reversal) | — | utility:Action (1 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/entropy-reversal_ZvSOk5JO7MypjFsd.json) |

### Vengeful Spirit Manipulation (4 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Partial Manifestation | 1 | attack:Additional claw attack (1 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/partial-manifestation_uBsOHGjgsss8QfcX.json) |
| Vengeful Spirit Manifestation | 3 | utility:Special | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/vengeful-spirit-manifestation_QpphinJEtE0mIWIf.json) |
| Mimicry | 6 | utility:Action (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/mimicry_PxLYScnzwfsspeiN.json) |
| Domain Expansion: True Mutual Love | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-true-mutual-love_wXbGY4lU6MeFrIOc.json) |

### Voracity (5 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Hunger of the Accursed | 1 | utility:Reaction (3 CE); utility:Extra (3 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/hunger-of-the-accursed_i2elcnfEM3PqD4Xu.json) |
| Regurgitation | 3 | utility:Bonus Action (4 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/regurgitation_r1eIkRbHNYcdzsvl.json) |
| Digestion | 6 | utility:Action (1 CE); utility:Bonus Action (2 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/digestion_gigQp0SO5fgfeziK.json) |
| Maximum: Body of the Devourer | 11 | utility:Action | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/maximum-body-of-the-devourer_eTQgHnQfLmlqyKNA.json) |
| Domain Expansion: Tomb of the Devoured | 18 | utility:Expand Domain (20 CE) | Dominio genérico: resolver propiedades particulares | [JSON](../src/packs/jjk5e-techniques/domain-expansion-tomb-of-the-devoured_MVFoU6nfhwq857cp.json) |

### ████ and Light (8 spells)

| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |
|---|---:|---|---|---|
| Light Constructs | 1 | damage:Bonus Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/light-constructs_XX6Rnw19OtQjYBnb.json) |
| Light Techniques | 3 | save:Action (3 CE); save:Action (2 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/light-techniques_HTujAuWtwUzZQr2G.json) |
| Hyperspeed | 6 | attack:Action (1+ CE) | Ataque sin daño propio: comprobar intención | [JSON](../src/packs/jjk5e-techniques/hyperspeed_wgDtozCWclpmllfO.json) |
| Maximum: Light Speed | 11 | save:Action (8 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/maximum-light-speed_CaaEcBGImDyI8hBg.json) |
| Domain Expansion: Reverse Transcendence | 18 | damage:Action; utility:Expand Domain (20 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/domain-expansion-reverse-transcendence_YkSDOUb7CYJvTBFE.json) |
| ████ and Dark | — | utility:Action (2 CE) | Utilidad sin efecto configurado: revisar lógica | [JSON](../src/packs/jjk5e-techniques/and-dark_RyTWIhz0ek8SiIp7.json) |
| Dark Constructs (Reversal) | — | damage:Bonus Action (4 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/dark-constructs-reversal_HXiFoYwsPXElvgDk.json) |
| Dark Vortex (Reversal) | — | save:Action (12 CE) | Mecánica configurada; falta prueba Foundry | [JSON](../src/packs/jjk5e-techniques/dark-vortex-reversal_FbtpCHsWVTKGQ9Rk.json) |

