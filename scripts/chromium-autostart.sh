#!/bin/dash
# ══ DIESE DATEI HEISST NACH EINEM BROWSER UND STARTET ZWEI ══════════════════
#
# Sie ist der MixPi-Kioskstarter — seit E56 (20.08.2026) waehlt sie zwischen
# Chromium und Cog. Der Name ist trotzdem geblieben, und das ist KEINE
# Nachlaessigkeit: DietPi ruft ihn fest auf.
#
#     /boot/dietpi/dietpi-login, Zeile 82:
#         exec /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh
#
# Beide Zeilen gehoeren DietPi und werden bei jedem DietPi-Update neu
# geschrieben (dietpi-software legt die Datei bei Zeile 8994 sogar selbst an).
# Wer hier auf `mixpi-kiosk.sh` umbenennt, hat beim naechsten Start eine Box
# ohne Bild UND ohne Tastatur, um es zu bemerken. Was neu dazukommt, traegt
# den MixPi-Namen (mixpi-kiosk-pakete.sh); dieser eine Name ist fremdbestimmt.
#
# Autostart script for kiosk mode, based on @AYapejian: https://github.com/MichaIng/DietPi/issues/1737#issue-318697621
#
# Chromium-parameters: https://peter.sh/experiments/chromium-command-line-switches/
#                      https://kapeli.com/cheat_sheets/Chromium_Command_Line_Switches.docset/Contents/Resources/Documents/index
# /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh
clear
/usr/local/bin/mupibox/./startup.sh &

rm ~/.config/chromium/Singleton*

CONFIG="/etc/mupibox/mupiboxconfig.json"
RES_X=$(/usr/bin/jq -r .chromium.resX ${CONFIG})
RES_Y=$(/usr/bin/jq -r .chromium.resY ${CONFIG})
DEBUG=$(/usr/bin/jq -r .chromium.debug ${CONFIG})
FORCE_GPU=$(/usr/bin/jq -r .chromium.gpu ${CONFIG})
SCROLL_ANIMATION=$(/usr/bin/jq -r .chromium.sccrollanimation ${CONFIG})
CACHE_PATH=$(/usr/bin/jq -r .chromium.cachepath ${CONFIG})
CACHE_SIZE=$(/usr/bin/jq -r .chromium.cachesize ${CONFIG})
CACHE_SIZE=$(( $CACHE_SIZE * 1024 * 1024))
KIOSK=$(/usr/bin/jq -r .chromium.kiosk ${CONFIG})
CHROMIUM_OPTS=""

# Fast feedback and process control
CHROMIUM_OPTS="--fast --fast-start --skip-gpu-data-loading"
# FORCE GPU Settings
# VERGLEICHEN, NICHT AUSFUEHREN: `jq -r` liefert bei einem FEHLENDEN Schluessel
# den Text "null". `if ${FORCE_GPU} ; then` fuehrt diesen Text dann als Kommando
# aus - "null" gibt es nicht, der Rueckgabewert ist != 0, und der ganze Block
# dahinter entfaellt STILLSCHWEIGEND. Genau so lief der Kiosk einer Box ohne
# jede Grafikbeschleunigung, ohne dass irgendwo eine Meldung stand. Dasselbe
# gilt fuer die beiden Schalter darunter.
if [ "${FORCE_GPU}" = "true" ]; then
	CHROMIUM_OPTS="${CHROMIUM_OPTS} --ignore-gpu-blocklist --enable-gpu --use-gl=egl --enable-unsafe-webgpu --enable-gpu-rasterization"
fi
# Enable smooth scrolling animation
if [ "${SCROLL_ANIMATION}" = "true" ]; then
	CHROMIUM_OPTS="${CHROMIUM_OPTS} --enable-smooth-scrolling"
else
	CHROMIUM_OPTS="${CHROMIUM_OPTS} --disable-smooth-scrolling"
