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

(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const METRICS=Object.freeze({width:420,padding:24,columns:1,gap:0,headerHeight:78,sectionHeaderHeight:42,cardPadding:12,artSize:88,nameFontSize:16,detailFontSize:14,lineHeight:18,cardGap:10});

  function wrapText(ctx,value,maxWidth){
    const lines=[];
    for(const paragraph of String(value||'').split(/\r\n?|\n|\u2028/u)){
      let line='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        const candidate=line?`${line} ${word}`:word;
        if(ctx.measureText(candidate).width<=maxWidth){line=candidate;continue;}
        if(line){lines.push(line);line='';}
        for(const char of word){
          if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line);line='';}
          line+=char;
        }
      }
      if(line)lines.push(line);
    }
    return lines;
  }

  function fillTextLines(ctx,lines,x,y,lineHeight){lines.forEach((line,index)=>ctx.fillText(line,x,y+index*lineHeight));}

  function missingArt(ctx,x,y,size,label){
    ctx.fillStyle='#20282d';ctx.fillRect(x,y,size,size);
    ctx.strokeStyle='#59656d';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,size-1,size-1);
    ctx.textAlign='center';ctx.fillStyle='#d8e0e5';ctx.font='700 26px sans-serif';ctx.fillText('?',x+size/2,y+42);
    ctx.font='600 9px sans-serif';ctx.fillStyle='#a9b1b7';
    const lines=wrapText(ctx,label,size-8),firstY=y+size-9-(lines.length-1)*10;
    lines.forEach((line,index)=>ctx.fillText(line,x+size/2,firstY+index*10));
    ctx.textAlign='left';
  }

  async function render(options){
    const {entries,owner,sectionsFor,sectionLabel,detailsFor,loadImage,drawImage,createCanvas,toBlob,locale,titleLabel,countLabel,missingArtLabel}=options;
    const sections=sectionsFor(entries.filter(entry=>entry.intent==='lf'));
    const canvas=createCanvas(),measure=canvas.getContext('2d');
    const innerWidth=METRICS.width-METRICS.padding*2;
    const cardWidth=(innerWidth-METRICS.gap)/METRICS.columns;
    const textWidth=cardWidth-METRICS.cardPadding*3-METRICS.artSize;
    measure.font=`700 ${METRICS.nameFontSize}px sans-serif`;
    const prepared=[];
    for(const section of sections){
      const items=await Promise.all(section.entries.map(async entry=>{
        const name=entry.dn||entry.name||'';
        const nameLines=wrapText(measure,name,textWidth);
        measure.font=`${METRICS.detailFontSize}px sans-serif`;
        const detailLines=wrapText(measure,detailsFor(entry,section),textWidth);
        measure.font=`700 ${METRICS.nameFontSize}px sans-serif`;
        const textHeight=nameLines.length*METRICS.lineHeight+detailLines.length*METRICS.lineHeight;
        return{entry,image:await loadImage(entry),nameLines,detailLines,height:Math.max(METRICS.artSize+METRICS.cardPadding*2,textHeight+METRICS.cardPadding*2)};
      }));
      const rowHeights=[];
      for(let index=0;index<items.length;index+=METRICS.columns)rowHeights.push(Math.max(...items.slice(index,index+METRICS.columns).map(item=>item.height)));
      prepared.push({section,items,rowHeights});
    }
    const visibleCount=prepared.reduce((sum,group)=>sum+group.items.length,0);
    const contentHeight=prepared.reduce((sum,group)=>sum+METRICS.sectionHeaderHeight+group.rowHeights.reduce((total,height)=>total+height,0)+Math.max(0,group.rowHeights.length-1)*METRICS.cardGap+16,0);
    const height=METRICS.headerHeight+contentHeight+METRICS.padding;
    if(height>12000)throw new Error('Image scope is too large');
    canvas.width=METRICS.width*2;canvas.height=height*2;
    const ctx=canvas.getContext('2d');ctx.scale(2,2);
    ctx.fillStyle='#111619';ctx.fillRect(0,0,METRICS.width,height);
    ctx.fillStyle='#ffffff';ctx.font='800 25px sans-serif';ctx.fillText(`${owner} · ${titleLabel}`,METRICS.padding,34);
    ctx.fillStyle='#a9b1b7';ctx.font='500 13px sans-serif';
    ctx.fillText(`${visibleCount} · ${new Date().toLocaleDateString(locale)}`,METRICS.padding,57);
    let y=METRICS.headerHeight;
    for(const group of prepared){
      const accent=({H:'#ff9c94',M:'#e7c76d',L:'#75d5b0'})[group.section.priority]||(group.section.flags?.length?'#bca7e8':'#a9b1b7');
      ctx.fillStyle='#2e383e';ctx.fillRect(METRICS.padding,y,innerWidth,1);
      ctx.fillStyle=accent;ctx.font='800 18px sans-serif';ctx.fillText(sectionLabel(group.section),METRICS.padding,y+27);
      ctx.textAlign='right';ctx.fillStyle='#a9b1b7';ctx.font='500 13px sans-serif';ctx.fillText(countLabel(group.section.entries.length),METRICS.width-METRICS.padding,y+27);ctx.textAlign='left';
      y+=METRICS.sectionHeaderHeight;
      let rowTop=y;
      group.items.forEach((item,index)=>{
        const column=index%METRICS.columns,row=Math.floor(index/METRICS.columns);
        if(column===0&&row>0)rowTop+=group.rowHeights[row-1]+METRICS.cardGap;
        const x=METRICS.padding+column*(cardWidth+METRICS.gap),cardHeight=group.rowHeights[row];
        ctx.fillStyle='#182026';ctx.fillRect(x,rowTop,cardWidth,cardHeight);
        const artX=x+METRICS.cardPadding,artY=rowTop+(cardHeight-METRICS.artSize)/2;
        if(item.image)drawImage(ctx,item.image,artX,artY,METRICS.artSize,METRICS.artSize);
        else missingArt(ctx,artX,artY,METRICS.artSize,missingArtLabel);
        const textX=artX+METRICS.artSize+METRICS.cardPadding,textY=rowTop+METRICS.cardPadding+15;
        ctx.fillStyle='#f4f7f8';ctx.font=`700 ${METRICS.nameFontSize}px sans-serif`;fillTextLines(ctx,item.nameLines,textX,textY,METRICS.lineHeight);
        ctx.fillStyle='#b8c2c9';ctx.font=`${METRICS.detailFontSize}px sans-serif`;fillTextLines(ctx,item.detailLines,textX,textY+item.nameLines.length*METRICS.lineHeight,METRICS.lineHeight);
        if(item.entry.shiny){ctx.fillStyle='#ffffff';ctx.font='700 18px sans-serif';ctx.fillText('✦',x+cardWidth-25,rowTop+23);}
      });
      y=rowTop+(group.rowHeights[group.rowHeights.length-1]||0)+16;
    }
    return toBlob(canvas);
  }

  root.productSharePhoneExport=Object.freeze({metrics:METRICS,wrapText,render});
})(window);
