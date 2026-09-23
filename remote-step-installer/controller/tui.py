#!/usr/bin/env python3
"""
remote-step-installer — Textual TUI controller.

Modern, themeable terminal UI over the same Agent core as the CLI: a step list
(left) with live status, a streaming log (right), and keys to run / abort / skip /
pick a workaround / search packages. Steps run in a worker thread so the UI stays
responsive and a hung step is abortable at any moment.

  pip install -r requirements.txt
  python3 tui.py --recipe ../recipes/mupibox.yaml --pair 123456
"""
import argparse
import os
import shlex
import sys

try:
    import yaml
    from textual.app import App, ComposeResult
    from textual.containers import Horizontal
    from textual.screen import ModalScreen
    from textual.widgets import DataTable, Footer, Header, Input, Label, ListItem, ListView, RichLog
except ImportError as e:
    import os
    _venv = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".venv", "bin", "python")
    _hint = ("\n  Es GIBT ein .venv mit den Abhängigkeiten — du hast nur den System-Python benutzt."
             "\n  Starte es über den Starter, der den richtigen Python selbst wählt:"
             "\n      ./tui --recipe recipes/demo.yaml --pair <CODE>        (aus dem Repo-Root)"
             if os.path.exists(_venv) else
             "\n  Einrichten:  ./setup-controller.sh        (prüft alles und zieht Fehlendes nach)")
    sys.exit(f"Fehlende Abhängigkeit ({e}).{_hint}")

from core import (Agent, resolve_recipe, step_puts, step_check, cached_agent,
                  anzeige_schritt)

ICON = {"pending": "○", "running": "▶", "ok": "✓", "failed": "✗", "skipped": "⤼"}

# Schritte, die HIER laufen und nicht auf der Box — sie stehen trotzdem in der
# Liste, weil sie zum selben Weg gehören: ohne Karte keine Box, ohne Agent kein
# Schritt. Beide sind oft schon erledigt (Box läuft bereits), deshalb lassen sie
# sich wie jeder andere Schritt überspringen.
LOKALE_SCHRITTE = [
    {"id": "sd-karte", "name": "SD-Karte schreiben (Schritt 0)", "lokal": "sd",
     "note": "Nur nötig, wenn es die Box noch nicht gibt. s = überspringen."},
    {"id": "box-verbinden", "name": "Box verbinden + Agent installieren", "lokal": "connect",
     "note": "Bringt den Agent per SSH hin und pairt. Läuft die Verbindung schon, s = überspringen."},
]
THEMES = ["textual-dark", "nord", "gruvbox", "dracula", "monokai", "textual-light"]


def teil_name(recipe):
    """Kurzes Etikett fuer die Herkunftsspalte: "MixPiBox (System)" -> "System"."""
    n = (recipe.get("name") or "Rezept").strip()
    if "(" in n and ")" in n:
        return n[n.index("(") + 1:n.index(")")].strip()
    return n.split("—")[-1].strip()[:14]


def env_prefix(recipe):
    env = recipe.get("env") or {}
    return ("; ".join(f"export {k}={shlex.quote(str(v))}" for k, v in env.items()) + "; ") if env else ""


class WorkaroundScreen(ModalScreen):
    """Pick a workaround for the failed step."""
    def __init__(self, workarounds):
        super().__init__()
        self.workarounds = workarounds

    def compose(self) -> ComposeResult:
        yield Label("  Workaround wählen (Esc = abbrechen):")
        yield ListView(*[ListItem(Label(w["name"])) for w in self.workarounds])

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        self.dismiss(event.list_view.index)

    def on_key(self, event) -> None:
        if event.key == "escape":
            self.dismiss(None)


class SearchScreen(ModalScreen):
    """Type a package name to look up on the target."""
    def compose(self) -> ComposeResult:
        yield Label("  Paketsuche (Enter = suchen, Esc = abbrechen):")
        yield Input(placeholder="z.B. rpi-eeprom")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self.dismiss(event.value.strip())

    def on_key(self, event) -> None:
        if event.key == "escape":
            self.dismiss(None)


