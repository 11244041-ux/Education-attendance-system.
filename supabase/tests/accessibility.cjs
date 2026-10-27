// Automated WCAG checks are a partial audit, not legal/accessibility certification.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {startStaticServer}=require('./static-server.cjs');
const {installUXFixture,uid}=require('./ux-fixture.cjs');
const axePath=require.resolve('axe-core');
(async()=>{
 const {server,baseURL}=await startStaticServer();
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let checks=0;
 async function audit(page,label){
  await page.addScriptTag({path:axePath});
  const result=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}));
  assert.deepEqual(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),[],label);checks++;
 }
 try{
  for(const [role,width] of [['teacher',1440],['administrator',1440],['staff',390],['teacher',390]]){
   const page=await browser.newPage({viewport:{width,height:1000}});await installUXFixture(page,role);await page.goto(baseURL);
   await audit(page,role+' login '+width);
   await page.click('#login-submit');await audit(page,role+' invalid login '+width);
   await page.fill('#email','fictional@example.test');await page.fill('#password','Fictional-password');await page.click('#login-submit');
   await page.locator('#load-message').filter({hasText:'Saved records loaded.'}).waitFor();
   const views=await page.locator('#workspace-nav button').evaluateAll(buttons=>buttons.map(button=>button.dataset.view));
   for(const name of views){
    await page.locator('#workspace-nav button[data-view="'+name+'"]').click();
    await audit(page,role+' '+name+' '+width);
    if(name==='attendance'&&role==='teacher'){await page.selectOption('#roster-session',uid(4));await audit(page,role+' populated roster '+width);}
   }
   await page.close();
  }
  console.log(`${checks} axe WCAG 2.2 A/AA scans passed with no detected violations on tested login/workspace views.`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
