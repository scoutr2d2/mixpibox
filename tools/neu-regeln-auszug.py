#!/usr/bin/env python3
"""Holt die REINEN Entscheidungsregeln der neuen Oberflaeche in eine pruefbare Datei.

WOZU: NewDesign/app.js ist eine IIFE ohne einen einzigen Export — importierbar
ist daraus nichts, und sie fuer Tests aufzubohren (`window.__TEST__ = {...}`)
hiesse, die Produktionsdatei fuer die Pruefung zu veraendern. Der Ausweg ist
derselbe wie bei tools/zeit-auszug.py: die Funktion wird AUS DER QUELLE
herausgeschnitten und daneben gelegt. Die Pruefung laeuft damit nicht neben der
Quelle her, sondern an ihr.

WELCHE REGELN: die, an denen ein Fehler still bliebe.
  boxnameTeilen       teilt „MixPiBox" in „MixPi" / „Box". Eine falsche Grenze
                      faellt im Bau nicht auf — sie steht nur auf dem Schirm der
                      Box, und dort sieht sie niemand neben dem echten Namen.
  naechsterRueckweg   entscheidet, WELCHE Ebene der eine Rueckweg verlaesst.
                      Eine vertauschte Zeile schliesst etwas, das gerade niemand
                      sieht — und der Bildschirm sieht dabei richtig aus.
  fassungBeschriften  macht aus der Herkunft die Fusszeile. Sie behauptet, WAS
                      auf der Box laeuft; eine falsche Behauptung sieht genauso
                      aus wie eine richtige.
  sperrModus          liest die Einstellungssperre aus der Konfiguration.
                      DIE STILLSTE REGEL DES GANZEN HAUSES: Ihre Vorgabe ist
                      "aus". Faellt sie falsch aus, steht der Eltern-Bereich
                      offen — und das sieht am Bildschirm EXAKT so aus wie eine
                      Sperre, die niemand eingeschaltet hat. Nichts wird rot,
                      niemand meldet etwas.
  torWartenS          wie lange die Bremse nach dem n-ten Fehlversuch wartet.
                      Die ersten beiden Fehlgriffe sind frei (ein Erwachsener
                      vertippt sich), danach steigt es steil und bleibt oben.
                      Faellt der Deckel weg, ist der 20. Fehlversuch wieder
                      frei — und ein Kind muesste nur weit genug zaehlen.
  gesteWartenS        dasselbe fuer die Geste, aber in FOLGEN gerechnet: die
                      ersten GESTE_FREI Beruehrungen sind frei, danach kostet
                      jede weitere volle Folge. Ohne sie ist die Geste fuer ein
                      Kind, das nur die Ecken antippt, in Minuten offen.
  torFertig           entscheidet, ob "Weiter" gedrueckt werden darf. Zu frueh
                      freigegeben heisst: der Knopf verspricht eine Pruefung,
                      die immer nein sagt.
  zifferDazu          haengt eine Ziffer an. Ohne Deckel waechst die Eingabe
                      ueber das, was das Backend annimmt; ein Fehlgriff darf
                      ausserdem nicht loeschen, was schon dasteht.
  btZeile             macht aus einem Bluetooth-Geraet eine Zeile. Der mittlere
                      Zustand ist der ganze Sinn der Seite: "gekoppelt, aber
                      nicht verbunden" ist die Lage, in der die Box stumm
                      bleibt und niemand weiss warum. Er darf nicht aussehen
                      wie "aus".
  weiterMarke         beschriftet die Weiterhoeren-Kachel. Seit dem 06.08.2026
                      mit dem FOLGENNAMEN, wo es einen gibt, und mit "Titel 3"
                      nur noch als Rueckfall. Faellt der Vorrang falsch aus,
                      steht auf der Kachel eine Zahl statt eines Namens - und
                      das sieht auf dem Schirm wie eine Entscheidung aus, nicht
                      wie ein Fehler.
  folgenBildAn        schlaegt das Bild zur laufenden Warteschlangennummer nach.
                      Ein Fehlgriff um eins zeigt das Cover der NACHBARFOLGE:
                      ein Bild, das gut aussieht und nicht zum Ton gehoert.
                      Ausserhalb der Liste muss NICHTS herauskommen, sonst
                      traegt eine fremde Wiedergabe die Bilder von vorhin.
  folgenNameAn        dasselbe fuer den NAMEN (Backlog F1). `currentTrackname`
                      geht bei mpv nie mit; ohne diese Regel stuende das Bild
                      von Folge N unter dem Namen von Folge 1. Ein leerer Name
                      darf NICHT durchkommen — eine leere Titelzeile sieht aus
                      wie „laeuft nichts".
  ichBildPfad         was das Zeichen oben links zeigt. DIE STILLE STELLE IST
                      DER LEERFALL: Der Server sagt bei einem Kind ohne
                      eigenes Bild LEER (`OHNE_FIGUR`), und was dann zu sehen
                      ist, entscheidet allein die Oberflaeche. Faellt die
                      Vorgabe weg, steht dort eine Silhouette — und die sieht
                      am Bildschirm genau so aus wie „das Bild laedt gerade
                      nicht". Zwei verschiedene Lagen, ein Bild: das faellt
                      niemandem auf. Der zweite stille Fehler waere ein Pfad
                      IN den Figurenordner: `bilder/figuren/mixpi-hoert.png`
                      gibt es nicht (llmwiki vorgabewert-ueberlebt-den-umzug-
                      seines-ordners), und eine 404 sieht wieder wie dieselbe
                      Silhouette aus.
  freigabeNochGueltig entscheidet, ob ein gefallenes Tor NOCH gilt — die
                      gemeinsame Freigabe, mit der die klassische Oberflaeche
                      nicht ein zweites Mal fragt (gemeldet am 06.08.2026:
                      "beim eingeben kömmt 2 mal die aufgabe"). Faellt sie zu
                      grosszuegig aus, steht die Tuer laenger offen als
                      abgesprochen, und zwar UNSICHTBAR: am Bildschirm sieht
                      "kein Tor" wegen gueltiger Freigabe genauso aus wie
                      "kein Tor" wegen abgeschalteter Sperre. Faellt sie zu
                      streng aus, kommt die Aufgabe wieder zweimal. Die
                      wortgleiche Zwillingsstelle der klassischen Oberflaeche
                      steht in src/frontend-box/src/app/einstellungssperre/
                      freigabe.ts und hat ihre eigene Pruefung.
  folgeKennung        die Kennung einer mpv-Folge (Backlog F2). Eine HALBE
                      Kennung waere die stillste Sorte Fehler dieser Datei:
                      eine leere Zeichenkette ist gleich jeder anderen leeren,
                      und die Marke „spielt gerade" saesse dann auf einer
                      fremden Kachel. Kommt gar nichts heraus, fehlt die Marke
                      — und das sieht aus wie „es laeuft nichts".

WAS ES AENDERT: schreibt tools/neu-regelnfns-auszug.js. Sonst nichts.

AUFRUF
    python3 tools/neu-regeln-auszug.py
    node tools/pruef-neu-regeln.js        # das, worum es geht
"""
import pathlib
import re

