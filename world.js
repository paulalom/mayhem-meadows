/* One road graph owns Mayhem Meadows' city, suburbs, routes, and lot placement. */
(function (root) {
  'use strict';
  const SIZE = 12000, MAP_WIDTH=12000, MAP_HEIGHT=8000, SIDEWALK_WIDTH = 32;
  const HeightData=typeof module!=='undefined'&&module.exports?require('./height-data.js'):root.MayhemHeightData;
  const Terrain=typeof module!=='undefined'&&module.exports?require('./terrain.js'):root.MayhemTerrain;
  const Railway=typeof module!=='undefined'&&module.exports?require('./railway.js'):root.MayhemRailway;
  const Military=typeof module!=='undefined'&&module.exports?require('./military.js'):root.MayhemMilitary;
  const DISTRICTS = Object.freeze({
    heights: Object.freeze({ id: 'heights', name: 'Old Town', color: '#bcd2ae', mapColor: '#bcd2ae',pedCount:8 }),
    works: Object.freeze({ id: 'works', name: 'Docklands', color: '#b8c7cd', mapColor: '#b8c7cd',pedCount:5 }),
    market: Object.freeze({ id: 'market', name: 'Downtown', color: '#d9c6b6', mapColor: '#d9c6b6',pedCount:14 }),
    riverfront: Object.freeze({ id: 'riverfront', name: 'West Beach & Marina', color: '#b7d5c7', mapColor: '#b7d5c7',pedCount:6 }),
    willow: Object.freeze({ id: 'willow', name: 'Northside', color: '#a9c99f', mapColor: '#a9c99f', suburban: true,pedCount:10 }),
    orchard: Object.freeze({ id: 'orchard', name: 'Airport', color: '#d2d6ac', mapColor: '#d2d6ac',pedCount:3 }),
    ridge: Object.freeze({id:'ridge',name:'Ridge Heights',color:'#9cb190',mapColor:'#9cb190',pedCount:1}),
    marsh: Object.freeze({id:'marsh',name:'Tidewell Marsh',color:'#8fac98',mapColor:'#8fac98',pedCount:1}),
    military: Object.freeze({id:'military',name:'Northwatch Airbase',color:'#a3ad8d',mapColor:'#a3ad8d',pedCount:6})
  });
  const COLORS = ['#ffd15b', '#fb8097', '#67d3c8', '#a6a0fa', '#90c66b', '#6fb5eb'];
  const PROP_HEALTH = Object.freeze({fence:25,wayfinding:20,lamp:35,bench:45,tree:90,fountain:160});
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const heading = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  function districtAt(point, y) {
    const x = typeof point === 'number' ? point : point.x;
    y = typeof point === 'number' ? y : point.y;
    if(y<0)return DISTRICTS[x>=1750&&x<=6620&&y>=-3400&&y<=-750?'military':'ridge'];
    return DISTRICTS[x>9450?(y>5600?'marsh':'orchard'):y<2500?(x<5300?'ridge':'willow'):
      y>4900&&x>6000?'works':x<5200?(y>4000?'riverfront':'heights'):'market'];
  }

  function footprintCorners(box, margin = 0) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, angle = box.angle || 0;
    const c = Math.cos(angle), s = Math.sin(angle), hw = box.w / 2 + margin, hh = box.h / 2 + margin;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
  }

  function boxesOverlap(a, b, margin = 0) {
    const aa = a.angle || 0, ba = b.angle || 0;
    const axes = [[Math.cos(aa), Math.sin(aa)], [-Math.sin(aa), Math.cos(aa)], [Math.cos(ba), Math.sin(ba)], [-Math.sin(ba), Math.cos(ba)]];
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    for (const [x, y] of axes) {
      const project = box => {
        const angle = box.angle || 0;
        return (box.w / 2 + margin) * Math.abs(x * Math.cos(angle) + y * Math.sin(angle))
          + (box.h / 2 + margin) * Math.abs(-x * Math.sin(angle) + y * Math.cos(angle));
      };
      if (Math.abs((ac.x - bc.x) * x + (ac.y - bc.y) * y) >= project(a) + project(b) - 0.001) return false;
    }
    return true;
  }

  function segmentHitsBox(a, b, box, expand = 0) {
    const angle = box.angle || 0, c = Math.cos(angle), s = Math.sin(angle), cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const local = point => ({ x: (point.x - cx) * c + (point.y - cy) * s, y: -(point.x - cx) * s + (point.y - cy) * c });
    const p = local(a), q = local(b), dx = q.x - p.x, dy = q.y - p.y;
    const hw = box.w / 2 + expand, hh = box.h / 2 + expand;
    let lo = 0, hi = 1;
    for (const [origin, delta, half] of [[p.x, dx, hw], [p.y, dy, hh]]) {
      if (Math.abs(delta) < 1e-9) { if (Math.abs(origin) > half) return false; }
      else {
        let near = (-half - origin) / delta, far = (half - origin) / delta;
        if (near > far) [near, far] = [far, near];
        lo = Math.max(lo, near); hi = Math.min(hi, far);
        if (lo > hi) return false;
      }
    }
    return true;
  }

  function segmentBoxDistance(a, b, box) {
    if (segmentHitsBox(a, b, box)) return 0;
    const angle=box.angle||0,c=Math.cos(angle),s=Math.sin(angle),cx=box.x+box.w/2,cy=box.y+box.h/2;
    const local=p=>({x:(p.x-cx)*c+(p.y-cy)*s,y:-(p.x-cx)*s+(p.y-cy)*c});
    const p=local(a),q=local(b),hw=box.w/2,hh=box.h/2;
    let best=Math.min(Math.hypot(Math.max(0,Math.abs(p.x)-hw),Math.max(0,Math.abs(p.y)-hh)),
      Math.hypot(Math.max(0,Math.abs(q.x)-hw),Math.max(0,Math.abs(q.y)-hh)));
    const dx=q.x-p.x,dy=q.y-p.y,length2=dx*dx+dy*dy;
    for(const [x,y] of [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]]) {
      const t=clamp(((x-p.x)*dx+(y-p.y)*dy)/length2,0,1);
      best=Math.min(best,Math.hypot(x-p.x-dx*t,y-p.y-dy*t));
    }
    return best;
  }

  function sampleCurve(a, b, bend = 0, skew = 0) {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
    const c1 = { x: a.x + dx / 3 + nx * bend, y: a.y + dy / 3 + ny * bend };
    const c2 = { x: b.x - dx / 3 + nx * (bend + skew), y: b.y - dy / 3 + ny * (bend + skew) };
    const steps = Math.max(2, Math.ceil(3 * Math.max(distance(a, c1), distance(c1, c2), distance(c2, b)) / 24));
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      points.push({ x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x,
        y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y });
    }
    return points;
  }

  class RoadNetwork {
    constructor(roads, nodes) {
      this.roads = roads; this.nodes = nodes;
      this.roadById = new Map(roads.map(road => [road.id, road]));
      this.nodeById = new Map(nodes.map(node => [node.id, node]));
      this.adjacency = new Map(nodes.map(node => [node.id, []]));
      for (const road of roads) {
        const arc = [0];
        for (let i = 1; i < road.points.length; i++) arc.push(arc[i - 1] + distance(road.points[i - 1], road.points[i]));
        road.arc = arc; road.length = arc.at(-1);
        this.adjacency.get(road.a).push({ to: road.b, road, reverse: false, length: road.length });
        this.adjacency.get(road.b).push({ to: road.a, road, reverse: true, length: road.length });
      }
    }

    nearestRoad(point) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      let best = null;
      for (const road of this.roads) for (let i = 0; i < road.points.length - 1; i++) {
        const a = road.points[i], b = road.points[i + 1], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
        const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length2, 0, 1), x = a.x + dx * t, y = a.y + dy * t;
        const d = Math.hypot(point.x - x, point.y - y);
        if (!best || d < best.distance) best = { x, y, angle: Math.atan2(dy, dx), roadId: road.id, road,
          index: i, t, distance: d, width: road.width, s: road.arc[i] + Math.sqrt(length2) * t,
          elevation:Number.isFinite(a.elevation)&&Number.isFinite(b.elevation)?a.elevation+(b.elevation-a.elevation)*t:undefined };
      }
      return best;
    }

    project(point) { return this.nearestRoad(point); }

    pointOnRoad(id, s, offset = 0) {
      const road = this.roadById.get(id);
      if (!road || !Number.isFinite(s) || !Number.isFinite(offset)) return null;
      s = clamp(s, 0, road.length);
      let i = 0;
      while (i < road.arc.length - 2 && road.arc[i + 1] < s) i++;
      const a = road.points[i], b = road.points[i + 1], t = (s - road.arc[i]) / (road.arc[i + 1] - road.arc[i]);
      const angle = heading(a, b);
      return { x: a.x + (b.x - a.x) * t - Math.sin(angle) * offset,
        y: a.y + (b.y - a.y) * t + Math.cos(angle) * offset,
        angle, roadId: id, road, s, width: road.width, index: i, t,
        elevation:Number.isFinite(a.elevation)&&Number.isFinite(b.elevation)?a.elevation+(b.elevation-a.elevation)*t:undefined };
    }

    _shortestNodes(start, end) {
      if (start === end) return { length: 0, edges: [] };
      const pending = new Set(this.nodeById.keys()), distances = new Map([[start, 0]]), previous = new Map();
      while (pending.size) {
        let current = null, value = Infinity;
        for (const id of pending) if ((distances.get(id) ?? Infinity) < value) { current = id; value = distances.get(id); }
        if (current === null) break;
        pending.delete(current);
        if (current === end) break;
        for (const edge of this.adjacency.get(current) || []) {
          const candidate = value + edge.length;
          if (candidate < (distances.get(edge.to) ?? Infinity)) { distances.set(edge.to, candidate); previous.set(edge.to, { from: current, edge }); }
        }
      }
      if (!Number.isFinite(distances.get(end))) return null;
      const edges = [];
      for (let id = end; id !== start;) { const step = previous.get(id); if (!step) return null; edges.unshift(step.edge); id = step.from; }
      return { length: distances.get(end), edges };
    }

    route(from, to, laneOffset = 0) {
      const start = this.nearestRoad(from), end = this.nearestRoad(to);
      if (!start || !end || !Number.isFinite(laneOffset)) return [];
      let best = start.roadId === end.roadId ? { length: Math.abs(end.s - start.s), pieces: [{ road: start.road, from: start.s, to: end.s }] } : null;
      for (const first of [{ id: start.road.a, s: 0 }, { id: start.road.b, s: start.road.length }]) {
        for (const last of [{ id: end.road.a, s: 0 }, { id: end.road.b, s: end.road.length }]) {
          const middle = this._shortestNodes(first.id, last.id);
          if (!middle) continue;
          const length = Math.abs(start.s - first.s) + middle.length + Math.abs(end.s - last.s);
          if (best && length >= best.length) continue;
          best = { length, pieces: [{ road: start.road, from: start.s, to: first.s }]
            .concat(middle.edges.map(edge => ({ road: edge.road, from: edge.reverse ? edge.road.length : 0, to: edge.reverse ? 0 : edge.road.length })))
            .concat([{ road: end.road, from: last.s, to: end.s }]) };
        }
      }
      if (!best) return [];
      const points = [];
      for (const piece of best.pieces) {
        const sign = piece.to >= piece.from ? 1 : -1, span = Math.abs(piece.to - piece.from), count = Math.max(1, Math.ceil(span / 22));
        for (let i = 0; i <= count; i++) {
          const s = piece.from + (piece.to - piece.from) * i / count;
          const point = this.pointOnRoad(piece.road.id, s, 0);
          point.angle = wrap(point.angle + (sign < 0 ? Math.PI : 0));
          if (!points.length || distance(points.at(-1), point) > 0.01) points.push(point);
        }
      }
      if(!laneOffset||!points.length) return points;
      // Offset the complete route, not each street separately. Shared tangent
      // joins preserve the two lanes through junctions rather than funneling
      // both directions onto the same centre waypoint.
      const joined=[];let pendingExit=null;
      for(let i=0;i<points.length;i++) {
        const point=points[i],previous=points[i-1],next=points[i+1];
        const incoming=previous?heading(previous,point):next?heading(point,next):point.angle;
        const outgoing=next?heading(point,next):incoming,turn=wrap(outgoing-incoming);
        const nx1=-Math.sin(incoming),ny1=Math.cos(incoming),nx2=-Math.sin(outgoing),ny2=Math.cos(outgoing);
        const denominator=1+Math.cos(turn),mx=(nx1+nx2)*laneOffset/Math.max(.00001,denominator),my=(ny1+ny2)*laneOffset/Math.max(.00001,denominator);
        const miterLength=Math.hypot(mx,my);
        if(pendingExit) {
          const direction=pendingExit.direction;
          if(point.roadId===pendingExit.roadId&&
            (point.x+mx-pendingExit.point.x)*direction.x+(point.y+my-pendingExit.point.y)*direction.y<-.01) continue;
          pendingExit=null;
        }
        if(laneOffset*turn<0&&miterLength>Math.abs(laneOffset)*1.8) {
          // An outside acute turn needs a rounded join inside the visible
          // junction cap, rather than a long spike beyond either road end.
          const count=Math.max(2,Math.ceil(Math.abs(turn)/.3));
          for(let n=0;n<=count;n++) {
            const tangent=incoming+turn*n/count;
            joined.push({...point,x:point.x-Math.sin(tangent)*laneOffset,y:point.y+Math.cos(tangent)*laneOffset});
          }
        } else {
          const limit=Math.abs(laneOffset)*3,scale=miterLength>limit?limit/miterLength:1;
          const corner={...point,x:point.x+mx*scale,y:point.y+my*scale};
          if(laneOffset*turn>0&&Math.abs(turn)>.35&&previous&&next) {
            const direction={x:Math.cos(incoming),y:Math.sin(incoming)};
            // An inside miter meets before the centre junction. Remove close
            // samples past that meeting point instead of making a short loop.
            while(joined.length&&(joined.at(-1).x-corner.x)*direction.x+(joined.at(-1).y-corner.y)*direction.y>.01) joined.pop();
            pendingExit={point:corner,direction:{x:Math.cos(outgoing),y:Math.sin(outgoing)},roadId:next.roadId};
          }
          joined.push(corner);
        }
      }
      const lanes=[];
      for(const point of joined) {
        const previous=lanes.at(-1);
        if(previous&&distance(previous,point)>.01) {
          const span=distance(previous,point),count=span>24?Math.ceil(span/22):1;
          for(let n=1;n<count;n++) {
            const t=n/count,x=previous.x+(point.x-previous.x)*t,y=previous.y+(point.y-previous.y)*t;
            const metadata=previous.roadId===point.roadId?{...previous,s:previous.s+(point.s-previous.s)*t}:this.nearestRoad({x,y});
            lanes.push({...metadata,x,y});
          }
        }
        if(!lanes.length||distance(lanes.at(-1),point)>.01) lanes.push(point);
      }
      for(let i=0;i<lanes.length;i++) lanes[i].angle=i<lanes.length-1?heading(lanes[i],lanes[i+1]):i?heading(lanes[i-1],lanes[i]):lanes[i].angle;
      return lanes;
    }

    shortestPath(from, to, laneOffset = 0) { return this.route(from, to, laneOffset); }
  }

  function createWorld(seed = 0x5eed1234) {
    let state = (typeof seed === 'object' ? seed.seed : seed) >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const nodes = [], roads = [], byId = new Map();
    const node = (id, x, y) => { const point = { id, x, y }; nodes.push(point); byId.set(id, point); return point; };
    const road = (id, name, a, b, district, bend = 0, width = 100, skew = 0) => roads.push({ id, name, a, b, district, width, points: sampleCurve(byId.get(a), byId.get(b), bend, skew) });
    for (const [id, x, y] of [
      ['north',6000,2950],['bakery',6000,3250],['garage',6000,3500],['spawn',6000,3700],['plaza',6000,3950],['market',6100,4300],
      ['clock',5450,3150],['heights',4700,2950],['westgate',4150,3050],['garden',4300,3600],['outer',4250,4100],['creek',4900,4350],['southgate',5550,4650],
      ['arcade',6550,3900],['depot',6750,3300],['eastmarket',7300,3900],['canal',7900,4300],['riverbend',6550,4650],
      ['quay',7300,5100],['ferry',8100,5100],['warehouse',7500,5600],['worksyard',8250,6100],['clay',7400,6400],['dock-end',8050,6650],
      ['oldwest',3400,3000],['oldlower',3500,3650],['beach',2800,4300],['beach-tip',2350,4600],
      ['marina-gate',3550,4480],['marina-west',3150,5250],['marina-south',3600,6050],['marina-east',4250,6100],
      ['ridge-gate',3350,2350],['ridge-low',2450,2220],['ridge-switch1',3000,1840],['ridge-switch2',2100,1550],['ridge-switch3',2920,1170],
      ['ridge-switch4',2200,850],['eagle-peak',4300,550],['vista',1350,1600],['pine-ridge',5550,1150],
      ['willow-trail',6400,2600],['willow-entry',6750,2300],['willow-green',7200,1800],['willow-bend',6750,1400],
      ['willow-lake',7250,850],['willow-end',8000,1200],['willow-east',8350,1850],['willow-top',8000,2450],
      ['willow-court',6220,1570],['birch-court',6800,650],['elm-court',8650,2200],['fern-court',6350,2200],
      ['bridge-north-west',8750,1250],['bridge-north-east',9850,1300],['bridge-city-west',8140,3700],['bridge-city-east',9500,3700],
      ['orchard-gate',10200,1650],['apple',11000,1650],['orchard-east',11400,2350],['orchard-pond',11400,4400],
      ['orchard-south',10700,5250],['orchard-west',10000,5200],['orchard-green',9850,3750],['orchard-center',10200,3400],
      ['marsh-gate',10850,5850],['marsh-lookout',11000,6430],['marsh-east',11600,6150]
    ]) node(id, x, y);
    for (const spec of [
      ['north-spine','Biscuit Avenue','north','bakery','market',0,110],['bakery-spine','Biscuit Avenue','bakery','garage','market',0,110],
      ['garage-spine','Biscuit Avenue','garage','spawn','market',0,110],['plaza-spine','Biscuit Avenue','spawn','plaza','market',0,110],
      ['market-lane','Market Mile','plaza','market','market',-25,110],['clock-street','Clock Street','bakery','clock','market',30,100],
      ['heights-rise','Scone Rise','clock','heights','heights',-55,100],['heights-lane','Daisy Lane','heights','westgate','heights',40,100],
      ['garden-lane','Garden Crescent','westgate','garden','heights',-55,100],['plaza-lane','Crumb Street','garden','plaza','heights',60,100],
      ['outer-lane','Primrose Bend','garden','outer','heights',50,100],['creek-lane','Creek Road','outer','creek','heights',-35,100],
      ['market-creek','Market Mile','market','creek','market',-60,100],['garden-creek','Garden Crescent','garden','creek','heights',-70,100],
      ['southgate-road','Seafront Drive','creek','southgate','riverfront',50,110],['riverbend-road','Quay Road','market','riverbend','market',35,110],
      ['southgate-bend','Quay Road','southgate','riverbend','riverfront',-30,110],['arcade-road','Arcade Street','plaza','arcade','market',20,110],
      ['arcade-depot','Noodle Street','arcade','depot','market',-40,100],['eastmarket-road','Bean Boulevard','arcade','eastmarket','market',-25,110],
      ['depot-market','Fudge Street','depot','eastmarket','market',40,100],['north-depot','Clock Street','north','depot','market',-45,100],
      ['canal-road','Canal Crescent','eastmarket','canal','market',45,110],['ferry-road','Canal Crescent','canal','ferry','works',-50,110],
      ['quay-road','Quay Road','riverbend','quay','works',50,110],['ferry-quay','Waterside Way','ferry','quay','works',-45,110],
      ['warehouse-road','Loading Lane','quay','warehouse','works',40,120],['works-road','Waffle Way','warehouse','worksyard','works',-50,120],
      ['clay-road','Container Road','worksyard','clay','works',-45,120],['yard-road','Container Road','clay','warehouse','works',50,120],
      ['dock-pier','Sprinkle Pier','worksyard','dock-end','works',0,100],
      ['old-west','Old Market Road','westgate','oldwest','heights',60,100],['old-loop','Old Market Road','oldwest','oldlower','heights',-55,100],
      ['old-garden','Daisy Lane','oldlower','garden','heights',-55,100],['beach-road','West Beach Drive','oldlower','beach','riverfront',40,110],
      ['beach-walk','West Beach Drive','beach','beach-tip','riverfront',-20,100],['marina-approach','Harbor Crescent','beach','marina-gate','riverfront',-55,110],
      ['marina-east-link','Harbor Crescent','marina-gate','outer','riverfront',50,100],['marina-west-road','Harbor Road','marina-gate','marina-west','riverfront',100,100],
      ['marina-south-road','Harbor Road','marina-west','marina-south','riverfront',80,100],['marina-pier','Marina Way','marina-south','marina-east','riverfront',-40,100],
      ['ridge-approach','Ridge Road','oldwest','ridge-gate','ridge',-45,100],['ridge-low-road','Ridge Road','ridge-gate','ridge-low','ridge',-90,100],
      ['ridge-hairpin1','Eagle Pass','ridge-low','ridge-switch1','ridge',-120,100],['ridge-hairpin2','Eagle Pass','ridge-switch1','ridge-switch2','ridge',115,100],
      ['ridge-hairpin3','Eagle Pass','ridge-switch2','ridge-switch3','ridge',-120,100],['ridge-hairpin4','Eagle Pass','ridge-switch3','ridge-switch4','ridge',100,100],
      ['ridge-summit','Eagle Pass','ridge-switch4','eagle-peak','ridge',-100,100],['vista-road','Vista Point Road','ridge-switch2','vista','ridge',-40,100],
      ['pine-road','Pine Ridge Road','eagle-peak','pine-ridge','ridge',-100,100],
      ['willow-approach','Northside Parkway','north','willow-trail','willow',30,110],['willow-entry-road','Northside Parkway','willow-trail','willow-entry','willow',40,110],
      ['willow-green-road','Willow Crescent','willow-entry','willow-green','willow',-60,100],['willow-west-road','Willow Crescent','willow-green','willow-bend','willow',45,100],
      ['willow-lake-road','Lake Crescent','willow-bend','willow-lake','willow',60,100],['willow-bottom-road','Lake Crescent','willow-lake','willow-end','willow',-80,100],
      ['willow-east-road','Foxglove Drive','willow-end','willow-east','willow',60,100],['willow-top-road','Foxglove Drive','willow-east','willow-top','willow',-50,100],
      ['willow-loop-road','Willow Crescent','willow-top','willow-entry','willow',70,100],['willow-cross-road','Lavender Lane','willow-green','willow-top','willow',-40,100],
      ['willow-court-road','Willow Court','willow-bend','willow-court','willow',30,90],['birch-road','Birch Court','willow-lake','birch-court','willow',-30,90],
      ['elm-road','Elm Court','willow-east','elm-court','willow',30,90],['fern-road','Fern Court','willow-entry','fern-court','willow',-30,90],
      ['pine-northside','Pine Ridge Road','pine-ridge','willow-bend','ridge',-60,100],
      ['bridge-north-approach','River Parkway','willow-end','bridge-north-west','willow',-25,110],
      ['bridge-north','North River Bridge','bridge-north-west','bridge-north-east','willow',0,120],
      ['bridge-city-approach','Airport Express','eastmarket','bridge-city-west','market',-40,120],
      ['bridge-city','Downtown River Bridge','bridge-city-west','bridge-city-east','market',0,120],
      ['airport-north-link','Airport Road','bridge-north-east','orchard-gate','orchard',40,110],['apple-road','Airport Perimeter','orchard-gate','apple','orchard',-40,110],
      ['orchard-east-road','Airport Perimeter','apple','orchard-east','orchard',45,110],['orchard-pond-road','Airport Perimeter','orchard-east','orchard-pond','orchard',15,110],
      ['orchard-south-road','Airport Perimeter','orchard-pond','orchard-south','orchard',65,110],['orchard-west-road','Airport Perimeter','orchard-south','orchard-west','orchard',-40,110],
      ['orchard-green-road','Terminal Avenue','orchard-west','orchard-green','orchard',-45,110],['airport-city-link','Terminal Avenue','bridge-city-east','orchard-green','orchard',0,110],
      ['orchard-center-road','Terminal Avenue','orchard-green','orchard-center','orchard',-30,110],['airport-terminal-road','Terminal Avenue','orchard-center','orchard-gate','orchard',40,110],
      ['marsh-approach','Tidewell Trail','orchard-south','marsh-gate','marsh',0,100],['marsh-road','Tidewell Trail','marsh-gate','marsh-lookout','marsh',0,90],
      ['marsh-east-road','Wetlands Road','marsh-gate','marsh-east','marsh',50,90]
    ]) road(...spec);
    for(const street of roads) if(street.id==='bridge-north'||street.id==='bridge-city') street.bridge=true;
    const network = new RoadNetwork(roads, nodes);
    // Face the workshop's open north face toward Container Road. The entire
    // building sits behind the sidewalk; its forecourt joins the road edge.
    const repairApproach=network.pointOnRoad('yard-road',600),repairAngle=wrap(repairApproach.angle+Math.PI);
    const repairPoint={x:repairApproach.x-Math.sin(repairAngle)*270,y:repairApproach.y+Math.cos(repairAngle)*270};
    const repairLot={x:repairPoint.x-116,y:repairPoint.y-136,w:232,h:272,angle:repairAngle};
    const driveCentre={x:repairApproach.x-Math.sin(repairAngle)*146,y:repairApproach.y+Math.cos(repairAngle)*146};
    const repairDriveway={x:driveCentre.x-100,y:driveCentre.y-108,w:200,h:216,angle:repairAngle};
    const repairGarage={kind:'garage',serviceId:'repair',...repairPoint,angle:repairAngle,district:'works',lot:repairLot,driveway:repairDriveway,parts:[
      {shape:'box',offset:[-4.8,2.5,0],half:[.2,2.5,5.6],color:'#71aaa5'},
      {shape:'box',offset:[4.8,2.5,0],half:[.2,2.5,5.6],color:'#71aaa5'},
      {shape:'box',offset:[0,2.5,5.8],half:[5,2.5,.2],color:'#71aaa5'},
      {shape:'box',offset:[-4,2,-5.8],half:[1,2,.2],color:'#e8dfc9'},
      {shape:'box',offset:[4,2,-5.8],half:[1,2,.2],color:'#e8dfc9'},
      {shape:'box',offset:[0,4.5,-5.8],half:[5,.5,.2],color:'#e8dfc9'},
      {shape:'box',offset:[0,5.15,0],half:[5.4,.15,6.4],color:'#4d6872'},
      {shape:'box',offset:[0,.5,5],half:[2.4,.5,.5],color:'#596c7a'},
      {shape:'box',offset:[3.9,1,4.9],half:[.55,1,.6],color:'#d57e68'}
    ]};
    const services = [{id:'garage',x:6000,y:3500,label:'Sprinkle Garage'},
      {id:'repair',...repairPoint,angle:repairAngle,label:'Cool-Down Garage · $75',mapLabel:'REPAIRS',bay:{halfWidth:88,halfDepth:82}}];
    const start={player:{x:5984,y:3700,angle:-Math.PI/2},car:{x:6016,y:3700,angle:-Math.PI/2,kind:'compact',color:'#ffd15b'}};
    const areas=[
      ['heights',[[3200,2700],[5300,2700],[5550,4200],[4500,4400],[3150,3800]]],
      ['works',[[6500,4800],[8200,4650],[8900,6500],[7600,6800],[6400,6200]]],
      ['market',[[5300,2800],[7100,2900],[8220,3700],[8150,4800],[6000,4850],[5200,4300]]],
      ['riverfront',[[2250,3800],[4300,3900],[5600,4550],[4450,6370],[3250,6200],[2500,5150]]],
      ['willow',[[5950,700],[8350,500],[9000,2000],[8400,2800],[6100,2880]]],
      ['orchard',[[9700,1250],[11500,1250],[11800,4600],[11000,5550],[9800,5500],[9400,3600]]],
      ['ridge',[[800,700],[4650,300],[6150,1000],[5800,2200],[3300,2650],[950,2200]]],
      ['marsh',[[9750,5600],[11800,5500],[11850,7050],[9700,7050]]]
    ].map(([district,vertices])=>({id:'area-'+district,district,mapColor:DISTRICTS[district].mapColor,points:vertices.map(([x,y])=>({x,y}))}));
    const railway=Railway.createRailway();
    Railway.crossings(railway,roads);
    const buildings = [], blocks = [], staticObjects = [];
    const targets = { heights: 26, works: 24, market: 42, riverfront: 16, willow: 42, orchard: 8, ridge:4, marsh:0 };
    const counts = Object.fromEntries(Object.keys(targets).map(id => [id, 0]));
    const styles = { heights:'cottage',works:'warehouse',market:'shop',riverfront:'cafe',willow:'cottage',orchard:'hangar',ridge:'cottage',marsh:'cottage' };
    const names = { heights:['Scone House','Crumb Cottage','Old Market House'],works:['Waffle Works','Fudge Factory','Disco Depot'],market:['Biscuit Bank','The Noodle Hut','Bean Palace','Sprinkle Shop'],riverfront:['Crumb Café','The Boathouse','Beach Snacks'],willow:['Willow House','Foxglove Cottage','Lavender Lodge'],orchard:['Sprinkle Hangar','Confetti Air Terminal','Biscuit Air Cargo'],ridge:['Eagle Lodge','Pine Chalet'],marsh:['Tidewell Lodge'] };
    const villageGreens=[{id:'willow-village-green',district:'willow',x:7460,y:2070,w:280,h:260},
      {id:'downtown-green',district:'market',x:6230,y:4080,w:200,h:150}];
    // Aircraft use the same world coordinates as roads (20 units per metre).
    // The 20-metre runway, continuous taxi loop and generous stand spacing fit
    // the small aircraft without wings crossing parked neighbors or buildings.
    const airport={id:'meadows-airport',label:'Meadows Airport',departureThresholdId:'runway-south',
      runways:[{id:'airport-runway',x:10860,y:2300,w:400,h:2200,angle:0,role:'runway',
        thresholds:[{id:'runway-north',x:11060,y:2440,angle:Math.PI/2},{id:'runway-south',x:11060,y:4360,angle:-Math.PI/2}]}],
      taxiways:[{id:'airport-taxiway',x:10670,y:2440,w:150,h:2060,angle:0,role:'taxiway'},
        {id:'airport-taxiway-north',x:10745,y:2440,w:315,h:150,angle:0,role:'taxiway'},
        {id:'airport-taxiway-south',x:10745,y:4285,w:315,h:150,angle:0,role:'taxiway'}],
      aprons:[{id:'airport-apron',x:10310,y:2840,w:530,h:2000,angle:0,role:'apron'},
        {id:'airport-visiting-apron',x:10310,y:1870,w:530,h:970,angle:0,role:'apron'},
        {id:'airport-air-taxi-apron',x:10025,y:4090,w:285,h:260,angle:0,role:'apron'},
        {id:'airport-storage-apron',x:10135,y:4350,w:420,h:720,angle:0,role:'apron'}],
      walkways:[{id:'airport-pedestrian-access',x:10200,y:3388,w:70,h:24,angle:0,role:'walkway'},
        {id:'airport-pedestrian-bend',x:10258,y:3400,w:24,h:212,angle:0,role:'walkway'},
        {id:'airport-pedestrian-boarding',x:10270,y:3600,w:170,h:24,angle:0,role:'walkway'}],
      pedestrianRoute:[{x:10200,y:3400},{x:10270,y:3400},{x:10270,y:3612},{x:10440,y:3612}],
      helipads:[{id:'airport-helipad',label:'AIR TAXI',x:10435,y:3730,radius:110,aircraftType:'helicopter'},
        {id:'news-helipad',label:'MEADOWS NEWS',x:10435,y:3980,radius:110,aircraftType:'news'},
        {id:'police-helipad',label:'POLICE AIR',x:10405,y:4230,radius:110,aircraftType:'policeheli'},
        {id:'air-taxi-return',label:'AIR TAXI ARRIVALS',x:10160,y:4220,radius:115,aircraftType:'helicopter',airTaxi:true,noSpawn:true}],
      stands:[{id:'trainer-1',label:'TRAINER 1',x:10485,y:2900,angle:0,type:'plane',kind:'trainer',aircraftType:'trainer'},
        {id:'trainer-2',label:'TRAINER 2',x:10485,y:3140,angle:0,type:'plane',kind:'trainer',aircraftType:'trainer'},
        {id:'commuter-1',label:'COMMUTER',x:10430,y:3430,angle:0,type:'plane',kind:'commuter',aircraftType:'commuter'}],
      militaryStands:[{id:'military-heli-visitor',label:'VISITING HEAVY LIFT',x:10550,y:2110,angle:0,radius:190,
        type:'helicopter',kind:'transportheli',aircraftType:'transportheli'},
        {id:'military-fighter-visitor',label:'VISITING JET',x:10450,y:2600,angle:-Math.PI/2,
          type:'plane',kind:'fighter',aircraftType:'fighter'}],
      storageStands:[{id:'airport-storage-1',label:'HANGAR RESERVE 1',x:10330,y:4530,angle:0,type:'any',noSpawn:true},
        {id:'airport-storage-2',label:'HANGAR RESERVE 2',x:10330,y:4890,angle:0,type:'any',noSpawn:true}],
      taxiNodes:[{id:'taxi-north',x:10745,y:2515},{id:'taxi-apron',x:10745,y:3670},
        {id:'taxi-south',x:10745,y:4360},{id:'runway-entry',x:11060,y:4360}],
      approachCorridors:[{id:'airport-approach',x:10840,y:200,w:440,h:5700,angle:0,role:'approach'}]};
    for(const pad of airport.helipads)Object.assign(pad,{w:pad.radius*2,h:pad.radius*2,angle:0});
    airport.taxiRoutes=[...airport.stands,...airport.militaryStands.filter(stand=>stand.type==='plane')].map(stand=>({id:'taxi-'+stand.id,standId:stand.id,thresholdId:'runway-south',
      points:[{x:stand.x,y:stand.y},{x:10745,y:stand.y},{x:10745,y:4360},{x:11060,y:4360,angle:-Math.PI/2}]}));
    const townHelipads=[{id:'marina-helipad',label:'MARINA AIR TAXI',x:3040,y:4740,radius:110,w:220,h:220,angle:0},
      {id:'downtown-rooftop',label:'DOWNTOWN SKYPORT',x:7070,y:4470,radius:100,w:200,h:200,angle:0,rooftop:true,buildingId:'aviation-rooftop-building'}];
    const rooftopLot={x:6930,y:4330,w:280,h:280,angle:0};
    const padBox=pad=>({x:pad.x-pad.radius,y:pad.y-pad.radius,w:pad.radius*2,h:pad.radius*2,angle:pad.angle||0});
    const marinaRoad=network.nearestRoad(townHelipads[0]);
    townHelipads[0].accessRoute=[{x:marinaRoad.x,y:marinaRoad.y},{x:3040,y:4740}];
    const marinaAccessLength=distance(townHelipads[0],marinaRoad),marinaAccessAngle=heading(townHelipads[0],marinaRoad);
    const marinaAccess={x:(3040+marinaRoad.x-marinaAccessLength)/2,y:(4740+marinaRoad.y)/2-26,w:marinaAccessLength,h:52,angle:marinaAccessAngle,role:'walkway'};
    const protectedPads=[...airport.runways,...airport.taxiways,...airport.aprons,...airport.walkways,
      ...airport.approachCorridors,rooftopLot,padBox(townHelipads[0]),marinaAccess,repairLot,repairDriveway];
    const onLand=point=>point.x>=100&&point.y>=100&&point.x<=MAP_WIDTH-100&&point.y<=MAP_HEIGHT-100&&!HeightData.isWaterRaw(point.x,point.y,MAP_WIDTH,MAP_HEIGHT);
    // Sample whole oriented footprints, including their interiors: a building
    // must never straddle a narrow water channel hidden between its corners.
    const landBox=box=>{
      const angle=box.angle||0,c=Math.cos(angle),s=Math.sin(angle),cx=box.x+box.w/2,cy=box.y+box.h/2;
      const nx=Math.max(1,Math.ceil(box.w/24)),ny=Math.max(1,Math.ceil(box.h/24));
      for(let i=0;i<=nx;i++) for(let j=0;j<=ny;j++) {
        const x=box.w*(i/nx-.5),y=box.h*(j/ny-.5);
        if(!onLand({x:cx+x*c-y*s,y:cy+x*s+y*c})) return false;
      }
      return true;
    };
    const reserved = [...services.map(service => ({ ...service, radius: 128 })), { x:start.car.x,y:start.car.y,radius:95 },
      ...villageGreens.map(green=>({x:green.x,y:green.y,radius:Math.hypot(green.w,green.h)/2}))];
    const roadClear = (box, extra = SIDEWALK_WIDTH + 8) => !roads.some(street => {
      const corners = footprintCorners(box, street.width / 2 + extra);
      const minX = Math.min(...corners.map(p => p.x)), maxX = Math.max(...corners.map(p => p.x)), minY = Math.min(...corners.map(p => p.y)), maxY = Math.max(...corners.map(p => p.y));
      for (let i = 0; i < street.points.length - 1; i++) {
        const a = street.points[i], b = street.points[i + 1];
        if (Math.max(a.x,b.x) < minX || Math.min(a.x,b.x) > maxX || Math.max(a.y,b.y) < minY || Math.min(a.y,b.y) > maxY) continue;
        if (segmentBoxDistance(a, b, box) < street.width / 2 + extra) return true;
      }
      return false;
    });
    const addLot = (street, s, side) => {
      const district = street.district;
      if (street.bridge||counts[district] >= targets[district]) return false;
      const suburban = DISTRICTS[district].suburban;
      const ranges = district === 'orchard'?[190,260,140,200]:district === 'works' ? [154,216,96,150] : district === 'market' ? [62,96,84,120]
        : suburban ? [94,138,84,116] : [78,124,76,108];
      const w = ranges[0] + random() * (ranges[1] - ranges[0]), h = ranges[2] + random() * (ranges[3] - ranges[2]);
      const along = network.pointOnRoad(street.id, s), setback = street.width / 2 + SIDEWALK_WIDTH + h / 2 + (suburban ? 34 + random() * 60 : 18 + random() * 22);
      const nx = -Math.sin(along.angle) * side, ny = Math.cos(along.angle) * side;
      const cx = along.x + nx * setback, cy = along.y + ny * setback, angle = wrap(along.angle + (side > 0 ? Math.PI : 0));
      const box = { x: cx - w / 2, y: cy - h / 2, w, h, angle };
      const margin=suburban?40:18,lot={x:box.x-margin,y:box.y-margin,w:w+margin*2,h:h+margin*2,angle};
      if (!landBox(lot)||Railway.intersectsBox(railway,lot,35)||railway.pads.some(pad=>boxesOverlap(lot,pad,12))||protectedPads.some(pad=>boxesOverlap(lot,pad,12))||
        !roadClear(box) || buildings.some(other => boxesOverlap(box, other, 12)) || reserved.some(point => distance(point, {x:cx,y:cy}) < point.radius + Math.hypot(w,h)/2)) return false;
      const number = counts[district]++, id = 'lot-' + district + '-' + number;
      const height = district === 'works' ? 5 + random() * 3 : district === 'market' ? 4.6 + random() * 4.7 : 3.4 + random() * 2.1;
      const building = { ...box, id: id + '-building', blockId: id, district, style: styles[district], height,
        frontAngle: wrap(angle + Math.PI/2), roadId: street.id, roadS: s, color: COLORS[(number + Object.keys(targets).indexOf(district)) % COLORS.length],
        name: names[district][number % names[district].length] };
      if (district === 'market' && number === 2) { building.style = 'tower'; building.height = 13.4; building.name = 'Biscuit Clocktower'; }
      if(district==='orchard') {
        building.height=number===1?12:6.2+random()*2;
        building.style=number===1?'control-tower':number===2?'terminal':'hangar';
        building.name=number===1?'Confetti Air Control':number===2?'Confetti Air Terminal':'Sprinkle Hangar '+(number+1);
        if(number===1) {building.name='Confetti Air Control';building.w=80;building.h=80;building.x=cx-40;building.y=cy-40;}
      }
      buildings.push(building);
      const frontX = -Math.sin(angle), frontY = Math.cos(angle), drivewayLength = Math.max(12, setback - building.h/2 - street.width/2 - SIDEWALK_WIDTH);
      const driveway = { x:cx+frontX*(building.h/2+drivewayLength/2)-18, y:cy+frontY*(building.h/2+drivewayLength/2)-drivewayLength/2,
        w:36, h:drivewayLength, angle };
      blocks.push({ ...lot, id, district, kind: suburban || district === 'heights' ? 'garden' : district === 'works' ? 'yard' : district === 'market' ? 'shops' : 'cafe',
        landUse: suburban ? 'residential' : district, mapColor: DISTRICTS[district].mapColor, points: footprintCorners(lot), buildings:[building],
        garden: { ...lot }, courtyard: null, driveway, density:w*h/(lot.w*lot.h) });
      return true;
    };
    // First fill every neighborhood along actual frontage, then fill rejected
    // gaps with a shifted pass. Suburban spacing is much looser than the market.
    // Concentrate frontage in each region's actual center. Approaches remain
    // quieter, the airport buildings line the terminal, and the mountain's few
    // lodges sit above town instead of becoming another urban strip.
    const preferredFronts=['old-west','old-loop','old-garden','heights-lane','garden-lane',
      'warehouse-road','works-road','clay-road','yard-road',
      'beach-road','marina-approach','marina-west-road','marina-south-road','marina-pier','beach-walk',
      'ridge-summit','vista-road','pine-road',
      'orchard-center-road','airport-terminal-road','orchard-green-road'];
    const lotStreets=[...preferredFronts.map(id=>network.roadById.get(id)),...roads.filter(street=>!preferredFronts.includes(street.id))];
    for (let pass = 0; pass < 6; pass++) for (const street of lotStreets) {
      const spacing = street.district === 'market' ? 116 : street.district === 'works' ? 210 : DISTRICTS[street.district].suburban ? 230 : 155;
      for (let s = 125 + pass * spacing / 6; s < street.length - 110; s += spacing) {
        addLot(street, s, pass % 2 ? -1 : 1); addLot(street, s + 40, pass % 2 ? 1 : -1);
      }
    }
    // A broad, flat roof gives helicopter jobs a genuine landing destination.
    // Keep it in the shared building list so collision and camera occlusion use
    // exactly the same physical roof that the aircraft pilot sees.
    const rooftopFront=network.nearestRoad(townHelipads[1]);
    const rooftopBuilding={id:'aviation-rooftop-building',blockId:'aviation-rooftop',district:'market',
      x:6950,y:4350,w:240,h:240,angle:0,height:14,style:'office',color:'#90b9c5',name:'Meadows Skyport',
      roadId:rooftopFront.roadId,roadS:rooftopFront.s,frontAngle:Math.PI/2};
    buildings.push(rooftopBuilding);
    blocks.push({...rooftopLot,id:'aviation-rooftop',district:'market',kind:'shops',landUse:'market',
      mapColor:DISTRICTS.market.mapColor,points:footprintCorners(rooftopLot),buildings:[rooftopBuilding],
      garden:{...rooftopLot},courtyard:null,driveway:{x:7050,y:4590,w:40,h:20,angle:0},density:240*240/(280*280)});
    for(const building of railway.buildings) {
      const point=network.nearestRoad({x:building.x+building.w/2,y:building.y+building.h/2});
      building.blockId=building.id+'-lot';building.roadId=point.roadId;building.roadS=point.s;
      building.angle=point.y<building.y+building.h/2?Math.PI:0;
      building.frontAngle=wrap(building.angle+Math.PI/2);
      buildings.push(building);
      const lot={id:building.blockId,district:'works',x:building.x-25,y:building.y-25,w:building.w+50,h:building.h+50,angle:0,kind:'yard',mapColor:'#b8c7cd',buildings:[building],density:building.w*building.h/((building.w+50)*(building.h+50))};
      lot.points=footprintCorners(lot);lot.driveway={x:building.x,y:building.y-20,w:40,h:20,angle:0};blocks.push(lot);
    }
    const propBox = (x,y,w,h,angle=0) => ({x:x-w/2,y:y-h/2,w,h,angle});
    const decorationClear=box=>landBox(box)&&!Railway.intersectsBox(railway,box,30)&&!railway.pads.some(pad=>boxesOverlap(box,pad,8))&&!protectedPads.some(pad=>boxesOverlap(box,pad,8))&&roadClear(box,SIDEWALK_WIDTH+8)&&!buildings.some(building=>boxesOverlap(box,building,8));
    const propClear = box => decorationClear(box) &&
      !reserved.some(point => distance(point,{x:box.x+box.w/2,y:box.y+box.h/2}) < point.radius + Math.hypot(box.w,box.h)/2);
    const addProp = object => {
      object.id='prop-'+staticObjects.length;
      object.destructible=object.kind!=='garage';
      if(object.destructible) object.health=object.maxHealth=PROP_HEALTH[object.kind]||45;
      staticObjects.push(object);return object;
    };
    for (const block of blocks) {
      const building = block.buildings[0], cx=building.x+building.w/2,cy=building.y+building.h/2,angle=building.angle;
      const front={x:-Math.sin(angle),y:Math.cos(angle)};
      if (DISTRICTS[block.district].suburban && Number(block.id.split('-').at(-1)) % 2 === 0) {
        const x=cx-front.x*(building.h/2+25),y=cy-front.y*(building.h/2+25),w=building.w+30;
        if (propClear(propBox(x,y,w,7,angle))) addProp({kind:'fence',x,y,angle,district:block.district,parts:[{shape:'box',offset:[0,.48,0],half:[w/40,.48,.175],color:'#e7ddbd'}]});
      }
      const side={x:Math.cos(angle),y:Math.sin(angle)},tx=cx+side.x*(building.w/2+32)-front.x*18,ty=cy+side.y*(building.w/2+32)-front.y*18;
      if (propClear(propBox(tx,ty,12,12))) addProp({kind:'tree',x:tx,y:ty,angle:0,district:block.district,scale:DISTRICTS[block.district].suburban?1.18:.9,variety:Math.floor(random()*3),parts:[{shape:'cylinder',offset:[0,.98,0],half:[.17,.98,.17]}]});
    }
    const garageKiosk = {kind:'garage',x:6120,y:3485,angle:0,district:'market',parts:[{shape:'box',offset:[0,.9,0],half:[.95,.9,.65]},{shape:'box',offset:[0,1.88,0],half:[1.05,.09,.75]}]};
    addProp(garageKiosk);
    addProp(repairGarage);
    for(const id of ['heights-lane','clock-street','eastmarket-road','southgate-road','willow-west-road','willow-top-road','apple-road','orchard-green-road','ridge-low-road']) {
      const street=network.roadById.get(id),point=network.pointOnRoad(id,street.length*.55,street.width/2+SIDEWALK_WIDTH+16);
      if(propClear(propBox(point.x,point.y,20,8,point.angle))) addProp({kind:'lamp',x:point.x,y:point.y,angle:point.angle,district:street.district,parts:[
        {shape:'cylinder',offset:[0,1.4,0],half:[.07,1.4,.07]}, {shape:'box',offset:[.3,2.85,0],half:[.35,.06,.10]},
        {shape:'box',offset:[.56,2.77,0],half:[.13,.055,.09],color:'#fcf1be'}]});
    }
    for(const green of villageGreens) {
      if(decorationClear(propBox(green.x,green.y,60,60))) addProp({kind:'fountain',x:green.x,y:green.y,angle:0,district:green.district,parts:[
        {shape:'cylinder',offset:[0,.3,0],half:[1.5,.3,1.5]}, {shape:'cylinder',offset:[0,.98,0],half:[.15,.65,.15]}]});
      for(const side of [-1,1]) if(decorationClear(propBox(green.x+side*68,green.y+45,32,11)))
        addProp({kind:'bench',x:green.x+side*68,y:green.y+45,angle:0,district:green.district,parts:[
          {shape:'box',offset:[0,.48,0],half:[.78,.055,.22]}, {shape:'box',offset:[0,.78,.18],half:[.78,.24,.055]},
          {shape:'box',offset:[-.55,.23,0],half:[.055,.23,.055]}, {shape:'box',offset:[.55,.23,0],half:[.055,.23,.055]}]});
      const nearby=network.nearestRoad(green),sign=network.pointOnRoad(nearby.roadId,nearby.s,nearby.width/2+SIDEWALK_WIDTH+24);
      if(decorationClear(propBox(sign.x,sign.y,18,7,sign.angle)))
        addProp({kind:'wayfinding',label:DISTRICTS[green.district].name.toUpperCase(),x:sign.x,y:sign.y,angle:sign.angle,district:green.district,parts:[
          {shape:'box',offset:[0,.65,0],half:[.045,.65,.045]}, {shape:'box',offset:[0,1.3,0],half:[.5,.2,.06]}]});
    }
    const pedPaths = [];
    for (const street of roads) {
      if (street.bridge||street.length < 200 || pedPaths.filter(path=>path.district===street.district).length >= (DISTRICTS[street.district].suburban ? 4 : 5)) continue;
      const startS=75,endS=street.length-75, offset=street.width/2+SIDEWALK_WIDTH*.55;
      const candidates=[];
      for(let s=startS;s<endS;s+=25) candidates.push(network.pointOnRoad(street.id,s,offset));
      candidates.push(network.pointOnRoad(street.id,endS,offset));
      // At an acute junction a sidewalk can enter another street well beyond
      // the nominal junction inset. Keep the longest fully clear run, testing
      // every walking leg against all road ribbons with room for a whole NPC.
      let best=[],run=[];
      const radius=6.02+2;
      for(const candidate of candidates) {
        const pointClear=landBox({x:candidate.x-radius,y:candidate.y-radius,w:radius*2,h:radius*2})&&roadClear({x:candidate.x,y:candidate.y,w:0,h:0},radius);
        if(!pointClear) { if(run.length>best.length) best=run; run=[]; continue; }
        if(run.length) {
          const previous=run.at(-1),length=distance(previous,candidate),cx=(previous.x+candidate.x)/2,cy=(previous.y+candidate.y)/2;
          if(!landBox({x:cx-length/2,y:cy-radius,w:length,h:radius*2,angle:heading(previous,candidate)})||!roadClear({x:cx-length/2,y:cy,w:length,h:0,angle:heading(previous,candidate)},radius)) {
            if(run.length>best.length) best=run; run=[];
          }
        }
        run.push(candidate);
      }
      if(run.length>best.length) best=run;
      if(best.length<3) continue;
      pedPaths.push({id:'sidewalk-'+street.id,roadId:street.id,district:street.district,points:best,closed:false,count:DISTRICTS[street.district].suburban?2:3});
    }
    const vehicleSpawns=[];
    for(let i=0;i<roads.length;i++) {
      const street=roads[i];
      if(street.bridge||street.length<220 || i%3!==1||vehicleSpawns.length>=27) continue;
      const point=network.pointOnRoad(street.id,street.length*.53,i%2?18:-18);
      if(distance(point,start.car)<160 || services.some(service=>distance(point,service)<140)) continue;
      const spawnIndex=vehicleSpawns.length;
      vehicleSpawns.push({x:point.x,y:point.y,angle:wrap(point.angle+(i%2?0:Math.PI)),roadId:street.id,s:point.s,
        kind:['compact','sports','van'][(spawnIndex+Math.floor(spawnIndex/3))%3],color:COLORS[spawnIndex%6],traffic:spawnIndex%3!==0});
    }
    const parkingBays=[],parkedBoxes=[],parkingAccesses=[];
    const solidParts=staticObjects.flatMap(object=>object.parts.map(part=>{
      const angle=object.angle||0,c=Math.cos(angle),s=Math.sin(angle);
      const x=object.x+(part.offset[0]*c-part.offset[2]*s)*20,y=object.y+(part.offset[0]*s+part.offset[2]*c)*20;
      return {bottom:part.offset[1]-part.half[1],box:{x:x-part.half[0]*20,y:y-part.half[2]*20,w:part.half[0]*40,h:part.half[2]*40,angle}};
    }));
    const dimensions={compact:{length:46,width:27},sports:{length:49,width:28},van:{length:55,width:32}};
    for(const spawn of vehicleSpawns.filter(spawn=>!spawn.traffic)) {
      const originalStreet=network.roadById.get(spawn.roadId),type=dimensions[spawn.kind],middle=network.pointOnRoad(originalStreet.id,spawn.s);
      const initialSide=(spawn.x-middle.x)*-Math.sin(middle.angle)+(spawn.y-middle.y)*Math.cos(middle.angle)>0?1:-1;
      const streets=[originalStreet,...roads.filter(road=>!road.bridge&&road!==originalStreet&&road.district===originalStreet.district)
        .sort((a,b)=>distance(network.pointOnRoad(a.id,a.length/2),middle)-distance(network.pointOnRoad(b.id,b.length/2),middle))];
      let placement=null;
      for(const street of streets) for(const shift of [0,-50,50,-100,100,-150,150,-200,200]) for(const side of [initialSide,-initialSide]) for(const extra of [0,18,36,54]) {
        if(placement) break;
        const s=clamp((street===originalStreet?spawn.s:street.length/2)+shift,60,street.length-60),offset=side*(street.width/2+SIDEWALK_WIDTH+type.width/2+12+extra);
        const point=network.pointOnRoad(street.id,s,offset),angle=wrap(point.angle+(side<0?Math.PI:0));
        const box={x:point.x-type.length/2,y:point.y-type.width/2,w:type.length,h:type.width,angle};
        const bay={x:point.x-(type.length+10)/2,y:point.y-(type.width+10)/2,w:type.length+10,h:type.width+10,angle};
        const accessPoint=network.pointOnRoad(street.id,s),accessCentre={x:(accessPoint.x+point.x)/2,y:(accessPoint.y+point.y)/2};
        const access={x:accessCentre.x-(type.length+10)/2,y:accessCentre.y-(Math.abs(offset)+type.width+10)/2,
          w:type.length+10,h:Math.abs(offset)+type.width+10,angle:point.angle};
        if(!decorationClear(bay)||!landBox(access)||Railway.intersectsBox(railway,access,20)||
          solidParts.some(part=>part.bottom<(spawn.kind==='van'?1.7:1.3)&&boxesOverlap(bay,part.box,3))||
          parkedBoxes.some(other=>boxesOverlap(bay,other,5))||buildings.some(building=>boxesOverlap(access,building,3))||
          solidParts.some(part=>part.bottom<(spawn.kind==='van'?1.7:1.3)&&boxesOverlap(access,part.box,3))||
          parkedBoxes.some(other=>boxesOverlap(access,other,3))||parkingAccesses.some(other=>boxesOverlap(bay,other,3))) continue;
        placement={point,box,bay,angle,street,accessPoint,access};
      }
      if(!placement) throw new Error('No clear parking bay for '+spawn.roadId);
      const id='parking-'+parkingBays.length;
      Object.assign(spawn,{x:placement.point.x,y:placement.point.y,angle:placement.angle,s:placement.point.s,roadId:placement.street.id,parkingBayId:id});
      parkingBays.push({...placement.bay,id,roadId:placement.street.id,district:placement.street.district,accessPoint:placement.accessPoint,access:placement.access});
      parkedBoxes.push(placement.bay);
      parkingAccesses.push(placement.access);
    }
    const anchor=id=>({x:byId.get(id).x,y:byId.get(id).y,nodeId:id});
    const missionAnchors={
      delivery:[anchor('plaza'),anchor('ferry')],deliveryAlt:[anchor('bakery'),anchor('willow-green')],
      dash:['clock','clay','orchard-center','eagle-peak','willow-green','quay'].map(anchor),
      party:['heights','market','quay'].map(anchor),partyAlt:['depot','orchard-green','ferry'].map(anchor),
      suburbs:[anchor('willow-green'),anchor('orchard-green')],
      byName:Object.fromEntries(nodes.map(point=>[point.id,anchor(point.id)]))
    };
    const landscape={airport,helipads:townHelipads,airspace:{minX:-12000,minY:-12000,maxX:24000,maxY:20000,
        ceiling:900,cruiseAltitude:60,departureAltitude:100},greens:villageGreens,riverPath:[],hills:[],meadow:[],
      landmarks:[{id:'eagle-peak',label:'EAGLE PEAK',...anchor('eagle-peak')},{id:'vista',label:'VISTA POINT',...anchor('vista')},
        {id:'marina',label:'MARINA',...anchor('marina-gate')},{id:'marsh',label:'TIDEWELL MARSH',...anchor('marsh-lookout')}],
      beach:{x:2480,y:4520,w:280,h:420,angle:-.42},mountainRoads:roads.filter(road=>road.district==='ridge').map(road=>road.id)};
    // Append the new district after all seeded city lots, props and parking.
    // Adding the base must never consume random values or move an old street.
    const militaryBase=Military.createMilitaryBase();
    for(const [id,x,y] of militaryBase.roadNodes)node(id,x,y);
    for(const [id,name,a,b,bend,width] of militaryBase.roadLinks)road(id,name,a,b,'military',bend,width);
    // Turn before the perimeter, then cross its narrow gate perpendicular to
    // the fence. A diagonal road here would clip vans into the fence panels.
    const gateRoad=roads.find(road=>road.id==='base-gate-road'),gate=militaryBase.gate;
    const gateStart=gateRoad.points[0],gateTurn={x:gate.x,y:gate.y+160},gateControls=[{x:gateStart.x-220,y:gateStart.y-35},{x:gate.x,y:gateTurn.y+180}];
    const gateSteps=Math.ceil(3*Math.max(distance(gateStart,gateControls[0]),distance(...gateControls),distance(gateControls[1],gateTurn))/24);
    gateRoad.points=Array.from({length:gateSteps+1},(_,i)=>{const t=i/gateSteps,u=1-t;return {
      x:u*u*u*gateStart.x+3*u*u*t*gateControls[0].x+3*u*t*t*gateControls[1].x+t*t*t*gateTurn.x,
      y:u*u*u*gateStart.y+3*u*u*t*gateControls[0].y+3*u*t*t*gateControls[1].y+t*t*t*gateTurn.y};})
      .concat(sampleCurve(gateTurn,byId.get('base-gate')).slice(1));
    const expandedNetwork=new RoadNetwork(roads,nodes);
    for(const building of militaryBase.buildings) {
      // The Blender models place doors on their north face. Hangars open to
      // the flight apron; the compound buildings face the road to the south.
      building.angle=building.militaryModel==='hangar'?0:building.militaryModel==='gatehouse'?-Math.PI/2:Math.PI;
      const front=expandedNetwork.nearestRoad({x:building.x+building.w/2,y:building.y+building.h/2});
      building.blockId=building.id+'-lot';building.roadId=front.roadId;building.roadS=front.s;
      building.frontAngle=wrap(building.angle-Math.PI/2);
      if(building.militaryModel==='hangar')building.frontagePoint={x:building.x+building.w/2,y:building.y-50};
      buildings.push(building);
      const lot={id:building.blockId,district:'military',x:building.x-40,y:building.y-40,w:building.w+80,h:building.h+80,angle:0,
        kind:'military',landUse:'military',mapColor:DISTRICTS.military.mapColor,buildings:[building],density:building.w*building.h/((building.w+80)*(building.h+80)),
        driveway:{x:building.x+building.w/2-25,y:building.y+building.h,w:50,h:40,angle:0}};
      lot.points=footprintCorners(lot);blocks.push(lot);
    }
    for(const spawn of militaryBase.vehicleSpawns) {
      const front=expandedNetwork.nearestRoad(spawn),id=spawn.id+'-parking',w=65,h=42;
      Object.assign(spawn,{roadId:front.roadId,s:front.s,parkingBayId:id});vehicleSpawns.push(spawn);
      const center={x:(front.x+spawn.x)/2,y:(front.y+spawn.y)/2},length=distance(front,spawn),angle=heading(front,spawn);
      parkingBays.push({id,x:spawn.x-w/2,y:spawn.y-h/2,w,h,angle:spawn.angle,district:'military',roadId:front.roadId,
        accessPoint:{x:front.x,y:front.y,roadId:front.roadId,s:front.s},access:{x:center.x-length/2-35,y:center.y-35,w:length+70,h:70,angle}});
    }
    for(const path of militaryBase.pedestrianPaths)pedPaths.push({...path,points:path.points.map(p=>({...p})),closed:true,count:3});
    militaryBase.fenceObjects=[];
    for(let i=1;i<militaryBase.fence.length;i++) {
      const a=militaryBase.fence[i-1],b=militaryBase.fence[i];
      if(a.y===-750&&b.y===-750&&Math.abs(a.x-b.x)===militaryBase.gate.width)continue;
      const length=distance(a,b),count=Math.ceil(length/160),angle=heading(a,b);
      for(let j=0;j<count;j++) {
        const t=(j+.5)/count,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,span=length/count;
        const object={id:'base-fence-'+i+'-'+j,kind:'military-fence',militaryRendered:true,district:'military',x,y,angle,
          destructible:false,parts:[{shape:'box',offset:[0,1.1,0],half:[span/40,1.1,.06],color:'#788578'}]};
        staticObjects.push(object);militaryBase.fenceObjects.push(object);
      }
    }
    const baseAnchor=anchor('base-inner-gate');missionAnchors.military=[baseAnchor];
    for(const [id] of militaryBase.roadNodes)missionAnchors.byName[id]=anchor(id);
    landscape.militaryBase=militaryBase;landscape.landmarks.push({id:'military',label:'NORTHWATCH AIRBASE',...baseAnchor});
    landscape.mountainRoads.push(...militaryBase.roadLinks.map(link=>link[0]));
    areas.push({id:'area-military',district:'military',mapColor:DISTRICTS.military.mapColor,points:footprintCorners(militaryBase.bounds)});
    Railway.extendNorth(railway);
    const result={size:SIZE,mapWidth:MAP_WIDTH,mapHeight:12000,mapMinY:-4000,referenceMapWidth:MAP_WIDTH,referenceMapHeight:MAP_HEIGHT,
      bounds:{...Military.BOUNDS},militaryBase,sidewalkWidth:SIDEWALK_WIDTH,districts:DISTRICTS,roads,nodes,network:expandedNetwork,buildings,blocks,lots:blocks,areas,staticObjects,services,start,spawn:start,pedPaths,vehicleSpawns,parkingBays,missionAnchors,landscape};
    result.railway=railway;
    Object.assign(railway.helipad,{label:'CENTRAL STATION',w:200,h:200,angle:0});
    (landscape.helipads??=[]).push(railway.helipad);
    for(const platform of railway.platforms) {
      const x=platform.x+platform.w/2,y=platform.y+platform.h/2,parts=[{shape:'box',offset:[0,platform.height/2,0],half:[platform.w/40,platform.height/2,platform.h/40],color:'#c5c3b3'},
        {shape:'box',offset:[1.25,2.75,0],half:[(platform.w-170)/40,.07,platform.h/40+.125],color:'#708e91'}];
      for(let at=platform.x+150;at<platform.x+platform.w-60;at+=160)parts.push({shape:'box',offset:[(at-x)/20,1.58,0],half:[.06,1.15,.06],color:'#586e76'});
      staticObjects.push({id:platform.id,kind:'rail-platform',x,y,angle:0,district:'works',destructible:false,parts});
    }
    result.terrain=Terrain.createTerrain(result);
    railway.helipad.elevation=railway.buildings[1].elevation+railway.buildings[1].height+.05;
    airport.elevation=result.terrain.surfaceHeight(11060,3400);
    for(const rect of [...airport.runways,...airport.taxiways,...airport.aprons,...airport.walkways])
      rect.elevation=result.terrain.surfaceHeight(rect.x+rect.w/2,rect.y+rect.h/2);
    for(const point of [...airport.stands,...airport.militaryStands,...airport.storageStands,...airport.helipads,...airport.pedestrianRoute,...airport.taxiNodes,...airport.runways[0].thresholds,...townHelipads]) {
      const building=point.buildingId&&buildings.find(building=>building.id===point.buildingId);
      point.elevation=building?building.elevation+building.height+.05:result.terrain.surfaceHeight(point.x,point.y);
    }
    for(const route of airport.taxiRoutes)for(const point of route.points)point.elevation=result.terrain.surfaceHeight(point.x,point.y);
    militaryBase.elevation=result.terrain.surfaceHeight(militaryBase.runways[0].x+militaryBase.runways[0].w/2,militaryBase.runways[0].y+militaryBase.runways[0].h/2);
    for(const rect of [...militaryBase.runways,...militaryBase.taxiways,...militaryBase.aprons,militaryBase.motorPool])rect.elevation=result.terrain.surfaceHeight(rect.x+rect.w/2,rect.y+rect.h/2);
    for(const point of [...militaryBase.stands,...militaryBase.storageStands,...militaryBase.helipads,...militaryBase.runways.flatMap(r=>r.thresholds)])point.elevation=result.terrain.surfaceHeight(point.x,point.y);
    for(const pad of militaryBase.helipads)Object.assign(pad,{w:pad.radius*2,h:pad.radius*2,angle:0});
    for(const route of [...militaryBase.taxiRoutes,...militaryBase.arrivalTaxiRoutes,...militaryBase.pedestrianPaths])for(const point of route.points)point.elevation=result.terrain.surfaceHeight(point.x,point.y);
    for(const path of pedPaths.filter(p=>p.district==='military'))for(const point of path.points)point.elevation=result.terrain.surfaceHeight(point.x,point.y);
    militaryBase.gate.elevation=result.terrain.surfaceHeight(militaryBase.gate.x,militaryBase.gate.y);
    return result;
  }

  const api={SIZE,MAP_WIDTH,MAP_HEIGHT,SIDEWALK_WIDTH,DISTRICTS,PROP_HEALTH,districtAt,footprintCorners,boxesOverlap,segmentHitsBox,segmentBoxDistance,RoadNetwork,createWorld};
  root.MayhemWorld=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(globalThis);
