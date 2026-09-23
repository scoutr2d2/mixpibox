#!/bin/bash
# Lautstaerke der MuPiBox — EINE Stelle statt vier.
#
# WOZU
# Es gab einmal fuenf Stellen, die die Lautstaerke selbst regelten — teils
# ueber `amixer … Master`, teils ueber `pactl set-sink-volume`. Wer den
# Tonstapel wechselt, ohne alle mitzunehmen, hat einen Lautstaerkeknopf, der
# NICHTS mehr tut — lautlos, ohne Fehlermeldung. Also erst hierher buendeln,
# dann wechseln.
#
# STAND 04.08.2026 (BACKLOG E12/X7): durch dieses Skript gehen
# src/backend-player (spotify-control.ts), scripts/telegram/telegram_receiver.py,
# scripts/mqtt/mqtt.py, scripts/chromium-autostart.sh,
# scripts/mupibox/shutdown_sound.sh und scripts/OnOffShim/off_trigger.sh.
# Jeder mit demselben Rueckfallmuster: fehlt diese Datei, regelt der Aufrufer
# wie frueher — ohne Obergrenze, aber bedienbar.
# SEIT 05.08.2026 auch AdminInterface/www/mupi.php (BACKLOG E12/X13(a)) — es
# war der letzte Aufrufer, der `amixer sget Master` las und ueber
# `pactl set-sink-volume` setzte, also an der Obergrenze vorbei. Dafuer musste
# hier `sitzung_sichern()` dazu (siehe unten): der PHP-Weg kommt ueber
# `sudo su dietpi -c` herein, und dabei geht XDG_RUNTIME_DIR verloren.
#
# WAS AUCH JETZT NOCH NICHTS REGELT — und zwar mit Absicht: alles, was als
# root laeuft. mqtt.py (mupi_mqtt.service: User=root), telegram_receiver.py,
# shutdown_sound.sh und off_trigger.sh gehen durch diese Datei, bekommen aber
# `backend -> keiner`, weil es keine root-Tonsitzung gibt (/run/user/0 gibt es
# nicht, am 04.08.2026 nachgesehen). Sie melden das ehrlich, statt es zu
# verschweigen. Ob sie in die dietpi-Sitzung geschickt werden sollen, ist eine
# Frage an den Betreiber und steht in BACKLOG E12/X13(d).
#
# WIE
# Es erkennt selbst, was laeuft:
#   PipeWire da  -> wpctl auf die Standard-Senke
#   sonst        -> amixer auf den softvol-Regler "Master"
# Damit laesst sich der Stapel umstellen, ohne einen einzigen Aufrufer
# anzufassen — und zurueck genauso.
#
# WARUM DAS DEN HEUTIGEN FEHLER MIT ERLEDIGT
# Der softvol-Regler entsteht erst, wenn einmal etwas durch das Geraet
# gespielt hat — hier stand frueher ein Verweis auf ein `init-alsa-softvol.sh`,
# das es in diesem Repo NIE gegeben hat (es lag nur im remote-step-installer).
# Seit dem PipeWire-Umstieg (E12/X6) wird es auch nicht mehr gebraucht: eine
# frische Karte bekommt keinen softvol-Regler mehr, sondern eine
# PipeWire-Senke. Zeigt `default` auf einen
# ausgeschalteten Bluetooth-Lautsprecher, entsteht er nie — `amixer sget
# Master` scheitert dann, und ein Aufrufer, der das nicht abfaengt, stirbt.
# Hier gibt es dafuer einen definierten Rueckgabewert statt eines Fehlers.
#
#   mupi-lautstaerke.sh get           -> 0-100 (oder leer, wenn unbekannt)
#   mupi-lautstaerke.sh set 70
#   mupi-lautstaerke.sh up 5
#   mupi-lautstaerke.sh down 5
#   mupi-lautstaerke.sh backend       -> pipewire | alsa | keiner
set -u

REGLER="${MUPI_MIXER:-Master}"
SENKE='@DEFAULT_AUDIO_SINK@'

