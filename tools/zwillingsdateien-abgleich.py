#!/usr/bin/env python3
"""Welche Dateien liegen in BEIDEN Repos — und sind sie auseinandergelaufen?

WOZU: Das box-Repo und der remote-step-installer liefern teilweise DIESELBE
Datei aus, an DIESELBE Stelle auf der Box. Wer sie nur an einem Ort aendert,
hat einen Fehler behoben, den der jeweils andere Weg zurueckbringt:

  * frische Karte  -> remote-step-installer (recipes/*.yaml, put:)
  * laufende Box   -> box-Repo (autosetup/autosetup.sh, update/start_mupibox_update.sh)

Am 05.08.2026 war genau das der Fall: `sitzung_sichern()` kam ins box-Repo
(Commit 5a04a39b), der Installer blieb auf dem Stand vom 27.07.2026. Jede neu
bespielte Karte haette den Fehler aus
llmwiki php-verwaltung-regelte-nichts-weil-die-sitzung-fehlte zurueckbekommen.
Dieselbe Warnung steht seit dem 04.08.2026 schon im Eintrag
i2c-bus-vorhanden-chip-nicht — sie stand dort als Prosa und hat trotzdem
nichts verhindert. Deshalb dieses Werkzeug: die Warnung wird zaehlbar.

ZWEI DURCHGAENGE, UND DER ZWEITE IST DER WICHTIGE

  1. NACH NAMEN. Findet mupi-lautstaerke.sh, mupibox-boot-splash.py und alles,
     was in beiden Repos gleich heisst.

  2. NACH INHALT. Der Installer stellt einigen Dateien ein `mupibox-` voran:
     box `scripts/box/touch-bridge.py`  ist installer `tools/mupibox-touch-bridge.py`.
     Ein reiner Namensabgleich uebersieht genau die — und ausgerechnet
     touch-bridge.py ist die Datei, an der die Warnung im llmwiki haengt.
     Der zweite Durchgang vergleicht deshalb JEDE box-Datei mit JEDER
     Installer-Datei, unabhaengig vom Namen. Vorgefiltert wird ueber gemeinsame
     Zeilen (umgekehrter Index), damit das bezahlbar bleibt.

WIE ES SUCHT: ueber den Dateibestand, nicht ueber eine gepflegte Liste. Eine
Liste in dieser Datei haette denselben Fehler noch einmal erlaubt — man traegt
die Datei ein, die man ohnehin gerade im Kopf hat, und uebersieht die naechste.
Der Dateibestand kann nicht luegen.

WIE ES URTEILT: Namensgleichheit allein sagt nichts (`asound.conf` heisst in
beiden Repos so und hat 6 % gemeinsame Zeilen). Deshalb entscheidet die
Aehnlichkeit der Zeilen:

  GLEICH        Byte fuer Byte identisch                        -> in Ordnung
  AUSEINANDER   aehnlich, aber nicht gleich (>= SCHWELLE)       -> BEFUND
  ABSICHT       auseinander, aber begruendet (siehe unten)      -> kein Befund
  NAMENSGLEICH  nur der Name stimmt ueberein (<  SCHWELLE)      -> Rauschen

WAS ES NICHT KANN: sagen, WELCHE Fassung die richtige ist. Das ist eine
Entscheidung, keine Messung — meist ist es die neuere, aber nicht immer (der
Installer richtet eine FRISCHE Karte ein und darf dort Dinge tun, die auf einer
laufenden Box falsch waeren). Das Werkzeug zeigt den Befund und den Befehl zum
Nachlesen; entschieden wird von Hand.

Genau dafuer gibt es ABSICHT: zwei Paare SOLLEN verschieden sein
(mupibox-boot-splash.service zeigt je auf den eigenen Ausrollpfad, MupiNew.css
ist eine bewusste Bearbeitungskopie von blue.css). Ohne diese Liste meldete
jeder Lauf zwei Befunde, die niemand beheben soll — und der dritte, echte,
ginge darin unter.

AUFRUF
    python3 tools/zwillingsdateien-abgleich.py
    python3 tools/zwillingsdateien-abgleich.py --pruefen     # still, Ruecklauf 1 bei Befund
    python3 tools/zwillingsdateien-abgleich.py --alle        # auch NAMENSGLEICH zeigen
    MUPI_INSTALLER=/pfad/zum/installer python3 tools/zwillingsdateien-abgleich.py
"""

