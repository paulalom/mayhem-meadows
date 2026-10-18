/* Northwatch infantry. Coordinates are map units (20 per metre). */
(function(root){
  'use strict';
  const Physics=root.MayhemPhysics||(typeof require==='function'?require('./physics.js'):null);
  const RADIUS=Physics.NPC_RADIUS,PERSON_HEIGHT=Physics.PERSON_HEIGHT,MUZZLE_HEIGHT=1;
  const MAX_SOLDIERS=14,ROUND_SPEED=2400,MAX_ROUNDS=48,RANGE=800,GRID=32;
  const finite=(v,d=0)=>Number.isFinite(v)?v:d,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
  function boxContains(point,box,padding=0){
    const a=finite(box.angle),c=Math.cos(a),s=Math.sin(a),dx=point.x-box.x-box.w/2,dy=point.y-box.y-box.h/2;
    return Math.abs(dx*c+dy*s)<box.w/2+padding&&Math.abs(-dx*s+dy*c)<box.h/2+padding;
  }
  function personHit(a,b,person,radius=RADIUS){
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length?clamp(((person.x-a.x)*dx+(person.y-a.y)*dy)/length,0,1):0;
    if(Math.hypot(a.x+dx*t-person.x,a.y+dy*t-person.y)>radius)return null;
    const h=a.height+(b.height-a.height)*t,base=finite(person.elevation);
    return h>=base+.05&&h<=base+PERSON_HEIGHT?t:null;
  }
  class SoldierSystem{
    constructor(game){
      this.game=game;this.time=0;this.soldiers=[];this.rounds=[];this.events=[];this._nextId=1;this.alarm=0;this._damageCredit=10;
      this.base=game.world?.militaryBase||game.world?.landscape?.militaryBase;
      this.status={phase:'standby',guards:0,deployed:0,seen:false};
      this.movementAreas=[this.base,game.world?.landscape?.airport].filter(Boolean).flatMap(field=>(field.runways||[]).concat(field.taxiways||[],field.aprons||[],field.helipads?.map(p=>({x:p.x-p.radius,y:p.y-p.radius,w:p.radius*2,h:p.radius*2}))||[]));
      for(const person of game.peds||[])if(person.district==='military')this._enlist(person,'guard');
      game.soldiers=this.soldiers;game.soldierRounds=this.rounds;game.militarySoldierSeen=false;
    }
    _enlist(person,role){
      Object.assign(person,{soldier:true,militaryUnit:true,baseId:'military',role,soldierPhase:role==='guard'?'patrol':'riding',transportedBy:null,
        aimAngle:finite(person.angle),aimPitch:0,gunCooldown:.7,lastShotTime:-100,burstLeft:3,aimTime:0,lastKnown:null,searchTime:0,
        nav:[],navTimer:0,homeX:finite(person.homeX,person.x),homeY:finite(person.homeY,person.y),color:'#788264'});
      if(role==='guard'){person.egressAreas=this.movementAreas.filter(area=>boxContains(person,area,RADIUS+12));person.egressArea=person.egressAreas[0]||null;}
      this.soldiers.push(person);return person;
    }
    _ground(point){return finite(this.game._ground?.(point),finite(this.game.world?.terrain?.surfaceHeight?.(point.x,point.y)));}
    _event(type,data={}){this.events.push({type,time:this.time,...data});if(this.events.length>256)this.events.splice(0,64);}
    _target(){
      const target=this.game.current||this.game.player;
      if(!target||target.exploded||target.health<=0)return null;
      if(target.kind==='aircraft'&&(!target.grounded||finite(target.elevation)-this._ground(target)>2.5))return null;
      if(finite(target.elevation)-this._ground(target)>3)return null;
      return target;
    }
    _people(){return (this.game.peds||[]).concat(this.game.player?.vehicleId?[]:[this.game.player]).filter(p=>p&&!p.transportedBy&&!this.game.ragdolls?.get?.(p.id));}
    _pointClear(point,ignore=null,people=false){
      const game=this.game,terrain=game.world?.terrain,height=this._ground(point),bounds=game.world?.bounds;
      if(bounds&&(point.x<bounds.minX+RADIUS||point.x>bounds.maxX-RADIUS||point.y<bounds.minY+RADIUS||point.y>bounds.maxY-RADIUS))return false;
      if(terrain?.isWater?.(point.x,point.y)&&height<finite(terrain.waterLevel)+.25)return false;
      for(const [dx,dy]of [[RADIUS,0],[-RADIUS,0],[0,RADIUS],[0,-RADIUS]])if(Math.abs(this._ground({x:point.x+dx,y:point.y+dy})-height)*20/RADIUS>.6)return false;
      for(const area of this.movementAreas)if(area!==ignore?.egressArea&&!ignore?.egressAreas?.includes(area)&&boxContains(point,area,RADIUS+12))return false;
      if(game._personFree&&!game._personFree(point.x,point.y,RADIUS,ignore))return false;
      if(!game._personFree){
        if((game.buildings||[]).some(b=>!b.destroyed&&boxContains(point,b,RADIUS)))return false;
        for(const object of game.staticObjects||[]){if(object.destroyed)continue;for(const part of object.parts||[]){const half=part.half,offset=part.offset,a=finite(object.angle),c=Math.cos(a),s=Math.sin(a);if(!half||!offset)continue;
          const box={x:object.x+(offset[0]*c-offset[2]*s)*20-half[0]*20,y:object.y+(offset[0]*s+offset[2]*c)*20-half[2]*20,w:half[0]*40,h:half[2]*40,angle:a};
          if(boxContains(point,box,RADIUS))return false;
        }}
      }
      if(people&&this._people().some(p=>p!==ignore&&distance(point,p)<RADIUS*2+2&&Math.abs(finite(p.elevation)-height)<PERSON_HEIGHT))return false;
      return true;
    }
    _segmentClear(a,b,ignore=null){
      const length=distance(a,b),steps=Math.max(1,Math.ceil(length/12));let last=this._ground(a);
      for(let i=1;i<=steps;i++){const t=i/steps,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},height=this._ground(p);
        if(!this._pointClear(p,ignore)||Math.abs(height-last)*20/Math.max(1,length/steps)>.6)return false;last=height;
      }return true;
    }
    _route(soldier,destination){
      soldier.navTimer=1.5;soldier.navDestination={x:destination.x,y:destination.y};
      if(this._segmentClear(soldier,destination,soldier)){soldier.nav=[{x:destination.x,y:destination.y}];return;}
      // Local, bounded A*: infantry go around actual walls and vehicles. They
      // never cut across the runway or pursue a hidden player across town.
      const origin={x:soldier.x,y:soldier.y},extent=22,start={x:0,y:0,g:0,parent:null},key=(x,y)=>x+','+y;
      const world=n=>({x:origin.x+n.x*GRID,y:origin.y+n.y*GRID}),heuristic=n=>distance(world(n),destination);
      start.h=heuristic(start);const open=[start],nodes=new Map([[key(0,0),start]]),closed=new Set();let best=start,visited=0;
      while(open.length&&visited++<900){
        open.sort((a,b)=>a.g+a.h-b.g-b.h);const node=open.shift(),id=key(node.x,node.y);if(closed.has(id))continue;closed.add(id);
        if(node.h<best.h)best=node;
        if(node.h<GRID*1.5&&this._segmentClear(world(node),destination,soldier)){best={...node,endpoint:true};break;}
        for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
          const x=node.x+dx,y=node.y+dy,k=key(x,y);if(Math.abs(x)>extent||Math.abs(y)>extent||closed.has(k))continue;
          const p={x,y},from=world(node),to=world(p);if(!this._segmentClear(from,to,soldier))continue;
          const g=node.g+Math.hypot(dx,dy)*GRID,old=nodes.get(k);if(old&&old.g<=g)continue;
          const next={x,y,g,h:heuristic(p),parent:node};nodes.set(k,next);open.push(next);
        }
      }
      const path=[];if(best.endpoint)path.push({x:destination.x,y:destination.y});
      for(let n=best;n&&n.parent;n=n.parent)path.push(world(n));path.reverse();soldier.nav=path;
      this._event('navigate',{id:soldier.id,nodes:visited,points:path.length});
    }
    _walk(soldier,destination,speed,dt){
      if(!destination||distance(soldier,destination)<5){soldier.moving=false;return;}
      soldier.navTimer-=dt;
      const changed=!soldier.navDestination||distance(soldier.navDestination,destination)>45;
      if(changed){soldier.navRetrying=false;this._route(soldier,destination);}
      else if(!soldier.nav?.length&&soldier.navTimer<=0)this._route(soldier,destination);
      while(soldier.nav?.length&&distance(soldier,soldier.nav[0])<8)soldier.nav.shift();const point=soldier.nav?.[0];
      if(!point){soldier.moving=false;return;}
      const heading=Math.atan2(point.y-soldier.y,point.x-soldier.x),step=Math.min(distance(soldier,point),speed*dt),dx=Math.cos(heading)*step,dy=Math.sin(heading)*step;
      const next={x:soldier.x+dx,y:soldier.y+dy};
      if(this.game.railTraffic?.pedestrianBlocked?.(soldier,dx,dy)){soldier.moving=false;return;}
      if(!this._segmentClear(soldier,next,soldier)){this._invalidateRoute(soldier);return;}
      const before={x:soldier.x,y:soldier.y};soldier.elevation=this._ground(next);
      const collided=this.game._move?.(soldier,dx,dy,RADIUS);
      if(!this.game._move){soldier.x+=dx;soldier.y+=dy;}
      soldier.elevation=this._ground(soldier);soldier.verticalVelocity=0;soldier.grounded=true;soldier.angle=heading;soldier.moving=distance(before,soldier)>.02;
      if(collided&&distance(before,soldier)<step*.3)this._invalidateRoute(soldier);else if(soldier.moving)soldier.navRetrying=false;
    }
    _invalidateRoute(soldier){
      // Replan once when a new physical obstacle appears. If the replacement
      // path is still blocked, wait rather than running A* every frame.
      soldier.nav=[];soldier.navTimer=soldier.navRetrying?1.5:0;soldier.navRetrying=true;soldier.moving=false;
    }
    _patrol(soldier,dt){
      const path=(this.game.pedPaths||[]).find(p=>p.id===soldier.pathId);let destination={x:soldier.homeX,y:soldier.homeY};
      if(path?.points?.length){
        const valid=path.points.map((point,index)=>({point,index})).filter(({point})=>this._pointClear(point,soldier));
        if(!valid.length){soldier.moving=false;return;}
        let index=valid.findIndex(p=>p.index===soldier.pathIndex);
        if(index<0)index=valid.reduce((best,p,i)=>distance(p.point,soldier)<distance(valid[best].point,soldier)?i:best,0);
        destination=valid[index].point;
        if(distance(soldier,destination)<9&&valid.length>1){soldier.pathDirection=finite(soldier.pathDirection,1)||1;let next=index+soldier.pathDirection;
          if(next<0||next>=valid.length){soldier.pathDirection*=-1;next=index+soldier.pathDirection;}
          index=clamp(next,0,valid.length-1);destination=valid[index].point;
        }soldier.pathIndex=valid[index].index;
      }
      this._walk(soldier,destination,finite(soldier.pace,23),dt);
    }
    _egress(soldier,dt){
      const area=soldier.egressArea;if(!area)return false;const areas=soldier.egressAreas?.length?soldier.egressAreas:[area];
      if(!areas.some(candidate=>boxContains(soldier,candidate,RADIUS+13))){soldier.egressArea=null;soldier.egressAreas=[];soldier.nav=[];return false;}
      // Old map personnel may stand on the hangar apron. Preserve their
      // location and let them physically leave at the closest safe edge.
      const points=areas.flatMap(area=>{
        const a=finite(area.angle),c=Math.cos(a),s=Math.sin(a),cx=area.x+area.w/2,cy=area.y+area.h/2,dx=soldier.x-cx,dy=soldier.y-cy;
        const u=dx*c+dy*s,v=-dx*s+dy*c,padding=RADIUS+22;
        return [[-area.w/2-padding,clamp(v,-area.h/2,area.h/2)],[area.w/2+padding,clamp(v,-area.h/2,area.h/2)],
          [clamp(u,-area.w/2,area.w/2),-area.h/2-padding],[clamp(u,-area.w/2,area.w/2),area.h/2+padding]]
          .map(([x,y])=>({x:cx+x*c-y*s,y:cy+x*s+y*c}));
      }).filter(point=>this._pointClear(point)).sort((p,q)=>distance(p,soldier)-distance(q,soldier));
      soldier.soldierPhase='egress';soldier.aimTime=0;if(points.length)this._walk(soldier,points[0],30,dt);return true;
    }
    _muzzle(soldier){const reach=15.6*Math.cos(soldier.aimPitch);return {x:soldier.x+Math.cos(soldier.aimAngle)*reach,y:soldier.y+Math.sin(soldier.aimAngle)*reach,height:finite(soldier.elevation,this._ground(soldier))+MUZZLE_HEIGHT+.78*Math.sin(soldier.aimPitch)};}
    _targetHeight(target){return finite(target.elevation,this._ground(target))+(target===this.game.player?PERSON_HEIGHT*.6:.7);}
    _cover(a,b,ownerId){
      const hit=this.game.vehiclePhysics?.firstHit?.(a,b,null),length=distance(a,b);let fraction=hit?clamp(distance(a,hit)/Math.max(1,length),0,1):null,person=null;
      for(const p of this._people()){if(p.id===ownerId)continue;const t=personHit(a,b,p);if(t!==null&&(fraction===null||t<fraction)){fraction=t;person=p;}}
      return {hit:person?null:hit,person,fraction};
    }
    _visible(soldier,target){
      if(!target||distance(soldier,target)>RANGE||this.game.graceTimer>0)return false;
      const a={x:soldier.x,y:soldier.y,height:finite(soldier.elevation)+MUZZLE_HEIGHT},b={x:target.x,y:target.y,height:this._targetHeight(target)};
      if(this.game._blockedLine?.(soldier,target,a.height,b.height))return false;
      const cover=this._cover(a,b,soldier.id);
      return cover.fraction===null||cover.person===target||cover.hit?.body?.entity===target;
    }
    _aim(soldier,target,dt){
      const a=this._muzzle(soldier),height=this._targetHeight(target),yaw=Math.atan2(target.y-soldier.y,target.x-soldier.x),pitch=clamp(Math.atan2(height-a.height,distance(soldier,target)/20),-.55,.55);
      soldier.aimAngle=wrap(soldier.aimAngle+clamp(wrap(yaw-soldier.aimAngle),-2.3*dt,2.3*dt));
      soldier.aimPitch+=clamp(pitch-soldier.aimPitch,-1.2*dt,1.2*dt);
      const aligned=Math.abs(wrap(yaw-soldier.aimAngle))<.055&&Math.abs(pitch-soldier.aimPitch)<.04;
      soldier.aimTime=aligned?finite(soldier.aimTime)+dt:0;return aligned;
    }
    _fire(soldier,target){
      if(soldier.gunCooldown>0||soldier.aimTime<.45||this.rounds.length>=MAX_ROUNDS||!this._visible(soldier,target))return false;
      const point=this._muzzle(soldier),pitch=soldier.aimPitch;
      this.rounds.push({id:'soldier-round-'+this._nextId++,ownerId:soldier.id,...point,vx:Math.cos(soldier.aimAngle)*Math.cos(pitch)*ROUND_SPEED,vy:Math.sin(soldier.aimAngle)*Math.cos(pitch)*ROUND_SPEED,vh:Math.sin(pitch)*ROUND_SPEED/20,life:.7,damage:2.4});
      soldier.lastShotTime=this.time;soldier.burstLeft=finite(soldier.burstLeft,3)-1;
      if(soldier.burstLeft<=0){soldier.gunCooldown=2.2;soldier.burstLeft=3;}else soldier.gunCooldown=.18;
      this._event('fire',{id:soldier.id});this.game._sound?.('pop',{x:soldier.x,y:soldier.y,volume:.28});return true;
    }
    _rounds(dt){
      for(let i=this.rounds.length-1;i>=0;i--){const round=this.rounds[i],before={x:round.x,y:round.y,height:round.height};
        round.x+=round.vx*dt;round.y+=round.vy*dt;round.height+=round.vh*dt;round.life-=dt;
        const cover=this._cover(before,round,round.ownerId);let terrain=null;
        const steps=Math.max(1,Math.ceil(distance(before,round)/8));for(let n=1;n<=steps;n++){const t=n/steps,p={x:before.x+(round.x-before.x)*t,y:before.y+(round.y-before.y)*t};if(before.height+(round.height-before.height)*t<=this._ground(p)){terrain=t;break;}}
        if(cover.fraction!==null&&(terrain===null||cover.fraction<terrain)){
          const point={x:before.x+(round.x-before.x)*cover.fraction,y:before.y+(round.y-before.y)*cover.fraction};
          const hit=cover.person||cover.hit?.body?.entity;
          if(hit===this.game.player&&!this.game.player.vehicleId&&this.game.heat>=4&&this.game.graceTimer<=0){
            const damage=Math.min(round.damage,this._damageCredit);this._damageCredit=Math.max(0,this._damageCredit-damage);this.game.player.composure=Math.max(0,this.game.player.composure-damage);
            if(damage>0)this.game.player.lastSoldierHitAt=finite(this.game.time,this.time);
            this._event('hit-player',{damage});if(this.game.player.composure<=0)this.game._caught?.();
          }else if(hit&&hit.id===this.game.player?.vehicleId&&this.game.heat>=4&&this.game.graceTimer<=0){
            const damage=Math.min(1.4,this._damageCredit);this._damageCredit-=damage;if(damage>0)this.game._damageVehicle?.(hit,damage,{playerCaused:false,source:'soldier-round',origin:point});
            this._event('hit-vehicle',{id:hit.id,damage});
          }
          this.game._confetti?.(point.x,point.y,2);this.rounds.splice(i,1);
        }else if(terrain!==null||round.life<=0)this.rounds.splice(i,1);
      }
    }
    reportBaseAttack(incident={}){
      if(!this.base||incident.playerCaused===false)return false;
      const p=incident.position||this.base.gate;this.alarm=45;this.game.heat=Math.max(4,finite(this.game.heat));
      for(const soldier of this.soldiers)if(!soldier.transportedBy){soldier.lastKnown={x:p.x,y:p.y};soldier.searchTime=0;soldier.soldierPhase='defend';soldier.nav=[];}
      this._event('base-alarm',{position:{x:p.x,y:p.y}});return true;
    }
    clearHeat(){
      this.alarm=0;this.rounds.length=0;this.game.militarySoldierSeen=false;
      for(const soldier of this.soldiers){soldier.lastKnown=null;soldier.aimTime=0;soldier.searchTime=0;soldier.nav=[];soldier.soldierPhase=soldier.transportedBy?'riding':soldier.role==='guard'?'patrol':'return';}
      this.status.phase='standby';
    }
    createSquad({id,truckId,position,count=4}={}){
      if(!truckId||!position||this.soldiers.some(s=>s.truckId===truckId))return [];
      const squad=[],budget=Math.min(4,Math.max(0,Math.floor(count)),MAX_SOLDIERS-this.soldiers.length);for(let i=0;i<budget;i++){
        const soldier=this._enlist({id:'military-soldier-'+this._nextId++,x:position.x,y:position.y,elevation:this._ground(position),angle:finite(position.angle),homeX:position.x,homeY:position.y,district:'military',stunned:0,bubble:'',bubbleTimer:0,pace:46,verticalVelocity:0,grounded:true},'response');
        Object.assign(soldier,{squadId:id||truckId,truckId,transportedBy:truckId,soldierPhase:'riding'});this.game.peds.push(soldier);squad.push(soldier);
      }this._event('squad',{truckId,count:squad.length});return squad;
    }
    disembark(soldier,point,{emergency=false}={}){
      if(!this.soldiers.includes(soldier)||!soldier.transportedBy||!point||!this._pointClear(point,soldier,true))return false;
      const truck=(this.game.cars||[]).find(car=>car.id===soldier.transportedBy);if(truck&&(Math.abs(finite(truck.speed))>8||Math.abs(finite(truck.verticalVelocity))>1||truck.upright===false&&!emergency||distance(point,truck)>150))return false;
      soldier.x=point.x;soldier.y=point.y;soldier.elevation=this._ground(point);soldier.transportedBy=null;soldier.soldierPhase='search';soldier.deployment={x:point.x,y:point.y};
      soldier.lastKnown=this.game._reportedLocation?{...this.game._reportedLocation}:null;soldier.searchTime=0;soldier.nav=[];soldier.gunCooldown=Math.max(.8,soldier.gunCooldown);this._event('disembark',{id:soldier.id,truckId:soldier.truckId});return true;
    }
    embark(soldier,truck){
      if(!this.soldiers.includes(soldier)||soldier.transportedBy||!truck||truck.id!==soldier.truckId||Math.abs(finite(truck.speed))>8||Math.abs(finite(truck.verticalVelocity))>1||Math.abs(finite(truck.elevation,this._ground(truck))-this._ground(truck))>1||truck.upright===false||distance(soldier,truck)>100||soldier.stunned>0||this.game.ragdolls?.get?.(soldier.id))return false;
      const c=Math.cos(finite(truck.angle)),s=Math.sin(finite(truck.angle));
      const doors=[[-36,47],[0,47],[36,47],[-36,-47],[0,-47],[36,-47],[-84,18],[-84,-18]]
        .map(([along,side])=>({x:truck.x+c*along-s*side,y:truck.y+s*along+c*side}));
      const preferred=soldier.returnPoint&&doors.find(point=>distance(point,soldier.returnPoint)<10),candidates=preferred?[preferred]:doors;
      const door=candidates.find(point=>{
        if(distance(soldier,point)>24||!this._pointClear(point,soldier,true)||!this._segmentClear(soldier,point,soldier))return false;
        const a={x:soldier.x,y:soldier.y,height:this._ground(soldier)+.45},b={x:point.x,y:point.y,height:this._ground(point)+.45};
        return !this.game._blockedLine?.(soldier,point,a.height,b.height)&&!this.game.vehiclePhysics?.firstHit?.(a,b,truck.id);
      });
      if(!door)return false;
      soldier.transportedBy=truck.id;soldier.soldierPhase='riding';soldier.lastKnown=null;soldier.nav=[];this._event('embark',{id:soldier.id,truckId:truck.id});return true;
    }
    retireSquad(truckId){
      const squad=this.soldiers.filter(s=>s.truckId===truckId);if(!squad.length)return true;
      const current=this.game.current||this.game.player;if(squad.some(s=>distance(s,current)<1100))return false;
      for(const soldier of squad){this.game.ragdolls?.clear?.(soldier.id);const p=this.game.peds.indexOf(soldier);if(p>=0)this.game.peds.splice(p,1);this.soldiers.splice(this.soldiers.indexOf(soldier),1);}
      this._event('retire',{truckId});return true;
    }
    step(dt){
      if(!Number.isFinite(dt)||dt<=0)return;let remaining=Math.min(dt,.25);
      while(remaining>1e-8){const tick=Math.min(remaining,1/60);this._tick(tick);remaining-=tick;}
    }
    _tick(dt){
      this.time+=dt;this.alarm=Math.max(0,this.alarm-dt);this._damageCredit=Math.min(10,this._damageCredit+12*dt);this.game.militarySoldierSeen=false;
      for(let i=this.soldiers.length-1;i>=0;i--)if(!this.game.peds.includes(this.soldiers[i]))this.soldiers.splice(i,1);
      const hot=this.game.heat>=4,target=this._target();let active=0;
      for(const soldier of this.soldiers){
        soldier.gunCooldown=Math.max(0,finite(soldier.gunCooldown)-dt);soldier.stunned=Math.max(0,finite(soldier.stunned)-dt);soldier.ragdollGrace=Math.max(0,finite(soldier.ragdollGrace)-dt);soldier.bubbleTimer=Math.max(0,finite(soldier.bubbleTimer)-dt);
        if(soldier.transportedBy){soldier.soldierPhase='riding';soldier.moving=false;continue;}
        if(soldier.stunned>0||this.game.ragdolls?.get?.(soldier.id)){soldier.aimTime=0;soldier.moving=false;continue;}
        if(this._egress(soldier,dt))continue;
        if(!hot){soldier.lastKnown=null;soldier.aimTime=0;soldier.soldierPhase=soldier.role==='guard'?'patrol':'return';}
        const anchor=soldier.deployment||{x:soldier.homeX,y:soldier.homeY};
        const nearDuty=target&&(soldier.role==='guard'?(!this.base||boxContains(target,this.base.bounds,250)):distance(target,anchor)<1100);
        const seen=hot&&nearDuty&&this._visible(soldier,target);
        if(seen){soldier.lastKnown={x:target.x,y:target.y};soldier.searchTime=0;soldier.soldierPhase='engage';this.game.militarySoldierSeen=true;this.game._reportedLocation={...soldier.lastKnown};}
        else if(hot&&soldier.lastKnown){soldier.searchTime+=dt;soldier.soldierPhase='search';if(soldier.searchTime>25){soldier.lastKnown=null;soldier.soldierPhase=soldier.role==='guard'?'patrol':'return';}}
        if(soldier.soldierPhase==='engage'){
          active++;this._aim(soldier,target,dt);const d=distance(soldier,target);
          if(d>430&&soldier.gunCooldown>.35)this._walk(soldier,soldier.lastKnown,42,dt);else soldier.moving=false;
          this._fire(soldier,target);
        }else if(soldier.lastKnown){
          active++;soldier.aimTime=0;if(soldier.role==='guard'?(!this.base||boxContains(soldier.lastKnown,this.base.bounds,250)):distance(soldier.lastKnown,anchor)<1250)this._walk(soldier,soldier.lastKnown,42,dt);else soldier.moving=false;
        }else if(soldier.role==='guard'){soldier.soldierPhase='patrol';soldier.aimTime=0;this._patrol(soldier,dt);soldier.aimAngle=soldier.angle;soldier.aimPitch=0;}
        else{soldier.soldierPhase='return';soldier.aimTime=0;this._walk(soldier,soldier.returnPoint||soldier.commandPoint||anchor,40,dt);}
      }
      this._rounds(dt);this.status={phase:active?'engaged':hot?'searching':'standby',guards:this.soldiers.filter(s=>s.role==='guard').length,deployed:this.soldiers.filter(s=>s.role==='response'&&!s.transportedBy).length,seen:Boolean(this.game.militarySoldierSeen)};
    }
  }
  const api={SoldierSystem,MAX_SOLDIERS,MAX_ROUNDS,ROUND_SPEED,RANGE,MUZZLE_HEIGHT};root.MayhemSoldiers=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
