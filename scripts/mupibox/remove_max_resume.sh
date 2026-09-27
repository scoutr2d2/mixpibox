#!/bin/bash
#
# lösche alle Einträge mit Category resume.
#
# ══ SEIT DEM 07.08.2026 JE KIND, NICHT MEHR BOX-WEIT ═══════════════════════
#
# WAS VORHER WAR: Das Skript kannte genau EINEN Pfad —
# `server/config/resume.json`. Der ist seit E18 Stufe 3 ein VERWEIS auf
# `profile/<aktiv>/resume.json`. Also traf das Kappen immer nur das GERADE
# AKTIVE Kind. Wer nicht dran war, wurde nie gekappt — seine Liste wuchs, bis
# er zufaellig einmal dran war, und dann fielen auf einen Schlag Wochen heraus.
#
# WAS JETZT IST: Es laeuft ueber ALLE `profile/*/resume.json`, und jedes Kind
# bekommt SEINE Zahl — `merken` aus `profile.json`, sonst `mupibox.resume`.
# Damit ist der Wunsch des Betreibers („besser waere pro profil") an der
# Stelle erfuellt, an der wirklich geloescht wird.
#
# ══ WARUM DAS KAPPEN HIER BLEIBT UND NICHT IN DEN SERVER WANDERT ═══════════
#
# Der Server kappt bereits — aber nur auf SEINEM Weg (`POST /api/weiterhoeren`,
# `stelleEinsetzen`). Der KLASSISCHE Player schreibt ueber `/api/addresume`,
# und der haengt eine Stelle an, ohne je zu kuerzen. Ohne dieses Skript
# waechst die Liste dieses Weges unbegrenzt. Es ist also nicht das zweite
# Kappen neben dem des Servers, sondern das EINZIGE fuer den klassischen Weg.
#
# Dazu kommt: es laeuft als root aus dem Takt heraus und braucht keinen
# laufenden Server. Ein Kappen, das nur passiert, waehrend der Server lebt,
# waere genau dann weg, wenn er nach einem Fehlstart nicht kommt.
#
# ══ DIE FALLE, DIE HIER STEHT UND STEHENBLEIBT ═════════════════════════════
#
# JEDE SCHREIBWEISE, DIE EINE NEUE DATEI AN DIE STELLE SETZT, KAPPT DIE
# BRUECKE. Hier stand `mv ${TMP_RESUME} ${RESUME}` — danach war der alte Ort
# eine gewoehnliche Datei, der Weg zum Kinderordner war weg, und was danach
# gemerkt wurde, landete box-weit statt beim Kind. Das gilt fuer `mv`, fuer
# `jq … > datei.neu && mv`, fuer `sponge` und fuer alles andere, was umbenennt.
#
# Der Bestand der Kinder (`profile/<kennung>/resume.json`) ist KEIN Verweis —
# dort waere `mv` unbedenklich. Trotzdem steht auch dort `cat >`, aus einem
# Grund: wer hier eines Tages wieder auf den alten Ort zeigt, soll nicht auf
# eine Zeile stossen, die dort harmlos aussieht und es nicht ist.

CONFIGDIR="/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"
RESUME="${CONFIGDIR}/resume.json"
BEREICHE="${CONFIGDIR}/profile"
PROFILE_JSON="${CONFIGDIR}/profile.json"
CONFIG="/etc/mupibox/mupiboxconfig.json"
MAXRESUME=$(sudo /usr/bin/jq -r .mupibox.resume ${CONFIG})

