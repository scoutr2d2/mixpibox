#!/usr/bin/env node
/*
 * FRAGT NACH: Bleibt beim Kindwechsel („wer hoert", oben links) wirklich jedes
 * Kind bei SEINEN gemerkten Stellen?
 *
 * WARUM ES DAS WERKZEUG GIBT. Die Behauptung lautet: „Wer gerade an der Box ist
 * ist je Profil, und die Umschaltung greift bis auf die Platte." Der erste Teil
 * stimmt (profile.json, Feld `aktiv`), der zweite auch — nur greift sie an einer
 * Stelle auf die FALSCHE Platte, naemlich auf den Bestand des Kindes, zu dem
 * gerade umgeschaltet wird.
 *
 * DIE KETTE, jede Stufe am Geraet nachgesehen (08.08.2026, 192.168.178.169):
 *
 *   1. `server/config/resume.json` ist ein VERWEIS auf
 *      `profile/<aktiv>/resume.json` (`ls -la` an der Box: -> profile/gast/…).
 *   2. `/usr/local/bin/mupibox/clearresume.sh` Zeile 19 legt sein Ergebnis mit
 *      `mv ${DATA}.tmp ${DATA}` UEBER den Verweis. Danach liegt am alten Ort
 *      eine GEWOEHNLICHE DATEI mit dem Bestand des Kindes, das gerade dran war.
 *      (`remove_max_resume.sh` wurde genau dafuer schon auf `cat > ${datei}`
 *      umgestellt — clearresume.sh nicht.)
 *   3. `POST /api/profil/aktiv` setzt im ausgelieferten Bundle ERST die neue
 *      Kennung und richtet DANACH die Bruecke:
 *        K={...K,aktiv:n},Pt=0,xc(),yc()
 *      `xc()` (resumeBrueckeRichten) liest die Kennung selbst — also schon die
 *      NEUE — und holt die echte Datei mit `PF()` (resumeUebernehmen) in den
 *      Ordner des NEUEN Kindes.
 *
 * WAS DIESES WERKZEUG TUT: Es baut die Lage in einem Sandkasten nach und faehrt
 * `xc()`/`PF()` als woertliche Abschrift des ausgelieferten Bundles
 * (~/.mupibox/Sonos-Kids-Controller-master/server.js) darueber. Es fasst WEDER
 * die Box an NOCH irgendeine echte Konfiguration — alles passiert unter
 * `mktemp -d`.
 *
 * AUFRUF:  node tools/wer-hoert-wechsel-fremde-stellen.mjs
 * ERGEBNIS: Rueckgabewert 1, wenn der Wechsel dem neuen Kind seine Stellen
 *           nimmt (heutiger Stand), 0 wenn nicht.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const GAST = 'gast'
const BEREICH_ORDNER = 'profile'
const ABLAGE_RESUME = 'resume.json'

/** Eine gemerkte Stelle in der Form, in der sie in resume.json steht. */
const stelle = (id, kategorie = 'resume') => ({
  type: 'spotify',
  category: kategorie,
  id,
  title: id,
  index: 1,
  resumespotifyprogressMs: 12345,
})

// ── Woertliche Abschrift aus dem ausgelieferten Bundle ──────────────────────
// server.js: function xc(){let t=re(),e=_F(t),n=`${W}/${e}`,r=null; …
// Nur die Namen sind ausgeschrieben; die Reihenfolge ist unveraendert.
function bruecke(W, aktiv) {
  const rn = `${W}/${ABLAGE_RESUME}`
  const zielRel = `${BEREICH_ORDNER}/${aktiv || GAST}/${ABLAGE_RESUME}`
  const ziel = `${W}/${zielRel}`
  let stand = null
  try {
    stand = fs.lstatSync(rn)
  } catch {
    stand = null
  }
  if (stand?.isSymbolicLink()) {
    try {
      if (fs.readlinkSync(rn) === zielRel) return
    } catch {
      /* nicht lesbar: neu legen */
    }
  }
  fs.mkdirSync(path.dirname(ziel), { recursive: true })
  try {
    if (stand?.isFile()) uebernehmen(rn, ziel)
    const zwischen = `${rn}.bruecke`
    fs.rmSync(zwischen, { force: true })
    fs.symlinkSync(zielRel, zwischen)
    fs.renameSync(zwischen, rn)
  } catch (e) {
    console.warn('Bruecke nicht gelegt:', e?.message)
  }
}

// server.js: function PF(t){let e=`${t}.uebernommen`; …
function uebernehmen(rn, ziel) {
  const zwischen = `${ziel}.uebernommen`
  fs.rmSync(zwischen, { force: true })
  fs.linkSync(rn, zwischen)
  try {
    if (leereListe(zwischen) && !leereListe(ziel)) fs.renameSync(ziel, `${ziel}.vorher`)
  } catch {
    /* kein Bestand zum Aufheben */
  }
  fs.renameSync(zwischen, ziel)
}

function leereListe(pfad) {
  try {
    const roh = JSON.parse(fs.readFileSync(pfad, 'utf8'))
    return Array.isArray(roh) && roh.length === 0
  } catch {
    return false
  }
}

