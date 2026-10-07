import { chromium } from 'playwright-core';
const BASE='http://127.0.0.1:8787'; const sfx=Math.random().toString(36).slice(2,6);
const api=async(c,p,m='GET',b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',Cookie:c||''},body:b?JSON.stringify(b):undefined});return{body:await r.json(),cookie:(r.headers.get('set-cookie')||'').split(';')[0]}};
const ok=(c,m)=>{console.log((c?'  ok: ':'  FAIL: ')+m); if(!c) process.exitCode=1;};
const u={}; for(const n of['ann','ben']) u[n]=(await api('','/api/auth/register','POST',{username:n+sfx,password:'pw1234'})).cookie;
const r=await api(u.ann,'/api/games','POST',{name:'Tabs',callsign:'Ann',colorId:'teal',visibility:'public',config:{gridWidth:8,gridHeight:8,maxPlayers:4,apSchedule:'always',apPerDay:6,apIntervalHours:1}});
const gid=r.body.gameId; await api(u.ben,`/api/games/${gid}/join`,'POST',{callsign:'Ben',colorId:'coral'});
await api(u.ann,`/api/games/${gid}/start`,'POST'); await api(u.ann,`/api/games/${gid}/host/grant-ap-all`,'POST');
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const login=async(vp)=>{const p=await(await b.newContext({viewport:vp})).newPage(); await p.goto(BASE); await p.waitForSelector('#authForm'); await p.fill('#authUser','ann'+sfx); await p.fill('#authPass','pw1234'); await p.click('#authSubmit'); await p.waitForSelector('.game-row'); return p;};
const vis=(p,s)=>p.$eval(s,e=>getComputedStyle(e).display!=='none'&&e.offsetHeight>0).catch(()=>false);
// ---- phone
let p=await login({width:390,height:844});
const gear=async()=>p.evaluate(()=>{const g=document.getElementById('themeToggleBtn').getBoundingClientRect(),bar=document.querySelector('#app .topbar').getBoundingClientRect(),br=document.querySelector('#app .topbar .brand').getBoundingClientRect();
 return{gearCx:Math.round(g.x+g.width/2),gearCy:Math.round(g.y+g.height/2+scrollY),brandCy:Math.round(br.y+br.height/2+scrollY),insideRight:Math.round(bar.right-g.right),insideTop:Math.round(g.top+scrollY-bar.top),insideBottom:Math.round(bar.bottom-g.bottom-scrollY)}});
console.log('phone lobby gear',JSON.stringify(await gear())); await p.screenshot({path:'shots/m-lobby-bar2.png'});
await p.goto(`${BASE}/#game/${gid}`); await p.reload(); await p.waitForSelector('.tank-g.own'); await p.waitForTimeout(400);
const c=await p.$('.modal.howto [data-close]'); if(c) await c.click();
console.log('phone game gear',JSON.stringify(await gear()));
ok(await vis(p,'#actionsMount') && !(await vis(p,'#chatMount')) && !(await vis(p,'.log-card')), 'Tank tab: actions visible, chat+log hidden');
await p.screenshot({path:'shots/m-tab-tank.png'});
await p.click('[data-tabbtn="chat"]'); await p.waitForTimeout(200);
ok(await vis(p,'#chatMount') && !(await vis(p,'#actionsMount')) && !(await vis(p,'#statsMount')), 'Chat tab shows only chat');
await p.screenshot({path:'shots/m-tab-chat.png'});
await p.click('[data-tabbtn="log"]'); ok(await vis(p,'.log-card') && !(await vis(p,'#chatMount')), 'Log tab shows only the log');
await p.screenshot({path:'shots/m-tab-log.png'});
ok(await vis(p,'[data-tabbtn="host"]'), 'host tab present for host');
await p.click('[data-tabbtn="host"]'); ok(await vis(p,'#hostMount') && !(await vis(p,'.log-card')), 'Host tab shows host controls');
// unread dot
await p.click('[data-tabbtn="tank"]');
await api(u.ben,`/api/games/${gid}/chat/send`,'POST',{text:'hello'}); await p.waitForTimeout(700);
ok(await p.$('.tab-dot')!==null, 'unread dot appears on Chat tab'); await p.click('[data-tabbtn="chat"]'); ok(await p.$('.tab-dot')===null, 'dot clears on open');
// ---- desktop
p=await login({width:1280,height:760}); await p.goto(`${BASE}/#game/${gid}`); await p.reload(); await p.waitForSelector('.tank-g.own'); await p.waitForTimeout(400);
const c2=await p.$('.modal.howto [data-close]'); if(c2) await c2.click(); await p.waitForTimeout(300);
ok(!(await vis(p,'#mobTabs')) && await vis(p,'#chatMount') && await vis(p,'#actionsMount') && await vis(p,'.log-card'), 'desktop: no tabs, everything visible');
console.log('desktop gear',JSON.stringify(await gear()));
console.log('desktop edges',JSON.stringify(await p.evaluate(()=>{const R=s=>{const e=document.querySelector(s).getBoundingClientRect();return[Math.round(e.left),Math.round(e.right)]};return{bar:R('.topbar'),boardCard:R('.board-wrap'),sideCard:R('#statsMount .card'),layout:R('.game-layout')}})));
await b.close();
