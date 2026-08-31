(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const METRICS=Object.freeze({
    width:720,
    padding:14,
    headerHeight:50,
    footerHeight:16,
    sectionHeaderHeight:22,
    sectionHeaderGap:5,
    sectionGap:8,
    cardHeight:70,
    cardGap:4,
    bottomPadding:10
  });

  function finiteCount(value){
    const count=Number(value);
    return Number.isFinite(count)&&count>0?Math.floor(count):0;
  }

  function columnsFor(lfCount,ftCount){
    finiteCount(lfCount);finiteCount(ftCount);
    return 9;
  }

  function laneEntries(board,lane){
    return Array.isArray(board?.[lane])?board[lane]:[];
  }

  function buildLayout(board){
    const lanes=[
      Object.freeze({id:'lf',label:'Looking For',accent:'#818cf8',entries:laneEntries(board,'lf')}),
      Object.freeze({id:'ft',label:'For Trade',accent:'#34d399',entries:laneEntries(board,'ft')})
    ].filter(lane=>lane.entries.length);
    const columns=columnsFor(laneEntries(board,'lf').length,laneEntries(board,'ft').length);
    const innerWidth=METRICS.width-METRICS.padding*2;
    const cardWidth=(innerWidth-METRICS.cardGap*(columns-1))/columns;
    let y=METRICS.headerHeight+METRICS.padding;
    const sections=lanes.map((lane,laneIndex)=>{
      const headerY=y;
      y+=METRICS.sectionHeaderHeight+METRICS.sectionHeaderGap;
      const cards=lane.entries.map((entry,index)=>Object.freeze({
        entry,
        lane:lane.id,
        index,
        x:METRICS.padding+(index%columns)*(cardWidth+METRICS.cardGap),
        y:y+Math.floor(index/columns)*(METRICS.cardHeight+METRICS.cardGap),
        width:cardWidth,
        height:METRICS.cardHeight
      }));
      const rows=Math.ceil(lane.entries.length/columns);
      const cardsHeight=rows*METRICS.cardHeight+Math.max(0,rows-1)*METRICS.cardGap;
      const section=Object.freeze({
        id:lane.id,
        label:lane.label,
        accent:lane.accent,
        count:lane.entries.length,
        header:Object.freeze({x:METRICS.padding,y:headerY,width:innerWidth,height:METRICS.sectionHeaderHeight}),
        cards:Object.freeze(cards),
        rows,
        bottom:y+cardsHeight
      });
      y=section.bottom+(laneIndex<lanes.length-1?METRICS.sectionGap:0);
      return section;
    });
    const height=Math.ceil(y+METRICS.bottomPadding+METRICS.footerHeight);
    return Object.freeze({
      ...METRICS,
      height,
      columns,
      cardWidth,
      sections:Object.freeze(sections),
      entryCount:lanes.reduce((sum,lane)=>sum+lane.entries.length,0)
    });
  }

  function badgeTokens(entry,{backgroundLabel='',gender=''}={}){
    const tokens=[];
    if(backgroundLabel)tokens.push(Object.freeze({kind:'background',label:`${backgroundLabel} · BG`}));
    if(entry?.shiny)tokens.push(Object.freeze({kind:'shiny',label:'✦',symbol:true}));
    if(gender==='f'||gender==='m')tokens.push(Object.freeze({kind:'gender',label:gender==='f'?'♀':'♂',symbol:true}));
    if(entry?.lucky)tokens.push(Object.freeze({kind:'lucky',label:'⚡',symbol:true}));
    if(entry?.mirror)tokens.push(Object.freeze({kind:'mirror',label:'↔',symbol:true}));
    if(Number(entry?.qty)>1)tokens.push(Object.freeze({kind:'quantity',label:`×${Math.floor(Number(entry.qty))}`}));
    const note=String(entry?.note||'').replace(/\s+/g,' ').trim();
    const semanticNote=(entry?.shiny&&/^shiny$/i.test(note))
      ||(entry?.lucky&&/^lucky$/i.test(note))
      ||(entry?.mirror&&/^mirror$/i.test(note))
      ||(Number(entry?.qty)>1&&new RegExp(`^(?:x|×)${Math.floor(Number(entry.qty))}$`,'i').test(note));
    if(note&&!/^(?:m|f|male|female)$/i.test(note)&&!semanticNote)tokens.push(Object.freeze({kind:'note',label:note}));
    return Object.freeze(tokens);
  }

  function truncateLabel(value,maxWidth,measure){
    const source=String(value||'').replace(/\s+/g,' ').trim();
    if(measure(source)<=maxWidth)return source;
    let clipped=source;
    while(clipped.length>1&&measure(`${clipped}…`)>maxWidth)clipped=clipped.slice(0,-1).trimEnd();
    return clipped?`${clipped}…`:'…';
  }

  function truncateTokenLabel(token,maxWidth,measure){
    const source=String(token?.label||'').replace(/\s+/g,' ').trim();
    const suffix=token?.kind==='background'&&source.endsWith(' · BG')?' · BG':'';
    if(!suffix)return truncateLabel(source,maxWidth,measure);
    if(measure(source)<=maxWidth)return source;
    let core=source.slice(0,-suffix.length).trimEnd();
    while(core.length>1&&measure(`${core}…${suffix}`)>maxWidth)core=core.slice(0,-1).trimEnd();
    return core?`${core}…${suffix}`:`BG`;
  }

  function layoutBadgeRows(tokens,{x=0,y=0,width,rowHeight=15,badgeHeight=13,gap=3,maxRows=1,measure}={}){
    const safeTokens=Array.isArray(tokens)?tokens:[];
    const measureText=typeof measure==='function'?measure:value=>String(value||'').length*5;
    const left=Number(x)||0,top=Number(y)||0,safeWidth=Math.max(0,Number(width)||0),right=left+safeWidth;
    const placements=[];
    let row=0,cursor=left,hidden=0;
    for(let index=0;index<safeTokens.length;index++){
      const token=safeTokens[index]||{};
      const symbol=token.symbol===true;
      const maxByKind=token.kind==='background'?70:token.kind==='note'?70:token.kind==='quantity'?24:token.kind==='overflow'?24:symbol?18:54;
      const maxTokenWidth=Math.min(safeWidth,maxByKind);
      const horizontalPadding=symbol?4:10;
      let desired=Math.min(maxTokenWidth,measureText(String(token.label||''))+horizontalPadding);
      if(cursor+desired>right&&row+1<maxRows){row++;cursor=left;}
      const available=Math.min(maxTokenWidth,right-cursor);
      const minimumWidth=symbol?8:token.kind==='quantity'?18:22;
      if(available<minimumWidth){hidden=safeTokens.length-index;break;}
      const label=truncateTokenLabel(token,Math.max(1,available-horizontalPadding),measureText);
      const placement=Object.freeze({
        token,
        label,
        x:cursor,
        y:top+row*rowHeight,
        width:Math.min(available,measureText(label)+horizontalPadding),
        height:badgeHeight,
        row
      });
      placements.push(placement);
      cursor=placement.x+placement.width+gap;
    }
    if(hidden){
      const overflowLabel=`+${hidden}`;
      const overflowWidth=Math.max(22,measureText(overflowLabel)+12);
      if(right-cursor<overflowWidth&&placements.length&&placements.at(-1).row===row){
        const removed=placements.pop();
        hidden++;
        cursor=removed.x;
      }
      if(right-cursor>=overflowWidth){
        placements.push(Object.freeze({
          token:Object.freeze({kind:'overflow',label:overflowLabel}),
          label:`+${hidden}`,
          x:cursor,
          y:top+row*rowHeight,
          width:overflowWidth,
          height:badgeHeight,
          row
        }));
      }
    }
    return Object.freeze({placements:Object.freeze(placements),hiddenCount:hidden,rows:placements.length?placements.at(-1).row+1:0});
  }

  root.specialTradeBoardExport=Object.freeze({schemaVersion:1,metrics:METRICS,columnsFor,buildLayout,badgeTokens,layoutBadgeRows});
})(window);
