#!/bin/bash
#
# ══════════════════════════════════════════════════════════════════════════════
#  STILLGELEGT AM 08.08.2026 — DIESES SKRIPT ERSETZT MIXPIBOX DURCH DAS ORIGINAL
# ══════════════════════════════════════════════════════════════════════════════
#
# WAS ES TUT, wenn man es laesst: Es holt version.json und das Archiv von
# github.com/splitti/MuPiBox (Zeilen 395/399/592), macht `rm -R` auf den
# ganzen Anwendungsbaum (:655) und packt UPSTREAMS deploy.zip aus (:657).
# Danach laeuft auf der Box das Original — nicht dieser Fork.
#
# WARUM ES TROTZDEM NOCH DASTEHT: In ihm steckt die ganze Arbeit, die dieser
# Baum am Update-Weg geleistet hat und die anderswo gebraucht wird — die
# Vor-Update-Sicherung (:302), der Bestandshort (:99/:233), das 64-Bit-Tor
# (:381), die librespot-Verzweigung (:905). Wer den MixPi-Weg baut, liest hier
# nach. Geloescht waere es eine verlorene Begruendungssammlung.
#
# DER RIEGEL IST EINE FRAGE UND KEIN VERBOT: Wer weiss, was er tut (etwa um
# eine Box absichtlich auf die Serienfassung zurueckzusetzen), setzt
# MUPI_ZURUECK_ZUM_ORIGINAL=1. Ohne das bricht es ab, bevor es irgendetwas
# anfasst.
#
# DER WEG FUER NEUE FASSUNGEN laeuft heute am Laptop:
#     python3 tools/ausliefern.py --nur www      (Oberflaeche)
#     python3 tools/ausliefern.py                (Server, Player, www, admin)
#
if [ "${MUPI_ZURUECK_ZUM_ORIGINAL:-0}" != "1" ]; then
	echo "STILLGELEGT. Dieses Skript holt den Code von splitti/MuPiBox und wuerde" >&2
	echo "MixPiBox durch die Serienfassung ersetzen -- samt 'rm -R' auf den" >&2
	echo "Anwendungsbaum. Neue Fassungen kommen ueber tools/ausliefern.py vom" >&2
	echo "Laptop." >&2
	echo >&2
	echo "Wer eine Box ABSICHTLICH auf das Original zuruecksetzen will:" >&2
	echo "    MUPI_ZURUECK_ZUM_ORIGINAL=1 $0 $*" >&2
	exit 1
fi

#https://raw.githubusercontent.com/splitti/MuPiBox/main

if [ "$1" = "dev" ] || [ "$1" = "beta" ] || [ "$1" = "stable" ]; then
	RELEASE="$1"
elif [ "$1" = "branch" ]; then
  RELEASE="dev"
  BRANCH="$2"
  if [ -z "$BRANCH" ]; then
    echo "Error: Branch name is required when using branch install"
    exit 1
  fi
  BRANCH_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/splitti/MuPiBox/branches/${BRANCH})
  if [ "$BRANCH_EXISTS" != "200" ]; then
    echo "Error: Branch '${BRANCH}' does not exist on GitHub"
    exit 1
  fi
else
	RELEASE="stable"
fi
killall -s 9 -w -q -r chromium

CONFIG="/etc/mupibox/mupiboxconfig.json"
LOG="/boot/mupibox_update.log"
exec 3>${LOG}

# >>> MUPI-BESTAND-WERKZEUG-ANFANG >>>
# (Die Marken liest tools/update-bestand-probe.py. Nicht umbenennen.)
#
# ── DER BESTAND UEBERLEBT DAS UPDATE — NICHT DREI DATEIEN DAVON (F8) ───────
#
# WAS HIER VORHER STAND UND WARUM ES DIE KINDER GEKOSTET HAETTE:
# Weiter unten wird das ganze Verzeichnis Sonos-Kids-Controller-master mit
# `rm -R` weggeraeumt und aus deploy.zip neu ausgepackt. Das ist fuer den CODE
# richtig — ein Angular-Bau laesst sonst die chunk-*.js des Vorgaengers liegen.
# Es ist fuer die DATEN toedlich: darunter liegt server/config, und das ist
# alles, was der Box gehoert. Gerettet wurden davon genau drei Dinge
# (data.json, www/cover, www/active_theme.css). Am 07.08.2026 an der laufenden
# Box nachgezaehlt: server/config hat 20 Eintraege. 19 waeren gefallen —
# profile.json (die KINDER SELBST), profile/<kennung>/ mit Weiterhoeren,
# Verlauf, eigenen Listen, Hoerzeit-Konto und Medienauswahl je Kind, dazu
# kinderzeit.json, darstellung.json, vorlesen.json, verschmelzung.json,
# wlan.json, network.json, akkuverlauf.json, verfuegbarkeit.json,
# offline_*.json und die 434 Titelbilder in coverspeicher/.
#
# UND EINE DER DREI RETTUNGEN GRIFF INS LEERE: `www/cover` gibt es auf dieser
# Box nicht mehr. Die Titelbilder liegen seit E15 unter
# `server/config/coverspeicher` (src/backend-api/src/server.ts, COVER_SPEICHER)
# — also INNERHALB des geloeschten Verzeichnisses. Die Zeile sah aus, als
# wirkte sie, und tat nichts. Genau so laufen von Hand gepflegte Listen
# auseinander; deshalb wird hier keine Liste verlaengert.
#
# DIE UMKEHRUNG: nicht aufzaehlen, was gerettet wird, sondern das GANZE
# Datenverzeichnis zur Seite legen und danach zurueckstellen. Was morgen dazu
# kommt, ist automatisch dabei. Aufzaehlen muss man nur noch, was AUSSERHALB
# von server/config liegt und trotzdem der Box gehoert — heute genau eine
# Datei, und tools/update-bestand-probe.py wird ROT, wenn eine zweite entsteht,
# die hier niemand nachgetragen hat.
#
# NICHT MEHR NACH /tmp. /tmp ist auf dieser Box ein tmpfs (gemessen: 1005M,
# RAM). Der alte Weg legte die Bibliothek und 434 Titelbilder fuer die Dauer
# des Updates in den Arbeitsspeicher — ein Stromausfall dazwischen hat sie
# ersatzlos verloren, und bei genug Bildern haette der Umzug den Speicher
# gefuellt. Der Hort liegt jetzt neben dem Baum auf derselben Platte.
#
# STROMAUSFALL — was passiert in welchem Augenblick:
# Beiseitelegen und Zurueckstellen sind je EIN `mv` INNERHALB von
# /home/dietpi/.mupibox, also rename(2): unteilbar. Der Bestand ist zu jedem
# Zeitpunkt entweder ganz im Baum oder ganz im Hort, nie halb. Faellt der Strom
# irgendwo dazwischen, liegt er vollstaendig im Hort — und der Hort ueberlebt
# den Neustart, weil er auf der Platte liegt. Beim naechsten Lauf holt ihn die
# Wiederaufnahme weiter unten als ERSTES zurueck, VOR der Sicherung und vor
# jeder Loeschung. Das Update ist damit wiederholbar: ein abgebrochener Lauf
# hinterlaesst keinen Stand, aus dem man nicht mehr herauskommt.
# Und wenn das Beiseitelegen scheitert, wird NICHT geloescht (siehe unten) —
# dann bleibt die Box vollstaendig auf dem alten Stand statt auf keinem.
MUPI_BAUM="${MUPI_BAUM:-/home/dietpi/.mupibox/Sonos-Kids-Controller-master}"
MUPI_HORT="${MUPI_HORT:-/home/dietpi/.mupibox/.update-bestand}"
MUPI_ABBRUCH="${MUPI_ABBRUCH:-/home/dietpi/.mupibox/.update-abgebrochen}"

# WAS AUSSERHALB VON server/config LIEGT UND TROTZDEM DER BOX GEHOERT.
# Pfade unterhalb von ${MUPI_BAUM}. Wer hier etwas ergaenzt, muss es auch in
# tools/update-bestand-probe.py nicht nachtragen — das Werkzeug liest DIESE
# Zeile. Es meldet umgekehrt, wenn im Quelltext eine Schreibstelle auftaucht,
# die weder unter server/config noch hier steht.
#   www/active_theme.css  Verweis auf das gewaehlte Farbthema. Kein Bauergebnis
#                         (src/backend-api/src/server.ts sagt das ausdruecklich),
#                         verschwindet also mit dem ausgetauschten www/.
#   www/cover             die ALTE Lage der Titelbilder. Auf dieser Box laengst
#                         leer; eine Box, die den Umzug nach coverspeicher noch
#                         nicht gemacht hat, hat sie aber noch. Steht mit
#                         Da-Sein-Pruefung hier, damit sie NICHT faellt.
MUPI_BESTAND_AUSSEN=("www/active_theme.css" "www/cover")

