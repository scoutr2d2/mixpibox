#!/usr/bin/env node
/*
 * WAS WEISS mpv SELBST UEBER DEN LAUFENDEN TITEL — und was davon kommt an?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * BACKLOG F1: `currentTrackname` folgt bei mpv NIE
 * ([[mpv-trackname-geht-nie-mit]]). Gemessen ist damit die WIRKUNG. Offen ist
 * die Frage davor, und an ihr haengt, WO man F1 behebt:
 *
 *     Weiss mpv den Namen ueberhaupt — und meldet er ihn?
 *
 * Wenn ja, ist der Abspieldienst der richtige Ort: dann heilt EINE Aenderung
 * beide Oberflaechen. Wenn nein, muss die neue Oberflaeche nachschlagen (wie
 * beim Cover seit dem 06.08.2026), und die klassische bleibt krank.
 *
 * DIESE FRAGE IST NICHT AUS DEM QUELLTEXT ZU BEANTWORTEN. `spotify-control.ts`
 * fragt `media-title` gar nicht ab — es steht nicht in EIGENSCHAFTEN
 * (mpv-protokoll.ts). Ob dort etwas Brauchbares stuende, wenn man fragte,
 * weiss nur die laufende Maschine.
 *
 * ══ ES GIBT EIN ZWEITES WERKZEUG ZU DERSELBEN FRAGE ════════════════════════
 * `tools/titelname-je-quelle.mjs` (am 05.08.2026 zeitgleich entstanden — an
 * diesem Baum arbeiten mehrere). Die beiden sind KEINE Doppelung, und wer das
 * verwechselt, zieht den falschen Schluss:
 *
 *   titelname-je-quelle.mjs  LIEST NUR (`get_property`, ausdruecklich kein
 *       `loadfile`). Es beantwortet: „Was steht in `media-title`, wenn wir
 *       spielen wie heute?" Antwort ist bei der ARD gemessen NEIN —
 *       „Fälschung | Die Maus zum Hören (0101.0101.70707070})".
 *
 *   DIESES WERKZEUG SCHREIBT AUCH. Es beantwortet die Frage danach, die aus
 *       einem Nein ein Ja macht: „Und wenn wir mpv den Namen GEBEN, statt ihn
 *       zu erfragen?" (`--probe-titel`, `--beobachten`). Genau daran haengt,
 *       ob Weg (b) auch fuer die ARD traegt — und gemessen traegt er.
 *
 * Wer nur liest, kommt zu „Weg B geht nicht". Das ist fuer das LESEN richtig
 * und fuer die Sache falsch.
 *
 * ══ WARUM AM SOCKET UND NICHT AN /player/local ═════════════════════════════
 * `/player/local` zeigt, was der Abspieldienst SICH GEMERKT hat. Es kann
 * nichts ueber Eigenschaften sagen, die der Dienst nie erfragt. Gefragt wird
 * deshalb mpv direkt, ueber seinen JSON-IPC-Socket — derselbe Socket, an dem
 * der laufende Dienst haengt, also dieselbe Maschine mit derselben
 * Warteschlange. Kein zweites mpv, kein Nachstellen.
 *
 * HTTP 200 BEWEIST HIER NICHTS ([[server-antwortet-200-auf-alles]]): Server
 * (8200) und Abspieldienst (5005) antworten auf jeden Pfad mit 200. Gemessen
 * wird ausschliesslich ueber Inhalte.
 *
 * ══ WAS ES AN DER BOX AENDERT ══════════════════════════════════════════════
 *   --lage        NICHTS. Es liest nur Eigenschaften (`get_property`).
 *   --ard/--jellyfin
 *                 Es startet eine Wiedergabe und haelt am Ende an (`stop`).
 *                 Keine Nutzerdatei wird geschrieben: es wird NICHT gemerkt
 *                 (kein POST /api/weiterhoeren) — anders als
 *                 tools/stelle-je-dienst-am-geraet.mjs.
 *   --probe-titel Haengt EINEN Titel mit `force-media-title` an die laufende
 *                 Warteschlange an. Das veraendert die Warteschlange; mit
 *                 `stop` am Ende ist sie wieder weg.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/mpv-titelquelle-am-geraet.mjs --lage
 *       Was tragen die Kandidaten JETZT? (media-title, playlist/N/title, …)
 *
 *   node tools/mpv-titelquelle-am-geraet.mjs --ard --ab-ende 20
 *       ARD-Sendung anspielen, kurz vor Folgenende springen und ueber den
 *       Uebergang hinweg BEIDE Seiten mitschreiben: was der Dienst meldet
 *       (currentTrackname) und was mpv selbst weiss (media-title).
 *
 *   node tools/mpv-titelquelle-am-geraet.mjs --jellyfin
 *       Dasselbe an einem Jellyfin-Album. NOETIG als Gegenprobe: die
 *       ARD-Folgen sind alle gleich lang, dort kann man einen stehengebliebenen
 *       Wert nicht von einem richtigen unterscheiden.
 *
 *   node tools/mpv-titelquelle-am-geraet.mjs --probe-titel "Mein Name"
 *       Nimmt `loadfile … append-play` einen `force-media-title` an? Davon
 *       haengt der zweite mögliche Weg im Abspieldienst ab.
 *
 *   --box IP        Vorgabe 192.168.178.169
 *   --nutzer NAME   Vorgabe dietpi
 *   --titel TEIL    welches Werk (Teil des Titels), sonst das erste
 *   --nachlauf N    wie lange nach dem Wechsel weitergemessen wird (60 s)
 */