# ZWEI QUELLEN SEIT DEM 03.09.2026: Die Regeln der Schubladen-Apps stehen in
# NewDesign/apps.js, alles andere weiter in app.js. Beide werden gelesen und
# hintereinandergelegt — welche Regel woher kommt, ist fuer den Auszug egal,
# und ein zweiter Auszug mit zweitem Pruefer waere eine Doppelung ohne Gewinn.
QUELLEN = [pathlib.Path('NewDesign/app.js'), pathlib.Path('NewDesign/apps.js')]
QUELLE = QUELLEN[0]
ZIEL = pathlib.Path('tools/neu-regelnfns-auszug.js')
NAMEN = ['boxnameTeilen', 'naechsterRueckweg', 'fassungBeschriften',
         # `memBrettMasse` legt Spalten und Kartengroesse des Memory-Bretts
         # fest (03.09.2026). Sie gehoert hierher, weil ihr Fehler STILL ist:
         # Eine zu grosse Karte laesst die letzte Reihe unter den Rand
         # rutschen — auf 800x480 sieht das Brett dann vollstaendig aus und
         # ist es nicht. Am Schirm faellt das nur auf, wenn man die untere
         # Reihe sucht; gerechnet faellt es sofort auf.
         'memBrettMasse',
         # ── DIE VIER SPIELARTEN DES MEMORY (E139, 09.09.2026) ────────────
         # `memNaechsterDran` traegt die stillste der drei: Zu zweit wechselt
         # es IMMER, auch nach einem Treffer — ausdruecklich NICHT die
         # Turnierregel „wer trifft, ist nochmal dran". Wer sie „berichtigt",
         # baut ein Brett, das genauso richtig aussieht und das Bestellte
         # nicht tut.
         # `memCrazyZeitS` macht die Uhr der Spielart „Verrueckt" je Stufe
         # kuerzer, darf aber nie unter die Grenze, ab der Mischen schneller
         # kaeme als ein Zug samt Zeigezeit — darunter waere das Spiel nicht
         # schwer, sondern unmoeglich, und am Schirm saehe beides gleich aus.
         # `memPaareZahl` haelt die Paarzahl unter dem Deckel der Ansicht und
         # unter dem Vorrat — zu viele Paare hiesse: zwei Karten desselben
         # Bildes aus ZWEI Werken, aufgedeckt richtig und doch kein Paar.
         'memCrazyZeitS', 'memNaechsterDran', 'memPaareZahl',
         # ── DIE AUSSIEBUNG NACH BILDINHALT (E140, 09.09.2026) ────────────
         # `memHashAbstand` und `memHashNeu` entscheiden, ob zwei Cover
         # DASSELBE Bild zeigen — die eine Frage, an der die Adresse
         # vorbeilaeuft (llmwiki rueckfallbild-macht-den-fehler-unsichtbar:
         # 60 von 97 Alben tragen denselben Platzhalter unter je eigener
         # Adresse). Ihr Fehler ist in BEIDE Richtungen still: Ein Abstand,
         # der immer 0 liefert, siebt alles aus und das Spiel sagt „zu wenige
         # Bilder"; einer, der immer gross liefert, siebt nichts aus — dann
         # ist alles wie vorher, und nichts wird rot.
         'memHashAbstand', 'memHashNeu', 'memWortAusDatei',
         # ── DIE SCHUBLADEN-APPS (03.09.2026) ────────────────────────────
         # `puzMischen` ist die STILLSTE Regel der drei: Von den 9!
         # Anordnungen eines 3x3-Schiebepuzzles ist die HAELFTE unloesbar,
         # und ein unloesbares Brett sieht aus wie ein schweres. Nichts wird
         # rot, das Kind schiebt bis zum Aufgeben.
         # `rechenAufgabe` darf nie unter null gehen und die Antwort muss im
         # Zahlenraum bleiben — negative Zahlen sind kein Vorschulstoff.
         'puzNachbarn', 'puzMischen', 'puzGeloest', 'rechenAufgabe',
         # `uhrWort` traegt die stillste Regel der Uhr: „halb 4" ist 3:30 und
         # nicht 4:30. Der Sprung um eine Stunde ist im Deutschen die Regel
         # und im Code ein Fehler, der sich wie ein Tippfehler liest — und am
         # Zifferblatt sieht eine falsche Antwortmoeglichkeit genauso aus wie
         # eine richtige.
         'uhrWort', 'uhrAuswahl',
         'sperrModus', 'torFertig', 'zifferDazu', 'btZeile',
         # `kennungsWort` MUSS hier stehen, seit `folgeKennung` (und die
         # Stueck-/Werk-Kennungen) es aufrufen — sonst faellt der Auszug beim
         # ersten Aufruf mit ReferenceError um. Dasselbe Muster wie bei
         # `boxIpAus` weiter unten; gefunden am 13.09.2026, als genau dieser
         # ReferenceError die ganze Wache stummgelegt hat.
         'weiterMarke', 'folgenBildAn', 'folgenNameAn', 'folgeKennung', 'kennungsWort',
         'ichBildPfad', 'gesteEcke', 'gesteEckeKante', 'gesteSchritt',
         'torWartenS', 'gesteWartenS', 'freigabeNochGueltig',
         # ── DIE DREI NEUEN SCHIRME (06.08.2026) ─────────────────────────
         # `infoFelder` ist die teuerste davon: sechs Kaestchen, und jedes hat
         # einen Leerfall, den man am Schirm nur sieht, wenn man ihn gerade
         # herstellt (kein MuPiHAT, kein Netz, ein stehender Dienst). Genau
         # dort ist am 06.08.2026 schon einmal eine Zeile hinter einem
         # `return` verschwunden und im Leerfall weg gewesen.
         'sperrUnterzeile', 'infoFelder', 'kachelWort', 'kachelWeiter',
         # ── DIE ADRESSE, DIE INS QR-ZEICHEN GEHT (06.08.2026) ────────────
         # `boxIpAus` MUSS hier stehen, seit `infoFelder` sie aufruft — sonst
         # faellt der Auszug beim ersten Aufruf mit ReferenceError um.
         # `spotifyEinrichtAdresse` ist die Regel, die entscheidet, WOHIN ein
         # abfotografiertes Zeichen fuehrt. Ein falscher Port oder eine
         # v6-Adresse in eckigen Klammern ergibt ein Bild, das genauso aussieht
         # wie ein richtiges und auf dem Handy in eine Fehlerseite laeuft — man
         # sieht einem QR-Zeichen nicht an, was darin steht.
         'boxIpAus', 'spotifyEinrichtAdresse',
         # ── DER ZAEHLER HINTER DEM HINWEIS (07.08.2026) ──────────────────
         # `wappenTipp` entscheidet, wann „Zum Öffnen lange gedrückt halten"
         # erscheint. Ein Fehler darin ist DOPPELT still: Kommt der Hinweis nie
         # (Schwelle zu hoch, Fenster zu kurz), steht der Besitzer weiter vor
         # seiner Box, ohne dass irgendwo etwas fehlt — es sieht aus wie
         # vorher. Kommt er schon beim ersten Tipp, ist er die Einladung an
         # jedes Kind, das lange Halten einmal auszuprobieren. Beides sieht am
         # Schirm richtig aus. Die Zahlen sind ausserdem eine ABSCHRIFT aus
         # src/frontend-box/src/app/tippzaehler.ts; dass die beiden Seiten
         # gleich bleiben, misst tools/wappen-hinweis-probe.mjs.
         'wappenTipp',
         # ── DIE AKKUKURVE (07.08.2026) ───────────────────────────────────
         # `akkuStuecke` ist die Zeile, wegen der die Kurve nicht LUEGT: Sie
         # schneidet die Messreihe an den Stellen auseinander, an denen die Box
         # AUS war. Faellt sie falsch aus, zieht die Linie von 23:10 (64 %)
         # geradewegs nach 07:12 (61 %) und behauptet einen gleichmaessigen
         # Verlauf ueber eine Nacht, die niemand gemessen hat — und das sieht
         # am Schirm wie eine besonders ruhige Kurve aus.
         # `akkuLuecke` sagt ihr, ab wann ein Abstand einer ist. Zu klein: die
         # Kurve zerfaellt in 600 Einzelpunkte. Zu gross: die Nacht wird
         # ueberzeichnet. Beides sieht nach Gestaltung aus, nicht nach Fehler.
         # `akkuSatz` ist die Zeile ueber der Kurve, und sie ist die einzige,
         # die jemand WIRKLICH liest. Ihr Leerfall ist die Falle: eine fehlende
         # Kapazitaet ergaebe „noch 0 min" — die Behauptung, die Box gehe
         # gleich aus. `akkuDuenn` und `akkuFlach` sind die zwei Saetze, die
         # eine nichtssagende Linie ersetzen bzw. erklaeren.
         # `akkuAchse` ist der Zeitbezug. Ohne ihn ist die Kurve Zierrat.
         # `akkuZahl` MUSS MIT: die anderen fuenf rufen es. Ohne diese Zeile
         # uebersetzt der Auszug zwar, faellt aber beim ersten Aufruf mit
         # ReferenceError um — und das saehe wie ein kaputtes Werkzeug aus,
         # nicht wie eine fehlende Zeile.
         # `akkuLaedtRegel` MUSS EBENFALLS MIT, und zwar aus zwei Gruenden.
         # Erstens ruft `akkuSatz` es auf — ohne diese Zeile faellt der Auszug
         # beim ersten Aufruf mit ReferenceError um, genau wie bei `akkuZahl`.
         # Zweitens ist es die Regel, die vier Anzeigen zusammenhaelt: Zeichen
         # der Kopfzeile, Kaestchen im Info-Gitter, Unterzeile der Menuezeile
         # und der Satz ueber der Kurve. Bis zum 07.08.2026 entschied an drei
         # Stellen das Wort des Ladereglers und an der vierten der gemessene
         # Strom — bei „Trickle Charge" mit 15 mA zeigte die Kopfzeile den
         # Blitz, waehrend darunter „der Stand hält sich" stand. Ein Fehler
         # darin ist wieder von der stillen Sorte: beide Anzeigen sehen fuer
         # sich genommen richtig aus.
         # `akkuBandStuecke` schneidet die Abschnitte des Servers auf das
         # wirklich Gemessene. Ohne den Schnitt lief ein Balken „entlaedt" quer
         # ueber die Nacht, in der die Box aus war — und deckte die Schraffur
         # zu, die genau das zugeben soll. Das ist die Regel, die entscheidet,
         # ob das Bild luegt.
         # `akkuStromZahl`, `akkuStromWort` und `akkuSpannungWort` MUESSEN
         # MIT, seit `akkuSatz` sie ruft (08.08.2026, „kannst du auch den
         # entlade strom anzeigen"). ES HAT DIESES WERKZEUG SOFORT ROT
         # GEMACHT und ist trotzdem zwei Commits lang nicht aufgefallen: der
         # Auszug uebersetzt weiterhin, und der Fehler kommt erst beim AUFRUF
         # (ReferenceError: akkuStromWort is not defined). Wer nur `node
         # --check` laufen laesst, sieht ihn nie. Genau der Fall, vor dem der
         # Absatz ueber `akkuZahl` warnt — hier ein zweites Mal eingetreten.
         'akkuZahl', 'akkuLaedtRegel', 'akkuLuecke', 'akkuStuecke',
         'akkuBandStuecke', 'akkuAbdeckung', 'akkuAchse',
         'akkuStromZahl', 'akkuStromWort', 'akkuSpannungWort',
         'akkuMinutenWort', 'akkuSatz', 'akkuDuenn', 'akkuFlach',
         # ── LAST, WAERME UND SPEICHER (08.08.2026) ──────────────────────
         # Dieselbe Familie wie die Akkuregeln darueber, und dieselbe Sorte
         # stiller Fehler:
         # `sysStuecke` entscheidet, wo eine Linie ABREISST — bei einer
         # Luecke UND bei einem fehlenden Wert. Faellt der zweite Fall weg,
         # zieht die Waermebahn eine Gerade ueber eine Stunde ohne Sensor,
         # und das sieht wie eine besonders stabile Temperatur aus.
         # `sysLeseSatz` und `sysSatz` sind die zwei Zeilen ueber dem Bild;
         # ihr Leerfall ist wieder die Falle (`Number(null)` ist 0, und 0 °C
         # sieht aus wie eine eiskalte Box statt wie ein fehlender Sensor).
         # `sysHeiss` ist der Satz, der eine GEKLEMMTE Kurve von einer
         # gemessenen unterscheidet — ohne ihn sind 81 und 110 Grad im Bild
         # dasselbe.
         # `sysLuecke`, `sysKomma` und `sysLastWort` muessen mit, weil die
         # drei oben sie rufen.
         'sysStuecke', 'sysLuecke', 'sysKomma', 'sysKommaZwei', 'sysLastWort', 'sysLueckenSatz',
         'sysLeseSatz', 'sysSatz', 'sysHeiss', 'sysDuenn',
         # ── DIE WISCHGESTEN VOM RAND (21.08.2026) ────────────────────────
         # Sechs Regeln, und jede einzelne entscheidet etwas, das man am
         # Bildschirm NICHT sieht, wenn es falsch ist — eine Geste hat keine
         # Anzeige, an der man sie ablesen koennte.
         # `wischKante` deckelt den Randstreifen auf ein Viertel. Faellt der
         # Deckel weg, liegt ein Punkt gleichzeitig am linken UND am rechten
         # Rand, und welcher gilt, entschiede die Reihenfolge eines Vergleichs.
         # `wischRaenderVon` gibt eine LISTE zurueck, weil eine Ecke zu zwei
         # Raendern gehoert. Wer hier auf einen entscheidet, muss raten.
         # `wischZugRand` ist die Regel, die eine Geste von einem Rollen
         # unterscheidet („laengs weiter als quer"). Zu grosszuegig heisst: die
         # Titelliste laesst sich am rechten Rand nicht mehr rollen, ohne dass
         # die Lautstaerke springt. Zu streng heisst: die Geste geht nicht, und
         # niemand kann sagen warum.
         # `wischTat` schlaegt Rand und Fingerzahl in der Belegung nach; ihr
         # Vorrang bei einer Doppelbelegung steht sonst nirgends.
         # `wischBelegen` raeumt genau diese Doppelbelegung beim Einstellen
         # aus. Ohne sie stuende eine entwertete Zeile weiter in der
         # Oberflaeche und taete nichts — die stillste Sorte Fehler.
         # `wischLautWert` rechnet Ziehen in Prozent um. Ein Vorzeichenfehler
         # macht aus lauter leiser, und das merkt man erst am Geraet.
         # `wischWort` beschriftet dieselbe Belegung an drei Orten.
         'wischKante', 'wischRaenderVon', 'wischRaenderDerHand', 'wischZugRand', 'wischSprung', 'wischTat',
         'wischBelegen', 'wischLautWert', 'wischWort',
         # ── DIE ZWEI-FINGER-STEUERUNG (21.08.2026) ───────────────────────
         # `zweiAchse` entscheidet, ob ein Zug den TON oder den TITEL meint.
         # Faellt sie falsch aus, springt die Box beim Lauterdrehen eine Folge
         # weiter — und das merkt man erst, wenn die Musik eine andere ist.
         # `zweiLauf` ist die Richtung. Vertauscht heisst: „vor" geht zurueck.
         # `zweiTipp` trennt einen Tipp von einem Zug. Ohne die Wegprobe waere
         # ein sehr schneller Wisch auch ein Tipp, und zwei davon hielten die
         # Wiedergabe an, ohne dass jemand getippt haette.
         'zweiAchse', 'zweiLauf', 'zweiTipp',
         # ── DIE ANSAGE DER UHRZEIT (20.09.2026) ──────────────────────────
         # `uhrSatz` macht aus Stunde und Minute den Satz, den die Box sagt,
         # wenn jemand die Uhr antippt. Sie gehoert hierher, weil sie die
         # EINZIGE Quelle ihres Lesers ist: Wer die Ziffern nicht lesen kann,
         # hat nichts, woran er die Ansage pruefen koennte - eine Ansage, die
         # zur vollen Stunde "Es ist 15 Uhr 0" sagt oder bei einer unmoeglichen
         # Zahl etwas erfindet, klingt genauso ueberzeugt wie eine richtige.
         'uhrSatz']

