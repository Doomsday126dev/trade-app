(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const GROUPS=Object.freeze(['now','soon','later']);
  const TYPES=Object.freeze(['all','raids','max','gbl','research','general']);
  function dateOnly(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''));}
  function eventDate(value,endOfDay=false){
    if(dateOnly(value)){
      const[y,m,d]=String(value).split('-').map(Number);
      return new Date(y,m-1,d,endOfDay?23:0,endOfDay?59:0,endOfDay?59:0,endOfDay?999:0);
    }
    return new Date(value||0);
  }
  function eventType(event){
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
  function prepareEvents(events,{now=Date.now(),filter='all',limit=60}={}){
    const rows=(events||[]).map(event=>({...event,uiType:eventType(event),uiGroup:eventGroup(event,now)}))
      .filter(event=>event.uiGroup!=='expired'&&(filter==='all'||event.uiType===filter))
      .sort((a,b)=>eventDate(a.start)-eventDate(b.start)).slice(0,limit);
    return GROUPS.map(group=>({group,events:rows.filter(event=>event.uiGroup===group)})).filter(section=>section.events.length);
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
  function safeHttpsUrl(value){
    try{const url=new URL(String(value||''));return url.protocol==='https:'?url.href:'';}catch{return'';}
  }
  root.eventPresentation=Object.freeze({GROUPS,TYPES,dateOnly,eventDate,eventType,eventGroup,prepareEvents,eventTimeLabel,safeHttpsUrl});
})(window);
