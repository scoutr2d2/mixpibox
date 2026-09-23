/**
 * Prueft die REINEN Regeln der neuen Oberflaeche.
 *
 * WOZU: Beide entscheiden etwas, das auf dem Bildschirm richtig AUSSIEHT, wenn
 * es falsch ist.
 *
 *   boxnameTeilen      Eine falsche Grenze macht aus „MixPiZwei" ein „MixPiZ"
 *                      und ein „wei". Auf der Box steht dann ein Name, den
 *                      niemand je neben dem eingetragenen sieht — genau der
 *                      Zustand, in dem die Kopfzeile schon einmal ein Jahr
 *                      lang „MuPiBox" behauptete (llmwiki
 *                      benennung-mixpibox-drei-toepfe).
 *   naechsterRueckweg  Eine vertauschte Zeile schliesst eine Ebene, die
 *                      gerade niemand sieht. Der Tipp scheint folgenlos, und
 *                      beim naechsten Aufmachen ist etwas anders, ohne dass
 *                      jemand einen Zusammenhang sieht.
 *   fassungBeschriften Die Fusszeile der Seitenleiste behauptet, WELCHER Stand
 *                      auf der Box laeuft. Eine falsche Behauptung sieht
 *                      genauso aus wie eine richtige — und wird geglaubt.
 *   sperrModus         DIE STILLSTE REGEL DES HAUSES. Ihre Vorgabe ist seit
 *                      dem 06.08.2026 „rechnen" und nicht mehr „aus" — das ist
 *                      die eine Zeile, die den Auftrag „eine frische Box darf
 *                      nicht offen stehen" wirklich einloest (der `standard`
 *                      in konfiguration.ts faerbt nur die Anzeige des Boards,
 *                      GEMESSEN mit tools/tor-kette-messen.mjs). Faellt sie
 *                      falsch aus, steht der Eltern-Bereich offen — und das
 *                      sieht am Bildschirm EXAKT so aus wie eine Sperre, die
 *                      niemand eingeschaltet hat. Dahinter liegen WLAN, die
 *                      rohe Mediendatenbank und ein Herunterfahren, das von der
 *                      Box aus IMMER ohne Anmeldung erreichbar ist.
 *   gesteEcke          in welcher Ecke der Tor-Flaeche ein Punkt liegt. Zu
 *                      grosszuegig heisst: die Geste geht mit vier Tipps
 *                      irgendwohin auf. Zu knapp heisst: sie geht mit einem
 *                      Kind auf dem Arm gar nicht mehr — und beides meldet
 *                      keine Groessenmessung, weil die Ecken keine
 *                      Bedienelemente sind, sondern Geometrie.
 *   gesteSchritt       die Folge selbst. Ihre drei Ruecksetzer (daneben,
 *                      falsche Ecke, zu viel Zeit) sind der Unterschied
 *                      zwischen einer Sperre und einer Verzierung: faellt einer
 *                      weg, oeffnet Herumtippen den Bereich, und zwar genau so
 *                      unauffaellig wie vorher.
 *   torFertig          gibt „Weiter" frei. Zu frueh heisst: ein Knopf, der
 *                      eine Pruefung verspricht, die immer nein sagt.
 *   zifferDazu         haengt eine Ziffer an — und darf bei einem Fehlgriff
 *                      NICHT loeschen, was schon dasteht.
 *   btZeile            der mittlere Bluetooth-Zustand („gekoppelt, aber nicht
 *                      verbunden") ist die Lage, in der die Box stumm bleibt
 *                      und niemand weiss warum. Er darf nicht aussehen wie
 *                      „aus".
 *   weiterMarke        beschriftet die Weiterhoeren-Kachel. „Titel 3" war
 *                      ehrlich und sagte nichts; seit dem 06.08.2026 steht
 *                      dort der FOLGENNAME, wo es einen gibt. Faellt der
 *                      Vorrang falsch aus, sieht die Kachel auf dem Schirm aus
 *                      wie eine Entscheidung, nicht wie ein Fehler.
 *   folgenBildAn       schlaegt das Cover zur laufenden Warteschlangennummer
 *                      nach. Um eins daneben heisst: das Bild der
 *                      NACHBARFOLGE — es sieht gut aus und gehoert nicht zum
 *                      Ton.
 *   folgenNameAn       dasselbe fuer den NAMEN (Backlog F1). Seit das Cover
 *                      der Position folgt, stand das Bild von Folge N unter
 *                      dem Namen von Folge 1 — die Anzeige widersprach sich
 *                      selbst. Ein leerer Name darf nicht durchkommen: eine
 *                      leere Titelzeile sieht aus wie „es laeuft nichts".
 *   folgeKennung       die Kennung einer mpv-Folge (Backlog F2). Eine HALBE
 *                      Kennung ist hier die gefaehrlichste Sorte: leer ist
 *                      gleich leer, und die Marke „spielt gerade" saesse auf
 *                      einer fremden Kachel. Faellt sie ganz aus, fehlt die
 *                      Marke — und das sieht aus wie „es laeuft nichts".
 *
 * Der Auszug wird aus der Quelle ERZEUGT, damit die Pruefung nicht neben ihr
 * herlaeuft: tools/neu-regeln-auszug.py.
 *
 * WAS ES AENDERT: nichts. Kein Browser, keine Box, Sekundenbruchteile.
 *
 * AUFRUF: node tools/pruef-neu-regeln.js
 */
const { execFileSync } = require('node:child_process')
const {
  boxnameTeilen,
  memBrettMasse,
  memCrazyZeitS,
  memNaechsterDran,
  memPaareZahl,
  memHashAbstand,
  memHashNeu,
  memWortAusDatei,
  MEM_HASH_GLEICH,
  MEM_PAARE_HOECHSTENS,
  MEM_PAARE_MINDESTENS,
  MEM_VOLL_PAARE,
  MEM_CRAZY_START_S,
  MEM_CRAZY_MIN_S,
  MEM_ZEIGEN_MS,
  puzNachbarn,
  puzMischen,
  puzGeloest,
  rechenAufgabe,
  uhrWort,
  uhrAuswahl,
  uhrSatz,
  PUZ_KANTE,
  RECH_BIS,
  naechsterRueckweg,
  fassungBeschriften,
  sperrModus,
  torFertig,
  zifferDazu,
  btZeile,
  weiterMarke,
  folgenBildAn,
  folgenNameAn,
  folgeKennung,
  ichBildPfad,
  gesteEcke,
  gesteSchritt,
  torWartenS,
  TOR_WARTEN_S,
  gesteWartenS,
  GESTE_FREI,
  GESTE_ECKEN,
  gesteEckeKante,
  GESTE_ECKE_HOECHSTENS_PX,
  GESTE_ECKE_MINDESTENS_PX,
  GESTE_ECKE_ANTEIL,
  GESTE_FENSTER_MS,
  freigabeNochGueltig,
  sperrUnterzeile,
  infoFelder,
  boxIpAus,
  spotifyEinrichtAdresse,
  SPOTIFY_EINRICHT_PORT,
  kachelWort,
  kachelWeiter,
  SPERR_WORT,
  KACHEL_STUFEN,
  wappenTipp,
  WAPPEN_TIPPS,
  WAPPEN_TIPP_FENSTER_MS,
  akkuLaedtRegel,
  akkuLuecke,
  akkuStuecke,
  akkuBandStuecke,
  akkuAbdeckung,
  akkuAchse,
  akkuMinutenWort,
  akkuSatz,
  akkuDuenn,
  akkuFlach,
  AKKU_LUECKE_MIN_MS,
  AKKU_LUECKE_FAKTOR,
  AKKU_ACHS_MARKEN,
  AKKU_MIND_PUNKTE,
  AKKU_RUHE_MA,
  wischKante,
  wischRaenderVon,
  wischRaenderDerHand,
  wischZugRand,
  wischSprung,
  wischTat,
  wischBelegen,
  wischLautWert,
  wischWort,
  zweiAchse,
  zweiLauf,
  zweiTipp,
  WISCH_RAND_VORGABE_PX,
  WISCH_RAND_MIND_PX,
  WISCH_RAND_HOECHST_PX,
  WISCH_ZUG_PX,
  WISCH_SPRUNG_ANTEIL,
  WISCH_RAENDER,
  WISCH_TATEN,
  WISCH_HAND_PX,
  ZWEI_MIND_PX,
  ZWEI_TIPP_MS,
  ZWEI_TIPP_PX,
} = (() => {
  // ERST NEU ZIEHEN, DANN PRUEFEN. Ein Auszug, der von Hand erneuert werden
  // muss, ist beim naechsten Mal veraltet — und dann prueft dieser Lauf eine
  // Fassung, die es nicht mehr gibt, und meldet gruen (llmwiki
  // veraltete-vorschau-meldet-falsches-rot).
  execFileSync('python3', ['tools/neu-regeln-auszug.py'], { stdio: 'ignore' })
  delete require.cache[require.resolve('./neu-regelnfns-auszug.js')]
  return require('./neu-regelnfns-auszug.js')
})()

let fehler = 0
const p = (ist, soll, was) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll)
  if (!ok) fehler++
  console.log(
    `${ok ? 'ok  ' : 'FEHL'} ${was}: ${JSON.stringify(ist)}${ok ? '' : ' erwartet ' + JSON.stringify(soll)}`,
  )
}

console.log('── boxnameTeilen ──────────────────────────────────────────')
// DER REGELFALL, und der einzige, der heute auf der Box vorkommt.
p(boxnameTeilen('MixPiBox'), { oben: 'MixPi', unten: 'Box' }, 'MixPiBox')
// DIE ANDERE SORTE, und der Grund, warum es diese Regel ueberhaupt gibt: Wer
// hart nach sechs Zeichen teilte, bekaeme hier „MixPiZ" / „wei".
p(boxnameTeilen('MixPiZwei'), { oben: 'MixPiZwei', unten: '' }, 'ohne Box am Ende bleibt einzeilig')
// Gross- und Kleinschreibung entscheiden ueber das ERKENNEN, nicht ueber die
// Ausgabe: was dasteht, ist der eingetragene Name, Zeichen fuer Zeichen.
p(boxnameTeilen('mupibox'), { oben: 'mupi', unten: 'box' }, 'klein geschrieben')
p(boxnameTeilen('MixPiBOX'), { oben: 'MixPi', unten: 'BOX' }, 'BOX in Versalien')
// Ein Leerzeichen vor „Box" gehoert nicht in die erste Zeile.
p(boxnameTeilen('MixPi Box'), { oben: 'MixPi', unten: 'Box' }, 'mit Leerzeichen davor')
p(boxnameTeilen('  MixPiBox  '), { oben: 'MixPi', unten: 'Box' }, 'aussen beschnitten')
// „Box" ALLEIN wird nicht geteilt — uebrig bliebe eine leere erste Zeile.
p(boxnameTeilen('Box'), { oben: 'Box', unten: '' }, 'nur „Box"')
p(boxnameTeilen('   Box   '), { oben: 'Box', unten: '' }, 'nur „Box", mit Rand')
// Kuerzer als das Wortende: `slice(0, -3)` gibt hier eine leere Zeichenkette.
p(boxnameTeilen('Bo'), { oben: 'Bo', unten: '' }, 'kuerzer als „Box"')
p(boxnameTeilen('Boxbox'), { oben: 'Box', unten: 'box' }, 'zweimal Box')
// KEIN NAME heisst: nichts setzen. Der Aufrufer laesst dann den Rueckfall aus
// index.html stehen, statt ein Loch in die Marke zu reissen.
p(boxnameTeilen(''), null, 'leer')
p(boxnameTeilen('   '), null, 'nur Leerzeichen')
p(boxnameTeilen(null), null, 'null')
p(boxnameTeilen(undefined), null, 'undefined')
p(boxnameTeilen(42), null, 'keine Zeichenkette')

console.log('\n── naechsterRueckweg ──────────────────────────────────────')
const NICHTS = {
  ichFenster: false,
  eltern: false,
  appBuehne: false,
  schubladeOffen: false,
  albumGross: false,
  grosserPlayer: false,
  titelListe: false,
  lane: false,
  interpretSeite: false,
  regal: false,
}
const mit = (...an) => ({ ...NICHTS, ...Object.fromEntries(an.map((a) => [a, true])) })

// DIE STARTSEITE IST DIE FRAGE, an der sich der Knopf entscheidet: Dort gibt
// es nichts, wohin — und `null` ist das, was ihn ausgraut, statt ihn
// verschwinden zu lassen.
p(naechsterRueckweg(NICHTS), null, 'Startseite: nichts, wohin')
p(naechsterRueckweg(null), null, 'ohne Lage')

p(naechsterRueckweg(mit('regal')), 'regal', 'nur das Regal')
p(naechsterRueckweg(mit('interpretSeite')), 'interpret', 'nur die Interpretenseite')
p(naechsterRueckweg(mit('lane')), 'lane', 'nur eine Lane')
p(naechsterRueckweg(mit('titelListe')), 'titelliste', 'nur eine Titelliste')
p(naechsterRueckweg(mit('grosserPlayer')), 'player', 'nur der grosse Player')
p(naechsterRueckweg(mit('albumGross')), 'album-gross', 'nur die grosse Albumansicht')
p(naechsterRueckweg(mit('eltern')), 'eltern', 'nur der Eltern-Bereich')
p(naechsterRueckweg(mit('ichFenster')), 'ich', 'nur die Auswahl „wer hoert"')

// ── DIE SCHUBLADE UND IHRE BUEHNE (03.09.2026) ──────────────────────────
// ZWEI EBENEN, UND DIE REIHENFOLGE IST DER GANZE PUNKT: Die Buehne einer App
// liegt mit z-index 8 ueber der Schublade (7). Faellt die Reihenfolge falsch
// aus, raeumt der erste Tipp die Schublade weg — hinter der Buehne, wo sie
// niemand sieht — und die Buehne bleibt stehen. Am Schirm sieht das aus, als
// haette der Rueckweg gar nichts getan.
p(naechsterRueckweg(mit('schubladeOffen')), 'schublade', 'nur die offene Schublade')
p(naechsterRueckweg(mit('appBuehne')), 'app-buehne', 'nur die Buehne einer App')
p(
  naechsterRueckweg(mit('appBuehne', 'schubladeOffen')),
  'app-buehne',
  'beide offen: die Buehne geht zuerst, nicht die Schublade darunter',
)
// UND SIE STEHEN UNTER DEM ELTERN-BEREICH: Wer den aufmacht, waehrend die
// Schublade offensteht, soll ihn nicht halb dahinter zumachen.
p(
  naechsterRueckweg(mit('eltern', 'schubladeOffen')),
  'eltern',
  'Eltern-Bereich geht vor der Schublade',
)
// ABER UEBER DEM PLAYER UND DEM REGAL — die Schublade deckt sie zu.
p(
  naechsterRueckweg(mit('schubladeOffen', 'grosserPlayer', 'regal')),
  'schublade',
  'die Schublade liegt ueber Player und Regal',
)

// ── DER PLAYER VOR DEM SPIEL (04.09.2026) ───────────────────────────────
// Betreiber: „der player soll vor dem spiel oeffnen, das spiel bleibt
// dahinter". In app.css faellt die Buehne auf z-index 4, SOLANGE der grosse
// Player offen ist — ihr Rang haengt also an ihm. Diese vier Zeugen halten
// beide Lagen fest; ohne sie ist die Bedingung in `naechsterRueckweg` eine
// Zeile, die man beim naechsten Aufraeumen fuer ueberfluessig haelt.
p(
  naechsterRueckweg(mit('appBuehne', 'grosserPlayer')),
  'player',
  'Player offen: er liegt VOR dem Spiel und geht zuerst',
)
p(
  naechsterRueckweg(mit('appBuehne')),
  'app-buehne',
  'ohne Player bleibt die Buehne oben',
)
p(
  naechsterRueckweg(mit('appBuehne', 'schubladeOffen')),
  'app-buehne',
  'ohne Player auch vor der Schublade',
)
p(
  naechsterRueckweg(mit('appBuehne', 'schubladeOffen', 'grosserPlayer')),
  'schublade',
  'mit Player faellt die Buehne unter die Schublade',
)

// DIE AUSWAHL „WER HOERT" LIEGT UEBER ALLEM (05.08.2026). Sie hat z-index 8
// wie der Eltern-Bereich; welche der beiden der Rueckweg schliesst, entscheidet
// AUSSCHLIESSLICH diese Reihenfolge. Faellt sie falsch aus, macht ein Tipp den
// Eltern-Bereich zu, WAEHREND die Auswahl noch darauf liegt.
//
// DIE BEGRUENDUNG DAHINTER HAT SICH AM 06.08.2026 GEDREHT, und die Zeile bleibt
// trotzdem stehen. HIER STAND: „und der Schirm sieht dabei richtig aus, weil
// die Auswahl ihn ohnehin verdeckt". SIE VERDECKT IHN NICHT MEHR — seit der
// Eltern-Bereich eine SEITE ist, gewinnt bei gleicher Stufe der spaetere im
// Baum, und das ist `#eltern` (index.html:750 gegen 199). Gemessen ging das
// Fenster HINTER dem Bereich auf: das Blatt lag bei 168,8 / 464x464, der Punkt
// mitten darin traf `div.fach-zeile`, und der Rueckweg raeumte beim ERSTEN
// Tipp etwas weg, das niemand sah.
//
// GEBAUT IST DIE LOESUNG AN DER ANDEREN STELLE: `eltern.auf()` legt das Zeichen
// „wer hoert" still (`#ich.disabled = true`) und schliesst ein etwa offenes
// Fenster. Die Lage `ichFenster && eltern` kann damit gar nicht mehr
// entstehen. DIESE ZEILEN BLEIBEN ALS ZWEITER RIEGEL: wer den ersten eines
// Tages entfernt, bekommt wenigstens keinen Rueckweg, der ins Leere greift.
p(naechsterRueckweg(mit('ichFenster', 'eltern')), 'ich', 'Auswahl vor dem Eltern-Bereich')
p(
  naechsterRueckweg(mit('ichFenster', 'eltern', 'albumGross', 'grosserPlayer', 'lane')),
  'ich',
  'Auswahl vor allem anderen',
)

// DER ELTERN-BEREICH LIEGT UEBER ALLEM (04.08.2026). Stuende er weiter unten
// in der Kette, schloesse ein Tipp auf den Rueckweg etwas, das gerade niemand
// SIEHT — und der Eltern-Bereich bliebe stehen. Das ist genau der Fehler,
// gegen den diese Regel geschrieben wurde, und er waere hier besonders teuer:
// dahinter liegen die Einstellungen.
//
// „ER DECKT DIE GANZE SEITE AB" STAND HIER UND STIMMT SEIT DEM 06.08.2026
// NICHT MEHR: Er beginnt bei x 88 und laesst die Kategorienleiste und das
// Kissen des Mini-Players frei (Betreiber: „ich finde den entwurf gut wo nicht
// alles zu gedeckt ist"). FUER DIESE REGEL AENDERT DAS NICHTS, und genau
// deshalb steht es hier: Leiste und Kissen sind keine EBENEN, die ein Rueckweg
// schliessen koennte — sie stehen daneben, nicht darueber. Wer den Satz beim
// Lesen fuer eine Begruendung haelt, plant sonst mit einer Deckung, die es
// nicht mehr gibt.
p(naechsterRueckweg(mit('eltern', 'albumGross')), 'eltern', 'Eltern-Bereich vor der Albumansicht')
p(
  naechsterRueckweg(mit('eltern', 'albumGross', 'grosserPlayer', 'titelListe', 'lane', 'interpretSeite', 'regal')),
  'eltern',
  'Eltern-Bereich vor allem anderen',
)

