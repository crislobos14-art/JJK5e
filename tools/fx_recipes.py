"""Per-technique sound recipes, colours, effect shapes and domain backdrops for JJK5e.

Single source of truth: build-fx.py renders the audio/video/textures from this file and writes
scripts/jjk-fx-table.mjs so the module and the assets never drift apart.

Each sound is an original synthesis loosely guided by how the techniques are described
(e.g. Black Flash: a deep resonant thoom/crack with electric distortion; Hollow Purple:
a vacuum implosion; Boogie Woogie: a sharp hand clap). Nothing is sampled from the anime.
"""
import numpy as np
from fx_synth import (SR, bell, bitcrush, bp, buzz, caw, clap, coins, crack, crackle, drip, drive, echo, env_adsr,
                      env_bell, env_exp, fm, formant_voice, glide, heartbeat, hp, lp, noise, osc, pad, place, reverb,
                      reverse, rumble, shing, stutter, sweep_bp, sweep_lp, t_axis, thump, tick, tremolo, whoosh, zap)


def mix(*layers):
    """layers: (array, start_seconds, gain)."""
    out = np.zeros(1)
    for arr, at, g in layers:
        out = place(out, arr, at, g)
    return out


# ------------------------------------------------------------------ shared motifs
def ce_swell(dur=0.5, f0=180, f1=420, seed=0):
    """The common 'cursed energy gathers' rise every cast starts with (quiet)."""
    return sweep_bp(noise(dur, "pink", seed), f0, f1 * 3, 3) * env_bell(dur, 0.85, 1.4) + \
        osc(glide(f0, f1, dur), dur, "tri") * env_bell(dur, 0.9, 2) * 0.25


def impact(weight=1.0, seed=0, bright=2600):
    return mix((thump(95 * weight, 38, 0.7, 6, seed), 0, 1.0), (crack(0.3, bright, seed), 0, 0.55 / weight))


def rev(x, size=1.4, wet=0.35, damp=5000): return reverb(x, size, wet, damp)


# ------------------------------------------------------------------ techniques
# Each entry: technique name (exactly as flags.jjk5e.technique) -> dict(color, shape, backdrop, sound())
TECHNIQUES = {}


def tech(name, color, shape, backdrop):
    def deco(fn):
        TECHNIQUES[name] = {"color": color, "shape": shape, "backdrop": backdrop, "sound": fn}
        return fn
    return deco


@tech("Limitless", "#7aa8ff", "vortex", "void")
def _():
    # Infinity: a stretched, never-arriving tone; blue pulls in, then a hollow implosion.
    pull = sweep_lp(noise(0.9, "pink", 1), 6000, 300) * env_bell(0.9, 0.8, 1.2)
    tone = osc(glide(880, 220, 0.9), 0.9) * env_bell(0.9, 0.85, 2) * 0.4
    implode = reverse(thump(120, 40, 0.35, 9)) * 0.9
    return rev(mix((pull, 0, 0.8), (tone, 0, 1), (implode, 0.62, 1.0), (thump(70, 30, 0.9, 4), 0.96, 0.9)), 1.8, 0.35)


@tech("Shrine", "#e0464a", "slash", "shrine")
def _():
    # Dismantle/Cleave: invisible fast slashes, air ripped, a short butcher-knife ring.
    out = np.zeros(1)
    for k, at in enumerate((0.0, 0.07, 0.13, 0.22)):
        out = place(out, whoosh(0.16, 1500, 7000, 3, k) + shing(2600 + 300 * k, 0.4, k) * 0.35, at, 0.9 - k * 0.1)
    return rev(mix((out, 0, 1), (crack(0.2, 4000, 9), 0.3, 0.6)), 0.9, 0.2)


@tech("Ten Shadows", "#5a4a8c", "smoke", "abyss")
def _():
    # Shadow pool opening: a wet, low swell and a distant howl-like vowel.
    sw = sweep_lp(noise(1.0, "brown", 3), 200, 900) * env_bell(1.0, 0.5, 1.2)
    howl = formant_voice(220, 0.8, "u", 3, 330) * 0.35
    return rev(mix((sw, 0, 1), (howl, 0.25, 1), (thump(60, 35, 0.6, 5), 0.0, 0.6)), 2.0, 0.45, 2500)


@tech("Boogie Woogie", "#f2b84b", "ring", "stage")
def _():
    # One sharp clap, the swap lands with an airy pop.
    return rev(mix((clap(4, 3, 0.012, 0.18), 0, 1.0), (whoosh(0.18, 600, 3000, 2, 4), 0.06, 0.5),
                   (drip(500, 0.12, 2.5), 0.1, 0.6)), 1.6, 0.35)


@tech("Cursed Speech", "#c9a0ff", "ring", "echo")
def _():
    # A synthetic command vowel with a hard echo tail (no recorded voice).
    v = drive(formant_voice(140, 0.55, "o", 5, 120) * 3, 2.2)
    v = v + bp(v, 1800, 3600) * 0.6
    return mix((echo(v, 0.13, 0.5, 5), 0, 1), (thump(80, 40, 0.3, 10), 0.02, 0.25))


@tech("Blood Manipulation", "#c4122f", "drops", "blood")
def _():
    sq = sweep_bp(noise(0.5, seed=6), 300, 1500, 3) * env_bell(0.5, 0.3, 1.5)
    pierce = osc(glide(3000, 400, 0.25), 0.25, "saw")
    pierce = bp(pierce, 400, 5000) * env_exp(0.25, 10)
    return rev(mix((sq, 0, 0.7), (drip(400, 0.15, 1.6), 0.15, 0.7), (pierce, 0.3, 0.8), (thump(110, 50, 0.3, 12), 0.5, 0.6)), 0.8, 0.2)


@tech("Ratio", "#d9c38a", "slash", "dojo")
def _():
    # 7:3 — a measured tick, then the blunt blade strike at the weak point.
    return rev(mix((tick(2400), 0, 0.7), (tick(2400), 0.18, 0.7), (whoosh(0.2, 300, 1500, 2, 7), 0.3, 0.6),
                   (impact(1.2, 7, 1800), 0.46, 1.0)), 0.9, 0.2)


