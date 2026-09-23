#!/usr/bin/env node
/**
 * DIE BELOHNUNGS-VIDEOS AUF DEM KINDERSCHIRM — gemessen, nicht angesehen.
 *
 * ══ WAS HIER GEMESSEN WIRD, UND WARUM GERADE DAS ═════════════════════════
 *
 * Drei Zusagen macht `NewDesign/video.js`, und alle drei sind von aussen
 * nicht zu sehen, wenn sie gebrochen sind:
 *
 *   1. AUFGEBRAUCHTES VERSCHWINDET. Die Reihe zeigt nur, was noch Rest hat —
 *      und sie zeigt GAR NICHTS, wenn nichts freigegeben ist. Ein leerer
 *      Kasten mit Ueberschrift kostet auf 480 px eine von vier Zeilen.
 *   2. EIN ANSCHAUEN VERBRAUCHT GENAU EINS. Nicht null (dann waere die
 *      Belohnung wertlos) und nicht zwei (dann waere sie nach einmal
 *      Schauen weg). Gemessen wird der Rest VOR und NACH dem Durchlauf.
 *   3. EINE ABSAGE KOMMT MIT GRUND AN. Wird ein Video zwischen Anzeige und
 *      Tipp aufgebraucht (zweiter Schirm, Elternteil am Laptop), steht auf
 *      dem Schirm ein SATZ und nicht ein schwarzes Bild.
 *   4a. EIN STUECK IST EIN STUECK (seit dem 20.09.2026, Betreiber: „marker im
 *      video setzen zu koennen um definerte stuecke zumachen"). Drei Zusagen
 *      in einer, und alle drei sind unsichtbar, wenn sie brechen:
 *        * ES WIRD GESPRUNGEN. Ein `currentTime` vor `loadedmetadata`
 *          verpufft, und das Stueck liefe von vorn.
 *        * ES WIRD ANGEHALTEN. Ohne das laeuft Teil 1 in Teil 2 hinein, und
 *          das Kind sieht, was es nicht freigegeben bekommen hat.
 *        * ES WIRD GEGEN DAS STUECK GERECHNET. Gegen die Dauer der DATEI
 *          erreichte ein Stueck die Schwelle nie — es liefe unbegrenzt oft,
 *          und niemandem faellt es auf.
 *   4. DIE LAUTSTAERKE GEHT DURCH DAS HAUS (seit dem 20.09.2026, Betreiber:
 *      „das video braucht noch einen player menü mit volume"). Der Regler
 *      der Leiste schickt `setvolume:N` durch denselben Flaschenhals wie
 *      jeder andere Regler — und ruehrt `spieler.volume` NICHT an. Eine
 *      zweite, unsichtbare Skala neben der des Hauses waere genau der
 *      Fehler, den man erst bemerkt, wenn die Tasten der Box ins Leere
 *      greifen.
 *
 * ══ WARUM GEGEN DIE VORSCHAU UND NICHT GEGEN DIE BOX ═════════════════════
 *
 * `tools/neu-vorschau.mjs` beantwortet die drei /api/video-Wege in derselben
 * Form wie der echte Server und haelt dieselbe Entscheidungslage (Schwelle
 * 90 %, je Lauf hoechstens einmal). Das Video, das sie ausliefert, ist zwei
 * Sekunden lang — ein Durchlauf dauert damit zwei Sekunden statt 27 Minuten.
 * Was die Box dazu sagt, sagt nur die Box; DIESE drei Zusagen haengen an der
 * Oberflaeche und sind hier vollstaendig pruefbar.
 *
 * AUFRUF
 *     node tools/video-belohnung-schau.mjs
 *     node tools/video-belohnung-schau.mjs --pruefen      # Ausstieg 1 bei Abweichung
 *     node tools/video-belohnung-schau.mjs http://127.0.0.1:8327/neu/
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const BASIS = ZIEL.replace(/\/neu\/?$/, '')

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
let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(34)} ${wert}`)

/** Die Lage der Attrappe stellen — dieselben Schalter wie von Hand. */
async function lage(was) {
  await fetch(`${BASIS}/vorschau/videos-${was}`).then((r) => r.text())
}

/** Was der Server ueber die Freigaben sagt (nicht, was der Schirm zeigt). */
async function stand() {
  const a = await fetch(`${BASIS}/api/video/kind`).then((r) => r.json())
  return a.videos ?? []
}

