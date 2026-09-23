// ERZEUGT — nicht von Hand aendern (tools/neu-regeln-auszug.py).
const PUZ_KANTE = 3
const PUZ_MISCHZUEGE = 60
const RECH_BIS = 10
const RECH_WAHLEN = 3
const SPERR_ARTEN = ['aus', 'rechnen', 'pin', 'geste']
const GESTE_ECKE_HOECHSTENS_PX = 120
const GESTE_ECKE_MINDESTENS_PX = 66
const MEM_PAARE_HOECHSTENS = 6
const MEM_PAARE_MINDESTENS = 2
const MEM_VOLL_PAARE = 12
const MEM_CRAZY_START_S = 30
const MEM_CRAZY_SCHRITT_S = 5
const MEM_CRAZY_MIN_S = 10
const MEM_ZEIGEN_MS = 900
const MEM_HASH_GLEICH = 5
const GESTE_ECKE_ANTEIL = 0.2
const GESTE_FENSTER_MS = 4000
const GESTE_ECKEN = 4
const TOR_WARTEN_S = [0, 5, 15, 30, 60]
const GESTE_FREI = 12
const SPERR_WORT = { aus: 'Keine Sperre', rechnen: 'Rechenaufgabe', pin: 'PIN, selbst festgelegt', geste: 'Geste — vier Ecken' }
const KACHEL_STUFEN = [0.8, 1, 1.3, 1.6]
const KACHEL_WORT = { 0.8: 'klein', 1: 'normal', 1.3: 'groß', 1.6: 'sehr groß' }
const SPOTIFY_EINRICHT_PORT = 8443
const WAPPEN_TIPPS = 3
const WAPPEN_TIPP_FENSTER_MS = 2500
const AKKU_LUECKE_MIN_MS = 300000
const AKKU_LUECKE_FAKTOR = 4
const AKKU_ACHS_STUFEN = [900000, 1800000, 3600000, 7200000, 10800000, 21600000, 43200000, 86400000, 172800000]
const AKKU_ACHS_MARKEN = 7
const AKKU_RUHE_MA = 20
const AKKU_MIND_PUNKTE = 3
const AKKU_MIND_SPANNE_MS = 900000
const AKKU_FLACH_PROZENT = 1
const AKKU_SPANNEN = [24, 168]
const AKKU_WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const SYS_SPANNEN = [24, 168]
const SYS_GRAD_VON = 30
const SYS_GRAD_BIS = 90
const SYS_GRAD_MARKE = 80
const WISCH_RAND_VORGABE_PX = 28
const WISCH_RAND_MIND_PX = 12
const WISCH_RAND_HOECHST_PX = 96
const WISCH_ZUG_PX = 44
const WISCH_FENSTER_MS = 900
const WISCH_SPRUNG_ANTEIL = 0.5
const WISCH_RAENDER = ['links', 'rechts', 'oben', 'unten']
const WISCH_TATEN = ['schnellwahl']
const WISCH_HAND_PX = 160
const ZWEI_MIND_PX = 36
const ZWEI_TIPP_MS = 260
const ZWEI_TIPP_PX = 24
const ZWEI_DOPPEL_MS = 420
function boxnameTeilen(roh) {
    const name = typeof roh === 'string' ? roh.trim() : ''
    if (!name) return null
    const rest = name.slice(0, -3).trim()
    if (rest && name.slice(-3).toLowerCase() === 'box') return { oben: rest, unten: name.slice(-3) }
    return { oben: name, unten: '' }
  }
function naechsterRueckweg(lage) {
    if (!lage) return null
    // DIE AUSWAHL „WER HOERT" LIEGT GANZ OBEN (05.08.2026). Sie ist die
    // einzige Ebene, die sich UEBER dem Eltern-Bereich oeffnen liesse, wenn
    // jemand sie einmal von dort aus aufruft — und sie ist mit z-index 8
    // genauso hoch. Der Grund fuer diese Zeile ist derselbe wie fuer die
    // naechste: was oben liegt, geht zuerst.
    //
    // SEIT DEM 06.08.2026 KANN DIESER FALL GAR NICHT MEHR EINTRETEN, und die
    // Zeile bleibt trotzdem stehen. Was sich geaendert hat: Der Eltern-Bereich
    // sperrt das Zeichen „wer hoert" jetzt ausdruecklich (`eltern.auf()` setzt
    // `#ich` auf `disabled`) und schliesst ein etwa offenes Fenster. Vorher
    // hing dasselbe an der Geometrie — das Zeichen lag unter dem Deckel — und
    // GENAU DIESE Absicherung ist mit der neuen Form gefallen: gemessen ging
    // das Fenster hinter dem Bereich auf, unsichtbar und unbedienbar, und der
    // Rueckweg raeumte es beim ERSTEN Tipp weg, ohne dass sich am Schirm etwas
    // ruehrte ([[rueckweg-lag-ueber-der-meldung]]).
    // Sie bleibt, weil sie nichts kostet und der zweite Riegel ist: wer den
    // ersten (die Zeile in `eltern.auf`) eines Tages entfernt, bekommt keinen
    // Rueckweg, der ins Leere greift.
    if (lage.ichFenster) return 'ich'
    // GANZ OBEN, und das ist keine Geschmacksfrage: Der Eltern-Bereich liegt
    // mit z-index 8 ueber allem, was darunter offenstehen kann. Stuende er
    // weiter unten, schloesse ein Tipp auf den Rueckweg etwas, das gerade
    // niemand sieht — und der Eltern-Bereich bliebe stehen. Genau der Fehler,
    // gegen den diese Regel ueberhaupt geschrieben wurde.
    // ER DECKT SEIT DEM 06.08.2026 NICHT MEHR DIE GANZE SEITE AB (er beginnt
    // bei x 88 und laesst die Leiste und das Kissen frei, siehe `.eltern` in
    // app.css). Fuer diese Regel aendert das nichts: Leiste und Kissen sind
    // keine Ebenen, die ein Rueckweg schliessen koennte.
    if (lage.eltern) return 'eltern'
    // DAS SCHNELLFENSTER (21.08.2026) — mit z-index 8 wie die drei darum
    // herum, und als LETZTES im Baum gewinnt es unter ihnen die Ueberdeckung.
    // Es steht deshalb VOR `album-gross` und dem Player.
    //
    // HINTER `eltern` UND NICHT DAVOR, obwohl der Baum das Gegenteil sagt:
    // Die beiden koennen gar nicht zugleich offenstehen. `eltern.auf()` macht
    // das Fenster zu, bevor das Tor steht, und `schnell.durchDieSperre` macht
    // es zu, bevor es das Tor ruft. Diese Zeile ist der zweite Riegel — wer
    // einen der beiden eines Tages entfernt, bekommt keinen Rueckweg, der ins
    // Leere greift.
    if (lage.schnell) return 'schnell'
    // ── DIE BUEHNE EINER APP, DANN DIE SCHUBLADE (03.09.2026) ───
    // Zwei Ebenen, und sie muessen in DIESER Reihenfolge fallen: Die Buehne
    // liegt mit z-index 8 ueber der Schublade (7). Stuende die Schublade
    // hier oben, raeumte der erste Tipp sie weg — hinter der Buehne, wo
    // niemand es sieht — und die Buehne bliebe stehen. Genau der Fehler,
    // gegen den `naechsterRueckweg` ueberhaupt geschrieben ist.
    //
    // `appOeffnen` macht die Schublade beim Aufmachen ohnehin zu, die beiden
    // stehen also im Regelfall gar nicht zusammen offen. Diese Zeilen sind
    // der zweite Riegel — wer das dort eines Tages herausnimmt, bekommt
    // trotzdem keinen Rueckweg, der ins Leere greift.
    if (lage.albumGross) return 'album-gross'
    /* ── DER GROSSE PLAYER LIEGT VOR DEM SPIEL (04.09.2026) ───
     *
     * Betreiber: „der player soll vor dem spiel oeffnen, das spiel bleibt
     * dahinter". Zuvor ging er HINTER der Buehne auf (6 gegen 8) und war
     * dabei halb abgeschnitten: Die Buehne beginnt bei x 88 und endet ueberm
     * Kissen, alles ausserhalb dieses Rechtecks schaute hervor.
     *
     * GELOEST WIRD DAS NICHT HIER, sondern in app.css: Solange `#gross`
     * offen ist, faellt die Buehne auf z-index 4 zurueck. Der Player braucht
     * dafuer nicht zu steigen — zwischen 8 (Buehne) und 9 (dem einen
     * Rueckweg) ist kein Platz, und der Rueckweg muss erreichbar bleiben.
     *
     * HIER STEHT NUR DIE FOLGE DARAUS: Was oben liegt, geht zuerst. Der
     * Player kommt deshalb VOR die Buehne — und weiterhin NACH der grossen
     * Albumansicht, die aus ihm heraus geoeffnet wird und ueber ihm liegt.
     */
    /* DIE SCHUBLADE BLEIBT VOR DEM PLAYER: Die Leiste steigt beim Aufziehen
     * auf z-index 7 und liegt damit ueber ihm (6). Nur die BUEHNE tritt
     * zurueck, nicht die Schublade — der erste Anlauf hat den Player vor
     * beide gezogen, und die Pruefung hat es gefangen
     * („die Schublade liegt ueber Player und Regal"). */
    /* DIE BUEHNE STEHT AN ZWEI STELLEN, UND DAS IST KEIN VERSEHEN:
     * Sie liegt bei z-index 8 — ueber der Schublade (7) und dem Player (6).
     * NUR solange der grosse Player offen ist, faellt sie in app.css auf 4
     * zurueck und damit unter beide. Ihr Rang haengt also am Player, und
     * eine feste Reihenfolge kann das nicht ausdruecken.
     * Beide Anlaeufe davor sind an je einem Zeugen gescheitert: erst „die
     * Schublade liegt ueber Player und Regal", dann „beide offen: die Buehne
     * geht zuerst". Genau dafuer stehen sie da. */
    if (!lage.grosserPlayer && lage.appBuehne) return 'app-buehne'
    if (lage.schubladeOffen) return 'schublade'
    if (lage.grosserPlayer) return 'player'
    if (lage.appBuehne) return 'app-buehne'
    if (lage.titelListe) return 'titelliste'
    if (lage.lane) return 'lane'
    if (lage.interpretSeite) return 'interpret'
    if (lage.regal) return 'regal'
    return null
  }
