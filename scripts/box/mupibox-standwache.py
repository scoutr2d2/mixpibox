#!/usr/bin/env python3
"""STANDWACHE — der Totmannschalter fuer die Auslieferung.

DAS PROBLEM, DAS ES OHNE SIE GIBT
=================================
`tools/ausliefern.py` tauscht auf der Box `server.js`, `spotify-control.js`,
`www/` und `www-admin/` aus und legt unter `….zurueck` GENAU EINEN Rueckweg an.
Der Rueckweg ist da — nur geht ihn niemand von selbst. Er wird gegangen, wenn
ein Mensch `tools/ausliefern.py --zurueckdrehen` tippt.

Das reicht in genau dem Fall nicht, fuer den er gedacht ist:

  * Die Auslieferung laeuft nachts. Der neue `server.js` startet nicht.
    `mupibox-server.service` faellt in seine Neustartschleife. Die Box ist bis
    zum naechsten Morgen tot — und morgens ist Kindergartenzeit, nicht
    Fehlersuchzeit.
  * Die Verbindung reisst MITTEN im Lauf ab (WLAN, Deckel zu, Akku leer).
    `ausliefern.py` kommt nie bis zum Nachmessen. Es hat getauscht und ist weg.
    Niemand weiss, dass die Box gerade in einem ungeprueften Stand steht.

Beides ist derselbe Fall: DER TAUSCH HAT STATTGEFUNDEN, DIE PRUEFUNG NICHT.
Und die Antwort darauf darf nicht sein „jemand muss nachsehen", denn genau
dieser Jemand ist im Zweifel nicht da.

DIE ANTWORT: EINE FRIST, DIE VON SELBST ABLAEUFT
================================================
Dieselbe Bauart wie die `bootwache.py` fuer die Bildschirm-Drehung:

    umstellen  →  Frist spannen  →  wer nicht binnen der Frist beweist,
                                    dass es laeuft, wird zurueckgedreht.

`ausliefern.py` STELLT die Wache in dem Augenblick, in dem der Tausch fertig
ist — VOR dem Neustart der Dienste, denn ab da ist die Box in einem Stand, den
noch niemand gemessen hat. Danach gilt:

  * Laeuft alles, ENTWARNT `ausliefern.py` selbst (der schnelle Weg).
  * Laeuft es nicht, oder kommt `ausliefern.py` gar nicht mehr bis dorthin,
    dann ist die Wache noch gestellt. Sie sieht jede Minute nach und dreht
    nach Ablauf der Frist ohne jedes Zutun zurueck.

DIE WACHE HAENGT AN NICHTS, WAS KAPUTTGEHEN KANN
================================================
Das ist der Kern und der Grund fuer mehrere Umstaendlichkeiten weiter unten.
Eine Wache, die den Fall nicht ueberlebt, gegen den sie schuetzt, ist keine.

  * NICHT am Arbeitsrechner. Sie laeuft auf der Box, aus einem systemd-Timer.
    Der Laptop darf zuklappen.
  * NICHT am ausgelieferten Server. Sie ist ein eigenes Programm und spricht
    den Server nur an, um ihn zu MESSEN.
  * NICHT am Zwischenlager. `ausliefern.py` raeumt `/home/dietpi/.mupibox/
    .ausliefern` nach jedem Lauf weg — der Tauscher lag frueher NUR dort, und
    damit gab es nach der Auslieferung kein Programm mehr auf der Box, das die
    `.zurueck`-Dateien haette zurueckdrehen koennen. Deshalb legt das Stellen
    eine EIGENE Kopie des Tauschers neben die Frist. Der gestellte Rueckweg ist
    vollstaendig: Auftrag UND Werkzeug, in genau der Fassung, die getauscht hat.
  * NICHT an `/opt/mupibox-tools/mupibox-tauscher.py`. Der ist der Rueckfall,
    nicht der Hauptweg: `--nur scripts` koennte ihn gerade selbst ersetzen.

DREI DINGE, DIE SCHLIMMER WAEREN ALS KEINE WACHE
================================================
Ein Automat, der von selbst am Betriebsstand dreht, ist gefaehrlich. Die drei
Arten, wie er schaden koennte, stehen hier — jede mit ihrer Gegenmassnahme.

1. ZURUECKDREHEN, OBWOHL ALLES IN ORDNUNG IST.
   Passiert, wenn „nicht messbar" mit „kaputt" verwechselt wird. Deshalb:
   Ein Lauf, in dem sich der Zustand NICHT ERMITTELN laesst (systemctl
   antwortet nicht, Netz weg), zaehlt weder als gut noch als schlecht — er
   zaehlt gar nicht. Und zurueckgedreht wird erst nach SCHLECHT_MIN
   unabhaengigen schlechten Messungen, nicht nach einer.

2. ZURUECKDREHEN WAEHREND DES HOCHFAHRENS.
   In den ersten Sekunden nach dem Start ist noch nichts oben. Ein Blick genau
   dann sagt „kaputt" ueber eine gesunde Box. Deshalb: vor START_KARENZ
   Sekunden Laufzeit wird ueberhaupt nicht geurteilt (dieselbe Vorsicht wie
   `OnBootSec` in der Kioskwache, aber im Programm, damit sie auch bei einem
   Aufruf von Hand gilt).

3. VORSCHNELL ENTWARNEN.
   Der gemeinste Fall, weil er wie Erfolg aussieht: Die Wache sieht 20 s nach
   dem Tausch nach, `mupibox-server` meldet `active` — aber das ist noch der
   ALTE Prozess mit dem ALTEN Code im Speicher, weil `ausliefern.py` den
   Neustart noch nicht ausgeloest hat. Die Wache entwarnt, und zwei Sekunden
   spaeter startet der Dienst in einen kaputten `server.js`. Deshalb merkt
   sich das Stellen die KENNUNG jedes Dienstes (NRestarts +
   ExecMainStartTimestampMonotonic) VOR dem Neustart, und entwarnt erst, wenn
   sie sich bewegt hat. Ein Neustart, der noch nicht geschehen ist, kann keinen
   Freispruch begruenden.

WORAN DIE FRIST HAENGT — ZWEI UHREN, WEIL EINE LUEGEN KANN
==========================================================
Der Raspberry hat keine gepufferte Echtzeituhr. Nach dem Hochfahren steht die
Zeit irgendwo, bis NTP sie richtigrueckt, und dann SPRINGT sie.

  * Springt sie VORWAERTS, ist die Frist rechnerisch sofort um. Allein daran
    zu haengen hiesse: zurueckdrehen, ohne je gemessen zu haben. Dagegen steht
    SCHLECHT_MIN — drei schlechte Messungen brauchen drei Laeufe, also rund
    drei Minuten, egal was die Uhr behauptet.
  * Springt sie RUECKWAERTS (oder steht sie in 1970), laeuft die Frist NIE ab.
    Dagegen steht der LAUFZAEHLER: die Wache zaehlt ihre eigenen Blicke mit,
    und `laeufe >= laeufe_max` loest genauso aus wie die Uhrzeit. Ein Zaehler
    kann nicht springen.

Es gilt, was ZUERST eintritt. Beides sind nur Tore — durch das Tor geht es erst
mit den schlechten Messungen aus Punkt 1.

WAS SIE MISST — UND WAS 200 NICHT BEWEIST
=========================================
Dieselbe Regel wie im Nachmessen von `ausliefern.py`: Server (8200) und
Abspieldienst (5005) antworten auf JEDEN Pfad mit 200. Deshalb steht in der
gestellten Frist, WELCHE Zeichenkette die Antwort enthalten muss — der Name des
ausgelieferten `main-*.js`. Das ist die Zeichenkette, die das Minifizieren
ueberlebt, und der Unterschied zwischen „es antwortet" und „es wirkt".

Und bei den Diensten zaehlt nicht `active`, sondern `active UND unveraendert`:
ein Dienst, der alle 20 s neu startet, meldet zwischendurch `active`. Genau so
sah der Abspieldienst nach dem Umschalten auf mpv aus.

WAS SIE NICHT TUT
=================
  * Sie startet die Box NICHT neu. Nie. Es gibt niemanden, der sie wieder
    einschaltet, wenn sie nicht von selbst hochkommt.
  * Sie loescht nichts. Der Rueckweg wird VERTAUSCHT, nicht ueberschrieben —
    danach haelt `….zurueck` den Stand, der gerade nicht lief, und der Weg
    fuehrt weiter in beide Richtungen.
  * Sie dreht HOECHSTENS EINMAL je gestellter Frist zurueck. Die Frist wird
    verbraucht, ob es geholfen hat oder nicht. Eine Wache, die nach einem
    erfolglosen Rueckdrehen wieder zurueckdreht, waere eine Schaukel.

WAS SIE (NOCH) NICHT ABDECKT — ausdruecklich, nicht weggelassen
==============================================================
  * `tools/ausliefern.py --nur scripts` STELLT KEINE FRIST. Dieser Weg tauscht
    Datei fuer Datei nach /usr/local/bin/mupibox und fuehrt ein eigenes
    Gedaechtnis (`.ausliefern-skripte.json`); sein Rueckweg ist
    `--nur scripts --zurueckdrehen`. Ein kaputtes Skript dort legt die Box
    ausserdem nicht auf dieselbe Art lahm wie ein kaputter `server.js`. Es
    waere trotzdem eine Frist wert — das ist offen und steht so im Backlog.
  * SIE IST NOCH NIE AUF DER BOX GELAUFEN. Alles hier ist gegen eine
    nachgestellte Welt geprueft (tools/standwache-nachgestellt.py, 68 Pruefungen)
    und der Rueckweg gegen den ECHTEN Tauscher auf Wegwerfdateien. Was das
    NICHT beweist: dass `systemctl show` auf dieser Box die erwarteten Felder
    liefert, dass `sudo -n` fuer das Stellen reicht, und dass der Zeitgeber
    wirklich jede Minute feuert. Der erste Lauf am Geraet gehoert gemacht,
    BEVOR sich jemand auf sie verlaesst — und zwar mit einer absichtlich
    kaputten Auslieferung, denn ein Totmannschalter, den man nur im guten Fall
    ausprobiert hat, ist ungeprueft.

AUFRUFE
=======
  --nachsehen        der Timer ruft das: messen, entscheiden, ggf. handeln
  --stand            Zustand als JSON, ohne jede Wirkung
  --probe            wie --nachsehen, aber es wird NICHTS getan (nur gesagt)
  --stellen          Frist spannen; Auftrag als JSON auf stdin
                     (das ruft `tools/ausliefern.py` ueber SSH auf)
  --entwarnen        „ich habe nachgemessen, es laeuft" — Frist entfaellt
  --jetzt-zurueck    sofort zurueckdrehen, ohne auf die Frist zu warten

RUECKGABEWERTE
    0  nichts zu tun / entwarnt / Frist laeuft noch
    1  Aufruf falsch, Auftrag unlesbar
    3  zurueckgedreht (kein Fehler dieses Programms — aber es ist etwas
       geschehen, und ein Aufrufer soll das unterscheiden koennen)
    4  zurueckdrehen misslang — hier braucht es einen Menschen
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

# ── Wo die Wache wohnt ──────────────────────────────────────────────────────
#
# /var/lib/mupibox, wie die `bootwache` ihr `drehung`. Der Ort gehoert root
# (755) — das ist Absicht: was hier steht, ist eine Anweisung, am Betriebsstand
# zu drehen. Der Webserver laeuft als dietpi und soll sie nicht umschreiben
# koennen, auch nicht versehentlich.
ZUSTAND = "/var/lib/mupibox/stand"
SCHWEBEND = f"{ZUSTAND}/schwebend.json"
VERLAUF = f"{ZUSTAND}/verlauf.jsonl"
LETZTE = f"{ZUSTAND}/letzte-rueckdrehung.json"
# Die MITGESTELLTE Fassung des Tauschers — der Hauptweg.
TAUSCHER_MIT = f"{ZUSTAND}/tauscher.py"
# Der Rueckfall, falls die mitgestellte Kopie fehlt (alte Frist, von Hand
# angelegt). `--nur scripts` legt ihn dorthin.
TAUSCHER_FALL = "/opt/mupibox-tools/mupibox-tauscher.py"

# ── Die Zahlen, und warum gerade diese ──────────────────────────────────────
FRIST_VORGABE = 600      # 10 Minuten. Lang genug, dass ein Mensch am
                         # Arbeitsrechner in Ruhe nachmisst; kurz genug, dass
                         # eine kaputte Box nicht die Nacht durchsteht.
FRIST_MIN = 120          # Darunter kaeme die Frist der Startkarenz zu nahe.
FRIST_MAX = 3600
START_KARENZ = 120       # Vor 2 Minuten Laufzeit wird nicht geurteilt.
SCHLECHT_MIN = 3         # Drei unabhaengige schlechte Messungen.
STABIL_S = 5             # Abstand der zwei Dienstblicke innerhalb EINES Laufs.
HTTP_PORT = 8200

# ── Der Riegel gegen den eigenen Test ───────────────────────────────────────
#
# HAUSREGEL: Was am Geraet dreht, braucht eine benannte Naht UND einen
# Umgebungsriegel. Die Naht ist `Welt` (der Test setzt eine eigene ein). Der
# Riegel ist diese Variable — und sie ist ABSICHTLICH herum gedreht:
#
#   Sie SPERRT das Handeln, sie erlaubt es nicht.
#
# Ein Riegel, der Handeln erst FREIGIBT (MUPIBOX_STANDWACHE_ECHT=1), waere hier
# falsch: Wer die Unit anfasst und die Variable verliert, haette dann eine
# Wache, die still nichts mehr tut. Ein toter Totmannschalter ist schlimmer als
# gar keiner, weil man sich auf ihn verlaesst.
RIEGEL = "MUPIBOX_STANDWACHE_NIE_HANDELN"


# ── Kleinkram ───────────────────────────────────────────────────────────────
def lies_json(pfad: str):
    try:
        with open(pfad) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def schreib_json(pfad: str, inhalt) -> None:
    """Erst daneben schreiben, dann umbenennen — wie in der `bootwache`.

    Eine halb geschriebene Frist ist der Anker, an dem der Rueckweg haengt.
    Wer beim Schreiben den Strom verliert, braucht ihn ganz oder gar nicht.
    """
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    tmp = f"{pfad}.neu"
    with open(tmp, "w") as f:
        json.dump(inhalt, f, indent=2, ensure_ascii=False)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, pfad)
    try:
        d = os.open(os.path.dirname(pfad), os.O_RDONLY)
        os.fsync(d)
        os.close(d)
    except OSError:
        pass


def jetzt_text(epoch: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(epoch))


# ── DIE NAHT ────────────────────────────────────────────────────────────────
#
# Alles, was die Aussenwelt beruehrt, geht durch diese eine Klasse. Der Test
# setzt eine nachgestellte Fassung ein und kann damit JEDEN Fall durchspielen —
# Neustartschleife, Zeitsprung, abgerissene Verbindung — ohne dass eine Box
# in der Naehe sein muesste, und ohne dass irgendwo etwas gedreht wird.
class Welt:
    """Die echte Welt: Uhr, systemd, HTTP, Dateien, der Tauscher."""

    def __init__(self, reden=print) -> None:
        self.reden = reden

    # -- Uhren ---------------------------------------------------------------
    def jetzt(self) -> float:
        return time.time()

    def laufzeit(self) -> float:
        """Sekunden seit dem Hochfahren. Aus /proc/uptime, nicht aus der Uhr —
        die kann springen, das hier nicht."""
        try:
            with open("/proc/uptime") as f:
                return float(f.read().split()[0])
        except (OSError, ValueError, IndexError):
            # Nicht lesbar heisst NICHT „lange genug oben". Im Zweifel gilt die
            # Box als frisch gestartet; dann wird nicht geurteilt.
            return 0.0

    def boot_id(self) -> str:
        try:
            with open("/proc/sys/kernel/random/boot_id") as f:
                return f.read().strip()
        except OSError:
            return ""

    def warte(self, s: float) -> None:
        time.sleep(s)

    # -- Messen --------------------------------------------------------------
    def dienst_zustand(self, dienst: str) -> dict:
        """Als Schluessel=Wert lesen, NICHT ueber Zeilenposition: systemd gibt
        die Eigenschaften in eigener Reihenfolge aus, und ein leerer Wert
        verschiebt jede Zaehlung. (Derselbe Grund wie in `ausliefern.py`.)"""
        try:
            p = subprocess.run(
                ["systemctl", "show", "-p", "ActiveState", "-p", "SubState",
                 "-p", "NRestarts", "-p", "ExecMainStartTimestampMonotonic", dienst],
                capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError) as e:
            return {"messbar": False, "roh": repr(e)}
        if p.returncode != 0:
            return {"messbar": False, "roh": (p.stderr or p.stdout).strip()[:200]}
        felder = {}
        for zeile in (p.stdout or "").splitlines():
            if "=" in zeile:
                k, _, v = zeile.partition("=")
                felder[k.strip()] = v.strip()
        if "ActiveState" not in felder:
            return {"messbar": False, "roh": (p.stdout or "").strip()[:200]}
        return {
            "messbar": True,
            "roh": " ".join(f"{k}={v}" for k, v in sorted(felder.items())),
            "aktiv": felder.get("ActiveState") == "active"
                     and felder.get("SubState") == "running",
            "kennung": [felder.get("NRestarts"), felder.get("ExecMainStartTimestampMonotonic")],
        }

    def http(self, pfad: str) -> tuple[int, str]:
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{HTTP_PORT}{pfad}", timeout=8) as a:
                return a.status, a.read(200000).decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, ""
        except Exception:  # noqa: BLE001
            return 0, ""

    # -- Dateien -------------------------------------------------------------
    def lies(self, pfad: str):
        return lies_json(pfad)

    def schreib(self, pfad: str, inhalt) -> None:
        schreib_json(pfad, inhalt)

    def entferne(self, pfad: str) -> None:
        try:
            os.unlink(pfad)
        except OSError:
            pass

    def da(self, pfad: str) -> bool:
        return os.path.exists(pfad)

    def anhaengen(self, pfad: str, satz: dict) -> None:
        try:
            os.makedirs(os.path.dirname(pfad), exist_ok=True)
            with open(pfad, "a") as f:
                f.write(json.dumps(satz, ensure_ascii=False) + "\n")
        except OSError:
            pass

    # -- HANDELN. Ab hier wird gedreht. --------------------------------------
    def _gesperrt(self) -> bool:
        if os.environ.get(RIEGEL):
            self.reden(f"  {RIEGEL} ist gesetzt — es wird NICHTS getan.")
            return True
        return False

    def zurueckdrehen(self, ziele: list, tauscher: str) -> dict:
        """Den Tauscher rufen, so wie `ausliefern.py` es ueber SSH tut. NICHT
        nachbauen: eine zweite Fassung derselben Rechnung ist eine zweite
        Gelegenheit, denselben Fehler anders zu machen."""
        if self._gesperrt():
            return {"zurueck": [], "fehler": ["gesperrt"], "ohne_rueckweg": [],
                    "ohne_wirkung": []}
        try:
            p = subprocess.run(
                [sys.executable, tauscher, "zurueckdrehen"],
                input=json.dumps({"ziele": ziele}),
                capture_output=True, text=True, timeout=600)
        except (OSError, subprocess.SubprocessError) as e:
            return {"zurueck": [], "fehler": [f"Tauscher nicht ausfuehrbar: {e!r}"],
                    "ohne_rueckweg": [], "ohne_wirkung": []}
        if p.returncode != 0 or not p.stdout.strip():
            return {"zurueck": [], "ohne_rueckweg": [], "ohne_wirkung": [],
                    "fehler": [f"Tauscher rc={p.returncode}: "
                               f"{(p.stderr or p.stdout).strip()[:400]}"]}
        try:
            return json.loads(p.stdout)
        except ValueError as e:
            return {"zurueck": [], "ohne_rueckweg": [], "ohne_wirkung": [],
                    "fehler": [f"Tauscher antwortete unlesbar: {e!r}"]}

    def dienste_neustarten(self, dienste: list) -> tuple[bool, str]:
        if not dienste:
            return True, "kein Dienst betroffen"
        if self._gesperrt():
            return False, "gesperrt"
        try:
            p = subprocess.run(["systemctl", "restart", *dienste],
                               capture_output=True, text=True, timeout=180)
        except (OSError, subprocess.SubprocessError) as e:
            return False, repr(e)
        return p.returncode == 0, (p.stderr or p.stdout).strip()[:300]


# ── MESSEN: laeuft der Stand, der da liegt? ─────────────────────────────────
def messen(welt: Welt, frist: dict) -> dict:
    """Ein Befund ueber den LAUFENDEN Stand. Drei Werte, absichtlich getrennt:

        messbar   — liess sich der Zustand ueberhaupt ermitteln?
        heil      — ist alles in Ordnung?
        gedreht   — hat der Dienst seit dem Stellen wirklich neu gestartet?

    `messbar=False` ist NICHT `heil=False`. Wer das zusammenwirft, dreht bei
    jedem Netzhaenger den Betriebsstand zurueck.
    """
    befund = {"messbar": True, "heil": True, "gedreht": True, "zeilen": []}

    # (a) Die Dienste: aktiv UND ueber STABIL_S hinweg unveraendert.
    dienste = frist.get("dienste") or []
    vorher = frist.get("dienste_vorher") or {}
    zwei_blicke = {}
    for d in dienste:
        zwei_blicke[d] = [welt.dienst_zustand(d)]
    if dienste:
        welt.warte(STABIL_S)
        for d in dienste:
            zwei_blicke[d].append(welt.dienst_zustand(d))

    for d in dienste:
        erst, zweit = zwei_blicke[d]
        if not erst.get("messbar") or not zweit.get("messbar"):
            befund["messbar"] = False
            befund["zeilen"].append(f"{d}: nicht messbar ({zweit.get('roh', '')[:120]})")
            continue
        if not (erst["aktiv"] and zweit["aktiv"]):
            befund["heil"] = False
            befund["zeilen"].append(f"{d}: nicht aktiv [{zweit['roh']}]")
            continue
        if erst["kennung"] != zweit["kennung"]:
            # Zwischen zwei Blicken neu gestartet: das ist die Neustartschleife,
            # und sie meldet zwischendurch `active`.
            befund["heil"] = False
            befund["zeilen"].append(
                f"{d}: startet staendig neu [{erst['roh']}] → [{zweit['roh']}]")
            continue
        # Hat der Neustart, auf den die Frist wartet, schon stattgefunden?
        # Nach einem Neustart der ganzen Box ist die Frage gegenstandslos: die
        # Kennungen zaehlen dann ohnehin von vorn, und der Dienst ist mit dem
        # neuen Stand hochgekommen.
        if d in vorher and not frist.get("_neu_gebootet") and zweit["kennung"] == vorher[d]:
            befund["gedreht"] = False
            befund["zeilen"].append(
                f"{d}: laeuft noch unveraendert seit dem Stellen — "
                f"der Neustart steht aus")
            continue
        befund["zeilen"].append(f"{d}: aktiv und stabil [{zweit['roh']}]")

    # (b) Die Wirkung. HTTP 200 beweist nichts — es zaehlt, WAS in der Antwort
    #     steht. `hat: ""` heisst „es muss ueberhaupt antworten".
    for w in frist.get("wirkung") or []:
        code, text = welt.http(w["pfad"])
        if code == 0:
            # Keine Antwort ist NICHT „nicht messbar": ein Server, der nicht
            # antwortet, ist genau der Fall, gegen den die Frist steht.
            befund["heil"] = False
            befund["zeilen"].append(f"{w['pfad']}: keine Antwort")
        elif code != 200:
            befund["heil"] = False
            befund["zeilen"].append(f"{w['pfad']}: HTTP {code}")
        elif w.get("hat") and w["hat"] not in text:
            befund["heil"] = False
            befund["zeilen"].append(
                f"{w['pfad']}: nennt {w['hat']} NICHT ({len(text)} B)")
        else:
            befund["zeilen"].append(
                f"{w['pfad']}: in Ordnung" + (f" (nennt {w['hat']})" if w.get("hat") else ""))
    return befund


# ── ENTSCHEIDEN: reine Rechnung, keine Wirkung ──────────────────────────────
#
# Diese Funktion fasst NICHTS an. Sie bekommt die Frist, den Befund und die
# beiden Uhren und sagt, was zu tun waere. Genau deshalb laesst sich jeder Fall
# hier durchspielen, ohne dass eine Box in der Naehe sein muss.
def entscheiden(frist: dict | None, befund: dict, jetzt: float,
                laufzeit: float) -> tuple[str, str]:
    """→ ('nichts'|'warten'|'entwarnen'|'zurueckdrehen', Begruendung)

    ES GIBT NUR ZWEI ZUSTAENDE, NICHT DREI. „kaputt" und „noch nicht bewiesen"
    fuehren zum selben Ende, und das ist Absicht:

      Ein `heil, aber nicht gedreht` waere sonst eine Sackgasse. Genau so sieht
      es aus, wenn `ausliefern.py` NACH dem Tausch und VOR dem Neustart
      abreisst: auf der Platte liegt der neue Stand, im Speicher laeuft der
      alte, und alles meldet „in Ordnung". Wer das dauerhaft als `warten`
      behandelt, laesst die Box in genau diesem Zwitterstand stehen — bis zum
      naechsten Neustart, der dann ungeprueften Code hochfaehrt.

    Deshalb zaehlt hier nur: WURDE BEWIESEN, DASS ES LAEUFT? Alles andere ist
    unbewiesen und laeuft nach Ablauf der Frist auf denselben Rueckweg. Die
    Unterscheidung bleibt in den Meldezeilen — dort hilft sie einem Menschen.
    """
    if not frist:
        return "nichts", "keine Frist gestellt"
    if frist.get("erledigt"):
        # Verbraucht ist verbraucht. Sonst entstuende eine Schaukel: einmal
        # zurueckgedreht, beim naechsten Blick wieder hin.
        return "nichts", f"Frist bereits erledigt ({frist['erledigt']})"

    if laufzeit < START_KARENZ:
        return "warten", (f"die Box laeuft erst {int(laufzeit)} s — vor "
                          f"{START_KARENZ} s wird nicht geurteilt")

    if not befund["messbar"]:
        # NICHT MESSBAR ZAEHLT NICHT — weder als Freispruch noch als Urteil.
        # Wer es als Urteil nimmt, dreht bei jedem Haenger den Betriebsstand
        # zurueck; wer es als Freispruch nimmt, entwarnt ueber eine Box, die er
        # gar nicht gesehen hat.
        #
        # DIESE REIHENFOLGE IST DER FEHLER, DEN DER TEST GEFUNDEN HAT: Stand
        # die Entwarnung zuerst, so entwarnte ein unmessbarer Lauf — denn
        # `heil` und `gedreht` sind Vorgabewerte, die nur ein GESEHENER Mangel
        # umlegt. Was man nicht messen konnte, kann man nicht freisprechen.
        return "warten", "der Zustand liess sich nicht ermitteln"

    if befund["heil"] and befund["gedreht"]:
        return "entwarnen", "alles gemessen und in Ordnung"

    unbewiesen = int(frist.get("unbewiesen", 0))
    laeufe = int(frist.get("laeufe", 0))
    uhr_um = jetzt >= float(frist.get("frist_bis", 0))
    zaehler_um = laeufe >= int(frist.get("laeufe_max", 10 ** 9))
    warum = "nicht in Ordnung" if not befund["heil"] else "der Neustart steht aus"
    if not (uhr_um or zaehler_um):
        rest = int(float(frist.get("frist_bis", 0)) - jetzt)
        return "warten", (f"{warum}, aber die Frist laeuft noch ({rest} s bzw. "
                          f"{int(frist.get('laeufe_max', 0)) - laeufe} Blicke)")
    if unbewiesen < SCHLECHT_MIN:
        return "warten", (f"Frist um, aber erst {unbewiesen} von {SCHLECHT_MIN} "
                          f"Messungen ohne Beweis — es wird nicht nach einer geurteilt")
    tor = "Uhr" if uhr_um and not zaehler_um else (
        "Laufzaehler" if zaehler_um and not uhr_um else "Uhr und Laufzaehler")
    return "zurueckdrehen", (f"{unbewiesen} Messungen ohne Beweis ({warum}) "
                             f"und die Frist ist um ({tor})")


# ── Die Frist stellen ───────────────────────────────────────────────────────
def stellen(welt: Welt, auftrag: dict) -> dict:
    frist_s = int(auftrag.get("frist_s") or FRIST_VORGABE)
    frist_s = max(FRIST_MIN, min(FRIST_MAX, frist_s))
    jetzt = welt.jetzt()
    frist = {
        "gestellt": jetzt_text(jetzt),
        "gestellt_epoch": jetzt,
        "boot_id": welt.boot_id(),
        "von": auftrag.get("von", "unbekannt"),
        "stempel": auftrag.get("stempel", ""),
        "frist_s": frist_s,
        "frist_bis": jetzt + frist_s,
        "frist_bis_text": jetzt_text(jetzt + frist_s),
        # Das zweite Tor, das nicht springen kann: ein Blick je Minute plus
        # Reserve. Siehe „ZWEI UHREN" im Kopf.
        "laeufe_max": frist_s // 60 + 5,
        "laeufe": 0,
        "unbewiesen": 0,
        "unmessbar": 0,
        "ziele": auftrag["ziele"],
        "dienste": auftrag.get("dienste") or [],
        "dienste_vorher": auftrag.get("dienste_vorher") or {},
        "wirkung": auftrag.get("wirkung") or [],
        "erledigt": None,
    }
    welt.schreib(SCHWEBEND, frist)
    return frist


def tauscher_finden(welt: Welt) -> str | None:
    for p in (TAUSCHER_MIT, TAUSCHER_FALL):
        if welt.da(p):
            return p
    return None


def abschliessen(welt: Welt, frist: dict, wie: str, satz: dict) -> None:
    """Die Frist verbrauchen — und zwar so, dass kein Blick sie wiederbelebt."""
    frist["erledigt"] = wie
    frist["erledigt_um"] = jetzt_text(welt.jetzt())
    welt.anhaengen(VERLAUF, {**satz, "wie": wie, "um": frist["erledigt_um"],
                             "gestellt": frist.get("gestellt"),
                             "von": frist.get("von"), "stempel": frist.get("stempel")})
    # ERST den Verlauf, DANN das Wegnehmen: waere es andersherum und der Strom
    # ginge dazwischen weg, waere die Frist weg und niemand wuesste, warum.
    welt.entferne(SCHWEBEND)
    welt.entferne(TAUSCHER_MIT)


# ── Der Weg, den der Timer geht ─────────────────────────────────────────────
def nachsehen(welt: Welt, trocken: bool = False, erzwingen: bool = False) -> int:
    sag = welt.reden
    frist = welt.lies(SCHWEBEND)
    if not frist:
        sag("Keine schwebende Auslieferung. Nichts zu tun.")
        return 0

    # Hat die Box zwischendurch neu gestartet? Dann zaehlen die Dienstkennungen
    # von vorn, und „der Neustart steht noch aus" waere eine falsche Bremse.
    jetzt_boot = welt.boot_id()
    frist["_neu_gebootet"] = bool(jetzt_boot and frist.get("boot_id")
                                  and jetzt_boot != frist["boot_id"])

    laufzeit = welt.laufzeit()
    befund = messen(welt, frist)
    jetzt = welt.jetzt()

    # Der Laufzaehler zaehlt JEDEN Blick, auch den nicht messbaren — sonst
    # koennte eine Box, an der nie etwas messbar ist, ewig in der Schwebe
    # haengen. Die schlechten Messungen zaehlen getrennt.
    frist["laeufe"] = int(frist.get("laeufe", 0)) + 1
    if not befund["messbar"]:
        frist["unmessbar"] = int(frist.get("unmessbar", 0)) + 1
    elif not (befund["heil"] and befund["gedreht"]):
        frist["unbewiesen"] = int(frist.get("unbewiesen", 0)) + 1
    else:
        # Wieder bewiesen: der Zaehler faellt zurueck. Die drei Messungen
        # sollen drei AUFEINANDERFOLGENDE sein, nicht drei ueber den Tag
        # verteilte Aussetzer.
        frist["unbewiesen"] = 0

    was, grund = entscheiden(frist, befund, jetzt, laufzeit)
    if erzwingen and was != "nichts":
        # `--jetzt-zurueck`: der Mensch hat entschieden. Gemessen wird trotzdem
        # — damit im Verlauf steht, WIE es aussah, als jemand den Knopf drueckte.
        was, grund = "zurueckdrehen", f"von Hand angestossen (Befund: {grund})"

    sag(f"Schwebende Auslieferung von {frist.get('gestellt')} "
        f"({frist.get('von')}, {frist.get('stempel')})")
    sag(f"  Blick {frist['laeufe']}/{frist.get('laeufe_max')}, "
        f"ohne Beweis {frist['unbewiesen']}/{SCHLECHT_MIN}, "
        f"unmessbar {frist['unmessbar']}, "
        f"Frist bis {frist.get('frist_bis_text')}")
    for z in befund["zeilen"]:
        sag(f"    {z}")
    sag(f"  → {was.upper()}: {grund}")

    if trocken:
        sag("  (--probe: es wird nichts getan, auch der Zaehler bleibt stehen)")
        return 0

    if was == "warten":
        welt.schreib(SCHWEBEND, frist)   # nur die Zaehler fortschreiben
        return 0
    if was == "nichts":
        return 0
    if was == "entwarnen":
        abschliessen(welt, frist, "entwarnt", {"grund": grund, "befund": befund["zeilen"]})
        sag("  Die Frist ist entfallen. Der Rueckweg unter ….zurueck bleibt liegen.")
        return 0

    # ── Zurueckdrehen ───────────────────────────────────────────────────────
    tauscher = tauscher_finden(welt)
    if not tauscher:
        sag(f"  KEIN TAUSCHER GEFUNDEN ({TAUSCHER_MIT}, {TAUSCHER_FALL}).")
        sag("  Die Frist bleibt stehen, damit der Befund nicht verlorengeht.")
        welt.schreib(SCHWEBEND, frist)
        return 4
    sag(f"  Zurueckdrehen mit {tauscher} …")
    ergebnis = welt.zurueckdrehen(frist["ziele"], tauscher)
    for m in ergebnis.get("fehler", []):
        sag(f"    FEHLER {m}")
    if ergebnis.get("ohne_rueckweg"):
        sag(f"    ohne Rueckweg (nichts zum Zurueckdrehen): "
            f"{', '.join(ergebnis['ohne_rueckweg'])}")
    if ergebnis.get("ohne_wirkung"):
        sag(f"    wirkungslos (Ziel und Rueckweg sind DIESELBE Datei): "
            f"{', '.join(ergebnis['ohne_wirkung'])}")
    sag(f"    zurueckgedreht: {', '.join(ergebnis.get('zurueck') or []) or 'nichts'}")

    ok, meldung = welt.dienste_neustarten(frist.get("dienste") or [])
    sag(f"    Dienste neu gestartet: {'ja' if ok else 'NEIN — ' + meldung}")

    satz = {"grund": grund, "befund": befund["zeilen"], "ergebnis": ergebnis,
            "neustart": ok}
    welt.schreib(LETZTE, {**satz, "um": jetzt_text(welt.jetzt()),
                          "gestellt": frist.get("gestellt"),
                          "stempel": frist.get("stempel")})
    abschliessen(welt, frist, "zurueckgedreht", satz)

    schlimm = bool(ergebnis.get("fehler")) or not ergebnis.get("zurueck") or not ok
    if schlimm:
        sag("  ZURUECKDREHEN NICHT VOLLSTAENDIG. Hier braucht es einen Menschen.")
        return 4
    sag("  Zurueckgedreht. Die Box laeuft auf dem Stand von VOR der Auslieferung.")
    sag(f"  Was geschehen ist, steht in {LETZTE} und {VERLAUF}.")
    return 3


# ── Aufruf ──────────────────────────────────────────────────────────────────
def main(argv=None, welt: Welt | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Totmannschalter fuer die Auslieferung: dreht ohne Zutun "
                    "zurueck, wenn nach einer Auslieferung niemand beweist, "
                    "dass die Box laeuft.")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--nachsehen", action="store_true",
                   help="messen, entscheiden, ggf. handeln (der Timer ruft das)")
    g.add_argument("--probe", action="store_true",
                   help="wie --nachsehen, aber es wird NICHTS getan")
    g.add_argument("--stand", action="store_true", help="Zustand als JSON")
    g.add_argument("--stellen", action="store_true",
                   help="Frist spannen; Auftrag als JSON auf stdin")
    g.add_argument("--entwarnen", action="store_true",
                   help="'ich habe nachgemessen, es laeuft' — die Frist entfaellt")
    g.add_argument("--jetzt-zurueck", action="store_true",
                   help="sofort zurueckdrehen, ohne auf die Frist zu warten")
    a = p.parse_args(argv)
    welt = welt or Welt()

    if a.stand:
        frist = welt.lies(SCHWEBEND)
        print(json.dumps({
            "schwebt": bool(frist),
            "frist": frist,
            "letzte_rueckdrehung": welt.lies(LETZTE),
            "tauscher": tauscher_finden(welt),
        }, indent=2, ensure_ascii=False))
        return 0

    if a.stellen:
        try:
            auftrag = json.load(sys.stdin)
        except ValueError as e:
            print(f"Auftrag unlesbar: {e}", file=sys.stderr)
            return 1
        if not auftrag.get("ziele"):
            print("Auftrag ohne `ziele` — es gaebe nichts zurueckzudrehen.",
                  file=sys.stderr)
            return 1
        frist = stellen(welt, auftrag)
        print(json.dumps({"gestellt": frist["gestellt"],
                          "frist_bis": frist["frist_bis_text"],
                          "laeufe_max": frist["laeufe_max"]}, ensure_ascii=False))
        return 0

    if a.entwarnen:
        frist = welt.lies(SCHWEBEND)
        if not frist:
            print("Keine schwebende Auslieferung — nichts zu entwarnen.")
            return 0
        abschliessen(welt, frist, "entwarnt", {"grund": "von Hand entwarnt"})
        print("Entwarnt. Der Rueckweg unter ….zurueck bleibt liegen.")
        return 0

    if a.jetzt_zurueck:
        frist = welt.lies(SCHWEBEND)
        if not frist:
            print("Keine schwebende Auslieferung — es gibt nichts zurueckzudrehen.",
                  file=sys.stderr)
            return 1
        # Von Hand heisst: die Tore der Frist entfallen. NICHT ueber gefaelschte
        # Zaehler — die wuerde `nachsehen` beim naechsten guten Blick wieder
        # zuruecksetzen und dann ENTWARNEN statt zurueckzudrehen. Der Wille des
        # Menschen steht ausserhalb der Rechnung, nicht in ihren Eingaben.
        return nachsehen(welt, erzwingen=True)

    return nachsehen(welt, trocken=a.probe)


if __name__ == "__main__":
    sys.exit(main())