# ══ DER ZWISCHENSPEICHER HAT KEINEN FESTEN NAMEN MEHR ══════════════════════
#
# Hier stand `TMP_RESUME="/tmp/.resume.json"` — ein FESTER Name in einem
# Verzeichnis, in das jeder schreiben darf, und dieses Skript laeuft als root.
# Wer vor dem naechsten Takt einen Verweis dieses Namens dorthin legt, dem
# schreibt `jq … > "${TMP_RESUME}"` seinen Inhalt in die Datei am anderen Ende
# — die Umlenkung folgt dem Verweis, und root darf ueberall hin. Der Inhalt ist
# dabei nicht einmal zufaellig: er kommt aus einer `resume.json`, die dietpi
# gehoert. Also: beliebige Datei, beliebiger Inhalt, mit root-Rechten.
# GEMESSEN am 07.08.2026 (tools/kappen-als-root-linse.py, Teil B).
#
# `mktemp` legt die Datei selbst an — mit O_EXCL, einem nicht vorhersagbaren
# Namen und Rechten 600. Ein vorher hingelegter Verweis desselben Namens geht
# damit ins Leere. Das Verzeichnis bleibt `/tmp` (die Karte soll nicht
# beschrieben werden), steht aber in einer Variablen, damit eine Probe es in
# ihren Sandkasten biegen kann, ohne die Zeile umzuschreiben.
TMP_DIR="${TMP_DIR:-/tmp}"

# DIE SPERRE BEHAELT IHREN FESTEN NAMEN — sie ist eine VERABREDUNG und keine
# Bequemlichkeit: server.ts (`resumeLock`), clearresume.sh, get_network.sh und
# check_network.sh nennen genau diesen Pfad. Ein eigener Name hier hiesse, dass
# das root-Skript und der Server sich gegenseitig nicht mehr sehen. Angelegt
# wird sie aber nicht mehr mit `touch` (das folgt einem Verweis und legt am
# anderen Ende eine Datei an), sondern unteilbar — siehe unten.
RESUME_LOCK="/tmp/.resume.lock"

if [ "$EUID" -ne 0 ]
  then echo "Please run as root"
  exit
fi

# Ohne lesbare Box-Zahl die Vorgabe, die dieses Skript seit jeher hatte.
case "${MAXRESUME}" in
	''|*[!0-9]*) MAXRESUME=9 ;;
esac

# Die Zahl EINES Kindes: `merken` aus profile.json, sonst die der Box.
#
# NUR EINE GANZE ZAHL 0..99 ZAEHLT — wortgleich zu `merkenPruefen` in
# src/backend-api/src/profile.ts. Text, Bruch und negative Zahl fallen durch
# und gelten als „keine eigene"; dann greift die Box-Zahl, und das Kind
# verhaelt sich wie vor dem 07.08.2026. Ein Kappen, das sich auf einen
# kaputten Wert einliesse, loeschte still das Falsche.
merken_von() {
	local kennung="$1" wert=""
	if [ -f "${PROFILE_JSON}" ]; then
		wert=$(/usr/bin/jq -r --arg k "$kennung" \
			'[.profile[]? | select(.kennung==$k) | .merken | select(type=="number")] | .[0] // empty' \
			"${PROFILE_JSON}" 2>/dev/null)
	fi
	case "${wert}" in
		''|*[!0-9]*) wert="${MAXRESUME}" ;;
		*) [ "${wert}" -gt 99 ] && wert="${MAXRESUME}" ;;
	esac
	echo "${wert}"
}