function fassungBeschriften(h) {
    if (!h || typeof h !== 'object') return ''
    const zahl = Number(h.eigeneCommits)
    const schmutz = Number(h.unsauber)
    // Ein Baum mit ungespeicherten Aenderungen ist NICHT der Commit, aus dem
    // gebaut wurde — das Plus sagt genau das und nichts weiter.
    const plus = Number.isFinite(schmutz) && schmutz > 0 ? '+' : ''
    const kurz = typeof h.commit === 'string' && h.commit ? h.commit.slice(0, 7) + plus : ''
    const stuecke = []
    if (Number.isFinite(zahl) && zahl > 0) stuecke.push(String(zahl))
    if (kurz) stuecke.push(kurz)
    // Ohne Commit haengt das Plus an der Zahl — sonst fiele der Hinweis
    // ausgerechnet dann weg, wenn nur die Zahl da ist.
    if (!kurz && plus && stuecke.length) stuecke[0] += plus
    return stuecke.join(' · ')
  }
function memBrettMasse(n, breite, hoehe, luecke) {
    let beste = { spalten: 2, karte: 0 }
    for (let spalten = 2; spalten <= n; spalten++) {
      const reihen = Math.ceil(n / spalten)
      const karte = Math.min(
        (breite - luecke * (spalten - 1)) / spalten,
        (hoehe - luecke * (reihen - 1)) / reihen,
      )
      if (karte > beste.karte) beste = { spalten, karte }
    }
    return beste
  }
function memCrazyZeitS(stufe) {
    const s = Math.max(1, Math.floor(Number(stufe) || 1))
    return Math.max(MEM_CRAZY_MIN_S, MEM_CRAZY_START_S - MEM_CRAZY_SCHRITT_S * (s - 1))
  }
function memNaechsterDran(spielerzahl, dran) {
    if (spielerzahl !== 2) return 1
    return dran === 1 ? 2 : 1
  }
function memPaareZahl(voll, vorratZahl) {
    const deckel = voll ? MEM_VOLL_PAARE : MEM_PAARE_HOECHSTENS
    return Math.max(0, Math.min(deckel, Math.floor(Number(vorratZahl) || 0)))
  }
function memHashAbstand(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return -1
    if (a.length !== b.length || a.length === 0) return -1
    let n = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
    return n
  }
function memHashNeu(gesehen, hash, schwelle) {
    if (!Array.isArray(gesehen)) return true
    for (const alt of gesehen) {
      const d = memHashAbstand(alt, hash)
      if (d >= 0 && d <= schwelle) return false
    }
    return true
  }
function memWortAusDatei(datei) {
    const roh = String(datei || '').replace(/\.[a-z0-9]+$/i, '').replace(/-/g, ' ').trim()
    return roh ? roh.charAt(0).toUpperCase() + roh.slice(1) : 'Karte'
  }
function puzNachbarn(i, kante) {
    const z = Math.floor(i / kante)
    const s = i % kante
    const raus = []
    if (z > 0) raus.push(i - kante)
    if (z < kante - 1) raus.push(i + kante)
    if (s > 0) raus.push(i - 1)
    if (s < kante - 1) raus.push(i + 1)
    return raus
  }
function puzMischen(kante, zuege) {
    const n = kante * kante
    const lage = Array.from({ length: n }, (_, i) => (i === n - 1 ? null : i))
    let luecke = n - 1
    let zuletzt = -1
    for (let i = 0; i < zuege; i++) {
      const mgl = puzNachbarn(luecke, kante).filter((x) => x !== zuletzt)
      const ziel = mgl[Math.floor(Math.random() * mgl.length)]
      lage[luecke] = lage[ziel]
      lage[ziel] = null
      zuletzt = luecke
      luecke = ziel
    }
    return lage
  }
function puzGeloest(lage) {
    return lage.every((h, i) => (i === lage.length - 1 ? h === null : h === i))
  }
function rechenAufgabe() {
    const plus = Math.random() < 0.5
    if (plus) {
      const a = 1 + Math.floor(Math.random() * (RECH_BIS - 1))
      const b = 1 + Math.floor(Math.random() * (RECH_BIS - a))
      return { text: `${a} + ${b}`, antwort: a + b }
    }
    // ABZIEHEN NIE UNTER NULL: Negative Zahlen sind kein Vorschulstoff, und
    // eine Aufgabe mit der Antwort -3 waere nicht schwer, sondern falsch.
    const a = 2 + Math.floor(Math.random() * (RECH_BIS - 1))
    const b = 1 + Math.floor(Math.random() * (a - 1))
    return { text: `${a} − ${b}`, antwort: a - b }
  }
function uhrWort(stunde, minute) {
    const h = ((stunde - 1 + 12) % 12) + 1
    if (minute === 30) return `halb ${(h % 12) + 1}`
    return `${h} Uhr`
  }
function uhrAuswahl(zeit, wieViele) {
    const worte = [uhrWort(zeit.stunde, zeit.minute)]
    const kandidaten = [
      { stunde: zeit.stunde, minute: zeit.minute === 0 ? 30 : 0 },
      { stunde: (zeit.stunde % 12) + 1, minute: zeit.minute },
      { stunde: ((zeit.stunde - 2 + 12) % 12) + 1, minute: zeit.minute },
      { stunde: (zeit.stunde % 12) + 1, minute: zeit.minute === 0 ? 30 : 0 },
    ]
    for (const k of kandidaten) {
      if (worte.length >= wieViele) break
      const w = uhrWort(k.stunde, k.minute)
      if (!worte.includes(w)) worte.push(w)
    }
    return worte
  }
function sperrModus(wert) {
    const w = String(wert === null || wert === undefined ? '' : wert)
      .trim()
      .toLowerCase()
    if (SPERR_ARTEN.includes(w)) return w
    // ALLES ANDERE HEISST JETZT „rechnen", nicht „aus". Auch ein leerer und
    // ein unbekannter Wert: beides ist keine Entscheidung fuer „offen",
    // sondern eine fehlende Entscheidung — und eine fehlende Entscheidung
    // darf nicht die schwaechste sein. „aus" bekommt, wer „aus" hinschreibt.
    return 'rechnen'
  }
function torFertig(modus, eingabe) {
    const e = String(eingabe === null || eingabe === undefined ? '' : eingabe)
    if (modus === 'pin') return e.length >= 4 && e.length <= 8
    if (modus === 'rechnen') return e.length > 0
    return false
  }
function zifferDazu(bisher, ziffer, max) {
    const b = String(bisher === null || bisher === undefined ? '' : bisher)
    if (!/^[0-9]$/.test(String(ziffer))) return b
    if (b.length >= max) return b
    return b + ziffer
  }
