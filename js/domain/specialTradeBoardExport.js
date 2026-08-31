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
    return 12;
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

  root.specialTradeBoardExport=Object.freeze({schemaVersion:2,metrics:METRICS,columnsFor,buildLayout});
})(window);