# EINZEILIGE KONSTANTEN, DIE DIE REGELN BRAUCHEN.
#
# WARUM DAS SEIN MUSS (06.08.2026): `sperrModus` liest seit der Einstellungs-
# sperre-Aenderung `SPERR_ARTEN`, `gesteSchritt` liest `GESTE_ECKEN`. Beide
# stehen NEBEN der Funktion, nicht darin. Ohne sie uebersetzt der Auszug zwar,
# faellt aber beim ersten Aufruf mit „ReferenceError" um — und das saehe im
# Pruefschritt wie ein kaputtes Werkzeug aus, nicht wie eine fehlende Zeile.
#
# ABGESCHRIEBEN WERDEN SIE AUSDRUECKLICH NICHT: Eine zweite Fassung von
# `GESTE_FENSTER_MS` im Pruefschritt waere genau die Sorte Zahl, die
# auseinanderlaeuft, ohne dass etwas rot wird — der Pruefschritt prueft dann
# seine eigene Kopie. Sie kommen aus derselben Quelle wie die Funktionen.
# `GESTE_ECKE_PX` STAND HIER UND GIBT ES NICHT MEHR (06.08.2026): Die
# Kantenlaenge einer Gesten-Ecke ist keine feste Zahl mehr, sondern folgt der
# Flaeche des Tors — `gesteEckeKante(b, h)` in NAMEN. Der Grund steht bei der
# Funktion in app.js: Als der Eltern-Bereich eine Seite wurde, schrumpfte das
# Tor von 768x390 auf 680x296, und die unveraenderten 120 px deckten damit
# 30 statt 20 Prozent der Flaeche — die Geste wurde um ein Drittel leichter zu
# erraten, ohne dass jemand eine Zeile an ihr angefasst hat. Die drei Zahlen,
# aus denen sie jetzt gerechnet wird, gehen statt dessen hinaus.
KONSTANTEN = ['PUZ_KANTE', 'PUZ_MISCHZUEGE', 'RECH_BIS', 'RECH_WAHLEN', 'SPERR_ARTEN', 'GESTE_ECKE_HOECHSTENS_PX', 'GESTE_ECKE_MINDESTENS_PX',
              # Die Zahlen der Memory-Spielarten (E139). `memPaareZahl` liest
              # die beiden Deckel, `memCrazyZeitS` die drei Uhrwerte — sie
              # stehen NEBEN den Funktionen, nicht darin. Und sie gehen MIT
              # HINAUS: Der Pruefschritt rechnet die Vollbild-Karten und die
              # Uhr-Untergrenze gegen die ECHTEN Werte, nicht gegen Kopien.
              'MEM_PAARE_HOECHSTENS', 'MEM_PAARE_MINDESTENS', 'MEM_VOLL_PAARE',
              'MEM_CRAZY_START_S', 'MEM_CRAZY_SCHRITT_S', 'MEM_CRAZY_MIN_S',
              'MEM_ZEIGEN_MS', 'MEM_HASH_GLEICH',
              'GESTE_ECKE_ANTEIL', 'GESTE_FENSTER_MS', 'GESTE_ECKEN',
              'TOR_WARTEN_S', 'GESTE_FREI',
              'SPERR_WORT', 'KACHEL_STUFEN', 'KACHEL_WORT',
              'SPOTIFY_EINRICHT_PORT',
              # `wappenTipp` liest beide — sie stehen NEBEN der Funktion, nicht
              # darin. Ohne sie uebersetzt der Auszug und faellt beim ersten
              # Aufruf mit ReferenceError um.
              'WAPPEN_TIPPS', 'WAPPEN_TIPP_FENSTER_MS',
              # Die Konstanten der Akkukurve. `AKKU_RUHE_MA` ist eine ABSCHRIFT
              # von RUHE_SCHWELLE aus akkuverlauf.ts; dass die beiden gleich
              # bleiben, misst tools/akkukurve-schau.mjs.
              'AKKU_LUECKE_MIN_MS', 'AKKU_LUECKE_FAKTOR', 'AKKU_ACHS_STUFEN',
              'AKKU_ACHS_MARKEN', 'AKKU_RUHE_MA', 'AKKU_MIND_PUNKTE',
              'AKKU_MIND_SPANNE_MS', 'AKKU_FLACH_PROZENT', 'AKKU_SPANNEN',
              # `akkuLeseSatz` und `sysLeseSatz` lesen AKKU_WOCHENTAG.
              'AKKU_WOCHENTAG',
              # Die Konstanten der Systemkurve. SYS_GRAD_* sind die feste
              # Skala der Waermebahn; `sysHeiss` prueft gegen SYS_GRAD_BIS.
              'SYS_SPANNEN', 'SYS_GRAD_VON', 'SYS_GRAD_BIS', 'SYS_GRAD_MARKE',
              # Die Konstanten der Wischgesten. Sie gehen MIT HINAUS, nicht nur
              # hinein: Der Pruefschritt rechnet damit gegen die ECHTEN Werte —
              # eine abgeschriebene 44 im Test pruefte irgendwann ihre eigene
              # Kopie. `WISCH_RAND_MIND_PX` wird von keiner der sieben
              # Funktionen gelesen und steht trotzdem hier: sie ist die
              # Untergrenze, die die Einstelloberflaechen anbieten duerfen, und
              # der Test haelt sie gegen den Deckel in `wischKante`.
              'WISCH_RAND_VORGABE_PX', 'WISCH_RAND_MIND_PX', 'WISCH_RAND_HOECHST_PX',
              'WISCH_ZUG_PX', 'WISCH_FENSTER_MS', 'WISCH_SPRUNG_ANTEIL',
              'WISCH_RAENDER', 'WISCH_TATEN', 'WISCH_HAND_PX',
              # Die Konstanten der Zwei-Finger-Steuerung. Auch sie gehen MIT
              # HINAUS, damit der Pruefschritt gegen die echten Werte rechnet.
              'ZWEI_MIND_PX', 'ZWEI_TIPP_MS', 'ZWEI_TIPP_PX', 'ZWEI_DOPPEL_MS']


