#!/usr/bin/python3

import sys
import time
import json

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

TOKEN = config['telegram']['token']
bot = telepot.Bot(TOKEN)
chat_id = config['telegram']['chatId']

bot.sendMessage(chat_id, sys.argv[1])

if config['mupihat']['hat_active']:
    with open("/tmp/mupihat.json") as file:
        mupihat = json.load(file)

    if mupihat['BatteryConnected']:
        bot.sendMessage(chat_id, 'The MupiBox battery is at '+mupihat['Bat_SOC'])