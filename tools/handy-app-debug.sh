#!/usr/bin/env bash
# HANDY-APP-DEBUG — die Handy-App auf dem angeschlossenen Handy starten und
# mit Hot Reload daran bleiben, auch wenn das Handy seine Logs verschluckt.
#
# WARUM NICHT EINFACH `flutter run` (27.09.2026, Honor PGT-N19, Android 16):
# Das Handy hat `persist.log.tag=S` — logcat zeigt keine Zeile der App.
# `flutter run` liest aber genau dort die Adresse der Dart-VM ab und haengt
# nach „Installing …" fuer immer. Hier bekommt die VM stattdessen beim Start
# einen FESTEN Port ohne Zugangscode (Intent-Extras, die Flutter im
# Debug-Build auswertet), der Port wird per `adb forward` durchgereicht, und
# `flutter attach --debug-url` haengt sich an. Am Handy wird nichts verstellt.
#
# AUFRUF (aus der Wurzel des Baums)
#     tools/handy-app-debug.sh start      # bauen, installieren, starten, anhaengen
#     tools/handy-app-debug.sh neu        # Hot Reload   (nach Aenderung in lib/)
#     tools/handy-app-debug.sh neustart   # Hot Restart  (nach Aenderung an main/Zustand)
#     tools/handy-app-debug.sh bild [datei.png]   # Schirmbild vom Handy
#     tools/handy-app-debug.sh log        # Ausgaben/Fehler der App (tools/handy-app-vm-log.mjs)
#     tools/handy-app-debug.sh stopp      # flutter attach beenden (App laeuft weiter)
#
# Umgebung: GERAET=<adb-Seriennummer> (sonst das einzige angeschlossene),
# ARBEIT=<ordner> fuer Log und PID (Vorgabe: /tmp/handy-app-debug).

set -u
WURZEL="$(cd "$(dirname "$0")/.." && pwd)"
APP="$WURZEL/handy-app"
PKG=de.mixpibox.mixpibox_fernbedienung
PORT=43000
ARBEIT="${ARBEIT:-/tmp/handy-app-debug}"
LOG="$ARBEIT/attach.log"
PID="$ARBEIT/attach.pid"
mkdir -p "$ARBEIT"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$HOME/development/flutter/bin:$PATH"
# DAS adb AUS DEM SDK, nicht /usr/bin/adb: zwei verschiedene adb-Server
# werfen sich gegenseitig vom Port 5037, und dann verschwindet das Handy.
ADB="$ANDROID_HOME/platform-tools/adb"

geraet() {
  if [ -n "${GERAET:-}" ]; then echo "$GERAET"; return; fi
  local liste
  liste=$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')
  if [ "$(echo "$liste" | grep -c .)" -ne 1 ]; then
    echo "Nicht genau EIN Handy freigegeben (adb devices):" >&2
    "$ADB" devices -l >&2
    echo "USB-Debugging an, Modus 'Dateien übertragen', Abfrage am Handy bestätigen." >&2
    exit 2
  fi
  echo "$liste"
}

