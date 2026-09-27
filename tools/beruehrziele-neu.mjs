#!/usr/bin/env node
/**
 * WIE GROSS SIND DIE BEDIENELEMENTE DER NEUEN OBERFLAECHE WIRKLICH — in Millimetern.
 *
 * ══ WOZU (BACKLOG E8/T2) ═══════════════════════════════════════════════════
 * Der Schirm der Box ist 800x480 auf 5 Zoll: 0,14 mm je Bildpunkt. Die Marke
 * des Projekts sind 9 mm (ISO 9241-411) = 64,3 px. Ob die Oberflaeche sie
 * haelt, wurde bisher an EINZELNEN Stellen gerechnet — der Spielknopf ist
 * 44 px, also 6,2 mm — aber nie fuer die ganze Seite und nie gemessen.
 *
 * DAS IST DIE GRUNDLAGE FUER F6. Der Wunsch lautet: zwei Knoepfe auf gleicher
 * Hoehe (blau = weiterhoeren, weiss = von vorn) statt des einen, der heute nur
 * die Farbe wechselt. Zwei Knoepfe machen es ENGER, nicht weiter. Bevor man
 * entscheidet, ob beide aufs Cover passen oder der zweite woanders hin gehoert,
 * muss der Ist-Stand in Zahlen dastehen. Nicht geschaetzt.
 *
 * ══ WARUM NICHT DIE CSS-GROESSE ════════════════════════════════════════════
 * `width: 44px` im Stilblatt ist eine Absicht, keine Messung. Dazwischen liegen
 * vier Dinge, die alle in dieselbe Richtung luegen koennen:
 *
 *   * `padding` und `border` vergroessern die Trefferflaeche (border-box), ein
 *     `transform: scale()` ebenfalls — `getBoundingClientRect` kennt beides,
 *     die Stilangabe nicht.
 *   * Ein PSEUDOELEMENT (`::before { inset: -10px }`) vergroessert sie, ohne im
 *     Rechteck des Elements zu stehen. `getBoundingClientRect` sieht es NICHT.
 *   * Eine fremde Ebene DARUEBER verkleinert sie auf null, ohne dass irgendeine
 *     Zahl kleiner wird. Genau dieser Fall ist am 04.08.2026 durch alle vier
 *     gruenen Pruefdurchgaenge gerutscht ([[rueckweg-verdeckt-die-ueberschrift]]).
 *   * `overflow: hidden` eines Vorfahren schneidet ab.
 *
 * DESHALB WIRD GETASTET, NICHT GERECHNET. Ausgangspunkt ist
 * `getBoundingClientRect` (Absicht + padding + border + transform), das
 * Ergebnis ist aber das, was `document.elementFromPoint` an dieser Stelle
 * WIRKLICH zurueckgibt — also das, was ein Finger traefe. Ein Treffer zaehlt,
 * wenn der getroffene Knoten das Element selbst ist oder in ihm liegt: ein Tipp
 * auf das Bild in einem Knopf loest den Knopf aus.
 *
 * DIE FLAECHE WIRD NICHT ALS PRODUKT ANGEGEBEN, sondern als ihre beiden Seiten
 * — und gemessen wird gegen die SCHMALERE. 200x20 px sind flaechenmaessig
 * ueppig und mit dem Finger trotzdem nicht zu treffen; die ISO-Marke gilt der
 * kleinsten Ausdehnung.
 *
 * ══ WAS ES NICHT KANN, UND WARUM ES TROTZDEM TAUGT ═════════════════════════
 *   * Es tastet EIN Kreuz durch die Mitte des Ziels ab, kein Raster. Ein Ziel
 *     mit einem Loch in der Mitte oder einer L-Form kaeme zu gut weg. Auf
 *     dieser Seite gibt es keine solchen Formen; sollte es einmal welche geben,
 *     ist das hier die Stelle zum Nachschaerfen.
 *   * Es kennt keine Bedienung mit zwei Fingern und keine Wischgesten.
 *   * ES ERSETZT DAS BILD NICHT. Ein Werkzeug, das nur Knoepfe kennt, sieht die
 *     halbe Seite nicht — eine verdeckte UEBERSCHRIFT ist kein Bedienelement
 *     und faellt hier durch. `--bild` legt deshalb je Schirm ein Bildschirmfoto
 *     daneben. Beide Sorten Fehler sind gleich haeufig.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts. Eigener Browser (headless) gegen tools/neu-vorschau.mjs. Die Box wird
 * nicht angefasst, keine Datei ausser einem angeforderten Bildschirmfoto.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/beruehrziele-neu.mjs
 *     node tools/beruehrziele-neu.mjs --alle           jedes Ziel, nicht nur die zu kleinen
 *     node tools/beruehrziele-neu.mjs --md             Tabelle als Markdown
 *     node tools/beruehrziele-neu.mjs --schirm player  nur diesen Schirm
 *     node tools/beruehrziele-neu.mjs --bild /tmp/ziele   je Schirm ein PNG
 *     node tools/beruehrziele-neu.mjs --pruefen        Ende 1, wenn etwas unter der Marke liegt
 *     node tools/beruehrziele-neu.mjs --name lang   mit einem dreizeiligen Boxnamen
 *     node tools/beruehrziele-neu.mjs --probe '.wappen-bild{display:none}'   einen
 *                                                      Vorschlag nachmessen, ohne app.css anzufassen
 */
/*
 * ── WARUM HIER FUENF IMPORTE VERSCHWUNDEN SIND UND EINER DAZUKAM ──────────
 *
 * Das Suchen und Starten des eigenen Browsers stand einmal in DIESER Datei —
 * daher `spawn`, `existsSync`/`readdirSync`, `homedir` und `join` aus
 * `node:path`. Der Rumpf ist nach tools/leihgabe.mjs umgezogen, die Importe
 * blieben liegen, und `leihgabe.mjs` selbst wurde nie importiert. Ergebnis:
 * `ReferenceError: vorschauLeihen is not defined` in Zeile 1 der Messung, also
 * BEVOR irgendetwas passiert.
 *
 * Dass das monatelang niemandem auffiel, ist kein Zufall: Dieses Werkzeug
 * haengt in KEINEM Laeufer — `tools/pruefen.sh` ruft es nicht auf, weder
 * direkt noch ueber einen anderen Schritt (Stand 31.08.2026 nachgesehen). Ein
 * Werkzeug, das nur von Hand laeuft, faellt erst beim naechsten Handgriff um,
 * und der kann ein halbes Jahr spaeter kommen ([[gruene-probe-deckt-nur-ihre-wachen]]).
 *
 * `join` sieht in dieser Datei noch benutzt aus (`teile.join('')`) — das ist
 * `Array.prototype.join` und hat mit `node:path` nichts zu tun. Genau diese
 * Aehnlichkeit haelt so einen toten Import am Leben.
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
/*
 * ── DAS ZIEL, UND WARUM `--port` HIER NICHT STILL VERSCHLUCKT WERDEN DARF ──
 *
 * Dieses Werkzeug nimmt sein Ziel als STELLUNGSANGABE (`http://...`), waehrend
 * die halbe Werkzeugkiste daneben `--port` kennt: eltern-tor-schau,
 * maskottchen-zaehlen, kind-am-tor, eltern-form-schau, ecke-oben-links-messen.
 * `--port` war hier keine Fahne, sondern ein Wort, das `opt()` niemand fragt —
 * es fiel durch, das Ziel blieb der Vorgabeport, und der ist auf diesem Rechner
 * IMMER von einem fremden Lauf besetzt.
 *
 * WAS DAS KOSTET, am 06.08.2026 vorgefuehrt: Ein Pruefer startete eine eigene
 * Vorschau auf 8713, rief `--port 8713`, und mass eine FREMDE auf 8299. Danach
 * mass er eine losgeloeste HEAD-Arbeitskopie mit `--port 8715` — und bekam
 * Zahlenwert fuer Zahlenwert dasselbe Ergebnis, weil auch dieser Lauf auf 8299
 * landete. Zwei Baeume, eine Messung, und die Gleichheit sah nach einem Befund
 * aus. Das ist die schlimmere Haelfte von [[vorschau-wird-geliehen]]: nicht
 * „ich verstelle einem anderen die Lage", sondern „ich messe seinen Baum und
 * nenne es mein Ergebnis" — und hier ohne jedes Anzeichen.
 *
 * DESHALB ZWEI ZEILEN: `--port` wirkt, und eine Fahne, die dieses Werkzeug
 * nicht kennt, bricht ab, statt zu einer Vorgabe zu fuehren. Eine unbekannte
 * Fahne ist immer eine Absicht, die nicht angekommen ist.
 */
