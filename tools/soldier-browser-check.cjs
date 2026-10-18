'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {installBrowserInputFixture}=require('./browser-input-fixture.cjs');
let chromium;
for(const location of [process.env.PLAYWRIGHT_MODULE_PATH,'playwright','C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)){
  try{({chromium}=require(location));break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
}
if(!chromium)throw Error('Playwright is required for the Chrome infantry check');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1600,height:1060}}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(60000);
  const out=path.resolve(__dirname,'../playtest-evidence/soldiers');fs.mkdirSync(out,{recursive:true});
  try{
    await context.addInitScript(installBrowserInputFixture);
    await context.addInitScript(()=>{
      let core,Scene;
      Object.defineProperty(globalThis,'MayhemCore',{configurable:true,get:()=>core,set:value=>{core={...value,Game:class extends value.Game{constructor(...args){super(...args);globalThis.__infantryGame=this;}}};}});
      Object.defineProperty(globalThis,'MayhemScene',{configurable:true,get:()=>Scene,set:value=>{Scene=class extends value{constructor(...args){super(...args);globalThis.__infantryScene=this;}};}});
    });
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    await page.waitForFunction(()=>globalThis.__infantryScene&&Number(document.getElementById('game-canvas').dataset.renderCalls)>0);
    await page.locator('#play-button').click();await page.keyboard.press('p');
    await page.locator('#pause-screen').evaluate(e=>e.style.visibility='hidden');
    const defence=await page.evaluate(()=>{
      const g=__infantryGame,s=__infantryScene,inf=g.soldierTraffic;
      g.police=[];g.peds=g.peds.filter(p=>p.soldier);g.graceTimer=0;
      g.aviation._policeCooldown=g.aviation._newsCooldown=g.aviation._militaryCooldown=10000;
      Object.assign(g.player,{vehicleId:null,x:6130,y:-930,elevation:14,grounded:true});
      g.inventory.equipped='popper';g._actionCooldown=0;g.action(0,{pitch:0});
      for(let i=0;i<60*6&&!inf.events.some(e=>e.type==='fire');i++){inf.step(1/60);g.time=inf.time;}
      const fire=inf.events.find(e=>e.type==='fire'),guard=g.soldiers.find(p=>p.id===fire?.id);
      if(!guard)throw Error('No real base guard acquired the attacker');
      globalThis.__guard=guard;s._syncResidents();s._people(0);MayhemTroopRender.step(s);
      globalThis.__infantryOriginalRender=s.renderer.render.bind(s.renderer);
      globalThis.__infantryView=(entity,wide=false)=>{
        const x=entity.x/20,z=entity.y/20,y=entity.elevation,T=s.T,camera=new T.PerspectiveCamera(48,s.camera.aspect,.1,2000);
        const yaw=entity.aimAngle??entity.angle??0;
        camera.position.set(x+(wide?10:Math.cos(yaw)*5-Math.sin(yaw)*2),y+(wide?6:2.4),z+(wide?11:Math.sin(yaw)*5+Math.cos(yaw)*2));camera.lookAt(x,y+(wide?1:.8),z);camera.updateMatrixWorld(true);
        s.renderer.render=world=>__infantryOriginalRender(world,camera);s.scene.fog=null;s.renderer.render(s.scene);
      };
      __infantryView(guard);
      return {guards:g.soldiers.filter(p=>p.role==='guard').length,heat:g.heat,firing:guard.id,rounds:g.soldierRounds.length,muzzle:s._residents.get(guard.id)?.soldier.flash.visible};
    });
    assert.equal(defence.guards,6);assert.equal(defence.heat,4);assert.ok(defence.rounds>0&&defence.muzzle);
    await page.waitForFunction(()=>document.getElementById('game-canvas').dataset.district===__infantryGame.districtAt().id);
    await page.locator('#game-shell').screenshot({path:path.join(out,'base-guard-firing.png')});console.log('Blender guards and real base defence verified.');
    const warning=await page.evaluate(()=>{
      const g=__infantryGame;g._clearHeat();
      Object.assign(g.player,{vehicleId:null,x:5550,y:1150,elevation:g._ground(5550,1150),grounded:true,composure:100});
      g.heat=4;g.graceTimer=0;g._reportedLocation={x:5550,y:1150};g.militaryTransport.cooldown=0;g.militaryTransport.step(1/60);
      return {...g.militaryTransport.status};
    });
    assert.equal(warning.phase,'mobilising');assert.equal(warning.warning,6);
    await page.waitForFunction(()=>document.getElementById('troop-status').dataset.phase==='mobilising');
    await page.screenshot({path:path.join(out,'infantry-warning.png')});
    const riders=await page.evaluate(()=>{
      const g=__infantryGame,t=g.militaryTransport,s=__infantryScene;
      for(let i=0;i<60*6.2;i++)t.step(1/60);const truck=t.trucks[0];if(!truck)throw Error('Carrier did not dispatch');
      globalThis.__carrier=truck;g.time=Math.max(g.time,t.time);g.vehiclePhysics.sync();
      s._syncResidents();s._people(0);s._cars(0);MayhemTroopRender.step(s);__infantryView(truck,true);
      const crew=g.soldiers.filter(p=>p.truckId===truck.id);
      return {id:truck.id,count:crew.length,seated:crew.every(p=>p.transportedBy===truck.id),rigs:crew.filter(p=>s._residents.get(p.id)?.soldier).length,wheels:s._vehicles.get(truck.id)?.wheels.length};
    });
    assert.equal(riders.count,4);assert.ok(riders.seated);assert.equal(riders.rigs,4);assert.equal(riders.wheels,6);
    await page.locator('#game-shell').screenshot({path:path.join(out,'carrier-with-passengers.png')});
    const trip=await page.evaluate(()=>{
      const g=__infantryGame,t=g.militaryTransport,s=__infantryScene,truck=__carrier;
      let travelled=0,maxDeparture=0,last={x:truck.x,y:truck.y},reverse=false;
      for(let i=0;i<60*130;i++){
        t.step(1/60);g.vehiclePhysics.step(1/60);t.syncPassengers();g.time=Math.max(g.time,t.time);
        travelled+=Math.hypot(truck.x-last.x,truck.y-last.y);last={x:truck.x,y:truck.y};reverse||=truck.speed< -5;
        maxDeparture=Math.max(maxDeparture,g.network.nearestRoad(truck).distance);
        if(i%30===0){s._syncResidents();s._people(0);s._cars(0);MayhemTroopRender.step(s);}
        if(g.soldiers.filter(p=>p.truckId===truck.id&&!p.transportedBy).length===4)break;
      }
      s._syncResidents();s._people(0);s._cars(0);MayhemTroopRender.step(s);__infantryView(truck,true);
      return {travelled,maxDeparture,reverse,health:truck.health,phase:truck.truckPhase,speed:truck.speed,crew:g.soldiers.filter(p=>p.truckId===truck.id).map(p=>({id:p.id,transportedBy:p.transportedBy,clear:g._personFree(p.x,p.y,MayhemPhysics.NPC_RADIUS)}))};
    });
    assert.ok(trip.travelled>2500&&trip.maxDeparture<65,JSON.stringify(trip));assert.equal(trip.health,240);assert.equal(trip.phase,'deployed');assert.ok(Math.abs(trip.speed)<8);assert.ok(trip.crew.every(p=>!p.transportedBy&&p.clear));
    await page.locator('#game-shell').screenshot({path:path.join(out,'squad-deployed.png')});console.log('Real Cannon carrier trip, three-point turn and safe unloading verified.');
    const combat=await page.evaluate(()=>{
      const g=__infantryGame,inf=g.soldierTraffic,s=__infantryScene,start=g.player.composure;
      const initialShots=inf.events.filter(e=>e.type==='fire').length;
      // Synchronize the infantry presentation clock after the isolated truck trip.
      inf.time=g.time;let shooter;
      for(let i=0;i<60*8;i++){
        inf.step(1/60);g.time=inf.time;
        shooter=g.soldiers.find(p=>p.role==='response'&&p.lastShotTime===inf.time);
        if(shooter&&g.soldierRounds.length)break;
      }
      s._syncResidents();s._people(0);MayhemTroopRender.step(s);if(shooter)__infantryView(shooter);
      const shown=shooter&&s._residents.get(shooter.id)?.soldier.flash.visible;
      return {shown,shots:inf.events.filter(e=>e.type==='fire').length-initialShots,composureBefore:start};
    });
    assert.ok(combat.shown&&combat.shots>0,JSON.stringify(combat));
    await page.locator('#game-shell').screenshot({path:path.join(out,'infantry-fire.png')});
    combat.composure=await page.evaluate(()=>{
      const g=__infantryGame,inf=g.soldierTraffic,s=__infantryScene;
      for(let i=0;i<60;i++){inf.step(1/60);g.time=inf.time;}
      const composure=g.player.composure;
      g._clearHeat();s.renderer.render=__infantryOriginalRender;
      const truck=__carrier;truck.speed=truck.vx=truck.vy=0;truck.troopAI=false;truck.truckPhase='parked';g.vehiclePhysics.reset(truck);
      const point=Array.from({length:24},(_,i)=>({x:truck.x+Math.cos(i*Math.PI/12)*70,y:truck.y+Math.sin(i*Math.PI/12)*70})).find(p=>g._dry(p)&&g._personFree(p.x,p.y));
      if(!point)throw Error('No clear carrier boarding point');
      Object.assign(g.player,{vehicleId:null,...point,elevation:g._ground(point),grounded:true,verticalVelocity:0});
      return composure;
    });
    assert.ok(combat.composure<combat.composureBefore,JSON.stringify(combat));
    await page.keyboard.press('p');await page.locator('#game-canvas').focus();await page.keyboard.press('e');
    await page.waitForFunction(()=>__infantryGame.current.id===__carrier.id);
    await page.keyboard.down('w');await page.waitForFunction(()=>Math.abs(__carrier.speed)>8);await page.keyboard.up('w');
    await page.keyboard.press('r');await page.waitForFunction(()=>__carrier.upright&&__infantryGame.current.maxHealth===240);
    await page.keyboard.press('e');await page.waitForFunction(()=>!__infantryGame.player.vehicleId);await page.keyboard.press('p');
    await page.setViewportSize({width:768,height:900});
    await page.evaluate(()=>{__infantryGame.heat=4;__infantryGame.militaryTransport.status={phase:'deployed',warning:0};});
    await page.waitForFunction(()=>!document.getElementById('troop-status').hidden);
    const fit=await page.locator('#troop-status').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};});assert.ok(fit.left>=0&&fit.right<=fit.width);
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({browser:'Chrome',defence,warning,riders,trip,combat,fit,errors},null,2)+'\n');
    console.log('Chrome: base defence, infantry warning, Blender rigs, seated transport, physical road drive/unload, rifle aim/fire/impact, truck keyboard borrowing/driving/recovery/exit and narrow HUD passed.');
  }catch(error){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({truck:globalThis.__carrier,guards:__infantryGame?.soldierTraffic.status,transport:__infantryGame?.militaryTransport.status})).catch(()=>({})));throw error;}
  finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
