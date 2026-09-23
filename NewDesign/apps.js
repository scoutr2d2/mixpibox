/* =====================================================================
   MixPiBox — DIE APPS DER SCHUBLADE
   =====================================================================

   WARUM ES DIESE DATEI GIBT (Betreiber, 03.09.2026: „denke an die plugin
   strucktur bitte"):

   Die richtige Antwort waere ein Plugin gewesen — und die geht NICHT. Der
   Plugin-Vertrag schliesst kinderseitige Oberflaeche ausdruecklich aus:
   „`UiExtension` (Widgets in der Oberflaeche) — bewusst gestrichen. Fremdes
   JS in der Kiosk-Seite haette volles DOM und alle `fetch`-Rechte — ein
   fehlerhaftes Widget koennte dem Kind den Ausschalter nehmen."
   (plugins/README.md). Eine eigene Route, die der Kinderschirm erreicht,
   gibt es aus demselben Grund nicht. Der vorgesehene Weg dorthin ist laut
   Doku „iframe + enger postMessage-Vertrag" und ist nicht gebaut.

   ALSO IST DIES KEIN PLUGIN, SONDERN EIN SCHNITT. Was er loest, ist das
   Symptom, an dem der Auftrag haengt: app.js ist an einem Tag um rund 68 kB
   gewachsen, und ihr Deckel musste DREIMAL angehoben werden. Jede weitere
   App haette ihn weiter geschoben. Hier hat sie eine eigene Datei, einen
   eigenen Deckel und eine eigene Zeile in der Groessen-Wache.

   UND ER IST DIE VORSTUFE ZUM PLUGIN-WEG, falls der einmal kommt: Was eine
   App vom Haus braucht, steht ab heute an EINER Stelle — dem Kontext, den
   `erzeugen()` bekommt. Wer daraus einen postMessage-Vertrag macht, hat die
   Liste schon.

   ── DER KONTEXT IST DIE GANZE GRENZE ────────────────────────────────────
   Eine App bekommt genau das, was unten in `erzeugen()` hereingereicht wird —
   nicht mehr. Kein `fetch`, kein `document`, kein Zugriff auf den Spieler.
   Das ist keine Sandbox (diese Datei laeuft in derselben Seite und koennte
   sich alles nehmen), aber es ist eine LESBARE Grenze: Wer wissen will, was
   die Apps anfassen, liest eine Zeile.

   ── DIE EINE HARTE REGEL GILT AUCH HIER ─────────────────────────────────
   Keine App spielt Musik ab. Der Kontext reicht bewusst KEINEN Abspielweg
   herein — die Kinderzeit haengt an /player/<raum>/<befehl>, und eine App,
   die daran vorbei Ton macht, waere genau die Umgehung, vor der das Vorwort
   von app.js warnt. Memory und Puzzle nehmen nur die Cover.
   ===================================================================== */