function btZeile(g) {
    const name = (g && g.name) || 'Unbekanntes Gerät'
    /* SPIELT DIESES GERAET GERADE? — DREI ZUSTAENDE, NICHT ZWEI.
     *
     * `true` spielt hier · `false` verbunden, aber still · `null` weiss ich
     * nicht (eine Box, deren Server `/api/ton/ausgaenge` noch nicht kennt).
     * Die ganze Begruendung steht unten bei `tat`.
     *
     * SIE STEHT HIER OBEN, weil sie WEITER UNTEN schon gebraucht wird — beim
     * ersten Anlauf stand sie hinter ihrem ersten Gebrauch, und die Datei
     * brach mit „Cannot access 'spieltHier' before initialization" ab.
     * Gefunden von tools/pruef-neu-regeln.js, nicht am Schirm. */
    const spieltHier = g && typeof g.spieltHier === 'boolean' ? g.spieltHier : null
    // DIE KARTE SIEHT UEBERFLUESSIG AUS UND IST ES NICHT: links steht `art`
    // aus der Antwort der Box, rechts ein Name aus `ZEICHEN`. Dass beide heute
    // gleich heissen, ist ein Zufall der Benennung und keine Zusage. Sie ist
    // zugleich die ERLAUBNISLISTE — ein unbekanntes `art` wird zu 'geraet' und
    // nicht als Name durchgereicht, sonst schriebe jedes fremde Geraet eine
    // Fehlermeldung in die Konsole.
    const zeichen = { lautsprecher: 'lautsprecher', kopfhoerer: 'kopfhoerer', telefon: 'telefon' }[(g && g.art) || ''] || 'geraet'
    const teile = []
    if (g && g.verbunden) {
      // DASSELBE DREITEILIGE WISSEN WIE OBEN. Ohne Auskunft ueber den
      // Tonserver steht wieder schlicht „verbunden" da — eine Behauptung
      // „spielt nicht" waere geraten.
      teile.push(spieltHier === null ? 'verbunden' : spieltHier ? 'spielt hier' : 'verbunden, spielt nicht')
    }
    else if (g && g.gekoppelt) teile.push('gekoppelt, nicht verbunden')
    else teile.push('gefunden, noch nicht gekoppelt')
    if (g && typeof g.akku === 'number') teile.push(g.akku + ' %')
    if (g && g.codec) teile.push(String(g.codec).toUpperCase())
    /* ══ VERBUNDEN IST NICHT DASSELBE WIE „SPIELT HIER" ═══
     *
     * Betreiber, 08.08.2026: „das deaktivieren eines bluetooth gerätes fehlt
     * noch also bei 2 verbundenen eins auswählen wo es spielen soll."
     *
     * TRENNEN GAB ES SCHON. Was fehlte: Sind ZWEI Lautsprecher verbunden,
     * entscheidet der Tonserver, wohin der Ton geht — nicht Bluetooth. Diese
     * Zeile bietet deshalb je nach Lage etwas anderes an:
     *
     *   verbunden UND spielt hier      Trennen   (wie bisher)
     *   verbunden, spielt aber woanders Hierher   <- das Neue
     *   gekoppelt, nicht verbunden      Verbinden
     *   nur gefunden                    Koppeln
     *
     * WARUM NICHT EIN ZWEITER KNOPF: Eine Zeile hat einen. Zwei Knoepfe je
     * Geraet waeren auf 800x480 zwei halbe — und die 9-mm-Marke ist hier
     * nicht verhandelbar. „Hierher" ist ausserdem das, was man in dieser Lage
     * WILL; wer trennen moechte, macht es zuerst zum spielenden und dann.
     *
     * ══ DREI ZUSTAENDE UND NICHT ZWEI: `undefined` HEISST „WEISS ICH NICHT"
     *
     * `spieltHier` kommt vom TONSERVER, und den gibt es nicht immer: eine Box
     * mit aelterem Server kennt `/api/ton/ausgaenge` nicht, und dann steht
     * nirgends, welcher Lautsprecher toent. Mit einem blossen `!!` waere
     * daraus „spielt nicht" geworden — jedes verbundene Geraet haette
     * „Hierher" angeboten, und TRENNEN waere ueberhaupt nicht mehr
     * erreichbar gewesen. Gefunden hat es tools/pruef-neu-regeln.js, das die
     * alte Erwartung „verbunden -> Trennen" weiter prueft.
     *
     * Deshalb: nur ein ausdrueckliches `false` heisst „verbunden, aber still".
     * Fehlt die Angabe, bleibt alles, wie es war.
     */
    const tat =
      g && g.verbunden
        ? spieltHier === false
          ? 'hierher'
          : 'trennen'
        : g && g.gekoppelt
          ? 'verbinden'
          : 'koppeln'
    return {
      mac: (g && g.mac) || '',
      zeichen,
      name,
      unter: teile.join(' · '),
      tat,
      // ENTFERNEN GIBT ES HIER NICHT, und das ist eine Entscheidung, keine
      // Luecke: eine geloeschte Kopplung an einem 800x480-Schirm mit
      // Kinderfingern ist zu leicht passiert und nur in der Verwaltung wieder
      // herzustellen. Die alte Seite haelt es genauso.
      an: !!(g && g.verbunden),
      // „spielt hier" IST DER HERVORGEHOBENE ZUSTAND, nicht bloss „verbunden":
      // Bei zwei verbundenen Lautsprechern ist die Frage nicht, welcher
      // angeschlossen ist, sondern welcher toent.
      wort: { trennen: 'Trennen', hierher: 'Hierher', verbinden: 'Verbinden', koppeln: 'Koppeln' }[tat],
    }
  }
function weiterMarke(e) {
    // DER NAME SCHLAEGT DIE NUMMER — und zwar immer, wenn es ihn gibt
    // (06.08.2026). „Titel 3" ist ehrlich, sagt aber nichts: an einer Sendung
    // mit dreissig Folgen erkennt ein Kind die eine, bei der es aufgehoert hat,
    // am NAMEN und nicht an einer Zahl. Der Name steht seit heute in der
    // gemerkten Stelle selbst (weiterhoeren.ts `resumeardfolgentitel`) — er
    // wird NICHT ein zweites Mal beschafft, denn dann gaebe es zwei Wahrheiten
    // ueber dieselbe Folge, und die zweite waere die aeltere.
    const name = String((e && e.folgeTitel) || '').trim()
    if (name) return { art: 'name', text: name }
    const nr = Number(e.titelNr) || 0
    // „Titel" und nicht „Folge": Die Reihe zeigt Hoerspiele UND Musik, und eine
    // Playlist mit Liedern hat keine Folgen. Auf Wunsch geaendert (03.08.2026).
    // BLEIBT DER RUECKFALL, wo kein Name da ist: Spotify, lokal, und jede
    // ARD-Stelle, die vor dem 06.08.2026 gemerkt wurde.
    if (nr > 1) return { art: 'nummer', text: `Titel ${nr}` }
    if (nr > 0) return null
    const a = Number(e.anteil)
    if (Number.isFinite(a) && a > 0) return { art: 'balken', anteil: Math.max(0, Math.min(1, a)) }
    return null
  }
function folgenBildAn(liste, nr) {
    const l = Array.isArray(liste) ? liste : []
    const n = Math.round(Number(nr) || 0)
    if (n < 1 || n > l.length) return null
    const t = l[n - 1]
    const b = t && t.bild
    return typeof b === 'string' && b ? b : null
  }
function folgenNameAn(liste, nr) {
    const l = Array.isArray(liste) ? liste : []
    const n = Math.round(Number(nr) || 0)
    if (n < 1 || n > l.length) return null
    const t = l[n - 1]
    const s = t && typeof t.titel === 'string' ? t.titel.trim() : ''
    return s || null
  }
function folgeKennung(schluessel, t) {
    const s = String(schluessel || '')
    const roh = t && (typeof t.id === 'string' || typeof t.id === 'number') ? String(t.id) : ''
    // Leerzeichenfest (Begruendung am `kennungsWort`): die lokale Kennung
    // `pfad#nr` traegt die Leerzeichen ihrer Ordnernamen.
    return s && roh ? `folge|${kennungsWort(s)}|${kennungsWort(roh)}` : ''
  }
function kennungsWort(s) {
    return String(s == null ? '' : s).replace(/[%\s]/g, (z) => encodeURIComponent(z))
  }
