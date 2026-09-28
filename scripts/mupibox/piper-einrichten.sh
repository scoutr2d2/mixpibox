#!/bin/bash
# Piper einrichten — damit eine frische Box ueberhaupt sprechen KANN.
#
# WOZU
# Seit dem 04.08.2026 spricht die Box ihre Kachelnamen ueber Piper, und Google
# TTS ist abgeloest ([[google-tts-abgeloest]]). Der alte Weg lief ohnehin nie —
# er holte Ton bei Google und legte ihn in ein Verzeichnis, das es nicht gab
# (ENOENT im Protokoll, gefangen in .catch(console.error), am Bildschirm nichts).
#
# ABER: Piper kam nie ueber einen Installationsweg auf die Box. Er wurde auf der
# Entwicklungsbox VON HAND eingerichtet ([[vorlesen-tts]], Abschnitt
# EINRICHTUNG); weder autosetup.sh noch der remote-step-installer kannten ihn.
# Solange Vorlesen ein Zusatz war, war das nur unschoen. Jetzt ist Sprechen ein
# beworbenes Merkmal — und eine frische SD-Karte spraeche gar nicht mehr.
# Deshalb dieses Skript, und deshalb wird es aus autosetup.sh UND aus
# update/start_mupibox_update.sh aufgerufen.
#
# WAS DER SERVER ERWARTET (src/backend-api/src/server.ts, Zeilen 5600 ff.) —
# und was hier deshalb entstehen muss, Punkt fuer Punkt:
#   /home/dietpi/.mupibox/piper-venv/bin/piper     GET /api/vorlesen meldet
#                                                  `bereit` genau an DIESER Datei
#   /home/dietpi/.mupibox/piper-venv/bin/python    startet `piper.http_server`
#                                                  und `piper.download_voices`
#   /home/dietpi/.mupibox/piper-stimmen/*.onnx     ohne eine einzige Stimme
#                                                  meldet der Abspieler "still"
# Der Zwischenspeicher (~/.mupibox/vorlesen-cache) wird NICHT hier angelegt —
# den macht der Server selbst beim ersten Sprechen.
#
# WARUM KEIN SYSTEMWEITES pip: piper-tts zieht onnxruntime und numpy nach. Auf
# einem Debian mit `externally-managed-environment` geht das nur mit
# --break-system-packages, und dann haengen sie in derselben Python-Installation
# wie mqtt.py und mupihat.py. Ein eigener venv kostet ein paar hundert MB
# Platz und keine einzige fremde Abhaengigkeit.
#
# DREI FALLEN, ALLE SCHON BEZAHLT
#  1. `python3 -m venv` scheitert ohne das Paket python3-venv an ensurepip —
#     die Fehlermeldung nennt dabei die VERSIONIERTE Form (python3.13-venv) und
#     nicht das Metapaket. Hier wird deshalb vorher geprueft, ob ensurepip
#     ueberhaupt da ist, statt die Fehlermeldung zu lesen.
#  2. `piper.http_server` braucht zusaetzlich flask — piper-tts allein bringt es
#     NICHT mit. Fehlt es, faellt der Server auf den Einzelaufruf zurueck.
#     KORREKTUR VOM 04.08.2026 (Gegenlesen, am Quelltext nachgerechnet): das
#     kostet NICHT 2,2 s statt 0,17 s, wie hier zuerst stand, sondern rund
#     17 s je NEUEM Satz. server.ts startet den Dienst und wartet danach
#     30 x 500 ms auf eine Antwort (piperDienstStarten). Ohne flask stirbt der
#     Prozess sofort, aber die Schleife laeuft trotzdem 15 s zu Ende; erst
#     danach kommen die 2,2 s des Einzelaufrufs. Und die Merkung hilft nicht:
#     der `close`-Behandler setzt piperDienstBereit auf null zurueck, der
#     naechste ungespeicherte Satz wartet also WIEDER 15 s. Der Zaun im
#     Abspieler (4 s) bricht das fuer den Benutzer ab — das Kind hoert dann
#     gar nichts und die Musik faengt an. Also nicht "irgendwie langsam",
#     sondern "liest meistens nicht vor". (python3-flask aus apt hilft nicht —
#     der venv sieht die Systempakete nicht.)
#  3. Der venv und die Stimmen muessen DIETPI gehoeren. Der Server laeuft als
#     `User=dietpi` (mupibox-server.service; bis 14.08.2026 stand hier "unter
#     pm2 als dietpi" — der Benutzer stimmte, der Verwalter nicht mehr) und
#     laedt ueber POST /api/vorlesen/stimme weitere Stimmen nach — er schreibt
#     also selbst in das Stimmenverzeichnis.
#
# UNGEPRUEFT AUF 32 BIT: fuer armhf gibt es kein onnxruntime-Rad, `pip install`
# muesste dort uebersetzen und scheitert vermutlich. Das Skript bricht deshalb
# nicht den ganzen Installationslauf ab, sondern meldet den Fehlschlag und geht
# mit 1 hinaus. Eine Box ohne Piper ist eine Box, die nicht vorliest — sie ist
# keine kaputte Box.
#
# WAS DIESER SCHRITT AUF EINE FRISCHE KARTE HOLT — am 04.08.2026 auf der Box
# .169 GEMESSEN (nur gelesen, nichts veraendert):
#   venv mit piper-tts 1.6.0, onnxruntime 1.28.0, numpy 2.5.1, Flask 3.1.3
#                                       184 MB
#   de_DE-ramona-low.onnx                60 MB   (+ .onnx.json, 4 KB)
#                                      ------
#                                      ~244 MB, alles aus dem Netz
# Die Karte hat Platz (117 GB, 5,7 GB belegt); die ZEIT ist der Engpass, und
# dafuer steht die Zeitgrenze von 1200 s in den Ausrollwegen.
#
# AB WERK AN — ABER NUR AUF EINER FRISCHEN BOX (BACKLOG E12/X12, Betreiber
# 28.09.2026: „ja erst aktivieren"). Bis dahin stand hier die Einschraenkung,
# dass jede frische Karte ~244 MB und bis zu 20 Minuten fuer ein Merkmal zahlt,
# das ab Werk AUS ist. Jetzt legt `--ab-werk-an` nach gelungener Einrichtung
# eine `vorlesen.json` mit `{"modus": "antippen"}` an — und zwar NUR, wenn
# noch keine da ist, und NUR, wenn `bericht` sagt, dass die Box sprechen kann
# (auf 32 Bit scheitert pip, dann bleibt es still aus statt still kaputt).
#
# WARUM NICHT EINFACH `EINSTELLUNGEN_VORGABE.modus` UMSTELLEN: die Vorgabe
# gilt fuer jede Box OHNE vorlesen.json — also auch fuer jede, die seit
# Monaten laeuft und den Schalter nie angefasst hat. Beim naechsten Update
# spraeche die ploetzlich bei jedem Tipp. Das ist dieselbe Regel wie beim
# Spiele-Schalter und beim Start-Modus (llmwiki
# `ein-neuer-schalter-darf-nichts-wegnehmen`): „nicht gesagt" heisst auf einer
# laufenden Box „wie bisher". Deshalb uebergeben den Schalter nur die beiden
# Wege, die eine Box NEU aufsetzen (autosetup.sh, Rezeptschritt `piper` in
# mupibox-app.yaml) — der Update-Weg nicht. Die Wache dafuer steht in
# tools/piper-installationsweg-abgleich.py, der Verhaltenstest in
# tools/piper-ab-werk.test.sh.
#
# WARUM TROTZDEM HIER UND NICHT ERST BEIM EINSCHALTEN: der Schalter im
# Eltern-Bereich kann nur STIMMEN nachladen (POST /api/vorlesen/stimme), keinen
# venv bauen — dafuer braeuchte er root. Wer den Schritt hierher verschieben
# will, muss also erst diesen Weg bauen. Bis dahin waere die Alternative ein
# Schalter, der sich umlegen laesst und danach nichts tut, und das ist genau
# die Sorte Fehler, wegen der dieses Skript ueberhaupt entstanden ist.
#
# HERKUNFT UND LIZENZ DER STIMMEN — HIER STEHT ABSICHTLICH KEINE ZAHL.
# `piper.download_voices` holt die Modelle zur Laufzeit von HuggingFace
# (rhasspy/piper-voices). Die Lizenz haengt AN DER EINZELNEN STIMME, nicht an
# Piper, und sie ist fuer die Vorgabestimme in diesem Projekt bisher NICHT
# nachgeschlagen. Solange das offen ist: keine Stimme mit auf ein Abbild
# packen, das weitergegeben wird. Nachgeladen wird sie ohnehin je Box.
# Vermerkt im BACKLOG als eigener Punkt.
#
# AUFRUF
#   piper-einrichten.sh                     einrichten; was da ist, bleibt
#   piper-einrichten.sh --pruefen           nur nachsehen, nichts aendern
#   piper-einrichten.sh --stimme de_DE-thorsten-medium   eine weitere Stimme
#   piper-einrichten.sh --ab-werk-an        einrichten, und auf einer FRISCHEN
#                                           Box Vorlesen einschalten (nur fuer
#                                           autosetup.sh und das Rezept)
set -u

