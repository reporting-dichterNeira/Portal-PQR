/* SLA: 48 elapsed weekday hours, Bogotá (UTC-5); no working-hour or holiday exclusions. */
window.PQRSLA=(()=>{
  const hour=3600000,day=24*hour,offset=-5*hour;
  const local=ms=>new Date(ms+offset);
  const weekday=ms=>![0,6].includes(local(ms).getUTCDay());
  const midnightAfter=ms=>{const d=local(ms);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1)-offset;};
  function addHours(value,hours=48){
    let at=new Date(value).getTime(),left=hours*hour;
    if(!Number.isFinite(at)||!Number.isFinite(left)||left<0)return NaN;
    while(left>0){const next=midnightAfter(at);if(weekday(at)){const used=Math.min(next-at,left);at+=used;left-=used;}else at=next;}
    return at;
  }
  function between(a,b){
    let start=new Date(a).getTime(),end=new Date(b).getTime(),total=0;
    if(!Number.isFinite(start)||!Number.isFinite(end))return NaN;
    if(start>end)return -between(end,start);
    while(start<end){
      // Skip whole seven-day spans without changing the local time of day.
      const weeks=Math.floor((end-start)/(7*day));
      if(weeks){total+=weeks*5*day;start+=weeks*7*day;continue;}
      const next=Math.min(midnightAfter(start),end);
      if(weekday(start))total+=next-start;
      start=next;
    }
    return total;
  }
  function start(ticket,role){
    if(role==='redigitador')return ticket.redigitRequestedAt||ticket.receivedAt||ticket.createdAt;
    if(ticket.status==='Pendiente de Verificación')return ticket.redigitAt;
    return ticket.reopenedAt||ticket.receivedAt||ticket.assignedAt||ticket.createdAt;
  }
  function clock(end,now=Date.now()){
    const minutes=Math.ceil(Math.abs(between(now,end))/60000),late=end<now;
    return {late,text:`${late?'Vencido hace':'Restan'} ${Math.floor(minutes/60)} h ${String(minutes%60).padStart(2,'0')} min hábiles`};
  }
  return{addHours,between,start,clock};
})();