import { execFile } from 'node:child_process'

const argv = process.argv.slice(2)
const opt = (name, vorgabe = null) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return vorgabe
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const hat = (name) => argv.includes(`--${name}`)

const BOX = String(opt('box', '192.168.178.169'))
const NUTZER = String(opt('nutzer', 'dietpi'))
const API = `http://${BOX}:8200/api`
const SPIELER = `http://${BOX}:8200/player`
const RAUM = 'current'

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms))

// ── SSH ────────────────────────────────────────────────────────────────────
function ssh(befehl, eingabe = null) {
  return new Promise((fertig, schiefgegangen) => {
    const kind = execFile(
      'ssh',
      ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', `${NUTZER}@${BOX}`, befehl],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
      (fehler, aus, err) => {
        if (fehler && !aus) return schiefgegangen(new Error(`${fehler.message}\n${err}`))
        fertig(String(aus))
      },
    )
    if (eingabe != null) {
      kind.stdin.write(eingabe)
      kind.stdin.end()
    }
  })
}

/*
 * DER SOCKET DES LAUFENDEN mpv — nicht irgendeiner aus /tmp.
 *
 * Auf der Box lagen am 06.08.2026 ZWEI Socketdateien; eine gehoerte zu einem
 * Prozess, den es nicht mehr gab. Wer die falsche nimmt, bekommt „connection
 * refused" und haelt es fuer eine Aussage ueber mpv. Gefragt wird deshalb die
 * PROZESSLISTE: der Pfad steht in der Befehlszeile des lebenden mpv.
 */
async function socketPfad() {
  const aus = await ssh('pgrep -a mpv || true')
  for (const zeile of aus.split('\n')) {
    const t = zeile.match(/--input-ipc-server=(\S+)/)
    if (t) return t[1]
  }
  return null
}

/*
 * mpv fragen. Auf der Box laeuft dafuer ein kleines Python-Stueck, das den
 * Unix-Socket oeffnet, alle Fragen auf einmal hineinschreibt und die Antworten
 * ueber `request_id` zuordnet.
 *
 * DIE ZUORDNUNG IST NICHT OPTIONAL: ueber denselben Socket laufen auch
 * EREIGNISSE (property-change, file-loaded, …). Wer einfach die naechste Zeile
 * liest, liest mit hoher Wahrscheinlichkeit ein Ereignis und haelt es fuer die
 * Antwort auf seine Frage.
 */
