#!/bin/bash
#

#https://raw.githubusercontent.com/splitti/MuPiBox/main
#SRC="https://mupibox.de/version/latest"
CONFIG="/etc/mupibox/mupiboxconfig.json"

# ── EIN STAND, BEVOR HIER IRGENDETWAS UMGEZOGEN WIRD (BACKLOG E29/B2) ──────
#
# Dieses Skript ist der Grund, warum E29/B2 im BACKLOG steht. Bis zum
# 03.08.2026 nahm es bei JEDEM Lauf `mediaCheckTimer` weg (siehe den langen
# Block gleich darunter). Der Schaden war unsichtbar, und ohne einen Stand von
# vorher war er nur durch Lesen des Migrationsskripts zu finden.
#
# `--wenn-anders`: start_mupibox_update.sh sichert schon, und dieses Skript
# wird von dort aufgerufen. Hat sich seither nichts geaendert, entsteht kein
# zweiter Stand — sonst verdraengten Leerlauf-Staende die, auf die es ankommt
# ([[aufraeum-sicherung-vor-der-entscheidung]]). Wird conf_update.sh dagegen
# EINZELN gefahren, ist dies die einzige Sicherung, die es gibt.
SICHERUNG="/usr/local/bin/mupibox/mupibox-sicherung.py"
if [ -x "${SICHERUNG}" ]; then
	if [ "$(id -u)" = "0" ]; then
		sudo -u dietpi "${SICHERUNG}" --anlegen --grund vor-konfig-umzug --wenn-anders --behalten || true
	else
		"${SICHERUNG}" --anlegen --grund vor-konfig-umzug --wenn-anders --behalten || true
	fi
fi

# 1.0.8
/usr/bin/jq 'del(.mupibox.googlettslanguages)' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
# HIER STAND: del(.mupibox.mediaCheckTimer) — herausgenommen am 03.08.2026.
#
# WARUM DIE ZEILE FALSCH WAR, gemessen mit tools/konfig-umzug-probe.py: Sie
# loescht bei JEDEM Update ersatzlos einen Schluessel, den dieser Fork noch
# LIEST. Im Ursprungsprojekt ist `mediaCheckTimer` ausgemustert (dort entfernt
# start_mupibox_update.sh auch mupi_change_checker.service); hier nicht — es
# gibt weiter scripts/mupibox/change_checker.sh, weiter
# config/services/mupi_change_checker.service, und seit dem Umbau vom 03.08.
# auch ein Feld dafuer im Board („Medien pruefen alle … Sekunden").
#
# WAS SIE KOSTETE: change_checker.sh liest den Wert mit `jq -r` in CHECK_TIMER
# und schliesst seine Schleife mit `sleep ${CHECK_TIMER}`. Ohne Schluessel
# steht dort woertlich `null`, `sleep null` bricht sofort ab ("ungueltiges
# Zeitintervall", Exitcode 1) — aus der Warteschleife wird eine Dauerschleife,
# die `stat` ueber jedes Medienverzeichnis jagt, auf einem Pi, der nebenher
# Musik spielt. Nichts davon meldet sich am Bildschirm.
#
# NUR NACHLEGEN HAETTE NICHT GEREICHT, und das ist der Grund, warum die Zeile
# weg ist statt bloss ergaenzt: sie loescht auch den EINGESTELLTEN Wert. Das
# Skript laeuft von oben nach unten — eine Box mit 600 Sekunden haette hier
# ihre 600 verloren und am Ende 300 zurueckbekommen, still. Am Fuss des
# Skripts steht deshalb das Nachlegen fuer Boxen, denen der Schluessel schon
# fehlt; hier steht das Aufhoeren, ihn wegzunehmen. Beides zusammen ergibt
# erst „keine Box verliert etwas".
/usr/bin/jq 'del(.mupibox.AudioDevices)' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}