const BEKANNTE_FAHNEN = ['alle', 'md', 'pruefen', 'schirm', 'bild', 'probe', 'name', 'port', 'debug-port']
for (const a of argv) {
  if (!a.startsWith('--')) continue
  if (BEKANNTE_FAHNEN.includes(a.slice(2))) continue
  console.error(
    `${a} kennt dieses Werkzeug nicht.\n` +
      `Bekannt: ${BEKANNTE_FAHNEN.map((f) => `--${f}`).join(' ')}\n` +
      `Das Ziel steht als Adresse da, nicht hinter einer Fahne:\n` +
      `  node tools/beruehrziele-neu.mjs http://127.0.0.1:8713/neu/\n` +
      `Abgebrochen, statt still den Vorgabeport zu messen — dort bedient sonst\n` +
      `ein FREMDER Arbeitsbaum, und das Ergebnis saehe wie das eigene aus.`,
  )
  process.exit(2)
}
const PORT = opt('port', null)
const ZIEL =
  argv.find((a) => a.startsWith('http')) ||
  (typeof PORT === 'string' ? `http://127.0.0.1:${PORT}/neu/` : 'http://127.0.0.1:8299/neu/')
const ALLE = hat('alle')
const MD = hat('md')
const PRUEFEN = hat('pruefen')
const NUR = opt('schirm', null)
const BILD = opt('bild', null)
/*
 * ── `--probe '<css>'` — EINE AENDERUNG NACHMESSEN, BEVOR SIE GESCHRIEBEN WIRD
 *
 * Dasselbe Verfahren wie in `tools/ecke-oben-links-messen.mjs`, und aus
 * demselben Grund: Ob ein Vorschlag die Beruehrziele verbessert oder
 * verschlechtert, laesst sich RECHNEN — am 06.08.2026 stand genau so eine
 * Rechnung im Auftrag („faellt das 44-px-Bild aus dem Wappen, rutschen die
 * Kategorien um 23 px nach unten") und sie war in der Richtung richtig und in
 * der Wirkung falsch. Gerechnet wurde ein Schaden, gemessen wurde keiner.
 *
 * Die Regel wird der Vorschauseite als Stilblatt beigelegt, NACHDEM der Schirm
 * aufgebaut ist — `neuLaden()` wuerfe sie sonst mit der Seite weg, und
 * gemessen wuerde die unveraenderte Lage: ein Vergleich, bei dem beide Seiten
 * gleich sind und niemand es merkt.
 *
 * Es aendert NICHTS an NewDesign/app.css. Die Regel lebt im Browser dieses
 * Laufs und ist mit ihm vorbei.
 */
const PROBE = typeof opt('probe', null) === 'string' ? opt('probe', null) : null
/*
 * `--name mitbox|ohnebox|lang` — MIT WELCHEM BOXNAMEN GEMESSEN WIRD.
 *
 * Der Name ist keine Kosmetik, er ist eine LAENGE. „Kinderzimmer Erdgeschoss
 * Box" macht das Wappen 117 statt 99,7 px hoch; `.kat-liste` behaelt dann 265
 * px fuer 282 px Knoepfe, und weil `.kat` `height` und nicht `min-height`
 * hat, SCHRUMPFEN die vier Kategorien auf 61,8 px — 8,65 statt 9,24 mm, auf
 * drei Schirmen (start, interpret, laut). Ohne diesen Schalter liesse sich
 * genau die Sorte Daten nie messen, die es auf jeder Box geben kann
 * ([[attrappe-luegt-durch-weglassen]]).
 *
 * `mitbox` ist die Vorgabe und zugleich der Vorgabewert der Vorschau.
 */
const NAME = (() => {
  const w = opt('name', 'mitbox')
  return typeof w === 'string' ? w : 'mitbox'
})()

/** 800x480 auf 5" Waveshare, ohne Skalierung — BOX-MENUE-ANALYSE.md. */
const MM_JE_PIXEL = 0.14
/** 9 mm nach ISO 9241-411, die eigene Marke des Projekts. */
const MARKE_MM = 9
const MARKE_PX = MARKE_MM / MM_JE_PIXEL // 64,29 px
/**
 * ABSTAND: 2 mm zwischen zwei Zielen, ebenfalls ISO 9241-411.
 *
 * SIE IST HIER EINE MELDESCHWELLE, KEINE PRUEFUNG — und das ist Absicht.
 * Zwei Ziele, die aneinanderstossen (Abstand 0), sind in einer Liste oder
 * einem Tastenfeld voellig normal, solange jedes fuer sich gross genug ist;
 * die Norm meint den Fall, dass ein Fehlgriff etwas ANDERES ausloest. Wo der
 * Abstand 0 ist, entscheidet die Groesse, und die steht in derselben Tabelle.
 */
const ABSTAND_MM = 2

const mm = (px) => px * MM_JE_PIXEL
const mmS = (px) => mm(px).toFixed(2)

// ── Vorschau leihen, eigenen Browser holen ──────────────────────────────────
//
// Eine laufende Vorschau wird GELIEHEN und ihre Lage am Ende zurueckgelegt;
// laeuft keine, startet vorschauLeihen selbst eine auf dem Port des Ziels. Der
// eigene Browser bekommt einen FREIEN Debug-Port und ein eigenes Profil, statt
// sich auf eine feste Nummer zu verlassen, die ein Ueberlebender eines harten
// Abbruchs noch halten koennte. Beides samt der Messungen dahinter:
// tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let lfd = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

