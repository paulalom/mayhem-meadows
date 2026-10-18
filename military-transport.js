/* Northwatch troop carriers use the public road graph and real vehicle bodies. */
(function(root){
  'use strict';
  const World=root.MayhemWorld||(typeof require==='function'?require('./world.js'):null);
  const Stats=root.MayhemVehicleStats||(typeof require==='function'?require('./vehicle-stats.js'):null);
  const Aircraft=root.MayhemAircraft||(typeof require==='function'?require('./aircraft.js'):null);
  const finite=(v,d=0)=>Number.isFinite(v)?v:d,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
  const CARRIER=Object.freeze({length:116,width:48,height:2.8,maxHealth:240});
  // Exported Blender bench coordinates, relative to the chassis ground anchor.
  const SEATS=Object.freeze([[-23,-13],[-7,-13],[-23,13],[-7,13]].map(p=>Object.freeze(p)));
  class TransportSystem{
    constructor(game){
      this.game=game;this.trucks=[];this.events=[];this.status={phase:'standby',warning:0,reason:null,seen:false};
      this.time=0;this.warning=0;this.cooldown=0;this.alarmTime=0;this._nextId=1;this.base=game.world?.militaryBase||game.world?.landscape?.militaryBase;
      this._configureRoads();game.militaryTrucks=this.trucks;game.militaryTransportSeen=false;
    }
    _ground(p){return finite(this.game._ground?.(p),finite(this.game.world?.terrain?.surfaceHeight?.(p.x,p.y)));}
    _event(type,data={}){this.events.push({type,time:this.time,...data});if(this.events.length>384)this.events.splice(0,128);}
    _status(phase,reason=this.status.reason){Object.assign(this.status,{phase,reason,warning:this.warning,seen:Boolean(this.game.militaryTransportSeen)});}
    _vehicles(){return [...new Set((this.game.cars||[]).concat(this.game.police||[],this.game.aircraft||[],this.game.railTraffic?.colliders||[]))];}
    _model(entity){return entity.railModel||entity.kind==='aircraft'&&Aircraft?.getModel(entity)||entity.kind==='truck'&&CARRIER||Stats?.getModel(entity)||{length:55,width:32,height:1.8};}
    _configureRoads(){
      const world=this.game.world||{},nodes=world.roadNetwork?.nodes||world.nodes||[];
      this.roads=(world.roads||[]).filter(road=>road.width>=90&&!/runway|taxiway|apron/i.test(road.id)&&this._roadClear(road));
      this.roadIds=new Set(this.roads.map(road=>road.id));this.network=this.roads.length?new World.RoadNetwork(this.roads,nodes):null;
      this.components=new Map();
      for(const road of this.roads){if(this.components.has(road.id))continue;const ids=new Set([road.a,road.b]);let changed=true;
        while(changed){changed=false;for(const r of this.roads)if(ids.has(r.a)||ids.has(r.b)){if(!ids.has(r.a)||!ids.has(r.b))changed=true;ids.add(r.a);ids.add(r.b);}}
        const network=new World.RoadNetwork(this.roads.filter(r=>ids.has(r.a)),nodes);for(const r of network.roads)this.components.set(r.id,network);
      }
    }
    _roadClear(road){
      for(let i=0;i<road.points.length;i+=Math.max(1,Math.floor(road.points.length/35))){
        const point=road.points[i],before=road.points[Math.max(0,i-1)],after=road.points[Math.min(road.points.length-1,i+1)];
        if(!this._clear({...point,angle:Math.atan2(after.y-before.y,after.x-before.x)},true))return false;
      }return true;
    }
    _clear(point,staticOnly=false,ignore=null){
      const c=Math.cos(finite(point.angle)),s=Math.sin(finite(point.angle)),ground=this._ground(point),terrain=this.game.world?.terrain;
      for(const along of [-58,0,58])for(const side of [-24,0,24]){
        const p={x:point.x+c*along-s*side,y:point.y+s*along+c*side};
        if(terrain?.isWater?.(p.x,p.y)||Math.abs(this._ground(p)-ground)*20/Math.max(24,Math.hypot(along,side))>.36)return false;
      }
      const box={x:point.x-58,y:point.y-24,w:116,h:48,angle:finite(point.angle)};
      for(const field of [this.base,this.game.world?.landscape?.airport].filter(Boolean))for(const paved of (field.runways||[]).concat(field.taxiways||[],field.aprons||[]))if(World.boxesOverlap(box,paved,3))return false;
      for(const building of this.game.buildings||[])if(!building.destroyed&&distance(point,{x:building.x+building.w/2,y:building.y+building.h/2})<Math.hypot(building.w,building.h)/2+70&&World.boxesOverlap(box,building,3))return false;
      for(const prop of this.game.staticObjects||[]){if(prop.destroyed||prop===ignore)continue;const angle=finite(prop.angle),cc=Math.cos(angle),ss=Math.sin(angle);
        const radius=Math.max(1,...(prop.parts||[]).map(part=>{const half=part.half||[.3,1,.3],offset=part.offset||[0,half[1],0];return Math.hypot(Math.abs(offset[0])+half[0],Math.abs(offset[2])+half[2])*20;}));
        if(distance(point,prop)>radius+70)continue;
        for(const part of prop.parts||[]){const half=part.half||[.3,1,.3],offset=part.offset||[0,half[1],0],x=prop.x+(offset[0]*cc-offset[2]*ss)*20,y=prop.y+(offset[0]*ss+offset[2]*cc)*20;
          if(World.boxesOverlap(box,{x:x-half[0]*20,y:y-half[2]*20,w:half[0]*40,h:half[2]*40,angle},3))return false;
        }
      }
      if(!staticOnly)for(const vehicle of this._vehicles()){
        if(vehicle===ignore||vehicle.id===ignore?.id||vehicle.visible===false)continue;const model=this._model(vehicle);
        if(Math.abs(finite(vehicle.elevation)-ground)>finite(model.height,2)+2)continue;
        if(World.boxesOverlap(box,{x:vehicle.x-model.length/2,y:vehicle.y-model.width/2,w:model.length,h:model.width,angle:finite(vehicle.angle)},12))return false;
      }return true;
    }
    reportBaseAttack(incident={}){
      if(!this.base||incident.playerCaused===false)return false;this.alarmTime=90;
      this.incident={...(incident.position||this.game._reportedLocation||this.base.gate)};
      this.game.heat=Math.max(4,finite(this.game.heat));
      for(const truck of this.trucks)if(truck.troopAI){truck.incident={...this.incident};truck.lastSeen=null;truck.searchTime=0;truck.truckPhase=truck.deployed?'deployed':'approach';truck.routeTimer=0;}
      this._event('base-alarm',{position:{...this.incident}});return true;
    }
    clearHeat(){
      this.warning=0;this.alarmTime=0;this.incident=null;this.game.militaryTransportSeen=false;
      for(const truck of this.trucks)if(truck.troopAI)this._return(truck);this._status(this.trucks.some(t=>t.troopAI)?'return':'standby',null);
    }
    step(dt){
      if(!Number.isFinite(dt)||dt<=0)return;let remaining=Math.min(dt,.25);
      while(remaining>1e-8){const step=Math.min(remaining,1/60);this._tick(step);remaining-=step;}
    }
    _tick(dt){
      this.time+=dt;this.cooldown=Math.max(0,this.cooldown-dt);this.alarmTime=Math.max(0,this.alarmTime-dt);this.game.militaryTransportSeen=false;
      for(const truck of this.trucks){
        truck.exitTimer=Math.max(0,finite(truck.exitTimer)-dt);this._syncPassengers(truck);
        if(truck.id===this.game.player?.vehicleId){if(truck.troopAI){truck.troopAI=false;truck.truckPhase='borrowed';this._event('commandeered',{id:truck.id});}if(Math.abs(finite(truck.speed))<8)this._unload(truck);}
        else if(truck.health<=0||truck.exploded||truck.burning||truck.engineHealth<=0||truck.upright===false){if(truck.troopAI){truck.troopAI=false;truck.truckPhase='wreck';this._event('disabled',{id:truck.id});}if(Math.abs(finite(truck.speed))<8)this._unload(truck,true);}
      }
      const active=this.trucks.find(truck=>truck.troopAI&&truck.health>0&&!truck.exploded&&!truck.burning),eligible=this.base&&(finite(this.game.heat)>=4||this.alarmTime>0);
      if(active){
        this.warning=0;if(!eligible&&!['return','reboard'].includes(active.truckPhase))this._return(active);
        this._duty(active,dt);
      }else if(eligible&&!this.cooldown){
        if(!this.warning){this.warning=6;this._event('warning',{reason:this.alarmTime>0?'base-attack':'four-stars'});this.game._toast?.('Northwatch soldiers mobilising. Troop carrier departing in 6 seconds!','warning');}
        else{this.warning=Math.max(0,this.warning-dt);if(!this.warning){const truck=this._dispatch();this.cooldown=truck?90:10;}}
        this._status('mobilising',this.alarmTime>0?'base-attack':'four-stars');
      }else{this.warning=0;this._status(this.trucks.some(t=>t.id===this.game.player?.vehicleId)?'borrowed':this.cooldown?'unavailable':'standby',null);}
      this._cleanup();this.status.seen=Boolean(this.game.militaryTransportSeen);
    }
    _crew(truck){return (this.game.soldierTraffic?.soldiers||this.game.peds||[]).filter(s=>s.truckId===truck.id&&s.soldier);}
    syncPassengers(){for(const truck of this.trucks)this._syncPassengers(truck);}
    _syncPassengers(truck){
      for(const soldier of this._crew(truck).filter(s=>s.transportedBy===truck.id)){
        const seat=SEATS[(soldier.seatIndex||0)%4],c=Math.cos(finite(truck.angle)),s=Math.sin(finite(truck.angle));let offset={x:c*seat[0]-s*seat[1],y:.52,z:s*seat[0]+c*seat[1]};
        const q=truck.orientation;
        if(q&&[q.x,q.y,q.z,q.w].every(Number.isFinite)){
          const x=seat[0],y=(.52-1.4)*20,z=seat[1],tx=2*(q.y*z-q.z*y),ty=2*(q.z*x-q.x*z),tz=2*(q.x*y-q.y*x);
          offset={x:x+q.w*tx+q.y*tz-q.z*ty,y:1.4+(y+q.w*ty+q.z*tx-q.x*tz)/20,z:z+q.w*tz+q.x*ty-q.y*tx};
        }
        soldier.x=truck.x+offset.x;soldier.y=truck.y+offset.z;soldier.elevation=finite(truck.elevation)+offset.y;soldier.angle=truck.angle+(seat[1]<0?Math.PI/2:-Math.PI/2);
        soldier.vx=finite(truck.vx);soldier.vy=finite(truck.vy);soldier.grounded=false;
      }
    }
    _dispatch(){
      if(!this.network||this.trucks.some(t=>t.troopAI))return null;
      const player=this.game.current||this.game.player,available=this.trucks.find(t=>t.truckPhase==='parked'&&t.health>0&&!t.exploded&&!t.burning&&t.id!==this.game.player?.vehicleId&&distance(t,player)>700);
      if(available){this._activate(available);this._event('dispatch',{id:available.id,reused:true});return available;}
      if(this.trucks.filter(t=>t.health>0&&!t.exploded).length>=2)return null;
      const road=this.network.roadById.get('base-compound-road');if(!road)return null;
      let point=null;for(const desiredX of [3900,4100,3700,4300]){
        const p=this.network.nearestRoad({x:desiredX,y:-930});if(p?.roadId!=='base-compound-road')continue;
        const candidate={...p,angle:0};if(distance(candidate,player)>700&&this._clear(candidate,false)) {point=candidate;break;}
      }
      if(!point)return null;
      const truck={id:'military-truck-'+this._nextId++,kind:'truck',modelId:'northwatch-carrier',militaryModel:'troop-truck',baseId:'military',militaryUnit:true,
        x:point.x,y:point.y,angle:0,elevation:this._ground(point),vx:0,vy:0,speed:0,verticalVelocity:0,grounded:true,health:240,maxHealth:240,engineHealth:100,handlingHealth:100,color:'#718064',
        home:{x:point.x,y:point.y,angle:0},traffic:false,troopAI:true,truckPhase:'approach',route:[],routeTimer:0,exitTimer:0};
      this.trucks.push(truck);this.game.cars.push(truck);this._activate(truck);this._event('dispatch',{id:truck.id});return truck;
    }
    _activate(truck){
      truck.troopAI=true;truck.traffic=false;truck.truckPhase='approach';truck.incident={...(this.incident||this.game._reportedLocation||this.game.current||this.game.player||this.base.gate)};
      truck.lastSeen=null;truck.searchTime=0;truck.reachedIncident=false;truck.deployed=false;truck.routeTimer=0;truck.exitTimer=0;
      truck.turnManeuver=null;
      if(!this._crew(truck).length)this.game.soldierTraffic?.createSquad?.({id:truck.id+'-squad',truckId:truck.id,position:truck,count:4});
      this._crew(truck).forEach((soldier,index)=>{soldier.seatIndex=index%4;});
      this._syncPassengers(truck);
    }
    _seen(truck,target){
      if(!target||this.game.graceTimer>0||distance(truck,target)>1000||target.kind==='aircraft'&&finite(target.elevation)-this._ground(target)>6)return false;
      const a={x:truck.x,y:truck.y,height:finite(truck.elevation)+1.8},b={x:target.x,y:target.y,height:finite(target.elevation,this._ground(target))+.9};
      if(this.game._blockedLine?.(truck,target,a.height,b.height))return false;
      const hit=this.game.vehiclePhysics?.firstHit?.(a,b,truck.id);if(hit&&hit.body?.entity!==target)return false;
      const count=Math.max(1,Math.ceil(distance(a,b)/12));for(let i=1;i<count;i++){const t=i/count,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};if(a.height+(b.height-a.height)*t<=this._ground(p)+.05)return false;}
      return true;
    }
    _route(truck,destination){
      const nearest=this.network?.nearestRoad(truck),network=this.components.get(nearest?.roadId)||this.network;
      truck.route=network?.route(truck,destination,16)||[];truck.routeTimer=5;truck.destination={x:destination.x,y:destination.y};
      this._event('route',{id:truck.id,roads:[...new Set(truck.route.map(p=>p.roadId))]});
    }
    _return(truck){
      truck.truckPhase=truck.deployed?'reboard':'return';truck.routeTimer=0;truck.searchTime=0;truck.turnManeuver=null;
      for(const soldier of this._crew(truck))if(!soldier.transportedBy){soldier.soldierPhase='return';soldier.lastKnown=null;soldier.returnPoint=this._exitPoints(truck)[0];}
      this._event('return',{id:truck.id});
    }
    _duty(truck,dt){
      truck.routeTimer-=dt;const returning=['return','reboard'].includes(truck.truckPhase),target=this.game.current||this.game.player;
      if(!returning&&this._seen(truck,target)){
        truck.lastSeen={x:target.x,y:target.y,elevation:finite(target.elevation,this._ground(target))};this.game._reportedLocation={...truck.lastSeen};this.game.militaryTransportSeen=true;truck.searchTime=0;
      }
      if(truck.truckPhase==='reboard'){
        this.game.vehiclePhysics?.control(truck,{targetSpeed:0,heading:truck.angle,brake:true});
        const crew=this._crew(truck),outside=crew.filter(s=>!s.transportedBy);
        for(const [index,soldier]of outside.entries()){soldier.soldierPhase='return';soldier.returnPoint=this._exitPoints(truck)[index%8];this.game.soldierTraffic?.embark?.(soldier,truck);}
        if(!crew.some(s=>!s.transportedBy)){truck.truckPhase='return';truck.routeTimer=0;}
        else if(distance(truck,target)>1800&&crew.every(s=>distance(s,target)>1800)&&this.game.soldierTraffic?.retireSquad?.(truck.id)){truck.truckPhase='return';truck.routeTimer=0;}
        this._status(truck.truckPhase);return;
      }
      if(truck.truckPhase==='deployed'){
        this.game.vehiclePhysics?.control(truck,{targetSpeed:0,heading:truck.angle,brake:true});this._unload(truck);
        if(!this.game.militaryTransportSeen)truck.searchTime+=dt;
        if(truck.searchTime>35)this._return(truck);this._status(truck.truckPhase);return;
      }
      const destination=returning?truck.home:truck.lastSeen||truck.incident;
      if(truck.routeTimer<=0||!truck.route.length||distance(destination,truck.destination||destination)>160)this._route(truck,destination);
      const projection=this.network?.nearestRoad(truck);
      if(!projection||projection.distance>Math.max(65,projection.width/2+15)||truck.upright===false){this.game.vehiclePhysics?.control(truck,{targetSpeed:0,heading:truck.angle,brake:true});this._status('blocked');return;}
      const point=this._routeTarget(truck,clamp(140+Math.abs(finite(truck.speed))*.15,140,170));
      let heading=point?Math.atan2(point.y-truck.y,point.x-truck.x):truck.angle,error=Math.abs(wrap(heading-truck.angle));
      // Wheeled carriers keep rolling through turns; only tracked tanks pivot.
      let speed=error>1.05?24:error>.55?42:error>.25?75:145;
      for(const ahead of truck.route.slice(0,8))if(Math.abs(wrap(finite(ahead.angle)-heading))>.65)speed=Math.min(speed,38);
      const endpoint=truck.route.at(-1),nearEnd=endpoint&&distance(truck,endpoint)<80;
      if(!returning&&(distance(truck,destination)<500||nearEnd)&&this._clear(truck,false,truck)){
        speed=0;if(Math.abs(finite(truck.speed))<8){truck.truckPhase='deployed';truck.deployed=true;this._event('deploy',{id:truck.id});this._unload(truck);}
      }else if(returning&&distance(truck,truck.home)<85){speed=0;if(Math.abs(finite(truck.speed))<8){truck.truckPhase='parked';truck.troopAI=false;this._event('stand-down',{id:truck.id});}}
      if(truck.truckPhase==='deployed'||truck.truckPhase==='parked'){
        truck.turnManeuver=null;this.game.vehiclePhysics?.control(truck,{targetSpeed:0,heading:truck.angle,brake:true});this._status(truck.truckPhase);return;
      }
      if(!point)speed=0;
      const forwardClear=this._rollingClear(truck,heading);
      if(truck.turnManeuver){
        const turn=truck.turnManeuver;turn.time+=dt;const turnError=Math.abs(wrap(turn.heading-truck.angle));
        if((turnError<.85&&forwardClear)||turn.time>24){truck.turnManeuver=null;truck.routeTimer=0;}
        else{
          this._maneuverControl(truck,turn);
          this._status(truck.truckPhase);return;
        }
      }
      if(!forwardClear||error>2.2){
        speed=0;
        if(error>.85&&Math.abs(finite(truck.speed))<12){
          const reverseHeading=wrap(truck.angle-wrap(heading-truck.angle));
          if(this._rollingClear(truck,reverseHeading,-1,24)){
            truck.turnManeuver={heading,time:0,direction:-1};this._event('three-point-turn',{id:truck.id});
            this._maneuverControl(truck,truck.turnManeuver);this._status(truck.truckPhase);return;
          }
        }
      }
      speed=this.game._trafficSpeed?.(truck,heading,speed)??speed;
      speed=this.game.railTraffic?.roadSpeedLimit?.(truck,heading,speed)??speed;
      this.game.vehiclePhysics?.control(truck,{targetSpeed:speed,heading,brake:speed===0});this._status(truck.truckPhase);
    }
    _rollingClear(truck,heading,direction=1,distanceLimit=null){
      const steer=clamp(wrap(heading-truck.angle)*2,-1,1),span=distanceLimit||Math.max(65,Math.abs(finite(truck.speed))*.7),radius=Math.abs(steer)>.01?120/steer:Infinity;
      for(let ahead=20;ahead<span+20;ahead+=20){const travel=Math.min(span,ahead);
        const turnedAngle=finite(truck.angle)+(Number.isFinite(radius)?direction*travel/radius:0);
        const point=Number.isFinite(radius)?{x:truck.x+radius*(Math.sin(turnedAngle)-Math.sin(truck.angle)),y:truck.y-radius*(Math.cos(turnedAngle)-Math.cos(truck.angle)),angle:turnedAngle}:
          {x:truck.x+Math.cos(truck.angle)*direction*travel,y:truck.y+Math.sin(truck.angle)*direction*travel,angle:truck.angle};
        const projection=this.network?.nearestRoad(point);if(!projection||projection.distance>Math.min(60,projection.width/2+10))return false;
        if(!this._clear(point,false,truck))return false;
      }return true;
    }
    _maneuverControl(truck,turn){
      // The narrow ridge and a road-side turnaround require several rolling
      // shifts. Switch direction only at a checked road edge, never by pivoting.
      const commandHeading=direction=>direction>0?turn.heading:wrap(truck.angle-wrap(turn.heading-truck.angle));
      let direction=turn.direction||-1,heading=commandHeading(direction),clear=this._rollingClear(truck,heading,direction,24);
      if(!clear){const alternative=-direction,otherHeading=commandHeading(alternative);
        if(this._rollingClear(truck,otherHeading,alternative,24)){direction=alternative;heading=otherHeading;turn.direction=direction;turn.shifting=true;clear=true;this._event('turn-shift',{id:truck.id,direction});}
      }
      if(turn.shifting&&Math.abs(finite(truck.speed))>5){this.game.vehiclePhysics?.control(truck,{targetSpeed:0,heading:truck.angle,brake:true});return;}
      turn.shifting=false;
      const travelHeading=wrap(truck.angle+(direction<0?Math.PI:0));let speed=clear?30:0;
      speed=this.game._trafficSpeed?.(truck,travelHeading,speed)??speed;
      speed=this.game.railTraffic?.roadSpeedLimit?.(truck,travelHeading,speed)??speed;
      this.game.vehiclePhysics?.control(truck,{targetSpeed:speed>0?direction*speed:0,heading,brake:speed===0});
    }
    _routeTarget(truck,lookAhead){
      const route=truck.route;if(!route.length)return null;
      // Project only onto upcoming samples, preserving graph junction order.
      let best=null;for(let i=0;i<Math.min(route.length-1,8);i++){
        const a=route[i],b=route[i+1],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?clamp(((truck.x-a.x)*dx+(truck.y-a.y)*dy)/l,0,1):1,p={x:a.x+dx*t,y:a.y+dy*t},d=distance(truck,p);
        if(!best||d<best.distance)best={index:i,t,point:p,distance:d};
      }
      if(!best)return route[0];if(best.distance>90)return route[0];if(best.index>0)route.splice(0,best.index);
      if(best.t>.98&&route.length>1){route.shift();best.point=route[0];}
      let point=best.point,remaining=lookAhead;for(let i=1;i<route.length;i++){const next=route[i],span=distance(point,next);if(span>=remaining&&span>0)return {x:point.x+(next.x-point.x)*remaining/span,y:point.y+(next.y-point.y)*remaining/span};remaining-=span;point=next;}return route.at(-1);
    }
    _exitPoints(truck){
      const c=Math.cos(finite(truck.angle)),s=Math.sin(finite(truck.angle));
      return [[-36,47],[0,47],[36,47],[-36,-47],[0,-47],[36,-47],[-84,18],[-84,-18]].map(([along,side])=>{
        const point={x:truck.x+c*along-s*side,y:truck.y+s*along+c*side,angle:truck.angle};point.elevation=this._ground(point);return point;
      });
    }
    _unload(truck,emergency=false){
      if(truck.exitTimer>0||Math.abs(finite(truck.speed))>(emergency?12:8))return false;
      const rider=this._crew(truck).find(s=>s.transportedBy===truck.id);if(!rider)return true;
      for(const point of this._exitPoints(truck))if(this.game.soldierTraffic?.disembark?.(rider,point,{emergency})){
        truck.exitTimer=.45;this._event('disembark',{id:truck.id,soldier:rider.id,emergency});return true;
      }
      return false;
    }
    _cleanup(){
      const target=this.game.current||this.game.player;
      for(const truck of this.trucks.slice())if(!truck.troopAI&&truck.id!==this.game.player?.vehicleId&&(truck.health<=0||truck.exploded)&&distance(truck,target)>1800&&this.game.soldierTraffic?.retireSquad?.(truck.id)){
        const index=this.game.cars.indexOf(truck);if(index>=0)this.game.cars.splice(index,1);this.trucks.splice(this.trucks.indexOf(truck),1);this._event('retired',{id:truck.id});
      }
    }
  }
  const api={TransportSystem,CARRIER,SEATS};root.MayhemMilitaryTransport=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
