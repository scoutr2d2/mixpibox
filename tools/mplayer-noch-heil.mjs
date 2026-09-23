#!/usr/bin/env node
/*
 * IST DER RUECKFALL AUF mplayer NOCH HEIL? — am Geraet, am Ton.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * `playerEngine` in mupiboxconfig.json waehlt den Aufsatz; die VORGABE ist
 * mplayer, mpv ist der Nachfolger (spotify-control.ts, `createPlayer`). Auf
 * .169 steht „mpv" — der mplayer-Weg wird dort also NIE gefahren, und er
 * zerfaellt, ohne dass es jemand merkt.
 *
 * F1 hat den Verdacht scharf gemacht: seit a2214129 uebergibt
 * `spotify-control.ts` dem Aufsatz ZWEI Argumente (`play(adresse, titel)`),
 * und beide Aufsaetze kommen aus demselben untypisierten `require`. Bei mpv
 * reist der Name als Datei-Option mit; bei mplayer MUSS er folgenlos ins Leere
 * fallen, denn mplayer liest im Slave-Modus das zweite Wort eines `loadfile`
 * als seinen Anhaenge-Schalter. Aus jedem Startbefehl wuerde ein Einreihen —
 * eine stumme Box, die weiter `{status:'ok'}` meldet.
 *
 * mplayer-wrapper.spec.ts haelt das als REGEL fest. Dieses Werkzeug fragt die
 * andere Haelfte: ob der ganze Weg an der echten Box noch traegt.
 *
 * ══ WARUM AM TON UND NICHT AM PROTOKOLL ════════════════════════════════════
 * Ein `loadfile`, das mplayer als „anhaengen" liest, sieht von aussen aus wie
 * Erfolg: kein Fehler, kein Eintrag, der Dienst antwortet 200
 * ([[server-antwortet-200-auf-alles]]). Der Unterschied ist HOERBAR und sonst
 * nirgends. Gemessen wird deshalb der Spitzenpegel am Mithoerausgang der
 * Standardsenke (`parec …monitor`), wie in tools/dienstwechsel-am-geraet.mjs.
 *
 * ══ WAS ES AN DER BOX AENDERT — UND ZURUECKNIMMT ═══════════════════════════
 *   * `mupibox.playerEngine` wird auf „mplayer" gestellt und der Abspieldienst
 *     neu gestartet. AM ENDE WIRD BEIDES ZURUECKGENOMMEN, auch bei Abbruch
 *     (finally). Die Datei wird vorher nach
 *     /etc/mupibox/mupiboxconfig.json.vor-mplayer-probe kopiert.
 *   * Es startet eine Wiedergabe und haelt sie mit `stop` wieder an.
 *   * Der Server (Port 8200) wird NICHT angefasst.
 * Ein Lauf ist HOERBAR. Nicht neben einem schlafenden Kind starten.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/mplayer-noch-heil.mjs
 *   node tools/mplayer-noch-heil.mjs --box 192.168.178.169 --fenster 4
 *   node tools/mplayer-noch-heil.mjs --nur-lesen     # nur ansehen, nichts stellen
 */

import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const BOX = String(opt('box', '192.168.178.169'))
const API = `http://${BOX}:8200/api`
const SPIELER = `http://${BOX}:8200/player`
const FENSTER = Number(opt('fenster', 4)) || 4
const NUR_LESEN = argv.includes('--nur-lesen')
const KONFIG = '/etc/mupibox/mupiboxconfig.json'
const SICHERUNG = '/etc/mupibox/mupiboxconfig.json.vor-mplayer-probe'

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

function ueberSsh(skript) {
  return new Promise((res, rej) => {
    const p = spawn('ssh', ['-o', 'BatchMode=yes', `dietpi@${BOX}`, 'bash', '-s'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let aus = ''
    let fehler = ''
    p.stdout.setEncoding('utf8')
    p.stderr.setEncoding('utf8')
    p.stdout.on('data', (s) => {
      aus += s
    })
    p.stderr.on('data', (s) => {
      fehler += s
    })
    p.on('close', (c) => (c === 0 || aus ? res(aus) : rej(new Error(`ssh ${c}: ${fehler.slice(0, 400)}`))))
    p.stdin.write(skript)
    p.stdin.end()
  })
}

async function json(url) {
  const a = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } })
  const text = await a.text()
  if (!(a.headers.get('content-type') || '').includes('json'))
    throw new Error(`${url} -> ${a.status} — kein JSON (${text.length} B)`)
  return JSON.parse(text)
}
const befehl = (p) => fetch(`${SPIELER}/current/${p}`, { cache: 'no-store' }).catch(() => null)
const lokal = () => json(`${SPIELER}/local`).catch(() => null)

