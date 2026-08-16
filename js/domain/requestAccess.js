(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const REQUEST_ID_PATTERN=/^req_[0-9]+_[a-z0-9]{1,5}$/;
  const CONTROL_CHARACTER_PATTERN=/[\u0000-\u001f\u007f]/;
  const USERNAME_MIN_LENGTH=2;
  const USERNAME_MAX_LENGTH=32;
  const NOTE_MAX_LENGTH=280;

  function textLength(value){return value.length;}

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

  function build({rawUsername,rawNote,now,randomValue=Math.random(),canonicalize=value=>value}={}){
    const usernameResult=normalizedText(rawUsername);
    if(!usernameResult.ok)return usernameResult;
    if(!usernameResult.value)return{ok:false,code:'username-required'};
    const canonical=canonicalize(usernameResult.value);
    if(typeof canonical!=='string'||!canonical.trim())return{ok:false,code:'invalid-username'};
    const username=canonical.trim();
    if(CONTROL_CHARACTER_PATTERN.test(username))return{ok:false,code:'invalid-characters'};
    const usernameLength=textLength(username);
    if(usernameLength<USERNAME_MIN_LENGTH)return{ok:false,code:'username-too-short'};
    if(usernameLength>USERNAME_MAX_LENGTH)return{ok:false,code:'username-too-long'};

    const noteResult=normalizedText(rawNote,{optional:true});
    if(!noteResult.ok)return noteResult;
    if(textLength(noteResult.value)>NOTE_MAX_LENGTH)return{ok:false,code:'note-too-long'};
    const capturedNow=typeof now==='function'?now():now===undefined?Date.now():now;
    const requestedAt=Number(capturedNow);
    const id=requestKey(requestedAt,randomValue);
    if(!id)return{ok:false,code:'invalid-request-metadata'};
    return{
      ok:true,
      id,
      payload:Object.freeze({
        username,
        note:noteResult.value,
        requestedAt,
        status:'pending'
      })
    };
  }

  root.requestAccess=Object.freeze({
    REQUEST_ID_PATTERN,
    CONTROL_CHARACTER_PATTERN,
    USERNAME_MIN_LENGTH,
    USERNAME_MAX_LENGTH,
    NOTE_MAX_LENGTH,
    textLength,
    normalizedText,
    requestKey,
    build
  });
})(window);
