#!/usr/bin/env node
/*
 * GEHT DER TITELNAME JETZT MIT? — die Abnahme zu BACKLOG F1, am Geraet.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * F1: `currentTrackname` blieb bei mpv auf dem Namen stehen, den der
 * STARTBEFEHL gesetzt hatte ([[mpv-trackname-geht-nie-mit]]). Rueckte mpv von
 * selbst zur naechsten Folge, ging der Name nicht mit — ab dem zweiten Titel
 * stand im Player dauerhaft der falsche Name.
 *
 * Behoben wird das im ABSPIELDIENST: der Name reist als Datei-Option
 * (`force-media-title`) im Warteschlangeneintrag mit, und mpv meldet ihn am
 * Uebergang von selbst zurueck ([[mpv-nimmt-den-titelnamen-an-force-media-title]]).
 *
 * ══ WARUM ES DIESES WERKZEUG BRAUCHT, obwohl Tests gruen sind ══════════════
 * Die reinen Schichten sind geprueft (mpv-protokoll.spec.ts,
 * mpv-wrapper.spec.ts, befehlspfad.spec.ts) und ihre Nahtstellen ueber
 * tools/rotprobe.py rot gefaerbt. NICHT geprueft ist damit die eine Naht, die
 * es in keinem Testlauf gibt: `spotify-control.ts` startet beim Laden einen
 * Server und braucht Konfigurationsdateien, die im Baum LEER sind (0 Byte) —
 * die Datei ist nicht importierbar. Ob der Zweig `jfqueue`/`ardqueue` den
 * Namen wirklich an `player.queue` uebergibt, kann deshalb nur die laufende
 * Box sagen.
 *
 * DIESES WERKZEUG IST ALSO KEIN BEIWERK ZU DEN TESTS, sondern der Ersatz fuer
 * den Test, den es nicht geben kann.
 *
 * ══ WAS ES MISST — DREI QUELLEN, EIN AUGENBLICK ════════════════════════════
 *   [dienst]  /player/local            currentTracknr + currentTrackname
 *                                      (das, was BEIDE Oberflaechen anzeigen)
 *   [mpv]     IPC-Socket               playlist-pos-1 + media-title
 *                                      (das, was die Maschine wirklich weiss)
 *   [liste]   /api/werke/<s>/inhalt    der Name, den die Stelle BEDEUTET
 *
 * Der Massstab ist die Liste. „Gruen" heisst: zu jeder gemessenen Stelle n
 * meldet der Dienst den Namen aus Zeile n — und zwar auch nach einem
 * Uebergang, den niemand befohlen hat.
 *
 * ══ HTTP 200 BEWEIST HIER NICHTS ═══════════════════════════════════════════
 * Server (8200) und Abspieldienst (5005) antworten auf JEDEN Pfad mit 200
 * ([[server-antwortet-200-auf-alles]]). Geprueft wird ausschliesslich der
 * INHALT; ein Abruf ohne JSON-Kopf gilt als Fehlschlag.
 *
 * ══ WAS ES AN DER BOX AENDERT ══════════════════════════════════════════════
 *   Es startet eine Wiedergabe und haelt sie am Ende mit `stop` wieder an.
 *   Es schreibt KEINE Nutzerdatei: kein POST /api/weiterhoeren, kein
 *   resume.json, keine Konfiguration. Ueber den Socket wird NUR GELESEN
 *   (`get_property`) — kein loadfile, kein set_property.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/f1-titelname-geht-mit.mjs --jellyfin
 *   node tools/f1-titelname-geht-mit.mjs --ard --ab-ende 25
 *   node tools/f1-titelname-geht-mit.mjs --jellyfin --sprung
 *
 *   --jellyfin | --ard   welche Quelle (Vorgabe: jellyfin)
 *   --sprung             zusaetzlich `tracknr:2` befehlen (befohlener Wechsel)
 *   --ab-ende <s>        kurz vor das Titelende setzen, damit der Uebergang
 *                        VON SELBST in die Messung faellt (Vorgabe 20)
 *   --sekunden <s>       wie lange gemessen wird (Vorgabe 70)
 *   --takt <ms>          Abstand der Messungen (Vorgabe 2000)
 *   --box <ip>           Vorgabe 192.168.178.169
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
const QUELLE = hat('ard') ? 'ard' : 'jellyfin'
const SEKUNDEN = Number(opt('sekunden', 70)) || 70
const TAKT = Number(opt('takt', 2000)) || 2000
const AB_ENDE = Number(opt('ab-ende', 20)) || 20
const SPRUNG = hat('sprung')

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms))

async function json(url, opts) {
  const a = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, ...opts })
  const text = await a.text()
  const typ = a.headers.get('content-type') || ''
  if (!typ.includes('json')) throw new Error(`${url} -> ${a.status} ${typ} (${text.length} B) — kein JSON`)
  return JSON.parse(text)
}

const befehl = (pfad) =>
  fetch(`${SPIELER}/${RAUM}/${pfad}`, { cache: 'no-store', headers: { accept: 'application/json' } }).catch(
    () => null,
  )
const lokal = () => json(`${SPIELER}/local`).catch(() => null)

// ── DER TEIL, DER AUF DER BOX LAEUFT ───────────────────────────────────────
/*
 * EIN Python-Programm, EINE SSH-Sitzung, N Messungen. Je Messung ein eigenes
 * `ssh` kostet auf einem Pi jedes Mal einen Verbindungsaufbau — bei 2 s Takt
 * misst man dann den Aufbau mit, und die Uhr liefe im Sekundenbereich
 * auseinander. Genau um Sekunden geht es beim Titeluebergang.
 *
 * ES GIBT HIER KEIN loadfile UND KEIN set_property. Wer das aendert, aendert
 * damit auch die Aussage „die Wiedergabe merkt vom Messen nichts".
 */