VENV="${MUPIBOX_PIPER_VENV:-/home/dietpi/.mupibox/piper-venv}"
# Derselbe Name wie im Server (server.ts: `process.env.MUPIBOX_CONFIG_DIR`).
KONFIG="${MUPIBOX_CONFIG_DIR:-/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config}"
AB_WERK_AN=0
[ "${1:-}" = "--ab-werk-an" ] && AB_WERK_AN=1
STIMMEN="${MUPIBOX_PIPER_STIMMEN:-/home/dietpi/.mupibox/piper-stimmen}"
# de_DE-ramona-low ist die Vorgabe in src/backend-api/src/vorlesen.ts
# (STIMME_VORGABE). Sie wurde nicht nach Datenblatt gewaehlt, sondern indem alle
# vier deutschen Piper-Stimmen ueber den LAUTSPRECHER DER BOX vorgespielt
# wurden. Wer sie hier aendert, muss sie DORT mitaendern — sonst zeigt die
# Verwaltung eine Stimme an, die auf der Karte fehlt.
STIMME="${MUPIBOX_PIPER_STIMME:-de_DE-ramona-low}"
BESITZER="${MUPIBOX_PIPER_BESITZER:-dietpi:dietpi}"

PY="${VENV}/bin/python"
PIPER="${VENV}/bin/piper"

