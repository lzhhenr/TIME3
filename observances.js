import lunar from 'lunar-javascript';
const {Solar}=lunar;
const cache=new Map();
const terms=['小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'];
const termsEn=['Minor Cold','Major Cold','Spring Begins','Rain Water','Insects Awaken','Spring Equinox','Qingming','Grain Rain','Summer Begins','Grain Buds','Grain in Ear','Summer Solstice','Minor Heat','Major Heat','Autumn Begins','End of Heat','White Dew','Autumn Equinox','Cold Dew','Frost Descends','Winter Begins','Minor Snow','Major Snow','Winter Solstice'];
const chinese={'春节':'Spring Festival','元宵节':'Lantern Festival','端午节':'Dragon Boat','中秋节':'Mid-Autumn','重阳节':'Double Ninth','七夕节':'Qixi','除夕':'Lunar New Year Eve'};
/** Festival dates, not government compensatory workday or vacation schedules. */
export function dateObservances(date,language='zh'){
 const y=date.getFullYear(),m=date.getMonth()+1,d=date.getDate(),key=`${y}-${m}-${d}-${language}`;
 if(cache.has(key))return cache.get(key);
 const solar=Solar.fromYmd(y,m,d),l=solar.getLunar(),items=[];
 const add=(zh,en)=>{const name=language==='en'?en:zh;if(name&&!items.includes(name))items.push(name);};
 for(const name of l.getFestivals())add(name,chinese[name]||name);
 const fixed={'1-1':['元旦','New Year'], '5-1':['劳动节','Labour Day (CN)'],'10-1':['国庆节','National Day (CN)'],'6-19':['六月节','Juneteenth'],'7-4':['美国独立日','Independence Day'],'11-11':['退伍军人节','Veterans Day'],'12-25':['圣诞节','Christmas']};
 if(fixed[`${m}-${d}`])add(...fixed[`${m}-${d}`]);
 const weekday=new Date(y,m-1,d,12).getDay(),nth=Math.floor((d-1)/7)+1,last=d+7>new Date(y,m,0).getDate();
 if(m===1&&weekday===1&&nth===3)add('马丁路德金日','MLK Day');
 if(m===2&&weekday===1&&nth===3)add('总统日','Presidents Day');
 if(m===5&&weekday===1&&last)add('美国阵亡将士纪念日','Memorial Day');
 if(m===9&&weekday===1&&nth===1)add('美国劳动节','Labor Day (US)');
 if(m===10&&weekday===1&&nth===2)add('哥伦布日','Columbus Day');
 if(m===11&&weekday===4&&nth===4)add('感恩节','Thanksgiving');
 const term=l.getJieQi();if(term)add(term,termsEn[terms.indexOf(term)]||term);
 cache.set(key,items);return items;
}
