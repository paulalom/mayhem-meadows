'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const World=require('../world.js');
const HeightData=require('../height-data.js');
const NorthHeightData=require('../north-height-data.js');
const world=World.createWorld();
const wet=(x,y)=>y<0?NorthHeightData.isWaterRaw(x,y):HeightData.isWaterRaw(x,y,world.referenceMapWidth,world.referenceMapHeight);

function sampleBox(box,visit,spacing=12) {
  const cx=box.x+box.w/2,cy=box.y+box.h/2,c=Math.cos(box.angle||0),s=Math.sin(box.angle||0);
  const nx=Math.max(1,Math.ceil(box.w/spacing)),ny=Math.max(1,Math.ceil(box.h/spacing));
  for(let i=0;i<=nx;i++) for(let j=0;j<=ny;j++) {
    const x=box.w*(i/nx-.5),y=box.h*(j/ny-.5);
    visit(cx+x*c-y*s,cy+x*s+y*c);
  }
}

test('all ordinary streets and whole sidewalk ribbons fit actual source land',()=>{
  let samples=0;
  for(const road of world.roads.filter(road=>!road.bridge)) {
    for(let s=0;s<=road.length;s+=8) {
      const half=road.width/2+world.sidewalkWidth,steps=Math.ceil(half*2/8);
      for(let j=0;j<=steps;j++) {
        const p=world.network.pointOnRoad(road.id,s,-half+j*half*2/steps);
        assert.equal(wet(p.x,p.y),false,road.id+' leaves source land at '+s);
        samples++;
      }
    }
  }
  assert.ok(samples>100000,'the whole carriageway and both sidewalks are scanned, including narrow marsh channels');
});

test('oriented buildings, lots, shared solids and parking approaches never span source water',()=>{
  const objects=[...world.buildings,...world.blocks,...world.blocks.map(block=>block.driveway),...world.parkingBays,...world.parkingBays.map(bay=>bay.access),
    ...world.landscape.airport.runways,...world.landscape.airport.taxiways,...world.landscape.airport.aprons];
  for(const object of world.staticObjects) for(const part of object.parts) {
    const angle=object.angle||0,c=Math.cos(angle),s=Math.sin(angle);
    const x=object.x+(part.offset[0]*c-part.offset[2]*s)*20,y=object.y+(part.offset[0]*s+part.offset[2]*c)*20;
    objects.push({id:object.id,x:x-part.half[0]*20,y:y-part.half[2]*20,w:part.half[0]*40,h:part.half[2]*40,angle});
  }
  for(const object of objects) sampleBox(object,(x,y)=>{
    assert.ok(x>world.bounds.minX&&x<world.bounds.maxX&&y>world.bounds.minY&&y<world.bounds.maxY,'all structures stay inside the expanded playable land region');
    assert.equal(wet(x,y),false,(object.id||'parking access')+' spans a source-water cell');
  });
  for(const path of world.pedPaths) for(let i=1;i<path.points.length;i++) {
    const a=path.points[i-1],b=path.points[i],length=Math.hypot(b.x-a.x,b.y-a.y);
    sampleBox({x:(a.x+b.x-length)/2,y:(a.y+b.y)/2-6.02,w:length,h:12.04,angle:Math.atan2(b.y-a.y,b.x-a.x)},
      (x,y)=>assert.equal(wet(x,y),false,path.id+' sends an NPC into source water'),6);
  }
});

