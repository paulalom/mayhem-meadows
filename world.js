/* One road graph owns Mayhem Meadows' city, suburbs, routes, and lot placement. */
(function (root) {
  'use strict';
  const SIZE = 5600, SIDEWALK_WIDTH = 32;
  const DISTRICTS = Object.freeze({
    heights: Object.freeze({ id: 'heights', name: 'Biscuit Heights', color: '#bcd2ae', mapColor: '#bcd2ae' }),
    works: Object.freeze({ id: 'works', name: 'Waffle Works', color: '#b8c7cd', mapColor: '#b8c7cd' }),
    market: Object.freeze({ id: 'market', name: 'Market Mile', color: '#d9c6b6', mapColor: '#d9c6b6' }),
    riverfront: Object.freeze({ id: 'riverfront', name: 'Riverfront', color: '#b7d5c7', mapColor: '#b7d5c7' }),
    willow: Object.freeze({ id: 'willow', name: 'Willow Gardens', color: '#a9c99f', mapColor: '#a9c99f', suburban: true }),
    orchard: Object.freeze({ id: 'orchard', name: 'Orchard Park', color: '#d2d6ac', mapColor: '#d2d6ac', suburban: true })
  });
  const COLORS = ['#ffd15b', '#fb8097', '#67d3c8', '#a6a0fa', '#90c66b', '#6fb5eb'];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const heading = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  function districtAt(point, y) {
    const x = typeof point === 'number' ? point : point.x;
    y = typeof point === 'number' ? y : point.y;
    return DISTRICTS[y > 2850 && x < 2950 ? 'willow' : x > 2900 ? 'orchard'
      : y > 1860 ? 'riverfront' : x > 1530 && y < 1560 ? 'works'
        : y > 1150 || x > 1050 ? 'market' : 'heights'];
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
          index: i, t, distance: d, width: road.width, s: road.arc[i] + Math.sqrt(length2) * t };
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
        angle, roadId: id, road, s, width: road.width, index: i, t };
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
      ['north',900,480],['bakery',900,720],['garage',900,900],['spawn',900,1080],['plaza',900,1320],
      ['clock',1260,620],['warehouse',1710,500],['worksyard',2080,770],['clay',2420,1160],
      ['arcade',1280,1270],['depot',1660,1010],['eastmarket',1740,1480],['canal',2240,1650],
      ['heights',620,650],['westgate',470,1030],['garden',540,1410],['outer',420,1770],
      ['market',1000,1610],['creek',620,1900],['southgate',840,2340],['riverbend',1270,2050],['ferry',1940,2050],['quay',1680,2400],
      ['willow-trail',890,2880],['willow-entry',1280,3150],['willow-green',1220,3500],['willow-bend',960,3870],
      ['willow-lake',1180,4280],['willow-end',1630,4700],['willow-east',2090,4270],['willow-top',1960,3560],
      ['willow-court',520,3980],['birch-court',840,4660],['drift-court',2010,4920],['elm-court',2440,4500],['fern-court',620,3150],
      ['meadow',2130,3000],['meadow-hub',2710,3020],['meadow-bend',3150,3200],
      ['orchard-gate',3000,1230],['apple',3520,1080],['pear',4050,1160],['orchard-east',4570,1520],['orchard-pond',4690,2000],
      ['orchard-south',4410,2550],['orchard-west',3770,2620],['orchard-green',3370,2200],['orchard-center',3870,1790],
      ['cedar-court',3470,630],['picnic-court',4390,750],['view-court',5040,1410],['peach-court',3880,3240],['cherry-court',4760,3030]
    ]) node(id, x, y);
    for (const spec of [
      ['north-spine','Biscuit Avenue','north','bakery','heights',0],['bakery-spine','Biscuit Avenue','bakery','garage','heights',0],
      ['garage-spine','Biscuit Avenue','garage','spawn','market',0],['plaza-spine','Biscuit Avenue','spawn','plaza','market',0],
      ['heights-rise','Scone Rise','north','heights','heights',-35],['heights-lane','Daisy Lane','heights','westgate','heights',45],
      ['garden-lane','Garden Crescent','westgate','garden','heights',-60],['plaza-lane','Crumb Street','garden','plaza','market',55],
      ['clock-street','Clock Street','bakery','clock','market',25],['warehouse-road','Loading Lane','clock','warehouse','works',-45],
      ['works-road','Waffle Way','warehouse','worksyard','works',60],['clay-road','Clay Terrace','worksyard','clay','works',-60],
      ['depot-road','Depot Street','clock','depot','works',-50],['yard-road','Factory Crescent','depot','worksyard','works',65],
      ['arcade-road','Arcade Street','plaza','arcade','market',-30],['arcade-depot','Noodle Alley','arcade','depot','market',45,90],
      ['market-lane','Market Mile','plaza','market','market',-65],['arcade-market','Disco Lane','arcade','market','market',-30,90],
      ['eastmarket-road','Bean Boulevard','arcade','eastmarket','market',50],['depot-market','Fudge Street','depot','eastmarket','works',-45],
      ['canal-road','Canal Crescent','eastmarket','canal','riverfront',-40],['clay-canal','Clay Terrace','clay','canal','works',55],
      ['outer-lane','Primrose Bend','garden','outer','heights',55],['creek-lane','Creek Road','outer','creek','riverfront',-35],
      ['market-creek','Market Mile','market','creek','market',45],['garden-creek','Garden Crescent','garden','creek','heights',-70],
      ['southgate-road','Riverside Drive','creek','southgate','riverfront',-80],['riverbend-road','Riverside Drive','market','riverbend','riverfront',45],
      ['southgate-bend','Quay Road','southgate','riverbend','riverfront',60],['ferry-road','Ferry Lane','eastmarket','ferry','riverfront',50],
      ['canal-ferry','Canal Crescent','canal','ferry','riverfront',-45],['quay-road','Quay Road','riverbend','quay','riverfront',-50],
      ['ferry-quay','Waterside Way','ferry','quay','riverfront',50],['quay-south','Riverside Drive','quay','southgate','riverfront',-170],
      ['willow-approach','Willow Road','southgate','willow-trail','willow',-90,90],['willow-entry-road','Willow Road','willow-trail','willow-entry','willow',65,90],
      ['willow-green-road','Willow Crescent','willow-entry','willow-green','willow',65,84],['willow-west-road','Willow Crescent','willow-green','willow-bend','willow',-60,84],
      ['willow-lake-road','Lake Crescent','willow-bend','willow-lake','willow',70,84],['willow-bottom-road','Lake Crescent','willow-lake','willow-end','willow',-80,84],
      ['willow-east-road','Foxglove Drive','willow-end','willow-east','willow',90,84],['willow-top-road','Foxglove Drive','willow-east','willow-top','willow',-100,84],
      ['willow-loop-road','Willow Crescent','willow-top','willow-entry','willow',90,84],['willow-cross-road','Lavender Lane','willow-green','willow-top','willow',-70,78],
      ['willow-court-road','Willow Court','willow-bend','willow-court','willow',55,72],['birch-road','Birch Court','willow-lake','birch-court','willow',-45,72],
      ['drift-road','Driftwood Court','willow-end','drift-court','willow',-35,72],['elm-road','Elm Court','willow-east','elm-court','willow',35,72],
      ['fern-road','Fern Court','willow-trail','fern-court','willow',-40,72],['meadow-south','Meadow Road','willow-top','meadow','willow',70,86],
      ['meadow-quay','Meadow Road','meadow','quay','riverfront',-80,90],['meadow-link','Meadow Road','meadow','meadow-hub','willow',80,86],
      ['meadow-bend-road','Meadow Road','meadow-hub','meadow-bend','orchard',-70,86],
      ['orchard-approach','Orchard Parkway','clay','orchard-gate','orchard',-90,100],['apple-road','Orchard Parkway','orchard-gate','apple','orchard',90,88],
      ['pear-road','Apple Crescent','apple','pear','orchard',-85,84],['orchard-east-road','Apple Crescent','pear','orchard-east','orchard',55,84],
      ['orchard-pond-road','Pond Drive','orchard-east','orchard-pond','orchard',-75,84],['orchard-south-road','Pond Drive','orchard-pond','orchard-south','orchard',85,84],
      ['orchard-west-road','Pear Crescent','orchard-south','orchard-west','orchard',75,84],['orchard-green-road','Pear Crescent','orchard-west','orchard-green','orchard',-70,84],
      ['orchard-loop-road','Orchard Parkway','orchard-green','orchard-gate','orchard',110,88],['orchard-center-road','Blossom Lane','orchard-green','orchard-center','orchard',-70,78],
      ['orchard-pear-road','Blossom Lane','orchard-center','pear','orchard',70,78],['orchard-pond-link','Peach Lane','orchard-center','orchard-pond','orchard',-45,78],
      ['cedar-road','Cedar Court','apple','cedar-court','orchard',45,72],['picnic-road','Picnic Court','pear','picnic-court','orchard',-50,72],
      ['view-road','View Court','orchard-east','view-court','orchard',45,72],['peach-road','Peach Court','orchard-west','peach-court','orchard',-60,72],
      ['cherry-road','Cherry Court','orchard-south','cherry-court','orchard',45,72],['orchard-meadow','Meadow Road','meadow-bend','orchard-west','orchard',70,86],
      ['city-orchard','Greenway Drive','canal','orchard-green','orchard',-100,94]
    ]) road(...spec);
    const network = new RoadNetwork(roads, nodes);
    const washApproach=network.pointOnRoad('ferry-quay',160);
    const services = [{ id: 'garage', x: 900, y: 900, label: 'Sprinkle Garage' }, { id: 'wash', x: washApproach.x, y: washApproach.y, label: 'Cool-Down Car Wash · $75' }];
    const start = { player: { x: 884, y: 1080, angle: -Math.PI / 2 }, car: { x: 916, y: 1080, angle: -Math.PI / 2, kind: 'compact', color: '#ffd15b' } };
    const areas = [
      ['heights',[[230,300],[1100,300],[1130,1140],[580,1660],[230,1510]]],
      ['works',[[1380,260],[2690,390],[2740,1550],[1760,1730],[1440,1200]]],
      ['market',[[570,1100],[1260,920],[1820,1190],[2110,1730],[1250,1940],[520,2130],[290,1720]]],
      ['riverfront',[[410,1880],[1640,1830],[2480,1700],[2320,2780],[1000,2780],[380,2300]]],
      ['willow',[[370,2890],[1310,2940],[2230,3240],[2710,3970],[2720,4710],[2110,5210],[760,5000],[320,4080]]],
      ['orchard',[[2860,680],[3400,400],[4730,460],[5260,1310],[5190,2920],[4630,3400],[3610,3460],[3050,2880],[2940,2030]]]
    ].map(([district, vertices]) => ({ id: 'area-' + district, district, mapColor: DISTRICTS[district].mapColor, points: vertices.map(([x, y]) => ({ x, y })) }));
    const buildings = [], blocks = [], staticObjects = [];
    const targets = { heights: 16, works: 15, market: 25, riverfront: 18, willow: 29, orchard: 29 };
    const counts = Object.fromEntries(Object.keys(targets).map(id => [id, 0]));
    const styles = { heights: 'cottage', works: 'warehouse', market: 'shop', riverfront: 'cafe', willow: 'cottage', orchard: 'cottage' };
    const names = { heights: ['Scone House','Crumb Cottage','Daisy House'], works: ['Waffle Works','Fudge Factory','Disco Depot'], market: ['Biscuit Bank','The Noodle Hut','Bean Palace','Sprinkle Shop'], riverfront: ['Crumb Café','The Boathouse','Riverside Snacks'], willow: ['Willow House','Foxglove Cottage','Lavender Lodge'], orchard: ['Apple House','Blossom Cottage','Pear Place'] };
    const villageGreens=[{id:'willow-village-green',district:'willow',x:1350,y:3720,w:280,h:290},
      {id:'orchard-village-green',district:'orchard',x:3970,y:2190,w:260,h:230}];
    const reserved = [...services.map(service => ({ ...service, radius: 128 })), { x: 900, y: 1080, radius: 95 },
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
      if (counts[district] >= targets[district]) return false;
      const suburban = DISTRICTS[district].suburban;
      const ranges = district === 'works' ? [154,216,96,150] : district === 'market' ? [62,96,84,120]
        : suburban ? [94,138,84,116] : [78,124,76,108];
      const w = ranges[0] + random() * (ranges[1] - ranges[0]), h = ranges[2] + random() * (ranges[3] - ranges[2]);
      const along = network.pointOnRoad(street.id, s), setback = street.width / 2 + SIDEWALK_WIDTH + h / 2 + (suburban ? 34 + random() * 60 : 18 + random() * 22);
      const nx = -Math.sin(along.angle) * side, ny = Math.cos(along.angle) * side;
      const cx = along.x + nx * setback, cy = along.y + ny * setback, angle = wrap(along.angle + (side > 0 ? Math.PI : 0));
      const box = { x: cx - w / 2, y: cy - h / 2, w, h, angle };
      const corners = footprintCorners(box);
      if (corners.some(point => point.x < 160 || point.y < 160 || point.x > SIZE - 160 || point.y > SIZE - 160) ||
        !roadClear(box) || buildings.some(other => boxesOverlap(box, other, 12)) || reserved.some(point => distance(point, {x:cx,y:cy}) < point.radius + Math.hypot(w,h)/2)) return false;
      const number = counts[district]++, id = 'lot-' + district + '-' + number;
      const height = district === 'works' ? 5 + random() * 3 : district === 'market' ? 4.6 + random() * 4.7 : 3.4 + random() * 2.1;
      const building = { ...box, id: id + '-building', blockId: id, district, style: styles[district], height,
        frontAngle: wrap(angle + Math.PI/2), roadId: street.id, roadS: s, color: COLORS[(number + Object.keys(targets).indexOf(district)) % COLORS.length],
        name: names[district][number % names[district].length] };
      if (district === 'market' && number === 2) { building.style = 'tower'; building.height = 13.4; building.name = 'Biscuit Clocktower'; }
      buildings.push(building);
      const margin = suburban ? 40 : 18, lot = { x: box.x-margin, y: box.y-margin, w:w+margin*2, h:h+margin*2, angle };
      const frontX = -Math.sin(angle), frontY = Math.cos(angle), drivewayLength = Math.max(12, setback - h/2 - street.width/2 - SIDEWALK_WIDTH);
      const driveway = { x:cx+frontX*(h/2+drivewayLength/2)-18, y:cy+frontY*(h/2+drivewayLength/2)-drivewayLength/2,
        w:36, h:drivewayLength, angle };
      blocks.push({ ...lot, id, district, kind: suburban || district === 'heights' ? 'garden' : district === 'works' ? 'yard' : district === 'market' ? 'shops' : 'cafe',
        landUse: suburban ? 'residential' : district, mapColor: DISTRICTS[district].mapColor, points: footprintCorners(lot), buildings:[building],
        garden: { ...lot }, courtyard: null, driveway, density:w*h/(lot.w*lot.h) });
      return true;
    };
    // First fill every neighborhood along actual frontage, then fill rejected
    // gaps with a shifted pass. Suburban spacing is much looser than the market.
    for (let pass = 0; pass < 6; pass++) for (const street of roads) {
      const spacing = street.district === 'market' ? 116 : street.district === 'works' ? 210 : DISTRICTS[street.district].suburban ? 230 : 155;
      for (let s = 125 + pass * spacing / 6; s < street.length - 110; s += spacing) {
        addLot(street, s, pass % 2 ? -1 : 1); addLot(street, s + 40, pass % 2 ? 1 : -1);
      }
    }
    const propBox = (x,y,w,h,angle=0) => ({x:x-w/2,y:y-h/2,w,h,angle});
    const decorationClear=box=>roadClear(box,SIDEWALK_WIDTH+8)&&!buildings.some(building=>boxesOverlap(box,building,8));
    const propClear = box => decorationClear(box) &&
      !reserved.some(point => distance(point,{x:box.x+box.w/2,y:box.y+box.h/2}) < point.radius + Math.hypot(box.w,box.h)/2);
    const addProp = object => { object.id = 'prop-' + staticObjects.length; staticObjects.push(object); return object; };
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
    const garageKiosk = {kind:'garage',x:1020,y:885,angle:0,district:'market',parts:[{shape:'box',offset:[0,.9,0],half:[.95,.9,.65]},{shape:'box',offset:[0,1.88,0],half:[1.05,.09,.75]}]};
    addProp(garageKiosk);
    addProp({kind:'wash',x:washApproach.x,y:washApproach.y,angle:washApproach.angle+Math.PI/2,district:'riverfront',parts:[
      {shape:'box',offset:[-2.25,1.25,0],half:[.13,1.25,.13]}, {shape:'box',offset:[2.25,1.25,0],half:[.13,1.25,.13]}, {shape:'box',offset:[0,2.55,0],half:[2.4,.175,.325]}]});
    for(const id of ['heights-lane','clock-street','eastmarket-road','southgate-road','willow-west-road','willow-top-road','apple-road','orchard-green-road']) {
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
      if(roadClear(propBox(sign.x,sign.y,18,7,sign.angle),SIDEWALK_WIDTH+8)&&!buildings.some(building=>boxesOverlap(propBox(sign.x,sign.y,18,7,sign.angle),building,8)))
        addProp({kind:'wayfinding',label:DISTRICTS[green.district].name.toUpperCase(),x:sign.x,y:sign.y,angle:sign.angle,district:green.district,parts:[
          {shape:'box',offset:[0,.65,0],half:[.045,.65,.045]}, {shape:'box',offset:[0,1.3,0],half:[.5,.2,.06]}]});
    }
    const pedPaths = [];
    for (const street of roads) {
      if (street.length < 200 || pedPaths.filter(path=>path.district===street.district).length >= (DISTRICTS[street.district].suburban ? 4 : 5)) continue;
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
        const pointClear=roadClear({x:candidate.x,y:candidate.y,w:0,h:0},radius);
        if(!pointClear) { if(run.length>best.length) best=run; run=[]; continue; }
        if(run.length) {
          const previous=run.at(-1),length=distance(previous,candidate),cx=(previous.x+candidate.x)/2,cy=(previous.y+candidate.y)/2;
          if(!roadClear({x:cx-length/2,y:cy,w:length,h:0,angle:heading(previous,candidate)},radius)) {
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
      if(street.length<220 || i%3!==1) continue;
      const point=network.pointOnRoad(street.id,street.length*.53,i%2?18:-18);
      if(distance(point,start.car)<160 || services.some(service=>distance(point,service)<140)) continue;
      const spawnIndex=vehicleSpawns.length;
      vehicleSpawns.push({x:point.x,y:point.y,angle:wrap(point.angle+(i%2?0:Math.PI)),roadId:street.id,s:point.s,
        kind:['compact','sports','van'][spawnIndex%3],color:COLORS[spawnIndex%6],traffic:spawnIndex%3!==0});
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
      const streets=[originalStreet,...roads.filter(road=>road!==originalStreet&&road.district===originalStreet.district)
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
        if(!decorationClear(bay)||footprintCorners(bay).some(point=>point.x<100||point.y<100||point.x>SIZE-100||point.y>SIZE-100)||
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
      dash:['clock','clay','orchard-green','meadow-hub','willow-green','quay'].map(anchor),
      party:['heights','market','quay'].map(anchor),partyAlt:['depot','orchard-green','ferry'].map(anchor),
      suburbs:[anchor('willow-green'),anchor('orchard-green')],
      byName:Object.fromEntries(nodes.map(point=>[point.id,anchor(point.id)]))
    };
    const landscape={
      riverWidth:142,riverPath:[{x:SIZE+360,y:-450},{x:SIZE+600,y:600},{x:SIZE+290,y:1700},{x:SIZE+510,y:2700},{x:SIZE+260,y:3800},{x:SIZE+560,y:4850},{x:SIZE+390,y:SIZE+550}],
      hills:[{x:-850,y:1150,radius:1000,height:27},{x:900,y:-950,radius:1200,height:22},{x:3300,y:-1050,radius:1450,height:30},{x:1100,y:SIZE+900,radius:1500,height:26}],
      meadow:[{x:2350,y:3750,w:750,h:1400},{x:2780,y:3500,w:620,h:1550}],
      greens:villageGreens
    };
    return {size:SIZE,sidewalkWidth:SIDEWALK_WIDTH,districts:DISTRICTS,roads,nodes,network,buildings,blocks,lots:blocks,areas,staticObjects,services,start,spawn:start,pedPaths,vehicleSpawns,parkingBays,missionAnchors,landscape};
  }

  const api={SIZE,SIDEWALK_WIDTH,DISTRICTS,districtAt,footprintCorners,boxesOverlap,segmentHitsBox,segmentBoxDistance,RoadNetwork,createWorld};
  root.MayhemWorld=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(globalThis);
