'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
let chromium;
for(const location of [process.env.PLAYWRIGHT_MODULE_PATH,'playwright','C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)){try{({chromium}=require(location));break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}}
if(!chromium)throw Error('Playwright is required for the Chrome military response check');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),context=await browser.newContext({viewport:{width:1600,height:1060}}),page=await context.newPage(),errors=[];
  const out=path.resolve(__dirname,'../playtest-evidence/military-response');fs.mkdirSync(out,{recursive:true});
  const reports=[];
  try{
    await context.addInitScript(()=>{let core,Scene;Object.defineProperty(globalThis,'MayhemCore',{configurable:true,get:()=>core,set:value=>{core={...value,Game:class extends value.Game{constructor(...args){super(...args);globalThis.__responseGame=this;}}};}});Object.defineProperty(globalThis,'MayhemScene',{configurable:true,get:()=>Scene,set:value=>{Scene=class extends value{constructor(...args){super(...args);globalThis.__responseScene=this;}};}});});
    page.on('pageerror',error=>errors.push(error.message));
    for(const mode of ['air','ground']) {
      await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>globalThis.__responseScene&&Number(document.getElementById('game-canvas').dataset.renderCalls)>0,null,{timeout:60000});
      await page.locator('#play-button').click();await page.keyboard.press('p');
      const warning=await page.evaluate(mode=>{
        const g=__responseGame,a=g.aviation;
        const victim=mode==='air'?g.aircraft.find(c=>c.aircraftType==='helicopter'&&c.airportId==='military'):g.cars.find(c=>c.militaryModel);
        if(mode==='air')Object.assign(victim,{x:4500,y:-2400,elevation:85,grounded:false,speed:0,vx:0,vy:0,vz:0,throttle:.7,npc:false,borrowed:true,flightPhase:'parked'});
        g.player.vehicleId=victim.id;Object.assign(g.player,{x:victim.x,y:victim.y,elevation:victim.elevation});
        g.heat=4;g.graceTimer=0;g._reportedLocation={x:victim.x,y:victim.y,elevation:victim.elevation};
        globalThis.__responseVictim=victim;globalThis.__responseDamageStart=victim.health;
        for(let i=0;i<60*8&&!a.militaryWarning;i++)a.step(1/60,{hover:true});
        return {warning:a.militaryWarning,status:a.militaryStatus,health:victim.health};
      },mode);
      assert.ok(warning.warning>0);assert.equal(warning.status.type,mode==='air'?'jet':'helicopter');
      await page.waitForFunction(()=>document.getElementById('heat').textContent==='★★★★'&&!document.getElementById('military-status').hidden);
      assert.equal(await page.locator('#heat').getAttribute('aria-label'),'Heat 4 of 4');
      await page.locator('#pause-screen').evaluate(e=>e.style.visibility='hidden');await page.screenshot({path:path.join(out,mode+'-warning.png')});
      const attack=await page.evaluate(()=>{
        const g=__responseGame,a=g.aviation;let responder,maxUnits=0,shots=0;
        for(let i=0;i<60*200;i++) {
          a.step(1/60,{hover:true});maxUnits=Math.max(maxUnits,a.aircraft.filter(c=>c.militaryResponse&&c.npc&&!['parked','wrecked'].includes(c.flightPhase)).length);
          responder=a.militaryResponse||responder;
          shots+=a.aircraftProjectiles.filter(r=>r.military).length;
          if(responder?.gunFiring&&a.aircraftProjectiles.some(r=>r.military))break;
        }
        globalThis.__responseUnit=responder;
        const s=__responseScene;s.reducedMotion=true;s.scene.fog=null;s._aircraftStep(0);s._projectileEffects();
        const x=responder.x/20,z=responder.y/20,y=responder.elevation;
        g.policeSeen=Boolean(g.airPoliceSeen);
        const f=Math.cos(responder.angle),q=Math.sin(responder.angle);
        const camera=new s.T.PerspectiveCamera(48,s.camera.aspect,.2,2000);camera.position.set(x+18*f-22*q,y+8,z+18*q+22*f);camera.lookAt(x,y+1.5,z);camera.updateMatrixWorld(true);
        const render=s.renderer.render.bind(s.renderer);s.renderer.render=world=>render(world,camera);s.renderer.render(s.scene);
        return {id:responder?.id,type:responder?.aircraftType,phase:responder?.flightPhase,home:responder?.home,health:responder?.health,maxUnits,shots,firing:Boolean(responder?.gunFiring),muzzle:Boolean(s._aircraft.get(responder?.id)?.militaryArmament?.muzzle.visible)};
      });
      assert.equal(attack.maxUnits,1);assert.equal(attack.type,mode==='air'?'fighter':'transportheli');assert.ok(attack.home.y<0);assert.ok(attack.shots>0&&attack.firing&&attack.muzzle);
      await page.locator('#game-shell').screenshot({path:path.join(out,mode+'-attack.png')});
      const result=await page.evaluate(()=>{
        const g=__responseGame,a=g.aviation,v=__responseVictim;
        for(let i=0;i<60*80&&v.health>=__responseDamageStart;i++)a.step(1/60,{hover:true});
        const damaged=v.health<__responseDamageStart,remainingHealth=v.health;
        g._clearHeat();a.step(1/60,{hover:true});
        return {damaged,remainingHealth,returnPhase:__responseUnit.flightPhase,unitHealth:__responseUnit.health,unitPosition:[__responseUnit.x,__responseUnit.y,__responseUnit.elevation],victimPosition:[v.x,v.y,v.elevation],firing:__responseUnit.gunFiring,status:a.militaryStatus};
      });
      assert.equal(result.damaged,true,JSON.stringify({mode,attack,result}));assert.equal(result.firing,false);assert.equal(result.status.phase,'returning');
      reports.push({mode,warning,attack,result});
    }
    await page.setViewportSize({width:768,height:900});
    await page.evaluate(()=>{const g=__responseGame;g.heat=99;g.aviation.militaryStatus={active:true,type:'helicopter',phase:'warning',label:'Northwatch armed helicopter inbound',seen:false};g.aviation.militaryWarning=8;});
    await page.waitForFunction(()=>document.getElementById('heat').textContent==='★★★★');
    const fit=await page.locator('#military-status').evaluate(e=>{const r=e.getBoundingClientRect();return {visible:!e.hidden,left:r.left,right:r.right,width:innerWidth};});assert.ok(fit.visible&&fit.left>=0&&fit.right<=fit.width);
    await page.evaluate(()=>{__responseGame.heat=4;});await page.waitForFunction(()=>document.getElementById('interaction-hint').textContent.includes('32s'));
    await page.screenshot({path:path.join(out,'narrow-heat.png')});assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({browser:'Chrome',scenario:'Accelerated real Northwatch dispatch and aircraft controllers against the generated world; core escape/vehicle physics are covered by simulation tests',reports,fit,errors},null,2)+'\n');console.log('Chrome: fourth star, warning/status, real jet and helicopter attacks, damage, return order and narrow HUD verified.');
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
