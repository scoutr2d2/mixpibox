#!/usr/bin/env node
/**
 * WAS SCHICKT EIN ECHTER BROWSER ALS `Host`?
 *
 * ══ WARUM DIESE FRAGE ALLES ENTSCHEIDET ═══════════════════════════════════
 * `herkunft.ts` behandelt einen `Host`, den `new URL` NICHT lesen kann, wie
 * einen fehlenden: der Namensteil UND der Origin-Vergleich fallen aus, die
 * Anfrage geht durch. Gemessen (tools/namensriegel-gegenlesen.mjs, Ring 1)
 * kommt man damit lesend UND schreibend durch — `Host: mupibox evil`,
 * `Host: a|b`, `Host:` leer, und ueber den Benutzerteil auch
 * `Host: boese.example@mupibox`.
 *
 * OB DAS EINE LUECKE IST ODER NUR EINE UNSAUBERKEIT, haengt an genau einer
 * Frage: KANN EINE FREMDE WEBSEITE EINEN BROWSER DAZU BRINGEN, SO ETWAS ZU
 * SCHICKEN? Der Riegel steht gegen Webseiten. Wer selbst einen Socket
 * aufmacht, setzt ohnehin jeden Kopf, den er will — gegen den hilft kein
 * Riegel dieser Art, und er braucht ihn auch nicht zu umgehen.
 *
 * DIESES WERKZEUG BEHAUPTET DIE ANTWORT NICHT, SONDERN MISST SIE: es macht
 * einen rohen Zuhoerer auf, der jedes Byte mitschreibt, und schickt einen
 * echten Chromium mit Adressen dorthin, die den Benutzerteil, ein Leerzeichen
 * und Sonderzeichen im Rechnernamen tragen. Was in der Kopfzeile ankommt,
 * steht danach da.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/host-kopf-am-browser.mjs [--port 9671]
 *
 * NUR AUF DIESEM RECHNER. Es wird nichts ausgeliefert und die Box nicht
 * angefasst; der Zuhoerer beantwortet jede Anfrage mit einer leeren Seite.
 */
import net from 'node:net'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}

/** Ein Port, der NACHGEWIESEN frei ist — hier laufen fremde Sitzungen. */
async function portFrei(p) {
  return await new Promise((f) => {
    const s = net.createServer()
    s.once('error', () => f(false))
    s.once('listening', () => s.close(() => f(true)))
    s.listen(p, '0.0.0.0')
  })
}
let PORT = Number(opt('port', '9671'))
while (!(await portFrei(PORT))) PORT++

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/*
 * EIN EIGENER BROWSER FUER ALLE VERSUCHE — Suche, freier Port, Wegwerf-Profil
 * und Aufraeumen kommen aus tools/leihgabe.mjs. Die vier Schalter bleiben:
 * ohne sie wartet Chromium eine halbe Minute auf Google-Dienste, die es hier
 * nicht braucht — und dieses Werkzeug misst dann Geduld statt Kopfzeilen.
 */
const brw = await eigenerBrowser({
  zusatz: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'],
})
if (!brw) {
  console.error('Kein Chromium gefunden — MUPIBOX_BROWSER setzen.')
  process.exit(2)
}

/* ══ DER ZUHOERER, DER JEDES BYTE MITSCHREIBT ═════════════════════════════ */

const gesehen = []
const zuhoerer = net.createServer((s) => {
  let roh = ''
  s.on('data', (d) => {
    roh += d
    if (roh.includes('\r\n\r\n')) {
      const zeilen = roh.split('\r\n')
      const host = zeilen.slice(1).find((z) => /^host:/i.test(z))
      gesehen.push({ zeile: zeilen[0], host: host ?? '(KEINE Host-Kopfzeile)' })
      s.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 3\r\nConnection: close\r\n\r\nhi\n')
    }
  })
  s.on('error', () => {})
})
await new Promise((f) => zuhoerer.listen(PORT, '127.0.0.1', f))

