#!/usr/bin/env bash
# DOKU-LUECKEN-PROBE — was im Baum liegt, aber in keinem Handbuch steht.
#
# WARUM ES DAS GIBT: der "Stand"-Block in plugins/README.md und die
# Aufzaehlungen in dokumentation/mixpibox.md sind von Hand gepflegte PROSA.
# Sie sind nicht aus `ls plugins/` oder aus `RECHTE` abgeleitet, also faellt
# ein neuer Ordner oder ein neues Recht dort nicht auf. `mupibox-subsonic`
# lag acht Tage im Baum, ehe es das Handbuch zum ersten Mal nannte — und es
# ist ausgerechnet das einzige Musterplugin mit `suchen()` und `geheim`-Feld.
# llmwiki: volles-wiki-ist-kein-beleg-fuer-gepflegte-doku (vierter Fall).
#
# Die Probe hat KEIN Urteilsvermoegen: sie prueft nur, ob der Name ueberhaupt
# vorkommt. Ein Handbuch, das ein Plugin nennt und Falsches darueber sagt,
# faellt hier nicht auf — dagegen hilft nur Lesen.
#
# Aufruf aus dem Wurzelverzeichnis:  bash tools/doku-luecken-probe.sh
# Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.

set -u
cd "$(dirname "$0")/.." || exit 2

HANDBUCH=plugins/README.md
DOKU=dokumentation/mixpibox.md
VERTRAG=src/backend-api/src/plugin-vertrag.ts
KONFIG=src/backend-api/src/konfiguration.ts
WIKI=llmwiki/pack.yaml
BENUTZER=dokumentation/benutzerhandbuch.html
RAHMEN=src/frontend-admin/src/app/rahmen.ts

luecken=0

