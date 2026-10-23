import test from 'node:test';import assert from 'node:assert/strict';
import {dateKey,monthCells,shiftMonth,lunarLabel,occasion,weatherLabel,fetchWeather} from '../calendar.mjs';
import {t,translate,translations} from '../i18n.mjs';
test('Sunday-first grids handle leap years and six rows',()=>{const leap=monthCells(2024,1);assert.equal(leap.length,35);assert.equal(leap.filter(c=>c.inMonth).length,29);assert.equal(leap[0].date.getDay(),0);const six=monthCells(2026,7);assert.equal(six.length,42);assert.equal(six.filter(c=>c.inMonth).length,31);assert.equal(new Set(six.map(c=>c.key)).size,42);});
test('Month navigation crosses years and dates use local calendar',()=>{assert.deepEqual(shiftMonth(2026,0,-1),{year:2025,month:11});assert.deepEqual(shiftMonth(2026,11,1),{year:2027,month:0});assert.equal(dateKey(new Date(2026,9,22,23,59)),'2026-10-22');});
test('Lunar text and fixed observances are supplied without invented dayoff data',()=>{assert.match(lunarLabel(new Date(2026,9,22)),/^农历/);assert.equal(occasion(new Date(2026,9,1)),'国庆节');assert.equal(occasion(new Date(2026,9,22)),'');});
test('Weather includes only returned dates, current temperature only on today',async()=>{const original=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({current:{time:'2026-10-22T16:00',temperature_2m:26,weather_code:2},daily:{time:['2026-10-22','2026-10-23'],temperature_2m_min:[21,22],temperature_2m_max:[28,29],weather_code:[2,3]}})});try{const weather=await fetchWeather('厦门');assert.equal(weather.days['2026-10-22'].temp,26);assert.equal(weather.days['2026-10-23'].temp,null);assert.equal(weather.days['2026-10-24'],undefined);}finally{global.fetch=original;}});
test('English localization covers UI keys, date metadata and weather without changing user text',()=>{
  assert.deepEqual(Object.keys(translations.en).sort(),Object.keys(translations.zh).sort());
  assert.equal(t('agendaCount','en',{done:1,total:3}),'1 / 3 complete');
  assert.equal(translate(' 今天 ','en'),' Today ');
  assert.equal(translate('My own reminder 标题','en'),'My own reminder 标题');
  assert.match(lunarLabel(new Date(2026,9,22),'en'),/^Lunar \d+[a-z]?\/\d+$/);
  assert.equal(occasion(new Date(2026,9,1),'en'),'National Day');
  assert.equal(occasion(new Date(2026,1,17),'en'),'Spring Festival');
  assert.equal(weatherLabel(2,'en'),'Partly cloudy');
  assert.equal(weatherLabel(95,'en'),'Thunderstorms');
});
test('Location weather uses provided coordinates directly, with no geocoding or IP service',async()=>{
  const original=global.fetch,urls=[];
  global.fetch=async url=>{urls.push(new URL(url));return {ok:true,json:async()=>({daily:{time:['2026-10-22'],temperature_2m_min:[20],temperature_2m_max:[27],weather_code:[0]}})};};
  try {
    const weather=await fetchWeather({latitude:24.48,longitude:118.09},'en');
    assert.equal(urls.length,1);assert.equal(urls[0].hostname,'api.open-meteo.com');
    assert.equal(urls[0].searchParams.get('latitude'),'24.48');
    assert.equal(urls[0].searchParams.get('longitude'),'118.09');
    assert.equal(weather.city,'Current location');assert.equal(weather.days['2026-10-22'].label,'Clear');
    await assert.rejects(fetchWeather({latitude:91,longitude:118},'en'),/Invalid location/);
    assert.equal(urls.length,1);
  } finally {global.fetch=original;}
});
test('English city search requests English place names and surfaces lookup failures',async()=>{
  const original=global.fetch,urls=[];
  global.fetch=async url=>{urls.push(new URL(url));return {ok:true,json:async()=>({results:[]})};};
  try {await assert.rejects(fetchWeather('not-a-city','en'),/City not found/);assert.equal(urls[0].searchParams.get('language'),'en');}
  finally {global.fetch=original;}
});
