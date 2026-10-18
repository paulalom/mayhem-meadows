'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const World=require('../world.js'),Railway=require('../railway.js'),Data=require('../height-data.js'),North=require('../north-height-data.js');
const {decode,generate}=require('../tools/build-railway-heightmap.cjs');
const world=World.createWorld(),railway=world.railway;
function distanceToTrack(p,line) {
  let best=Infinity;
  for(let i=1;i<line.points.length;i++) {
    const a=line.points[i-1],b=line.points[i],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
    best=Math.min(best,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
  }
  return best;
}
test('cleaned heightmap preserves source water and all pixels outside the earthworks',()=>{
  const source=decode(fs.readFileSync(path.join(__dirname,'../assets/reference-heightmap.png'))),built=generate(),clean=decode(built.image),cityRailway=Railway.createRailway();
  assert.equal(source.width,clean.width);assert.equal(source.height,clean.height);
  assert.ok(built.image.equals(fs.readFileSync(path.join(__dirname,'../assets/railway-heightmap.png'))));
  let changed=0;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++) {
    const index=(y*source.width+x)*3,original=source.pixels[index],value=clean.pixels[index];
    assert.equal(value<=8,original<=8,'the coastline and channels are unchanged');
    if(value!==original) {
      const h=.35+32*Math.pow((original-8)/247,2);
      assert.notEqual(Railway.earthworks(cityRailway,x/(source.width-1)*12000,y/(source.height-1)*8000,h),h,'only engineered earthworks change');changed++;
    } else for(let c=0;c<3;c++)assert.equal(clean.pixels[index+c],source.pixels[index+c]);
  }
  assert.ok(changed>20000&&changed<100000);
});
test('rail corridors stay dry, clear occupied lots and have a gentle physical profile',()=>{
  let grade=0;
  for(const line of railway.tracks)for(let i=0;i<line.points.length;i++) {
    const p=line.points[i],height=world.terrain.heightAt(p.x,p.y);
    assert.equal(p.y<0?North.isWaterRaw(p.x,p.y):Data.isWaterRaw(p.x,p.y),false,line.id+' stays on dry source land');
    if(i){const previous=line.points[i-1],span=Math.hypot(p.x-previous.x,p.y-previous.y)/20;if(span>.01)grade=Math.max(grade,Math.abs(height-world.terrain.heightAt(previous.x,previous.y))/span);}
  }
  assert.ok(grade<.04,'arcade railway formation remains below four percent');
  for(const building of world.buildings)assert.equal(Railway.intersectsBox(railway,building,0),false,building.id+' keeps clear of tracks');
});
test('both passenger tracks join the main line and the crossover connects the two platform tracks',()=>{
  const find=id=>railway.tracks.find(t=>t.id===id),first=find('platform-1'),second=find('platform-2'),cross=find('station-crossover');
  assert.ok(distanceToTrack(first.points[0],find('main-east'))<.001);
  assert.ok(distanceToTrack(second.points[0],find('main-west'))<.001);
  assert.ok(distanceToTrack(cross.points[0],first)<.001);
  assert.ok(distanceToTrack(cross.points.at(-1),second)<.001);
  assert.equal(railway.operation.turnaround,'reverse');assert.equal(railway.operation.doubleEnded,true);
  for(const [branch,main]of [[first,find('main-east')],[second,find('main-west')]]){const a=main.points.at(-2),b=main.points.at(-1),c=branch.points[1],turn=Math.atan2(c.y-b.y,c.x-b.x)-Math.atan2(b.y-a.y,b.x-a.x);assert.ok(Math.abs(Math.sin(turn))<.04,'passenger turnouts retain the main-line tangent');}
  assert.ok(cross.points[0].x>Math.max(...railway.platforms.map(p=>p.x+p.w)),'switches lie beyond the passenger platforms');
});
test('river approaches bridge above the rail bed and quiet road crossings remain drivable',()=>{
  const overpasses=railway.crossings.filter(c=>c.kind==='overpass');assert.equal(overpasses.length,2);
  for(const crossing of overpasses) {
    const ground=world.terrain.heightAt(crossing.x,crossing.y),deck=world.terrain.surfaceHeight(crossing.x,crossing.y);
    assert.ok(deck-ground>=crossing.clearance,'road deck leaves room for the railway');
    const road=world.network.roadById.get(crossing.roadId);
    assert.ok(Math.abs(world.terrain.roadHeight(road.id,crossing.s)-deck)<.001);
  }
  assert.ok(railway.crossings.some(c=>c.kind==='gated'&&c.roadId==='warehouse-road'));
  for(const p of railway.platforms)assert.ok(world.staticObjects.some(o=>o.id===p.id&&!o.destructible),'platforms and canopies have physical shapes');
});
test('depot helipad fits a solid roof and exports its true landing elevation',()=>{
  const pad=railway.helipad,depot=world.buildings.find(b=>b.id===pad.buildingId);
  assert.ok(pad.x-pad.radius>=depot.x&&pad.x+pad.radius<=depot.x+depot.w);
  assert.ok(pad.y-pad.radius>=depot.y&&pad.y+pad.radius<=depot.y+depot.h);
  assert.ok(Math.abs(pad.elevation-depot.elevation-depot.height)<=.051,'landing skin sits on the physical roof');
  assert.ok(world.landscape.helipads.includes(pad));
  assert.ok(pad.elevation>world.terrain.heightAt(pad.x,pad.y)+5,'the roof is separate from ground elevation');
});