@tech("Disaster Flames", "#ff6a1f", "rise", "volcano")
def _():
    roar = lp(noise(1.2, "pink", 8), 1200) * env_bell(1.2, 0.3, 1)
    return rev(mix((roar, 0, 0.9), (crackle(1.2, 70, 2200, 8), 0, 0.5), (impact(1.4, 8, 1500), 0.25, 0.8)), 1.2, 0.25)


@tech("Disaster Tides", "#2f8fd8", "wave", "sea")
def _():
    surge = sweep_bp(noise(1.3, "pink", 9), 200, 1400, 1.5) * env_bell(1.3, 0.55, 1)
    drops = np.zeros(1)
    for k in range(5): drops = place(drops, drip(700 + 150 * k, 0.12), 0.7 + k * 0.06, 0.4)
    return rev(mix((surge, 0, 1), (drops, 0, 1), (rumble(1.0, 160, 9), 0.2, 0.6)), 1.5, 0.3)


@tech("Disaster Verdure", "#4fb86a", "petals", "garden")
def _():
    rustle = bp(noise(1.0, seed=10), 2000, 7000) * tremolo(env_bell(1.0, 0.5), 18, 0.8)
    creak = bp(osc(glide(90, 60, 0.6), 0.6, "saw"), 200, 1200) * env_bell(0.6, 0.3)
    return rev(mix((rustle, 0, 0.6), (creak, 0.15, 0.7), (impact(0.9, 10, 2200), 0.5, 0.6)), 1.4, 0.3)


@tech("Disaster Storms", "#9fb6d6", "arcs", "storm")
def _():
    wind = sweep_bp(noise(1.4, "pink", 11), 300, 1800, 2.5) * env_bell(1.4, 0.4, 1)
    thunder = lp(noise(1.2, "brown", 11), 400) * env_exp(1.2, 3, 0.01)
    return rev(mix((wind, 0, 0.8), (zap(0.3, 2500, 300, 11), 0.45, 0.6), (thunder, 0.5, 1.0)), 1.8, 0.3)


@tech("Disaster Vermin", "#8a9b3a", "drops", "hive")
def _():
    return rev(mix((buzz(1.2, 180, 11, 12) * env_bell(1.2, 0.4, 1), 0, 1), (crackle(1.0, 90, 3000, 12), 0.1, 0.4)), 1.0, 0.25)


@tech("Earth Manipulation", "#a0784a", "crack", "canyon")
def _():
    grind = bp(noise(0.8, "brown", 13), 60, 600) * env_bell(0.8, 0.3)
    return rev(mix((grind, 0, 1), (impact(1.5, 13, 1200), 0.35, 1), (crackle(0.6, 40, 1500, 13), 0.4, 0.5)), 1.1, 0.2)


@tech("Divergent Fist", "#8fa8ff", "burst", "dojo")
def _():
    # Two hits: the fist, then the delayed cursed-energy echo of the same impact.
    hit = impact(1.0, 14, 2200)
    return rev(mix((whoosh(0.15, 400, 2000, 2, 14), 0, 0.6), (hit, 0.1, 1), (lp(hit, 1500), 0.32, 0.7)), 0.8, 0.2)


@tech("Cursed Spirit Manipulation", "#6b2f8f", "vortex", "womb")
def _():
    # Swallowed curses: a churning low vortex with many faint wails.
    churn = sweep_lp(noise(1.2, "brown", 15), 120, 700) * env_bell(1.2, 0.5)
    wails = sum(formant_voice(180 + 40 * k, 0.9, "a", 15 + k, 140) * 0.12 for k in range(4))
    return rev(mix((churn, 0, 1), (wails, 0.2, 1), (thump(70, 30, 0.8, 4), 0.85, 0.8)), 2.0, 0.45, 3000)


@tech("Idle Transfiguration", "#7ec4b8", "vortex", "flesh")
def _():
    squelch = sweep_bp(noise(0.7, seed=16), 200, 900, 6) * env_bell(0.7, 0.4)
    stretch = osc(glide(300, 90, 0.7) * (1 + 0.05 * np.sin(2 * np.pi * 9 * t_axis(0.7))), 0.7, "tri") * env_bell(0.7, 0.6) * 0.5
    return rev(mix((squelch, 0, 1), (stretch, 0.05, 1)), 1.0, 0.3, 2500)


@tech("Projection Sorcery", "#ffd23f", "frames", "film")
def _():
    # 24 frames per second: a shutter rattle, then the freeze.
    out = np.zeros(1)
    for k in range(12): out = place(out, tick(1800 + (k % 2) * 400, 0.02), k / 24, 0.7)
    return rev(mix((out, 0, 1), (whoosh(0.25, 800, 5000, 3, 17), 0.35, 0.6), (thump(140, 60, 0.25, 15), 0.55, 0.8)), 0.8, 0.2)


@tech("Mythical Beast Amber", "#5fd6ff", "arcs", "storm")
def _():
    return rev(mix((zap(0.6, 2200, 180, 18), 0, 1), (crackle(0.8, 160, 3500, 18), 0.05, 0.7), (impact(1.1, 18, 3000), 0.45, 0.7)), 1.0, 0.25)


@tech("Construction", "#b8b0a0", "crack", "forge")
def _():
    clank = shing(420, 0.6, 19, (1, 2.1, 3.3, 4.8)) * 0.8
    return rev(mix((tick(1200, 0.05), 0, 0.6), (clank, 0.05, 1), (thump(120, 70, 0.3, 10), 0.05, 0.6)), 0.9, 0.25)


@tech("Black Bird Manipulation", "#2d2d3a", "smoke", "ink")
def _():
    flaps = np.zeros(1)
    for k in range(6): flaps = place(flaps, bp(noise(0.08, seed=20 + k), 300, 2000) * env_exp(0.08, 25), k * 0.09, 0.6)
    return rev(mix((flaps, 0, 1), (caw(0.45, 950, 20), 0.35, 0.8), (caw(0.4, 820, 21), 0.6, 0.5)), 1.5, 0.35)