# EINE Datei kappen. $1 = Datei, $2 = Deckel, $3 = wie sie im Protokoll heisst.
kappen() {
	local datei="$1" deckel="$2" name="$3" json_output count num_to_delete

	[ -e "${datei}" ] || return 0

	# Anzahl der Einträge mit der Kategorie "resume" zählen
	json_output=$(jq '[.[] | select(.category == "resume")] | length' "${datei}" 2>/dev/null)

	if [ -n "$json_output" ]; then
	    # Versuchen Sie, den Wert in eine ganze Zahl umzuwandeln
	    count=$(echo "$json_output" | awk '{print int($0)}')
	else
	    # Keine Liste, halb geschrieben, unlesbar: NICHTS ANFASSEN. Ein
	    # `cat >` auf eine Datei, die wir nicht verstanden haben, ist das
	    # Loeschen aller gemerkten Stellen dieses Kindes.
	    echo "${name}: unlesbar, unangetastet."
	    return 0
	fi

	if [ $count -gt $deckel ]; then
	    echo "${name}: ${count} Einträge, Deckel ${deckel}. Lösche, bis nur noch ${deckel} übrig sind."

	    # Berechne die Anzahl der Einträge, die gelöscht werden müssen
	    num_to_delete=$((count - $deckel))

	    # ── DIE AELTESTEN 'num_to_delete' RESUME-EINTRAEGE, UND NUR DIE ─────
	    #
	    # HIER STAND `sort_by(.index) | .[$num_to_delete:]` — das schneidet die
	    # ersten n Eintraege ab, EGAL welcher Kategorie. Gezaehlt wird aber (drei
	    # Zeilen weiter oben) nur `.category == "resume"`. Solange nichts anderes
	    # in der Datei liegt, ist das dasselbe; sobald doch, ist es zweimal
	    # falsch: fremde Eintraege werden geloescht, und der Deckel wird gar
	    # nicht erreicht. `stelleEinsetzen` in weiterhoeren.ts laesst fremde
	    # Eintraege ausdruecklich stehen („die Datei ist eine Medienliste, und es
	    # steht nirgends geschrieben, dass nur Resume-Eintraege darin sein
	    # duerfen") — dieses Skript hat sie weggeworfen.
	    #
	    # GEMESSEN am 07.08.2026 (tools/durchkommen-merken.py, Teil E): 6 Resume-
	    # und 6 fremde Eintraege, Deckel 3 — heraus kamen 4 Resume- und 5 fremde.
	    # Beides falsch. Am Geraet steht heute nur `resume` in den Dateien; fuer
	    # eine reine Resume-Liste ist die neue Kette Eintrag fuer Eintrag
	    # dasselbe wie die alte (auch das gemessen).
		jq --argjson num_to_delete "$num_to_delete" '
			sort_by(.index)
			| (to_entries | map(select(.value.category == "resume")) | .[:$num_to_delete] | map(.key)) as $raus
			| to_entries | map(select(.key as $k | $raus | index($k) | not)) | map(.value)
		' "${datei}" > "$TMP_RESUME"
		# DURCH DEN VERWEIS SCHREIBEN, NICHT UEBER IHN.
		#
		# Hier stand `mv ${TMP_RESUME} ${RESUME}`. Seit E18 Stufe 3 ist
		# server/config/resume.json ein VERWEIS auf profile/<kennung>/resume.json
		# (am Geraet nachgesehen, 07.08.2026: -> profile/kalea/resume.json).
		# `mv` ersetzt den Verweis durch eine gewoehnliche Datei — die Bruecke zum
		# Ordner des Kindes ist danach gekappt, und was danach gemerkt wird,
		# landet box-weit statt beim Kind.
		#
		# `cat > ${datei}` FOLGT dem Verweis und schreibt in die Datei dahinter.
		# Der Verweis bleibt stehen.
		#
		# UND ES BLEIBT UNTEILBAR GENUG: `>` kuerzt die Zieldatei und schreibt sie
		# in einem Zug neu. Ein Stromausfall genau dazwischen kann eine halbe
		# Datei hinterlassen — das war mit `mv` besser. Der Preis ist bewusst:
		# eine halbe resume.json kostet gemerkte Stellen, eine gekappte Bruecke
		# kostet sie AUCH und dazu die Zuordnung zum Kind, und zwar still.
		#
		# NUR WENN DIE ZWISCHENDATEI ETWAS ENTHAELT. Ein misslungenes `jq`
		# hinterlaesst eine leere Datei, und `cat` einer leeren Datei ueber den
		# Bestand ist das Loeschen aller gemerkten Stellen dieses Kindes.
		if [ -s "${TMP_RESUME}" ]; then
			/usr/bin/cat "${TMP_RESUME}" > "${datei}"
			echo "${name}: ${num_to_delete} Einträge gelöscht."
		else
			echo "${name}: jq hat nichts geliefert — unangetastet."
		fi
	else
	    echo "${name}: ${count} Einträge, Deckel ${deckel} — nichts zu tun."
	fi

	# ══ `-h`: DEM VERWEIS NICHT NACHGEHEN ══════════════════════════════════
	#
	# Hier stand `chown` ohne `-h`, und `chown` folgt einem Verweis: es fasst
	# die Datei am ANDEREN Ende an. Seit dem 07.08.2026 laeuft diese Zeile
	# ueber JEDE `profile/*/resume.json` statt nur ueber den einen alten Ort —
	# also ueber Dateien in einem Verzeichnis, das dietpi gehoert. Ein Verweis
	# namens `resume.json`, der auf `/etc/shadow` zeigt, machte aus diesem
	# Kappen ein „chown dietpi /etc/shadow", ausgefuehrt von root. Die Datei
	# muss dafuer nicht einmal lesbar sein: geschrieben wird nur, was jq
	# versteht, aber CHOWN passiert in jedem Durchlauf.
	# GEMESSEN am 07.08.2026 (tools/kappen-als-root-linse.py, Teil A).
	#
	# `-h` fasst den VERWEIS an statt sein Ziel. Auf einer gewoehnlichen Datei
	# — und das ist jede `resume.json` auf einer gesunden Box — tut es genau
	# dasselbe wie vorher.
	/usr/bin/chown -h dietpi:dietpi "${datei}"
}

