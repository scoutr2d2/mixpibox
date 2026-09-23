#!/bin/bash
#
# Das Licht im Einschaltknopf (und WLED).
#
# WIE DAS ZUSAMMENHAENGT: dieses Skript liest die Konfiguration, led_control.py
# schaltet den Pin. Dazwischen liegt EINE Datei, /tmp/.power_led. Dieses Skript
# schreibt sie, led_control.py liest sie einmal pro Sekunde. Der Umweg hat einen
# Grund: der PWM-Ausgang gehoert genau einem Prozess, und der laeuft durch.
#
# DIE LED SITZT laut MuPiHAT-Datenblatt seit Platinenstand 2.2 (03/2024) auf
# GPIO13 mit PWM (Stecker J15, der Taster daneben an J1). PWM ist der Grund,
# warum es hier drei Werte gibt und nicht einen: aus, hell, gedimmt.
#
# ── ZWEI FEHLER, DIE HIER LANGE LAGEN (behoben 4.3.1) ──────────────────────
#
# 1. DIE SCHLEIFE UNTEN LAS DIE KONFIGURATION UND WARF SIE WEG. `ledMax` und
#    `ledMin` wurden jede Sekunde frisch geholt und danach nie benutzt — in die
#    Datei kam nur `led_dim_mode`. Wer die Helligkeit in der Verwaltung
#    aenderte, sah bis zum naechsten Neustart nichts. Genau daran haengt jetzt
#    der neue Schalter, deshalb schreibt die Schleife den ganzen Stand.
#
# 2. `led_dim_mode` STAND VERKEHRT HERUM. Bildschirm AN schrieb 1 (= dimmen),
#    Bildschirm AUS schrieb 0 (= hell) — waehrend die WLED-Zeilen direkt
#    daneben, in derselben Verzweigung, es richtig herum machen: an = normal,
#    aus = gedimmt. Beide Leser (led_control.py und scripts/led/led_control.c)
#    lesen 0 = hell, 1 = gedimmt. Aufgefallen ist es nie, weil der Python-Leser
#    zusaetzlich Fehler 3 hatte und ueberhaupt nichts tat.
#
# ATOMAR SCHREIBEN, nicht in die offene Datei: geschrieben wird in
# `${TMP_LEDFILE}.neu` und dann umbenannt. `mv` innerhalb von /tmp ist ein
# Umhaengen, kein Kopieren — der Leser sieht entweder den alten oder den neuen
# Stand, nie einen halben. Vorher stand hier `cat <<< $(jq ...) > DATEI`, was
# die Datei zuerst leert; bei einem Schreiben pro Sekunde ist das ein Treffer,
# auf den man wartet.
#
# ── UND DER DRITTE FEHLER (behoben 08.08.2026) ─────────────────────────────
#
# 3. DER SCHIRM WURDE NIE RICHTIG ABGEFRAGT. Hier stand:
#
#        displayState=`vcgencmd display_power | grep -o '.$'`
#
#    Den Befehl gibt es auf dem Pi 5 nicht mehr. Er antwortet zweizeilig auf
#    STDOUT ("vc_gencmd_read_response returned -1" / "error=1 error_msg=..."),
#    und `grep -o '.$'` nimmt das letzte Zeichen JEDER Zeile — aus zwei Zeilen
#    wurden zwei Woerter, der Vergleich zu `[ 1 " -eq 1 ]`.
#    FOLGE: "too many arguments", BEIDE Zweige immer falsch, `OLD_STATE` nie
#    fortgeschrieben, /tmp/.power_led dauerhaft auf `led_dim_mode: 0`. Das
#    Dimmen und der WLED-Wechsel passierten nicht selten, sondern NIE — und
#    zweimal je Sekunde ging eine Klage ins Journal (344 Zeilen in drei
#    Minuten, gemessen am 08.08.2026).
#    Das war die dritte Ursache dafuer, dass das Knopflicht nicht tat; die
#    ersten beiden waren der abgeschaltete Dienst und der falsche Browsername.

MUPIBOX_CONFIG="/etc/mupibox/mupiboxconfig.json"
TMP_LEDFILE="/tmp/.power_led"

# Beim Start gilt der Schirm als an. OLD_STATE haelt jetzt "an"/"aus" statt
# 1/0 — der Wert kommt nicht mehr aus einer Zahl, die auch Text sein kann.
OLD_STATE="an"

