#!/bin/bash
#
# DIE DIENSTE DIESER BOX EINRICHTEN — wiederherstellbar und wiederholbar.
#
# ══ WARUM ES DIESE DATEI GIBT (16.08.2026) ═════════════════════════════════
#
# An einem Tag wurde VIERMAL derselbe Fehler gefunden: ein Skript liegt
# fertig auf der Box, funktioniert — und NIEMAND startet es. Taster,
# Knopflicht, off_trigger, die Bilder-Tastatur. Jedes Mal fehlte nicht der
# Code, sondern der EINE Eintrag, der ihn aufruft.
#
# Und dann ist mir am selben Tag genau das passiert: Ich habe die drei
# fehlenden Starter als systemd-Units angelegt — DIREKT AUF DER BOX, in
# keinem Repo. Die Sicherung der Box (`/api/sicherung`) traegt
# `server/config` und `etc/mupibox`, aber NICHT `/etc/systemd/system`.
# Waere die Karte gestorben, waeren Bibliothek und Hoerstaende
# zurueckgekommen — und Taster, Licht und Sonde waeren tot gewesen, ohne
# dass irgendwo steht, dass es sie je gab.
#
# Deshalb liegen die Units jetzt HIER, im Repo, neben diesem Skript. Es
# installiert sie und sagt, was es tut. Es ist mehrfach ausfuehrbar: wer es
# zweimal laufen laesst, bekommt zweimal dasselbe Ergebnis.
#
# ══ WAS ES EINRICHTET ══════════════════════════════════════════════════════
#
#   mupi_offtrigger   off_trigger.sh + taster_wache.py -> 2 s Druck faehrt
#                     sauber herunter (GPIO17). Ohne diese Unit sieht
#                     niemand den Knopf, und nur der 6-s-Hardware-Schnitt
#                     der Platine wirkt — mitten in laufende Schreibvorgaenge.
#   mupi_powerled     mupi_start_led.sh + led_control.py -> das Licht im
#                     Einschaltknopf (GPIO13, PWM). Der vorgesehene Starter
#                     mupi_startup.sh ist vollstaendig auskommentiert.
#   netzabriss-sonde  schreibt das Funkbild alle 5 s nach
#                     /home/dietpi/netzabriss/sonde.log — die Jagd auf die
#                     WLAN-Selbsttrennung (reason=3 locally_generated).
#
# ══ WARUM offtrigger/powerled STATT taster/knopflicht (29.08.2026) ═════════
# Dieses Skript legte eigene Zwillinge derselben Skripte an: mupi_taster
# neben mupi_offtrigger (beide off_trigger.sh), mupi_knopflicht neben
# mupi_powerled (beide mupi_start_led.sh). Eine Box, die den Handweg UND
# spaeter ein Update fuhr, hatte dann ZWEI taster_wache.py um GPIO17 und
# zwei led_control.py um GPIO13 — der dokumentierte "GPIO not allocated"-Tod
# aus mupi_stop_led.sh. Seitdem installiert der Handweg dieselben Unit-NAMEN
# und -DATEIEN wie autosetup/update (config/services/) und raeumt seine
# alten Zwillinge selbst ab. Die config/services-Fassungen sind auch die
# besseren: Restart=always, KillMode=control-group, StartLimit-Behandlung.
#
# Aufruf AUF DER BOX (aus dem Repo-Checkout):
#     sudo bash scripts/systemd/einrichten.sh
# oder vom Arbeitsrechner (die zwei kanonischen Units mitgeben!):
#     scp -r scripts/systemd dietpi@BOX:/tmp/ && \
#       scp config/services/mupi_offtrigger.service \
#           config/services/mupi_powerled.service dietpi@BOX:/tmp/systemd/ && \
#       ssh dietpi@BOX 'sudo bash /tmp/systemd/einrichten.sh'

set -u

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# mixpi-wlan-adapter (21.08.2026): wendet die WLAN-Adapterwahl nach dem
# Start an. Ohne diese Zeile laege das Skript fertig auf der Box und
# niemand riefe es auf - genau der Fehler, gegen den diese Datei
# geschrieben ist.
DIENSTE=(mupi_offtrigger mupi_powerled netzabriss-sonde soloist mixpi-wlan-adapter)

# Die zwei kanonischen Units liegen NICHT neben diesem Skript, sondern in
# config/services/ — dieselben Dateien, die autosetup und Update ablegen.
# Gesucht wird erst neben dem Skript (der scp-Weg legt sie dorthin), dann
# im Repo-Layout zwei Ebenen hoeher.
unit_datei() {
    if [ -f "${HIER}/$1.service" ]; then
        echo "${HIER}/$1.service"
    elif [ -f "${HIER}/../../config/services/$1.service" ]; then
        echo "${HIER}/../../config/services/$1.service"
    fi
}

