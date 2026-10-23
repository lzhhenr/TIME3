import {t} from './i18n.mjs';
export function dateKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function monthCells(year,month){const first=new Date(year,month,1,12),count=new Date(year,month+1,0).getDate(),length=Math.max(35,Math.ceil((first.getDay()+count)/7)*7);return Array.from({length},(_,i)=>{const date=new Date(year,month,1-first.getDay()+i,12);return {date,key:dateKey(date),day:date.getDate(),inMonth:date.getMonth()===month&&date.getFullYear()===year};});}
export function shiftMonth(year,month,delta){const d=new Date(year,month+delta,1);return {year:d.getFullYear(),month:d.getMonth()};}
export function lunarLabel(date, language='zh') {
  try {
    if(language==='en') {
      const parts=new Intl.DateTimeFormat('en-US-u-ca-chinese',{month:'numeric',day:'numeric'}).formatToParts(date);
      return `Lunar ${parts.find(p=>p.type==='month')?.value}/${parts.find(p=>p.type==='day')?.value}`;
    }
    const parts=new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{month:'long',day:'numeric'}).formatToParts(date);
    const month=parts.find(p=>p.type==='month')?.value||'',day=Number(parts.find(p=>p.type==='day')?.value);
    const digits=['','一','二','三','四','五','六','七','八','九','十'];
    const name=day<11?'初'+digits[day]:day<20?'十'+digits[day-10]:day===20?'二十':day<30?'廿'+digits[day-20]:'三十';
    return `农历${month}${name}`;
  } catch {return t('lunarFallback',language);}
}
const solarOccasions={
  '1-1':['元旦',"New Year’s Day"], '2-14':['情人节',"Valentine’s Day"],
  '3-8':['国际妇女节',"International Women’s Day"], '3-12':['植树节','Arbor Day'],
  '4-22':['世界地球日','Earth Day'], '5-1':['劳动节','Labor Day'], '5-4':['青年节','Youth Day'],
  '5-15':['国际家庭日','International Day of Families'], '6-1':['儿童节',"Children’s Day"],
  '9-10':['教师节',"Teachers’ Day"], '10-1':['国庆节','National Day'], '12-25':['圣诞节','Christmas Day'],
};
const lunarOccasions={
  '正月初一':['春节','Spring Festival'], '正月十五':['元宵节','Lantern Festival'],
  '五月初五':['端午节','Dragon Boat Festival'], '七月初七':['七夕','Qixi Festival'],
  '八月十五':['中秋节','Mid-Autumn Festival'], '九月初九':['重阳节','Double Ninth Festival'],
  '腊月初八':['腊八节','Laba Festival'],
};
/** Observances are descriptive; this does not claim official working-day/day-off schedules. */
export function occasion(date, language='zh') {
  const value=solarOccasions[`${date.getMonth()+1}-${date.getDate()}`]||lunarOccasions[lunarLabel(date).replace('农历','')];
  return value?.[language==='en'?1:0]||'';
}
export function weatherLabel(code, language='zh') {
  let key='weatherForecast';
  if(code===0)key='clear';
  else if([1,2].includes(code))key='partlyCloudy';
  else if(code===3)key='cloudy';
  else if([45,48].includes(code))key='fog';
  else if(code>=51&&code<=57)key='drizzle';
  else if(code>=61&&code<=67)key='rain';
  else if(code>=71&&code<=77)key='snow';
  else if(code>=80&&code<=82)key='showers';
  else if(code>=85&&code<=86)key='snowShowers';
  else if(code>=95)key='thunderstorm';
  return t(key,language);
}
/** Coordinates originate from an explicitly enabled device-location setting. No IP lookup is performed. */
export async function fetchWeather(cityOrLocation, language='zh') {
  const get=async url=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error(t('weatherServiceError',language));
    return response.json();
  };
  let place;
  if(cityOrLocation&&typeof cityOrLocation==='object') {
    const {latitude,longitude}=cityOrLocation;
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)
      throw Error(t('invalidCoordinates',language));
    place={latitude,longitude,name:typeof cityOrLocation.name==='string'&&cityOrLocation.name.trim()?cityOrLocation.name.trim():t('currentLocation',language)};
  } else {
    const city=String(cityOrLocation||'').trim();
    if(!city)throw Error(t('cityNotFound',language));
    if(['厦门','厦门市','xiamen'].includes(city.toLowerCase()))place={name:language==='en'?'Xiamen':'厦门',latitude:24.4798,longitude:118.0894};
    else {
      const locations=await get('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:city,count:'1',language:language==='en'?'en':'zh',format:'json'}));
      place=locations.results?.[0];
      if(!place)throw Error(t('cityNotFound',language));
    }
  }
  const data=await get('https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),current:'temperature_2m,weather_code',daily:'weather_code,temperature_2m_max,temperature_2m_min',timezone:'auto',forecast_days:'7'}));
  if(!Array.isArray(data.daily?.time))throw Error(t('weatherDataError',language));
  const days={};
  data.daily.time.forEach((key,i)=>{
    const current=data.current?.time?.slice(0,10)===key,code=current?data.current.weather_code:data.daily.weather_code[i];
    days[key]={temp:current?data.current.temperature_2m:null,min:data.daily.temperature_2m_min[i],max:data.daily.temperature_2m_max[i],label:weatherLabel(code,language),code};
  });
  return {city:place.name,days,updatedAt:new Date().toISOString()};
}
