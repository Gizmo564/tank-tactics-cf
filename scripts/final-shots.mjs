import { chromium } from 'playwright-core';
const BASE='http://127.0.0.1:8787'; const sfx=Math.random().toString(36).slice(2,6);
const api=async(c,p,m='GET',b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',Cookie:c||''},body:b?JSON.stringify(b):undefined});return{body:await r.json(),cookie:(r.headers.get('set-cookie')||'').split(';')[0]}};
const u={};for(const n of['ann','ben']){u[n]=(await api('','/api/auth/register','POST',{username:n+sfx,password:'pw1234'})).cookie}
const r=await api(u.ann,'/api/games','POST',{name:'S',callsign:'Ann',colorId:'teal',visibility:'public',config:{gridWidth:10,gridHeight:8,maxPlayers:6,apSchedule:'always',apIntervalHours:1,endgamePlayerCount:1,startingHearts:3,startingRange:3}});
const gid=r.body.gameId; await api(u.ben,`/api/games/${gid}/join`,'POST',{callsign:'Ben',colorId:'coral'});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const [tag,vp] of [['d',{width:1280,height:760}],['m',{width:390,height:800}]]){
 const ctx=await b.newContext({viewport:vp}); const p=await ctx.newPage();
 await p.goto(BASE); await p.waitForSelector('#authForm'); await p.fill('#authUser','ann'+sfx); await p.fill('#authPass','pw1234'); await p.click('#authSubmit');
 await p.waitForSelector('.game-row'); await p.screenshot({path:`shots/${tag}-lobby.png`});
 await p.screenshot({path:`shots/${tag}-lobby-bar.png`}); await p.click('#themeToggleBtn'); await p.waitForTimeout(500); await p.screenshot({path:`shots/${tag}-lobby-panel.png`});
 console.log(tag,'sfx/music defaults', await p.evaluate(()=>[...document.querySelectorAll('#themePanel [role=switch],#themePanel input[type=checkbox]')].map(e=>e.getAttribute('aria-checked')??e.checked)));
 if(tag==='d'){ await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.click('[data-enter-lobby="'+gid+'"]'); await p.waitForSelector('#startBtn'); await p.click('#startBtn'); await p.waitForSelector('.board-svg .tank-g');
  await api(u.ann,`/api/games/${gid}/host/grant-ap-all`,'POST'); await p.waitForTimeout(800); await p.keyboard.press('Escape');
  const x=await p.$('.how-to-modal button, .modal button'); if(x) await x.click(); await p.waitForTimeout(300);
  await p.screenshot({path:'shots/d-game.png'}); await p.focus('#chatInput').catch(()=>{}); await p.evaluate(()=>document.getElementById('chatMount')?.scrollIntoView()); await p.waitForTimeout(200); await p.screenshot({path:'shots/d-chat.png'});
  console.log('center offsets', JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('.brand .mark, .dpad .center')].map(c=>{const r=c.getBoundingClientRect();const g=c.querySelector('.t-body').getBoundingClientRect();return [+(g.x+g.width/2-(r.x+r.width/2)).toFixed(1),+(g.y+g.height/2-(r.y+r.height/2)).toFixed(1)]})))); await p.hover('#statsMount ~ #actionsMount [data-mode=shoot], [data-mode=shoot]'); await p.waitForTimeout(200); await p.screenshot({path:'shots/d-hover.png',clip:{x:930,y:260,width:340,height:400}}); await p.click('#themeToggleBtn'); await p.waitForTimeout(500); await p.screenshot({path:'shots/d-game-panel.png'}); }
 await ctx.close();}
await b.close();