// ── Die Skriptstufe — AUS DEM SKRIPT GELESEN, nicht nachgebaut ─────────────
//
// HIER STAND EINE ABSCHRIFT mit festem `renameSync`. Das war bis zum
// 19.09.2026 richtig und ab da falsch: Die Abschrift hielt den Fehler fest,
// den sie melden sollte, und konnte seine Behebung nicht bemerken. Eine
// Wache, die ihren Gegenstand NACHBILDET statt ihn zu LESEN, misst am Ende
// nur noch sich selbst.
//
// GELESEN WIRD DAS ECHTE SKRIPT, und zwar auf die SORTE des Schreibwegs:
//   `cat > ${DATA}`   folgt dem Verweis  -> der Ordner des Kindes bleibt
//   `mv …  ${DATA}`   ersetzt ihn        -> das naechste Kind erbt fremdes
// Fehlt das Skript, bricht die Wache ab statt gruen zu sagen.
const SKRIPT = new URL('../scripts/mupibox/clearresume.sh', import.meta.url)

function schreibwegAusSkript() {
  let text
  try {
    text = fs.readFileSync(SKRIPT, 'utf8')
  } catch {
    console.error(`ABBRUCH: ${SKRIPT.pathname} fehlt — ohne Gegenstand ist diese Wache blind.`)
    process.exit(2)
  }
  const ohneKommentar = text
    .split('\n')
    .filter((z) => !z.trim().startsWith('#'))
    .join('\n')
  const folgtDemVerweis = /cat\s+\S*\.tmp\s*>\s*\$\{?DATA\}?/.test(ohneKommentar)
  const ersetztDenVerweis = /\bmv\s+\S*\.tmp\s+\$\{?DATA\}?/.test(ohneKommentar)
  if (folgtDemVerweis === ersetztDenVerweis) {
    console.error('ABBRUCH: im Skript ist weder genau ein `cat >`- noch genau ein `mv`-Weg zu erkennen.')
    console.error('Was zu tun ist: scripts/mupibox/clearresume.sh ansehen und diese Wache nachziehen.')
    process.exit(2)
  }
  return folgtDemVerweis ? 'cat' : 'mv'
}

const SCHREIBWEG = schreibwegAusSkript()

function clearresumeSh(datei) {
  const raus = execFileSync('jq', ['map(select(.category != "resume"))', datei], { encoding: 'utf8' })
  fs.writeFileSync(`${datei}.tmp`, raus)
  if (SCHREIBWEG === 'cat') {
    fs.writeFileSync(datei, raus) // folgt dem Verweis — der Ordner des Kindes bleibt
    fs.rmSync(`${datei}.tmp`, { force: true })
  } else {
    fs.renameSync(`${datei}.tmp`, datei) // ersetzt den VERWEIS durch eine Datei
  }
}

function ids(pfad) {
  try {
    return JSON.parse(fs.readFileSync(pfad, 'utf8')).map((e) => e.id)
  } catch {
    return null
  }
}

function lauf(name, gastListe) {
  const W = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-wechsel-'))
  const kaleaListe = [stelle('KALEA-1'), stelle('KALEA-2')]
  for (const k of ['gast', 'kalea']) fs.mkdirSync(`${W}/${BEREICH_ORDNER}/${k}`, { recursive: true })
  fs.writeFileSync(`${W}/${BEREICH_ORDNER}/gast/${ABLAGE_RESUME}`, JSON.stringify(gastListe, null, 2))
  fs.writeFileSync(`${W}/${BEREICH_ORDNER}/kalea/${ABLAGE_RESUME}`, JSON.stringify(kaleaListe, null, 2))
  fs.symlinkSync(`${BEREICH_ORDNER}/gast/${ABLAGE_RESUME}`, `${W}/${ABLAGE_RESUME}`)

  console.log(`\n── ${name} ──`)
  console.log('  vorher  gast :', ids(`${W}/${BEREICH_ORDNER}/gast/${ABLAGE_RESUME}`))
  console.log('  vorher  kalea:', ids(`${W}/${BEREICH_ORDNER}/kalea/${ABLAGE_RESUME}`))

  // 1. Ein Erwachsener raeumt am KLASSISCHEN Player auf („Clear all resume media").
  clearresumeSh(`${W}/${ABLAGE_RESUME}`)
  console.log('  nach clearresume.sh: alter Ort ist', fs.lstatSync(`${W}/${ABLAGE_RESUME}`).isSymbolicLink() ? 'Verweis' : 'ECHTE DATEI')

  // 2. Jemand tippt oben links auf Kalea. Das Bundle setzt ERST `aktiv`, dann die Bruecke.
  bruecke(W, 'kalea')

  const nachher = ids(`${W}/${BEREICH_ORDNER}/kalea/${ABLAGE_RESUME}`)
  const vorherDa = fs.existsSync(`${W}/${BEREICH_ORDNER}/kalea/${ABLAGE_RESUME}.vorher`)
  console.log('  nachher kalea:', nachher, vorherDa ? '(ihr Bestand liegt als .vorher daneben)' : '')
  const heil = JSON.stringify(nachher) === JSON.stringify(kaleaListe.map((e) => e.id))
  console.log(heil ? '  → Kalea hat ihre Stellen behalten.' : '  → KALEA HAT IHRE STELLEN VERLOREN.')
  fs.rmSync(W, { recursive: true, force: true })
  return heil
}

// Fall A: auf dieser Box tragen ALLE Eintraege `category: "resume"` → clearresume
//         hinterlaesst `[]`.
const a = lauf('A · alle Eintraege sind resume (Stand dieser Box)', [stelle('GAST-1'), stelle('GAST-2')])
// Fall B: eine gemischte Liste → clearresume hinterlaesst eine VOLLE Fremddatei.
const b = lauf('B · gemischte Liste (ein Eintrag ohne category resume)', [
  stelle('GAST-1'),
  stelle('GAST-FREMD', 'audiobook'),
])

console.log(`\nErgebnis: ${a && b ? 'je Profil getrennt' : 'NICHT je Profil getrennt'}`)
process.exit(a && b ? 0 : 1)
