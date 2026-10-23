import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dateObservances} from '../observances.js';
const notes=s=>dateObservances(new Date(s+'T12:00:00'));
test('Chinese lunar festivals, Qingming and US moving holidays use their calendar dates',()=>{
 for(const [day,name] of [['2026-02-17','春节'],['2026-04-05','清明'],['2026-06-19','端午节'],['2026-09-25','中秋节'],['2026-11-26','感恩节'],['2026-05-25','美国阵亡将士纪念日'],['2026-09-07','美国劳动节'],['2026-12-22','冬至']])assert.ok(notes(day).includes(name),day);
 assert.ok(!notes('2026-11-19').includes('感恩节'));
 assert.ok(notes('2026-06-19').includes('六月节'));
});
test('2026 has exactly 24 solar terms including HKO confirmed winter solstice',()=>{
 const names=new Set('小寒 大寒 立春 雨水 惊蛰 春分 清明 谷雨 立夏 小满 芒种 夏至 小暑 大暑 立秋 处暑 白露 秋分 寒露 霜降 立冬 小雪 大雪 冬至'.split(' '));let count=0;
 for(let d=new Date(2026,0,1,12);d.getFullYear()===2026;d.setDate(d.getDate()+1))count+=dateObservances(d).filter(x=>names.has(x)).length;
 assert.equal(count,24);
});