@tech("Black Box", "#3a3a44", "frames", "cube")
def _():
    # A cube snaps shut: a hard, boxy knock with no tail.
    knock = bp(noise(0.06, seed=22), 200, 900) * env_exp(0.06, 60)
    hum = osc(55, 0.7) * env_adsr(0.7, 0.01, 0.1, 0.5, 0.3) * 0.4
    return mix((knock, 0, 1), (knock, 0.06, 0.6), (hum, 0.04, 1), (thump(100, 50, 0.3, 12), 0.0, 0.7))


@tech("Blazing Courage", "#ff8a3d", "rise", "volcano")
def _():
    ignite = sweep_bp(noise(0.5, seed=23), 300, 3000, 2) * env_bell(0.5, 0.8)
    roar = lp(noise(0.9, "pink", 23), 1500) * env_bell(0.9, 0.2)
    chord = pad([196, 247, 294], 1.0, cutoff=1800) * 0.5
    return rev(mix((ignite, 0, 0.8), (roar, 0.4, 0.8), (chord, 0.4, 1)), 1.4, 0.3)


@tech("Antigravity System", "#9db3ff", "vortex", "void")
def _():
    lift = osc(glide(60, 240, 1.0), 1.0) * env_bell(1.0, 0.7) + osc(glide(61.5, 246, 1.0), 1.0) * env_bell(1.0, 0.7)
    return rev(mix((lift * 0.6, 0, 1), (sweep_lp(noise(1.0, "pink", 24), 300, 4000) * env_bell(1.0, 0.7), 0, 0.5)), 1.6, 0.35)


@tech("Auspicious Beast Summon", "#e2c35a", "sigil", "temple")
def _():
    gong = bell(110, 2.0, 1.3)
    return rev(mix((gong, 0, 1), (whoosh(0.5, 200, 1500, 2, 25), 0.2, 0.5)), 2.2, 0.4)


@tech("Body Manipulation", "#8c5a6e", "vortex", "flesh")
def _():
    sq = sweep_bp(noise(0.6, seed=26), 150, 700, 5) * env_bell(0.6, 0.5)
    crackb = crackle(0.4, 50, 1200, 26)
    return rev(mix((sq, 0, 1), (crackb, 0.2, 0.7), (heartbeat(90, 1), 0.3, 0.6)), 1.0, 0.3, 2500)


@tech("Centipede Shroud", "#6d8a3a", "crack", "hive")
def _():
    legs = np.zeros(1)
    for k in range(18): legs = place(legs, tick(900 + (k % 3) * 250, 0.02), k * 0.035, 0.6)
    return rev(mix((legs, 0, 1), (rumble(0.9, 200, 27), 0.2, 0.7)), 1.0, 0.25)


@tech("Clone", "#b6c2d9", "frames", "mirror")
def _():
    base = mix((drip(700, 0.12, 1.8), 0, 1), (whoosh(0.2, 1200, 4000, 3, 28), 0, 0.5))
    return rev(mix((base, 0, 1), (base, 0.08, 0.7), (base, 0.16, 0.5), (base, 0.24, 0.35)), 1.0, 0.3)


@tech("Comedian", "#ffcc33", "stars", "stage")
def _():
    # Rimshot-like hit and a springy boing.
    rim = mix((crack(0.12, 2000, 29), 0, 0.8), (thump(180, 120, 0.15, 20), 0, 0.6))
    boing = osc(glide(180, 420, 0.4) * (1 + 0.15 * np.sin(2 * np.pi * 14 * t_axis(0.4))), 0.4, "tri") * env_exp(0.4, 5)
    return rev(mix((rim, 0, 1), (rim, 0.14, 0.9), (boing, 0.32, 0.8)), 0.9, 0.2)


@tech("Contractual Recreation", "#c7a23a", "sigil", "vault")
def _():
    stamp = mix((thump(160, 90, 0.2, 18), 0, 1), (bp(noise(0.05, seed=30), 400, 2500) * env_exp(0.05, 50), 0, 0.7))
    return rev(mix((coins(0.6, 5, 30), 0, 0.7), (stamp, 0.45, 1)), 1.0, 0.25)


@tech("Cursed Cannon", "#ff9fb4", "burst", "kitchen")
def _():
    boom = mix((thump(70, 30, 0.9, 4, 31), 0, 1), (lp(noise(0.8, "pink", 31), 900) * env_exp(0.8, 4), 0, 0.8))
    return rev(mix((whoosh(0.3, 200, 900, 2, 31), 0, 0.5), (boom, 0.25, 1), (drip(1200, 0.1, 1.4), 0.6, 0.4)), 1.4, 0.3)


@tech("Cursed Circuitry", "#38e0c8", "arcs", "circuit")
def _():
    hum = osc(120, 1.0, "square") * 0.15 + osc(240, 1.0, "square") * 0.08
    blips = np.zeros(1)
    for k in range(7): blips = place(blips, osc(1200 + 220 * (k * 3 % 7), 0.05, "square") * env_exp(0.05, 40), 0.05 + k * 0.07, 0.35)
    return rev(mix((lp(hum, 2500) * env_adsr(1.0, 0.05, 0.1, 0.7, 0.3), 0, 1), (blips, 0, 1), (zap(0.25, 3000, 800, 32), 0.6, 0.5)), 0.8, 0.2)


@tech("Cursed Corpse Creation", "#8f6f8a", "sigil", "workshop")
def _():
    stitch = np.zeros(1)
    for k in range(5): stitch = place(stitch, bp(noise(0.04, seed=33 + k), 1500, 5000) * env_exp(0.04, 60), k * 0.08, 0.6)
    return rev(mix((stitch, 0, 1), (heartbeat(55, 2), 0.35, 0.9)), 1.2, 0.3, 3000)


@tech("Cursed Transmutation", "#5ec7a0", "sigil", "lab")
def _():
    fizz = hp(noise(0.8, seed=34), 4000) * tremolo(env_bell(0.8, 0.5), 25, 0.7) * 0.5
    morph = osc(glide(200, 800, 0.6), 0.6, "tri") * env_bell(0.6, 0.6) * 0.5
    return rev(mix((fizz, 0, 1), (morph, 0.1, 1), (thump(100, 60, 0.3, 12), 0.65, 0.6)), 1.0, 0.25)


