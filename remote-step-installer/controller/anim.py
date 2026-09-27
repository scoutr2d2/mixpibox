#!/usr/bin/env python3
"""
remote-step-installer — bunte Live-Anzeige für Paket-Schritte (Pacman-Stil).

Eine Installation ist lange Wartezeit mit Textwand. Das hier macht daraus eine
lesbare, farbige Live-Zeile: **Pacman frisst sich durch die Pakete** (wie pacmans
`ILoveCandy`), daneben Phase (Holen/Entpacken/Einrichten) und das Paket, das
gerade dran ist. Wo apt/nala eine echte Paketzahl verrät, ist der Balken ECHTER
Fortschritt — sonst hüpft Pacman als Aktivitätsanzeige.

Design:
- **Pure Teile testbar** (`parse_line`, `Progress`, `PacBar.render`) — kein I/O.
- **TTY-Schutz**: ohne echtes Terminal (Pipe/Logfile/`--plain`) wird NICHT animiert
  und NICHT eingefärbt — Ausgabe bleibt exakt parsebar (rsi.py/LLM/Logs).
- Unicode mit ASCII-Fallback, `NO_COLOR`/`TERM=dumb` werden respektiert.
"""
import os
import re
import sys
import threading
import time

# ── Farben ──────────────────────────────────────────────────────────────────
A = {"pac": "\033[1;33m", "dot": "\033[36m", "candy": "\033[1;35m", "ghost": "\033[1;31m",
     "ok": "\033[1;32m", "err": "\033[1;31m", "warn": "\033[1;33m", "info": "\033[36m",
     "pkg": "\033[1;37m", "dim": "\033[2m", "0": "\033[0m"}

# ── Zeilen-Erkennung (apt UND nala; deutsch + englisch) ─────────────────────
RULES = [
    # „Get:1 http://host suite/comp arch PAKET VERSION [123 kB]" → das Paket vor der Version
    ("fetch",  re.compile(r"^\s*(?:Get|Holen|Hole):\d+\s+.*?\s(\S+)\s+\S+\s+\[", re.I)),
    ("fetch",  re.compile(r"^\s*(?:Get|Holen|Hole):\d+\s+\S+\s+\S+\s+\S+\s+(\S+)", re.I)),
    ("fetch",  re.compile(r"^\s*(?:Fetched|Es wurden)\s", re.I)),
    ("select", re.compile(r"^\s*(?:Selecting previously unselected package|Vormals nicht ausgew\S+hltes Paket)\s+(\S+?)[ .:]", re.I)),
    ("unpack", re.compile(r"^\s*(?:Unpacking|Entpacken von)\s+(\S+)", re.I)),
    ("config", re.compile(r"^\s*(?:Setting up|Einrichten von)\s+(\S+)", re.I)),
    ("trigger", re.compile(r"^\s*(?:Processing triggers for|Trigger f\S+r)\s+(\S+)", re.I)),
    ("error",  re.compile(r"^\s*(?:E:|Err:|Fehler:|error:)", re.I)),
    ("warn",   re.compile(r"^\s*(?:W:|WARNING:|Warnung:|warning:)", re.I)),
    ("info",   re.compile(r"^\s*(?:Reading package lists|Paketlisten werden gelesen|Building dependency|Abh\S+ngigkeitsbaum)", re.I)),
    ("done",   re.compile(r"^\s*(?:Hit|OK|Fertig|Done)\b", re.I)),
]
# „5 newly installed" / „5 neu installiert" → echte Gesamtzahl für den Balken
RE_TOTAL = re.compile(r"(\d+)\s+(?:newly installed|neu installiert)", re.I)
RE_PERCENT = re.compile(r"(?:Progress|Fortschritt)[^\d]*(\d{1,3})\s*%")

PHASE_LABEL = {"fetch": "Holen", "unpack": "Entpacken", "config": "Einrichten",
               "select": "Vorbereiten", "trigger": "Trigger", "info": "Lesen",
               "error": "Fehler", "warn": "Warnung", "done": "OK", "": "Läuft"}
LINE_COLOR = {"fetch": "info", "select": "dim", "unpack": "pkg", "config": "ok",
              "trigger": "dim", "error": "err", "warn": "warn", "info": "dim", "done": "dim"}