// ── DIE MESSUNG, IM BROWSER ────────────────────────────────────────────────
/*
 * ALS ZEICHENKETTE UND IN EINEM STUECK: Sie laeuft ueber Runtime.evaluate im
 * Browser, nicht hier. Ein Hin und Her je Bildpunkt waere ueber CDP nicht
 * bezahlbar — es sind je Ziel bis zu tausend Tastpunkte.
 */
const MESSEN_JS = String.raw`
(() => {
  /* DIE UHR DER LEISTE NEU ANSTOSSEN, unmittelbar vor dem Messen — dieselbe
     Vorsichtsmassnahme wie in tools/ecke-oben-links-messen.mjs.

     WARUM SIE HIER FEHLTE UND WARUM ES TROTZDEM GUTGING: Die eingefahrene
     Leiste kommt nach 1400 ms Ruhe von selbst zurueck (RUHE_BIS_ZURUECK_MS in
     app.js). Zwischen dem Hinrollen und dem Messen lagen bisher rund 1140 ms —
     260 ms unter der Grenze. Das war kein Vorsatz, sondern Glueck: Wer eine
     Wartezeit um 300 ms verlaengert (--probe tat genau das), kippt den
     Schirm „raster" in die andere Lage, und der Bericht meldet 26 statt 20
     erreichbare Ziele samt vier halb verdeckten Kategorien. Ein Vergleich
     zweier Laeufe misst dann die Wartezeit und nicht die Aenderung.

     Ein Rollereignis stellt die Uhr auf null. Was danach folgt, laeuft in
     EINEM Stueck synchron durch — dazwischen kann kein Zeitgeber feuern.
     (Keine Schraegstrich-Anfuehrer: der Block steht in String.raw.) */
  if (document.body.classList.contains('platz-machen')) {
    const b = document.getElementById('buehne')
    if (b) b.dispatchEvent(new Event('scroll'))
  }

  // WELCHE ELEMENTE ZAEHLEN ALS ZIEL. Nicht „alles, was einen Zeiger zeigt":
  // 'cursor: pointer' steht in diesem Stilblatt auch auf Kacheln, die als
  // GANZES getippt werden — die sind gross und wuerden das Bild schoenfaerben.
  // Genommen wird, was der Reihe nach angesteuert werden kann, und das ist
  // zugleich die Menge, die die Vorlesestimme kennt.
  const WAHL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])'

  const sichtbar = (e) => {
    const s = getComputedStyle(e)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    // ABGESCHALTETE KNOEPFE SIND KEINE ZIELE — und das herauszunehmen war noetig,
    // weil sonst der erste Befund des Werkzeugs ein Fehlalarm war: Der Rueckweg
    // steht auf der Startseite mit 'disabled' und 'pointer-events: none' da
    // (ausgegraut statt weg, damit man ihn nicht jedes Mal neu sucht). Er ist
    // dort voll im Bild und nicht zu treffen — was nach einer verdeckenden
    // Ebene aussieht und in Wahrheit Absicht ist.
    if (e.disabled === true || e.getAttribute('aria-disabled') === 'true') return false
    if (s.pointerEvents === 'none') return false
    const r = e.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    // AUSSERHALB DES SCHIRMS IST KEIN ZIEL. Die Seite haelt ganze Ebenen mit
    // 'hidden' bereit; die faellt oben schon heraus. Was seitlich in einer
    // Reihe steht und weggerollt ist, gehoert aber sehr wohl dazu — es ist
    // erreichbar, nur nicht jetzt. Deshalb wird hier NUR geprueft, ob das
    // Rechteck den Schirm ueberhaupt schneidet.
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    return true
  }

  /** Zaehlt ein Tipp auf (x,y) fuer dieses Ziel? */
  const trifft = (e, x, y) => {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false
    const g = document.elementFromPoint(x, y)
    // 'contains' DECKT DEN NORMALFALL AB: Ein Tipp auf das <img> oder <svg> in
    // einem Knopf loest den Knopf aus, weil das Ereignis aufsteigt. Umgekehrt
    // zaehlt ein Treffer auf einen VORFAHREN nicht — der tut etwas anderes.
    return !!g && (g === e || e.contains(g))
  }

  /**
   * Von der Mitte aus nach aussen tasten.
   *
   * DER STARTPUNKT IST NICHT SELBSTVERSTAENDLICH. Liegt die geometrische Mitte
   * unter einer fremden Ebene, ist das Ziel dort nicht zu treffen — dann wird
   * im Rechteck nach EINEM erreichbaren Punkt gesucht. Findet sich keiner, ist
   * die Trefferflaeche null, und GENAU DAS ist der Befund (nicht ein Fehler
   * der Messung).
   */
  const tasten = (e) => {
    const r = e.getBoundingClientRect()
    // NUR IM SICHTBAREN TEIL SUCHEN, und das war im ersten Lauf der Unterschied
    // zwischen Unsinn und Messung: Eine Raster-Kachel ragt unten aus dem Schirm
    // heraus; ihre geometrische Mitte liegt dann bei y = 700. Dort trifft
    // document.elementFromPoint nichts, weil es den Punkt gar nicht gibt — und
    // alle vier Kacheln der Startseite standen als „verdeckt" im Bericht,
    // waehrend sie in Wahrheit gut sichtbar und gut treffbar waren.
    /*
     * == NICHT NUR DER SCHIRM SCHNEIDET AB, AUCH EIN ROLLKASTEN ============
     *
     * GEFUNDEN AM 06.08.2026, als das WLAN-Fach fuenf Netze zeigte statt einem
     * Bluetooth-Geraet: Die vierte Zeile steht bei y=356..434 und ist ganz im
     * 800x480-Schirm - ihr Rollkasten (.fach-zeilen) hoert aber bei y=386 auf.
     * Getastet wurden 94x30 statt 108x66, und der Bericht nannte 4,20 mm.
     *
     * DAS IST DIESELBE FRAGE WIE "ragt unten aus dem Schirm", nur eine Ebene
     * tiefer: Es ist die ROLLPOSITION und nicht die GESTALTUNG. Der Knopf ist
     * 108x66 gebaut; wer eine Zeile weiterrollt, hat ihn ganz. Ohne diese
     * Zeilen stuende jede rollende Liste dieses Hauses mit einem
     * Gestaltungsfehler im Bericht, sobald sie voll genug ist - und die echten
     * Befunde daneben fielen nicht mehr auf.
     *
     * Der Anteil im Bild faellt damit unter 95 %, und "angeschnitten" fasst es
     * richtig: gemeldet ja, als Fehler gezaehlt nein. Wer die Zeile ganz sehen
     * will, misst mit einer anderen Rollposition.
     *
     * ACHTUNG, DIESE FUNKTION LEBT IN EINER ZEICHENKETTE: kein Gravis in den
     * Kommentaren, er beendet sie. (Genau daran ist der erste Anlauf
     * gescheitert.)
     */
    let kl = 0
    let ko = 0
    let kre = innerWidth - 1
    let ku = innerHeight - 1
    for (let a = e.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a)
      const rollt = /auto|scroll|hidden|clip/.test(s.overflowX + ' ' + s.overflowY)
      if (!rollt) continue
      const ra = a.getBoundingClientRect()
      kl = Math.max(kl, ra.left)
      ko = Math.max(ko, ra.top)
      kre = Math.min(kre, ra.right)
      ku = Math.min(ku, ra.bottom)
    }
    const l = Math.max(kl, r.left)
    const o = Math.max(ko, r.top)
    const re0 = Math.min(kre, r.right)
    const u0 = Math.min(ku, r.bottom)
    // WIEVIEL DES ZIELS IST UEBERHAUPT IM BILD. Diese Zahl trennt zwei Befunde,
    // die sonst gleich aussehen und VERSCHIEDEN VIEL wert sind: Eine Kachel,
    // die unten aus dem Schirm ragt, ist normal — man rollt eben. Ein Ziel,
    // das ganz im Bild steht und trotzdem nicht getroffen wird, liegt unter
    // einer fremden Ebene, und DAS ist ein Fehler
    // ([[rueckweg-verdeckt-die-ueberschrift]]).
    const flaeche = Math.max(1, r.width * r.height)
    const imBild = Math.max(0, (re0 - l)) * Math.max(0, (u0 - o)) / flaeche
    if (re0 <= l || u0 <= o) return { breite: 0, hoehe: 0, x: 0, y: 0, verdeckt: true, imBild: 0 }
    let sx = Math.round((l + re0) / 2)
    let sy = Math.round((o + u0) / 2)
    if (!trifft(e, sx, sy)) {
      let gefunden = false
      // Grob absuchen — 5 x 5 Punkte reichen, um ein teilweise verdecktes Ziel
      // zu finden; ein feineres Netz kostet nur Zeit.
      for (let i = 1; i <= 5 && !gefunden; i++) {
        for (let j = 1; j <= 5 && !gefunden; j++) {
          const x = Math.round(l + ((re0 - l) * i) / 6)
          const y = Math.round(o + ((u0 - o) * j) / 6)
          if (trifft(e, x, y)) {
            sx = x
            sy = y
            gefunden = true
          }
        }
      }
      if (!gefunden) return { breite: 0, hoehe: 0, x: sx, y: sy, verdeckt: true, imBild }
    }
    // NACH AUSSEN UEBER DAS RECHTECK HINAUS: ein Pseudoelement mit negativem
    // 'inset' vergroessert die Trefferflaeche, ohne im Rechteck zu stehen.
    // 40 px Zugabe sind mehr als jede solche Vergroesserung in diesem
    // Stilblatt und billig genug.
    const ZUGABE = 40
    const lauf = (dx, dy, grenze) => {
      let n = 0
      while (n < grenze && trifft(e, sx + dx * (n + 1), sy + dy * (n + 1))) n++
      return n
    }
    const li = lauf(-1, 0, Math.ceil(r.width) + ZUGABE)
    const re = lauf(1, 0, Math.ceil(r.width) + ZUGABE)
    const ob = lauf(0, -1, Math.ceil(r.height) + ZUGABE)
    const un = lauf(0, 1, Math.ceil(r.height) + ZUGABE)

    /**
     * WER LIEGT DARAUF? — die Frage, die nach „zu klein" als naechste kommt.
     *
     * Bleibt ein Lauf INNERHALB des eigenen Rechtecks stehen, ist dort nicht
     * der Rand des Ziels, sondern eine fremde Ebene. Ihr Name ist die
     * eigentliche Auskunft: „7,56 mm" sagt, DASS etwas zu tun ist; „verdeckt
     * durch .mini-player" sagt, WAS — und erspart das Nachstellen von Hand.
     *
     * NACHGERUESTET AM 05.08.2026, weil genau diese Frage offenblieb: Nachdem
     * die Leiste oben Platz fuer das Zeichen „wer hoert" machte, stand die
     * Kategorie „Radio" ploetzlich bei 7,56 mm statt 9,24. Der Bericht sagte
     * die Zahl und schwieg ueber den Grund; das Nachmessen kostete mehr Zeit
     * als dieses Stueck Code.
     */
    const deckel = (dx, dy, n) => {
      const x = sx + dx * (n + 1)
      const y = sy + dy * (n + 1)
      // NUR INNERHALB DES RECHTECKS ist es ein Deckel. Draussen endet das Ziel
      // schlicht — das ist kein Befund, sondern seine Groesse.
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null
      const g = document.elementFromPoint(x, y)
      return g ? benennen(g) : null
    }
    const wodurch = [
      ...new Set(
        [deckel(-1, 0, li), deckel(1, 0, re), deckel(0, -1, ob), deckel(0, 1, un)].filter(Boolean),
      ),
    ]

    return {
      breite: li + re + 1,
      hoehe: ob + un + 1,
      wodurch,
      links: sx - li,
      rechts: sx + re,
      oben: sy - ob,
      unten: sy + un,
      x: sx,
      y: sy,
      verdeckt: false,
      imBild,
    }
  }

  /** Ein Name, den ein Mensch wiedererkennt. */
  const benennen = (e) => {
    const teile = [e.tagName.toLowerCase()]
    if (e.id) teile.push('#' + e.id)
    const kl = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (kl.length) teile.push('.' + kl.join('.'))
    const s = e.getAttribute('aria-label') || (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
    return teile.join('') + (s ? '  „' + s + '"' : '')
  }

  const ziele = [...document.querySelectorAll(WAHL)].filter(sichtbar)
  const gemessen = ziele.map((e) => {
    const t = tasten(e)
    const r = e.getBoundingClientRect()
    return {
      name: benennen(e),
      rechteckB: Math.round(r.width),
      rechteckH: Math.round(r.height),
      breite: t.breite,
      hoehe: t.hoehe,
      klein: Math.min(t.breite, t.hoehe),
      verdeckt: !!t.verdeckt,
      // GANZ IM BILD UND TROTZDEM NICHT ZU TREFFEN heisst: eine Ebene liegt
      // darueber. Halb aus dem Schirm heraus heisst: rollen. Zwei Befunde,
      // eine Zahl.
      imBild: Math.round((t.imBild || 0) * 100),
      // NUR WENN DIE FLAECHE WIRKLICH KLEINER IST als das Rechteck. Sonst
      // stuende an jedem gesunden Ziel der Nachbar, an dem der Lauf endet —
      // und die Auskunft ginge im Rauschen unter.
      wodurch: t.breite < Math.round(r.width) || t.hoehe < Math.round(r.height) ? t.wodurch || [] : [],
      k: t.verdeckt ? null : { l: t.links, r: t.rechts, o: t.oben, u: t.unten },
    }
  })

  // ── ABSTAENDE, aus den GETASTETEN Rechtecken ─────────────────────────────
  // Nicht aus getBoundingClientRect: wo ein Pseudoelement die Flaeche
  // vergroessert, schrumpft der Abstand zum Nachbarn — und genau der Abstand
  // ist die Frage. Ueberlappende Ziele bekommen 0.
  let engste = null
  for (let i = 0; i < gemessen.length; i++) {
    for (let j = i + 1; j < gemessen.length; j++) {
      const a = gemessen[i].k
      const b = gemessen[j].k
      if (!a || !b) continue
      const dx = Math.max(0, Math.max(a.l - b.r, b.l - a.r))
      const dy = Math.max(0, Math.max(a.o - b.u, b.o - a.u))
      // Euklidisch, nicht „die groessere der beiden Achsen": zwei Ziele, die
      // diagonal versetzt liegen, sind weiter auseinander als ihre
      // Achsabstaende einzeln vermuten lassen.
      const d = Math.round(Math.hypot(dx, dy))
      if (!engste || d < engste.px) engste = { px: d, a: gemessen[i].name, b: gemessen[j].name }
    }
  }

  return { ziele: gemessen, engste }
})()
`

