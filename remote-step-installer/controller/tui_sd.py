#!/usr/bin/env python3
"""
remote-step-installer — SD-Assistent als TUI.

Führt in klaren Schritten durch: Board → DietPi-Variante → Karte → Einstellungen →
Bestätigung → Schreiben & Vorbereiten. Nutzt dieselbe geprüfte Mechanik wie
`sdprep.py` (Live-Bildliste, Geräte-Sicherheitsfilter, Boot-Vorbereitung) — die TUI
ist nur die Bedienoberfläche darüber.

Sicherheit bleibt wie in der CLI: nur Wechseldatenträger, System-Platten hart
ausgeschlossen (Systemplatten stehen gar nicht erst zur Wahl), und geschrieben
wird erst nach einer ZWEITEN, ausdrücklichen Bestätigung — in der "Abbrechen"
vorne steht, damit ein versehentliches Enter abbricht statt zu löschen.
`--write` überspringt diese Rückfrage bewusst nur für den unbeaufsichtigten
Gebrauch.

Der Assistent ist ein SCHIEBBARER Screen (SdScreen), damit es ihn auf zwei
Wegen gibt, ohne dass etwas doppelt gepflegt wird:

  ./sdtui                     eigener Starter (SdApp schiebt denselben Screen)
  ./tui … → Taste 0           als "Schritt 0" in der Haupt-TUI, ohne Werkzeugwechsel
"""
import os
import sys
import threading

try:
    from textual.app import App, ComposeResult
    from textual.containers import Horizontal, Vertical
    from textual.screen import Screen
    from textual.widgets import (Checkbox, Footer, Header, Input, Label, ListItem,
                             ListView, RichLog, Static)
except ImportError as e:
    _venv = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".venv", "bin", "python")
    sys.exit(f"Fehlende Abhängigkeit ({e})." + (
        "\n  Starte über ./sdtui (nutzt automatisch das .venv)." if os.path.exists(_venv)
        else "\n  Einrichten:  ./setup-controller.sh"))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sdprep  # noqa: E402

CACHE = os.path.expanduser("~/.cache/remote-step-installer")
STEPS = ["Board", "Variante", "Karte", "Einstellungen", "Bestätigen", "Schreiben"]