// DIE REIHENFOLGE IST DER GANZE WITZ, und jede dieser Zeilen ist ein Fall, den
// es auf der Box wirklich gibt.
//
// Playlist aufgeklappt, darin ein Album aufgeklappt: der Rueckweg schliesst
// die TITELLISTE, nicht die Alben darueber. Andersherum verschwaende ein Tipp
// zwei Ebenen auf einmal.
p(naechsterRueckweg(mit('lane', 'titelListe')), 'titelliste', 'Lane + Titelliste')
// Aus der Lane heraus etwas gestartet und den Player aufgemacht: der Player
// liegt DARUEBER, also geht er zuerst.
p(naechsterRueckweg(mit('lane', 'titelListe', 'grosserPlayer')), 'player', 'Player ueber allem')
// Und im Player aufs Cover getippt: die grosse Albumansicht liegt noch darauf.
p(
  naechsterRueckweg(mit('lane', 'titelListe', 'grosserPlayer', 'albumGross')),
  'album-gross',
  'grosse Albumansicht ganz oben',
)
// Die Interpretenseite ERSETZT das Raster, das Regal bleibt darunter gesetzt:
// erst die Seite verlassen, dann das Regal.
p(naechsterRueckweg(mit('regal', 'interpretSeite')), 'interpret', 'Interpretenseite vor Regal')
// Auf der Interpretenseite kann ebenfalls eine Titelliste offen stehen (sie
// haengt dort in einer `.int-reihe`). Sie geht zuerst.
p(naechsterRueckweg(mit('interpretSeite', 'titelListe')), 'titelliste', 'Titelliste auf der Interpretenseite')
// Und der vollstaendige Stapel, von oben nach unten abgeraeumt.
const stapel = ['ich', 'eltern', 'album-gross', 'player', 'titelliste', 'lane', 'interpret', 'regal']
const alles = { ichFenster: true, eltern: true, albumGross: true, grosserPlayer: true, titelListe: true, lane: true, interpretSeite: true, regal: true }
const felder = { ich: 'ichFenster', eltern: 'eltern', 'album-gross': 'albumGross', player: 'grosserPlayer', titelliste: 'titelListe', lane: 'lane', interpret: 'interpretSeite', regal: 'regal' }
const gelaufen = []
const rest = { ...alles }
for (let i = 0; i < stapel.length + 1; i++) {
  const w = naechsterRueckweg(rest)
  if (w === null) break
  gelaufen.push(w)
  rest[felder[w]] = false
}
p(gelaufen, stapel, 'alles offen: Ebene fuer Ebene von oben')
p(naechsterRueckweg(rest), null, 'danach ist nichts mehr offen')

console.log('\n── fassungBeschriften ─────────────────────────────────────')
// DER REGELFALL an der Box (03.08.2026 gemessen): 103 eigene Commits, sauber.
p(fassungBeschriften({ eigeneCommits: 103, commit: 'd95f86e1234567890', unsauber: 0 }), '103 · d95f86e', 'sauberer Bau')
// DER FALL, DER BEIM GEGENLESEN FEHLTE: aus einem geaenderten Baum gebaut. Der
// Commit beschreibt den Stand dann NICHT mehr — das Plus sagt es.
p(fassungBeschriften({ eigeneCommits: 103, commit: 'd95f86e1234567890', unsauber: 4 }), '103 · d95f86e+', 'unsauberer Bau bekommt ein Plus')
// Ein einziger Nachtrag reicht — die Zahl ist gleichgueltig, das Ja/Nein zaehlt.
p(fassungBeschriften({ eigeneCommits: 1, commit: 'abcdefg0000', unsauber: 1 }), '1 · abcdefg+', 'eine geaenderte Datei genuegt')
// Ohne Commit haengt das Plus an der Zahl — sonst fiele der Hinweis
// ausgerechnet dort weg, wo ohnehin schon weniger dasteht.
p(fassungBeschriften({ eigeneCommits: 103, commit: '', unsauber: 2 }), '103+', 'ohne Commit haengt das Plus an der Zahl')
// EIN BAU DIREKT AUF DER QUELLE hat keine eigenen Commits — dann steht nur der
// Commit da, nicht „0 ·".
p(fassungBeschriften({ eigeneCommits: 0, commit: 'abcdefg0000', unsauber: 0 }), 'abcdefg', 'ohne eigene Commits nur der Commit')
// UND WENN NICHTS DA IST, BLEIBT DIE ZEILE LEER. Ein Wort, das nichts sagt,
// kostet denselben Platz wie die Angabe.
p(fassungBeschriften({ eigeneCommits: 0, commit: '', unsauber: 0 }), '', 'nichts zu melden')
p(fassungBeschriften(null), '', 'keine Herkunft')
p(fassungBeschriften(undefined), '', 'gar nichts')
// Was der Server nicht fuehrt, darf nicht als „unsauber" gelten: `unsauber`
// ist optional (aktualisierung.ts), eine aeltere Box schickt es gar nicht.
p(fassungBeschriften({ eigeneCommits: 103, commit: 'd95f86e1234567890' }), '103 · d95f86e', 'ohne das Feld unsauber kein Plus')

console.log('\n── sperrModus ─────────────────────────────────────────────')
// DIE VIER, die es auf einer Box wirklich gibt.
p(sperrModus('pin'), 'pin', 'pin')
p(sperrModus('rechnen'), 'rechnen', 'rechnen')
p(sperrModus('geste'), 'geste', 'geste')
p(sperrModus('aus'), 'aus', 'aus')
// Gross-/Kleinschreibung und Leerzeichen kommen aus einer von Hand
// bearbeiteten Konfigurationsdatei — dort steht irgendwann „PIN " statt „pin".
p(sperrModus('PIN'), 'pin', 'PIN in Versalien')
p(sperrModus('  Rechnen  '), 'rechnen', 'mit Rand und gross')
p(sperrModus(' GESTE '), 'geste', 'Geste mit Rand und gross')
// ══ DIE VORGABE IST SEIT DEM 06.08.2026 „rechnen" ═══════════════════════════
//
// DIESE ZEILEN SIND DER GANZE AUFTRAG „eine frische Box darf nicht offen
// stehen". Vorher stand hier „aus", und damit stand jede Box ohne diesen
// Schluessel offen — an der Box .169 fehlte er nachweislich. Hinter dem
// Eltern-Bereich liegen WLAN, Bluetooth, die rohe Mediendatenbank samt
// Loeschknoepfen und das Herunterfahren.
//
// „aus" BEKOMMT NUR, WER „aus" HINSCHREIBT. Ein fehlender, leerer oder
// unbekannter Wert ist keine Entscheidung fuer „offen", sondern eine fehlende
// Entscheidung — und eine fehlende Entscheidung darf nicht die schwaechste
// sein.
p(sperrModus(undefined), 'rechnen', 'Feld fehlt')
p(sperrModus(null), 'rechnen', 'null')
p(sperrModus(''), 'rechnen', 'leer')
p(sperrModus('an'), 'rechnen', 'ein Wort, das es nicht gibt')
p(sperrModus(42), 'rechnen', 'keine Zeichenkette')
p(sperrModus({}), 'rechnen', 'ein Objekt')
// DIE ZWEITE HAELFTE DES VERTRAGS GILT WEITER, sie steht nur woanders: Der
// Fall „Konfiguration GAR NICHT lesbar" wird in `eltern.auf()` in seinem
// eigenen `catch` auf „aus" gesetzt und kommt hier nie vorbei. Diese Regel
// sieht nur GELESENE Konfigurationen. Und selbst wenn beides zusammenfiele,
// waere „rechnen" ungefaehrlich — die Rechenaufgabe entsteht und wird geprueft
// ohne Netz, ein Backend im Hochfahren sperrt damit niemanden aus.
//
// DIE GEGENPROBE ZUR VORGABE: sie darf NICHT „pin" sein. „pin" ohne
// hinterlegte PIN sperrt aus, statt aufzufallen — das Backend vergleicht gegen
// einen leeren Hash und sagt auf jede Eingabe nein. Ausgerechnet das WLAN, mit
// dem man die Box wieder aufmachen muesste, laege dann dahinter.
p(sperrModus(undefined) === 'pin', false, 'die Vorgabe ist NICHT pin')
// Und auch nicht „geste": eine Geste, die niemand eingerichtet hat, steht
// nirgends auf dem Schirm — auf einer frischen Box waere sie eine Aussperrung
// mit Ansage. Sie ist eine Wahl, keine Vorgabe.
p(sperrModus(undefined) === 'geste', false, 'die Vorgabe ist NICHT geste')
// KEINE TEILTREFFER. „pinnwand" darf nicht zu „pin" werden — sonst stuende ein
// Ziffernfeld vor einer Box, fuer die niemand eine PIN gesetzt hat.
p(sperrModus('pinnwand'), 'rechnen', 'kein Teiltreffer')
p(sperrModus('gestern'), 'rechnen', 'kein Teiltreffer bei der Geste')

console.log('\n── gesteEcke ──────────────────────────────────────────────')
// DIE ECHTE FLAECHE DES TORS. Sie ist am 06.08.2026 kleiner geworden: der
// Eltern-Bereich ist eine SEITE (88 px gehen an die Kategorienleiste) und
// haelt unten 94 px fuer das eingefahrene Kissen frei — aus 768 x 386 wurden
// 680 x 296. UND DIE ECKE FOLGT DIESER FLAECHE, statt eine feste Zahl zu
// sein: `gesteEckeKante` in app.js. Wer hier 120 stehen liesse, pruefte eine
// Kante, die es nicht mehr gibt.
const TB = 680
const TH = 296
const EK = gesteEckeKante(TB, TH)
// DIE VIER ECKEN, im Uhrzeigersinn. Die Reihenfolge der Nummern IST die
// Reihenfolge der Geste — vertauscht man sie hier, dreht sich die Geste um,
// ohne dass sonst etwas auffiele.
p(gesteEcke(0, 0, TB, TH, EK), 0, 'genau links oben')
p(gesteEcke(TB - 1, 0, TB, TH, EK), 1, 'genau rechts oben')
p(gesteEcke(TB - 1, TH - 1, TB, TH, EK), 2, 'genau rechts unten')
p(gesteEcke(0, TH - 1, TB, TH, EK), 3, 'genau links unten')
// DIE INNENKANTE. Ein Bildpunkt vor der Kante ist noch drin, auf der Kante
// schon draussen — diese beiden Zeilen halten die Groesse des Ziels fest,
// egal welche Zahl `gesteEckeKante` gerade liefert.
p(gesteEcke(EK - 1, EK - 1, TB, TH, EK), 0, 'die letzte Zeile der Ecke')
p(gesteEcke(EK, EK, TB, TH, EK), -1, 'ein Bildpunkt daneben ist keine Ecke')
// DIE MITTE IST KEINE ECKE, und das ist der Kern von Bedingung 1: Ein Kind
// tippt in die Mitte, und jede Beruehrung ausserhalb aller Ecken setzt die
// Folge zurueck.
p(gesteEcke(TB / 2, TH / 2, TB, TH, EK), -1, 'die Mitte')
p(gesteEcke(TB / 2, 4, TB, TH, EK), -1, 'oben in der Mitte')
p(gesteEcke(4, TH / 2, TB, TH, EK), -1, 'links in der Mitte')
// AUSSERHALB DER FLAECHE. Kommt vor: `getBoundingClientRect` und der Zeiger
// koennen sich um einen Bildpunkt unterscheiden, und ein negativer Wert darf
// nicht als „links oben" durchgehen.
p(gesteEcke(-1, 5, TB, TH, EK), -1, 'links daneben')
p(gesteEcke(5, -1, TB, TH, EK), -1, 'darueber')
p(gesteEcke(TB, 5, TB, TH, EK), -1, 'rechts daneben')
p(gesteEcke(5, TH, TB, TH, EK), -1, 'darunter')
// EINE FLAECHE OHNE MASSE gibt es: das Tor ist `hidden`, und dann meldet
// `getBoundingClientRect` 0 x 0. Ohne diesen Riegel laege JEDER Punkt in allen
// vier Ecken gleichzeitig — die Geste ginge mit vier Tipps irgendwohin auf.
p(gesteEcke(0, 0, 0, 0, EK), -1, 'eine Flaeche ohne Groesse')
p(gesteEcke(0, 0, TB, 0, EK), -1, 'ohne Hoehe')
// DIE KANTE WIRD GEDECKELT. Auf einer schmalen Flaeche ueberlappten sich sonst
// zwei Ecken, und ein Punkt laege in zweien — dann gaebe die Reihenfolge des
// Vergleichs den Ausschlag, und das waere eine Regel, die niemand
// hingeschrieben hat.
p(gesteEcke(50, 10, 100, 100, 999), 1, 'gedeckelt: rechte Haelfte ist rechts')
p(gesteEcke(49, 10, 100, 100, 999), 0, 'gedeckelt: linke Haelfte ist links')

console.log('\n── gesteEckeKante ─────────────────────────────────────────')
// DIE ECKE FOLGT DER FLAECHE — seit dem 06.08.2026, und aus einem gemessenen
// Grund: Der Eltern-Bereich wurde eine SEITE, das Tor schrumpfte von 768x390
// auf 680x296, und die feste Kante von 120 px deckte damit 30 statt 20 Prozent
// der Flaeche. Ein zufaelliger Tipp traf die jeweils richtige Ecke mit 1 : 13
// statt 1 : 20 (tools/eltern-tor-schau.mjs, das die Kante an der WIRKUNG
// tastet). Niemand hatte eine Zeile an der Geste angefasst.
//
// DIE REGEL IST DER ANTEIL, NICHT DIE KANTE: vier Ecken decken hoechstens ein
// Fuenftel. Diese Zeile ist der Waechter dafuer — sie rechnet den Anteil aus
// dem zurueck, was die Funktion liefert.
const anteil = (b, h) => (4 * gesteEckeKante(b, h) ** 2) / (b * h)
p(anteil(680, 296) <= GESTE_ECKE_ANTEIL + 1e-9, true, 'heutiges Tor: hoechstens ein Fuenftel')
p(anteil(768, 390) <= GESTE_ECKE_ANTEIL + 1e-9, true, 'das alte, groessere Tor ebenfalls')
// DIE OBERGRENZE. Auf einer grossen Flaeche waechst die Ecke nicht mit ins
// Uferlose — mehr als 120 px braucht kein Finger, und eine Ecke von einem
// Viertel des Schirms sieht aus wie eine Flaeche und nicht wie eine Ecke.
p(gesteEckeKante(4000, 4000), GESTE_ECKE_HOECHSTENS_PX, 'gross: gedeckelt bei der Obergrenze')
// DIE UNTERGRENZE GEWINNT IM ZWEIFEL. Eine Ecke unter `--griff` (66 px =
// 9,24 mm, ISO 9241-411) traefe ein Erwachsener im Stehen nicht mehr — und
// eine Sperre, die den Berechtigten aussperrt, ist keine Sperre, sondern ein
// Aerger. Sie kostet den Anteil, und das ist die richtige Reihenfolge der
// Zugestaendnisse.
p(gesteEckeKante(200, 150), GESTE_ECKE_MINDESTENS_PX, 'sehr klein: die Untergrenze gewinnt')
p(gesteEckeKante(680, 296) >= GESTE_ECKE_MINDESTENS_PX, true, 'heutiges Tor liegt ueber der 9-mm-Marke')
// KEINE MASSE gibt es wirklich: das Tor ist `hidden`, und dann meldet
// `getBoundingClientRect` 0 x 0. Es darf keine 0 und kein NaN herauskommen —
// `gesteEcke` deckelt zwar selbst, aber eine Kante von 0 hiesse dort, dass
// jeder Punkt in gar keiner Ecke liegt, und das saehe aus wie „die Geste
// reagiert nicht".
p(gesteEckeKante(0, 0), GESTE_ECKE_MINDESTENS_PX, 'ohne Masse die Untergrenze')
p(gesteEckeKante(NaN, 100), GESTE_ECKE_MINDESTENS_PX, 'keine Zahl ebenso')
// UND SIE IST GANZZAHLIG. Ein gebrochener Wert ginge durch `gesteEcke`
// hindurch und machte aus dem Vergleich `x < k` eine Frage der Rundung.
p(Number.isInteger(gesteEckeKante(680, 296)), true, 'ganzzahlig')

console.log('\n── gesteSchritt ───────────────────────────────────────────')
// EIN DURCHLAUF, wie ihn ein Elternteil geht. `zuletzt` ist die Zeit der
// vorigen richtigen Ecke.
const F = GESTE_FENSTER_MS
p(gesteSchritt(0, 0, 1000, 0, F).stand, 1, 'erste Ecke')
p(gesteSchritt(1, 1, 1500, 1000, F).stand, 2, 'zweite Ecke')
p(gesteSchritt(2, 2, 2000, 1500, F).stand, 3, 'dritte Ecke')
p(gesteSchritt(3, 3, 2500, 2000, F).offen, true, 'die vierte macht auf')
// UND DER STAND FAELLT DABEI AUF NULL. Sonst begaenne das naechste Zusperren
// bei drei — eine einzige Ecke oeffnete den Bereich dann wieder.
p(gesteSchritt(3, 3, 2500, 2000, F).stand, 0, 'nach dem Oeffnen wieder bei null')
// VORHER MACHT NICHTS AUF. Die drei Zwischenschritte duerfen nicht „offen"
// melden — das waere eine Sperre, die nach der ersten Ecke faellt und dabei
// aussieht, als haette sie gehalten.
p(gesteSchritt(0, 0, 1000, 0, F).offen, false, 'die erste macht nicht auf')
p(gesteSchritt(2, 2, 2000, 1500, F).offen, false, 'die dritte macht nicht auf')
// ── DIE DREI RUECKSETZER, und jeder einzeln ist der Unterschied zwischen
//    einer Sperre und einer Verzierung ──────────────────────────────────────
// 1. EINE BERUEHRUNG NEBEN ALLEN ECKEN. Ohne sie koennte man sich mit Tippen
//    in der Mitte durch die Folge tasten.
p(gesteSchritt(2, -1, 2000, 1500, F).stand, 0, 'daneben setzt zurueck')
p(gesteSchritt(2, -1, 2000, 1500, F).offen, false, 'daneben macht nicht auf')
// 2. DIE FALSCHE ECKE. Ohne sie waere die Reihenfolge nur eine Empfehlung, und
//    vier Tipps in die Ecken in beliebiger Folge oeffneten den Bereich.
p(gesteSchritt(1, 3, 1500, 1000, F).stand, 0, 'falsche Ecke setzt zurueck')
p(gesteSchritt(1, 2, 1500, 1000, F).stand, 0, 'auch die uebernaechste')
// 3. ZU VIEL ZEIT. Ohne sie zaehlten vier ueber den Nachmittag verteilte
//    Zufallstreffer zusammen — genau das, was ein Kind erzeugt, das auf allem
//    herumdrueckt.
p(gesteSchritt(1, 1, 1000 + F + 1, 1000, F).stand, 0, 'eine Millisekunde zu spaet')
p(gesteSchritt(1, 1, 1000 + F, 1000, F).stand, 2, 'genau am Fenster zaehlt noch')
// EINE FALSCHE ECKE, DIE ZUFAELLIG DIE ERSTE IST, FAENGT NEU AN. Ohne diese
// Zeile braeuchte ein Elternteil, der sich vertippt, einen Leertipp dazwischen
// — und merkte nicht, warum es nicht geht. Das ist genau der zweite Versuch,
// den es mit einem quengelnden Kind auf dem Arm nicht gibt.
p(gesteSchritt(2, 0, 2000, 1500, F).stand, 1, 'Vertipper faengt bei eins neu an')
p(gesteSchritt(1, 0, 1000 + F + 1, 1000, F).stand, 1, 'auch nach Zeitablauf')
// DIE ERSTE ECKE HAT KEIN FENSTER. Bei Stand 0 gibt es keine vorige Ecke; eine
// Box, die seit Stunden laeuft, muesste sonst erst einen Blindtipp abgeben.
p(gesteSchritt(0, 0, 9e9, 0, F).stand, 1, 'die erste Ecke wartet auf niemanden')