class HostScreen(ModalScreen):
    """Nach dem Namen der Box fragen (Schritt 1 nach dem Schreiben der Karte)."""
    def __init__(self, vorgabe="mupibox"):
        super().__init__()
        self.vorgabe = vorgabe

    def compose(self) -> ComposeResult:
        yield Label("  Box verbinden — Name oder IP (Enter, Esc = abbrechen):")
        yield Input(value=self.vorgabe, placeholder="mupibox")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self.dismiss(event.value.strip())

    def on_key(self, event) -> None:
        if event.key == "escape":
            self.dismiss(None)


class StepInstaller(App):
    CSS = """
    Screen { layout: vertical; }
    #body { height: 1fr; }
    DataTable { width: 44%; border-right: solid $accent; }
    RichLog { width: 1fr; padding: 0 1; }
    WorkaroundScreen, SearchScreen, HostScreen { align: center middle; }
    WorkaroundScreen > *, SearchScreen > *, HostScreen > * { width: 70%; background: $panel; border: solid $accent; }
    """
    BINDINGS = [
        ("r", "run", "Run/Retry"),
        ("g", "run_all", "Alle"),
        ("a", "abort", "Abort"),
        ("s", "skip", "Skip"),
        ("w", "workaround", "Workaround"),
        ("f", "search", "Paketsuche"),
        ("n", "next", "Next"),
        ("0", "sd_card", "SD-Karte"),
        ("c", "connect", "Verbinden"),
        ("t", "cycle_theme", "Theme"),
        ("q", "quit", "Quit"),
    ]

    def __init__(self, recipe, base, code):
        super().__init__()
        # Mehrere Rezepte als EINE Liste: eine vollstaendige Installation
        # besteht aus System UND App. Getrennt gefahren haelt man sie nach dem
        # ersten Rezept fuer fertig, obwohl die halbe Box fehlt — am Geraet
        # genau so passiert.
        self.recipes = recipe if isinstance(recipe, list) else [recipe]
        self.recipe = self.recipes[0]          # bleibt fuer Titel/Rueckfragen
        self.mehrteilig = len(self.recipes) > 1
        # Die beiden örtlichen Schritte VORNE: der Weg beginnt bei der leeren
        # Karte, nicht beim ersten Befehl auf der Box.
        self.steps = [dict(s) for s in LOKALE_SCHRITTE]
        for i, r in enumerate(self.recipes):
            etikett = teil_name(r)
            for st in r.get("steps", []):
                t = dict(st)
                t["_ri"] = i                   # jedes Rezept hat EIGENE env-Werte
                t["_teil"] = etikett
                self.steps.append(t)
        # Je Rezept ein eigener Export-Prefix (mupibox-app setzt MUPI_APP &Co.,
        # mupibox.yaml nicht) — ein gemeinsamer waere schlicht falsch.
        self._prefixe = [env_prefix(r) for r in self.recipes]
        self.prefix = self._prefixe[0]
        self.base = base
        self.agent = Agent(base)
        self.code = code
        self.current = 0
        self.busy = False
        self.run_id = None
        self.overrides = {}          # step index -> workaround cmd
        self.run_all = False         # Kette laeuft (g) — haelt bei Fehler an

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Horizontal(id="body"):
            yield DataTable(cursor_type="row", zebra_stripes=True)
            yield RichLog(highlight=True, markup=True, wrap=True)
        yield Footer()

    def on_mount(self) -> None:
        self.title = "remote-step-installer"
        self.sub_title = "  +  ".join(r.get("name", "") for r in self.recipes)
        t = self.query_one(DataTable)
        if self.mehrteilig:
            t.add_columns(" ", "Schritt", "Teil")
            for s in self.steps:
                t.add_row(ICON["pending"], s.get("name", s["id"]), s.get("_teil", "·"))
        else:
            t.add_columns(" ", "Schritt")
            for s in self.steps:
                t.add_row(ICON["pending"], s.get("name", s["id"]))
        log = self.query_one(RichLog)
        try:
            # --pair ist OPTIONAL: nach `./connect` liegt der Token im Cache
            self.agent = cached_agent(self.base, self.code)
            try:                     # erkannte Umgebung einspeisen ($BOOT_DIR/$DIETPI_DIR/...)
                import sysinfo
                self._prefixe = [sysinfo.recipe_prefix(self.agent, r) for r in self.recipes]
                self.prefix = self._prefixe[0]
                self._hardware_pruefen(log)
            except Exception as e:
                log.write(f"[yellow]  Umgebung nicht erkannt ({e}) — nur Recipe-Env[/]")
            log.write(f"[green]✓ verbunden mit dem Agent — Recipe: {self.recipe.get('name')}[/]")
            log.write("[dim]  r=Schritt  [b]g=alle[/b]  a=abbrechen  s=überspringen  "
                      "w=Workaround  f=Paketsuche  n=weiter  [b]0=SD-Karte  c=Verbinden[/b]  t=Theme  q=Ende[/]")
        except Exception as e:
            log.write(f"[red]Verbindung fehlgeschlagen: {e}[/]")
            # Genau hier steht man, wenn es die Box noch gar nicht gibt — also
            # den Weg zeigen, der dann zaehlt, statt nur den Fehler zu melden.
            log.write("[dim]  Noch keine Box? [b]0[/b] = SD-Karte schreiben, "
                      "dann [b]c[/b] = verbinden (bringt den Agent gleich mit).[/]")
        if self.steps:
            t.move_cursor(row=0)

    # ---- helpers -----------------------------------------------------------
    def _status(self, idx, st):
        self.query_one(DataTable).update_cell_at((idx, 0), ICON[st])

    def _log(self, msg):
        self.query_one(RichLog).write(msg)

    def _select(self, idx):
        self.current = idx
        self.query_one(DataTable).move_cursor(row=idx)

    def on_data_table_row_highlighted(self, event) -> None:
        self.current = event.cursor_row

    def on_data_table_row_selected(self, event) -> None:
        """Klick (oder Enter) auf eine Zeile STARTET den Schritt.

        Vorher lief ein Schritt nur ueber die Taste r — wer mit der Maus in der
        Liste war, klickte ins Leere. Der busy-Wächter in action_run verhindert,
        dass ein Doppelklick denselben Schritt zweimal anstößt.
        """
        self.current = event.cursor_row
        self.action_run()

    # ---- actions -----------------------------------------------------------
    def action_run(self) -> None:
        if self.busy or not self.steps:
            return
        idx = self.current
        bed = self.steps[idx].get("_nicht_fuer_diese_box")
        if bed:
            # Auch von Hand nicht ausfuehrbar: der Schritt gilt einer anderen
            # Hardware, und ihn trotzdem zu starten waere kein Dienst.
            self._log(f"[yellow]  → nicht fuer diese Box (nur fuer »{bed}«)[/]")
            self._status(idx, "skipped")
            if idx + 1 < len(self.steps):
                self._select(idx + 1)
            return
        art = self.steps[idx].get("lokal")
        if art:
            self._lokal(idx, art)
            return
        self.busy = True
        self._status(idx, "running")
        self.run_worker(lambda: self._run(idx), thread=True, exclusive=True)

    def _run(self, idx):
        step = self.steps[idx]
        cmd = self.overrides.get(idx, step["run"])
        self.call_from_thread(self._log, f"\n[b cyan]▶ {step.get('name', step['id'])}[/]")
        if step.get("note"):
            self.call_from_thread(self._log, f"[dim]  {step['note']}[/]")
        try:                      # eigene Pakete hochladen, bevor der Schritt läuft
            step_puts(self.agent, step,
                      on_line=lambda s: self.call_from_thread(self._log, f"[dim]  {s}[/]"))
        except Exception as e:
            self.call_from_thread(self._log, f"[red]  Upload fehlgeschlagen: {e}[/]")
            self.call_from_thread(self._done, idx, {"exit": 1, "aborted": False, "timedout": False})
            return
        try:
            pre = self._prefixe[step["_ri"]] if "_ri" in step else self.prefix
            # Derselbe Stand auf den Bildschirm der BOX. Die beiden oertlichen
            # Vorstufen (SD-Karte schreiben, Box verbinden) zaehlen NICHT mit:
            # sie laufen am Laptop, und eine Box, die noch nicht existiert,
            # kann schlecht anzeigen, dass sie gerade geschrieben wird.
            fern = [s for s in self.steps if not s.get("lokal")]
            try:
                nr = fern.index(step) + 1
            except ValueError:
                nr = None
            self.run_id = self.agent.run(step["id"], pre + cmd, step.get("timeout"),
                                         schritt=anzeige_schritt(step, nr, len(fern)))
            res = self.agent.stream(self.run_id, lambda ln: self.call_from_thread(self._log, "  " + ln))
        except Exception as e:
            res = {"exit": 1, "aborted": False, "timedout": False}
            self.call_from_thread(self._log, f"[red]  Agent-Fehler: {e}[/]")
        # Die Probe `check:` NACH dem run: — ein run:, das mit 0 endet, hat noch
        # lange nicht gewirkt (|| true, daemon-reload ohne Datei, ein Wachposten,
        # der sich selbst ueberspringt). Ohne diese Zeilen meldet die TUI Erfolg
        # fuer Schritte, die nichts getan haben — genau so ist der Pi 4 entstanden.
        if res.get("exit") == 0 and not res.get("aborted") and not res.get("timedout"):
            try:
                pre = self._prefixe[step["_ri"]] if "_ri" in step else self.prefix
                bestanden = step_check(
                    self.agent, step, pre,
                    on_line=lambda s: self.call_from_thread(self._log, f"[dim]  {s}[/]"))
                if bestanden is False:
                    self.call_from_thread(
                        self._log, "[red]  ✗ Probe (check:) fehlgeschlagen — "
                                   "der Schritt hat nicht gewirkt[/]")
                    res = dict(res, exit=1, check_failed=True)
                elif bestanden is True:
                    self.call_from_thread(self._log, "[green]  ✓ Probe bestanden[/]")
            except Exception as e:
                self.call_from_thread(self._log, f"[yellow]  Probe nicht ausfuehrbar: {e}[/]")
        self.call_from_thread(self._done, idx, res)

    def _done(self, idx, res):
        self.busy = False
        self.run_id = None
        if res.get("timedout"):
            self._log(f"[yellow]  ⏱ Timeout — Schritt gekillt[/]")
        ok = res.get("exit") == 0 and not res.get("aborted") and not res.get("timedout")
        if ok:
            self._status(idx, "ok")
            self._log("[green]  ✓ OK[/]")
            if idx + 1 < len(self.steps):
                self._select(idx + 1)
                if self.run_all:
                    # kurz verzoegert, damit dieser Worker sauber endet
                    self.set_timer(0.2, self.action_run)
            elif self.run_all:
                self.run_all = False
                self._log("[b green]✓ Alle Schritte durch.[/]")
        else:
            if self.run_all:        # bei einem Fehler NICHT weiterrennen
                self.run_all = False
                self._log("[yellow]  ⏸ Kette angehalten — entscheide: "
                          "r=wiederholen  w=Workaround  s=überspringen  g=weiter[/]")
            self._status(idx, "failed")
            hint = "r=retry"
            if self.steps[idx].get("workarounds"):
                hint += "  w=workaround"
            if self.steps[idx].get("optional"):
                hint += "  s=skip"
            hint += "  f=paketsuche"
            self._log(f"[red]  ✗ fehlgeschlagen (exit {res.get('exit')}).  {hint}[/]")

    def _naechster_echter(self, ab):
        """Erster Schritt ab `ab`, der auf der BOX läuft."""
        for i in range(ab, len(self.steps)):
            if not self.steps[i].get("lokal"):
                return i
        return None

    def action_run_all(self) -> None:
        """Ab dem aktuellen Schritt alles durchlaufen — haelt bei einem Fehler an
        (genau dafuer ist das Werkzeug da) und laesst sich mit 'a' abbrechen."""
        if self.busy or not self.steps:
            return
        # Die örtlichen Schritte NICHT mitlaufen lassen: eine Karte zu
        # überschreiben oder einen Agent zu installieren gehört nicht in einen
        # Lauf, den man mit einer Taste startet — beides braucht eine Entscheidung.
        ziel = self._naechster_echter(self.current)
        if ziel is None:
            self._log("[yellow]Ab hier stehen nur örtliche Schritte — die bitte einzeln (r).[/]")
            return
        if ziel != self.current:
            uebersprungen = [self.steps[i]["name"] for i in range(self.current, ziel)]
            self._log("[dim]  übersprungen (einzeln zu fahren): " + ", ".join(uebersprungen) + "[/]")
            self._select(ziel)
        self.run_all = True
        rest = len(self.steps) - self.current
        self._log(f"[b cyan]▶▶ Alle Schritte ab hier ({rest}) — 'a' bricht ab[/]")
        self.action_run()

    def action_abort(self) -> None:
        self.run_all = False          # Kette stoppen, nicht nur den Schritt
        if self.run_id:
            try:
                self.agent.abort(self.run_id)
                self._log("[yellow]  ⨯ Abbruch gesendet[/]")
            except Exception as e:
                self._log(f"[red]  {e}[/]")

    def _hardware_pruefen(self, log) -> None:
        """Welche Schritte passen NICHT zu dieser Box?

        Sie werden gleich hier als uebersprungen markiert und beim Lauf
        ausgelassen — nicht erst, wenn man davorsteht. „Was passiert gleich"
        ist die Frage, die man VOR einer Installation hat, und ein Schritt,
        der laeuft und nichts tut, beantwortet sie nicht.

        Die Erkennung selbst gab es laengst (sysinfo); hier haengt nur die
        Auswertung daran. Kommt sie nicht durch, laeuft alles wie bisher —
        eine halbierte Installation waere der schlechtere Ausgang.
        """
        import hardware
        import sysinfo

        umgebung = sysinfo.normalize(self.agent.sysinfo())
        fakten = hardware.fakten(umgebung)
        if not fakten:
            log.write("[yellow]  Zielhardware unklar — es wird nichts ausgelassen[/]")
            return
        modell = umgebung.get("model_id") or "?"
        log.write(f"[dim]  Zielhardware: {modell} · {umgebung.get('codename') or '?'}[/]")

        weg = dict(hardware.auswerten(self.steps, fakten))
        if not weg:
            return
        for i, st in enumerate(self.steps):
            sid = st.get("id")
            if sid in weg:
                st["_nicht_fuer_diese_box"] = weg[sid]
                self._status(i, "skipped")
        # Auflisten, nicht nur zaehlen: wer spaeter sucht, warum etwas fehlt,
        # findet die Antwort sonst nirgends.
        for sid, bed in weg.items():
            log.write(f"[yellow]  ausgelassen: {sid} (nur fuer »{bed}«)[/]")

    def action_skip(self) -> None:
        idx = self.current
        if not self.busy and self.steps[idx].get("optional"):
            self._status(idx, "skipped")
            self._log("[yellow]  → übersprungen[/]")
            if idx + 1 < len(self.steps):
                self._select(idx + 1)

    def action_next(self) -> None:
        if self.current + 1 < len(self.steps):
            self._select(self.current + 1)

    def action_workaround(self) -> None:
        was = self.steps[self.current].get("workarounds") or []
        if not was or self.busy:
            return
        def apply(i):
            if i is not None:
                self.overrides[self.current] = was[i]["run"]
                self._log(f"[cyan]  → Workaround: {was[i]['name']}[/]")
                self.action_run()
        self.push_screen(WorkaroundScreen(was), apply)

    def _lokal(self, idx, art):
        """Örtlichen Schritt fahren: SD-Karte bzw. Box verbinden."""
        step = self.steps[idx]
        self._log(f"\n[b cyan]▶ {step['name']}[/]")
        if step.get("note"):
            self._log(f"[dim]  {step['note']}[/]")
        if art == "sd":
            titel, unter = self.title, self.sub_title

            def zurueck(_=None):
                self.title, self.sub_title = titel, unter
                self._status(idx, "ok")
                self._log("[dim]  Karte fertig? Dann den nächsten Schritt fahren (r).[/]")
                self._select(min(idx + 1, len(self.steps) - 1))
            try:
                from tui_sd import SdScreen
            except Exception as e:
                self._log(f"[red]  SD-Assistent nicht verfügbar: {e}[/]")
                self._status(idx, "failed")
                return
            self.push_screen(SdScreen(), zurueck)
        else:
            def los(host):
                if not host:
                    return
                self._status(idx, "running")
                self.run_worker(lambda: self._connect(host, idx), thread=True)
            self.push_screen(HostScreen(), los)

    def action_search(self) -> None:
        def go(query):
            if query:
                self.run_worker(lambda: self._search(query), thread=True)
        self.push_screen(SearchScreen(), go)

    def action_sd_card(self) -> None:
        """Schritt 0: SD-Karte schreiben, ohne das Werkzeug zu wechseln.

        Derselbe Screen, den auch `./sdtui` benutzt — er wird nur eingeschoben.
        Bewusst ERST HIER importiert: die Haupt-TUI soll auch dann starten, wenn
        am SD-Assistenten etwas klemmt, denn ihre eigentliche Arbeit (Schritte
        gegen eine laufende Box) braucht ihn nicht.
        """
        if self.busy:
            self._log("[yellow]Erst den laufenden Schritt abwarten.[/]")
            return
        try:
            from tui_sd import SdScreen
        except Exception as e:                      # pragma: no cover
            self._log(f"[red]SD-Assistent nicht verfügbar: {e}[/]")
            return
        titel, untertitel = self.title, self.sub_title

        def zurueck(_=None):
            self.title, self.sub_title = titel, untertitel
            self._log("[dim]Karte fertig? Dann [b]c[/b] = Box verbinden (Agent kommt mit).[/]")
        self.push_screen(SdScreen(), zurueck)

    def action_connect(self) -> None:
        """Schritt 1 nach der Karte: Agent hinbringen und pairen — ohne Werkzeugwechsel."""
        if self.busy:
            self._log("[yellow]Erst den laufenden Schritt abwarten.[/]")
            return

        def los(host):
            if host:
                self.run_worker(lambda: self._connect(host), thread=True)
        self.push_screen(HostScreen(), los)

    def _connect(self, host, idx=None):
        L = lambda m: self.call_from_thread(self._log, m)          # noqa: E731
        L(f"\n[b cyan]▶ Box verbinden: {host}[/]")
        try:
            import connect as conn
            import sdprep
        except Exception as e:
            L(f"[red]  nicht verfügbar: {e}[/]")
            return
        def ende(gut):
            if idx is not None:
                self.call_from_thread(self._status, idx, "ok" if gut else "failed")
        if not conn.ssh_reachable(host):
            L(f"[yellow]  {host} antwortet nicht — suche die Box im Netz …[/]")
            ip, info = conn.finde_box(host, conn.DEF_USER, on_status=lambda t: L(f"[dim]  {t}[/]"))
            if not ip:
                L(f"[red]  {info}[/]")
                L("[dim]  Schon fertig hochgefahren? Im selben Netz?[/]")
                ende(False)
                return
            L(f"[green]  Gefunden: {info} unter {ip}[/]")
            host = ip
        # Erst pruefen, ob der Schluessel greift. Sonst wuerde connect ein
        # Passwort verlangen — und in der TUI kann danach niemand fragen (dieselbe
        # Falle wie bei sudo). Frisch geschriebene Karten tragen den Schluessel
        # bereits, deshalb ist das hier der Normalfall.
        if not conn.key_works(conn.DEF_USER, host):
            # Erst pruefen, ob nur die ALTE Box-Identitaet im Weg steht: nach
            # einer Neuinstallation verweigert ssh alles, was faelschlich wie
            # "kein Schluessel" aussieht (am Geraet: Konsole lief zufaellig
            # ueber die frische IP und ging, die TUI ueber den Namen nicht).
            if conn.heile_hostkey(conn.DEF_USER, host):
                L("[yellow]  Die Box wurde neu installiert — alte Identität entfernt, neuer Versuch …[/]")
            if not conn.key_works(conn.DEF_USER, host):
                L("[yellow]  Ohne SSH-Schlüssel — dafür wird ein Passwort gebraucht,[/]")
                L("[yellow]  und danach kann hier niemand fragen. Einmal im Terminal:[/]")
                L(f"[b]    ./connect {host} --install[/]")
                ende(False)
                return
        rc = sdprep.run_streaming(
            [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "connect.py"),
             host, "--install"], lambda s: L(f"[dim]  {s}[/]"))
        if rc != 0:
            L(f"[red]  Verbinden fehlgeschlagen (Code {rc})[/]")
            ende(False)
            return
        L("[green]  ✓ verbunden und gepairt[/]")
        ende(True)
        self.call_from_thread(self._reconnect_agent)

    def _reconnect_agent(self):
        """Den frisch gepairten Agent gleich übernehmen — sonst müsste man die
        TUI neu starten, obwohl die Verbindung längst steht."""
        try:
            self.agent = cached_agent(self.base, self.code)
            try:
                import sysinfo
                self._prefixe = [sysinfo.recipe_prefix(self.agent, r) for r in self.recipes]
                self.prefix = self._prefixe[0]
            except Exception as e:
                self._log(f"[yellow]  Umgebung nicht erkannt ({e}) — nur Recipe-Env[/]")
            self._log(f"[green]✓ verbunden mit dem Agent — Recipe: {self.recipe.get('name')}[/]")
            self._log("[dim]  Jetzt [b]g[/b] = alle Schritte, oder [b]r[/b] = einzeln.[/]")
        except Exception as e:
            self._log(f"[red]  Agent noch nicht erreichbar: {e}[/]")

    def _search(self, query):
        self.call_from_thread(self._log, f"\n[cyan]🔎 Paketsuche: {query}[/]")
        try:
            res = self.agent.search(query)
            for section, lines in res.items():
                self.call_from_thread(self._log, f"[b]  {section}:[/]")
                for ln in lines[:20]:
                    self.call_from_thread(self._log, "    " + ln)
        except Exception as e:
            self.call_from_thread(self._log, f"[red]  {e}[/]")

    def action_cycle_theme(self) -> None:
        try:
            i = (THEMES.index(self.theme) + 1) % len(THEMES)
        except ValueError:
            i = 0
        self.theme = THEMES[i]
        self._log(f"[dim]  Theme: {self.theme}[/]")


def rezept_namen(werte):
    """--recipe mehrfach ODER kommagetrennt -> Liste. Pure.

    Eine vollstaendige Installation besteht aus mehreren Rezepten (System, App,
    Feinschliff); sie einzeln zu fahren verleitet dazu, nach dem ersten
    aufzuhoeren.
    """
    raus = []
    for w in werte or []:
        for teil in str(w).split(","):
            teil = teil.strip()
            if teil and teil not in raus:
                raus.append(teil)
    return raus


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recipe", required=True, action="append",
                    help="Datei oder Name; MEHRFACH oder kommagetrennt möglich "
                         "(z.B. --recipe mupibox,mupibox-app)")
    ap.add_argument("--base", default="http://127.0.0.1:8099")
    ap.add_argument("--pair", help="Pair-Code (entfällt nach ./connect — Token ist gecacht)")
    args = ap.parse_args()
    rezepte = []
    for name in rezept_namen(args.recipe):
        try:
            path = resolve_recipe(name)
        except FileNotFoundError as e:
            sys.exit(str(e))
        with open(path) as f:
            rezepte.append(yaml.safe_load(f))
    StepInstaller(rezepte, args.base, args.pair).run()


if __name__ == "__main__":
    main()