function ichBildPfad(figur, ordner) {
    if (typeof figur === 'string' && figur) {
      const o = typeof ordner === 'string' && ordner ? ordner : 'bilder/figuren'
      return `${o}/${figur}`
    }
    return 'bilder/mixpi-hoert.png'
  }
function gesteEcke(x, y, breite, hoehe, kante) {
    const b = Number(breite)
    const h = Number(hoehe)
    if (!(b > 0) || !(h > 0)) return -1
    const k = Math.max(1, Math.min(Number(kante) || 0, Math.floor(b / 2), Math.floor(h / 2)))
    if (!(x >= 0) || !(y >= 0) || x >= b || y >= h) return -1
    const links = x < k
    const rechts = x >= b - k
    const oben = y < k
    const unten = y >= h - k
    if (links && oben) return 0
    if (rechts && oben) return 1
    if (rechts && unten) return 2
    if (links && unten) return 3
    return -1
  }
function gesteEckeKante(breite, hoehe) {
    const b = Number(breite)
    const h = Number(hoehe)
    if (!(b > 0) || !(h > 0)) return GESTE_ECKE_MINDESTENS_PX
    const ausDerFlaeche = Math.floor(Math.sqrt((GESTE_ECKE_ANTEIL / 4) * b * h))
    return Math.max(GESTE_ECKE_MINDESTENS_PX, Math.min(GESTE_ECKE_HOECHSTENS_PX, ausDerFlaeche))
  }
function gesteSchritt(stand, ecke, jetzt, zuletzt, fensterMs) {
    const s = Number(stand) > 0 ? Math.floor(Number(stand)) : 0
    const e = Math.floor(Number(ecke))
    if (!(e >= 0)) return { stand: 0, offen: false }
    const rechtzeitig = s === 0 || Number(jetzt) - Number(zuletzt) <= Number(fensterMs)
    if (rechtzeitig && e === s) {
      const n = s + 1
      if (n >= GESTE_ECKEN) return { stand: 0, offen: true }
      return { stand: n, offen: false }
    }
    return { stand: e === 0 ? 1 : 0, offen: false }
  }
function torWartenS(fehler) {
    const n = Number(fehler) > 0 ? Math.floor(Number(fehler)) : 0
    if (n <= 0) return 0
    return TOR_WARTEN_S[Math.min(n, TOR_WARTEN_S.length - 1)]
  }
function gesteWartenS(tipps) {
    const n = Number(tipps) > 0 ? Math.floor(Number(tipps)) : 0
    if (n <= GESTE_FREI) return 0
    if ((n - GESTE_FREI) % GESTE_ECKEN !== 0) return 0
    return torWartenS((n - GESTE_FREI) / GESTE_ECKEN)
  }
function freigabeNochGueltig(wert, jetzt, dauerMs) {
    if (!(dauerMs > 0)) return false
    if (typeof wert !== 'string') return false
    const w = wert.trim()
    if (!/^[0-9]{1,15}$/.test(w)) return false
    const alter = jetzt - Number(w)
    return alter >= 0 && alter < dauerMs
  }
function sperrUnterzeile(art, roh) {
    if (art && SPERR_WORT[art]) return SPERR_WORT[art]
    const r = String(roh ?? '').trim()
    return r === ''
      ? 'Nicht gesetzt — die Box fragt deshalb eine Rechenaufgabe.'
      : `In der Konfiguration steht „${r}" — das kennt die Box nicht, sie rechnet.`
  }
function infoFelder(sys, dienste, hat, netz) {
    const f = []
    /*
     * ── `Number(null)` IST 0, UND 0 IST EINE ZAHL ───
     *
     * DAS WAR EIN ECHTER BEFUND (06.08.2026, node tools/pruef-neu-regeln.js,
     * erster Lauf mit `infoFelder(null, null, null, null)`): Ohne Antwort von
     * `/api/system` stand im Kaestchen „0,0 °C". Das ist keine fehlende
     * Auskunft, das ist eine FALSCHE — eine Box bei null Grad. Und am Schirm
     * ist sie nicht von einer echten Messung zu unterscheiden.
     *
     * `Number(sys && sys.temperatur)` sieht harmlos aus: ist `sys` null, ist
     * der Ausdruck `null`, und `Number(null)` ist 0 — `Number.isFinite(0)`
     * sagt ja. Genau dieselbe Falle steht bei jedem Feld, das mit `&&`
     * abgesichert ist. `speicherGesamt` entkam ihr nur zufaellig, weil dort
     * `> 0` danebensteht.
     *
     * DIESE FUNKTION IST DER RIEGEL: was nicht da ist, wird NaN, und NaN faellt
     * durch jedes `Number.isFinite`. Sie steht hier und nicht als allgemeiner
     * Helfer, weil sie genau eine Aufgabe hat — Werte aus einer FREMDEN
     * Antwort lesen, die auch ganz fehlen kann.
     */
    const zahlAus = (o, name) => {
      if (!o || typeof o !== 'object') return Number.NaN
      const w = o[name]
      if (w === null || w === undefined || w === '') return Number.NaN
      return Number(w)
    }

    // ── 1. DIE ADRESSE ───
    // Sie steht in `schnittstellen[].adressen[]` und wird von `boxIpAus`
    // gelesen — SEIT DEM 06.08.2026 DORT UND NICHT MEHR HIER. Das QR-Zeichen
    // der Spotify-Einrichtung braucht dieselbe Adresse; zwei Rechnungen fuer
    // eine Auskunft gehen genau dann auseinander, wenn es darauf ankommt.
    // Die vollstaendige Begruendung (v4, Reihenfolge, alte Serverfassung)
    // steht bei der Funktion.
    const ip = boxIpAus(netz)
    const schnitt = Array.isArray(netz && netz.schnittstellen) ? netz.schnittstellen : []
    f.push({
      wort: 'Adresse',
      zahl: ip || (netz ? 'keine' : '—'),
      warnt: !!netz && !ip,
    })

    // ── 2. WORAN SIE HAENGT ───
    // Der Name des Netzes UND ob es hinausgeht — das sind zwei verschiedene
    // Aussagen, und die zweite ist die, wegen der jemand hersieht. „verbunden
    // und trotzdem kein Weg nach draussen" ist der aergerliche Fall.
    const kabel = schnitt.some((s) => s && s.funk === false && s.aktiv === true)
    const ssid = String((netz && netz.wlan && netz.wlan.ssid) || '')
    const draussen = netz ? netz.internet === true : false
    f.push({
      wort: 'Netz',
      zahl: !netz
        ? '—'
        : (ssid || (kabel ? 'Kabel' : 'kein Netz')) + (draussen ? '' : ' · kein Internet'),
      warnt: !!netz && !draussen,
    })

    // ── 3. TEMPERATUR ───
    // 75 °C ist die Stufe, ab der die Luefterregelung der Box auf 100 % geht
    // (`fan_temp_100` in der Konfiguration) — ab da ist es keine Zahl mehr,
    // sondern eine Auskunft.
    const temp = zahlAus(sys, 'temperatur')
    f.push({
      wort: 'Temperatur',
      zahl: Number.isFinite(temp) ? temp.toFixed(1).replace('.', ',') + ' °C' : '—',
      warnt: Number.isFinite(temp) && temp >= 75,
    })

    // ── 4. AUSLASTUNG ───
    // DIE LAST WIRD DURCH DIE KERNE GETEILT. „0,34" sagt einem Menschen
    // nichts; „9 %" schon — und auf einem Pi 5 mit vier Kernen heisst 4,0
    // eben 100 % und nicht „viel". Daneben der belegte Arbeitsspeicher, weil
    // eine Box, die zu tauschen anfaengt, genau daran zu erkennen ist.
    const last = Array.isArray(sys && sys.last) ? Number(sys.last[0]) : Number.NaN
    const kerne = zahlAus(sys, 'kerne') > 0 ? zahlAus(sys, 'kerne') : 1
    const ges = zahlAus(sys, 'speicherGesamt')
    const frei = zahlAus(sys, 'speicherFrei')
    const belegt = Number.isFinite(ges) && ges > 0 && Number.isFinite(frei)
      ? Math.round(((ges - frei) / ges) * 100)
      : null
    const teile = []
    if (Number.isFinite(last)) teile.push(Math.round((last / kerne) * 100) + ' %')
    if (belegt !== null) teile.push('Speicher ' + belegt + ' %')
    f.push({
      wort: 'Auslastung',
      zahl: teile.length ? teile.join(' · ') : '—',
      warnt: (Number.isFinite(last) && last / kerne >= 0.9) || (belegt !== null && belegt >= 90),
    })

    /* ── 5. DIE DIENSTE ───
     *
     * ══ „STEHT" IST NICHT „GESTOERT", UND DAS IST HIER DER GANZE PUNKT ═══
     *
     * HIER STAND: „nicht aktiv" gilt als Problem, der erste wird benannt.
     * GEMESSEN AN DER BOX .169 (06.08.2026, `curl /api/dienste` durch diese
     * Funktion): Von 33 Diensten laufen 13. Die uebrigen 20 sind ABGESCHALTET
     * — Lüfter, VNC, Telegram, MQTT, DietPi-Übersicht, WLAN-Automatik. Das
     * Kaestchen haette also dauerhaft rot „13 von 33 · Abschalten bei
     * Nichtstun steht" gemeldet, auf einer Box, an der nichts fehlt. Eine
     * Warnung, die immer steht, liest nach dem zweiten Tag niemand mehr — und
     * dann fehlt sie an dem Tag, an dem wirklich etwas kaputt ist.
     *
     * `eingeschaltet && !aktiv` WAERE DIE NAECHSTE FALLE und ist gemessen
     * genauso falsch: vier Einheiten dieser Box sind eingeschaltet und
     * trotzdem `inactive`, weil sie EINMAL laufen und fertig sind
     * (Wiederherstellung von der Karte, der Ruecknahme-Wecker des WLAN, das
     * Startbild). Sie melden nichts Schlimmes, sie sind durch.
     *
     * WAS BLEIBT: `zustand === 'failed'`. Das ist systemds eigenes Wort fuer
     * „sollte laufen und ist gescheitert" — die einzige Aussage in dieser
     * Antwort, die nicht auch eine Einstellung sein kann.
     *
     * GEZAEHLT WIRD TROTZDEM, WAS LAEUFT: „13 laufen" ist die Auskunft, nach
     * der der Betreiber gefragt hat. Sie steht neben dem Urteil, nicht statt
     * dessen.
     */
    const liste = Array.isArray(dienste) ? dienste.filter((d) => d && d.name) : null
    const laufen = liste ? liste.filter((d) => d.aktiv === true).length : 0
    const kaputt = liste ? liste.filter((d) => d.zustand === 'failed') : []
    f.push({
      wort: 'Dienste',
      zahl: !liste
        ? '—'
        : kaputt.length === 0
          ? `${laufen} laufen, keiner gestört`
          : kaputt.length === 1
            ? `Gestört: ${kaputt[0].titel || kaputt[0].name}`
            : `${kaputt.length} gestört, zuerst ${kaputt[0].titel || kaputt[0].name}`,
      warnt: kaputt.length > 0,
    })

    // ── 6. DER AKKU ───
    // DREI ANTWORTEN, UND DIE DRITTE IST EIN SATZ. Der MuPiHAT ist Zubehoer:
    // gibt es ihn nicht, gehoert das dazustehen und nicht eine leere Zeile.
    // Der Betreiber hat ausdruecklich danach gefragt.
    //
    // `BatteryConnected: 0` heisst: HAT da, Akku nicht angeschlossen — die
    // Box laeuft dann am Netzteil. Auch das ist eine eigene Auskunft und
    // KEINE Warnung: es ist der Normalfall einer Box, die auf dem Regal steht.
    let akku
    if (hat === null) akku = { wort: 'Akku', zahl: '—' }
    else if (hat === false) akku = { wort: 'Akku', zahl: 'Kein MuPiHAT eingebaut' }
    else if (Number(hat.BatteryConnected) !== 1)
      akku = { wort: 'Akku', zahl: 'MuPiHAT da, kein Akku daran' }
    else {
      const fein = zahlAus(hat, 'Bat_SOC_fein')
      const stand = Number.isFinite(fein)
        ? fein
        : Number.parseInt(String(hat.Bat_SOC || '').replace('%', ''), 10)
      const s = Number.isFinite(stand) ? Math.max(0, Math.min(100, Math.round(stand))) : null
      const status = String(hat.Charger_Status || '')
      // DIESELBE REGEL WIE UEBERALL — sie steht jetzt EINMAL da und heisst
      // `akkuLaedtRegel`. Zwei Meinungen darueber auf EINEM Bildschirm waeren
      // eine zu viel, und es waren zwei.
      const laedt = akkuLaedtRegel(status, zahlAus(hat, 'Ibat'))
      akku = {
        wort: 'Akku',
        zahl: s === null ? '—' : s + ' %' + (laedt ? ' · lädt' : ''),
        warnt: s !== null && s < 20 && !laedt,
      }
    }
    f.push(akku)

    return f
  }