# ══ DIE SPERRE WIRD UNTEILBAR GESETZT ══════════════════════════════════════
#
# Hier stand `if [ -f … ]` und im else-Zweig `touch`. Zwei Fehler in zwei
# Zeilen:
#
#   1. `touch` FOLGT EINEM VERWEIS. Liegt an der Stelle ein Verweis auf eine
#      Datei, die es noch nicht gibt, meldet `[ -f ]` „keine Sperre" — und
#      `touch` legt die Datei am anderen Ende an, als root. GEMESSEN am
#      07.08.2026 (tools/kappen-als-root-linse.py, Teil C).
#   2. ZWISCHEN FRAGE UND TAT ist Platz. Zwei Takte, die sich ueberholen,
#      sehen beide „frei" und kappen gleichzeitig.
#
# `set -C` (noclobber) legt die Datei mit O_EXCL an: sie entsteht genau dann,
# wenn dort noch nichts liegt — und O_EXCL scheitert auch an einem VERWEIS,
# selbst an einem toten. Damit ist Fragen und Setzen EIN Schritt. In einer
# Unterschale, damit noclobber nicht fuer den Rest des Skripts gilt: darunter
# steht `> "${datei}"` und muss weiter ueberschreiben duerfen.
if ! (set -C; : > "${RESUME_LOCK}") 2>/dev/null; then
	echo "Resume-file locked."
    exit
