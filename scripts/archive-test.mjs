import { chromium } from 'playwright-core';
const BASE='http://127.0.0.1:8787'; const sfx=Math.random().toString(36).slice(2,6);
await fetch(BASE+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'ar'+sfx,password:'pw1234'})});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'}); const p=await (await b.newContext({viewport:{width:1100,height:900}})).newPage();
await p.goto(BASE); await p.waitForSelector('#authForm'); await p.fill('#authUser','ar'+sfx); await p.fill('#authPass','pw1234'); await p.click('#authSubmit');
await p.waitForSelector('#archive'); await p.waitForTimeout(500);
const info=async()=>p.evaluate(()=>({hidden:document.getElementById('archive').hidden,open:document.getElementById('archive').open,count:document.getElementById('archiveCount').textContent,
 archRows:document.querySelectorAll('#archiveList .game-row').length, endedInMain:[...document.querySelectorAll('#myGameList .badge, #gameList .badge')].filter(x=>/ended/i.test(x.textContent)).length}));
console.log('closed',await info()); await p.screenshot({path:'shots/archive-closed.png',fullPage:true});
await p.click('#archive > summary'); await p.waitForTimeout(300);
console.log('open',await info());
await p.click('#refreshBtn'); await p.waitForTimeout(500); console.log('after refresh still open:',(await info()).open);
await p.screenshot({path:'shots/archive-open.png',fullPage:true}); await b.close();