fi
# Disable touch swipe back and forward gestures.
#
# UND „Seite uebersetzen?" GLEICH MIT — in DERSELBEN Option.
# Chromium bietet die Uebersetzung als Blase ueber der Seite an, sobald es
# die Sprache fuer fremd haelt. Auf einem Kiosk ist das eine Falle: das Kind
# tippt darauf, die Oberflaeche steht danach auf Englisch, und niemand
# findet den Weg zurueck. Es gibt hier auch nichts zu uebersetzen — die
# Seite kommt von der Box selbst.
#
# ZWEI `--disable-features=` WAEREN EINS: Chromium nimmt den LETZTEN Wert
# und wirft den ersten weg. Eine zweite Zeile haette also stillschweigend
# die Wischgesten-Sperre darueber aufgehoben — und die faellt erst auf,
# wenn ein Kind die Seite versehentlich zurueckwischt. Deshalb angehaengt,
# durch Komma getrennt, und nicht danebengestellt.
CHROMIUM_OPTS="${CHROMIUM_OPTS} --disable-features=OverscrollHistoryNavigation,Translate"
# Suppresses Error dialogs
CHROMIUM_OPTS="${CHROMIUM_OPTS} --noerrdialogs"
# Window Settings
CHROMIUM_OPTS="${CHROMIUM_OPTS} --window-size=${RES_X:-1280},${RES_Y:-720} --window-position=0,0"
# COLOR Parameters
CHROMIUM_OPTS="${CHROMIUM_OPTS} --cast-app-background-color=44afe2ff --default-background-color=44afe2ff"
# KIOSK Parameters
if [ "${KIOSK}" = "true" ]; then
	CHROMIUM_OPTS="${CHROMIUM_OPTS} --kiosk --start-fullscreen --start-maximized"
fi
# CACHE Parameters
CHROMIUM_OPTS="${CHROMIUM_OPTS} --disk-cache-dir=${CACHE_PATH:-/home/dietpi/.mupibox/chromium_cache} --disk-cache-size=${CACHE_SIZE:-33554432}"
# ZWEI-FINGER-ZOOM AUS.
#
# Auf einem Kinder-Beruehrschirm ist er kein Merkmal, sondern eine Falle: Zwei
# Finger auf der Scheibe sind schnell passiert, und die Seite bleibt danach
# verschoben und vergroessert stehen. Zurueck kommt man nur mit derselben
# Geste - die ein Kind nicht kennt.
#
# --disable-pinch STAND SCHON HIER, aber nur im Fehlersuch-Modus (DEBUG=1).
# Damit war er im Alltag nie an. Er gehoert nicht in die Fehlersuche, sondern
# in den Normalbetrieb.
CHROMIUM_OPTS="${CHROMIUM_OPTS} --disable-pinch"

# DEBUG MODE
if [ "${DEBUG}" = "1" ]; then
	CHROMIUM_OPTS="${CHROMIUM_OPTS} --enable-logging --v=1"
fi
# Spotify Web Playback SDK Support
CHROMIUM_OPTS="${CHROMIUM_OPTS} --autoplay-policy=no-user-gesture-required"

# If you want tablet mode, uncomment the next line.
#CHROMIUM_OPTS+=' --force-tablet-mode --tablet-ui'
# Home page

# RPi or Debian Chromium package
FP_CHROMIUM=$(command -v chromium-browser)
[ "$FP_CHROMIUM" ] || FP_CHROMIUM=$(command -v chromium)

# Use "startx" as non-root user to get required permissions via systemd-logind
STARTX='xinit'
[ "$USER" = 'root' ] || STARTX='startx'

#sudo nice -n -19 sudo -u dietpi xinit "$FP_CHROMIUM" $CHROMIUM_OPTS --homepage "${URL:-http://MuPiBox:8200}" -- -nocursor tty2 &

