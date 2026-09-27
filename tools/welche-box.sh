#!/bin/sh
# Mit WELCHER Box rede ich hier eigentlich?
#
# WOZU: der Name `mupibox` hat an EINEM Tag zweimal auf verschiedene Rechner
# gezeigt (der Rechnerschluessel wechselte mitten in der Arbeit). Dadurch sind
# Messungen, die einer neuen Installation galten, an der alten Box gelandet -
# und daraus wurden zwei falsche Aussagen. Kosten: eine halbe Stunde und zwei
# Richtigstellungen.
#
# Deshalb: VOR jedem Zugriff die Maschine bestimmen. Nicht aus dem Namen
# schliessen, sondern aus dem Geraetebaum lesen.
#
# AUFRUF
#     tools/welche-box.sh                 # alle bekannten Adressen
#     tools/welche-box.sh 192.168.178.99  # eine bestimmte
#     tools/welche-box.sh --suchen        # das Netz absuchen (siehe unten)
#
# Rein LESEND - der Aufruf aendert auf keiner Box irgendetwas.

# WOHER DIE ADRESSEN KOMMEN: aus dem Inventar des remote-step-installer, NICHT
# von hier. Hier stand bis 2026-07-31 eine eigene Liste - und sie war falsch
# (192.168.178.48 statt .169). Eine zweite Adressliste veraltet zwangslaeufig,
# weil niemand daran denkt, beide zu pflegen. Fehlt das Inventar (anderes Repo,
# muss nicht daliegen), faellt es auf die letzte bekannte Liste zurueck.
# ══ SEIT DEM 08.08.2026 LIEGT DAS WISSENSPAKET IM BAUM ══════════════════════
#
# Betreiber: „ich möchte das wiki llm und auch die werkzeuge wie das zum sd
# karte schreiben mit ins repository aufnehmen dass alles beisammen ist."
# Es steht seither unter `remote-step-installer/` (per `git subtree`, siehe ZUGEZOGEN.md).
#
# DER ALTE PFAD BLEIBT ALS RUECKFALL, und zwar nicht aus Bequemlichkeit: Wer
# einen Stand von vor diesem Tag ausgecheckt hat, hat kein `remote-step-installer/` — und
# ein Werkzeug, das dann bloss abbricht, ist schlechter als eines, das den
# alten Ort noch kennt. Gefunden wird, was zuerst dasteht.
_IM_BAUM="$(dirname "$0")/../remote-step-installer/boxen.yaml"
_DANEBEN="$(dirname "$0")/../../remote-step-installer/boxen.yaml"
if [ -n "${RSI_BOXEN:-}" ]; then BESTAND="$RSI_BOXEN"
elif [ -f "$_IM_BAUM" ];   then BESTAND="$_IM_BAUM"
else                            BESTAND="$_DANEBEN"; fi
RUECKFALL="192.168.178.169 192.168.178.99"
BENUTZER="${MUPI_USER:-dietpi}"

bekannte_adressen() {
  if [ -r "$BESTAND" ]; then
    # Nur die Werte hinter "adresse:" - ohne YAML-Werkzeug, weil dieses Skript
    # auf einer nackten Box laufen koennen soll.
    #
    # KOMMENTARE ABSCHNEIDEN, und zwar ZUERST: `adresse: 192.168.178.62  # zuletzt
    # geprueft …` ist gueltiges YAML, und `controller/core.py` liest es mit einem
    # echten Parser auch klaglos. Hier stand bis 11.09.2026 nur ein gsub, das ALLE
    # Leerzeichen entfernte - der Kommentar klebte danach an der Adresse
    # ("192.168.178.62#zuletztgeprueft11.09.2026") und das Werkzeug meldete die
    # Box als nicht erreichbar. Ein halber YAML-Parser ist eine Zusage, die nur
    # solange haelt, wie niemand gueltiges YAML schreibt.
    adr=$(sed 's/#.*//' "$BESTAND" \
          | awk -F: '/^[[:space:]]*adresse:/{gsub(/[[:space:]]/,"",$2); if ($2 != "") print $2}')
    [ -n "$adr" ] && { printf '%s\n' "$adr"; return; }
  fi
  printf '%s\n' "$RUECKFALL" | tr ' ' '\n'
}

