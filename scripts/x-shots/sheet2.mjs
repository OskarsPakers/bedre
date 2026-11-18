import sharp from 'sharp';
const [out, h, ...files] = process.argv.slice(2);
const H=+h; const bufs = await Promise.all(files.map(f=>sharp(f).resize({height:H}).toBuffer()));
const metas = await Promise.all(bufs.map(b=>sharp(b).metadata()));
let x=0; const comp=bufs.map((b,i)=>{const c={input:b,left:x,top:0}; x+=metas[i].width+4; return c;});
await sharp({create:{width:x,height:H,channels:3,background:'#222'}}).composite(comp).png().toFile(out);
