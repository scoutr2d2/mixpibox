#!/usr/bin/env python3
"""Die UNTERGRENZE DER BILDSCHIRMHELLIGKEIT — haelt sie, und steht sie nur an EINEM Ort?

WARUM ES DIESES WERKZEUG GIBT
=============================
DIE UNTERGRENZE IST KEINE KOSMETIK. 0 % ist ein schwarzes Display, und ein
schwarzes Display ist eine kaputte Box: wer den Regler am Geraet ganz nach
links zieht, sieht danach auch den Regler nicht mehr, mit dem er es
zuruecknehmen koennte. Zurueck kommt man nur ueber SSH, und wer eine Kinderbox
betreibt, hat kein SSH.

Gebaut wurde es am 07.08.2026, weil dieselbe Grenze an ZWEI Orten in zwei
Sprachen stand:

  NEU   PUT /api/schirm/helligkeit
        Regeln in src/backend-api/src/schirmhelligkeit.ts, Untergrenze
        `PROZENT_MIN`.
  ALT   POST newbrightness aus der alten Verwaltung
        AdminInterface/www/mupi.php, lag als /var/www/mupi.php auf jeder
        ausgelieferten Box. Untergrenze `$HELLIGKEIT_PROZENT_MIN`.

WAS SICH AM 19.08.2026 GEAENDERT HAT (E47, Commit 52d21406)
===========================================================
PHP hat das Projekt verlassen. `AdminInterface/` ist geloescht, 32 PHP-Dateien,
und mit ihnen die groesste Rechteausweitung der Box: `autosetup.sh` legte
`www-data ALL=(ALL:ALL) NOPASSWD: ALL` nach /etc/sudoers.d/, weil der alte
Admin seine Arbeit ueber `exec('sudo …')` machte. DER ZWEITE ORT IST WEG.

Von da an prueft dieses Werkzeug eine Datei, die es nicht mehr gibt: es brach
bei jedem Lauf mit `Nicht lesbar: …/mupi.php` ab (Rueckgabe 2, nicht gruen —
das AUDIT-2026-09-19 Rang 9 sagt „gruen", das war am 19.09. nachgemessen
falsch). Ein Werkzeug, das nur noch abbricht, ist trotzdem keine Wache.

Am 19.09.2026 deshalb auf den Gegenstand umgebaut, den es HEUTE gibt. Die
Frage ist nicht mehr „stimmen die zwei Zahlen ueberein", sondern die eine
Stufe darueber:

    Gibt es noch genau EINE Untergrenze, und sperrt sie?

Das ist dieselbe Sorge wie vorher ([[drei-orte-eine-anzeige]]), nur an der
richtigen Stelle: die Oberflaeche holt `min`/`max`/`schritt` seit dem Umbau
UNVERAENDERT aus `GET /api/schirm/helligkeit` (NewDesign/app.js, Feld
`schirm`) und schreibt keine eigene Zahl mehr ab. Bleibt das so, kann die
Grenze nicht auseinanderlaufen. Kommt eine zweite Zahl zurueck — durch ein
Backup, einen Merge, ein wiederbelebtes PHP-Admin —, meldet sich diese Wache.

WAS GEPRUEFT WIRD
=================
  A  DIE EINE ZAHL (src/backend-api/src/schirmhelligkeit.ts)
     A1 `PROZENT_MIN` steht da und ist groesser als 0.
     A2 `PROZENT_MAX` steht da, ist groesser als PROZENT_MIN, hoechstens 100.
     A3 `rohUntergrenze()` haelt BEIDE Riegel: die Rechnung aus PROZENT_MIN
        UND das `Math.max(1, …)` darunter. Der zweite ist kein Doppel des
        ersten — bei `max_brightness = 2` ergaeben 20 % gerundet 0.
     A4 `klemmeProzent()` klemmt gegen PROZENT_MIN.

  B  KEIN ZWEITER ORT (im ganzen verfolgten Baum, nicht an einem Pfad —
     [[wache-auf-sorte-nicht-auf-pfad]])
     B1 Keine verfolgte .php-Datei. PHP ist seit E47 draussen; kommt es
        zurueck, kommt die sudo-Regel mit.
     B2 Keine Datei fuehrt eine zweite Untergrenze `$HELLIGKEIT_PROZENT_MIN`.

  C  WENN DER ZWEITE ORT DOCH DA IST, wird wieder verglichen — der alte
     Vergleich steht vollstaendig und unveraendert:
     C1 PROZENT_MIN (TS)  ==  $HELLIGKEIT_PROZENT_MIN (PHP)
     C2 PROZENT_MAX (TS)  ==  $HELLIGKEIT_PROZENT_MAX (PHP)
     C3 Die Stufentabelle bietet keine Stufe unterhalb der Untergrenze an —
        und keine, die den Rohwert 0 schreibt.
     C4 Die Rohwerte der Tabelle stimmen mit `prozentZuRoh` ueberein
        (nachgebaut fuer max_brightness = 255, dem am Geraet gemessenen Wert
        des Waveshare-Panels 11-0045).
     C5 Der Schieber faengt nicht unterhalb der Untergrenze an.

ABBRUCH IST NICHT GRUEN (die Lehre, die im Kopf von tools/shellcheck-ratsche.sh
steht): Fehlt der Gegenstand von A — `schirmhelligkeit.ts`, oder eine der
Stellen darin —, sagt diese Wache NICHT „keine Luecke", sondern bricht mit
Rueckgabe 2 UND einer Anleitung ab. Eine Wache, die bei fehlendem Gegenstand
gruen ist, prueft nichts und sieht dabei aus, als pruefte sie.

Das FEHLEN der PHP-Seite ist kein fehlender Gegenstand, sondern der gepruefte
ZUSTAND: „es gibt nur noch einen Ort" ist die Aussage von B, nicht ihr
Ausfall. Der Unterschied ist der ganze Umbau vom 19.09.

MIT PHP: WAS DIE ALTE SEITE WIRKLICH TUT (nur, wenn es sie wieder gibt)
========================================
    python3 tools/helligkeit-untergrenze-vergleich.py --mit-php
    python3 tools/helligkeit-untergrenze-vergleich.py --mit-php --php-ueber 192.168.178.169

schneidet die Zuordnung AUS mupi.php heraus (Tabelle, Auswertung von
$_POST['newbrightness'] und die Zeile, die daraus den Shell-Befehl baut) und
laesst sie unter echtem PHP gegen boesartige Eingaben laufen: "0", 0, " 0 ",
"-5", "0abc", "0; reboot", ein Array, gar nichts. Geprueft wird, dass NIE ein
Rohwert unter der Untergrenze herauskommt und dass die gebaute Shell-Zeile immer
nur aus einer der erlaubten Zahlen besteht.

Das ist der Unterschied zwischen "im Quelltext steht keine 0 mehr" und "es
KOMMT keine 0 heraus". Gebraucht wird dafuer ein php — lokal, sonst per
--php-ueber HOST auf der Box (nur `php` ueber die Standardeingabe; es wird
NICHTS geschrieben, NICHTS ausgeliefert und das Panel NICHT angefasst, denn der
Teil mit exec() wird gar nicht erst mitgeschnitten).

OPTIONAL, NUR LESEND, GEGEN DIE LAUFENDE BOX
============================================
    python3 tools/helligkeit-untergrenze-vergleich.py --am-geraet 192.168.178.169

holt /var/www/mupi.php per ssh (nur `cat`, es wird NICHTS geschrieben und
NICHTS ausgeliefert) und sagt, ob die AUSGELIEFERTE Kopie die 0 noch anbietet.
Das ist die Antwort auf die Frage "ist das Loch auf DER Box zu?" — im Baum
etwas zu reparieren schliesst es dort noch nicht.

RUECKGABE
=========
  0  eine Untergrenze, sie sperrt, und es gibt keine zweite
  1  ROT: die Grenze sperrt nicht — oder es gibt wieder einen zweiten Ort,
     und die Zahlen laufen auseinander
  2  ABBRUCH mit Anleitung: der Gegenstand von A fehlt. NIE gruen.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
TS_DATEI = WURZEL / "src" / "backend-api" / "src" / "schirmhelligkeit.ts"

# Wo die zweite Zahl bis E47 stand. NUR noch als Erwartung fuer die
# Fehlermeldung — gesucht wird nicht hier, sondern nach der SORTE (siehe
# `zweite_orte`): ein wiederbelebtes PHP-Admin kaeme kaum unter demselben
# Pfad zurueck, sondern aus einem Backup, einem Merge oder einer Kopie.
PHP_HISTORISCH = Path("AdminInterface") / "www" / "mupi.php"

# Der Name der zweiten Untergrenze, ZUR LAUFZEIT zusammengesetzt. Stuende er
# als ein Stueck da, faende die Suche unten diese Datei selbst und waere ab
# dem ersten Lauf rot — dieselbe Falle wie die Attrappe in
# tools/admin-abschnitte-deckung.py.
PHP_MARKE = "$" + "HELLIGKEIT_" + "PROZENT_MIN"

# Wo NICHT gesucht wird, und warum: ein Kommentar, der die Marke ZITIERT, ist
# keine zweite Untergrenze, und ein Kompilat ist keine Quelle. Beides wuerde
# diese Wache auf die gefaehrlichste Art beschaeftigen — rot ohne Gegenstand.
NICHT_DURCHSUCHEN = ("tools/", "llmwiki/", "dokumentation/", "src/deploy/", ".claude/")
NICHT_DURCHSUCHEN_ENDUNG = (".md", ".log", ".png", ".jpg", ".ico", ".zip", ".gz")

# max_brightness des Panels an der Box (11-0045), am 07.08.2026 gelesen.
# Steht hier als ZAHL und nicht als Vermutung: die alte Seite rechnet fest mit
# 0..255, der neue Weg liest den Wert. Verglichen werden kann nur, was die alte
# Seite annimmt.
MAX_ROH = 255


class Befund:
    def __init__(self) -> None:
        self.zeilen: list[str] = []
        self.rot = False

    def gut(self, text: str) -> None:
        self.zeilen.append("  ok   " + text)

    def schlecht(self, text: str) -> None:
        self.zeilen.append("  ROT  " + text)
        self.rot = True


def ts_zahl(text: str, name: str) -> int | None:
    treffer = re.search(r"export\s+const\s+" + name + r"\s*(?::\s*number\s*)?=\s*(\d+)", text)
    return int(treffer.group(1)) if treffer else None


def ts_funktion(text: str, name: str) -> str | None:
    """Der RUMPF einer exportierten Funktion, ohne ihren Kopf.

    Gesucht wird der Rumpf und nicht der Name allein: dass es eine Funktion
    `rohUntergrenze` gibt, sagt nichts darueber, ob sie noch sperrt.
    """
    treffer = re.search(r"export function\s+" + name + r"\s*\([^)]*\)[^{]*\{(.*?)\n\}", text, re.S)
    return treffer.group(1) if treffer else None


def verfolgte_dateien() -> list[Path]:
    """Alle Dateien, in denen eine zweite Untergrenze stehen KOENNTE.

    Im Baum sind das die von git verfolgten — damit fallen node_modules und
    Bauergebnisse von allein weg. Im Spiegel von
    tools/untergrenzen-waechter-probe.py gibt es kein git; dort wird gelaufen.
    BEIDE Wege muessen gehen, sonst prueft die Probe etwas anderes als der
    Ernstfall, und ihr Urteil gilt fuer den Ernstfall nicht.
    """
    if (WURZEL / ".git").exists():
        try:
            ergebnis = subprocess.run(
                ["git", "-C", str(WURZEL), "ls-files", "-z"],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if ergebnis.returncode == 0:
                return [WURZEL / name for name in ergebnis.stdout.split("\0") if name]
        except (OSError, subprocess.TimeoutExpired):
            pass
    gemieden = {"node_modules", ".git", "dist", "build", ".angular"}
    return [p for p in WURZEL.rglob("*") if p.is_file() and gemieden.isdisjoint(p.parts)]


def git_marken_traeger() -> set[str] | None:
    """Welche verfolgten Dateien fuehren die Marke? `None` = ohne git gefragt.

    Die Antwort ist eine Abkuerzung, kein zweites Urteil: gefiltert und
    bewertet wird darunter genauso wie ohne git.
    """
    if not (WURZEL / ".git").exists():
        return None
    try:
        ergebnis = subprocess.run(
            ["git", "-C", str(WURZEL), "grep", "-l", "-F", "--", PHP_MARKE],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if ergebnis.returncode not in (0, 1):  # 1 = nichts gefunden, das ist eine Antwort
        return None
    return {zeile for zeile in ergebnis.stdout.splitlines() if zeile}


def zweite_orte() -> tuple[list[Path], list[Path]]:
    """(.php-Dateien im Baum, Dateien mit einer ZWEITEN Untergrenze).

    Beides auf die SORTE gesucht, nicht auf den alten Pfad: ein wiederbelebtes
    PHP-Admin kaeme aus einem Backup oder einem Merge und hiesse vielleicht
    anders. Ausgenommen sind Kommentar und Kompilat (NICHT_DURCHSUCHEN) — ein
    Text, der die Marke ZITIERT, ist keine zweite Untergrenze.
    """
    php: list[Path] = []
    marke: list[Path] = []
    # `git grep` liest 1900 Dateien in Millisekunden; die Schleife darunter
    # braucht Sekunden. Im Spiegel (kein git) zaehlt das nicht — dort liegen
    # zwei Dateien —, im Baum schon: eine Wache, die einen Laeufer um drei
    # Sekunden verlaengert, wird irgendwann aus ihm herausgenommen.
    schnell = git_marken_traeger()
    for pfad in verfolgte_dateien():
        try:
            rel = pfad.relative_to(WURZEL).as_posix()
        except ValueError:
            continue
        if rel.startswith(NICHT_DURCHSUCHEN) or rel.endswith(NICHT_DURCHSUCHEN_ENDUNG):
            continue
        if pfad.suffix == ".php":
            php.append(pfad)
        if schnell is not None:
            if rel in schnell:
                marke.append(pfad)
            continue
        try:
            if PHP_MARKE in pfad.read_text(encoding="utf-8", errors="ignore"):
                marke.append(pfad)
        except OSError:
            continue
    return sorted(php), sorted(marke)


def abbruch(fehlend: list[str]) -> int:
    """Gegenstand weg: ABBRECHEN MIT ANLEITUNG, niemals gruen.

    Dieselbe Haltung wie im Kopf von tools/shellcheck-ratsche.sh: eine Wache,
    die bei fehlendem Gegenstand gruen ist, prueft nichts und sieht dabei aus,
    als pruefte sie.
    """
    print("ABBRUCH — der Gegenstand dieser Wache fehlt:\n")
    for name in fehlend:
        print("  ?    " + name)
    print(f"\n  erwartet in {TS_DATEI.relative_to(WURZEL)}")
    print("\nDas ist die EINE Stelle, an der die Untergrenze der Bildschirmhelligkeit")
    print("steht. Ohne sie ist hier nichts zu pruefen — und „nichts zu pruefen\" ist")
    print("nicht dasselbe wie „in Ordnung\". Deshalb Rueckgabe 2 und kein GRUEN.")
    print("\nWas zu tun ist:")
    print("  * Umbenannt oder verschoben? Dann TS_DATEI bzw. die gesuchten Namen in")
    print("    diesem Werkzeug nachziehen — sonst schweigt es kuenftig ueber eine")
    print("    Grenze, die es huetet.")
    print("  * Ersatzlos weg? Dann ist 0 % wieder einstellbar: ein schwarzes Display,")
    print("    das sich am Geraet nicht mehr zuruecknehmen laesst. Erst die Grenze")
    print("    wiederherstellen, dann dieses Werkzeug.")
    print("  * Aus einem Spiegel gelaufen (tools/untergrenzen-waechter-probe.py)?")
    print("    Dann hat der Spiegel die Datei nicht mitkopiert.")
    return 2


def php_zahl(text: str, name: str) -> int | None:
    treffer = re.search(r"\$" + name + r"\s*=\s*(\d+)\s*;", text)
    return int(treffer.group(1)) if treffer else None


def php_stufen(text: str) -> dict[int, int] | None:
    """Die Tabelle Prozent => Rohwert aus mupi.php."""
    treffer = re.search(r"\$HELLIGKEIT_STUFEN\s*=\s*array\s*\((.*?)\)\s*;", text, re.S)
    if not treffer:
        return None
    paare = re.findall(r"(\d+)\s*=>\s*(\d+)", treffer.group(1))
    return {int(p): int(r) for p, r in paare} if paare else None


def php_schieber_min(text: str) -> str | None:
    """Das min-Attribut des Schiebers `newbrightness` — roh, als Text.

    Es darf eine Zahl sein oder ein `<?php echo … $HELLIGKEIT_PROZENT_MIN … ?>`.
    Der zweite Fall ist der bessere: dann gibt es die Zahl im Schieber gar nicht.
    """
    # KEIN `<input[^>]*>`: das Attribut darf ein `<?php … ?>` enthalten, und das
    # `?>` ist ein `>`. Also vom Namen aus rueckwaerts zum `<input` und ein
    # Stueck nach vorn.
    stelle = text.find('name="newbrightness"')
    if stelle < 0:
        return None
    anfang = text.rfind("<input", 0, stelle)
    if anfang < 0:
        return None
    ausschnitt = text[anfang : stelle + 500]
    attribut = re.search(r"\smin=\"(.*?)\"", ausschnitt, re.S)
    return attribut.group(1).strip() if attribut else None


def prozent_zu_roh(prozent: int, max_roh: int, prozent_min: int) -> int:
    """Nachbau von prozentZuRoh() aus schirmhelligkeit.ts. Muss dort gespiegelt
    bleiben — wenn sich die Rechnung dort aendert, faellt Punkt 4 auf."""
    p = min(100, max(prozent_min, prozent))
    roh = round(p / 100 * max_roh)
    unten = max(1, round(prozent_min / 100 * max_roh))
    return min(max_roh, max(unten, roh))


def bietet_null_an(php_text: str) -> list[str]:
    """Sucht die 0 dort, wo sie frueher stand — als Sicherheitsnetz gegen einen
    Rueckbau, der die Tabelle umgeht (z. B. wieder ein switch mit case "0")."""
    klagen = []
    if re.search(r"case\s*\"0\"\s*:\s*\$new_bn\s*=\s*0", php_text):
        klagen.append('der alte switch mit case "0" => $new_bn = 0 ist zurueck')
    schieber = php_schieber_min(php_text)
    if schieber is not None and schieber.isdigit() and int(schieber) <= 0:
        klagen.append('der Schieber newbrightness steht auf min="0"')
    return klagen


# ── DIE PHP-PROBE ─────────────────────────────────────────────────────────────
#
# Erwartet wird nicht "was ich mir gedacht habe", sondern die Haltung aus dem
# Kommentar in mupi.php: eine ZAHL unter der Untergrenze meint "so dunkel wie
# moeglich" (-> Untergrenze), alles andere ist Unsinn (-> volle Helligkeit).
# (PHP-Literal, erwartete Prozent, wozu der Fall da ist)
PHP_FAELLE: list[tuple[str, int, str]] = [
    ('"0"', 20, "die 0, die der alte Schieber anbot"),
    ("0", 20, "die 0 als Zahl"),
    ('" 0 "', 20, "0 mit Leerzeichen — frueher fiel das in den default"),
    ('"-5"', 20, "negativ"),
    ('"0.4"', 20, "0 mit Nachkomma"),
    ('"1e1"', 20, "10 in Exponentialschreibweise"),
    ('"0abc"', 100, "sieht aus wie 0, ist keine Zahl -> Unsinn"),
    ('"hell"', 100, "Wort statt Zahl"),
    ('""', 100, "leeres Feld"),
    ("null", 100, "Feld gar nicht geschickt"),
    ('array("0")', 100, "newbrightness[]=0 — ein Array"),
    ("\"0; sudo reboot\"", 100, "Einschleusversuch ueber die Shell-Zeile"),
    ("\"0' ; echo 1 > /sys/class/backlight/x/brightness ; '\"", 100, "Ausbruch aus den Hochkommata"),
    ('"20"', 20, "die neue kleinste Stufe"),
    ('"80"', 80, "eine normale Stufe"),
    ('"100"', 100, "ganz hell"),
    ('"30"', 100, "Zahl, aber keine angebotene Stufe"),
    ('"255"', 100, "Rohwert statt Prozent geschickt"),
]

# So und nicht anders darf die Zeile aussehen, die als root ausgefuehrt wird.
ERLAUBTE_SHELL_ZEILE = re.compile(r"^sudo su - -c 'echo (51|102|153|204|255) > /sys/class/backlight/\*/brightness'$")


def schneide_php_stueck(text: str, muster: str) -> str | None:
    treffer = re.search(muster, text, re.S)
    return treffer.group(0) if treffer else None


def baue_php_probe(php_text: str) -> str | None:
    """Baut aus DEM QUELLTEXT VON mupi.php ein lauffaehiges Pruefprogramm.

    Herausgeschnitten wird nur, was rechnet. Die Zeilen mit exec() bleiben
    draussen — diese Probe fasst kein Panel an.
    """
    tabelle = schneide_php_stueck(php_text, r"\$HELLIGKEIT_PROZENT_MIN\s*=.*?\$HELLIGKEIT_STUFEN\s*=\s*array\s*\(.*?\)\s*;")
    zuordnung = schneide_php_stueck(php_text, r"\$roh_wunsch\s*=.*?\$new_bn\s*=\s*\$HELLIGKEIT_STUFEN\[\$new_pct\]\s*;")
    befehl = schneide_php_stueck(php_text, r"\$brcommand\s*=.*?;")
    if tabelle is None or zuordnung is None or befehl is None:
        return None
    faelle = ",\n".join(f"  array({literal}, {erwartet})" for literal, erwartet, _ in PHP_FAELLE)
    return (
        "<?php\n"
        + tabelle
        + "\n$faelle = array(\n"
        + faelle
        + "\n);\n"
        + "$ergebnis = array();\n"
        + "foreach($faelle as $i => $fall) {\n"
        + "  if($fall[0] === null) { unset($_POST['newbrightness']); } else { $_POST['newbrightness'] = $fall[0]; }\n"
        + "  "
        + zuordnung.replace("\n", "\n  ")
        + "\n  "
        + befehl
        + "\n  $ergebnis[] = array('i' => $i, 'pct' => $new_pct, 'roh' => $new_bn, 'typ' => gettype($new_bn), 'cmd' => $brcommand);\n"
        + "}\n"
        + "echo json_encode($ergebnis);\n"
    )


def php_lauf(quelle: str, host: str | None) -> tuple[str, str] | None:
    """PHP ueber die Standardeingabe laufen lassen. Lokal, sonst per ssh."""
    lokal = subprocess.run(["sh", "-c", "command -v php"], capture_output=True, text=True)
    if lokal.returncode == 0:
        befehl = ["php"]
    elif host:
        befehl = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"dietpi@{host}", "php"]
    else:
        print("  ?    kein php auf diesem Rechner — mit --php-ueber HOST ueber die Box laufen lassen")
        return None
    try:
        ergebnis = subprocess.run(befehl, input=quelle, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as fehler:
        print(f"  ?    php nicht ausfuehrbar: {fehler}")
        return None
    return ergebnis.stdout, ergebnis.stderr


def probe_mit_php(php_text: str, host: str | None, prozent_min: int, stufen: dict[int, int]) -> bool | None:
    """True = alles wie erwartet, False = rot, None = konnte nicht laufen."""
    quelle = baue_php_probe(php_text)
    if quelle is None:
        print("  ROT  die Zuordnung liess sich nicht aus mupi.php herausschneiden —")
        print("       wurde sie umgebaut? Dann gehoert diese Probe mit umgebaut.")
        return False
    lauf = php_lauf(quelle, host)
    if lauf is None:
        return None
    ausgabe, fehlertext = lauf
    try:
        zeilen = __import__("json").loads(ausgabe.strip() or "null")
    except ValueError:
        print("  ROT  php lieferte keine auswertbare Antwort:")
        print("       " + (ausgabe.strip()[:300] or "(nichts)"))
        if fehlertext.strip():
            print("       " + fehlertext.strip()[:300])
        return False
    if not zeilen:
        print("  ROT  php lieferte nichts. " + fehlertext.strip()[:300])
        return False

    untergrenze_roh = stufen[prozent_min]
    rot = False
    if fehlertext.strip():
        # Warnungen sind hier kein Urteil, aber sie gehoeren gesagt.
        print("  ?    php meldete nebenbei: " + fehlertext.strip().splitlines()[0][:200])
    for zeile in zeilen:
        literal, erwartet, wozu = PHP_FAELLE[zeile["i"]]
        klagen = []
        if zeile["pct"] != erwartet:
            klagen.append(f"erwartet {erwartet} %, bekommen {zeile['pct']} %")
        if zeile["typ"] != "integer":
            klagen.append(f"der Rohwert ist ein {zeile['typ']}, keine Zahl")
        if not isinstance(zeile["roh"], int) or zeile["roh"] < untergrenze_roh:
            klagen.append(f"Rohwert {zeile['roh']} liegt unter der Untergrenze {untergrenze_roh}")
        if not ERLAUBTE_SHELL_ZEILE.match(str(zeile["cmd"])):
            klagen.append("die Shell-Zeile sieht anders aus als erlaubt: " + str(zeile["cmd"])[:160])
        if klagen:
            rot = True
            print(f"  ROT  {literal} ({wozu}): " + "; ".join(klagen))
        else:
            print(f"  ok   {literal:<48} -> {zeile['pct']:>3} % / Rohwert {zeile['roh']:<3} ({wozu})")
    return not rot


def hole_vom_geraet(host: str) -> str | None:
    """/var/www/mupi.php lesen. NUR LESEND — cat, sonst nichts."""
    try:
        ergebnis = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"dietpi@{host}", "cat /var/www/mupi.php"],
            capture_output=True,
            text=True,
            timeout=40,
        )
    except (OSError, subprocess.TimeoutExpired) as fehler:
        print(f"  ?    Box {host} nicht erreichbar: {fehler}")
        return None
    if ergebnis.returncode != 0:
        print(f"  ?    Box {host} antwortete nicht mit der Datei: {ergebnis.stderr.strip()[:200]}")
        return None
    return ergebnis.stdout


def vergleiche_zweiten_ort(befund: Befund, php: str, php_pfad: Path, ts_min: int, ts_max: int) -> dict[int, int] | None:
    """Der Vergleich von 2026-08, unveraendert — er gilt, sobald es wieder zwei Orte gibt.

    Gibt die Stufentabelle zurueck (fuer --mit-php) oder None, wenn der zweite
    Ort sich nicht auswerten liess. NICHT auswertbar ist hier ROT und nicht
    „unklar": ein zweiter Ort, den niemand lesen kann, ist der schlechteste
    von allen.
    """
    php_min = php_zahl(php, "HELLIGKEIT_PROZENT_MIN")
    php_max = php_zahl(php, "HELLIGKEIT_PROZENT_MAX")
    stufen = php_stufen(php)
    if php_min is None or php_max is None or not stufen:
        befund.schlecht(
            f"{php_pfad.relative_to(WURZEL)} fuehrt eine zweite Untergrenze, laesst sich aber "
            "nicht auswerten (Untergrenze, Obergrenze oder Stufentabelle nicht gefunden)"
        )
        for klage in bietet_null_an(php):
            befund.schlecht(klage)
        return None

    if ts_min == php_min:
        befund.gut(f"Untergrenze deckungsgleich: {ts_min} % (neuer Weg == zweiter Ort)")
    else:
        befund.schlecht(
            f"UNTERGRENZEN LAUFEN AUSEINANDER: PROZENT_MIN = {ts_min} % in "
            f"{TS_DATEI.relative_to(WURZEL)}, aber {PHP_MARKE} = {php_min} % in "
            f"{php_pfad.relative_to(WURZEL)}"
        )

    if ts_max == php_max:
        befund.gut(f"Obergrenze deckungsgleich: {ts_max} %")
    else:
        befund.schlecht(f"Obergrenzen laufen auseinander: {ts_max} % (TS) gegen {php_max} % (PHP)")

    zu_dunkel = sorted(p for p in stufen if p < php_min)
    if zu_dunkel:
        befund.schlecht(f"der zweite Ort bietet Stufen unterhalb der Untergrenze an: {zu_dunkel}")
    else:
        befund.gut(f"keine Stufe unter {php_min} % in der Stufentabelle (kleinste: {min(stufen)} %)")

    dunkelste = [p for p, roh in stufen.items() if roh <= 0]
    if dunkelste:
        befund.schlecht(f"diese Stufen schreiben den Rohwert 0 (schwarzes Display): {sorted(dunkelste)}")
    else:
        befund.gut("keine Stufe schreibt den Rohwert 0")

    falsch_gerechnet = {
        p: (roh, prozent_zu_roh(p, MAX_ROH, ts_min)) for p, roh in stufen.items() if roh != prozent_zu_roh(p, MAX_ROH, ts_min)
    }
    if falsch_gerechnet:
        for p, (ist, soll) in sorted(falsch_gerechnet.items()):
            befund.schlecht(f"{p} % ergibt in der alten Tabelle {ist}, nach der Rechnung des neuen Weges aber {soll}")
    else:
        befund.gut(f"alle {len(stufen)} Rohwerte stimmen mit prozentZuRoh(…, max_brightness={MAX_ROH}) ueberein")

    schieber = php_schieber_min(php)
    if schieber is None:
        befund.schlecht("der Schieber newbrightness wurde am zweiten Ort nicht gefunden")
    elif "HELLIGKEIT_PROZENT_MIN" in schieber:
        befund.gut(f"der Schieber holt sein min aus {PHP_MARKE} — keine dritte Zahl")
    elif schieber.isdigit() and int(schieber) == php_min:
        befund.gut(f"der Schieber faengt bei {schieber} % an")
    else:
        befund.schlecht(f'der Schieber faengt bei min="{schieber}" an, die Untergrenze ist {php_min} %')

    for klage in bietet_null_an(php):
        befund.schlecht(klage)
    return stufen


def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    zerleger.add_argument(
        "--am-geraet",
        metavar="HOST",
        help="zusaetzlich /var/www/mupi.php der laufenden Box lesen (nur lesend)",
    )
    zerleger.add_argument(
        "--mit-php",
        action="store_true",
        help="die Zuordnung aus mupi.php unter echtem PHP gegen boesartige Eingaben laufen lassen",
    )
    zerleger.add_argument(
        "--php-ueber",
        metavar="HOST",
        help="wenn dieser Rechner kein php hat: php auf HOST benutzen (nur ueber die Standardeingabe)",
    )
    argumente = zerleger.parse_args()

    if not TS_DATEI.exists():
        return abbruch([f"{TS_DATEI.relative_to(WURZEL)} gibt es nicht"])

    ts = TS_DATEI.read_text(encoding="utf-8")

    ts_min = ts_zahl(ts, "PROZENT_MIN")
    ts_max = ts_zahl(ts, "PROZENT_MAX")
    roh_rumpf = ts_funktion(ts, "rohUntergrenze")
    klemm_rumpf = ts_funktion(ts, "klemmeProzent")

    fehlend = [
        name
        for name, wert in (
            ("export const PROZENT_MIN", ts_min),
            ("export const PROZENT_MAX", ts_max),
            ("export function rohUntergrenze(…)", roh_rumpf),
            ("export function klemmeProzent(…)", klemm_rumpf),
        )
        if wert is None
    ]
    if fehlend:
        return abbruch(fehlend)

    assert ts_min is not None and ts_max is not None
    assert roh_rumpf is not None and klemm_rumpf is not None

    php_dateien, marken_dateien = zweite_orte()
    php_pfad = marken_dateien[0] if marken_dateien else None
    php = php_pfad.read_text(encoding="utf-8", errors="replace") if php_pfad else None

    befund = Befund()

    print("Untergrenze der Bildschirmhelligkeit\n")
    print(f"  {TS_DATEI.relative_to(WURZEL)}")
    if php_pfad:
        print(f"  {php_pfad.relative_to(WURZEL)}   <-- ein ZWEITER Ort")
    print()

    # ── A  DIE EINE ZAHL ──────────────────────────────────────────────────
    if ts_min > 0:
        befund.gut(f"PROZENT_MIN = {ts_min} % — groesser als 0")
    else:
        befund.schlecht(
            f"PROZENT_MIN = {ts_min} % — das ist ein schwarzes Display. Wer den Regler "
            "am Geraet ganz nach links zieht, sieht den Regler danach nicht mehr."
        )

    if ts_min < ts_max <= 100:
        befund.gut(f"PROZENT_MAX = {ts_max} % — ueber PROZENT_MIN und hoechstens 100")
    else:
        befund.schlecht(f"PROZENT_MAX = {ts_max} % passt nicht zu PROZENT_MIN = {ts_min} %")

    if "PROZENT_MIN" in roh_rumpf and "Math.max(1" in roh_rumpf:
        befund.gut("rohUntergrenze() haelt beide Riegel: die Rechnung UND Math.max(1, …)")
    else:
        befund.schlecht(
            "rohUntergrenze() haelt nicht mehr beide Riegel (erwartet: PROZENT_MIN und "
            "Math.max(1, …)). Bei max_brightness = 2 ergaeben 20 % gerundet 0."
        )

    if "PROZENT_MIN" in klemm_rumpf:
        befund.gut("klemmeProzent() klemmt gegen PROZENT_MIN")
    else:
        befund.schlecht("klemmeProzent() nennt PROZENT_MIN nicht mehr — was klemmt dann?")

    # ── B  KEIN ZWEITER ORT ───────────────────────────────────────────────
    if php_dateien:
        befund.schlecht(
            "PHP IST ZURUECK IM BAUM: "
            + ", ".join(str(p.relative_to(WURZEL)) for p in php_dateien[:5])
            + ". E47 (19.08.2026) hat PHP ausgebaut, weil der alte Admin seine Arbeit "
            "ueber exec('sudo …') machte und autosetup.sh dafuer "
            "www-data ALL=(ALL:ALL) NOPASSWD: ALL auf jede frische Karte legte."
        )
    else:
        befund.gut("keine verfolgte .php-Datei im Baum (so seit E47, 19.08.2026)")

    if php_pfad is None:
        befund.gut(
            f"keine zweite Untergrenze im Baum — {PHP_HISTORISCH.as_posix()} ist seit E47 weg, "
            "und die Oberflaeche holt min/max/schritt unveraendert aus GET /api/schirm/helligkeit"
        )
    else:
        befund.schlecht(
            f"ES GIBT WIEDER EINEN ZWEITEN ORT fuer dieselbe Grenze: "
            f"{php_pfad.relative_to(WURZEL)} — die Bauart [[drei-orte-eine-anzeige]]"
        )

    # ── C  WENN DER ZWEITE ORT DOCH DA IST ────────────────────────────────
    stufen = vergleiche_zweiten_ort(befund, php, php_pfad, ts_min, ts_max) if php else None

    for zeile in befund.zeilen:
        print(zeile)

    if argumente.mit_php:
        print("\nWas die Zuordnung aus dem zweiten Ort unter echtem PHP wirklich tut\n")
        if php is None or stufen is None:
            print("  ?    es gibt keinen auswertbaren zweiten Ort — nichts auszufuehren")
        else:
            php_min = php_zahl(php, "HELLIGKEIT_PROZENT_MIN")
            urteil = probe_mit_php(php, argumente.php_ueber, php_min or ts_min, stufen)
            if urteil is False:
                befund.rot = True
            elif urteil is None:
                print("  ?    keine Aussage moeglich — das aendert am Urteil oben nichts")

    if argumente.am_geraet:
        print(f"\nAusgelieferte Kopie auf {argumente.am_geraet} (/var/www/mupi.php, nur gelesen)\n")
        vom_geraet = hole_vom_geraet(argumente.am_geraet)
        if vom_geraet is None:
            print("  ?    keine Datei, keine Aussage — seit E47 ist das der ERWARTETE Fall")
        else:
            geraet_min = php_zahl(vom_geraet, "HELLIGKEIT_PROZENT_MIN")
            klagen = bietet_null_an(vom_geraet)
            print("  !    auf der Box liegt noch ein PHP-Admin — E47 ist dort nicht angekommen")
            if geraet_min is None or klagen:
                print("       und er bietet weiter 0 % an:")
                for klage in klagen:
                    print("       " + klage)
            else:
                print(f"       er laeuft mit der Untergrenze {geraet_min} %")
            print("       Das ist KEIN Fehler dieses Baums, sondern eine offene Auslieferung.")

    print()
    if befund.rot:
        print("ROT — die Untergrenze ist nicht mehr die eine, die sperrt.")
        print(f"  Die Grenze steht in {TS_DATEI.relative_to(WURZEL)} als PROZENT_MIN.")
        if php_pfad:
            print(f"  Der zweite Ort ist {php_pfad.relative_to(WURZEL)} — entweder er geht")
            print("  wieder raus (E47), oder beide Zahlen werden gemeinsam gepflegt.")
        return 1
    print(f"GRUEN — eine Untergrenze, sie sperrt bei {ts_min} %, und es gibt keine zweite.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