def parse_line(line):
    """→ {kind, pkg, total, percent} (alles optional). Pure."""
    out = {"kind": "", "pkg": "", "total": None, "percent": None}
    m = RE_TOTAL.search(line)
    if m:
        out["total"] = int(m.group(1))
    m = RE_PERCENT.search(line)
    if m:
        out["percent"] = max(0, min(100, int(m.group(1))))
    for kind, rx in RULES:
        m = rx.search(line)
        if m:
            out["kind"] = kind
            if m.groups():
                out["pkg"] = (m.group(1) or "").strip(" .:")
            break
    return out


class Progress:
    """Zählt aus dem Paketmanager-Output einen echten Fortschritt. Pure."""

    def __init__(self):
        self.total = None        # erwartete Paketzahl (aus „N newly installed")
        self.unpacked = 0
        self.configured = 0
        self.fetched = 0
        self.phase = ""
        self.pkg = ""
        self.percent = None      # explizit gemeldeter Prozentwert

    def feed(self, line):
        p = parse_line(line)
        if p["total"] is not None:
            self.total = p["total"]
        if p["percent"] is not None:
            self.percent = p["percent"]
        k = p["kind"]
        if k == "fetch":
            self.fetched += 1
        elif k == "unpack":
            self.unpacked += 1
        elif k == "config":
            self.configured += 1
        if k in ("fetch", "unpack", "config", "select", "trigger"):
            self.phase = k
            if p["pkg"]:
                self.pkg = p["pkg"]
        elif k and not self.phase:
            self.phase = k
        return p

    def ratio(self):
        """0..1 oder None (unbestimmt → Pacman hüpft)."""
        if self.percent is not None:
            return self.percent / 100.0
        if self.total:
            # Entpacken = erste Hälfte, Einrichten = zweite
            done = min(self.unpacked, self.total) * 0.5 + min(self.configured, self.total) * 0.5
            return max(0.0, min(1.0, done / self.total))
        return None

    def label(self):
        return PHASE_LABEL.get(self.phase, PHASE_LABEL[""])


class PacBar:
    """Pacman frisst sich durch die Punkte. Pure: render() gibt nur einen String."""

    def __init__(self, width=26, unicode=True, color=True, candy=True):
        self.width = max(8, width)
        self.u = unicode
        self.color = color
        self.candy = candy
        self.pac_r = ["ᗧ", "ᗤ"] if unicode else ["C", "c"]   # rechts: offen/zu
        self.pac_l = ["ᗨ", "ᗢ"] if unicode else [">", "c"]   # links (Rückweg)
        self.dot = "·" if unicode else "."
        self.pellet = "●" if unicode else "o"
        self.ghost = "ᗣ" if unicode else "M"

    def _c(self, key, s):
        return f"{A[key]}{s}{A['0']}" if self.color else s

    def render(self, ratio=None, tick=0):
        w = self.width
        if ratio is None:                       # unbestimmt: hin und her
            span = 2 * (w - 1) or 1
            t = tick % span
            pos = t if t < w else span - t
            back = t >= w
        else:
            pos = int(max(0.0, min(1.0, ratio)) * (w - 1))
            back = False
        mouth = tick % 2                        # Mund auf/zu
        pac = (self.pac_l if back else self.pac_r)[mouth]

        cells = []
        for i in range(w):
            if i == pos:
                cells.append(self._c("pac", pac))
            elif (i < pos) != back:             # gefressen (auf dem Rückweg andersrum)
                cells.append(" ")
            elif self.candy and i % 7 == 3:
                cells.append(self._c("candy", self.pellet))
            else:
                cells.append(self._c("dot", self.dot))
        # ein Geist jagt mit, wenn Platz ist (nur Deko)
        if self.candy and w > 12:
            g = (pos + 4) % w
            if g != pos and cells[g] != " ":
                cells[g] = self._c("ghost", self.ghost)
        return "[" + "".join(cells) + "]"


# ── Terminal-Erkennung ──────────────────────────────────────────────────────
def supports_anim(stream=None, force=None):
    """Nur animieren, wenn ein echtes Terminal dranhängt — sonst bleibt die
    Ausgabe roh + parsebar (rsi.py/LLM/Logs)."""
    if force is not None:
        return bool(force)
    s = stream or sys.stdout
    if not hasattr(s, "isatty") or not s.isatty():
        return False
    if os.environ.get("NO_COLOR") or os.environ.get("TERM", "") in ("", "dumb"):
        return False
    return True


def _unicode_ok():
    enc = (getattr(sys.stdout, "encoding", "") or "").lower()
    return "utf" in enc


