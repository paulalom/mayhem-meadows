'use strict';
const { Game, SIZE } = require('../../core.js');
const { RoadNetwork } = require('../../world.js');

// Controls, economy and toy tests use an explicit, level street fixture. Map
// and terrain integration have their own suites, so moving a district cannot
// put a formerly open collision fixture on a mountainside or under the sea.
function makeFlatGame() {
  const game = new Game({ seed: 42 }), centers=[180,540,900,1260,1620,1980],nodes=[],roads=[];
  for(let row=0;row<centers.length;row++) for(let col=0;col<centers.length;col++) nodes.push({id:`flat-${col}-${row}`,x:centers[col],y:centers[row]});
  for(let row=0;row<centers.length;row++) for(let col=0;col<centers.length;col++) {
    const a=nodes[row*centers.length+col];
    for(const [dc,dr] of [[1,0],[0,1]]) if(col+dc<centers.length && row+dr<centers.length) {
      const b=nodes[(row+dr)*centers.length+col+dc];
      roads.push({id:`${a.id}-${b.id}`,a:a.id,b:b.id,width:104,district:'market',points:[{x:a.x,y:a.y},{x:b.x,y:b.y}]});
    }
  }
  const network=new RoadNetwork(roads,nodes),target=(x,y)=>({x,y}),delivery=[target(1260,900),target(1620,1260)],dash=nodes.slice(8,14).map(node=>({...node}));
  game.world={size:SIZE,roads,nodes,network,start:{player:{x:884,y:1080,angle:-Math.PI/2},car:{x:916,y:1080,angle:-Math.PI/2}},
    missionAnchors:{delivery,deliveryAlt:delivery.slice().reverse(),dash,party:dash.slice(0,3),partyAlt:dash.slice(3)}};
  game.terrain=null; game.network=network; game.roads=roads; game.nodes=nodes;
  game.buildings=[{x:240,y:240,w:240,h:240,height:6,elevation:0,angle:0}]; game.staticObjects=[]; game.pedPaths=[];
  game.services=[{id:'garage',x:900,y:900,elevation:0,label:'Sprinkle Garage'},{id:'wash',x:1620,y:1980,elevation:0,label:'Confetti Car Wash'}];
  Object.assign(game.player,game.world.start.player,{vehicleId:null,elevation:0,verticalVelocity:0,grounded:true});
  game.cars=[]; game.police=[]; game.peds=[]; game._nextId=1;
  game.vehiclePhysics.sync();
  game._addCar(916,1080,-Math.PI/2,'compact','#ffd15b');
  game._addCar(918,1560,-Math.PI/2,'compact','#67d3c8',true);
  game._addCar(1620,1820,Math.PI/2,'van','#a6a0fa');
  game.police.push({id:'police-flat',...game._vehicleState('compact'),x:1260,y:180,angle:Math.PI/2,speed:0,elevation:0,verticalVelocity:0,grounded:true,route:[],routeTimer:0,lastSeen:{x:884,y:1080}});
  for(let index=0;index<12;index++) {
    const x=1120+(index%4)*75,y=900+Math.floor(index/4)*75;
    game.peds.push({id:'ped-'+index,x,y,elevation:0,verticalVelocity:0,grounded:true,angle:0,homeX:x,homeY:y,stunned:0,bubble:'',bubbleTimer:0,pace:0,color:'#67d3c8'});
  }
  game.vehiclePhysics.sync(); return game;
}
module.exports={makeFlatGame};