console.log('\n── torFertig ──────────────────────────────────────────────')
// VIER BIS ACHT ZIFFERN — dieselben Grenzen, die das Backend beim SETZEN
// prueft. Ein Knopf, der bei drei schon leuchtet, verspricht eine Pruefung,
// die immer nein sagt.
p(torFertig('pin', '123'), false, 'PIN mit drei Ziffern')
p(torFertig('pin', '1234'), true, 'PIN mit vier')
p(torFertig('pin', '12345678'), true, 'PIN mit acht')
p(torFertig('pin', '123456789'), false, 'PIN mit neun')
p(torFertig('pin', ''), false, 'PIN leer')
// Bei der Rechnung genuegt EINE Ziffer: 3 x 3 = 9.
p(torFertig('rechnen', '9'), true, 'Rechnung, eine Ziffer')
p(torFertig('rechnen', ''), false, 'Rechnung leer')
// IST NICHTS GESPERRT, GIBT ES AUCH NICHTS ZU BESTAETIGEN. Ein „Weiter", das
// bei ausgeschalteter Sperre freigegeben waere, riefe eine Pruefung auf, die es
// gar nicht gibt.
p(torFertig('aus', '1234'), false, 'ohne Sperre nie fertig')
p(torFertig('aus', ''), false, 'ohne Sperre und ohne Eingabe')
p(torFertig('pin', null), false, 'null statt Eingabe')
p(torFertig('pin', undefined), false, 'undefined statt Eingabe')

console.log('\n── torWartenS ─────────────────────────────────────────────')
// ══ DIE BREMSE VOR DER RECHENAUFGABE (06.08.2026) ══════════════════════════
//
// DER BEFUND, DER SIE NOETIG MACHT (tools/kind-am-tor.mjs): Die Aufgabe war
// unbegrenzt und ohne Verzoegerung durchzuprobieren — gemessen 2,55 Versuche
// je Sekunde. Und sie muss nicht gerechnet werden: a x b mit a,b aus 3..9
// ergibt 49 gleich wahrscheinliche Paare, aber nur 26 Ergebnisse. Die 24 kommt
// viermal vor; wer immer 24 tippt, ist im Mittel beim 12. Versuch drin, also
// nach fuenf Sekunden. Gemessen ging das Tor beim zweiten Versuch auf.
//
// DER ERSTE VERSUCH IST UNVERMEIDLICH FREI — vor der ersten Antwort gibt es
// nichts zu bremsen. Der ZWEITE kostet schon: zwei freie Schuesse waeren 15,7 %
// statt 8,2 %, also fast jedes sechste Kind gleich drin, und weil der Kiosk
// taeglich neu startet, jeden Tag aufs Neue. Fuenf Sekunden merkt dagegen
// niemand, der 6 x 7 mit 48 beantwortet hat.
p(torWartenS(0), 0, 'kein Fehlversuch, keine Wartezeit')
p(torWartenS(1), 5, 'nach dem ersten Fehlgriff fuenf Sekunden')
// DANN STEIGT ES STEIL. Fuer den Erwachsenen ist das eine Grenze, die er nie
// erreicht; fuer das Kind mit seinen im Mittel 12 noetigen Versuchen sind es
// 5+15+30+60x9 = 590 Sekunden reines Warten.
p(torWartenS(2), 15, 'der zweite')
p(torWartenS(3), 30, 'der dritte')
p(torWartenS(4), 60, 'der vierte')
// DER DECKEL GILT NACH OBEN OHNE ENDE. Ohne ihn waere der 20. Fehlversuch
// wieder frei (`TOR_WARTEN_S[20]` ist `undefined`), und ein Kind muesste nur
// weit genug zaehlen — die Bremse waere genau dann weg, wenn sie gebraucht
// wird.
p(torWartenS(20), 60, 'der zwanzigste wartet genauso lang')
p(torWartenS(1000), 60, 'und der tausendste auch')
// EINE ZAHL, DIE KEINE IST, DARF NICHT ZUM FREIFAHRTSCHEIN WERDEN.
p(torWartenS(null), 0, 'null ist kein Fehlversuch')
p(torWartenS(-3), 0, 'eine negative Zahl auch nicht')
p(torWartenS('2'), 15, 'die Ziffer als Zeichenkette zaehlt mit')
// UND DIE BREMSE MUSS UEBERHAUPT EINE SEIN: waeren alle Werte 0, hielte jede
// Zeile hier oben — und das Tor waere so offen wie vorher.
p(TOR_WARTEN_S.some((s) => s > 0), true, 'es gibt ueberhaupt eine Wartezeit')
p(TOR_WARTEN_S[TOR_WARTEN_S.length - 1] >= 30, true, 'die letzte Stufe traegt')

console.log('\n── gesteWartenS ───────────────────────────────────────────')
// ══ DIE BREMSE VOR DER GESTE (06.08.2026) ══════════════════════════════════
//
// DER BEFUND: „1 : 180 000" gilt fuer gleichverteiltes Tippen. Ein Kind, das
// gemerkt hat, dass es auf die ECKEN ankommt — mehr muss es nicht gemerkt
// haben —, hat 4^4 = 256 Folgen vor sich, und jede Beruehrung ist zugleich der
// Anfang der naechsten. Gemessen (tools/kind-am-tor.mjs): in einem Lauf ging
// das Tor nach 150 Beruehrungen auf, also nach rund zwei Minuten.
//
// SECHZEHN BERUEHRUNGEN SIND FREI: die Geste braucht vier, das sind drei volle
// Fehlversuche und einer dazu. Ein Elternteil, der zweimal danebengreift und
// einmal von vorn anfaengt, merkt nichts.
p(gesteWartenS(0), 0, 'noch gar nicht getippt')
p(gesteWartenS(GESTE_ECKEN), 0, 'die Geste selbst kostet nie etwas')
p(gesteWartenS(GESTE_FREI), 0, 'die letzte freie Beruehrung ist frei')
// DANACH KOSTET JEDE VOLLE FOLGE, und zwar nach derselben Staffel wie das
// Ziffernfeld. GERECHNET WIRD IN FOLGEN, nicht in Beruehrungen: sonst zahlte
// man viermal fuer einen Versuch.
p(gesteWartenS(GESTE_FREI + 1), 0, 'die erste Beruehrung der naechsten Folge noch nicht')
p(gesteWartenS(GESTE_FREI + GESTE_ECKEN - 1), 0, 'die dritte auch noch nicht')
p(gesteWartenS(GESTE_FREI + GESTE_ECKEN), torWartenS(1), 'erst die volle Folge')
p(gesteWartenS(GESTE_FREI + 2 * GESTE_ECKEN), torWartenS(2), 'die zweite kostet mehr')
p(gesteWartenS(GESTE_FREI + 3 * GESTE_ECKEN), torWartenS(3), 'die dritte noch mehr')
// UND DER DECKEL GILT AUCH HIER OHNE ENDE — sonst waere die hundertste Folge
// wieder frei, und genau die tippt das Kind.
p(gesteWartenS(GESTE_FREI + 100 * GESTE_ECKEN) >= 30, true, 'die hundertste Folge wartet weiter')
// DIE FREIEN BERUEHRUNGEN MUESSEN FUER MEHR ALS EINEN VERSUCH REICHEN. Waere
// GESTE_FREI kleiner als zwei Folgen, bremste die Box den ersten Fehlgriff
// eines Erwachsenen — und das ist genau der, den jeder einmal tut.
p(GESTE_FREI >= 3 * GESTE_ECKEN, true, 'mindestens drei volle Folgen sind frei')
p(gesteWartenS(null), 0, 'null ist keine Beruehrung')
p(gesteWartenS(-4), 0, 'eine negative Zahl auch nicht')

console.log('\n── zifferDazu ─────────────────────────────────────────────')
p(zifferDazu('', '1', 8), '1', 'erste Ziffer')
p(zifferDazu('123', '4', 8), '1234', 'vierte Ziffer')
// DER DECKEL: ohne ihn wuechse die Eingabe ueber das, was das Backend annimmt.
p(zifferDazu('12345678', '9', 8), '12345678', 'der neunte Anschlag prallt ab')
p(zifferDazu('81', '5', 2), '81', 'Rechenantwort hat hoechstens zwei Ziffern')
// EIN FEHLGRIFF DARF NICHT LOESCHEN, was schon dasteht. Der naheliegende
// Rueckfall waere die leere Zeichenkette gewesen — dann raeumte ein
// verrutschter Finger die halb eingetippte PIN weg, und niemand saehe warum.
p(zifferDazu('12', 'a', 8), '12', 'ein Buchstabe laesst alles stehen')
p(zifferDazu('12', '', 8), '12', 'nichts laesst alles stehen')
p(zifferDazu('12', '12', 8), '12', 'zwei Ziffern auf einmal sind keine Ziffer')
p(zifferDazu('12', null, 8), '12', 'null laesst alles stehen')
p(zifferDazu(null, '7', 8), '7', 'ohne Bisheriges faengt es bei null an')
p(zifferDazu('', '0', 8), '0', 'die Null ist eine Ziffer')

console.log('\n── btZeile ────────────────────────────────────────────────')
const g = (x) => btZeile(x)
// DIE DREI SORTEN, jede mit ihrem eigenen Knopf. Waeren zwei davon gleich,
// stuende auf dem Schirm ein Knopf, der etwas anderes tut, als er sagt.
p(g({ mac: 'A', name: 'JBL', art: 'lautsprecher', verbunden: true, gekoppelt: true }).tat, 'trennen', 'verbunden -> Trennen')
p(g({ mac: 'A', name: 'JBL', art: 'lautsprecher', gekoppelt: true }).tat, 'verbinden', 'gekoppelt -> Verbinden')
p(g({ mac: 'A', name: 'JBL', art: 'lautsprecher' }).tat, 'koppeln', 'gefunden -> Koppeln')
// DER MITTLERE ZUSTAND IST DER GANZE SINN DER SEITE: „gekoppelt, aber nicht
// verbunden" ist die Lage, in der die Box stumm bleibt und niemand weiss
// warum. Er darf nicht wie „aus" aussehen — und er sagt es in Worten, nicht
// nur in Farbe.
p(g({ mac: 'A', name: 'JBL', gekoppelt: true }).unter, 'gekoppelt, nicht verbunden', 'der mittlere Zustand steht als Wort da')
p(g({ mac: 'A', name: 'JBL', gekoppelt: true }).an, false, 'gekoppelt ist nicht gruen')
p(g({ mac: 'A', name: 'JBL', verbunden: true }).an, true, 'verbunden ist gruen')
// AKKU UND CODEC KOMMEN NUR MIT, WENN SIE DA SIND. Ein „undefined %" auf dem
// Schirm ist schlimmer als eine Zeile ohne Angabe.
p(g({ mac: 'A', name: 'JBL', verbunden: true, akku: 72, codec: 'sbc' }).unter, 'verbunden · 72 % · SBC', 'mit Akku und Codec')
p(g({ mac: 'A', name: 'JBL', verbunden: true, akku: 0 }).unter, 'verbunden · 0 %', 'ein leerer Akku ist eine Angabe, keine fehlende')
// ── DIE ZEICHEN SIND SEIT DEM 07.08.2026 NAMEN UND KEINE ZEICHEN ────────────
// Hier standen 🔈 🎧 📱 •. Die Box kennt nur DejaVu und zeichnete jedes Emoji
// als leeres Rechteck; die Karte `ZEICHEN` in app.js macht aus dem Namen ein
// SVG. Was `btZeile` liefert, ist deshalb ein SCHLUESSEL.
//
// WAS DIESE FUENF ZEILEN WEITERHIN SICHERN: dass eine unbekannte Art auf
// 'geraet' faellt und NICHT auf einen Namen, den die Karte nicht kennt. Sonst
// zeigte jeder fremde Lautsprecher ein Fragezeichen und schriebe bei jedem
// Zeichnen in die Konsole. Dass die Namen ihrerseits in der Karte stehen,
// prueft python3 tools/zeichen-ohne-schrift.py.
p(g({ mac: 'A', name: 'X', art: 'lautsprecher' }).zeichen, 'lautsprecher', 'Lautsprecher')
p(g({ mac: 'A', name: 'X', art: 'kopfhoerer' }).zeichen, 'kopfhoerer', 'Kopfhoerer')
p(g({ mac: 'A', name: 'X', art: 'telefon' }).zeichen, 'telefon', 'Telefon')
p(g({ mac: 'A', name: 'X' }).zeichen, 'geraet', 'ohne Art die Bluetooth-Rune')
p(g({ mac: 'A', name: 'X', art: 'toaster' }).zeichen, 'geraet', 'unbekannte Art ebenfalls')
// OHNE NAMEN STEHT EIN WORT DA, keine Leere. Eine namenlose Zeile sieht sonst
// aus wie ein Fehler in der Oberflaeche.
p(g({ mac: 'A' }).name, 'Unbekanntes Gerät', 'ohne Namen')
p(g({}).mac, '', 'ohne MAC eine leere Kennung')
p(g(null).name, 'Unbekanntes Gerät', 'gar kein Geraet')

console.log('\n── weiterMarke ────────────────────────────────────────────')
// DER NAME SCHLAEGT DIE NUMMER (06.08.2026). Genau das ist die Aenderung: An
// einer Sendung mit dreissig Folgen erkennt ein Kind die eine, bei der es
// aufgehoert hat, am NAMEN — „Titel 17" sagt ihm nichts.
p(
  weiterMarke({ titelNr: 17, folgeTitel: 'Der Schneemann taut' }),
  { art: 'name', text: 'Der Schneemann taut' },
  'Folgenname statt Nummer',
)
// UND AUCH BEI TITEL 1, wo bisher GAR NICHTS dastand: Die Zweideutigkeit, die
// dort schweigen liess („erster Titel eines Albums ODER einziger eines
// Stuecks"), gibt es mit einem Namen nicht mehr — er benennt die Folge.
p(weiterMarke({ titelNr: 1, folgeTitel: 'Fälschung' }), { art: 'name', text: 'Fälschung' }, 'Name auch bei Folge 1')
p(weiterMarke({ titelNr: 0, folgeTitel: 'Fälschung', anteil: 0.4 }), { art: 'name', text: 'Fälschung' }, 'Name schlaegt den Balken')
// DIE NUMMER BLEIBT DER RUECKFALL — Spotify, lokal, und jede ARD-Stelle, die
// vor dem 06.08.2026 gemerkt wurde. Sie verschwindet NICHT.
p(weiterMarke({ titelNr: 4 }), { art: 'nummer', text: 'Titel 4' }, 'ohne Namen bleibt die Nummer')
p(weiterMarke({ titelNr: 1 }), null, 'Titel 1 ohne Namen sagt weiter nichts')
p(weiterMarke({ titelNr: 0, anteil: 0.62 }), { art: 'balken', anteil: 0.62 }, 'ohne Nummer weiter der Balken')
// EIN LEERER NAME IST KEIN NAME. Ohne diese Zeile stuende auf der Kachel eine
// leere Plakette — Flaeche ohne Auskunft, und die Nummer waere weg.
p(weiterMarke({ titelNr: 4, folgeTitel: '   ' }), { art: 'nummer', text: 'Titel 4' }, 'leerer Name faellt auf die Nummer zurueck')
p(weiterMarke({ titelNr: 4, folgeTitel: null }), { art: 'nummer', text: 'Titel 4' }, 'null ist kein Name')

console.log('\n── folgenBildAn ───────────────────────────────────────────')
const folgen = [{ bild: 'a.jpg' }, { bild: 'b.jpg' }, { bild: 'c.jpg' }]
// 1-BASIERT HEREIN, wie mpv es meldet. Ein Fehlgriff um eins zeigt das Cover
// der Nachbarfolge — ein Bild, das gut aussieht und nicht zum Ton gehoert.
p(folgenBildAn(folgen, 1), 'a.jpg', 'Nummer 1 ist der erste Eintrag')
p(folgenBildAn(folgen, 3), 'c.jpg', 'Nummer 3 ist der dritte')
// AUSSERHALB DER LISTE GIBT ES NICHTS. Eine zu grosse Nummer heisst gerade,
// dass hier eine ANDERE Warteschlange laeuft; jedes Bild waere dann geraten,
// und der Aufrufer faellt auf das Werkbild zurueck.
p(folgenBildAn(folgen, 4), null, 'jenseits der Liste nichts')
p(folgenBildAn(folgen, 0), null, 'die 0 ist keine Position')
p(folgenBildAn(folgen, -1), null, 'negativ ebenfalls nicht')
p(folgenBildAn(folgen, null), null, 'ohne Nummer nichts')
p(folgenBildAn(folgen, ''), null, 'leere Nummer ebenfalls')
// KEIN BILD IST KEIN LEERER STRING. Ein `src=""` laedt die SEITE neu und
// meldet dabei einen Fehler — der Aufrufer muss `null` bekommen, um auf die
// naechste Stufe zu gehen.
p(folgenBildAn([{ bild: '' }], 1), null, 'leeres Bild zaehlt nicht')
p(folgenBildAn([{}], 1), null, 'Eintrag ohne Bild')
p(folgenBildAn(null, 1), null, 'gar keine Liste')
p(folgenBildAn([], 1), null, 'leere Liste')

