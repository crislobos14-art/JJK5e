"""Small procedural synthesiser for JJK5e sound effects.

Every sound in sounds/ is generated here from code: no recorded or third-party audio is used.
Each primitive returns a mono float32 array at SR; recipes in build-fx.py mix them.
"""
import numpy as np
from scipy import signal

SR = 44100


def rng(seed):
    return np.random.default_rng(seed)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


# ---------------------------------------------------------------- envelopes
def env_exp(dur, decay=6.0, attack=0.004):
    t = t_axis(dur)
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-decay * t)


def env_bell(dur, peak=0.5, sharp=2.0):
    """Swell that peaks at `peak` (0..1 of dur) and falls back to zero."""
    t = t_axis(dur) / max(dur, 1e-6)
    up = np.clip(t / peak, 0, 1) ** sharp
    down = np.clip((1 - t) / (1 - peak), 0, 1) ** sharp
    return np.minimum(up, down)


def env_adsr(dur, a=0.01, d=0.1, s=0.6, r=0.2):
    n = int(dur * SR)
    e = np.full(n, s, dtype=np.float64)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nd: e[na:na + nd] = np.linspace(1, s, len(e[na:na + nd]))
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e


# ---------------------------------------------------------------- sources
def noise(dur, color="white", seed=0):
    r = rng(seed)
    n = int(dur * SR)
    w = r.standard_normal(n)
    if color == "white":
        return w
    spec = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1] if len(f) > 1 else 1
    spec /= {"pink": np.sqrt(f), "brown": f}[color]
    out = np.fft.irfft(spec, n)
    return out / (np.max(np.abs(out)) + 1e-9)


def osc(freq, dur, wave="sine", phase=0.0):
    """freq: number or array (Hz per sample)."""
    n = int(dur * SR)
    f = np.full(n, freq, dtype=np.float64) if np.isscalar(freq) else np.asarray(freq, dtype=np.float64)[:n]
    ph = 2 * np.pi * np.cumsum(f) / SR + phase
    if wave == "sine": return np.sin(ph)
    if wave == "saw": return 2 * ((ph / (2 * np.pi)) % 1) - 1
    if wave == "square": return np.sign(np.sin(ph))
    if wave == "tri": return 2 * np.abs(2 * ((ph / (2 * np.pi)) % 1) - 1) - 1
    raise ValueError(wave)


def glide(f0, f1, dur, curve="exp"):
    t = t_axis(dur) / max(dur, 1e-6)
    if curve == "exp" and f0 > 0 and f1 > 0:
        return f0 * (f1 / f0) ** t
    return f0 + (f1 - f0) * t


def fm(fc, fm_, index, dur, wave="sine"):
    n = int(dur * SR)
    mod = np.sin(2 * np.pi * np.cumsum(np.full(n, fm_) if np.isscalar(fm_) else fm_[:n]) / SR)
    idx = index if np.isscalar(index) else np.asarray(index)[:n]
    base = np.full(n, fc) if np.isscalar(fc) else np.asarray(fc)[:n]
    return osc(base + idx * fm_ * mod if np.isscalar(fm_) else base + idx * np.asarray(fm_)[:n] * mod, dur, wave)


# ---------------------------------------------------------------- filters
def _sos(kind, f, order=4):
    nyq = SR / 2
    if kind == "bp":
        lo, hi = max(20, f[0]), min(nyq * 0.98, f[1])
        return signal.butter(order, [lo / nyq, hi / nyq], "band", output="sos")
    return signal.butter(order, min(f, nyq * 0.98) / nyq, {"lp": "low", "hp": "high"}[kind], output="sos")


def lp(x, f, order=4): return signal.sosfilt(_sos("lp", f, order), x)
def hp(x, f, order=4): return signal.sosfilt(_sos("hp", f, order), x)
def bp(x, lo, hi, order=2): return signal.sosfilt(_sos("bp", (lo, hi), order), x)