class SdScreen(Screen):
    """Der Assistent als SCHIEBBARER Screen — nicht als eigene App.

    So kann ihn die Haupt-TUI als "Schritt 0" einblenden (`./tui`, Taste 0), ohne
    dass man das Werkzeug wechseln muss; `./sdtui` bleibt daneben als eigener
    Starter bestehen und schiebt denselben Screen (siehe SdApp unten). Deshalb
    laufen Titel, Thema und call_from_thread hier ueber self.app — das sind
    App-Sachen, kein Screen-Zustand.
    """

    DEFAULT_CSS = """
    SdScreen { layout: vertical; }
    #body { height: 1fr; }
    #left { width: 46%; border-right: solid $accent; }
    #crumbs { height: 1; background: $panel; color: $text-muted; padding: 0 1; }
    #question { height: 3; padding: 1 1 0 1; text-style: bold; }
    #work { height: auto; padding: 1 1; }
    ListView { height: 1fr; }
    RichLog { width: 1fr; padding: 0 1; }
    /* SCROLLBAR, und das ist kein Schoenheitsfehler gewesen: mit `height: auto`
       waechst der Block ueber den Schirm hinaus, und was unten herausfaellt,
       ist einfach WEG — ohne Balken, ohne Hinweis. Auf einem 80x24-Terminal
       (der Vorgabe) waren die letzten drei Haken unsichtbar, darunter
       "Einrichtung per Handy" und "Lauf ohne PC". Wer sie nicht sieht, haelt
       sie fuer nicht vorhanden. Gemessen mit run_test in drei Groessen. */
    #form { height: 1fr; padding: 0 1; overflow-y: auto; }
    Input { margin: 0; }
    /* Der Rahmen weg, NICHT die Hoehe: `height: 1` liess Textual den Rahmen
       behalten und stattdessen die BESCHRIFTUNG wegschneiden — auf dem Schirm
       standen leere Kaestchen. Ohne Rahmen passt Haken und Text in eine Zeile. */
    Checkbox { height: 1; border: none; padding: 0; }
    """
    BINDINGS = [
        ("enter", "choose", "Wählen"),
        ("b", "back", "Zurück"),
        ("r", "refresh", "Neu laden"),
        ("t", "cycle_theme", "Theme"),
        ("q", "close", "Beenden"),
    ]
    THEMES = ["textual-dark", "nord", "gruvbox", "dracula", "textual-light"]

    def __init__(self, write=False, standalone=False):
        super().__init__()
        self.standalone = standalone   # eigener Starter -> q beendet; sonst nur zurueck
        self.stage = 0
        self.entries = []          # Bildliste (live)
        self.board = ""
        self.image = None
        self.device = None
        self.devices = []
        self.allow_write = write   # ohne --write bleibt es ein Trockenlauf
        self.cfg = {"hostname": "mixpi", "password": "mupibox", "ssid": "", "wifikey": "",
                    "debug_display": False, "diagnose": False, "handy": False,
                    "lauf_paket": False}
        self.busy = False
        self.phase = ""            # was gerade läuft (fester Text)
        self.getan = 0             # Bytes bzw. Prozent
        self.gesamt = 0
        self.takt = 0              # für die Laufanzeige
        self._ticker = None

    # ---- Aufbau ----------------------------------------------------------
    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Static("", id="crumbs")
        with Horizontal(id="body"):
            with Vertical(id="left"):
                yield Static("", id="question")
                yield ListView()
                with Vertical(id="form"):
                    yield Input(placeholder="Hostname", id="f_host")
                    yield Input(placeholder="Passwort für dietpi/root", id="f_pass")
                    yield Input(placeholder="WLAN-SSID (leer = LAN)", id="f_ssid")
                    yield Input(placeholder="WLAN-Passwort", password=True, id="f_wifikey")
                    # Zum Fehlersuchen: sonst ist eine Box, die nicht ins Netz
                    # findet, gleichzeitig stumm UND blind.
                    yield Checkbox("Systemmeldungen zeigen (Fehlersuche)",
                                   value=False, id="f_debug")
                    yield Checkbox("WLAN-Diagnose auf die Karte",
                                   value=False, id="f_diag")
                    # Der Weg ohne Laptop. Er bringt den Agent MIT ins LAN —
                    # deshalb steht das hier als Frage und nicht als Vorgabe.
                    yield Checkbox("Einrichtung per Handy (QR am Schirm)",
                                   value=False, id="f_handy")
                    # Der Lauf OHNE Rechner. Er setzt den Handy-Weg voraus (dort
                    # sitzt der Startknopf) und legt ~17 MB mit auf die Karte.
                    yield Checkbox("Lauf ohne PC (Box fährt selbst)",
                                   value=False, id="f_lauf")
                # Fester Fortschritt: der Balken steht STILL und wird an Ort und
                # Stelle überschrieben. Im Protokoll daneben würden die
                # dd-Meldungen im Sekundentakt alles Lesbare wegscrollen.
                yield Static("", id="work")
            yield RichLog(highlight=True, markup=True, wrap=True)
        yield Footer()

    def on_mount(self):
        self.app.title = "SD-Karte vorbereiten"
        self.app.sub_title = "nacktes DietPi (Agent kommt per ./connect --install)"
        self.query_one("#form").display = False
        self.query_one("#work").display = False
        self.log_(f"[dim]Modus: {'SCHREIBEN erlaubt (--write)' if self.allow_write else 'Schreiben erst nach zweiter Bestaetigung'}[/]")
        self.load_images()

    ZEICHEN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

    def setze_arbeit(self, phase=None, getan=None, gesamt=None):
        """Nur den Zustand MERKEN — gezeichnet wird im Takt (siehe _tick).

        Wird aus dem Arbeitsfaden gerufen, und der meldet sich oft: der Download
        bei JEDEM Block, dd jede Sekunde. Jede Meldung sofort zeichnen zu lassen
        überflutete die Oberfläche — das Bild lief sichtbar über sich selbst.
        Reine Zuweisungen brauchen kein call_from_thread.
        """
        if phase is not None:
            self.phase = phase
        if getan is not None:
            self.getan = getan
        if gesamt is not None:
            self.gesamt = gesamt

    def zeige_arbeit(self, phase=None, getan=None, gesamt=None):
        """Den festen Statusblock an Ort und Stelle neu zeichnen (UI-Faden)."""
        self.setze_arbeit(phase, getan, gesamt)
        w = self.query_one("#work", Static)
        w.display = True
        dreher = self.ZEICHEN[self.takt % len(self.ZEICHEN)]
        if self.gesamt > 0:
            anteil = max(0.0, min(1.0, self.getan / self.gesamt))
            breite = 34
            voll = int(breite * anteil)
            balken = "█" * voll + "░" * (breite - voll)
            zahl = f"{anteil * 100:5.1f} %   {sdprep.human(self.getan)} / {sdprep.human(self.gesamt)}"
        else:                       # Dauer unbekannt -> nur Lebenszeichen
            breite = 34
            pos = self.takt % (breite * 2)
            pos = pos if pos < breite else (breite * 2 - pos - 1)
            balken = "░" * pos + "█" * min(3, breite - pos) + "░" * max(0, breite - pos - 3)
            zahl = sdprep.human(self.getan) if self.getan else ""
        w.update(f"[b]{dreher} {self.phase}[/]\n[cyan]{balken}[/]  {zahl}")

    def _arbeit_fertig(self):
        """Endzustand stehenlassen — kein blinkender Dreher ohne Arbeit."""
        w = self.query_one("#work", Static)
        w.update("[b green]✓ fertig[/]" if self.gesamt and self.getan >= self.gesamt * 0.99
                 else "[b]— beendet —[/]")

    def _tick(self):
        self.takt += 1
        if self.busy:
            self.zeige_arbeit()

    # ---- Hilfen ----------------------------------------------------------
    def log_(self, msg):
        self.query_one(RichLog).write(msg)

    def crumbs(self):
        parts = []
        for i, s in enumerate(STEPS):
            parts.append(f"[b]{s}[/]" if i == self.stage else (f"[dim]{s}[/]" if i > self.stage else f"[green]{s}[/]"))
        self.query_one("#crumbs", Static).update(" › ".join(parts))

    def ask(self, text, items):
        self.query_one("#question", Static).update(text)
        lv = self.query_one(ListView)
        lv.clear()
        for label, _ in items:
            lv.append(ListItem(Label(label)))
        self._items = items
        lv.display = True
        self.query_one("#form").display = False
        if items:
            lv.index = 0          # Cursor setzen, sonst wählt Enter nichts
        lv.focus()
        self.crumbs()

    def form(self, text, liste_zeigen=False):
        self.query_one("#question", Static).update(text)
        self.query_one(ListView).display = liste_zeigen
        f = self.query_one("#form")
        f.display = True
        self.query_one("#f_host", Input).value = self.cfg["hostname"]
        self.query_one("#f_pass", Input).value = self.cfg["password"]
        self.query_one("#f_host", Input).focus()
        self.crumbs()

    # ---- Ablauf ----------------------------------------------------------
    def load_images(self):
        self.stage = 0
        self.ask("Lade Bildliste …", [])
        self.run_worker(self._load_images, thread=True)

    def _load_images(self):
        try:
            ents = sdprep.fetch_index()
        except Exception as e:                       # offline o.ä.
            self.app.call_from_thread(self.log_, f"[red]Bildliste nicht abrufbar: {e}[/]")
            return
        self.entries = ents
        self.app.call_from_thread(self._show_boards)

    def _show_boards(self):
        self.log_(f"[green]✓[/] {len(self.entries)} Images von dietpi.com")
        known = [b for b in sdprep.BOARD_HINT if b in sdprep.boards(self.entries)]
        rest = [b for b in sdprep.boards(self.entries) if b not in known]
        items = [(f"{b}   —  {sdprep.BOARD_HINT[b]}", b) for b in known]
        items += [(b, b) for b in rest]
        self.ask("1) Für welches Board?", items)

    def _show_codenames(self):
        self.stage = 1
        sel = sdprep.select(self.entries, self.board)
        order = {"Trixie": 0, "Bookworm": 1, "Forky": 2}
        sel.sort(key=lambda e: order.get(e["codename"], 9))
        items = [((f"{e['codename']}   {e['arch']}"
                   + ("   ← DietPi-Standard" if e["codename"] == "Trixie" else "")), e) for e in sel]
        self.ask(f"2) Welche DietPi-Variante für {self.board}?", items)

    def _show_devices(self):
        self.stage = 2
        good, blocked = sdprep.safe_devices(sdprep.list_block_devices())
        self.devices = good
        for d in blocked:
            self.log_(f"[dim]gesperrt: {d['path']} ({d['reason']})[/]")
        items = [((f"{d['path']}   {d['size']}   {d['model'] or '—'}   [{d['tran'] or '?'}]"), d) for d in good]
        if not items:
            self.log_("[yellow]Keine Wechseldatenträger gefunden — Karte einstecken, dann [b]r[/b][/]")
        self.ask("3) Auf welche Karte? (nur Wechseldatenträger)", items)

    def _show_form(self):
        self.stage = 3
        self.form("4) Einstellungen — WLAN links wählen, Enter = weiter")
        self._items = []
        # Netze im Hintergrund holen: nmcli braucht ein bis zwei Sekunden, und
        # solange soll man die Felder schon ausfuellen koennen.
        self.run_worker(self._load_wifi, thread=True)

    def _load_wifi(self):
        try:
            netze = sdprep.wifi_networks()
        except Exception:
            netze = []
        self.app.call_from_thread(self._show_wifi, netze)

    def _show_wifi(self, netze):
        if self.stage != 3:
            return                       # inzwischen weitergeklickt
        lv = self.query_one(ListView)
        lv.clear()
        if not netze:
            lv.display = False
            self.log_("[dim]Keine WLAN-Liste verfügbar — SSID bitte eintippen.[/]")
            return
        aktiv = sdprep.wifi_active()
        # Das AKTIVE Netz zuoberst und markiert: nur dessen Schluessel ist
        # BEWIESEN richtig. Ein gespeichertes Profil kann veraltet sein — genau
        # so kam ein falscher Schluessel voller Ueberzeugung auf die Karte.
        netze.sort(key=lambda n: (n["ssid"] != aktiv, not n["gespeichert"], -n["signal"]))
        items = [("— kein WLAN (LAN) —", "")]
        items += [((f"{'» ' if n['ssid'] == aktiv else ('★ ' if n['gespeichert'] else '  ')}{n['ssid']}"
                    f"   {n['signal']}%   {n['security'] or 'offen'}"
                    + ("   ← dieser Rechner ist HIER online" if n["ssid"] == aktiv else "")),
                   n["ssid"]) for n in netze]
        for label, _ in items:
            lv.append(ListItem(Label(label)))
        self._items = items
        lv.display = True
        self.log_(f"[green]✓[/] {len(netze)} WLANs in Reichweite (★ = auf diesem Rechner gespeichert)")

    def _wifi_gewaehlt(self, ssid):
        self.query_one("#f_ssid", Input).value = ssid
        if ssid:
            # Kennt dieser Rechner das Netz, kennt er auch den Schlüssel — dann
            # muss ihn niemand abtippen. Der Wert wird NICHT protokolliert.
            schluessel = sdprep.wifi_secret(ssid)
            if schluessel:
                self.query_one("#f_wifikey", Input).value = schluessel
                aktiv = sdprep.wifi_active()
                if ssid == aktiv:
                    self.log_(f"[dim]WLAN: {ssid} — Passwort übernommen "
                              f"(dieser Rechner ist damit GERADE online, also stimmt es)[/]")
                elif aktiv:
                    self.log_(f"[yellow]WLAN: {ssid} — Passwort aus GESPEICHERTEM Profil "
                              f"übernommen. Ob es noch stimmt, ist UNGEPRÜFT — dieser "
                              f"Rechner ist gerade in '{aktiv}' online. Im Zweifel das "
                              f"aktive Netz wählen oder das Passwort überschreiben.[/]")
                else:
                    self.log_(f"[dim]WLAN: {ssid} — Passwort aus gespeichertem Profil übernommen[/]")
                self.query_one("#f_host", Input).focus()
                return
            self.log_(f"[dim]WLAN: {ssid} — jetzt noch das WLAN-Passwort[/]")
            self.query_one("#f_wifikey", Input).focus()
        else:
            self.log_("[dim]ohne WLAN (LAN)[/]")
            self.query_one("#f_host", Input).focus()

    def _show_confirm(self):
        self.stage = 4
        d, img = self.device, self.image
        self.log_("")
        self.log_(f"[b]Zusammenfassung[/]  {img['file']}")
        self.log_(f"  Ziel:        [b red]{d['path']}[/]  {d['size']}  {d['model'] or ''}")
        self.log_(f"  Hostname:    {self.cfg['hostname']}")
        self.log_(f"  WLAN:        {self.cfg['ssid'] or '— (LAN)'}")
        if self.cfg.get("debug_display"):
            self.log_("  Bildschirm:  [b]an[/] — der Erstboot ist auf dem Panel zu sehen")
        if self.cfg.get("diagnose"):
            self.log_("  Diagnose:    [b]an[/] — die Box schreibt ihren Funkzustand auf die Karte")
        self.log_("  Installiert: [b]nur der Agent[/] (alles Weitere macht der Controller)")
        if not self.allow_write:
            self.log_("[yellow]  Zum Schreiben wird gleich der Geraetename abgefragt[/]")
        # Rechte JETZT pruefen, nicht erst nach dem Herunterladen des Images:
        # in der TUI kann sudo nicht nach dem Passwort fragen, und ein Fehlschlag
        # nach mehreren Minuten Download ist die aergerlichste Variante davon.
        _sudo, _umg, _hinweis = sdprep.root_helper(interactive=False)
        if _sudo is None:
            self.log_(f"[red]  {_hinweis}[/]")
        elif _hinweis:
            self.log_(f"[dim]  {_hinweis}[/]")
        items = [(f"JA — {d['path']} überschreiben", True), ("Abbrechen", False)]
        self.ask(f"5) Alles auf {d['path']} wird GELÖSCHT. Fortfahren?", items)

    def on_list_view_selected(self, event):
        if self.busy:
            return
        idx = event.list_view.index
        if idx is None or idx >= len(getattr(self, "_items", [])):
            return
        value = self._items[idx][1]
        if self.stage == 0:
            self.board = value
            self._show_codenames()
        elif self.stage == 1:
            self.image = value
            self.log_(f"[green]✓[/] {value['file']}")
            self._show_devices()
        elif self.stage == 2:
            self.device = value
            self._show_form()
        elif self.stage == 3:
            self._wifi_gewaehlt(value)
        elif self.stage == 4:
            if value == "SCHREIBEN":          # zweite Bestaetigung erteilt
                self.allow_write = True
                self._start_work()
            elif value:
                self._start_work() if self.allow_write else self._zweite_frage()
            else:
                self.log_("[yellow]abgebrochen[/]")
                self._show_devices()

    def _zweite_frage(self):
        """Zweite, ausdrueckliche Bestaetigung statt des Abtippens.

        Die Sicherheit steckt ohnehin an einer frueheren Stelle: safe_devices
        bietet Systemplatten gar nicht erst an. Deshalb reicht hier eine bewusst
        gestellte zweite Frage — mit "Abbrechen" ZUERST, damit ein versehentlich
        gedruecktes Enter abbricht statt zu loeschen.
        """
        d = self.device
        self.log_(f"[b red]Letzte Warnung:[/] {d['path']} ({d['size']} {d['model'] or ''}) "
                  "wird vollstaendig ueberschrieben.")
        self.ask(f"6) Wirklich {d['path']} überschreiben?",
                 [("Nein, abbrechen", False), (f"JA — {d['path']} jetzt schreiben", "SCHREIBEN")])

    def on_input_submitted(self, event):
        if self.stage != 3:
            return
        self.cfg = {
            "hostname": self.query_one("#f_host", Input).value.strip() or "mixpi",
            "password": self.query_one("#f_pass", Input).value or "mupibox",
            "ssid": self.query_one("#f_ssid", Input).value.strip(),
            "wifikey": self.query_one("#f_wifikey", Input).value,
            "debug_display": bool(self.query_one("#f_debug", Checkbox).value),
            "diagnose": bool(self.query_one("#f_diag", Checkbox).value),
            "handy": bool(self.query_one("#f_handy", Checkbox).value),
            "lauf_paket": bool(self.query_one("#f_lauf", Checkbox).value),
        }
        self._show_confirm()

    # ---- Arbeit (Hintergrund-Thread) ------------------------------------
    def _start_work(self):
        self.stage = 5
        self.crumbs()
        self.busy = True
        self.query_one(ListView).display = False
        self.query_one("#form").display = False
        # WICHTIG: Fokus aus dem Eingabefeld nehmen. Fuer die Tipp-Bestaetigung
        # liegt er im Textfeld — bliebe er dort, landete danach JEDER Tastendruck
        # als Zeichen darin und weder q noch b kaemen je an ("man kommt nicht
        # mehr zurueck").
        self.set_focus(None)
        self.zeige_arbeit("Vorbereiten …", 0, 0)
        # Eigener Takt, damit sich der Dreher auch dann bewegt, wenn gerade
        # keine Meldung kommt (Prüfsumme, Aushängen) — sonst wirkt es tot.
        if self._ticker is None:
            self._ticker = self.set_interval(0.12, self._tick)
        self.run_worker(self._work, thread=True)

    def _work(self):
        L = lambda m: self.app.call_from_thread(self.log_, m)   # noqa: E731
        try:
            os.makedirs(CACHE, exist_ok=True)
            img = os.path.join(CACHE, self.image["file"])
            if os.path.isfile(img):
                L(f"[dim]Image schon geladen: {img}[/]")
            else:
                L(f"↓ lade {self.image['file']} …")

                def prog(got, total):
                    self.setze_arbeit("Abbild laden", got, total)
                sdprep.download(self.image["url"], img, prog)
                L("[green]✓[/] geladen")

            want = sdprep.fetch_sha256(self.image)
            if want:
                self.setze_arbeit("Prüfsumme prüfen", 0, 0)
                L("… prüfe SHA256")
                got = sdprep.sha256_file(img)
                if got != want:
                    L(f"[red]✗ Prüfsumme falsch![/] erwartet {want[:16]}…, ist {got[:16]}…")
                    return
                L("[green]✓[/] Prüfsumme stimmt")
            else:
                L("[yellow]![/] keine Prüfsumme verfügbar")

            L(f"→ schreibe auf {self.device['path']}")
            gesamt = sdprep.image_size(img)
            self.setze_arbeit("Auf die Karte schreiben", 0, gesamt)

            def schreibzeile(zeile):
                # Der Fortschritt gehört in den festen Balken, nicht ins
                # Protokoll — sonst scrollt er alles Lesbare weg. Zwei Formen,
                # je nachdem WER schreibt: dd meldet Bytes, rpi-imager Prozente
                # (und danach noch einen Prüflauf).
                b = sdprep.parse_dd_progress(zeile)
                if b is not None:
                    self.setze_arbeit(None, b, None)
                    return
                pz, abschnitt = sdprep.parse_percent(zeile)
                if pz is not None:
                    self.setze_arbeit("Karte überprüfen" if abschnitt == "verify" else None,
                                      pz, 100)
                    return
                L(f"[dim]{zeile}[/]")
            rc = sdprep.write_image(img, self.device["path"],
                                    dry_run=not self.allow_write, interactive=False,
                                    on_line=schreibzeile)
            if rc not in (0, None):
                L(f"[red]✗ Schreiben fehlgeschlagen (Code {rc})[/]")
                return
            if rc is None:
                L("[yellow]Trockenlauf beendet — mit --write wird wirklich geschrieben.[/]")
                return

            self.setze_arbeit("Boot-Partition einhängen", 0, 0)
            L("→ Boot-Partition mounten")
            mp = sdprep.mount_boot(self.device["path"], dry_run=False, interactive=False,
                                   on_line=lambda s: L(f"[dim]{s}[/]"))
            if not mp:
                L("[red]✗ Boot-Partition nicht gemountet[/] (Karte neu einstecken und manuell mounten)")
                return
            self.setze_arbeit("Einstellungen schreiben", 0, 0)
            wifi = {"ssid": self.cfg["ssid"], "key": self.cfg["wifikey"]} if self.cfg["ssid"] else None
            written = sdprep.prepare_boot(mp, password=self.cfg["password"],
                                          hostname=self.cfg["hostname"], wifi=wifi,
                                          ssh_pubkey=sdprep.default_pubkey(create=True),
                                          debug_display=self.cfg.get("debug_display", False),
                                          diagnose=self.cfg.get("diagnose", False),
                                          handy=self.cfg.get("handy", False),
                                          lauf_paket=self.cfg.get("lauf_paket", False),
                                          bildname=(self.image or {}).get("file", ""))
            for w in written:
                L(f"[green]✓[/] {w}")

            # DER VORSTART-DIENST gehoert auf die ROOT-Partition. Einen Haken
            # vor dem Netz gibt es auf der Boot-Partition nicht — der Name
            # Automation_Custom_PreScript.sh kommt im DietPi-Abbild nirgends
            # vor. Ohne diesen Schritt startet die Box NICHT ohne Netz.
            vdir = os.path.join(mp, "einrichtung", "vorstart")
            if self.cfg.get("handy") and os.path.isdir(vdir):
                self.setze_arbeit("Vorstart einrichten", 0, 0)
                L("")
                if sdprep.root_bestuecken(self.device["path"], vdir,
                                          interactive=False,
                                          on_line=lambda t: L(f"[dim]{t}[/]")):
                    L("[green]✓[/] Vorstart auf der Root-Partition eingeschaltet")
                else:
                    L("[yellow]![/] Vorstart NICHT eingerichtet — der erste Start "
                      "braucht dann Kabel oder ein WLAN auf der Karte")

            # NACHLESEN statt hoffen: mehrere Läufe scheiterten still und der
            # Fehler zeigte sich erst beim Booten der Box. Jetzt sagt die Karte
            # selbst, ob wirklich drauf ist, was drauf sein soll.
            self.setze_arbeit("Karte nachlesen", 0, 0)
            L("")
            L("[b]Nachgelesen von der Karte:[/]")
            schlecht = 0
            for ok, text in sdprep.verify_boot(mp, wifi=wifi,
                                               debug_display=self.cfg.get("debug_display", False),
                                               diagnose=self.cfg.get("diagnose", False),
                                               hostname=self.cfg["hostname"]):
                L(f"  [green]✓[/] {text}" if ok else f"  [red]✗ {text}[/]")
                schlecht += (not ok)
            if schlecht:
                L(f"[b red]{schlecht} Prüfung(en) fehlgeschlagen — bitte melden, "
                  f"bevor die Karte in die Box geht.[/]")
            else:
                L("[green]Alles wie vorgesehen.[/]")
            if self.cfg.get("diagnose"):
                L("")
                L("[b]So geht die Fehlersuche weiter:[/]")
                L("  1. Karte in die Box, einschalten, [b]~4 Minuten[/b] warten")
                if self.cfg.get("debug_display"):
                    L("     (der Schirm zeigt 'WLAN-Diagnose Runde n/20')")
                else:
                    L("     (ohne Bildschirm-Haken bleibt das Panel dunkel — die "
                      "Diagnose läuft trotzdem)")
                L("  2. Box ausschalten, Karte zurück in diesen Rechner")
                L("  3. [b]./sdprep --diagnose[/b] — deutet den Befund der Box")
            L("")
            L("[b green]Fertig.[/] Karte auswerfen, in die Box, einschalten — dann:")
            L(f"  ./connect {self.cfg['hostname']} --install   [dim]# bringt den Agent hin + pairt[/]")
            L("  ./tui --recipe mupibox        [dim]# System  (g = alle Schritte)[/]")
            L("  ./tui --recipe mupibox-app    [dim]# App aus dem Fork[/]")
        except Exception as e:
            L(f"[red]Fehler: {e}[/]")
        finally:
            self.busy = False
            if self._ticker is not None:
                self._ticker.stop()
                self._ticker = None
            self.app.call_from_thread(self._arbeit_fertig)
            L("")
            L("[dim]  [b]q[/b] = " + ("beenden" if self.standalone else "zurueck zur Schrittliste")
              + "   ·   [b]b[/b] = noch eine Karte schreiben[/]")

    # ---- Tasten ----------------------------------------------------------
    def action_back(self):
        if self.busy:
            return
        if self.stage == 1:
            self._show_boards()
        elif self.stage == 2:
            self._show_codenames()
        elif self.stage == 3:
            self._show_devices()
        elif self.stage == 4:
            self._show_form()
        elif self.stage == 5:
            self._show_devices()      # fertig -> noch eine Karte schreiben

    def action_refresh(self):
        if self.stage == 2 and not self.busy:
            self._show_devices()

    def action_choose(self):
        lv = self.query_one(ListView)
        if lv.display and lv.index is not None:
            lv.action_select_cursor()

    def action_close(self):
        if self.busy:
            # Notausfahrt: einmal warnen, beim zweiten Mal trotzdem gehen.
            # Bliebe es beim blossen Verweigern, sperrte eine haengende Arbeit
            # (z. B. ein unbeantworteter Rechte-Dialog) den Assistenten fuer
            # immer zu — man kaeme nicht mehr heraus.
            if not getattr(self, "_raus_gedrueckt", False):
                self._raus_gedrueckt = True
                self.log_("[yellow]laeuft noch — nochmal [b]q[/b], um trotzdem zu schliessen "
                          "(die Karte ist dann womoeglich unvollstaendig)[/]")
                return
            self.log_("[red]abgebrochen, obwohl noch gearbeitet wurde[/]")
        if self.standalone:
            self.app.exit()
        else:
            # dismiss(), NICHT pop_screen(): nur so laeuft der Rueckruf der
            # Haupt-TUI, die damit ihren Titel wiederherstellt.
            self.dismiss()

    def action_cycle_theme(self):
        try:
            i = (self.THEMES.index(self.app.theme) + 1) % len(self.THEMES)
        except ValueError:
            i = 0
        self.app.theme = self.THEMES[i]


class SdApp(App):
    """Eigener Starter (`./sdtui`) — schiebt denselben Screen wie die Haupt-TUI.

    Bewusst nur eine Huelle: die gesamte Mechanik steckt in SdScreen, damit
    beide Wege garantiert dasselbe tun und nichts doppelt gepflegt wird.
    """

    def __init__(self, write=False):
        super().__init__()
        self._write = write

    def on_mount(self):
        self.push_screen(SdScreen(write=self._write, standalone=True))


def main():
    import argparse
    ap = argparse.ArgumentParser(description="SD-Assistent (TUI)")
    ap.add_argument("--write", action="store_true",
                    help="ohne Rueckfrage schreiben (sonst: Geraetename eintippen)")
    a = ap.parse_args()
    SdApp(write=a.write).run()


if __name__ == "__main__":
    main()
