/**
 * DIE JELLYFIN-ANMELDUNG DER VERWALTUNG NACHMESSEN — an der ECHTEN Box.
 *
 * WOZU: Die Schnellverbindung ist ein Ablauf ueber vier Wege und zwei
 * Maschinen (Box und Jellyfin). Was daran stimmt, sagt kein Test: die reinen
 * Regeln sind in backend-api/src/jellyfin-schnellverbindung.spec.ts gedeckt,
 * aber ob am Ende ein CODE am Schirm steht, ob er herunterzaehlt, ob
 * "Abbrechen" wirklich abbricht — und ob dabei nichts Geheimes im DOM oder im
 * Browserspeicher landet — steht nur in der laufenden Seite.
 *
 * ES DRUECKT NUR ZWEI KNOEPFE, und beide sind harmlos: "Anstossen" erzeugt
 * einen Code, der nach fuenf Minuten von selbst verfaellt, und "Abbrechen"
 * raeumt ihn weg. Der Schritt, der wirklich etwas aendert, ist die Genehmigung
 * IN JELLYFIN — die kann und darf dieses Werkzeug nicht tun.
 *
 * WAS ES PRUEFT, das sonst niemand sieht:
 *   * steht das Wort "Secret" oder ein Zugangsschluessel im DOM?
 *   * liegt etwas im localStorage/sessionStorage? (Der ganze Umbau vom
 *     08.08.2026 diente dazu, dass dort NICHTS mehr liegt.)
 *
 * AUFRUF
 *     node tools/verwaltung-jellyfin-anmelden-schau.mjs
 *     JF_FOTO=/tmp/jf.png node tools/verwaltung-jellyfin-anmelden-schau.mjs
 */
import { writeFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'
const brw=await eigenerBrowser(); let lfd=0
const send=(ws,m,p={})=>new Promise((ok,no)=>{const i=++lfd;ws.send(JSON.stringify({id:i,method:m,params:p}));
 const h=r=>{const x=JSON.parse(r);if(x.id!==i)return;ws.off('message',h);x.error?no(new Error(x.error.message)):ok(x.result)};ws.on('message',h)})
const w=ms=>new Promise(r=>setTimeout(r,ms))
try{
 await w(1200); const ws=new WebSocket(await brw.seite()); await new Promise(r=>ws.on('open',r))
 await send(ws,'Runtime.enable'); await send(ws,'Page.enable')
 await send(ws,'Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false})
 const ev=async e=>(await send(ws,'Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}))?.result?.value
 await send(ws,'Page.navigate',{url:'http://192.168.178.169:8200/admin/streaming?f='+Date.now()}); await w(4000)
 console.log('DA   :', await ev(`(()=>{const k=document.querySelector('mupi-jellyfin-schnellverbindung')
   if(!k) return 'keine Komponente: '+document.body.innerText.trim().slice(0,120).replace(/\\s+/g,' ')
   return JSON.stringify({text:k.innerText.trim().replace(/\\s+/g,' ').slice(0,220),
     knopf:[...k.querySelectorAll('button')].map(b=>b.textContent.trim())})})()`))
 console.log('DRUECKEN:', await ev(`(async()=>{const k=document.querySelector('mupi-jellyfin-schnellverbindung')
   const b=[...k.querySelectorAll('button')].find(x=>/anmelden/i.test(x.textContent))
   if(!b) return 'kein Knopf'; b.click(); await new Promise(r=>setTimeout(r,4000))
   return JSON.stringify({code:k.querySelector('.code')?.textContent?.trim(),
     rest:k.querySelector('.rest')?.textContent?.trim(),
     text:k.innerText.trim().replace(/\\s+/g,' ').slice(0,200)})})()`))
 const d=(await send(ws,'Page.captureScreenshot',{format:'png'})).data
 writeFileSync(process.env.JF_FOTO||'/tmp/jf.png', Buffer.from(d,'base64'))
 console.log('ABBRECHEN:', await ev(`(async()=>{const k=document.querySelector('mupi-jellyfin-schnellverbindung')
   const b=[...k.querySelectorAll('button')].find(x=>/Abbrechen/i.test(x.textContent))
   if(!b) return 'kein Abbrechen'; b.click(); await new Promise(r=>setTimeout(r,2500))
   return k.innerText.trim().replace(/\\s+/g,' ').slice(0,140)})()`))
 console.log('GEHEIM im DOM?', await ev(`(()=>{const t=document.documentElement.outerHTML
   const stellen=[]; const re=/secret/gi; let m
   while((m=re.exec(t))&&stellen.length<6) stellen.push(t.slice(Math.max(0,m.index-70), m.index+70).replace(/\s+/g,' '))
   return JSON.stringify({treffer:stellen, apiKey:/AccessToken|api_key=/i.test(t),
     speicher:Object.keys(localStorage).concat(Object.keys(sessionStorage))})})()`))
}finally{await brw.schliessen()}