echo "── Plugins, die das Handbuch nicht nennt ($HANDBUCH) ──"
for p in plugins/*/; do
  n=$(basename "$p")
  if ! grep -q "$n" "$HANDBUCH"; then
    echo "  FEHLT: $n"
    luecken=$((luecken + 1))
  fi
done

echo "── Rechte aus $VERTRAG, die in der Doku fehlen ──"
# Die Zeile sieht so aus:  export const RECHTE = ['medienquelle', …] as const
rechte=$(grep -oP "export const RECHTE = \[\K[^\]]*" "$VERTRAG" | tr -d "' " | tr ',' '\n')
if [ -z "$rechte" ]; then
  echo "  WARNUNG: RECHTE nicht gefunden — hat sich die Zeile geaendert?"
  luecken=$((luecken + 1))
fi
# GESUCHT WIRD DER NAME IN BACKTICKS (`netz`), nicht das blosse Wort. Sonst
# quittiert die Probe "Medienquelle" als Beleg fuer das Recht `medienquelle` —
# das Wort steht in beiden Handbuechern als Begriff, waehrend das RECHT dort
# nie erklaert wird. Eine Probe, die auf solche Treffer hereinfaellt, meldet
# gruen und wird zu Recht ignoriert.
for r in $rechte; do
  for datei in "$HANDBUCH" "$DOKU"; do
    if ! grep -qF "\`$r\`" "$datei"; then
      echo "  FEHLT in $datei: $r"
      luecken=$((luecken + 1))
    fi
  done
done

echo "── Ereignisse aus $VERTRAG, die die Doku nicht nennt ──"
ereignisse=$(grep -oP "export const EREIGNISSE = \[\K[^\]]*" "$VERTRAG" | tr -d "' " | tr ',' '\n')
for e in $ereignisse; do
  if ! grep -q "$e" "$HANDBUCH"; then
    echo "  FEHLT in $HANDBUCH: $e"
    luecken=$((luecken + 1))
  fi
done

echo "── Konfigurationsfelder aus $KONFIG, die keine Doku nennt ──"
# DIESELBE LUECKE EINE EBENE HOEHER. Was fuer Plugins gilt, gilt fuer die
# Felder der mupiboxconfig: `FELDER` ist eine Liste im Code, die Handbuecher
# sind Prosa. Ein neues Feld faellt dort nicht auf — und ein Feld, das kein
# Handbuch nennt, ist fuer jeden, der die Box ohne die Verwaltung einstellen
# will (LLM wie Mensch), schlicht nicht vorhanden.
#
# AB ZEILE `export const FELDER`, NICHT AB DATEIANFANG: davor steht `BEREICHE`
# mit derselben `id:`-Schreibweise. Wer die Bereichsnamen mitnimmt, prueft
# „ton" und „medien" — Woerter, die in jedem Handbuch zufaellig vorkommen, und
# faerbt die Probe damit gruen.
#
# HIER OHNE BACKTICKS gesucht, anders als bei den Rechten: Feldnamen sind
# camelCase-Kunstwoerter (`bildschirmAusNach`), die als deutsches Wort nicht
# vorkommen. Ein Falschtreffer ist damit unwahrscheinlich, ein Treffer in
# Fliesstext dagegen ein echter Beleg.
#
# ZWEI NAMEN JE FELD, UND BEIDE ZAEHLEN. Ein Feld heisst im Verwaltungs-API
# deutsch (`startLautstaerke`) und in der mupiboxconfig englisch
# (`mupibox.startVolume`) — `pfad` haelt die Uebersetzung. Das Wiki ist aelter
# als die deutschen Ids und beschreibt fast alles unter dem JSON-Schluessel.
# Die erste Fassung dieser Probe suchte nur die Id und meldete 22 Luecken,
# von denen 16 keine waren. Wer den JSON-Schluessel nennt, hat das Feld
# dokumentiert — der Weg dorthin steht in konfiguration.ts.
# EXAKT AUF DEN NAMEN, nicht auf den Wortanfang: `^export const FELDER` traf
# bei der Gegenprobe auch ein umbenanntes `FELDERX` und meldete keine Warnung.
# Eine Wache, die jede Umbenennung ueberlebt, ist keine.
felder_ab=$(grep -nE "^export const FELDER\b" "$KONFIG" | head -1 | cut -d: -f1)
if [ -z "$felder_ab" ]; then
  echo "  WARNUNG: 'export const FELDER' nicht gefunden — hat sich die Datei geaendert?"
  luecken=$((luecken + 1))
else
  # Je Feld eine Zeile "id schluessel": die Id und das LETZTE Glied aus `pfad`
  # (aus ['mupibox', 'startVolume'] wird startVolume).
  paare=$(awk -v ab="$felder_ab" 'NR>=ab' "$KONFIG" |
    grep -oP "^\s+(id|pfad): \K.*" |
    sed -E "s/^'([^']+)',?$/ID \1/; s/^\[.*'([^']+)'\],?$/KEY \1/" |
    awk '/^ID /{id=$2} /^KEY /{if (id != "") {print id, $2; id=""}}')
  while read -r id schluessel; do
    [ -z "$id" ] && continue
    if ! grep -qF "$id" "$WIKI" && ! grep -qF "$id" "$DOKU" &&
      ! grep -qF "$schluessel" "$WIKI" && ! grep -qF "$schluessel" "$DOKU"; then
      echo "  FEHLT in $WIKI und $DOKU: $id (mupiboxconfig: $schluessel)"
      luecken=$((luecken + 1))
    fi
  done <<<"$paare"
fi

echo "── Verwaltungsseiten aus $RAHMEN, die das Benutzerhandbuch nicht nennt ──"
# WARUM DIESE PRUEFUNG SPAETER KAM ALS DIE ANDEREN (22.08.2026): bis hierher
# kannte die Probe ZWEI Handbuecher — plugins/README.md und
# dokumentation/mixpibox.md. Drei Doku-Laeufe in Folge schrieben "beide
# Handbuecher" und meinten genau diese zwei. Das DRITTE,
# dokumentation/benutzerhandbuch.html, stand in KEINER Probe und war das
# einzige, das ein Betreiber wirklich liest. Es fuehrte eine Tabelle mit 14
# Seiten, waehrend die Kopfleiste 17 hat: `Profile` stand unter der falschen
# Gruppe und hiess noch `Kinderzeit`, und `Ton`, `Plugins`, `Leistung` und
# `Sicherung` fehlten ganz. Die ganze Plugin-Verwaltung kam in dem Handbuch
# mit keinem Wort vor.
#
# GEPRUEFT WIRD NUR DIE AUFZAEHLUNG, nicht der Inhalt: ein Benutzerhandbuch
# muss `RECHTE` und `EREIGNISSE` NICHT auffuehren — das sind Namen fuer
# Plugin-Bauer, und eine Probe, die sie hier einfordert, meldet ewig rot und
# wird zu Recht ignoriert. Der MENUEPUNKT dagegen ist genau das, wonach ein
# Leser sucht; fehlt er, sucht der Leser eine Seite, die es gibt.
if [ ! -f "$RAHMEN" ]; then
  echo "  WARNUNG: $RAHMEN nicht gefunden — ist die Kopfleiste umgezogen?"
  luecken=$((luecken + 1))
else
  # Aus <a routerLink="/x" …>Beschriftung</a> wird die BESCHRIFTUNG geholt,
  # nicht der Weg: das Handbuch nennt Menuepunkte so, wie sie dastehen
  # ("Profile"), waehrend der Weg noch der alte ist (/kinderzeit).
  seiten=$(grep -oP '<a routerLink="/[^"]+"[^>]*>\K[^<]+' "$RAHMEN" | sort -u)
  for s in $seiten; do
    if ! grep -qF "$s" "$BENUTZER"; then
      echo "  FEHLT in $BENUTZER: $s"
      luecken=$((luecken + 1))
    fi
  done
fi

ROUTEN=src/frontend-admin/src/app/app.routes.ts
echo "── Seiten aus $ROUTEN, die kein Handbuch nennt ──"
# DIE LUECKE DER PRUEFUNG DARUEBER (22.08.2026): jene liest die KOPFLEISTE.
# Eine Seite ohne Leisteneintrag kann sie darum nicht vermissen. Genau vier
# gibt es davon — `rahmen.ts` fuehrt 17 Eintraege, `app.routes.ts` 21 Seiten —
# und zwei davon sind vollwertige Seiten mit eigener Ablage: `/verschmelzung`
# ("Doppelte", config/verschmelzung.json) und `/interpreten`
# (config/interpreten.json). Beide erreicht man nur ueber einen Link auf der
# Medienseite. In dokumentation/mixpibox.md kamen sie mit NULL Treffern vor,
# waehrend dieselbe Datei zwei Zeilen weiter „21 Seiten" behauptete: sie
# zaehlte sie, ohne sie zu kennen. Das Wiki kannte beide laengst (6 bzw. 9
# Treffer) — llmwiki `volles-wiki-ist-kein-beleg-fuer-gepflegte-doku`.
#
# GEZAEHLT WIRD DER TITEL, NICHT DER PFAD: die Handbuecher schreiben
# „Doppelte", nie `/verschmelzung`. Eine Probe auf den Pfad meldet rot, obwohl
# die Seite dasteht — und eine auf den Pfad, die gruen meldet, hat nichts
# geprueft. Aus `title: 'Doppelte – MixPiBox'` wird darum `Doppelte`.
#
# EIN TREFFER IN EINEM DER BEIDEN HANDBUECHER REICHT NICHT: gesucht wird in
# beiden getrennt. Das Benutzerhandbuch nannte beide Seiten in einem Nebensatz,
# waehrend das Architekturhandbuch sie gar nicht kannte — eine Oder-Pruefung
# haette das durchgewinkt.
if [ ! -f "$ROUTEN" ]; then
  echo "  WARNUNG: $ROUTEN nicht gefunden — sind die Wege umgezogen?"
  luecken=$((luecken + 1))
else
  # NUR DIE SEITEN OHNE LEISTENEINTRAG, und das ist der ganze Witz der
  # Pruefung: die 17 Menueseiten hat die Pruefung darueber schon gegen das
  # Benutzerhandbuch gehalten. Verlangte diese hier zusaetzlich JEDE Seite
  # auch im ARCHITEKTURhandbuch, meldete sie auf Dauer rot ("Systemdienste",
  # "Profile", "Netzwerk" — Namen, die dort nichts zu suchen haben) und waere
  # nach der zweiten Woche Rauschen. Dieselbe Falle wie bei `RECHTE` im
  # Benutzerhandbuch, nur andersherum.
  #
  # `anmeldung` faellt heraus wie schon oben: eine Anmeldemaske ist kein
  # Kapitel.
  menue=$(grep -oP '<a routerLink="/[^"]+"[^>]*>\K[^<]+' "$RAHMEN" | sort -u)
  titel=$(awk -F"'" '
    /^[[:space:]]+path: /  { weg = $2 }
    /^[[:space:]]+title: / { if (weg != "anmeldung") print $2; weg = "" }
  ' "$ROUTEN" | sed -E 's/ *[–-] *MixPiBox$//' | sort -u)
  if [ -z "$titel" ]; then
    echo "  WARNUNG: keine 'title:'-Zeile gefunden — hat sich die Schreibweise geaendert?"
    luecken=$((luecken + 1))
  fi
  titel=$(comm -23 <(echo "$titel") <(echo "$menue"))
  while read -r t; do
    [ -z "$t" ] && continue
    for datei in "$DOKU" "$BENUTZER"; do
      if ! grep -qF "$t" "$datei"; then
        echo "  FEHLT in $datei: $t"
        luecken=$((luecken + 1))
      fi
    done
  done <<<"$titel"
fi

# ── DIE SCHNITTSTELLE (23.08.2026) ──────────────────────────────────────────
# Alles bisher Gepruefte ist etwas, das ein MENSCH in der Oberflaeche sieht:
# Plugins, Rechte, Felder, Menuepunkte. Die 195 REST-Endpunkte standen in
# keiner Probe — und sie sind das Einzige, was ein Skript oder ein LLM
# benutzt, das die Verwaltung gar nicht aufmacht. dokumentation/mixpibox.md
# nannte sieben davon (alle aus `/api/stroeme`).
#
# EIGENE DATEI, weil die Pruefung eine Aufweitung braucht, die hier sonst
# niemand hat: `:kennung` gegen ein Beispiel wie `mupibox-wled` zu halten
# geht nur ueber ein Muster. Sie laeuft trotzdem hier mit, damit ein Lauf
# reicht.
echo "── REST-Endpunkte ohne Doku (tools/api-doku-deckung.sh) ──"
if ! api_ausgabe=$(bash tools/api-doku-deckung.sh 2>&1); then
  echo "$api_ausgabe" | grep -E "FEHLT|WARNUNG|ungenannt"
  luecken=$((luecken + 1))
fi

# ── WAS AUF DER BOX LAEUFT (23.08.2026) ─────────────────────────────────────
# Alles bisher Gepruefte — bis hin zu den REST-Endpunkten vom selben Tag —
# bleibt in der ANWENDUNG. Was auf der Box als Dienst laeuft, stand in keiner
# Probe, obwohl `dokumentation/mixpibox.md` dafuer ein eigenes Kapitel hat
# (4.1 „Die laufenden Dienste"). Dessen Tabelle nannte sich „Auf einer
# eingerichteten Box:" und fuehrte SIEBEN Units, waehrend die Ausrollwege
# ZWANZIG scharf schalten. `mupi_offtrigger` — der weiche Ausschalter am
# Knopf — stand in keinem Handbuch UND mit null Treffern im Wiki.
#
# EIGENE DATEI, weil die Liste der scharfen Units aus den Ausrollwegen kommt
# und nicht aus einem Verzeichnis; die Begruendung dafuer steht dort.
echo "── Dienste ohne Doku (tools/dienste-doku-deckung.sh) ──"
if ! dienst_ausgabe=$(bash tools/dienste-doku-deckung.sh 2>&1); then
  echo "$dienst_ausgabe" | grep -E "FEHLT|WARNUNG"
  luecken=$((luecken + 1))
fi

# ── WO DER BESTAND LIEGT (23.08.2026) ───────────────────────────────────────
# Acht Pruefungen standen hier, und alle acht meldeten an diesem Tag gruen.
# Sie decken die ANWENDUNG (Plugins, Rechte, Felder, Seiten, Endpunkte) und
# die BOX (Dienste). Was in keiner vorkam, ist die ABLAGE: die rund dreissig
# JSON-Dateien unter `server/config`, in denen der ganze Bestand liegt — die
# Box hat keine Datenbank. Gemessen standen 27 von 34 Aufnahmen der Sicherung
# in KEINEM Handbuch, darunter `data.json` (die Bibliothek), `profile.json`
# (das Verzeichnis der Kinder) und `resume.json`. Das Wiki kannte sie mit 102,
# 17 und 113 Treffern — der vierte Fall von
# llmwiki `volles-wiki-ist-kein-beleg-fuer-gepflegte-doku` in dieser Datei.
#
# EIGENE DATEI, weil die Liste aus `HINEIN` in einem PYTHON-Skript kommt und
# die fnmatch-Muster (`profile/*/resume.json`) vor dem Suchen auf den blossen
# Namen zurueckgefuehrt werden muessen; die Begruendung dafuer steht dort.
echo "── Ablagen ohne Doku (tools/ablage-doku-deckung.sh) ──"
if ! ablage_ausgabe=$(bash tools/ablage-doku-deckung.sh 2>&1); then
  echo "$ablage_ausgabe" | grep -E "FEHLT|WARNUNG"
  luecken=$((luecken + 1))
fi

# ── DIE ZWEI ZAHLEN IN DER KOPFZEILE (23.08.2026) ───────────────────────────
# `dokumentation/mixpibox.md` nennt gleich im dritten Absatz den Umfang des
# Wissenspakets („743 Eintraege, Fassung 248"). Gemessen waren es an diesem Tag
# 780 und 291 — um 37 Eintraege und 43 Fassungen alt, und in keiner Wache.
#
# WARUM DAS MEHR IST ALS KOSMETIK: der Satz daneben verweist den Leser fuer
# jede Einzelheit AUFS PAKET. Eine Zahl, die vierzig Fassungen hinterherhinkt,
# sagt ihm, dass dieser Verweis nicht gepflegt wird — und dann liest er das
# Paket gar nicht erst. Es ist dieselbe Klasse wie die Tabelle mit sieben von
# zwanzig Diensten: eine Aussage, die Vollstaendigkeit behauptet und keine hat.
#
# HIER INLINE UND NICHT IN EIGENER DATEI: es sind zwei Zahlen aus einer Datei,
# die schon offen ist. Eine eigene Wache dafuer waere mehr Gerüst als Inhalt.
echo "── Der Umfang des Wissenspakets, in jeder Datei die ihn nennt ──"
if [ ! -f "$WIKI" ]; then
  echo "  WARNUNG: $WIKI nicht gefunden — ist das Paket umgezogen?"
  luecken=$((luecken + 1))
else
  # DIE PRUEFUNG LAS BIS ZUM 27.08.2026 GENAU EINE DATEI, `$DOKU`.
  # Dieselbe Angabe stand aber an drei Stellen, und die beiden ungewachten
  # waren weit auseinandergelaufen: die README bei 799, das Benutzerhandbuch
  # bei 777 (und mit `llmwiki_mupibox` als Quelle, dem stillgelegten
  # Nachbarrepo). Wer nach dem PFAD sucht, findet die naechste Kopie nie —
  # sie entsteht in einer Datei, die beim Bau niemand im Kopf hatte. Gesucht
  # wird deshalb nach dem MERKMAL „diese Datei behauptet den Umfang", ueber
  # den ganzen Baum (llmwiki `umfangsangabe-stand-an-drei-orten-die-wache-kannte-einen`).
  if ausgabe=$(python3 tools/paket-angaben-nachziehen.py --pruefen 2>&1); then
    :
  else
    printf '%s\n' "$ausgabe" | grep -vE '^ok ' | sed 's/^/  /'
    luecken=$((luecken + 1))
  fi
fi

# ── DIE README (23.08.2026) ─────────────────────────────────────────────────
# Neun Pruefungen standen hier, und alle neun meldeten an diesem Tag gruen —
# waehrend die README, die Datei, die JEDER zuerst liest, SECHS falsche Zahlen
# fuehrte: `tools/` mit 71 statt 438, NewDesign mit ~9100 statt 38 734, das
# Wissenspaket mit 690 statt 796, dazu Testdateien, Seiten und Units. Dazu ein
# Widerspruch aus zwei Saetzen („der PHP-Admin ist ausgebaut worden. Der
# Rueckbau des PHP-Admins steht aus.").
#
# `tools/readme-behauptungen-pruefen.sh` HAT DAS ALLES GEMESSEN und trotzdem
# gruen gemeldet: die Zahlen wurden gedruckt, nicht geurteilt. Es urteilt seit
# heute (Toleranzband, siehe dort) — und laeuft hier mit, weil ein Doku-Lauf,
# der die README auslaesst, das Wichtigste auslaesst.
echo "── Behauptungen der README (tools/readme-behauptungen-pruefen.sh) ──"
if ! readme_ausgabe=$(bash tools/readme-behauptungen-pruefen.sh 2>&1); then
  echo "$readme_ausgabe" | grep -E "FEHLT|VERALTET"
  luecken=$((luecken + 1))
fi

# ── DIE ANDEREN DREI LISTEN DESSELBEN VERTRAGS (23.08.2026) ─────────────────
# Ganz oben haelt diese Datei `RECHTE` und `EREIGNISSE` aus
# `plugin-vertrag.ts` gegen die Handbuecher. Dieselbe Datei fuehrt DREI
# weitere geschlossene Listen — `SEKTIONEN`, `FELDARTEN`, `KONFIG_GRUPPEN` —
# und keine stand in einer Wache. `streaming/jellyfin` hatte in
# plugins/README.md null Treffer, waehrend der Abschnitt daneben `SEKTIONEN`
# „ein geschlossenes Vokabular" nennt und es nicht aufzaehlt.
#
# EIGENE DATEI, und diesmal nicht nur wegen der Aufweitung: die Wache prueft
# eine Frage, die hier sonst keine stellt — ob ein Name nicht bloss
# DOKUMENTIERT ist, sondern einen KONSUMENTEN hat. Sie fand damit zwei tote
# Werte (`ton`, `medien` haengen ins Leere; `mixpi-archive` meldet sich unter
# `medien` an und ist unsichtbar) und einen Ort ohne Wert
# (`streaming/deezer`). Eine reine Namenspruefung haette alle drei
# durchgewinkt, sobald jemand die Woerter in die README schreibt.
#
# ALLE DREI SIND ABSICHT, und darum stand diese Probe seit dem 23.08. dauerhaft
# auf „1 LUECKE(N)" — der Grund wurde im selben Commit in plugins/README.md
# geschrieben, die Wache konnte nie gruen werden. Seit dem 25.08.2026 liest sie
# ihre Ausnahmen AUS DER README und meldet einen VIERTEN Befund wieder als
# solchen. Wer eine Abweichung hinnehmen will, erklaert sie dort; wer sie
# abstellt, zieht dort nach (`DOKU VERALTET`).
echo "── Vokabular des Plugin-Vertrags (tools/sektionen-deckung.py) ──"
if ! sektion_ausgabe=$(python3 tools/sektionen-deckung.py 2>&1); then
  echo "$sektion_ausgabe" | grep -E "FEHLT|WARNUNG|VOKABULAR|ORT"
  luecken=$((luecken + 1))
fi

# ── Und die NAMEN des Vertrags, nicht nur seine Vokabulare (19.09.2026) ─────
#
# Die Wache darueber prueft die geschlossenen LISTEN (SEKTIONEN, FELDARTEN,
# KONFIG_GRUPPEN). Die Namen daneben — Manifest-Felder, Kontext-Felder und die
# Vertragsmethoden aus plugin-vertrag.ts/plugin-laufwerk.ts, also genau das,
# was ein Fremdentwickler selbst hinschreiben muss — deckte keine. Dafuer gibt
# es tools/mixpi-vertrag-doku-abgleich.mjs seit E80, und es hing bis heute in
# KEINEM Laeufer (AUDIT-2026-09-19 Rang 9). Es warnt zusaetzlich bei genau
# EINEM Treffer, weil `konfig` schon einmal genau einmal dastand — im falschen
# Zusammenhang, und die Luecke ging durch.
#
# Hier und nicht in pruefen.sh, weil es eine Doku-Frage ist. Gemessen 55 ms,
# gruen, kein Netz, kein Geraet.
echo "── Namen des Plugin-Vertrags (tools/mixpi-vertrag-doku-abgleich.mjs) ──"
if ! vertragnamen_ausgabe=$(node tools/mixpi-vertrag-doku-abgleich.mjs 2>&1); then
  echo "$vertragnamen_ausgabe"
  luecken=$((luecken + 1))
fi

# ── DA, GUELTIG UND UNSICHTBAR (05.09.2026) ─────────────────────────────────
# Der Betreiber verlangte ein Zeichen fuer das Archiv-Plugin — es GAB eines,
# die Route lieferte es mit 200, und zu sehen war nichts: alle fuenf Zeichen
# malten mit `currentColor`, und ein SVG im `img`-Element ist ein eigenes
# Dokument, das die `color` der Seite nicht sieht. Gemessen 1,12:1 auf dem
# Untergrund der Verwaltung.
#
# KEINE VORHANDENE WACHE KONNTE DAS FINDEN: sie fragen, ob die Datei da ist
# und ob sie sich parsen laesst — beides war wahr. „Unsichtbar" sieht man erst
# nach dem RENDERN, und genau das tut diese hier (rsvg-convert + Pillow, gegen
# die Farbe aus styles.css).
echo "── Sichtbarkeit der Plugin-Zeichen (tools/plugin-icon-kontrast.py) ──"
if ! icon_ausgabe=$(python3 tools/plugin-icon-kontrast.py 2>&1); then
  echo "$icon_ausgabe" | grep -E "FUND|WARNUNG|UMGEBUNG"
  luecken=$((luecken + 1))
fi

# ── DIE GEGENRICHTUNG (23.08.2026) ──────────────────────────────────────────
# ZWOELF Wachen standen hier, und alle zwoelf fragen dasselbe in EINE
# Richtung: steht der Name aus dem Code irgendwo in einem Handbuch? Keine
# fragte, ob es noch GIBT, WORAUF DIE DOKU ZEIGT.
#
# Der Unterschied ist teuer. Ein Handbuch, das ein Plugin nicht nennt, ist
# unvollstaendig — der Leser merkt es. Ein Wiki-Eintrag, der zum Nachmessen
# `tools/rechte-am-geraet.sh <adresse>` empfiehlt, ist schlimmer: die Datei
# gab es im ganzen Baum nie, der Leser bekommt „No such file", und weiss
# danach weder, ob die Messung stattfand, noch wie er sie wiederholt. Dazu
# zeigte das Paket auf `src/backend-api/src/mitschnittliste.ts` — die
# E66-Warteliste war am selben Tag ins Plugin gezogen (b8abd047).
#
# UND DIE UMZUGS-SCHULD: seit `remote-step-installer/` am 10.08. per subtree
# hereinkam, ist ein blosses `tools/qr.py` zweideutig — `tools/` gibt es im
# Hauptbaum auch, mit 440 anderen Dateien und ohne qr.py. Siebzehn solcher
# Pfade standen in Paket und Handbuch. Das ist die teure Sorte: der Pfad zeigt
# auf einen ECHTEN Ordner, nur den falschen, und sieht darum nicht wie ein
# Fehler aus.
echo "── Pfade, auf die die Doku zeigt (tools/doku-pfade-pruefen.py) ──"
if ! pfad_ausgabe=$(python3 tools/doku-pfade-pruefen.py 2>&1); then
  echo "$pfad_ausgabe" | grep -E "TOT|MEHRDEUTIG|WARNUNG"
  luecken=$((luecken + 1))
fi

# ── DAS ZIEL AN DER WURZEL (03.09.2026) ─────────────────────────────────────
# Die Wache darueber liest Pfade aus FLIESSTEXT und verlangt dafuer ein
# oberstes Verzeichnis mit Schraegstrich — sonst waere jedes `app.css` in
# jedem Absatz ein Baumpfad. Der Preis stand nirgends: ein Ziel AN DER WURZEL
# faellt durch. Beide Faelle in dieselbe `BACKLOG.md` geschrieben und gemessen:
# `[x](dokumentation/GIBTSNICHT.md)` meldet TOT, `[y](WURZEL-GIBTSNICHT.md)`
# schweigt. An der Wurzel liegt die meistgelesene Prosa (README, BACKLOG,
# MODERNIZATION, die KONZEPT-*.md) — dritte Blindstelle derselben Wache.
#
# Die neue nimmt darum die SORTE, die eindeutig ein Pfad IST: das Ziel eines
# `[text](ziel)`. Und sie prueft gegen `git ls-files` statt `os.path.exists`,
# weil eine Datei DALIEGEN und trotzdem keinem Commit gehoeren kann — genau
# das steht heute im Baum (BACKLOG.md:11183 -> KONZEPT-NACHBARSCHAFT.md).
echo "── Ziele der Markdown-Verweise (tools/md-verweise-pruefen.py) ──"
if ! mdverweis_ausgabe=$(python3 tools/md-verweise-pruefen.py 2>&1); then
  echo "$mdverweis_ausgabe" | grep -E "TOT|UNVERFOLGT|WARNUNG"
  luecken=$((luecken + 1))
fi

# ── UND DIE SPRUNGMARKE DAHINTER? (03.09.2026) ──────────────────────────────
# Die Wache darueber prueft das Ziel eines `[text](ziel)` — aber nur die DATEI
# davor. Ihre Zeile `ziel = m.group(1).split("#")[0]` wirft die Sprungmarke
# weg, und ihr `FREMD`-Muster (`^#`) verwirft einen seitenintern springenden
# Verweis ganz. Fuer eine PFAD-Wache ist beides richtig. Der Preis stand
# nirgends: ein Verweis, dessen Datei stimmt und dessen MARKE ins Leere zeigt,
# wurde von keiner Wache bemerkt. Gemessen 03.09. im HEAD-Baum: 16 Verweise
# mit Sprungmarke, alle 16 seitenintern, alle 16 uebersprungen — die Richtung
# war zu 100 % ungedeckt, obwohl die Wache daneben gruen meldete.
# Gegengeprobt im Wegwerf-Baum: tote Marke seitenintern UND quer ueber Dateien
# wird gemeldet, Exit 1.
echo "── Sprungmarken der Markdown-Verweise (tools/md-sprungmarken-pruefen.py) ──"
if ! sprungmarke_ausgabe=$(python3 tools/md-sprungmarken-pruefen.py 2>&1); then
  echo "$sprungmarke_ausgabe" | grep -E "TOTE MARKE|WARNUNG|SELBSTTEST"
  luecken=$((luecken + 1))
