import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
export async function verifyIcon(exePath,icoPath){
 const exe=await fs.readFile(exePath),ico=await fs.readFile(icoPath);
 const pe=exe.readUInt32LE(0x3c),optional=pe+24,sectionCount=exe.readUInt16LE(pe+6),sectionTable=optional+exe.readUInt16LE(pe+20);
 const rvaToOffset=rva=>{for(let i=0;i<sectionCount;i++){const p=sectionTable+i*40,va=exe.readUInt32LE(p+12),size=Math.max(exe.readUInt32LE(p+8),exe.readUInt32LE(p+16));if(rva>=va&&rva<va+size)return exe.readUInt32LE(p+20)+rva-va;}throw Error('Resource RVA outside PE sections');};
 const dataDirectory=optional+(exe.readUInt16LE(optional)===0x20b?112:96),base=rvaToOffset(exe.readUInt32LE(dataDirectory+16));
 function entries(relative){const p=base+relative,n=exe.readUInt16LE(p+12)+exe.readUInt16LE(p+14);return Array.from({length:n},(_,i)=>{const q=p+16+i*8;return{id:exe.readUInt32LE(q),child:exe.readUInt32LE(q+4)};});}
 const root=entries(0),type=id=>entries(root.find(e=>e.id===id).child&0x7fffffff);
 function leaves(child){if(child&0x80000000)return entries(child&0x7fffffff).flatMap(e=>leaves(e.child));const p=base+child,start=rvaToOffset(exe.readUInt32LE(p));return [exe.subarray(start,start+exe.readUInt32LE(p+4))];}
 const source=Array.from({length:ico.readUInt16LE(4)},(_,i)=>{const p=6+i*16,start=ico.readUInt32LE(p+12);return ico.subarray(start,start+ico.readUInt32LE(p+8));});
 const icons=type(3),groups=type(14);let verified=0;
 for(const group of groups)for(const data of leaves(group.child)){
  assert.equal(data.readUInt16LE(4),source.length,'Every embedded icon group must contain all authored sizes');
  for(let i=0;i<source.length;i++){const p=6+i*14,id=data.readUInt16LE(p+12),entry=icons.find(e=>e.id===id);assert.ok(entry);for(const png of leaves(entry.child)){assert.ok(source.some(s=>s.equals(png)),`Icon ${id} contains stale artwork`);verified++;}}
 }
 return {passed:true,groups:groups.length,verifiedImages:verified,sizes:source.length};
}
if(process.argv[2])console.log(JSON.stringify(await verifyIcon(process.argv[2],process.argv[3]),null,2));
