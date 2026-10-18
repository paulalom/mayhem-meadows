/* Original Blender soldiers and Northwatch troop carriers. The simulation owns
 * every position, aim direction and projectile; these rigs only display them. */
(function(root){
  'use strict';
  const UNIT=20,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
  function groupGeometry(scene,parts){
    const positions=[],colors=[],indices=[],ranges=[];let offset=0;
    for(const part of parts){
      const color=new scene.T.Color(part.color),count=part.positions.length/3;
      positions.push(...part.positions);for(let i=0;i<count;i++)colors.push(color.r,color.g,color.b);
      indices.push(...part.indices.map(i=>i+offset));ranges.push({start:offset,count,paint:Boolean(part.paint)});offset+=count;
    }
    const geometry=scene._geometry(new scene.T.BufferGeometry());
    geometry.setAttribute('position',new scene.T.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new scene.T.Float32BufferAttribute(colors,3));geometry.setIndex(indices);
    geometry.computeVertexNormals();geometry.computeBoundingSphere();
    return {geometry,ranges,original:Float32Array.from(colors)};
  }
  function state(scene){
    if(scene._troopRender)return scene._troopRender;
    const assets=root.MayhemTroopModels;if(!assets?.soldier||!assets?.truck)return null;
    const source={};
    for(const [name,asset]of Object.entries(assets)){
      const groups=new Map();for(const group of new Set(asset.parts.map(p=>p.group)))groups.set(group,groupGeometry(scene,asset.parts.filter(p=>p.group===group)));
      source[name]={groups,metadata:asset.metadata};
    }
    if(!scene._materials.has('troop-vertex-colors'))scene._materials.set('troop-vertex-colors',new scene.T.MeshLambertMaterial({color:'#ffffff',vertexColors:true,flatShading:true}));
    return scene._troopRender={source,soldiers:new Map(),trucks:new Map(),material:scene._materials.get('troop-vertex-colors'),dummy:new scene.T.Object3D(),paint:new scene.T.Color(),char:new scene.T.Color('#252a2e'),rounds:null};
  }
  function createSoldier(scene,entity){
    const s=state(scene);if(!s)return null;
    const T=scene.T,asset=s.source.soldier,m=asset.metadata,group=new T.Group(),rig={};group.name='Northwatch soldier '+entity.id;
    for(const name of Object.keys(m.groupPivots)){rig[name]=new T.Group();rig[name].name='Soldier '+name;rig[name].position.fromArray(m.groupPivots[name]);}
    for(const [name,node]of Object.entries(rig)){
      const parent=m.groupParents[name];(parent?rig[parent]:group).add(node);
      const source=asset.groups.get(name);if(source){const mesh=new T.Mesh(source.geometry,s.material);mesh.castShadow=mesh.receiveShadow=true;node.add(mesh);}
    }
    const flash=scene._mesh(scene._sphere,scene._material('#ffdc88',{unlit:true}),rig.weapon,...m.muzzle,.13,.07,.07,false);flash.visible=false;
    const model={group,leftLeg:rig.leftLeg,rightLeg:rig.rightLeg,leftArm:rig.leftArm,rightArm:rig.rightArm,torso:rig.torso,toys:null,equipped:null,phase:0,color:entity.color||'#78866a',player:false,geometries:[],soldier:{rig,flash,lastTime:null,lastX:entity.x,lastY:entity.y,phase:0}};
    s.soldiers.set(entity.id,model);return model;
  }
  function retireSoldier(scene,id,model){
    if(model?.group){model.group.visible=false;scene.scene.remove(model.group);}
    scene._troopRender?.soldiers.delete(id);
  }
  function createVehicle(scene,entity){
    const s=state(scene);if(!s)return null;
    const T=scene.T,asset=s.source.truck,m=asset.metadata,visual=new T.Group(),pivot=new T.Group(),owned=[],animated=new Map();
    const meshFor=(name,parent)=>{
      const source=asset.groups.get(name);if(!source)return null;
      const geometry=scene._geometry(source.geometry.clone());owned.push(geometry);
      const mesh=new T.Mesh(geometry,s.material);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);animated.set(name,{geometry,source,mesh});return mesh;
    };
    meshFor('hull',visual);
    const wheels=[];
    // One mutable wheel buffer per carrier is shared by its six road wheels.
    const wheelSource=asset.groups.get('wheel'),wheelGeometry=scene._geometry(wheelSource.geometry.clone());owned.push(wheelGeometry);
    animated.set('wheel',{geometry:wheelGeometry,source:wheelSource});
    for(const position of m.wheelPositions){
      const wheel=new T.Group();wheel.position.fromArray(position);
      const face=new T.Group();face.rotation.y=position[2]<0?Math.PI:0;wheel.add(face);
      const mesh=new T.Mesh(wheelGeometry,s.material);mesh.castShadow=mesh.receiveShadow=true;face.add(mesh);visual.add(wheel);wheels.push(wheel);
    }
    const centerHeight=finite(m.centerHeight,1.4);visual.position.y=-centerHeight;pivot.add(visual);scene.scene.add(pivot);
    const body=scene._material(entity.color||'#78866a'),glass=scene._material('#527c91'),trim=scene._material('#a6ad8b');
    const proxy=material=>{const mesh=new T.Mesh(scene._cube,material);mesh.visible=false;visual.add(mesh);return mesh;};
    const shell=proxy(body),hood=proxy(body),windows=proxy(glass),bumpers=[proxy(trim),proxy(trim)],cracks=new T.Group();cracks.visible=false;visual.add(cracks);
    const damageBody=body.clone(),damageGlass=glass.clone(),damageTrim=trim.clone();
    for(const [key,material]of [['vehicle-body-',damageBody],['vehicle-glass-',damageGlass],['vehicle-trim-',damageTrim]])scene._materials.set(key+entity.id,material);
    const originals=[shell,hood,windows,...bumpers].map(mesh=>({mesh,position:mesh.position.clone(),scale:mesh.scale.clone(),rotation:mesh.rotation.clone(),material:mesh.material}));
    const bounds=m.bounds||{length:5.8,width:2.4};
    const model={group:pivot,visual,centerHeight,length:bounds.length,width:bounds.width,wheels,shell,hood,windows,bumpers,cracks,body,paint:null,baseColors:null,damageBody,damageGlass,damageTrim,originals,color:entity.color,red:null,blue:null,police:false,roll:0,damageKey:null,fireAnchor:new T.Vector3(),effects:scene._makeVehicleEffects(entity.id),geometries:owned,truck:{animated,damageKey:null,lastTime:null,travel:0}};
    s.trucks.set(entity.id,model);return model;
  }
  function damage(scene,model,entity){
    const truck=model.truck,s=scene._troopRender,health=clamp(finite(entity.health,100)/Math.max(1,finite(entity.maxHealth,100)),0,1),wear=entity.exploded?1:1-health;
    const scorch=entity.exploded?.94:entity.burning?clamp(.25+finite(entity.fireTime)*.09,.25,.88):0,key=[entity.color,wear,scorch].join(':');
    if(key===truck.damageKey)return;truck.damageKey=key;s.paint.set(entity.color||'#78866a');
    for(const {geometry,source}of truck.animated.values()){
      const colors=geometry.attributes.color;
      for(const range of source.ranges)for(let i=range.start;i<range.start+range.count;i++){
        const at=i*3,r=range.paint?s.paint.r:source.original[at],g=range.paint?s.paint.g:source.original[at+1],b=range.paint?s.paint.b:source.original[at+2],shade=(1-wear*.22)*(1-scorch);
        colors.setXYZ(i,r*shade+s.char.r*scorch,g*shade+s.char.g*scorch,b*shade+s.char.b*scorch);
      }
      colors.needsUpdate=true;
    }
  }
  function stepSoldier(scene,entity,model,now){
    const s=model.soldier,rig=s.rig,m=scene._troopRender.source.soldier.metadata,dt=s.lastTime===null?0:clamp(now-s.lastTime,0,.25),body=scene._bodyFor?.(entity),riding=Boolean(entity.transportedBy),stunned=finite(entity.stunned)>0;
    const movement=Math.hypot(finite(entity.x)-finite(s.lastX),finite(entity.y)-finite(s.lastY))/UNIT;
    // Distance drives the gait, so a stopped sentry never walks in place.
    if(dt>0&&!riding&&!stunned)s.phase+=Math.min(movement,1.5)*5;
    const moving=movement>.0005||Math.abs(finite(entity.speed))>.1;
    const stride=!scene.reducedMotion&&!riding&&!stunned&&moving?Math.sin(s.phase)*.36:0;
    model.group.visible=!body&&!entity.removed;
    model.group.position.set(finite(entity.x)/UNIT,finite(entity.elevation),finite(entity.y)/UNIT);model.group.rotation.set(0,-finite(entity.angle),0);
    const aim=finite(entity.aimAngle,finite(entity.angle)),yaw=aim-finite(entity.angle),pitch=clamp(finite(entity.aimPitch),-1.2,1.2);
    model.leftLeg.rotation.set(0,0,riding?Math.PI/2:stride);model.rightLeg.rotation.set(0,0,riding?Math.PI/2:-stride);
    if(rig.leftShin)rig.leftShin.rotation.z=riding?-Math.PI/2:Math.min(0,-stride*.45);
    if(rig.rightShin)rig.rightShin.rotation.z=riding?-Math.PI/2:Math.min(0,stride*.45);
    model.leftArm.rotation.set(0,0,riding?-.2:pitch-stride*.25);model.rightArm.rotation.set(0,0,riding?-.2:pitch+stride*.25);
    rig.torso.rotation.y=riding?0:-Math.atan2(Math.sin(yaw),Math.cos(yaw));
    rig.weapon.rotation.z=riding?-.5:pitch;
    if(riding){
      const truck=(scene.game.cars||[]).find(car=>car.id===entity.transportedBy),q=truck?.orientation;
      if(q&&Number.isFinite(q.x)&&Number.isFinite(q.y)&&Number.isFinite(q.z)&&Number.isFinite(q.w)){
        model.group.quaternion.set(q.x,q.y,q.z,q.w).normalize();model.group.rotateY(-(finite(entity.angle)-finite(truck.angle)));
      }
    }
    const fired=finite(entity.lastShotTime,-Infinity),age=now-fired,recoil=age>=0&&age<.16?Math.sin(age/.16*Math.PI)*.055:0;
    rig.weapon.position.x=m.groupPivots.weapon[0]-recoil;
    s.flash.visible=!body&&!riding&&!stunned&&age>=0&&age<.08;
    s.lastTime=now;s.lastX=entity.x;s.lastY=entity.y;
  }
  function rounds(scene){
    const s=scene._troopRender;if(!s)return;
    if(!s.rounds){s.rounds=new scene.T.InstancedMesh(scene._sphere,scene._material('#ffe59a',{unlit:true}),64);s.rounds.instanceMatrix.setUsage(scene.T.DynamicDrawUsage);s.rounds.frustumCulled=false;scene.scene.add(s.rounds);}
    const shots=scene.game.soldierRounds||[],count=Math.min(shots.length,64);s.rounds.count=count;s.rounds.visible=count>0;
    for(let i=0;i<count;i++){
      const shot=shots[i],yaw=finite(shot.angle,Math.atan2(finite(shot.vy),finite(shot.vx,1))),horizontal=Math.hypot(finite(shot.vx),finite(shot.vy)),vertical=finite(shot.vh,finite(shot.vz)/UNIT)*UNIT,pitch=finite(shot.pitch,Math.atan2(vertical,horizontal||1));
      s.dummy.position.set(finite(shot.x)/UNIT,finite(shot.elevation,finite(shot.height,1)),finite(shot.y)/UNIT);s.dummy.rotation.set(0,-yaw,0);s.dummy.rotateZ(pitch);s.dummy.scale.set(.32,.022,.022);s.dummy.updateMatrix();s.rounds.setMatrixAt(i,s.dummy.matrix);
    }
    if(count)s.rounds.instanceMatrix.needsUpdate=true;
  }
  function step(scene){
    const s=scene._troopRender;if(!s)return;
    const now=finite(scene.game.time),peds=scene.game.peds||[],cars=scene.game.cars||[];
    for(const [id,model]of s.soldiers){const entity=peds.find(p=>p.id===id);if(!entity||scene._residents?.get(id)!==model){s.soldiers.delete(id);continue;}stepSoldier(scene,entity,model,now);}
    for(const [id,model]of s.trucks){
      if(scene._vehicles?.get(id)!==model){s.trucks.delete(id);continue;}
      const entity=cars.find(c=>c.id===id);if(!entity)continue;
      const dt=model.truck.lastTime===null?0:clamp(now-model.truck.lastTime,0,.25);model.truck.lastTime=now;
      model.truck.travel+=finite(entity.speed)/UNIT*dt;
      for(const wheel of model.wheels)wheel.rotation.z=-model.truck.travel/s.source.truck.metadata.wheelRadius;
      damage(scene,model,entity);
    }
    rounds(scene);
  }
  function dispose(scene){scene._troopRender?.rounds?.dispose();}
  root.MayhemTroopRender={createSoldier,retireSoldier,createVehicle,step,rounds,dispose};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.MayhemTroopRender;
})(globalThis);
