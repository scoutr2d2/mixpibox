#!/bin/bash
#
# HOSTNAME

CONFIG="/etc/mupibox/mupiboxconfig.json"
# HOSTNAME steht nur noch fuer andere Zwecke da: der Abspieldienst wird ueber
# 127.0.0.1 gerufen, weil er seit dem 14.08.2026 nur dort hoert
# (spotify-control.ts). Ueber den Namen ginge der Aufruf ins Leere.
HOSTNAME=$(sudo /usr/bin/jq -r .mupibox.host ${CONFIG})
DEVICES=$(curl --max-time 8 http://127.0.0.1:5005/getDevices 2>/dev/null)
sudo echo $DEVICES > /tmp/.spotify_devices