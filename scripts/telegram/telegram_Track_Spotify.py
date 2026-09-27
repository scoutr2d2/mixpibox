#!/usr/bin/python3

import sys
import time
import os
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

url = 'http://127.0.0.1:5005/state'
state = requests.get(url).json()

urls = 'http://127.0.0.1:5005/episode'

TOKEN = config['telegram']['token']
bot = telepot.Bot(TOKEN)
chat_id = config['telegram']['chatId']

player_event = os.environ.get('PLAYER_EVENT')
POSITION_MS = os.environ.get('POSITION_MS')

if player_event == "playing" and POSITION_MS == "0":
    if state['currently_playing_type'] == 'episode':
        episode = requests.get(urls).json()
        msg = episode['show']['name'] + "\n" + episode['name']
        bot.sendMessage(chat_id, msg)
        subprocess.run(["sudo", "rm", "/tmp/telegram_screen.png"])
        subprocess.run(["sudo", "-H", "-u", "dietpi", "bash", "-c", "DISPLAY=:0 scrot /tmp/telegram_screen.png"])
        bot.sendPhoto(chat_id, open('/tmp/telegram_screen.png', 'rb'))
        sys.exit()
    msg = state['item']['album']['name'] + "\n" + state['item']['name'] + "\nTrack: " + str(state['item']['track_number']) + "/" + str(state['item']['album']['total_tracks'])
    bot.sendMessage(chat_id, msg)
    subprocess.run(["sudo", "rm", "/tmp/telegram_screen.png"])
    subprocess.run(["sudo", "-H", "-u", "dietpi", "bash", "-c", "DISPLAY=:0 scrot /tmp/telegram_screen.png"])
    bot.sendPhoto(chat_id, open('/tmp/telegram_screen.png', 'rb'))
