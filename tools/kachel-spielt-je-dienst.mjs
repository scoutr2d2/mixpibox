#!/usr/bin/env node
/**
 * SPIELT EINE KACHEL VON JEDEM DIENST — oder nur die vier, die man im Kopf hat?
 *
 * ── DER BEFUND, DER DIESES WERKZEUG AUSGELOEST HAT (04.08.2026) ────────────
 * Beim Gegenlesen von BACKLOG E4 stand im Backlog woertlich: „`NewDesign/`
 * zeigt und spielt eine ARD-Kachel bereits vollstaendig". Gemessen war das
 * nicht. Gemessen war es DANN: Die Kachel erscheint mit der richtigen
 * Plakette, und ein Tipp darauf antwortet
 *
 *     „Das kann die Box hier noch nicht abspielen."
 *
 * `abspielBefehl()` (app.js, bis E95/V Stufe 3; heute `startPlan` in
 * spielfunktion.ts) verzweigte in einem `switch (q.dienst)` mit
 * Zweigen fuer lokal, spotify, radio, rss und jellyfin — und einem `default:
 * return null`. Ein sechster Dienst faellt dort hinein, ohne dass irgendetwas
 * rot wird: die Kachel ist da, die Farbe stimmt, die Plakette stimmt, und der
 * einzige Unterschied zu „geht" ist ein Satz, den nur sieht, wer tippt.
 *
 * DIE PLAKETTEN-WERKZEUGE SEHEN DAS NICHT. dienst-marken-schau, raster-marke-
 * schau, lane-marken-schau und marke-grenzfaelle pruefen, ob ein Dienst ein
 * ZEICHEN und eine FARBE hat. Eine Kachel kann vollstaendig richtig aussehen
 * und trotzdem nichts tun; das ist genau der Fall, den es hier gibt.
 *
 * ── WAS ES PRUEFT ─────────────────────────────────────────────────────────
 * Fuer JEDEN Dienst, der in der Vorschau ein Werk hat: auf die Kachel tippen
 * und MITLESEN, was auf der Leitung an den Abspieldienst geht. Gemessen wird
 * die Leitung und nicht die Quittung — die Attrappe antwortet auf jeden Befehl
 * mit 200 (llmwiki [server-antwortet-200-auf-alles], [playpause-gibt-es-nicht])
 * und kann gar nicht wissen, ob je einer kam.
 *
 * DREI AUSGAENGE, und nur einer ist gut:
 *   ein Startbefehl geht hinaus           -> ok
 *   „(keiner)" und eine Meldung           -> die Kachel entschuldigt sich
 *   „(keiner)" und KEINE Meldung          -> die Kachel schweigt (schlimmer)
 *
 * ── WARUM UEBER DIE DIENSTE UND NICHT UEBER EINE LISTE VON WERKEN ─────────
 * Weil die Frage „welche SORTEN gibt es, und pruefe ich von jeder eine?" die
 * ist, an der dieses Projekt mehrfach vorbeigelaufen ist (llmwiki
 * [attrappe-luegt-durch-weglassen]). Die Dienste kommen deshalb aus
 * `/api/werke` selbst; wer der Vorschau einen siebten hinzufuegt, wird hier
 * ohne eine Zeile Aenderung mitgeprueft. Und wer einen VERGISST, faellt auf:
 * `--pruefen` verlangt, dass jeder Dienst aus `tools/dienste-deckung.mjs`
 * entweder gemessen oder unten mit Grund ausgenommen ist.
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs, nur
 * gelesen und getippt. Weder die Box noch Dateien werden angefasst.
 *
 * AUFRUF
 *     node tools/kachel-spielt-je-dienst.mjs             # Tabelle
 *     node tools/kachel-spielt-je-dienst.mjs --pruefen   # Ende 1 bei Befund
 *
 * GEMESSEN AM 04.08.2026, VOR DER REPARATUR (und darum steht es hier):
 *     lokal     musicsearch/library/album/…            ok
 *     spotify   spotify/now/spotify:album:…            ok
 *     jellyfin  jellyfin/…  + 13x jfqueue/…            ok  (ueber albumSpielen)
 *     radio     radio/…                                ok
 *     rss       rss/…                                  ok
 *     ard       (keiner)   „Das kann die Box hier noch nicht abspielen."
 *
 * UND NACH DER REPARATUR, mit demselben Aufruf:
 *     ard       ard/…       + 13x ardqueue/…           ok, keine Meldung
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
/** Ein Pruefschritt soll nur reden, wenn etwas nicht in Ordnung ist. Die
 *  Befunde gehen unabhaengig davon nach stderr. */
const zeig = PRUEFEN ? () => {} : console.log