# The backend (:8200) serves the app. Wait for it to come up before loading it —
# that probing is the point of the loop below (first-boot race between kiosk and
# backend).
#
# ACHTUNG, HIER STAND EINE BEGRUENDUNG, DIE ZWEIMAL FALSCH IST — und wer sie
# "repariert", macht die Box fabrikneu (gemessen 2026-08-04, BACKLOG E22/R4):
#
#   "preferring https (needed so Spotify accepts the redirect URI)"
#
# 1. DER https-ZWEIG GREIFT NIE. Er probiert https://localhost:8200 — dort liegt
#    gar kein TLS. Gemessen: https://localhost:8200 -> 000, http://localhost:8200
#    -> 200, https://localhost:8443 -> 200. Die Probe fragt den falschen Port.
# 2. DER GRUND DAFUER IST WEG. Seit E22/R1 schickt die Einrichtungsseite eine
#    FESTE redirect_uri (http://127.0.0.1:8200/spotify) und ist selbst gar kein
#    Rueckweg mehr — unter welcher Adresse der Kiosk laeuft, ist Spotify egal.
#    Und haette der Zweig gegriffen, waere er trotzdem falsch: https://LOCALHOST
#    verbietet Spotify ebenso.
#
# ALSO NICHT AUF 8443 ODER 127.0.0.1 UMBIEGEN. Der Kiosk laeuft heute auf
# http://localhost:8200, und localStorage haengt an der HERKUNFT. An der Box
# ausgelesen (2026-08-04) lagen dort mupibox_darstellung_v1, _media_cache_v2,
# _neu_licht_v1, _p_gast_neu_zuletzt_v1, _spielzeit_v1 — das ist der Bestand
# EINER Box, nicht die Liste. Ein Umzug muss JEDEN mupibox_*-Schluessel der
# Herkunft mitnehmen (_favorites_v1, _themen_v1, _jellyfin_cfg schreibt die App
# ebenfalls); ohne Uebernahme sieht die Box fabrikneu aus. Eigenes Vorhaben,
# keine Zeilenaenderung. Siehe [[oberflaeche-speicherschluessel]] und
# [[spotify-rueckweg-haengt-an-der-adresse]].
#
# --ignore-certificate-errors is harmless over http and was required for the
# self-signed cert over https.
CHROMIUM_OPTS="${CHROMIUM_OPTS} --ignore-certificate-errors"
# Rollbalken ausblenden. Steht auf der Box seit laengerem, fehlte hier — beim
# Ausrollen am 2026-07-31 aufgefallen. Auf einem Beruehrschirm ohne Maus sind
# sie sinnlos und nehmen Platz weg.
CHROMIUM_OPTS="${CHROMIUM_OPTS} --hide-scrollbars"
MUPI_URL="http://localhost:8200"
i=0
while [ "$i" -lt 30 ]; do
	i=$((i + 1))
	if curl -k -s -o /dev/null --max-time 2 https://localhost:8200; then
		MUPI_URL="https://localhost:8200"
		break
	elif curl -s -o /dev/null --max-time 2 http://localhost:8200; then
		MUPI_URL="http://localhost:8200"
		break
	fi
	sleep 1
done

# EINE OBERFLAECHE (E118/1d, 05.09.2026). Hier stand der Schalter
# mupibox.oberflaeche (klassisch/neu, Vorgabe klassisch) aus der
# Erprobungszeit der neuen Oberflaeche. Die Erprobung ist vorbei: die alte
# App faellt (Betreiber: "doppel wartung macht kein sinn"), und eine
# Vorgabe "klassisch" haette jede Box mit fehlendem Schluessel nach der
# Loeschung auf ein leeres www/ geschickt. Der Server leitet / ohnehin
# nach /neu/ um — die feste Adresse hier erspart den Umweg.
MUPI_URL="${MUPI_URL}/neu/"
echo "Oberflaeche: ${MUPI_URL}"

