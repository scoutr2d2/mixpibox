#!/usr/bin/env python3
"""
Tests für die bunte Live-Anzeige (controller/anim.py) — pure Teile + TTY-Schutz.

Der TTY-Schutz ist der wichtigste Test: ohne echtes Terminal (Pipe/Logfile) darf
NICHTS animiert oder eingefärbt werden, sonst wird die Ausgabe unparsebar (rsi.py,
LLM-Diagnose, Logs).

  python3 tests/anim_test.py       # exit 0 = alles gruen
"""
import io
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "controller"))
import anim  # noqa: E402

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


# ── Zeilen-Erkennung (apt + nala, deutsch + englisch) ───────────────────────
chk("Get: → fetch + Paketname (nicht die Architektur)",
    anim.parse_line("Get:1 http://deb.debian.org trixie/main arm64 libuv1 1.48 [140 kB]")["pkg"] == "libuv1")
chk("Holen: (deutsch) erkannt",
    anim.parse_line("Holen:3 http://deb.debian.org trixie/main arm64 npm 10.9 [2.1 MB]")["pkg"] == "npm")
p = anim.parse_line("Unpacking nodejs (24.4.0) ...")
chk("Unpacking → kind+Paket", p["kind"] == "unpack" and p["pkg"] == "nodejs")
p = anim.parse_line("Einrichten von npm (10.9) ...")
chk("'Einrichten von' → config", p["kind"] == "config" and p["pkg"] == "npm")
chk("E: → error", anim.parse_line("E: Unable to locate package rpi-eeprom")["kind"] == "error")
chk("W: → warn", anim.parse_line("W: Es fehlt ein Schlüssel")["kind"] == "warn")
chk("Gesamtzahl aus 'newly installed'",
    anim.parse_line("0 upgraded, 3 newly installed, 0 to remove.")["total"] == 3)
chk("Gesamtzahl deutsch ('neu installiert')",
    anim.parse_line("0 aktualisiert, 5 neu installiert, 0 zu entfernen.")["total"] == 5)

# ── Fortschritt ────────────────────────────────────────────────────────────
pr = anim.Progress()
for ln in ["0 upgraded, 4 newly installed, 0 to remove.",
           "Unpacking a (1) ...", "Unpacking b (1) ...",
           "Setting up a (1) ...", "Setting up b (1) ..."]:
    pr.feed(ln)
chk("echter Fortschritt: 2/4 entpackt + 2/4 eingerichtet = 50 %", abs(pr.ratio() - 0.5) < 0.01)
chk("Phase + aktuelles Paket gemerkt", pr.label() == "Einrichten" and pr.pkg == "b")
chk("ohne Gesamtzahl → unbestimmt", anim.Progress().ratio() is None)
pr2 = anim.Progress()
pr2.feed("Progress: [ 42%]")
chk("expliziter Prozentwert gewinnt", abs(pr2.ratio() - 0.42) < 0.01)

# ── Pacman-Balken ──────────────────────────────────────────────────────────
b = anim.PacBar(width=20, unicode=True, color=False, candy=False)
chk("Breite konstant über den Verlauf", len(b.render(0.0, 0)) == len(b.render(1.0, 0)))
chk("Pacman startet links", b.render(0.0, 0)[1] in ("ᗧ", "ᗤ"))
chk("Pacman endet rechts", b.render(1.0, 0)[-2] in ("ᗧ", "ᗤ"))
chk("Gefressenes ist leer", b.render(1.0, 0).count(" ") >= 18)
chk("Mund animiert", b.render(0.5, 0) != b.render(0.5, 1))
chk("unbestimmt → hüpft", b.render(None, 3) != b.render(None, 9))
chk("ASCII-Fallback ohne Unicode",
    "C" in anim.PacBar(width=12, unicode=False, color=False).render(0.0, 0))

# ── TTY-Schutz (der wichtigste Teil) ───────────────────────────────────────
buf = io.StringIO()
a = anim.Animator("test", stream=buf)
chk("kein TTY → keine Animation", a.anim is False)
a.line("Unpacking nodejs (24.4.0) ...")
a.stop(ok=True)
out = buf.getvalue()
chk("Pipe: Zeile unverändert", "Unpacking nodejs (24.4.0) ..." in out)
chk("Pipe: keine Farb-Codes", "\033[" not in out)
chk("Pipe: keine Carriage-Returns", "\r" not in out)


class FakeTTY(io.StringIO):
    def isatty(self):
        return True


os.environ["TERM"] = "xterm-256color"
os.environ.pop("NO_COLOR", None)
chk("mit TTY → Animation an", anim.Animator("t", stream=FakeTTY()).anim is True)
chk("plain=True erzwingt roh", anim.Animator("t", stream=FakeTTY(), plain=True).anim is False)
os.environ["NO_COLOR"] = "1"
chk("NO_COLOR wird respektiert", anim.Animator("t", stream=FakeTTY()).anim is False)
os.environ.pop("NO_COLOR")

print(f"\n{ok}/{ok + bad} bestanden")
sys.exit(1 if bad else 0)
