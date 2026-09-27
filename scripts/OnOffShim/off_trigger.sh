#!/bin/bash
#

sudo mkdir /tmp/.rrd
sudo rrdtool create /tmp/.rrd/cputemp.rrd  --start now  --step 10  --no-overwrite  DS:cpu_temp:GAUGE:120:U:U  RRA:AVERAGE:0.5:1:120
sudo rrdtool create /tmp/.rrd/ram.rrd  --start now  --step 10  --no-overwrite  DS:ram:GAUGE:120:U:U  RRA:AVERAGE:0.5:1:120  DS:swap:GAUGE:120:U:U  RRA:AVERAGE:0.5:1:120
sudo rrdtool create /tmp/.rrd/cpuusage.rrd --start now  --step 10  --no-overwrite  DS:load1:GAUGE:120:0:U  DS:load5:GAUGE:120:0:U  DS:load15:GAUGE:120:0:U  RRA:AVERAGE:0.5:1:120  RRA:AVERAGE:0.5:5:120  RRA:AVERAGE:0.5:15:120  RRA:AVERAGE:0.5:60:120
sudo chmod 777 /tmp/.rrd/*.rrd

LOGFILE="/tmp/shutdown_control.log"
echo "$(date) - INFO:  Script started with PID $$" >> ${LOGFILE}

CONFIG="/etc/mupibox/mupiboxconfig.json"

# ── DER BESTAETIGUNGSTON ──────────────────────────────────────────────────
# Die beiden Pfade stehen HIER OBEN bei den uebrigen Festlegungen und nicht
# unten an der Stelle, an der gespielt wird. Zwei Gruende: sie werden bei jedem
# Druck gebraucht und aendern sich nie, und `tools/ausschalter-sandkasten.py`
# kann sie auf demselben Weg wie LOGFILE und CONFIG in den Sandkasten biegen
# (`readonly` im Vorspann). Eine Zuweisung mitten in der Schleife liesse sich
# nur mit einer Fehlerzeile je Druck ueberschreiben.
TON_KNOPF="/home/dietpi/MuPiBox/sysmedia/sound/button_shutdown.wav"
TON_ERSATZ="/home/dietpi/MuPiBox/sysmedia/sound/shutdown.wav"

# ── ANLAUF: AUF DAS WARTEN, WAS GEBRAUCHT WIRD — NICHT AUF DIE UHR ────────
#
# HIER STAND `sleep 30`, UND ES WAR DIE KLEINERE HAELFTE EINES PROBLEMS.
# Das Skript lag bis heute in /var/lib/dietpi/postboot.d/. Dort ruft
# `/boot/dietpi/postboot` jede Datei NACHEINANDER auf und WARTET auf ihr Ende:
#     for f in /var/lib/dietpi/postboot.d/*; do … "$f" || echo …; done
# Dieses Skript endet aber nie (`while true` unten). Eine halbe Minute hielt
# es den Rest von postboot auf, und danach hielt es ihn FUER IMMER auf —
# Login-Banner, alles dahinter, und `dietpi-postboot.service` blieb auf
# „activating" stehen. Der `sleep 30` war der sichtbare Teil davon.
#
# SEIT HEUTE STARTET ES `mupi_offtrigger.service` (config/services/). Dort
# haelt ein `Type=simple` gar nichts auf: systemd zaehlt den Dienst als
# gestartet, sobald er laeuft, und geht weiter. Der Schirm merkt nichts davon.
#
# WARUM DANN NICHT EINFACH GAR NICHT WARTEN: weil dieses Skript zwei Dinge
# BRAUCHT, die frueh im Hochlauf noch fehlen koennen — die Konfiguration und
# einen GPIO-Chip. Ein Blindwarten von 30 s deckt das ab und kostet dafuer
# 30 Sekunden, in denen der Knopf NICHTS tut. Genau das ist die gefaehrliche
# Sorte Wartezeit: wer in dieser Zeit drueckt, bekommt keine Reaktion, haelt
# laenger — und bei 6 Sekunden nimmt der MuPiHAT den Strom weg. Also wird auf
# die SACHE gewartet und nicht auf die Uhr: normalerweise ist beides sofort
# da, und die Schleife laeuft kein einziges Mal.
ANLAUF_MAX=30
anlauf=0
while [ ! -s "${CONFIG}" ] && [ ${anlauf} -lt ${ANLAUF_MAX} ]; do
    sleep 1
    anlauf=$((anlauf + 1))
done
if [ ! -s "${CONFIG}" ]; then
    echo "$(date) - ERROR: ${CONFIG} is not there after ${ANLAUF_MAX}s, aborting (the service restarts)" >> ${LOGFILE}
    exit 1
fi
if [ ${anlauf} -gt 0 ]; then
    echo "$(date) - INFO:  Waited ${anlauf}s for ${CONFIG}" >> ${LOGFILE}
fi

TRIGGER_PIN=$(/usr/bin/jq -r .shim.triggerPin ${CONFIG} || echo "17")
START_VOLUME=$(/usr/bin/jq -r .mupibox.startVolume ${CONFIG})

# ── DIE HALTEDAUER WIRD BEI JEDEM DRUCK NEU GELESEN ───────────────────────
#
# HIER STAND SIE ALS EINMALIGE ZUWEISUNG, oben im Vorspann, weit vor der
# Hauptschleife — und damit galt der Wert, den die Konfiguration beim START
# DES DIENSTES hatte, bis zum naechsten Neustart. Das Admin-Menue und die
# Browser-Verwaltung schreiben aber in die laufende Box hinein.
#
# GEMESSEN (tools/ausschalter-sandkasten.py, Fall `nachgestellt`):
#   Dienst mit 5 gestartet, im Menue auf 2 gestellt, 2,6 s gehalten
#     -> 0x poweroff. Es passiert NICHTS.
#   Dienst mit 2 gestartet, im Menue auf 5 gestellt, 2,6 s gehalten
#     -> 1x poweroff. Die Box faehrt herunter, obwohl 5 eingestellt ist.
#
# BEIDE RICHTUNGEN SIND GENAU DIE, GEGEN DIE HIER GEBAUT WIRD. Wer im Menue
# auf 5 stellt, tut das, WEIL das Kind die Box staendig ausschaltet — und sie
# schaltet weiter beim kuerzeren Druck aus. Und wer auf 2 stellt, haelt zwei
# Sekunden, es passiert nichts, er haelt laenger — bei 6 Sekunden nimmt der
# MuPiHAT den Strom weg. Das weiche Aus verliert dann gegen das harte, das es
# ersetzen sollte. Die Oberflaeche sagte dazu „Gilt ab dem naechsten Druck auf
# den Knopf"; das stimmte nicht.
#
# DER PREIS SIND ZWEI PROZESSE JE DRUCK (jq, evtl. awk) — nicht je Probe.
# Im Ruhezustand kostet es gar nichts, dort wartet weiter `gpiomon`. Und der
# Zeitpunkt, ab dem die Frist laeuft, wird VOR dem Lesen genommen (START_US in
# der Hauptschleife), damit das Lesen die Frist nicht verlaengert.
#
# KANN DIE DATEI BEIM LESEN HALB GESCHRIEBEN SEIN? Ja — genau in dem Moment,
# in dem jemand im Menue speichert. Dann faellt `jq` durch, und der Rueckfall
# ist NICHT die 3 von unten, sondern DER ZULETZT GUELTIGE WERT. Ein halb
# geschriebenes JSON darf die eingestellte Haltedauer nicht verstellen.

# ── DIE HALTEDAUER MUSS EINE GANZE ZAHL SEIN (Fix 4.3.1) ──────────────────
#
# WAS PASSIERT IST: mupi.php bot die Haltedauer als Schieber mit Schrittweite
# 0,25 an. Wer 2,25 einstellte, bekam "2.25" in die Konfiguration — und die
# Schleife weiter unten zaehlt damit `for ((i=0; i<PRESS_DELAY; i++))`. Bash
# kann das nicht ("Ungueltiger arithmetischer Operator") und bricht die
# Schleife ab, BEVOR sie ein einziges Mal prueft, ob die Taste noch gedrueckt
# ist. `button_held` steht zu dem Zeitpunkt schon auf true.
#
# ERGEBNIS: die Box faehrt beim kuerzesten Antippen herunter — und das
# Protokoll meldet dazu brav "Button held for 2.25 seconds". Nachgemessen:
# `PRESS_DELAY=2.25; for ((i=0;i<PRESS_DELAY;i++))` endet sofort mit
# Fehlercode.
#
# OBERGRENZE 5: ab 6 Sekunden entscheidet nicht mehr die Box, sondern die
# Platine. Das MuPiHAT-Datenblatt beschreibt fuer denselben Taster (J1) drei
# Griffe — druecken = ein, kurz druecken = herunterfahren, laenger als 6
# Sekunden = HARTES Abschalten in Hardware. Stuenden hier 10 Sekunden, naehme
# der HAT bei 6 den Strom weg, mitten im Schreiben, und dieses Skript kaeme
# nie bis zu seinem `poweroff`.
#
# DER RUECKFALL, BIS EINMAL GELESEN WURDE. Er steht ausserhalb der Funktion,
# weil sie ihn braucht: schlaegt das Lesen fehl, BLEIBT der bisherige Wert
# stehen, und beim allerersten Lauf ist „der bisherige" eben dieser hier.
PRESS_DELAY=3

press_delay_lesen() {
    local roh wert
    roh=$(/usr/bin/jq -r .timeout.pressDelay ${CONFIG} 2>/dev/null)
    wert="${roh}"
    case "${wert}" in
        ''|null|*[!0-9.]*|.*|*.*.*)
            # KEIN SPRUNG AUF 3. Frueher stand hier `PRESS_DELAY=3`, und das
            # war richtig, solange nur EINMAL beim Start gelesen wurde. Jetzt
            # wird bei jedem Druck gelesen — und dann heisst „unbrauchbar"
            # meistens „die Datei wird gerade geschrieben". Ein Betreiber, der
            # im Menue speichert und im selben Moment drueckt, darf davon
            # nicht seine eingestellten 5 Sekunden auf 3 verlieren.
            echo "$(date) - WARN:  Press delay '${roh}' unusable, keeping ${PRESS_DELAY} seconds" >> ${LOGFILE}
            return 0
            ;;
        *.*)
            # Bruchzahl: aufrunden. Zu kurz schaltet die Box versehentlich aus,
            # zu lang nur nicht.
            wert=$(/usr/bin/awk -v v="${wert}" 'BEGIN{ n=v+0; r=int(n); if (n>r) r=r+1; if (r<1) r=1; print r }')
            echo "$(date) - WARN:  Press delay ${roh} is not a whole number, using ${wert}" >> ${LOGFILE}
            ;;
    esac
    # ── EINE ZAHL, DIE BASH NICHT MEHR VERGLEICHEN KANN, IST KEINE GRENZE ──
    #
    # GEMESSEN (tools/ausschalter-fehlausloesung.py, Gruppe `muell`):
    #   pressDelay = "99999999999999999999"  ->  ein Antippen von 300 ms
    #   schaltet die Box ab.
    #
    # WARUM: der Fall oben laesst lauter Ziffern durch, die sind ja „sauber".
    # 20 Ziffern passen aber in keine 64-Bit-Zahl, und dann sagt bash zu
    # `[ "$wert" -gt 5 ]` nicht etwa „nein", sondern „Ganzzahl erwartet" und
    # gibt 2 zurueck. Der Deckel greift nicht. Der Riegel darunter (-lt 2)
    # scheitert an derselben Stelle und greift auch nicht. Der Wert steht
    # danach unveraendert in der Frist:
    #     ENDE_US=$(( START_US + PRESS_DELAY * 1000000 ))
    # Die Multiplikation laeuft ueber, das Ergebnis wird NEGATIV — und eine
    # Frist, die in der Vergangenheit endet, ist beim ersten Blick auf die Uhr
    # schon abgelaufen. Die Halteschleife bricht sofort ab, `button_held` steht
    # noch auf `true`, der Knopf ist beim Antippen noch gedrueckt, und die Box
    # faehrt herunter. Das ist dieselbe SACKGASSE wie bei 0, nur durch eine
    # andere Tuer: danach schaltet jede Beruehrung ab, auch die, mit der jemand
    # das Menue oeffnen wollte, um den Wert zu berichtigen.
    #
    # DER RIEGEL IST DIE LAENGE, nicht der Wert — er muss VOR dem ersten
    # Vergleich stehen, denn nach dem Vergleich ist es zu spaet. Zwei Stellen
    # reichen fuer alles, was hier je erlaubt sein wird (2 bis 5).
    if [ ${#wert} -gt 2 ]; then
        echo "$(date) - WARN:  Press delay '${wert}' has more digits than bash can compare, capping at 5" >> ${LOGFILE}
        wert=5
    fi
    if [ "${wert}" -gt 5 ]; then
        echo "$(date) - WARN:  Press delay ${wert}s is beyond the MuPiHAT hard-off at 6s, capping at 5" >> ${LOGFILE}
        wert=5
    fi

# ── UND DIE UNTERGRENZE IST 2 SEKUNDEN, NICHT NULL ────────────────────────
#
# BEI 0 FAEHRT DIE BOX BEIM KUERZESTEN ANTIPPEN HERUNTER. Nachgemessen und
# nicht vermutet: die Halteschleife unten laeuft dann NULL Durchlaeufe,
# `button_held` steht seit der Zeile davor auf `true`, und `poweroff` folgt.
# Am Geraet gibt es aus diesem Zustand keinen Weg zurueck — jede Beruehrung
# des Knopfs schaltet die Box aus, also auch die, mit der jemand das Menue
# aufmachen wollte, um den Wert zu korrigieren. Das ist keine schlechte
# Einstellung, das ist eine SACKGASSE.
#
# UND 0 IST DIE NAHELIEGENDE EINGABE, nicht die abwegige: die Beschriftung
# lautet „Wie lange die Taste gedrueckt werden muss", und wer will, dass der
# Knopf sofort reagiert, tippt 0 ein. Die Verwaltung im Browser bot bis heute
# `min: 0` an (konfiguration.ts, Feld `druckdauer`), der alte PHP-Schieber
# ebenfalls. Der Riegel gehoert deshalb HIERHER und nicht nur in die
# Oberflaeche: diese Datei ist die einzige Stelle, durch die JEDER Weg geht —
# Browser-Verwaltung, Admin-Menue, mupi.php, und die Hand, die die JSON-Datei
# per SSH aendert.
#
# WARUM 2 UND NICHT 1: Eine Sekunde ist die Dauer eines VERSEHENS. Die Box
# steht im Kinderzimmer; sie wird hochgehoben, umgestellt, angelehnt, und eine
# Hand liegt dabei ohne Weiteres eine Sekunde auf dem Knopf. Ab zwei Sekunden
# muss man WEITER halten, nachdem der Griff laengst zu Ende gewesen waere —
# das ist der Unterschied zwischen „beruehrt" und „gewollt". Zwei Sekunden ist
# ausserdem der ausgelieferte Wert (config/templates/mupiboxconfig.json:
# "pressDelay": "2"); diese Untergrenze aendert also auf keiner bestehenden
# Box etwas, sie verbietet nur die Werte darunter, die noch nie eine gute
# Idee waren.
#
# ZUSAMMEN MIT DER OBERGRENZE 5 bleiben vier Stufen: 2 (zuegig), 3, 4,
# 5 (kindersicher). Das ist wenig genug, um es im Admin-Menue mit einem
# Weiterschalt-Knopf zu bedienen, statt einen Regler dafuer zu bauen.
    PRESS_DELAY_MIN=2
    if [ "${wert}" -lt ${PRESS_DELAY_MIN} ]; then
        echo "$(date) - WARN:  Press delay ${wert}s would fire on the shortest tap, raising to ${PRESS_DELAY_MIN}" >> ${LOGFILE}
        wert=${PRESS_DELAY_MIN}
    fi

    # ── UND ZUM SCHLUSS: IST ES UEBERHAUPT EINE DER VIER ZAHLEN? ───────────
    #
    # DIE DREI RIEGEL DARUEBER SIND `if`s UEBER `[ … -gt … ]`. Ein `[`, das
    # seine beiden Seiten NICHT als Zahl lesen kann, sagt nicht „nein",
    # sondern gibt 2 zurueck und schreibt „integer expression expected". Fuer
    # ein `if` sieht 2 aus wie „Bedingung nicht erfuellt": der Riegel greift
    # dann nicht, er FAELLT AUS. Und was danach in `PRESS_DELAY` steht, wird
    # ungeprueft zur Frist.
    #
    # GEMESSEN (tools/ausschalter-gegenlesen.py, Gruppe `ohne-awk`):
    #   pressDelay = "2.5" und `/usr/bin/awk` faellt durch
    #     -> `wert` ist LEER, alle drei Vergleiche laufen in ihren Fehler,
    #        PRESS_DELAY wird leer, und in
    #            ENDE_US=$(( START_US + PRESS_DELAY * 1000000 ))
    #        zaehlt eine leere Zeichenkette als NULL. Die Frist endet also im
    #        selben Augenblick, in dem sie beginnt.
    #     -> ein Antippen von 0,3 s schaltete die Box ab; im zweiten Fall
    #        stand das poweroff 0,02 s nach dem Druck im Protokoll.
    #
    # DAS IST WIEDER DIE SACKGASSE: ab da schaltet jede Beruehrung ab, auch
    # die, mit der jemand das Menue aufmachen wollte, um den Wert zu
    # berichtigen. Sie kommt hier nicht durch einen falschen WERT herein,
    # sondern durch einen VERGLEICH, DER NICHT STATTFAND — deshalb hilft kein
    # weiterer Vergleich, sondern nur eine Frage, die ohne Rechnen auskommt.
    #
    # `case` vergleicht Zeichen und kann nicht scheitern. Uebrig bleiben genau
    # die vier Stufen, die es geben soll; alles andere laesst den zuletzt
    # gueltigen Wert stehen — dieselbe Richtung wie beim halb geschriebenen
    # JSON weiter oben, und aus demselben Grund.
    case "${wert}" in
        2|3|4|5) ;;
        *)
            echo "$(date) - WARN:  Press delay '${roh}' came out as '${wert}', which is none of 2/3/4/5 - a comparison must have failed (is /usr/bin/awk there?). Keeping ${PRESS_DELAY} seconds" >> ${LOGFILE}
            return 0
            ;;
    esac
    PRESS_DELAY=${wert}
}

press_delay_lesen
echo "$(date) - INFO:  Press delay set to ${PRESS_DELAY} seconds" >> ${LOGFILE}

GPIO_CHIP=$(ls /dev/ | grep -m 1 gpiochip)
# DASSELBE WARTEN WIE OBEN, aus demselben Grund: der GPIO-Treiber ist frueh im
# Hochlauf noch nicht da. Nicht blind eine Minute, sondern bis er da ist.
anlauf=0
while [ -z "${GPIO_CHIP}" ] && [ ${anlauf} -lt ${ANLAUF_MAX} ]; do
    sleep 1
    anlauf=$((anlauf + 1))
    GPIO_CHIP=$(ls /dev/ | grep -m 1 gpiochip)
done
if [ -z "$GPIO_CHIP" ]; then
    echo "$(date) - ERROR: No GPIO chip found after ${ANLAUF_MAX}s, aborting (the service restarts)." >> ${LOGFILE}
    exit 1
else
    echo "$(date) - INFO:  GPIO chip found -> ${GPIO_CHIP}" >> ${LOGFILE}	
fi

# ══ DER TASTER WIRD NICHT MEHR ABGEFRAGT, SONDERN GEMELDET ═══════════════
#
# HIER STANDEN ZWEI AUFRUFE AUS libgpiod 1.x:
#     sudo gpioget CHIP LEITUNG
#     sudo gpiomon --num-events=1 --falling-edge CHIP LEITUNG
# und AM GERAET NACHGESEHEN (Box .169, 08.08.2026, nur lesend) gibt es beide
# dort nicht:
#     ls /usr/bin/gpio*         -> nichts
#     dpkg -l | grep -c gpiod   -> 0
#     apt-cache madison gpiod   -> NUR 2.2.1  (libgpiod 2, Debian 13)
# Das Paket steht in `packages2install` und ist nie angekommen — und selbst
# wenn: die Fassung 2.x hat eine ANDERE Aufrufform. Ein nachinstalliertes
# `gpiod` haette diesem Skript zwei Programme gegeben, die es falsch aufruft,
# und ein `gpioget`, das an seinen Argumenten scheitert, sieht von aussen aus
# wie ein defekter Taster. Der Weg ueber das Paket war also nicht nur nicht
# gegangen, er war der falsche.
#
# WAS DIE BOX STATTDESSEN HAT (dieselbe Messung): python3-lgpio und
# python3-rpi-lgpio, beide installiert — und `led_control.py` treibt damit
# GERADE JETZT das Licht im Einschaltknopf (in /sys/kernel/debug/gpio steht
# hinter GPIO13 der Besitzer `lg`). Darauf sitzt jetzt `taster_wache.py`.
#
# WARUM EIN LAUFENDER HELFER UND NICHT EIN AUFRUF JE PROBE — GEMESSEN auf der
# Box, je 20 Laeufe: `python3 -c "pass"` 18 ms, mit `import lgpio` 34 ms, dazu
# `sudo` 10 ms, macht 44 ms je Aufruf. Die Halteschleife weiter unten probt
# alle 40 bis 90 ms; ein Aufruf von 44 ms frisst also die halbe bis die ganze
# Pause und macht die Zahl der Proben davon abhaengig, wie beschaeftigt der Pi
# gerade ist. Genau diese Abhaengigkeit ist unten als LOCH 2 muehsam beseitigt
# worden. Der Helfer laeuft deshalb EINMAL; Bash liest von ihm mit dem
# eingebauten `read`. GEMESSEN am Geraet: 1000 Blicke auf den Tasterstand in
# 17 ms, also 0,017 ms je Blick statt 44 ms — der Faktor ist 2500.
#
# UND DIE PROBE, OB ES UEBERHAUPT GEHT, IST DIE MELDUNG „BEREIT". Der Helfer
# schickt sie erst, wenn er die Leitung wirklich hat. Bleibt sie aus, endet
# dieses Skript — denn `Restart=always` macht den Abgang in `systemctl status`
# sichtbar, waehrend ein Waechter, der „active (running)" heisst und nichts
# bewacht, schlechter ist als gar keiner. Genau dieser Zustand ist heute Nacht
# schon einmal gefunden worden.
WACHE="/usr/local/bin/mupibox/taster_wache.py"
LAUFVERZ="/run/mupibox"
MELDEROHR="${LAUFVERZ}/taster.melderohr"
ZUSTANDSDATEI="${LAUFVERZ}/taster.zustand"

mkdir -p "${LAUFVERZ}"
# EIN ALTER STAND MUSS WEG, BEVOR EIN NEUER KOMMT. Wird der Helfer hart
# geschossen (systemd nach TimeoutStopSec, oder der OOM-Killer), bleibt seine
# Zustandsdatei liegen. Stuende darin eine "0", laese die erste Halteschleife
# nach dem Neustart „gedrueckt", ohne dass jemand drueckt — und die Box fuehre
# beim naechsten Antippen herunter.
rm -f "${MELDEROHR}" "${ZUSTANDSDATEI}"
if ! mkfifo -m 600 "${MELDEROHR}"; then
    echo "$(date) - ERROR: cannot create ${MELDEROHR} - ending, the service restart makes it visible" >> ${LOGFILE}
    exit 1
fi

"${WACHE}" --chip "${GPIO_CHIP}" --leitung "${TRIGGER_PIN}" \
           --zustandsdatei "${ZUSTANDSDATEI}" >"${MELDEROHR}" 2>>${LOGFILE} &
WACHE_PID=$!

# LESEND UND SCHREIBEND OEFFNEN (`<>`), obwohl nur gelesen wird. Ein reines
# `exec 3< fifo` BLOCKIERT, bis ein Schreiber die Roehre oeffnet — stirbt der
# Helfer vorher an einer belegten Leitung, haenge dieses Skript hier fuer immer,
# und `Restart=always` kaeme nie zum Zug. Mit `<>` haelt dieses Skript selbst
# ein Schreibende offen; das Oeffnen gelingt sofort. Der Preis ist, dass es nie
# ein Dateiende sieht — deshalb wird der Tod des Helfers unten mit `kill -0`
# festgestellt und nicht am Dateiende.
exec 3<>"${MELDEROHR}"

# ── AUF „BEREIT" WARTEN — HOECHSTENS 20 SEKUNDEN, UND NUR SOLANGE ER LEBT ──
bereit=nein
sekunde=0
while [ ${sekunde} -lt 20 ]; do
    if read -r -t 1 zeile <&3; then
        case "${zeile}" in
            BEREIT*) bereit=ja; break ;;
            *) echo "$(date) - WARN:  guard said '${zeile}' before it was ready" >> ${LOGFILE} ;;
        esac
        continue
    fi
    # Frist abgelaufen (read gibt >128 zurueck). Lebt er ueberhaupt noch?
    kill -0 ${WACHE_PID} 2>/dev/null || break
    sekunde=$((sekunde + 1))
done
if [ "${bereit}" != ja ]; then
    echo "$(date) - ERROR: '${WACHE}' did not report READY for GPIO${TRIGGER_PIN} on ${GPIO_CHIP}. Its own message is in the lines above. The button cannot be watched - ending, so the service restart is visible instead of pretending to run." >> ${LOGFILE}
    exit 1
fi
echo "$(date) - INFO:  guard ready, GPIO${TRIGGER_PIN} status: ${zeile#BEREIT }" >> ${LOGFILE}

# ── DIE UHR DER HALTESCHLEIFE — EINGEBAUT UND OHNE PROZESS ────────────────
#
# WARUM NICHT `SECONDS`: Das war der erste Versuch, und der Sandkasten hat ihn
# widerlegt (tools/ausschalter-sandkasten.py). `SECONDS` merkt sich beim
# Zuweisen nur die VOLLE Sekunde; faellt `SECONDS=0` auf x,99, dann steht dort
# eine Hundertstelsekunde spaeter schon 1. GEMESSEN: bei eingestellten
# 2 Sekunden fiel die Entscheidung nach 1,45 s — und ein Knopf, der 1,92 s
# gedrueckt und dann losgelassen wurde, hat die Box abgeschaltet. Eine Frist,
# die bis zu eine Sekunde zu frueh ablaeuft, ist genau der Fehler, gegen den
# diese Datei gebaut ist.
#
# WARUM NICHT `date`: das ist ein Prozess je Blick auf die Uhr, fuenfmal in
# der Sekunde, auf einem Pi, der nebenbei Musik dekodiert.
#
# `EPOCHREALTIME` ist in bash 5 eingebaut und kostet nichts. Sein Dezimal-
# zeichen haengt aber an der Spracheinstellung (im Deutschen ein Komma) —
# deshalb werden ALLE Nicht-Ziffern weggeworfen, statt auf einen Punkt zu
# bauen. Uebrig bleiben Mikrosekunden als ganze Zahl.
#
# DER RUECKFALL fuer bash 4 rechnet mit ganzen Sekunden und schneidet ab. Er
# ist damit hoechstens eine Sekunde zu LANG, nie zu kurz — die harmlose
# Richtung; zu lang heisst nur, dass man ein bisschen weiter halten muss.
uhr_us() {
    if [ -n "${EPOCHREALTIME}" ]; then
        _US=$(( 10#${EPOCHREALTIME//[!0-9]/} ))
    else
        _US=$(( $(date +%s) * 1000000 ))
    fi
}

# ── IST DER KNOPF JETZT GEDRUECKT? — OHNE EINEN EINZIGEN PROZESS ──────────
#
# HIER STAND `local button_state=$(sudo gpioget …)`. Das waren ZWEI Prozesse je
# Blick (die Ersetzung `$( )` gabelt, und darin lief `sudo gpioget`), und diese
# Funktion wird bis zu siebzigmal je Druck gerufen. Jetzt ist es ein `read` —
# ein eingebauter Befehl mit einer Umlenkung, und eine Umlenkung auf einen
# eingebauten Befehl gabelt NICHT. GEMESSEN auf der Box: 1000 Aufrufe in 17 ms.
#
# DREI WEGE, AUF DENEN DIESE FUNKTION „NICHT GEDRUECKT" SAGEN KANN, UND WARUM
# DAS DIE RICHTIGE RICHTUNG IST: der Helfer ist tot, die Datei fehlt, die Datei
# ist leer. In allen drei Faellen weiss dieses Skript NICHT, ob der Knopf
# gedrueckt ist. „Nicht gedrueckt" heisst dann: der Herunterfahr-Vorgang wird
# abgebrochen. Das ist die harmlose Haelfte — die Box laeuft weiter, und im
# Protokoll steht, warum. Die andere Haelfte waere, im Zweifel abzuschalten,
# und das heisst: mitten im Hoerspiel geht das Licht aus, ohne dass jemand
# etwas getan hat.
#
# DER TOTE HELFER IST DER WICHTIGE FALL. Seine Zustandsdatei wird beim
# geordneten Ende geloescht, aber ein `kill -9` (systemd nach TimeoutStopSec,
# der OOM-Killer) laesst sie liegen — und dann friert der Stand ein. Stuende
# dort eine "0", saehe die Halteschleife einen Knopf, den niemand haelt, und
# die Frist liefe durch bis zum Abschalten. `kill -0` ist auch hier ein
# eingebauter Befehl und kostet nichts.
check_button_pressed() {
    local stand
    if ! kill -0 ${WACHE_PID} 2>/dev/null; then
        echo "$(date) - ERROR: the guard for GPIO${TRIGGER_PIN} is gone - treating the button as released" >> ${LOGFILE}
        return 1
    fi
    read -r stand < "${ZUSTANDSDATEI}" 2>/dev/null || {
        echo "$(date) - ERROR: cannot read ${ZUSTANDSDATEI} - treating the button as released" >> ${LOGFILE}
        return 1
    }
    if [ "$stand" = "0" ]; then
        return 0  # Button is pressed
    else
        return 1  # Button is not pressed
    fi
}

# ── EIN AUFRUF MIT FRIST, GEBAUT AUS BASH-BORDMITTELN ─────────────────────
#
# WOFUER: zwischen der Entscheidung „es wird abgeschaltet" und dem `sudo
# poweroff` stehen vier Aufrufe — Lautstaerke setzen, den Ton spielen, zwei
# Dienste anhalten. KEINER davon hatte eine Frist. NACHGESTELLT UND GEMESSEN:
# blockiert einer, kommt das poweroff nicht; acht Sekunden nach dem Druck 0x
# poweroff. Und das ist kein erfundener Fall — `mupi_powerled.service` hat
# TimeoutStopUSec 1min30s, ein `service mupi_powerled stop` darf also
# anderthalb Minuten dauern und tut dabei genau das, was es soll.
#
# WAS DER BETREIBER DAVON HAETTE: er haelt den Knopf, es passiert nichts, er
# haelt weiter — und bei 6 Sekunden nimmt der MuPiHAT den Strom hart weg.
# Das weiche Aus verliert dann gegen das harte, das es ersetzen sollte. Ein
# Ton, der nicht kommt, oder ein Dienst, der nicht stoppt, darf das Abschalten
# nicht aufhalten; die Box faehrt danach ohnehin herunter, und systemd stoppt
# beim Herunterfahren jeden Dienst noch einmal von sich aus.
#
# WARUM NICHT `timeout`: das ist ein EXTERNES Programm. Es umginge damit die
# Funktionen, mit denen `tools/ausschalter-sandkasten.py` `sudo`, `service`
# und `poweroff` nachstellt — die Pruefung setzte dann ECHTE `sudo service`-
# Aufrufe auf der Maschine ab, auf der sie laeuft. Ein Werkzeug, das beim
# Pruefen Dienste anhaelt, wird zu Recht nicht mehr benutzt.
#
# WIE ES STATTDESSEN GEHT: der Aufruf in den Hintergrund, daneben ein
# Wachhund, der nach der Frist zuschlaegt, und `wait` dazwischen. `wait`,
# `kill` und die Klammern sind alles, was gebraucht wird; `sleep` bleibt der
# einzige Fremde, und den kennt der Sandkasten schon.
mit_frist() {
    local frist="$1"; shift
    "$@" &
    local pid=$!
    ( sleep "${frist}"; kill -TERM ${pid} 2>/dev/null
      sleep 0.5;        kill -KILL ${pid} 2>/dev/null ) &
    local wachhund=$!
    wait ${pid}
    local rc=$?
    # Den Wachhund sofort abberufen. Sonst schliefe er seine Frist zu Ende und
    # schoesse danach auf eine PID, die inzwischen jemand anderem gehoeren
    # koennte.
    kill ${wachhund} 2>/dev/null
    wait ${wachhund} 2>/dev/null
    if [ ${rc} -gt 128 ]; then
        echo "$(date) - WARN:  '$*' still running after ${frist}s, cut short so the shutdown can proceed" >> ${LOGFILE}
    fi
    return ${rc}
}

# Main monitoring loop
while true; do
    echo "$(date) - INFO:  Waiting for button press..." >> ${LOGFILE}

    # ── AUF DIE FALLENDE FLANKE WARTEN ────────────────────────────────────
    #
    # HIER STAND EIN `gpiomon` JE DURCHLAUF, im Hintergrund gestartet und mit
    # `wait` abgeholt. Jetzt liegt der Waechter schon da und meldet von selbst;
    # gewartet wird auf seine Zeile. `read` ist eingebaut, das Warten kostet
    # also weder einen Prozess noch Rechenzeit.
    #
    # DIE FRIST IST KEINE FRIST FUER DEN KNOPF — er darf tagelang unberuehrt
    # bleiben. Sie ist der Takt, in dem nachgesehen wird, OB DER WAECHTER NOCH
    # LEBT. Ohne sie stuende dieses Skript in einem `read`, das nie
    # zurueckkehrt (die Roehre ist auch schreibend geoeffnet, siehe oben, es
    # gibt also kein Dateiende), und der Dienst hiesse weiter „active
    # (running)", waehrend niemand mehr auf den Taster sieht. Das ist genau der
    # Fehler, gegen den diese ganze Datei gebaut ist — er kaeme sonst durch die
    # Hintertuer zurueck.
    #
    # ── UND DESHALB SIND ES 5 SEKUNDEN UND NICHT 60 ───────────────────────
    #
    # HIER STAND `-t 60`, und damit war der Fehler nicht beseitigt, sondern
    # nur BEFRISTET. AM GERAET GEMESSEN (Box .169, 08.08.2026): den Helfer
    # mit `kill -9` geschossen und mitgezaehlt —
    #
    #     Helfer tot          -> `systemctl is-active` sagt weiter „active"
    #     GPIO17              -> ohne Besitzer, niemand horcht
    #     bemerkt nach        -> 60 s   (der Ablauf dieser Frist)
    #     wieder da nach      -> 63 s   (RestartSec=5 obendrauf)
    #
    # Dreiundsechzig Sekunden, in denen der Knopf TOT ist und der Dienst
    # gesund aussieht. Wer in dieser Zeit drueckt, haelt und haelt — und bei
    # 6 Sekunden nimmt der MuPiHAT den Strom hart weg. Genau die Kette, die
    # dieses Skript unterbrechen soll.
    #
    # WAS EINE KUERZERE FRIST KOSTET: NICHTS. `read` ist eingebaut, die
    # Schleife tut beim Ablauf nur ein `kill -0` — auch eingebaut — und
    # schreibt nichts ins Protokoll. Aus einem Aufwachen je Minute werden
    # zwoelf; auf einem Pi, der nebenbei Musik dekodiert, ist das nicht
    # messbar. Der Preis der 60 Sekunden war dagegen eine Minute toter Knopf.
    #
    # WARUM NICHT NOCH KUERZER: unter etwa einer Sekunde faengt das Aufwachen
    # an, im Leerlaufverbrauch sichtbar zu werden, und gewonnen waeren nur
    # noch Sekundenbruchteile gegenueber den 5 s, die `Restart=always` ohnehin
    # bis zum naechsten Anlauf braucht. Fuenf Sekunden treffen dieselbe
    # Groessenordnung wie RestartSec und machen die Erholung damit rund
    # zehn Sekunden lang statt einer Minute.
    meldung=""
    while [ "${meldung}" != "FLANKE" ]; do
        # ── DER RUECKGABEWERT WIRD DIREKT GENOMMEN, NICHT NACH DEM `fi` ────
        #
        # HIER STAND:
        #     if read -r -t … meldung <&3; then … continue; fi
        #     lese_rc=$?
        # und das hat den WAECHTER JEDE MINUTE UMGEBRACHT. `$?` steht nach
        # einem `if`, dessen Bedingung falsch war und das keinen `else`-Zweig
        # hat, auf NULL — das ist der Rueckgabewert des if-Gebildes selbst und
        # nicht der von `read`. Nachgemessen:
        #     if read -r -t 1 z <&3; then :; fi; echo $?   ->  0
        #     read -r -t 1 z <&3;      echo $?             ->  142
        # Die Zeile darunter fragt `[ ${lese_rc} -le 128 ]`, also „ist die
        # Roehre zu?". Mit einer 0 lautet die Antwort JA — bei jeder ganz
        # normalen Frist von 60 Sekunden ohne Knopfdruck.
        #
        # AM GERAET GEMESSEN (Box .169, 08.08.2026, Dienst ausgerollt und in
        # Ruhe gelassen; die Frist stand damals auf 60 s): das Protokoll
        # schrieb in genau diesem Abstand „the pipe to the guard closed
        # (rc=0)", das Skript endete, systemd startete es nach RestartSec=5
        # neu. In VIER MINUTEN vier Neustarts;
        # der Prozess `taster_wache.py` war dabei 16 der 240 Sekunden GAR
        # NICHT DA. Rund sieben Prozent der Zeit haelt niemand die Leitung —
        # wer in genau diesem Fenster drueckt, dessen Druck ist weg, denn
        # beim Neustart wird GPIO17 freigegeben und neu beansprucht, und eine
        # Flanke dazwischen sieht niemand. Der Knopf tut dann „manchmal
        # nichts", und das ist die Sorte Fehler, die niemand nachstellen kann.
        #
        # WARUM ES KEINE PRUEFUNG GEFUNDEN HAT: dieser Pfad braucht eine
        # MINUTE RUHE. Der Sandkasten drueckt sofort, und die beiden
        # Werkzeuge am Geraet sind nach ein paar Sekunden fertig. Es gibt
        # jetzt eine Aussage dafuer (`ruhe` in tools/ausschalter-sandkasten.py).
        read -r -t 5 meldung <&3
        lese_rc=$?
        if [ ${lese_rc} -eq 0 ]; then
            case "${meldung}" in
                FLANKE|LOS) ;;
                BEREIT*) echo "$(date) - INFO:  guard reports ${meldung}" >> ${LOGFILE} ;;
                *) echo "$(date) - WARN:  guard said something unexpected: '${meldung}'" >> ${LOGFILE} ;;
            esac
            continue
        fi
        # Bei einer abgelaufenen Frist legt `read` ab, was es bis dahin
        # gelesen hat — ein halber Satz duerfte gleich nicht als „FLANKE"
        # durchgehen und die Schleife nicht verlassen.
        meldung=""
        if [ ${lese_rc} -le 128 ]; then
            echo "$(date) - ERROR: the pipe to the guard closed (rc=${lese_rc}). The button cannot be watched - ending, so the service restart is visible." >> ${LOGFILE}
            exit 1
        fi
        if ! kill -0 ${WACHE_PID} 2>/dev/null; then
            echo "$(date) - ERROR: the guard for GPIO${TRIGGER_PIN} died. Its own message is in the lines above. Ending, so the service restart is visible instead of pretending to run." >> ${LOGFILE}
            exit 1
        fi
    done

    # Ab hier ist es sicher eine FLANKE — die Schleife oben verlaesst man nur
    # damit. Der frueher hier stehende Zweig „sonst: Error monitoring GPIOxx,
    # sleep 5" ist ersatzlos weg: einen Fehler beim Warten gibt es jetzt nur
    # noch als toten Waechter, und der wird oben behandelt, indem das Skript
    # endet. Alle fuenf Sekunden im Kreis zu laufen und dabei „active
    # (running)" zu heissen war der Zustand, gegen den diese Datei gebaut ist.
    echo "$(date) - INFO:  Button pressed, checking hold duration..." >> ${LOGFILE}

        # ── DIE HALTESCHLEIFE: NACH DER UHR, NICHT NACH DER ZAHL DER SCHLAEFE ─
        #
        # HIER STAND `for ((i=0; i<PRESS_DELAY; i++)); do … sleep 1; done`.
        # Das hatte zwei Loecher, und beide sind gefunden worden, indem man es
        # nachgestellt hat (tools/ausschalter-sandkasten.py).
        #
        # LOCH 1 — EIN FESTER PROBENTAKT VERSCHIEBT DAS LOCH NUR. Hier stand
        # zuerst `sleep 1`, dann `sleep 0.2`, und die Begruendung lautete: wer
        # im Sekundentakt tippt, faellt bei 0,2 s auf. Das stimmt — und ist
        # trotzdem falsch, denn wer im 0,2-s-Takt tippt, faellt dann eben nicht
        # mehr auf. NACHGEMESSEN (tools/ausschalter-fehlausloesung.py, Gruppe
        # `takt`, Taster nach Fahrplan in Millisekunden):
        #
        #     100 ms drauf / 100 ms los, 16x   ->  3 von 3 Laeufen schalteten ab
        #     120 / 80 ms                      ->  3 von 3
        #      80 / 120 ms                     ->  3 von 3
        #     140 /  60 ms                     ->  3 von 3
        #     200 / 200 ms                     ->  0 von 3
        #
        # Das ist kein seltener Zufall, das ist eine RESONANZ: der Takt der
        # Proben (0,2 s plus der Preis eines `gpioget`) und der Takt der
        # Tipper stehen fest zueinander, also liegt JEDE Probe wieder auf einem
        # „drauf". Und 5 Tipper in der Sekunde ist nicht die abwegige Frequenz,
        # sondern genau die, mit der ein Kind auf einem Knopf TROMMELT, das
        # entdeckt hat, dass er klickt. Der Takt von 1 s vorher traf immerhin
        # nur den, der absichtlich langsam tippt.
        #
        # WAS DAGEGEN HILFT: kein anderer fester Takt (den kann man wieder
        # treffen), sondern ein UNREGELMAESSIGER und deutlich schnellerer.
        # Zufaellig zwischen 0,04 s und 0,09 s heisst: es gibt keine Tippfolge
        # mehr, zu der die Proben in fester Phase stehen koennen, und bei
        # 2 Sekunden Frist sind es rund 30 unabhaengige Blicke. Damit ein
        # Trommeln mit halber Einschaltdauer durchkaeme, muessten alle 30
        # zufaellig auf ein „drauf" fallen — das ist etwa eins zu einer
        # Milliarde je Anlauf statt, wie gemessen, jedes Mal.
        #
        # DER PREIS sind bis zu rund 70 Aufrufe von `gpioget` waehrend eines
        # 5-Sekunden-Druckes statt 25 — und NUR waehrend eines Druckes; im
        # Ruhezustand wartet weiter `gpiomon` und kostet gar nichts. Das ist
        # der Preis dafuer, dass die Box nicht mitten im Hoerspiel ausgeht.
        #
        # DER STRUKTURELL RICHTIGE WEG waere, gar nicht zu proben, sondern die
        # STEIGENDE FLANKE vom Kernel zu holen (`gpiomon --rising-edge` mit
        # Frist): der Kernel verpasst kein Loslassen, egal wie kurz. Das steht
        # hier nicht, weil es an den Aufrufformen von libgpiod haengt, die auf
        # dieser Box nicht geprueft werden konnten — siehe den Bericht zu
        # `gpiod` (auf .169 gar nicht installiert; Debian 13 liefert nur 2.x
        # mit anderer Aufrufform). Erst wenn das geklaert ist, gehoert diese
        # Schleife dorthin.
        #
        # LOCH 2 — DIE FRIST WUCHS MIT DEM AUFWAND. `sleep 1` je Durchlauf
        # PLUS der Aufruf von `sudo gpioget` je Durchlauf: bei 5 eingestellten
        # Sekunden kamen so 5 Sekunden Schlaf und obendrauf, was die Aufrufe
        # gebraucht haben. Auf einem beschaeftigten Pi sind das schnell 5,5 s
        # oder mehr — und bei 6 Sekunden nimmt der MuPiHAT den Strom weg,
        # mitten im Schreiben. Ein weiches Aus, das um Haaresbreite verliert,
        # ist genau das harte Aus, das es ersetzen sollte. Deshalb steht die
        # Frist jetzt als ZEITPUNKT fest (siehe `uhr_us` weiter oben) und
        # nicht als Zahl von Schlaefen: was die Proben dazwischen kosten,
        # aendert an ihr nichts mehr.
        #
        # DIE LETZTE PROBE STEHT NACH DER SCHLEIFE, und das ist kein
        # Schoenheitsfehler: ohne sie zaehlte ein Knopf, der zwischen der
        # letzten Probe und dem Ablauf losgelassen wurde, als gehalten. Die
        # Regel lautet „gedrueckt,
        # ALS die Frist ablief" — nicht „gedrueckt, kurz bevor sie ablief".
        button_held=true

        # ── DIE UHR ZUERST, DAS LESEN DANACH ─────────────────────────────
        # Die Frist laeuft ab dem Moment, in dem die Flanke da war — nicht ab
        # dem Moment, in dem `jq` fertig ist. Andersherum verlaengerte jeder
        # Aufruf die Frist um seine eigene Laufzeit, und bei 5 eingestellten
        # Sekunden ist der Abstand zu den 6 Sekunden des MuPiHAT genau das,
        # was nicht verspielt werden darf.
        uhr_us
        START_US=${_US}
        PRESS_DELAY_VORHER=${PRESS_DELAY}
        press_delay_lesen
        if [ "${PRESS_DELAY}" != "${PRESS_DELAY_VORHER}" ]; then
            echo "$(date) - INFO:  Press delay changed ${PRESS_DELAY_VORHER}s -> ${PRESS_DELAY}s since the last press" >> ${LOGFILE}
        fi
        ENDE_US=$(( START_US + PRESS_DELAY * 1000000 ))
        while true; do
            uhr_us
            if [ ${_US} -ge ${ENDE_US} ]; then
                break
            fi
            if ! check_button_pressed; then
                echo "$(date) - INFO:  Button released after $(( (_US - ENDE_US) / 1000 + PRESS_DELAY * 1000 )) ms, aborting shutdown" >> ${LOGFILE}
                button_held=false
                break
            fi
            # Unregelmaessig zwischen 0,04 s und 0,09 s — die Begruendung
            # steht oben bei LOCH 1. Die Unregelmaessigkeit ist der Punkt,
            # nicht die Kuerze: gegen eine Resonanz hilft nur, dass es keinen
            # Takt gibt, auf den sich etwas einschwingen kann.
            sleep 0.0$(( 4 + RANDOM % 6 ))
        done
        if [ "$button_held" = true ] && ! check_button_pressed; then
            echo "$(date) - INFO:  Button released just before the deadline, aborting shutdown" >> ${LOGFILE}
            button_held=false
        fi

        if [ "$button_held" = true ]; then
            echo "$(date) - INFO:  Button held for ${PRESS_DELAY} seconds, initiating shutdown" >> ${LOGFILE}

            # ── AB HIER HAT JEDER SCHRITT EINE FRIST ──────────────────────
            #
            # Vorher stand hier eine Reihe unbegrenzter Aufrufe, und der
            # letzte davon — `sudo service mupi_powerled stop` — darf laut
            # seiner eigenen Unit anderthalb Minuten dauern
            # (TimeoutStopUSec 1min30s). Blockiert irgendeiner, kommt das
            # `poweroff` darunter NIE. Nachgestellt gemessen: acht Sekunden
            # nach dem Druck 0x poweroff. Die Begruendung im Ganzen steht
            # oben bei `mit_frist`.
            #
            # DIE FRISTEN SIND KNAPP UND DUERFEN ES SEIN: nichts von dem hier
            # ist noetig, damit die Box sauber herunterfaehrt. Die Lautstaerke
            # zurueckzustellen ist Hoeflichkeit fuers naechste Einschalten, der
            # Ton ist Rueckmeldung, und die beiden Dienste stoppt systemd
            # beim Herunterfahren ohnehin noch einmal selbst. Was hier
            # abgeschnitten wird, kostet also nichts — was hier haengt,
            # kostet die ganze Abschaltung.

            # ── DIE LAUTSTAERKE DARF DEN TON NICHT AUFHALTEN ──────────────
            #
            # HIER STAND:
            #     mit_frist 3 …/mupi-lautstaerke.sh set …  \
            #       || mit_frist 3 /usr/bin/pactl set-sink-volume …
            # also ZWEI Fristen von je 3 s HINTEREINANDER, und dahinter erst
            # der Bestaetigungston. Denn `mit_frist` gibt nach einem
            # abgeschnittenen Aufruf ungleich 0 zurueck — genau das laesst
            # `||` den Rueckfall starten, der dann in seine EIGENE Frist
            # laeuft.
            #
            # GEMESSEN (tools/ausschalter-gegenlesen.py, Gruppe
            # `ton-reihenfolge`): haengt `mupi-lautstaerke.sh`, kam der Ton
            # erst 8,0 s nach dem Druck. Der Mensch am Knopf haelt bis dahin
            # laengst weiter, weil er keine Rueckmeldung hat — und bei
            # 6 SEKUNDEN NIMMT DER MuPiHAT DEN STROM HART WEG. Der Ton ist
            # das einzige, was das verhindert; ihn hinter die Lautstaerke zu
            # stellen heisst, das weiche Aus von der Hoeflichkeit fuers
            # naechste Einschalten abhaengig zu machen.
            #
            # UND ES IST KEIN ERFUNDENER FALL. `mupi-lautstaerke.sh` redet
            # mit dem Tonserver; an dieser Box haengt ein Lautsprecher ueber
            # Bluetooth. Faellt der weg, wartet `pactl` auf eine Senke, die
            # nicht mehr antwortet.
            #
            # ZWEI AENDERUNGEN, BEIDE KLEIN:
            #  * die Frist ist 1 s statt 3. Ein `set` dauert normalerweise
            #    weniger als eine Zehntelsekunde; wird es abgeschnitten,
            #    kostet das nur die Lautstaerke beim NAECHSTEN Einschalten.
            #  * der Rueckfall laeuft nur noch, wenn der erste Aufruf richtig
            #    fehlgeschlagen ist (Rueckgabe bis 128 — „gibt es nicht",
            #    „ging schief"). WURDE er abgeschnitten (ueber 128), haengt
            #    der Tonserver, und dann haengt `pactl` genauso. Ein zweiter
            #    Anlauf in dieselbe Wand kostet nur noch einmal die Frist.
            #
            # Damit stehen zwischen der Entscheidung und dem Ton hoechstens
            # 1,5 s (die Frist plus die halbe Sekunde, die `mit_frist` dem
            # freundlichen Ende laesst) statt 8.
            #
            # `lautstaerke_rc=$?` STEHT DIREKT HINTER DEM AUFRUF und nicht
            # hinter einem `if` — nach einem `if` ohne `else`, dessen
            # Bedingung falsch war, steht dort NULL. Genau das hat weiter
            # unten den Waechter jede Minute umgebracht.
            #
            # Ueber mupi-lautstaerke.sh statt direkt ueber pactl (E12/X7) —
            # dieselbe Senke, aber mit der Obergrenze aus mupibox.maxVolume.
            # ── UND WARUM DAS ZURUECKSTELLEN JETZT WEITER UNTEN STEHT ─────
            #
            # BETREIBERFUND 23.08.2026: „beim Runterfahren gibt es beim Spielen
            # einen kurzen Anstieg der Lautstaerke."
            #
            # Genau hier war die Stelle. Das Zuruecksetzen lief, WAEHREND das
            # Kind noch hoerte — die Musik stoppt erst weiter unten mit
            # `service mupi_startstop stop`. Jeder Sprung zwischen der
            # Hoerlautstaerke und `startVolume` war also zu HOEREN, und in
            # welche Richtung er ging, hing davon ab, welche Stufe gerade die
            # Vorgabe-Senke war (siehe `einheit_nachziehen` in
            # mupi-lautstaerke.sh — dieselbe Wurzel wie die Deckelung).
            #
            # DER AUFRUF BLEIBT, ER RUECKT NUR. Unten, hinter dem Anhalten der
            # Wiedergabe, tut er dasselbe fuer das naechste Einschalten und ist
            # dabei STILL. Der Bestaetigungston kommt dadurch sogar frueher,
            # nicht spaeter: zwischen Entscheidung und Ton steht jetzt gar
            # keine Frist mehr statt bis zu 1,5 s.

            # ── DER BESTAETIGUNGSTON, UND WAS OHNE IHN PASSIERT ───────────
            #
            # AM GERAET NACHGESEHEN (Box .169, 08.08.2026): das Verzeichnis
            # /home/dietpi/MuPiBox/sysmedia GIBT ES DORT NICHT, weder Ton noch
            # Bild. `aplay` auf eine Datei, die fehlt, schreibt eine Zeile auf
            # die Fehlerausgabe und endet — die Box faehrt also WORTLOS
            # herunter.
            #
            # UND DAS IST NICHT NUR HAESSLICH, ES IST DER FEHLER SELBST: wer
            # den Knopf haelt und keine Rueckmeldung bekommt, weiss nicht, ob
            # es gewirkt hat, und HAELT LAENGER. Bei 6 Sekunden nimmt der
            # MuPiHAT den Strom hart weg. Der fehlende Ton fuehrt also genau
            # zu dem harten Abschalten, das dieses Skript ersetzen soll.
            #
            # ZWEI DINGE DAGEGEN: der Ausrollweg legt die Datei jetzt hin
            # (update/start_mupibox_update.sh legt sysmedia/sound an — dort
            # stand bis heute `/home/dietpiMuPiBox/`, ohne Schraegstrich, und
            # das Verzeichnis wurde nie erzeugt). Und hier wird nachgesehen
            # statt geraten: fehlt der eigene Ton, tut es der allgemeine
            # Abschaltton; fehlt auch der, steht wenigstens im Protokoll,
            # WARUM es still war.
            if [ -r "${TON_KNOPF}" ]; then
                mit_frist 5 /usr/bin/aplay "${TON_KNOPF}"
            elif [ -r "${TON_ERSATZ}" ]; then
                echo "$(date) - WARN:  ${TON_KNOPF} is missing, falling back to ${TON_ERSATZ}" >> ${LOGFILE}
                mit_frist 5 /usr/bin/aplay "${TON_ERSATZ}"
            else
                echo "$(date) - WARN:  no shutdown sound on this box (${TON_KNOPF} and ${TON_ERSATZ} are both missing) - the box powers off without a word, and whoever gets no answer holds longer and lands in the MuPiHAT hard-off at 6s" >> ${LOGFILE}
            fi

            echo "$(date) - INFO:  Stopping services" >> ${LOGFILE}
            mit_frist 3 sudo service mupi_startstop stop

            # ── JETZT IST ES STILL: DIE LAUTSTAERKE FUERS NAECHSTE MAL ────
            #
            # Hierher verschoben (23.08.2026), siehe die lange Begruendung
            # oben an der alten Stelle. Die Wiedergabe ist mit der Zeile
            # darueber gestoppt; was jetzt am Regler passiert, hoert niemand.
            #
            # Die Fristen und der Rueckfall sind UNVERAENDERT uebernommen:
            # `mit_frist 1`, und der Rueckfall auf `pactl` laeuft nur bei
            # einem echten Fehlschlag (Ruecklauf bis 128), nicht bei einem
            # abgeschnittenen Aufruf — haengt der Tonserver, haengt `pactl`
            # genauso, und ein zweiter Anlauf in dieselbe Wand kostet nur
            # noch einmal die Frist.
            #
            # `lautstaerke_rc=$?` steht direkt hinter dem Aufruf und nicht
            # hinter einem `if` — nach einem `if` ohne `else`, dessen
            # Bedingung falsch war, steht dort NULL.
            mit_frist 1 /usr/local/bin/mupibox/mupi-lautstaerke.sh set ${START_VOLUME}
            lautstaerke_rc=$?
            if [ ${lautstaerke_rc} -ne 0 ] && [ ${lautstaerke_rc} -le 128 ]; then
                mit_frist 1 /usr/bin/pactl set-sink-volume @DEFAULT_SINK@ ${START_VOLUME}%
            fi

            mit_frist 3 sudo service mupi_powerled stop

            echo "$(date) - INFO:  System shutdown initiated" >> ${LOGFILE}
            sudo poweroff
        else
            echo "$(date) - INFO:  Button press duration insufficient, continuing monitoring" >> ${LOGFILE}
        fi
done