function kachelWort(b) {
    return KACHEL_WORT[b] || String(b).replace('.', ',') + '-fach'
  }
function kachelWeiter(b) {
    const i = KACHEL_STUFEN.indexOf(b)
    // EIN WERT, DEN DIESE LISTE NICHT KENNT (die Verwaltung laesst jede Zahl
    // zu), FUEHRT AUF „normal" und nicht auf „klein": von dort aus ist beide
    // Richtungen gleich weit, und „normal" ist der Stand der Auslieferung.
    return i < 0 ? 1 : KACHEL_STUFEN[(i + 1) % KACHEL_STUFEN.length]
  }
function boxIpAus(netz) {
    const schnitt = Array.isArray(netz && netz.schnittstellen) ? netz.schnittstellen : []
    for (const s of schnitt) {
      if (!s || s.aktiv === false) continue
      for (const a of Array.isArray(s.adressen) ? s.adressen : []) {
        const t = typeof a === 'string' ? a : a && a.familie === 'v4' ? String(a.adresse || '') : ''
        if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) return t
      }
    }
    return ''
  }
function spotifyEinrichtAdresse(netz) {
    const ip = boxIpAus(netz)
    return ip ? `https://${ip}:${SPOTIFY_EINRICHT_PORT}/spotify` : ''
  }
function wappenTipp(stand, jetzt) {
    // Zu lange her: das war keine Reihe, sondern ein neuer Anlauf.
    const weiter = jetzt - stand.zuletzt <= WAPPEN_TIPP_FENSTER_MS ? stand.anzahl : 0
    const anzahl = weiter + 1
    if (anzahl >= WAPPEN_TIPPS) return { stand: { anzahl: 0, zuletzt: jetzt }, hinweis: true }
    return { stand: { anzahl, zuletzt: jetzt }, hinweis: false }
  }
function akkuZahl(o, name) {
    if (!o || typeof o !== 'object') return Number.NaN
    const w = o[name]
    if (w === null || w === undefined || w === '') return Number.NaN
    return Number(w)
  }
function akkuLaedtRegel(status, mA) {
    const wort = !!status && !/not charging|termination/i.test(String(status))
    if (!Number.isFinite(mA)) return wort
    if (mA > AKKU_RUHE_MA) return true
    if (mA < -AKKU_RUHE_MA) return false
    return wort
  }
function akkuLuecke(punkte) {
    const p = (Array.isArray(punkte) ? punkte : []).filter((x) => Number.isFinite(akkuZahl(x, 't')))
    if (p.length < 3) return AKKU_LUECKE_MIN_MS
    const abstaende = []
    for (let i = 1; i < p.length; i++) abstaende.push(Number(p[i].t) - Number(p[i - 1].t))
    abstaende.sort((a, b) => a - b)
    const mitte = abstaende[Math.floor(abstaende.length / 2)]
    return Math.max(AKKU_LUECKE_MIN_MS, Math.round(mitte * AKKU_LUECKE_FAKTOR))
  }
function akkuStuecke(punkte, luecke) {
    const raus = []
    let lauf = []
    for (const p of Array.isArray(punkte) ? punkte : []) {
      const t = akkuZahl(p, 't')
      const w = akkuZahl(p, 'p')
      if (!Number.isFinite(t) || !Number.isFinite(w)) continue
      if (lauf.length && t - Number(lauf[lauf.length - 1].t) > luecke) {
        raus.push(lauf)
        lauf = []
      }
      lauf.push(p)
    }
    if (lauf.length) raus.push(lauf)
    return raus
  }