if [ "$(id -u)" -ne 0 ]; then
    echo "Dieses Skript braucht root (systemd-Units nach /etc/systemd/system)." >&2
    echo "  sudo bash $0" >&2
    exit 1
fi

fehlt=0
for d in "${DIENSTE[@]}"; do
    if [ -z "$(unit_datei "${d}")" ]; then
        echo "FEHLT: ${d}.service (weder neben dem Skript noch in config/services/)" >&2
        fehlt=1
    fi
done
[ "${fehlt}" -eq 1 ] && exit 2

# ── DIE SKRIPTE MUESSEN DA SEIN, SONST STARTET EINE UNIT INS LEERE ─────────
# Genau die Sorte Halbheit, gegen die dieses Skript geschrieben ist: eine
# aktive Unit, deren ExecStart nicht existiert, meldet sich als "failed" —
# aber nur, wenn jemand hinsieht.
echo "── Pruefe, ob die Programme hinter den Units liegen ──"
for pfad in \
    /usr/local/bin/mupibox/off_trigger.sh \
    /usr/local/bin/mupibox/taster_wache.py \
    /usr/local/bin/mupibox/mupi_start_led.sh \
    /usr/local/bin/mupibox/led_control.py \
    /home/dietpi/netzabriss/sonde.py \
    /usr/local/bin/mupibox/soloist-start.sh \
    /usr/local/bin/mupibox/soloist-updater.sh \
    /usr/local/bin/mupibox/soloist-anmeldewache.sh \
    /usr/local/bin/mupibox/mixpi-wlan-adapter.sh
do
    if [ -f "${pfad}" ]; then
        printf "  ok    %s\n" "${pfad}"
    else
        printf "  FEHLT %s\n" "${pfad}"
        fehlt=1
    fi
done
if [ "${fehlt}" -eq 1 ]; then
    echo >&2
    echo "Erst ausliefern (tools/ausliefern.py --nur scripts), dann hier weiter." >&2
    echo "Die Sonde kommt aus tools/box/netzabriss-sonde.py nach /home/dietpi/netzabriss/sonde.py." >&2
    exit 3
fi

echo
echo "── Alte Handweg-Zwillinge abbauen (mupi_taster, mupi_knopflicht) ──"
# Bestandsboxen dieses Handwegs tragen die Zwillings-Units noch. Sie werden
# VOR dem Einrichten gestoppt und entfernt — sonst saessen gleich zwei
# Prozesse auf GPIO17/GPIO13. Tolerant: wo nichts liegt, passiert nichts.
for alt in mupi_taster mupi_knopflicht; do
    if [ -f "/etc/systemd/system/${alt}.service" ]; then
        systemctl disable --now "${alt}.service" >/dev/null 2>&1
        rm -f "/etc/systemd/system/${alt}.service"
        printf "  abgebaut %s.service\n" "${alt}"
    fi
done

echo
echo "── Units einrichten ──"
for d in "${DIENSTE[@]}"; do
    install -m 0644 "$(unit_datei "${d}")" "/etc/systemd/system/${d}.service"
    printf "  gelegt   %s.service\n" "${d}"
done

# ── Der Tonmaschinen-Schalter (E42): Drop-In an librespot ──────────────────
# Die librespot-Unit selbst bleibt unangetastet (sie kommt aus dem Rezept
# bzw. den Schalen-Wegen — alle kopieren DIESELBE Repo-Datei
# config/services/librespot.service); das Drop-In haengt nur die
# ExecCondition an. GENAU EINE Maschine laeuft.
install -d /etc/systemd/system/librespot.service.d
install -m 0644 "${HIER}/librespot-engine.conf" /etc/systemd/system/librespot.service.d/engine.conf
printf "  gelegt   librespot.service.d/engine.conf (der Engine-Schalter)\n"

# ── Der ifup-Riegel (E131/C1): Drop-In an ifup@ ────────────────────────────
# Die abgewaehlte Funkkarte kommt gar nicht erst hoch (Bootzeit, kein
# ARP-Flux-Fenster). Die sh-Huelle im Drop-In laesst ALLES durch, wenn das
# Riegel-Skript fehlt; die Sicherheitsregel (nie die letzte Verbindung
# sperren) beweist tools/mixpi-wlan-riegel.test.sh.
install -d /etc/systemd/system/ifup@.service.d
install -m 0644 "${HIER}/ifup-mixpi-wlan-riegel.conf" /etc/systemd/system/ifup@.service.d/mixpi-wlan-riegel.conf
printf "  gelegt   ifup@.service.d/mixpi-wlan-riegel.conf (der Adapterwahl-Riegel)\n"