const FRAGER = `
import json, socket, sys, time
pfad = sys.argv[1]
fragen = json.loads(sys.stdin.read())
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(4)
s.connect(pfad)
for i, f in enumerate(fragen, start=1):
    befehl = f if isinstance(f, list) else ["get_property", f]
    s.sendall((json.dumps({"command": befehl, "request_id": i}) + "\\n").encode())
antworten = {}
puffer = b""
ende = time.time() + 4
while len(antworten) < len(fragen) and time.time() < ende:
    try:
        stueck = s.recv(65536)
    except socket.timeout:
        break
    if not stueck:
        break
    puffer += stueck
    while b"\\n" in puffer:
        zeile, puffer = puffer.split(b"\\n", 1)
        if not zeile.strip():
            continue
        try:
            o = json.loads(zeile.decode("utf-8", "replace"))
        except Exception:
            continue
        rid = o.get("request_id")
        if isinstance(rid, int):
            antworten[rid] = {"fehler": o.get("error"), "wert": o.get("data")}
erg = []
for i, f in enumerate(fragen, start=1):
    a = antworten.get(i, {"fehler": "keine Antwort", "wert": None})
    erg.append({"frage": f, "fehler": a["fehler"], "wert": a["wert"]})
print(json.dumps(erg, ensure_ascii=False))
`

/*
 * Das Python-Stueck liegt EINMAL auf der Box (im Temp-Verzeichnis) und wird
 * danach nur noch mit Fragen gefuettert. `python3 - ` waere naheliegender,
 * geht hier aber NICHT: stdin traegt dann das Programm und haette daneben noch
 * die Fragen zu tragen.
 */
const FRAGER_PFAD = '/tmp/mupi-mpv-frager.py'
let fragerLiegt = false

async function frager() {
  if (fragerLiegt) return
  await ssh(`cat > ${FRAGER_PFAD}`, FRAGER)
  fragerLiegt = true
}

async function frage(sock, fragen) {
  await frager()
  const aus = await ssh(`python3 ${FRAGER_PFAD} ${JSON.stringify(sock)}`, JSON.stringify(fragen))
  const zeile = aus.trim().split('\n').pop()
  try {
    return JSON.parse(zeile)
  } catch {
    throw new Error(`unlesbare Antwort: ${aus.slice(0, 300)}`)
  }
}

// ── HTTP (derselbe Weg wie die Oberflaeche) ────────────────────────────────
async function json(url, opts) {
  const a = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, ...opts })
  const text = await a.text()
  const typ = a.headers.get('content-type') || ''
  if (!typ.includes('json')) throw new Error(`${url} -> ${a.status} ${typ} (${text.length} B) — kein JSON`)
  return JSON.parse(text)
}
const befehl = (pfad) =>
  fetch(`${SPIELER}/${RAUM}/${pfad}`, { cache: 'no-store', headers: { accept: 'application/json' } }).catch(() => null)
const lokal = () => json(`${SPIELER}/local`).catch(() => null)

async function werke() {
  const d = await json(`${API}/werke?verschmelzen=1`)
  return Array.isArray(d?.werke) ? d.werke : []
}
async function inhalt(schluessel) {
  return json(`${API}/werke/${encodeURIComponent(schluessel)}/inhalt?verschmelzen=1`)
}

// ── DIE KANDIDATEN ─────────────────────────────────────────────────────────
/*
 * WAS KOENNTE DEN NAMEN TRAGEN — vollstaendig, nicht nur der Verdacht.
 *
 * `media-title` ist der naheliegende: mpv setzt ihn aus den Metadaten und
 * faellt auf den Dateinamen zurueck. `playlist/N/title` ist der zweite Weg —
 * er kommt aus der WARTESCHLANGE, nicht aus der Datei, und waere damit auch
 * dann brauchbar, wenn der Strom gar keine Metadaten traegt.
 */
const KANDIDATEN = [
  'media-title',
  'filename',
  'path',
  'stream-open-filename',
  'playlist-pos-1',
  'playlist-count',
  'metadata',
  'metadata/by-key/Title',
  'chapter-metadata',
  'force-media-title',
  ['get_property', 'playlist'],
]

function kurz(wert, grenze = 110) {
  const s = typeof wert === 'string' ? JSON.stringify(wert) : JSON.stringify(wert)
  if (s == null) return 'null'
  return s.length > grenze ? `${s.slice(0, grenze)}…` : s
}

