#!/usr/bin/env python3
"""SD-Karte fuer die MixPiBox vorbereiten — mit Fenster, auf jedem System.

WOZU NEBEN DER TUI: `./sdtui` verlangt ein Terminal und setzt voraus, dass man
weiss, was ein Terminal ist. Wer eine Box geschenkt bekommt und sie neu
aufsetzen will, hat das nicht. Diese Oberflaeche macht dasselbe, nur mit
Maus — und auf Windows und macOS, wo es die TUI nie gab.

TKINTER, und zwar mit Absicht: es liegt in der Standardbibliothek. Ein
Installer, der erst einen Installer braucht (pip, Qt, Electron), wird nicht
benutzt. Dieselbe Ueberlegung wie beim Agenten, der ohne pip auskommt.

WAS HIER NICHT NOCH EINMAL GEBAUT WIRD: die Bildliste, das Vorbereiten der
Boot-Partition und das Schnueren des Laufpakets stehen in `sdprep.py` und
`laufpaket.py` und sind laengst plattformfrei. Was je System verschieden ist —
Karten finden, beschreiben, einhaengen — steht gesammelt in `geraete.py`.
Diese Datei ist NUR die Oberflaeche.

DIE GEFAEHRLICHE STELLE, und wie sie hier abgesichert ist: ein falsch
gewaehlter Datentraeger loescht die Platte, auf der man arbeitet. Deshalb
  * werden nur Wechseldatentraeger ueberhaupt angeboten,
  * steht alles Ausgeschlossene MIT GRUND daneben (sonst sucht man den
    fehlenden Eintrag und haelt das Programm fuer kaputt),
  * und vor dem Schreiben muss der Geraetename ABGETIPPT werden. Ein Knopf
    ist zu leicht getroffen; die TUI macht es aus demselben Grund so.

AUFRUF
    ./sdgui                       (oder: python3 controller/sdgui.py)
"""
import os
import queue
import sys
import threading
import traceback

HIER = os.path.dirname(os.path.abspath(__file__))
if HIER not in sys.path:
    sys.path.insert(0, HIER)

try:
    import tkinter as tk
    from tkinter import ttk, messagebox
except ImportError:
    sys.exit("Tkinter fehlt.\n"
             "  Debian/Ubuntu:  sudo apt install python3-tk\n"
             "  Fedora:         sudo dnf install python3-tkinter\n"
             "  Arch:           sudo pacman -S tk\n"
             "  (Windows und macOS bringen es mit.)")

import geraete                                              # noqa: E402
import sdprep                                               # noqa: E402

CACHE = os.path.expanduser("~/.cache/remote-step-installer")
BOARDS = ["RPi5", "RPi4", "RPi3", "RPi2", "RPi1"]