fi

# ── DIE VERWEISE IM PAKET SELBST (23.08.2026) ───────────────────────────────
# `tools/pack-verweise.py` gibt es seit dem 08.08. und es meldete seither
# gruen — waehrend ZWEI `[[…]]`-Verweise im Paket ueber den Zeilenrand
# gerutscht waren. YAML faltet die Zeile zu einem Leerzeichen, und das Muster
# der Wache kannte keinen Leerraum: sie sah die Verweise GAR NICHT und meldete
# gruen, weil sie nichts fand. Seit heute faltet sie zurueck und meldet den
# Knick. Laeuft hier mit, weil ein Doku-Lauf, der das Paket prueft, auch
# dessen inneren Zusammenhalt pruefen soll.
echo "── Verweise im Wissenspaket (tools/pack-verweise.py) ──"
if ! verweis_ausgabe=$(python3 tools/pack-verweise.py 2>&1); then
  echo "$verweis_ausgabe" | grep -E "GIBT ES NICHT|gerutscht|BEFUND|WARNUNG"
  luecken=$((luecken + 1))
fi

# ── DOPPELTE SCHLUESSEL IN EINEM EINTRAG (29.08.2026) ───────────────────────
# `pack-verweise.py` prueft, wohin Verweise zeigen. Diese Wache prueft, ob ein
# Feld ueberhaupt ANKOMMT: YAML erlaubt denselben Schluessel zweimal, und
# safe_load behaelt kommentarlos den letzten. Eine Ergaenzung am falschen Ende
# eines Eintrags steht dann in der Datei, im Diff und im Commit -- und wirkt
# nicht. Genau so ist an diesem Tag ein `related:` verschwunden.
echo "── Doppelte Schluessel im Wissenspaket (tools/pack-doppelte-schluessel.py) ──"
if ! doppel_ausgabe=$(python3 tools/pack-doppelte-schluessel.py 2>&1); then
  echo "$doppel_ausgabe" | grep -E "DOPPELT|steht in Zeile|doppelte"
  luecken=$((luecken + 1))