const SAMPLER_PY = String.raw`
import json, socket, subprocess, sys, time, urllib.request

def socketpfad():
    # Aus der BEFEHLSZEILE des laufenden mpv, nicht aus dem Dateidatum in /tmp:
    # dort liegen Sockets frueherer Laeufe, und der neueste ist nicht zwingend
    # der des Dienstes.
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
    if not pfad:
        return {"_fehler": "kein mpv-Socket in der Prozessliste"}
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

def dienst():
    # VON DER BOX AUS abgerufen, nicht vom Messrechner: so liegen beide Quellen
    # im selben Augenblick, und das Netz faellt aus der Messung heraus.
    try:
        with urllib.request.urlopen("http://localhost:8200/player/local", timeout=2) as a:
            return json.loads(a.read().decode("utf-8", "replace"))
    except Exception as e:
        return {"_fehler": str(e)}

takt = float(sys.argv[1]) / 1000.0
bis = time.time() + float(sys.argv[2])
EIG = ["playlist-pos-1", "media-title", "duration", "time-pos"]
while time.time() < bis:
    pfad = socketpfad()
    m = frage(pfad, EIG)
    d = dienst()
    print(json.dumps({"t": round(time.time(), 2), "mpv": m, "dienst": d}, ensure_ascii=False), flush=True)
    time.sleep(takt)
`

