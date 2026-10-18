'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const World=require('../world.js');
const HeightData=require('../height-data.js');
const {AIRCRAFT_TYPES}=require('../aircraft.js');
const world=World.createWorld();
const airport=world.landscape.airport;
const surfaces=[...airport.runways,...airport.taxiways,...airport.aprons,...airport.walkways];
const parked=[...airport.stands,...airport.militaryStands,...airport.helipads.filter(pad=>!pad.noSpawn)];
const aircraftBox=(stand,type=stand.aircraftType)=>{
  const model=AIRCRAFT_TYPES[type];
  return {x:stand.x-model.length/2,y:stand.y-model.width/2,w:model.length,h:model.width,angle:stand.angle||0};
};
const contains=(rect,point,margin=0)=>{
  const x=point.x-rect.x-rect.w/2,y=point.y-rect.y-rect.h/2,c=Math.cos(rect.angle||0),s=Math.sin(rect.angle||0);
  return Math.abs(x*c+y*s)<=rect.w/2+margin&&Math.abs(-x*s+y*c)<=rect.h/2+margin;
};
function sampleBox(rect,visit,spacing=35) {
  const nx=Math.ceil(rect.w/spacing),ny=Math.ceil(rect.h/spacing),c=Math.cos(rect.angle||0),s=Math.sin(rect.angle||0);
  for(let i=0;i<=nx;i++)for(let j=0;j<=ny;j++){
    const x=rect.w*(i/nx-.5),y=rect.h*(j/ny-.5);
    visit({x:rect.x+rect.w/2+x*c-y*s,y:rect.y+rect.h/2+x*s+y*c});
  }
}

test('the full runway, taxi loop, apron and pedestrian access share one physical level surface',()=>{
  assert.ok(airport.runways[0].w/20>=12,'the runway has clearance beside commuter wings');
  assert.ok(airport.runways[0].h/20>=100,'small planes have an arcade takeoff roll');
  let samples=0;
  for(const surface of surfaces)sampleBox(surface,point=>{
    assert.ok(Math.abs(world.terrain.heightAt(point.x,point.y)-airport.elevation)<.00001,surface.id+' stays physically level');
    assert.ok(Math.abs(world.terrain.surfaceHeight(point.x,point.y)-airport.elevation)<.00001);
    assert.ok(world.terrain.normalAt(point.x,point.y).y>.99999,'wheels and skids stand on level triangles');
    assert.equal(HeightData.isWaterRaw(point.x,point.y,world.mapWidth,world.mapHeight),false);
    samples++;
  });
  assert.ok(samples>1500,'the complete surfaces are checked rather than their centres alone');
  assert.ok(world.network.nearestRoad(airport.pedestrianRoute[0]).distance<.01,'the airport entrance reaches Terminal Avenue');
  assert.ok(airport.aprons.some(apron=>contains(apron,airport.pedestrianRoute.at(-1))));
});

test('the airport walking entrance reaches the apron around parked aircraft wings',()=>{
  for(let i=1;i<airport.pedestrianRoute.length;i++) {
    const a=airport.pedestrianRoute[i-1],b=airport.pedestrianRoute[i],steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/6);
    for(let j=0;j<=steps;j++) {
      const point={x:a.x+(b.x-a.x)*j/steps,y:a.y+(b.y-a.y)*j/steps};
      assert.ok(surfaces.some(surface=>contains(surface,point,.01)),'the walking approach stays on connected pavement');
      const person={x:point.x-8.6,y:point.y-8.6,w:17.2,h:17.2,angle:0};
      for(const stand of parked)assert.equal(World.boxesOverlap(person,aircraftBox(stand)),false,'the player clears '+stand.id);
      for(const building of world.buildings)assert.equal(World.boxesOverlap(person,building),false,'the walking approach clears buildings');
    }
  }
});

test('every plane stand has a continuous clear taxi route to the departure threshold',()=>{
  const threshold=airport.runways.flatMap(runway=>runway.thresholds).find(point=>point.id===airport.departureThresholdId);
  assert.ok(threshold);
  assert.ok(airport.stands.some(stand=>stand.aircraftType==='trainer'));
  assert.ok(airport.stands.some(stand=>stand.aircraftType==='commuter'));
  for(const stand of [...airport.stands,...airport.militaryStands.filter(stand=>stand.type==='plane')]) {
    const route=airport.taxiRoutes.find(route=>route.standId===stand.id);
    assert.ok(route&&route.points.length>=3,stand.id+' has an actual ground route');
    assert.equal(route.points[0].x,stand.x);assert.equal(route.points[0].y,stand.y);
    assert.equal(route.points.at(-1).x,threshold.x);assert.equal(route.points.at(-1).y,threshold.y);
    assert.equal(route.points.at(-1).angle,threshold.angle);
    for(let i=1;i<route.points.length;i++) {
      const a=route.points[i-1],b=route.points[i],steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/12);
      for(let j=0;j<=steps;j++) {
        const point={x:a.x+(b.x-a.x)*j/steps,y:a.y+(b.y-a.y)*j/steps};
        assert.ok(surfaces.some(surface=>contains(surface,point,.01)),stand.id+' taxis entirely on connected pavement');
        assert.ok(Math.abs(world.terrain.heightAt(point.x,point.y)-airport.elevation)<.00001);
      }
    }
  }
});

