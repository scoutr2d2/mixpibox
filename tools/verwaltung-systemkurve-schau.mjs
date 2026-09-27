/**
 * DIE SYSTEMKURVE DER VERWALTUNG NACHMESSEN — an der ECHTEN Box.
 *
 * WOZU: Die Kurve gibt es zweimal (der Grund steht in
 * src/frontend-admin/src/app/systemverlauf.ts). tools/systemkurve-gleich.py
 * misst, dass beide dieselben ZAHLEN benutzen; tools/systemkurve-schau.mjs
 * misst die Fassung DER BOX an den Bildpunkten. Dies hier ist das fehlende
 * Dritte: sieht die Fassung der VERWALTUNG auch so aus?
 *
 * ── ES SPIELT NICHTS EIN ──────────────────────────────────────────────────
 * Anders als das Werkzeug fuer die Box laeuft dies gegen die echte
 * Aufzeichnung unter http://<box>/admin. Es misst damit auch das, was eine
 * eingespielte Reihe nie zeigt: dass der Weg da ist, dass die Antwort passt
 * und dass die Reihe ueberhaupt schon lang genug ist.
 *
 * WAS ES AENDERT: nichts. Es liest eine Seite und legt ein Bild ab. Es fasst
 * keinen Knopf der Verwaltung an — auf dieser Seite stehen „Box ausschalten"
 * und „Box neu starten".
 *
 * AUFRUF
 *     node tools/verwaltung-systemkurve-schau.mjs
 *     MUPI_BOX=192.168.178.169 VW_FOTO=/tmp/vw.png node tools/…
 */
import { writeFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const BOX = process.env.MUPI_BOX || '192.168.178.169'
const ZIEL = `http://${BOX}:8200/admin/`
const FOTO = process.env.VW_FOTO || '/tmp/verwaltung-systemkurve.png'

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

try {
  await w(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Input.enable').catch(() => {})
  // BREIT UND HOCH: die Verwaltung wird am Rechner benutzt, nicht am
  // 800x480-Schirm der Box. Sie hier auf Boxmasse zu messen hiesse, die
  // falsche Frage zu stellen.
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  await send(ws, 'Page.navigate', { url: ZIEL + 'system?f=' + Date.now() })
  await w(3500)

  console.log(
    'Weg   :',
    await ev(`(async () => {
    const k = document.querySelector('mupi-systemkurve')
    // WAS STATTDESSEN DASTEHT, IST DIE AUSKUNFT. Die Verwaltung hat eine
    // Wache (app.routes.ts, Weg "anmeldung"); ohne diesen Zweig meldete das
    // Werkzeug „keine Komponente" und man raete, ob die Kurve fehlt oder ob
    // nur die Anmeldung davor steht.
    if (!k) return 'keine Komponente — Seite sagt: ' + document.body.innerText.trim().slice(0, 160).replace(/\s+/g,' ')
    const s = k.querySelector('svg')
    if (s) return 'Kurve da'
    const p = k.querySelector('.hinweis')
    return p ? 'statt Kurve: ' + p.textContent.trim().slice(0, 90) : 'nichts'
  })()`),
  )

  console.log(
    'BILD  :',
    await ev(`(() => {
    const k = document.querySelector('mupi-systemkurve'); if (!k) return null
    const s = k.querySelector('svg'); if (!s) return null
    const zaehl = (c) => {
      const alle = [...s.querySelectorAll('polyline.linie.' + c)]
      return { zuege: alle.length, punkte: alle.reduce((n,x)=>n+x.getAttribute('points').trim().split(/\\s+/).length,0) }
    }
    return JSON.stringify({
      cpu: zaehl('c'), waerme: zaehl('g'), speicher: zaehl('m'),
      luecken: s.querySelectorAll('rect.luecke').length,
      drosselmarke: !!s.querySelector('.marke'),
      bahnnamen: [...s.querySelectorAll('.bahnname')].map(t=>t.textContent.trim()),
      zeitmarken: [...s.querySelectorAll('text.achszahl')].map(t=>t.textContent.trim()).filter(x=>/^\\d\\d:\\d\\d$/.test(x)),
      vorlesen: s.getAttribute('aria-label'),
      hoehe: Math.round(s.getBoundingClientRect().height),
    })
  })()`),
  )

  console.log(
    'VORHER:',
    await ev(`(()=>{const k=document.querySelector('mupi-systemkurve')
    return JSON.stringify({kopf:k?.querySelector('.stand')?.textContent?.trim(),
      unter:k?.querySelector('.unter')?.textContent?.trim(),
      fuss:k?.querySelector('.fuss')?.textContent?.trim()})})()`),
  )

  const box = await ev(`(()=>{const s=document.querySelector('mupi-systemkurve svg'); if(!s) return null
    const r=s.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width*0.5,y:r.top+r.height*0.5})})()`)
  if (box) {
    const { x, y } = JSON.parse(box)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
    await w(400)
    console.log(
      'GRIFF :',
      await ev(`(()=>{const k=document.querySelector('mupi-systemkurve')
      return JSON.stringify({kopf:k?.querySelector('.stand')?.textContent?.trim(),
        unter:k?.querySelector('.unter')?.textContent?.trim(),
        strich:!!k?.querySelector('.griff')})})()`),
    )
    const d = (await send(ws, 'Page.captureScreenshot', { format: 'png' })).data
    writeFileSync(FOTO, Buffer.from(d, 'base64'))
    console.log('FOTO  :', FOTO)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
    await w(400)
    console.log(
      'DANACH:',
      await ev(`(()=>{const k=document.querySelector('mupi-systemkurve')
      return JSON.stringify({kopf:k?.querySelector('.stand')?.textContent?.trim(), strich:!!k?.querySelector('.griff')})})()`),
    )
  }
} finally {
  await brw.schliessen()
}
