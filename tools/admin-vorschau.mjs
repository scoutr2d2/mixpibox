#!/usr/bin/env node
/**
 * Die VERWALTUNG ansehen, ohne eine Box zu haben.
 *
 * DAS GEGENSTUECK ZU tools/neu-vorschau.mjs, und aus demselben Grund: Wer
 * etwas an einer Verwaltungsseite aendert, kam bisher nur ans Ergebnis, indem
 * er auf eine echte Box ging. Die Verwaltung haengt naemlich hinter der
 * Anmeldung — `ng serve` allein zeigt das Anmeldefenster und sonst nichts,
 * weil `/api/auth/state` niemand beantwortet.
 *
 * HIER WIRD KEIN PASSWORT UMGANGEN. Der Stub SPIELT das Backend, wie
 * neu-vorschau.mjs es fuer die Box tut; er sagt „angemeldet", weil es hier gar
 * keine Anmeldung gibt, die etwas schuetzen koennte. Auf der Rueckschleife,
 * mit erfundenen Daten, ohne Zugriff auf irgendeine Box.
 *
 * AUFRUF
 *     npm run build:frontend-admin          # einmal bauen
 *     node tools/admin-vorschau.mjs         # http://localhost:8298/admin/
 *     node tools/admin-vorschau.mjs --port 9100 --schirm neu
 *
 * `--schirm neu` laesst die Box behaupten, sie fahre die neue Oberflaeche —
 * damit laesst sich das Ausblenden beider Seiten ansehen, ohne etwas
 * umzustellen.
 *
 * WAS ES NICHT TUT: nichts gespeichert, nichts gemessen, keine echte Box.
 * Es ersetzt keine Pruefung am Geraet und taugt fuer nichts ausser Hinsehen.
 *
 * ES GIBT EINEN ZWEITEN WEG ZUR SELBEN FRAGE — und welcher der richtige ist,
 * haengt nur daran, WORAN du gerade arbeitest (nachgetragen 19.09.2026; bis
 * dahin kannte keiner der beiden Koepfe den anderen, und wer den einen fand,
 * suchte den anderen nicht mehr):
 *
 *     DIESE DATEI                       tools/verwaltung-vorschau.mjs
 *     ein eigener Server (Port 8298)    eine Weiterleitung fuer `ng serve`
 *     zeigt das GEBAUTE Buendel aus     zeigt den QUELLTEXT, mit Neuladen
 *     src/deploy/www-admin              bei jeder Aenderung
 *     `npm run build:frontend-admin`    `node tools/neu-vorschau.mjs` muss
 *     muss einmal gelaufen sein         nebenher laufen (Attrappe, 8299)
 *     Attrappen-Antworten HIER drin     Antworten aus neu-vorschau.mjs
 *
 * Faustregel: an einer Seite BAUEN -> verwaltung-vorschau.mjs (Neuladen).
 * Ansehen, was die Box wirklich ausliefert -> diese Datei.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN = join(WURZEL, 'src/deploy/www-admin')
const NEU = join(WURZEL, 'NewDesign')

const arg = (name, standard) => {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : standard
}
const PORT = Number(arg('--port', 8298))
const SCHIRM = arg('--schirm', 'klassisch')

if (!existsSync(join(ADMIN, 'index.html'))) {
  console.error(`Die gebaute Verwaltung fehlt unter ${ADMIN}.\n  Erst bauen:  npm run build:frontend-admin`)
  process.exit(1)
}

/** Die Konfigurationsfelder des Bereichs 'darstellung' — wie /api/konfiguration sie liefert. */
const KONFIG_FELDER = [
  {
    id: 'oberflaeche',
    art: 'auswahl',
    bereich: 'darstellung',
    titel: 'Welche Oberfläche auf dem Bildschirm der Box',
    hinweis: 'Der Kiosk wählt beim Start. Umschalten wirkt erst, wenn die Box neu startet.',
    wert: SCHIRM,
    auswahl: [
      { wert: 'klassisch', titel: 'Klassisch — die gewohnte Oberfläche' },
      { wert: 'neu', titel: 'Neu — der Entwurf unter /neu' },
    ],
  },
  {
    id: 'kioskBrowser',
    art: 'auswahl',
    bereich: 'darstellung',
    titel: 'Womit der Kiosk die Oberfläche zeigt',
    hinweis: 'Cog spart rund 180 MB, bringt aber WebKit statt Blink mit.',
    wert: 'chromium',
    auswahl: [
      { wert: 'chromium', titel: 'Chromium — bewährt, mit X-Server' },
      { wert: 'cog', titel: 'Cog — schlank, ohne X-Server' },
    ],
  },
  {
    id: 'thema',
    art: 'auswahl',
    bereich: 'darstellung',
    titel: 'Farbthema',
    hinweis: 'Aussehen der Box-Oberfläche.',
    wert: 'mupibox',
    auswahl: ['mupibox', 'dark', 'light', 'tiger'].map((w) => ({ wert: w, titel: w })),
  },
  {
    id: 'kioskModus',
    art: 'schalter',
    bereich: 'darstellung',
    titel: 'Vollbild auf dem Bildschirm der Box',
    hinweis: 'Aus zeigt die Browserleisten — nur zur Fehlersuche sinnvoll.',
    wert: true,
    auswahl: [],
  },
  {
    id: 'bildlauf',
    art: 'schalter',
    bereich: 'darstellung',
    titel: 'Weicher Bildlauf',
    hinweis: 'Sanftes Scrollen auf dem Touchbildschirm.',
    wert: true,
    auswahl: [],
  },
]