fi

# ── EIN SYMPTOM, ZWEI EINTRAEGE (29.08.2026) ────────────────────────────────
# Drei Paare im Paket teilten sich eine Logzeile bei verschiedener Ursache
# ('Cannot ensure player ready', 'Touch reagiert nicht', die durchgestrichene
# Wolke). Wer beim Suchen den ersten Treffer las, hielt einen halben Weg fuer
# den ganzen. Verbunden werden sie von Hand; diese Wache nennt die noch
# offenen. Sie ist absichtlich noch ROT: die Liste ist endlich und benannt,
# nicht ein Dauerzustand.
echo "── Ein Symptom in zwei Eintraegen (tools/symptom-kollision-probe.py) ──"
if ! symptom_ausgabe=$(python3 tools/symptom-kollision-probe.py 2>&1); then
  echo "$symptom_ausgabe" | grep -E "^KOLLISION|unverbundene"
  luecken=$((luecken + 1))
fi

# ── LAUFEN DIE ZEUGEN DER PLUGINS NOCH? (06.09.2026) ────────────────────────
# Zwoelf Plugins bringen je eine `index.spec.mjs` mit, und bis heute rief sie
# KEIN Laeufer — sie liefen nur, wenn jemand gerade an dem einen Plugin
# arbeitete. Das ist die Falle „eine Wache, die niemand ruft, ist keine
# Wache", und sie beisst hier besonders leise: die Zeugen pruefen den VERTRAG
# mit dem Kern, und der Kern wandert weiter. Ein Plugin rostet also nicht
# durch eigene Aenderungen fest, sondern durch fremde — sichtbar erst auf der
# Box, wo es wie ein kaputtes Plugin aussieht statt wie eine
# Vertragsaenderung.
echo "── Zeugen aller Plugins (tools/plugin-zeugen-probe.sh) ──"
if ! zeugen_ausgabe=$(bash tools/plugin-zeugen-probe.sh 2>&1); then
  echo "$zeugen_ausgabe" | grep -E "^ FEHL|rote Zeugen"
  luecken=$((luecken + 1))
fi

# ── HEISST DER KNOPF SO? (23.08.2026) ───────────────────────────────────────
# DREIZEHN Wachen standen hier. Zwoelf fragen, ob ein Name aus dem CODE in
# einem Handbuch steht; die dreizehnte, ob es den PFAD noch gibt, auf den die
# Doku zeigt. Keine fragte, ob es den KNOPF gibt, den die Doku in
# Anfuehrungszeichen zitiert — und ob er auf der Oberflaeche sitzt, in die der
# Satz den Leser schickt.
#
# Gemessen traf das FUENF Zitate im Benutzerhandbuch, alle nach demselben
# Muster: ein Ablauf der BOX-Oberflaeche, der der VERWALTUNG zugeschrieben
# wird. „In der Verwaltung: Streaming-Dienste → Spotify → ,Ton anmelden' →
# ,Code anzeigen'" — beide Beschriftungen sind echt und stehen in
# `frontend-box`; in der Verwaltung heisst der Knopf `Code holen`. Das kommt
# durch jede Namenspruefung (die Woerter stehen im Baum) und durch die
# Widerruf-Probe (widerrufen wurde nichts, die Aussage war nie richtig).
echo "── Zitierte Beschriftungen (tools/beschriftungen-deckung.py) ──"
if ! beschriftung_ausgabe=$(python3 tools/beschriftungen-deckung.py 2>&1); then
  echo "$beschriftung_ausgabe" | grep -E "OBERFLAECHE|ERFUNDEN|AUSNAHME|WARNUNG"
  luecken=$((luecken + 1))
fi

# ── UND AUF WELCHER SEITE? (29.08.2026) ─────────────────────────────────────
# Die Wache darueber misst die OBERFLAECHE (`frontend-admin` gegen
# `frontend-box`) und ist innerhalb der Verwaltung blind. Gemessen an diesem
# Tag: das Handbuch schickte fuer Suche und Aufnahme des Internet Archive nach
# `Verwaltung → Plugins → Internet Archive`. Beide Knoepfe stehen in
# `frontend-admin` — aber auf `seiten/medien.ts`, waehrend die Plugin-
# Unterseite (`seiten/plugin-eine.ts`) nur Einstellungen und Aktionen zeichnet.
# Gruen bei der Schwesterwache, falsch fuer den Betreiber. Ein Befund traegt
# die Schicht, in der gemessen wurde.
echo "── Seite hinter dem Weg (tools/handbuch-ort-deckung.py) ──"
if ! ort_ausgabe=$(python3 tools/handbuch-ort-deckung.py 2>&1); then
  echo "$ort_ausgabe" | grep -E "Zeile|Ausnahme"
  luecken=$((luecken + 1))
fi

# ── GIBT ES DIE ROUTE? (23.08.2026) ─────────────────────────────────────────
# VIERZEHN Wachen standen hier, und eine davon (`api-doku-deckung.sh`) zaehlt
# 195 Endpunkte aus dem Backend gegen die Doku. Sie fragt nur die Richtung
# CODE -> DOKU: wird jede Route irgendwo genannt? Ein `/api/…`, das in der
# Doku steht und im Backend fehlt, verbessert dort sogar die Trefferquote.
# `doku-pfade-pruefen.py` stellt die Gegenfrage, aber nur fuer DATEIEN — ein
# Endpunkt faellt durch beide Netze.
#
# Gemessen: `plugins/README.md` begruendete seit E78, warum es keinen zweiten
# Weg zur ARD-Folgenliste mehr gibt, und schickte zum Nachlesen an
# `/api/ard/inhalt` — eine Route, die es nie gab (gemeint war
# `/api/werke/:schluessel/inhalt`). Wer die Regel pruefen will, greppt den
# Namen, findet nichts und haelt entweder den Abschnitt fuer alt oder die
# Regel fuer unbelegt.
echo "── Zitierte Endpunkte (tools/endpunkt-zitate-pruefen.py) ──"
if ! endpunkt_ausgabe=$(python3 tools/endpunkt-zitate-pruefen.py 2>&1); then
  echo "$endpunkt_ausgabe" | grep -E "ZEIGT INS LEERE|WARNUNG"
  luecken=$((luecken + 1))
fi

# DIESELBE FRAGE, EINE ABLAGE WEITER (25.08.2026): die Wache darueber liest die
# drei Handbuecher. In diesem Baum steht die dichteste Prosa ueber Endpunkte
# aber in den KOMMENTAREN — Aufsaetze, die begruenden, warum etwas so gebaut
# ist. 156 Zitate, keines je gegen den Router gehalten; drei zeigten auf
# Kernrouten, die mit E77 gefallen sind, darunter die Begruendung dafuer,
# warum die ARD KEIN eigenes Suchformular bekommt.
echo "── Endpunkte in Kommentaren (tools/kommentar-endpunkte-pruefen.py) ──"
if ! kommentar_ausgabe=$(python3 tools/kommentar-endpunkte-pruefen.py 2>&1); then
  echo "$kommentar_ausgabe" | grep -E "ZEIGT INS LEERE|WARNUNG"
  luecken=$((luecken + 1))
fi