@tech("Dark Claw", "#5c1f2e", "slash", "abyss")
def _():
    out = np.zeros(1)
    for k in range(3): out = place(out, whoosh(0.12, 800, 4500, 3, 35 + k) + crack(0.1, 2500, 35 + k) * 0.5, k * 0.05, 1)
    return rev(mix((out, 0, 1), (thump(90, 40, 0.4, 8), 0.12, 0.7)), 0.9, 0.2)


@tech("Deadly Sentencing", "#d6b25c", "sigil", "court")
def _():
    gavel = mix((thump(220, 140, 0.15, 30), 0, 1), (bp(noise(0.03, seed=36), 800, 3000) * env_exp(0.03, 80), 0, 0.8))
    return rev(mix((gavel, 0, 1), (gavel, 0.22, 1), (gavel, 0.44, 1.2), (bell(220, 1.2, 0.6), 0.46, 0.5)), 1.8, 0.4)


@tech("Dragon Vein", "#3fbf8f", "crack", "canyon")
def _():
    vein = osc(glide(55, 75, 1.2), 1.2) * env_bell(1.2, 0.5) * 0.7
    return rev(mix((vein, 0, 1), (rumble(1.2, 180, 37), 0, 0.8), (bell(165, 1.0, 0.4), 0.5, 0.4)), 1.8, 0.35)


@tech("Eight Heads", "#2e7f5e", "smoke", "abyss")
def _():
    hiss = bp(noise(0.7, seed=38), 3000, 9000) * env_bell(0.7, 0.3) * 0.6
    growl = drive(osc(glide(70, 55, 0.8), 0.8, "saw") * (1 + 0.3 * np.sin(2 * np.pi * 23 * t_axis(0.8))), 2) * env_bell(0.8, 0.4)
    return rev(mix((hiss, 0, 1), (lp(growl, 600), 0.2, 0.8)), 1.4, 0.3)


@tech("Esoteric Art", "#e05aa8", "petals", "canvas")
def _():
    brush = sweep_bp(noise(0.6, seed=39), 800, 4000, 3) * env_bell(0.6, 0.4) * 0.7
    splat = bp(noise(0.1, seed=39), 300, 2000) * env_exp(0.1, 30)
    return rev(mix((brush, 0, 1), (splat, 0.5, 0.9), (bell(523, 0.8, 0.4), 0.52, 0.4)), 1.2, 0.3)


@tech("Explosive Flesh", "#ff5533", "burst", "ruins")
def _():
    fuse = hp(noise(0.5, seed=40), 3000) * tremolo(np.ones(int(0.5 * SR)), 30, 0.8) * 0.4
    boom = mix((thump(80, 28, 1.0, 3.5, 40), 0, 1), (lp(noise(1.0, "pink", 40), 1400) * env_exp(1.0, 3.5), 0, 1))
    return rev(mix((fuse, 0, 1), (boom, 0.45, 1), (crackle(0.6, 60, 2000, 40), 0.5, 0.4)), 1.6, 0.3)


@tech("Fa Jin", "#ffb36b", "burst", "dojo")
def _():
    charge = osc(glide(110, 330, 0.4), 0.4, "tri") * env_bell(0.4, 0.95) * 0.4
    return rev(mix((charge, 0, 1), (impact(1.3, 41, 2000), 0.38, 1), (whoosh(0.25, 600, 200, 2, 41), 0.4, 0.5)), 1.0, 0.2)


@tech("Faceless God", "#7d6f9a", "vortex", "madness")
def _():
    drone = pad([73.4, 77.8, 110], 1.4, 0.012, "saw", 900) * 0.8
    whisper = bp(noise(1.2, seed=42), 1500, 5000) * tremolo(env_bell(1.2, 0.5), 7, 0.9) * 0.3
    return rev(mix((drone, 0, 1), (whisper, 0.1, 1)), 2.2, 0.5, 3000)


@tech("Fate", "#c8a6ff", "sigil", "loom")
def _():
    threads = sum(osc(f, 1.2) * env_exp(1.2, 2.5, 0.01) * 0.2 for f in (392, 494, 587))
    return rev(mix((threads, 0, 1), (tick(2600), 0.0, 0.6), (bell(784, 1.0, 0.5), 0.3, 0.5)), 2.0, 0.45)


@tech("G Warstaff", "#9fd4ff", "frames", "canvas")
def _():
    scribble = bp(noise(0.5, seed=43), 1800, 6000) * tremolo(env_bell(0.5, 0.5), 16, 1) * 0.6
    return rev(mix((scribble, 0, 1), (impact(0.8, 43, 3000), 0.45, 0.8)), 0.9, 0.2)


@tech("Golden Hour", "#ffc46b", "frames", "dusk")
def _():
    ticks = np.zeros(1)
    for k in range(5): ticks = place(ticks, tick(2000, 0.03), k * 0.2, 0.6)
    swell = reverse(rev(bell(440, 0.9, 0.8), 1.0, 0.5)) * 0.6
    return rev(mix((ticks, 0, 1), (swell, 0.2, 1), (bell(880, 1.2, 0.6), 1.0, 0.6)), 1.6, 0.35)


@tech("Hair Manipulation", "#d98ad9", "slash", "silk")
def _():
    out = np.zeros(1)
    for k in range(4): out = place(out, whoosh(0.25, 2500, 9000, 4, 44 + k) * 0.5, k * 0.06, 1)
    return rev(mix((out, 0, 1), (crack(0.1, 5000, 44), 0.3, 0.6)), 0.9, 0.2)


@tech("Heart Catch", "#ff6fa3", "ring", "garden")
def _():
    return rev(mix((heartbeat(110, 2), 0, 1), (bell(659, 0.8, 0.5), 0.15, 0.5), (bell(784, 0.8, 0.5), 0.3, 0.4)), 1.2, 0.3)


@tech("Ice Formation", "#bfe8ff", "crack", "ice")
def _():
    freeze = hp(sweep_bp(noise(0.7, seed=45), 6000, 1500, 4), 800) * env_bell(0.7, 0.3) * 0.6
    tinks = np.zeros(1)
    for k in range(5): tinks = place(tinks, shing(3500 + 400 * k, 0.4, 45 + k) * 0.3, 0.3 + k * 0.05, 1)
    return rev(mix((freeze, 0, 1), (tinks, 0, 1), (crack(0.2, 3000, 45), 0.25, 0.5)), 1.4, 0.35)