class Animator:
    """Live-Zeile unter dem Output: Pacman + Phase + aktuelles Paket.

    Nutzung:
        an = Animator("Node installieren"); an.start()
        ...  an.line(text)  pro Ausgabezeile  ...
        an.stop(ok=True)
    Ohne TTY (oder plain=True) druckt `line()` einfach unverändert weiter.
    """

    def __init__(self, title="", stream=None, plain=False, width=26, indent="  "):
        self.title = title
        self.out = stream or sys.stdout
        self.indent = indent
        self.anim = supports_anim(self.out, force=(False if plain else None))
        self.bar = PacBar(width=width, unicode=_unicode_ok(), color=self.anim)
        self.prog = Progress()
        self.tick = 0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._shown = False
        self.t0 = time.time()

    # -- intern ------------------------------------------------------------
    def _status(self):
        r = self.prog.ratio()
        pct = f"{int(r * 100):3d}%" if r is not None else " ~ "
        pkg = self.prog.pkg[:26]
        secs = int(time.time() - self.t0)
        parts = [self.indent, self.bar.render(r, self.tick), " ",
                 f"{A['dim']}{self.prog.label():<11}{A['0']}" if self.anim else f"{self.prog.label():<11}",
                 f"{A['pkg']}{pkg:<26}{A['0']}" if self.anim else f"{pkg:<26}",
                 f"{A['dim']}{pct}  {secs//60:d}:{secs%60:02d}{A['0']}" if self.anim else f"{pct}  {secs//60:d}:{secs%60:02d}"]
        return "".join(parts)

    def _clear(self):
        if self._shown:
            self.out.write("\r\033[K")
            self._shown = False

    def _draw(self):
        self.out.write("\r\033[K" + self._status())
        self.out.flush()
        self._shown = True

    def _ticker(self):
        while not self._stop.wait(0.13):
            with self._lock:
                self.tick += 1
                self._draw()

    # -- API ---------------------------------------------------------------
    def start(self):
        if not self.anim:
            return self
        self._thread = threading.Thread(target=self._ticker, daemon=True)
        self._thread.start()
        return self

    def line(self, text):
        """Eine Ausgabezeile der Box verarbeiten + drucken."""
        p = self.prog.feed(text)
        if not self.anim:
            self.out.write(self.indent + text + "\n")
            self.out.flush()
            return
        with self._lock:
            self._clear()
            col = LINE_COLOR.get(p["kind"], "")
            self.out.write(self.indent + (f"{A[col]}{text}{A['0']}" if col else text) + "\n")
            self._draw()

    def stop(self, ok=None, note=""):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=0.5)
        if not self.anim:
            return
        with self._lock:
            self._clear()
            if ok is not None:
                secs = int(time.time() - self.t0)
                mark = f"{A['ok']}✓{A['0']}" if ok else f"{A['err']}✗{A['0']}"
                dur = f"{A['dim']}({secs//60:d}:{secs%60:02d}){A['0']}"
                extra = f"  {note}" if note else ""
                n = self.prog.configured or self.prog.unpacked or self.prog.fetched
                pk = f"{A['dim']} · {n} Pakete{A['0']}" if n else ""
                self.out.write(f"{self.indent}{mark} {self.title}{pk} {dur}{extra}\n")
            self.out.flush()


if __name__ == "__main__":          # kleine Vorschau: python3 anim.py
    demo = ["Reading package lists...", "Building dependency tree...",
            "The following NEW packages will be installed:", "  nodejs npm libuv1",
            "0 upgraded, 3 newly installed, 0 to remove.",
            "Get:1 http://deb.debian.org trixie/main arm64 libuv1 1.48 [140 kB]",
            "Get:2 http://deb.debian.org trixie/main arm64 nodejs 24.4.0 [12.4 MB]",
            "Get:3 http://deb.debian.org trixie/main arm64 npm 10.9 [2.1 MB]",
            "Fetched 14.6 MB in 2s (7,3 MB/s)",
            "Selecting previously unselected package libuv1.", "Unpacking libuv1 (1.48) ...",
            "Unpacking nodejs (24.4.0) ...", "Unpacking npm (10.9) ...",
            "Setting up libuv1 (1.48) ...", "Setting up nodejs (24.4.0) ...",
            "Setting up npm (10.9) ...", "Processing triggers for man-db ..."]
    a = Animator("Node.js installieren").start()
    for ln in demo:
        a.line(ln)
        time.sleep(0.45)
    a.stop(ok=True)
