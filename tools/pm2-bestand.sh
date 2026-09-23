#!/bin/sh
# Steckt auf DIESER Box noch pm2 - und wenn ja, haelt es etwas fest?
#
# WOZU: pm2 ist am 29.07.2026 von systemd abgeloest worden
# ([[mupi-startzeiten-gemessen]]), aber NICHT deinstalliert worden - mit Absicht
# ([[pm2-reste-nach-der-systemd-umstellung]]): der Umstellschritt im
# remote-step-installer braucht pm2s eigenes Binaer, um die alten Prozesse
# abzuraeumen. Waere pm2 vorher schon weg, blieben sie als Waisen laufen und
# hielten die Ports 8200 und 5005 besetzt.
#
# Daraus folgt die Frage, die dieses Werkzeug beantwortet: ist der Grund,
# pm2 liegen zu lassen, auf DIESER Box noch gegeben? Er ist es genau dann
# nicht mehr, wenn pm2 keine Prozesse mehr haelt, seine Unit nicht mehr
# eingeschaltet ist und die beiden systemd-Dienste laufen.
#
# REIN LESEND. Der Aufruf aendert auf keiner Box irgendetwas - kein
# `pm2 delete`, kein `systemctl`, kein `apt`. Wer entfernen will, tut das von
# Hand, nachdem er das hier gelesen hat.
#
# AUFRUF
#     tools/pm2-bestand.sh 192.168.178.57
#     tools/pm2-bestand.sh                  # nimmt die Adressen aus welche-box.sh
#
# WARUM `pm2 list` HIER NICHT VORKOMMT: ein blosses `pm2 list` STARTET den
# Daemon, wenn keiner laeuft ([[pm2-update-leert-die-prozessliste]]) - auf einer
# Box, die laengst unter systemd faehrt, waere das genau der Zustand, den man
# messen wollte, selbst herbeigefuehrt. Gemessen wird deshalb am Dateisystem
# und an systemd, nicht ueber pm2s eigene Werkzeuge.

BENUTZER="${MUPI_USER:-dietpi}"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new"

adressen() {
  if [ $# -gt 0 ]; then printf '%s\n' "$@"; return; fi
  sh "$(dirname "$0")/welche-box.sh" 2>/dev/null \
    | awk '/^── /{print $2}'
}

pruefe_box() {
  adr="$1"
  echo "── $adr ───────────────────────────────────────────"
  if ! $SSH "$BENUTZER@$adr" true 2>/dev/null; then
    echo "  nicht erreichbar"
    return
  fi

  # ── WARUM DER SUCHAUSDRUCK UNTEN SO VERDREHT AUSSIEHT ────────────────────
  # Der pm2-Verwalterprozess traegt den Namen "P M 2 …: G o d   D a e m o n"
  # (hier auseinandergezogen, und zwar mit Absicht - siehe gleich).
  #
  # `pgrep -f` vergleicht die GANZE Befehlszeile jedes Prozesses. Alles, was
  # unten zwischen den Hochkommata steht, reist als EIN Zeichenstrom zur Box
  # und steht dort in der Befehlszeile der ausfuehrenden Shell. Wer den
  # gesuchten Namen also irgendwo in diesen Block schreibt - AUCH IN EINEN
  # KOMMENTAR -, laesst den Aufruf sich selbst finden.
  #
  # Genau das ist am 14.08.2026 passiert: die Suchzeile war mit `[P]M2` schon
  # entschaerft, aber der ERKLAERKOMMENTAR darueber schrieb den Namen aus. Das
  # Werkzeug meldete "2 Prozess(e)" auf einer Box, auf der pm2 nicht einmal
  # installiert ist - eine Zahl, die zur gegenteiligen Entscheidung gefuehrt
  # haette. Dieselbe Klasse wie [[pkill-toetet-die-eigene-shell]], nur lesend
  # und deshalb harmlos im Wirken, aber nicht in der Auskunft.
  #
  # Deshalb: die Erklaerung steht HIER, ausserhalb des Blocks, und im Block
  # selbst steht der Name nur noch zerlegt als `[P]M2`.
  $SSH "$BENUTZER@$adr" '
    echo "  ── ist pm2 ueberhaupt da"
    if command -v pm2 >/dev/null 2>&1; then
      echo "     Binaer      $(command -v pm2)   Fassung $(pm2 -v 2>/dev/null | tail -1)"
    else
      echo "     Binaer      NICHT INSTALLIERT"
    fi
    echo "     npm -g      $(npm ls -g --depth=0 2>/dev/null | grep -c pm2) Eintrag(e)"

    echo "  ── haelt pm2 noch etwas"
    # Erklaerung zum Suchausdruck: siehe Kommentarblock VOR diesem ssh-Aufruf.
    treffer=$(pgrep -af "[P]M2" 2>/dev/null | wc -l)
    echo "     Verwalter   $treffer Prozess(e)"
    if [ -f "$HOME/.pm2/dump.pm2" ]; then
      echo "     dump.pm2    da, $(tr -cd \[ < "$HOME/.pm2/dump.pm2" | wc -c) Eintrag-Klammer(n), geaendert $(date -r "$HOME/.pm2/dump.pm2" "+%Y-%m-%d %H:%M")"
    else
      echo "     dump.pm2    fehlt"
    fi
    if [ -d "$HOME/.pm2/logs" ]; then
      echo "     .pm2/logs   $(ls -1 "$HOME/.pm2/logs" 2>/dev/null | wc -l) Datei(en), juengste $(ls -1t "$HOME/.pm2/logs" 2>/dev/null | head -1) von $(date -r "$(ls -1td "$HOME"/.pm2/logs/* 2>/dev/null | head -1)" "+%Y-%m-%d %H:%M" 2>/dev/null)"
    else
      echo "     .pm2/logs   fehlt"
    fi

    echo "  ── wer faehrt die Dienste"
    # KEIN `|| echo not-found` dahinter: `systemctl is-enabled` SCHREIBT bei
    # einer fehlenden Unit selbst schon "not-found" nach stdout und endet
    # trotzdem mit != 0. Der Rueckfall haengte das Wort ein zweites Mal an und
    # zerriss die Spalte ueber zwei Zeilen (erste Messung 14.08.2026).
    for u in pm2-dietpi pm2-root mupibox-server mupibox-player; do
      printf "     %-18s %-12s %s\n" "$u" \
        "$(systemctl is-enabled $u 2>/dev/null)" \
        "$(systemctl is-active  $u 2>/dev/null)"
    done

    echo "  ── wer haelt 8200 und 5005"
    for p in 8200 5005; do
      # ss zeigt den Prozessnamen nur als root; der Name allein reicht hier.
      printf "     %-6s %s\n" "$p" "$(ss -ltnp 2>/dev/null | awk -v p=":$p" "index(\$4,p){print \$NF; exit}")"
    done
  ' 2>&1
  echo
}

for a in $(adressen "$@"); do
  pruefe_box "$a"
done