/**
 * Welche Maschine LAEUFT — am KINDPROZESS abgelesen, nicht am Protokoll.
 *
 * DAS PROTOKOLL TAUGT DAFUER NICHT, und das ist am 05.08.2026 gemessen worden:
 * `spotify-control.ts` schreibt die Zeile „[Spotify Control] Wiedergabe-Maschine:
 * …" mit `log.info`, und `console-log-level` steht auf der Box auf `error`
 * (config/config.json des Abspieldienstes). Sie erscheint im journal NIE.
 * Der Aufsatz startet seine Maschine dagegen SOFORT beim Laden — es gibt also
 * einen Kindprozess `mpv …` bzw. `mplayer -slave …` unter der PID des
 * Dienstes, und der luegt nicht.
 */
async function maschineAmProzess() {
  const aus = await ueberSsh(`
haupt=$(systemctl show -p MainPID --value mupibox-player.service)
echo -n "Dienst-PID $haupt -> "
ps -eo ppid,args --no-headers | awk -v p="$haupt" '$1==p' | grep -oE '^ *[0-9]+ +(mpv|mplayer)' | awk '{print $2}' | tr '\\n' ' '
echo
`)
  return aus.trim()
}

async function engineStellen(wert) {
  // Ueber python3 an der Box, damit die uebrige Datei Zeichen fuer Zeichen
  // bleibt, wie sie war (json.load/json.dump mit ensure_ascii=False, indent 2
  // waere GERATEN — deshalb wird nur der eine Wert per Textersatz gedreht).
  const aus = await ueberSsh(`
python3 - <<'PY'
import re
p = '${KONFIG}'
s = open(p, encoding='utf-8').read()
neu, n = re.subn(r'("playerEngine"\\s*:\\s*")[^"]*(")', r'\\g<1>${wert}\\g<2>', s)
if n != 1:
    print('FEHLER playerEngine %dx gefunden' % n)
else:
    open(p, 'w', encoding='utf-8').write(neu)
    print('GESTELLT ${wert}')
PY
`)
  if (!aus.includes('GESTELLT')) throw new Error(`playerEngine nicht gestellt: ${aus.trim()}`)
  await ueberSsh('sudo -n systemctl restart mupibox-player.service && sleep 4 && echo NEUGESTARTET')
}

/** Eine Ablesung: Pegel am Mithoerausgang + was der Dienst meldet. */
async function pegel() {
  const roh = await ueberSsh(`
export XDG_RUNTIME_DIR=/run/user/1000
python3 - <<'PY'
import array, json, subprocess
senke = ''
for z in subprocess.run(['pactl','get-default-sink'], capture_output=True, text=True).stdout.splitlines():
    z = z.strip()
    if z and ' ' not in z and '.' in z:
        senke = z
# MINDESTENS DREI SEKUNDEN: parec puffert 64 kB, bevor es das erste Byte
# schreibt. Kuerzere Fenster liefern NULL Byte — also "still", egal was laeuft.
subprocess.run(['bash','-c',
  'timeout ${FENSTER}s parec --device=%s.monitor --format=s16le --rate=22050 --channels=1 --raw > /tmp/mupi-mpl.raw 2>/dev/null' % senke],
  check=False)
try:
    d = open('/tmp/mupi-mpl.raw','rb').read()
except Exception:
    d = b''
a = array.array('h'); a.frombytes(d[: len(d)//2*2])
print('ERGEBNIS ' + json.dumps({'senke': senke, 'rahmen': len(a),
      'spitze': (max(abs(x) for x in a)/32768.0) if len(a) else -1.0}))
PY
`)
  const z = roh.split('\n').find((l) => l.startsWith('ERGEBNIS '))
  if (!z) throw new Error(`keine Ablesung:\n${roh.slice(0, 300)}`)
  return JSON.parse(z.slice(9))
}

async function werkFinden(dienst) {
  const d = await json(`${API}/werke?verschmelzen=1`)
  for (const w of Array.isArray(d?.werke) ? d.werke : []) {
    let inhalt
    try {
      inhalt = await json(`${API}/werke/${encodeURIComponent(w.schluessel)}/inhalt?verschmelzen=1`)
    } catch {
      continue
    }
    if (inhalt?.dienst !== dienst) continue
    const titel = (inhalt.titel || []).filter((t) => t.befehl && t.anhaengen)
    if (titel.length >= 2) return { w, titel }
  }
  return null
}