/** Erfundene, aber vollstaendige Antworten — je Weg eine. */
const ANTWORTEN = {
  '/api/auth/state': { angemeldet: true, passwortGesetzt: true },
  '/api/konfiguration': { bereiche: [{ id: 'darstellung', titel: 'Darstellung' }], felder: KONFIG_FELDER },
  '/api/schirm/helligkeit': { da: true, prozent: 80, min: 20, max: 100, schritt: 5, geklemmt: false, schirmAus: false },
  '/api/farbthema': { thema: 'mupibox', farben: {} },
  '/api/darstellung': {
    aktuell: null,
    themen: { 'MuPiBox Classic': {}, 'New MuPiBox': {}, 'Tiger Mupi': {}, 'MuPi-Brücke': {} },
    auslieferung: {},
  },
  '/api/profile': { profile: [], aktiv: '' },
  // DIE SPIELE-SEITE ZEIGT SCHALTER FUER DIE SPIELE, DIE DIE BOX MELDET
  // (`werke` aus GET /api/spiele). Ohne diese Antwort steht die mittlere
  // Karte hier leer — und wer die Seite in der Vorschau ansieht, haelt das
  // fuer den Entwurf. Die Kennungen sind die des Servers
  // (`SPIELE_WERKE` in src/backend-api/src/spiele.ts).
  '/api/spiele': {
    an: true,
    vorlesen: false,
    spiele: { schlange: true, memory: true, dreigewinnt: true, farben: true },
    apps: { memory: true, puzzle: true, rechnen: true, uhr: true, lesen: true, malen: true },
    werke: [
      { id: 'schlange', name: 'Schlange', was: 'Der Klassiker: mit dem Steuerkreuz lenken, Futter fressen, nicht anstossen.' },
      { id: 'memory', name: 'Paare', was: 'Zwoelf Karten, sechs Paare. Geht auch ohne lesen zu koennen.' },
      { id: 'dreigewinnt', name: 'Drei gewinnt', was: 'Drei in einer Reihe gegen die Box.' },
      { id: 'farben', name: 'Farben merken', was: 'Die Box zeigt eine Folge, das Kind tippt sie nach.' },
    ],
    // DER ZWEITE SPIELORT: die Tipp-Apps der Schublade (NewDesign/apps.js).
    appWerke: [
      { id: 'memory', name: 'Memory', was: 'Kartenpaare mit den Bildern der eigenen Bibliothek.' },
      { id: 'puzzle', name: 'Puzzle', was: 'Ein Bild in Teilen, die geschoben werden.' },
      { id: 'rechnen', name: 'Rechnen', was: 'Plus und Minus.' },
      { id: 'uhr', name: 'Uhr', was: 'Die Zeiger stellen und ablesen lernen.' },
      { id: 'lesen', name: 'Lesen', was: 'Woerter zum Mitlesen.' },
      { id: 'malen', name: 'Malen', was: 'Eine leere Flaeche und ein Stift.' },
    ],
  },
}

