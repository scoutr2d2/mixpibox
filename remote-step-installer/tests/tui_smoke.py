#!/usr/bin/env python3
"""Headless-Smoketest der Textual-TUI gegen einen ECHTEN Agent (Textual run_test()).

Startet den Agent selbst, pairt, und fährt die TUI per Tastendruck durch: Schritt
laufen lassen, Fehlschlag, Skip, **Abbruch eines hängenden Schritts** (das
Killer-Feature, hier durch die UI getrieben) und Theme-Wechsel.

  pip install textual pyyaml
  python3 tests/tui_smoke.py        # 13 Checks, exit 0 = alles gruen
"""
import asyncio, atexit, os, re, socket, subprocess, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "controller"))


def free_port():
    """Freien Port vom System geben lassen — siehe runall_test.py: eine feste
    Nummer laesst den Test an einem Agenten aus einem FRUEHEREN Lauf scheitern."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PORT = free_port()

# --- Agent starten, Pair-Code abgreifen -----------------------------------
proc = subprocess.Popen([sys.executable, os.path.join(REPO, "agent/agent.py"), "--port", str(PORT)],
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
atexit.register(lambda: proc.poll() is None and proc.terminate())   # auch bei Abbruch/assert
code = None
t0 = time.time()
while time.time() - t0 < 10:
    line = proc.stdout.readline()
    m = re.search(r"PAIR CODE:\s+(\d{6})", line or "")
    if m:
        code = m.group(1)
        break
assert code, "kein Pair-Code"
print(f"agent auf :{PORT}, code {code}")

import tui
from textual.widgets import DataTable, RichLog

RECIPE = {"name": "TUI-Test", "steps": [
    {"id": "ok-step",   "name": "Schritt der klappt",  "run": "echo hallo-von-der-box"},
    {"id": "fail-step", "name": "Schritt der scheitert", "run": "echo kaputt >&2; exit 7",
     "optional": True, "workarounds": [{"id": "wa", "name": "Alternative", "run": "echo workaround-lief"}]},
    {"id": "hang-step", "name": "Schritt der haengt",  "run": "sleep 300"},
]}


def logtext(app):
    return "\n".join(str(getattr(s, "text", s)) for s in app.query_one(RichLog).lines)


async def wait_idle(app, pilot, timeout=20):
    t = time.time()
    while app.busy and time.time() - t < timeout:
        await pilot.pause(0.1)


async def main():
    app = tui.StepInstaller(RECIPE, f"http://127.0.0.1:{PORT}", code)
    results = []
    async with app.run_test(size=(120, 34)) as pilot:
        await pilot.pause(0.4)
        table = app.query_one(DataTable)
        # Vorne stehen jetzt zwei ÖRTLICHE Schritte (Karte, Verbinden) — die
        # Recipe-Schritte folgen danach.
        results.append(("Tabelle zeigt alle Schritte", table.row_count == 3 + 2))
        results.append(("Agent gepairt (Log)", "verbunden" in logtext(app)))
        ECHT = app._naechster_echter(0)
        app._select(ECHT)
        await pilot.pause(0.2)

        # 1) erfolgreicher Schritt: 'r'
        await pilot.press("r")
        await wait_idle(app, pilot)
        await pilot.pause(0.3)
        ok_icon = str(table.get_cell_at((ECHT + 0, 0)))
        results.append(("Schritt 1 lief -> OK-Icon", ok_icon == tui.ICON["ok"]))
        results.append(("Ausgabe der Box im Log", "hallo-von-der-box" in logtext(app)))
        results.append(("Cursor auf Schritt 2 gesprungen", app.current == ECHT + 1))

        # 2) fehlschlagender Schritt
        await pilot.press("r")
        await wait_idle(app, pilot)
        await pilot.pause(0.3)
        results.append(("Schritt 2 -> FAIL-Icon", str(table.get_cell_at((ECHT + 1, 0))) == tui.ICON["failed"]))
        results.append(("stderr sichtbar", "kaputt" in logtext(app)))
        results.append(("Hinweis auf Workaround", "workaround" in logtext(app).lower()))

        # 3) skip (Schritt ist optional)
        await pilot.press("s")
        await pilot.pause(0.3)
        results.append(("Skip -> SKIP-Icon", str(table.get_cell_at((ECHT + 1, 0))) == tui.ICON["skipped"]))

        # 4) DAS Killer-Feature: haengenden Schritt abbrechen
        app._select(ECHT + 2)
        await pilot.pause(0.2)
        await pilot.press("r")
        await pilot.pause(1.2)
        results.append(("haengender Schritt laeuft", app.busy and app.run_id is not None))
        await pilot.press("a")            # abort
        await wait_idle(app, pilot, timeout=15)
        await pilot.pause(0.4)
        results.append(("Abbruch beendet den Hänger", not app.busy))
        results.append(("Abbruch protokolliert", "Abbruch" in logtext(app)))

        # 5) Örtliche Schritte stehen VORNE in der Liste
        results.append(("SD-Karte steht als Schritt in der Liste",
                        app.steps[0].get("lokal") == "sd"))
        results.append(("Verbinden steht als Schritt in der Liste",
                        app.steps[1].get("lokal") == "connect"))
        results.append(("die Kette laesst sie aus",
                        app._naechster_echter(0) == 2))

        # 6) Schritt 0: SD-Assistent laesst sich einschieben, ohne das
        #    Werkzeug zu wechseln — und "b"/Escape bringt zurueck zur Kette.
        vorher = app.screen
        await pilot.press("0")
        await pilot.pause(0.6)
        eingeschoben = type(app.screen).__name__ == "SdScreen"
        results.append(("Taste 0 blendet den SD-Assistenten ein", eingeschoben))
        if eingeschoben:
            results.append(("SD-Assistent startet im Trockenlauf",
                            app.screen.allow_write is False))
            app.screen.dismiss()
            await pilot.pause(0.4)
            results.append(("zurueck bei der Schrittliste", app.screen is vorher))

        # 7) Verbinden: fragt nach der Box und laesst sich abbrechen
        await pilot.press("c")
        await pilot.pause(0.5)
        gefragt = type(app.screen).__name__ == "HostScreen"
        results.append(("Taste c fragt nach der Box", gefragt))
        if gefragt:
            from textual.widgets import Input as _In
            results.append(("Vorgabe ist mupibox",
                            app.screen.query_one(_In).value == "mupibox"))
            await pilot.press("escape")
            await pilot.pause(0.3)
            results.append(("Esc bricht ab, ohne etwas zu tun",
                            type(app.screen).__name__ != "HostScreen"))

        # 8) Klick auf eine Zeile startet den Schritt (nicht nur 'r')
        vorher = logtext(app).count("hallo-von-der-box")

        class _Klick:
            cursor_row = ECHT
        app.on_data_table_row_selected(_Klick())
        await wait_idle(app, pilot)
        await pilot.pause(0.3)
        results.append(("Klick auf eine Zeile startet den Schritt",
                        logtext(app).count("hallo-von-der-box") > vorher))

        # 9) Theme wechseln
        before = app.theme
        await pilot.press("t")
        await pilot.pause(0.2)
        results.append(("Theme gewechselt", app.theme != before and app.theme in tui.THEMES))

    print("\n--- TUI-Testergebnisse ---")
    bad = 0
    for name, ok in results:
        print(("  \033[32mOK  \033[0m" if ok else "  \033[31mFAIL\033[0m") + "  " + name)
        bad += 0 if ok else 1
    print(f"\n{len(results)-bad}/{len(results)} bestanden")
    return bad


try:
    rc = asyncio.run(main())
finally:
    proc.terminate()
sys.exit(1 if rc else 0)
