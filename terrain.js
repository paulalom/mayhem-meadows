/* Shared terrain triangles, road grading, lot pads, and bridge walking surfaces. */
(function(root) {
  'use strict';
  const Data=root.MayhemHeightData||(typeof require==='function'?require('./height-data.js'):null);
  const North=root.MayhemNorthHeightData||(typeof require==='function'?require('./north-height-data.js'):null);
  const Railway=root.MayhemRailway||(typeof require==='function'?require('./railway.js'):null);
  const UNIT=20, COUNT=257, MAX_ROAD_GRADE=.14;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mix=(a,b,t)=>a+(b-a)*t;
  const smooth=t=>t*t*(3-2*t);
  function closest(x,y,a,b) {
    const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
    const t=length2?clamp(((x-a.x)*dx+(y-a.y)*dy)/length2,0,1):0;
    return {t,distance:Math.hypot(x-a.x-dx*t,y-a.y-dy*t)};
  }
  function militaryEarthworks(pads,x,y,height,step=12000/(COUNT-1)) {
    // Full neighboring triangles support rigid aircraft, including wheelsets
    // just beyond the painted runway. Shoulders meet the untouched hills.
    for(const pad of pads||[]) {
      const support=pad.support??step*Math.SQRT2,blend=pad.blend??140;
      const cx=pad.x+pad.w/2,cy=pad.y+pad.h/2,c=Math.cos(pad.angle||0),s=Math.sin(pad.angle||0);
      const edge=Math.max(Math.abs((x-cx)*c+(y-cy)*s)-pad.w/2,Math.abs(-(x-cx)*s+(y-cy)*c)-pad.h/2);
      if(edge>support+blend)continue;
      const weight=edge<=support?1:1-smooth((edge-support)/blend);
      height=mix(height,pad.elevation,weight);
    }
    return height;
  }
  function militarySupport(pads,x,y,step) {
    let level=null;
    for(const pad of pads||[]) {
      const cx=pad.x+pad.w/2,cy=pad.y+pad.h/2,c=Math.cos(pad.angle||0),s=Math.sin(pad.angle||0);
      const edge=Math.max(Math.abs((x-cx)*c+(y-cy)*s)-pad.w/2,Math.abs(-(x-cx)*s+(y-cy)*c)-pad.h/2);
      if(edge<=(pad.support??step*Math.SQRT2))level=pad.elevation;
    }
    return level;
  }
  function createTerrain(world) {
    const size=world.size||12000,mapWidth=world.mapWidth||12000,mapHeight=world.mapHeight||8000;
    const referenceMapWidth=world.referenceMapWidth||12000,referenceMapHeight=world.referenceMapHeight||8000;
    const count=COUNT,step=size/(count-1),minY=world.bounds?.minY??world.mapMinY??0,maxY=world.bounds?.maxY??(minY+mapHeight);
    // Anchor every existing city vertex at the original multiple of step. The
    // north extension adds rows rather than resampling the old city triangles.
    const originX=0,originY=minY<0?Math.floor(minY/step)*step:0;
    const rows=minY<0?Math.ceil((maxY-originY)/step)+1:count,heights=new Float32Array(count*rows);
    const pads=world.militaryBase?.pads||[];
    const waterRaw=(x,y)=>y<0&&North?North.isWaterRaw(x,y):Data.isWaterRaw(x,y,referenceMapWidth,referenceMapHeight);
    const rawHeight=(x,y)=>{
      const original=y<0&&North?North.rawHeight(x,y):Data.rawHeight(x,y,referenceMapWidth,referenceMapHeight);
      const graded=world.railway?Railway.earthworks(world.railway,x,y,original,waterRaw(x,y)):original;
      return militaryEarthworks(pads,x,y,graded,step);
    };
    for(let row=0;row<rows;row++) for(let col=0;col<count;col++) heights[row*count+col]=rawHeight(originX+col*step,originY+row*step);
    function heightAt(x,y) {
      const gx=clamp((x-originX)/step,0,count-1),gy=clamp((y-originY)/step,0,rows-1);
      const col=Math.min(count-2,Math.floor(gx)),row=Math.min(rows-2,Math.floor(gy)),fx=gx-col,fy=gy-row;
      const a=heights[row*count+col],b=heights[row*count+col+1],c=heights[(row+1)*count+col],d=heights[(row+1)*count+col+1];
      // Cannon's Heightfield splits each cell on fx+fy=1, not bilinearly.
      return fx+fy<=1 ? a+(b-a)*fx+(c-a)*fy : d+(c-d)*(1-fx)+(b-d)*(1-fy);
    }
    function normalAt(x,y) {
      const gx=clamp((x-originX)/step,0,count-1),gy=clamp((y-originY)/step,0,rows-1);
      const col=Math.min(count-2,Math.floor(gx)),row=Math.min(rows-2,Math.floor(gy)),fx=gx-col,fy=gy-row;
      const a=heights[row*count+col],b=heights[row*count+col+1],c=heights[(row+1)*count+col],d=heights[(row+1)*count+col+1];
      const dx=(fx+fy<=1?b-a:d-c)/(step/UNIT),dz=(fx+fy<=1?c-a:d-b)/(step/UNIT),length=Math.hypot(dx,1,dz);
      return {x:-dx/length,y:1/length,z:-dz/length};
    }

    // Junctions share profile vertices. Relax the entire graph so hill routes
    // have bounded grades even where independently smoothed streets meet.
    const junctions=new Map(),segments=[],bridgeSegments=[];
    for(const road of world.roads||[]) {
      for(let i=0;i<road.points.length;i++) {
        const point=road.points[i],end=i===0?road.a:i===road.points.length-1?road.b:null;
        let vertex=end?junctions.get(end):null;
        if(!vertex) {
          vertex={height:Math.max(.35,rawHeight(point.x,point.y)),minimum:militarySupport(pads,point.x,point.y,step),points:[]};
          if(end) junctions.set(end,vertex);
        }
        vertex.points.push(point); point._terrainVertex=vertex;
      }
      if(road.bridge) {
        const first=road.points[0]._terrainVertex,last=road.points.at(-1)._terrainVertex;
        first.height=Math.max(first.height,2);last.height=Math.max(last.height,2);
        for(let i=1;i<road.points.length-1;i++) road.points[i]._terrainVertex.height=Math.max(2,mix(first.height,last.height,i/(road.points.length-1)));
      } else {
        const smoothed=road.points.map((point,i)=>{
          if(i===0||i===road.points.length-1)return point._terrainVertex.height;
          let sum=0,weight=0;
          for(let k=Math.max(0,i-8);k<=Math.min(road.points.length-1,i+8);k++) {const w=9-Math.abs(k-i);sum+=road.points[k]._terrainVertex.height*w;weight+=w;}
          return Math.max(sum/weight,point._terrainVertex.minimum??-Infinity);
        });
        for(let i=1;i<road.points.length-1;i++)road.points[i]._terrainVertex.height=smoothed[i];
      }
      for(let i=1;i<road.points.length;i++) {
        const a=road.points[i-1],b=road.points[i],segment={a,b,road,length:Math.hypot(b.x-a.x,b.y-a.y)};
        segments.push(segment);if(road.bridge||Railway.isOverpassSegment(road,i))bridgeSegments.push(segment);
      }
    }
    const vertices=new Set(),heap=[];
    function push(item) {let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p].height<=item.height)break;heap[i]=heap[p];i=p;}heap[i]=item;}
    function pop() {
      const first=heap[0],last=heap.pop();if(!heap.length)return first;
      let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1].height<heap[child].height)child++;
        if(heap[child].height>=last.height)break;heap[i]=heap[child];i=child;}heap[i]=last;return first;
    }
    for(const segment of segments)for(const vertex of [segment.a._terrainVertex,segment.b._terrainVertex])vertices.add(vertex);
    for(const vertex of vertices){vertex.edges=[];push({vertex,height:vertex.height});}
    for(const segment of segments){const a=segment.a._terrainVertex,b=segment.b._terrainVertex,cost=segment.length/UNIT*MAX_ROAD_GRADE;a.edges.push({vertex:b,cost});b.edges.push({vertex:a,cost});}
    // Multi-source shortest paths form the lower grade envelope in one pass.
    // Unlike iterative relaxation, this converges even on long fine-sampled
    // mountain roads and keeps exactly shared junction heights.
    while(heap.length){const item=pop();if(item.height>item.vertex.height+.000001)continue;
      for(const edge of item.vertex.edges){const candidate=Math.max(item.height+edge.cost,edge.vertex.minimum??-Infinity);if(candidate<edge.vertex.height){edge.vertex.height=candidate;push({vertex:edge.vertex,height:candidate});}}}
    // Raise a bounded road approach to clear the railway. Propagate to shared
    // junctions, including the adjoining river deck, so no ramp ends in a step.
    const raised=[...vertices].filter(vertex=>vertex.minimum!==null);
    for(const road of world.roads||[])for(const crossing of world.railway?.crossings.filter(c=>c.roadId===road.id)||[]) {
      const minimum=Railway.elevationAt(crossing.y)+(crossing.kind==='overpass'?crossing.clearance+.4:0);
      for(let i=0;i<road.points.length;i++)if(Math.abs(road.arc[i]-crossing.s)<=(crossing.deckHalfLength||150)+30) {
        const vertex=road.points[i]._terrainVertex;if(vertex.height<minimum){vertex.height=minimum;raised.push(vertex);}
      }
    }
    for(let i=0;i<raised.length;i++)for(const edge of raised[i].edges) {
      const value=raised[i].height-edge.cost;if(value>edge.vertex.height+.00001){edge.vertex.height=value;raised.push(edge.vertex);}
    }
    for(const road of world.roads||[]) for(const point of road.points) {point.elevation=point._terrainVertex.height;delete point._terrainVertex;}
    const gradeHeight=new Float32Array(heights.length),gradeDistance=new Float32Array(heights.length),gradeMax=new Float32Array(heights.length),militaryRoadCells=new Set();
    gradeDistance.fill(Infinity);
    function cells(minX,minY,maxX,maxY,visit) {
      for(let row=Math.max(0,Math.floor((minY-originY)/step));row<=Math.min(rows-1,Math.ceil((maxY-originY)/step));row++)
        for(let col=Math.max(0,Math.floor((minX-originX)/step));col<=Math.min(count-1,Math.ceil((maxX-originX)/step));col++)visit(originX+col*step,originY+row*step,row*count+col);
    }
    for(const segment of segments) {
      const {a,b,road}=segment,inner=road.width/2+(world.sidewalkWidth||32)+step*.6,outer=inner+step*1.3;
      cells(Math.min(a.x,b.x)-outer,Math.min(a.y,b.y)-outer,Math.max(a.x,b.x)+outer,Math.max(a.y,b.y)+outer,(x,y,index)=>{
        const hit=closest(x,y,a,b);if(hit.distance>outer)return;
        // Only bridge approaches touch ground. The river keeps its seabed.
        if(road.bridge&&waterRaw(x,y))return;
        const weight=hit.distance<=inner?1:1-smooth((hit.distance-inner)/(outer-inner));
        if(road.district==='military'&&weight>.98)militaryRoadCells.add(index);
        const normalizedDistance=hit.distance/inner;
        if(normalizedDistance<gradeDistance[index]) {
          gradeDistance[index]=normalizedDistance;gradeHeight[index]=mix(a.elevation,b.elevation,hit.t);gradeMax[index]=weight;
        }
      });
    }
    for(let i=0;i<heights.length;i++) if(gradeMax[i])heights[i]=mix(heights[i],gradeHeight[i],gradeMax[i]);
    // Close hairpins can occupy neighboring grid vertices. Bound the physical
    // corridor's grade too, so interpolation cannot create a steep kink between
    // individually gentle road profiles. Hills outside the road cuts stay raw.
    const gridHeap=[],active=index=>index>=0&&index<heights.length&&gradeMax[index]>.98;
    function gridPush(item){let i=gridHeap.length;gridHeap.push(item);while(i){const p=(i-1)>>1;if(gridHeap[p].height<=item.height)break;gridHeap[i]=gridHeap[p];i=p;}gridHeap[i]=item;}
    function gridPop(){const first=gridHeap[0],last=gridHeap.pop();if(!gridHeap.length)return first;let i=0;while(i*2+1<gridHeap.length){let child=i*2+1;if(child+1<gridHeap.length&&gridHeap[child+1].height<gridHeap[child].height)child++;if(gridHeap[child].height>=last.height)break;gridHeap[i]=gridHeap[child];i=child;}gridHeap[i]=last;return first;}
    for(let index=0;index<heights.length;index++)if(active(index))gridPush({index,height:heights[index]});
    while(gridHeap.length){const item=gridPop();if(item.height>heights[item.index]+.00001)continue;
      const col=item.index%count,row=Math.floor(item.index/count);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]]) {
        if(col+dx<0||col+dx>=count||row+dy<0||row+dy>=rows)continue;
        const index=item.index+dy*count+dx;if(!active(index))continue;
        const candidate=item.height+step/UNIT*.13*Math.hypot(dx,dy);
        if(candidate<heights[index]){heights[index]=candidate;gridPush({index,height:heights[index]});}
      }
    }
    for(const building of world.buildings||[]) {
      const cx=building.x+building.w/2,cy=building.y+building.h/2,c=Math.cos(building.angle||0),s=Math.sin(building.angle||0);
      const base=heightAt(cx,cy),hw=building.w/2,hh=building.h/2,blend=step*1.5,radius=Math.hypot(hw+blend,hh+blend);
      cells(cx-radius,cy-radius,cx+radius,cy+radius,(x,y,index)=>{
        const localX=(x-cx)*c+(y-cy)*s,localY=-(x-cx)*s+(y-cy)*c;
        const edge=Math.max(Math.abs(localX)-hw,Math.abs(localY)-hh);
        if(edge>blend||gradeMax[index]>.99)return;
        const weight=edge<=step*.7?1:1-smooth((edge-step*.7)/(blend-step*.7));
        heights[index]=mix(heights[index],base,weight);
      });
      // The level foundation reaches the highest corner, including narrow
      // roadside lots whose blend must preserve the carriageway's grading.
      building.elevation=Math.max(base,...[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y])=>heightAt(cx+x*c-y*s,cy+x*s+y*c)));
    }
    // Small parking lots need level support across the entire rigid chassis.
    // Keep the surrounding cell vertices level too: each bay is narrower than
    // a terrain cell, so merely flattening points inside its painted rectangle
    // would leave sloped physical triangles beneath the wheels and body.
    const parkingPads=[],parkingCells=new Map(),parkingShoulders=new Set(),support=step*Math.SQRT2,blend=step*2;
    function parkingGroup(pad){while(pad.parent!==pad){pad.parent=pad.parent.parent;pad=pad.parent;}return pad;}
    const airport=world.landscape?.airport;
    const aircraftPads=airport?[...(airport.runways||[]),...(airport.taxiways||[]),...(airport.aprons||[]),...(airport.walkways||[])]:[];
    for(const pad of world.landscape?.helipads||[])if(!pad.rooftop)
      aircraftPads.push({x:pad.x-pad.radius,y:pad.y-pad.radius,w:pad.radius*2,h:pad.radius*2,angle:pad.angle||0});
    // Airport surfaces join the same linked support groups as parking bays.
    // Their overlapping support vertices give the whole runway/taxi/apron one
    // height in the rendered mesh and Cannon heightfield, including shoulders.
    for(const bay of [...(world.parkingBays||[]),...aircraftPads]) {
      const cx=bay.x+bay.w/2,cy=bay.y+bay.h/2,c=Math.cos(bay.angle||0),s=Math.sin(bay.angle||0),hw=bay.w/2,hh=bay.h/2;
      const pad={cx,cy,c,s,hw,hh,base:heightAt(cx,cy),indices:[]};pad.parent=pad;parkingPads.push(pad);
      const radius=Math.hypot(hw+support,hh+support);
      cells(cx-radius,cy-radius,cx+radius,cy+radius,(x,y,index)=>{
        const edge=Math.max(Math.abs((x-cx)*c+(y-cy)*s)-hw,Math.abs(-(x-cx)*s+(y-cy)*c)-hh);
        if(edge>support)return;
        pad.indices.push(index);
        if(parkingCells.has(index))parkingGroup(pad).parent=parkingGroup(parkingCells.get(index));
        else parkingCells.set(index,pad);
      });
    }
    // Nearby bays can share physical cell vertices. Give those connected pads
    // one elevation, then restore all support vertices after shoulder blending.
    const parkingGroups=new Map();
    for(const pad of parkingPads){const root=parkingGroup(pad),group=parkingGroups.get(root)||{sum:0,count:0};group.sum+=pad.base;group.count++;parkingGroups.set(root,group);}
    for(const pad of parkingPads) {
      const {cx,cy,c,s,hw,hh}=pad,group=parkingGroups.get(parkingGroup(pad)),base=group.sum/group.count;
      pad.base=base;
      const radius=Math.hypot(hw+support+blend,hh+support+blend);
      cells(cx-radius,cy-radius,cx+radius,cy+radius,(x,y,index)=>{
        const localX=(x-cx)*c+(y-cy)*s,localY=-(x-cx)*s+(y-cy)*c;
        const edge=Math.max(Math.abs(localX)-hw,Math.abs(localY)-hh);
        if(edge>support+blend)return;
        if(!waterRaw(x,y))parkingShoulders.add(index);
        const weight=edge<=support?1:1-smooth((edge-support)/blend);
        heights[index]=mix(heights[index],base,weight);
      });
    }
    for(const pad of parkingPads)for(const index of pad.indices)heights[index]=pad.base;
    // Parking shoulders can reach an adjacent carriageway. Apply the same
    // physical grade bound again, treating each level pad as one linked node
    // so its entire support surface moves together when a road cut is lowered.
    for(const group of parkingGroups.values()){group.indices=new Set();group.level=Infinity;}
    for(const pad of parkingPads){const group=parkingGroups.get(parkingGroup(pad));for(const index of pad.indices){group.indices.add(index);group.level=Math.min(group.level,heights[index]);}}
    const padGradeActive=index=>active(index)||parkingShoulders.has(index)||parkingCells.has(index);
    function lowerPadGrade(index,value) {
      const pad=parkingCells.get(index),group=pad&&parkingGroups.get(parkingGroup(pad));
      if(group){
        if(value>=group.level-.000001)return;
        group.level=Math.fround(value);
        for(const member of group.indices){heights[member]=group.level;gridPush({index:member,height:group.level});}
      } else if(value<heights[index]-.000001){heights[index]=value;gridPush({index,height:heights[index]});}
    }
    for(let index=0;index<heights.length;index++)if(padGradeActive(index))gridPush({index,height:heights[index]});
    while(gridHeap.length){const item=gridPop();if(item.height>heights[item.index]+.00001)continue;
      const col=item.index%count,row=Math.floor(item.index/count);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]]){
        if(col+dx<0||col+dx>=count||row+dy<0||row+dy>=rows)continue;
        const index=item.index+dy*count+dx;if(!padGradeActive(index))continue;
        lowerPadGrade(index,item.height+step/UNIT*.13*Math.hypot(dx,dy));
      }
    }
    // Restore the engineered formation after road/lot grading. This leaves the
    // original water mask untouched and keeps the track bed below road decks.
    const railRaised=[],railLocked=new Set();
    if(world.railway)for(let row=0;row<rows;row++)for(let col=0;col<count;col++) {
      const x=originX+col*step,y=originY+row*step,index=row*count+col;
      const previous=heights[index],graded=Railway.earthworks(world.railway,x,y,previous,waterRaw(x,y),true);heights[index]=graded.height;
      if(graded.locked)railLocked.add(index);
      if(heights[index]>previous+.00001)railRaised.push(index);
    }
    // A formation alongside a street can raise a shared triangle. Feather that
    // fill up the street as well, retaining its physical grade at the join.
    for(let i=0;i<railRaised.length;i++) {
      const index=railRaised[i],col=index%count,row=Math.floor(index/count);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]]) {
        if(col+dx<0||col+dx>=count||row+dy<0||row+dy>=rows)continue;
        const neighbor=index+dy*count+dx;if(!padGradeActive(neighbor))continue;
        const x=originX+(col+dx)*step,y=originY+(row+dy)*step;if(waterRaw(x,y))continue;
        const value=heights[index]-step/UNIT*.13*Math.hypot(dx,dy);
        if(heights[neighbor]<value-.00001){heights[neighbor]=value;railRaised.push(neighbor);}
      }
    }
    if(world.railway) {
      for(let index=0;index<heights.length;index++)if(padGradeActive(index))gridPush({index,height:heights[index]});
      while(gridHeap.length) {
        const item=gridPop();if(item.height>heights[item.index]+.00001)continue;
        const col=item.index%count,row=Math.floor(item.index/count);
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]]) {
          if(col+dx<0||col+dx>=count||row+dy<0||row+dy>=rows)continue;
          const index=item.index+dy*count+dx;if(!padGradeActive(index)||railLocked.has(index))continue;
          lowerPadGrade(index,item.height+step/UNIT*.13*Math.hypot(dx,dy));
        }
      }
    }
    // Reapply the engineered base surface after neighboring road and lot cuts.
    // This also keeps runway shoulders level across both physical triangles.
    const militaryRaised=[];
    if(pads.length)for(let row=0;row<rows;row++)for(let col=0;col<count;col++) {
      const index=row*count+col;
      const before=heights[index];
      heights[index]=militaryEarthworks(pads,originX+col*step,originY+row*step,before,step);
      if(padGradeActive(index)&&(heights[index]>before+.00001||militarySupport(pads,originX+col*step,originY+row*step,step)!==null))militaryRaised.push(index);
    }
    // A fixed airfield formation is the upper constraint for its road cuts.
    // Carry its fill out along graded approach cells instead of ending a road
    // below the level pad and creating a short cliff under the entrance.
    for(let i=0;i<militaryRaised.length;i++) {
      const index=militaryRaised[i],col=index%count,row=Math.floor(index/count);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]]) {
        if(col+dx<0||col+dx>=count||row+dy<0||row+dy>=rows)continue;
        const next=index+dy*count+dx;if(!padGradeActive(next))continue;
        const level=heights[index]-step/UNIT*.13*Math.hypot(dx,dy);
        if(heights[next]<level-.00001){heights[next]=level;militaryRaised.push(next);}
      }
    }
    // The old city's axis bounds admit steeper diagonal road directions.
    // Bound the new mountain corridor on both grid axes so either triangular
    // face stays below 14% in every heading, without resculpting old streets.
    const militaryGrade=.095,militaryFixed=new Map(),militaryFill=[];
    for(const index of militaryRoadCells) {
      const col=index%count,row=Math.floor(index/count),level=militarySupport(pads,originX+col*step,originY+row*step,step);
      if(level!==null){militaryFixed.set(index,level);heights[index]=level;militaryFill.push(index);}
      gridPush({index,height:heights[index]});
    }
    while(gridHeap.length) {
      const item=gridPop();if(item.height>heights[item.index]+.00001)continue;
      const col=item.index%count,row=Math.floor(item.index/count);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]]) {
        if(col+dx<0||col+dx>=count||row+dy<0||row+dy>=rows)continue;
        const next=item.index+dy*count+dx;if(!militaryRoadCells.has(next))continue;
        const level=Math.max(item.height+step/UNIT*militaryGrade*Math.hypot(dx,dy),militaryFixed.get(next)??-Infinity);
        if(level<heights[next]-.00001){heights[next]=level;gridPush({index:next,height:level});}
      }
    }
    for(let i=0;i<militaryFill.length;i++) {
      const index=militaryFill[i],col=index%count,row=Math.floor(index/count);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]]) {
        if(col+dx<0||col+dx>=count||row+dy<0||row+dy>=rows)continue;
        const next=index+dy*count+dx;if(!militaryRoadCells.has(next))continue;
        const level=heights[index]-step/UNIT*militaryGrade*Math.hypot(dx,dy);
        if(heights[next]<level-.00001){heights[next]=level;militaryFill.push(next);}
      }
    }
    // A new mountain cut can share cells with Pine Ridge Road. Carry that cut
    // along its existing graded neighbors instead of ending at the district
    // boundary with a steep lip in the older street or a nearby parking bay.
    for(const index of militaryRoadCells)gridPush({index,height:heights[index]});
    while(gridHeap.length) {
      const item=gridPop();if(item.height>heights[item.index]+.00001)continue;
      const col=item.index%count,row=Math.floor(item.index/count);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1]]) {
        if(col+dx<0||col+dx>=count||row+dy<0||row+dy>=rows)continue;
        const next=item.index+dy*count+dx;if(!padGradeActive(next)||railLocked.has(next))continue;
        const grade=militaryRoadCells.has(item.index)&&militaryRoadCells.has(next)?militaryGrade:.13;
        const minimum=militarySupport(pads,originX+(col+dx)*step,originY+(row+dy)*step,step)??-Infinity;
        lowerPadGrade(next,Math.max(minimum,item.height+step/UNIT*grade*Math.hypot(dx,dy)));
      }
    }
    // Recheck after all neighboring pads have blended. Solid foundations cover
    // the full footprint down to its lowest ground point instead of leaving
    // accessible gaps beneath level walls on slopes.
    for(const building of world.buildings||[]) {
      const cx=building.x+building.w/2,cy=building.y+building.h/2,c=Math.cos(building.angle||0),s=Math.sin(building.angle||0),hw=building.w/2,hh=building.h/2;
      const samples=[];
      for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){const x=-hw+building.w*i/4,y=-hh+building.h*j/4;samples.push(heightAt(cx+x*c-y*s,cy+x*s+y*c));}
      building.elevation=Math.max(...samples);building.foundationBottom=Math.min(...samples)-.12;
    }
    for(const road of world.roads||[])if(!road.bridge)for(let i=0;i<road.points.length;i++)if(!Railway.isOverpassSegment(road,Math.max(1,i))&&!Railway.isOverpassSegment(road,Math.min(road.points.length-1,i+1)))road.points[i].elevation=heightAt(road.points[i].x,road.points[i].y);
    // Ground queries are frequent even far from bridges. Index the expanded
    // segment bounds once, preserving segment order and exact edge tests.
    const bridgeCellSize=256,bridgeCells=new Map();
    for(const segment of bridgeSegments) {
      const margin=segment.road.width/2+(world.sidewalkWidth||32)+2;
      const minX=Math.floor((Math.min(segment.a.x,segment.b.x)-margin)/bridgeCellSize),maxX=Math.floor((Math.max(segment.a.x,segment.b.x)+margin)/bridgeCellSize);
      const minY=Math.floor((Math.min(segment.a.y,segment.b.y)-margin)/bridgeCellSize),maxY=Math.floor((Math.max(segment.a.y,segment.b.y)+margin)/bridgeCellSize);
      for(let ix=minX;ix<=maxX;ix++)for(let iy=minY;iy<=maxY;iy++) {
        const key=ix+','+iy;
        if(!bridgeCells.has(key))bridgeCells.set(key,[]);
        bridgeCells.get(key).push(segment);
      }
    }
    function bridgeAt(x,y) {
      let best=null;
      const nearby=bridgeCells.get(Math.floor(x/bridgeCellSize)+','+Math.floor(y/bridgeCellSize));
      if(!nearby)return best;
      for(const segment of nearby) {
        const hit=closest(x,y,segment.a,segment.b);
        if(hit.distance>segment.road.width/2+(world.sidewalkWidth||32)+2)continue;
        const height=mix(segment.a.elevation,segment.b.elevation,hit.t);
        if(!best||hit.distance<best.distance-.000001||Math.abs(hit.distance-best.distance)<.000001&&height>best.height)best={height,segment,distance:hit.distance};
      }
      return best;
    }
    const surfaceHeight=(x,y)=>Math.max(heightAt(x,y),bridgeAt(x,y)?.height??-Infinity);
    function surfaceNormalAt(x,y) {
      const bridge=bridgeAt(x,y);if(!bridge||bridge.height<heightAt(x,y))return normalAt(x,y);
      const {a,b,length}=bridge.segment,grade=(b.elevation-a.elevation)/(length/UNIT),nx=-(b.x-a.x)/length*grade,nz=-(b.y-a.y)/length*grade,l=Math.hypot(nx,1,nz);
      return {x:nx/l,y:1/l,z:nz/l};
    }
    function roadHeight(roadId,s) {
      const road=(world.roads||[]).find(road=>road.id===roadId);if(!road)return 0;
      s=clamp(s,0,road.length);let i=0;
      while(i<road.arc.length-2&&road.arc[i+1]<s)i++;
      const span=road.arc[i+1]-road.arc[i],t=span?(s-road.arc[i])/span:0;
      return road.bridge||Railway.isOverpassSegment(road,i+1)?mix(road.points[i].elevation,road.points[i+1].elevation,t)
        :heightAt(mix(road.points[i].x,road.points[i+1].x,t),mix(road.points[i].y,road.points[i+1].y,t));
    }
    const terrain={size,mapWidth,mapHeight,referenceMapWidth,referenceMapHeight,count,rows,step,originX,originY,minY,maxY,heights,waterLevel:0,sourceBitDepth:Data.sourceBitDepth,sourceSha256:Data.sourceSha256,
      northSourceSha256:North?.sourceSha256||null,
      heightAt,surfaceHeight,normalAt,surfaceNormalAt,roadHeight,rawHeight,
      isWater:(x,y)=>waterRaw(x,y)&&heightAt(x,y)<.05};
    for(const object of world.staticObjects||[])object.elevation=surfaceHeight(object.x,object.y);
    for(const service of world.services||[])service.elevation=surfaceHeight(service.x,service.y);
    for(const spawn of world.vehicleSpawns||[])spawn.elevation=surfaceHeight(spawn.x,spawn.y);
    for(const bay of world.parkingBays||[])bay.elevation=surfaceHeight(bay.x+bay.w/2,bay.y+bay.h/2);
    for(const entity of Object.values(world.start||{}))if(entity&&Number.isFinite(entity.x))entity.elevation=surfaceHeight(entity.x,entity.y);
    return terrain;
  }
  const api={createTerrain,militaryEarthworks,COUNT,MAX_ROAD_GRADE};root.MayhemTerrain=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