/** Ein Durchgang: starten, anhaengen, hoeren, was der Dienst meldet. */
async function durchgang(name, fund) {
  console.log(`\n── ${name} ────────────────────────────────────────`)
  console.log(`  ${await maschineAmProzess()}`)
  await befehl('stop')
  await warte(1500)
  const still = await pegel()
  console.log(`  Stille vorher:  Spitze ${still.spitze.toFixed(4)}  (${still.rahmen} Rahmen, ${still.senke})`)

  await befehl(fund.titel[0].befehl)
  await warte(5000)
  // ANHAENGEN GEHOERT DAZU: `queue` ist bei mplayer `loadfile <adr> 1`. Wuerde
  // der Titelname durchgereicht, staende er als DRITTES Wort da — und das ist
  // genau der Befehl, an dem es zerbrechen wuerde.
  await befehl(fund.titel[1].anhaengen)
  await warte(2000)

  const laut = await pegel()
  const lo = await lokal()
  console.log(`  Beim Spielen:   Spitze ${laut.spitze.toFixed(4)}  (${laut.rahmen} Rahmen)`)
  console.log(`  Dienst meldet:  Titel „${lo?.currentTrackname ?? ''}"  nr ${lo?.currentTracknr ?? '—'}  timePos ${lo?.timePos ?? '—'}`)
  await befehl('stop')
  await warte(1200)
  return { still, laut, lo, sollTitel: String(fund.titel[0].titel ?? '') }
}

async function main() {
  console.log(`mplayer-Rueckfall an ${BOX}\n`)
  const vorher = (await json(`${API}/config`).catch(() => null))?.mupibox?.playerEngine
  const ausDatei = (await ueberSsh(`grep -o '"playerEngine"[^,]*' ${KONFIG}`)).trim()
  console.log(`playerEngine laut Datei: ${ausDatei}   (laut /api/config: ${vorher ?? '—'})`)
  console.log(`  ${await maschineAmProzess()}`)
  if (NUR_LESEN) return

  const fund = await werkFinden('jellyfin')
  if (!fund) {
    console.log('Kein jellyfin-Werk mit zwei Titeln gefunden — nichts gemessen.')
    process.exitCode = 2
    return
  }
  console.log(`Werk: „${fund.w.titel}" — Titel 1 „${fund.titel[0].titel}"`)

  await ueberSsh(`sudo -n cp -a ${KONFIG} ${SICHERUNG} && echo GESICHERT`)
  let mitMplayer = null
  try {
    await engineStellen('mplayer')
    mitMplayer = await durchgang('mit mplayer', fund)
  } finally {
    console.log('\n── zurueckstellen ─────────────────────────────────────────')
    await engineStellen('mpv')
    await befehl('stop')
    console.log(`  ${await maschineAmProzess()}`)
    const jetzt = (await ueberSsh(`grep -o '"playerEngine"[^,]*' ${KONFIG}`)).trim()
    console.log(`  playerEngine laut Datei: ${jetzt}`)
    if (jetzt !== ausDatei) console.log('  ACHTUNG: der Wert steht NICHT wieder wie vorher.')
  }

  console.log('\n── Urteil ─────────────────────────────────────────────────')
  const m = mitMplayer
  // DIE MARKE: der Mithoerausgang traegt im Leerlauf nicht exakt 0. Verlangt
  // wird deshalb nicht „mehr als nichts", sondern ein deutlicher Abstand zur
  // gemessenen Stille DESSELBEN Laufs.
  const hoerbar = m.laut.spitze > Math.max(0.02, m.still.spitze * 4)
  const name = String(m.lo?.currentTrackname ?? '')
  console.log(`  Ton mit mplayer:  ${hoerbar ? 'JA' : 'NEIN'}  (${m.still.spitze.toFixed(4)} -> ${m.laut.spitze.toFixed(4)})`)
  console.log(`  Name mit mplayer: „${name}"  (aus dem BEFEHL, erwartet „${m.sollTitel}")`)
  if (!hoerbar) {
    console.log('  ROT: der mplayer-Weg gibt keinen Ton ab. Der Rueckfall ist gefallen.')
    process.exitCode = 1
    return
  }
  if (name !== m.sollTitel) {
    console.log('  ROT: der Name kommt bei mplayer allein aus dem Befehl und muesste stimmen.')
    process.exitCode = 1
    return
  }
  console.log('  GRUEN: mplayer spielt, und der Name aus dem Befehl steht richtig da.')
}

main().catch((e) => {
  console.error(`FEHLGESCHLAGEN: ${e.message}`)
  process.exitCode = 1
})