test('both river crossings have playable decks and retain the river bed underneath',()=>{
  const bridges=world.roads.filter(road=>road.bridge);
  assert.equal(bridges.length,2);
  for(const road of bridges) {
    const wetPoints=[];
    for(let s=0;s<=road.length;s+=12) {
      const p=world.network.pointOnRoad(road.id,s);
      if(wet(p.x,p.y)&&world.terrain.heightAt(p.x,p.y)<-1) wetPoints.push({...p,s});
    }
    assert.ok(wetPoints.length>20,road.id+' crosses the actual river rather than only a painted map label');
    for(const point of wetPoints) {
      assert.ok(world.terrain.surfaceHeight(point.x,point.y)>=1.99,'the deck sits above the water');
      assert.ok(world.terrain.heightAt(point.x,point.y)<-1,'the bridge does not fill the seabed');
      assert.ok(Math.abs(world.terrain.roadHeight(road.id,point.s)-point.elevation)<.001);
    }
    assert.ok(world.network.route(world.start.player,world.network.nodeById.get(road.b),18).length>0);
  }
  for(const point of [{x:2000,y:5500},{x:3800,y:5500},{x:6000,y:10000}]) {
    assert.equal(wet(point.x,point.y),true);
    assert.ok(world.terrain.heightAt(point.x,point.y)<-1,'west coast, marina bay and source padding remain ocean');
  }
});

test('bridge decks clear the full terrain width and meet adjoining ground streets',()=>{
  for(const road of world.roads.filter(road=>road.bridge||road.railOverpasses?.length)) {
    for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1],b=road.points[i],length=Math.hypot(b.x-a.x,b.y-a.y);
      for(let j=0;j<=8;j++)for(const side of [-1,-.5,0,.5,1]) {
        const t=j/8,offset=side*(road.width/2+world.sidewalkWidth);
        const x=a.x+(b.x-a.x)*t-(b.y-a.y)/length*offset,y=a.y+(b.y-a.y)*t+(b.x-a.x)/length*offset;
        const deck=a.elevation+(b.elevation-a.elevation)*t;
        assert.ok(world.terrain.heightAt(x,y)<=deck+.00001,road.id+' terrain rises through its deck at '+i+','+t+','+side);
      }
    }
    for(const [id,point] of [[road.a,road.points[0]],[road.b,road.points.at(-1)]]) {
      const streets=world.roads.filter(other=>!other.bridge&&!other.railOverpasses?.length&&(other.a===id||other.b===id));
      if(!streets.length)continue;
      assert.ok(Math.abs(world.terrain.heightAt(point.x,point.y)-point.elevation)<.025,road.id+' has no step at '+id);
      for(const street of streets) {
        const end=street.points[street.a===id?0:street.points.length-1];
        assert.ok(Math.abs(end.elevation-point.elevation)<.025,'the ground street and deck share their junction height');
      }
    }
  }
});

test('terrain is populated before world consumers and roads expose metre elevations',()=>{
  const t=world.terrain;
  assert.equal(t.count,257);assert.equal(t.rows,258);assert.equal(t.heights.length,t.count*t.rows);assert.equal(t.step,world.size/256);
  assert.ok(Math.max(...t.heights)>30,'the source mountain remains visible above the graded roads');
  for(const road of world.roads) {
    for(let i=0;i<road.points.length;i++) {
      const point=road.points[i];assert.ok(Number.isFinite(point.elevation));
      if(i) {
        const previous=road.points[i-1],metres=Math.hypot(point.x-previous.x,point.y-previous.y)/20;
        assert.ok(Math.abs(point.elevation-previous.elevation)/metres<.20,road.id+' remains an arcade-drivable grade');
      }
    }
    const p=world.network.pointOnRoad(road.id,road.length*.43);
    assert.ok(Number.isFinite(p.elevation));
    assert.ok(Number.isFinite(world.network.project(p).elevation));
  }
  for(const object of [...world.buildings,...world.staticObjects,...world.services,...world.vehicleSpawns,...Object.values(world.start)]) {
    assert.ok(Number.isFinite(object.elevation)&&object.elevation>=.2,'every placed object receives its ground elevation');
  }
  const hill=world.network.roadById.get('ridge-hairpin4'),low=world.network.pointOnRoad(hill.id,100),high=world.network.pointOnRoad(hill.id,650);
  assert.ok(high.elevation-low.elevation>3,'a real continuous hill climb is available near the mountain hairpins');
  assert.equal(World.districtAt(world.start.player).id,'market');
  assert.equal(World.districtAt(world.missionAnchors.byName['marsh-lookout']).id,'marsh');
});
