#!/usr/bin/env python3
"""Render JJK5e's own audio-visual assets and the JS table that maps techniques to them.

  python3 tools/build-fx.py            # everything
  python3 tools/build-fx.py --sounds   # only sounds (also: --effects, --textures, --table)

Outputs (all generated from code, no third-party media):
  sounds/techniques/<slug>.ogg   cast sound per technique
  sounds/impact/<family>.ogg     hit sound per identity family
  sounds/events/<event>.ogg      domain, clash, Black Flash, The Zone…
  effects/<shape>.webm           white ink effects (VP9 + alpha) that Sequencer tints per technique
  textures/domains/<name>.webp   seamless domain backdrops
  scripts/jjk-fx-table.mjs       technique → colour, shape, sound, backdrop
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
import fx_recipes as R  # noqa: E402
from fx_synth import SR, finish  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def slug(name):
    s = name.replace("’", "").replace("'", "").replace("█", "x")
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ------------------------------------------------------------------ audio
def write_ogg(x, path, quality=4):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-c:a", "libvorbis", "-q:a", str(quality), path], input=pcm, check=True)


def check_audio(name, x):
    assert np.all(np.isfinite(x)), f"{name}: NaN"
    dur = len(x) / SR
    assert 0.15 <= dur <= (6.0 if name.startswith("event:") else 4.5), f"{name}: {dur:.2f}s"
    rms = float(np.sqrt(np.mean(x ** 2)))
    assert rms > 0.02, f"{name}: too quiet ({rms:.3f})"
    return dur, rms


def lufs(x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    err = subprocess.run(["ffmpeg", "-hide_banner", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", "-af", "ebur128", "-f", "null", "-"],
                         input=pcm, capture_output=True).stderr.decode()
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])


def loudness_match(x, target):
    """Same perceived loudness for every sound (EBU R128), soft-limited under -1 dBFS."""
    for _ in range(3):
        diff = target - lufs(x)
        if abs(diff) < 0.5: break
        x = np.tanh(x * 10 ** (diff / 20) / 0.89) * 0.89
    return x.astype(np.float32)


def build_sounds():
    report = []
    jobs = [(f"sounds/techniques/{slug(n)}.ogg", n, d["sound"]) for n, d in R.TECHNIQUES.items()]
    jobs += [(f"sounds/impact/{f}.ogg", f"impact:{f}", fn) for f, fn in R.FAMILY_IMPACT.items()]
    jobs += [(f"sounds/events/{e}.ogg", f"event:{e}", fn) for e, fn in R.EVENTS.items()]
    for rel, name, fn in jobs:
        x = loudness_match(finish(fn()), -15.0 if name.startswith("event:") else -16.0)
        dur, rms = check_audio(name, x)
        write_ogg(x, os.path.join(ROOT, rel))
        report.append((rel, dur, rms, os.path.getsize(os.path.join(ROOT, rel))))
    total = sum(r[3] for r in report)
    print(f"sounds: {len(report)} files, {total / 1024:.0f} KiB")
    return report


# ------------------------------------------------------------------ effects (white ink, alpha)
S = 320          # output size
SS = 2           # supersampling
FRAMES = 24
FPS = 24


def _canvas():
    return Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))


def _ease(t): return 1 - (1 - t) ** 3


def _alpha_over(t, fade_in=0.08, fade_out=0.55):
    a = min(1, t / fade_in) if fade_in else 1
    if t > fade_out: a *= max(0, 1 - (t - fade_out) / (1 - fade_out))
    return a


def _stroke(draw, pts, w0, w1, col):
    """Tapered brush stroke along points."""
    n = len(pts)
    for i in range(n - 1):
        w = w0 + (w1 - w0) * i / max(1, n - 2)
        draw.line([pts[i], pts[i + 1]], fill=col, width=max(1, int(w)))
        r = w / 2
        draw.ellipse([pts[i][0] - r, pts[i][1] - r, pts[i][0] + r, pts[i][1] + r], fill=col)


def _white(a): return (255, 255, 255, int(255 * max(0, min(1, a))))
def _ink(a): return (10, 6, 10, int(255 * max(0, min(1, a))))


def frame_shape(shape, f, rnd):
    t = f / (FRAMES - 1)
    img = _canvas()
    d = ImageDraw.Draw(img)
    c = S * SS / 2
    R_ = S * SS * 0.46
    A = _alpha_over(t)
    if shape == "burst":
        r = R_ * _ease(t)
        d.ellipse([c - r, c - r, c + r, c + r], outline=_white(A * 0.9), width=int(10 * SS * (1 - t) + 2))
        for k in range(14):
            ang = k / 14 * 2 * math.pi + rnd[k] * 0.3
            r0, r1 = R_ * 0.15 * _ease(t), R_ * (0.55 + 0.4 * rnd[k + 14]) * _ease(min(1, t * 1.6))
            p = [(c + math.cos(ang) * (r0 + (r1 - r0) * s), c + math.sin(ang) * (r0 + (r1 - r0) * s)) for s in np.linspace(0, 1, 8)]
            _stroke(d, p, 14 * SS * (1 - t), 2, _white(A))
        if t < 0.35:
            rr = R_ * 0.3 * (1 - t / 0.35)
            d.ellipse([c - rr, c - rr, c + rr, c + rr], fill=_white(1))
            d.ellipse([c - rr * 0.5, c - rr * 0.5, c + rr * 0.5, c + rr * 0.5], fill=_ink(0.9))
    elif shape == "slash":
        for k in range(3):
            tk = min(1, max(0, (t - k * 0.12) / 0.4))
            if tk <= 0: continue
            a0 = -2.4 + k * 0.5
            pts = [(c + math.cos(a0 + s * 2.2 * tk) * R_ * (0.9 - k * 0.12), c + math.sin(a0 + s * 2.2 * tk) * R_ * (0.5 - k * 0.1) + (k - 1) * 40 * SS)
                   for s in np.linspace(0, 1, 24)]
            _stroke(d, pts, 3, 22 * SS * (1 - 0.6 * k / 3), _white(_alpha_over(t, 0.02, 0.45)))
    elif shape == "ring":
        for k in range(3):
            tk = (t - k * 0.15) / 0.85
            if not 0 < tk <= 1: continue
            r = R_ * _ease(tk)
            d.ellipse([c - r, c - r, c + r, c + r], outline=_white((1 - tk) * A), width=int(12 * SS * (1 - tk) + 2))
    elif shape == "vortex":
        rot = t * 4.5
        for arm in range(5):
            pts = []
            for s in np.linspace(0, 1, 40):
                ang = arm / 5 * 2 * math.pi + rot + s * 3.2
                r = R_ * (1 - s) * (1 - 0.6 * t) + 6
                pts.append((c + math.cos(ang) * r, c + math.sin(ang) * r))
            _stroke(d, pts, 3, 16 * SS, _white(A))
        rr = 24 * SS * (0.5 + t)
        d.ellipse([c - rr, c - rr, c + rr, c + rr], fill=_ink(A))
        d.ellipse([c - rr, c - rr, c + rr, c + rr], outline=_white(A), width=4 * SS)
    elif shape == "rise":
        # Flame tongues: wide at the root, licking to a point, swaying as they climb.
        for k in range(9):
            x = c + (k - 4) * R_ * 0.17 + (rnd[k] - 0.5) * 20 * SS
            y0 = c + R_ * 0.62
            h = R_ * (0.55 + 0.55 * rnd[k + 18]) * _ease(min(1, t * 1.5 + rnd[k] * 0.15)) * (1 - 0.35 * max(0, t - 0.6))
            pts = [(x + math.sin(s * 4 + rnd[k] * 9 + t * 10) * 26 * SS * s, y0 - h * s) for s in np.linspace(0, 1, 18)]
            _stroke(d, pts, (34 + 18 * rnd[k + 36]) * SS * (1 - 0.3 * t), 1, _white(A))
        for k in range(10):  # embers
            tk = (t + rnd[k + 50]) % 1
            x = c + (rnd[k + 60] - 0.5) * R_ * 1.4
            y = c + R_ * 0.6 - tk * R_ * 1.4
            r = 5 * SS * (1 - tk)
            d.ellipse([x - r, y - r, x + r, y + r], fill=_white(A * (1 - tk)))
    elif shape == "crack":
        grow = _ease(min(1, t * 1.8))
        for k in range(9):
            ang = k / 9 * 2 * math.pi + rnd[k]
            x, y = c, c
            pts = [(x, y)]
            for s in range(10):
                ang += (rnd[(k * 10 + s) % 60] - 0.5) * 0.9
                step = R_ * 0.1 * grow
                x += math.cos(ang) * step; y += math.sin(ang) * step
                pts.append((x, y))
            _stroke(d, pts, 10 * SS, 1, _white(A))
            _stroke(d, pts, 3 * SS, 1, _ink(A))
    elif shape == "arcs":
        if f % 3 != 2:
            seed = np.random.default_rng(1000 + f // 2)
            for k in range(4):
                ang = seed.uniform(0, 2 * math.pi)
                end = (c + math.cos(ang) * R_ * 0.95, c + math.sin(ang) * R_ * 0.95)
                pts = [(c, c)]
                for s in np.linspace(0.1, 1, 9):
                    jx, jy = seed.normal(0, 22 * SS, 2)
                    pts.append((c + (end[0] - c) * s + jx, c + (end[1] - c) * s + jy))
                pts[-1] = end
                _stroke(d, pts, 9 * SS, 2 * SS, _white(A))
                _stroke(d, pts, 3 * SS, 1, (255, 255, 255, 255))
    elif shape == "drops":
        for k in range(16):
            ang = k / 16 * 2 * math.pi + rnd[k]
            dist = R_ * (0.3 + 0.65 * rnd[k + 16]) * _ease(t)
            x, y = c + math.cos(ang) * dist, c + math.sin(ang) * dist + 120 * SS * t * t
            r = (16 + 14 * rnd[k + 32]) * SS * (1 - 0.5 * t)
            # Teardrop pointing back toward the centre (direction of travel).
            tail = (x - math.cos(ang) * r * 2.4, y - math.sin(ang) * r * 2.4)
            d.polygon([tail, (x + math.sin(ang) * r, y - math.cos(ang) * r), (x - math.sin(ang) * r, y + math.cos(ang) * r)], fill=_white(A))
            d.ellipse([x - r, y - r, x + r, y + r], fill=_white(A))
    elif shape == "petals":
        for k in range(22):
            ang = k / 22 * 2 * math.pi + t * 2.6 + rnd[k]
            dist = R_ * (0.15 + 0.8 * _ease(t) * rnd[k + 22])
            x, y = c + math.cos(ang) * dist, c + math.sin(ang) * dist
            r = 16 * SS
            petal = Image.new("RGBA", (int(r * 4), int(r * 4)), (0, 0, 0, 0))
            ImageDraw.Draw(petal).ellipse([r * 0.8, r * 1.4, r * 3.2, r * 2.6], fill=_white(A))
            petal = petal.rotate(math.degrees(ang + t * 6), resample=Image.BICUBIC)
            img.alpha_composite(petal, (int(x - r * 2), int(y - r * 2)))
    elif shape == "stars":
        for k in range(14):
            tk = (t - rnd[k] * 0.5) / 0.5
            if not 0 < tk <= 1: continue
            x = c + (rnd[k + 14] - 0.5) * R_ * 1.7
            y = c + (rnd[k + 28] - 0.5) * R_ * 1.7
            s = (20 + 26 * rnd[k + 42]) * SS * math.sin(math.pi * tk)
            d.polygon([(x, y - s), (x + s * 0.18, y - s * 0.18), (x + s, y), (x + s * 0.18, y + s * 0.18),
                       (x, y + s), (x - s * 0.18, y + s * 0.18), (x - s, y), (x - s * 0.18, y - s * 0.18)], fill=_white(1))
    elif shape == "sigil":
        draw_on = _ease(min(1, t * 2.2))
        rot = t * 60
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        for rr, w in ((R_ * 0.92, 7), (R_ * 0.78, 3), (R_ * 0.42, 5)):
            ld.arc([c - rr, c - rr, c + rr, c + rr], 0, 360 * draw_on, fill=_white(A), width=w * SS)
        for k in range(24):
            ang = k / 24 * 2 * math.pi
            if k / 24 > draw_on: break
            r0, r1 = R_ * 0.8, R_ * (0.9 if k % 3 else 0.97)
            ld.line([(c + math.cos(ang) * r0, c + math.sin(ang) * r0), (c + math.cos(ang) * r1, c + math.sin(ang) * r1)], fill=_white(A), width=3 * SS)
        for k in range(3):
            a0 = k / 3 * 2 * math.pi - math.pi / 2
            a1 = a0 + 2 * math.pi / 3
            p0 = (c + math.cos(a0) * R_ * 0.78, c + math.sin(a0) * R_ * 0.78)
            p1 = (c + math.cos(a1) * R_ * 0.78, c + math.sin(a1) * R_ * 0.78)
            if draw_on > 0.3: ld.line([p0, p1], fill=_white(A * 0.8), width=4 * SS)
        img.alpha_composite(lay.rotate(rot, resample=Image.BICUBIC, center=(c, c)))
    elif shape == "smoke":
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        for k in range(12):
            ang = k / 12 * 2 * math.pi + rnd[k]
            dist = R_ * 0.55 * _ease(t) * (0.5 + rnd[k + 12])
            x, y = c + math.cos(ang) * dist, c + math.sin(ang) * dist
            r = R_ * (0.22 + 0.2 * rnd[k + 24]) * (0.6 + 0.6 * t)
            ld.ellipse([x - r, y - r, x + r, y + r], fill=_white(A * 0.55))
        lay = lay.filter(ImageFilter.GaussianBlur(10 * SS))
        img.alpha_composite(lay)
        rr = R_ * 0.35 * (1 - 0.5 * t)
        core = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(core).ellipse([c - rr, c - rr, c + rr, c + rr], fill=_ink(A * 0.85))
        img.alpha_composite(core.filter(ImageFilter.GaussianBlur(8 * SS)))
    elif shape == "frames":
        for k in range(5):
            on = (f + k * 2) % 6 < 3 and t < 0.85
            if not on: continue
            w, h = R_ * 0.55, R_ * 0.4
            x = c + (k - 2) * w * 0.55 - w / 2
            y = c - h / 2 + (k % 2) * 40 * SS - 20 * SS
            d.rectangle([x, y, x + w, y + h], outline=_white(A), width=6 * SS)
            for hole in range(4):
                hx = x + 12 * SS + hole * (w - 24 * SS) / 3
                d.rectangle([hx - 5 * SS, y - 18 * SS, hx + 5 * SS, y - 8 * SS], fill=_white(A))
    elif shape == "wave":
        sweep = _ease(t)
        for k in range(3):
            pts = []
            for s in np.linspace(0, 1, 40):
                x = c - R_ + 2 * R_ * s
                y = c + math.sin(s * math.pi * 2 + t * 6 + k) * R_ * 0.25 * (1 - k * 0.25) + (k - 1) * 36 * SS
                if s <= sweep: pts.append((x, y))
            if len(pts) > 2: _stroke(d, pts, 3, (20 - k * 5) * SS, _white(A * (1 - k * 0.2)))
    return ink_finish(img).resize((S, S), Image.LANCZOS)


def ink_finish(img):
    """Sealed Ink look: a black ink rim under every white mark, and a soft white bloom under that.
    White takes the technique colour when Sequencer tints it; the ink rim stays black."""
    alpha = img.getchannel("A")
    if not alpha.getbbox():
        return img
    rim = alpha.filter(ImageFilter.MaxFilter(7 * SS - 1)).point(lambda v: int(v * 0.75))
    glow = alpha.filter(ImageFilter.GaussianBlur(9 * SS)).point(lambda v: int(v * 0.55))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(Image.merge("RGBA", (*[Image.new("L", img.size, 255)] * 3, glow)))
    out.alpha_composite(Image.merge("RGBA", (*[Image.new("L", img.size, 8)] * 3, rim)))
    out.alpha_composite(img)
    return out


def build_effects():
    total = 0
    for i, shape in enumerate(R.SHAPES):
        rnd = np.random.default_rng(500 + i).uniform(0, 1, 80)
        tmp = tempfile.mkdtemp()
        try:
            for f in range(FRAMES):
                frame_shape(shape, f, rnd).save(os.path.join(tmp, f"f{f:03d}.png"))
            out = os.path.join(ROOT, "effects", f"{shape}.webm")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(tmp, "f%03d.png"),
                            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "36", "-auto-alt-ref", "0",
                            "-row-mt", "1", out], check=True)
            if os.environ.get("FX_STILLS"):  # previews for review, kept out of the module
                frame_shape(shape, FRAMES // 3 - 1, rnd).save(os.path.join(os.environ["FX_STILLS"], f"{shape}.png"))
            total += os.path.getsize(out)
        finally:
            shutil.rmtree(tmp)
    print(f"effects: {len(R.SHAPES)} webm, {total / 1024:.0f} KiB")


# ------------------------------------------------------------------ seamless domain backdrops
T = 512


def wrap_noise(seed, scale=8, octaves=4):
    """Exactly periodic noise: sum of sinusoids with integer frequencies."""
    rnd = np.random.default_rng(seed)
    y, x = np.mgrid[0:T, 0:T] / T * 2 * np.pi
    out = np.zeros((T, T))
    for o in range(octaves):
        for _ in range(10):
            fx, fy = rnd.integers(-scale * 2 ** o, scale * 2 ** o + 1, 2)
            if fx == 0 and fy == 0: continue
            out += np.sin(fx * x + fy * y + rnd.uniform(0, 6.28)) / (2 ** o)
    out -= out.min()
    return out / (out.max() + 1e-9)


def colorize(v, stops):
    """stops: [(pos, (r,g,b)), …] → RGB array."""
    pos = np.array([p for p, _ in stops])
    cols = np.array([c for _, c in stops], dtype=np.float64)
    out = np.zeros(v.shape + (3,))
    for ch in range(3):
        out[..., ch] = np.interp(v, pos, cols[:, ch])
    return out


def wrapped_draw(img, fn):
    """Call fn(draw, dx, dy) for the 9 tile offsets so shapes cross edges seamlessly."""
    d = ImageDraw.Draw(img, "RGBA")
    for dx in (-T, 0, T):
        for dy in (-T, 0, T):
            fn(d, dx, dy)


def backdrop(name):
    rnd = np.random.default_rng(abs(hash(name)) % 2 ** 32)
    n1, n2 = wrap_noise(11 + len(name), 3, 4), wrap_noise(23 + len(name), 6, 3)
    if name == "void":
        base = colorize(n1 * 0.7 + n2 * 0.3, [(0, (4, 3, 14)), (0.55, (18, 10, 46)), (0.8, (58, 30, 110)), (1, (150, 120, 230))])
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
        def stars(d, dx, dy):
            r2 = np.random.default_rng(3)
            for _ in range(260):
                x, y, s = r2.uniform(0, T), r2.uniform(0, T), r2.choice([1, 1, 1, 2, 3])
                a = int(r2.uniform(90, 255))
                d.ellipse([x + dx - s / 2, y + dy - s / 2, x + dx + s / 2, y + dy + s / 2], fill=(235, 230, 255, a))
        wrapped_draw(img, stars)
    elif name == "shrine":
        grain = wrap_noise(5, 1, 1)
        y = np.mgrid[0:T, 0:T][0] / T
        boards = (np.sin(y * 2 * np.pi * 8) > 0.96).astype(float)
        v = n2 * 0.5 + grain * 0.3
        base = colorize(v, [(0, (30, 8, 10)), (0.6, (70, 16, 18)), (1, (120, 32, 30))]) * (1 - boards[..., None] * 0.6)
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
        # Dark pools on the shrine floor and fine cut marks across the boards.
        pools = np.clip((wrap_noise(31, 2, 2) - 0.6) / 0.3, 0, 1)
        arr = np.asarray(img, dtype=np.float64)
        arr[..., :3] *= (1 - pools[..., None] * 0.7)
        img = Image.fromarray(arr.astype(np.uint8), "RGBA")
        def cuts(d, dx, dy):
            r2 = np.random.default_rng(9)
            for _ in range(22):
                x, y0, a = r2.uniform(0, T), r2.uniform(0, T), r2.uniform(-0.5, 0.5)
                L = r2.uniform(30, 90)
                d.line([(x + dx, y0 + dy), (x + dx + math.cos(a) * L, y0 + dy + math.sin(a) * L)], fill=(230, 190, 170, 45), width=1)
        wrapped_draw(img, cuts)
    elif name == "abyss":
        base = colorize(n1 ** 1.6, [(0, (2, 2, 6)), (0.5, (14, 10, 26)), (1, (60, 40, 90))])
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
        def eyes(d, dx, dy):
            r2 = np.random.default_rng(4)
            for _ in range(10):
                x, y = r2.uniform(0, T), r2.uniform(0, T)
                d.ellipse([x + dx - 5, y + dy - 2, x + dx + 5, y + dy + 2], fill=(200, 60, 90, 120))
        wrapped_draw(img, eyes)
    elif name == "sea":
        yy, xx = np.mgrid[0:T, 0:T] / T * 2 * np.pi
        waves = (np.sin(yy * 6 + np.sin(xx * 2) * 1.2 + n2 * 3) + 1) / 2
        base = colorize(waves * 0.6 + n1 * 0.4, [(0, (6, 30, 60)), (0.5, (16, 80, 130)), (0.85, (60, 160, 200)), (1, (220, 240, 245))])
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
    elif name == "garden":
        base = colorize(n1 * 0.6 + n2 * 0.4, [(0, (12, 34, 18)), (0.6, (30, 80, 40)), (1, (90, 150, 80))])
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
        def flowers(d, dx, dy):
            r2 = np.random.default_rng(6)
            for _ in range(60):
                x, y, s = r2.uniform(0, T), r2.uniform(0, T), r2.uniform(3, 7)
                col = [(240, 190, 220, 200), (255, 240, 200, 200), (200, 170, 255, 200)][r2.integers(0, 3)]
                for k in range(5):
                    a = k / 5 * 2 * math.pi
                    px, py = x + math.cos(a) * s, y + math.sin(a) * s
                    d.ellipse([px + dx - s * 0.7, py + dy - s * 0.7, px + dx + s * 0.7, py + dy + s * 0.7], fill=col)
                d.ellipse([x + dx - 2, y + dy - 2, x + dx + 2, y + dy + 2], fill=(250, 210, 80, 230))
        wrapped_draw(img, flowers)
    elif name == "volcano":
        cracks = np.abs(n2 - 0.5) < 0.03
        base = colorize(n1, [(0, (18, 10, 8)), (0.6, (45, 22, 16)), (1, (80, 40, 26))])
        base[cracks] = [255, 120, 30]
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA").filter(ImageFilter.GaussianBlur(0.8))
    elif name == "storm":
        base = colorize(n1 * 0.7 + n2 * 0.3, [(0, (20, 24, 34)), (0.6, (60, 70, 90)), (1, (170, 180, 200))])
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
    elif name == "ink":
        # Ink wash on paper: soft-edged pools of graded ink, fibres in the paper, a few dry-brush strokes.
        paper = colorize(n2, [(0, (214, 204, 184)), (1, (238, 230, 212))])
        wash = np.clip((n1 - 0.5) / 0.3, 0, 1) ** 1.5
        fibre = wrap_noise(77, 24, 2)
        ink = colorize(fibre, [(0, (14, 10, 14)), (1, (52, 44, 50))])
        base = paper * (1 - wash[..., None] * 0.9) + ink * wash[..., None] * 0.9
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
        def brush(d, dx, dy):
            r2 = np.random.default_rng(12)
            for _ in range(9):
                x, y, a = r2.uniform(0, T), r2.uniform(0, T), r2.uniform(0, math.pi)
                for k in range(26):
                    w = 10 * (1 - k / 26) + 1
                    px, py = x + math.cos(a) * k * 6, y + math.sin(a) * k * 6 + math.sin(k / 4) * 6
                    d.ellipse([px + dx - w, py + dy - w, px + dx + w, py + dy + w], fill=(16, 12, 16, 70))
        wrapped_draw(img, brush)
    elif name == "mirror":
        base = colorize(n1, [(0, (30, 34, 48)), (1, (120, 130, 160))])
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
        def shards(d, dx, dy):
            r2 = np.random.default_rng(7)
            for _ in range(26):
                x, y = r2.uniform(0, T), r2.uniform(0, T)
                pts = [(x + dx + r2.uniform(-50, 50), y + dy + r2.uniform(-50, 50)) for _ in range(3)]
                d.polygon(pts, fill=(200, 210, 240, 40), outline=(235, 240, 255, 140))
        wrapped_draw(img, shards)
    elif name == "temple":
        yy, xx = np.mgrid[0:T, 0:T] / T * 2 * np.pi
        tiles = ((np.sin(xx * 8) > 0.92) | (np.sin(yy * 8) > 0.92)).astype(float)
        base = colorize(n1 * 0.6 + n2 * 0.4, [(0, (60, 36, 14)), (0.7, (130, 90, 34)), (1, (220, 170, 80))])
        base *= (1 - tiles[..., None] * 0.45)
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
    elif name == "ice":
        cracks = np.abs(n2 - 0.5) < 0.012
        base = colorize(n1, [(0, (120, 170, 200)), (0.7, (190, 225, 240)), (1, (245, 252, 255))])
        base[cracks] = [255, 255, 255]
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
    elif name == "circuit":
        base = colorize(n1 * 0.4, [(0, (6, 18, 20)), (1, (20, 50, 54))])
        img = Image.fromarray(base.astype(np.uint8)).convert("RGBA")
        def traces(d, dx, dy):
            r2 = np.random.default_rng(8)
            for _ in range(40):
                x, y = r2.integers(0, 16) * 32 + 16, r2.integers(0, 16) * 32 + 16
                for _ in range(4):
                    nx, ny = x + r2.choice([-64, 0, 64]), y + r2.choice([-64, 0, 64])
                    d.line([(x + dx, y + dy), (nx + dx, y + dy), (nx + dx, ny + dy)], fill=(56, 224, 200, 150), width=2)
                    x, y = nx, ny
                d.ellipse([x + dx - 4, y + dy - 4, x + dx + 4, y + dy + 4], fill=(120, 255, 230, 200))
        wrapped_draw(img, traces)
    else:
        raise ValueError(name)
    return img.convert("RGB")


def build_textures():
    out_dir = os.path.join(ROOT, "textures", "domains")
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for name in R.BACKDROPS:
        img = backdrop(name)
        # Seam check: crossing the tile edge must not change more than crossing any interior row/column.
        a = np.asarray(img, dtype=np.float64)
        inner = max(np.abs(np.diff(a, axis=0)).mean(), np.abs(np.diff(a, axis=1)).mean())
        seam = max(np.abs(a[0] - a[-1]).mean(), np.abs(a[:, 0] - a[:, -1]).mean())
        assert seam < inner * 4 + 3, f"{name}: visible seam ({seam:.1f} vs {inner:.1f})"
        p = os.path.join(out_dir, f"{name}.webp")
        img.save(p, "WEBP", quality=82, method=6)
        total += os.path.getsize(p)
    print(f"textures: {len(R.BACKDROPS)} webp, {total / 1024:.0f} KiB")


# ------------------------------------------------------------------ JS table
def build_table():
    techs = {}
    for name, d in sorted(R.TECHNIQUES.items()):
        bd = R.BACKDROP_ALIAS.get(d["backdrop"], d["backdrop"])
        assert bd in R.BACKDROPS, (name, bd)
        assert d["shape"] in R.SHAPES, (name, d["shape"])
        techs[name] = {"color": d["color"], "shape": d["shape"], "sound": slug(name), "backdrop": bd}
    body = {
        "techniques": techs,
        "familyShape": R.FAMILY_SHAPE,
        "familyImpact": sorted(R.FAMILY_IMPACT),
        "events": sorted(R.EVENTS),
        "shapes": R.SHAPES,
        "backdrops": R.BACKDROPS,
    }
    js = ("// Generated by tools/build-fx.py from tools/fx_recipes.py — do not edit by hand.\n"
          f"export const FX_TABLE = {json.dumps(body, ensure_ascii=False, indent=1)};\n")
    with open(os.path.join(ROOT, "scripts", "jjk-fx-table.mjs"), "w", encoding="utf-8") as fh:
        fh.write(js)
    print(f"table: {len(techs)} techniques")


if __name__ == "__main__":
    args = set(sys.argv[1:]) or {"--sounds", "--effects", "--textures", "--table"}
    if "--table" in args: build_table()
    if "--sounds" in args: build_sounds()
    if "--effects" in args: build_effects()
    if "--textures" in args: build_textures()
