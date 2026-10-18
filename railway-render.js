/* Railway infrastructure uses the shared alignment and the actual physical ground. */
(function(root) {
  'use strict';
  function render(scene) {
    const railway=scene.game.world?.railway;if(!railway)return;
    const T=scene.T,field=scene.game.world.terrain,unit=20;
    const height=(x,y)=>field.heightAt(x,y);
    const gatedRoad=(x,y)=>railway.crossings.some(c=>c.kind==='gated'&&root.MayhemRailway.inCrossing(c,{x,y},6));
    const box=(color,x,y,z,w,h,d,rotation=null)=>scene._static(scene._cube,scene._material(color),x,y,z,w,h,d,rotation);
    const beam=(a,b,color,width,thickness,lift,offset=0)=>{
      const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),nx=-Math.sin(angle)*offset,ny=Math.cos(angle)*offset;
      const ay=height(a.x+nx,a.y+ny)+lift,by=height(b.x+nx,b.y+ny)+lift;
      box(color,(a.x+b.x+2*nx)/40,(ay+by)/2,(a.y+b.y+2*ny)/40,Math.hypot(length/20,by-ay)+.015,thickness,width,[0,-angle,Math.atan2(by-ay,length/20)]);
    };
    for(const line of railway.tracks) {
      for(let i=1;i<line.points.length;i++) {
        const a=line.points[i-1],b=line.points[i];
        const embedded=gatedRoad((a.x+b.x)/2,(a.y+b.y)/2);
        if(line.role!=='crossover'&&!embedded)beam(a,b,'#9c9987',3.4,.06,.025);
        for(const side of [-1,1])beam(a,b,'#626f72',.085,embedded?.06:.12,embedded?.025:.13,side*railway.gauge/2);
      }
      let next=0;
      for(let i=1;i<line.points.length;i++) {
        const a=line.points[i-1],b=line.points[i],length=Math.hypot(b.x-a.x,b.y-a.y),angle=Math.atan2(b.y-a.y,b.x-a.x);
        while(next<=length) {
          const t=next/length,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
          if(!gatedRoad(x,y))box('#786958',x/20,height(x,y)+.07,y/20,.19,.085,2.1,[0,-angle,0]);next+=15;
        }
        next-=length;
      }
      if(line.role==='passenger'||line.role==='freight') {
        const p=line.points.at(-1),q=line.points.at(-2),yaw=-Math.atan2(p.y-q.y,p.x-q.x),base=height(p.x,p.y);
        box('#ac534b',p.x/20,base+.55,p.y/20,.18,.22,2.2,[0,yaw,0]);
        for(const side of [-1,1])box('#465760',p.x/20,base+.28,(p.y+side*18)/20,.5,.55,.14,[0,yaw,0]);
      }
    }
    for(const platform of railway.platforms) {
      const x=(platform.x+platform.w/2)/20,z=(platform.y+platform.h/2)/20,base=height(x*20,z*20);
      for(const side of [-1,1])box('#f3d676',x,base+platform.height+.012,z+side*(platform.h/40-.1),platform.w/20,.025,.12);
    }
    for(const rect of [railway.forecourt,railway.access])scene._groundRect(rect,'#d1cfb9',.035);
    scene._sign('CENTRAL STATION',343,field.heightAt(6860,5240)+3.15,262.15,0,'#f4e8bd','#345d6b',6.1,.7);
    // Track switches are visible as the physical diagonal rail and its two machines.
    const crossover=railway.tracks.find(t=>t.role==='crossover');
    for(const p of [crossover.points[0],crossover.points.at(-1)]) {
      box('#d7b95f',p.x/20,height(p.x,p.y)+.17,(p.y-28)/20,.6,.28,.3);
      box('#50636d',p.x/20,height(p.x,p.y)+.45,(p.y-28)/20,.08,.5,.08);
    }
    for(const crossing of railway.crossings.filter(c=>c.kind==='gated')) {
      const road=scene.game.roads.find(r=>r.id===crossing.roadId),across=road.width/2+scene.game.world.sidewalkWidth+12;
      for(const stop of crossing.stopLines) {
        const angle=stop.angle,end=stop.end;
        for(const side of [-1,1]) {
          const x=stop.x-Math.sin(angle)*across*side,y=stop.y+Math.cos(angle)*across*side,base=height(x,y);
          box('#d8d5bf',x/20,base+.6,y/20,.16,1.2,.16);
          // Hinged arms and warning lamps are animated by trains-render.js.
          box('#293d49',x/20,base+1.03,y/20,.38,.2,.18);
          for(const sign of [-1,1])box('#f3ebd5',x/20,base+1.85,y/20,.75,.10,.06,[0,-angle,sign*.6]);
        }
        const x=stop.x+Math.cos(angle)*end*24,y=stop.y+Math.sin(angle)*end*24;
        box('#f2e9d3',x/20,height(x,y)+.07,y/20,.13,.02,road.width/20,[0,-angle,0]);
      }
    }
    // The generic building renderer supplies a solid, flat depot roof. Its pad
    // is also in landscape.helipads for aviation landing support.
    const pad=railway.helipad,roof=pad.elevation;
    // Aviation draws registered pads when present. Keep the infrastructure
    // usable independently of the optional aircraft feature.
    if(typeof scene._aviationPad!=='function') {
      const disk=scene._geometry(new T.CircleGeometry(pad.radius/20,48));
      scene._static(disk,scene._material('#546b76'),pad.x/20,roof+.055,pad.y/20,1,1,1,[-Math.PI/2,0,0],false);
      const ring=scene._geometry(new T.TorusGeometry(pad.radius/20*.82,.075,5,48));
      scene._static(ring,scene._material('#f4edc9'),pad.x/20,roof+.08,pad.y/20,1,1,1,[-Math.PI/2,0,0],false);
      for(const side of [-1,1])box('#f4edc9',(pad.x+side*22)/20,roof+.09,pad.y/20,.19,.025,2.5);
      box('#f4edc9',pad.x/20,roof+.09,pad.y/20,2.2,.025,.19);
    }
    for(let i=0;i<8;i++){const a=i*Math.PI/4;box('#f6d18a',pad.x/20+Math.cos(a)*4.65,roof+.13,pad.y/20+Math.sin(a)*4.65,.12,.12,.12);}
    scene._worldInfo.railway={tracks:railway.tracks.length,crossover:true,platforms:railway.platforms.length,crossings:railway.crossings.length,overpasses:railway.crossings.filter(c=>c.kind==='overpass').length,helipad:{...pad}};
  }
  root.MayhemRailwayRender={render};if(typeof module!=='undefined'&&module.exports)module.exports={render};
})(globalThis);
