/**
 * MIXPIBOX THEME-GESTALTER — die Desktop-Schale (Windows, Linux, macOS).
 *
 * ══ WAS DIESE DATEI IST, UND WAS NICHT (BACKLOG E144, 27.09.2026) ══════════
 * Betreiber: „auch vorbereiten, dass es eine Desktop-App win/linux/mac geben
 * kann, um Themes zu gestalten." Der Gestalter selbst ist
 * NewDesign/gestalter/ — dieselbe Seite, die die Box unter /neu/gestalter/
 * ausliefert. Diese Schale zeigt sie nur an, in ZWEI Lagen:
 *
 *   OHNE BOX   aus den mitgelieferten Dateien (app/neu, gefuellt von
 *              vorbereiten.mjs) ueber das eigene Schema `mixpi://app/neu/…`.
 *              Gestalten, Datei oeffnen und speichern; die Vorschau ist die
 *              echte Box-Oberflaeche, nur ohne Daten.
 *   MIT BOX    Menue „Box → Verbinden …": die Seite kommt dann VON der Box
 *              (http://<box>:8200/neu/gestalter/). Gleiche Herkunft wie ihre
 *              /api — kein CORS, keine zweite Anmeldung: man meldet sich im
 *              Fenster wie in der Verwaltung an.
 *
 * Es gibt KEINE zweite Fachlogik hier. Was ein Thema ist, weiss format.mjs
 * (erzeugt aus mixpi-thema.ts); die Schale kann Fenster, Menue und zwei
 * Dateidialoge (preload.cjs), sonst nichts.
 *
 * ══ SICHERHEIT ═════════════════════════════════════════════════════════════
 * contextIsolation, sandbox, kein nodeIntegration. Die Bruecke gibt der Seite
 * nur „Datei oeffnen" und „Datei speichern" — jeweils mit einem Dialog, den
 * der Mensch bestaetigt. Navigation bleibt auf der eigenen Herkunft bzw. der
 * verbundenen Box; alles andere geht in den Systembrowser.
 *
 * STAND 27.09.2026, GEMESSEN: unter Linux (Electron 44, Xvfb) in BEIDEN
 * Lagen gestartet — ohne Box laedt mixpi://app/neu/gestalter/, die Bruecke
 * ist da, die Box-Knoepfe sind aus, Andocken wirkt in der Vorschau; mit
 * gemerkter Box (gegen tools/neu-vorschau.mjs) kommt die Seite von dort und
 * „Anwenden" ist da. NICHT gemessen: Windows und macOS, das Paketieren mit
 * electron-builder und eine echte Box.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const SCHEMA = 'mixpi'
const START_OHNE_BOX = `${SCHEMA}://app/neu/gestalter/`

// Das eigene Schema muss VOR `ready` als „standard + sicher" gelten — sonst
// laden ES-Module (gestalter.mjs) nicht, und fetch() darauf ginge nicht.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEMA, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

/** Wo die mitgelieferte Oberflaeche liegt: im Paket unter resources/app, beim Entwickeln hier. */
function oberflaecheOrdner() {
  const imPaket = path.join(process.resourcesPath || '', 'app', 'neu')
  return fs.existsSync(imPaket) ? imPaket : path.join(__dirname, 'app', 'neu')
}

/** Die gemerkte Box-Adresse (userData/einstellungen.json). */
const einstellungenDatei = () => path.join(app.getPath('userData'), 'einstellungen.json')
function einstellungen() {
  try {
    return JSON.parse(fs.readFileSync(einstellungenDatei(), 'utf8'))
  } catch {
    return {}
  }
}
function einstellungenSchreiben(neu) {
  fs.mkdirSync(path.dirname(einstellungenDatei()), { recursive: true })
  fs.writeFileSync(einstellungenDatei(), JSON.stringify({ ...einstellungen(), ...neu }, null, 2))
}

/** Nur http(s)://host[:port] — kein Pfad, keine Anmeldedaten in der Adresse. */
function boxAdressePruefen(roh) {
  try {
    const u = new URL(String(roh).trim().includes('://') ? String(roh).trim() : `http://${String(roh).trim()}`)
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null
    if (!u.port && u.protocol === 'http:') u.port = '8200'
    return u.origin
  } catch {
    return null
  }
}

let fenster = null
let boxHerkunft = null

function startAdresse() {
  return boxHerkunft ? `${boxHerkunft}/neu/gestalter/` : START_OHNE_BOX
}

