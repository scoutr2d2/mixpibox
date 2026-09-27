#!/usr/bin/env python3
"""
WER TON MACHT, BRAUCHT XDG_RUNTIME_DIR — sonst spielt er ins Leere.

══ DER FALL, DER DAS AUSGELOEST HAT (19.09.2026) ═══════════════════════════

Betreiber am Geraet: „wenn ich vorlesen aktiviert habe klappt das vorlesen
dennoch nicht beim klick auf das vorlese icon."

Gemessen war die Ansage KERNGESUND: `GET /api/vorlesen/sprich` lieferte 200
und 32 kB `audio/wav`. Erst das Abspielen scheiterte, und das Journal log
dabei in die falsche Richtung:

    Failed to create secure directory (/home/dietpi/.config/pulse): Permission denied
    pa_context_connect() failed: Connection refused

DIE RECHTE-ZEILE IST DIE FOLGE, NICHT DER GRUND. `ansageAbspielen` startet
`pw-play`, und PipeWire-Klienten finden ihren Socket ueber
`$XDG_RUNTIME_DIR/pipewire-0`. Die Unit `mupibox-server.service` setzte GAR
KEINE Umgebung — `systemctl show -p Environment` gab blank `Environment=`
zurueck. Also suchte pw-play den Server nicht dort, fiel auf Pulse zurueck,
wollte sich sein `~/.config/pulse` anlegen — und `/home/dietpi/.config`
gehoert root seit dem Einrichtungstag. Daher die irrefuehrende Meldung.

WARUM ES NIEMANDEM AUFFIEL: Musik spielte weiter. mpv haengt am
Abspieldienst, und DESSEN Unit traegt die Zeile seit je, ebenso
`librespot.service`. Von den drei Diensten mit Ton war genau EINER der
Ausreisser — und ausgerechnet der, dessen Tonweg am seltensten benutzt wird.

══ WAS DIESE WACHE PRUEFT — AUF DIE SORTE, NICHT AUF EINE NAMENSLISTE ══════

Fuer jede Unit unter `config/services/`:

  * Laeuft sie als ROOT? Dann geht sie diese Wache nichts an. Der
    Systemton-Server laeuft selbst als root (`pulseaudio --system`), und
    `/run/user/0` ist eine andere Frage. Ausdruecklich ausgenommen, damit
    hier keine Dauerbefunde entstehen (`dauerrote-wache-ist-keine`).
  * MACHT SIE TON? Zwei Wege, und beide zaehlen:
      1. Die Unit NENNT selbst ein Ton-Programm (librespot, mpv, pw-play …).
      2. Ihr ExecStart zeigt auf ein Programm, dessen QUELLE im Baum ein
         Ton-Programm startet. Genau das ist der Serverfall: in der Unit
         steht nur `node server.js`, der `pw-play`-Aufruf liegt drei
         Verzeichnisse weiter.
  * Wenn ja: sie MUSS `XDG_RUNTIME_DIR` setzen.

KEINE LISTE VON DIENSTNAMEN. Eine solche waere beim naechsten Dienst
veraltet und haette genau diesen Fehler nicht gefunden — er entstand ja
dadurch, dass einer von dreien vergessen wurde.

DIE ZUORDNUNG AUSGELIEFERTER PFADE ZU QUELLORDNERN ist die einzige
Handarbeit hier, und sie traegt einen ANKER: zeigt ein Eintrag ins Leere,
bricht die Wache ab, statt ihn stillschweigend zu ueberspringen. Eine
Zuordnung, die nicht mehr passt, macht die Wache sonst blind und gruen.

    python3 tools/tonweg-umgebung-deckung.py            Bericht
    python3 tools/tonweg-umgebung-deckung.py --pruefen  still; Ende 1 bei Luecke
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
UNITS = WURZEL / "config/services"

# Programme, die einen PipeWire- oder Pulse-Klienten aufmachen. Sorte, nicht
# Marke: wer einen davon startet, braucht den Socket-Pfad.
TON_PROGRAMME = ("pw-play", "pw-cat", "paplay", "aplay", "mpv", "librespot", "ffplay")

# Ausgelieferter Pfad -> Quellordner im Baum. JEDER Eintrag wird geprueft;
# ein toter Anker bricht ab.
QUELLORTE = {
    "Sonos-Kids-Controller-master": "src/backend-api/src",
    "spotifycontroller-main": "src/backend-player/src",
}


def quelle_nennt_ton(ordner: Path) -> str:
    """Nennt irgendeine Datei in diesem Ordner ein Ton-Programm? Gibt die
    Fundstelle zurueck, sonst leer."""
    for pfad in sorted(ordner.rglob("*")):
        if not pfad.is_file() or pfad.suffix not in (".ts", ".js", ".mjs", ".py", ".sh"):
            continue
        if pfad.name.endswith(".spec.ts") or pfad.name.endswith(".test.ts"):
            continue
        try:
            text = pfad.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for zeile_nr, zeile in enumerate(text.splitlines(), 1):
            # Kommentare zaehlen nicht — sonst genuegt ein Hinweis im Text.
            nackt = zeile.strip()
            if nackt.startswith(("//", "#", "*", "/*")):
                continue
            for prog in TON_PROGRAMME:
                # IN AUFRUFSTELLUNG, nicht irgendwo in Anfuehrungszeichen.
                #
                # GEFUNDEN BEIM GEGENPRUEFEN (19.09.2026): Die erste Fassung
                # suchte nur den Namen im Zitat und meldete deshalb
                # `src/backend-api/src/dienste.ts:68 startet librespot`. Die
                # Zeile lautet aber `wodurch: 'librespot'` — ein DATENFELD,
                # das nennt, welcher Dienst welchen abgeloest hat. Es startet
                # nichts. Das Urteil war zufaellig richtig, die Begruendung
                # falsch — und wer die zitierte Zeile nachschlaegt, hoert auf,
                # dieser Wache zu glauben.
                #
                # Verlangt wird jetzt die STELLUNG: dem Zitat geht eine
                # oeffnende Klammer, eine eckige Klammer oder ein Komma
                # voraus, also die Stelle, an der ein Argument steht. Damit
                # faellt `schluessel: 'mpv'` heraus und `spawn('pw-play', …)`
                # bleibt. Dieselbe Ueberlegung wie bei prosa-ist-kein-ruf.
                if re.search(rf"[(\[,]\s*['\"`]{re.escape(prog)}['\"`]", zeile):
                    return f"{pfad.relative_to(WURZEL)}:{zeile_nr} startet {prog}"
    return ""


def main() -> int:
    still = "--pruefen" in sys.argv
    if not UNITS.is_dir():
        print(f"ABBRUCH: {UNITS} fehlt — ohne Gegenstand prueft diese Wache nichts.")
        return 2

    # Anker der Zuordnung zuerst: eine tote Zuordnung macht blind.
    for ausgeliefert, quelle in QUELLORTE.items():
        if not (WURZEL / quelle).is_dir():
            print(f"ABBRUCH: die Zuordnung '{ausgeliefert}' -> '{quelle}' zeigt ins Leere.")
            print("Was zu tun ist: QUELLORTE in dieser Datei nachziehen. Ohne gueltige")
            print("Zuordnung kann die Wache den Tonweg eines Dienstes nicht mehr sehen")
            print("und waere still gruen — das ist schlimmer als ein Befund.")
            return 2

    luecken = []
    geprueft = 0
    for unit in sorted(UNITS.glob("*.service")):
        text = unit.read_text(encoding="utf-8", errors="replace")
        wirksam = "\n".join(z for z in text.splitlines() if not z.lstrip().startswith("#"))

        nutzer = re.search(r"^User=(.+)$", wirksam, re.M)
        if not nutzer or nutzer.group(1).strip() == "root":
            continue  # root: andere Frage, siehe Kopf
        geprueft += 1

        grund = ""
        for prog in TON_PROGRAMME:
            if re.search(rf"\b{re.escape(prog)}\b", wirksam):
                grund = f"die Unit nennt {prog} selbst"
                break
        if not grund:
            for ausgeliefert, quelle in QUELLORTE.items():
                if ausgeliefert in wirksam:
                    fund = quelle_nennt_ton(WURZEL / quelle)
                    if fund:
                        grund = fund
                    break
        if not grund:
            continue

        if not re.search(r"^Environment=.*XDG_RUNTIME_DIR=", wirksam, re.M):
            luecken.append((unit.name, grund))
            print(f"  FEHLT in {unit.name}: Environment=XDG_RUNTIME_DIR — {grund}")

    if luecken:
        print()
        print("  Ohne XDG_RUNTIME_DIR findet ein PipeWire-Klient seinen Socket nicht,")
        print("  faellt auf Pulse zurueck und scheitert dort mit einer Meldung ueber")
        print("  RECHTE — die den wahren Grund verdeckt. Vorbild: die Zeile in")
        print("  config/services/mupibox-player.service.")
        print(f"\n{len(luecken)} LUECKE(N).")
        return 1

    if not still:
        print(f"  KEINE LUECKE ({geprueft} Dienste ohne root geprueft).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
