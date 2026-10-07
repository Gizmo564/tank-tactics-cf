import { chromium, devices } from 'playwright-core';
const BASE='http://127.0.0.1:8787'; const sfx=Math.random().toString(36).slice(2,6);
const api=async(c,p,m='GET',b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',Cookie:c||''},body:b?JSON.stringify(b):undefined});return{body:await r.json(),cookie:(r.headers.get('set-cookie')||'').split(';')[0]}};
const u={}; for(const n of['ann','ben']) u[n]=(await api('','/api/auth/register','POST',{username:n+sfx,password:'pw1234'})).cookie;
for (const tpp of [1,2]) {
const r=await api(u.ann,'/api/games','POST',{name:'Mob'+tpp,callsign:'Ann',colorId:'teal',visibility:'public',config:{gridWidth:8,gridHeight:8,maxPlayers:4,tanksPerPlayer:tpp,apSchedule:'always',apPerDay:6,apIntervalHours:1}});
const gid=r.body.gameId; await api(u.ben,`/api/games/${gid}/join`,'POST',{callsign:'Ben',colorId:'coral'});
await api(u.ann,`/api/games/${gid}/start`,'POST'); await api(u.ann,`/api/games/${gid}/host/grant-ap-all`,'POST');
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({...devices['iPhone 13']}); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto(BASE); await p.waitForSelector('#authForm'); await p.fill('#authUser','ann'+sfx); await p.fill('#authPass','pw1234'); await p.click('#authSubmit'); await p.waitForSelector('.game-row');
await p.goto(`${BASE}/#game/${gid}`); await p.reload(); await p.waitForSelector('.tank-g'); await p.waitForTimeout(800);
const c=await p.$('.modal.howto [data-close]'); if(c) await c.click(); await p.waitForTimeout(300);
const rects=async()=>p.$$eval('.tank-g',els=>els.map(e=>{const r=e.getBoundingClientRect();return[e.style.transform,Math.round(r.x),Math.round(r.y)]}));
console.log('tpp',tpp,JSON.stringify(await rects())); await p.screenshot({path:`shots/mobile-render-${tpp}.png`});
if(tpp===2){ await p.tap('.tank-g.own >> nth=0',{force:true}); await p.waitForTimeout(400); console.log('after select',JSON.stringify(await rects())); await p.screenshot({path:'shots/mobile-render-sel.png'}); }
console.log('errors',errs); await b.close(); }
