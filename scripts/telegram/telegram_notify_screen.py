#!/usr/bin/python3

import sys
import subprocess
import json

with open("/etc/mupibox/mupiboxconfig.json") as file:
    config = json.load(file)

if not config['telegram']['active']:
    sys.exit()

# TELEPOT ERST HIER — siehe die ausfuehrliche Begruendung in
# telegram_Track_Spotify.py: Der Import stand vor der Abschaltpruefung und
# liess das Skript auf jeder Box ohne telepot sterben, bevor es die
# Einstellung lesen konnte.
import telepot

TOKEN = config['telegram']['token']
bot = telepot.Bot(TOKEN)
chat_id = config['telegram']['chatId']

if len(sys.argv) > 1:
    msg = "\n".join(sys.argv[1:])
    bot.sendMessage(chat_id, msg)

subprocess.run(["sudo", "rm", "-f", "/tmp/telegram_screen.png"])
subprocess.run(["sudo", "-H", "-u", "dietpi", "bash", "-c", "DISPLAY=:0 scrot /tmp/telegram_screen.png"])
bot.sendPhoto(chat_id, open('/tmp/telegram_screen.png', 'rb'))