try {
  await warte(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  /**
   * `userGesture: true` IST HIER PFLICHT UND KEIN SCHMUCK.
   *
   * Ohne das Merkmal gilt jeder Aufruf aus dem Fernsteuerungsweg als
   * „ohne Zutun des Benutzers", und Chrome verweigert `video.play()` nach
   * seiner Autoplay-Regel. Gemessen (20.09.2026): duration 0, currentTime 0,
   * auf dem Schirm „Das Video startet nicht." — die Wache meldete einen
   * Fehler der OBERFLAECHE, und der Fehler lag in der MESSUNG. Genau die
   * Sorte Befund, die man dreimal im Code sucht.
   *
   * Der Schalter --autoplay-policy waere der andere Weg und der schlechtere:
   * er misst dann eine Regel, die auf der Box nicht gilt. Am Geraet IST der
   * Tipp des Kindes eine echte Geste.
   */
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true }))
      ?.result?.value
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2800)
  }

  // ── 0. GIBT ES DIE REIHE UEBERHAUPT? ──────────────────────────────────
  //
  // ABBRUCH UND NICHT ROT: Fehlt die Reihe im Baum, ist das eine andere
  // Nachricht als „sie zeigt das Falsche" — und sie gehoert nicht in
  // dieselbe Zeile.
  await lage('voll')
  await laden()
  const da = await ev(`!!(document.getElementById('video') && document.getElementById('video-schirm'))`)
  if (!da) {
    console.error(
      '\nABBRUCH: `#video` oder `#video-schirm` gibt es nicht.\n' +
        '  Dieses Werkzeug misst die Belohnungs-Videos des Kinderschirms.\n' +
        '  Sind die Kennungen umbenannt, gehoeren sie hier nachgezogen — NICHT die Wache entfernt.\n',
    )
    process.exit(2)
  }

  // ── 1. DIE REIHE ZEIGT, WAS NOCH REST HAT ─────────────────────────────
  const kacheln = await ev(`document.querySelectorAll('#video-reihe .video-kachel').length`)
  const offen = (await stand()).length
  zeile('Kacheln / offene Freigaben', `${kacheln} / ${offen}`)
  if (kacheln !== offen) melde(`die Reihe zeigt ${kacheln} Kacheln, offen sind ${offen}`)
  if (await ev(`document.getElementById('video').hidden`)) melde('die Reihe ist versteckt, obwohl Freigaben offen sind')

  // DIE ZAHL AUF DER KACHEL IST DIE AUSKUNFT, wegen der ein Kind hinsieht.
  const beschriftung = await ev(`document.querySelector('#video-reihe .video-rest')?.textContent || ''`)
  const restVorher = (await stand())[0]?.rest ?? 0
  zeile('erste Kachel sagt', `"${beschriftung}" (Server: ${restVorher})`)
  if (beschriftung !== `${restVorher}×`) melde(`die Kachel sagt "${beschriftung}", der Server ${restVorher}`)

  // ── 2. EIN DURCHLAUF VERBRAUCHT GENAU EINS ────────────────────────────
  await ev(`document.querySelector('#video-reihe .video-kachel').click()`)
  await warte(900)
  const schirmOffen = await ev(`!document.getElementById('video-schirm').hidden`)
  zeile('Schirm offen', String(schirmOffen))
  if (!schirmOffen) melde('der Video-Schirm ging nicht auf')
  const quelle = await ev(`document.getElementById('video-spieler').currentSrc || ''`)
  zeile('Quelle', quelle || '(keine)')
  if (!quelle) melde('es wurde keine Adresse gesetzt')

  // Das Probevideo ist zwei Sekunden lang; vier Sekunden sind reichlich.
  await warte(4000)
  const zuEnde = await ev(
    `(() => { const v = document.getElementById('video-spieler'); return { t: Math.round(v.currentTime * 10) / 10, d: Math.round((v.duration || 0) * 10) / 10 } })()`,
  )
  zeile('gelaufen / Dauer', `${zuEnde.t} s / ${zuEnde.d} s`)
  const restNachher = (await stand())[0]?.rest ?? -1
  zeile('Rest vorher / nachher', `${restVorher} / ${restNachher}`)
  if (restNachher !== restVorher - 1) {
    melde(`ein Durchlauf hat ${restVorher - restNachher} verbraucht — genau eins waere richtig`)
  }

  // ── 3. DIESELBE SICHTUNG ZAEHLT NICHT ZWEIMAL ─────────────────────────
  //
  // Der Browser meldet mehrfach (Neuladen, `ended` neben dem
  // Fortschrittsmelder). Hier wird die Meldung ABSICHTLICH wiederholt — mit
  // derselben Laufkennung, die der Schirm gerade benutzt hat.
  const nochmal = await ev(`(async () => {
    const v = document.getElementById('video-spieler')
    v.currentTime = 0
    await v.play().catch(() => {})
    await new Promise((r) => setTimeout(r, 2600))
    return document.getElementById('video-wort').textContent
  })()`)
  const restDanach = (await stand())[0]?.rest ?? -1
  zeile('Rest nach zweitem Ende', String(restDanach))
  if (restDanach !== restNachher) melde('dieselbe Laufkennung hat ein zweites Mal verbraucht')
  if (nochmal) zeile('Wort auf dem Schirm', nochmal)

  await ev(`document.getElementById('video-weg').click()`)
  await warte(600)
  if (await ev(`!document.getElementById('video-schirm').hidden`)) melde('der Schirm ging nicht wieder zu')

  // ── 3b. DIE SPIELLEISTE ───────────────────────────────────────────────
  //
  // Sie wird an einem NEUEN Lauf gemessen: der von oben ist zu Ende, und
  // eine Leiste ueber einem beendeten Video sagt nichts ueber den Alltag.
  await laden()
  await ev(`document.querySelector('#video-reihe .video-kachel').click()`)
  await warte(1000)
  const leisteAuf = await ev(`document.getElementById('video-leiste').classList.contains('offen')`)
  zeile('Leiste beim Aufziehen', String(leisteAuf))
  if (!leisteAuf) melde('die Leiste steht beim Aufziehen nicht da')

  // DER REGLER STEHT AUF DEM STAND DES HAUSES, nicht auf 0 — sonst liest
  // ein Kind daraus „der Ton ist aus".
  const reglerStand = await ev(`Number(document.getElementById('video-laut').value)`)
  const hausStand = await ev(`Number(document.querySelector('#mp-laut-regler')?.value ?? -1)`)
  zeile('Regler / Haus', `${reglerStand} / ${hausStand}`)
  if (reglerStand <= 0) melde(`der Regler steht auf ${reglerStand} — die Leiste behauptet, es sei still`)

  // ANHALTEN UND WEITER ueber den Knopf, samt wechselndem Zeichen.
  await ev(`document.getElementById('video-spiel').click()`)
  await warte(300)
  const nachHalt = await ev(
    `(() => { const v = document.getElementById('video-spieler'); return { pause: v.paused, zeichen: document.getElementById('video-spiel-zeichen').getAttribute('d').slice(0, 6) } })()`,
  )
  zeile('nach dem Knopf', `paused=${nachHalt.pause} zeichen=${nachHalt.zeichen}`)
  if (!nachHalt.pause) melde('der Knopf hat nicht angehalten')
  if (!nachHalt.zeichen.startsWith('M8 5v')) melde('das Zeichen zeigt nach dem Anhalten kein Dreieck')

  // DIE LAUTSTAERKE — der eine Weg, und der andere, den es NICHT geben darf.
  await fetch(`${BASIS}/vorschau/befehle-leeren`).catch(() => {})
  const vorher = await ev(`document.getElementById('video-spieler').volume`)
  await ev(`(() => {
    const r = document.getElementById('video-laut')
    r.value = '42'
    r.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  // `laut.setzen()` entprellt — es schickt erst nach kurzer Ruhe.
  await warte(1500)
  const befehle = await (await fetch(`${BASIS}/vorschau/befehle`)).json()
  const gesetzt = (befehle.befehle ?? []).filter((b) => String(b.befehl || '').startsWith('setvolume'))
  zeile('geschickt', gesetzt.map((b) => b.befehl).join(', ') || '(nichts)')
  if (!gesetzt.some((b) => b.befehl === 'setvolume:42')) {
    melde('der Regler hat kein `setvolume:42` durch den Flaschenhals geschickt')
  }
  const nachher = await ev(`document.getElementById('video-spieler').volume`)
  zeile('spieler.volume vorher/nachher', `${vorher} / ${nachher}`)
  if (nachher !== vorher) melde('der Regler hat `spieler.volume` verstellt — das waere die zweite Skala')

  // UND DER REGLER DES HAUSES STEHT MIT: `reglerAngleichen()` findet ihn
  // ueber `data-laut-regler`. Ohne das Merkmal liefen die vier Regler
  // auseinander, sobald jemand woanders dreht.
  const traegtMerkmal = await ev(`document.getElementById('video-laut').hasAttribute('data-laut-regler')`)
  zeile('traegt data-laut-regler', String(traegtMerkmal))
  if (!traegtMerkmal) melde('der Regler traegt `data-laut-regler` nicht — er laeuft von den anderen weg')

  // Aufraeumen: den Schirm zu, ohne zu zaehlen (es lief nur ein Augenblick).
  await ev(`document.getElementById('video-weg').click()`)
  await warte(600)

  // ── 3c. EIN STUECK IST EIN STUECK ─────────────────────────────────────
  //
  // Die Attrappe gibt hier EINE Sekunde des zwei Sekunden langen
  // Probevideos frei (`abSek: 0`, `bisSek: 1`). Was danach dasteht, ist
  // nicht „ein kurzes Video", sondern der ganze Unterschied.
  await lage('stueck')
  await laden()
  const stueckKachel = await ev(`document.querySelector('#video-reihe .video-name')?.textContent || ''`)
  zeile('Kachel nennt den Teil', stueckKachel || '(nichts)')
  if (!stueckKachel.includes('Teil 1')) melde(`die Kachel sagt "${stueckKachel}" — der Teilname fehlt`)

  const restVorStueck = (await stand())[0]?.rest ?? 0
  await ev(`document.querySelector('#video-reihe .video-kachel').click()`)
  // Zwei Sekunden reichen: das Stueck ist eine Sekunde lang, und der Schirm
  // soll DANACH stehen bleiben statt weiterzulaufen.
  await warte(2600)
  const stueckStand = await ev(
    `(() => { const v = document.getElementById('video-spieler'); return { t: Math.round(v.currentTime * 100) / 100, d: Math.round((v.duration || 0) * 100) / 100, pause: v.paused } })()`,
  )
  zeile('Stueck: Stand / Datei', `${stueckStand.t} s von ${stueckStand.d} s, paused=${stueckStand.pause}`)
  // ANGEHALTEN BEI 1 s — mit Luft nach oben, weil `timeupdate` nur viermal
  // in der Sekunde kommt und der Spieler bis dahin weiterlaeuft.
  if (!stueckStand.pause) melde('das Stueck lief ueber sein Ende hinaus weiter')
  if (stueckStand.t > 1.4) melde(`das Stueck stand bei ${stueckStand.t} s — es endet bei 1 s`)
  // UND DIE LEISTE ZEIGT DAS STUECK, nicht die Datei. Am Ende eines
  // Ein-Sekunden-Stuecks steht der Balken VOLL; gegen die zwei Sekunden der
  // Datei gerechnet stuende er bei der Haelfte, und ein Kind saehe „noch
  // genauso lang wie eben" in dem Moment, in dem das Bild stehen bleibt.
  const balken = await ev(
    `(() => { const f = document.getElementById('video-fuell'); const b = document.getElementById('video-fortschritt'); return { breite: f ? f.style.width : '', wert: Number(b?.getAttribute('aria-valuenow') ?? -1), zeit: document.getElementById('video-zeit')?.textContent || '' } })()`,
  )
  zeile('Stueck: Leiste', `${balken.breite} (aria ${balken.wert}) ${balken.zeit}`)
  if (balken.wert < 90) {
    melde(`die Leiste steht bei ${balken.wert} %, obwohl das Stueck zu Ende ist — sie misst die Datei`)
  }
  if (!balken.zeit.endsWith('0:01')) {
    melde(`die Zeit sagt "${balken.zeit}" — die Laenge des STUECKS ist 0:01`)
  }

  // GEZAEHLT WURDE GEGEN DAS STUECK: eine Sekunde von einer ist voll, eine
  // Sekunde von zwei waere 50 % und haette NICHT gezaehlt.
  const restNachStueck = (await stand())[0]?.rest ?? -1
  zeile('Stueck: Rest vorher / nachher', `${restVorStueck} / ${restNachStueck}`)
  if (restNachStueck !== restVorStueck - 1) {
    melde(`das Stueck hat ${restVorStueck - restNachStueck} verbraucht — gegen die Dateilaenge gerechnet waere es 0`)
  }
  await ev(`document.getElementById('video-weg').click()`)
  await warte(600)

  // ── 3d. UND EIN STUECK, DAS NICHT VORN ANFAENGT ───────────────────────
  //
  // BEI `abSek: 0` SIEHT EIN SCHIRM, DER NICHT SPRINGT, GENAUSO AUS wie
  // einer, der richtig springt. Erst ein Stueck, das bei Sekunde 1 beginnt,
  // trennt die beiden Faelle — und nur hier faellt auf, wenn der Sprung vor
  // `loadedmetadata` passiert und verpufft.
  await lage('stueck-hinten')
  await laden()
  await ev(`document.querySelector('#video-reihe .video-kachel').click()`)
  // Kurz nach dem Start hinsehen: gesprungen wird sofort, das Stueck ist
  // dann noch nicht zu Ende.
  await warte(700)
  const gesprungen = await ev(`Math.round(document.getElementById('video-spieler').currentTime * 100) / 100`)
  zeile('Stueck hinten: Stand nach 0,7 s', `${gesprungen} s`)
  if (gesprungen < 0.9) melde(`der Spieler steht bei ${gesprungen} s — er ist nicht auf Sekunde 1 gesprungen`)
  await warte(1800)
  const hinten = await ev(
    `(() => { const v = document.getElementById('video-spieler'); return { t: Math.round(v.currentTime * 100) / 100, pause: v.paused, zeit: document.getElementById('video-zeit')?.textContent || '' } })()`,
  )
  zeile('Stueck hinten: Ende', `${hinten.t} s, paused=${hinten.pause}, ${hinten.zeit}`)
  if (!hinten.pause) melde('das hintere Stueck lief ueber sein Ende hinaus')
  await ev(`document.getElementById('video-weg').click()`)
  await warte(600)
  await lage('voll')

  // ── 4. EINE ABSAGE KOMMT MIT GRUND AN ─────────────────────────────────
  //
  // Der Fall ist echt: zwischen dem Aufbau der Reihe und dem Tipp kann ein
  // zweiter Schirm oder ein Elternteil am Laptop die Freigabe aufbrauchen.
  // Die Kachel steht dann noch da, der Start wird abgewiesen.
  await laden()
  await lage('aufgebraucht')
  await ev(`document.querySelector('#video-reihe .video-kachel').click()`)
  await warte(1200)
  const wort = await ev(`document.getElementById('video-wort').textContent`)
  const quelle2 = await ev(`document.getElementById('video-spieler').currentSrc || ''`)
  zeile('Absage sagt', `"${wort}"`)
  if (!/aufgebraucht/i.test(String(wort))) melde(`die Absage lautet "${wort}" und nennt den Grund nicht`)
  if (quelle2) melde('trotz Absage wurde eine Adresse gesetzt')
  // UND KEINE SPIELLEISTE UEBER EINER ABSAGE: ein Anhalten-Knopf und
  // „0:00 / 0:00" waeren eine Bedienung fuer etwas, das gar nicht laeuft.
  const leisteBeiAbsage = await ev(`document.getElementById('video-leiste').classList.contains('offen')`)
  zeile('Leiste bei der Absage', String(leisteBeiAbsage))
  if (leisteBeiAbsage) melde('die Leiste steht ueber einer Absage, obwohl nichts laeuft')

  // ── 5. OHNE FREIGABE GIBT ES DIE REIHE NICHT ──────────────────────────
  await lage('leer')
  await laden()
  const versteckt = await ev(`document.getElementById('video').hidden`)
  const kacheln2 = await ev(`document.querySelectorAll('#video-reihe .video-kachel').length`)
  zeile('ohne Freigabe: versteckt', `${versteckt} (${kacheln2} Kacheln)`)
  if (!versteckt || kacheln2 !== 0) melde('ohne Freigabe steht die Reihe trotzdem da')

  console.log(fehler ? `\n  ${fehler} Abweichung(en)` : '\n  ohne Abweichung')
} finally {
  // Die Lage zurueckstellen, sonst misst das naechste Werkzeug gegen eine
  // leere Freigabeliste — genau die Falle, gegen die leihgabe.mjs gebaut ist.
  await fetch(`${BASIS}/vorschau/videos-voll`).catch(() => {})
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