@tech("Illusive Mirage", "#b4a0ff", "frames", "mirror")
def _():
    shimmer = sum(osc(f * (1 + 0.01 * np.sin(2 * np.pi * 0.7 * t_axis(1.2))), 1.2) * 0.15 for f in (523, 659, 784, 1046))
    return rev(mix((shimmer * env_bell(1.2, 0.5), 0, 1), (reverse(bell(880, 0.7, 0.6)) * 0.4, 0.2, 1)), 2.0, 0.5)


@tech("Inverse", "#a8ff9f", "ring", "mirror")
def _():
    hit = impact(1.0, 46, 2400)
    return rev(mix((reverse(hit) * 0.8, 0, 1), (hit, len(hit) / SR - 0.02, 1)), 1.0, 0.25)


@tech("Laplace’s Demon", "#9ad1ff", "frames", "lab")
def _():
    calc = np.zeros(1)
    r = np.random.default_rng(47)
    for k in range(14): calc = place(calc, osc(r.choice([880, 1320, 1760, 2640]), 0.04, "square") * env_exp(0.04, 50), k * 0.04, 0.3)
    return rev(mix((calc, 0, 1), (bell(1320, 0.8, 0.5), 0.6, 0.6)), 1.0, 0.3)


@tech("Love Rendezvous", "#ff8fc7", "stars", "starsea")
def _():
    pull = osc(glide(330, 660, 0.6), 0.6) * env_bell(0.6, 0.8) * 0.4
    return rev(mix((pull, 0, 1), (bell(988, 1.0, 0.5), 0.55, 0.6), (bell(1319, 1.0, 0.4), 0.62, 0.5)), 1.8, 0.4)


@tech("Miracle", "#fff09a", "stars", "temple")
def _():
    sparkle = np.zeros(1)
    for k, f in enumerate((1047, 1319, 1568, 2093)): sparkle = place(sparkle, bell(f, 0.9, 0.5) * 0.4, k * 0.07, 1)
    return rev(mix((sparkle, 0, 1), (sweep_bp(noise(0.6, seed=48), 2000, 8000, 3) * env_bell(0.6, 0.5) * 0.3, 0, 1)), 2.0, 0.45)


@tech("Missile Fist", "#ff7b5c", "burst", "ruins")
def _():
    out = np.zeros(1)
    for k in range(4): out = place(out, mix((whoosh(0.2, 300, 1800, 2, 49 + k), 0, 0.5), (impact(1.1, 49 + k, 2000), 0.15, 1)), k * 0.14, 0.9)
    return rev(out, 1.0, 0.2)


@tech("Moon Dregs", "#b6a6ff", "drops", "lunar")
def _():
    gloop = sum(drip(300 + 90 * k, 0.25, 1.4) * 0.4 for k in range(3))
    mist = bp(noise(1.0, "pink", 50), 400, 1800) * env_bell(1.0, 0.5) * 0.4
    return rev(mix((mist, 0, 1), (gloop, 0.2, 1), (gloop, 0.45, 0.6)), 2.0, 0.45)


@tech("New Shadow Style", "#c9d1e0", "slash", "dojo")
def _():
    # Iai: silence, the draw, one clean cut, then the sheath click.
    draw = bp(noise(0.25, seed=51), 2500, 8000) * env_bell(0.25, 0.8) * 0.5
    cut = mix((whoosh(0.12, 2000, 9000, 4, 51), 0, 0.9), (shing(3100, 0.8, 51), 0.02, 0.6))
    return rev(mix((draw, 0, 1), (cut, 0.3, 1), (tick(1600, 0.04), 0.95, 0.7)), 1.2, 0.25)


@tech("Pachinko Fever", "#ffd84a", "stars", "parlor")
def _():
    balls = np.zeros(1)
    r = np.random.default_rng(52)
    for k in range(16): balls = place(balls, tick(r.uniform(2500, 4500), 0.02), k * 0.04, 0.5)
    jackpot = sum(osc(f, 0.6, "square") * env_exp(0.6, 4) * 0.12 for f in (523, 659, 784))
    return rev(mix((balls, 0, 1), (jackpot, 0.6, 1), (coins(0.6, 6, 52), 0.65, 0.6)), 1.0, 0.25)


@tech("Pain Killer", "#7fe0c4", "ring", "clinic")
def _():
    beep = osc(1000, 0.12) * env_adsr(0.12, 0.005, 0.01, 1, 0.02) * 0.4
    return rev(mix((beep, 0, 1), (beep, 0.35, 1), (sweep_lp(noise(0.6, "pink", 53), 4000, 300) * env_bell(0.6, 0.2) * 0.4, 0.4, 1)), 1.0, 0.3)


@tech("Paralyzing Gaze", "#ffe36b", "ring", "mirror")
def _():
    lock = mix((osc(glide(2200, 1500, 0.3), 0.3, "sine") * env_exp(0.3, 6), 0, 0.5), (thump(150, 90, 0.2, 18), 0.28, 0.9))
    return rev(mix((lock, 0, 1), (osc(1500, 0.8) * env_exp(0.8, 3) * 0.2, 0.3, 1)), 1.4, 0.35)


@tech("Prayer Song", "#ffd6f0", "ring", "stage")
def _():
    beat = mix((thump(120, 60, 0.2, 16), 0, 1), (thump(120, 60, 0.2, 16), 0.25, 0.8))
    chant = formant_voice(196, 0.9, "a", 54, 220) * 0.4 + formant_voice(294, 0.9, "a", 55, 330) * 0.25
    return rev(mix((beat, 0, 1), (chant, 0.1, 1), (beat, 0.5, 0.9)), 1.6, 0.35)


@tech("Puppet Manipulation", "#c0a070", "frames", "workshop")
def _():
    out = np.zeros(1)
    for k in range(6): out = place(out, shing(700 + 120 * (k % 3), 0.18, 56 + k, (1, 2.4, 3.7)) * 0.5, k * 0.08, 1)
    return rev(mix((out, 0, 1), (osc(glide(400, 180, 0.4), 0.4, "square") * env_exp(0.4, 6) * 0.15, 0.5, 1)), 0.9, 0.2)