/* ══ DIE ADRESSEN, MIT DENEN EIN ANGREIFER ES VERSUCHEN WUERDE ════════════ */

const VERSUCHE = [
  { was: 'Benutzerteil vor dem Namen', url: `http://boese.example@127.0.0.1:${PORT}/api/konfiguration` },
  { was: 'Benutzerteil mit Passwort', url: `http://boese.example:geheim@127.0.0.1:${PORT}/a` },
  { was: 'Leerzeichen im Namen (kodiert)', url: `http://127.0.0.1%20boese.example:${PORT}/a` },
  { was: 'senkrechter Strich im Namen (kodiert)', url: `http://127.0.0.1%7Cboese:${PORT}/a` },
  { was: 'Punkt am Ende', url: `http://localhost.:${PORT}/a` },
  { was: 'gewoehnlich, zum Vergleich', url: `http://127.0.0.1:${PORT}/a` },
]

let rot = 0
try {
  for (const v of VERSUCHE) {
    const vorher = gesehen.length
    // JEDE ADRESSE IN EINEM EIGENEN REITER DES EIGENEN BROWSERS. Der Weg ueber
    // /json/new ist eine Navigation wie aus der Adresszeile — genau die Lage,
    // die ein Angreifer mit einem Link herstellt. Die Adresse wird EINMAL
    // kodiert, weil die Gegenseite sie vor dem Navigieren einmal dekodiert;
    // neuere Chromium-Baende verlangen PUT, aeltere kennen nur GET.
    const neuerReiter = `http://127.0.0.1:${brw.port}/json/new?${encodeURIComponent(v.url)}`
    const auf = await fetch(neuerReiter, { method: 'PUT' }).catch(() => null)
    if (!auf || !auf.ok) await fetch(neuerReiter).catch(() => {})
    // HARTE GRENZE. Alles laeuft ueber die Rueckschleife; was ankommen sollte,
    // kommt binnen Augenblicken. Wer nach 8 s nichts geschickt hat, schickt
    // nichts mehr — der Browser hat die Adresse verworfen. Kommt etwas an,
    // wird kurz nachgefasst, damit auch eine zweite Anfrage desselben Reiters
    // gezaehlt wird.
    for (const frist = Date.now() + 8000; Date.now() < frist && gesehen.length === vorher; ) await warte(200)
    if (gesehen.length > vorher) await warte(600)
    const neu = gesehen.slice(vorher)
    if (neu.length === 0) {
      // Der Browser hat die Adresse gar nicht erst aufgeloest — auch das ist ein
      // Ergebnis, und zwar dasselbe: es kommt nichts an.
      console.log(`  ····  ${v.was}: NICHTS kam an (Browser hat die Adresse verworfen)`)
      console.log(`         ${v.url}`)
      continue
    }
    for (const g of neu) {
      const wert = g.host.replace(/^host:\s*/i, '')
      // ROT ist: der Browser hat wirklich etwas geschickt, das `new URL` nicht
      // lesen kann — dann waere die Luecke oben von einer Webseite erreichbar.
      let lesbar = true
      try {
        // eslint-disable-next-line no-new
        new URL(`http://${wert.trim()}`)
      } catch {
        lesbar = false
      }
      const hatBenutzerteil = wert.includes('@')
      const schlimm = !lesbar || hatBenutzerteil
      if (schlimm) rot++
      console.log(`  ${schlimm ? 'ROT ' : 'ok  '} ${v.was}: Host: ${JSON.stringify(wert)}`)
      console.log(`         ${v.url}`)
    }
  }
} finally {
  // IM finally, damit der Browser auch nach einem Fehler nicht stehen bleibt.
  await brw.schliessen()
}

zuhoerer.close()
console.log(
  `\n${rot} von ${VERSUCHE.length} Adressen brachten den Browser dazu, einen Host zu schicken, den new URL nicht lesen kann oder der einen Benutzerteil traegt.`,
)
process.exit(rot === 0 ? 0 : 1)
