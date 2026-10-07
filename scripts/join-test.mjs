import { chromium } from 'playwright-core';
const BASE='http://127.0.0.1:8787'; const sfx=Math.random().toString(36).slice(2,6);
await fetch(BASE+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'jn'+sfx,password:'pw1234'})});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'}); const p=await(await b.newContext({viewport:{width:900,height:500}})).newPage();
await p.goto(BASE); await p.waitForSelector('#authForm'); await p.fill('#authUser','jn'+sfx); await p.fill('#authPass','pw1234'); await p.click('#authSubmit');
await p.waitForSelector('#joinCodeInput'); await p.click('#joinCodeInput'); await p.type('#joinCodeInput','ab'); await p.waitForTimeout(250);
console.log(await p.$eval('#joinCodeInput',e=>{const s=getComputedStyle(e);return [s.borderColor,s.boxShadow,s.borderTopWidth]}));
await p.locator('#joinForm').screenshot({path:'shots/join-focus.png'}); await b.close();