/**
 * DIE PLUGINS — aus den ECHTEN Manifesten im Baum, nicht erfunden (05.09.2026).
 *
 * WARUM NICHT WIE DIE UEBRIGEN ANTWORTEN HART HINGESCHRIEBEN: die Steckleiste
 * (`mixpi-plugin-abschnitt`) zeigt genau das, was im Manifest steht — Name,
 * Fassung, Sektion, Icon, angemeldete Aktionen. Eine erfundene Liste zeigte
 * eine Verwaltung, die es nicht gibt, und veraltete beim ersten neuen Plugin
 * still. Gelesen wird deshalb `plugins/<k>/plugin.json`.
 *
 * ERFUNDEN IST NUR DER ZUSTAND: hier laeuft kein Wirt, also laeuft auch kein
 * Worker. Alles gilt als `bereit`, damit die Flaechen zu sehen sind, die ein
 * bereites Plugin bekommt. Was ein Plugin WIRKLICH kann, sagt nur die Box.
 */
function pluginsLesen() {
  const ordner = join(WURZEL, 'plugins')
  if (!existsSync(ordner)) return []
  const liste = []
  for (const name of readdirSync(ordner)) {
    const datei = join(ordner, name, 'plugin.json')
    if (!existsSync(datei)) continue
    try {
      const m = JSON.parse(readFileSync(datei, 'utf8'))
      liste.push({
        kennung: m.kennung ?? name,
        name: m.name ?? name,
        fassung: m.fassung ?? '0.0.0',
        rechte: m.rechte ?? [],
        zustand: 'bereit',
        kann: { aufloesen: true, suchen: true, befinden: true, ereignis: false },
        felder: m.felder ?? [],
        sektion: m.sektion,
        icon: Boolean(m.icon),
        aktionen: m.aktionen ?? [],
      })
    } catch {
      // Ein kaputtes Manifest ist ein Befund fuer den Wirt, nicht fuer die
      // Vorschau — hier faellt es einfach aus der Liste.
    }
  }
  return liste
}

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

/** Eine Datei ausliefern — und NIE ausserhalb des erlaubten Ordners. */
function datei(res, wurzel, rel) {
  const pfad = join(wurzel, normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!pfad.startsWith(wurzel) || !existsSync(pfad)) return false
  res.writeHead(200, { 'Content-Type': TYPEN[extname(pfad)] || 'application/octet-stream' })
  res.end(readFileSync(pfad))
  return true
}

// ── DER VPN-HEIMWEG (BACKLOG E30, 12.09.2026) ──────────────────────────────
//
// Anders als die uebrigen Wege NICKT der Stub hier nicht bloss: die Seite hat
// drei Karten (einrichten -> schalten -> entfernen) und zeigt immer nur die,
// deren Zustand gerade gilt. Ohne gefuehrten Zustand waere nur die erste je
// zu sehen. ERFUNDEN ist der Inhalt, ECHT ist die Form — die Felder sind die
// von GET /api/vpn & Co., damit die Seite hier genauso faellt wie an der Box.
// Der Handschlag „entsteht" ein paar Sekunden nach dem Einschalten: so sind
// „nie" und „steht" beide zu sehen, in genau der Reihenfolge wie am Geraet.
const vpn = {
  konfiguration: null,
  einheit: { aktiv: false, beimStart: false },
  eingeschaltetUm: 0,
}

