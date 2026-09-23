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

coproc bluetoothctl
echo -e "power on\n" >&${COPROC[1]}
echo -e "agent on\n" >&${COPROC[1]}
echo -e "default-agent\n" >&${COPROC[1]}
echo -e "untrust $1\n" >&${COPROC[1]}
sleep 2
echo -e "remove $1\nyes\n" >&${COPROC[1]}
sleep 2
echo -e 'exit' >&${COPROC[1]}
output=$(cat <&${COPROC[0]})
echo $output
