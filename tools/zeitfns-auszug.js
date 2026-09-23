// ERZEUGT — nicht von Hand aendern (tools/zeit-auszug.py).
function kurzZeit(sek) {
  const s = Math.max(0, Math.floor(sek))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')} h`
  return `${m}:${String(r).padStart(2, '0')}`
}
function kurzDauer(sek) {
  const s = Math.max(0, Math.floor(sek))
  if (s < 3600) return `${Math.floor(s / 60)} min`
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} h`
}
function heuteSchluessel(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
module.exports = { kurzZeit, kurzDauer, heuteSchluessel }
