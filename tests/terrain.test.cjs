'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Data=require('../height-data.js');
const Terrain=require('../terrain.js');

test('numeric terrain keeps the supplied PNG provenance and northwest-to-coast elevation pattern',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../assets/reference-heightmap.png'));
  assert.equal(source.readUInt32BE(16),1536);assert.equal(source.readUInt32BE(20),1024);
  assert.equal(source[24],8);assert.equal(source[25],2);
  assert.equal(Data.sourceBitDepth,8);
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),Data.sourceSha256);
  assert.ok(Data.rawHeight(4200,400)>18,'bright northern ridge stays high');
  assert.ok(Data.rawHeight(6000,3600)>1,'central city stays above sea');
  assert.ok(Data.rawHeight(4200,400)>Data.rawHeight(6000,3600)+12);
  assert.equal(Data.rawHeight(700,7000),-3,'southwest bay remains water');
  assert.equal(Data.rawHeight(8520,3600),-3,'reference river remains water');
  assert.equal(Data.rawHeight(6000,10000),-3,'square world padding is ocean');
});

test('terrain samples planar triangles and normals matching the physical heightfield',()=>{
  const terrain=Terrain.createTerrain({size:12000,roads:[],buildings:[]});
  const x=80,y=70,n=terrain.count,index=y*n+x,step=terrain.step;
  terrain.heights[index]=3;terrain.heights[index+1]=5;terrain.heights[index+n]=7;terrain.heights[index+n+1]=12;
  assert.ok(Math.abs(terrain.heightAt((x+.2)*step,(y+.3)*step)-4.6)<1e-9);
  assert.ok(Math.abs(terrain.heightAt((x+.8)*step,(y+.7)*step)-8.9)<1e-9);
  assert.ok(Math.abs(terrain.heightAt((x+.4)*step,(y+.6)*step)-6.2)<1e-9,'both faces meet on diagonal');
  const normal=terrain.normalAt((x+.2)*step,(y+.3)*step);
  assert.ok(Math.abs(Math.hypot(normal.x,normal.y,normal.z)-1)<1e-12);
  assert.ok(normal.x<0&&normal.y>0&&normal.z<0);
  assert.ok(Math.abs(-normal.x/normal.y-2/(step/20))<1e-9);
  assert.ok(Math.abs(-normal.z/normal.y-4/(step/20))<1e-9);
});

test('a bridge supports walking over the original river bed without filling it',()=>{
  const a={x:8000,y:3600},b={x:9500,y:3600};
  const road={id:'river-test',a:'west',b:'east',width:100,bridge:true,points:[a,b],arc:[0,1500],length:1500};
  const terrain=Terrain.createTerrain({size:12000,sidewalkWidth:32,roads:[road],buildings:[]});
  assert.ok(terrain.heightAt(8520,3600)<0);
  assert.ok(terrain.surfaceHeight(8520,3600)>=2);
  const ground=terrain.heightAt(8520,3600),deck=terrain.surfaceHeight(8520,3600);
  assert.equal(terrain.surfaceHeight(8520,3600,ground),ground,'a reference below the bridge selects the river bed');
  assert.equal(terrain.surfaceHeight(8520,3600,deck-.1),deck,'small contact penetration still selects the deck');
  assert.equal(terrain.surfaceHeight(8520,3600,deck+5),deck,'falling from above selects the deck');
  assert.deepEqual(terrain.surfaceNormalAt(8520,3600,ground),terrain.normalAt(8520,3600),'lower ground keeps its own slope');
  assert.deepEqual(terrain.surfaceNormalAt(8520,3600,deck),terrain.surfaceNormalAt(8520,3600),'deck support uses its road grade');
  assert.equal(terrain.isWater(8520,3600),true);
  assert.ok(terrain.surfaceHeight(8520,3800)<terrain.surfaceHeight(8520,3600),'deck support stays inside bridge width');
});