/**
 * BEWUSST NICHT GEMESSEN — je Dienst, mit Grund.
 *
 * Dieselbe Regel wie in tools/dienste-deckung.mjs: Wer weglassen will, traegt
 * es hier ein; wer vergisst, wird rot. Ein „ist halt nicht dabei" gibt es
 * nicht.
 */
const AUSNAHMEN = {
  anderes:
    '„anderes" heisst „wir wissen es nicht" (dienstVon). Ein Eintrag ohne erkannten Typ HAT keinen Abspielweg — dass die Kachel sich entschuldigt, ist hier die richtige Antwort und kein Fehlgriff.',
}

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
// wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
// eine Vorschau, die jemand anders verstellt hat. Und der eigene Browser
// laeuft auf einem FREIEN Port mit eigenem Profil statt auf einer festen
// Nummer, die ein Ueberlebender eines harten Abbruchs noch halten koennte —
// `/json/list` liefert dann klaglos die Ziele des fremden.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
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

let id = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++id
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

/**
 * Die Dienstliste aus DER Quelle, aus der auch tools/dienste-deckung.mjs sie
 * liest: dem Rueckgabetyp von `dienstVon()`. Eine eigene Aufzaehlung waere
 * genau der Fehler, den beide Werkzeuge suchen.
 */