# 1.0.8
/usr/bin/jq '.mupibox.googlettslanguages = [{"iso639-1": "ar", "Language": "Arabic"},{"iso639-1": "zh", "Language": "Chinese"},{"iso639-1": "cs","Language": "Czech"},{"iso639-1": "da","Language": "Danish"},{"iso639-1": "nl","Language": "Dutch"},{"iso639-1": "en","Language": "English"},{"iso639-1": "fi","Language": "Finnish"},{"iso639-1": "fr","Language": "French"},{"iso639-1": "de","Language": "German"},{"iso639-1": "el","Language": "Greek"},{"iso639-1": "hi","Language": "Hindi"},{"iso639-1": "it","Language": "Italian"},{"iso639-1": "ja","Language": "Japanese"},{"iso639-1": "no","Language": "Norwegian"},{"iso639-1": "pl","Language": "Polish"},{"iso639-1": "pt","Language": "Portuguese"},{"iso639-1": "ru","Language": "Russian"},{"iso639-1": "es","Language": "Spanish, Castilian"},{"iso639-1": "sv","Language": "Swedish"},{"iso639-1": "tr","Language": "Turkish"},{"iso639-1": "uk","Language": "Ukrainian"}]' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}

# 1.0.8
DEVICE=$(/usr/bin/jq -r .spotify.physicalDevice ${CONFIG})
if [ "$DEVICE" == "null" ]; then 
	/usr/bin/jq --arg v "hifiberry-dac" '.mupibox.physicalDevice = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

# 1.0.8
MAXVOL=$(/usr/bin/jq -r .mupibox.maxVolume ${CONFIG})
if [ "$MAXVOL" == "null" ]; then 
	/usr/bin/jq --arg v "100" '.mupibox.maxVolume = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

# 2.0.0
# HIER STANDEN 18 Bloecke, die .mupibox.installedThemes nachpflegten
# (xmas, wood, ... axolotl, customTheme). Die CSS-Themen der alten
# Oberflaeche fallen mit E118 (1d: Feld weg, 1e: Dateien weg) - eine
# Liste nachzufuellen, die niemand mehr anbietet, waere Pflege eines
# Grabsteins. Bestandskonfigurationen behalten ihre Eintraege.
#2.1.0
LEDMAX=$(/usr/bin/jq -r .shim.ledBrightnessMax ${CONFIG})
if [ "$LEDMAX" == "null" ]; then 
	/usr/bin/jq --arg v "100" '.shim.ledBrightnessMax = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

LEDMIN=$(/usr/bin/jq -r .shim.ledBrightnessMin ${CONFIG})
if [ "$LEDMIN" == "null" ]; then 
	/usr/bin/jq --arg v "10" '.shim.ledBrightnessMin = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

#3.0.0
PM2RAMLOG=$(/usr/bin/jq -r .pm2.ramlog ${CONFIG})
if [ "$PM2RAMLOG" == "null" ]; then 
	/usr/bin/jq --arg v "0" '.pm2.ramlog = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

#3.0.2
TELEGRAM=$(/usr/bin/cat ${CONFIG} | grep telegram)
if [[ -z ${TELEGRAM} ]]; then
	/usr/bin/jq --arg v "" '.telegram.token = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq '.telegram.active = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "" '.telegram.chatId = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

#3.0.2
WLED=$(/usr/bin/cat ${CONFIG} | grep wled)
if [[ -z ${WLED} ]]; then
	/usr/bin/jq '.wled.active = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "" '.wled.startup_id = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "" '.wled.main_id = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "" '.wled.shutdown_id = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "255" '.wled.brightness_default = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "128" '.wled.brightness_dimmed = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "true" '.wled.boot_active = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "true" '.wled.shutdown_active = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "115200" '.wled.baud_rate = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "/dev/ttyUSB0" '.wled.com_port = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

#3.2.6
IPCONTROL=$(/usr/bin/cat ${CONFIG} | grep ip_control_backend)
if [[ -z ${IPCONTROL} ]]; then
	/usr/bin/jq --arg v "false" '.mupibox.ip_control_backend = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
/usr/bin/jq 'del(.wled.ip)' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
WLED=$(/usr/bin/cat ${CONFIG} | grep com_port)

if [[ -z ${WLED} ]]; then
	/usr/bin/jq --arg v "" '.wled.startup_id = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "255" '.wled.brightness_default = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "128" '.wled.brightness_dimmed = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "true" '.wled.boot_active = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "true" '.wled.shutdown_active = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "115200" '.wled.baud_rate = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "/dev/ttyUSB0" '.wled.com_port = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	
fi

#3.3.4
GPU=$(/usr/bin/jq -r .chromium.gpu ${CONFIG})
if [ "$GPU" == "null" ]; then 
	/usr/bin/jq '.chromium.gpu = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
