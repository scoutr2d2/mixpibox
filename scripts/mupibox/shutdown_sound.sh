#!/bin/bash
#

CONFIG="/etc/mupibox/mupiboxconfig.json"
SHUT_SOUND=$(/usr/bin/jq -r .mupibox.shutSound ${CONFIG})
AUDIO_DEVICE=$(/usr/bin/jq -r .mupibox.audioDevice ${CONFIG})
START_VOLUME=$(/usr/bin/jq -r .mupibox.startVolume ${CONFIG})

# Ueber mupi-lautstaerke.sh statt direkt ueber pactl (BACKLOG E12/X7): dieselbe
# Senke, aber mit der Obergrenze aus mupibox.maxVolume. Der Rueckfall haelt
# Boxen bedienbar, auf denen das Werkzeug (noch) nicht liegt.
/usr/local/bin/mupibox/mupi-lautstaerke.sh set ${START_VOLUME} \
  || /usr/bin/pactl set-sink-volume @DEFAULT_SINK@ ${START_VOLUME}%
/usr/bin/aplay ${SHUT_SOUND}