console.log('\n── folgenNameAn ───────────────────────────────────────────')
// DIESELBE ZAEHLWEISE WIE BEIM BILD, und das ist der Kern von F1: Bild und
// Name muessen aus DERSELBEN Zeile derselben Liste kommen. Waeren die beiden
// Regeln verschieden 1-basiert, saehe man genau wieder das, was repariert
// werden sollte — Cover von N unter dem Namen von N-1.
const namen = [{ titel: 'Fälschung' }, { titel: 'Zu Besuch' }, { titel: 'Der Zauberer' }]
p(folgenNameAn(namen, 1), 'Fälschung', 'Nummer 1 ist der erste Eintrag')
p(folgenNameAn(namen, 3), 'Der Zauberer', 'Nummer 3 ist der dritte')
p(folgenNameAn(namen, 4), null, 'jenseits der Liste nichts')
p(folgenNameAn(namen, 0), null, 'die 0 ist keine Position')
p(folgenNameAn(namen, -1), null, 'negativ ebenfalls nicht')
p(folgenNameAn(namen, null), null, 'ohne Nummer nichts')
p(folgenNameAn(namen, ''), null, 'leere Nummer ebenfalls')
p(folgenNameAn(null, 1), null, 'gar keine Liste')
p(folgenNameAn([], 1), null, 'leere Liste')
// EIN LEERER NAME IST KEIN NAME. Kaeme '' durch, loeschte der Aufrufer die
// Titelzeile — und eine leere Titelzeile liest sich als „es laeuft nichts",
// waehrend Ton aus dem Lautsprecher kommt. Der gemeldete Name ist in diesem
// Fall die bessere Auskunft, auch wenn er alt ist.
p(folgenNameAn([{ titel: '' }], 1), null, 'leerer Name zaehlt nicht')
p(folgenNameAn([{ titel: '   ' }], 1), null, 'nur Leerzeichen ebenfalls nicht')
p(folgenNameAn([{}], 1), null, 'Eintrag ohne Namen')
p(folgenNameAn([{ titel: 42 }], 1), null, 'eine Zahl ist kein Name')
// LEERRAUM AUSSEN WEG, INNEN NICHT. Ein Name, der mit Leerzeichen anfaengt,
// rueckt die Titelzeile sichtbar ein.
p(folgenNameAn([{ titel: '  Zu Besuch  ' }], 1), 'Zu Besuch', 'aussen gekuerzt')

console.log('\n── folgeKennung ───────────────────────────────────────────')
// DIE FORM IST DER VERTRAG. Dieselbe Zeichenkette entsteht an ZWEI Orten — an
// der Kachel (`titelListeBauen`) und beim Laufenden (`laufendeKennungen`) —,
// und sie treffen sich nur, wenn beide Seiten sie gleich bauen. Waeren die
// Trennzeichen verschieden, faende `spieltMarkieren` nie etwas und die Marke
// fehlte still.
p(folgeKennung('ard:69106028', { id: '16805831' }), 'folge|ard:69106028|16805831', 'Schluessel und Folgenkennung')
// AM GERAET NACHGESEHEN (05.08.2026, Box .169): Jellyfin gibt seine Item-
// Kennung ebenfalls als `id`. Derselbe Weg, kein zweiter Fall.
p(folgeKennung('jellyfin:7d9a', { id: '88b86aa1' }), 'folge|jellyfin:7d9a|88b86aa1', 'Jellyfin geht denselben Weg')
// EINE ZAHL IST EINE KENNUNG. JSON traegt Folgenkennungen mal als Text, mal
// als Zahl; wer nur `typeof === 'string'` prueft, verliert die halbe
// Audiothek — und zwar lautlos.
p(folgeKennung('ard:1', { id: 16805831 }), 'folge|ard:1|16805831', 'eine Zahl zaehlt auch')
// EINE HALBE KENNUNG DARF NIE ENTSTEHEN. Ohne diese Zeilen waere
// `folge|ard:1|` gleich `folge|ard:1|` einer ANDEREN Folge ohne Kennung — die
// Marke saesse auf der ersten davon.
p(folgeKennung('ard:1', {}), '', 'ohne Kennung nichts')
p(folgeKennung('ard:1', { id: '' }), '', 'leere Kennung zaehlt nicht')
p(folgeKennung('ard:1', null), '', 'gar kein Eintrag')
p(folgeKennung('', { id: '16805831' }), '', 'ohne Schluessel nichts')
p(folgeKennung(null, { id: '16805831' }), '', 'null ist kein Schluessel')
// EIN SPOTIFY-TITEL HAT KEINE `id` — er faellt hier heraus und bekommt seine
// `stueck|…`-Kennung. Das ist die Weiche zwischen den beiden Maschinen, und
// sie steht genau hier.
p(folgeKennung('spotify:1DY', { uri: 'spotify:track:0G7' }), '', 'ein Spotify-Titel faellt heraus')

console.log('\n── ichBildPfad ────────────────────────────────────────────')
// DER LEERFALL IST DER GANZE SINN DIESER REGEL. Der Server sagt bei einem
// Kind, das sich noch nichts ausgesucht hat, LEER (`OHNE_FIGUR`) — und
// „kein Bild gewaehlt" heisst NICHT „kein Bild zeigen". Was dann zu sehen
// ist, entscheidet die Oberflaeche, weil nur sie weiss, dass das
// Standardbild mit ausgeliefert wurde. Faellt diese Zeile weg, steht oben
// links eine Silhouette, und die sieht aus wie „das Bild laedt nicht".
p(ichBildPfad('', 'bilder/figuren'), 'bilder/mixpi-hoert.png', 'ohne Wahl das Standardbild')
p(ichBildPfad(null, 'bilder/figuren'), 'bilder/mixpi-hoert.png', 'null ist auch keine Wahl')
p(ichBildPfad(undefined, 'bilder/figuren'), 'bilder/mixpi-hoert.png', 'undefined ebenso')
p(ichBildPfad(0, 'bilder/figuren'), 'bilder/mixpi-hoert.png', 'keine Zeichenkette')
// DIE VORGABE LIEGT NICHT IM FIGURENORDNER, und das ist keine Kosmetik:
// `bilder/figuren/mixpi-hoert.png` gibt es nicht (llmwiki
// vorgabewert-ueberlebt-den-umzug-seines-ordners). Ein Vorgabewert, der durch
// den Ordner laeuft, ergibt eine 404 — und die sieht wieder wie dieselbe
// Silhouette aus.
p(ichBildPfad('', 'bilder/figuren').includes('/figuren/'), false, 'die Vorgabe geht NICHT durch den Figurenordner')
// EINE GEWAEHLTE FIGUR GEHT SEHR WOHL DURCH DEN ORDNER — und zwar durch den,
// den der SERVER genannt hat. Zwei geschriebene Fassungen desselben Pfades
// waren an dieser Box schon einmal der Fehler.
p(ichBildPfad('mixpi-brille.png', 'bilder/figuren'), 'bilder/figuren/mixpi-brille.png', 'die gewaehlte Figur')
p(ichBildPfad('mixpi-brille.png', 'neu/anders'), 'neu/anders/mixpi-brille.png', 'der Ordner kommt vom Server')
// OHNE ANTWORT VOM SERVER trotzdem ein brauchbarer Pfad: `GET /api/figuren`
// kann ausbleiben, und dann darf die Wahl des Kindes nicht in „/" enden.
p(ichBildPfad('mixpi-brille.png', ''), 'bilder/figuren/mixpi-brille.png', 'ohne Ordner der Rueckfall')
p(ichBildPfad('mixpi-brille.png', null), 'bilder/figuren/mixpi-brille.png', 'null-Ordner ebenso')

// ══════════════════════════════════════════════════════════════════════════
//  DIE GEMEINSAME FREIGABE
// ══════════════════════════════════════════════════════════════════════════
//
// SIE IST DIE EINZIGE REGEL DIESER DATEI, DIE ZWEI OBERFLAECHEN BINDET. Ein
// Eintrag, den die eine fuer gueltig haelt und die andere nicht, ergibt genau
// den Fehler, der am 06.08.2026 gemeldet wurde („beim eingeben kömmt 2 mal die
// aufgabe") — und er saehe wie „nicht ausgeliefert" aus.
console.log('\n── freigabeNochGueltig ────────────────────────────────────')
const FD = 120_000
p(freigabeNochGueltig('1000', 1000, FD), true, 'ein frischer Zeitpunkt gilt')
p(freigabeNochGueltig('1000', 1000 + FD - 1, FD), true, 'eine Millisekunde vor Schluss gilt noch')
// DIE GRENZE GEHOERT FESTGENAGELT: `<` und `<=` sehen im Quelltext gleich aus
// und unterscheiden sich um genau den Fall, der spaeter gemeldet wird.
p(freigabeNochGueltig('1000', 1000 + FD, FD), false, 'genau am Ende gilt sie NICHT mehr')
p(freigabeNochGueltig('1000', 1000 + FD + 1, FD), false, 'danach erst recht nicht')
// EIN ZEITPUNKT AUS DER ZUKUNFT IST KEIN GUELTIGER, SONDERN EIN UNBRAUCHBARER.
// Die Box holt sich ihre Uhrzeit per NTP und kann sie dabei um Stunden
// verstellen; ohne `alter >= 0` wuerden aus zwei Minuten „bis die Uhr wieder
// eingeholt hat".
p(freigabeNochGueltig('50000', 1000, FD), false, 'ein Zeitpunkt aus der Zukunft gilt nicht')
// WAS AUS DEM SPEICHER KOMMT, IST KEINE ZAHL, SONDERN TEXT — und Text aus
// einem Speicher ist nichts, worauf man ungeprueft rechnet.
p(freigabeNochGueltig(null, 1000, FD), false, 'nichts gilt nicht')
p(freigabeNochGueltig('', 1000, FD), false, 'leer gilt nicht')
// `Number('')` IST 0: ein leerer Eintrag duerfte niemals als „Zeitpunkt 0"
// durchgehen und dann an der Frist scheitern statt an der Form. Bei `jetzt=0`
// faellt der Unterschied auf.
p(freigabeNochGueltig('', 0, FD), false, 'leer ist auch kein Zeitpunkt 0')
p(freigabeNochGueltig('   ', 1000, FD), false, 'Leerzeichen gelten nicht')
p(freigabeNochGueltig('ja', 1000, FD), false, 'Unfug gilt nicht')
p(freigabeNochGueltig('-1', 1000, FD), false, 'eine negative Zahl gilt nicht')
p(freigabeNochGueltig('1e3', 1000, FD), false, 'Exponentialschreibweise gilt nicht')
p(freigabeNochGueltig('12.5', 1000, FD), false, 'Kommazahlen gelten nicht')
// OHNE DAUER GIBT ES KEINE FREIGABE. Das ist der Fall „freigabe.json war nicht
// zu lesen": dann kostet der Weg ein Tor zu viel — nie eines zu wenig.
p(freigabeNochGueltig('1000', 1000, 0), false, 'ohne Dauer gilt nichts')
p(freigabeNochGueltig('1000', 1000, undefined), false, 'ohne Dauerangabe gilt nichts')

// ── UND DER NAME STEHT AN GENAU EINEM ORT ─────────────────────────────────
//
// WOFUER: An dieser Naht ist [[drei-orte-eine-anzeige]] schon zweimal
// gebrochen — `RUECKWEG` in rueckweg.ts gegen die Zeichenkette in app.js, und
// `mupibox_neu_licht_v1` in index.html gegen app.js. Beide Male stand sogar im
// Kommentar, dass es zwei Orte sind. Ein abgeschriebener Schluesselname faellt
// nicht auf: die Freigabe wird dann geschrieben und nie gefunden, und das
// Symptom ist „es kommt wieder zweimal die Aufgabe" — ununterscheidbar von
// „nicht ausgeliefert".
console.log('\n── der Name der Freigabe steht an EINEM Ort ───────────────')
{
  const fs = require('node:fs')
  const regel = JSON.parse(fs.readFileSync('NewDesign/freigabe.json', 'utf8'))
  p(typeof regel.schluessel === 'string' && regel.schluessel.length > 0, true, 'freigabe.json nennt einen Schluessel')
  p(typeof regel.dauerMs === 'number' && regel.dauerMs > 0, true, 'freigabe.json nennt eine Dauer')
  // DURCHSUCHT WERDEN DIE QUELLEN, NICHT DER BAU: `www/` ist ein Erzeugnis und
  // enthaelt den Namen mit Recht. Die Vorschau-Attrappe und dieses Werkzeug
  // stehen ebenfalls nicht in der Liste — ein Messwerkzeug DARF den Namen
  // kennen, sonst koennte es die Freigabe gar nicht nachsehen.
  const quellen = [
    'NewDesign/app.js',
    'NewDesign/index.html',
    'src/frontend-box/src/app/einstellungssperre/freigabe.ts',
    'src/frontend-box/src/app/einstellungssperre/einstellungssperre.guard.ts',
    'src/frontend-box/src/app/einstellungssperre/einstellungssperre.service.ts',
    'src/frontend-box/src/app/rueckweg.ts',
  ]
  const schuldig = quellen.filter((d) => fs.existsSync(d) && fs.readFileSync(d, 'utf8').includes(regel.schluessel))
  p(schuldig, [], 'kein Quelltext schreibt den Namen aus (er kommt aus freigabe.json)')
}

// ══ DIE DREI NEUEN SCHIRME DES ELTERN-BEREICHS (06.08.2026) ══════════════
//
//   sperrUnterzeile  sagt, WELCHE Sperre gesetzt ist. Der teure Fall ist
//                    nicht „pin" oder „aus", sondern „steht gar nicht da":
//                    das Tor rechnet dann, und wer die Unterzeile nach dem
//                    abgeleiteten Modus beschriftet, behauptet „Rechenaufgabe
//                    ist gewaehlt" ueber eine Box, in deren Datei nichts
//                    steht. Ein Tipp auf „Rechenaufgabe" taete dann scheinbar
//                    nichts — in Wahrheit schriebe er den Schluessel erstmals.
//   infoFelder       die sechs Kaestchen des Fachs „Box". Jedes hat einen
//                    Leerfall, den man am Schirm nur sieht, wenn man ihn
//                    gerade herstellt. HIER IST EINER GEFUNDEN WORDEN, beim
//                    allerersten Lauf: `Number(null)` ist 0, und 0 ist eine
//                    Zahl — ohne Antwort von /api/system stand „0,0 °C" da.
//                    Eine Box bei null Grad, und am Schirm nicht von einer
//                    echten Messung zu unterscheiden.
//   kachelWeiter     schaltet die Kachelgroesse weiter. Sie muss RUNDLAUFEN
//                    und einen fremden Wert (die Verwaltung laesst jede Zahl
//                    zu) auf einen bekannten holen — sonst klemmt der Knopf
//                    bei einem Wert, den er selbst nie gesetzt hat.
console.log('\n── sperrUnterzeile ────────────────────────────────────────')
p(sperrUnterzeile('rechnen', 'rechnen'), SPERR_WORT.rechnen, 'gesetzt: rechnen')
p(sperrUnterzeile('pin', 'pin'), SPERR_WORT.pin, 'gesetzt: pin')
p(sperrUnterzeile('geste', 'geste'), SPERR_WORT.geste, 'gesetzt: geste')
p(sperrUnterzeile('aus', 'aus'), SPERR_WORT.aus, 'gesetzt: aus')
// DER FALL DER BOX .169: der Schluessel fehlt in /etc/mupiboxconfig.json ganz.
// Die Unterzeile darf dann NICHT „Rechenaufgabe" sagen — die Box rechnet zwar,
// aber gewaehlt hat das niemand.
p(
  sperrUnterzeile('', '').includes('Nicht gesetzt'),
  true,
  'der Schluessel FEHLT: „nicht gesetzt", nicht „Rechenaufgabe"',
)
// SIE SAGT TROTZDEM, WAS DIE BOX TUT — „Nicht gesetzt" allein liesse offen,
// ob die Box dann offensteht. Was sie NICHT sein darf, ist der blosse Name der
// Art: dann staende dort dasselbe wie bei einer ausdruecklichen Wahl.
p(sperrUnterzeile('', '') === SPERR_WORT.rechnen, false, 'und er sieht nicht aus wie eine Wahl')
p(sperrUnterzeile('', '').includes('Rechenaufgabe'), true, 'nennt aber, was die Box statt dessen tut')
// Ein Wort, das es nicht gibt, wird ZITIERT. Sonst ist ein Tippfehler in der
// Konfigurationsdatei von aussen gar nicht zu finden: das Tor rechnet, das
// Board zeigt „Rechenaufgabe", und in der Datei steht „rechen".
p(sperrUnterzeile('', 'rechen').includes('„rechen"'), true, 'ein unbekanntes Wort wird genannt')
p(sperrUnterzeile('', '   ').includes('Nicht gesetzt'), true, 'nur Leerzeichen gilt als nicht gesetzt')