@tech("Regalia", "#e6c15a", "sigil", "vault")
def _():
    return rev(mix((shing(880, 1.0, 57, (1, 2, 3.01, 4.1)), 0, 0.8), (bell(440, 1.4, 0.8), 0.05, 0.6), (whoosh(0.4, 300, 2000, 2, 57), 0.3, 0.5)), 1.8, 0.4)


@tech("Retrograde", "#9fc0ff", "vortex", "dusk")
def _():
    hit = rev(impact(1.0, 58, 2400), 1.2, 0.4)
    return mix((reverse(hit), 0, 1), (tick(2200), len(hit) / SR, 0.5))


@tech("Rockstar", "#ff4fd8", "ring", "stage")
def _():
    chord = drive(sum(osc(f, 1.0, "saw") for f in (110, 164.8, 220)) / 3, 5)
    chord = lp(chord, 3500) * env_adsr(1.0, 0.005, 0.15, 0.7, 0.3)
    return rev(mix((chord, 0, 1), (thump(90, 45, 0.4, 8), 0, 0.7)), 1.2, 0.3)


@tech("Rot", "#7a3b2e", "drops", "blood")
def _():
    sizzle = hp(noise(0.9, seed=59), 2500) * tremolo(env_bell(0.9, 0.3), 30, 0.8) * 0.4
    return rev(mix((sizzle, 0, 1), (bp(noise(0.5, "brown", 59), 80, 500) * env_bell(0.5, 0.3), 0, 0.8), (drip(250, 0.2, 0.6), 0.4, 0.5)), 1.0, 0.25, 2500)


@tech("Schrift X", "#ff3355", "slash", "cube")
def _():
    a = mix((whoosh(0.15, 1000, 6000, 3, 60), 0, 0.7), (crack(0.12, 3000, 60), 0.1, 0.6))
    b = mix((whoosh(0.15, 6000, 1000, 3, 61), 0, 0.7), (crack(0.12, 3000, 61), 0.1, 0.6))
    return rev(mix((a, 0, 1), (b, 0.12, 1), (thump(130, 60, 0.3, 12), 0.25, 0.8)), 0.9, 0.2)


@tech("Seance", "#a8b8c8", "smoke", "parlor")
def _():
    ghost = osc(glide(600, 480, 1.4) * (1 + 0.02 * np.sin(2 * np.pi * 6 * t_axis(1.4))), 1.4) * env_bell(1.4, 0.5) * 0.3
    return rev(mix((ghost, 0, 1), (bell(196, 1.4, 0.6), 0, 0.5), (bp(noise(1.2, seed=62), 600, 3000) * env_bell(1.2, 0.5) * 0.2, 0.1, 1)), 2.4, 0.55)


@tech("Shadow Killer", "#3b2f4f", "smoke", "abyss")
def _():
    return rev(mix((whoosh(0.4, 3000, 300, 3, 63), 0, 0.8), (thump(70, 32, 0.5, 6), 0.35, 1), (reverse(crack(0.15, 2000, 63)), 0.2, 0.4)), 1.6, 0.4, 2000)


@tech("Sky Manipulation", "#8fd0ff", "wave", "sky")
def _():
    tear = sweep_bp(noise(0.9, seed=64), 4000, 600, 2) * env_bell(0.9, 0.4) * 0.8
    return rev(mix((tear, 0, 1), (crack(0.3, 1500, 64), 0.5, 0.8), (rumble(0.9, 150, 64), 0.4, 0.7)), 1.8, 0.35)


@tech("Solo Forbidden Zone", "#e8d8a8", "ring", "temple")
def _():
    chant = formant_voice(130, 1.2, "u", 65, 130) * 0.5
    return rev(mix((chant, 0, 1), (bell(260, 1.4, 0.6), 0.6, 0.6), (tick(1500, 0.04), 0.0, 0.6)), 2.0, 0.45)


@tech("Star Dictator", "#ffe9a8", "stars", "starsea")
def _():
    out = np.zeros(1)
    for k, f in enumerate((392, 523, 659, 784)): out = place(out, bell(f, 1.2, 0.7) * 0.4, k * 0.1, 1)
    return rev(mix((out, 0, 1), (osc(98, 1.4) * env_bell(1.4, 0.4) * 0.4, 0, 1)), 2.0, 0.45)


@tech("Star Rage", "#ffd27a", "vortex", "starsea")
def _():
    mass = osc(glide(40, 32, 1.2), 1.2) * env_bell(1.2, 0.2) * 0.9
    return rev(mix((mass, 0, 1), (rumble(1.2, 100, 66), 0, 0.8), (impact(1.6, 66, 1200), 0.6, 1)), 1.6, 0.3)


@tech("Starlight Symphony", "#d6c7ff", "petals", "starsea")
def _():
    fog = bp(noise(1.2, "pink", 67), 500, 3000) * env_bell(1.2, 0.5) * 0.4
    arp = np.zeros(1)
    for k, f in enumerate((587, 740, 880, 1175, 1480)): arp = place(arp, bell(f, 0.7, 0.5) * 0.3, k * 0.09, 1)
    return rev(mix((fog, 0, 1), (arp, 0.15, 1)), 2.2, 0.5)


@tech("Straw Doll Technique", "#d1b07a", "burst", "shrine")
def _():
    hammer = mix((thump(240, 160, 0.12, 30), 0, 1), (shing(2200, 0.4, 68, (1, 2.6, 4.3)) * 0.6, 0, 1))
    resonance = lp(echo(hammer, 0.09, 0.5, 4), 2500) * 0.5
    return rev(mix((hammer, 0, 1), (resonance, 0.15, 1)), 1.2, 0.3)


@tech("Technique Extermination", "#f5f5f0", "ring", "eden")
def _():
    snuff = mix((sweep_lp(noise(0.6, seed=69), 8000, 200) * env_bell(0.6, 0.2) * 0.6, 0, 1), (thump(100, 40, 0.4, 9), 0.4, 0.8))
    choir = pad([523, 659, 784], 1.2, cutoff=3500) * 0.4
    return rev(mix((snuff, 0, 1), (choir, 0.2, 1)), 2.2, 0.45)


