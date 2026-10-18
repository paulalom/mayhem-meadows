/* Northwatch's Blender buildings and utility truck, plus operational markings.
 * Simulation/collisions remain in world, aircraft and the existing van model.
 */
(function(root){
  'use strict';
  const UNIT=20,PAINT=new Set(['#78866a','#849075','#66755b','#6e7d62']);
  function state(scene){
    if(scene._military)return scene._military;
    const T=scene.T,models=new Map();
    for(const [key,source]of Object.entries(root.MayhemMilitaryModels||{})){
      const parts=source.parts.map(part=>{
        const geometry=scene._geometry(new T.BufferGeometry());
        geometry.setAttribute('position',new T.Float32BufferAttribute(part.positions,3));
        geometry.setIndex(part.indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
        return {geometry,color:part.color,name:part.name};
      });
      models.set(key,{parts,bounds:source.bounds});
    }
    return scene._military={models,rendered:false,buildings:[],trucks:new Map()};
  }
  function render(scene){
    const base=scene.game.world?.militaryBase;if(!base)return;
    const s=state(scene);if(s.rendered)return;s.rendered=true;
    const T=scene.T,terrain=scene.game.world.terrain;
    const box=(color,x,y,z,w,h,d,rotation=null,shadow=true)=>scene._static(scene._cube,scene._material(color),x,y,z,w,h,d,rotation,shadow);
    const line=(a,b,color,width=.1,lift=.055)=>{
      const dx=(b.x-a.x)/UNIT,dz=(b.y-a.y)/UNIT;
      box(color,(a.x+b.x)/40,base.elevation+lift,(a.y+b.y)/40,Math.hypot(dx,dz),.018,width,[0,-Math.atan2(dz,dx),0],false);
    };
    for(const rect of [...base.runways,...base.taxiways,...base.aprons,base.motorPool]){
      box(rect.role==='runway'?'#4c595b':rect.role==='motor-pool'?'#888e7c':'#717c77',(rect.x+rect.w/2)/UNIT,rect.elevation+.025,(rect.y+rect.h/2)/UNIT,rect.w/UNIT,.035,rect.h/UNIT,null,false);
    }
    for(const runway of base.runways){
      const mid=runway.y+runway.h/2;
      for(let x=runway.x+430;x<runway.x+runway.w-430;x+=270)line({x,y:mid},{x:x+120,y:mid},'#e5e5cc',.22,.065);
      for(const side of [-1,1])line({x:runway.x+100,y:mid+side*(runway.h/2-15)},{x:runway.x+runway.w-100,y:mid+side*(runway.h/2-15)},'#d8deca',.12,.065);
      for(const end of [-1,1])for(let k=-3;k<=3;k++){
        const x=end<0?runway.x+140:runway.x+runway.w-140;
        line({x:x-45,y:mid+k*36},{x:x+45,y:mid+k*36},'#edf0d9',.55,.07);
      }
      // Texture signs lie flat on the runway; headings refer to magnetic east/west.
      if(scene._sign){
        const west=scene._sign('09',(runway.x+330)/UNIT,base.elevation+.085,mid/UNIT,0,'#4c595b','#e7ebd4',3,2);
        const east=scene._sign('27',(runway.x+runway.w-330)/UNIT,base.elevation+.085,mid/UNIT,0,'#4c595b','#e7ebd4',3,2);
        if(west?.rotation)west.rotation.set(-Math.PI/2,0,-Math.PI/2);
        if(east?.rotation)east.rotation.set(-Math.PI/2,0,Math.PI/2);
      }
      for(let x=runway.x+70;x<runway.x+runway.w;x+=180)for(const side of [-1,1])box('#dfdcab',x/UNIT,base.elevation+.1,(mid+side*(runway.h/2+10))/UNIT,.08,.08,.08,null,false);
    }
    for(const taxi of base.taxiways){
      if(taxi.w>taxi.h)line({x:taxi.x+30,y:taxi.y+taxi.h/2},{x:taxi.x+taxi.w-30,y:taxi.y+taxi.h/2},'#e2c265',.12);
      else line({x:taxi.x+taxi.w/2,y:taxi.y+30},{x:taxi.x+taxi.w/2,y:taxi.y+taxi.h-30},'#e2c265',.12);
    }
    for(const route of base.taxiRoutes)for(let i=1;i<route.points.length;i++)line(route.points[i-1],route.points[i],'#d8bb60',.1,.06);
    for(const x of [2140,6260])for(const y of [-2700,-2690])line({x:x-85,y},{x:x+85,y},'#e2c265',.12,.07);
    for(const stand of base.stands){
      line({x:stand.x-80,y:stand.y-80},{x:stand.x+80,y:stand.y-80},'#ddd2a3',.12,.065);
      line({x:stand.x,y:stand.y-150},{x:stand.x,y:stand.y+70},'#d8bb60',.12,.065);
    }
    for(const pad of base.helipads)scene._aviationPad?.(pad);
    for(const b of base.buildings){
      const model=s.models.get(b.militaryModel);if(!model)continue;
      const scale=[b.w/UNIT/model.bounds.length,b.height/model.bounds.height,b.h/UNIT/model.bounds.width];
      for(const part of model.parts)scene._static(part.geometry,scene._material(part.color),(b.x+b.w/2)/UNIT,b.elevation,(b.y+b.h/2)/UNIT,...scale,[0,-(b.angle||0),0]);
      s.buildings.push({id:b.id,model:b.militaryModel,scale,elevation:b.elevation});
    }
    // The physical fence comes from world.staticObjects. Mesh rails/posts follow
    // real ground and leave the entire gated road opening unobstructed.
    for(let i=1;i<base.fence.length;i++){
      const a=base.fence[i-1],b=base.fence[i];
      if(a.y===base.gate.y&&b.y===base.gate.y&&Math.min(a.x,b.x)===base.gate.x-base.gate.width/2&&Math.max(a.x,b.x)===base.gate.x+base.gate.width/2)continue;
      const length=Math.hypot(b.x-a.x,b.y-a.y),n=Math.ceil(length/100),angle=Math.atan2(b.y-a.y,b.x-a.x);
      for(let j=0;j<=n;j++){
        const t=j/n,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,ground=terrain.heightAt(x,y);
        box('#586b60',x/UNIT,ground+1.2,y/UNIT,.09,2.4,.09);
        if(j){const u=(j-.5)/n,mx=a.x+(b.x-a.x)*u,my=a.y+(b.y-a.y)*u,g=terrain.heightAt(mx,my);
          for(const h of [.5,1.3,2.1])box('#7c8d7a',mx/UNIT,g+h,my/UNIT,length/n/UNIT,.055,.055,[0,-angle,0]);
          // Sparse vertical wire gives a readable mesh silhouette without a
          // transparent material, expensive shadows, or per-frame rebuilding.
          for(let k=1;k<5;k++){const v=(j-1+k/5)/n,px=a.x+(b.x-a.x)*v,py=a.y+(b.y-a.y)*v;
            box('#849181',px/UNIT,terrain.heightAt(px,py)+1.3,py/UNIT,.023,1.7,.023,null,false);}
        }
      }
    }
    // A permanently raised checkpoint arm permits civilian/player entry.
    for(const side of [-1,1]){const x=(base.gate.x+side*(base.gate.width/2+10))/UNIT,z=base.gate.y/UNIT,g=terrain.heightAt(x*UNIT,z*UNIT);
      box('#d5d0a9',x,g+.65,z,.4,1.3,.4);
      box('#d5c477',x,g+2.05,z,.13,2.5,.13,[0,0,side*.15]);}
    if(scene._sign)scene._sign('NORTHWATCH AIRBASE',base.gate.x/UNIT+6,base.elevation+3.3,base.gate.y/UNIT+1,0,'#e6dfbb','#4a6255',5.8,.65);
    scene._worldInfo.military={buildings:s.buildings.length,runways:base.runways.length,helipads:base.helipads.length,fenceGap:base.gate.width/UNIT,models:s.models.size};
  }
  function decorateVehicle(scene,entity,model){
    if(entity.militaryModel!=='utility-truck'||model.military)return;
    const s=state(scene),source=s.models.get('utility-truck');if(!source)return;
    const T=scene.T,visual=new T.Group(),ranges=[];let start=0;
    // Keep animated wheels, effects and the standard damage API. Replace the
    // visible body only; the actual vehicle remains the established van.
    for(const child of model.visual.children)if(child.isMesh)child.visible=false;
    for(const part of source.parts){
      const mesh=new T.Mesh(part.geometry,scene._material(part.color));visual.add(mesh);
      const count=part.geometry.attributes.position.count;ranges.push({start,count,color:part.color,paint:PAINT.has(part.color)});start+=count;
    }
    const merged=scene._mergeColored(visual),geometry=merged.mesh.geometry;
    model.geometries.push(geometry);model.visual.add(visual);
    const original=Float32Array.from(geometry.attributes.color.array);
    model.military={visual,mesh:merged.mesh,ranges,original,key:null};
    s.trucks.set(entity.id,model);
  }
  function step(scene){
    const s=scene._military;if(!s)return;
    const T=scene.T;
    for(const [id,model]of s.trucks){
      if(scene._vehicles?.get(id)!==model){s.trucks.delete(id);continue;}
      const entity=(scene.game.cars||[]).find(c=>c.id===id);if(!entity)continue;
      const health=Math.max(0,Math.min(1,(entity.health??100)/(entity.maxHealth||100))),damage=entity.exploded?1:1-health;
      const scorch=entity.exploded ? .94 : entity.burning ? Math.min(.88,.25+(entity.fireTime||0)*.09) : 0;
      const key=[entity.color,damage,scorch].join(':');const m=model.military;if(m.key===key)continue;m.key=key;
      const colors=m.mesh.geometry.attributes.color,paint=new T.Color(entity.color||'#73806a'),char=new T.Color('#252a2e');
      for(const range of m.ranges)for(let i=range.start;i<range.start+range.count;i++){
        const at=i*3,r=range.paint?paint.r:m.original[at],g=range.paint?paint.g:m.original[at+1],b=range.paint?paint.b:m.original[at+2],dark=1-damage*.23;
        colors.setXYZ(i,r*dark*(1-scorch)+char.r*scorch,g*dark*(1-scorch)+char.g*scorch,b*dark*(1-scorch)+char.b*scorch);
      }
      colors.needsUpdate=true;m.visual.scale.set(1-damage*.06,1-damage*.12,1-damage*.04);m.visual.rotation.z=damage*.035;
    }
  }
  const api={render,decorateVehicle,step};root.MayhemMilitaryRender=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
