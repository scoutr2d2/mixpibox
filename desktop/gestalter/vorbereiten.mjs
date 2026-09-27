#!/usr/bin/env node
/**
 * Die Box-Oberflaeche samt Gestalter in die App legen: NewDesign/ -> app/neu/.
 *
 * DERSELBE KOPIERSCHRITT WIE AUF DIE BOX — tools/newdesign-kopieren.py mit
 * seiner EINEN Ausschlussliste (AUSSEN_VOR). Eine zweite Liste hier liefe
 * beim ersten neuen Werkstatt-Ordner auseinander (llmwiki
 * newdesign-kopiert-ein-eigenes-werkzeug). Deshalb braucht der Bau Python 3;
 * unter Windows heisst es oft `python`, darum werden beide Namen versucht.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, '..', '..')
const ziel = join(HIER, 'app', 'neu')

for (const python of ['python3', 'python']) {
  const r = spawnSync(python, [join(WURZEL, 'tools', 'newdesign-kopieren.py'), ziel], { stdio: 'inherit' })
  if (r.error && r.error.code === 'ENOENT') continue
  process.exit(r.status ?? 1)
}
console.error('Python 3 fehlt — es wird fuer tools/newdesign-kopieren.py gebraucht.')
process.exit(1)
