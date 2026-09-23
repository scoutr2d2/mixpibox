#!/usr/bin/env node
/*
 * WOHER KOENNTE DER TITELNAME KOMMEN — und zwar an der laufenden Box, nicht
 * aus der mpv-Dokumentation.
 *
 * ══ DIE FRAGE ══════════════════════════════════════════════════════════════
 * F1 ist gemessen und unstrittig: `currentTrackname` geht bei mpv NIE mit
 * ([[mpv-trackname-geht-nie-mit]]). Offen ist nur, WO man es repariert:
 *
 *   WEG A — OBERFLAECHE. Der Name wird nachgeschlagen, so wie das Cover seit
 *           dem 06.08.2026 ([[cover-folgt-der-position-nicht-dem-start]]):
 *           Liste merken, ueber `currentTracknr` nachsehen. Heilt NUR die
 *           neue Oberflaeche.
 *   WEG B — ABSPIELDIENST. mpv kennt `media-title`. Traegt diese Eigenschaft
 *           je Titel den RICHTIGEN Namen, gehoert die Reparatur dorthin —
 *           dann ist die klassische Oberflaeche mitgeheilt, und jeder weitere
 *           Leser von /player/local ebenso.
 *
 * Weg B ist der bessere — WENN er traegt. Ob er traegt, kann man nicht lesen,
 * sondern nur messen: Bei ARD steht in den MP3-Merkmalen der Ausspielpartner
 * der SENDUNGSNAME statt des Folgentitels (deshalb schliesst der
 * metadata-Hoerer in spotify-control.ts 'ard' ausdruecklich aus), und beim
 * Jellyfin-Strom ist der Pfad eine /Audio/<id>/stream-Adresse ohne Namen.
 * `media-title` faellt in mpv auf genau diese beiden zurueck, wenn es nichts
 * Besseres gibt. Es kann also alles Richtige liefern — oder genau die
 * Doppelung, die `titleClean` in ard.ts wegnimmt.
 *
 * ══ WAS DIESES WERKZEUG MISST ══════════════════════════════════════════════
 * Es stellt DREI Auskuenfte nebeneinander, im selben Augenblick:
 *
 *   [dienst]  /player/local  -> currentTrackname, currentTracknr, duration
 *   [mpv]     der IPC-Socket -> media-title, metadata/title, playlist-pos-1,
 *                               filename, path
 *   [liste]   /api/werke/<s>/inhalt -> der Name, den die Position BEDEUTET
 *
 * Der dritte ist der Massstab. Ohne ihn saehe man nur, DASS zwei Felder
 * verschieden sind, nicht welches recht hat.
 *
 * ══ WARUM UEBER DEN SOCKET UND NICHT UEBER DEN DIENST ══════════════════════
 * Der Abspieldienst meldet `media-title` gar nicht — genau das ist ja die
 * Frage. Gefragt wird deshalb mpv selbst, ueber den `--input-ipc-server`, den
 * der laufende Prozess in seiner Befehlszeile nennt. NUR LESEN: es werden
 * ausschliesslich `get_property`-Anfragen gestellt, kein `set_property`, kein
 * `loadfile`. Die Wiedergabe merkt davon nichts.
 *
 * Der Socket-Pfad wird aus `ps` gelesen und NICHT geraten: in /tmp liegen
 * Socket-Dateien frueherer Laeufe herum (gemessen: zwei Stueck), und die
 * juengste Datei ist nicht zwingend die des laufenden Prozesses.
 *
 * ══ WAS ES AN DER BOX AENDERT ══════════════════════════════════════════════
 *   --lage        gar nichts. Nur lesen.
 *   --jellyfin    startet ein Jellyfin-Album und haengt Titel an. Am Ende
 *                 steht IMMER ein `stop` (finally).
 *   --ard         startet eine ARD-Sendung, wahlweise kurz vor dem Ende einer
 *                 Folge (--ab-ende N), um den Uebergang mitzuschreiben.
 * Es schreibt NICHTS in resume.json — es meldet keine Stelle. (Anders als
 * tools/stelle-je-dienst-am-geraet.mjs, das genau dafuer gebaut ist.)
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/titelname-je-quelle.mjs --lage
 *   node tools/titelname-je-quelle.mjs --jellyfin --sekunden 30
 *   node tools/titelname-je-quelle.mjs --ard --ab-ende 25 --sekunden 60
 *   node tools/titelname-je-quelle.mjs --jellyfin --pruefen     (Ampel)
 *
 *   --box <ip>       Vorgabe 192.168.178.169
 *   --takt <ms>      Abstand der Messungen (Vorgabe 2000)
 */