# Ist das ein brauchbarer Eintrag fuer MUPI_BESTAND_AUSSEN?
#
# WARUM DAS HIER STEHT: weiter unten steht ein `rm -rf "${MUPI_BAUM}/${pfad}"`.
# Ein leerer oder mit `/` beginnender Eintrag machte daraus ein `rm -rf` auf
# den ganzen Baum oder auf das Wurzelverzeichnis. Das ist kein ausgedachter
# Fall: ein Tippfehler beim Nachtragen einer neuen Ablage reicht, und die
# Zeile daneben ist genau die, die diese Reparatur ueberhaupt noetig gemacht
# hat. Ein `..` waere derselbe Fehler mit mehr Schritten.
mupi_pfad_brauchbar() {
	case "$1" in
		"" | /* | *"/../"* | */.. | ../*) return 1 ;;
	esac
	return 0
}

# WARUM DER ABBRUCH SAGEN MUSS, WORAN ES LAG (nachgetragen 07.08.2026).
#
# Gemessen mit tools/update-frische-box-probe.sh: von den vier Lagen, in denen
# `mupi_bestand_beiseite` abbricht, ist genau EINE ein „das mv ist
# fehlgeschlagen" — die drei anderen heissen „es gibt hier nichts beiseite zu
# legen". Der Aufrufer schrieb aber in jedem Fall denselben Satz auf den
# Schirm: „server/config liess sich nicht nach … legen."
#
# Wer das liest, sucht nach einem vollen Datentraeger oder nach Rechten und
# findet nichts — dabei fehlt bloss ein Verzeichnis. Ein Abbruch, der nicht
# sagt, woran es lag, ist derselbe Fehler wie ein Regler, der eine Zahl zeigt,
# die nicht gilt: man sieht, DASS etwas ist, und kommt nicht dahinter.
#
# DIE ENTSCHEIDUNG SELBST BLEIBT. Abgebrochen wird weiterhin, und zwar auch
# dann, wenn scheinbar nichts zu verlieren ist: ein `server/`, in das man
# gerade nicht hineinsehen kann, ist von einem `server/`, in dem nichts steht,
# von aussen nicht zu unterscheiden — und die falsche Antwort darauf kostet
# die Kinder. Was sich aendert, ist nur der Satz.
MUPI_BESTAND_GRUND=""

# Legt den Bestand beiseite. 0 = er liegt im Hort. 1 = ABBRUCH, nichts loeschen.
mupi_bestand_beiseite() {
	MUPI_BESTAND_GRUND=""
	if ! mkdir -p "${MUPI_HORT}"; then
		MUPI_BESTAND_GRUND="Der Hort ${MUPI_HORT} liess sich nicht anlegen (voller Datentraeger? Rechte?)."
		return 1
	fi
	# `-d` ALLEIN REICHT NICHT: es folgt Verweisen. Ein Verweis auf ein
	# fremdes Verzeichnis waere damit „liegt schon richtig" — und `zurueck`
	# schoebe hinterher den VERWEIS als server/config in den Baum, waehrend der
	# echte Bestand mit dem `rm -R` gefallen ist. Deshalb zusaetzlich `! -L`:
	# hier zaehlt nur ein WIRKLICHES Verzeichnis.
	if [ -d "${MUPI_HORT}/config" ] && [ ! -L "${MUPI_HORT}/config" ]; then
		# Aus einem abgebrochenen Lauf. Liegt schon richtig, nicht anfassen —
		# ein zweites `mv` schoebe den frischen Baum IN den alten Hort hinein.
		:
	elif [ -e "${MUPI_HORT}/config" ] || [ -L "${MUPI_HORT}/config" ]; then
		# ── HIER STAND `-e` STATT `-d`, UND DAS WAR EIN DATENVERLUST ────────
		#
		# `-e` ist wahr fuer ALLES, was existiert. Die andere Haelfte,
		# `mupi_bestand_zurueck`, fragt aber `-d`. Lag an dieser Stelle etwas,
		# das KEIN Verzeichnis ist — eine gewoehnliche Datei, ein Verweis —,
		# dann lief das hier auseinander:
		#
		#   1. `beiseite` glaubte, der Bestand liege schon im Hort, und liess
		#      ${MUPI_BAUM}/server/config stehen,
		#   2. das `rm -R` des Updates loeschte ihn mit dem Baum,
		#   3. `zurueck` fand kein Verzeichnis und stellte nichts zurueck.
		#
		# Beide Haelften meldeten dabei Erfolg (0). Gemessen mit
		# tools/durchkommen-update.sh: von sechs Stuecken kamen zwei zurueck,
		# server/config war vollstaendig weg — genau die stille Bauart, gegen
		# die dieser ganze Block gebaut ist. Bei einem VERWEIS auf ein fremdes
		# Verzeichnis kam es noch dicker: `zurueck` schob den fremden Verweis
		# als ${MUPI_BAUM}/server/config in den Baum.
		#
		# Jetzt ist es ein harter Halt mit Grund. Weitermachen hiesse `rm -R`
		# auf einen Bestand, fuer den es keinen Hort gibt.
		MUPI_BESTAND_GRUND="${MUPI_HORT}/config gibt es, aber es ist kein Verzeichnis. Dorthin gehoert der beiseitegelegte Bestand eines abgebrochenen Laufs; was dort sonst liegt, kann niemand zurueckstellen. Weitermachen hiesse \`rm -R\` auf einen Bestand ohne Hort. Nachsehen und den Fremdkoerper wegraeumen (oder, wenn es doch der Bestand ist, in ein Verzeichnis ${MUPI_HORT}/config legen)."
		return 1
	elif [ -d "${MUPI_BAUM}/server/config" ]; then
		if ! mv "${MUPI_BAUM}/server/config" "${MUPI_HORT}/config"; then
			MUPI_BESTAND_GRUND="${MUPI_BAUM}/server/config liess sich nicht nach ${MUPI_HORT}/config verschieben (voller Datentraeger? Rechte? andere Platte?)."
			return 1
		fi
	elif [ ! -d "${MUPI_BAUM}" ]; then
		# Der Baum selbst fehlt. Das ist keine benutzte Box.
		MUPI_BESTAND_GRUND="Den Baum ${MUPI_BAUM} gibt es nicht. Dieses Skript aktualisiert eine bestehende Installation; eine neue legt autosetup an."
		return 1
	else
		# WEDER HIER NOCH DORT. Das ist kein Grund weiterzumachen: entweder ist
		# der Baum schon kaputt, oder der Pfad stimmt nicht mehr. In beiden
		# Faellen waere `rm -R` die schlechteste aller Antworten.
		MUPI_BESTAND_GRUND="Es gibt kein ${MUPI_BAUM}/server/config. Die Box hat dann entweder noch nie gelaufen, oder das Verzeichnis wurde weggeraeumt, oder es ist gerade nicht lesbar. Weitermachen hiesse \`rm -R\` auf einen Baum, von dem niemand weiss, was darin steht — deshalb passiert hier nichts. Ist die Box vorher normal gelaufen, hilft ein einmaliger Start; steht dort wirklich nichts, legt ein leeres ${MUPI_BAUM}/server/config den Weg frei."
		return 1
	fi
	local pfad name
	for pfad in "${MUPI_BESTAND_AUSSEN[@]}"; do
		if ! mupi_pfad_brauchbar "${pfad}"; then
			MUPI_BESTAND_GRUND="Der Eintrag \"${pfad}\" in MUPI_BESTAND_AUSSEN ist unbrauchbar (leer, absolut oder mit \`..\`)."
			return 1
		fi
		name="${pfad//\//_}"
		# `-e` ALLEIN REICHT NICHT, und daran waere es fast gescheitert:
		# `www/active_theme.css` ist ein VERWEIS auf themes/<Name>.css, und
		# `[ -e ]` folgt dem Verweis. Zeigt er gerade ins Leere — genau der
		# Zustand, in dem man ihn am dringendsten braucht —, meldet `-e`
		# "gibt es nicht", die Datei bliebe liegen und faele mit dem `rm -R`.
		# Der Sandkasten (tools/update-bestand-probe.py) hat das gefunden.
		if [ -e "${MUPI_HORT}/${name}" ] || [ -L "${MUPI_HORT}/${name}" ]; then continue; fi
		if [ ! -e "${MUPI_BAUM}/${pfad}" ] && [ ! -L "${MUPI_BAUM}/${pfad}" ]; then continue; fi
		if ! mv "${MUPI_BAUM}/${pfad}" "${MUPI_HORT}/${name}"; then
			MUPI_BESTAND_GRUND="${MUPI_BAUM}/${pfad} liess sich nicht nach ${MUPI_HORT}/${name} verschieben."
			return 1
		fi
	done
	return 0
}

# Stellt den Bestand zurueck. 0 = der Baum ist vollstaendig. 1 = Hand anlegen.
# WIEDERHOLBAR: zweimal aufgerufen tut der zweite Aufruf nichts.
mupi_bestand_zurueck() {
	[ -d "${MUPI_HORT}" ] || return 0
	# Auch hier `! -L` (siehe `mupi_bestand_beiseite`): ein Verweis an dieser
	# Stelle ist nicht der Bestand, sondern etwas Fremdes. Er wird NICHT in den
	# Baum geschoben — und auch nicht weggeraeumt. Er bleibt liegen, `rmdir`
	# unten scheitert daran, der Hort bleibt stehen, und der naechste Lauf
	# nennt beim Beiseitelegen den Grund. Nichts wird weggeworfen, und nichts
	# Falsches wird eingesetzt.
	if [ -d "${MUPI_HORT}/config" ] && [ ! -L "${MUPI_HORT}/config" ]; then
		mkdir -p "${MUPI_BAUM}/server" || return 1
		if [ -d "${MUPI_BAUM}/server/config" ]; then
			# Darf es im gewoehnlichen Lauf nicht geben — deploy.zip bringt
			# unter server/config nichts mit (nachgesehen: nur www/, www-admin/,
			# server.js, spotify-control.js). Nach einem Abbruch kann dort
			# stehen, was der neue Stand schon abgelegt hat: monitor.json und
			# config.json aus den Vorlagen. Die duerfen gewinnen — genau die
			# beiden ueberschreibt das Update ohnehin gleich danach. ERST
			# kopieren, DANN wegraeumen: faellt der Strom dazwischen, hat der
			# Hort schon alles, und der naechste Lauf macht dasselbe noch mal.
			cp -a "${MUPI_BAUM}/server/config/." "${MUPI_HORT}/config/" || return 1
			rm -rf "${MUPI_BAUM}/server/config" || return 1
		fi
		mv "${MUPI_HORT}/config" "${MUPI_BAUM}/server/config" || return 1
	fi
	local pfad name
	for pfad in "${MUPI_BESTAND_AUSSEN[@]}"; do
		mupi_pfad_brauchbar "${pfad}" || return 1
		name="${pfad//\//_}"
		# Auch hier `-L` dazu: was als toter Verweis hereinkam, geht als toter
		# Verweis zurueck. Er wird gleich wieder heil, weil das Update die
		# Themendateien neu auslegt.
		if [ ! -e "${MUPI_HORT}/${name}" ] && [ ! -L "${MUPI_HORT}/${name}" ]; then continue; fi
		mkdir -p "${MUPI_BAUM}/$(dirname "${pfad}")" || return 1
		# Nur der eine, namentlich genannte Pfad — was der neue Stand dort
		# mitgebracht haette, weicht der Wahl des Betreibers.
		rm -rf "${MUPI_BAUM}/${pfad}" || return 1
		mv "${MUPI_HORT}/${name}" "${MUPI_BAUM}/${pfad}" || return 1
	done
	# NUR wenn er leer ist. Bleibt etwas liegen, bleibt auch der Hort stehen —
	# ein Rest, den der naechste Lauf wiederfindet, ist besser als ein
	# aufgeraeumter Rest, den niemand mehr sieht.
	rmdir "${MUPI_HORT}" 2>/dev/null
	return 0
}
# <<< MUPI-BESTAND-WERKZEUG-ENDE <<<

# >>> MUPI-BESTAND-WIEDERAUFNAHME-ANFANG >>>
# Ein frueherer Lauf ist zwischen Beiseitelegen und Zurueckstellen
# stehengeblieben (Stromausfall, Karte voll, jemand hat den Stecker gezogen).
#
# DAS MUSS HIER OBEN STEHEN, VOR DER SICHERUNG. Sonst zoege der Stand vor dem
# Update ein server/config ein, das gerade LEER ist — eine Sicherung, die den
# Verlust festschreibt, statt ihn abzufangen. Und vor jeder Loeschung sowieso.
if [ -d "${MUPI_HORT}" ]; then
	echo "## Ein frueherer Update-Lauf ist stehengeblieben. Bestand aus" >&3 2>&3
	echo "## ${MUPI_HORT} zurueckstellen, bevor irgendetwas passiert. ##" >&3 2>&3
	if mupi_bestand_zurueck; then
		echo "## Bestand steht wieder im Baum. Weiter. ##" >&3 2>&3
	else
		echo "## Zurueckstellen SCHLUG FEHL — ABBRUCH, es wurde nichts geloescht. ##" >&3 2>&3
		echo "Update abgebrochen: der Bestand eines frueheren Laufs liegt noch in" >&2
		echo "${MUPI_HORT} und liess sich nicht zurueckstellen. NICHTS wurde geloescht." >&2
		echo "Der Bestand ist vollstaendig — er liegt nur an der falschen Stelle." >&2
		echo "Siehe ${LOG}." >&2
		exit 1
	fi
fi
rm -f "${MUPI_ABBRUCH}"
# <<< MUPI-BESTAND-WIEDERAUFNAHME-ENDE <<<

# ── VOR JEDEM UPDATE EINEN STAND (BACKLOG E29/B2) ──────────────────────────
#
# Das ist keine Vorsicht, sondern Erfahrung. In conf_update.sh stand bis zum
# 03.08.2026 ein `del(.mupibox.mediaCheckTimer)`, das bei JEDEM Update einen
# Schluessel wegnahm, den dieser Fork noch liest. Aus `sleep ${CHECK_TIMER}`
# wurde `sleep null`, aus der Warteschleife eine Dauerschleife — ohne Meldung,
# ohne Fehlerzustand, ohne irgendetwas auf dem Bildschirm. Ein Stand von
# vorher haette das in Minuten geklaert statt in Stunden.
#
# ABBRUCH, WENN DIE SICHERUNG SCHEITERT — aber nur dann, wenn es sie
# ueberhaupt gibt: eine aeltere Box ohne das Skript soll weiter aktualisieren
# koennen, sonst waere die Sicherung ein Tor statt eines Netzes. Wer den
# Abbruch bewusst uebergehen will:  MUPI_OHNE_SICHERUNG=1 <dieses Skript>
#
# OFFEN, UND ZWAR NICHT VON HIER AUS ZU SCHLIESSEN: der Update-Knopf im alten
# PHP-Admin holt sein Skript FRISCH VON UPSTREAM
# (`curl … start_mupibox_update.sh | sudo bash`). Ueber diesen Knopf laeuft
# der Block hier also NICHT. Dagegen hilft nur etwas, das nicht am Skript
# haengt, sondern an der Datei — dafuer gibt es mupibox-sicherung.path.
SICHERUNG="/usr/local/bin/mupibox/mupibox-sicherung.py"
if [ -x "${SICHERUNG}" ]; then
	echo "## Stand vor dem Update sichern (E29/B2) ##" >&3 2>&3
	if sudo -u dietpi "${SICHERUNG}" --anlegen --grund vor-update --behalten >&3 2>&3; then
		"${SICHERUNG}" --auf-karte >&3 2>&3 || true
	elif [ "${MUPI_OHNE_SICHERUNG:-0}" = "1" ]; then
		echo "## Sicherung schlug fehl — auf ausdruecklichen Wunsch weiter ##" >&3 2>&3
	else
		echo "## Sicherung schlug fehl — ABBRUCH. Ein Update ohne Stand von" >&3 2>&3
		echo "## vorher ist genau der Fall, der hier schon einmal Stunden" >&3 2>&3
		echo "## gekostet hat. Mit MUPI_OHNE_SICHERUNG=1 laesst es sich" >&3 2>&3
		echo "## uebergehen. Siehe ${LOG}. ##" >&3 2>&3
		exit 1
	fi
else
	echo "## ${SICHERUNG} fehlt — kein Stand vor dem Update (E29/B2) ##" >&3 2>&3
fi

service mupi_idle_shutdown stop
# WELCHEN TONSTAPEL FAEHRT DIESE BOX? (BACKLOG E12/X6)
#
# HIER HAETTE DAS NAECHSTE UPDATE EINE SPIELENDE BOX ZERLEGT. In der Liste
# unten stand `pulseaudio-module-bluetooth`, und dieses Paket zieht den ganzen
# PulseAudio-Dienst mit. Auf der laufenden Box (192.168.178.169, am 04.08.2026
# nur lesend nachgemessen) laeuft PipeWire 1.4.2 als Benutzerdienst, und
# PulseAudio ist dort ENTFERNT (dpkg-Zustand "rc"). Die Schleife weiter unten
# prueft auf `^ii` — "rc" ist nicht "ii", also haette sie das Paket
# nachinstalliert und damit PulseAudio zurueckgeholt. Dazu kommen die beiden
# ins Leere zeigenden Verweise unter /etc/systemd/user/*.wants/: mit dem Paket
# haetten sie wieder ein Ziel und wuerden PulseAudio in jeder Benutzersitzung
# hochziehen. Zwei Tonserver, eine Soundkarte, ein stummes Kinderzimmer — und
# das Update haette es verursacht.
#
# DIESES SKRIPT STELLT DEN STAPEL NICHT UM. Es installiert nur, was zu dem
# passt, was schon da ist. Der Umstieg auf PipeWire ist eine Entscheidung fuer
# eine FRISCHE Karte (autosetup.sh); an einer laufenden Box wird er nur auf
# ausdruecklichen Wunsch gemacht:
#   sudo MUPI_AUDIO=pipewire /usr/local/bin/mupibox/start_mupibox_update.sh
# `swh-plugins` STEHT BEI BEIDEN PIPEWIRE-ZWEIGEN (21.08.2026): es traegt die
# Dynamik des Klangwerks (sc4 als Kompressor, fast_lookahead_limiter als
# Begrenzer). Am PulseAudio-Zweig fehlt es mit Absicht — dort gibt es kein
# Klangwerk, also auch nichts, was die Bausteine laden wuerde.
#
# AUCH HIER UND NICHT NUR IN autosetup.sh, aus demselben Grund wie bei gnupg
# darunter: eine BESTEHENDE Box bekaeme es sonst nie. Und ohne die .so faellt
# das Glied still heraus — der Ton laeuft, die Regler stehen da, und nichts
# meldet, dass sie nichts tun.
if command -v wpctl >/dev/null 2>&1 && command -v pipewire >/dev/null 2>&1; then
	AUDIO_STAPEL="pipewire"
	AUDIO_PAKETE="pipewire pipewire-bin pipewire-pulse pipewire-alsa wireplumber libspa-0.2-bluetooth pulseaudio-utils alsa-utils swh-plugins"
elif [ "${MUPI_AUDIO:-}" = "pipewire" ]; then
	AUDIO_STAPEL="umstieg"
	AUDIO_PAKETE="pipewire pipewire-bin pipewire-pulse pipewire-alsa wireplumber libspa-0.2-bluetooth pulseaudio-utils alsa-utils swh-plugins"
else
	AUDIO_STAPEL="pulseaudio"
	AUDIO_PAKETE="pulseaudio-module-bluetooth pulseaudio-utils alsa-utils"
fi
# `gnupg` auch HIER, und aus demselben Grund wie in autosetup.sh: eine
# bestehende Box hat es heute nur ueber eine Alternativenkette in den
# Recommends von build-essential bekommen ([[unit-nur-in-autosetup-erreicht
# -keine-bestehende-box]] gilt fuer Pakete genauso wie fuer Units). Ohne
# gnupg laesst sich ein verschluesselter Stand (E29/B6) nicht mehr oeffnen.
#
# `python3-rpi-lgpio` STATT `python3-rpi.gpio` (19.09.2026): auf dem Pi 5 sitzen
# die GPIO-Register im RP1-Chip, das klassische RPi.GPIO greift per /dev/mem
# direkt auf CPU-Register und ist dort TOT ([[mupi-rpi-lgpio]]). rpi-lgpio ist
# der Ersatz mit gleicher API — `scripts/fan/fan_control.py` und
# `scripts/mupibox/led_control.py` importieren weiter `import RPi.GPIO`.
# autosetup.sh:104 traegt das neue Paket laengst; hier stand bis heute das alte,
# also bekam eine per Update gepflegte Pi-5-Box den kaputten Zustand ZURUECK.
# Die Abweichung stand seit dem 24.08.2026 aufgeschrieben (AUDIT-2026-08-24)
# und wurde am 19.09. ein zweites Mal von Hand gefunden — deshalb wacht ab
# heute `tools/paketlisten-deckung.py` ueber die beiden Listen.
# WARUM KEIN EINTRAG IN `packages2remove`: das Paket traegt `Conflicts:
# python3-rpi.gpio` UND `Provides: python3-rpi.gpio` (gemessen 19.09.2026 am
# Index von archive.raspberrypi.com, trixie/arm64, 0.6-0~rpt1+trixie; kein
# Paket dort haengt per Depends am alten Namen). Ein einzelnes `apt-get install
# python3-rpi-lgpio` tauscht damit in EINER Transaktion. Ein zusaetzliches
# Entfernen liefe in der `packages2remove`-Schleife DANACH und wuerde bei einem
# gescheiterten Install die letzte funktionierende GPIO-Bibliothek mitnehmen.
#
# `wireguard-tools` (bringt `wg` und `wg-quick`) auch HIER, gleicher Grund wie
# bei gnupg: der VPN-Heimweg der Verwaltung (E30, [[mixpi-vpn-heimweg]]) setzt
# es voraus, sonst zeigt die VPN-Seite nur „Werkzeug fehlt" (die Fehlerlage
# `werkzeug-fehlt`, tools/neu-vorschau.mjs:373). Bis zu dieser Zeile konnte der
# am 12.09.2026 gebaute Weg auf einer BESTANDSBOX nie laufen — er kam nur auf
# frische Karten. Das Kernmodul bringt der Pi-Kern selbst mit.
packages2install="gpiod git libasound2 mplayer ${AUDIO_PAKETE} pip id3tool bluez zip rrdtool scrot net-tools wireless-tools iw wireguard-tools autoconf automake bc build-essential gnupg python3-gpiozero python3-rpi-lgpio python3-lgpio python3-serial python3-requests python3-paho-mqtt libgles2-mesa mesa-utils libsdl2-dev preload python3-smbus2 pigpio libjson-c-dev i2c-tools libi2c-dev python3-smbus python3-alsaaudio python3-netifaces libwidevinecdm0 python3-flask avahi-daemon cifs-utils davfs2"
packages2remove="jq"
STEP=0
VER_JSON="/tmp/version.json"
OS=$(grep -E '^(VERSION_CODENAME)=' /etc/os-release)  >&3 2>&3
OS=${OS:17}  >&3 2>&3
ARCH=$(uname -m) >&3 2>&3	

# NUR 64 BIT — und das Tor steht hier oben, bevor irgendetwas ersetzt wird.
#
# ENTSCHIEDEN AM 05.08.2026: 32 Bit wird nicht mehr getragen. Auf einem
# 32-Bit-System gibt es kein librespot >= 0.8.0, und aeltere Staende fragen
# einen ueberholten Metadaten-Endpunkt ab, der keine Tondatei mehr
# mitliefert — jeder Titel meldet „not available", es kommt KEIN TON
# (A/B-Test 2026-07-28: 0.6.0-dev stumm, 0.8.0 spielt).
#
# WARUM ABBRECHEN UND NICHT EINFACH librespot AUSLASSEN: Ein Update, das
# eine nicht mehr getragene Karte weiter mit neuem Code versorgt, erzeugt
# genau die Mischung, die niemand mehr nachvollziehen kann — neue
# Oberflaeche, neue Dienste, alter Abspieler. Wer hier steht, soll es
# ERFAHREN, nicht Monate spaeter beim ersten Spotify-Titel.
#
# WER HEUTE AUF 32 BIT LAEUFT, VERLIERT NICHTS AN TON: dort war nie welcher.
# Die Box laeuft auf dem jetzigen Stand weiter; sie bekommt nur keine
# Aktualisierung mehr, bis die Karte mit einem 64-Bit-Abbild neu bespielt
# ist. Jeder Pi ab dem 3er kann das.
if [ "$(getconf LONG_BIT)" != "64" ]; then
	ABBRUCH="Dieses Update braucht ein 64-Bit-System. Gefunden: $(getconf LONG_BIT) Bit auf $(uname -m).
Grund: Spotify braucht librespot 0.8.0 oder neuer, und dafuer gibt es kein 32-Bit-Programm.
Die Box laeuft auf dem jetzigen Stand normal weiter — es wird nur nichts ersetzt.
Was zu tun ist: die Karte mit dem 64-Bit-Abbild von DietPi neu bespielen (arm64/aarch64)."
	echo "${ABBRUCH}" >&3 2>&3
	echo "${ABBRUCH}" > /dev/tty 2>/dev/null || echo "${ABBRUCH}" >&2
	exit 1
fi

wget -O /tmp/installation.jpg https://raw.githubusercontent.com/splitti/MuPiBox/main/media/images/installation.jpg >&3 2>&3
/usr/bin/fbv /tmp/installation.jpg & >&3 2>&3

if [ -z "$BRANCH" ]; then
  wget -q -O ${VER_JSON} https://raw.githubusercontent.com/splitti/MuPiBox/main/version.json >&3 2>&3
  VERSION=$(/usr/bin/jq -r .release.${RELEASE}[-1].version ${VER_JSON})  >&3 2>&3
  MUPIBOX_URL=$(/usr/bin/jq -r .release.${RELEASE}[-1].url ${VER_JSON})  >&3 2>&3
else
  MUPIBOX_URL="https://github.com/splitti/MuPiBox/archive/refs/heads/${BRANCH}.zip"
fi

USER=$(/usr/bin/whoami) >&3 2>&3
RASPPI=$(/usr/bin/cat /sys/firmware/devicetree/base/model | tr -d '\0' ) >&3 2>&3

if [ -n "$BRANCH" ]; then
	MUPI_SRC="/home/dietpi/MuPiBox-${BRANCH}" >&3 2>&3
elif [ "$RELEASE" = "dev" ]; then
	MUPI_SRC="/home/dietpi/MuPiBox-main" >&3 2>&3
else
	MUPI_SRC="/home/dietpi/MuPiBox-${VERSION}" >&3 2>&3
fi

if [ -n "$BRANCH" ]; then
  VERSION_LONG="DEV ${BRANCH} $(curl -s 'https://api.github.com/repos/splitti/MuPiBox/branches/'"$BRANCH" | jq -r '.commit.commit.committer.date' | cut -d'T' -f1)" >&3 2>&3
elif [ "$RELEASE" = "dev" ]; then
	VERSION_LONG="DEV $(curl -s "https://api.github.com/repos/splitti/MuPiBox" | jq -r '.pushed_at' | cut -d'T' -f1)"  >&3 2>&3
else
	VERSION_LONG="${VERSION} ${RELEASE}"
fi
NODEJS=$(nodejs --version) >&3 2>&3

echo "==========================================================================================" >&3 2>&3
echo "= OS:               ${OS}" >&3 2>&3
echo "= RasPi:            ${RASPPI}" >&3 2>&3
echo "= Architecture:     ${ARCH}" >&3 2>&3
echo "= Node.js:          ${NODEJS}" >&3 2>&3
echo "= User:             ${USER}" >&3 2>&3
echo "= Parameter:        $1" >&3 2>&3
echo "= Release:          ${RELEASE}" >&3 2>&3
echo "= Version:          ${VERSION_LONG}" >&3 2>&3
echo "= Update-URL:       ${MUPIBOX_URL}" >&3 2>&3
echo "= Unzip-Directory:  ${MUPI_SRC}" >&3 2>&3
echo "= Tonstapel:        ${AUDIO_STAPEL}" >&3 2>&3
echo "==========================================================================================" >&3 2>&3

{
	###############################################################################################


	echo -e "XXX\n0\nPrepare Update... \nXXX"	 >&3 2>&3
	systemctl stop mupi_idle_shutdown.service >&3 2>&3
	mkdir /home/dietpi/.mupibox/chromium_cache >&3 2>&3	
	mkdir /home/dietpi/MuPiBox/media/audiobook >&3 2>&3	
	mkdir /home/dietpi/MuPiBox/media/music >&3 2>&3
	mkdir /home/dietpi/MuPiBox/media/other >&3 2>&3
	mkdir /home/dietpi/MuPiBox/media/cover >&3 2>&3
	mkdir /home/dietpi/MuPiBox/media/youtube-dl >&3 2>&3
	chown dietpi:dietpi /home/dietpi/MuPiBox/media/audiobook >&3 2>&3
	chown dietpi:dietpi /home/dietpi/MuPiBox/media/music >&3 2>&3

	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nUpdate package-list\nXXX"
	before=$(date +%s)
	apt-get update >&3 2>&3
	after=$(date +%s)

	echo -e "## apt-get update ##  finished after $((after - $before)) seconds" >&3 2>&3

	###############################################################################################

	echo -e "XXX\n${STEP}\nUpdate Node.js\nXXX"
	before=$(date +%s)
	if [[ "$NODEJS" == "v22."* ]]; then
		echo "Node.js already at v22.*" >&3 2>&3
	else
		apt-get --yes remove nodejs >&3 2>&3
		curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - >&3 2>&3
		apt-get install -y nodejs >&3 2>&3
	fi
	after=$(date +%s)

	echo -e "## apt-get update ##  finished after $((after - $before)) seconds" >&3 2>&3


	###############################################################################################
	
	for package in ${packages2install}
	do
		before=$(date +%s)
		STEP=$(($STEP + 1))
		echo -e "XXX\n${STEP}\nInstall ${package}\nXXX"
		#apt-get install ${package} -y >&3 2>&3
		PKG_OK=$(dpkg -l ${package} 2>/dev/null | egrep '^ii' | wc -l) >&3 2>&3
		if [ ${PKG_OK} -eq 0 ]; then
		  # DEBIAN_FRONTEND=noninteractive, seit `davfs2` in der Liste steht
		  # (20.09.2026, Netzlaufwerk E28/N6-N9): das Paket stellt beim
		  # Einrichten eine debconf-Frage („mount.davfs setuid root?"). Ein
		  # Dialog in einem Rezept, dessen Ausgabe nach >&3 laeuft und vor dem
		  # niemand sitzt, ist kein Fehler, der auffaellt — es steht einfach.
		  # Die Vorgabe (KEIN setuid) ist genau die, die hier gilt: eingehaengt
		  # wird ueber eine systemd-Einheit, also als root.
		  DEBIAN_FRONTEND=noninteractive apt-get --yes install ${package} >&3 2>&3
		fi
		after=$(date +%s)
		echo -e "## apt-get install ${package}  ##  finished after $((after - $before)) seconds" >&3 2>&3
	done
	
	# DIE RICHTUNG IST HIER UMGEKEHRT ZUR SCHLEIFE DARUEBER, und genau das ging
	# verloren: bis zum 19.09.2026 stand auch hier `-eq 0` — aus der
	# Install-Schleife kopiert, ohne die Richtung zu drehen. Damit rief dieser
	# Block `apt-get remove` ausschliesslich fuer Pakete auf, die gar nicht
	# installiert waren, und hat seit seinem Entstehen NIE etwas entfernt.
	# `PKG_OK` zaehlt die `ii`-Zeilen von dpkg: entfernt wird, was DA IST.
	#
	# WAS DAMIT JETZT WIRKLICH PASSIERT: `jq` soll weg, weil dieses Skript
	# weiter unten die eigene Fassung 1.8.1 als Programmdatei nach /usr/bin/jq
	# legt (autosetup.sh:165 macht es auf frischen Karten genauso). Bleibt das
	# APT-Paket daneben gebucht, holt das naechste `apt upgrade` die
	# Distributionsfassung darueber zurueck. Die Datei selbst raeumt der Schritt
	# „Copy binaries" ohnehin per `rm /usr/bin/jq` weg und laedt sie neu —
	# zwischen dieser Schleife und jenem `wget` ruft nichts `jq` auf (geprueft
	# 19.09.2026 an allen jq-Stellen der Datei).
	#
	# Der fehlende Zeilenumbruch vor `Remove` (`\Remove` statt `\nRemove`) ist
	# mitrepariert: `dialog --gauge` bekam Fortschrittszahl und Text in EINER
	# Zeile, waehrend die Install-Schleife es richtig macht.
	for package in ${packages2remove}
	do
		before=$(date +%s)
		STEP=$(($STEP + 1))
		echo -e "XXX\n${STEP}\nRemove ${package}\nXXX"
		PKG_OK=$(dpkg -l ${package} 2>/dev/null | egrep '^ii' | wc -l) >&3 2>&3
		if [ ${PKG_OK} -gt 0 ]; then
		  apt-get --yes remove ${package} >&3 2>&3
		fi
		after=$(date +%s)
		echo -e "## apt-get remove ${package}  ##  finished after $((after - $before)) seconds" >&3 2>&3
	done

	STEP=$(($STEP + 1))
	if [ $OS == "bullseye" ]; then
		echo -e "XXX\n${STEP}\nInstall package mutagen\nXXX"
		before=$(date +%s)
		pip install mutagen >&3 2>&3
		STEP=$(($STEP + 4))
		after=$(date +%s)
		echo -e "## pip install mutagen  ##  finished after $((after - $before)) seconds" >&3 2>&3
		echo -e "XXX\n${STEP}\nInstall package pip requests\nXXX"
		before=$(date +%s)
		installed=$(pip list | grep requests)
		if [ ${#installed} = 0 ]; then
			pip install requests --break-system-packages >&3 2>&3
		fi
		after=$(date +%s)
		echo -e "## pip install requests  ##  finished after $((after - $before)) seconds" >&3 2>&3
		before=$(date +%s)
		installed=$(pip list | grep pyserial)
		if [ ${#installed} = 0 ]; then
			pip install pyserial --break-system-packages >&3 2>&3
		fi
		after=$(date +%s)
		echo -e "## pip install pyserial  ##  finished after $((after - $before)) seconds" >&3 2>&3
		STEP=$(($STEP + 1))
	else
		echo -e "XXX\n${STEP}\nInstall package python3-mutagen/python3-dev\nXXX"
		# DIE LISTE STEHT IM SCHLEIFENKOPF, nicht in `packages2install`: bis zum
		# 19.09.2026 wurde hier die GLOBALE Liste aus dem Kopf der Datei
		# ueberschrieben. Heute liest sie danach niemand mehr, es war also kein
		# Fehler, sondern eine gestellte Falle — wer unten noch einmal ueber
		# `packages2install` laeuft, bekaeme still zwei Pakete statt vierzig.
		# `autosetup.sh:217` fuehrt dieselbe Schleife schon in dieser Form.
		for package in python3-mutagen python3-dev
		do
			before=$(date +%s)
			echo -e "XXX\n${STEP}\nInstall ${package}\nXXX"
			PKG_OK=$(dpkg -l ${package} 2>/dev/null | egrep '^ii' | wc -l) >&3 2>&3
			if [ ${PKG_OK} -eq 0 ]; then
			  # DEBIAN_FRONTEND=noninteractive, seit `davfs2` in der Liste steht
			  # (20.09.2026, Netzlaufwerk E28/N6-N9): das Paket stellt beim
			  # Einrichten eine debconf-Frage („mount.davfs setuid root?"). Ein
			  # Dialog in einem Rezept, dessen Ausgabe nach >&3 laeuft und vor dem
			  # niemand sitzt, ist kein Fehler, der auffaellt — es steht einfach.
			  # Die Vorgabe (KEIN setuid) ist genau die, die hier gilt: eingehaengt
			  # wird ueber eine systemd-Einheit, also als root.
			  DEBIAN_FRONTEND=noninteractive apt-get --yes install ${package} >&3 2>&3
			fi
			after=$(date +%s)
			STEP=$(($STEP + 1))
			echo -e "## apt-get install ${package}  ##  finished after $((after - $before)) seconds" >&3 2>&3
		done
		echo -e "XXX\n${STEP}\nInstall package pip telepot\nXXX"
		before=$(date +%s)
		installed=$(pip list | grep telepot)
		if [ ${#installed} = 0 ]; then
			pip install telepot --break-system-packages >&3 2>&3
		fi
		after=$(date +%s)
		echo -e "## pip install telepot  ##  finished after $((after - $before)) seconds" >&3 2>&3
		STEP=$(($STEP + 1))
	fi

	###############################################################################################

#	echo -e "XXX\n${STEP}\nSetup docker and container... \nXXX"	
#	before=$(date +%s)
#	if [ ! -f /usr/bin/docker ]; then
#		sudo bash < <(curl -fsSL https://get.Docker.com) >&3 2>&3
#	fi
#	sudo docker rm youtube-dl >&3 2>&3
#	sudo docker run --name youtube-dl -d --restart unless-stopped -p 8081:8081 -v /home/dietpi/MuPiBox/media/youtube-dl:/downloads ghcr.io/alexta69/metube >&3 2>&3
#	sudo docker image prune -a -f  >&3 2>&3
#	sudo apt-get --yes remove docker   >&3 2>&3
#	after=$(date +%s)
#	echo -e "## Setup docker and container  ##  finished after $((after - $before)) seconds" >&3 2>&3
#	STEP=$(($STEP + 1))
	
	###############################################################################################

	echo -e "XXX\n${STEP}\nSetup DietPi-Dashboard... \nXXX"	
	before=$(date +%s)
	mkdir /opt/dietpi-dashboard >&3 2>&3
	rm /opt/dietpi-dashboard/dietpi-dashboard >&3 2>&3
	curl -fL "$(curl -sSf 'https://api.github.com/repos/nonnorm/DietPi-Dashboard/releases/latest' | mawk -F\" "/\"browser_download_url\": \".*dietpi-dashboard-$(uname -m)\"/{print \$4}")" -o /opt/dietpi-dashboard/dietpi-dashboard >&3 2>&3
	chmod +x /opt/dietpi-dashboard/dietpi-dashboard >&3 2>&3
	curl -sSfL https://raw.githubusercontent.com/nonnorm/DietPi-Dashboard/v0.6.2/config.toml -o /opt/dietpi-dashboard/config.toml  >&3 2>&3
	#bash -c 'su dietpi -c "yes \"\" | sudo /boot/dietpi/dietpi-software install 200"' >&3 2>&3
	/usr/bin/sed -i 's/#terminal_user = "root"/terminal_user = "dietpi"/g' /opt/dietpi-dashboard/config.toml >&3 2>&3
	#sudo /usr/bin/sed -i 's/pass = true/pass = false/g' /opt/dietpi-dashboard/config.toml >&3 2>&3
	after=$(date +%s)
	echo -e "## Setup DietPi-Dashboard  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nDownload MuPiBox Version ${VERSION_LONG}... \nXXX"	
	before=$(date +%s)
	wget -q -O /home/dietpi/mupibox.zip ${MUPIBOX_URL} >&3 2>&3
	after=$(date +%s)
	echo -e "## MuPiBox Download  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nUnzip MuPiBox Version ${VERSION_LONG}... \nXXX"	
	before=$(date +%s)
	unzip -q -d /home/dietpi /home/dietpi/mupibox.zip >&3 2>&3
	rm /home/dietpi/mupibox.zip >&3 2>&3

	#MUPI_SRC="/home/dietpi/MuPiBox-${VERSION}"
	after=$(date +%s)
	echo -e "## Unzip Mupibox Download  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nBackup Userdata... \nXXX" >&3 2>&3
	before=$(date +%s)
# >>> MUPI-BESTAND-BEISEITE-ANFANG >>>
	# GANZ server/config zur Seite, nicht drei Dateien daraus. Warum, steht
	# ganz oben bei MUPI_BAUM. Ein `mv` innerhalb derselben Platte: unteilbar
	# und unabhaengig davon, ob dort 20 oder 20000 Dinge liegen.
	if mupi_bestand_beiseite; then
		echo "## Bestand liegt in ${MUPI_HORT} ##" >&3 2>&3
	else
		# HIER WIRD NICHT WEITERGEMACHT. Das naechste, was das Skript taete,
		# waere `rm -R` auf den Baum — und ohne den Bestand im Hort ist das
		# genau der Verlust, gegen den dieser ganze Block gebaut ist.
		echo "## Bestand liess sich NICHT beiseite legen — ABBRUCH. ##" >&3 2>&3
		echo "## Grund: ${MUPI_BESTAND_GRUND} ##" >&3 2>&3
		echo "## Es wurde NICHTS geloescht, die Box bleibt auf dem alten Stand. ##" >&3 2>&3
		touch "${MUPI_ABBRUCH}"
		echo "Update abgebrochen, BEVOR etwas geloescht wurde." >&2
		# DER GRUND, NICHT EINE VERMUTUNG. Hier stand bisher in JEDEM der vier
		# Faelle „server/config liess sich nicht nach … legen" — auch dann, wenn
		# es gar kein server/config gab. Wer das las, suchte nach Rechten und
		# vollen Datentraegern und fand nichts.
		echo "${MUPI_BESTAND_GRUND}" >&2
		echo "Die Box laeuft unveraendert weiter. Siehe ${LOG}." >&2
		exit 1
	fi
# <<< MUPI-BESTAND-BEISEITE-ENDE <<<
	after=$(date +%s)
	echo -e "## Backup Data  ##  finished after $((after - $before)) seconds" >&3 2>&3

	STEP=$(($STEP + 1))

	###############################################################################################


	echo -e "XXX\n${STEP}\nUpdate frontend, backend-api, and backend-player ... \nXXX"	
	before=$(date +%s)
	# FRUEHER: `sudo -H -u dietpi bash -c "pm2 stop server"` (bis 14.08.2026).
	#
	# Das war seit dem 29.07.2026 WIRKUNGSLOS: die Dienste laufen als
	# systemd-Units, pm2 hat keine Prozesse mehr (und ist auf der Box .57
	# inzwischen nicht einmal mehr installiert — gemessen mit
	# tools/pm2-bestand.sh). Der Aufruf schlug also still fehl, und gleich
	# darunter raeumt `rm -R "${MUPI_BAUM}/"` den Verzeichnisbaum weg,
	# WAEHREND der Server weiterlief. Was danach kam, war Glueckssache:
	# geoeffnete Dateien behalten unter Linux ihren Inhalt, aber alles, was der
	# Server danach frisch von der Platte holen wollte, war weg.
	#
	# AUCH DER ABSPIELDIENST. Er wurde hier nie gestoppt, obwohl weiter unten
	# (Zeile ~715) seine spotify-control.js ueberschrieben wird.
	#
	# `stop` und nicht `restart`: der Baum wird gleich ersetzt: es gibt in
	# diesem Augenblick nichts, was neu starten koennte. Hochgefahren wird
	# wieder im Abschnitt "Finalizing setup" ganz am Ende.
	systemctl stop mupibox-server.service >&3 2>&3
	systemctl stop mupibox-player.service >&3 2>&3
# >>> MUPI-BESTAND-TAUSCH-ANFANG >>>
	# DAS `rm -R` BLEIBT — und es ist richtig so. Ein Angular-Bau schreibt
	# chunk-<hash>.js; ein blosses Ueberkopieren liesse die Bruchstuecke des
	# Vorgaengers liegen, und die Oberflaeche laedt dann eine Mischung aus zwei
	# Staenden. Weg muss der CODE. Der Bestand liegt zu diesem Zeitpunkt
	# nachweislich im Hort — ohne ihn ist das Skript oben schon ausgestiegen.
	rm -R "${MUPI_BAUM}/" >&3 2>&3
	mkdir -p "${MUPI_BAUM}/server" >&3 2>&3
	unzip ${MUPI_SRC}/bin/nodejs/deploy.zip -d "${MUPI_BAUM}/" >&3 2>&3
	# SOFORT ZURUECK, nicht erst in 600 Zeilen. Frueher stand das Zurueckholen
	# ganz am Ende des Skripts — dazwischen lagen npm-Installationen,
	# Paketdownloads und Dienstneustarts, viele Minuten lang. Genau dieses
	# Fenster ist der Zustand „weder alt noch neu": neuer Code, keine Daten.
	# Jetzt sind es drei Zeilen.
	if mupi_bestand_zurueck; then
		echo "## Bestand steht wieder im Baum ##" >&3 2>&3
	else
		# DER BESTAND IST NICHT WEG — er liegt vollstaendig im Hort. Das Skript
		# hoert hier auf, statt einen halben Baum weiterzubauen; der naechste
		# Lauf faengt oben mit der Wiederaufnahme an.
		echo "## Bestand liess sich NICHT zurueckstellen — ABBRUCH. ##" >&3 2>&3
		echo "## Er liegt vollstaendig in ${MUPI_HORT} und geht nicht verloren. ##" >&3 2>&3
		touch "${MUPI_ABBRUCH}"
		echo "Update abgebrochen: der Bestand liegt in ${MUPI_HORT}." >&2
		echo "Es ist NICHTS verloren. Dieses Skript noch einmal starten — es" >&2
		echo "holt den Bestand als erstes zurueck. Siehe ${LOG}." >&2
		exit 1
	fi
	mv ${MUPI_SRC}/config/templates/monitor.json "${MUPI_BAUM}/server/config/monitor.json" >&3 2>&3
	mv ${MUPI_SRC}/config/templates/www.json "${MUPI_BAUM}/server/config/config.json" >&3 2>&3
# <<< MUPI-BESTAND-TAUSCH-ENDE <<<
	chown dietpi:dietpi -R /home/dietpi/.mupibox/Sonos-Kids-Controller-master/www >&3 2>&3
	cp /home/dietpi/.mupibox/Sonos-Kids-Controller-master/spotify-control.js /home/dietpi/.mupibox/spotifycontroller-main/spotify-control.js >&3 2>&3
	after=$(date +%s)
	echo -e "## Update Kids-Controller  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nCopy MuPiBox-Files... \nXXX"	
	# MuPiBox
	before=$(date +%s)
	# HIER STAND die Verteilung der Theme-Beigaben und themes/*.css der
	# ALTEN Oberflaeche (E118/1e): die Themen sind aus dem Quellbaum
	# geloescht, die neue Oberflaeche faerbt ueber /farben.css (E118/1c).
	# Bestand auf der Box (theme-data/, themes/) bleibt liegen und stoert
	# nicht; aufgeraeumt wird er bewusst NICHT von einem Update-Lauf.
	mv ${MUPI_SRC}/scripts/chromium-autostart.sh /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh >&3 2>&3
	mv ${MUPI_SRC}/scripts/mupibox/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/bluetooth/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/wled/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/telegram/* /usr/local/bin/mupibox/ >&3 2>&3
	#mv ${MUPI_SRC}/config/templates/www.json /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/config.json >&3 2>&3
	mv ${MUPI_SRC}/config/templates/.bashrc /home/dietpi/.bashrc >&3 2>&3
	# Zweite Funk-Karte (USB-Stick, wlan1) — dieselbe Rezept-Ablage wie im
	# Erstweg (autosetup.sh, E131/D3), damit auch BESTANDSBOXEN die Mechanik
	# bekommen (die Vorlagen-Luecke der Ausrollwege ist AUDIT-2026-09-05
	# Rang 11). `cp -n`: eine vorhandene Datei traegt die Netze des Hauses
	# und wird NIE ueberschrieben. Ohne Stick wirkungslos (allow-hotplug).
	cp -n ${MUPI_SRC}/config/templates/interfaces-wlan1 /etc/network/interfaces.d/wlan1 >&3 2>&3
	cp -n ${MUPI_SRC}/config/templates/wpa_supplicant-wlan1.conf /etc/wpa_supplicant/wpa_supplicant-wlan1.conf >&3 2>&3
	mv ${MUPI_SRC}/scripts/mupihat/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/fan/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/wifi/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/mqtt/* /usr/local/bin/mupibox/ >&3 2>&3
	# Zwei Dateien aus scripts/librespot/ — librespot-waechter.service ruft die
	# erste unter genau diesem Pfad auf, und der Waechter selbst ruft die
	# zweite (Zeilen 80/85). Ohne die Unit zeigt sie ins Leere; ohne konto.py
	# faellt der Waechter durch bis `systemctl restart librespot` und startet
	# im 5-Minuten-Takt neu, ohne je zu helfen — siehe die lange Notiz in
	# autosetup.sh (gefunden beim Gegenlesen am 04.08.2026).
	mv ${MUPI_SRC}/scripts/librespot/librespot-waechter.sh /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/librespot/librespot-konto.py /usr/local/bin/mupibox/ >&3 2>&3
	# E42: DIE ZWEITE TONMASCHINE — beide Soloist-Skripte, nie einzeln (die
	# Units rufen genau diese Pfade; eine Haelfte ohne die andere ist eine
	# Unit, die ins Leere zeigt). Bis zum 22.08.2026 rollte KEIN Schalen-Weg
	# Soloist aus — nur Rezept und Handweg (einrichten.sh) kannten es. Eine
	# Box, die per mupibox.de-Update lebt, hatte den Engine-Schalter nie.
	mv ${MUPI_SRC}/scripts/soloist/soloist-start.sh /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/soloist/soloist-updater.sh /usr/local/bin/mupibox/ >&3 2>&3
	# E104: Anmeldewache (heilt den nach Boot-Fehlanmeldung stummen Soloist).
	mv ${MUPI_SRC}/scripts/soloist/soloist-anmeldewache.sh /usr/local/bin/mupibox/ >&3 2>&3
	# MIXPI-SKRIPTE (Adapterwahl-Anwendung, Plugin-Nachzug) — gleicher Ort
	# wie alles andere; siehe autosetup.sh, gleicher Block.
	mv ${MUPI_SRC}/scripts/mixpi/* /usr/local/bin/mupibox/ >&3 2>&3
	# scripts/box/ — DER KOPIERBLOCK, DEN ES BISHER AUF KEINEM WEG GAB
	# (BACKLOG E12/X5). Ziel ist /opt/mupibox-tools/, weil genau dort der
	# remote-step-installer die Dateien abgelegt hat und die Units diesen Pfad
	# nennen: eine laufende Box bekommt so ihre eigenen Dateien AKTUALISIERT
	# statt eine zweite Fassung daneben. Ausfuehrlich in autosetup.sh.
	mkdir -p /opt/mupibox-tools >&3 2>&3
	mv ${MUPI_SRC}/scripts/box/* /opt/mupibox-tools/ >&3 2>&3
	chmod 755 /opt/mupibox-tools/* >&3 2>&3
	for m in i2c-dev uinput; do
		grep -qx "$m" /etc/modules-load.d/mupibox-touch.conf 2>/dev/null || echo "$m" >> /etc/modules-load.d/mupibox-touch.conf
	done

	chown dietpi:dietpi /home/dietpi/.bashrc >&3 2>&3
	chmod 755 /usr/local/bin/mupibox/* >&3 2>&3
	chmod 755 /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh >&3 2>&3
	# DHCP-RUECKFALL ENTSCHAERFEN — DERSELBE SCHRITT WIE IN autosetup.sh.
	#
	# Beim Gegenlesen am 04.08.2026 gefunden: der Hebel war NUR in autosetup.sh
	# eingehaengt. Die Datei kam ueber beide Wege an (scripts/mupibox/* geht
	# oben mit), AUFGERUFEN wurde sie nur auf dem einen. Damit haette genau die
	# Box, an der die 4,96 s gemessen wurden, sie nie bekommen: .169 laeuft
	# seit langem, ihre /etc/dhcp/dhclient.conf ist vom 03.05.2025 und enthaelt
	# den Block nicht (nachgesehen, nur lesend). Eine Messung, deren Ergebnis
	# nur frische Karten erreicht, hilft keiner laufenden Box.
	#
	# DAS IST DIE FEHLERKLASSE VON tools/ausrollweg-deckung.py, EINE ETAGE
	# TIEFER: dort meldet scripts/mupibox/ auf beiden Wegen "rollt aus", denn
	# das Werkzeug fragt, ob eine Datei ANGEFASST wird — nicht, ob sie
	# AUFGERUFEN wird. Ein Einrichtungsskript, das kopiert und nie laeuft, ist
	# genauso wirkungslos wie eines, das gar nicht ankommt (vgl. piper, das
	# hier richtig in BEIDEN Wegen steht).
	#
	# Gemessen an Box .169 am 04.08.2026 (tools/bootkette-schau.py): WLAN bei
	# 6,6 s verbunden, naechster DHCP-Antrag erst bei 11,6 s, Antwort des
	# Routers darauf in 115 ms — 4,96 s Warten auf nichts bei 11,98 s
	# Gesamtstart. Am Pi 4 brachte dieselbe Aenderung 31,8 s -> 13,2 s.
	#
	# GEFAHRLOS ZU WIEDERHOLEN: das Skript haengt einen markierten Block an und
	# tut beim zweiten Lauf nichts. Es ERSETZT dhclient.conf nicht — darin
	# steht die request-Liste mit den DNS-Servern (Wiki:
	# dhclient-conf-nicht-ersetzen). Wirksam wird es beim naechsten Neustart;
	# die laufende Verbindung bleibt unberuehrt. Rueckweg:
	#   sudo /usr/local/bin/mupibox/dhcp-schneller.sh --zuruecknehmen
	# Scheitert es, laeuft das Update weiter — die Box bootet dann so langsam
	# wie bisher, und das ist kein Grund, ein Update abzubrechen.
	/usr/local/bin/mupibox/dhcp-schneller.sh --einbauen >&3 2>&3 || echo "## dhcp-schneller failed - box boots as before ##" >&3 2>&3
	after=$(date +%s)
	echo -e "## Copy MuPiBox-Files  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))



	###############################################################################################

	# PIPER — DERSELBE SCHRITT WIE IN autosetup.sh, UND AUS DEMSELBEN GRUND.
	#
	# Eine laufende Box bekommt mit diesem Update eine Oberflaeche, die
	# Kachelnamen vorliest. Ohne Piper spricht sie nicht — und zwar STILL: der
	# Abspieler fragt vorher `GET /api/vorlesen` und macht dann eben nichts
	# (backend-player/src/sprechen.ts, bereitAus). Auf der Entwicklungsbox liegt
	# Piper seit dem 28.07.2026, aber er kam dort von Hand hin; ueber ein Update
	# kam er noch nie. Genau das ist das Zwei-Repos-Delta (BACKLOG E12).
	#
	# Das Skript ueberspringt, was schon da ist — ein zweites Update kostet also
	# nichts. Und wie oben gilt: scheitert es, laeuft das Update weiter. Eine
	# Box, die nicht vorliest, ist keine kaputte Box.
	echo -e "XXX\n${STEP}\nInstall Piper (text-to-speech)... \nXXX"
	before=$(date +%s)
	timeout -k 30 1200 /usr/local/bin/mupibox/piper-einrichten.sh >&3 2>&3 \
		|| echo "## Piper setup failed/timed out - box will not read aloud ##" >&3 2>&3
	after=$(date +%s)
	echo -e "## Install Piper  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nCopy binaries... \nXXX"
	before=$(date +%s)
	rm /usr/bin/jq >&3 2>&3
	
	service spotifyd stop >&3 2>&3
	systemctl disable spotifyd >&3 2>&3
	service librespot stop >&3 2>&3
	if [ "$RELEASE" = "dev" ]; then
		systemctl disable librespot >&3 2>&3
	fi

	# HIER HAETTE EIN UPDATE EINE LAUFENDE BOX STUMMGESCHALTET.
	#
	# Beide Zweige holten `dev_0.6_20250806` — eine Fassung, die keinen Ton
	# spielt (A/B belegt 2026-07-28, scripts/librespot/README.md). Auf den
	# laufenden Boxen liegt laengst 0.8.0, hingebracht vom remote-step-installer.
	# Ein Update haette es also UEBERSCHRIEBEN und Spotify auf einer Box
	# stillgelegt, die vorher spielte — die schlimmste Richtung dieser
	# Fehlerklasse, weil sie wie eine Verschlechterung durch das Update aussieht
	# und es auch eine waere.
	#
	# Gleiche Logik wie in autosetup.sh: 0.8.0 aus dem Paket bevorzugt,
	# wget nur als Rueckfall. Fuer 32 Bit gibt es weiterhin kein 0.8.0 —
	# dort bleibt es beim alten Stand, und die Meldung sagt es.
	# Ohne Verzweigung: hinter dem 64-Bit-Tor ganz oben gibt es nur arm64.
	wget -O /usr/bin/jq https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-linux-arm64 >&3 2>&3
	if [ -f "${MUPI_SRC}/bin/librespot/0.8.0/librespot-arm64" ]; then
		cp "${MUPI_SRC}/bin/librespot/0.8.0/librespot-arm64" /usr/bin/librespot >&3 2>&3
		echo "## librespot 0.8.0 aus dem Paket ##" >&3 2>&3
	elif /usr/bin/librespot -V 2>/dev/null | grep -qE 'librespot 0\.(8|9|[1-9][0-9])'; then
		# NICHTS TUN IST HIER DIE RICHTIGE HANDLUNG: auf der Box liegt schon
		# eine taugliche Fassung, und das Paket bringt keine bessere mit.
		echo "## librespot auf der Box ist bereits >= 0.8.0 - bleibt unangetastet ##" >&3 2>&3
	else
		# ES WIRD NICHTS UEBERSCHRIEBEN. Hier stand ein wget auf dev_0.6 — die
		# Fassung, die nachweislich keinen Ton spielt. Sie ueber ein vorhandenes
		# librespot zu legen bringt nichts und kann nur schaden: bleibt die alte
		# Datei liegen, ist der Zustand wenigstens derselbe wie vorher, und die
		# Meldung sagt, was fehlt.
		echo "## WARNUNG: 0.8.0 fehlt im Paket - librespot bleibt unangetastet, Spotify spielt womoeglich nicht ##" >&3 2>&3
		echo "## Abhilfe: vollstaendiges Paket verwenden oder 0.8.0 selbst bauen (scripts/librespot/README.md) ##" >&3 2>&3
	fi
	mv ${MUPI_SRC}/bin/fbv/fbv_64 /usr/bin/fbv >&3 2>&3
	chmod 755 /usr/bin/fbv /usr/bin/jq /usr/bin/librespot >&3 2>&3
	#mv ${MUPI_SRC}/config/templates/librespot.conf /etc/spotifyd/spotifyd.conf >&3 2>&3
	
	mkdir /etc/librespot/ >&3 2>&3
	mkdir -p $(cat /etc/mupibox/mupiboxconfig.json | jq -r .spotify.cachepath) >&3 2>&3
	chown dietpi:dietpi $(cat /etc/mupibox/mupiboxconfig.json | jq -r .spotify.cachepath) >&3 2>&3

	after=$(date +%s)
	echo -e "## Copy binaries  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))
	
	###############################################################################################

	echo -e "XXX\n${STEP}\nCopy some media files... \nXXX"	
	# Splash and Media
	before=$(date +%s)
	#mv ${MUPI_SRC}/config/templates/splash.txt /boot/splash.txt >&3 2>&3
	wget https://gitlab.com/DarkElvenAngel/initramfs-splash/-/raw/master/boot/initramfs.img -O /boot/initramfs.img >&3 2>&3
	# ══ /home/dietpiMuPiBox — DER FEHLENDE SCHRAEGSTRICH ═════════════════════
	#
	# In FUENF dieser Zeilen stand `/home/dietpiMuPiBox/…` statt
	# `/home/dietpi/MuPiBox/…`. Ein `cp` auf einen Pfad, dessen Verzeichnis es
	# nicht gibt, schlaegt fehl — und weil hier alles nach `>&3` geht, sieht
	# das niemand. Die Dateien sind auf keiner aktualisierten Box angekommen,
	# seit die Zeilen so lauten.
	#
	# ══ UND ES FEHLTE DAS `mkdir` ════════════════════════════════════════════
	#
	# AM GERAET NACHGESEHEN (Box .169, 08.08.2026): /home/dietpi/MuPiBox
	# enthaelt nur `themes`; das Verzeichnis `sysmedia` GIBT ES DORT NICHT.
	# `autosetup.sh` legt es an (Zeilen 351/352), dieser Weg hier nie — und
	# eine Box, die nicht ueber autosetup entstanden ist, hat es folglich auch
	# nicht. Danach schlaegt jedes `cp` hier still fehl.
	#
	# WAS DARAN HAENGT, IST NICHT NUR SCHOENHEIT: `off_trigger.sh` spielt
	# `button_shutdown.wav`, wenn der Knopf lang genug gehalten wurde. Fehlt
	# die Datei, faehrt die Box WORTLOS herunter — und wer keine Rueckmeldung
	# bekommt, weiss nicht, ob es gewirkt hat, und HAELT LAENGER. Bei
	# 6 Sekunden nimmt der MuPiHAT den Strom hart weg. Der fehlende Ton fuehrt
	# also genau zu dem harten Abschalten, das das weiche ersetzen soll.
	#
	# `shutdown.wav` WIRD JETZT MITKOPIERT, obwohl es auskommentiert war:
	# off_trigger.sh nimmt es als Ersatz, wenn der eigene Knopfton fehlt.
	mkdir -p /home/dietpi/MuPiBox/sysmedia/sound /home/dietpi/MuPiBox/sysmedia/images >&3 2>&3
	cp ${MUPI_SRC}/media/images/goodbye.png /home/dietpi/MuPiBox/sysmedia/images/goodbye.png >&3 2>&3
	#mv ${MUPI_SRC}/media/images/splash.png /boot/splash.png >&3 2>&3
	#cp ${MUPI_SRC}/media/images/MuPiLogo.jpg /home/dietpi/MuPiBox/sysmedia/images/MuPiLogo.jpg >&3 2>&3
	cp ${MUPI_SRC}/media/sound/shutdown.wav /home/dietpi/MuPiBox/sysmedia/sound/shutdown.wav >&3 2>&3
	# NUR SAEEN, NIE UEBERSCHREIBEN: ein selbst gewaehlter Einschalt-Klang
	# soll ein Update ueberleben — aber FEHLT die Datei ganz, blieb die Box
	# beim Hochfahren stumm (so gefunden am 15.08.2026: der Ordner fehlte
	# komplett, mplayer lief beim Boot still ins Leere).
	[ -f /home/dietpi/MuPiBox/sysmedia/sound/startup.wav ] || cp ${MUPI_SRC}/media/sound/startup.wav /home/dietpi/MuPiBox/sysmedia/sound/startup.wav >&3 2>&3
	cp ${MUPI_SRC}/media/sound/button_shutdown.wav /home/dietpi/MuPiBox/sysmedia/sound/button_shutdown.wav >&3 2>&3
	cp ${MUPI_SRC}/media/sound/low.wav /home/dietpi/MuPiBox/sysmedia/sound/low.wav >&3 2>&3
	cp ${MUPI_SRC}/media/images/installation.jpg /home/dietpi/MuPiBox/sysmedia/images/installation.jpg >&3 2>&3
	cp ${MUPI_SRC}/media/images/battery_low.jpg /home/dietpi/MuPiBox/sysmedia/images/battery_low.jpg >&3 2>&3
	# Die Dateien gehoeren dem Benutzer, dem das Verzeichnis gehoert — sonst
	# liegen sie root:root in einem Baum, den dietpi verwaltet.
	chown -R dietpi:dietpi /home/dietpi/MuPiBox/sysmedia >&3 2>&3

	after=$(date +%s)
	echo -e "## Copy media files  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	# LED-CONTROL WIRD NICHT MEHR GEBAUT (29.08.2026) — gleiche Aenderung wie
	# in autosetup.sh: der einzige Aufruf des C-Kompilats war auskommentiert,
	# es leuchtet led_control.py. Hier bleibt nur das Aufraeumen fuer
	# Bestandsboxen, die das Binaer noch liegen haben.
	#
	# UND MIT IHM GEHT DIE TOTE SKRIPT-FLOTTE: der Wholesale-mv oben kopiert
	# nur noch, was im Repo liegt — aber die ALTEN Kopien der am 29.08.2026
	# geloeschten Skripte blieben auf Bestandsboxen sonst ewig liegen
	# (www-Altlasten-Muster). Jede Zeile hier entspricht einer Loeschung im
	# Repo; einziger Ex-Leser von /tmp/.rrd war der PHP-Admin (E47).
	echo -e "XXX\n${STEP}\nCleanup LED Control... \nXXX"
	rm -f /usr/local/bin/mupibox/led_control >&3 2>&3
	# DIE VIER BT-SKRIPTE STANDEN HIER UND SIND AM 06.09.2026 GEGANGEN
	# (AUDIT-2026-09-06 Rang 9). Sie waren der einzige falsche Eintrag dieser
	# Liste: `scan_bt.sh`, `start_bt.sh`, `stop_bt.sh` und `remove_bt.sh`
	# liegen im Repo (scripts/bluetooth/), und `autosetup.sh:575` rollt genau
	# dieses Verzeichnis aus. Dieser Weg loeschte also, was der andere Weg
	# gerade angelegt hatte — frische Box hatte sie, Bestandsbox nicht.
	#
	# Die Begruendung oben („Jede Zeile hier entspricht einer Loeschung im
	# Repo") stimmte fuer JEDEN anderen Eintrag dieser Liste; nachgezaehlt am
	# 06.09.: telegram_*, repair_config, set_hostname, wled_get_data, save_rrd,
	# id3tag_converter — alle im Repo gefallen, ihr `rm` ist richtig. Nur die
	# vier BT-Skripte kamen am 31.08.2026 NEU dazu (vom Pi 5 geholt, zwei echte
	# Fehler dabei behoben, siehe Kopf von start_bt.sh) — die Aufraeumzeile vom
	# 29.08. konnte das nicht wissen.
	#
	# OB ES SIE BRAUCHT, ist eine ANDERE Frage und bleibt offen: im Repo ruft
	# sie niemand (`pair_bt.sh` dagegen schon, aus bluetooth.ts). Wer sie faellt,
	# faellt die Dateien UND die Kopierzeile im autosetup — nicht nur eine
	# Haelfte, sonst steht derselbe Widerspruch wieder da.
	rm -f /usr/local/bin/mupibox/telegram_end_publish.py /usr/local/bin/mupibox/telegram_playing.py \
	      /usr/local/bin/mupibox/telegram_shutdown.py /usr/local/bin/mupibox/telegram_start.py \
	      /usr/local/bin/mupibox/telegram_stop.py /usr/local/bin/mupibox/telegram_set_deviceid.sh \
	      /usr/local/bin/mupibox/repair_config.sh /usr/local/bin/mupibox/set_hostname.sh \
	      /usr/local/bin/mupibox/id3tag_converter.sh /usr/local/bin/mupibox/wled_get_data.py \
	      /usr/local/bin/mupibox/disable_mupihat.sh /usr/local/bin/mupibox/save_rrd.sh \
	      /usr/local/bin/mupibox/parse_log.py /usr/local/bin/mupibox/plot_charge.py \
	      /usr/local/bin/mupibox/plot_discharge.py >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nRestarting Services... \nXXX"
	before=$(date +%s)
	mv -f ${MUPI_SRC}/config/services/mupi_idle_shutdown.service /etc/systemd/system/mupi_idle_shutdown.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_splash.service /etc/systemd/system/mupi_splash.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/librespot.service /etc/systemd/system/librespot.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/templates/env-librespot /etc/librespot/env-librespot >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/pulseaudio.service /etc/systemd/system/pulseaudio.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_startstop.service /etc/systemd/system/mupi_startstop.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_wifi.service /etc/systemd/system/mupi_wifi.service  >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_check_internet.service /etc/systemd/system/mupi_check_internet.service  >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_check_monitor.service /etc/systemd/system/mupi_check_monitor.service  >&3 2>&3
	# mupi_autoconnect_bt entfernt — siehe autosetup.sh (kaputt seit BlueZ 5.82
	# und der Umbenennung chromium-browser -> chromium).
	mv -f ${MUPI_SRC}/config/services/mupi_vnc.service /etc/systemd/system/mupi_vnc.service  >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_novnc.service /etc/systemd/system/mupi_novnc.service  >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_powerled.service /etc/systemd/system/mupi_powerled.service  >&3 2>&3
	# Die Unit fuer den Ausschalter am Knopf. Sie steht neben mupi_powerled,
	# weil beide zu demselben Knopf gehoeren: die eine macht sein Licht, die
	# andere sein Ausschalten. Bis heute rollte NUR autosetup.sh sie aus, also
	# nur auf frische Karten — auf einer laufenden Box gab es den Ausschalter
	# deshalb nicht, egal wie oft aktualisiert wurde.
	mv -f ${MUPI_SRC}/config/services/mupi_offtrigger.service /etc/systemd/system/mupi_offtrigger.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_telegram.service /etc/systemd/system/mupi_telegram.service  >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/dietpi-dashboard.service /etc/systemd/system/dietpi-dashboard.service  >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_hat.service /etc/systemd/system/mupi_hat.service  >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_hat_control.service /etc/systemd/system/mupi_hat_control.service  >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_autoconnect-wifi.service /etc/systemd/system/mupi_autoconnect-wifi.service  >&3 2>&3
	# WLAN-Energiesparmodus abschalten (Wiki mupi-wifi-powersave): der
	# remote-step-installer setzt das seit 2026-07-25, autosetup seit
	# 2026-08-15 — hier wirkt es als NACHREICHUNG fuer jede Box, die nur
	# ueber Updates lebt. Ohne die Unit schlaeft das Funkmodul ein und die
	# Box faellt minutenlang aus dem Netz, ohne dass ein Log etwas sagt.
	mv -f ${MUPI_SRC}/config/services/wifi-powersave-off.service /etc/systemd/system/wifi-powersave-off.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_mqtt.service /etc/systemd/system/mupi_mqtt.service  >&3 2>&3
	# DIE FERNBEDIENUNG (E134, 06.09.2026) — auch auf Bestandsboxen. Ohne
	# diesen Dienst steuert eine gekoppelte BLE-Fernbedienung den
	# KIOSK-BROWSER statt die Box: `Home` oeffnet dessen Startseite, auf der
	# Box war das google.com.
	mv -f ${MUPI_SRC}/config/services/mixpi-fernbedienung.service /etc/systemd/system/mixpi-fernbedienung.service >&3 2>&3
	# DIE KIOSK-REGELN (06.09.2026). Sie sperren den Browser auf die EIGENE
	# Adresse: eine durchgerutschte Home-Taste oeffnete sonst Chromiums
	# Startseite (auf der Box google.com), und von dort kam man mit einer
	# Fernbedienung nicht mehr weg. Die Datei lag bis dahin nur von Hand
	# auf der Box und haette kein Neuaufsetzen ueberlebt.
	mkdir -p /etc/chromium/policies/managed >&3 2>&3
	cp -f ${MUPI_SRC}/config/templates/chromium-kiosk-policy.json /etc/chromium/policies/managed/mixpibox-kiosk.json >&3 2>&3
	systemctl enable mixpi-fernbedienung.service >&3 2>&3
	# `cp -n`: eine vorhandene Zuordnung ist die Arbeit des Betreibers und
	# wird NIE ueberschrieben.
	cp -n ${MUPI_SRC}/config/templates/fernbedienung.json /etc/mupibox/fernbedienung.json >&3 2>&3
	# DIE GERAETEPROFILE (E137, 09.09.2026) — auch als Nachreichung fuer
	# Bestandsboxen: Vorbelegungen und SVG-Schemata je Geraetesorte, gelesen
	# vom Server aus /etc/mupibox/fernbedienungen. AUSGELIEFERTE Daten,
	# keine Betreiber-Arbeit — deshalb ueberschreibend, im Gegensatz zur
	# Zuordnung eine Zeile drueber.
	mkdir -p /etc/mupibox/fernbedienungen >&3 2>&3
	cp -rf ${MUPI_SRC}/config/fernbedienungen/. /etc/mupibox/fernbedienungen/ >&3 2>&3
	# Luefter — siehe die lange Notiz in autosetup.sh (Gegenlesen 04.08.2026).
	# Kurz: das Skript kam ueber beide Wege an, die Unit ueber keinen, und die
	# Verwaltung bietet den Luefter trotzdem zum Einschalten an. Hier wirkt es
	# zusaetzlich als Nachreichung: Boxen, die den Schalter nie zum Laufen
	# brachten, bekommen die Unit mit dem naechsten Update. Nur anlegen, nicht
	# einschalten — wer keinen Luefter hat, soll auch keinen laufen lassen.
	mv -f ${MUPI_SRC}/config/services/mupi_fan.service /etc/systemd/system/mupi_fan.service  >&3 2>&3
	# Waechter fuer librespot — siehe autosetup.sh, gleicher Grund (E12/X1).
	mv -f ${MUPI_SRC}/config/services/librespot-waechter.service /etc/systemd/system/librespot-waechter.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/librespot-waechter.timer /etc/systemd/system/librespot-waechter.timer >&3 2>&3
	# E42: SOLOIST-UNITS + ENGINE-DROP-IN — siehe autosetup.sh, gleicher
	# Block. Die Unit-Quelle ist scripts/systemd/ (EINE Quelle fuer Rezept,
	# Handweg und beide Schalen-Wege; tools/ausrollweg-deckung.py meldet
	# Doppelquellen). Hier wirkt es als NACHREICHUNG: eine Box, die nur ueber
	# Updates lebt, bekommt die zweite Tonmaschine mit diesem Lauf.
	mv -f ${MUPI_SRC}/scripts/systemd/soloist.service /etc/systemd/system/soloist.service >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/soloist-updater.service /etc/systemd/system/soloist-updater.service >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/soloist-updater.timer /etc/systemd/system/soloist-updater.timer >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/soloist-anmeldewache.service /etc/systemd/system/soloist-anmeldewache.service >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/soloist-anmeldewache.timer /etc/systemd/system/soloist-anmeldewache.timer >&3 2>&3
	# Das Drop-In haengt NUR die ExecCondition an librespot.service an —
	# GENAU EINE Tonmaschine laeuft, der Schalter ist spotify.engine.
	# Vorgabe librespot: an einer Box, die nie umschaltet, aendert sich NICHTS
	# (die Condition ist wahr, librespot startet wie bisher).
	mkdir -p /etc/systemd/system/librespot.service.d >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/librespot-engine.conf /etc/systemd/system/librespot.service.d/engine.conf >&3 2>&3
	# E131/C1: WLAN-Adapterwahl-Unit + ifup-Riegel — dieselbe Ablage wie im
	# Erstweg (autosetup.sh, dort steht die Begruendung). Ohne Wahl-Datei
	# beides wirkungslos; die Sicherheitsregel des Riegels beweist
	# tools/mixpi-wlan-riegel.test.sh.
	mv -f ${MUPI_SRC}/scripts/systemd/mixpi-wlan-adapter.service /etc/systemd/system/mixpi-wlan-adapter.service >&3 2>&3
	mkdir -p /etc/systemd/system/ifup@.service.d >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/ifup-mixpi-wlan-riegel.conf /etc/systemd/system/ifup@.service.d/mixpi-wlan-riegel.conf >&3 2>&3
	# DER SCHALTER ZEIGTE INS LEERE: dieses Skript STOPPT mupibox-server und
	# mupibox-player ganz oben und STARTET sie ganz unten — GELEGT hat die
	# beiden Units aber nur autosetup.sh bzw. das Installer-Rezept. Eine Box,
	# die nur ueber Updates lebt (die pm2-Aera), hatte die Dateien nie; ihr
	# `systemctl start` lief ins Leere, und zwar ohne Meldung.
	# tools/ausrollweg-deckung.py meldete genau das (22.08.2026).
	mv -f ${MUPI_SRC}/config/services/mupibox-server.service /etc/systemd/system/mupibox-server.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-player.service /etc/systemd/system/mupibox-player.service >&3 2>&3
	# SICHTBARKEIT (BACKLOG E11c/S2 bis S4) — siehe die lange Notiz in
	# autosetup.sh. Hier wirkt es zusaetzlich als NACHREICHUNG in beide
	# Richtungen: Boxen aus dem remote-step-installer haben die Boot-Animation
	# schon (unter /usr/local/bin/mupibox-boot-splash.py), aber weder Fehlerbild
	# noch Kioskwache; Boxen aus diesem Repo hatten bisher keines von dreien.
	mv -f ${MUPI_SRC}/config/services/mupibox-boot-splash.service /etc/systemd/system/mupibox-boot-splash.service >&3 2>&3
	# ══ ANMELDUNGEN WARTEN NICHT AUFS WLAN (E59, 20.08.2026) ══════════════
	# VOLLE KOPIE der systemd-Unit, aus deren After= das network.target heraus
	# ist. Sie liegt in /etc/systemd/system/ und gewinnt damit gegen
	# /usr/lib/systemd/system/ — ein Drop-In genuegt NICHT, weil sich
	# Ordnungs-Abhaengigkeiten in systemd nicht leer zuruecksetzen lassen.
	# GEMESSEN an der Box: der Kiosk startete danach bei 2,98 s statt 8,17 s.
	# Er wartete zuvor ueber drei Ecken auf eine WLAN-Adresse (ifup@wlan0 ->
	# network.target -> systemd-user-sessions -> getty@tty1), um eine Seite
	# anzuzeigen, die auf localhost liegt.
	# KEIN `systemctl enable`: die Unit ersetzt eine bestehende, die systemd
	# ohnehin zieht. Nur ablegen und daemon-reload.
	mv -f ${MUPI_SRC}/config/services/systemd-user-sessions.service /etc/systemd/system/systemd-user-sessions.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-fehlerbild@.service /etc/systemd/system/mupibox-fehlerbild@.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-kioskwache.service /etc/systemd/system/mupibox-kioskwache.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-kioskwache.timer /etc/systemd/system/mupibox-kioskwache.timer >&3 2>&3
	# STANDWACHE — ihre Skripte (mupibox-standwache.py, mupibox-tauscher.py)
	# kommen oben schon mit scripts/box/ nach /opt/mupibox-tools/; nur die
	# beiden Units fehlten auf diesem Weg. tools/ausrollweg-deckung.py hat
	# genau das gemeldet (13.08.2026): "autosetup rollt aus, update NICHT —
	# wer aktualisiert, bekommt sie nie."
	mv -f ${MUPI_SRC}/config/services/mupibox-standwache.service /etc/systemd/system/mupibox-standwache.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-standwache.timer /etc/systemd/system/mupibox-standwache.timer >&3 2>&3
	# SICHERN UND ZURUECKSPIELEN (BACKLOG E29) — NACHREICHUNG, und die ist
	# hier nicht nebensaechlich, sondern der Punkt.
	#
	# Bis hierher lagen diese sechs Units NUR in autosetup.sh. Damit bekam sie
	# ausschliesslich eine frisch bespielte Karte; jede BESTEHENDE Box blieb
	# ohne sie, auch nach beliebig vielen Updates. Das Skript
	# mupibox-sicherung.py kam schon an (scripts/mupibox/* wird oben
	# ausgerollt) — aber ein Skript ohne die Units ist nur die Haelfte:
	#
	#   * ohne .path und .timer sichert NIEMAND selbsttaetig (B1),
	#   * ohne mupibox-wiederherstellung.service tut die Textdatei auf der
	#     Karte GAR NICHTS — der Rueckweg ohne SSH (B3) existierte auf einer
	#     bestehenden Box also nicht, und das haette erst derjenige gemerkt,
	#     der ihn im Ernstfall braucht,
	#   * ohne mupibox-sicherungsprobe.timer wird nie geprueft, ob der
	#     Rueckweg noch traegt (B3, zweiter Halbsatz).
	#
	# Gefunden mit tools/ausrollweg-deckung.py: dort standen alle vier alten
	# E29-Units als „autosetup: rollt aus / update: —".
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherung.service /etc/systemd/system/mupibox-sicherung.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherung.timer /etc/systemd/system/mupibox-sicherung.timer >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherung.path /etc/systemd/system/mupibox-sicherung.path >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-wiederherstellung.service /etc/systemd/system/mupibox-wiederherstellung.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherungsprobe.service /etc/systemd/system/mupibox-sicherungsprobe.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherungsprobe.timer /etc/systemd/system/mupibox-sicherungsprobe.timer >&3 2>&3
	# TOUCH-BRUECKE UND BT-WIEDERVERBINDEN (BACKLOG E12/X5) — siehe autosetup.sh.
	# Hier wirkt es zusaetzlich als NACHREICHUNG: Boxen aus dem
	# remote-step-installer haben beide Units schon (mit denselben Pfaden),
	# Boxen aus diesem Repo hatten keine davon. Die Unit-Dateien sind bis auf
	# einen zusaetzlichen Kommentarblock in der Touch-Unit wortgleich mit denen
	# des Installers — an einer laufenden Box aendert sich dadurch nichts.
	mv -f ${MUPI_SRC}/config/services/mupibox-touch-bridge.service /etc/systemd/system/mupibox-touch-bridge.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-bt-reconnect.service /etc/systemd/system/mupibox-bt-reconnect.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-bt-reconnect.timer /etc/systemd/system/mupibox-bt-reconnect.timer >&3 2>&3
	# DIE ALTE KOPIE WEGRAEUMEN. Der remote-step-installer legte das Skript
	# unter /usr/local/bin/mupibox-boot-splash.py ab, dieses Repo legt es nach
	# /usr/local/bin/mupibox/. Die neue Unit zeigt auf den neuen Pfad; die alte
	# Datei bliebe sonst als zweite Fassung liegen und liefe beim naechsten
	# Suchen mit — zwei Fassungen desselben Skripts sind schlimmer als eine
	# fehlende.
	rm -f /usr/local/bin/mupibox-boot-splash.py >&3 2>&3

	systemctl daemon-reload >&3 2>&3
	# Das alte STEHENDE Bild abschalten, wenn es je an war: `fbv /boot/splash.png`
	# und die Animation streiten sonst um /dev/fb0.
	systemctl disable mupi_splash.service >&3 2>&3
	systemctl stop mupi_splash.service >&3 2>&3
	# NUR `enable`, NICHT `start`: die Boot-Animation gehoert an den naechsten
	# Start. Sie waehrend eines laufenden Updates zu starten hiesse, dem Kind
	# den laufenden Kiosk vom Schirm zu nehmen.
	systemctl enable mupibox-boot-splash.service >&3 2>&3
	systemctl enable mupibox-kioskwache.timer >&3 2>&3
	# Der Timer laeuft leer, solange keine Frist steht — genau wie im Rezept
	# (mupibox-app.yaml, Schritt standwache): enable --now waere dort ein
	# sofortiger Leerlauf-Start, hier reicht enable, der naechste Boot zieht.
	systemctl enable mupibox-standwache.timer >&3 2>&3
	# KOPIERT IST NICHT AUFGERUFEN — das Fehlerbild haengt sich nicht selbst an
	# (Herleitung im Kopf des Skripts). Muss NACH dem daemon-reload laufen.
	/usr/local/bin/mupibox/fehlerbild-anhaengen.sh >&3 2>&3 || echo "## fehlerbild-anhaengen failed - no error picture ##" >&3 2>&3
	systemctl enable librespot-waechter.timer >&3 2>&3
	systemctl start librespot-waechter.timer >&3 2>&3
	# E42: EIGENE ZEILEN AUS DEMSELBEN GRUND (der Zeitgeber!). soloist.service
	# wird NUR enabled, NIE gestartet: seine ExecCondition entscheidet, und
	# die Vorgabe ist librespot — an einer Box, die nie umschaltet, laeuft
	# nach diesem Update exakt dasselbe wie vorher. Enabled sein muss er
	# trotzdem, sonst wirkt der Schalter nur bis zum naechsten Neustart.
	systemctl enable soloist.service >&3 2>&3
	systemctl enable soloist-updater.timer >&3 2>&3
	systemctl start soloist-updater.timer >&3 2>&3
	# E131/C1: nur ENABLEN, nie starten — der Dienst wirkt beim naechsten
	# Boot; jetzt zu starten hiesse, mitten im Update eine Karte hinzulegen.
	systemctl enable mixpi-wlan-adapter.service >&3 2>&3
	# E104: die Anmeldewache tickt IMMER mit (prueft selbst, ob soloist die
	# gewaehlte Tonmaschine ist, und tut sonst nichts).
	systemctl enable soloist-anmeldewache.timer >&3 2>&3
	systemctl start soloist-anmeldewache.timer >&3 2>&3
	# Das Binary wird GEHOLT, nie mitgeliefert (jeder Build verfaellt 90 Tage
	# nach dem BAU). Scheitert das Holen, laeuft das Update weiter — die
	# Vorgabe librespot braucht Soloist nicht, der Timer versucht es wieder.
	[ -x /usr/local/bin/soloist ] || /usr/local/bin/mupibox/soloist-updater.sh >&3 2>&3 || echo "## soloist fetch failed - librespot bleibt die Tonmaschine ##" >&3 2>&3
	# EIGENE ZEILEN, KEIN `--now`: die Schleifen in diesem Skript haengen
	# ".service" an, und ein Zeitgeber darin wuerde als "…timer.service"
	# gesucht und still verfehlt.
	#
	# STARTEN IST HIER RICHTIG, anders als bei der Boot-Animation: die
	# Touch-Bruecke haelt sich mit --auto heraus, wenn der Kerneltreiber selbst
	# Ereignisse liefert (Ruecklauf 0, Restart=on-failure startet dann nicht
	# neu), und der Kiosk ist zu diesem Zeitpunkt ohnehin abgeschossen (Zeile
	# `killall … chromium` ganz oben). Auf einer Box, die die Bruecke schon vom
	# remote-step-installer hat, ist `start` ein Nichts.
	systemctl enable mupibox-touch-bridge.service >&3 2>&3
	systemctl start mupibox-touch-bridge.service >&3 2>&3
	systemctl enable mupibox-bt-reconnect.timer >&3 2>&3
	systemctl start mupibox-bt-reconnect.timer >&3 2>&3
	# STARTEN IST HIER RICHTIG: das Update haengt selbst am WLAN, und der
	# Energiesparmodus soll aus sein, BEVOR die Box das naechste Mal
	# unbeaufsichtigt herumsteht. `--no-block` als Gurt (siehe Touch-Bruecke
	# im Rezept: ein Dienst, der nicht hochkommt, darf nie den Lauf halten);
	# die Unit selbst endet ohnehin immer mit exit 0.
	systemctl enable wifi-powersave-off.service >&3 2>&3
	systemctl start --no-block wifi-powersave-off.service >&3 2>&3
	# SICHERN UND ZURUECKSPIELEN EINSCHALTEN (BACKLOG E29) — die Nachreichung
	# von oben wirkt nur, wenn die Units auch eingeschaltet sind.
	#
	# Das Verzeichnis zuerst: mupibox-sicherung.service laeuft als dietpi und
	# koennte es unter /home/dietpi nicht selbst anlegen, wenn ein frueherer
	# Lauf als root dort etwas hinterlassen hat. `chown` ist deshalb kein
	# Schmuck, sondern die Vorkehrung dagegen, dass die Auslese spaeter still
	# scheitert und die Zahl der Staende wieder ins Unbegrenzte waechst.
	mkdir -p /home/dietpi/.mupibox/sicherungen >&3 2>&3
	chown dietpi:dietpi /home/dietpi/.mupibox/sicherungen >&3 2>&3
	chmod 700 /home/dietpi/.mupibox/sicherungen >&3 2>&3
	systemctl enable mupibox-sicherung.path >&3 2>&3
	systemctl start mupibox-sicherung.path >&3 2>&3
	systemctl enable mupibox-sicherung.timer >&3 2>&3
	systemctl start mupibox-sicherung.timer >&3 2>&3
	# NUR `enable`, NICHT `start`: ohne Marke auf der Karte tut die
	# Wiederherstellung ohnehin nichts (ConditionPathExists) — sie muss nur DA
	# sein, wenn sie einmal gebraucht wird.
	systemctl enable mupibox-wiederherstellung.service >&3 2>&3
	systemctl enable mupibox-sicherungsprobe.timer >&3 2>&3
	systemctl start mupibox-sicherungsprobe.timer >&3 2>&3
	# UND DIE STAENDE AUF DIE KARTE. Der Stand von vor diesem Update liegt
	# bisher nur im Haus (/home/dietpi/.mupibox/sicherungen) — dorthin kommt
	# man nur mit SSH. Erst hier wird daraus ein Rueckweg, den auch jemand
	# mit einem Kartenleser fahren kann.
	/usr/local/bin/mupibox/mupibox-sicherung.py --auf-karte >&3 2>&3 \
		|| echo "## Staende kamen nicht auf die Karte - Rueckweg ohne SSH fehlt (E29/B3) ##" >&3 2>&3
	# ── TONSTAPEL NACHBESSERN, NICHT UMSTELLEN (BACKLOG E12/X6) ─────────────
	#
	# Was hier NICHT passiert, ist der Punkt: eine laufende Box wird von einem
	# Update NICHT von PulseAudio auf PipeWire umgestellt. Der Umstieg beruehrt
	# asound.conf, den Kiosk-Benutzer und die Benutzersitzung; scheitert er
	# mitten in einem Update, steht am Ende eine stumme Box im Kinderzimmer.
	# Fuer eine frische Karte ist er richtig (autosetup.sh), fuer eine laufende
	# Box ist er eine Entscheidung, die jemand ausdruecklich treffen muss.
	#
	# Was hier SCHON passiert: die drei Dinge, die auf einer PipeWire-Box
	# nachweislich fehlen konnten und deren Nachtragen nichts umwirft.
	case "${AUDIO_STAPEL}" in
	pipewire|umstieg)
		# 1. Die Benutzerebene scharf stellen. Sie wird leicht vergessen, weil
		#    `systemctl is-enabled pipewire.service` auf Systemebene "disabled"
		#    meldet — richtig so, gestartet wird ueber die Sockets.
		systemctl --global enable pipewire.socket pipewire-pulse.socket wireplumber.service >&3 2>&3
		# 2. Bluetooth-Ton ohne aktive Sitzung (Wiki:
		#    mupi-wireplumber-kein-bluetooth-ohne-seat).
		mkdir -p /etc/wireplumber/wireplumber.conf.d >&3 2>&3
		mv -f ${MUPI_SRC}/config/templates/80-bluez-ohne-seat.conf /etc/wireplumber/wireplumber.conf.d/80-bluez-ohne-seat.conf >&3 2>&3
		# Nur A2DP, kein Freisprech-Profil: HFP-Nachverbinde-Versuche hacken
		# den laufenden Ton ab (Begruendung in der Vorlage selbst).
		cp -f ${MUPI_SRC}/config/templates/81-bluez-nur-a2dp.conf /etc/wireplumber/wireplumber.conf.d/81-bluez-nur-a2dp.conf >&3 2>&3
		# 3. Die beiden ins Leere zeigenden pulseaudio-Verweise wegraeumen.
		#    Heute harmlos, weil das Ziel fehlt — sobald aber irgendetwas das
		#    Paket pulseaudio nachzieht, haben sie wieder eines und starten
		#    einen zweiten Tonserver auf derselben Karte.
		for l in /etc/systemd/user/default.target.wants/pulseaudio.service \
		         /etc/systemd/user/sockets.target.wants/pulseaudio.socket; do
			[ -L "$l" ] && [ ! -e "$l" ] && rm -f "$l" >&3 2>&3
		done
		# 4. Klangregelung nachziehen (15.08.2026): der Equalizer ist eine
		#    statische Filterkette; die Ueberall-Senke baut seither der SERVER
		#    als eigenen pipewire-Prozess (Mitglieder waehlbar, klang.json).
		#    Eine liegengebliebene 60-ueberall.conf MUSS weg, sonst steht die
		#    Senke doppelt da und die Auswahl greift ins Leere.
		mkdir -p /etc/pipewire/pipewire.conf.d >&3 2>&3
		rm -f /etc/pipewire/pipewire.conf.d/60-ueberall.conf >&3 2>&3
		cp -f ${MUPI_SRC}/config/templates/61-entzerrer.conf /etc/pipewire/pipewire.conf.d/61-entzerrer.conf >&3 2>&3
		echo "## Tonstapel ${AUDIO_STAPEL}: Benutzerebene und wireplumber nachgezogen ##" >&3 2>&3
		# DIE PLUGINS standen bis zum 22.08.2026 HIER, im pipewire-Zweig des
		# case — eine PulseAudio-Box bekam beim Update gar keine
		# Erweiterungen. Der Aufruf steht jetzt NACH dem esac, wo er vom
		# Tonstapel unabhaengig ist.
		# NUR AUF AUSDRUECKLICHEN WUNSCH (MUPI_AUDIO=pipewire) der eigentliche
		# Umstieg. Er wird GANZ gemacht oder GAR NICHT: eine Box mit PipeWire
		# UND einer asound.conf, die pcm.!default auf den softvol-Regler legt,
		# waere schlimmer dran als vorher. Deshalb erst nachsehen, ob wpctl
		# nach der Paketinstallation wirklich da ist.
		if [ "${AUDIO_STAPEL}" = "umstieg" ]; then
			if command -v wpctl >/dev/null 2>&1; then
				if [ -f /etc/asound.conf ]; then mv /etc/asound.conf /etc/asound.conf.vor-pipewire >&3 2>&3; fi
				# Linger: ohne ihn stirbt der Benutzer-Tonstapel mit der letzten
				# logind-Sitzung (die ganze Begruendung steht an derselben Stelle
				# in autosetup/autosetup.sh — 15.08.2026, einen Nachmittag gekostet).
				loginctl enable-linger dietpi >&3 2>&3
				systemctl disable --now bluealsa bluealsa-aplay >&3 2>&3
				systemctl disable --now pulseaudio.service >&3 2>&3
				apt-get --yes remove pulseaudio pulseaudio-module-bluetooth >&3 2>&3
				# DER RUECKWEG HAT DREI SCHRITTE, NICHT ZWEI: die Zeile
				# nannte nur asound.conf und den Dienst — das PAKET wird
				# aber eine Zeile darueber entfernt, und ohne
				# /usr/bin/pulseaudio scheitert die Unit mit 203/EXEC.
				# Wer der halben Anleitung folgt, hat asound.conf zurueck
				# und trotzdem keinen Ton.
				echo "## Umstieg auf PipeWire vollzogen - wirkt nach dem NEUSTART. Rueckweg (in dieser Reihenfolge): apt-get install pulseaudio pulseaudio-module-bluetooth; mv /etc/asound.conf.vor-pipewire /etc/asound.conf; systemctl enable --now pulseaudio.service; reboot ##" >&3 2>&3
			else
				echo "## FEHLER: wpctl fehlt nach der Paketinstallation - Umstieg NICHT vollzogen, der alte Stapel bleibt unangetastet ##" >&3 2>&3
			fi
		fi
		;;
	*)
		echo "## Tonstapel PulseAudio - NICHT umgestellt. Wer PipeWire will: MUPI_AUDIO=pipewire vor den Aufruf setzen ##" >&3 2>&3
		;;
	esac
	# ── DIE PLUGINS: VERSIONIERT, UND UNABHAENGIG VOM TONSTAPEL (22.08.2026) ─
	#
	# Vorher stand die Kopie im pipewire-Zweig oben (eine PulseAudio-Box bekam
	# nichts) und arbeitete mit `cp -rn` — einmal ausgerollt wurde ein Plugin
	# NIE wieder aktualisiert, waehrend Server und Plugin-Vertrag
	# weiterwanderten. Genau die Richtung, die beim librespot-Ueberschreiber
	# die teuerste war, nur andersherum eingefroren: das Update BRACHTE etwas
	# Besseres mit und liess es liegen. mixpi-plugins-nachziehen.sh kopiert
	# Neues, ersetzt bei hoeherer `fassung` (plugin.json), laesst Gleichstand
	# und Betreiber-Eigenes in Ruhe (Regeln + Probe: tools/mixpi-plugins-
	# nachziehen-probe.sh). KOPIERT IST NICHT AUFGERUFEN — der Aufruf steht
	# hier UND in autosetup.sh; tools/ausrollweg-deckung.py prueft das.
	/usr/local/bin/mupibox/mixpi-plugins-nachziehen.sh "${MUPI_SRC}/plugins" >&3 2>&3 || echo "## plugin sync failed - Erweiterungen bleiben auf dem alten Stand ##" >&3 2>&3
	if [ "$RELEASE" != "dev" ]; then
		systemctl enable librespot.service >&3 2>&3
		systemctl start librespot.service >&3 2>&3
	fi
	systemctl enable mupi_check_internet.service >&3 2>&3
	systemctl start mupi_check_internet.service >&3 2>&3
	systemctl enable mupi_check_monitor.service >&3 2>&3
	systemctl start mupi_check_monitor.service >&3 2>&3
	systemctl enable mupi_powerled.service >&3 2>&3
	systemctl start mupi_powerled.service >&3 2>&3
	# mupi_offtrigger wird NICHT hier eingeschaltet, sondern unten beim
	# OnOffShim — die Begruendung steht dort. Kurz: sein Skript liegt an
	# dieser Stelle noch gar nicht auf der Platte.
	systemctl enable dietpi-dashboard.service >&3 2>&3
	systemctl start dietpi-dashboard.service >&3 2>&3
	after=$(date +%s)
	echo -e "## Restarting services  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))
	
	###############################################################################################
	echo -e "XXX\n${STEP}\nUninstall Pi-Blaster... \nXXX"	
	before=$(date +%s)
	sudo -H -u dietpi bash -c 'cd /home/dietpi/pi-blaster; make uninstall' >&3 2>&3
	rm -R /home/dietpi/pi-blaster >&3 2>&3
	after=$(date +%s)
	echo -e "## Pi-Blaster  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################


	echo -e "XXX\n${STEP}\nSet environment...  \nXXX"	
	before=$(date +%s)
	/usr/bin/chmod 755 ${MUPI_SRC}/config/templates/crontab.template >&3 2>&3
	/usr/bin/chown dietpi:dietpi ${MUPI_SRC}/config/templates/crontab.template >&3 2>&3
	sudo -H -u dietpi bash -c "/usr/bin/crontab ${MUPI_SRC}/config/templates/crontab.template"  >&3 2>&3

	if grep -q '^dtparam=gpio=on' /boot/config.txt; then
	  echo -e "dtparam=gpio=on already set" >&3 2>&3
	else
	  echo '' | tee -a /boot/config.txt >&3 2>&3
	  echo 'dtparam=gpio=on' | tee -a /boot/config.txt >&3 2>&3
	fi

	if grep -q '^dtoverlay=gpio-poweroff,gpiopin=4,active_low=1' /boot/config.txt; then
	  echo -e "dtparam=gpio=on already set" >&3 2>&3
	else
	  echo '' | tee -a /boot/config.txt >&3 2>&3
	  echo 'dtoverlay=gpio-poweroff,gpiopin=4,active_low=1' | tee -a /boot/config.txt >&3 2>&3
	fi

	#if grep -q '^initramfs initramfs.img' /boot/config.txt; then
	#  echo -e "initramfs initramfs.img already set"
	#else
	#  echo '' | tee -a /boot/config.txt >&3 2>&3
	#  echo 'initramfs initramfs.img' | tee -a /boot/config.txt >&3 2>&3
	#fi
	usermod -aG dialout dietpi >&3 2>&3
	after=$(date +%s)
	echo -e "## Set environment	##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))
	
	###############################################################################################

	echo -e "XXX\n{STEP}\nDownload OnOffShim-Scripts... \nXXX"	
	before=$(date +%s)
	# ══ DER AUSSCHALTER — UND WARUM DIESE VIER ZEILEN DER GANZE UMBAU SIND ══
	#
	# HIER STAND:
	#     mv …/off_trigger.sh /var/lib/dietpi/postboot.d/off_trigger.sh
	# und solange das dort stand, war jede Arbeit an off_trigger.sh auf einer
	# AKTUALISIERTEN Box wirkungslos. Die Box des Betreibers IST eine
	# aktualisierte Box. `autosetup.sh` ist am 07.08.2026 auf den Weg ueber
	# `mupi_offtrigger.service` umgestellt worden — aber autosetup laeuft nur
	# beim Bespielen einer frischen Karte. Diese Datei hier ist der EINZIGE
	# Weg, der eine laufende Box je erreicht.
	#
	# UND postboot.d KONNTE ES OHNEHIN NICHT TRAGEN. `/boot/dietpi/postboot`
	# ruft die Skripte dort NACHEINANDER auf und WARTET auf ihr Ende:
	#     for f in /var/lib/dietpi/postboot.d/*; do … "$f" || echo …; done
	# off_trigger.sh endet nie (`while true`). Es haette den Rest von postboot
	# dauerhaft aufgehalten und dietpi-postboot.service auf „activating" stehen
	# lassen.
	#
	# DER ALTE STAND MUSS WEG, NICHT NUR DER NEUE HIN. Bliebe die Datei in
	# postboot.d liegen, liefen nach dem Update ZWEI Waechter: einer aus der
	# Unit, einer aus postboot. Beide zaehlen denselben Druck, und im Sandkasten
	# ist gemessen, was daraus wird — ein Druck, zweimal gezaehlt. Ausserdem
	# straeuben sich dann zwei Prozesse um dieselbe GPIO-Leitung, und der
	# zweite bekommt sie nicht.
	#
	# `taster_wache.py` MUSS MIT. Ohne den Helfer meldet off_trigger.sh „der
	# Waechter kam nicht hoch" und endet — der Dienst laeuft dann in einer
	# Neustartschleife statt zu bewachen. Die Unit selbst wird weiter oben mit
	# den uebrigen nach /etc/systemd/system/ gelegt.
	mkdir -p /usr/local/bin/mupibox >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/OnOffShim/off_trigger.sh /usr/local/bin/mupibox/off_trigger.sh >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/OnOffShim/taster_wache.py /usr/local/bin/mupibox/taster_wache.py >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/OnOffShim/poweroff.sh /usr/lib/systemd/system-shutdown/poweroff.sh >&3 2>&3
	chmod 775 /usr/lib/systemd/system-shutdown/poweroff.sh /usr/local/bin/mupibox/off_trigger.sh /usr/local/bin/mupibox/taster_wache.py >&3 2>&3
	rm -f /var/lib/dietpi/postboot.d/off_trigger.sh >&3 2>&3

	# ══ EINSCHALTEN ERST JETZT — UND ZWAR NICHT AUS ORDNUNGSLIEBE ══════════
	#
	# `systemctl enable`/`start` fuer diesen Dienst stand bis eben oben bei den
	# uebrigen Diensten, rund achtzig Zeilen VOR diesem Block. Dort gab es
	# /usr/local/bin/mupibox/off_trigger.sh aber noch gar nicht — auf einer Box,
	# die zum ersten Mal auf diesen Stand aktualisiert, liegt an dieser Stelle
	# nichts unter diesem Pfad.
	#
	# AM GERAET NACHGESTELLT (Box .169, 08.08.2026): `systemctl start` gab
	# trotzdem 0 zurueck, im Protokoll stand „Failed at step EXEC … status=203",
	# und der Dienst drehte sich mit Restart=always alle fuenf Sekunden im
	# Kreis, bis die Datei da war. Er FAENGT sich also — aber bis dahin laeuft
	# er die ganze restliche Aktualisierung lang in einer Neustartschleife und
	# schreibt vier Fehlerzeilen je Runde ins Journal. Und wer den Verlauf
	# hinterher ansieht, findet einen Neustartzaehler, der nichts mit dem
	# Ausschalter zu tun hat.
	#
	# SCHLIMMER IST DER ABBRUCH: bricht die Aktualisierung zwischen den beiden
	# Stellen ab, bleibt eine eingeschaltete Unit zurueck, die auf eine Datei
	# zeigt, die nie kommt — UND der alte Stand in postboot.d ist dann auch noch
	# da, weil das `rm -f` oben erst hier steht.
	#
	# ANGELEGT IST NICHT EINGESCHALTET: ohne diese beiden Zeilen laege die Unit
	# unter /etc/systemd/system/ und liefe trotzdem nie — vor der Box ist das
	# nicht zu unterscheiden von „gar nicht da", der Knopf tut in beiden Faellen
	# nichts. Und es ist `restart` und nicht `start`: auf einer Box, die schon
	# einmal auf diesen Stand aktualisiert wurde, LAEUFT der Dienst bereits —
	# mit dem ALTEN off_trigger.sh im Speicher. Ein `start` waere dort ein
	# Nichtstun, und jede kuenftige Berichtigung an dieser Datei kaeme erst beim
	# naechsten Hochfahren an. `restart` holt sie sofort.
	systemctl daemon-reload >&3 2>&3
	systemctl enable mupi_offtrigger.service >&3 2>&3
	systemctl restart mupi_offtrigger.service >&3 2>&3
	after=$(date +%s)
	echo -e "## OnOff Shim	##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################


	echo -e "XXX\n{STEP}\nUpdate Admin-Interface... \nXXX"	
	before=$(date +%s)
	chown -R dietpi:dietpi /home/dietpi/MuPiBox/media/cover >&3 2>&3
	echo -e "## Admin-Interface	##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nUpdate Config-File... \nXXX"	
	before=$(date +%s)
	cd ${MUPI_SRC}/update/	>&3 2>&3
	chmod 755 conf_update.sh >&3 2>&3
	./conf_update.sh >&3 2>&3
	after=$(date +%s)
	echo -e "## Config-File	##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))
	
	
	###############################################################################################

	echo -e "XXX\n{STEP}\nNetwork optimization... \nXXX"	
	before=$(date +%s)

	cd /usr/local/bin/mupibox/	>&3 2>&3
	./optimize_wifi.sh >&3 2>&3
	after=$(date +%s)
	echo -e "## Network optimization ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n{STEP}\nActivate SSL... \nXXX"	
	before=$(date +%s)
	
	after=$(date +%s)
	echo -e "## Network optimization ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nRestore Userdata... \nXXX"
	before=$(date +%s)
	# DAS ZURUECKSTELLEN IST LAENGST PASSIERT — direkt nach dem Auspacken, oben
	# im Block MUPI-BESTAND-TAUSCH. Hier stand es frueher, und dazwischen lagen
	# npm-Installationen, Paketdownloads und Dienstneustarts: minutenlang neuer
	# Code ohne Daten. Wer hier etwas ergaenzen will, ergaenzt es DORT.
	#
	# Die beiden `chown` von damals sind ebenfalls dort abgedeckt: der Baum
	# bekommt oben ein `chown dietpi:dietpi -R`, und das trifft jetzt auch
	# server/config, weil der Bestand zu dem Zeitpunkt schon steht.
	after=$(date +%s)
	echo -e "## Restore Userdata  ##  finished after $((after - $before)) seconds" >&3 2>&3
	STEP=$(($STEP + 1))

	###############################################################################################
	
	echo -e "XXX\n${STEP}\nFinalizing setup... \nXXX"
	#cp ${CONFIG} ${CONFIG}_backup  >&3 2>&3
	/usr/bin/cat <<< $(/usr/bin/jq --arg v "${VERSION_LONG}" '.mupibox.version = $v' ${CONFIG}) >  ${CONFIG}
	chown dietpi:dietpi ${CONFIG}
	chmod 775 ${CONFIG}
	#systemctl start mupi_idle_shutdown.service >&3 2>&3
	rm -f /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/network.json >&3 2>&3
	ln -s /tmp/network.json /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/network.json >&3 2>&3
	systemctl stop mupi_change_checker.service >&3 2>&3
	systemctl disable mupi_change_checker.service >&3 2>&3
	rm /etc/systemd/system/mupi_change_checker.service >&3 2>&3
	/usr/local/bin/mupibox/./m3u_generator.sh >&3 2>&3
	/usr/local/bin/mupibox/./setting_update.sh >&3 2>&3
	service librespot restart >&3 2>&3
	
	mv ${LOG} /boot/$(date +%F)_update_${VERSION}.log >&3 2>&3
	chown dietpi:dietpi ${CONFIG} >&3 2>&3
	
	sudo -H -u dietpi bash -c "cd /home/dietpi/.mupibox/Sonos-Kids-Controller-master && npm install" >&3 2>&3
	# FRUEHER: `sudo -H -u dietpi bash -c "pm2 start server"` (bis 14.08.2026).
	# Gegenstueck zum `systemctl stop` weiter oben. Auch hier fehlte der
	# Abspieldienst — nach einem Update war er bis zum naechsten Neustart aus.
	#
	# `enable --now`, NICHT mehr nur `start` (22.08.2026). Hier stand: „ein
	# Update soll den Einschaltzustand nicht umschreiben" — das setzte
	# voraus, dass die Units schon liegen und enabled sind. Seit dieser Weg
	# die beiden Units SELBST legt (Abschnitt „Restarting Services"), gibt es
	# den Fall, dass sie hier zum ERSTEN Mal existieren: eine Box aus der
	# pm2-Aera. Ein blosses `start` hielte dort bis zum naechsten Neustart,
	# danach zeigte die Box nichts mehr an — und niemand suchte im Update.
	# Einen „bewusst abgeschalteten" mupibox-server gibt es dagegen nicht:
	# ohne diese beiden Dienste ist die Box keine Box.
	systemctl enable --now mupibox-server.service >&3 2>&3
	# ══ DIE BOX MUSS SICH IM NETZ MELDEN (20.09.2026) ════════════════════
	#
	# Betreiber: „es gibt immer wieder die frage welche ip, das muessen wir
	# doch besser hinbekommen." Die Antwort auf „welche IP" ist, dass man sie
	# gar nicht braucht: <name>.local findet die Box, egal welche Adresse der
	# DHCP gerade vergeben hat.
	#
	# INSTALLIERT WAR AVAHI BIS HEUTE AUF KEINEM DER BEIDEN WEGE. Dass die
	# Box im Haus trotzdem unter MixPiBox.local zu erreichen war, lag an
	# DietPi — also an Glueck, nicht an diesem Projekt. Auf einer frischen
	# Karte konnte es anders ausgehen, und niemand haette gewusst warum.
	#
	# `enable --now`, weil Installieren nicht Einschalten ist: ein Dienst, der
	# liegt und nicht laeuft, beantwortet keine einzige Anfrage.
	#
	# GEGENSTUECK: `remote-step-installer/recipes/perf-tune.yaml` bietet an,
	# avahi ABZUSCHALTEN — ausdruecklich „NUR wenn du die Box nicht per
	# <name>.local ansprichst". Wer das waehlt, nimmt sich die Auffindbarkeit;
	# das ist seine Entscheidung und steht dort so.
	systemctl enable --now avahi-daemon >&3 2>&3
	systemctl enable --now mupibox-player.service >&3 2>&3
	# NICHT STILL SCHEITERN LASSEN. Ein Update, nach dem die Box nichts mehr
	# anzeigt, muss im Protokoll stehen — sonst sucht man am naechsten Tag im
	# Frontend nach einem Fehler, der im Dienst liegt.
	for dienst in mupibox-server mupibox-player; do
		systemctl is-active --quiet ${dienst}.service \
			|| echo "## ${dienst} is NOT active after update - check 'journalctl -u ${dienst}' ##" >&3 2>&3
	done

	CPU=$(cat /proc/cpuinfo | grep Serial | cut -d ":" -f2 | sed 's/^ //') >&3 2>&3
	curl -X POST https://mupibox.de/mupi/ct.php -H "Content-Type: application/x-www-form-urlencoded" -d key1=${CPU} -d key2=Update -d key3="${VERSION_LONG}" -d key4="${ARCH}" -d key5="${OS}" >&3 2>&3

	###############################################################################################
	echo -e "XXX\n100\nInstallation complete, please reboot the system... \nXXX"	
	rm -R ${MUPI_SRC} >&3 2>&3
	sleep 5


} | whiptail --title "MuPiBox Update ${VERSION_LONG}" --gauge "Please wait while installing" 6 60 0

# EIN ABBRUCH DARF NICHT „finished" HEISSEN.
# Der Block oben laeuft in einer Pipeline, also in einer Subshell: ein `exit 1`
# darin beendet nur diese Subshell, und danach stand hier bisher in jedem Fall
# die Erfolgsmeldung. Wer vor dem Bildschirm sitzt, haette „Update finished"
# gelesen und neu gestartet — im Glauben, es sei gutgegangen. Der Merker sagt
# es dem aeusseren Skript.
if [ -e "${MUPI_ABBRUCH}" ]; then
	rm -f "${MUPI_ABBRUCH}"
	echo "Update ABGEBROCHEN. Es ist nichts verloren - Einzelheiten in ${LOG}."
	echo "Dieses Skript laesst sich gefahrlos noch einmal starten."
	exit 1
fi
echo "Update finished - please reboot system now!"
