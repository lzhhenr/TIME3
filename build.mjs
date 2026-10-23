import {build} from 'esbuild';
await build({entryPoints:['scene.js'],outfile:'scene.bundle.js',bundle:true,format:'esm',minify:true,target:'chrome130'});
await build({entryPoints:['roller.js'],outfile:'roller.bundle.js',bundle:true,format:'esm',minify:true,target:'chrome130'});
console.log('Built 3D calendar scene');

await build({entryPoints:['observances.js'],outfile:'observances.bundle.js',bundle:true,format:'esm',minify:true,target:'chrome130'});
