'use strict';
// Numeric earthworks export, not an image-generation edit. Every unaffected
// RGB pixel and every source water pixel is retained byte-for-byte.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const Railway=require('../railway.js');
const sourcePath=path.join(__dirname,'../assets/reference-heightmap.png');
const outputPath=path.join(__dirname,'../assets/railway-heightmap.png');
const manifestPath=path.join(__dirname,'../assets/railway-heightmap.json');
function decode(buffer) {
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),parts=[];
  if(buffer[24]!==8||buffer[25]!==2||buffer[28]!==0)throw Error('Expected noninterlaced 8-bit RGB source PNG');
  for(let offset=8;offset<buffer.length;) {const length=buffer.readUInt32BE(offset),type=buffer.toString('ascii',offset+4,offset+8);if(type==='IDAT')parts.push(buffer.subarray(offset+8,offset+8+length));offset+=length+12;}
  const packed=zlib.inflateSync(Buffer.concat(parts)),stride=width*3,pixels=Buffer.alloc(width*height*3);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++) {
    const filter=packed[y*(stride+1)];if(filter>4)throw Error('Invalid PNG filter');
    for(let x=0;x<stride;x++) {
      const index=y*stride+x,a=x>=3?pixels[index-3]:0,b=y?pixels[index-stride]:0,c=y&&x>=3?pixels[index-stride-3]:0;
      const prediction=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];pixels[index]=(packed[y*(stride+1)+1+x]+prediction)&255;
    }
  }
  return {width,height,pixels};
}
function crc32(data) {let value=0xffffffff;for(const byte of data){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(type,body) {const label=Buffer.from(type),result=Buffer.alloc(body.length+12);result.writeUInt32BE(body.length);label.copy(result,4);body.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([label,body])),body.length+8);return result;}
function encode(width,height,pixels) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const stride=width*3,packed=Buffer.alloc((stride+1)*height);
  for(let row=0;row<height;row++)pixels.copy(packed,row*(stride+1)+1,row*stride,(row+1)*stride);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(packed,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
function generate() {
  const source=fs.readFileSync(sourcePath),{width,height,pixels}=decode(source),output=Buffer.from(pixels),railway=Railway.createRailway();let changed=0,waterChanged=0;
  for(let row=0;row<height;row++)for(let col=0;col<width;col++) {
    const index=(row*width+col)*3,value=pixels[index];if(value<=8)continue;
    const original=.35+32*Math.pow((value-8)/247,2),x=col/(width-1)*12000,y=row/(height-1)*8000;
    const adjusted=Railway.earthworks(railway,x,y,original);
    if(Math.abs(adjusted-original)<1e-10)continue;
    const gray=Math.max(9,Math.min(255,Math.round(8+247*Math.sqrt(Math.max(0,(adjusted-.35)/32)))));
    if(gray!==value){output[index]=output[index+1]=output[index+2]=gray;changed++;}
  }
  for(let i=0;i<pixels.length;i+=3)if((pixels[i]<=8)!==(output[i]<=8))waterChanged++;
  if(waterChanged)throw Error('Railway export changed the original water mask');
  const image=encode(width,height,output),hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
  const manifest={source:'reference-heightmap.png',sourceSha256:hash(source),output:'railway-heightmap.png',outputSha256:hash(image),width,height,bitDepth:8,colorType:2,
    gradingModule:'../railway.js',modifiedPixels:changed,waterMaskChanges:waterChanged,untouchedPixelsPreserved:true,
    runtime:'terrain.js applies the same railway.js earthworks to the preserved numeric source, then reconciles road and building grading. No image decoding or network access is needed.'};
  return {image,manifest:Buffer.from(JSON.stringify(manifest,null,2)+'\n')};
}
if(require.main===module) {
  const files=generate();
  for(const [file,data] of [[outputPath,files.image],[manifestPath,files.manifest]]) {
    if(process.argv.includes('--check')){if(!fs.existsSync(file)||!fs.readFileSync(file).equals(data))throw Error('Stale railway heightmap: '+file);}
    else fs.writeFileSync(file,data);
  }
  console.log(process.argv.includes('--check')?'Railway heightmap matches the shared earthworks; water mask unchanged.':'Exported cleaned railway heightmap; water mask unchanged.');
}
module.exports={decode,generate};
