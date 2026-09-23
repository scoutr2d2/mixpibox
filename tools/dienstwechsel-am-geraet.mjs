#!/usr/bin/env node
/*
 * SPIELT DER ALTE TITEL WEITER, WENN MAN DEN DIENST WECHSELT? — AM TON GEMESSEN.
 *
 * GEMELDET am 04.08.2026, woertlich: „und es kann sein das der titel
 * weiterspielt wenn man den dienst wechselt".
 *
 * WORUM ES GEHT
 *   Auf dieser Box stehen ZWEI Toenerzeuger nebeneinander, und sie wissen
 *   nichts voneinander:
 *       librespot   eigener Prozess, spielt Spotify
 *       mpv         eigener Prozess, spielt lokal, Jellyfin, Radio, RSS, ARD
 *   Der Abspieldienst fuehrt aber nur EIN Feld `currentPlayer`. Wechselt man
 *   den Dienst, muss der eine still werden, bevor der andere anfaengt — und
 *   ob das geschieht, ist an der ANZEIGE nicht zu sehen.
 *
 * WIE HIER ENTSCHIEDEN WIRD, DASS ZWEI ZUGLEICH KLINGEN
 *   Ein Spitzenpegel am Mithoerausgang sagt „es klingt", nicht „es klingen
 *   ZWEI". Getrennt gemessen wird deshalb so:
 *
 *     mpv    fragt sich SELBST — ueber seinen IPC-Socket: `idle-active`,
 *            `pause`, `path`, und `time-pos` zweimal im Abstand. Laeuft die
 *            Zeit weiter, gibt mpv Ton ab. Das ist keine Vermutung, das ist
 *            die Auskunft der Tonmaschine selbst.
 *     librespot  laesst sich nicht fragen. Also wird mpv fuer die ENTSCHEIDENDE
 *            Ablesung angehalten (IPC `pause`) und DANN der Mithoerausgang
 *            gemessen. Was jetzt noch klingt, kann nur librespot sein.
 *
 * DREI IRRWEGE, DIE HIER SCHON GEMESSEN WURDEN (04.08.2026, Box .169) —
 * damit sie niemand ein zweites Mal geht:
 *   * `pactl` „Corked: no" beweist NICHTS. librespot steht auch pausiert so
 *     da (stand schon in mupi-check.py).
 *   * Der PipeWire-Knotenzustand auch nicht: `state=running` bei librespot,
 *     spielend UND pausiert — dreimal hintereinander gemessen.
 *   * `pw-record --target <knoten>` misst NICHT den Strom dieses Knotens.
 *     Bei laufendem Spotify: Knoten von librespot 0,0054, Mithoerausgang
 *     0,3551 — und eine NICHT VORHANDENE Zielnummer lieferte trotzdem eine
 *     volle Aufnahme (0,0011). Der Schalter wird also still verworfen. Wer
 *     damit misst, bekommt „still" und glaubt an eine saubere Umschaltung.
 *
 * WAS ES AN DER BOX AENDERT
 *   Es startet, haelt an, und pausiert mpv fuer eine Ablesung. Am Ende steht
 *   IMMER ein `stop` (finally). Es schreibt NICHT in resume.json (kein
 *   POST /api/weiterhoeren), es aendert KEINE Lautstaerke und KEINE
 *   Stummschaltung (die merkt sich PipeWire je Anwendung — das waere eine
 *   dauerhafte Veraenderung). Es rollt nichts aus. Aufnahmen liegen in /tmp.
 *
 * AUFRUF
 *   node tools/dienstwechsel-am-geraet.mjs --liste
 *   node tools/dienstwechsel-am-geraet.mjs --sorte spotify-ard
 *   node tools/dienstwechsel-am-geraet.mjs --alle
 *   node tools/dienstwechsel-am-geraet.mjs --alle --pruefen   # 1 bei Befund
 *
 *   --box 192.168.178.169
 *   --fenster 4    Sekunden je Ablesung. UNTER 3 s IST ES RAUSCHEN: parec
 *                  puffert 64 kB, bevor es das erste Byte schreibt.
 *   --runden 2     Ablesungen zwischen Wechsel und Entscheidung
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const ausfuehren = promisify(execFile)

const args = process.argv.slice(2)
const opt = (name, standard = null) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : standard
}
const flag = (name) => args.includes(name)

const BOX = opt('--box', '192.168.178.169')
const BASIS = `http://${BOX}:8200`
const RAUM = 'current'
const SSH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=no', `dietpi@${BOX}`]
const FENSTER_S = Math.max(3, Number(opt('--fenster', '4')))
const RUNDEN = Math.max(1, Number(opt('--runden', '2')))
const PRUEFEN = flag('--pruefen')

/** Ab hier gilt der Mithoerausgang als HOERBAR. Ruhe gemessen: 0,0000–0,0011. */
const STILL = 0.02

