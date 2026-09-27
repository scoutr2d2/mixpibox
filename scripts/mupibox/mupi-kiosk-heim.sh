#!/bin/sh
# mupi-kiosk-heim.sh — den Kiosk-Browser heimholen.
#
# WOZU (Betreiber, 14.08.2026): der Kiosk war per Browser-Sprung auf
# accounts.spotify.com gelandet — fremde Seite, keine Tastatur, keine
# Adresszeile, kein Zurueck: "ich bin gefangen bei hier am geraet den ton
# anmelden." Der Sprung selbst ist ausgebaut (NewDesign, Ton-Blatt); dieses
# Skript ist das Netz darunter: haengt der Schirm je wieder auf einer
# fremden Seite, holt ihn die Verwaltung damit zurueck.
#
# WIE — UND WARUM GENAU SO, AM GERAET GEMESSEN (14.08.2026, Pi 5):
#   * pkill -x chromium ALLEIN reicht NICHT: die Autologin-Kette spawnt
#     danach nichts nach — 25 s pgrep, nichts kam (genau der Fehler, vor dem
#     system.spec.ts seit "Anzeige neu starten" warnt; diesmal hat ihn die
#     Messung gefangen, bevor der Knopf ihn behauptete).
#   * systemctl restart getty@tty1 holt die Kette zurueck: PID1 besitzt die
#     Konsole, getty -> login -> Autostart -> xinit --homepage laeuft neu an
#     (gemessen: Kiosk nach ~10 s wieder da).
#   * BEIDES gehoert zusammen: getty@tty1 hat KillMode=process — ein noch
#     LAUFENDER Chromium (der eigentliche Gefangenen-Fall) ueberlebte den
#     getty-Neustart als Waise und hielte X fest. Also erst beenden, dann
#     die Kette anstossen. pkill -x, nicht -f: -f traefe auch Wrapper
#     (Hausregel im Wissenspaket).
#
# UND DANN WIRD NACHGESEHEN, NICHT GEHOFFT: dieses Skript misst das
# Wiederkommen und endet ROT, wenn die Kette nicht uebernimmt — der Knopf
# in der Verwaltung sagt dann die Wahrheit statt "erledigt".
#
# EIN EIGENES SKRIPT STATT sh -c IM SERVER: die Aktionstabelle setzt keine
# Befehle aus Bestandteilen zusammen (system.spec.ts, root-Befehle!), und
# feste Pfade unter /usr/local/bin/mupibox sind dort die Regel.

# 1. Beenden. Rueckgabecode 1 heisst "keiner lief" — dann ist der Weg frei.
#
# ALLE DREI NAMEN (E68, 20.08.2026). Hier stand `pkill -x chromium`, und mit
# dem waehlbaren Kiosk-Browser aus E56 traf das einen laufenden Cog nicht: das
# Heimholen haette gar nichts beendet, getty@tty1 (KillMode=process) haette den
# Browser als Waise ueberleben lassen, und das Skript haette 25 Sekunden lang
# auf eine Rueckkehr gewartet, die nie noetig war.
#
# `-x` BLEIBT, und das ist wichtig: mit -x muss der Ausdruck den GANZEN
# Prozessnamen treffen, `chromium[a-z-]*|cog` also genau `chromium`,
# `chromium-browser` oder `cog` — `cogl` faellt heraus. Mit -f traefe es
# zusaetzlich Wrapper und im schlimmsten Fall die eigene Aufrufkette
# (Hausregel im Wissenspaket).
pkill -x 'chromium[a-z-]*|cog'
rc=$?
[ "$rc" = "0" ] || [ "$rc" = "1" ] || {
    echo "pkill selbst ist gescheitert (rc=$rc)" >&2
    exit 2
}

# 2. Die Konsolen-Kette neu anstossen — sie bringt den Kiosk auf die
#    Startseite. Ohne diesen Schritt bleibt der Schirm schwarz (gemessen).
systemctl restart getty@tty1 || {
    echo "getty@tty1 liess sich nicht neu starten" >&2
    exit 2
}

# Steht der Kiosk-Browser wieder? (E68, 20.08.2026)
#
# HIER STAND `pgrep -x chromium`. Seit E56 ist der Kiosk-Browser waehlbar, und
# diese Box faehrt Cog — die Pruefung haette ihn nie gefunden und das Skript
# haette 25 Sekunden lang gewartet, um dann zu melden, der Browser sei nicht
# wiedergekommen. Ein Fehlalarm bei erfolgreicher Rueckkehr.
#
# Muster und Begruendung stehen bei KIOSK_MUSTER in led_control.py; absichtlich
# hier UND in mupi_start_led.sh doppelt, damit keine gemeinsame Datei zwei
# Dienste gleichzeitig lahmlegen kann.
kiosk_laeuft() {
    pgrep -f '(^|/)(chromium[a-z-]*|cog)[[:space:]].*https?://' >/dev/null 2>&1
}

# 3. Wiederkommen abwarten (die Aktions-Frist des Servers ist 30 s — hier
#    bleibt Luft). Frisch heisst: der Kiosk-Browser steht wieder.
i=0
while [ "$i" -lt 25 ]; do
    sleep 1
    if kiosk_laeuft; then
        echo "Kiosk ist zurueck (nach ${i}s)."
        exit 0
    fi
    i=$((i + 1))
done

echo "Der Browser kam nicht von selbst wieder — die Autologin-Kette hat nicht uebernommen. Der Neustart-Knopf holt alles zurueck." >&2
exit 3
