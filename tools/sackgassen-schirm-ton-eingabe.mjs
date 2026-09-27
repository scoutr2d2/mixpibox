#!/usr/bin/env node
/**
 * SACKGASSEN-SUCHE: Schirm, Ton, Eingabe.
 *
 * EINE SACKGASSE IST: eine Bedienung, die ein Elternteil vornehmen kann und
 * aus der es AM GERAET nicht zurueckkommt. Ein Rueckweg ueber SSH zaehlt
 * nicht; ein Rueckweg ueber die Verwaltung auf einem zweiten Geraet im selben
 * Netz zaehlt halb.
 *
 * Das Vorbild ist die 0 in der Bildschirmhelligkeit: der Regler nimmt sich
 * selbst die Sichtbarkeit, mit der man ihn zurueckziehen koennte. Gesucht wird
 * dasselbe Muster anderswo.
 *
 * WAS DIESER LAUF TUT — nichts an einer Box, nichts an dieser Maschine:
 *   1. Er startet einen EIGENEN Serverprozess auf einem EIGENEN Port mit
 *      einer nachgestellten Konfiguration in einem Ordner unter /tmp und
 *      fragt: welche Werte nimmt `POST /api/konfiguration` an, obwohl sie die
 *      Box unbedienbar machen? Die Frage ist nicht "ist es gueltig", sondern
 *      "gibt es danach noch einen Weg zurueck".
 *   2. Er spielt die Entscheidungslogik der beiden Schaltskripte nach
 *      (idle_shutdown.sh, off_trigger.sh) — mit Stellvertretern statt echtem
 *      Abschalten, und in Sekundenbruchteilen statt in Minuten.
 *
 * FAHREN:
 *   node tools/sackgassen-schirm-ton-eingabe.mjs
 *   node tools/sackgassen-schirm-ton-eingabe.mjs --port 9962
 *
 * Rueckgabewert 0 = keine der gesuchten Sackgassen offen,
 *                1 = mindestens eine steht offen (Text sagt welche),
 *                2 = ABBRUCH: ein Gegenstand dieser Messung ist nicht mehr da.
 *
 * WARUM ES DIE 2 GIBT (19.09.2026): Fall 2 las bis heute
 * `src/frontend-box/src/app/display-manager.service.ts`. Die Datei ist am
 * 05.09.2026 mit der alten Oberflaeche gefallen (6281ac5c), und dieses
 * Werkzeug STUERZTE seither mit ENOENT ab — mitten im Lauf, nach Fall 1, vor
 * den Faellen 3 bis 5. Ein Absturz ist das schlechteste von drei schlechten
 * Enden: gruen luegt, dauerrot verdeckt den naechsten Fund, ein Stapelabzug
 * sagt niemandem, was zu tun ist. Wer hier einen Gegenstand verliert, bricht
 * darum mit ANLEITUNG ab (`pflicht()` unten).
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')

const args = process.argv.slice(2)
const wert = (name, vorgabe) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
const PORT = Number(wert('--port', '9962'))

let offen = 0
let zu = 0

/**
 * `sackgasse` ist WAHR, wenn der Weg hinein offen steht UND kein Weg zurueck
 * am Geraet existiert. Der Text nennt beides, sonst ist der Befund nicht
 * nachvollziehbar.
 */
function befund(name, istSackgasse, beleg) {
  if (istSackgasse) {
    offen++
    console.log(`  SACKGASSE  ${name}`)
  } else {
    zu++
    console.log(`  zu         ${name}`)
  }
  if (beleg !== undefined) console.log(`             ${typeof beleg === 'string' ? beleg : JSON.stringify(beleg)}`)
}

const schlafen = (ms) => new Promise((f) => setTimeout(f, ms))

