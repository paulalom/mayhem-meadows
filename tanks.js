/* Northwatch's road-bound armoured response. Map units are 20 per metre. */
(function(root){
  'use strict';
  const World=root.MayhemWorld||(typeof require==='function'?require('./world.js'):null);
  const Stats=root.MayhemVehicleStats||(typeof require==='function'?require('./vehicle-stats.js'):null);
  const Aircraft=root.MayhemAircraft||(typeof require==='function'?require('./aircraft.js'):null);
  const Physics=root.MayhemPhysics||(typeof require==='function'?require('./physics.js'):null);
  const SCALE=20,GRAVITY=18,SHELL_SPEED=1800,MAX_SHELLS=12;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),finite=(v,d=0)=>Number.isFinite(v)?v:d;
  const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const APPROVED_ROADS=Object.freeze(['base-compound-road','base-entry-road','base-gate-road','base-access-north','base-access-ridge','base-access-south','pine-road','ridge-summit',
    'apple-road','orchard-east-road','orchard-pond-road','orchard-south-road','orchard-west-road','orchard-green-road','airport-terminal-road']);
  const TANK={length:104,width:48,height:2.6,maxHealth:600};

  function segmentBox(a,b,box,bottom,height,padding=0){
    const angle=finite(box.angle),c=Math.cos(angle),s=Math.sin(angle),cx=box.x+box.w/2,cy=box.y+box.h/2;
    const local=p=>[(p.x-cx)*c+(p.y-cy)*s,-(p.x-cx)*s+(p.y-cy)*c,finite(p.elevation)];
    const p=local(a),q=local(b);let low=0,high=1;
    for(const [axis,min,max]of [[0,-box.w/2-padding,box.w/2+padding],[1,-box.h/2-padding,box.h/2+padding],[2,bottom,bottom+height]]){
      const delta=q[axis]-p[axis];if(Math.abs(delta)<1e-9){if(p[axis]<min||p[axis]>max)return null;}
      else{let near=(min-p[axis])/delta,far=(max-p[axis])/delta;if(near>far)[near,far]=[far,near];low=Math.max(low,near);high=Math.min(high,far);if(low>high)return null;}
    }return low;
  }
  function segmentSolid(a,b,box){
    const m=box.basis,local=p=>{const dx=p.x/SCALE-box.x,dy=p.elevation-box.y,dz=p.y/SCALE-box.z;return [dx*m[0]+dy*m[3]+dz*m[6],dx*m[1]+dy*m[4]+dz*m[7],dx*m[2]+dy*m[5]+dz*m[8]];};
    const p=local(a),q=local(b);let low=0,high=1;
    for(let axis=0;axis<3;axis++){const half=[box.hx,box.hy,box.hz][axis],delta=q[axis]-p[axis];if(Math.abs(delta)<1e-9){if(Math.abs(p[axis])>half)return null;}else{let near=(-half-p[axis])/delta,far=(half-p[axis])/delta;if(near>far)[near,far]=[far,near];low=Math.max(low,near);high=Math.min(high,far);if(low>high)return null;}}
    return low;
  }

  class TankSystem{
    constructor(game){
      this.game=game;this.time=0;this.tanks=[];this.shells=[];this.events=[];this._nextId=1;this.fourStarTime=0;this.baseAlarmTime=0;this.warning=0;this.cooldown=0;this._routeTimer=0;
      this.base=game.world?.militaryBase||game.world?.landscape?.militaryBase;
      this.status={phase:'standby',warning:0,reason:null,seen:false};this._configureRoads();game.tankShells=this.shells;game.militaryTankSeen=false;
    }
    _ground(p){return finite(this.game._ground?.(p),finite(this.game.world?.terrain?.surfaceHeight?.(p.x,p.y)));}
    _event(type,data={}){this.events.push({type,time:this.time,...data});if(this.events.length>512)this.events.splice(0,128);}
    _setStatus(phase,reason=this.status.reason){this.status.phase=phase;this.status.reason=reason;this.status.warning=this.warning;this.status.seen=Boolean(this.game.militaryTankSeen);}
    _configureRoads(){
      const world=this.game.world||{},roads=(world.roads||[]).filter(r=>APPROVED_ROADS.includes(r.id)&&r.width>=100&&this._roadUsable(r));
      this.roads=roads;this.roadIds=new Set(roads.map(r=>r.id));
      const nodes=world.roadNetwork?.nodes||world.nodes||[];
      this.network=roads.length&&World?.RoadNetwork?new World.RoadNetwork(roads,nodes):null;
      this.components=new Map();
      for(const road of roads){if(this.components.has(road.id))continue;const ids=new Set([road.a,road.b]);let changed=true;while(changed){changed=false;for(const r of roads)if(ids.has(r.a)||ids.has(r.b)){if(!ids.has(r.a)||!ids.has(r.b))changed=true;ids.add(r.a);ids.add(r.b);}}
        const component=roads.filter(r=>ids.has(r.a)),network=new World.RoadNetwork(component,nodes);for(const r of component)this.components.set(r.id,network);}
    }
    _roadUsable(road){
      for(let i=0;i<road.points.length;i++){
        const p=road.points[i],a=road.points[Math.max(0,i-1)],b=road.points[Math.min(road.points.length-1,i+1)];
        const angle=Math.atan2(b.y-a.y,b.x-a.x);
        if(!this._footprintClear({...p,angle},true))return false;
        if(i>1&&Math.abs(wrap(angle-Math.atan2(a.y-road.points[i-2].y,a.x-road.points[i-2].x)))>1.25)return false;
      }return true;
    }
    _footprintClear(p,staticOnly=false,ignore=null){
      const c=Math.cos(finite(p.angle)),s=Math.sin(finite(p.angle)),center=this._ground(p),terrain=this.game.world?.terrain;
      // Sample the full chassis, including both track edges and front/rear.
      for(const along of [-52,0,52])for(const side of [-24,0,24]){
        const q={x:p.x+c*along-s*side,y:p.y+s*along+c*side},height=this._ground(q);
        if(terrain?.isWater?.(q.x,q.y)||Math.abs(height-center)*SCALE/Math.max(24,Math.hypot(along,side))>.29)return false;
      }
      const box={x:p.x-52,y:p.y-24,w:104,h:48,angle:finite(p.angle)};
      for(const field of [this.base,this.game.world?.landscape?.airport].filter(Boolean))for(const paved of (field.runways||[]).concat(field.taxiways||[],field.aprons||[]))if(World.boxesOverlap(box,paved,3))return false;
      for(const building of this.game.buildings||[])if(!building.destroyed&&distance(p,{x:building.x+building.w/2,y:building.y+building.h/2})<Math.hypot(building.w,building.h)/2+62&&World.boxesOverlap(box,building,3))return false;
      for(const object of this.game.staticObjects||[]){if(object.destroyed||object.id===ignore?.id)continue;
        if(distance(p,object)>this._propRadius(object)+62)continue;
        for(const part of object.parts||[]){
          const half=part.half||[.3,1,.3],offset=part.offset||[0,half[1],0],a=finite(object.angle),cc=Math.cos(a),ss=Math.sin(a);
          const x=object.x+(offset[0]*cc-offset[2]*ss)*SCALE,y=object.y+(offset[0]*ss+offset[2]*cc)*SCALE;
          if(World.boxesOverlap(box,{x:x-half[0]*SCALE,y:y-half[2]*SCALE,w:half[0]*40,h:half[2]*40,angle:a},2))return false;
        }
      }
      if(!staticOnly)for(const entity of this._vehicles()){
        if(entity===ignore||entity.visible===false||entity.id===ignore?.id)continue;
        const m=this._model(entity);if(Math.abs(finite(entity.elevation)-center)>m.height+2)continue;
        if(World.boxesOverlap(box,{x:entity.x-m.length/2,y:entity.y-m.width/2,w:m.length,h:m.width,angle:finite(entity.angle)},14))return false;
      }return true;
    }
    _propRadius(object){return Math.max(1,...(object.parts||[]).map(part=>{const half=part.half||[.3,1,.3],offset=part.offset||[0,half[1],0];return Math.hypot(Math.abs(offset[0])+half[0],Math.abs(offset[2])+half[2])*SCALE;}));}
    _vehicles(){return [...new Set((this.game.cars||[]).concat(this.game.police||[],this.game.aircraft||[],this.game.railTraffic?.colliders||[]))];}
    _model(entity){if(Aircraft?.isAircraft(entity))return Aircraft.getModel(entity);if(entity.railModel)return entity.railModel;if(entity.tank)return TANK;const model=Stats.getModel(entity);return {...model,height:model.height||(entity.kind==='van'?1.7:1.3)};}
    _groundTarget(){const p=this.game.current||this.game.player;return this.game.player?.vehicleId&&p&&p.kind!=='aircraft'&&!p.railModel&&p.health>0&&!p.exploded&&finite(p.elevation)-this._ground(p)<3?p:null;}
    reportBaseAttack(incident={}){
      if(!this.base||incident.playerCaused===false)return false;
      this.baseAlarmTime=90;this._incident={...incident,position:{...(incident.position||this.game.current||this.base.gate)}};
      const before=finite(this.game.heat);this.game.heat=Math.max(4,before);this.game._reportedLocation={...this._incident.position};
      this.game.escapeTimer=0;this.game._policeSearching=false;
      for(const cop of this.game.police||[]){cop.lastSeen={...this.game._reportedLocation};cop.routeTimer=0;}
      if(before<4){this.game._toast?.('Northwatch base alarm! Military armour authorised.','warning');this.game._sound?.('heat',{level:4,reason:'Northwatch base attacked'});}
      for(const tank of this.tanks)if(tank.tankAI&&tank.health>0&&!tank.exploded){tank.tankPhase='approach';tank.approachPoint={...this._incident.position};tank.reachedSearchPoint=false;tank.routeTimer=0;tank.searchTime=0;}
      this._event('base-alarm',{position:this._incident.position});
      return true;
    }
    clearHeat(){this.fourStarTime=0;this.baseAlarmTime=0;this.warning=0;this._incident=null;this.game.militaryTankSeen=false;for(const tank of this.tanks)if(tank.tankAI){tank.tankPhase='return';tank.routeTimer=0;tank.aimTime=0;}this._setStatus('return',null);}
    step(dt,input={}){
      if(!Number.isFinite(dt)||dt<=0)return;let remaining=Math.min(dt,.25);
      while(remaining>1e-8){const step=Math.min(remaining,1/60);this._tick(step,input);remaining-=step;}
    }
    _tick(dt,input){
      this.time+=dt;this.cooldown=Math.max(0,this.cooldown-dt);this.baseAlarmTime=Math.max(0,this.baseAlarmTime-dt);this.game.militaryTankSeen=false;
      const hot=finite(this.game.heat)>=4;this.fourStarTime=hot?this.fourStarTime+dt:0;
      const active=this.tanks.find(t=>t.tankAI&&t.health>0&&!t.exploded),target=this._groundTarget();
      const eligible=this.base&&(this.baseAlarmTime>0||hot&&this.fourStarTime>=60);
      if(!active){
        if(eligible&&!this.cooldown){
          if(!this.warning){this.warning=8;this._event('warning',{reason:this.baseAlarmTime>0?'base-attack':'four-stars'});this.game._toast?.('Northwatch armour mobilising. Heavy tank on the outskirts in 8 seconds!','warning');}
          else{this.warning=Math.max(0,this.warning-dt);if(!this.warning){const tank=this._dispatch();this.cooldown=tank?90:10;}}
          this._setStatus('mobilising',this.baseAlarmTime>0?'base-attack':'four-stars');
        }else{this.warning=0;this._setStatus(this.cooldown?'unavailable':'standby',null);}
      }else{
        this.warning=0;if(!hot&&!this.baseAlarmTime&&active.tankPhase!=='return'){active.tankPhase='return';active.routeTimer=0;this._event('return',{id:active.id});}
        if(active.id===this.game.player?.vehicleId){active.tankAI=false;active.traffic=false;this._setStatus('borrowed');}
        else this._duty(active,target,dt);
      }
      for(const tank of this.tanks){tank.gunCooldown=Math.max(0,finite(tank.gunCooldown)-dt);if(tank.health<=0||tank.exploded){tank.tankAI=false;tank.traffic=false;}}
      const driven=this.tanks.find(t=>t.id===this.game.player?.vehicleId&&t.health>0&&!t.exploded);
      if(driven){this._aim(driven,null,dt,input);if(input.fire)this._fire(driven,false);}
      this._shells(dt);this.status.seen=Boolean(this.game.militaryTankSeen);
    }
    _dispatch(){
      if(!this.network||this.tanks.some(t=>t.tankAI&&t.health>0&&!t.exploded))return null;
      const available=this.tanks.find(t=>!t.tankAI&&t.tankPhase==='parked'&&t.id!==this.game.player?.vehicleId&&t.health>0&&!t.exploded&&t.engineHealth>0&&distance(t,this.game.current||this.game.player)>600);
      if(available){available.tankAI=true;available.tankPhase='approach';available.routeTimer=0;available.searchTime=0;available.lastSeen=null;available.hasContact=false;available.reachedSearchPoint=false;available.approachPoint={...(this._incident?.position||this.game._reportedLocation||this.game.current||this.game.player||available.home)};this._event('dispatch',{id:available.id,reused:true});return available;}
      if(this.tanks.filter(t=>t.health>0&&!t.exploded).length>=2)return null;
      const target=this._groundTarget(),nearest=target&&this.network.nearestRoad(target);
      let spawn=this.network.pointOnRoad('base-compound-road',2525);
      // The airport's public perimeter has a remote armour checkpoint. Its
      // reserve may respond there without ever driving through Northside.
      if(nearest&&/^(orchard-|apple-|airport-terminal)/.test(nearest.roadId)&&!this.baseAlarmTime){
        spawn=this.roads.filter(r=>/^(orchard-|apple-|airport-terminal)/.test(r.id)).flatMap(r=>[this.network.pointOnRoad(r.id,120),this.network.pointOnRoad(r.id,r.length-120)])
          .filter(p=>distance(p,target)>1000&&distance(p,target)<3200&&this._footprintClear(p)).sort((a,b)=>distance(a,target)-distance(b,target))[0];
      }
      if(!spawn)return null;const point={...spawn,angle:spawn.roadId==='base-compound-road'?0:spawn.angle};
      if(distance(point,this.game.current||this.game.player||point)<600||!this._footprintClear(point))return null;
      // Retire only unoccupied wrecks; never recycle a borrowed chassis.
      for(const old of this.tanks.filter(t=>t.id!==this.game.player?.vehicleId&&(t.health<=0||t.exploded))){const index=this.game.cars.indexOf(old);if(index>=0)this.game.cars.splice(index,1);this.tanks.splice(this.tanks.indexOf(old),1);}
      const tank={id:'military-tank-'+this._nextId++,kind:'tank',modelId:'northwatch-warden',militaryModel:'tank',baseId:'military',tank:true,tankAI:true,traffic:false,militaryUnit:true,
        x:point.x,y:point.y,angle:point.angle,elevation:this._ground(point),vx:0,vy:0,speed:0,verticalVelocity:0,grounded:true,health:600,maxHealth:600,engineHealth:100,handlingHealth:100,color:'#718064',
        tankGun:{turretAngle:point.angle,pitch:0},gunCooldown:2,tankPhase:'approach',home:{x:point.x,y:point.y,angle:point.angle},route:[],routeIndex:0,routeTimer:0,aimTime:0,lastSeen:null,hasContact:false,reachedSearchPoint:false,searchTime:0,
        approachPoint:{...(this._incident?.position||this.game._reportedLocation||this.game.current||this.game.player||point)}};
      this.tanks.push(tank);this.game.cars.push(tank);this._event('dispatch',{id:tank.id});return tank;
    }
    _route(tank,destination){
      const nearest=this.network?.nearestRoad(tank),network=this.components.get(nearest?.roadId)||this.network;
      tank.route=network?.route(tank,destination,0)||[];tank.routeIndex=0;tank.routeTimer=3;tank.destination=destination?{x:destination.x,y:destination.y}:null;
      this._event('route',{id:tank.id,roads:[...new Set(tank.route.map(p=>p.roadId))]});
    }
    _duty(tank,target,dt){
      tank.routeTimer-=dt;const returning=tank.tankPhase==='return',range=target?distance(tank,target):Infinity;
      const seen=!returning&&target&&range<1850&&!this._blocked(tank,target,2.05,.75);
      if(seen){tank.lastSeen={x:target.x,y:target.y};tank.hasContact=true;tank.searchTime=0;this.game.militaryTankSeen=true;tank.tankPhase='pursuit';}
      else if(!returning){tank.tankPhase=tank.hasContact||tank.reachedSearchPoint?'search':'approach';if(tank.hasContact||tank.reachedSearchPoint)tank.searchTime=finite(tank.searchTime)+dt;if(tank.searchTime>35){tank.tankPhase='return';tank.routeTimer=0;}}
      const destination=tank.tankPhase==='return'?tank.home:tank.lastSeen||tank.approachPoint||tank.home;
      if(tank.routeTimer<=0)this._route(tank,destination);
      const projection=this.network?.nearestRoad(tank);
      // Physics may knock a tank off its road; brake there rather than driving
      // a straight recovery line across gardens, tracks or the airfield.
      if(!projection||projection.distance>Math.max(38,projection.width/2-20)){
        this.game.vehiclePhysics?.control(tank,{targetSpeed:0,heading:tank.angle,brake:true});tank.tankPhase='blocked';this._setStatus('blocked');return;
      }
      // Select beyond a close junction before testing forward clearance. A
      // long chassis must begin its pivot before its nose reaches the end of
      // an acute switchback, rather than waiting against the steep verge.
      while(tank.routeIndex<tank.route.length-1&&distance(tank,tank.route[tank.routeIndex])<68)tank.routeIndex++;
      let point=tank.route[tank.routeIndex],heading=point?Math.atan2(point.y-tank.y,point.x-tank.x):tank.angle,speed=95;
      const error=Math.abs(wrap(heading-tank.angle));if(error>.9)speed=0;else if(error>.45)speed=25;else if(error>.2)speed=55;
      const ahead=tank.route.slice(tank.routeIndex,tank.routeIndex+7);for(const next of ahead)if(Math.abs(wrap(finite(next.angle)-heading))>.5)speed=Math.min(speed,35);
      if(!point||tank.routeIndex>=tank.route.length-1&&distance(tank,point)<65){speed=0;if(!returning)tank.reachedSearchPoint=true;}
      const probe={x:tank.x+Math.cos(tank.angle)*Math.max(80,Math.abs(finite(tank.speed))*.8),y:tank.y+Math.sin(tank.angle)*Math.max(80,Math.abs(finite(tank.speed))*.8),angle:tank.angle};
      if(!this._footprintClear(probe,false,tank))speed=0;
      speed=this.game.railTraffic?.roadSpeedLimit?.(tank,heading,speed)??speed;
      this._aim(tank,seen?target:null,dt);
      if(seen&&range>=220&&range<1800&&Math.abs(finite(tank.speed))<45&&tank.aimTime>1.5&&Math.abs(wrap(tank.tankGun.turretAngle-tank.aimAngle))<.035&&Math.abs(tank.tankGun.pitch-tank.aimPitch)<.025){this._fire(tank,true);speed=0;}
      if(seen&&range<1000&&tank.aimTime>0)speed=0;
      this.game.vehiclePhysics?.control(tank,{targetSpeed:speed,heading,brake:speed===0});
      if(tank.tankPhase==='return'&&distance(tank,tank.home)<90&&Math.abs(finite(tank.speed))<10){tank.tankAI=false;tank.tankPhase='parked';this._event('stand-down',{id:tank.id});}
      this._setStatus(tank.tankPhase);
    }
    _blocked(from,to,fromOffset=0,toOffset=0){
      const a={...from,elevation:finite(from.elevation,this._ground(from))+fromOffset},b={...to,elevation:finite(to.elevation,this._ground(to))+toOffset};
      return this._cover(a,b).fraction!==null||Boolean(this.game._blockedLine?.(from,to,a.elevation,b.elevation));
    }
    _aim(tank,target,dt,input={}){
      const gun=tank.tankGun||(tank.tankGun={turretAngle:tank.angle,pitch:0});let yaw=gun.turretAngle,pitch=gun.pitch,worldAim=false;
      if(target){
        let seconds=distance(tank,target)/SHELL_SPEED;const lead={x:target.x+finite(target.vx)*seconds,y:target.y+finite(target.vy)*seconds};
        yaw=Math.atan2(lead.y-tank.y,lead.x-tank.x);const range=Math.max(40,distance(tank,lead)-80),height=finite(target.elevation,this._ground(target))+.75-(finite(tank.elevation)+2.05);
        seconds=range/SHELL_SPEED;pitch=Math.atan2(height+.5*GRAVITY*seconds*seconds,range/SCALE);
        worldAim=true;
        tank.aimTime=finite(tank.aimTime)+dt;
      }else if(tank.id===this.game.player?.vehicleId){
        const direction=this.muzzle(tank).direction;
        yaw=finite(input.aimAngle,direction?Math.atan2(direction.y,direction.x):gun.turretAngle);
        pitch=finite(input.aimPitch,direction?Math.asin(clamp(direction.z,-1,1)):gun.pitch);worldAim=true;tank.aimTime=0;
      }
      else{yaw=tank.angle;tank.aimTime=0;}
      if(worldAim)({yaw,pitch}=this._localAim(tank,yaw,pitch));
      tank.aimAngle=yaw;tank.aimPitch=clamp(pitch,-.14,.35);
      gun.turretAngle=wrap(gun.turretAngle+clamp(wrap(yaw-gun.turretAngle),-.6*dt,.6*dt));
      gun.pitch+=clamp(tank.aimPitch-gun.pitch,-.3*dt,.3*dt);
      tank.turretAngle=gun.turretAngle;tank.gunPitch=gun.pitch;
    }
    _localAim(tank,yaw,pitch){
      if(!tank.orientation)return {yaw,pitch};
      const orientation=tank.orientation,length=Math.hypot(orientation.x,orientation.y,orientation.z,orientation.w);
      if(!Number.isFinite(length)||length<1e-9)return {yaw,pitch};
      const q={x:orientation.x/length,y:orientation.y/length,z:orientation.z/length,w:orientation.w/length};
      const wx=Math.cos(yaw)*Math.cos(pitch),wy=Math.sin(pitch),wz=Math.sin(yaw)*Math.cos(pitch);
      // Both the camera reticle and NPC lead are world rays. Convert through
      // the same inverse chassis rotation before applying local gun limits.
      const tx=2*(-q.y*wz+q.z*wy),ty=2*(-q.z*wx+q.x*wz),tz=2*(-q.x*wy+q.y*wx);
      const lx=wx+q.w*tx+(-q.y*tz+q.z*ty),ly=wy+q.w*ty+(-q.z*tx+q.x*tz),lz=wz+q.w*tz+(-q.x*ty+q.y*tx);
      return {yaw:wrap(Math.atan2(lz,lx)+tank.angle),pitch:Math.atan2(ly,Math.hypot(lx,lz))};
    }
    muzzle(tank){
      if(Physics?.tankBoxes){const barrel=Physics.tankBoxes(tank).find(p=>p.part==='barrel'),m=barrel.basis,direction={x:m[0],y:m[6],z:m[3]};
        return {x:(barrel.x+barrel.hx*m[0])*SCALE,y:(barrel.z+barrel.hx*m[6])*SCALE,elevation:barrel.y+barrel.hx*m[3],direction,
          origin:{x:(barrel.x-barrel.hx*m[0])*SCALE,y:(barrel.z-barrel.hx*m[6])*SCALE,elevation:barrel.y-barrel.hx*m[3]}};}
      const gun=tank.tankGun||{turretAngle:tank.angle,pitch:0},forward=(.9+3.1*Math.cos(gun.pitch))*SCALE;return {x:tank.x+Math.cos(gun.turretAngle)*forward,y:tank.y+Math.sin(gun.turretAngle)*forward,elevation:finite(tank.elevation)+2.05+3.1*Math.sin(gun.pitch)};
    }
    _fire(tank,npc=true){
      if(tank.health<=0||tank.exploded||tank.gunCooldown>0||this.shells.length>=MAX_SHELLS)return false;
      const muzzle=this.muzzle(tank),gun=tank.tankGun,base=muzzle.origin||{x:tank.x,y:tank.y,elevation:finite(tank.elevation)+2.05};
      // A barrel through a wall may never fire through that wall.
      if(this._cover(base,muzzle).fraction!==null)return false;
      const direction=muzzle.direction||{x:Math.cos(gun.turretAngle)*Math.cos(gun.pitch),y:Math.sin(gun.turretAngle)*Math.cos(gun.pitch),z:Math.sin(gun.pitch)};
      const shell={id:'tank-shell-'+this._nextId++,ownerId:tank.id,npc,x:muzzle.x,y:muzzle.y,elevation:muzzle.elevation,vx:direction.x*SHELL_SPEED,vy:direction.y*SHELL_SPEED,vz:direction.z*SHELL_SPEED/SCALE,life:2.6};
      this.shells.push(shell);tank.gunCooldown=4.5;tank.muzzleFlash=.12;tank.lastShotTime=this.time;this._event('fire',{id:tank.id,npc});this.game._sound?.('aircraft-gun',{x:tank.x,y:tank.y,intensity:1});return true;
    }
    _cover(a,b){
      let fraction=null,object=null;const consider=(value,hit)=>{if(value!==null&&(fraction===null||value<fraction)){fraction=value;object=hit;}};
      const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy,near=(p,r)=>{const t=length2?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/length2,0,1):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t)<=r;};
      for(const building of this.game.buildings||[])if(!building.destroyed&&near({x:building.x+building.w/2,y:building.y+building.h/2},Math.hypot(building.w,building.h)/2))consider(segmentBox(a,b,building,finite(building.elevation,this._ground({x:building.x+building.w/2,y:building.y+building.h/2})),finite(building.height,8)),building);
      for(const prop of this.game.staticObjects||[]){if(prop.destroyed||!near(prop,this._propRadius(prop)))continue;const angle=finite(prop.angle),c=Math.cos(angle),s=Math.sin(angle);
        for(const part of prop.parts||[]){const half=part.half||[.3,1,.3],offset=part.offset||[0,half[1],0],x=prop.x+(offset[0]*c-offset[2]*s)*SCALE,y=prop.y+(offset[0]*s+offset[2]*c)*SCALE;
          consider(segmentBox(a,b,{x:x-half[0]*SCALE,y:y-half[2]*SCALE,w:half[0]*40,h:half[2]*40,angle},finite(prop.elevation,this._ground(prop))+offset[1]-half[1],half[1]*2),prop);}
      }
      const count=Math.max(1,Math.ceil(distance(a,b)/12));for(let i=1;i<=count;i++){const t=i/count,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};if(a.elevation+(b.elevation-a.elevation)*t<=this._ground(p)){consider(t,null);break;}}
      return {fraction,object};
    }
    _shells(dt){
      for(const tank of this.tanks)tank.muzzleFlash=Math.max(0,finite(tank.muzzleFlash)-dt);
      for(const shell of this.shells){const time=Math.min(dt,Math.max(0,shell.life)),before={x:shell.x,y:shell.y,elevation:shell.elevation};shell.life-=dt;
        shell.x+=shell.vx*time;shell.y+=shell.vy*time;shell.elevation+=shell.vz*time-.5*GRAVITY*time*time;shell.vz-=GRAVITY*time;
        let {fraction,object}=this._cover(before,shell),victim=null;
        for(const entity of this._vehicles()){
          if(entity.id===shell.ownerId||entity.visible===false||entity.exploded)continue;const m=this._model(entity);
          const hits=entity.kind==='tank'&&Physics?.tankBoxes?Physics.tankBoxes(entity).map(box=>segmentSolid(before,shell,box)).filter(value=>value!==null):[];
          const hit=entity.kind==='tank'&&Physics?.tankBoxes?(hits.length?Math.min(...hits):null):segmentBox(before,shell,{x:entity.x-m.length/2,y:entity.y-m.width/2,w:m.length,h:m.width,angle:finite(entity.angle)},finite(entity.elevation,this._ground(entity)),m.height,1);
          if(hit!==null&&(fraction===null||hit<fraction)){fraction=hit;victim=entity;object=null;}
        }
        if(fraction===null)continue;
        shell.x=before.x+(shell.x-before.x)*fraction;shell.y=before.y+(shell.y-before.y)*fraction;shell.elevation=before.elevation+(shell.elevation-before.elevation)*fraction;shell.life=0;
        this._impact(shell,victim,object);
      }
      for(let i=this.shells.length-1;i>=0;i--)if(this.shells[i].life<=0)this.shells.splice(i,1);
    }
    _impact(shell,victim,object){
      const origin={x:shell.x,y:shell.y,elevation:shell.elevation,height:shell.elevation},playerCaused=!shell.npc;
      if(victim){this.game._damageVehicle?.(victim,75,{playerCaused,source:'tank-shell',origin});const angle=Math.atan2(victim.y-shell.y,victim.x-shell.x);this.game.vehiclePhysics?.impulse?.(victim,{x:Math.cos(angle)*1.8,y:.3,z:Math.sin(angle)*1.8});}
      if(object?.parts)this.game._damageProp?.(object,100,origin,playerCaused);
      if(playerCaused&&object&&(object.militaryModel||object.district==='military'))this.reportBaseAttack({position:origin,playerCaused:true,source:'tank-shell'});
      for(const entity of this._vehicles()){
        if(entity===victim||entity.id===shell.ownerId||entity.exploded||entity.visible===false)continue;
        const center={...entity,elevation:finite(entity.elevation,this._ground(entity))+.7},reach=Math.hypot(distance(shell,entity),(center.elevation-shell.elevation)*SCALE);
        if(reach>=100||this._cover({...origin,x:origin.x+(entity.x-origin.x)*.015,y:origin.y+(entity.y-origin.y)*.015,elevation:origin.elevation+.05},center).fraction!==null)continue;
        this.game._damageVehicle?.(entity,22*(1-reach/100),{playerCaused,source:'tank-shell',origin});
      }
      this.game._confetti?.(shell.x,shell.y,24,shell.elevation);this.game._sound?.('explosion',{x:shell.x,y:shell.y,intensity:.7});this._event('impact',{victim:victim?.id||null,object:object?.id||null,x:shell.x,y:shell.y});
      if(playerCaused)this.game._raiseHeat?.(.5,'Tank shell impact',{position:origin,noise:600});
    }
  }
  const api={TankSystem,APPROVED_ROADS,SHELL_SPEED,MAX_SHELLS,segmentBox};root.MayhemTanks=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