sagen() { echo "piper-einrichten: $*"; }

# Nur nachsehen — genau die drei Dinge, an denen der Server `bereit` festmacht.
bericht() {
  local anzahl=0 m
  # EINE STIMME SIND ZWEI DATEIEN. Am 04.08.2026 auf der Box nachgesehen:
  # neben jeder *.onnx liegt eine *.onnx.json (rund 4 KB) — piper liest sie
  # fuer Lautschrift und Abtastrate. Nur die .onnx zu zaehlen war der Fehler
  # der ersten Fassung: bricht der Download nach dem grossen Modell ab, sieht
  # der Bericht "1 Stimme" und meldet bereit, waehrend jeder Sprechversuch
  # scheitert. Es ist dieselbe Sorte Luege wie `bereit: fs.existsSync(piper)`.
  if [ -d "${STIMMEN}" ]; then
    for m in "${STIMMEN}"/*.onnx; do
      [ -f "${m}" ] && [ -f "${m}.json" ] && anzahl=$((anzahl + 1))
    done
  fi
  echo "  venv       : ${VENV} $( [ -x "${PY}" ] && echo 'da' || echo 'FEHLT' )"
  echo "  piper      : ${PIPER} $( [ -x "${PIPER}" ] && echo 'da' || echo 'FEHLT' )"
  echo "  flask      : $( [ -x "${PY}" ] && "${PY}" -c 'import flask' 2>/dev/null && echo 'da' || echo 'FEHLT — jeder neue Satz kostet dann rund 17 s statt 0,17 s' )"
  echo "  Stimmen    : ${STIMMEN} — ${anzahl} Stueck (Modell UND .onnx.json)"
  { [ -f "${STIMMEN}/${STIMME}.onnx" ] && [ -f "${STIMMEN}/${STIMME}.onnx.json" ]; } \
    && echo "  Vorgabe    : ${STIMME} da" || echo "  Vorgabe    : ${STIMME} FEHLT"
  # Sprechen kann die Box nur, wenn BEIDES stimmt. Genau so fragt es auch
  # backend-player/src/sprechen.ts (bereitAus): Programm da UND Stimme da.
  [ -x "${PIPER}" ] && [ "${anzahl}" -gt 0 ]
}

if [ "${1:-}" = "--pruefen" ]; then
  bericht
  exit $?
fi

# Eine weitere Stimme, ohne den Rest anzufassen.
if [ "${1:-}" = "--stimme" ]; then
  [ -n "${2:-}" ] || { sagen "--stimme braucht einen Namen, z. B. de_DE-thorsten-medium"; exit 2; }
  STIMME="$2"
  [ -x "${PY}" ] || { sagen "kein venv unter ${VENV} — erst ohne Schalter aufrufen"; exit 1; }
  mkdir -p "${STIMMEN}"
  ( cd "${STIMMEN}" && "${PY}" -m piper.download_voices "${STIMME}" ) || {
    sagen "Stimme ${STIMME} liess sich nicht laden"; exit 1; }
  chown -R "${BESITZER}" "${STIMMEN}" 2>/dev/null || true
  sagen "Stimme ${STIMME} liegt in ${STIMMEN}"
  exit 0
fi

###############################################################################
# 1. venv bauen
###############################################################################
if [ ! -x "${PY}" ]; then
  # ensurepip ist der Teil, der ohne python3-venv fehlt. Ihn direkt zu fragen
  # ist ehrlicher als auf den Abbruch von `python3 -m venv` zu warten.
  if ! python3 -c 'import ensurepip' >/dev/null 2>&1; then
    sagen "ensurepip fehlt — installiere python3-venv"
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv >/dev/null 2>&1 || {
      # Das Metapaket gibt es nicht ueberall; dann die versionierte Form aus
      # der laufenden Python-Version ableiten, statt eine Zahl zu raten.
      PVER=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
      sagen "python3-venv nicht verfuegbar — versuche python${PVER}-venv"
      DEBIAN_FRONTEND=noninteractive apt-get install -y "python${PVER}-venv" >/dev/null 2>&1 || true
    }
  fi
  mkdir -p "$(dirname "${VENV}")"
  python3 -m venv "${VENV}" || { sagen "venv liess sich nicht anlegen"; exit 1; }
  sagen "venv angelegt: ${VENV}"
else
  sagen "venv war schon da: ${VENV}"
fi

###############################################################################
# 2. piper-tts und flask hinein
###############################################################################
if [ ! -x "${PIPER}" ]; then
  sagen "installiere piper-tts (zieht onnxruntime nach, dauert)"
  "${VENV}/bin/pip" install --no-cache-dir piper-tts || {
    sagen "piper-tts liess sich nicht installieren — die Box liest nicht vor"
    sagen "  (auf 32-Bit-Systemen erwartbar: kein onnxruntime-Rad fuer armhf)"
    exit 1
  }
else
  sagen "piper-tts war schon da"
fi

# Ohne flask laeuft nur der langsame Weg — deshalb wird das hier NICHT
# stillschweigend uebergangen, sondern gemeldet. Die Zahl stand hier bis zum
# 04.08.2026 falsch (2,2 s); es sind rund 17 s, und warum, steht oben in
# Falle 2. Beim Gegenlesen korrigiert, weil eine zu kleine Zahl an dieser
# Stelle die Meldung harmlos aussehen laesst.
if ! "${PY}" -c 'import flask' >/dev/null 2>&1; then
  "${VENV}/bin/pip" install --no-cache-dir flask || \
    sagen "flask fehlt weiterhin: jeder NEUE Satz kostet rund 17 s statt 0,17 s"
fi

###############################################################################
# 3. Die Vorgabestimme
###############################################################################
mkdir -p "${STIMMEN}"
# BEIDE DATEIEN, sonst wird ein halber Download nie repariert: das Modell sind
# 60 MB, die Beschreibung 4 KB — reisst die Leitung dazwischen ab, war die
# Bedingung "-f .onnx" erfuellt und der naechste Lauf haette nichts mehr getan.
if [ ! -f "${STIMMEN}/${STIMME}.onnx" ] || [ ! -f "${STIMMEN}/${STIMME}.onnx.json" ]; then
  # Der Stimmenkatalog liegt NICHT im Paket — `download_voices` holt ihn zur
  # Laufzeit von HuggingFace (das hat beim ersten Anlauf zwei Versuche
  # gekostet, weil in voices.json gesucht wurde, die es lokal nicht gibt).
  sagen "lade Stimme ${STIMME}"
  ( cd "${STIMMEN}" && "${PY}" -m piper.download_voices "${STIMME}" ) || \
    sagen "Stimme ${STIMME} liess sich nicht laden — spaeter nachholbar mit --stimme"
else
  sagen "Stimme ${STIMME} war schon da"
fi

###############################################################################
# 4. Besitzer — sonst kann der Server keine Stimme nachladen
###############################################################################
chown -R "${BESITZER}" "${VENV}" "${STIMMEN}" 2>/dev/null || true

###############################################################################
# 5. Ab Werk an — nur mit --ab-werk-an, nur ohne vorhandene Einstellung
###############################################################################
# Nur `modus` steht drin: Stimme, Tempo und Interpret kommen weiter aus
# EINSTELLUNGEN_VORGABE in vorlesen.ts. Eine zweite Kopie dieser Werte hier
# liefe beim naechsten Aendern dort still auseinander.
ab_werk_einschalten() {
  local ziel="${KONFIG}/vorlesen.json"
  if [ -e "${ziel}" ]; then
    sagen "vorlesen.json war schon da — bleibt, wie sie ist"
    return 0
  fi
  if [ ! -d "${KONFIG}" ]; then
    sagen "kein Konfigurationsordner unter ${KONFIG} — Vorlesen bleibt aus"
    return 0
  fi
  # Atomar: eine halb geschriebene Datei liest der Server als `{}` = aus.
  printf '{\n  "modus": "antippen"\n}\n' >"${ziel}.neu.$$" \
    && chown "${BESITZER}" "${ziel}.neu.$$" 2>/dev/null
  mv -f "${ziel}.neu.$$" "${ziel}" \
    && sagen "Vorlesen ab Werk eingeschaltet (antippen): ${ziel}"
}

sagen "Stand:"
bericht
ok=$?
if [ "${ok}" -eq 0 ] && [ "${AB_WERK_AN}" -eq 1 ]; then
  ab_werk_einschalten
fi
exit "${ok}"