console.log('\n── infoFelder ─────────────────────────────────────────────')
const zahlen = (a) => a.map((x) => `${x.wort}=${x.zahl}${x.warnt ? '!' : ''}`)
// ES SIND IMMER SECHS — auch wenn NICHTS bekannt ist. Ein Gitter, das im
// Leerfall schrumpft, verschiebt alles darunter.
p(infoFelder(null, null, null, null).length, 6, 'ohne jede Antwort: trotzdem sechs Kaestchen')
p(
  zahlen(infoFelder(null, null, null, null)),
  ['Adresse=—', 'Netz=—', 'Temperatur=—', 'Auslastung=—', 'Dienste=—', 'Akku=—'],
  'und jedes sagt „—", keines eine erfundene Zahl',
)
{
  const sys = { temperatur: 50.2, last: [0.34], kerne: 4, speicherGesamt: 1000, speicherFrei: 500 }
  const netz = {
    schnittstellen: [
      { name: 'eth0', aktiv: false, funk: false, adressen: [] },
      // DIE v6-ADRESSEN STEHEN MIT DRIN, so wie die Box sie liefert. Sie
      // duerfen NICHT im Kaestchen landen: 39 Zeichen passen dort nicht hin,
      // und niemand tippt sie in einen Browser.
      {
        name: 'wlan0',
        aktiv: true,
        funk: true,
        adressen: [
          { familie: 'v6', adresse: 'fd03:c0a8:58f1:0:8aa2:9eff:fe48:f64f', praefix: 64 },
          { familie: 'v4', adresse: '192.168.178.169', praefix: 24 },
        ],
      },
    ],
    wlan: { ssid: 'ganznahamnetzNight' },
    internet: true,
  }
  const laeuft = [{ name: 'a.service', titel: 'A', aktiv: true }, { name: 'b.service', titel: 'B', aktiv: true }]
  const g = infoFelder(sys, laeuft, { BatteryConnected: 1, Bat_SOC_fein: 100, Charger_Status: 'Charge Termination Done' }, netz)
  p(g[0].zahl, '192.168.178.169', 'die v4-Adresse, nicht die v6')
  p(g[1].zahl, 'ganznahamnetzNight', 'der Name des Netzes')
  p(g[1].warnt, false, 'und mit Internet warnt nichts')
  p(g[2].zahl, '50,2 °C', 'Temperatur mit Komma')
  // 0,34 auf VIER Kernen sind 9 % — „0,34" allein sagt einem Menschen nichts.
  p(g[3].zahl, '9 % · Speicher 50 %', 'Last durch die Kerne geteilt')
  p(g[4].zahl, '2 laufen, keiner gestört', 'alle Dienste laufen')
  // „Charge Termination Done" heisst FERTIG, nicht „laedt" — dieselbe Regel
  // wie im Akkuzeichen der Kopfzeile.
  p(g[5].zahl, '100 %', 'voll und nicht mehr ladend')
  p(g[5].warnt, false, 'und voll warnt nicht')

  // ── DIE FAELLE, DIE WARNEN ──────────────────────────────────────────
  const ohneWeg = infoFelder(sys, laeuft, false, { ...netz, internet: false })
  p(ohneWeg[1].zahl.includes('kein Internet'), true, 'verbunden, aber kein Weg hinaus: es steht da')
  p(ohneWeg[1].warnt, true, 'und es warnt')
  // DER SATZ STATT DER LEEREN ZEILE — der Betreiber hat ausdruecklich danach
  // gefragt. `false` heisst „gefragt, es gibt keinen HAT" (der Server
  // antwortet `[]`), `null` heisst „noch nicht gefragt".
  p(ohneWeg[5].zahl, 'Kein MuPiHAT eingebaut', 'ohne MuPiHAT steht ein Satz da')
  p(ohneWeg[5].warnt, undefined, 'und das ist keine Warnung, sondern eine Auskunft')
  p(
    infoFelder(sys, laeuft, { BatteryConnected: 0 }, netz)[5].zahl,
    'MuPiHAT da, kein Akku daran',
    'HAT ohne Akku ist ein dritter Fall',
  )
  p(
    infoFelder(sys, laeuft, { BatteryConnected: 1, Bat_SOC_fein: 12, Charger_Status: 'Not Charging' }, netz)[5].warnt,
    true,
    'unter 20 % und nicht am Kabel: das warnt',
  )
  p(
    infoFelder(sys, laeuft, { BatteryConnected: 1, Bat_SOC_fein: 12, Charger_Status: 'Fast Charging' }, netz)[5].warnt,
    false,
    'unter 20 %, aber es laedt: das warnt NICHT',
  )
  // ── „STEHT" IST NICHT „GESTOERT" ────────────────────────────────────
  // DER TEUERSTE FEHLER DIESES KAESTCHENS, gefunden, indem die ECHTE Antwort
  // der Box .169 durch diese Funktion gelaufen ist: Dort sind 20 von 33
  // Diensten abgeschaltet (Lüfter, VNC, Telegram, MQTT …). Wer „nicht aktiv"
  // als Problem liest, faerbt das Kaestchen auf einer heilen Box dauerhaft
  // rot — und eine Warnung, die immer steht, liest niemand mehr.
  const abgeschaltet = [
    { name: 'a.service', titel: 'A', aktiv: true, eingeschaltet: true, zustand: 'active' },
    { name: 'b.service', titel: 'Lüfter', aktiv: false, eingeschaltet: false, zustand: 'inactive' },
  ]
  p(infoFelder(sys, abgeschaltet, false, netz)[4].warnt, false, 'ein ABGESCHALTETER Dienst warnt nicht')
  p(infoFelder(sys, abgeschaltet, false, netz)[4].zahl, '1 laufen, keiner gestört', 'er wird nur nicht mitgezaehlt')
  // UND DIE ZWEITE FALLE: eingeschaltet und trotzdem `inactive`. Vier
  // Einheiten der Box sind genau das — sie laufen EINMAL und sind fertig
  // (Wiederherstellung von der Karte, der Ruecknahme-Wecker des WLAN).
  const durchgelaufen = [
    { name: 'a.service', titel: 'A', aktiv: true, eingeschaltet: true, zustand: 'active' },
    { name: 'b.service', titel: 'Wiederherstellung', aktiv: false, eingeschaltet: true, zustand: 'inactive' },
  ]
  p(infoFelder(sys, durchgelaufen, false, netz)[4].warnt, false, 'eingeschaltet und durchgelaufen warnt auch nicht')
  // WAS WIRKLICH WARNT: systemds eigenes Wort dafuer.
  const kaputt = [
    { name: 'a.service', titel: 'A', aktiv: true, eingeschaltet: true, zustand: 'active' },
    { name: 'b.service', titel: 'Bluetooth', aktiv: false, eingeschaltet: true, zustand: 'failed' },
  ]
  p(infoFelder(sys, kaputt, false, netz)[4].zahl, 'Gestört: Bluetooth', 'ein GESCHEITERTER Dienst wird benannt')
  p(infoFelder(sys, kaputt, false, netz)[4].warnt, true, 'und er warnt')
  p(
    infoFelder(sys, [...kaputt, { name: 'c.service', titel: 'C', aktiv: false, zustand: 'failed' }], false, netz)[4].zahl,
    '2 gestört, zuerst Bluetooth',
    'bei mehreren wird gezaehlt und der erste genannt',
  )
  // 75 °C ist die Stufe, ab der die Luefterregelung auf 100 % geht.
  p(infoFelder({ ...sys, temperatur: 78 }, laeuft, false, netz)[2].warnt, true, '78 °C warnt')
  p(infoFelder({ ...sys, temperatur: 74.9 }, laeuft, false, netz)[2].warnt, false, '74,9 °C noch nicht')
  // KEIN NETZ IST NICHT „NICHT GEFRAGT": beides muss verschieden aussehen.
  const ohneNetz = infoFelder(sys, laeuft, false, { schnittstellen: [], internet: false })
  p(ohneNetz[0].zahl, 'keine', 'gefragt, aber keine Adresse: „keine"')
  p(ohneNetz[0].warnt, true, 'und das warnt')
  p(infoFelder(sys, laeuft, false, null)[0].zahl, '—', 'nicht gefragt: „—"')
  p(infoFelder(sys, laeuft, false, null)[0].warnt, false, 'und das warnt NICHT — es ist keine Aussage')
}

/* ══ spotifyEinrichtAdresse — WOHIN DAS ABFOTOGRAFIERTE ZEICHEN FUEHRT ═══════
 *
 * Sie ist die eine Regel des QR-Blattes, deren Fehler UNSICHTBAR waeren: Man
 * sieht einem QR-Zeichen nicht an, was darin steht. Ein falscher Port, eine
 * v6-Adresse ohne eckige Klammern, die Adresse einer INAKTIVEN Schnittstelle —
 * alles drei ergibt ein Bild, das genau wie ein richtiges aussieht und am Handy
 * in eine Fehlerseite laeuft. Die Probe am Bildschirmfoto
 * (tools/qr-zurueckgelesen.mjs) findet das erst NACH dem Zeichnen und braucht
 * einen Browser; diese Zeilen kosten Millisekunden.
 */
console.log('\n── spotifyEinrichtAdresse ─────────────────────────────────')
{
  const mit = (adressen, aktiv = true) => ({ schnittstellen: [{ name: 'wlan0', funk: true, aktiv, adressen }] })
  const v4 = [{ familie: 'v4', adresse: '192.168.178.170', praefix: 24 }]
  const v6 = [{ familie: 'v6', adresse: 'fd03:c0a8:58f1:0:8aa2:9eff:fe48:f64f', praefix: 64 }]
  // ── HTTPS UND 8443, NICHT MEHR HTTP UND 8200 (seit b95f8ba1) ───────────
  // Der Rueckweg der Anmeldung ist seit dem 10.08.2026 die Netzwerkadresse
  // ueber HTTPS, und Verifier und State liegen im sessionStorage der
  // HERKUNFT. Fuehrte das QR-Zeichen auf http://…:8200, legte der Browser
  // sie dort ab und suchte sie spaeter unter https://…:8443 vergebens — die
  // Anmeldung braeche mit einer Meldung ab, die nach Angriff aussieht. Der
  // Kommentarblock in app.js (ueber SPOTIFY_EINRICHT_PORT) widerruft die
  // alte http-Begruendung ausdruecklich; diese Erwartungen folgen ihm.
  p(spotifyEinrichtAdresse(mit(v4)), 'https://192.168.178.170:8443/spotify', 'die gewoehnliche Lage')
  p(SPOTIFY_EINRICHT_PORT, 8443, 'der Port ist der feste HTTPS-Port aus server.ts')
  // ── OHNE ADRESSE KOMMT NICHTS HERAUS, UND ZWAR LEER ────────────────────
  // Punkt 2 der nicht verhandelbaren Liste. Ein `https://:8443/spotify` waere
  // ein Zeichen, das ins Leere fuehrt — und die Seite koennte den Fall nicht
  // von einem gueltigen unterscheiden.
  p(spotifyEinrichtAdresse(null), '', 'nicht gefragt: nichts')
  p(spotifyEinrichtAdresse({ schnittstellen: [] }), '', 'gefragt, keine Schnittstelle: nichts')
  p(spotifyEinrichtAdresse(mit(v6)), '', 'nur v6: nichts — eine v6-Adresse tippt niemand ab')
  p(spotifyEinrichtAdresse(mit(v4, false)), '', 'eine INAKTIVE Schnittstelle zaehlt nicht')
  // ── DIE REIHENFOLGE IST DIE DES SERVERS: eth0 VOR wlan0 ────────────────
  // Wer am Kabel haengt, bekommt die Kabeladresse — dieselbe, die das Info-Fach
  // zeigt. Zwei verschiedene Adressen auf einem Geraet waeren die Sorte
  // Widerspruch, die niemand aufloesen kann.
  p(
    spotifyEinrichtAdresse({
      schnittstellen: [
        { name: 'eth0', funk: false, aktiv: true, adressen: [{ familie: 'v4', adresse: '192.168.178.169', praefix: 24 }] },
        { name: 'wlan0', funk: true, aktiv: true, adressen: v4 },
      ],
    }),
    'https://192.168.178.169:8443/spotify',
    'Kabel vor Funk — dieselbe Quelle wie das Info-Gitter',
  )
  // Die aeltere Serverfassung lieferte blosse Zeichenketten. Sie faellt nicht durch.
  p(spotifyEinrichtAdresse(mit(['192.168.178.171'])), 'https://192.168.178.171:8443/spotify', 'alte Serverfassung (Zeichenketten)')
  // ── UND KEINE ADRESSE IST JEMALS LAENGER ALS EIN QR DER VERSION 3 ──────
  // 42 Byte traegt Version 3 im Byte-Modus; die laengste denkbare Adresse ist
  // `https://255.255.255.255:8443/spotify` = 36 (8 + 15 + 5 + 8). Das ist der
  // Grund, warum in app.js kein Blockverschraenken steht.
  p(spotifyEinrichtAdresse(mit([{ familie: 'v4', adresse: '255.255.255.255', praefix: 24 }])).length <= 42, true, 'die laengste Adresse passt in Version 3')
}

console.log('\n── kachelWeiter ───────────────────────────────────────────')
p(KACHEL_STUFEN.map((b) => kachelWeiter(b)), [1, 1.3, 1.6, 0.8], 'die vier Stufen laufen rund')
p(KACHEL_STUFEN.every((b) => typeof kachelWort(b) === 'string' && kachelWort(b).length > 0), true, 'jede Stufe hat ein Wort')
// DIE VERWALTUNG LAESST JEDE ZAHL ZU. Ein Wert, den diese Liste nicht kennt,
// muss auf „normal" fuehren — von dort ist beides gleich weit. Klemmte er,
// waere der Knopf tot, ohne dass irgendwo etwas rot wird.
p(kachelWeiter(1.8), 1, 'ein fremder Wert (1.8 aus dem Thema „Classic") fuehrt auf normal')
p(kachelWeiter(0), 1, 'und 0 ebenso')
p(kachelWort(1.8).includes('1,8'), true, 'und er wird bis dahin mit seiner Zahl benannt')

// ══ wappenTipp — WANN „ZUM ÖFFNEN LANGE GEDRÜCKT HALTEN" ERSCHEINT ═══════
//
// DIE LAGE: Seit dem 07.08.2026 fuehrt genau EIN Weg ins Admin-Menue — das
// Wappen halten. Wer das nicht weiss, tippt darauf. Diese Regel entscheidet,
// ab wann die Oberflaeche ihm antwortet.
//
// SIE IST DOPPELT STILL, und deshalb steht sie hier:
//   * Zu HOCH oder zu KURZ, und der Hinweis kommt nie. Am Schirm sieht das
//     exakt so aus wie vorher — es fehlt ja nichts, was jemand vermisst.
//   * Zu NIEDRIG, und er kommt beim ersten Tipp. Dann ist er die Anleitung
//     fuer jedes Kind, es einmal mit langem Halten zu versuchen.
// Beides sieht richtig aus. Ein Browser braucht es nicht, um das zu merken.
//
// DIE ZAHLEN SIND EINE ABSCHRIFT aus src/frontend-box/src/app/tippzaehler.ts.
// Dass beide Seiten dieselben bleiben, misst tools/wappen-hinweis-probe.mjs —
// hier wird geprueft, was die Zahlen TUN.
console.log('\n── wappenTipp ─────────────────────────────────────────────')
{
  const leer = { anzahl: 0, zuletzt: 0 }
  // Eine Reihe schneller Tipps: erst der WAPPEN_TIPPS-te loest aus.
  let s = leer
  const folge = []
  for (let i = 1; i <= WAPPEN_TIPPS; i++) {
    const r = wappenTipp(s, 1000 + i * 200)
    s = r.stand
    folge.push(r.hinweis)
  }
  p(folge, [...Array(WAPPEN_TIPPS - 1).fill(false), true], `erst der ${WAPPEN_TIPPS}. schnelle Tipp zeigt den Hinweis`)
  // NACH DEM HINWEIS FAENGT DIE REIHE VON VORN AN. Sonst erschiene er bei
  // jedem weiteren Tipp erneut und bliebe stehen, solange jemand tippt.
  p(s.anzahl, 0, 'und danach ist der Zaehler zurueckgesetzt')
  p(wappenTipp(s, 2000).hinweis, false, 'der naechste Tipp zeigt ihn NICHT sofort wieder')

  // ZU LANGSAM IST KEINE REIHE. Ohne diese Grenze summierten sich drei Tipps
  // ueber einen ganzen Nachmittag zu einem Hinweis, der aus dem Nichts kommt.
  let t = leer
  const langsam = []
  for (let i = 1; i <= WAPPEN_TIPPS + 1; i++) {
    const r = wappenTipp(t, i * (WAPPEN_TIPP_FENSTER_MS + 1))
    t = r.stand
    langsam.push(r.hinweis)
  }
  p(
    langsam.some(Boolean),
    false,
    `Tipps mit mehr als ${WAPPEN_TIPP_FENSTER_MS} ms Abstand sammeln sich nicht an`,
  )
  // GENAU AUF DER GRENZE ZAEHLT MIT (`<=`). Ein `<` hier hiesse, dass ein
  // Tipp exakt am Fensterende die Reihe abreissen laesst — die Grenze soll
  // dieselbe sein wie in tippzaehler.ts, und dort steht `<=`.
  p(
    wappenTipp({ anzahl: WAPPEN_TIPPS - 1, zuletzt: 0 }, WAPPEN_TIPP_FENSTER_MS).hinweis,
    true,
    'genau am Fensterende zaehlt der Tipp noch zur Reihe',
  )
  p(
    wappenTipp({ anzahl: WAPPEN_TIPPS - 1, zuletzt: 0 }, WAPPEN_TIPP_FENSTER_MS + 1).hinweis,
    false,
    'eine Millisekunde spaeter nicht mehr',
  )
  // DER ERSTE TIPP UEBERHAUPT. `zuletzt: 0` ist der Anfangswert; er darf nicht
  // dazu fuehren, dass der allererste Tipp mit einer alten Reihe verrechnet
  // wird — bei WAPPEN_TIPPS = 2 waere das sonst sofort ein Hinweis.
  p(wappenTipp(leer, 1_000_000).hinweis, false, 'der allererste Tipp zeigt nichts')
}