// ── Schirme ────────────────────────────────────────────────────────────────
/*
 * WAS EIN „SCHIRM" IST: eine Lage, in der ein Kind den Finger aufsetzt. Nicht
 * eine Datei und nicht ein <div> — der Mini-Player gehoert zu JEDEM Schirm, auf
 * dem er steht, und wird deshalb ueberall mitgemessen. Wo er die kleinsten
 * Ziele stellt, taucht er auch ueberall auf; das ist keine Doppelung, sondern
 * die Auskunft „das trifft dich auf jeder Seite".
 */
const SCHIRME = [
  {
    name: 'start',
    was: 'Startseite: Kategorien, Weiterhoeren-Reihe, Interpreten, Raster, Mini-Player',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
    },
  },
  {
    // GEROLLT, NICHT NUR GELADEN — und das war der erste Fehlschlag dieses
    // Werkzeugs: Beim Laden steht die Buehne oben, das Raster faengt bei
    // y = 470 an, und von den 199 px hohen Kacheln sind 17 % im Bild. Der
    // Schirm „start" und der Schirm „raster" MELDETEN DIESELBEN 22 Ziele,
    // und die Kacheln — die groessten Bedienelemente der ganzen Oberflaeche —
    // kamen in keiner Messung vor.
    name: 'raster',
    was: 'Werk-Kacheln, dorthin gerollt (auf 800x480 stehen sie nicht im ersten Bild)',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      await h.rollenZu('#raster .kachel')
    },
  },
  {
    name: 'lane',
    was: 'aufgeklappte Titelliste eines Werks (Lane) — mit den Titelkacheln',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      // ERST HINROLLEN, DANN TIPPEN. Nicht der Anschaulichkeit halber: Die Lane
      // wird UNTER der getippten Kachel eingesetzt, und wo die Kachel steht,
      // steht auch die Lane. Wird von ganz oben aus getippt, liegt die
      // aufgeklappte Liste weit unterhalb des Schirms — gemessen wuerde dann
      // wieder die Startseite.
      await h.rollenZu('#raster .kachel')
      // NICHT DIE ERSTE KACHEL, SONDERN EINE, DIE UEBERHAUPT AUFKLAPPT — und
      // das war der zweite Fehlschlag dieses Werkzeugs: Ein Tipp auf eine
      // gewoehnliche Album-Kachel STARTET die Wiedergabe, er oeffnet nichts.
      // Nur eine Spotify-Playlist und eine ARD-Sendung klappen auf
      // (`kachelBauen`: `istPlaylist || istArdSendung`). Woran man sie von
      // aussen erkennt: NUR DIESE BEIDEN bekommen einen eigenen Play-Knopf
      // ins Bild — sonst waere die Kachel selbst der einzige Weg zum Ton.
      const wer = await h.ev(`(() => {
        const k = [...document.querySelectorAll('#raster .kachel')].find((x) => x.querySelector('.tipp-spiel'))
        if (!k) return null
        k.click()
        return (k.getAttribute('aria-label') || '').slice(0, 44) })()`)
      if (!wer) throw new Error('keine aufklappbare Kachel im Raster (keine mit eigenem Play-Knopf)')
      // Die Lane holt ihren Inhalt ueber das Netz nach — 1,4 s waren zu knapp.
      let auf = false
      for (let n = 0; n < 16 && !auf; n++) {
        await warte(250)
        auf = !!(await h.ev(`document.querySelectorAll('.lane-kachel').length > 0`))
      }
      if (!auf) throw new Error(`„${wer}" klappte nicht auf (keine .lane-kachel)`)
      console.error(`  lane: geoeffnet ueber „${wer}"`)
      await h.rollenZu('.lane-kachel')
    },
  },
  {
    // DER SCHIRM, AN DEM F6 HAENGT. Hier sitzt der blaue Weiterhoeren-Knopf auf
    // einer 96 px breiten Titelkachel — die schmalste Flaeche der ganzen
    // Oberflaeche, auf der ein Knopf steht. Ob dort ZWEI Knoepfe nebeneinander
    // Platz haben, entscheidet sich an dieser Zahl und nicht am Entwurf.
    name: 'lane-tief',
    was: 'Titelliste eines Albums (dritte Ebene) — die 96-px-Titelkacheln',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      await h.rollenZu('#raster .kachel')
      const wer = await h.ev(`(() => {
        const k = [...document.querySelectorAll('#raster .kachel')].find((x) => x.querySelector('.tipp-spiel'))
        if (!k) return null
        k.click(); return 'ok' })()`)
      if (!wer) throw new Error('keine aufklappbare Kachel im Raster')
      let auf = false
      for (let n = 0; n < 16 && !auf; n++) {
        await warte(250)
        auf = !!(await h.ev(`document.querySelectorAll('.lane-kachel').length > 0`))
      }
      if (!auf) throw new Error('die Album-Lane klappte nicht auf')
      await h.ev(`(() => { const k = document.querySelector('.lane-kachel'); if (k) k.click(); return true })()`)
      let tief = false
      for (let n = 0; n < 20 && !tief; n++) {
        await warte(250)
        tief = !!(await h.ev(`document.querySelectorAll('.lane-kachel.stueck').length > 0`))
      }
      if (!tief) throw new Error('die Titelliste (lane-tief) klappte nicht auf')
      await h.rollenZu('.lane-kachel.stueck')
    },
  },
  {
    name: 'interpret',
    was: 'Interpretenseite mit den Reihen dieses Interpreten',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      const r = await h.ev(`(() => {
        const k = document.querySelector('#leute-reihe .leute-kachel')
        if (!k) return 'keine Interpretenkachel'
        k.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`Interpret: ${r}`)
      await warte(1200)
    },
  },
  {
    name: 'player',
    was: 'grosser Player (aus dem Mini-Player heraus)',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      const r = await h.ev(`(() => {
        const a = document.querySelector('.mp-bild'); if (!a) return 'kein Mini-Player'
        a.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`Player: ${r}`)
      await warte(900)
    },
  },
  {
    name: 'cover-voll',
    was: 'Cover-Vollbild (aus dem grossen Player heraus)',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      const r = await h.ev(`(() => {
        const a = document.querySelector('.mp-bild'); if (!a) return 'kein Mini-Player'
        a.click()
        const c = document.querySelector('#gross .gross-bild'); if (!c) return 'kein Cover im Player'
        c.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`Cover-Vollbild: ${r}`)
      await warte(900)
    },
  },
  {
    name: 'laut',
    was: 'Lautstaerke-Fenster am Mini-Player',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('spielt')
      await h.neuLaden()
      const r = await h.ev(`(() => {
        const k = document.getElementById('mp-laut'); if (!k) return 'kein Lautknopf'
        k.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`Laut: ${r}`)
      await warte(700)
    },
  },
  {
    name: 'eltern-tor',
    was: 'PIN-Tor vor dem Eltern-Bereich',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('sperre-pin')
      await h.neuLaden()
      await h.langHalten()
      const auf = await h.ev(`!document.getElementById('eltern-tor').hidden`)
      if (!auf) throw new Error('das Tor ging nicht auf (steht die Sperre?)')
    },
  },
  {
    name: 'eltern-flaeche',
    was: 'Admin-Menue, Uebersicht der Gruppe „Verbindung"',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('sperre-aus')
      await h.neuLaden()
      await h.langHalten()
      const auf = await h.ev(`!document.getElementById('eltern-flaeche').hidden`)
      if (!auf) throw new Error('die Eltern-Flaeche ging nicht auf')
    },
  },
  /* ══ ZWEI SCHIRME MEHR SEIT DEM 06.08.2026 ══════════════════════════════
   *
   * Der Bereich hat seit dem Umbau ZWEI EBENEN. `eltern-flaeche` oben zeigt
   * die UEBERSICHT einer Gruppe — dort ist die ZEILE das Ziel (66 px hoch,
   * volle Kartenbreite). Auf einer UNTERSEITE liegt das Ziel wieder INNEN
   * (`.zeile-tat`, 66 px), und die Abstaende rechnen sich anders. Nur die
   * Uebersicht zu messen hiesse, die halbe Gliederung nicht zu messen.
   *
   * WARUM AUSGERECHNET „System" UND „strom": „System" ist die Uebersicht mit
   * den MEISTEN Punkten (vier — sie rollt als einzige), und „strom" traegt die
   * beiden gefaehrlichsten Knoepfe der ganzen Box. Wenn irgendwo ein Abstand
   * faellt, dann dort — und dort kostet er am meisten. */
  {
    name: 'eltern-system',
    was: 'Admin-Menue, Uebersicht der Gruppe „System" (vier Punkte, sie rollt)',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('sperre-aus')
      await h.neuLaden()
      await h.langHalten()
      const r = await h.ev(`(() => {
        const k = document.querySelector('#eltern-faecher [data-fach="system"]')
        if (!k) return 'keine Gruppe „System"'
        k.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`System: ${r}`)
      await warte(900)
    },
  },
  {
    name: 'eltern-strom',
    was: 'Admin-Menue, „Neu laden und neu starten" — die zwei gefaehrlichsten Knoepfe',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('sperre-aus')
      await h.neuLaden()
      await h.langHalten()
      const r = await h.ev(`(() => {
        const k = document.querySelector('#eltern-faecher [data-fach="system"]')
        if (!k) return 'keine Gruppe „System"'
        k.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`System: ${r}`)
      await warte(800)
      const z = await h.ev(`(() => {
        for (const e of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
          const n = e.querySelector('.zeile-name')
          if (n && n.textContent.trim().startsWith('Neu laden')) { e.click(); return 'ok' }
        }
        return 'die Zeile „Neu laden und neu starten" steht nicht da' })()`)
      if (z !== 'ok') throw new Error(`strom: ${z}`)
      await warte(800)
    },
  },
  {
    // ZWEI SCHIRME UND NICHT EINER, weil es an der Box zwei verschiedene
    // Fenster sind: Mit EINEM Profil (dem heutigen Stand) fehlt die
    // Profilreihe ganz, und die Bilder haben mehr Platz. Nur den vollen Fall
    // zu messen hiesse, die Oberflaeche zu vermessen, die es an der Box
    // (noch) gar nicht gibt.
    name: 'ich-allein',
    was: 'Auswahl „wer hoert" mit EINEM Profil — der heutige Stand der Box',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('profil-allein')
      await h.stand('figuren-da')
      await h.neuLaden()
      const r = await h.ev(`(() => {
        const k = document.getElementById('ich'); if (!k) return 'kein Zeichen'
        k.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`Zeichen: ${r}`)
      await warte(700)
      const auf = await h.ev(`!document.getElementById('ich-fenster').hidden`)
      if (!auf) throw new Error('die Auswahl ging nicht auf')
    },
  },
  {
    name: 'ich-mehrere',
    was: 'Auswahl „wer hoert" mit drei Profilen und zehn Figuren',
    hin: async (h) => {
      await h.stand('voll')
      await h.stand('profil-liam')
      await h.stand('figuren-da')
      await h.neuLaden()
      const r = await h.ev(`(() => {
        const k = document.getElementById('ich'); if (!k) return 'kein Zeichen'
        k.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`Zeichen: ${r}`)
      await warte(700)
      const auf = await h.ev(`!document.getElementById('ich-fenster').hidden`)
      if (!auf) throw new Error('die Auswahl ging nicht auf')
    },
  },
]

// ── Lauf ───────────────────────────────────────────────────────────────────
const berichte = []
let abbruch = 0
try {
  // AUF DEN BROWSER WARTEN, NICHT AUF DIE UHR — das steht jetzt in
  // `eigenerBrowser`. Die Schleife, die frueher hier stand, fragte
  // `/json/list` an einem `port`, den es nach dem Umzug nach leihgabe.mjs in
  // dieser Datei nicht mehr gab; sie war der ZWEITE ReferenceError hinter dem
  // fehlenden Import und lag genau eine Zeile hinter der Stelle, an der der
  // erste abbrach. `brw.seite()` kehrt erst zurueck, wenn wirklich eine Seite
  // antwortet, und prueft nebenbei nach, dass der Port unserem Browser gehoert
  // und nicht dem Ueberlebenden eines harten Abbruchs.
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 GENAU — und nicht „ungefaehr". `--window-size` liess dem
  // Sichtfenster im headless-Chromium nur 337 px Hoehe; eine Messung von
  // Beruehrzielen auf einem Schirm, den es nicht gibt, ist wertlos.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => null)
    await warte(150)
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }
  /** Der Einstieg in den Eltern-Bereich ist ein LANGES HALTEN, kein Klick. */
  const langHalten = async (ms = 900) => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 900 })
  }
  /**
   * Zu einem Element rollen und WARTEN, bis es steht.
   *
   * `scrollIntoView` ist in diesem Stilblatt WEICH (`scroll-behavior: smooth`);
   * misst man sofort danach, misst man die Bewegung. Deshalb wird der
   * Ruhezustand abgewartet: erst wenn sich `scrollTop` zwei Runden lang nicht
   * mehr aendert, ist das Bild das, was ein Kind sieht.
   */
  const rollenZu = async (wahl) => {
    const da = await ev(`(() => {
      const e = document.querySelector('${wahl}')
      if (!e) return false
      e.scrollIntoView({ block: 'center', behavior: 'auto' })
      const b = document.getElementById('buehne')
      if (b) b.dispatchEvent(new Event('scroll'))
      return true })()`)
    if (!da) return false
    let vorher = null
    for (let i = 0; i < 12; i++) {
      await warte(220)
      const jetzt = await ev(`(document.getElementById('buehne') || {}).scrollTop`)
      if (jetzt === vorher) break
      vorher = jetzt
    }
    // Die Leiste faehrt beim Rollen ein (`platz-machen`) — das aendert die
    // Lage der Kopfknoepfe. Ihr Uebergang dauert; wer sofort misst, erwischt
    // sie auf halbem Weg.
    await warte(700)
    return true
  }
  const h = { ev, stand, neuLaden, langHalten, rollenZu }

  /*
   * DEN BOXNAMEN AUSDRUECKLICH SETZEN, BEVOR IRGENDETWAS GEMESSEN WIRD.
   *
   * Kein Schirm hier tut das, und der Name ist ZUSTAND DER VORSCHAU: er
   * ueberlebt jedes `neuLaden()` und jeden Neustart dieses Werkzeugs. Wer
   * vorher an derselben Vorschau `/vorschau/name-lang` gestellt hat, misst
   * hier weiter mit „Kinderzimmer Erdgeschoss Box" — und das ist nicht
   * folgenlos, sondern genau die Stelle, an der die Zahlen kippen:
   *
   *   * Das Wappen wird mit drei Namenszeilen 117 statt 99,7 px hoch.
   *   * `.kat-liste` hat dann 265 px fuer 282 px Knoepfe. Die Knoepfe ROLLEN
   *     NICHT (das behauptet der Kommentar bei `.wappen-name`) — sie
   *     SCHRUMPFEN, denn `.kat` hat `height`, kein `min-height`, und
   *     `flex-shrink` steht auf 1.
   *   * Aus 66 px werden 61,8: alle vier Kategorien fallen von 9,24 auf
   *     8,68–8,82 mm, auf DREI Schirmen (start, interpret, laut).
   *
   * GEMESSEN AM 06.08.2026: derselbe Lauf meldete mit „lang" 33 zu kleine
   * Ziele und mit „mitbox" 21. Zwoelf Ziele Unterschied, keine Zeile Code
   * dazwischen — nur ein Zustand, den ein anderes Werkzeug hinterlassen
   * hatte. Ohne diese Zeile ist die Gesamtzahl dieses Werkzeugs keine
   * Messung, sondern eine Frage danach, wer zuletzt an der Vorschau war
   * ([[vorschau-wird-geliehen]]).
   *
   * `mitbox` ist der Vorgabewert der Vorschau selbst (BOXNAMEN in
   * tools/neu-vorschau.mjs) — hier wird also nichts Neues festgelegt,
   * sondern nur nicht mehr geraten. Wer den langen Namen messen will, nimmt
   * tools/leiste-geometrie-messen.mjs --name lang.
   */
  await stand(`name-${NAME}`)

  for (const s of SCHIRME) {
    if (NUR && s.name !== NUR) continue
    try {
      await s.hin(h)
    } catch (e) {
      console.error(`  ${s.name}: NICHT ERREICHT — ${e.message}`)
      abbruch++
      continue
    }
    if (PROBE) {
      const da = await ev(`(() => {
        document.getElementById('ziele-probe')?.remove()
        const s = document.createElement('style')
        s.id = 'ziele-probe'
        s.textContent = ${JSON.stringify(PROBE)}
        document.head.appendChild(s)
        /* UND DIE UHR DER LEISTE GLEICH MIT ANSTOSSEN — dieselben drei Zeilen
           wie in tools/ecke-oben-links-messen.mjs, und aus demselben Grund.
           Die eingefahrene Leiste kommt nach 1400 ms Ruhe von selbst zurueck
           (RUHE_BIS_ZURUECK_MS in app.js). Das Einsetzen der Regel und das
           Warten darauf kosten Zeit; auf dem Schirm „raster" fuhr die Leiste
           dadurch WIEDER AUS, und der Lauf meldete 26 statt 20 erreichbare
           Ziele samt vier halb verdeckten Kategorien — ein Unterschied, der
           wie eine Wirkung der Probe-Regel aussah und keine war. GEMESSEN am
           06.08.2026: derselbe Wert erschien auch bei einer Probe, die die
           Leiste ueberhaupt nicht beruehrt. Ein Rollereignis stellt die Uhr
           auf null. (Keine Schraegstrich-Anfuehrer: Vorlagenzeichenkette.) */
        if (document.body.classList.contains('platz-machen')) {
          const b = document.getElementById('buehne')
          if (b) b.dispatchEvent(new Event('scroll'))
        }
        return document.getElementById('ziele-probe') !== null })()`)
      if (!da) throw new Error('die Probe-Regel liess sich nicht einsetzen')
      // Umbruch und Uebergaenge abwarten — sonst misst man eine Bewegung.
      await warte(250)
    }
    const m = await ev(MESSEN_JS)
    if (!m) {
      console.error(`  ${s.name}: die Messung gab nichts zurueck`)
      abbruch++
      continue
    }
    berichte.push({ ...s, ...m })
    if (BILD) {
      const d = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      const pfad = `${BILD}-${s.name}.png`
      await writeFile(pfad, Buffer.from(d.data, 'base64'))
      console.error(`  Bild: ${pfad}`)
    }
  }
} catch (e) {
  // NICHT MIT EINEM STAPELAUSZUG ENDEN. Ein abgebrochener Lauf sieht sonst aus
  // wie ein Fehler im Werkzeug; meistens ist es ein Browser, der nicht kam.
  console.error(`ABBRUCH: ${e.message}`)
  abbruch++
} finally {
  // IM finally, nicht danach: bei einem Abbruch mitten in einer verstellten
  // Lage bliebe die Vorschau sonst verbogen stehen — die schlimmere Haelfte
  // von [[vorschau-wird-geliehen]].
  await brw.schliessen()
  await leihe.zurueckgeben()
}