const schlaf = (ms) => new Promise((f) => setTimeout(f, ms))

// ── Box ansprechen ────────────────────────────────────────────────────────

async function json(pfad) {
  const a = await fetch(`${BASIS}${pfad}`, { cache: 'no-store', headers: { accept: 'application/json' } })
  if (!a.ok) throw new Error(`HTTP ${a.status} bei ${pfad}`)
  return a.json()
}

/** Ein Befehl an den Abspieldienst — genau wie NewDesign/app.js ihn schickt. */
async function spielerBefehl(pfad) {
  const t0 = Date.now()
  try {
    const a = await fetch(`${BASIS}/player/${RAUM}/${pfad}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    let koerper = null
    try {
      koerper = await a.json()
    } catch {
      /* manche Antworten sind leer */
    }
    return { ok: a.ok, status: a.status, ms: Date.now() - t0, koerper }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, fehler: String(e) }
  }
}

/**
 * Ein Skript auf der Box laufen lassen — UEBER base64, nicht als Zeile.
 *
 * WARUM DER UMWEG: zwischen der hiesigen Shell (fish), ssh und der bash auf
 * der Box werden Anfuehrungszeichen, `&` und `*` DREIMAL ausgelegt; ein
 * Hintergrundbefehl gefolgt von `;` war prompt ein Syntaxfehler. base64 hat
 * keine Sonderzeichen — was hier steht, kommt drueben genau so an.
 */
async function ueberSsh(skript) {
  const b64 = Buffer.from(skript, 'utf8').toString('base64')
  const { stdout } = await ausfuehren('ssh', [...SSH, `echo ${b64} | base64 -d | bash`], {
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

// ── Die Ablesung ──────────────────────────────────────────────────────────

/**
 * Eine Ablesung: Pegel am Mithoerausgang + was mpv ueber sich selbst sagt.
 *
 * @param mpvAnhalten  mpv VOR der Aufnahme pausieren. Dann ist der gemessene
 *                     Pegel der von librespot ALLEIN — die entscheidende
 *                     Ablesung.
 */
function ablesungSkript(mpvAnhalten) {
  return `
export XDG_RUNTIME_DIR=/run/user/1000
python3 - <<'PY'
import glob, json, os, socket, subprocess, time, array, wave

# DEN LEBENDEN SOCKET SUCHEN, NICHT DEN MIT DEM GROESSTEN NAMEN.
# Auf .169 lagen am 05.08.2026 DREI Sockets herum; zwei stammten von mpv-
# Prozessen, die es nicht mehr gibt (der Aufsatz raeumt nur beim eigenen
# 'close' auf, ein Abschuss laesst die Datei liegen). Der Name traegt die
# Prozessnummer, und die faengt nach einem Neustart wieder klein an — der
# lebende Socket ist also NICHT verlaesslich der letzte in der Sortierung.
# Wer trotzdem den letzten nimmt, bekommt "Connection refused", schluckt es
# im except und misst von da an ein mpv, das nichts sagt: mpvSpielt waere
# immer False, und ZWEI TOENE saehen aus wie einer.
# (KEINE BACKTICKS hier: dieses Skript steht in einer JS-Vorlagenzeichenkette.)
def _lebender():
    for pfad in sorted(glob.glob('/tmp/mupibox-mpv-*.sock'), reverse=True):
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(1.0)
            s.connect(pfad)
            s.close()
            return pfad
        except Exception:
            continue
    return None

SOCKETS = [_lebender()] if _lebender() else []

def mpv(befehl):
    """Eine Frage an das mpv DER BOX. Kein eigenes mpv, kein Eingriff."""
    if not SOCKETS:
        return None
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(2.0)
        s.connect(SOCKETS[-1])
        s.send((json.dumps({'command': befehl}) + '\\n').encode())
        roh = b''
        ende = time.time() + 2.0
        while time.time() < ende:
            try:
                teil = s.recv(65536)
            except socket.timeout:
                break
            if not teil:
                break
            roh += teil
            if b'\\n' in teil:
                break
        s.close()
        for z in roh.decode('utf8', 'replace').splitlines():
            try:
                a = json.loads(z)
            except Exception:
                continue
            if 'error' in a:
                return a.get('data')
        return None
    except Exception:
        return None

zustand = {
    'idle': mpv(['get_property', 'idle-active']),
    'pause': mpv(['get_property', 'pause']),
    'pfad': mpv(['get_property', 'path']),
    'titel': mpv(['get_property', 'media-title']),
}
t1 = mpv(['get_property', 'time-pos'])
time.sleep(0.8)
t2 = mpv(['get_property', 'time-pos'])
# LAEUFT DIE ZEIT WEITER? Das ist die einzige Auskunft, die nicht luegen kann:
# ein pausiertes oder leerlaufendes mpv gibt keinen Ton ab, und ein spielendes
# schiebt time-pos weiter. pause und idle-active sagen dasselbe noch
# einmal — sie stehen mit da, damit ein Widerspruch auffaellt.
zustand['zeit'] = [t1, t2]
zustand['mpvSpielt'] = bool(
    isinstance(t1, (int, float)) and isinstance(t2, (int, float)) and (t2 - t1) > 0.2
)

${mpvAnhalten ? "mpv(['set_property', 'pause', True])\ntime.sleep(1.0)" : ''}

senke = ''
for z in subprocess.run(['pactl', 'get-default-sink'], capture_output=True, text=True).stdout.splitlines():
    z = z.strip()
    if z and ' ' not in z and '.' in z:
        senke = z
# MINDESTENS DREI SEKUNDEN: parec puffert 64 kB, bevor es das erste Byte
# schreibt. Kuerzere Fenster liefern NULL Byte — also „still", egal was laeuft.
subprocess.run(
    ['bash', '-c',
     'timeout ${FENSTER_S}s parec --device=%s.monitor --format=s16le --rate=22050 '
     '--channels=1 --raw > /tmp/mupi-dw.raw 2>/dev/null' % senke],
    check=False,
)
try:
    d = open('/tmp/mupi-dw.raw', 'rb').read()
except Exception:
    d = b''
a = array.array('h')
a.frombytes(d[: len(d) // 2 * 2])
zustand['senke'] = senke
zustand['rahmen'] = len(a)
zustand['spitze'] = (max(abs(x) for x in a) / 32768.0) if len(a) else -1.0
print('ERGEBNIS ' + json.dumps(zustand))
PY
`
}

async function ablesen(mpvAnhalten = false) {
  const roh = await ueberSsh(ablesungSkript(mpvAnhalten))
  const zeile = roh.split('\n').find((z) => z.startsWith('ERGEBNIS '))
  if (!zeile) throw new Error(`keine Ablesung von der Box:\n${roh.slice(0, 400)}`)
  return JSON.parse(zeile.slice(9))
}

/**
 * DAS PAUSIEREN ZURUECKNEHMEN — sonst hinterlaesst die Messung ein STUMMES mpv.
 *
 * GEKOSTET AM 05.08.2026, und es hat fast einen falschen Befund erzeugt: die
 * entscheidende Ablesung setzt `pause=true` auf dem mpv DER BOX und nahm es nie
 * zurueck. `stop` raeumt die Warteschlange, aber NICHT dieses Merkmal. Der
 * naechste Lauf startete daraufhin eine ARD-Folge, mpv meldete brav den Titel,
 * und am Ausgang war 0,0000 — was wie „die Box spielt ARD nicht" aussieht und
 * in Wahrheit die eigene Messung von vorhin war. Ein Kind haette dieselbe
 * stumme Box vorgefunden.
 */
async function mpvFortsetzen() {
  await ueberSsh(`
export XDG_RUNTIME_DIR=/run/user/1000
python3 - <<'PY'
import glob, json, socket
# ALLE Sockets versuchen, die toten fallen durch das except. Anders als beim
# Ablesen ist hier keine Auswahl noetig: was nicht antwortet, gibt es nicht.
for pfad in sorted(glob.glob('/tmp/mupibox-mpv-*.sock')):
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(2.0)
        s.connect(pfad)
        s.send((json.dumps({'command': ['set_property', 'pause', False]}) + '\\n').encode())
        s.close()
    except Exception:
        pass
print('FORTGESETZT')
PY
`)
}

// ── Die Quellen, und wie die Oberflaeche sie startet ──────────────────────

async function werkeHolen() {
  const d = await json('/api/werke?verschmelzen=0')
  return d.werke || []
}

const mitDienst = (werke, dienst, art = null) =>
  werke.find((w) => (w.quellen || []).some((q) => q.dienst === dienst) && (art ? w.art === art : true))

/** Der Spotify-Ein-Befehl-Start, wie `startPlan` in spielfunktion.ts ihn baut. */
function spotifyBefehl(w) {
  const q = (w.quellen || []).find((x) => x.dienst === 'spotify')
  if (!q) return null
  const id = String(q.kennung || '').split(':').pop()
  const typ = { album: 'album', playlist: 'playlist', show: 'show' }[w.art]
  // NUR EINE ECHTE SPOTIFY-KENNUNG. Auf .169 steht in der Bibliothek ein
  // Eintrag „External Playback" mit der Kennung `t:unknown|external playback`
  // — das ist der Merker fuer eine von aussen uebernommene Wiedergabe, kein
  // Album. `split(':').pop()` machte daraus die „Kennung"
  // `unknown|external playback`, der Startbefehl ging hinaus, der Dienst
  // antwortete 200, und es kam kein Ton. Der Lauf meldete daraufhin
  // „UNENTSCHIEDEN (Vorlauf lief nicht)" und sah aus wie ein Boxfehler.
  // Spotify-Kennungen sind 22 Zeichen base62 — daran wird geprueft.
  if (!typ || !/^[A-Za-z0-9]{22}$/.test(id)) return null
  return `spotify/now/spotify:${typ}:${encodeURIComponent(id)}:0:0`
}

/**
 * Eine Quelle starten — DIE OBERFLAECHE NACHGEBILDET, samt ihrem eigenen
 * `stop`. Das ist der ganze Sinn: gemessen wird der Wechsel, wie ein Kind ihn
 * ausloest, nicht ein selbst erfundener Ablauf, der zufaellig sauber ist.
 *   spotify        stop (abgewartet) + Ein-Befehl-Start
 *   ard/jellyfin   stop + erster Befehl (+ anhaengen)
 *
 * ACHTUNG, STAND 31.08.2026 — DIESE NACHBILDUNG IST EINEN SCHRITT HINTEN.
 * Bis E95/V Stufe 2 tat die Oberflaeche genau das oben: `ausQuelleSpielen`
 * baute mit `abspielBefehl` selbst und schickte `stop` davor — beides heute
 * geloescht, der Bau steckt in `startPlan` (spielfunktion.ts). Seit Stufe 3
 * gibt es beide Funktionen nicht mehr — die Oberflaeche schickt EINEN
 * `POST /api/spielen`, und `stop`, Befehlsbau und Anhaengen macht der Server.
 * Was hier gemessen wird, ist also der Weg der KLASSISCHEN Oberflaeche und
 * der Maschinen-Bedienung, nicht mehr der Weg des Kindes in der neuen.
 * Das ist [[attrappe-luegt-durch-weglassen]] im Messwerkzeug — dieselbe
 * Falle, vor der `titelListe()` unten warnt, eine Ebene hoeher. Wer die
 * Sonde das naechste Mal braucht, laesst sie ueber `POST /api/spielen`
 * starten, statt den Ablauf hier ein zweites Mal zu fuehren.
 */
async function starten(w, dienst, abTitel = 0) {
  const geschickt = []
  const merken = async (pfad) => {
    const a = await spielerBefehl(pfad)
    geschickt.push({ pfad: pfad.slice(0, 70), status: a.status, ms: a.ms, angehalten: a.koerper?.angehalten })
    return a
  }

  if (dienst === 'spotify') {
    const befehl = spotifyBefehl(w)
    if (!befehl) throw new Error(`kein Spotify-Ein-Befehl-Start fuer ${w.schluessel}`)
    await merken('stop')
    await merken(befehl)
    return geschickt
  }

  // ard und jellyfin-Album gehen ueber /inhalt — je Titel ein FERTIGER Befehl,
  // weil eine ARD-Tonadresse ablaeuft und ein Album eine Liste ist.
  const d = await json(`/api/werke/${encodeURIComponent(w.schluessel)}/inhalt?verschmelzen=0`)
  const titel = (d.titel || []).filter((t) => t.befehl)
  if (!titel.length) throw new Error(`keine abspielbaren Titel bei ${w.schluessel}`)
  await merken('stop')
  await merken(titel[Math.min(abTitel, titel.length - 1)].befehl)
  return geschickt
}

/**
 * DIE TITELLISTE EINES WERKS — mit den FERTIGEN Anhaeng-Befehlen.
 *
 * Gebraucht fuer den Nachzuegler-Fall: `albumSpielen` in NewDesign/app.js
 * schickt nicht EINEN Befehl, sondern den ersten Titel UND danach je einen
 * `ardqueue`/`jfqueue` fuer jeden weiteren. Wer nur den ersten schickt (so tat
 * es `starten()` bis zum 05.08.2026), misst eine Oberflaeche, die es nicht
 * gibt — [[attrappe-luegt-durch-weglassen]], diesmal im Messwerkzeug selbst.
 */
async function titelListe(w) {
  const d = await json(`/api/werke/${encodeURIComponent(w.schluessel)}/inhalt?verschmelzen=0`)
  return (d.titel || []).filter((t) => t.befehl)
}

// ── Darstellung ───────────────────────────────────────────────────────────

function zeile(marke, a, currentPlayer) {
  const t = (a.titel || a.pfad || '').toString().replace(/\s+/g, ' ').slice(0, 34)
  return (
    `    ${marke.padEnd(20)} Ausgang ${String(a.spitze.toFixed(4)).padStart(7)}   ` +
    `mpv ${(a.mpvSpielt ? 'SPIELT' : a.idle ? 'leer' : a.pause ? 'pause' : 'still').padEnd(7)} ` +
    `${(currentPlayer || '—').padEnd(9)} ${t}`
  )
}

// ── Eine Sorte messen ─────────────────────────────────────────────────────

async function sorteMessen(s) {
  console.log(`\n── ${s.name} ${'─'.repeat(Math.max(0, 54 - s.name.length))}`)
  const befund = { id: s.id, name: s.name, ruheOk: false, vorlaufOk: false, gemischt: null, zeilen: [] }
  try {
    // ── 0. RUHE. Ohne diese Grundlinie ist jede Zahl danach wertlos: ein
    //       Rest aus dem vorigen Lauf saehe genauso aus wie ein Befund.
    //       Und ZUERST das Pausenmerkmal zuruecknehmen — siehe mpvFortsetzen.
    await spielerBefehl('stop')
    await mpvFortsetzen()
    await schlaf(2000)
    const ruhe = await ablesen()
    befund.ruheOk = ruhe.spitze <= STILL
    console.log(zeile('RUHE', ruhe, null))
    if (!befund.ruheOk) console.log('    ⚠ Es klingt schon vor dem Start — dieser Lauf beweist nichts.')

    // ── 1. Die ERSTE Quelle spielt ────────────────────────────────────────
    await starten(s.von[0], s.von[1], 0)
    await schlaf(6000)
    const vor = await ablesen()
    const zVor = await fetch(`${BASIS}/player/local`).then(
      (a) => a.json(),
      () => null,
    )
    console.log(zeile(`VOR (${s.von[1]})`, vor, zVor?.currentPlayer))
    befund.vorlaufOk = vor.spitze > STILL
    befund.vorTitel = vor.titel || null
    if (!befund.vorlaufOk) {
      console.log('    ⚠ Die erste Quelle war nicht zu hoeren — dieser Lauf beweist NICHTS.')
      return befund
    }

    // ── 2. DER WECHSEL ────────────────────────────────────────────────────
    const t0 = Date.now()
    befund.geschickt = await starten(s.nach[0], s.nach[1], s.abTitel || 0)

    // ── 3. Die Zeitleiste — sagt, OB der Befund bleibt oder nur ein
    //       Nachlauf von Sekundenbruchteilen ist.
    for (let i = 0; i < RUNDEN; i++) {
      const a = await ablesen()
      const z = await fetch(`${BASIS}/player/local`).then(
        (x) => x.json(),
        () => null,
      )
      console.log(zeile(`+${((Date.now() - t0) / 1000).toFixed(1)}s`, a, z?.currentPlayer))
      befund.zeilen.push({ ab: Date.now() - t0, spitze: a.spitze, mpvSpielt: a.mpvSpielt, titel: a.titel })
    }

    // ── 4. DIE ENTSCHEIDUNG. mpv wird angehalten; was jetzt noch klingt,
    //       ist librespot. Vorher noch einmal fragen, ob mpv gerade spielt —
    //       beides zusammen ergibt „zwei zugleich".
    const vorEntscheid = befund.zeilen[befund.zeilen.length - 1]
    const ohne = await ablesen(true)
    console.log(zeile('mpv angehalten', ohne, null))
    const librespotSpielt = ohne.spitze > STILL
    befund.mpvSpielte = !!vorEntscheid?.mpvSpielt
    befund.librespotSpielt = librespotSpielt
    befund.nachTitel = vorEntscheid?.titel || null
    befund.gemischt = befund.mpvSpielte && librespotSpielt
  } finally {
    await spielerBefehl('stop')
    // Die Box so hinterlassen, wie sie gefunden wurde — auch wenn mitten im
    // Lauf etwas geworfen hat.
    await mpvFortsetzen()
  }

  if (befund.gemischt) {
    console.log('    ▸ ZWEI TOENE ZUGLEICH: mpv spielte, und nach dem Anhalten von mpv klang es weiter.')
  } else if (befund.mpvSpielte || befund.librespotSpielt) {
    console.log(`    ▸ sauber: nur ${befund.mpvSpielte ? 'mpv' : 'librespot'} war zu hoeren.`)
  } else {
    console.log('    ▸ nach dem Wechsel war NICHTS zu hoeren — eigener Fehler, kein Mischen.')
  }
  return befund
}

// ── Der Nachzuegler ───────────────────────────────────────────────────────

/**
 * WAS PASSIERT, WENN WAEHREND DES ANHAENGENS GEWECHSELT WIRD?
 *
 * DER FALL, DEN DIE NEUN PAARE NICHT STELLEN. `albumSpielen` (NewDesign
 * app.js) und `playJellyfinAlbum` (player.service.ts) schicken nicht EINEN
 * Befehl, sondern:
 *     stop  ->  erster Titel  ->  ardqueue/jfqueue fuer JEDEN weiteren
 * Diese Schleife ist durch NICHTS abgesichert. Tippt ein Kind mittendrin eine
 * andere Kachel, laeuft sie WEITER — und ihre uebrigen Befehle treffen auf die
 * schon gewechselte Box.
 *
 * WARUM DAS ZWEI TOENE ERGIBT, und nicht nur eine falsche Warteschlange:
 * `ardqueue`/`jfqueue` landen im Abspieldienst bei `player.queue()`, und das
 * ist in mpv `loadfile <adresse> append-play`. APPEND-PLAY FAENGT AN ZU
 * SPIELEN, wenn nichts laeuft. Nach dem Wechsel auf Spotify laeuft in mpv
 * nichts — der Nachzuegler startet die Maschine also neu, waehrend librespot
 * spielt. Und der Zweig fasst `currentMeta.currentPlayer` NICHT an: der Dienst
 * meldet weiter 'spotify', die Oberflaeche zeigt Spotify, und ein spaeteres
 * `stop` haelt nur Spotify an.
 *
 * GEMESSEN WIRD IN ZWEI STUFEN, damit der Befund nicht von der Tippgeschwindig-
 * keit eines Menschen abhaengt:
 *   'mitten'   der Wechsel faellt zwischen zwei Anhaeng-Befehle (der echte Fall)
 *   'danach'   ein EINZELNER Anhaeng-Befehl trifft die schon laufende
 *              Spotify-Wiedergabe (dieselbe Ursache, ohne jedes Wettrennen —
 *              die Gegenprobe, die sagt, ob der Zeitpunkt ueberhaupt zaehlt)
 */
async function nachzueglerMessen(albumWerk, albumDienst, spotifyWerk, art) {
  const name = `Nachzuegler ${art} (${albumDienst} -> Spotify)`
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 54 - name.length))}`)
  const befund = { id: `nachzuegler-${art}`, name, ruheOk: false, vorlaufOk: false, gemischt: null, zeilen: [] }
  try {
    await spielerBefehl('stop')
    await mpvFortsetzen()
    await schlaf(2000)
    const ruhe = await ablesen()
    befund.ruheOk = ruhe.spitze <= STILL
    console.log(zeile('RUHE', ruhe, null))

    const titel = await titelListe(albumWerk)
    console.log(`    (${titel.length} Titel, davon ${Math.max(0, titel.length - 1)} zum Anhaengen)`)
    const spBefehl = spotifyBefehl(spotifyWerk)

    // ── Das Album so starten, wie die Oberflaeche es tut ──────────────────
    await spielerBefehl('stop')
    await spielerBefehl(titel[0].befehl)

    let gewechseltNach = null
    if (art === 'mitten') {
      // DER WECHSEL MITTEN IN DIE SCHLEIFE. Nach dem dritten Anhaengen —
      // frueh genug, dass noch viele folgen.
      for (let i = 1; i < titel.length; i++) {
        if (i === 4) {
          gewechseltNach = i
          await spielerBefehl('stop')
          await spielerBefehl(spBefehl)
        }
        if (titel[i].anhaengen) await spielerBefehl(titel[i].anhaengen)
      }
    } else {
      // ERST DAS GANZE ALBUM ANHAENGEN, dann wechseln, DANN ein einzelner
      // Nachzuegler. Ohne Wettrennen — es zaehlt allein, was ein
      // Anhaeng-Befehl auf einer Spotify-Box anrichtet.
      for (let i = 1; i < titel.length; i++) {
        if (titel[i].anhaengen) await spielerBefehl(titel[i].anhaengen)
      }
      await schlaf(3000)
      await spielerBefehl('stop')
      await spielerBefehl(spBefehl)
      await schlaf(4000)
      gewechseltNach = titel.length
      if (titel[1]?.anhaengen) await spielerBefehl(titel[1].anhaengen)
    }
    befund.gewechseltNach = gewechseltNach

    const t0 = Date.now()
    for (let i = 0; i < RUNDEN; i++) {
      const a = await ablesen()
      const z = await fetch(`${BASIS}/player/local`).then(
        (x) => x.json(),
        () => null,
      )
      console.log(zeile(`+${((Date.now() - t0) / 1000).toFixed(1)}s`, a, z?.currentPlayer))
      befund.zeilen.push({ ab: Date.now() - t0, spitze: a.spitze, mpvSpielt: a.mpvSpielt, titel: a.titel })
    }

    const vorEntscheid = befund.zeilen[befund.zeilen.length - 1]
    const ohne = await ablesen(true)
    console.log(zeile('mpv angehalten', ohne, null))
    befund.vorlaufOk = true
    befund.mpvSpielte = !!vorEntscheid?.mpvSpielt
    befund.librespotSpielt = ohne.spitze > STILL
    befund.gemischt = befund.mpvSpielte && befund.librespotSpielt
  } finally {
    await spielerBefehl('stop')
    await mpvFortsetzen()
  }

  if (befund.gemischt) {
    console.log('    ▸ ZWEI TOENE ZUGLEICH: mpv spielte, und nach dem Anhalten von mpv klang es weiter.')
  } else if (befund.mpvSpielte || befund.librespotSpielt) {
    console.log(`    ▸ sauber: nur ${befund.mpvSpielte ? 'mpv' : 'librespot'} war zu hoeren.`)
  } else {
    console.log('    ▸ nach dem Wechsel war NICHTS zu hoeren — eigener Fehler, kein Mischen.')
  }
  return befund
}

// ── Die Sorten ────────────────────────────────────────────────────────────

/**
 * ALLE PAARE, NICHT NUR DIE MIT ARD.
 *
 * NACHGESCHOBEN AM 05.08.2026, woertlich: „das ton problem gilt fuer alle
 * dienste untereinander". Damit ist es kein ARD-Befund mehr, sondern einer des
 * DIENSTWECHSELS — und eine Auswahl von fuenf Paaren waere genau die
 * [[attrappe-luegt-durch-weglassen]]-Falle in Messerform: Die Frage ist nicht
 * „stelle ich den Fall?", sondern „welche SORTEN gibt es, und stelle ich von
 * jeder eine?"
 *
 * Gebaut wird deshalb das VOLLE Kreuzprodukt ueber die Dienste, die auf DIESER
 * Box wirklich ein Werk haben. Was fehlt, wird beim Namen genannt statt
 * stillschweigend weggelassen (`fehlend`).
 *
 * DER WECHSEL AUF SICH SELBST GEHOERT DAZU. Er ist der Fall, bei dem beide
 * Toene aus DERSELBEN Maschine kaemen — bei mpv raeumt `loadfile … replace`
 * auf, bei Spotify der neue Startbefehl. Faellt er trotzdem durch, ist die
 * Ursache eine andere als der Wettlauf zwischen zwei Maschinen.
 */
async function sortenBauen() {
  const werke = await werkeHolen()

  // Je Dienst ZWEI Werke, wenn es sie gibt: der Wechsel auf sich selbst soll
  // ein ANDERES Stueck starten, sonst misst man „derselbe Ton laeuft weiter"
  // und kann ihn nicht von „der alte lief weiter" unterscheiden.
  const spotifyWerke = werke.filter((w) => spotifyBefehl(w))
  const jellyfinWerke = werke.filter((w) => (w.quellen || []).some((q) => q.dienst === 'jellyfin') && w.art === 'album')
  const ardWerke = werke.filter((w) => (w.quellen || []).some((q) => q.dienst === 'ard'))
  const lokalWerke = werke.filter((w) => (w.quellen || []).some((q) => q.dienst === 'lokal'))
  const rssWerke = werke.filter((w) => (w.quellen || []).some((q) => q.dienst === 'rss'))

  const vorrat = {
    spotify: spotifyWerke,
    jellyfin: jellyfinWerke,
    ard: ardWerke,
    lokal: lokalWerke,
    rss: rssWerke,
  }
  const REIHE = ['spotify', 'jellyfin', 'ard', 'lokal', 'rss']
  const NAME = { spotify: 'Spotify', jellyfin: 'Jellyfin', ard: 'ARD', lokal: 'lokal', rss: 'RSS' }

  const s = []
  for (const von of REIHE) {
    for (const nach of REIHE) {
      const a = vorrat[von][0]
      // Beim Wechsel auf denselben Dienst das ZWEITE Werk nehmen; gibt es nur
      // eines (die ARD hat auf .169 genau eine Sendung), dann dasselbe Werk,
      // aber eine andere Folge (`abTitel`).
      const b = von === nach ? vorrat[nach][1] || vorrat[nach][0] : vorrat[nach][0]
      if (!a || !b) continue
      const selbst = von === nach && b === a
      s.push({
        id: `${von}-${nach}`,
        name: `${NAME[von]} -> ${NAME[nach]}${selbst ? ' (anderer Titel)' : ''}`,
        von: [a, von],
        nach: [b, nach],
        abTitel: selbst ? 7 : 0,
      })
    }
  }
  // Die beiden Nachzuegler-Faelle: nur zu stellen, wo es ein Werk MIT
  // Titelliste gibt (ard, jellyfin-Album) UND einen Spotify-Start.
  const mitListe = ardWerke[0] ? ['ard', ardWerke[0]] : jellyfinWerke[0] ? ['jellyfin', jellyfinWerke[0]] : null
  if (mitListe && spotifyWerke[0]) {
    for (const art of ['mitten', 'danach']) {
      s.push({
        id: `nachzuegler-${art}`,
        name: `Nachzuegler ${art} (${mitListe[0]} -> Spotify)`,
        nachzuegler: { art, albumWerk: mitListe[1], albumDienst: mitListe[0], spotifyWerk: spotifyWerke[0] },
      })
    }
  }

  const fehlend = Object.fromEntries(REIHE.map((d) => [d, vorrat[d].length === 0]))
  return { sorten: s, fehlend }
}

// ── Hauptlauf ─────────────────────────────────────────────────────────────

const { sorten, fehlend } = await sortenBauen()

if (flag('--liste') || (!flag('--alle') && !opt('--sorte'))) {
  console.log(`Box ${BOX} — messbare Sorten:`)
  for (const s of sorten) console.log(`  ${s.id.padEnd(14)} ${s.name}`)
  const weg = Object.entries(fehlend)
    .filter(([, f]) => f)
    .map(([d]) => d)
  if (weg.length) console.log(`\nNICHT messbar — auf dieser Box steht kein Werk dieser Art: ${weg.join(', ')}`)
  console.log('\n  --alle | --sorte <id>')
  process.exit(0)
}

const gewaehlt = flag('--alle') ? sorten : sorten.filter((s) => s.id === opt('--sorte'))
if (!gewaehlt.length) {
  console.error(`Sorte '${opt('--sorte')}' gibt es hier nicht. --liste zeigt, was geht.`)
  process.exit(2)
}

console.log(`Box ${BOX}   Fenster ${FENSTER_S}s   Runden ${RUNDEN}   hoerbar ab ${STILL}`)

const befunde = []
try {
  for (const s of gewaehlt) {
    const n = s.nachzuegler
    befunde.push(n ? await nachzueglerMessen(n.albumWerk, n.albumDienst, n.spotifyWerk, n.art) : await sorteMessen(s))
    await spielerBefehl('stop')
    await schlaf(1500)
  }
} finally {
  await spielerBefehl('stop')
}

console.log(`\n══ ZUSAMMENFASSUNG ${'═'.repeat(42)}`)
for (const b of befunde) {
  const wie = !b.vorlaufOk
    ? 'UNENTSCHIEDEN (Vorlauf lief nicht)'
    : b.gemischt
      ? 'MISCHT — zwei Toene zugleich'
      : 'sauber'
  console.log(`  ${b.name.padEnd(28)} ${wie}`)
}

if (PRUEFEN && befunde.some((b) => b.gemischt)) process.exit(1)
