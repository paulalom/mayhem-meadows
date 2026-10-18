/* Presentation only: train poses and gate timing come from TrainSystem. */
(function(root){
  'use strict';
  function init(scene){
    const T=scene.T,system=scene.game.railTraffic;
    const state={system,models:new Map(),geometry:new Map(),arms:[]};scene._trains=state;
    for(const [type,source]of Object.entries(root.MayhemTrainModels||{})){
      const template=new T.Group();
      for(const part of source.parts){const geometry=scene._geometry(new T.BufferGeometry());geometry.setAttribute('position',new T.Float32BufferAttribute(part.positions,3));geometry.setIndex(part.indices);geometry.computeVertexNormals();template.add(new T.Mesh(geometry,scene._material(part.color)));}
      const merged=scene._mergeColored(template);state.geometry.set(type,merged.mesh.geometry);
    }
    for(const car of system.cars){const group=new T.Group(),visual=new T.Group();group.add(visual);const mesh=new T.Mesh(state.geometry.get(car.model),scene._materials.get('vertex-colors'));mesh.rotation.y=car.modelFlip;mesh.castShadow=mesh.receiveShadow=true;mesh.updateMatrix();mesh.matrixAutoUpdate=false;visual.add(mesh);scene.scene.add(group);state.models.set(car.id,{group,visual});}
    for(const gate of system.gates){const across=gate.width/2+(scene.game.world.sidewalkWidth||18)+12;
      for(const stop of gate.stopLines)for(const side of [-1,1]){
        const x=stop.x-Math.sin(stop.angle)*across*side,y=stop.y+Math.cos(stop.angle)*across*side;
        const hinge=new T.Group(),arm=new T.Group();hinge.position.set(x/20,scene.game.world.terrain.heightAt(x,y)+1.1,y/20);hinge.rotation.y=-(stop.angle-side*Math.PI/2);hinge.add(arm);scene.scene.add(hinge);
        const length=across/20,stripes=Math.max(6,Math.ceil(length/.35));
        for(let i=0;i<stripes;i++){const mesh=new T.Mesh(scene._cube,scene._material(i%2?'#f3edd8':'#b85f55'));mesh.position.x=(i+.5)*length/stripes;mesh.scale.set(length/stripes,.12,.12);mesh.castShadow=true;arm.add(mesh);}
        // Painted stripes are one rigid arm. One colored draw keeps the exact
        // geometry and hinge animation without traversing every stripe each frame.
        const merged=scene._mergeColored(arm);merged.mesh.receiveShadow=false;
        hinge.updateMatrix();hinge.matrixAutoUpdate=false;
        const light=new T.Mesh(scene._sphere,scene._material('#ff5947',{unlit:true}));light.scale.set(.09,.09,.09);light.position.set(.04,.15,.13);light.updateMatrix();light.matrixAutoUpdate=false;hinge.add(light);state.arms.push({gate,arm,light,phase:side});
      }
    }
    return state;
  }
  function step(scene){const system=scene.game.railTraffic;if(!system)return;const state=scene._trains||init(scene);
    if(state.system!==system){state.system=system;for(const item of state.arms)item.gate=system.gates.find(g=>g.id===item.gate.id)||item.gate;}
    for(const car of system.cars){const model=state.models.get(car.id);if(!model)continue;model.group.visible=car.visible;model.group.position.set(car.x/20,car.elevation,car.y/20);model.group.rotation.set(0,-car.angle,0);model.visual.rotation.set(0,0,car.pitch);}
    for(const item of state.arms){item.arm.rotation.z=(1-item.gate.progress)*Math.PI/2;item.light.visible=item.gate.state!=='open'&&(scene.reducedMotion||Math.sin(system.time*8+item.phase*Math.PI/2)>0);}
    if(scene.canvas?.dataset)scene.canvas.dataset.trainCount=String(system.cars.filter(c=>c.visible).length);
  }
  const api={step};root.MayhemTrainRender=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
