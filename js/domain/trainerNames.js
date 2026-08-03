(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function trainerNameParts(value){
    const originalValue=value==null?'':String(value);
    const trainerName=originalValue.trim();
    const nfkcTrainerName=trainerName.normalize('NFKC');
    const normalizedTrainerName=nfkcTrainerName.toLowerCase();
    return{
      originalValue,
      trainerName,
      nfkcTrainerName,
      normalizedTrainerName,
      changedByTrimming:originalValue!==trainerName,
      changedByNfkc:trainerName!==nfkcTrainerName,
      valid:normalizedTrainerName.length>0
    };
  }

  function normalizeTrainerName(value){
    return trainerNameParts(value).normalizedTrainerName;
  }

  function auditTrainerNames(values){
    const entries=Array.from(values||[],trainerNameParts);
    const groups=new Map();
    entries.forEach((entry,index)=>{
      if(!entry.valid)return;
      const group=groups.get(entry.normalizedTrainerName)||[];
      group.push({...entry,index});
      groups.set(entry.normalizedTrainerName,group);
    });
    const collisions=Array.from(groups.entries())
      .filter(([,group])=>group.length>1)
      .map(([normalizedTrainerName,group])=>({normalizedTrainerName,entries:group}));
    return{
      entries,
      collisions,
      summary:{
        totalNames:entries.length,
        uniqueNormalizedNames:groups.size,
        collisionGroups:collisions.length,
        collidingNames:collisions.reduce((sum,collision)=>sum+collision.entries.length,0),
        changedByTrimming:entries.filter(entry=>entry.changedByTrimming).length,
        changedByNfkc:entries.filter(entry=>entry.changedByNfkc).length,
        invalidOrEmpty:entries.filter(entry=>!entry.valid).length
      }
    };
  }

  root.trainerNames=Object.freeze({
    trainerNameParts,
    normalizeTrainerName,
    auditTrainerNames
  });
})(window);
