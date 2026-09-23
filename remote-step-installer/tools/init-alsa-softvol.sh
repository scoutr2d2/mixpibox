#!/bin/bash
# ALSA-softvol-Regler "Master" beim Boot ANLEGEN.
#
# Warum: /etc/asound.conf definiert Master als `softvol`-Plugin. Ein solcher Regler
# entsteht erst, wenn zum ersten Mal etwas durch das Geraet spielt — nach einem
# Neustart ist er also weg. Der MuPiBox-Player liest aber beim Start
# `amixer sget Master`; fehlt der Regler, stirbt er und pm2 startet ihn endlos neu
# (am Geraet belegt: 58 Neustarts nach dem Reboot).
set -u
for i in 1 2 3 4 5 6 7 8 9 10; do
  [ -e /dev/snd/controlC0 ] && break
  sleep 1
done
# 0,3 s Stille durch das Standard-Geraet -> softvol-Regler entsteht
timeout 5 aplay -D default -q -d 1 -f S16_LE -r 44100 -c 2 /dev/zero >/dev/null 2>&1 || \
  timeout 5 speaker-test -D default -l 1 -t sine >/dev/null 2>&1 || true
if amixer scontrols 2>/dev/null | grep -q Master; then
  amixer -q sset Master "${MUPI_START_VOL:-70}%" 2>/dev/null || true
  alsactl store 2>/dev/null || true          # damit alsa-restore ihn kennt
  logger -t mupibox "ALSA: Master-Regler angelegt"
else
  logger -t mupibox "ALSA: Master-Regler konnte NICHT angelegt werden"
fi
exit 0