def hol(text: str, name: str) -> str:
    """Eine Funktionsdeklaration mitsamt Rumpf herausschneiden.

    UEBER DIE KLAMMERN GEZAEHLT, nicht ueber eine Endmarke: In app.js sind die
    Funktionen eingerueckt (sie stehen in einer IIFE), ein `\\n}` gibt es dort
    also gar nicht — der Ansatz aus tools/zeit-auszug.py traegt hier nicht.

    KOMMENTARE UND ZEICHENKETTEN WERDEN MITGEZAEHLT, und das ist eine bekannte
    Falle: eine geschweifte Klammer in einem Kommentar zaehlt mit und beendet
    den Rumpf zu frueh oder zu spaet (llmwiki klammerzaehler-liest-kommentare-
    mit). Beide Funktionen hier sind kurz und kommen ohne solche Klammern aus;
    trifft das einmal nicht mehr zu, faellt es sofort auf, weil der Auszug dann
    gar nicht mehr uebersetzt.
    """
    anfang = text.index(f'function {name}(')
    auf = text.index('{', anfang)
    tiefe = 0
    for i in range(auf, len(text)):
        if text[i] == '{':
            tiefe += 1
        elif text[i] == '}':
            tiefe -= 1
            if tiefe == 0:
                return text[anfang:i + 1]
    raise SystemExit(f'{name}: die Klammern gehen nicht auf')