else
	# Der Zwischenspeicher — angelegt, nachdem die Sperre steht, und wieder
	# weggeraeumt, bevor sie faellt. Misslingt er (volles /tmp, nur lesbar),
	# wird NICHT gekappt — aber die Sperre darf trotzdem nicht liegenbleiben,
	# sonst kappt dieses Skript nie wieder. Auch das gemessen (Teil B).
	TMP_RESUME=$(/usr/bin/mktemp "${TMP_DIR}/.resume.XXXXXX")
	if [ -z "${TMP_RESUME}" ] || [ ! -f "${TMP_RESUME}" ]; then
		echo "Kein Zwischenspeicher in ${TMP_DIR} — nichts gekappt."
		rm -f "${RESUME_LOCK}"
		exit 1
	fi

	# ── JEDES KIND, NICHT NUR DAS AKTIVE ────────────────────────────────
	#
	# ABER WIRKLICH NUR KINDER. In `profile/` liegt nicht nur je ein Ordner je
	# Kennung — dort landet auch der BEISEITEGELEGTE Bestand geloeschter Kinder:
	# `bereichBeiseite()` in server.ts benennt `profile/<kennung>` in
	# `profile/geloescht-<kennung>-<zeit>` um, und zwar ausdruecklich, um ihn
	# NICHT wegzuwerfen („beiseitelegen, nicht wegwerfen" — dort steht die ganze
	# Begruendung). Ein Kappen, das dort hineingreift, loescht aus einer
	# Sicherung, und es tut es still: niemand sucht den Verlust in einem Ordner,
	# den er fuer unberuehrt haelt. GEMESSEN am 07.08.2026
	# (tools/durchkommen-merken.py, Teil E): 12 Eintraege eines geloeschten
	# Kindes wurden auf die Box-Zahl gekappt.
	#
	# DIE REGEL IST DIE KENNUNG SELBST — wortgleich zu `KENNUNG_MUSTER` in
	# src/backend-api/src/profile.ts. Ein Bereich heisst immer wie eine Kennung
	# (`bereichPfad` baut keinen anderen Namen), also ist alles, was kein
	# Kennungsname ist, auch kein Bereich: der beiseitegelegte Ordner (er ist
	# mit Zeitstempel immer laenger als 24 Zeichen), ein Ordner mit
	# Leerzeichen, Anfuehrungszeichen oder Grossbuchstaben, und was ein Mensch
	# sonst noch von Hand dort ablegt. Der Praefix wird trotzdem EIGENS
	# genannt: er ist der einzige Fall, den der Server selbst erzeugt, und er
	# soll nicht davon abhaengen, wie lang `Date.now()` eines Tages ist.
	gefunden=0
	for BEREICH in "${BEREICHE}"/*/ ; do
		[ -d "${BEREICH}" ] || continue
		KENNUNG=$(basename "${BEREICH}")
		case "${KENNUNG}" in
			geloescht-*)
				echo "${KENNUNG}: beiseitegelegt, unangetastet."
				continue
				;;
		esac
		if [[ ! "${KENNUNG}" =~ ^[a-z0-9-]{1,24}$ ]]; then
			echo "${KENNUNG}: kein Kinderordner, unangetastet."
			continue
		fi
		DATEI="${BEREICH}resume.json"
		[ -e "${DATEI}" ] || continue
		gefunden=1
		kappen "${DATEI}" "$(merken_von "${KENNUNG}")" "${KENNUNG}"
	done

	# ── DER ALTE ORT ────────────────────────────────────────────────────
	#
	# IST ER EIN VERWEIS, ist er oben schon mitgelaufen — der Verweis zeigt in
	# einen der Bereiche. Ihn ein zweites Mal anzufassen hiesse, dieselbe Datei
	# zweimal zu kappen; beim zweiten Mal steht die Zahl schon, es passierte
	# also nichts — aber es ist eine Schreiboperation zuviel auf einer SD-Karte.
	#
	# IST ER EINE ECHTE DATEI, hat ein Skript (clearresume.sh, oder diese hier
	# in ihrer alten Fassung) die Bruecke ersetzt, oder es gibt noch gar keine
	# Bereiche — eine Box vor E18 Stufe 2. Dann ist er der ganze Bestand und
	# gehoert dem AKTIVEN Kind (so haelt es auch `resumeUebernehmen` in
	# server.ts: der Server weiss nicht, wer geschrieben hat, und wer schrieb,
	# meinte den alten Ort). Also mit dessen Zahl kappen.
	if [ ! -L "${RESUME}" ] && [ -f "${RESUME}" ]; then
		AKTIV=""
		if [ -f "${PROFILE_JSON}" ]; then
			AKTIV=$(/usr/bin/jq -r '.aktiv // empty' "${PROFILE_JSON}" 2>/dev/null)
		fi
		[ -n "${AKTIV}" ] || AKTIV="gast"
		kappen "${RESUME}" "$(merken_von "${AKTIV}")" "alter Ort (${AKTIV})"
	elif [ "${gefunden}" -eq 0 ]; then
		# Weder Bereiche noch eine echte Datei am alten Ort: ein TOTER Verweis
		# (das Kind hat noch nichts angefangen). Nichts zu kappen.
		echo "Nichts gefunden — kein Bereich, kein Bestand."
	fi

	echo "Resume.json cleaned, je Kind nach seiner eigenen Zahl (sonst ${MAXRESUME})"
	/usr/bin/rm -f "${TMP_RESUME}"
	rm -f "${RESUME_LOCK}"
fi
