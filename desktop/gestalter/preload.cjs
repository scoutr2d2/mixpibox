/**
 * Die Bruecke zwischen Seite und Schale — mit Absicht winzig.
 *
 * `window.mixpiDesktop` ist das EINZIGE, was die Seite von der App sieht.
 * NewDesign/gestalter/ablage.mjs fragt danach (`istDesktop`) und nimmt dann
 * die Dateidialoge der App statt Download/Dateiwahl des Browsers. Mehr soll
 * hier nicht hinein: jede weitere Faehigkeit waere eine, die auch eine
 * verbundene Box-Seite bekaeme.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mixpiDesktop', {
  /** Dialog „Thema oeffnen" -> Text der Datei oder null. */
  dateiOeffnen: () => ipcRenderer.invoke('datei-oeffnen'),
  /** Dialog „Thema speichern" -> true, wenn gespeichert. */
  dateiSpeichern: (vorschlag, text) => ipcRenderer.invoke('datei-speichern', String(vorschlag), String(text)),
  /** Nur fuer verbinden.html: Box-Adresse setzen ('' = ohne Box). */
  boxVerbinden: (adresse) => ipcRenderer.invoke('box-verbinden', String(adresse)),
})