import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)
const opt = (name, vorgabe = null) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return vorgabe
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const hat = (name) => argv.includes(`--${name}`)

const BOX = String(opt('box', '192.168.178.169'))
const API = `http://${BOX}:8200/api`
const SPIELER = `http://${BOX}:8200/player`
const RAUM = 'current'
const SEKUNDEN = Number(opt('sekunden', 30)) || 30
const TAKT = Number(opt('takt', 2000)) || 2000
const PRUEFEN = hat('pruefen')

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms))

async function json(url, opts) {
  const a = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, ...opts })
  const text = await a.text()
  const typ = a.headers.get('content-type') || ''
  // DER CONTENT-TYPE IST DIE AUSKUNFT, NICHT DER CODE — Server und
  // Abspieldienst antworten auf JEDEN Pfad mit 200
  // ([[server-antwortet-200-auf-alles]]).
  if (!typ.includes('json')) throw new Error(`${url} -> ${a.status} ${typ} (${text.length} B) — kein JSON`)
  return JSON.parse(text)
}

const befehl = (pfad) =>
  fetch(`${SPIELER}/${RAUM}/${pfad}`, { cache: 'no-store', headers: { accept: 'application/json' } }).catch(() => null)

const lokal = () => json(`${SPIELER}/local`).catch(() => null)

/**
 * Kurz vor das Ende des laufenden Titels setzen — IN PROZENT.
 *
 * `seekpos:` NIMMT BEI mpv PROZENT, NICHT SEKUNDEN. Das steht in
 * spotify-control.ts an `seekAbsolut` („DIE EINHEIT BLEIBT JE ABSPIELER
 * VERSCHIEDEN … mplayer PROZENT"), und der erste Anlauf dieses Werkzeugs hat
 * es teuer gelernt: `seekpos:95` auf einem 140-s-Titel hiess nicht „bei
 * Sekunde 95", sondern „bei 95 %", und `seekpos:189` wurde auf 100 % geklemmt
 * — also ans Ende. Die Warteschlange lief daraufhin in wenigen Sekunden durch
 * und war leer, bevor die erste Messung geschrieben wurde. Die Ausgabe sah aus
 * wie „es laeuft nichts" und war in Wahrheit „das Werkzeug hat es beendet".
 */
async function kurzVorSchluss(abEndeSek) {
  const lo = await lokal()
  const dauer = Number(lo?.duration) || 0
  if (!(dauer > abEndeSek + 10)) {
    console.log(`  KEIN SPRUNG: gemeldete Dauer ${dauer} s reicht fuer --ab-ende ${abEndeSek} nicht`)
    return false
  }
  const prozent = Math.max(0, Math.min(99, ((dauer - abEndeSek) / dauer) * 100))
  await befehl(`seekpos:${prozent.toFixed(2)}`)
  console.log(`  auf ${prozent.toFixed(1)} % von ${dauer.toFixed(1)} s gesetzt (~${Math.round(dauer - abEndeSek)} s) — der Uebergang faellt in die Messung`)
  await schlaf(1500)
  return true
}