function fensterBauen() {
  fenster = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'MixPiBox Theme-Gestalter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  // Nur die eigene Herkunft bzw. die verbundene Box — alles andere (Hilfe,
  // fremde Links) im Systembrowser.
  const erlaubt = (adresse) => {
    try {
      const u = new URL(adresse)
      return u.origin === `${SCHEMA}://app` || (boxHerkunft && u.origin === boxHerkunft)
    } catch {
      return false
    }
  }
  fenster.webContents.on('will-navigate', (ev, adresse) => {
    if (!erlaubt(adresse)) {
      ev.preventDefault()
      void shell.openExternal(adresse)
    }
  })
  fenster.webContents.setWindowOpenHandler(({ url }) => {
    if (erlaubt(url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  void fenster.loadURL(startAdresse())
}

function verbindenFragen() {
  const frage = new BrowserWindow({
    parent: fenster,
    modal: true,
    width: 460,
    height: 260,
    resizable: false,
    title: 'Mit einer Box verbinden',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  })
  frage.setMenu(null)
  void frage.loadFile(path.join(__dirname, 'verbinden.html'), { query: { adresse: boxHerkunft || '' } })
}

ipcMain.handle('box-verbinden', async (_ev, roh) => {
  const herkunft = roh === '' ? null : boxAdressePruefen(roh)
  if (roh !== '' && !herkunft) return { ok: false, fehler: 'Keine gueltige Adresse (z. B. 192.168.1.20 oder http://mixpibox:8200).' }
  if (herkunft) {
    try {
      const r = await net.fetch(`${herkunft}/neu/gestalter/`, { method: 'HEAD' })
      if (!r.ok) return { ok: false, fehler: `Die Box antwortet, aber ohne Gestalter (HTTP ${r.status}) — ist sie aktuell?` }
    } catch (f) {
      return { ok: false, fehler: `Keine Antwort von ${herkunft} (${f.message}).` }
    }
  }
  boxHerkunft = herkunft
  einstellungenSchreiben({ box: herkunft })
  for (const w of BrowserWindow.getAllWindows()) if (w !== fenster) w.close()
  void fenster.loadURL(startAdresse())
  return { ok: true }
})

ipcMain.handle('datei-oeffnen', async () => {
  const r = await dialog.showOpenDialog(fenster, {
    title: 'Thema öffnen',
    filters: [{ name: 'MixPiBox-Thema', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (r.canceled || !r.filePaths[0]) return null
  const text = fs.readFileSync(r.filePaths[0], 'utf8')
  return text.length > 8 * 1024 * 1024 ? null : text
})

ipcMain.handle('datei-speichern', async (_ev, vorschlag, text) => {
  if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) return false
  const r = await dialog.showSaveDialog(fenster, {
    title: 'Thema speichern',
    defaultPath: path.join(app.getPath('documents'), String(vorschlag || 'thema.mixpi-thema.json').replace(/[\\/]/g, '-')),
    filters: [{ name: 'MixPiBox-Thema', extensions: ['json'] }],
  })
  if (r.canceled || !r.filePath) return false
  fs.writeFileSync(r.filePath, text)
  return true
})

function menueBauen() {
  const vorlage = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Box',
      submenu: [
        { label: 'Verbinden …', accelerator: 'CmdOrCtrl+K', click: verbindenFragen },
        {
          label: 'Ohne Box arbeiten',
          click: () => {
            boxHerkunft = null
            einstellungenSchreiben({ box: null })
            void fenster.loadURL(startAdresse())
          },
        },
        { type: 'separator' },
        {
          label: 'Verwaltung der Box öffnen',
          click: () => boxHerkunft && shell.openExternal(`${boxHerkunft}/admin/`),
        },
      ],
    },
    { role: 'editMenu', label: 'Bearbeiten' },
    { role: 'viewMenu', label: 'Ansicht' },
    { role: 'windowMenu', label: 'Fenster' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(vorlage))
}

app.whenReady().then(() => {
  // mixpi://app/neu/… -> mitgelieferte Dateien. /api gibt es ohne Box nicht:
  // ehrlich 404, der Gestalter erkennt daran „ohne Box" (ablage.mjs).
  const wurzel = oberflaecheOrdner()
  protocol.handle(SCHEMA, (anfrage) => {
    const u = new URL(anfrage.url)
    if (u.pathname.startsWith('/api/')) return new Response('{"ok":false}', { status: 404, headers: { 'content-type': 'application/json' } })
    if (!u.pathname.startsWith('/neu/')) return new Response('', { status: 404 })
    let rel = decodeURIComponent(u.pathname.slice('/neu/'.length))
    if (rel === '' || rel.endsWith('/')) rel += 'index.html'
    const ziel = path.normalize(path.join(wurzel, rel))
    if (!ziel.startsWith(wurzel + path.sep)) return new Response('', { status: 403 })
    return net.fetch(pathToFileURL(ziel).toString())
  })
  boxHerkunft = boxAdressePruefen(einstellungen().box || '') || null
  menueBauen()
  fensterBauen()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) fensterBauen()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