function akkuBandStuecke(abschnitte, stuecke) {
    const raus = []
    const as = Array.isArray(abschnitte) ? abschnitte : []
    const st = Array.isArray(stuecke) ? stuecke : []
    for (let nr = 0; nr < as.length; nr++) {
      const a = as[nr]
      if (!a || (a.art !== 'laden' && a.art !== 'entladen')) continue
      const av = Number(a.von)
      const ab = Number(a.bis)
      if (!Number.isFinite(av) || !Number.isFinite(ab) || ab < av) continue
      for (const s of st) {
        if (!Array.isArray(s) || !s.length) continue
        const sv = Number(s[0].t)
        const sb = Number(s[s.length - 1].t)
        if (!Number.isFinite(sv) || !Number.isFinite(sb)) continue
        const von = Math.max(av, sv)
        const bis = Math.min(ab, sb)
        // BERUEHRUNG IST KEINE UEBERSCHNEIDUNG. Endet ein Stueck in derselben
        // Millisekunde, in der der Abschnitt beginnt, gibt es dazwischen keine
        // gemessene Zeit — ein Balken der Breite null waere nichts als ein
        // Strich an einer Luecke.
        if (bis <= von) continue
        // DIE GRENZEN DES STUECKS FAHREN MIT. Der Zeichner blaest einen sehr
        // schmalen Balken auf 2,5 Einheiten auf, damit er nicht wie ein
        // Zeichenfehler aussieht — und genau dieses Aufblasen schoebe ihn an
        // der Kante wieder in die Luecke hinein, aus der er eben
        // herausgeschnitten wurde. Mit `stVon`/`stBis` kann der Zeichner das
        // Aufblasen auf die gemessene Zeit begrenzen.
        raus.push({ art: a.art, von, bis, nr, stVon: sv, stBis: sb })
      }
    }
    return raus
  }
function akkuAbdeckung(stuecke) {
    let ms = 0
    for (const s of Array.isArray(stuecke) ? stuecke : []) {
      if (!Array.isArray(s) || s.length < 2) continue
      ms += Number(s[s.length - 1].t) - Number(s[0].t)
    }
    return ms
  }
function akkuAchse(von, bis) {
    const a = Number(von)
    const e = Number(bis)
    if (!Number.isFinite(a) || !Number.isFinite(e) || e <= a) return []
    const spanne = e - a
    const schritt =
      AKKU_ACHS_STUFEN.find((s) => spanne / s <= AKKU_ACHS_MARKEN) || AKKU_ACHS_STUFEN[AKKU_ACHS_STUFEN.length - 1]
    const d = new Date(a)
    d.setHours(0, 0, 0, 0)
    const marken = []
    for (let t = d.getTime(); t <= e; t += schritt) {
      if (t < a) continue
      marken.push({ t, tag: schritt >= 86400000 })
    }
    return marken
  }
function akkuStromZahl(mA) {
    const w = Math.abs(Math.round(Number(mA)))
    if (!Number.isFinite(w)) return ''
    return w >= 1000 ? (w / 1000).toFixed(1).replace('.', ',') + ' A' : w + ' mA'
  }
function akkuStromWort(mA, lage) {
    const z = akkuStromZahl(mA)
    if (!z || !Number.isFinite(Number(mA))) return ''
    if (lage === 'laedt') return 'lädt mit ' + z
    if (lage === 'entlaedt') return 'Verbrauch ' + z
    return z
  }
function akkuSpannungWort(mV) {
    const w = Number(mV)
    if (!Number.isFinite(w) || w <= 0) return ''
    return (w / 1000).toFixed(2).replace('.', ',') + ' V'
  }
function akkuMinutenWort(minuten) {
    if (minuten === null || minuten === undefined || minuten === '') return '—'
    const m = Math.round(Number(minuten))
    if (!Number.isFinite(m)) return '—'
    return m < 60 ? Math.max(0, m) + ' min' : Math.floor(m / 60) + (m % 60 ? ' h ' + (m % 60) + ' min' : ' h')
  }
function akkuSatz(v, status) {
    const j = v && typeof v === 'object' ? v.jetzt : null
    if (!j || typeof j !== 'object') return { kopf: '—', unter: 'Es liegt noch kein Messwert vor.', lage: 'unbekannt' }
    const stand = akkuZahl(j, 'p')
    const mA = akkuZahl(j, 'i')
    if (!Number.isFinite(stand)) return { kopf: '—', unter: 'Der letzte Messwert trägt keinen Ladestand.', lage: 'unbekannt' }
    // DIESELBE REGEL WIE OBEN IN DER KOPFZEILE — siehe `akkuLaedtRegel`.
    // "ruht" bleibt, was WEDER laedt NOCH deutlich herausfliesst; damit sagt
    // der Satz "es fließt fast nichts" auch weiterhin nur dann, wenn wirklich
    // fast nichts fliesst.
    const lage = akkuLaedtRegel(status, mA) ? 'laedt' : Number.isFinite(mA) && mA < -AKKU_RUHE_MA ? 'entlaedt' : 'ruht'
    const rest = Number(v.restMinuten)
    const hatRest = Number.isFinite(rest) && v.restMinuten !== null && v.restMinuten !== undefined
    const strom = akkuStromWort(mA, lage)
    // GEKLEMMT WIE UEBERALL SONST. `yVon` klemmt die Kurve auf 0..100,
    // `hatHolen` das Zeichen der Kopfzeile, `infoFelder` das Kaestchen — nur
    // dieser Satz nahm die Zahl, wie sie kam. Ein Treiber, der -20 meldet,
    // haette hier "-20 %" hingeschrieben, waehrend die Kurve darunter brav auf
    // dem Boden lag. Der Server klemmt heute schon (`punktAus`), und deshalb
    // ist das eine zweite Tuer und keine offene Wunde — sie kostet eine Zeile.
    const gezeigt = Math.max(0, Math.min(100, Math.round(stand)))
    const kopf = gezeigt + ' %' + (lage === 'laedt' ? ' · lädt' : lage === 'entlaedt' ? ' · entlädt' : '')
    if (lage === 'ruht') {
      return {
        kopf,
        unter: 'Es fließt fast nichts' + (strom ? ' (' + strom + ')' : '') + ' — der Stand hält sich.',
        lage,
      }
    }
    if (!hatRest) {
      return {
        kopf,
        unter:
          (strom ? strom + ' · ' : '') +
          'Wie lange noch, kann die Box nicht sagen — die Kapazität des Packs ist ihr unbekannt.',
        lage,
      }
    }
    const wort = akkuMinutenWort(rest)
    return {
      kopf,
      unter: (lage === 'laedt' ? 'voll in etwa ' : 'reicht noch etwa ') + wort + (strom ? ' · ' + strom : ''),
      lage,
    }
  }
function akkuDuenn(punkte, stuecke) {
    const n = Array.isArray(punkte) ? punkte.length : 0
    if (n < AKKU_MIND_PUNKTE) {
      return (
        'Zu wenig Messwerte für eine Kurve — bisher ' +
        (n === 0 ? 'keiner' : n === 1 ? 'einer' : n + ' Stück') +
        '. Die Box zeichnet jede Minute einen auf.'
      )
    }
    const ms = akkuAbdeckung(stuecke)
    if (ms < AKKU_MIND_SPANNE_MS) {
      return (
        'Die Aufzeichnung reicht erst ' +
        akkuMinutenWort(Math.round(ms / 60000)) +
        ' zurück — für eine Kurve zu kurz. Die Box zeichnet jede Minute einen Punkt auf.'
      )
    }
    return null
  }
function akkuFlach(punkte) {
    const werte = (Array.isArray(punkte) ? punkte : [])
      .map((p) => akkuZahl(p, 'p'))
      .filter((w) => Number.isFinite(w))
    if (werte.length < 2) return null
    const min = Math.min(...werte)
    const max = Math.max(...werte)
    if (max - min > AKKU_FLACH_PROZENT) return null
    return 'Der Stand hat sich in dieser Zeit nicht messbar geändert — die Kurve ist deshalb eine Gerade bei ' + Math.round(max) + ' %.'
  }
function sysStuecke(punkte, luecke, feld) {
    const raus = []
    let lauf = []
    for (const p of Array.isArray(punkte) ? punkte : []) {
      const t = akkuZahl(p, 't')
      const w = feld ? akkuZahl(p, feld) : t
      if (!Number.isFinite(t) || !Number.isFinite(w)) {
        if (lauf.length) raus.push(lauf)
        lauf = []
        continue
      }
      if (lauf.length && t - Number(lauf[lauf.length - 1].t) > luecke) {
        raus.push(lauf)
        lauf = []
      }
      lauf.push(p)
    }
    if (lauf.length) raus.push(lauf)
    return raus
  }
