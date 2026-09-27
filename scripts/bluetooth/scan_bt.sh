#!/bin/bash
# Aus dem MuPiBox-Bestand uebernommen (vom Pi 5 geholt, 31.08.2026). Es lag
# bis dahin NICHT im Baum: `scripts/bluetooth/` enthielt nur pair_bt.sh, und
# die Sammelkopie des Installers (recipes/mupibox-app.yaml) rollt genau dieses
# Verzeichnis aus. Eine frische Box bekam die vier anderen also nie - der Pi 5
# hatte sie noch aus seiner Erstinstallation. Gemessen am 31.08.: Pi 5 fuenf
# Skripte, frisch installierter Pi 4 eines.
#
# ZWEI FEHLER DABEI BEHOBEN, beide im Original:
#   * `defaut-agent` -> `default-agent`. Der Tippfehler laesst bluetoothctl den
#     Befehl verwerfen; es wird KEIN Standard-Agent registriert. Ohne Agent
#     nimmt der Adapter keine Kopplung an - am Pi 4 als "No agent is
#     registered" und `Pairable: no` gemessen.
#   * `ouput=$(...)` gefolgt von `echo $output` - die Zuweisung ging in eine
#     Variable, gelesen wurde eine andere (leere). Die Ausgabe war immer leer,
#     also sah jeder Aufruf erfolgreich aus.

sudo /usr/bin/rm /tmp/bt_scan
sudo /usr/bin/touch /tmp/bt_scan
sudo /usr/bin/chmod 777 /tmp/bt_scan
# `sudo cmd > datei` schreibt die Datei als AUFRUFENDER, nicht als root
# (SC2024) - hier ging es nur gut, weil daneben ein `chmod 777` steht.
sudo /usr/bin/hcitool scan | sudo /usr/bin/tee /tmp/bt_scan > /dev/null
#sudo /usr/bin/tail -n +2 /tmp/scan > /tmp/bt_scan

/usr/bin/cat /tmp/bt_scan
