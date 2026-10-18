'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Data=require('../height-data.js');
const Terrain=require('../terrain.js');
const North=require('../north-height-data.js');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Heightmap=require('../tools/build-military-heightmap.cjs');

function extended(extra={}) {
  return Terrain.createTerrain({size:12000,mapWidth:12000,mapHeight:12000,mapMinY:-4000,
    referenceMapWidth:12000,referenceMapHeight:8000,bounds:{minX:0,minY:-4000,maxX:12000,maxY:8000},
    roads:[],buildings:[],...extra});
}

test('north expansion keeps the city grid anchored and leaves every old city vertex unchanged',()=>{
  const city=Terrain.createTerrain({size:12000,roads:[],buildings:[]}),north=extended();
  assert.equal(north.count,257);assert.equal(north.rows,258);assert.equal(north.step,city.step);
  assert.equal(north.originX,0);assert.equal(north.originY,-4031.25);
  assert.equal(north.heights.length,north.count*north.rows);
  const offset=-north.originY/north.step;
  for(let row=0;row<=170;row++)for(let col=0;col<city.count;col++)
    assert.equal(north.heights[(row+offset)*north.count+col],city.heights[row*city.count+col]);
  for(const [x,y] of [[4200,400],[6000,3600],[8520,3600],[700,7000],[9900,7900]]) {
    assert.ok(Math.abs(north.heightAt(x,y)-city.heightAt(x,y))<1e-11);
    assert.equal(north.rawHeight(x,y),Data.rawHeight(x,y));
    assert.equal(north.isWater(x,y),city.isWater(x,y));
  }
});

test('negative coordinates sample the actual northern triangles and unit normals',()=>{
  const terrain=extended(),col=52,row=18,index=row*terrain.count+col,step=terrain.step;
  terrain.heights[index]=3;terrain.heights[index+1]=5;
  terrain.heights[index+terrain.count]=7;terrain.heights[index+terrain.count+1]=12;
  const x=(col+.2)*step,y=terrain.originY+(row+.3)*step;
  assert.ok(y<0);assert.ok(Math.abs(terrain.heightAt(x,y)-4.6)<1e-9);
  const normal=terrain.normalAt(x,y);
  assert.ok(Math.abs(Math.hypot(normal.x,normal.y,normal.z)-1)<1e-12);
  assert.ok(Math.abs(-normal.x/normal.y-2/(step/20))<1e-9);
  assert.ok(Math.abs(-normal.z/normal.y-4/(step/20))<1e-9);
});

test('northern base pads support the full runway and adjoining shoulders at the declared elevation',()=>{
  const pad={x:1600,y:-3200,w:2800,h:250,elevation:14};
  const terrain=extended({militaryBase:{pads:[pad]},buildings:[{x:1800,y:-2900,w:300,h:200}]});
  for(let x=pad.x;x<=pad.x+pad.w;x+=100)for(const y of [pad.y,pad.y+pad.h/2,pad.y+pad.h])
    assert.equal(terrain.heightAt(x,y),14);
  assert.equal(terrain.heightAt(pad.x-30,pad.y+pad.h/2),14);
  assert.ok(Number.isFinite(terrain.heightAt(0,-4000)));
  assert.ok(Number.isFinite(terrain.heightAt(12000,8000)));
});

test('northern roads grade and sample below the old zero coordinate',()=>{
  const points=Array.from({length:31},(_,i)=>({x:5000+i*20,y:-2000+i*30}));
  const arc=points.map((_,i)=>i*Math.hypot(20,30));
  const road={id:'north-grade-test',a:'base',b:'pass',width:80,points,arc,length:arc.at(-1)};
  const terrain=extended({roads:[road]});
  for(let i=0;i<points.length;i++) {
    assert.ok(Number.isFinite(points[i].elevation));
    assert.equal(terrain.roadHeight(road.id,arc[i]),terrain.heightAt(points[i].x,points[i].y));
  }
});