test('aircraft stands, rotors and runway approaches stay clear of buildings and fixed props',()=>{
  const clearZones=[...airport.runways,...airport.approachCorridors,
    ...[...airport.stands,...airport.militaryStands].map(stand=>aircraftBox(stand)),
    ...airport.storageStands.flatMap(stand=>Object.keys(AIRCRAFT_TYPES).map(type=>aircraftBox(stand,type))),
    ...airport.helipads.map(pad=>({x:pad.x-pad.radius,y:pad.y-pad.radius,w:pad.radius*2,h:pad.radius*2,angle:0}))];
  for(const zone of clearZones)for(const building of world.buildings)
    assert.equal(World.boxesOverlap(zone,building),false,'an airframe or approach must not overlap '+building.id);
  for(const zone of clearZones)for(const object of world.staticObjects)for(const part of object.parts) {
    const angle=object.angle||0,c=Math.cos(angle),s=Math.sin(angle);
    const x=object.x+(part.offset[0]*c-part.offset[2]*s)*20,y=object.y+(part.offset[0]*s+part.offset[2]*c)*20;
    const box={x:x-part.half[0]*20,y:y-part.half[2]*20,w:part.half[0]*40,h:part.half[2]*40,angle};
    assert.equal(World.boxesOverlap(zone,box),false,'an airframe or approach must not overlap '+object.kind);
  }
  for(let i=0;i<parked.length;i++)for(let j=i+1;j<parked.length;j++)
    assert.equal(World.boxesOverlap(aircraftBox(parked[i]),aircraftBox(parked[j]),8),false,'parked wings and rotors have separation');
});

test('the main taxi lane clears every parked airframe with the actual moving wingspan',()=>{
  const north=airport.taxiNodes.find(point=>point.id==='taxi-north');
  const south=airport.taxiNodes.find(point=>point.id==='taxi-south');
  for(const [type,model] of Object.entries(AIRCRAFT_TYPES).filter(([,model])=>model.class==='plane')) {
    const steps=Math.ceil(Math.hypot(south.x-north.x,south.y-north.y)/12);
    for(let i=0;i<=steps;i++) {
      const moving=aircraftBox({x:north.x+(south.x-north.x)*i/steps,y:north.y+(south.y-north.y)*i/steps,angle:Math.PI/2},type);
      for(const stand of parked)
        assert.equal(World.boxesOverlap(moving,aircraftBox(stand),8),false,type+' can taxi past '+stand.id+' with its '+model.width+'-unit wingspan');
      for(const reserve of airport.storageStands)for(const storedType of Object.keys(AIRCRAFT_TYPES))
        assert.equal(World.boxesOverlap(moving,aircraftBox(reserve,storedType),8),false,type+' can taxi past occupied '+reserve.id);
    }
  }
});

test('departing planes can turn out of their stands and around taxi corners without clipping parked aircraft',()=>{
  for(const stand of [...airport.stands,...airport.militaryStands.filter(stand=>stand.type==='plane')]) {
    const route=airport.taxiRoutes.find(route=>route.standId===stand.id).points;
    for(let i=0;i<route.length;i++) {
      const point=route[i];
      const incoming=i?Math.atan2(point.y-route[i-1].y,point.x-route[i-1].x):stand.angle||0;
      const outgoing=i<route.length-1?Math.atan2(route[i+1].y-point.y,route[i+1].x-point.x):point.angle;
      const turn=Math.atan2(Math.sin(outgoing-incoming),Math.cos(outgoing-incoming));
      for(let step=0;step<=60;step++) {
        const turning=aircraftBox({...point,angle:incoming+turn*step/60},stand.aircraftType);
        for(const other of parked.filter(other=>other!==stand))
          assert.equal(World.boxesOverlap(turning,aircraftBox(other),8),false,stand.id+' turns at corner '+i+' clear of '+other.id);
        for(const reserve of airport.storageStands)for(const type of Object.keys(AIRCRAFT_TYPES))
          assert.equal(World.boxesOverlap(turning,aircraftBox(reserve,type),8),false,stand.id+' turns clear of occupied '+reserve.id);
      }
    }
  }
});