// ── DER TEIL, DER AUF DER BOX LAEUFT ───────────────────────────────────────
/*
 * EIN Python-Programm, EINE SSH-Sitzung, N Messungen. Der naheliegende Weg —
 * je Messung ein `ssh box python3 -c …` — kostet auf einem Pi jedes Mal einen
 * Verbindungsaufbau; bei 2 s Takt misst man dann den Aufbau mit. Ausserdem
 * liefe die Uhr der Messung im Sekundenbereich auseinander, und genau um
 * Sekunden geht es beim Titeluebergang.
 *
 * Es gibt KEIN set_property und kein loadfile in diesem Programm. Wer es
 * aendert, aendert damit auch die Aussage „die Wiedergabe merkt nichts davon".
 */
const SAMPLER_PY = String.raw`
import json, socket, subprocess, sys, time, urllib.request

def socketpfad():
    # Aus der BEFEHLSZEILE des laufenden mpv, nicht aus dem Dateidatum in /tmp:
    # dort liegen Sockets frueherer Laeufe.
    try:
        aus = subprocess.run(["ps", "-eo", "args"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return None
    for zeile in aus.splitlines():
        if "--input-ipc-server=" in zeile and zeile.strip().startswith("mpv"):
            for stueck in zeile.split():
                if stueck.startswith("--input-ipc-server="):
                    return stueck.split("=", 1)[1]
    return None

def frage(pfad, eigenschaften):
    """NUR get_property. Ein Socket je Messung — mpv haelt beliebig viele."""
    erg = {}
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(2.0)
        s.connect(pfad)
    except Exception as e:
        return {"_fehler": str(e)}
    try:
        puffer = b""
        for i, name in enumerate(eigenschaften, start=1):
            s.sendall((json.dumps({"command": ["get_property", name], "request_id": i}) + "\n").encode())
        ende = time.time() + 2.5
        offen = set(range(1, len(eigenschaften) + 1))
        while offen and time.time() < ende:
            try:
                teil = s.recv(65536)
            except socket.timeout:
                break
            if not teil:
                break
            puffer += teil
            while b"\n" in puffer:
                zeile, puffer = puffer.split(b"\n", 1)
                if not zeile.strip():
                    continue
                try:
                    d = json.loads(zeile.decode("utf-8", "replace"))
                except Exception:
                    continue
                rid = d.get("request_id")
                if rid in offen:
                    offen.discard(rid)
                    erg[eigenschaften[rid - 1]] = d.get("data") if d.get("error") == "success" else None
    finally:
        try:
            s.close()
        except Exception:
            pass
    return erg

EIGEN = ["media-title", "metadata", "playlist-pos-1", "playlist-count", "filename", "path", "duration", "time-pos"]

def dienst():
    # UEBER 8200/player/local UND NICHT UEBER 5005: der Abspieldienst haengt
    # hinter dem Proxy des Servers, und GENAU diese Antwort liest die
    # Oberflaeche. Der erste Anlauf fragte 5005/player/local — der Dienst
    # selbst kennt dort nur /local, antwortete aber (wie auf jeden Pfad) mit
    # 200 und JSON: {"status":"ok"}. Alle Felder leer, und die Messung sah
    # aus wie „der Dienst meldet nichts".
    try:
        with urllib.request.urlopen("http://localhost:8200/player/local", timeout=3) as a:
            return json.loads(a.read().decode("utf-8", "replace"))
    except Exception as e:
        return {"_fehler": str(e)}

takt = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0
dauer = float(sys.argv[2]) if len(sys.argv) > 2 else 30.0
ende = time.time() + dauer
pfad = socketpfad()
print(json.dumps({"_socket": pfad}), flush=True)
while time.time() < ende:
    m = {"t": time.strftime("%H:%M:%S"), "dienst": dienst()}
    m["mpv"] = frage(pfad, EIGEN) if pfad else {"_fehler": "kein laufender mpv gefunden"}
    print(json.dumps(m, ensure_ascii=False), flush=True)
    time.sleep(takt)
`

