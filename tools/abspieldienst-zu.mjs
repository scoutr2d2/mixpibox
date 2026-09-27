#!/usr/bin/env node
/**
 * IST DER ABSPIELDIENST VON AUSSEN ZU? — die letzte Umgehung der Kinderzeit.
 *
 * ══ WORUM ES GEHT ══════════════════════════════════════════════════════════
 *
 * Die Kinderzeit sitzt im BACKEND-API: im Proxy `app.use('/player', …)` mit
 * `istStartbefehl`, und seit dem 14.08.2026 zusaetzlich in `spielweg.ts`. Der
 * ABSPIELDIENST auf :5005 kennt sie nicht — er spielt, was man ihm sagt.
 *
 * Solange er auf allen Schnittstellen hoert, genuegt also die Portnummer:
 *
 *     curl http://<box>:5005/current/spotify/now/spotify:album:…
 *
 * Kein Fehler im Programm, keine Luecke in einer Regex — nur ein offener Port.
 * Ein Kind mit einem Telefon im selben WLAN braucht nichts weiter.
 *
 * ══ WAS DIESES WERKZEUG MISST ══════════════════════════════════════════════
 *
 * VON DIESEM RECHNER AUS, also aus dem Netz:
 *   1. :5005 muss die Verbindung VERWEIGERN — nicht antworten, nicht schweigen.
 *   2. :8200 muss weiter antworten. Es liefert die Oberflaechen aus und MUSS
 *      erreichbar sein; dort sitzt die Kinderzeit.
 *
 * UEBER SSH, also auf der Box:
 *   3. :5005 muss auf der Rueckschleife WEITER antworten — sonst waere der
 *      Dienst nicht zugesperrt, sondern kaputt, und das sieht von aussen
 *      genau gleich aus.
 *   4. Die vier Stuecke auf der Box, die ihn rufen (mqtt, telegram,
 *      get_deviceid, set_deviceid), duerfen ihn nicht ueber den Hostnamen
 *      ansprechen — der loest auf die Aussenadresse auf und ginge ins Leere.
 *
 * Punkt 3 und 4 sind der Grund, warum das kein Einzeiler war.
 *
 * Aufruf:  node tools/abspieldienst-zu.mjs [benutzer@box]
 */

import { execFileSync } from 'node:child_process'
import net from 'node:net'

const BOX = process.argv[2] || 'dietpi@192.168.178.57'
const WIRT = BOX.includes('@') ? BOX.split('@')[1] : BOX
let fehler = 0
const sagen = (frage, befund, gut) => {
  if (!gut) fehler++
  console.log(`${gut ? '  ok  ' : ' FEHL '} ${frage}\n         ${befund}`)
}

/**
 * Einen Port von HIER aus anklopfen.
 *
 * DREI AUSGAENGE, UND SIE BEDEUTEN NICHT DASSELBE. „verweigert" ist das Ziel:
 * da hoert niemand. „zeitablauf" waere eine Sperre davor (Firewall) — auch
 * dicht, aber aus einem anderen Grund, und ein Neustart der Sperre macht sie
 * wieder auf. „offen" ist die Luecke.
 */
function anklopfen(wirt, port, ms = 4000) {
  return new Promise((fertig) => {
    const s = new net.Socket()
    const schluss = (art) => {
      s.destroy()
      fertig(art)
    }
    s.setTimeout(ms)
    s.once('connect', () => schluss('offen'))
    s.once('timeout', () => schluss('zeitablauf'))
    s.once('error', (e) => schluss(e.code === 'ECONNREFUSED' ? 'verweigert' : `fehler:${e.code}`))
    s.connect(port, wirt)
  })
}

const amGeraet = (befehl) => {
  try {
    return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', BOX, befehl], {
      encoding: 'utf8',
      timeout: 20000,
    }).trim()
  } catch (e) {
    return `FEHLER: ${String(e.stderr || e.message).split('\n')[0]}`
  }
}

console.log(`Abspieldienst-Riegel gegen ${BOX}\n`)

