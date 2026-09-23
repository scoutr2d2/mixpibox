#!/usr/bin/env node
/**
 * MEDIATHEK-PROBE — faehrt mixpi-mediathek gegen die ECHTE ARD.
 *
 * WOZU, wenn es doch 33 Zeugen gibt: die Zeugen fahren gegen
 * `ard.fixture.json`, also gegen die Antwort VON EINEM TAG. Sie bleiben gruen,
 * wenn die ARD morgen ein Feld umbenennt — genau dann, wenn es darauf ankommt.
 * Diese Probe ist die Gegenfrage dazu: stimmt die Form noch?
 *
 * SIE GEHOERT NICHT IN `doku-luecken-probe.sh` und in keinen anderen Laeufer:
 * sie braucht das Internet und einen fremden Dienst. Eine Wache, die rot wird,
 * weil jemandes WLAN klemmt, lehrt niemanden etwas. Sie wird von Hand
 * gefahren — vor dem Ausliefern, und wenn etwas an der Mediathek klemmt.
 *
 * AUFRUF
 *     node tools/mediathek-probe.mjs
 *     node tools/mediathek-probe.mjs --begriff "Sandmann" --breite 640
 *     node tools/mediathek-probe.mjs --kennung <ARD-Kennung>
 *     node tools/mediathek-probe.mjs --vorlage-erneuern
 *
 * `--vorlage-erneuern` schreibt `plugins/mixpi-mediathek/ard.fixture.json` neu
 * (gekuerzt, wie beim ersten Mal) — danach `node --test` fahren und SEHEN, was
 * rot wird. Das ist der eigentliche Zweck der Probe: sie macht die Alterung
 * der Vorlage sichtbar, statt sie zu verstecken.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = path.join(WURZEL, 'plugins', 'mixpi-mediathek')
const VORLAGE = path.join(PLUGIN, 'ard.fixture.json')

const args = process.argv.slice(2)
function schalter(name, vorgabe = null) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
const begriff = schalter('--begriff', 'Sendung mit der Maus')
const breite = schalter('--breite', '960')
const kennungWunsch = schalter('--kennung', null)
const erneuern = args.includes('--vorlage-erneuern')

/**
 * DER KONTEXT DES WIRTS, nachgebildet — aber ohne die Riegel.
 *
 * Das ist hier richtig und waere im Betrieb falsch: `kontext.holen` des Wirts
 * verwehrt die eigene Box und haelt eine Frist von 8 s. Diese Probe misst die
 * ARD, nicht den Wirt; wer den Wirt messen will, nimmt
 * `tools/plugin-pruefen.mjs --aufloesen`.
 */
const kontext = {
  protokoll: (s) => console.log(`   [plugin] ${s}`),
  einstellungen: Object.freeze({}),
  holen: (adresse, opt) => fetch(adresse, { ...opt, signal: AbortSignal.timeout(15000) }),
}

const plugin = (await import(path.join(PLUGIN, 'index.mjs'))).default
let fehler = 0

