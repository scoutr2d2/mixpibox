#!/bin/bash
# ══ WAS DER GEWAEHLTE KIOSK-BROWSER BRAUCHT ═════════════════════════════════
#
#     mixpi-kiosk-pakete.sh cog        # holt, was Cog fehlt
#     mixpi-kiosk-pakete.sh cog --pruefen   # sagt nur, was fehlen wuerde
#
# E56, 20.08.2026. Die Box kann den Kiosk-Browser im Eltern-Bereich umstellen.
# Ein Schalter, der auf ein fehlendes Programm zeigt, ist aber kein Schalter,
# sondern eine Falle — deshalb holt DIESE Datei nach, was der gewaehlte
# Browser braucht. Sie laeuft an zwei Stellen: beim Kioskstart
# (chromium-autostart.sh, vor dem ersten Versuch) und beim Umstellen im
# Eltern-Bereich (ueber den Server). Beide Male dieselbe Datei, damit die
# Antwort auf „was fehlt?" nicht an zwei Orten auseinanderlaeuft.
#
# ══ WARUM libgles2 EIGENS DASTEHT ═══════════════════════════════════════════
# Das Paket `cog` zieht es NICHT mit. Auf der Messbox waren libegl1 und
# libegl-mesa0 da, der GLES-Lader nicht — und ohne ihn stuerzt der
# Zeichenprozess in einer Schleife ab:
#
#     Couldn't open libGLESv2.so.2: cannot open shared object file
#     Cog-Core-WARNING: Crash!: The renderer process crashed.
#
# Das Fiese daran: Cog LAEUFT weiter (der Hauptprozess lebt), meldet „Load
# started", und eine Speichermessung liefert eine schoene niedrige Zahl. Es
# ist die Zahl einer Leiche. 18 kB Paket, eine halbe Stunde Suche.
#
# ══ WAS ES NICHT TUT ════════════════════════════════════════════════════════
# Es aktualisiert NICHT das ganze System. `apt-get upgrade` auf einer Box, die
# gerade ein Kind bedient, ist keine Nebensache — hier wird genau geholt, was
# fehlt, und sonst nichts.
set -u

BROWSER="${1:-chromium}"
NUR_PRUEFEN=0
[ "${2:-}" = "--pruefen" ] && NUR_PRUEFEN=1

# Was der jeweilige Browser braucht. Chromium bringt die Box ohnehin mit —
# er ist die Vorgabe und wird hier nur der Vollstaendigkeit halber genannt.
case "${BROWSER}" in
	cog) PAKETE="cog libgles2" ;;
	chromium) PAKETE="" ;;
	*)
		echo "unbekannter Kiosk-Browser: ${BROWSER}" >&2
		exit 2
		;;
esac

fehlt() {
	# EIN PAKET GILT ALS DA, WENN dpkg es als installiert fuehrt. `command -v`
	# allein reicht nicht: libgles2 bringt kein Programm mit, nur die
	# Bibliothek — genau das Paket, an dem der Versuch haengenblieb.
	dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "ok installed" && return 1
	return 0
}

FEHLEND=""
for p in ${PAKETE}; do
	fehlt "$p" && FEHLEND="${FEHLEND} $p"
done
FEHLEND="$(echo "${FEHLEND}" | sed 's/^ *//')"

if [ -z "${FEHLEND}" ]; then
	echo "kiosk-pakete: ${BROWSER} ist vollstaendig"
	exit 0
fi

if [ "${NUR_PRUEFEN}" = "1" ]; then
	echo "kiosk-pakete: es fehlt: ${FEHLEND}"
	exit 1
fi

# OHNE NETZ GAR NICHT ERST ANFANGEN. `apt-get install` ohne Erreichbarkeit
# laeuft in lange Zeitgrenzen — und diese Datei steht beim Kioskstart VOR dem
# Bild. Eine Box, die beim Hochfahren zwei Minuten auf apt wartet, sieht
# kaputt aus.
if ! getent hosts deb.debian.org >/dev/null 2>&1; then
	echo "kiosk-pakete: kein Netz - ${FEHLEND} bleibt offen" >&2
	exit 1
fi

echo "kiosk-pakete: hole ${FEHLEND}"
export DEBIAN_FRONTEND=noninteractive

# Die Paketlisten nur auffrischen, wenn sie aelter als ein Tag sind: auf einer
# frisch eingerichteten Box sind sie neu, und ein `update` kostete dort nur
# Zeit vor dem ersten Bild.
if [ -z "$(find /var/lib/apt/lists -maxdepth 1 -name '*Packages*' -mtime -1 2>/dev/null)" ]; then
	apt-get update -qq || true
fi

# shellcheck disable=SC2086
if apt-get install -y --no-install-recommends ${FEHLEND}; then
	echo "kiosk-pakete: ${FEHLEND} eingerichtet"
	exit 0
fi

echo "kiosk-pakete: ${FEHLEND} liess sich nicht einrichten" >&2
exit 1