@tech("Teleportation", "#80ffea", "ring", "crossroads")
def _():
    out = mix((osc(glide(400, 2400, 0.25), 0.25) * env_exp(0.25, 4) * 0.4, 0, 1), (drip(900, 0.1, 2.2), 0.25, 0.7),
              (whoosh(0.2, 3000, 800, 3, 70), 0.0, 0.5))
    return rev(out, 1.0, 0.3)


@tech("Tool Manipulation", "#b8c0c8", "slash", "workshop")
def _():
    clatter = np.zeros(1)
    r = np.random.default_rng(71)
    for k in range(6): clatter = place(clatter, shing(r.uniform(600, 1800), 0.25, 71 + k, (1, 2.2, 3.4)) * 0.4, k * 0.05, 1)
    return rev(mix((clatter, 0, 1), (whoosh(0.3, 500, 3000, 2, 71), 0.25, 0.7)), 0.9, 0.2)


@tech("Triple Core", "#ff9a5c", "burst", "forge")
def _():
    out = np.zeros(1)
    for k, f in enumerate((110, 147, 196)): out = place(out, mix((thump(f * 1.2, f * 0.6, 0.3, 10), 0, 1), (osc(f * 2, 0.3, "square") * env_exp(0.3, 8) * 0.15, 0, 1)), k * 0.16, 1)
    return rev(out, 1.0, 0.25)


@tech("Vengeful Spirit Manipulation", "#d0d8ff", "smoke", "womb")
def _():
    scream = formant_voice(330, 0.9, "a", 72, 520) * 0.5
    return rev(mix((reverse(rev(scream, 1.0, 0.6)) * 0.4, 0, 1), (scream, 0.7, 1), (thump(80, 30, 0.8, 4), 0.72, 0.8)), 2.2, 0.5, 3000)


@tech("Voracity", "#8c3a3a", "vortex", "flesh")
def _():
    chomp = mix((bp(noise(0.07, seed=73), 200, 1200) * env_exp(0.07, 40), 0, 1), (thump(120, 60, 0.12, 25), 0, 0.8))
    return rev(mix((chomp, 0, 1), (chomp, 0.18, 1), (chomp, 0.36, 1), (sweep_lp(noise(0.6, "brown", 73), 200, 800) * env_bell(0.6, 0.3), 0.4, 0.7)), 0.8, 0.2)


@tech("████ and Light", "#fff6c8", "rise", "eden")
def _():
    beam = sum(osc(f, 1.0) for f in (880, 1320, 1760)) / 3 * env_bell(1.0, 0.15, 1)
    return rev(mix((beam * 0.5, 0, 1), (whoosh(0.3, 1000, 8000, 3, 74), 0, 0.6), (crack(0.15, 5000, 74), 0.1, 0.4)), 1.6, 0.35)


@tech("Vairocana", "#ffd0a0", "sigil", "mandala")
def _():
    harmony = pad([196, 294, 392], 1.2, cutoff=2500) * 0.5
    chaos = bitcrush(noise(0.6, seed=75) * env_bell(0.6, 0.5), 4, 6) * 0.3
    return rev(mix((harmony, 0, 1), (chaos, 0.6, 1), (bell(196, 1.6, 0.7), 0.0, 0.4)), 2.2, 0.45)



# ------------------------------------------------------------------ families: impact sounds at the target
FAMILY_IMPACT = {
    "ce": lambda: rev(impact(1.0, 100, 2400), 0.8, 0.2),
    "physical": lambda: rev(impact(1.2, 101, 1800), 0.6, 0.15),
    "fist": lambda: rev(mix((impact(1.1, 102, 2200), 0, 1), (lp(impact(1.1, 102), 1200), 0.18, 0.5)), 0.7, 0.2),
    "blade": lambda: rev(mix((whoosh(0.12, 2000, 8000, 3, 103), 0, 0.8), (shing(2900, 0.5, 103), 0.03, 0.6)), 0.7, 0.2),
    "fire": lambda: rev(mix((impact(1.3, 104, 1500), 0, 1), (crackle(0.6, 80, 2000, 104), 0, 0.5)), 1.0, 0.25),
    "cold": lambda: rev(mix((crack(0.2, 3000, 105), 0, 0.7), (shing(4000, 0.5, 105) * 0.4, 0.02, 1)), 1.0, 0.3),
    "lightning": lambda: rev(mix((zap(0.3, 2500, 300, 106), 0, 1), (crack(0.2, 2500, 106), 0, 0.7)), 0.9, 0.25),
    "water": lambda: rev(mix((sweep_bp(noise(0.4, seed=107), 1500, 300, 2) * env_exp(0.4, 6), 0, 1), (drip(800, 0.12), 0.1, 0.5)), 0.9, 0.25),
    "earth": lambda: rev(mix((impact(1.5, 108, 1200), 0, 1), (crackle(0.4, 40, 1500, 108), 0.05, 0.5)), 0.9, 0.2),
    "blood": lambda: rev(mix((impact(0.9, 109, 2000), 0, 0.8), (sweep_bp(noise(0.2, seed=109), 400, 1500, 3) * env_exp(0.2, 10), 0, 0.6)), 0.7, 0.2),
    "shadow": lambda: rev(mix((thump(70, 30, 0.5, 6), 0, 1), (reverse(crack(0.12, 2000, 110)), 0, 0.4)), 1.2, 0.35, 2000),
    "void": lambda: rev(mix((reverse(thump(110, 40, 0.3, 10)), 0, 1), (thump(70, 28, 0.6, 5), 0.3, 1)), 1.4, 0.35),
    "nature": lambda: rev(mix((impact(0.9, 112, 2200), 0, 0.8), (bp(noise(0.3, seed=112), 2000, 7000) * env_exp(0.3, 8), 0, 0.4)), 0.9, 0.25),
    "wind": lambda: rev(whoosh(0.35, 600, 3000, 2, 113), 0.9, 0.25),
    "sound": lambda: rev(mix((thump(90, 45, 0.3, 10), 0, 0.8), (echo(bp(noise(0.05, seed=114), 500, 2500) * env_exp(0.05, 40), 0.08, 0.5, 4), 0, 0.7)), 0.8, 0.2),
    "star": lambda: rev(mix((impact(0.9, 115, 3000), 0, 0.7), (bell(1568, 0.6, 0.5) * 0.4, 0, 1)), 1.2, 0.3),
    "gun": lambda: rev(mix((crack(0.15, 1500, 116), 0, 1), (thump(140, 60, 0.25, 14), 0, 0.8)), 0.8, 0.2),
    "mind": lambda: rev(mix((osc(glide(1400, 600, 0.3), 0.3) * env_exp(0.3, 6) * 0.4, 0, 1), (thump(110, 60, 0.2, 18), 0, 0.5)), 1.4, 0.4),
    "barrier": lambda: rev(mix((shing(520, 0.6, 118, (1, 2.01, 3.02)) * 0.6, 0, 1), (thump(120, 70, 0.2, 16), 0, 0.6)), 1.0, 0.3),
    "heal": lambda: rev(mix((bell(784, 0.9, 0.5) * 0.4, 0, 1), (bell(1046, 0.9, 0.5) * 0.3, 0.08, 1)), 1.6, 0.4),
    "curse": lambda: rev(mix((thump(80, 35, 0.5, 6), 0, 0.9), (formant_voice(160, 0.4, "u", 120, 110) * 0.3, 0, 1)), 1.4, 0.4, 3000),
}

