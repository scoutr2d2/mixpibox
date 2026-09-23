#!/usr/bin/env python3
"""
Test fuer "alles durchlaufen" (Taste g) in der TUI — gegen einen ECHTEN Agent.

Prueft die drei Faelle, auf die es ankommt: eine saubere Kette laeuft komplett durch,
ein FEHLER haelt sie an (der folgende Schritt darf NICHT laufen), und 'a' bricht die
ganze Kette ab, nicht nur den einzelnen Schritt.

  python3 tests/runall_test.py        # 10 Checks, exit 0 = alles gruen
"""
import asyncio, atexit, os, re, socket, subprocess, sys, time
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO + "/controller")


def free_port():
    """Freien Port vom System geben lassen. Eine FESTE Nummer macht den Test
    abhaengig davon, dass kein frueherer Lauf einen Agenten hinterlassen hat —
    dann scheitert er mit 'kein Pair-Code' und man sucht den Fehler im Code
    statt in der Umgebung (genau so passiert)."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PORT = free_port()
p = subprocess.Popen([sys.executable, REPO+"/agent/agent.py", "--port", str(PORT)],
                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
atexit.register(lambda: p.poll() is None and p.terminate())   # auch bei Abbruch/assert
code = None; t0 = time.time()
while time.time()-t0 < 10:
    m = re.search(r"PAIR CODE:\s+(\d{6})", p.stdout.readline() or "")
    if m: code = m.group(1); break
import tui
from textual.widgets import DataTable, RichLog

R3 = {"name":"3x ok","steps":[{"id":"a","name":"eins","run":"echo eins"},
                              {"id":"b","name":"zwei","run":"echo zwei"},
                              {"id":"c","name":"drei","run":"echo drei"}]}
RF = {"name":"mit Fehler","steps":[{"id":"a","name":"eins","run":"echo eins"},
                                   {"id":"b","name":"kaputt","run":"echo boom >&2; exit 5"},
                                   {"id":"c","name":"danach","run":"echo darf-nicht-laufen"}]}
RH = {"name":"mit Hänger","steps":[{"id":"a","name":"eins","run":"echo eins"},
                                   {"id":"h","name":"haengt","run":"sleep 300"},
                                   {"id":"c","name":"danach","run":"echo nein"}]}
def logtext(app): return "\n".join(str(getattr(s,'text',s)) for s in app.query_one(RichLog).lines)
res = []
def chk(n,c): res.append((n,c))

async def wait_idle(app, p, t=25):
    s = time.time()
    while (app.busy or app.run_all) and time.time()-s < t: await p.pause(0.15)
    await p.pause(0.4)

# Vorne stehen zwei ÖRTLICHE Schritte (Karte, Verbinden); "g" laesst sie aus und
# springt auf den ersten echten. Die Recipe-Schritte beginnen also bei E.
E = len(tui.LOKALE_SCHRITTE)


async def main():
    # 1) alles läuft durch
    app = tui.StepInstaller(R3, f"http://127.0.0.1:{PORT}", code)
    async with app.run_test(size=(110,30)) as pil:
        await pil.pause(0.4)
        await pil.press("g")
        await wait_idle(app, pil)
        t = app.query_one(DataTable)
        chk("die Kette laesst die oertlichen Schritte aus",
            str(t.get_cell_at((0,0))) == tui.ICON["pending"])
        icons = [str(t.get_cell_at((E+i,0))) for i in range(3)]
        chk("alle drei Schritte fertig", icons == [tui.ICON["ok"]]*3)
        chk("Abschlussmeldung", "Alle Schritte durch" in logtext(app))
        chk("Kette beendet sich selbst", app.run_all is False)
    # 2) Fehler stoppt die Kette
    app = tui.StepInstaller(RF, f"http://127.0.0.1:{PORT}", code)
    async with app.run_test(size=(110,30)) as pil:
        await pil.pause(0.4)
        await pil.press("g")
        await wait_idle(app, pil)
        t = app.query_one(DataTable)
        chk("Schritt 1 ok", str(t.get_cell_at((E+0,0))) == tui.ICON["ok"])
        chk("Schritt 2 als Fehler markiert", str(t.get_cell_at((E+1,0))) == tui.ICON["failed"])
        chk("Schritt 3 NICHT gelaufen", str(t.get_cell_at((E+2,0))) == tui.ICON["pending"])
        chk("Kette angehalten", app.run_all is False and "angehalten" in logtext(app))
    # 3) Abbruch stoppt die Kette (hängender Schritt)
    app = tui.StepInstaller(RH, f"http://127.0.0.1:{PORT}", code)
    async with app.run_test(size=(110,30)) as pil:
        await pil.pause(0.4)
        await pil.press("g")
        for _ in range(60):
            await pil.pause(0.15)
            if app.busy and app.run_id and app.current == E+1: break
        chk("hängt beim zweiten Schritt", app.current == E+1 and app.run_id is not None)
        await pil.press("a")
        await wait_idle(app, pil)
        t = app.query_one(DataTable)
        chk("Abbruch stoppt die Kette", app.run_all is False)
        chk("Schritt 3 NICHT gelaufen", str(t.get_cell_at((E+2,0))) == tui.ICON["pending"])
    print("\n--- run all ---")
    bad = 0
    for n,c in res:
        print(("  \033[32mOK  \033[0m" if c else "  \033[31mFAIL\033[0m")+"  "+n); bad += (not c)
    print(f"\n{len(res)-bad}/{len(res)} bestanden")
    return bad
try:
    rc = asyncio.run(main())
finally:
    p.terminate()
sys.exit(1 if rc else 0)