import difflib
import os
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def installer_finden() -> str:
    """Wo liegt der remote-step-installer?

    SEIT DEM 08.08.2026 IM BAUM: `remote-step-installer/` in diesem Repo
    (git subtree, siehe ZUGEZOGEN.md); die alten Nachbarorte sind seit dem
    10.08.2026 stillgelegt. Zuerst wird deshalb im Baum nachgesehen; die
    Suche nach OBEN bleibt als Rueckfall fuer alte Checkouts. Wer ihn
    woanders hat, sagt es ueber MUPI_INSTALLER.
    """
    gesetzt = os.environ.get("MUPI_INSTALLER")
    if gesetzt:
        return gesetzt
    im_baum = os.path.join(WURZEL, "remote-step-installer")
    if os.path.isdir(im_baum):
        return im_baum
    ordner = WURZEL
    for _ in range(6):
        ordner = os.path.dirname(ordner)
        if not ordner or ordner == "/":
            break
        kandidat = os.path.join(ordner, "remote-step-installer")
        if os.path.isdir(kandidat):
            return kandidat
    return os.path.join(os.path.dirname(WURZEL), "remote-step-installer")


INSTALLER = installer_finden()

# Ab hier gelten zwei Dateien als DIESELBE Datei in zwei Fassungen.
# 0.5 ist bewusst niedrig: eine Datei, die in einem Repo doppelt so lang
# geworden ist (genau der Fall bei mupi-lautstaerke.sh, 110 -> 190 Zeilen),
# kommt sonst nicht mehr ueber die Schwelle — und wird ausgerechnet dann
# uebersehen, wenn sie am weitesten auseinander ist.
SCHWELLE = 0.5

# Wie viele gemeinsame Zeilen ein Paar mindestens haben muss, damit der teure
# Vergleich ueberhaupt laeuft. Reine Geschwindigkeitsbremse, kein Urteil: bei
# 8 gemeinsamen Inhaltszeilen liegt die Aehnlichkeit garantiert unter 0.5,
# wenn eine der Dateien nennenswert lang ist.
MINDESTUEBERLAPP = 8

# Verzeichnisse, in denen nichts liegt, was ausgeliefert wird. node_modules und
# dist enthalten zehntausende gleichnamiger Dateien und wuerden den Befund
# unter Rauschen begraben.
UEBERGEHEN = {
    ".git", "node_modules", "dist", "build", "__pycache__", ".venv", "venv",
    ".angular", "coverage", ".cache", ".claude", ".pytest_cache", ".mypy_cache",
    # Der Installer liegt seit dem 08.08.2026 IM Baum — auf der box-Seite
    # wird er ausgenommen, sonst vergliche jede seiner Dateien sich mit sich
    # selbst. Die Installer-Seite laeuft ohnehin IN diesem Ordner los und
    # enthaelt keinen zweiten.
    "remote-step-installer",
}

# Namen, die per se nichts ueber gemeinsame Herkunft sagen. Sie werden gar
# nicht erst verglichen — sonst steht in jedem Lauf derselbe unbrauchbare
# Befund und man gewoehnt sich an rote Zeilen.
BELANGLOS = {
    "README.md", "LICENSE", "LICENSE.md", ".gitignore", ".gitkeep",
    "package.json", "package-lock.json", "tsconfig.json", "__init__.py",
}

# PAARE, DIE AUSEINANDERLAUFEN SOLLEN — mit Grund.
#
# WARUM ES DIESE LISTE GIBT: ein Werkzeug, das bei jedem Lauf zwei Befunde
# meldet, die niemand beheben soll, bringt einem das Weglesen bei. Beim dritten
# Befund — dem echten — schaut dann keiner mehr hin. Das ist derselbe Mechanismus,
# der `sitzung_sichern` neun Tage lang im Installer gefehlt hat: die Warnung
# stand im llmwiki, als Prosa, und wurde ueberlesen.
#
# WAS HIER NICHT HINEINGEHOERT: "haben wir noch nicht geschafft". Ein Eintrag
# ist eine ENTSCHEIDUNG mit Begruendung, kein Aufschub. Wer nur gerade keine
# Zeit hat, laesst den Befund stehen.
ABSICHT = {
    # (Das Paar themes/blue.css <-> dateien/MupiNew.css stand hier bis
    #  E118/1e — BEIDE Seiten sind mit dem alten Farbthemen-System gefallen.)
    ("config/services/mupibox-boot-splash.service", "tools/mupibox-boot-splash.service"):
        "Die beiden ExecStart-Zeilen zeigen mit Absicht auf verschiedene Pfade: "
        "Installer /usr/local/bin/mupibox-boot-splash.py, box-Repo "
        "/usr/local/bin/mupibox/mupibox-boot-splash.py (der Update-Weg raeumt die "
        "alte Stelle weg). Jede Unit passt zu ihrem eigenen Ausrollweg; ein "
        "woertlicher Nachzug wuerde den jeweils anderen ins Leere zeigen lassen. "
        "Der INHALT von mupibox-boot-splash.py wird dagegen gleichgehalten.",
}


