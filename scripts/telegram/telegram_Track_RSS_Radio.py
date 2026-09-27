#!/usr/bin/python3

import sys
import time
import json
import requests
import subprocess

with open("/etc/mupibox/mupiboxconfig.json") as file:
    config = json.load(file)

if not config['telegram']['active']:
    quit()

# TELEPOT ERST HIER — nach der Pruefung, nicht davor.
#
# Vorher stand `import telepot` ganz oben. Auf einer Box, auf der telepot nicht
# installiert ist (und das ist der Normalfall, wenn Telegram nicht benutzt
# wird), starb das Skript SOFORT mit ModuleNotFoundError — bevor es die
# Abschaltung ueberhaupt lesen konnte. Die Pruefung darunter war unerreichbar.
#
# Bei den Haken, die librespot als LIBRESPOT_ONEVENT ruft, passiert das bei
# JEDEM Abspielereignis: bei jedem Titelwechsel, jedem Anhalten, jeder
# Stellenaenderung. Am Geraet gemessen (2026-08-01) waren es fuenf gestorbene
# Python-Prozesse in acht Sekunden, jeder mit vollem Ablaufprotokoll im
# Systemprotokoll — auf einer Box, auf der Telegram ausgeschaltet ist.
#
# Jetzt beendet sich das Skript vorher still, so wie es gemeint war.
import telepot

url = 'http://127.0.0.1:5005/local'
local = requests.get(url).json()

TOKEN = config['telegram']['token']
bot = telepot.Bot(TOKEN)
chat_id = config['telegram']['chatId']

msg = local['album'] + "\n" + local['currentTrackname']
bot.sendMessage(chat_id, msg)
subprocess.run(["sudo", "rm", "/tmp/telegram_screen.png"])
subprocess.run(["sudo", "-H", "-u", "dietpi", "bash", "-c", "DISPLAY=:0 scrot /tmp/telegram_screen.png"])
bot.sendPhoto(chat_id, open('/tmp/telegram_screen.png', 'rb'))