# DAS NETZ ABSUCHEN, wenn eine Box nicht dort ist, wo sie sein sollte.
#
# WOZU: die Adressen kommen per DHCP. Eine Box, die laenger aus war, taucht
# woanders wieder auf - dann steht im Inventar die alte Adresse und das
# Werkzeug meldet nur "nicht erreichbar", ohne zu helfen.
#
# IN BLOECKEN, NICHT ALLE AUF EINMAL: 254 gleichzeitige Pings liefern
# UNZUVERLAESSIGE Ergebnisse. Am 2026-07-31 gemessen - derselbe Aufruf fand
# einmal 27 Rechner, kurz darauf nur 3. Die Antworten gehen unter, wenn zu
# viele Anfragen gleichzeitig unterwegs sind. Vier Bloecke zu 64 sind
# reproduzierbar und dauern trotzdem nur wenige Sekunden.
# WELCHES NETZ? Zuerst das der bekannten Boxen - NICHT die Route ins Internet.
#
# Der naheliegende Weg (`ip route get 1.1.1.1`) ist hier falsch und wurde beim
# ersten Lauf am 2026-07-31 auch prompt widerlegt: Er lieferte 10.14.0.0/24,
# das VPN. Dort antwortete genau ein Rechner und die Suche endete mit "keine
# Box gefunden" - obwohl die Box im Heimnetz 192.168.178.0/24 haengt. Wer eine
# Box sucht, sucht sie da, wo Boxen wohnen: im Inventar steht es.
netz_raten() {
  bekannte_adressen | awk -F. 'NF==4 {print $1 "." $2 "." $3; exit}'
}

suchen() {
  praefix="${1:-$(netz_raten)}"
  if [ -z "$praefix" ]; then
    printf 'Kein Netz erkannt. Praefix angeben: %s --suchen 192.168.178\n' "$0" >&2
    return 1
  fi
  printf 'Suche in %s.0/24 (vier Bloecke)...\n' "$praefix" >&2

  lebt=$(
    for start in 1 65 129 193; do
      ende=$((start + 63))
      [ "$ende" -gt 254 ] && ende=254
      i=$start
      while [ "$i" -le "$ende" ]; do
        ping -c1 -W1 "$praefix.$i" >/dev/null 2>&1 && printf '%s.%s\n' "$praefix" "$i" &
        i=$((i + 1))
      done
      wait
    done
  )
  anzahl=$(printf '%s' "$lebt" | grep -c . )
  printf '%s Rechner antworten. Welche horchen auf 8200?\n' "$anzahl" >&2

  # NICHT bei allen per SSH nachfragen: das dauert je Rechner Sekunden und
  # fragt fremde Geraete im Netz. Der Backend-Port ist das billige Merkmal.
  #
  # ABER: EIN OFFENER PORT IST KEINE KENNUNG. Hier stand einmal, wer auf 8200
  # antworte, sei eine Box. Am 20.08.2026 hat das eine halbe Suche gekostet:
  # MINIDLNA HORCHT AB WERK EBENFALLS AUF 8200. Der Fund war ein amd64-Rechner
  # mit MiniDLNA 1.3.3, gemeldet als Box, samt Hinweis, ihn ins Inventar
  # nachzuziehen.
  #
  # Der Fehler war die Bauart, nicht die Zahl: geprueft wurde, ob JEMAND
  # antwortet, nicht ob DAS RICHTIGE antwortet. Also nach einem Endpunkt
  # fragen, den nur diese Box hat - `/api/darstellung`, denselben, den die
  # oertliche Pruefung weiter unten schon benutzt. 200 heisst Box; 404 heisst
  # irgendein anderer Dienst auf demselben Port.
  treffer=$(
    for a in $lebt; do
      (
        for schema in http https; do
          code=$(curl -k -s -m2 -o /dev/null -w '%{http_code}' \
                   "$schema://$a:8200/api/darstellung" 2>/dev/null)
          if [ "$code" = "200" ]; then
            printf '%s\n' "$a"
            break
          fi
        done
      ) &
    done
    wait
  )
  if [ -z "$treffer" ]; then
    printf 'Keine Box gefunden. Laeuft das Backend? Haengt sie am Netz?\n' >&2
    printf '(Geprueft wurde /api/darstellung, nicht nur der offene Port 8200 -\n' >&2
    printf ' darauf horcht auch MiniDLNA.)\n' >&2
    return 1
  fi
  printf '%s\n' "$treffer"
}

frage() {
  timeout 15 ssh -o BatchMode=yes -o ConnectTimeout=6 \
    -o StrictHostKeyChecking=accept-new "$BENUTZER@$1" "$2" 2>/dev/null
}