def einlesen(wurzel: str) -> dict:
    """Alle Dateien unterhalb `wurzel`: relativer Pfad -> Inhalt.

    Binaeres wird MITGENOMMEN (als Bytes ueber errors="replace"), denn auch ein
    Bild kann doppelt liegen — mixpi-hoert.png tut es. Fuer den Inhaltsvergleich
    faellt es ueber MINDESTUEBERLAPP von selbst heraus.
    """
    gefunden = {}
    for pfad, verzeichnisse, namen in os.walk(wurzel):
        verzeichnisse[:] = [v for v in verzeichnisse if v not in UEBERGEHEN]
        for name in namen:
            if name in BELANGLOS:
                continue
            ganz = os.path.join(pfad, name)
            if os.path.islink(ganz) or not os.path.isfile(ganz):
                continue
            try:
                with open(ganz, encoding="utf-8", errors="replace") as f:
                    gefunden[os.path.relpath(ganz, wurzel)] = f.read()
            except OSError:
                continue
    return gefunden


def kennzeilen(text: str) -> set:
    """Die Zeilen, die eine Datei kennzeichnen.

    Kurze Zeilen (`}`, `fi`, `done`, Leerzeilen) kommen in jeder zweiten Datei
    vor und wuerden den Vorfilter wertlos machen.
    """
    return {z.strip() for z in text.splitlines() if len(z.strip()) > 10}


def aehnlichkeit(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a.splitlines(), b.splitlines()).ratio()


def paare_finden(hier: dict, dort: dict) -> list:
    """Alle Paare (Wert, box-Pfad, installer-Pfad, wie_gefunden).

    Jede Datei taucht hoechstens EINMAL auf, mit ihrem aehnlichsten Gegenstueck
    — sonst meldet eine Datei mit vielen entfernten Verwandten mehrere Befunde
    und man sucht in der Liste statt im Repo.
    """
    # Umgekehrter Index ueber die Installer-Seite: Zeile -> Dateien.
    index = {}
    dort_zeilen = {}
    for pfad, text in dort.items():
        zeilen = kennzeilen(text)
        dort_zeilen[pfad] = zeilen
        for z in zeilen:
            index.setdefault(z, set()).add(pfad)

    roh = []
    for a, text_a in hier.items():
        zeilen_a = kennzeilen(text_a)
        name_a = os.path.basename(a)

        # Kandidaten: alles mit genug gemeinsamen Zeilen — PLUS alles, was
        # gleich heisst. Der Namenstreffer muss auch dann durchkommen, wenn die
        # beiden Fassungen inhaltlich kaum noch etwas teilen: eine Datei, die
        # in einem Repo komplett neu geschrieben wurde, ist der schlimmste Fall
        # und darf nicht der sein, den der Vorfilter verschluckt.
        zaehler = {}
        for z in zeilen_a:
            for b in index.get(z, ()):
                zaehler[b] = zaehler.get(b, 0) + 1
        kandidaten = {b for b, n in zaehler.items() if n >= MINDESTUEBERLAPP}
        kandidaten |= {b for b in dort if os.path.basename(b) == name_a}
        if not kandidaten:
            continue

        beste = None
        for b in kandidaten:
            text_b = dort[b]
            wert = 1.0 if text_a == text_b else aehnlichkeit(text_a, text_b)
            if beste is None or wert > beste[0]:
                beste = (wert, b)
        wert, b = beste
        wie = "Name" if os.path.basename(b) == name_a else "Inhalt"
        roh.append((wert, a, b, wie))

    # Eine Installer-Datei darf nicht mehreren box-Dateien zugeordnet werden.
    # Beste Zuordnung gewinnt, der Rest faellt weg.
    roh.sort(reverse=True)
    vergeben = set()
    paare = []
    for wert, a, b, wie in roh:
        if b in vergeben:
            continue
        vergeben.add(b)
        paare.append((wert, a, b, wie))
    return paare