# ══ WELCHER BROWSER? mupibox.kioskBrowser entscheidet (E56, 20.08.2026) ══════
#
#   "chromium" (Vorgabe, auch bei fehlendem Schluessel) -> wie bisher, mit X
#   "cog"                                               -> Cog/WPE direkt auf
#                                                          DRM, ohne X-Server
#
# WAS ES BRINGT, an dieser Box gemessen (Pi 5, 800x480 ueber DSI-2):
#     Chromium + Xorg   511 MB PSS, 8 Prozesse plus X-Server
#     Cog auf DRM       331 MB PSS, 6 Prozesse, kein X-Server
# also 180 MB. Auf einer 2-GB-Box ist das die knappe Ware.
#
# NACHGEMESSEN AM 19.09.2026 — die Spanne ist 180 bis 230 MB, und WARUM sie
# eine Spanne ist, gehoert dazu: Die Chromium-Haelfte haengt am ABSTAND zum
# Kiosk-Start. Frisch gestartet sind es rund 540 MB PSS, nach einer halben
# Stunde 462, nach 35 Minuten flach bei ~458. Die Zahl oben stammt aus einer
# Messung 60 bis 180 Sekunden nach dem Neustart, meine aus dem eingeschwungenen
# Zustand — dieselbe Chromium-Fassung (chromium.list traegt unveraendert den
# 11.08.2026), nur ein anderer Punkt auf derselben Kurve.
#
# WER EINE EINZELZAHL WEITERREICHT, irrt sich also um bis zu 80 MB. Und wer
# mit `pgrep -f` misst, zaehlt die eigene Messschale mit — genau das tut
# tools/kiosk-benchmark.py (Zeile 234) und kommt deshalb auf zwei Prozesse
# mehr als tools/kiosk-pss-messen.py, das ueber /proc/<pid>/comm aufzaehlt.
#
# UND DER BROWSER IST ABGEKUENDIGT (Stand 19.09.2026): Igalia/cog#799, keine
# stabilen Fassungen ueber 0.18.x; der Nachfolger WPEPlatform ist fuer Trixie
# NICHT beschaffbar (nur Sid, scheitert an libc6). Details in
# AUDIT-2026-09-19-WPE.md; tools/wpe-nachfolge-pruefen.py --lage meldet, wenn
# sich daran etwas dreht. Die Cog-Haelfte der Messung ist dabei die
# haltbarere: cog 0.18.4 und libwpewebkit 2.48.3 liegen seit 20.08.2026
# unveraendert auf der Box.
#
# WAS ES KOSTET: Cog bringt WebKit statt Blink mit. Erweiterungen gibt es
# nicht, die Fehlersuche laeuft nicht ueber CDP, und Bedienelemente koennen
# sich anders verhalten — zwei solche Faelle sind in der Oberflaeche bereits
# behoben (llmwiki webkit-zieht-den-reglergriff-nicht,
# webkit-button-flex-streckt-nicht). Wer hier umstellt, prueft danach die
# Oberflaeche mit dem FINGER, nicht nur die Speicherzahl.
#
# `-O renderer=gles` IST NICHT OPTIONAL. Ohne den Schalter nimmt Cog den
# modeset-Renderer: das Bild wird gezeichnet, aber nie umgeschaltet, und auf
# dem Schirm stehen STREIFEN. Eine Umgebungsvariable dafuer gibt es NICHT
# (COG_PLATFORM_DRM_RENDERER existiert nicht und faellt still durch).
KIOSK_BROWSER="$(/usr/bin/jq -r '.mupibox.kioskBrowser // "chromium"' "${CONFIG}" 2>/dev/null || echo chromium)"
FP_COG=$(command -v cog)

# ── DER BROWSER BEKOMMT EINEN WEG ZUM TON (20.09.2026) ──────────────────────
#
# Betreiber, nach dem ersten Belohnungs-Video: „beim spielen vom video gibt es
# keinen ton." Bild lief, Ton nicht — waehrend die Box daneben ein Hoerspiel
# spielte.
#
# DIE URSACHE IST NICHT DER TON DER BOX, SONDERN DIE SITZUNG. Dieses Skript
# laeuft aus der Autostart-Kette von DietPi als ROOT (siehe Kopf: dietpi-login
# ruft es auf), PipeWire ist aber ein SITZUNGSDIENST von `dietpi` und haelt
# seine Sockets unter /run/user/1000/. Der Browser fand unter /run/user/0/
# nichts, fiel auf ALSA zurueck — und dort haelt PipeWire die Karte. Er hatte
# damit GAR KEINE Tonausgabe. Gemessen am 20.09.2026 mit
# tools/box/kiosk-ton-probe.py: „PULSE_SERVER (nicht gesetzt),
# XDG_RUNTIME_DIR /run/user/0".
#
# ES FIEL JAHRELANG NICHT AUF, weil nichts im Browser je Ton machte: Musik
# kommt aus mpv/librespot, und das Vorlesen spielt seit E123 der SERVER. Das
# Video ist der ERSTE Ton aus dem Browser dieser Box.
#
# ROOT DARF AUF DEN FREMDEN SOCKET: /run/user/1000 ist 0700, aber root umgeht
# die Rechtepruefung. Am Geraet probiert, nicht behauptet — `pactl info` ueber
# genau diesen Weg antwortet mit „Default Sink: klangwerk". Eine Anmeldung
# (PULSE_COOKIE) verlangt der PipeWire-Pulse-Server dabei nicht.
#
# WARUM NICHT GLEICH DEN KIOSK ALS BENUTZER FAHREN (llmwiki
# mupi-kiosk-als-dietpi-anleitung)? Das ist der richtige grosse Weg, aber er
# ruehrt an X, Autologin und DSI. Eine Tonfrage ist kein Anlass, die Bootkette
# umzubauen; diese drei Zeilen sind klein, zurueckdrehbar und wirken sofort.
#
# NUR, WENN ES AUCH ETWAS ZU TREFFEN GIBT: zeigt die Variable auf einen Socket,
# den es nicht gibt, sucht libpulse ihn und faellt erst danach zurueck. Eine
# Box ohne laufendes PipeWire waere damit beim Start langsamer, ohne dass
# jemand etwas davon haette.
BOXNUTZER_UID="$(id -u "${BOXNUTZER:-dietpi}" 2>/dev/null || echo)"
if [ -n "${BOXNUTZER_UID}" ] && [ -S "/run/user/${BOXNUTZER_UID}/pulse/native" ]; then
	export PULSE_SERVER="unix:/run/user/${BOXNUTZER_UID}/pulse/native"
	echo "Kiosk-Browser: Tonweg ${PULSE_SERVER}"