// ══ DIE AKKUKURVE — die Regeln, an denen ein Fehler still bliebe ════════
//
// Eine Kurve SIEHT immer richtig aus. Ein Linienzug ueber einer Zeitachse
// wirkt wie eine Messung, auch wenn er eine Behauptung ist. Die fuenf Regeln
// hier sind die, bei denen genau das passiert.
console.log('\n── akkuLuecke / akkuStuecke ───────────────────────────────')
{
  const min = 60000
  const reihe = (n, ab = 0, schritt = min) =>
    Array.from({ length: n }, (_, i) => ({ t: ab + i * schritt, p: 50, v: 8000, i: -400 }))

  // ── WIE WEIT DARF EIN ABSTAND SEIN, BEVOR ER EINE LUECKE IST ──────────
  // Bei einer DICHTEN Reihe (jede Minute ein Punkt) haelt die Untergrenze:
  // vier Minuten waeren zu knapp, ein Neustart der Box dauert zwei.
  p(akkuLuecke(reihe(20)), AKKU_LUECKE_MIN_MS, 'dichte Reihe: es gilt die Untergrenze')
  // Bei einer AUSGEDUENNTEN Reihe (sieben Tage auf 600 Punkte, also rund
  // 17 Minuten Abstand) waere eine feste Untergrenze falsch — sie erklaerte
  // JEDEN Schritt zur Luecke und zerlegte die Kurve in 600 Einzelpunkte.
  p(akkuLuecke(reihe(20, 0, 17 * min)), 17 * min * AKKU_LUECKE_FAKTOR, 'ausgeduennte Reihe: der Median traegt')
  // ZU WENIG PUNKTE FUER EINEN MEDIAN: die Untergrenze, nicht NaN.
  p(akkuLuecke([]), AKKU_LUECKE_MIN_MS, 'leere Reihe')
  p(akkuLuecke([{ t: 0, p: 1 }]), AKKU_LUECKE_MIN_MS, 'ein einzelner Punkt')
  // DER MEDIAN UND NICHT DER MITTELWERT. Eine einzige lange Nacht in einer
  // sonst dichten Reihe darf die Schwelle nicht anheben — sonst hebt sich
  // genau dann, wenn es darauf ankommt, die Luecke selbst auf.
  {
    const dicht = reihe(30)
    dicht.push({ t: 30 * min + 8 * 3600000, p: 50, v: 8000, i: -400 })
    p(akkuLuecke(dicht), AKKU_LUECKE_MIN_MS, 'eine lange Nacht hebt die Schwelle NICHT an')
  }

  // ── DIE ZEILE, WEGEN DER DIE KURVE NICHT LUEGT ────────────────────────
  // Zehn Punkte, dann acht Stunden nichts (die Box war aus), dann zehn.
  // Es muessen ZWEI Stuecke herauskommen. Kaeme eines heraus, zoege die
  // Linie quer ueber die Nacht und behauptete einen Verlauf, den niemand
  // gemessen hat — und das saehe am Schirm wie eine besonders ruhige Kurve
  // aus, nicht wie ein Fehler.
  {
    const nacht = [...reihe(10), ...reihe(10, 10 * min + 8 * 3600000)]
    const st = akkuStuecke(nacht, akkuLuecke(nacht))
    p(st.length, 2, 'die Nacht schneidet die Reihe in ZWEI Stuecke')
    p([st[0].length, st[1].length], [10, 10], 'und kein Punkt geht dabei verloren')
  }
  // OHNE LUECKE BLEIBT ES EIN STUECK.
  p(akkuStuecke(reihe(20), akkuLuecke(reihe(20))).length, 1, 'eine dichte Reihe bleibt EIN Stueck')
  // EIN EINZELNER PUNKT IST EIN STUECK. Ihn wegzuwerfen hiesse, eine
  // Aufzeichnung zu verschweigen, weil sie kurz war.
  p(akkuStuecke([{ t: 0, p: 40 }], 60000).length, 1, 'ein einzelner Messwert bleibt stehen')
  // ── `Number(null)` IST 0 — DIESELBE FALLE WIE IN `infoFelder` ─────────
  // Ein Punkt ohne Ladestand darf NICHT als 0 % durchkommen: das saehe am
  // Schirm aus wie ein leerer Akku.
  p(
    akkuStuecke([{ t: 0, p: 40 }, { t: 60000, p: null }, { t: 120000, p: 41 }], 300000)[0].length,
    2,
    'ein Punkt ohne Ladestand faellt heraus statt als 0 % zu erscheinen',
  )
  p(akkuStuecke(null, 60000), [], 'gar keine Reihe: kein Stueck, kein Absturz')

  // ── WIE WEIT REICHT DIE AUFZEICHNUNG ZURUECK ─────────────────────────
  // Ueber die STUECKE gerechnet und nicht „erster bis letzter Punkt": Eine
  // Nacht ohne Messwerte gehoert nicht zur Aufzeichnung, auch wenn sie
  // zwischen zwei Punkten liegt.
  {
    const nacht = [...reihe(10), ...reihe(10, 10 * min + 8 * 3600000)]
    const st = akkuStuecke(nacht, akkuLuecke(nacht))
    p(akkuAbdeckung(st), 18 * min, 'die Nacht zaehlt NICHT zur Aufzeichnung')
  }
  p(akkuAbdeckung([]), 0, 'ohne Stueck ist nichts aufgezeichnet')
  p(akkuAbdeckung([[{ t: 5 }]]), 0, 'ein einzelner Punkt umspannt keine Zeit')
}

console.log('\n── akkuAchse ──────────────────────────────────────────────')
{
  const std = 3600000
  const jetzt = new Date(2026, 7, 7, 19, 1).getTime()
  for (const [stunden, wort] of [[24, '24 Stunden'], [168, 'sieben Tage']]) {
    const marken = akkuAchse(jetzt - stunden * std, jetzt)
    // VIER BIS ACHT. Weniger sagt nichts, mehr stossen aneinander — eine
    // Achse mit ueberlappenden Beschriftungen ist schlechter als keine.
    p(marken.length >= 3 && marken.length <= AKKU_ACHS_MARKEN + 1, true, `${wort}: drei bis acht Marken (${marken.length})`)
    // SIE MUESSEN IM BILD LIEGEN. Eine Marke ausserhalb der Spanne saesse am
    // Rand fest und behauptete eine Uhrzeit, die dort nicht steht.
    p(marken.every((m) => m.t >= jetzt - stunden * std && m.t <= jetzt), true, `${wort}: alle Marken liegen in der Spanne`)
    p(marken.every((m, i) => i === 0 || m.t > marken[i - 1].t), true, `${wort}: sie steigen an`)
  }
  // SIEBEN TAGE ZAEHLEN IN TAGEN. Sieben mal „00:00" untereinander waeren
  // sieben gleiche Worte; die Beschriftung ist dann der Wochentag.
  p(akkuAchse(jetzt - 168 * std, jetzt).every((m) => m.tag === true), true, 'sieben Tage: die Marken sind TAGE')
  p(akkuAchse(jetzt - 24 * std, jetzt).every((m) => m.tag === false), true, '24 Stunden: die Marken sind UHRZEITEN')
  // UNSINNIGE SPANNEN ERGEBEN KEINE ACHSE — und keinen Absturz.
  p(akkuAchse(jetzt, jetzt), [], 'eine Spanne von null ergibt keine Marke')
  p(akkuAchse(jetzt, jetzt - std), [], 'eine rueckwaerts laufende Spanne ebenso')
  p(akkuAchse(null, undefined), [], 'und gar keine Spanne auch nicht')
}

console.log('\n── akkuMinutenWort / akkuSatz ─────────────────────────────')
{
  p(akkuMinutenWort(45), '45 min', 'unter einer Stunde')
  p(akkuMinutenWort(60), '1 h', 'genau eine Stunde — ohne „0 min" dahinter')
  p(akkuMinutenWort(200), '3 h 20 min', 'drei Stunden zwanzig')
  p(akkuMinutenWort(0), '0 min', 'null Minuten sind null Minuten')
  // KEINE ERFUNDENE NULL. `Number(null)` ist 0; ohne den Riegel stuende
  // „0 min" da, wo nichts bekannt ist — die Behauptung, es sei gleich vorbei.
  p(akkuMinutenWort(null), '—', 'nichts bekannt: ein Strich und keine Null')
  p(akkuMinutenWort('viel'), '—', 'und Unbrauchbares ebenso')

  // ── DIE ZEILE, DIE JEMAND WIRKLICH LIEST ────────────────────────────
  p(akkuSatz(null).kopf, '—', 'ohne Antwort: keine Zahl')
  p(akkuSatz({ jetzt: null }).lage, 'unbekannt', 'ohne Messpunkt: unbekannt')
  // ENTLADEN mit bekannter Kapazitaet.
  {
    const a = akkuSatz({ jetzt: { p: 68, i: -420 }, restMinuten: 200 })
    p(a.kopf, '68 % · entlädt', 'entlaedt: Stand und Lage')
    p(a.unter.includes('reicht noch etwa 3 h 20 min'), true, 'und wie lange noch')
  }
  // LADEN.
  {
    const a = akkuSatz({ jetzt: { p: 31, i: 900 }, restMinuten: 70 })
    p(a.kopf, '31 % · lädt', 'laedt: Stand und Lage')
    p(a.unter.includes('voll in etwa 1 h 10 min'), true, 'und wann er voll ist')
  }
  // ── RUHE IST EIN EIGENER ZWEIG, UND OHNE IHN STUENDE DORT „noch 0 min" ─
  // Eine volle Box am Netzteil ist der Normalfall und KEINE Warnung.
  {
    const a = akkuSatz({ jetzt: { p: 100, i: 6 }, restMinuten: null })
    p(a.lage, 'ruht', 'fast kein Strom: Ruhe')
    p(a.kopf, '100 %', 'und der Kopf traegt keine Lage dazu')
    p(/reicht noch|voll in/.test(a.unter), false, 'und keine erfundene Restzeit')
  }
  // ── OHNE KAPAZITAET WIRD NICHTS HOCHGERECHNET ────────────────────────
  // `restMinuten: null` heisst: die Box kennt die Kapazitaet ihres Packs
  // nicht. Eine Zahl an dieser Stelle saehe aus wie eine Messung.
  {
    const a = akkuSatz({ jetzt: { p: 68, i: -420 }, restMinuten: null })
    p(/reicht noch|voll in/.test(a.unter), false, 'ohne Kapazitaet keine Restzeit')
    p(a.unter.includes('Kapazität des Packs ist ihr unbekannt'), true, 'sondern der Satz, warum nicht')
  }
  // Genau auf der Ruheschwelle ist es noch RUHE (`<=`), eine Milliampere
  // darueber nicht mehr — dieselbe Grenze wie in akkuverlauf.ts.
  p(akkuSatz({ jetzt: { p: 50, i: 20 } }).lage, 'ruht', 'genau auf der Schwelle: Ruhe')
  p(akkuSatz({ jetzt: { p: 50, i: 21 } }).lage, 'laedt', 'eine Milliampere darueber: Laden')
  p(akkuSatz({ jetzt: { p: 50, i: -21 } }).lage, 'entlaedt', 'und in die andere Richtung: Entladen')
}

console.log('\n── akkuDuenn / akkuFlach ──────────────────────────────────')
{
  const min = 60000
  const reihe = (n, schritt = min) => Array.from({ length: n }, (_, i) => ({ t: i * schritt, p: 50 - i }))
  // ── ZWEI PUNKTE SIND KEINE KURVE ────────────────────────────────────
  // Was sonst dastuende, waere ein Strich am rechten Rand, den jemand fuer
  // einen Defekt haelt.
  p(typeof akkuDuenn([], []), 'string', 'gar keine Punkte: ein Satz statt einer Linie')
  p(typeof akkuDuenn(reihe(2), [reihe(2)]), 'string', `weniger als ${AKKU_MIND_PUNKTE} Punkte: ein Satz`)
  // ── UND EINE VIERTELSTUNDE IST DIE ANDERE HAELFTE DERSELBEN FRAGE ────
  // Zwanzig Punkte im Sekundentakt sind zwanzig Punkte und trotzdem keine
  // Kurve: die Aufzeichnung reicht dann keine zwanzig Sekunden zurueck.
  {
    const kurz = reihe(20, 1000)
    p(typeof akkuDuenn(kurz, [kurz]), 'string', 'zwanzig Punkte in zwanzig Sekunden: trotzdem zu kurz')
  }
  {
    const lang = reihe(40)
    p(akkuDuenn(lang, [lang]), null, 'vierzig Minuten Aufzeichnung reichen')
  }

  // ── DIE WAAGERECHTE LINIE BEIM NAMEN NENNEN ─────────────────────────
  // Der Fall „die Box steht zwei Tage am Strom". Das ist KEIN Fehler und
  // keine duenne Datenlage — es ist die Auskunft „hier ist nichts
  // passiert". Nur sieht man einer geraden Linie das nicht an.
  {
    const flach = Array.from({ length: 100 }, (_, i) => ({ t: i * min, p: 100 }))
    const satz = akkuFlach(flach)
    p(typeof satz, 'string', 'eine Gerade wird benannt')
    p(satz.includes('100 %'), true, 'und der Satz nennt die Hoehe')
  }
  p(akkuFlach(reihe(40)), null, 'eine fallende Kurve nicht')
  p(akkuFlach([]), null, 'und eine leere Reihe ergibt keinen Satz')
  p(akkuFlach([{ p: 50 }]), null, 'ein einzelner Punkt ebenfalls nicht')

  // ── EINE REGEL FUER "LAEDT", VIER ANZEIGEN ──────────────────────────
  // Bis zum 07.08.2026 waren es ZWEI Regeln: das Wort des Ladereglers
  // (Zeichen der Kopfzeile, Info-Kaestchen, Menuezeile) und der gemessene
  // Strom (der Satz ueber der Kurve). Bei "Trickle Charge" mit 15 mA zeigte
  // die Kopfzeile den Blitz, waehrend drei Zentimeter darunter
  // "Es fließt fast nichts — der Stand hält sich." stand. Beides zugleich,
  // auf einem Schirm, und man sieht ihnen nicht an, welches stimmt.
  p(akkuLaedtRegel('Fast Charging', 900), true, 'Regler laedt, Strom fliesst hinein')
  p(akkuLaedtRegel('Not Charging', -420), false, 'Regler laedt nicht, Strom fliesst heraus')
  // DER FALL, DER DIE BEIDEN ANZEIGEN AUSEINANDERTRIEB: eine echte Ladephase
  // mit einem Strom im Ruheband. Der Regler weiss es, der Strom nicht.
  p(akkuLaedtRegel('Trickle Charge', 15), true, 'Vorladung im Ruheband: der Regler entscheidet')
  p(akkuLaedtRegel('Charge Termination Done', 6), false, 'fertig geladen ist kein Laden')
  // UND WO DER STROM DEUTLICH IST, GEWINNT ER. Ein Regler, der "Fast
  // Charging" meldet, waehrend ein halbes Ampere HERAUS fliesst, irrt sich —
  // und die Richtung, in die der Pack leerer wird, ist die Auskunft, auf die
  // es ankommt.
  p(akkuLaedtRegel('Fast Charging', -500), false, 'Strom heraus schlaegt das Wort des Reglers')
  p(akkuLaedtRegel('Not Charging', 900), true, 'Strom hinein ebenso')
  p(akkuLaedtRegel('Fast Charging', Number.NaN), true, 'ohne Stromwert bleibt es beim Wort')
  p(akkuLaedtRegel('', Number.NaN), false, 'ohne beides: kein Laden behaupten')
  p(akkuLaedtRegel('Fast Charging', AKKU_RUHE_MA), true, 'genau auf der Schwelle: der Regler entscheidet')

  // ── DAS BAND ZEIGT NUR, WAS GEMESSEN WURDE ──────────────────────────
  // Der Server gruppiert seine Abschnitte allein nach dem VORZEICHEN des
  // Stroms und kennt keine Luecken. Hoert das Kind abends bis zum
  // Ausschalten (entladen) und geht die Box morgens ohne Netzteil wieder an
  // (entladen), ist das fuer ihn EIN Abschnitt quer ueber die Nacht. Ein
  // Balken darueber behauptet ein Entladen, das niemand gemessen hat — und
  // deckt die Schraffur zu, die genau das zugeben soll.
  {
    const abends = [{ t: 0, p: 60 }, { t: 10 * min, p: 40 }]
    const morgens = [{ t: 600 * min, p: 38 }, { t: 610 * min, p: 20 }]
    const einer = [{ art: 'entladen', von: 0, bis: 610 * min }]
    const teile = akkuBandStuecke(einer, [abends, morgens])
    p(teile.length, 2, 'ein Abschnitt ueber eine Luecke wird ZWEI Balken')
    p(teile[0].bis, 10 * min, 'der erste endet, wo die Messung endet')
    p(teile[1].von, 600 * min, 'der zweite beginnt, wo sie wieder anfaengt')
    // UND ES BLEIBT EIN ENTLADEN. `nr` haelt die Bruchstuecke zusammen: die
    // Box hat nicht zweimal entladen, sie hat einmal nicht gemessen.
    p(new Set(teile.map((t) => t.nr)).size, 1, 'beide gehoeren zu EINEM Abschnitt')
    // DIE GRENZEN DES STUECKS FAHREN MIT, damit der Zeichner einen sehr
    // schmalen Balken nicht wieder in die Luecke hinein aufblasen kann.
    p(teile[0].stBis, 10 * min, 'die Grenze des Stuecks faehrt mit')
  }
  {
    // EIN LADEVORGANG GANZ IN DER NACHT ist im Bild nicht zu sehen — und
    // wird deshalb auch nicht angesagt.
    const abends = [{ t: 0, p: 60 }, { t: 10 * min, p: 40 }]
    const morgens = [{ t: 600 * min, p: 38 }, { t: 610 * min, p: 20 }]
    const nachts = [{ art: 'laden', von: 200 * min, bis: 300 * min }]
    p(akkuBandStuecke(nachts, [abends, morgens]).length, 0, 'was ganz in der Luecke liegt, kommt nicht ins Bild')
  }
  // RUHE IST KEIN BALKEN, und was keine Zeit hat, auch nicht.
  p(akkuBandStuecke([{ art: 'ruhe', von: 0, bis: 10 * min }], [[{ t: 0, p: 1 }, { t: 10 * min, p: 1 }]]).length, 0, 'Ruhe wird nicht gezeichnet')
  p(akkuBandStuecke([{ art: 'laden', von: 0, bis: 0 }], [[{ t: 0, p: 1 }, { t: min, p: 1 }]]).length, 0, 'ein Abschnitt ohne Dauer ergibt keinen Balken')
  p(akkuBandStuecke([], []).length, 0, 'nichts ergibt nichts')
  p(akkuBandStuecke(null, null).length, 0, 'und Unsinn wirft nicht')
}