async function lageZeigen(sock, einleitung = '') {
  const erg = await frage(sock, KANDIDATEN)
  if (einleitung) console.log(einleitung)
  for (const e of erg) {
    const name = Array.isArray(e.frage) ? e.frage.join(' ') : e.frage
    const status = e.fehler === 'success' ? '' : `  [${e.fehler}]`
    console.log(`    ${String(name).padEnd(24)} = ${kurz(e.wert)}${status}`)
  }
  return Object.fromEntries(erg.map((e) => [Array.isArray(e.frage) ? e.frage.join(' ') : e.frage, e]))
}

/** Nur die Felder, auf die es beim Uebergang ankommt — eine Zeile. */
function zeile(lo, mpv) {
  const m = (n) => {
    const e = mpv && mpv[n]
    return e && e.fehler === 'success' ? e.wert : null
  }
  return [
    `nr=${lo?.currentTracknr ?? '-'}`,
    `t=${lo?.timePos == null ? '-' : Number(lo.timePos).toFixed(1)}`,
    `dauer=${lo?.duration == null ? '-' : Number(lo.duration).toFixed(1)}`,
    `dienstName=${JSON.stringify(lo?.currentTrackname || '')}`,
    `mpvMediaTitle=${JSON.stringify(m('media-title') || '')}`,
    `mpvListenTitel=${JSON.stringify(listenTitel(m('get_property playlist'), lo?.currentTracknr) || '')}`,
  ].join('  ')
}

/** Der `title` des laufenden Eintrags in mpvs eigener Warteschlange. */
function listenTitel(liste, nr) {
  if (!Array.isArray(liste)) return null
  const laufend = liste.find((e) => e && e.current)
  if (laufend) return laufend.title ?? null
  const n = Math.round(Number(nr) || 0)
  return n >= 1 && n <= liste.length ? (liste[n - 1].title ?? null) : null
}

// ── A: NUR NACHSEHEN ───────────────────────────────────────────────────────
async function frageLage(sock) {
  console.log(`mpv-Socket: ${sock}`)
  const lo = await lokal()
  console.log('\n/player/local (was der Dienst sich gemerkt hat):')
  console.log(
    `    currentType=${lo?.currentType}  currentPlayer=${lo?.currentPlayer}  playing=${lo?.playing}\n` +
      `    currentTrackname=${JSON.stringify(lo?.currentTrackname || '')}  album=${JSON.stringify(lo?.album || '')}\n` +
      `    currentTracknr=${lo?.currentTracknr}  totalTracks=${lo?.totalTracks}`,
  )
  await lageZeigen(sock, '\nmpv selbst gefragt:')
}

// ── B: UEBER DEN UEBERGANG ─────────────────────────────────────────────────
/*
 * DIE EINE MESSUNG, DIE DIE FRAGE ENTSCHEIDET.
 *
 * Nicht „steht irgendwo ein Name", sondern: geht der Name MIT, wenn mpv von
 * selbst weiterrueckt? Das ist der Fall, in dem `currentTrackname` versagt
 * ([[mpv-trackname-geht-nie-mit]]) — und nur wenn eine mpv-Eigenschaft ihn
 * ueberlebt, ist der Abspieldienst der richtige Ort fuer F1.
 */