SCROLLANI=$(/usr/bin/jq -r .chromium.sccrollanimation ${CONFIG})
if [ "$SCROLLANI" == "null" ]; then 
	/usr/bin/jq '.chromium.sccrollanimation = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
CACHEPATH=$(/usr/bin/jq -r .chromium.cachepath ${CONFIG})
if [ "$CACHEPATH" == "null" ]; then 
	/usr/bin/jq --arg v "/home/dietpi/.mupibox/chromium_cache" '.chromium.cachepath = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
CACHESIZE=$(/usr/bin/jq -r .chromium.cachesize ${CONFIG})
if [ "$CACHESIZE" == "null" ]; then 
	/usr/bin/jq --arg v "128" '.chromium.cachesize = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
KIOSKMODE=$(/usr/bin/jq -r .chromium.kiosk ${CONFIG})
if [ "$KIOSKMODE" == "null" ]; then 
	/usr/bin/jq '.chromium.kiosk = true' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
# ══ maxcachesize IST IN GB, NICHT IN BYTES (E55, 20.08.2026) ═══════════════
# Hier stand als Vorgabe "1073741824" — 1 GB, aber in BYTES und als
# Zeichenkette. Alle drei Leser deuten das Feld als GB: librespot-start.sh
# haengt ein "G" an (daraus wurde "1073741824G"), soloist-start.sh rechnet
# mal 1000 in MB (daraus wurden 1,07 Billionen — Soloist lehnte ab mit
# "--cache-size must be 0 (no limit) or >= 100", der Dienst drehte in der
# Neustart-Schleife, die Oberflaeche stand dauerhaft auf "meldet sich an").
# Die zweite Haelfte migriert Bestandsboxen, denen genau diese Vorgabe den
# Byte-Wert eingeschrieben hat: eine Zahl ueber 64 ist als GB unglaubwuerdig.
MAXCACHE=$(/usr/bin/jq -r .spotify.maxcachesize ${CONFIG})
if [ "$MAXCACHE" == "null" ]; then
	/usr/bin/jq '.spotify.maxcachesize = 1' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
elif [ "$(echo "$MAXCACHE" | tr -d '0-9')" == "" ] && [ "$MAXCACHE" -gt 64 ] 2>/dev/null; then
	/usr/bin/jq '.spotify.maxcachesize = 1' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
CACHEPATH=$(/usr/bin/jq -r .spotify.cachepath ${CONFIG})
if [ "$CACHEPATH" == "null" ]; then 
	/usr/bin/jq --arg v "/home/dietpi/.cache/spotifyd" '.spotify.cachepath = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
CACHESTATE=$(/usr/bin/jq -r .spotify.cachestate ${CONFIG})
if [ "$CACHESTATE" == "null" ]; then 
	/usr/bin/jq '.spotify.cachestate = true' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

MQTTDEBUG=$(/usr/bin/jq -r .mqtt.debug ${CONFIG})
if [ "$MQTTDEBUG" == "null" ]; then 
	/usr/bin/jq '.mqtt.debug = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTACTIVE=$(/usr/bin/jq -r .mqtt.active ${CONFIG})
if [ "$MQTTACTIVE" == "null" ]; then 
	/usr/bin/jq '.mqtt.active = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTBROKER=$(/usr/bin/jq -r .mqtt.broker ${CONFIG})
if [ "$MQTTBROKER" == "null" ]; then 
	/usr/bin/jq --arg v "mqtt-example-broker.com" '.mqtt.broker = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTPORT=$(/usr/bin/jq -r .mqtt.port ${CONFIG})
if [ "$MQTTPORT" == "null" ]; then 
	/usr/bin/jq --arg v "1883" '.mqtt.port = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTTOPIC=$(/usr/bin/jq -r .mqtt.topic ${CONFIG})
if [ "$MQTTTOPIC" == "null" ]; then 
	/usr/bin/jq --arg v "MuPiBox/Boxname" '.mqtt.topic = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTBOXNAME=$(/usr/bin/jq -r .mqtt.clientId ${CONFIG})
if [ "$MQTTBOXNAME" == "null" ]; then 
	/usr/bin/jq --arg v "Boxname" '.mqtt.clientId = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