signal() {
  [ -s "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null || { echo "flutter attach laeuft nicht — erst: $0 start" >&2; exit 2; }
  local vorher
  vorher=$(grep -c -E "$2" "$LOG")
  kill "-$1" "$(cat "$PID")"
  for _ in $(seq 1 60); do
    [ "$(grep -c -E "$2" "$LOG")" -gt "$vorher" ] && break
    sleep 0.5
  done
  grep -E "$2|Error|error:" "$LOG" | tail -1
}

case "${1:-}" in
  start)
    G=$(geraet) || exit 2
    [ -s "$PID" ] && kill "$(cat "$PID")" 2>/dev/null
    (cd "$APP" && flutter build apk --debug) || exit 1
    # -r ersetzt. Scheitert es an der Signatur (ein CI-APK ist mit einem
    # ANDEREN Debug-Schluessel signiert), einmal deinstallieren — dabei gehen
    # die gemerkten Boxen der App verloren.
    if ! "$ADB" -s "$G" install -r "$APP/build/app/outputs/flutter-apk/app-debug.apk" >/dev/null 2>"$ARBEIT/install.err"; then
      if grep -q INSTALL_FAILED_UPDATE_INCOMPATIBLE "$ARBEIT/install.err"; then
        echo "Andere Signatur auf dem Handy — deinstalliere die alte App (gemerkte Boxen gehen verloren)."
        "$ADB" -s "$G" uninstall "$PKG" >/dev/null
        "$ADB" -s "$G" install "$APP/build/app/outputs/flutter-apk/app-debug.apk" >/dev/null || exit 1
      else
        cat "$ARBEIT/install.err" >&2
        exit 1
      fi
    fi
    "$ADB" -s "$G" shell am force-stop "$PKG"
    "$ADB" -s "$G" forward "tcp:$PORT" "tcp:$PORT" >/dev/null
    "$ADB" -s "$G" shell am start -n "$PKG/.MainActivity" \
      --ei vm-service-port "$PORT" --ez disable-service-auth-codes true >/dev/null
    for _ in $(seq 1 30); do
      curl -s -m 2 "http://127.0.0.1:$PORT/getVersion" | grep -q Version && break
      sleep 0.5
    done
    curl -s -m 2 "http://127.0.0.1:$PORT/getVersion" | grep -q Version || { echo "Dart-VM antwortet nicht auf Port $PORT" >&2; exit 1; }
    # SETSID + DISOWN, nicht bloss `( … &)`: sonst wartete dieses Skript auf
    # den Anhaenger und kam nie zurueck (27.09.2026 gemessen: haengt, obwohl
    # „key commands" laengst im Log stand).
    : >"$LOG"
    cd "$APP" || exit 1
    setsid flutter attach -d "$G" --debug-url "http://127.0.0.1:$PORT/" --pid-file "$PID" >"$LOG" 2>&1 </dev/null &
    disown
    cd "$WURZEL" || exit 1
    # Nur STARTfehler brechen das Warten ab. Ausnahmen der App selbst
    # („EXCEPTION CAUGHT BY …") stehen auch im Log — die sind der Grund, warum
    # man debuggt, nicht ein Grund aufzuhoeren.
    for _ in $(seq 1 120); do
      grep -q -E "key commands|Error connecting|Lost connection|Unable to|No supported devices" "$LOG" 2>/dev/null && break
      sleep 0.5
    done
    if grep -q "key commands" "$LOG"; then
      echo "Laeuft und haengt an (Log: $LOG)."
      grep -o 'http://127.0.0.1:[0-9]*/[^ ]*=/devtools[^ ]*' "$LOG" | head -1 | sed 's/^/DevTools: /'
    else
      tail -20 "$LOG" >&2
      exit 1
    fi
    ;;
  neu) signal USR1 "Reloaded" ;;
  neustart) signal USR2 "Restarted application" ;;
  bild)
    G=$(geraet) || exit 2
    ZIEL="${2:-$ARBEIT/handy.png}"
    "$ADB" -s "$G" exec-out screencap -p >"$ZIEL" && echo "$ZIEL"
    ;;
  log)
    # Hinter `flutter attach` gehoert der VM-Port dem Vermittler (DDS); dessen
    # Adresse steht im Log. Ohne attach geht es direkt auf den festen Port.
    W=$(grep -o 'http://127.0.0.1:[0-9]*/[^ ]*=/' "$LOG" 2>/dev/null | head -1 | sed 's#^http#ws#')
    exec node "$WURZEL/tools/handy-app-vm-log.mjs" --adresse "${W:+${W}ws}${W:-ws://127.0.0.1:$PORT/ws}" "${@:2}"
    ;;
  stopp)
    [ -s "$PID" ] && kill "$(cat "$PID")" 2>/dev/null && echo "flutter attach beendet." || echo "Lief nicht."
    ;;
  *)
    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