// ── 1. Von aussen: :5005 muss zu sein ─────────────────────────────────────
const draussen = await anklopfen(WIRT, 5005)
sagen(
  ':5005 ist aus dem Netz NICHT erreichbar',
  draussen === 'offen'
    ? 'OFFEN — jedes Geraet im WLAN kann an der Kinderzeit vorbei abspielen'
    : `${draussen} — niemand hoert dort`,
  draussen !== 'offen',
)

// ── 2. Von aussen: :8200 muss offen bleiben ───────────────────────────────
const api = await anklopfen(WIRT, 8200)
sagen(
  ':8200 ist weiter erreichbar (dort sitzt die Kinderzeit)',
  api === 'offen' ? 'offen, wie es sein soll' : `${api} — die Oberflaechen waeren damit unerreichbar`,
  api === 'offen',
)

// ── 3. Auf der Box: die Rueckschleife muss antworten ──────────────────────
const innen = amGeraet('curl -s -o /dev/null -m 6 -w "%{http_code}" http://127.0.0.1:5005/current/state 2>/dev/null')
sagen(
  'auf der Box antwortet er weiter auf 127.0.0.1',
  innen === '200' ? 'HTTP 200' : `bekommen: "${innen}" — dann ist er nicht zu, sondern kaputt`,
  innen === '200',
)

// ── 4. Auf der Box: kein Aufrufer nimmt den Hostnamen ─────────────────────
//
// SIE WERDEN AM GERAET GELESEN UND NICHT IM BAUM: im Baum steht, was
// ausgeliefert werden SOLL; auf der Box steht, was laeuft. Zwischen beidem
// liegt ein Ausrollweg, der `scripts` nur auf ausdrueckliche Anforderung
// mitnimmt (`ausliefern.py --nur scripts`).
// DER DOPPELPUNKT VOR DER PORTNUMMER IST DER UNTERSCHEIDER — zwei Anlaeufe
// waren vorher falsch, und beide auf lehrreiche Weise:
//
//   `5005`                  fand auch `setting_update.sh`, das die Portnummer
//                           in eine Konfiguration SCHREIBT. Ein Fehlalarm, den
//                           man wegklickt — und beim naechsten Mal auch den
//                           echten.
//   `https?://[^ ]*:5005`   war BLIND fuer genau die Form, um die es geht:
//
//                               url = 'http://' + c['host'] + ':5005/play'
//
//                           `http://` und `:5005` stehen dort nicht zusammen,
//                           die Adresse wird zusammengesetzt. Der Ausdruck
//                           bricht am ersten Leerzeichen ab. Gefunden hat das
//                           die Gegenprobe, nicht das Lesen.
//
// `:5005` trifft jede Zusammensetzung und keine Konfigurationszahl.
const rufer = amGeraet(
  "grep -hn ':5005' /usr/local/bin/mupibox/*.py /usr/local/bin/mupibox/*.sh 2>/dev/null | grep -vE '^[0-9]+: *#' | grep -viE '127[.]0[.]0[.]1|localhost' | head -10",
)
sagen(
  'kein Aufrufer auf der Box nimmt den Hostnamen',
  rufer && !rufer.startsWith('FEHLER')
    ? `noch ueber den Namen:\n${rufer}`
    : rufer.startsWith('FEHLER')
      ? rufer
      : 'keiner — alle ueber die Rueckschleife',
  !rufer || rufer.startsWith('FEHLER') === false ? !rufer : false,
)

console.log(
  `\n${fehler === 0 ? 'Der Riegel sitzt.' : `${fehler} Beanstandung(en).`}` +
    '\n\nHINWEIS: Punkt 4 liest die Skripte, die AUF der Box liegen. Sie kommen nur' +
    '\nmit `tools/ausliefern.py --nur scripts` dorthin — ein Lauf ohne das laesst' +
    '\nsie unveraendert, und dann ruft die Box weiter ins Leere.',
)
process.exit(fehler === 0 ? 0 : 1)
