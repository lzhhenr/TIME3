import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const svg=await fs.readFile('assets/app-icon.svg','utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
await page.setContent('<body style="margin:0;background:transparent">'+svg+'</body>');await page.evaluate(()=>document.fonts.ready);
const pngs=[];
for(const size of [16,20,24,32,40,48,64,128,256,512]){
 await page.setViewportSize({width:size,height:size});await page.locator('svg').evaluate((el,size)=>{el.style.width=size+'px';el.style.height=size+'px';},size);
 const png=await page.screenshot({omitBackground:true});await fs.writeFile(`assets/icon-${size}.png`,png);if(size<=256)pngs.push({size,png});
}
await browser.close();
const header=Buffer.alloc(6+16*pngs.length);header.writeUInt16LE(1,2);header.writeUInt16LE(pngs.length,4);let offset=header.length;
pngs.forEach(({size,png},i)=>{const p=6+i*16;header[p]=size===256?0:size;header[p+1]=size===256?0:size;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length;});
await fs.writeFile('assets/TIME3.ico',Buffer.concat([header,...pngs.map(x=>x.png)]));