# ══ DIE REGELNDE STUFE IST DIE HARDWARE-SENKE, NICHT DIE VORGABE (E94) ══════
#
# DIE WURZEL, am 04.09.2026 nach einem Boot nackt sichtbar: Die Vorgabe-Senke
# ist `klangwerk` — eine Filter-Kette („Ton-Plugins"), und DIE NIMMT KEINE
# LAUTSTAERKE AN. Sechs Stellwege, alle ohne Fehlermeldung, alle wirkungslos:
# wpctl auf @DEFAULT_AUDIO_SINK@, wpctl auf die ID, pw-cli Props, pactl,
# dieses Skript, setvolume ueber den Abspieldienst. Die Box kam mit 100 %
# hoch (Kinderbox!), und kein Regler der Welt konnte sie leiser machen.
# Die ALSA-Senke daneben nimmt Befehle an und HAELT sie — gemessen, fuenfmal
# im 0,4-s-Takt zurueckgelesen [llmwiki klangwerk-nimmt-keine-lautstaerke-an].
#
# ALSO REGELT DIE LETZTE STUFE VOR DEM LAUTSPRECHER: bluez_output, wenn ein
# Bluetooth-Lautsprecher verbunden ist (der Verbindungsweg biegt die Kette
# dorthin um), sonst alsa_output. UEBER DIE ID, nicht ueber den Namen — Namen
# koennen doppelt sein, IDs nicht [llmwiki drei-skalen-fuer-eine-lautstaerke].
#
# WAS DAS FUER DIE ZUSAGEN DER BOX HEISST: `klemme` begrenzt jetzt genau die
# Stufe, hinter der nichts mehr kommt. Faellt irgendeine Zwischenstufe weg
# (der alte E94-Albtraum: klangwerk stirbt, die Karte steht blank auf 100),
# liegt vorn eine Senke, die die NUTZERLAUTSTAERKE traegt — die Zusage haelt
# von selbst.
#
# RUECKFALL: Ohne pw-dump/jq oder ohne Hardware-Senke gilt die Vorgabe-Senke
# wie bisher — ein Skript, das wegen eines fehlenden Werkzeugs nichts stellt,
# waere der schlimmere Fehler.
regelnde_senke() {
  command -v pw-dump >/dev/null 2>&1 || { echo "$SENKE"; return 0; }
  command -v jq      >/dev/null 2>&1 || { echo "$SENKE"; return 0; }
  local id
  id="$(pw-dump 2>/dev/null | jq -r '
      [ .[] | select(.type=="PipeWire:Interface:Node")
            | select(.info.props["media.class"]=="Audio/Sink")
            | select(.info.props["node.name"] | test("^(bluez_output|alsa_output)")) ]
      | sort_by(if (.info.props["node.name"] | startswith("bluez_output")) then 0 else 1 end)
      | .[0].id // empty' 2>/dev/null)"
  [ -n "$id" ] && echo "$id" || echo "$SENKE"
}

# Der NAME derselben Senke — fuer die Ausnahme in einheit_nachziehen und den
# Geraetedeckel. Getrennt von der ID, weil die zwei Fragen verschieden sind.
regelnde_senke_name() {
  command -v pw-dump >/dev/null 2>&1 || { pactl get-default-sink 2>/dev/null; return 0; }
  command -v jq      >/dev/null 2>&1 || { pactl get-default-sink 2>/dev/null; return 0; }
  pw-dump 2>/dev/null | jq -r '
      [ .[] | select(.type=="PipeWire:Interface:Node")
            | select(.info.props["media.class"]=="Audio/Sink")
            | select(.info.props["node.name"] | test("^(bluez_output|alsa_output)")) ]
      | sort_by(if (.info.props["node.name"] | startswith("bluez_output")) then 0 else 1 end)
      | .[0].info.props["node.name"] // empty' 2>/dev/null
}