# mqtt.name — DER SCHLUESSEL, AN DEM DER DIENST STARB (E12/X8).
#
# mqtt.py liest 14 Schluessel unter `mqtt`, dieses Repo legte 13 an. `name` ist
# der Geraetename in der Home-Assistant-Erkennung ("device": {"name": ...}) und
# wird GANZ AM ANFANG von main() gelesen (mqtt.py:905) — vor jedem Verbindungs-
# versuch. Fehlt er, ist das ein KeyError, der Prozess endet mit Code 1
# ("exited", nicht "aborted"), und `Restart=on-abort` greift dabei NICHT: der
# Dienst bleibt tot, waehrend `systemctl is-enabled` weiter "enabled" sagt.
# Genau dieses Bild wurde am 30.07.2026 auf BEIDEN Boxen gemessen
# ([[mupi-mqtt-reparatur]]) und dort von Hand behoben — hier stand es bis heute
# nicht. Gegenprobe: python3 tools/mqtt-schluessel-abgleich.py
#
# WARUM "MuPiBox" UND NICHT DER RECHNERNAME, wie es der remote-step-installer
# auf den eingerichteten Boxen gemacht hat: dort war der Rechnername bereits
# gesetzt. Beim Ausrollen ist er es nicht — DietPi heisst frisch "DietPi", und
# das waere als Geraetename in der Hausautomatik schlechter als "MuPiBox".
# Eindeutig wird eine Box ueber `clientId` (daraus baut mqtt.py die unique_id),
# und die muss der Benutzer ohnehin je Box setzen. Derselbe Wert steht in
# config/templates/mupiboxconfig.json, damit sich eine frische SD und eine
# gewachsene Box nicht unterschiedlich verhalten.
#
# FALLE FUER DEN NAECHSTEN LESER: die Zeile darueber setzt fuer `clientId`
# "Boxname", die Vorlage aber "MuPiBox". Diese Abweichung ist AELTER als dieser
# Block und absichtlich nicht mitgeaendert worden — sie gehoert in einen
# eigenen Schritt, nicht als Nebenwirkung hier hinein.
MQTTNAME=$(/usr/bin/jq -r .mqtt.name ${CONFIG})
if [ "$MQTTNAME" == "null" ]; then
	/usr/bin/jq --arg v "MuPiBox" '.mqtt.name = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTUSERNAME=$(/usr/bin/jq -r .mqtt.username ${CONFIG})
if [ "$MQTTUSERNAME" == "null" ]; then 
	/usr/bin/jq --arg v "username" '.mqtt.username = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTPASSWORD=$(/usr/bin/jq -r .mqtt.password ${CONFIG})
if [ "$MQTTPASSWORD" == "null" ]; then 
	/usr/bin/jq --arg v "password" '.mqtt.password = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTREFRESH=$(/usr/bin/jq -r .mqtt.refresh ${CONFIG})
if [ "$MQTTREFRESH" == "null" ]; then 
	/usr/bin/jq --arg v "5" '.mqtt.refresh = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTREFRESHIDLE=$(/usr/bin/jq -r .mqtt.refreshIdle ${CONFIG})
if [ "$MQTTREFRESHIDLE" == "null" ]; then 
	/usr/bin/jq --arg v "30" '.mqtt.refreshIdle = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi
MQTTTIMEOUT=$(/usr/bin/jq -r .mqtt.timeout ${CONFIG})
if [ "$MQTTTIMEOUT" == "null" ]; then 
	/usr/bin/jq --arg v "60" '.mqtt.timeout = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

HA_MQTT=$(/usr/bin/jq -r .mqtt.ha_topic ${CONFIG})
if [ "$HA_MQTT" == "null" ]; then 
	/usr/bin/jq '.mqtt.ha_active = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq --arg v "homeassistant" '.mqtt.ha_topic = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

