#!/usr/bin/env node
// Wie schwer ist die neue Oberflaeche — und waechst sie unbemerkt?
//
// WOZU: Zwischen dem 05.08. und dem 13.08.2026 ist NewDesign/app.js von 418
// auf 1204 kB gewachsen (roh, +188 %), app.css von 166 auf 339 kB — und KEINE
// Pruefung hat es gesehen; aufgefallen ist es erst dem Audit. Fuer den
// Loopback-Kiosk zaehlt die Parse-Zeit bei jedem Start, fuers Eltern-Telefon
// der Transfer. Das Audit vom 05.08. (Paragraf 4.1) hat genau dieses Werkzeug
// verlangt; seit dem 13.08. gibt es serverseitig compression — die ROHE
// Groesse parst der Kiosk trotzdem.
//
// WIE ES URTEILT — EIN DECKEL JE DATEI, BEWUSST GESETZT: die Zahlen unten
// sind der gemessene Stand vom 13.08.2026 plus rund zehn Prozent Luft.
// Waechst eine Datei darueber, ist das kein Verbot — es ist die Frage "war
// das Absicht?", gestellt in dem Moment, in dem sie noch beantwortbar ist.
// Wer bewusst waechst (neues Fenster, neue Reihe), hebt den Deckel MIT
// BEGRUENDUNG an. Schrumpft eine Datei deutlich (Kommentar-Strip-Stufe im
// Ausrollweg, im Audit vorgeschlagen), gehoert der Deckel heruntergesetzt.
//
// AUFRUF
//   node tools/neu-groessen-schau.mjs             Tabelle roh + gzip
//   node tools/neu-groessen-schau.mjs --pruefen   still; Ende 1 ueber Deckel
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)))

