'use strict';
// Chrome checks the actual renderer/HUD and keyboard/mouse integration. The
// Cannon integration suite separately runs full Game driving and collisions.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {installBrowserInputFixture}=require('./browser-input-fixture.cjs');
let chromium;
for(const location of [process.env.PLAYWRIGHT_MODULE_PATH,'playwright','C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)){
  try{({chromium}=require(location));break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
}
if(!chromium)throw Error('Playwright is required for the Chrome tank check');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1600,height:1060}}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(60000);
  const out=path.resolve(__dirname,'../playtest-evidence/tanks');fs.mkdirSync(out,{recursive:true});
  try{
    await context.addInitScript(installBrowserInputFixture);
    await context.addInitScript(()=>{
      let core,Scene;
      Object.defineProperty(globalThis,'MayhemCore',{configurable:true,get:()=>core,set:value=>{core={...value,Game:class extends value.Game{constructor(...args){super(...args);globalThis.__tankGame=this;}}};}});
      Object.defineProperty(globalThis,'MayhemScene',{configurable:true,get:()=>Scene,set:value=>{Scene=class extends value{constructor(...args){super(...args);globalThis.__tankScene=this;}};}});
    });
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    await page.waitForFunction(()=>globalThis.__tankScene&&Number(document.getElementById('game-canvas').dataset.renderCalls)>0);
    await page.locator('#play-button').click();await page.keyboard.press('p');
    const warning=await page.evaluate(()=>{
      const g=__tankGame,t=g.tankTraffic,c=g.cars[0];
      g.police=[];g.peds=[];g.aviation._policeCooldown=g.aviation._newsCooldown=g.aviation._militaryCooldown=10000;
      Object.assign(c,{x:5550,y:1150,angle:0,elevation:g._ground(5550,1150),speed:0,vx:0,vy:0,traffic:false});
      g.player.vehicleId=c.id;g.heat=4;g.graceTimer=0;g._reportedLocation={x:c.x,y:c.y,elevation:c.elevation};g.vehiclePhysics.reset(c);g.vehiclePhysics.sync();
      globalThis.__tankVictim=c;
      for(let i=0;i<60*60.1;i++)t.step(1/60);
      return {phase:t.status.phase,warning:t.warning,elapsed:t.fourStarTime,tanks:t.tanks.length};
    });
    assert.equal(warning.phase,'mobilising');assert.equal(warning.tanks,0);assert.ok(warning.warning>7.7);
    console.log('Timed warning verified.');
    await page.waitForFunction(()=>document.getElementById('tank-status').dataset.phase==='mobilising'&&!document.getElementById('tank-status').hidden);
    await page.locator('#pause-screen').evaluate(e=>e.style.visibility='hidden');
    await page.screenshot({path:path.join(out,'armour-warning.png')});
    const drive=await page.evaluate(()=>{
      const g=__tankGame,t=g.tankTraffic,s=__tankScene;
      for(let i=0;i<60*8.2;i++)t.step(1/60);
      const tank=t.tanks[0];if(!tank)throw Error('Tank did not dispatch');
      globalThis.__testedTank=tank;g.time=t.time;s._cars(0);MayhemTankRender.step(s);g.vehiclePhysics.sync();
      let distance=0,furthest=0,last={x:tank.x,y:tank.y},saw=false;
      for(let i=0;i<60*100;i++){
        t.step(1/60);g.vehiclePhysics.step(1/60);g.time=t.time;
        distance+=Math.hypot(tank.x-last.x,tank.y-last.y);last={x:tank.x,y:tank.y};
        furthest=Math.max(furthest,t.network.nearestRoad(tank).distance);saw||=g.militaryTankSeen;
        if(i%60===0){s._cars(1/60);MayhemTankRender.step(s);}
        if(t.events.some(e=>e.type==='fire'))break;
      }
      s._cars(0);MayhemTankRender.step(s);
      const model=s._vehicles.get(tank.id),T=s.T,x=tank.x/20,z=tank.y/20,y=tank.elevation;
      const camera=new T.PerspectiveCamera(48,s.camera.aspect,.1,2000);camera.position.set(x-9,y+6,z+10);camera.lookAt(x,y+1.2,z);camera.updateMatrixWorld(true);
      globalThis.__tankOriginalRender=s.renderer.render.bind(s.renderer);s.renderer.render=world=>__tankOriginalRender(world,camera);s.scene.fog=null;s.renderer.render(s.scene);
      return {distance,furthest,saw,health:tank.health,phase:tank.tankPhase,shots:t.events.filter(e=>e.type==='fire').length,shells:t.shells.length,
        muzzle:model.tank.flash.visible,wheels:model.tank.wheelMesh.count,treads:model.tank.treadMesh.count,travel:model.tank.travel,geometries:s.renderer.info.memory.geometries};
    });
    assert.ok(drive.distance>3500&&drive.furthest<45,JSON.stringify(drive));assert.equal(drive.health,600);assert.ok(drive.saw&&drive.shots>0&&drive.shells>0&&drive.muzzle);
    assert.equal(drive.wheels,12);assert.equal(drive.treads,60);assert.ok(drive.travel.some(value=>Math.abs(value)>1));
    console.log('Physical outskirts drive and rendered AI fire verified.');
    await page.locator('#game-shell').screenshot({path:path.join(out,'outskirts-tank-firing.png')});
    const impact=await page.evaluate(()=>{
      const g=__tankGame,t=g.tankTraffic,c=__tankVictim,before=c.health;
      for(let i=0;i<60*2;i++){t.step(1/60);g.vehiclePhysics.step(1/60);g.time=t.time;}
      const result={before,health:c.health,impacts:t.events.filter(e=>e.type==='impact')};
      g._clearHeat();__tankScene.renderer.render=__tankOriginalRender;
      const tank=__testedTank;tank.speed=tank.vx=tank.vy=0;tank.tankAI=false;tank.tankPhase='parked';g.vehiclePhysics.reset(tank);
      const beside=Array.from({length:16},(_,i)=>({x:tank.x+Math.cos(i*Math.PI/8)*60,y:tank.y+Math.sin(i*Math.PI/8)*60})).find(p=>g._dry(p)&&g._personFree(p.x,p.y));
      if(!beside)throw Error('No clear on-foot boarding point beside the tank');
      Object.assign(g.player,{vehicleId:null,...beside,elevation:g._ground(beside),verticalVelocity:0,grounded:true});
      const update=g.update.bind(g);g.update=(dt,input)=>{globalThis.__tankInput={...input};return update(dt,input);};
      return result;
    });
    assert.ok(impact.health<impact.before,JSON.stringify(impact));
    // These controls go through game.js event handlers and the live Game loop.
    await page.keyboard.press('p');await page.locator('#game-canvas').focus();await page.keyboard.press('e');
    await page.waitForFunction(()=>__tankGame.current.kind==='tank');
    console.log('Keyboard boarding verified.');
    await page.locator('#game-canvas').click({position:{x:600,y:300}});
    await page.waitForFunction(()=>document.pointerLockElement===document.getElementById('game-canvas'));
    const start=await page.evaluate(()=>({x:__testedTank.x,y:__testedTank.y,yaw:__tankScene.viewYaw}));
    await page.keyboard.down('w');await page.waitForFunction(()=>Math.abs(__testedTank.speed)>8);await page.keyboard.up('w');
    await page.evaluate(()=>__browserInputFixture.relativeMove(document.getElementById('game-canvas'),160,-40));
    await page.waitForFunction(()=>Math.abs(__tankScene.viewYaw-__tankInput.aimAngle)<.1&&Math.abs(__tankScene.viewYaw-__testedTank.angle)>.25);
    const aim=await page.evaluate(()=>({yaw:__tankScene.viewYaw,offset:__tankScene._driveOffset,angle:__testedTank.angle}));
    // Tank aim stays where the mouse left it after the car camera's recenter delay.
    await page.waitForTimeout(1600);
    const retained=await page.evaluate(()=>__tankScene._driveOffset);assert.ok(Math.abs(retained-aim.offset)<.01);
    await page.evaluate(()=>{__testedTank.gunCooldown=0;});
    await page.mouse.down();await page.waitForFunction(()=>__tankInput.fire&&__tankGame.tankTraffic.events.some(e=>e.type==='fire'&&!e.npc));await page.mouse.up();
    await page.waitForFunction(()=>document.getElementById('aim-reticle').dataset.weapon==='tank'&&document.getElementById('equipped-toy').textContent.includes('RELOAD'));
    const player=await page.evaluate(start=>({moved:Math.hypot(__testedTank.x-start.x,__testedTank.y-start.y),turret:__testedTank.tankGun.turretAngle,hull:__testedTank.angle,
      input:__tankInput,reticle:!document.getElementById('aim-reticle').hidden,hint:document.getElementById('interaction-hint').textContent,fixture:__browserInputFixture.stats}),start);
    assert.ok(player.moved>1&&player.reticle);assert.ok(player.hint.includes('MOUSE')&&player.fixture.relativeMoves>0);
    await page.screenshot({path:path.join(out,'borrowed-tank-controls.png')});
    await page.keyboard.press('r');await page.waitForFunction(()=>__testedTank.upright&&__tankGame.tankTraffic.roadIds.has(__tankGame.network.nearestRoad(__testedTank).roadId));
    await page.keyboard.press('e');await page.waitForFunction(()=>!__tankGame.player.vehicleId);
    await page.keyboard.press('p');
    const alarm=await page.evaluate(()=>{
      const g=__tankGame;g._clearHeat();Object.assign(g.player,{vehicleId:null,x:6130,y:-930,elevation:14,grounded:true});g.inventory.equipped='popper';g.actionCooldown=0;
      g.action(0,{pitch:0});g.tankTraffic.step(1/60);
      return {heat:g.heat,alarm:g.tankTraffic.baseAlarmTime,phase:g.tankTraffic.status.phase};
    });
    assert.equal(alarm.heat,4);assert.ok(alarm.alarm>89);
    await page.setViewportSize({width:768,height:900});
    await page.waitForFunction(()=>!document.getElementById('tank-status').hidden);
    const fit=await page.locator('#tank-status').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};});assert.ok(fit.left>=0&&fit.right<=fit.width);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({browser:'Chrome',warning,drive,impact,player,alarm,fit,errors},null,2)+'\n');
    console.log('Chrome: timed dispatch, real Cannon outskirts drive, animated Blender tank, aiming/fire/impact, keyboard borrowing/driving/recovery/exit, base alarm and narrow HUD passed.');
  }catch(error){
    await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
    console.error(await page.evaluate(()=>({player:__tankGame?.player,tank:globalThis.__testedTank,input:globalThis.__tankInput,errors:document.getElementById('renderer-error-detail')?.textContent,pauseHidden:document.getElementById('pause-screen')?.hidden})).catch(()=>({})));
    throw error;
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