function sysLuecke(v, punkte) {
    const w = Number(v && v.lueckeMs)
    return Number.isFinite(w) && w > 0 ? w : akkuLuecke(punkte)
  }
function sysKomma(w) {
    return (Math.round(Number(w) * 10) / 10).toFixed(1).replace('.', ',')
  }
function sysKommaZwei(w) {
    return (Math.round(Number(w) * 100) / 100).toFixed(2).replace('.', ',')
  }
function sysLastWort(punkt, kerne) {
    const l = akkuZahl(punkt, 'l')
    if (!Number.isFinite(l)) return ''
    const k = Number(kerne)
    return 'Last ' + sysKommaZwei(l / 100) + (Number.isFinite(k) && k > 0 ? ' von ' + k : '')
  }
function sysLueckenSatz(t, spanne) {
    if (!spanne || !Number.isFinite(spanne.von) || !Number.isFinite(spanne.bis)) {
      return 'Hier wurde nichts gemessen — die Box war aus.'
    }
    if (t < spanne.von) return 'So weit reicht die Aufzeichnung noch nicht zurück.'
    if (t > spanne.bis) return 'Seitdem wurde nichts mehr aufgezeichnet.'
    return 'Hier wurde nichts gemessen — die Box war aus.'
  }
function sysLeseSatz(punkt, luecke, t, tage, kerne, spanne) {
    const uhrVon = (ms) => {
      const d = new Date(Number(ms))
      return (
        (tage ? AKKU_WOCHENTAG[d.getDay()] + ' ' : '') +
        String(d.getHours()).padStart(2, '0') +
        ':' +
        String(d.getMinutes()).padStart(2, '0')
      )
    }
    if (luecke || !punkt) {
      return { kopf: uhrVon(t) + ' · —', unter: sysLueckenSatz(t, spanne) }
    }
    const c = akkuZahl(punkt, 'c')
    const m = akkuZahl(punkt, 'm')
    const g = akkuZahl(punkt, 'g')
    const teile = [
      Number.isFinite(c) ? 'CPU ' + Math.round(c) + ' %' : 'CPU —',
      Number.isFinite(g) ? sysKomma(g) + ' °C' : 'kein Wärmesensor',
      Number.isFinite(m) ? 'Speicher ' + Math.round(m) + ' %' : 'Speicher —',
    ]
    return {
      kopf: uhrVon(punkt.t) + ' · ' + teile[0],
      unter: [teile[1], teile[2], sysLastWort(punkt, kerne)].filter(Boolean).join(' · '),
    }
  }
function sysSatz(v) {
    const j = v && typeof v === 'object' ? v.jetzt : null
    if (!j || typeof j !== 'object') {
      return { kopf: '—', unter: 'Es liegt noch kein Messwert vor.' }
    }
    const c = akkuZahl(j, 'c')
    const m = akkuZahl(j, 'm')
    const g = akkuZahl(j, 'g')
    const kopf = [
      Number.isFinite(c) ? 'CPU ' + Math.round(c) + ' %' : null,
      Number.isFinite(g) ? sysKomma(g) + ' °C' : null,
      Number.isFinite(m) ? 'Speicher ' + Math.round(m) + ' %' : null,
    ]
      .filter(Boolean)
      .join(' · ')
    const last = sysLastWort(j, v.kerne)
    // DER SPEICHER IN MEGABYTE DAZU. Prozent beantworten „wird es eng",
    // Megabyte beantworten „wieviel ist ueberhaupt da" — und das steht auf
    // dieser Seite sonst nirgends.
    const gesamt = Number(v.speicherGesamt)
    const mb =
      Number.isFinite(m) && Number.isFinite(gesamt) && gesamt > 0
        ? Math.round((m / 100) * (gesamt / 1048576)) + ' von ' + Math.round(gesamt / 1048576) + ' MB belegt'
        : ''
    return {
      kopf: kopf || '—',
      unter: [last, mb].filter(Boolean).join(' · ') || 'Der letzte Messwert trägt keine Zahlen.',
    }
  }
function sysHeiss(punkte) {
    const werte = (Array.isArray(punkte) ? punkte : [])
      .map((p) => akkuZahl(p, 'g'))
      .filter((w) => Number.isFinite(w))
    if (!werte.length) return null
    const max = Math.max(...werte)
    if (max <= SYS_GRAD_BIS) return null
    return 'Der wärmste Messwert lag bei ' + sysKomma(max) + ' °C — die Bahn reicht nur bis ' + SYS_GRAD_BIS + ' °C.'
  }
function sysDuenn(punkte, stuecke) {
    const n = Array.isArray(punkte) ? punkte.length : 0
    if (n < AKKU_MIND_PUNKTE) {
      return (
        'Zu wenig Messwerte für eine Kurve — bisher ' +
        (n === 0 ? 'keiner' : n === 1 ? 'einer' : n + ' Stück') +
        '. Die Box zeichnet jede Minute einen auf; nach einem Neustart fängt sie von vorn an.'
      )
    }
    const ms = akkuAbdeckung(stuecke)
    if (ms < AKKU_MIND_SPANNE_MS) {
      return (
        'Die Aufzeichnung reicht erst ' +
        akkuMinutenWort(Math.round(ms / 60000)) +
        ' zurück — für eine Kurve zu kurz.'
      )
    }
    return null
  }
function wischKante(roh, breite, hoehe) {
    const r = Number(roh)
    const gewuenscht = Number.isFinite(r) && r > 0 ? Math.round(r) : WISCH_RAND_VORGABE_PX
    const b = Number(breite) > 0 ? Number(breite) : 0
    const h = Number(hoehe) > 0 ? Number(hoehe) : 0
    const deckel = Math.max(1, Math.floor(Math.min(b, h) / 4))
    return Math.max(1, Math.min(gewuenscht, WISCH_RAND_HOECHST_PX, deckel))
  }
function wischRaenderVon(x, y, breite, hoehe, kante) {
    const b = Number(breite)
    const h = Number(hoehe)
    const k = Number(kante)
    if (!(b > 0) || !(h > 0) || !(k > 0)) return []
    const px = Number(x)
    const py = Number(y)
    if (!(px >= 0) || !(py >= 0) || px > b || py > h) return []
    const raus = []
    if (px <= k) raus.push('links')
    if (px >= b - k) raus.push('rechts')
    if (py <= k) raus.push('oben')
    if (py >= h - k) raus.push('unten')
    return raus
  }