# ── Der 90-Tage-Waechter (E42/S4): Timer + Einmal-Dienst ──────────────────
install -m 0644 "${HIER}/soloist-updater.service" /etc/systemd/system/soloist-updater.service
install -m 0644 "${HIER}/soloist-updater.timer"   /etc/systemd/system/soloist-updater.timer
systemctl enable --now soloist-updater.timer >/dev/null 2>&1
printf "  gelegt   soloist-updater.timer (woechentlich, holt Laeufe nach)\n"

# ── Die Anmeldewache (E104): heilt den nach Boot-Fehlanmeldung stummen Soloist ──
# Gemessen am 30.08.2026: "login failed" 16 s nach dem Boot, danach blieb der
# Prozess fuer immer unangemeldet (kein Exit — Restart=always griff nie).
install -m 0644 "${HIER}/soloist-anmeldewache.service" /etc/systemd/system/soloist-anmeldewache.service
install -m 0644 "${HIER}/soloist-anmeldewache.timer"   /etc/systemd/system/soloist-anmeldewache.timer
systemctl enable --now soloist-anmeldewache.timer >/dev/null 2>&1
printf "  gelegt   soloist-anmeldewache.timer (alle 2 min, E104)\n"

# ── Das Soloist-Binary wird GEHOLT, nicht mitgeliefert ──────────────────────
# Jeder Build verfaellt 90 Tage nach dem BAU. Ein Binary im Installationsbild
# waere bei der Ankunft halb verfallen, ein eingefrorenes irgendwann tot.
# Deshalb holt die EINRICHTUNG es frisch - ueber denselben Updater, der es
# auch kuenftig erneuert. Ohne Netz scheitert das laut, blockiert aber nicht:
# die Vorgabe librespot braucht Soloist nicht.
if [ ! -x /usr/local/bin/soloist ]; then
    echo "── Soloist-Binary fehlt - der Updater holt es frisch ──"
    /usr/local/bin/mupibox/soloist-updater.sh || echo "  (kein Netz? Der woechentliche Timer versucht es wieder.)"
fi

systemctl daemon-reload
# librespot einmal neu starten, damit die Condition ab jetzt gilt.
systemctl restart librespot.service 2>/dev/null || true
for d in "${DIENSTE[@]}"; do
    systemctl enable "${d}.service" >/dev/null 2>&1
    systemctl restart "${d}.service"
    printf "  %-18s %s\n" "${d}" "$(systemctl is-active "${d}.service")"
done

echo
echo "── Gegenprobe: laeuft auch das Programm dahinter? ──"
sleep 3
pgrep -f taster_wache.py  >/dev/null && echo "  ok    Taster-Wache haelt GPIO17"      || echo "  FUND  keine Taster-Wache"
pgrep -f led_control.py   >/dev/null && echo "  ok    Knopflicht treibt GPIO13"       || echo "  FUND  kein led_control"
pgrep -f netzabriss       >/dev/null && echo "  ok    Sonde schreibt mit"             || echo "  FUND  keine Sonde"
systemctl is-active --quiet soloist-anmeldewache.timer && echo "  ok    Anmeldewache tickt (E104)" || echo "  FUND  Anmeldewache-Timer steht"
ENGINE=$(jq -r '.spotify.engine // "librespot"' /etc/mupibox/mupiboxconfig.json 2>/dev/null)
if [ "${ENGINE}" = "soloist" ]; then
    pgrep -x soloist   >/dev/null && echo "  ok    Tonmaschine: soloist (gewaehlt)"   || echo "  FUND  engine=soloist, aber kein soloist-Prozess"
    pgrep -x librespot >/dev/null && echo "  FUND  librespot laeuft TROTZ engine=soloist" || true
else
    pgrep -x librespot >/dev/null && echo "  ok    Tonmaschine: librespot (Vorgabe)"  || echo "  FUND  kein librespot"
    pgrep -x soloist   >/dev/null && echo "  FUND  soloist laeuft TROTZ engine=${ENGINE}" || true
fi
echo
echo "Fertig. Der Knopf faehrt mit ~2 s sauber herunter; der Strom-Schnitt"
echo "danach ist eine eigene Baustelle (siehe scripts/OnOffShim/poweroff.sh)."