# Eine Ablage kann an ZWEI Orten liegen — box-weit und je Kind. Alle Wachen
# davor fragen, ob ein Name DASTEHT; diese fragt, ob die Zeile weiss, dass es
# die andere gibt. Zwei Laeufe hintereinander (`listen.json`, `darstellung.json`)
# fanden genau diese Form von Hand, weil eine Tabelle gescannt und nicht
# gelesen wird.
echo "── Ablagen an zwei Orten (tools/ablage-tabellen-gegenstelle.py) ──"
if ! gegenstelle_ausgabe=$(python3 tools/ablage-tabellen-gegenstelle.py 2>&1); then
  echo "$gegenstelle_ausgabe" | grep -E "OHNE GEGENSTELLE|UEBERSCHRIFT WEG"
  luecken=$((luecken + 1))
fi

# Die Verwaltung glaubte einer 200-Antwort die FORM: `lage()?.aktionen.filter`
# wirft bei einem Rumpf ohne `aktionen` in jedem Change-Detection-Lauf
# (QA-Lauf 07.09.2026, am Stub mit zwei TypeErrors belegt). Die Wache kennt
# die gemeldeten Stellen und faellt bei NEUEN um — und ebenso, wenn eine
# behobene noch als Ausnahme eingetragen ist.
echo "── Verwaltung: 200-Antwort ohne Formpruefung (tools/verwaltung-formabweichung-schau.py) ──"
if ! formabw_ausgabe=$(python3 tools/verwaltung-formabweichung-schau.py 2>&1); then
  echo "$formabw_ausgabe" | grep -E "NEU:|VERALTET:" -A 3
  luecken=$((luecken + 1))
fi

# ALLE WACHEN DAVOR HALTEN DEN BAUM gegen die Handbuecher. Eine E-Nummer liegt
# aber nicht im Baum — sie entsteht in einer Commit-Betreffzeile und stirbt
# dort, wenn niemand sie eintraegt. Gemessen am 24.08.2026: ZEHN ausgelieferte
# Nummern (E53, E75, E76, E80, E81, E82, E85, E86, E89, E90) standen in
# BACKLOG.md mit keinem Wort, waehrend dessen Kopfzeile "E55 bis E74" sagte.
echo "── Gebaute E-Nummern ohne Eintrag im Register (tools/e-register-deckung.py) ──"
if ! register_ausgabe=$(python3 tools/e-register-deckung.py 2>&1); then
  echo "$register_ausgabe" | grep -E "FEHLT|WARNUNG"
  luecken=$((luecken + 1))
fi

# Die Schwester dazu (AUDIT-26 §6 Rang 1, gebaut 29.08.2026): E-Nummern
# entstehen in Commits, AUDIT-RAENGE in den Kritiker-Berichten — und neun
# Tage lang kam keiner davon je im Backlog an. Jede Rangzeile ab 21.08.
# braucht dort die Marke `AUDIT-<datum> Rang <n>:`; ein frischer Audit-Lauf
# wird hier rot, bis seine Raenge gebucht sind.
echo "── Audit-Raenge ohne Backlog-Buchung (tools/audit-raenge-gebucht.py) ──"
if ! raenge_ausgabe=$(python3 tools/audit-raenge-gebucht.py --pruefen 2>&1); then
  echo "$raenge_ausgabe" | head -20
  luecken=$((luecken + 1))
fi

# `doku-pfade-pruefen.py` stellt als einzige Wache die Gegenfrage — gibt es
# noch, worauf die Doku zeigt? —, aber sie fragt sie nur fuer den PFAD und
# schneidet den Doppelpunkt dahinter ab. 201 Verweise der Form `pfad:zeile`
# stehen in den Handbuechern und im Wissenspaket, viele als EINZIGER Beleg
# einer Behauptung. Wandert der Code, bleibt der Dateiname richtig und die
# Zeile zeigt woandershin — und alle fuenfzehn Wachen davor melden gruen.
echo "── Zitierte Zeilen (tools/doku-zeilenzitate-pruefen.py) ──"
if ! zeilen_ausgabe=$(python3 tools/doku-zeilenzitate-pruefen.py 2>&1); then
  echo "$zeilen_ausgabe" | grep -E "ZEILE GIBT ES|WARNUNG"
  luecken=$((luecken + 1))
fi

# Alle sechzehn Wachen davor fragen, ob etwas EXISTIERT. Ein stillgelegtes Repo
# besteht jede davon — der Ordner liegt ja noch auf der Platte. Keine fragte, ob
# die Doku den Leser DORTHIN SCHICKT. Gemessen: mixpibox.md erklaerte
# `~/Downloads/llmwiki_mupibox` in Zeile 70 fuer stillgelegt und wies in Zeile
# 77 an, Aenderungen gehoerten dorthin.
echo "── Anweisungen in stillgelegte Repos (tools/stillgelegte-orte-pruefen.py) ──"
if ! stillgelegt_ausgabe=$(python3 tools/stillgelegte-orte-pruefen.py 2>&1); then
  echo "$stillgelegt_ausgabe" | grep -E "ANWEISUNG INS TOTE REPO|WARNUNG"
  luecken=$((luecken + 1))
fi

# `api-doku-deckung.sh` haelt 200 Routen gegen vier Handbuecher und liest dabei
# nur den PFAD — ihr grep-Muster beginnt hinter dem Anfuehrungszeichen, das Verb
# steht davor. Die siebzehn Wachen darueber fragen nach Existenz; keine fragt,
# ob die Doku den Endpunkt richtig AUFRUFT. Ein falsches Verb antwortet mit 404,
# also genauso wie ein Pfad, den es nicht gibt. Gemessen: das Wissenspaket wies
# `PUT /api/konfiguration` an, der Kern kennt dort GET und POST.
echo "── Verben zitierter Endpunkte (tools/endpunkt-verben-pruefen.py) ──"
if ! verben_ausgabe=$(python3 tools/endpunkt-verben-pruefen.py 2>&1); then
  echo "$verben_ausgabe" | grep -E "FALSCHES VERB|Der Kern kennt|WARNUNG"
  luecken=$((luecken + 1))
fi

# ── UND JETZT DIE ZAHL UEBER DEM LAEUFER SELBST ──────────────────────────
#
# Die achtzehn Wachen darueber pruefen NAMEN: Pfade, Zeilen, Endpunkte, Verben,
# Units, Vokabular. Keine prueft eine ZAHL — und eine Zahl ist der Satzteil, den
# niemand nachrechnet. Abschnitt 7.1 sagte seit der ersten Fassung „17 Schritte";
# gemessen waren es 73 unbedingte plus 6 am Geraet. Um 62 daneben, direkt ueber
# dem Aufrufblock, den jeder liest, der das Projekt zum ersten Mal baut.
# Die Wachen darueber pruefen, was die Doku SAGT. Keine prueft den Einstieg,
# den die README als DEN Entwicklungsweg nennt: die npm-Skripte der Wurzel.
# Gemessen am 25.08.2026 stand keines der zwanzig in einem Handbuch, und eines
# davon (`test:frontend-api`) rief einen Arbeitsbereich, den es nicht gibt —
# gefunden am 03.08., nochmal am 23.08., beide Male nur in einer Audit-Liste.
echo "── Skripte der Wurzel (tools/npm-skripte-deckung.py) ──"
if ! npm_skripte_ausgabe=$(python3 tools/npm-skripte-deckung.py 2>&1); then
  echo "$npm_skripte_ausgabe" | grep -E "TOTES SKRIPT|FEHLT in|WARNUNG"
  luecken=$((luecken + 1))
fi

# Die Umgebung war die letzte grosse Flaeche, die keine Wache hatte: elf
# Doku-Wachen hielten Endpunkte, Rechte, Dienste und Ablagen gegen die
# Handbuecher, aber die 64 Stellschrauben aus `src/` und `scripts/` standen zu
# dritt in der Doku. Darunter der Riegel, ohne den die Standwache die Box
# wirklich herunterfaehrt.
echo "── Umgebungsvariablen (tools/umgebungsvariablen-deckung.py) ──"
if ! umgebung_ausgabe=$(python3 tools/umgebungsvariablen-deckung.py 2>&1); then
  echo "$umgebung_ausgabe" | grep -E "FEHLT in|WARNUNG"
  luecken=$((luecken + 1))
fi

# Die Routen der VERWALTUNG haelt diese Probe seit dem 22.08.2026 (oben,
# `ROUTEN=…frontend-admin…`). Die Box hat eine ZWEITE Routentabelle, und die
# hing in keiner Wache: 15 der 16 Wege standen am 25.08.2026 mit null Treffern
# in dokumentation/mixpibox.md. Die Wache prueft zusaetzlich die ZUORDNUNG —
# welche Wege hinter der Kindersicherung liegen —, weil genau die altert:
# `/klang` kam am 21.08. dazu, und der Kommentar daneben sprach noch vier Tage
# lang von „fuenf Routen".
# HIER STAND „Seiten der Box-Oberflaeche" (tools/box-seiten-deckung.py):
# sie hielt die 16 Routen der ALTEN Angular-App gegen die Doku. Mit E118/1e
# ist die Routentabelle gefallen — die neue Oberflaeche ist EINE Seite; was
# ihre Doku-Deckung angeht, prueft der Absatz darunter weiter.

# Die Wache darueber haelt die 16 Wege der KLASSISCHEN Box-Oberflaeche. Die
# NEUE hat keine Routentabelle — sie ist eine Seite, und was man sieht,
# entscheidet ein `hidden`. Eine Wache, die nach `path:` sucht, findet dort
# nichts und schweigt: `Mini-Player`, `grosser Player` und `Cover-Vollbild`
# standen am 30.08.2026 mit null Treffern in dokumentation/mixpibox.md. Dass
# genau diese Achse teuer ist, steht im Baum — drei Orte mit je eigenen
# Zuweisungen liessen am 03.08. den vorigen Titel im Vollbild stehen. Seither
# verdrahtet sich ein Ort selbst (`anzeigeOrte()` liest sie aus dem Baum), und
# genau deshalb faellt es niemandem auf, wenn er in der Doku fehlt.
echo "── Anzeigeorte der neuen Oberflaeche (tools/anzeigeorte-deckung.py) ──"
if ! anzeigeorte_ausgabe=$(python3 tools/anzeigeorte-deckung.py 2>&1); then
  echo "$anzeigeorte_ausgabe" | grep -E "FEHLT in|GENANNT|ZWEIMAL|WARNUNG"
  luecken=$((luecken + 1))