/** Startet den Sampler auf der Box und ruft `beiZeile` je Messung auf. */
function messenAufDerBox(taktSek, dauerSek, beiZeile) {
  return new Promise((fertig, schiefgegangen) => {
    const p = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', `dietpi@${BOX}`, `python3 - ${taktSek} ${dauerSek}`],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let rest = ''
    let fehlerText = ''
    p.stdout.on('data', (b) => {
      rest += b.toString()
      let i
      while ((i = rest.indexOf('\n')) >= 0) {
        const zeile = rest.slice(0, i)
        rest = rest.slice(i + 1)
        if (!zeile.trim()) continue
        try {
          beiZeile(JSON.parse(zeile))
        } catch {
          console.log(`  (unlesbar) ${zeile.slice(0, 160)}`)
        }
      }
    })
    p.stderr.on('data', (b) => {
      fehlerText += b.toString()
    })
    p.on('error', schiefgegangen)
    p.on('close', (code) => {
      if (code !== 0 && fehlerText.trim()) console.error(`  ssh: ${fehlerText.trim().slice(0, 300)}`)
      fertig()
    })
    p.stdin.write(SAMPLER_PY)
    p.stdin.end()
  })
}

// ── DARSTELLUNG ────────────────────────────────────────────────────────────
const kurz = (s, n = 34) => {
  const t = s == null ? '—' : String(s)
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Die Zeile, um die es geht: was DREI Quellen im selben Augenblick sagen. */
function zeigeMessung(m, listeTitel) {
  const d = m.dienst || {}
  const v = m.mpv || {}
  const meta = v.metadata && typeof v.metadata === 'object' ? v.metadata : {}
  const metaTitel = meta.title || meta.Title || null
  const nr = d.currentTracknr
  // DER MASSSTAB HAENGT AN mpvs EIGENER POSITION, nicht an der des Dienstes.
  // `currentTracknr` wird im Dienst teils gezaehlt und teils vorgesetzt
  // (`tracknr:` rechnet mit Deltas); wer den Namen dagegen prueft, prueft zwei
  // Unsicherheiten gegeneinander. `playlist-pos-1` ist die Stelle in genau der
  // Warteschlange, aus der mpv auch `media-title` nimmt.
  const pos = v['playlist-pos-1']
  const stelle = Number.isFinite(Number(pos)) && Number(pos) >= 1 ? Number(pos) : null
  const erwartet = listeTitel && stelle && stelle <= listeTitel.length ? listeTitel[stelle - 1] : null
  return {
    zeile: [
      `[${m.t}]`,
      `mpvPos=${pos == null ? '-' : pos}/${v['playlist-count'] ?? '-'}`,
      `dienstNr=${nr === '' ? '""' : nr}`,
      `t=${d.timePos == null ? '-' : Number(d.timePos).toFixed(1)}`,
      `dauer=${d.duration == null ? '-' : Number(d.duration).toFixed(1)}`,
      `| dienst=${JSON.stringify(kurz(d.currentTrackname))}`,
      `| media-title=${JSON.stringify(kurz(v['media-title']))}`,
      `| meta.title=${JSON.stringify(kurz(metaTitel))}`,
      `| liste[mpvPos]=${JSON.stringify(kurz(erwartet))}`,
    ].join(' '),
    nr,
    stelle,
    dienstName: d.currentTrackname || '',
    mediaTitle: v['media-title'] == null ? null : String(v['media-title']),
    erwartet,
  }
}

async function werke() {
  const d = await json(`${API}/werke?verschmelzen=1`)
  return Array.isArray(d?.werke) ? d.werke : []
}

async function inhalt(schluessel, wunschDienst = null) {
  const q = wunschDienst ? `&quelle=${encodeURIComponent(wunschDienst)}` : ''
  return json(`${API}/werke/${encodeURIComponent(schluessel)}/inhalt?verschmelzen=1${q}`)
}

// ── DIE LAEUFE ─────────────────────────────────────────────────────────────
async function lauf({ art, titelListe, vorlauf }) {
  const gesammelt = []
  const namen = titelListe.map((t) => t.titel)
  try {
    await vorlauf()
    console.log(`\nMESSUNG (${art}), ${SEKUNDEN} s im Takt von ${TAKT} ms:`)
    await messenAufDerBox(TAKT / 1000, SEKUNDEN, (m) => {
      if (m._socket !== undefined) {
        console.log(`  mpv-Socket: ${m._socket || 'NICHT GEFUNDEN'}`)
        return
      }
      const z = zeigeMessung(m, namen)
      console.log('  ' + z.zeile)
      gesammelt.push(z)
    })
  } finally {
    await befehl('stop').catch(() => null)
  }
  return { gesammelt, namen }
}

function auswerten(art, gesammelt) {
  // ES GEHT UM DEN UEBERGANG, nicht um den Startzustand. Beim ERSTEN Titel ist
  // auch der falsche Weg zufaellig richtig — der Name kam ja aus dem Befehl.
  const mitNr = gesammelt.filter((z) => z.stelle)
  const nrs = [...new Set(mitNr.map((z) => z.stelle))]
  const nachWechsel = nrs.length > 1 ? mitNr.filter((z) => z.stelle > Math.min(...nrs)) : []

  const stimmt = (a, b) => String(a || '').trim() === String(b || '').trim()
  const dienstTrifft = nachWechsel.filter((z) => z.erwartet && stimmt(z.dienstName, z.erwartet)).length
  const mediaTrifft = nachWechsel.filter((z) => z.erwartet && stimmt(z.mediaTitle, z.erwartet)).length
  const mitMassstab = nachWechsel.filter((z) => z.erwartet).length

  console.log(`\nBEFUND (${art}):`)
  console.log(`  Stellen der mpv-Warteschlange im Lauf: ${nrs.join(', ') || '(keine)'}`)
  if (nrs.length < 2) {
    console.log('  KEIN UEBERGANG ERFASST — ohne Wechsel beweist der Lauf nichts.')
    console.log('  (bei --ard: --ab-ende erhoehen; bei --jellyfin: --sekunden erhoehen)')
  }
  console.log(`  Messungen nach dem ersten Titel: ${nachWechsel.length}, davon mit Massstab: ${mitMassstab}`)
  console.log(`  currentTrackname trifft den Listennamen: ${dienstTrifft}/${mitMassstab}`)
  console.log(`  media-title       trifft den Listennamen: ${mediaTrifft}/${mitMassstab}`)
  const beispiele = [...new Set(nachWechsel.map((z) => `mpvPos=${z.stelle}  media-title=${JSON.stringify(z.mediaTitle)}  liste=${JSON.stringify(z.erwartet)}  dienst=${JSON.stringify(z.dienstName)}`))]
  for (const b of beispiele.slice(0, 6)) console.log(`    ${b}`)
  return { nrs, mitMassstab, dienstTrifft, mediaTrifft }
}

async function frageJellyfin() {
  const liste = await werke()
  const w = liste.find((x) => (x.quellen || []).some((q) => q.dienst === 'jellyfin'))
  if (!w) throw new Error('kein Jellyfin-Werk im Raster')
  const d = await inhalt(w.schluessel, 'jellyfin')
  const titel = (d.titel || []).filter((t) => t.befehl)
  console.log(`Jellyfin: „${w.titel}" — ${titel.length} Titel (Dienst laut /inhalt = ${d.dienst})`)
  titel.slice(0, 4).forEach((t, i) => console.log(`  ${i + 1}. ${t.titel}`))

  // KEIN `tracknr:`-SPRUNG MEHR IM VORLAUF. Der erste Anlauf sprang auf 2 und
  // landete auf 3 (gemessen 05.08.2026: `mpvPos=3` nach `tracknr:2`) — die
  // Sprungrechnung des Dienstes arbeitet mit Deltas auf `currentTracknr`.
  // Fuer DIESE Frage ist das ein zweiter Unsicherheitsfaktor ohne Nutzen:
  // gebraucht wird nur EIN natuerlicher Uebergang.
  const abEnde = Number(opt('ab-ende', 45)) || 45
  const { gesammelt } = await lauf({
    art: 'jellyfin',
    titelListe: titel,
    vorlauf: async () => {
      await befehl('stop')
      await schlaf(600)
      await befehl(titel[0].befehl)
      for (const t of titel.slice(1, 5)) await befehl(t.anhaengen)
      await schlaf(3000)
      // KURZ VOR DAS ENDE SETZEN statt Minuten zu warten. Der Vorlauf muss
      // GROSSZUEGIG sein: zwischen diesem Befehl und der ersten Messung liegen
      // der Aufbau der SSH-Sitzung und der Start des Python-Programms — beim
      // ersten Anlauf mit 12 s Vorlauf war der Uebergang schon vorbei, bevor
      // die erste Zeile geschrieben wurde.
      await kurzVorSchluss(abEnde)
    },
  })
  return auswerten('jellyfin', gesammelt)
}

async function frageArd() {
  const liste = await werke()
  const w = liste.find((x) => (x.quellen || []).some((q) => q.dienst === 'ard'))
  if (!w) throw new Error('kein ARD-Werk im Raster')
  const d = await inhalt(w.schluessel, 'ard')
  const titel = (d.titel || []).filter((t) => t.befehl)
  console.log(`ARD: „${w.titel}" — ${titel.length} Folgen`)
  titel.slice(0, 4).forEach((t, i) => console.log(`  ${i + 1}. ${t.titel}`))
  const abEnde = Number(opt('ab-ende', 25)) || 25

  const { gesammelt } = await lauf({
    art: 'ard',
    titelListe: titel,
    vorlauf: async () => {
      await befehl('stop')
      await schlaf(600)
      await befehl(titel[0].befehl)
      for (const t of titel.slice(1, 4)) await befehl(t.anhaengen)
      await schlaf(4000)
      await kurzVorSchluss(abEnde)
    },
  })
  return auswerten('ard', gesammelt)
}

async function frageLage() {
  console.log('NUR LESEN — es wird nichts gestartet und nichts angehalten.\n')
  await messenAufDerBox(1, 3, (m) => {
    if (m._socket !== undefined) {
      console.log(`  mpv-Socket: ${m._socket || 'NICHT GEFUNDEN'}`)
      return
    }
    const d = m.dienst || {}
    const v = m.mpv || {}
    console.log(`  [${m.t}] dienst: player=${d.currentPlayer || '-'} typ=${d.currentType || '-'} nr=${d.currentTracknr} name=${JSON.stringify(d.currentTrackname || '')}`)
    console.log(`          mpv:    media-title=${JSON.stringify(v['media-title'] ?? null)} pos=${v['playlist-pos-1'] ?? '-'}/${v['playlist-count'] ?? '-'} path=${JSON.stringify(kurz(v.path, 60))}`)
    if (v.metadata && typeof v.metadata === 'object') console.log(`          meta:   ${JSON.stringify(v.metadata).slice(0, 200)}`)
    if (v._fehler) console.log(`          mpv-FEHLER: ${v._fehler}`)
  })
}

// ── HAUPT ──────────────────────────────────────────────────────────────────
const berichte = []
try {
  if (hat('lage') || (!hat('jellyfin') && !hat('ard'))) await frageLage()
  if (hat('jellyfin')) berichte.push(await frageJellyfin())
  if (hat('ard')) berichte.push(await frageArd())
} catch (e) {
  console.error(`\nABBRUCH: ${e.message}`)
  process.exit(2)
}

if (PRUEFEN && berichte.length) {
  // DIE AMPEL SAGT NUR, OB WEG B TRAEGT — nicht, ob die Oberflaeche stimmt.
  const alleGetroffen = berichte.every((b) => b.mitMassstab > 0 && b.mediaTrifft === b.mitMassstab)
  const keinUebergang = berichte.some((b) => b.nrs.length < 2)
  if (keinUebergang) {
    console.log('\nUNENTSCHIEDEN: mindestens ein Lauf hatte keinen Titelwechsel.')
    process.exit(3)
  }
  console.log(alleGetroffen ? '\nWEG B TRAEGT: media-title nennt je Titel den Listennamen.' : '\nWEG B TRAEGT NICHT: media-title weicht vom Listennamen ab.')
  process.exit(alleGetroffen ? 0 : 1)
}
