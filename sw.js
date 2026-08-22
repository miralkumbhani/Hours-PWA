/* Hours — Service Worker v3 */
"use strict";
const CACHE  = "hours-v3";
const ASSETS = ["./","./index.html","./manifest.json",
                "./icon-192.png","./icon-512.png","./icon-96.png"];

self.addEventListener("install", e =>
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))
);
self.addEventListener("activate", e =>
  e.waitUntil(
    caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  )
);
self.addEventListener("fetch", e => {
  if(e.request.method!=="GET")return;
  e.respondWith(
    caches.match(e.request)
      .then(hit=>hit||fetch(e.request).catch(()=>caches.match("./index.html")))
  );
});

/* ─── Scheduled notifications (showTrigger, Chrome Android 88+) ─── */
const ICON  = "./icon-192.png";
const BADGE = "./icon-96.png";

async function cancelTag(tag){
  const pending = await self.registration
    .getNotifications({tag, includeTriggered:true}).catch(()=>[]);
  pending.forEach(n=>n.close());
}

async function scheduleOne({tag,title,body,epochMs,renotify=true}){
  await cancelTag(tag);
  if(!epochMs||epochMs<=Date.now())return;
  const opts={body,tag,icon:ICON,badge:BADGE,renotify,
    requireInteraction:false,vibrate:[120,60,120],
    data:{url:"./index.html"}};
  if("showTrigger" in Notification.prototype){
    await self.registration.showNotification(title,
      {...opts, showTrigger:new TimestampTrigger(epochMs)});
  } else {
    // Fallback store — fires on next SW wake (push/sync/fetch)
    const mc = await caches.open("hours-meta");
    const existing = await mc.match("pending-alarms")
      .then(r=>r?r.json():[]).catch(()=>[]);
    existing.push({tag,title,body,epochMs});
    await mc.put("pending-alarms", new Response(JSON.stringify(existing)));
  }
}

async function firePending(){
  const mc = await caches.open("hours-meta").catch(()=>null);
  if(!mc)return;
  const r = await mc.match("pending-alarms").catch(()=>null);
  if(!r)return;
  const alarms = await r.json().catch(()=>[]);
  const now=Date.now(), keep=[];
  for(const a of alarms){
    if(a.epochMs<=now){
      await self.registration.showNotification(a.title,
        {body:a.body,tag:a.tag,icon:ICON,badge:BADGE,vibrate:[120,60,120]});
    } else keep.push(a);
  }
  keep.length
    ? await mc.put("pending-alarms", new Response(JSON.stringify(keep)))
    : await mc.delete("pending-alarms");
}

self.addEventListener("push",   ()=>firePending());
self.addEventListener("sync",   ()=>firePending());

/* ─── Messages from page ─── */
self.addEventListener("message", async e=>{
  const d=e.data; if(!d)return;
  switch(d.type){
    case "SCHEDULE_BREAK":
      await scheduleOne({tag:"break-10",title:"10 minutes of break left",
        body:"Wrap up soon to stay within your hour.",epochMs:d.tenAtMs});
      await scheduleOne({tag:"break-end",title:"Break time's up",
        body:"You've used your full hour. Extra time pushes your leave time later.",
        epochMs:d.endAtMs});
      break;
    case "CANCEL_BREAK":
      await cancelTag("break-10");
      await cancelTag("break-end");
      break;
    case "SCHEDULE_NIGHTLY":
      await scheduleOne({tag:"nightly",title:d.title,body:d.body,epochMs:d.epochMs});
      break;
    case "CANCEL_NIGHTLY":
      await cancelTag("nightly");
      break;
  }
});

/* ─── Notification click → open app ─── */
self.addEventListener("notificationclick", e=>{
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
      const w=list.find(c=>/\/(index\.html)?$/.test(new URL(c.url).pathname));
      return w ? w.focus() : clients.openWindow("./index.html");
    })
  );
});
