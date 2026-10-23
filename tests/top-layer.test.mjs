import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createTopLayer}=require('../electron/top-layer.cjs');
test('z-order recovery raises pinned calendar first and reminders last, without focusing',()=>{
 const calls=[];let pinned=true;
 const make=role=>({role,win:{isDestroyed:()=>false,isVisible:()=>true,isAlwaysOnTop:()=>true,setAlwaysOnTop:(...args)=>calls.push([role,...args]),moveTop:()=>calls.push([role,'raise'])}});
 const entries=new Map([['toast',make('toast')],['main',make('main')],['mini',make('mini')]]);
 const layer=createTopLayer({entries,getPinned:()=>pinned});layer.refresh();
 assert.deepEqual(calls.filter(c=>c[1]==='raise').map(c=>c[0]),['main','mini','toast']);
 pinned=false;calls.length=0;layer.refresh();assert.ok(calls.some(c=>c[0]==='main'&&c[1]===false));assert.ok(!calls.some(c=>c[0]==='main'&&c[1]==='raise'));layer.dispose();
});