fi

# Die FELDER-Pruefung ganz oben haelt die Liste der VERWALTUNG gegen Doku und
# Paket und meldet gruen. Die Datei, die auf der Box liegt, ist aber die
# VORLAGE — 95 Schluessel, und `FELDER` ist nur der Teil davon, der eine Maske
# hat. Fuenfzehn Schluessel standen am 25.08.2026 in keinem der vier
# Handbuecher, darunter alle vier GPIO-Leitungen (`shim.triggerPin`,
# `shim.cutPin`, `shim.ledPin`, `fan.fan_gpio`). Die NUMMERN standen in 4.1
# sehr wohl da — nur als feste Tatsache, ohne den Hebel, der sie aendert.
echo "── Schluessel der Konfigurationsvorlage (tools/konfig-vorlage-deckung.py) ──"
if ! vorlage_ausgabe=$(python3 tools/konfig-vorlage-deckung.py 2>&1); then
  echo "$vorlage_ausgabe" | grep -E "FEHLT ueberall|WARNUNG"
  luecken=$((luecken + 1))
fi

echo "── Schrittzahl der Leitplanke (tools/leitplanken-zahl-pruefen.py) ──"
if ! leitplanke_ausgabe=$(python3 tools/leitplanken-zahl-pruefen.py 2>&1); then
  echo "$leitplanke_ausgabe" | grep -E "FEHLT|gemessen|WARNUNG"
  luecken=$((luecken + 1))
fi

# WARUM EINE ANNAHME IN DIE DOKU-PROBE GEHOERT: der Herkunftsriegel zaehlt in
# herkunft.ts auf, was er NICHT kann, und Punkt 3 davon ist keine Grenze,
# sondern eine Messung mit Datum („am 07.08.2026 nachgesehen: kein `ws`").
# Am 22.08. kam mit E75 ein `ws` dazu; der Satz stand am 25.08. unveraendert
# da. Ein datiertes Nachgesehen ist eine Aussage ueber den Stand und verfaellt
# wie jede andere (llmwiki: `wiki-zustand-hat-haltbarkeit`) — nur steht diese
# ueber einem Sicherheitsriegel.
echo "── Annahme des Herkunftsriegels (tools/herkunft-annahme-probe.py) ──"
if ! herkunft_ausgabe=$(python3 tools/herkunft-annahme-probe.py 2>&1); then
  echo "$herkunft_ausgabe" | grep -E "ANGEBOTEN|NEUER DRAHT|EINTRAG OHNE DRAHT|FEHLER"
  luecken=$((luecken + 1))
fi

# ── WELCHE BOX EIN WERKZEUG ANFASST ────────────────────────────────────────
# `umgebungsvariablen-deckung.py` laesst `tools/` ganz draussen ("Attrappen-
# schalter steuern eine Vorrichtung, nicht die Box"). Fuer die Namen, die einem
# Werkzeug die ADRESSE sagen, stimmt das nicht — die richten es auf ein echtes
# Geraet. Diese Wache haelt sie gegen die Handbuecher und, in der Gegenrichtung,
# die Ausnahmeliste des Handbuchs gegen den Baum.
echo "── Welche Box ein Werkzeug anfasst (tools/box-adresse-deckung.py) ──"
if ! adresse_ausgabe=$(python3 tools/box-adresse-deckung.py 2>&1); then
  echo "$adresse_ausgabe" | grep -E "FEHLT in der Doku|AUSNAHME STIMMT NICHT|von aussen gelesen|FEHLER"
  luecken=$((luecken + 1))
fi

# ── WAS EIN `push` WIRKLICH AUSLOEST ───────────────────────────────────────
# Von den Wachen hier las bis zum 26.08.2026 keine `.github/workflows/ci.yml`,
# und die Woerter „CI"/„GitHub Actions" standen in keinem Handbuch. Abschnitt
# 7.3 zaehlt 197 Testdateien auf und liest sich wie eine Deckung; was davon
# DURCHGESETZT wird, war nirgends nachlesbar. In dem Loch sassen die 14
# Testdateien der Plugins — 367 Tests, gruen, in keinem Laeufer.
echo "── Was ein push wirklich ausloest (tools/ci-deckung.py) ──"
if ! ci_ausgabe=$(python3 tools/ci-deckung.py 2>&1); then
  echo "$ci_ausgabe" | grep -E "steht in keinem Handbuch|steht nicht in Abschnitt|zu — |weder CI noch|FEHLER"
  luecken=$((luecken + 1))
fi

# ── DIE BAUANLEITUNG DES ABBILDS ───────────────────────────────────────────
# `npm-skripte-deckung.py` prueft jeden Eingabe-Pfad jedes Skripts — aber
# `docker build -t mupibox .` nennt keinen Pfad mit Endung. Der tote Pfad liegt
# eine Datei weiter, in der `Dockerfile`, und die las bis zum 26.08.2026 keine
# der 31 Wachen. Dort kopieren zwei Zeilen seit dem 23.10.2024 aus Orten, die
# der Arbeitsbereichs-Umbau geraeumt hat: der Bau bricht am `cp` ab.
echo "── Quellen der Dockerfile (tools/abbild-pfade-pruefen.py) ──"
if ! abbild_ausgabe=$(python3 tools/abbild-pfade-pruefen.py 2>&1); then
  echo "$abbild_ausgabe" | grep -E "TOTE QUELLE|NICHT IM ABBILD|BACKLOG VERALTET|FEHLER"
  luecken=$((luecken + 1))
fi

# ── DIE ANALYSE-TEXTE DER WURZEL ───────────────────────────────────────────
# `doku-widerruf-probe.sh` liest FUENF Handbuecher. Die neun Analyse-MDs der
# Wurzel (AUDIT-*, MODERNIZATION, KONZEPT-SIGNAL, …) las bis zum 26.08.2026
# keine der 32 Wachen. Der Fall: AUDIT-2026-08-23 §6.3 und BACKLOG A4 erklaerten
# MODERNIZATION.md fuer ueberholt — das Urteil stand drei Tage in der PRUEFENDEN
# Datei und nie in der GEPRUEFTEN, inklusive „no CI", waehrend die CI lief.
echo "── Stand der Analyse-Texte (tools/analyse-md-stand-pruefen.py) ──"
if ! stand_ausgabe=$(python3 tools/analyse-md-stand-pruefen.py 2>&1); then
  echo "$stand_ausgabe" | grep -E "OHNE STAND|URTEIL OHNE FOLGE|FEHLER"
  luecken=$((luecken + 1))
fi

# ── DAS SIMULATIONSREZEPT ──────────────────────────────────────────────────
# Die SECHSTE Sorte Datei nach der Bauanleitung (24.08.) und der Momentaufnahme
# (26.08.): `harness/` sagt, wie der ganze Stapel auf der Entwicklungsmaschine
# faehrt — der Tier-A-Weg aus MODERNIZATION.md §5, den ein Neuzugang als ERSTES
# geht. Keine der 33 Wachen las ihn. Zwei `./state/`-Mounts legte `seed_state()`
# nicht an (Docker macht daraus ein VERZEICHNIS am Ort der config.json), und der
# Dienst `admin` haengt den mit E47 ausgebauten PHP-Baum ein.
echo "── Rezept der Tier-A-Simulation (tools/simulationsrezept-pruefen.py) ──"
if ! rezept_ausgabe=$(python3 tools/simulationsrezept-pruefen.py 2>&1); then
  echo "$rezept_ausgabe" | grep -E "FEHLT|FEHLER"
  luecken=$((luecken + 1))
fi

# Das Entwickler-Abbild ist die SIEBTE Sorte Datei, die keine Wache las
# (27.08.2026). `abbild-pfade-pruefen.py` haelt ausdruecklich die WURZEL-
# Dockerfile fest; im ganzen tools/-Verzeichnis nannte kein Werkzeug das Wort
# `devcontainer`. Sie misst nach, was BACKLOG.md A4b seit dem 26.08. als
# „nicht nachgemessen" fuehrt: PHP-Feature und PHP-Erweiterung fuer einen Baum
# mit null .php-Dateien.
echo "── Bauanleitung des Codespace (tools/entwicklerabbild-pruefen.py) ──"
if ! codespace_ausgabe=$(python3 tools/entwicklerabbild-pruefen.py 2>&1); then
  echo "$codespace_ausgabe" | grep -E "TOTE QUELLE|UEBERFLUESSIG|BACKLOG VERALTET|FEHLER"
  luecken=$((luecken + 1))
fi

# ── ACHTE SORTE DATEI, 27.08.2026 ──────────────────────────────────────────
# Die MITGELIEFERTE FREMDDATEI. Alle 34 Wachen davor fragen „nennt die Doku,
# was im Baum steht?" fuer TEXT — Wege, Zeilen, Endpunkte, Units, Vokabular,
# Schluessel. Eine Binaerdatei hat keinen Bezeichner, den man greppen kann,
# und faellt darum durch jede dieser Fragen hindurch. Gemessen: seit dem
# 31.07.2026 liegen vier Schriften unter `NewDesign/schriften/` — 135 kB, auf
# jeder Box, in jedem Buchstaben der neuen Oberflaeche — ohne eine Zeile
# darueber, woher sie kommen; waehrend zehn Themenordner ihre Quelle seit
# jeher sauber danebenlegen.
echo "── Herkunft mitgelieferter Schriften (tools/schrift-herkunft-pruefen.py) ──"
if ! schrift_ausgabe=$(python3 tools/schrift-herkunft-pruefen.py 2>&1); then
  echo "$schrift_ausgabe" | grep -E "OHNE QUELLE|WARNUNG"
  luecken=$((luecken + 1))
fi