def main() -> int:
    still = "--pruefen" in sys.argv
    alle = "--alle" in sys.argv

    if not os.path.isdir(INSTALLER):
        print(f"remote-step-installer nicht gefunden: {INSTALLER}")
        print("Pfad ueber MUPI_INSTALLER=… angeben.")
        return 2

    hier = einlesen(WURZEL)
    dort = einlesen(INSTALLER)

    gleich, auseinander, namensgleich, absicht = [], [], [], []
    for wert, a, b, wie in paare_finden(hier, dort):
        if wert == 1.0:
            gleich.append((a, b))
        elif wert >= SCHWELLE:
            if (a, b) in ABSICHT:
                absicht.append((wert, a, b))
            else:
                auseinander.append((wert, a, b, wie))
        elif wie == "Name":
            namensgleich.append((wert, a, b))

    auseinander.sort(reverse=True)

    # Ein Eintrag in ABSICHT, dessen Paar es nicht mehr gibt, ist eine Ausnahme
    # fuer einen Fall, den niemand mehr prueft — und beim naechsten Umbenennen
    # deckt sie stillschweigend etwas Echtes zu. Deshalb wird sie gemeldet.
    verwaist = sorted(set(ABSICHT) - {(a, b) for _, a, b in absicht})

    if still:
        for wert, a, b, wie in auseinander:
            print(f"  {os.path.basename(a)}: {int(wert * 100)} % gleich "
                  f"(ueber {wie}) — box:{a} <-> installer:{b}")
        for a, b in verwaist:
            print(f"  ABSICHT-Eintrag ohne Paar: box:{a} <-> installer:{b} — "
                  "umbenannt oder geloescht? Ausnahme pruefen.")
        return 1 if (auseinander or verwaist) else 0

    print(f"box-Repo:  {WURZEL}")
    print(f"Installer: {INSTALLER}")
    print()
    print(f"{len(gleich)} gleich, {len(auseinander)} AUSEINANDER, "
          f"{len(absicht)} mit Absicht verschieden, "
          f"{len(namensgleich)} nur namensgleich")
    print()

    if auseinander:
        print("AUSEINANDERGELAUFEN — hier bringt der jeweils andere Weg eine")
        print("andere Fassung auf die Box:")
        for wert, a, b, wie in auseinander:
            umbenannt = "" if os.path.basename(a) == os.path.basename(b) else "  [UMBENANNT]"
            print(f"  * {os.path.basename(a)}  ({int(wert * 100)} % gleich){umbenannt}")
            print(f"      box:       {a}")
            print(f"      installer: {b}")
            print(f"      diff -u {os.path.join(INSTALLER, b)} \\")
            print(f"              {os.path.join(WURZEL, a)}")
        print()

    if verwaist:
        print("ABSICHT-EINTRAG OHNE PAAR — die Ausnahme deckt nichts mehr ab.")
        print("Umbenannt, geloescht oder wieder gleichgezogen? Eintrag pruefen:")
        for a, b in verwaist:
            print(f"  * box:{a}  <->  installer:{b}")
        print()

    if absicht:
        print("MIT ABSICHT VERSCHIEDEN (kein Befund — Begruendung in ABSICHT):")
        for wert, a, b in sorted(absicht):
            print(f"  * {a}  <->  {b}  ({int(wert * 100)} % gleich)")
            for zeile in ABSICHT[(a, b)].split(". "):
                if zeile.strip():
                    print(f"      {zeile.strip().rstrip('.')}.")
        print()

    if gleich:
        print("GLEICH (doppelt gelegt, aber im Gleichstand — jede Aenderung")
        print("gehoert trotzdem an BEIDE Stellen):")
        for a, b in sorted(gleich):
            print(f"  {a:52s} <-> {b}")
        print()

    if namensgleich and alle:
        print("NUR NAMENSGLEICH (vermutlich verschiedene Dateien):")
        for wert, a, b in namensgleich:
            print(f"  {int(wert * 100):3d} %  box:{a}  installer:{b}")
        print()
    elif namensgleich:
        print(f"({len(namensgleich)} nur namensgleich — mit --alle anzeigen)")

    if not auseinander and not verwaist:
        print("Kein Befund: beide Repos tragen dieselben Fassungen.")

    return 1 if (auseinander or verwaist) else 0


if __name__ == "__main__":
    sys.exit(main())
