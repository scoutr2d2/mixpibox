#!/usr/bin/env python3
"""EIN KNOPF — die MixPi-Karte schreiben, ohne etwas zu wissen.

══ WOZU NEBEN `./sdgui` UND `./sdtui` ═══════════════════════════════════════
Betreiber, 08.08.2026: „ich hätte gerne noch einen einfacheren gui sd
installer im mixpi design quasi 'ein button' lösung klick alle läuft
automatisch, eine rückmeldung ob das überschreiben ok ist aber nicht mit
eintippen mit klicken, und warnung dass alle daten gelöscht werden."

`sdtui` und `sdgui` fragen sieben Dinge ab: Board, Abbild, Karte, WLAN,
Passwort, Rechnername, Haken. Das ist richtig, wenn man etwas Besonderes will.
Wer aber nur eine kaputte Box wiederhaben will, will keine sieben Fragen — der
will einen Knopf.

DIESE OBERFLAECHE ENTSCHEIDET ALLES SELBST und zeigt nur, was sie entschieden
hat. Geaendert wird nichts davon; wer etwas anderes braucht, nimmt `./sdgui`.

══ WAS SIE SELBST ENTSCHEIDET — UND WORAUS ══════════════════════════════════
  * DIE KARTE. Nur Wechseldatentraeger; alles andere ist ausgeschlossen und
    kommt gar nicht erst in die Liste (`geraete.karten_finden`). Steckt genau
    EINE, ist sie gesetzt. Stecken mehrere, MUSS gefragt werden — eine falsch
    geratene Platte ist nicht rueckgaengig zu machen.
  * DAS ABBILD. Das neueste schlichte DietPi fuer das gewaehlte Board, live
    von dietpi.com geholt und mit SHA256 geprueft (`sdprep.select`).
  * DAS WLAN. Das Netz, in dem DIESER Rechner GERADE online ist, samt
    Schluessel aus seinem eigenen Profil (`sdprep.wifi_active/wifi_secret`).
    Das ist der einzige Schluessel, von dem bewiesen ist, dass er stimmt — ein
    gespeichertes Fremdprofil kann veraltet sein, und genau so kam schon
    einmal ein falscher Schluessel voller Ueberzeugung auf eine Karte.
  * DEN SSH-SCHLUESSEL. Der dieses Rechners; fehlt er, wird einer erzeugt.
    Ohne ihn kaeme man an die frische Box nicht heran.

══ DIE GEFAEHRLICHE STELLE ═════════════════════════════════════════════════
Schreiben loescht die Karte vollstaendig. `sdgui` laesst deshalb den
Geraetenamen ABTIPPEN. Der Betreiber will das hier ausdruecklich nicht
(„nicht mit eintippen mit klicken") — also traegt die Sicherheit an anderer
Stelle:

  * Es werden NUR Wechseldatentraeger angeboten. Die Platte, auf der dieses
    Programm laeuft, steht nicht zur Wahl — sie kann gar nicht getroffen
    werden.
  * Die Rueckfrage nennt Geraet, Modell und Groesse AUSGESCHRIEBEN, damit man
    erkennt, ob es die gemeinte Karte ist.
  * Der loeschende Knopf ist NICHT der voreingestellte. Der Fokus liegt auf
    „Abbrechen", Eingabe und Escape brechen ab. Wer loescht, muss auf den
    roten Knopf ZIELEN.
  * Der rote Knopf sagt, was er tut („Karte löschen und schreiben"), nicht
    „OK". Ein „OK" beantwortet keine Frage, die man beim Lesen ueberflogen
    hat.

══ TKINTER, UND ZWAR MIT ABSICHT ════════════════════════════════════════════
Es liegt in der Standardbibliothek. Ein Installer, der erst einen Installer
braucht (pip, Qt, Electron), wird nicht benutzt — dieselbe Ueberlegung wie
beim Agenten, der ohne pip auskommt. Die Ecken sind deshalb mit Canvas
gemalt und nicht mit einem Themen-Paket.

══ WAS HIER NICHT NOCH EINMAL GEBAUT WIRD ═══════════════════════════════════
Abbildliste, Schreiben, Boot-Partition, Rechte: alles in `sdprep.py` und
`geraete.py`. Diese Datei ist NUR die Oberflaeche und die Reihenfolge.

══ VIER SEITEN, UND WARUM NICHT EINE ══════════════════════════════════════
Betreiber, 08.08.2026: „ich hätte gerne eine eingangseite wo man den pi
auswählt zwischen 4 und 5, es wird standardmässig trixie verwendet und auch
die settings zum einschalten vom screen ist gesetzt."

  1. WELCHER PI?  Das ist die einzige Frage, die dieses Programm NICHT selbst
     beantworten kann: Der Pi liegt beim Betreiber auf dem Tisch, nicht am
     Kabel. Alles andere sieht es (die Karte) oder weiss es (das Netz).
  2. DIE KARTE.   Was gefunden wurde, und der Knopf.
  3. ES LAEUFT.   Fortschritt und Protokoll.
  4. FERTIG.      „Karte in die MixPi stecken."

TRIXIE IST GESETZT, nicht das Neueste. dietpi.com bietet fuer beide Boards
Bookworm, Trixie und Forky an; Trixie ist DietPis eigener Standard und der
Stand, auf dem diese Box gemessen wurde (Debian 13, DietPi 10.5.2 — siehe
remote-step-installer/dateien/stueckliste.txt). „Das Neueste" waere Forky und
damit ein Stand, den hier niemand erprobt hat.

DER BILDSCHIRM IST VON ANFANG AN AN. `debug_display=True` haengt das
DSI-Panel in die config.txt (sdprep.config_debug). Ohne das richtet erst der
Controller die Anzeige ein — und genau dahin kommt man ja nicht, wenn die Box
nicht ins Netz findet. Ein schwarzer Schirm ist der Fall, in dem niemand mehr
sieht, was los ist.

AUFRUF
    ./sdstart                     (oder: python3 controller/sdstart.py)
    ./sdstart --board RPi4        Board vorwaehlen (die Seite fragt sonst)
    ./sdstart --probe             nur ansehen: Attrappen-Karte, KEIN Netz,
                                  kein Schreiben. Der Lauf wird nachgespielt.
    ./sdstart --trocken           der echte Probelauf: laedt und prueft das
                                  Abbild wirklich, schreibt aber nicht
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
    from tkinter import font as tkfont
except ImportError:                                          # pragma: no cover
    sys.exit("Tkinter fehlt — unter Debian/Ubuntu: sudo apt install python3-tk")

import geraete                                               # noqa: E402
import sdprep                                                # noqa: E402

# ══ DIE HAUSFARBEN ══════════════════════════════════════════════════════════
# Abgeschrieben aus NewDesign/app.css, Satz „Creme" — dieselben Werte, die die
# Box selbst zeigt. Wer sie dort aendert, aendert sie hier NICHT mit; das ist
# in Kauf genommen, weil dieses Fenster auf einem Rechner laeuft, der die Box
# vielleicht nie gesehen hat.
GRUND = '#FFF7EC'        # --bg
FLAECHE = '#FFFFFF'      # --surface
TINTE = '#2E2A3B'        # --ink
LEISE = '#8B8397'        # --muted
LINIE = '#F3EDE2'        # --line
KISSEN = '#FFE7C2'       # --hl
LILA = '#8B57FD'         # die Kopfhoerer des MixPi
UMRISS = '#00032B'       # sein Umriss
ROT = '#C4392A'          # die loeschende Tat — NICHT --accent, das heisst
                         # „laeuft gerade" und darf nicht auch „Gefahr" heissen
GRUEN = '#22A055'        # --laden-gruen: fertig

# ══ DIE BILDER ══════════════════════════════════════════════════════════════
# Betreiber, 08.08.2026: „ich habe auch noch nette bilder die würde ich dann in
# der 2ten runde einbauen." Deshalb steht hier eine LISTE und kein fester Pfad:
# Der erste Eintrag, den es gibt, wird genommen. Ein neues Bild kommt vorne
# dazu, und nichts anderes muss angefasst werden.
#
# Gesucht wird relativ zum Repo — seit dem 08.08.2026 liegen Installer und
# Oberflaeche im selben Baum (ZUGEZOGEN.md), der Weg nach oben stimmt also.
# Findet sich keines, malt `mixpi_malen()` den Kopf selbst; das Fenster geht
# nie wegen eines fehlenden Bildes kaputt.
WURZEL = os.path.dirname(os.path.dirname(HIER))
DATEIEN = os.path.join(HIER, '..', 'dateien')

# JE SEITE EIN BILD, gebaut von tools/sdstart-bilder.py aus den Quellen in
# NewDesign/bilder/quellen. Der Schluessel sagt, WO es haengt — nicht, was
# darauf zu sehen ist; so laesst sich ein Bild tauschen, ohne hier etwas zu
# aendern. Fehlt eines, malt `mixpi_malen()` den Kopf; das Fenster geht nie
# wegen eines fehlenden Bildes kaputt.
def seitenbild(name):
    p = os.path.join(DATEIEN, f'sdstart-{name}.png')
    return p if os.path.isfile(p) else None


def bild_finden():
    for p in (os.path.join(DATEIEN, 'mixpi-hoert.png'),
              os.path.join(WURZEL, 'NewDesign', 'bilder', 'mixpi-hoert.png')):
        if os.path.isfile(p):
            return p
    return None


def mixpi_malen(cv, x, y, gr=1.0):
    """Der MixPi-Kopf, mit Canvas gemalt — der Rueckfall ohne Bilddatei.

    Dieselben Formen wie NewDesign/bilder/favicon.svg, nur ohne SVG: ein
    Buegel, sechs Stifte, der Kopf, zwei Ohrmuscheln, zwei Augen. `gr` ist der
    Massstab, `x`/`y` die Mitte.
    """
    def k(*w):
        return [x + w[i] * gr if i % 2 == 0 else y + w[i] * gr for i in range(len(w))]

    cv.create_arc(*k(-52, -46, 52, 58), start=0, extent=180, style='arc',
                  outline=UMRISS, width=int(16 * gr))
    cv.create_arc(*k(-52, -46, 52, 58), start=0, extent=180, style='arc',
                  outline=LILA, width=int(10 * gr))
    for winkel, farbe in ((-44, '#00ACFD'), (-26, '#11DE47'), (-9, '#43719A'),
                          (9, '#FEEE04'), (26, '#FD34A2'), (44, '#FF7001')):
        import math
        a = math.radians(winkel)
        sx, sy = math.sin(a) * 62, -math.cos(a) * 62
        cv.create_oval(*k(sx - 8, sy - 8, sx + 8, sy + 8), fill=UMRISS, outline='')
        cv.create_oval(*k(sx - 5, sy - 5, sx + 5, sy + 5), fill=farbe, outline='')
    cv.create_oval(*k(-40, -2, 40, 82), fill='#FEFEFE', outline=UMRISS, width=int(8 * gr))
    for sx in (-72, 52):
        cv.create_rectangle(*k(sx, -12, sx + 20, 32), fill=LILA, outline=UMRISS,
                            width=int(7 * gr))
    for sx in (-18, 8):
        cv.create_oval(*k(sx, 30, sx + 12, 40), fill=UMRISS, outline='')


# ══ WOMIT WIRD GESCHRIEBEN? ═════════════════════════════════════════════════
#
# Betreiber, 08.08.2026: „wir benutzen den raspi imager? falls der nicht
# gefunden wird muessen wir fragen ob wir ihn runterladen sollen. sollen wir
# auch schauen ob rufus oder etcher da ist?"
#
# JA, rpi-imager ist die erste Wahl — er PRUEFT NACH DEM SCHREIBEN nach
# (sdprep.write_image). Fehlt er, nimmt derselbe Weg `xz -dc | dd`. Das
# schreibt genauso, prueft aber nichts: Ein Bildpunktfehler auf der Karte
# faellt dann erst auf, wenn die Box nicht startet.
#
# RUFUS UND ETCHER WERDEN NICHT GESUCHT, und das ist eine Entscheidung:
#   * Rufus laeuft nur auf Windows und ist ein reines Fenster-Programm ohne
#     brauchbare Kommandozeile. Fuer Windows gibt es hier ohnehin einen
#     eigenen, eingebauten Schreibweg (geraete.windows_schreiben).
#   * Etchers Kommandozeile (etcher-cli) ist seit Jahren eingestellt; was es
#     heute gibt, ist ein Electron-Fenster. Es fernzusteuern waere ein
#     bewegliches Teil mehr fuer nichts.
# Beide koennten nur das, was `dd` hier schon kann.
#
# DIE ECHTE LUECKE IST `xz`. Ohne rpi-imager UND ohne xz stirbt der Weg
# MITTEN IM SCHREIBEN — die Karte ist dann halb beschrieben und
# unbrauchbar. Das wird jetzt VORHER gefragt, nicht mittendrin.
def schreibweg():
    """(werkzeug, hinweis, fehlt) — womit geschrieben wird und was fehlt."""
    import shutil as _sh
    if geraete.ist_windows():
        # DIESE ZEILE HAT SCHON EINMAL GELOGEN. Sie sagte „eingebauter
        # Schreibweg, keine Fremdsoftware noetig" — waehrend sdstart.py in
        # Wahrheit `sdprep.write_image` rief, das `bash -c "xz | dd"` baut.
        # Die Oberflaeche behauptete also genau das Gegenteil dessen, was
        # geschah (Sichtung vom 10.08.2026). Seit der Windows-Zweig IN
        # write_image steht, stimmt der Satz — und er sagt jetzt auch, was
        # er voraussetzt.
        return ('eingebaut',
                'Windows: eingebauter Schreibweg (keine Fremdsoftware nötig) — '
                'verlangt aber Administratorrechte.', None)
    if _sh.which('rpi-imager'):
        return 'rpi-imager', 'rpi-imager prüft die Karte nach dem Schreiben nach.', None
    if _sh.which('xz') and _sh.which('dd'):
        return 'dd', ('Ohne rpi-imager: geschrieben wird mit xz | dd. '
                      'Das schreibt genauso — prüft aber NICHT nach.'), 'rpi-imager'
    return None, ('Es fehlt sowohl rpi-imager als auch xz. So lässt sich keine '
                  'Karte schreiben.'), 'rpi-imager'


def paketbefehl(paket='rpi-imager'):
    """Der Befehl, der `paket` nachinstalliert — oder None.

    ER WIRD NICHT AUSGEFUEHRT, SONDERN ANGEZEIGT. Software nachzuladen ist
    eine Entscheidung des Menschen, nicht des Programms; hier steht nur, wie
    sie auf DIESEM System hiesse.
    """
    import shutil as _sh
    for werkzeug, befehl in (
        ('pacman', ['sudo', 'pacman', '-S', '--needed', paket]),
        ('apt-get', ['sudo', 'apt-get', 'install', '-y', paket]),
        ('dnf', ['sudo', 'dnf', 'install', '-y', paket]),
        ('zypper', ['sudo', 'zypper', 'install', '-y', paket]),
    ):
        if _sh.which(werkzeug):
            return befehl
    return None


class Knopf(tk.Canvas):
    """Ein Knopf mit runden Ecken — Tkinter kann das von sich aus nicht.

    Er ist ein Canvas und kein `tk.Button`, weil ein `tk.Button` auf jedem
    System anders aussieht (und unter macOS seine Farbe gar nicht annimmt).
    Hier soll er ueberall gleich aussehen, denn das ist der Sinn eines
    eigenen Aussehens.
    """

    def __init__(self, eltern, text, tat, grund=LILA, tinte='#FFFFFF',
                 breite=340, hoehe=64, schrift=17, **kw):
        # ══ DER KNOPF MISST SEINEN TEXT ═════════════════════════════════════
        #
        # GEMESSEN AM 08.08.2026, im Bild: „Karte löschen und schreiben" stand
        # in einem 290 px breiten Knopf als „arte löschen und schreibe" — links
        # und rechts abgeschnitten. Eine feste Breite ist eine Wette auf eine
        # Schriftart, und diese Oberflaeche soll auch auf Windows und macOS
        # laufen, wo eine andere gilt.
        #
        # Deshalb ist `breite` ab hier eine UNTERGRENZE: Passt der Text nicht,
        # waechst der Knopf. Er schrumpft nie unter die angegebene Breite —
        # nebeneinanderstehende Knoepfe sollen gleich aussehen, solange sie
        # koennen.
        self._font = tkfont.Font(family='DejaVu Sans', size=schrift, weight='bold')
        breite = max(breite, self._font.measure(text) + 44)
        super().__init__(eltern, width=breite, height=hoehe, bg=kw.pop('bg', GRUND),
                         highlightthickness=0, cursor='hand2', **kw)
        self.tat, self.grund, self.tinte, self.an = tat, grund, tinte, True
        r = min(22, hoehe // 2)
        self._teile = []
        for xy in ((0, 0, 2 * r, 2 * r), (breite - 2 * r, 0, breite, 2 * r),
                   (0, hoehe - 2 * r, 2 * r, hoehe), (breite - 2 * r, hoehe - 2 * r, breite, hoehe)):
            self._teile.append(self.create_oval(*xy, fill=grund, outline=''))
        self._teile.append(self.create_rectangle(r, 0, breite - r, hoehe, fill=grund, outline=''))
        self._teile.append(self.create_rectangle(0, r, breite, hoehe - r, fill=grund, outline=''))
        self._text = self.create_text(breite / 2, hoehe / 2, text=text, fill=tinte,
                                      font=self._font)
        self.bind('<Button-1>', self._klick)
        self.bind('<Enter>', lambda e: self.an and self._faerben(self._heller(grund)))
        self.bind('<Leave>', lambda e: self.an and self._faerben(grund))

    @staticmethod
    def _heller(hexfarbe, um=22):
        r, g, b = (int(hexfarbe[i:i + 2], 16) for i in (1, 3, 5))
        return '#%02X%02X%02X' % tuple(min(255, v + um) for v in (r, g, b))

    def _faerben(self, farbe):
        for t in self._teile:
            self.itemconfig(t, fill=farbe)

    def _klick(self, _):
        if self.an:
            self.tat()

    def sperren(self, gesperrt=True):
        self.an = not gesperrt
        self._faerben('#D9D2C6' if gesperrt else self.grund)
        self.itemconfig(self._text, fill='#8B8397' if gesperrt else self.tinte)
        self.configure(cursor='' if gesperrt else 'hand2')

    def beschriften(self, text):
        self.itemconfig(self._text, text=text)


def bild_setzen(eltern, name, kante=260):
    """Ein Seitenbild in einen Rahmen haengen — oder den gemalten MixPi-Kopf.

    DAS BILD WIRD NICHT SKALIERT. tools/sdstart-bilder.py legt es in genau der
    Groesse ab, die hier gebraucht wird; Tkinter kann nur ganzzahlig
    verkleinern, und `subsample(2)` aus 260 waere 130 — die Haelfte, nie die
    gewuenschte Zahl. Wer die Groesse aendern will, aendert sie DORT.

    Der Rueckgabewert muss festgehalten werden: Tkinter haelt keine Referenz
    auf ein PhotoImage, und ein eingesammeltes Bild ist ein leeres Feld. Genau
    dieser Fehler laesst Tkinter-Oberflaechen „manchmal" ohne Bilder starten.

    ══ DIE LEINWAND RICHTET SICH NACH DEM BILD, NICHT UMGEKEHRT ═════════════
    Hier stand `width=kante, height=kante` — ein QUADRAT, immer. Das ging gut,
    solange alle Quellen quadratisch waren. Am 10.08.2026 kam das erste im
    Querformat („flashing sdcard", 230x117), und ein 230 breites Bild in einer
    200 breiten Leinwand waere links und rechts ABGESCHNITTEN worden — ohne
    Fehlermeldung, denn ein Canvas beschneidet stillschweigend.

    `kante` ist deshalb ab hier nur noch die VORGABE fuer den Fall, dass gar
    kein Bild da ist (dann wird der MixPi-Kopf gemalt, und der ist rund).
    """
    weg = seitenbild(name)
    if weg:
        try:
            bild = tk.PhotoImage(file=weg)
            b, h = bild.width(), bild.height()
            cv = tk.Canvas(eltern, width=b, height=h, bg=GRUND, highlightthickness=0)
            cv.create_image(b / 2, h / 2, image=bild)
            cv.bild = bild                      # Referenz halten, siehe oben
            return cv
        except tk.TclError:
            pass
    cv = tk.Canvas(eltern, width=kante, height=kante, bg=GRUND, highlightthickness=0)
    mixpi_malen(cv, kante / 2, kante / 2 - 6, kante / 260 * 1.1)
    return cv


# ══ STECKT IN DEMSELBEN SCHACHT NOCH DASSELBE? ══════════════════════════════
#
# Ein Geraetename ist keine Karte. /dev/sdb bleibt /dev/sdb, wenn jemand die
# Karte herauszieht und eine andere hineinsteckt — und unter Windows bleibt
# PhysicalDrive2 dasselbe. Wer nur den Namen vergleicht, bestaetigt eine Karte
# und loescht die naechste.
#
# Verglichen wird deshalb, was das Medium ausmacht: Seriennummer, wenn es eine
# gibt, sonst Modell und Groesse. Fehlt beides, gilt es als GLEICH — sonst
# fiele die Wahl auf Systemen ohne diese Angaben bei jedem Takt weg, und der
# Knopf waere nie zu treffen.
def _anderes_medium(alt, neu):
    if not alt or not neu:
        return False
    a, b = alt.get('seriennummer') or '', neu.get('seriennummer') or ''
    if a or b:
        return a != b
    return (alt.get('modell'), alt.get('bytes')) != (neu.get('modell'), neu.get('bytes'))


class Fenster(tk.Tk):
    TAKT_MS = 2000        # wie oft nach einer Karte gesehen wird
    # DIE FASSUNG IST GESETZT UND NICHT „DIE NEUESTE". Begruendung im Kopf.
    CODENAME = 'Trixie'

    def __init__(self, board='RPi5', trocken=False, probe=False, board_gesetzt=False,
                 fork=None):
        super().__init__()
        # DIE ATTRAPPE KANN NICHT SCHREIBEN. `probe` setzt `trocken` mit, und
        # zwar hier und nicht beim Aufruf: Sonst haenge die Sicherheit daran,
        # dass jemand zwei Schalter zusammen setzt — und der Tag kommt, an dem
        # er nur einen setzt.
        self.probe = probe
        self.board, self.trocken = board, (trocken or probe)
        # ══ WAS DIE SEITEN SAMMELN — ALLES SCHON AUSGEFUELLT ═════════════════
        #
        # Betreiber, 08.08.2026: „noch eine seite mit dem paswort setzen fehlt,
        # name der box, und eine seite für wlan und eine begrüßungsseite mit
        # dem multilingual bild."
        #
        # DER EIN-KNOPF-GEDANKE BLEIBT TROTZDEM: Jede Seite steht schon
        # ausgefuellt da — das WLAN, in dem dieser Rechner gerade online ist,
        # samt Schluessel; der Name „mixpi"; das Passwort „mupibox" wie im
        # Bestand. Wer nichts aendern will, klickt viermal „Weiter" und hat
        # dasselbe wie vorher. Wer etwas aendern will, kann es jetzt.
        self.cfg = {'ssid': '', 'wifikey': '', 'hostname': 'mixpi', 'password': 'mupibox',
                    # WO DER FORK LIEGT, entscheidet `sdprep.fork_wurzel` — hier steht
                    # nur eine etwaige Vorgabe von `--fork`. None heisst: selber finden.
                    'fork': fork}
        self.karte = None
        self.karten = []
        # ══ GEMERKT WIRD DER PFAD, NICHT DAS WOERTERBUCH ════════════════════
        #
        # Hier stand nur `self.karte`, und der Abgleich im Takt hiess
        # `self.karte not in self.karten` — ein Vergleich ganzer dicts. Der
        # faellt schon, wenn sich IRGENDEIN Feld ruehrt: springt `groesse`
        # nach dem Einstecken von „0B" auf „29,7G", ist das alte Woerterbuch
        # nicht mehr in der Liste und die Wahl faellt still weg. Der Pfad ist
        # das, was der Mensch gewaehlt hat; alles andere ist Beiwerk.
        self.karte_pfad = None
        self.blockiert = []
        # Das BESTAETIGTE Ziel. Es entsteht erst in der roten Rueckfrage und
        # ist ab dann das einzige, worauf geschrieben wird.
        self.ziel = None
        self.post = queue.Queue()
        self.laeuft = False
        # Solange die rote Rueckfrage offen steht, wird NICHT weitergesucht.
        # Warum das noetig ist, steht bei `_fragen`.
        self.warten = False

        self.title('MixPiBox — Karte schreiben')
        self._symbol_setzen()
        self.configure(bg=GRUND)
        # ══ GROSS GENUG FUER DIE LAENGSTE SEITE ═════════════════════════════
        # Betreiber, 08.08.2026: „das fenster vom wlan ist zu klein, man sieht
        # den kopf nicht."
        #
        # 720x560 reichte fuer die Kartenseite und fuer sonst nichts. Die
        # WLAN-Seite traegt Bild, zwei beschriftete Felder mit je einem
        # Hinweis, zwei Knoepfe und eine Fussnote — zusammen rund 700 px hoch.
        # Gerechnet wird nach der LAENGSTEN Seite und nicht nach der ersten,
        # sonst wandert der Fehler nur zur naechsten.
        self.geometry('760x820')
        self.minsize(700, 700)

        self._kopf()
        self.mitte = tk.Frame(self, bg=GRUND)
        self.mitte.pack(fill='both', expand=True, padx=28)
        # OHNE --board FRAGT ER. Mit --board ist die Frage beantwortet und die
        # Seite waere ein Klick fuer nichts.
        self._board_gesetzt = board_gesetzt
        # Vorgabe AN: der langsame Weg soll die Ausnahme sein, nicht die Regel.
        # Fehlt das Buendel, sagt der Lauf es und macht ohne weiter.
        self.pakete_mitgeben = True
        self._seite_willkommen()

        self.after(200, self._karten_suchen)
        self.after(80, self._post_lesen)

    # ── Das Fenstersymbol ───────────────────────────────────────────────────
    def _symbol_setzen(self):
        """Betreiber, 10.08.2026: „ich habe auch für die software ein fav icon
        abgelegt."

        Bis dahin trug dieses Fenster die TK-FEDER — das Vorgabesymbol der
        Bibliothek. In der Fensterleiste stand also neben „MixPiBox — Karte
        schreiben" das Zeichen eines Programmierwerkzeugs.

        DREI DINGE, DIE HIER LEICHT SCHIEFGEHEN:

        1. `iconphoto(True, …)` und nicht `False`. Das `True` heisst „auch fuer
           alle Fenster, die noch kommen" — sonst haette die rote Rueckfrage in
           `_fragen` wieder die Feder, und ausgerechnet das Fenster, das loescht,
           saehe fremd aus.
        2. DIE REFERENZ MUSS GEHALTEN WERDEN. Tkinter haelt selbst keine auf ein
           PhotoImage; wird es eingesammelt, ist das Symbol wieder weg. Genau
           dieselbe Falle steht in `bild_setzen` beschrieben — sie trifft hier
           genauso, nur faellt sie spaeter auf.
        3. ES DARF NICHTS DAVON DEN START VERHINDERN. Ein fehlendes Symbol ist
           ein Schoenheitsfehler; ein Assistent, der deswegen nicht aufgeht, ist
           keiner. Deshalb faengt jeder Schritt einzeln ab statt in einem
           gemeinsamen `try` — sonst nimmt der erste Fehlschlag den zweiten mit.
        """
        # `DATEIEN` ist der Ordner, den auch `seitenbild()` benutzt — es gibt
        # genau EINE Stelle, an der dieser Weg steht.
        png = os.path.join(DATEIEN, 'sdstart-symbol.png')
        if os.path.isfile(png):
            try:
                self._symbol = tk.PhotoImage(file=png)
                self.iconphoto(True, self._symbol)
            except tk.TclError:
                pass
        # WINDOWS ZIEHT SEIN TASKLEISTENSYMBOL AUS EINER .ico, nicht aus dem,
        # was `iconphoto` setzt. Auf Linux und macOS ist `iconbitmap` mit einer
        # .ico wirkungslos bis stoerend — deshalb nur dort, wo es hilft.
        ico = os.path.join(DATEIEN, 'sdstart-symbol.ico')
        if os.name == 'nt' and os.path.isfile(ico):
            try:
                self.iconbitmap(default=ico)
            except tk.TclError:
                pass

    # ── Ein Eingabefeld im Hausstil ─────────────────────────────────────────
    def _feld(self, eltern, beschriftung, wert, geheim=False, hinweis=''):
        """Beschriftung, Feld, Hinweis — und das Feld zurueck.

        ══ EIN PASSWORTFELD, DAS MAN LESEN KANN ════════════════════════════
        Betreiber, 08.08.2026: „das password muss noch klartext sein können
        für die box, man sieht den default nicht."

        Er hat recht, und der Grund ist kein Bequemlichkeitsgrund: Hier steht
        eine VORGABE im Feld, die der Mensch nicht selbst getippt hat. Sterne
        ueber einem Wert, den man nicht kennt, sind keine Verschwiegenheit —
        sie sind eine Behauptung, die man nicht pruefen kann. Wer sein
        Box-Passwort nicht sieht, weiss nachher nicht, womit er sich anmeldet.

        Die Sterne bleiben als VORGABE (jemand steht neben einem), und ein
        Auge daneben zeigt den Wert. Das ist keine Sicherheitsluecke, die
        dadurch entstuende: Das Passwort steht ohnehin im Klartext in der
        dietpi.txt auf der Karte — so will DietPi es, und daran aendert dieses
        Fenster nichts.
        """
        tk.Label(eltern, text=beschriftung, bg=GRUND, fg=TINTE,
                 font=('DejaVu Sans', 11, 'bold')).pack(anchor='w', pady=(10, 2))
        zeile = tk.Frame(eltern, bg=GRUND)
        zeile.pack(fill='x')
        e = tk.Entry(zeile, font=('DejaVu Sans', 13), bg=FLAECHE, fg=TINTE,
                     relief='flat', highlightthickness=1, highlightbackground=LINIE,
                     highlightcolor=LILA, insertbackground=TINTE)
        if geheim:
            e.configure(show='*')
        e.insert(0, wert or '')
        e.pack(side='left', fill='x', expand=True, ipady=6)
        if geheim:
            auge = Knopf(zeile, 'zeigen', lambda: None, grund=KISSEN, tinte=TINTE,
                         breite=96, hoehe=34, schrift=11)

            def umschalten():
                versteckt = e.cget('show') == '*'
                e.configure(show='' if versteckt else '*')
                auge.beschriften('verbergen' if versteckt else 'zeigen')
            auge.tat = umschalten
            auge.pack(side='left', padx=(8, 0))
        if hinweis:
            tk.Label(eltern, text=hinweis, bg=GRUND, fg=LEISE,
                     font=('DejaVu Sans', 10)).pack(anchor='w', pady=(2, 0))
        return e

    # ── Seite 0: Willkommen ─────────────────────────────────────────────────
    def _seite_willkommen(self):
        self._leeren()
        bild_setzen(self.mitte, 'willkommen', 230).pack(pady=(2, 4))
        tk.Label(self.mitte, text='Neue MixPiBox einrichten', bg=GRUND, fg=TINTE,
                 font=('DejaVu Sans', 19, 'bold')).pack()
        # DIE ZAHL WIRD GEZAEHLT, NICHT BEHAUPTET. Mit `--board` entfaellt die
        # Pi-Frage, dann sind es drei — eine fest hineingeschriebene „Vier"
        # waere ab dem naechsten Schalter wieder falsch. Genau so ist der Satz
        # im Kopf falsch geworden.
        fragen = 3 + (0 if self._board_gesetzt else 1)
        tk.Label(self.mitte, text=(f'{["Keine", "Eine", "Zwei", "Drei", "Vier"][fragen]} '
                                   f'kurze Frage{"n" if fragen != 1 else ""}, '
                                   f'dann schreibe ich die Karte.\n'
                                   'Alles ist schon ausgefüllt — wer nichts ändern will, klickt durch.'),
                 bg=GRUND, fg=LEISE, font=('DejaVu Sans', 11), justify='center').pack(pady=(4, 16))
        Knopf(self.mitte, "Los geht's",
              lambda: (self._seite_karte() if self._board_gesetzt else self._seite_board()),
              breite=260, hoehe=62, schrift=16).pack()

    # ── Seite 1: Welcher Pi? ────────────────────────────────────────────────
    def _seite_board(self):
        self._leeren()
        bild_setzen(self.mitte, 'board', 260).pack(pady=(2, 6))
        tk.Label(self.mitte, text='Welcher Pi steckt in der Box?', bg=GRUND, fg=TINTE,
                 font=('DejaVu Sans', 17, 'bold')).pack()
        # ══ „DAS EINZIGE" WAR ES NICHT ══════════════════════════════════════
        #
        # Betreiber, 10.08.2026: „das einzige… stimmt auch nicht, da er ja auch
        # bei der sd karte und wifi fragt, zweite page."
        #
        # Stimmt, und sogar staerker als er sagt. Der Satz war aus zwei Gruenden
        # falsch:
        #   * Es folgen NOCH DREI Fragen (WLAN, Name, Passwort) und bei mehreren
        #     Traegern die Kartenwahl. „Das Einzige" waere also nur richtig,
        #     wenn danach nichts mehr kaeme.
        #   * Name und Passwort kann dieses Programm ueberhaupt nicht sehen —
        #     sie sind frei erfunden und stehen als Vorgabe da. WLAN und Karte
        #     sieht es, aber es kann nicht WISSEN, welche gemeint ist.
        # Der Satz sollte erklaeren, warum gefragt wird. Das tut er jetzt, ohne
        # eine Behauptung ueber alle anderen Seiten mitzuliefern.
        tk.Label(self.mitte, text='Von hier aus kann ich das nicht erkennen — das musst du mir sagen.',
                 bg=GRUND, fg=LEISE, font=('DejaVu Sans', 11)).pack(pady=(2, 14))
        reihe = tk.Frame(self.mitte, bg=GRUND)
        reihe.pack()
        for kennung, wort in (('RPi5', 'Raspberry Pi 5'), ('RPi4', 'Raspberry Pi 4')):
            Knopf(reihe, wort, lambda k=kennung: self._board_gewaehlt(k),
                  grund=LILA if kennung == 'RPi5' else KISSEN,
                  tinte='#FFFFFF' if kennung == 'RPi5' else TINTE,
                  breite=230, hoehe=62, schrift=15).pack(side='left', padx=8)

    def _board_gewaehlt(self, kennung):
        self.board = kennung
        self._seite_wlan()

    # ── Aufbau ──────────────────────────────────────────────────────────────
    def _kopf(self):
        kopf = tk.Frame(self, bg=GRUND)
        kopf.pack(fill='x', padx=28, pady=(22, 6))
        cv = tk.Canvas(kopf, width=104, height=104, bg=GRUND, highlightthickness=0)
        cv.pack(side='left')
        weg = bild_finden()
        if weg:
            try:
                self._bild = tk.PhotoImage(file=weg)
                # Nur ganzzahlig verkleinern — Tkinter kann nicht anders, und
                # eine krumme Skalierung gaebe es hier ohne Pillow ohnehin nicht.
                while self._bild.width() > 104:
                    self._bild = self._bild.subsample(2)
                cv.create_image(52, 52, image=self._bild)
            except tk.TclError:
                mixpi_malen(cv, 52, 46, 0.42)
        else:
            mixpi_malen(cv, 52, 46, 0.42)
        rechts = tk.Frame(kopf, bg=GRUND)
        rechts.pack(side='left', padx=(16, 0), anchor='w')
        tk.Label(rechts, text='MixPiBox-Karte schreiben', bg=GRUND, fg=TINTE,
                 font=('DejaVu Sans', 22, 'bold')).pack(anchor='w')
        # ══ HIER STAND „einmal klicken, fertig" — UND DAS STIMMTE NICHT MEHR ═
        #
        # Betreiber, 10.08.2026: „auf der ersten seite nur ein klick stimmt
        # nicht mehr."
        #
        # Er hat recht, und der Satz stand auf JEDER Seite: der Kopf gehoert
        # nicht zu einer Seite, er steht ueber allen. Am 08.08. sind auf seinen
        # Wunsch vier Seiten dazugekommen (welcher Pi, WLAN, Name und Passwort,
        # Willkommen) — aus dem einen Klick wurden vier Fragen und eine
        # Bestaetigung.
        #
        # WARUM DAS MEHR IST ALS EIN SCHOENHEITSFEHLER: Der Kopf ist das Erste,
        # was jemand liest, und er setzt die Erwartung fuer alles Weitere. Wer
        # „einmal klicken" liest und dann vier Seiten bekommt, denkt beim
        # dritten Weiter, er habe etwas falsch gemacht. Eine Oberflaeche, die
        # sich selbst falsch ankuendigt, macht ihre eigenen Schritte verdaechtig.
        #
        # Der EIN-KNOPF-Gedanke bleibt und steht jetzt da, wo er wahr ist:
        # alles ist vorausgefuellt, wer nichts aendern will, klickt durch.
        tk.Label(rechts, text='Karte einstecken, durchklicken, fertig.',
                 bg=GRUND, fg=LEISE, font=('DejaVu Sans', 12)).pack(anchor='w')

    def _leeren(self):
        for w in self.mitte.winfo_children():
            w.destroy()

    # ══ WIE EIN DATENTRAEGER HEISST — UND WAS ER NICHT HEISSEN DARF ═════════
    #
    # „SD-Karte" stand hier als Vorgabe fuer alles, was keinen Modellnamen hat.
    # Das ist eine BEHAUPTUNG, und bei einem Werkzeug, das den Traeger loescht,
    # eine gefaehrliche: eine namenlose externe Festplatte mit Urlaubsbildern
    # hiess in der roten Rueckfrage „SD-Karte", und wer „SD-Karte, 238G" liest,
    # klickt eher als jemand, der „Unbenannter Wechseldatentraeger" liest.
    #
    # Und die Namen, die Kartenleser wirklich melden, sind keine Namen: Der
    # Leser des Betreibers heisst „MassStorageClass" — das ist die USB-Klasse,
    # nicht das Geraet. Standen zwei Schaechte in der Liste, hiessen BEIDE so.
    NICHTSSAGEND = ('massstorageclass', 'usb disk', 'general udisk', 'mass storage',
                    'usb device', 'ultra usb device', 'storage device')

    @staticmethod
    def _karte_name(k):
        modell = (k.get('modell') or '').strip()
        if modell and modell.lower() not in Fenster.NICHTSSAGEND:
            return modell
        # „SD-Karte" nur, wo der Bus es hergibt — sonst das Ehrliche.
        if str(k.get('bus') or '').lower() in ('mmc', 'sd', '12', '13'):
            return 'SD-Karte'
        return 'Unbenannter Wechseldatenträger'

    def _karte_text(self):
        if not self.karte:
            if len(self.karten) > 1:
                return ('Welche Karte soll es sein?',
                        'Klick die an, die beschrieben wird.')
            return 'Keine SD-Karte gefunden.', 'Steck die Karte ein — ich sehe von selbst nach.'
        k = self.karte
        zusatz = ''
        if k.get('eingehaengt'):
            zusatz = '  ·  eingehängt unter ' + ', '.join(k['eingehaengt'][:2])
        return (f"{self._karte_name(k)} · {k.get('groesse') or '?'}",
                f"wird beschrieben: {k['pfad']}{zusatz}")

    # ── Seite 2: WLAN ───────────────────────────────────────────────────────
    def _seite_wlan(self):
        """Das Netz, in dem DIESER Rechner online ist — vorgewaehlt und begruendet.

        WARUM DAS AKTIVE NETZ UND NICHT DAS STAERKSTE: Nur von dessen
        Schluessel ist BEWIESEN, dass er stimmt — der Rechner ist damit gerade
        verbunden. Ein gespeichertes Fremdprofil kann veraltet sein, und genau
        so kam schon einmal ein falscher Schluessel voller Ueberzeugung auf
        eine Karte (siehe tui_sd.py, `_wifi_gewaehlt`).
        """
        self._leeren()
        bild_setzen(self.mitte, 'wlan', 200).pack(pady=(0, 2))
        tk.Label(self.mitte, text='In welches WLAN soll die MixPiBox?', bg=GRUND, fg=TINTE,
                 font=('DejaVu Sans', 17, 'bold')).pack()

        # ══ ERST ZEICHNEN, DANN FRAGEN ══════════════════════════════════════
        #
        # `sdprep.wifi_active()` und `wifi_secret()` rufen nmcli auf — ein
        # fremder Prozess. Standen sie VOR dem Aufbau, blieb das Fenster so
        # lange leer, wie NetworkManager brauchte. Im Bildschirmfoto vom
        # 08.08.2026 war die Seite deshalb weiss: nicht kaputt, sondern am
        # Warten. Eine Oberflaeche, die waehrend einer Auskunft nichts zeigt,
        # ist von einer kaputten nicht zu unterscheiden.
        e_ssid = self._feld(self.mitte, 'Netzname (SSID)', self.cfg['ssid'],
                            hinweis='—')
        e_key = self._feld(self.mitte, 'WLAN-Passwort', self.cfg['wifikey'], geheim=True)
        self._wlan_felder = (e_ssid, e_key)
        if not self.cfg['ssid']:
            # Der Hinweis unter dem Feld ist das dritte Kind des Rahmens —
            # gesucht wird er ueber seinen Text, damit ein Umbau der Seite ihn
            # nicht still an einen anderen Platz schiebt.
            self._wlan_sagen('suche das WLAN dieses Rechners …')
            threading.Thread(target=self._wlan_holen, daemon=True).start()
        else:
            self._wlan_sagen('übernommen — änderbar, solange die Karte nicht läuft.')

        def weiter():
            self.cfg['ssid'] = e_ssid.get().strip()
            self.cfg['wifikey'] = e_key.get()
            self._seite_name()
        reihe = tk.Frame(self.mitte, bg=GRUND)
        reihe.pack(fill='x', pady=(18, 0))
        Knopf(reihe, 'Zurück', self._seite_board, grund=KISSEN, tinte=TINTE,
              breite=150, hoehe=54, schrift=13).pack(side='left')
        Knopf(reihe, 'Weiter', weiter, breite=200, hoehe=54, schrift=14).pack(side='right')
        # OHNE WLAN GEHT ES AUCH — per Kabel. Ein leeres Feld ist hier kein
        # Fehler, sondern eine Ansage; die Karte bekommt dann einfach keines.
        tk.Label(self.mitte, text='Leer lassen = die Box hängt am Kabel.',
                 bg=GRUND, fg=LEISE, font=('DejaVu Sans', 10)).pack(pady=(10, 0))

    def _wlan_sagen(self, text):
        """Den Hinweis unter dem SSID-Feld setzen — falls die Seite noch steht."""
        for w in self.mitte.winfo_children():
            if isinstance(w, tk.Label) and w.cget('text') in ('—', 'suche das WLAN dieses Rechners …'):
                w.configure(text=text)
                return

    def _wlan_holen(self):
        """nmcli fragen — im eigenen Faden, Antwort ueber die Post."""
        try:
            aktiv = sdprep.wifi_active() or ''
            schluessel = sdprep.wifi_secret(aktiv) if aktiv else ''
        except Exception:
            aktiv, schluessel = '', ''
        self.post.put(('wlan', (aktiv, schluessel)))

    def _wlan_eingetragen(self, aktiv, schluessel):
        self.cfg['ssid'], self.cfg['wifikey'] = aktiv, schluessel
        felder = getattr(self, '_wlan_felder', None)
        if not felder or not felder[0].winfo_exists():
            return                      # inzwischen weitergeklickt
        e_ssid, e_key = felder
        e_ssid.delete(0, 'end'); e_ssid.insert(0, aktiv)
        e_key.delete(0, 'end'); e_key.insert(0, schluessel or '')
        self._wlan_sagen('Dieser Rechner ist hier gerade online — der Schlüssel stimmt also.'
                         if aktiv else 'Kein aktives WLAN gefunden — bitte von Hand eintragen.')

    # ── Seite 3: Name und Passwort ──────────────────────────────────────────
    def _seite_name(self):
        self._leeren()
        bild_setzen(self.mitte, 'name', 200).pack(pady=(0, 2))
        tk.Label(self.mitte, text='Name und Passwort der Box', bg=GRUND, fg=TINTE,
                 font=('DejaVu Sans', 17, 'bold')).pack()

        e_host = self._feld(self.mitte, 'Name der Box', self.cfg['hostname'],
                            hinweis='So heißt sie im Netz und in Spotify. Zwei Boxen dürfen nicht gleich heißen.')
        e_pass = self._feld(self.mitte, 'Passwort für den Zugang', self.cfg['password'], geheim=True,
                            hinweis='Für SSH und DietPi. Der Schlüssel dieses Rechners kommt zusätzlich mit.')

        def weiter():
            # NAME NICHT LEER: Ein leerer Rechnername macht aus der Box im Netz
            # ein Geraet ohne Adresse, und `./connect --find` sucht sie am
            # Schluessel — nicht am Namen. Lieber die Vorgabe als nichts.
            self.cfg['hostname'] = e_host.get().strip() or 'mixpi'
            self.cfg['password'] = e_pass.get() or 'mupibox'
            self._seite_karte()
        reihe = tk.Frame(self.mitte, bg=GRUND)
        reihe.pack(fill='x', pady=(18, 0))
        Knopf(reihe, 'Zurück', self._seite_wlan, grund=KISSEN, tinte=TINTE,
              breite=150, hoehe=54, schrift=13).pack(side='left')
        Knopf(reihe, 'Weiter', weiter, breite=200, hoehe=54, schrift=14).pack(side='right')

    def _seite_karte(self):
        self._leeren()
        bild_setzen(self.mitte, 'karte', 260).pack(pady=(0, 4))
        karte = tk.Frame(self.mitte, bg=FLAECHE, highlightbackground=LINIE,
                         highlightthickness=1)
        karte.pack(fill='x', pady=(14, 18))
        self.l_karte = tk.Label(karte, text='', bg=FLAECHE, fg=TINTE,
                                font=('DejaVu Sans', 15, 'bold'))
        self.l_karte.pack(anchor='w', padx=18, pady=(16, 2))
        self.l_wo = tk.Label(karte, text='', bg=FLAECHE, fg=LEISE,
                             font=('DejaVu Sans', 11), justify='left', wraplength=640)
        self.l_wo.pack(anchor='w', padx=18, pady=(0, 16))
        # HIER KOMMT DIE AUSWAHL HIN, wenn mehr als eine Karte dasteht. Sie ist
        # leer, solange es nichts zu waehlen gibt — sonst wuerde die Seite bei
        # der Normalfall-Karte um einen leeren Kasten wachsen.
        self.wahlkorb = tk.Frame(karte, bg=FLAECHE)
        self.wahlkorb.pack(fill='x', padx=14, pady=(0, 10))
        self._gezeigte_pfade = None
        # WAS NICHT ANGEBOTEN WIRD, GEHOERT DAZU — sonst sucht jemand seine
        # Karte in der Liste, findet sie nicht und haelt das Programm fuer
        # kaputt, dabei war der Ausschluss genau richtig. `sdgui.py` zeigt das
        # seit jeher (dort Zeile 263); der Ein-Knopf-Weg warf die zweite Liste
        # bisher weg und sagte nur „Keine SD-Karte gefunden."
        self.l_ausser = tk.Label(karte, text='', bg=FLAECHE, fg=LEISE,
                                 font=('DejaVu Sans', 10), justify='left',
                                 wraplength=640)
        self.l_ausser.pack(anchor='w', padx=18, pady=(0, 12))

        self.knopf = Knopf(self.mitte, 'Karte schreiben', self._fragen,
                           breite=340, hoehe=68, schrift=18)
        self.knopf.pack(pady=(4, 10))
        self.knopf.sperren(True)

        self.l_plan = tk.Label(self.mitte, text='', bg=GRUND, fg=LEISE,
                               font=('DejaVu Sans', 10), justify='left')
        self.l_plan.pack(pady=(6, 0))
        self._plan_zeigen()
        self._karte_zeigen()

        # ── WOMIT GESCHRIEBEN WIRD, BEVOR es losgeht ────────────────────────
        werkzeug, hinweis, fehlt = schreibweg()
        reihe = tk.Frame(self.mitte, bg=GRUND)
        reihe.pack(pady=(10, 0))
        tk.Label(reihe, text=hinweis, bg=GRUND,
                 fg=(LEISE if werkzeug == 'rpi-imager' else ROT if not werkzeug else TINTE),
                 font=('DejaVu Sans', 10), justify='center', wraplength=560).pack()
        if fehlt:
            befehl = paketbefehl(fehlt)
            if befehl:
                Knopf(reihe, f'{fehlt} nachinstallieren',
                      lambda: self._nachinstallieren(fehlt, befehl),
                      grund=KISSEN, tinte=TINTE, breite=250, hoehe=42,
                      schrift=12).pack(pady=(8, 0))
            else:
                tk.Label(reihe, text=f'Nachinstallieren: {fehlt} über die Paketverwaltung.',
                         bg=GRUND, fg=LEISE, font=('DejaVu Sans', 10)).pack(pady=(6, 0))
        if not werkzeug:
            # OHNE SCHREIBWERKZEUG WIRD NICHT ANGEBOTEN ZU SCHREIBEN. Ein
            # Knopf, der mitten im Lauf stirbt, laesst eine halb beschriebene
            # Karte zurueck — schlimmer als ein Knopf, der gar nicht erst geht.
            self.knopf.sperren(True)

    def _nachinstallieren(self, paket, befehl):
        """Nachinstallieren — aber erst nach ausdruecklicher Zustimmung.

        DER BEFEHL STEHT IM FENSTER, bevor er laeuft. Software nachzuladen und
        als root auszufuehren ist eine Entscheidung des Menschen; dieses
        Programm zeigt nur, wie sie hier hiesse. Betreiber, 08.08.2026:
        „falls der nicht gefunden wird muessen wir fragen ob wir ihn
        runterladen sollen."
        """
        f = tk.Toplevel(self)
        f.title(f'{paket} nachinstallieren?')
        f.configure(bg=FLAECHE)
        f.transient(self)
        f.resizable(False, False)
        tk.Label(f, text=f'{paket} nachinstallieren?', bg=FLAECHE, fg=TINTE,
                 font=('DejaVu Sans', 15, 'bold')).pack(padx=28, pady=(20, 6))
        tk.Label(f, text=('Dabei wird Software aus der Paketverwaltung deines\n'
                          'Systems geladen und als root installiert. Ausgeführt wird:'),
                 bg=FLAECHE, fg=LEISE, font=('DejaVu Sans', 11), justify='left').pack(padx=28, anchor='w')
        tk.Label(f, text=' '.join(befehl), bg=GRUND, fg=TINTE,
                 font=('DejaVu Sans Mono', 11)).pack(padx=28, pady=(8, 4), fill='x', ipady=6)
        protokoll = tk.Text(f, height=7, bg=GRUND, fg=TINTE, relief='flat',
                            font=('DejaVu Sans Mono', 9), wrap='word')
        protokoll.pack(padx=28, pady=(6, 0), fill='both', expand=True)
        protokoll.insert('end', 'Noch nichts getan.\n')

        def los():
            protokoll.delete('1.0', 'end')
            protokoll.insert('end', '$ ' + ' '.join(befehl) + '\n')
            f.update_idletasks()
            try:
                import subprocess
                lauf = subprocess.run(befehl, capture_output=True, text=True, timeout=900)
                protokoll.insert('end', (lauf.stdout or '')[-2000:] + (lauf.stderr or '')[-2000:])
                protokoll.insert('end', f'\nEnde: {lauf.returncode}\n')
            except Exception as e:                             # noqa: BLE001
                protokoll.insert('end', f'\nging nicht: {e}\n')
            protokoll.see('end')
            # Die Seite neu aufbauen — dann steht dort, was JETZT gilt.
            self.after(600, self._seite_karte)

        reihe = tk.Frame(f, bg=FLAECHE)
        reihe.pack(fill='x', padx=28, pady=(14, 20))
        ab = Knopf(reihe, 'Nein, so lassen', f.destroy, grund=KISSEN, tinte=TINTE,
                   breite=190, hoehe=48, schrift=13, bg=FLAECHE)
        ab.pack(side='left')
        Knopf(reihe, 'Ja, installieren', los, breite=190, hoehe=48, schrift=13,
              bg=FLAECHE).pack(side='right')
        f.bind('<Escape>', lambda e: f.destroy())
        f.update_idletasks()
        f.geometry('+%d+%d' % (self.winfo_rootx() + 50, self.winfo_rooty() + 80))
        f.wait_visibility()
        f.grab_set()
        ab.focus_set()

    def _plan_zeigen(self):
        # DER ZETTEL NENNT, WAS BESTAETIGT WURDE, nicht was der Rechner gerade
        # tut. Wer auf der WLAN-Seite etwas anderes eingetragen hat, soll hier
        # SEINEN Wert wiederfinden — sonst glaubt er, seine Eingabe sei weg.
        netz = self.cfg.get('ssid') or '— ohne WLAN, am Kabel —'
        self.l_plan.configure(
            text=(f"DietPi {self.CODENAME} für {self.board}, geladen und mit SHA256 geprüft.\n"
                  f"WLAN: {netz}  ·  SSH-Schlüssel dieses Rechners  ·  Name: {self.cfg.get('hostname')}\n"
                  f"Bildschirm ist ab dem ersten Start an."
                  + ('\nTROCKENLAUF — es wird NICHT geschrieben.' if self.trocken else '')))

    def _karte_zeigen(self):
        """EINE Stelle, an der Text UND Knopfzustand aus demselben Zustand
        folgen. Vorher schrieb `_karte_zeigen` erst das eine und
        `_karten_gesetzt` danach etwas anderes darueber — so entstand der Fall
        „Knopf scharf, Text sagt das Gegenteil"."""
        if not (hasattr(self, 'l_karte') and self.l_karte.winfo_exists()):
            return
        gross, klein = self._karte_text()
        self.l_karte.configure(text=gross)
        self.l_wo.configure(text=klein)
        self._wahl_zeigen()
        self._ausser_zeigen()
        # DER SCHREIBWEG GEHOERT IN DIESELBE RECHNUNG. Er wurde beim Aufbau der
        # Seite einmal geprueft und der Knopf gesperrt — und der Suchtakt hat
        # ihn zwei Sekunden spaeter wieder entsperrt, ohne von ihm zu wissen.
        # Ohne `xz` waere der Lauf dann mitten im Schreiben gestorben.
        self.knopf.sperren(self.karte is None or not schreibweg()[0])

    def _wahl_zeigen(self):
        """Bei mehreren Traegern je einen Knopf — sonst gar nichts.

        ══ WARUM ES DAS UEBERHAUPT BRAUCHT ═════════════════════════════════
        Betreiber, 10.08.2026: „ich wollte die sd karte beschreiben aber jetzt
        meldet er 2 wechseldatenträger ich soll abziehen das finde ich nicht
        gut gelöst."

        Er hat recht, und zwar doppelt. Hier stand:
            „Zieh alle ab außer der einen — geraten wird hier nicht."
        Das war (1) NICHT BEFOLGBAR — seine beiden Eintraege waren zwei
        Schaechte EINES Lesers, wer den abzieht, zieht die Karte mit ab —, und
        (2) eine SACKGASSE (BACKLOG #61): der Knopf blieb gesperrt und es gab
        keinen Weg, eine Karte zu waehlen. Der Kommentar daneben behauptete
        „bis eine gewaehlt ist", der Dateikopf „Stecken mehrere, MUSS gefragt
        werden" — gefragt wurde nie. Das aeltere `sdgui.py` HAT eine Auswahl
        (Zeile 250); der neue Ein-Knopf-Weg hatte sie verloren.

        NEU GEBAUT WIRD NUR, WENN SICH DIE MENGE DER PFADE AENDERT. Sonst
        wandert alle zwei Sekunden ein Ziel unter dem Zeiger weg — und das bei
        Knoepfen, die loeschen.
        """
        if not (hasattr(self, 'wahlkorb') and self.wahlkorb.winfo_exists()):
            return
        pfade = tuple(k['pfad'] for k in self.karten)
        neu = pfade if len(self.karten) > 1 else ()
        if neu == self._gezeigte_pfade:
            self._wahl_faerben()
            return
        self._gezeigte_pfade = neu
        for w in self.wahlkorb.winfo_children():
            w.destroy()
        self._wahlknoepfe = {}
        if not neu:
            return
        # DER WAHRE SATZ STATT DES UNBEFOLGBAREN. Gleiche HCTL-Wurzel
        # (0:0:0:0 gegen 0:0:0:1) heisst: ein Geraet, mehrere Schaechte.
        # Fehlt HCTL (macOS, Windows), entfaellt nur dieser Zusatz.
        wurzeln = {str(k.get('hctl') or '').rsplit(':', 1)[0]
                   for k in self.karten if k.get('hctl')}
        if len(wurzeln) == 1 and len(self.karten) > 1:
            tk.Label(self.wahlkorb,
                     text='Beide gehören zu einem Leser — Abziehen hilft hier nicht.',
                     bg=FLAECHE, fg=LEISE, font=('DejaVu Sans', 10),
                     wraplength=620, justify='left').pack(anchor='w', pady=(0, 6))
        for k in self.karten:
            zeilen = [f"{self._karte_name(k)} · {k.get('groesse') or '?'}", k['pfad']]
            if k.get('eingehaengt'):
                zeilen.append('in Benutzung: ' + ', '.join(k['eingehaengt'][:2]))
            kn = Knopf(self.wahlkorb, '   '.join(zeilen),
                       (lambda p=k['pfad']: self._karte_waehlen(p)),
                       grund=KISSEN, tinte=TINTE, breite=0, hoehe=52, schrift=12,
                       bg=FLAECHE)
            kn.pack(fill='x', pady=3)
            self._wahlknoepfe[k['pfad']] = kn
        self._wahl_faerben()

    def _wahl_faerben(self):
        for pfad, kn in getattr(self, '_wahlknoepfe', {}).items():
            gewaehlt = (pfad == self.karte_pfad)
            kn.grund = LILA if gewaehlt else KISSEN
            kn._faerben(kn.grund)
            kn.itemconfig(kn._text, fill='#FFFFFF' if gewaehlt else TINTE)

    def _karte_waehlen(self, pfad):
        self.karte_pfad = pfad
        self.karte = next((k for k in self.karten if k['pfad'] == pfad), None)
        self._karte_zeigen()

    def _ausser_zeigen(self):
        if not (hasattr(self, 'l_ausser') and self.l_ausser.winfo_exists()):
            return
        # DIE SYSTEMPLATTE GEHOERT HIER NICHT HIN. Genannt wird nur, wogegen
        # man etwas tun KANN — ein leerer Schacht, ein eingehaengter Traeger,
        # eine blinde Erkennung. „nvme0n1: System liegt darauf" ist richtig und
        # trotzdem nur Rauschen; es zieht das Fenster in die Breite und lenkt
        # von der Zeile ab, die zaehlt.
        nennenswert = [b for b in self.blockiert
                       if b.get('grund') and 'System liegt darauf' not in b['grund']
                       and 'kein Wechseldatentraeger' not in b['grund']]
        if not nennenswert:
            self.l_ausser.configure(text='')
            return
        self.l_ausser.configure(text='Nicht angeboten: ' + '  ·  '.join(
            f"{b['pfad']} ({b['grund']})" for b in nennenswert[:2]))

    # ── Karten suchen ───────────────────────────────────────────────────────
    def _karten_suchen(self):
        # `self.warten` ist neu und der Grund steht bei `_fragen`: solange die
        # rote Rueckfrage offen steht, darf sich das Ziel nicht mehr bewegen.
        if not self.laeuft and not self.warten:
            threading.Thread(target=self._karten_thread, daemon=True).start()
        self.after(self.TAKT_MS, self._karten_suchen)

    def _karten_thread(self):
        if self.probe:
            # Erfundene Karte fuers Ansehen und Nachmessen der Oberflaeche —
            # der Pfad zeigt bewusst ins Leere, damit ein Versehen nichts
            # trifft.
            self.post.put(('karten', ([{'pfad': '/dev/DOES-NOT-EXIST', 'name': 'attrappe',
                                        'modell': 'SanDisk Ultra (Attrappe)', 'bytes': 32 << 30,
                                        'groesse': '32G', 'wechselbar': True, 'bus': 'mmc',
                                        'eingehaengt': [], 'hctl': '', 'seriennummer': ''}], [])))
            return
        try:
            gefunden = geraete.karten_finden()
            ok, blockiert = (gefunden if isinstance(gefunden, tuple) else (gefunden, []))
        except Exception:
            ok, blockiert = [], []
        self.post.put(('karten', (ok, blockiert)))

    def _karten_gesetzt(self, ok, blockiert=()):
        """DIE SIGNATUR IST AUSDRUECKLICH ZWEITEILIG. Vorher nahm sie EINEN
        Wert, und wer versehentlich das ganze `(ok, blockiert)` durchreichte,
        bekam „2 Wechseldatenträger gefunden" — gezaehlt wurden die beiden
        LISTEN. Jetzt bricht ein solcher Aufruf laut, statt zu luegen."""
        self.karten = list(ok or [])
        self.blockiert = list(blockiert or [])

        # ── DIE WAHL WIRD UEBER DEN PFAD GEHALTEN, NICHT UEBER DAS dict ─────
        vorher = self.karte_pfad
        jetzt = {k['pfad']: k for k in self.karten}
        if len(self.karten) == 1:
            # Genau eine: vorgeschlagen. Das ist der Normalfall und soll ein
            # Klick bleiben.
            self.karte_pfad = self.karten[0]['pfad']
        elif not self.karten:
            self.karte_pfad = None
        elif self.karte_pfad not in jetzt:
            # Mehrere und die alte Wahl ist weg — nicht raten.
            self.karte_pfad = None
        elif vorher and _anderes_medium(self.karte, jetzt[self.karte_pfad]):
            # DERSELBE PFAD, ABER ETWAS ANDERES DARIN. /dev/sdb bleibt
            # /dev/sdb, wenn jemand die Karte tauscht — die Wahl darf nicht
            # stillschweigend auf das neue Medium uebergehen.
            self.karte_pfad = None
        self.karte = jetzt.get(self.karte_pfad)
        self._karte_zeigen()

    # ── Rueckfrage ──────────────────────────────────────────────────────────
    def _fragen(self):
        """══ DAS ZIEL WIRD HIER EINGEFROREN ═════════════════════════════════

        DAS WAR EIN FEHLER MIT DATENVERLUST, und er lag genau in der Naht
        zwischen Anzeigen und Tun:

            _fragen  las `k = self.karte` — aber NUR fuer die Beschriftung.
            los()    rief `self._loslegen()` ohne jedes Ziel.
            _lauf    las `k = self.karte` NOCH EINMAL, frisch, beim Schreiben.

        Dazwischen laeuft der Suchtakt weiter: `_karten_suchen` haengt an
        `self.after` und pausierte nur bei `self.laeuft`, das erst mit dem Lauf
        gesetzt wird. `grab_set()` haelt Tastatur und Maus auf — Zeitgeber
        nicht. Wer die Karte zwischen Aufziehen und Klicken wechselt, bekam
        also ein Fenster, das Karte A nennt, und ein `dd`, das Karte B trifft.

        Zwei Riegel, beide noetig:
          1. `ziel = dict(self.karte)` — bestaetigt wird, was im Fenster STEHT.
             Eine Kopie, kein Verweis: sonst zeigte sie auf dasselbe
             Woerterbuch, das der naechste Takt ersetzt.
          2. `self.warten` haelt die Suche an, solange gefragt wird. Damit
             wandert auch die Anzeige DAHINTER nicht mehr weg — ein Fenster,
             dessen Hintergrund sich waehrend der Frage aendert, ist selbst
             schon eine Falle.
        """
        if not self.karte:
            return
        k = dict(self.karte)
        self.warten = True
        f = tk.Toplevel(self)
        f.title('Wirklich löschen?')
        f.configure(bg=FLAECHE)
        f.transient(self)
        f.resizable(False, False)

        band = tk.Frame(f, bg=ROT)
        band.pack(fill='x')
        tk.Label(band, text='ALLE DATEN AUF DIESER KARTE WERDEN GELÖSCHT',
                 bg=ROT, fg='#FFFFFF', font=('DejaVu Sans', 13, 'bold')).pack(pady=12, padx=24)

        leib = tk.Frame(f, bg=FLAECHE)
        leib.pack(fill='both', expand=True, padx=28, pady=(18, 8))
        tk.Label(leib, text=self._karte_name(k), bg=FLAECHE, fg=TINTE,
                 font=('DejaVu Sans', 16, 'bold')).pack(anchor='w')
        zeilen = [f"Größe:  {k.get('groesse') or '?'}", f"Gerät:  {k['pfad']}"]
        # WAS SCHON DARAUF IST, gehoert in die Frage. Zwei Traeger desselben
        # Lesers heissen gleich und sind gleich gross; woran man sie
        # unterscheidet, ist ihr INHALT. Und wer „ext4 + FAT" liest, erkennt
        # seine alte MixPi-Karte — oder merkt, dass er die falsche erwischt hat.
        if k.get('eingehaengt'):
            zeilen.append('In Benutzung:  ' + ', '.join(k['eingehaengt'][:2]))
        if k.get('seriennummer'):
            zeilen.append(f"Seriennr.:  {k['seriennummer']}")
        for zeile in zeilen:
            tk.Label(leib, text=zeile, bg=FLAECHE, fg=TINTE,
                     font=('DejaVu Sans Mono', 12)).pack(anchor='w', pady=1)
        tk.Label(leib, text=('Alles, was jetzt darauf ist, ist danach weg —\n'
                             'Bilder, Musik, alles. Es gibt keinen Rückweg.'),
                 bg=FLAECHE, fg=LEISE, font=('DejaVu Sans', 11), justify='left').pack(
                     anchor='w', pady=(14, 0))

        reihe = tk.Frame(f, bg=FLAECHE)
        reihe.pack(fill='x', padx=28, pady=(18, 22))
        # KEINE feste Fensterbreite: `f.resizable(False, False)` haelt die
        # Groesse fest, die `pack` ausrechnet — und die richtet sich nach den
        # Knoepfen, seit sie ihren Text messen.
        # DER ABBRECHEN-KNOPF STEHT LINKS UND HAT DEN FOKUS. Escape und Eingabe
        # brechen ab; der loeschende Knopf ist nur mit dem Zeiger zu treffen.
        # Ein Fenster, in dem die Eingabetaste loescht, loescht irgendwann.
        def zu(*_):
            # JEDER Abbruchweg gibt die Suche wieder frei — sonst stuende der
            # Assistent nach einem Escape still und faende nie wieder eine
            # Karte. `f.destroy` allein reichte dafuer nicht mehr.
            self.warten = False
            f.destroy()

        ab = Knopf(reihe, 'Abbrechen', zu, grund=KISSEN, tinte=TINTE,
                   breite=170, hoehe=52, schrift=14, bg=FLAECHE)
        ab.pack(side='left')

        def los():
            f.destroy()
            self._loslegen(k)          # DAS EINGEFRORENE Ziel, siehe oben
        Knopf(reihe, 'Karte löschen und schreiben', los, grund=ROT, tinte='#FFFFFF',
              breite=0, hoehe=52, schrift=14, bg=FLAECHE).pack(side='right')

        f.bind('<Escape>', zu)
        f.bind('<Return>', zu)
        # Auch das Schliesskreuz des Fenstermanagers ist ein Abbruch.
        f.protocol('WM_DELETE_WINDOW', zu)
        f.update_idletasks()
        f.geometry('+%d+%d' % (self.winfo_rootx() + 60, self.winfo_rooty() + 90))

        # ══ ERST SICHTBAR, DANN GREIFEN ═════════════════════════════════════
        #
        # `grab_set()` stand oben, gleich nach `transient` — und stuerzte auf
        # einem echten Schreibtisch ab:
        #     _tkinter.TclError: grab failed: window not viewable
        # Ein Fenster laesst sich erst greifen, wenn der Fenstermanager es
        # aufgezogen hat, und das dauert.
        #
        # WARUM ES IM TEST NICHT AUFFIEL, und das ist die eigentliche Lehre:
        # Unter Xvfb laeuft KEIN Fenstermanager. Dort ist ein Toplevel sofort
        # sichtbar, und derselbe Aufruf gelingt. Ein Bildschirmfoto aus Xvfb
        # beweist also, wie es AUSSIEHT — nicht, dass es auf einem Schreibtisch
        # laeuft. Gemeldet hat es der Betreiber beim ersten Klick auf
        # „Karte schreiben".
        #
        # `wait_visibility()` haelt genau bis dahin an. Es kann nicht ewig
        # warten: das Fenster ist gerade erzeugt und gepackt, der Aufzug ist
        # unterwegs. Danach greift der Griff verlaesslich.
        f.wait_visibility()
        f.grab_set()
        ab.focus_set()

    # ── Der Lauf ────────────────────────────────────────────────────────────
    def _loslegen(self, ziel=None):
        # `ziel` kommt aus der Rueckfrage und ist eingefroren. Der Vorgabewert
        # gilt nur fuer den Probemodus und den Smoketest, die ohne Rueckfrage
        # loslaufen — im echten Weg wird IMMER eines mitgegeben.
        self.ziel = ziel if ziel is not None else (dict(self.karte) if self.karte else None)
        self.laeuft = True
        self.warten = False
        self._leeren()
        bild_setzen(self.mitte, 'lauf', 200).pack(pady=(0, 2))
        self.l_phase = tk.Label(self.mitte, text='Vorbereiten …', bg=GRUND, fg=TINTE,
                                font=('DejaVu Sans', 15, 'bold'))
        self.l_phase.pack(anchor='w', pady=(16, 8))
        bahn = tk.Frame(self.mitte, bg=LINIE, height=14)
        bahn.pack(fill='x')
        bahn.pack_propagate(False)
        self.balken = tk.Frame(bahn, bg=LILA, width=0)
        self.balken.place(x=0, y=0, relheight=1, width=0)
        self._bahn = bahn
        self.l_zahl = tk.Label(self.mitte, text='', bg=GRUND, fg=LEISE,
                               font=('DejaVu Sans', 10))
        self.l_zahl.pack(anchor='e', pady=(4, 10))
        self.protokoll = tk.Text(self.mitte, height=11, bg=FLAECHE, fg=TINTE,
                                 font=('DejaVu Sans Mono', 9), relief='flat',
                                 highlightbackground=LINIE, highlightthickness=1,
                                 wrap='word')
        self.protokoll.pack(fill='both', expand=True, pady=(0, 18))
        threading.Thread(target=self._arbeit, daemon=True).start()

    def _sagen(self, text):
        self.post.put(('log', str(text)))

    def _phase(self, text, getan=None, gesamt=None):
        self.post.put(('phase', (text, getan, gesamt)))

    def _arbeit(self):
        try:
            self._lauf()
        except Exception:
            self._sagen(traceback.format_exc()[-1500:])
            self.post.put(('ende', False))

    def _lauf(self):
        if self.probe:
            self._lauf_attrappe()
            return
        # HIER STAND `k = self.karte` — ein ZWEITES, frisches Lesen, zwei
        # Sekunden nach der Rueckfrage. Genommen wird jetzt, was bestaetigt
        # wurde, nicht was inzwischen im Schacht liegt.
        k = self.ziel
        if not k:
            self._sagen('Kein Ziel bestätigt — abgebrochen.')
            self.post.put(('ende', False))
            return
        self._phase('Rechte holen …', 0, 0)

        if not self.trocken and not sdprep.rechte_vorab_holen(interactive=False,
                                                              on_line=self._sagen):
            self._sagen('Ohne Root-Rechte kann die Karte nicht beschrieben werden.')
            self.post.put(('ende', False))
            return

        self._phase('Abbild suchen …', 0, 0)
        # `fetch_index()` GIBT SCHON DIE LISTE, nicht das HTML — es ruft
        # `parse_index` selbst (sdprep.py:472). Hier stand ein zweiter Aufruf
        # darum herum, und der starb mit „expected string or bytes-like
        # object, got 'list'" — bei JEDEM Lauf, nicht nur im Probemodus.
        # Gefunden hat es der Betreiber beim ersten Klick auf „Karte
        # schreiben"; kein Test dieses Baums faehrt diesen Weg.
        # KEIN NETZ IST EINE AUSKUNFT, KEIN ABSTURZ. Ohne diesen Fang landete
        # ein abgerissenes WLAN im allgemeinen Traceback-Fenster ganz unten —
        # 1500 Zeichen Python, aus denen niemand „dein Netz ist weg" liest.
        try:
            eintraege = sdprep.fetch_index()
        except sdprep.KeinNetz as f:
            self._sagen(str(f))
            self._sagen('Abbildliste nicht erreichbar — nichts geschrieben, '
                        'die Karte ist unveraendert.')
            self.post.put(('ende', False))
            return
        # WENN DIE KENNUNG UMGESCHRIEBEN WIRD, SOLL ES DASTEHEN. Der Knopf auf
        # der Board-Seite heisst „Raspberry Pi 4", DietPi kennt aber nur
        # `RPi234` (ein Abbild fuer 2/3/4). Bis zum 31.08.2026 traf `select()`
        # deshalb nichts und der Lauf endete mit „Kein Abbild für RPi4
        # gefunden." — ohne zu sagen, dass die Kennung das Problem war.
        _, board_hinweis = sdprep.board_aufloesen(self.board)
        if board_hinweis:
            self._sagen(board_hinweis)
        # TRIXIE UND NICHT „DAS NEUESTE". dietpi.com bietet fuer beide Boards
        # Bookworm, Trixie und Forky; das Neueste waere Forky. Gemessen wurde
        # diese Box auf Debian 13 / DietPi 10.5.2 (dateien/stueckliste.txt) —
        # ein unerprobter Stand ist auf einem Geraet ohne Tastatur kein Fortschritt.
        treffer = sdprep.select(eintraege, board=self.board, codename=self.CODENAME)
        if not treffer:
            # KEIN STILLES AUSWEICHEN: Wer statt Trixie etwas anderes bekommt,
            # soll es lesen koennen — sonst sucht er den Unterschied spaeter am
            # laufenden System.
            treffer = sdprep.select(eintraege, board=self.board)
            if treffer:
                self._sagen(f'{self.CODENAME} gibt es für {self.board} nicht — '
                            f"nehme {treffer[0].get('codename', '?')}.")
        bild = treffer[0] if treffer else None
        if not bild:
            self._sagen(f'Kein Abbild für {self.board} gefunden.')
            self.post.put(('ende', False))
            return
        self._sagen(f"Abbild: {bild['file']}")

        speicher = os.path.expanduser('~/.rsi/images')
        os.makedirs(speicher, exist_ok=True)
        img = os.path.join(speicher, bild['file'])
        if os.path.isfile(img):
            self._sagen('schon geladen')
        else:
            self._phase('Abbild laden', 0, 0)
            # `on_hinweis` ist die Rueckmeldung, die bis zum 31.08.2026 fehlte:
            # der Balken stand eine halbe Stunde bei 7 %, ohne zu sagen, dass
            # nichts mehr ankommt. Jetzt meldet sich das Laden nach 15 s
            # Stillstand von selbst — und noch einmal, wenn es weitergeht.
            try:
                sdprep.download(bild['url'], img,
                                lambda got, total: self._phase(None, got, total),
                                on_hinweis=self._sagen)
            except sdprep.KeinNetz as f:
                self._sagen(str(f))
                self._sagen('Abbild nicht vollstaendig geladen — nichts geschrieben, '
                            'die Karte ist unveraendert. Netz richten und neu starten; '
                            'das halb Geladene wird verworfen.')
                self.post.put(('ende', False))
                return
            self._sagen('geladen')

        will = sdprep.fetch_sha256(bild)
        if will:
            self._phase('Prüfsumme prüfen', 0, 0)
            ist = sdprep.sha256_file(img)
            if ist != will:
                self._sagen(f'Prüfsumme falsch — erwartet {will[:16]}…, ist {ist[:16]}…')
                self.post.put(('ende', False))
                return
            self._sagen('Prüfsumme stimmt')
        else:
            self._sagen('keine Prüfsumme verfügbar')

        self._phase('Auf die Karte schreiben', 0, sdprep.image_size(img))

        def zeile(z):
            b = sdprep.parse_dd_progress(z)
            if b is not None:
                self._phase(None, b, None)
                return
            pz, abschnitt = sdprep.parse_percent(z)
            if pz is not None:
                self._phase('Karte überprüfen' if abschnitt == 'verify' else None, pz, 100)
                return
            self._sagen(z)

        # ══ EIN LETZTER BLICK, BEVOR ETWAS UNWIDERRUFLICH WIRD ══════════════
        #
        # Zwischen der Rueckfrage und dieser Zeile liegen Rechte holen, die
        # Bildliste holen, ein Gigabyte laden und eine Pruefsumme rechnen —
        # Minuten, in denen jemand die Karte herausziehen und eine andere
        # hineinstecken kann. Der Geraetename bliebe derselbe.
        #
        # Geprueft wird deshalb nicht „gibt es den Pfad noch", sondern „ist es
        # noch dasselbe Medium" (Seriennummer, sonst Modell und Groesse —
        # dieselbe Rechnung wie im Suchtakt).
        if not self.trocken:
            jetzt = {x['pfad']: x for x in (geraete.karten_finden() or ([], []))[0]}
            steht_da = jetzt.get(k['pfad'])
            if steht_da is None:
                self._sagen(f"{k['pfad']} ist nicht mehr da — abgebrochen, "
                            f"bevor geschrieben wurde.")
                self.post.put(('ende', False))
                return
            if _anderes_medium(k, steht_da):
                self._sagen(f"In {k['pfad']} steckt jetzt etwas anderes als bei der "
                            f"Bestätigung — abgebrochen. Bitte neu bestätigen.")
                self.post.put(('ende', False))
                return

        rc = sdprep.write_image(img, k['pfad'], dry_run=self.trocken,
                                interactive=False, on_line=zeile)
        if self.trocken:
            self._sagen('Trockenlauf — es wurde NICHT geschrieben.')
            self.post.put(('ende', True))
            return
        if rc not in (0, None):
            self._sagen(f'Schreiben fehlgeschlagen (Code {rc})')
            self.post.put(('ende', False))
            return

        self._phase('Boot-Partition einhängen', 0, 0)
        mp = sdprep.mount_boot(k['pfad'], dry_run=False, interactive=False,
                               on_line=self._sagen)
        if not mp:
            self._sagen('Boot-Partition nicht eingehängt — Karte neu einstecken.')
            self.post.put(('ende', False))
            return

        self._phase('Einstellungen schreiben', 0, 0)
        # WAS AUF DEN SEITEN STAND, GILT. Frueher las diese Stelle das aktive
        # WLAN selbst nach — jetzt waere das eine zweite Wahrheit neben dem,
        # was der Mensch gesehen und bestaetigt hat.
        ssid = (self.cfg.get('ssid') or '').strip()
        wlan = {'ssid': ssid, 'key': self.cfg.get('wifikey') or ''} if ssid else None
        if wlan and not wlan['key']:
            self._sagen(f'WLAN {ssid}: kein Schlüssel angegeben — Karte kommt OHNE WLAN.')
            wlan = None
        if not ssid:
            self._sagen('Ohne WLAN — die Box braucht dann ein Kabel.')
        # `debug_display=True` HAENGT DAS DSI-PANEL IN DIE config.txt
        # (sdprep.config_debug). Ohne das richtet erst der Controller die
        # Anzeige ein — und genau dahin kommt man nicht, wenn die Box nicht ins
        # Netz findet. Ein schwarzer Schirm ist der Fall, in dem niemand mehr
        # sieht, was los ist; deshalb ist er hier GESETZT und nicht wahlweise.
        # ══ DIE KARTE BEKOMMT DIE INSTALLATION MIT ══════════════════════════
        #
        # Betreiber, 10.08.2026: „ich hatte einen testlauf mit sd diesmal mit
        # wlan vorkonfiguriert es erscheint kein mixpi screen es bleibt beim
        # root login stehen" — und nachgeschoben: „aber es scheint das es
        # durchlief."
        #
        # ER HATTE RECHT, IN BEIDEM. Hier stand dieser Aufruf OHNE `lauf_paket`,
        # `handy` und `bake_agent` — alle drei stehen dann auf `False`, und
        # damit faellt in `prepare_boot` JEDER Block weg, der etwas installiert.
        # Auf die Karte kamen vier Dateien; die einzige ausfuehrbare war 546
        # Byte gross und legte nur den SSH-Schluessel ab. DietPi lief tadellos
        # durch und blieb am Login stehen, weil ihm niemand gesagt hatte, dass
        # daraus eine MixPiBox werden soll.
        #
        # AM GERAET NACHGESEHEN (Testbox mixpi, 192.168.178.77):
        #   .install_stage = 2   (DietPi sauber fertig)
        #   /home/dietpi/.mupibox, /usr/local/bin/mupibox, /opt/mupibox-tools
        #                        alle drei FEHLEN
        #   0 Unit-Dateien mit „mupi", kein X, kein chromium
        #
        # `lauf_paket=True` zieht `handy` und `bake_agent` zwingend nach sich
        # (siehe prepare_boot) — und das ist richtig so: das Installationspaket
        # ohne den Agenten und ohne Einrichtungsbildschirm waere ein Lauf, den
        # niemand starten koennte.
        #
        # GEMESSEN, weil die Boot-Partition klein ist: das Paket aus
        # mupibox.yaml + mupibox-app.yaml ist 54 Schritte, 73 Dateien, 13,8 MB
        # bei 0 fehlenden Quellen (nachgemessen 23.09.2026; am 08.08. waren es
        # 53 Schritte, 46 Dateien, 17,7 MB). Auf der Karte des Betreibers waren
        # 94 MB frei — es passt mehrfach.
        for w in sdprep.prepare_boot(mp,
                                     password=self.cfg.get('password') or 'mupibox',
                                     hostname=self.cfg.get('hostname') or 'mixpi',
                                     wifi=wlan,
                                     ssh_pubkey=sdprep.default_pubkey(create=True),
                                     debug_display=True,
                                     lauf_paket=True,
                                     fork=self.cfg.get('fork'),
                                     sofort_starten=True,
                                     bildname=bild['file']):
            self._sagen(w)

        # ── VORGELADENE PAKETE MITGEBEN ────────────────────────────────────
        # Betreiber, 31.08.2026: „das wlan im pi ist ja schnarch langsam".
        # Liegt ein Buendel bereit (tools/paketbuendel-bauen.py), kommt es
        # nach /var/cache/apt/archives/ — dort sieht apt von selbst nach, es
        # braucht also keinen Erstboot-Schritt.
        #
        # KEIN ABBRUCH, WENN ES SCHIEFGEHT: Die Karte ist ohne Buendel
        # vollstaendig brauchbar, der Installer laedt dann eben selbst. Ein
        # Fehler hier darf einen sonst gelungenen Schreibvorgang nicht
        # entwerten — er wird gesagt, nicht geworfen.
        # HIER ist controller/ — das Buendel liegt eine Ebene hoeher unter
        # dateien/. Ohne das `..` zeigte der Pfad ins Leere, und die Option
        # haette STILL nie gegriffen: der Zweig faellt auf „kein Buendel
        # vorhanden" zurueck, was wie eine Aussage aussieht, aber ein Tippfehler waere.
        buendel = os.path.join(HIER, '..', 'dateien', 'paketbuendel.tgz')
        if self.pakete_mitgeben and os.path.isfile(buendel) and not self.trocken:
            self._phase('Pakete mitgeben …', 0, 0)
            ok, was = sdprep.paketbuendel_ablegen(
                k['pfad'], buendel, interactive=False, on_line=self._sagen)
            if ok:
                self._sagen(f'{was} Pakete vorgeladen — der Installer laedt sie nicht mehr.')
            else:
                self._sagen(f'Pakete nicht mitgegeben ({was}). '
                            'Die Karte ist trotzdem in Ordnung, der Installer laedt selbst.')
        elif self.pakete_mitgeben and not os.path.isfile(buendel):
            # OHNE `--box`: der Schalter stammte aus dem ersten Entwurf, der das
            # Buendel auf einer laufenden Box packte. Genau die gibt es hier per
            # Definition nicht — wer diesen Satz liest, schreibt gerade seine
            # ERSTE Karte. Heute laedt das Werkzeug aus den Debian-Indizes und
            # braucht weder Geraet noch Adresse (Commit eb9af74f).
            self._sagen('Kein Paketbuendel vorhanden — der Installer laedt selbst. '
                        'Anlegen mit: tools/paketbuendel-bauen.py')

        self._phase('Aushängen …', 0, 0)
        try:
            geraete.boot_aushaengen(mp, melden=self._sagen)
        except Exception as e:
            self._sagen(f'Aushängen: {e}')
        self.post.put(('ende', True))

    def _lauf_attrappe(self):
        """Den Lauf NACHSPIELEN — ohne Netz, ohne Karte, ohne Rechte.

        ══ WARUM DAS NOETIG WURDE ══════════════════════════════════════════
        `--probe` setzte bisher nur `--trocken`, und ein Trockenlauf laedt das
        Abbild WIRKLICH: rund ein Gigabyte von dietpi.com, mit Pruefsumme.
        Wer nur die Oberflaeche ansehen wollte, wartete also minutenlang und
        bekam am Ende einen Netzfehler zu sehen (08.08.2026 gemeldet:
        „in probe wirft es einen fehler"). Ein Ansichtsmodus, der das Netz
        braucht, ist keiner.

        DIE ARBEITSTEILUNG IST JETZT SAUBER:
          * `--probe`  zeigt die Oberflaeche. Kein Netz, kein Schreiben.
          * `--trocken` macht ALLES ausser dem Schreiben — Abbild laden,
            Pruefsumme, Geraet ansprechen. Das ist der echte Probelauf.
        """
        import time as _t
        schritte = [('Rechte holen …', 0.4), ('Abbild suchen …', 0.6),
                    ('Abbild laden', 1.6), ('Prüfsumme prüfen', 0.6),
                    ('Auf die Karte schreiben', 2.0), ('Boot-Partition einhängen', 0.5),
                    ('Einstellungen schreiben', 0.6)]
        self._sagen('ANSICHT — es wird nichts geladen und nichts geschrieben.')
        self._sagen(f"Board: {self.board}  ·  Fassung: {self.CODENAME}")
        self._sagen(f"WLAN: {self.cfg.get('ssid') or '— ohne, am Kabel —'}")
        self._sagen(f"Name: {self.cfg.get('hostname')}")
        for text, dauer in schritte:
            self._phase(text, 0, 100)
            takte = max(1, int(dauer / 0.08))
            for i in range(takte + 1):
                self._phase(None, int(i * 100 / takte), 100)
                _t.sleep(0.08)
            self._sagen(text.rstrip(' …') + ' — angedeutet')
        self.post.put(('ende', True))
        return

    # ── Post aus dem Faden ──────────────────────────────────────────────────
    def _post_lesen(self):
        try:
            while True:
                art, wert = self.post.get_nowait()
                if art == 'karten':
                    self._karten_gesetzt(*wert)
                elif art == 'log':
                    if hasattr(self, 'protokoll') and self.protokoll.winfo_exists():
                        self.protokoll.insert('end', wert.rstrip() + '\n')
                        self.protokoll.see('end')
                elif art == 'wlan':
                    self._wlan_eingetragen(*wert)
                elif art == 'phase':
                    self._phase_zeigen(*wert)
                elif art == 'ende':
                    self._fertig(wert)
        except queue.Empty:
            pass
        self.after(80, self._post_lesen)

    def _phase_zeigen(self, text, getan, gesamt):
        if not hasattr(self, 'l_phase') or not self.l_phase.winfo_exists():
            return
        if text:
            self.l_phase.configure(text=text)
        if getan is not None and gesamt:
            teil = max(0.0, min(1.0, getan / gesamt))
            self.balken.place_configure(width=int(self._bahn.winfo_width() * teil))
            self.l_zahl.configure(text=f'{teil * 100:.0f} %')

    def _fertig(self, gut):
        self.laeuft = False
        if not hasattr(self, 'l_phase') or not self.l_phase.winfo_exists():
            return
        self.l_phase.configure(text='Fertig — Karte in die MixPiBox stecken und einschalten.'
                               if gut else 'Abgebrochen.',
                               fg=GRUEN if gut else ROT)
        if gut:
            # DAS BILD KOMMT ERST JETZT: „Karte in den Pi" ist eine
            # Handlungsanweisung, und sie gilt erst, wenn wirklich etwas auf
            # der Karte steht.
            self.protokoll.pack_forget()
            bild_setzen(self.mitte, 'fertig', 260).pack(pady=(6, 4))
        if gut:
            self.balken.place_configure(width=self._bahn.winfo_width())
            self.l_zahl.configure(text='100 %')
        Knopf(self.mitte, 'Schließen', self.destroy, grund=KISSEN, tinte=TINTE,
              breite=170, hoehe=48, schrift=14).pack(pady=(0, 16))


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    def wert(schalter):
        """Der Wert hinter einem Schalter — oder eine Zeile statt eines Tracebacks."""
        i = argv.index(schalter)
        if i + 1 >= len(argv) or argv[i + 1].startswith('--'):
            sys.exit(f"{schalter} braucht einen Wert (z.B. {schalter} "
                     f"{'RPi4' if schalter == '--board' else '/pfad/zum/fork'})")
        return argv[i + 1]
    board, board_gesetzt = 'RPi5', False
    if '--board' in argv:
        board, board_gesetzt = wert('--board'), True
    # `--fork <pfad>`: nur noetig, wenn dieser Installer NICHT im Fork liegt
    # (dann findet ihn `core.fork_wurzel` von selbst ueber den Elternordner).
    fork = wert('--fork') if '--fork' in argv else None
    f = Fenster(board=board, trocken='--trocken' in argv, probe='--probe' in argv,
                board_gesetzt=board_gesetzt, fork=fork)
    if '--frage-zeigen' in argv:
        # Nur fuers Nachmessen: die Rueckfrage aufschlagen, SOBALD die
        # Attrappe gesetzt ist. 900 ms waren zu frueh — unter Xvfb kam der
        # erste Kartenlauf spaeter, `_fragen` sah `karte = None` und tat
        # (richtigerweise) nichts. Ein Messweg, der still nichts tut, sieht
        # aus wie eine kaputte Oberflaeche.
        f.after(2500, f._fragen)
    f.mainloop()
    return 0


if __name__ == '__main__':
    sys.exit(main())