# ZITIERTE SCHALTER (27.08.2026). Die Wachen darueber decken den AUFRUF von
# mehreren Seiten ab — Existenz der Datei, Pfad und Verb einer Route, Skripte
# der Wurzel. Keine liest, was HINTER dem Dateinamen steht. Die Doku tippt aber
# ganze Befehlszeilen ab, und ein Schalter, den es nicht mehr gibt, faellt
# still: ein Werkzeug, das seine Argumente per `"--x" in argv` liest, ignoriert
# ihn und tut stattdessen seine Standardsache.
echo "── Zitierte Schalter (tools/zitierte-schalter-pruefen.py) ──"
if ! schalter_ausgabe=$(python3 tools/zitierte-schalter-pruefen.py 2>&1); then
  echo "$schalter_ausgabe" | grep -E "TOTER SCHALTER|kennt ihn nicht|WARNUNG"
  luecken=$((luecken + 1))
fi

# WIKI-VERWEISE AUSSERHALB DES PAKETS (27.08.2026). `tools/pack-verweise.py`
# prueft Verweise INNERHALB von pack.yaml — es gibt es, weil Dateinamen aus
# dem privaten Gedaechtnisordner als Wiki-Kennungen geschrieben wurden.
# Dieselbe Schreibweise steht in 288 Quelltextkommentaren, Tests und
# Handbuechern, und dort hat sie nie jemand nachgeschlagen: 19 zeigten ins
# Leere, sechs davon woertliche Gedaechtnis-Dateinamen.
echo "── Wiki-Verweise im Code (tools/wiki-verweise-im-code-pruefen.py) ──"
if ! verweis_ausgabe=$(python3 tools/wiki-verweise-im-code-pruefen.py 2>&1); then
  echo "$verweis_ausgabe" | grep -E "TOTER VERWEIS|WARNUNG"
  luecken=$((luecken + 1))
fi

# AUSGEROLLTE VORLAGEN (27.08.2026): die Gegenrichtung zu
# `doku-pfade-pruefen.py`. Die prueft DOKU → BAUM; eine Vorlage, die niemand
# erwaehnt, faellt dort nicht auf, sondern verbessert die Trefferquote sogar.
# `81-bluez-nur-a2dp.conf` nimmt Bluetooth-Geraeten das Mikrofon weg — und
# stand in keiner Prosa, waehrend ihre drei Schwestern desselben Blocks alle
# dokumentiert sind. NACHTRAG 27.08.2026 (spaeterer Lauf): die Wache kannte
# damals nur zwei Ausrollwege; es sind drei. Sie liest jetzt auch die
# Installer-Rezepte und meldet nebenbei, welche Vorlagen eine heute frisch
# aufgesetzte Box NICHT bekommt.
echo "── Ausgerollte Vorlagen (tools/ausgerollte-vorlagen-deckung.py) ──"
if ! vorlagen_ausgabe=$(python3 tools/ausgerollte-vorlagen-deckung.py 2>&1); then
  echo "$vorlagen_ausgabe" | grep -vE "^KEINE LUECKE|^$"
  luecken=$((luecken + 1))
fi

# AUSGEROLLTE EINGRIFFE (27.08.2026): dieselbe Frage eine Datei-SORTE weiter.
# Ein Ausrollweg legt nicht nur ab, er aendert fremde Dateien an Ort und
# Stelle (`sed -i`, `tee -a`, `>>`). Eine Vorlage hat einen eigenen Namen, ein
# Eingriff hat nur ein Ziel — in einer Tabelle ueber Vorlagen kann er gar
# nicht vorkommen. Elf Eingriffe standen in keiner Prosa, darunter
# `--noplugin=sap` in einer Datei, die dem Paket `bluez` gehoert.
echo "── Ausgerollte Eingriffe (tools/ausgerollte-eingriffe-deckung.py) ──"
if ! eingriffe_ausgabe=$(python3 tools/ausgerollte-eingriffe-deckung.py 2>&1); then
  echo "$eingriffe_ausgabe" | grep -vE "^KEINE LUECKE|^$"
  luecken=$((luecken + 1))
fi

# ARBEITSBEREICHS-ABHAENGIGKEITEN (29.08.2026): wieder eine neue Datei-SORTE —
# der `package.json` eines Arbeitsbereichs. `src/frontend-admin` deklarierte
# bis zum 25.09.2026 NULL Abhaengigkeiten und lief trotzdem, weil npm alles in
# die Wurzel hebt; eine Inventur ueber `package.json` mass dort eine leere
# Menge und meldete gruen. Aufgefallen ist es erst, als `390880f5` bei der Schwester aufraeumte
# und das `ng test` der VERWALTUNG stehenblieb. Die Wache fragt auch die zwei
# Benutzungen ab, die in keiner Zeile Quelltext stehen: was der Bauer aus
# `angular.json` voraussetzt und was ein npm-Skript aufruft.
echo "── Geliehene Abhaengigkeiten (tools/arbeitsbereich-abhaengigkeiten-deckung.py) ──"
if ! leihe_ausgabe=$(python3 tools/arbeitsbereich-abhaengigkeiten-deckung.py 2>&1); then
  echo "$leihe_ausgabe" | grep -vE "^KEINE LUECKE|^  VERMERKT|^$"
  luecken=$((luecken + 1))
fi

# ZITIERTE PAKETSTAENDE (30.08.2026): `doku-pfade-pruefen.py` sieht in
# "`package.json` `^4.17.1`" nur den Dateinamen und sagt: gibt es. Die ZAHL
# daneben liest niemand. Ein `npm update` laesst die Datei am Platz und macht
# den Satz still falsch — und das ist genau der Satz, aus dem eine spaetere
# Sitzung schliesst, ob der Express-Sprung noch aussteht. Nur Pin-Form (`^`,
# `~`); eine nackte Zahl ist meist eine Aussage ueber den Upstream.
echo "── Zitierte Paketstaende (tools/paketstand-zitate-pruefen.py) ──"
if ! paketstand_ausgabe=$(python3 tools/paketstand-zitate-pruefen.py 2>&1); then
  echo "$paketstand_ausgabe" | grep -E "VERALTETER PIN|WARNUNG"
  luecken=$((luecken + 1))
fi

# Alle Wachen davor fragen, ob etwas EXISTIERT. Ein verworfener Weg besteht das
# muehelos — die Anleitung liegt ja da, ihre Pfade stimmen, ihre Befehle laufen.
# Was keine fragte: ob die Datei dem Leser sagt, dass sie nicht mehr gilt.
echo "── Verworfene Wege ohne Riegel im Kopf (tools/verworfene-wege-markiert.py) ──"
if ! verworfen_ausgabe=$(python3 tools/verworfene-wege-markiert.py 2>&1); then
  echo "$verworfen_ausgabe" | grep -E "VERWORFEN, ABER UNMARKIERT|fehlt:|WARNUNG"
  luecken=$((luecken + 1))
fi

# Alle Wachen davor messen die Doku gegen den Code — sie schauen nach AUSSEN.
# Was ein Werkzeug ueber SICH SELBST behauptet, gilt in keiner davon als Doku:
# die „Aufruf:"-Zeile im eigenen Kopf ist die einzige Anleitung, die ein Leser
# garantiert sieht, und beim Umbenennen wandert nur die Datei mit, nicht der
# Name in der Zeile.
echo "── Der eigene Name in der eigenen Aufrufzeile (tools/aufrufzeile-eigenname-pruefen.py) ──"
if ! aufrufzeile_ausgabe=$(python3 tools/aufrufzeile-eigenname-pruefen.py 2>&1); then
  echo "$aufrufzeile_ausgabe" | grep -E "FREMDER NAME IM EIGENEN AUFRUF|Zeile nennt:|im Baum gibt es nicht|WARNUNG"
  luecken=$((luecken + 1))
fi

# Was einen Commit aufhalten darf, muss das Wiki erklaeren. Bei den vier
# Ratschen ist rot kein "kaputt", sondern "mehr als eingefroren" — wer das
# Ritual nicht kennt, friert blind neu ein oder dreht die richtige Aenderung
# zurueck. Neun der 78 Gatter standen am 30.08.2026 in keinem Pack-Eintrag.
echo "── Gatter der Pflichtstrecken im Pack (tools/gatter-im-pack-deckung.py) ──"
if ! gatter_ausgabe=$(python3 tools/gatter-im-pack-deckung.py --pruefen 2>&1); then
  echo "$gatter_ausgabe" | grep -E "BEFUND|FEHLER|WARNUNG|^  tools/"
  luecken=$((luecken + 1))
fi

# Ein Port, auf dem die Box horcht, ist Aussenflaeche. Wer absichert, eine
# Firewall-Regel schreibt oder eine Anmeldung debuggt, liest die Doku — und
# findet dort nur, was jemand aufgeschrieben hat. Port 5588 (Spotify-Rueckweg,
# nur 127.0.0.1, nur waehrend eines Anlaufs) stand am 30.08.2026 seit dem Bau
# in KEINER Zeile Doku. Die Wache sucht `.listen(` im Backend, nicht die Zahl.
echo "── Horchende Ports ohne Doku (tools/horchende-ports-deckung.py) ──"
if ! ports_ausgabe=$(python3 tools/horchende-ports-deckung.py 2>&1); then
  echo "$ports_ausgabe" | grep -E "^  Port|FEHLER"
  luecken=$((luecken + 1))
fi

# Eine systemd-Ergaenzung (`UNIT.d/x.conf`) faellt zwischen die beiden
# Schwesterwachen: keine Vorlage (keine Datei im Baum), kein Eingriff (sie legt
# ihre EIGENE Datei an) — und wirksamer als beide, weil sie das Verhalten einer
# dokumentierten Unit aendert, ohne deren Datei anzufassen.
# `mupi_hat.service.d/nur-wenn-da.conf` entscheidet allein, ob die Akkuanzeige
# ueberhaupt anlaeuft, und stand am 30.08.2026 in null Zeilen Prosa.
echo "── Ergaenzungen an fremden Units (tools/ergaenzungen-deckung.py) ──"
if ! ergaenzungen_ausgabe=$(python3 tools/ergaenzungen-deckung.py 2>&1); then
  echo "$ergaenzungen_ausgabe" | grep -E "^  \*|^      geschrieben|WARNUNG|FEHLER"
  luecken=$((luecken + 1))