// ── Ausgabe ────────────────────────────────────────────────────────────────
console.log(`BERUEHRZIELE DER NEUEN OBERFLAECHE — 800x480, ${MM_JE_PIXEL} mm/px`)
/*
 * WELCHE ADRESSE GEMESSEN WURDE, IM BERICHT UND NICHT NUR IM AUFRUF.
 *
 * Der Kopf dieser Datei erzaehlt ausfuehrlich, wie am 06.08.2026 zwei Baeume
 * gemessen wurden und beide Male 8299 herauskam — und der Bericht, der daraus
 * entstand, nannte die Adresse mit keinem Wort. Ein Ergebnis, das nicht sagt,
 * WORAN es entstanden ist, laesst sich hinterher nicht mehr zuordnen: gerade
 * `vorschauLeihen` nimmt ja stillschweigend eine schon laufende Vorschau, und
 * deren Baum steht nirgends. Eine Zeile, und die Verwechslung ist sichtbar.
 */
console.log(`Gemessen an: ${ZIEL}`)
if (PROBE) console.log(`MIT PROBE-REGEL — das ist NICHT der Stand von app.css: ${PROBE}`)
if (NAME !== 'mitbox') console.log(`BOXNAME: ${NAME} — nicht der Regelfall`)
console.log(`Marke: ${MARKE_MM} mm = ${MARKE_PX.toFixed(1)} px (ISO 9241-411). Gemessen wird die`)
console.log('SCHMALERE Seite der getasteten Trefferflaeche, nicht die CSS-Angabe.\n')