BATTERYCONFIG=$(/usr/bin/jq -r .mupihat.selected_battery ${CONFIG})
if [ "$BATTERYCONFIG" == "null" ]; then 
	/usr/bin/jq --arg v "ENERpower 2S2P 10.000mAh" '.mupihat.selected_battery = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq '. += {"mupihat": { "battery_types": [{ "name": "Ansmann 2S1P", "config": { "v_100": "8100", "v_75": "7800", "v_50": "7400", "v_25": "7000", "v_0": "6700", "th_warning": "7000", "th_shutdown": "6800" }}, { "name": "ENERpower 2S2P 10.000mAh", "config": {	"v_100": "8000", "v_75": "7700", "v_50": "7300", "v_25": "6900", "v_0": "6000", "th_warning": "6500", "th_shutdown": "6150" }}, { "name": "USB-C mode (no battery)", "config": { "v_100": "1", "v_75": "1", "v_50": "1", "v_25": "1", "v_0": "1", "th_warning": "0", "th_shutdown": "0"}}, { "name": "Custom", "config": { "v_100": "8100", "v_75": "7800", "v_50": "7400", "v_25": "7000", "v_0": "6700", "th_warning": "7000", "th_shutdown": "6800"}}], "ENERpower 2S2P 10.000mAh" }}' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq '.mupihat.hat_active = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

HAT_ACTIVE=$(/usr/bin/jq -r .mupihat.hat_active ${CONFIG})
if [ "$HAT_ACTIVE" == "null" ]; then 
	/usr/bin/jq '.mupihat.hat_active = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

FAN_ACTIVE=$(/usr/bin/jq -r .fan.fan_active ${CONFIG})
if [ "$FAN_ACTIVE" == "null" ]; then 
	/usr/bin/jq '.fan.fan_active = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq '.fan.fan_gpio = "13"' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq '.fan.fan_temp_100 = "75"' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq '.fan.fan_temp_75 = "65"' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq '.fan.fan_temp_50 = "55"' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	/usr/bin/jq '.fan.fan_temp_25 = "45"' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

RESUME=$(/usr/bin/cat ${CONFIG} | grep resume)
if [[ -z ${RESUME} ]]; then 
	/usr/bin/jq '.mupibox.resume = 9' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi






ADMININTERFACE=$(/usr/bin/cat ${CONFIG} | grep interfacelogin)
if [[ -z ${ADMININTERFACE} ]]; then
	/usr/bin/jq '.interfacelogin.state = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
	# LEER, KEIN GETEILTER STANDARD-HASH (E131/B4). Hier stand ein bcrypt-Hash
	# in DOPPELTEN Anfuehrungszeichen — die Shell expandierte "$2y", "$10" und
	# "$tA27…" als (leere) Variablen, geschrieben wurde also ohnehin nur ein
	# verstuemmelter Rest. Ein geteilter Standard-Hash waere auch richtig
	# geschrieben falsch gewesen: offline knackbar, auf jeder Box derselbe.
	# Ein LEERER Hash weist laut auth.ts passwortStimmt() IMMER ab, und die
	# Heil-Pruefung des Backends (konfiguration.ts pruefeKonfig) verweigert
	# das Einschalten der Anmeldung, solange kein eigenes Passwort gesetzt
	# ist. Bestandsboxen mit vorhandenem interfacelogin fasst dieser Block
	# unveraendert NICHT an.
	/usr/bin/jq '.interfacelogin.password = ""' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi


#/usr/bin/cat <<< $(/usr/bin/jq '.mupibox.AudioDevices += [{"tname": "MAX98357A bcm2835-i2s-HiFi HiFi-0","ufname": "MAX98357A bcm2835-i2s-HiFi HiFi-0"},{"tname": "rpi-bcm2835-3.5mm","ufname": "Onboard 3.5mm output"},{"tname": "rpi-bcm2835-hdmi","ufname": "Onboard HDMI output"},{"tname": "hifiberry-amp","ufname": "HifiBerry AMP / AMP+"},{"tname": "hifiberry-dac","ufname": "HifiBerry DAC / MiniAmp"},{"tname": "hifiberry-dacplus","ufname": "HifiBerry DAC+ / DAC+ Pro / AMP2"},{"tname": "usb-dac","ufname": "Any USB Audio DAC (Auto detection)"}]' ${CONFIG}) >  ${CONFIG}
/usr/bin/jq '.mupibox.AudioDevices = [{"tname": "MAX98357A bcm2835-i2s-HiFi HiFi-0","ufname": "MAX98357A bcm2835-i2s-HiFi HiFi-0"},{"tname": "rpi-bcm2835-3.5mm","ufname": "Onboard 3.5mm output"},{"tname": "rpi-bcm2835-hdmi","ufname": "Onboard HDMI output"},{"tname": "allo-boss-dac-pcm512x-audio","ufname": "Allo Boss DAC"},{"tname": "allo-boss2-dac-audio","ufname": "Allo Boss2 DAC"},{"tname": "allo-digione","ufname": "Allo DigiOne"},{"tname": "allo-katana-dac-audio","ufname": "Allo Katana DAC"},{"tname": "allo-piano-dac-pcm512x-audio","ufname": "Allo Piano DAC"},{"tname": "allo-piano-dac-plus-pcm512x-audio","ufname": "Allo Piano DAC 2.1"},{"tname": "applepi-dac","ufname": "ApplePi DAC (Orchard Audio)"},{"tname": "dionaudio-loco","ufname": "Dion Audio LOCO"},{"tname": "dionaudio-loco-v2","ufname": "Dion Audio LOCO V2"},{"tname": "googlevoicehat-soundcard","ufname": "Google AIY voice kit"},{"tname": "hifiberry-amp","ufname": "HifiBerry AMP / AMP+"},{"tname": "hifiberry-dac","ufname": "HifiBerry DAC / MiniAmp"},{"tname": "hifiberry-dacplus","ufname": "HifiBerry DAC+ / DAC+ Pro / AMP2"},{"tname": "hifiberry-dacplusadc","ufname": "HifiBerry DAC+ADC"},{"tname": "hifiberry-dacplusadcpro","ufname": "HifiBerry DAC+ADC Pro"},{"tname": "hifiberry-dacplusdsp","ufname": "HifiBerry DAC+DSP"},{"tname": "hifiberry-dacplushd","ufname": "HifiBerry DAC+ HD"},{"tname": "hifiberry-digi","ufname": "HifiBerry Digi / Digi+"},{"tname": "hifiberry-digi-pro","ufname": "HifiBerry Digi+ Pro"},{"tname": "i-sabre-q2m","ufname": "AudioPhonics I-Sabre ES9028Q2M / ES9038Q2M"},{"tname": "iqaudio-codec","ufname": "IQaudIO Pi-Codec HAT"},{"tname": "iqaudio-dac","ufname": "IQaudIO DAC audio card"},{"tname": "iqaudio-dacplus","ufname": "Pi-DAC+, Pi-DACZero, Pi-DAC+ Pro, Pi-DigiAMP+"},{"tname": "iqaudio-digi-wm8804-audio","ufname": "Pi-Digi+"},{"tname": "usb-dac","ufname": "Any USB Audio DAC (Auto detection)"}]' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}

# delete old entries
/usr/bin/jq 'del(.spotify.username)' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
/usr/bin/jq 'del(.spotify.password)' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}


# ── 2026-08-03: die vier Schluessel, die das Verwaltungs-Board bedient, aber ──
# ── die auf aelteren Boxen fehlten (Bestandsaufnahme G2, Pi 5 .169)          ──
#
# WARUM DAS HIER STEHT UND NICHT NUR IN DER VORLAGE: config/templates/
# mupiboxconfig.json legt diese Schluessel bei einer NEUEN Installation an.
# Eine Box, die schon laeuft, bekommt die Vorlage nie wieder zu sehen — sie
# bekommt dieses Skript. Ohne die vier Zeilen zeigt das Board Felder an, unter
# denen in der Datei nichts steht: der Wert ist dann erst nach dem ersten
# Speichern da, und bis dahin sieht die Anzeige richtig aus, ohne es zu sein.
#
# DREI DER VIER WERTE SIND DIE, DIE OHNEHIN GELTEN — da wird nichts umgestellt:
#   oberflaeche               chromium-autostart.sh liest '// "klassisch"'
#   disableScraperForPlaylists  ohne Schluessel laeuft die Notloesung, also false
#   jellyfin.apiKey           leer heisst "nicht eingerichtet"
#
# EINER STELLT SEHR WOHL UM, seit dem 06.08.2026, und das ist Absicht:
#   einstellungssperre        war "aus", ist "rechnen" — Begruendung unten
# Bis dahin galt auch fuer ihn „der Wert, der ohnehin gilt". Genau das war der
# Fehler: „was ohnehin gilt" war hier ein Zustand, den niemand gewaehlt hatte
# und den auch niemand wollte.
OBERFLAECHE=$(/usr/bin/jq -r .mupibox.oberflaeche ${CONFIG})
if [ "$OBERFLAECHE" == "null" ]; then
	/usr/bin/jq --arg v "klassisch" '.mupibox.oberflaeche = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

