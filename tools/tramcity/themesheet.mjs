import sharp from 'sharp';
const D='scripts/out/tramcity/th/',L=[['cab','centrs-3',1250],['chase','centrs-3',1300],['cab','centrs-1',4000],['chase','centrs-1',3850],['chase','centrs-2',1700],['cab','centrs-3',1500]];
const W=640,H=360,comps=[];
for(let i=0;i<L.length;i++)for(let c=0;c<2;c++){const th=c?'winter':'evening';comps.push({input:await sharp(`${D}t4-${th}-${L[i][0]}-${L[i][1]}-${L[i][2]}.png`).resize(W,H).toBuffer(),left:c*W,top:i*H})}
await sharp({create:{width:W*2,height:H*L.length,channels:3,background:'#111'}}).composite(comps).png().toFile('scripts/out/tramcity/themes4.png');