function wischRaenderDerHand(punkte, breite, hoehe, kante, reichweite) {
    const b = Number(breite)
    const h = Number(hoehe)
    const k = Number(kante)
    const r = Number(reichweite) > 0 ? Number(reichweite) : WISCH_HAND_PX
    if (!(b > 0) || !(h > 0) || !(k > 0)) return []
    const liste = Array.isArray(punkte) ? punkte : []
    if (liste.length === 0) return []
    const abstand = { links: [], rechts: [], oben: [], unten: [] }
    for (const punkt of liste) {
      const x = Number(punkt && punkt.x)
      const y = Number(punkt && punkt.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return []
      if (x < 0 || y < 0 || x > b || y > h) return []
      abstand.links.push(x)
      abstand.rechts.push(b - x)
      abstand.oben.push(y)
      abstand.unten.push(h - y)
    }
    const raus = []
    for (const rand of WISCH_RAENDER) {
      const a = abstand[rand]
      if (Math.min.apply(null, a) <= k && Math.max.apply(null, a) <= k + r) raus.push(rand)
    }
    return raus
  }
function wischZugRand(raender, dx, dy, mindest) {
    const liste = Array.isArray(raender) ? raender : []
    const m = Number(mindest) > 0 ? Number(mindest) : WISCH_ZUG_PX
    const x = Number(dx) || 0
    const y = Number(dy) || 0
    if (liste.indexOf('links') >= 0 && x >= m && x > Math.abs(y)) return 'links'
    if (liste.indexOf('rechts') >= 0 && -x >= m && -x > Math.abs(y)) return 'rechts'
    if (liste.indexOf('oben') >= 0 && y >= m && y > Math.abs(x)) return 'oben'
    if (liste.indexOf('unten') >= 0 && -y >= m && -y > Math.abs(x)) return 'unten'
    return ''
  }
function wischSprung(dx, dy, breite, hoehe) {
    const b = Number(breite) > 0 ? Number(breite) : 0
    const h = Number(hoehe) > 0 ? Number(hoehe) : 0
    if (!(b > 0) || !(h > 0)) return false
    return Math.abs(Number(dx) || 0) > b * WISCH_SPRUNG_ANTEIL || Math.abs(Number(dy) || 0) > h * WISCH_SPRUNG_ANTEIL
  }
function wischTat(belegung, rand, finger) {
    if (!belegung || !rand) return ''
    // 'aus' IST KEIN RAND, und diese Zeile ist der Grund, warum das hier
    // steht statt beim Aufrufer: Eine abgeschaltete Tat traegt `rand: 'aus'`,
    // und ohne die Pruefung glich sie sich mit der Anfrage „was liegt auf dem
    // Rand 'aus'?" selbst ab und loeste aus. Heute kann diese Anfrage gar
    // nicht entstehen — `wischRaenderVon` gibt nur die vier echten Namen
    // zurueck. Sie kann es aber morgen, und dann waere das Ergebnis eine Tat,
    // die jemand ausdruecklich abgeschaltet hat.
    // GEFUNDEN VON tools/pruef-neu-regeln.js, nicht am Schirm.
    if (WISCH_RAENDER.indexOf(rand) < 0) return ''
    const n = Math.floor(Number(finger))
    if (!(n >= 1) || n > 3) return ''
    for (const tat of WISCH_TATEN) {
      const b = belegung[tat]
      if (!b || b.rand !== rand) continue
      if (Math.floor(Number(b.finger)) === n) return tat
    }
    return ''
  }
function wischBelegen(belegung, tat, rand, finger) {
    const alt = belegung && typeof belegung === 'object' ? belegung : {}
    if (WISCH_TATEN.indexOf(tat) < 0) return alt
    const n = Math.floor(Number(finger))
    const gueltig = WISCH_RAENDER.indexOf(rand) >= 0 && n >= 1 && n <= 3
    const neu = {}
    for (const t of WISCH_TATEN) {
      const b = alt[t]
      neu[t] = b ? { rand: b.rand, finger: b.finger } : { rand: 'aus', finger: 1 }
    }
    neu[tat] = gueltig ? { rand, finger: n } : { rand: 'aus', finger: n >= 1 && n <= 3 ? n : 1 }
    if (!gueltig) return neu
    for (const t of WISCH_TATEN) {
      if (t === tat) continue
      if (neu[t].rand === rand && Math.floor(Number(neu[t].finger)) === n) neu[t] = { rand: 'aus', finger: n }
    }
    return neu
  }
function wischLautWert(alt, versatz, spanne, max) {
    const m = Number(max) > 0 ? Number(max) : 100
    const s = Number(spanne) > 0 ? Number(spanne) : 1
    const a = Number(alt)
    const grund = Number.isFinite(a) ? a : 0
    const neu = grund + ((Number(versatz) || 0) / s) * m
    return Math.max(0, Math.min(m, Math.round(neu)))
  }
function wischWort(rand, finger) {
    if (WISCH_RAENDER.indexOf(rand) < 0) return 'Aus'
    const n = Math.floor(Number(finger))
    // EINE UNBRAUCHBARE FINGERZAHL HEISST „Aus" UND NICHT „1 Finger": eine
    // Zeile, die eine Geste behauptet, die `wischTat` gar nicht kennt, waere
    // eine Attrappe. Dieselbe Grenze steht dort.
    if (!(n >= 1) || n > 3) return 'Aus'
    const wie = n === 1 ? '1 Finger' : n + ' Finger'
    return 'Von ' + rand + ', ' + wie
  }
function zweiAchse(dx, dy, mindest) {
    const m = Number(mindest) > 0 ? Number(mindest) : ZWEI_MIND_PX
    const x = Math.abs(Number(dx) || 0)
    const y = Math.abs(Number(dy) || 0)
    if (y >= m && y > x) return 'laut'
    if (x >= m && x > y) return 'lauf'
    return ''
  }
function zweiLauf(dx) {
    return (Number(dx) || 0) < 0 ? 'next' : 'previous'
  }
function zweiTipp(dauerMs, wegPx) {
    // `typeof` UND NICHT `Number(...)`: `Number(null)` ist 0, und 0 ms bei 0 px
    // ist der perfekte Tipp. Ein Aufrufer, der versehentlich `null` uebergibt
    // — etwa weil der Zug gar nicht angefangen hat —, haette damit die
    // Wiedergabe angehalten. Dieselbe Falle wie bei `prozent: null` in der
    // Helligkeitszeile und bei `restMin: null` in der Hoerzeit.
    // GEFUNDEN VON tools/pruef-neu-regeln.js.
    if (typeof dauerMs !== 'number' || typeof wegPx !== 'number') return false
    if (!Number.isFinite(dauerMs) || !Number.isFinite(wegPx)) return false
    return dauerMs >= 0 && dauerMs <= ZWEI_TIPP_MS && Math.abs(wegPx) <= ZWEI_TIPP_PX
  }
function uhrSatz(std, min) {
    const h = Number(std)
    const m = Number(min)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
    if (h < 0 || h > 23 || m < 0 || m > 59) return ''
    const hz = Math.trunc(h)
    const mz = Math.trunc(m)
    return mz === 0 ? 'Es ist ' + hz + ' Uhr.' : 'Es ist ' + hz + ' Uhr ' + mz + '.'
  }
module.exports = { PUZ_KANTE, PUZ_MISCHZUEGE, RECH_BIS, RECH_WAHLEN, SPERR_ARTEN, GESTE_ECKE_HOECHSTENS_PX, GESTE_ECKE_MINDESTENS_PX, MEM_PAARE_HOECHSTENS, MEM_PAARE_MINDESTENS, MEM_VOLL_PAARE, MEM_CRAZY_START_S, MEM_CRAZY_SCHRITT_S, MEM_CRAZY_MIN_S, MEM_ZEIGEN_MS, MEM_HASH_GLEICH, GESTE_ECKE_ANTEIL, GESTE_FENSTER_MS, GESTE_ECKEN, TOR_WARTEN_S, GESTE_FREI, SPERR_WORT, KACHEL_STUFEN, KACHEL_WORT, SPOTIFY_EINRICHT_PORT, WAPPEN_TIPPS, WAPPEN_TIPP_FENSTER_MS, AKKU_LUECKE_MIN_MS, AKKU_LUECKE_FAKTOR, AKKU_ACHS_STUFEN, AKKU_ACHS_MARKEN, AKKU_RUHE_MA, AKKU_MIND_PUNKTE, AKKU_MIND_SPANNE_MS, AKKU_FLACH_PROZENT, AKKU_SPANNEN, AKKU_WOCHENTAG, SYS_SPANNEN, SYS_GRAD_VON, SYS_GRAD_BIS, SYS_GRAD_MARKE, WISCH_RAND_VORGABE_PX, WISCH_RAND_MIND_PX, WISCH_RAND_HOECHST_PX, WISCH_ZUG_PX, WISCH_FENSTER_MS, WISCH_SPRUNG_ANTEIL, WISCH_RAENDER, WISCH_TATEN, WISCH_HAND_PX, ZWEI_MIND_PX, ZWEI_TIPP_MS, ZWEI_TIPP_PX, ZWEI_DOPPEL_MS, boxnameTeilen, naechsterRueckweg, fassungBeschriften, memBrettMasse, memCrazyZeitS, memNaechsterDran, memPaareZahl, memHashAbstand, memHashNeu, memWortAusDatei, puzNachbarn, puzMischen, puzGeloest, rechenAufgabe, uhrWort, uhrAuswahl, sperrModus, torFertig, zifferDazu, btZeile, weiterMarke, folgenBildAn, folgenNameAn, folgeKennung, kennungsWort, ichBildPfad, gesteEcke, gesteEckeKante, gesteSchritt, torWartenS, gesteWartenS, freigabeNochGueltig, sperrUnterzeile, infoFelder, kachelWort, kachelWeiter, boxIpAus, spotifyEinrichtAdresse, wappenTipp, akkuZahl, akkuLaedtRegel, akkuLuecke, akkuStuecke, akkuBandStuecke, akkuAbdeckung, akkuAchse, akkuStromZahl, akkuStromWort, akkuSpannungWort, akkuMinutenWort, akkuSatz, akkuDuenn, akkuFlach, sysStuecke, sysLuecke, sysKomma, sysKommaZwei, sysLastWort, sysLueckenSatz, sysLeseSatz, sysSatz, sysHeiss, sysDuenn, wischKante, wischRaenderVon, wischRaenderDerHand, wischZugRand, wischSprung, wischTat, wischBelegen, wischLautWert, wischWort, zweiAchse, zweiLauf, zweiTipp, uhrSatz }