let unterMarke = 0
let gesamt = 0
if (MD) console.log('| Schirm | Element | Rechteck px | getastet px | schmalste mm | unter 9 mm |\n|---|---|---|---|---|---|')

for (const b of berichte) {
  /*
   * NICHT ERREICHBAR IST NICHT DASSELBE WIE ZU KLEIN — und es getrennt zu
   * fuehren, ist der Unterschied zwischen einem lesbaren Bericht und Rauschen.
   * Steht der grosse Player offen, liegt die ganze Startseite darunter; ihre
   * 26 Knoepfe sind dann VOELLIG ZU RECHT nicht zu treffen. Zaehlte man sie als
   * „unter der Marke", waere jeder Ueberlagerungsschirm der schlechteste, und
   * die echten zu kleinen Ziele gingen darin unter.
   *
   * SIE VERSCHWINDEN TROTZDEM NICHT. Ein Ziel, das auf SEINEM EIGENEN Schirm
   * unerreichbar ist, ist der teuerste Fehler dieser Sorte
   * ([[rueckweg-verdeckt-die-ueberschrift]]) — deshalb steht die Zahl in jeder
   * Kopfzeile, und `--alle` nennt jeden Namen.
   */
  const erreichbar = b.ziele.filter((z) => !z.verdeckt)
  // GANZ IM BILD UND TROTZDEM NICHT ZU TREFFEN ist der Befund, der zaehlt;
  // „ragt aus dem Schirm" ist Rollen und kein Fehler. Die Grenze bei 80 %
  // laesst den Randfall „ein paar Pixel abgeschnitten" auf der Fehlerseite.
  const zu = b.ziele.filter((z) => z.verdeckt)
  const verdecktImBild = zu.filter((z) => z.imBild >= 80)
  const sortiert = [...erreichbar].sort((x, y) => x.klein - y.klein)
  const zuKlein = sortiert.filter((z) => z.klein < MARKE_PX)
  /*
   * ANGESCHNITTEN IST NICHT ZU KLEIN. Eine 221 px hohe Kachel, von der wegen
   * der Rollposition 33 px im Bild stehen, misst getastet 4,62 mm — das ist
   * richtig gemessen und beantwortet trotzdem NICHT die Frage, die hier
   * gestellt wird („ist dieses Bedienelement gross genug gestaltet?").
   * Ungekennzeichnet wanderte sie als Gestaltungsfehler in den Bericht und
   * verdraengte die echten.
   */
  const angeschnitten = zuKlein.filter((z) => z.imBild < 95)
  gesamt += erreichbar.length
  unterMarke += zuKlein.length - angeschnitten.length
  const zeigen = ALLE ? [...sortiert, ...zu] : zuKlein.length ? zuKlein : sortiert.slice(0, 1)

  if (!MD) {
    console.log(`── ${b.name} ${'─'.repeat(Math.max(0, 52 - b.name.length))}`)
    console.log(`   ${b.was}`)
    console.log(
      `   ${erreichbar.length} erreichbare Ziele, davon ${zuKlein.length - angeschnitten.length} unter ${MARKE_MM} mm` +
        (angeschnitten.length ? ` (+${angeschnitten.length} nur angeschnitten — Rollposition, nicht Gestaltung)` : '') +
        (zu.length
          ? `; ${zu.length} nicht treffbar (${verdecktImBild.length} davon VOLL IM BILD — Ebene darueber, ${zu.length - verdecktImBild.length} durch Rollen erreichbar)`
          : ''),
    )
  }
  for (const z of zeigen) {
    const unter = z.klein < MARKE_PX
    if (MD) {
      if (z.verdeckt) continue
      console.log(
        `| ${b.name} | \`${z.name}\` | ${z.rechteckB}x${z.rechteckH} | ${z.breite}x${z.hoehe} | ${mmS(z.klein)} | ${unter ? '**ja**' : 'nein'} |`,
      )
    } else {
      const zeichen = z.verdeckt ? (z.imBild >= 80 ? 'VERD' : 'roll') : unter ? (z.imBild < 95 ? 'schn' : '  ✗') : '  ✓'
      const rechteck = `${z.rechteckB}x${z.rechteckH}`
      const getastet = z.verdeckt ? `${z.imBild}% i.B.` : `${z.breite}x${z.hoehe}`
      console.log(
        `  ${zeichen} ${(z.verdeckt ? '—' : mmS(z.klein)).padStart(6)} mm  Rechteck ${rechteck.padEnd(9)} getastet ${getastet.padEnd(9)} ${z.name}`,
      )
      // UND WER DARAUFLIEGT, gleich darunter — eingerueckt, damit die Spalten
      // der Messung nicht auseinanderlaufen.
      if (z.wodurch && z.wodurch.length) {
        console.log(`${' '.repeat(20)}verdeckt durch: ${z.wodurch.join(' / ')}`)
      }
    }
  }
  if (!MD) {
    if (b.engste) {
      const eng = b.engste.px * MM_JE_PIXEL
      console.log(
        `   engster Abstand: ${eng.toFixed(2)} mm (${b.engste.px} px)${eng < ABSTAND_MM ? '  — unter 2 mm' : ''}`,
      )
      console.log(`      zwischen ${b.engste.a}`)
      console.log(`      und      ${b.engste.b}`)
    }
    console.log('')
  }
}

