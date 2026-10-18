'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
let chromium;
for(const location of [process.env.PLAYWRIGHT_MODULE_PATH,'playwright','C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try{({chromium}=require(location));break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
}
if(!chromium)throw Error('Playwright is required for the Chrome railway check');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),errors=[];
  const context=await browser.newContext({viewport:{width:1600,height:1060}}),page=await context.newPage();
  try {
    await context.addInitScript(()=>{
      let core,Scene;
      Object.defineProperty(globalThis,'MayhemCore',{configurable:true,get:()=>core,set:value=>{core={...value,Game:class extends value.Game{constructor(...args){super(...args);globalThis.__railGame=this;}}};}});
      Object.defineProperty(globalThis,'MayhemScene',{configurable:true,get:()=>Scene,set:value=>{Scene=class extends value{constructor(...args){super(...args);globalThis.__railScene=this;}};}});
    });
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    await page.waitForFunction(()=>globalThis.__railScene?.worldInfo.railway,null,{timeout:45000});
    const info=await page.evaluate(()=>globalThis.__railScene.worldInfo.railway);
    assert.equal(info.crossover,true);assert.equal(info.overpasses,2);assert.equal(info.platforms,2);
    assert.ok(info.helipad.elevation>7);
    const dir=path.resolve(__dirname,'../playtest-evidence/railway');fs.mkdirSync(dir,{recursive:true});
    await page.evaluate(()=>{
      const shell=document.getElementById('game-shell');for(const element of shell.children)if(element.tagName!=='CANVAS')element.style.visibility='hidden';
      const scene=globalThis.__railScene;scene.scene.fog=null;
      const original=scene.renderer.render.bind(scene.renderer);globalThis.__railRender=original;
      const camera=new scene.T.PerspectiveCamera(48,scene.camera.aspect,.1,1600);camera.position.set(365,80,345);camera.lookAt(378,1.8,267);camera.updateMatrixWorld(true);
      scene.renderer.render=(world)=>original(world,camera);scene.renderer.render(scene.scene);
    });
    await page.locator('#game-canvas').screenshot({path:path.join(dir,'station-depot.png')});
    await page.evaluate(()=>{
      const scene=globalThis.__railScene,ratio=scene.camera.aspect,camera=new scene.T.OrthographicCamera(-78,78,78/ratio,-78/ratio,.1,1000);
      camera.position.set(382,180,271);camera.up.set(0,0,-1);camera.lookAt(382,0,271);camera.updateMatrixWorld(true);
      scene.renderer.render=(world)=>globalThis.__railRender(world,camera);scene.renderer.render(scene.scene);
    });
    await page.locator('#game-canvas').screenshot({path:path.join(dir,'station-overhead.png')});
    await page.evaluate(()=>{
      const scene=globalThis.__railScene,ratio=scene.camera.aspect,camera=new scene.T.PerspectiveCamera(46,ratio,.1,1000);
      camera.position.set(389,19,195);camera.lookAt(396,4,185);camera.updateMatrixWorld(true);
      scene.renderer.render=(world)=>globalThis.__railRender(world,camera);scene.renderer.render(scene.scene);
    });
    await page.locator('#game-canvas').screenshot({path:path.join(dir,'rail-overpass.png')});
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(dir,'browser-report.json'),JSON.stringify({browser:'Chrome',info,errors},null,2)+'\n');
    console.log('Chrome rendered the station, crossover, crossings and depot rooftop pad without page errors.');
  } catch(error) {
    console.error('Page errors:',errors);console.error(await page.locator('#renderer-error-detail').textContent().catch(()=>''));throw error;
  } finally {await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
