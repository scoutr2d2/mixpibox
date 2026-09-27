#!/bin/bash
# X waehlt auf dem Pi 5 gern einen NICHT angeschlossenen HDMI als "primary" und laesst
# den DSI-Ausgang auf disabled -> das Panel bleibt schwarz, obwohl Chromium laeuft.
# (Am Geraet belegt: Screen 1024x768, "HDMI-1 disconnected primary", DSI enabled=disabled.)
# Dieses Skript wartet, bis X da ist, schaltet den DSI-Ausgang scharf und die toten aus.
export DISPLAY=:0
for i in $(seq 1 30); do
  DSI=$(xrandr --query 2>/dev/null | awk '/ connected/ && /DSI/ {print $1; exit}')
  if [ -n "$DSI" ]; then
    xrandr --output "$DSI" --auto --primary 2>/dev/null
    for h in $(xrandr --query 2>/dev/null | awk '/ disconnected/ {print $1}'); do
      xrandr --output "$h" --off 2>/dev/null
    done
    # Touch MUSS dem Ausgang folgen: X bindet den Touchscreen beim Start an den
    # damaligen "primary" — schaltet man den (toten HDMI) ab, landen Beruehrungen
    # im Nichts und das Panel reagiert GAR NICHT mehr (am Geraet erlebt).
    for id in $(xinput list --id-only 2>/dev/null); do
      name=$(xinput list --name-only "$id" 2>/dev/null)
      case "$name" in
        *[Tt]ouch*|*ft5x06*|*goodix*|*edt*)
          xinput map-to-output "$id" "$DSI" 2>/dev/null \
            && logger -t mupibox "Touch '$name' auf $DSI gemappt" ;;
      esac
    done
    logger -t mupibox "DSI-Ausgang $DSI aktiviert, tote Ausgaenge aus"
    exit 0
  fi
  sleep 1
done
logger -t mupibox "force-dsi-output: kein DSI-Ausgang gefunden"
exit 0