# Ist der Schirm an? Setzt SCHIRM auf "an", "aus" oder "unbekannt".
#
# WORTGLEICH IN scripts/mupibox/get_monitor.sh. Das ist Absicht: eine
# gemeinsame Datei muesste vom Update zuverlaessig mitkommen, und faellt sie
# aus, starten BEIDE Dienste nicht mehr. Auf einer Box, die niemand wieder
# einschalten kann, ist eine doppelte Funktion das kleinere Uebel — dass die
# beiden Fassungen gleich bleiben, prueft tools/schirm-sandkasten.py.
#
# ZWEI WEGE, IN DIESER REIHENFOLGE:
#
#   1. /sys/class/backlight/*/bl_power — 0 heisst an, alles andere (ueblich
#      ist 4) heisst aus. Auf dem Pi 5 mit DSI-Panel ist das der einzige Weg,
#      der noch etwas weiss. Lesbar auch ohne root (nachgemessen als dietpi).
#
#   2. `vcgencmd display_power` — NUR, wenn es gar keine backlight-Klasse
#      gibt. Das ist der Pi 3/4 am HDMI-Schirm, wo der Befehl noch etwas
#      weiss; deshalb fliegt er nicht raus.
#      DEN RUECKGABEWERT DARF MAN NICHT FRAGEN: der Befehl schreibt seine
#      Fehlermeldung nach stdout und endet hier mit 255, in der alten
#      Rohrleitung stand aber `grep` am Ende und lieferte 0. Geprueft wird
#      deshalb die FORM: nur genau `display_power=0` oder `display_power=1`
#      gilt. Alles andere ist "unbekannt", und bei "unbekannt" bleibt es beim
#      zuletzt bekannten Stand — lieber das Licht so lassen, wie es war, als
#      es auf eine Fehlermeldung hin umzuschalten.
#
# >>> schirm_zustand (diese Marke sucht tools/schirm-sandkasten.py)
schirm_zustand() {
	local datei wert
	for datei in /sys/class/backlight/*/bl_power; do
		[ -r "${datei}" ] || continue
		IFS= read -r wert < "${datei}" || continue
		case "${wert}" in
			0) SCHIRM="an"; return ;;
			*[0-9]*) SCHIRM="aus"; return ;;
		esac
	done

	if command -v vcgencmd >/dev/null 2>&1; then
		case "$(vcgencmd display_power 2>/dev/null)" in
			display_power=1) SCHIRM="an"; return ;;
			display_power=0) SCHIRM="aus"; return ;;
		esac
	fi

	SCHIRM="unbekannt"
}
# <<< schirm_zustand

# Eine Zahl aus der Konfiguration holen. Fehlt der Schluessel oder steht dort
# Unsinn, gilt der Ersatzwert — `printf '%d'` wuerde sonst mit "ungueltige
# Zahl" abbrechen und die Datei bliebe leer.
led_zahl() {
	local wert
	wert=$(/usr/bin/jq -r "$1" ${MUPIBOX_CONFIG} 2>/dev/null)
	case "${wert}" in
		''|null|*[!0-9]*) echo "$2" ;;
		*) echo "${wert}" ;;
	esac
}

# Das Licht ist AN, solange nicht ausdruecklich etwas anderes dasteht.
# `ledEnabled` gibt es erst seit 4.3.1; auf einer aelteren Box fehlt der
# Schluessel, und ein fehlender Schluessel darf die LED nicht ausknipsen —
# das saehe nach einem Defekt aus und gesucht wuerde am Kabel.
led_an() {
	local wert
	wert=$(/usr/bin/jq -r '.shim.ledEnabled' ${MUPIBOX_CONFIG} 2>/dev/null)
	case "${wert}" in
		false|0|"0") echo 0 ;;
		*) echo 1 ;;
	esac
}

# Ist WLED an? Liefert IMMER "true" oder "false", nie eine leere Zeile.
#
# WARUM DAS EINE EIGENE FUNKTION IST (08.08.2026, nachgemessen): hier stand
# dreimal `wled_active=$(jq -r .wled.active ${MUPIBOX_CONFIG})` — ohne
# `2>/dev/null`, anders als bei `led_zahl` und `led_an` direkt darueber, und
# der Vergleich danach war unquotiert. Ist mupiboxconfig.json nicht lesbar
# oder kein gueltiges JSON, kommt aus jq nichts heraus und die Zeile wird zu
# `[ = true ]`. GEMESSEN mit einer kaputten Konfiguration: 1 jq-Klage JE
# SEKUNDE plus je einen "Einstelliger (unaerer) Operator erwartet" bei jedem
# Schirmwechsel — rund 3600 Journalzeilen in der Stunde. Also genau die Flut,
# die am selben Tag aus dieser Datei entfernt wurde, nur durch eine Tuer, die
# offen stehengeblieben war. Das Journal liegt im Arbeitsspeicher; was dort
# hineinlaeuft, drueckt die Vorgeschichte heraus.
#
# Fehlt der Schluessel oder ist die Datei kaputt, gilt "false": WLED ist auf
# den meisten Boxen gar nicht verbaut, und ein Schreiben auf eine serielle
# Schnittstelle, die es nicht gibt, hilft niemandem.
wled_an() {
	local wert
	wert=$(/usr/bin/jq -r '.wled.active' ${MUPIBOX_CONFIG} 2>/dev/null)
	case "${wert}" in
		true) echo true ;;
		*) echo false ;;
	esac
}

# Steht der Kiosk-Browser? (E68, 20.08.2026)
#
# HIER STAND `pidof /usr/lib/chromium-browser/chromium-browser`, und das war
# GLEICH ZWEIFACH falsch: den Pfad gibt es auf dieser Box nicht (Chromium liegt
# unter /usr/bin/chromium), und seit E56 ist der Browser ueberhaupt waehlbar —
# diese Box faehrt Cog. Die Warteschleife darunter konnte also nie enden. Sie
# laeuft nur bei aktivem WLED, deshalb ist es nie jemandem aufgefallen.
#
# DAS MUSTER IST DASSELBE WIE IN led_control.py (KIOSK_MUSTER), und dort steht
# auch die Begruendung: der Name als DATEI (nicht irgendwo im Text), dahinter
# eine angesurfte Adresse — die trennt das Kiosk-Fenster von Renderer und GPU,
# die keine Adresse tragen. `chromium[a-z-]*` deckt beide Chromium-Namen ab.
#
# NICHT DEN KONFIGURATIONSWERT LESEN: chromium-autostart.sh faellt auf Chromium
# zurueck, wenn Cog nicht hochkommt. Dann staende dort `cog`, waehrend Chromium
# laeuft. Erkannt werden muessen BEIDE.
#
# Absichtlich hier UND in mupi-kiosk-heim.sh, nicht in einer gemeinsamen Datei
# — dieselbe Ueberlegung wie bei schirm_zustand weiter oben: faellt die
# gemeinsame Datei aus, starten beide Dienste nicht mehr.
kiosk_laeuft() {
	pgrep -f '(^|/)(chromium[a-z-]*|cog)[[:space:]].*https?://' >/dev/null 2>&1
}

# Den ganzen Stand in einem Zug schreiben.
#   $1 = GPIO, $2 = Helligkeit hell, $3 = Helligkeit gedimmt,
#   $4 = 1/0 an, $5 = led_dim_mode (0 = hell, 1 = gedimmt)
led_datei_schreiben() {
	/usr/bin/jq -n \
		--argjson gpio "$1" \
		--argjson hell "$2" \
		--argjson dunkel "$3" \
		--argjson an "$4" \
		--argjson dim "$5" \
		'{ led_gpio: $gpio, led_max_brightness: $hell, led_min_brightness: $dunkel,
		   led_enabled: $an, led_current_brightness: 0, led_dim_mode: $dim }' \
		> "${TMP_LEDFILE}.neu" 2>/dev/null && /bin/mv -f "${TMP_LEDFILE}.neu" "${TMP_LEDFILE}"
}

ledPin=$(led_zahl '.shim.ledPin' 13)
ledMax=$(led_zahl '.shim.ledBrightnessMax' 100)
ledMin=$(led_zahl '.shim.ledBrightnessMin' 10)
ledEnabled=$(led_an)

# Beim Start ist der Bildschirm an, also hell (0 = hell).
ledDim=0
ledDimAlt=0
led_datei_schreiben "${ledPin}" "${ledMax}" "${ledMin}" "${ledEnabled}" "${ledDim}"

/usr/bin/python3 /usr/local/bin/mupibox/led_control.py &

# WLED
wled_active=$(wled_an)
if [ "${wled_active}" = true ]; then
	wled_com_port=$(/usr/bin/jq -r .wled.com_port ${MUPIBOX_CONFIG})
	wled_main_id=$(/usr/bin/jq -r .wled.main_id ${MUPIBOX_CONFIG})
	wled_baud_rate=$(/usr/bin/jq -r .wled.baud_rate ${MUPIBOX_CONFIG})
	wled_brightness_def=$(/usr/bin/jq -r .wled.brightness_default ${MUPIBOX_CONFIG})
	while ! kiosk_laeuft; do
		sleep 3
	done
	wled_data='{"ps":'${wled_main_id}'}'
	/usr/bin/python3 /usr/local/bin/mupibox/wled_send_data.py -s ${wled_com_port} -b ${wled_baud_rate} -j ${wled_data}
	wled_data='{"bri":'${wled_brightness_def}'}'
	/usr/bin/python3 /usr/local/bin/mupibox/wled_send_data.py -s ${wled_com_port} -b ${wled_baud_rate} -j ${wled_data}
	wled_data='{"on":true}'
	/usr/bin/python3 /usr/local/bin/mupibox/wled_send_data.py -s ${wled_com_port} -b ${wled_baud_rate} -j ${wled_data}
fi

while true
do
		sleep 1
		ledPinNeu=$(led_zahl '.shim.ledPin' 13)
		ledMaxNeu=$(led_zahl '.shim.ledBrightnessMax' 100)
		ledMinNeu=$(led_zahl '.shim.ledBrightnessMin' 10)
		ledEnabledNeu=$(led_an)

		# DIE VIER WLED-WERTE NUR HOLEN, WENN WLED UEBERHAUPT AN IST. Sie
		# wurden vorher jede Sekunde gelesen und dann in aller Regel
		# weggeworfen — benutzt werden sie ausschliesslich in den beiden
		# Zweigen unten, und die laufen nur bei `wled.active = true`. Das
		# waren vier jq-Prozesse je Sekunde, rund 345 000 am Tag, auf einer
		# Box, die am Akku haengt. Gemessen: der Dienst lag bei 5,1 % CPU.
		schirm_zustand
		wled_active=$(wled_an)
		if [ "${wled_active}" = true ]; then
			wled_baud_rate=$(/usr/bin/jq -r .wled.baud_rate ${MUPIBOX_CONFIG})
			wled_com_port=$(/usr/bin/jq -r .wled.com_port ${MUPIBOX_CONFIG})
			wled_brightness_def=$(/usr/bin/jq -r .wled.brightness_default ${MUPIBOX_CONFIG})
			wled_brightness_dim=$(/usr/bin/jq -r .wled.brightness_dimmed ${MUPIBOX_CONFIG})
		fi
		if [ "${SCHIRM}" = "an" ] && [ "${OLD_STATE}" != "an" ]
		then
			if [ "${wled_active}" = true ]; then
				wled_data='{"bri":'${wled_brightness_def}'}'
				/usr/bin/python3 /usr/local/bin/mupibox/wled_send_data.py -s ${wled_com_port} -b ${wled_baud_rate} -j ${wled_data}
			fi
			# Bildschirm an = hell. 0 ist hell, 1 ist gedimmt (so lesen es
			# led_control.py und led_control.c). Bis 4.3.1 stand hier 1.
			ledDim=0
			OLD_STATE="an"
		elif [ "${SCHIRM}" = "aus" ] && [ "${OLD_STATE}" != "aus" ]
		then
			if [ "${wled_active}" = true ]; then
				wled_data='{"bri":'${wled_brightness_dim}'}'
				/usr/bin/python3 /usr/local/bin/mupibox/wled_send_data.py -s ${wled_com_port} -b ${wled_baud_rate} -j ${wled_data}
			fi
			# Bildschirm aus = gedimmt. Bis 4.3.1 stand hier 0.
			ledDim=1
			OLD_STATE="aus"
		fi

		# Nur schreiben, wenn sich wirklich etwas geaendert hat. Sonst
		# rauschte die Datei jede Sekunde durch, und der Leser daneben
		# haette nichts davon.
		if [ "${ledPinNeu}" != "${ledPin}" ] \
			|| [ "${ledMaxNeu}" != "${ledMax}" ] \
			|| [ "${ledMinNeu}" != "${ledMin}" ] \
			|| [ "${ledEnabledNeu}" != "${ledEnabled}" ] \
			|| [ "${ledDim}" != "${ledDimAlt}" ]
		then
			ledPin=${ledPinNeu}
			ledMax=${ledMaxNeu}
			ledMin=${ledMinNeu}
			ledEnabled=${ledEnabledNeu}
			ledDimAlt=${ledDim}
			led_datei_schreiben "${ledPin}" "${ledMax}" "${ledMin}" "${ledEnabled}" "${ledDim}"
		fi
done
