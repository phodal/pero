// Built UI, local mock Host envelope. Does not prove scheduling or Agent execution.
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
const server=spawn(process.execPath,[resolve(import.meta.dirname,'preview.mjs')],{stdio:['ignore','pipe','inherit']});
let browser;
try{
  const origin=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Preview not ready')),10000);
    server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Preview exited ${code}`));});
    server.stdout.on('data',chunk=>{const match=/http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk));if(match){clearTimeout(timer);done(match[0]);}});
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.PERO_CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(`${origin}/test-shell`);
  const app=page.frameLocator('iframe');
  await expect(app.getByRole('alert')).toHaveText('Re-save this schedule to freeze its IANA time zone');
  await app.getByRole('button',{name:'Pulse 每日简报',exact:true}).click();await app.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(app.getByLabel('Timezone',{exact:true})).toHaveValue('Local');await app.getByRole('button',{name:'Close',exact:true}).click();
  await app.getByRole('button',{name:'New automation',exact:true}).click();await app.getByLabel('Name',{exact:true}).fill('Fixture review');
  await app.getByLabel('Name',{exact:true}).press('Enter');await expect(app.getByRole('region',{name:'Automation editor'})).toBeVisible();
  await app.getByLabel('Instructions',{exact:true}).fill('Inspect local evidence only.');await app.getByRole('button',{name:'Schedule',exact:true}).click();await app.getByRole('option',{name:'Weekly',exact:true}).click();
  await app.getByLabel('Enable after saving').check();await app.getByRole('button',{name:'Save automation',exact:true}).click();
  await expect(app.getByRole('button',{name:'Fixture review',exact:true})).toBeVisible();await app.getByRole('button',{name:'Edit',exact:true}).click();
  await app.getByLabel('Name',{exact:true}).fill('Edited review');await app.getByLabel('Name',{exact:true}).press('Control+Enter');
  await expect(app.getByRole('button',{name:'Edited review',exact:true})).toBeVisible();
  const row=app.getByRole('row').filter({has:app.getByRole('button',{name:'Edited review',exact:true})});
  await row.getByRole('button',{name:'Pause',exact:true}).click();await expect(row.getByRole('button',{name:'Run now',exact:true})).toBeDisabled();
  await row.getByRole('button',{name:'Enable',exact:true}).click();await row.getByRole('button',{name:'Run now',exact:true}).click();
  await app.getByRole('button',{name:'Open session',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.openedSessions)).toEqual(['fixture-session']);
  await app.getByRole('button',{name:'Templates',exact:true}).click();await app.getByRole('button',{name:'Daily research brief'}).click();
  await expect(app.getByLabel('Enable after saving')).not.toBeChecked();await app.getByRole('button',{name:'Close',exact:true}).click();
  const out=resolve(import.meta.dirname,'../../../test-results/automations');await mkdir(out,{recursive:true});
  await page.screenshot({path:resolve(out,'list-history.png')});await page.setViewportSize({width:640,height:850});await page.screenshot({path:resolve(out,'narrow.png')});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('Automation no-forms iframe fixture passed: legacy error, create/edit, enable/pause, run/history/session and templates. No Host/Agent execution claim.');
}finally{await browser?.close();server.kill('SIGTERM');}