async function frageUebergang(sock, dienstName) {
  if (hat('sprung')) return frageSprung(sock, dienstName)
  const liste = await werke()
  const passend = liste.filter((w) => (w.quellen || []).some((q) => q.dienst === dienstName))
  if (!passend.length) return console.log(`Kein Werk mit Quelle „${dienstName}" im Raster.`)
  const wunsch = String(opt('titel', '') || '').toLowerCase()
  const w = wunsch ? passend.find((x) => String(x.titel).toLowerCase().includes(wunsch)) || passend[0] : passend[0]
  const d = await inhalt(w.schluessel)
  const titel = (d.titel || []).filter((t) => t.befehl)
  console.log(`${dienstName} „${w.titel}": ${titel.length} Folgen/Titel`)
  console.log(`    1 = „${titel[0]?.titel}"`)
  console.log(`    2 = „${titel[1]?.titel}"`)

  await befehl('stop')
  await schlaf(600)
  await befehl(titel[0].befehl)
  for (const t of titel.slice(1, 3)) await befehl(t.anhaengen)
  await schlaf(3500)

  let lo = await lokal()
  let mpv = await lageZeigen(sock, '\nNACH DEM START — mpv selbst:')
  console.log(`  ${zeile(lo, mpv)}`)

  const abEnde = Number(opt('ab-ende', 20)) || 20
  const echt = Number(lo?.duration) || 0
  if (!echt) {
    console.log('  KEINE DAUER GEMELDET — der Sprung ans Ende ist nicht stellbar.')
    return
  }
  const ziel = Math.max(0, ((echt - abEnde) / echt) * 100)
  console.log(`\n  echte Dauer laut mpv: ${echt.toFixed(1)} s -> seekpos:${ziel.toFixed(2)} (${abEnde} s vor Schluss)`)
  await befehl(`seekpos:${ziel.toFixed(2)}`)

  const nachlauf = Number(opt('nachlauf', 60)) || 60
  const bis = Date.now() + (abEnde + 150) * 1000
  let letzteNr = null
  let wechselUm = 0
  for (;;) {
    if (wechselUm ? Date.now() - wechselUm > nachlauf * 1000 : Date.now() > bis) break
    lo = await lokal()
    mpv = Object.fromEntries(
      (await frage(sock, ['media-title', ['get_property', 'playlist'], 'metadata/by-key/Title'])).map((e) => [
        Array.isArray(e.frage) ? e.frage.join(' ') : e.frage,
        e,
      ]),
    )
    const nr = lo?.currentTracknr
    if (String(nr) !== String(letzteNr)) {
      if (letzteNr !== null) wechselUm = Date.now()
      console.log(`  [${new Date().toLocaleTimeString()}] WECHSEL nr ${letzteNr} -> ${nr}`)
      letzteNr = nr
    }
    const seit = wechselUm ? ` (+${Math.round((Date.now() - wechselUm) / 1000)}s)` : ''
    console.log(`  [${new Date().toLocaleTimeString()}]${seit} ${zeile(lo, mpv)}`)
    await schlaf(2000)
  }
  console.log('\nNACH DEM UEBERGANG — alle Kandidaten:')
  await lageZeigen(sock, '')
}

/*
 * DIE SCHNELLE VARIANTE — und wozu sie taugt, steht hier, damit sie niemand
 * fuer die andere haelt.
 *
 * `--sprung` wartet nicht auf das Folgenende, sondern schaltet mit
 * `tracknr:2` weiter. Das beantwortet NICHT die Frage von F1 (dort geht mpv
 * VON SELBST weiter, ohne dass der Dienst etwas erfaehrt) — es beantwortet
 * eine kleinere, aber noetige: LIEST mpv fuer diesen Dienst ueberhaupt
 * Metadaten aus der einzelnen Datei, und WAS steht darin?
 *
 * NOETIG WURDE SIE AM 05.08.2026: eine ARD-Folge dauert 3606 s, und der Lauf
 * ueber das Folgenende wurde nach zwei Minuten von einer FREMDEN Wiedergabe
 * ueberholt (an diesem Baum arbeiten mehrere gleichzeitig, und die Box ist
 * eine). Eine Messung, die eine Stunde offenhaelt, ist auf einem geteilten
 * Geraet keine Messung.
 */
async function frageSprung(sock, dienstName) {
  const liste = await werke()
  const passend = liste.filter((w) => (w.quellen || []).some((q) => q.dienst === dienstName))
  if (!passend.length) return console.log(`Kein Werk mit Quelle „${dienstName}" im Raster.`)
  const wunsch = String(opt('titel', '') || '').toLowerCase()
  const w = wunsch ? passend.find((x) => String(x.titel).toLowerCase().includes(wunsch)) || passend[0] : passend[0]
  const d = await inhalt(w.schluessel)
  const titel = (d.titel || []).filter((t) => t.befehl)
  console.log(`${dienstName} „${w.titel}": ${titel.length} Folgen/Titel`)
  console.log(`    laut /inhalt:  1 = „${titel[0]?.titel}"`)
  console.log(`                   2 = „${titel[1]?.titel}"`)

  await befehl('stop')
  await schlaf(600)
  await befehl(titel[0].befehl)
  for (const t of titel.slice(1, 3)) await befehl(t.anhaengen)
  await schlaf(4000)

  let lo = await lokal()
  let mpv = await lageZeigen(sock, '\nFOLGE 1 — mpv selbst:')
  console.log(`  ${zeile(lo, mpv)}`)

  await befehl('tracknr:2')
  await schlaf(4000)
  lo = await lokal()
  mpv = await lageZeigen(sock, '\nNACH tracknr:2 — mpv selbst:')
  console.log(`  ${zeile(lo, mpv)}`)

  const m = mpv['media-title']
  console.log('\nBEFUND:')
  console.log(`  /inhalt kennt den Namen der Folge 2:        „${titel[1]?.titel}"`)
  console.log(`  der Dienst meldet als currentTrackname:     ${JSON.stringify(lo?.currentTrackname || '')}`)
  console.log(`  mpv meldet als media-title:                 ${JSON.stringify(m?.wert ?? null)}`)
}

