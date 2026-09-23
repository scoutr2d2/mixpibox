#!/usr/bin/env bash
# SIMILAR-GEGENPROBE — decken die Zeugen von mixpi-similar wirklich etwas ab?
#
# Ein gruener Test beweist nichts, solange niemand gesehen hat, wie er faellt.
# Diese Probe macht jede Schutzvorrichtung des Plugins EINZELN kaputt und
# verlangt, dass genau dann ein Zeuge widerspricht. Bleibt er gruen, deckt er
# die Vorrichtung nicht — dann ist sie ungeprueft, egal wie gruen der Lauf
# vorher aussah.
#
# JEDE PROBE HIER ENTSPRICHT EINEM ECHTEN, GEMESSENEN FEHLER (06.09.2026):
# die Schnitte nehmen nicht irgendeine Zeile weg, sondern genau die, die den
# jeweiligen Befund behoben hat. Wer eine Zeile anfasst und diese Probe wird
# gelb ("Schnitt griff nicht"), hat den Schutz umgebaut — dann gehoert der
# sed-Ausdruck nachgezogen, nicht die Probe geloescht.
#
# Aufruf:  bash tools/similar-gegenprobe.sh
set -u

cd "$(dirname "$0")/.." || exit 1
PLUGIN=plugins/mixpi-similar
# ALLE Zeugendateien, nicht nur `index.spec.mjs`: die Wachliste hat eigene,
# und eine Gegenprobe, die sie nicht faehrt, meldet fuer jede
# Wachlisten-Vorrichtung „ungeprueft" — obwohl der Zeuge danebenliegt.
ZEUGEN=("$PLUGIN/index.spec.mjs" "$PLUGIN/wachliste.spec.mjs" "$PLUGIN/wege.spec.mjs")
FRIST=90
FEHLER=0
GEPRUEFT=0