# DIE ADRESSE DER EIGENEN SITZUNG NACHTRAGEN — mehr nicht.
#
# PipeWire ist ein BENUTZERdienst. Man erreicht ihn nicht schon dadurch, dass
# man die richtige uid hat; man braucht auch XDG_RUNTIME_DIR, den Weg zum
# Socket. Genau der faellt weg, sobald ein Aufrufer ueber `sudo`, `su` oder
# einen systemd-Dienst hereinkommt: `sudo` setzt die Umgebung zurueck
# (Defaults env_reset), und `su ohne -` traegt XDG_RUNTIME_DIR nicht nach.
#
# AM GERAET GEMESSEN (04.08.2026, Box .169, Pi 5, PipeWire):
#   sudo su dietpi -c '… backend'                          -> keiner
#   sudo su dietpi -c 'XDG_RUNTIME_DIR=/run/user/1000 …'   -> pipewire, get 40
# In beiden Faellen ist die uid 1000. Der einzige Unterschied ist die Adresse.
# Genau diesen Weg geht mupi.php (www-data -> sudo su dietpi), und genau
# deshalb hat die Lautstaerke in der alten PHP-Verwaltung nichts getan.
#
# WAS HIER ABSICHTLICH NICHT PASSIERT: ein Wechsel des BENUTZERS. Wer als root
# hereinkommt (mqtt.py, shutdown_sound.sh, off_trigger.sh), koennte sich per
# `runuser` in die dietpi-Sitzung setzen — das waere aber eine Entscheidung
# ueber Rechte und ueber drei Dienste, die heute stillschweigend nichts tun und
# danach ploetzlich etwas taeten. Sie gehoert dem Betreiber, nicht dieser
# Datei (BACKLOG E12/X13(d)). Hier wird nur nachgetragen, was dem Aufrufer
# ohnehin gehoert: SEINE EIGENE Sitzung.
sitzung_sichern() {
  [ -n "${XDG_RUNTIME_DIR:-}" ] && return 0
  local eigene="/run/user/$(id -u)"
  # -w statt -d: das Verzeichnis eines FREMDEN Benutzers ist 0700, da kaeme
  # man ohnehin nicht hinein — und ein Socket-Pfad, in den man nicht schreiben
  # darf, ist keine Sitzung, sondern eine Fehlermeldung mit Verspaetung.
  [ -d "$eigene" ] && [ -w "$eigene" ] && export XDG_RUNTIME_DIR="$eigene"
  return 0
}

sitzung_sichern

# ══ WARUM DIE NUTZERLAUTSTAERKE DOCH AUF DER HARDWARE-SENKE BLEIBT ══════════
#
# Ein Umweg des 04.09. abends, hier als Warnung: Versucht wurde, die
# Nutzerlautstaerke auf den `klangwerk.ausgang`-STROM zu legen (die Senke
# darunter der Einmessung zu ueberlassen). Am Geraet gemessen nimmt dieser
# Strom aber GENAUSO WENIG Lautstaerke an wie die klangwerk-Senke selbst —
# gesetzt 31, steht 100. Es ist dieselbe Filter-Kette; „Stroeme gehorchen
# pactl immer" gilt fuer Client-Stroeme (die Daempfung beweist es), NICHT
# fuer den Ausgang eines Filter-Nodes. Also regelt weiter die Hardware-Senke
# (regelnde_senke, oben) — sie haelt nachweislich.
hat_pipewire() {
  command -v wpctl >/dev/null 2>&1 && wpctl status >/dev/null 2>&1
}

backend() {
  if hat_pipewire; then echo pipewire
  elif command -v amixer >/dev/null 2>&1 && amixer scontrols 2>/dev/null | grep -q "'$REGLER'"; then echo alsa
  else echo keiner
  fi
}

# DIE OBERGRENZE DER BOX — hier und nirgends sonst.
#
# `mupibox.maxVolume` wurde bisher NUR in setVolume() des Wiedergabedienstes
# geprueft, also allein auf dem Weg der +5/-5-Tasten. Der Schieberegler ging
# durch setVolumeTo(), und das klemmte bloss auf 0-100: Ein Kind, das den
# Regler nach rechts zog, bekam 100 %, egal was eingestellt war. Telegram und
# die PHP-Verwaltung kamen ebenso vorbei.
#
# Diese Datei ist der Flaschenhals, durch den ALLE muessen (set, up, down).
# Steht die Grenze hier, kann kein Aufrufer sie umgehen — und niemand muss
# daran denken, sie in einem neuen Aufrufer noch einmal einzubauen. Genau das
# war die Empfehlung aus llmwiki mupi-lautstaerke-stand-2026-07-27.
#
# FEHLT DIE ANGABE, gilt 100 — dann verhaelt sich die Box wie zuvor. Eine Box,
# deren Konfiguration sich nicht lesen laesst, darf nicht ploetzlich leise
# sein.
KONFIG="${MUPI_CONFIG:-/etc/mupibox/mupiboxconfig.json}"

