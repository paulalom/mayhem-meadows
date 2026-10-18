'use strict';
// Import only the generated northern extension. The existing city PNG and its
// numeric import remain the authoritative source south of the original seam.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const Data=require('../height-data.js');
const ROOT=path.join(__dirname,'..'),OUT=path.join(ROOT,'assets/north-heightmap.json');
const WIDTH=385,HEIGHT=129,MIN_Y=-4000,SEAM_BLEND=600;
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>t*t*(3-2*t);
function decode(buffer) {
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),type=buffer[25],channels=({0:1,2:3,4:2,6:4})[type],parts=[];
  if(buffer[24]!==8||!channels||buffer[28]!==0)throw Error('Expected a noninterlaced 8-bit grayscale, RGB or RGBA PNG');
  for(let offset=8;offset<buffer.length;) {const length=buffer.readUInt32BE(offset),label=buffer.toString('ascii',offset+4,offset+8);if(label==='IDAT')parts.push(buffer.subarray(offset+8,offset+8+length));offset+=length+12;}
  const packed=zlib.inflateSync(Buffer.concat(parts)),stride=width*channels,unfiltered=Buffer.alloc(width*height*channels),pixels=Buffer.alloc(width*height*3);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++) {
    const filter=packed[y*(stride+1)];if(filter>4)throw Error('Invalid PNG filter');
    for(let x=0;x<stride;x++) {const index=y*stride+x,a=x>=channels?unfiltered[index-channels]:0,b=y?unfiltered[index-stride]:0,c=y&&x>=channels?unfiltered[index-stride-channels]:0;unfiltered[index]=(packed[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}
  }
  for(let i=0;i<width*height;i++)for(let c=0;c<3;c++)pixels[i*3+c]=unfiltered[i*channels+(type===0||type===4?0:c)];
  return {width,height,pixels};
}
function crc32(data) {let value=0xffffffff;for(const byte of data){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(type,body) {const label=Buffer.from(type),result=Buffer.alloc(body.length+12);result.writeUInt32BE(body.length);label.copy(result,4);body.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([label,body])),body.length+8);return result;}
function encode(width,height,pixels) {const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const stride=width*3,packed=Buffer.alloc((stride+1)*height);for(let y=0;y<height;y++)pixels.copy(packed,y*(stride+1)+1,y*stride,(y+1)*stride);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(packed,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
function sample(pixels,width,height,x,y) {x=clamp(x,0,width-1);y=clamp(y,0,height-1);const ix=Math.min(width-2,Math.floor(x)),iy=Math.min(height-2,Math.floor(y)),fx=x-ix,fy=y-iy;const v=(cx,cy)=>(pixels[(cy*width+cx)*3]+pixels[(cy*width+cx)*3+1]+pixels[(cy*width+cx)*3+2])/3;return v(ix,iy)*(1-fx)*(1-fy)+v(ix+1,iy)*fx*(1-fy)+v(ix,iy+1)*(1-fx)*fy+v(ix+1,iy+1)*fx*fy;}
function numericModule(bytes,sourceName,sourceHash,sourceWidth,sourceHeight) {
  return `/* Numeric import of the ImageGen northern extension in ${sourceName}.\n * Existing city data stays in height-data.js; only negative world Y uses this source. */\n(function(root) {\n  'use strict';\n  const Data=root.MayhemHeightData||(typeof require==='function'?require('./height-data.js'):null);\n  const WIDTH=${WIDTH},HEIGHT=${HEIGHT},MIN_Y=${MIN_Y},SEAM_BLEND=${SEAM_BLEND};\n  const encoded="${bytes.toString('base64')}";\n  const bytes=typeof Buffer!=='undefined'?Uint8Array.from(Buffer.from(encoded,'base64')):Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));\n  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>t*t*(3-2*t);\n  function sampleValue(u,v) {\n    if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1)return 0;\n    const x=u*(WIDTH-1),y=clamp(v,0,1)*(HEIGHT-1),ix=Math.min(WIDTH-2,Math.floor(x)),iy=Math.min(HEIGHT-2,Math.floor(y)),fx=x-ix,fy=y-iy;\n    return bytes[iy*WIDTH+ix]*(1-fx)*(1-fy)+bytes[iy*WIDTH+ix+1]*fx*(1-fy)+bytes[(iy+1)*WIDTH+ix]*(1-fx)*fy+bytes[(iy+1)*WIDTH+ix+1]*fx*fy;\n  }\n  function rawHeight(x,y) {\n    if(y>=0)return Data.rawHeight(x,y);\n    const value=sampleValue(x/12000,(y-MIN_Y)/-MIN_Y),source=value<=8?-3:.35+32*Math.pow(clamp((value-8)/247,0,1),2);\n    const seam=Data.rawHeight(x,0),t=smooth(clamp(-y/SEAM_BLEND,0,1));\n    return seam+(source-seam)*t;\n  }\n  const api={WIDTH,HEIGHT,MIN_Y,SEAM_BLEND,sourceWidth:${sourceWidth},sourceHeight:${sourceHeight},sourceBitDepth:8,sourceSha256:"${sourceHash}",sampleValue,rawHeight,isWaterRaw:(x,y)=>rawHeight(x,y)<.05};\n  root.MayhemNorthHeightData=api;\n  if(typeof module!=='undefined'&&module.exports)module.exports=api;\n})(globalThis);\n`;
}
function importSource(source,northOnly=false) {
  const decoded=decode(source),bytes=Buffer.alloc(WIDTH*HEIGHT),cropHeight=northOnly?decoded.height:decoded.height/3;
  for(let row=0;row<HEIGHT;row++)for(let col=0;col<WIDTH;col++) {
    const x=col/(WIDTH-1)*(decoded.width-1),y=row/(HEIGHT-1)*(cropHeight-1);
    // Suppress isolated painted pixels while retaining broad generated relief.
    let sum=0,weight=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const w=(3-Math.abs(dx))*(3-Math.abs(dy));sum+=sample(decoded.pixels,decoded.width,decoded.height,x+dx,clamp(y+dy,0,cropHeight-1))*w;weight+=w;}
    bytes[row*WIDTH+col]=Math.round(sum/weight);
  }
  return {bytes,decoded};
}
function generate(options={}) {
  const prior=fs.existsSync(OUT)?JSON.parse(fs.readFileSync(OUT,'utf8')):{};
  const sourceName=options.source||prior.source||'assets/concepts/military-base/heightmap-draft.png',sourcePath=path.resolve(ROOT,sourceName);
  if(!sourcePath.startsWith(ROOT+path.sep))throw Error('Northern source must be a saved file within the project');
  const northOnly=options.northOnly??prior.northOnly??false,source=fs.readFileSync(sourcePath),{bytes,decoded}=importSource(source,northOnly),sourceHash=hash(source);
  const moduleText=numericModule(bytes,path.relative(ROOT,sourcePath).replaceAll('\\','/'),sourceHash,decoded.width,decoded.height);
  const sandbox={module:{exports:{}},Buffer,globalThis:null};sandbox.globalThis=sandbox;sandbox.MayhemHeightData=Data;
  require('node:vm').runInNewContext(moduleText,sandbox);const North=sandbox.module.exports;
  const Terrain=require('../terrain.js'),Military=require('../military.js'),base=Military.createMilitaryBase(),pads=base.pads||[];
  const citySource=fs.readFileSync(path.join(ROOT,'assets/railway-heightmap.png')),city=decode(citySource),northRows=Math.round(city.height/2),pixels=Buffer.alloc(city.width*northRows*3),combined=Buffer.alloc(city.width*(northRows+city.height)*3);
  const Railway=require('../railway.js'),railway=Railway.extendNorth(Railway.createRailway());
  let water=0;
  for(let row=0;row<northRows;row++)for(let col=0;col<city.width;col++) {
    const x=col/(city.width-1)*12000,y=MIN_Y+row/northRows*-MIN_Y;
    const railHeight=Railway.earthworks(railway,x,y,North.rawHeight(x,y),North.isWaterRaw(x,y));
    const height=Terrain.militaryEarthworks(pads,x,y,railHeight);
    const gray=height<.05?6:clamp(Math.round(8+247*Math.sqrt(Math.max(0,(height-.35)/32))),9,255),index=(row*city.width+col)*3;
    if(gray<=8)water++;pixels[index]=pixels[index+1]=pixels[index+2]=gray;
  }
  pixels.copy(combined);city.pixels.copy(combined,pixels.length);
  const image=encode(city.width,northRows,pixels),combinedImage=encode(city.width,northRows+city.height,combined);
  const manifest={source:path.relative(ROOT,sourcePath).replaceAll('\\','/'),sourceSha256:sourceHash,sourceWidth:decoded.width,sourceHeight:decoded.height,northOnly,numericWidth:WIDTH,numericHeight:HEIGHT,
    bounds:{minX:0,minY:MIN_Y,maxX:12000,maxY:0},sourceBitDepth:8,seamBlendUnits:SEAM_BLEND,baseElevation:pads[0]?.elevation??null,
    output:'north-heightmap.png',outputSha256:hash(image),combinedOutput:'north-heightmap-combined.png',combinedOutputSha256:hash(combinedImage),
    citySource:'railway-heightmap.png',citySourceSha256:hash(citySource),citySourcePixelRowsPreserved:city.height,citySourcePixelChanges:0,cityWaterMaskChanges:0,
    northernWaterPixels:water,northernRailExtension:true,runtime:'north-height-data.js imports only negative world Y. terrain.js retains old city samples, blends the northern seam and applies the same military pads and extended railway earthworks.'};
  return new Map([[path.join(ROOT,'north-height-data.js'),Buffer.from(moduleText)],[path.join(ROOT,'assets/north-heightmap.png'),image],[path.join(ROOT,'assets/north-heightmap-combined.png'),combinedImage],[OUT,Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]);
}
if(require.main===module) {
  const index=process.argv.indexOf('--source'),files=generate(index>=0?{source:process.argv[index+1],northOnly:process.argv.includes('--north-only')}:{});
  for(const [name,data] of files)if(process.argv.includes('--check')){if(!fs.existsSync(name)||!fs.readFileSync(name).equals(data))throw Error('Stale northern heightmap: '+name);}else fs.writeFileSync(name,data);
  console.log(process.argv.includes('--check')?'Northern heightmap matches its numeric source; city pixels and water unchanged.':'Imported northern heightmap; preserved every original city pixel and its water mask.');
}
module.exports={decode,encode,importSource,generate};
