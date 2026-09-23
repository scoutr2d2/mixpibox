#!/bin/bash
#
# DIE ZWEITE SPOTIFY-TONMASCHINE — Soloist, Spotifys offizieller Headless-Client.
#
# Gegenstueck zu scripts/librespot/librespot-start.sh, und AUSDRUECKLICH eine
# ALTERNATIVE, keine Abloesung (E42, Betreiber 19.08.2026: "als alternative
# einfuehren nicht als abloesung"). Welche von beiden laeuft, entscheidet
# `spotify.engine` in der Konfiguration — die Units pruefen das selbst per
# ExecCondition, dieses Skript muss also nur noch starten.
#
# ══ WAS AM GERAET GEMESSEN IST (E42/S1, 19.08.2026) ═════════════════════════
#
#   · Der PipeWire-Knoten heisst `spotify` (nicht "soloist"), fuehrt
#     F32LE/44100 — den LOSSLESS-Pfad statt librespots 160-kbps-Vorbis —
#     und bleibt in der Pause STEHEN (librespots verschwand bei jedem Stopp).
#   · Ohne -d folgt Soloist der Default-Senke, genau wie librespot. Wer die
#     Klangkette erzwingen will, gibt --pipewire-device.
#   · Der Schluessel ist der KONTOGEBUNDENE spak_… von der Dashboard-Seite
#     "Spotify Soloist API Key" — der clientId der Web-API wird ABGEWIESEN.
#   · Jeder Build verfaellt 90 Tage nach dem BAU (nicht der Installation);
#     er meldet es selbst ("client expires in N days"). Der Updater (E42/S4)
#     fragt das ab. Bis dahin gilt: Soloist ist NIE die Vorgabe.
#
# ══ BEKANNTE GRENZE ═════════════════════════════════════════════════════════
#
# Der Schluessel steht in der Befehlszeile und damit in `ps`. Soloist kennt
# heute keinen anderen Weg (kein Env, keine Schluesseldatei). Auf dieser
# Ein-Benutzer-Box hingenommen; steht als Frage an kuenftige Fassungen.

CONFIG="/etc/mupibox/mupiboxconfig.json"

NAME=$(/usr/bin/jq -r '.mupibox.host // "MuPiBox"' "${CONFIG}")
KEY=$(/usr/bin/jq -r '.spotify.soloistApiKey // ""' "${CONFIG}")

if [ -z "${KEY}" ]; then
    # OHNE SCHLUESSEL GIBT ES NICHTS ZU STARTEN — und die Meldung sagt, wo er
    # herkommt. Exit 1 laesst systemd es mit RestartSec wieder versuchen:
    # vielleicht traegt der Admin ihn gerade ein.
    echo "kein spotify.soloistApiKey in ${CONFIG} - erzeugen unter developer.spotify.com/dashboard, Seite 'Spotify Soloist API Key'"
    exit 1
fi

# Zwischenspeicher wie bei librespot aus maxcachesize (GB -> MB), Deckel der
# Konfiguration. Soloist verlangt mindestens 100 MB.
#
# NUR EIN GLAUBWUERDIGER GB-WERT DARF IN DIE RECHNUNG (E55, 20.08.2026).
# In der Konfig stand 1073741824 — 1 GB, aber in BYTES. Mal 1000 wurden
# daraus 1,07 Billionen MB; Soloist lehnte ab („--cache-size must be 0
# (no limit) or >= 100"), systemd startete neu, und die Box stand mit
# Neustart-Zaehler 10+ dauerhaft auf „meldet sich an". Kein Leser dieses
# Feldes schreibt es — der Byte-Wert war eine Altlast. Alles, was keine
# Zahl bis 64 ist, faellt deshalb auf die Vorgabe 2 zurueck: ein Byte-Wert
# als „64 GB" gedeutet waere nur der naechste stille Unsinn.
CACHE_GB=$(/usr/bin/jq -r '.spotify.maxcachesize // 2' "${CONFIG}")
case "${CACHE_GB}" in *[!0-9]* | '') CACHE_GB=2 ;; esac
[ "${CACHE_GB}" -gt 64 ] && CACHE_GB=2
CACHE_MB=$(( CACHE_GB * 1000 ))
[ "${CACHE_MB}" -lt 100 ] && CACHE_MB=100

# Daten und Cache kommen von systemd (StateDirectory/CacheDirectory in der
# Unit) — Soloist liest $STATE_DIRECTORY/$CACHE_DIRECTORY selbst. Dort liegen
# die Connect-Anmeldung und die Geraete-Kennung; sie ueberleben Neustarts.
#
# Die WebSocket-API liegt FEST auf 127.0.0.1:5033 — nicht auf Port 0, damit
# Server und Werkzeuge sie finden, ohne die Portdatei zu suchen. Nur
# localhost: die API kann die Wiedergabe steuern und gehoert nicht ins Netz.
# ── WARUM 100 UND NICHT DIE LAUTSTAERKE DER BOX ─────────────────────────────
#
# Soloist HAT einen eigenen Lautstaerkeregler (`ctl volume`, WebSocket
# `set_volume`, Ereignis `volume_changed`). Er wird hier bewusst WEIT
# AUFGEDREHT und nicht benutzt: geregelt wird eine Stufe spaeter in PipeWire
# (`pactl set-sink-volume`), wo auch das Daempfen beim Vorlesen sitzt und der
# Pegeldeckel fuer Kinderohren.
#
# Am 22.08.2026 an der Box gemessen liegen zwischen Soloist und dem
# Lautsprecher ohnehin vier Stufen (entzerrer, klangwerk, alsa_output, ALSA
# Master). Eine fuenfte, die woanders bedient wird, waere ein zweiter Knopf
# fuer dieselbe Sache — und der, den man vergisst, wenn es zu leise ist.
#
# OFFEN UND NICHT GEMESSEN: was passiert, wenn jemand in der Spotify-App den
# Regler schiebt. Connect schickt das an das Geraet, Soloist wuerde also von
# 100 heruntergehen — die Oberflaeche der Box liest aber den PipeWire-Pegel und
# saehe davon nichts. Beim naechsten Neustart stuende wieder 100. Seit E75
# horcht der Server am WebSocket und koennte `volume_changed` mitlesen.
exec /usr/local/bin/soloist \
    -n "${NAME}" \
    -k "${KEY}" \
    -w 127.0.0.1:5033 \
    -z "${CACHE_MB}" \
    -i 100
