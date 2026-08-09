(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const HORIZONTAL_THRESHOLD=52;
  const DIRECTION_LOCK_THRESHOLD=12;

  function swipeIntent(deltaX,deltaY,{horizontalThreshold=HORIZONTAL_THRESHOLD,directionLockThreshold=DIRECTION_LOCK_THRESHOLD}={}){
    const x=Number(deltaX)||0,y=Number(deltaY)||0,ax=Math.abs(x),ay=Math.abs(y);
    if(ax<directionLockThreshold&&ay<directionLockThreshold)return Object.freeze({intent:'pending',open:false});
    if(ay>=ax)return Object.freeze({intent:'vertical',open:false});
    if(x<=-horizontalThreshold)return Object.freeze({intent:'open',open:true});
    if(x>=horizontalThreshold)return Object.freeze({intent:'close',open:false});
    return Object.freeze({intent:'snap-back',open:null});
  }

  root.favoriteCardInteractions=Object.freeze({HORIZONTAL_THRESHOLD,DIRECTION_LOCK_THRESHOLD,swipeIntent});
})(window);
