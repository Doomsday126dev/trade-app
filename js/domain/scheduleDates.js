(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function isoDate(d){
    const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),da=String(d.getDate()).padStart(2,'0');
    return`${y}-${m}-${da}`;
  }

  function parseIsoDate(s){
    const[y,m,d]=String(s||'').split('-').map(Number);
    return new Date(y,(m||1)-1,d||1);
  }

  function todayIso(){return isoDate(new Date());}

  function startOfWeek(d){
    const dt=new Date(d);
    dt.setDate(dt.getDate()-dt.getDay());
    dt.setHours(0,0,0,0);
    return dt;
  }

  function addDays(d,n){
    const dt=new Date(d);
    dt.setDate(dt.getDate()+n);
    return dt;
  }

  function fmtWeekRange(start){
    const end=addDays(start,6);
    const sameMonth=start.getMonth()===end.getMonth();
    const opts={month:'short',day:'numeric'};
    return sameMonth
      ?`${start.toLocaleDateString(undefined,{month:'long'})} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
      :`${start.toLocaleDateString(undefined,opts)} – ${end.toLocaleDateString(undefined,opts)}, ${end.getFullYear()}`;
  }

  const WKDS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  root.scheduleDates=Object.freeze({
    isoDate,
    parseIsoDate,
    todayIso,
    startOfWeek,
    addDays,
    fmtWeekRange,
    WKDS
  });
})(window);
