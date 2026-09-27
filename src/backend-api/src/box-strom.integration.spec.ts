/**
 * DER STROM FUER DEN KINDERSCHIRM — `GET /api/box/strom` (27.09.2026).
 *
 * Betreiber: „kann man den wechsel schneller machen" und „ein handy indikator
 * das ein telefon verbunden ist in der leiste". Der Schirm bemerkte einen
 * Profilwechsel aus der Handy-App erst im 15-s-Takt; der Strom meldet ihn
 * sofort, und dazu, wie viele Handys gerade reden.
 *
 * GEPRUEFT AN EINEM ECHTEN SOCKET, nicht mit supertest: ein Ereignisstrom
 * endet nie, supertest wartet aufs Ende.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let server: http.Server
let port = 0

/** Den Strom oeffnen; `naechstes()` liefert das naechste Ereignis (oder wirft nach `frist`). */
function stromOeffnen() {
  const ereignisse: Record<string, unknown>[] = []
  const wartende: (() => void)[] = []
  let puffer = ''
  const anfrage = http.get({ port, path: '/api/box/strom' }, (res) => {
    res.setEncoding('utf8')
    res.on('data', (stueck: string) => {
      puffer += stueck
      let ende = puffer.indexOf('\n\n')
      while (ende >= 0) {
        const block = puffer.slice(0, ende)
        puffer = puffer.slice(ende + 2)
        const zeile = block.split('\n').find((z) => z.startsWith('data: '))
        if (zeile) {
          ereignisse.push(JSON.parse(zeile.slice(6)))
          for (const w of wartende.splice(0)) w()
        }
        ende = puffer.indexOf('\n\n')
      }
    })
  })
  async function naechstes(frist = 3000): Promise<Record<string, unknown>> {
    const start = Date.now()
    while (!ereignisse.length) {
      if (Date.now() - start > frist) throw new Error(`kein Ereignis in ${frist} ms`)
      await new Promise<void>((weiter) => {
        wartende.push(weiter)
        setTimeout(weiter, 50)
      })
    }
    return ereignisse.shift() as Record<string, unknown>
  }
  return { naechstes, zu: () => anfrage.destroy() }
}

describe('Strom fuer den Kinderschirm: Profil und Handys', () => {
  before(async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'mixpi-box-strom-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify([]))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify([]))
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'kalea', name: 'Kalea', angelegt: 1 },
          { kennung: 'liam', name: 'Liam', angelegt: 2 },
        ],
        aktiv: 'kalea',
      }),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPIBOX_LOCK_DIR = ordner
    app = (await import('./server.js')).app
    server = app.listen(0)
    await new Promise((fertig) => server.once('listening', fertig))
    port = (server.address() as AddressInfo).port
  })

  after(() => {
    server.close()
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  it('meldet beim Oeffnen sofort, wer dran ist — und dass kein Handy redet', async () => {
    const s = stromOeffnen()
    try {
      assert.deepEqual(await s.naechstes(), { profil: 'kalea', handys: 0, anfrage: null })
    } finally {
      s.zu()
    }
  })

  it('zaehlt ein Handy, sobald eine Anfrage `x-mixpi-app` traegt — eine ohne zaehlt nicht', async () => {
    const s = stromOeffnen()
    try {
      await s.naechstes()
      await request(app).get('/api/profile')
      await request(app).get('/api/profile').set('x-mixpi-app', 'fernbedienung')
      assert.deepEqual(await s.naechstes(), { profil: 'kalea', handys: 1, anfrage: null })
    } finally {
      s.zu()
    }
  })

  it('gibt einen Profilwechsel in unter einer Sekunde weiter', async () => {
    const s = stromOeffnen()
    try {
      await s.naechstes()
      const ab = Date.now()
      await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)
      const e = await s.naechstes(1500)
      assert.equal(e.profil, 'liam')
      assert.ok(Date.now() - ab < 1000, `kam nach ${Date.now() - ab} ms`)
    } finally {
      s.zu()
    }
  })
})
