"""Holt die reinen Zeitfunktionen aus dem Bauteil in eine pruefbare Datei."""
import re, pathlib
q = pathlib.Path('src/frontend-box/src/app/zeitanzeige.component.ts').read_text()
def hol(n):
    i = q.index(f'export function {n}'); j = q.index('\n}', i)
    s = q[i:j+2].replace('export ', '', 1)
    return re.sub(r'\(([^)]*)\)\s*:\s*string', lambda m: '(' + re.sub(r':\s*\w+', '', m.group(1)) + ')', s)
kopf = ('// ERZEUGT — nicht von Hand aendern (tools/zeit-auszug.py).\n')
pathlib.Path('tools/zeitfns-auszug.js').write_text(
    kopf + '\n'.join(hol(n) for n in ['kurzZeit', 'kurzDauer', 'heuteSchluessel']) +
    '\nmodule.exports = { kurzZeit, kurzDauer, heuteSchluessel }\n')
print('tools/zeitfns-auszug.js erzeugt')
