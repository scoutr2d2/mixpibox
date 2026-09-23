#!/usr/bin/env python3
"""Was macht der VORSCHLAG kaputt? — Knopfsperre aus zwei Bedingungen.

WOZU: `tools/kartenknopf-ohne-werkzeug-probe.py` hat gemessen, DASS der
Suchtakt die Sperre „kein Schreibwerkzeug" wieder aufhebt (sdstart.py:735
setzt `sperren(self.karte is None)` ohne das Werkzeug zu fragen). Der
vorgeschlagene Ersatz lautet

    self.knopf.sperren(self.karte is None or not schreibweg()[0])

Diese Probe misst nicht, ob der Vorschlag den Fehler behebt (das ist die
leichte Haelfte), sondern ob er einen LEGITIMEN Fall mitnimmt. Drei Laeufe,
und alle drei muessen stimmen — sonst ist der Vorschlag nicht gefahrlos:

  1. ohne Werkzeug   -> Knopf bleibt nach dem Takt ZU   (der Zweck)
  2. mit xz+dd       -> Knopf ist nach dem Takt SCHARF  (Gegenprobe: die neue
                        Bedingung darf nicht dauerhaft zusperren, sonst waere
                        ein gruener Lauf 1 nur ein kaputter Knopf)
  3. Windows         -> Knopf ist nach dem Takt SCHARF. Unter Windows gibt es
                        weder xz noch dd, aber `write_image` hat dort einen
                        EIGENEN Schreibweg (geraete.windows_schreiben), und
                        `schreibweg()` meldet darum 'eingebaut'. Wer statt
                        `schreibweg()[0]` auf `which('xz')` prueft, sperrt
                        Windows komplett aus — deshalb steht dieser Lauf hier.

Zusaetzlich wird die Laufzeit von `schreibweg()` gemessen: der Vorschlag ruft
sie alle TAKT_MS=2000 ms im Oberflaechen-Faden auf.

Es wird nichts geladen und nichts geschrieben: `karten_finden` ist ersetzt,
der Pfad zeigt ins Leere, das Fenster laeuft im Trockenmodus.

AUFRUF
    xvfb-run -a python3 tools/vorschlag-knopfsperre-nebenwirkung.py
Rueckgabe: 0 = alle drei Laeufe wie erwartet, 1 = der Vorschlag greift daneben.
"""
import os
import sys
import time

HIER = os.path.dirname(os.path.abspath(__file__))
STEUER = os.path.join(os.path.dirname(HIER), 'remote-step-installer', 'controller')
sys.path.insert(0, STEUER)

import geraete                                              # noqa: E402
import sdstart                                              # noqa: E402

ATTRAPPE = [{'pfad': '/dev/GIBTESNICHT', 'name': 'attrappe',
             'modell': 'SanDisk Ultra (Attrappe)', 'groesse': '32G',
             'wechselbar': True}]
geraete.karten_finden = lambda *a, **k: list(ATTRAPPE)


def _karte_zeigen_vorschlag(self):
    """`_karte_zeigen` GENAU wie vorgeschlagen — zweite Bedingung dazu."""
    gross, klein = self._karte_text()
    if hasattr(self, 'l_karte') and self.l_karte.winfo_exists():
        self.l_karte.configure(text=gross)
        self.l_wo.configure(text=klein)
        self.knopf.sperren(self.karte is None or not sdstart.schreibweg()[0])


sdstart.Fenster._karte_zeigen = _karte_zeigen_vorschlag


def lauf(titel, weg):
    """Ein Fenster aufbauen, drei Takte laufen lassen, den Knopf ablesen."""
    sdstart.schreibweg = lambda: weg
    befund = {}
    f = sdstart.Fenster(board='RPi5', trocken=True)
    f.update()
    f._seite_karte()
    f.update()
    befund['aufbau'] = f.knopf.an

    def spaeter():
        befund['nach_dem_takt'] = f.knopf.an
        f.destroy()

    f.after(int(sdstart.Fenster.TAKT_MS) + 1200, spaeter)
    f.mainloop()
    print(f"{titel:22s} Aufbau: {'scharf' if befund['aufbau'] else 'gesperrt':8s} "
          f"nach dem Takt: {'SCHARF' if befund['nach_dem_takt'] else 'GESPERRT'}")
    return befund['nach_dem_takt']


ohne = lauf('ohne Werkzeug', (None, 'nichts da', 'rpi-imager'))
mit = lauf('mit xz+dd', ('dd', 'xz | dd', 'rpi-imager'))
win = lauf('Windows (eingebaut)', ('eingebaut', 'Windows: eingebauter Weg', None))

# Wie teuer ist der Aufruf, der jetzt alle 2000 ms faellt? (echtes schreibweg)
import importlib                                             # noqa: E402
importlib.reload(sdstart)
t0 = time.perf_counter()
for _ in range(100):
    sdstart.schreibweg()
dauer = (time.perf_counter() - t0) / 100 * 1000
print(f"\nschreibweg() kostet {dauer:.3f} ms je Aufruf "
      f"(faellt alle {sdstart.Fenster.TAKT_MS} ms)")

gut = (not ohne) and mit and win
print("\nBEFUND: " + ("der Vorschlag sperrt genau den einen Fall — und nur ihn."
                      if gut else
                      "der Vorschlag greift daneben (siehe die Zeile, die nicht passt)."))
sys.exit(0 if gut else 1)