// ── C: NIMMT loadfile EINEN NAMEN AN? ──────────────────────────────────────
/*
 * DER ZWEITE MOEGLICHE WEG IM ABSPIELDIENST.
 *
 * Der Name der Folge ist im Abspieldienst BEKANNT — er steht im Befehl
 * (`…:title:artist:…`, `parts[0]`). Er geht heute nur deshalb verloren, weil
 * er in EINE Variable geschrieben wird, die der naechste Titel ueberschreibt
 * bzw. eben nicht. Koennte man ihn stattdessen der WARTESCHLANGE mitgeben,
 * traegt mpv ihn selbst weiter — und `media-title` waere ab dann fuer jede
 * Folge richtig, ohne dass irgendwo mitgezaehlt werden muss.
 *
 * mpv kennt dafuer `force-media-title` als DATEI-Option. Ob `loadfile` sie in
 * dieser Version annimmt, entscheidet die Maschine, nicht die Dokumentation.
 */
async function frageProbeTitel(sock, name) {
  const dienstWunsch = String(opt('quelle', 'ard') || 'ard')
  const l = await werke()
  const wunsch = String(opt('titel', '') || '').toLowerCase()
  const kandidaten = l.filter((w) => (w.quellen || []).some((q) => q.dienst === dienstWunsch))
  const passend = wunsch ? kandidaten.find((x) => String(x.titel).toLowerCase().includes(wunsch)) || kandidaten[0] : kandidaten[0]
  if (!passend) return console.log(`Kein Werk mit Quelle „${dienstWunsch}".`)
  const d = await inhalt(passend.schluessel)
  const titel = (d.titel || []).filter((x) => x.befehl)
  // Der Befehl traegt die Adresse: <verb>/<kodierte Adresse>/<name>…
  const adrAus = (t) => {
    const m = String(t?.befehl || '').match(/^(?:ard|jellyfin)\/([^/]+)\//)
    return m ? decodeURIComponent(m[1]) : ''
  }
  const a1 = adrAus(titel[0])
  const a2 = adrAus(titel[1])
  if (!a1 || !a2) return console.log('Zwei Probeadressen sind nicht zu bekommen.')
  console.log(`„${passend.titel}" (${dienstWunsch}) — die ersten zwei Folgen:`)
  console.log(`    1 = „${titel[0].titel}"`)
  console.log(`    2 = „${titel[1].titel}"`)

  await befehl('stop')
  await schlaf(800)

  /*
   * ZWEI EINTRAEGE MIT VERSCHIEDENEN NAMEN — und genau darum geht es. Ein
   * einzelner Eintrag beweist nur, dass mpv den Namen ANNIMMT. Die Frage von
   * F1 ist eine andere: geht er MIT, wenn die Warteschlange weiterrueckt?
   * Zwei Eintraege koennen das beantworten, einer nicht.
   *
   * `-1` als Index ist NICHT Zierde: die Form ohne Index
   * (`loadfile <adr> append {optionen}`) beantwortet mpv 0.40 mit
   * „invalid parameter" — am 05.08.2026 gemessen. Wer die kuerzere Form
   * schreibt, bekommt keinen Namen und keinen Fehler in der Oberflaeche,
   * sondern einen stillen Fehlschlag im Socket.
   */
  const erg = await frage(sock, [
    ['loadfile', a1, 'append-play', -1, { 'force-media-title': `${name}: ${titel[0].titel}` }],
    ['loadfile', a2, 'append', -1, { 'force-media-title': `${name}: ${titel[1].titel}` }],
  ])
  for (const e of erg) console.log(`  loadfile -> ${e.fehler}  ${JSON.stringify(e.wert)}`)

  await schlaf(4000)
  let mpv = await lageZeigen(sock, '\nEINTRAG 1 laeuft — was meldet mpv:')
  let lo = await lokal()
  console.log(`  Dienst meldet currentTrackname=${JSON.stringify(lo?.currentTrackname || '')}`)

  // Weiterschalten wie mpv es beim Titelende selbst tut.
  await frage(sock, [['playlist-next', 'force']])
  await schlaf(4000)
  mpv = await lageZeigen(sock, '\nNACH playlist-next — was meldet mpv:')
  lo = await lokal()
  console.log(`  Dienst meldet currentTrackname=${JSON.stringify(lo?.currentTrackname || '')}`)

  const nach = await frage(sock, [['get_property', 'playlist']])
  console.log('\n  mpvs Warteschlange:')
  for (const [i, e] of (nach[0].wert || []).entries()) {
    console.log(
      `    ${i + 1}${e.current ? ' *' : '  '} title=${JSON.stringify(e.title ?? null)}  filename=${String(e.filename || '').slice(0, 50)}…`,
    )
  }
}

/*
 * ── D: LAESST SICH `media-title` BEOBACHTEN — UND NIMMT AUCH `replace` DEN NAMEN?
 *
 * ZWEI ANNAHMEN, DIE MAN LEICHT UEBERSIEHT, UND BEIDE TRAGEN DEN GANZEN WEG (b):
 *
 *   1. `BEFEHLE.play` ist `loadfile … replace`, `BEFEHLE.queue` ist
 *      `… append-play`. Gemessen ist bisher nur, dass APPEND-PLAY die
 *      Optionen annimmt. Nimmt `replace` sie nicht, bekaeme der ERSTE Titel
 *      keinen Namen — und der erste ist der, den das Kind zuerst sieht.
 *
 *   2. Der Wrapper meldet Eigenschaften ueber `observe_property` (mpv-wrapper
 *      Zeile 115). Waere `media-title` nicht beobachtbar, muesste es im
 *      Sekundentakt abgefragt werden — machbar, aber eine andere Bauart, und
 *      man merkte es erst nach dem Ausliefern.
 *
 * GEMESSEN WIRD DIE ZWEITE FRAGE AM EREIGNIS, nicht an einer Abfrage: es wird
 * beobachtet, dann weitergeschaltet, und mitgeschrieben, was mpv VON SELBST
 * schickt. Wer stattdessen hinterher `get_property` fragt, hat nur bewiesen,
 * dass man fragen kann.
 */
const BEOBACHTER = `
import json, socket, sys, time
pfad, adr1, adr2, n1, n2 = sys.argv[1:6]
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(1.0)
s.connect(pfad)
protokoll = []
def schick(b, rid):
    s.sendall((json.dumps({"command": b, "request_id": rid}) + "\\n").encode())
# 1. Beobachtung anmelden, BEVOR etwas geladen wird.
schick(["observe_property", 1, "media-title"], 101)
# 2. Ersten Titel mit erzwungenem Namen — ueber replace, wie BEFEHLE.play.
schick(["loadfile", adr1, "replace", -1, {"force-media-title": n1}], 102)
schick(["loadfile", adr2, "append", -1, {"force-media-title": n2}], 103)
puffer = b""
ende = time.time() + 22
gewechselt = False
while time.time() < ende:
    try:
        st = s.recv(65536)
    except socket.timeout:
        if not gewechselt and time.time() > ende - 14:
            schick(["playlist-next", "force"], 104)
            gewechselt = True
        continue
    if not st:
        break
    puffer += st
    while b"\\n" in puffer:
        z, puffer = puffer.split(b"\\n", 1)
        if not z.strip():
            continue
        try:
            o = json.loads(z.decode("utf-8", "replace"))
        except Exception:
            continue
        if o.get("event") == "property-change" and o.get("name") == "media-title":
            protokoll.append({"t": round(time.time() % 1000, 1), "art": "geschoben", "wert": o.get("data")})
        elif isinstance(o.get("request_id"), int):
            protokoll.append({"art": "antwort", "id": o["request_id"], "fehler": o.get("error")})
print(json.dumps(protokoll, ensure_ascii=False))
`

async function frageBeobachten(sock) {
  const l = await werke()
  const wunsch = String(opt('titel', '') || '').toLowerCase()
  const dienstWunsch = String(opt('quelle', 'ard') || 'ard')
  const kand = l.filter((w) => (w.quellen || []).some((q) => q.dienst === dienstWunsch))
  const w = wunsch ? kand.find((x) => String(x.titel).toLowerCase().includes(wunsch)) || kand[0] : kand[0]
  if (!w) return console.log(`Kein Werk mit Quelle „${dienstWunsch}".`)
  const d = await inhalt(w.schluessel)
  const titel = (d.titel || []).filter((x) => x.befehl)
  const adrAus = (t) => {
    const m = String(t?.befehl || '').match(/^(?:ard|jellyfin)\/([^/]+)\//)
    return m ? decodeURIComponent(m[1]) : ''
  }
  const a1 = adrAus(titel[0])
  const a2 = adrAus(titel[1])
  if (!a1 || !a2) return console.log('Zwei Probeadressen sind nicht zu bekommen.')
  console.log(`„${w.titel}" (${dienstWunsch}): 1 = „${titel[0].titel}", 2 = „${titel[1].titel}"`)

  await befehl('stop')
  await schlaf(800)
  await ssh(`cat > /tmp/mupi-mpv-beobachter.py`, BEOBACHTER)
  const n1 = `ERZWUNGEN 1: ${titel[0].titel}`
  const n2 = `ERZWUNGEN 2: ${titel[1].titel}`
  const aus = await ssh(
    `python3 /tmp/mupi-mpv-beobachter.py ${JSON.stringify(sock)} ${JSON.stringify(a1)} ${JSON.stringify(a2)} ${JSON.stringify(n1)} ${JSON.stringify(n2)}`,
  )
  const zeilen = JSON.parse(aus.trim().split('\n').pop())
  console.log('\nWAS mpv VON SELBST SCHICKTE (und die Antworten auf die Befehle):')
  for (const z of zeilen) {
    if (z.art === 'antwort') {
      const wozu = { 101: 'observe_property media-title', 102: 'loadfile … replace  {Name}', 103: 'loadfile … append   {Name}', 104: 'playlist-next' }[z.id]
      console.log(`    Antwort auf ${String(wozu).padEnd(34)} -> ${z.fehler}`)
    } else {
      console.log(`    GESCHOBEN  media-title = ${JSON.stringify(z.wert)}`)
    }
  }
  const geschoben = zeilen.filter((z) => z.art === 'geschoben').map((z) => z.wert)
  console.log('\nBEFUND:')
  console.log(`  beobachtbar:        ${geschoben.length ? 'JA' : 'NEIN'} (${geschoben.length} Meldungen ohne Nachfrage)`)
  console.log(`  replace nimmt Name: ${geschoben.includes(n1) ? 'JA' : 'NEIN'}`)
  console.log(`  Name geht mit:      ${geschoben.includes(n2) ? 'JA' : 'NEIN'}`)
}

// ── HAUPT ──────────────────────────────────────────────────────────────────
async function haupt() {
  const sock = await socketPfad()
  if (!sock) {
    console.log('KEIN LAUFENDES mpv auf der Box (pgrep -a mpv leer).')
    console.log('Das ist selbst ein Befund: ohne mpv gibt es nichts zu fragen.')
    process.exit(2)
  }
  try {
    if (hat('ard')) await frageUebergang(sock, 'ard')
    else if (hat('jellyfin')) await frageUebergang(sock, 'jellyfin')
    else if (hat('probe-titel')) await frageProbeTitel(sock, String(opt('probe-titel', 'PROBE')))
    else if (hat('beobachten')) await frageBeobachten(sock)
    else await frageLage(sock)
  } finally {
    if (hat('ard') || hat('jellyfin') || hat('probe-titel') || hat('beobachten')) {
      await befehl('stop')
      console.log('\n(angehalten)')
    }
  }
}

haupt().catch((e) => {
  console.error(String(e.message || e))
  process.exit(1)
})
