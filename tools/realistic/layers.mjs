import { openLayers, localToMerc } from '../detail/i3s.mjs';
const [x0,z0,x1,z1]=process.argv.slice(2).map(Number);
const a=localToMerc(x0,z0), b=localToMerc(x1,z1);
const bbox=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
const ls=await openLayers(bbox);
for(const L of ls){const j=L.json;console.log(L.name,j.store.version,JSON.stringify(j.textureSetDefinitions?.map(t=>t.formats)),JSON.stringify(j.geometryDefinitions?.map(g=>g.geometryBuffers.map(b=>Object.keys(b)))),j.materialDefinitions&&JSON.stringify(j.materialDefinitions).slice(0,200), 'tex', j.store.defaultGeometrySchema?.vertexAttributes? '' :'');}