;(() => {
  'use strict'

  /* ── WAS DAS HAUS HEREINREICHT ──────────────────────────────────────────
   * Einmal gesetzt, wenn `erzeugen()` gerufen wird. Als `let` und nicht als
   * Parameter durch siebzehn Funktionen gereicht: Die Funktionen sind
   * WORTGLEICH aus app.js hierhergezogen, und eine Umschreibung von siebzehn
   * Signaturen waere siebzehn Gelegenheiten fuer einen Fehler bei einem
   * Umzug, der nichts am Verhalten aendern soll.
   *
   * `werke` und `stimme` sind OBJEKTE des Hauses und werden hier nur
   * gelesen. Dass sie sich unter uns aendern, ist gewollt: `kann()` fragt
   * bei jedem Neuaufbau der Schublade nach dem AKTUELLEN Stand. */
  let el = null
  let werke = null
  let brauchbar = null
  let bildAdresse = null
  let katSymbol = null
  let stimme = null
  let sprichDann = null

  /* ── MEMORY ───────────────────────────────────────────────────────────────
   *
   * Die eine App, die wirklich hinter der Schublade liegt. Sie spielt NICHTS
   * ab und ruft keinen Endpunkt: Sie nimmt die Cover, die ohnehin schon im
   * Raster stehen, und dreht sie um. Damit kostet sie keine Kinderzeit und
   * kann die eine harte Regel dieses Hauses gar nicht erst umgehen.
   *
   * VIER SPIELARTEN SEIT E139 (Betreiber, 09.09.2026: „das memory soll 1 und
   * 2 player modus haben …"):
   *
   *   Alleine      das Spiel, das es vorher gab — Paare suchen, Zuege zaehlen.
   *   Verrueckt    eine Uhr laeuft ab; ist sie leer, mischen sich die noch
   *                ZUGEDECKTEN Karten untereinander, und die naechste Runde
   *                der Uhr ist kuerzer. Gefundene und gerade offene Karten
   *                bleiben liegen — gemischt wird nur, was niemand kennt,
   *                sonst nimmt die Uhr dem Kind, was es sich gemerkt hat,
   *                UND was es gerade vor sich sieht.
   *   Ohne Fehler  ein einziges falsches Paar deckt ALLES wieder zu — auch
   *                die gefundenen. Gemischt wird dabei NICHT (Betreiber:
   *                „drehen sich alle karten wieder um mischen aber nicht"):
   *                Das Wissen, wo alles liegt, bleibt der Trost — verloren
   *                ist nur der Fortschritt, nicht das Gedaechtnis.
   *   Zu zweit     IMMER abwechselnd, auch nach einem Treffer (Betreiber:
   *                „wechselt es immer"). Das ist AUSDRUECKLICH nicht die
   *                Turnierregel „wer trifft, ist nochmal dran" — die belohnt
   *                das Kind mit dem besseren Gedaechtnis doppelt, und an
   *                diesem Geraet sitzen Geschwister mit Altersabstand.
   *                Jeder sammelt seine Paare; die Chips unten zeigen, wer
   *                dran ist, in Farben statt Namen (wer hier spielt, liest
   *                noch nicht).
   *
   * DIE WAHL IST EIN SCHIRM MIT VIER KNOEPFEN und kein Baum aus Menues: erst
   * Spielerzahl, dann Modus waeren zwei Fragen vor dem Spielen — die vier
   * Endpunkte passen auf einen Schirm, also steht jeder direkt da. Jeder
   * Knopf wird auf Wunsch vorgelesen (`sprichDann`, derselbe Weg wie bei den
   * Antworten der Uhr).
   */

  /**
   * Woraus ein Spiel gebaut werden kann.
   *
   * NUR WERKE MIT EIGENEM COVER (`w.bild`). Fehlt es, liefert `bildAdresse`
   * den Endpunkt `/api/bild/<schluessel>` — und der antwortet, wenn nichts
   * hinterlegt ist, mit dem MASKOTTCHEN (siehe den Kasten an `bildAdresse`:
   * der Server unterscheidet 404 von Rueckfallbild, die Seite nicht). Zwoelf
   * Karten mit demselben Maskottchen saehen gleich aus und waeren trotzdem
   * keine Paare — das Spiel waere nicht schwer, sondern kaputt. Die ADRESSE
   * verraet den Fall nicht: sie ist je Schluessel verschieden, das Bild
   * dahinter nicht. Deshalb wird hier auf das gefragt, was da IST.
   *
   * UND DESHALB AUCH DIE DOPPELPRUEFUNG AUF `w.bild`: Zwei Werke duerfen
   * dasselbe Cover tragen (ein Album in zwei Kategorien), und zwei Karten
   * desselben Bildes waeren ein Paar, das aus zwei verschiedenen Werken
   * besteht — aufgedeckt sieht es richtig aus und zaehlt nicht.
   */
  function memoryVorrat() {
    const gesehen = new Set()
    const raus = []
    for (const w of werke.liste) {
      if (!brauchbar(w)) continue
      if (typeof w.bild !== 'string' || !w.bild) continue
      if (gesehen.has(w.bild)) continue
      gesehen.add(w.bild)
      raus.push(w)
    }
    return raus
  }

  /** So viele Paare hoechstens — zwoelf Karten sind auf 800x480 die Grenze,
   *  ab der eine Karte kleiner als der Griff (`--griff`, 66 px) wuerde. */
  const MEM_PAARE_HOECHSTENS = 6
  /** Und so wenige mindestens; darunter ist es kein Spiel. */
  const MEM_PAARE_MINDESTENS = 2
  /** Im Vollbild (E139: „einen full screen mode mit mehr karten") das
   *  Doppelte. Die Rechnung dahinter steht im Pruefstand
   *  (tools/pruef-neu-regeln.js): 24 Karten auf der Vollbild-Buehne ergeben
   *  ueber `memBrettMasse` noch eine Karte ueber dem Griff — MEHR Paare
   *  taeten es rechnerisch auch, aber verdoppeln ist die eine Stufe, die ein
   *  Kind als „jetzt ist es gross" versteht, ohne neu zu lernen. */
  const MEM_VOLL_PAARE = 12
  /** So lange bleibt ein falsches Paar offen liegen, bevor es zufaellt.
   *  Kuerzer, und ein Kind hat das zweite Bild nicht gesehen. */
  const MEM_ZEIGEN_MS = 900
  /** Der Abstand zwischen zwei Karten — dieselbe Zahl wie `gap` bei
   *  `.mem-brett` in app.css. SIE STEHT HIER ZUM RECHNEN, nicht zum
   *  Zeichnen: Wer sie in CSS aendert, aendert sie hier mit. */
  const MEM_LUECKE_PX = 10
  /** Die Uhr der Spielart „Verrueckt": So viele Sekunden hat die erste
   *  Runde. VORHER GERECHNET, NICHT GERATEN: Sechs Paare heissen im
   *  schlechtesten Fall elf Fehlzuege, ehe alles einmal offen war, und jeder
   *  Fehlzug kostet die Zeigezeit (900 ms) plus zwei Tipps. Dreissig
   *  Sekunden reichen einem zuegigen Kind fuer die halbe Aufloesung — die
   *  Uhr soll ins Spiel greifen, aber nicht in jeden Zug. */
  const MEM_CRAZY_START_S = 30
  /** Um so viele Sekunden wird jede Runde kuerzer (Betreiber: „je nach level
   *  wird das schneller"). Das Level IST die Zahl der abgelaufenen Uhren. */
  const MEM_CRAZY_SCHRITT_S = 5
  /** Und kuerzer als das wird keine Runde: Unter zehn Sekunden mischt die
   *  Uhr schneller, als ein Zug samt Zeigezeit dauert — das Spiel waere dann
   *  nicht schwer, sondern unmoeglich, und ein Kind unterscheidet die beiden
   *  Zustaende nicht. */
  const MEM_CRAZY_MIN_S = 10
  /** In diesem Takt zaehlt die Uhr herunter. Grob genug, um dem Pi keine
   *  Arbeit zu machen; fein genug, dass der Balken laeuft statt zu springen. */
  const MEM_TAKT_MS = 250
  /** So lange wackeln getauschte Karten nach dem Mischen — dieselbe Zahl wie
   *  die Dauer von `mem-wirbel` in app.css. Wie MEM_LUECKE_PX: Wer sie dort
   *  aendert, aendert sie hier mit. Ohne das Wackeln waere das Mischen
   *  UNSICHTBAR (die Rueckseiten sind gleich) — das Kind saehe nur, dass
   *  sein Gedaechtnis ploetzlich luegt. */
  const MEM_WIRBEL_MS = 450

  /**
   * Wie das Brett steht — SPALTEN UND KARTENGROESSE, GERECHNET.
   *
   * NICHT AUS EINER TABELLE: Die Buehne ist nicht ueberall gleich gross (die
   * Schublade nimmt links Platz, das Kissen unten, und auf einem anderen
   * Schirm stimmt ohnehin nichts davon). Deshalb wird jede Spaltenzahl
   * durchgerechnet und die genommen, bei der die Karte am groessten wird —
   * das ist bei zwoelf Karten auf 800x480 vier mal drei, aber es ist ein
   * ERGEBNIS und keine Festlegung.
   *
   * Rein und ohne Baum, damit der Pruefstand (tools/pruef-neu-regeln.js,
   * Abschnitt memBrettMasse) sie ohne Browser nachrechnen kann. HIER STAND
   * `tools/memory-brett-messen.mjs` — ein Werkzeug, das es nie in den Baum
   * geschafft hat; der Pruefstand tut seit dem 03.09.2026, was der Name
   * versprach (berichtigt E139).
   */
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

  /** Mischen (Fisher-Yates). An Ort und Stelle, auf einer eigenen Kopie. */
  function memMischen(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  /** Wie viele Sekunden die Uhr der Spielart „Verrueckt" in einer Stufe hat.
   *  Stufe 1 ist die erste Uhr; jede abgelaufene macht die naechste kuerzer,
   *  bis zur Untergrenze. Rein und ohne Baum — der Pruefstand
   *  (tools/pruef-neu-regeln.js) prueft die EIGENSCHAFTEN: faellt monoton,
   *  faellt nie unter die Untergrenze, wirft bei Unsinn nicht. */
  function memCrazyZeitS(stufe) {
    const s = Math.max(1, Math.floor(Number(stufe) || 1))
    return Math.max(MEM_CRAZY_MIN_S, MEM_CRAZY_START_S - MEM_CRAZY_SCHRITT_S * (s - 1))
  }

  /** Wer nach einem abgeschlossenen Zug dran ist.
   *
   * DIE STILLSTE REGEL DER SPIELART „ZU ZWEIT": Es wechselt IMMER — auch
   * nach einem Treffer. Wer hier die Turnierregel „Treffer heisst nochmal"
   * einbaut, baut genau das, was der Betreiber NICHT bestellt hat
   * (09.09.2026: „wechselt es immer"), und am Brett sieht beides gleich
   * richtig aus. Deshalb steht die Entscheidung in einer eigenen Funktion
   * und im Pruefstand, nicht in einer Zeile des Klick-Zuhoerers. Alles, was
   * nicht Zwei-Spieler-Betrieb ist, gehoert Spieler 1 — auch Unsinn. */
  function memNaechsterDran(spielerzahl, dran) {
    if (spielerzahl !== 2) return 1
    return dran === 1 ? 2 : 1
  }

  /** Wie viele Paare ein Spiel bekommt: den Deckel der Ansicht (Vollbild
   *  oder klein), aber nie mehr, als der Vorrat an verschiedenen Covern
   *  hergibt. Unter Null faellt es nicht — ein negativer Vorrat ist ein
   *  Fehler des Rufers, kein Grund fuer ein Brett mit minus vier Karten. */
  function memPaareZahl(voll, vorratZahl) {
    const deckel = voll ? MEM_VOLL_PAARE : MEM_PAARE_HOECHSTENS
    return Math.max(0, Math.min(deckel, Math.floor(Number(vorratZahl) || 0)))
  }

  /* ── DIE MITGELIEFERTEN KARTENSAETZE (E140) ──────────────────────────────
   *
   * Betreiber am Brett (09.09.2026): „viele bilder [sind] gleich aber nicht
   * passend, da es aus dem gleichen album unterschiedliche titel sind oder es
   * sind mehrfach platzhalter bilder."
   *
   * BEIDES IST DIESELBE WURZEL: Das Spiel nahm nur die Cover der Bibliothek,
   * und die taugen als Kartensatz schlecht. Ein Album liefert mehrere Titel
   * mit DEMSELBEN Bild, und Alben ohne Cover bekommen vom m3u-Generator alle
   * dasselbe Maskottchen untergeschoben (llmwiki
   * rueckfallbild-macht-den-fehler-unsichtbar: 60 von 97 Alben, am Geraet
   * gemessen). Aufgedeckt sehen zwei solche Karten gleich aus und sind kein
   * Paar — das Spiel ist dann nicht schwer, sondern kaputt.
   *
   * DIE ANTWORT IST ZWEITEILIG:
   *   1. MITGELIEFERTE Saetze (Tiere, Kulturen, Kunst, Menschen, Technik,
   *      Wissenschaft) aus CC0-Quellen, von Hand kuratiert — dort kommt jedes
   *      Bild genau einmal vor. Sie liegen unter bilder/memory/<satz>/ und
   *      werden von tools/memory-bilder-holen.py geholt.
   *   2. Fuer die eigenen Cover eine Aussiebung nach INHALT (unten,
   *      `memBildHash`) — sie erwischt beide Faelle auf einen Schlag.
   *
   * DER EINE ABRUF DIESER DATEI: `saetze.json` ist eine mitgelieferte,
   * gleichnamige Datei neben den Bildern — kein Endpunkt, kein Zustand, keine
   * Kinderzeit. Der Kopf dieser Datei sagt „kein fetch"; das galt, solange
   * keine App etwas mitzuliefern hatte. Was weiterhin gilt und der eigentliche
   * Punkt jener Zeile ist: KEIN ABSPIELWEG. Eine Seite kann keinen Ordner
   * auflisten — die Alternative waere eine zweite Liste der Dateinamen hier im
   * Quelltext, und die liefe beim ersten ausgetauschten Bild auseinander.
   */
  const MEM_SAETZE_ADRESSE = 'bilder/memory/saetze.json'
  /** Die Kennung des Satzes „meine eigenen Cover" — kein Ordner, sondern die
   *  Bibliothek. Steht als Konstante da, weil drei Stellen sie vergleichen. */
  const MEM_SATZ_COVER = 'cover'
  /** Ab diesem Hamming-Abstand gelten zwei Bilder als VERSCHIEDEN.
   *
   * FUENF VON 64 BIT: Derselbe Platzhalter, zweimal ueber verschiedene
   * Adressen geladen, ergibt Abstand 0 — dafuer taete auch eine 1. Die Luft
   * ist fuer denselben Titel in zwei Aufloesungen oder mit anderer
   * JPEG-Guete; die unterscheiden sich in ein, zwei Bit. Zwei WIRKLICH
   * verschiedene Cover liegen erfahrungsgemaess ueber 20 auseinander — die
   * Schwelle ist also weit weg von beiden Seiten. */
  const MEM_HASH_GLEICH = 5
  /** So viele Cover werden hoechstens angesehen, um genug verschiedene zu
   *  finden. Ohne Deckel liefe die Suche bei einer Bibliothek, in der ALLE
   *  Cover derselbe Platzhalter sind, ueber jeden Eintrag — und das Kind
   *  saehe solange „Einen Augenblick". */
  const MEM_COVER_PRUEFEN_HOECHSTENS = 48

  /**
   * Der Hamming-Abstand zweier Bildhashes — in wie vielen Bit sie sich
   * unterscheiden. `-1`, wenn sie sich nicht vergleichen lassen.
   *
   * REIN UND OHNE BAUM, damit der Pruefstand (tools/pruef-neu-regeln.js) sie
   * ohne Browser nachrechnet. Der Fehler waere hier STILL: Ein Abstand, der
   * immer 0 liefert, siebt ALLES aus (das Spiel sagt „zu wenige Bilder", und
   * niemand ahnt, warum); einer, der immer gross liefert, siebt NICHTS aus —
   * und dann ist alles wieder wie vorher, ohne dass etwas rot wird.
   */
  function memHashAbstand(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return -1
    if (a.length !== b.length || a.length === 0) return -1
    let n = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
    return n
  }

  /** Ist dieser Hash neu gegenueber allen schon gesehenen?
   *
   * EIN NICHT VERGLEICHBARER HASH GILT ALS NEU (Abstand -1): Lieber eine
   * Karte zu viel als ein Spiel, das an einer misslungenen Messung leer
   * bleibt. Die Aussiebung ist eine Verbesserung, kein Torwaechter. */
  function memHashNeu(gesehen, hash, schwelle) {
    if (!Array.isArray(gesehen)) return true
    for (const alt of gesehen) {
      const d = memHashAbstand(alt, hash)
      if (d >= 0 && d <= schwelle) return false
    }
    return true
  }

  /**
   * Der Mittelwert-Hash eines geladenen Bildes: 8x8 Graustufen gegen ihren
   * eigenen Mittelwert, 64 Bit als Zeichenkette.
   *
   * WARUM NICHT DIE ADRESSE VERGLEICHEN (das tut `memoryVorrat` schon): Die
   * Adresse ist je Schluessel VERSCHIEDEN, das Bild dahinter nicht. Genau
   * daran ist die alte Pruefung vorbeigelaufen — der Server unterscheidet
   * 404 und Rueckfallbild, die Seite sieht beide als „200, image/jpeg".
   * Nur der INHALT traegt noch (llmwiki rueckfallbild-macht-den-fehler-
   * unsichtbar).
   *
   * WARUM 8x8: Das ist der uebliche aHash. Er ueberlebt Skalierung und
   * JPEG-Guete und ist auf einem Pi in Mikrosekunden gerechnet — 64 Werte.
   */
  function memBildHash(bild) {
    const c = document.createElement('canvas')
    c.width = 8
    c.height = 8
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return null
    g.drawImage(bild, 0, 0, 8, 8)
    // `getImageData` WIRFT bei einem fremdherkuenftigen Bild (SecurityError).
    // Unsere liegen alle auf derselben Herkunft — der Ruf steht trotzdem beim
    // Aufrufer in einem try, denn ein Spiel darf an einer Messung nicht
    // sterben.
    const d = g.getImageData(0, 0, 8, 8).data
    const grau = new Array(64)
    let summe = 0
    for (let i = 0; i < 64; i++) {
      const w = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
      grau[i] = w
      summe += w
    }
    const mittel = summe / 64
    let raus = ''
    for (let i = 0; i < 64; i++) raus += grau[i] >= mittel ? '1' : '0'
    return raus
  }

  /** Ein Bild laden und melden, ob es kam. Wirft NIE — ein fehlendes Cover
   *  ist ein Grund, diese eine Karte zu ueberspringen, kein Grund fuer eine
   *  leere Buehne. */
  function memBildLaden(adresse) {
    return new Promise((fertig) => {
      const b = new Image()
      b.onload = () => fertig(b)
      b.onerror = () => fertig(null)
      b.src = adresse
    })
  }

  /** Das Verzeichnis der mitgelieferten Saetze — einmal geholt und gemerkt.
   *  Faellt es aus, gibt es eben nur die eigenen Cover; eine App, die wegen
   *  einer fehlenden Beilage gar nicht mehr aufgeht, waere der schlechtere
   *  Tausch (dieselbe Haltung wie beim Fehlen von apps.js selbst). */
  let memSaetzeGemerkt = null
  function memSaetzeHolen() {
    if (memSaetzeGemerkt) return Promise.resolve(memSaetzeGemerkt)
    return fetch(MEM_SAETZE_ADRESSE)
      .then((a) => (a.ok ? a.json() : {}))
      .then((d) => {
        memSaetzeGemerkt = d && typeof d === 'object' ? d : {}
        return memSaetzeGemerkt
      })
      .catch((e) => {
        console.warn('Memory: die mitgelieferten Kartensaetze fehlen:', e)
        memSaetzeGemerkt = {}
        return memSaetzeGemerkt
      })
  }

  /** Aus `papagei.jpg` wird „Papagei" — der Name steht NUR auf der offenen
   *  Karte (siehe den Kasten beim Kartenbau: auf der verdeckten waere er ein
   *  Spickzettel fuer jeden, der vorlesen laesst). */
  function memWortAusDatei(datei) {
    const roh = String(datei || '').replace(/\.[a-z0-9]+$/i, '').replace(/-/g, ' ').trim()
    return roh ? roh.charAt(0).toUpperCase() + roh.slice(1) : 'Karte'
  }

  /** Die Kartenquellen eines mitgelieferten Satzes. */
  function memSatzQuellen(name, satz) {
    return (satz.bilder || []).map((d) => ({
      bild: `bilder/memory/${name}/${d}`,
      wort: memWortAusDatei(d),
    }))
  }

  /**
   * Die Kartenquellen aus den EIGENEN Covern — nach Inhalt ausgesiebt.
   *
   * HIER WIRD DER GEMELDETE FEHLER BEHOBEN, und zwar beide Haelften mit
   * einem Handgriff: Zwei Titel desselben Albums tragen dasselbe Bild, und
   * die Platzhalter-Alben tragen alle das Maskottchen. Beides ergibt
   * denselben Hash, und beides faellt damit weg — ohne dass die Seite wissen
   * muss, WELCHES Bild der Platzhalter ist. Eine Wache auf die SORTE
   * („derselbe Inhalt"), nicht auf einen Pfad, der sich morgen aendert.
   *
   * DER PLATZHALTER SELBST DARF EINMAL VORKOMMEN. Er ist ein gueltiges Bild;
   * nur seine 59 Zwillinge sind das Problem.
   */
  async function memCoverQuellen(wieviel) {
    const vorrat = memMischen(memoryVorrat().slice()).slice(0, MEM_COVER_PRUEFEN_HOECHSTENS)
    const raus = []
    const hashes = []
    for (const w of vorrat) {
      if (raus.length >= wieviel) break
      const adresse = bildAdresse(w)
      const bild = await memBildLaden(adresse)
      if (!bild) continue
      let hash = null
      try {
        hash = memBildHash(bild)
      } catch (e) {
        hash = null
      }
      if (hash) {
        if (!memHashNeu(hashes, hash, MEM_HASH_GLEICH)) continue
        hashes.push(hash)
      }
      raus.push({ bild: adresse, wort: w.titel })
    }
    return raus
  }

  /**
   * Der Wahlschirm. `inhalt` ist die leere Buehne aus `appOeffnen`; jede der
   * vier Antworten leert sie und baut das Spiel. „Neues Spiel" fuehrt wieder
   * HIERHER und nicht in dieselbe Spielart: Der eine Tipp mehr ist der
   * Preis dafuer, dass ein Kind die Art wechseln kann, ohne die App zu
   * verlassen — und die Wahl IST der Start, kein Formular davor.
   */
  function memoryStarten(inhalt) {
    // DAS VERZEICHNIS ZUERST, dann die Wahl. Der Abruf gilt einer
    // mitgelieferten Datei und ist im Regelfall sofort da; der Hinweis steht
    // trotzdem, weil eine leere Buehne von „laedt noch" nicht zu
    // unterscheiden waere.
    inhalt.appendChild(el('div', 'app-leer', 'Einen Augenblick …'))
    memSaetzeHolen().then((saetze) => {
      // DIE BUEHNE KANN INZWISCHEN ZU SEIN: `appBuehneZu` leert den Inhalt,
      // ohne diese App zu fragen. In einen Knoten zu bauen, den niemand mehr
      // zeichnet, waere still verlorene Arbeit.
      if (!inhalt.isConnected) return
      inhalt.textContent = ''
      memSatzWahl(inhalt, saetze)
    })
  }

  /**
   * ERSTE FRAGE: WOMIT. Die mitgelieferten Saetze als Bildkacheln, dazu die
   * eigene Bibliothek.
   *
   * MIT BILD UND NICHT NUR MIT WORT: Wer hier waehlt, liest noch nicht. Ein
   * Papagei auf der Kachel sagt „Tiere" auch dem, dem das Wort nichts sagt —
   * und das Wort wird zusaetzlich vorgelesen (`sprichDann`, derselbe Weg wie
   * bei den Antworten der Uhr).
   *
   * ZWEI FRAGEN STATT EINER, und das ist ein bewusster Preis: Satz und
   * Spielart sind unabhaengig (jeder Satz laesst sich verrueckt spielen).
   * Sie in einen Schirm zu falten hiesse 24 Knoepfe — das waere schneller zu
   * tippen und langsamer zu verstehen.
   */
  function memSatzWahl(inhalt, saetze) {
    const eigene = memoryVorrat()
    const namen = Object.keys(saetze || {}).filter((n) => ((saetze[n] || {}).bilder || []).length >= MEM_PAARE_MINDESTENS)
    if (namen.length === 0 && eigene.length < MEM_PAARE_MINDESTENS) {
      // DIESER FALL IST NICHT UNMOEGLICH: Die mitgelieferten Saetze koennen
      // fehlen (aeltere Box, misslungene Auslieferung), und die Werkliste
      // kommt nach und kann geschrumpft sein (anderes Profil).
      inhalt.appendChild(el('div', 'app-leer', 'Dafür sind noch zu wenige Bilder da.'))
      return
    }
    const wahl = el('div', 'mem-wahl')
    wahl.appendChild(el('div', 'mem-wahl-frage', 'Womit möchtest du spielen?'))
    const raster = el('div', 'mem-satz-raster')
    const kachel = (id, wort, vorschau) => {
      const k = el('button', 'mem-satz')
      k.type = 'button'
      if (vorschau) {
        const b = el('img')
        b.alt = ''
        b.loading = 'lazy'
        b.src = vorschau
        k.appendChild(b)
      }
      k.appendChild(el('span', null, wort))
      sprichDann(k, wort, '', () => {
        inhalt.textContent = ''
        memArtWahl(inhalt, id, saetze)
      })
      raster.appendChild(k)
    }
    for (const n of namen) {
      const s = saetze[n]
      // `vorschau` ist im Rezept BEWUSST gewaehlt; das erste Bild waere nur
      // das alphabetisch erste. Bei Tieren stand da der graue Steinelefant
      // statt des roten Papageis — die Kachel ist aber das, woran ein Kind
      // den Satz erkennt.
      kachel(n, s.wort || n, `bilder/memory/${n}/${s.vorschau || s.bilder[0]}`)
    }
    // DIE EIGENEN COVER STEHEN HINTEN und heissen „Meine Bilder" — sie sind
    // der Satz, den nur diese Box hat. Die Vorschau ist das erste Cover; bei
    // einer Bibliothek voller Platzhalter ist das eben das Maskottchen, und
    // das ist ehrlich.
    if (eigene.length >= MEM_PAARE_MINDESTENS) {
      kachel(MEM_SATZ_COVER, 'Meine Bilder', bildAdresse(eigene[0]))
    }
    wahl.appendChild(raster)
    inhalt.appendChild(wahl)
  }

  /** ZWEITE FRAGE: WIE. Die vier Spielarten. */
  function memArtWahl(inhalt, satz, saetze) {
    const wahl = el('div', 'mem-wahl')
    wahl.appendChild(el('div', 'mem-wahl-frage', 'Wie möchtest du spielen?'))
    const raster = el('div', 'mem-wahl-raster')
    // „Alleine" ZUERST — es ist das Spiel, das es vorher gab, und der Tipp,
    // den ein Kind aus Gewohnheit macht, soll genau dort landen. „Zu zweit"
    // daneben als die andere Hauptantwort; die zwei besonderen Arten
    // darunter. Die Woerter werden vorgelesen (`sprichDann`), denn sie sind
    // fuer einen Nichtleser sonst vier gleiche Knoepfe.
    for (const art of [
      { id: 'allein', wort: 'Alleine' },
      { id: 'zuzweit', wort: 'Zu zweit' },
      { id: 'verrueckt', wort: 'Verrückt' },
      { id: 'ohnefehler', wort: 'Ohne Fehler' },
    ]) {
      const k = el('button', 'app-antwort', art.wort)
      k.type = 'button'
      sprichDann(k, art.wort, '', () => {
        inhalt.textContent = ''
        memorySpiel(inhalt, art.id, satz, saetze)
      })
      raster.appendChild(k)
    }
    wahl.appendChild(raster)
    inhalt.appendChild(wahl)
  }

  /**
   * Ein Spiel aufbauen. `art` ist eine der vier Spielarten des Wahlschirms
   * (allein, verrueckt, ohnefehler, zuzweit).
   *
   * OB VOLLBILD IST, SAGT DER BAUM (`body.app-voll`) und keine mitgereichte
   * Wahrheit daneben — dieselbe Haltung wie bei `laneOffen()` in app.js. Der
   * Vollbild-Knopf schaltet die Klasse und baut NEU: Mehr Karten in ein
   * laufendes Brett zu mischen waere ein anderes Spiel, kein anderer Blick
   * darauf.
   */
  function memorySpiel(inhalt, art, satz, saetze) {
    const voll = document.body.classList.contains('app-voll')
    if (satz !== MEM_SATZ_COVER) {
      memBrettBauen(inhalt, art, satz, saetze, memSatzQuellen(satz, (saetze || {})[satz] || {}), voll)
      return
    }
    // DIE EIGENEN COVER MUESSEN ERST GELADEN WERDEN, um sie nach Inhalt
    // aussieben zu koennen — anders als bei einem mitgelieferten Satz, der
    // schon kuratiert ist. Das dauert einen Augenblick, und der wird gesagt.
    inhalt.appendChild(el('div', 'app-leer', 'Einen Augenblick …'))
    const vorher = memoryVorrat().length
    memCoverQuellen(memPaareZahl(voll, MEM_COVER_PRUEFEN_HOECHSTENS)).then((quellen) => {
      if (!inhalt.isConnected) return
      inhalt.textContent = ''
      // WENN DIE AUSSIEBUNG DER GRUND IST, SAGT SIE DAS AUCH. „Zu wenige
      // Bilder" waere hier gelogen — es sind genug, sie sehen nur alle gleich
      // aus (der Platzhalter-Fall, llmwiki rueckfallbild-macht-den-fehler-
      // unsichtbar). Der Unterschied ist fuer den Erwachsenen, der es liest,
      // der ganze Hinweis: das eine heisst „lege Musik auf die Box", das
      // andere „deinen Alben fehlen die Cover". GEMESSEN AN DER ATTRAPPE
      // (09.09.2026): 8 verschiedene Adressen, EIN Bildinhalt.
      if (quellen.length < MEM_PAARE_MINDESTENS && vorher >= MEM_PAARE_MINDESTENS) {
        inhalt.appendChild(el('div', 'app-leer', 'Deine Bilder sehen fast alle gleich aus — such dir oben einen anderen Stapel aus.'))
        return
      }
      memBrettBauen(inhalt, art, satz, saetze, quellen, voll)
    })
  }

  /**
   * Das Brett bauen. `quellen` ist eine Liste aus `{ bild, wort }` — woher
   * sie kommt, ist hier egal, und das ist der Sinn der Trennung: Ein
   * mitgelieferter Satz und die ausgesiebten Cover spielen danach gleich.
   */
  function memBrettBauen(inhalt, art, satz, saetze, quellen, voll) {
    const paarZahl = memPaareZahl(voll, quellen.length)
    if (paarZahl < MEM_PAARE_MINDESTENS) {
      inhalt.appendChild(el('div', 'app-leer', 'Dafür sind noch zu wenige Bilder da.'))
      return
    }

    const paare = memMischen(quellen.slice()).slice(0, paarZahl)
    const karten = memMischen(paare.concat(paare))

    // Die Uhr der Spielart „Verrueckt" steht UEBER dem Brett: unten neben
    // den Knoepfen wuerde sie mit dem Stand um Platz streiten, und ein
    // Balken, der schrumpft, gehoert dorthin, wo der Blick beim Suchen
    // ohnehin ist.
    const uhr = el('div', 'mem-uhr')
    const uhrBalken = el('div', 'mem-uhr-balken')
    uhr.appendChild(uhrBalken)
    uhr.setAttribute('role', 'timer')
    uhr.setAttribute('aria-label', 'Zeit bis zum Mischen')
    const brett = el('div', 'mem-brett')
    const zeile = el('div', 'app-zeile')
    const stand = el('span')
    // Die Chips der Spielart „Zu zweit": Farben statt Namen, denn wer hier
    // spielt, liest noch nicht. Blau faengt an — nicht aus Bedeutung,
    // sondern weil IRGENDWER anfangen muss und die Reihenfolge sichtbar
    // sein soll, bevor der erste Zug faellt.
    const chip1 = el('span', 'mem-spieler')
    chip1.dataset.wer = '1'
    const chip2 = el('span', 'mem-spieler')
    chip2.dataset.wer = '2'
    const voller = el('button', 'app-tat', voll ? 'Kleiner' : 'Vollbild')
    voller.type = 'button'
    voller.setAttribute('aria-pressed', String(voll))
    const neu = el('button', 'app-tat', 'Neues Spiel')
    neu.type = 'button'
    if (art === 'verrueckt') inhalt.appendChild(uhr)
    inhalt.appendChild(brett)
    if (art === 'zuzweit') {
      zeile.appendChild(chip1)
      zeile.appendChild(chip2)
    }
    zeile.appendChild(stand)
    zeile.appendChild(voller)
    zeile.appendChild(neu)
    inhalt.appendChild(zeile)

    let gefunden = 0
    let zuege = 0
    let offen = []
    let sperre = false
    /** Zu zweit: wer dran ist (1 oder 2) und die Paare je Spieler. */
    let dran = 1
    const punkte = [0, 0]
    /** Verrueckt: die laufende Stufe und der Rest der Uhr. */
    let stufe = 1
    let restMs = memCrazyZeitS(1) * 1000
    let takt = null

    /** Welches Werk hinter welcher Karte liegt. In einer Map und NICHT in
     *  der Klick-Closure, weil „Verrueckt" die Zuordnung nach dem Mischen
     *  AENDERT — eine Closure haette den Stand vom Aufbau und deckte nach
     *  dem ersten Mischen das falsche Bild auf. */
    const kartenWerk = new Map()

    function standMalen() {
      const fertig = gefunden === paare.length
      if (art === 'zuzweit') {
        chip1.textContent = String(punkte[0])
        chip2.textContent = String(punkte[1])
        chip1.dataset.dran = !fertig && dran === 1 ? 'ja' : 'nein'
        chip2.dataset.dran = !fertig && dran === 2 ? 'ja' : 'nein'
        chip1.setAttribute('aria-label', 'Blau: ' + punkte[0] + (punkte[0] === 1 ? ' Paar' : ' Paare'))
        chip2.setAttribute('aria-label', 'Rot: ' + punkte[1] + (punkte[1] === 1 ? ' Paar' : ' Paare'))
        if (fertig) {
          stand.textContent =
            punkte[0] === punkte[1]
              ? 'Unentschieden — ' + punkte[0] + ' zu ' + punkte[1]
              : (punkte[0] > punkte[1] ? 'Blau' : 'Rot') + ' gewinnt — ' + Math.max(...punkte) + ' zu ' + Math.min(...punkte)
        } else {
          stand.textContent = dran === 1 ? 'Blau ist dran' : 'Rot ist dran'
        }
        return
      }
      stand.textContent = fertig
        ? 'Geschafft — ' + zuege + (zuege === 1 ? ' Zug' : ' Züge')
        : 'Paare ' + gefunden + ' von ' + paare.length + ' · ' + zuege + (zuege === 1 ? ' Zug' : ' Züge')
    }

    /** Die Uhr anhalten. Steht fuer sich, weil DREI Wege hier ankommen:
     *  Spielende, „Neues Spiel" und der Vollbild-Neubau. */
    function uhrAus() {
      if (takt !== null) {
        clearInterval(takt)
        takt = null
      }
    }

    /** Verrueckt: die noch zugedeckten Karten untereinander mischen. Offene
     *  und gefundene bleiben — die Uhr nimmt dem Kind, was es sich gemerkt
     *  hat, NICHT, was es gerade vor sich sieht. */
    function verdeckteMischen() {
      const zu = []
      for (const b of brett.querySelectorAll('.mem-karte')) {
        if (b.dataset.auf !== 'ja' && b.dataset.fertig !== 'ja') zu.push(b)
      }
      if (zu.length < 2) return
      const werkeZu = memMischen(zu.map((b) => kartenWerk.get(b)))
      for (let i = 0; i < zu.length; i++) {
        kartenWerk.set(zu[i], werkeZu[i])
        zu[i].querySelector('img').src = werkeZu[i].bild
        // DAS WACKELN IST DIE EINZIGE SPUR: Rueckseiten sehen alle gleich
        // aus, und ein unsichtbares Mischen saehe fuer das Kind so aus, als
        // luege sein Gedaechtnis.
        zu[i].classList.add('mem-wirbel')
      }
      setTimeout(() => {
        for (const b of zu) b.classList.remove('mem-wirbel')
      }, MEM_WIRBEL_MS)
    }

    function uhrMalen() {
      const ganzMs = memCrazyZeitS(stufe) * 1000
      uhrBalken.style.width = Math.max(0, Math.min(100, (restMs / ganzMs) * 100)) + '%'
      uhr.dataset.knapp = restMs <= 5000 ? 'ja' : 'nein'
    }

    if (art === 'verrueckt') {
      uhrMalen()
      takt = setInterval(() => {
        // DIE UHR FRAGT DEN BAUM, OB ES SIE NOCH GIBT: `appBuehneZu` leert
        // den Inhalt, ohne diese App zu kennen — ein Takt, der weiterliefe,
        // arbeitete auf Knoten, die niemand mehr zeichnet.
        if (!brett.isConnected) return uhrAus()
        restMs -= MEM_TAKT_MS
        if (restMs <= 0) {
          verdeckteMischen()
          stufe++
          restMs = memCrazyZeitS(stufe) * 1000
        }
        uhrMalen()
      }, MEM_TAKT_MS)
    }

    for (const w of karten) {
      const b = el('button', 'mem-karte')
      b.type = 'button'
      b.dataset.auf = 'nein'
      // DER TITEL STEHT NUR AUF DER OFFENEN KARTE. Ein `aria-label` mit dem
      // Albumnamen auf der ZUGEDECKTEN Karte verriete jedem, der vorlesen
      // laesst, das ganze Brett — die Sprachausgabe waere ein Spickzettel.
      b.setAttribute('aria-label', 'Verdeckte Karte')
      kartenWerk.set(b, w)
      const bild = el('img')
      bild.alt = ''
      bild.loading = 'eager'
      bild.src = w.bild
      b.appendChild(bild)
      const deckel = el('div', 'mem-deckel')
      deckel.insertAdjacentHTML(
        'beforeend',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          katSymbol('music') +
          '</svg>',
      )
      b.appendChild(deckel)
      b.addEventListener('click', () => {
        if (sperre || b.dataset.auf === 'ja' || b.dataset.fertig === 'ja') return
        b.dataset.auf = 'ja'
        b.setAttribute('aria-label', kartenWerk.get(b).wort)
        offen.push(b)
        if (offen.length < 2) return
        zuege++
        const [a, c] = offen
        if (kartenWerk.get(a).bild === kartenWerk.get(c).bild) {
          a.dataset.fertig = 'ja'
          c.dataset.fertig = 'ja'
          gefunden++
          if (art === 'zuzweit') {
            punkte[dran - 1]++
            // AUCH NACH EINEM TREFFER WECHSELT ES — siehe memNaechsterDran:
            // das ist die bestellte Regel, nicht die Turnierregel.
            if (gefunden < paare.length) dran = memNaechsterDran(2, dran)
          }
          if (gefunden === paare.length) uhrAus()
          offen = []
          standMalen()
          return
        }
        // SPERRE, SOLANGE ES OFFEN LIEGT: Ohne sie dreht ein schnelles Kind
        // eine dritte Karte um, waehrend die Zeituhr noch laeuft — und die
        // raeumt dann die falsche weg.
        sperre = true
        if (art === 'ohnefehler') brett.dataset.patzer = 'ja'
        standMalen()
        setTimeout(() => {
          if (art === 'ohnefehler') {
            // EIN FEHLER, ALLES ZU — auch die gefundenen Paare. Gemischt
            // wird NICHT (Betreiber: „mischen aber nicht"): Die Lage bleibt,
            // nur der Fortschritt faellt. Die Zuege zaehlen weiter, denn sie
            // erzaehlen hinterher ehrlich, was der eine Fehler gekostet hat.
            for (const k of brett.querySelectorAll('.mem-karte')) {
              k.dataset.auf = 'nein'
              k.dataset.fertig = 'nein'
              k.setAttribute('aria-label', 'Verdeckte Karte')
            }
            gefunden = 0
            brett.dataset.patzer = 'nein'
          } else {
            for (const o of offen) {
              o.dataset.auf = 'nein'
              o.setAttribute('aria-label', 'Verdeckte Karte')
            }
          }
          if (art === 'zuzweit') dran = memNaechsterDran(2, dran)
          offen = []
          sperre = false
          standMalen()
        }, MEM_ZEIGEN_MS)
      })
      brett.appendChild(b)
    }

    standMalen()

    // DIE MASSE ERST JETZT: Vorher steht das Brett nicht im Baum und hat
    // keine Kante. Gemessen wird die Flaeche, die das Brett WIRKLICH bekommen
    // hat — nicht die Buehne minus geratener Zeilenhoehe.
    const flaeche = brett.getBoundingClientRect()
    const masse = memBrettMasse(karten.length, flaeche.width, flaeche.height, MEM_LUECKE_PX)
    brett.style.setProperty('--mem-spalten', String(masse.spalten))
    brett.style.setProperty('--mem-karte', Math.floor(masse.karte) + 'px')

    voller.addEventListener('click', () => {
      // DIESELBE KLASSE WIE BEIM MALEN (`app-voll`), und `appBuehneZu` raeumt
      // sie beim Verlassen ab. Danach wird NEU GEBAUT, in derselben Art:
      // Die Paarzahl haengt an der Ansicht, und die Karten muessen neu
      // gemessen werden — zwei Bilder warten, bis der Browser die neue
      // Geometrie gerechnet hat (dieselbe Falle wie beim Malen).
      document.body.classList.toggle('app-voll')
      uhrAus()
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          inhalt.textContent = ''
          memorySpiel(inhalt, art, satz, saetze)
        }),
      )
    })

    neu.addEventListener('click', () => {
      uhrAus()
      inhalt.textContent = ''
      memoryStarten(inhalt)
    })
  }

  /* ── PUZZLE ───────────────────────────────────────────────────────────────
   *
   * Ein Schiebepuzzle aus EINEM Cover. Es nimmt denselben Vorrat wie Memory
   * und aus demselben Grund: ein Bild, das das Kind kennt, ist der halbe
   * Reiz — und es kostet keinen zusaetzlichen Abruf.
   */

  /** Drei mal drei. Vier mal vier waere auf 800x480 noch zu treffen, aber
   *  ein Schiebepuzzle mit 15 Steinen loest kein Vorschulkind mehr. */
  const PUZ_KANTE = 3
  /** So viele Zuege wird aus der GELOESTEN Lage heraus gemischt.
   *
   * GEMISCHT WIRD MIT ZUEGEN UND NICHT MIT EINER ZUFALLSFOLGE, und das ist
   * kein Geschmack: Von den 9! Anordnungen eines 3x3-Schiebepuzzles ist die
   * HAELFTE unloesbar. Wuerfelt man die Steine frei, steht das Kind in jedem
   * zweiten Spiel vor einer Aufgabe, die niemand loesen kann — und nichts am
   * Schirm sagt ihm das. Aus der Loesung heraus zu mischen kann diese Lage
   * gar nicht erzeugen.
   */
  const PUZ_MISCHZUEGE = 60

  /** Die Nachbarn eines Feldes im Raster — waagerecht und senkrecht. */
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

  /** Aus der Loesung heraus mischen. `lage[feld] = heimat des Steins`,
   *  `null` ist die Luecke. */
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

  /** Steht jeder Stein auf seiner Heimat? */
  function puzGeloest(lage) {
    return lage.every((h, i) => (i === lage.length - 1 ? h === null : h === i))
  }

  function puzzleStarten(inhalt) {
    const vorrat = memoryVorrat()
    if (vorrat.length < 1) {
      inhalt.appendChild(el('div', 'app-leer', 'Dafür ist noch kein Bild da.'))
      return
    }
    const werk = vorrat[Math.floor(Math.random() * vorrat.length)]
    const bild = bildAdresse(werk)
    let lage = puzMischen(PUZ_KANTE, PUZ_MISCHZUEGE)
    let zuege = 0

    const brett = el('div', 'puz-brett')
    brett.style.setProperty('--puz-kante', String(PUZ_KANTE))
    const zeile = el('div', 'app-zeile')
    const stand = el('span')
    const neu = el('button', 'app-tat', 'Neues Bild')
    neu.type = 'button'
    zeile.append(stand, neu)
    inhalt.append(brett, zeile)

    function malen() {
      brett.textContent = ''
      const fertig = puzGeloest(lage)
      for (let feld = 0; feld < lage.length; feld++) {
        const heimat = lage[feld]
        // DIE LUECKE BLEIBT LEER — ausser am Schluss: Ist es geloest, wird
        // auch der letzte Stein gezeigt. Ein Puzzle, das geloest ist und
        // trotzdem ein Loch hat, sieht nicht nach „geschafft" aus.
        if (heimat === null && !fertig) {
          brett.appendChild(el('div', 'puz-luecke'))
          continue
        }
        const h = heimat === null ? lage.length - 1 : heimat
        const s = el('button', 'puz-stein')
        s.type = 'button'
        s.style.backgroundImage = `url("${bild}")`
        // 3x3 Ausschnitt: Prozentschritte von 0 bis 100 ueber (kante - 1).
        const sp = (h % PUZ_KANTE) * (100 / (PUZ_KANTE - 1))
        const ze = Math.floor(h / PUZ_KANTE) * (100 / (PUZ_KANTE - 1))
        s.style.backgroundPosition = `${sp}% ${ze}%`
        s.setAttribute('aria-label', `Stein ${h + 1}`)
        if (fertig) s.dataset.fertig = 'ja'
        else
          s.addEventListener('click', () => {
            const luecke = lage.indexOf(null)
            if (!puzNachbarn(feld, PUZ_KANTE).includes(luecke)) return
            lage[luecke] = lage[feld]
            lage[feld] = null
            zuege++
            malen()
          })
        brett.appendChild(s)
      }
      stand.textContent = fertig
        ? `Geschafft — ${zuege} ${zuege === 1 ? 'Zug' : 'Züge'}`
        : `${werk.titel} · ${zuege} ${zuege === 1 ? 'Zug' : 'Züge'}`
    }
    malen()
    neu.addEventListener('click', () => {
      inhalt.textContent = ''
      puzzleStarten(inhalt)
    })
  }

  /* ── RECHNEN ──────────────────────────────────────────────────────────────
   *
   * WARUM HIER NICHT `aufgabeWuerfeln()` STEHT, obwohl es sie gibt: Die
   * Aufgabe des Eltern-Tors ist zwei Faktoren von 3 bis 9 — und sie ist
   * ausdruecklich SO gewaehlt, dass ein Vorschulkind sie NICHT loest („klein
   * genug, dass ein Erwachsener sie im Vorbeigehen loest, gross genug, dass
   * ein Vorschulkind es nicht tut"). Genau dieselbe Funktion hier zu rufen
   * hiesse, ein Lernspiel zu bauen, das ein Kind planmaessig nicht schafft.
   * Die beiden sehen gleich aus und haben entgegengesetzte Absichten; sie
   * zusammenzulegen waere die schlimmere Doppelung.
   */

  /** Bis hierher wird gerechnet. Zehn ist der Zahlenraum, den ein Kind an
   *  den Fingern nachpruefen kann. */
  const RECH_BIS = 10
  /** So viele Antworten stehen zur Wahl. Getippt wird NICHT: Ein Zahlenfeld
   *  setzt voraus, dass das Kind Ziffern schon schreiben kann — Auswaehlen
   *  setzt nur voraus, dass es sie erkennt. */
  const RECH_WAHLEN = 3

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

  function rechnenStarten(inhalt) {
    let richtig = 0
    let gestellt = 0

    const frage = el('div', 'app-frage')
    const wahl = el('div', 'app-wahl')
    const zeile = el('div', 'app-zeile')
    const stand = el('span')
    zeile.appendChild(stand)
    inhalt.append(frage, wahl, zeile)

    function standMalen() {
      stand.textContent = gestellt === 0 ? 'Wie viel ist das?' : `${richtig} von ${gestellt} richtig`
    }

    function naechste() {
      const a = rechenAufgabe()
      frage.textContent = `${a.text} = ?`
      wahl.textContent = ''
      // DIE FALSCHEN ANTWORTEN LIEGEN DANEBEN, nicht irgendwo: Ein Kind, das
      // 7 statt 8 waehlt, hat sich um eins vertan — eine Auswahl aus 3, 8, 25
      // waere durch Hingucken zu loesen, ohne zu rechnen.
      const menge = new Set([a.antwort])
      let weite = 1
      while (menge.size < RECH_WAHLEN) {
        for (const d of [-weite, weite]) {
          const k = a.antwort + d
          if (k >= 0 && k <= RECH_BIS * 2) menge.add(k)
        }
        weite++
      }
      const zahlen = memMischen([...menge].slice(0, RECH_WAHLEN))
      for (const z of zahlen) {
        const k = el('button', 'app-antwort', String(z))
        k.type = 'button'
        k.addEventListener('click', () => {
          if (wahl.dataset.beantwortet === 'ja') return
          wahl.dataset.beantwortet = 'ja'
          gestellt++
          const stimmt = z === a.antwort
          if (stimmt) richtig++
          k.dataset.wie = stimmt ? 'richtig' : 'falsch'
          // BEI EINEM FEHLER WIRD DIE RICHTIGE GEZEIGT. Ein „falsch" ohne die
          // Loesung laesst das Kind mit der Frage stehen, die es gerade nicht
          // beantworten konnte.
          if (!stimmt) {
            for (const x of wahl.querySelectorAll('.app-antwort')) {
              if (x.textContent === String(a.antwort)) x.dataset.wie = 'richtig'
            }
          }
          standMalen()
          setTimeout(() => {
            wahl.dataset.beantwortet = ''
            naechste()
          }, stimmt ? 700 : 1600)
        })
        wahl.appendChild(k)
      }
    }
    standMalen()
    naechste()
  }

  /* ── UHR LERNEN ───────────────────────────────────────────────────────────
   *
   * Ein Zifferblatt, und darunter drei Zeiten zur Wahl — DIESELBE Bedienung
   * wie beim Rechnen, mit denselben Klassen (`app-wahl`, `app-antwort`). Zwei
   * Ratespiele mit zwei verschiedenen Bauarten waeren zwei Dinge zu lernen,
   * wo eines genuegt.
   *
   * VOLLE UND HALBE STUNDEN, mehr nicht. Viertel vor/nach ist die naechste
   * Stufe und braucht ein anderes Zifferblatt (Minutenstriche); wer beides
   * zugleich anbietet, hat ein Spiel, das keine Stufe richtig macht.
   */

  /** Die deutschen Uhrzeit-Woerter — und DAS IST DIE STILLE STELLE:
   *  „halb 4" ist 3:30 und nicht 4:30. Der Sprung um eine Stunde ist im
   *  Deutschen die Regel und im Code ein Fehler, der sich wie ein Tippfehler
   *  liest. Genau deshalb steht er in einer eigenen Funktion und in der
   *  Pruefung (`tools/pruef-neu-regeln.js`). */
  function uhrWort(stunde, minute) {
    const h = ((stunde - 1 + 12) % 12) + 1
    if (minute === 30) return `halb ${(h % 12) + 1}`
    return `${h} Uhr`
  }

  /** Eine Zeit wuerfeln: volle oder halbe Stunde, 1 bis 12. */
  function uhrZeitWuerfeln() {
    return { stunde: 1 + Math.floor(Math.random() * 12), minute: Math.random() < 0.5 ? 0 : 30 }
  }

  /** Drei Zeiten zur Wahl — die richtige und zwei NAHE daneben.
   *
   * NAHE UND NICHT BELIEBIG, aus demselben Grund wie beim Rechnen: Wer
   * „3 Uhr" gegen „9 Uhr" und „halb 12" stellt, prueft nicht das Ablesen,
   * sondern das Erkennen des einen kurzen Zeigers. Die halbe Stunde daneben
   * ist ausdruecklich dabei — sie ist die Verwechslung, um die es geht. */
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

  /** Das Zifferblatt als SVG.
   *
   * KEIN `--` IRGENDWO DARIN: Zwei Bindestriche beenden im XML einen
   * Kommentar und machen die Datei zum Parserfehler (llmwiki
   * zwei-bindestriche-toeten-svg). Hier stehen ohnehin keine Kommentare —
   * die Zeile steht als Warnung fuer den, der welche einbaut. */
  function uhrBlattSvg(stunde, minute) {
    const teile = []
    for (let i = 0; i < 12; i++) {
      const w = (i * 30 * Math.PI) / 180
      const x1 = 50 + 38 * Math.sin(w)
      const y1 = 50 - 38 * Math.cos(w)
      const x2 = 50 + 43 * Math.sin(w)
      const y2 = 50 - 43 * Math.cos(w)
      teile.push(
        `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke-width="${i % 3 === 0 ? 3 : 1.6}"/>`,
      )
      const zx = 50 + 31 * Math.sin(w)
      const zy = 50 - 31 * Math.cos(w)
      teile.push(
        `<text x="${zx.toFixed(2)}" y="${(zy + 3.4).toFixed(2)}" text-anchor="middle" font-size="9" font-weight="800" stroke="none" fill="currentColor">${i === 0 ? 12 : i}</text>`,
      )
    }
    const sw = (((stunde % 12) + minute / 60) * 30 * Math.PI) / 180
    const mw = ((minute * 6) * Math.PI) / 180
    teile.push(
      `<line x1="50" y1="50" x2="${(50 + 22 * Math.sin(sw)).toFixed(2)}" y2="${(50 - 22 * Math.cos(sw)).toFixed(2)}" stroke-width="4.5" stroke-linecap="round"/>`,
    )
    teile.push(
      `<line x1="50" y1="50" x2="${(50 + 33 * Math.sin(mw)).toFixed(2)}" y2="${(50 - 33 * Math.cos(mw)).toFixed(2)}" stroke-width="3" stroke-linecap="round"/>`,
    )
    teile.push('<circle cx="50" cy="50" r="2.6" stroke="none" fill="currentColor"/>')
    return (
      '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="47" stroke-width="2.5"/>' +
      teile.join('') +
      '</svg>'
    )
  }

  function uhrStarten(inhalt) {
    let richtig = 0
    let gestellt = 0

    const blatt = el('div', 'uhr-blatt')
    const wahl = el('div', 'app-wahl')
    const zeile = el('div', 'app-zeile')
    const stand = el('span')
    zeile.appendChild(stand)
    inhalt.append(blatt, wahl, zeile)

    function standMalen() {
      stand.textContent =
        gestellt === 0 ? 'Wie spät ist es?' : `${richtig} von ${gestellt} richtig`
    }

    function naechste() {
      const zeit = uhrZeitWuerfeln()
      const sollWort = uhrWort(zeit.stunde, zeit.minute)
      blatt.textContent = ''
      blatt.insertAdjacentHTML('beforeend', uhrBlattSvg(zeit.stunde, zeit.minute))
      // DIE UHR SAGT DER SPRACHAUSGABE NICHT, WIE SPAET ES IST. Ein
      // `aria-label` mit der Antwort waere der Spickzettel, denselben Fehler
      // haette Memory mit dem Titel auf der verdeckten Karte gemacht.
      blatt.setAttribute('role', 'img')
      blatt.setAttribute('aria-label', 'Eine Uhr')
      wahl.textContent = ''
      wahl.dataset.beantwortet = ''
      for (const w of memMischen(uhrAuswahl(zeit, 3))) {
        const k = el('button', 'app-antwort', w)
        k.type = 'button'
        const antworten = () => {
          if (wahl.dataset.beantwortet === 'ja') return
          wahl.dataset.beantwortet = 'ja'
          gestellt++
          const stimmt = w === sollWort
          if (stimmt) richtig++
          k.dataset.wie = stimmt ? 'richtig' : 'falsch'
          if (!stimmt) {
            for (const x of wahl.querySelectorAll('.app-antwort')) {
              if (x.textContent === sollWort) x.dataset.wie = 'richtig'
            }
            // BEI EINEM FEHLER WIRD DIE RICHTIGE ZEIT GESAGT, nicht nur
            // gruen gemalt. „halb 4" ist genau das Wort, um das es geht —
            // wer es falsch hatte, soll es hoeren. Bei RICHTIG bleibt es
            // still: dort hat `sprichDann` das Wort schon gesprochen, und
            // zweimal dasselbe hintereinander ist keine Bestaetigung,
            // sondern ein Stottern.
            setTimeout(() => void stimme.sprich(sollWort, false), 500)
          }
          standMalen()
          setTimeout(naechste, stimmt ? 800 : 1800)
        }
        // ── VORGELESEN BEIM ANTIPPEN (Betreiber, 03.09.2026) ────────────
        //
        // UEBER `sprichDann` UND NICHT MIT EINEM EIGENEN `stimme.sprich`:
        // Das ist der EINE Weg des Hauses, auf dem in dieser Oberflaeche
        // gesprochen wird. Er bringt drei Dinge mit, die ein eigener Aufruf
        // alle einzeln nachbauen muesste: Er haelt sich an den eingestellten
        // Modus (bei „aus" tut er einfach die Tat), er haelt im Lernmodus
        // den Tipp auf, bis das Wort durch ist — erst hoeren, dann waehlen,
        // und genau das ist hier der Sinn —, und er schreibt `data-sprich`
        // ans Element, woran `tools/neu-sprechen-schau.mjs` von aussen
        // pruefen kann, WAS ein Knopf sagen wuerde.
        //
        // WAS DAS FUER EIN KIND HEISST, DAS NOCH NICHT LIEST: Ohne diese
        // Zeile ist die Uhr fuer es unbedienbar — „halb 4" und „4 Uhr" sind
        // dann zwei gleich aussehende Muster. Es ist also keine Zutat,
        // sondern das, was die App fuer ihre Zielgruppe erst benutzbar macht.
        sprichDann(k, w, '', antworten)
        wahl.appendChild(k)
      }
    }
    standMalen()
    naechste()
  }

  /* ── LESEN ────────────────────────────────────────────────────────────────
   *
   * Ein Wort gross, und auf Tipp wird es vorgelesen. DIE WOERTER SIND DIE
   * TITEL DER EIGENEN BIBLIOTHEK und keine mitgelieferte Liste: Was hier
   * steht, hat das Kind schon auf einer Kachel gesehen — und eine Wortliste
   * im Quelltext waere Inhalt, der gepflegt werden muesste und in keiner
   * Sprache ausser Deutsch stimmte.
   *
   * OHNE STIMME GIBT ES DIE APP NICHT (`kann`). Ein „Lesen", das nicht
   * vorliest, ist ein Bilderrahmen — und die Sprachausgabe haengt an Piper
   * auf der Box, nicht an dieser Seite (`stimme.laden` fragt `bereit`).
   */
  function lesenVorrat() {
    const gesehen = new Set()
    const raus = []
    for (const w of werke.liste) {
      if (!brauchbar(w)) continue
      const t = String(w.titel || '').trim()
      if (t.length < 2 || gesehen.has(t)) continue
      gesehen.add(t)
      raus.push(t)
    }
    return raus
  }

  function lesenStarten(inhalt) {
    const worte = memMischen(lesenVorrat())
    if (worte.length === 0) {
      inhalt.appendChild(el('div', 'app-leer', 'Dafür sind noch keine Titel da.'))
      return
    }
    let i = 0
    const wort = el('button', 'les-wort')
    wort.type = 'button'
    const zeile = el('div', 'app-zeile')
    const stand = el('span', null, 'Antippen zum Vorlesen')
    const weiter = el('button', 'app-tat', 'Weiter')
    weiter.type = 'button'
    zeile.append(stand, weiter)
    inhalt.append(wort, zeile)

    function zeigen() {
      wort.textContent = worte[i % worte.length]
      wort.setAttribute('aria-label', `${worte[i % worte.length]}, vorlesen`)
    }
    wort.addEventListener('click', () => {
      // `silben: true` — dieselbe Zutat, die der Lernmodus der Kacheln nutzt:
      // langsamer und in Silben, und genau darum geht es beim Lesen.
      void stimme.sprich(wort.textContent, true)
    })
    weiter.addEventListener('click', () => {
      i++
      zeigen()
    })
    zeigen()
  }

  const SCHUBLADE_APPS = [
    {
      id: 'memory',
      name: 'Memory',
      // Zwei Karten, eine davon angehoben — dieselbe Strichbreite und
      // dieselbe Rundung wie die Zeichen in `KATEGORIEN`, damit die Zeile
      // nicht aus der Reihe faellt.
      symbol:
        '<rect x="3" y="6" width="8.5" height="12" rx="2.2"/><rect x="13" y="4" width="8.5" height="12" rx="2.2"/><path d="M6 12h2.5M16 9h2.5"/>',
      // KEIN `kann` MEHR (E140): Memory brachte bis heute seine Karten aus
      // der Bibliothek mit und war ohne Medien nicht da. Seit die Saetze
      // MITGELIEFERT werden (bilder/memory/), laeuft es auf einer frisch
      // aufgesetzten Box ohne einen einzigen Titel — wie Rechnen, Uhr und
      // Malen. Fehlen ausnahmsweise beide Quellen (aeltere Box, misslungene
      // Auslieferung), sagt der Wahlschirm das; das ist ehrlicher als eine
      // App, die aus der Leiste verschwindet, ohne dass jemand weiss warum.
      auf: (inhalt) => memoryStarten(inhalt),
    },
    {
      id: 'puzzle',
      name: 'Puzzle',
      // Vier Felder, eines davon versetzt — das Schieben als Bild.
      symbol:
        '<rect x="3" y="3" width="8" height="8" rx="1.6"/><rect x="13" y="3" width="8" height="8" rx="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.6"/><path d="M14 17h6M17 14v6"/>',
      kann: () => memoryVorrat().length >= 1,
      auf: (inhalt) => puzzleStarten(inhalt),
    },
    {
      id: 'rechnen',
      name: 'Rechnen',
      // Ein Plus und ein Minus — die beiden Rechenarten dieser App, nicht
      // ein allgemeines Zeichen fuer „Mathe".
      symbol: '<path d="M4 8h8M8 4v8M14 16h6"/><rect x="2" y="2" width="20" height="20" rx="3"/>',
      // KEIN `kann`: Rechnen braucht keine Bibliothek und keine Stimme. Es
      // laeuft auf einer frisch aufgesetzten Box ohne einen einzigen Titel —
      // und ist damit die einzige App hier, die IMMER dasteht.
      auf: (inhalt) => rechnenStarten(inhalt),
    },
    {
      id: 'uhr',
      name: 'Uhr',
      // Ein Zifferblatt mit zwei Zeigern — auf 24 px muss es das sein und
      // nicht zwoelf Striche; die waeren bei dieser Groesse ein grauer Ring.
      symbol: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
      // KEIN `kann`: Die Uhr braucht weder Bibliothek noch Stimme noch Ton.
      auf: (inhalt) => uhrStarten(inhalt),
    },
    {
      id: 'lesen',
      name: 'Lesen',
      // Ein aufgeschlagenes Buch.
      symbol: '<path d="M12 6.5C10.5 5 8 4.5 3 4.5v13c5 0 7.5 0.5 9 2 1.5-1.5 4-2 9-2v-13c-5 0-7.5 0.5-9 2zM12 6.5v13"/>',
      // ZWEI BEDINGUNGEN, und beide sind echt: ohne Titel gibt es nichts zu
      // lesen, ohne Stimme nichts vorzulesen. Faellt eine weg, ist die App
      // NICHT DA — statt ausgegraut dazustehen und auf den Tipp zu schweigen.
      kann: () => stimme.modus !== 'aus' && lesenVorrat().length > 0,
      auf: (inhalt) => lesenStarten(inhalt),
    },
    {
      id: 'malen',
      name: 'Malen',
      // Ein Stift mit einer Spur — nicht ein Pinsel: Der Strich ist das, was
      // die App tut, und er ist auf 24 px auch noch zu erkennen.
      symbol: '<path d="M4 20l4-1 9.5-9.5a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/><path d="M14.5 6.5l3 3"/>',
      // KEIN `kann`: Malen braucht nichts — keine Bibliothek, keine Stimme,
      // keinen Ton. Es ist die App, die auf einer frisch aufgesetzten Box
      // ohne einen einzigen Titel funktioniert.
      auf: (inhalt) => malenStarten(inhalt),
    },
  ]

  /* ── MALEN ────────────────────────────────────────────────────────────────
   *
   * Die einzige App hier, die etwas ERZEUGT statt etwas abzufragen — und die
   * einzige ohne richtig und falsch. Genau deshalb steht sie drin: Memory,
   * Puzzle, Rechnen und Uhr haben alle eine Loesung, und ein Kind, das gerade
   * keine Aufgabe will, hatte bis hierher nichts.
   */

  /** Die Farben. ACHT UND NICHT ZWANZIG: Eine Palette, die scrollt, ist ein
   *  Menue; acht Knoepfe passen nebeneinander und sind mit dem Finger zu
   *  treffen. Schwarz steht zuerst, weil damit angefangen wird. */
  const MAL_FARBEN = ['#2e2a3b', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ffffff']
  /** Strichstaerken — drei, und die duenne ist nicht duenn: Auf einem
   *  800x480-Schirm mit dem Finger gemalt ist alles unter 4 px ein Kratzer. */
  const MAL_STAERKEN = [6, 14, 30]

  /**
   * Wie viele Bildpunkte die Leinwand je CSS-Pixel bekommt.
   *
   * GEDECKELT UND NICHT BLIND `devicePixelRatio`: Auf einem Schirm mit DPR 3
   * waere eine 700x330-Leinwand 2100x990 Punkte — das sind 8 MB im Speicher,
   * und der ist auf dieser Box die knappe Groesse (llmwiki pi5-hat-16k-seiten).
   * Zwei reichen fuer einen glatten Strich; darueber sieht niemand mehr etwas.
   */
  function malPunktdichte() {
    const d = Number(window.devicePixelRatio) || 1
    return Math.max(1, Math.min(2, d))
  }

  function malenStarten(inhalt) {
    const flaeche = el('div', 'mal-flaeche')
    const leinwand = document.createElement('canvas')
    leinwand.className = 'mal-leinwand'
    flaeche.appendChild(leinwand)
    const leiste = el('div', 'mal-leiste')
    inhalt.append(flaeche, leiste)

    const stift = { farbe: MAL_FARBEN[0], staerke: MAL_STAERKEN[1] }
    let zeichnet = null

    /* ── DIE LEINWAND WIRD GEMESSEN, UND ZWAR SPAET GENUG ─────────────────
     *
     * DER FEHLER, DEN DAS BEHEBT (gemessen 03.09.2026): Zuerst wurde
     * unmittelbar nach dem Einhaengen die Kante des ELTERN-Kastens genommen.
     * Zu dem Zeitpunkt stand die Leiste darunter noch nicht, und der Kasten
     * war zu hoch — der Puffer wurde 680x263, angezeigt wurde er 680x221.
     * Eine Leinwand, deren Puffer nicht zu ihrer Anzeige passt, wird
     * GESTRECKT: Der Strich landet nicht unter dem Finger, sondern immer
     * weiter daneben, je weiter unten man malt. Am Schirm sieht das nicht
     * nach einem Rechenfehler aus, sondern nach einem schlechten Touchscreen.
     *
     * ZWEI DINGE MACHEN ES RICHTIG: Gemessen wird die LEINWAND SELBST (nicht
     * ihr Elternteil — sie ist es, die zur Anzeige passen muss), und erst
     * nachdem der Browser einmal gerechnet hat.
     *
     * UND EIN BEOBACHTER, ABER MIT BREMSE: Kommt die endgueltige Groesse
     * spaeter (Schrift geladen, Leiste umgebrochen), wird nachgestellt —
     * aber NUR, solange nichts gemalt ist. Jedes Setzen von width/height
     * leert eine Leinwand, und einem Kind mitten im Bild die Flaeche zu
     * loeschen waere schlimmer als ein paar Pixel Ungenauigkeit. */
    let bemalt = false
    let ctx = leinwand.getContext('2d')
    /**
     * @param erhalten Das Bild mitnehmen? Beim ersten Stellen ist nichts da;
     *   beim Wechsel ins Vollbild ist es das ganze Werk des Kindes.
     */
    const stellen = (erhalten) => {
      const r = leinwand.getBoundingClientRect()
      if (!(r.width > 0) || !(r.height > 0)) return
      const p = malPunktdichte()
      const b = Math.max(1, Math.round(r.width * p))
      const h = Math.max(1, Math.round(r.height * p))
      if (leinwand.width === b && leinwand.height === h) return
      // ── DAS BILD UEBER DIE GROESSENAENDERUNG RETTEN ────────────────────
      // Jedes Setzen von width/height LEERT eine Leinwand — das ist keine
      // Nebenwirkung, sondern die Vorschrift. Ohne diese Kopie waere der
      // Vollbild-Knopf ein „alles weg"-Knopf, und zwar einer, der aussieht
      // wie eine Ansicht. Skaliert wird auf die neue Kante: Das Bild wird
      // dabei etwas unschaerfer, aber es ist noch da — und das ist die
      // Reihenfolge der Zugestaendnisse, die ein Kind versteht.
      let alt = null
      if (erhalten && bemalt && leinwand.width > 0 && leinwand.height > 0) {
        alt = document.createElement('canvas')
        alt.width = leinwand.width
        alt.height = leinwand.height
        alt.getContext('2d').drawImage(leinwand, 0, 0)
      }
      leinwand.width = b
      leinwand.height = h
      ctx = leinwand.getContext('2d')
      ctx.scale(p, p)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (alt) ctx.drawImage(alt, 0, 0, alt.width, alt.height, 0, 0, b / p, h / p)
    }
    stellen(false)
    requestAnimationFrame(() => requestAnimationFrame(() => stellen(true)))
    /* DER BEOBACHTER BLEIBT, UND ER NIMMT DAS BILD MIT.
     *
     * HIER STAND `if (bemalt) return beobachter.disconnect()` — er hoerte
     * also beim ersten Strich auf. Die Absicht war richtig (eine Leinwand
     * loescht sich beim Groessesetzen), der Schluss falsch: `stellen(true)`
     * KANN das Bild retten, es wird nur skaliert.
     *
     * AM GERAET GEMESSEN (04.09.2026, Box .62), was das anrichtete:
     *     klein    Anzeige 1160x461   Puffer 1160x503
     *     Vollbild Anzeige 1168x578   Puffer 1160x503  (unveraendert!)
     * Ein Puffer, der nicht zur Anzeige passt, wird GESTRECKT — der Strich
     * landet nicht unter dem Finger, sondern immer weiter daneben, je weiter
     * unten man malt. Und der Vollbild-Knopf stellte gar nicht mehr nach,
     * weil zu dem Zeitpunkt laengst gemalt war.
     *
     * Der Preis ist eine Neuskalierung je Groessenwechsel; das Bild wird
     * dabei etwas weicher. Das ist die richtige Reihenfolge der
     * Zugestaendnisse: lieber ein weicheres Bild als ein Strich, der nicht
     * dort ist, wo der Finger war. */
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => stellen(true)).observe(leinwand)
    }

    function punkt(e) {
      const r = leinwand.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    leinwand.addEventListener('pointerdown', (e) => {
      leinwand.setPointerCapture(e.pointerId)
      zeichnet = punkt(e)
      // AB HIER STEHT ETWAS AUF DEM BLATT — der Beobachter oben stellt die
      // Groesse ab jetzt nicht mehr nach, weil das loeschen wuerde.
      bemalt = true
      // EIN TIPP IST EIN PUNKT. Ohne diese zwei Zeilen malt ein einzelner
      // Tipp gar nichts — man muesste immer ziehen, und ein Punkt ist das
      // Erste, was ein kleines Kind macht.
      ctx.fillStyle = stift.farbe
      ctx.beginPath()
      ctx.arc(zeichnet.x, zeichnet.y, stift.staerke / 2, 0, Math.PI * 2)
      ctx.fill()
    })
    leinwand.addEventListener('pointermove', (e) => {
      if (!zeichnet) return
      const p = punkt(e)
      ctx.strokeStyle = stift.farbe
      ctx.lineWidth = stift.staerke
      ctx.beginPath()
      ctx.moveTo(zeichnet.x, zeichnet.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      zeichnet = p
    })
    for (const art of ['pointerup', 'pointercancel', 'pointerleave']) {
      leinwand.addEventListener(art, () => {
        zeichnet = null
      })
    }

    // ── DIE LEISTE ───────────────────────────────────────────────────────
    for (const f of MAL_FARBEN) {
      const k = el('button', 'mal-farbe')
      k.type = 'button'
      k.style.background = f
      k.dataset.gewaehlt = f === stift.farbe ? 'ja' : 'nein'
      k.setAttribute('aria-label', 'Farbe')
      k.addEventListener('click', () => {
        stift.farbe = f
        for (const x of leiste.querySelectorAll('.mal-farbe')) x.dataset.gewaehlt = 'nein'
        k.dataset.gewaehlt = 'ja'
      })
      leiste.appendChild(k)
    }
    for (const s of MAL_STAERKEN) {
      const k = el('button', 'mal-staerke')
      k.type = 'button'
      k.dataset.gewaehlt = s === stift.staerke ? 'ja' : 'nein'
      k.setAttribute('aria-label', `Strich ${s === MAL_STAERKEN[0] ? 'dünn' : s === MAL_STAERKEN[1] ? 'mittel' : 'dick'}`)
      const punktchen = el('span')
      punktchen.style.width = `${Math.round(s * 0.7)}px`
      punktchen.style.height = `${Math.round(s * 0.7)}px`
      k.appendChild(punktchen)
      k.addEventListener('click', () => {
        stift.staerke = s
        for (const x of leiste.querySelectorAll('.mal-staerke')) x.dataset.gewaehlt = 'nein'
        k.dataset.gewaehlt = 'ja'
      })
      leiste.appendChild(k)
    }
    // LEEREN OHNE RUECKFRAGE, ABER MIT ABSTAND: Der Knopf steht ganz rechts,
    // weit weg von den Farben. Eine Rueckfrage („wirklich?") waere hier
    // schlechter — sie setzt Lesen voraus, und ein neues Blatt ist bei einem
    // Malprogramm kein Verlust, sondern der uebliche naechste Schritt.
    /* ── VOLLBILD (Betreiber, 03.09.2026: „ich moechte noch einen fullscreen
     * fuer das malen") ────────────────────────────────────────────────────
     *
     * Es schaltet eine Klasse am `body`, und das CSS macht daraus eine Buehne
     * ueber ALLES — auch ueber die Leiste links und das Kissen unten. Der
     * eine Rueckweg oben links bleibt erreichbar (z-index 9 ueber der Buehne
     * mit 8), das Kind kommt also immer heraus.
     *
     * DIE LEINWAND WIRD DANACH NEU GESTELLT UND BEHAELT IHR BILD. Ohne das
     * waere der Knopf ein Loeschknopf, der wie eine Ansicht aussieht.
     *
     * ZWEI BILDER WARTEN, bevor gemessen wird: Die Klasse aendert die
     * Geometrie, und `getBoundingClientRect` liefert die neue Kante erst,
     * wenn der Browser gerechnet hat. Dieselbe Falle wie beim ersten
     * Stellen. */
    const voll = el('button', 'app-tat mal-voll-knopf', 'Vollbild')
    voll.type = 'button'
    voll.setAttribute('aria-pressed', 'false')
    voll.addEventListener('click', () => {
      const an = document.body.classList.toggle('app-voll')
      voll.textContent = an ? 'Kleiner' : 'Vollbild'
      voll.setAttribute('aria-pressed', String(an))
      requestAnimationFrame(() => requestAnimationFrame(() => stellen(true)))
    })
    leiste.appendChild(voll)

    const weg = el('button', 'app-tat', 'Neues Blatt')
    weg.type = 'button'
    weg.addEventListener('click', () => {
      ctx.clearRect(0, 0, leinwand.width, leinwand.height)
      // Ein leeres Blatt darf wieder nachgestellt werden — jetzt kostet es
      // nichts. `stellen` steigt selbst aus, wenn die Groesse schon stimmt.
      bemalt = false
      stellen(false)
    })
    leiste.appendChild(weg)
  }

  /* ── DIE ANMELDUNG ──────────────────────────────────────────────────────
   * `erzeugen` wird vom Haus EINMAL gerufen und bekommt dabei den Kontext.
   * Es liefert die Liste zurueck; `kann()` und `auf()` darin werden spaeter
   * und wiederholt gerufen. Deshalb steht hier eine Liste und keine
   * Momentaufnahme: Was gerade moeglich ist, entscheidet `kann()` bei jedem
   * Neuaufbau neu. */
  window.MixPiApps = {
    erzeugen(kontext) {
      el = kontext.el
      werke = kontext.werke
      brauchbar = kontext.brauchbar
      bildAdresse = kontext.bildAdresse
      katSymbol = kontext.katSymbol
      stimme = kontext.stimme
      sprichDann = kontext.sprichDann
      return SCHUBLADE_APPS
    },
  }
})()