test('a fixed fourteen metre formation keeps a gentle physical road approach',()=>{
  const points=Array.from({length:101},(_,i)=>({x:6400,y:-1400+i*20}));
  const arc=points.map((_,i)=>i*20),road={id:'formation-access',a:'base',b:'city',width:110,points,arc,length:arc.at(-1)};
  const terrain=extended({roads:[road],militaryBase:require('../military.js').createMilitaryBase()});
  assert.equal(points[0].elevation,14);
  for(let i=1;i<points.length;i++)assert.ok(Math.abs(points[i].elevation-points[i-1].elevation)<.14001);
  for(let y=-1400;y<=-750;y+=20)assert.equal(terrain.heightAt(6400,y),14);
});

test('northern source joins the preserved city seam without a vertical step',()=>{
  for(let x=0;x<=12000;x+=75) {
    assert.equal(North.rawHeight(x,0),Data.rawHeight(x,0));
    assert.ok(Math.abs(North.rawHeight(x,-.001)-Data.rawHeight(x,0))<1e-7);
  }
});

test('the importer crops the northern third and its PNG encoding round-trips exact pixels',()=>{
  const width=8,height=12,pixels=Buffer.alloc(width*height*3);
  for(let row=0;row<height;row++)pixels.fill(row<height/3?150:20,row*width*3,(row+1)*width*3);
  const png=Heightmap.encode(width,height,pixels),decoded=Heightmap.decode(png);
  assert.equal(decoded.width,width);assert.equal(decoded.height,height);assert.ok(decoded.pixels.equals(pixels));
  const imported=Heightmap.importSource(png,false);
  assert.ok(imported.bytes[0]>140);assert.ok(imported.bytes.at(-1)>140);
});

test('cleaned export retains every applied city pixel and verifies ImageGen provenance',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/north-heightmap.json'),'utf8'));
  const source=fs.readFileSync(path.join(__dirname,'..',manifest.source));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),North.sourceSha256);
  assert.equal(manifest.sourceSha256,North.sourceSha256);
  const city=Heightmap.decode(fs.readFileSync(path.join(__dirname,'../assets/railway-heightmap.png')));
  const combined=Heightmap.decode(fs.readFileSync(path.join(__dirname,'../assets/north-heightmap-combined.png')));
  const offset=(combined.height-city.height)*combined.width*3;
  assert.equal(combined.width,city.width);assert.ok(combined.pixels.subarray(offset).equals(city.pixels));
  assert.equal(manifest.citySourcePixelChanges,0);assert.equal(manifest.cityWaterMaskChanges,0);
  assert.equal(manifest.northernRailExtension,true);
});

let actualWorld;
const fullWorld=()=>actualWorld??=require('../world.js').createWorld();
test('the actual curved access roads stay below fourteen percent in any heading',()=>{
  const world=fullWorld();
  for(const road of world.roads.filter(road=>road.district==='military'))for(let i=1;i<road.points.length;i++) {
    const a=road.points[i-1],b=road.points[i],grade=Math.abs(b.elevation-a.elevation)/(Math.hypot(b.x-a.x,b.y-a.y)/20);
    assert.ok(grade<=.14001,`${road.id} reaches ${(grade*100).toFixed(2)}%`);
  }
});

test('the extended twin rails use dry low-grade formation and the cleaned export includes their earthworks',()=>{
  const world=fullWorld(),terrain=world.terrain,exported=Heightmap.decode(fs.readFileSync(path.join(__dirname,'../assets/north-heightmap.png')));
  for(const track of world.railway.tracks)for(let i=0;i<track.points.length;i++) {
    const point=track.points[i];if(point.y>=0)continue;
    assert.equal(North.isWaterRaw(point.x,point.y),false,'the new railway bypasses the generated river');
    assert.equal(terrain.isWater(point.x,point.y),false);
    assert.ok(Math.abs(terrain.heightAt(point.x,point.y)-point.elevation)<.00001);
    if(i%20||point.y>-300||point.y<-3900)continue;
    const col=Math.round(point.x/12000*(exported.width-1)),row=Math.round((point.y+4000)/4000*exported.height);
    const gray=exported.pixels[(row*exported.width+col)*3];
    assert.equal(gray,76,'the cleaned raster contains the low rail formation');
  }
});