# kioskBrowser — WOMIT der Kiosk zeigt (E56, 20.08.2026). Auch das ist "der
# Wert, der ohnehin gilt": chromium-autostart.sh liest '// "chromium"'. Er
# steht hier trotzdem, damit der Eltern-Bereich kein Feld anzeigt, unter dem
# in der Datei nichts liegt — dieselbe Begruendung wie bei den vier daueber.
# Umgestellt wird NICHT: Cog spart zwar 180 MB (gemessen), bringt aber WebKit
# mit, und diese Entscheidung gehoert dem Betreiber und keinem Update.
KIOSKBROWSER=$(/usr/bin/jq -r .mupibox.kioskBrowser ${CONFIG})
if [ "$KIOSKBROWSER" == "null" ]; then
	/usr/bin/jq --arg v "chromium" '.mupibox.kioskBrowser = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

# SEIT DEM 06.08.2026 STEHT HIER "rechnen" UND NICHT MEHR "aus".
#
# Diese vier Zeilen waren der Grund, warum sich die Sperre nicht durch blosses
# Lesen schliessen liess: Sie schreiben einen AUSDRUECKLICHEN Wert in genau die
# Boxen, denen der Schluessel fehlt — und ein ausdruecklicher Wert gewinnt zu
# Recht gegen jede Ruecknahme beim Lesen. Das naechste Update haette die
# Reparatur also wieder aufgehoben, ohne dass jemand etwas gemerkt haette.
#
# WARUM "rechnen" UND NICHT "pin": Auf einer Box ohne hinterlegte PIN
# vergleicht das Backend gegen einen leeren Hash und sagt auf JEDE Eingabe
# nein. "pin" als Vorgabe sperrt also aus, statt aufzufallen — und dahinter
# laege ausgerechnet das WLAN, ueber das man die Box wieder erreichen muss.
# Eine Rechenaufgabe braucht keine Einrichtung.
#
# WEN ES TRIFFT: bestehende Boxen, auf denen nie jemand entschieden hat. Die
# stehen heute offen — jedes Kind kommt an WLAN, an die Mediendatenbank samt
# Loeschknoepfen und ans Herunterfahren. Wer ausdruecklich "aus" gewaehlt hat,
# behaelt es: dieser Zweig laeuft nur bei FEHLENDEM Schluessel.
EINSTELLUNGSSPERRE=$(/usr/bin/jq -r .mupibox.einstellungssperre ${CONFIG})
if [ "$EINSTELLUNGSSPERRE" == "null" ]; then
	/usr/bin/jq --arg v "rechnen" '.mupibox.einstellungssperre = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

SCRAPER=$(/usr/bin/jq -r .spotify.disableScraperForPlaylists ${CONFIG})
if [ "$SCRAPER" == "null" ]; then
	/usr/bin/jq '.spotify.disableScraperForPlaylists = false' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

JELLYKEY=$(/usr/bin/jq -r .jellyfin.apiKey ${CONFIG})
if [ "$JELLYKEY" == "null" ]; then
	/usr/bin/jq --arg v "" '.jellyfin.apiKey = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

# ── 2026-08-03, beim Gegenlesen dazugekommen: der FUENFTE Schluessel ──────────
#
# DIE ZWEITE HAELFTE zu der Loeschzeile, die oben im Kopf des Skripts
# herausgenommen wurde. Beide sind noetig, und sie decken VERSCHIEDENE Faelle:
#
#   oben, die Zeile weg  eine Box, die schon einen Wert HAT, behaelt ihn.
#                        (Nur nachzulegen haette hier nichts genuetzt: das
#                        Skript laeuft von oben nach unten, die Loeschung
#                        haette die eingestellten 600 Sekunden gefressen und
#                        hier kaemen 300 zurueck — still.)
#   hier, das Nachlegen  eine Box, der er schon abhanden gekommen ist, bekommt
#                        ihn zurueck. Ohne das bliebe sie fuer immer ohne
#                        Schluessel; die Vorlage sieht sie nie wieder.
#
# WAS AM GERAET DARANHAENGT: scripts/mupibox/change_checker.sh liest den Wert
# mit `jq -r` in CHECK_TIMER und schliesst seine Schleife mit
# `sleep ${CHECK_TIMER}`. Ohne Schluessel steht dort woertlich `null`;
# `sleep null` bricht sofort ab ("ungueltiges Zeitintervall"), und aus der
# Warteschleife wird eine Dauerschleife, die `stat` ueber jedes
# Medienverzeichnis jagt. Nachgemessen: `CHECK_TIMER=null; sleep $CHECK_TIMER`
# endet mit Code 1.
#
# DER WERT ist der der Vorlage, als Zeichenkette wie dort ("300"): jede
# gewachsene Box hat ihn so, `pruefeFeld` erhaelt den Typ des Altwerts, und die
# Shell liest ihn ohnehin mit `jq -r`.
MEDIACHECK=$(/usr/bin/jq -r .mupibox.mediaCheckTimer ${CONFIG})
if [ "$MEDIACHECK" == "null" ]; then
	/usr/bin/jq --arg v "300" '.mupibox.mediaCheckTimer = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