function sagen(ok, text) {
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${text}`)
  if (!ok) fehler++
}

console.log(`── mixpi-mediathek gegen die echte ARD (${new Date().toISOString()}) ──`)

/* ── 1. Die Suche ──────────────────────────────────────────────────────── */
const ab = Date.now()
const suche = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { begriff, anzahl: '12' } }, kontext)
const sucheMs = Date.now() - ab
sagen((suche.status ?? 200) === 200, `Suche „${begriff}" -> Status ${suche.status ?? 200}, ${sucheMs} ms`)
const treffer = suche.inhalt?.treffer ?? []
sagen(treffer.length > 0, `${treffer.length} Treffer nach dem Aussortieren der Nebenfassungen`)
for (const t of treffer.slice(0, 5)) {
  const dauer = t.dauerSek ? `${Math.round(t.dauerSek / 60)} min` : 'ohne Dauer'
  console.log(`        ${t.kinderinhalt ? 'Kind' : '    '}  ${t.name} — ${t.sendung || 'ohne Sendung'} (${dauer})`)
}
sagen(
  treffer.every((t) => !/\((?:Audiodeskription|mit Gebärdensprache)\)$/i.test(t.name)),
  'keine Nebenfassung in der Liste',
)
sagen(
  treffer.every((t) => !t.bild || (t.bild.startsWith('https://') && !t.bild.includes('{width}'))),
  'alle Bildadressen aufgeloest (kein {width})',
)

/* ── 2. Die Aufloesung ─────────────────────────────────────────────────── */
const kennung = kennungWunsch ?? treffer[0]?.kennung
let seiteRoh = null
if (!kennung) {
  sagen(false, 'keine Kennung zum Aufloesen — die Suche hat nichts geliefert')
} else {
  const ab2 = Date.now()
  const video = await plugin.http({ methode: 'GET', pfad: `video/${kennung}`, abfrage: { breite } }, kontext)
  const ms2 = Date.now() - ab2
  sagen((video.status ?? 200) === 200, `Aufloesen -> Status ${video.status ?? 200}, ${ms2} ms`)
  const v = video.inhalt ?? {}
  if (v.ok) {
    console.log(`        ${v.name} — ${v.sendung || 'ohne Sendung'}`)
    console.log(`        ${v.quelle.stufe} ${v.quelle.breite}x${v.quelle.hoehe}`)
    console.log(`        ${v.quelle.adresse}`)
    sagen(v.quelle.adresse.endsWith('.mp4'), 'progressive MP4 (kein HLS — Chromium kann es sonst nicht)')
    sagen(v.quelle.breite <= Number(breite), `Breite ${v.quelle.breite} haelt den Deckel ${breite}`)

    /* ── 3. Liegt die Datei wirklich da? ─────────────────────────────────
     * HTTP 200 auf die Seite heisst nicht, dass die Adresse traegt. Ein
     * HEAD kostet nichts und beantwortet die Frage, die man wirklich hat. */
    try {
      const kopf = await fetch(v.quelle.adresse, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
      const groesse = Number(kopf.headers.get('content-length') ?? 0)
      sagen(
        kopf.ok && /video\//.test(kopf.headers.get('content-type') ?? ''),
        `Datei erreichbar: ${kopf.status} ${kopf.headers.get('content-type')} ${(groesse / 1048576).toFixed(1)} MB`,
      )
      if (v.dauerSek && groesse) {
        console.log(`        rund ${Math.round((groesse * 8) / v.dauerSek / 1000)} kbit/s`)
      }
    } catch (f) {
      sagen(false, `Datei nicht erreichbar: ${f.message}`)
    }
  } else {
    sagen(false, `Aufloesen meldet: ${v.grund ?? v.fehler}`)
  }

  if (erneuern) {
    const p = new URLSearchParams({ embedded: 'false', mcV6: 'true' })
    seiteRoh = await (
      await fetch(`https://api.ardmediathek.de/page-gateway/pages/ard/item/${encodeURIComponent(kennung)}?${p}`)
    ).json()
  }
}

/* ── 4. Die Vorlage erneuern ───────────────────────────────────────────── */
if (erneuern) {
  const p = new URLSearchParams({ searchString: begriff, pageSize: '3', platform: 'web' })
  const sucheRoh = await (
    await fetch(`https://api.ardmediathek.de/page-gateway/widgets/ard/search/vod?${p}`)
  ).json()
  const w = seiteRoh?.widgets?.[0]
  const mc = w?.mediaCollection?.embedded
  if (!mc) {
    sagen(false, 'Vorlage nicht erneuert — die Werkseite hatte keine mediaCollection')
  } else {
    const teaser = (sucheRoh.teasers ?? []).map((t) => {
      const raus = {}
      for (const k of [
        'id',
        'longTitle',
        'shortTitle',
        'title',
        'duration',
        'broadcastedOn',
        'availableTo',
        'coreAssetType',
        'isChildContent',
        'maturityContentRating',
      ]) {
        if (k in t) raus[k] = t[k]
      }
      if (t.show) raus.show = { id: t.show.id, title: t.show.title }
      if (t.images) {
        raus.images = {}
        for (const [k, v] of Object.entries(t.images).slice(0, 2)) raus.images[k] = { src: v.src, title: v.title ?? '' }
      }
      return raus
    })
    const neu = {
      suche: { teasers: teaser, pagination: sucheRoh.pagination ?? null },
      seite: {
        id: seiteRoh.id,
        title: seiteRoh.title,
        isChildContent: seiteRoh.isChildContent,
        fskRating: seiteRoh.fskRating,
        targetAudienceAgeMin: seiteRoh.targetAudienceAgeMin,
        targetAudienceAgeMax: seiteRoh.targetAudienceAgeMax,
        widgets: [
          {
            id: w.id,
            title: w.title,
            synopsis: w.synopsis,
            broadcastedOn: w.broadcastedOn,
            availableTo: w.availableTo,
            geoblocked: w.geoblocked,
            blockedByFsk: w.blockedByFsk,
            blockedByLoginOnly: w.blockedByLoginOnly,
            maturityContentRating: w.maturityContentRating,
            image: w.image ? { src: w.image.src, title: w.image.title ?? '' } : null,
            show: w.show ? { id: w.show.id, title: w.show.title } : {},
            mediaCollection: {
              embedded: {
                isGeoBlocked: mc.isGeoBlocked,
                meta: {
                  title: mc.meta?.title,
                  synopsis: mc.meta?.synopsis,
                  durationSeconds: mc.meta?.durationSeconds,
                  seriesTitle: mc.meta?.seriesTitle,
                },
                streams: mc.streams,
              },
            },
          },
        ],
      },
    }
    writeFileSync(VORLAGE, `${JSON.stringify(neu, null, 1)}\n`)
    console.log(`\n  Vorlage erneuert: ${path.relative(WURZEL, VORLAGE)}`)
    console.log('  JETZT `node --test plugins/mixpi-mediathek/index.spec.mjs` fahren und hinsehen, was rot wird.')
  }
}

console.log(fehler === 0 ? '\nKEINE LUECKE.' : `\n${fehler} Befund(e).`)
process.exit(fehler === 0 ? 0 : 1)