fi

# NUR MIT ALLEM, WAS ER BRAUCHT. Fehlt das Programm oder der GLES-Lader, wird
# nachgeholt — aber NUR, wenn ein Netz da ist und die Nachinstallation zuegig
# gelingt. Sie steht VOR dem Start und nicht danach, damit eine frisch
# umgestellte Box beim ersten Hochfahren schon richtig laeuft.
if [ "${KIOSK_BROWSER}" = "cog" ]; then
	if [ -x /usr/local/bin/mupibox/mixpi-kiosk-pakete.sh ]; then
		/usr/local/bin/mupibox/mixpi-kiosk-pakete.sh cog || true
		FP_COG=$(command -v cog)
	fi
fi

# DER RUECKFALL IST DER GRUND, WARUM MAN DAS UEBERHAUPT ANBIETEN DARF.
# Diese Box hat keine Tastatur. Startet Cog nicht — fehlendes Paket, fremde
# Hardware, kaputte Anzeige —, dann steht ein Kind vor einem schwarzen
# Schirm, und niemand kann etwas eintippen. Also: Cog bekommt seine Chance,
# und wenn er sie binnen weniger Sekunden nicht nutzt, kommt Chromium.
if [ "${KIOSK_BROWSER}" = "cog" ] && [ -n "${FP_COG}" ]; then
	echo "Kiosk-Browser: cog (DRM, ohne X-Server) -> ${MUPI_URL}"
	"$FP_COG" -O renderer=gles --platform=drm "${MUPI_URL}" &
	COG_PID=$!
	# Fuenf Sekunden sind gemessen und nicht geraten: im Versuch stand
	# "Loaded successfully" nach 0,4 s, und ein Fehlstart (fehlendes
	# libGLESv2.so.2) beendete den Prozess sofort.
	i=0
	while [ "$i" -lt 5 ]; do
		i=$((i + 1))
		kill -0 "${COG_PID}" 2>/dev/null || break
		sleep 1
	done
	if kill -0 "${COG_PID}" 2>/dev/null; then
		echo "Kiosk-Browser: cog laeuft (PID ${COG_PID})"
	else
		echo "Kiosk-Browser: cog kam nicht hoch - Rueckfall auf Chromium"
		KIOSK_BROWSER="chromium"
	fi
elif [ "${KIOSK_BROWSER}" = "cog" ]; then
	echo "Kiosk-Browser: cog gewaehlt, aber nicht installiert - Rueckfall auf Chromium"
	KIOSK_BROWSER="chromium"
fi

if [ "${KIOSK_BROWSER}" != "cog" ]; then
	exec "$STARTX" "$FP_CHROMIUM" $CHROMIUM_OPTS --homepage "${MUPI_URL}" -- -nocursor tty2 &
fi

# BLUETOOTH
pactl load-module module-bluetooth-discover