# DER BODEN UNTER DER OBERGRENZE — und warum der alte in die falsche Richtung
# zeigte (gefunden 07.08.2026).
#
# Hier stand:  [ "$h" -lt 1 ] && h=100
#
# Das sah aus wie ein Boden, war aber ein Rueckfall: JEDER Wert unter 1 — also
# die 0 — wurde zu 100. Die Verwaltung bietet fuer „Hoechste Lautstaerke"
# ausdruecklich 0…100 an (konfiguration.ts, id `maxLautstaerke`, min: 0). Wer
# dort 0 einstellte, weil er die Box still haben wollte, bekam also die
# LAUTESTE moegliche Box. Das ist die Sorte Fehler, die man an der Zahl nicht
# sieht und am Kind hoert.
#
# Und die andere Richtung: `maxVolume` = 1 ergibt eine Box, die praktisch
# stumm ist. Der Regler am Bildschirm der Box bietet dann nichts darueber an,
# und das Feld selbst steht in KEINER Oberflaeche der Box — zurueck kommt man
# nur von einem zweiten Geraet aus. Wer 1 einstellt, sitzt vor einer Box, die
# wie kaputt wirkt, und findet am Geraet nichts, woran er drehen koennte.
#
# DESHALB JETZT DREI FAELLE STATT ZWEI:
#   unbrauchbar (fehlt, leer, keine Zahl) -> 100. Unveraendert und mit Absicht:
#       eine Box, deren Konfiguration sich nicht lesen laesst, darf nicht
#       ploetzlich leise sein.
#   eine Zahl unter dem Boden               -> der Boden. NICHT mehr 100.
#   eine Zahl ueber 100                     -> 100.
#
# WARUM 10 UND NICHT 1: bei 10 % ist im ruhigen Zimmer hoerbar, dass die Box
# ueberhaupt etwas tut — das ist der Unterschied zwischen „leise eingestellt"
# und „kaputt". Ein Verbot ist es nicht: es ist SEINE Box. Wer wirklich
# tiefer will, aendert diesen einen Wert — er ist absichtlich eine Variable
# und keine Zahl im Code:
#
#     MUPI_MAXVOL_BODEN=1 mupi-lautstaerke.sh set 40
#
# Zum Vergleich: die Bildschirmhelligkeit hat seit dem 05.08.2026 aus genau
# demselben Grund eine Untergrenze von 20 %.
BODEN="${MUPI_MAXVOL_BODEN:-10}"

# Wo der Server seinen Klang-Stand ablegt (Deckel je Ausgabe, klang.json).
# Als Variable, damit die Probe (tools/lautstaerke-boden-probe.sh) eine
# eigene Datei unterschieben kann — und damit eine Box mit anderem Pfad
# nicht stumm am falschen Ort liest.
KLANG_DATEI="${MUPI_KLANG_DATEI:-/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/klang.json}"

hoechstwert() {
  local h='' negativ=0
  if command -v jq >/dev/null 2>&1 && [ -r "$KONFIG" ]; then
    h="$(jq -r '.mupibox.maxVolume // empty' "$KONFIG" 2>/dev/null)"
  fi
  h="${h%%.*}"
  # Ein Minuszeichen ist eine ZAHL unter dem Boden, kein Unsinn. Ohne diese
  # Zeile faellt "-5" in den Zweig „keine Zahl" und wuerde zu 100 — wieder die
  # falsche Richtung.
  case "$h" in -*) negativ=1; h="${h#-}" ;; esac
  case "$h" in ''|*[!0-9]*) echo 100; return 0 ;; esac
  if [ "$negativ" = 1 ]; then echo "$BODEN"; return 0; fi
  [ "$h" -gt 100 ] 2>/dev/null && h=100
  [ "$h" -lt "$BODEN" ] 2>/dev/null && h="$BODEN"

  # ── DER GERAETE-DECKEL GILT AUCH FUER DIE TASTEN (15.08.2026) ────────────
  # Das rote Faehnchen je Ausgabe (Ton-Seite, klang.json `deckel`) wurde
  # bisher nur von der Server-Wache im 30-Sekunden-Takt durchgesetzt — die
  # Tasten der Box konnten bis zu 30 s darueber hinaus. Hier wird er SOFORT
  # Teil der Obergrenze: der Deckel der GERADE AKTIVEN Ausgabe drueckt die
  # Grenze herunter, nie hinauf. Fehlt irgendetwas (Datei, pactl, fremde
  # Senke), gilt einfach maxVolume weiter.
  local senke='' schluessel='' deckelwert=''
  if command -v jq >/dev/null 2>&1 && [ -r "$KLANG_DATEI" ]; then
    # DIE REGELNDE SENKE, NICHT DIE VORGABE (04.09.2026): `pactl
    # get-default-sink` antwortet „klangwerk", und das passt auf keines der
    # beiden Muster darunter — der Deckel griff seit dem Einbau der
    # Filter-Kette NIE. Dieselbe Wurzel wie beim Stellen selbst.
    senke="$(regelnde_senke_name)"
    case "$senke" in
      bluez_output.*)
        schluessel="$(printf '%s' "$senke" | sed -E 's/^bluez_output\.([0-9A-Fa-f_]+)\..*$/\1/' | tr '_' ':')"
        ;;
      alsa_output.*) schluessel="intern" ;;
    esac
    if [ -n "$schluessel" ]; then
      deckelwert="$(jq -r --arg k "$schluessel" '.deckel[$k] // empty' "$KLANG_DATEI" 2>/dev/null)"
      deckelwert="${deckelwert%%.*}"
      case "$deckelwert" in
        ''|*[!0-9]*) : ;;
        *)
          [ "$deckelwert" -lt "$h" ] 2>/dev/null && h="$deckelwert"
          [ "$h" -lt "$BODEN" ] 2>/dev/null && h="$BODEN"
          ;;
      esac
    fi
  fi

  echo "$h"
}

