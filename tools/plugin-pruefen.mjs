#!/usr/bin/env node
/**
 * PLUGIN-PRUEFEN — das Urteil, und zwar vom echten Kern.
 *
 * Der Pruefstand (plugins/pruefstand.mjs) faelscht den Kontext und ist damit
 * schnell und offline — aber er ist eine NACHBILDUNG. Dieses Werkzeug ist das
 * Gegenstueck: es laedt dein Plugin durch `pluginsLaden` aus plugin-wirt.ts,
 * also in einem echten worker_thread, mit dem echten Laufwerk, den echten
 * Rechten, der echten Frist und der echten Pruefung dessen, was du
 * zurueckgibst.
 *
 * WOZU BEIDES. Ein Test gegen eine Nachbildung ist gruen, wenn die Nachbildung
 * irrt. Deshalb gibt es hier keinen zweiten Regelsatz: was dieses Werkzeug
 * sagt, sagt der Kern. Weicht der Pruefstand davon ab, faellt es hier auf.
 *
 * Aufruf:
 *   npx tsx tools/plugin-pruefen.mjs plugins/mupibox-podcast
 *   npx tsx tools/plugin-pruefen.mjs plugins/mupibox-podcast --aufloesen "https://…/feed.xml"
 *
 * Ohne --aufloesen geht KEIN Netzaufruf hinaus: dann werden nur Manifest,
 * Laden und `befinden` geprueft.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.resolve(HIER, '..')
const MEDIEN_WURZEL = process.env.MUPIBOX_MEDIA_DIR || '/home/dietpi/MuPiBox/media'

const argumente = process.argv.slice(2)
const ziel = argumente.find((a) => !a.startsWith('--'))
const aufloesenIndex = argumente.indexOf('--aufloesen')
const rest = aufloesenIndex >= 0 ? argumente[aufloesenIndex + 1] : null
const songtextIndex = argumente.indexOf('--songtext')
const songtextRoh = songtextIndex >= 0 ? argumente[songtextIndex + 1] : null
const ereignisIndex = argumente.indexOf('--ereignis')
const ereignisName = ereignisIndex >= 0 ? argumente[ereignisIndex + 1] : null
/** Bei einem Klang-Plugin die erzeugte PipeWire-Kette mit ausgeben. */
const zeigeConf = argumente.includes('--conf')
const einstIndex = argumente.indexOf('--einstellungen')
let einstellungen = {}
if (einstIndex >= 0) {
  try {
    einstellungen = JSON.parse(argumente[einstIndex + 1] ?? '{}')
  } catch (e) {
    console.error(`--einstellungen ist kein gueltiges JSON: ${e.message}`)
    process.exit(2)
  }
}

if (!ziel) {
  console.error('Aufruf: npx tsx tools/plugin-pruefen.mjs <plugin-ordner> [Optionen]')
  console.error('')
  console.error('  --aufloesen <rest>        eine Medienkennung wirklich aufloesen (geht ins Netz)')
  console.error('  --songtext "I|T|Dauer"    einen Songtext holen: "Nena|99 Luftballons|233"')
  console.error('                            (geht ins Netz; zeigt Zeilen und Zeitmarken, nie den Text)')
  console.error('  --ereignis <name>         ein Ereignis schicken: wiedergabeGestartet,')
  console.error('                            wiedergabeGestoppt, lautstaerke, kinderzeitEnde')
  console.error('  --einstellungen <json>    Einstellungen setzen, z. B. \'{"adresse":"192.168.1.42"}\'')
  console.error('  --conf                    bei Klang-Plugins die erzeugte PipeWire-Kette zeigen')
  process.exit(2)
}

const ordner = path.resolve(ziel)
if (!fs.existsSync(path.join(ordner, 'plugin.json'))) {
  console.error(`In ${ordner} liegt keine plugin.json.`)
  process.exit(2)
}
const kennung = path.basename(ordner)

let fehler = 0
const sagen = (frage, befund, gut) => {
  if (!gut) fehler++
  console.log(`${gut ? '  ok  ' : ' FEHL '} ${frage}`)
  if (befund) console.log(`         ${String(befund).split('\n').join('\n         ')}`)
}