# ══ FERNBLICK NUR ÜBER DEN SSH-TUNNEL (E48, 19.08.2026) ═════════════════════
#
# Hier stand `x11vnc -ncache 10 -forever -display :0 &` — ohne -localhost und
# ohne Passwort. GEMESSEN an der laufenden Box:
#
#     LISTEN 0 32 0.0.0.0:5900   und   ps: x11vnc -ncache 10 -forever -display :0
#     kein ~/.vnc, also kein -rfbauth
#
# Das heißt: JEDER im WLAN konnte den Bildschirm des Kindes sehen UND
# bedienen — Tastatur und Maus inbegriffen. Auf einer Kinderbox ist das
# nicht bloß eine offene Tür, es ist die falsche Tür.
#
# `-localhost` bindet auf 127.0.0.1. Wer hinsehen will, baut den Tunnel:
#
#     ssh -L 5900:localhost:5900 dietpi@<box>     dann VNC auf localhost:5900
#
# Damit hängt der Zugang an demselben SSH-Schlüssel, über den ohnehin
# ausgeliefert wird — eine Berechtigung statt zwei.
#
# ABSCHALTEN GEHT ÜBER DIE KONFIGURATION: mupibox.vnc auf false, und der
# Fernblick startet gar nicht erst. Vorgabe bleibt an, damit sich für
# niemanden etwas ändert außer der Bindung.
VNC_AN=$(/usr/bin/jq -r '.mupibox.vnc // true' ${CONFIG} 2>/dev/null)
if [ "${VNC_AN}" != "false" ]; then
	x11vnc -localhost -ncache 10 -forever -display :0 &
fi

# START SOUND
START_SOUND=$(/usr/bin/jq -r .mupibox.startSound ${CONFIG})
START_VOLUME=$(/usr/bin/jq -r .mupibox.startVolume ${CONFIG})
AUDIO_DEVICE=$(/usr/bin/jq -r .mupibox.audioDevice ${CONFIG})
# STARTLAUTSTAERKE UEBER DEN EINEN WEG (BACKLOG E12/X7).
# Hier stand `pactl set-sink-volume @DEFAULT_SINK@ ${START_VOLUME}%` — dieselbe
# Senke, aber OHNE die Obergrenze aus mupibox.maxVolume. Stand startVolume
# hoeher als maxVolume, war die Box beim Einschalten lauter, als die Eltern
# erlaubt hatten; erst der naechste Griff an den Regler zog sie herunter.
# Der Rueckfall haelt Boxen bedienbar, auf denen das Werkzeug fehlt — aber er
# darf weder die Grenze reissen noch die Vorgabe-Senke treffen (05.09.2026):
# @DEFAULT_SINK@ ist seit dem 21.08. das klangwerk (eine Durchreiche), und ein
# roher Nutzerwert ohne maxVolume-Klemme war genau der Fehler, der oben schon
# einmal beschrieben steht. Deshalb: selbe Skala wie nutzer_zu_echt (Wert x
# Grenze / 100) und als Ziel die ERSTE ECHTE Karte (alsa_output-Praefix).
if ! /usr/local/bin/mupibox/mupi-lautstaerke.sh set ${START_VOLUME}; then
  MAXV=$(/usr/bin/jq -r '.mupibox.maxVolume // 100' ${CONFIG} | grep -o '^[0-9]*')
  case "$MAXV" in ''|*[!0-9]*) MAXV=100 ;; esac
  [ "$MAXV" -gt 100 ] && MAXV=100
  ECHT=$(( ${START_VOLUME:-25} * MAXV / 100 ))
  KARTE=$(/usr/bin/pactl list sinks short 2>/dev/null | /usr/bin/awk '$2 ~ /^alsa_output\./ {print $2; exit}')
  [ -n "$KARTE" ] && /usr/bin/pactl set-sink-volume "$KARTE" "${ECHT}%"
fi
/usr/bin/mplayer -volume 100 ${START_SOUND} &
pgrep -f "chromium-browser" | while read -r pid; do
    # Setze die Priorität für jeden Prozess neu
    sudo renice -n -10 -p "$pid"
done
pgrep -f "node	" | while read -r pid; do
    # Setze die Priorität für jeden Prozess neu
    sudo renice -n -10 -p "$pid"
done
sleep 5
pgrep -f "chromium-browser" | while read -r pid; do
    # Setze die Priorität für jeden Prozess neu
    sudo renice -n -10 -p "$pid"
done
clear

# DSI-AUSGANG ERZWINGEN — sonst bleibt das Panel schwarz.
#
# Kommt vom remote-step-installer (tools/force-dsi-output.sh, eingehaengt vom
# Schritt 'kiosk'). Die Zeile stand auf der Box, aber NICHT hier: Wer dieses
# Skript aus dem Repo ausrollt, haette sie entfernt und beim naechsten Start
# einen schwarzen Bildschirm gehabt — und die Schuld haette die zuletzt
# geaenderte Oberflaeche bekommen.
[ -x /usr/local/bin/mupibox/force-dsi-output.sh ] && /usr/local/bin/mupibox/force-dsi-output.sh &