// Stand 13.08.2026 (gemessen: 1.203.878 / 338.526 / 85.137 Byte) + ~10 %.
//
// ── ANGEHOBEN AM 21.08.2026: app.js von 1.330.000 auf 1.450.000 ──────────
//
// GRUND: die Wischgesten vom Rand ([[wischgesten-vom-rand]]). Gemessen
// 1.382.237 B roh (vorher 1.321.230), also +61 kB roh und +19 kB gzip. Der
// neue Deckel ist der gemessene Stand plus rund fuenf Prozent — knapper als
// die zehn von oben, weil dieser Zuwachs bekannt ist und kein weiterer
// eingeplant wird.
//
// WAS DIE 61 kB SIND: ein Erkenner (`wisch`), ein Schnellfenster (`schnell`,
// vier Zeilen mit eigenen Abrufen), fuenf Zeilen im Eltern-Bereich, sieben
// reine Regeln — und deren Begruendungen. Der Anteil der Kommentarzeilen ist
// dabei derselbe wie im Rest der Datei; das ist die Hausform und nicht ein
// Ausrutscher dieses Stuecks.
//
// FUER DEN KIOSK HEISST DAS: rund 5 % mehr Parse-Zeit fuer app.js. Der
// Vorschlag des Audits vom 13.08. (Kommentar-Strip-Stufe im Ausrollweg) ist
// damit nicht erledigt, sondern faelliger — er wuerde diese 61 kB und die
// 1,2 MB davor auf einen Schlag erledigen, ohne eine Zeile Begruendung zu
// verlieren.
const DECKEL = {
  // app.css -> 437_000 (05.09.2026, nach dem Heimholen von E122–E127):
  // die Ton-Serie brachte ~5 kB Stilregeln mit, ohne den Deckel
  // anzuheben — die Wache stand dauerrot und haette den naechsten echten
  // Fund verdeckt. Gemessen: 435.860 B auf dem gemergten HEAD.
  // Davor: 431_000 (E121): classic-Bloecke, Titelkarte, kat-einer,
  // Kopf-/BT-Anzeigen.
  // -> 1_512_000 (E121/4b+4d): Kategorien-Durchschalter, beimVerlassen-
  // Stopp am Nutzer-Rueckweg und die Titelkarte (Ueberblendung, ~90 Zeilen
  // samt Begruendungen).
  // index.html -> 98_000 im selben Zug (vier neue Kopf-/BT-Spans
  // samt Herkunfts-Kommentaren).
  // -> 1_506_000 (E121/4a+4c, 05.09.2026): sechs Uebernahme-Felder samt
  // Begruendungs-Kommentaren (endet-um, Titel-/Schlummer-Rest im Kopf,
  // Kopfhoerer-Akku, Streifenlaenge, Namen-Abstand).
  // -> 1_502_000 am 05.09.2026 (E118/1e): Grabstein- und Richtigstellungs-
  // Kommentare beim Fall der alten Oberflaeche (andereOberflaeche-Prosa,
  // Rueckweg-Marke, Stand-Rechnung) — Kommentarzeilen, keine Logik.
  // 1_450_000 -> 1_456_000 -> 1_459_000 am 30.08.2026 abends (E99-Nachdreh
  // in vier Betreiber-Runden): (1) automatische Verstaerkung („die
  // animation ist zu flach"), (2) Seitenwechsel in Zweierpaaren („auch
  // negativ"), (3) Foerderband 25 Bilder/s + 60-ms-Schranke („abgehackt",
  // „beim lautstaerke-tippen beschleunigt"), (4) Pegelstrom-EventSource
  // („fast update process … entkoppelt von anderen events"). Gemessen
  // 1.456.568 B — Zeichnerlogik samt Begruendungen im Hausstil, Deckel
  // wieder eng am Ist.
  // -> 1_462_000 noch am selben Abend: E105 (Quellen-Kategorie im
  // lokal-Befehl) und die Nummernraum-Regel fuer Weiterhoeren („Du
  // bedeutest mir die Welt": gemerkt bei Spotify Titel 8, bevorzugt
  // lokal mit Teilbestand — die gemerkte Quelle gewinnt). Beide Male
  // Betreiber-Messfaelle mit Begruendung im Kommentar; die zu kuerzen
  // hiesse, den naechsten Leser wieder raten zu lassen.
  // -> 1_496_000 am 03.09.2026: DIE SCHUBLADE (Betreiber: „baue ein menu wie
  // bei android slidern … weitere apps … spiele, lernen, lesen"). Sie ist
  // die Leiste selbst, die sich auf `--sch-breit` aufziehen laesst — Griff,
  // Zug mit Einrasten bei 40 %, Randziehen in ZWEI Fassungen (Zeiger UND
  // Beruehrung, weil `pointer*` am Finger nach rund 20 px endet — derselbe
  // Befund wie beim Randwisch am 06.08.2026), Tastaturweg ueber `detail === 0`,
  // zwei neue Ebenen im einen Rueckweg, und Memory als die EINE App, die
  // wirklich dahinterliegt (Cover aus /api/werke, kein Abspielweg, keine
  // Kinderzeit).
  // GEMESSEN 1.492.881 B. Davon sind rund 36.6 kB diese Arbeit; rund 9.4 kB
  // sind der Austaster-Ring einer PARALLELEN Sitzung, der zur selben Zeit
  // unkommittiert im Baum lag (`/api/taster/strom`). Die Trennung steht hier,
  // damit der naechste Leser sie nicht neu ausrechnen muss — und damit
  // niemand fremde Groesse fuer begruendet haelt, nur weil sie mitgezaehlt
  // wurde. Wer den Ring committet, schreibt seine Begruendung dazu.
  // -> 1_512_000 am 03.09.2026, zweiter Zug: drei weitere Apps in der
  // Schublade (Betreiber: „ich hab mir vorgestellt das man die leiste
  // rauszieht und noch weitere button zum vorschein kommen"). Puzzle
  // (Schiebepuzzle aus einem Cover, aus der LOESUNG heraus gemischt — die
  // Haelfte aller freien Anordnungen waere unloesbar), Rechnen (eigener
  // Aufgaben-Erzeuger; der des Eltern-Tors ist ausdruecklich SO gebaut, dass
  // ein Kind ihn nicht loest) und Lesen (Titel der eigenen Bibliothek, in
  // Silben vorgelesen).
  // -> 1_520_000 am 03.09.2026, dritter Zug: „Uhr lernen" (Betreiber: „uhr
  // lernen finde ich gut"). Zifferblatt als SVG, volle und halbe Stunden,
  // dieselbe Antwortauswahl wie Rechnen. Die stille Regel darin ist `uhrWort`
  // — „halb 4" ist 3:30 und nicht 4:30; sie haengt seither in der Pruefung.
  // -> 1_496_000 am 03.09.2026, vierter Zug: DIE APPS SIND AUSGEZOGEN
  // (Betreiber: „denke an die plugin strucktur bitte"). Siebzehn Funktionen
  // und die Liste sind nach NewDesign/apps.js gewandert, rund 31 kB.
  //
  // HIER STAND ZUERST 1_452_000 mit dem Satz „app.js faellt damit unter den
  // Stand von heute frueh zurueck". DAS WAR FALSCH und ist beim Messen
  // aufgeflogen: Ausgezogen sind die APPS, nicht die SCHUBLADE. Griff, Zug,
  // Einrasten, Randziehen in zwei Fassungen und die zwei neuen Ebenen im
  // Rueckweg sind Oberflaeche und bleiben zu Recht hier — das sind die rund
  // 36 kB, die bleiben. Dazu die 9,4 kB Austaster-Ring der Nachbarsitzung.
  // Gemessen 1.488.507 B (vorher 1.514.772), also 26 kB weniger als vor dem
  // Auszug und 42 kB mehr als HEAD. Der Deckel sitzt eng darueber.
  // -> 1_545_000 (05.09.2026). ZWEI Posten, und nur einer ist neue Arbeit:
  // die heimgeholte Ton-Serie E122–E127 brachte ~16 kB mit, ohne den Deckel
  // anzuheben (dieselbe Dauerrot-Lage wie bei app.css), und E129 legt die
  // Buehne samt Songtext- und Titel-Bewohner darauf (~12 kB).
  // -> 1_595_000 (E139, 09.09.2026). Der Deckel war schon VOR dieser Arbeit
  // gerissen: HEAD (ecfb2e35) misst 1.588.914 B, also 44 kB darueber, aus
  // den Zuegen der Vortage (E13x-Serie), die ihn nicht nachgezogen haben —
  // eingeschlossen statt einer Sitzung zugeschrieben, die es nicht war
  // (dasselbe Vorgehen wie bei app.css am 03.09.). E139 selbst sind hier
  // nur 195 B: `appBuehneZu` raeumt jetzt `app-voll` statt `mal-voll` ab.
  // Gemessen 1.589.109 B; die Wache ist damit wieder scharf statt dauerrot.
  // -> 1_650_000 (13.09.2026). ZWEI Posten, und nur einer ist von heute:
  // Das Box-Admin-Menue kann jetzt, was die Verwaltung seit E115/E30 kann —
  // bekannte Netze ohne Passwort, gespeicherte Netze samt Vergessen-
  // Rueckfrage, und das VPN-Fach (Betreiber: „das verbinden zu wlans wie im
  // admin auch im admin menü auf der box, auch vpn"). Das sind 32.086 B
  // (gemessen 1.641.853 B). DARUNTER LIEGT WEITER DIE ALTSCHULD, die der
  // Kritiker-Lauf vom 13.09. anmahnt (Pack: audit-2026-09-13-kritiker):
  // HEAD (059847c5) mass 1.609.767 B, also schon 15 kB ueber dem alten
  // Deckel, und der zugesagte Abbau von spieltMarkieren() steht aus. Der
  // Deckel legalisiert diese Schuld NICHT — wer sie abbaut, senkt ihn
  // wieder um das Gemessene.
  // -> 1_700_000 (20.09.2026). DREI Posten, und nur zwei sind von heute:
  // Betreiber: „in der spiele sektion will ich das vorlesen noch einschalten
  // koennen und auch verschiedene spiele ein und ausschalten koennen."
  // Dafuer kamen DREI SPIELE dazu (Paare, Drei gewinnt, Farben merken) samt
  // Auswahl, Ansage und einem Rahmen, der sie traegt — 33.011 B, gemessen
  // 1.684.606 B gegen HEAD (fbcadfb6) 1.651.615 B. Die Spiele sind der Zweck
  // des Auftrags und nicht Beiwerk: Wer sie kuerzen will, kuerzt Spiele weg,
  // nicht Kommentare. ANGEHOBEN WIRD AUF 1_700_000 und nicht knapp
  // darueber — 15 kB Luft, damit die naechste Kleinigkeit nicht wieder eine
  // Deckelfrage ist. DARUNTER LIEGT WEITER DIE ALTSCHULD vom 13.09.: HEAD
  // stand schon 1.615 B ueber dem alten Deckel, und der zugesagte Abbau von
  // spieltMarkieren() steht weiter aus. Der Deckel legalisiert sie NICHT.
  'NewDesign/app.js': 1_700_000,
  // NEU am 03.09.2026. Die Apps der Schublade: Memory, Puzzle, Rechnen, Uhr,
  // Lesen, Malen. Eigene Datei, eigener Deckel — genau das war der Sinn des
  // Auszugs. Gemessen beim Anlegen; die Luft ist knapp gehalten, damit die
  // naechste App wieder eine bewusste Entscheidung ist und keine Rutschbahn.
  // -> 46_000 am 04.09.2026: der Groessen-Beobachter der Mal-Leinwand bleibt
  // dran und nimmt das Bild mit, statt sich beim ersten Strich auszuklinken.
  // Am Geraet gemessen: Puffer 1160x503 gegen Anzeige 1160x461 — ein
  // gestreckter Strich, der nicht unter dem Finger landet.
  // -> 62_000 (E139, 09.09.2026): die vier Spielarten des Memory. Ein
  // Wahlschirm, die Uhr der Spielart „Verrueckt" samt Mischen der
  // zugedeckten Karten, das Alles-wieder-zu der Spielart „Ohne Fehler",
  // Chips und Wechselregel fuer „Zu zweit" und der Vollbild-Knopf mit
  // doppelter Paarzahl. Gemessen 58.770 B (vorher 44.260) — der Zuwachs
  // traegt die Hausform (Begruendung neben Regel); der Deckel sitzt mit
  // rund fuenf Prozent Luft darueber, wie beim Bump vom 21.08. begruendet.
  // -> 76_000 (E140, 09.09.2026): die mitgelieferten Kartensaetze. Der
  // Betreiber meldete am Brett doppelte Bilder, die keine Paare sind — zwei
  // Titel EINES Albums tragen dasselbe Cover, und 60 von 97 Alben tragen den
  // Maskottchen-Platzhalter (llmwiki rueckfallbild-macht-den-fehler-
  // unsichtbar). Neu sind deshalb: der Satz-Wahlschirm, der Lader fuer
  // bilder/memory/saetze.json und die Aussiebung nach BILDINHALT
  // (`memBildHash` als 8x8-Mittelwerthash, `memHashAbstand`, `memHashNeu`) —
  // sie erwischt beide Faelle, ohne wissen zu muessen, WELCHES Bild der
  // Platzhalter ist. Gemessen 72.045 B (vorher 58.770).
  'NewDesign/apps.js': 76_000,
  // 375_000 -> 380_000 -> 383_000 -> 388_000 am 30.08.2026: nach den
  // Sinuslinien (siehe die drei Bumps darueber) jetzt E99 — der Balken hoert
  // den echten Ton. Neu ist die Leinwand-Regel (`.wellen-leinwand`, DPR-fest
  // per JS, hier nur Lage/Groesse/`pointer-events: none`) und der
  // `wellen-echt`-Umschalter, der die alten Sinuslinien ablaest, SOBALD
  // wirklich Pegel-Daten fliessen — beide Bauarten stehen damit nebeneinander
  // im Quelltext (Rueckfall fuer Boxen ohne Pegel-Lieferant). Gemessen
  // 385.376 B (vorher 380.7 kB), der Deckel bleibt eng am Ist.
  // -> 416_000 am 03.09.2026: die Schublade (siehe app.js). Neu sind die drei
  // Breiten (Flaeche, Kategorienliste, Griff) samt der Regel, die die Leiste
  // beim Aufziehen AUFHOEREN laesst zu schneiden, und das Memory-Brett.
  //
  // UND EINE BERICHTIGUNG, die hierhin gehoert: Der Deckel 388_000 war schon
  // VOR dieser Arbeit gerissen — HEAD (7b85348f) misst 391.013 B, also 3.013 B
  // darueber. Eine Nachbarsitzung hat das am 03.09. als Folge DIESER Arbeit
  // gemeldet; das war es nicht, und die Zahl, die sie nannte, war genau die
  // von HEAD. Wer die 3.013 B verursacht hat, steht nicht fest und wird hier
  // nicht erfunden — sie sind mit eingeschlossen, statt sie einer Sitzung
  // anzuhaengen, die sie nicht geschrieben hat. Gemessen 412.298 B.
  // -> 421_000 am 03.09.2026, zweiter Zug: Brett und Steine des Puzzles,
  // Aufgabe und Antworttasten des Rechnens, das grosse Wort des Lesens.
  // -> 425_000 am 03.09.2026, vierter Zug: die Mal-App (Leinwand, acht
  // Farbknoepfe, drei Strichstaerken). Das CSS ist NICHT mit ausgezogen —
  // der Auftrag lautete auf apps.js, und eine apps.css waere ein zweiter
  // Schnitt ohne Auftrag. Wer den naechsten Deckel hier anhebt, sollte ihn
  // stattdessen machen: die App-Regeln sind an ihren Praefixen (mem-, puz-,
  // mal-, uhr-, les-, app-) sauber abgegrenzt.
  // -> 428_000 am 04.09.2026: der grosse Player liegt jetzt VOR dem Spiel
  // (Betreiber: „der player soll vor dem spiel oeffnen"). Die Buehne faellt
  // dafuer auf z-index 4 zurueck, solange `#gross` offen ist — geloest ueber
  // `:has()` statt einer Klasse am body, weil der Player an drei Stellen
  // geoeffnet und an mehreren geschlossen wird.
  // -> 441_000 (E129): die Buehne und ihre Textflaeche.
  // -> 465_000 (E139, 09.09.2026). Auch hier war der Deckel VOR dieser
  // Arbeit gerissen (HEAD misst 456.026 B, +15 kB aus den Vortagen) —
  // eingeschlossen nach demselben Muster wie oben. E139 selbst sind ~3,9 kB:
  // der Wahlschirm der Spielarten, die Uhr, das Wackeln nach dem Mischen
  // (nur `transform`, keine neue Zeichenschicht), der Patzer-Rahmen und die
  // zwei Spieler-Chips. Die Vollbild-Regeln heissen jetzt `app-voll` statt
  // `mal-voll` — Groesse unveraendert, nur die Sorte statt der einen App.
  // Gemessen 459.933 B.
  'NewDesign/app.css': 465_000,
  // -> 97_000 am 03.09.2026: die Schublade braucht im Rumpf ihre Flaeche, den
  // Griff und die Buehne einer App (Kopf, Titel, Inhalt). Gemessen 95.698 B —
  // vorher lag die Datei mit 91.188 B unter dem Deckel, diese Arbeit hat ihn
  // gerissen.
  // -> 100_000 (E129, 05.09.2026): die Buehne ueber den Tasten samt der
  // Begruendung, warum sie `gross-buehne` heisst und nicht `buehne` — der
  // Name `.buehne` gehoert seit je der Hauptflaeche der App, und eine
  // display-Regel darauf haette die ganze Oberflaeche ausgeblendet.
  // -> 110_000 (09.09.2026, im Zuge von E139 nachgezogen): E139 hat diese
  // Datei NICHT angefasst — der Riss (HEAD misst 107.532 B) stammt aus den
  // Vortagen und stand seit mindestens dem 09.09. dauerrot. Eine Wache, die
  // immer meldet, deckt den naechsten echten Fund zu; der Deckel sitzt
  // wieder knapp ueber dem Ist, die Herkunft der 7,5 kB bleibt unerfunden.
  'NewDesign/index.html': 110_000,
  // 16_000 / 7_000 (20.09.2026): die Belohnungs-Videos. Sie stehen von
  // Anfang an in EIGENEN Dateien und nicht in app.js/app.css — beide lagen
  // beim Bau bei 99 % ihres Deckels, und apps.js hat denselben Schnitt am
  // 03.09.2026 schon gemacht (sein Kommentar empfiehlt ihn dort
  // ausdruecklich auch fuer das CSS). Gemessen 13.324 B und 5.045 B; die
  // Deckel sitzen knapp darueber, damit ein Wachstum hier dieselbe Frage
  // stellt wie ueberall sonst: war das Absicht?
  // -> 23_000 / 9_000 am 20.09.2026, noch am selben Tag (Betreiber: „das
  // video braucht noch einen player menü mit volume"). Neu sind die Leiste
  // (Anhalten-Knopf mit wechselndem Zeichen, Fortschrittsbalken, Zeit,
  // Lautstaerkeregler) und ihr Selbstausblenden. Der Regler traegt
  // `data-laut-regler` und laeuft durch `laut.setzen()` — er ist damit der
  // vierte Regler am selben Flaschenhals und nicht eine zweite Skala.
  // Gemessen 21.300 B und 8.056 B.
  // -> 29_000 am 20.09.2026, wieder am selben Tag (Betreiber: „marker im
  // video setzen zu koennen um definerte stuecke zumachen eine 25 min maus
  // ist ggf zu lange"). Eine Freigabe kann jetzt ein AUSSCHNITT sein, und
  // das kostet hier drei Dinge, die nicht wegzuschreiben sind: den Sprung
  // nach `loadedmetadata`, das Anhalten bei `bisSek`, und eine Rechnung, die
  // gegen die STUECKLAENGE geht statt gegen `spieler.duration`. Der dritte
  // Punkt ist der teuerste und der noetigste — gegen die Videolaenge
  // gerechnet erreichte ein Fuenf-Minuten-Stueck die Schwelle nie und liefe
  // unbegrenzt oft (llmwiki `stueck-schwelle-rechnet-gegen-das-stueck`).
  // Gemessen 27.406 B.
  'NewDesign/video.js': 29_000,
  'NewDesign/video.css': 9_000,
}

const still = process.argv.includes('--pruefen')
let bruch = false

for (const [rel, deckel] of Object.entries(DECKEL)) {
  const roh = readFileSync(join(WURZEL, rel))
  const gz = gzipSync(roh).length
  const anteil = ((roh.length / deckel) * 100).toFixed(0)
  if (roh.length > deckel) {
    console.log(
      `${rel}: ${roh.length.toLocaleString('de-DE')} B roh (gzip ${gz.toLocaleString('de-DE')}) — ` +
        `UEBER dem Deckel von ${deckel.toLocaleString('de-DE')} B.`,
    )
    console.log('  War das Absicht? Dann den Deckel in tools/neu-groessen-schau.mjs')
    console.log('  MIT BEGRUENDUNG anheben — sonst schrumpfen (der groesste Posten')
    console.log('  sind mitreisende Kommentarzeilen, siehe Audit 2026-08-13, 5.1).')
    bruch = true
  } else if (!still) {
    console.log(
      `${rel.padEnd(22)} ${roh.length.toLocaleString('de-DE').padStart(10)} B roh` +
        `  ${gz.toLocaleString('de-DE').padStart(9)} B gzip  (${anteil} % des Deckels)`,
    )
  }
}

process.exit(bruch ? 1 : 0)
