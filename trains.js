/* Scheduled, reversible rail traffic. Distances are world units; time is simulation seconds. */
(function(root){
  'use strict';
  const Rail=root.MayhemRailway||(typeof require==='function'?require('./railway.js'):null);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const SCHEDULE=Object.freeze([
    {id:'local-1',name:'Northport Local',destination:'Central Station · Platform 1',track:'platform-1',interval:600,offset:8,dwell:18,kind:'passenger'},
    {id:'local-2',name:'Northport Local',destination:'Central Station · Platform 2',track:'platform-2',interval:600,offset:308,dwell:18,kind:'passenger'},
    {id:'dock-freight',name:'Docklands Shuttle',destination:'Docklands freight terminal',track:'freight-main',interval:1200,offset:230,dwell:28,kind:'freight'},
    {id:'yard-freight',name:'Container Shuttle',destination:'Container yard siding',track:'freight-siding',interval:1200,offset:830,dwell:28,kind:'freight'}
  ]);
  const MODELS=Object.freeze({passenger:{length:170,width:45.1,height:2.71},cab:{length:120,width:45.1,height:2.71},container:{length:140,width:44,height:2.55}});
  function sample(line,s){
    const p=line.points,n=p.length;
    let i=1;if(s>=line.length)i=n-1;else if(s>0){let lo=0,hi=n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(p[m].s<s)lo=m;else hi=m;}i=hi;}
    const a=p[i-1],b=p[i],span=b.s-a.s,t=span?(s-a.s)/span:0;
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)};
  }
  function project(line,p){let best=Infinity,at=0;for(let i=1;i<line.points.length;i++){const a=line.points[i-1],b=line.points[i],dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy),0,1),d=Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);if(d<best){best=d;at=a.s+(b.s-a.s)*t;}}return at;}
  const inCrossing=Rail.inCrossing;
  function buildRoutes(layout){
    const tracks=new Map(layout.tracks.map(t=>[t.id,t])),get=id=>tracks.get(id),end=id=>get(id).length-24;
    const cross=get('station-crossover'),cross1=project(get('platform-1'),cross.points[0]),cross2=project(get('platform-2'),cross.points.at(-1)),join=project(get('freight-main'),get('freight-siding').points[0]);
    const piece=(id,a=0,b=get(id).length)=>({id,a,b});
    function compile(pieces,outbound){
      const points=[],segments=[];let length=0;
      for(const part of pieces){const line=get(part.id),direction=Math.sign(part.b-part.a),cuts=[part.a,...line.points.map(p=>p.s).filter(s=>s>Math.min(part.a,part.b)&&s<Math.max(part.a,part.b)).sort((a,b)=>direction*(a-b)),part.b],start=length;
        for(const s of cuts){const p=sample(line,s),previous=points.at(-1);if(previous){const gap=distance(p,previous);if(s===part.a&&gap>1)throw Error('Disconnected railway route: '+part.id+' '+gap);if(gap<.001)continue;length+=gap;}points.push({...p,s:length});}
        segments.push({...part,start,end:length});
      }
      if(outbound){const last=points.at(-1),previous=points.at(-2),a=Math.atan2(last.y-previous.y,last.x-previous.x);length+=600;points.push({x:last.x+Math.cos(a)*600,y:last.y+Math.sin(a)*600,s:length});}
      const route={points,length,segments,blocks:[],crossings:[]};
      const add=(id,start,end)=>{const existing=route.blocks.find(b=>b.id===id);if(existing){existing.start=Math.min(existing.start,start);existing.end=Math.max(existing.end,end);}else route.blocks.push({id,start,end});};
      for(const part of segments){const line=get(part.id),split=part.id.startsWith('platform')?line.length-630:part.id==='freight-main'?join:null;
        const ranges=split===null?[[0,line.length,part.id]]:[[0,split,part.id+'-approach'],[split,line.length,part.id+'-berth']];
        for(const [lo,hi,id]of ranges){const a=Math.max(Math.min(part.a,part.b),lo),b=Math.min(Math.max(part.a,part.b),hi);if(b>a){const x=part.start+Math.abs(a-part.a),y=part.start+Math.abs(b-part.a);add(id,Math.min(x,y),Math.max(x,y));}}
      }
      // These shared interlockings also protect routes which intersect on different named tracks.
      for(const zone of [{id:'junction',x:8200,y:4700,r:330},{id:'station-throat',x:7580,y:5376,r:260},{id:'yard-throat',x:8410,y:5340,r:260}]){
        const hits=points.filter(p=>distance(p,zone)<zone.r);if(hits.length)add(zone.id,Math.max(0,hits[0].s-24),hits.at(-1).s+24);
      }
      for(const crossing of layout.crossings.filter(c=>c.kind==='gated')){const hits=points.filter(p=>inCrossing(crossing,p,42));if(hits.length)route.crossings.push({id:crossing.id,start:Math.max(0,hits[0].s-18),end:hits.at(-1).s+18});}
      return route;
    }
    const result={};
    for(const service of SCHEDULE){const main=service.track==='platform-1'?'main-east':'main-west';let inbound=[piece(main)],outbound;
      if(service.track==='freight-siding')inbound.push(piece('freight-main',0,join));inbound.push(piece(service.track,0,end(service.track)));
      if(service.track==='platform-1')outbound=[piece('platform-1',end('platform-1'),cross1),piece('station-crossover'),piece('platform-2',cross2,0),piece('main-west',get('main-west').length,0)];
      else {outbound=[piece(service.track,end(service.track),0)];if(service.track==='freight-siding')outbound.push(piece('freight-main',join,0));outbound.push(piece(main,get(main).length,0));}
      result[service.id]={inbound:compile(inbound,false),outbound:compile(outbound,true)};
    }
    return result;
  }
  class TrainSystem{
    constructor(game){this.game=game;this.layout=game.world?.railway;this.time=0;this.accumulator=0;this.events=[];this.reservations=new Map();this.cars=[];this.barriers=[];this.services=[];this.gates=[];if(!this.layout)return;
      this.routes=buildRoutes(this.layout);
      for(const spec of SCHEDULE){const types=spec.kind==='passenger'?['passenger','passenger']:['cab','container','cab'];let length=0;
        const cars=types.map((type,i)=>{const model=MODELS[type],car={id:'train-'+spec.id+'-'+i,kind:'train',model:type,railModel:model,serviceId:spec.id,visible:false,active:false,angle:0,pitch:0,roll:0,elevation:0,x:0,y:0,vx:0,vy:0,verticalVelocity:0,speed:0,offset:length+model.length/2,modelFlip:i===types.length-1?Math.PI:0};length+=model.length+12;this.cars.push(car);return car;});
        this.services.push({...spec,cars,length:length-12,state:'idle',next:spec.offset,speed:0,front:0,leg:'inbound',completed:0,waitSince:null,usedTracks:new Set()});
      }
      for(const crossing of this.layout.crossings.filter(c=>c.kind==='gated')){
        const gate={...crossing,state:'open',timer:0,progress:0,requested:[],occupied:false};this.gates.push(gate);
        for(const stop of crossing.stopLines){const car={id:crossing.id+'-barrier-'+stop.end,kind:'rail-gate',railModel:{length:crossing.width+2*(game.world.sidewalkWidth||18)+24,width:6,height:.18},x:stop.x,y:stop.y,angle:stop.angle+Math.PI/2,pitch:0,roll:0,elevation:0,vx:0,vy:0,visible:false,active:false,gateId:crossing.id};car.elevation=game.world.terrain.heightAt(car.x,car.y)+1.0;this.barriers.push(car);}
      }
    }
    get colliders(){return this.cars.concat(this.barriers).filter(c=>c.visible&&c.active);}
    boardingTarget(person){
      if(person.vehicleId||person.trainRide||person.parachuting||person.grounded===false)return null;
      let nearest=null;
      for(const car of this.cars){
        if(!car.visible||!car.active||Math.abs(person.elevation-car.elevation)>1.8)continue;
        const c=Math.cos(car.angle),s=Math.sin(car.angle),dx=person.x-car.x,dy=person.y-car.y;
        const along=dx*c+dy*s,across=-dx*s+dy*c,half=car.railModel.length/2,width=car.railModel.width/2;
        const service=this.services.find(value=>value.id===car.serviceId),rear=service?.leg==='outbound'?1:-1;
        const candidates=[];
        if(Math.abs(along)<=half)candidates.push({along:clamp(along,-half+16,half-16),across:(across<0?-1:1)*(width+8),facing:across<0?Math.PI/2:-Math.PI/2});
        if(service&&car===service.cars[rear===1?0:service.cars.length-1]&&along*rear>=half&&Math.abs(across)<=width+12)
          candidates.push({along:rear*(half+8),across:clamp(across,-width+8,width-8),facing:rear===1?Math.PI:0});
        for(const target of candidates){const gap=Math.hypot(along-target.along,across-target.across);
          if(gap>42||nearest&&gap>=nearest.distance)continue;
          const pose=this.riderPose({carId:car.id,...target});
          const bounds=this.game._worldBounds?.();
          if(bounds&&(pose.x<bounds.minX+18||pose.x>bounds.maxX-18||pose.y<bounds.minY+18||pose.y>bounds.maxY-18))continue;
          if(this.game._blockedLine?.(person,pose,person.elevation+.8,pose.elevation+.8))continue;
          if(this.game._isFree&&!this.game._isFree(pose.x,pose.y,8,pose.elevation))continue;
          if(this.colliders.some(other=>other!==car&&this.game._personVehicleContact?.(pose,other,8)))continue;
          nearest={carId:car.id,...target,distance:gap};
        }
      }
      return nearest;
    }
    riderPose(ride){
      const car=this.cars.find(value=>value.id===ride.carId&&value.visible&&value.active);if(!car)return null;
      const c=Math.cos(car.angle),s=Math.sin(car.angle);
      return {x:car.x+c*ride.along-s*ride.across,y:car.y+s*ride.along+c*ride.across,
        elevation:car.elevation+.35+Math.sin(car.pitch)*ride.along/20,angle:car.angle+ride.facing,verticalVelocity:car.verticalVelocity||0,grounded:false};
    }
    exitPoints(ride){
      const car=this.cars.find(value=>value.id===ride.carId);if(!car)return [];
      const half=car.railModel.length/2,width=car.railModel.width/2,side=Math.sign(ride.across)||1;
      // Try the boarding side first, then clear ground beside the other side.
      return [side,-side].flatMap(sign=>[ride.along,0,-half-26,half+26].map(along=>({
        x:car.x+Math.cos(car.angle)*along-Math.sin(car.angle)*sign*(width+26),
        y:car.y+Math.sin(car.angle)*along+Math.cos(car.angle)*sign*(width+26)})));
    }
    event(type,data={}){this.events.push({time:this.time,type,...data});if(this.events.length>4096)this.events.splice(0,1024);}
    step(dt){if(!Number.isFinite(dt)||dt<=0)return;if(this.game.world?.railway!==this.layout||!this.game.world?.terrain?.heightAt){for(const c of this.cars.concat(this.barriers))c.visible=c.active=false;this.reservations.clear();return;}this.accumulator+=Math.min(dt,1);while(this.accumulator>=1/60-1e-9){this.accumulator-=1/60;this._tick(1/60);}}
    _request(service,leg){const route=this.routes[service.id][leg];if(route.blocks.some(b=>this.reservations.has(b.id)&&this.reservations.get(b.id)!==service.id))return false;
      for(const b of route.blocks)this.reservations.set(b.id,service.id);service.leg=leg;service.route=route;service.front=leg==='outbound'?service.length:0;service.speed=0;service.state='running';service.usedTracks=new Set();
      if(leg==='inbound')for(const car of service.cars)car._posed=false;
      this.event('depart',{service:service.id,leg,destination:leg==='inbound'?service.destination:'Northport (off map)',scheduled:service.due,delay:Math.max(0,this.time-service.due)});return true;
    }
    _tick(dt){this.time+=dt;
      const waiting=[];for(const service of this.services){if(service.state==='idle'&&this.time>=service.next){service.state='queued';service.due=service.next;service.requestLeg='inbound';}if(service.state==='dwell'&&this.time>=service.until){service.state='queued';service.due=service.until;service.requestLeg='outbound';}if(service.state==='queued')waiting.push(service);}
      waiting.sort((a,b)=>a.due-b.due);for(const service of waiting)if(!this._request(service,service.requestLeg)&&service.waitSince===null){service.waitSince=this.time;this.event('wait',{service:service.id,leg:service.requestLeg});}
      this._gates(dt);
      for(const service of this.services)if(service.state==='running')this._move(service,dt);
    }
    _occupied(gate){
      const game=this.game,vehicles=(game.cars||[]).concat(game.police||[],game.aircraft||[]),people=(game.peds||[]).concat(game.player&&!game.player.vehicleId&&!game.player.trainRide?[game.player]:[]);
      return vehicles.concat(people).some(entity=>{if(entity.visible===false)return false;
        const model=entity.railModel||entity.aircraftType&&root.MayhemAircraft?.AIRCRAFT_TYPES[entity.aircraftType],radius=model?Math.hypot(model.length,model.width)/2:entity.kind?45:10;
        if(!inCrossing(gate,entity,radius+8))return false;const base=game.world.terrain.heightAt(entity.x,entity.y);return (entity.elevation??base)-base<=3.05;
      });
    }
    _gateState(gate,state){if(gate.state===state)return;gate.state=state;gate.timer=0;this.event('crossing',{crossing:gate.id,state,requested:gate.requested.slice()});}
    _gates(dt){for(const gate of this.gates){gate.requested=[];gate.occupied=this._occupied(gate);
        for(const train of this.services)if(train.state==='running')for(const hit of train.route.crossings)if(hit.id===gate.id&&train.front-train.length<hit.end+85&&train.front+train.speed*train.speed/72+train.speed*7+180>hit.start)gate.requested.push(train.id);
        gate.timer+=dt;
        if(gate.requested.length){if(gate.state==='open'||gate.state==='opening'||gate.state==='clearing')this._gateState(gate,'warning');if(gate.state==='warning'&&gate.timer>=3&&!gate.occupied)this._gateState(gate,'closing');if(gate.state==='closing'){if(gate.occupied)this._gateState(gate,'warning');else if(gate.timer>=2)this._gateState(gate,'closed');}}
        else {if(gate.state==='closed')this._gateState(gate,'clearing');if(gate.state==='warning')this._gateState(gate,'opening');if(gate.state==='closing')this._gateState(gate,'opening');if(gate.state==='clearing'&&gate.timer>=2)this._gateState(gate,'opening');if(gate.state==='opening'&&gate.timer>=2)this._gateState(gate,'open');}
        const target=['closed','clearing','closing'].includes(gate.state)?1:0;gate.progress=clamp(gate.progress+(target?1:-1)*dt/2,0,1);
        // The train signal also requires the arm to have physically finished lowering.
        for(const barrier of this.barriers.filter(b=>b.gateId===gate.id))barrier.active=barrier.visible=gate.progress>.98;
      }}
    _move(train,dt){const route=train.route;let limit=route.length;
      for(const crossing of route.crossings){const gate=this.gates.find(g=>g.id===crossing.id);if(train.front<crossing.start&&!(gate.state==='closed'&&gate.progress>.999&&!gate.occupied))limit=Math.min(limit,crossing.start-24);}
      let max=160;
      // Yard speed and the facing turnout apply before the nose reaches them.
      for(const segment of route.segments){const cap=segment.id==='station-crossover'?40:segment.id.startsWith('main-')?160:85;if(train.front<=segment.end+train.length&&train.front+train.speed*train.speed/72+80>=segment.start)max=Math.min(max,cap);}
      const remaining=Math.max(0,limit-train.front),target=Math.min(max,Math.sqrt(2*36*remaining));train.speed=target<train.speed?Math.max(target,train.speed-36*dt):Math.min(target,train.speed+20*dt);
      const old=train.front;train.front=Math.min(limit,train.front+train.speed*dt);if(train.front<old)train.front=old;
      for(const segment of route.segments)if(train.front>=segment.start&&!train.usedTracks.has(segment.id)){train.usedTracks.add(segment.id);this.event('track-enter',{service:train.id,leg:train.leg,track:segment.id});}
      for(const block of route.blocks)if(train.front-train.length>block.end+60&&this.reservations.get(block.id)===train.id)this.reservations.delete(block.id);
      this._pose(train,dt);
      if(route.length-train.front<.01&&train.speed<2){train.speed=0;if(train.leg==='inbound'){train.state='dwell';train.until=this.time+train.dwell;this.event('arrive',{service:train.id,destination:train.destination,track:train.track});}
        else {train.state='idle';train.completed++;for(const [id,owner]of this.reservations)if(owner===train.id)this.reservations.delete(id);for(const car of train.cars)car.visible=car.active=false;train.next+=train.interval;while(train.next<=this.time){this.event('slot-skipped',{service:train.id,scheduled:train.next});train.next+=train.interval;}train.waitSince=null;this.event('complete',{service:train.id,destination:'Northport (off map)'});}}
    }
    _pose(train,dt){const reverse=train.leg==='outbound',order=reverse?train.cars.slice().reverse():train.cars;let offset=0;
      for(const car of order){const center=train.front-offset-car.railModel.length/2,a=sample(train.route,center-car.railModel.length*.32),b=sample(train.route,center+car.railModel.length*.32),p=sample(train.route,center),field=this.game.world.terrain;
        const minY=Number.isFinite(field.minY)?field.minY:0,portalY=Number.isFinite(this.layout.portalY)?this.layout.portalY:0;
        const ground=q=>field.heightAt(q.x,Math.max(minY,q.y)),ha=ground(a),hb=ground(b),x=car.x,y=car.y,h=car.elevation;car.x=p.x;car.y=p.y;car.angle=Math.atan2(b.y-a.y,b.x-a.x)+(reverse?Math.PI:0);car.pitch=Math.atan2(hb-ha,car.railModel.length*.64/20)*(reverse?-1:1);car.elevation=(ha+hb)/2+.19;car.speed=train.speed;car.visible=car.active=p.y>portalY-car.railModel.length/2;car.vx=car.visible&&car._posed?(car.x-x)/dt:0;car.vy=car.visible&&car._posed?(car.y-y)/dt:0;car.verticalVelocity=car.visible&&car._posed?(car.elevation-h)/dt:0;car._posed=true;offset+=car.railModel.length+12;
      }
    }
    roadSpeedLimit(car,heading,desired){let limit=desired;for(const gate of this.gates){if(gate.state==='open'||gate.state==='opening')continue;for(const stop of gate.stopLines){const angle=stop.angle+(stop.end===1?Math.PI:0),c=Math.cos(angle),s=Math.sin(angle),dx=stop.x-car.x,dy=stop.y-car.y,ahead=dx*c+dy*s,across=Math.abs(-dx*s+dy*c),direction=Math.cos(heading)*c+Math.sin(heading)*s;
        if(across>gate.width/2+28||direction<.1||ahead<60)continue;
        const gap=ahead-84;if(gap<500){const allowed=gap<.001?0:Math.sqrt(2*100*gap);if(allowed<limit){limit=allowed;car.blockedBy=gate.id;}}
      }}return limit;}
    pedestrianBlocked(person,dx,dy){return this.gates.some(g=>g.state!=='open'&&g.state!=='opening'&&!inCrossing(g,person,28)&&inCrossing(g,{x:person.x+dx*8,y:person.y+dy*8},32));}
  }
  const api={TrainSystem,SCHEDULE,MODELS,buildRoutes,sample,project,inCrossing};root.MayhemTrains=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
