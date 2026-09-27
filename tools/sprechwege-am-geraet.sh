#!/usr/bin/env bash
# WOZU: Es gibt in dieser Box ZWEI Sprechwege, und die Frage „braucht man
#       beide?" laesst sich nur am Geraet beantworten, nicht am Quelltext.
#
#         Weg A  „say"   — Abspieldienst (spotify-control.js, Port 5005).
#                          Holt den Ton bei GOOGLE (google-tts-api), legt ihn
#                          als MP3 unter /home/dietpi/MuPiBox/tts_files ab und
#                          spielt ihn ueber mplayer. Braucht INTERNET.
#         Weg B  Piper   — Server (server.js, Port 8200),
#                          GET /api/vorlesen/sprich. Rechnet auf der Box,
#                          legt WAV in ~/.mupibox/vorlesen-cache, wird vom
#                          BROWSER abgespielt. Braucht KEIN Internet.
#
#       Gemessen werden fuer beide: kommt ueberhaupt Ton heraus, wie lange
#       dauert es, und wo landet die Datei.
#
# AUFRUF:  tools/sprechwege-am-geraet.sh [BOX] [TEXT]
#          tools/sprechwege-am-geraet.sh 192.168.178.169 "Zwei Wege"
#
# ACHTUNG: Weg A SPIELT den Ton ueber den Lautsprecher der Box. Wer nachts
#          misst, drehe vorher leise (das Skript liest die Lautstaerke aus und
#          schreibt sie hin, aendert sie aber NICHT — eine Messung, die die
#          Box umstellt, ist keine Messung).
#
# NICHTS WIRD VERAENDERT: nur gelesen, plus ein einzelner say-Befehl. Der
# Abspieldienst wird danach mit /stop wieder angehalten.

set -u
BOX="${1:-192.168.178.169}"
TEXT="${2:-Sprechwege Probe $(date +%H%M%S)}"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=6 dietpi@${BOX}"

echo "== Box ${BOX} =="
$SSH "echo 'erreichbar'" >/dev/null 2>&1 || { echo "Box antwortet nicht."; exit 1; }

echo
echo "-- Lautstaerke (wird NICHT geaendert) --"
$SSH "amixer 2>/dev/null | grep -m1 '%'"

echo
echo "-- Weg A: Ablage des Abspieldienstes --"
# Diese eine Zeile entscheidet alles: existiert das Verzeichnis nicht, scheitert
# downloadTTS() an fs.writeFileSync mit ENOENT — NACHDEM es den Ton bei Google
# geholt hat. Der Fehler landet in .catch(console.error) und ist am Bildschirm
# unsichtbar.
$SSH "ls -ld /home/dietpi/MuPiBox/tts_files 2>&1 | head -1"

echo
echo "-- Weg A: kommt die Box ueberhaupt an Google? --"
$SSH "curl -s -o /dev/null -m 8 -w 'HTTP %{http_code} in %{time_total}s\n' 'https://translate.google.com/translate_tts?ie=UTF-8&q=test&tl=de&client=tw-ob' 2>&1"

echo
echo "-- Weg A: say absetzen und im Protokoll nachsehen --"
$SSH "curl -s -o /dev/null -m 5 'http://127.0.0.1:5005/current/say/$(printf '%s' "$TEXT" | sed 's/ /%20/g')'"
sleep 4
$SSH "journalctl -u mupibox-player.service --no-pager --since '-30 seconds' 2>/dev/null | grep -iE 'tts|say|error|ENOENT' | tail -12"
$SSH "curl -s -o /dev/null -m 5 'http://127.0.0.1:5005/current/stop'"
$SSH "ls -la /home/dietpi/MuPiBox/tts_files 2>&1 | tail -3"

echo
echo "-- Weg B: Piper ueber die Schnittstelle --"
$SSH "curl -s -m 30 -o /tmp/sprechwege-probe.wav -w 'HTTP %{http_code}, %{size_download} Bytes, %{time_total}s (kalt)\n' 'http://127.0.0.1:8200/api/vorlesen/sprich?text=$(printf '%s' "$TEXT" | sed 's/ /%20/g')'"
$SSH "curl -s -m 30 -o /dev/null -w 'HTTP %{http_code}, %{size_download} Bytes, %{time_total}s (warm)\n' 'http://127.0.0.1:8200/api/vorlesen/sprich?text=$(printf '%s' "$TEXT" | sed 's/ /%20/g')'"
$SSH "file /tmp/sprechwege-probe.wav; rm -f /tmp/sprechwege-probe.wav"

echo
echo "-- Weg B: eingestellte Stimme und Sprachen --"
$SSH "curl -s -m 5 http://127.0.0.1:8200/api/vorlesen | python3 -c 'import json,sys; d=json.load(sys.stdin); print(\"Modus:\", d[\"einstellungen\"][\"modus\"], \"Stimme:\", d[\"einstellungen\"][\"stimme\"], \"Tempo:\", d[\"einstellungen\"][\"tempo\"]); print(\"Stimmen:\", \", \".join(s[\"id\"] for s in d[\"stimmen\"]))'"

echo
echo "-- Was das Board anbietet (googlettslanguages) --"
$SSH "jq -r '.mupibox.ttsLanguage as \$a | .mupibox.googlettslanguages | \"eingestellt: \" + \$a + \", zur Auswahl: \" + (length|tostring) + \" Sprachen\"' /etc/mupibox/mupiboxconfig.json 2>&1"