function sammler(sekunden) {
  const zeilen = []
  const p = spawn(
    'ssh',
    ['-o', 'BatchMode=yes', `dietpi@${BOX}`, 'python3', '-u', '-', String(TAKT), String(sekunden)],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  p.stdin.write(SAMPLER_PY)
  p.stdin.end()
  let rest = ''
  p.stdout.setEncoding('utf8')
  p.stdout.on('data', (s) => {
    rest += s
    const teile = rest.split('\n')
    rest = teile.pop() || ''
    for (const z of teile) {
      if (!z.trim()) continue
      try {
        zeilen.push(JSON.parse(z))
      } catch {
        /* Nicht-JSON aus der Ferne: uebergehen */
      }
    }
  })
  let fehler = ''
  p.stderr.setEncoding('utf8')
  p.stderr.on('data', (s) => {
    fehler += s
  })
  const fertig = new Promise((r) => p.on('close', () => r()))
  return { zeilen, fertig, fehlerText: () => fehler }
}

/** Kurz vor das Ende setzen — IN PROZENT. `seekpos:` nimmt bei mpv PROZENT. */
async function kurzVorSchluss(abEndeSek) {
  const lo = await lokal()
  const dauer = Number(lo?.duration) || 0
  if (!(dauer > abEndeSek + 10)) {
    console.log(`  KEIN SPRUNG ans Ende: gemeldete Dauer ${dauer} s reicht fuer --ab-ende ${abEndeSek} nicht`)
    return false
  }
  const prozent = Math.max(0, Math.min(99, ((dauer - abEndeSek) / dauer) * 100))
  await befehl(`seekpos:${prozent.toFixed(2)}`)
  console.log(
    `  auf ${prozent.toFixed(1)} % von ${dauer.toFixed(1)} s gesetzt — der Uebergang VON SELBST faellt in die Messung`,
  )
  return true
}

async function werkFinden() {
  const d = await json(`${API}/werke?verschmelzen=1`)
  const werke = Array.isArray(d?.werke) ? d.werke : []
  for (const w of werke) {
    let inhalt
    try {
      inhalt = await json(`${API}/werke/${encodeURIComponent(w.schluessel)}/inhalt?verschmelzen=1`)
    } catch {
      continue
    }
    if (inhalt?.dienst !== QUELLE) continue
    const titel = (inhalt.titel || []).filter((t) => t.befehl && t.anhaengen)
    // MINDESTENS DREI: bei zweien liesse sich „der Name folgt" nicht von
    // „der Name steht zufaellig richtig" unterscheiden, sobald ein Uebergang
    // uebersprungen wird.
    if (titel.length >= 3) return { w, titel }
  }
  return null
}

const gleich = (a, b) => String(a ?? '').trim() === String(b ?? '').trim()

async function main() {
  console.log(`F1-Abnahme an ${BOX} — Quelle ${QUELLE}\n`)
  const fund = await werkFinden()
  if (!fund) {
    console.log(`Kein ${QUELLE}-Werk mit mindestens 3 Titeln gefunden — nichts gemessen.`)
    process.exitCode = 2
    return
  }
  const { w, titel } = fund
  console.log(`Werk: „${w.titel}" — ${titel.length} Titel`)
  titel.slice(0, 5).forEach((t, i) => console.log(`   ${i + 1}. ${t.titel}`))

  await befehl('stop')
  await schlaf(1200)

  const s = sammler(SEKUNDEN)
  await schlaf(500)

  console.log('\n── Start: erster Titel, Rest angehaengt ────────────────────')
  await befehl(titel[0].befehl)
  await schlaf(2500)
  for (const t of titel.slice(1, 5)) {
    await befehl(t.anhaengen)
    await schlaf(300)
  }

  await schlaf(4000)
  if (SPRUNG) {
    console.log('\n── Befohlener Wechsel: tracknr:2 ──────────────────────────')
    await befehl('tracknr:2')
    await schlaf(6000)
  }
  console.log('\n── Uebergang VON SELBST ───────────────────────────────────')
  await kurzVorSchluss(AB_ENDE)

  await s.fertig
  await befehl('stop')
  console.log('\n(angehalten)')

  // ── AUSWERTUNG ──────────────────────────────────────────────────────────
  const namen = titel.map((t) => String(t.titel ?? ''))
  console.log('\n── Messreihe ──────────────────────────────────────────────')
  console.log('  nr  dienst-name                     mpv media-title              liste[nr]')
  const urteile = []
  const gesehen = new Set()
  let anlauf = 0
  for (const z of s.zeilen) {
    const nr = Number(z.dienst?.currentTracknr) || Number(z.mpv?.['playlist-pos-1']) || 0
    if (!nr) continue
    const dienstName = String(z.dienst?.currentTrackname ?? '')
    const mpvName = z.mpv?.['media-title']
    // ── DER ANLAUF IST KEINE MESSUNG ────────────────────────────────────
    // Zwischen `loadfile` und „Datei offen" liegen auf einem Pi ein bis zwei
    // Sekunden. In dieser Spanne steht die Stelle schon auf 1, waehrend
    // WEDER der Dienst NOCH mpv einen Namen hat. Das sagt ueber F1 nichts —
    // gemessen wird, ob ein VORHANDENER Name zur Stelle passt.
    //
    // DIE GRENZE IST ENG GEZOGEN, und das ist Absicht: uebersprungen wird
    // nur, wenn BEIDE Quellen leer sind. Ein Dienst, der einen Namen meldet,
    // wird IMMER gewertet — auch einen leeren, wenn mpv einen hat. Sonst
    // liesse sich mit dieser Zeile genau der Fehler wegdefinieren, den sie
    // finden soll.
    if (!dienstName && !mpvName) {
      anlauf++
      continue
    }
    const soll = namen[nr - 1] ?? '(keine Zeile)'
    const gut = gleich(dienstName, soll)
    const schl = `${nr}|${dienstName}`
    if (!gesehen.has(schl)) {
      gesehen.add(schl)
      console.log(
        `  ${String(nr).padEnd(3)} ${(gut ? '✔ ' : '✘ ') + dienstName.slice(0, 28).padEnd(28)} ${String(mpvName ?? '—').slice(0, 26).padEnd(26)} ${soll.slice(0, 28)}`,
      )
    }
    urteile.push({ nr, gut })
  }

  const stellen = [...new Set(urteile.map((u) => u.nr))].sort((a, b) => a - b)
  const schlecht = urteile.filter((u) => !u.gut)
  console.log('\n── Urteil ─────────────────────────────────────────────────')
  console.log(`  gemessene Stellen: ${stellen.join(', ') || '(keine)'}`)
  console.log(`  uebersprungen (Anlauf, beide Quellen ohne Namen): ${anlauf}`)
  if (stellen.length < 2) {
    console.log('  UNENTSCHIEDEN: es wurde nur EINE Stelle erreicht — ein Uebergang ist nicht')
    console.log('  gemessen worden. Das ist KEIN gruenes Ergebnis.')
    process.exitCode = 2
    return
  }
  if (schlecht.length) {
    console.log(`  ROT: ${schlecht.length} von ${urteile.length} Messungen trugen den falschen Namen.`)
    process.exitCode = 1
    return
  }
  console.log(`  GRUEN: an ${stellen.length} Stellen stimmte der Name mit der Liste ueberein`)
  console.log(`  (${urteile.length} Messungen, kein Fehlgriff) — der Name GEHT MIT.`)
}

main().catch((e) => {
  console.error(`FEHLGESCHLAGEN: ${e.message}`)
  process.exitCode = 1
})
