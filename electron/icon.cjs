const fs = require('node:fs');
const path = require('node:path');
const sizes = [16,20,24,32,40,48,64,128,256,512];
function cubePng(size=64){
 const closest=sizes.reduce((best,n)=>Math.abs(n-size)<Math.abs(best-size)?n:best,64);
 return fs.readFileSync(path.join(__dirname,'..','assets',`icon-${closest}.png`));
}
module.exports={cubePng};