def sweep_bp(x, f0, f1, q=4.0, steps=48):
    """Band-pass whose centre glides from f0 to f1 (block-wise, overlap-added)."""
    n = len(x)
    out = np.zeros(n)
    hop = max(1, n // steps)
    win = np.hanning(hop * 2)
    for i in range(0, n, hop):
        seg = x[max(0, i - hop):i + hop]
        k = i / max(n - 1, 1)
        fc = f0 * (f1 / f0) ** k if f0 > 0 and f1 > 0 else f0 + (f1 - f0) * k
        bw = fc / q
        y = bp(seg, max(30, fc - bw / 2), fc + bw / 2, 2)
        w = win[:len(y)] if len(y) == len(win) else np.hanning(len(y))
        start = max(0, i - hop)
        out[start:start + len(y)] += y * w
    return out


def sweep_lp(x, f0, f1, steps=48):
    n = len(x)
    out = np.zeros(n)
    hop = max(1, n // steps)
    for i in range(0, n, hop):
        seg = x[max(0, i - hop):i + hop]
        k = i / max(n - 1, 1)
        fc = f0 * (f1 / f0) ** k
        y = lp(seg, fc, 2)
        w = np.hanning(len(y))
        start = max(0, i - hop)
        out[start:start + len(y)] += y * w
    return out


# ---------------------------------------------------------------- effects
def reverb(x, size=1.2, wet=0.3, damp=4000, seed=7):
    n = int(size * SR)
    ir = noise(size, "white", seed) * np.exp(-np.linspace(0, 7, n))
    ir = lp(ir, damp, 2)
    ir[0] = 0
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    y = signal.fftconvolve(np.concatenate([x, np.zeros(n)]), ir)[:len(x) + n]
    dry = np.concatenate([x, np.zeros(n)])
    return dry * (1 - wet) + y * wet * 2.0


def echo(x, delay=0.18, fb=0.45, taps=4):
    d = int(delay * SR)
    out = np.concatenate([x, np.zeros(d * taps)])
    for k in range(1, taps + 1):
        out[d * k:d * k + len(x)] += x * (fb ** k)
    return out


def bitcrush(x, bits=6, hold=4):
    q = 2 ** bits
    y = np.round(x * q) / q
    return np.repeat(y[::hold], hold)[:len(x)]


def stutter(x, slice_s=0.04, repeats=3):
    s = int(slice_s * SR)
    parts = []
    for i in range(0, len(x), s * repeats):
        seg = x[i:i + s]
        parts.extend([seg] * repeats)
    return np.concatenate(parts)[:len(x) * 2]


def reverse(x): return x[::-1].copy()


def drive(x, amount=3.0): return np.tanh(x * amount) / np.tanh(amount)


def tremolo(x, rate=8, depth=0.5):
    t = np.arange(len(x)) / SR
    return x * (1 - depth / 2 + depth / 2 * np.sin(2 * np.pi * rate * t))


# ---------------------------------------------------------------- building blocks
def thump(f0=90, f1=38, dur=0.6, decay=7, seed=0):
    """Sub impact: pitch-dropping sine with a short click."""
    body = osc(glide(f0, f1, dur), dur) * env_exp(dur, decay, 0.002)
    click = hp(noise(0.012, seed=seed), 1500) * np.linspace(1, 0, int(0.012 * SR))
    body[:len(click)] += click * 0.6
    return body


def crack(dur=0.35, bright=3000, seed=1):
    n = noise(dur, seed=seed)
    return hp(n, bright) * env_exp(dur, 18, 0.0008)


def whoosh(dur=0.6, f0=400, f1=2400, q=2.5, seed=2):
    return sweep_bp(noise(dur, "pink", seed), f0, f1, q) * env_bell(dur, 0.55, 1.6)


def shing(base=1800, dur=1.0, seed=3, partials=(1, 2.76, 5.4, 8.93)):
    """Metallic ring: inharmonic partials with fast attack."""
    r = rng(seed)
    out = np.zeros(int(dur * SR))
    for i, p in enumerate(partials):
        out += osc(base * p * (1 + r.uniform(-0.004, 0.004)), dur) * env_exp(dur, 3 + i * 2.5, 0.001) / (1 + i)
    return out + hp(noise(dur, seed=seed), 6000) * env_exp(dur, 30, 0.0005) * 0.4


def bell(freq, dur=1.6, bright=1.0):
    parts = [(1, 1), (2.0, 0.5 * bright), (2.99, 0.35 * bright), (4.2, 0.2 * bright), (5.4, 0.12 * bright)]
    return sum(osc(freq * m, dur) * env_exp(dur, 2.2 + m, 0.002) * a for m, a in parts)


def clap(seed=4, bursts=3, spacing=0.011, tail=0.25):
    dur = spacing * bursts + tail
    out = np.zeros(int(dur * SR))
    r = rng(seed)
    for k in range(bursts):
        b = bp(noise(0.02 + tail * (k == bursts - 1), seed=seed + k), 900, 2600) * env_exp(0.02 + tail * (k == bursts - 1), 40 if k < bursts - 1 else 22, 0.0005)
        i = int(k * spacing * SR + r.uniform(0, 0.002) * SR)
        out[i:i + len(b)] += b[:len(out) - i]
    return out


def crackle(dur=1.0, density=60, bright=2500, seed=5):
    r = rng(seed)
    out = np.zeros(int(dur * SR))
    for _ in range(int(density * dur)):
        i = r.integers(0, len(out) - 200)
        out[i:i + 60] += r.standard_normal(60) * np.exp(-np.arange(60) / 12) * r.uniform(0.3, 1)
    return hp(out, bright)


def zap(dur=0.5, f0=1800, f1=120, seed=6):
    r = rng(seed)
    jitter = np.repeat(r.uniform(0.6, 1.4, int(dur * 400) + 1), SR // 400 + 1)[:int(dur * SR)]
    tone = osc(glide(f0, f1, dur) * jitter, dur, "square")
    return lp(tone, 6000) * env_exp(dur, 5, 0.001) + crackle(dur, 120, 3500, seed) * 0.6


def rumble(dur=1.5, cutoff=140, seed=8):
    n = noise(dur, "brown", seed)
    return lp(n, cutoff) * env_bell(dur, 0.35, 1.2)


def drip(freq=900, dur=0.18, rise=2.2):
    """Water drop 'bloop': fast upward sine chirp."""
    return osc(glide(freq, freq * rise, dur), dur) * env_exp(dur, 22, 0.002)


def buzz(dur=1.0, base=190, voices=9, seed=9):
    r = rng(seed)
    out = np.zeros(int(dur * SR))
    for _ in range(voices):
        f = base * r.uniform(0.85, 1.25)
        am = 0.6 + 0.4 * np.sin(2 * np.pi * r.uniform(15, 40) * t_axis(dur) + r.uniform(0, 6))
        out += osc(f + 6 * np.sin(2 * np.pi * r.uniform(3, 9) * t_axis(dur)), dur, "saw") * am
    return bp(out / voices, 250, 3500)


def formant_voice(f0=110, dur=0.9, vowel="o", seed=10, glide_to=None):
    """Synthetic vowel (not a recording): saw source through three formant bands."""
    F = {"a": (800, 1150, 2900), "o": (450, 800, 2830), "u": (325, 700, 2530), "e": (400, 1700, 2600), "i": (290, 1870, 2800)}[vowel]
    pitch = glide(f0, glide_to or f0 * 0.92, dur)
    vib = 1 + 0.012 * np.sin(2 * np.pi * 5.2 * t_axis(dur))
    src = osc(pitch * vib, dur, "saw") + 0.04 * noise(dur, seed=seed)
    out = sum(bp(src, f * 0.9, f * 1.1, 2) * g for f, g in zip(F, (1.0, 0.6, 0.25)))
    return out * env_adsr(dur, 0.04, 0.1, 0.8, 0.25)


def tick(freq=3200, dur=0.03):
    return osc(freq, dur) * env_exp(dur, 120, 0.0003) + hp(noise(dur), 4000) * env_exp(dur, 200, 0.0002) * 0.5


def heartbeat(bpm=70, beats=2):
    gap = 60 / bpm
    dur = gap * beats + 0.4
    out = np.zeros(int(dur * SR))
    for b in range(beats):
        for off, g in ((0, 1.0), (0.18, 0.7)):
            th = thump(70, 42, 0.25, 14)
            i = int((b * gap + off) * SR)
            out[i:i + len(th)] += th * g
    return out


def pad(freqs, dur=2.0, detune=0.006, wave="saw", cutoff=2200):
    out = np.zeros(int(dur * SR))
    for f in freqs:
        for d in (-detune, 0, detune):
            out += osc(f * (1 + d), dur, wave)
    return lp(out / (len(freqs) * 3), cutoff) * env_adsr(dur, 0.25, 0.2, 0.8, 0.6)


def caw(dur=0.45, f0=900, seed=11):
    src = osc(glide(f0, f0 * 0.7, dur) * (1 + 0.05 * np.sin(2 * np.pi * 35 * t_axis(dur))), dur, "saw")
    src = drive(src + 0.3 * noise(dur, seed=seed), 2.5)
    return bp(src, 700, 2600) * env_adsr(dur, 0.01, 0.05, 0.7, 0.15)


def coins(dur=0.9, count=7, seed=12):
    r = rng(seed)
    out = np.zeros(int(dur * SR))
    for _ in range(count):
        b = shing(r.uniform(2800, 5200), 0.35, int(r.integers(0, 999)), (1, 2.3, 3.9)) * 0.5
        i = int(r.uniform(0, dur - 0.36) * SR)
        out[i:i + len(b)] += b
    return out


# ---------------------------------------------------------------- mix + export
def place(dst, src, at, gain=1.0):
    i = int(at * SR)
    need = i + len(src)
    if need > len(dst):
        dst = np.concatenate([dst, np.zeros(need - len(dst))])
    dst[i:i + len(src)] += src * gain
    return dst


def finish(x, peak_db=-1.5, fade=0.04, hp_hz=28):
    x = hp(np.asarray(x, dtype=np.float64), hp_hz, 2)
    # trim trailing near-silence
    thr = np.max(np.abs(x)) * 0.002
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx): x = x[:min(len(x), idx[-1] + int(0.05 * SR))]
    nf = min(len(x), int(fade * SR))
    if nf: x[-nf:] *= np.linspace(1, 0, nf)
    x[:64] *= np.linspace(0, 1, min(64, len(x)))
    # Even loudness: aim every sound at the same RMS over its loud part, then a soft limiter keeps the peaks.
    peak = np.max(np.abs(x)) + 1e-9
    x = x / peak
    loud = np.sort(np.abs(x))[int(len(x) * 0.5):]
    rms = float(np.sqrt(np.mean(loud ** 2))) + 1e-9
    gain = min(6.0, 0.22 / rms)
    ceiling = 10 ** (peak_db / 20)
    x = np.tanh(x * gain / ceiling) * ceiling
    return x.astype(np.float32)


# ---------------------------------------------------------------- length-tolerant signals
class Sig(np.ndarray):
    """1-D signal whose + and - pad the shorter operand with silence (layers of different lengths mix)."""

    def _pad(self, other):
        if isinstance(other, np.ndarray) and other.ndim == 1 and self.ndim == 1 and len(other) != len(self):
            n = max(len(self), len(other))
            a = np.zeros(n); a[:len(self)] = self
            b = np.zeros(n); b[:len(other)] = other
            return a, b
        return np.asarray(self), other

    def __add__(self, o): a, b = self._pad(o); return np.add(a, b).view(Sig)
    def __radd__(self, o): a, b = self._pad(o); return np.add(b, a).view(Sig)
    def __sub__(self, o): a, b = self._pad(o); return np.subtract(a, b).view(Sig)


def _wrap(fn):
    def inner(*a, **k):
        r = fn(*a, **k)
        return r.view(Sig) if isinstance(r, np.ndarray) and r.ndim == 1 else r
    inner.__name__ = fn.__name__
    return inner


for _name, _fn in list(globals().items()):
    if callable(_fn) and getattr(_fn, "__module__", None) == __name__ and _name not in {"Sig", "_wrap", "rng", "t_axis", "finish", "_sos"} \
            and not isinstance(_fn, type):
        globals()[_name] = _wrap(_fn)
