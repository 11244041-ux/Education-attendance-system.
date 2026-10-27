const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {startStaticServer}=require('./static-server.cjs');
const {installUXFixture,uid}=require('./ux-fixture.cjs');
const fs=require('node:fs');
(async()=>{
 const {server,baseURL}=await startStaticServer();
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let checks=0;const errors=[];
 const screenshots=process.env.SCREENSHOT_DIR;if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
 async function pageFor(role='teacher',width=1440,height=1000){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',error=>errors.push(error.message));
  const fixture=await installUXFixture(page,role);await page.goto(baseURL);
  await page.fill('#email','fictional@example.test');await page.fill('#password','Fictional-password');await page.click('#login-submit');
  await page.locator('#load-message').filter({hasText:'Saved records loaded.'}).waitFor();
  return {page,fixture};
 }
 const view=(page,name)=>page.locator('#workspace-nav button[data-view="'+name+'"]').click();
 try{
  for(const [role,width] of [['teacher',1440],['administrator',1440],['staff',390],['teacher',390]]){
   const {page,fixture}=await pageFor(role,width,width<500?844:1000);
   assert.equal(await page.locator('#dashboard-section').isVisible(),true);checks++;
   assert.equal(await page.locator('#workspace-nav button[data-view="administration"]').count(),role==='administrator'?1:0);checks++;
   assert.equal(await page.locator('#workspace-nav button[data-view="students"]').count(),role==='staff'?0:1);checks++;
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks++;
   if(role!=='staff'){
    await view(page,'students');
    assert.equal(await page.locator('#students-body tr:visible:not([data-empty])').count(),10);checks++;
    const search=page.locator('#students-body-search');await search.fill('Student 24');
    assert.equal(await page.locator('#students-body tr:visible:not([data-empty])').count(),1);checks++;
    await search.fill('No such student');await page.getByText('No matching records. Clear the search or filters to see more.',{exact:true}).waitFor();checks++;
    await search.fill('');
    await page.getByRole('button',{name:'Next page of students',exact:true}).click();
    assert.match(await page.locator('#students-body tr:visible').first().textContent(),/Student 11/);checks++;
    if(role==='administrator'){
     await page.selectOption('#students-body-filter-2','Kura');
     assert.equal(await page.locator('#students-body tr:visible:not([data-empty])').count(),1);checks++;
    }
    await page.fill('#student-number',' ');await page.fill('#student-name',' ');
    if(role==='administrator')await page.selectOption('#student-location',uid(7));
    await page.locator('#student-submit').click();
    assert.equal(await page.locator('#student-number').getAttribute('aria-invalid'),'true');checks++;
    assert.equal(fixture.writes.length,0);checks++;
   }else{assert.equal(fixture.reads.includes('students'),false);checks++;}
   await view(page,'staff');await page.locator('#workspace-nav button[data-view="dashboard"]').focus();await page.keyboard.press('Enter');
   assert.equal(await page.locator('#dashboard-section').isVisible(),true);checks++;
   await page.locator('.skip-link').focus();await page.keyboard.press('Enter');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'data-fields');checks++;
   if(screenshots){await view(page,'dashboard');await page.screenshot({path:screenshots+'/'+role+'-'+width+'.png',fullPage:true});}
   await page.close();
  }
  // Success: unchanged rows are skipped and existing records use their IDs.
  {
   const {page,fixture}=await pageFor();await view(page,'attendance');await page.selectOption('#roster-session',uid(4));
   assert.equal(await page.locator('#roster-body select').count(),3);checks++;
   await page.locator('#roster-body select').first().selectOption('');await page.click('#roster-save');
   await page.locator('#roster-summary').filter({hasText:'Choose a status for every changed student'}).waitFor();assert.equal(fixture.writes.length,0);checks++;
   await page.locator('#roster-body select').first().selectOption('Present');
   await page.click('#roster-present');await page.selectOption('#roster-session',uid(5));
   assert.equal(await page.inputValue('#roster-session'),uid(4));checks++;
   await page.click('#roster-save');
   await page.locator('#operation-message').filter({hasText:'Saved 2 of 2'}).waitFor();
   assert.equal(fixture.writes.length,2);checks++;
   assert.equal(fixture.writes[0].body.p_id,uid(401));checks++;
   assert.equal(fixture.writes[1].body.p_id,null);checks++;
   assert.equal(await page.locator('#roster-save').isDisabled(),true);checks++;
   if(screenshots)await page.screenshot({path:screenshots+'/attendance-roster.png',fullPage:true});
   await page.close();
  }
  // Partial save: display failure without resubmitting successful records.
  {
   const {page,fixture}=await pageFor();fixture.failStudents.add(uid(202));
   await view(page,'attendance');await page.selectOption('#roster-session',uid(4));await page.click('#roster-present');await page.click('#roster-save');
   await page.locator('#operation-message').filter({hasText:'Saved 1 of 2'}).waitFor();checks++;
   assert.equal(await page.locator('#roster-save').isDisabled(),true);checks++;
   assert.equal(fixture.writes.length,2);checks++;
   fixture.failStudents.clear();await page.click('#refresh');
   await page.locator('#operation-message').filter({hasText:'Records refreshed.'}).waitFor();
   await page.click('#roster-save');await page.locator('#operation-message').filter({hasText:'Saved 1 of 1'}).waitFor();
   assert.equal(fixture.writes.length,3);checks++;
   assert.equal(fixture.writes[2].body.p_student_id,uid(202));checks++;
   await page.close();
  }
  // Lost response after commit: no blind duplicate retry; refresh confirms the save.
  {
   const {page,fixture}=await pageFor();fixture.uncertainStudents.add(uid(202));fixture.commitUncertain=true;
   await view(page,'attendance');await page.selectOption('#roster-session',uid(4));await page.click('#roster-present');await page.click('#roster-save');
   await page.locator('#operation-message').filter({hasText:'unconfirmed'}).waitFor();checks++;
   await page.click('#roster-discard');assert.equal(await page.locator('#roster-save').isDisabled(),true);checks++;
   await page.click('#refresh');await page.locator('#operation-message').filter({hasText:'Records refreshed.'}).waitFor();
   assert.equal(await page.locator('#roster-save').isDisabled(),true);checks++;
   assert.equal(fixture.writes.length,2);checks++;
   await page.close();
  }
  // A failed read hides access until verified again, without losing this user's roster draft.
  {
   const {page,fixture}=await pageFor();await view(page,'attendance');await page.selectOption('#roster-session',uid(4));await page.click('#roster-present');
   fixture.failRefresh=true;await page.click('#refresh');await page.locator('#load-message').filter({hasText:'Could not load records'}).waitFor();
   assert.equal(await page.locator('#data-fields').isVisible(),false);checks++;
   fixture.failRefresh=false;await page.click('#refresh');await page.locator('#operation-message').filter({hasText:'Records refreshed.'}).waitFor();
   assert.equal(await page.locator('#roster-save').isEnabled(),true);checks++;
   assert.equal(fixture.writes.length,0);checks++;
   await page.close();
  }
  // Save succeeded / refresh failed are distinct; the form is not re-submitted.
  {
   const {page,fixture}=await pageFor();fixture.failRefreshAfterWrite=true;await view(page,'students');
   await page.fill('#student-number','NEW');await page.fill('#student-name','New Fictional');await page.click('#student-submit');
   await page.locator('#operation-message').filter({hasText:'Saved successfully, but records could not be refreshed.'}).waitFor();checks++;
   assert.equal(fixture.writes.length,1);checks++;
   fixture.failRefresh=false;await page.click('#refresh');await page.locator('#operation-message').filter({hasText:'Records refreshed.'}).waitFor();checks++;
   assert.equal(fixture.writes.length,1);checks++;
   await page.close();
  }
  // Sign-out stops the remaining class writes and removes private roster data.
  {
   const {page,fixture}=await pageFor();fixture.holdStudent=uid(201);
   await view(page,'attendance');await page.selectOption('#roster-session',uid(4));await page.click('#roster-present');await page.click('#roster-save');
   await page.waitForFunction(()=>document.querySelector('#data-fields').disabled);
   const deadline=Date.now()+5000;while(!fixture.release&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(typeof fixture.release,'function');
   await page.click('#sign-out');fixture.release();await page.locator('#login-section').waitFor();
   await page.waitForFunction(()=>document.querySelector('#roster-body').rows.length===0);
   assert.equal(fixture.writes.length,1);checks++;
   assert.equal(await page.locator('#roster-body tr').count(),0);checks++;
   assert.equal(await page.evaluate(()=>[...workspaceUI.tables.values()].every(table=>table.rows.length===0)),true);checks++;
   await page.click('[data-password="password"]');assert.equal(await page.locator('#password').getAttribute('type'),'text');checks++;
   await page.click('[data-password="password"]');assert.equal(await page.locator('#password').getAttribute('type'),'password');checks++;
   await page.close();
  }
  assert.deepEqual(errors,[]);checks++;
  console.log(`${checks} workspace UX checks passed: navigation, search/filter/pagination, validation, roster partial/uncertain saves, and session cleanup.`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
