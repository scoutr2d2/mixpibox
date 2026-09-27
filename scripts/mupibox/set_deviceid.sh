#!/bin/bash
#
# HOSTNAME

CONFIG="/etc/mupibox/mupiboxconfig.json"
# HOSTNAME steht nur noch fuer andere Zwecke da: der Abspieldienst wird ueber
# 127.0.0.1 gerufen, weil er seit dem 14.08.2026 nur dort hoert
# (spotify-control.ts). Ueber den Namen ginge der Aufruf ins Leere.
HOSTNAME=$(sudo /usr/bin/jq -r .mupibox.host ${CONFIG})
DEVICES=$(curl http://127.0.0.1:5005/getDevices 2>/dev/null)
devID=$(echo ${DEVICES} | jq '.[] | select(.name=='\"${HOSTNAME}\"')' | jq '.id')
devID=$(echo ${devID} | sed 's/\"//g')
if [ ${#devID} > 5 ];
then
        sudo /usr/bin/cat <<< $(/usr/bin/jq --arg v "${devID}" '.spotify.deviceId = $v' ${CONFIG}) > ${CONFIG}

fi
sudo /usr/local/bin/mupibox/./setting_update.sh
sudo /usr/local/bin/mupibox/./spotify_restart.sh