console.log('── Wischgesten vom Rand ───────────────────────────────────')
{
  // Der Schirm der Box. Alle Zahlen hier gelten fuer ihn und nicht allgemein.
  const B = 800
  const H = 480

  // ── DER DECKEL AUF DER RANDBREITE ───────────────────────────────────
  // Er ist der Grund, warum es `wischKante` ueberhaupt gibt: Ohne ihn laege
  // ein Punkt bei genuegend breitem Streifen gleichzeitig am linken UND am
  // rechten Rand, und welcher gilt, entschiede die Reihenfolge eines
  // Vergleichs in `wischRaenderVon`.
  p(wischKante(28, B, H), 28, 'ein brauchbarer Wert bleibt stehen')
  p(wischKante(0, B, H), WISCH_RAND_VORGABE_PX, 'null faellt auf die Vorgabe')
  p(wischKante(undefined, B, H), WISCH_RAND_VORGABE_PX, 'nichts faellt auf die Vorgabe')
  p(wischKante('viel', B, H), WISCH_RAND_VORGABE_PX, 'Unsinn faellt auf die Vorgabe')
  p(wischKante(-5, B, H), WISCH_RAND_VORGABE_PX, 'negativ faellt auf die Vorgabe')
  p(wischKante(400, B, H), WISCH_RAND_HOECHST_PX, 'zu viel wird auf den Hoechstwert gedeckelt')
  // AUF EINEM WINZIGEN SCHIRM SCHLAEGT DAS VIERTEL DEN HOECHSTWERT. 96 px auf
  // einer 200 px hohen Flaeche waeren fast die halbe Hoehe.
  p(wischKante(96, 200, 200), 50, 'auf kleiner Flaeche gilt das Viertel')
  // DIE UNTERGRENZE DER EINSTELLOBERFLAECHEN MUSS UNTER DEM DECKEL LIEGEN,
  // sonst boeten sie einen Wert an, den `wischKante` sofort wieder verwirft.
  p(WISCH_RAND_MIND_PX < WISCH_RAND_HOECHST_PX, true, 'die angebotene Spanne ist nicht leer')
  p(wischKante(WISCH_RAND_MIND_PX, B, H), WISCH_RAND_MIND_PX, 'der kleinste anbietbare Wert kommt durch')
  p(wischKante(WISCH_RAND_HOECHST_PX, B, H), WISCH_RAND_HOECHST_PX, 'der groesste auch')
  // ZWEI STREIFEN DUERFEN SICH NIE BERUEHREN — die Eigenschaft, um die es
  // beim Deckel geht, hier direkt gefragt statt ueber eine Zahl.
  for (const [b, h] of [[800, 480], [200, 200], [1024, 600], [60, 40]]) {
    p(wischKante(999, b, h) * 2 < Math.min(b, h), true, `Streifen beruehren sich nicht bei ${b}x${h}`)
  }

  // ── WELCHE RAENDER EIN PUNKT BERUEHRT ───────────────────────────────
  const k = wischKante(28, B, H)
  p(wischRaenderVon(2, 240, B, H, k), ['links'], 'links ist links')
  p(wischRaenderVon(798, 240, B, H, k), ['rechts'], 'rechts ist rechts')
  p(wischRaenderVon(400, 3, B, H, k), ['oben'], 'oben ist oben')
  p(wischRaenderVon(400, 477, B, H, k), ['unten'], 'unten ist unten')
  p(wischRaenderVon(400, 240, B, H, k), [], 'die Mitte ist kein Rand')
  // DIE ECKE GEHOERT BEIDEN. Das ist der ganze Grund fuer die Liste: Welcher
  // der zwei gemeint war, weiss man erst, wenn die Hand sich bewegt hat.
  p(wischRaenderVon(3, 3, B, H, k), ['links', 'oben'], 'die Ecke gehoert zwei Raendern')
  p(wischRaenderVon(797, 477, B, H, k), ['rechts', 'unten'], 'und die gegenueberliegende auch')
  // AUSSERHALB IST NICHTS. Ein Finger mit negativen Koordinaten kommt vor,
  // wenn der Zug ueber den Schirmrand hinausgeht.
  p(wischRaenderVon(-4, 240, B, H, k), [], 'ausserhalb links ergibt nichts')
  p(wischRaenderVon(400, 900, B, H, k), [], 'ausserhalb unten ergibt nichts')
  p(wischRaenderVon(400, 240, 0, 0, k), [], 'ohne Flaeche ergibt nichts')

  // ── DIE HAND, NICHT DIE SCHNITTMENGE ────────────────────────────────
  //
  // DER FEHLER, DEN DIESE REGEL BEHOBEN HAT (gemeldet 21.08.2026): Vorher
  // mussten ALLE Finger im Randstreifen liegen. Das kann eine Hand nicht —
  // Zeige-, Mittel- und Ringfinger sind unterschiedlich lang, und der
  // hinterste liegt gut hundert Pixel weiter innen als der vorderste. Die
  // Bedingung war fuer EINEN Finger richtig und fuer drei unerfuellbar.
  const hand = (...xs) => xs.map((x) => ({ x, y: 240 }))
  p(wischRaenderDerHand(hand(798), B, H, k, WISCH_HAND_PX), ['rechts'], 'ein Finger am rechten Rand')
  // DREI GESTAFFELTE FINGER — der Fall, um den es geht. Nur der vorderste
  // liegt im Streifen; die anderen 24 und 48 px weiter innen.
  p(wischRaenderDerHand(hand(798, 774, 750), B, H, k, WISCH_HAND_PX), ['rechts'], 'drei gestaffelte Finger auch')
  // UND EINE HAND, DIE WIRKLICH WEIT AUSEINANDER LIEGT, NICHT MEHR: Das ist
  // ein Griff quer ueber den Schirm, kein Wisch vom Rand.
  p(wischRaenderDerHand(hand(798, 600, 400), B, H, k, WISCH_HAND_PX), [], 'eine Hand quer über den Schirm nicht')
  // KEIN FINGER IM STREIFEN — auch wenn alle nah beieinander liegen.
  p(wischRaenderDerHand(hand(700, 690, 680), B, H, k, WISCH_HAND_PX), [], 'ohne vordersten Finger im Streifen nichts')
  // BEI EINEM FINGER IST ES DIESELBE FRAGE WIE FRUEHER. Diese Zeile haelt die
  // Aenderung davon ab, den Ein-Finger-Fall nebenbei zu verschieben.
  for (const x of [0, 2, k, k + 1, 400, B - k - 1, B - k, B - 2, B]) {
    p(
      wischRaenderDerHand(hand(x), B, H, k, WISCH_HAND_PX),
      wischRaenderVon(x, 240, B, H, k),
      `ein Finger bei x=${x} ergibt dasselbe wie vorher`,
    )
  }
  p(wischRaenderDerHand([], B, H, k, WISCH_HAND_PX), [], 'ohne Finger nichts')
  p(wischRaenderDerHand(null, B, H, k, WISCH_HAND_PX), [], 'und Unsinn wirft nicht')
  p(wischRaenderDerHand(hand(798), 0, 0, k, WISCH_HAND_PX), [], 'ohne Flaeche nichts')

  // ── ZUG ODER ROLLEN? ────────────────────────────────────────────────
  // Die Regel, die die Geste von einer Bedienung unterscheidet, die es schon
  // gibt. Zu grosszuegig heisst: die Titelliste laesst sich am rechten Rand
  // nicht mehr rollen, ohne dass die Lautstaerke springt.
  const M = WISCH_ZUG_PX
  p(wischZugRand(['rechts'], -M, 0, M), 'rechts', 'genau weit genug reicht')
  p(wischZugRand(['rechts'], -(M - 1), 0, M), '', 'einen Pixel zu wenig reicht nicht')
  p(wischZugRand(['rechts'], -80, 79, M), 'rechts', 'schraeg, aber laengs weiter')
  p(wischZugRand(['rechts'], -80, 81, M), '', 'quer weiter als laengs ist ein Rollen')
  p(wischZugRand(['rechts'], 80, 0, M), '', 'nach aussen ist keine Geste')
  p(wischZugRand(['links'], M, 0, M), 'links', 'links zieht nach rechts')
  p(wischZugRand(['oben'], 0, M, M), 'oben', 'oben zieht nach unten')
  p(wischZugRand(['unten'], 0, -M, M), 'unten', 'unten zieht nach oben')
  p(wischZugRand([], -80, 0, M), '', 'ohne Kandidat gibt es nichts')
  p(wischZugRand(null, -80, 0, M), '', 'und Unsinn wirft nicht')
  // ── DIE ECKE ENTSCHEIDET SICH ERST HIER ─────────────────────────────
  const ecke = ['links', 'oben']
  p(wischZugRand(ecke, 80, 10, M), 'links', 'aus der Ecke nach rechts heisst links')
  p(wischZugRand(ecke, 10, 80, M), 'oben', 'aus der Ecke nach unten heisst oben')
  // GENAU DIAGONAL ERGIBT NICHTS, und das ist Absicht: bei 45 Grad ist keine
  // der beiden Richtungen gemeint. Lieber keine Geste als eine geratene.
  p(wischZugRand(ecke, 80, 80, M), '', 'genau diagonal ergibt nichts')

  // ── EIN SPRUNG IST KEINE HAND ───────────────────────────────────────
  // Die Regel gegen eine verspaetete oder doppelte Meldung der Touch-Bruecke.
  // Zu streng heisst: ein schneller Wisch geht nicht mehr, weil Chromium ihn
  // zu einem einzigen Ereignis zusammenfasst. Zu lasch heisst: ein einziges
  // kaputtes Ereignis blendet den Player aus.
  p(wischSprung(-556, 0, B, H), true, 'ein Sprung ueber zwei Drittel der Breite ist keiner')
  p(wischSprung(-200, 0, B, H), false, 'ein schneller Wisch von 200 px darf durch')
  p(wischSprung(0, H * WISCH_SPRUNG_ANTEIL + 1, B, H), true, 'und senkrecht gilt dasselbe')
  p(wischSprung(0, H * WISCH_SPRUNG_ANTEIL - 1, B, H), false, 'knapp darunter ist erlaubt')
  p(wischSprung(-556, 0, 0, 0), false, 'ohne Flaeche wird nichts verworfen')
  p(wischSprung(null, undefined, B, H), false, 'und Unsinn wirft nicht')

  // ── WAS ZU RAND UND FINGERZAHL GEHOERT ──────────────────────────────
  // SEIT DEM 21.08.2026 TRAEGT DER RAND NUR NOCH EINE GESTE. Lautstaerke und
  // Player sind abgewandert (zwei Finger ueberall bzw. ein Streichen ueber den
  // Player); die MECHANIK ist mehrzahlfaehig geblieben, und genau das pruefen
  // die Faelle mit zwei Eintraegen weiter unten.
  const werk = { schnellwahl: { rand: 'rechts', finger: 3 } }
  p(wischTat(werk, 'rechts', 3), 'schnellwahl', 'drei Finger rechts sind das Fenster')
  p(wischTat(werk, 'rechts', 1), '', 'eine andere Fingerzahl hat nichts')
  p(wischTat(werk, 'rechts', 2), '', 'und zwei Finger erst recht nicht — die gehoeren der Steuerung')
  p(wischTat(werk, 'links', 1), '', 'ein anderer Rand hat nichts')
  p(wischTat(werk, 'rechts', 4), '', 'vier Finger gibt es nicht')
  p(wischTat(werk, 'rechts', 0), '', 'null Finger auch nicht')
  p(wischTat(werk, '', 1), '', 'ohne Rand nichts')
  p(wischTat(null, 'rechts', 1), '', 'ohne Belegung nichts')
  // 'aus' IST KEIN RAND. Waere es einer, loeste eine abgeschaltete Tat aus,
  // sobald `wischRaenderVon` einmal nichts findet.
  p(wischTat({ playerWeg: { rand: 'aus', finger: 1 } }, 'aus', 1), '', 'ausgeschaltet loest nichts aus')
  // DER VORRANG BEI EINER DOPPELBELEGUNG steht in WISCH_TATEN und sonst
  // nirgends. Eine von Hand geschriebene darstellung.json kann sie enthalten.
  // MIT NUR EINER TAT KANN ES HEUTE KEINE DOPPELUNG GEBEN. Die Regel wird
  // trotzdem geprueft — mit einer erfundenen zweiten Tat, denn die naechste
  // echte kommt bestimmt, und dann soll der Vorrang schon belegt sein.
  const doppelt = { schnellwahl: { rand: 'oben', finger: 2 }, spaeter: { rand: 'oben', finger: 2 } }
  p(wischTat(doppelt, 'oben', 2), WISCH_TATEN[0], 'bei Doppelbelegung gewinnt die erste der Liste')

  // ── EINSTELLEN RAEUMT DIE DOPPELUNG AUS ─────────────────────────────
  // Ohne das stuende die verdraengte Zeile weiter in der Oberflaeche und taete
  // nichts — die stillste Sorte Fehler, die dieses Stueck haben kann.
  {
    const neu = wischBelegen(werk, 'schnellwahl', 'oben', 1)
    p(neu.schnellwahl, { rand: 'oben', finger: 1 }, 'die gesetzte Tat steht, wo sie hin soll')
    // UND DIE URSPRUNGSBELEGUNG BLEIBT UNANGETASTET. Eine Funktion, die ihr
    // Eingabeobjekt aendert, faellt genau dann auf, wenn der Aufrufer den
    // alten Stand noch braucht — also beim Zuruecknehmen.
    p(werk.schnellwahl.rand, 'rechts', 'das Eingabeobjekt wird nicht veraendert')
  }
  {
    // ABSCHALTEN GEHT WEITERHIN ueber den Rand 'aus'.
    p(wischBelegen(werk, 'schnellwahl', 'aus', 3).schnellwahl.rand, 'aus', 'abgeschaltet heisst aus')
  }
  {
    // DERSELBE PLATZ NOCH EINMAL DARF SICH NICHT SELBST VERDRAENGEN.
    const gleich = wischBelegen(werk, 'schnellwahl', 'rechts', 3)
    p(gleich.schnellwahl, { rand: 'rechts', finger: 3 }, 'sich selbst zu setzen aendert nichts')
  }
  p(wischBelegen(werk, 'gibtsnicht', 'rechts', 1), werk, 'eine unbekannte Tat aendert nichts')
  p(wischBelegen(null, 'schnellwahl', 'links', 2).schnellwahl, { rand: 'links', finger: 2 }, 'aus dem Nichts wird eine ganze Belegung')
  // JEDE der drei Taten muss sich auf JEDEN Rand mit JEDER Fingerzahl legen
  // lassen — sonst gaebe es Kombinationen, die die Oberflaeche anbietet und
  // die nie ausloesen.
  for (const tat of WISCH_TATEN) {
    for (const rand of WISCH_RAENDER) {
      for (const finger of [1, 2, 3]) {
        const b = wischBelegen(werk, tat, rand, finger)
        p(wischTat(b, rand, finger), tat, `${tat} auf ${rand}/${finger} loest aus`)
      }
    }
  }

  // ── ZIEHEN WIRD LAUTSTAERKE ─────────────────────────────────────────
  // Ein Vorzeichenfehler macht aus lauter leiser, und das merkt man erst am
  // Geraet — die Zahl auf dem Schirm sieht in beiden Faellen richtig aus.
  p(wischLautWert(50, 0, 480, 100), 50, 'ohne Bewegung bleibt es stehen')
  p(wischLautWert(50, 240, 480, 100), 100, 'die halbe Kante nach oben sind 50 Prozent mehr')
  p(wischLautWert(50, -240, 480, 100), 0, 'und nach unten ebenso viel weniger')
  p(wischLautWert(50, 4800, 480, 100), 100, 'ueber das Ende hinaus bleibt es bei 100')
  p(wischLautWert(50, -4800, 480, 100), 0, 'und darunter bei 0')
  // DIE GRENZE DER BOX GILT. `maxVolume` steckt in `max`; wer sie ignoriert,
  // zeigte einen Wert an, den `mupi-lautstaerke.sh` gleich wieder abweist.
  p(wischLautWert(50, 480, 480, 60), 60, 'die Obergrenze der Box wird eingehalten')
  p(wischLautWert(null, 240, 480, 100), 50, 'ohne Ausgangswert wird von null gezaehlt')
  p(wischLautWert(50, 240, 0, 100), 100, 'ohne Spanne wird nicht durch null geteilt')

  // ── DIE BESCHRIFTUNG ────────────────────────────────────────────────
  // Sie steht an drei Orten (Eltern-Bereich, Admin-Board, Meldung). Drei
  // Formulierungen desselben Sachverhalts liefen auseinander.
  p(wischWort('rechts', 1), 'Von rechts, 1 Finger', 'eine Belegung als Satz')
  p(wischWort('oben', 3), 'Von oben, 3 Finger', 'und im Plural')
  p(wischWort('aus', 1), 'Aus', 'abgeschaltet heisst Aus')
  p(wischWort('rechts', 0), 'Aus', 'eine Fingerzahl, die es nicht gibt, heisst auch Aus')
  p(wischWort('rechts', 9), 'Aus', 'und eine zu grosse ebenfalls')
  // DIE BESCHRIFTUNG DARF NICHTS BEHAUPTEN, WAS `wischTat` NICHT KENNT: eine
  // Zeile, die eine Geste nennt, die nie ausloest, ist eine Attrappe.
  for (const rand of [...WISCH_RAENDER, 'aus', '', null]) {
    for (const finger of [0, 1, 2, 3, 4]) {
      const b = wischBelegen(null, 'schnellwahl', rand, finger)
      const loest = wischTat(b, rand, finger) === 'schnellwahl'
      p(wischWort(rand, finger) !== 'Aus', loest, `Beschriftung und Wirkung stimmen ueberein (${rand}/${finger})`)
    }
  }
}

console.log('── Zwei Finger, überall ───────────────────────────────────')
{
  const M = ZWEI_MIND_PX

  // ── TON ODER TITEL? ─────────────────────────────────────────────────
  // Die Regel, an der ein Fehler am teuersten ist: Faellt sie falsch aus,
  // springt die Box beim Lauterdrehen eine Folge weiter — und das merkt man
  // erst, wenn die Musik eine andere ist.
  p(zweiAchse(0, -M, M), 'laut', 'nach oben meint den Ton')
  p(zweiAchse(0, M, M), 'laut', 'nach unten auch')
  p(zweiAchse(-M, 0, M), 'lauf', 'nach links meint den Titel')
  p(zweiAchse(M, 0, M), 'lauf', 'nach rechts auch')
  p(zweiAchse(0, -(M - 1), M), '', 'einen Pixel zu wenig ist noch nichts')
  p(zweiAchse(10, -60, M), 'laut', 'schräg, aber überwiegend senkrecht')
  p(zweiAchse(60, -10, M), 'lauf', 'schräg, aber überwiegend waagerecht')
  // GENAU DIAGONAL ERGIBT NICHTS — dieselbe Entscheidung wie am Rand: bei 45
  // Grad ist keine der beiden Richtungen gemeint.
  p(zweiAchse(50, 50, M), '', 'genau diagonal ergibt nichts')
  p(zweiAchse(0, 0, M), '', 'ohne Bewegung nichts')
  p(zweiAchse(null, undefined, M), '', 'und Unsinn wirft nicht')

  // ── WELCHE RICHTUNG IST „VOR"? ──────────────────────────────────────
  // Vertauscht heisst: „vor" geht zurueck. Am Schirm sieht beides gleich aus.
  p(zweiLauf(-80), 'next', 'nach links ist vorwärts')
  p(zweiLauf(80), 'previous', 'nach rechts ist zurück')
  // DIE BEFEHLE MUESSEN DIE SEIN, DIE DER ABSPIELDIENST KENNT. `playpause`
  // kennt er NICHT (llmwiki playpause-gibt-es-nicht) — diese beiden schon,
  // sie haengen auch an den Knoepfen des Mini-Players.
  p([zweiLauf(-1), zweiLauf(1)].sort(), ['next', 'previous'], 'es sind genau die zwei echten Befehle')

  // ── TIPP ODER ZUG? ──────────────────────────────────────────────────
  p(zweiTipp(100, 5), true, 'kurz und ruhig ist ein Tipp')
  p(zweiTipp(ZWEI_TIPP_MS, ZWEI_TIPP_PX), true, 'genau an der Grenze noch')
  p(zweiTipp(ZWEI_TIPP_MS + 1, 0), false, 'eine Millisekunde zu lang ist keiner')
  p(zweiTipp(50, ZWEI_TIPP_PX + 1), false, 'ein Pixel zu weit auch nicht')
  // DAS IST DIE ZEILE, DIE DEN DOPPELTIPP VOR DEM WISCHEN SCHUETZT: Ein sehr
  // schneller Zug ist kurz — ohne die Wegprobe waere er ein Tipp, und zwei
  // schnelle Wischer nach oben hielten die Wiedergabe an.
  p(zweiTipp(60, 200), false, 'ein schneller ZUG ist kein Tipp')
  p(zweiTipp(-1, 0), false, 'eine negative Dauer ist keiner')
  p(zweiTipp(null, null), false, 'und Unsinn wirft nicht')
}