# ── Licht im Einschaltknopf (4.3.1) ───────────────────────────────────────
#
# NEUER SCHLUESSEL, kein neues Verhalten: `shim.ledEnabled` schaltet die LED
# im Einschaltknopf (MuPiHAT J15, GPIO13/PWM laut Datenblatt ab Platinenstand
# 2.2) ganz aus, ohne die eingestellten Helligkeiten anzufassen.
#
# WARUM `true` UND NICHT `false`: jede gewachsene Box hat das Licht heute an.
# Ein fehlender Schluessel darf die LED nicht ausknipsen — das saehe nach
# einem Hardwaredefekt aus, und gesucht wuerde am Kabel, nicht in der Datei.
#
# WARUM `--argjson` UND NICHT `--arg`: ein echter Boolean wie bei
# `fan.fan_active` und `wled.active` in derselben Datei. Mit `--arg` stuende
# dort die ZEICHENKETTE "true", und `jq -r .shim.ledEnabled` gaebe zwar auch
# "true" zurueck, aber `pruefeFeld` schriebe kuenftig "1"/"0" hinein (es
# behaelt den Typ des Altwerts) — dann steht in der Datei mal "true", mal
# "0", und mupi_start_led.sh muesste beides kennen.
LEDENABLED=$(/usr/bin/jq -r .shim.ledEnabled ${CONFIG})
if [ "$LEDENABLED" == "null" ]; then
	/usr/bin/jq --argjson v true '.shim.ledEnabled = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
fi

# ── Haltedauer der Taste: Bruchzahlen geradeziehen (4.3.1) ────────────────
#
# WAS PASSIERT IST: mupi.php bot die Haltedauer als Schieber mit Schrittweite
# 0,25 an. Wer 2,25 einstellte, bekam "2.25" in die Datei — und
# off_trigger.sh zaehlt damit `for ((i=0; i<PRESS_DELAY; i++))`. Bash kann
# das nicht: "Ungueltiger arithmetischer Operator". Die Schleife bricht ab,
# BEVOR sie ein einziges Mal prueft, ob die Taste noch gedrueckt ist —
# `button_held` steht da schon auf true. Ergebnis: die Box faehrt beim
# kuerzesten Antippen herunter, und das Protokoll meldet brav
# "Button held for 2.25 seconds".
#
# Das Skript faengt den Fall seit 4.3.1 selbst ab; hier wird die Datei
# zusaetzlich geradegezogen, damit in der Verwaltung nicht weiter eine Zahl
# steht, die es so nie gab. Aufgerundet, nicht abgerundet: eine zu kurze
# Haltedauer schaltet die Box versehentlich aus, eine zu lange nur nicht.
PRESSDELAY=$(/usr/bin/jq -r .timeout.pressDelay ${CONFIG})
case "${PRESSDELAY}" in
	*.*)
		PRESSDELAY_NEU=$(/usr/bin/awk -v v="${PRESSDELAY}" 'BEGIN{ n=v+0; r=int(n); if (n>r) r=r+1; if (r<1) r=1; if (r>5) r=5; print r }')
		/usr/bin/jq --arg v "${PRESSDELAY_NEU}" '.timeout.pressDelay = $v' ${CONFIG} > /tmp/tmp.$$.json && mv /tmp/tmp.$$.json ${CONFIG}
		;;
esac
