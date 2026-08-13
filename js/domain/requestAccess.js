(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const REQUEST_ID_PATTERN=/^req_[0-9]+_[a-z0-9]{1,5}$/;
  const CONTROL_CHARACTER_PATTERN=/[\u0000-\u001f\u007f]/;

  function normalizedText(value,{optional=false}={}){
    if(value===undefined&&optional)return{ok:true,value:''};
    if(typeof value!=='string')return{ok:false,code:'invalid-type'};
    const normalized=value.trim();
    if(CONTROL_CHARACTER_PATTERN.test(normalized))return{ok:false,code:'invalid-characters'};
    return{ok:true,value:normalized};
  }

  function requestKey(timestamp,randomValue=Math.random()){
    const time=Number(timestamp);
    if(!Number.isSafeInteger(time)||time<0)return'';
    const numericRandom=Number(randomValue);
    if(!Number.isFinite(numericRandom)||numericRandom<0||numericRandom>=1)return'';
    const suffix=numericRandom.toString(36).slice(2,7)||'0';
    return`req_${time}_${suffix}`;
  }

  function build({rawUsername,rawNote,now=Date.now(),randomValue=Math.random(),canonicalize=value=>value}={}){
    const usernameResult=normalizedText(rawUsername);
    if(!usernameResult.ok)return usernameResult;
    if(!usernameResult.value)return{ok:false,code:'username-required'};
    if(usernameResult.value.length<2)return{ok:false,code:'username-too-short'};
    const canonical=canonicalize(usernameResult.value);
    if(typeof canonical!=='string'||!canonical.trim())return{ok:false,code:'invalid-username'};
    if(CONTROL_CHARACTER_PATTERN.test(canonical))return{ok:false,code:'invalid-characters'};

    const noteResult=normalizedText(rawNote,{optional:true});
    if(!noteResult.ok)return noteResult;
    const requestedAt=Number(now);
    const id=requestKey(requestedAt,randomValue);
    if(!id)return{ok:false,code:'invalid-request-metadata'};
    return{
      ok:true,
      id,
      payload:Object.freeze({
        username:canonical.trim(),
        note:noteResult.value,
        requestedAt,
        status:'pending'
      })
    };
  }

  root.requestAccess=Object.freeze({
    REQUEST_ID_PATTERN,
    CONTROL_CHARACTER_PATTERN,
    normalizedText,
    requestKey,
    build
  });
})(window);
