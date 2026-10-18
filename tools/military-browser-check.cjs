'use strict';
// Chrome rendering and real keyboard/UI smoke check. Long simulation cycles are
// covered by military-aircraft, military-world and north-bounds tests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
let chromium;
for(const location of [process.env.PLAYWRIGHT_MODULE_PATH,'playwright','C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)){try{({chromium}=require(location));break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}}
if(!chromium)throw Error('Playwright is required for the Chrome military base check');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),context=await browser.newContext({viewport:{width:1600,height:1060}}),page=await context.newPage(),errors=[];
  const out=path.resolve(__dirname,'../playtest-evidence/military');fs.mkdirSync(out,{recursive:true});
  try{
    await context.addInitScript(()=>{let core,Scene;Object.defineProperty(globalThis,'MayhemCore',{configurable:true,get:()=>core,set:value=>{core={...value,Game:class extends value.Game{constructor(...args){super(...args);globalThis.__baseGame=this;}}};}});Object.defineProperty(globalThis,'MayhemScene',{configurable:true,get:()=>Scene,set:value=>{Scene=class extends value{constructor(...args){super(...args);globalThis.__baseScene=this;}};}});});
    page.on('pageerror',error=>errors.push(error.message));await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    await page.waitForFunction(()=>globalThis.__baseScene&&globalThis.MayhemMilitaryRender&&Number(document.getElementById('game-canvas').dataset.renderCalls)>0,null,{timeout:60000});
    await page.locator('#play-button').click();await page.locator('#military-route').click();
    await page.waitForFunction(()=>document.getElementById('objective-detail').textContent.includes('Northwatch Airbase'));
    const world=await page.evaluate(()=>{const g=__baseGame,b=g.world.militaryBase;return {bounds:g.world.bounds,buildings:g.buildings.filter(o=>o.militaryModel).length,trucks:g.cars.filter(o=>o.militaryModel).length,aircraft:g.aircraft.filter(o=>o.airportId==='military').map(o=>({type:o.aircraftType,x:o.x,y:o.y})),elevation:g.world.terrain.heightAt(4200,-2920)};});
    assert.deepEqual(world.bounds,{minX:0,minY:-4000,maxX:12000,maxY:8000});assert.equal(world.buildings,9);assert.equal(world.trucks,2);assert.equal(world.aircraft.length,4);assert.equal(world.elevation,14);
    await page.locator('#game-canvas').focus();await page.keyboard.press('m');
    await page.waitForFunction(()=>document.querySelector('img[src="assets/city-map.png"]')?.complete);
    const map=await page.locator('img[src="assets/city-map.png"]').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight,visible:img.getBoundingClientRect().width>0}));assert.equal(map.width,map.height);assert.equal(map.visible,true);
    await page.screenshot({path:path.join(out,'extended-map.png')});await page.keyboard.press('m');
    // Put the player at the parked truck; all following interaction uses the
    // actual keyboard handler, live rigid body and UI.
    await page.evaluate(()=>{const g=__baseGame,c=g.cars.find(c=>c.militaryModel);g.player.vehicleId=null;Object.assign(g.player,{x:c.x-65,y:c.y,elevation:c.elevation,grounded:true});g.vehiclePhysics?.sync(g);});
    await page.locator('#game-canvas').focus();await page.keyboard.press('e');await page.waitForFunction(()=>__baseGame.current.militaryModel==='utility-truck');
    await page.keyboard.down('w');await page.waitForTimeout(450);await page.keyboard.up('w');
    const truck=await page.evaluate(()=>{const c=__baseGame.current;return {id:c.id,speed:c.speed,health:c.health,model:c.militaryModel,y:c.y};});assert.ok(Math.abs(truck.speed)>1);assert.ok(truck.y<0);
    await page.keyboard.press('r');await page.waitForFunction(()=>__baseGame.current.y<0);await page.keyboard.press('e');await page.waitForFunction(()=>!__baseGame.player.vehicleId);
    await page.evaluate(()=>{const g=__baseGame,c=g.aircraft.find(c=>c.airportId==='military'&&c.aircraftType==='fighter'&&!c.npc);Object.assign(g.player,{x:c.x-110,y:c.y,elevation:c.elevation,grounded:true});});
    await page.keyboard.press('e');await page.waitForFunction(()=>__baseGame.current.kind==='aircraft');await page.keyboard.press('g');await page.waitForFunction(()=>!document.getElementById('hangar-panel').hidden);
    const hangar=await page.locator('#store-aircraft').isEnabled();assert.equal(hangar,true);await page.keyboard.press('Escape');
    // Pause the simulation and render fixed review cameras in the real scene.
    await page.keyboard.press('p');
    await page.evaluate(()=>{const s=__baseScene;s.scene.fog=null;globalThis.__baseRender=s.renderer.render.bind(s.renderer);globalThis.__baseView=(position,target)=>{const c=new s.T.PerspectiveCamera(48,s.camera.aspect,.1,1600);c.position.set(...position);c.lookAt(...target);c.updateMatrixWorld(true);s.renderer.render=world=>__baseRender(world,c);s.renderer.render(s.scene);};for(const e of document.getElementById('game-shell').children)if(e.tagName!=='CANVAS')e.style.visibility='hidden';});
    for(const [name,position,target] of [['northwatch-overview',[370,190,50],[213,14,-109]],['hangars-and-apron',[292,39,-110],[239,18,-65]],['runway',[95,33,-123],[237,14,-146]],['motor-pool',[193,19,-69],[180,15,-66]]]){await page.evaluate(({position,target})=>__baseView(position,target),{position,target});await page.locator('#game-canvas').screenshot({path:path.join(out,name+'.png')});}
    await page.locator('#minimap-canvas').evaluate(c=>{c.parentElement.style.visibility='visible';});await page.locator('#minimap-canvas').screenshot({path:path.join(out,'north-minimap.png')});
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({browser:'Chrome',world,map,truck,hangar,errors},null,2)+'\n');console.log('Chrome: northern map, base rendering, navigation, truck driving/recovery and aircraft hangar verified.');
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
