/* Shared railway alignment, earthworks and station infrastructure. Coordinates use world units (20 per metre). */
(function(root) {
  'use strict';
  const UNIT=20, GAUGE=1.435*UNIT, TRACK_SPACING=100, BED_HALF=70, SHOULDER=140, YARD_HEIGHT=2;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>t*t*(3-2*t);
  function curve(vertices) {
    const result=[];
    for(let i=0;i<vertices.length-1;i++) {
      const p0=vertices[Math.max(0,i-1)],p1=vertices[i],p2=vertices[i+1],p3=vertices[Math.min(vertices.length-1,i+2)];
      const count=Math.max(2,Math.ceil(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])/16));
      for(let j=0;j<count;j++) {
        const t=j/count,t2=t*t,t3=t2*t;
        const component=k=>.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3);
        result.push({x:component(0),y:component(1)});
      }
    }
    result.push({x:vertices.at(-1)[0],y:vertices.at(-1)[1]});return result;
  }
  function offset(points,amount) {
    const result=points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],angle=Math.atan2(b.y-a.y,b.x-a.x);
      return {x:p.x-Math.sin(angle)*amount,y:p.y+Math.cos(angle)*amount};});
    if(points[0].y===0) {
      const first=result.findIndex(p=>p.y>=0),a=result[Math.max(0,first-1)],b=result[Math.max(1,first)],t=-a.y/(b.y-a.y);
      return [{x:a.x+(b.x-a.x)*t,y:0},...result.slice(Math.max(1,first))];
    }
    return result;
  }
  function bezier(a,b,c,d,steps=30) {
    return Array.from({length:steps+1},(_,i)=>{const t=i/steps,u=1-t;return {x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};});
  }
  function track(id,points,role) {let length=0;return {id,role,points:points.map((p,i)=>{if(i)length+=Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y);return {...p,s:length,elevation:elevationAt(p.y)};}),length};}
  function elevationAt(y) {
    const profile=[[0,2.8],[1000,3.5],[2000,3.1],[3000,2.5],[4200,2],[6800,2]];
    for(let i=1;i<profile.length;i++)if(y<=profile[i][0]) {const a=profile[i-1],b=profile[i],t=smooth(clamp((y-a[0])/(b[0]-a[0]),0,1));return a[1]+(b[1]-a[1])*t;}
    return YARD_HEIGHT;
  }
  function createRailway() {
    const north=curve([[7030,0],[7580,470],[8160,810],[8360,1100],[8360,1520],[8280,1880],[8125,2265],[8030,2580],[7970,3050],[7950,3550],[7970,4020],[8110,4450],[8200,4700]]);
    const freight=curve([[8200,4700],[8300,4950],[8360,5310],[8515,5765],[8750,6170],[8830,6480]]);
    const approach=north.at(-1),before=north.at(-2),heading=Math.atan2(approach.y-before.y,approach.x-before.x);
    const passenger=bezier(approach,{x:approach.x+Math.cos(heading)*300,y:approach.y+Math.sin(heading)*300},{x:7800,y:5376},{x:7600,y:5376},60)
      .concat(curve([[7600,5376],[7400,5376],[6660,5376]]).slice(1));
    const tracks=[track('main-west',offset(north,-TRACK_SPACING/2),'main'),track('main-east',offset(north,TRACK_SPACING/2),'main'),
      track('platform-1',offset(passenger,TRACK_SPACING/2),'passenger'),track('platform-2',offset(passenger,-TRACK_SPACING/2),'passenger'),
      track('freight-main',offset(freight,-TRACK_SPACING/2),'freight'),
      track('freight-siding',curve([[8380,5330],[8420,5680],[8440,6120],[8440,6460]]),'freight'),
      track('station-crossover',bezier({x:7490,y:5326},{x:7530,y:5326},{x:7550,y:5426},{x:7580,y:5426}),'crossover')];
    for(const [branch,main] of [[2,1],[3,0],[4,0]])Object.assign(tracks[branch].points[0],tracks[main].points.at(-1),{s:0});
    const sidingJoin=tracks[4].points.reduce((best,p)=>Math.hypot(p.x-8380,p.y-5330)<Math.hypot(best.x-8380,best.y-5330)?p:best);
    Object.assign(tracks[5].points[0],sidingJoin,{s:0});
    // Roll through turnouts on a continuous tangent. The design draft's
    // snapped branch endpoints were too sharp for a full train wheelbase.
    for(const [branch,main,cut] of [[5,4,180]]) {
      const line=tracks[branch],start=line.points[0],parent=tracks[main].points;
      const parentIndex=main===4?parent.indexOf(sidingJoin):parent.length-1;
      const before=parent[Math.max(0,parentIndex-1)],heading=Math.atan2(start.y-before.y,start.x-before.x);
      let endIndex=1,distance=0;while(endIndex<line.points.length-2&&distance<cut){distance+=Math.hypot(line.points[endIndex].x-line.points[endIndex-1].x,line.points[endIndex].y-line.points[endIndex-1].y);endIndex++;}
      const end=line.points[endIndex],next=line.points[endIndex+1],out=Math.atan2(next.y-end.y,next.x-end.x),handle=cut*.55;
      line.points=bezier(start,{x:start.x+Math.cos(heading)*handle,y:start.y+Math.sin(heading)*handle},{x:end.x-Math.cos(out)*handle,y:end.y-Math.sin(out)*handle},end).concat(line.points.slice(endIndex+1));
      for(const p of line.points)p.elevation=elevationAt(p.y);
    }
    for(const line of tracks){let length=0;for(let i=0;i<line.points.length;i++){if(i)length+=Math.hypot(line.points[i].x-line.points[i-1].x,line.points[i].y-line.points[i-1].y);line.points[i].s=length;}line.length=length;}
    // Passenger branches run westwards, so the positive offset is the north platform track.
    const pads=[{id:'station-yard',x:6530,y:5160,w:1220,h:360,elevation:YARD_HEIGHT},
      {id:'depot-pad',x:7880,y:5360,w:420,h:340,elevation:YARD_HEIGHT},
      {id:'freight-yard',x:8380,y:6000,w:520,h:520,elevation:YARD_HEIGHT}];
    const buildings=[{id:'central-station',name:'Central Station',district:'works',style:'station',x:6620,y:5150,w:470,h:90,height:4.2,angle:0,color:'#e8cf9f'},
      {id:'rail-depot',name:'Rivermere Rail Depot',district:'works',style:'rail-depot',x:7930,y:5400,w:320,h:260,height:5.5,angle:0,color:'#b4c4bd'}];
    const platforms=[{id:'island-platform',x:6680,y:5352,w:570,h:48,height:.42},
      {id:'north-platform',x:6580,y:5264,w:620,h:36,height:.42}];
    const railway={gauge:GAUGE,trackSpacing:TRACK_SPACING,tracks,pads,buildings,platforms,crossings:[],
      helipad:{id:'depot-helipad',name:'Central Station Depot',buildingId:'rail-depot',x:8090,y:5530,radius:100,rooftop:true},
      access:{x:6530,y:5150,w:90,h:390},forecourt:{x:6570,y:5040,w:550,h:140},
      operation:{doubleEnded:true,turnaround:'reverse',crossoverId:'station-crossover'}};
    // Index earthwork segments once; the full-resolution export and runtime grid share it.
    railway.earthworkCells=new Map();
    for(const line of tracks)if(line.role!=='crossover')for(let i=1;i<line.points.length;i++) {
      const a=line.points[i-1],b=line.points[i];
      for(let row=Math.floor((Math.min(a.y,b.y)-SHOULDER)/256);row<=Math.floor((Math.max(a.y,b.y)+SHOULDER)/256);row++)
        for(let col=Math.floor((Math.min(a.x,b.x)-SHOULDER)/256);col<=Math.floor((Math.max(a.x,b.x)+SHOULDER)/256);col++) {
          const key=col+','+row;if(!railway.earthworkCells.has(key))railway.earthworkCells.set(key,[]);railway.earthworkCells.get(key).push({a,b});
        }
    }
    return railway;
  }
  function closest(x,y,a,b) {const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?clamp(((x-a.x)*dx+(y-a.y)*dy)/l,0,1):0;return {distance:Math.hypot(x-a.x-dx*t,y-a.y-dy*t),t};}
  function earthworks(railway,x,y,original,isWater=false,details=false) {
    if(isWater)return details?{height:original,locked:false}:original;
    let weight=0,target=original;
    for(const pad of railway.pads) {const edge=Math.max(pad.x-x,x-pad.x-pad.w,pad.y-y,y-pad.y-pad.h),w=edge<=0?1:1-smooth(clamp(edge/90,0,1));if(w>weight){weight=w;target=pad.elevation;}}
    for(const {a,b} of railway.earthworkCells.get(Math.floor(x/256)+','+Math.floor(y/256))||[]) {
      if(x<Math.min(a.x,b.x)-SHOULDER||x>Math.max(a.x,b.x)+SHOULDER||y<Math.min(a.y,b.y)-SHOULDER||y>Math.max(a.y,b.y)+SHOULDER)continue;
        const hit=closest(x,y,a,b),w=1-smooth(clamp((hit.distance-BED_HALF)/(SHOULDER-BED_HALF),0,1));
        if(w>weight){weight=w;target=a.elevation+(b.elevation-a.elevation)*hit.t;}
    }
    const height=original+(target-original)*weight;
    return details?{height,locked:weight>.999}:height;
  }
  function intersectsBox(railway,box,margin=0) {
    const cx=box.x+box.w/2,cy=box.y+box.h/2,c=Math.cos(box.angle||0),s=Math.sin(box.angle||0),hw=box.w/2+margin+BED_HALF,hh=box.h/2+margin+BED_HALF;
    for(const line of railway.tracks)for(let i=1;i<line.points.length;i++) {
      const local=p=>({x:(p.x-cx)*c+(p.y-cy)*s,y:-(p.x-cx)*s+(p.y-cy)*c}),a=local(line.points[i-1]),b=local(line.points[i]);
      let lo=0,hi=1;
      for(const [v,d,h] of [[a.x,b.x-a.x,hw],[a.y,b.y-a.y,hh]]) {if(Math.abs(d)<1e-8){if(Math.abs(v)>h){hi=-1;break;}}else {let n=(-h-v)/d,f=(h-v)/d;if(n>f)[n,f]=[f,n];lo=Math.max(lo,n);hi=Math.min(hi,f);}}
      if(lo<=hi)return true;
    }
    return false;
  }
  function crossings(railway,roads) {
    const hits=[];
    for(const road of roads)for(let i=1;i<road.points.length;i++)for(const line of railway.tracks.filter(t=>t.role!=='crossover'))for(let j=1;j<line.points.length;j++) {
      const a=road.points[i-1],b=road.points[i],c=line.points[j-1],d=line.points[j],rx=b.x-a.x,ry=b.y-a.y,sx=d.x-c.x,sy=d.y-c.y,den=rx*sy-ry*sx;
      if(Math.abs(den)<1e-8)continue;
      const t=((c.x-a.x)*sy-(c.y-a.y)*sx)/den,u=((c.x-a.x)*ry-(c.y-a.y)*rx)/den;
      if(t<0||t>1||u<0||u>1)continue;
      const x=a.x+rx*t,y=a.y+ry*t;
      const s=(road.arc?.[i-1]||0)+Math.hypot(rx,ry)*t,existing=hits.find(h=>h.roadId===road.id&&Math.abs(h.s-s)<400);
      if(existing) {
        if(s<existing.sMin){existing.sMin=s;existing.first={x,y};}
        if(s>existing.sMax){existing.sMax=s;existing.last={x,y};}
        existing.s=(existing.sMin+existing.sMax)/2;existing.x=(existing.first.x+existing.last.x)/2;existing.y=(existing.first.y+existing.last.y)/2;
        existing.halfLength=(existing.sMax-existing.sMin)/2+90;continue;
      }
      hits.push({id:'rail-crossing-'+hits.length,roadId:road.id,trackId:line.id,x,y,s,sMin:s,sMax:s,first:{x,y},last:{x,y},halfLength:90,angle:Math.atan2(ry,rx),
        kind:/bridge-.*approach/.test(road.id)?'overpass':'gated',width:road.width});
    }
    const roadPoint=(road,s)=>{s=clamp(s,0,road.length);let i=1;while(i<road.points.length-1&&road.arc[i]<s)i++;const a=road.points[i-1],b=road.points[i],length=Math.hypot(b.x-a.x,b.y-a.y),t=(s-road.arc[i-1])/length;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,s,angle:Math.atan2(b.y-a.y,b.x-a.x)};};
    for(const crossing of hits) {
      const road=roads.find(r=>r.id===crossing.roadId),center=roadPoint(road,crossing.s),first=roadPoint(road,crossing.s-crossing.halfLength),last=roadPoint(road,crossing.s+crossing.halfLength);
      Object.assign(crossing,{x:center.x,y:center.y,angle:center.angle});
      crossing.stopLines=[{...first,end:-1},{...last,end:1}];
      crossing.zonePoints=[first,...road.points.filter((p,i)=>road.arc[i]>first.s&&road.arc[i]<last.s),last];
    }
    // A rail curve crosses both arms of the ferry road bend. Protect the whole
    // bend with outer gates; internal arms would intersect and trap road users.
    for(let i=0;i<hits.length;i++)for(let j=i+1;j<hits.length;j++) {
      const a=hits[i],b=hits[j];if(a.kind!=='gated'||b.kind!=='gated'||a.roadIds||b.roadIds)continue;
      const ra=roads.find(r=>r.id===a.roadId),rb=roads.find(r=>r.id===b.roadId),shared=[ra.a,ra.b].find(id=>id===rb.a||id===rb.b);if(!shared)continue;
      const ea=shared===ra.a?-1:1,eb=shared===rb.a?-1:1,innerA=a.stopLines.find(s=>s.end===ea),innerB=b.stopLines.find(s=>s.end===eb);
      if(Math.hypot(innerA.x-innerB.x,innerA.y-innerB.y)>=100)continue;
      const outerA=a.stopLines.find(s=>s.end!==ea),outerB=b.stopLines.find(s=>s.end!==eb),node=ea===1?ra.points.at(-1):ra.points[0];
      a.zonePoints=(ea===1?a.zonePoints:a.zonePoints.slice().reverse()).concat([{x:node.x,y:node.y}],eb===-1?b.zonePoints:b.zonePoints.slice().reverse());
      a.stopLines=[{...outerA,end:-1,angle:outerA.angle+(ea===-1?Math.PI:0)},{...outerB,end:1,angle:outerB.angle+(eb===1?Math.PI:0)}];
      a.roadIds=[a.roadId,b.roadId];a.width=Math.max(a.width,b.width);hits.splice(j--,1);
    }
    for(const crossing of hits)if(crossing.kind==='overpass') {
      const road=roads.find(r=>r.id===crossing.roadId);road.railOverpasses??=[];road.railOverpasses.push(crossing);
      crossing.deckHalfLength=Math.max(145,crossing.halfLength);crossing.clearance=3.6;
    }
    railway.crossings=hits;return hits;
  }
  function inCrossing(crossing,p,extra=0) {
    if(crossing.zonePoints)for(let i=1;i<crossing.zonePoints.length;i++) {
      const a=crossing.zonePoints[i-1],b=crossing.zonePoints[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!length)continue;
      const along=((p.x-a.x)*dx+(p.y-a.y)*dy)/length,across=Math.abs(-(p.x-a.x)*dy+(p.y-a.y)*dx)/length;
      if(along>-(i===1?extra:0)&&along<length+(i===crossing.zonePoints.length-1?extra:0)&&across<crossing.width/2+extra)return true;
    }
    else {const dx=p.x-crossing.x,dy=p.y-crossing.y;return Math.abs(dx*Math.cos(crossing.angle)+dy*Math.sin(crossing.angle))<crossing.halfLength+extra&&Math.abs(-dx*Math.sin(crossing.angle)+dy*Math.cos(crossing.angle))<crossing.width/2+extra;}
    return false;
  }
  // Carry the complete approach on one continuous deck, including its ramps.
  const isOverpassSegment=(road,i)=>Boolean(i>0&&i<road.points.length&&road.railOverpasses?.length);
  const api={createRailway,elevationAt,earthworks,intersectsBox,crossings,inCrossing,isOverpassSegment,GAUGE,UNIT,YARD_HEIGHT};root.MayhemRailway=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