function vpnLage() {
  const an = vpn.konfiguration !== null && vpn.einheit.aktiv
  const seit = an ? Math.round((Date.now() - vpn.eingeschaltetUm) / 1000) : null
  const hand = seit !== null && seit >= 4
  return {
    werkzeugDa: true,
    kern: 'geladen',
    konfiguration: vpn.konfiguration,
    einheit: vpn.einheit,
    tunnel: an
      ? {
          da: true,
          endpunkt: '93.184.216.34:51820',
          erlaubteNetze: ['192.168.178.0/24'],
          handschlagVorSek: hand ? 3 : null,
          urteil: hand ? 'steht' : 'nie',
          empfangen: hand ? 48211 : 0,
          gesendet: hand ? 21007 : 148,
        }
      : { da: false },
  }
}

// Das Netzlaufwerk (E28/N6-N9): Attrappe wie beim VPN — der Zustand lebt im
// Speicher dieses Laufs, damit sich Eintragen, Pruefen, Spiegeln-Schalten und
// Entfernen einmal durchklicken lassen, ohne dass es ein NAS gibt.
const nas = { konfiguration: null, eingehaengt: false }

function nasLage() {
  return {
    werkzeugDa: true,
    // Beide Sorten da: in der Vorschau soll sich auch die durchklicken
    // lassen, fuer die auf der eigenen Maschine kein Paket installiert ist.
    werkzeuge: { smb: true, webdav: true },
    konfiguration: nas.konfiguration,
    einheit: { aktiv: !!nas.konfiguration, beimStart: !!nas.konfiguration },
    eingehaengt: nas.eingehaengt,
    wurzel: '/mnt',
  }
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const weg = url.pathname

  // Netzlaufwerk VOR dem pauschalen Nicken der Schreibwege, wie beim VPN.
  if (weg.startsWith('/api/netzlaufwerk')) {
    const json = (leib) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(leib))
    }
    if (weg === '/api/netzlaufwerk' && req.method === 'GET') return json(nasLage())
    if (weg === '/api/netzlaufwerk/konfiguration' && req.method === 'DELETE') {
      nas.konfiguration = null
      nas.eingehaengt = false
      return json({ ok: true })
    }
    let leib = ''
    req.on('data', (t) => {
      leib += t
    })
    req.on('end', () => {
      let gesendet = {}
      try {
        gesendet = JSON.parse(leib || '{}')
      } catch {
        // Ein kaputter Leib ist in der Vorschau bloss eine leere Eingabe.
      }
      if (weg === '/api/netzlaufwerk/konfiguration') {
        const unterpfad = (gesendet.unterpfad || '').replace(/^\/+|\/+$/g, '')
        // Die Rueckfrage beim selbstsignierten Zertifikat — in der Vorschau
        // stellt sie JEDE https-Adresse einmal, damit sich der Weg
        // durchklicken laesst. Der Fingerabdruck ist der echte des NAS im
        // Haus (UGREEN, gemessen 20.09.2026): erfundene Hex-Zahlen haetten
        // hier nichts zu suchen, an ihnen uebt man das Vergleichen nicht.
        if (
          gesendet.art === 'webdav' &&
          String(gesendet.adresse || '').startsWith('https://') &&
          gesendet.zertifikatVertrauen !== true
        ) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              ok: false,
              error:
                'Der Server zeigt ein Zertifikat, das die Box nicht prüfen kann (DEPTH_ZERO_SELF_SIGNED_CERT). ' +
                'Bei einem eigenen NAS ist das normal. Wenn der Fingerabdruck unten zu deinem Gerät gehört, ' +
                'noch einmal mit „Diesem Zertifikat vertrauen" übernehmen.',
              zertifikat: {
                fingerabdruck:
                  'C7:37:F2:B6:97:3C:F1:73:77:17:E6:98:85:1A:16:57:F8:37:B9:1E:5C:2E:64:CA:74:28:0C:03:DC:95:E9:F1',
                aussteller: 'UGREEN',
              },
            }),
          )
          return
        }
        if (gesendet.art === 'webdav') {
          const adresse = (gesendet.adresse || 'https://nas.fritz.box/dav').replace(/\/+$/g, '')
          const teile = adresse.split('/').slice(3)
          nas.konfiguration = {
            art: 'webdav',
            host: adresse.split('/')[2] || 'nas.fritz.box',
            freigabe: teile[0] || '',
            unterpfad: teile.slice(1).join('/'),
            nutzer: gesendet.nutzer || 'achim',
            domaene: '',
            besitzer: 'dietpi',
            einhaengepunkt: gesendet.einhaengepunkt || '/mnt/nas',
            quelle: adresse,
            zertifikatVertraut: gesendet.zertifikatVertrauen === true,
            uebernommen: new Date().toISOString(),
            spiegeln: true,
          }
          return json({
            ok: true,
            konfiguration: nas.konfiguration,
            hinweise: [
              'hängt NICHT beim Start ein, sondern beim ersten Zugriff — ein fehlendes NAS hält die Box nicht auf',
              'Zugangsdaten gehen nach /etc/mupibox/nas-webdav-zugang (root, 0600), nicht in die Einheit',
              'WebDAV lädt über einen Zwischenspeicher auf der Karte (64 MiB): jede Datei wird erst lokal geschrieben und dann hochgeladen.',
            ],
          })
        }
        nas.konfiguration = {
          art: 'smb',
          host: gesendet.host || '192.168.178.199',
          freigabe: gesendet.freigabe || 'mupibox',
          unterpfad,
          nutzer: gesendet.nutzer || 'mupibox',
          domaene: '',
          besitzer: 'dietpi',
          einhaengepunkt: gesendet.einhaengepunkt || '/mnt/nas',
          quelle: `//${gesendet.host || '192.168.178.199'}/${gesendet.freigabe || 'mupibox'}${
            unterpfad ? `/${unterpfad}` : ''
          }`,
          uebernommen: new Date().toISOString(),
          spiegeln: true,
        }
        return json({
          ok: true,
          konfiguration: nas.konfiguration,
          hinweise: [
            'SMB 3.1.1 erzwungen (keine Aushandlung, kein Rückfall auf SMB 1)',
            'hängt NICHT beim Start ein, sondern beim ersten Zugriff — ein fehlendes NAS hält die Box nicht auf',
            'Zugangsdaten gehen nach /etc/mupibox/nas-zugang (root, 0600), nicht in die Einheit',
          ],
        })
      }
      if (weg === '/api/netzlaufwerk/pruefen') {
        // In der Vorschau gelingt die Probe — es gibt hier nichts zu treffen.
        nas.eingehaengt = true
        return json({ ok: true, eingehaengt: true, schreibbar: true })
      }
      if (weg === '/api/netzlaufwerk/spiegeln') {
        if (nas.konfiguration) nas.konfiguration.spiegeln = gesendet.an === true
        return json({ ok: true, spiegeln: gesendet.an === true })
      }
      json({ ok: true })
    })
    return
  }

  // VPN VOR dem pauschalen Nicken der Schreibwege — siehe Block oben.
  if (weg.startsWith('/api/vpn')) {
    const json = (leib) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(leib))
    }
    if (weg === '/api/vpn' && req.method === 'GET') return json(vpnLage())
    if (weg === '/api/vpn/konfiguration' && req.method === 'POST') {
      req.resume()
      req.on('end', () => {
        vpn.konfiguration = {
          adressen: ['192.168.178.201/24'],
          endpunkt: 'beispiel.myfritz.net:51820',
          erlaubteNetze: ['192.168.178.0/24'],
          gegenstelle: `p${'B'.repeat(42)}=`,
          keepalive: 25,
          mtu: null,
          hinweise: [],
          uebernommen: new Date().toISOString(),
        }
        json({
          ok: true,
          konfiguration: vpn.konfiguration,
          hinweise: [
            'DNS-Zeile gestrichen (192.168.178.1): ohne resolvconf bräche wg-quick daran ab, und für den Heimweg wird sie nicht gebraucht.',
            'PersistentKeepalive = 25 ergänzt: unterwegs sitzt die Box hinter fremdem NAT.',
          ],
          neuGestartet: vpn.einheit.aktiv,
        })
      })
      return
    }
    if (weg === '/api/vpn/aktiv' && req.method === 'POST') {
      let leib = ''
      req.on('data', (t) => {
        leib += t
      })
      req.on('end', () => {
        let wunsch = {}
        try {
          wunsch = JSON.parse(leib || '{}')
        } catch {
          // Ein kaputter Leib ist in der Vorschau bloss ein leerer Wunsch.
        }
        if (wunsch.an === true) vpn.eingeschaltetUm = Date.now()
        if (typeof wunsch.an === 'boolean') vpn.einheit.aktiv = wunsch.an
        if (typeof wunsch.beimStart === 'boolean') vpn.einheit.beimStart = wunsch.beimStart
        const lage = vpnLage()
        json({ ok: true, einheit: lage.einheit, tunnel: lage.tunnel })
      })
      return
    }
    if (weg === '/api/vpn/konfiguration' && req.method === 'DELETE') {
      vpn.konfiguration = null
      vpn.einheit = { aktiv: false, beimStart: false }
      return json({ ok: true })
    }
  }

  // Schreibende Wege nicken bloss — nichts wird abgelegt.
  if (req.method !== 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, neustartNoetig: false }))
  }

  for (const [k, v] of Object.entries(ANTWORTEN)) {
    if (weg === k) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(v))
    }
  }

  // ── DIE PLUGIN-WEGE ───────────────────────────────────────────────────────
  // Drei genuegen fuer alles, was die Steckleiste zeichnet: die Liste, das
  // Befinden je Plugin und das Icon, das das Plugin mitbringt. Ohne sie fiele
  // jeder davon auf das leere Objekt unten zurueck, und die Leiste saehe
  // ueberall so aus, als haette sich niemand gemeldet.
  if (weg === '/api/plugins') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ geladen: pluginsLesen(), abgewiesen: [] }))
  }
  const pluginWeg = weg.match(/^\/api\/plugins\/([a-z][a-z0-9-]{2,63})\/(befinden|icon)$/)
  if (pluginWeg) {
    const [, kennung, was] = pluginWeg
    if (was === 'befinden') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, text: 'Erfunden — die Vorschau fragt nichts nach.' }))
    }
    const m = pluginsLesen().find((p) => p.kennung === kennung)
    const roh = m && JSON.parse(readFileSync(join(WURZEL, 'plugins', kennung, 'plugin.json'), 'utf8'))
    if (roh?.icon && datei(res, join(WURZEL, 'plugins', kennung), roh.icon)) return
    return res.writeHead(404).end('kein Icon')
  }
  // Jeder andere API-Weg: leeres Objekt statt 404. Eine Seite, die auf einen
  // unbekannten Weg mit einem Fehlerbaum reagiert, waere hier nicht zu sehen.
  if (weg.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end('{}')
  }

  // Die neue Oberflaeche — der Rahmen der Darstellungsseite zeigt sie.
  if (weg.startsWith('/neu/')) {
    const rel = weg.slice('/neu/'.length) || 'index.html'
    if (datei(res, NEU, rel)) return
    if (datei(res, NEU, 'index.html')) return
  }

  // Die Verwaltung selbst, unter /admin/ wie auf der Box.
  const rel = weg.startsWith('/admin') ? weg.slice('/admin'.length) : weg
  if (rel && rel !== '/' && datei(res, ADMIN, rel)) return
  // Tiefe Adressen (/admin/darstellung) gehoeren dem Angular-Router.
  if (datei(res, ADMIN, 'index.html')) return

  res.writeHead(404).end('nicht da')
}).listen(PORT, () => {
  console.log(`Verwaltung:  http://localhost:${PORT}/admin/darstellung`)
  console.log(`Schirm:      ${SCHIRM}   (--schirm neu|klassisch)`)
})