test('empty hangar reserves fit every aircraft on connected level land with safe retrieval clearance',()=>{
  assert.ok(airport.storageStands.length>=2,'multiple aircraft can be retrieved without displacing the starting fleet');
  for(const stand of airport.storageStands) {
    assert.equal(stand.type,'any');
    assert.equal(stand.noSpawn,true,'reserve slots stay empty at the start');
    assert.ok(!parked.some(other=>other.id===stand.id));
    assert.ok(Math.abs(stand.elevation-airport.elevation)<.00001,'reserve metadata uses the airport ground elevation');
    for(const type of Object.keys(AIRCRAFT_TYPES)) {
      const footprint=aircraftBox(stand,type);
      sampleBox(footprint,point=>{
        assert.ok(airport.aprons.some(apron=>contains(apron,point,.001)),type+' fits the connected reserve apron');
        assert.ok(Math.abs(world.terrain.heightAt(point.x,point.y)-stand.elevation)<.00001,type+' receives level landing-gear support');
        assert.equal(HeightData.isWaterRaw(point.x,point.y,world.mapWidth,world.mapHeight),false,'reserve space remains on the source map land');
      },15);
      for(const road of world.roads)for(let i=1;i<road.points.length;i++)
        assert.ok(World.segmentBoxDistance(road.points[i-1],road.points[i],footprint)>=road.width/2+world.sidewalkWidth+8,type+' stored at '+stand.id+' clears '+road.id);
      for(const other of [...parked,...airport.helipads.filter(pad=>pad.noSpawn)])
        assert.equal(World.boxesOverlap(footprint,aircraftBox(other),8),false,type+' reserve clears '+other.id);
      for(const other of airport.storageStands.filter(other=>other!==stand))for(const otherType of Object.keys(AIRCRAFT_TYPES))
        assert.equal(World.boxesOverlap(footprint,aircraftBox(other,otherType),8),false,'two retrieved airframes fit their independent reserves');
    }
  }
});

test('visiting military aircraft have safe level stands without needing a military base',()=>{
  const heavy=airport.militaryStands.find(stand=>stand.aircraftType==='transportheli');
  const fighter=airport.militaryStands.find(stand=>stand.aircraftType==='fighter');
  assert.ok(heavy&&fighter,'both later-base aircraft are available as airport visitors');
  for(const stand of airport.militaryStands) {
    const footprint=aircraftBox(stand);
    sampleBox(footprint,point=>{
      assert.ok(airport.aprons.some(apron=>contains(apron,point,.001)),'the whole aircraft fits its apron');
      assert.ok(Math.abs(world.terrain.heightAt(point.x,point.y)-stand.elevation)<.00001,'heavy landing gear has level support');
      assert.equal(HeightData.isWaterRaw(point.x,point.y,world.mapWidth,world.mapHeight),false);
    },15);
    for(const road of world.roads)for(let i=1;i<road.points.length;i++)
      assert.ok(World.segmentBoxDistance(road.points[i-1],road.points[i],footprint)>=road.width/2+world.sidewalkWidth+8,'visiting aircraft clear '+road.id);
    for(const other of [...airport.stands,...airport.helipads,...airport.militaryStands].filter(other=>other!==stand))
      assert.equal(World.boxesOverlap(footprint,aircraftBox(other),8),false,'parked rotor and wing footprints remain separated');
  }
  const passingCommuter=aircraftBox({aircraftType:'commuter',x:10745,y:fighter.y,angle:Math.PI/2});
  assert.equal(World.boxesOverlap(passingCommuter,aircraftBox(fighter),8),false,'the visiting jet leaves clearance for arriving commuter wings');
});

test('town helicopter destinations have a level marina pad and a real broad roof',()=>{
  const marina=world.landscape.helipads.find(pad=>pad.id==='marina-helipad');
  const rooftop=world.landscape.helipads.find(pad=>pad.rooftop);
  assert.ok(marina&&rooftop);
  sampleBox({x:marina.x-marina.radius,y:marina.y-marina.radius,w:marina.radius*2,h:marina.radius*2},point=>{
    assert.equal(HeightData.isWaterRaw(point.x,point.y,world.mapWidth,world.mapHeight),false,'the marina pad is on solid land');
    assert.ok(Math.abs(world.terrain.heightAt(point.x,point.y)-marina.elevation)<.00001);
  },15);
  assert.ok(marina.accessRoute.length>=2);
  const [road,pad]=marina.accessRoute;
  assert.ok(world.network.nearestRoad(road).distance<.01);
  for(const building of world.buildings)assert.equal(World.segmentHitsBox(road,pad,building,16),false,'the marina walking approach is unobstructed');
  const building=world.buildings.find(building=>building.id===rooftop.buildingId);
  assert.ok(building&&building.w>=rooftop.radius*2&&building.h>=rooftop.radius*2,'the entire rotor disc fits the shared building collider');
  assert.ok(Math.abs(rooftop.elevation-building.elevation-building.height-.05)<.00001);
  assert.ok(rooftop.elevation>world.terrain.heightAt(rooftop.x,rooftop.y)+10,'the rooftop is a raised landing destination');
});

test('flight airspace extends around the ground map for turns and approaches',()=>{
  const airspace=world.landscape.airspace;
  assert.ok(airspace.minX<0&&airspace.minY<0&&airspace.maxX>world.mapWidth&&airspace.maxY>world.mapHeight);
  assert.ok(airspace.ceiling>airspace.departureAltitude&&airspace.departureAltitude>airspace.cruiseAltitude);
  assert.equal(world.size,12000,'expanded airspace preserves ground road and terrain coordinates');
});
