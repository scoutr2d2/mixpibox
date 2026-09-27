/**
 * DIE SYSTEMKURVE AN DEN BILDPUNKTEN NACHMESSEN — Last, Waerme, Speicher.
 *
 * WOZU: `sysKurveBauen` in NewDesign/app.js zeichnet drei Bahnen mit einer
 * gemeinsamen Zeitachse. Was daran stimmt, sagt kein Test: die reinen Regeln
 * (`sysStuecke`, `sysLeseSatz`, …) sind in tools/pruef-neu-regeln.js gedeckt,
 * aber ob am Ende DREI Linien im Bild stehen, ob die Luecke schraffiert ist
 * und ob der Griff die Werte aller drei Bahnen holt, steht nur im DOM.
 *
 * ── ES SPIELT DIE REIHE EIN, STATT AUF SIE ZU WARTEN ───────────────────────
 * Die Aufzeichnung faengt bei jedem Serverstart bei null an (`sysReihe` liegt
 * im Speicher und wird angehaengt). Nach einem Update stehen also neun Punkte
 * da, und die Seite zeigt zu Recht den Satz „zu wenig Messwerte" statt eines
 * Bildes. Auf 24 Stunden zu warten, um eine Zeichnung zu pruefen, waere kein
 * Werkzeug. `window.fetch` wird deshalb fuer DIESEN EINEN Weg umgebogen und
 * liefert eine gebaute Reihe mit allem, was schiefgehen kann:
 *     eine NACHT OHNE MESSWERTE   (die Schraffur muss kommen)
 *     ein WAERMEAUSSCHLAG         (die Kurve muss an die Drosselmarke)
 *     ein LOCH NUR IN DER WAERME  (nur DIESE Bahn darf abreissen)
 *     ein STUECK OHNE SENSOR      (`g: null` ueber eine ganze Stunde)
 *
 * WAS ES AENDERT: nichts. Es liest den eigenen Vorschau-Browser und legt ein
 * Bildschirmfoto ab. Die Box wird nicht angefasst.
 *
 * AUFRUF
 *     node tools/systemkurve-schau.mjs
 */
import { writeFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const ZIEL = 'http://127.0.0.1:9301/neu/'
const FOTO = process.env.SYSKURVE_FOTO || '/tmp/systemkurve.png'

const brw = await eigenerBrowser()
let lfd = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })
const w = (ms) => new Promise((r) => setTimeout(r, ms))

/* DIE EINGESPIELTE REIHE — als Text, weil sie im Browser gebaut wird.
 *
 * SIE WIRD DORT UND NICHT HIER GEBAUT: die Zeitachse haengt an `Date.now()`
 * des BROWSERS (`bis = Math.max(letzter, Date.now())` in sysKurveBauen). Eine
 * hier gebaute Reihe mit der Uhr dieses Prozesses laege daneben, sobald die
 * beiden Uhren um Sekunden auseinanderstehen — und der Fehler saehe aus wie
 * ein Zeichenfehler am rechten Rand. */
const REIHE = `(() => {
  const jetzt = Date.now(), stunde = 3600000, minute = 60000
  const punkte = []
  for (let t = jetzt - 24 * stunde; t <= jetzt; t += 2 * minute) {
    const h = new Date(t).getHours()
    // DIE NACHT OHNE MESSWERTE: 1 bis 6 Uhr faellt ganz aus.
    if (h >= 1 && h < 6) continue
    const spitze = h === 20 ? 1 : 0
    // EIN LOCH NUR IN DER WAERME: 14 bis 15 Uhr ohne Sensor.
    const ohneSensor = h === 14
    punkte.push({
      t,
      c: Math.round(6 + spitze * 80 + 10 * Math.abs(Math.sin(t / 900000))),
      m: Math.round(34 + spitze * 12 + 4 * Math.abs(Math.cos(t / 1800000))),
      g: ohneSensor ? null : Math.round((46 + spitze * 36 + 3 * Math.sin(t / 1200000)) * 10) / 10,
      l: Math.round(20 + spitze * 300 + 30 * Math.abs(Math.sin(t / 700000))),
    })
  }
  return { punkte, abschnitte: [], jetzt: punkte[punkte.length - 1], stunden: 24,
           gesamt: punkte.length, kerne: 4, speicherGesamt: 2107834368,
           messAbstandMs: 60000, lueckeMs: 240000 }
})()`