eine() {
  adr="$1"
  printf '%s\n' "── $adr ───────────────────────────────────────────"

  # EIN Aufruf fuer alles: jede weitere SSH-Sitzung kostet eine Sekunde, und
  # bei mehreren Adressen summiert sich das zu einer Wartezeit, nach der man
  # das Werkzeug nicht mehr benutzt.
  roh=$(frage "$adr" '
    printf "modell\t%s\n" "$(tr -d "\0" < /proc/device-tree/model 2>/dev/null)"
    printf "system\t%s\n" "$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
    printf "kern\t%s\n"   "$(uname -r)"
    printf "ram\t%s MB\n" "$(awk "/MemTotal/{printf \"%d\", \$2/1024}" /proc/meminfo)"
    printf "node\t%s\n"   "$(node -v 2>/dev/null || echo -)"
    # KEIN "|| echo …" HINTER EINER PIPE: es zaehlt der letzte Befehl der Pipe,
    # und der gelingt auch dann, wenn der erste nichts gefunden hat. Genau so
    # stand hier zuerst eine LEERE App-Zeile statt "FEHLT" - und das Urteil
    # darunter wurde falsch. Also in eine Variable lesen und ${x:-…} nehmen.
    a=$(ls /home/dietpi/.mupibox/*/server.js 2>/dev/null | head -1)
    printf "app\t%s\n"    "${a:-FEHLT}"
    # ZWEI WELTEN: frueher hielt pm2 die beiden Dienste, seit 2026-07-29
    # tun es systemd-Units (mupibox-server/-player, sie starten rund 11 s
    # frueher). Beide zaehlen, sonst meldet das Werkzeug auf der einen oder
    # anderen Box faelschlich "0 online".
    #
    # pm2 NICHT unnoetig aufrufen: schon ein "pm2 list" startet den
    # PM2-Hauptprozess neu - danach sieht es so aus, als liefe pm2 noch.
    d=0
    for u in mupibox-server mupibox-player; do
      [ "$(systemctl is-active $u 2>/dev/null)" = active ] && d=$((d + 1))
    done
    if [ "$d" = 0 ] && [ -S /home/dietpi/.pm2/pub.sock ]; then
      d=$(pm2 list 2>/dev/null | grep -c online)
    fi
    printf "dienste\t%s\n" "${d:-0}"
    printf "kiosk\t%s\n"  "$(cat /boot/dietpi/.dietpi-autostart_index 2>/dev/null || echo -)"
    # curl SCHREIBT bei einem Verbindungsfehler bereits "000" und endet
    # trotzdem mit einem Fehler - ein zusaetzliches "|| echo 000" haengt ein
    # zweites an ("000000").
    printf "api\t%s\n"    "$(curl -s -m3 -o /dev/null -w "%{http_code}" http://localhost:8200/api/darstellung 2>/dev/null)"
    printf "lighttpd\t%s\n" "$(systemctl is-active lighttpd 2>/dev/null || echo -)"
  ')

  if [ -z "$roh" ]; then
    printf '  nicht erreichbar\n\n'
    return 1
  fi

  hol() { printf '%s\n' "$roh" | awk -F'\t' -v k="$1" '$1==k{print $2; exit}'; }

  modell=$(hol modell)
  app=$(hol app)
  kiosk=$(hol kiosk)
  api=$(hol api)

  printf '  Modell    %s\n' "${modell:-unbekannt}"
  printf '  System    %s   Kern %s   %s\n' "$(hol system)" "$(hol kern)" "$(hol ram)"
  printf '  Node      %s\n' "$(hol node)"
  printf '  App       %s\n' "$app"
  printf '  Dienste   %s online   Kiosk-Index %s   API %s   lighttpd %s\n' \
    "$(hol dienste)" "${kiosk:--}" "$api" "$(hol lighttpd)"

  # Das URTEIL, nicht nur die Rohwerte: wer nur Zahlen liest, verwechselt
  # weiterhin. Die beiden Rezepte sind getrennt (siehe llmwiki
  # mupi-installation-besteht-aus-zwei-rezepten) - genau diese Trennung ist
  # es, die "der Kiosk startet nicht" erklaert.
  if [ "$app" = "FEHLT" ] || [ -z "$app" ]; then
    printf '  ▸ System-Rezept gelaufen, APP-Rezept NICHT (mupibox-app.yaml fehlt)\n'
  elif [ "$api" = "200" ] && [ "$kiosk" = "11" ]; then
    printf '  ▸ vollstaendig: App, Dienste und Kiosk stehen\n'
  else
    printf '  ▸ App da, aber nicht vollstaendig - Kiosk-Index und API pruefen\n'
  fi
  printf '\n'
}

if [ "$1" = "--suchen" ]; then
  shift
  gefunden=$(suchen "$1") || exit 1
  printf '\n'
  for a in $gefunden; do eine "$a"; done
  # Der Abgleich mit dem Inventar ist der eigentliche Zweck: eine Box unter
  # NEUER Adresse zu finden hilft wenig, wenn die alte im Inventar stehen
  # bleibt - beim naechsten Mal sucht man wieder.
  for a in $gefunden; do
    bekannte_adressen | grep -qx "$a" \
      || printf '▸ %s steht NICHT im Inventar - in %s nachziehen\n' "$a" "$BESTAND"
  done
elif [ $# -gt 0 ]; then
  for a in "$@"; do eine "$a"; done
else
  for a in $(bekannte_adressen); do eine "$a"; done
fi
