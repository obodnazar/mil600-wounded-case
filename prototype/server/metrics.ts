import {safeAggregate} from '../security/core.js';
import type {AnalyticsView,MetricView} from '../shared/view.js';
// Окремий незмінний mock-зріз до D1: рядки ніколи не передаються браузеру.
export const cohort=Array.from({length:30},(_,i)=>({
 injury:i>=15&&i<20?null:'2026-10-01',decision:i<20?'2026-10-15':null,
 vlkReceived:i<25,vlkReturned:i<10,ogdReceived:i<20,ogdReturned:i<5,
 stop:i<5?'confirmed_missed_exam':i<20?'confirmed_no_stop':'unknown',
 documents:['primary_medical_card','trauma_certificate','medical_summary'].map((kind,j)=>({kind,received:i<20&&j<2,mode:i<20&&j<2?'electronic':'unknown'})),
 active:true,workMinutes:5+(i%3)*5,
}));
export const ratio=(n:number,d:number)=>d>0?Math.round(n/d*1000)/10:null;
export function snapshot(rows:typeof cohort=cohort,fte:number|null=5):AnalyticsView {
 const guard=(counts:number[])=>safeAggregate(counts).status!=='suppressed';
 const metric=(id:string,title:string,value:string,detail:string,counts:number[],coverage:string,available=true):MetricView=>({id,title,value:!available||!counts.length||counts.every(n=>n===0)?'Недостатньо даних':guard(counts)?value:'Приховано',detail:!available||!counts.length||counts.every(n=>n===0)?'Немає підтвердженого ненульового знаменника. '+detail:guard(counts)?detail:'Мала або доповнювальна група. Значення, пов’язані підсумки й точні розміри приховано.',state:!available||!counts.length||counts.every(n=>n===0)?'insufficient':guard(counts)?'demo':'suppressed',coverage:!available||!counts.length||counts.every(n=>n===0)?'Покриття потребує уточнення':guard(counts)?coverage:'Покриття приховане разом із групою'});
 const completed=rows.filter(r=>r.decision),known=completed.filter(r=>r.injury),unknown=completed.length-known.length,open=rows.length-completed.length;
 const days=known.map(r=>(Date.parse(r.decision!)-Date.parse(r.injury!))/86400000).sort((a,b)=>a-b),mid=Math.floor(days.length/2),median=days.length?(days.length%2?days[mid]!:((days[mid-1]??0)+(days[mid]??0))/2):null;
 const vlk=rows.filter(r=>r.vlkReceived),vr=vlk.filter(r=>r.vlkReturned).length,ogd=rows.filter(r=>r.ogdReceived),or=ogd.filter(r=>r.ogdReturned).length;
 const stopped=rows.filter(r=>r.stop==='confirmed_missed_exam').length,covered=rows.filter(r=>r.stop!=='unknown').length;
 const docs=rows.flatMap(r=>r.documents),electronic=docs.filter(d=>d.received&&d.mode==='electronic').length;
 const active=rows.filter(r=>r.active).length,work=rows.filter(r=>r.workMinutes>0),minutes=work.reduce((sum,r)=>sum+r.workMinutes,0);
 const metrics:MetricView[]=[
 metric('BO-1','Час до постанови ВЛК',median===null?'Недостатньо даних':`${median} днів`,'Медіана від підтвердженої дати поранення до визначеної постанови; клінічний час не оголошено адміністративною затримкою.',[known.length,unknown,open],`${known.length} з датами; ${unknown} без дати; ${open} відкритих`,known.length>0),
 metric('BO-2','Пакети з поверненням',`ВЛК ${ratio(vr,vlk.length)??'—'}% · ОГД ${ratio(or,ogd.length)??'—'}%`,'Унікальні логічні пакети з ≥1 поверненням / отримані пакети. Ревізії не додають новий пакет. Когорта отримання 01.11.2026, фіксований горизонт 7 днів.',[vr,vlk.length-vr,rows.length-vlk.length,or,ogd.length-or,rows.length-ogd.length],`ВЛК ${vr}/${vlk.length}, отримання невідоме ${rows.length-vlk.length}; ОГД ${or}/${ogd.length}, невідоме ${rows.length-ogd.length}`,vlk.length>0&&ogd.length>0),
 metric('BO-3','Підтверджені зупинки виплат',`${stopped}/${covered}`,'Лише підтверджений належним джерелом код причини «пропущений обов’язковий огляд». Таймер не створює такого факту. Показник серед покритих, не оцінка всієї когорти.',[stopped,covered-stopped,rows.length-covered],`${covered}/${rows.length} з підтвердженням; ${rows.length-covered} невідомих`,covered>0),
 {id:'BO-4',title:'Зовнішній контекст звернень',value:'23% із 2 455',detail:'Направлення на ВЛК та лікування — ширша категорія, ніж документи поранених. Звіт омбудсмана за жовтень, опублікований 06.11.2026; перевірено 13.11.2026. Не ефект прототипу.',coverage:'Публічний зовнішній агрегат, поза mock-когортою',state:'context',source:'https://milomb.gov.ua/novyny/nad-chim-pracyuvala-komanda-ofisu-viyskovogo-ombudsmana-u-zhovtni'},
 metric('BO-5','Документи без кур’єра',`${ratio(electronic,docs.length)??'—'}%`,'Отримані ВЛК електронно документи конкретної версії / всі потрібні документи snapshot-пакета. Брак і невідомий спосіб не зникають зі знаменника.',[electronic,docs.length-electronic],`${electronic}/${docs.length}; неотримані / спосіб невідомий ${docs.length-electronic}`,docs.length>0),
 metric('BO-6','Навантаження супроводу',fte&&fte>0&&work.length?`${active/fte} кейсів/FTE · ${Math.round(minutes/work.length*10)/10} хв/кейс`:'Недостатньо даних','Активні кейси / погоджений mock-FTE; окремо фактичні вигадані WorkLog-хвилини / кейси з обліком роботи. Вік кейсу не замінює робочий час.',fte&&fte>=5?[active,work.length]:[],`${active} активних; FTE ${fte??'невідомий'}; ${minutes} хв на ${work.length} кейсів`),
 ];
 return {status:'synthetic_fixed_snapshot',cohort:'demo-cohort-v1 · окремий фіксований mock-зріз',asOf:'2026-11-13T12:00:00.000Z',minimum:5,metrics};
}
