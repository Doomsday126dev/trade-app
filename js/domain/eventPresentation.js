(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const GROUPS=Object.freeze(['now','soon','later']);
  const TYPES=Object.freeze(['all','spotlight','raids','max','gbl','research','general']);
  const UP_NEXT_CATEGORIES=Object.freeze(['spotlight_hour','max_monday','raid_day','community_day']);
  function dateOnly(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''));}
  function eventDate(value,endOfDay=false){
    if(dateOnly(value)){
      const[y,m,d]=String(value).split('-').map(Number);
      return new Date(y,m-1,d,endOfDay?23:0,endOfDay?59:0,endOfDay?59:0,endOfDay?999:0);
    }
    return new Date(value||0);
  }
  function eventType(event){
    const sourceType=String(event?.eventType||'').trim().toLowerCase();
    if(sourceType==='pokemon-spotlight-hour')return'spotlight';
    const text=`${event?.eventType||''} ${event?.name||''} ${event?.heading||''}`.toLowerCase();
    if(/max battle|dynamax|gigantamax/.test(text))return'max';
    if(/raid/.test(text))return'raids';
    if(/battle league|gbl/.test(text))return'gbl';
    if(/research/.test(text))return'research';
    return'general';
  }
  function eventGroup(event,now=Date.now(),soonWindow=3*86400000){
    const start=eventDate(event?.start).getTime(),end=eventDate(event?.end,dateOnly(event?.end)).getTime();
    if(!Number.isFinite(end)||end<now)return'expired';
    if(Number.isFinite(start)&&start<=now)return'now';
    if(Number.isFinite(start)&&start-now<=soonWindow)return'soon';
    return'later';
  }
  function prepareEvents(events,{now=Date.now(),filter='all',date='',timeZone,limit=60}={}){
    const rows=(events||[]).map(event=>({...event,uiType:eventType(event),uiGroup:eventGroup(event,now)}))
      .filter(event=>event.uiGroup!=='expired'&&(filter==='all'||event.uiType===filter)&&(!date||eventIntersectsDate(event,date,{timeZone})))
      .sort((a,b)=>eventDate(a.start)-eventDate(b.start)).slice(0,limit);
    return GROUPS.map(group=>({group,events:rows.filter(event=>event.uiGroup===group)})).filter(section=>section.events.length);
  }
  function normalizedEventKind(event){
    return String(event?.eventType||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
  }
  function upNextCategory(event){
    const kind=normalizedEventKind(event);
    if(kind==='pokemon_spotlight_hour'||kind==='spotlight_hour')return'spotlight_hour';
    if(kind==='max_mondays'||kind==='max_monday')return'max_monday';
    if(kind==='raid_day')return'raid_day';
    if(kind==='community_day')return'community_day';
    return'';
  }
  function upNextEvents(events,{now=Date.now()}={}){
    const eligible=(events||[]).filter(event=>{
      const end=eventDate(event?.end,dateOnly(event?.end)).getTime();
      return upNextCategory(event)&&Number.isFinite(end)&&end>=now;
    }).sort((a,b)=>eventDate(a.start)-eventDate(b.start));
    return Object.freeze(UP_NEXT_CATEGORIES.map(category=>{
      const event=eligible.find(candidate=>upNextCategory(candidate)===category);
      return event?Object.freeze({...event,upNextCategory:category}):null;
    }).filter(Boolean));
  }
  function eventIntersectsDate(event,dateKey,{timeZone}={}){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey||'')))return false;
    const start=eventDate(event?.start),end=eventDate(event?.end,dateOnly(event?.end));
    if(!Number.isFinite(start.getTime()))return false;
    const startKey=dateParts(start,timeZone),endKey=Number.isFinite(end.getTime())?dateParts(end,timeZone):startKey;
    return dateKey>=startKey&&dateKey<=endKey;
  }
  function eventsOnDate(events,dateKey,options={}){return(events||[]).filter(event=>eventIntersectsDate(event,dateKey,options));}
  function eventMarksDate(event,dateKey,{timeZone}={}){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey||'')))return false;
    const start=eventDate(event?.start);
    return Number.isFinite(start.getTime())&&dateParts(start,timeZone)===dateKey;
  }
  function markerEventsOnDate(events,dateKey,options={}){return(events||[]).filter(event=>eventMarksDate(event,dateKey,options));}
  function calendarMonth(events,{year,month,now=Date.now(),timeZone}={}){
    const reference=new Date(now),safeYear=Number.isInteger(year)?year:reference.getFullYear(),safeMonth=Number.isInteger(month)&&month>=0&&month<=11?month:reference.getMonth();
    const first=new Date(safeYear,safeMonth,1),gridStart=new Date(safeYear,safeMonth,1-first.getDay());
    const today=dateParts(reference,timeZone),cells=[];
    for(let index=0;index<42;index+=1){
      const date=new Date(gridStart);date.setDate(gridStart.getDate()+index);
      const key=dateParts(date,timeZone),markers=markerEventsOnDate(events,key,{timeZone});
      cells.push(Object.freeze({key,day:date.getDate(),inMonth:date.getMonth()===safeMonth,today:key===today,markerCount:markers.length,markerEventIds:Object.freeze(markers.map(event=>String(event?.eventID||event?.id||event?.slug||'')))}));
    }
    return Object.freeze({year:safeYear,month:safeMonth,cells:Object.freeze(cells)});
  }
  function eventTimeLabel(event,{locale='en',timeZone}={}){
    const start=eventDate(event?.start),end=eventDate(event?.end,dateOnly(event?.end));
    if(!Number.isFinite(start.getTime()))return'';
    const allDay=event?.allDay===true||dateOnly(event?.start);
    const options=allDay?{dateStyle:'medium'}:{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'};
    if(timeZone)options.timeZone=timeZone;
    const formatter=new Intl.DateTimeFormat(locale,options);
    if(!Number.isFinite(end.getTime()))return formatter.format(start);
    return typeof formatter.formatRange==='function'?formatter.formatRange(start,end):`${formatter.format(start)} – ${formatter.format(end)}`;
  }
  function dateParts(date,timeZone){
    const options={year:'numeric',month:'2-digit',day:'2-digit'};if(timeZone)options.timeZone=timeZone;
    return new Intl.DateTimeFormat('en-CA',options).formatToParts(date).filter(part=>part.type!=='literal').map(part=>part.value).join('-');
  }
  function relativeDuration(milliseconds){
    const remaining=Math.max(0,Number(milliseconds)||0),minute=60000,hour=60*minute,day=24*hour;
    if(remaining<90*minute)return Object.freeze({value:Math.max(1,Math.ceil(remaining/minute)),unit:'minute'});
    if(remaining<36*hour)return Object.freeze({value:Math.max(1,Math.ceil(remaining/hour)),unit:'hour'});
    return Object.freeze({value:Math.max(1,Math.ceil(remaining/day)),unit:'day'});
  }
  function eventTiming(event,{now=Date.now(),locale='en',timeZone}={}){
    const start=eventDate(event?.start),end=eventDate(event?.end,dateOnly(event?.end)),nowDate=new Date(now);
    if(!Number.isFinite(start.getTime()))return Object.freeze({dateLabel:'',timeLabel:'',relative:null,multiDay:false,dayOffset:null});
    const allDay=event?.allDay===true||dateOnly(event?.start),hasEnd=Number.isFinite(end.getTime());
    const dateOptions={weekday:'short',year:'numeric',month:'short',day:'numeric'};if(timeZone)dateOptions.timeZone=timeZone;
    const timeOptions={hour:'numeric',minute:'2-digit'};if(timeZone)timeOptions.timeZone=timeZone;
    const dateFormatter=new Intl.DateTimeFormat(locale,dateOptions),timeFormatter=new Intl.DateTimeFormat(locale,timeOptions);
    const sameDay=hasEnd&&dateParts(start,timeZone)===dateParts(end,timeZone),multiDay=hasEnd&&!sameDay;
    const dateLabel=hasEnd&&multiDay
      ?(typeof dateFormatter.formatRange==='function'?dateFormatter.formatRange(start,end):`${dateFormatter.format(start)} – ${dateFormatter.format(end)}`)
      :dateFormatter.format(start);
    let timeLabel='';
    if(!allDay){
      if(hasEnd&&typeof timeFormatter.formatRange==='function')timeLabel=timeFormatter.formatRange(start,end);
      else timeLabel=hasEnd?`${timeFormatter.format(start)} – ${timeFormatter.format(end)}`:timeFormatter.format(start);
    }
    const group=eventGroup(event,now),target=group==='now'&&hasEnd?end.getTime():start.getTime();
    const relative=target>=now?Object.freeze({kind:group==='now'?'ends':'starts',...relativeDuration(target-now)}):null;
    const todayKey=dateParts(nowDate,timeZone),startKey=dateParts(start,timeZone);
    const tomorrow=new Date(nowDate);tomorrow.setDate(tomorrow.getDate()+1);
    const dayOffset=startKey===todayKey?0:startKey===dateParts(tomorrow,timeZone)?1:null;
    return Object.freeze({dateLabel,timeLabel,relative,multiDay,dayOffset});
  }
  function safeHttpsUrl(value){
    const raw=String(value||'');
    if(!/^https:\/\/[^\s\\]+$/i.test(raw)||/[\u0000-\u001f\u007f]/.test(raw))return'';
    try{
      const url=new URL(raw);
      if(url.protocol!=='https:'||!url.hostname||url.username||url.password)return'';
      return url.href;
    }catch{return'';}
  }
  root.eventPresentation=Object.freeze({GROUPS,TYPES,UP_NEXT_CATEGORIES,dateOnly,eventDate,eventType,eventGroup,prepareEvents,normalizedEventKind,upNextCategory,upNextEvents,eventIntersectsDate,eventsOnDate,eventMarksDate,markerEventsOnDate,calendarMonth,eventTimeLabel,eventTiming,relativeDuration,safeHttpsUrl});
})(window);
