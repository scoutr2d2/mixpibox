#!/bin/bash
#
# ABGELOEST am 05.08.2026. Dieses Skript laeuft nicht mehr und darf nicht mehr
# laufen. Der Ausrollweg ist jetzt:
#
#     python3 tools/ausliefern.py --probe     # alles pruefen, nichts tauschen
#     python3 tools/ausliefern.py             # bauen, sichern, tauschen, nachmessen
#
# WARUM ES NICHT MEHR TAUGT — vier Gruende, alle am Geraet nachgesehen, jeder
# einzeln toedlich:
#
#   1. `pm2 restart server spotify-control` — auf der Box laeuft KEIN pm2 mehr.
#      Beide Dienste kommen aus systemd (mupibox-server.service /
#      mupibox-player.service), pm2 hat eine leere Prozessliste. Der Neustart
#      waere also wirkungslos: die Box liefe mit dem ALTEN Code weiter, und man
#      suchte den Fehler in einer Aenderung, die laengst richtig ist.
#
#   2. `mv .../server/config/*.json /tmp/user_data_backup/` — dieses Verzeichnis
#      existiert nicht und wird nirgends angelegt. Der `mv` scheitert, und weil
#      kein `set -e` da ist, laeuft `rm -rf www` TROTZDEM weiter. Zwei weitere
#      Zusaetze: /tmp ist auf dieser Box tmpfs (RAM) — ein Neustart zwischen Hin-
#      und Rueckschieben loescht die Konfiguration; und `active_data.json` /
#      `active_resume.json` sind VERWEISE, verschoben waeren sie kaputt.
#
#   3. `mv .../www/cover` und `.../www/active_theme.css` — beides gibt es in
#      `www` nicht mehr. Die Cover liegen heute in `server/config/coverspeicher`.
#
#   4. `rm -rf www` und DANACH kopieren — genau andersherum als die Regel
#      [[ausliefern-regeln]] („danebenlegen und umbenennen, nicht loeschen und
#      kopieren"). Dazwischen ist das Verzeichnis leer; genau in diesen
#      Sekundenbruchteil fiel schon zweimal ein Neuladen des Kiosk, und der
#      stand danach auf einer weissen JSON-Seite.
#
# Ausserdem hat es ein `read -p` und laeuft damit nie unbeaufsichtigt, und es
# legt bei jedem Lauf eine weitere Kopie beiseite — die Praxis, aus der die
# 99 Altdateien (163 MB) vom 05.08.2026 entstanden sind.
#
# Der alte Inhalt steht in der Geschichte:  git log --follow -p -- src/deploy_on_device.sh
#
# NICHT VERWECHSELN mit src/deploy.sh — das ist der andere, weiterhin gueltige
# Weg: es packt bin/nodejs/deploy.zip fuer eine FRISCHE Karte (autosetup /
# start_mupibox_update). tools/ausliefern.py bedient die LAUFENDE Box.

echo "src/deploy_on_device.sh ist abgeloest und laeuft nicht mehr." >&2
echo "Nimm stattdessen:  python3 tools/ausliefern.py --probe" >&2
echo "Die Gruende stehen im Kopf dieser Datei." >&2
exit 64