fi

# Die feste Tabelle in `protokolle.ts` sagt, WELCHE Protokolle die Verwaltung
# zum Lesen anbietet — sie wird einmal ausgedacht und danach nie wieder gegen
# den Baum gehalten. Am 30.08.2026 zeigten zwei von drei Eintraegen auf
# /var/log/mupibox/, geschrieben wird an beiden Stellen nach /tmp: die Seite
# antwortete dauerhaft „Protokoll nicht lesbar". Der bestehende Test prueft
# `!pfad.includes('.pm2')` — das Symptom des VORIGEN Falls.
echo "── Protokollpfade ohne Schreiber (tools/protokoll-pfade-deckung.py) ──"
if ! protokollpfade_ausgabe=$(python3 tools/protokoll-pfade-deckung.py 2>&1); then
  echo "$protokollpfade_ausgabe" | grep -E "^  OHNE|^      der Dateiname|^  AUSNAHME|WARNUNG|FEHLER"
  luecken=$((luecken + 1))
fi

# `angular.json` kopiert NewDesign/ mit `**/*` nach neu/ — ALLES, ausser was
# von Hand in der ignore-Liste daneben steht. Eine Liste, die beim Anlegen
# einer Datei gepflegt werden muss, wird nicht gepflegt. Am 30.08.2026 lagen
# eine Messseite und zwei LIESMICH-Dateien im gebauten Buendel; die Messseite
# behauptete im eigenen Kopf das Gegenteil.
echo "── Werkstatt im Buendel (tools/newdesign-mitlieferung-deckung.py) ──"
if ! mitlieferung_ausgabe=$(python3 tools/newdesign-mitlieferung-deckung.py 2>&1); then
  echo "$mitlieferung_ausgabe" | grep -E "^  GEHT MIT|^      |WARNUNG|FEHLER"
  luecken=$((luecken + 1))
fi

# DER WEG ZUM SCHALTER, NICHT NUR SEIN NAME (30.08.2026). Die Beschriftungs-
# Wache oben fragt, ob es den zitierten Knopf gibt und ob er auf der genannten
# OBERFLAECHE sitzt. Ob er unter dem genannten REITER sitzt, fragte keine — und
# genau das ist am 30.08. verrutscht: „Wellen im Player" wanderte von Verhalten
# nach Optik -> Mini-Player, beide Doku-Dateien zeigten weiter auf Verhalten.
# Der Betreiber hatte den Schalter im alten Reiter selbst nicht gefunden; der
# Leser der Doku suchte danach an derselben leeren Stelle.
echo "── Wege zu den Schaltern der Darstellung (tools/darstellungs-pfade-pruefen.py) ──"
if ! darstellungspfad_ausgabe=$(python3 tools/darstellungs-pfade-pruefen.py 2>&1); then
  echo "$darstellungspfad_ausgabe"
  luecken=$((luecken + 1))
fi

# DER NAME HINTER DEM PFAD (31.08.2026). Alle Wachen darueber pruefen Namen,
# die es GIBT: Pfade, Zeilen, Endpunkte, Verben, Units, Schalter. Keine fragte,
# ob ein zitierter FUNKTIONSNAME noch existiert — und ein Rueckbau loescht
# genau den, waehrend Datei und Zeile stehenbleiben. E95/V Stufe 3 nahm
# `abspielBefehl` aus NewDesign/app.js (Nachfolger: `startPlan` in
# spielfunktion.ts); danach schickten neun Kommentare im Server-Quelltext den
# Leser weiter dorthin, darunter die Architektursaetze in verschmelzung.ts und
# lane-weiter.ts. Diese Probe war gruen, pruefen.sh auch.
echo "── Zitate auf geloeschte UI-Funktionen (tools/ui-namen-zitate-pruefen.py) ──"
if ! uinamen_ausgabe=$(python3 tools/ui-namen-zitate-pruefen.py 2>&1); then
  echo "$uinamen_ausgabe"
  luecken=$((luecken + 1))
fi

# Der Arbeitsablauf steht in CLAUDE.md UND im Wissenspaket — beide werden
# gebraucht (die eine Datei wirkt von selbst, der Eintrag ist durchsuchbar).
# Zwei Orte, eine Regel: ohne Wache quer dazu laufen sie auseinander, und die
# naechste Sitzung liest einen Ablauf, den das Paket nicht kennt.
echo "── Arbeitsablauf in CLAUDE.md und im Pack (tools/arbeitsablauf-deckung.py) ──"
if ! ablauf_ausgabe=$(python3 tools/arbeitsablauf-deckung.py 2>&1); then
  echo "$ablauf_ausgabe"
  luecken=$((luecken + 1))
fi

# Zwei Netz-Wachen mit Rueckweg-Beweis (E131): dhcp-schneller darf die Box
# nicht vom Netz nehmen, der ifup-Riegel darf nie die letzte Verbindung
# sperren. Beide Tests fahren ihre Sicherheitsregel wirklich (Attrappen in
# Wegwerfordnern, kein Geraet noetig) — und beide hingen bis 06.09.2026 in
# keinem Laeufer (die bekannte Falle der ungerufenen Wachen).
echo "── dhcp-schneller: Rueckweg bewiesen (tools/dhcp-schneller.test.sh) ──"
if ! dhcptest_ausgabe=$(bash tools/dhcp-schneller.test.sh 2>&1); then
  echo "$dhcptest_ausgabe"
  luecken=$((luecken + 1))
fi

echo "── ifup-Riegel: Sicherheitsregel bewiesen (tools/mixpi-wlan-riegel.test.sh) ──"
if ! riegeltest_ausgabe=$(bash tools/mixpi-wlan-riegel.test.sh 2>&1); then
  echo "$riegeltest_ausgabe"
  luecken=$((luecken + 1))
fi

# Die RETTUNG des Adapter-Dienstes laesst sich an der Box nicht gefahrlos
# ausloesen (man muesste die tragende Verbindung kaputtmachen — genau der
# Fall, in dem ein Fehler die Box aussperrt). Deshalb steht sie hier.
echo "── Adapter-Rettung mit Attrappen (tools/mixpi-wlan-adapter.test.sh) ──"
if ! adaptertest_ausgabe=$(bash tools/mixpi-wlan-adapter.test.sh 2>&1); then
  echo "$adaptertest_ausgabe"
  luecken=$((luecken + 1))
fi

# Die Geraeteprofile (config/fernbedienungen/) gegen ihre SVG-Schemata: jede
# Taste im Bild muss im Profil stehen und umgekehrt — zwei Wahrheiten ueber
# dieselbe Fernbedienung. Der Kritiker-Lauf vom 07.09.2026 fand die Wache
# UNGERUFEN (Punkt 3, llmwiki feature-abend-endet-am-geraet-nicht-am-
# ausrollweg); ihre Schwester cover-platzhalter-probe.py braucht eine
# laufende Box und haengt darum in tools/pruefen.sh --box.
echo "── Fernbedienungs-Schemata gegen die Profile (tools/fernbedienung-bild-deckung.py) ──"
if ! fbbild_ausgabe=$(python3 tools/fernbedienung-bild-deckung.py 2>&1); then
  echo "$fbbild_ausgabe"
  luecken=$((luecken + 1))
fi

# Namen, die sich selbst totlegen (20.09.2026). Ein zweites `const args` im
# selben Block hat den Aufnahmeweg des Mitschnitt-Plugins zehn Tage lang bei
# JEDEM Titel sofort abbrechen lassen — gefangen vom `catch` darum, gemeldet
# als Aufnahmefehler. Kein Zeuge konnte das treffen: die Stelle liegt hinter
# spawn, PipeWire und Spotify. Die SORTE dagegen sieht ein Parser sofort.
echo "── Namen vor ihrer eigenen Deklaration (tools/tdz-schatten-schau.mjs) ──"
if ! tdz_ausgabe=$(node tools/tdz-schatten-schau.mjs 2>&1); then
  echo "$tdz_ausgabe"
  luecken=$((luecken + 1))
fi

# Die Veroeffentlichung nach GitHub (23.09.2026). Zwei Dinge haengen hier, weil
# beide still falsch sein koennen: die MUSTERLOGIK der Ausschlussliste (ein zu
# weites Muster laesst etwas Wichtiges weg, ein zu enges schleppt 130 MB
# Rohrender mit) und die WACHE des Trockenlaufs, die prueft, dass jede Quelle,
# die Rezepte und autosetup aus dem Repo holen, im veroeffentlichten Stand auch
# liegt. Faellt sie, waere die naechste Karte eines Fremden halb installiert —
# und gemeldet wuerde das nur als eine Zeile „diese Schritte laufen ins Leere".
echo "── Muster der GitHub-Ausschlussliste (tools/github-veroeffentlichen.py --selbsttest) ──"
if ! ghmuster_ausgabe=$(python3 tools/github-veroeffentlichen.py --selbsttest 2>&1); then
  echo "$ghmuster_ausgabe"
  luecken=$((luecken + 1))
fi

# Zwei README-Fassungen seit dem 23.09.2026 (deutsch massgeblich, englisch
# uebersetzt). Was man nachrechnen kann — Zahlen, Pfade, Befehle, Bilder —
# muss in beiden gleich sein; die Prosa darf abweichen.
echo "── README.md und README.en.md deckungsgleich (tools/readme-paritaet-pruefen.py) ──"
if ! paritaet_ausgabe=$(python3 tools/readme-paritaet-pruefen.py 2>&1); then
  echo "$paritaet_ausgabe"
  luecken=$((luecken + 1))
fi

echo "── Veroeffentlichter Stand traegt die Installation (tools/github-veroeffentlichen.py) ──"
if ! ghstand_ausgabe=$(python3 tools/github-veroeffentlichen.py 2>&1); then
  echo "$ghstand_ausgabe" | tail -6
  luecken=$((luecken + 1))
fi

echo
if [ "$luecken" -eq 0 ]; then
  echo "KEINE LUECKE."
  exit 0
fi
echo "$luecken LUECKE(N)."
exit 1