function dienstlisteAusQuelle() {
  const text = readFileSync(join(WURZEL, 'src/backend-api/src/medien.ts'), 'utf8')
  const m = /export function dienstVon\([^)]*\):\s*([^{]+)\{/.exec(text)
  if (!m) throw new Error('dienstVon nicht gefunden — heisst die Funktion in medien.ts noch so?')
  return [...m[1].matchAll(/'([a-z]+)'/g)].map((t) => t[1])
}

let fehler = 0
const zeilen = []

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  /*
   * DIE KONSOLE MITSCHREIBEN. Sie gehoert zur selben Frage: Eine Kachel, die
   * spielt und dabei einen Fehler in die Konsole schreibt, ist nicht in
   * Ordnung — auf einer Box im Kiosk sieht diese Konsole nie jemand, und was
   * dort steht, faellt genauso still heraus wie eine fehlende Kachel.
   * `console.log` zaehlt NICHT: die Seite meldet dort ihren Betrieb.
   */
  const konsole = []
  ws.on('message', (r) => {
    const x = JSON.parse(r)
    if (x.method === 'Runtime.consoleAPICalled' && (x.params.type === 'error' || x.params.type === 'warning')) {
      konsole.push(`${x.params.type}: ${(x.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`)
    }
    if (x.method === 'Runtime.exceptionThrown') {
      konsole.push(`ausnahme: ${x.params.exceptionDetails?.exception?.description || x.params.exceptionDetails?.text}`)
    }
  })
  await send(ws, 'Page.navigate', { url: ZIEL })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  await warte(2500)

  /*
   * NUR BEFEHLE, NICHT DIE ABFRAGEN. Beide gehen an `/player/`, und der
   * Unterschied ist die FORM, nicht ein Wort:
   *
   *     /player/local            der Zustand des lokalen Abspielers  (Abfrage)
   *     /player/state            der Zustand des Dienstes            (Abfrage)
   *     /player/current/stop     ein Befehl in den Raum „current"
   *     /player/current/radio/…  desselben
   *
   * Gezaehlt wird deshalb an der Zahl der Abschnitte: ein Befehl steht IMMER
   * hinter einem Raum. Eine Liste der Abfragenamen waere eine zweite Wahrheit
   * und liefe beim naechsten Endpunkt auseinander — beim ersten Anlauf am
   * 04.08.2026 galt `/player/local` genau deshalb als Startbefehl, und die
   * stumme ARD-Kachel wurde als „ok" gemeldet.
   */
  /*
   * ZWEI LEITUNGEN, EIN MERKMAL (E95/V Stufe 2, 31.08.2026): Seit dem Umbau
   * schickt ein Kacheltipp EINEN `POST /api/spielen` — die Quelle, den
   * Befehl und die Folge waehlt der Server. Gemessen wird deshalb BEIDES:
   * die alte /player-Leitung (die Interpretenseite baut ihre Befehle noch
   * selbst, Stufe 3) UND der Spielfunktions-Wunsch samt Schluessel. Wer nur
   * die alte Leitung laese, meldete jede umgestellte Kachel als stumm — der
   * Fehlalarm, der dieses Werkzeug wertlos machte.
   */
  const mitlesen = `window.__befehle = [];
    if (!window.__mitgelesen) { window.__mitgelesen = true;
      const alt = window.fetch;
      window.fetch = function (u) {
        try {
          const s = String(u && u.url ? u.url : u);
          const m = /\\/player\\/([^/?#]+)\\/(.+)$/.exec(s);
          if (m) window.__befehle.push(m[2]);
          if (/\\/api\\/spielen$/.test(s)) {
            let sch = '';
            try { sch = JSON.parse((arguments[1] || {}).body || '{}').schluessel || '' } catch {}
            window.__befehle.push('api/spielen ' + sch);
          }
        } catch {}
        return alt.apply(this, arguments)
      } }
    true`
  await ev(mitlesen)

  const werke = (await (await fetch(new URL('/api/werke', ZIEL))).json()).werke || []
  /*
   * JE DIENST EINE KACHEL, DIE BEIM TIPP AUCH SPIELEN SOLL.
   *
   * NICHT EINFACH DIE ERSTE: Eine PLAYLIST-Kachel und eine INTERPRETEN-Kachel
   * spielen beim Tipp mit Absicht nicht, sie OEFFNEN (`spielen()` leitet eine
   * Interpreten-Kachel auf die Interpretenseite um; eine Playlist zeigt ihre
   * Alben und hat dafuer den eigenen kleinen Knopf `.tipp-spiel`). Beim ersten
   * Anlauf am 04.08.2026 fiel Spotify genau darum als „stumm" auf — die erste
   * Spotify-Kachel der Vorschau ist „Bibi Blocksberg", eine Playlist. Das
   * waere ein Fehlalarm gewesen und haette das Werkzeug wertlos gemacht.
   *
   * Mehr als eine Kachel je Dienst braucht es nicht: gesucht wird der Dienst,
   * der GAR KEINEN Weg hat, nicht der Grenzfall innerhalb eines Dienstes.
   */
  /*
   * SEIT 05.08.2026 IST 'show' MIT ARD DABEI (BACKLOG E4/A10): Eine
   * ARD-Kachel klappt ihre FOLGEN auf, genau wie eine Playlist ihre Alben.
   * Der Weg zum Ton ist dort derselbe wie bei der Playlist — der eigene
   * kleine Knopf `.tipp-spiel`, und den findet `tippen()` von selbst.
   *
   * Die Menge sagt nur noch, wovor sie immer warnte: dass die Vorschau fuer
   * einen Dienst AUSSCHLIESSLICH aufklappende Kacheln fuehrt. Das ist keine
   * Luecke mehr, seit der Knopf mitgemessen wird — die Warnung faellt deshalb
   * weg. Was BLEIBT, ist 'interpret': eine Interpreten-Kachel hat gar keinen
   * Knopf, sie spielt grundsaetzlich nichts (`spielen()` leitet sie auf die
   * Interpretenseite um).
   */
  const OEFFNET_STATT_ZU_SPIELEN = new Set(['interpret'])
  const jeDienst = new Map()
  for (const w of werke) {
    const d = Array.isArray(w.quellen) ? w.quellen[0]?.dienst : undefined
    if (!d) continue
    const da = jeDienst.get(d)
    if (!da) jeDienst.set(d, w)
    else if (OEFFNET_STATT_ZU_SPIELEN.has(da.art) && !OEFFNET_STATT_ZU_SPIELEN.has(w.art)) jeDienst.set(d, w)
  }
  for (const [d, w] of jeDienst) {
    if (!OEFFNET_STATT_ZU_SPIELEN.has(w.art)) continue
    // Kein stiller Rueckfall: dass hier NICHT gemessen wurde, muss dastehen.
    console.error(
      `FEHLT: tools/neu-vorschau.mjs fuehrt fuer '${d}' nur Kacheln der Art '${w.art}' — die oeffnen beim Tipp, sie spielen nicht`,
    )
    fehler++
  }


  /**
   * Die Kachel eines Werks ueber den TITEL finden, nicht ueber einen Index:
   * Die Startseite sortiert und faltet Regale, ein Index waere ab dem ersten
   * Regal daneben. Steckt die Kachel in einem Regal, wird das Regal geoeffnet.
   */
  const suchen = (titel) =>
    `(() => {
        const raus = document.getElementById('zurueck')
        if (raus && !raus.disabled) raus.click()
        const suche = () => [...document.querySelectorAll('#raster .kachel')]
          .find((k) => (k.querySelector('.kachel-titel') || {}).textContent === ${JSON.stringify(titel)})
        let k = suche()
        if (!k) {
          for (const r of [...document.querySelectorAll('#raster .kachel')]) {
            if (!r.querySelector('.regal-zahl')) continue
            r.click(); k = suche(); if (k) break
          }
        }
        return k })()`

  const tippen = async (titel, ms = 2500) => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1500)
    await ev(mitlesen)
    konsole.length = 0
    /*
     * WER EINEN EIGENEN PLAY-KNOPF HAT, WIRD DORT GETIPPT.
     *
     * Eine Kachel, die AUFKLAPPT (Spotify-Playlist, ARD-Sendung), traegt den
     * Weg zum Ton in `.tipp-spiel` — „ein Tipp = Ton" gilt fuer sie nicht,
     * und das ist Absicht (ein Tipp startete sonst dreihundert Kapitel bzw.
     * dreissig Folgen am Stueck). Die FRAGE dieses Werkzeugs bleibt dieselbe:
     * kommt fuer diesen Dienst ueberhaupt ein Startbefehl heraus? Sie darf nur
     * nicht an der Stelle scheitern, an der die Oberflaeche mit Absicht etwas
     * anderes tut. Bis zum 05.08.2026 stand hier stur `k.click()`; mit der
     * Folgen-Lane der ARD waere `ard` prompt als „STUMM" gemeldet worden —
     * ein Fehlalarm, und die kosten mehr als ein uebersehener Fall
     * (llmwiki attrappe-luegt-durch-weglassen, Fall 6).
     */
    const gefunden = await ev(
      `(() => { const k = ${suchen(titel)}; if (!k) return null;
         const knopf = k.querySelector('.tipp-spiel')
         ;(knopf || k).click(); return knopf ? 'knopf' : 'kachel' })()`,
    )
    if (!gefunden) return { start: '(keine Kachel)', alle: [], meldung: null }
    await warte(ms)
    const alle = (await ev('window.__befehle')) || []
    // `stop` gehoert zum Start dazu (die andere Maschine wird erst angehalten)
    // und ist deshalb KEIN Startbefehl.
    const start = alle.find((b) => !/^(stop|setvolume)/.test(b)) || '(keiner)'
    const meldung = await ev(`((document.querySelector('#meldung, .meldung') || {}).textContent || '').trim() || null`)
    return { start, alle, meldung, laut: [...konsole] }
  }

  zeig(`\n  Vorschau: ${ZIEL}   Werke: ${werke.length}   Dienste mit Werk: ${[...jeDienst.keys()].join(', ')}\n`)
  for (const [dienst, w] of jeDienst) {
    if (AUSNAHMEN[dienst]) {
      zeilen.push({ dienst, titel: w.titel, start: '(bewusst nicht geprueft)', meldung: null, gut: true })
      continue
    }
    const { start, alle, meldung, laut } = await tippen(String(w.titel || ''))
    const gut = start !== '(keiner)' && start !== '(keine Kachel)' && !laut.length
    if (!gut) fehler++
    zeilen.push({ dienst, titel: w.titel, art: w.art, start, alle, meldung, laut, gut })
  }

  const breite = Math.max(...zeilen.map((z) => z.dienst.length))
  for (const z of zeilen) {
    zeig(
      `    ${z.gut ? 'ok  ' : 'STUMM'} ${z.dienst.padEnd(breite)}  ${String(z.titel).padEnd(24)} ${z.start}` +
        (z.meldung ? `\n            Meldung: „${z.meldung}"` : ''),
    )
    if (z.alle && z.alle.length > 1) zeig(`            alle: ${z.alle.join('  ')}`)
    for (const l of z.laut || []) zeig(`            Konsole: ${l}`)
  }
  zeig('')

  // DIE GEGENRICHTUNG: ein Dienst, den die Quelle kennt, den die Vorschau aber
  // nicht fuehrt. Dann misst dieses Werkzeug ihn nicht — und das ist genau die
  // Luecke, aus der [attrappe-luegt-durch-weglassen] entstanden ist.
  for (const d of dienstlisteAusQuelle()) {
    if (jeDienst.has(d) || AUSNAHMEN[d]) continue
    fehler++
    console.error(
      `FEHLT: tools/neu-vorschau.mjs fuehrt kein Werk mit dienst '${d}' — dieser Dienst wird hier NICHT gemessen`,
    )
  }
  for (const [d, grund] of Object.entries(AUSNAHMEN)) zeig(`  bewusst ohne '${d}': ${grund}`)
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

for (const z of zeilen) {
  if (z.gut) continue
  if (z.start === '(keiner)' || z.start === '(keine Kachel)') {
    console.error(`FEHLT: '${z.dienst}' — die Kachel „${z.titel}" schickt keinen Startbefehl`)
  }
  for (const l of z.laut || []) console.error(`FEHLT: '${z.dienst}' — die Kachel schreibt in die Konsole: ${l}`)
}
if (!fehler) {
  console.error(`geprueft: ${zeilen.length} Dienste, jede Kachel schickt einen Startbefehl und schweigt in der Konsole`)
}
process.exit(fehler ? 1 : 0)