# Auf 0 bis zum Hoechstwert begrenzen. RECHNEN, NICHT RATEN: hier kommen nur
# noch Zahlen an — `setze` weist alles andere vorher zurueck. Negatives darf
# sehr wohl hereinkommen (`down 5` bei Stand 3 rechnet -2) und wird zu 0.
klemme() {
  local v="${1:-}" max
  max="$(hoechstwert)"
  v="${v%%.*}"
  case "$v" in ''|*[!0-9-]*) v=0 ;; esac
  [ "$v" -lt 0 ] 2>/dev/null && v=0
  [ "$v" -gt "$max" ] 2>/dev/null && v="$max"
  echo "$v"
}

# ══ DIE GRENZE IST DIE VOLLE SKALA (05.09.2026) ═════════════════════════════
#
# Betreiber: „wenn man die Buttons jetzt drueckt, ist die Abstufung zu grob,
# es wird zu schnell laut. Das Limit, welches dann 100 Prozent darstellt,
# brauchen wir unbedingt."
#
# VORHER war die Grenze ein ZAUN: Bei `maxVolume` 60 liefen die Tasten von 0
# bis 60 und stiessen dann an — die oberen 40 Prozent des Reglers waren tot,
# und jeder 5er-Schritt war ein Zwoelftel des Nutzbaren.
#
# JETZT ist sie der MASSSTAB: Was der Mensch sieht und stellt (0..100) wird
# auf 0..maxVolume abgebildet. Der Regler nutzt seine ganze Laenge, ein
# Tastendruck ist ein Zwanzigstel statt eines Zwoelftels, und „100" heisst
# „so laut, wie diese Box darf" — nicht „so laut, wie die Karte kann".
#
# DIE ZUSAGE WIRD DADURCH STAERKER, nicht schwaecher: Es gibt keinen Weg
# mehr, der ueber `maxVolume` hinausfuehrt, denn 100 IST maxVolume.
#
# GERECHNET WIRD MIT GANZEN ZAHLEN und kaufmaennisch gerundet (+50/100):
# Ohne die Rundung faellt „Nutzer 50 von 60" auf 29 statt 30, und zwei
# Tastendrucke hin und zurueck landeten unter dem Ausgangspunkt.
nutzer_zu_echt() {
  local v="${1:-0}" max; max="$(hoechstwert)"
  echo $(( (v * max + 50) / 100 ))
}

# Und zurueck — fuer `get`, damit Oberflaeche und Tasten dieselbe Zahl sehen.
# EIN ECHTER WERT UEBER DER GRENZE gibt 100, nicht mehr: Wer von aussen
# lauter gestellt hat (Einmessung, Bluetooth-Geraet), soll den Regler am
# Anschlag sehen und nicht bei 137.
echt_zu_nutzer() {
  local v="${1:-0}" max; max="$(hoechstwert)"
  [ "$max" -le 0 ] 2>/dev/null && { echo 0; return 0; }
  local n=$(( (v * 100 + max / 2) / max ))
  [ "$n" -gt 100 ] && n=100
  echo "$n"
}

lies() {
  case "$(backend)" in
    pipewire)
      # wpctl meldet "Volume: 0.70" (0..1), bei Stumm zusaetzlich "[MUTED]"
      # ZURUECK AUF DIE NUTZERSKALA (siehe `nutzer_zu_echt`): sonst zeigte
      # der Regler 42, waehrend der Mensch 70 gestellt hat.
      echt_zu_nutzer "$(wpctl get-volume "$(regelnde_senke)" 2>/dev/null \
        | awk '{ for (i=1;i<=NF;i++) if ($i ~ /^[0-9]+\.[0-9]+$/) { printf "%d\n", $i*100+0.5; exit } }')"
      ;;
    alsa)
      # `[70%]` steht bei Mono wie bei Stereo da — deshalb danach suchen und
      # NICHT `grep 'Right:'` (das endet bei Mono mit Code 1; genau daran ist
      # der Wiedergabedienst gestorben).
      amixer sget "$REGLER" 2>/dev/null | grep -o '\[[0-9]\+%\]' | head -1 | tr -dc '0-9'
      ;;
    *) : ;;
  esac
}

