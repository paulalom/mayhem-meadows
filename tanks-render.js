/* Northwatch's original Blender tank. Simulation and compound collisions use
 * the same exported pivots; these meshes never move the actual vehicle. */
(function(root){
  'use strict';
  const UNIT=20,TAU=Math.PI*2,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function state(scene){
    if(scene._tankRender)return scene._tankRender;
    const T=scene.T,source=root.MayhemTankModels;if(!source)return null;
    const groups=new Map();
    for(const name of ['hull','turret','cannon','wheel','tread']){
      const positions=[],colors=[],indices=[],ranges=[];let offset=0;
      for(const part of source.parts.filter(p=>p.group===name)){
        const color=new T.Color(part.color),count=part.positions.length/3;
        positions.push(...part.positions);for(let i=0;i<count;i++)colors.push(color.r,color.g,color.b);
        indices.push(...part.indices.map(i=>i+offset));ranges.push({start:offset,count,paint:part.paint});offset+=count;
      }
      const geometry=scene._geometry(new T.BufferGeometry());
      geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
      geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
      geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
      groups.set(name,{geometry,ranges,original:Float32Array.from(colors)});
    }
    // _material keys only common flags, so use the explicit shared vertex palette.
    if(!scene._materials.has('tank-vertex-colors'))scene._materials.set('tank-vertex-colors',new T.MeshLambertMaterial({color:'#ffffff',vertexColors:true,flatShading:true}));
    return scene._tankRender={groups,models:new Map(),metadata:source.metadata,material:scene._materials.get('tank-vertex-colors'),dummy:new T.Object3D(),color:new T.Color(),shells:null};
  }
  function createVehicle(scene,entity){
    const s=state(scene);if(!s)return null;
    const T=scene.T,visual=new T.Group(),pivot=new T.Group(),owned=[],animated=new Map();
    const addMesh=(key,parent,instances)=>{
      const source=s.groups.get(key),geometry=scene._geometry(source.geometry.clone());owned.push(geometry);
      const mesh=instances?new T.InstancedMesh(geometry,s.material,instances):new T.Mesh(geometry,s.material);
      mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);animated.set(key,{mesh,geometry,source});
      if(instances){mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.frustumCulled=false;}
      return mesh;
    };
    addMesh('hull',visual);
    const turret=new T.Group();turret.position.fromArray(s.metadata.turretPivot);visual.add(turret);addMesh('turret',turret);
    const cannon=new T.Group();cannon.position.fromArray(s.metadata.gunPivot);turret.add(cannon);addMesh('cannon',cannon);
    const wheelMesh=addMesh('wheel',visual,s.metadata.wheelXs.length*2),treadMesh=addMesh('tread',visual,s.metadata.treadsPerSide*2);
    const flash=scene._mesh(scene._sphere,scene._material('#ffdc88',{unlit:true}),cannon,s.metadata.muzzle[0],0,0,.3,.22,.22,false);flash.visible=false;
    // Cannon rotates this compound vehicle about its hull centre, below the
    // turret. A roof-height pivot would make a rolled tank orbit the collider.
    const centerHeight=s.metadata.hull.height/2;
    visual.position.y=-centerHeight;pivot.add(visual);scene.scene.add(pivot);
    // The existing damage/effect/retirement path remains valid. Its deformable
    // car panels are invisible proxies; armour tint is applied below in place.
    const body=scene._material(entity.color||'#7e9270'),glass=scene._material('#527c91'),trim=scene._material('#a6ad8b');
    const proxy=material=>{const mesh=new T.Mesh(scene._cube,material);mesh.visible=false;visual.add(mesh);return mesh;};
    const shell=proxy(body),hood=proxy(body),windows=proxy(glass),bumpers=[proxy(trim),proxy(trim)],cracks=new T.Group();cracks.visible=false;visual.add(cracks);
    const damageBody=body.clone(),damageGlass=glass.clone(),damageTrim=trim.clone();
    for(const [key,material]of [['vehicle-body-',damageBody],['vehicle-glass-',damageGlass],['vehicle-trim-',damageTrim]])scene._materials.set(key+entity.id,material);
    const originals=[shell,hood,windows,...bumpers].map(mesh=>({mesh,position:mesh.position.clone(),scale:mesh.scale.clone(),rotation:mesh.rotation.clone(),material:mesh.material}));
    const model={group:pivot,visual,centerHeight,length:s.metadata.bounds.length,width:s.metadata.bounds.width,wheels:[],shell,hood,windows,bumpers,cracks,body,paint:null,baseColors:null,damageBody,damageGlass,damageTrim,originals,color:entity.color,red:null,blue:null,police:false,roll:0,damageKey:null,fireAnchor:new T.Vector3(),effects:scene._makeVehicleEffects(entity.id),geometries:owned};
    model.tank={turret,cannon,wheelMesh,treadMesh,animated,flash,lastTime:null,lastAngle:entity.angle||0,travel:[0,0],damageKey:null};
    s.models.set(entity.id,model);return model;
  }
  function treadPosition(metadata,d){
    const a=metadata.trackHalfStraight,r=metadata.trackRadius,c=metadata.trackCenterHeight,length=4*a+TAU*r;
    d=((d%length)+length)%length;
    if(d<2*a)return {x:-a+d,y:c-r,rotation:0};
    if(d<2*a+Math.PI*r){const angle=-Math.PI/2+(d-2*a)/r;return {x:a+r*Math.cos(angle),y:c+r*Math.sin(angle),rotation:angle+Math.PI/2};}
    if(d<4*a+Math.PI*r)return {x:a-(d-2*a-Math.PI*r),y:c+r,rotation:Math.PI};
    const angle=Math.PI/2+(d-4*a-Math.PI*r)/r;return {x:-a+r*Math.cos(angle),y:c+r*Math.sin(angle),rotation:angle+Math.PI/2};
  }
  function damage(scene,model,entity){
    const tank=model.tank,s=scene._tankRender;
    const health=clamp((entity.health??100)/(entity.maxHealth||100),0,1),damage=entity.exploded?1:1-health;
    const scorch=entity.exploded?.94:entity.burning?clamp(.25+(entity.fireTime||0)*.09,.25,.88):0;
    const key=[entity.color,damage,scorch].join(':');if(key===tank.damageKey)return;tank.damageKey=key;
    const paint=s.color.set(entity.color||'#7e9270'),char=new scene.T.Color('#252a2e');
    for(const {geometry,source}of tank.animated.values()){
      const colors=geometry.attributes.color;
      for(const range of source.ranges)for(let i=range.start;i<range.start+range.count;i++){
        const at=i*3,base=range.paint?[paint.r,paint.g,paint.b]:[source.original[at],source.original[at+1],source.original[at+2]];
        colors.setXYZ(i,base[0]*(1-damage*.22)*(1-scorch)+char.r*scorch,base[1]*(1-damage*.22)*(1-scorch)+char.g*scorch,base[2]*(1-damage*.22)*(1-scorch)+char.b*scorch);
      }
      colors.needsUpdate=true;
    }
  }
  function step(scene){
    const s=scene._tankRender;if(!s)return;
    const metadata=s.metadata,now=Number.isFinite(scene.game.time)?scene.game.time:0,dummy=s.dummy;
    for(const [id,model]of s.models){
      if(scene._vehicles?.get(id)!==model){s.models.delete(id);continue;}
      const entity=(scene.game.cars||[]).concat(scene.game.police||[]).find(c=>c.id===id);if(!entity)continue;
      const tank=model.tank,dt=tank.lastTime===null?0:clamp(now-tank.lastTime,0,.25);
      let turn=(entity.angle||0)-tank.lastAngle;while(turn>Math.PI)turn-=TAU;while(turn< -Math.PI)turn+=TAU;
      for(let side=0;side<2;side++)tank.travel[side]+=(entity.speed||0)/UNIT*dt+(side?1:-1)*turn*metadata.trackZ;
      tank.lastTime=now;tank.lastAngle=entity.angle||0;
      const yaw=Number.isFinite(entity.turretAngle)?entity.turretAngle:entity.tankGun?.turretAngle??entity.angle??0;
      const pitch=Number.isFinite(entity.gunPitch)?entity.gunPitch:entity.tankGun?.pitch??0;
      tank.turret.rotation.y=-(yaw-(entity.angle||0));tank.cannon.rotation.z=pitch;
      const fired=entity.lastShotTime??entity.tankGun?.firedAt??-Infinity,age=now-fired;
      const recoil=age>=0&&age<.28?Math.sin((1-age/.28)*Math.PI)*.24:0;
      tank.cannon.position.x=metadata.gunPivot[0]-recoil;
      tank.flash.visible=!entity.exploded&&age>=0&&age<.12;
      tank.flash.scale.set(.33+recoil,.2+recoil*.3,.2+recoil*.3);
      let wi=0,ti=0;
      for(let side=0;side<2;side++){
        const sign=side?1:-1;
        for(const x of metadata.wheelXs){
          dummy.position.set(x,metadata.wheelHeight,sign*metadata.trackZ);dummy.rotation.set(0,side?0:Math.PI,-tank.travel[side]/metadata.wheelRadius*sign);dummy.scale.set(1,1,1);dummy.updateMatrix();tank.wheelMesh.setMatrixAt(wi++,dummy.matrix);
        }
        const length=4*metadata.trackHalfStraight+TAU*metadata.trackRadius;
        for(let i=0;i<metadata.treadsPerSide;i++){
          const p=treadPosition(metadata,i*length/metadata.treadsPerSide-tank.travel[side]);
          dummy.position.set(p.x,p.y,sign*metadata.trackZ);dummy.rotation.set(0,0,p.rotation);dummy.scale.set(1,1,1);dummy.updateMatrix();tank.treadMesh.setMatrixAt(ti++,dummy.matrix);
        }
      }
      tank.wheelMesh.instanceMatrix.needsUpdate=true;tank.treadMesh.instanceMatrix.needsUpdate=true;damage(scene,model,entity);
    }
    shells(scene);
  }
  function shells(scene){
    const s=scene._tankRender;if(!s)return;
    const shots=scene.game.tanks?.shells||scene.game.tankShells||scene.game.militaryTanks?.shells||[];
    if(!s.shells){s.shells=new scene.T.InstancedMesh(scene._sphere,scene._material('#ffe8a8',{unlit:true}),32);s.shells.instanceMatrix.setUsage(scene.T.DynamicDrawUsage);s.shells.frustumCulled=false;scene.scene.add(s.shells);}
    const count=Math.min(shots.length,32);s.shells.count=count;s.shells.visible=count>0;
    for(let i=0;i<count;i++){
      const shot=shots[i],elevation=shot.elevation??shot.height??shot.z??2;
      s.dummy.position.set(shot.x/UNIT,elevation,shot.y/UNIT);
      s.dummy.rotation.set(0,-(shot.angle||Math.atan2(shot.vy||0,shot.vx||1)),0);s.dummy.scale.set(.44,.075,.075);s.dummy.updateMatrix();s.shells.setMatrixAt(i,s.dummy.matrix);
    }
    if(count)s.shells.instanceMatrix.needsUpdate=true;
  }
  root.MayhemTankRender={createVehicle,step,shells,treadPosition};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.MayhemTankRender;
})(globalThis);
