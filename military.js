/* Shared geometry for the northern military airbase. Metres use 20 world units. */
(function(root){
  'use strict';
  const ELEVATION=14,BOUNDS=Object.freeze({minX:0,minY:-4000,maxX:12000,maxY:8000});
  const rect=(id,x,y,w,h,role)=>({id,x,y,w,h,angle:0,role,elevation:ELEVATION});
  function createMilitaryBase(){
    const runway={...rect('military-runway',2000,-3100,4400,360,'runway'),thresholds:[{id:'military-west',x:2180,y:-2920,angle:0},{id:'military-east',x:6220,y:-2920,angle:Math.PI}]};
    const taxiways=[rect('military-taxiway',2100,-2560,4300,220,'taxiway'),rect('military-taxi-west',2030,-3100,220,760,'taxiway'),rect('military-taxi-east',6150,-3100,220,760,'taxiway')];
    const aprons=[rect('military-flight-apron',3950,-2360,2300,850,'apron'),rect('military-west-apron',2250,-2340,1700,500,'apron'),rect('military-hangar-apron',3800,-1840,2400,400,'apron')];
    const stands=[{id:'military-fighter-1',label:'FIRE FLY 1',x:4350,y:-1920,angle:-Math.PI/2,aircraftType:'fighter',type:'plane',npc:true,departureDelay:35},
      {id:'military-fighter-2',label:'FIRE FLY 2',x:4950,y:-1920,angle:-Math.PI/2,aircraftType:'fighter',type:'plane',npc:false}];
    const helipads=[{id:'military-heavy-pad',label:'HEAVY LIFT',x:5700,y:-2020,radius:190,aircraftType:'transportheli'},
      {id:'military-utility-pad',label:'UTILITY',x:6100,y:-2020,radius:150,aircraftType:'helicopter'}];
    const storageStands=[{id:'military-storage-1',label:'BASE HANGAR 1',x:3150,y:-2090,angle:0,noSpawn:true,type:'any'},
      {id:'military-storage-2',label:'BASE HANGAR 2',x:3700,y:-2090,angle:0,noSpawn:true,type:'any'}];
    const taxiRoutes=stands.map(stand=>({id:'taxi-'+stand.id,standId:stand.id,thresholdId:'military-west',points:[{x:stand.x,y:-2200},{x:stand.x-130,y:-2400},{x:stand.x-330,y:-2450},{x:2440,y:-2450},{x:2200,y:-2450},{x:2140,y:-2570},{x:2140,y:-2770},{x:2140,y:-2920},{x:2180,y:-2920}]}));
    const arrivalTaxiRoutes=stands.map(stand=>({id:'arrival-'+stand.id,standId:stand.id,points:[{x:5900,y:-2920},{x:6120,y:-2900},{x:6260,y:-2740},{x:6260,y:-2570},{x:6100,y:-2450},{x:stand.x+300,y:-2450},{x:stand.x+80,y:-2350},{x:stand.x,y:-2180},{x:stand.x,y:stand.y}]}));
    const buildings=[
      {id:'base-hangar-1',name:'Firefly Hangar',x:3980,y:-1450,w:560,h:400,height:8,militaryModel:'hangar'},
      {id:'base-hangar-2',name:'Squadron Hangar',x:4670,y:-1450,w:560,h:400,height:8,militaryModel:'hangar'},
      {id:'base-hangar-3',name:'Heavy Lift Hangar',x:5360,y:-1450,w:560,h:400,height:8,militaryModel:'hangar'},
      {id:'base-control',name:'Northwatch Tower',x:3450,y:-1750,w:160,h:160,height:14,militaryModel:'tower'},
      {id:'base-barracks-1',name:'Northwatch Barracks',x:2020,y:-1740,w:520,h:200,height:4,militaryModel:'barracks'},
      {id:'base-barracks-2',name:'Flight Crew Quarters',x:2020,y:-1420,w:520,h:200,height:4,militaryModel:'barracks'},
      {id:'base-hq',name:'Northwatch Headquarters',x:2700,y:-1500,w:480,h:240,height:5,militaryModel:'hq'},
      {id:'base-workshop',name:'Base Vehicle Workshop',x:2800,y:-1200,w:360,h:160,height:5,militaryModel:'workshop'},
      {id:'base-gatehouse',name:'Northwatch Gate',x:6180,y:-990,w:140,h:120,height:3.2,militaryModel:'gatehouse'}
    ].map(b=>({...b,style:'military',district:'military',angle:0,color:'#8a9278',elevation:ELEVATION}));
    const motorPool=rect('military-motor-pool',3270,-1480,550,520,'motor-pool');
    const pads=[rect('military-formation',1800,-3300,4700,2600,'formation')];
    const fence=[{x:1750,y:-3400},{x:6620,y:-3400},{x:6620,y:-750},{x:6100,y:-750},{x:5950,y:-750},{x:1750,y:-750},{x:1750,y:-3400}];
    return {id:'military',name:'Northwatch Airbase',label:'MILITARY AIRBASE',elevation:ELEVATION,groundBounds:{...BOUNDS},bounds:{x:1750,y:-3400,w:4870,h:2650},
      departureThresholdId:'military-west',runways:[runway],taxiways,aprons,stands,helipads,storageStands,taxiRoutes,arrivalTaxiRoutes,buildings,pads,motorPool,fence,
      gate:{x:6025,y:-750,width:150},approachCorridors:[rect('military-west-approach',0,-3160,2000,480,'approach'),rect('military-east-approach',6400,-3160,5600,480,'approach')],
      vehicleSpawns:[{id:'base-utility-1',x:3400,y:-1320,angle:Math.PI/2,kind:'van',color:'#73806a',modelId:'tumble-hauler',militaryModel:'utility-truck',traffic:false},
        {id:'base-utility-2',x:3650,y:-1320,angle:Math.PI/2,kind:'van',color:'#8c9275',modelId:'tumble-hauler',militaryModel:'utility-truck',traffic:false}],
      pedestrianPaths:[{id:'base-personnel',district:'military',points:[{x:1940,y:-1160},{x:1940,y:-1860},{x:2600,y:-1860},{x:2600,y:-1160}]},
        {id:'base-flightcrew',district:'military',points:[{x:3900,y:-1010},{x:6050,y:-1010},{x:6050,y:-1550},{x:3900,y:-1550}]}],
      roadNodes:[['base-pass',6200,450],['base-north-pass',6100,-250],['base-switchback',6680,-500],['base-gate',6025,-750],['base-inner-gate',6025,-930],['base-road-west',2600,-930]],
      roadLinks:[['base-access-south','Pine Ridge Access','pine-ridge','base-pass',-100,110],['base-access-ridge','Northwatch Road','base-pass','base-north-pass',-110,110],['base-access-north','Northwatch Road','base-north-pass','base-switchback',80,110],['base-gate-road','Northwatch Road','base-switchback','base-gate',30,110],['base-entry-road','Northwatch Road','base-gate','base-inner-gate',0,110],['base-compound-road','Northwatch Road','base-inner-gate','base-road-west',0,110]]};
  }
  const api={createMilitaryBase,ELEVATION,BOUNDS};root.MayhemMilitary=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