# ── JEDE STUFE AUSSER DEM REGLER GEHOERT AUF EINHEIT ──────────────────────
#
# AM GERAET GEMESSEN (23.08.2026), nachdem der Betreiber meldete, die
# Lautstaerke sei „stark gedeckelt" — der Regler stand dabei auf ANSCHLAG:
#
#     klangwerk (Vorgabe-Senke, also DER REGLER) ..........  100 %    0,0 dB
#     entzerrer ..........................................   60 %  -13,3 dB
#     alsa_output (MAX98357A) ............................    7 %  -69,3 dB
#                                                                  ─────────
#                                              der Regler erreicht nichts davon
#
# ZUSAMMEN 82 dB, DIE VORNE NICHT ZU SEHEN SIND. `wpctl get-volume
# @DEFAULT_AUDIO_SINK@` — die Frage, die jedes Werkzeug der Box stellt —
# antwortet „1.00", und alles sieht in Ordnung aus.
#
# WIE ES DAZU KOMMT, und warum es wiederkommt, wenn man nur die Werte
# geradezieht: `$SENKE` ist `@DEFAULT_AUDIO_SINK@`, und WELCHE Senke das ist,
# AENDERT SICH WAEHREND DES BETRIEBS. Beim Anlauf ist die Tonkarte die
# Vorgabe; kommt der Entzerrer hoch, ist er es; kommt das Klangwerk hoch, ist
# es das. Jeder Griff an den Regler trifft die Stufe, die GERADE vorne steht —
# und was dort eingestellt wurde, bleibt fuer immer liegen, sobald eine neue
# Stufe davorwaechst. WirePlumber merkt es sich sogar ueber den Neustart.
# Weder der Entzerrer- noch der Kartenwert wird IRGENDWO im Code gesetzt; es
# sind reine Altlasten aus der Zeit, als sie die Vorgabe waren.
#
# UND ES ERKLAERT DEN ZWEITEN BEFUND DESSELBEN TAGES: beim Runterfahren stellt
# `off_trigger.sh` die Lautstaerke auf `startVolume` zurueck. Ist das Klangwerk
# zu dem Zeitpunkt schon abgebaut, trifft dieses `set` die KARTE — und hebt sie
# von 7 % auf 20 %. Genau der „kurze Anstieg der Lautstaerke beim Spielen".
# Ein Fehler, zwei Beschwerden.
#
# DIE REGEL, DIE BEIDES ERLEDIGT: es gibt genau EINE regelnde Stufe, und das
# ist die Vorgabe-Senke. Alles andere im Weg ist Durchreiche und steht auf
# 100 %. Das wird bei JEDEM `set` nachgezogen, nicht einmalig repariert —
# denn die Reihenfolge, in der die Stufen hochkommen, laesst sich nicht
# festnageln, und eine Stufe, die morgen davorwaechst, faellt sonst wieder
# in dieselbe Grube.
#
# WAS ES NICHT ANFASST: die Vorgabe-Senke selbst (das waere der Regler) und
# alles, was keine Audio/Sink ist. Quellen und Stroeme bleiben unberuehrt.
einheit_nachziehen() {
  command -v pw-dump >/dev/null 2>&1 || return 0
  command -v jq      >/dev/null 2>&1 || return 0
  # ── DIE DURCHREICHE STEHT AUF DER OBERGRENZE, NICHT AUF 100 (E94) ────────
  #
  # Hier stand fest `100%`, und das war eine Stufe zu grosszuegig. Am Geraet
  # gemessen (04.09.2026, bei Stille): Ein Neustart von `mupibox-server`
  # reisst `klangwerk` und `ueberall` ab — der Server baut beide auf. Die
  # Vorgabe-Senke faellt damit auf die Tonkarte zurueck, und die stand wegen
  # dieser Zeile auf 100 %. Vorher war die Kette `klangwerk 30 % -> Karte
  # 100 %`, hoerbar also 30; danach lag die 100 BLANK. Der Betreiber,
  # zweimal an einem Nachmittag: „sehr laut gerade".
  #
  # `maxVolume` IST DIE ZUSAGE DER BOX, dass es nie lauter wird. Sie galt
  # bisher nur fuer die regelnde Stufe — Durchreichen durften darueber
  # hinaus, solange sie hinten standen. Faellt eine von ihnen nach vorn, ist
  # die Zusage gebrochen, und zwar genau dann, wenn niemand hinsieht.
  #
  # WAS ES KOSTET, ehrlich: Bei `maxVolume` unter 100 ist die Kette
  # entsprechend leiser ausgesteuert (Regler x Durchreiche statt Regler x
  # 1,0). Das ist der Preis dafuer, dass kein Uebergang mehr voll aufreisst;
  # wem es zu leise wird, der hebt `maxVolume` — also genau den Wert, der
  # die Zusage traegt.
  # ── DIE DURCHREICHEN STEHEN AUF 100, SEIT DIE LETZTE STUFE REGELT ────────
  #
  # Hier stand `hoechstwert` (die maxVolume-Obergrenze), und das war richtig,
  # SOLANGE die Vorgabe-Senke regelte: fiel eine Durchreiche nach vorn, lag
  # ihr Wert blank am Lautsprecher. Seit dem 04.09.2026 regelt die
  # HARDWARE-Senke — die Stufe, hinter der nichts mehr kommt. Was immer
  # davor waechst oder wegfaellt: der Ton verlaesst die Box durch die Stufe
  # mit der Nutzerlautstaerke, die Zusage haelt von selbst.
  #
  # Und die Obergrenze als Durchreichen-Wert hatte jetzt einen PREIS: Am
  # Geraet gemessen (04.09.2026) nahm `klangwerk` die 85 % diesmal AN
  # (dasselbe klangwerk hatte mittags fuenf Stellbefehle in Folge ignoriert
  # — es ist wetterwendisch, nicht immun). Ergebnis: 0,85 x 0,31 = die Box
  # war leiser als eingestellt, und niemand haette gewusst warum.
  local durchreiche='100'
  # AUSGENOMMEN IST DIE REGELNDE SENKE, nicht mehr die Vorgabe (E94-Wurzel):
  # sie traegt die NUTZERLAUTSTAERKE, und eine Angleichung wuerde genau sie
  # bei jedem `set` ueberschreiben — der Regler stellte sich selbst zurueck.
  local vorgabe; vorgabe="$(regelnde_senke_name)"
  [ -n "$vorgabe" ] || vorgabe="$(pactl get-default-sink 2>/dev/null)"
  [ -n "$vorgabe" ] || return 0
  # NICHT NUR HOCHZIEHEN, SONDERN ANGLEICHEN (E94). Hier stand
  # `< 0.999`, also „nur was UNTER 100 steht". Die Tonkarte steht auf genau
  # 100 und fiel deshalb nie in die Auswahl — sie blieb voll aufgedreht, und
  # sobald die regelnde Stufe wegfiel, lag diese 100 blank. Verglichen wird
  # jetzt gegen die Obergrenze, in BEIDE Richtungen; die Kulanz haelt
  # Rundungsrauschen aus dem Weg (channelVolumes ist ein Bruch, kein Prozent).
  # ERLAUBNISLISTE STATT AUSSCHLUSS (04.09.2026 abends, zweiter Anlauf).
  # Erst plaettete die Einheit ALLE Nicht-Regel-Senken (Betreiber: „springt
  # wieder auf 100" — die eingemessene Hardware), dann alle ausser Hardware
  # (Betreiber: „bspw alle zusammen springt" — die Ueberall-Kombi, die die
  # Verwaltung BEWUSST als stellbare Ausgabe anbietet). Die Lehre: Was die
  # Verwaltung dem Menschen zum Stellen gibt, darf keine Automatik
  # zuruecksetzen. Die Einheit richtet nur noch die drei stummen Stationen,
  # die NIEMAND von Hand stellt — klangwerk, entzerrer, mitschnitt.
  pw-dump 2>/dev/null \
    | jq -r --arg v "$vorgabe" --argjson z "$(awk -v d="$durchreiche" 'BEGIN{printf "%.4f", d/100}')" '
        .[] | select(.type=="PipeWire:Interface:Node")
            | select(.info.props["media.class"]=="Audio/Sink")
            | select(.info.props["node.name"] != $v)
            | select(.info.props["node.name"] as $n
                | ["klangwerk", "entzerrer", "mixpi-mitschnitt"] | index($n) != null)
            | select(((.info.params.Props[]?.channelVolumes[]? // $z) - $z) | fabs > 0.005)
            | .id' 2>/dev/null \
    | sort -u \
    | while read -r id; do
        [ -n "$id" ] || continue
        wpctl set-volume "$id" "${durchreiche}%" >/dev/null 2>&1 || true
      done
}

setze() {
  # KEINE ZAHL IST KEIN "NULL PROZENT" (gefunden beim Gegenlesen 04.08.2026).
  #
  # `klemme` machte aus JEDEM unbrauchbaren Wert eine 0 — auch aus dem Wort
  # "null". Genau das liefert `jq -r` bei einem FEHLENDEN Schluessel, und
  # `chromium-autostart.sh`, `shutdown_sound.sh` und `off_trigger.sh` reichen
  # `$(jq -r .mupibox.startVolume …)` ungeprueft hierher durch. Eine Box, in
  # deren Konfiguration `startVolume` fehlt (oder deren `jq` gerade nicht
  # arbeitet), waere beim Einschalten also auf 0 gestellt worden — STUMM, mit
  # Ruecklauf 0, also ohne dass der `||`-Rueckfall der Aufrufer je griffe.
  # Vorher endete dort ein `pactl … null%` mit einem Fehler und die
  # Lautstaerke blieb, wie sie war; das ist das Verhalten, das hier wieder
  # gilt: unbrauchbarer Wert -> NICHTS anfassen und Ruecklauf 1 melden.
  #
  # `up`/`down` rechnen und geben deshalb immer Ziffern (ggf. mit Vorzeichen)
  # herein — die kommen weiter durch und werden von `klemme` begrenzt.
  local roh="${1:-}"
  roh="${roh%%.*}"                     # "40.5" -> "40", wie bisher in klemme
  case "$roh" in
    ''|*[!0-9-]*) echo "Lautstaerke: '${1:-}' ist keine Zahl - nichts gesetzt" >&2; return 1 ;;
  esac
  # ERST AUF 0..100 KLEMMEN (das ist die Nutzerskala), DANN abbilden.
  local v="${roh%%.*}"
  case "$v" in ''|*[!0-9-]*) v=0 ;; esac
  [ "$v" -lt 0 ] 2>/dev/null && v=0
  [ "$v" -gt 100 ] 2>/dev/null && v=100
  local echt; echt="$(nutzer_zu_echt "$v")"
  case "$(backend)" in
    pipewire)
      einheit_nachziehen
      wpctl set-volume "$(regelnde_senke)" "${echt}%" >/dev/null 2>&1
      # WER SETZT, LIEST ZURUECK [llmwiki drei-skalen-fuer-eine-lautstaerke]:
      # `wpctl set-volume` kann eine Senke STILLSCHWEIGEND nicht stellen —
      # genau so blieb die E94-Wurzel monatelang unsichtbar. Zwei Punkte
      # Kulanz, weil Prozent gegen Bruch gerundet wird — und ein AUGENBLICK
      # Geduld davor: der erste Probelauf las 20 ms nach dem Setzen noch den
      # alten Wert und meldete „ignoriert", obwohl der Befehl laengst
      # unterwegs war. Eine Ruecklese, die schneller ist als das Stellwerk,
      # erzeugt genau die Fehlalarme, vor denen sie schuetzen soll.
      sleep 0.3
      local ist; ist="$(lies)"
      if [ -n "$ist" ] && [ "$(( ist > v ? ist - v : v - ist ))" -gt 2 ]; then
        echo "Lautstaerke: gesetzt ${v}, Senke meldet ${ist} - der Stellbefehl wurde ignoriert" >&2
      fi
      ;;
    alsa)     amixer -q sset "$REGLER" "${echt}%" >/dev/null 2>&1 ;;
    *)        return 1 ;;
  esac
}

case "${1:-}" in
  get)      lies ;;
  set)      setze "${2:-}" ;;
  up)       a="$(lies)"; setze "$(( ${a:-0} + ${2:-5} ))" ;;
  down)     a="$(lies)"; setze "$(( ${a:-0} - ${2:-5} ))" ;;
  backend)  backend ;;
  # Die geltende Obergrenze ausgeben. Zwei Gruende: erstens kann ein Aufrufer
  # (Oberflaeche, Probe) so fragen, WAS gilt, statt es nachzurechnen — eine
  # zweite Rechnung waere eine zweite Wahrheit. Zweitens ist `hoechstwert` damit
  # pruefbar, OHNE dass eine Tonkarte da sein muss: `set` braeuchte wpctl oder
  # amixer, `grenze` braucht nur die Konfiguration.
  grenze)   hoechstwert ;;
  *)        echo "Aufruf: $(basename "$0") get|set <0-100>|up [n]|down [n]|backend|grenze" >&2; exit 2 ;;
esac