console.log('\n── memBrettMasse ──────────────────────────────────────────')
{
  // DIE PRUEFUNG FRAGT NICHT NACH DER ZAHL, SONDERN NACH DER EIGENSCHAFT:
  // Das Brett muss PASSEN. Eine feste Erwartung („auf 800x480 sind es vier
  // Spalten") waere genau die Sorte festgenagelte Zahl, die beim naechsten
  // Feinschliff rot wird, ohne dass etwas kaputt ist — die Funktion darf
  // jede Aufteilung waehlen, solange das Ergebnis hineinpasst.
  const passt = (n, b, h, l) => {
    const m = memBrettMasse(n, b, h, l)
    const reihen = Math.ceil(n / m.spalten)
    return (
      m.spalten >= 2 &&
      m.karte > 0 &&
      m.spalten * m.karte + l * (m.spalten - 1) <= b + 0.001 &&
      reihen * m.karte + l * (reihen - 1) <= h + 0.001
    )
  }
  p(passt(12, 712, 330, 10), true, 'zwoelf Karten passen in die Buehne')
  p(passt(4, 712, 330, 10), true, 'vier Karten passen')
  p(passt(6, 712, 330, 10), true, 'sechs Karten passen')
  p(passt(12, 300, 300, 10), true, 'auch auf einer engen, quadratischen Flaeche')
  p(passt(12, 712, 120, 10), true, 'und auf einer sehr flachen')

  // DIE KARTE WIRD SO GROSS WIE MOEGLICH — das ist der Sinn der Rechnung.
  // Gegenprobe: eine andere Spaltenzahl darf nicht besser sein.
  {
    const m = memBrettMasse(12, 712, 330, 10)
    let besser = false
    for (let s = 2; s <= 12; s++) {
      const r = Math.ceil(12 / s)
      const k = Math.min((712 - 10 * (s - 1)) / s, (330 - 10 * (r - 1)) / r)
      if (k > m.karte + 0.001) besser = true
    }
    p(besser, false, 'keine andere Spaltenzahl gibt eine groessere Karte')
  }

  // MEHR FLAECHE DARF NIE EINE KLEINERE KARTE ERGEBEN.
  p(
    memBrettMasse(12, 900, 400, 10).karte >= memBrettMasse(12, 712, 330, 10).karte,
    true,
    'mehr Platz ergibt keine kleinere Karte',
  )

  // DAS VOLLBILD-BRETT (E139): doppelt so viele Paare, und jede Karte bleibt
  // ueber dem Griff (66 px, ISO 9241-411 — die Herleitung steht bei
  // `--griff` in app.css). Die Flaeche ist die Vollbild-Buehne von 800x480
  // heruntergerechnet: links 96 px Rueckweg-Spalte, rechts 16 und oben 78
  // aus dem Buehnenpolster, unten 12 plus rund 50 fuer die Knopfzeile und 20
  // fuer die Uhr der Spielart „Verrueckt" — 688 x 320 ist also der KNAPPSTE
  // Fall, nicht der bequemste. Gefragt wird die EIGENSCHAFT (Karte >= Griff),
  // nicht eine feste Kartengroesse — die Aufteilung darf sich aendern.
  p(memBrettMasse(MEM_VOLL_PAARE * 2, 688, 320, 10).karte >= 66, true, 'Vollbild: jede der ' + MEM_VOLL_PAARE * 2 + ' Karten haelt den Griff')
  p(MEM_VOLL_PAARE > MEM_PAARE_HOECHSTENS, true, 'Vollbild heisst MEHR Karten, nicht andere')
}

console.log('\n── memCrazyZeitS / memNaechsterDran / memPaareZahl ────────')
{
  // DIE UHR DER SPIELART „VERRUECKT": faellt je Stufe, nie unter die
  // Untergrenze — und die Untergrenze selbst muss einen Zug samt Zeigezeit
  // zulassen, sonst ist das Spiel nicht schwer, sondern unmoeglich. KEINE
  // festen ZwischenWERTE: Wer die Start- oder Schrittzahl stimmt, soll hier
  // nichts nachziehen muessen, solange die Eigenschaften halten.
  p(memCrazyZeitS(1) === MEM_CRAZY_START_S, true, 'Stufe 1 bekommt die volle Uhr')
  {
    let faellt = true
    let haelt = true
    for (let s = 1; s <= 20; s++) {
      if (memCrazyZeitS(s + 1) > memCrazyZeitS(s)) faellt = false
      if (memCrazyZeitS(s) < MEM_CRAZY_MIN_S) haelt = false
    }
    p(faellt, true, 'jede Stufe ist hoechstens so lang wie die davor')
    p(haelt, true, 'keine Stufe faellt unter die Untergrenze')
  }
  p(memCrazyZeitS(999) === MEM_CRAZY_MIN_S, true, 'irgendwann traegt nur noch die Untergrenze')
  p(MEM_CRAZY_MIN_S * 1000 > MEM_ZEIGEN_MS + 2000, true, 'die Untergrenze laesst einen Zug samt Zeigezeit zu')
  p(memCrazyZeitS(0) === MEM_CRAZY_START_S, true, 'Unsinn faellt auf Stufe 1 zurueck')
  p(memCrazyZeitS(null) === MEM_CRAZY_START_S, true, 'und wirft nicht')

  // ZU ZWEIT WECHSELT ES IMMER — auch nach einem Treffer. Das ist die
  // BESTELLTE Regel (Betreiber, 09.09.2026: „wechselt es immer") und nicht
  // die Turnierregel; am Brett saehe beides gleich richtig aus. Der Rufer
  // kennt keinen Treffer-Parameter, also KANN er die Turnierregel nicht
  // bauen — dieser Block haelt fest, dass das so bleibt.
  p(memNaechsterDran(2, 1), 2, 'nach Spieler 1 kommt Spieler 2')
  p(memNaechsterDran(2, 2), 1, 'nach Spieler 2 kommt Spieler 1')
  p(memNaechsterDran(1, 1), 1, 'alleine bleibt es bei Spieler 1')
  p(memNaechsterDran(0, 2), 1, 'Unsinn gehoert Spieler 1')
  p(memNaechsterDran(2, 7), 1, 'ein fremder Stand faellt auf Spieler 1 zurueck')

  // DIE PAARZAHL: unterm Deckel der Ansicht, unterm Vorrat, nie unter Null.
  p(memPaareZahl(false, 99), MEM_PAARE_HOECHSTENS, 'klein deckelt auf das kleine Brett')
  p(memPaareZahl(true, 99), MEM_VOLL_PAARE, 'Vollbild deckelt auf das grosse')
  p(memPaareZahl(true, 3), 3, 'der Vorrat deckelt beide')
  p(memPaareZahl(false, 0), 0, 'ohne Vorrat kein Paar')
  p(memPaareZahl(true, -4), 0, 'ein negativer Vorrat ergibt kein Minus-Brett')
  p(memPaareZahl(true, 4.9), 4, 'ein halber Vorrat zaehlt nicht als Paar')
  p(
    memPaareZahl(true, MEM_PAARE_MINDESTENS) >= MEM_PAARE_MINDESTENS,
    true,
    'der kleinste Vorrat, der ein Spiel traegt, traegt es auch im Vollbild',
  )
}

console.log('\n── memHashAbstand / memHashNeu (die Cover-Aussiebung) ─────')
{
  // WAS DIESE REGELN TRAGEN (E140): Zwei Titel desselben Albums und die 60
  // Platzhalter-Alben (llmwiki rueckfallbild-macht-den-fehler-unsichtbar)
  // liefern je EIGENE Adressen und DASSELBE Bild. Nur der Inhalt trennt sie
  // noch — und ein Fehler hier ist in beide Richtungen still: zu scharf
  // gesiebt heisst „zu wenige Bilder" ohne erkennbaren Grund, zu lasch
  // gesiebt heisst, alles ist wie vorher und nichts wird rot.
  const a = '1'.repeat(64)
  const b = '0'.repeat(64)
  p(memHashAbstand(a, a), 0, 'derselbe Hash hat Abstand null')
  p(memHashAbstand(a, b), 64, 'der Gegenhash hat vollen Abstand')
  p(memHashAbstand('1100', '1010'), 2, 'zwei verschiedene Bit sind Abstand zwei')
  p(memHashAbstand('1100', '1000'), memHashAbstand('1000', '1100'), 'der Abstand ist in beide Richtungen gleich')

  // NICHT VERGLEICHBAR IST NICHT NULL. Ein Abstand 0 bei Unsinn hiesse
  // „gleiches Bild" und siebte die Karte aus — der stillste denkbare Fehler.
  p(memHashAbstand('110', '1100'), -1, 'verschiedene Laengen sind nicht vergleichbar')
  p(memHashAbstand(null, a), -1, 'null ist kein Hash')
  p(memHashAbstand('', ''), -1, 'und leer auch nicht')

  p(memHashNeu([], a, MEM_HASH_GLEICH), true, 'der erste Hash ist immer neu')
  p(memHashNeu([a], a, MEM_HASH_GLEICH), false, 'derselbe Platzhalter kommt kein zweites Mal')
  p(memHashNeu([a], b, MEM_HASH_GLEICH), true, 'ein wirklich anderes Bild kommt durch')
  p(memHashNeu([a], '0' + '1'.repeat(63), MEM_HASH_GLEICH), false, 'ein Bit Unterschied ist dasselbe Bild')
  // EIN UNVERGLEICHBARER HASH GILT ALS NEU: Die Aussiebung ist eine
  // Verbesserung, kein Torwaechter — lieber eine Karte zu viel als ein
  // Spiel, das an einer misslungenen Messung leer bleibt.
  p(memHashNeu([a], 'kaputt', MEM_HASH_GLEICH), true, 'was sich nicht messen laesst, faellt nicht durch')
  p(memHashNeu(null, a, MEM_HASH_GLEICH), true, 'ohne Gesehenes wirft es nicht')

  // DIE SCHWELLE MUSS ZWISCHEN DEN BEIDEN FEHLERN LIEGEN.
  p(MEM_HASH_GLEICH > 0 && MEM_HASH_GLEICH < 32, true, 'die Schwelle siebt weder alles noch nichts')
}

console.log('\n── memWortAusDatei ────────────────────────────────────────')
{
  // Der Name auf der OFFENEN Karte. Leer darf nichts herauskommen: ein
  // `aria-label=""` liest sich als „Knopf" vor und sagt weniger als nichts.
  p(memWortAusDatei('papagei.jpg'), 'Papagei', 'aus dem Dateinamen wird das Wort')
  p(memWortAusDatei('taenzerin-mantel.jpg'), 'Taenzerin mantel', 'Bindestriche werden Luecken')
  p(memWortAusDatei('vase-amphore.jpg'), 'Vase amphore', 'und die Endung faellt weg')
  p(memWortAusDatei(''), 'Karte', 'ohne Namen bleibt ein Wort stehen')
  p(memWortAusDatei(null), 'Karte', 'und Unsinn wirft nicht')
}

console.log('\n── puzMischen / puzGeloest ────────────────────────────────')
{
  // DIE EIGENSCHAFT, AUF DIE ES ANKOMMT: jedes gemischte Brett ist LOESBAR.
  // Gemessen wird sie ueber die Parität — bei ungerader Kante ist ein 3x3-
  // Schiebepuzzle genau dann loesbar, wenn die Zahl der Inversionen (ohne die
  // Luecke) GERADE ist. Die Rechnung steht hier und nicht im Quelltext: dort
  // wird sie nicht gebraucht, weil aus der Loesung heraus gemischt wird — und
  // GENAU DAS prueft dieser Test.
  const inversionen = (lage) => {
    const s = lage.filter((x) => x !== null)
    let n = 0
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (s[i] > s[j]) n++
    return n
  }
  let alleLoesbar = true
  let alleVollstaendig = true
  for (let i = 0; i < 300; i++) {
    const lage = puzMischen(PUZ_KANTE, 60)
    if (inversionen(lage) % 2 !== 0) alleLoesbar = false
    // Jeder Stein genau einmal, und genau eine Luecke.
    const gesehen = new Set(lage)
    if (gesehen.size !== PUZ_KANTE * PUZ_KANTE || lage.filter((x) => x === null).length !== 1) {
      alleVollstaendig = false
    }
  }
  p(alleLoesbar, true, '300 gemischte Bretter sind alle loesbar')
  p(alleVollstaendig, true, 'jeder Stein genau einmal, genau eine Luecke')

  // DIE GELOESTE LAGE WIRD ALS SOLCHE ERKANNT — und eine vertauschte nicht.
  const fertig = Array.from({ length: 9 }, (_, i) => (i === 8 ? null : i))
  p(puzGeloest(fertig), true, 'die geordnete Lage ist geloest')
  const vertauscht = fertig.slice()
  ;[vertauscht[0], vertauscht[1]] = [vertauscht[1], vertauscht[0]]
  p(puzGeloest(vertauscht), false, 'zwei vertauschte Steine sind es nicht')

  // NACHBARN: nur waagerecht und senkrecht, nie ueber den Rand.
  p(puzNachbarn(0, 3).sort().join(','), '1,3', 'die Ecke oben links hat zwei Nachbarn')
  p(puzNachbarn(4, 3).sort().join(','), '1,3,5,7', 'die Mitte hat vier')
  p(puzNachbarn(2, 3).includes(3), false, 'kein Sprung ueber den rechten Rand')
}

console.log('\n── rechenAufgabe ──────────────────────────────────────────')
{
  let nieNegativ = true
  let imRaum = true
  let beideArten = new Set()
  for (let i = 0; i < 500; i++) {
    const a = rechenAufgabe()
    if (a.antwort < 0) nieNegativ = false
    if (a.antwort > RECH_BIS) imRaum = false
    beideArten.add(a.text.includes('+') ? 'plus' : 'minus')
    // Der Text muss zur Antwort passen — sonst steht eine Aufgabe da, deren
    // richtige Loesung gar nicht angeboten wird.
    const m = a.text.match(/(\d+) ([+−]) (\d+)/)
    const soll = m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) - Number(m[3])
    if (soll !== a.antwort) imRaum = false
  }
  p(nieNegativ, true, '500 Aufgaben: nie ein negatives Ergebnis')
  p(imRaum, true, 'Ergebnis im Zahlenraum und passend zum Text')
  p([...beideArten].sort().join(','), 'minus,plus', 'es kommen beide Rechenarten vor')
}

console.log('\n── uhrWort / uhrAuswahl ───────────────────────────────────')
{
  // DIE EINE REGEL, UM DIE ES GEHT: „halb" zeigt auf die NAECHSTE Stunde.
  p(uhrWort(3, 0), '3 Uhr', 'volle Stunde')
  p(uhrWort(3, 30), 'halb 4', 'halb 4 ist halb VIER, also 3:30')
  p(uhrWort(12, 30), 'halb 1', 'nach zwoelf kommt eins, nicht dreizehn')
  p(uhrWort(11, 30), 'halb 12', 'und davor halb zwoelf')
  p(uhrWort(12, 0), '12 Uhr', 'zwoelf bleibt zwoelf')
  // Kein „0 Uhr" und kein „13 Uhr" — das Zifferblatt hat nur 1 bis 12.
  let alleImKreis = true
  for (let h = 1; h <= 12; h++) {
    for (const m of [0, 30]) {
      const w = uhrWort(h, m)
      const zahl = Number(w.replace(/[^0-9]/g, ''))
      if (!(zahl >= 1 && zahl <= 12)) alleImKreis = false
    }
  }
  p(alleImKreis, true, 'alle 24 Zeiten nennen eine Zahl von 1 bis 12')

  // DIE AUSWAHL: die richtige ist dabei, nichts doppelt, und genau so viele.
  let stimmt = true
  for (let h = 1; h <= 12; h++) {
    for (const m of [0, 30]) {
      const w = uhrAuswahl({ stunde: h, minute: m }, 3)
      if (w.length !== 3) stimmt = false
      if (!w.includes(uhrWort(h, m))) stimmt = false
      if (new Set(w).size !== w.length) stimmt = false
    }
  }
  p(stimmt, true, 'jede Auswahl: drei verschiedene, die richtige dabei')
  // DIE HALBE STUNDE DANEBEN IST DIE VERWECHSLUNG, um die es geht — sie muss
  // zur Wahl stehen, sonst prueft das Spiel nur den Stundenzeiger.
  p(uhrAuswahl({ stunde: 3, minute: 0 }, 3).includes('halb 4'), true, 'die halbe Stunde steht mit zur Wahl')
}

console.log('\n── uhrSatz (Ansage der Uhrzeit) ────────────────────────────')
{
  // NICHT ZU VERWECHSELN MIT `uhrWort` darueber: Das ist das LERNSPIEL und
  // kennt nur den Zwoelferkreis mit voller und halber Stunde („halb 4").
  // `uhrSatz` sagt die WIRKLICHE Zeit an, und die ist um 15:43 keine halbe.
  p(uhrSatz(15, 43), 'Es ist 15 Uhr 43.', 'Stunde und Minute')
  p(uhrSatz(15, 0), 'Es ist 15 Uhr.', 'zur vollen Stunde OHNE die Null')
  // FUEHRENDE NULL RAUS: Die Anzeige schreibt „15:05" (feste Breite), Piper
  // spraeche die Null als eigene Zahl mit.
  p(uhrSatz(15, 5), 'Es ist 15 Uhr 5.', 'einstellige Minute ohne fuehrende Null')
  p(uhrSatz(0, 0), 'Es ist 0 Uhr.', 'Mitternacht ist 0 Uhr und nicht 24')
  p(uhrSatz(23, 59), 'Es ist 23 Uhr 59.', 'die letzte Minute des Tages')
  // AUSSERHALB DER UHR KOMMT NICHTS HERAUS UND KEIN SATZ MIT EINER FALSCHEN
  // ZAHL DARIN: `stimme.sprich` steigt bei leerem Text aus, also bleibt die
  // Box still. Ein „Es ist 24 Uhr 70" waere die schlimmere Antwort — sie
  // klingt genau wie eine richtige.
  let nieUnsinn = true
  for (const [h, m] of [[24, 0], [-1, 0], [0, 60], [0, -1], [NaN, 0], [0, NaN], ['x', 'y'], [undefined, undefined]]) {
    if (uhrSatz(h, m) !== '') nieUnsinn = false
  }
  p(nieUnsinn, true, 'unmoegliche Zeiten ergeben KEINEN Satz')
  // JEDE MOEGLICHE MINUTE DES TAGES ERGIBT EINEN SATZ — sonst waere die Box
  // an einer davon still, und zwar an einer, die niemand von Hand probiert.
  let alleReden = true
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m++) {
      const s = uhrSatz(h, m)
      if (!s.startsWith('Es ist ') || !s.endsWith('.')) alleReden = false
      // Die Zahlen im Satz muessen die uebergebenen sein: ein Dreher faellt
      // an einer einzelnen Stichprobe nicht auf, an 1440 schon.
      const zahlen = s.match(/\d+/g).map(Number)
      const soll = m === 0 ? [h] : [h, m]
      if (zahlen.join(',') !== soll.join(',')) alleReden = false
    }
  }
  p(alleReden, true, 'alle 1440 Minuten des Tages ergeben den passenden Satz')
}

console.log(fehler ? `\n${fehler} FEHLER` : '\nalle Regeln stimmen')
process.exitCode = fehler ? 1 : 0