console.log(`Plugin-Pruefung: ${kennung}`)
console.log(`Ordner: ${ordner}`)
console.log(`Medienwurzel fuer die Pruefung: ${MEDIEN_WURZEL}\n`)

// ── 1. Das Manifest, mit der ECHTEN Pruefung ─────────────────────────────
const { manifestPruefen } = await import(path.join(WURZEL, 'src/backend-api/src/plugin-vertrag.ts'))

let roh
try {
  roh = JSON.parse(fs.readFileSync(path.join(ordner, 'plugin.json'), 'utf8'))
} catch (e) {
  sagen('plugin.json lesbar?', e.message, false)
  process.exit(1)
}

const urteil = manifestPruefen(roh)
sagen(
  'Manifest gueltig?',
  urteil.ok ? `${urteil.manifest.name} ${urteil.manifest.fassung}` : urteil.maengel.join('\n'),
  urteil.ok,
)

if (!urteil.ok) {
  console.log('\nOhne gueltiges Manifest laedt die Box gar nicht erst. Hier ist Schluss.')
  process.exit(1)
}

// DER ORDNERNAME MUSS DIE KENNUNG SEIN — der Wirt weist sonst ab, und der
// Grund waere auf der Box eine Zeile im Journal, die niemand liest.
sagen(
  'Ordnername gleich Kennung?',
  kennung === urteil.manifest.kennung ? kennung : `Ordner "${kennung}", Kennung "${urteil.manifest.kennung}"`,
  kennung === urteil.manifest.kennung,
)

const hauptDatei = path.join(ordner, urteil.manifest.haupt)
sagen(`Einstiegsdatei "${urteil.manifest.haupt}" da?`, hauptDatei, fs.existsSync(hauptDatei))

if (fehler > 0) {
  console.log('\nDas reicht nicht zum Laden. Hier ist Schluss.')
  process.exit(1)
}

// ── 2. Wirklich laden — im echten Worker ─────────────────────────────────
//
// Der Wirt liest einen Ordner voller Plugin-Ordner. Damit hier NUR dieses eine
// geladen wird (und nicht alles unter plugins/), bekommt es einen eigenen
// Platz. Kopiert statt verknuepft: `readdirSync({withFileTypes})` meldet einen
// Symlink NICHT als Verzeichnis, das Plugin fiele also stillschweigend heraus.
const lager = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-pruefen-'))
fs.cpSync(ordner, path.join(lager, kennung), { recursive: true })

const wirt = await import(path.join(WURZEL, 'src/backend-api/src/plugin-wirt.ts'))
const lage = wirt.pluginsLaden(lager, { [kennung]: einstellungen })

if (lage.abgewiesen.length > 0) {
  sagen('vom Wirt angenommen?', lage.abgewiesen.map((a) => a.maengel.join(' ')).join('\n'), false)
}

// Warten, bis der Worker steht oder gescheitert ist.
const bis = Date.now() + 15000
while (Date.now() < bis && wirt.staende().some((s) => s.zustand === 'laedt')) {
  await new Promise((f) => setTimeout(f, 50))
}

const stand = wirt.staende().find((s) => s.kennung === kennung)
sagen(
  'laedt im echten Worker?',
  stand ? `${stand.zustand}${stand.grund ? ` — ${stand.grund}` : ''}` : 'gar nicht angekommen',
  stand?.zustand === 'bereit',
)

