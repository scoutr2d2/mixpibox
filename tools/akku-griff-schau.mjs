import { writeFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'
const ZIEL='http://127.0.0.1:9301/neu/'
const brw=await eigenerBrowser(); let lfd=0
const send=(ws,m,p={})=>new Promise((ok,no)=>{const i=++lfd;ws.send(JSON.stringify({id:i,method:m,params:p}));
 const h=r=>{const x=JSON.parse(r);if(x.id!==i)return;ws.off('message',h);x.error?no(new Error(x.error.message)):ok(x.result)};ws.on('message',h)})
const w=ms=>new Promise(r=>setTimeout(r,ms))
try{
 await w(1200); const ws=new WebSocket(await brw.seite()); await new Promise(r=>ws.on('open',r))
 await send(ws,'Runtime.enable'); await send(ws,'Page.enable'); await send(ws,'Input.enable').catch(()=>{})
 await send(ws,'Emulation.setDeviceMetricsOverride',{width:800,height:480,deviceScaleFactor:1,mobile:false})
 const ev=async e=>(await send(ws,'Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}))?.result?.value
 await send(ws,'Page.navigate',{url:ZIEL+'?f='+Date.now()}); await w(2600)
 console.log('Weg:', await ev(`(async () => {
   const w = document.getElementById('wappen'); if (!w) return 'kein Wappen';
   w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
   await new Promise(r=>setTimeout(r,1200));
   const g = [...document.querySelectorAll('#eltern-faecher button')].find(b=>b.textContent.trim()==='System');
   if (!g) return 'keine Gruppe System';
   g.click(); await new Promise(r=>setTimeout(r,500));
   const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
     .find(x => ((x.querySelector('.zeile-name')||{}).textContent||'') === 'Akku');
   if (!z) return 'keine Zeile Akku';
   (z.querySelector('button')||z).click(); await new Promise(r=>setTimeout(r,1800));
   return document.querySelector('.akku-kurve') ? 'Kurve da' : 'keine Kurve' })()`))
 await w(1200)
 console.log('VORHER :', await ev(`(()=>{const w=document.getElementById('fach-zeilen');
   return JSON.stringify({kopf:w?.querySelector('.akku-stand')?.textContent, unter:w?.querySelector('.akku-unter')?.textContent})})()`))
 const box = await ev(`(()=>{const s=document.querySelector('.akku-kurve'); if(!s) return null;
   const r=s.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width*0.35,y:r.top+r.height*0.5})})()`)
 if(!box){console.log('keine Kurve'); } else {
   const {x,y}=JSON.parse(box)
   console.log('MASSE:', await ev(`(()=>{const s=document.querySelector('.akku-kurve');
     const r=s.getBoundingClientRect();
     return JSON.stringify({left:r.left,width:r.width,top:r.top,height:r.height})})()`))
   await send(ws,'Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1,pointerType:'touch'})
   await w(400)
   console.log('WAEHREND:', await ev(`(()=>{const w=document.getElementById('fach-zeilen');
     const g=document.querySelector('.akku-griff');
     return JSON.stringify({kopf:w?.querySelector('.akku-stand')?.textContent, unter:w?.querySelector('.akku-unter')?.textContent,
       strichSichtbar:g? !g.hasAttribute('hidden') : null, x1:g?.getAttribute('x1')})})()`))
   const d=(await send(ws,'Page.captureScreenshot',{format:'png'})).data
   writeFileSync('/tmp/claude-1000/-home-achim-Downloads-MuPiBox/1007c6f4-f4a0-4703-bb47-ec110eead692/scratchpad/griff.png', Buffer.from(d,'base64'))
   await send(ws,'Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1,pointerType:'touch'})
   await w(400)
   console.log('DANACH :', await ev(`(()=>{const w=document.getElementById('fach-zeilen');
     const g=document.querySelector('.akku-griff');
     return JSON.stringify({kopf:w?.querySelector('.akku-stand')?.textContent, strichSichtbar:g? !g.hasAttribute('hidden') : null})})()`))
 }
}finally{await brw.schliessen()}