# EINE FALLE FUER DEN ABBRUCH. Ohne sie bleibt bei Strg-C eine absichtlich
# kaputtgemachte Quelldatei im Baum liegen — und der naechste Testlauf sucht
# einen Fehler, den dieses Skript hinterlassen hat.
aufraeumen() {
  for sicherung in "$PLUGIN"/*.gegenprobe "$PLUGIN"/quellen/*.gegenprobe; do
    [ -e "$sicherung" ] && mv "$sicherung" "${sicherung%.gegenprobe}"
  done
  return 0
}
trap aufraeumen EXIT INT TERM

# $1 Beschreibung, $2 Datei, $3 sed-Ausdruck
probe() {
  local was="$1" datei="$2" schnitt="$3" ausgang
  GEPRUEFT=$((GEPRUEFT + 1))

  # DIE SICHERUNG TRAEGT DEN GANZEN PFAD, nicht den Dateinamen: im Baum liegen
  # gleichnamige Dateien in verschiedenen Ordnern, und eine Sicherung nach
  # `basename` ueberschriebe die andere.
  cp "$datei" "$datei.gegenprobe"
  sed -i "$schnitt" "$datei"

  if cmp -s "$datei" "$datei.gegenprobe"; then
    echo " GELB  $was"
    echo "       der Schnitt griff gar nicht — sed-Ausdruck veraltet?"
    FEHLER=$((FEHLER + 1))
    mv "$datei.gegenprobe" "$datei"
    return
  fi

  timeout "$FRIST" node --test "${ZEUGEN[@]}" >/dev/null 2>&1
  ausgang=$?
  mv "$datei.gegenprobe" "$datei"

  case "$ausgang" in
    0)
      echo " FEHL  $was"
      echo "       kaputtgemacht, und die Zeugen blieben GRUEN — ungeprueft."
      FEHLER=$((FEHLER + 1))
      ;;
    124)
      echo " FEHL  $was"
      echo "       der Lauf haengt — hier war ein rotes Urteil erwartet."
      FEHLER=$((FEHLER + 1))
      ;;
    *)
      echo "  ok   $was"
      ;;
  esac
}

echo "── Gegenprobe: jede Schutzvorrichtung einzeln kaputtmachen ──"

# 1. Am echten Bestand gemessen: die Box fuehrt „Hello Kitty Hörspiele", die
#    Themenkarte „Hello Kitty Hoerspiele". Ohne das Ausschreiben faellt das
#    nicht zusammen und der Eintrag ist nicht zu finden.
probe "Umlaut wird ausgeschrieben (oe statt o)" \
  "$PLUGIN/normalisieren.mjs" \
  "s|\.replace(/ö/gu, 'oe')||"

# 2. Deezers Suche stellt „Conni & Co" (leeres /related) vor die gesuchte
#    Hoerspielserie. Ohne die Zahlen gewinnt der erste Treffer.
probe "Deezer waehlt nach Katalog, nicht nach Position" \
  "$PLUGIN/quellen/deezer.mjs" \
  "s|if (b.anhaenger !== a.anhaenger) return b.anhaenger - a.anhaenger||"

# 3. MusicBrainz liefert IMMER etwas. Ohne Schwelle bekommt ein unbekannter
#    Name irgendeine fremde MBID — und unter der werden dann alle Quellen
#    zusammengefuehrt.
probe "MusicBrainz-Schwelle gegen die falsche Identitaet" \
  "$PLUGIN/quellen/musicbrainz.mjs" \
  "s|mindestens = 85|mindestens = 0|"

# 4. Gemessen: 5 von 18 MusicBrainz-Anfragen kamen als 503, obwohl 1 Anfrage/s
#    eingehalten wurde. Als leeres Ergebnis gelesen verschwindet eine Serie,
#    die es gibt — fuer die Dauer der Haltbarkeit.
probe "503 wirft, statt als „kenne ich nicht\" zu gelten" \
  "$PLUGIN/quellen/musicbrainz.mjs" \
  "s|if (antwort.status === 503) throw new Error('MusicBrainz drosselt gerade (503)')||"

# 5. ListenBrainz nennt den Interpreten selbst mit, unter anderer MBID und mit
#    dem hoechsten Wert. Ohne Filter steht die Serie in ihrer eigenen
#    Empfehlung an erster Stelle.
probe "ListenBrainz wirft den Interpreten selbst heraus" \
  "$PLUGIN/quellen/listenbrainz.mjs" \
  "s|a?.artist_mbid !== eigeneMbid|true|"

# 6. Bibi Blocksberg liefert bei vier Algorithmen nichts und beim fuenften
#    einen sinnvollen Treffer. Wer nur einen probiert, haelt „leer" fuer eine
#    Eigenschaft des Dienstes.
probe "ListenBrainz probiert den zweiten Algorithmus" \
  "$PLUGIN/quellen/listenbrainz.mjs" \
  "/session_based_days_9000/d"

# 7. Deezer meldet Fehler mit HTTP 200 und einem `error`-Feld. Wer nur den
#    Status prueft, traegt die Fehlermeldung als leere Liste in die Kartei.
probe "Deezers Fehler im Rumpf wird gesehen" \
  "$PLUGIN/quellen/deezer.mjs" \
  "s|if (daten?.error) throw new Error(\`Deezer: \${daten.error.message ?? JSON.stringify(daten.error)}\`)||"

# 8. Last.fm liefert einen einzelnen Treffer als Objekt statt als Liste — eine
#    Eigenheit aus der XML-Herkunft. Ohne die Behandlung wirft `.map` genau
#    dann, wenn es einen Treffer gibt.
probe "Last.fms Einzeltreffer wird zur Liste" \
  "$PLUGIN/quellen/lastfm.mjs" \
  "s|const alsListe = Array.isArray(liste) ? liste : liste ? \[liste\] : \[\]|const alsListe = liste ?? []|"

# 9. Ein Eimer, der beliebig lange wartet, verwandelt ein Rate-Limit in einen
#    Fristriss — und ein Fristriss terminiert den Worker samt allen offenen
#    Rufen, nicht nur dem einen.
probe "Der Takt sagt nein, statt die Frist zu reissen" \
  "$PLUGIN/takt.mjs" \
  "s|if (warten > hoechstensMs) return false||"

# 10. Ein Vorschlag mit null gemeinsamen Schlagworten ist keine schwache
#     Aehnlichkeit, sondern gar keine.
probe "Die Themenkarte liefert keine Null-Treffer" \
  "$PLUGIN/quellen/inhalt.mjs" \
  "s|if (punkte > 0) bewertet.push|bewertet.push|"

# 11. `kontext.holen` verwehrt die eigene Box. Ohne diese Pruefung faenge sich
#     das Plugin bei jeder Anfrage einen Wurf aus dem Adressenriegel, den
#     niemand zuordnen kann.
probe "Ollama auf localhost wird vorher abgefangen" \
  "$PLUGIN/quellen/inhalt.mjs" \
  "s|if (wirt === 'localhost' \|\| wirt === '::1' \|\| wirt.startsWith('127.')) {|if (false) {|"

# 12. Eine Quelle darf nicht zweimal fuer denselben Treffer stimmen.
probe "Eine Quelle stimmt nur einmal ab" \
  "$PLUGIN/fusion.mjs" \
  "s|if (gesehen.has(treffer.schluessel)) return||"

# 13. Ohne zweite Sortierregel haengt die Reihenfolge bei Gleichstand daran,
#     welche Quelle zufaellig zuerst geantwortet hat.
probe "Gleichstand wird deterministisch aufgeloest" \
  "$PLUGIN/fusion.mjs" \
  "s|return String(a.name).localeCompare(String(b.name), 'de')|return 0|"

# ── DIE WACHLISTE ───────────────────────────────────────────────────────────

# 14. OHNE GRUNDLINIE MELDET DER ERSTE LAUF DEN GANZEN ALTBESTAND. Der
#     teuerste Fehler dieses Bereichs: bei zwanzig Serien sind das mehrere
#     hundert „Neuerscheinungen", und der Nutzer schaltet ab, bevor je etwas
#     Nuetzliches kam.
probe "Die Grundlinie haelt den Altbestand zurueck" \
  "$PLUGIN/wachliste.mjs" \
  "s|if (istNachGrundlinie(v, grundlinieIso)) neu.push({ ...v, schluessel })|neu.push({ ...v, schluessel })|"

# 15. Ein Werk, das MusicBrainz und Deezer beide liefern, darf nur EINMAL
#     gemeldet werden (Abnahmekriterium 7).
probe "Ein Werk aus zwei Quellen wird einmal gemeldet" \
  "$PLUGIN/wachliste.mjs" \
  "s|if (v?.gruppeMbid) return \`rg:\${v.gruppeMbid}\`||"

# 16. Bei „22:00 bis 06:00" ist von groesser als bis. Ein naiver Vergleich
#     liefert dann IMMER falsch — die Wachliste liefe nie, ohne eine einzige
#     Zeile im Journal.
probe "Das Zeitfenster kann ueber Mitternacht" \
  "$PLUGIN/wachliste.mjs" \
  "s|return a < b ? jetztMin >= a \&\& jetztMin < b : jetztMin >= a \|\| jetztMin < b|return jetztMin >= a \&\& jetztMin < b|"

# 17. Ein Lauf, der immer vorn anfaengt, prueft bei knapper Zeit ewig
#     dieselben ersten Eintraege und erreicht die hinteren nie.
probe "Der am laengsten nicht Gepruefte ist als naechster dran" \
  "$PLUGIN/wachliste.mjs" \
  "s|return offen.sort((a, b) => Number(a.zuletztGeprueft ?? 0) - Number(b.zuletztGeprueft ?? 0))\[0\]|return offen[0]|"

# 18. Auch eine Veroeffentlichung VOR der Grundlinie muss als bekannt
#     vermerkt werden — sonst laesst ein geaendertes Datumsformat beim
#     naechsten Lauf den ganzen Altbestand als „neu" durchgehen.
probe "Auch Altes wird als bekannt vermerkt" \
  "$PLUGIN/wachliste.mjs" \
  "s|^    bekannt.add(schluessel)$||"

# 19. Das `artist`-Feld der Box traegt oft mehrere Interpreten. Wer es als
#     einen Namen in die Wachliste legt, beobachtet einen, den kein Dienst
#     kennt.
probe "Das Mehrfachfeld wird zerlegt" \
  "$PLUGIN/wachliste.mjs" \
  "s|for (const teil of roh.split(/\\\\s\*\[,;/\&\]\\\\s\*\|\\\\s+feat\\\\.?\\\\s+/iu)) {|for (const teil of [roh]) {|"

# 20. Der Posteingang muss VOR den Kanaelen geschrieben werden. Ein Kanal,
#     der ausfaellt, darf nie der Grund sein, warum eine Neuigkeit
#     verschwindet (Abnahmekriterium 8).
probe "Der Posteingang wird vor den Kanaelen geschrieben" \
  "$PLUGIN/index.mjs" \
  "s|w.karteien.nachrichten.setzen(nr, { ...ereignis, gelesenAm: null })||"

# 21. Der Resolver darf nicht laufen, wenn ihn keine aktive Quelle braucht —
#     das kostet bei 1 Anfrage/s eine Sekunde von acht fuer nichts. (Diese
#     Luecke hat ein Zeuge gefunden, nicht ein Gedanke.)
probe "Der Resolver laeuft nur, wenn eine Quelle die MBID braucht" \
  "$PLUGIN/index.mjs" \
  "s|const brauchtAufloesung = aktiv.some((q) => q.brauchtMbid === true)|const brauchtAufloesung = true|"

echo
if [ "$FEHLER" -eq 0 ]; then
  echo "KEINE LUECKE. $GEPRUEFT Schutzvorrichtungen einzeln kaputtgemacht, jede wurde bemerkt."
  exit 0
fi
echo "$FEHLER von $GEPRUEFT Vorrichtungen sind UNGEPRUEFT."
exit 1