try {
  await w(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Input.enable').catch(() => {})
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  await send(ws, 'Page.navigate', { url: ZIEL + '?f=' + Date.now() })
  await w(2600)

  // ── DEN EINEN WEG UMBIEGEN, ALLE ANDEREN DURCHLASSEN ────────────────────
  // Ein pauschales `window.fetch = …` naehme der Seite auch die Zahlen, die
  // Dienste und das Profil — und dann steht die Infoseite leer da, ohne dass
  // die Kurve daran schuld waere.
  await ev(`(() => {
    const echt = window.fetch.bind(window)
    window.fetch = (u, o) => String(u).includes('/system/verlauf')
      ? Promise.resolve(new Response(JSON.stringify(${REIHE}), { status: 200, headers: { 'content-type': 'application/json' } }))
      : echt(u, o)
    return 'umgebogen'
  })()`)

  console.log(
    'Weg:',
    await ev(`(async () => {
    const w = document.getElementById('wappen'); if (!w) return 'kein Wappen'
    w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r=>setTimeout(r,1200))
    const g = [...document.querySelectorAll('#eltern-faecher button')].find(b=>b.textContent.trim()==='System')
    if (!g) return 'keine Gruppe System'
    g.click(); await new Promise(r=>setTimeout(r,500))
    const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
      .find(x => ((x.querySelector('.zeile-name')||{}).textContent||'') === 'Info')
    if (!z) return 'keine Zeile Info'
    ;(z.querySelector('button')||z).click(); await new Promise(r=>setTimeout(r,2200))
    return document.querySelector('.sys-kurve') ? 'Kurve da' : 'keine Kurve'
  })()`),
  )

  const bild = await ev(`(() => {
    const s = document.querySelector('.sys-kurve'); if (!s) return null
    const zaehl = (k) => {
      const l = s.querySelector('polyline.sys-linie.' + k)
      const alle = [...s.querySelectorAll('polyline.sys-linie.' + k)]
      return { zuege: alle.length, punkte: alle.reduce((n,x)=>n+x.getAttribute('points').trim().split(/\\s+/).length,0) }
    }
    return JSON.stringify({
      cpu: zaehl('c'), waerme: zaehl('g'), speicher: zaehl('m'),
      luecken: s.querySelectorAll('rect.sys-luecke').length,
      drosselmarke: !!s.querySelector('.sys-marke'),
      bahnnamen: [...s.querySelectorAll('.sys-bahnname')].map(t=>t.textContent),
      vorlesen: s.getAttribute('aria-label'),
      hoehe: Math.round(s.getBoundingClientRect().height),
    })
  })()`)
  console.log('BILD   :', bild)

  console.log(
    'VORHER :',
    await ev(`(()=>{const w=document.getElementById('fach-zeilen')
    return JSON.stringify({kopf:w?.querySelector('.sys-stand')?.textContent, unter:w?.querySelector('.sys-unter')?.textContent})})()`),
  )

  const box = await ev(`(()=>{const s=document.querySelector('.sys-kurve'); if(!s) return null
    const r=s.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width*0.62,y:r.top+r.height*0.5})})()`)
  if (box) {
    const { x, y } = JSON.parse(box)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'touch' })
    await w(400)
    console.log(
      'GRIFF  :',
      await ev(`(()=>{const w=document.getElementById('fach-zeilen'); const g=document.querySelector('.sys-kurve .akku-griff')
      return JSON.stringify({kopf:w?.querySelector('.sys-stand')?.textContent, unter:w?.querySelector('.sys-unter')?.textContent,
        strichSichtbar:g? !g.hasAttribute('hidden') : null, x1:g?.getAttribute('x1')})})()`),
    )
    const d = (await send(ws, 'Page.captureScreenshot', { format: 'png' })).data
    writeFileSync(FOTO, Buffer.from(d, 'base64'))
    console.log('FOTO   :', FOTO)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'touch' })
    await w(400)
    console.log(
      'DANACH :',
      await ev(`(()=>{const w=document.getElementById('fach-zeilen'); const g=document.querySelector('.sys-kurve .akku-griff')
      return JSON.stringify({kopf:w?.querySelector('.sys-stand')?.textContent, strichSichtbar:g? !g.hasAttribute('hidden') : null})})()`),
    )
  }
} finally {
  await brw.schliessen()
}