def holKonstante(text: str, name: str) -> str:
    """Eine einzeilige `const NAME = …`-Zeile herausschneiden.

    GENAU EINE DEKLARATION MUSS ES SEIN, sonst bricht der Lauf ab. Ein zweites
    `const` desselben Namens (etwa in einer anderen IIFE) waere sonst eine
    stille Wahl zwischen zwei Fassungen — und der Pruefschritt haette
    ausgerechnet die andere.
    """
    treffer = re.findall(rf'^[ \t]*const {name} = .*$', text, re.MULTILINE)
    if len(treffer) != 1:
        raise SystemExit(f'{name}: {len(treffer)} Deklarationen gefunden, genau 1 erwartet')
    return treffer[0].strip()


def main() -> None:
    text = '\n'.join(q.read_text(encoding='utf-8') for q in QUELLEN)
    konsten = [holKonstante(text, k) for k in KONSTANTEN]
    rumpfe = [hol(text, n) for n in NAMEN]
    for s, n in zip(rumpfe, NAMEN):
        # Die Gegenprobe zum Klammerzaehler: ein Rumpf, in dem noch eine
        # zweite Deklaration steckt, waere zu weit gelaufen.
        if len(re.findall(r'\bfunction \w+\(', s)) != 1:
            raise SystemExit(f'{n}: der Auszug hat mehr als eine Funktion eingefangen')
    kopf = '// ERZEUGT — nicht von Hand aendern (tools/neu-regeln-auszug.py).\n'
    # DIE KONSTANTEN GEHEN MIT HINAUS, nicht nur hinein: Der Pruefschritt
    # braucht `GESTE_FENSTER_MS` und die drei Zahlen der Gesten-Ecke, um mit
    # den ECHTEN Werten zu rechnen statt mit abgeschriebenen.
    raus = KONSTANTEN + NAMEN
    ZIEL.write_text(
        kopf + '\n'.join(konsten + rumpfe) + '\nmodule.exports = { ' + ', '.join(raus) + ' }\n',
        encoding='utf-8',
    )
    print(f'{ZIEL} erzeugt ({len(NAMEN)} Regeln, {len(KONSTANTEN)} Konstanten)')


if __name__ == '__main__':
    main()