if (stand?.zustand === 'bereit') {
  const kann = Object.entries(stand.kann)
    .filter(([, v]) => v)
    .map(([k]) => k)
  sagen('was kann es?', kann.join(', ') || 'nichts — dann tut es auf der Box auch nichts', kann.length > 0)
  sagen('Rechte laut Manifest', stand.rechte.join(', ') || 'keine', true)

  // `befinden` IST EINE AUSKUNFT, KEIN URTEIL UEBER DIE BAUART.
  //
  // Der erste Lauf gegen mupibox-wled zaehlte „keine Adresse eingestellt" als
  // Mangel. Das ist verkehrt: ein Plugin, das sauber meldet, dass es noch
  // nicht eingerichtet ist, arbeitet einwandfrei — es fehlt eine EINSTELLUNG,
  // kein Code. Dieses Werkzeug prueft, ob ein Plugin taugt, nicht ob es schon
  // konfiguriert ist.
  const b = await wirt.befinden(kennung)
  console.log(`  ——   befinden(): ${b.ok ? 'ok' : 'nicht ok'}${b.text ? ` — ${b.text}` : ''}`)
  if (!b.ok && urteil.manifest.felder.length > 0 && Object.keys(einstellungen).length === 0) {
    console.log(
      `         Dieses Plugin meldet ${urteil.manifest.felder.length} Einstellung(en) an. Ohne sie ist\n` +
        "         'nicht ok' zu erwarten. Mit Werten pruefen:\n" +
        `         --einstellungen '{"${urteil.manifest.felder[0].schluessel}": "…"}'`,
    )
  }

  // ── 2b. Die Klangkette — die einzige Zusage, die eine DATEI wird ───────
  //
  // WARUM SIE HIER GEPRUEFT WIRD UND NICHT ERST AUF DER BOX: aus dieser
  // Liste baut der Kern eine PipeWire-Filterkette, und was PipeWire nicht
  // laden kann, laesst den Filterprozess sterben — die Senke erscheint gar
  // nicht erst (am 21.08.2026 gemessen). Ein Plugin-Autor soll das hier
  // sehen und nicht an einer stummen Box raten.
  //
  // KEIN NETZ, KEIN TON: `klangketten()` fragt nur nach der BESCHREIBUNG.
  // Gerechnet wird auf der Box in PipeWire, und der wird hier nicht
  // angefasst.
  if (stand.kann.klangkette) {
    const ketten = await wirt.klangketten()
    const meine = ketten.find((k) => k.kennung === kennung)
    if (!stand.rechte.includes('klang')) {
      sagen(
        'Klangkette',
        'Das Plugin hat eine klangkette(), aber nicht das Recht "klang" — sie wird nie gefragt.',
        false,
      )
    } else if (meine) {
      const { ketteBeschreiben, ketteConfBauen } = await import('../src/backend-api/src/klangkette.ts')
      sagen('Klangkette vom Kern angenommen?', ketteBeschreiben(meine.kette), true)
      if (zeigeConf) {
        console.log(
          ketteConfBauen(meine.kette, {
            sinkName: 'klangwerk',
            ausgangName: 'klangwerk.ausgang',
            beschreibung: 'Klangwerk (Ton-Plugins)',
          })
            .split('\n')
            .map((z) => `         ${z}`)
            .join('\n'),
        )
      }
    } else {
      // ZWEI GRUENDE, EIN BILD — deshalb beide nennen: entweder ist die Kette
      // leer (alle Regler auf Vorgabe, voellig in Ordnung), oder sie wurde
      // abgewiesen (dann steht der Grund oben im Journal).
      console.log(
        '  ——   Klangkette: leer. Entweder stehen alle Regler auf Vorgabe — dann\n' +
          '         mit --einstellungen pruefen —, oder der Kern hat sie abgewiesen;\n' +
          '         der Grund stuende dann als Journalzeile weiter oben.',
      )
    }
  }

  // ── 3. Nur auf Verlangen: wirklich aufloesen ───────────────────────────
  if (rest) {
    console.log(`\n  aufloesen("${rest}") — das geht WIRKLICH ins Netz:`)
    try {
      const fund = await wirt.aufloesen(kennung, rest, MEDIEN_WURZEL)
      sagen(
        'Fund vom Kern angenommen?',
        `"${fund.titel.name}"${fund.titel.kuenstler ? ` — ${fund.titel.kuenstler}` : ''}\n` +
          `${fund.quelle.art}: ${fund.quelle.adresse}` +
          (fund.titel.dauerSek ? `\nDauer: ${fund.titel.dauerSek} s` : ''),
        true,
      )
    } catch (e) {
      // HIER STEHT DER GANZE GRUND, anders als in der HTTP-Antwort der Box:
      // das ist ein Werkzeug fuer Entwickler, kein Weg nach draussen.
      sagen('Fund vom Kern angenommen?', e.message, false)
    }
  } else if (!ereignisName && !songtextRoh) {
    console.log('\n  (weder --aufloesen noch --ereignis angegeben — es ging kein Netzaufruf hinaus)')
  }

  // ── 3b. Nur auf Verlangen: einen Songtext holen (E84/B2) ───────────────
  //
  // ZEIGT ZAHLEN, NIE DEN TEXT. Songtexte sind urheberrechtlich geschuetzt;
  // dieses Werkzeug misst, ob die Kette traegt, und ist keine Abschrift.
  // Die DAUER ist Teil der Frage, weil sie die Fassung entscheidet — ohne sie
  // liefert eine Quelle wie LRCLIB die Zeitmarken einer fremden Aufnahme
  // (llmwiki `lrclib-fuehrt-dieselbe-nummer-vielfach`).
  if (songtextRoh) {
    const [interpret, titel, dauerText] = String(songtextRoh).split('|')
    const dauerSek = Number(dauerText)
    if (!interpret || !titel || !Number.isFinite(dauerSek) || dauerSek <= 0) {
      sagen('Songtext-Frage brauchbar?', 'Form ist "Interpret|Titel|Dauer in Sekunden".', false)
    } else {
      console.log(`\n  songtext("${interpret} — ${titel}", ${dauerSek} s) — das geht WIRKLICH ins Netz:`)
      try {
        const treffer = await wirt.pluginSongtext({ interpret, titel, dauerSek })
        if (!treffer) {
          // KEIN FEHLSCHLAG DES WERKZEUGS. Fuer Hoerspiele findet sich nichts,
          // und eine leere Anzeige ist genau das gewuenschte Verhalten.
          sagen('Songtext vom Kern angenommen?', 'nichts gefunden — die Anzeige bliebe leer', true)
        } else if (treffer.synchron) {
          const erste = treffer.zeilen[0]
          const letzte = treffer.zeilen[treffer.zeilen.length - 1]
          sagen(
            'Songtext vom Kern angenommen?',
            `SYNCHRON — ${treffer.zeilen.length} Zeilen von "${treffer.kennung}"\n` +
              `erste Marke: ${erste.zeitMs} ms, letzte: ${letzte.zeitMs} ms\n` +
              `(der Text selbst wird hier bewusst nicht ausgegeben)`,
            true,
          )
        } else {
          // UNSYNCHRON IST KEIN HALBER TREFFER, sondern ein anderer: daraus
          // wird eine Leseansicht im Vollbild, keine mitlaufende Anzeige.
          sagen(
            'Songtext vom Kern angenommen?',
            `UNSYNCHRON — ${treffer.absaetze.length} Zeilen von "${treffer.kennung}"\n` +
              `taugt nur zum Lesen im Vollbild, nicht zum Mitlaufen\n` +
              `(der Text selbst wird hier bewusst nicht ausgegeben)`,
            true,
          )
        }
      } catch (e) {
        sagen('Songtext vom Kern angenommen?', e.message, false)
      }
    }
  }

  if (ereignisName) {
    console.log(`\n  ereignis("${ereignisName}") — im echten Worker:`)
    try {
      // Nutzlast wie im Betrieb: die Lautstaerke traegt einen Wert, das Ende
      // der Kinderzeit einen Grund.
      const nutzlast =
        ereignisName === 'lautstaerke'
          ? { wert: 50 }
          : ereignisName === 'kinderzeitEnde'
            ? { grund: 'aufgebraucht' }
            : { verb: 'stop' }
      await wirt.ereignisSenden(kennung, ereignisName, nutzlast)
      sagen('Ereignis angenommen?', `${ereignisName} ohne Fehler verarbeitet`, true)
    } catch (e) {
      sagen('Ereignis angenommen?', e.message, false)
    }
  }
}

await wirt.allesBeenden()
fs.rmSync(lager, { recursive: true, force: true })

console.log(`\n${fehler === 0 ? 'Das Plugin ist brauchbar.' : `${fehler} Beanstandung(en).`}`)
process.exit(fehler === 0 ? 0 : 1)