# ------------------------------------------------------------------ module events
EVENTS = {
    # Deep resonant thoom + crack layered with an electric distortion, then a ringing, slightly reversed tail.
    "black-flash": lambda: rev(mix((reverse(sweep_lp(noise(0.25, "pink", 200), 200, 5000) * env_bell(0.25, 0.9)) * 0.5, 0, 1),
                                   (thump(110, 32, 1.1, 3.2, 200), 0.22, 1.0),
                                   (drive(crack(0.25, 1800, 200), 2), 0.22, 0.8),
                                   (zap(0.45, 3000, 160, 200), 0.24, 0.55),
                                   (osc(glide(57, 52, 1.6), 1.6) * env_exp(1.6, 1.6) * 0.5, 0.25, 1)), 1.8, 0.3),
    # Heavy bass bloom and a ringing silence: the world closes around you.
    "domain-open": lambda: rev(mix((reverse(rev(bell(73.4, 1.6, 1.2), 1.6, 0.6)) * 0.6, 0, 1),
                                   (thump(70, 26, 2.2, 1.6, 201), 1.55, 1.0),
                                   (lp(noise(2.2, "brown", 201), 120) * env_exp(2.2, 1.5), 1.55, 0.8),
                                   (osc(4200, 2.4) * env_bell(2.4, 0.2, 1) * 0.05, 1.6, 1)), 2.4, 0.4, 3500),
    "domain-close": lambda: rev(mix((sweep_lp(noise(1.2, "pink", 202), 3000, 80) * env_bell(1.2, 0.2) * 0.7, 0, 1),
                                    (crack(0.4, 1200, 202), 0.0, 0.6), (thump(90, 35, 0.8, 4), 0.05, 0.7)), 1.6, 0.35),
    "domain-clash": lambda: rev(mix((zap(0.8, 1800, 90, 203), 0, 0.8), (thump(80, 30, 1.0, 3), 0, 1),
                                    (thump(85, 31, 1.0, 3), 0.18, 0.9), (shing(330, 1.4, 203, (1, 1.5, 2.2)) * 0.4, 0, 1)), 1.8, 0.35),
    "zone": lambda: rev(mix((pad([110, 165, 220], 1.4, cutoff=2600) * 0.6, 0, 1), (heartbeat(130, 3), 0, 0.7)), 1.6, 0.35),
    "burnout": lambda: rev(mix((sweep_lp(noise(1.0, "pink", 205), 4000, 150) * env_bell(1.0, 0.1) * 0.6, 0, 1),
                               (osc(glide(440, 110, 1.0), 1.0, "tri") * env_exp(1.0, 2) * 0.3, 0, 1)), 1.4, 0.3),
    "ce-low": lambda: rev(mix((osc(392, 0.18) * env_exp(0.18, 12) * 0.5, 0, 1), (osc(311, 0.25) * env_exp(0.25, 9) * 0.5, 0.14, 1)), 0.8, 0.25),
    "max-output": lambda: rev(mix((osc(glide(90, 360, 0.7), 0.7, "saw") * env_bell(0.7, 0.9) * 0.3, 0, 1),
                                  (impact(1.2, 206, 2200), 0.65, 1)), 1.2, 0.25),
}

# ------------------------------------------------------------------ visual shapes and domain backdrops
SHAPES = ["burst", "slash", "ring", "vortex", "rise", "crack", "arcs", "drops", "petals", "stars", "sigil", "smoke", "frames", "wave"]
FAMILY_SHAPE = {"ce": "burst", "physical": "burst", "fist": "burst", "blade": "slash", "fire": "rise", "cold": "crack",
                "lightning": "arcs", "water": "wave", "earth": "crack", "blood": "drops", "shadow": "smoke", "void": "vortex",
                "nature": "petals", "wind": "wave", "sound": "ring", "star": "stars", "gun": "burst", "mind": "frames",
                "barrier": "ring", "heal": "rise", "curse": "smoke"}
BACKDROPS = ["void", "shrine", "abyss", "sea", "garden", "volcano", "storm", "ink", "mirror", "temple", "ice", "circuit"]
# Backdrops a technique names but that are drawn by a close relative (keeps the asset count small).
BACKDROP_ALIAS = {"stage": "temple", "echo": "mirror", "blood": "shrine", "dojo": "temple", "hive": "abyss", "canyon": "volcano",
                  "womb": "abyss", "flesh": "shrine", "film": "mirror", "forge": "volcano", "cube": "void", "vault": "temple",
                  "kitchen": "garden", "workshop": "circuit", "lab": "circuit", "court": "temple", "madness": "abyss",
                  "loom": "void", "canvas": "ink", "dusk": "sea", "silk": "ink", "starsea": "void", "lunar": "sea",
                  "parlor": "ink", "clinic": "ice", "ruins": "volcano", "sky": "storm", "eden": "garden", "crossroads": "void",
                  "mandala": "temple"}
