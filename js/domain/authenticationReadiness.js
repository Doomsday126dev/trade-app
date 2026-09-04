(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const DURABLE_AUTH_PROVIDERS_ENABLED=false;
  const PROVIDERS=Object.freeze(['google','email','discord','legacy-pin']);
  const FUTURE_STATES=Object.freeze(['linked','not-linked','reauthentication-required','conflict','recovery-required']);
  const PROVIDER_CAPABILITY_KEYS=Object.freeze([
    'providerAccountCompatibility','googlePublicEntry','googleExistingAccountLinking',
    'providerAccountCreation','providerPublicReadSupport','providerPublicWriteSupport'
  ]);
  const DISABLED_PROVIDER_CAPABILITIES=Object.freeze(Object.fromEntries(PROVIDER_CAPABILITY_KEYS.map(key=>[key,false])));
  const LEGACY_FREEZE_MODEL='bounded-legacy-provisioning-freeze';
  const LEGACY_FREEZE_FIELDS=Object.freeze(['schemaVersion','state','provisioningModel','freezeId','provisioningContractDigest','activatedAt','releasedAt']);
  const SHA256=/^[a-f0-9]{64}$/;
  const LEGACY_FREEZE_ID=/^legacy-freeze-[A-Za-z0-9._:-]{8,96}$/;

  function accountSecurityModel({signedIn=false}={}){
    if(!signedIn)return Object.freeze({enabled:false,rows:Object.freeze([])});
    return Object.freeze({
      enabled:false,
      rows:Object.freeze([
        Object.freeze({provider:'google',state:'not-linked',interactive:false}),
        Object.freeze({provider:'email',state:'not-linked',interactive:false}),
        Object.freeze({provider:'discord',state:'not-linked',interactive:false}),
        Object.freeze({provider:'legacy-pin',state:'linked',interactive:false})
      ])
    });
  }

  function providerActionAllowed(){
    return false;
  }

  function legacyRepairDecision({currentUid='',replacementUid=''}={}){
    const established=typeof currentUid==='string'&&currentUid.length>0;
    const replacementRequested=typeof replacementUid==='string'&&replacementUid.length>0&&replacementUid!==currentUid;
    if(established&&replacementRequested){
      return Object.freeze({allowed:false,code:'auth/immutable-uid'});
    }
    return Object.freeze({allowed:true,code:established?'auth/uid-preserving-only':'auth/unbound-account'});
  }

  function unlinkDecision({usableMethodCount=0,isAdmin=false,recentAuth=false}={}){
    if(!Number.isSafeInteger(usableMethodCount)||usableMethodCount<=1){
      return Object.freeze({allowed:false,code:'auth/final-method'});
    }
    if(!recentAuth)return Object.freeze({allowed:false,code:'auth/recent-auth-required'});
    if(isAdmin)return Object.freeze({allowed:false,code:'auth/admin-strong-reauth-required'});
    return Object.freeze({allowed:false,code:'auth/unlink-not-implemented'});
  }

  function onboardingDecision({oauthAuthenticated=false,handleReserved=false}={}){
    return Object.freeze({
      mayCreateTrainerProfile:false,
      nextStep:oauthAuthenticated&&!handleReserved?'reserve-trainer-handle':'await-explicit-onboarding'
    });
  }

  function requestedCapabilities(value){
    const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return Object.fromEntries(PROVIDER_CAPABILITY_KEYS.map(key=>[key,source[key]===true]));
  }
  function compatibilityFloor(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1){
      return Object.freeze({schemaVersion:1,providerAccountsExist:false});
    }
    return Object.freeze({schemaVersion:1,providerAccountsExist:value.providerAccountsExist===true});
  }
  function resolveProviderCapabilities({requested={},floor={schemaVersion:1,providerAccountsExist:false}}={}){
    const resolved=requestedCapabilities(requested),normalizedFloor=compatibilityFloor(floor);
    if(normalizedFloor.providerAccountsExist){
      resolved.providerAccountCompatibility=true;
      resolved.providerPublicReadSupport=true;
    }
    return Object.freeze(resolved);
  }
  function providerModulesRequired(capabilities){
    const value=resolveProviderCapabilities({requested:capabilities});
    return value.providerAccountCompatibility||value.googlePublicEntry||
      value.googleExistingAccountLinking||value.providerAccountCreation;
  }
  function rollbackCapabilities(stage){
    if(stage==='pre-first-provider-account')return DISABLED_PROVIDER_CAPABILITIES;
    if(stage==='post-first-provider-account')return resolveProviderCapabilities({
      floor:{schemaVersion:1,providerAccountsExist:true}
    });
    throw new TypeError('Unknown provider rollback stage');
  }

  function exactFields(value,fields){
    const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[];
    const expected=[...fields].sort();return keys.length===expected.length&&keys.every((key,index)=>key===expected[index]);
  }
  function validLegacyFreeze(value){
    // RTDB omits null children; Firestore retains releasedAt: null.
    if(value?.state==='active'&&!Object.prototype.hasOwnProperty.call(value,'releasedAt'))value={...value,releasedAt:null};
    const timed=value?.schemaVersion===2;
    return exactFields(value,timed?[...LEGACY_FREEZE_FIELDS,'expiresAt']:LEGACY_FREEZE_FIELDS)&&[1,2].includes(value.schemaVersion)&&['active','released'].includes(value.state)&&
      value.provisioningModel===LEGACY_FREEZE_MODEL&&LEGACY_FREEZE_ID.test(value.freezeId||'')&&
      SHA256.test(value.provisioningContractDigest||'')&&Number.isSafeInteger(value.activatedAt)&&value.activatedAt>=0&&
      (!timed||(Number.isSafeInteger(value.expiresAt)&&value.expiresAt===value.activatedAt+35*60*1000))&&
      (value.state==='active'?value.releasedAt===null:Number.isSafeInteger(value.releasedAt)&&value.releasedAt>=value.activatedAt);
  }
  function legacyCreationDecision(value,at=Date.now()){
    if(value==null)return Object.freeze({ok:true,status:'pre-freeze'});
    if(!validLegacyFreeze(value))return Object.freeze({ok:false,status:'blocked',code:'legacy-provisioning/freeze-invalid'});
    if(value.schemaVersion===2&&value.expiresAt<=at)return Object.freeze({ok:true,status:'expired',freezeId:value.freezeId});
    return value.state==='released'
      ?Object.freeze({ok:true,status:'released',freezeId:value.freezeId})
      :Object.freeze({ok:false,status:'frozen',code:'legacy-provisioning/frozen',freezeId:value.freezeId});
  }
  function existingIdentityRepairDecision({freeze=null,existingHandle,targetHandle,existingRecord,nextRecord}={}){
    const existing=String(existingHandle||''),target=String(targetHandle||'');
    if(!existing||target!==existing||!existingRecord||!nextRecord)return Object.freeze({ok:false,code:'legacy-provisioning/repair-handle-change'});
    const freezeDecision=legacyCreationDecision(freeze);
    if(!freezeDecision.ok&&String(nextRecord.authUid||'')!==String(existingRecord.authUid||'')){
      return Object.freeze({ok:false,code:'legacy-provisioning/repair-uid-change'});
    }
    return Object.freeze({ok:true,status:'identity-preserving'});
  }
  function certificationMatches(value,certification,at=Date.now()){
    return validLegacyFreeze(value)&&value.state==='active'&&value.schemaVersion===2&&value.expiresAt>at&&certification&&typeof certification==='object'&&!Array.isArray(certification)&&
      certification.schemaVersion===2&&certification.state==='certified'&&certification.provisioningModel===LEGACY_FREEZE_MODEL&&
      certification.freezeId===value.freezeId&&certification.provisioningContractDigest===value.provisioningContractDigest&&
      certification.legacyNamespaceCoverageCertified===true&&Number.isSafeInteger(certification.activeLegacyHandleCount)&&
      certification.certifiedHandleCount===certification.activeLegacyHandleCount&&Number.isSafeInteger(certification.expiresAt)&&certification.expiresAt>at&&certification.expiresAt<=value.expiresAt;
  }

  root.authenticationReadiness=Object.freeze({
    DURABLE_AUTH_PROVIDERS_ENABLED,
    PROVIDERS,
    FUTURE_STATES,
    accountSecurityModel,
    providerActionAllowed,
    legacyRepairDecision,
    unlinkDecision,
    onboardingDecision
  });
  root.providerCapabilities=Object.freeze({
    CAPABILITY_KEYS:PROVIDER_CAPABILITY_KEYS,DISABLED:DISABLED_PROVIDER_CAPABILITIES,compatibilityFloor,
    resolveProviderCapabilities,providerModulesRequired,rollbackCapabilities
  });
  root.legacyProvisioningFreeze=Object.freeze({
    MODEL:LEGACY_FREEZE_MODEL,FIELDS:LEGACY_FREEZE_FIELDS,valid:validLegacyFreeze,legacyCreationDecision,
    existingIdentityRepairDecision,certificationMatches
  });
})(window);