/**
 * DER GEGENSTAND IST WEG — und das ist kein Befund, sondern ein Abbruch.
 *
 * Eine Wache, deren Messgegenstand verschwindet, darf weder gruen noch rot
 * sagen: beides waere ein Urteil ueber etwas, das sie nicht mehr sieht. Sie
 * sagt, WAS fehlte und WO die Frage jetzt haengen koennte — und endet mit 2.
 */
class OhneGegenstand extends Error {}

function pflicht(pfad, anleitung) {
  try {
    return readFileSync(pfad, 'utf8')
  } catch (f) {
    const fehler = new OhneGegenstand(`${pfad.replace(`${WURZEL}/`, '')} (${f.code ?? f.message})`)
    fehler.anleitung = anleitung
    throw fehler
  }
}

// ══ TEIL 1: DIE KONFIGURATION GEGEN EINEN ECHTEN SERVER ═════════════════════

const ordner = mkdtempSync(join(tmpdir(), 'mupi-sackgassen-'))
const konfigPfad = join(ordner, 'mupiboxconfig.json')
const wurzelBacklight = join(ordner, 'backlight')
mkdirSync(join(wurzelBacklight, '11-0045'), { recursive: true })
writeFileSync(join(wurzelBacklight, '11-0045', 'brightness'), '255\n')
writeFileSync(join(wurzelBacklight, '11-0045', 'max_brightness'), '255\n')
writeFileSync(join(wurzelBacklight, '11-0045', 'bl_power'), '0\n')

const vorlage = JSON.parse(readFileSync(join(WURZEL, 'config', 'templates', 'mupiboxconfig.json'), 'utf8'))
writeFileSync(konfigPfad, JSON.stringify(vorlage, null, 4))
const konfig = () => JSON.parse(readFileSync(konfigPfad, 'utf8'))

console.log(`Buehne:  ${ordner}`)
console.log(`Server:  http://127.0.0.1:${PORT}   (eigener Port, stoert keine laufende Vorschau)\n`)