class Anwendung(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("MixPiBox — SD-Karte vorbereiten")
        self.geometry("760x620")
        self.minsize(680, 560)

        self.bilder = []
        self.karten = []
        self.blockiert = []
        self.meldungen = queue.Queue()
        self.arbeitet = False

        self._bauen()
        self.after(120, self._meldungen_holen)
        self.bilder_laden()

    # ── Aufbau ─────────────────────────────────────────────────────────────
    def _bauen(self):
        aussen = ttk.Frame(self, padding=12)
        aussen.pack(fill="both", expand=True)

        ttk.Label(aussen, text="SD-Karte fuer die MixPiBox vorbereiten",
                  font=("", 14, "bold")).pack(anchor="w")
        ttk.Label(aussen, foreground="#666",
                  text="Board und Fassung waehlen, Karte aussuchen, Einstellungen setzen."
                  ).pack(anchor="w", pady=(0, 10))

        # -- Board + Fassung
        oben = ttk.LabelFrame(aussen, text="1. Was wird bespielt", padding=8)
        oben.pack(fill="x", pady=4)
        zeile = ttk.Frame(oben); zeile.pack(fill="x")
        ttk.Label(zeile, text="Board:").pack(side="left")
        self.board = tk.StringVar(value="RPi5")
        w = ttk.Combobox(zeile, textvariable=self.board, values=BOARDS,
                         state="readonly", width=8)
        w.pack(side="left", padx=(4, 16))
        w.bind("<<ComboboxSelected>>", lambda e: self.bilder_laden())
        ttk.Label(zeile, text="DietPi:").pack(side="left")
        self.bild = tk.StringVar()
        self.bild_wahl = ttk.Combobox(zeile, textvariable=self.bild, state="readonly",
                                      width=44)
        self.bild_wahl.pack(side="left", padx=4, fill="x", expand=True)

        # -- Karte
        mitte = ttk.LabelFrame(aussen, text="2. Auf welche Karte", padding=8)
        mitte.pack(fill="x", pady=4)
        zeile2 = ttk.Frame(mitte); zeile2.pack(fill="x")
        self.karte = tk.StringVar()
        self.karten_wahl = ttk.Combobox(zeile2, textvariable=self.karte,
                                        state="readonly", width=52)
        self.karten_wahl.pack(side="left", fill="x", expand=True)
        ttk.Button(zeile2, text="Neu suchen", command=self.karten_suchen
                   ).pack(side="left", padx=(6, 0))
        self.karten_hinweis = ttk.Label(mitte, foreground="#a60", text="", wraplength=690)
        self.karten_hinweis.pack(anchor="w", pady=(6, 0))

        # -- Einstellungen
        unten = ttk.LabelFrame(aussen, text="3. Einstellungen", padding=8)
        unten.pack(fill="x", pady=4)
        gitter = ttk.Frame(unten); gitter.pack(fill="x")
        self.hostname = tk.StringVar(value="mixpi")
        self.passwort = tk.StringVar(value="mupibox")
        self.ssid = tk.StringVar()
        self.wlanpw = tk.StringVar()
        for i, (text, var, geheim) in enumerate([
                ("Name der Box", self.hostname, False),
                ("Passwort (dietpi/root)", self.passwort, False),
                ("WLAN-Name (leer = Kabel)", self.ssid, False),
                ("WLAN-Passwort", self.wlanpw, True)]):
            ttk.Label(gitter, text=text + ":").grid(row=i, column=0, sticky="w", pady=2)
            e = ttk.Entry(gitter, textvariable=var, width=34,
                          show="•" if geheim else "")
            e.grid(row=i, column=1, sticky="w", padx=6, pady=2)

        self.handy = tk.BooleanVar(value=True)
        self.lauf = tk.BooleanVar(value=True)
        self.schirm = tk.BooleanVar(value=False)
        ttk.Checkbutton(unten, variable=self.handy, command=self._abhaengig,
                        text="Einrichtung per Handy — die Box zeigt einen QR-Code, "
                             "das Telefon uebernimmt").pack(anchor="w", pady=(8, 0))
        ttk.Checkbutton(unten, variable=self.lauf, command=self._abhaengig,
                        text="Lauf ohne PC — das Rezept reist mit, die Box "
                             "installiert sich selbst (~17 MB)").pack(anchor="w")
        # NICHT MEHR "Bildschirm anschalten": das Panel kommt beim Handy-Weg
        # von selbst (ohne es gaebe es keinen QR). Hier bleibt nur, was es
        # wirklich noch ist — die Textausgabe zum Mitlesen bei der Fehlersuche.
        ttk.Checkbutton(unten, variable=self.schirm,
                        text="Systemmeldungen auf dem Bildschirm zeigen "
                             "(nur zur Fehlersuche)").pack(anchor="w")

        # -- Tun
        tun = ttk.Frame(aussen); tun.pack(fill="x", pady=(10, 4))
        self.knopf = ttk.Button(tun, text="Karte schreiben …", command=self.schreiben)
        self.knopf.pack(side="left")
        # DER ZWEITE WEG, und er wird oefter gebraucht als man denkt: das
        # Schreiben klappt, und erst das Einhaengen der Boot-Partition geht
        # schief (der Schreibtisch war schneller, die Partitionstabelle war
        # noch alt). Dann ist die Karte in Ordnung und nur die Vorbereitung
        # fehlt — 20 Minuten Schreiben noch einmal waeren Unfug.
        self.knopf2 = ttk.Button(tun, text="Nur vorbereiten",
                                 command=self.nur_vorbereiten)
        self.knopf2.pack(side="left", padx=(6, 0))
        self.balken = ttk.Progressbar(tun, mode="determinate", length=280)
        self.balken.pack(side="left", padx=12, fill="x", expand=True)

        self.protokoll = tk.Text(aussen, height=9, wrap="word", state="disabled",
                                 background="#111", foreground="#ddd",
                                 insertbackground="#ddd")
        self.protokoll.pack(fill="both", expand=True, pady=(6, 0))
        self.sagen(geraete.rechte_hinweis())
        if not geraete.ist_linux():
            self.sagen("HINWEIS: Auf diesem System ist der Schreibweg gebaut, aber "
                       "nicht am Geraet erprobt — belegt ist bisher nur Linux.")

    def _abhaengig(self):
        # Ein Lauf ohne PC braucht den Handy-Weg: dort sitzt der Startknopf.
        if self.lauf.get():
            self.handy.set(True)

    # ── Ausgabe ────────────────────────────────────────────────────────────
    def sagen(self, text):
        self.meldungen.put(("text", text))

    def fortschritt(self, anteil):
        self.meldungen.put(("balken", anteil))

    def _meldungen_holen(self):
        """Alles, was aus dem Arbeitsfaden kommt, landet HIER im Hauptfaden.

        Tkinter vertraegt keine Zugriffe aus fremden Faeden — es stuerzt nicht
        zuverlaessig ab, sondern manchmal, und dann sucht man an der falschen
        Stelle. Deshalb die Warteschlange.
        """
        try:
            while True:
                art, wert = self.meldungen.get_nowait()
                if art == "text":
                    self.protokoll.configure(state="normal")
                    self.protokoll.insert("end", str(wert).rstrip() + "\n")
                    self.protokoll.see("end")
                    self.protokoll.configure(state="disabled")
                elif art == "balken":
                    self.balken["value"] = max(0, min(100, float(wert)))
                elif art == "bilder":
                    self.bilder = wert
                    namen = [f"{b['codename']} · {b['file']}" for b in wert]
                    self.bild_wahl["values"] = namen
                    if namen:
                        # TRIXIE VORWAEHLEN, nicht das alphabetisch erste. Die
                        # Liste kommt sortiert, und "Bookworm" steht vor
                        # "Trixie" — wer nicht hinsieht, bespielt die Karte mit
                        # dem VORLETZTEN Debian. Gesehen im ersten Bild der
                        # Oberflaeche.
                        vorwahl = next((i for i, b in enumerate(wert)
                                        if b.get("codename", "").lower() == "trixie"), 0)
                        self.bild_wahl.current(vorwahl)
                elif art == "karten":
                    self._karten_zeigen(*wert)
                elif art == "fertig":
                    self.arbeitet = False
                    self.knopf.configure(state="normal")
                    self.knopf2.configure(state="normal")
        except queue.Empty:
            pass
        self.after(120, self._meldungen_holen)

    # ── Bildliste ──────────────────────────────────────────────────────────
    def bilder_laden(self):
        self.sagen(f"Suche DietPi-Fassungen fuer {self.board.get()} …")

        def arbeit():
            try:
                # `select(plain_only=True)` laesst die Sondervarianten
                # (AlloGUI, Amiberry) weg — wir wollen ein NACKTES System.
                alle = sdprep.fetch_index()
                liste = sdprep.select(alle, board=self.board.get(), plain_only=True)
                self.meldungen.put(("bilder", liste))
                self.sagen(f"  {len(liste)} Fassungen fuer {self.board.get()} "
                           f"(von {len(alle)} insgesamt).")
            except Exception as e:                           # noqa: BLE001
                self.sagen(f"  Bildliste nicht erreichbar: {e}")
        threading.Thread(target=arbeit, daemon=True).start()

    # ── Karten ─────────────────────────────────────────────────────────────
    def karten_suchen(self):
        self.sagen("Suche Wechseldatentraeger …")

        def arbeit():
            self.meldungen.put(("karten", geraete.karten_finden()))
        threading.Thread(target=arbeit, daemon=True).start()

    def _karten_zeigen(self, ok, blockiert):
        self.karten, self.blockiert = ok, blockiert
        eintraege = [f"{k['pfad']}  ·  {k['groesse']}  ·  {k['modell'] or 'ohne Namen'}"
                     for k in ok]
        self.karten_wahl["values"] = eintraege
        if eintraege:
            self.karten_wahl.current(0)
            self.sagen(f"  {len(eintraege)} Karte(n) verwendbar.")
        else:
            self.karte.set("")
            self.sagen("  Keine verwendbare Karte gefunden.")
        # WAS AUSGESCHLOSSEN WURDE, GEHOERT DAZU: sonst sucht jemand seine
        # Karte in der Liste, findet sie nicht und haelt das Programm fuer
        # kaputt — dabei ist der Ausschluss genau richtig.
        if blockiert:
            self.karten_hinweis.configure(
                text="Nicht angeboten: " + " · ".join(
                    f"{b['pfad']} ({b['grund']})" for b in blockiert[:4]))
        else:
            self.karten_hinweis.configure(text="")

    # ── Schreiben ──────────────────────────────────────────────────────────
    def schreiben(self):
        if self.arbeitet:
            return
        if not self.bilder or not self.bild.get():
            messagebox.showwarning("Fehlt", "Erst eine DietPi-Fassung waehlen.")
            return
        if not self.karten or not self.karte.get():
            messagebox.showwarning("Fehlt", "Erst eine Karte waehlen (»Neu suchen«).")
            return
        karte = self.karten[self.karten_wahl.current()]

        # ABTIPPEN, NICHT ANKLICKEN. Ein Knopf ist zu leicht getroffen, und auf
        # der falschen Zeile steht die Systemplatte.
        eingabe = _abfrage(self, "Wirklich schreiben?",
                           f"ALLES auf {karte['pfad']} wird geloescht.\n"
                           f"({karte['groesse']}, {karte['modell'] or 'ohne Namen'})\n\n"
                           f"Zum Bestaetigen den Geraetenamen abtippen:",
                           karte["pfad"])
        if eingabe != karte["pfad"]:
            self.sagen("Abgebrochen — der Name stimmte nicht.")
            return

        self.arbeitet = True
        self.knopf.configure(state="disabled")
        bild = self.bilder[self.bild_wahl.current()]
        threading.Thread(target=self._arbeit_schreiben, args=(bild, karte),
                         daemon=True).start()

    def nur_vorbereiten(self):
        """Eine SCHON geschriebene Karte fertig einrichten."""
        if self.arbeitet:
            return
        if not self.karten or not self.karte.get():
            messagebox.showwarning("Fehlt", "Erst eine Karte waehlen (»Neu suchen«).")
            return
        if not self.bilder or not self.bild.get():
            messagebox.showwarning("Fehlt", "Auch hier wird die DietPi-Fassung "
                                            "gebraucht — sie bestimmt, welche "
                                            "Python-Pakete mitkommen.")
            return
        karte = self.karten[self.karten_wahl.current()]
        bild = self.bilder[self.bild_wahl.current()]
        self.arbeitet = True
        self.knopf.configure(state="disabled")
        self.knopf2.configure(state="disabled")
        threading.Thread(target=self._arbeit_vorbereiten, args=(bild, karte),
                         daemon=True).start()

    def _arbeit_vorbereiten(self, bild, karte):
        try:
            self.sagen(f"Bereite {karte['pfad']} vor (ohne neu zu schreiben) …")
            self._boot_teil(bild, karte)
        except Exception as e:                               # noqa: BLE001
            self.sagen(f"ABGEBROCHEN: {e}")
        finally:
            self.meldungen.put(("fertig", None))

    def _boot_teil(self, bild, karte):
        """Boot-Partition einhaengen, bestuecken, wieder trennen.

        EIGENE FUNKTION, weil beide Wege sie brauchen — nach dem Schreiben und
        allein. Zweimal dasselbe waere zweimal zu pflegen.
        """
        mp = geraete.boot_mounten(karte["pfad"], melden=self.sagen)
        if not mp:
            self.sagen("FEHLER: Boot-Partition nicht eingehaengt.")
            self.sagen("  Die Karte ist deswegen NICHT kaputt — nur die")
            self.sagen("  Vorbereitung fehlt. Karte kurz abziehen, neu")
            self.sagen("  einstecken, »Neu suchen«, dann »Nur vorbereiten«.")
            return False
        self.sagen(f"  eingehaengt: {mp}")

        wifi = ({"ssid": self.ssid.get(), "key": self.wlanpw.get()}
                if self.ssid.get().strip() else None)
        geschrieben = sdprep.prepare_boot(
            mp, password=self.passwort.get() or "mupibox",
            hostname=self.hostname.get() or "mixpi", wifi=wifi,
            ssh_pubkey=sdprep.default_pubkey(create=True),
            debug_display=self.schirm.get(),
            handy=self.handy.get(), lauf_paket=self.lauf.get(),
            bildname=bild["file"])
        for z in geschrieben:
            self.sagen(f"  ✓ {z}")

        # DER VORSTART-DIENST liegt auf der ROOT-Partition, nicht auf Boot:
        # einen Haken vor dem Netz gibt es dort nicht (Automation_Custom_
        # PreScript.sh existiert im DietPi-Abbild nirgends). Ohne diesen
        # Schritt startet die Box NICHT ohne Netz.
        vdir = os.path.join(mp, "einrichtung", "vorstart")
        if self.handy.get() and os.path.isdir(vdir):
            self.sagen("Richte den Vorstart auf der Root-Partition ein …")
            if not sdprep.root_bestuecken(karte["pfad"], vdir,
                                          interactive=False, on_line=self.sagen):
                self.sagen("  ✗ Vorstart NICHT eingerichtet — siehe unten.")

        # NACHLESEN STATT HOFFEN — der teuerste Fehler dieses Projekts war
        # eine Karte, die fertig AUSSAH: Boot vollstaendig, Root leer, und die
        # Box startete trotzdem nicht ohne Netz. Wer nur meldet, was er
        # geschrieben HAT, meldet nicht, was auf der Karte STEHT.
        self.sagen("")
        self.sagen("Nachgelesen von der Karte:")
        vollstaendig, zeilen = sdprep.karte_fertig(mp, karte["pfad"])
        for gut, text in zeilen:
            self.sagen(f"  {'✓' if gut else '✗'} {text}")

        geraete.boot_aushaengen(mp, melden=self.sagen)
        self.sagen("")
        if not vollstaendig:
            self.sagen("DIE KARTE IST NICHT FERTIG. Was mit ✗ steht, fehlt.")
            self.sagen("  Meist sind es die Rechte fuer die Root-Partition.")
            self.sagen("  Nachtragen ohne neu zu schreiben:")
            self.sagen("    sudo python3 tools/vorstart-nachtragen.py")
            return False
        self.sagen("FERTIG. Karte in die Box, Strom dran.")
        if self.handy.get():
            self.sagen("Die Box zeigt einen QR-Code auf ihrem Bildschirm — "
                       "Handy-Kamera drauf halten.")
        if self.lauf.get():
            self.sagen("Im Assistenten dann »Installation starten« antippen.")
        return True

    def _arbeit_schreiben(self, bild, karte):
        try:
            # RECHTE ZUERST. Sie werden an zwei Stellen gebraucht (Abbild
            # schreiben, Root-Partition bestuecken). Fragt man erst dort, kommt
            # die zweite Abfrage nach zwanzig Minuten Warten — und dann sitzt
            # niemand mehr davor. Genau so ist am 08.08.2026 eine Karte
            # entstanden, die fertig aussah und den Vorstart nicht hatte.
            self.sagen("Rechte holen (einmal, gilt fuer den ganzen Lauf) …")
            if not sdprep.rechte_vorab_holen(interactive=False, on_line=self.sagen):
                self.sagen("ABGEBROCHEN: ohne Rechte laesst sich keine Karte "
                           "schreiben. Nichts wurde angefasst.")
                return
            ziel = os.path.join(CACHE, bild["file"])
            os.makedirs(os.path.dirname(ziel), exist_ok=True)
            if os.path.isfile(ziel) and os.path.getsize(ziel) > 0:
                self.sagen(f"Abbild liegt schon vor: {os.path.basename(ziel)}")
            else:
                self.sagen(f"Lade {bild['file']} …")
                sdprep.download(bild["url"], ziel,
                                on_progress=lambda g, s: self.fortschritt(
                                    g * 100 / max(s, 1)))
            self.fortschritt(0)

            self.sagen(f"Schreibe auf {karte['pfad']} — das dauert einige Minuten.")
            if geraete.ist_windows():
                geraete.windows_schreiben(ziel, karte["pfad"],
                                          melden=lambda s: self.fortschritt(
                                              float(s.rstrip('%'))))
            else:
                sdprep.write_image(ziel, karte["pfad"], dry_run=False,
                                   interactive=False, on_line=self.sagen)
            self.sagen("Geschrieben. Haenge die Boot-Partition ein …")
            self._boot_teil(bild, karte)
        except Exception as e:                               # noqa: BLE001
            self.sagen(f"ABGEBROCHEN: {e}")
            self.sagen(traceback.format_exc(limit=3))
        finally:
            self.meldungen.put(("fertig", None))


def _abfrage(eltern, titel, text, platzhalter=""):
    """Ein Fenster, das eine EINGABE verlangt — nicht nur einen Klick."""
    fenster = tk.Toplevel(eltern)
    fenster.title(titel)
    fenster.transient(eltern)
    # DAS GREIFEN KOMMT GANZ UNTEN, nach `wait_visibility()`. Hier stand es,
    # und auf einem echten Schreibtisch stuerzt das ab: „grab failed: window
    # not viewable" — ein Fenster laesst sich erst greifen, wenn der
    # Fenstermanager es aufgezogen hat. Unter Xvfb (kein Fenstermanager)
    # gelingt es sofort, und genau deshalb faellt es im Test nicht auf.
    # Am 08.08.2026 im Schwesterfenster sdstart.py so passiert.
    ttk.Label(fenster, text=text, padding=12, justify="left").pack(anchor="w")
    var = tk.StringVar()
    feld = ttk.Entry(fenster, textvariable=var, width=40)
    feld.pack(padx=12, fill="x")
    feld.focus_set()
    ttk.Label(fenster, text=platzhalter, foreground="#888", padding=(12, 2)
              ).pack(anchor="w")
    ergebnis = {"wert": None}

    def ja():
        ergebnis["wert"] = var.get().strip()
        fenster.destroy()

    knoepfe = ttk.Frame(fenster, padding=12)
    knoepfe.pack(fill="x")
    # ABBRECHEN STEHT VORNE: ein versehentliches Enter soll abbrechen, nicht
    # loeschen. Dieselbe Regel wie in der TUI.
    ttk.Button(knoepfe, text="Abbrechen", command=fenster.destroy).pack(side="left")
    ttk.Button(knoepfe, text="Schreiben", command=ja).pack(side="right")
    fenster.bind("<Return>", lambda e: ja())
    fenster.bind("<Escape>", lambda e: fenster.destroy())
    # ERST SICHTBAR, DANN GREIFEN — die Begruendung steht oben bei `transient`.
    fenster.wait_visibility()
    fenster.grab_set()
    eltern.wait_window(fenster)
    return ergebnis["wert"]


def main():
    app = Anwendung()
    app.karten_suchen()
    app.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