if (!MD) {
  // DIE UNVOLLSTAENDIGKEIT GEHOERT IN DIE ZAHL, NICHT IN EINE ZEILE DARUNTER.
  // „ZUSAMMEN: 6 von 6" sieht aus wie ein Ergebnis, auch wenn acht von zehn
  // Schirmen gar nicht gemessen wurden; die Warnung eine Zeile spaeter liest,
  // wer schon weiss, dass er sie suchen muss.
  console.log(
    `ZUSAMMEN${abbruch ? ' (UNVOLLSTAENDIG)' : ''}: ${unterMarke} von ${gesamt} erreichbaren Zielen sind VOLL IM BILD und liegen unter ${MARKE_MM} mm.`,
  )
  console.log('(„schn" = nur angeschnitten im Bild; das ist die Rollposition, nicht die Gestaltung)')
  if (abbruch) console.log(`${abbruch} Schirm(e) konnten NICHT gemessen werden — siehe oben.`)
  if (!ALLE) console.log('(gezeigt werden nur die zu kleinen; `--alle` zeigt jedes Ziel, auch die verdeckten)')
}

// EIN NICHT ERREICHTER SCHIRM IST EIN FEHLSCHLAG, kein „nichts gefunden".
// Sonst meldete eine Messung, die die halbe Oberflaeche nie gesehen hat, gruen.
process.exitCode = PRUEFEN ? (unterMarke || abbruch ? 1 : 0) : abbruch ? 2 : 0