const kind = spawn('npx', ['tsx', 'src/server.ts'], {
  cwd: BACKEND,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    MUPIBOX_HTTP_PORT: String(PORT),
    MUPIBOX_BACKLIGHT: wurzelBacklight,
    MUPIBOX_CONFIG: konfigPfad,
    MUPIBOX_CONFIG_DIR: ordner,
    MUPIBOX_LOCK_DIR: ordner,
    MUPIBOX_TLS_DIR: join(ordner, 'tls'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const mitschrift = []
kind.stdout.on('data', (d) => mitschrift.push(String(d)))
kind.stderr.on('data', (d) => mitschrift.push(String(d)))

const basis = `http://127.0.0.1:${PORT}`
let fertig = false
async function aufraeumen(code) {
  if (fertig) return
  fertig = true
  kind.kill('SIGTERM')
  await schlafen(300)
  kind.kill('SIGKILL')
  rmSync(ordner, { recursive: true, force: true })
  process.exit(code)
}

async function warten(sekunden = 60) {
  for (let i = 0; i < sekunden * 10; i++) {
    try {
      if ((await fetch(`${basis}/api/konfiguration`)).ok) return true
    } catch {
      /* noch nicht da */
    }
    await schlafen(100)
  }
  return false
}

/** Eine Aenderung ueber den Weg der Verwaltung. Gibt Status und Antwort. */
async function setzen(aenderungen) {
  const a = await fetch(`${basis}/api/konfiguration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aenderungen }),
  })
  return { status: a.status, koerper: await a.json().catch(() => null) }
}

try {
  if (!(await warten())) {
    console.log('Der Server ist nicht hochgekommen. Mitschrift:')
    console.log(mitschrift.join('').slice(-3000))
    await aufraeumen(1)
  }

  // ── 1. TON: die Box stummschalten, so dass sie sich nicht mehr aufdrehen laesst
  //
  // `maxVolume` ist die Obergrenze, die JEDER Weg zur Lautstaerke liest
  // (mupi-lautstaerke.sh, der Regler der Oberflaeche setzt sein `max` daraus).
  // Steht sie auf 0, gibt es am Geraet keinen Regler mehr, der ueber 0 kaeme —
  // und `maxVolume` selbst steht in KEINER Oberflaeche der Box, nur in der
  // Verwaltung.
  console.log('1. TON — Hoechstlautstaerke ganz nach unten')

  /**
   * Was `mupi-lautstaerke.sh` aus einem `maxVolume` WIRKLICH macht.
   *
   * Die beiden Funktionen werden aus der ausgelieferten Datei herausgeloest
   * und unveraendert ausgefuehrt — kein Nachbau, und ohne `set`/`up`/`down`
   * anzufassen, die die Lautstaerke dieser Maschine verstellen wuerden.
   */
  function klemmenLassen(maxVolume, wunsch) {
    const skript = readFileSync(join(WURZEL, 'scripts', 'mupibox', 'mupi-lautstaerke.sh'), 'utf8')
    const stueck = (name) => {
      const i = skript.indexOf(`${name}() {`)
      const j = skript.indexOf('\n}\n', i)
      return skript.slice(i, j + 3)
    }
    const stubKonfig = join(ordner, `laut-${maxVolume}.json`)
    writeFileSync(stubKonfig, JSON.stringify({ mupibox: { maxVolume: String(maxVolume) } }))
    const r = spawnSync(
      'bash',
      [
        '-c',
        `KONFIG=${JSON.stringify(stubKonfig)}\n${stueck('hoechstwert')}\n${stueck('klemme')}\nklemme ${wunsch}`,
      ],
      { encoding: 'utf8' },
    )
    return r.stdout.trim()
  }

  const beiNull = klemmenLassen(0, 100)
  const beiEins = klemmenLassen(1, 100)
  befund(
    'maxVolume 0 macht die Box stumm',
    beiNull === '0',
    `„voll aufdrehen" bei maxVolume=0 ergibt ${beiNull} % — die 0 wird als „keine Angabe" gelesen ` +
      `(mupi-lautstaerke.sh: [ "$h" -lt 1 ] && h=100), die neue Oberflaeche ebenso (m > 0). Die 0 ist DICHT.`,
  )
  const einsSetzbar = (await setzen({ startLautstaerke: 1, maxLautstaerke: 1 })).status
  befund(
    'maxVolume 1 wird angenommen -> Box praktisch stumm, und der Wert steht in KEINER Oberflaeche der Box',
    einsSetzbar === 200 && beiEins === '1',
    `POST: ${einsSetzbar} | „voll aufdrehen" bei maxVolume=1 ergibt ${beiEins} % | ` +
      `maxVolume danach: ${JSON.stringify(konfig().mupibox.maxVolume)}`,
  )

  // Zurueck, damit die naechsten Proben von einem heilen Stand ausgehen.
  await setzen({ maxLautstaerke: 100, startLautstaerke: 40 })

  // ── 2. SCHIRM: „Bildschirm aus nach 0 Minuten"
  //
  // Der Hinweis des Feldes sagt „0 = Bildschirm bleibt an."
  //
  // UMGEHAENGT AM 19.09.2026, weil die Frage den Ort gewechselt hat und nicht
  // gestorben ist: Bis zum E118-Umzug las die ALTE Oberflaeche den Wert selbst
  // und machte in display-manager.service.ts:30 aus der 0 die KUERZESTE Frist
  // (`timeout > 0 ? timeout : 1`). Jene Datei ist am 05.09.2026 mit der alten
  // Oberflaeche gefallen (6281ac5c). Den Wert traegt heute
  // `scripts/mupibox/setting_update.sh` in `Option "BlankTime"` der
  // X-Einstellung (/etc/X11/xorg.conf.d/98-dietpi-disable_dpms.conf) — dort
  // heisst 0 „gar nicht abschalten", und die Zusage des Feldes stimmt. Der
  // Baum nennt diese Stelle selbst als die Zahl, „aus der auch die
  // Bildschirmabschaltung entsteht" (scripts/mupibox/idle_shutdown.sh:65).
  //
  // SACKGASSE IST ALSO HEUTE: die 0 wird angenommen, kommt aber NICHT
  // unveraendert dort an — weil jemand sie unterwegs anhebt (ein Riegel wie
  // `[ "$timeout" -lt 1 ] && timeout=1`), weil die Schreibzeile den gelesenen
  // Wert gar nicht uebernimmt, oder weil die Vorlage die Zeile nicht mehr
  // traegt, in die geschrieben wird. Aus jedem dieser drei Faelle wird aus
  // „nie" wieder eine Frist, und zurueck kommt man am Geraet nicht.
  console.log('\n2. SCHIRM — „Bildschirm aus nach 0 Minuten"')
  const aus0 = await setzen({ bildschirmAusNach: 0 })
  const SCHIRM_ANLEITUNG =
    '  Die Frage lautet: kommt „0" unveraendert in der X-Einstellung an?\n' +
    '  Sie hing bis 05.09.2026 an der alten Oberflaeche, seither an\n' +
    '  scripts/mupibox/setting_update.sh -> Option "BlankTime" in\n' +
    '  config/templates/98-dietpi-disable_dpms.conf.\n' +
    '  Wandert sie erneut, diesen Fall mitnehmen — oder ihn faellen und\n' +
    '  im Kopf dieser Datei sagen, welche Frage damit niemand mehr stellt.'
  const einstellskript = pflicht(join(WURZEL, 'scripts', 'mupibox', 'setting_update.sh'), SCHIRM_ANLEITUNG)
  const xvorlage = pflicht(
    join(WURZEL, 'config', 'templates', '98-dietpi-disable_dpms.conf'),
    SCHIRM_ANLEITUNG,
  )
  const skriptzeilen = einstellskript.split('\n')
  const liest = skriptzeilen.findIndex((z) => z.includes('idleDisplayOff') && /=\s*\$\(/.test(z))
  const schreibt = skriptzeilen.findIndex((z) => /Option\s*\\?"BlankTime/.test(z) && /sed|tee|printf|echo/.test(z))
  if (liest < 0 || schreibt < 0 || schreibt < liest) {
    const fehlt = new OhneGegenstand(
      `setting_update.sh liest/schreibt idleDisplayOff nicht mehr erkennbar (lesen: ${liest + 1}, schreiben: ${schreibt + 1})`,
    )
    fehlt.anleitung = SCHIRM_ANLEITUNG
    throw fehlt
  }
  const wertname = skriptzeilen[liest].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=/)?.[1] ?? 'timeout'
  const angetastet = skriptzeilen
    .slice(liest + 1, schreibt)
    .filter((z) => !z.trim().startsWith('#') && new RegExp(`(^|[^A-Za-z0-9_])${wertname}=`).test(z))
  const uebernimmt = new RegExp(`\\$\\{?${wertname}\\}?`).test(skriptzeilen[schreibt])
  const vorlageTraegtZiel = /Option\s+"BlankTime"/.test(xvorlage)
  befund(
    '0 wird angenommen UND kommt nicht als „nie" in der X-Einstellung an',
    aus0.status === 200 && (angetastet.length > 0 || !uebernimmt || !vorlageTraegtZiel),
    `POST: ${aus0.status} | idleDisplayOff danach: ${JSON.stringify(konfig().timeout.idleDisplayOff)} | ` +
      `setting_update.sh: ${wertname} gelesen in Zeile ${liest + 1}, in Option "BlankTime" geschrieben in Zeile ${schreibt + 1}` +
      (angetastet.length
        ? `, unterwegs ANGEHOBEN: ${angetastet.map((z) => z.trim()).join(' / ')}`
        : ', unterwegs unangetastet') +
      ` | Schreibzeile nimmt $${wertname}: ${uebernimmt} | Vorlage traegt Option "BlankTime": ${vorlageTraegtZiel}`,
  )
  await setzen({ bildschirmAusNach: 10 })

  // ── 3. EINGABE: Haltedauer der Taste auf 0
  //
  // Bei 0 laeuft die alte Halteschleife KEIN einziges Mal — `button_held`
  // bleibt wahr, und der kuerzeste Druck schaltet die Box ab.
  //
  // STAND 07.08.2026: `off_trigger.sh` hebt 0 und 1 inzwischen selbst auf 2
  // an (`PRESS_DELAY_MIN`, nachgemessen in tools/ausschalter-sandkasten.py),
  // die Sackgasse ist am Geraet also zu. Was dieser Fall misst, ist die
  // Stelle DAVOR: `konfiguration.ts` nimmt fuer `druckdauer` weiterhin
  // `min: 0` an — die Verwaltung bietet also einen Wert an, den die Box
  // hinterher stillschweigend korrigiert. Solange das so ist, sagt die
  // Oberflaeche etwas anderes als das Geraet tut, und der Befund bleibt.
  console.log('\n3. EINGABE — Haltedauer der Einschalttaste auf 0')
  const halt0 = await setzen({ druckdauer: 0 })
  const schleife = spawnSync(
    'bash',
    ['-c', 'PRESS_DELAY=0; n=0; for ((i=0; i<PRESS_DELAY; i++)); do n=$((n+1)); done; echo $n'],
    { encoding: 'utf8' },
  )
  const nieGeprueft = schleife.stdout.trim() === '0'
  befund(
    '0 wird angenommen UND die Halteschleife prueft dann gar nicht mehr -> Abschalten beim kuerzesten Druck',
    halt0.status === 200 && nieGeprueft,
    `POST: ${halt0.status} | pressDelay danach: ${JSON.stringify(konfig().timeout.pressDelay)} | ` +
      `Durchlaeufe der Halteschleife bei 0: ${schleife.stdout.trim()}`,
  )
  await setzen({ druckdauer: 2 })

  // ── 4. SCHIRM/EINGABE: „Ausschalten nach 1 Minute Nichtstun"
  //
  // Das Feld heisst „Nichtstun". Gezaehlt wird in idle_shutdown.sh aber NUR,
  // ob gerade etwas SPIELT (/tmp/playerstate). Beruehrungen, Blaettern,
  // Einstellen — nichts davon setzt den Zaehler zurueck.
  console.log('\n4. SCHIRM/EINGABE — „Ausschalten nach … Minuten Nichtstun"')
  const eineMinute = await setzen({ ausschaltenNach: 1 })
  const skript = readFileSync(join(WURZEL, 'scripts', 'mupibox', 'idle_shutdown.sh'), 'utf8')
  // Der Zaehler kennt EINE Quelle. Waere „Nichtstun" gemeint, muesste hier
  // irgendetwas ueber Eingaben stehen — X-Leerlauf, /dev/input, ein Zeitstempel
  // der Oberflaeche. Steht nichts davon drin, heisst „Nichtstun" in Wahrheit
  // „es spielt gerade nichts".
  const kenntEingabe = ['xset', '/dev/input', 'evtest', 'DISPLAY', 'xprintidle', 'lastactivity'].filter((w) =>
    skript.includes(w),
  )
  const nurPlayerstate = skript.includes('${PLAYERSTATE}') && kenntEingabe.length === 0
  befund(
    '1 Minute wird angenommen UND gezaehlt wird nur „es spielt nichts", nicht „niemand fasst die Box an"',
    eineMinute.status === 200 && nurPlayerstate,
    `POST: ${eineMinute.status} | idlePiShutdown danach: ${JSON.stringify(konfig().timeout.idlePiShutdown)} | ` +
      `idle_shutdown.sh kennt nur /tmp/playerstate: ${nurPlayerstate}`,
  )

  // Und die Zeitrechnung nachgespielt: 10-Sekunden-Takt, idle = Zaehler/6.
  const takte = []
  let zaehler = 0
  for (let t = 1; t <= 8; t++) {
    zaehler++
    takte.push({ takt: t, sekunden: t * 10, idleMinuten: Math.floor(zaehler / 6) })
  }
  const erster = takte.find((x) => x.idleMinuten >= 1)
  befund(
    'bei „1" faellt die Entscheidung nach 60 Sekunden — auch wenn jemand die ganze Zeit tippt',
    erster?.sekunden === 60,
    `erster Takt mit idle>=1: ${JSON.stringify(erster)}`,
  )

  // Und der Rueckweg AM GERAET: gibt es diesen Wert irgendwo auf dem Schirm
  // der Box? Nur die Verwaltung kennt ihn, und die laeuft auf einem zweiten
  // Geraet.
  //
  // NUR NOCH EINE OBERFLAECHE, und das ist nicht Bequemlichkeit: bis zum
  // 19.09.2026 stand hier auch `src/frontend-box/src` — die alte App, die am
  // 05.09.2026 gefallen ist. Ein `grep -rl` ueber einen Ordner, der bis auf
  // zwei Nachzuegler leer ist, findet nie etwas und macht diese Zeile GRUEN
  // OHNE GEGENSTAND. Das ist schlimmer als gar keine Zeile.
  const OBERFLAECHE = join(WURZEL, 'NewDesign', 'app.js')
  pflicht(
    OBERFLAECHE,
    '  Die Frage lautet: kennt die Oberflaeche der BOX den Wert idlePiShutdown,\n' +
      '  gibt es also am Geraet einen Rueckweg? Zieht die Oberflaeche um, diesen\n' +
      '  Pfad mitziehen — eine Suche ins Leere antwortet immer „kein Rueckweg".',
  )
  const amGeraet = []
  for (const [name, pfad] of [['neue Oberflaeche', OBERFLAECHE]]) {
    const r = spawnSync('grep', ['-rl', 'idlePiShutdown', pfad], { encoding: 'utf8' })
    const treffer = r.stdout.split('\n').filter((z) => z && !z.endsWith('mupibox-config.model.ts'))
    if (treffer.length) amGeraet.push(`${name}: ${treffer.join(', ')}`)
  }
  befund(
    'es gibt am Geraet keinen Ort, an dem dieser Wert zurueckgedreht werden koennte',
    amGeraet.length === 0,
    amGeraet.length === 0
      ? 'die Oberflaeche der Box kennt idlePiShutdown nicht — nur die Verwaltung auf dem zweiten Geraet'
      : amGeraet.join(' | '),
  )
  await setzen({ ausschaltenNach: 0 })

  // ── 5. GEGENPROBE: die Helligkeit, die den Anlass gab
  //
  // Sie MUSS zu sein — sonst misst dieser Lauf nichts.
  console.log('\n5. GEGENPROBE — die Helligkeit (soll ZU sein)')
  const dunkel = await fetch(`${basis}/api/schirm/helligkeit`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prozent: 0 }),
  })
  befund(
    'Helligkeit 0 wird abgelehnt',
    dunkel.status !== 200 ? false : true,
    `PUT prozent:0 -> ${dunkel.status} (200 waere die Sackgasse)`,
  )

  console.log(`\n${offen} Sackgasse(n) offen, ${zu} zu.`)
  await aufraeumen(offen === 0 ? 0 : 1)
} catch (err) {
  if (err instanceof OhneGegenstand) {
    console.error(`\nABBRUCH — der Gegenstand dieser Messung ist nicht mehr da: ${err.message}`)
    console.error(err.anleitung)
    console.error('\nKein Urteil. Rueckgabe 2 (Abbruch), nicht 0 und nicht 1.')
    await aufraeumen(2)
  }
  console.error(err)
  await aufraeumen(1)
}
