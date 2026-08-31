let initializeApp,getDatabase,ref,set,get,onValue,update,runTransaction,serverTimestamp,getAuth,signInWithEmailAndPassword,createUserWithEmailAndPassword,firebaseSignOut,updatePassword,deleteUser,onAuthStateChanged;
let firebaseSdkPromise=null;
let firebaseAppCheckSdkPromise=null;
let firebaseAppCheckInitializationPromise=null;
let firebaseDataProtectionPromise=null;
let firebaseAppCheckStage='not-started';
function firebaseSdkReady(){return typeof initializeApp==='function'&&typeof getDatabase==='function'&&typeof getAuth==='function';}
async function loadFirebaseSdk(){
  if(firebaseSdkReady())return true;
  if(!firebaseSdkPromise){
    const base='https://www.gstatic.com/firebasejs/10.12.2';
    firebaseSdkPromise=Promise.all([
      startPogoEarlyAuth(),
      import(`${base}/firebase-database.js`)
    ]).then(([early,dbMod])=>{
      const appMod=early.appMod,authMod=early.authMod;
      initializeApp=appMod.initializeApp;
      getDatabase=dbMod.getDatabase;
      ref=dbMod.ref;
      set=dbMod.set;
      get=dbMod.get;
      onValue=dbMod.onValue;
      update=dbMod.update;
      runTransaction=dbMod.runTransaction;
      serverTimestamp=dbMod.serverTimestamp;
      getAuth=authMod.getAuth;
      signInWithEmailAndPassword=authMod.signInWithEmailAndPassword;
      createUserWithEmailAndPassword=authMod.createUserWithEmailAndPassword;
      firebaseSignOut=authMod.signOut;
      updatePassword=authMod.updatePassword;
      deleteUser=authMod.deleteUser;
      onAuthStateChanged=authMod.onAuthStateChanged;
      return true;
    }).catch(err=>{
      firebaseSdkPromise=null;
      throw err;
    });
  }
  return firebaseSdkPromise;
}
function loadFirebaseAppCheckSdk(){
  if(firebaseAppCheckSdkPromise)return firebaseAppCheckSdkPromise;
  const base='https://www.gstatic.com/firebasejs/10.12.2';
  firebaseAppCheckStage='sdk-import';
  firebaseAppCheckSdkPromise=import(`${base}/firebase-app-check.js`).then(appCheckMod=>{
    firebaseAppCheckStage='sdk-import-settled';
    return{
      initializeAppCheck:appCheckMod.initializeAppCheck,
      ReCaptchaEnterpriseProvider:appCheckMod.ReCaptchaEnterpriseProvider
    };
  }).catch(error=>{
    firebaseAppCheckStage='failed';
    if(error?.code)throw error;
    throw Object.assign(new Error('Firebase App Check SDK import failed'),{code:'app-check/sdk-import-failed'});
  });
  return firebaseAppCheckSdkPromise;
}
const FIREBASE_APP_CHECK_STAGE_TIMEOUT_MS=30*1000;
function appCheckStageTimeout(promise,code){
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(new Error('Firebase App Check stage timed out'),{
        code:typeof code==='function'?code():code
      })),FIREBASE_APP_CHECK_STAGE_TIMEOUT_MS);
    })
  ]).finally(()=>clearTimeout(timer));
}
function startFirebaseAppCheck(app){
  if(firebaseAppCheckInitializationPromise)return firebaseAppCheckInitializationPromise;
  const service=window.PogoServices?.firebaseAppCheck;
  if(!service?.validSiteKey(FIREBASE_APP_CHECK_SITE_KEY)){
    firebaseAppCheckInitializationPromise=Promise.resolve(service?.unavailable('app-check/not-configured'));
    return firebaseAppCheckInitializationPromise;
  }
  window.__pogoStartup.appCheckStartedAt=performance.now();
  try{performance.mark('pogo:app-check-start')}catch{}
  firebaseAppCheckInitializationPromise=loadFirebaseAppCheckSdk()
    .then(sdk=>{
      firebaseAppCheckStage='initializing';
      const status=service.initializeAppCheckOnce({app,siteKey:FIREBASE_APP_CHECK_SITE_KEY,...sdk});
      firebaseAppCheckStage=status?.ok?'ready':'failed';
      return status;
    })
    .catch(error=>{
      firebaseAppCheckStage='failed';
      return service.unavailable(error?.code||'app-check/sdk-unavailable');
    });
  return firebaseAppCheckInitializationPromise;
}
function firebaseAppCheckReady(){
  if(!firebaseAppCheckInitializationPromise)return Promise.resolve(Object.freeze({ok:false,code:'app-check/not-started'}));
  return appCheckStageTimeout(firebaseAppCheckInitializationPromise,()=>
    firebaseAppCheckStage==='sdk-import'?'app-check/sdk-import-timeout':
      firebaseAppCheckStage==='initializing'?'app-check/initialization-timeout':'app-check/readiness-timeout')
    .catch(error=>firebaseAppCheckService.unavailable(error?.code||'app-check/readiness-failed'));
}
function activateFirebaseDataClient(){
  if(firebaseDataProtectionReady&&db)return db;
  if(!fbApp||!firebaseDatabaseHandle)throw new Error('Firebase data client cannot activate before app setup');
  db=firebaseDatabaseHandle;
  managedFirebaseClient=firebaseClientService.createFirebaseClient({database:db,ref,get,onValue});
  managedCurrentUserRepository=currentUserRepositoryData.createCurrentUserRepository(managedFirebaseClient);
  managedPublicShareRepository=publicShareRepositoryData.createPublicShareRepository(managedFirebaseClient);
  managedOwnedDataCoordinator=ownedDataCoordinatorData.createOwnedDataCoordinator({
    repository:managedCurrentUserRepository,
    lifecycle:managedListenerLifecycle,
    onSnapshot:_onOwnedDataSnapshot,
    onError:_onOwnedDataError
  });
  firebaseDataProtectionReady=true;
  fbOn=true;
  window.__pogoStartup.appCheckReadyAt=performance.now();
  try{performance.mark('pogo:app-check-ready')}catch{}
  return db;
}
function ensureFirebaseDataProtection(){
  if(firebaseDataProtectionReady&&db)return Promise.resolve(Object.freeze({ok:true,code:'app-check/already-ready'}));
  if(firebaseDataProtectionPromise)return firebaseDataProtectionPromise;
  if(!fbApp)return Promise.reject(Object.assign(new Error('Firebase app is not ready'),{code:'app-check/app-not-ready'}));
  startFirebaseAppCheck(fbApp);
  firebaseDataProtectionPromise=firebaseAppCheckReady().then(status=>{
    if(!status?.ok)throw Object.assign(new Error('App Check did not initialize'),{code:status?.code||'app-check/unavailable'});
    activateFirebaseDataClient();
    return status;
  }).catch(error=>{
    db=null;fbOn=false;firebaseDataProtectionReady=false;
    firebaseDataProtectionPromise=null;
    throw error;
  });
  return firebaseDataProtectionPromise;
}

const DB=window.POGO_TRADE_DB;
if(!DB)throw new Error('Trade data failed to load');

// Trainer-first interim mode retires broad community consumers while preserving
// the old loaders behind a simple flag/revert rollback path.
const TRAINER_FIRST_INTERIM_ENABLED=true;
const NARROW_READ_CLIENT_ENABLED=true;
const LEGACY_BROAD_READS_ENABLED=false;
const LEGACY_INVENTORY_READ_ONLY=true;
// SEC-03 dead-code backlog: remove the retired Inventory edit/browse/Offers
// renderers and their window exports after archive compatibility is retired.
// No current product route or rendered control reaches those legacy templates.
window.__pogoCreateGroupEClientFoundationCanary=async(storedEnvelope)=>{
  if(!fbApp||!auth)throw Object.assign(new Error('Group E client dependencies are not ready'),{code:'group-e/dependencies-not-ready'});
  const configuration=e1ClientFoundationCanaryService.browserConfigurationFromStoredEnvelope(storedEnvelope);
  if(e1ClientFoundationCanary)e1ClientFoundationCanary.close();
  e1ClientFoundationCanary=e1ClientFoundationCanaryService.createClientFoundationCanary({
    firebaseApp:fbApp,
    auth,
    firebaseAppCheckReady,
    getSessionGeneration:()=>_sessionTransientGeneration,
    getBrowserContextDigest:()=>e1ClientFoundationCanaryService.browserContextDigest(
      location.origin,location.pathname,fbApp.options.appId,crypto),
    importFunctionsSdk:()=>import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js')
  });
  await e1ClientFoundationCanary.open(configuration);
  return e1ClientFoundationCanary;
};
const i18nCore=window.PogoI18n?.core;
if(!i18nCore)throw new Error('Locale foundation failed to load');
const pokemonNamesI18n=window.PogoI18n?.pokemonNames;
if(!pokemonNamesI18n)throw new Error('Pokemon-name localization failed to load');
const eventLabelsI18n=window.PogoI18n?.eventLabels;
if(!eventLabelsI18n)throw new Error('Event localization failed to load');
const firebaseClientService=window.PogoServices?.firebaseClient;
if(!firebaseClientService)throw new Error('Firebase client service failed to load');
const firebaseAppCheckService=window.PogoServices?.firebaseAppCheck;
if(!firebaseAppCheckService)throw new Error('Firebase App Check foundation failed to load');
const e1ClientFoundationCanaryService=window.PogoServices?.e1ClientFoundationCanary;
if(!e1ClientFoundationCanaryService)throw new Error('E.1 client-foundation canary contract failed to load');
const subscriptionManagerData=window.PogoData?.subscriptionManager;
if(!subscriptionManagerData)throw new Error('Subscription manager failed to load');
const listenerLifecycleData=window.PogoData?.listenerLifecycle;
if(!listenerLifecycleData)throw new Error('Listener lifecycle failed to load');
const sessionCacheBoundaryData=window.PogoData?.sessionCacheBoundary;
if(!sessionCacheBoundaryData)throw new Error('Session cache boundary failed to load');
const firebaseReadRegistryData=window.PogoData?.firebaseReadRegistry;
if(!firebaseReadRegistryData)throw new Error('Firebase read registry failed to load');
const currentUserRepositoryData=window.PogoData?.currentUserRepository;
if(!currentUserRepositoryData)throw new Error('Current-user repository failed to load');
const ownedDataCoordinatorData=window.PogoData?.ownedDataCoordinator;
if(!ownedDataCoordinatorData)throw new Error('Owned-data coordinator failed to load');
const publicShareRepositoryData=window.PogoData?.publicShareRepository;
if(!publicShareRepositoryData)throw new Error('Public-share repository failed to load');
const trainerHistoryStoreData=window.PogoData?.trainerHistoryStore;
if(!trainerHistoryStoreData)throw new Error('Trainer history store failed to load');
const favoriteShareSessionCacheData=window.PogoData?.favoriteShareSessionCache;
if(!favoriteShareSessionCacheData)throw new Error('Favorite-share session cache failed to load');
const accountSyncModel=window.PogoDomain?.accountSyncModel;
const accountSyncProduct=window.PogoDomain?.accountSyncProduct;
const accountSyncJournalData=window.PogoData?.accountSyncJournal;
const accountSyncRepositoryData=window.PogoData?.accountSyncRepository;
const accountSyncRuntimeData=window.PogoData?.accountSyncRuntime;
if(!accountSyncModel||!accountSyncProduct||!accountSyncJournalData||!accountSyncRepositoryData||!accountSyncRuntimeData)throw new Error('Account sync foundation failed to load');
const clientReleaseDomain=window.PogoDomain?.clientRelease;
const trainerDiscoveryDomain=window.PogoDomain?.trainerDiscovery;
const tradeListComparisonDomain=window.PogoDomain?.tradeListComparison;
const favoriteCardInteractionsDomain=window.PogoDomain?.favoriteCardInteractions;
const favoritePokemonBrowseDomain=window.PogoDomain?.favoritePokemonBrowse;
if(!favoritePokemonBrowseDomain)throw new Error('Favorite Pokémon Browse helpers failed to load');
if(!trainerDiscoveryDomain)throw new Error('Trainer discovery helpers failed to load');
if(!tradeListComparisonDomain)throw new Error('Trade-list comparison helpers failed to load');
const eventPresentationDomain=window.PogoDomain?.eventPresentation;
if(!eventPresentationDomain)throw new Error('Event presentation helpers failed to load');
const publicSharePublicationDomain=window.PogoDomain?.publicSharePublication;
if(!publicSharePublicationDomain)throw new Error('Public-share publication helpers failed to load');
const trainerPreferencesDomain=window.PogoDomain?.trainerPreferences;
if(!trainerPreferencesDomain||trainerPreferencesDomain.SYNCED_TRAINER_PREFERENCES_ENABLED!==false)throw new Error('Disabled trainer-preference helpers failed to load safely');
const trainerPreferenceSyncDomain=window.PogoDomain?.trainerPreferenceSync;
if(!trainerPreferenceSyncDomain||trainerPreferenceSyncDomain.preferenceSyncPresentation({state:'synced'}).state!=='local-only')throw new Error('Disabled trainer-preference sync contract failed to load safely');
const authenticationReadinessDomain=window.PogoDomain?.authenticationReadiness;
if(!authenticationReadinessDomain||authenticationReadinessDomain.DURABLE_AUTH_PROVIDERS_ENABLED!==false)throw new Error('Disabled authentication readiness contract failed to load safely');
const PROVIDER_LINKING_DEVELOPMENT_ENABLED=window.__POGO_PROVIDER_LINKING_DEV__===true;
const authProviderRegistryDomain=window.PogoDomain?.authProviderRegistry;
const providerContinuationStateDomain=window.PogoDomain?.providerContinuationState;
const accountLinkingModelDomain=window.PogoDomain?.accountLinkingModel;
const accountLinkingControllerDomain=window.PogoDomain?.accountLinkingController;
if(PROVIDER_LINKING_DEVELOPMENT_ENABLED&&(!authProviderRegistryDomain||!providerContinuationStateDomain||!accountLinkingModelDomain||!accountLinkingControllerDomain))throw new Error('Provider-linking foundation failed to load');
const providerLinkingRegistry=PROVIDER_LINKING_DEVELOPMENT_ENABLED?authProviderRegistryDomain.createAuthProviderRegistry({
  developmentEnabled:true,
  configuredProviders:Array.isArray(window.__POGO_PROVIDER_LINKING_CONFIGURED__)?window.__POGO_PROVIDER_LINKING_CONFIGURED__:[]
}):null;
const trainerPreferencesRepositoryData=window.PogoData?.trainerPreferencesRepository;
if(!trainerPreferencesRepositoryData)throw new Error('Trainer-preference repository failed to load');
const trainerPreferenceSyncQueueData=window.PogoData?.trainerPreferenceSyncQueue;
if(!trainerPreferenceSyncQueueData)throw new Error('Trainer-preference sync queue contract failed to load');
const trainerTagPanelUi=window.PogoUI?.trainerTagPanel;
if(!trainerTagPanelUi)throw new Error('Trainer-tag UI helpers failed to load');
const loginDirectoryDomain=window.PogoDomain?.loginDirectory;
if(!loginDirectoryDomain)throw new Error('Login-directory helpers failed to load');
const cacheAdapterDomain=window.PogoDomain?.cacheAdapters;
if(!cacheAdapterDomain)throw new Error('Cache adapters failed to load');
const managedSubscriptions=subscriptionManagerData.createSubscriptionManager();
const managedListenerLifecycle=listenerLifecycleData.createListenerLifecycle({subscriptions:managedSubscriptions});
const managedSessionCache=sessionCacheBoundaryData.createSessionCacheBoundary({storage:localStorage});
let managedFirebaseClient=null;
let managedCurrentUserRepository=null;
let managedOwnedDataCoordinator=null;
let managedPublicShareRepository=null;
let trainerHistoryStore=null;
let favoriteShareSessionCache=null;
// Source-controlled rollout boundary. Only the reviewed owner canary hash is
// eligible; every other account remains on the existing local/legacy path.
const ACCOUNT_SYNC_ROLLOUT=Object.freeze({enabled:true,writesEnabled:true,allowlistedUidHashes:Object.freeze(['eb5f8130f7def5bab89d84e339e8f46787a33222ff407aa56b1807a835b180c1']),featureVersion:1});
let managedAccountSyncRuntime=null;
let accountSyncEligibleUid='';
let accountSyncUiState=null;
let accountSyncMigrationState='inactive';
let accountSyncCatalogIndex=null;
let accountSyncCanonicalEntities=[];
let accountSyncRuntimeStartPromise=null;
let accountSyncRuntimeStartBinding='';
let accountSyncRuntimeStopPromise=null;
let accountSyncRuntimeGeneration=0;
let accountSyncProjectionApplying=false;
let accountSyncRecoveryCoordinator=null;
let accountSyncRecoveryCoordinatorBinding='';
let accountSyncRecoverySessionBinding=null;
let accountSyncRecoveryCoordinatorGeneration=0;
let accountSyncRecoveryCoordinatorRuntimeGeneration=-1;
let accountSyncRecoveryStateBinding='';
let accountSyncRecoveryState=Object.freeze({status:'idle',attempt:0,code:'account-sync/none'});
const managedPublicSharePublication=publicSharePublicationDomain.createPublicSharePublicationGate();
const managedTrainerPreferencesRepository=trainerPreferencesRepositoryData.createTrainerPreferencesRepository({enabled:false});
const managedLoginDirectory=loginDirectoryDomain.createLoginDirectoryState();
let activePublicShareHydrationToken=null;
let _lastPublicShareBlockedNotice='';
let ownerPublicShareReview={generation:0,status:'idle',republishRequired:false,busy:false};

const OWNER="Doomsday126";
const APP_VERSION="4.6.38";
const MULTI_COMMUNITY_ENABLED=false;
const MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE=false;
const DEFAULT_COMMUNITY_ID='nyc';
const DEFAULT_COMMUNITY_NAME='NYC';
const COMMUNITY_VISIBILITIES=['private','inviteOnly','public'];
const SELECTED_COMMUNITY_KEY='pogoSelectedCommunityId_v1';
const OWNER_COMMUNITY_PREVIEW_KEY='pogoOwnerCommunityPreview_v1';
const OWNER_COMMUNITY_PREVIEW_SELECTED_KEY='pogoOwnerCommunityPreviewCommunity_v1';
const POGO_SEARCH_LANGUAGE_KEY='pogoPokemonGoSearchLocale:v1';
const POGO_SEARCH_LANGUAGE_OVERRIDE_KEY='pogoPokemonGoSearchLocaleOverride:v1';
const SESSION_TTL=30*24*60*60*1000; // 30 days; refreshed on each activity so active users stay logged in
const SPRITE_BASE="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";
const FIREBASE_URL=window.__POGO_FIREBASE_CONFIG.databaseURL;
const FIREBASE_PROJECT_ID=window.__POGO_FIREBASE_CONFIG.projectId;
const FIREBASE_API_KEY=window.__POGO_FIREBASE_CONFIG.apiKey;
const FIREBASE_AUTH_DOMAIN=window.__POGO_FIREBASE_CONFIG.authDomain;
const FIREBASE_STORAGE_BUCKET=window.__POGO_FIREBASE_CONFIG.storageBucket;
const FIREBASE_MESSAGING_SENDER_ID=window.__POGO_FIREBASE_CONFIG.messagingSenderId;
const FIREBASE_APP_ID=window.__POGO_FIREBASE_CONFIG.appId;
const FIREBASE_MEASUREMENT_ID=window.__POGO_FIREBASE_CONFIG.measurementId;
// Public reCAPTCHA Enterprise configuration; populated only after provider registration is approved.
const FIREBASE_APP_CHECK_SITE_KEY="6Lc6-X8tAAAAAI-MY4WdeI8RV-njpbiFX5mFjDbz";
const priorityDomain=window.PogoDomain?.priorities;
if(!priorityDomain)throw new Error('Priority helpers failed to load');
const {PRI,PRI_ORDER,LIST_LABELS,priLabel,priName,listLabel,sortEntries}=priorityDomain;
const badgeUi=window.PogoUi?.badges;
if(!badgeUi)throw new Error('Badge HTML helpers failed to load');
const {priBadge,diffBadgeHtml}=badgeUi;
const usernameDomain=window.PogoDomain?.username;
if(!usernameDomain)throw new Error('Username helpers failed to load');
const {alphaCompare}=usernameDomain;
const priorityValueDomain=window.PogoDomain?.priorityValues;
if(!priorityValueDomain)throw new Error('Priority value helpers failed to load');
const {entryGender,matchesTradeIntent,normalizeTradeQualifier,normalizeBackgroundId,parsePri,priValue}=priorityValueDomain;
const backgroundCatalogDomain=window.PogoDomain?.backgroundCatalog;
if(!backgroundCatalogDomain)throw new Error('Background catalog helpers failed to load');
const backgroundVisualDomain=window.PogoDomain?.backgroundVisual;
if(!backgroundVisualDomain)throw new Error('Background visual helpers failed to load');
let specialTradeBoardExportDomain=window.PogoDomain?.specialTradeBoardExport||null;
let specialTradeBoardExportDomainPromise=null;
const pokemonPrimaryTypesDomain=window.PogoDomain?.pokemonPrimaryTypes;
if(!pokemonPrimaryTypesDomain)throw new Error('Pokemon primary type data failed to load');
const {primaryTypeForDex}=pokemonPrimaryTypesDomain;
const scheduleDateDomain=window.PogoDomain?.scheduleDates;
if(!scheduleDateDomain)throw new Error('Schedule date helpers failed to load');
const {isoDate,parseIsoDate,todayIso,startOfWeek,addDays,fmtWeekRange,WKDS}=scheduleDateDomain;
const pokemonSearchTermsDomain=window.PogoDomain?.pokemonSearchTerms;
if(!pokemonSearchTermsDomain)throw new Error('Pokemon search term helpers failed to load');
const {REGION_CODE_TERMS,REGIONAL_FORM_TERMS,REGION_SEARCH_TERMS,CASTFORM_TYPE_TERMS,FORM_QUALIFIER_TERMS,regionalFormPrefix,regionalFormTerm,regionTermFromDex,dexRegionTerm,dexSearchTerm,castformTypeFilter,modSearchFilters,modFromSearchFilters,castformTypeFromSearchFilters,formVariantFilter,formVariantFromSearchFilters}=pokemonSearchTermsDomain;
const pokemonEntryRulesDomain=window.PogoDomain?.pokemonEntryRules;
if(!pokemonEntryRulesDomain)throw new Error('Pokemon entry rule helpers failed to load');
const {uniqueEntries,costumeDedupeKey,UNTRADEABLE_MYTHICAL_NAMES,isTradeableForWishlist,maxTypeForEntry,MAX_TYPE_SEARCH,entrySearchFilters}=pokemonEntryRulesDomain;
const pokemonGoSearchSyntaxDomain=window.PogoDomain?.pokemonGoSearchSyntax;
if(!pokemonGoSearchSyntaxDomain)throw new Error('Pokémon GO search syntax failed to load');
const searchStringDomain=window.PogoDomain?.searchStrings;
if(!searchStringDomain)throw new Error('Search string helpers failed to load');
const {PREFILTER,POGO_STR_LIMIT,dexStringFromNumbers,stringFromSearchItems,stringParts,searchPartSort,combineStrings,combinedStringOptions,myListSearchPlan,strLenInfo}=searchStringDomain;
const stringHtmlUi=window.PogoUi?.stringHtml;
if(!stringHtmlUi)throw new Error('String HTML helpers failed to load');
const {strLenHtml,strWarnHtml}=stringHtmlUi;
const scheduleEventRulesDomain=window.PogoDomain?.scheduleEventRules;
if(!scheduleEventRulesDomain)throw new Error('Schedule event rule helpers failed to load');
const {collectEventBonusTexts,eventNumberTokenToInt,parseSpecialTradeBonus,classifyEvent,getEventId}=scheduleEventRulesDomain;
const scheduleTradeRulesDomain=window.PogoDomain?.scheduleTradeRules;
if(!scheduleTradeRulesDomain)throw new Error('Schedule trade rule helpers failed to load');
const {externalTradePartners,parseExternalTradePartners,scheduledTradeQuantity,summarizeScheduledTrades}=scheduleTradeRulesDomain;
const pokemonKeysDomain=window.PogoDomain?.pokemonKeys;
if(!pokemonKeysDomain)throw new Error('Pokemon key helpers failed to load');
const {_normGender,HAVE_KEY_SEP,splitHaveKey,joinHaveKey,totalQtyForName,haveEntryInfo,haveEntryValue}=pokemonKeysDomain;
const spriteSlugsDomain=window.PogoDomain?.spriteSlugs;
if(!spriteSlugsDomain)throw new Error('Sprite slug helpers failed to load');
const {padDex,normalizeCostumeLookupKey,pokemondbGoSpeciesSlug,normalizeSpriteKey,SPRITE_SOURCE_REGISTRY,CANONICAL_SPRITE_OVERRIDES,UNRESOLVED_SPRITE_KEYS,canonicalSpriteOverride,isUnresolvedSpriteKey,spriteSourceForUrl,REGIONAL_SLUG_MAP,pokemondbSlug,publicSpriteUrls}=spriteSlugsDomain;
const costumeSpriteCatalogDomain=window.PogoDomain?.costumeSpriteCatalog;
if(!costumeSpriteCatalogDomain)throw new Error('Reviewed costume sprite catalog failed to load');
const fuzzyTextDomain=window.PogoDomain?.fuzzyText;
if(!fuzzyTextDomain)throw new Error('Fuzzy text helpers failed to load');
const {_phoneticCode,_levenshtein}=fuzzyTextDomain;
const autocompleteTextDomain=window.PogoDomain?.autocompleteText;
if(!autocompleteTextDomain)throw new Error('Autocomplete text helpers failed to load');
const {normalizeAcText}=autocompleteTextDomain;
const autocompleteMatchingDomain=window.PogoDomain?.autocompleteMatching;
if(!autocompleteMatchingDomain)throw new Error('Autocomplete matching helpers failed to load');
const {AC_RESULT_LIMIT,acItemSearchText,acMatchScore}=autocompleteMatchingDomain;
const autocompleteRankingDomain=window.PogoDomain?.autocompleteRanking;
if(!autocompleteRankingDomain)throw new Error('Autocomplete ranking helpers failed to load');
const {autocompleteDexSortValue,compareAutocompleteMatches,rankAutocompleteItems}=autocompleteRankingDomain;
const pokemonCatalogDomain=window.PogoDomain?.pokemonCatalog;
if(!pokemonCatalogDomain)throw new Error('Pokemon catalog helpers failed to load');
const relativeTimeDomain=window.PogoDomain?.relativeTime;
if(!relativeTimeDomain)throw new Error('Relative time helpers failed to load');
const {STALE_WARN,STALE_OLD,freshnessClass,freshnessLabel,freshnessColor,relativeTime,recentTrainerRecency}=relativeTimeDomain;
const textSafety=window.PogoUtils?.textSafety;
if(!textSafety)throw new Error('Text safety helpers failed to load');
const {safeFilePart,escHtml,escAttr}=textSafety;
function uiIconMarkup(name,className='ui-icon'){
  const safeName=String(name||'').replace(/[^a-z0-9-]/g,'');
  return`<svg class="${escAttr(className)}" aria-hidden="true"><use href="#ui-icon-${safeName}"></use></svg>`;
}
function uiIconNode(name,className='ui-icon'){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');
  svg.setAttribute('class',className);svg.setAttribute('aria-hidden','true');use.setAttribute('href',`#ui-icon-${String(name||'').replace(/[^a-z0-9-]/g,'')}`);svg.append(use);return svg;
}
const stringPanelsUi=window.PogoUi?.stringPanels;
if(!stringPanelsUi)throw new Error('String panel HTML helpers failed to load');
const {strLevelsHtml}=stringPanelsUi;
const emptyStateUi=window.PogoUi?.emptyState;
if(!emptyStateUi)throw new Error('Empty-state HTML helpers failed to load');
const {emptyHtml,stateModel,stateHtml,EMPTY_SVGS}=emptyStateUi;
const VIVILLON_PATTERNS=new Set(['Archipelago','Continental','Elegant','Fancy','Garden','High Plains','Icy Snow','Jungle','Marine','Meadow','Modern','Monsoon','Ocean','Poke Ball','Poké Ball','Polar','River','Sandstorm','Savanna','Sun','Tundra']);
const SCATTERBUG_PATTERNS=['Archipelago','Continental','Elegant','Garden','High Plains','Icy Snow','Jungle','Marine','Meadow','Modern','Monsoon','Ocean','Polar','River','Sandstorm','Savanna','Sun','Tundra'];
const FIREBASE_RULES_STATUS=Object.freeze({
  status:'deployed',
  deployedAt:'2026-08-05 10:05:15 EDT',
  candidateSha256:'e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf',
  reviewedCandidatePath:'tests/firebase/database.rules.narrow-read.json',
  rollbackReady:true
});

let db=null,fbOn=false,cur=null,fbApp=null,auth=null,currentAuthUid=null;
let e1ClientFoundationCanary=null;
let firebaseDatabaseHandle=null,firebaseDataProtectionReady=false;
let allData={};
let selectedTrainerRuntime={username:'',publicData:null};
let browseFilter='ALL',browseList='wishlist',staleFilter=0;
let browseFlagFilters={lucky:false,xxl:false,xxs:false,shiny:false};
let myListType='wishlist',strListType='wishlist';
let _lastAuthenticatedIdentityUid='';
let rpinTarget=null;
let syncQueue={},syncFlushTimer=null;
let undoStack=null,undoTimer=null,undoReturnFocus=null;
let acItems=[],acFiltered=[],acFocusIdx=-1;
let addTray=[];
let dragSrc=null;
let myListPointerDrag=null;
let authRepairStarted=false;
let bulkMode=false,bulkSelected=new Set(),reorderMode=false;
let haveView='mine',haveSubTab='trainer',haveMatchOnly=false;
let haveAcItems=[],haveAcFiltered=[],haveAcFocusIdx=-1;
let haveBulkMode=false,haveBulkSelected=new Set();
const myListCollapsedPrioritySections=new Set();
const MY_LIST_FILTER_DELAY_MS=60;
const MY_LIST_PROGRESSIVE_THRESHOLD=180;
const MY_LIST_PROGRESSIVE_INITIAL_ROWS=120;
const MY_LIST_PROGRESSIVE_BATCH_ROWS=60;
const myListViewModelCache=new Map();
const myListSourceMapCache=new Map();
let myListFilterTimer=0;
let myListFilterGeneration=0;
let myListProgressiveGeneration=0;
let myListStringsGeneration=0;
let myListRenderState=null;
let myListRenderCompletePromise=Promise.resolve();
let myListAncillaryRenderPromise=Promise.resolve();
let schedAnchor=null; // anchor date for week view (Sunday of week shown)
let schedSelectedDate=null; // currently selected day (ISO YYYY-MM-DD)
let voiceRecognition=null;
let entryTimestamps={}; // for conflict detection
let _sessionTransientGeneration=0;
const BACKUP_REMINDER_INTERVAL=7*24*60*60*1000; // 7 days
const AUTH_VERSION_SCAN_LIMIT=12;
// Pokemon primary type colors (from PokeAPI)
const TYPE_COLORS={normal:'#A8A878',fire:'#F08030',water:'#6890F0',electric:'#F8D030',grass:'#78C850',ice:'#98D8D8',fighting:'#C03028',poison:'#A040A0',ground:'#E0C068',flying:'#A890F0',psychic:'#F85888',bug:'#A8B820',rock:'#B8A038',ghost:'#705898',dragon:'#7038F8',dark:'#705848',steel:'#B8B8D0',fairy:'#EE99AC'};

// ── SPRITES ───────────────────────────────────────────────────
// Sprite cache to avoid repeated failed requests
const spriteCache={};
const IMAGE_PROXY_BASE='https://images.weserv.nl/?url=';
const MAX_CLOUD_URL='assets/max-cloud.svg';
const MAX_TYPE_LABELS={dynamax:'Dynamax',gmax:'Gigantamax'};
// ── GENDER DIFFERENCES ──────────────────────────────────────
// Dex numbers where PokeAPI has a distinct /female/{id}.png sprite.
// Comprehensive list from PokeAPI sprites repo (sprites/pokemon/female/).
// Sourced from Bulbapedia "List of Pokémon with gender differences".
const GENDER_DIFF_DEX_FEMALE=new Set([
  // Gen 1 (subtle but distinct sprites in PokeAPI)
  3,12,19,20,25,26,41,42,44,45,64,65,84,85,97,111,112,118,119,123,129,130,
  // Gen 2
  154,165,166,178,185,186,190,194,195,198,202,203,207,208,212,214,215,217,221,224,229,232,
  // Gen 3
  255,256,257,267,269,272,274,275,307,308,315,316,317,322,323,332,350,369,
  // Gen 4 — most extensive gender differences added here
  396,397,398,399,400,401,402,403,404,405,407,415,417,418,419,424,443,444,445,449,450,453,454,456,457,459,460,461,464,465,473,
  // Gen 5+
  521,592,593,
  // Gen 6
  668,678,
  // Gen 8+
  876
]);
// Pokémon with VERY noticeable gender differences (different colors, body shape, etc.)
// — always swap sprite even on small thumbnails
const GENDER_DIFF_MAJOR=new Set([449,450,521,592,593,668,678,757,876]);
// Pokémon where one gender is the only form that evolves into the next stage
// (useful context for trade lists — e.g., only female Combee → Vespiquen)
const GENDER_EVOLUTION_LOCKED={415:'f',678:'both',876:'both',758:'f'}; // 758=Salazzle is female-only species
function femaleSpriteUrl(no){
  const n=parseInt(no);
  if(!Number.isFinite(n)||!GENDER_DIFF_DEX_FEMALE.has(n))return null;
  return`${SPRITE_BASE}female/${n}.png`;
}

const REGIONAL_FORM_IDS={"A-Rattata": 10091, "A-Raichu": 10100, "A-Sandshrew": 10101, "A-Vulpix": 10103, "A-Diglett": 10105, "A-Meowth": 10107, "A-Geodude": 10109, "A-Grimer": 10112, "A-Exeggutor": 10114, "A-Marowak": 10115, "G-Meowth": 10161, "G-Ponyta": 10162, "G-Slowpoke": 10164, "G-Farfetch'd": 10166, "G-Weezing": 10167, "G-Mr_ Mime": 10168, "G-Articuno":10169, "Galarian Articuno":10169, "G-Zapdos":10170, "Galarian Zapdos":10170, "G-Moltres":10171, "Galarian Moltres":10171, "G-Corsola": 10173, "G-Zigzagoon": 10174, "G-Darumaka": 10176, "G-Yamask": 10179, "G-Stunfisk": 10180, "H-Growlithe": 10229, "H-Voltorb": 10231, "H-Typhlosion": 10233, "H-Qwilfish": 10234, "H-Sneasel": 10235, "H-Samurott": 10236, "H-Lilligant": 10237, "H-Zorua": 10238, "H-Braviary": 10240, "H-Sliggoo": 10241, "H-Avalugg": 10243, "H-Decidueye": 10244, "P-Tauros": 10250, "P-Tauros (Combat)": 10250, "P-Tauros (Blaze)": 10251, "P-Tauros (Fire)": 10251, "P-Tauros (Aqua)": 10252, "P-Tauros (Water)": 10252, "P-Wooper": 10253, "Castform (Sunny)": 10013, "Castform (Rainy)": 10014, "Castform (Snowy)": 10015};
// Form-specific sprite IDs/filenames from PokeAPI sprites. These are CORS-safe for canvas export.
const COSTUME_FORM_SPRITE_IDS={
  "Unown (A)":201,"Unown (B)":"201-b","Unown (C)":"201-c","Unown (D)":"201-d",
  "Unown (E)":"201-e","Unown (F)":"201-f","Unown (G)":"201-g","Unown (H)":"201-h",
  "Unown (I)":"201-i","Unown (J)":"201-j","Unown (K)":"201-k","Unown (L)":"201-l",
  "Unown (M)":"201-m","Unown (N)":"201-n","Unown (O)":"201-o","Unown (P)":"201-p",
  "Unown (Q)":"201-q","Unown (R)":"201-r","Unown (S)":"201-s","Unown (T)":"201-t",
  "Unown (U)":"201-u","Unown (V)":"201-v","Unown (W)":"201-w","Unown (X)":"201-x",
  "Unown (Y)":"201-y","Unown (Z)":"201-z","Unown (!)":"201-exclamation","Unown (?)":"201-question",
  "Castform (Normal)":351,"Castform (Sunny)":10013,"Castform (Rainy)":10014,"Castform (Snowy)":10015,
  "Burmy (Plant)":412,"Burmy (Sandy)":"412-sandy","Burmy (Trash)":"412-trash",
  "Wormadam (Plant)":413,"Wormadam (Sandy)":10004,"Wormadam (Trash)":10005,
  "Cherrim (Overcast)":421,"Cherrim (Sunny)":"421-sunshine",
  "Shellos (Pink)":422,"Shellos (Blue)":"422-east",
  "Rotom":479,"Rotom (Heat)":10008,"Rotom (Wash)":10009,"Rotom (Frost)":10010,"Rotom (Fan)":10011,"Rotom (Mow)":10012,
  "Basculin (Red Stripe)":550,"Basculin (Blue Stripe)":10016,"Basculin (White Stripe)":10247,
  "Deerling (Spring)":585,"Deerling (Summer)":"585-summer","Deerling (Autumn)":"585-autumn","Deerling (Winter)":"585-winter",
  "Sawsbuck (Spring)":586,"Sawsbuck (Summer)":"586-summer","Sawsbuck (Autumn)":"586-autumn","Sawsbuck (Winter)":"586-winter",
  "Flabébé (Red Flower)":669,"Flabébé (Yellow Flower)":"669-yellow","Flabébé (Orange Flower)":"669-orange","Flabébé (Blue Flower)":"669-blue","Flabébé (White Flower)":"669-white",
  "Furfrou (Heart)":"676-heart","Furfrou (Star)":"676-star","Furfrou (Diamond)":"676-diamond",
  "Furfrou (Debutante)":"676-debutante","Furfrou (Matron)":"676-matron","Furfrou (Dandy)":"676-dandy",
  "Furfrou (La Reine)":"676-la-reine","Furfrou (Kabuki)":"676-kabuki","Furfrou (Pharaoh)":"676-pharaoh",
  "Pumpkaboo - Average":710,"Pumpkaboo - Small":10027,"Pumpkaboo - Large":10028,"Pumpkaboo - Super":10029,
  "Oricorio (Baile)":741,"Oricorio (Pom-Pom)":10123,"Oricorio (Pa'u)":10124,"Oricorio (Sensu)":10125,
  "Wishiwashi (Solo)":746,"Wishiwashi (School)":10127,
  "Toxtricity (Amped)":849,"Toxtricity (Low Key)":10184,
  "Squawkabilly (Green)":931,"Squawkabilly (Blue)":10260,"Squawkabilly (Yellow)":10261,"Squawkabilly (White)":10262,
  "Tatsugiri (Curly)":978,"Tatsugiri ":978,"Tatsugiri (Droopy)":10258,"Tatsugiri (Stretchy)":10259,
  "Pikachu (Libre)":10084,"Pikachu (Rock Star)":10080,"Pikachu (Pop Star)":10082,"Pikachu (Ph_D)":10083,
  "Archipelago":"666-archipelago","Continental":"666-continental","Elegant":"666-elegant",
  "Fancy":"666-fancy","Garden":"666-garden","High Plains":"666-high-plains","Meadow":"666-meadow",
  "Icy Snow":"666-icy-snow","Jungle":"666-jungle","Marine":"666-marine",
  "Modern":"666-modern","Monsoon":"666-monsoon","Ocean":"666-ocean",
  "Polar":"666-polar","Poké Ball":"666-poke-ball","River":"666-river",
  "Sandstorm":"666-sandstorm","Savanna":"666-savanna","Sun":"666-sun","Tundra":"666-tundra",
  // Vivillon variants stored as "Vivillon (Pattern)" — alias to the same sprite IDs
  "Vivillon (Archipelago)":"666-archipelago","Vivillon (Continental)":"666-continental",
  "Vivillon (Elegant)":"666-elegant","Vivillon (Fancy)":"666-fancy","Vivillon (Garden)":"666-garden",
  "Vivillon (High Plains)":"666-high-plains","Vivillon (Meadow)":"666-meadow",
  "Vivillon (Icy Snow)":"666-icy-snow","Vivillon (Jungle)":"666-jungle","Vivillon (Marine)":"666-marine",
  "Vivillon (Modern)":"666-modern","Vivillon (Monsoon)":"666-monsoon","Vivillon (Ocean)":"666-ocean",
  "Vivillon (Polar)":"666-polar","Vivillon (Poké Ball)":"666-poke-ball","Vivillon (Pokeball)":"666-poke-ball",
  "Vivillon (River)":"666-river","Vivillon (Sandstorm)":"666-sandstorm","Vivillon (Savanna)":"666-savanna",
  "Vivillon (Sun)":"666-sun","Vivillon (Tundra)":"666-tundra",
  // ── Legendary multi-form sprites (PokeAPI form variant IDs) ──
  "Deoxys (Normal)":386,"Deoxys (Attack)":10001,"Deoxys (Defense)":10002,"Deoxys (Speed)":10003,
  "Giratina (Altered)":487,"Giratina (Origin)":10007,
  "Shaymin (Land)":492,"Shaymin (Sky)":10006,
  "Tornadus (Incarnate)":641,"Tornadus (Therian)":10019,
  "Thundurus (Incarnate)":642,"Thundurus (Therian)":10020,
  "Landorus (Incarnate)":645,"Landorus (Therian)":10021,
  "Keldeo (Ordinary)":647,"Keldeo (Resolute)":10024,
  "Zygarde (50%)":718,"Zygarde (10%)":10118,"Zygarde (Complete)":10119,
  "Hoopa (Confined)":720,"Hoopa (Unbound)":10086,
  "Necrozma (Dusk Mane)":10155,"Necrozma (Dawn Wings)":10156,
  "Zacian (Hero)":888,"Zacian (Crowned)":10245,
  "Zamazenta (Hero)":889,"Zamazenta (Crowned)":10246,
  "Calyrex (Ice Rider)":10193,"Calyrex (Shadow Rider)":10194,
  "Dialga (Origin)":10247,"Palkia (Origin)":10248,
  "Enamorus (Incarnate)":905,"Enamorus (Therian)":10251,
  "Ogerpon (Teal Mask)":1017,"Ogerpon (Wellspring Mask)":10272,
  "Ogerpon (Hearthflame Mask)":10273,"Ogerpon (Cornerstone Mask)":10274
};
const EXTRA_COSTUME_ENTRIES=[{"no":1,"name":"Bulbasaur Party Hat","displayName":"Bulbasaur Party Hat","spriteUrl":"","users":{}},{"no":1,"name":"Bulbasaur Pikachu Visor","displayName":"Bulbasaur Pikachu Visor","spriteUrl":"","users":{}},{"no":2,"name":"Ivysaur Party Hat","displayName":"Ivysaur Party Hat","spriteUrl":"","users":{}},{"no":3,"name":"Venusaur Party Hat","displayName":"Venusaur Party Hat","spriteUrl":"","users":{}},{"no":4,"name":"Charmander Party Hat","displayName":"Charmander Party Hat","spriteUrl":"","users":{}},{"no":4,"name":"Charmander Pikachu Visor","displayName":"Charmander Pikachu Visor","spriteUrl":"","users":{}},{"no":5,"name":"Charmeleon Party Hat","displayName":"Charmeleon Party Hat","spriteUrl":"","users":{}},{"no":6,"name":"Charizard Party Hat","displayName":"Charizard Party Hat","spriteUrl":"","users":{}},{"no":7,"name":"Squirtle Halloween","displayName":"Squirtle Halloween","spriteUrl":"","users":{}},{"no":7,"name":"Squirtle Party Hat","displayName":"Squirtle Party Hat","spriteUrl":"","users":{}},{"no":7,"name":"Squirtle Pikachu Visor","displayName":"Squirtle Pikachu Visor","spriteUrl":"","users":{}},{"no":8,"name":"Wartortle Sunglasses","displayName":"Wartortle Sunglasses","spriteUrl":"","users":{}},{"no":8,"name":"Wartortle Party Hat","displayName":"Wartortle Party Hat","spriteUrl":"","users":{}},{"no":9,"name":"Blastoise Sunglasses","displayName":"Blastoise Sunglasses","spriteUrl":"","users":{}},{"no":9,"name":"Blastoise Party Hat","displayName":"Blastoise Party Hat","spriteUrl":"","users":{}},{"no":12,"name":"Butterfree Fashionable","displayName":"Butterfree Fashionable","spriteUrl":"","users":{}},{"no":20,"name":"Raticate Party Hat","displayName":"Raticate Party Hat","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Party Hat","displayName":"Pikachu Party Hat","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Original Cap","displayName":"Pikachu Original Cap","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Beanie","displayName":"Pikachu Beanie","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Party Hat 2020","displayName":"Pikachu Party Hat 2020","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu (VS 2019)","displayName":"Pikachu (VS 2019)","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Flower Hat","displayName":"Pikachu Flower Hat","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Costume 2020","displayName":"Pikachu Costume 2020","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Winter Carnival Outfit","displayName":"Pikachu Winter Carnival Outfit","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Kariyushi","displayName":"Pikachu Kariyushi","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu GO Fest 2021","displayName":"Pikachu GO Fest 2021","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Halloween Mischief","displayName":"Pikachu Halloween Mischief","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Flying Okinawa","displayName":"Pikachu Flying Okinawa","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Gracidea","displayName":"Pikachu Gracidea","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Flying 01","displayName":"Pikachu Flying 01","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Berry Shirt","displayName":"Pikachu Berry Shirt","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Flying 02","displayName":"Pikachu Flying 02","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Party Top Hat","displayName":"Pikachu Party Top Hat","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu May Bow","displayName":"Pikachu May Bow","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Cherry Blossoms","displayName":"Pikachu Cherry Blossoms","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Quartz Crown","displayName":"Pikachu Quartz Crown","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Pyrite Crown","displayName":"Pikachu Pyrite Crown","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Malachite Crown","displayName":"Pikachu Malachite Crown","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Aquamarine Crown","displayName":"Pikachu Aquamarine Crown","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Amethyst Crown","displayName":"Pikachu Amethyst Crown","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Flying 03","displayName":"Pikachu Flying 03","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Doctor","displayName":"Pikachu Doctor","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Fall 2023","displayName":"Pikachu Fall 2023","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Akari Kerchief","displayName":"Pikachu Akari Kerchief","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Flying 04","displayName":"Pikachu Flying 04","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Horizons","displayName":"Pikachu Horizons","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Moon Crown","displayName":"Pikachu Moon Crown","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Sun Crown","displayName":"Pikachu Sun Crown","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Nate Visor","displayName":"Pikachu Nate Visor","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Rosa Visor","displayName":"Pikachu Rosa Visor","spriteUrl":"","users":{}},{"no":25,"name":"Dapper Pikachu Blue Accents","displayName":"Dapper Pikachu Blue Accents","spriteUrl":"","users":{}},{"no":25,"name":"Dapper Pikachu Red Accents","displayName":"Dapper Pikachu Red Accents","spriteUrl":"","users":{}},{"no":25,"name":"Dapper Pikachu Yellow Accents","displayName":"Dapper Pikachu Yellow Accents","spriteUrl":"","users":{}},{"no":25,"name":"Formal Pikachu Blue Accents","displayName":"Formal Pikachu Blue Accents","spriteUrl":"","users":{}},{"no":25,"name":"Formal Pikachu Red Accents","displayName":"Formal Pikachu Red Accents","spriteUrl":"","users":{}},{"no":25,"name":"Formal Pikachu Yellow Accents","displayName":"Formal Pikachu Yellow Accents","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Indonesia 2025","displayName":"Pikachu Indonesia 2025","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Varsity Jacket","displayName":"Pikachu Varsity Jacket","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Baseball Shirt","displayName":"Pikachu Baseball Shirt","spriteUrl":"","users":{}},{"no":25,"name":"Pikachu Marathon Visor","displayName":"Pikachu Marathon Visor","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Santa Hat","displayName":"Raichu Santa Hat","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Witch Hat","displayName":"Raichu Witch Hat","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Party Hat","displayName":"Raichu Party Hat","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Original Cap","displayName":"Raichu Original Cap","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Summer Style","displayName":"Raichu Summer Style","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Flower Crown","displayName":"Raichu Flower Crown","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Fragment Cap","displayName":"Raichu Fragment Cap","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Detective","displayName":"Raichu Detective","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Beanie","displayName":"Raichu Beanie","spriteUrl":"","users":{}},{"no":26,"name":"Raichu World Cap","displayName":"Raichu World Cap","spriteUrl":"","users":{}},{"no":26,"name":"Raichu New Year","displayName":"Raichu New Year","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Cherry Blossoms","displayName":"Raichu Cherry Blossoms","spriteUrl":"","users":{}},{"no":26,"name":"Raichu Holiday 2023","displayName":"Raichu Holiday 2023","spriteUrl":"","users":{}},{"no":31,"name":"Nidoqueen Crown","displayName":"Nidoqueen Crown","spriteUrl":"","users":{}},{"no":33,"name":"Nidorino Party Hat","displayName":"Nidorino Party Hat","spriteUrl":"","users":{}},{"no":34,"name":"Nidoking Crown","displayName":"Nidoking Crown","spriteUrl":"","users":{}},{"no":37,"name":"Vulpix Spooky Festival","displayName":"Vulpix Spooky Festival","spriteUrl":"","users":{}},{"no":38,"name":"Ninetales Spooky Festival","displayName":"Ninetales Spooky Festival","spriteUrl":"","users":{}},{"no":40,"name":"Wigglytuff Ribbon","displayName":"Wigglytuff Ribbon","spriteUrl":"","users":{}},{"no":50,"name":"Diglett Fashionable Hat","displayName":"Diglett Fashionable Hat","spriteUrl":"","users":{}},{"no":51,"name":"Dugtrio Fashionable Hat","displayName":"Dugtrio Fashionable Hat","spriteUrl":"","users":{}},{"no":54,"name":"Psyduck Holiday Attire","displayName":"Psyduck Holiday Attire","spriteUrl":"","users":{}},{"no":54,"name":"Psyduck Swim Ring","displayName":"Psyduck Swim Ring","spriteUrl":"","users":{}},{"no":55,"name":"Golduck Holiday 2023","displayName":"Golduck Holiday 2023","spriteUrl":"","users":{}},{"no":77,"name":"Ponyta Galarian GO Fest 2021","displayName":"Ponyta Galarian GO Fest 2021","spriteUrl":"","users":{}},{"no":78,"name":"Rapidash Candela motif","displayName":"Rapidash Candela motif","spriteUrl":"","users":{}},{"no":79,"name":"Slowpoke 2020","displayName":"Slowpoke 2020","spriteUrl":"","users":{}},{"no":79,"name":"Slowpoke Hat","displayName":"Slowpoke Hat","spriteUrl":"","users":{}},{"no":80,"name":"Slowpoke 2021","displayName":"Slowpoke 2021","spriteUrl":"","users":{}},{"no":89,"name":"Muk Party Hat","displayName":"Muk Party Hat","spriteUrl":"","users":{}},{"no":94,"name":"Gengar Party Hat","displayName":"Gengar Party Hat","spriteUrl":"","users":{}},{"no":94,"name":"Gengar Halloween","displayName":"Gengar Halloween","spriteUrl":"","users":{}},{"no":94,"name":"Gengar Spooky Festival","displayName":"Gengar Spooky Festival","spriteUrl":"","users":{}},{"no":94,"name":"Gengar Fall 2023","displayName":"Gengar Fall 2023","spriteUrl":"","users":{}},{"no":104,"name":"Cubone Cempasuchil Crown","displayName":"Cubone Cempasuchil Crown","spriteUrl":"","users":{}},{"no":105,"name":"Marowak Cempasuchil Crown","displayName":"Marowak Cempasuchil Crown","spriteUrl":"","users":{}},{"no":125,"name":"Electabuzz Spark motif","displayName":"Electabuzz Spark motif","spriteUrl":"","users":{}},{"no":132,"name":"Ditto Yellow Party Hat","displayName":"Ditto Yellow Party Hat","spriteUrl":"","users":{}},{"no":132,"name":"Ditto Blue Party Hat","displayName":"Ditto Blue Party Hat","spriteUrl":"","users":{}},{"no":133,"name":"Eevee Party Hat","displayName":"Eevee Party Hat","spriteUrl":"","users":{}},{"no":133,"name":"Eevee Holiday 2023","displayName":"Eevee Holiday 2023","spriteUrl":"","users":{}},{"no":133,"name":"Eevee Cherry Blossoms","displayName":"Eevee Cherry Blossoms","spriteUrl":"","users":{}},{"no":133,"name":"Eevee Moon Crown","displayName":"Eevee Moon Crown","spriteUrl":"","users":{}},{"no":133,"name":"Eevee Sun Crown","displayName":"Eevee Sun Crown","spriteUrl":"","users":{}},{"no":134,"name":"Vaporeon Flower Crown","displayName":"Vaporeon Flower Crown","spriteUrl":"","users":{}},{"no":134,"name":"Vaporeon holiday 2023","displayName":"Vaporeon holiday 2023","spriteUrl":"","users":{}},{"no":134,"name":"Vaporeon Cherry Blossoms","displayName":"Vaporeon Cherry Blossoms","spriteUrl":"","users":{}},{"no":134,"name":"Vaporeon Explorer Hat","displayName":"Vaporeon Explorer Hat","spriteUrl":"","users":{}},{"no":135,"name":"Jolteon Flower Crown","displayName":"Jolteon Flower Crown","spriteUrl":"","users":{}},{"no":135,"name":"Jolteon Holiday 2023","displayName":"Jolteon Holiday 2023","spriteUrl":"","users":{}},{"no":135,"name":"Jolteon Cherry Blossoms","displayName":"Jolteon Cherry Blossoms","spriteUrl":"","users":{}},{"no":135,"name":"Jolteon Explorer Hat","displayName":"Jolteon Explorer Hat","spriteUrl":"","users":{}},{"no":136,"name":"Flareon Flower Crown","displayName":"Flareon Flower Crown","spriteUrl":"","users":{}},{"no":136,"name":"Flareon Holiday 2023","displayName":"Flareon Holiday 2023","spriteUrl":"","users":{}},{"no":136,"name":"Flareon Cherry Blossoms","displayName":"Flareon Cherry Blossoms","spriteUrl":"","users":{}},{"no":136,"name":"Flareon Explorer Hat","displayName":"Flareon Explorer Hat","spriteUrl":"","users":{}},{"no":143,"name":"Snorlax Night Cap","displayName":"Snorlax Night Cap","spriteUrl":"","users":{}},{"no":149,"name":"Dragonite Fashionable","displayName":"Dragonite Fashionable","spriteUrl":"","users":{}},{"no":150,"name":"Mewtwo (Armored)","displayName":"Mewtwo (Armored)","spriteUrl":"","users":{}},{"no":163,"name":"Hoothoot New Years","displayName":"Hoothoot New Years","spriteUrl":"","users":{}},{"no":164,"name":"Noctowl New Years 2022","displayName":"Noctowl New Years 2022","spriteUrl":"","users":{}},{"no":172,"name":"Pichu Original Cap","displayName":"Pichu Original Cap","spriteUrl":"","users":{}},{"no":172,"name":"Pichu Beanie","displayName":"Pichu Beanie","spriteUrl":"","users":{}},{"no":172,"name":"Pichu Cherry Blossoms","displayName":"Pichu Cherry Blossoms","spriteUrl":"","users":{}},{"no":185,"name":"Sudowoodo Holiday 2025","displayName":"Sudowoodo Holiday 2025","spriteUrl":"","users":{}},{"no":194,"name":"Wooper Fashionable","displayName":"Wooper Fashionable","spriteUrl":"","users":{}},{"no":195,"name":"Quagsire Fashionable","displayName":"Quagsire Fashionable","spriteUrl":"","users":{}},{"no":196,"name":"Espeon Flower Crown","displayName":"Espeon Flower Crown","spriteUrl":"","users":{}},{"no":196,"name":"Espeon Holiday 2023","displayName":"Espeon Holiday 2023","spriteUrl":"","users":{}},{"no":196,"name":"Espeon Cherry Blossoms","displayName":"Espeon Cherry Blossoms","spriteUrl":"","users":{}},{"no":196,"name":"Espeon Explorer Hat","displayName":"Espeon Explorer Hat","spriteUrl":"","users":{}},{"no":196,"name":"Espeon Day Scarf","displayName":"Espeon Day Scarf","spriteUrl":"","users":{}},{"no":197,"name":"Umbreon Flower Crown","displayName":"Umbreon Flower Crown","spriteUrl":"","users":{}},{"no":197,"name":"Umbreon Holiday 2023","displayName":"Umbreon Holiday 2023","spriteUrl":"","users":{}},{"no":197,"name":"Umbreon Cherry Blossoms","displayName":"Umbreon Cherry Blossoms","spriteUrl":"","users":{}},{"no":197,"name":"Umbreon Explorer Hat","displayName":"Umbreon Explorer Hat","spriteUrl":"","users":{}},{"no":197,"name":"Umbreon Night Scarf","displayName":"Umbreon Night Scarf","spriteUrl":"","users":{}},{"no":199,"name":"Slowking 2022","displayName":"Slowking 2022","spriteUrl":"","users":{}},{"no":202,"name":"Wobbuffet Party Hat","displayName":"Wobbuffet Party Hat","spriteUrl":"","users":{}},{"no":215,"name":"Sneasel Fashion","displayName":"Sneasel Fashion","spriteUrl":"","users":{}},{"no":216,"name":"Teddiursa Witch Hat","displayName":"Teddiursa Witch Hat","spriteUrl":"","users":{}},{"no":217,"name":"Ursaring Witch Hat","displayName":"Ursaring Witch Hat","spriteUrl":"","users":{}},{"no":222,"name":"Galarian Corsola Pink Sunglasses","displayName":"Galarian Corsola Pink Sunglasses","spriteUrl":"","users":{}},{"no":225,"name":"Delibird Holidays","displayName":"Delibird Holidays","spriteUrl":"","users":{}},{"no":234,"name":"Stantler Holiday","displayName":"Stantler Holiday","spriteUrl":"","users":{}},{"no":263,"name":"Zigzagoon Galarian GO Fest 2021","displayName":"Zigzagoon Galarian GO Fest 2021","spriteUrl":"","users":{}},{"no":265,"name":"Wurmple Party","displayName":"Wurmple Party","spriteUrl":"","users":{}},{"no":282,"name":"Gardevoir GO Fest 2021","displayName":"Gardevoir GO Fest 2021","spriteUrl":"","users":{}},{"no":287,"name":"Slakoth Visor","displayName":"Slakoth Visor","spriteUrl":"","users":{}},{"no":288,"name":"Vigoroth Visor","displayName":"Vigoroth Visor","spriteUrl":"","users":{}},{"no":289,"name":"Slaking Visor","displayName":"Slaking Visor","spriteUrl":"","users":{}},{"no":302,"name":"Sableye Halloween","displayName":"Sableye Halloween","spriteUrl":"","users":{}},{"no":330,"name":"Flygon GO Fest 2021","displayName":"Flygon GO Fest 2021","spriteUrl":"","users":{}},{"no":355,"name":"Duskull Cempasuchil Crown","displayName":"Duskull Cempasuchil Crown","spriteUrl":"","users":{}},{"no":356,"name":"Dusclops Cempasuchil Crown","displayName":"Dusclops Cempasuchil Crown","spriteUrl":"","users":{}},{"no":359,"name":"Absol Fashionable Costume","displayName":"Absol Fashionable Costume","spriteUrl":"","users":{}},{"no":393,"name":"Piplup Halloween Mischief","displayName":"Piplup Halloween Mischief","spriteUrl":"","users":{}},{"no":426,"name":"Drifblim Halloween Mischief","displayName":"Drifblim Halloween Mischief","spriteUrl":"","users":{}},{"no":427,"name":"Buneary Flower Crown","displayName":"Buneary Flower Crown","spriteUrl":"","users":{}},{"no":428,"name":"Lopunny Flower Crown","displayName":"Lopunny Flower Crown","spriteUrl":"","users":{}},{"no":453,"name":"Croagunk Backwards Cap","displayName":"Croagunk Backwards Cap","spriteUrl":"","users":{}},{"no":454,"name":"Toxicroak Backwards Cap","displayName":"Toxicroak Backwards Cap","spriteUrl":"","users":{}},{"no":466,"name":"Electivire Spark motif","displayName":"Electivire Spark motif","spriteUrl":"","users":{}},{"no":470,"name":"Leafeon Flower Crown","displayName":"Leafeon Flower Crown","spriteUrl":"","users":{}},{"no":470,"name":"Leafeon Holiday 2023","displayName":"Leafeon Holiday 2023","spriteUrl":"","users":{}},{"no":470,"name":"Leafeon Cherry Blossoms","displayName":"Leafeon Cherry Blossoms","spriteUrl":"","users":{}},{"no":470,"name":"Leafeon Explorer Hat","displayName":"Leafeon Explorer Hat","spriteUrl":"","users":{}},{"no":471,"name":"Glaceon Flower Crown","displayName":"Glaceon Flower Crown","spriteUrl":"","users":{}},{"no":471,"name":"Glaceon Holiday 2023","displayName":"Glaceon Holiday 2023","spriteUrl":"","users":{}},{"no":471,"name":"Glaceon Cherry Blossoms","displayName":"Glaceon Cherry Blossoms","spriteUrl":"","users":{}},{"no":471,"name":"Glaceon Explorer Hat","displayName":"Glaceon Explorer Hat","spriteUrl":"","users":{}},{"no":477,"name":"Dusknoir Cempasuchil Crown","displayName":"Dusknoir Cempasuchil Crown","spriteUrl":"","users":{}},{"no":522,"name":"Blitzle Fashionable","displayName":"Blitzle Fashionable","spriteUrl":"","users":{}},{"no":547,"name":"Whimsicott Flower Crown","displayName":"Whimsicott Flower Crown","spriteUrl":"","users":{}},{"no":573,"name":"Cinccino Fashionable Costume","displayName":"Cinccino Fashionable Costume","spriteUrl":"","users":{}},{"no":613,"name":"Cubchoo Holidays","displayName":"Cubchoo Holidays","spriteUrl":"","users":{}},{"no":614,"name":"Beartic Holidays","displayName":"Beartic Holidays","spriteUrl":"","users":{}},{"no":656,"name":"Froakie Witch Hat","displayName":"Froakie Witch Hat","spriteUrl":"","users":{}},{"no":657,"name":"Frogadier Witch Hat","displayName":"Frogadier Witch Hat","spriteUrl":"","users":{}},{"no":658,"name":"Greninja Witch Hat","displayName":"Greninja Witch Hat","spriteUrl":"","users":{}},{"no":700,"name":"Sylveon Flower Crown","displayName":"Sylveon Flower Crown","spriteUrl":"","users":{}},{"no":700,"name":"Sylveon Holiday","displayName":"Sylveon Holiday","spriteUrl":"","users":{}},{"no":700,"name":"Sylveon Cherry Blossoms","displayName":"Sylveon Cherry Blossoms","spriteUrl":"","users":{}},{"no":700,"name":"Sylveon Explorer Hat","displayName":"Sylveon Explorer Hat","spriteUrl":"","users":{}},{"no":710,"name":"Pumpkaboo Average Size","displayName":"Pumpkaboo Average Size","spriteUrl":"","users":{}},{"no":710,"name":"Pumpkaboo Super Size","displayName":"Pumpkaboo Super Size","spriteUrl":"","users":{}},{"no":711,"name":"Gourgeist Small Size","displayName":"Gourgeist Small Size","spriteUrl":"","users":{}},{"no":710,"name":"Pumpkaboo Small Size","displayName":"Pumpkaboo Small Size","spriteUrl":"","users":{}},{"no":710,"name":"Pumpkaboo Large Size","displayName":"Pumpkaboo Large Size","spriteUrl":"","users":{}},{"no":711,"name":"Gourgeist Super Size","displayName":"Gourgeist Super Size","spriteUrl":"","users":{}},{"no":711,"name":"Gourgeist Average Size","displayName":"Gourgeist Average Size","spriteUrl":"","users":{}},{"no":711,"name":"Gourgeist Large Size","displayName":"Gourgeist Large Size","spriteUrl":"","users":{}},{"no":714,"name":"Noibat Headband","displayName":"Noibat Headband","spriteUrl":"","users":{}},{"no":715,"name":"Noivern Headband","displayName":"Noivern Headband","spriteUrl":"","users":{}},{"no":723,"name":"Dartrix Halloween","displayName":"Dartrix Halloween","spriteUrl":"","users":{}},{"no":724,"name":"Decidueye Halloween","displayName":"Decidueye Halloween","spriteUrl":"","users":{}},{"no":737,"name":"Charjabug Holiday 2025","displayName":"Charjabug Holiday 2025","spriteUrl":"","users":{}},{"no":738,"name":"Vikavolt Holiday 2025","displayName":"Vikavolt Holiday 2025","spriteUrl":"","users":{}},{"no":760,"name":"Bewear Wilderness Cape","displayName":"Bewear Wilderness Cape","spriteUrl":"","users":{}},{"no":832,"name":"Dubwool Holiday Attire","displayName":"Dubwool Holiday Attire","spriteUrl":"","users":{}},{"no":870,"name":"Falinks Train","displayName":"Falinks Train","spriteUrl":"","users":{}},{"no":901,"name":"Ursaluna Witch Hat","displayName":"Ursaluna Witch Hat","spriteUrl":"","users":{}},{"no":907,"name":"Floragato Hat With Likos Pin","displayName":"Floragato Hat With Likos Pin","spriteUrl":"","users":{}},{"no":999,"name":"Gimmighoul 9th Anniversary Coin","displayName":"Gimmighoul 9th Anniversary Coin","spriteUrl":"","users":{}}];
// Additional form identities. When no permitted exact artwork is available,
// the resolver intentionally falls back to the species sprite.
const EXTRA_FORM_ENTRIES=[
  // Spinda — 8 standard spot patterns in Pokémon GO + heart form
  {no:327,name:"Spinda (Form 1)",displayName:"Spinda (Form 1)",spriteUrl:"",users:{}},
  {no:327,name:"Spinda (Form 2)",displayName:"Spinda (Form 2)",spriteUrl:"",users:{}},
  {no:327,name:"Spinda (Form 3)",displayName:"Spinda (Form 3)",spriteUrl:"",users:{}},
  {no:327,name:"Spinda (Form 4)",displayName:"Spinda (Form 4)",spriteUrl:"",users:{}},
  {no:327,name:"Spinda (Form 5)",displayName:"Spinda (Form 5)",spriteUrl:"",users:{}},
  {no:327,name:"Spinda (Form 6)",displayName:"Spinda (Form 6)",spriteUrl:"",users:{}},
  {no:327,name:"Spinda (Form 7)",displayName:"Spinda (Form 7)",spriteUrl:"",users:{}},
  {no:327,name:"Spinda (Form 8)",displayName:"Spinda (Form 8)",spriteUrl:"",users:{}},
  {no:327,name:"Spinda (Heart)",displayName:"Spinda (Heart)",spriteUrl:"",users:{}},
  ...SCATTERBUG_PATTERNS.map(pattern=>({no:664,name:`Scatterbug (${pattern})`,displayName:`Scatterbug (${pattern})`,spriteUrl:`${SPRITE_BASE}664.png`,users:{}})),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(ch=>({no:201,name:`Unown (${ch})`,displayName:`Unown (${ch})`,users:{}})),
  {no:201,name:"Unown (!)",displayName:"Unown (!)",users:{}},
  {no:201,name:"Unown (?)",displayName:"Unown (?)",users:{}}
];
const LEGENDARY_AVATAR_ENTRIES=[
  [144,'Articuno'],[144,'G-Articuno','Galarian Articuno'],[145,'Zapdos'],[145,'G-Zapdos','Galarian Zapdos'],[146,'Moltres'],[146,'G-Moltres','Galarian Moltres'],[150,'Mewtwo'],[151,'Mew'],
  [243,'Raikou'],[244,'Entei'],[245,'Suicune'],[249,'Lugia'],[250,'Ho-Oh'],[251,'Celebi'],
  [377,'Regirock'],[378,'Regice'],[379,'Registeel'],[380,'Latias'],[381,'Latios'],[382,'Kyogre'],[383,'Groudon'],[384,'Rayquaza'],[385,'Jirachi'],
  // Deoxys — Normal + Attack/Defense/Speed Forme (all tradeable in GO)
  [386,'Deoxys (Normal)'],[386,'Deoxys (Attack)'],[386,'Deoxys (Defense)'],[386,'Deoxys (Speed)'],
  [480,'Uxie'],[481,'Mesprit'],[482,'Azelf'],
  // Sinnoh creation trio — Dialga & Palkia got Hisuian Origin Formes; Giratina has Altered + Origin
  [483,'Dialga'],[483,'Dialga (Origin)'],
  [484,'Palkia'],[484,'Palkia (Origin)'],
  [485,'Heatran'],[486,'Regigigas'],
  [487,'Giratina (Altered)'],[487,'Giratina (Origin)'],
  [488,'Cresselia'],[489,'Phione'],[490,'Manaphy'],[491,'Darkrai'],
  [492,'Shaymin (Land)'],[492,'Shaymin (Sky)'],
  [493,'Arceus'],
  [638,'Cobalion'],[639,'Terrakion'],[640,'Virizion'],
  // Kami trio — Incarnate + Therian
  [641,'Tornadus (Incarnate)'],[641,'Tornadus (Therian)'],
  [642,'Thundurus (Incarnate)'],[642,'Thundurus (Therian)'],
  [643,'Reshiram'],[644,'Zekrom'],
  [645,'Landorus (Incarnate)'],[645,'Landorus (Therian)'],
  [646,'Kyurem'],
  [647,'Keldeo (Ordinary)'],[647,'Keldeo (Resolute)'],
  [648,'Meloetta'],[649,'Genesect'],
  [716,'Xerneas'],[717,'Yveltal'],
  // Zygarde — 10% / 50% / Complete
  [718,'Zygarde (50%)'],[718,'Zygarde (10%)'],[718,'Zygarde (Complete)'],
  [719,'Diancie'],
  [720,'Hoopa (Confined)'],[720,'Hoopa (Unbound)'],
  [721,'Volcanion'],
  [772,'Type: Null'],[773,'Silvally'],[785,'Tapu Koko'],[786,'Tapu Lele'],[787,'Tapu Bulu'],[788,'Tapu Fini'],[789,'Cosmog'],[790,'Cosmoem'],[791,'Solgaleo'],[792,'Lunala'],[793,'Nihilego'],[794,'Buzzwole'],[795,'Pheromosa'],[796,'Xurkitree'],[797,'Celesteela'],[798,'Kartana'],[799,'Guzzlord'],
  // Necrozma — base + fused Dusk Mane (Solgaleo) / Dawn Wings (Lunala)
  [800,'Necrozma'],[800,'Necrozma (Dusk Mane)'],[800,'Necrozma (Dawn Wings)'],
  [801,'Magearna'],[802,'Marshadow'],
  // Ultra Beasts released after Marshadow (Ultra Sun / Ultra Moon batch)
  [803,'Poipole'],[804,'Naganadel'],[805,'Stakataka'],[806,'Blacephalon'],
  [807,'Zeraora'],[808,'Meltan'],[809,'Melmetal'],
  // Zacian / Zamazenta — Hero + Crowned forms
  [888,'Zacian (Hero)'],[888,'Zacian (Crowned)'],
  [889,'Zamazenta (Hero)'],[889,'Zamazenta (Crowned)'],
  [890,'Eternatus'],[891,'Kubfu'],[892,'Urshifu'],[893,'Zarude'],[894,'Regieleki'],[895,'Regidrago'],[896,'Glastrier'],[897,'Spectrier'],
  // Calyrex — base + Ice Rider (Glastrier-fused) / Shadow Rider (Spectrier-fused)
  [898,'Calyrex'],[898,'Calyrex (Ice Rider)'],[898,'Calyrex (Shadow Rider)'],
  [905,'Enamorus (Incarnate)'],[905,'Enamorus (Therian)'],
  [1001,'Wo-Chien'],[1002,'Chien-Pao'],[1003,'Ting-Lu'],[1004,'Chi-Yu'],[1007,'Koraidon'],[1008,'Miraidon'],[1009,'Walking Wake'],[1010,'Iron Leaves'],[1014,'Okidogi'],[1015,'Munkidori'],[1016,'Fezandipiti'],
  // Ogerpon — four masks
  [1017,'Ogerpon (Teal Mask)'],[1017,'Ogerpon (Wellspring Mask)'],[1017,'Ogerpon (Hearthflame Mask)'],[1017,'Ogerpon (Cornerstone Mask)'],
  [1020,'Gouging Fire'],[1021,'Raging Bolt'],[1022,'Iron Boulder'],[1023,'Iron Crown'],[1024,'Terapagos'],[1025,'Pecharunt']
].map(([no,name,displayName])=>({no,name,displayName:displayName||name,users:{}}));
function isApprovedRuntimeSpriteUrl(url){
  const value=String(url||'').trim();
  if(!value)return false;
  if(value==='assets/max-cloud.svg')return true;
  let parsed;
  try{parsed=new URL(value,document.baseURI);}catch{return false;}
  if(parsed.hostname==='raw.githubusercontent.com')return parsed.pathname.startsWith('/PokeAPI/sprites/');
  if(parsed.hostname==='img.pokemondb.net')return parsed.pathname.startsWith('/sprites/');
  if(parsed.hostname==='images.weserv.nl'){
    const target=parsed.searchParams.get('url')||'';
    try{
      const targetUrl=new URL(/^https?:\/\//.test(target)?target:`https://${target}`);
      return targetUrl.hostname==='img.pokemondb.net'&&targetUrl.pathname.startsWith('/sprites/');
    }catch{return false;}
  }
  if(parsed.origin!==location.origin)return false;
  return parsed.pathname.endsWith('/assets/max-cloud.svg')||/\/assets\/sprites\/go\/[a-z0-9-]+\.png$/i.test(parsed.pathname);
}
function canvasSafeSpriteUrl(url){
  if(!isApprovedRuntimeSpriteUrl(url))return'';
  if(url.startsWith(POKEMONDB_BASE)){
    return IMAGE_PROXY_BASE+encodeURIComponent(url.replace(/^https?:\/\//,''));
  }
  return url;
}
function spriteCatalogContext(no,name='',dn='',catalogId=''){
  const rawName=String(name||dn||'').trim();
  const resolved=pokemonCatalogDomain.resolveLegacyKey(rawName)||pokemonCatalogDomain.resolveLegacyKey(dn);
  const decorated=pokemonCatalogDomain.decorateCatalogEntry({no:Number(no)||null,name:resolved?.canonicalKey||rawName,displayName:dn||rawName,catalogId:catalogId||resolved?.catalogId});
  const canonicalId=catalogId||resolved?.catalogId||decorated?.catalogId||'';
  const lookupKeys=[decorated?.name,...(decorated?.spriteLookupKeys||[]),rawName,dn].filter(Boolean);
  const uniqueLookupKeys=Object.freeze([...new Set(lookupKeys)]);
  const reviewed=costumeSpriteCatalogDomain.resolve({names:uniqueLookupKeys});
  const unresolved=reviewed?.status==='unavailable'||lookupKeys.some(isUnresolvedSpriteKey);
  return Object.freeze({catalogId:canonicalId,canonicalName:decorated?.name||rawName,lookupKeys:uniqueLookupKeys,reviewed,unresolved,override:canonicalSpriteOverride(canonicalId)});
}
function entrySpriteUrl(entry,nameOverride='',gender=''){
  const resolvedName=nameOverride||entry?.name||entry?.displayName||'';
  const context=spriteCatalogContext(entry?.no,resolvedName,entry?.displayName||resolvedName,entry?.catalogId);
  if(isApprovedRuntimeSpriteUrl(context.override?.url))return context.override.url;
  const reviewed=costumeSpriteCatalogDomain.resolution({names:context.lookupKeys,gender});
  if(reviewed.knownVariant)return reviewed.urls[0]||null;
  const storedUrl=entry?.spriteUrl||entry?.sprite||'';
  if(isApprovedRuntimeSpriteUrl(storedUrl))return storedUrl;
  return spriteUrl(entry?.no,resolvedName,gender,entry?.displayName||resolvedName,context.catalogId);
}
// Resolves the BEST QUALITY sprite URL.
// Priority: verified Pokémon Database GO mappings, PokeAPI forms, Pokémon
// Database HOME renders, then PokeAPI base art. Research-only sources never
// enter the runtime URL chain.
// The actual <img> uses spriteFallbackChain() for graceful 404 cascade.
function spriteUrl(no,name,gender='',dn='',catalogId=''){
  const context=spriteCatalogContext(no,name,dn,catalogId);
  if(isApprovedRuntimeSpriteUrl(context.override?.url))return context.override.url;
  const reviewed=costumeSpriteCatalogDomain.resolution({names:context.lookupKeys,gender});
  if(reviewed.knownVariant)return reviewed.urls[0]||null;
  const lookupName=context.canonicalName||name;
  const compatibilityKeys=context.lookupKeys;
  // 1. PokeAPI form variants (Unown, Vivillon, Furfrou, and game forms).
  const formKey=compatibilityKeys.find(key=>COSTUME_FORM_SPRITE_IDS[key]);
  if(formKey)return`${SPRITE_BASE}${COSTUME_FORM_SPRITE_IDS[formKey]}.png`;
  // 2. PokeAPI regional form (Alolan, Galarian, Hisuian, Paldean) — but
  //    a few form IDs map to PokeAPI placeholder PNGs (200 OK, ~400 bytes,
  //    no real character art). For those we skip ahead so PokemonDB HOME wins.
  const regionalKey=compatibilityKeys.find(key=>REGIONAL_FORM_IDS[key]);
  if(regionalKey&&!POKEAPI_PLACEHOLDER_FORM_IDS.has(REGIONAL_FORM_IDS[regionalKey])){
    return`${SPRITE_BASE}${REGIONAL_FORM_IDS[regionalKey]}.png`;
  }
  // 3. PokeAPI female sprite (Pyroar ♀, Pikachu ♀ tail, etc.) should outrank plain base art.
  if(gender==='f'){
    const fUrl=femaleSpriteUrl(no);
    if(fUrl)return fUrl;
  }
  // 4. Pokémon Database HOME render, then PokeAPI base.
  const pdb=pokemondbSpriteUrl(lookupName,dn||lookupName,gender);
  if(pdb)return pdb;
  if(!no)return null;
  const n=parseInt(no);
  if(isNaN(n))return null;
  return`${SPRITE_BASE}${n}.png`;
}
// ── EXTERNAL SPRITE SOURCES ───────────────────────────────────
// PokemonDB hosts high-quality Pokémon HOME 3D renders with broad form/gender
// coverage. URL pattern: img.pokemondb.net/sprites/home/normal/{slug}.png
const POKEMONDB_BASE='https://img.pokemondb.net/sprites/home/normal/';
// PokeAPI form IDs that return 200 OK with a ~400-byte placeholder PNG instead
// of real sprite art (PokeAPI is inconsistent about which regional forms have
// proper assets). Without skipping these, the resolver lands on the placeholder
// and the user sees a "missing image" icon. Discovered via sprite-audit v4.6.17.
const POKEAPI_PLACEHOLDER_FORM_IDS=new Set([
  10105, // A-Diglett
  10179  // G-Yamask
]);
function pokemondbSpriteUrl(name,dn,gender=''){
  const slug=pokemondbSlug(name,dn,gender);
  return slug?`${POKEMONDB_BASE}${slug}.png`:'';
}

// Build a cascading fallback chain of sprite URLs.
// Strategy:
//   1. Reviewed, self-hosted Pokémon Database GO mapping
//   2. PokeAPI form/regional/gender variants
//   3. Pokémon Database HOME render
//   4. PokeAPI base dex
function spriteFallbackChain(no,name,gender='',dn='',catalogId=''){
  const urls=[];
  const push=u=>{if(isApprovedRuntimeSpriteUrl(u)&&!urls.includes(u))urls.push(u);};
  const context=spriteCatalogContext(no,name,dn,catalogId);
  push(context.override?.url);
  const reviewed=costumeSpriteCatalogDomain.resolution({names:context.lookupKeys,gender});
  if(reviewed.knownVariant){for(const url of reviewed.urls)push(url);return urls;}
  // Primary URL (from spriteUrl — uses GO costume slugs first now)
  const primary=spriteUrl(no,name,gender,dn,context.catalogId);
  push(primary);
  const compatibilityKeys=context.lookupKeys;
  const safeName=context.canonicalName||name;
  // PokeAPI specific form variants
  for(const key of compatibilityKeys){
    if(REGIONAL_FORM_IDS[key])push(`${SPRITE_BASE}${REGIONAL_FORM_IDS[key]}.png`);
    if(COSTUME_FORM_SPRITE_IDS[key])push(`${SPRITE_BASE}${COSTUME_FORM_SPRITE_IDS[key]}.png`);
  }
  if(gender==='f')push(femaleSpriteUrl(no));
  // Pokémon Database HOME for form/regional/gender variants.
  push(pokemondbSpriteUrl(safeName,dn||safeName,gender));
  if(gender==='f'){
    push(pokemondbSpriteUrl(safeName,dn||safeName,''));   // PokemonDB without -female suffix
    if(primary&&primary.includes('/female/')&&no){
      push(`${SPRITE_BASE}${parseInt(no)}.png`); // PokeAPI base when /female/ 404s
    }
  }
  const dex=padDex(no);
  if(dex){
    // PokeAPI canonical base dex (always exists)
    push(`${SPRITE_BASE}${parseInt(no)}.png`);
  }
  return urls;
}
// ── PER-IMAGE SPRITE NORMALIZATION ─────────────────────────────
// Different Pokémon have different padding within their sprites — Joltik fills 30% of frame,
// Mewtwo fills 85%. Detect each sprite's actual character bounds via canvas + persist scale.
// _v4 (4.6.15) — cache shape grew to { scale, cx, cy, t }. cx/cy are the
// character bounding-box centre as a fraction of source dimensions; we use
// them as transform-origin so scaling up doesn't drift the character off the
// tile when the source isn't perfectly centred.
// Older _v3 caches lacked cx/cy and would have rendered the v4.6.13 "always
// scale ≥ 1.4" floor with the wrong anchor — visible misalignment.
const SPRITE_SCALE_CACHE_KEY='pogoSpriteScales_v4';
const SPRITE_TARGET_FILL=0.86; // character should fill ~86% of cell after scaling
let spriteScaleCache={};
try{spriteScaleCache=JSON.parse(localStorage.getItem(SPRITE_SCALE_CACHE_KEY)||'{}')||{};}catch{}
const SPRITE_SCALE_CONCURRENCY=4;
const _scaleDetectInflight=new Map();
const _scaleDetectQueue=[];
let _scaleDetectActive=0;
// LRU-ish cap on the scale cache. Without this, every unique URL ever
// rendered (costume variants × species × shiny × gender combinations) sits
// in localStorage forever. At ~1000 entries it's ~60KB, mostly harmless,
// but it grows monotonically and contributes to localStorage quota pressure
// over time. Drop the oldest 20% when we cross the threshold.
const SPRITE_SCALE_CACHE_MAX=800;
function _trimScaleCache(){
  const keys=Object.keys(spriteScaleCache);
  if(keys.length<=SPRITE_SCALE_CACHE_MAX)return;
  const drop=Math.ceil(keys.length*0.2);
  keys.sort((a,b)=>(spriteScaleCache[a]?.t||0)-(spriteScaleCache[b]?.t||0));
  for(let i=0;i<drop;i++)delete spriteScaleCache[keys[i]];
}
function _saveScaleCache(){
  try{
    _trimScaleCache();
    localStorage.setItem(SPRITE_SCALE_CACHE_KEY,JSON.stringify(spriteScaleCache));
  }catch(e){
    // Quota likely — try one aggressive trim then give up silently.
    try{
      const keys=Object.keys(spriteScaleCache).sort((a,b)=>(spriteScaleCache[a]?.t||0)-(spriteScaleCache[b]?.t||0));
      for(let i=0;i<Math.ceil(keys.length*0.5);i++)delete spriteScaleCache[keys[i]];
      localStorage.setItem(SPRITE_SCALE_CACHE_KEY,JSON.stringify(spriteScaleCache));
    }catch{}
  }
}
// Coarse default per source — used as fallback while detection runs (or fails on CORS).
function spriteSourceScale(url){
  if(!url)return 1;
  if(url.includes('pokemondb.net'))return 1.1;
  if(url.includes('weserv.nl')){
    return 1.1;
  }
  if(/PokeAPI|pokeapi/.test(url))return 1.25;
  return 1.15;
}
// Run alpha-channel detection through weserv proxy (CORS-safe). Cache by URL.
function _drainSpriteScaleQueue(){
  while(_scaleDetectActive<SPRITE_SCALE_CONCURRENCY&&_scaleDetectQueue.length){
    const task=_scaleDetectQueue.shift();
    _scaleDetectActive++;
    Promise.resolve().then(()=>_runSpriteScaleDetection(task.url)).catch(()=>{
      if(spriteScaleCache[task.url]===undefined){spriteScaleCache[task.url]={scale:spriteSourceScale(task.url),cx:0.5,cy:0.5,t:Date.now()};_saveScaleCache();}
    }).finally(()=>{
      _scaleDetectActive--;
      _scaleDetectInflight.delete(task.url);
      task.resolve(spriteScaleCache[task.url]);
      _drainSpriteScaleQueue();
    });
  }
}
function detectSpriteScale(url){
  if(!url)return Promise.resolve(null);
  if(spriteScaleCache[url]!==undefined)return Promise.resolve(spriteScaleCache[url]);
  if(_scaleDetectInflight.has(url))return _scaleDetectInflight.get(url);
  let resolveTask;
  const pending=new Promise(resolve=>{resolveTask=resolve;});
  _scaleDetectInflight.set(url,pending);
  _scaleDetectQueue.push({url,resolve:resolveTask});
  _drainSpriteScaleQueue();
  return pending;
}
function _runSpriteScaleDetection(url){
  return new Promise(resolve=>{
  let settled=false;
  const finish=()=>{if(settled)return;settled=true;clearTimeout(timeout);resolve();};
  const timeout=setTimeout(()=>{
    if(spriteScaleCache[url]===undefined){spriteScaleCache[url]={scale:spriteSourceScale(url),cx:0.5,cy:0.5,t:Date.now()};_saveScaleCache();}
    finish();
  },6000);
  // Use the approved proxy for CORS-friendly optical analysis.
  const absoluteUrl=new URL(url,document.baseURI);
  const proxiedUrl=absoluteUrl.origin===location.origin
    ?absoluteUrl.href
    :url.startsWith('https://images.weserv.nl/')
      ?url
      :IMAGE_PROXY_BASE+encodeURIComponent(url.replace(/^https?:\/\//,''));
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{
    let scale=spriteSourceScale(url);
    // Character center as fraction of source dimensions (0..1). Default 0.5/0.5
    // = "right at image center", which is what unprocessed images render at —
    // so cache hits without cx/cy values behave identically to old behaviour.
    let cx=0.5,cy=0.5;
    try{
      const c=document.createElement('canvas');
      const W=img.naturalWidth||1,H=img.naturalHeight||1;
      c.width=W;c.height=H;
      const g=c.getContext('2d',{willReadFrequently:true});
      g.drawImage(img,0,0);
      const{data}=g.getImageData(0,0,W,H);
      // Fast edge-walk bounds detection. Threshold 60 (was 10) so antialiased
      // edges and soft drop-shadows don't count as character — they would
      // otherwise both inflate fill % (under-scaling) and pull the bounding-box
      // centre away from the actual character (misalignment).
      let top=0,bottom=H-1,left=0,right=W-1;
      const opaque=(x,y)=>data[(y*W+x)*4+3]>60;
      outerT:for(top=0;top<H;top++){for(let x=0;x<W;x++){if(opaque(x,top))break outerT;}}
      outerB:for(bottom=H-1;bottom>=0;bottom--){for(let x=0;x<W;x++){if(opaque(x,bottom))break outerB;}}
      outerL:for(left=0;left<W;left++){for(let y=top;y<=bottom;y++){if(opaque(left,y))break outerL;}}
      outerR:for(right=W-1;right>=0;right--){for(let y=top;y<=bottom;y++){if(opaque(right,y))break outerR;}}
      if(right>=left&&bottom>=top){
        const trimSize=Math.max(right-left+1,bottom-top+1);
        const frameSize=Math.max(W,H);
        const fill=trimSize/frameSize;
        if(fill<SPRITE_TARGET_FILL&&fill>0.1){
          scale=Math.min(2.2,SPRITE_TARGET_FILL/fill);
        }else if(fill>=SPRITE_TARGET_FILL){
          scale=1;
        }
        // Character centroid as fraction of source — used as transform-origin
        // so scaling around it doesn't drift the character.
        cx=((left+right+1)/2)/W;
        cy=((top+bottom+1)/2)/H;
      }
    }catch(e){
      // CORS or canvas error — keep default
    }
    spriteScaleCache[url]={
      scale:Math.round(scale*100)/100,
      cx:Math.round(cx*1000)/1000,
      cy:Math.round(cy*1000)/1000,
      t:Date.now()
    };
    _saveScaleCache();
    // Apply to all rendered images using this URL
    _updateRenderedScale(url,spriteScaleCache[url]);
    finish();
  };
  img.onerror=()=>{
    spriteScaleCache[url]={scale:spriteSourceScale(url),cx:0.5,cy:0.5,t:Date.now()};
    _saveScaleCache();
    finish();
  };
  img.src=proxiedUrl;
  });
}
// Builds the per-image transform: anchors scaling at the character centroid
// (transform-origin in %) so the character stays put as it grows, instead of
// drifting outward by (offset × (scale-1)) when the source isn't centered.
function _spriteTransform(scale,cx,cy,offsetX=0,offsetY=0){
  const ox=Math.round((cx??0.5)*1000)/10; // % of element
  const oy=Math.round((cy??0.5)*1000)/10;
  return{
    transform:`translate(${Number(offsetX)||0}px,${Number(offsetY)||0}px) scale(${scale})`,
    transformOrigin:`${ox}% ${oy}%`
  };
}
function _updateRenderedScale(url,entry){
  document.querySelectorAll('img[data-src-key]').forEach(img=>{
    if(img.dataset.srcKey===url){
      const cap=parseFloat(img.dataset.scaleCap||'');
      const rawScale=entry?.scale||1;
      const opticalScale=parseFloat(img.dataset.opticalScale||'1')||1;
      const adjustedScale=rawScale*opticalScale;
      const scale=Number.isFinite(cap)&&cap>0?Math.min(adjustedScale,cap):adjustedScale;
      const{transform,transformOrigin}=_spriteTransform(scale,entry?.cx,entry?.cy,img.dataset.opticalX,img.dataset.opticalY);
      img.style.transform=transform;
      img.style.transformOrigin=transformOrigin;
    }
  });
}
function effectiveSpriteScale(url){
  const cached=spriteScaleCache[url];
  return cached?cached.scale:spriteSourceScale(url);
}
// Pulls the cached character-centroid for a URL, falling back to image center
// when detection hasn't run yet (or failed). Same shape as effectiveSpriteScale.
function effectiveSpriteOrigin(url){
  const c=spriteScaleCache[url];
  return{cx:(c&&typeof c.cx==='number'?c.cx:0.5),cy:(c&&typeof c.cy==='number'?c.cy:0.5)};
}
function spriteImg(no,size=40,cls='',name='',gender='',dn='',opts={}){
  const context=spriteCatalogContext(no,name,dn,opts?.catalogId);
  const urls=[
    ...(context.override?.url?[context.override.url]:[]),
    ...(opts?.urlOverride?[opts.urlOverride]:[]),
    ...spriteFallbackChain(no,name,gender,dn,context.catalogId)
  ].filter((u,i,arr)=>isApprovedRuntimeSpriteUrl(u)&&arr.indexOf(u)===i);
  if(!urls.length){
    const knownUnavailable=context.reviewed?.status==='unavailable';
    const label=i18nCore.t('sprite.artUnavailable',{name:dn||name||'Pokémon'});
    return`<span class="pc-sprite-placeholder ${knownUnavailable?'known-unavailable':''} ${escAttr(cls)}" style="width:${size}px;height:${size}px" role="img" aria-label="${escAttr(label)}" title="${escAttr(label)}">?</span>`;
  }
  const url=urls[0];
  const isGo=url.includes('weserv.nl')||url.includes('/sprites/go/');
  const rendering=isGo?'auto':'pixelated';
  const optical=context.override||{};
  const rawScale=effectiveSpriteScale(url)*(Number(optical.opticalScale)||1);
  const scaleCap=Number.isFinite(opts?.scaleCap)?opts.scaleCap:null;
  const scale=scaleCap?Math.min(rawScale,scaleCap):rawScale;
  const{cx,cy}=effectiveSpriteOrigin(url);
  const{transform,transformOrigin}=_spriteTransform(scale,cx,cy,optical.opticalOffsetX,optical.opticalOffsetY);
  const fallbacks=urls.slice(1).map(u=>u.replace(/"/g,'&quot;')).join('|');
  return`<img src="${url}" data-src-key="${escAttr(url)}" class="${cls||'pc-sprite'}" width="${size}" height="${size}" alt="" title="${escAttr(name||'Pokémon')}"
    style="image-rendering:${rendering};object-fit:contain;transform:${transform};transform-origin:${transformOrigin};clip-path:inset(0)"
    data-catalog-id="${escAttr(context.catalogId)}" data-optical-scale="${Number(optical.opticalScale)||1}" data-optical-x="${Number(optical.opticalOffsetX)||0}" data-optical-y="${Number(optical.opticalOffsetY)||0}"
    data-scale-cap="${scaleCap||''}" data-fallbacks="${fallbacks}" onload="validateSpriteLoad(this)" onerror="trySpriteFallback(this)" loading="lazy" decoding="async">`;
}
function validateSpriteLoad(img){
  if(!img||img.dataset.spriteValidated===img.currentSrc)return;
  img.dataset.spriteValidated=img.currentSrc;
  if((img.naturalWidth||0)<=1||(img.naturalHeight||0)<=1){trySpriteFallback(img);return;}
  // The browser's native lazy loader decides when the real sprite is relevant.
  // Optical analysis begins only after that sprite has actually loaded.
  detectSpriteScale(img.dataset.srcKey);
}
function trySpriteFallback(img){
  const fbs=(img.dataset.fallbacks||'').split('|').filter(Boolean);
  if(!fbs.length){img.style.display='none';return;}
  const next=fbs.shift();
  img.dataset.fallbacks=fbs.join('|');
  img.dataset.srcKey=next;
  img.dataset.spriteValidated='';
  img.style.imageRendering=next.includes('weserv.nl')||next.includes('/sprites/go/')?'auto':'pixelated';
  const cap=parseFloat(img.dataset.scaleCap||'');
  const opticalScale=parseFloat(img.dataset.opticalScale||'1')||1;
  const rawScale=effectiveSpriteScale(next)*opticalScale;
  const scale=Number.isFinite(cap)&&cap>0?Math.min(rawScale,cap):rawScale;
  const{cx,cy}=effectiveSpriteOrigin(next);
  const{transform,transformOrigin}=_spriteTransform(scale,cx,cy,img.dataset.opticalX,img.dataset.opticalY);
  img.style.transform=transform;
  img.style.transformOrigin=transformOrigin;
  img.src=next;
}

// ── SESSION PERSISTENCE ──────────────────────────────────────
// Uses localStorage (NOT sessionStorage) so users stay logged in across:
//   – tab close/reopen
//   – browser restart
//   – PWA app close/reopen
// The session is refreshed on every meaningful activity (login, tab focus,
// any write) so active users effectively never expire. Only abandoned sessions
// hit the 30-day TTL and get logged out.
// Migration: if the user has a legacy sessionStorage token, copy it to localStorage.
(()=>{
  try{
    const legacyUser=sessionStorage.getItem('pgu');
    const legacyTs=sessionStorage.getItem('pguts');
    if(legacyUser&&!localStorage.getItem('pgu')){
      localStorage.setItem('pgu',legacyUser);
      localStorage.setItem('pguts',legacyTs||Date.now().toString());
    }
    sessionStorage.removeItem('pgu');sessionStorage.removeItem('pguts');
  }catch{}
})();
function checkSession(){
  try{
    const ts=parseInt(localStorage.getItem('pguts')||'0');
    const user=localStorage.getItem('pgu');
    if(!user||!ts)return null;
    if(Date.now()-ts>SESSION_TTL){
      localStorage.removeItem('pgu');localStorage.removeItem('pguts');
      return null;
    }
    return user;
  }catch{return null;}
}
function stampSession(u){
  try{
    localStorage.setItem('pgu',u);
    localStorage.setItem('pguts',Date.now().toString());
  }catch{}
}
// Refresh the session timestamp without changing the user. Called on activity
// so the 30-day clock keeps resetting for active users.
function refreshSession(){
  try{
    if(localStorage.getItem('pgu'))localStorage.setItem('pguts',Date.now().toString());
  }catch{}
}

// ── SYNC QUEUE (offline support) ─────────────────────────────
function unsafeWholeListQueueEntry(path,item={}){
  if(item?.kind===sessionCacheBoundaryData.MY_LIST_UPDATE_KIND)return false;
  return sessionCacheBoundaryData.isWholeListReplacementPath(path)||
    sessionCacheBoundaryData.isWholeListReplacementPath(item?.path);
}
function queueSync(path,data){
  const item={kind:'set',path,data,ts:Date.now()};
  if(unsafeWholeListQueueEntry(path,item)){
    const quarantined=managedSessionCache.quarantineQueueEntry(path,item);
    if(quarantined.ok)showSessionStorageNotices();
    else toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);
    return false;
  }
  const previousQueue=syncQueue;
  syncQueue={...syncQueue,[path]:item};
  const saved=saveSyncQueue();
  if(!saved.ok){
    syncQueue=previousQueue;
    toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);
    return false;
  }
  showSyncDot(true);
  refreshSyncUi();
  if(firebaseAuthConfigured()&&auth&&!auth.currentUser)warnLocalOnlyMode();
  clearTimeout(syncFlushTimer);
  syncFlushTimer=setTimeout(flushSyncQueue,250);
  return true;
}
function queueItemIsCurrent(key,item){return syncQueue[key]===item;}
function queueMyListUpdate(type,u,patch){
  const patchValid=!!patch&&typeof patch==='object'&&!Array.isArray(patch);
  const changed=patchValid?Object.keys(patch).length:0;
  if(!patchValid||!changed)return Object.freeze({ok:false,status:'validation_failed',changed});
  const rootPath=`${type}/${u}`;
  const key=sessionCacheBoundaryData.myListUpdateQueueKey(rootPath);
  const existing=syncQueue[key];
  const merged=existing?.kind===sessionCacheBoundaryData.MY_LIST_UPDATE_KIND&&existing.path===rootPath
    ?{...existing.data}:{};
  const absorbed=[];
  Object.entries(syncQueue).forEach(([queuedKey,item])=>{
    if(queuedKey===key||(item?.kind!=null&&item.kind!=='set')||typeof item.path!=='string')return;
    const prefix=`${rootPath}/`;
    if(!item.path.startsWith(prefix))return;
    const name=item.path.slice(prefix.length);
    if(!name||name.includes('/'))return;
    merged[name]=item.data??null;
    absorbed.push(queuedKey);
  });
  Object.assign(merged,patch);
  const item={kind:sessionCacheBoundaryData.MY_LIST_UPDATE_KIND,path:rootPath,data:merged,ts:Date.now()};
  const owner=managedSessionCache.snapshot().activeOwner;
  if(!sessionCacheBoundaryData.queueEntryClassification(key,item,owner).ok){
    return Object.freeze({ok:false,status:'validation_failed',changed});
  }
  const previousQueue=syncQueue;
  const nextQueue={...syncQueue,[key]:item};
  absorbed.forEach(queuedKey=>delete nextQueue[queuedKey]);
  syncQueue=nextQueue;
  const saved=saveSyncQueue();
  if(!saved.ok){
    syncQueue=previousQueue;
    return Object.freeze({ok:false,status:'persistence_failed',changed,errorCode:saved.error?.code||'storage/queue-save-failed'});
  }
  showSyncDot(true);
  refreshSyncUi();
  clearTimeout(syncFlushTimer);
  syncFlushTimer=setTimeout(flushSyncQueue,250);
  return Object.freeze({ok:true,status:'queued',changed});
}
async function flushSyncQueue(){
  if(firebaseAuthConfigured()&&auth&&!auth.currentUser){
    // We have data to push but no Auth session — distinct from a network failure.
    setSyncStatus('localOnly');
    showSyncDot(!!Object.keys(syncQueue).length);
    return;
  }
  if(!fbOn||!db||!Object.keys(syncQueue).length)return;
  let canonicalOwnsLegacy=false;
  try{canonicalOwnsLegacy=await accountSyncRolloutEligible(auth?.currentUser?.uid);}
  catch(error){
    if(ACCOUNT_SYNC_ROLLOUT.enabled===true&&ACCOUNT_SYNC_ROLLOUT.writesEnabled===true){
      accountSyncMarkMutationBlocked(error?.code||'account-sync/rollout-check-failed');
      return;
    }
  }
  const entries=Object.entries(syncQueue);
  let permanentDrops=0;
  for(const[path,item] of entries){
    if(canonicalOwnsLegacy&&(accountSyncMigratedLegacyQueueItem(item,cur)||accountSyncQueuedProfileBoardItem(item,cur)))continue;
    const owner=managedSessionCache.snapshot().activeOwner;
    const classification=sessionCacheBoundaryData.queueEntryClassification(path,item,owner);
    if(unsafeWholeListQueueEntry(path,item)){
      const quarantined=managedSessionCache.quarantineQueueEntry(path,item);
      if(quarantined.ok){
        if(queueItemIsCurrent(path,item))delete syncQueue[path];
        saveSyncQueue();
        showSessionStorageNotices();
        refreshSyncUi();
      }
      continue;
    }
    if(!classification.ok){
      if(queueItemIsCurrent(path,item)){
        delete syncQueue[path];
        saveSyncQueue();
        refreshSyncUi();
        toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);
      }
      continue;
    }
    try{
      if(classification.kind===sessionCacheBoundaryData.MY_LIST_UPDATE_KIND)await update(ref(db,item.path),item.data);
      else await set(ref(db,item.path),item.data??null);
      if(queueItemIsCurrent(path,item))delete syncQueue[path];
      saveSyncQueue();
      refreshSyncUi();
      if(path===`publicShares/${cur}`&&activePublicShareHydrationToken&&publicShareSessionMatches(cur)){
        inspectOwnPublicShareAfterHydration(activePublicShareHydrationToken);
      }
    }catch(e){
      // Distinguish permanent rejection (rules said no — retrying won't help)
      // from transient failure (offline, network). Permanent rejections were
      // previously kept in the queue forever and re-attempted every 5s,
      // spamming the console and never succeeding. Drop them instead.
      const code=String(e?.code||e?.message||'').toUpperCase();
      if(code.includes('PERMISSION_DENIED')||code.includes('INVALID_TOKEN')||code.includes('UNAUTH')){
        if(queueItemIsCurrent(path,item)){
          delete syncQueue[path];
          saveSyncQueue();
          refreshSyncUi();
          permanentDrops++;
          console.warn(`flushSyncQueue: dropped ${path} (${code}). Server rejected it permanently; not retrying.`);
        }
      }
    }
  }
  if(permanentDrops>0){
    toast(i18nCore.t('storage.editsDidNotSync',{count:i18nCore.formatNumber(permanentDrops)}),5000);
  }
  if(!Object.keys(syncQueue).length)showSyncDot(false);
  else syncFlushTimer=setTimeout(flushSyncQueue,5000);
  refreshSyncUi();
}
function showSyncDot(show){document.getElementById('sqd')?.classList.toggle('show',show);refreshSyncUi();}
window.addEventListener('online',()=>{if(fbOn)flushSyncQueue();managedAccountSyncRuntime?.controller?.drain?.();});
let _authObserverBound=false;
let _localOnlyWarned=false;
let _authStateKnown=false;
const _authStateWaiters=[];
function warnLocalOnlyMode(){
  // The persistent header banner is now the primary signal — only fire a toast
  // for the very first edit in a local-only session so the user knows it's
  // saved but not synced.
  if(_localOnlyWarned)return;
  _localOnlyWarned=true;
  toast(i18nCore.t('storage.localOnlySaved'),4500);
  showSyncBanner();
}
// Debounce the "auth dropped" branch so transient blips (token refresh,
// brief reconnects, the few-hundred-ms gap between sign-in attempts) don't
// flash the local-only banner. If auth recovers within the debounce window,
// the show is cancelled silently. The "auth recovered" branch is NOT
// debounced — recovery should be immediate.
let _authDropTimer=null;
const AUTH_DROP_DEBOUNCE_MS=2500;
function bindAuthObserver(){
  if(_authObserverBound||!auth||typeof onAuthStateChanged!=='function')return;
  _authObserverBound=true;
  onAuthStateChanged(auth,user=>{
    if(user&&_lastAuthenticatedIdentityUid!==user.uid){
      resetMyListCategoryForAccountBoundary();
      _lastAuthenticatedIdentityUid=user.uid;
    }
    _authStateKnown=true;
    _authStateWaiters.splice(0).forEach(fn=>fn(user||null));
    syncPendingSettingsRouteAfterAuth();
    if(!user){
      resetSessionTransientUi('auth_loss');
      resetTrainerOrganizerState();
      resetFavoriteBrowseSession();
      trainerHistoryStore=null;
      managedListenerLifecycle.deactivateSession('auth_loss');
      managedOwnedDataCoordinator?.reset();
      suspendOwnedSession('auth_loss');
      allData=runtimeDataWithSelectedTrainer(getLocal());
    }
    currentAuthUid=user?.uid||'';
    if(document.getElementById('settings-modal')?.classList.contains('open'))renderConnectedAccounts();
    if(user){
      const rememberedUsername=cur||checkSession();
      if(rememberedUsername&&storedSessionMatches(user.uid,rememberedUsername)){
        try{
          if(!ownedSessionAlreadyActive(user.uid,rememberedUsername))activateOwnedSession(user.uid,rememberedUsername);
          cur=rememberedUsername;
        }catch(error){
          managedListenerLifecycle.deactivateSession('identity_mismatch');
          managedOwnedDataCoordinator?.reset();
          suspendOwnedSession('identity_mismatch');
          cur=null;
          try{localStorage.removeItem('pgu');localStorage.removeItem('pguts');}catch{}
          showLogin();
          toast(i18nCore.t('storage.sessionOwnershipMismatch'),6000);
          return;
        }
      }else if(rememberedUsername&&managedSessionCache.snapshot().cacheOwner){
        managedListenerLifecycle.deactivateSession('identity_mismatch');
        managedOwnedDataCoordinator?.reset();
        suspendOwnedSession('identity_mismatch');
        cur=null;
        try{localStorage.removeItem('pgu');localStorage.removeItem('pguts');}catch{}
        showLogin();
        toast(i18nCore.t('storage.sessionOwnershipMismatch'),6000);
        return;
      }
      // Cancel any pending "auth dropped" notification — turned out to be transient.
      if(_authDropTimer){clearTimeout(_authDropTimer);_authDropTimer=null;}
      _localOnlyWarned=false;
      // Auth recovered — setSyncStatus emits the "✅ Back online" toast if we were previously local-only/offline
      setSyncStatus(Object.keys(syncQueue).length?'syncing':'online');
      ensureProtectedSubscriptions();
      ensureAccountSyncRuntime().catch(error=>console.warn('Account sync startup failed',String(error?.code||'unknown')));
      if(_activeShareView?.username)ensureShareViewSubscriptions(_activeShareView.username);
      if(_pendingShareRequest)openShareViewFromRequest(_pendingShareRequest);
      if(firebaseDataProtectionReady&&auth?.currentUser?.uid===user.uid&&cur&&document.getElementById('app')?.style.display==='none'&&!document.getElementById('share-view')?.classList.contains('active'))showApp();
      if(Object.keys(syncQueue).length)flushSyncQueue();
      return;
    }
    if(!cur)return;
    document.querySelectorAll('.ov.open').forEach(el=>closeModal(el.id));
    document.getElementById('app').style.display='none';
    showLogin();
    if(_authDropTimer)return; // already pending
    _authDropTimer=setTimeout(()=>{
      _authDropTimer=null;
      // Re-check at fire time — auth might've recovered without the observer
      // running again (shouldn't happen, but defensive).
      if(auth?.currentUser)return;
      setSyncStatus('localOnly');
      if(Object.keys(syncQueue).length)warnLocalOnlyMode();
    },AUTH_DROP_DEBOUNCE_MS);
  });
}
function waitForAuthState(timeout=3500){
  if(!auth||typeof onAuthStateChanged!=='function'||_authStateKnown)return Promise.resolve(auth?.currentUser||null);
  return new Promise(resolve=>{
    let done=false;
    const finish=user=>{
      if(done)return;
      done=true;
      resolve(user||auth?.currentUser||null);
    };
    _authStateWaiters.push(finish);
    setTimeout(()=>finish(auth?.currentUser||null),timeout);
  });
}

// ── PIN HASHING ───────────────────────────────────────────────
async function hashPin(pin){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin+'pogo_salt_nyc'));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function verifyPin(pin,stored){
  // Normalize stored to string — Firebase may save numbers as numeric type
  const storedStr=String(stored??'');
  if(storedStr===pin)return true; // plaintext match
  return(await hashPin(pin))===storedStr;
}
function isSixDigitPin(pin){return/^\d{6}$/.test(pin);}
function lastLoginTime(username,data){
  return Number(data?.lastSeen||(data?.authUid&&allData.authIndex?.[data.authUid]?.lastSeen)||data?.lastUpdated||0);
}

// ── LOCAL STORAGE ─────────────────────────────────────────────
function lsGet(k,d){try{return JSON.parse(localStorage.getItem(k)??'null')??d}catch{return d}}
function lsSet(k,v){localStorage.setItem(k,JSON.stringify(v))}
function lsRemove(k){try{localStorage.removeItem(k)}catch{}}
let _pokemonGoSearchOverrideDraft=pokemonGoSearchSyntaxDomain.localeKey(i18nCore.getLocale());
function pokemonGoSearchLanguagePreference(){
  const value=lsGet(POGO_SEARCH_LANGUAGE_KEY,null),override=lsGet(POGO_SEARCH_LANGUAGE_OVERRIDE_KEY,false)===true;
  if(override&&pokemonGoSearchSyntaxDomain.SUPPORTED_LOCALES.includes(value))return value;
  // Older builds persisted a locale without recording whether the mismatch
  // was intentional. Only the explicit override bit is reliable evidence, so
  // ambiguous legacy values migrate to the interface-language default.
  if(value!==null)lsRemove(POGO_SEARCH_LANGUAGE_KEY);
  if(override)lsRemove(POGO_SEARCH_LANGUAGE_OVERRIDE_KEY);
  return'follow-app';
}
function pokemonGoSearchLocale(){
  const value=pokemonGoSearchLanguagePreference();
  return value==='follow-app'?pokemonGoSearchSyntaxDomain.localeKey(i18nCore.getLocale()):value;
}
function syncPokemonGoSearchLanguageControl(){
  const preference=pokemonGoSearchLanguagePreference();
  const override=preference!=='follow-app';
  if(override)_pokemonGoSearchOverrideDraft=preference;
  else if(!pokemonGoSearchSyntaxDomain.SUPPORTED_LOCALES.includes(_pokemonGoSearchOverrideDraft))_pokemonGoSearchOverrideDraft=pokemonGoSearchSyntaxDomain.localeKey(i18nCore.getLocale());
  const checkbox=document.getElementById('settings-search-language-override');
  const row=document.getElementById('settings-search-language-override-row');
  const select=document.getElementById('settings-search-language');
  if(checkbox){checkbox.checked=override;checkbox.setAttribute('aria-expanded',String(override));}
  if(row)row.hidden=!override;
  if(select){select.disabled=!override;select.value=override?preference:pokemonGoSearchSyntaxDomain.localeKey(i18nCore.getLocale());}
}
function rerenderPokemonGoSearchLanguageSurfaces(){
  if(cur){renderMyStrings();renderStrings();if(_activeDiff)renderDiffModal();if(_activeTradeMatch)renderTradeMatchModal();renderSafeTransferOutput();}
  if(_activeShareView?.username)renderShareView(_activeShareView.username,_activeShareView.type);
}
function changePokemonGoSearchLocale(value){
  const next=pokemonGoSearchSyntaxDomain.SUPPORTED_LOCALES.includes(value)?value:'follow-app';
  if(next==='follow-app'){lsRemove(POGO_SEARCH_LANGUAGE_KEY);lsRemove(POGO_SEARCH_LANGUAGE_OVERRIDE_KEY);}
  else{_pokemonGoSearchOverrideDraft=next;lsSet(POGO_SEARCH_LANGUAGE_OVERRIDE_KEY,true);lsSet(POGO_SEARCH_LANGUAGE_KEY,next);}
  syncPokemonGoSearchLanguageControl();
  rerenderPokemonGoSearchLanguageSurfaces();
  toast(i18nCore.t('settings.searchLanguageSaved'));
}
function togglePokemonGoSearchLocaleOverride(enabled){
  if(enabled){
    const selected=document.getElementById('settings-search-language')?.value;
    const interfaceLocale=pokemonGoSearchSyntaxDomain.localeKey(i18nCore.getLocale());
    changePokemonGoSearchLocale(pokemonGoSearchSyntaxDomain.SUPPORTED_LOCALES.includes(selected)?selected:(pokemonGoSearchSyntaxDomain.SUPPORTED_LOCALES.includes(_pokemonGoSearchOverrideDraft)?_pokemonGoSearchOverrideDraft:interfaceLocale));
    return;
  }
  const current=pokemonGoSearchLanguagePreference();
  if(current!=='follow-app')_pokemonGoSearchOverrideDraft=current;
  lsRemove(POGO_SEARCH_LANGUAGE_KEY);
  lsRemove(POGO_SEARCH_LANGUAGE_OVERRIDE_KEY);
  syncPokemonGoSearchLanguageControl();
  rerenderPokemonGoSearchLanguageSurfaces();
  toast(i18nCore.t('settings.searchLanguageSaved'));
}
function saveSyncQueue(){
  const result=managedSessionCache.writeQueue(syncQueue||{});
  if(!result.ok)syncQueue={};
  return result;
}
function sessionTransientCallback(callback){
  const generation=_sessionTransientGeneration;
  return(...args)=>{
    if(generation!==_sessionTransientGeneration)return false;
    callback(...args);
    return true;
  };
}
function resetSessionTransientUi(reason='session_boundary'){
  _sessionTransientGeneration++;
  if(typeof invalidateAccountSyncRecovery==='function')invalidateAccountSyncRecovery(reason);
  if(typeof e1ClientFoundationCanary!=='undefined'&&e1ClientFoundationCanary){e1ClientFoundationCanary.close();e1ClientFoundationCanary=null;}
  resetOwnedHydrationState();

  if(typeof trainerSuggestionTimer!=='undefined')clearTimeout(trainerSuggestionTimer);
  if(typeof favoriteSavedPromptTimer!=='undefined')clearTimeout(favoriteSavedPromptTimer);
  if(typeof _modalFocusTimer!=='undefined')clearTimeout(_modalFocusTimer);
  if(typeof _myHaveRenderTimer!=='undefined')clearTimeout(_myHaveRenderTimer);
  if(typeof _haveBrowseRenderTimer!=='undefined')clearTimeout(_haveBrowseRenderTimer);
  if(typeof trainerSuggestionTimer!=='undefined')trainerSuggestionTimer=0;
  if(typeof favoriteSavedPromptTimer!=='undefined')favoriteSavedPromptTimer=0;
  if(typeof _modalFocusTimer!=='undefined')_modalFocusTimer=null;
  if(typeof _myHaveRenderTimer!=='undefined')_myHaveRenderTimer=0;
  if(typeof _haveBrowseRenderTimer!=='undefined')_haveBrowseRenderTimer=0;
  if(undoTimer)clearTimeout(undoTimer);
  undoTimer=null;
  undoStack=null;
  if(_toastTimer)clearTimeout(_toastTimer);
  _toastTimer=null;
  if(_feedbackAnnouncementTimer)clearTimeout(_feedbackAnnouncementTimer);
  _feedbackAnnouncementTimer=null;
  _lastFeedbackAnnouncement={message:'',at:0};

  const undoToast=document.getElementById('undo-toast');
  if(undoToast){
    undoToast.classList.remove('show');
    undoToast.setAttribute('aria-hidden','true');
    undoToast.hidden=true;
  }
  const undoMessage=document.getElementById('undo-msg');
  if(undoMessage)undoMessage.textContent='';
  undoReturnFocus=null;
  const toastEl=document.getElementById('toast');
  if(toastEl){
    toastEl.classList.remove('show');
    toastEl.setAttribute('aria-hidden','true');
    toastEl.hidden=true;
    toastEl.textContent='';
  }
  const feedbackStatus=document.getElementById('feedback-status');
  if(feedbackStatus)feedbackStatus.textContent='';
  const favoriteSavedPrompt=document.getElementById('favorite-saved-prompt');
  if(favoriteSavedPrompt){favoriteSavedPrompt.hidden=true;const button=favoriteSavedPrompt.querySelector('button');if(button)button.onclick=null;}

  document.querySelectorAll('.ov.open').forEach(el=>el.classList.remove('open'));
  document.querySelectorAll('.conflict-notice').forEach(el=>el.remove());
  document.querySelectorAll('.undo-toast').forEach(el=>{if(el.id!=='undo-toast')el.remove();});
  document.querySelectorAll('.bulk-selected,.swiping,.swipe-action,.swipe-action-select').forEach(el=>{
    el.classList.remove('bulk-selected','swiping','swipe-action','swipe-action-select');
    if(el.style?.transform)el.style.transform='';
  });
  document.querySelectorAll('.bulk-check:checked,.have-bulk-check:checked').forEach(el=>{el.checked=false;});
  ['mylist-filter','have-filter','ac-input','add-pmon-sel','add-pmon-notes'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  closeAddAutocomplete();
  document.getElementById('have-ac-dropdown')?.classList.remove('open');
  const tray=document.getElementById('add-tray');
  if(tray){tray.hidden=true;tray.innerHTML='';}
  const syncBanner=document.getElementById('sync-banner');
  if(syncBanner)syncBanner.hidden=true;

  if(_modalKeyHandler)document.removeEventListener('keydown',_modalKeyHandler);
  _modalKeyHandler=null;
  _modalPrevFocus=null;
  _settingsScrollSnapshot=null;
  rpinTarget=null;
  addTray=[];
  acItems=[];acFiltered=[];acFocusIdx=-1;
  haveAcItems=[];haveAcFiltered=[];haveAcFocusIdx=-1;
  dragSrc=null;
  bulkMode=false;bulkSelected.clear();
  haveBulkMode=false;haveBulkSelected.clear();
  _safeTransferSelected=null;
  _qaSelected={lf:new Set(),ft:new Set()};
  _activeDiff=null;
  closeTradeMatchModal(false);
  _tradeComparisonReturn=null;
  _swipeState=null;
  _ptrState=null;
  if(voiceRecognition){try{voiceRecognition.abort();}catch{}voiceRecognition=null;}
  document.body?.classList.remove('bulk-mode','have-bulk-mode');
  return{ok:true,reason,generation:_sessionTransientGeneration};
}
function resetTransientUiBeforeSessionActivation(uid,username){
  const owner=managedSessionCache?.snapshot?.().activeOwner;
  if(!owner||owner.uid===uid&&owner.username===username)return false;
  resetSessionTransientUi('identity_switch');
  resetTrainerOrganizerState();
  resetFavoriteBrowseSession();
  trainerHistoryStore=null;
  return true;
}
function activateOwnedSession(uid,username){
  invalidateAccountSyncRecovery('session_activation');
  resetTransientUiBeforeSessionActivation(uid,username);
  const result=managedSessionCache.activate({uid,username});
  if(!result.ok){
    const error=new Error(result.error.message);
    error.code=result.error.code;
    throw error;
  }
  syncQueue=managedSessionCache.readQueue();
  allData=getLocal();
  showSessionStorageNotices();
  const hydration=managedPublicSharePublication.activate({uid,username});
  if(!hydration.ok){
    const error=new Error(hydration.error.message);
    error.code=hydration.error.code;
    throw error;
  }
  activePublicShareHydrationToken=hydration.token;
  ownerPublicShareReview={generation:hydration.token.generation,status:'waiting_for_hydration',republishRequired:false,busy:false};
  return result;
}
function storedSessionMatches(uid,username){
  const owner=managedSessionCache.snapshot().cacheOwner;
  return!!owner&&owner.uid===uid&&owner.username===username;
}
function ownedSessionAlreadyActive(uid,username){
  const owner=managedSessionCache.snapshot().activeOwner;
  return!!owner&&owner.uid===uid&&owner.username===username;
}
function suspendOwnedSession(reason='auth_loss'){
  invalidateAccountSyncRecovery(reason);
  stopAccountSyncRuntime().catch(error=>console.warn('Account sync shutdown failed',String(error?.code||'unknown')));
  managedPublicSharePublication.invalidate(reason);
  activePublicShareHydrationToken=null;
  ownerPublicShareReview={generation:0,status:'idle',republishRequired:false,busy:false};
  managedSessionCache.suspend(reason);
  syncQueue={};
  allData=getLocal();
}
function clearOwnedSession(){
  invalidateAccountSyncRecovery('logout');
  stopAccountSyncRuntime().catch(error=>console.warn('Account sync shutdown failed',String(error?.code||'unknown')));
  managedPublicSharePublication.invalidate('logout');
  activePublicShareHydrationToken=null;
  ownerPublicShareReview={generation:0,status:'idle',republishRequired:false,busy:false};
  managedSessionCache.clearForLogout();
  syncQueue={};
  allData=getLocal();
}
function showSessionStorageNotices(){
  managedSessionCache.drainNotices().forEach(code=>{
    const key={
      'storage/legacy-queue-discarded':'storage.pendingChangesDiscarded',
      'storage/queue-reset':'storage.pendingChangesDiscarded',
      'storage/queue-entry-discarded':'storage.pendingChangesDiscarded',
      'storage/cache-migrated':'storage.cacheReset',
      'storage/cache-reset':'storage.cacheReset',
      'storage/cache-owner-reset':'storage.cacheReset',
      'storage/whole-list-queue-quarantined':'storage.pendingListQuarantined'
    }[code];
    if(key)toast(i18nCore.t(key),5000);
  });
}
function communityRoleForUser(username,ud={}){
  if(ud?.isOwner||username===OWNER)return'owner';
  if(ud?.isAdmin)return'admin';
  return'member';
}
function strongerCommunityRole(a,b){
  const rank={member:0,admin:1,owner:2};
  return(rank[a]??-1)>=(rank[b]??-1)?a:b;
}
function normalizeCommunityId(id){
  const clean=String(id||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'');
  return clean||DEFAULT_COMMUNITY_ID;
}
function normalizeCommunityRecord(id,prev={},root={},opts={}){
  const cid=normalizeCommunityId(id);
  const users=root?.users||{};
  const isDefault=cid===DEFAULT_COMMUNITY_ID;
  const members={...(prev?.members||{})};
  const memberUsernames={...(prev?.memberUsernames||{})};
  const admins={...(prev?.admins||{})};
  const autoEnrollDefault=opts.autoEnrollDefault??(isDefault&&!prev?.preparedAt);
  if(isDefault&&autoEnrollDefault){
    Object.entries(users).forEach(([u,ud])=>{
      memberUsernames[u]=true;
      if(ud?.authUid){
        members[ud.authUid]=true;
        if(communityRoleForUser(u,ud)!=='member')admins[ud.authUid]=true;
      }
    });
  }
  const owner=users[OWNER]||{};
  const fallbackOwnerId=isDefault?(owner?.authUid||''):'';
  const fallbackOwnerUsername=isDefault?OWNER:'';
  return{
    name:isDefault?DEFAULT_COMMUNITY_NAME:(prev?.name||cid),
    slug:cid,
    description:isDefault?'NYC Community Trade List':'',
    visibility:isDefault?'private':'private',
    ownerId:fallbackOwnerId,
    ownerUsername:fallbackOwnerUsername,
    createdAt:0,
    updatedAt:0,
    ...prev,
    slug:prev?.slug||cid,
    ownerId:prev?.ownerId||fallbackOwnerId,
    ownerUsername:prev?.ownerUsername||fallbackOwnerUsername,
    admins,
    members,
    memberUsernames
  };
}
function ensureCommunityModel(s){
  s.communities=s.communities||{};
  s.userCommunities=s.userCommunities||{};
  s.communityRequests=s.communityRequests||{};
  s.communities[DEFAULT_COMMUNITY_ID]=normalizeCommunityRecord(DEFAULT_COMMUNITY_ID,s.communities[DEFAULT_COMMUNITY_ID],s);
  Object.entries(s.users||{}).forEach(([u,ud])=>{
    const uid=ud?.authUid;
    if(!uid)return;
    const role=communityRoleForUser(u,ud);
    if(!s.userCommunities[uid])s.userCommunities[uid]={};
    s.userCommunities[uid][DEFAULT_COMMUNITY_ID]={
      role,
      username:u,
      joinedAt:ud?.joined||0,
      ...(s.userCommunities[uid][DEFAULT_COMMUNITY_ID]||{}),
      role:strongerCommunityRole(s.userCommunities[uid][DEFAULT_COMMUNITY_ID]?.role,role),
      username:u
    };
  });
  Object.keys(s.communities||{}).forEach(id=>{
    s.communities[id]=normalizeCommunityRecord(id,s.communities[id],s);
  });
  return s;
}
function defaultCommunityMembershipUpdates(username,userRecord={},joinedAt=Date.now()){
  const updates={};
  const user=normalizedUserRecord(username,userRecord);
  const role=communityRoleForUser(username,user);
  const uid=user.authUid;
  updates[`communities/${DEFAULT_COMMUNITY_ID}/memberUsernames/${username}`]=true;
  updates[`communities/${DEFAULT_COMMUNITY_ID}/updatedAt`]=Date.now();
  if(uid){
    updates[`communities/${DEFAULT_COMMUNITY_ID}/members/${uid}`]=true;
    if(role!=='member')updates[`communities/${DEFAULT_COMMUNITY_ID}/admins/${uid}`]=true;
    updates[`userCommunities/${uid}/${DEFAULT_COMMUNITY_ID}`]={
      role,
      username,
      joinedAt:user.joined||joinedAt
    };
  }
  return updates;
}
function applyDefaultCommunityMembershipLocal(s,username,userRecord={},joinedAt=Date.now()){
  s.communities=s.communities||{};
  s.userCommunities=s.userCommunities||{};
  const user=normalizedUserRecord(username,userRecord);
  const role=communityRoleForUser(username,user);
  const uid=user.authUid;
  const community=normalizeCommunityRecord(DEFAULT_COMMUNITY_ID,s.communities[DEFAULT_COMMUNITY_ID],s,{autoEnrollDefault:false});
  community.memberUsernames={...(community.memberUsernames||{}),[username]:true};
  community.updatedAt=Date.now();
  if(uid){
    community.members={...(community.members||{}),[uid]:true};
    if(role!=='member')community.admins={...(community.admins||{}),[uid]:true};
    s.userCommunities[uid]=s.userCommunities[uid]||{};
    s.userCommunities[uid][DEFAULT_COMMUNITY_ID]={
      role,
      username,
      joinedAt:user.joined||joinedAt,
      ...(s.userCommunities[uid][DEFAULT_COMMUNITY_ID]||{}),
      role:strongerCommunityRole(s.userCommunities[uid][DEFAULT_COMMUNITY_ID]?.role,role),
      username
    };
  }
  s.communities[DEFAULT_COMMUNITY_ID]=community;
}
// Owner-selected approval target: build the Firebase update map for any
// combination of communities (NYC + zero or more prepared non-NYC ids).
// Pure function — returns {ok, error, updates}. NYC is always allowed as a
// target (matching defaultCommunityMembershipUpdates' bootstrap behavior);
// any non-NYC id is validated via validatePreparedNonDefaultCommunityId so an
// unprepared or invalid choice refuses the whole batch before any write.
function targetedCommunityMembershipUpdates(username,userRecord={},communityIds=[],joinedAt=Date.now()){
  if(!Array.isArray(communityIds)||!communityIds.length){
    return{ok:false,error:'Pick at least one community for this user.',updates:{}};
  }
  const user=normalizedUserRecord(username,userRecord);
  const role=communityRoleForUser(username,user);
  const uid=user.authUid;
  const updates={};
  const seen=new Set();
  for(const rawId of communityIds){
    const id=normalizeCommunityId(rawId);
    if(seen.has(id))continue;
    seen.add(id);
    if(id!==DEFAULT_COMMUNITY_ID){
      const validated=validatePreparedNonDefaultCommunityId(id);
      if(!validated.ok)return{ok:false,error:validated.error,updates:{}};
    }
    updates[`communities/${id}/memberUsernames/${username}`]=true;
    updates[`communities/${id}/updatedAt`]=Date.now();
    if(uid){
      updates[`communities/${id}/members/${uid}`]=true;
      if(role!=='member')updates[`communities/${id}/admins/${uid}`]=true;
      updates[`userCommunities/${uid}/${id}`]={role,username,joinedAt:user.joined||joinedAt};
    }
  }
  return{ok:true,updates};
}
// Local-cache mirror for targetedCommunityMembershipUpdates. Updates the
// in-memory s.communities[id] and s.userCommunities[uid][id] for each chosen
// community so the UI reflects the same data the Firebase write produced.
function applyTargetedCommunityMembershipLocal(s,username,userRecord={},communityIds=[],joinedAt=Date.now()){
  if(!Array.isArray(communityIds)||!communityIds.length)return;
  s.communities=s.communities||{};
  s.userCommunities=s.userCommunities||{};
  const user=normalizedUserRecord(username,userRecord);
  const role=communityRoleForUser(username,user);
  const uid=user.authUid;
  const seen=new Set();
  for(const rawId of communityIds){
    const id=normalizeCommunityId(rawId);
    if(seen.has(id))continue;
    seen.add(id);
    const community=normalizeCommunityRecord(id,s.communities[id],s,{autoEnrollDefault:false});
    community.memberUsernames={...(community.memberUsernames||{}),[username]:true};
    community.updatedAt=Date.now();
    if(uid){
      community.members={...(community.members||{}),[uid]:true};
      if(role!=='member')community.admins={...(community.admins||{}),[uid]:true};
      s.userCommunities[uid]=s.userCommunities[uid]||{};
      s.userCommunities[uid][id]={
        role,
        username,
        joinedAt:user.joined||joinedAt,
        ...(s.userCommunities[uid][id]||{}),
        role:strongerCommunityRole(s.userCommunities[uid][id]?.role,role),
        username
      };
    }
    s.communities[id]=community;
  }
}
function memberCommunityOptions(username=cur,uid=currentAuthUid){
  if(!MULTI_COMMUNITY_ENABLED||!username)return[];
  const communities=allData.communities||{};
  const options=new Map();
  const add=(rawId,source={})=>{
    const id=normalizeCommunityId(rawId);
    const community=communities[id];
    if(!community)return;
    const reverse=uid&&allData.userCommunities?.[uid]?.[id];
    const usernameMember=!!community.memberUsernames?.[username];
    if(!reverse&&!usernameMember)return;
    options.set(id,{
      id,
      name:community.name||community.slug||(id===DEFAULT_COMMUNITY_ID?DEFAULT_COMMUNITY_NAME:id),
      role:source.role||reverse?.role||(community.admins?.[uid]?'admin':'member')
    });
  };
  if(uid){
    Object.entries(allData.userCommunities?.[uid]||{}).forEach(([id,record])=>add(id,record||{}));
  }
  Object.keys(communities).forEach(id=>add(id,{}));
  return[...options.values()].sort((a,b)=>{
    if(a.id===DEFAULT_COMMUNITY_ID)return-1;
    if(b.id===DEFAULT_COMMUNITY_ID)return 1;
    return alphaCompare(a.name,b.name)||alphaCompare(a.id,b.id);
  });
}
function currentCommunityIsSelectable(id){
  const cid=normalizeCommunityId(id);
  return memberCommunityOptions().some(c=>c.id===cid);
}
function getCurrentCommunityId(){
  if(!MULTI_COMMUNITY_ENABLED)return DEFAULT_COMMUNITY_ID;
  const stored=normalizeCommunityId(lsGet(SELECTED_COMMUNITY_KEY,DEFAULT_COMMUNITY_ID));
  return currentCommunityIsSelectable(stored)?stored:DEFAULT_COMMUNITY_ID;
}
function setCurrentCommunityId(id){
  const cid=normalizeCommunityId(id);
  if(!MULTI_COMMUNITY_ENABLED){
    lsSet(SELECTED_COMMUNITY_KEY,cid);
    return cid;
  }
  const selected=MULTI_COMMUNITY_ENABLED&&currentCommunityIsSelectable(cid)?cid:DEFAULT_COMMUNITY_ID;
  lsSet(SELECTED_COMMUNITY_KEY,selected);
  if(MULTI_COMMUNITY_ENABLED&&cur){
    renderMemberCommunitySwitcher();
    renderActiveTab();
    refreshBadgesAndLightChrome();
  }
  return selected;
}
function getCommunityMemberUsernames(communityId=getCurrentCommunityId()){
  if(!MULTI_COMMUNITY_ENABLED)return new Set(Object.keys(allData.users||{}));
  const community=allData.communities?.[normalizeCommunityId(communityId)]||{};
  return new Set(Object.keys(community.memberUsernames||{}));
}
function isUserInCommunity(username,communityId=getCurrentCommunityId()){
  if(!MULTI_COMMUNITY_ENABLED)return true;
  return getCommunityMemberUsernames(communityId).has(username);
}
function filterUsersBySelectedCommunity(usernames){
  if(!MULTI_COMMUNITY_ENABLED)return usernames;
  const members=getCommunityMemberUsernames();
  return usernames.filter(u=>members.has(u));
}
function canManageCommunity(uid=currentAuthUid,communityId=getCurrentCommunityId()){
  if(!MULTI_COMMUNITY_ENABLED)return !!(cur&&allData.users?.[cur]?.isAdmin);
  const community=allData.communities?.[normalizeCommunityId(communityId)];
  return !!(uid&&community&&(community.ownerId===uid||community.admins?.[uid]));
}
function recordCommunityId(record){
  return normalizeCommunityId(record?.communityId||DEFAULT_COMMUNITY_ID);
}
function recordBelongsToSelectedCommunity(record){
  if(!MULTI_COMMUNITY_ENABLED)return true;
  return recordCommunityId(record)===getCurrentCommunityId();
}
function renderMemberCommunitySwitcher(){
  const el=document.getElementById('member-community-switcher');
  if(!el)return;
  if(typeof TRAINER_FIRST_INTERIM_ENABLED!=='undefined'&&TRAINER_FIRST_INTERIM_ENABLED){
    el.classList.remove('show');
    el.style.display='none';
    el.innerHTML='';
    return;
  }
  if(!MULTI_COMMUNITY_ENABLED||!cur){
    el.classList.remove('show');
    el.style.display='none';
    el.innerHTML='';
    return;
  }
  const options=memberCommunityOptions();
  if(!options.length){
    el.classList.remove('show');
    el.style.display='none';
    el.innerHTML='';
    return;
  }
  const selected=getCurrentCommunityId();
  const current=options.find(c=>c.id===selected)||options.find(c=>c.id===DEFAULT_COMMUNITY_ID)||options[0];
  el.style.display='';
  el.classList.add('show');
  if(options.length===1){
    el.innerHTML=`<span>Community</span><span class="member-community-name">${escHtml(current.name)}</span>`;
    return;
  }
  el.innerHTML=`<label><span>Community</span><select aria-label="Choose community view" onchange="setCurrentCommunityId(this.value)">${options.map(c=>`<option value="${escAttr(c.id)}" ${c.id===selected?'selected':''}>${escHtml(c.name)}</option>`).join('')}</select></label>`;
}
function normalizeData(s){
  if(!s||typeof s!=='object')s={};
  s.users=s.users||{};s.wishlist=s.wishlist||{};s.dynamax=s.dynamax||{};s.gmax=s.gmax||{};s.costumes=s.costumes||{};s.have=s.have||{};s.offers=s.offers||{};s.trades=s.trades||{};s.requests=s.requests||{};s.authIndex=s.authIndex||{};s.pendingDecrements=s.pendingDecrements||{};s.loginDirectory=s.loginDirectory||{};s.communities=s.communities||{};s.userCommunities=s.userCommunities||{};s.communityRequests=s.communityRequests||{};
  Object.keys(s.users).forEach(u=>{
    s.users[u]=normalizedUserRecord(u,s.users[u]);
    if(!s.wishlist[u])s.wishlist[u]={};
    if(!s.dynamax[u])s.dynamax[u]={};
    if(!s.gmax[u])s.gmax[u]={};
    if(!s.costumes[u])s.costumes[u]={};
    if(!s.have[u])s.have[u]={};
  });
  return ensureCommunityModel(s);
}

function initLocal(){
  return normalizeData(managedSessionCache.readData());
}
function getLocal(){return normalizeData(managedSessionCache.readData()||initLocal())}
// ── PERF VISIBILITY (scaling phase 1) ────────────────────────
// Lightweight rolling-buffer timer for hot paths. Surfaced in Health Check
// so the owner can spot growing per-snapshot / per-render cost before it
// becomes painful for users. Designed for ~zero overhead at normal scale.
const _perfBuf={}; // op → { samples:number[], lastSize:number }
const PERF_KEEP=20;
function perfTime(op,fn){
  const t0=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  try{return fn();}finally{
    const dt=((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())-t0;
    const buf=_perfBuf[op]||(_perfBuf[op]={samples:[]});
    buf.samples.push(dt);
    if(buf.samples.length>PERF_KEEP)buf.samples.shift();
  }
}
function perfRecord(op,ms,size){
  const buf=_perfBuf[op]||(_perfBuf[op]={samples:[]});
  buf.samples.push(ms);
  if(buf.samples.length>PERF_KEEP)buf.samples.shift();
  if(typeof size==='number')buf.lastSize=size;
}
function perfStats(){
  const out={};
  Object.entries(_perfBuf).forEach(([op,buf])=>{
    if(!buf.samples.length)return;
    const sorted=[...buf.samples].sort((a,b)=>a-b);
    const sum=sorted.reduce((a,b)=>a+b,0);
    out[op]={
      n:sorted.length,
      avg:sum/sorted.length,
      p50:sorted[Math.floor(sorted.length*0.5)],
      p95:sorted[Math.floor(sorted.length*0.95)],
      max:sorted[sorted.length-1],
      lastSize:buf.lastSize
    };
  });
  return out;
}
function saveLocal(s){
  try{
    const result=managedSessionCache.writeData(normalizeData(s));
    if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});
  }catch(e){
    // QuotaExceededError on Safari iOS first (~5MB). We can't easily prune
    // safely so we keep the in-memory copy correct and surface the warning
    // — the user will lose offline restore on the next reload but won't
    // silently lose data this session. (allData is updated by callers
    // separately, not via saveLocal.)
    const code=e?.name||e?.code||'';
    if(/Quota/i.test(code)||/Quota/i.test(String(e?.message||''))){
      console.warn('saveLocal: localStorage quota exceeded — offline cache disabled this session.',e);
      if(typeof toast==='function')toast(i18nCore.t('storage.quotaFull'),6000);
    }else{
      console.error('saveLocal failed:',e);
    }
  }
}

const PUBLIC_SHARE_TYPES=['wishlist','dynamax','gmax','costumes'];
function publicShareSessionMatches(username){
  return!!(auth?.currentUser&&cur===username&&activePublicShareHydrationToken&&
    activePublicShareHydrationToken.uid===auth.currentUser.uid&&
    activePublicShareHydrationToken.username===username);
}
function publicShareSnapshotForUser(username,source=allData,trigger='explicit_share'){
  if(!publicShareSessionMatches(username)){
    return{ok:false,error:{code:'share-publication/session-mismatch',message:'Public-share session identity changed'}};
  }
  // Allowlist-only. Missing or failed exact-read sources are rejected instead
  // of being converted into a valid-looking empty public projection.
  return publicSharePublicationDomain.buildPublicShareSnapshot({
    gate:managedPublicSharePublication,
    token:activePublicShareHydrationToken,
    trigger,username,source
  });
}
function applyPublicShareSnapshot(s,snapshot){
  const projection=publicSharePublicationDomain.publicShareProjectionStatus(snapshot,{username:snapshot?.username});
  if(!projection.ok)return false;
  snapshot=projection.snapshot;
  const username=String(snapshot.username||'').trim();
  if(!s.users)s.users={};
  const profile=snapshot.profile&&typeof snapshot.profile==='object'?snapshot.profile:{};
  s.users[username]={
    friendCode:String(profile.friendCode||''),
    bio:String(profile.bio||''),
    discord:String(profile.discord||''),
    avatarPokemon:String(profile.avatarPokemon||''),
    joined:null,
    lastSeen:null,
    lastUpdated:Number(profile.lastUpdated||snapshot.updatedAt||0)||null
  };
  const lists=snapshot.lists&&typeof snapshot.lists==='object'?snapshot.lists:{};
  PUBLIC_SHARE_TYPES.forEach(type=>{
    if(!s[type])s[type]={};
    s[type][username]={...(lists[type]||{})};
  });
  return true;
}
function notePublicSharePublicationBlocked(result,trigger){
  const code=result?.error?.code||'share-publication/blocked';
  const fingerprint=`${activePublicShareHydrationToken?.generation||0}:${trigger}:${code}`;
  if(_lastPublicShareBlockedNotice===fingerprint)return;
  _lastPublicShareBlockedNotice=fingerprint;
  console.warn('Public-share publication blocked',{code,trigger});
}
function queueHydratedPublicShareSnapshot(source,username,trigger){
  if(!fbOn||!db||!username||!auth?.currentUser){
    return{ok:false,error:{code:'share-publication/offline',message:'Firebase session is unavailable'}};
  }
  const built=publicShareSnapshotForUser(username,source,trigger);
  if(!built.ok){notePublicSharePublicationBlocked(built,trigger);return built;}
  queueSync(`publicShares/${username}`,built.snapshot);
  return{ok:true,status:'queued'};
}
function requestPublicSharePublication(trigger,source=allData,username=cur){
  if(!publicShareSessionMatches(username)){
    return{ok:false,error:{code:'share-publication/session-mismatch',message:'Public-share session identity changed'}};
  }
  const requested=managedPublicSharePublication.request(activePublicShareHydrationToken,trigger);
  if(!requested.ok){notePublicSharePublicationBlocked(requested,trigger);return requested;}
  if(requested.status==='pending')return requested;
  return queueHydratedPublicShareSnapshot(source,username,trigger);
}
function flushPendingPublicSharePublication(){
  if(!activePublicShareHydrationToken||!cur)return{ok:false,status:'inactive'};
  const pending=managedPublicSharePublication.consumePending(activePublicShareHydrationToken);
  if(!pending.ok||!pending.trigger)return pending;
  return queueHydratedPublicShareSnapshot(allData,cur,pending.trigger);
}
async function publishPublicShareNow(username=cur,trigger='explicit_share'){
  if(!username)return{ok:false,error:{code:'share-publication/username-required',message:'Trainer username is required'}};
  if(!publicShareSessionMatches(username)){
    return{ok:false,error:{code:'share-publication/session-mismatch',message:'Public-share session identity changed'}};
  }
  const requested=managedPublicSharePublication.request(activePublicShareHydrationToken,trigger);
  if(!requested.ok){notePublicSharePublicationBlocked(requested,trigger);return requested;}
  if(requested.status==='pending')return requested;
  const built=publicShareSnapshotForUser(username,allData,trigger);
  if(!built.ok){notePublicSharePublicationBlocked(built,trigger);return built;}
  if(fbOn&&db&&auth?.currentUser){
    await withTimeout(set(ref(db,`publicShares/${username}`),built.snapshot),8000,'Publishing share link timed out','db/public-share-timeout');
    delete syncQueue[`publicShares/${username}`];
    saveSyncQueue();
    if(!Object.keys(syncQueue).length)showSyncDot(false);
    return{ok:true,status:'published'};
  }
  return{ok:false,error:{code:'share-publication/offline',message:'Firebase session is unavailable'}};
}

function ownerShareNoticeKey(status){
  return{
    missing_projection:'share.ownerMissing',profile_only:'share.ownerProfileOnly',
    missing_published_list_types:'share.ownerMissingMarkers',incomplete_list_projection:'share.ownerIncomplete',
    unsupported_projection:'share.ownerUnsupported',transport_error:'share.ownerReadError'
  }[status]||'share.ownerIncomplete';
}
function renderOwnerShareRepublishNotice(){
  const el=document.getElementById('owner-share-notice');if(!el)return;
  const state=ownerPublicShareReview;
  if(!cur||!state.republishRequired){el.classList.remove('visible');el.innerHTML='';return;}
  el.classList.add('visible');
  el.innerHTML=`<div class="owner-share-notice-copy"><div class="owner-share-notice-title">${escHtml(i18nCore.t('share.ownerTitle'))}</div><div class="owner-share-notice-body">${escHtml(i18nCore.t(ownerShareNoticeKey(state.status)))} ${escHtml(i18nCore.t('share.ownerPrivateSafe'))}</div></div><button class="bsave" onclick="republishOwnPublicShare()" ${state.busy?'disabled':''}>${escHtml(i18nCore.t(state.busy?'share.ownerRepublishing':'share.ownerRepublishAction'))}</button>`;
}
async function inspectOwnPublicShareAfterHydration(token=activePublicShareHydrationToken){
  if(!token||!publicShareSessionMatches(token.username)||managedPublicSharePublication.snapshot().surfaces.profile!=='loaded')return{ok:false,status:'not_ready'};
  const readiness=managedPublicSharePublication.authorize(token,'explicit_share');
  if(!readiness.ok)return readiness;
  const generation=token.generation;
  let status;
  try{
    const result=await managedPublicShareRepository.read(token.username);
    if(!publicShareSessionMatches(token.username)||activePublicShareHydrationToken?.generation!==generation)return{ok:false,status:'stale'};
    if(!result.ok)status={status:'transport_error',republishRequired:true};
    else status=publicSharePublicationDomain.ownerProjectionReview(result.value,{username:token.username});
  }catch(error){status={status:'transport_error',republishRequired:true};}
  if(!publicShareSessionMatches(token.username)||activePublicShareHydrationToken?.generation!==generation)return{ok:false,status:'stale'};
  ownerPublicShareReview={generation,status:status.status,republishRequired:!!status.republishRequired,busy:false};
  renderOwnerShareRepublishNotice();
  return{ok:true,...ownerPublicShareReview};
}
async function republishOwnPublicShare(){
  const token=activePublicShareHydrationToken;if(!token||!publicShareSessionMatches(token.username))return;
  ownerPublicShareReview={...ownerPublicShareReview,busy:true};renderOwnerShareRepublishNotice();
  try{
    const result=await publishPublicShareNow(token.username,'explicit_share');
    if(!result.ok||result.status!=='published')throw new Error(result.error?.code||result.status||'publication_failed');
    const verified=await inspectOwnPublicShareAfterHydration(token);
    if(!verified.ok||verified.republishRequired)throw new Error('share-publication/verification-failed');
    toast(i18nCore.t('share.ownerRepublishSuccess'),3500);
  }catch(error){
    if(publicShareSessionMatches(token.username)&&activePublicShareHydrationToken?.generation===token.generation){
      ownerPublicShareReview={...ownerPublicShareReview,busy:false,republishRequired:true};renderOwnerShareRepublishNotice();
      toast(i18nCore.t('share.ownerRepublishFailed'),6000);
    }
  }
}

async function writeUser(u,data){
  const preserveLegacyBoard=await accountSyncPreserveLegacyBoard(u);
  const s=getLocal();s.users[u]=normalizedUserRecord(u,s.users[u],data);
  if(canWriteLoginDirectoryNow())s.loginDirectory[u]=normalizedLoginDirectoryRecord(u,s.users[u],s.loginDirectory[u]);
  saveLocal(s);
  if(fbOn&&db){
    if(preserveLegacyBoard)queueAccountSyncProfileFields(u,s.users[u]);
    else queueSync(`users/${u}`,s.users[u]);
    if(canWriteLoginDirectoryNow())queueSync(`loginDirectory/${u}`,s.loginDirectory[u]);
  }
  syncFromLocal();
}
function canWriteLoginDirectoryNow(){
  const localUser=allData.users?.[cur]||getLocal().users?.[cur];
  return !!(auth?.currentUser&&cur&&localUser?.isAdmin);
}
async function writeUserNow(u,data){
  const preserveLegacyBoard=await accountSyncPreserveLegacyBoard(u);
  const s=getLocal();s.users[u]=normalizedUserRecord(u,s.users[u],data);
  if(auth?.currentUser?.email===authEmailForUser(u,s.users[u])){
    s.users[u].authEmail=authEmailForUser(u,s.users[u]);
    s.users[u].authUid=auth.currentUser.uid;
  }
  if(canWriteLoginDirectoryNow())s.loginDirectory[u]=normalizedLoginDirectoryRecord(u,s.users[u],s.loginDirectory[u]);
  saveLocal(s);
  if(fbOn&&db){
    try{
      const profileValue=preserveLegacyBoard?accountSyncProfileFields(s.users[u]):s.users[u];
      await withTimeout(preserveLegacyBoard?update(ref(db,`users/${u}`),profileValue):set(ref(db,`users/${u}`),profileValue),8000,'Saving login timed out','db/write-timeout');
      if(canWriteLoginDirectoryNow())await withTimeout(set(ref(db,`loginDirectory/${u}`),s.loginDirectory[u]),8000,'Saving login directory timed out','db/directory-timeout');
      if(preserveLegacyBoard)acknowledgeAccountSyncProfileFields(u,profileValue);
      else delete syncQueue[`users/${u}`];
      if(canWriteLoginDirectoryNow())delete syncQueue[`loginDirectory/${u}`];
      saveSyncQueue();
      if(!Object.keys(syncQueue).length)showSyncDot(false);
    }catch{
      if(preserveLegacyBoard)queueAccountSyncProfileFields(u,s.users[u]);
      else queueSync(`users/${u}`,s.users[u]);
      if(canWriteLoginDirectoryNow())queueSync(`loginDirectory/${u}`,s.loginDirectory[u]);
    }
  }
  syncFromLocal();
}
async function writeUserStrict(u,data){
  const preserveLegacyBoard=await accountSyncPreserveLegacyBoard(u);
  const s=getLocal();
  s.users[u]=normalizedUserRecord(u,s.users[u],data);
  s.loginDirectory[u]=normalizedLoginDirectoryRecord(u,s.users[u],s.loginDirectory[u]);
  if(fbOn&&db){
    const profileValue=preserveLegacyBoard?accountSyncProfileFields(s.users[u]):s.users[u];
    await withTimeout(preserveLegacyBoard?update(ref(db,`users/${u}`),profileValue):set(ref(db,`users/${u}`),profileValue),8000,'Saving user timed out','db/write-timeout');
    await withTimeout(set(ref(db,`loginDirectory/${u}`),s.loginDirectory[u]),8000,'Saving login directory timed out','db/directory-timeout');
  }
  saveLocal(s);allData=normalizeData(s);refreshAll();
  return s.users[u];
}
async function bindAuthUserNow(username,authUpdate){
  const s=getLocal();
  const next=normalizedUserRecord(username,s.users[username],authUpdate);
  if(fbOn&&db){
    await withTimeout(set(ref(db,`users/${username}`),next),8000,'Linking login timed out','auth/bind-timeout');
    const dirNext=normalizedLoginDirectoryRecord(username,next,{...(s.loginDirectory?.[username]||{}),authReady:true});
    await withTimeout(set(ref(db,`loginDirectory/${username}`),dirNext),8000,'Linking login directory timed out','auth/directory-timeout');
    delete syncQueue[`users/${username}`];
    delete syncQueue[`loginDirectory/${username}`];
    saveSyncQueue();
    if(!Object.keys(syncQueue).length)showSyncDot(false);
  }
  s.users[username]=next;
  s.loginDirectory[username]=normalizedLoginDirectoryRecord(username,next,{...(s.loginDirectory?.[username]||{}),authReady:true});
  saveLocal(s);
  allData=normalizeData(s);
  return next;
}
async function repairMemberAccount(username,opts={}){
  if(!allData.users?.[cur]?.isAdmin){toast(i18nCore.t('admin.only'));return null;}
  const existing=allData.users?.[username]||{};
  if(!existing.joined&&!allData.users?.[username])throw Object.assign(new Error('User record missing'),{code:'repair/missing-user'});
  const resetPin=opts.pin||'';
  let next={...existing};
  let pinForCopy='';
  if(resetPin){
    if(!isSixDigitPin(resetPin))throw Object.assign(new Error('PIN must be exactly 6 digits'),{code:'repair/bad-pin'});
    const repairPolicy=authenticationReadinessDomain.legacyRepairDecision({currentUid:String(existing.authUid||''),replacementUid:'replacement-requested'});
    if(!repairPolicy.allowed)throw Object.assign(new Error('Established Firebase UID cannot be replaced.'),{code:repairPolicy.code});
    const authProvision=await provisionFreshFirebaseAuthForTrainer(username,resetPin,authVersionForUser(existing)+1);
    const nextVersion=authProvision.version;
    const pinHash=await hashPin(resetPin);
    next=normalizedUserRecord(username,existing,{
      pin:pinHash,pinHashed:true,authVersion:nextVersion,authEmail:authEmail(username,nextVersion),authUid:authProvision.uid,lastSeen:null
    });
    pinForCopy=resetPin;
  }else{
    next=normalizedUserRecord(username,existing);
  }
  const loginDir=normalizedLoginDirectoryRecord(username,next,{...(allData.loginDirectory?.[username]||{}),authReady:!!next.authUid,approvedAt:next.joined||Date.now()});
  if(fbOn&&db){
    const updates={};
    updates[`users/${username}`]=next;
    updates[`loginDirectory/${username}`]=loginDir;
    // Do not write authIndex for another user's UID here. Firebase rules only
    // allow users to publish their own authIndex row; the repaired user will
    // create it automatically on their next successful sign-in.
    if(ownerCanUseCommunityTools()){
      const membershipUpdates=defaultCommunityMembershipUpdates(username,next,next.joined||Date.now());
      if(next.authUid){
        const reversePath=`userCommunities/${next.authUid}/${DEFAULT_COMMUNITY_ID}`;
        const existingReverse=allData.userCommunities?.[next.authUid]?.[DEFAULT_COMMUNITY_ID];
        if(existingReverse&&membershipUpdates[reversePath]){
          const proposed=membershipUpdates[reversePath];
          membershipUpdates[reversePath]={
            ...existingReverse,
            ...proposed,
            role:strongerCommunityRole(existingReverse.role,proposed.role),
            joinedAt:existingReverse.joinedAt||proposed.joinedAt
          };
        }
      }
      Object.assign(updates,membershipUpdates);
    }
    await withTimeout(update(ref(db),updates),9000,'Repairing account timed out','db/repair-timeout');
    const userSnap=await withTimeout(get(ref(db,`users/${username}`)),6000,'Verifying user repair timed out','db/verify-timeout');
    const dirSnap=await withTimeout(get(ref(db,`loginDirectory/${username}`)),6000,'Verifying login directory repair timed out','db/verify-timeout');
    if(!userSnap.exists()||!dirSnap.exists())throw Object.assign(new Error('Server did not confirm the repaired account. Sign out/back in as admin and retry.'),{code:'repair/not-confirmed'});
    delete syncQueue[`users/${username}`];
    delete syncQueue[`loginDirectory/${username}`];
    saveSyncQueue();
    if(!Object.keys(syncQueue).length)showSyncDot(false);
  }
  const s=getLocal();
  s.users[username]=next;
  s.loginDirectory[username]=loginDir;
  if(ownerCanUseCommunityTools())applyDefaultCommunityMembershipLocal(s,username,next,next.joined||Date.now());
  saveLocal(s);allData=normalizeData(s);refreshAll();populateLoginUsers();
  return{user:next,pin:pinForCopy};
}
async function createMemberNow(username,pin,isAdmin=false,reqId='',opts={}){
  const s=getLocal();
  const iAmOwner=allData.users?.[cur]?.isOwner||cur===OWNER;
  const canCreateAdmin=!!isAdmin&&iAmOwner;
  const pinHash=await hashPin(pin);
  const authProvision=await provisionFreshFirebaseAuthForTrainer(username,pin,1);
  const authVersion=authProvision.version;
  const user=normalizedUserRecord(username,{},{
    pin:pinHash,isAdmin:canCreateAdmin,isOwner:false,friendCode:'',joined:Date.now(),lastSeen:null,lastUpdated:null,
    pinHashed:true,authVersion,authEmail:authEmail(username,authVersion),authUid:authProvision.uid
  });
  const loginDir=normalizedLoginDirectoryRecord(username,user,{authReady:true,approvedAt:user.joined});
  // Community enrollment target. When the caller passes opts.communityIds
  // (currently only the owner approval picker), use that selection. Otherwise
  // fall back to today's behavior: owner approvals enroll into NYC by default;
  // non-owner admin approvals skip the community block entirely (matching the
  // rules-gated reality where only the owner can write community paths).
  const requestedCommunityIds=MULTI_COMMUNITY_ENABLED&&Array.isArray(opts.communityIds)&&opts.communityIds.length?opts.communityIds:null;
  const targetCommunityIds=requestedCommunityIds||[];
  let communityUpdates={};
  if(targetCommunityIds.length){
    const built=targetedCommunityMembershipUpdates(username,user,targetCommunityIds,user.joined);
    if(!built.ok){
      const err=new Error(built.error||'Could not build community membership updates.');
      err.code='community/invalid-target';
      throw err;
    }
    communityUpdates=built.updates;
  }
  if(fbOn&&db){
    const updates={};
    updates[`users/${username}`]=user;
    updates[`loginDirectory/${username}`]=loginDir;
    if(reqId)updates[`requests/${reqId}/status`]='approved';
    Object.assign(updates,communityUpdates);
    await withTimeout(update(ref(db),updates),8000,'Creating member timed out','db/write-timeout');
    // Firebase Realtime DB's update() resolves the promise as soon as the
    // CLIENT-SIDE optimistic cache is updated — *before* the server confirms.
    // If the server later rejects the write (silent auth expiry, missing
    // admin record, rules mismatch), the local SDK keeps the optimistic
    // value but other clients never see it. The previous version of this
    // function trusted the update() promise and returned "success" to the
    // admin while the new user existed only on the admin's device.
    //
    // Verify by reading back from the server. If the record isn't there,
    // throw so the caller's try/catch can surface a clear error — and the
    // local cache stays clean because we throw BEFORE writing to it below.
    const snap=await withTimeout(get(ref(db,`users/${username}`)),6000,'Verifying member create timed out','db/verify-timeout');
    const dirSnap=await withTimeout(get(ref(db,`loginDirectory/${username}`)),6000,'Verifying login directory timed out','db/verify-timeout');
    // Verify every chosen community's memberUsernames index landed before
    // declaring success. Any one missing → throw the same atomic-write error.
    let communityMembershipOk=true;
    for(const id of targetCommunityIds){
      const communitySnap=await withTimeout(get(ref(db,`communities/${id}/memberUsernames/${username}`)),6000,`Verifying ${id} membership timed out`,'db/community-verify-timeout');
      if(!communitySnap.exists()){communityMembershipOk=false;break;}
    }
    if(!snap.exists()||!dirSnap.exists()||!communityMembershipOk){
      const err=new Error('Server rejected the new-member write. Most likely your Firebase auth session has silently expired or your admin record is missing. Sign out and back in, then try again.');
      err.code='db/write-rejected-silently';
      throw err;
    }
  }
  s.users[username]=user;
  s.loginDirectory[username]=loginDir;
  s.wishlist[username]=s.wishlist[username]||{};
  s.dynamax[username]=s.dynamax[username]||{};
  s.gmax[username]=s.gmax[username]||{};
  s.costumes[username]=s.costumes[username]||{};
  if(targetCommunityIds.length)applyTargetedCommunityMembershipLocal(s,username,user,targetCommunityIds,user.joined);
  if(reqId&&s.requests?.[reqId])s.requests[reqId].status='approved';
  saveLocal(s);allData=normalizeData(s);refreshAll();
  return user;
}
function generatedFirstTimePin(){
  return String(Math.floor(100000+Math.random()*900000));
}
function firstTimeLoginMessage(username,pin){
  return[
    `You're approved for PoGo Trades.`,
    '',
    `Username: ${username}`,
    `First-time PIN: ${pin}`,
    '',
    'Sign in, then change your PIN from Profile after your first login.'
  ].join('\n');
}
async function repairMissingAuthMetadata(){
  if(authRepairStarted||!fbOn||!db||!auth?.currentUser||!allData.users?.[cur]?.isAdmin)return;
  authRepairStarted=true;
  const updates={};let count=0;
  Object.entries(allData.users||{}).forEach(([u,d])=>{
    const next=normalizedUserRecord(u,d);
    if(!d.authEmail){
      updates[`users/${u}/authEmail`]=next.authEmail;
      count++;
    }
    if(!d.authVersion)updates[`users/${u}/authVersion`]=next.authVersion;
  });
  if(!Object.keys(updates).length)return;
  try{
    await withTimeout(update(ref(db),updates),8000,'Repairing login metadata timed out','db/write-timeout');
    Object.entries(allData.users||{}).forEach(([u,d])=>{allData.users[u]=normalizedUserRecord(u,d);});
    saveLocal(allData);
    toast(`✅ Repaired login metadata for ${count} member${count===1?'':'s'}`,4000);
  }catch(e){
    console.warn('Auth metadata repair failed',e);
    authRepairStarted=false;
  }
}
async function provisionFirebaseAuthForTrainer(username,pin,version=1){
  if(!firebaseAuthConfigured()){
    const err=new Error('Firebase Auth is not configured for admin onboarding.');
    err.code='auth/not-configured';
    throw err;
  }
  const email=authEmail(username,version);
  const res=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_API_KEY)}`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password:pin,returnSecureToken:true})
  });
  const data=await res.json().catch(()=>({}));
  if(res.ok)return{email,uid:data.localId||null,created:true};
  const message=String(data?.error?.message||`HTTP_${res.status}`);
  if(message==='EMAIL_EXISTS')return{email,uid:null,created:false,exists:true};
  const err=new Error(`Firebase Auth provisioning failed: ${message}`);
  err.code='auth/provision-failed';
  throw err;
}
async function provisionFreshFirebaseAuthForTrainer(username,pin,startVersion=1,maxAttempts=AUTH_VERSION_SCAN_LIMIT){
  let version=Math.max(1,parseInt(startVersion,10)||1);
  let lastProvision=null;
  for(let attempt=0;attempt<maxAttempts;attempt++,version++){
    const provision=await provisionFirebaseAuthForTrainer(username,pin,version);
    lastProvision=provision;
    if(provision?.uid)return{...provision,version};
    if(!provision?.exists)break;
  }
  const err=new Error('Could not create a fresh Firebase Auth login. Try Repair again, or delete old Auth rows for this username and retry.');
  err.code='repair/auth-provision-failed';
  err.lastProvision=lastProvision;
  throw err;
}
function authVersionCandidates(startVersion=1){
  const start=Math.max(1,parseInt(startVersion,10)||1);
  const seen=new Set();
  const out=[];
  const add=v=>{
    const n=Math.max(1,parseInt(v,10)||1);
    if(!seen.has(n)){seen.add(n);out.push(n);}
  };
  add(start);
  for(let v=start+1;out.length<AUTH_VERSION_SCAN_LIMIT&&v<start+AUTH_VERSION_SCAN_LIMIT+1;v++)add(v);
  for(let v=1;out.length<AUTH_VERSION_SCAN_LIMIT&&v<start;v++)add(v);
  return out;
}
async function signInWithAuthVersionScan(username,pin,startVersion=1){
  let lastAuthErr=null;
  for(const version of authVersionCandidates(startVersion)){
    const email=authEmail(username,version);
    try{
      const cred=await withTimeout(signInWithEmailAndPassword(auth,email,pin),10000,'Firebase Auth sign-in timed out','auth/timeout');
      return{cred,email,version};
    }catch(e){
      lastAuthErr=e;
      if(!['auth/invalid-credential','auth/wrong-password','auth/invalid-login-credentials','auth/user-not-found'].includes(e.code))throw e;
    }
  }
  throw lastAuthErr||Object.assign(new Error('Wrong PIN'),{code:'auth/invalid-credential'});
}
function isRecoverableAuthIndexError(error){
  const code=String(error?.code||'').toLowerCase();
  return code==='db/index-timeout'||code.includes('network')||code.includes('unavailable');
}
function authIndexError(code,message,cause){
  const error=new Error(message);error.code=code;
  if(cause)error.cause=cause;
  return error;
}
async function syncOwnAuthIndex(username,ident,userRecord={}){
  if(!db||!ident?.uid)return{status:'skipped'};
  const uid=ident.uid;
  if(auth?.currentUser?.uid!==uid){
    throw authIndexError('auth/index-session-mismatch','The signed-in Firebase user does not match this login identity.');
  }
  const indexRef=ref(db,`authIndex/${uid}`);
  const indexSnap=await withTimeout(get(indexRef),5000,'Reading login index timed out','db/index-read-timeout');
  const now=Date.now();
  if(indexSnap.exists()){
    const existing=indexSnap.val()||{};
    if(existing.username!==username){
      throw authIndexError('auth/index-mismatch','This Firebase login is already linked to a different trainer.');
    }
    try{
      await withTimeout(update(indexRef,{lastSeen:now}),5000,'Updating login index timed out','db/index-timeout');
      return{status:'refreshed',lastSeen:now};
    }catch(error){
      if(!isRecoverableAuthIndexError(error))throw error;
      console.warn('Could not refresh login index metadata; continuing with verified mapping',error);
      return{status:'deferred',lastSeen:existing.lastSeen||null};
    }
  }
  const userUidSnap=await withTimeout(get(ref(db,`users/${username}/authUid`)),5000,'Verifying login identity timed out','db/index-read-timeout');
  if(userUidSnap.val()!==uid){
    throw authIndexError('auth/index-binding-mismatch','This trainer record is not linked to the signed-in Firebase user.');
  }
  await withTimeout(set(indexRef,{
    username,
    isAdmin:!!userRecord.isAdmin,
    isOwner:!!userRecord.isOwner,
    lastSeen:now
  }),5000,'Initializing login index timed out','db/index-timeout');
  return{status:'initialized',lastSeen:now};
}
let _loginDirectoryRepairStarted=false;
async function ensureLoginDirectoryPublished(){
  if(_loginDirectoryRepairStarted||!fbOn||!db||!cur||!allData.users?.[cur]?.isAdmin)return;
  _loginDirectoryRepairStarted=true;
  const updates={};
  Object.entries(allData.users||{}).forEach(([u,d])=>{
    const existing=allData.loginDirectory?.[u]||{};
    const next=normalizedLoginDirectoryRecord(u,d,existing);
    if(JSON.stringify(existing)!==JSON.stringify(next))updates[`loginDirectory/${u}`]=next;
  });
  if(!Object.keys(updates).length)return;
  try{
    await withTimeout(update(ref(db),updates),8000,'Publishing login directory timed out','db/directory-timeout');
    const s=getLocal();
    Object.entries(allData.users||{}).forEach(([u,d])=>{
      s.loginDirectory[u]=normalizedLoginDirectoryRecord(u,d,s.loginDirectory?.[u]||{});
    });
    saveLocal(s);
    allData=normalizeData(s);
  }catch(e){
    console.warn('Could not publish login directory',e);
  }
}
const OWNED_MY_LIST_TYPES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
const ACCOUNT_SYNC_DEVICE_KEY_PREFIX='pogoAccountSyncDevice_v1';
async function accountSyncRolloutEligible(uid=auth?.currentUser?.uid){
  const owner=accountSyncModel.firebaseKey(uid,128);
  if(!owner||ACCOUNT_SYNC_ROLLOUT.enabled!==true||ACCOUNT_SYNC_ROLLOUT.writesEnabled!==true)return false;
  const digest=await accountSyncModel.sha256Hex(accountSyncModel.canonicalJson([accountSyncModel.SCHEMA_VERSION,'pogo-account-sync-rollout-owner',owner]));
  return ACCOUNT_SYNC_ROLLOUT.allowlistedUidHashes.includes(digest);
}
function accountSyncMigratedLegacyQueueItem(item,username=cur){
  const name=String(username||''),path=String(item?.path||'');
  if(!name)return false;
  const listWrite=item?.kind===sessionCacheBoundaryData.MY_LIST_UPDATE_KIND&&OWNED_MY_LIST_TYPES.some(type=>path===`${type}/${name}`);
  return listWrite||path===`users/${name}/specialTradeBoard`;
}
function accountSyncQueuedProfileBoardItem(item,username=cur){
  return String(item?.path||'')===`users/${String(username||'')}`&&Object.prototype.hasOwnProperty.call(item?.data||{},'specialTradeBoard');
}
function accountSyncProfileFields(profile={}){
  const fields={...profile};delete fields.specialTradeBoard;return fields;
}
async function accountSyncPreserveLegacyBoard(username){
  if(ACCOUNT_SYNC_ROLLOUT.enabled!==true||ACCOUNT_SYNC_ROLLOUT.writesEnabled!==true)return false;
  const uid=auth?.currentUser?.uid,name=String(username||'');
  if(!uid||!name||name!==cur)return false;
  const eligible=await accountSyncRolloutEligible(uid);
  if(uid!==auth?.currentUser?.uid||name!==cur)throw Object.assign(new Error('Account sync session changed before the profile write'),{code:'account-sync/session-changed'});
  return eligible;
}
function queueAccountSyncProfileFields(username,profile){
  const name=String(username||''),fields=accountSyncProfileFields(profile),previousQueue=syncQueue,nextQueue={...syncQueue},timestamp=Date.now();
  if(!name||!Object.keys(fields).length)return false;
  const rootPath=`users/${name}`,rootItem=nextQueue[rootPath];
  if(accountSyncQueuedProfileBoardItem(rootItem,name))nextQueue[rootPath]={...rootItem,data:{specialTradeBoard:accountSyncClone(rootItem.data.specialTradeBoard)}};
  else delete nextQueue[rootPath];
  for(const[field,value]of Object.entries(fields)){
    const path=`${rootPath}/${field}`;nextQueue[path]={kind:'set',path,data:value,ts:timestamp};
  }
  syncQueue=nextQueue;
  const saved=saveSyncQueue();
  if(!saved.ok){syncQueue=previousQueue;toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);return false;}
  showSyncDot(true);refreshSyncUi();clearTimeout(syncFlushTimer);syncFlushTimer=setTimeout(flushSyncQueue,250);return true;
}
function acknowledgeAccountSyncProfileFields(username,fields){
  const name=String(username||''),rootPath=`users/${name}`,rootItem=syncQueue[rootPath];
  if(accountSyncQueuedProfileBoardItem(rootItem,name))syncQueue[rootPath]={...rootItem,data:{specialTradeBoard:accountSyncClone(rootItem.data.specialTradeBoard)}};
  else delete syncQueue[rootPath];
  for(const[field,value]of Object.entries(fields||{})){
    const path=`${rootPath}/${field}`,queued=syncQueue[path];
    if(queued?.kind==='set'&&queued.path===path&&accountSyncModel.canonicalJson(queued.data)===accountSyncModel.canonicalJson(value))delete syncQueue[path];
  }
}
function accountSyncRetainedLegacyQueueEntries(key,item,username=cur){
  if(accountSyncMigratedLegacyQueueItem(item,username))return Object.freeze([]);
  if(!accountSyncQueuedProfileBoardItem(item,username))return Object.freeze([[key,item]]);
  const data=accountSyncProfileFields(item.data),rootPath=String(item.path),timestamp=Number(item.ts)||0;
  return Object.freeze(Object.entries(data).map(([field,value])=>{
    const path=`${rootPath}/${field}`;return Object.freeze([path,Object.freeze({kind:'set',path,data:value,ts:timestamp})]);
  }));
}
function accountSyncMarkMutationBlocked(code='account-sync/not-ready',category='runtime'){
  const safeCode=accountSyncRuntimeData.diagnosticCode(code,'account-sync/not-ready');
  const unsafe=accountSyncModel.unsafeRecoveryCode(safeCode)||['canonical','unsafe-evidence'].includes(String(category||''));
  const preservedState=!unsafe&&['conflict','review-required'].includes(accountSyncUiState?.state)?accountSyncUiState.state:'sync-error';
  accountSyncUiState=Object.freeze({
    ...(accountSyncUiState||{}),state:preservedState,eligible:true,active:accountSyncUiState?.active===true,
    pendingCount:Number(accountSyncUiState?.pendingCount)||0,
    blockedCount:Number(accountSyncUiState?.blockedCount)||0,
    conflictCount:Number(accountSyncUiState?.conflictCount)||0,
    recoveryCandidateCount:Number(accountSyncUiState?.recoveryCandidateCount)||0,
    listenerState:String(accountSyncUiState?.listenerState||'not-ready'),
    listenerHealthy:accountSyncUiState?.listenerHealthy===true,
    controllerHealthy:preservedState==='sync-error'?false:accountSyncUiState?.controllerHealthy===true,
    projectionReady:managedAccountSyncRuntime?.projectionReady===true,
    lastError:preservedState==='sync-error'?safeCode:String(accountSyncUiState?.lastError||''),lastErrorCategory:preservedState==='sync-error'?String(category||'runtime'):String(accountSyncUiState?.lastErrorCategory||'')
  });
  refreshSyncUi();
}
async function accountSyncMutationAuthority(){
  if(ACCOUNT_SYNC_ROLLOUT.enabled!==true||ACCOUNT_SYNC_ROLLOUT.writesEnabled!==true)return Object.freeze({mode:'legacy'});
  const uid=auth?.currentUser?.uid,username=cur;
  if(!uid||!username){
    if(accountSyncEligibleUid)return Object.freeze({mode:'blocked',code:'account-sync/session-inactive'});
    return Object.freeze({mode:'legacy'});
  }
  let eligible=false;
  try{eligible=await accountSyncRolloutEligible(uid);}
  catch(error){
    const code=String(error?.code||'account-sync/rollout-check-failed');accountSyncMarkMutationBlocked(code);return Object.freeze({mode:'blocked',code});
  }
  if(uid!==auth?.currentUser?.uid||username!==cur)return Object.freeze({mode:'blocked',code:'account-sync/session-changed'});
  if(!eligible)return Object.freeze({mode:'legacy'});
  try{
    const started=await ensureAccountSyncRuntime();
    const runtime=managedAccountSyncRuntime;
    if(started?.ok&&accountSyncProjectionReady()&&runtime?.ownerUid===uid&&runtime?.controller){
      return Object.freeze({mode:'canonical',uid,username,runtime,controller:runtime.controller});
    }
    const code=String(started?.status||'account-sync/not-ready');accountSyncMarkMutationBlocked(code);return Object.freeze({mode:'blocked',code});
  }catch(error){
    const code=String(error?.code||'account-sync/start-failed');accountSyncMarkMutationBlocked(code);return Object.freeze({mode:'blocked',code});
  }
}
function accountSyncAuthorityCurrent(authority){
  return authority?.mode!=='canonical'||(
    authority.uid===auth?.currentUser?.uid&&authority.username===cur&&
    authority.runtime===managedAccountSyncRuntime&&authority.runtime?.ownerUid===authority.uid&&
    authority.controller===authority.runtime?.controller&&accountSyncProjectionReady()
  );
}
async function accountSyncFavoriteReviewAuthority(){
  if(ACCOUNT_SYNC_ROLLOUT.enabled!==true||ACCOUNT_SYNC_ROLLOUT.writesEnabled!==true)return Object.freeze({mode:'legacy'});
  const uid=auth?.currentUser?.uid,username=cur;
  if(!uid||!username)return Object.freeze({mode:'blocked',code:'account-sync/session-inactive'});
  let eligible=false;
  try{eligible=await accountSyncRolloutEligible(uid);}
  catch(error){return Object.freeze({mode:'blocked',code:String(error?.code||'account-sync/rollout-check-failed')});}
  if(uid!==auth?.currentUser?.uid||username!==cur)return Object.freeze({mode:'blocked',code:'account-sync/session-changed'});
  if(!eligible)return Object.freeze({mode:'legacy'});
  try{
    const runtime=managedAccountSyncRuntime;
    if(!runtime||runtime.ownerUid!==uid||!runtime.controller)return Object.freeze({mode:'blocked',code:'account-sync/review-not-ready'});
    accountSyncUiState=await runtime.snapshot();accountSyncClearStaleRecoveryPresentation();refreshSyncUi();
    if(uid!==auth?.currentUser?.uid||username!==cur||runtime!==managedAccountSyncRuntime)return Object.freeze({mode:'blocked',code:'account-sync/session-changed'});
    const state=String(accountSyncUiState?.state||'inactive');
    if(['review-required','saved'].includes(state)&&runtime.projectionReady===true&&accountSyncUiState?.active===true&&accountSyncUiState?.listenerHealthy===true&&accountSyncUiState?.controllerHealthy===true&&!Number(accountSyncUiState?.pendingCount)&&!Number(accountSyncUiState?.blockedCount)&&!Number(accountSyncUiState?.conflictCount))return Object.freeze({mode:'canonical-review',uid,username,runtime,controller:runtime.controller});
    return Object.freeze({mode:'blocked',code:'account-sync/review-not-ready'});
  }catch(error){return Object.freeze({mode:'blocked',code:String(error?.code||'account-sync/start-failed')});}
}
function accountSyncFavoriteReviewAuthorityCurrent(authority){
  const state=String(accountSyncUiState?.state||'inactive');
  return authority?.mode!=='canonical-review'||(
    authority.uid===auth?.currentUser?.uid&&authority.username===cur&&
    authority.runtime===managedAccountSyncRuntime&&authority.runtime?.ownerUid===authority.uid&&
    authority.controller===authority.runtime?.controller&&authority.runtime?.projectionReady===true&&
    accountSyncUiState?.active===true&&accountSyncUiState?.listenerHealthy===true&&accountSyncUiState?.controllerHealthy===true&&
    !['sync-error','conflict','inactive'].includes(state)&&!Number(accountSyncUiState?.pendingCount)&&!Number(accountSyncUiState?.blockedCount)&&!Number(accountSyncUiState?.conflictCount)
  );
}
async function accountSyncPreservedReviewAuthority(){
  const authority=await accountSyncFavoriteReviewAuthority();
  if(authority.mode!=='canonical-review')return authority;
  const snapshot=accountSyncUiState||{},runtime=authority.runtime;
  if(snapshot.state!=='review-required'||!Number(snapshot.recoveryCandidateCount)||typeof runtime.completeRecoveryReviews!=='function')return Object.freeze({mode:'blocked',code:'account-sync/recovery-review-not-ready'});
  const candidates=await runtime.listRecoveryCandidates(),candidateIds=[];
  if(!accountSyncFavoriteReviewAuthorityCurrent(authority)||candidates.length!==Number(snapshot.recoveryCandidateCount))return Object.freeze({mode:'blocked',code:'account-sync/recovery-review-changed'});
  for(const candidate of candidates){
    const candidateId=String(candidate?.candidateId||'');
    if(candidate?.ownerUid!==authority.uid||candidate?.resolved===true||accountSyncModel.firebaseKey(candidateId,700)!==candidateId)return Object.freeze({mode:'blocked',code:'account-sync/recovery-review-invalid'});
    candidateIds.push(candidateId);
  }
  return Object.freeze({...authority,candidateIds:Object.freeze(candidateIds.sort()),sessionGeneration:_sessionTransientGeneration,runtimeGeneration:accountSyncRuntimeGeneration});
}
function accountSyncPreservedReviewAuthorityCurrent(authority){
  return authority?.mode==='canonical-review'&&authority.sessionGeneration===_sessionTransientGeneration&&authority.runtimeGeneration===accountSyncRuntimeGeneration&&accountSyncFavoriteReviewAuthorityCurrent(authority);
}
function accountSyncPreservedReviewReady(runtime=managedAccountSyncRuntime,snapshot=accountSyncUiState){
  return runtime?.projectionReady===true&&runtime.ownerUid===auth?.currentUser?.uid&&snapshot?.state==='review-required'&&snapshot?.active===true&&snapshot?.listenerHealthy===true&&snapshot?.controllerHealthy===true&&!Number(snapshot?.pendingCount)&&!Number(snapshot?.blockedCount)&&!Number(snapshot?.conflictCount)&&Number(snapshot?.recoveryCandidateCount)>0;
}
function accountSyncProjectionReady(){
  const state=String(accountSyncUiState?.state||'inactive');
  return!!accountSyncEligibleUid&&accountSyncEligibleUid===auth?.currentUser?.uid&&managedAccountSyncRuntime?.projectionReady===true&&managedAccountSyncRuntime.ownerUid===accountSyncEligibleUid&&accountSyncUiState?.active===true&&accountSyncUiState?.listenerHealthy===true&&accountSyncUiState?.controllerHealthy===true&&!['sync-error','conflict','review-required','inactive'].includes(state);
}
function accountSyncOrganizationHydrating(){
  const uid=auth?.currentUser?.uid,state=String(accountSyncUiState?.state||'inactive');
  if(!uid||ACCOUNT_SYNC_ROLLOUT.enabled!==true)return false;
  const bound=accountSyncEligibleUid===uid||managedAccountSyncRuntime?.ownerUid===uid;
  return bound&&managedAccountSyncRuntime?.projectionReady!==true&&!['sync-error','conflict','review-required'].includes(state);
}
function accountSyncClone(value){
  if(value==null)return value;
  try{return structuredClone(value);}catch{return JSON.parse(JSON.stringify(value));}
}
function accountSyncDeviceInstallId(uid){
  const owner=accountSyncModel.firebaseKey(uid,128);if(!owner)throw new TypeError('Account sync device owner is invalid');
  const key=`${ACCOUNT_SYNC_DEVICE_KEY_PREFIX}:${encodeURIComponent(owner)}`;
  let value='';try{value=String(localStorage.getItem(key)||'');}catch{}
  if(/^device_[a-f0-9]{32,96}$/.test(value))return value;
  const random=typeof crypto.randomUUID==='function'?crypto.randomUUID().replace(/-/g,''):(()=>{const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');})();
  value=`device_${random}`;
  localStorage.setItem(key,value);
  return value;
}
function buildAccountSyncCatalogIndex(){
  if(accountSyncCatalogIndex)return accountSyncCatalogIndex;
  const byId=new Map(),byLane=new Map(),aliasesByLane=new Map(),globalAliases=new Map();
  const remember=(map,key,entry)=>{
    if(!key)return;
    const current=map.get(key);
    if(!current)map.set(key,entry);
    else if(current.catalogId!==entry.catalogId)map.set(key,null);
  };
  for(const lane of OWNED_MY_LIST_TYPES){
    const laneIds=new Map(),laneAliases=new Map();
    for(const raw of listSource(lane)){
      const entry=pokemonCatalogDomain.decorateCatalogEntry(raw),catalogId=String(entry?.catalogId||'');
      if(!entry?.name||!catalogId)continue;
      laneIds.set(catalogId,entry);if(!byId.has(catalogId))byId.set(catalogId,entry);
      const names=[entry.name,entry.displayName,...(entry.legacyAliases||[]),...(entry.searchAliases||[])];
      for(const name of names){const key=pokemonCatalogDomain.normalizeCatalogKey(name);remember(laneAliases,key,entry);remember(globalAliases,key,entry);}
    }
    byLane.set(lane,laneIds);aliasesByLane.set(lane,laneAliases);
  }
  accountSyncCatalogIndex=Object.freeze({byId,byLane,aliasesByLane,globalAliases});
  return accountSyncCatalogIndex;
}
function accountSyncCatalogEntryForId(catalogId,identity={}){
  const index=buildAccountSyncCatalogIndex(),id=String(catalogId||'');
  const lane=index.byLane.get(identity?.lane);
  return lane?.get(id)||index.byId.get(id)||null;
}
function accountSyncCatalogEntryForName(lane,name){
  const index=buildAccountSyncCatalogIndex(),key=pokemonCatalogDomain.normalizeCatalogKey(name);
  if(!key)return null;
  const exact=index.aliasesByLane.get(lane)?.get(key);
  if(exact)return exact;
  const globalEntry=index.globalAliases.get(key);
  return globalEntry||null;
}
function accountSyncCatalogIdentity(type,name,raw={}){
  const requested=String(raw?.catalogId||'').trim(),entry=requested?accountSyncCatalogEntryForId(requested,{lane:type}):accountSyncCatalogEntryForName(type,name);
  if(!entry||requested&&entry.catalogId!==requested)return null;
  return Object.freeze({catalogId:entry.catalogId});
}
function accountSyncOrdersSnapshot(){
  return Object.fromEntries(OWNED_MY_LIST_TYPES.map(type=>[type,readMyListOrder(type,cur)||{priorities:{H:[],M:[],L:[],U:[]}}]));
}
function accountSyncExactFavoriteUid(displayName,raw={},account={}){
  const candidate=accountSyncModel.firebaseKey(raw?.targetUid,128);
  if(candidate){
    const canonical=account?.favorites?.[candidate]||managedAccountSyncRuntime?.controller.getEntity('favorite',candidate);
    if(canonical?.identity?.targetUid===candidate&&canonical?.values?.displayName===displayName)return candidate;
    if(allData.users?.[displayName]?.authUid===candidate&&allData.authIndex?.[candidate]?.username===displayName)return candidate;
  }
  return accountSyncProduct.exactFavoriteTargetUid(displayName,{users:allData.users,authIndex:allData.authIndex});
}
async function accountSyncReadLegacySources({account}={}){
  const uid=auth?.currentUser?.uid,username=cur;
  if(!uid||!username||!db)throw Object.assign(new Error('Account sync source session is unavailable'),{code:'account-sync/source-session-unavailable'});
  const paths=[...OWNED_MY_LIST_TYPES.map(type=>`${type}/${username}`),`users/${username}`];
  const snapshots=await Promise.all(paths.map(path=>withTimeout(get(ref(db,path)),8000,'Reading account sync migration source timed out','account-sync/source-read-timeout')));
  const remoteLists={};OWNED_MY_LIST_TYPES.forEach((type,index)=>{remoteLists[type]=snapshots[index].exists()?snapshots[index].val():{};});
  const remoteProfile=snapshots.at(-1).exists()?snapshots.at(-1).val():{};
  const local=getLocal(),history=ensureTrainerHistoryStore()?.read()||{favorites:[],tags:{}};
  const localLists=Object.fromEntries(OWNED_MY_LIST_TYPES.map(type=>[type,accountSyncClone(local[type]?.[username]||{})]));
  const localBoard=accountSyncClone(local.users?.[username]?.specialTradeBoard||{lf:[],ft:[]});
  const orders=accountSyncOrdersSnapshot(),legacyQueue=accountSyncClone(syncQueue||{});
  return Object.freeze({
    deviceInstallId:accountSyncDeviceInstallId(uid),legacyRemoteLists:remoteLists,legacyLocalLists:localLists,
    legacyRemoteBoard:accountSyncClone(remoteProfile?.specialTradeBoard||{lf:[],ft:[]}),legacyLocalBoard:localBoard,
    legacyQueue,orders,favorites:accountSyncClone(history.favorites),tags:accountSyncClone(history.tags),
    legacyRetainedSnapshot:Object.freeze({capturedAt:Date.now(),legacyRemoteLists:accountSyncClone(remoteLists),legacyLocalLists:localLists,legacyRemoteBoard:accountSyncClone(remoteProfile?.specialTradeBoard||{lf:[],ft:[]}),legacyLocalBoard:localBoard,legacyQueue,orders:accountSyncClone(orders),favorites:accountSyncClone(history.favorites),tags:accountSyncClone(history.tags)}),
    dependencies:Object.freeze({
      parseListValue:value=>parsePri(value),
      catalogIdentity:(type,name,raw)=>accountSyncCatalogIdentity(type,name,raw),
      genderForVariant:value=>entryGender(value),
      resolveFavoriteUid:(displayName,raw)=>accountSyncExactFavoriteUid(displayName,raw,account)
    })
  });
}
function accountSyncEncodedPriority(values={}){
  let variant=normalizeTradeQualifier(values.variant||'');
  if(values.gender&&entryGender(variant)!==values.gender){
    variant=normalizeTradeQualifier(variant.replace(/(^|[^\p{L}\p{N}])[FM](?=$|[^\p{L}\p{N}])/gu,'$1'));
    variant=normalizeTradeQualifier(`${variant} ${values.gender.toUpperCase()}`);
  }
  return priValue(values.priority,variant,values.lucky,values.xxl,values.xxs,values.shiny,values.backgroundId);
}
function applyAccountSyncCanonicalEntities(entities){
  if(accountSyncProjectionApplying||!managedAccountSyncRuntime?.projectionReady||managedAccountSyncRuntime.ownerUid!==auth?.currentUser?.uid)return false;
  const projected=accountSyncProduct.projectTradeEntities({entities,catalogEntryForId:accountSyncCatalogEntryForId,encodePriority:accountSyncEncodedPriority});
  if(projected.unresolved.length){
    accountSyncMigrationState='blocked';
    accountSyncUiState=Object.freeze({...accountSyncUiState,state:'sync-error',projectionReady:false,controllerHealthy:false,lastError:'account-sync/catalog-projection-unresolved',lastErrorCategory:'canonical'});
    refreshSyncUi();return false;
  }
  accountSyncProjectionApplying=true;
  try{
    accountSyncCanonicalEntities=Array.from(entities||[]);
    const s=getLocal();
    for(const type of OWNED_MY_LIST_TYPES){
      s[type][cur]=accountSyncClone(projected.lists[type]);
      persistMyListOrder({version:MY_LIST_ORDER_VERSION,owner:{uid:auth.currentUser.uid,username:cur},priorities:projected.orders[type].priorities},type,cur);
    }
    s.users[cur]={...s.users[cur],specialTradeBoard:accountSyncClone(projected.board)};
    const latest=accountSyncCanonicalEntities.reduce((value,entity)=>Math.max(value,Number(entity.updatedAt)||0),0);
    if(latest)s.users[cur]={...s.users[cur],lastUpdated:Math.max(Number(s.users[cur]?.lastUpdated)||0,latest)};
    saveLocal(s);allData=runtimeDataWithSelectedTrainer(s);
    const organizer=accountSyncProduct.organizerProjection(accountSyncCanonicalEntities),store=ensureTrainerHistoryStore();
    if(store){const result=store.replaceSyncedOrganization(organizer);favoriteShareSessionCache?.syncFavorites(result.state.favorites);}
    queueRefreshAll('account-sync:canonical');
    return true;
  }finally{accountSyncProjectionApplying=false;}
}
async function publishAccountSyncProjection(acceptedRows){
  const projected=accountSyncProduct.projectAcceptedPublicRows({rows:acceptedRows,catalogEntryForId:accountSyncCatalogEntryForId,encodePriority:accountSyncEncodedPriority});
  if(projected.unresolved.length)throw Object.assign(new Error('Accepted public projection could not be resolved'),{code:'account-sync/public-projection-unresolved'});
  const source=accountSyncClone(getLocal());
  for(const type of OWNED_MY_LIST_TYPES){
    if(!source[type])source[type]={};
    source[type][cur]=accountSyncClone(projected.lists[type]);
  }
  const result=requestPublicSharePublication('owned_list_edit',source,cur);
  if(!result?.ok&&result?.status!=='pending')throw Object.assign(new Error('Public projection is pending or unavailable'),{code:result?.error?.code||'account-sync/public-projection-failed'});
  return result;
}
function retireMigratedLegacyListQueue(){
  let changed=false;const nextQueue={...syncQueue};
  for(const [key,item] of Object.entries(syncQueue||{})){
    const retained=accountSyncRetainedLegacyQueueEntries(key,item,cur);
    if(retained.length===1&&retained[0][0]===key&&retained[0][1]===item)continue;
    delete nextQueue[key];changed=true;
    for(const[nextKey,nextItem]of retained){
      const existing=nextQueue[nextKey];
      if(!existing||Number(existing.ts)<=Number(nextItem.ts))nextQueue[nextKey]=nextItem;
    }
  }
  if(changed){syncQueue=nextQueue;saveSyncQueue();showSyncDot(!!Object.keys(syncQueue).length);}
}
function stopAccountSyncRuntime(){
  if(accountSyncRuntimeStopPromise)return accountSyncRuntimeStopPromise;
  accountSyncRuntimeGeneration++;
  const runtime=managedAccountSyncRuntime,pending=accountSyncRuntimeStartPromise;
  managedAccountSyncRuntime=null;accountSyncRuntimeStartPromise=null;accountSyncRuntimeStartBinding='';accountSyncEligibleUid='';accountSyncCanonicalEntities=[];
  const stopping=(async()=>{if(runtime)await runtime.stop();else await pending?.catch(()=>{});})();
  accountSyncRuntimeStopPromise=stopping;
  return stopping.finally(()=>{if(accountSyncRuntimeStopPromise===stopping)accountSyncRuntimeStopPromise=null;});
}
async function ensureAccountSyncRuntime(){
  const uid=auth?.currentUser?.uid,username=cur;
  const eligible=await accountSyncRolloutEligible(uid);
  if(accountSyncRuntimeStopPromise)await accountSyncRuntimeStopPromise;
  if(uid!==auth?.currentUser?.uid||username!==cur)return Object.freeze({ok:false,status:'session-changed'});
  if(!eligible){
    if(managedAccountSyncRuntime)await stopAccountSyncRuntime();
    accountSyncUiState=Object.freeze({state:'local-only',eligible:false,active:false,pendingCount:0,blockedCount:0,conflictCount:0});refreshSyncUi();
    return Object.freeze({ok:true,status:'disabled'});
  }
  if(!firebaseDataProtectionReady||!db||!uid||!username)return Object.freeze({ok:false,status:'not-ready'});
  if(managedAccountSyncRuntime?.ownerUid===uid){
    try{accountSyncUiState=await managedAccountSyncRuntime.snapshot();accountSyncClearStaleRecoveryPresentation();refreshSyncUi();}
    catch(error){accountSyncMarkMutationBlocked(error,'runtime');return Object.freeze({ok:false,status:'runtime-unhealthy'});}
    return accountSyncProjectionReady()?Object.freeze({ok:true,status:'active'}):Object.freeze({ok:false,status:'runtime-unhealthy'});
  }
  const binding=`${uid}\n${username}`;
  if(accountSyncRuntimeStartPromise&&accountSyncRuntimeStartBinding===binding)return accountSyncRuntimeStartPromise;
  if(accountSyncRuntimeStartPromise||managedAccountSyncRuntime)await stopAccountSyncRuntime();
  if(uid!==auth?.currentUser?.uid||username!==cur)return Object.freeze({ok:false,status:'session-changed'});
  const generation=++accountSyncRuntimeGeneration;
  accountSyncEligibleUid=uid;
  const startPromise=(async()=>{
    const journal=accountSyncJournalData.createAccountSyncJournal({ownerUid:uid});
    const repository=accountSyncRepositoryData.createAccountSyncRepository({database:db,ref,get,onValue,runTransaction,serverTimestamp,ownerUid:uid});
    let runtime=null;
    const currentSession=()=>generation===accountSyncRuntimeGeneration&&managedAccountSyncRuntime===runtime&&auth?.currentUser?.uid===uid&&cur===username;
    runtime=accountSyncRuntimeData.createAccountSyncRuntime({
      ownerUid:uid,username,journal,repository,enabled:ACCOUNT_SYNC_ROLLOUT.enabled,writesEnabled:ACCOUNT_SYNC_ROLLOUT.writesEnabled,allowlistedUids:[uid],
      readMigrationSources:accountSyncReadLegacySources,
      onState:state=>{if(currentSession()){accountSyncUiState=state;accountSyncClearStaleRecoveryPresentation();refreshSyncUi();}},
      onCanonicalEntities:entities=>currentSession()?applyAccountSyncCanonicalEntities(entities):false,
      onPublicProjection:acceptedRows=>currentSession()?publishAccountSyncProjection(acceptedRows):Promise.reject(Object.assign(new Error('Account sync session changed before publication'),{code:'account-sync/session-changed'})),
      onMigrationState:detail=>{if(currentSession()){accountSyncMigrationState=detail.state;refreshSyncUi();}}
    });
    managedAccountSyncRuntime=runtime;
    try{
      const result=await runtime.start();
      if(!currentSession()){await runtime.stop();return Object.freeze({ok:false,status:'session-changed'});}
      accountSyncUiState=await runtime.snapshot();accountSyncClearStaleRecoveryPresentation();refreshSyncUi();
      if(!accountSyncProjectionReady())return Object.freeze({ok:false,status:'runtime-unhealthy'});
      retireMigratedLegacyListQueue();return result;
    }catch(error){
      if(currentSession()){
        let failedState={};try{failedState=await runtime.snapshot();}catch{}
        const safeCode=accountSyncRuntimeData.diagnosticCode(error,failedState.lastError||'account-sync/migration-failed');
        accountSyncUiState=Object.freeze({
          ...failedState,state:'sync-error',eligible:true,active:failedState.active===true,
          pendingCount:Number(failedState.pendingCount)||0,blockedCount:Number(failedState.blockedCount)||0,
          conflictCount:Number(failedState.conflictCount)||0,recoveryCandidateCount:Number(failedState.recoveryCandidateCount)||0,
          projectionReady:false,controllerHealthy:false,lastError:safeCode,
          lastErrorCategory:String(failedState.lastErrorCategory||(/^account-sync\/migration-/.test(safeCode)?'migration':'startup'))
        });refreshSyncUi();
      }
      throw error;
    }
  })();
  accountSyncRuntimeStartBinding=binding;accountSyncRuntimeStartPromise=startPromise;
  try{return await startPromise;}
  finally{if(accountSyncRuntimeStartPromise===startPromise){accountSyncRuntimeStartPromise=null;accountSyncRuntimeStartBinding='';}}
}
function accountSyncRecoveryStatus(value){
  const status=String(value||'failed');return['idle','running','recovered','failed','pending','review'].includes(status)?status:'failed';
}
function accountSyncIdleRecoveryState(){return Object.freeze({status:'idle',attempt:0,code:'account-sync/none'});}
function invalidateAccountSyncRecovery(_reason='session_changed'){
  accountSyncRecoveryCoordinatorGeneration++;
  accountSyncRecoveryCoordinator=null;accountSyncRecoveryCoordinatorBinding='';accountSyncRecoverySessionBinding=null;
  accountSyncRecoveryCoordinatorRuntimeGeneration=-1;
  accountSyncRecoveryStateBinding='';accountSyncRecoveryState=accountSyncIdleRecoveryState();
}
function accountSyncRecoveryBindingCurrent(binding){
  return!!binding?.uid&&!!binding?.username&&binding.uid===auth?.currentUser?.uid&&binding.username===cur&&binding.sessionGeneration===_sessionTransientGeneration&&binding.coordinatorGeneration===accountSyncRecoveryCoordinatorGeneration;
}
function accountSyncRecoveryPresentationBinding(binding,runtimeGeneration=accountSyncRuntimeGeneration){
  if(!binding)return'';
  return`${binding.uid}\n${binding.username}\n${binding.sessionGeneration}\n${binding.coordinatorGeneration}\n${runtimeGeneration}`;
}
function accountSyncEffectiveRecoveryState(){
  if(accountSyncRecoveryState.status==='idle')return accountSyncRecoveryState;
  return accountSyncRecoveryStateBinding&&accountSyncRecoverySessionBinding&&accountSyncRecoveryStateBinding===accountSyncRecoveryPresentationBinding(accountSyncRecoverySessionBinding)&&accountSyncRecoveryBindingCurrent(accountSyncRecoverySessionBinding)?accountSyncRecoveryState:accountSyncIdleRecoveryState();
}
function accountSyncClearStaleRecoveryPresentation(){
  const state=accountSyncEffectiveRecoveryState(),uid=auth?.currentUser?.uid||'',runtime=managedAccountSyncRuntime;
  if(!['failed','pending','review'].includes(state.status))return false;
  if(!accountSyncRuntimeData.healthySnapshot({snapshot:accountSyncUiState||{},runtimePresent:!!runtime&&runtime.ownerUid===uid,projectionReady:runtime?.projectionReady===true,sessionCurrent:!!uid&&!!cur}))return false;
  accountSyncRecoveryState=accountSyncIdleRecoveryState();accountSyncRecoveryStateBinding='';return true;
}
async function accountSyncRecoveryContext(expectedBinding=null){
  const uid=auth?.currentUser?.uid||'',username=cur||'',runtime=managedAccountSyncRuntime;
  const binding=expectedBinding||Object.freeze({uid,username,sessionGeneration:_sessionTransientGeneration,coordinatorGeneration:accountSyncRecoveryCoordinatorGeneration});
  const boundRuntime=runtime?.ownerUid===binding.uid?runtime:null;
  const runtimeGeneration=accountSyncRuntimeGeneration;
  let snapshot=accountSyncUiState||{};
  if(boundRuntime){
    try{snapshot=await boundRuntime.snapshot();}
    catch(error){snapshot=Object.freeze({...snapshot,state:'sync-error',active:false,listenerHealthy:false,controllerHealthy:false,lastError:accountSyncRuntimeData.diagnosticCode(error,'account-sync/snapshot-failed'),lastErrorCategory:'runtime'});}
  }
  const sessionCurrent=accountSyncRecoveryBindingCurrent(binding);
  return Object.freeze({sessionBinding:binding,runtime:boundRuntime,runtimeGeneration,snapshot,runtimePresent:!!boundRuntime,projectionReady:boundRuntime?.projectionReady===true,sessionCurrent});
}
function accountSyncRecoveryContextCurrent(context){
  const binding=context?.sessionBinding;if(!accountSyncRecoveryBindingCurrent(binding))return false;
  if(context?.runtime&&context.runtime!==managedAccountSyncRuntime)return false;
  if(Number.isSafeInteger(context?.runtimeGeneration)&&context.runtimeGeneration!==accountSyncRuntimeGeneration)return false;
  return true;
}
function accountSyncCurrentRecoveryPlan(){
  const runtime=managedAccountSyncRuntime,uid=auth?.currentUser?.uid||'';
  return accountSyncRuntimeData.recoveryPlan({snapshot:accountSyncUiState||{},runtimePresent:!!runtime&&runtime.ownerUid===uid,projectionReady:runtime?.projectionReady===true,sessionCurrent:!!uid&&!!cur&&(!accountSyncEligibleUid||accountSyncEligibleUid===uid)});
}
function getAccountSyncRecoveryCoordinator(){
  const uid=auth?.currentUser?.uid||'',username=cur||'',sessionGeneration=_sessionTransientGeneration;
  if(accountSyncRecoveryCoordinator&&accountSyncRecoverySessionBinding&&accountSyncRecoveryBindingCurrent(accountSyncRecoverySessionBinding)&&accountSyncRecoveryCoordinatorRuntimeGeneration===accountSyncRuntimeGeneration&&accountSyncRecoverySessionBinding.uid===uid&&accountSyncRecoverySessionBinding.username===username&&accountSyncRecoverySessionBinding.sessionGeneration===sessionGeneration)return accountSyncRecoveryCoordinator;
  const coordinatorGeneration=++accountSyncRecoveryCoordinatorGeneration,sessionBinding=Object.freeze({uid,username,sessionGeneration,coordinatorGeneration}),bindingKey=`${uid}\n${username}\n${sessionGeneration}\n${coordinatorGeneration}`;
  accountSyncRecoveryCoordinatorRuntimeGeneration=accountSyncRuntimeGeneration;
  let coordinator=null;
  coordinator=accountSyncRuntimeData.createRecoveryCoordinator({
    capture:()=>accountSyncRecoveryContext(sessionBinding),
    isCurrent:accountSyncRecoveryContextCurrent,
    retryBlocked:context=>context.runtime?.retryBlocked?.()||accountSyncModel.failure('account-sync/runtime-absent','Account sync runtime is unavailable'),
    restart:async context=>{
      const binding=context.sessionBinding;
      if(!accountSyncRecoveryContextCurrent(context))throw Object.assign(new Error('Account sync session changed'),{code:'account-sync/session-changed'});
      await stopAccountSyncRuntime();
      if(!accountSyncRecoveryBindingCurrent(binding))throw Object.assign(new Error('Account sync session changed'),{code:'account-sync/session-changed'});
      const started=await ensureAccountSyncRuntime();
      if(!started?.ok&&!accountSyncPreservedReviewReady())throw Object.assign(new Error('Account sync restart did not become ready'),{code:accountSyncRuntimeData.diagnosticCode(started?.status,'account-sync/restart-failed')});
      if(accountSyncRecoveryCoordinator!==coordinator||accountSyncRecoveryCoordinatorBinding!==bindingKey||!accountSyncRecoveryBindingCurrent(binding))throw Object.assign(new Error('Account sync session changed'),{code:'account-sync/session-changed'});
      accountSyncRecoveryCoordinatorRuntimeGeneration=accountSyncRuntimeGeneration;
      return accountSyncRecoveryContext(binding);
    },
    recapture:context=>accountSyncRecoveryContext(context.sessionBinding),
    onProgress:detail=>{
      if(accountSyncRecoveryCoordinator!==coordinator||accountSyncRecoveryCoordinatorBinding!==bindingKey||accountSyncRecoveryCoordinatorRuntimeGeneration!==accountSyncRuntimeGeneration||!accountSyncRecoveryContextCurrent({sessionBinding}))return;
      accountSyncRecoveryState=Object.freeze({status:accountSyncRecoveryStatus(detail?.status),attempt:Number(detail?.attempt)||0,action:String(detail?.action||'none'),category:String(detail?.category||'runtime'),code:accountSyncRuntimeData.diagnosticCode(detail?.code,detail?.status==='running'?'account-sync/recovery-running':'account-sync/recovery-failed')});
      accountSyncRecoveryStateBinding=accountSyncRecoveryPresentationBinding(sessionBinding,accountSyncRecoveryCoordinatorRuntimeGeneration);
      refreshSyncUi();
    }
  });
  accountSyncRecoveryCoordinator=coordinator;accountSyncRecoveryCoordinatorBinding=bindingKey;accountSyncRecoverySessionBinding=sessionBinding;return coordinator;
}
async function performAccountSyncRecovery(){
  const coordinator=getAccountSyncRecoveryCoordinator(),sessionBinding=accountSyncRecoverySessionBinding,result=await coordinator.recover();
  if(accountSyncRecoveryCoordinator!==coordinator||accountSyncRecoverySessionBinding!==sessionBinding||accountSyncRecoveryCoordinatorRuntimeGeneration!==accountSyncRuntimeGeneration||!accountSyncRecoveryContextCurrent({sessionBinding}))return result;
  try{
    const context=await accountSyncRecoveryContext(sessionBinding);
    if(context.sessionCurrent)accountSyncUiState=context.snapshot;
  }catch{}
  accountSyncRecoveryState=Object.freeze({status:accountSyncRecoveryStatus(result.status),attempt:Number(result.attempt)||0,action:String(result.action||'none'),category:String(result.category||'runtime'),code:accountSyncRuntimeData.diagnosticCode(result.code,result.ok?'account-sync/recovered':'account-sync/recovery-failed')});
  accountSyncRecoveryStateBinding=accountSyncRecoveryPresentationBinding(sessionBinding,accountSyncRecoveryCoordinatorRuntimeGeneration);
  refreshSyncUi();return result;
}
async function recordAccountSyncUnresolved(item,source='product-edit',runtime=managedAccountSyncRuntime){
  if(!runtime)return;
  await runtime.recordRecoveryCandidate({reason:item.reason||'catalog-identity-unresolved',entityType:'tradeEntry',entityId:`unresolved:${item.surface}:${item.lane}:${String(item.name||'').slice(0,500)}`,identity:{surface:item.surface,lane:item.lane,unresolved:true},values:{displayName:String(item.name||'Unknown').slice(0,160)},source});
}
async function applyAccountSyncTradeMutations(mutations,controller=managedAccountSyncRuntime?.controller){
  if(!controller)return accountSyncModel.failure('account-sync/session-inactive','Cross-device sync session is not active');
  return controller.mutateBatch(mutations.map(mutation=>({
    entityType:mutation.entityType,entityId:mutation.entityId,identity:mutation.identity,kind:mutation.kind,
    patch:mutation.kind==='add'?mutation.values:(mutation.kind==='patch'?mutation.patch:{})
  })));
}
async function writeAccountSyncList(type,list,{orderModel,authority}={}){
  const runtime=authority?.runtime||managedAccountSyncRuntime,controller=authority?.controller||runtime?.controller;
  if(authority&&!accountSyncAuthorityCurrent(authority))return accountSyncModel.failure('account-sync/session-changed','Cross-device sync session changed');
  const rows=accountSyncProduct.listRows({lists:{[type]:list||{}},orders:{[type]:orderModel||currentMyListOrderModel(type,cur)},parsePriority:value=>parsePri(value),catalogIdForListEntry:({lane,name,encoded})=>accountSyncCatalogIdentity(lane,name,encoded)?.catalogId||'',genderForVariant:entryGender});
  if(rows.unresolved.length){for(const item of rows.unresolved)await recordAccountSyncUnresolved(item,'product-edit',runtime);return Object.freeze({ok:false,error:{code:'account-sync/catalog-identity-unresolved'}});}
  const mutations=accountSyncProduct.planTradeMutations({currentEntities:accountSyncCanonicalEntities,desiredRows:rows.rows,scope:{surface:'my-list',lanes:[type]}});
  return applyAccountSyncTradeMutations(mutations,controller);
}
async function writeAccountSyncSpecialBoard(board,{authority}={}){
  const runtime=authority?.runtime||managedAccountSyncRuntime,controller=authority?.controller||runtime?.controller;
  if(authority&&!accountSyncAuthorityCurrent(authority))return accountSyncModel.failure('account-sync/session-changed','Cross-device sync session changed');
  const rows=accountSyncProduct.specialBoardRows({board,catalogIdForBoardEntry:({entry})=>accountSyncCatalogIdentity('wishlist',entry?.name,entry)?.catalogId||''});
  if(rows.unresolved.length){for(const item of rows.unresolved)await recordAccountSyncUnresolved(item,'special-board-edit',runtime);return Object.freeze({ok:false,error:{code:'account-sync/catalog-identity-unresolved'}});}
  const mutations=accountSyncProduct.planTradeMutations({currentEntities:accountSyncCanonicalEntities,desiredRows:rows.rows,scope:{surface:'special-board',lanes:['looking-for','for-trade']}});
  return applyAccountSyncTradeMutations(mutations,controller);
}
function resetOwnedHydrationState(){
  _firstSyncDone=false;
  _pathLoadState={};
}
function requireOwnedListHydration(type,u){
  if(!OWNED_MY_LIST_TYPES.includes(type)||!u)return false;
  if(u===cur&&accountSyncProjectionReady())return true;
  if(!fbOn||!db)return true;
  const authUid=String(auth?.currentUser?.uid||'');
  const activeOwner=managedSessionCache?.snapshot?.().activeOwner;
  const sameAuthenticatedOwner=!!authUid&&u===cur&&activeOwner?.uid===authUid&&activeOwner?.username===u;
  const hydrated=sameAuthenticatedOwner&&(ownedExactReadsEnabled()
    ?managedOwnedDataCoordinator?.isHydratedFor(type,{uid:authUid,username:u})===true
    :_pathLoadState[type]==='loaded');
  if(hydrated)return true;
  if(sameAuthenticatedOwner)ensureListSubscribed(type);
  toast(i18nCore.t('storage.listHydrationRequired'),5000);
  return false;
}
function listEntryValuesEqual(a,b){
  if(a===b)return true;
  try{return JSON.stringify(a)===JSON.stringify(b);}catch{return false;}
}
function queueListEntryDiff(type,u,previous,next){
  const before=previous&&typeof previous==='object'?previous:{};
  const after=next&&typeof next==='object'?next:{};
  const names=new Set([...Object.keys(before),...Object.keys(after)]);
  const patch={};
  names.forEach(name=>{
    const beforeHas=Object.prototype.hasOwnProperty.call(before,name);
    const afterHas=Object.prototype.hasOwnProperty.call(after,name);
    if(beforeHas===afterHas&&listEntryValuesEqual(before[name],after[name]))return;
    patch[name]=afterHas?after[name]:null;
  });
  const changed=Object.keys(patch).length;
  if(!changed)return Object.freeze({ok:true,status:'no_changes',changed:0});
  return queueMyListUpdate(type,u,patch);
}
async function writeList(type,u,list,{previousList,orderModel}={}){
  const requested={...(list||{})},base={...(previousList||getLocal()?.[type]?.[u]||{})},session={uid:String(auth?.currentUser?.uid||''),username:cur};
  const prior=writeList.pending||Promise.resolve(),task=prior.then(()=>writeListSerialized(type,u,requested,{base,orderModel,session}));
  writeList.pending=task.then(()=>undefined,()=>undefined);
  return task;
}
async function writeListSerialized(type,u,requested,{base,orderModel,session}={}){
  if(session?.username!==cur||session?.uid!==String(auth?.currentUser?.uid||''))return false;
  const authority=u===cur?await accountSyncMutationAuthority():Object.freeze({mode:'legacy'});
  if(session?.username!==cur||session?.uid!==String(auth?.currentUser?.uid||''))return false;
  if(authority.mode==='blocked'){toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);return false;}
  if(!requireOwnedListHydration(type,u))return false;
  const s=getLocal();
  if(!s[type])s[type]={};
  const cachedPrevious={...(s[type][u]||{})};
  const list=accountSyncProduct.rebaseListEdit({
    base,current:cachedPrevious,desired:requested,
    decode:value=>parsePri(value),
    encode:value=>priValue(value.priority,value.variant,value.lucky,value.xxl,value.xxs,value.shiny,value.backgroundId)
  });
  if(authority.mode==='canonical'){
    const result=await writeAccountSyncList(type,list||{},{orderModel,authority});
    if(!result?.ok||!accountSyncAuthorityCurrent(authority)){toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);return false;}
    const delta=Object.keys(list||{}).length-Object.keys(cachedPrevious).length;
    if(delta)recordActivityEvent(u,delta);
    expandMyListPrioritiesReceivingEntries(type,u,cachedPrevious,list||{});
    refreshAddPokemonChoices(type,u);
    return true;
  }
  if(fbOn&&db){
    const queued=queueListEntryDiff(type,u,cachedPrevious,list||{});
    if(!queued.ok){
      toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);
      return false;
    }
  }
  // Record activity delta for sparkline
  const prevCount=Object.keys(cachedPrevious).length;
  const newCount=Object.keys(list||{}).length;
  if(prevCount!==newCount)recordActivityEvent(u,newCount-prevCount);
  expandMyListPrioritiesReceivingEntries(type,u,cachedPrevious,list||{});
  s[type][u]=list;
  const now=Date.now();
  s.users[u]={...s.users[u],lastUpdated:now,lastSeen:now};
  saveLocal(s);
  if(fbOn&&db){
    queueSync(`users/${u}/lastUpdated`,now);
    queueSync(`users/${u}/lastSeen`,now);
    if(u===cur)requestPublicSharePublication('owned_list_edit',s,u);
  }
  syncFromLocal();
  refreshAddPokemonChoices(type,u);
  return true;
}
async function writeListItem(type,u,name,value){
  if(!requireOwnedListHydration(type,u))return false;
  const s=getLocal();
  if(!s[type])s[type]={};
  const list={...(s[type][u]||{})};
  if(value==null)delete list[name];
  else list[name]=value;
  return writeList(type,u,list,{previousList:s[type][u]||{}});
}
function refreshAddPokemonChoices(type,u){
  if(type!==myListType||u!==cur)return;
  buildAcItems();
  renderAddTray();
  const input=document.getElementById('ac-input');
  const dd=document.getElementById('ac-dropdown');
  if(input?.value&&dd?.classList.contains('open'))acSearch(input.value);
}
// Bump last-seen timestamp for activity tracking (throttled to once per 5 minutes
// to avoid spamming Firebase on every action). Called on app open + tab focus.
let _lastSeenBumpAt=0;
async function bumpLastSeen(){
  if(!cur)return;
  // Refresh the local session token every time (cheap; just touches localStorage)
  refreshSession();
  const now=Date.now();
  if(now-_lastSeenBumpAt<5*60*1000)return; // throttle Firebase write to max once per 5min
  _lastSeenBumpAt=now;
  const s=getLocal();
  if(!s.users[cur])return;
  s.users[cur]={...s.users[cur],lastSeen:now};
  saveLocal(s);
  if(fbOn&&db)queueSync(`users/${cur}/lastSeen`,now);
}
function syncFromLocal(){allData=runtimeDataWithSelectedTrainer(getLocal());refreshAll();}
function showSkeletonsIfEmpty(){
  // Show loading skeletons on first paint if no data yet
  if(!allData||!Object.keys(allData.users||{}).length){
    const ml=document.getElementById('mylist-out');
    if(ml&&!ml.children.length)ml.innerHTML=pokeballLoader('Loading your list…');
    const bo=document.getElementById('browse-out');
    if(bo&&!bo.children.length)bo.innerHTML=pokeballLoader('Loading community…');
  }
}

// ── FIREBASE AUTH / DATABASE ──────────────────────────────────
function authEmail(username,version=1){
  const base=username.toLowerCase().replace(/[^a-z0-9]/g,'_');
  const v=parseInt(version)||1;
  return`${base}${v>1?`_v${v}`:''}@pogotrades.nyc`;
}
function authVersionFromEmail(email){
  const m=String(email||'').match(/_v(\d+)@pogotrades\.nyc$/i);
  return m?parseInt(m[1]):1;
}
function authVersionForUser(ud={}){
  const v=parseInt(ud?.authVersion);
  return Number.isFinite(v)&&v>0?v:authVersionFromEmail(ud?.authEmail);
}
function authEmailForUser(username,ud={}){
  return ud?.authEmail||authEmail(username,authVersionForUser(ud));
}
function normalizedLoginDirectoryRecord(username,ud={},prev={}){
  return{
    authVersion:authVersionForUser(ud),
    authReady:!!(prev?.authReady||ud?.authUid),
    approvedAt:prev?.approvedAt||ud?.joined||Date.now()
  };
}
function knownLoginUsernames(){
  return loginDirectoryDomain.usernames(allData.loginDirectory||{});
}
function canonicalUsernameInput(raw=''){
  const trimmed=String(raw||'').trim();
  if(!trimmed)return'';
  const names=knownLoginUsernames();
  const exact=names.find(n=>n===trimmed);
  if(exact)return exact;
  const lower=trimmed.toLowerCase();
  const matches=names.filter(n=>n.toLowerCase()===lower);
  return matches[0]||trimmed;
}
function normalizedUserRecord(username,prev={},data={}){
  const merged={friendCode:'',joined:Date.now(),lastSeen:null,lastUpdated:null,pinHashed:false,...prev,...data};
  merged.authVersion=authVersionForUser(merged);
  if(!merged.authEmail)merged.authEmail=authEmail(username,merged.authVersion);
  return merged;
}
function withTimeout(promise,ms,message,code='timeout'){
  let timer=null;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      const err=new Error(message);
      err.code=code;
      reject(err);
    },ms);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}
function firebaseAuthConfigured(){return!!FIREBASE_API_KEY&&FIREBASE_API_KEY.startsWith('AIza');}
function firebaseConfig(url=FIREBASE_URL){
  const cfg={databaseURL:url,projectId:FIREBASE_PROJECT_ID};
  if(firebaseAuthConfigured()){
    cfg.apiKey=FIREBASE_API_KEY;
    cfg.authDomain=FIREBASE_AUTH_DOMAIN;
    cfg.storageBucket=FIREBASE_STORAGE_BUCKET;
    cfg.messagingSenderId=FIREBASE_MESSAGING_SENDER_ID;
    cfg.appId=FIREBASE_APP_ID;
    cfg.measurementId=FIREBASE_MEASUREMENT_ID;
  }
  return cfg;
}
function setupFirebase(url=FIREBASE_URL){
  if(fbApp)return fbApp;
  if(!firebaseSdkReady())throw new Error('Firebase SDK is still loading');
  const early=window.__pogoEarlyAuth;
  fbApp=early?.app||initializeApp(firebaseConfig(url),'pogo');
  firebaseDatabaseHandle=getDatabase(fbApp,url);
  if(firebaseAuthConfigured()){
    auth=early?.auth||getAuth(fbApp);
    bindAuthObserver();
  }
  return fbApp;
}
async function ensureFirebaseIdentity(username,pin,ud){
  if(!auth)return null;
  // ── Stranded-Auth-user auto-recovery ──────────────────────────
  // A previous login could have created a Firebase Auth user for some
  // version of this trainer's email (e.g. "skydragon_v2@…") but failed to
  // bind it back to the DB (timeout, rule rejection right after create, app
  // killed mid-flow, etc.). When that happens, every subsequent login of
  // that version sees `signIn` fail (the stranded user has an unknown
  // password) and `createUser` fail with `auth/email-already-in-use`,
  // permanently locking the trainer out until an admin nukes the orphan in
  // Firebase Console.
  //
  // To recover transparently, we treat `email-already-in-use` as a signal
  // that this version's slot is stranded — bump `authVersion` to the next
  // unused slot and retry. Bounded to 5 attempts so a deeply-broken account
  // surfaces an error instead of looping forever.
  const baseVersion=authVersionForUser(ud);
  let currentVersion=baseVersion;
  let cred=null;
  let createdAuthUser=false;
  let lastErr=null;
  for(let attempt=0;attempt<5;attempt++){
    const email=authEmail(username,currentVersion);
    createdAuthUser=false;
    try{
      cred=await withTimeout(signInWithEmailAndPassword(auth,email,pin),10000,'Firebase Auth sign-in timed out','auth/timeout');
      break; // sign-in succeeded
    }catch(e){
      lastErr=e;
      // Only attempt a create when (a) the DB has no bound authUid yet (fresh
      // login or post-reset) OR (b) we're already on a bumped retry (the
      // original version's slot was stranded — earlier iterations of this
      // loop have committed us to the recovery path).
      const canCreate=(!ud.authUid||attempt>0)&&(e.code==='auth/user-not-found'||e.code==='auth/invalid-credential');
      if(!canCreate)throw e;
      try{
        cred=await withTimeout(createUserWithEmailAndPassword(auth,email,pin),10000,'Firebase Auth account creation timed out','auth/timeout');
        createdAuthUser=true;
        break; // create succeeded → we own this version
      }catch(createErr){
        lastErr=createErr;
        if(createErr.code==='auth/email-already-in-use'){
          // Stranded Auth user at this version — try the next one
          currentVersion++;
          continue;
        }
        throw createErr;
      }
    }
  }
  if(!cred){
    const outOfSync=new Error('This trainer PIN is out of sync with Firebase Auth after multiple version bumps. Ask an admin to reset the PIN, or clean up the orphan auth users in Firebase Console.');
    outOfSync.code='auth/pin-out-of-sync';
    if(lastErr)console.warn('Auth recovery exhausted',lastErr);
    throw outOfSync;
  }
  currentAuthUid=cred.user.uid;
  // If the DB had a different authUid bound AND we're still on the original
  // version (i.e. no recovery bump happened), that's a real out-of-sync —
  // someone else's Auth account is bound to this trainer's record.
  if(ud.authUid&&ud.authUid!==currentAuthUid&&currentVersion===baseVersion){
    const outOfSync=new Error('Realtime Database points this trainer at a different Firebase Auth user.');
    outOfSync.code='auth/pin-out-of-sync';
    throw outOfSync;
  }
  const finalEmail=authEmail(username,currentVersion);
  const authUpdate={authEmail:finalEmail,authUid:currentAuthUid};
  // If we bumped the version during recovery, persist the new one so future
  // logins go straight to the working slot.
  if(currentVersion!==baseVersion){
    authUpdate.authVersion=currentVersion;
    console.info(`Auth recovery: bumped ${username} from v${baseVersion} to v${currentVersion}`);
  }
  try{
    if(ud.authEmail!==finalEmail||ud.authUid!==currentAuthUid||currentVersion!==baseVersion){
      await bindAuthUserNow(username,authUpdate);
    }
  }catch(bindErr){
    if(createdAuthUser&&auth.currentUser?.uid===currentAuthUid){
      await withTimeout(deleteUser(auth.currentUser),5000,'Cleanup timed out','auth/cleanup-timeout').catch(()=>{});
    }
    bindErr.code=bindErr.code||'auth/bind-failed';
    throw bindErr;
  }
  return{uid:currentAuthUid,email:finalEmail};
}

async function connectFirebase(){
  const url=document.getElementById('fb-url').value.trim();
  const err=document.getElementById('cfg-err');
  if(!url||!url.includes('firebaseio.com')){err.textContent=i18nCore.t('setup.invalidUrl');return;}
  try{
    setSyncStatus('syncing');
    await loadFirebaseSdk();
    setupFirebase(url);
    await ensureFirebaseDataProtection();
    await set(ref(db,'_ping'),Date.now()).catch(()=>{});
    lsSet('fbUrl',url);err.textContent='';
    startListener();
    toast(i18nCore.t('setup.connected'));
    showLogin();
  }catch(e){console.warn('Firebase setup failed',e);err.textContent=i18nCore.t('setup.failed');setSyncStatus('offline');}
}

function applyDataPath(root,path,data){
  const parts=String(path||'').split('/').filter(Boolean);
  if(!parts.length)return;
  let node=root;
  for(let i=0;i<parts.length-1;i++){
    const p=parts[i];
    if(!node[p]||typeof node[p]!=='object')node[p]={};
    node=node[p];
  }
  const last=parts[parts.length-1];
  if(data==null)delete node[last];
  else node[last]=data;
}
function applyQueuedData(root,item){
  if(item?.kind===sessionCacheBoundaryData.MY_LIST_UPDATE_KIND){
    Object.entries(item.data||{}).forEach(([name,value])=>applyDataPath(root,`${item.path}/${name}`,value));
    return;
  }
  applyDataPath(root,item?.path,item?.data);
}
function mergeRemoteData(d){
  const merged=normalizeData({
    users:d?.users||{},
    loginDirectory:d?.loginDirectory||{},
    wishlist:d?.wishlist||{},
    dynamax:d?.dynamax||{},
    gmax:d?.gmax||{},
    costumes:d?.costumes||{},
    have:d?.have||{},
    offers:d?.offers||{},
    trades:d?.trades||{},
    requests:d?.requests||{},
    authIndex:d?.authIndex||{},
    communities:d?.communities||{},
    userCommunities:d?.userCommunities||{},
    communityRequests:d?.communityRequests||{}
  });
  // Conflict detection (#13) — only flag when sync queue is EMPTY (no pending writes)
  // but local & remote differ. Pending writes during sync are not conflicts.
  if(cur&&!Object.keys(syncQueue||{}).length&&allData&&Object.keys(allData).length){
    ['wishlist','dynamax','gmax','costumes'].forEach(type=>{
      const localList=allData[type]?.[cur];
      const remoteList=merged[type]?.[cur];
      if(!localList||!remoteList)return;
      const conflicts=checkConflict(type,cur,localList,remoteList);
      // Only show if 1-10 conflicts — large diffs likely indicate fresh remote data
      if(conflicts.length>0&&conflicts.length<=10){
        showConflictModal(conflicts,
          async()=>{
            await writeList(type,cur,localList,{previousList:remoteList});
          },
          ()=>{}
        );
      }
    });
  }
  Object.values(syncQueue||{}).forEach(item=>applyQueuedData(merged,item));
  return normalizeData(merged);
}
// ── LAZY-LOAD LISTENERS ───────────────────────────────────────
// Instead of downloading the entire DB on connect, subscribe to each
// path independently. Only subscribe to a list type when needed.
let _firstSyncDone=false;
let _pathLoadState={};       // path → 'loading'|'loaded'

function _onSubSnapshot(path,snap,meta={}){
  const _t0=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  const val=snap.exists()?snap.val():null;
  // Update local cache for this path
  const s=getLocal();
  const seg=path.split('/')[0];
  if(seg==='users')s.users=val||{};
  else if(seg==='loginDirectory'){
    const applied=managedLoginDirectory.succeed(meta.directoryToken,val||{});
    if(!applied.ok)return;
    s.loginDirectory=managedLoginDirectory.snapshot().directory;
  }
  else if(seg==='authIndex')s.authIndex=val||{};
  else if(seg==='requests')s.requests=val||{};
  else if(seg==='wishlist')s.wishlist=val||{};
  else if(seg==='dynamax')s.dynamax=val||{};
  else if(seg==='gmax')s.gmax=val||{};
  else if(seg==='costumes')s.costumes=val||{};
  else if(seg==='have')s.have=val||{};
  else if(seg==='offers')s.offers=val||{};
  else if(seg==='trades')s.trades=val||{};
  else if(seg==='communities')s.communities=val||{};
  else if(seg==='userCommunities')s.userCommunities=val||{};
  else if(seg==='communityRequests')s.communityRequests=val||{};
  else if(seg==='pendingDecrements'){
    // Path is "pendingDecrements/{username}" — store under that username
    if(!s.pendingDecrements)s.pendingDecrements={};
    const u=path.split('/')[1];
    if(u){
      if(val)s.pendingDecrements[u]=val;
      else delete s.pendingDecrements[u];
    }
  }
  saveLocal(s);
  allData=runtimeDataWithSelectedTrainer(s);
  // Apply pending writes from sync queue
  Object.values(syncQueue||{}).forEach(item=>applyQueuedData(allData,item));
  if(Object.keys(syncQueue||{}).length)saveLocal(allData);
  _pathLoadState[path]='loaded';
  setSyncStatus('online');
  showSyncDot(!!Object.keys(syncQueue).length);
  // Reconcile any pending inventory decrements queued for us by counterparties
  if(seg==='pendingDecrements'&&cur&&path===`pendingDecrements/${cur}`){
    setTimeout(()=>_applyPendingDecrements(),50);
  }
  if(cur)queueRefreshAll(`snapshot:${seg}`);else populateLoginUsers(loginUserSuggestionsShouldOpen());
  // If share view is active, re-render with new data
  if(document.getElementById('share-view')?.classList.contains('active')&&_activeShareView){
    renderShareView(_activeShareView.username,_activeShareView.type);
  }
  _firstSyncDone=true;
  // Record snapshot cost + payload size for the perf panel. Bucket by top-level
  // segment so e.g. 30 pendingDecrements/${cur} samples don't dilute the data.
  // Skip the FIRST snapshot per path — initial full-tree delivery is always
  // slower than steady-state per-change snapshots and would bias the average
  // toward "scary" numbers that don't reflect ongoing cost. The first
  // snapshot's payload size IS interesting though, so record it as a static
  // lastSize without polluting the timing samples.
  try{
    const _dt=((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())-_t0;
    const _sz=val?JSON.stringify(val).length:0;
    const opKey=`snapshot:${seg}`;
    if(_snapshotFirstSeen.has(seg)){
      perfRecord(opKey,_dt,_sz);
    }else{
      _snapshotFirstSeen.add(seg);
      // Record payload size only — keep timing samples empty until we have
      // a steady-state measurement to show.
      const buf=_perfBuf[opKey]||(_perfBuf[opKey]={samples:[]});
      buf.lastSize=_sz;
      buf.initialLoadMs=_dt; // available via perfStats if anyone wants it
    }
  }catch{}
}
const _snapshotFirstSeen=new Set();
let _activeShareView=null;
let _shareReturnScroll=null;
let _pendingShareRequest=null;
let _publicShareRequestGeneration=0;
function startManagedSnapshotListener(path,{next,error}){
  if(!firebaseDataProtectionReady){
    const blocked=new Error('Firebase listener blocked until App Check is ready');
    blocked.code='listener/app-check-not-ready';
    throw blocked;
  }
  if(!managedFirebaseClient){
    const unavailable=new Error('Firebase listener client is not ready');
    unavailable.code='listener/client-unavailable';
    throw unavailable;
  }
  const result=managedFirebaseClient.listen(path,{
    onData:(_value,snapshot)=>next(snapshot),
    onError:error
  });
  if(!result.ok){
    const failed=new Error(result.error.message);
    failed.code=result.error.code;
    throw failed;
  }
  return result.unsubscribe;
}
function subscribePath(path){
  if(!db)return false;
  let directoryToken=null;
  const options={
    path,
    start:handlers=>{
      _pathLoadState[path]='loading';
      if(path==='loginDirectory'){
        directoryToken=managedLoginDirectory.begin();
        populateLoginUsers(loginUserSuggestionsShouldOpen());
      }
      return startManagedSnapshotListener(path,handlers);
    },
    onValue:snap=>_onSubSnapshot(path,snap,{directoryToken}),
    onError:error=>{
      if(path==='loginDirectory'){
        managedLoginDirectory.fail(directoryToken,error);
        populateLoginUsers(loginUserSuggestionsShouldOpen());
      }
      setSyncStatus('offline');
    }
  };
  const result=path==='loginDirectory'
    ?managedListenerLifecycle.subscribePublic({...options,key:'public:loginDirectory'})
    :managedListenerLifecycle.subscribeSession({...options,key:`session:${path}`});
  if(!result.ok){
    if(path==='loginDirectory'){
      managedLoginDirectory.fail(directoryToken,result.error);
      populateLoginUsers(loginUserSuggestionsShouldOpen());
    }
    setSyncStatus('offline');
  }
  return result.ok;
}
function retryLoginDirectory(){
  managedSubscriptions.unsubscribeByKey('public:loginDirectory');
  subscribePath('loginDirectory');
}
function protectedOwnerSession(){
  const user=allData.users?.[cur];
  return !!(auth?.currentUser&&cur===OWNER&&user?.authUid===auth.currentUser.uid&&(user.isOwner||user.isAdmin));
}
function subscribeLegacyAdminPath(path){
  if(!db||!protectedOwnerSession())return false;
  const result=managedListenerLifecycle.subscribeLegacyAdmin({
    path,key:`legacyAdmin:${path}`,
    start:handlers=>startManagedSnapshotListener(path,handlers),
    onValue:snap=>_onSubSnapshot(path,snap),
    onError:()=>setSyncStatus('offline')
  });
  if(!result.ok)setSyncStatus('offline');
  return result.ok;
}
const LEGACY_ADMIN_COLLECTION_PATHS=Object.freeze([
  'users','authIndex','requests','communities','userCommunities','communityRequests',
  'wishlist','dynamax','gmax','costumes','have','offers','trades'
]);
function startLegacyAdminReads(){
  if(!protectedOwnerSession())return false;
  LEGACY_ADMIN_COLLECTION_PATHS.forEach(subscribeLegacyAdminPath);
  return true;
}
function stopLegacyAdminReads(reason='admin_closed'){
  return managedListenerLifecycle.clearLegacyAdmin(reason);
}
function ownedExactReadsEnabled(){
  return NARROW_READ_CLIENT_ENABLED&&!LEGACY_BROAD_READS_ENABLED;
}
let _ownedReadErrorShown=false;
function _onOwnedDataSnapshot({surface,path,value}){
  const started=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  const canonicalActive=accountSyncProjectionReady();
  let s=getLocal();
  const canonicalBoard=canonicalActive?accountSyncClone(s.users?.[cur]?.specialTradeBoard||{lf:[],ft:[]}):null;
  if(!(canonicalActive&&OWNED_MY_LIST_TYPES.includes(surface)))s=cacheAdapterDomain.applyExactRecord(s,path,value);
  s=normalizeData(s);
  if(canonicalActive&&surface==='profile'){
    s.users[cur]={...(s.users[cur]||{}),specialTradeBoard:canonicalBoard};
  }
  saveLocal(s);
  allData=runtimeDataWithSelectedTrainer(s);
  Object.values(syncQueue||{}).forEach(item=>{
    if(canonicalActive&&(
      (item?.kind===sessionCacheBoundaryData.MY_LIST_UPDATE_KIND&&OWNED_MY_LIST_TYPES.some(type=>item.path===`${type}/${cur}`))||
      item?.path===`users/${cur}/specialTradeBoard`
    ))return;
    applyQueuedData(allData,item);
  });
  if(Object.keys(syncQueue||{}).length)saveLocal(allData);
  if(canonicalActive)applyAccountSyncCanonicalEntities(accountSyncCanonicalEntities);
  if((surface==='profile'||PUBLIC_SHARE_TYPES.includes(surface))&&activePublicShareHydrationToken){
    const marked=managedPublicSharePublication.markLoaded(activePublicShareHydrationToken,surface);
    if(marked.ok&&marked.ready){
      const pendingPublication=flushPendingPublicSharePublication();
      if(pendingPublication?.status!=='queued')inspectOwnPublicShareAfterHydration(activePublicShareHydrationToken);
    }
  }
  _pathLoadState[path]='loaded';
  _ownedReadErrorShown=false;
  setSyncStatus('online');
  showSyncDot(!!Object.keys(syncQueue).length);
  if(surface==='pendingDecrements'&&cur)setTimeout(()=>_applyPendingDecrements(),50);
  if(cur)queueRefreshAll(`snapshot:${surface}`);
  _firstSyncDone=true;
  try{
    const finished=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    const size=value==null?0:JSON.stringify(value).length;
    perfRecord(`snapshot:exact:${surface}`,finished-started,size);
  }catch{}
}
function _onOwnedDataError(detail={}){
  if((detail.surface==='profile'||PUBLIC_SHARE_TYPES.includes(detail.surface))&&activePublicShareHydrationToken){
    managedPublicSharePublication.markFailed(activePublicShareHydrationToken,detail.surface);
  }
  setSyncStatus('offline');
  if(_ownedReadErrorShown)return;
  _ownedReadErrorShown=true;
  toast(i18nCore.t('data.ownedReadUnavailable'),5000);
}
function ensureOwnedExactSubscriptions(){
  if(!managedOwnedDataCoordinator||!auth?.currentUser||!cur)return false;
  const activated=managedOwnedDataCoordinator.activate({uid:auth.currentUser.uid,username:cur});
  if(!activated.ok){_onOwnedDataError();return false;}
  const subscribed=managedOwnedDataCoordinator.subscribeCore();
  if(!subscribed.ok){_onOwnedDataError();return false;}
  for(const type of PUBLIC_SHARE_TYPES){
    const listResult=managedOwnedDataCoordinator.subscribeList(type);
    if(!listResult.ok){_onOwnedDataError({surface:type,error:listResult.error});return false;}
  }
  return true;
}
function ensureListSubscribed(type){
  if(!db)return;
  if(!['wishlist','dynamax','gmax','costumes'].includes(type))return;
  if(ownedExactReadsEnabled()){
    const result=managedOwnedDataCoordinator?.subscribeList(type);
    if(!result?.ok)_onOwnedDataError();
    return;
  }
  if(LEGACY_BROAD_READS_ENABLED)subscribePath(type);
}
function ensureProtectedSubscriptions(){
  if(!firebaseDataProtectionReady||!db||!auth?.currentUser)return;
  const active=managedListenerLifecycle.activateSession({uid:auth.currentUser.uid,username:cur});
  if(!active.ok)return;
  if(ownedExactReadsEnabled()){
    ensureOwnedExactSubscriptions();
    // Retained broad collections are owner-only and start on demand in Admin.
    return;
  }
  if(!LEGACY_BROAD_READS_ENABLED)return;
  subscribePath('users');
  subscribePath('authIndex');
  subscribePath('requests');
  const needsCommunityPreviewData=MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE&&ownerCanUseCommunityTools();
  if(MULTI_COMMUNITY_ENABLED||needsCommunityPreviewData){
    subscribePath('communities');
    subscribePath('userCommunities');
    subscribePath('communityRequests');
  }
  subscribePath('wishlist');
  subscribePath('have');
  subscribePath('offers');
  subscribePath('trades');
  if(cur)subscribeMyPendingDecrements();
}
function startListener(){
  if(!firebaseDataProtectionReady||!db)return false;
  // Before login, only the public directory should load. Protected community
  // data subscribes after Firebase Auth is present.
  subscribePath('loginDirectory');
  ensureProtectedSubscriptions();
  ensureAccountSyncRuntime().catch(error=>console.warn('Account sync startup failed',String(error?.code||'unknown')));
  // Other list types loaded lazily when tabs are visited
  return true;
}
function selectedTrainerData(username){
  const clean=String(username||'').trim();
  if(!clean)return null;
  if(selectedTrainerRuntime.username!==clean){
    selectedTrainerRuntime={username:clean,publicData:null};
  }
  if(!selectedTrainerRuntime.publicData)selectedTrainerRuntime.publicData=normalizeData({});
  return selectedTrainerRuntime.publicData;
}
function clearSelectedTrainerData(){
  selectedTrainerRuntime={username:'',publicData:null};
}
function runtimeDataWithSelectedTrainer(source){
  const base=normalizeData(source||{});
  const username=selectedTrainerRuntime.username;
  if(!username)return base;
  [selectedTrainerRuntime.publicData].filter(Boolean).forEach(overlay=>{
    if(overlay.users?.[username])base.users[username]=overlay.users[username];
    PUBLIC_SHARE_TYPES.forEach(type=>{
      if(overlay[type]?.[username])base[type][username]=overlay[type][username];
    });
  });
  return base;
}
async function loadPublicShareData(username,{requestGeneration=null}={}){
  if(!db||!username)return{ok:false,status:'transport_error'};
  try{
    const snap=await get(ref(db,`publicShares/${username}`));
    if(requestGeneration!==null&&requestGeneration!==_publicShareRequestGeneration)return{ok:false,status:'stale'};
    if(!snap.exists())return{ok:false,status:'not_published'};
    const projection=publicSharePublicationDomain.publicShareProjectionStatus(snap.val(),{username});
    if(!projection.ok)return projection;
    const s=selectedTrainerData(username);
    if(!applyPublicShareSnapshot(s,projection.snapshot))return{ok:false,status:'projection_unsupported'};
    allData=runtimeDataWithSelectedTrainer(getLocal());
    setSyncStatus('online');
    return projection;
  }catch(e){
    console.warn('Could not load public share data',e);
    return{ok:false,status:'transport_error'};
  }
}
async function loadShareViewData(username){
  return loadPublicShareData(username);
}
function renderUnavailableShareView(username,message){
  _activeShareView={username,type:'wishlist'};
  hidePreAuth();
  document.getElementById('app').style.display='none';
  document.getElementById('login-pg').style.display='none';
  document.getElementById('config-pg').style.display='none';
  document.getElementById('share-view').classList.add('active');
  const hdr=document.getElementById('share-hdr');
  if(hdr)hdr.innerHTML=`<div class="share-hdr-info"><div class="share-hdr-name">${escHtml(i18nCore.t('share.listTitle',{username}))}</div><div class="share-hdr-meta"><span class="meta-item">${escHtml(i18nCore.t('share.publicLink'))}</span></div></div>`;
  const tabs=document.getElementById('share-list-tabs');
  if(tabs)tabs.innerHTML='';
  const out=document.getElementById('share-list-out');
  if(out)out.innerHTML=emptyHtml(message,i18nCore.t('trainer.publicHint'),'🔗');
}
function publicShareStatusMessageKey(status){
  if(status==='not_published')return'trainer.notPublished';
  if(status==='projection_incomplete')return'trainer.shareNeedsRepublishing';
  if(status==='projection_unsupported')return'trainer.sharedMalformed';
  if(status==='transport_error')return'trainer.sharedReadFailed';
  return'trainer.sharedUnavailable';
}
function clearShareViewSubscriptions(){
  managedListenerLifecycle.clearSelectedTrainer('share_closed');
  clearSelectedTrainerData();
  allData=getLocal();
}
function onPublicShareSnapshot(username,snap){
  const projection=publicSharePublicationDomain.publicShareProjectionStatus(snap.exists()?snap.val():null,{username});
  if(!projection.ok){
    selectedTrainerRuntime={username,publicData:null};
    allData=runtimeDataWithSelectedTrainer(getLocal());
    if(document.getElementById('share-view')?.classList.contains('active')&&_activeShareView?.username===username){
      renderUnavailableShareView(username,i18nCore.t(publicShareStatusMessageKey(projection.status)));
    }
    return;
  }
  const s=selectedTrainerData(username);
  if(!applyPublicShareSnapshot(s,projection.snapshot))return;
  allData=runtimeDataWithSelectedTrainer(getLocal());
  setSyncStatus('online');
  if(document.getElementById('share-view')?.classList.contains('active')&&_activeShareView?.username===username){
    renderShareView(_activeShareView.username,_activeShareView.type);
  }
}
function ensureShareViewSubscriptions(username){
  if(!db||!username)return false;
  selectedTrainerData(username);
  const publicPath=`publicShares/${username}`;
  const publicResult=managedListenerLifecycle.subscribeSelectedTrainer({
    username,path:publicPath,key:`share:${username}:public`,
    start:handlers=>startManagedSnapshotListener(publicPath,handlers),
    onValue:snap=>onPublicShareSnapshot(username,snap),
    onError:e=>{
      console.warn('Public share subscription failed',e);
      setSyncStatus('offline');
      if(document.getElementById('share-view')?.classList.contains('active')&&_activeShareView?.username===username){
        renderUnavailableShareView(username,i18nCore.t('trainer.sharedReadFailed'));
      }
    }
  });
  managedListenerLifecycle.clearAuthenticatedShareListeners();
  return publicResult.ok;
}
async function openShareViewFromRequest(shareReq){
  if(!shareReq)return;
  enterShareLoadingShell(shareReq.username,shareReq.type);
  const requestGeneration=++_publicShareRequestGeneration;
  const publicLoaded=await loadPublicShareData(shareReq.username,{requestGeneration});
  if(requestGeneration!==_publicShareRequestGeneration||publicLoaded.status==='stale')return;
  if(publicLoaded.ok&&allData.users?.[shareReq.username]){
    if(cur)rememberTrainerOpened(shareReq.username);
    enterShareView(shareReq.username,shareReq.type);
    return;
  }
  renderUnavailableShareView(shareReq.username,i18nCore.t(publicShareStatusMessageKey(publicLoaded.status)));
}
// Per-user queue of "someone accepted a trade where you'd give away N of X".
// Only the target user can read/write their own bucket (see security rules),
// so we can only subscribe AFTER login when `cur` is set.
function subscribeMyPendingDecrements(){
  if(!db||!cur)return;
  if(ownedExactReadsEnabled()){
    const result=managedOwnedDataCoordinator?.subscribeSurface('pendingDecrements');
    if(!result?.ok)_onOwnedDataError();
    return;
  }
  if(!LEGACY_BROAD_READS_ENABLED)return;
  subscribePath(`pendingDecrements/${cur}`);
}

function skipFirebase(){lsSet('fbUrl','local');syncFromLocal();showLogin();}

function healthRow(label,status,detail='',kind='info'){
  return{label,status,detail,kind};
}
function renderHealthRows(rows){
  const grid=document.getElementById('login-health-grid');
  if(!grid)return;
  grid.innerHTML=rows.map(r=>{
    // 22-char threshold balances readability of short pill labels
    // ("Connected", "40 trainers", "89 KB") against the long perf-data
    // strings that need to stack to a separate line. Picked empirically.
    const longStatus=(r.status||'').length>22;
    return`<div class="health-row${longStatus?' long-status':''}">
      <div class="health-label">${escHtml(r.label)}</div>
      <div class="health-status ${escAttr(r.kind)}">${escHtml(r.status)}</div>
      ${r.detail?`<div class="health-detail">${escHtml(r.detail)}</div>`:''}
    </div>`;
  }).join('');
}
let _lastLoginHealthReport='';
function setLoginHealthCopyStatus(msg='',kind='info'){
  const el=document.getElementById('login-health-copy-status');
  if(!el)return;
  el.textContent=msg;
  el.style.color=kind==='ok'?'var(--ok)':kind==='bad'?'var(--danger)':'var(--muted)';
}
function safeVisibleLoginError(){
  const msg=(document.getElementById('login-err')?.textContent||'').replace(/\s+/g,' ').trim();
  if(!msg||msg.includes('@'))return'';
  return msg.slice(0,180);
}
function loginLocalCacheSummary(){
  try{
    const offlineBytes=localStorage.getItem(sessionCacheBoundaryData.DEFAULT_CACHE_KEY)?.length||0;
    let spriteEntries=0;
    try{ spriteEntries=Object.keys(JSON.parse(localStorage.getItem(SPRITE_SCALE_CACHE_KEY)||'{}')).length; }catch(_e){ spriteEntries=0; }
    return`Offline cache ${Math.round(offlineBytes/1024)} KB; sprite scale cache ${spriteEntries} entries`;
  }catch(_e){ return'Unavailable'; }
}
function safeReportValue(v){
  const s=String(v??'').replace(/\s+/g,' ').trim();
  return s||'Unknown';
}
function buildLoginHealthReport(info){
  // Allowlist-only support report: never serialize app state, Firebase snapshots, localStorage, or user records.
  const lines=[
    'PoGo Trades troubleshooting report',
    `Generated: ${safeReportValue(info.generatedAt)}`,
    `App version: ${safeReportValue(info.appVersion)}`,
    `Page: ${safeReportValue(info.pageOrigin)}${safeReportValue(info.pagePath)}`,
    `Network: ${safeReportValue(info.networkStatus)}`,
    `Firebase config: ${safeReportValue(info.firebaseConfigured)}`,
    `Firebase connection: ${safeReportValue(info.firebaseConnected)}`,
    `Firebase read: ${safeReportValue(info.firebaseRead)}`,
    `Auth session: ${safeReportValue(info.authStatus)}`,
    `Service worker: ${safeReportValue(info.serviceWorker)}`,
    `Local cache: ${safeReportValue(info.localCache)}`,
    `Pending local edits: ${safeReportValue(info.pendingLocalEdits)}`
  ];
  if(info.selectedUser)lines.push(`Selected trainer: ${safeReportValue(info.selectedUser)}`);
  if(info.safeError)lines.push(`Visible error: ${safeReportValue(info.safeError)}`);
  return lines.join('\n');
}
async function copyLoginHealthReport(){
  try{
    if(!_lastLoginHealthReport)await runLoginHealthCheck();
    if(!_lastLoginHealthReport)throw new Error('Health report was not available');
    await copyText(_lastLoginHealthReport);
    setLoginHealthCopyStatus(i18nCore.t('health.reportCopiedHelp'),'ok');
    toast(i18nCore.t('health.reportCopied'));
  }catch(e){
    console.warn('Health report copy failed',e);
    setLoginHealthCopyStatus(i18nCore.t('health.reportCopyFailedHelp'),'bad');
    toast(i18nCore.t('health.reportCopyFailed'));
  }
}
async function ensureFirebaseForHealth(){
  await loadFirebaseSdk();
  if(!fbApp)setupFirebase(FIREBASE_URL);
  await ensureFirebaseDataProtection();
  return!!db;
}
async function serviceWorkerHealth(){
  const details=[];
  if(!('serviceWorker'in navigator))return{status:'Not supported',kind:'warn',detail:'This browser does not support service workers.'};
  let registration=null;
  try{registration=await navigator.serviceWorker.getRegistration();}catch(e){details.push(`registration check failed: ${e.message||e}`);}
  let version='unknown';
  try{
    const res=await fetch(`./sw.js?health=${Date.now()}`,{cache:'no-store'});
    const text=await res.text();
    const m=text.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
    if(m)version=m[1];
  }catch(e){details.push(`version fetch failed: ${e.message||e}`);}
  if(!registration)return{status:version==='unknown'?'Not registered':'Fresh app shell',kind:'warn',detail:`Service worker version: ${version}. A first reload may install it.`};
  return{status:'Registered',kind:'ok',detail:`Service worker version: ${version}${details.length?`; ${details.join('; ')}`:''}`};
}
async function openLoginHealthCheck(){
  openModal('login-health-modal');
  setLoginHealthCopyStatus('');
  await runLoginHealthCheck();
}
async function runLoginHealthCheck(){
  _lastLoginHealthReport='';
  setLoginHealthCopyStatus('');
  const typedUser=document.getElementById('login-user')?.value||'';
  const typedSelectedUser=canonicalUsernameInput(typedUser);
  const selectedUser=cur||typedSelectedUser;
  const sessionState=auth?.currentUser?'Signed in':'Not signed in';
  const reportInfo={
    generatedAt:new Date().toLocaleString(),
    appVersion:APP_VERSION,
    pageOrigin:location.origin||'file://',
    pagePath:location.protocol==='file:'?'local file':(location.pathname||'/'),
    networkStatus:navigator.onLine?'Online':'Offline',
    firebaseConfigured:FIREBASE_URL?'Configured':'Missing config',
    firebaseConnected:'Checking',
    firebaseRead:'Not checked',
    authStatus:sessionState,
    selectedUser:typedSelectedUser||'',
    serviceWorker:'Checking',
    localCache:loginLocalCacheSummary(),
    pendingLocalEdits:'Checking',
    safeError:safeVisibleLoginError()
  };
  const rows=[
    healthRow('App version',APP_VERSION,`Page: ${location.href}`,'info'),
    healthRow(cur?'Current trainer':'Selected user',selectedUser||'None selected',selectedUser?`Live read check will test users/${selectedUser}.`:'Choose a username on the login screen if you want to test one specific account.','info')
  ];
  renderHealthRows([...rows,healthRow('Firebase connected','Checking...','Loading Firebase SDK and database handle.','info'),healthRow('Firebase Auth session','Checking...',cur?'After sign-in, this should say Signed in. If it does not, edits may stay local to this device.':'On the login screen, Not signed in is normal before entering a PIN.','info'),healthRow('Login data read','Waiting...','Before login this checks the public username directory; after login it checks protected user data.','info'),healthRow('Service worker','Checking...','Checking cached app shell status.','info')]);
  let firebaseOk=false;
  try{
    firebaseOk=await withTimeout(ensureFirebaseForHealth(),8000,'Firebase setup timed out','firebase/health-timeout');
    rows.push(healthRow('Firebase connected',firebaseOk?'Connected':'Not connected',`Project: ${FIREBASE_PROJECT_ID}`,'ok'));
    reportInfo.firebaseConnected=firebaseOk?'Connected':'Not connected';
  }catch(e){
    rows.push(healthRow('Firebase connected','Failed',e.code?`${e.code}: ${e.message}`:(e.message||String(e)),'bad'));
    reportInfo.firebaseConnected=e?.code?`Failed (${e.code})`:'Failed';
  }
  rows.push(healthRow('Firebase Auth session',sessionState,auth?.currentUser?`UID: ${auth.currentUser.uid}`:(cur?'This browser can show saved local app data, but live writes will not sync until the user signs in again.':'Normal before login.'),auth?.currentUser?'ok':(cur?'warn':'info')));
  const queuedPaths=Object.keys(syncQueue||{});
  rows.push(healthRow('Pending local edits',queuedPaths.length?`${queuedPaths.length} queued`:'None',queuedPaths.length?`Waiting to sync: ${queuedPaths.slice(0,4).join(', ')}${queuedPaths.length>4?'…':''}`:'No unsynced edits are waiting on this device.',queuedPaths.length?'warn':'ok'));
  reportInfo.pendingLocalEdits=queuedPaths.length?`${queuedPaths.length} queued`:'None';
  if(firebaseOk&&db){
    try{
      const signedIn=!!auth?.currentUser;
      const path=signedIn
        ?(selectedUser?`users/${selectedUser}`:'users')
        :(selectedUser?`loginDirectory/${selectedUser}`:'loginDirectory');
      const snap=await withTimeout(get(ref(db,path)),6000,'Live user read timed out','db/read-timeout');
      if(selectedUser){
        rows.push(healthRow('Login data read',snap.exists()?'OK':'Missing user',snap.exists()?`Read ${path} successfully.`:`Firebase responded, but ${selectedUser} is not under ${signedIn?'users':'loginDirectory'}/.`,snap.exists()?'ok':'warn'));
        reportInfo.firebaseRead=snap.exists()?'Selected user OK':'Selected user missing';
      }else{
        const count=snap.exists()?Object.keys(snap.val()||{}).length:0;
        rows.push(healthRow('Login data read',snap.exists()?'OK':'No users found',`Read ${path}/ successfully. ${count} trainer${count===1?'':'s'} visible to this browser.`,snap.exists()?'ok':'warn'));
        reportInfo.firebaseRead=snap.exists()?`Directory readable (${count} trainer${count===1?'':'s'})`:'No users found';
      }
    }catch(e){
      const msg=e.code==='PERMISSION_DENIED'
        ?'Firebase rules blocked this read. Before login, loginDirectory should be readable; after login, users/ should be readable.'
        :e.message||String(e);
      rows.push(healthRow('Login data read','Blocked',e.code?`${e.code}: ${msg}`:msg,'bad'));
      reportInfo.firebaseRead=e?.code?`Blocked (${e.code})`:'Blocked';
    }
  }else{
    rows.push(healthRow('Login data read','Skipped','Firebase did not connect on this browser.','warn'));
    reportInfo.firebaseRead='Skipped';
  }
  const sw=await serviceWorkerHealth();
  rows.push(healthRow('Service worker',sw.status,sw.detail,sw.kind));
  reportInfo.serviceWorker=sw.detail?`${sw.status} (${sw.detail})`:sw.status;
  // ── COMMUNITY & PERF PANEL ──────────────────────────────────
  // Community size row is fine for everyone (interesting context). The
  // technical perf rows (storage, render p95, snapshot timing, action
  // thresholds) are debugging info — only useful to owner/admins and
  // confusing/cluttery for regular trainers. Gate them.
  try{
    const trainers=Object.keys(allData.users||{}).length;
    const wishlistTrainers=Object.keys(allData.wishlist||{}).length;
    const haveTrainers=Object.keys(allData.have||{}).length;
    const offerCount=Object.values(allData.offers||{}).reduce((n,bucket)=>n+Object.keys(bucket||{}).length,0);
    const tradeCount=Object.keys(allData.trades||{}).length;
    const trainerKind=trainers>=150?'warn':trainers>=100?'info':'ok';
    rows.push(healthRow('Community size',`${trainers} trainer${trainers===1?'':'s'}`,`${wishlistTrainers} with wishlists · ${haveTrainers} with inventory · ${offerCount} open offers · ${tradeCount} trades.`,trainerKind));
    const showAdminPanel=!!(cur&&allData.users?.[cur]?.isAdmin);
    if(showAdminPanel){
      const scaleSize=Object.keys(spriteScaleCache||{}).length;
      let lsBytes=0;try{lsBytes=(localStorage.getItem('pogoSessionCache_v2')||'').length;}catch{}
      const lsKB=Math.round(lsBytes/1024);
      const lsKind=lsKB>=3072?'warn':lsKB>=1024?'info':'ok';
      rows.push(healthRow('Local storage size',`${lsKB} KB`,`Safari iOS quota is ~5 MB. At ~3 MB it\'s worth pruning archived offers/trades. Sprite-scale cache holds ${scaleSize} entries (max ${SPRITE_SCALE_CACHE_MAX} before LRU eviction).`,lsKind));
      reportInfo.localCache=`Local app cache ${lsKB} KB; sprite scale cache ${scaleSize} entries`;
      const stats=perfStats();
      // Use short, single-word labels to avoid the awkward " · " line-break
      // splitting that happens in narrow health-row columns.
      const opsToShow=[
        ['snapshot:users','Users sync'],
        ['snapshot:wishlist','Wishlist sync'],
        ['snapshot:have','Inventory sync'],
        ['snapshot:offers','Offers sync'],
        ['snapshot:trades','Trades sync'],
        ['render:browse','Browse render'],
        ['render:strings','Strings render']
      ];
      opsToShow.forEach(([op,label])=>{
        const s=stats[op];
        const buf=_perfBuf[op];
        // For snapshot:* ops we record lastSize/initialLoadMs even before the
        // first steady-state sample arrives, so a row can still be useful at
        // n=0 by showing the initial-load info.
        if(!s&&!buf?.lastSize)return;
        const sz=buf?.lastSize?` · payload ${Math.round(buf.lastSize/1024)} KB`:'';
        const initInfo=buf?.initialLoadMs?` · initial ${buf.initialLoadMs.toFixed(0)}ms`:'';
        let statusText,kind;
        if(s){
          statusText=`avg ${s.avg.toFixed(0)}ms · p95 ${s.p95.toFixed(0)}ms · n=${s.n}${sz}`;
          kind=s.p95>500?'warn':s.p95>200?'info':'ok';
        }else{
          statusText=`waiting for steady-state${initInfo}${sz}`;
          kind='info';
        }
        rows.push(healthRow(label,statusText,'Steady-state cost (initial-load sample is excluded — that\'s always slower). Trigger to start Phase 2 per-user subscriptions: p95 >200ms here, OR a render row p95 >500ms. See SCALING-NOTES.md.',kind));
      });
    }
  }catch(e){
    if(cur&&allData.users?.[cur]?.isAdmin)rows.push(healthRow('Admin panel','Error',String(e?.message||e),'warn'));
  }
  _lastLoginHealthReport=buildLoginHealthReport(reportInfo);
  renderHealthRows(rows);
}
async function clearLoginLocalCache(){
  const ok=confirm(i18nCore.t('health.clearCacheConfirm'));
  if(!ok)return;
  const appKeys=['pogo3','pogoSessionCache_v2','pogoSyncQueue_v1','pogoSyncQueue_v2','fbUrl','pgu','pguts','pogoAdvancedOpen','pogoExportStyle','pogoLastBackup','pogoWhatsNewSeen','pogoTheme','pogoBackupDismissed','pogoTourSeen','pogoSpriteScales_v2'];
  const clearStore=store=>{
    try{
      appKeys.forEach(k=>store.removeItem(k));
      Array.from({length:store.length},(_,i)=>store.key(i)).filter(k=>k&&(/^pogo/i.test(k)||/^pg/i.test(k))).forEach(k=>store.removeItem(k));
    }catch{}
  };
  clearStore(localStorage);
  clearStore(sessionStorage);
  if('caches'in window){
    try{
      const names=await caches.keys();
      await Promise.all(names.filter(n=>/^(shell|sprites)-pogo-trades/.test(n)).map(n=>caches.delete(n)));
    }catch{}
  }
  if('serviceWorker'in navigator){
    try{
      const regs=await navigator.serviceWorker.getRegistrations();
      const basePath=location.pathname.endsWith('/')?location.pathname:location.pathname.replace(/\/[^/]*$/,'/');
      await Promise.all(regs.filter(r=>{
        try{return new URL(r.scope).pathname.startsWith(basePath);}catch{return false;}
      }).map(r=>r.unregister()));
    }catch{}
  }
  location.replace(`${location.pathname}?fresh=${Date.now()}`);
}

// ── AUTH ──────────────────────────────────────────────────────
async function doLogin(){
  // Trim free-text input — datalist value may carry trailing whitespace from
  // mobile autocomplete suggestions, and we don't want "Doomsday126 " ≠ key.
  const u=canonicalUsernameInput(document.getElementById('login-user').value||'');
  const p=document.getElementById('login-pin').value;
  const err=document.getElementById('login-err');
  const btn=document.getElementById('login-btn');
  const directoryState=managedLoginDirectory.snapshot();
  const dirEntry=directoryState.status===loginDirectoryDomain.STATES.LOADED?directoryState.directory[u]||null:null;
  if(!u){err.textContent='Enter your username';return;}
  if(!p){err.textContent='Enter PIN';return;}
  if(!isSixDigitPin(p)){err.textContent='PIN must be exactly 6 digits';return;}
  if(directoryState.status===loginDirectoryDomain.STATES.LOADING||directoryState.status===loginDirectoryDomain.STATES.IDLE){err.textContent=i18nCore.t('login.directoryLoading');return;}
  if(directoryState.status===loginDirectoryDomain.STATES.ERROR){err.textContent=i18nCore.t('login.directoryError');return;}
  if(!dirEntry){err.textContent=i18nCore.t('login.directoryUnknown');return;}
  err.textContent='';
  document.getElementById('login-user').value=u;
  btn.textContent='Signing in…';btn.disabled=true;
  let ud=allData.users?.[u];
  let liveUserReadFailed=false;
  let ident=null;
  if(fbOn&&db&&auth&&loginDirectoryDomain.readyRecord(dirEntry)){
    try{
      const signedIn=await signInWithAuthVersionScan(u,p,dirEntry.authVersion||1);
      const {cred,email,version}=signedIn;
      currentAuthUid=cred.user.uid;
      ident={uid:cred.user.uid,email,version};
      const snap=await withTimeout(get(ref(db,`users/${u}`)),5000,'Firebase lookup timed out','db/read-timeout');
      if(snap.exists())ud={...ud,...snap.val(),authUid:cred.user.uid,authEmail:email,authVersion:version};
      else{
        err.textContent='This trainer has a login account, but no matching database record. Ask an admin to repair the account.';
        btn.textContent='Sign in →';btn.disabled=false;return;
      }
    }catch(e){
      if(['auth/invalid-credential','auth/wrong-password','auth/invalid-login-credentials','auth/user-not-found'].includes(e.code)){
        err.textContent='❌ Wrong PIN';
        btn.textContent='Sign in →';btn.disabled=false;return;
      }
      console.warn('Public-directory auth sign-in failed',e);
    }
  }
  // Legacy PIN fallback only works when a cached/local user exists. With secure
  // rules, users/ is intentionally not readable before Firebase Auth, so do not
  // probe it pre-login and turn a missing loginDirectory entry into a scary
  // permission-denied loop.
  if(!ident&&fbOn&&db&&ud){
    try{
      const snap=await withTimeout(get(ref(db,`users/${u}`)),5000,'Firebase lookup timed out','db/read-timeout');
      if(snap.exists())ud={...ud,...snap.val()};
    }catch(e){
      liveUserReadFailed=true;
      console.warn('Could not read live user record before login',e);
    }
  }
  const liveReadHint=liveUserReadFailed?' Live user data could not be checked before login, so this browser may be using stale cached info.':'';
  if(!ud){
    err.textContent=dirEntry&&!loginDirectoryDomain.readyRecord(dirEntry)
      ?'This trainer was approved, but their login setup is incomplete. Ask an admin to reset the PIN once to finish setup.'
      :liveUserReadFailed
        ?'Could not load this user from Firebase before login. Ask an admin to update the login directory / rules, then retry.'
        :'User not found';
    btn.textContent='Sign in →';btn.disabled=false;return;
  }
  const ok=ident?true:await verifyPin(p,ud.pin);
  if(ok){
    try{
      ident=ident||(auth?await ensureFirebaseIdentity(u,p,ud):null);
      if(ident&&db)await syncOwnAuthIndex(u,ident,ud);
      if(!ident?.uid){
        const identityError=new Error('A verified Firebase identity is required to unlock cached account data');
        identityError.code='storage/identity-required';
        throw identityError;
      }
      activateOwnedSession(ident.uid,u);
      if(cur&&cur!==u)resetMyListCategoryForAccountBoundary();
      cur=u;stampSession(u);
      const loginUpdate={...ud,lastSeen:Date.now()};
      if(ident){loginUpdate.authEmail=ident.email;loginUpdate.authUid=ident.uid;}
      if(ident?.version)loginUpdate.authVersion=ident.version;
      // Upgrade plaintext PIN to hashed
      if(!ud.pinHashed){const h=await hashPin(p);loginUpdate.pin=h;loginUpdate.pinHashed=true;}
      await writeUserNow(u,loginUpdate);
      if(document.getElementById('share-view')?.classList.contains('active'))return;
      if(_pendingShareRequest){openShareViewFromRequest(_pendingShareRequest);return;}
      showApp();
    }catch(e){
      const code=e.code||'';
      err.textContent=code==='auth/pin-out-of-sync'
        ?'Firebase Auth is out of sync for this trainer. Ask an admin to reset the Auth user.'
        :code==='auth/timeout'
          ?'Firebase Auth timed out. Check connection, refresh, and try again.'
        :code==='db/write-timeout'||code==='auth/bind-timeout'||code==='db/index-timeout'||code==='db/index-read-timeout'
          ?'Firebase Database timed out while saving login. Refresh and try again.'
        :code==='auth/index-mismatch'
          ?'This Firebase login is linked to a different trainer. Ask an admin to repair the account.'
        :code==='auth/index-session-mismatch'||code==='auth/index-binding-mismatch'
          ?'This trainer login has an identity-binding mismatch. Ask an admin to repair the account.'
        :code==='storage/owner-mismatch'||code==='storage/identity-required'
          ?i18nCore.t('storage.sessionOwnershipMismatch')
        :code==='PERMISSION_DENIED'||code==='database/permission-denied'||code==='auth/bind-failed'
          ?'Firebase rules blocked linking this trainer. Update the users rule, then try again.'
        :'Firebase Auth failed: '+(code||e.message||'check API key and auth settings');
      err.textContent+=liveReadHint;
      btn.textContent='Sign in →';btn.disabled=false;
    }
  } else {
    err.textContent=liveUserReadFailed?'❌ Wrong PIN, and Firebase live user data was blocked before login. Ask an admin to update Firebase rules, then retry.':'❌ Wrong PIN';
    btn.textContent='Sign in →';btn.disabled=false;
  }
}

function logout(){
  closeAccountMenu(false);
  if(parseSettingsRoute().matches)history.replaceState({},'',settingsRouteUrl(false));
  resetMyListCategoryForAccountBoundary();
  resetSessionTransientUi('logout');
  resetTrainerOrganizerState();
  resetFavoriteBrowseSession();
  trainerHistoryStore=null;
  managedListenerLifecycle.deactivateSession('logout');
  managedOwnedDataCoordinator?.reset();
  clearOwnedSession();
  cur=null;
  try{
    localStorage.removeItem('pgu');localStorage.removeItem('pguts');
    sessionStorage.removeItem('pgu');sessionStorage.removeItem('pguts'); // belt-and-suspenders cleanup
  }catch{}
  if(auth)firebaseSignOut(auth).catch(()=>{});
  document.querySelectorAll('.ov.open').forEach(el=>closeModal(el.id));
  document.getElementById('app').style.display='none';
  showLogin();
}

// ── NAV ───────────────────────────────────────────────────────
function hasVisibleScreen(){
  return['preauth-pg','config-pg','login-pg','app'].some(id=>{
    const el=document.getElementById(id);
    return el&&getComputedStyle(el).display!=='none';
  })||document.getElementById('share-view')?.classList.contains('active');
}
function hidePreAuth(){
  const preauth=document.getElementById('preauth-pg');
  if(preauth)preauth.style.display='none';
}
function completeLoginBootstrap(){
  const login=document.getElementById('login-pg');
  if(!login)return;
  login.removeAttribute('data-bootstrap-pending');
  login.setAttribute('aria-busy','false');
  login.querySelectorAll('[data-bootstrap-disabled="true"]').forEach(control=>{
    control.disabled=false;
    delete control.dataset.bootstrapDisabled;
  });
}
function showPreAuth(){
  const preauth=document.getElementById('preauth-pg');
  if(preauth){preauth.style.display='block';preauth.setAttribute('aria-busy','true');}
  document.getElementById('config-pg').style.display='none';
  const login=document.getElementById('login-pg');
  login.style.display='flex';
  login.dataset.bootstrapPending='true';
  login.setAttribute('aria-busy','true');
  login.querySelectorAll('button,input,select,textarea').forEach(control=>{
    if(!control.disabled){control.disabled=true;control.dataset.bootstrapDisabled='true';}
  });
  document.getElementById('app').style.display='none';
}
function showBootError(err){
  console.error('Startup error',err);
  hidePreAuth();
  document.getElementById('config-pg').style.display='none';
  document.getElementById('app').style.display='none';
  document.getElementById('share-view')?.classList.remove('active');
  const login=document.getElementById('login-pg');
  if(login)login.style.display='flex';
  completeLoginBootstrap();
  const card=login?.querySelector('.lcard');
  if(card)card.style.display='block';
  const req=document.getElementById('req-form-card');
  if(req)req.style.display='none';
  const errEl=document.getElementById('login-err');
  if(errEl)errEl.textContent=i18nCore.t('app.startupError');
  setSyncStatus('offline');
}
function showConfig(){
  hidePreAuth();
  document.getElementById('config-pg').style.display='flex';
  document.getElementById('login-pg').style.display='none';
  document.getElementById('app').style.display='none';
}
function showLogin({preserveCredentials=false}={}){
  hidePreAuth();
  document.getElementById('config-pg').style.display='none';
  document.getElementById('login-pg').style.display='flex';
  completeLoginBootstrap();
  document.getElementById('app').style.display='none';
  document.getElementById('req-form-card').style.display='none';
  document.getElementById('login-pg').querySelector('.lcard').style.display='block';
  const pinInput=document.getElementById('login-pin');
  if(pinInput&&!preserveCredentials)pinInput.value='';
  const err=document.getElementById('login-err');
  if(err)err.textContent='';
  const btn=document.getElementById('login-btn');
  btn.textContent=i18nCore.t('login.signIn');btn.disabled=false;
  renderInterimProductLabels();
  populateLoginUsers();
}
let loginUserOptions=[],loginUserFiltered=[],loginUserFocusIdx=-1;
function loginUserSuggestionsShouldOpen(){
  const input=document.getElementById('login-user');
  return!!(input&&(document.activeElement===input||String(input.value||'').trim()));
}
function populateLoginUsers(open=false){
  const input=document.getElementById('login-user');
  const list=document.getElementById('login-user-list');
  if(!input)return;
  // Prefer the public login directory so clean browsers and new members can
  // still discover approved usernames before signing in.
  const directoryState=managedLoginDirectory.snapshot();
  loginUserOptions=directoryState.status===loginDirectoryDomain.STATES.LOADED?knownLoginUsernames().sort(alphaCompare):[];
  if(list){
    list.innerHTML='';
    loginUserOptions.forEach(u=>{const o=document.createElement('option');o.value=u;list.appendChild(o);});
  }
  renderLoginUserSuggestions(open);
}
function renderLoginUserSuggestions(open=true){
  const input=document.getElementById('login-user');
  const box=document.getElementById('login-user-suggestions');
  if(!input||!box)return;
  const q=String(input.value||'').trim().toLowerCase();
  const directoryState=managedLoginDirectory.snapshot();
  const scored=directoryState.status===loginDirectoryDomain.STATES.LOADED
    ?managedLoginDirectory.suggestions(q,{limit:12,compare:alphaCompare})
    :[];
  loginUserFiltered=scored.map(item=>item.name);
  loginUserFocusIdx=Math.min(loginUserFocusIdx,loginUserFiltered.length-1);
  if(!open){hideLoginUserSuggestions();return;}
  if(directoryState.status===loginDirectoryDomain.STATES.LOADING||directoryState.status===loginDirectoryDomain.STATES.IDLE){
    box.innerHTML=`<div class="login-user-empty">${escHtml(i18nCore.t('login.directoryLoading'))}</div>`;
  }else if(directoryState.status===loginDirectoryDomain.STATES.ERROR){
    box.innerHTML=`<div class="login-user-empty">${escHtml(i18nCore.t('login.directoryError'))}<button type="button" class="login-user-retry" onclick="retryLoginDirectory()">${escHtml(i18nCore.t('login.directoryRetry'))}</button></div>`;
  }else if(!loginUserFiltered.length){
    box.innerHTML=q?`<div class="login-user-empty">${escHtml(i18nCore.t('login.directoryNoMatch'))}</div>`:'';
  }else{
    box.innerHTML=scored.map((item,i)=>{
      const name=item.name;
      const status=i18nCore.t(item.ready?'login.directoryReady':'login.directoryPending');
      return`<button type="button" class="login-user-option${i===loginUserFocusIdx?' focused':''}" id="login-user-option-${i}" role="option" aria-selected="${i===loginUserFocusIdx?'true':'false'}" onpointerdown="event.preventDefault();selectLoginUserByIndex(${i})">
        <span class="login-user-option-name">${escHtml(name)}</span>
        <span class="login-user-option-status">${escHtml(status)}</span>
      </button>`;
    }).join('');
  }
  const isOpen=!!box.innerHTML;
  box.classList.toggle('open',isOpen);
  input.setAttribute('aria-expanded',String(isOpen));
  if(isOpen&&loginUserFocusIdx>=0)input.setAttribute('aria-activedescendant',`login-user-option-${loginUserFocusIdx}`);
  else input.removeAttribute('aria-activedescendant');
}
function hideLoginUserSuggestions(){
  document.getElementById('login-user-suggestions')?.classList.remove('open');
  const input=document.getElementById('login-user');
  input?.setAttribute('aria-expanded','false');
  input?.removeAttribute('aria-activedescendant');
}
function selectLoginUser(name){
  const input=document.getElementById('login-user');
  if(input)input.value=name;
  hideLoginUserSuggestions();
  setTimeout(()=>document.getElementById('login-pin')?.focus(),50);
}
function selectLoginUserByIndex(i){
  const name=loginUserFiltered[i];
  if(name)selectLoginUser(name);
}
function loginUserKeydown(e){
  const box=document.getElementById('login-user-suggestions');
  const open=box?.classList.contains('open');
  if(e.key==='ArrowDown'){
    e.preventDefault();
    if(!open)renderLoginUserSuggestions(true);
    loginUserFocusIdx=Math.min(loginUserFocusIdx+1,loginUserFiltered.length-1);
    renderLoginUserSuggestions(true);
    return true;
  }
  if(e.key==='ArrowUp'){
    e.preventDefault();
    loginUserFocusIdx=Math.max(loginUserFocusIdx-1,0);
    renderLoginUserSuggestions(true);
    return true;
  }
  if(e.key==='Enter'){
    e.preventDefault();
    if(open&&loginUserFocusIdx>=0&&loginUserFiltered[loginUserFocusIdx])selectLoginUser(loginUserFiltered[loginUserFocusIdx]);
    else document.getElementById('login-pin')?.focus();
    return true;
  }
  if(e.key==='Escape'){hideLoginUserSuggestions();return true;}
  return false;
}
function setText(id,key){
  const el=document.getElementById(id);
  if(el)el.textContent=i18nCore.t(key);
}
function applyTranslationAttributes(root=document){
  root.querySelectorAll('[data-i18n]').forEach(el=>{const value=i18nCore.t(el.dataset.i18n);if(el.textContent!==value)el.textContent=value;});
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{const value=i18nCore.t(el.dataset.i18nPlaceholder);if(el.placeholder!==value)el.placeholder=value;});
  root.querySelectorAll('[data-i18n-aria-label]').forEach(el=>{const value=i18nCore.t(el.dataset.i18nAriaLabel);if(el.getAttribute('aria-label')!==value)el.setAttribute('aria-label',value);});
  root.querySelectorAll('[data-i18n-title]').forEach(el=>{const value=i18nCore.t(el.dataset.i18nTitle);if(el.title!==value)el.title=value;});
}
function renderInterimProductLabels(){
  document.documentElement.lang=i18nCore.getLocale();
  applyTranslationAttributes();
  const navLabels=[
    ['nav-mylist','nav.myList','nav.myListShort'],['nav-find','nav.findTrainer','nav.findTrainerShort'],
    ['nav-events','nav.events','nav.eventsShort'],['nav-inventory','nav.legacyInventory','nav.legacyInventoryShort'],
    ['admin-tab','nav.admin','nav.adminShort']
  ];
  navLabels.forEach(([id,labelKey,shortKey])=>{
    const el=document.getElementById(id);if(!el)return;
    const text=i18nCore.t(labelKey),shortText=i18nCore.t(shortKey),label=el.querySelector('.tab-label'),shortLabel=el.querySelector('.tab-short-label');
    if(label)label.textContent=text;
    if(shortLabel)shortLabel.textContent=shortText;
    el.dataset.short=shortText;
    el.setAttribute('aria-label',text);
  });
  renderTrainerDiscoveryHeading();
  setText('find-trainer-button','trainer.findAction');
  setText('find-trainer-reload','app.reloadAction');
  const findInput=document.getElementById('find-trainer-input');
  if(findInput)findInput.placeholder=i18nCore.t('trainer.findPlaceholder');
  const suggestions=document.getElementById('find-trainer-suggestions');
  if(suggestions)suggestions.setAttribute('aria-label',i18nCore.t('trainer.suggestionsLabel'));
  setText('my-string-title','strings.title');
  setText('my-string-help','strings.myListHelp');
  setText('legacy-inventory-title','inventory.legacyTitle');
  setText('legacy-inventory-description','inventory.legacyDescription');
  setText('events-title','events.title');
  setText('events-description','events.description');
  setText('settings-title','settings.title');
  setText('settings-description','settings.description');
  setText('account-menu-name',cur||'');
  setText('settings-account-name',cur||'');
  setText('sync-banner-title','status.localOnlyTitle');
  setText('sync-banner-action','status.signBackIn');
  const syncBannerSub=document.getElementById('sync-banner-sub');
  if(syncBannerSub)syncBannerSub.textContent=i18nCore.t('status.localOnlyBody',{count:i18nCore.formatNumber(Object.keys(syncQueue||{}).length)});
  const language=document.getElementById('settings-language');if(language)language.value=i18nCore.getLocale();
  syncPokemonGoSearchLanguageControl();
  const accountTrigger=document.getElementById('account-trigger');
  if(accountTrigger?.getAttribute('aria-expanded')==='true')accountTrigger.setAttribute('aria-label',i18nCore.t('account.closeMenu'));
}
async function changeInterfaceLocale(locale){
  const scrollX=window.scrollX,scrollY=window.scrollY;
  await window.__pogoEnsureLocale?.(locale);
  i18nCore.setLocale(locale);
  renderInterimProductLabels();
  updateAddBackgroundPresentation();
  if(cur){
    const active=activeTabName();
    _specialAcItems=null;
    if(active==='mylist'){buildAcItems();renderMyList();}
    else if(active==='find')renderFindTrainer();
    else if(active==='schedule')renderEventsOnly();
    else if(active==='strings')renderStrings();
    else if(active==='have'){haveAcItems=[];renderMyHave(document.getElementById('have-filter')?.value||'');}
    else if(active==='admin')renderAdmin();
    if(document.getElementById('settings-modal')?.classList.contains('open'))renderSettings();
    if(_activeDiff)renderDiffModal();
    if(_activeTradeMatch)renderTradeMatchModal();
    if(document.getElementById('trainer-organizer-modal')?.classList.contains('open'))renderTrainerOrganizer();
    if(document.getElementById('special-board-modal')?.classList.contains('open'))renderSpecialBoard();
    if(document.getElementById('background-picker-modal')?.classList.contains('open'))renderBackgroundPicker();
    renderSafeTransferOutput();
  }else populateLoginUsers(loginUserSuggestionsShouldOpen());
  if(_activeShareView?.username)renderShareView(_activeShareView.username,_activeShareView.type);
  requestAnimationFrame(()=>window.scrollTo(scrollX,scrollY));
  toast(i18nCore.t('settings.languageSaved'));
}
let trainerSuggestionTimer=0;
let trainerSuggestionItems=[];
let trainerSuggestionIndex=-1;
let trainerSuggestionQuery='';
let trainerSuggestionGeneration=0;
let eventTypeFilter='all';
let eventCalendarDate='';
let eventCalendarAnchor=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let trainerOrganizerState={query:'',tagIds:[],username:''};
let favoriteSavedPromptTimer=0;
let favoriteSwipeGesture=null;
let favoriteCardMenuTrigger=null;
let favoriteBrowseState={selected:null,suggestions:[],focusIndex:-1,busy:false,error:false,generation:0,expanded:false};
let favoriteBrowseCatalogCache={locale:'',items:[]};
function resetTrainerOrganizerState(){
  trainerOrganizerState={query:'',tagIds:[],username:''};
  if(document.getElementById('trainer-organizer-modal')?.classList.contains('open'))closeTrainerOrganizer(true);
}
function ensureTrainerHistoryStore(){
  const uid=auth?.currentUser?.uid;
  if(!uid||!cur)return null;
  trainerHistoryStore=trainerHistoryStoreData.createTrainerHistoryStore({storage:localStorage,identity:{uid,username:cur}});
  return trainerHistoryStore;
}
function ensureFavoriteShareSessionCache(){
  const uid=auth?.currentUser?.uid;
  if(!uid||!cur||!managedPublicShareRepository)return null;
  if(!favoriteShareSessionCache){
    favoriteShareSessionCache=favoriteShareSessionCacheData.createFavoriteShareSessionCache({
      repository:managedPublicShareRepository,
      validateProjection:publicSharePublicationDomain.publicShareProjectionStatus,
      projectSnapshot:favoritePokemonBrowseDomain.projectSnapshot,
      concurrency:4,maxFavorites:favoriteShareSessionCacheData.DEFAULT_MAX_FAVORITES
    });
  }
  favoriteShareSessionCache.activate({uid,username:cur});
  return favoriteShareSessionCache;
}
function resetFavoriteBrowseSession(){
  favoriteShareSessionCache?.reset();favoriteShareSessionCache=null;
  favoriteBrowseState={selected:null,suggestions:[],focusIndex:-1,busy:false,error:false,generation:favoriteBrowseState.generation+1,expanded:false};
  favoriteBrowseCatalogCache={locale:'',items:[]};
  const input=document.getElementById('favorite-browse-input');if(input)input.value='';
  closeFavoriteBrowseSuggestions();
  syncFavoriteBrowseDisclosure();
}
function trainerSearchCompatibility(){
  const state=clientReleaseDomain?.trainerSearchControlState?.(trainerDiscoveryDomain);
  if(state)return{ok:state.compatible,missing:state.missing,code:state.code};
  return{ok:false,missing:['clientRelease'],code:'client/reload-required'};
}
async function reloadCompatibleClient(){
  try{
    if('caches'in window){
      const names=await caches.keys();
      await Promise.all(names.filter(name=>name.startsWith('shell-pogo-trades-')).map(name=>caches.delete(name)));
    }
    const registration=await navigator.serviceWorker?.getRegistration?.();
    await registration?.update?.();
  }catch(error){
    console.warn('Client release refresh cleanup failed',error);
  }
  location.reload();
}
function requireCompatibleTrainerSearch(){
  const compatibility=trainerSearchCompatibility();
  const input=document.getElementById('find-trainer-input');
  const button=document.getElementById('find-trainer-button');
  const reload=document.getElementById('find-trainer-reload');
  const status=document.getElementById('find-trainer-status');
  if(compatibility.ok){
    if(input)input.disabled=false;
    if(button)button.disabled=false;
    if(reload)reload.style.display='none';
    return true;
  }
  clearTimeout(trainerSuggestionTimer);
  closeTrainerSuggestions();
  if(input)input.disabled=true;
  if(button)button.disabled=true;
  if(reload)reload.style.display='inline-flex';
  if(status)status.textContent=i18nCore.t('app.updateRequired');
  return false;
}
function renderFindTrainer(){
  renderInterimProductLabels();
  if(!requireCompatibleTrainerSearch())return;
  if(favoriteBrowseState.selected){
    const localized=favoriteBrowseCatalog().find(item=>item.name===favoriteBrowseState.selected.name);
    if(localized){favoriteBrowseState.selected={name:localized.name,dn:localized.dn,no:localized.no};const browseInput=document.getElementById('favorite-browse-input');if(browseInput)browseInput.value=localized.dn;}
  }
  const status=document.getElementById('find-trainer-status');
  if(!document.getElementById('find-trainer-input')?.value.trim()){setTrainerRecovery(false);if(status)status.textContent='';}
  renderFavoriteBrowseResults();
  renderTrainerQuickLists();
  syncFavoriteBrowseDisclosure();
  setTrainerDiscoveryMode(trainerDiscoveryMode);
}
function closeTrainerSuggestions(){
  const box=document.getElementById('find-trainer-suggestions'),input=document.getElementById('find-trainer-input'),shell=document.querySelector('.trainer-search-shell');
  if(box){box.classList.remove('open');box.innerHTML='';}
  shell?.classList.remove('suggestions-open');
  if(input){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  trainerSuggestionItems=[];trainerSuggestionIndex=-1;trainerSuggestionQuery='';
}
let trainerDiscoveryMode='trainers';
function renderTrainerDiscoveryHeading(){
  const copy={
    trainers:['trainer.findTitle','trainer.findDescription'],
    favorites:['trainer.favoritesTitle','trainer.favoritesDescription'],
    pokemon:['favoriteBrowse.title','favoriteBrowse.description']
  }[trainerDiscoveryMode]||['trainer.findTitle','trainer.findDescription'];
  setText('find-trainer-title',copy[0]);
  setText('find-trainer-description',copy[1]);
}
function setTrainerDiscoveryMode(mode){
  const allowed=['trainers','favorites','pokemon'];
  trainerDiscoveryMode=allowed.includes(mode)?mode:'trainers';
  const content=document.querySelector('.trainer-discovery-content');
  if(content)content.dataset.mode=trainerDiscoveryMode;
  document.querySelectorAll('.trainer-discovery-modes [data-discovery-mode]').forEach(button=>{
    const selected=button.dataset.discoveryMode===trainerDiscoveryMode;
    if(selected)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
    button.setAttribute('aria-selected',String(selected));
    button.tabIndex=selected?0:-1;
  });
  document.querySelectorAll('[data-discovery-panel]').forEach(panel=>{panel.hidden=panel.dataset.discoveryPanel!==trainerDiscoveryMode;});
  renderTrainerDiscoveryHeading();
  if(trainerDiscoveryMode==='pokemon'&&!favoriteBrowseState.expanded){favoriteBrowseState.expanded=true;syncFavoriteBrowseDisclosure();}
}
function focusTrainerDiscoveryMode(mode){
  const modeButton=document.querySelector(`.trainer-discovery-modes [data-discovery-mode="${mode}"]`);
  if(!modeButton)return;
  setTrainerDiscoveryMode(mode);
  if(mode==='trainers'){
    const input=document.getElementById('find-trainer-input');
    input?.focus({preventScroll:true});input?.select();return;
  }
  const target=document.getElementById(mode==='pokemon'?'favorite-pokemon-browse':'trainer-panel-favorites');
  if(mode==='pokemon')document.getElementById('favorite-browse-input')?.focus({preventScroll:true});
  else target?.querySelector('input,button')?.focus({preventScroll:true});
}
function trainerDiscoveryModeKeydown(event,mode){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const modes=['trainers','favorites','pokemon'],current=modes.indexOf(mode);
  const next=event.key==='Home'?0:event.key==='End'?modes.length-1:(current+(event.key==='ArrowRight'?1:-1)+modes.length)%modes.length;
  const button=document.querySelector(`.trainer-discovery-modes [data-discovery-mode="${modes[next]}"]`);
  setTrainerDiscoveryMode(modes[next]);button?.focus({preventScroll:true});
}
function positionTrainerSuggestions(){
  const input=document.getElementById('find-trainer-input'),box=document.getElementById('find-trainer-suggestions');if(!input||!box)return;
  const viewport=window.visualViewport;
  const top=viewport?.offsetTop||0,height=viewport?.height||window.innerHeight,bottom=top+height;
  const rect=input.getBoundingClientRect(),safe=12,spaceBelow=bottom-rect.bottom-safe,spaceAbove=rect.top-top-safe;
  const above=spaceBelow<176&&spaceAbove>spaceBelow;
  box.dataset.placement=above?'above':'below';
  box.style.setProperty('--trainer-suggestion-max-height',`${Math.max(96,Math.min(320,(above?spaceAbove:spaceBelow)-8))}px`);
}
function trainerSearchFocused(input){
  queueTrainerSuggestions(input?.value,true);
}
window.visualViewport?.addEventListener('resize',()=>document.getElementById('find-trainer-suggestions')?.classList.contains('open')&&positionTrainerSuggestions());
window.visualViewport?.addEventListener('scroll',()=>document.getElementById('find-trainer-suggestions')?.classList.contains('open')&&positionTrainerSuggestions());
function trainerSuggestionOptions(){
  const store=ensureTrainerHistoryStore(),state=store?.read?.();
  return{
    minLength:2,limit:8,
    favoriteNames:(state?.favorites||[]).map(item=>item.displayName),
    recentNames:(state?.recent||[]).map(item=>item.displayName)
  };
}
function rankedTrainerSuggestions(value){
  if(!requireCompatibleTrainerSearch())return[];
  return trainerDiscoveryDomain.trainerSuggestions(Object.keys(allData.loginDirectory||{}),value,trainerSuggestionOptions());
}
function trainerSuggestionHtml(item,index){
  const highlighted=item.matchStart>=0?`${escHtml(item.name.slice(0,item.matchStart))}<mark>${escHtml(item.name.slice(item.matchStart,item.matchStart+item.matchLength))}</mark>${escHtml(item.name.slice(item.matchStart+item.matchLength))}`:escHtml(item.name);
  const signals=[item.favorite?i18nCore.t('trainer.modeFavorites'):'',item.recent?i18nCore.t('trainer.recent'):''].filter(Boolean);
  const matches=`${item.theyHaveAvailable?`<span class="trainer-suggestion-match"><strong>${i18nCore.formatNumber(item.theyHaveMyWants)}</strong> ${escHtml(i18nCore.t('trainer.theyHaveMyWants'))}</span>`:''}${item.iHaveAvailable?`<span class="trainer-suggestion-match"><strong>${i18nCore.formatNumber(item.iHaveTheirWants)}</strong> ${escHtml(i18nCore.t('trainer.iHaveTheirWants'))}</span>`:''}`;
  return`<button type="button" class="trainer-suggestion${index===trainerSuggestionIndex?' active':''}" role="option" id="trainer-suggestion-${index}" aria-selected="${index===trainerSuggestionIndex}" data-index="${index}" onmousedown="event.preventDefault()" onclick="selectTrainerSuggestion(${index})"><span class="trainer-suggestion-name">${highlighted}</span><span class="trainer-suggestion-details"><span>${escHtml(i18nCore.t(`trainer.match.${item.matchType}`))}</span>${signals.length?`<span>${escHtml(signals.join(' · '))}</span>`:''}</span>${matches?`<span class="trainer-suggestion-matches">${matches}</span>`:''}</button>`;
}
function renderTrainerSuggestions(value,generation=trainerSuggestionGeneration){
  if(!requireCompatibleTrainerSearch())return;
  const input=document.getElementById('find-trainer-input'),box=document.getElementById('find-trainer-suggestions'),status=document.getElementById('find-trainer-status');
  if(!input||!box)return;
  const query=String(value||'').trim();syncTrainerSearchClear(query);
  if(generation!==trainerSuggestionGeneration||trainerDiscoveryDomain.fold(input.value)!==trainerDiscoveryDomain.fold(query))return;
  if(query.length<2){closeTrainerSuggestions();setTrainerRecovery(false);if(status)status.textContent='';return;}
  trainerSuggestionItems=rankedTrainerSuggestions(query);trainerSuggestionQuery=trainerDiscoveryDomain.fold(query);
  trainerSuggestionIndex=trainerSuggestionItems.length?0:-1;
  if(!trainerSuggestionItems.length){closeTrainerSuggestions();setTrainerRecovery(true);if(status)status.textContent=i18nCore.t('trainer.noVisibleMatch');return;}
  setTrainerRecovery(false);
  box.innerHTML=trainerSuggestionItems.map(trainerSuggestionHtml).join('');box.classList.add('open');document.querySelector('.trainer-search-shell')?.classList.add('suggestions-open');positionTrainerSuggestions();input.setAttribute('aria-expanded','true');
  input.setAttribute('aria-activedescendant','trainer-suggestion-0');if(status)status.textContent=i18nCore.t(trainerSuggestionItems[0].matchType==='exact'?'trainer.exactMatch':'trainer.partialMatches',{count:i18nCore.formatNumber(trainerSuggestionItems.length)});
}
function settleTrainerSuggestions(value,generation){
  try{renderTrainerSuggestions(value,generation);}
  catch(error){
    const input=document.getElementById('find-trainer-input'),status=document.getElementById('find-trainer-status');
    if(generation!==trainerSuggestionGeneration||trainerDiscoveryDomain.fold(input?.value)!==trainerDiscoveryDomain.fold(value))return;
    showTrainerSearchError(status);
  }
}
function showTrainerSearchError(status=document.getElementById('find-trainer-status')){closeTrainerSuggestions();setTrainerRecovery(true,{retry:true});if(status)status.textContent=i18nCore.t('trainer.searchError');}
function setTrainerRecovery(visible,{retry=false}={}){const el=document.getElementById('find-trainer-recovery'),button=document.getElementById('find-trainer-retry');if(el)el.hidden=!visible;if(button)button.hidden=!visible||!retry;}
function syncTrainerSearchClear(value=document.getElementById('find-trainer-input')?.value){const clear=document.getElementById('find-trainer-clear');if(clear)clear.hidden=!String(value||'').length;}
function clearTrainerSearch(){const input=document.getElementById('find-trainer-input');if(input)input.value='';syncTrainerSearchClear('');closeTrainerSuggestions();setTrainerRecovery(false);renderFindTrainer();input?.focus();}
function focusTrainerSearch(){const input=document.getElementById('find-trainer-input');input?.focus();input?.select();}
function retryTrainerSearch(){const input=document.getElementById('find-trainer-input');if(input)queueTrainerSuggestions(input.value,true);}
function queueTrainerSuggestions(value,immediate=false){
  if(!requireCompatibleTrainerSearch())return;
  syncTrainerSearchClear(value);
  clearTimeout(trainerSuggestionTimer);
  const generation=++trainerSuggestionGeneration;
  const status=document.getElementById('find-trainer-status');
  if(String(value||'').trim().length>=2&&status)status.textContent=i18nCore.t('trainer.searching');
  trainerSuggestionTimer=setTimeout(()=>settleTrainerSuggestions(value,generation),immediate?0:220);
}
function selectTrainerSuggestion(index){
  if(!requireCompatibleTrainerSearch())return;
  const item=trainerSuggestionItems[index];if(!item)return;
  const input=document.getElementById('find-trainer-input');if(input)input.value=item.name;syncTrainerSearchClear(item.name);
  closeTrainerSuggestions();openTrainerPublicShare(item.name);
}
function trainerSearchKeydown(event){
  if(!requireCompatibleTrainerSearch()){event.preventDefault();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    if(trainerSuggestionQuery!==trainerDiscoveryDomain.fold(event.currentTarget.value))renderTrainerSuggestions(event.currentTarget.value);
    if(!trainerSuggestionItems.length)return;
    event.preventDefault();const delta=event.key==='ArrowDown'?1:-1;
    trainerSuggestionIndex=(trainerSuggestionIndex+delta+trainerSuggestionItems.length)%trainerSuggestionItems.length;
    const box=document.getElementById('find-trainer-suggestions');if(box)box.innerHTML=trainerSuggestionItems.map(trainerSuggestionHtml).join('');
    event.currentTarget.setAttribute('aria-activedescendant',`trainer-suggestion-${trainerSuggestionIndex}`);box?.querySelector('.active')?.scrollIntoView({block:'nearest'});return;
  }
  if(event.key==='Enter'){
    event.preventDefault();clearTimeout(trainerSuggestionTimer);
    let best;
    try{best=trainerDiscoveryDomain.bestTrainerSuggestion(Object.keys(allData.loginDirectory||{}),event.currentTarget.value,trainerSuggestionOptions());}
    catch(error){showTrainerSearchError();return;}
    if(best){event.currentTarget.value=best.name;closeTrainerSuggestions();openTrainerPublicShare(best.name);}
    else openTrainerPublicShare(event.currentTarget.value);
    return;
  }
  if(event.key==='Escape'){event.preventDefault();closeTrainerSuggestions();}
}
function trainerViewedText(value,now=Date.now()){
  const recency=recentTrainerRecency(value,now);
  if(recency.kind==='just-now')return i18nCore.t('trainer.viewedJustNow');
  if(recency.kind==='relative')return i18nCore.t(`trainer.viewed${recency.unit[0].toUpperCase()}${recency.unit.slice(1)}s`,{count:i18nCore.formatNumber(recency.value)});
  const date=i18nCore.formatDate(recency.timestamp,{year:'numeric',month:'short',day:'numeric'});
  return i18nCore.t('trainer.viewedDate',{date});
}
function canonicalTrainerName(username){
  const store=ensureTrainerHistoryStore(),key=favoritePokemonBrowseDomain.trainerKey(username);
  if(typeof store?.favoriteFor==='function')return store.favoriteFor(username)?.displayName||String(username||'').trim();
  return store?.read?.().favorites?.find(item=>favoritePokemonBrowseDomain.trainerKey(item.displayName)===key)?.displayName||String(username||'').trim();
}
function favoriteTagChips(item,state){
  return(item.tagIds||[]).map(id=>state.tags[id]).filter(Boolean).map(tag=>`<span class="favorite-card-tag chip chip-metadata">${escHtml(tag.label)}</span>`).join('');
}
function favoriteBrowseCatalog(){
  const locale=i18nCore.getLocale();
  if(favoriteBrowseCatalogCache.locale===locale&&favoriteBrowseCatalogCache.items.length)return favoriteBrowseCatalogCache.items;
  const canonicalEntries=pokemonCatalogDomain.canonicalizeEntries(
    uniqueEntries(DB.wishlist,DB.dynamax,DB.gmax,allCostumeEntries(),LEGENDARY_AVATAR_ENTRIES)
  );
  const items=canonicalEntries.filter(entry=>isTradeableForWishlist(entry)).map(entry=>{
    const item={name:entry.name,dn:pokemonDisplayName(entry),no:entry.no||null,spriteUrl:entrySpriteUrl(entry,entry.name),catalogId:entry.catalogId,legacyAliases:entry.legacyAliases,searchAliases:entry.searchAliases};
    item.search=normalizeAcText(pokemonSearchLabels(entry).join(' '));return item;
  });
  favoriteBrowseCatalogCache={locale,items};return items;
}
function closeFavoriteBrowseSuggestions(){
  const box=document.getElementById('favorite-browse-suggestions'),input=document.getElementById('favorite-browse-input');
  if(box){box.classList.remove('open');box.innerHTML='';}
  if(input){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  favoriteBrowseState.suggestions=[];favoriteBrowseState.focusIndex=-1;
}
function syncFavoriteBrowseDisclosure(){
  const section=document.getElementById('favorite-pokemon-browse'),button=document.getElementById('favorite-browse-toggle'),panel=document.getElementById('favorite-browse-panel'),expanded=!!favoriteBrowseState.expanded;
  if(section)section.dataset.expanded=String(expanded);
  if(button)button.setAttribute('aria-expanded',String(expanded));
  if(panel)panel.hidden=!expanded;
}
function toggleFavoriteBrowse(){
  favoriteBrowseState.expanded=!favoriteBrowseState.expanded;
  if(!favoriteBrowseState.expanded)closeFavoriteBrowseSuggestions();
  syncFavoriteBrowseDisclosure();
  if(favoriteBrowseState.expanded)document.getElementById('favorite-browse-input')?.focus({preventScroll:true});
}
function syncFavoriteBrowseClear(){const button=document.getElementById('favorite-browse-clear'),input=document.getElementById('favorite-browse-input');if(button)button.hidden=!input?.value;}
function favoriteBrowseSuggestionHtml(item,index){
  return`<button type="button" class="ac-item${index===favoriteBrowseState.focusIndex?' focused':''}" role="option" id="favorite-browse-option-${index}" aria-selected="${index===favoriteBrowseState.focusIndex}" data-favorite-action="select-browse" data-favorite-index="${index}">${item.no||item.spriteUrl?spriteImg(item.no,28,'ac-item-sprite',item.name,'',item.dn,{urlOverride:item.spriteUrl}):''}${item.no?`<span class="ac-item-no">#${item.no}</span>`:''}<span class="ac-item-name">${escHtml(item.dn)}</span></button>`;
}
function favoriteBrowseInput(value){
  const input=document.getElementById('favorite-browse-input'),box=document.getElementById('favorite-browse-suggestions'),query=String(value||'').trim();
  syncFavoriteBrowseClear();
  if(favoriteBrowseState.selected&&input?.value!==favoriteBrowseState.selected.dn){favoriteBrowseState.selected=null;renderFavoriteBrowseResults();}
  if(!query){closeFavoriteBrowseSuggestions();return;}
  favoriteBrowseState.suggestions=rankAutocompleteItems(favoriteBrowseCatalog(),query);favoriteBrowseState.focusIndex=favoriteBrowseState.suggestions.length?0:-1;
  if(!box)return;
  box.innerHTML=favoriteBrowseState.suggestions.length?favoriteBrowseState.suggestions.map(favoriteBrowseSuggestionHtml).join(''):`<div class="ac-empty">${escHtml(i18nCore.t('common.noResults'))}</div>`;
  box.classList.add('open');input?.setAttribute('aria-expanded','true');
  if(favoriteBrowseState.focusIndex>=0)input?.setAttribute('aria-activedescendant','favorite-browse-option-0');
}
function favoriteBrowseKeydown(event){
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    if(!favoriteBrowseState.suggestions.length)return;
    event.preventDefault();const delta=event.key==='ArrowDown'?1:-1;
    favoriteBrowseState.focusIndex=(favoriteBrowseState.focusIndex+delta+favoriteBrowseState.suggestions.length)%favoriteBrowseState.suggestions.length;
    document.getElementById('favorite-browse-suggestions').innerHTML=favoriteBrowseState.suggestions.map(favoriteBrowseSuggestionHtml).join('');
    const activeId=`favorite-browse-option-${favoriteBrowseState.focusIndex}`;
    event.currentTarget.setAttribute('aria-activedescendant',activeId);
    document.getElementById(activeId)?.scrollIntoView({block:'nearest'});return;
  }
  if(event.key==='Enter'&&favoriteBrowseState.suggestions.length){event.preventDefault();selectFavoriteBrowsePokemon(Math.max(0,favoriteBrowseState.focusIndex));}
  else if(event.key==='Escape'){event.preventDefault();closeFavoriteBrowseSuggestions();}
}
function clearFavoriteBrowse(){
  const input=document.getElementById('favorite-browse-input');if(input)input.value='';
  favoriteBrowseState.selected=null;favoriteBrowseState.error=false;syncFavoriteBrowseClear();closeFavoriteBrowseSuggestions();renderFavoriteBrowseResults();input?.focus();
}
function selectFavoriteBrowsePokemon(index){
  const item=favoriteBrowseState.suggestions[index];if(!item)return;
  favoriteBrowseState.selected={name:item.name,dn:item.dn,no:item.no};favoriteBrowseState.error=false;favoriteBrowseState.expanded=true;
  const input=document.getElementById('favorite-browse-input');if(input)input.value=item.dn;
  syncFavoriteBrowseClear();closeFavoriteBrowseSuggestions();syncFavoriteBrowseDisclosure();hydrateFavoriteBrowse();
}
function favoriteBrowseEmpty(titleKey,bodyKey,params={}){return emptyHtml(i18nCore.t(titleKey,params),i18nCore.t(bodyKey,params),'search');}
function favoriteBrowseCategoryText(categories){
  const special=[...new Set(categories||[])].filter(type=>type!=='wishlist');
  return special.map(type=>i18nCore.t(`favoriteBrowse.category.${type}`)).join(' · ');
}
function favoriteBrowsePriorityText(priority){return i18nCore.t(`favoriteBrowse.priority.${priority||'none'}`);}
function renderFavoriteBrowseResults(){
  const output=document.getElementById('favorite-browse-results'),store=ensureTrainerHistoryStore();if(!output||!store)return;
  syncFavoriteBrowseDisclosure();
  const state=store.read(),favorites=state.favorites||[],selected=favoriteBrowseState.selected;
  if(!favorites.length){output.removeAttribute('aria-busy');output.innerHTML=favoriteBrowseEmpty('favoriteBrowse.noFavoritesTitle','favoriteBrowse.noFavoritesBody');return;}
  if(!selected){output.removeAttribute('aria-busy');output.innerHTML='';return;}
  if(favoriteBrowseState.busy)return;
  const cache=ensureFavoriteShareSessionCache();if(!cache)return;
  cache.syncFavorites(favorites);
  const snapshot=cache.snapshot(),summary=cache.summary(favorites),index=favoritePokemonBrowseDomain.buildIndex(snapshot.records);
  const ownedPokemonNames=cur?Object.entries(allData.have?.[cur]||{}).filter(([,value])=>haveEntryInfo(value).qty>0).map(([key])=>splitHaveKey(key).name):[];
  const matches=favoritePokemonBrowseDomain.resultsForPokemon(index,selected.name,{favorites,tags:state.tags,recent:state.recent,locale:i18nCore.getLocale(),ownedPokemonNames});
  const hasPublished=summary.published+summary.publishedEmpty>0;
  const incomplete=summary.failed+summary.invalid;
  let body='';
  if(!hasPublished&&!incomplete)body=favoriteBrowseEmpty('favoriteBrowse.noSharedTitle','favoriteBrowse.noSharedBody');
  else if(!matches.length)body=favoriteBrowseEmpty('favoriteBrowse.noMatchTitle','favoriteBrowse.noMatchBody',{pokemon:selected.dn});
  else body=`<div class="favorite-browse-summary"><span class="favorite-browse-pokemon">${escHtml(selected.dn)}</span><span class="favorite-browse-count">${escHtml(i18nCore.formatPlural('favoriteBrowse.results',matches.length,{pokemon:selected.dn}))}</span></div><div class="favorite-browse-results">${matches.map(match=>{
    const category=favoriteBrowseCategoryText(match.categories),trainer=escAttr(match.displayName);
    const backgrounds=(match.backgroundIds||[]).map(id=>backgroundBadgeHtml(id)).join('');
    return`<button type="button" class="favorite-browse-row" data-trainer="${trainer}" data-trainer-action="open" aria-label="${escAttr(i18nCore.t('trainer.openTrainerNamed',{trainer:match.displayName}))}"><span class="favorite-browse-main"><span class="favorite-browse-name">${escHtml(match.displayName)}</span><span class="favorite-browse-match"><strong>${i18nCore.formatNumber(match.iHaveTheirWants)}</strong> ${escHtml(i18nCore.t('trainer.iHaveTheirWants'))}</span><span class="favorite-browse-meta"><span class="favorite-browse-priority ${escAttr(match.priority)}">${escHtml(favoriteBrowsePriorityText(match.priority))}</span>${category?`<span>${escHtml(category)}</span>`:''}${backgrounds}</span>${match.tags.length?`<span class="favorite-browse-tags">${match.tags.map(label=>`<span class="favorite-card-tag chip chip-metadata">${escHtml(label)}</span>`).join('')}</span>`:''}</span><span class="favorite-browse-open btn btn-ghost" aria-hidden="true">${escHtml(i18nCore.t('trainer.openAction'))} ${uiIconMarkup('chevron-right','ui-icon ui-icon-sm')}</span></button>`;
  }).join('')}</div>`;
  const footer=summary.checked?`<div class="favorite-browse-footer"><span>${escHtml(i18nCore.t('favoriteBrowse.checked'))}</span><button type="button" class="btn btn-ghost" data-favorite-action="refresh-browse">${escHtml(i18nCore.t('favoriteBrowse.refresh'))}</button>${summary.failed?`<button type="button" class="btn btn-secondary" data-favorite-action="retry-browse">${escHtml(i18nCore.t('favoriteBrowse.retry'))}</button>`:''}${incomplete?`<span class="favorite-browse-partial">${escHtml(i18nCore.t('favoriteBrowse.partial',{checked:i18nCore.formatNumber(summary.total-incomplete),total:i18nCore.formatNumber(summary.total),failed:i18nCore.formatNumber(incomplete)}))}</span>`:''}</div>`:'';
  output.removeAttribute('aria-busy');output.innerHTML=body+footer;
}
async function hydrateFavoriteBrowse({force=false,retry=false}={}){
  const store=ensureTrainerHistoryStore(),cache=ensureFavoriteShareSessionCache(),output=document.getElementById('favorite-browse-results');
  if(!store||!cache||!output||!favoriteBrowseState.selected)return;
  const favorites=store.read().favorites||[],generation=++favoriteBrowseState.generation;favoriteBrowseState.busy=true;favoriteBrowseState.error=false;
  if(!favorites.length){favoriteBrowseState.busy=false;renderFavoriteBrowseResults();return;}
  output.setAttribute('aria-busy','true');
  const progress=({completed,total})=>{if(generation!==favoriteBrowseState.generation)return;output.innerHTML=`<div class="favorite-browse-progress"><span class="skel skel-line"></span><span>${escHtml(i18nCore.t('favoriteBrowse.loading',{completed:i18nCore.formatNumber(completed),total:i18nCore.formatNumber(total)}))}</span></div>`;};
  progress({completed:0,total:retry?cache.summary(favorites).failed:favorites.length});
  try{retry?await cache.retryUnavailable(favorites,{onProgress:progress}):await cache.hydrate(favorites,{force,onProgress:progress});}
  catch(error){if(error?.code!=='favorite-cache/session-changed')favoriteBrowseState.error=true;}
  if(generation!==favoriteBrowseState.generation)return;
  favoriteBrowseState.busy=false;renderFavoriteBrowseResults();
}
function refreshFavoriteBrowse(){const cache=ensureFavoriteShareSessionCache();if(!cache)return;cache.invalidate();hydrateFavoriteBrowse({force:true});}
function retryFavoriteBrowse(){hydrateFavoriteBrowse({retry:true});}
function closeFavoriteCardActions(except=null,restoreFocus=false){
  document.querySelectorAll('.favorite-card-shell.swipe-open').forEach(card=>{if(card!==except)card.classList.remove('swipe-open');});
  document.querySelectorAll('.favorite-card-menu:not([hidden])').forEach(menu=>{if(!except||!except.contains(menu)){menu.hidden=true;menu.closest('.favorite-card-shell')?.classList.remove('menu-open');}});
  document.querySelectorAll('.favorite-card-shell.menu-open').forEach(card=>{if(card!==except)card.classList.remove('menu-open');});
  if(restoreFocus&&favoriteCardMenuTrigger?.isConnected)favoriteCardMenuTrigger.focus();
  if(!except)favoriteCardMenuTrigger=null;
}
function openFavoriteSwipeActions(button){const card=button?.closest('.favorite-card-shell');if(!card)return;closeFavoriteCardActions(card);card.classList.add('swipe-open');}
function toggleFavoriteCardMenu(event,button){
  event?.stopPropagation();const card=button?.closest('.favorite-card-shell'),menu=card?.querySelector('.favorite-card-menu');if(!card||!menu)return;
  const opening=menu.hidden;closeFavoriteCardActions(card);card.classList.remove('swipe-open');menu.hidden=!opening;card.classList.toggle('menu-open',opening);if(opening){favoriteCardMenuTrigger=button;menu.querySelector('button')?.focus();}
}
function openFavoriteTagsFromMenu(button,username){const trigger=button?.closest('.favorite-card-shell')?.querySelector('.favorite-card-more');openTrainerOrganizer(username,trigger);}
function favoriteCardPointerDown(event){
  if(event.pointerType==='mouse'&&event.button!==0)return;
  const card=event.target.closest?.('.favorite-card-surface')?.closest('.favorite-card-shell');if(!card)return;
  favoriteSwipeGesture={card,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,horizontal:false};
}
function favoriteCardPointerMove(event){
  const gesture=favoriteSwipeGesture;if(!gesture||gesture.pointerId!==event.pointerId)return;
  const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY,intent=favoriteCardInteractionsDomain.swipeIntent(dx,dy);
  if(intent.intent==='vertical'){favoriteSwipeGesture=null;return;}
  if(intent.intent!=='pending'){gesture.horizontal=true;event.preventDefault();}
}
function favoriteCardPointerUp(event){
  const gesture=favoriteSwipeGesture;if(!gesture||gesture.pointerId!==event.pointerId)return;favoriteSwipeGesture=null;
  const decision=favoriteCardInteractionsDomain.swipeIntent(event.clientX-gesture.startX,event.clientY-gesture.startY);
  if(!gesture.horizontal)return;
  if(decision.open){closeFavoriteCardActions(gesture.card);gesture.card.classList.add('swipe-open');}
  else gesture.card.classList.remove('swipe-open');
}
function favoriteCardPointerCancel(){favoriteSwipeGesture=null;}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.favorite-card-shell'))closeFavoriteCardActions();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('.favorite-card-shell.swipe-open,.favorite-card-menu:not([hidden])')){closeFavoriteCardActions(null,true);event.stopPropagation();}});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const editor=document.querySelector('.myrow-editor[open]');
  if(!editor)return;
  event.preventDefault();editor.removeAttribute('open');editor.querySelector('summary')?.focus();
});
function setFavoriteSearch(value){
  trainerOrganizerState.query=String(value||'');
  syncFavoriteSearchControl();
  renderTrainerQuickLists({favoritesOnly:true});
}
function syncFavoriteSearchControl(){const input=document.getElementById('favorite-trainer-search'),clear=document.getElementById('favorite-trainer-search-clear');if(input&&input.value!==trainerOrganizerState.query)input.value=trainerOrganizerState.query;if(clear)clear.hidden=!trainerOrganizerState.query;}
function clearFavoriteSearch(){trainerOrganizerState.query='';syncFavoriteSearchControl();renderTrainerQuickLists({favoritesOnly:true});document.getElementById('favorite-trainer-search')?.focus();}
function favoriteTrainerAction(event){
  const control=event.target.closest?.('[data-trainer-action],[data-favorite-action]');if(!control||!event.currentTarget.contains(control))return;
  const favoriteAction=control.dataset.favoriteAction;
  if(favoriteAction==='clear-filters'){clearFavoriteFilters();return;}
  if(favoriteAction==='toggle-tag'){toggleFavoriteTagFilter(control.dataset.favoriteTagId||'');return;}
  if(favoriteAction==='toggle-menu'){toggleFavoriteCardMenu(event,control);return;}
  if(favoriteAction==='show-favorites'){focusTrainerDiscoveryMode('favorites');return;}
  if(favoriteAction==='refresh-browse'){refreshFavoriteBrowse();return;}
  if(favoriteAction==='retry-browse'){retryFavoriteBrowse();return;}
  if(favoriteAction==='select-browse'){
    const index=Number.parseInt(control.dataset.favoriteIndex||'',10);if(Number.isSafeInteger(index)&&index>=0)selectFavoriteBrowsePokemon(index);return;
  }
  const action=control.dataset.trainerAction,username=control.closest('[data-trainer]')?.dataset.trainer||control.dataset.trainer||'';
  if(action==='open')openTrainerByName(username);
  else if(action==='organize')openTrainerOrganizer(username,control);
  else if(action==='organize-menu')openFavoriteTagsFromMenu(control,username);
  else if(action==='remove')removeTrainerFavorite(username);
}
function favoriteBrowsePointerDown(event){if(event.target.closest?.('[data-favorite-action="select-browse"]'))event.preventDefault();}
document.getElementById('favorite-trainers-controls')?.addEventListener('click',favoriteTrainerAction);
document.getElementById('favorite-trainers-list')?.addEventListener('click',favoriteTrainerAction);
document.getElementById('recent-trainers')?.addEventListener('click',favoriteTrainerAction);
document.getElementById('trainer-favorites-preview')?.addEventListener('click',favoriteTrainerAction);
document.getElementById('favorite-browse-results')?.addEventListener('click',favoriteTrainerAction);
document.getElementById('favorite-browse-suggestions')?.addEventListener('click',favoriteTrainerAction);
document.getElementById('favorite-browse-suggestions')?.addEventListener('pointerdown',favoriteBrowsePointerDown);
document.getElementById('favorite-trainers-list')?.addEventListener('pointerdown',favoriteCardPointerDown);
document.getElementById('favorite-trainers-list')?.addEventListener('pointermove',favoriteCardPointerMove);
document.getElementById('favorite-trainers-list')?.addEventListener('pointerup',favoriteCardPointerUp);
document.getElementById('favorite-trainers-list')?.addEventListener('pointercancel',favoriteCardPointerCancel);
function toggleFavoriteTagFilter(id){
  if(!id)return;
  const selected=new Set(trainerOrganizerState.tagIds);selected.has(id)?selected.delete(id):selected.add(id);trainerOrganizerState.tagIds=[...selected].sort();renderTrainerQuickLists();
}
function clearFavoriteFilters(){trainerOrganizerState.query='';trainerOrganizerState.tagIds=[];syncFavoriteSearchControl();renderTrainerQuickLists();}
async function renderTrainerQuickLists({preserveFavoriteControls=false,favoritesOnly=false}={}){
  const store=ensureTrainerHistoryStore(),favoritesEl=document.getElementById('favorite-trainers'),favoritesControlsEl=document.getElementById('favorite-trainers-controls'),favoritesListEl=document.getElementById('favorite-trainers-list'),previewEl=document.getElementById('trainer-favorites-preview'),recentEl=document.getElementById('recent-trainers'),noteEl=document.getElementById('trainer-history-note');
  if(!store||!favoritesEl||!favoritesControlsEl||!favoritesListEl||!previewEl||!recentEl)return;
  if(accountSyncOrganizationHydrating()){
    const loading=stateHtml(stateModel('loading',{title:i18nCore.t('trainer.syncHydrating'),detail:i18nCore.t('trainer.syncHydratingHelp')}));
    favoritesControlsEl.innerHTML=`<div class="trainer-section-heading"><h2 class="trainer-quick-heading">${escHtml(i18nCore.t('trainer.favoritesTitle'))}</h2><span class="trainer-section-count">—</span></div>`;
    favoritesListEl.innerHTML=loading;
    if(favoritesOnly)return;
    previewEl.hidden=false;previewEl.innerHTML=loading;
    recentEl.innerHTML=loading;
    return;
  }
  const state=store.read();
  if(noteEl){noteEl.style.display='none';noteEl.textContent='';}
  const activeTags=Object.values(state.tags||{}).sort((a,b)=>a.label.localeCompare(b.label,i18nCore.getLocale(),{sensitivity:'base'}));
  const filtered=store.filterFavorites({query:trainerOrganizerState.query,tagIds:trainerOrganizerState.tagIds});
  const filtersActive=!!(trainerOrganizerState.query||trainerOrganizerState.tagIds.length);
  const toolbar=state.favorites.length?`<div class="favorite-toolbar"><button class="bghost btn btn-secondary" data-favorite-clear data-favorite-action="clear-filters"${filtersActive?'':' hidden'}>${escHtml(i18nCore.t('organizer.clearFilters'))}</button>${activeTags.length?`<div class="favorite-filter-group"><span class="favorite-filter-label">${escHtml(i18nCore.t('organizer.tags'))}</span><div class="favorite-filter-tags" aria-label="${escAttr(i18nCore.t('organizer.filterTags'))}">${activeTags.map(tag=>{const selected=trainerOrganizerState.tagIds.includes(tag.id);return`<button class="favorite-filter-chip chip chip-filter" aria-pressed="${selected}" data-favorite-action="toggle-tag" data-favorite-tag-id="${escAttr(tag.id)}"><span class="favorite-filter-chip-surface"><span class="favorite-filter-check" aria-hidden="true">${selected?'✓':''}</span>${escHtml(tag.label)}</span></button>`;}).join('')}</div></div>`:''}</div>`:'';
  const favoritesHeading=`<div class="trainer-section-heading"><h2 class="trainer-quick-heading">${escHtml(i18nCore.t('trainer.favoritesTitle'))}</h2><span class="trainer-section-count">${state.favorites.length}</span></div>`;
  const items=filtered.map(item=>{const canonical=canonicalTrainerName(item.displayName);if(canonical!==item.displayName&&!accountSyncProjectionReady())store.updateCanonicalName(canonical);return{...item,displayName:canonical};});
  syncFavoriteSearchControl();if(!preserveFavoriteControls)favoritesControlsEl.innerHTML=`${favoritesHeading}${toolbar}`;
  favoritesListEl.innerHTML=items.length?`<div class="trainer-quick-grid">${items.map(item=>{
    const trainer=escAttr(item.displayName),hasTags=!!item.tagIds?.length,editLabel=i18nCore.t(hasTags?'organizer.editTagsFor':'organizer.addTagsFor',{trainer:item.displayName});
    return`<article class="favorite-card-shell card-interactive" data-trainer="${trainer}"><div class="favorite-card-rail" aria-hidden="true"><button type="button" tabindex="-1" data-trainer-action="organize">+ ${escHtml(i18nCore.t('organizer.tags'))}</button><button type="button" tabindex="-1" data-favorite-action="toggle-menu">⋯</button></div><div class="favorite-card-surface"><button type="button" class="trainer-quick-main favorite-card-primary" data-trainer-action="open" aria-label="${escAttr(i18nCore.t('trainer.openTrainerNamed',{trainer:item.displayName}))}"><span class="trainer-quick-name type-card">${escHtml(item.displayName)}</span>${hasTags?`<span class="favorite-card-tags">${favoriteTagChips(item,state)}</span>`:''}</button><div class="favorite-card-footer"><button type="button" class="favorite-card-open btn btn-ghost" data-trainer-action="open">${escHtml(i18nCore.t('trainer.openAction'))}</button><button type="button" class="favorite-card-add-tag btn btn-secondary" data-trainer-action="organize" aria-label="${escAttr(editLabel)}"><span aria-hidden="true">+</span> ${escHtml(i18nCore.t('organizer.tagAction'))}</button><button type="button" class="favorite-card-more btn btn-icon" aria-haspopup="menu" aria-label="${escAttr(i18nCore.t('organizer.moreActionsFor',{trainer:item.displayName}))}" data-favorite-action="toggle-menu">⋯</button></div><div class="favorite-card-menu" role="menu" hidden><button type="button" role="menuitem" data-trainer-action="organize-menu">${escHtml(i18nCore.t('organizer.editTags'))}</button><button type="button" role="menuitem" class="danger" data-trainer-action="remove">${escHtml(i18nCore.t('organizer.removeFavorite'))}</button></div></div></article>`;
  }).join('')}</div>`:emptyHtml(i18nCore.t(state.favorites.length?'organizer.noMatches':'organizer.noFavorites'),i18nCore.t(state.favorites.length?'organizer.noMatchesHelp':'organizer.noFavoritesHelp'),state.favorites.length?'search':'users');
  if(favoritesOnly)return;
  const previewItems=state.favorites.slice(0,4);
  previewEl.hidden=!previewItems.length;
  previewEl.innerHTML=previewItems.length?`${favoritesHeading}<div class="trainer-favorites-preview-list">${previewItems.map(item=>`<button type="button" class="trainer-favorites-preview-row card-row" data-trainer="${escAttr(item.displayName)}" data-trainer-action="open" aria-label="${escAttr(i18nCore.t('trainer.openTrainerNamed',{trainer:item.displayName}))}"><span class="trainer-quick-main"><span class="trainer-quick-name type-card">${escHtml(item.displayName)}</span></span><span class="recent-trainer-chevron" aria-hidden="true">${uiIconMarkup('chevron-right','ui-icon ui-icon-sm')}</span></button>`).join('')}</div><button type="button" class="trainer-favorites-preview-action" data-favorite-action="show-favorites">${escHtml(i18nCore.t('trainer.viewAllFavorites'))}</button>`:'';
  const recentHeading=`<div class="trainer-section-heading"><h2 class="trainer-quick-heading">${escHtml(i18nCore.t('trainer.recentTitle'))}</h2>${state.recent.length?`<span class="trainer-section-count">${state.recent.length}</span>`:''}</div>`;
  recentEl.innerHTML=`${recentHeading}${state.recent.length?`<div class="recent-trainer-list">${state.recent.map(item=>`<button type="button" class="recent-trainer-row card-row" data-trainer="${escAttr(item.displayName)}" data-trainer-action="open" aria-label="${escAttr(i18nCore.t('trainer.openTrainerNamed',{trainer:item.displayName}))}"><span class="trainer-quick-main"><span class="trainer-quick-name recent-trainer-name type-card">${escHtml(item.displayName)}</span><span class="trainer-quick-meta recent-trainer-recency type-meta">${escHtml(trainerViewedText(item.openedAt))}</span></span><span class="recent-trainer-chevron" aria-hidden="true">${uiIconMarkup('chevron-right','ui-icon ui-icon-sm')}</span></button>`).join('')}</div>`:`${emptyHtml(i18nCore.t('trainer.noRecents'),i18nCore.t('trainer.noRecentsHelp'),'activity')}`}`;
  renderFavoriteBrowseResults();
}
function accountSyncFavoriteUid(username){
  return accountSyncProduct.exactFavoriteTargetUid(username,{users:allData.users||{},authIndex:allData.authIndex||{}});
}
async function completeUnresolvedFavoriteReview(username,runtime=managedAccountSyncRuntime){
  if(!runtime?.listRecoveryCandidates||!runtime?.completeRecoveryReview)return accountSyncModel.failure('account-sync/runtime-unavailable','Cross-device sync runtime is unavailable');
  const key=favoritePokemonBrowseDomain.trainerKey(username),candidates=await runtime.listRecoveryCandidates({unresolvedOnly:false});
  const matches=candidates.filter(item=>item?.reason==='favorite-uid-unresolved'&&item?.entityType==='favorite'&&favoritePokemonBrowseDomain.trainerKey(item?.values?.displayName)===key);
  if(!matches.length)return accountSyncModel.failure('account-sync/recovery-evidence-missing','Exact Favorite recovery evidence is unavailable');
  for(const item of matches){if(item.resolved===true)continue;const result=await runtime.completeRecoveryReview(item.candidateId);if(!result?.ok)return result;}
  return Object.freeze({ok:true,status:'resolved',count:matches.length});
}
async function queueFavoriteTags(username,tagIds){
  const store=ensureTrainerHistoryStore(),favorite=store?.favoriteFor(username);
  const authority=await accountSyncMutationAuthority();
  if(authority.mode==='blocked')return accountSyncModel.failure(authority.code||'account-sync/not-ready','Cross-device sync is not ready');
  if(authority.mode!=='canonical')return null;
  if(!accountSyncAuthorityCurrent(authority))return accountSyncModel.failure('account-sync/session-changed','Cross-device sync session changed');
  if(!favorite?.targetUid)return accountSyncModel.failure('account-sync/favorite-binding-missing','Favorite identity is not available');
  const patch=accountSyncProduct.favoriteTagPatch(favorite.tagIds||[],tagIds||[]);
  if(!Object.keys(patch).length)return Object.freeze({ok:true,status:'no_changes'});
  const result=await authority.controller.patchEntity({entityType:'favorite',entityId:favorite.targetUid,patch});
  return accountSyncAuthorityCurrent(authority)?result:accountSyncModel.failure('account-sync/session-changed','Cross-device sync session changed');
}
async function toggleTrainerFavorite(username){
  const store=ensureTrainerHistoryStore();if(!store)return;
  if(store.isFavorite(username)){await removeTrainerFavorite(username);return;}
  const authority=await accountSyncMutationAuthority();
  if(authority.mode==='blocked'){toast(i18nCore.t('organizer.saveFailed'));return;}
  if(!accountSyncAuthorityCurrent(authority)){toast(i18nCore.t('organizer.saveFailed'));return;}
  let result;
  if(authority.mode==='canonical'){
    const targetUid=accountSyncFavoriteUid(username);
    if(!targetUid){toast(i18nCore.t('organizer.favoriteSyncUnavailable',{trainer:username}),6000);return;}
    const queued=await authority.controller.addEntity({entityType:'favorite',entityId:targetUid,identity:{targetUid},values:{displayName:String(username||'').normalize('NFC').trim()}});
    if(!queued?.ok||!accountSyncAuthorityCurrent(authority)){toast(i18nCore.t('organizer.saveFailed'));return;}
    result={ok:true,state:store.read()};
  }else result=store.saveFavoriteOrganization(username);
  if(!result.ok){toast(organizerMessage(result.code));return;}
  favoriteShareSessionCache?.syncFavorites(store.read().favorites);
  showFavoriteSavedPrompt(username);renderTrainerQuickLists();
  if(_activeShareView?.username===username)renderShareView(username,_activeShareView.type);
  const savedFavorite=store.favoriteFor(username);
  if(favoriteShareSessionCache&&favoriteBrowseState.selected&&savedFavorite){
    try{await favoriteShareSessionCache.readFavorite(savedFavorite);}
    catch(error){if(error?.code!=='favorite-cache/session-changed')console.warn('Could not update active Favorite Browse index',error);}
    renderFavoriteBrowseResults();
  }
}
function showFavoriteSavedPrompt(username){
  const prompt=document.getElementById('favorite-saved-prompt'),message=document.getElementById('favorite-saved-message'),button=document.getElementById('favorite-saved-organize');if(!prompt||!message||!button)return;
  clearTimeout(favoriteSavedPromptTimer);message.textContent=i18nCore.t('organizer.favoriteSaved',{trainer:username});button.onclick=()=>{prompt.hidden=true;openTrainerOrganizer(username);};prompt.hidden=false;announceFeedback(message.textContent);favoriteSavedPromptTimer=setTimeout(()=>{prompt.hidden=true;},5000);
}
async function removeTrainerFavorite(username){
  const store=ensureTrainerHistoryStore();if(!store?.isFavorite(username)||!confirm(i18nCore.t('organizer.removeConfirm',{trainer:username})))return;
  const favorite=store.favoriteFor(username),authority=favorite?.targetUid?await accountSyncMutationAuthority():await accountSyncFavoriteReviewAuthority();
  if(authority.mode==='blocked'){toast(i18nCore.t('organizer.saveFailed'));return;}
  if(authority.mode==='canonical-review'?!accountSyncFavoriteReviewAuthorityCurrent(authority):!accountSyncAuthorityCurrent(authority)){toast(i18nCore.t('organizer.saveFailed'));return;}
  if(authority.mode==='canonical'&&favorite?.targetUid){
    const queued=await authority.controller.deleteEntity({entityType:'favorite',entityId:favorite.targetUid});
    if(!queued?.ok||!accountSyncAuthorityCurrent(authority)){toast(i18nCore.t('organizer.saveFailed'));return;}
  }else{
    if(authority.mode==='canonical-review'){
      const reviewed=await completeUnresolvedFavoriteReview(username,authority.runtime);
      if(!reviewed?.ok||!accountSyncFavoriteReviewAuthorityCurrent(authority)){toast(i18nCore.t('organizer.saveFailed'));return;}
    }
    const removed=store.toggleFavorite(username);if(!removed?.ok){toast(i18nCore.t('organizer.saveFailed'));return;}
  }
  favoriteShareSessionCache?.syncFavorites(store.read().favorites);toast(i18nCore.t('trainer.favoriteRemoved'));renderFavoriteBrowseResults();renderTrainerQuickLists();if(_activeShareView?.username===username)renderShareView(username,_activeShareView.type);
}
function organizerMessage(code){return i18nCore.t(`organizer.${code}`);}
async function trainerOrganizerChanged(){
  const tagIds=[...document.querySelectorAll('#organizer-tag-assignment input:checked')].map(input=>input.dataset.tagId);
  const queued=await queueFavoriteTags(trainerOrganizerState.username,tagIds);
  const result=queued?(queued.ok?{ok:true}:queued):ensureTrainerHistoryStore()?.setFavoriteTags(trainerOrganizerState.username,tagIds),status=document.getElementById('organizer-status');
  if(status)status.textContent=i18nCore.t(result?.ok?'organizer.savedLocal':'organizer.saveFailed');
  if(result?.ok){renderFavoriteBrowseResults();renderTrainerQuickLists();}
}
function renderTrainerOrganizer(){
  const store=ensureTrainerHistoryStore(),favorite=store?.favoriteFor(trainerOrganizerState.username);if(!store||!favorite)return closeTrainerOrganizer(true);
  const state=store.read(),tags=Object.values(state.tags).sort((a,b)=>a.label.localeCompare(b.label,i18nCore.getLocale(),{sensitivity:'base'}));
  document.getElementById('organizer-trainer-name').textContent=favorite.displayName;
  document.getElementById('organizer-trainer-av').textContent=favorite.displayName.slice(0,2).toUpperCase();
  const assignment=document.getElementById('organizer-tag-assignment');
  assignment.innerHTML=tags.length?tags.map(tag=>{const selected=favorite.tagIds.includes(tag.id);return`<button type="button" class="organizer-selectable-chip chip chip-selectable" data-tag-id="${tag.id}" aria-pressed="${selected}" onclick="toggleTrainerOrganizerTag('${tag.id}')"><span>${escHtml(tag.label)}</span>${selected?'<span class="organizer-chip-check" aria-hidden="true">✓</span>':''}</button>`;}).join(''):`<span class="organizer-help type-meta">${escHtml(i18nCore.t('organizer.noTags'))}</span>`;
}
async function toggleTrainerOrganizerTag(id){
  const store=ensureTrainerHistoryStore(),favorite=store?.favoriteFor(trainerOrganizerState.username);if(!store||!favorite)return;
  const selected=new Set(favorite.tagIds||[]);selected.has(id)?selected.delete(id):selected.add(id);
  const queued=await queueFavoriteTags(trainerOrganizerState.username,[...selected]);
  const result=queued?(queued.ok?{ok:true}:queued):store.setFavoriteTags(trainerOrganizerState.username,[...selected]),status=document.getElementById('organizer-status');
  if(status)status.textContent=i18nCore.t(result?.ok?'organizer.savedLocal':'organizer.saveFailed');
  if(result?.ok){renderTrainerOrganizer();renderFavoriteBrowseResults();renderTrainerQuickLists();}
}
function openTrainerOrganizer(username,returnFocus=document.activeElement){
  const store=ensureTrainerHistoryStore();if(!store?.isFavorite(username))return;
  closeFavoriteCardActions();trainerOrganizerState.username=username;renderInterimProductLabels();renderTrainerOrganizer();hideTrainerTagCreator();document.getElementById('organizer-status').textContent='';openModal('trainer-organizer-modal',{returnFocus});
}
function closeTrainerOrganizer(){hideTrainerTagCreator();closeModal('trainer-organizer-modal');}
function showTrainerTagCreator(){const row=document.getElementById('organizer-add-tag-row'),toggle=document.getElementById('organizer-new-tag-toggle');if(row)row.hidden=false;if(toggle)toggle.hidden=true;requestAnimationFrame(()=>document.getElementById('organizer-new-tag')?.focus());}
function hideTrainerTagCreator(){const row=document.getElementById('organizer-add-tag-row'),toggle=document.getElementById('organizer-new-tag-toggle'),input=document.getElementById('organizer-new-tag');if(row)row.hidden=true;if(toggle)toggle.hidden=false;if(input)input.value='';}
async function createLocalTrainerTag(){
  const input=document.getElementById('organizer-new-tag'),store=ensureTrainerHistoryStore(),status=document.getElementById('organizer-status');
  const authority=await accountSyncMutationAuthority();
  if(authority.mode==='blocked'){if(status)status.textContent=organizerMessage('saveFailed');return;}
  if(!accountSyncAuthorityCurrent(authority)){if(status)status.textContent=organizerMessage('saveFailed');return;}
  if(authority.mode==='canonical'){
    const label=String(input?.value||'').normalize('NFKC').trim().replace(/\s+/gu,' '),state=store?.read();
    if(!label){if(status)status.textContent=organizerMessage('tag-empty');return;}
    if(Array.from(label).length>40){if(status)status.textContent=organizerMessage('tag-too-long');return;}
    let tag=Object.values(state?.tags||{}).find(item=>item.label.normalize('NFKC').toLocaleLowerCase('en-US')===label.toLocaleLowerCase('en-US')),created=false;
    if(!tag){
      if(Object.keys(state?.tags||{}).length>=trainerHistoryStoreData.MAX_TAGS){if(status)status.textContent=organizerMessage('tag-limit');return;}
      const favorite=store.favoriteFor(trainerOrganizerState.username),id=accountSyncModel.newTagId(),patch=accountSyncProduct.favoriteTagPatch(favorite?.tagIds||[],[...(favorite?.tagIds||[]),id]);
      if(!favorite?.targetUid){if(status)status.textContent=organizerMessage('saveFailed');return;}
      const queued=await authority.controller.mutateBatch([
        {entityType:'tag',entityId:id,identity:{tagId:id},kind:'add',patch:{label}},
        {entityType:'favorite',entityId:favorite.targetUid,kind:'patch',patch}
      ]);
      if(!queued?.ok||!accountSyncAuthorityCurrent(authority)){if(status)status.textContent=organizerMessage('saveFailed');return;}
      tag={id,label};created=true;
    }
    const favorite=store.favoriteFor(trainerOrganizerState.username),saved=created?{ok:true}:await queueFavoriteTags(trainerOrganizerState.username,[...new Set([...(favorite?.tagIds||[]),tag.id])]);
    if(!saved?.ok){if(status)status.textContent=organizerMessage('saveFailed');return;}
    hideTrainerTagCreator();if(status)status.textContent=i18nCore.t(created?'organizer.tagCreated':'organizer.tagSelected');renderTrainerOrganizer();renderFavoriteBrowseResults();renderTrainerQuickLists();return;
  }
  const result=store?.ensureTag(input?.value||'');
  if(!result?.ok){if(status)status.textContent=organizerMessage(result?.code||'saveFailed');return;}
  const favorite=store.favoriteFor(trainerOrganizerState.username),saved=store.setFavoriteTags(trainerOrganizerState.username,[...new Set([...(favorite?.tagIds||[]),result.id])]);
  if(!saved.ok){if(status)status.textContent=organizerMessage(saved.code);return;}
  hideTrainerTagCreator();if(status)status.textContent=i18nCore.t(result.created?'organizer.tagCreated':'organizer.tagSelected');renderTrainerOrganizer();renderFavoriteBrowseResults();renderTrainerQuickLists();
}
function trainerTagInputKeydown(event){if(event.key==='Enter'){event.preventDefault();createLocalTrainerTag();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hideTrainerTagCreator();document.getElementById('organizer-new-tag-toggle')?.focus();document.getElementById('organizer-status').textContent='';}}
async function renameLocalTrainerTag(id){
  const input=document.getElementById(`organizer-tag-${id}`),store=ensureTrainerHistoryStore(),status=document.getElementById('organizer-status');
  const authority=await accountSyncMutationAuthority();
  if(authority.mode==='blocked'){if(status)status.textContent=organizerMessage('saveFailed');return;}
  if(!accountSyncAuthorityCurrent(authority)){if(status)status.textContent=organizerMessage('saveFailed');return;}
  let result;
  if(authority.mode==='canonical'){
    const label=String(input?.value||'').normalize('NFKC').trim().replace(/\s+/gu,' '),state=store?.read();
    if(!state?.tags?.[id])result={ok:false,code:'tag-missing'};
    else if(!label)result={ok:false,code:'tag-empty'};
    else if(Array.from(label).length>40)result={ok:false,code:'tag-too-long'};
    else if(Object.values(state.tags).some(tag=>tag.id!==id&&tag.label.normalize('NFKC').toLocaleLowerCase('en-US')===label.toLocaleLowerCase('en-US')))result={ok:false,code:'tag-duplicate'};
    else result=await authority.controller.patchEntity({entityType:'tag',entityId:id,patch:{label}});
  }else result=store?.renameTag(id,input?.value||'');
  if(!accountSyncAuthorityCurrent(authority)){if(status)status.textContent=organizerMessage('saveFailed');return;}
  if(!result?.ok){if(status)status.textContent=organizerMessage(result?.code||'saveFailed');return;}
  if(status)status.textContent=i18nCore.t('organizer.tagRenamed');renderTrainerOrganizer();renderFavoriteBrowseResults();renderTrainerQuickLists();
}
async function deleteLocalTrainerTag(id){
  const store=ensureTrainerHistoryStore(),tag=store?.read().tags[id];if(!tag||!confirm(i18nCore.t('organizer.deleteConfirm',{tag:tag.label})))return;
  const authority=await accountSyncMutationAuthority();
  if(authority.mode==='blocked'){const status=document.getElementById('organizer-status');if(status)status.textContent=organizerMessage('saveFailed');return;}
  if(!accountSyncAuthorityCurrent(authority)){const status=document.getElementById('organizer-status');if(status)status.textContent=organizerMessage('saveFailed');return;}
  const result=authority.mode==='canonical'?await authority.controller.deleteEntity({entityType:'tag',entityId:id}):store.deleteTag(id),status=document.getElementById('organizer-status');
  if(!accountSyncAuthorityCurrent(authority)){if(status)status.textContent=organizerMessage('saveFailed');return;}
  if(result.ok)trainerOrganizerState.tagIds=trainerOrganizerState.tagIds.filter(value=>value!==id);
  if(status)status.textContent=i18nCore.t(result.ok?'organizer.tagDeleted':'organizer.saveFailed');renderTrainerOrganizer();renderFavoriteBrowseResults();renderTrainerQuickLists();
}
function rememberTrainerOpened(username){
  const store=ensureTrainerHistoryStore();
  const snapshot=selectedTrainerRuntime.username===username?selectedTrainerRuntime.publicData?publicShareSnapshotFromRuntime(username):null:null;
  if(store&&snapshot)store.rememberOpened(username,snapshot);
}
function publicShareSnapshotFromRuntime(username){
  const data=selectedTrainerRuntime.publicData;if(!data?.users?.[username])return null;
  const lists={};PUBLIC_SHARE_TYPES.forEach(type=>{lists[type]={...(data[type]?.[username]||{})};});
  return{version:1,username,profile:{...data.users[username]},lists,updatedAt:data.users[username].lastUpdated||Date.now()};
}
function openTrainerByName(username){
  const input=document.getElementById('find-trainer-input');if(input)input.value=username;
  openTrainerPublicShare(username);
}
function publicShareRequestFromInput(value){
  const raw=String(value||'').trim();
  if(!raw)return null;
  const canonical=value=>Object.keys(allData.loginDirectory||{}).find(name=>trainerDiscoveryDomain.fold(name)===trainerDiscoveryDomain.fold(value))||String(value||'').trim();
  try{
    const url=new URL(raw,location.href);
    const username=url.searchParams.get('view');
    if(username)return{username:canonical(username),type:url.searchParams.get('list')||'wishlist'};
  }catch{}
  if(/[.#$\[\]\/]/.test(raw))return null;
  return{username:canonical(raw),type:'wishlist'};
}
function resolvedTrainerSearchValue(value){
  if(!requireCompatibleTrainerSearch())return'';
  const raw=String(value||'').trim();if(!raw)return raw;
  try{const url=new URL(raw,location.href);if(url.searchParams.get('view'))return raw;}catch{}
  return trainerDiscoveryDomain.bestTrainerSuggestion(Object.keys(allData.loginDirectory||{}),raw,trainerSuggestionOptions())?.name||raw;
}
async function openTrainerPublicShare(value){
  if(!requireCompatibleTrainerSearch())return;
  clearTimeout(trainerSuggestionTimer);
  const requested=value||document.getElementById('find-trainer-input')?.value;
  let resolved;
  try{resolved=resolvedTrainerSearchValue(requested);}
  catch(error){showTrainerSearchError();return;}
  const input=document.getElementById('find-trainer-input');
  if(input&&resolved&&!String(resolved).includes('?view='))input.value=resolved;
  closeTrainerSuggestions();
  const req=publicShareRequestFromInput(resolved);
  const status=document.getElementById('find-trainer-status');
  if(!req?.username){setTrainerRecovery(true);if(status)status.textContent=i18nCore.t('trainer.publicInvalid');return;}
  enterShareLoadingShell(req.username,req.type);
  if(status)status.textContent=i18nCore.t('data.loading',{resource:i18nCore.t('trainer.findTitle')});
  const requestGeneration=++_publicShareRequestGeneration;
  let loaded;
  try{loaded=await loadPublicShareData(req.username,{requestGeneration});}
  catch(error){if(requestGeneration===_publicShareRequestGeneration){renderUnavailableShareView(req.username,i18nCore.t('trainer.sharedReadFailed'));showTrainerSearchError(status);}return;}
  if(requestGeneration!==_publicShareRequestGeneration||loaded.status==='stale')return;
  if(loaded.ok&&allData.users?.[req.username]){setTrainerRecovery(false);rememberTrainerOpened(req.username);enterShareView(req.username,req.type);return;}
  setTrainerRecovery(true);renderUnavailableShareView(req.username,i18nCore.t(publicShareStatusMessageKey(loaded.status)));if(status)status.textContent=i18nCore.t(publicShareStatusMessageKey(loaded.status));
}
function renderSettings(){renderInterimProductLabels();configureSettingsPanel(_settingsContext);}
function showApp(){
  hidePreAuth();
  document.getElementById('login-pg').style.display='none';
  document.getElementById('config-pg').style.display='none';
  const app=document.getElementById('app');app.style.display='flex';app.style.flexDirection='column';
  // Set avatars with optional custom Pokemon
  const ud=allData.users?.[cur]||{};
  const ini=cur.slice(0,2).toUpperCase();
  ['top-av','my-av','account-menu-av','settings-account-av'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(ud.avatarPokemon){
      const found=avatarEntryForName(ud.avatarPokemon);
      if(found?.no){
        const img=_avatarImgHtml(found.no,found.name,found.catalogId);
        if(img){el.innerHTML=img;el.style.overflow='hidden';return;}
      }
    }
    el.textContent=ini;el.style.overflow='';
  });
  document.getElementById('top-un').textContent=cur;
  document.getElementById('my-un').textContent=cur;
  document.getElementById('account-menu-name').textContent=cur;
  document.getElementById('settings-account-name').textContent=cur;
  syncSpeedAddMode();
  ensureTrainerHistoryStore();
  const isAdmin=protectedOwnerSession();
  document.getElementById('admin-tab').style.display=isAdmin?'':'none';
  renderInterimProductLabels();
  const activeTab=document.querySelector('.tab.active')?.dataset.tab;
  const nextTab=activeTab&&(activeTab!=='admin'||isAdmin)&&activeTab!=='browse'?activeTab:'mylist';
  ensureProtectedSubscriptions();
  let finalTab=nextTab;
  switchTab(finalTab,{render:false});
  window.scrollTo(0,0);
  updateFcDisplay();
  buildAcItems();
  window.__pogoStartup.catalogsReadyAt=performance.now();
  window.__pogoStartup.signedInReadyAt=performance.now();
  try{performance.mark('pogo:signed-in-ready')}catch{}
  if(isAdmin)ensureLoginDirectoryPublished();
  checkWhatsNew();
  attachPullToRefresh();
  initAddAdvanced();
  // Subscribe to my own pending-decrements queue (counterparties' trade-accepts)
  subscribeMyPendingDecrements();
  // First-time user tour (#25)
  maybeStartTour();
  // PWA shortcut handling: deep-link via ?action=add|browse|strings
  const params=new URLSearchParams(location.search);
  const action=params.get('action');
  if(action==='add'){finalTab='mylist';switchTab(finalTab,{render:false});setTimeout(()=>document.getElementById('ac-input')?.focus(),100);}
  else if(action==='strings'){finalTab='mylist';switchTab(finalTab,{render:false});setTimeout(()=>document.getElementById('my-strings-out')?.scrollIntoView({behavior:'smooth'}),100);}
  else if(action==='browse'){finalTab='find';switchTab(finalTab,{render:false});}
  else if(action==='have'){finalTab='have';switchTab(finalTab,{render:false});}
  else if(action==='schedule'){finalTab='schedule';switchTab(finalTab,{render:false});}
  else if(action==='settings'){history.replaceState({},'',settingsRouteUrl(true));}
  if(action&&action!=='settings'){history.replaceState({},'',location.pathname);}
  renderActiveTab(finalTab);
  if(action==='settings'||parseSettingsRoute().matches)setTimeout(()=>syncSettingsRoute({captureScroll:false}),0);
  // Apply user's chosen wallpaper
  applyWallpaperForTheme(allData.users?.[cur]?.wallpaper||'');
  // Fetch live Pokémon GO events in the background, then refresh only visible surfaces.
  fetchPogoEvents().then(()=>{
    renderEventBanner();
    const tab=activeTabName();
    if(tab==='schedule')renderSchedule();
  });
  // Bump last-seen so admins know the user opened the app (not just edited)
  bumpLastSeen();
}
const renderFrame=window.requestAnimationFrame?.bind(window)||((fn)=>setTimeout(fn,0));
const cancelRenderFrame=window.cancelAnimationFrame?.bind(window)||clearTimeout;
let activeTabRenderHandle=0;
function activeTabName(){
  const activePage=document.querySelector('.page.active')?.id?.replace(/^tab-/,'');
  return activePage||document.querySelector('.tab.active')?.dataset.tab||'mylist';
}
function renderActiveTab(t=activeTabName()){
  if(!cur)return;
  if(t==='mylist')renderMyList();
  else if(t==='find')renderFindTrainer();
  else if(t==='have')renderMyHave();
  else if(t==='schedule')renderSchedule();
  else if(t==='admin'&&protectedOwnerSession()){
    startLegacyAdminReads();
    renderAdmin();renderPendingRequests();renderBackupReminder();
  }
}
function queueRenderActiveTab(t=activeTabName()){
  if(activeTabRenderHandle)cancelRenderFrame(activeTabRenderHandle);
  activeTabRenderHandle=renderFrame(()=>{
    activeTabRenderHandle=0;
    renderActiveTab(t);
  });
}
let refreshAllHandle=0;
function queueRefreshAll(reason=''){
  void reason;
  if(refreshAllHandle)return;
  refreshAllHandle=renderFrame(()=>{
    refreshAllHandle=0;
    refreshAll();
  });
}
function refreshBadgesAndLightChrome(){
  checkWhatsNew();
}
function switchTab(t,opts={}){
  const previous=activeTabName();
  if(t==='settings'){openSettingsPanel('account');return;}
  if(t==='admin'&&!protectedOwnerSession())t='mylist';
  if(t==='browse')t='find';
  if(previous==='admin'&&t!=='admin')stopLegacyAdminReads('admin_closed');
  document.querySelectorAll('.tab').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-selected','false');});
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const tabBtn=document.querySelector(`[data-tab="${t}"]`);
  const page=document.getElementById(`tab-${t}`);
  if(!page)return;
  if(tabBtn){tabBtn.classList.add('active');tabBtn.setAttribute('aria-selected','true');}
  page.classList.add('active');
  window.scrollTo(0,0);
  if(opts.render!==false)queueRenderActiveTab(t);
}
function openLegacyInventoryTool(){closeAccountMenu(false);switchTab('have');}
function refreshAll(){
  if(!cur)return;
  const switcher=document.getElementById('member-community-switcher');
  if(switcher)switcher.innerHTML='';
  renderActiveTab();
  refreshBadgesAndLightChrome();
  if(protectedOwnerSession()){
    if(activeTabName()==='admin')renderBackupReminder();
    ensureLoginDirectoryPublished();
  }
}

// ── FRESHNESS ─────────────────────────────────────────────────
function userBadge(x){
  const lu=allData.users?.[x.user]?.lastUpdated;
  const shinyPart=x.shiny?' · ✨ shiny only':'';
  const backgroundPart=x.backgroundId?` · ${backgroundDisplayName(x.backgroundId)} background`:'';
  return`<span class="badge ${x.p}" title="${x.user} · ${priLabel(x.p)} priority${shinyPart}${backgroundPart} · Updated ${freshnessLabel(lu)}">
    <span class="prio-mark">${x.p}</span>${x.user}${x.lucky?'<span class="lucky-mark">⚡</span>':''}${x.shiny?'<span class="shiny-mark">✨</span>':''}${x.xxl?'<span class="flag-mark xxl-mark">XXL</span>':''}${x.xxs?'<span class="flag-mark xxs-mark">XXS</span>':''}${x.backgroundId?`<span class="flag-mark">${escHtml(backgroundShortLabel(x.backgroundId))} BG</span>`:''}${x.mod?`<span class="mod"> ${x.mod}</span>`:''}
  </span>`;
}

// ── AUTOCOMPLETE ──────────────────────────────────────────────
function pokemonDisplayName(entry){
  return pokemonNamesI18n.displayName(entry,{locale:i18nCore.getLocale()});
}
function pokemonSearchLabels(entry){
  return pokemonNamesI18n.searchLabels(entry,{locale:i18nCore.getLocale()});
}
function pokemonEntryForLegacyKey(entries,name){
  return pokemonCatalogDomain.entryForLegacyKey(entries,name);
}
function pokemonListValueForCanonicalName(list,name){
  const target=pokemonCatalogDomain.catalogKey(name);
  for(const [key,value] of Object.entries(list||{}))if(pokemonCatalogDomain.catalogKey(key)===target)return value;
  return undefined;
}
function addPokemonEntryAliases(entry,dispMap,noMap){
  const label=pokemonDisplayName(entry);
  (entry.legacyAliases||[entry.name]).forEach(alias=>{dispMap[alias]=label;if(entry.no)noMap[alias]=entry.no;});
}
function localizedPokemonEntry(entry){
  return{...entry,dn:pokemonDisplayName(entry)};
}
function comparePokemonLabels(a,b){
  return new Intl.Collator(i18nCore.getLocale(),{numeric:true,sensitivity:'base'}).compare(String(a||''),String(b||''));
}
function buildAcItems(){
  const arr=listSource(myListType);
  const existing=new Set(Object.keys(allData[myListType]?.[cur]||{}).map(pokemonCatalogDomain.catalogKey));
  const seen=new Set();acItems=[];
  arr.forEach(e=>{
    const key=e.catalogId||pokemonCatalogDomain.catalogKey(e.name);
    if(existing.has(key)||seen.has(key))return;
    seen.add(key);
    const item={name:e.name,dn:pokemonDisplayName(e),no:e.no||null,spriteUrl:entrySpriteUrl(e,e.name),catalogId:key,legacyAliases:e.legacyAliases,searchAliases:e.searchAliases};
    item.search=normalizeAcText(pokemonSearchLabels(e).join(' '));
    acItems.push(item);
  });
}
function closeAddAutocomplete(){
  const input=document.getElementById('ac-input'),dd=document.getElementById('ac-dropdown');
  dd?.classList.remove('open');
  if(input){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  acFocusIdx=-1;
}
function acSearch(q){
  const input=document.getElementById('ac-input');
  document.getElementById('add-pmon-sel').value='';
  const dd=document.getElementById('ac-dropdown');
  if(!q||q.length<1){closeAddAutocomplete();return;}
  const arr=listSource(myListType);
  const existing=new Set(Object.keys(allData[myListType]?.[cur]||{}).map(pokemonCatalogDomain.catalogKey));
  acFiltered=rankAutocompleteItems(acItems,q);
  const existingItems=arr
    .filter(e=>existing.has(e.catalogId||pokemonCatalogDomain.catalogKey(e.name)))
    .map(e=>{
      const item={name:e.name,dn:pokemonDisplayName(e),no:e.no||null,spriteUrl:entrySpriteUrl(e,e.name),catalogId:e.catalogId,legacyAliases:e.legacyAliases,searchAliases:e.searchAliases};
      item.search=normalizeAcText(pokemonSearchLabels(e).join(' '));
      return item;
    });
  const existingMatches=rankAutocompleteItems(existingItems,q,{limit:6});
  acFocusIdx=-1;
  // Detect if user is searching for a Pokemon family with multiple variants
  const family=detectVariantFamily(q);
  const remainingVariantCount=family?familyVariantEntries(family.key).filter(e=>!Object.prototype.hasOwnProperty.call(allData[myListType]?.[cur]||{},e.name)).length:0;
  const familyBanner=(family&&remainingVariantCount>1)
    ?`<div class="ac-family-banner" onmousedown="event.preventDefault();openAddAllVariantsModal('${family.key}')" role="button" tabindex="0">
        <span style="flex:1">✨ Add all <strong>${remainingVariantCount}</strong> remaining ${escHtml(family.label)} variants</span>
        <span style="font-size:11px;color:var(--accent);font-weight:700">→</span>
      </div>`
    :'';
  const shownBanner=acFiltered.length>1
    ?`<div class="ac-family-banner" onmousedown="event.preventDefault();openAddShownResultsModal()" role="button" tabindex="0">
        <span style="flex:1">⚡ Add all <strong>${acFiltered.length}</strong> shown results</span>
        <span style="font-size:11px;color:var(--accent);font-weight:700">→</span>
      </div>`
    :'';
  const existingSection=existingMatches.length
    ?`<div class="ac-section-label">Already On Your List</div>${existingMatches.map(e=>`
      <div class="ac-item-muted">
        ${e.no||e.spriteUrl?spriteImg(e.no,28,'ac-item-sprite',e.name,'',e.dn,{urlOverride:e.spriteUrl}):''}
        ${e.no?`<span class="ac-item-no">#${e.no}</span>`:''}
        <span class="ac-item-name">${e.dn}</span>
        <span class="ac-item-note">added</span>
      </div>`).join('')}`
    :'';
  if(!acFiltered.length&&!familyBanner&&!existingSection){
    dd.innerHTML=`<div class="ac-empty">${escHtml(i18nCore.t('common.noResults'))}</div>`;
  }else{
    dd.innerHTML=familyBanner+shownBanner+acFiltered.map((e,i)=>`
      <div class="ac-item" id="add-pokemon-option-${i}" role="option" aria-selected="false" data-idx="${i}" onmousedown="acSelect(${i})">
        ${e.no||e.spriteUrl?spriteImg(e.no,28,'ac-item-sprite',e.name,'',e.dn,{urlOverride:e.spriteUrl}):''}
        ${e.no?`<span class="ac-item-no">#${e.no}</span>`:''}
        <span class="ac-item-name">${e.dn}</span>
        <button type="button" class="ac-tray-btn ${isInAddTray(e.name)?'on':''}" title="${isInAddTray(e.name)?'Already queued':'Queue without closing search'}" onmousedown="event.preventDefault();event.stopPropagation();addToTrayFromAc(${i})">${isInAddTray(e.name)?'✓':'+'}</button>
      </div>`).join('')+existingSection;
  }
  dd.classList.add('open');
  input?.setAttribute('aria-expanded','true');
  input?.removeAttribute('aria-activedescendant');
}
function acSelect(idx){
  const e=acFiltered[idx];if(!e)return;
  document.getElementById('ac-input').value=e.dn;
  document.getElementById('add-pmon-sel').value=e.name;
  closeAddAutocomplete();
}
function acKeydown(ev){
  const dd=document.getElementById('ac-dropdown');
  if(!dd.classList.contains('open'))return;
  if(ev.key==='ArrowDown'){ev.preventDefault();acFocusIdx=Math.min(acFocusIdx+1,acFiltered.length-1);acUpdateFocus();}
  else if(ev.key==='ArrowUp'){ev.preventDefault();acFocusIdx=Math.max(acFocusIdx-1,0);acUpdateFocus();}
  else if(ev.key==='Enter'){ev.preventDefault();if(acFocusIdx>=0)acSelect(acFocusIdx);else if(acFiltered.length===1)acSelect(0);}
  else if(ev.key==='Escape'){ev.preventDefault();closeAddAutocomplete();}
}
function acUpdateFocus(){
  const input=document.getElementById('ac-input');
  document.querySelectorAll('#ac-dropdown .ac-item[role="option"]').forEach((el,i)=>{
    const active=i===acFocusIdx;
    el.classList.toggle('focused',active);
    el.setAttribute('aria-selected',String(active));
    if(active){input?.setAttribute('aria-activedescendant',el.id);el.scrollIntoView({block:'nearest'});}
  });
}
function isInAddTray(name){return addTray.some(x=>x.name===name);}
function addToTrayFromAc(idx){
  const e=acFiltered[idx];if(!e?.name)return;
  const existing=allData[myListType]?.[cur]||{};
  if(existing[e.name]){toast(i18nCore.t('myList.alreadyListed'));return;}
  if(isInAddTray(e.name)){toast(i18nCore.t('myList.alreadyQueued'));return;}
  addTray.push({name:e.name,dn:e.dn||e.name,no:e.no||null,spriteUrl:e.spriteUrl||''});
  renderAddTray();
  acSearch(document.getElementById('ac-input')?.value||'');
}
function removeFromAddTray(idx){
  addTray.splice(idx,1);
  renderAddTray();
  const q=document.getElementById('ac-input')?.value||'';
  if(q)acSearch(q);
}
function clearAddTray(){
  addTray=[];
  renderAddTray();
  const q=document.getElementById('ac-input')?.value||'';
  if(q)acSearch(q);
}
function renderAddTray(){
  const el=document.getElementById('add-tray');if(!el)return;
  const existing=allData[myListType]?.[cur]||{};
  addTray=addTray.filter(x=>x?.name&&!existing[x.name]);
  if(!addTray.length){el.hidden=true;el.innerHTML='';return;}
  const pri=document.getElementById('add-pmon-pri')?.value||'';
  const flags=currentAddFlags();
  const flagText=[
    pri?priName(pri):'choose H/M/L',
    flags.lucky?'⚡':'',
    flags.shiny?'✨':'',
    flags.xxl?'XXL':'',
    flags.xxs?'XXS':'',
    flags.notes?'notes':'',
    flags.backgroundId?`${backgroundShortLabel(flags.backgroundId)} BG`:''
  ].filter(Boolean).join(' · ');
  el.hidden=false;
  el.innerHTML=`
    <div class="add-tray-head">
      <span class="add-tray-title">Queue · ${addTray.length}</span>
      <span>${escHtml(flagText)}</span>
    </div>
    <div class="add-tray-chips">
      ${addTray.map((e,i)=>`<span class="add-tray-chip" title="${escAttr(e.dn||e.name)}">
        ${e.no||e.spriteUrl?spriteImg(e.no,18,'',e.name,'',e.dn||e.name,{urlOverride:e.spriteUrl}):''}
        <span>${escHtml(e.dn||e.name)}</span>
        <button type="button" class="add-tray-remove" onclick="removeFromAddTray(${i})" aria-label="${escAttr(i18nCore.t('myList.removeEntry',{name:e.dn||e.name}))}">×</button>
      </span>`).join('')}
    </div>
    <div class="add-tray-actions">
      <button type="button" onclick="clearAddTray()">${escHtml(i18nCore.t('common.clear'))}</button>
      <button type="button" class="primary" onclick="confirmAddTray()">${escHtml(i18nCore.t('myList.addQueue'))}</button>
    </div>`;
}
async function confirmAddTray(){
  if(!addTray.length){toast(i18nCore.t('myList.queueEmpty'));return;}
  const pri=document.getElementById('add-pmon-pri')?.value||'';
  const flags=currentAddFlags();
  if(!pri&&!flags.lucky&&!flags.xxl&&!flags.xxs&&!flags.shiny&&!flags.backgroundId){toast(i18nCore.t('myList.queueNeedsPriority'));return;}
  const list={...(allData[myListType]?.[cur]||{})};
  let added=0;
  addTray.forEach(e=>{
    if(!e?.name||list[e.name])return;
    list[e.name]=priValue(pri,flags.notes,flags.lucky,flags.xxl,flags.xxs,flags.shiny,flags.backgroundId);
    added++;
  });
  if(!added){clearAddTray();toast(i18nCore.t('myList.nothingNew'));return;}
  if(!await writeList(myListType,cur,list))return;
  addTray=[];
  renderAddTray();
  document.getElementById('add-pmon-sel').value='';
  closeAddAutocomplete();
  buildAcItems();
  renderMyList();
  toast(i18nCore.t('myList.queueAdded',{count:i18nCore.formatNumber(added)}));
}
let _backgroundPickerContext=null;
let _backgroundPickerFilter='relevant';
let _backgroundPickerResults=[];
let _backgroundPickerFocus=-1;
let _backgroundPickerReturnFocus=null;
let _backgroundPickerVisibleLimit=80;
const _recentBackgroundIds=[];
function backgroundRecord(id){return backgroundCatalogDomain.get(id);}
function backgroundDisplayName(id){return backgroundCatalogDomain.display(id)||id||'';}
function backgroundShortLabel(id){return backgroundCatalogDomain.shortLabel(id)||id||'';}
function backgroundVisual(id){return id?backgroundVisualDomain.resolve(id):null;}
function backgroundVisualClass(id){return backgroundVisualDomain.className(backgroundVisual(id));}
function backgroundVisualAttrs(id){
  const visual=backgroundVisual(id);
  return visual?`data-background-artwork-id="${escAttr(visual.id)}" style="${escAttr(backgroundVisualDomain.style(visual))}"`:'';
}
function backgroundVisualMotifHtml(id,cls='background-card-motif'){
  const visual=backgroundVisual(id);
  if(!visual)return'';
  return`<span class="${cls} ${backgroundVisualDomain.className(visual)}" ${backgroundVisualAttrs(id)} aria-hidden="true"></span>`;
}
function backgroundBadgeHtml(id,cls='background-badge'){
  if(!id)return'';
  const full=backgroundDisplayName(id),short=backgroundShortLabel(id),visual=backgroundVisual(id);
  return`<span class="${cls} background-visual-label ${backgroundVisualClass(id)}" ${backgroundVisualAttrs(id)} title="${escAttr(full)}" aria-label="${escAttr(i18nCore.t('background.badgeLabel',{name:full}))}">${visual?'<span class="background-visual-swatch" aria-hidden="true"></span>':''}<span class="background-visual-name">${escHtml(short)}</span><span class="background-badge-kind" aria-hidden="true">BG</span></span>`;
}
function updateAddBackgroundPresentation(){
  const id=normalizeBackgroundId(document.getElementById('add-pmon-background')?.value);
  const button=document.getElementById('add-background-trigger'),copy=button?.querySelector('.background-trigger-copy'),cue=button?.querySelector('.background-trigger-clear');
  if(copy)copy.textContent=id?backgroundDisplayName(id):i18nCore.t('background.none');
  if(cue)cue.textContent=id?i18nCore.t('common.change'):i18nCore.t('background.choose');
  if(button)button.setAttribute('aria-label',id?i18nCore.t('background.selected',{name:backgroundDisplayName(id)}):i18nCore.t('background.none'));
}
function backgroundContextPokemonName(){
  const context=_backgroundPickerContext||{};
  if(context.pokemonName)return context.pokemonName;
  if(context.target==='add')return document.getElementById('add-pmon-sel')?.value||document.getElementById('ac-input')?.value||'';
  return context.name||'';
}
function backgroundContextCurrentId(){
  const context=_backgroundPickerContext||{};
  if(context.target==='add')return normalizeBackgroundId(document.getElementById('add-pmon-background')?.value);
  if(context.target==='entry')return parsePri(allData[myListType]?.[cur]?.[context.name]||'').backgroundId;
  return'';
}
function openBackgroundPicker(context){
  _backgroundPickerContext={...context};
  _backgroundPickerReturnFocus=document.activeElement;
  _backgroundPickerFilter='relevant';_backgroundPickerFocus=-1;_backgroundPickerVisibleLimit=80;
  const input=document.getElementById('background-search-input');if(input)input.value='';
  const forLabel=document.getElementById('background-picker-for'),pokemon=backgroundContextPokemonName();
  if(forLabel)forLabel.textContent=pokemon?i18nCore.t('background.forPokemon',{name:pokemon}):'';
  document.getElementById('background-picker-modal')?.classList.add('open');
  renderBackgroundPicker();
  requestAnimationFrame(()=>input?.focus());
}
function closeBackgroundPicker(){
  document.getElementById('background-picker-modal')?.classList.remove('open');
  const focus=_backgroundPickerReturnFocus;_backgroundPickerReturnFocus=null;_backgroundPickerContext=null;
  if(focus?.isConnected)requestAnimationFrame(()=>focus.focus({preventScroll:true}));
}
function backgroundSearchChanged(){_backgroundPickerFocus=-1;_backgroundPickerVisibleLimit=80;renderBackgroundPicker();}
function setBackgroundFilter(filter){_backgroundPickerFilter=filter;_backgroundPickerFocus=-1;_backgroundPickerVisibleLimit=80;renderBackgroundPicker();}
function showMoreBackgrounds(){_backgroundPickerVisibleLimit+=80;renderBackgroundPicker();}
function renderBackgroundPicker(){
  if(!_backgroundPickerContext)return;
  const searchInput=document.getElementById('background-search-input'),query=searchInput?.value||'',pokemon=backgroundContextPokemonName();
  let records=backgroundCatalogDomain.search(query,{pokemonName:pokemon,limit:500});
  if(_backgroundPickerFilter==='relevant'){
    const relevant=records.filter(record=>backgroundCatalogDomain.isRelevant(record,pokemon));
    if(relevant.length)records=relevant;
  }else if(_backgroundPickerFilter==='location'||_backgroundPickerFilter==='special')records=records.filter(record=>record.type===_backgroundPickerFilter);
  else if(_backgroundPickerFilter==='recent')records=records.filter(record=>_recentBackgroundIds.includes(record.id)).sort((a,b)=>_recentBackgroundIds.indexOf(a.id)-_recentBackgroundIds.indexOf(b.id));
  _backgroundPickerResults=records;_backgroundPickerFocus=Math.min(_backgroundPickerFocus,records.length-1);
  document.querySelectorAll('[data-background-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.backgroundFilter===_backgroundPickerFilter)));
  const recentButton=document.querySelector('[data-background-filter="recent"]');if(recentButton)recentButton.hidden=!_recentBackgroundIds.length;
  const selected=backgroundContextCurrentId(),out=document.getElementById('background-results'),visible=records.slice(0,_backgroundPickerVisibleLimit);if(!out)return;
  const count=document.getElementById('background-results-count'),more=document.getElementById('background-show-more');
  if(count)count.textContent=i18nCore.t('background.showing',{visible:i18nCore.formatNumber(visible.length),total:i18nCore.formatNumber(records.length)});
  if(more)more.hidden=visible.length>=records.length;
  if(!records.length){searchInput?.removeAttribute('aria-activedescendant');out.innerHTML=`<div class="background-empty">${escHtml(i18nCore.t('background.noResults'))}</div>`;return;}
  let lastGroup='';
  out.innerHTML=visible.map((record,index)=>{
    const relevant=backgroundCatalogDomain.isRelevant(record,pokemon);
    const knownIncompatible=!!pokemon&&record.pokemon.length>0&&!relevant;
    const group=relevant?i18nCore.t('background.relevant'):i18nCore.t(record.type==='location'?'background.location':'background.special');
    const heading=group!==lastGroup?`<div class="background-result-group">${escHtml(group)}</div>`:'';lastGroup=group;
    const eligibility=knownIncompatible?i18nCore.t('background.notListed',{name:pokemon}):'';
    const meta=[record.event,record.location,record.availability,eligibility].filter(Boolean).filter((value,i,array)=>array.indexOf(value)===i).join(' · ');
    return`${heading}<button type="button" class="background-option${knownIncompatible?' incompatible':''}${index===_backgroundPickerFocus?' focused':''}" id="background-option-${index}" data-bg-option="${index}" role="option" aria-selected="${selected===record.id}" onclick="selectBackground('${escAttr(record.id)}')"><span class="background-option-main"><span class="background-option-name">${escHtml(record.displayName)}</span><span class="background-option-meta">${escHtml(meta)}</span></span><span class="background-option-year">${record.year||''}</span></button>`;
  }).join('');
  if(_backgroundPickerFocus>=0&&_backgroundPickerFocus<visible.length)searchInput?.setAttribute('aria-activedescendant',`background-option-${_backgroundPickerFocus}`);
  else searchInput?.removeAttribute('aria-activedescendant');
}
function backgroundPickerKeydown(event){
  if(event.key==='Escape'){event.preventDefault();closeBackgroundPicker();return;}
  if(event.key!=='ArrowDown'&&event.key!=='ArrowUp'&&event.key!=='Enter')return;
  if(event.key==='Enter'){
    if(_backgroundPickerFocus>=0&&_backgroundPickerResults[_backgroundPickerFocus]){event.preventDefault();selectBackground(_backgroundPickerResults[_backgroundPickerFocus].id);}
    return;
  }
  event.preventDefault();
  if(!_backgroundPickerResults.length)return;
  _backgroundPickerFocus=event.key==='ArrowDown'?Math.min(_backgroundPickerFocus+1,_backgroundPickerResults.length-1):Math.max(_backgroundPickerFocus<0?_backgroundPickerResults.length-1:_backgroundPickerFocus-1,0);
  if(_backgroundPickerFocus>=_backgroundPickerVisibleLimit)_backgroundPickerVisibleLimit+=80;
  renderBackgroundPicker();
  document.getElementById(`background-option-${_backgroundPickerFocus}`)?.scrollIntoView({block:'nearest'});
}
function selectBackground(value){
  const id=normalizeBackgroundId(value),context=_backgroundPickerContext;if(!context)return;
  if(id){const index=_recentBackgroundIds.indexOf(id);if(index>=0)_recentBackgroundIds.splice(index,1);_recentBackgroundIds.unshift(id);_recentBackgroundIds.splice(8);}
  if(context.target==='add'){
    const hidden=document.getElementById('add-pmon-background');if(hidden)hidden.value=id;
    updateAddBackgroundPresentation();renderAddTray();
  }else if(context.target==='entry')setBackground(context.name,id);
  closeBackgroundPicker();
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.ac-wrap')){
    closeAddAutocomplete();
    // Also close the special-board LF/FT autocompletes
    document.getElementById('special-lf-dd')?.classList.remove('open');
    document.getElementById('special-ft-dd')?.classList.remove('open');
  }
});

// ── UNDO ──────────────────────────────────────────────────────
function showUndo(name){
  clearTimeout(undoTimer);
  const toastEl=document.getElementById('undo-toast');
  const message=i18nCore.t('myList.removed',{name});
  document.getElementById('undo-msg').textContent=message;
  undoReturnFocus=document.activeElement instanceof HTMLElement&&!toastEl.contains(document.activeElement)?document.activeElement:null;
  toastEl.hidden=false;
  toastEl.setAttribute('aria-hidden','false');
  toastEl.classList.add('show');
  announceFeedback(`${message} ${i18nCore.t('common.undo')}`);
  undoTimer=setTimeout(()=>{
    hideUndo({restoreFocus:true});
    undoStack=null;
  },4000);
}
function hideUndo({restoreFocus=false}={}){
  const toastEl=document.getElementById('undo-toast');
  const focusWasInside=!!toastEl?.contains(document.activeElement);
  toastEl?.classList.remove('show');
  toastEl?.setAttribute('aria-hidden','true');
  if(toastEl)toastEl.hidden=true;
  const fallback=undoReturnFocus?.isConnected&&!undoReturnFocus.disabled?undoReturnFocus:document.getElementById('mylist-filter')||document.getElementById('ac-input');
  undoReturnFocus=null;
  if(restoreFocus&&focusWasInside)requestAnimationFrame(()=>fallback?.focus({preventScroll:true}));
}
async function doUndo(){
  if(!undoStack)return;
  const restored=undoStack;
  if(!await writeList(restored.type,restored.username,restored.list))return;
  clearTimeout(undoTimer);
  hideUndo({restoreFocus:true});
  toast(i18nCore.t('myList.restored',{name:restored.name}));
  undoStack=null;
}

// ── FRIEND CODE VALIDATION (fix) ─────────────────────────────
function formatFc(input){
  // Strip non-digits
  let digits=input.value.replace(/\D/g,'').slice(0,12);
  // Format as XXXX XXXX XXXX
  let formatted=digits.match(/.{1,4}/g)?.join(' ')||digits;
  input.value=formatted;
  const hint=document.getElementById('fc-hint');
  if(hint){
    if(digits.length===0)hint.textContent='';
    else if(digits.length<12)hint.textContent=i18nCore.t('profile.friendCodeDigitsRemaining',{count:i18nCore.formatNumber(12-digits.length)});
    else hint.textContent=i18nCore.t('profile.friendCodeValid');
    hint.style.color=digits.length===12?'var(--ok)':'var(--muted)';
  }
}
function validateFc(fc){
  return fc===''||fc.replace(/\s/g,'').length===12;
}

// ── BROWSE ────────────────────────────────────────────────────
function setFilter(f){
  browseFilter=f;
  document.querySelectorAll('.fbtn:not(.flag-filter)').forEach(b=>{b.classList.remove('on');b.setAttribute('aria-pressed','false');});
  document.querySelectorAll('.fbtn.f'+f).forEach(b=>{b.classList.add('on');b.setAttribute('aria-pressed','true');});
  renderBrowse();
}
function setBrowseList(t){
  browseList=t;
  document.querySelectorAll('#browse-list-tabs-inline .ltab').forEach((b,i)=>{
    const active=['wishlist','dynamax','gmax','costumes'][i]===t;
    b.classList.toggle('active',active);
    b.setAttribute('aria-pressed',active?'true':'false');
  });
  ensureListSubscribed(t);
  renderBrowse();
}
function setStaleFilter(days){
  staleFilter=days;
  document.querySelectorAll('.sfbtn').forEach(b=>{b.classList.remove('on');b.setAttribute('aria-pressed','false');});
  const tgt=document.querySelector(`.sfbtn[data-days="${days}"]`);
  if(tgt){tgt.classList.add('on');tgt.setAttribute('aria-pressed','true');}
  renderBrowse();
}
function activeUsers(){
  if(!staleFilter)return null;
  const cutoff=Date.now()-staleFilter*86400000;
  return new Set(Object.entries(allData.users||{}).filter(([,d])=>d.lastUpdated&&d.lastUpdated>cutoff).map(([u])=>u));
}

function renderBrowse(){return perfTime('render:browse',()=>_renderBrowseInner());}
function _renderBrowseInner(){
  const q=normalizeAcText(document.getElementById('bq')?.value||'');
  const el=document.getElementById('browse-out');if(!el)return;
  const allowed=browseAllowedUsers();
  renderOwnerBrowsePreviewBanner(allowed);

  if(browseList==='costumes'){
    const map={};
    allCostumeEntries().forEach(e=>{map[e.name]=[];});
    Object.entries(allData.costumes||{}).forEach(([user,list])=>{
      if(!list||allowed&&!allowed.has(user))return;
      Object.entries(list).forEach(([name,val])=>{
        if(!map[name])map[name]=[];
        const{p,mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(val);if(p||lucky||xxl||xxs||shiny||backgroundId)map[name].push({user,p,mod,lucky,xxl,xxs,shiny,backgroundId});
      });
    });
    const results=allCostumeEntries().filter(e=>{
      let ents=browseFilter==='ALL'?map[e.name]:(map[e.name]||[]).filter(x=>x.p===browseFilter);
      ents=(ents||[]).filter(entryMatchesFlagFilters);
      if(!ents.length)return false;
      if(!q)return true;
      return normalizeAcText(pokemonSearchLabels(e).join(' ')).includes(q)||ents.some(x=>x.user.toLowerCase().includes(q)||normalizeAcText(backgroundDisplayName(x.backgroundId)).includes(q));
    });
    if(!results.length){el.innerHTML=emptyHtml(i18nCore.t('browse.noOtherMatches'),i18nCore.t('browse.tryFilters'));return;}
    el.innerHTML=`<div class="pgrid">${results.map(e=>{
      let ents=map[e.name]||[];if(browseFilter!=='ALL')ents=ents.filter(x=>x.p===browseFilter);
      ents=ents.filter(entryMatchesFlagFilters);
      ents=sortEntries(ents);
      const eventPill=eventBadgeForPokemon(e.name,e.no,_eventData);
      const display=pokemonDisplayName(e);
      return`<div class="pc" data-dex="${e.no||''}"><div class="pc-hdr"><span class="pc-sprite-wrap">${spriteImg(e.no,42,'pc-sprite',e.name,'',display,{urlOverride:e.spriteUrl,scaleCap:1})}</span><div class="pc-info"><div class="pc-name">${escHtml(display)}${eventPill}</div><div class="pc-no">#${e.no}</div></div></div>
        <div class="pc-users">${ents.map(x=>userBadge(x)).join('')}</div></div>`;
    }).join('')}</div>`;
    applyTypeColors();
    return;
  }

  const dataArr=listSource(browseList);
  const map={};
  dataArr.forEach(e=>{if(!map[e.name])map[e.name]={no:e.no,dn:pokemonDisplayName(e),maxType:maxTypeForEntry(e,browseList),entries:[]};});
  Object.entries(allData[browseList]||{}).forEach(([user,list])=>{
    if(!list||allowed&&!allowed.has(user))return;
    Object.entries(list).forEach(([name,val])=>{
      if(!map[name])map[name]={no:'?',dn:name,entries:[]};
      const{p,mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(val);if(p||lucky||xxl||xxs||shiny||backgroundId)map[name].entries.push({user,p,mod,lucky,xxl,xxs,shiny,backgroundId});
    });
  });
  const seen=new Set();
  const results=dataArr.filter(e=>{
    if(seen.has(e.name))return false;seen.add(e.name);
    const info=map[e.name];if(!info)return false;
    let ents=browseFilter==='ALL'?info.entries:info.entries.filter(x=>x.p===browseFilter);
    ents=ents.filter(entryMatchesFlagFilters);
    if(!ents.length)return false;
    if(!q)return true;
    return normalizeAcText(pokemonSearchLabels(e).join(' ')).includes(q)||String(e.no||'').includes(q)||ents.some(x=>x.user.toLowerCase().includes(q)||normalizeAcText(backgroundDisplayName(x.backgroundId)).includes(q));
  });
  if(!results.length){el.innerHTML=emptyHtml(i18nCore.t('browse.noMatches'),i18nCore.t('browse.tryFilters'));return;}
  el.innerHTML=`<div class="pgrid">${results.map(e=>{
    const info=map[e.name];
    let ents=info.entries;if(browseFilter!=='ALL')ents=ents.filter(x=>x.p===browseFilter);
    ents=ents.filter(entryMatchesFlagFilters);
    ents=sortEntries(ents);
    const crownHtml=maxCrownSvg(maxTypeForEntry(info,browseList));
    const eventPill=eventBadgeForPokemon(e.name,e.no,_eventData);
    return`<div class="pc" data-dex="${e.no||''}">
      <div class="pc-hdr">
        <span class="pc-sprite-wrap">${spriteImg(e.no,42,'pc-sprite',e.name,'',info.dn,{urlOverride:e.spriteUrl,scaleCap:1})}${crownHtml}</span>
        <div class="pc-info"><div class="pc-name">${escHtml(info.dn)}${eventPill}</div><div class="pc-no">#${e.no}</div></div>
      </div>
      <div class="pc-users">${ents.map(x=>userBadge(x)).join('')}</div>
    </div>`;
  }).join('')}</div>`;
  applyTypeColors();
}

// ── MY LIST ───────────────────────────────────────────────────
function resetMyListCategoryForAccountBoundary(){
  myListType='wishlist';
  addTray=[];
  myListCollapsedPrioritySections.clear();
  resetMyListPerformanceState();
}
function resetMyListPerformanceState(){
  clearTimeout(myListFilterTimer);
  myListFilterTimer=0;
  myListFilterGeneration++;
  myListProgressiveGeneration++;
  myListStringsGeneration++;
  myListViewModelCache.clear();
  myListSourceMapCache.clear();
  myListRenderState=null;
  myListRenderCompletePromise=Promise.resolve();
  myListAncillaryRenderPromise=Promise.resolve();
}
function setMyList(t){
  myListType=t;
  addTray=[];
  renderAddTray();
  updateMyListCategoryChrome();
  document.getElementById('add-ttl').textContent=i18nCore.t(
    t==='costumes'?'myList.addOther':t==='gmax'?'myList.addGigantamax':t==='dynamax'?'myList.addDynamax':'myList.addTitle'
  );
  if(document.getElementById('ac-input'))document.getElementById('ac-input').value='';
  document.getElementById('add-pmon-sel').value='';
  const background=document.getElementById('add-pmon-background');if(background)background.value='';
  updateAddBackgroundPresentation();
  ['add-pmon-lucky','add-pmon-xxl','add-pmon-xxs','add-pmon-shiny'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});
  document.getElementById('add-pmon-pri').value='';
  document.querySelectorAll('.add-pri-btn').forEach(b=>{b.classList.remove('on','H','M','L');b.setAttribute('aria-pressed','false');});
  closeAddAutocomplete();
  document.getElementById('mylist-filter').value='';
  myListProgressiveGeneration++;
  myListRenderState=null;
  ensureListSubscribed(t);
  buildAcItems();renderMyList();
}

const MY_LIST_TYPES=['wishlist','dynamax','gmax','costumes'];
function myListCategoryKey(type){return type==='costumes'?'others':type==='gmax'?'gigantamax':type;}
function myListCategoryLabel(type){return i18nCore.t(`list.${myListCategoryKey(type)}`);}
function myListCategoryCount(type){return Object.keys(allData[type]?.[cur]||{}).length;}
function updateMyListCategoryChrome(){
  document.querySelectorAll('#tab-mylist .mylist-type-tabs .ltab').forEach(button=>{
    const type=button.dataset.mylistType,count=myListCategoryCount(type),active=type===myListType;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',active?'true':'false');
    button.setAttribute('aria-label',i18nCore.t('myList.categoryTabLabel',{category:myListCategoryLabel(type),count:i18nCore.formatNumber(count)}));
    const countEl=button.querySelector('[data-mylist-count]');if(countEl)countEl.textContent=i18nCore.formatNumber(count);
  });
}
function populatedMyListAlternative(){
  return MY_LIST_TYPES.filter(type=>type!==myListType&&myListCategoryCount(type)>0)
    .sort((a,b)=>(a==='wishlist'?-1:b==='wishlist'?1:myListCategoryCount(b)-myListCategoryCount(a)))[0]||'';
}

function toggleAddAdvanced(){
  const adv=document.getElementById('add-advanced');
  const btn=document.getElementById('add-adv-toggle');
  if(!adv||!btn)return;
  const open=!adv.classList.contains('open');
  adv.classList.toggle('open',open);
  btn.setAttribute('aria-expanded',open?'true':'false');
  lsSet('pogoAdvancedOpen',open);
}
function initAddAdvanced(){
  // Keep the normal add flow compact; respect an explicit device-local preference.
  const saved=lsGet('pogoAdvancedOpen',null);
  const open=saved===null?false:!!saved;
  const adv=document.getElementById('add-advanced');
  const btn=document.getElementById('add-adv-toggle');
  if(!adv||!btn)return;
  adv.classList.toggle('open',open);
  btn.setAttribute('aria-expanded',open?'true':'false');
}
function syncSpeedAddMode(){
  const on=!!lsGet('pogoSpeedAdd',false);
  const btn=document.getElementById('speed-add-toggle');
  const hint=document.getElementById('speed-add-hint');
  if(btn){
    btn.classList.toggle('on',on);
    btn.setAttribute('aria-checked',on?'true':'false');
  }
  if(hint)hint.classList.toggle('on',on);
  return on;
}
function toggleSpeedAddMode(){
  const next=!lsGet('pogoSpeedAdd',false);
  lsSet('pogoSpeedAdd',next);
  syncSpeedAddMode();
  toast(i18nCore.t(next?'myList.speedAddOn':'myList.speedAddOff'));
}
function setAddPri(p){
  const hidden=document.getElementById('add-pmon-pri');
  const cur=hidden?.value||'';
  const next=cur===p?'':p; // toggle off if same
  if(hidden)hidden.value=next;
  document.querySelectorAll('.add-pri-btn').forEach(b=>{
    const on=b.dataset.pri===next;
    b.classList.toggle('on',on);
    if(on)b.classList.add(next);else b.classList.remove('H','M','L');
    b.setAttribute('aria-pressed',on?'true':'false');
  });
  renderAddTray();
}
async function addEntry(){
  const name=document.getElementById('add-pmon-sel').value;
  const pri=document.getElementById('add-pmon-pri').value;
  const notes=document.getElementById('add-pmon-notes').value.trim();
  const lucky=!!document.getElementById('add-pmon-lucky')?.checked;
  const xxl=!!document.getElementById('add-pmon-xxl')?.checked;
  const xxs=!!document.getElementById('add-pmon-xxs')?.checked;
  const shiny=!!document.getElementById('add-pmon-shiny')?.checked;
  const backgroundId=normalizeBackgroundId(document.getElementById('add-pmon-background')?.value);
  if(!name){toast(i18nCore.t('myList.selectPokemon'));return;}
  if(!pri&&!lucky&&!xxl&&!xxs&&!shiny&&!backgroundId){toast(i18nCore.t('myList.priorityOrFlagRequired'));return;}
  const dn=acItems.find(x=>x.name===name)?.dn||name;
  const list={...(allData[myListType]?.[cur]||{})};
  list[name]=priValue(pri,notes,lucky,xxl,xxs,shiny,backgroundId);
  if(!await writeList(myListType,cur,list))return;
  const speedAdd=syncSpeedAddMode();
  document.getElementById('ac-input').value='';
  document.getElementById('add-pmon-sel').value='';
  document.getElementById('add-pmon-notes').value='';
  addTray=addTray.filter(x=>x.name!==name);
  renderAddTray();
  if(!speedAdd){
    document.getElementById('add-pmon-pri').value='';
    document.querySelectorAll('.add-pri-btn').forEach(b=>{b.classList.remove('on','H','M','L');b.setAttribute('aria-pressed','false');});
    ['add-pmon-lucky','add-pmon-xxl','add-pmon-xxs','add-pmon-shiny'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});
    const background=document.getElementById('add-pmon-background');if(background)background.value='';
    updateAddBackgroundPresentation();
  }
  closeAddAutocomplete();
  buildAcItems();
  toast(i18nCore.t('myList.added',{name:dn}));
  const input=document.getElementById('ac-input');
  if(input)input.focus();
}

function allCostumeEntries(){
  const out=pokemonCatalogDomain.canonicalizeEntries([...DB.costumes,...EXTRA_COSTUME_ENTRIES,...EXTRA_FORM_ENTRIES,...pokemonCatalogDomain.verifiedMissingEntries]);
  return out.sort((a,b)=>(parseInt(a.no)||9999)-(parseInt(b.no)||9999)||pokemonNamesI18n.compareDisplay(a,b,{locale:i18nCore.getLocale()}));
}
function maxTradeEntries(type){
  const src=type==='gmax'?DB.gmax:DB.dynamax;
  const label=MAX_TYPE_LABELS[type];
  return src.map(e=>{
    const base=e.displayName||e.name;
    const name=type==='gmax'?e.name:`${base} (${label})`;
    return{...e,name,displayName:type==='gmax'?base:name,spriteName:e.name,maxType:type};
  });
}
function listSource(type){
  if(type==='costumes')return allCostumeEntries();
  if(type==='dynamax')return pokemonCatalogDomain.canonicalizeEntries(DB.dynamax.map(e=>({...e,maxType:'dynamax'})));
  if(type==='gmax')return pokemonCatalogDomain.canonicalizeEntries(DB.gmax.map(e=>({...e,maxType:'gmax'})));
  // Wishlist autocomplete needs to surface every tradeable species — including
  // legendaries, Ultra Beasts and Paradoxes that the community list hasn't
  // touched yet. Mythicals (except Meltan/Melmetal/Gimmighoul) are filtered out
  // since PoGo doesn't allow trading them. uniqueEntries dedupes by name so
  // existing rows win.
  const wishlistOnly=DB.wishlist.filter(isTradeableForWishlist);
  const legendariesOnly=LEGENDARY_AVATAR_ENTRIES.filter(isTradeableForWishlist);
  return pokemonCatalogDomain.canonicalizeEntries(uniqueEntries(wishlistOnly,maxTradeEntries('dynamax'),maxTradeEntries('gmax'),allCostumeEntries(),legendariesOnly));
}
let spriteIndex=null;
function spriteSourceIndex(){
  if(spriteIndex)return spriteIndex;
  spriteIndex=new Map();
  const add=(key,e)=>{
    const k=normalizeSpriteKey(key);
    if(k&&!spriteIndex.has(k))spriteIndex.set(k,e);
  };
  [...DB.wishlist,...DB.dynamax,...DB.gmax,...allCostumeEntries(),...LEGENDARY_AVATAR_ENTRIES].forEach(e=>{
    if(!e.no)return;
    add(e.name,e);add(e.displayName,e);(e.legacyAliases||[]).forEach(alias=>add(alias,e));
  });
  add('Vivillon',{no:666,name:'Vivillon',displayName:'Vivillon'});
  add('Scatterbug',{no:664,name:'Scatterbug',displayName:'Scatterbug'});
  add('Unown',{no:201,name:'Unown',displayName:'Unown'});
  return spriteIndex;
}
function costumeBaseName(name,dn){
  const raw=String(name||dn||'').replace(/^([AGHP])[._ ]+/,'$1-').replace(/\s+/g,' ').trim();
  const label=String(dn||name||'').replace(/^([AGHP])[._ ]+/,'$1-').replace(/\s+/g,' ').trim();
  if(VIVILLON_PATTERNS.has(raw)||VIVILLON_PATTERNS.has(label))return'Vivillon';
  if(/^Scatterbug(\s|$|\()/i.test(raw)||/^Scatterbug(\s|$|\()/i.test(label))return'Scatterbug';
  if(/^Unown(\s|$|\()/i.test(raw)||/^Unown(\s|$|\()/i.test(label))return'Unown';
  return raw.split('(')[0].trim()||label.split('(')[0].trim()||raw||label;
}
function spriteEntryForListItem(type,name,entry){
  if(entry?.no||entry?.sprite||entry?.spriteUrl)return entry;
  const idx=spriteSourceIndex();
  const dn=entry?.displayName||name;
  const candidates=[name,dn,costumeBaseName(name,dn),costumeBaseName(dn,name)];
  for(const c of candidates){
    const found=idx.get(normalizeSpriteKey(c));
    if(found)return found;
  }
  return null;
}
function priorityFamilySort(a,b){
  return (PRI_ORDER[a.p]??9)-(PRI_ORDER[b.p]??9)
    || _familySort(a,b)
    || comparePokemonLabels(a.dn||a.name,b.dn||b.name);
}
function myListSourceMap(type){
  if(myListSourceMapCache.has(type))return myListSourceMapCache.get(type);
  const map=pokemonCatalogDomain.entryMap(listSource(type));
  myListSourceMapCache.set(type,map);
  return map;
}
function myListViewModel(type,user,name,value,srcMap){
  const locale=i18nCore.getLocale(),cacheKey=JSON.stringify([type,user,locale,name]);
  const entry=srcMap.get(pokemonCatalogDomain.normalizeCatalogKey(name))||{};
  const spriteEntry=spriteEntryForListItem(type,name,entry)||{};
  const fingerprint=JSON.stringify([value,entry.catalogId||'',entry.name||'',entry.displayName||'',spriteEntry.no||'',spriteEntry.name||'',spriteEntry.spriteUrl||'']);
  const cached=myListViewModelCache.get(cacheKey);
  if(cached?.fingerprint===fingerprint)return cached.entry;
  const{p,mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(value);
  const sourceEntry={...entry,name:entry.name||name,displayName:entry.displayName||name};
  const dn=pokemonDisplayName(sourceEntry),gender=entryGender(mod);
  const model={
    name,dn,p,mod,lucky,xxl,xxs,shiny,backgroundId,gender,
    no:spriteEntry.no||entry.no||null,
    catalogId:sourceEntry.catalogId||spriteEntry.catalogId||entry.catalogId||'',
    maxType:maxTypeForEntry(entry,type),
    spriteName:(COSTUME_FORM_SPRITE_IDS[name]||REGIONAL_FORM_IDS[name])?name:(spriteEntry.name||entry.name||name),
    spriteUrl:entrySpriteUrl(spriteEntry.no?spriteEntry:entry,name,gender),
    search:normalizeAcText([
      ...pokemonSearchLabels(sourceEntry),mod,
      backgroundId&&backgroundDisplayName(backgroundId),
      backgroundId&&backgroundShortLabel(backgroundId)
    ].filter(Boolean).join(' ')),
    rawValue:value
  };
  myListViewModelCache.set(cacheKey,{fingerprint,entry:model});
  return model;
}
const MY_LIST_ORDER_PREFIX='pogoMyListOrder_v1';
const MY_LIST_ORDER_VERSION=1;
const MY_LIST_ORDER_MAX_ENTRIES=2000;
function myListOrderPriorityKey(priority){return['H','M','L'].includes(priority)?priority:'U';}
function myListOrderStorageKey(type=myListType,user=cur){
  const uid=auth?.currentUser?.uid||currentAuthUid;
  if(!uid||!user||!type)return'';
  return`${MY_LIST_ORDER_PREFIX}:${encodeURIComponent(uid)}:${encodeURIComponent(type)}`;
}
function readMyListOrder(type=myListType,user=cur){
  const key=myListOrderStorageKey(type,user);if(!key)return null;
  const value=lsGet(key,null),uid=auth?.currentUser?.uid||currentAuthUid;
  if(!value||value.version!==MY_LIST_ORDER_VERSION||value.owner?.uid!==uid||value.owner?.username!==user)return null;
  if(!value.priorities||typeof value.priorities!=='object')return null;
  const priorities={};
  for(const priority of['H','M','L','U']){
    const names=Array.isArray(value.priorities[priority])?value.priorities[priority]:[];
    priorities[priority]=[...new Set(names.filter(name=>typeof name==='string'&&name.length&&name.length<=256))].slice(0,MY_LIST_ORDER_MAX_ENTRIES);
  }
  return{version:MY_LIST_ORDER_VERSION,owner:{uid,username:user},priorities};
}
function applyExplicitMyListOrder(entries,type=myListType,user=cur){
  const order=readMyListOrder(type,user);if(!order)return entries;
  const result=[];
  for(const priority of['H','M','L','U']){
    const group=entries.filter(entry=>myListOrderPriorityKey(entry.p)===priority);
    const byName=new Map(group.map(entry=>[entry.name,entry]));
    for(const name of order.priorities[priority]){const entry=byName.get(name);if(entry){result.push(entry);byName.delete(name);}}
    for(const entry of group)if(byName.delete(entry.name))result.push(entry);
  }
  return result;
}
function currentMyListOrderModel(type=myListType,user=cur){
  const uid=auth?.currentUser?.uid||currentAuthUid;
  const priorities={H:[],M:[],L:[],U:[]};
  currentListEntries(type).forEach(entry=>priorities[myListOrderPriorityKey(entry.p)].push(entry.name));
  return{version:MY_LIST_ORDER_VERSION,owner:{uid,username:user},priorities};
}
function persistMyListOrder(model,type=myListType,user=cur){
  const key=myListOrderStorageKey(type,user);if(!key||!model?.owner?.uid)return false;
  const priorities={};
  for(const priority of['H','M','L','U'])priorities[priority]=[...new Set((model.priorities?.[priority]||[]).filter(name=>typeof name==='string'&&name.length))].slice(0,MY_LIST_ORDER_MAX_ENTRIES);
  lsSet(key,{version:MY_LIST_ORDER_VERSION,owner:model.owner,priorities});
  return true;
}
function currentListEntries(type=myListType,filterVal=''){
  const list=allData[type]?.[cur]||{};
  const srcMap=myListSourceMap(type);
  const q=normalizeAcText(filterVal||'');
  const locale=i18nCore.getLocale(),activeKeys=new Set();
  const entries=Object.entries(list).map(([name,val])=>{
    activeKeys.add(JSON.stringify([type,cur,locale,name]));
    return myListViewModel(type,cur,name,val,srcMap);
  }).filter(e=>!q||e.search.includes(q)).sort(priorityFamilySort);
  for(const key of myListViewModelCache.keys()){
    let parsed;
    try{parsed=JSON.parse(key);}catch{continue;}
    if(parsed[0]===type&&parsed[1]===cur&&parsed[2]===locale&&!activeKeys.has(key))myListViewModelCache.delete(key);
  }
  return applyExplicitMyListOrder(entries,type,cur);
}

function scheduleMyListFilter(value){
  const generation=++myListFilterGeneration;
  clearTimeout(myListFilterTimer);
  myListFilterTimer=setTimeout(()=>{
    if(generation!==myListFilterGeneration)return;
    renderMyList(value,{reason:'filter'});
  },MY_LIST_FILTER_DELAY_MS);
}

function myListEditorHtml(entry){
  const{name,dn,p,mod,lucky,xxl,xxs,shiny,backgroundId}=entry;
  const jsName=escAttr(name.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' '));
  const jsDn=escAttr(String(dn).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' '));
  return`<div class="myrow-editor-popover" onkeydown="if(event.key==='Escape'){event.preventDefault();const d=this.closest('details');d.removeAttribute('open');d.querySelector('summary').focus()}">
    <div class="myrow-editor-title">${escHtml(dn)}</div>
    <fieldset class="myrow-priority-editor"><legend>${escHtml(i18nCore.t('myList.priority'))}</legend><div role="group" aria-label="${escAttr(i18nCore.t('myList.priorityFor',{name:dn}))}">${['H','M','L'].map(value=>`<button type="button" class="pb priority-choice ${p===value?'on '+value:''}" aria-pressed="${p===value}" onclick="movePriority('${jsName}','${value}')">${escHtml(i18nCore.t({'H':'priority.high','M':'priority.medium','L':'priority.low'}[value]))}</button>`).join('')}</div></fieldset>
    <div class="myrow-trait-controls">
      <button class="flag-btn lucky-flag ${lucky?'on':''}" onclick="setLucky('${jsName}')" title="${escAttr(i18nCore.t('myList.lucky'))}" aria-pressed="${lucky}" aria-label="${escAttr(i18nCore.t('myList.toggleLuckyFor',{name:dn}))}">⚡</button>
      <button class="flag-btn shiny-flag ${shiny?'on':''}" onclick="setShiny('${jsName}')" title="${escAttr(i18nCore.t('myList.shiny'))}" aria-pressed="${shiny}" aria-label="${escAttr(i18nCore.t('myList.toggleShinyFor',{name:dn}))}">✨</button>
      <button class="flag-btn xxl-flag ${xxl?'on':''}" onclick="setXxl('${jsName}')" title="XXL" aria-pressed="${xxl}" aria-label="${escAttr(i18nCore.t('myList.toggleXxlFor',{name:dn}))}">XXL</button>
      <button class="flag-btn xxs-flag ${xxs?'on':''}" onclick="setXxs('${jsName}')" title="XXS" aria-pressed="${xxs}" aria-label="${escAttr(i18nCore.t('myList.toggleXxsFor',{name:dn}))}">XXS</button>
    </div>
    <div class="myrow-editor-fields"><input class="ni" type="text" value="${escAttr(mod)}" placeholder="${escAttr(i18nCore.t('myList.variantDetails'))}" onchange="setNotes('${jsName}',this.value)" aria-label="${escAttr(i18nCore.t('myList.notesFor',{name:dn}))}"></div>
    <button type="button" class="background-trigger" onclick="openBackgroundPicker({target:'entry',name:'${jsName}',pokemonName:'${jsDn}'})" aria-haspopup="dialog"><span class="background-trigger-copy">${escHtml(backgroundId?backgroundDisplayName(backgroundId):i18nCore.t('background.none'))}</span><span class="background-trigger-clear">${escHtml(backgroundId?i18nCore.t('common.change'):i18nCore.t('background.choose'))}</span></button>
  </div>`;
}
function hydrateMyRowEditor(details){
  if(!details?.open||details.dataset.hydrated==='true')return;
  const name=details.closest('.myrow')?.dataset.name;
  const entry=currentListEntries(myListType).find(item=>item.name===name);
  if(!entry)return;
  details.insertAdjacentHTML('beforeend',myListEditorHtml(entry));
  details.dataset.hydrated='true';
}
function hydrateMyRowPriority(details){
  if(!details?.open||details.dataset.hydrated==='true')return;
  const name=details.closest('.myrow')?.dataset.name;
  const entry=currentListEntries(myListType).find(item=>item.name===name);
  if(!entry)return;
  const jsName=escAttr(entry.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' '));
  details.insertAdjacentHTML('beforeend',`<div class="myrow-priority-menu" role="group" aria-label="${escAttr(i18nCore.t('myList.priorityFor',{name:entry.dn}))}">${['H','M','L'].map(value=>`<button type="button" class="pb ${entry.p===value?'on '+value:''}" aria-pressed="${entry.p===value}" onclick="movePriority('${jsName}','${value}')">${value}</button>`).join('')}</div>`);
  details.dataset.hydrated='true';
}
function myListRowRenderKey(entry,idx,count){
  return JSON.stringify([entry.rawValue,i18nCore.getLocale(),bulkMode,bulkSelected.has(entry.name),reorderMode,reorderMode?idx:null,reorderMode?count:null]);
}
function myListRowHtml(entry,idx,count){
    const{name,dn,p,mod,lucky,xxl,xxs,shiny,backgroundId,no}=entry;
    const jsName=escAttr(name.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' '));
    const jsDn=escAttr(String(dn).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' '));
    const attrName=escAttr(name);
    const hasSprite=Boolean(no||isApprovedRuntimeSpriteUrl(entry.spriteUrl)||COSTUME_FORM_SPRITE_IDS[name]);
    const crownHtml=maxCrownSvg(entry.maxType);
    const isSel=bulkSelected.has(name);
    const clickHandler=bulkMode?`onclick="event.stopPropagation();toggleBulkSelection('${jsName}')"`:'';
    const activeTraits=[
      lucky?`<span class="myrow-trait lucky">${escHtml(i18nCore.t('myList.lucky'))}</span>`:'',
      shiny?`<span class="myrow-trait shiny">${escHtml(i18nCore.t('myList.shiny'))}</span>`:'',
      xxl?'<span class="myrow-trait xxl">XXL</span>':'',
      xxs?'<span class="myrow-trait xxs">XXS</span>':'',
      backgroundId?backgroundBadgeHtml(backgroundId,'myrow-trait background'):'',
      mod?`<span class="myrow-trait detail">${escHtml(mod)}</span>`:''
    ].join('');
    const priorityIndex=idx,priorityCount=count;
    return`<div class="myrow${isSel?' bulk-selected':''}${backgroundId?` background-visual-card ${backgroundVisualClass(backgroundId)}`:''}" ${backgroundId?backgroundVisualAttrs(backgroundId):''} ${reorderMode&&!bulkMode?'draggable="true"':''} data-name="${attrName}" data-priority="${escAttr(p||'')}" data-dex="${no||''}" data-idx="${idx}" data-render-key="${escAttr(myListRowRenderKey(entry,idx,count))}" data-full="${escAttr(dn)}" aria-label="${escAttr(dn)}" ${clickHandler}
      ondragstart="dragStart(event)" ondragover="dragOver(event)" ondrop="dragDrop(event)" ondragend="dragEnd(event)">
      ${backgroundVisualMotifHtml(backgroundId)}
      <input type="checkbox" class="bulk-chk" data-name="${attrName}" ${isSel?'checked':''} onclick="event.stopPropagation();toggleBulkSelection('${jsName}')" aria-label="${escAttr(i18nCore.t('myList.selectEntry',{name:dn}))}">
      ${reorderMode?`<button type="button" class="drag-handle" draggable="false" title="${escAttr(i18nCore.t('myList.reorderEntry',{name:dn}))}" aria-label="${escAttr(i18nCore.t('myList.reorderEntry',{name:dn}))}" onpointerdown="myListPointerStart(event)" onpointermove="myListPointerMove(event)" onpointerup="myListPointerEnd(event)" onpointercancel="myListPointerCancel(event)">${uiIconMarkup('grip','ui-icon')}</button><span class="myrow-reorder-controls"><button type="button" class="myrow-reorder-move" data-reorder-move="up" draggable="false" ${priorityIndex<=0?'disabled':''} aria-label="${escAttr(i18nCore.t('myList.moveUp',{name:dn}))}" onclick="event.stopPropagation();moveMyListEntry('${jsName}',-1)">${uiIconMarkup('chevron-down','ui-icon')}</button><button type="button" class="myrow-reorder-move" data-reorder-move="down" draggable="false" ${priorityIndex>=priorityCount-1?'disabled':''} aria-label="${escAttr(i18nCore.t('myList.moveDown',{name:dn}))}" onclick="event.stopPropagation();moveMyListEntry('${jsName}',1)">${uiIconMarkup('chevron-down','ui-icon')}</button></span>`:''}
      ${hasSprite?`<span class="myrow-sprite-wrap sprite-slot-list">${spriteImg(no,34,'myrow-sprite',name,'',dn,{urlOverride:entry.spriteUrl,catalogId:entry.catalogId})}${crownHtml}</span>`:crownHtml}
      <div class="myrow-copy">
        <div class="myrow-name">${escHtml(dn)}</div>
        ${activeTraits?`<div class="myrow-active-traits" aria-label="${escAttr(i18nCore.t('myList.currentFlags',{flags:[lucky&&i18nCore.t('myList.lucky'),shiny&&i18nCore.t('myList.shiny'),xxl&&'XXL',xxs&&'XXS',backgroundId&&i18nCore.t('background.badgeLabel',{name:backgroundDisplayName(backgroundId)}),mod].filter(Boolean).join(', ')}))}">${activeTraits}</div>`:''}
      </div>
      <div class="mctrl">
        ${p?`<details class="myrow-priority-quick" onclick="event.stopPropagation()" ontoggle="hydrateMyRowPriority(this)"><summary class="myrow-priority-chip ${p}" aria-label="${escAttr(i18nCore.t('myList.changePriorityFor',{name:dn,priority:i18nCore.t({'H':'priority.high','M':'priority.medium','L':'priority.low'}[p])}))}">${p}</summary></details>`:''}
        <details class="myrow-editor" onclick="event.stopPropagation()" ontoggle="hydrateMyRowEditor(this)">
          <summary class="myrow-edit" aria-label="${escAttr(i18nCore.t('myList.openMoreFor',{name:dn}))}" title="${escAttr(i18nCore.t('myList.openMoreFor',{name:dn}))}">${uiIconMarkup('sliders','ui-icon ui-icon-sm')}<span>${escHtml(i18nCore.t('myList.editEntry'))}</span></summary>
        </details>
        <button type="button" class="myrow-remove" onclick="event.stopPropagation();confirmRemove('${jsName}','${jsDn}')" aria-label="${escAttr(i18nCore.t('myList.removeEntry',{name:dn}))}" title="${escAttr(i18nCore.t('myList.removeEntry',{name:dn}))}">${escHtml(i18nCore.t('myList.remove'))}</button>
      </div>
    </div>`;
}
function myListRowsHtml(entries){
  return entries.map((entry,idx)=>myListRowHtml(entry,idx,entries.length)).join('');
}
function myListPriorityCollapseKey(priority,type=myListType,username=cur){
  if(!['H','M','L'].includes(priority))return'';
  return JSON.stringify([String(username||''),String(type||''),priority]);
}
function isMyListPriorityCollapsed(priority,type=myListType,username=cur){
  const key=myListPriorityCollapseKey(priority,type,username);
  return!!key&&myListCollapsedPrioritySections.has(key);
}
function setMyListPriorityCollapsed(priority,collapsed,type=myListType,username=cur){
  const key=myListPriorityCollapseKey(priority,type,username);if(!key)return false;
  if(collapsed)myListCollapsedPrioritySections.add(key);else myListCollapsedPrioritySections.delete(key);
  if(type===myListType&&username===cur){
    const section=document.querySelector(`[data-priority-section="${priority}"]`);
    section?.classList.toggle('is-collapsed',collapsed);
    section?.querySelector('.mylist-priority-toggle')?.setAttribute('aria-expanded',String(!collapsed));
    const body=section?.querySelector('.mylist-priority-body');if(body)body.hidden=collapsed;
  }
  return true;
}
function toggleMyListPrioritySection(priority){
  return setMyListPriorityCollapsed(priority,!isMyListPriorityCollapsed(priority));
}
function expandMyListPrioritiesReceivingEntries(type,username,before,after){
  Object.keys(after||{}).forEach(name=>{
    const nextPriority=parsePri(after[name]||'').p;
    const previousPriority=Object.prototype.hasOwnProperty.call(before||{},name)?parsePri(before[name]||'').p:'';
    if(['H','M','L'].includes(nextPriority)&&nextPriority!==previousPriority){
      myListCollapsedPrioritySections.delete(myListPriorityCollapseKey(nextPriority,type,username));
    }
  });
}
function myListPrioritySectionHtml(priority,entries,renderedEntries=entries){
  const label=publicSharePriorityLabel(priority),count=i18nCore.formatNumber(entries.length),collapsed=isMyListPriorityCollapsed(priority);
  const bodyId=`mylist-priority-body-${priority}`;
  return`<section class="mylist-priority-section ${priority}${collapsed?' is-collapsed':''}" data-mylist-section="priority-${priority}" data-priority-section="${priority}" aria-labelledby="mylist-priority-${priority}">
    <h3 class="mylist-priority-heading" id="mylist-priority-${priority}"><button type="button" class="mylist-priority-toggle" aria-expanded="${!collapsed}" aria-controls="${bodyId}" onclick="toggleMyListPrioritySection('${priority}')"><span class="badge ${priority}"><span class="prio-mark">${priority}</span>${escHtml(label)}</span><span class="priority-count">${escHtml(i18nCore.t('myList.priorityPokemonCount',{count}))}</span>${uiIconMarkup('chevron-down','ui-icon')}</button></h3>
    <div class="mylist-priority-body" id="${bodyId}" ${collapsed?'hidden':''}>
      <div class="mygrid">${myListRowsHtml(renderedEntries)}</div>
      <div data-priority-search="${priority}"></div>
    </div>
  </section>`;
}
const MY_LIST_DEX_GROUPS=Object.freeze([
  Object.freeze({key:'LUCKY',flag:'lucky',labelKey:'myList.luckyDex'}),
  Object.freeze({key:'SHINY',flag:'shiny',labelKey:'myList.shinyDex'}),
  Object.freeze({key:'XXL',flag:'xxl',labelKey:'myList.xxlDex'}),
  Object.freeze({key:'XXS',flag:'xxs',labelKey:'myList.xxsDex'})
]);
function myListDexGroups(entries){
  const unprioritized=entries.filter(entry=>!entry.p);
  const groups=MY_LIST_DEX_GROUPS.map(group=>({...group,entries:unprioritized.filter(entry=>entry[group.flag])}))
    .filter(group=>group.entries.length);
  const other=unprioritized.filter(entry=>!MY_LIST_DEX_GROUPS.some(group=>entry[group.flag]));
  if(other.length)groups.push({key:'OTHER',labelKey:'myList.otherPokemon',entries:other});
  return groups;
}
function myListDexSectionHtml(group,renderedEntries=group.entries){
  const id=`mylist-dex-${group.key.toLowerCase()}`;
  return`<section class="mylist-priority-section mylist-dex-section" data-mylist-section="dex-${group.key}" data-dex-section="${group.key}" aria-labelledby="${id}">
    <h3 class="mylist-priority-heading" id="${id}">${escHtml(i18nCore.t(group.labelKey))}<span class="priority-count">${escHtml(i18nCore.t('myList.priorityPokemonCount',{count:i18nCore.formatNumber(group.entries.length)}))}</span></h3>
    <div class="mygrid">${myListRowsHtml(renderedEntries)}</div>
    ${group.key==='OTHER'?'':`<div data-dex-search="${group.key}"></div>`}
  </section>`;
}
function myListSectionModels(entries){
  const models=['H','M','L'].filter(priority=>entries.some(entry=>entry.p===priority)).map(priority=>({
    key:`priority-${priority}`,kind:'priority',priority,entries:entries.filter(entry=>entry.p===priority)
  }));
  myListDexGroups(entries).forEach(group=>models.push({key:`dex-${group.key}`,kind:'dex',group,entries:group.entries}));
  return models;
}
function myListSectionHtml(model,renderedEntries=model.entries){
  return model.kind==='priority'
    ?myListPrioritySectionHtml(model.priority,model.entries,renderedEntries)
    :myListDexSectionHtml(model.group,renderedEntries);
}
function myListNodeFromHtml(html){
  const template=document.createElement('template');template.innerHTML=html.trim();return template.content.firstElementChild;
}
function patchMyListSectionRows(section,model,entries){
  const grid=section.querySelector('.mygrid');if(!grid)return;
  const existing=new Map([...grid.children].filter(row=>row.classList.contains('myrow')).map(row=>[row.dataset.name,row]));
  if(!existing.size){
    const fragment=document.createDocumentFragment();
    entries.forEach((entry,idx)=>fragment.append(myListNodeFromHtml(myListRowHtml(entry,idx,model.entries.length))));
    grid.replaceChildren(fragment);
  }else{
    entries.forEach((entry,idx)=>{
      const expectedKey=myListRowRenderKey(entry,idx,model.entries.length);
      const previous=existing.get(entry.name);
      let row=previous;
      if(!row||row.dataset.renderKey!==expectedKey){
        row=myListNodeFromHtml(myListRowHtml(entry,idx,model.entries.length));
        if(previous)previous.replaceWith(row);
      }
      existing.delete(entry.name);
      const current=grid.children[idx];
      if(current!==row)grid.insertBefore(row,current||null);
    });
    existing.forEach(row=>row.remove());
  }
  section.dataset.rendered=String(entries.length);
  section.dataset.total=String(model.entries.length);
  applyTypeColors(section);
}
function patchMyListSections(root,models,limits){
  const desiredKeys=new Set(models.map(model=>model.key));
  root.querySelectorAll(':scope > [data-mylist-section]').forEach(section=>{if(!desiredKeys.has(section.dataset.mylistSection))section.remove();});
  models.forEach((model,index)=>{
    const rendered=model.entries.slice(0,limits.get(model.key)??model.entries.length);
    let section=root.querySelector(`:scope > [data-mylist-section="${model.key}"]`);
    if(!section)section=myListNodeFromHtml(myListSectionHtml(model,[]));
    if(model.kind==='priority'){
      const collapsed=isMyListPriorityCollapsed(model.priority);
      section.classList.toggle('is-collapsed',collapsed);
      section.querySelector('.mylist-priority-toggle')?.setAttribute('aria-expanded',String(!collapsed));
      const body=section.querySelector('.mylist-priority-body');if(body)body.hidden=collapsed;
    }
    const count=section.querySelector('.priority-count');
    if(count)count.textContent=i18nCore.t('myList.priorityPokemonCount',{count:i18nCore.formatNumber(model.entries.length)});
    patchMyListSectionRows(section,model,rendered);
    const current=root.children[index];if(current!==section)root.insertBefore(section,current||null);
  });
}
function applyMyListVisibilityFilter(root,entries,q){
  const byName=new Map(entries.map(entry=>[entry.name,entry]));
  let visible=0;
  root.querySelectorAll(':scope > [data-mylist-section]').forEach(section=>{
    let sectionVisible=0;
    section.querySelectorAll('.myrow').forEach(row=>{
      const entry=byName.get(row.dataset.name),show=!!entry&&(!q||entry.search.includes(q));
      row.hidden=!show;if(show){sectionVisible++;visible++;}
    });
    section.hidden=sectionVisible===0;
    const count=section.querySelector('.priority-count');
    if(count)count.textContent=i18nCore.t('myList.priorityPokemonCount',{count:i18nCore.formatNumber(sectionVisible)});
  });
  root.dataset.visible=String(visible);
  return visible;
}
function syncMyListFilteredEmpty(el,root,visible,q,category){
  let state=el.querySelector(':scope > .mylist-filter-empty');
  const empty=!!q&&visible===0;
  root.hidden=empty;
  if(!empty){state?.remove();return;}
  if(!state){state=document.createElement('div');state.className='mylist-filter-empty';el.append(state);}
  state.innerHTML=emptyHtml(i18nCore.t('myList.noMatchesInCategory',{category}),i18nCore.t('myList.clearFilter'));
}
function scheduleProgressiveMyListRender(root,models,limits,generation,resolve){
  const schedule=window.requestIdleCallback
    ?callback=>window.requestIdleCallback(callback,{timeout:120})
    :callback=>setTimeout(()=>callback({timeRemaining:()=>8,didTimeout:true}),16);
  const run=()=>{
    if(generation!==myListProgressiveGeneration||!root.isConnected){resolve(false);return;}
    let remaining=MY_LIST_PROGRESSIVE_BATCH_ROWS;
    for(const model of models){
      const current=limits.get(model.key)||0;
      if(current>=model.entries.length)continue;
      const add=Math.min(remaining,model.entries.length-current);
      limits.set(model.key,current+add);remaining-=add;
      if(!remaining)break;
    }
    patchMyListSections(root,models,limits);
    const rendered=[...limits.values()].reduce((sum,value)=>sum+value,0),total=models.reduce((sum,model)=>sum+model.entries.length,0);
    root.dataset.rendered=String(rendered);
    if(rendered>=total){
      root.dataset.renderComplete='true';
      window.__pogoMyListRenderState={...window.__pogoMyListRenderState,complete:true,rendered,total,completedAt:performance.now()};
      resolve(true);return;
    }
    schedule(run);
  };
  schedule(run);
}
function scheduleMyListStringsRender(generation){
  const schedule=window.requestIdleCallback
    ?callback=>window.requestIdleCallback(callback,{timeout:120})
    :callback=>setTimeout(callback,16);
  return new Promise(resolve=>schedule(()=>{
    if(generation!==myListStringsGeneration){resolve(false);return;}
    renderMyStrings();resolve(true);
  }));
}
function waitForMyListRender(){
  return Promise.all([myListRenderCompletePromise,myListAncillaryRenderPromise]).then(([complete])=>complete);
}
function renderMyList(filterVal,options={}){
  if(options.reason!=='filter'){
    clearTimeout(myListFilterTimer);myListFilterTimer=0;myListFilterGeneration++;
  }
  const q=normalizeAcText(filterVal??document.getElementById('mylist-filter')?.value??'');
  const list=allData[myListType]?.[cur]||{};
  const el=document.getElementById('mylist-out');if(!el)return;
  const allEntries=currentListEntries(myListType),entries=q?allEntries.filter(entry=>entry.search.includes(q)):allEntries;
  const locale=i18nCore.getLocale(),context=JSON.stringify([cur,myListType,locale,bulkMode,reorderMode]);
  const snapshot=new Map(Object.entries(list)),previous=myListRenderState;
  const dataChanged=!previous||previous.context!==context||previous.snapshot.size!==snapshot.size||[...snapshot].some(([name,value])=>previous.snapshot.get(name)!==value);
  const filterOnly=options.reason==='filter'&&!dataChanged;
  myListProgressiveGeneration++;
  const generation=myListProgressiveGeneration;
  if(!filterOnly)renderTradeComparisonReturn();

  const count=Object.keys(list).length;
  document.getElementById('tab-mylist')?.classList.toggle('has-list-content',count>0);
  const category=myListCategoryLabel(myListType);
  updateMyListCategoryChrome();
  const categoryName=document.getElementById('mylist-category-name');if(categoryName)categoryName.textContent=category;
  const countEl=document.getElementById('mylist-count');
  if(countEl)countEl.textContent=i18nCore.t(q?'myList.filteredCategoryCount':'myList.categoryCount',q?{visible:i18nCore.formatNumber(entries.length),total:i18nCore.formatNumber(count)}:{count:i18nCore.formatNumber(count)});

  let root=el.querySelector(':scope > .mylist-priority-sections');
  if(filterOnly&&previous?.visibilityDom&&root?.dataset.renderComplete==='true'){
    const visible=applyMyListVisibilityFilter(root,allEntries,q);
    syncMyListFilteredEmpty(el,root,visible,q,category);
    myListRenderState={context,q,snapshot,visibilityDom:true};
    window.__pogoMyListRenderState={complete:true,rendered:allEntries.length,total:allEntries.length,visible,query:q,usableAt:performance.now()};
    myListRenderCompletePromise=Promise.resolve(true);
    return;
  }

  if(!entries.length){
    if(q)el.innerHTML=emptyHtml(i18nCore.t('myList.noMatchesInCategory',{category}),i18nCore.t('myList.clearFilter'));
    else{
      const alternative=populatedMyListAlternative(),alternativeCount=alternative?myListCategoryCount(alternative):0;
      el.innerHTML=emptyHtml(i18nCore.t(`myList.empty.${myListCategoryKey(myListType)}Title`),i18nCore.t(`myList.empty.${myListCategoryKey(myListType)}Help`),'📋')+
        (alternative?`<div style="display:flex;justify-content:center;margin-top:10px"><button type="button" class="bghost" onclick="setMyList('${alternative}')" aria-label="${escAttr(i18nCore.t('myList.viewCategoryLabel',{category:myListCategoryLabel(alternative),count:i18nCore.formatNumber(alternativeCount)}))}">${escHtml(i18nCore.t('myList.viewCategory',{category:myListCategoryLabel(alternative),count:i18nCore.formatNumber(alternativeCount)}))}</button></div>`:'');
    }
    if(!filterOnly){myListStringsGeneration++;renderMyStrings();renderOwnerShareRepublishNotice();}
    myListAncillaryRenderPromise=Promise.resolve(true);
    myListRenderState={context,q,snapshot};
    window.__pogoMyListRenderState={complete:true,rendered:0,total:0,query:q,usableAt:performance.now()};
    myListRenderCompletePromise=Promise.resolve(true);
    return;
  }

  const visibilityDom=allEntries.length<=MY_LIST_PROGRESSIVE_THRESHOLD;
  const renderedEntries=visibilityDom?allEntries:entries;
  const models=myListSectionModels(renderedEntries),progressive=renderedEntries.length>MY_LIST_PROGRESSIVE_THRESHOLD;
  if(!root){el.replaceChildren();root=document.createElement('div');root.className='mylist-priority-sections';el.append(root);}
  const limits=new Map();
  if(progressive){
    let remaining=MY_LIST_PROGRESSIVE_INITIAL_ROWS;
    const fairShare=Math.max(1,Math.floor(MY_LIST_PROGRESSIVE_INITIAL_ROWS/models.length));
    models.forEach(model=>{const count=Math.min(model.entries.length,fairShare,remaining);limits.set(model.key,count);remaining-=count;});
    for(const model of models){if(!remaining)break;const current=limits.get(model.key)||0,extra=Math.min(remaining,model.entries.length-current);limits.set(model.key,current+extra);remaining-=extra;}
  }else models.forEach(model=>limits.set(model.key,model.entries.length));
  patchMyListSections(root,models,limits);
  const rendered=[...limits.values()].reduce((sum,value)=>sum+value,0);
  const visible=visibilityDom?applyMyListVisibilityFilter(root,allEntries,q):entries.length;
  syncMyListFilteredEmpty(el,root,visible,q,category);
  root.dataset.rendered=String(rendered);root.dataset.total=String(renderedEntries.length);root.dataset.renderComplete=String(!progressive);
  window.__pogoMyListRenderState={complete:!progressive,rendered,total:renderedEntries.length,visible,query:q,usableAt:performance.now()};
  const shouldRenderStrings=!q&&(dataChanged||previous?.q);
  if(q){
    myListStringsGeneration++;
    root.querySelectorAll('[data-priority-search],[data-dex-search]').forEach(footer=>{footer.innerHTML='';});
  }
  if(!filterOnly)renderOwnerShareRepublishNotice();
  attachSwipeHandlers();
  if(progressive){
    myListRenderCompletePromise=new Promise(resolve=>scheduleProgressiveMyListRender(root,models,limits,generation,resolve));
  }
  else myListRenderCompletePromise=Promise.resolve(true);
  if(shouldRenderStrings){
    const stringsGeneration=++myListStringsGeneration;
    myListAncillaryRenderPromise=myListRenderCompletePromise.then(completed=>{
      if(!completed||generation!==myListProgressiveGeneration)return false;
      return scheduleMyListStringsRender(stringsGeneration);
    });
  }else myListAncillaryRenderPromise=Promise.resolve(true);
  myListRenderState={context,q,snapshot,visibilityDom};
}
function confirmRemove(name,dn){
  const list=allData[myListType]?.[cur]||{};
  const{mod}=parsePri(list[name]||'');
  const message=mod
    ?i18nCore.t('myList.confirmDelete',{name:dn,notes:mod})
    :i18nCore.t('myList.confirmRemove',{name:dn});
  if(!confirm(message))return false;
  removeEntry(name);
  return true;
}

const canvasImageCache=new Map();
const canvasImageUsableCache=new WeakMap();
function exportSpriteUrl(e){
  return canvasSafeSpriteUrl(entrySpriteUrl(e,e.spriteName||e.name,e.gender));
}
// Build canvas-safe fallback chain for the export image
// Uses the same multi-source cascade as inline images
function exportSpriteFallbackUrls(e){
  const chain=spriteFallbackChain(e.no,e.spriteName||e.name,e.gender,e.dn);
  const context=spriteCatalogContext(e.no,e.spriteName||e.name,e.dn||e.name,e.catalogId);
  const reviewed=costumeSpriteCatalogDomain.resolution({names:context.lookupKeys,gender:e.gender});
  const regionalPrefix=Object.freeze({alolan:'A',galarian:'G',hisuian:'H',paldean:'P'});
  const compatibilityKeys=[...context.lookupKeys];
  for(const value of [e.spriteName,e.name,e.dn]){
    const match=String(value||'').match(/^(.+?)\s*\((Alolan|Galarian|Hisuian|Paldean)\s+Forme?\)$/i);
    if(match)compatibilityKeys.push(`${regionalPrefix[match[2].toLowerCase()]}-${match[1].trim()}`);
  }
  const mappedHome=reviewed?.knownVariant?[]:[...new Set(compatibilityKeys.flatMap(key=>[COSTUME_FORM_SPRITE_IDS[key],REGIONAL_FORM_IDS[key]]).filter(Boolean))]
    .map(id=>`${SPRITE_BASE}other/home/${id}.png`);
  const highQuality=[...mappedHome,...publicSpriteUrls(e.spriteName||e.name,e.gender,e.no)];
  // A stored override is useful only when it is on the reviewed runtime allowlist.
  const approvedOverride=isApprovedRuntimeSpriteUrl(e.spriteUrl)?e.spriteUrl:'';
  return[...new Set([...highQuality,approvedOverride,...chain].filter(Boolean).map(canvasSafeSpriteUrl).filter(Boolean))];
}
function loadCanvasImage(url){
  if(!url)return Promise.resolve(null);
  if(canvasImageCache.has(url))return canvasImageCache.get(url);
  const p=new Promise(resolve=>{
    const img=new Image();
    img.crossOrigin='anonymous';
    img.onload=()=>resolve(img);
    img.onerror=()=>resolve(null);
    img.src=url;
  });
  canvasImageCache.set(url,p);
  return p;
}
// Load with cascading fallback — try each URL in order until one succeeds
async function loadCanvasImageWithFallback(urls){
  for(const url of urls){
    const img=await loadCanvasImage(url);
    if(img&&canvasImageHasVisiblePixels(img))return img;
  }
  return null;
}
function canvasImageHasVisiblePixels(img){
  if(canvasImageUsableCache.has(img))return canvasImageUsableCache.get(img);
  if(!img?.naturalWidth||!img?.naturalHeight)return false;
  let ok=true;
  try{
    const max=96;
    const ratio=Math.min(1,max/img.naturalWidth,max/img.naturalHeight);
    const w=Math.max(1,Math.round(img.naturalWidth*ratio));
    const h=Math.max(1,Math.round(img.naturalHeight*ratio));
    const c=document.createElement('canvas');
    c.width=w;c.height=h;
    const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(img,0,0,w,h);
    const data=g.getImageData(0,0,w,h).data;
    let visible=0,alphaTotal=0;
    for(let i=3;i<data.length;i+=4){
      const a=data[i];
      if(a>12){visible++;alphaTotal+=a;}
    }
    // Some remote sprite hosts successfully load transparent placeholders.
    // Treat those as failures so export falls through to the next sprite source.
    ok=visible>=8&&alphaTotal>=900;
  }catch{
    // If the browser refuses pixel inspection, keep the image instead of
    // accidentally rejecting all CORS-restricted fallbacks.
    ok=true;
  }
  canvasImageUsableCache.set(img,ok);
  return ok;
}
function roundedRect(ctx,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
}
function drawWrappedText(ctx,text,x,y,maxW,lineH,maxLines){
  const words=String(text||'').split(/\s+/).filter(Boolean);
  const lines=[];let line='';
  words.forEach(w=>{
    const test=line?line+' '+w:w;
    if(ctx.measureText(test).width<=maxW||!line)line=test;
    else{lines.push(line);line=w;}
  });
  if(line)lines.push(line);
  const shown=lines.slice(0,maxLines);
  if(lines.length>maxLines){
    let last=shown[shown.length-1];
    while(last&&ctx.measureText(last+'…').width>maxW)last=last.slice(0,-1);
    shown[shown.length-1]=(last||'').trim()+'…';
  }
  shown.forEach((l,i)=>ctx.fillText(l,x,y+i*lineH));
  return shown.length*lineH;
}
function drawImageContain(ctx,img,x,y,w,h){
  const box=imageTrimBox(img);
  // Scale to fit within 92% of the cell, ensuring all Pokemon appear at consistent visual size
  const targetW=w*0.92,targetH=h*0.92;
  const r=Math.min(targetW/box.sw,targetH/box.sh);
  const dw=box.sw*r,dh=box.sh*r;
  ctx.drawImage(img,box.sx,box.sy,box.sw,box.sh,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
}
const imageTrimCache=new WeakMap();
function imageTrimBox(img){
  const fallback={sx:0,sy:0,sw:img.naturalWidth||1,sh:img.naturalHeight||1};
  if(imageTrimCache.has(img))return imageTrimCache.get(img);
  if(!img.naturalWidth||!img.naturalHeight)return fallback;
  let box=fallback;
  try{
    const c=document.createElement('canvas');
    c.width=img.naturalWidth;c.height=img.naturalHeight;
    const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(img,0,0);
    const {data,width,height}=g.getImageData(0,0,c.width,c.height);
    let minX=width,minY=height,maxX=-1,maxY=-1;
    for(let py=0;py<height;py++){
      for(let px=0;px<width;px++){
        if(data[(py*width+px)*4+3]>10){
          if(px<minX)minX=px;if(px>maxX)maxX=px;
          if(py<minY)minY=py;if(py>maxY)maxY=py;
        }
      }
    }
    if(maxX>=minX&&maxY>=minY)box={sx:minX,sy:minY,sw:maxX-minX+1,sh:maxY-minY+1};
  }catch{}
  imageTrimCache.set(img,box);
  return box;
}
function drawSpriteFallback(ctx,e,x,y,size){
  const reviewed=costumeSpriteCatalogDomain.resolution({names:[e?.spriteName||e?.name,e?.dn].filter(Boolean),gender:e?.gender});
  roundedRect(ctx,x,y,size,size,8);
  ctx.fillStyle='#eef2ff';ctx.fill();
  ctx.strokeStyle=reviewed.knownVariant?'rgba(99,102,241,.5)':'rgba(99,102,241,.22)';ctx.stroke();
  ctx.fillStyle='#5b5ce2';
  ctx.font='700 15px Space Grotesk, sans-serif';
  ctx.textAlign='center';
  ctx.fillText(reviewed.knownVariant?'?':String(e.dn||'?').slice(0,2).toUpperCase(),x+size/2,y+size/2+6);
  ctx.textAlign='left';
}
function maxCrownSvg(maxType){
  if(!maxType)return'';
  const isGmax=maxType==='gmax'||maxType===true;
  const chip=isGmax?'G':'D';
  return`<img class="max-crown" src="${MAX_CLOUD_URL}" alt="" aria-hidden="true" loading="lazy"><span class="max-chip ${isGmax?'gmax-chip':'dmax-chip'}">${chip}</span>`;
}
function maxMarkForEntry(e,type){
  const mt=maxTypeForEntry(e,type);
  return mt==='gmax'?'G':mt==='dynamax'?'D':'';
}
function canvasBlob(canvas){
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not render image')),'image/png'));
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function shouldUseNativeImageShare(){
  if(typeof navigator==='undefined'||typeof window==='undefined')return false;
  const ua=navigator.userAgent||'';
  const isiPadOS=navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
  const mobileUA=/Android|iPhone|iPad|iPod/i.test(ua)||isiPadOS;
  const coarsePointer=typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches;
  const narrowViewport=window.innerWidth<=900;
  return mobileUA||(coarsePointer&&narrowViewport);
}
async function deliverImageBlob(blob,filename,title='PoGo Trades image'){
  if(shouldUseNativeImageShare()&&typeof navigator!=='undefined'&&navigator.canShare&&typeof File!=='undefined'){
    const file=new File([blob],filename,{type:blob.type||'image/png'});
    try{
      if(navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title});
        return 'shared';
      }
    }catch(e){
      if(e?.name==='AbortError')return 'cancelled';
      console.warn('Native image share failed, falling back to download',e);
    }
  }
  downloadBlob(blob,filename);
  return 'downloaded';
}
function drawFittedText(ctx,text,x,y,maxW,{weight=800,max=28,min=18,color='#111827'}={}){
  let size=max;
  do{
    ctx.font=`${weight} ${size}px Space Grotesk, sans-serif`;
    if(ctx.measureText(text).width<=maxW||size<=min)break;
    size-=1;
  }while(size>=min);
  ctx.fillStyle=color;
  ctx.fillText(text,x,y);
  return size;
}
function drawCenteredFittedText(ctx,text,x,y,maxW,{weight=800,max=24,min=14,color='#fff'}={}){
  let size=max;
  do{
    ctx.font=`${weight} ${size}px Space Grotesk, sans-serif`;
    if(ctx.measureText(text).width<=maxW||size<=min)break;
    size-=1;
  }while(size>=min);
  ctx.fillStyle=color;
  ctx.textAlign='center';
  ctx.fillText(text,x,y);
  ctx.textAlign='left';
  return size;
}
function scatterbugPatternLabel(e){
  const label=String(e?.dn||e?.displayName||e?.name||'');
  const m=label.match(/^Scatterbug\s*\(([^)]+)\)/i);
  return m?m[1]:'';
}
function spindaExportPatternLabel(e){
  const label=String(e?.dn||e?.displayName||e?.name||'');
  const name=String(e?.name||'');
  if(parseInt(e?.no)!==327&&!/^Spinda\b/i.test(label)&&!/^Spinda\b/i.test(name))return'';
  const raw=String(e?.mod||'').trim();
  const text=`${label} ${name} ${raw}`;
  const m=text.match(/\b(?:form|pattern|no\.?|#)?\s*([1-9])\b/i);
  if(m)return m[1];
  return /\bheart\b/i.test(text)?'♥':'';
}
function exportEntryNoteLabel(e){
  const labels=[];
  const addLabel=label=>{
    label=String(label||'').trim();
    if(label&&!labels.some(x=>x.toLowerCase()===label.toLowerCase()))labels.push(label);
  };
  const spinda=spindaExportPatternLabel(e);
  addLabel(spinda);
  if(e?.backgroundId)addLabel(`${backgroundShortLabel(e.backgroundId)} BG`);
  let text=String(e?.mod||'').trim().replace(/\s+/g,' ');
  if(spinda){
    text=text
      .replace(/\b(?:form|pattern|no\.?|#)?\s*[1-9]\b/ig,' ')
      .replace(/\bheart\b/ig,' ')
      .replace(/^[\s,;:/&-]+|[\s,;:/&-]+$/g,'')
      .replace(/\s+/g,' ');
  }
  if(text&&!/^(?:m|f|male|female)$/i.test(text)){
    text=text
      .replace(/\bxs\b/gi,'XS')
      .replace(/\bxxs\b/gi,'XXS')
      .replace(/\bxxl\b/gi,'XXL')
      .replace(/\bantique\b/gi,'Antique')
      .replace(/\bphony\b/gi,'Phony');
    addLabel(text);
  }
  const noteHasXxs=/\bXXS\b/.test(text);
  const noteHasXxl=/\bXXL\b/.test(text);
  if(e?.xxs&&!noteHasXxs)addLabel('XXS');
  if(e?.xxl&&!noteHasXxl)addLabel('XXL');
  text=labels.join(' · ');
  if(text.length>20)text=text.slice(0,19).trimEnd()+'…';
  return text;
}
function drawScatterbugExportLabel(ctx,e,x,y,w,{dark=false}={}){
  const label=scatterbugPatternLabel(e);
  if(!label)return;
  const maxW=Math.max(28,w-8);
  let text=label;
  ctx.font='800 7.5px Space Grotesk, sans-serif';
  while(text.length>4&&ctx.measureText(text).width>maxW-8)text=text.slice(0,-1);
  if(text!==label)text=text.trim()+'…';
  const tw=Math.min(maxW,ctx.measureText(text).width+8);
  const bx=x+(w-tw)/2,by=y+3;
  roundedRect(ctx,bx,by,tw,11,5);
  ctx.fillStyle=dark?'rgba(15,23,42,.82)':'rgba(15,23,42,.74)';
  ctx.fill();
  ctx.strokeStyle=dark?'rgba(167,139,250,.55)':'rgba(255,255,255,.75)';
  ctx.lineWidth=0.75;
  ctx.stroke();
  ctx.fillStyle='#ffffff';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillText(text,bx+tw/2,by+6);
  ctx.textAlign='left';
  ctx.textBaseline='alphabetic';
}
function drawExportEntryNoteLabel(ctx,e,x,y,w,h,{dark=false}={}){
  const label=exportEntryNoteLabel(e);
  if(!label)return;
  const maxW=Math.max(20,w-8);
  let text=label;
  ctx.font='800 9px Space Grotesk, sans-serif';
  while(text.length>2&&ctx.measureText(text).width>maxW-8)text=text.slice(0,-1);
  if(text!==label)text=text.trim()+'…';
  const tw=Math.min(maxW,ctx.measureText(text).width+10);
  const bx=x+(w-tw)/2,by=y+h-15;
  roundedRect(ctx,bx,by,tw,13,6);
  ctx.fillStyle=dark?'rgba(15,23,42,.88)':'rgba(15,23,42,.78)';
  ctx.fill();
  ctx.strokeStyle=dark?'rgba(167,139,250,.65)':'rgba(255,255,255,.82)';
  ctx.lineWidth=0.75;
  ctx.stroke();
  ctx.fillStyle='#ffffff';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillText(text,bx+tw/2,by+7);
  ctx.textAlign='left';
  ctx.textBaseline='alphabetic';
}
// Family-clustering sort: groups Pokemon variants (Vivillon, Unown, Furfrou, regional forms)
// together. Primary key = dex number, secondary = family-base name (strips parens/regional prefix),
// tertiary = full name. So all dex 666 entries cluster, all "Vivillon (X)" stay together inside.
function _familyBase(name,dn){
  const s=String(dn||name||'').trim();
  // Strip parenthetical form descriptor: "Vivillon (Garden)" → "Vivillon"
  const noParens=s.split('(')[0].trim();
  // Strip regional prefix: "A-Raichu" → "Raichu" so all Raichus cluster across regions
  return noParens.replace(/^[AGHP]-/,'').toLowerCase();
}
function _familySort(a,b){
  const da=parseInt(a.no)||9999,db=parseInt(b.no)||9999;
  if(da!==db)return da-db;
  const fa=_familyBase(a.name,a.dn),fb=_familyBase(b.name,b.dn);
  if(fa!==fb)return fa.localeCompare(fb);
  // Within same family, sort alphabetically (puts "Vivillon (Archipelago)" before "Vivillon (Garden)")
  return String(a.dn||a.name||'').localeCompare(String(b.dn||b.name||''),undefined,{numeric:true,sensitivity:'base'});
}

async function renderListImage(entries,type,username,style='classic'){
  if(style==='cards')return renderListImageCards(entries,type,username);
  const W=560,frame=0,pad=6,gap=0,cols=6;
  const cellW=(W-frame*2-pad*2-gap*(cols-1))/cols,cellH=72,sprSize=68;
  // Cluster variants from same family together within each priority group
  const groupDefs=['H','M','L'].map(p=>({p,label:priLabel(p),entries:entries.filter(e=>e.p===p).sort(_familySort)}));
  const groups=groupDefs.filter(g=>g.entries.length);
  const headerH=64,groupTitleH=28,sectionPad=4,sectionGap=0,bottomPad=12;
  let H=frame+headerH+bottomPad;
  groups.forEach(g=>{H+=groupTitleH+sectionPad*2+Math.ceil(g.entries.length/cols)*cellH+sectionGap;});
  const canvas=document.createElement('canvas');
  const scale=2;
  canvas.width=W*scale;canvas.height=Math.max(H,360)*scale;
  const ctx=canvas.getContext('2d');
  ctx.scale(scale,scale);
  // High-quality resampling so low-res (PokeAPI 96px) sprites upscale cleanly
  // and high-res (PokemonDB 256px) sprites downscale without aliasing — yields a
  // more visually consistent grid across heterogeneous sprite sources.
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  const fullH=canvas.height/scale;
  // Dark professional background
  ctx.fillStyle='#0f1419';ctx.fillRect(0,0,W,fullH);

  // Header with gradient
  const headerGrad=ctx.createLinearGradient(0,0,W,0);
  headerGrad.addColorStop(0,'#1e293b');
  headerGrad.addColorStop(1,'#334155');
  ctx.fillStyle=headerGrad;ctx.fillRect(0,0,W,headerH);
  // Accent line below header
  ctx.fillStyle='#6366f1';ctx.fillRect(0,headerH-2,W,2);

  const title=`${username}'s ${listLabel(type)} List`;
  drawCenteredFittedText(ctx,title,W/2,28,W-32,{max:20,min:14,color:'#ffffff'});
  ctx.font='600 11px Space Grotesk, sans-serif';
  ctx.fillStyle='rgba(255,255,255,.6)';
  const date=new Date().toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  ctx.textAlign='center';
  ctx.fillText(`${entries.length} Pokémon · ${date}`,W/2,48);
  ctx.textAlign='left';

  // Load with cascading fallback — try PokeAPI → Serebii for each entry
  const entryImagePromises=entries.map(async e=>{
    const primaryUrl=exportSpriteUrl(e);
    const img=await loadCanvasImageWithFallback(exportSpriteFallbackUrls(e));
    return[primaryUrl,img];
  });
  const cloudPromise=entries.some(e=>maxMarkForEntry(e,type))
    ?loadCanvasImage(canvasSafeSpriteUrl(MAX_CLOUD_URL)).then(img=>[canvasSafeSpriteUrl(MAX_CLOUD_URL),img])
    :Promise.resolve(null);
  const results=await Promise.all([...entryImagePromises,cloudPromise]);
  const images=new Map(results.filter(Boolean));
  const priColors={H:'#ef4444',M:'#f59e0b',L:'#10b981','':'#8888aa'};
  const priBgColors={H:'rgba(239,68,68,.08)',M:'rgba(245,158,11,.08)',L:'rgba(16,185,129,.08)'};
  let y=frame+headerH;
  groups.forEach(group=>{
    // Group title bar — colored to match priority
    const titleColor=priColors[group.p]||'#64748b';
    ctx.fillStyle='#1a2332';ctx.fillRect(frame,y,W-frame*2,groupTitleH);
    // Left accent bar in priority color
    ctx.fillStyle=titleColor;ctx.fillRect(frame,y,4,groupTitleH);
    ctx.fillStyle='#fff';
    ctx.font='700 13px Space Grotesk, sans-serif';
    ctx.fillText(`${group.label}`,frame+14,y+18);
    ctx.fillStyle='rgba(255,255,255,.5)';
    ctx.font='600 12px Space Grotesk, sans-serif';
    ctx.fillText(`${group.entries.length}`,frame+14+ctx.measureText(group.label).width+8,y+18);
    y+=groupTitleH;
    const rows=Math.ceil(group.entries.length/cols);
    const areaH=sectionPad*2+rows*cellH;
    // White background with subtle priority tint
    ctx.fillStyle='#ffffff';ctx.fillRect(frame,y,W-frame*2,areaH);
    ctx.fillStyle=priBgColors[group.p]||'rgba(0,0,0,0)';ctx.fillRect(frame,y,W-frame*2,areaH);
    y+=sectionPad;
    group.entries.forEach((e,i)=>{
      const col=i%cols,row=Math.floor(i/cols);
      const x=frame+pad+col*(cellW+gap),cy=y+row*cellH;
      const sx=x+(cellW-sprSize)/2,sy=cy+(cellH-sprSize)/2;
      const img=images.get(exportSpriteUrl(e));
      if(img)drawImageContain(ctx,img,sx,sy,sprSize,sprSize);
      else drawSpriteFallback(ctx,e,sx,sy,sprSize);
      drawScatterbugExportLabel(ctx,e,x,cy,cellW);
      drawExportEntryNoteLabel(ctx,e,x,cy,cellW,cellH);
      // Export is a clean H/M/L view — Lucky/shiny indicators stay omitted; size notes are labeled below the sprite.
      const mark=maxMarkForEntry(e,type);
      if(mark){
        const isG=mark==='G';
        const bx=x+3,by=cy+3;
        roundedRect(ctx,bx,by,12,12,6);
        ctx.fillStyle=isG?'#7c3aed':'#dc2626';ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle='#fff';
        ctx.font='800 8px Space Grotesk, sans-serif';
        ctx.textAlign='center';
        ctx.fillText(mark,bx+6,by+9);
        ctx.textAlign='left';
      }
      // Gender badge (top-right corner). Use blue ♂ / pink ♀ pill.
      if(e.gender==='f'||e.gender==='m'){
        const isF=e.gender==='f';
        const bx=x+cellW-15,by=cy+3;
        roundedRect(ctx,bx,by,12,12,6);
        ctx.fillStyle=isF?'#ec4899':'#3b82f6';ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle='#fff';
        ctx.font='800 10px Space Grotesk, sans-serif';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(isF?'♀':'♂',bx+6,by+7);
        ctx.textBaseline='alphabetic';
        ctx.textAlign='left';
      }
    });
    y+=rows*cellH+sectionPad+sectionGap;
  });
  return canvasBlob(canvas);
}
// Dark-card style: 8-column grid where each Pokémon sits in its own bordered card
// with a priority-coloured top stripe (red H / amber M / green L). Same sprite source
// + trim/scale logic as the classic style, so icons stay consistent across both.
async function renderListImageCards(entries,type,username){
  const W=560,frame=12,pad=0,gap=6,cols=8;
  const cellW=(W-frame*2-(cols-1)*gap)/cols,cellH=cellW,sprSize=Math.floor(cellW-12);
  const groupDefs=['H','M','L'].map(p=>({p,label:priLabel(p),entries:entries.filter(e=>e.p===p).sort(_familySort)}));
  const groups=groupDefs.filter(g=>g.entries.length);
  const headerH=64,groupTitleH=26,sectionGap=12,bottomPad=16;
  let H=headerH+bottomPad;
  groups.forEach(g=>{H+=groupTitleH+Math.ceil(g.entries.length/cols)*cellH+(Math.ceil(g.entries.length/cols)-1)*gap+sectionGap;});

  const canvas=document.createElement('canvas');
  const scale=2;
  canvas.width=W*scale;canvas.height=Math.max(H,360)*scale;
  const ctx=canvas.getContext('2d');
  ctx.scale(scale,scale);
  // High-quality resampling for consistent look across mixed-resolution sources
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  const fullH=canvas.height/scale;
  // Dark background (matches app theme)
  ctx.fillStyle='#0f0f1a';ctx.fillRect(0,0,W,fullH);

  // Title block (left-aligned, large)
  ctx.textAlign='left';
  ctx.fillStyle='#ffffff';
  ctx.font='800 22px Space Grotesk, sans-serif';
  ctx.fillText(`${username}'s ${listLabel(type)} List`,frame,30);
  ctx.fillStyle='rgba(255,255,255,.55)';
  ctx.font='500 12px Space Grotesk, sans-serif';
  const date=new Date().toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  ctx.fillText(`${entries.length} Pokémon · Generated ${date}`,frame,48);
  // "PoGo Trades" branding top-right
  ctx.textAlign='right';
  ctx.fillStyle='#a78bfa';
  ctx.font='700 13px Space Grotesk, sans-serif';
  ctx.fillText('PoGo Trades',W-frame,30);
  ctx.textAlign='left';

  // Load sprites with cascading fallback (same as classic)
  const entryImagePromises=entries.map(async e=>{
    const primaryUrl=exportSpriteUrl(e);
    const img=await loadCanvasImageWithFallback(exportSpriteFallbackUrls(e));
    return[primaryUrl,img];
  });
  const cloudPromise=entries.some(e=>maxMarkForEntry(e,type))
    ?loadCanvasImage(canvasSafeSpriteUrl(MAX_CLOUD_URL)).then(img=>[canvasSafeSpriteUrl(MAX_CLOUD_URL),img])
    :Promise.resolve(null);
  const results=await Promise.all([...entryImagePromises,cloudPromise]);
  const images=new Map(results.filter(Boolean));

  const priColors={H:'#ef4444',M:'#f59e0b',L:'#10b981'};
  let y=headerH;
  groups.forEach(group=>{
    // Section header: vertical color bar + label + count
    const c=priColors[group.p]||'#64748b';
    ctx.fillStyle=c;
    roundedRect(ctx,frame,y+4,4,groupTitleH-8,2);ctx.fill();
    ctx.fillStyle='#ffffff';
    ctx.font='800 16px Space Grotesk, sans-serif';
    ctx.fillText(group.label,frame+12,y+18);
    const labelW=ctx.measureText(group.label).width;
    ctx.fillStyle='rgba(255,255,255,.4)';
    ctx.font='600 12px Space Grotesk, sans-serif';
    ctx.fillText(`${group.entries.length}`,frame+12+labelW+6,y+18);
    y+=groupTitleH;

    const rows=Math.ceil(group.entries.length/cols);
    group.entries.forEach((e,i)=>{
      const col=i%cols,row=Math.floor(i/cols);
      const x=frame+col*(cellW+gap),cy=y+row*(cellH+gap);
      // Card background
      ctx.fillStyle='#1e1e35';
      roundedRect(ctx,x,cy,cellW,cellH,8);ctx.fill();
      // Priority-coloured top stripe
      ctx.fillStyle=c;
      roundedRect(ctx,x,cy,cellW,3,2);ctx.fill();
      // Sprite (trimmed + scaled — same logic as classic)
      const sx=x+(cellW-sprSize)/2,sy=cy+(cellH-sprSize)/2+1;
      const img=images.get(exportSpriteUrl(e));
      if(img)drawImageContain(ctx,img,sx,sy,sprSize,sprSize);
      else drawSpriteFallback(ctx,e,sx,sy,sprSize);
      drawScatterbugExportLabel(ctx,e,x,cy,cellW,{dark:true});
      drawExportEntryNoteLabel(ctx,e,x,cy,cellW,cellH,{dark:true});
      // Max-form badge (Dynamax 'D' / Gigantamax 'G')
      const mark=maxMarkForEntry(e,type);
      if(mark){
        const isG=mark==='G';
        const bx=x+4,by=cy+6;
        roundedRect(ctx,bx,by,11,11,5);
        ctx.fillStyle=isG?'#7c3aed':'#dc2626';ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle='#fff';
        ctx.font='800 8px Space Grotesk, sans-serif';
        ctx.textAlign='center';
        ctx.fillText(mark,bx+5.5,by+8.5);
        ctx.textAlign='left';
      }
      // Gender badge (top-right corner)
      if(e.gender==='f'||e.gender==='m'){
        const isF=e.gender==='f';
        const bx=x+cellW-15,by=cy+6;
        roundedRect(ctx,bx,by,11,11,5);
        ctx.fillStyle=isF?'#ec4899':'#3b82f6';ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle='#fff';
        ctx.font='800 9px Space Grotesk, sans-serif';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(isF?'♀':'♂',bx+5.5,by+6);
        ctx.textBaseline='alphabetic';ctx.textAlign='left';
      }
    });
    y+=rows*cellH+(rows-1)*gap+sectionGap;
  });
  return canvasBlob(canvas);
}

async function exportMyListImage(style='classic'){
  const btn=document.querySelector('.image-btn');
  const old=btn?.textContent;
  const entries=currentListEntries(myListType).filter(e=>e.p&&PRI[e.p]);
  if(!entries.length){toast(i18nCore.t('export.priorityRequired'));return;}
  try{
    if(btn){btn.disabled=true;btn.textContent=i18nCore.t('export.buildingImage');}
    const blob=await renderListImage(entries,myListType,cur,style);
    const styleTag=style==='cards'?'-darkcards':'';
    const filename=`pogo-${safeFilePart(cur)}-${safeFilePart(listLabel(myListType))}${styleTag}-${new Date().toISOString().slice(0,10)}.png`;
    const delivery=await deliverImageBlob(blob,filename,`${cur}'s ${listLabel(myListType)} List`);
    // Remember user's last choice for future exports
    try{lsSet('pogoExportStyle',style);}catch{}
    if(delivery==='cancelled')toast(i18nCore.t('export.cancelled'));
    else toast(i18nCore.t(delivery==='shared'?'export.imageReady':'export.imageSaved'));
  }catch(e){
    console.error(e);
    toast(i18nCore.t('export.failed'));
  }finally{
    if(btn){btn.disabled=false;btn.textContent=old;}
  }
}

// ── DRAG TO REORDER ───────────────────────────────────────────
function dragStart(e){
  if(!reorderMode){e.preventDefault();return;}
  dragSrc=e.currentTarget;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',e.currentTarget.dataset.name);
}
function dragOver(e){
  if(!reorderMode)return;
  e.preventDefault();e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.myrow').forEach(r=>r.classList.remove('drag-over','drag-rejected'));
  e.currentTarget.classList.add(dragSrc?.dataset.priority===e.currentTarget.dataset.priority?'drag-over':'drag-rejected');
}
function dragDrop(e){
  e.preventDefault();
  if(!reorderMode)return;
  const targetName=e.currentTarget.dataset.name;
  const srcName=e.dataTransfer.getData('text/plain');
  reorderMyListEntry(srcName,targetName);
}
async function reorderMyListEntry(srcName,targetName,{focus=true}={}){
  if(!reorderMode||!srcName||!targetName||srcName===targetName)return false;
  const session={uid:String(auth?.currentUser?.uid||''),username:cur};
  const list={...(allData[myListType]?.[cur]||{})};
  const sourcePriority=parsePri(list[srcName]||'').p,targetPriority=parsePri(list[targetName]||'').p;
  if(sourcePriority!==targetPriority){announceMyListAction(i18nCore.t('myList.reorderWithinPriority'));return false;}
  const model=currentMyListOrderModel(myListType,cur),priority=myListOrderPriorityKey(sourcePriority);
  const names=model.priorities[priority],si=names.indexOf(srcName),ti=names.indexOf(targetName);
  if(si<0||ti<0)return false;
  names.splice(si,1);names.splice(ti,0,srcName);
  const authority=await accountSyncMutationAuthority();
  if(session.username!==cur||session.uid!==String(auth?.currentUser?.uid||''))return false;
  if(authority.mode==='blocked'){toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);return false;}
  if(authority.mode==='canonical'){
    const result=await writeAccountSyncList(myListType,list,{orderModel:model,authority});
    if(!result?.ok||!accountSyncAuthorityCurrent(authority)){toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);return false;}
  }
  if(session.username!==cur||session.uid!==String(auth?.currentUser?.uid||''))return false;
  if(!persistMyListOrder(model,myListType,session.username))return false;
  renderMyList();
  const position=names.indexOf(srcName)+1;
  announceMyListAction(i18nCore.t('myList.movedPosition',{name:srcName,position:i18nCore.formatNumber(position),count:i18nCore.formatNumber(names.length)}));
  if(focus)requestAnimationFrame(()=>[...document.querySelectorAll('.myrow')].find(row=>row.dataset.name===srcName)?.querySelector('.drag-handle')?.focus({preventScroll:true}));
  return true;
}
function moveMyListEntry(name,direction){
  if(!reorderMode||![-1,1].includes(direction))return false;
  const entry=currentListEntries(myListType).find(item=>item.name===name);if(!entry)return false;
  const group=currentListEntries(myListType).filter(item=>item.p===entry.p),index=group.findIndex(item=>item.name===name),target=group[index+direction];
  if(!target)return false;
  return reorderMyListEntry(name,target.name);
}
function clearMyListPointerDrag(){
  document.querySelectorAll('.myrow').forEach(row=>row.classList.remove('pointer-dragging','drag-over','drag-rejected'));
  myListPointerDrag=null;
}
function myListPointerStart(e){
  if(!reorderMode||bulkMode)return;
  const row=e.currentTarget.closest('.myrow');if(!row)return;
  e.preventDefault();
  try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}
  myListPointerDrag={pointerId:e.pointerId,sourceName:row.dataset.name,targetName:row.dataset.name,sourcePriority:row.dataset.priority};
  row.classList.add('pointer-dragging');
}
function myListPointerMove(e){
  if(!myListPointerDrag||myListPointerDrag.pointerId!==e.pointerId)return;
  e.preventDefault();
  const row=document.elementFromPoint(e.clientX,e.clientY)?.closest('.myrow');if(!row)return;
  myListPointerDrag.targetName=row.dataset.name;
  document.querySelectorAll('.myrow').forEach(item=>item.classList.remove('drag-over','drag-rejected'));
  row.classList.add(row.dataset.priority===myListPointerDrag.sourcePriority?'drag-over':'drag-rejected');
}
function myListPointerEnd(e){
  if(!myListPointerDrag||myListPointerDrag.pointerId!==e.pointerId)return;
  const{sourceName,targetName}=myListPointerDrag;
  clearMyListPointerDrag();
  return reorderMyListEntry(sourceName,targetName);
}
function myListPointerCancel(e){
  if(myListPointerDrag&&myListPointerDrag.pointerId===e.pointerId)clearMyListPointerDrag();
}
function announceMyListAction(message){
  const status=document.getElementById('mylist-action-status');if(status){status.textContent='';requestAnimationFrame(()=>{status.textContent=message;});}
  toast(message);
}
function toggleReorderMode(force){
  reorderMode=typeof force==='boolean'?force:!reorderMode;
  document.body.classList.toggle('reorder-mode',reorderMode);
  const button=document.getElementById('mylist-reorder-toggle');if(button){button.setAttribute('aria-pressed',String(reorderMode));button.querySelector('span').textContent=i18nCore.t(reorderMode?'common.done':'myList.reorder');}
  renderMyList();
  announceMyListAction(i18nCore.t(reorderMode?'myList.reorderOn':'myList.reorderOff'));
}
async function movePriority(name,p){
  if(!['H','M','L'].includes(p))return;
  const list={...(allData[myListType]?.[cur]||{})};if(!Object.prototype.hasOwnProperty.call(list,name))return;
  const current=parsePri(list[name]||'');if(current.p===p)return;
  if(!requireOwnedListHydration(myListType,cur))return;
  const model=currentMyListOrderModel(myListType,cur),sourceKey=myListOrderPriorityKey(current.p),targetKey=myListOrderPriorityKey(p);
  model.priorities[sourceKey]=model.priorities[sourceKey].filter(entryName=>entryName!==name);
  model.priorities[targetKey]=model.priorities[targetKey].filter(entryName=>entryName!==name);
  model.priorities[targetKey].push(name);
  list[name]=priValue(p,current.mod,current.lucky,current.xxl,current.xxs,current.shiny,current.backgroundId);
  if(!await writeList(myListType,cur,list,{orderModel:model}))return;
  persistMyListOrder(model,myListType,cur);
  renderMyList();
  announceMyListAction(i18nCore.t('myList.priorityChanged',{name,priority:i18nCore.t({'H':'priority.high','M':'priority.medium','L':'priority.low'}[p])}));
  requestAnimationFrame(()=>[...document.querySelectorAll('.myrow')].find(row=>row.dataset.name===name)?.querySelector('.myrow-edit')?.focus({preventScroll:true}));
}
function dragEnd(e){
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.myrow').forEach(r=>r.classList.remove('drag-over','drag-rejected'));
  dragSrc=null;
}

async function setPri(name,p){
  const list={...(allData[myListType]?.[cur]||{})};
  const{p:curP,mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(list[name]||'');
  // Toggle: clicking the same priority clears it
  const newP=curP===p?'':p;
  // If clearing leaves entry empty (no priority + no flags), confirm delete
  if(!newP&&!lucky&&!xxl&&!xxs&&!shiny&&!backgroundId){
    if(!confirm(`"${name}" will have no priority or flags. Remove it from your list?`))return;
    delete list[name];
    if(!await writeList(myListType,cur,list))return;
    return;
  }
  list[name]=priValue(newP,mod,lucky,xxl,xxs,shiny,backgroundId);
  if(!await writeList(myListType,cur,list))return;
}
async function setNotes(name,notes){
  const list={...(allData[myListType]?.[cur]||{})};
  const{p,lucky,xxl,xxs,shiny,backgroundId}=parsePri(list[name]||'');
  list[name]=priValue(p,notes,lucky,xxl,xxs,shiny,backgroundId);
  if(!await writeList(myListType,cur,list))return;
}
async function _setFlags(name,update){
  const list={...(allData[myListType]?.[cur]||{})};
  const{p,mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(list[name]||'');
  const next=update({p,mod,lucky,xxl,xxs,shiny,backgroundId});
  // If toggling off leaves entry empty, confirm delete
  if(!next.p&&!next.lucky&&!next.xxl&&!next.xxs&&!next.shiny&&!next.backgroundId){
    if(!confirm(`"${name}" will have no priority or flags. Remove it from your list?`))return;
    delete list[name];
    if(!await writeList(myListType,cur,list))return;
    return;
  }
  list[name]=priValue(next.p,next.mod,next.lucky,next.xxl,next.xxs,next.shiny,next.backgroundId);
  if(!await writeList(myListType,cur,list))return;
}
async function setLucky(name){await _setFlags(name,s=>({...s,lucky:!s.lucky}));}
async function setXxl(name){await _setFlags(name,s=>{const nx=!s.xxl;return{...s,xxl:nx,xxs:nx?false:s.xxs};});}
async function setXxs(name){await _setFlags(name,s=>{const ns=!s.xxs;return{...s,xxs:ns,xxl:ns?false:s.xxl};});}
async function setShiny(name){await _setFlags(name,s=>({...s,shiny:!s.shiny}));}
async function setBackground(name,backgroundId){
  const list={...(allData[myListType]?.[cur]||{})};if(!Object.prototype.hasOwnProperty.call(list,name))return;
  const parsed=parsePri(list[name]);
  list[name]=priValue(parsed.p,parsed.mod,parsed.lucky,parsed.xxl,parsed.xxs,parsed.shiny,backgroundId);
  if(!await writeList(myListType,cur,list))return;
  renderMyList();
}
async function removeEntry(name){
  if(!requireOwnedListHydration(myListType,cur))return;
  const srcArr=listSource(myListType);
  const sourceEntry=srcArr.find(x=>x.name===name),dn=sourceEntry?pokemonDisplayName(sourceEntry):name;
  const row=[...document.querySelectorAll('.myrow')].find(r=>r.dataset.name===name);
  const focusTarget=row?.nextElementSibling?.querySelector('.myrow-edit,.myrow-remove')||row?.previousElementSibling?.querySelector('.myrow-edit,.myrow-remove');
  const commitRemoval=async()=>{
    if(!await writeListItem(myListType,cur,name,null)){row?.classList.remove('removing');if(row)row.style.transform='';return;}
    announceMyListAction(i18nCore.t('myList.removed',{name:dn}));
    requestAnimationFrame(()=>{
      if(focusTarget?.isConnected)focusTarget.focus();
      else document.getElementById('mylist-filter')?.focus();
    });
  };
  if(row){
    row.classList.add('removing');
    setTimeout(sessionTransientCallback(commitRemoval),220);
  }else await commitRemoval();
}

// ── SEARCH STRINGS ────────────────────────────────────────────
function buildStrings(type,username){
  const list=allData[type]?.[username]||{};
  if(!Object.keys(list).length)return null;
  const searchOptions={locale:pokemonGoSearchLocale()};
  if(type==='costumes'){
    const costumeNoMap={};
    allCostumeEntries().forEach(e=>(e.legacyAliases||[e.name]).forEach(alias=>{if(e.no)costumeNoMap[alias]=e.no;}));
    const byP={H:[],M:[],L:[]},luckyDex=[],shinyDex=[],xxlDex=[],xxsDex=[];
    Object.entries(list).forEach(([name,val])=>{
      const{p,lucky,shiny,xxl,xxs}=parsePri(val);
      let no=costumeNoMap[name];
      if(!no){const sp=spriteEntryForListItem('costumes',name,pokemonEntryForLegacyKey(allCostumeEntries(),name)||{});no=sp?.no||null;}
      const dex=parseInt(no);
      if(!Number.isFinite(dex))return;
      if(p&&byP[p])byP[p].push(dex);
      if(!p&&lucky)luckyDex.push(dex);
      if(!p&&shiny)shinyDex.push(dex);
      if(!p&&xxl)xxlDex.push(dex);
      if(!p&&xxs)xxsDex.push(dex);
    });
    const out={};
    ['H','M','L'].forEach(p=>{
      if(!byP[p].length)return;
      out[p]=dexStringFromNumbers(byP[p],searchOptions);
    });
    const luckyStr=dexStringFromNumbers(luckyDex,searchOptions);if(luckyStr)out.LUCKY=luckyStr;
    const shinyStr=dexStringFromNumbers(shinyDex,searchOptions);if(shinyStr)out.SHINY=shinyStr;
    const xxlStr=dexStringFromNumbers(xxlDex,searchOptions);if(xxlStr)out.XXL=xxlStr;
    const xxsStr=dexStringFromNumbers(xxsDex,searchOptions);if(xxsStr)out.XXS=xxsStr;
    return Object.keys(out).length?out:null;
  }
  const srcArr=listSource(type);
  const nameToEntry={},dexHasRegional={};
  srcArr.forEach(e=>{
    if(!e.no)return;
    (e.legacyAliases||[e.name]).forEach(alias=>{if(!nameToEntry[alias])nameToEntry[alias]=e;});
    if(regionalFormTerm(e.name))dexHasRegional[e.no]=true;
  });
  const byP={H:[],M:[],L:[]},luckyItems=[],shinyItems=[],xxlItems=[],xxsItems=[];
  Object.entries(list).forEach(([name,val])=>{
    const{p,mod,lucky,shiny,xxl,xxs}=parsePri(val);
    const entry=nameToEntry[name];if(!entry?.no)return;
    const effectiveEntry={...entry,maxType:maxTypeForEntry(entry,type)};
    const term=dexSearchTerm(effectiveEntry,dexHasRegional);if(!term)return;
    const item={term,filters:entrySearchFilters(effectiveEntry,mod)};
    if(p&&byP[p])byP[p].push(item);
    if(!p&&lucky)luckyItems.push(item);
    if(!p&&shiny)shinyItems.push(item);
    if(!p&&xxl)xxlItems.push(item);
    if(!p&&xxs)xxsItems.push(item);
  });
  const out={};
  ['H','M','L'].forEach(p=>{
    if(!byP[p].length)return;
    out[p]=stringFromSearchItems(byP[p],searchOptions);
  });
  const luckyStr=stringFromSearchItems(luckyItems,searchOptions);if(luckyStr)out.LUCKY=luckyStr;
  const shinyStr=stringFromSearchItems(shinyItems,searchOptions);if(shinyStr)out.SHINY=shinyStr;
  const xxlStr=stringFromSearchItems(xxlItems,searchOptions);if(xxlStr)out.XXL=xxlStr;
  const xxsStr=stringFromSearchItems(xxsItems,searchOptions);if(xxsStr)out.XXS=xxsStr;
  return Object.keys(out).length?out:null;
}

function myListSearchLabel(levels){
  if(levels.length===3)return i18nCore.t('strings.allPriorities');
  if(levels.length===1)return publicSharePriorityLabel(levels[0]);
  return i18nCore.t('share.priorityCombination',{first:publicSharePriorityLabel(levels[0]),second:publicSharePriorityLabel(levels[1])});
}
function toggleMyListSearchString(button){
  const raw=document.getElementById(button.getAttribute('aria-controls'));
  if(!raw)return;
  const open=raw.hidden;
  raw.hidden=!open;
  button.setAttribute('aria-expanded',String(open));
  const label=button.querySelector('[data-view-label]');if(label)label.textContent=i18nCore.t(open?'strings.hideString':'strings.viewString');
}
function toggleMyListMoreCombinations(button){
  const body=document.getElementById(button.getAttribute('aria-controls'));
  if(!body)return;
  const open=body.hidden;
  body.hidden=!open;
  button.setAttribute('aria-expanded',String(open));
}
function myListSearchActionHtml(value,label,key,{tooLong=false}={}){
  const id=`mylist-search-raw-${key}`;
  return`<div class="mylist-search-actions">
    ${tooLong?'':`<button class="cpbtn mylist-search-action" type="button" data-copy="${escAttr(value)}" onclick="copyStr(this.dataset.copy,this)" aria-label="${escAttr(i18nCore.t('strings.copyScoped',{label}))}">${uiIconMarkup('copy','ui-icon ui-icon-sm')}<span>${escHtml(i18nCore.t('share.copy'))}</span></button>`}
    <button class="mylist-search-view mylist-search-action" type="button" aria-expanded="false" aria-controls="${id}" onclick="toggleMyListSearchString(this)"><span data-view-label>${escHtml(i18nCore.t('strings.viewString'))}</span><span class="collapse-icon" aria-hidden="true">${uiIconMarkup('chevron-down','ui-icon ui-icon-sm')}</span></button>
  </div><div class="strbox mylist-search-raw" id="${id}" hidden>${escHtml(value)}</div>`;
}
function myListSearchOptionHtml(option,key,{label=myListSearchLabel(option.levels),showLimit=true}={}){
  return`<div class="mylist-search-option" data-search-option="${key}"><div class="mylist-search-option-head"><div class="mylist-search-option-summary"><span class="mylist-search-option-icon" aria-hidden="true">${uiIconMarkup('search','ui-icon ui-icon-sm')}</span><div class="mylist-search-option-copy"><span class="mylist-search-option-label">${escHtml(label)}</span>${showLimit?strLenHtml(option.value,{t:i18nCore.t,formatNumber:i18nCore.formatNumber}):''}</div></div>${option.tooLong?`<div class="mylist-search-limit" role="status">${escHtml(i18nCore.t('strings.tooLongForPokemonGo'))}</div>`:''}${myListSearchActionHtml(option.value,label,key,{tooLong:option.tooLong})}</div></div>`;
}
function renderMyStrings(){
  const el=document.getElementById('my-strings-out');if(!el)return;
  const strs=buildStrings(myListType,cur);
  const heading=document.querySelector('.my-string-heading');
  document.querySelectorAll('[data-priority-search],[data-dex-search]').forEach(footer=>{footer.innerHTML='';});
  if(!strs){if(heading)heading.hidden=true;el.innerHTML='';return;}
  ['H','M','L'].forEach(priority=>{
    const footer=document.querySelector(`[data-priority-search="${priority}"]`);
    if(!footer||!strs[priority])return;
    const label=i18nCore.t('strings.prioritySearch',{priority:publicSharePriorityLabel(priority)});
    const tooLong=strLenInfo(strs[priority]).len>POGO_STR_LIMIT;
    footer.innerHTML=`<div class="mylist-search-footer"><div class="mylist-search-option-summary"><span class="mylist-search-option-icon" aria-hidden="true">${uiIconMarkup('search','ui-icon ui-icon-sm')}</span><div class="mylist-search-option-copy"><span class="mylist-search-option-label">${escHtml(label)}</span>${strLenHtml(strs[priority],{t:i18nCore.t,formatNumber:i18nCore.formatNumber})}</div></div>${tooLong?`<div class="mylist-search-limit" role="status">${escHtml(i18nCore.t('strings.tooLongForPokemonGo'))}</div>`:''}${myListSearchActionHtml(strs[priority],label,`priority-${priority}`,{tooLong})}</div>`;
  });

  const dexLabels={LUCKY:'strings.luckyDexSearch',SHINY:'strings.shinyDexSearch',XXL:'strings.xxlDexSearch',XXS:'strings.xxsDexSearch'};
  Object.entries(dexLabels).forEach(([key,labelKey])=>{
    const footer=document.querySelector(`[data-dex-search="${key}"]`);
    if(!footer||!strs[key])return;
    const label=i18nCore.t(labelKey),tooLong=strLenInfo(strs[key]).len>POGO_STR_LIMIT;
    footer.innerHTML=`<div class="mylist-search-footer"><div class="mylist-search-option-summary"><span class="mylist-search-option-icon" aria-hidden="true">${uiIconMarkup('search','ui-icon ui-icon-sm')}</span><div class="mylist-search-option-copy"><span class="mylist-search-option-label">${escHtml(label)}</span>${strLenHtml(strs[key],{t:i18nCore.t,formatNumber:i18nCore.formatNumber})}</div></div>${tooLong?`<div class="mylist-search-limit" role="status">${escHtml(i18nCore.t('strings.tooLongForPokemonGo'))}</div>`:''}${myListSearchActionHtml(strs[key],label,`dex-${key.toLowerCase()}`,{tooLong})}</div>`;
  });

  const plan=myListSearchPlan(strs,{locale:pokemonGoSearchLocale()});
  const combined=[];
  if(plan.all){
    combined.push(myListSearchOptionHtml(plan.all,'all-priorities'));
    if(plan.all.tooLong&&plan.split.length){
      combined.push(`<div class="mylist-split"><div class="mylist-split-title">${escHtml(i18nCore.t('strings.suggestedSplit'))}</div><div>${escHtml(i18nCore.t('strings.suggestedSplitHelp'))}</div>${plan.split.map((part,index)=>myListSearchOptionHtml(part,`split-${index}`,{label:myListSearchLabel(part.levels)})).join('')}</div>`);
    }
  }
  if(plan.secondary&&plan.secondary.value!==plan.all?.value)combined.push(myListSearchOptionHtml(plan.secondary,'high-medium'));
  if(plan.more.length){
    combined.push(`<div class="mylist-search-more"><button class="combo-toggle" type="button" aria-expanded="false" aria-controls="mylist-more-combinations" onclick="toggleMyListMoreCombinations(this)"><span>${escHtml(i18nCore.t('strings.moreCombinations'))}</span><span class="collapse-icon" aria-hidden="true">${uiIconMarkup('chevron-down','ui-icon ui-icon-sm')}</span></button><div class="mylist-search-more-body" id="mylist-more-combinations" hidden>${plan.more.map((option,index)=>myListSearchOptionHtml(option,`more-${index}`)).join('')}</div></div>`);
  }
  if(heading)heading.hidden=!combined.length;
  el.innerHTML=`<div class="mylist-search-groups">${combined.length?`<section class="mylist-search-section" aria-labelledby="combined-search-title"><h3 id="combined-search-title">${uiIconMarkup('list','ui-icon ui-icon-sm')}<span>${escHtml(i18nCore.t('strings.combinedSearch'))}</span></h3>${combined.join('')}</section>`:''}</div>`;
}
async function copyText(str){
  if(navigator.clipboard&&window.isSecureContext){
    try{
      await navigator.clipboard.writeText(str);
      return;
    }catch{}
  }
  const ta=document.createElement('textarea');
  ta.value=str;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.top='-1000px';ta.style.opacity='0';
  document.body.appendChild(ta);ta.focus();ta.select();ta.setSelectionRange(0,ta.value.length);
  const ok=document.execCommand('copy');
  document.body.removeChild(ta);
  if(!ok)throw new Error('Copy command failed');
}
async function copyStr(str,btn){
  const keyPrefix=btn?.dataset.copyScope==='share'?'share':'strings';
  if(btn?.dataset.copyState==='copied')return;
  try{
    await copyText(str);
    if(btn){
      const old=btn.innerHTML;
      const hadLabel=btn.hasAttribute('aria-label');
      const stableLabel=btn.getAttribute('aria-label')||btn.textContent.trim();
      if(stableLabel)btn.setAttribute('aria-label',stableLabel);
      btn.innerHTML=`${uiIconMarkup('check','ui-icon ui-icon-sm')}<span>${escHtml(i18nCore.t(`${keyPrefix}.copied`))}</span>`;
      btn.classList.add('copied');
      btn.dataset.copyState='copied';
      setTimeout(()=>{if(!btn.isConnected)return;btn.innerHTML=old;btn.classList.remove('copied');delete btn.dataset.copyState;if(!hadLabel)btn.removeAttribute('aria-label');},1200);
    }
    toast(i18nCore.t(`${keyPrefix}.copySuccess`));
  }catch{
    toast(i18nCore.t(`${keyPrefix}.copyFailed`));
  }
}

// ── STRINGS PAGE — collapsible ────────────────────────────────
function setStrList(t){
  strListType=t;
  document.querySelectorAll('#str-list-tabs .ltab').forEach((b,i)=>{
    b.classList.toggle('active',['wishlist','dynamax','gmax','costumes'][i]===t);
  });
  ensureListSubscribed(t);
  renderStrings();
}
function toggleStrUser(el){
  const block=el.closest('.user-str-block');
  const body=block.querySelector('.user-str-body');
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  block.classList.toggle('expanded',!isOpen);
  el.setAttribute('aria-expanded',String(!isOpen));
  // Snapshot for diff view when opening
  if(!isOpen){
    const username=block.dataset.username;
    if(username&&username!==cur){
      markSnapshotSeen(strListType,username);
      // Hide diff badges after viewing
      setTimeout(()=>{block.querySelectorAll('.user-str-diff-badge').forEach(b=>b.style.opacity='.5');},300);
    }
  }
}
function toggleComboStrings(btn){
  const wrap=btn.closest('.combo-wrap');
  const isOpen=wrap.classList.toggle('open');
  btn.setAttribute('aria-expanded',isOpen?'true':'false');
}
function renderStrings(){return perfTime('render:strings',()=>_renderStringsInner());}
function _renderStringsInner(){
  const el=document.getElementById('strings-out');if(!el)return;
  resetStringDiffCache();
  const q='';
  const users=[cur].filter(u=>{
    const list=allData[strListType]?.[u]||{};
    return Object.keys(list).length>0;
  });
  if(!users.length){el.innerHTML=emptyHtml(i18nCore.t('strings.noSearchStrings'),i18nCore.t('strings.addEntriesHelp'),'📋');return;}
  el.innerHTML=users.map(u=>{
    const strs=buildStrings(strListType,u);
    const ud=allData.users?.[u]||{};
    const count=Object.keys(allData[strListType]?.[u]||{}).length;
    const luColor=freshnessColor(freshnessClass(ud.lastUpdated));
    const isMe=u===cur;
    const diff=isMe?{firstVisit:true,added:[],removed:[],changed:[]}:computeSnapshotDiff(strListType,u);
    const diffBadge=diffBadgeHtml(diff);
    const diffDetails=isMe?'':diffDetailsHtml(diff,strListType,u);
    const bioHtml=ud.bio?`<div class="profile-bio-display">"${escHtml(ud.bio)}"</div>`:'';
    const discordHtml=ud.discord?`<div class="profile-discord">${escHtml(ud.discord)}</div>`:'';
    const avInner=userAvatarHtml(u,26).replace('<div class="av"',`<div class="av" style="border:2px solid ${luColor}"`);
    const disclosureId=`user-str-body-${String(u).replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()}`;
    return`<div class="user-str-block" data-username="${escAttr(u)}">
      <div class="user-str-hdr">
        <button type="button" class="user-str-toggle" onclick="toggleStrUser(this)" aria-expanded="false" aria-controls="${escAttr(disclosureId)}">
          <div class="user-str-info">
          ${avInner}
          <div>
            <span style="font-weight:600;font-size:14px">${escHtml(u)}${isMe?` (${escHtml(i18nCore.t('common.you'))})`:''}</span>${diffBadge}
            ${ud.friendCode?`<span style="font-family:var(--mono);font-size:11px;color:var(--muted);margin-left:6px">${escHtml(ud.friendCode)}</span>`:''}
            <div style="display:flex;align-items:center;gap:8px;margin-top:2px;flex-wrap:wrap">
              <span style="font-size:11px;color:${luColor}">● ${freshnessLabel(ud.lastUpdated)}</span>
              <span style="font-size:11px;color:var(--muted)">${escHtml(i18nCore.t('strings.listed',{count:i18nCore.formatNumber(count)}))}</span>
              ${discordHtml}
            </div>
            ${bioHtml}
          </div>
          </div>
          <span class="collapse-icon" aria-hidden="true">▼</span>
        </button>
        ${isMe?'':`<div class="user-str-actions">
          <button class="diff-fab" onclick="event.stopPropagation();openDiffModal(this.closest('.user-str-block').dataset.username)" aria-label="Compare lists with ${escAttr(u)}" title="Compare your list vs ${escAttr(u)}'s">⚖</button>
        </div>`}
      </div>
      <div class="user-str-body" id="${escAttr(disclosureId)}">
        ${diffDetails}
        ${strs?strLevelsHtml(strs,{t:i18nCore.t,formatNumber:i18nCore.formatNumber,priorityLabel:publicSharePriorityLabel,searchLocale:pokemonGoSearchLocale()}):`<div style="color:var(--muted);font-size:12px;padding:4px 0">${escHtml(i18nCore.t('strings.emptyList'))}</div>`}
      </div>
    </div>`;
  }).join('');
}

// ── EXPORT ────────────────────────────────────────────────────
function canUseBackupTools(){
  return !!(cur&&allData.users?.[cur]?.isAdmin);
}
function guardBackupTool(){
  if(canUseBackupTools())return true;
  console.warn('Admin-only backup tool blocked');
  toast(i18nCore.t('admin.only'));
  return false;
}
function exportData(){
  if(!guardBackupTool())return false;
  const s=getLocal();
  const blob=new Blob([JSON.stringify(s,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`pogo-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  lsSet('pogoLastBackup',Date.now());
  renderBackupReminder();
  toast(i18nCore.t('backup.downloaded'));
  return true;
}
// DATA-01 containment: whole-root restore is intentionally absent from the
// production runtime until a versioned, transactional import exists.
const PRODUCTION_ROOT_RESTORE_ENABLED=false;
function renderSecurityPanel(){
  const el=document.getElementById('security-panel');if(!el)return;
  const meta=FIREBASE_RULES_STATUS;
  el.innerHTML=`
    <div class="sec" style="margin-top:0">${escHtml(i18nCore.t('admin.securityTitle'))}</div>
    <div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:10px">${escHtml(i18nCore.t('admin.securityDeployed'))}</div>
    <dl style="display:grid;grid-template-columns:minmax(120px,max-content) minmax(0,1fr);gap:7px 12px;margin:0;font-size:12px;line-height:1.45">
      <dt style="color:var(--muted)">${escHtml(i18nCore.t('admin.securityDeploymentTime'))}</dt><dd style="margin:0">${escHtml(meta.deployedAt)}</dd>
      <dt style="color:var(--muted)">${escHtml(i18nCore.t('admin.securityCandidateSha'))}</dt><dd style="margin:0;font-family:var(--mono);word-break:break-all">${escHtml(meta.candidateSha256)}</dd>
      <dt style="color:var(--muted)">${escHtml(i18nCore.t('admin.securityReviewedArtifact'))}</dt><dd style="margin:0;font-family:var(--mono);word-break:break-all">${escHtml(meta.reviewedCandidatePath)}</dd>
      <dt style="color:var(--muted)">${escHtml(i18nCore.t('admin.securityRollbackReady'))}</dt><dd style="margin:0">${escHtml(i18nCore.t(meta.rollbackReady?'admin.securityRollbackReadyValue':'admin.securityRollbackUnavailableValue'))}</dd>
    </dl>
    <div style="font-size:12px;color:var(--warn);line-height:1.5;margin-top:12px">${escHtml(i18nCore.t('admin.securityArtifactWarning'))}</div>
    <div class="admin-actions" style="margin-top:10px">
      <button class="btn-export" data-copy="${escAttr(meta.candidateSha256)}" onclick="copyStr(this.dataset.copy,this)">${escHtml(i18nCore.t('admin.securityCopySha'))}</button>
      <button class="btn-export" data-copy="${escAttr(meta.reviewedCandidatePath)}" onclick="copyStr(this.dataset.copy,this)">${escHtml(i18nCore.t('admin.securityCopyPath'))}</button>
    </div>`;
}

function loginAuditRows(){
  const users=allData.users||{};
  return Object.entries(users).map(([u,d])=>{
    const dir=allData.loginDirectory?.[u]||null;
    const expectedVersion=authVersionForUser(d);
    const expectedEmail=authEmail(u,expectedVersion);
    const issues=[];
    if(!d.authUid)issues.push(i18nCore.t('admin.missingAuthUid'));
    if(!d.authEmail)issues.push(i18nCore.t('admin.missingEmail'));
    if(d.authEmail&&d.authEmail!==expectedEmail)issues.push(i18nCore.t('admin.emailMismatch'));
    if(!dir)issues.push(i18nCore.t('admin.missingDirectory'));
    else{
      if(!dir.authReady)issues.push(i18nCore.t('admin.directoryNotReady'));
      if(dir.authEmail&&d.authEmail&&dir.authEmail!==d.authEmail)issues.push(i18nCore.t('admin.directoryEmailMismatch'));
      if(parseInt(dir.authVersion||1)!==expectedVersion)issues.push(i18nCore.t('admin.directoryVersionMismatch'));
    }
    const needsPin=!d.authUid||!d.authEmail;
    return{u,d,dir,issues,needsPin};
  }).filter(r=>r.issues.length).sort((a,b)=>
    (b.needsPin?1:0)-(a.needsPin?1:0)||alphaCompare(a.u,b.u)
  );
}
function renderLoginAudit(){
  const el=document.getElementById('login-audit-panel');if(!el)return;
  if(!allData.users?.[cur]?.isAdmin){el.style.display='none';el.innerHTML='';return;}
  const rows=loginAuditRows();
  if(!rows.length){el.style.display='none';el.innerHTML='';return;}
  const dirOnly=rows.filter(r=>!r.needsPin).length;
  el.style.display='block';
  el.innerHTML=`
    <div class="login-audit-head">
      <div>
        <div class="login-audit-title">${escHtml(i18nCore.t('admin.loginAuditTitle',{count:i18nCore.formatNumber(rows.length)}))}</div>
        <div class="login-audit-sub">${escHtml(i18nCore.t('admin.loginAuditHelp'))}</div>
      </div>
      <div class="login-audit-actions">
        ${dirOnly?`<button class="rpin" onclick="repairLoginDirectories()">${escHtml(i18nCore.t('admin.repairDirectoryOnly',{count:i18nCore.formatNumber(dirOnly)}))}</button>`:''}
      </div>
    </div>
    <div class="login-audit-list">
      ${rows.map(r=>{
        return`<div class="login-audit-row">
          <div class="login-audit-user">${escHtml(r.u)}</div>
          <div class="login-audit-issues">${r.issues.map(x=>`<span class="login-audit-chip">${escHtml(x)}</span>`).join('')}</div>
          <button class="rpin" type="button" data-admin-user-action="${r.needsPin?'repair':'repair-directory'}" data-username="${escAttr(r.u)}">${escHtml(i18nCore.t(r.needsPin?'admin.repairWithPin':'admin.repairDirectory'))}</button>
        </div>`;
      }).join('')}
    </div>`;
}
function ownerCanUseCommunityTools(){
  return !!(cur&&(cur===OWNER||allData.users?.[cur]?.isOwner));
}
function communityFeatureDiagnostic({
  multiCommunityEnabled=MULTI_COMMUNITY_ENABLED,
  trainerFirstInterimEnabled=TRAINER_FIRST_INTERIM_ENABLED
}={}){
  if(!multiCommunityEnabled)return Object.freeze({state:'legacy-compatibility',messageKey:'admin.communityDiagnosticLegacy'});
  if(trainerFirstInterimEnabled)return Object.freeze({state:'enabled-interim',messageKey:'admin.communityDiagnosticInterim'});
  return Object.freeze({state:'enabled',messageKey:'admin.communityDiagnosticEnabled'});
}
function ownerCommunityPreviewOn(){
  return !!(MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE&&ownerCanUseCommunityTools()&&lsGet(OWNER_COMMUNITY_PREVIEW_KEY,false));
}
function preparedPreviewCommunities(){
  const communities=allData.communities||{};
  return Object.entries(communities)
    .filter(([id,c])=>c&&c.preparedAt)
    .sort(([aId,a],[bId,b])=>{
      if(aId===DEFAULT_COMMUNITY_ID)return-1;
      if(bId===DEFAULT_COMMUNITY_ID)return 1;
      return alphaCompare(a?.name||aId,b?.name||bId);
    });
}
function ownerPreviewCommunityId(){
  if(!ownerCanUseCommunityTools())return DEFAULT_COMMUNITY_ID;
  const stored=normalizeCommunityId(lsGet(OWNER_COMMUNITY_PREVIEW_SELECTED_KEY,DEFAULT_COMMUNITY_ID));
  const community=allData.communities?.[stored];
  return community?.preparedAt?stored:DEFAULT_COMMUNITY_ID;
}
function ownerPreviewCommunityRecord(){
  return allData.communities?.[ownerPreviewCommunityId()]||allData.communities?.[DEFAULT_COMMUNITY_ID]||{};
}
function ownerPreviewCommunityName(){
  const id=ownerPreviewCommunityId();
  const community=allData.communities?.[id]||{};
  return community.name||community.slug||(id===DEFAULT_COMMUNITY_ID?DEFAULT_COMMUNITY_NAME:id);
}
function setOwnerPreviewCommunityId(id){
  if(!ownerCanUseCommunityTools())return;
  const cid=normalizeCommunityId(id);
  const community=allData.communities?.[cid];
  if(!community?.preparedAt){toast('⚠️ Prepare that community before previewing it');return;}
  lsSet(OWNER_COMMUNITY_PREVIEW_SELECTED_KEY,cid);
  if(ownerCommunityPreviewOn())ensureProtectedSubscriptions();
  renderCommunityMigrationPanel();
  renderBrowse();
  renderStrings();
  renderSchedule();
  if(haveView==='browse')renderHaveBrowse();
}
function setOwnerCommunityPreview(on){
  if(!ownerCanUseCommunityTools())return;
  lsSet(OWNER_COMMUNITY_PREVIEW_KEY,!!on);
  if(on)ensureProtectedSubscriptions();
  renderCommunityMigrationPanel();
  renderBrowse();
  renderStrings();
  renderSchedule();
  if(haveView==='browse')renderHaveBrowse();
}
function ownerPreviewCommunityMemberUsernames(){
  if(!ownerCommunityPreviewOn())return null;
  const community=ownerPreviewCommunityRecord();
  const names=Object.keys(community.memberUsernames||{});
  return community.preparedAt&&names.length?new Set(names):null;
}
function ownerPreviewAllowsUser(username){
  const members=ownerPreviewCommunityMemberUsernames();
  return !members||members.has(username);
}
function selectedCommunityMemberUsernames(){
  if(!MULTI_COMMUNITY_ENABLED)return null;
  const members=getCommunityMemberUsernames();
  return members.size?members:null;
}
function readScopeMemberUsernames(){
  return ownerPreviewCommunityMemberUsernames()||selectedCommunityMemberUsernames();
}
function readScopeAllowsUser(username){
  const members=readScopeMemberUsernames();
  return !members||members.has(username);
}
function browseAllowedUsers(){
  const active=activeUsers();
  const communityMembers=readScopeMemberUsernames();
  if(!active&&!communityMembers)return null;
  const users=Object.keys(allData.users||{});
  return new Set(users.filter(u=>(!active||active.has(u))&&(!communityMembers||communityMembers.has(u))));
}
function stringsAllowedUsers(){
  const communityMembers=readScopeMemberUsernames();
  return communityMembers?new Set(Object.keys(allData.users||{}).filter(u=>communityMembers.has(u))):null;
}
function inventoryBrowseAllowedUsers(){
  const active=activeUsers();
  const communityMembers=readScopeMemberUsernames();
  if(!active&&!communityMembers)return null;
  const users=Object.keys(allData.users||{});
  return new Set(users.filter(u=>(!active||active.has(u))&&(!communityMembers||communityMembers.has(u))));
}
function scheduleAllowedUsers(){
  const communityMembers=readScopeMemberUsernames();
  return communityMembers?new Set(Object.keys(allData.users||{}).filter(u=>communityMembers.has(u))):null;
}
function renderOwnerBrowsePreviewBanner(allowed){
  const el=document.getElementById('owner-browse-preview-banner');if(!el)return;
  const on=ownerCommunityPreviewOn();
  if(!on){el.classList.remove('show');el.style.display='none';el.innerHTML='';return;}
  const community=ownerPreviewCommunityRecord();
  const previewName=ownerPreviewCommunityName();
  const members=Object.keys(community.memberUsernames||{}).length;
  const scoped=allowed?allowed.size:Object.keys(allData.users||{}).length;
  el.style.display='';
  el.classList.add('show');
  el.innerHTML=`<span>🔭 Owner preview: Browse is scoped to ${escHtml(previewName)} community members only.</span><span>${members?`${scoped} trainer${scoped===1?'':'s'} allowed by current Browse filters`:`Prepare ${escHtml(previewName)} before trusting this preview`}</span>`;
}
function renderOwnerStringsPreviewBanner(allowed){
  const el=document.getElementById('owner-strings-preview-banner');if(!el)return;
  const on=ownerCommunityPreviewOn();
  if(!on){el.classList.remove('show');el.style.display='none';el.innerHTML='';return;}
  const community=ownerPreviewCommunityRecord();
  const previewName=ownerPreviewCommunityName();
  const members=Object.keys(community.memberUsernames||{}).length;
  const scoped=allowed?allowed.size:Object.keys(allData.users||{}).length;
  el.style.display='';
  el.classList.add('show');
  el.innerHTML=`<span>🔭 Owner preview: Strings and Compare are scoped to ${escHtml(previewName)} members only.</span><span>${members?`${scoped} trainer${scoped===1?'':'s'} available before list/search filters`:`Prepare ${escHtml(previewName)} before trusting this preview`}</span>`;
}
function renderOwnerInventoryPreviewBanner(allowed){
  const el=document.getElementById('owner-inventory-preview-banner');if(!el)return;
  const on=ownerCommunityPreviewOn();
  if(!on){el.classList.remove('show');el.style.display='none';el.innerHTML='';return;}
  const community=ownerPreviewCommunityRecord();
  const previewName=ownerPreviewCommunityName();
  const members=Object.keys(community.memberUsernames||{}).length;
  const scoped=allowed?allowed.size:Object.keys(allData.users||{}).length;
  el.style.display='';
  el.classList.add('show');
  el.innerHTML=`<span>🔭 Owner preview: Inventory browse is scoped to ${escHtml(previewName)} members only.</span><span>${members?`${scoped} trainer${scoped===1?'':'s'} allowed before inventory filters`:`Prepare ${escHtml(previewName)} before trusting this preview`}</span>`;
}
function renderOwnerSchedulePreviewBanner(allowed){
  const el=document.getElementById('owner-schedule-preview-banner');if(!el)return;
  const on=ownerCommunityPreviewOn();
  if(!on){el.classList.remove('show');el.style.display='none';el.innerHTML='';return;}
  const community=ownerPreviewCommunityRecord();
  const previewName=ownerPreviewCommunityName();
  const members=Object.keys(community.memberUsernames||{}).length;
  const scoped=allowed?allowed.size:Object.keys(allData.users||{}).length;
  el.style.display='';
  el.classList.add('show');
  el.innerHTML=`<span>🔭 Owner preview: Schedule rows and partner picker are scoped to ${escHtml(previewName)} members only.</span><span>${members?`${Math.max(0,scoped-1)} schedulable trainer${Math.max(0,scoped-1)===1?'':'s'} · quota cards still show your real daily usage`:`Prepare ${escHtml(previewName)} before trusting this preview`}</span>`;
}
function guardOwnerPreviewTrainer(username,feature='that trainer'){
  if(ownerPreviewAllowsUser(username))return true;
  toast(`🔭 Owner preview: ${username} is outside ${ownerPreviewCommunityName()}, so ${feature} is hidden.`,4500);
  return false;
}
function guardReadScopeTrainer(username,feature='that trainer'){
  if(readScopeAllowsUser(username))return true;
  const label=ownerCommunityPreviewOn()?ownerPreviewCommunityName():(allData.communities?.[getCurrentCommunityId()]?.name||getCurrentCommunityId());
  toast(`🔭 ${username} is outside ${label}, so ${feature} is hidden.`,4500);
  return false;
}
function offerInReadScope(offer,recipient=''){
  const members=readScopeMemberUsernames();
  if(!members)return true;
  const scopedCommunityId=ownerCommunityPreviewOn()?ownerPreviewCommunityId():getCurrentCommunityId();
  if(recordCommunityId(offer)!==scopedCommunityId)return false;
  const from=offer?.from||'';
  return (!from||members.has(from))&&(!recipient||members.has(recipient)||recipient===cur);
}
function buildDefaultCommunityMigration(){
  const s=normalizeData(getLocal());
  const community=normalizeCommunityRecord(DEFAULT_COMMUNITY_ID,s.communities?.[DEFAULT_COMMUNITY_ID],s,{autoEnrollDefault:true});
  const updates={};
  const missingAuth=[];
  Object.entries(s.users||{}).forEach(([u,ud])=>{
    community.memberUsernames[u]=true;
    if(!ud?.authUid){missingAuth.push(u);return;}
    const role=communityRoleForUser(u,ud);
    community.members[ud.authUid]=true;
    if(role!=='member')community.admins[ud.authUid]=true;
    updates[`userCommunities/${ud.authUid}/${DEFAULT_COMMUNITY_ID}`]={
      role,
      username:u,
      joinedAt:ud?.joined||0
    };
  });
  community.updatedAt=Date.now();
  updates[`communities/${DEFAULT_COMMUNITY_ID}`]=community;
  return{
    updates,
    community,
    memberCount:Object.keys(community.memberUsernames||{}).length,
    uidMemberCount:Object.keys(community.members||{}).length,
    adminCount:Object.keys(community.admins||{}).length,
    missingAuth
  };
}
function validateNonDefaultCommunityId(rawId){
  const id=String(rawId||'').trim();
  if(!id)return{ok:false,error:'Enter a community id first.'};
  if(id!==id.toLowerCase())return{ok:false,error:'Use lowercase letters, numbers, and hyphens only.'};
  if(id===DEFAULT_COMMUNITY_ID)return{ok:false,error:'NYC already has its own preparation path.'};
  if(/[.#$\[\]\/]/.test(id))return{ok:false,error:'Community id cannot contain . # $ [ ] or / characters.'};
  if(!/^[a-z0-9-]+$/.test(id))return{ok:false,error:'Use lowercase letters, numbers, and hyphens only.'};
  return{ok:true,id};
}
function buildNonDefaultCommunityPreparation(input={}){
  const validated=validateNonDefaultCommunityId(input.communityId);
  if(!validated.ok)return{ok:false,error:validated.error,updates:{}};
  const ownerUid=allData.users?.[cur]?.authUid||currentAuthUid||auth?.currentUser?.uid||'';
  if(!cur||!ownerUid)return{ok:false,error:'Sign in as the owner before preparing a new community.',updates:{}};
  const id=validated.id;
  const now=Date.now();
  const existing=allData.communities?.[id]||{};
  const community=normalizeCommunityRecord(id,existing,allData,{autoEnrollDefault:false});
  community.name=String(input.name||'').trim()||id;
  community.slug=id;
  community.description=String(input.description||'').trim();
  community.visibility=COMMUNITY_VISIBILITIES.includes(input.visibility)?input.visibility:'private';
  community.ownerId=community.ownerId||ownerUid;
  community.ownerUsername=community.ownerUsername||cur;
  community.createdAt=community.createdAt||now;
  community.updatedAt=now;
  community.preparedAt=community.preparedAt||now;
  community.memberUsernames={...(community.memberUsernames||{}),[cur]:true};
  community.members={...(community.members||{}),[ownerUid]:true};
  community.admins={...(community.admins||{}),[ownerUid]:true};
  const existingReverse=allData.userCommunities?.[ownerUid]?.[id]||{};
  const updates={
    [`communities/${id}`]:community,
    [`userCommunities/${ownerUid}/${id}`]:{
      role:'owner',
      username:cur,
      joinedAt:existingReverse.joinedAt||now
    }
  };
  return{ok:true,id,ownerUid,community,updates};
}
function preparedNonDefaultCommunities(){
  return Object.entries(allData.communities||{})
    .filter(([id,c])=>id!==DEFAULT_COMMUNITY_ID&&c?.preparedAt)
    .sort((a,b)=>alphaCompare(a[1]?.name||a[0],b[1]?.name||b[0]));
}
function validatePreparedNonDefaultCommunityId(rawId){
  const validated=validateNonDefaultCommunityId(rawId);
  if(!validated.ok)return{ok:false,error:validated.error};
  const community=allData.communities?.[validated.id];
  if(!community||!community.preparedAt)return{ok:false,error:'Prepare this non-NYC community before assigning members.'};
  return{ok:true,id:validated.id,community};
}
function buildNonDefaultCommunityMemberAssignment(input={}){
  const validated=validatePreparedNonDefaultCommunityId(input.communityId);
  if(!validated.ok)return{ok:false,error:validated.error,updates:{}};
  const username=String(input.username||'').trim();
  if(!username)return{ok:false,error:'Enter an existing username first.',updates:{}};
  const existingUser=allData.users?.[username];
  if(!existingUser)return{ok:false,error:`${username} is not an existing user. Add or approve them first.`,updates:{}};
  const user=normalizedUserRecord(username,existingUser);
  const uid=user.authUid||'';
  const id=validated.id;
  const now=Date.now();
  const existingReverse=uid?(allData.userCommunities?.[uid]?.[id]||{}):{};
  const updates={
    [`communities/${id}/memberUsernames/${username}`]:true,
    [`communities/${id}/updatedAt`]:now
  };
  if(uid){
    updates[`communities/${id}/members/${uid}`]=true;
    updates[`userCommunities/${uid}/${id}`]={
      role:'member',
      username,
      joinedAt:existingReverse.joinedAt||user.joined||now
    };
  }
  return{ok:true,id,community:validated.community,username,uid,updates};
}
function buildNonDefaultCommunityMemberRemoval(input={}){
  const validated=validatePreparedNonDefaultCommunityId(input.communityId);
  if(!validated.ok)return{ok:false,error:validated.error,updates:{}};
  const username=String(input.username||'').trim();
  if(!username)return{ok:false,error:'Enter an existing username first.',updates:{}};
  const existingUser=allData.users?.[username];
  if(!existingUser)return{ok:false,error:`${username} is not an existing user.`,updates:{}};
  const user=normalizedUserRecord(username,existingUser);
  const uid=user.authUid||'';
  const id=validated.id;
  const community=validated.community;
  if(community.ownerUsername===username||(uid&&community.ownerId===uid))return{ok:false,error:'Cannot remove the community owner.',updates:{}};
  const updates={
    [`communities/${id}/memberUsernames/${username}`]:null,
    [`communities/${id}/updatedAt`]:Date.now()
  };
  if(uid){
    updates[`communities/${id}/members/${uid}`]=null;
    updates[`userCommunities/${uid}/${id}`]=null;
    if(Object.prototype.hasOwnProperty.call(community.admins||{},uid))updates[`communities/${id}/admins/${uid}`]=null;
  }
  return{ok:true,id,community,username,uid,updates};
}
function setNonDefaultCommunityPrepStatus(message='',kind=''){
  const el=document.getElementById('non-default-community-prep-status');if(!el)return;
  el.className=kind==='ok'?'acct-pill ok':kind==='warn'?'acct-pill warn':'';
  el.textContent=message;
}
function setCommunityMemberToolStatus(message='',kind=''){
  const el=document.getElementById('non-default-member-status');if(!el)return;
  el.className=kind==='ok'?'acct-pill ok':kind==='warn'?'acct-pill warn':'';
  el.textContent=message;
}
function nonDefaultCommunityMemberToolInput(){
  return{
    communityId:document.getElementById('non-default-member-community')?.value||'',
    username:document.getElementById('non-default-member-username')?.value||''
  };
}
function communityPreviewStats(migration,existing={}){
  const serverNames=new Set(Object.keys(existing.memberUsernames||{}));
  const localNames=new Set(Object.keys(migration.community?.memberUsernames||{}));
  const scopeNames=serverNames.size?serverNames:localNames;
  const allUsers=Object.keys(allData.users||{});
  const scopedUsers=allUsers.filter(u=>scopeNames.has(u));
  const scopedSet=new Set(scopedUsers);
  const missingOnServer=[...localNames].filter(u=>!serverNames.has(u)).sort(alphaCompare);
  const extraOnServer=[...serverNames].filter(u=>!localNames.has(u)).sort(alphaCompare);
  const stringUsers=scopedUsers.filter(u=>['wishlist','dynamax','gmax','costumes'].some(t=>Object.keys(allData[t]?.[u]||{}).length));
  const inventoryUsers=scopedUsers.filter(u=>u!==cur&&Object.keys(allData.have?.[u]||{}).length);
  const scheduleUsers=scopedUsers.filter(u=>u!==cur);
  const browseUsers=scopedUsers.filter(u=>['wishlist','dynamax','gmax','costumes'].some(t=>Object.keys(allData[t]?.[u]||{}).length));
  const hiddenUsers=allUsers.filter(u=>!scopedSet.has(u)).sort(alphaCompare);
  return{
    source:serverNames.size?'Firebase community record':'local preview only',
    scopedUsers,
    browseUsers,
    stringUsers,
    inventoryUsers,
    scheduleUsers,
    hiddenUsers,
    missingOnServer,
    extraOnServer
  };
}
function renderCommunityMigrationPanel(){
  // Pokémon lists and inventory stay user-global; each localized diagnostic states this invariant.
  const el=document.getElementById('community-migration-panel');if(!el)return;
  if(!ownerCanUseCommunityTools()){el.style.display='none';el.innerHTML='';return;}
  const migration=buildDefaultCommunityMigration();
  const existing=allData.communities?.[DEFAULT_COMMUNITY_ID]||{};
  const serverMembers=Object.keys(existing.memberUsernames||{}).length;
  const serverUidMembers=Object.keys(existing.members||{}).length;
  const ready=!!existing.preparedAt&&serverMembers>=migration.memberCount&&serverUidMembers>=migration.uidMemberCount;
  const previewCommunityId=ownerPreviewCommunityId();
  const previewCommunity=ownerPreviewCommunityRecord();
  const previewLabel=ownerPreviewCommunityName();
  const preview=communityPreviewStats(
    previewCommunityId===DEFAULT_COMMUNITY_ID?migration:{community:previewCommunity},
    previewCommunityId===DEFAULT_COMMUNITY_ID?existing:previewCommunity
  );
  const serverDrift=preview.missingOnServer.length||preview.extraOnServer.length;
  const canRefreshServer=!ready||preview.missingOnServer.length>0;
  const previewOn=ownerCommunityPreviewOn();
  const featureDiagnostic=communityFeatureDiagnostic();
  const previewCommunities=preparedPreviewCommunities();
  const previewOptions=previewCommunities.map(([id,c])=>`<option value="${escAttr(id)}" ${id===previewCommunityId?'selected':''}>${escHtml(c.name||id)} (${escHtml(id)})</option>`).join('');
  const preparedCommunities=preparedNonDefaultCommunities();
  const preparedOptions=preparedCommunities.map(([id,c])=>`<option value="${escAttr(id)}">${escHtml(c.name||id)} (${escHtml(id)})</option>`).join('');
  const userOptions=Object.keys(allData.users||{}).sort(alphaCompare).map(u=>`<option value="${escAttr(u)}"></option>`).join('');
  const driftHtml=serverDrift?`
    <div style="font-size:11px;color:var(--muted);margin-top:6px">
      Firebase drift: ${preview.missingOnServer.length?`${preview.missingOnServer.length} local username${preview.missingOnServer.length===1?'':'s'} not on server${preview.missingOnServer.length<=6?`: ${escHtml(preview.missingOnServer.join(', '))}`:''}`:''}
      ${preview.extraOnServer.length?`${preview.extraOnServer.length} server-only username${preview.extraOnServer.length===1?'':'s'}${preview.extraOnServer.length<=6?`: ${escHtml(preview.extraOnServer.join(', '))}`:''}`:''}
    </div>`:'';
  el.style.display='block';
  el.innerHTML=`
    <div class="login-audit-head">
      <div>
        <div class="login-audit-title">${escHtml(i18nCore.t('admin.communityTitle'))}</div>
        <div class="login-audit-sub">${escHtml(i18nCore.t('admin.communityDescription'))}</div>
      </div>
      <div class="login-audit-actions">
        ${previewCommunities.length?`<label class="owner-preview-toggle" title="${escAttr(i18nCore.t('admin.communityPreviewHelp'))}">${escHtml(i18nCore.t('admin.communityPreview'))} <select onchange="setOwnerPreviewCommunityId(this.value)" ${previewCommunities.length?'':'disabled'}>${previewOptions}</select></label>`:''}
        ${MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE?`<label class="owner-preview-toggle ${previewOn?'on':''}" title="${escAttr(i18nCore.t('admin.communityPreviewScope'))}"><input type="checkbox" ${previewOn?'checked':''} onchange="setOwnerCommunityPreview(this.checked)"> ${escHtml(i18nCore.t('admin.communityEnablePreview'))}</label>`:''}
        <button class="rpin" onclick="prepareDefaultCommunity()" ${canRefreshServer?'':'disabled'}>${escHtml(i18nCore.t(ready?(preview.missingOnServer.length?'admin.communityRefreshDefault':'admin.communityDefaultPrepared'):'admin.communityPrepareDefault'))}</button>
      </div>
    </div>
    <div class="login-audit-list">
      <div class="login-audit-row">
        <div>
          <div class="login-audit-user">${escHtml(i18nCore.t('admin.communityDefault'))}: ${escHtml(DEFAULT_COMMUNITY_NAME)} <span class="cb">${escHtml(DEFAULT_COMMUNITY_ID)}</span></div>
          <div class="login-audit-issues">
            <span class="login-audit-chip">${escHtml(i18nCore.t('admin.communityUsernames',{count:i18nCore.formatNumber(migration.memberCount)}))}</span>
            <span class="login-audit-chip">${escHtml(i18nCore.t('admin.communityAuthLinked',{count:i18nCore.formatNumber(migration.uidMemberCount)}))}</span>
            <span class="login-audit-chip">${escHtml(i18nCore.t('admin.communityAdminUids',{count:i18nCore.formatNumber(migration.adminCount)}))}</span>
            ${ready?`<span class="acct-pill ok">${escHtml(i18nCore.t('admin.communityServerReady'))}</span>`:`<span class="acct-pill warn">${escHtml(i18nCore.t('admin.communityNotWritten'))}</span>`}
            ${serverDrift?`<span class="acct-pill warn">${escHtml(i18nCore.t('admin.communityNeedsRefresh'))}</span>`:''}
          </div>
          ${migration.missingAuth.length?`<div style="font-size:11px;color:var(--muted);margin-top:6px">Missing Auth UID and indexed by username only for now: ${escHtml(migration.missingAuth.slice(0,8).join(', '))}${migration.missingAuth.length>8?'…':''}</div>`:''}
          ${driftHtml}
        </div>
      </div>
      <div class="login-audit-row">
        <div>
          <div class="login-audit-user">Dry-run scoping preview: ${escHtml(previewLabel)} <span class="cb">${escHtml(previewCommunityId)}</span> <span class="cb">${escHtml(preview.source)}</span></div>
          <div class="login-audit-issues">
            <span class="login-audit-chip">Browse: ${preview.browseUsers.length} trainers</span>
            <span class="login-audit-chip">Strings: ${preview.stringUsers.length} trainers</span>
            <span class="login-audit-chip">Inventory browse: ${preview.inventoryUsers.length} trainers</span>
            <span class="login-audit-chip">Schedule picker: ${preview.scheduleUsers.length} trainers</span>
            <span class="login-audit-chip">Hidden outside ${escHtml(previewLabel)}: ${preview.hiddenUsers.length}</span>
          </div>
          <div data-community-diagnostic-state="${escAttr(featureDiagnostic.state)}" style="font-size:11px;color:var(--muted);margin-top:6px">${escHtml(i18nCore.t(featureDiagnostic.messageKey))}</div>
        </div>
      </div>
      <div class="login-audit-row">
        <div style="width:100%">
          <div class="login-audit-user">${escHtml(i18nCore.t('admin.communityPrepareAnother'))} <span class="cb">${escHtml(i18nCore.t('admin.ownerOnly'))}</span></div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${escHtml(i18nCore.t('admin.communityPrepareAnotherHelp'))}</div>
          <div style="display:grid;grid-template-columns:minmax(140px,1fr) minmax(160px,1fr) minmax(120px,.6fr);gap:8px;margin-top:10px">
            <input id="non-default-community-id" placeholder="community-id" autocapitalize="off" autocomplete="off" spellcheck="false">
            <input id="non-default-community-name" placeholder="${escAttr(i18nCore.t('admin.communityDisplayName'))}">
            <select id="non-default-community-visibility">
              ${COMMUNITY_VISIBILITIES.map(v=>`<option value="${escAttr(v)}">${escHtml(v)}</option>`).join('')}
            </select>
          </div>
          <input id="non-default-community-description" placeholder="${escAttr(i18nCore.t('admin.communityOptionalDescription'))}" style="margin-top:8px">
          <div class="login-audit-actions" style="justify-content:space-between;margin-top:10px">
            <span id="non-default-community-prep-status" style="font-size:12px;color:var(--muted)"></span>
            <button class="rpin" onclick="prepareNonDefaultCommunity()">${escHtml(i18nCore.t('admin.communityPrepare'))}</button>
          </div>
        </div>
      </div>
      <div class="login-audit-row">
        <div style="width:100%">
          <div class="login-audit-user">${escHtml(i18nCore.t('admin.communityAssignMembers'))} <span class="cb">${escHtml(i18nCore.t('admin.ownerOnly'))}</span></div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${escHtml(i18nCore.t('admin.communityAssignHelp'))}</div>
          <div style="display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,1fr);gap:8px;margin-top:10px">
            <select id="non-default-member-community" ${preparedCommunities.length?'':'disabled'}>
              ${preparedCommunities.length?preparedOptions:`<option value="">${escHtml(i18nCore.t('admin.communityPrepareFirst'))}</option>`}
            </select>
            <input id="non-default-member-username" list="community-member-username-options" placeholder="${escAttr(i18nCore.t('admin.communityExistingUsername'))}" autocapitalize="off" autocomplete="off" spellcheck="false" ${preparedCommunities.length?'':'disabled'}>
            <datalist id="community-member-username-options">${userOptions}</datalist>
          </div>
          <div class="login-audit-actions" style="justify-content:space-between;margin-top:10px">
            <span id="non-default-member-status" style="font-size:12px;color:var(--muted)"></span>
            <span style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="rpin" onclick="assignNonDefaultCommunityMember()" ${preparedCommunities.length?'':'disabled'}>${escHtml(i18nCore.t('admin.communityAddMember'))}</button>
              <button class="rpin danger" onclick="removeNonDefaultCommunityMember()" ${preparedCommunities.length?'':'disabled'}>${escHtml(i18nCore.t('admin.communityRemoveMember'))}</button>
            </span>
          </div>
        </div>
      </div>
    </div>`;
}
async function prepareDefaultCommunity(){
  if(!ownerCanUseCommunityTools()){toast(i18nCore.t('admin.ownerOnly'));return;}
  if(!fbOn||!db||!auth?.currentUser){toast(i18nCore.t('admin.communitySignInRequired'));return;}
  const migration=buildDefaultCommunityMigration();
  if(!confirm(`Prepare the private NYC community foundation?\n\nThis writes ${migration.memberCount} usernames and ${migration.uidMemberCount} auth-linked memberships. It will not change what users see yet.`))return;
  try{
    migration.community.preparedAt=Date.now();
    migration.updates[`communities/${DEFAULT_COMMUNITY_ID}`]=migration.community;
    await withTimeout(update(ref(db),migration.updates),9000,'Preparing NYC community timed out','db/community-timeout');
    const snap=await withTimeout(get(ref(db,`communities/${DEFAULT_COMMUNITY_ID}`)),6000,'Verifying NYC community timed out','db/community-verify-timeout');
    if(!snap.exists())throw Object.assign(new Error(i18nCore.t('admin.communityVerificationFailed')),{code:'community/not-confirmed'});
    const s=getLocal();
    applyDataPath(s,`communities/${DEFAULT_COMMUNITY_ID}`,migration.community);
    Object.entries(migration.updates).forEach(([path,data])=>{if(path.startsWith('userCommunities/'))applyDataPath(s,path,data);});
    saveLocal(s);
    allData=normalizeData(s);
    renderCommunityMigrationPanel();
    toast(i18nCore.t('admin.communityDefaultPreparedCount',{count:i18nCore.formatNumber(migration.memberCount)}),5000);
  }catch(e){
    console.warn('Default community prep failed',e);
    toast(i18nCore.t('admin.communityOperationFailed'),7000);
  }
}
async function prepareNonDefaultCommunity(){
  if(!ownerCanUseCommunityTools()){toast(i18nCore.t('admin.ownerOnly'));return;}
  if(!fbOn||!db||!auth?.currentUser){toast(i18nCore.t('admin.communitySignInRequired'));return;}
  const input={
    communityId:document.getElementById('non-default-community-id')?.value||'',
    name:document.getElementById('non-default-community-name')?.value||'',
    description:document.getElementById('non-default-community-description')?.value||'',
    visibility:document.getElementById('non-default-community-visibility')?.value||'private'
  };
  const prep=buildNonDefaultCommunityPreparation(input);
  if(!prep.ok){
    setNonDefaultCommunityPrepStatus(prep.error,'warn');
    toast('⚠️ '+prep.error,5000);
    return;
  }
  const paths=Object.keys(prep.updates);
  setNonDefaultCommunityPrepStatus(`Ready: ${prep.id} (${prep.community.visibility})`,'');
  if(!confirm(`Prepare community "${prep.community.name}" (${prep.id})?\n\nThis writes only:\n- communities/${prep.id}\n- userCommunities/${prep.ownerUid}/${prep.id}\n\nNo users are enrolled except the owner, and current NYC behavior will not change.`))return;
  try{
    await withTimeout(update(ref(db),prep.updates),9000,`Preparing ${prep.id} community timed out`,'db/community-timeout');
    const snap=await withTimeout(get(ref(db,`communities/${prep.id}`)),6000,`Verifying ${prep.id} community timed out`,'db/community-verify-timeout');
    if(!snap.exists())throw Object.assign(new Error(`Server did not confirm communities/${prep.id}. Check community rules and retry.`),{code:'community/not-confirmed'});
    const s=getLocal();
    paths.forEach(path=>applyDataPath(s,path,prep.updates[path]));
    saveLocal(s);
    allData=normalizeData(s);
    renderCommunityMigrationPanel();
    toast(i18nCore.t('admin.communityPreparedNamed',{name:prep.community.name}),5000);
  }catch(e){
    console.warn('Non-default community prep failed',e);
    setNonDefaultCommunityPrepStatus('Could not prepare community: '+(e.code||e.message||'permission denied'),'warn');
    toast(i18nCore.t('admin.communityOperationFailed'),7000);
  }
}
async function assignNonDefaultCommunityMember(){
  if(!ownerCanUseCommunityTools()){toast(i18nCore.t('admin.ownerOnly'));return;}
  if(!fbOn||!db||!auth?.currentUser){toast(i18nCore.t('admin.communitySignInRequired'));return;}
  const assignment=buildNonDefaultCommunityMemberAssignment(nonDefaultCommunityMemberToolInput());
  if(!assignment.ok){
    setCommunityMemberToolStatus(assignment.error,'warn');
    toast('⚠️ '+assignment.error,5000);
    return;
  }
  const paths=Object.keys(assignment.updates);
  setCommunityMemberToolStatus(`Ready: add ${assignment.username} to ${assignment.id}`,'');
  const uidLine=assignment.uid?`- communities/${assignment.id}/members/${assignment.uid}\n- userCommunities/${assignment.uid}/${assignment.id}`:'- username-only user: no UID membership paths will be written';
  if(!confirm(`Add ${assignment.username} to "${assignment.community.name||assignment.id}" (${assignment.id})?\n\nThis writes only:\n- communities/${assignment.id}/memberUsernames/${assignment.username}\n${uidLine}\n- communities/${assignment.id}/updatedAt\n\nNo Pokémon data will be copied, and current NYC behavior will not change.`))return;
  try{
    await withTimeout(update(ref(db),assignment.updates),9000,`Assigning ${assignment.username} to ${assignment.id} timed out`,'db/community-member-timeout');
    const s=getLocal();
    paths.forEach(path=>applyDataPath(s,path,assignment.updates[path]));
    saveLocal(s);
    allData=normalizeData(s);
    renderCommunityMigrationPanel();
    toast(i18nCore.t('admin.communityMemberAdded',{trainer:assignment.username,community:assignment.community.name||assignment.id}),5000);
  }catch(e){
    console.warn('Non-default community member assignment failed',e);
    setCommunityMemberToolStatus('Could not add member: '+(e.code||e.message||'permission denied'),'warn');
    toast(i18nCore.t('admin.communityOperationFailed'),7000);
  }
}
async function removeNonDefaultCommunityMember(){
  if(!ownerCanUseCommunityTools()){toast(i18nCore.t('admin.ownerOnly'));return;}
  if(!fbOn||!db||!auth?.currentUser){toast(i18nCore.t('admin.communitySignInRequired'));return;}
  const removal=buildNonDefaultCommunityMemberRemoval(nonDefaultCommunityMemberToolInput());
  if(!removal.ok){
    setCommunityMemberToolStatus(removal.error,'warn');
    toast('⚠️ '+removal.error,5000);
    return;
  }
  const paths=Object.keys(removal.updates);
  setCommunityMemberToolStatus(`Ready: remove ${removal.username} from ${removal.id}`,'');
  const uidLine=removal.uid?`- communities/${removal.id}/members/${removal.uid}\n- userCommunities/${removal.uid}/${removal.id}${removal.updates[`communities/${removal.id}/admins/${removal.uid}`]===null?`\n- communities/${removal.id}/admins/${removal.uid}`:''}`:'- username-only user: no UID membership paths will be deleted';
  if(!confirm(`Remove ${removal.username} from "${removal.community.name||removal.id}" (${removal.id})?\n\nThis deletes only:\n- communities/${removal.id}/memberUsernames/${removal.username}\n${uidLine}\n- updates communities/${removal.id}/updatedAt\n\nThis tool cannot remove users from NYC or remove a community owner.`))return;
  try{
    await withTimeout(update(ref(db),removal.updates),9000,`Removing ${removal.username} from ${removal.id} timed out`,'db/community-member-timeout');
    const s=getLocal();
    paths.forEach(path=>applyDataPath(s,path,removal.updates[path]));
    saveLocal(s);
    allData=normalizeData(s);
    renderCommunityMigrationPanel();
    toast(i18nCore.t('admin.communityMemberRemoved',{trainer:removal.username,community:removal.community.name||removal.id}),5000);
  }catch(e){
    console.warn('Non-default community member removal failed',e);
    setCommunityMemberToolStatus('Could not remove member: '+(e.code||e.message||'permission denied'),'warn');
    toast(i18nCore.t('admin.communityOperationFailed'),7000);
  }
}
async function repairLoginDirectory(u){
  if(!allData.users?.[cur]?.isAdmin){toast(i18nCore.t('admin.only'));return;}
  try{
    await repairMemberAccount(u,{});
    renderAdmin();populateLoginUsers();
    toast(i18nCore.t('admin.directoryRepaired',{trainer:u}));
  }catch(e){
    toast(i18nCore.t('admin.directoryRepairFailed'),6000);
  }
}
async function repairLoginDirectories(){
  if(!allData.users?.[cur]?.isAdmin){toast(i18nCore.t('admin.only'));return;}
  const rows=loginAuditRows().filter(r=>!r.needsPin);
  if(!rows.length){toast(i18nCore.t('admin.directoryNoRepairs'));return;}
  let ok=0,fail=0;
  for(const r of rows){
    try{await repairMemberAccount(r.u,{});ok++;}
    catch(e){console.warn('Directory repair failed',r.u,e);fail++;}
  }
  renderAdmin();populateLoginUsers();
  toast(i18nCore.t(fail?'admin.directoryRepairSummaryFailed':'admin.directoryRepairSummary',{ok:i18nCore.formatNumber(ok),failed:i18nCore.formatNumber(fail)}),5000);
}

// ── ADMIN ─────────────────────────────────────────────────────
let adminSection='overview';
const ADMIN_SECTIONS=Object.freeze(['overview','members','access','maintenance','diagnostics']);
function setAdminSection(section,{focus=false}={}){
  adminSection=ADMIN_SECTIONS.includes(section)?section:'overview';
  document.querySelectorAll('[data-admin-target]').forEach(button=>{
    const active=button.dataset.adminTarget===adminSection;
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-admin-section]').forEach(panel=>{panel.hidden=panel.dataset.adminSection!==adminSection;});
  if(focus)document.querySelector(`[data-admin-section="${adminSection}"] h2`)?.focus?.({preventScroll:true});
}
function adminRelativeTime(timestamp){
  return timestamp?i18nCore.relativeTimeFromTimestamp(timestamp):i18nCore.t('admin.never');
}
function adminUserRows(){
  const iAmOwner=allData.users?.[cur]?.isOwner||cur===OWNER;
  return Object.entries(allData.users||{}).sort((a,b)=>
    lastLoginTime(b[0],b[1])-lastLoginTime(a[0],a[1])||alphaCompare(a[0],b[0])
  ).map(([u,d])=>{
    const listed=Object.keys(allData.wishlist?.[u]||{}).length;
    const updated=d.lastUpdated,viewed=d.lastSeen||(d.authUid&&allData.authIndex?.[d.authUid]?.lastSeen);
    const dir=allData.loginDirectory?.[u]||{};
    const authOk=!!(d.authUid&&d.authEmail&&dir.authReady);
    const authIssues=[
      !d.authUid?i18nCore.t('admin.missingAuthUid'):'',
      !d.authEmail?i18nCore.t('admin.missingEmail'):'',
      !dir.authReady?i18nCore.t('admin.directoryNotReady'):''
    ].filter(Boolean);
    const owner=u===OWNER||d.isOwner;
    const admin=d.isAdmin&&!owner;
    return{u,d,listed,updated,viewed,authOk,authIssues,owner,admin,canChangeRole:iAmOwner&&u!==cur&&u!==OWNER,canMaintain:iAmOwner||(cur!==OWNER&&!admin&&!owner),established:!!d.authUid};
  });
}
function adminUserAction(event){
  const control=event.target.closest('[data-admin-user-action]');if(!control)return;
  const username=control.dataset.username||'',action=control.dataset.adminUserAction;
  if(action==='toggle-role')toggleAdmin(username,control.dataset.makeAdmin==='true');
  else if(action==='reset')openReset(username);
  else if(action==='repair')repairAccount(username);
  else if(action==='repair-directory')repairLoginDirectory(username);
}
document.getElementById('tab-admin')?.addEventListener('click',adminUserAction);
function renderAdmin(){
  const memberList=document.getElementById('admin-member-list');if(!memberList)return;
  renderSecurityPanel();
  renderLoginAudit();
  const iAmOwner=allData.users?.[cur]?.isOwner||cur===OWNER;
  const adminWrap=document.getElementById('nu-admin-wrap');
  const adminInput=document.getElementById('nu-admin');
  if(adminWrap)adminWrap.style.display=iAmOwner?'inline-flex':'none';
  if(adminInput&&!iAmOwner)adminInput.checked=false;
  const resetSafetyNote=document.getElementById('admin-reset-safety-note');
  if(resetSafetyNote)resetSafetyNote.textContent=i18nCore.t('admin.establishedResetUnavailable');
  const users=adminUserRows();
  const summary=document.getElementById('admin-summary-grid');
  const admins=users.filter(user=>user.owner||user.admin).length;
  const ready=users.filter(user=>user.authOk).length;
  const activeLists=users.filter(user=>user.listed>0).length;
  if(summary)summary.innerHTML=[
    ['admin.members',users.length],['admin.admins',admins],['admin.loginReadyAccounts',ready],['admin.activeLists',activeLists]
  ].map(([key,value])=>`<div class="admin-summary-card"><span class="admin-summary-value">${escHtml(i18nCore.formatNumber(value))}</span><span class="admin-summary-label">${escHtml(i18nCore.t(key))}</span></div>`).join('');
  memberList.innerHTML=users.length?users.map(user=>{
    const roleKey=user.owner?'admin.owner':user.admin?'admin.adminRole':'admin.member';
    const roleClass=user.owner?' owner':user.admin?' admin':'';
    const activityColor=freshnessColor(freshnessClass(user.updated));
    return`<article class="admin-member-row">
      <div class="admin-member-identity"><div class="av" style="width:36px;height:36px;font-size:11px;border:2px solid ${activityColor}">${escHtml(user.u.slice(0,2).toUpperCase())}</div><div class="admin-member-copy"><div class="admin-member-name">${escHtml(user.u)}</div>${user.d.friendCode?`<div class="admin-member-friend">${escHtml(user.d.friendCode)}</div>`:''}</div></div>
      <div class="admin-member-status"><span class="acct-pill ${user.authOk?'ok':'warn'}">${escHtml(i18nCore.t(user.authOk?'admin.loginReady':'admin.needsRepair'))}</span>${user.authIssues.length?`<span class="type-meta">${escHtml(user.authIssues.join(' · '))}</span>`:''}</div>
      <div class="admin-member-meta"><span>${escHtml(i18nCore.t('admin.listEntries',{count:i18nCore.formatNumber(user.listed)}))}</span><span>${escHtml(i18nCore.t('admin.updated',{time:adminRelativeTime(user.updated)}))}</span><span>${escHtml(i18nCore.t('admin.viewed',{time:adminRelativeTime(user.viewed)}))}</span></div>
      <span class="admin-role-badge${roleClass}">${escHtml(i18nCore.t(roleKey))}</span>
    </article>`;
  }).join(''):emptyHtml(i18nCore.t('admin.noMembers'),i18nCore.t('admin.membersHelp'),'users');
  const roleList=document.getElementById('admin-role-list');
  if(roleList)roleList.innerHTML=users.map(user=>{
    const roleKey=user.owner?'admin.owner':user.admin?'admin.adminRole':'admin.member';
    const roleClass=user.owner?' owner':user.admin?' admin':'';
    const action=user.canChangeRole?`<button class="rpin ${user.admin?'btn-destructive':''}" type="button" data-admin-user-action="toggle-role" data-username="${escAttr(user.u)}" data-make-admin="${!user.admin}">${escHtml(i18nCore.t(user.admin?'admin.removeAdmin':'admin.makeAdmin'))}</button>`:'';
    return`<article class="admin-role-row"><div class="admin-role-copy"><strong>${escHtml(user.u)}</strong><span>${escHtml(i18nCore.t(user.owner?'admin.ownerProtected':'admin.roleHelp'))}</span></div><span class="admin-role-badge${roleClass}">${escHtml(i18nCore.t(roleKey))}</span><div class="admin-role-actions">${action}</div></article>`;
  }).join('');
  const maintenanceList=document.getElementById('admin-maintenance-list');
  if(maintenanceList)maintenanceList.innerHTML=users.map(user=>{
    const repairTitle=user.canMaintain?i18nCore.t(user.authOk?'admin.repairLogin':'admin.repairOrReset'):i18nCore.t('admin.ownerRepairOnly');
    const resetAction=user.canMaintain&&!user.established?`<button class="rpin" type="button" data-admin-user-action="reset" data-username="${escAttr(user.u)}">${escHtml(i18nCore.t('admin.resetPin'))}</button>`:'';
    const repairAction=user.canMaintain?`<button class="rpin" type="button" data-admin-user-action="repair" data-username="${escAttr(user.u)}" title="${escAttr(repairTitle)}">${escHtml(i18nCore.t('admin.repairAccount'))}</button>`:'';
    const explanation=user.established?i18nCore.t('admin.secureRepairRequired'):i18nCore.t('admin.firstUseResetAvailable');
    return`<article class="admin-maintenance-row"><div class="admin-maintenance-copy"><strong>${escHtml(user.u)}</strong><span>${escHtml(explanation)}</span></div><span class="acct-pill ${user.authOk?'ok':'warn'}">${escHtml(i18nCore.t(user.authOk?'admin.loginReady':'admin.needsRepair'))}</span><div class="admin-maintenance-actions">${resetAction}${repairAction}</div></article>`;
  }).join('');
  setAdminSection(adminSection);
}

async function repairAccount(u){
  if(!allData.users?.[cur]?.isAdmin){toast(i18nCore.t('admin.only'));return;}
  const target=allData.users?.[u];
  if(!target){toast(i18nCore.t('admin.userMissing'));return;}
  const iAmOwner=allData.users?.[cur]?.isOwner||cur===OWNER;
  const targetIsOwner=u===OWNER||target.isOwner;
  const targetIsAdmin=target.isAdmin&&!targetIsOwner;
  if((targetIsOwner||targetIsAdmin)&&!iAmOwner){toast(i18nCore.t('admin.ownerRepairOnly'));return;}
  const needsPin=!target.authUid;
  let pin='';
  if(needsPin){
    pin=prompt(i18nCore.t('admin.repairPrompt',{trainer:u}),generatedFirstTimePin())||'';
    if(!pin)return;
    pin=pin.trim();
    if(!isSixDigitPin(pin)){toast(i18nCore.t('validation.pinSixDigits'));return;}
  }
  try{
    const result=await repairMemberAccount(u,{pin});
    renderAdmin();renderPendingRequests();populateLoginUsers();
    if(result?.pin){
      await copyText(firstTimeLoginMessage(u,result.pin)).catch(()=>{});
      toast(i18nCore.t('admin.accountRepairedCopied',{trainer:u}),5000);
    }else{
      toast(i18nCore.t('admin.directoryRepaired',{trainer:u}),3500);
    }
  }catch(e){
    toast(i18nCore.t('admin.accountRepairFailed'),6000);
  }
}

function toggleAdmin(u,makeAdmin){
  const iAmOwner=allData.users?.[cur]?.isOwner||cur===OWNER;
  if(!iAmOwner){toast(i18nCore.t('admin.ownerRoleOnly'));return;}
  if(u===OWNER){toast(i18nCore.t('admin.cannotChangeOwner'));return;}
  if(!confirm(i18nCore.t('admin.roleChangeConfirm',{trainer:u,role:i18nCore.t(makeAdmin?'admin.adminRole':'admin.member')})))return;
  writeUser(u,{isAdmin:makeAdmin});
  toast(i18nCore.t('admin.roleChanged',{trainer:u,role:i18nCore.t(makeAdmin?'admin.adminRole':'admin.member')}));renderAdmin();
}
async function addUser(){
  const rawName=document.getElementById('nu-name').value.trim();
  const name=canonicalUsernameInput(rawName);
  const pinInput=document.getElementById('nu-pin').value.trim();
  const iAmOwner=allData.users?.[cur]?.isOwner||cur===OWNER;
  const adminRequested=document.getElementById('nu-admin')?.checked;
  if(adminRequested&&!iAmOwner){toast(i18nCore.t('admin.ownerCreateAdminsOnly'));return;}
  const isAdmin=iAmOwner&&adminRequested;
  if(!rawName){toast(i18nCore.t('admin.enterUsername'));return;}
  const pin=pinInput||generatedFirstTimePin();
  if(!isSixDigitPin(pin)){toast(i18nCore.t('validation.pinSixDigits'));return;}
  if(knownLoginUsernames().some(u=>u.toLowerCase()===rawName.toLowerCase())){toast(i18nCore.t('admin.usernameExists'));return;}
  try{
    await createMemberNow(name,pin,isAdmin);
    document.getElementById('nu-name').value='';document.getElementById('nu-pin').value='';document.getElementById('nu-admin').checked=false;
    toast(i18nCore.t('admin.memberAdded',{trainer:name,pin}),5000);renderAdmin();populateLoginUsers();
  }catch(e){
    console.warn('Could not add member in Firebase',e);
    toast(i18nCore.t('admin.memberAddFailed'),5000);
  }
}
function establishedAccountResetBlocked(username){
  return!!allData.users?.[username]?.authUid;
}
function establishedAccountResetMessage(){
  return i18nCore.t('admin.establishedResetUnavailable');
}
function openReset(u){
  // Check permission
  const iAmOwner=allData.users?.[cur]?.isOwner||cur===OWNER;
  const targetIsAdmin=allData.users?.[u]?.isAdmin||u===OWNER;
  if(!iAmOwner&&targetIsAdmin){toast(i18nCore.t('admin.ownerResetOnly'));return;}
  if(establishedAccountResetBlocked(u)){toast(establishedAccountResetMessage(),6000);return;}
  rpinTarget=u;
  document.getElementById('rpin-target').textContent=u;
  document.getElementById('rpin-val').value='';
  openModal('rpin-modal');
}
async function confirmReset(){
  if(!rpinTarget||establishedAccountResetBlocked(rpinTarget)){
    closeModal('rpin-modal');rpinTarget=null;
    toast(establishedAccountResetMessage(),6000);
    return;
  }
  const pin=document.getElementById('rpin-val').value.trim();
  if(!isSixDigitPin(pin)){toast(i18nCore.t('validation.pinSixDigits'));return;}
  const prev=allData.users?.[rpinTarget]||{};
  try{
    const authProvision=await provisionFreshFirebaseAuthForTrainer(rpinTarget,pin,authVersionForUser(prev)+1);
    const nextVersion=authProvision.version;
    const pinHash=await hashPin(pin);
    await writeUserStrict(rpinTarget,{pin:pinHash,pinHashed:true,authVersion:nextVersion,authEmail:authEmail(rpinTarget,nextVersion),authUid:authProvision.uid,lastSeen:null});
    closeModal('rpin-modal');toast(i18nCore.t('admin.pinResetSuccess',{trainer:rpinTarget}));rpinTarget=null;
  }catch(e){
    console.warn('Could not reset PIN in Firebase',e);
    toast(i18nCore.t('admin.pinResetFailed'),5000);
  }
}

// ── REQUEST ACCESS ────────────────────────────────────────────
function showRequestForm(){
  document.getElementById('login-pg').querySelector('.lcard').style.display='none';
  document.getElementById('req-form-card').style.display='block';
}
function hideRequestForm(){
  document.getElementById('req-form-card').style.display='none';
  document.getElementById('login-pg').querySelector('.lcard').style.display='block';
  document.getElementById('req-form-inner').style.display='block';
  document.getElementById('req-sent-status').style.display='none';
  document.getElementById('req-username').value='';
  document.getElementById('req-note').value='';
  document.getElementById('req-err').textContent='';
}
async function submitRequest(){
  const rawUsername=document.getElementById('req-username').value;
  const rawNote=document.getElementById('req-note').value;
  const err=document.getElementById('req-err');err.textContent='';
  const built=window.PogoDomain.requestAccess.build({rawUsername,rawNote,canonicalize:canonicalUsernameInput});
  if(!built.ok){
    const key={
      'username-required':'request.nameRequired',
      'username-too-short':'request.nameTooShort',
      'username-too-long':'request.nameTooLong',
      'note-too-long':'request.noteTooLong',
      'invalid-characters':'request.invalidCharacters'
    }[built.code]||'request.invalidCharacters';
    err.textContent=i18nCore.t(key);return;
  }
  const {id:reqId,payload:reqData}=built,username=reqData.username;
  if(knownLoginUsernames().some(u=>u.toLowerCase()===username.toLowerCase())){err.textContent=i18nCore.t('request.nameRegistered');return;}
  const existing=Object.values(allData.requests||{}).find(r=>String(r.username||'').toLowerCase()===username.toLowerCase()&&r.status==='pending');
  if(existing){err.textContent=i18nCore.t('request.alreadyPending');return;}
  try{
    await ensureFirebaseDataProtection();
  }catch(e){
    console.warn('Request submission blocked until App Check is ready',e);
    err.textContent=i18nCore.t('request.sendFailed');
    return;
  }
  const s=getLocal();if(!s.requests)s.requests={};
  s.requests[reqId]=reqData;saveLocal(s);allData=s;
  if(fbOn&&db)await set(ref(db,`requests/${reqId}`),reqData).catch(e=>{console.warn('Request submission failed',e);err.textContent=i18nCore.t('request.sendFailed');});
  document.getElementById('req-form-inner').style.display='none';
  document.getElementById('req-sent-status').style.display='block';
}
function renderPendingRequests(){
  const requests=allData.requests||{};
  const pending=Object.entries(requests).filter(([,r])=>r.status==='pending'||(r.status==='approved'&&r.username&&!allData.users?.[r.username]));
  const section=document.getElementById('pending-requests-section');
  const listEl=document.getElementById('pending-requests-list');
  const badge=document.getElementById('req-count-badge');
  const adminNotif=document.getElementById('admin-notif');
  if(!section||!listEl)return;
  if(!pending.length){section.style.display='none';if(adminNotif)adminNotif.style.display='none';return;}
  section.style.display='block';
  if(badge)badge.textContent=pending.length;
  if(adminNotif){adminNotif.style.display='inline-flex';adminNotif.textContent=pending.length;}
  // SEC-01: requests are anonymous persisted input. Build this surface with DOM
  // text nodes and listeners so no request field can become markup or code.
  listEl.replaceChildren(...pending.map(([id,r])=>{
    const username=String(r?.username||''),needsRepair=r.status==='approved'&&!allData.users?.[username];
    const card=document.createElement('div');card.className='req-card';card.id=`reqcard-${id}`;
    const header=document.createElement('div');header.className='req-card-hdr';
    const name=document.createElement('div');name.className='req-card-name';name.append('🎮 ',username);
    if(needsRepair){const repair=document.createElement('span');repair.className='notif-badge';repair.textContent=i18nCore.t('admin.repair');name.append(' ',repair);}
    const time=document.createElement('div');time.className='req-card-time';time.textContent=needsRepair?i18nCore.t('admin.approvedNoLogin'):freshnessLabel(r.requestedAt);
    header.append(name,time);card.append(header);
    const note=document.createElement('div');note.className='req-card-note';note.textContent=r.note?`"${String(r.note)}"`:i18nCore.t('admin.noNote');
    if(!r.note)note.style.color='var(--border2)';card.append(note);
    const actions=document.createElement('div');actions.className='req-actions';
    const approve=document.createElement('button');approve.type='button';approve.className='btn-approve';approve.textContent=needsRepair?`🔧 ${i18nCore.t('admin.createLogin')}`:`✅ ${i18nCore.t('admin.approve')}`;approve.addEventListener('click',()=>approveRequest(id,username));
    const deny=document.createElement('button');deny.type='button';deny.className='btn-deny';deny.textContent=`✗ ${i18nCore.t('admin.deny')}`;deny.addEventListener('click',()=>denyRequest(id));
    actions.append(approve,deny);card.append(actions);return card;
  }));
}
async function approveRequest(reqId,username){
  if(allData.users?.[username]){toast(i18nCore.t('admin.usernameExists'));return;}
  const pin=generatedFirstTimePin();
  try{
    await createMemberNow(username,pin,false,reqId);
  }catch(e){
    console.warn('Could not create login in Firebase',e);
    toast(i18nCore.t('admin.loginCreateFailed'),5000);
    return;
  }
  let copied=true;
  try{
    await copyText(firstTimeLoginMessage(username,pin));
  }catch{
    copied=false;
  }
  const card=document.getElementById(`reqcard-${reqId}`);
  if(card){
    card.replaceChildren();
    const line=(text,style)=>{const node=document.createElement('div');node.textContent=text;Object.assign(node.style,style);return node;};
    card.append(
      line(`✅ ${i18nCore.t('admin.approvedTrainer',{trainer:username})}`,{fontSize:'14px',fontWeight:'700',color:'var(--ok)',marginBottom:'8px'}),
      line(i18nCore.t(copied?'admin.loginCopiedHelp':'admin.loginSendHelp'),{fontSize:'13px',color:'var(--muted)',marginBottom:'6px'})
    );
    const trainerLine=line(`${i18nCore.t('admin.trainer')}: `,{fontSize:'13px'}),strong=document.createElement('strong');strong.textContent=username;trainerLine.append(strong);card.append(trainerLine);
    const pinLine=line('PIN: ',{fontSize:'13px',marginTop:'4px'}),pinValue=document.createElement('span');pinValue.className='pin-reveal';pinValue.textContent=pin;pinLine.append(pinValue);card.append(pinLine);
    card.append(line(i18nCore.t('admin.changePinHelp'),{fontSize:'11px',color:'var(--muted)',marginTop:'8px'}));
    const copy=document.createElement('button');copy.type='button';copy.className='btn-copy-login';copy.style.marginTop='10px';copy.append(uiIconNode('copy','ui-icon ui-icon-sm'));const copyTextNode=document.createElement('span');copyTextNode.textContent=i18nCore.t(copied?'admin.copyAgain':'admin.copyLogin');copy.append(copyTextNode);copy.addEventListener('click',()=>copyApprovedLogin(username,pin));card.append(copy);
  }
  renderAdmin();populateLoginUsers();toast(i18nCore.t(copied?'admin.approvedCopied':'admin.approved',{trainer:username}),5000);
  setTimeout(sessionTransientCallback(()=>renderPendingRequests()),4000);
}
async function copyApprovedLogin(username,pin){
  try{
    await copyText(firstTimeLoginMessage(username,pin));
    toast(i18nCore.t('admin.loginCopied',{trainer:username}));
  }catch{
    toast(i18nCore.t('admin.loginCopyFailed'));
  }
}
async function denyRequest(reqId){
  const s=getLocal();if(s.requests?.[reqId])s.requests[reqId].status='denied';
  saveLocal(s);if(fbOn&&db)await update(ref(db,`requests/${reqId}`),{status:'denied'}).catch(console.error);
  allData=s;renderPendingRequests();toast(i18nCore.t('admin.requestDenied'));
}

// ── PROFILE ───────────────────────────────────────────────────
function updateFcDisplay(){
  const ud=allData.users?.[cur]||{};
  const fc=ud.friendCode||'';
  document.getElementById('my-fc-wrap').innerHTML=fc
    ?`<div class="fc-chip" onclick="openAccountSettingsSection('profile')">🎮 ${fc}</div>`
    :`<div class="fc-chip" onclick="openAccountSettingsSection('profile')">+ ${escHtml(i18nCore.t('profile.addFriendCode'))}</div>`;
  document.getElementById('pfc-disp').textContent=fc||i18nCore.t('profile.notSet');
  document.getElementById('fc-inp').value=fc;
  // Populate profile fields
  const bio=document.getElementById('prof-bio');if(bio)bio.value=ud.bio||'';
  const dis=document.getElementById('prof-discord');if(dis)dis.value=ud.discord||'';
  const avi=document.getElementById('prof-av-input');if(avi)avi.value=ud.avatarPokemon||'';
  const wp=document.getElementById('prof-wallpaper');if(wp)wp.value=ud.wallpaper||'mono';
  const picker=document.getElementById('wp-picker');
  if(picker)picker.innerHTML=wallpaperPickerHtml(ud.wallpaper||'mono');
  updateAvatarPreview(ud.avatarPokemon||'');
}
async function saveProfile(){
  const fc=document.getElementById('fc-inp').value.trim();
  const bio=document.getElementById('prof-bio')?.value.trim()||'';
  const discord=document.getElementById('prof-discord')?.value.trim()||'';
  const avatarPokemon=document.getElementById('prof-av-input')?.value.trim()||'';
  const err=document.getElementById('profile-err');err.textContent='';
  if(fc&&!validateFc(fc)){err.textContent=i18nCore.t('profile.friendCodeInvalid');return;}
  const upd={friendCode:fc,bio,discord,avatarPokemon};
  await writeUser(cur,upd);
  requestPublicSharePublication('share_profile_update',getLocal(),cur);
  updateFcDisplay();
  // Update topbar avatar
  const topAv=document.getElementById('top-av');
  if(topAv&&avatarPokemon){
    const found=avatarEntryForName(avatarPokemon);
    if(found?.no){
      const img=_avatarImgHtml(found.no,found.name,found.catalogId);
      if(img){topAv.innerHTML=img;topAv.style.overflow='hidden';}
    }
  }
  refreshAll();
  toast(i18nCore.t('profile.saved'));
}
async function savePinSettings(){
  const p1=document.getElementById('np1')?.value||'',p2=document.getElementById('np2')?.value||'',err=document.getElementById('pin-err');if(err)err.textContent='';
  if(!isSixDigitPin(p1)){if(err)err.textContent=i18nCore.t('validation.pinSixDigits');return;}
  if(p1!==p2){if(err)err.textContent=i18nCore.t('profile.pinMismatch');return;}
  if(auth){
    if(!auth.currentUser){if(err)err.textContent=i18nCore.t('profile.reauthenticate');return;}
    try{await updatePassword(auth.currentUser,p1);}catch(e){if(err)err.textContent=e.code==='auth/requires-recent-login'?i18nCore.t('profile.reauthenticate'):i18nCore.t('profile.pinUpdateFailed');return;}
  }
  await writeUser(cur,{pin:await hashPin(p1),pinHashed:true});
  document.getElementById('np1').value='';document.getElementById('np2').value='';toast(i18nCore.t('settings.pinSaved'));
}
async function saveAppearance(){
  const wallpaper=document.getElementById('prof-wallpaper')?.value||'mono';await writeUser(cur,{wallpaper});applyWallpaperForTheme(wallpaper);toast(i18nCore.t('settings.appearanceSaved'));
}

// ── UI HELPERS ────────────────────────────────────────────────
let _syncStatusCurrent='';
let accountSyncPreservedReviewRunning=false;
function accountSyncPresentation(){
  if(!accountSyncUiState?.eligible)return null;
  accountSyncClearStaleRecoveryPresentation();
  const state=String(accountSyncUiState.state||'sync-error');
  const count=Math.max(0,Number(accountSyncUiState.pendingCount)||0)+Math.max(0,Number(accountSyncUiState.blockedCount)||0)+Math.max(0,Number(accountSyncUiState.conflictCount)||0)+Math.max(0,Number(accountSyncUiState.recoveryCandidateCount)||0);
  const recoveryState=accountSyncEffectiveRecoveryState(),plan=accountSyncCurrentRecoveryPlan(),running=recoveryState.status==='running';
  const presentation=running?{className:'syncing',labelKey:'accountSync.recoveryRunning',detailKey:'accountSync.recoveryRunningDetail'}:{
    saved:{className:'online',labelKey:'accountSync.saved',detailKey:'accountSync.savedDetail'},
    'pending-sync':{className:'syncing',labelKey:'accountSync.saving',detailKey:'accountSync.savingDetail'},
    offline:{className:'offline',labelKey:'accountSync.offline',detailKey:'accountSync.offlineDetail'},
    conflict:{className:'offline',labelKey:'accountSync.conflict',detailKey:'accountSync.conflictDetail'},
    'review-required':{className:'offline',labelKey:'accountSync.reviewRequired',detailKey:'accountSync.reviewRequiredDetail'},
    'sync-error':{className:'offline',labelKey:'accountSync.error',detailKey:'accountSync.errorDetail'}
  }[state]||{className:'offline',labelKey:'accountSync.error',detailKey:'accountSync.errorDetail'};
  const actionKey={
    'retry-blocked':'accountSync.retrySavedChange',
    'restart-runtime':'accountSync.restartSync',
    'review-conflict':'accountSync.reviewConflict'
  }[plan.action]||'';
  return Object.freeze({...presentation,state,count,plan,actionKey,running});
}
function syncLabelForStatus(s){
  const account=accountSyncPresentation();
  if(account)return i18nCore.t(account.labelKey,{count:i18nCore.formatNumber(account.count)});
  const q=Object.keys(syncQueue||{}).length;
  if(s==='online')return q?i18nCore.t('saveStatus.savingCount',{count:i18nCore.formatNumber(q)}):i18nCore.t('saveStatus.saved');
  if(s==='syncing')return q?i18nCore.t('saveStatus.savingCount',{count:i18nCore.formatNumber(q)}):i18nCore.t('saveStatus.saving');
  if(s==='offline')return q?i18nCore.t('saveStatus.offlineCount',{count:i18nCore.formatNumber(q)}):i18nCore.t('saveStatus.offline');
  if(s==='localOnly')return q?i18nCore.t('saveStatus.localCount',{count:i18nCore.formatNumber(q)}):i18nCore.t('saveStatus.localOnly');
  return'—';
}
function refreshSyncUi(){
  const s=_syncStatusCurrent;
  if(!s)return;
  const pill=document.getElementById('sync-pill');
  const dot=document.getElementById('sdot');
  const lbl=document.getElementById('slbl');
  const account=accountSyncPresentation();
  const className=account?.className||s;
  if(pill){
    pill.classList.remove('online','syncing','offline','localOnly');
    pill.classList.add(className);
    if(account){
      const detail=i18nCore.t(account.detailKey,{count:i18nCore.formatNumber(account.count)});
      pill.title=detail;pill.setAttribute('aria-label',`${i18nCore.t(account.labelKey,{count:i18nCore.formatNumber(account.count)})}. ${detail}`);
      pill.setAttribute('aria-busy',account.running?'true':'false');
    }else pill.removeAttribute('aria-busy');
  }
  if(dot)dot.className=`sync-dot ${className}`;
  if(lbl)lbl.textContent=syncLabelForStatus(s);
  const q=account?.count??Object.keys(syncQueue||{}).length;
  const qEl=document.getElementById('sync-banner-queue-count');if(qEl)qEl.textContent=q;
  const settings=document.getElementById('trainer-sync-local-status');
  if(settings){
    const strong=settings.querySelector('strong'),detail=settings.querySelector('.trainer-sync-status-detail');
    if(account){
      strong?.removeAttribute('data-i18n');detail?.removeAttribute('data-i18n');
      if(strong)strong.textContent=i18nCore.t(account.labelKey,{count:i18nCore.formatNumber(account.count)});
      if(detail)detail.textContent=i18nCore.t(account.detailKey,{count:i18nCore.formatNumber(account.count)});
    }else{
      if(strong)strong.textContent=i18nCore.t('trainer.syncState.local-only');
      if(detail)detail.textContent=i18nCore.t('trainer.syncStatus.localOnlyDetail');
    }
  }
  const diagnostic=document.getElementById('trainer-sync-diagnostic');
  const recovery=document.getElementById('trainer-sync-recovery'),recoveryLabel=document.getElementById('trainer-sync-recovery-label');
  const preservedReview=document.getElementById('trainer-sync-preserved-review'),preservedReviewCount=document.getElementById('trainer-sync-preserved-review-count'),preservedReviewAction=document.getElementById('trainer-sync-preserved-review-action');
  if(account){
    const runtime=managedAccountSyncRuntime,uid=auth?.currentUser?.uid||'';
    const recoveryState=accountSyncEffectiveRecoveryState();
    const diagnosticValue=accountSyncRuntimeData.sanitizedDiagnostic({snapshot:accountSyncUiState||{},runtimePresent:!!runtime&&runtime.ownerUid===uid,projectionReady:runtime?.projectionReady===true,sessionCurrent:!!uid&&!!cur,recoveryOutcome:recoveryState.status,release:clientReleaseDomain.RELEASE_ID});
    const showDiagnostic=account.state==='sync-error'||['running','failed','pending','review'].includes(recoveryState.status);
    if(diagnostic){
      diagnostic.hidden=!showDiagnostic;
      diagnostic.textContent=showDiagnostic?i18nCore.t('accountSync.diagnostic',{
        code:diagnosticValue.code,category:diagnosticValue.category,pending:i18nCore.formatNumber(diagnosticValue.pendingCount),blocked:i18nCore.formatNumber(diagnosticValue.blockedCount),conflicts:i18nCore.formatNumber(diagnosticValue.conflictCount),review:i18nCore.formatNumber(diagnosticValue.reviewCount),runtime:diagnosticValue.runtime,listener:diagnosticValue.listener,projection:diagnosticValue.projection,recovery:diagnosticValue.recoveryOutcome,release:diagnosticValue.release
      }):'';
    }
    if(recovery){
      const showAction=!!account.actionKey;
      recovery.hidden=!showAction;recovery.disabled=account.running;
      recovery.setAttribute('aria-busy',account.running?'true':'false');
      if(showDiagnostic)recovery.setAttribute('aria-describedby','trainer-sync-diagnostic');else recovery.removeAttribute('aria-describedby');
      if(recoveryLabel)recoveryLabel.textContent=i18nCore.t(account.running?'accountSync.recoveryRunning':account.actionKey||'accountSync.restartSync');
    }
    const canReview=accountSyncPreservedReviewReady();
    if(preservedReview){preservedReview.hidden=!canReview;if(preservedReviewCount)preservedReviewCount.textContent=i18nCore.t('accountSync.preservedReviewDetail',{count:i18nCore.formatNumber(accountSyncUiState?.recoveryCandidateCount||0)});}
    if(preservedReviewAction){preservedReviewAction.disabled=accountSyncPreservedReviewRunning;preservedReviewAction.setAttribute('aria-busy',accountSyncPreservedReviewRunning?'true':'false');}
  }else{
    if(diagnostic){diagnostic.hidden=true;diagnostic.textContent='';}
    if(recovery){recovery.hidden=true;recovery.disabled=false;recovery.removeAttribute('aria-busy');recovery.removeAttribute('aria-describedby');}
    if(preservedReview)preservedReview.hidden=true;
    if(preservedReviewAction){preservedReviewAction.disabled=false;preservedReviewAction.removeAttribute('aria-busy');}
  }
}
function setSyncStatus(s){
  const dot=document.getElementById('sdot');const lbl=document.getElementById('slbl');if(!dot)return;
  dot.className='sync-dot '+s;
  const pill=document.getElementById('sync-pill');
  if(pill)pill.title=i18nCore.t(`saveStatus.${s}Help`);
  const prev=_syncStatusCurrent;
  _syncStatusCurrent=s;
  refreshSyncUi();
  if(s==='localOnly')showSyncBanner();
  else hideSyncBanner();
  // Auto-confirmation toast when we recover FROM local-only / offline TO live
  if((prev==='localOnly'||prev==='offline')&&(s==='online'||s==='syncing')){
    const pending=Object.keys(syncQueue||{}).length;
    if(pending)toast(i18nCore.t('saveStatus.backOnlinePending',{count:i18nCore.formatNumber(pending)}),3500);
    else toast(i18nCore.t('saveStatus.backOnline'),2200);
  }
}
// ── SYNC RECOVERY BANNER ─────────────────────────────────────
let _syncBannerDismissed=false;
function showSyncBanner(){
  if(_syncBannerDismissed)return;
  const b=document.getElementById('sync-banner');if(!b)return;
  const q=Object.keys(syncQueue||{}).length;
  const qEl=document.getElementById('sync-banner-queue-count');if(qEl)qEl.textContent=q;
  b.hidden=false;
}
function hideSyncBanner(){
  const b=document.getElementById('sync-banner');if(b)b.hidden=true;
  _syncBannerDismissed=false; // reset so it can re-show on a NEW local-only event
}
function dismissSyncBanner(){
  _syncBannerDismissed=true;
  const b=document.getElementById('sync-banner');if(b)b.hidden=true;
}
async function reconnectAuth(){
  // Re-prompt for PIN to refresh the Auth session — most user-friendly recovery path
  if(!cur){toast(i18nCore.t('saveStatus.signInFromLogin'));return;}
  const ud=allData.users?.[cur];
  if(!ud){toast(i18nCore.t('saveStatus.userRecordMissing'));return;}
  const pin=prompt(i18nCore.t('saveStatus.reconnectPrompt',{trainer:cur}));
  if(!pin)return;
  if(!isSixDigitPin(pin)){toast(i18nCore.t('validation.pinSixDigits'));return;}
  const ok=await verifyPin(pin,ud.pin);
  if(!ok){toast(i18nCore.t('saveStatus.wrongPin'));return;}
  try{
    await ensureFirebaseIdentity(cur,pin,ud);
    // Auth observer will pick up the signin and auto-flush the queue
    toast(i18nCore.t('saveStatus.reconnected'),3000);
  }catch(e){
    console.error('Reconnect failed',e);
    toast(i18nCore.t('saveStatus.reconnectFailed'),4500);
  }
}
async function openSyncDetail(){
  const account=accountSyncPresentation();
  if(account){
    if(account.plan.action==='review-conflict'){await reviewAccountSyncConflicts();return;}
    if(account.plan.action!=='none'){await requestAccountSyncRecovery();return;}
    if(account.state==='review-required'){openAccountSettingsSection('data');return;}
    toast(i18nCore.t(account.detailKey,{count:i18nCore.formatNumber(account.count)}),4500);
    return;
  }
  const s=_syncStatusCurrent||'offline';
  const q=Object.keys(syncQueue||{}).length;
  const key={online:'saveStatus.onlineDetail',syncing:'saveStatus.syncingDetail',offline:'saveStatus.offlineDetail',localOnly:'saveStatus.localOnlyDetail'}[s]||'saveStatus.unknownDetail';
  toast(i18nCore.t(key,{count:i18nCore.formatNumber(q),status:s}),4500);
}
async function useSavedAccountCopyForPreservedReview(){
  if(accountSyncPreservedReviewRunning)return;
  const authority=await accountSyncPreservedReviewAuthority();
  if(authority.mode!=='canonical-review'){toast(i18nCore.t('accountSync.preservedReviewUnavailable'),4500);return;}
  const count=authority.candidateIds.length;
  if(!confirm(i18nCore.t('accountSync.preservedReviewPrompt',{count:i18nCore.formatNumber(count)})))return;
  if(!accountSyncPreservedReviewAuthorityCurrent(authority)){toast(i18nCore.t('accountSync.preservedReviewUnavailable'),4500);return;}
  accountSyncPreservedReviewRunning=true;refreshSyncUi();
  try{
    const result=await authority.runtime.completeRecoveryReviews(authority.candidateIds);
    if(!result?.ok||!accountSyncPreservedReviewAuthorityCurrent(authority))throw Object.assign(new Error('Recovery review authority changed'),{code:result?.error?.code||'account-sync/session-changed'});
    accountSyncUiState=await authority.runtime.snapshot();
    if(!accountSyncPreservedReviewAuthorityCurrent(authority)||accountSyncUiState.state!=='saved'||accountSyncUiState.recoveryCandidateCount!==0||!applyAccountSyncCanonicalEntities(Object.freeze(authority.controller.activeEntities())))throw Object.assign(new Error('Saved account projection was not accepted'),{code:'account-sync/recovery-review-incomplete'});
    refreshSyncUi();toast(i18nCore.t('accountSync.preservedReviewSucceeded',{count:i18nCore.formatNumber(result.count)}),4000);
  }catch(error){
    console.error('Account sync preserved review failed',accountSyncRuntimeData.diagnosticCode(error,'account-sync/recovery-review-failed'));
    try{if(authority.runtime===managedAccountSyncRuntime)accountSyncUiState=await authority.runtime.snapshot();}catch{}
    refreshSyncUi();toast(i18nCore.t('accountSync.preservedReviewFailed'),5000);
  }finally{accountSyncPreservedReviewRunning=false;refreshSyncUi();}
}
async function requestAccountSyncRecovery(){
  const account=accountSyncPresentation();if(!account)return;
  if(account.plan.action==='review-conflict'){await reviewAccountSyncConflicts();return;}
  if(account.plan.action==='none'){toast(i18nCore.t('accountSync.noSafeRecovery'),4500);return;}
  const coordinator=getAccountSyncRecoveryCoordinator();
  if(coordinator.active){toast(i18nCore.t('accountSync.recoveryRunning'),2500);return coordinator.recover();}
  const promptKey=account.plan.action==='retry-blocked'?'accountSync.retrySavedPrompt':'accountSync.restartPrompt';
  if(!confirm(i18nCore.t(promptKey,{count:i18nCore.formatNumber(account.plan.blockedCount)})))return;
  const result=await performAccountSyncRecovery();
  if(result.ok){toast(i18nCore.t('accountSync.recoverySucceeded'),3500);return result;}
  if(result.status==='pending'){toast(i18nCore.t('accountSync.recoveryPending'),4500);return result;}
  if(result.status==='review'){
    if(result.category==='review-required'){openAccountSettingsSection('data');toast(i18nCore.t('accountSync.reviewRequiredDetail'),3500);return result;}
    toast(i18nCore.t('accountSync.reviewConflict'),3500);await reviewAccountSyncConflicts();return result;
  }
  toast(i18nCore.t('accountSync.recoveryFailed'),5000);return result;
}
function accountSyncConflictFieldLabel(path){
  if(path==='priority')return i18nCore.t('myList.priority');
  if(path==='variant')return i18nCore.t('myList.variantDetails');
  if(path==='backgroundId')return i18nCore.t('background.label');
  if(String(path).startsWith('tagIds/'))return i18nCore.t('accountSync.favoriteTag');
  const labelKeys={gender:'accountSync.fieldGender',lucky:'accountSync.fieldLucky',xxl:'accountSync.fieldXxl',xxs:'accountSync.fieldXxs',shiny:'accountSync.fieldShiny',sortOrder:'accountSync.fieldOrder',quantity:'accountSync.fieldQuantity',note:'accountSync.fieldNotes',mirror:'accountSync.fieldMirror'};
  return i18nCore.t(labelKeys[path]||'accountSync.changedValue');
}
function accountSyncConflictValue(path,value){
  if(path==='priority')return value?i18nCore.t(`priority.${{H:'high',M:'medium',L:'low'}[value]}`):i18nCore.t('accountSync.none');
  if(path==='backgroundId')return value?backgroundDisplayName(value):i18nCore.t('background.none');
  if(typeof value==='boolean')return i18nCore.t(value?'accountSync.on':'accountSync.off');
  return String(value??'').trim()||i18nCore.t('accountSync.none');
}
function accountSyncConflictItemName(detail){
  if(detail.entityType==='tradeEntry')return accountSyncCatalogEntryForId(detail.identity?.catalogId,detail.identity)?.displayName||accountSyncCatalogEntryForId(detail.identity?.catalogId,detail.identity)?.name||i18nCore.t('accountSync.syncedItem');
  const entity=managedAccountSyncRuntime?.controller.getEntity(detail.entityType,detail.entityId);
  return entity?.values?.displayName||entity?.values?.label||i18nCore.t('accountSync.syncedItem');
}
function accountSyncConflictReviewPlan(details){
  const normalized=Array.isArray(details)?details:[];
  const fieldless=normalized.filter(detail=>!Array.isArray(detail?.fields)||detail.fields.length===0);
  return Object.freeze({fieldless:Object.freeze(fieldless),canReapply:normalized.length>0&&fieldless.length===0});
}
async function reviewAccountSyncConflicts(){
  const plan=accountSyncCurrentRecoveryPlan();
  if(plan.category==='unsafe-evidence'||plan.action!=='review-conflict'){toast(i18nCore.t('accountSync.noSafeRecovery'),4500);return;}
  const runtime=managedAccountSyncRuntime,details=await runtime?.conflictDetails?.();
  if(!details?.length){toast(i18nCore.t('accountSync.noConflicts'),3500);return;}
  const reviewPlan=accountSyncConflictReviewPlan(details);
  const fieldRows=details.flatMap(detail=>(Array.isArray(detail.fields)?detail.fields:[]).map(field=>({key:`${accountSyncConflictItemName(detail)} · ${accountSyncConflictFieldLabel(field.path)}`,local:accountSyncConflictValue(field.path,field.deviceValue),remote:accountSyncConflictValue(field.path,field.accountValue)})));
  const itemRows=reviewPlan.fieldless.map(detail=>({key:`${accountSyncConflictItemName(detail)} · ${i18nCore.t('accountSync.itemState')}`,local:i18nCore.t('accountSync.earlierDeviceAction'),remote:i18nCore.t('accountSync.currentSavedItem')}));
  const rows=[...fieldRows,...itemRows];
  if(!rows.length){toast(i18nCore.t('accountSync.conflictDetail'),4500);return;}
  showConflictModal(rows,reviewPlan.canReapply?async()=>{
    const results=await Promise.all(details.map(detail=>runtime.reapplyConflict(detail.conflictId)));
    toast(i18nCore.t(results.every(result=>result?.ok)?'accountSync.deviceValuesQueued':'accountSync.retryFailed'),4500);
  }:null,async()=>{
    const results=await Promise.all(details.map(detail=>runtime.acceptConflict(detail.conflictId)));
    toast(i18nCore.t(results.every(result=>result?.ok)?'accountSync.accountValuesAccepted':'accountSync.retryFailed'),4500);
  },{savedOnly:!reviewPlan.canReapply});
}
let _modalPrevFocus=null;
let _modalKeyHandler=null;
let _modalFocusTimer=null;
let _modalActiveId='';
let _toastTimer=null;
let _feedbackAnnouncementTimer=null;
let _lastFeedbackAnnouncement={message:'',at:0};
let _settingsContext='public';
let _settingsScrollSnapshot=null;
let _settingsSection='profile';
let _pendingSettingsRouteSection=null;
const SETTINGS_SECTIONS=Object.freeze(['profile','language','appearance','security','tools','data']);
const SETTINGS_DESKTOP_QUERY='(min-width:768px)';
function accountMenuElements(){return{trigger:document.getElementById('account-trigger'),popover:document.getElementById('account-popover')};}
function closeAccountMenu(restoreFocus=true){
  const{trigger,popover}=accountMenuElements();if(!trigger||!popover)return;
  const wasOpen=!popover.hidden;
  popover.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-label',i18nCore.t('account.openMenu'));
  if(wasOpen&&restoreFocus)trigger.focus();
}
function openAccountMenu(){
  if(!cur)return;
  const{trigger,popover}=accountMenuElements();if(!trigger||!popover)return;
  popover.hidden=false;trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-label',i18nCore.t('account.closeMenu'));
  popover.querySelector('button')?.focus({preventScroll:true});
}
function toggleAccountMenu(event){
  event?.stopPropagation?.();
  const{popover}=accountMenuElements();if(!popover)return;
  if(popover.hidden)openAccountMenu();else closeAccountMenu();
}
function settingsRouteHash(section=null){return section&&SETTINGS_SECTIONS.includes(section)?`#settings/${section}`:'#settings';}
function parseSettingsRoute(hash=location.hash){
  if(hash==='#settings')return{matches:true,section:null,valid:true};
  const match=/^#settings\/([^/?#]+)$/.exec(hash);
  if(!match)return{matches:false,section:null,valid:false};
  return{matches:true,section:SETTINGS_SECTIONS.includes(match[1])?match[1]:'profile',valid:SETTINGS_SECTIONS.includes(match[1])};
}
function settingsRouteUrl(includeHash=true,section=null){
  const url=new URL(location.href);if(url.searchParams.get('action')==='settings')url.searchParams.delete('action');
  url.hash=includeHash?settingsRouteHash(section):'';
  return`${url.pathname}${url.search}${url.hash}`;
}
function writeSettingsRoute(section,{mode='push'}={}){
  const normalized=_settingsContext==='account'&&SETTINGS_SECTIONS.includes(section)?section:null;
  const target=settingsRouteUrl(true,normalized);
  if(`${location.pathname}${location.search}${location.hash}`===target)return false;
  const previousDepth=history.state?.settingsPanel?Math.max(1,Number(history.state.settingsDepth)||1):0;
  const state={...history.state,settingsPanel:true,settingsSection:normalized,settingsDepth:mode==='replace'?Math.max(1,previousDepth):previousDepth+1,settingsParentSection:mode==='replace'?history.state?.settingsParentSection??null:history.state?.settingsSection??null};
  if(mode==='replace')history.replaceState(state,'',target);
  else history.pushState(state,'',target);
  return true;
}
function adoptDirectSettingsRoute(route=parseSettingsRoute()){
  if(!route.matches||history.state?.settingsPanel)return false;
  const baseState={...history.state,settingsPanel:false,settingsSection:null,settingsDepth:0,settingsDirectRoot:true,settingsParentSection:null};
  history.replaceState(baseState,'',settingsRouteUrl(false));
  if(cur&&route.section&&!matchMedia(SETTINGS_DESKTOP_QUERY).matches){
    history.pushState({...baseState,settingsPanel:true,settingsDepth:1},'',settingsRouteUrl(true));
    history.pushState({...baseState,settingsPanel:true,settingsSection:route.section,settingsDepth:2},'',settingsRouteUrl(true,route.section));
  }else history.pushState({...baseState,settingsPanel:true,settingsSection:route.section,settingsDepth:1},'',settingsRouteUrl(true,route.section));
  return true;
}
function settingsRouteKey(){
  const url=new URL(location.href);if(url.searchParams.get('action')==='settings')url.searchParams.delete('action');
  url.hash='';
  return`${url.pathname}${url.search}`;
}
function captureSettingsScrollSnapshot(){
  _settingsScrollSnapshot={x:window.scrollX,y:window.scrollY,routeKey:settingsRouteKey()};
  return _settingsScrollSnapshot;
}
function validSettingsScrollSnapshot(){
  if(!_settingsScrollSnapshot)return null;
  if(_settingsScrollSnapshot.routeKey!==settingsRouteKey()){
    _settingsScrollSnapshot=null;
    return null;
  }
  return _settingsScrollSnapshot;
}
function preserveSettingsScrollSnapshot(snapshot=validSettingsScrollSnapshot()){
  if(snapshot)window.scrollTo(snapshot.x,snapshot.y);
}
function restoreAndClearSettingsScrollSnapshot(){
  const snapshot=validSettingsScrollSnapshot();
  _settingsScrollSnapshot=null;
  if(!snapshot)return;
  preserveSettingsScrollSnapshot(snapshot);
  // Same-document history traversal may finish native scroll restoration after
  // popstate. Reapply once at the next paint boundary, then release the snapshot.
  requestAnimationFrame(()=>preserveSettingsScrollSnapshot(snapshot));
}
function settingsUsesPageMode(){return _settingsContext==='account'&&matchMedia(SETTINGS_DESKTOP_QUERY).matches;}
function applySettingsPresentation(){
  const overlay=document.getElementById('settings-modal');if(!overlay)return;
  const pageMode=settingsUsesPageMode();overlay.classList.toggle('settings-page-mode',pageMode);
  if(pageMode){overlay.removeAttribute('role');overlay.removeAttribute('aria-modal');}
  else{overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');}
}
const PROVIDER_LINKING_STATUS_KEYS=Object.freeze({
  connected:'security.connected','not-connected':'security.notConnected',connecting:'security.connecting',
  'waiting-browser':'security.waitingBrowser','needs-attention':'security.needsAttention',reauthenticate:'security.reauthenticate',
  disconnecting:'security.disconnecting',unavailable:'security.unavailable'
});
function renderConnectedAccounts(){
  const methods=providerLinkingRegistry?providerLinkingRegistry.methods({providerData:auth?.currentUser?.providerData||[],usernamePinAvailable:!!cur}):[
    {key:'username-pin',visible:true,state:cur?'connected':'unavailable',detailKey:'security.usernamePinHelp'}
  ];
  for(const method of methods){
    const row=document.querySelector(`#settings-account-security [data-provider="${method.key}"]`);if(!row)continue;
    row.hidden=!method.visible;row.dataset.providerState=method.state;
    const detail=row.querySelector('[data-provider-detail]');if(detail)detail.textContent=i18nCore.t(method.detailKey);
    const status=row.querySelector('[data-provider-status]'),label=row.querySelector('[data-provider-status-label]'),icon=row.querySelector('[data-provider-status-icon]');
    status?.classList.toggle('is-active',method.state==='connected');
    if(label)label.textContent=i18nCore.t(PROVIDER_LINKING_STATUS_KEYS[method.state]||'security.needsAttention');
    if(icon)icon.textContent=method.state==='connected'?'✓':method.state==='connecting'||method.state==='disconnecting'||method.state==='waiting-browser'?'…':'○';
  }
}
function configureSettingsPanel(context='public'){
  _settingsContext=context==='account'&&cur?'account':'public';
  document.querySelectorAll('.settings-account-only').forEach(el=>{el.hidden=_settingsContext!=='account';});
  document.querySelectorAll('.settings-admin-only').forEach(el=>{el.hidden=_settingsContext!=='account'||!protectedOwnerSession();});
  const description=document.getElementById('settings-description');
  if(description)description.textContent=i18nCore.t(_settingsContext==='account'?'settings.description':'settings.publicDescription');
  const name=document.getElementById('settings-account-name');if(name)name.textContent=cur||'';
  const securityName=document.getElementById('settings-security-name');if(securityName)securityName.textContent=cur||'';
  renderConnectedAccounts();
  const language=document.getElementById('settings-language');if(language)language.value=i18nCore.getLocale();
  const release=document.getElementById('settings-release-id');if(release)release.textContent=i18nCore.t('settings.release',{release:clientReleaseDomain.RELEASE_ID});
  syncPokemonGoSearchLanguageControl();
  syncAppearanceControls();
  const layout=document.getElementById('settings-layout');
  layout?.classList.toggle('settings-public',_settingsContext==='public');
  applySettingsPresentation();
  const mobile=!matchMedia(SETTINGS_DESKTOP_QUERY).matches;
  const preserveMobileDetail=_settingsContext==='account'&&document.getElementById('settings-modal')?.classList.contains('open')&&mobile&&!layout?.classList.contains('mobile-list');
  if(_settingsContext==='public'){layout?.classList.remove('mobile-list');selectSettingsSection('language',{focus:false});}
  else if(mobile){if(!preserveMobileDetail)layout?.classList.add('mobile-list');selectSettingsSection(_settingsSection,{focus:false,keepList:!preserveMobileDetail,updateHistory:false});}
  else{layout?.classList.remove('mobile-list');selectSettingsSection(_settingsSection,{focus:false,updateHistory:false});}
}
function selectSettingsSection(section='profile',options={}){
  if(!SETTINGS_SECTIONS.includes(section))section='profile';if(_settingsContext!=='account')section='language';const previous=_settingsSection;_settingsSection=section;
  document.querySelectorAll('[data-settings-section]').forEach(panel=>{panel.hidden=panel.dataset.settingsSection!==section;const heading=panel.querySelector('h2');if(heading)heading.tabIndex=-1;});
  document.querySelectorAll('[data-settings-target]').forEach(button=>{const active=button.dataset.settingsTarget===section;button.setAttribute('aria-current',active?'page':'false');});
  const layout=document.getElementById('settings-layout');if(!options.keepList)layout?.classList.remove('mobile-list');
  const detail=document.getElementById('settings-detail');if(detail&&previous!==section&&options.resetScroll!==false)detail.scrollTop=0;
  if(_settingsContext==='account'&&options.updateHistory!==false&&document.getElementById('settings-modal')?.classList.contains('open'))writeSettingsRoute(section,{mode:options.historyMode||'push'});
  if(options.focus!==false)requestAnimationFrame(()=>document.querySelector(`[data-settings-section="${section}"] h2`)?.focus({preventScroll:true}));
}
function showSettingsSectionList(options={}){
  if(matchMedia(SETTINGS_DESKTOP_QUERY).matches)return;
  const route=parseSettingsRoute();
  document.getElementById('settings-layout')?.classList.add('mobile-list');
  if(route.section&&options.updateHistory!==false&&history.state?.settingsPanel&&history.state?.settingsSection===route.section&&history.state?.settingsParentSection==null){history.back();return;}
  if(route.section&&options.updateHistory!==false)writeSettingsRoute(null,{mode:'replace'});
  requestAnimationFrame(()=>document.querySelector(`[data-settings-target="${_settingsSection}"]`)?.focus({preventScroll:true}));
}
function settingsDetailIsOpenOnMobile(){return!matchMedia(SETTINGS_DESKTOP_QUERY).matches&&!document.getElementById('settings-layout')?.classList.contains('mobile-list')&&_settingsContext==='account';}
function openSettingsPanel(context='public',options={}){
  const accountContext=context==='account'&&!!cur;
  const route=parseSettingsRoute();
  if(accountContext&&route.section)_settingsSection=route.section;
  const returnFocus=options.returnFocus||(accountContext?document.getElementById('account-trigger'):(document.activeElement instanceof HTMLElement?document.activeElement:null));
  closeAccountMenu(false);renderInterimProductLabels();configureSettingsPanel(accountContext?'account':'public');
  if(accountContext&&route.valid&&route.section&&!settingsUsesPageMode())selectSettingsSection(route.section,{focus:false,updateHistory:false});
  const modal=document.getElementById('settings-modal');
  if(!modal?.classList.contains('open')&&options.captureScroll!==false)captureSettingsScrollSnapshot();
  const section=accountContext&&(settingsUsesPageMode()||route.valid&&route.section)?_settingsSection:null;
  const target=settingsRouteUrl(true,section);
  if(options.updateHistory!==false)writeSettingsRoute(section);
  else if(route.matches&&(!route.valid||!accountContext&&route.section||accountContext&&settingsUsesPageMode()&&!route.section))writeSettingsRoute(section,{mode:'replace'});
  preserveSettingsScrollSnapshot();
  const initialFocus=_settingsContext==='account'&&settingsUsesPageMode()?`[data-settings-section="${_settingsSection}"] h2`:_settingsContext==='account'?`[data-settings-target="${_settingsSection}"]`:'#settings-language';
  openModal('settings-modal',{returnFocus,initialFocus});
}
function openAccountSettingsSection(section='profile'){
  if(!cur)return;_settingsSection=SETTINGS_SECTIONS.includes(section)?section:'profile';openSettingsPanel('account');selectSettingsSection(_settingsSection,{updateHistory:true});
}
function closeSettingsRoute(){
  if(!parseSettingsRoute().matches)return false;
  if(history.state?.settingsPanel){history.go(-Math.max(1,Number(history.state.settingsDepth)||1));return true;}
  history.replaceState({...history.state,settingsPanel:false},'',settingsRouteUrl(false));
  return false;
}
function syncSettingsRoute(options={}){
  const modal=document.getElementById('settings-modal');if(!modal)return;
  const route=parseSettingsRoute();
  if(route.valid&&route.section&&!_authStateKnown&&!cur){
    _pendingSettingsRouteSection=route.section;
    return;
  }
  if(_authStateKnown||cur)_pendingSettingsRouteSection=null;
  adoptDirectSettingsRoute(route);
  if(route.matches&&!modal.classList.contains('open')){
    const publicContext=document.getElementById('share-view')?.classList.contains('active')||!cur;
    openSettingsPanel(publicContext?'public':'account',{updateHistory:false,captureScroll:options.captureScroll!==false});
  }else if(route.matches&&modal.classList.contains('open')){
    if(_settingsContext==='account'&&!route.valid){
      selectSettingsSection('profile',{updateHistory:false});
      history.replaceState({...history.state,settingsPanel:true,settingsSection:settingsUsesPageMode()?'profile':null},'',settingsRouteUrl(true,settingsUsesPageMode()?'profile':null));
    }else if(_settingsContext==='account'&&route.section&&route.section!==_settingsSection)selectSettingsSection(route.section,{updateHistory:false});
    else if(_settingsContext==='account'&&route.section&&!settingsUsesPageMode()&&document.getElementById('settings-layout')?.classList.contains('mobile-list'))selectSettingsSection(route.section,{updateHistory:false});
    else if(_settingsContext==='account'&&!route.section&&!settingsUsesPageMode())showSettingsSectionList({updateHistory:false});
    else if(_settingsContext==='public'&&route.section)history.replaceState({...history.state,settingsPanel:true,settingsSection:null},'',settingsRouteUrl(true));
  }else if(!route.matches&&modal.classList.contains('open'))closeModal('settings-modal',{route:false});
}
function syncPendingSettingsRouteAfterAuth(){
  if(!_pendingSettingsRouteSection&&!parseSettingsRoute().matches)return;
  setTimeout(()=>syncSettingsRoute({captureScroll:false}),0);
}
function openSettingsTool(tool){
  if(!cur)return;
  closeModal('settings-modal',{route:false});
  if(parseSettingsRoute().matches)history.replaceState({...history.state,settingsPanel:false},'',settingsRouteUrl(false));
  setTimeout(()=>{
    if(tool==='health')openLoginHealthCheck();
    else if(tool==='shortcuts')openModal('shortcuts-modal',{returnFocus:document.getElementById('account-trigger')});
    else if(tool==='inventory')openLegacyInventoryTool();
    else if(tool==='import')openImport();
    else if(tool==='export'){switchTab('mylist');requestAnimationFrame(()=>document.getElementById('export-menu-btn')?.click());}
    else if(tool==='safe-transfer')openSafeTransferModal();
    else if(tool==='backup'&&protectedOwnerSession())exportData();
  },0);
}
function openModal(id,options={}){
  const m=document.getElementById(id);if(!m)return;
  if(_modalActiveId&&_modalActiveId!==id){
    const active=document.getElementById(_modalActiveId);
    if(_modalActiveId==='trainer-organizer-modal')closeTrainerOrganizer();else closeModal(_modalActiveId,{route:false});
    if(active?.classList.contains('open'))return;
  }
  const alreadyOpen=m.classList.contains('open')&&_modalActiveId===id;
  if(!alreadyOpen)_modalPrevFocus=options.returnFocus||document.activeElement;
  if(_modalKeyHandler){document.removeEventListener('keydown',_modalKeyHandler);_modalKeyHandler=null;}
  if(_modalFocusTimer){clearTimeout(_modalFocusTimer);_modalFocusTimer=null;}
  _modalActiveId=id;
  m.classList.add('open');
  // Focus first focusable element
  _modalFocusTimer=setTimeout(()=>{
    _modalFocusTimer=null;
    if(_modalActiveId!==id||!m.classList.contains('open'))return;
    if(m.contains(document.activeElement))return;
    const focusables=m.querySelectorAll('input:not([type=hidden]),select,textarea,button,[tabindex]:not([tabindex="-1"])');
    const preferred=options.initialFocus?m.querySelector(options.initialFocus):null;
    if(preferred||focusables[0])(preferred||focusables[0]).focus(id==='settings-modal'?{preventScroll:true}:undefined);
  },50);
  _modalKeyHandler=ev=>{
    if(_modalActiveId!==id||!m.classList.contains('open'))return;
    if(ev.key==='Escape'){if(id==='settings-modal'&&settingsDetailIsOpenOnMobile()){showSettingsSectionList();return;}if(id==='trainer-organizer-modal')closeTrainerOrganizer();else closeModal(id);return;}
    if(ev.key!=='Tab'||(id==='settings-modal'&&settingsUsesPageMode()))return;
    const focusables=[...m.querySelectorAll('input:not([type=hidden]),select,textarea,button,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.offsetParent!==null);
    if(!focusables.length)return;
    const first=focusables[0],last=focusables[focusables.length-1];
    if(ev.shiftKey&&document.activeElement===first){last.focus();ev.preventDefault();}
    else if(!ev.shiftKey&&document.activeElement===last){first.focus();ev.preventDefault();}
  };
  document.addEventListener('keydown',_modalKeyHandler);
}
function closeModal(id){
  const options=arguments[1]||{};
  if(id==='settings-modal'&&options.route!==false&&closeSettingsRoute())return;
  document.getElementById(id)?.classList.remove('open');
  if(_modalActiveId!==id)return;
  if(_modalFocusTimer){clearTimeout(_modalFocusTimer);_modalFocusTimer=null;}
  if(_modalKeyHandler){document.removeEventListener('keydown',_modalKeyHandler);_modalKeyHandler=null;}
  _modalActiveId='';
  const returnFocus=_modalPrevFocus;_modalPrevFocus=null;
  if(returnFocus?.isConnected&&!returnFocus.disabled)returnFocus.focus(id==='settings-modal'?{preventScroll:true}:undefined);
  if(id==='settings-modal')restoreAndClearSettingsScrollSnapshot();
}
function announceFeedback(message){
  const text=String(message||'').replace(/\s+/g,' ').trim();
  const status=document.getElementById('feedback-status');
  if(!text||!status)return false;
  const now=Date.now();
  if(_lastFeedbackAnnouncement.message===text&&now-_lastFeedbackAnnouncement.at<800)return false;
  _lastFeedbackAnnouncement={message:text,at:now};
  if(_feedbackAnnouncementTimer)clearTimeout(_feedbackAnnouncementTimer);
  status.textContent='';
  _feedbackAnnouncementTimer=setTimeout(()=>{
    _feedbackAnnouncementTimer=null;
    status.textContent=text;
  },20);
  return true;
}
function toast(msg,dur=2500){
  const t=document.getElementById('toast');
  if(!t)return;
  clearTimeout(_toastTimer);
  t.hidden=false;
  t.setAttribute('aria-hidden','false');
  t.textContent=msg;
  t.classList.add('show');
  announceFeedback(msg);
  _toastTimer=setTimeout(()=>{
    t.classList.remove('show');
    t.setAttribute('aria-hidden','true');
    t.hidden=true;
    t.textContent='';
  },dur);
}


// ── DIFF VIEW (#6) ────────────────────────────────────────────
let _activeDiff=null;
let _activeTradeMatch=null;
let _tradeMatchPrevFocus=null;
let _tradeMatchKeyHandler=null;
let _tradeComparisonReturn=null;
function openActiveShareComparison(){
  const username=_activeShareView?.username;
  if(username)openTradeMatchModal(username);
}
function openDiffModal(otherUsername){
  if(!cur||otherUsername===cur){toast(i18nCore.t('compare.pickAnother'));return;}
  const publicShareActive=_activeShareView?.username===otherUsername&&!!selectedTrainerRuntime.publicData;
  if(!publicShareActive&&!guardReadScopeTrainer(otherUsername,'compare'))return;
  closeTradeMatchModal();
  _activeDiff={them:otherUsername,type:strListType};
  renderDiffModal();
}
function closeDiffModal(){
  document.getElementById('diff-modal')?.remove();
  _activeDiff=null;
}
function setDiffListType(t){
  if(!_activeDiff)return;
  _activeDiff.type=t;
  renderDiffModal();
}
function computeTrainerDiff(typ,me,them){
  const myList=allData[typ]?.[me]||{};
  const theirList=allData[typ]?.[them]||{};
  const srcArr=listSource(typ);
  const dispMap={},noMap={};
  srcArr.forEach(e=>addPokemonEntryAliases(e,dispMap,noMap));
  const project=list=>new Map(Object.entries(list).map(([name,value])=>[pokemonCatalogDomain.catalogKey(name),{name,value}]));
  const mine=project(myList),theirs=project(theirList);
  const myKeys=new Set(mine.keys());
  const theirKeys=new Set(theirs.keys());
  const bothKeys=[...myKeys].filter(k=>theirKeys.has(k));
  const onlyMine=[...myKeys].filter(k=>!theirKeys.has(k));
  const onlyTheirs=[...theirKeys].filter(k=>!myKeys.has(k));
  const entryFor=record=>{
    const {name,value}=record;
    const {p,mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(value);
    return {name,dn:dispMap[name]||name,no:noMap[name]||'',p,mod,lucky,xxl,xxs,shiny,backgroundId,gender:entryGender(mod)};
  };
  const both=bothKeys.map(k=>({mine:entryFor(mine.get(k)),theirs:entryFor(theirs.get(k))}));
  // Sort: priority match first, then dex
  both.sort((a,b)=>{
    const matchA=a.mine.p===a.theirs.p?0:1;
    const matchB=b.mine.p===b.theirs.p?0:1;
    return matchA-matchB||(parseInt(a.mine.no)||9999)-(parseInt(b.mine.no)||9999)||comparePokemonLabels(a.mine.dn,b.mine.dn);
  });
  return{
    both,
    onlyMine:onlyMine.map(k=>entryFor(mine.get(k))).sort(_familySort),
    onlyTheirs:onlyTheirs.map(k=>entryFor(theirs.get(k))).sort(_familySort)
  };
}
function diffSectionEntries(diff,section){
  if(section==='both')return diff.both.map(d=>d.mine);
  if(section==='mine')return diff.onlyMine;
  if(section==='theirs')return diff.onlyTheirs;
  return[];
}
function diffSectionSearchString(section){
  if(!_activeDiff||!cur)return'';
  const diff=computeTrainerDiff(_activeDiff.type,cur,_activeDiff.them);
  return dexStringFromNumbers(diffSectionEntries(diff,section).map(e=>e.no),{locale:pokemonGoSearchLocale()});
}
async function copyDiffSearch(section,btn){
  const str=diffSectionSearchString(section);
  if(!str){toast(i18nCore.t('compare.emptySection'));return;}
  await copyStr(str,btn);
}
function openTradeMatchModal(otherUsername){
  if(!cur||otherUsername===cur){toast(i18nCore.t('compare.pickAnother'));return;}
  const publicShareActive=_activeShareView?.username===otherUsername&&!!selectedTrainerRuntime.publicData;
  if(!publicShareActive&&!guardReadScopeTrainer(otherUsername,'trade match'))return;
  closeDiffModal();
  if(!_activeTradeMatch)_tradeMatchPrevFocus=document.activeElement;
  _activeTradeMatch={them:otherUsername};
  renderTradeMatchModal();
}
function closeTradeMatchModal(restoreFocus=true){
  document.getElementById('trade-match-modal')?.remove();
  if(_tradeMatchKeyHandler)document.removeEventListener('keydown',_tradeMatchKeyHandler);
  _tradeMatchKeyHandler=null;
  _activeTradeMatch=null;
  const returnFocus=_tradeMatchPrevFocus;_tradeMatchPrevFocus=null;
  if(restoreFocus&&returnFocus?.isConnected&&!returnFocus.disabled)returnFocus.focus();
}
function tradeListWants(username){
  const entries=[];
  for(const type of OWNED_MY_LIST_TYPES){
    Object.entries(allData[type]?.[username]||{}).forEach(([name,value])=>{
      const parsed=parsePri(value),source=_nameToSpriteEntry(name);
      entries.push({key:`${type}:${name}`,name,type,p:parsed.p,mod:parsed.mod,gender:entryGender(parsed.mod),backgroundId:parsed.backgroundId,lucky:parsed.lucky,shiny:parsed.shiny,xxl:parsed.xxl,xxs:parsed.xxs,mirror:false,dn:pokemonDisplayName({...source,name:source.name||name,displayName:source.displayName||name}),no:source.no});
    });
  }
  const board=allData.users?.[username]?.specialTradeBoard;
  (Array.isArray(board?.lf)?board.lf:[]).forEach((item,index)=>{
    if(!item?.name)return;
    const source=_nameToSpriteEntry(item.name);
    entries.push({key:`special-lf:${index}:${item.name}`,name:item.name,type:'special',p:'',mod:'',gender:'',backgroundId:normalizeBackgroundId(item.backgroundId),lucky:false,shiny:!!item.shiny,xxl:false,xxs:false,mirror:!!item.mirror,dn:pokemonDisplayName({...source,name:source.name||item.name,displayName:item.dn||source.displayName||item.name}),no:item.no||source.no});
  });
  return entries.sort((a,b)=>(PRI_ORDER[a.p]??9)-(PRI_ORDER[b.p]??9)||(parseInt(a.no)||9999)-(parseInt(b.no)||9999)||comparePokemonLabels(a.dn,b.dn));
}
function ownTradeListsAvailable(){
  if(!fbOn||!db)return true;
  const uid=String(auth?.currentUser?.uid||'');
  if(!uid||!cur)return false;
  return OWNED_MY_LIST_TYPES.every(type=>ownedExactReadsEnabled()
    ?managedOwnedDataCoordinator?.isHydratedFor(type,{uid,username:cur})===true
    :_pathLoadState[type]==='loaded')&&!!allData.users?.[cur];
}
function trainerTradeListsAvailable(them){
  if(selectedTrainerRuntime.username===them&&!!selectedTrainerRuntime.publicData)return true;
  return protectedOwnerSession()&&OWNED_MY_LIST_TYPES.every(type=>_pathLoadState[type]==='loaded')&&!!allData.users?.[them];
}
function computeTradeMatchSummary(them){
  const myAvailable=ownTradeListsAvailable(),theirAvailable=trainerTradeListsAvailable(them);
  const availability={wants:myAvailable&&theirAvailable};
  if(!availability.wants)return{both:[],onlyMine:[],onlyTheirs:[],availability};
  const result=tradeListComparisonDomain.compareWantedLists({myWants:tradeListWants(cur),theirWants:tradeListWants(them)},{
    nameKey:pokemonCatalogDomain.catalogKey,
    normalizeQualifier:normalizeTradeQualifier
  });
  return{...result,availability};
}
function tradeIntentFreeform(mod){
  return normalizeTradeQualifier(mod)
    .replace(/(^|[^\p{L}\p{N}])[MF](?=$|[^\p{L}\p{N}])/gu,'$1')
    .replace(/^[\s,;/|+_-]+|[\s,;/|+_-]+$/g,'').trim();
}
function tradeIntentQualifierTokens(intent){
  if(!intent)return[];
  const tokens=[];
  if(intent.type&&intent.type!=='wishlist')tokens.push({label:publicShareListLabel(intent.type)});
  if(intent.lucky)tokens.push({label:i18nCore.t('share.flagLucky')});
  if(intent.shiny)tokens.push({label:i18nCore.t('share.flagShiny')});
  if(intent.xxl)tokens.push({label:i18nCore.t('share.flagXxl')});
  if(intent.xxs)tokens.push({label:i18nCore.t('share.flagXxs')});
  if(intent.backgroundId)tokens.push({label:i18nCore.t('background.badgeLabel',{name:backgroundDisplayName(intent.backgroundId)}),cls:'background',backgroundId:intent.backgroundId});
  const gender=entryGender(intent.mod);
  if(gender)tokens.push({label:i18nCore.t(gender==='f'?'share.flagFemale':'share.flagMale')});
  const detail=tradeIntentFreeform(intent.mod);
  if(detail)tokens.push({label:detail});
  return tokens;
}
function tradeMatchMetric(label,items,available){
  return`<div class="share-match-metric ${available?'':'is-unavailable'}"><strong>${available?i18nCore.formatNumber(items.length):'—'}</strong><span>${escHtml(label)}</span>${available?'':`<small>${escHtml(i18nCore.t('tradeMatch.notShared'))}</small>`}</div>`;
}
function tradeMatchSearchItems(entries){
  const dexHasRegional={};
  for(const type of OWNED_MY_LIST_TYPES){
    for(const source of listSource(type)){if(source?.no&&regionalFormTerm(source.name))dexHasRegional[source.no]=true;}
  }
  return(entries||[]).map(intent=>{
    const source=_nameToSpriteEntry(intent.name),effective={...source,no:intent.no||source.no,maxType:maxTypeForEntry(source,intent.type)};
    const term=dexSearchTerm(effective,dexHasRegional);if(!term)return null;
    const filters=entrySearchFilters(effective,intent.mod||'');
    const add=filter=>{if(filter&&!filters.includes(filter))filters.push(filter);};
    if(intent.shiny)add('shiny');
    if(intent.gender)add(intent.gender==='f'?'female':'male');
    if(intent.xxl)add('xxl');
    if(intent.xxs)add('xxs');
    if(intent.lucky)add('lucky');
    return{term,filters};
  }).filter(Boolean);
}
function tradeMatchSearchHtml(entries,key,label,available){
  if(!available||!entries.length)return'';
  const value=stringFromSearchItems(tradeMatchSearchItems(entries),{locale:pokemonGoSearchLocale()});
  if(!value)return'';
  const option={value,levels:[],tooLong:strLenInfo(value).len>POGO_STR_LIMIT};
  return`<div class="trade-match-search" aria-label="${escAttr(label)}">${myListSearchOptionHtml(option,`trade-match-${key}`,{label,showLimit:true})}</div>`;
}
function renderTradeMatchSummary(them){
  const m=computeTradeMatchSummary(them);
  const chip=(it,cls='')=>{
    const img=it.no?spriteImg(it.no,38,'',it.name,it.gender||'',it.dn):'<span aria-hidden="true">◌</span>';
    const gender=it.gender?` ${it.gender==='f'?'♀':'♂'}`:'';
    const qualifiers=tradeIntentQualifierTokens(it);
    if(it.backgroundId&&!qualifiers.some(token=>token.cls==='background'))qualifiers.push({label:i18nCore.t('background.badgeLabel',{name:backgroundDisplayName(it.backgroundId)}),cls:'background',backgroundId:it.backgroundId});
    return`<article class="diff-match-chip ${cls}${it.backgroundId?` background-visual-card ${backgroundVisualClass(it.backgroundId)}`:''}" ${it.backgroundId?backgroundVisualAttrs(it.backgroundId):''} title="${escAttr(it.dn+gender)}">${backgroundVisualMotifHtml(it.backgroundId)}${img}<div class="diff-match-main"><span class="diff-match-name">${escHtml(it.dn)}${gender}</span>${qualifiers.length?`<span class="diff-match-qualifiers">${qualifiers.map(token=>token.backgroundId?backgroundBadgeHtml(token.backgroundId,'diff-match-qualifier background'):`<span class="diff-match-qualifier ${escAttr(token.cls||'')}">${escHtml(token.label)}</span>`).join('')}</span>`:''}</div></article>`;
  };
  const box=(cls,title,direction,items,available,empty)=>`<section class="diff-match-box ${cls}" aria-labelledby="trade-match-${cls}-title">
    <div class="diff-match-title" id="trade-match-${cls}-title">${escHtml(title)}<span class="diff-match-count">${available?i18nCore.formatNumber(items.length):'—'}</span></div>
    <p class="diff-match-direction">${escHtml(direction)}</p>
    ${!available?`<div class="diff-match-empty">${escHtml(i18nCore.t('tradeMatch.unavailableHelp'))}</div>`:items.length?`<div class="diff-match-list">${items.map((it,i)=>chip(it,i>=14?'extra':'')).join('')}${items.length>14?`<button type="button" class="diff-match-chip diff-match-more" data-more="${escAttr(i18nCore.t('tradeMatch.moreCount',{count:i18nCore.formatNumber(items.length-14)}))}" onclick="toggleTradeMatchSection(this)" aria-expanded="false">${escHtml(i18nCore.t('tradeMatch.moreCount',{count:i18nCore.formatNumber(items.length-14)}))}</button>`:''}</div>`:`<div class="diff-match-empty">${escHtml(empty)}</div>`}
    ${tradeMatchSearchHtml(items,cls,i18nCore.t('tradeMatch.searchString',{section:title}),available)}
  </section>`;
  return`<div class="trade-match-intro"><strong>${escHtml(i18nCore.t('tradeMatch.summary'))}</strong><span>${escHtml(i18nCore.t('tradeMatch.intro',{trainer:them}))}</span></div>
    <div class="trade-match-overview" aria-label="${escAttr(i18nCore.t('tradeMatch.detailsLabel'))}">${tradeMatchMetric(i18nCore.t('tradeMatch.bothWant'),m.both,m.availability.wants)}${tradeMatchMetric(i18nCore.t('tradeMatch.onlyIWant'),m.onlyMine,m.availability.wants)}${tradeMatchMetric(i18nCore.t('tradeMatch.onlyTheyWant',{trainer:them}),m.onlyTheirs,m.availability.wants)}</div>
    <div class="diff-match-panel" aria-label="${escAttr(i18nCore.t('tradeMatch.detailsLabel'))}">
    ${box('both',i18nCore.t('tradeMatch.bothWant'),i18nCore.t('tradeMatch.bothDirection',{trainer:them}),m.both,m.availability.wants,i18nCore.t('tradeMatch.emptyBoth',{trainer:them}))}
    ${box('mine',i18nCore.t('tradeMatch.onlyIWant'),i18nCore.t('tradeMatch.mineDirection',{trainer:them}),m.onlyMine,m.availability.wants,i18nCore.t('tradeMatch.emptyMine',{trainer:them}))}
    ${box('theirs',i18nCore.t('tradeMatch.onlyTheyWant',{trainer:them}),i18nCore.t('tradeMatch.theirsDirection',{trainer:them}),m.onlyTheirs,m.availability.wants,i18nCore.t('tradeMatch.emptyTheirs',{trainer:them}))}
  </div>`;
}
function renderTradeMatchModal(){
  if(!_activeTradeMatch)return;
  const{them}=_activeTradeMatch;
  const html=`<div class="diff-modal-overlay open" id="trade-match-modal" role="dialog" aria-modal="true" aria-labelledby="trade-match-title" onclick="if(event.target===this)closeTradeMatchModal()">
    <div class="diff-modal trade-match-modal" onclick="event.stopPropagation()">
      <div class="diff-hdr">
        <div class="diff-hdr-title" id="trade-match-title">${escHtml(i18nCore.t('tradeMatch.title',{trainer:them}))}</div>
        <button class="diff-hdr-close" onclick="closeTradeMatchModal()" aria-label="${escAttr(i18nCore.t('common.close'))}">×</button>
      </div>
      <div class="trade-match-body">
        ${renderTradeMatchSummary(them)}
        <div class="trade-match-actions"><button type="button" class="bghost" onclick="closeTradeMatchModal()">${escHtml(i18nCore.t('tradeMatch.backToList'))}</button><button type="button" class="bpri" onclick="editMyListFromTradeMatch()">${escHtml(i18nCore.t('tradeMatch.editMyList'))}</button></div>
      </div>
    </div>
  </div>`;
  document.getElementById('trade-match-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend',html);
  if(_tradeMatchKeyHandler)document.removeEventListener('keydown',_tradeMatchKeyHandler);
  _tradeMatchKeyHandler=event=>{
    const modal=document.getElementById('trade-match-modal');if(!modal)return;
    if(event.key==='Escape'){event.preventDefault();closeTradeMatchModal();return;}
    if(event.key!=='Tab')return;
    const focusable=[...modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.offsetParent!==null);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}
    else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}
  };
  document.addEventListener('keydown',_tradeMatchKeyHandler);
  requestAnimationFrame(()=>document.querySelector('#trade-match-modal .diff-hdr-close')?.focus());
}
function toggleTradeMatchSection(btn){
  const box=btn.closest('.diff-match-box');
  if(!box)return;
  const expanded=box.classList.toggle('expanded');
  btn.setAttribute('aria-expanded',expanded?'true':'false');
  btn.textContent=expanded?i18nCore.t('common.showLess'):(btn.dataset.more||i18nCore.t('common.showMore'));
}
function renderTradeComparisonReturn(){
  const banner=document.getElementById('trade-return-banner');if(!banner)return;
  if(!_tradeComparisonReturn){banner.hidden=true;banner.innerHTML='';return;}
  banner.hidden=false;
  banner.innerHTML=`<div class="trade-return-copy"><strong>${escHtml(i18nCore.t('tradeMatch.returnTitle',{trainer:_tradeComparisonReturn.username}))}</strong><span>${escHtml(i18nCore.t('tradeMatch.returnHelp'))}</span></div><button type="button" class="bpri" onclick="returnToTradeComparison()">${escHtml(i18nCore.t('tradeMatch.returnAction'))}</button>`;
}
function editMyListFromTradeMatch(){
  const username=_activeTradeMatch?.them;if(!username)return;
  _tradeComparisonReturn={username,type:_activeShareView?.type||'wishlist'};
  closeTradeMatchModal(false);
  document.getElementById('share-view')?.classList.remove('active');
  const app=document.getElementById('app');if(app){app.style.display='flex';app.style.flexDirection='column';}
  switchTab('mylist');
  requestAnimationFrame(()=>{renderTradeComparisonReturn();document.getElementById('trade-return-banner')?.scrollIntoView({block:'start'});});
}
function returnToTradeComparison(){
  const target=_tradeComparisonReturn;if(!target)return;
  _tradeComparisonReturn=null;renderTradeComparisonReturn();
  document.getElementById('app').style.display='none';
  document.getElementById('share-view').classList.add('active');
  renderShareView(target.username,target.type);
  requestAnimationFrame(()=>openTradeMatchModal(target.username));
}

// ── SAFE-TO-TRANSFER SEARCH STRING (v4.6.14) ─────────────────
// Generates a PoGo search string of every dex number that NONE of the
// selected trade partners have on their wishlist. Used for bag cleanup —
// paste the result into PoGo's bag search to see safe-to-transfer mons.
const SAFE_TRANSFER_DEFAULT_KEY='pogoSafeTransferDefault';
const SAFE_TRANSFER_PREFILTER_KEY='pogoSafeTransferPrefilter';
function safeTransferPreferenceKey(base){
  const uid=String(auth?.currentUser?.uid||'').trim();
  return uid?`${base}:${encodeURIComponent(uid)}`:null;
}
// Standard "you almost certainly don't want to transfer this" guards,
// applied in PoGo's bag search BEFORE the dex-number filter. Order of clauses
// doesn't matter — PoGo AND-combines them.
// - !favorite: explicit user keep-list
// - !4*: hundo IVs
// - !shiny / !shadow / !purified / !background: rare/event variants
// - !traded: lucky candidates
// - !legendary / !mythical: irreversible if mis-transferred
// - cp-2500: anything you've invested resources into
// Live selection (Set of usernames). Initialised in openSafeTransferModal()
// from saved default if available, else empty.
let _safeTransferSelected=null;
function _safeTransferAllTrainers(){
  // Everyone who has a non-empty wishlist (so selecting an inactive trainer
  // who never added anything wouldn't usefully constrain anything anyway).
  return Object.keys(allData.users||{})
    .filter(u=>Object.keys(allData.wishlist?.[u]||{}).length>0)
    .sort((a,b)=>(a===cur?-1:b===cur?1:0)||a.localeCompare(b,undefined,{sensitivity:'base'}));
}
function _loadSafeTransferDefault(){
  const key=safeTransferPreferenceKey(SAFE_TRANSFER_DEFAULT_KEY);
  if(!key)return null;
  const saved=lsGet(key,null);
  if(Array.isArray(saved))return new Set(saved.filter(u=>typeof u==='string'));
  return null;
}
function openSafeTransferModal(){
  // Initialise selection: saved default → fall back to "everyone except me"
  // so the very first interaction does something useful even with no save.
  if(!_safeTransferSelected){
    const def=_loadSafeTransferDefault();
    if(def&&def.size){
      _safeTransferSelected=def;
    }else{
      _safeTransferSelected=new Set(_safeTransferAllTrainers().filter(u=>u!==cur));
    }
  }
  // Prune anyone who's since become inactive / been removed.
  const active=new Set(_safeTransferAllTrainers());
  [..._safeTransferSelected].forEach(u=>{if(!active.has(u))_safeTransferSelected.delete(u);});
  openModal('safe-transfer-modal');
  // Seed prefilter checkbox from saved pref (default ON — safer for new users).
  const chk=document.getElementById('stb-prefilter-chk');
  if(chk){
    const key=safeTransferPreferenceKey(SAFE_TRANSFER_PREFILTER_KEY);
    const saved=key?lsGet(key,true):true;
    chk.checked=saved!==false;
  }
  renderSafeTransferTrainers();
  renderSafeTransferOutput();
}
function renderSafeTransferTrainers(){
  const grid=document.getElementById('stb-trainer-grid');
  if(!grid)return;
  const trainers=_safeTransferAllTrainers();
  if(!trainers.length){
    grid.innerHTML=`<div class="stb-empty">${escHtml(i18nCore.t('safeTransfer.noTrainers'))}</div>`;
    return;
  }
  grid.innerHTML=trainers.map(u=>{
    const isMe=u===cur;
    const on=_safeTransferSelected.has(u);
    const cls=`stb-trainer-chip${on?' on':''}${isMe?' is-me':''}`;
    const label=isMe?`${escHtml(u)} (${escHtml(i18nCore.t('common.you'))})`:escHtml(u);
    const title=isMe?i18nCore.t('safeTransfer.selfExcluded'):i18nCore.t('safeTransfer.toggleTrainer',{trainer:u});
    return`<button type="button" class="${cls}" data-safe-transfer-trainer="${escAttr(u)}" ${isMe?'disabled':''} title="${escAttr(title)}">${label}</button>`;
  }).join('');
}
document.getElementById('stb-trainer-grid')?.addEventListener('click',event=>{
  const control=event.target.closest('[data-safe-transfer-trainer]');if(control&&!control.disabled)toggleSafeTransferTrainer(control.dataset.safeTransferTrainer);
});
function toggleSafeTransferTrainer(name){
  if(!_safeTransferSelected)return;
  if(_safeTransferSelected.has(name))_safeTransferSelected.delete(name);
  else _safeTransferSelected.add(name);
  renderSafeTransferTrainers();
  renderSafeTransferOutput();
}
function setAllSafeTransferTrainers(all){
  if(!_safeTransferSelected)_safeTransferSelected=new Set();
  if(all){
    _safeTransferAllTrainers().forEach(u=>{if(u!==cur)_safeTransferSelected.add(u);});
  }else{
    _safeTransferSelected.clear();
  }
  renderSafeTransferTrainers();
  renderSafeTransferOutput();
}
function saveSafeTransferAsDefault(){
  if(!_safeTransferSelected){toast(i18nCore.t('safeTransfer.nothingToSave'));return;}
  const key=safeTransferPreferenceKey(SAFE_TRANSFER_DEFAULT_KEY);if(!key)return;
  lsSet(key,[..._safeTransferSelected]);
  toast(i18nCore.t('safeTransfer.defaultSaved',{count:i18nCore.formatNumber(_safeTransferSelected.size)}));
}
function toggleSafeTransferPrefilter(on){
  const key=safeTransferPreferenceKey(SAFE_TRANSFER_PREFILTER_KEY);if(key)lsSet(key,!!on);
  renderSafeTransferOutput();
}
function _safeTransferPrefilterEnabled(){
  const chk=document.getElementById('stb-prefilter-chk');
  const key=safeTransferPreferenceKey(SAFE_TRANSFER_PREFILTER_KEY);
  return chk?chk.checked:(!key||lsGet(key,true)!==false);
}
// Map every species the app knows about to its base dex number. We dedupe
// by dex so costume variants (which share dex with their base) only count
// once: protecting "Pikachu Party Hat" implicitly protects all dex-25.
function _safeTransferAllDex(){
  const seen=new Set();
  (DB.wishlist||[]).forEach(e=>{
    const n=parseInt(e.no);
    if(Number.isFinite(n)&&n>0)seen.add(n);
  });
  return [...seen].sort((a,b)=>a-b);
}
function computeSafeTransferString(){
  if(!_safeTransferSelected||!_safeTransferSelected.size){
    return{str:'',safeCount:0,wantedCount:0,totalDex:_safeTransferAllDex().length,picked:0};
  }
  // Build the "wanted" dex set from all selected trainers' wishlists.
  // Conservative — any wishlist entry, regardless of priority or flags, counts.
  const wantedDex=new Set();
  const wishSrcByName={};
  (DB.wishlist||[]).forEach(e=>{if(!wishSrcByName[e.name])wishSrcByName[e.name]=e;});
  _safeTransferSelected.forEach(u=>{
    const list=allData.wishlist?.[u]||{};
    Object.keys(list).forEach(name=>{
      const entry=wishSrcByName[name];
      const dex=parseInt(entry?.no);
      if(Number.isFinite(dex)&&dex>0)wantedDex.add(dex);
    });
  });
  const all=_safeTransferAllDex();
  const safe=all.filter(n=>!wantedDex.has(n));
  const dexStr=safe.join(',');
  const usePrefilter=_safeTransferPrefilterEnabled();
  const query=pokemonGoSearchSyntaxDomain.safeTransferQuery(safe);
  const str=safe.length?(usePrefilter?pokemonGoSearchSyntaxDomain.serializeQuery(query,pokemonGoSearchLocale()):dexStr):'';
  return{
    str,
    dexStr,
    prefilter:usePrefilter?pokemonGoSearchSyntaxDomain.queryPrefix(query,pokemonGoSearchLocale()):'',
    safeCount:safe.length,
    wantedCount:wantedDex.size,
    totalDex:all.length,
    picked:_safeTransferSelected.size
  };
}
function renderSafeTransferOutput(){
  const out=document.getElementById('stb-output');
  const summary=document.getElementById('stb-summary');
  const warnWrap=document.getElementById('stb-warn-wrap');
  const copyBtn=document.getElementById('stb-copy-btn');
  if(!out||!summary)return;
  const r=computeSafeTransferString();
  if(!r.picked){
    summary.innerHTML=`<span>${escHtml(i18nCore.t('safeTransfer.selectTrainer'))}</span>`;
    out.value='';
    warnWrap.innerHTML='';
    if(copyBtn)copyBtn.disabled=true;
    return;
  }
  out.value=r.str;
  const charCount=r.str.length;
  summary.innerHTML=`
    <span>${escHtml(i18nCore.t('safeTransfer.summary',{safe:i18nCore.formatNumber(r.safeCount),total:i18nCore.formatNumber(r.totalDex),wanted:i18nCore.formatNumber(r.wantedCount),trainers:i18nCore.formatNumber(r.picked)}))}</span>
    <span style="font-family:var(--mono);font-size:11px">${escHtml(i18nCore.t('safeTransfer.characters',{count:i18nCore.formatNumber(charCount)}))}</span>
  `;
  // Pokémon GO's bag search box accepts up to ~1000 chars before truncating
  // silently. Warn well before the cliff so trainers can chunk the output.
  if(charCount>=900){
    warnWrap.innerHTML=`<div class="stb-warn">${escHtml(i18nCore.t('safeTransfer.limitWarning',{count:i18nCore.formatNumber(charCount)}))}</div>`;
  }else if(charCount>=700){
    warnWrap.innerHTML=`<div class="stb-warn" style="background:rgba(108,99,255,.08);border-color:rgba(108,99,255,.25);color:var(--ac2)">${escHtml(i18nCore.t('safeTransfer.nearLimit',{count:i18nCore.formatNumber(charCount)}))}</div>`;
  }else{
    warnWrap.innerHTML='';
  }
  if(copyBtn)copyBtn.disabled=!r.str;
}
async function copySafeTransferString(){
  const out=document.getElementById('stb-output');
  if(!out||!out.value){toast(i18nCore.t('safeTransfer.nothingToCopy'));return;}
  try{
    await copyText(out.value);
    toast(i18nCore.t('safeTransfer.copied',{count:i18nCore.formatNumber(out.value.length)}));
  }catch{
    out.select();
    document.execCommand('copy');
    toast(i18nCore.t('safeTransfer.copiedFallback'));
  }
}
function renderDiffModal(){
  if(!_activeDiff)return;
  const{them,type}=_activeDiff;
  const diff=computeTrainerDiff(type,cur,them);
  const myCount=Object.keys(allData[type]?.[cur]||{}).length;
  const theirCount=Object.keys(allData[type]?.[them]||{}).length;
  const strongMatch=diff.both.filter(d=>d.mine.p===d.theirs.p&&d.mine.p).length;
  const totalBoth=diff.both.length;
  const themShort=String(them||'').slice(0,8);
  const availableDiffTypes=['wishlist','dynamax','gmax','costumes'].filter(t=>
    Object.keys(allData[t]?.[cur]||{}).length||Object.keys(allData[t]?.[them]||{}).length
  );
  const renderCard=(e,otherP)=>{
    const yours=e.p||'';
    const theirs=otherP||'';
    const isMatch=yours&&theirs&&yours===theirs;
    const isMismatch=yours&&theirs&&yours!==theirs;
    // Make it visually unambiguous WHOSE letter is whose when priorities differ.
    // Match → single combined badge with a ✓.
    // Mismatch → labeled pair: "You H · <trainer> M".
    // Only-one-side → simple single badge (no ambiguity).
    let priHtml='';
    if(isMatch){
      priHtml=`<span class="diff-prio-badge ${yours} match" title="Both at ${escAttr(priLabel(yours))}">${yours} <span class="diff-prio-check" aria-hidden="true">✓</span></span>`;
    }else if(isMismatch){
      priHtml=`<span class="diff-prio-pair" title="You: ${escAttr(priLabel(yours))} · ${escAttr(them)}: ${escAttr(priLabel(theirs))}">
        <span class="diff-prio-side"><span class="diff-prio-who you">You</span><span class="diff-prio-badge ${yours}">${yours}</span></span>
        <span class="diff-prio-vs">·</span>
        <span class="diff-prio-side"><span class="diff-prio-who them">${escHtml(themShort)}</span><span class="diff-prio-badge ${theirs}">${theirs}</span></span>
      </span>`;
    }else if(yours){
      priHtml=`<span class="diff-prio-badge ${yours}" title="You: ${escAttr(priLabel(yours))}">${yours}</span>`;
    }else if(theirs){
      priHtml=`<span class="diff-prio-badge ${theirs}" title="${escAttr(them)}: ${escAttr(priLabel(theirs))}">${theirs}</span>`;
    }
    const genderHtml=e.gender?`<span class="share-pcard-gender ${e.gender}" style="position:absolute;bottom:-2px;right:-2px">${e.gender==='f'?'♀':'♂'}</span>`:'';
    return`<div class="diff-card${isMismatch?' has-mismatch':''}${e.backgroundId?` background-visual-card ${backgroundVisualClass(e.backgroundId)}`:''}" ${e.backgroundId?backgroundVisualAttrs(e.backgroundId):''} title="${escAttr(e.dn)}">
      ${backgroundVisualMotifHtml(e.backgroundId)}
      <div class="diff-card-sprite-wrap">${e.no?spriteImg(e.no,26,'share-pcard-sprite',e.name,e.gender,e.dn):'🎮'}${genderHtml}</div>
      <div class="diff-card-info">
        <span class="diff-card-name">${escHtml(e.dn)}</span>
        ${priHtml?`<span class="diff-card-prio">${priHtml}</span>`:''}
        ${e.backgroundId?backgroundBadgeHtml(e.backgroundId,'share-pcard-flag background'):''}
      </div>
    </div>`;
  };
  const html=`<div class="diff-modal-overlay open" id="diff-modal" role="dialog" aria-modal="true" onclick="if(event.target===this)closeDiffModal()">
    <div class="diff-modal" onclick="event.stopPropagation()">
      <div class="diff-hdr">
        <div class="diff-hdr-title">⚖️ You ↔ <span style="color:var(--ac2)">${escHtml(them)}</span></div>
        <button class="diff-hdr-close" onclick="closeDiffModal()" aria-label="Close">×</button>
      </div>
      ${availableDiffTypes.length>1?`<div class="diff-tabs">
        ${availableDiffTypes.map(t=>{
          const myCount=Object.keys(allData[t]?.[cur]||{}).length;
          const theirCount=Object.keys(allData[t]?.[them]||{}).length;
          if(!myCount&&!theirCount)return'';
          return`<button class="ltab ${t===type?'active':''}" onclick="setDiffListType('${t}')">${LIST_LABELS[t]}</button>`;
        }).join('')}
      </div>`:''}
      <div class="diff-summary-row">
        <button class="diff-summary-chip diff-copy-chip both" type="button" onclick="copyDiffSearch('both',this)" aria-label="Copy both want search string" title="Copy both want search string">🤝 ${totalBoth} both want${strongMatch>0?` · ${strongMatch} priority match`:''}</button>
        <button class="diff-summary-chip diff-copy-chip mine" type="button" onclick="copyDiffSearch('mine',this)" aria-label="Copy only mine search string" title="Copy only mine search string">⬅ ${diff.onlyMine.length} only mine</button>
        <button class="diff-summary-chip diff-copy-chip theirs" type="button" onclick="copyDiffSearch('theirs',this)" aria-label="Copy only theirs search string" title="Copy only theirs search string">${diff.onlyTheirs.length} only theirs ➡</button>
      </div>
      <div class="diff-body">
        ${!myCount&&theirCount?`<div class="diff-tip"><strong>Your ${LIST_LABELS[type].toLowerCase()} list is empty.</strong> Add a few entries in My List first, then come back here and the compare view becomes much more useful.</div>`:''}
        ${diff.both.length?`<div class="diff-section">
          <div class="diff-section-hdr">Both want (${diff.both.length})</div>
          <div class="diff-grid">${diff.both.map(d=>renderCard(d.mine,d.theirs.p)).join('')}</div>
        </div>`:''}
        ${diff.onlyMine.length?`<div class="diff-section">
          <div class="diff-section-hdr">Only you want (${diff.onlyMine.length})</div>
          <div class="diff-grid">${diff.onlyMine.map(e=>renderCard(e)).join('')}</div>
        </div>`:''}
        ${diff.onlyTheirs.length?`<div class="diff-section">
          <div class="diff-section-hdr">Only ${escHtml(them)} wants (${diff.onlyTheirs.length})</div>
          <div class="diff-grid">${diff.onlyTheirs.map(e=>renderCard(e)).join('')}</div>
        </div>`:''}
        ${!diff.both.length&&!diff.onlyMine.length&&!diff.onlyTheirs.length?`<div class="diff-empty">No entries in this list for either trainer.</div>`:''}
      </div>
    </div>
  </div>`;
  // Replace existing modal if open, else append
  closeDiffModal();
  _activeDiff={them,type};
  const wrap=document.createElement('div');wrap.innerHTML=html;
  document.body.appendChild(wrap.firstElementChild);
}

// ── ACTIVITY SPARKLINE (#18) ──────────────────────────────────
// Uses lightweight activity log tracked per user. Built on top of writeList by
// recording add/remove events. Stored in localStorage (per device).
const ACTIVITY_LOG_KEY='pogoActivityLog_v1';
const ACTIVITY_LOG_MAX_USERS=200;
const ACTIVITY_LOG_MAX_EVENTS_PER_USER=500;
function loadActivityLog(){
  try{
    const value=JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY)||'{}');
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }catch{return{};}
}
function recordActivityEvent(username,delta){
  if(!username||!delta)return;
  const log=loadActivityLog();
  if(!log[username])log[username]=[];
  log[username].push({t:Date.now(),d:delta});
  const cutoff=Date.now()-60*86400000;
  log[username]=log[username]
    .filter(e=>Number.isFinite(Number(e?.t))&&Number(e.t)>=cutoff&&Number.isFinite(Number(e?.d)))
    .slice(-ACTIVITY_LOG_MAX_EVENTS_PER_USER);
  const retainedUsers=Object.entries(log)
    .filter(([,events])=>Array.isArray(events)&&events.length)
    .sort((a,b)=>Number(b[1].at(-1)?.t||0)-Number(a[1].at(-1)?.t||0))
    .slice(0,ACTIVITY_LOG_MAX_USERS);
  Object.keys(log).forEach(key=>delete log[key]);
  retainedUsers.forEach(([key,events])=>{log[key]=events;});
  try{localStorage.setItem(ACTIVITY_LOG_KEY,JSON.stringify(log));}catch{}
}
function buildSparkline(username,days=30){
  // Returns array of activity counts per day, oldest → newest
  const value=loadActivityLog()[username],log=Array.isArray(value)?value:[];
  const buckets=new Array(days).fill(0);
  const dayMs=86400000;
  const now=Date.now();
  log.forEach(e=>{
    const daysAgo=Math.floor((now-e.t)/dayMs);
    if(daysAgo>=0&&daysAgo<days)buckets[days-1-daysAgo]+=Math.abs(e.d);
  });
  return buckets;
}
function sparklineHtml(username){
  const buckets=buildSparkline(username,30);
  const total=buckets.reduce((a,b)=>a+b,0);
  // Empty sparkline used to render "— quiet" on every inactive trainer. With
  // a young community most rows hit this case and the repeated label is just
  // visual noise — render an empty span (title hint for screen readers / hover)
  // and let the layout naturally collapse instead.
  if(total===0)return'<span class="sparkline-empty" title="No tracked activity in the last 30 days" aria-label="No recent activity"></span>';
  const max=Math.max(...buckets,1);
  return `<span class="sparkline" title="${total} changes in last 30 days">
    ${buckets.map((v,i)=>{
      const h=Math.max(1,Math.round((v/max)*100));
      const recent=i>=22?' recent':'';
      return `<span class="sparkline-bar${recent}" style="height:${h}%"></span>`;
    }).join('')}
  </span>`;
}

// ── EVENT AWARENESS (#22) ─────────────────────────────────────
const SCRAPEDDUCK_BASE='https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/';
const EVENT_CACHE_KEY='pogoEventCache_v1';
const EVENT_CACHE_TTL=2*60*60*1000; // 2 hours
const EVENT_REQUEST_TIMEOUT_MS=15*1000;
let _eventData=null;
let _eventLoadState='idle';
let _eventRequestGeneration=0;
let _eventInflight=null;
function readCachedEventRecord(){
  try{
    const cached=JSON.parse(localStorage.getItem(EVENT_CACHE_KEY)||'null');
    const data=cached?.data;
    if(!cached||!Number.isFinite(cached.t)||!data||!Array.isArray(data.events)||!Array.isArray(data.raids))return null;
    return cached;
  }catch{return null;}
}
function eventRequestFailureKind(error,operation){
  if(operation.replaced)return'replaced';
  if(operation.deadlineExceeded)return'timeout';
  if(error?.name==='AbortError')return'aborted';
  if(error?.code==='events/http')return'http';
  if(error instanceof SyntaxError)return'parse';
  return'network';
}
async function fetchPogoEvents(force=false){
  if(_eventData&&!force)return _eventData;
  if(_eventInflight&&!force)return _eventInflight.promise;
  const generation=++_eventRequestGeneration;
  const previous=_eventInflight;
  if(force&&previous){previous.replaced=true;previous.controller.abort();}
  // Check localStorage cache
  if(!force){
    const cached=readCachedEventRecord();
    if(cached&&Date.now()-cached.t<EVENT_CACHE_TTL){_eventData=cached.data;_eventLoadState='ready';return _eventData;}
  }
  _eventLoadState='loading';
  const controller=new AbortController();
  const operation={generation,controller,deadlineExceeded:false,replaced:false,timer:null,promise:null};
  operation.timer=setTimeout(()=>{operation.deadlineExceeded=true;controller.abort();},EVENT_REQUEST_TIMEOUT_MS);
  const pending=(async()=>{try{
    const[eventsResp,raidsResp]=await Promise.all([
      fetch(`${SCRAPEDDUCK_BASE}events.min.json`,{signal:controller.signal}),
      fetch(`${SCRAPEDDUCK_BASE}raids.min.json`,{signal:controller.signal})
    ]);
    if(!eventsResp.ok){const error=new Error('Events source request failed');error.code='events/http';throw error;}
    const events=await eventsResp.json();
    const raids=raidsResp.ok?await raidsResp.json():[];
    const next={events,raids,fetchedAt:Date.now()};
    if(generation!==_eventRequestGeneration)return _eventData||next;
    _eventData=next;
    _eventLoadState='ready';
    try{localStorage.setItem(EVENT_CACHE_KEY,JSON.stringify({t:Date.now(),data:_eventData}));}catch{}
    return _eventData;
  }catch(e){
    if(generation!==_eventRequestGeneration)return _eventData||{events:[],raids:[],fetchedAt:0};
    operation.failureKind=eventRequestFailureKind(e,operation);
    const cached=readCachedEventRecord();
    if(cached){_eventData=cached.data;_eventLoadState='ready';return _eventData;}
    _eventLoadState=navigator.onLine===false?'offline':'error';
    _eventData={events:[],raids:[],fetchedAt:0};return _eventData;
  }finally{clearTimeout(operation.timer);}})();
  operation.promise=pending;
  _eventInflight=operation;
  try{return await pending;}finally{if(_eventInflight===operation)_eventInflight=null;}
}
function currentEvents(eventData){
  const now=Date.now();
  return(eventData?.events||[]).filter(e=>{
    const start=new Date(e.start||0).getTime();
    const end=new Date(e.end||0).getTime();
    return start<=now&&now<=end;
  });
}
function eventBadgeForPokemon(name,no,eventData){
  // Returns a small chip if this Pokemon is currently featured in a live event
  if(!eventData)return'';
  const norm=String(name||'').toLowerCase();
  const dn=String(name||'').toLowerCase();
  // Check current raids
  const raid=(eventData.raids||[]).find(r=>{
    const rn=String(r.name||'').toLowerCase();
    return rn===norm||rn===dn||rn.includes(norm)||norm.includes(rn);
  });
  if(raid){const label=i18nCore.t('events.filterRaids');return`<span class="event-pill raid" title="${escAttr(label)}${raid.tier?`: ${raid.tier}`:''}">⚔ ${escHtml(label)}</span>`;}
  // Check community day / spotlight events
  const events=currentEvents(eventData);
  for(const ev of events){
    const evType=String(ev.eventType||'').toLowerCase();
    const evName=String(ev.name||'').toLowerCase();
    const heading=String(ev.heading||'').toLowerCase();
    if(evName.includes(norm)||heading.includes(norm)){
      if(evType.includes('community')||evName.includes('community day')){const label=eventLabelsI18n.typeLabel('community_day',i18nCore.getLocale());return`<span class="event-pill cday" title="${escAttr(label)}">🌟 ${escHtml(label)}</span>`;}
      if(evType.includes('spotlight')||evName.includes('spotlight')){const label=eventLabelsI18n.typeLabel('spotlight_hour',i18nCore.getLocale());return`<span class="event-pill spotlight" title="${escAttr(label)}">⏰ ${escHtml(label)}</span>`;}
      const label=i18nCore.t('events.title');return`<span class="event-pill" title="${escAttr(label)}">🎉 ${escHtml(label)}</span>`;
    }
  }
  return'';
}
function renderEventBanner(){
  // Show the next upcoming/current notable event at top of Browse
  const slot=document.getElementById('event-banner-slot');
  if(!slot||!_eventData)return;
  const events=currentEvents(_eventData);
  const featured=events.find(e=>{
    const t=String(e.eventType||'').toLowerCase();
    return t.includes('community')||t.includes('spotlight')||t.includes('raid-day');
  })||events[0];
  if(!featured){slot.innerHTML='';return;}
  const endDate=new Date(featured.end);
  const daysLeft=Math.ceil((endDate-Date.now())/86400000);
  const localized=eventLabelsI18n.localizeEvent(featured,i18nCore.getLocale());
  const link=eventPresentationDomain.safeHttpsUrl(featured.link);
  slot.innerHTML=`<div class="event-banner">
    <span class="event-banner-icon">🎉</span>
    <div class="event-banner-content">
      <div class="event-banner-title">${escHtml(localized.localizedTitle||i18nCore.t('events.title'))}</div>
      <div class="event-banner-meta">${daysLeft>0?`${escHtml(i18nCore.formatRelativeTime(daysLeft,'day'))} · `:''}${escHtml(localized.localizedSummary)}${link?` · <a href="${escAttr(link)}" target="_blank" rel="noopener noreferrer" style="color:var(--ac2)">${escHtml(i18nCore.t('events.details'))} ↗</a>`:''}</div>
    </div>
  </div>`;
}

// Stable loading skeletons preserve the final row geometry.
function pokeballLoader(text=''){
  return`<div class="loader-wrap" role="status" aria-label="${escAttr(text||i18nCore.t('data.loading'))}">
    <div class="loader-skeleton" aria-hidden="true"><div class="skel skel-row"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></div>
    ${text?`<div class="loader-text">${escHtml(text)}</div>`:''}
  </div>`;
}

// ── WALLPAPER (#32) ───────────────────────────────────────────
const WALLPAPERS=[
  {key:'mono',label:'Default'},
  {key:'aurora',label:'Aurora'},
  {key:'ocean',label:'Ocean'},
  {key:'forest',label:'Forest'},
  {key:'sunset',label:'Sunset'},
  {key:'mist',label:'Mist'}
];
function applyWallpaper(key){
  document.body.classList.forEach(c=>{if(c.startsWith('wp-'))document.body.classList.remove(c);});
  document.body.classList.add(`wp-${key||'mono'}`);
}
function effectiveTheme(theme=lsGet('pogoTheme','auto')){return theme==='auto'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):theme;}
function applyWallpaperForTheme(key){applyWallpaper(effectiveTheme()==='dark'?key:'mono');}
function selectWallpaper(key){
  if(effectiveTheme()!=='dark')return;
  applyWallpaper(key);
  document.querySelectorAll('.wp-swatch').forEach(s=>{const selected=s.dataset.key===key;s.classList.toggle('selected',selected);s.setAttribute('aria-pressed',String(selected));});
  const hidden=document.getElementById('prof-wallpaper');
  if(hidden)hidden.value=key;
}
function wallpaperPickerHtml(current){
  return WALLPAPERS.map(w=>{const label=i18nCore.t(`settings.wallpaper.${w.key}`);const selected=w.key===(current||'mono');return`<button type="button" class="wp-swatch ${w.key} ${selected?'selected':''}" data-key="${w.key}" onclick="selectWallpaper('${w.key}')" aria-pressed="${selected}" aria-label="${escHtml(label)}" title="${escHtml(label)}">${escHtml(label)}</button>`;}).join('');
}

// ── ADD ALL VARIANTS (Vivillon, Unown, Furfrou, etc.) ────────
// Detect Pokémon families with multiple variants and offer "Add all" shortcut
const VARIANT_FAMILIES={
  'vivillon':{label:'Vivillon',dex:666},
  'unown':{label:'Unown',dex:201},
  'furfrou':{label:'Furfrou',dex:676},
  'spinda':{label:'Spinda',dex:327},
  'rotom':{label:'Rotom',dex:479},
  'tatsugiri':{label:'Tatsugiri',dex:978},
  'oricorio':{label:'Oricorio',dex:741},
  'flabebe':{label:'Flabébé',dex:669},
  'castform':{label:'Castform',dex:351},
  'burmy':{label:'Burmy',dex:412},
  'wormadam':{label:'Wormadam',dex:413},
  'deerling':{label:'Deerling',dex:585},
  'sawsbuck':{label:'Sawsbuck',dex:586},
  'shellos':{label:'Shellos',dex:422},
  'gastrodon':{label:'Gastrodon',dex:423},
  'pumpkaboo':{label:'Pumpkaboo',dex:710},
  'tauros':{label:'Tauros (Paldean)',dex:128,namePrefix:'P-'},
  'basculin':{label:'Basculin',dex:550},
  'squawkabilly':{label:'Squawkabilly',dex:931},
  'cherrim':{label:'Cherrim',dex:421},
  'wishiwashi':{label:'Wishiwashi',dex:746},
  'toxtricity':{label:'Toxtricity',dex:849}
};
function detectVariantFamily(query){
  const q=String(query||'').toLowerCase().trim();
  if(q.length<3)return null;
  // Match family keyword in query
  for(const[key,info]of Object.entries(VARIANT_FAMILIES)){
    if(q.includes(key))return{key,...info};
  }
  return null;
}
function familyVariantEntries(familyKey){
  // Find all entries in our data that belong to this family
  const info=VARIANT_FAMILIES[familyKey];
  if(!info)return[];
  const all=listSource(myListType);
  const seen=new Set();
  const matches=[];
  all.forEach(e=>{
    if(seen.has(e.name))return;
    const fname=String(e.name||'').toLowerCase();
    const fdn=String(e.displayName||'').toLowerCase();
    // Must be in this family by dex OR by name prefix
    const dexMatch=info.dex&&parseInt(e.no)===info.dex;
    const nameMatch=fname.includes(familyKey)||fdn.includes(familyKey);
    if(dexMatch||nameMatch){
      seen.add(e.name);
      matches.push(e);
    }
  });
  return matches;
}
function openAddAllVariantsModal(familyKey){
  const info=VARIANT_FAMILIES[familyKey];
  const variants=familyVariantEntries(familyKey);
  if(!variants.length){toast(i18nCore.t('myList.noVariants'));return;}
  // Build inline confirmation modal
  const existingList=allData[myListType]?.[cur]||{};
  const notYetAdded=variants.filter(v=>!existingList[v.name]);
  if(!notYetAdded.length){toast(i18nCore.t('myList.allVariantsListed',{count:i18nCore.formatNumber(variants.length),family:info.label}));return;}
  const modalHtml=`<div class="ov open" id="addall-modal" role="dialog" aria-modal="true">
    <div class="modal" style="max-width:440px">
      <h3>${escHtml(i18nCore.t('myList.addAllVariantsTitle',{family:info.label}))}</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px">
        ${escHtml(i18nCore.t('myList.variantsWillAdd',{count:i18nCore.formatNumber(notYetAdded.length),list:listLabel(myListType)}))}
        ${variants.length>notYetAdded.length?`<br><span style="font-size:11px">${escHtml(i18nCore.t('myList.alreadyAddedCount',{count:i18nCore.formatNumber(variants.length-notYetAdded.length)}))}</span>`:''}
      </p>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:8px;max-height:200px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px">
        ${notYetAdded.map(v=>`<span style="font-size:11px;background:var(--bg2);padding:3px 7px;border-radius:var(--radius-sm);border:1px solid var(--border)">${escHtml(pokemonDisplayName(v))}</span>`).join('')}
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px">${escHtml(i18nCore.t('myList.addAsPriority'))}</div>
      <div class="import-pri-row" id="addall-pri-row">
        <button class="import-pri-btn" data-pri="H" onclick="document.querySelectorAll('#addall-pri-row .import-pri-btn').forEach(b=>b.classList.remove('sel','H','M','L'));this.classList.add('sel','H')">H – High</button>
        <button class="import-pri-btn sel M" data-pri="M" onclick="document.querySelectorAll('#addall-pri-row .import-pri-btn').forEach(b=>b.classList.remove('sel','H','M','L'));this.classList.add('sel','M')">M – Medium</button>
        <button class="import-pri-btn" data-pri="L" onclick="document.querySelectorAll('#addall-pri-row .import-pri-btn').forEach(b=>b.classList.remove('sel','H','M','L'));this.classList.add('sel','L')">L – Low</button>
      </div>
      <div class="mact">
        <button class="bghost" onclick="closeAddAllVariants()">${escHtml(i18nCore.t('common.cancel'))}</button>
        <button class="bpri" onclick="confirmAddAllVariants('${familyKey}')">${escHtml(i18nCore.t('myList.addCount',{count:i18nCore.formatNumber(notYetAdded.length)}))}</button>
      </div>
    </div>
  </div>`;
  const wrap=document.createElement('div');wrap.innerHTML=modalHtml;
  document.body.appendChild(wrap.firstElementChild);
}
function closeAddAllVariants(){document.getElementById('addall-modal')?.remove();}
async function confirmAddAllVariants(familyKey){
  const sel=document.querySelector('#addall-pri-row .import-pri-btn.sel');
  const pri=sel?.dataset.pri||'M';
  const variants=familyVariantEntries(familyKey);
  const list={...(allData[myListType]?.[cur]||{})};
  let added=0;
  variants.forEach(v=>{
    if(list[v.name])return;
    list[v.name]=priValue(pri,'',false,false,false);
    added++;
  });
  if(!await writeList(myListType,cur,list))return;
  closeAddAllVariants();
  toast(i18nCore.t('myList.variantsAdded',{count:i18nCore.formatNumber(added),family:VARIANT_FAMILIES[familyKey].label,priority:priLabel(pri)}));
}
function currentAddFlags(){
  return{
    lucky:!!document.getElementById('add-pmon-lucky')?.checked,
    shiny:!!document.getElementById('add-pmon-shiny')?.checked,
    xxl:!!document.getElementById('add-pmon-xxl')?.checked,
    xxs:!!document.getElementById('add-pmon-xxs')?.checked,
    notes:(document.getElementById('add-pmon-notes')?.value||'').trim(),
    backgroundId:normalizeBackgroundId(document.getElementById('add-pmon-background')?.value)
  };
}
function openAddShownResultsModal(){
  const existingList=allData[myListType]?.[cur]||{};
  const shown=(acFiltered||[]).filter(v=>v?.name&&!existingList[v.name]);
  if(!shown.length){toast(i18nCore.t('myList.allShownListed'));return;}
  const pri=document.getElementById('add-pmon-pri')?.value||'M';
  const flags=currentAddFlags();
  const flagText=[
    flags.lucky?'⚡ Lucky':'',
    flags.shiny?'✨ Shiny':'',
    flags.xxl?'XXL':'',
    flags.xxs?'XXS':'',
    flags.notes?'notes':'',
    flags.backgroundId?`${backgroundShortLabel(flags.backgroundId)} BG`:''
  ].filter(Boolean).join(' · ');
  const modalHtml=`<div class="ov open" id="addshown-modal" role="dialog" aria-modal="true">
    <div class="modal" style="max-width:500px">
      <h3>${escHtml(i18nCore.t('myList.addShownTitle'))}</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px">
        ${escHtml(i18nCore.t('myList.shownWillAdd',{count:i18nCore.formatNumber(shown.length),list:listLabel(myListType)}))}
        ${flagText?`<br><span style="font-size:11px">${escHtml(i18nCore.t('myList.currentFlags',{flags:flagText}))}</span>`:''}
      </p>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-md);padding:8px;max-height:220px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:5px;margin-bottom:14px">
        ${shown.map(v=>`<span style="font-size:11px;background:var(--bg2);padding:5px 7px;border-radius:5px;border:1px solid var(--border);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.no?`#${v.no} `:''}${escHtml(v.dn||v.name)}</span>`).join('')}
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px">${escHtml(i18nCore.t('myList.addAsPriority'))}</div>
      <div class="import-pri-row" id="addshown-pri-row">
        <button class="import-pri-btn ${pri==='H'?'sel H':''}" data-pri="H" onclick="document.querySelectorAll('#addshown-pri-row .import-pri-btn').forEach(b=>b.classList.remove('sel','H','M','L'));this.classList.add('sel','H')">H – High</button>
        <button class="import-pri-btn ${pri==='M'||!pri?'sel M':''}" data-pri="M" onclick="document.querySelectorAll('#addshown-pri-row .import-pri-btn').forEach(b=>b.classList.remove('sel','H','M','L'));this.classList.add('sel','M')">M – Medium</button>
        <button class="import-pri-btn ${pri==='L'?'sel L':''}" data-pri="L" onclick="document.querySelectorAll('#addshown-pri-row .import-pri-btn').forEach(b=>b.classList.remove('sel','H','M','L'));this.classList.add('sel','L')">L – Low</button>
      </div>
      <div class="mact">
        <button class="bghost" onclick="closeAddShownResults()">${escHtml(i18nCore.t('common.cancel'))}</button>
        <button class="bpri" onclick="confirmAddShownResults()">${escHtml(i18nCore.t('myList.addCount',{count:i18nCore.formatNumber(shown.length)}))}</button>
      </div>
    </div>
  </div>`;
  const wrap=document.createElement('div');wrap.innerHTML=modalHtml;
  document.body.appendChild(wrap.firstElementChild);
}
function closeAddShownResults(){document.getElementById('addshown-modal')?.remove();}
async function confirmAddShownResults(){
  const existingList=allData[myListType]?.[cur]||{};
  const shown=(acFiltered||[]).filter(v=>v?.name&&!existingList[v.name]);
  if(!shown.length){closeAddShownResults();toast(i18nCore.t('myList.nothingNew'));return;}
  const sel=document.querySelector('#addshown-pri-row .import-pri-btn.sel');
  const pri=sel?.dataset.pri||document.getElementById('add-pmon-pri')?.value||'M';
  const flags=currentAddFlags();
  const list={...existingList};
  let added=0;
  shown.forEach(v=>{
    if(list[v.name])return;
    list[v.name]=priValue(pri,flags.notes,flags.lucky,flags.xxl,flags.xxs,flags.shiny,flags.backgroundId);
    added++;
  });
  if(!await writeList(myListType,cur,list))return;
  closeAddShownResults();
  closeAddAutocomplete();
  document.getElementById('ac-input').value='';
  document.getElementById('add-pmon-sel').value='';
  renderMyList();
  toast(i18nCore.t('myList.shownAdded',{count:i18nCore.formatNumber(added),priority:priName(pri)}));
}

// ── UPDATE CHECKER ───────────────────────────────────────────
// Polls the HTML's Last-Modified / ETag header every 5 minutes and on tab focus.
// When the deployed version is newer than the one currently loaded, shows a
// non-blocking banner prompting the user to refresh.
let _appVersion=null;
let _updateCheckTimer=null;
let _updateBannerShown=false;
const UPDATE_CHECK_INTERVAL=5*60*1000;

async function getAppVersion(){
  try{
    const url=`${location.pathname}?_v=${Date.now()}`;
    const ctrl=new AbortController();
    const timeout=setTimeout(()=>ctrl.abort(),4000);
    const res=await fetch(url,{method:'HEAD',cache:'no-store',signal:ctrl.signal});
    clearTimeout(timeout);
    return res.headers.get('Last-Modified')||res.headers.get('ETag')||null;
  }catch{return null;}
}
async function checkForUpdate(){
  if(_updateBannerShown)return;
  const v=await getAppVersion();
  if(!v)return;
  if(_appVersion===null){_appVersion=v;return;}
  if(v!==_appVersion){
    showUpdateBanner();
    _updateBannerShown=true;
    if(_updateCheckTimer){clearInterval(_updateCheckTimer);_updateCheckTimer=null;}
  }
}
function initUpdateCheck(){
  // Capture baseline version on startup
  getAppVersion().then(v=>{if(v)_appVersion=v;});
  if(_updateCheckTimer)clearInterval(_updateCheckTimer);
  _updateCheckTimer=setInterval(checkForUpdate,UPDATE_CHECK_INTERVAL);
}
function showUpdateBanner(){
  if(document.getElementById('update-banner'))return;
  const banner=document.createElement('div');
  banner.id='update-banner';
  banner.className='update-banner';
  banner.innerHTML=`
    <span class="update-banner-icon" aria-hidden="true">⬆️</span>
    <div class="update-banner-text">
      <strong>New version available</strong>
      <div class="update-banner-sub">Tap refresh to load the latest</div>
    </div>
    <button class="update-banner-btn" onclick="reloadForUpdate()">Refresh</button>
    <button class="update-banner-dismiss" onclick="document.getElementById('update-banner')?.remove()" aria-label="Dismiss">×</button>
  `;
  (document.getElementById('feedback-stack')||document.body).appendChild(banner);
  announceFeedback(banner.querySelector('strong')?.textContent);
}
function reloadForUpdate(){
  // Clear any localStorage-based image caches that might cause stale rendering
  try{location.reload();}catch{location.href=location.pathname;}
}

// ── PWA INSTALL PROMPT (#1) ──────────────────────────────────
let _deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  _deferredInstallPrompt=e;
  document.getElementById('install-btn')?.classList.add('show');
});
window.addEventListener('appinstalled',()=>{
  _deferredInstallPrompt=null;
  document.getElementById('install-btn')?.classList.remove('show');
  toast(i18nCore.t('install.installed'));
});
async function triggerInstall(){
  if(!_deferredInstallPrompt){toast(i18nCore.t('install.unavailable'));return;}
  _deferredInstallPrompt.prompt();
  const{outcome}=await _deferredInstallPrompt.userChoice;
  if(outcome==='accepted'){toast(i18nCore.t('install.installing'));}
  _deferredInstallPrompt=null;
  document.getElementById('install-btn')?.classList.remove('show');
}

// ── WHAT'S NEW (#28) ─────────────────────────────────────────
const WHATS_NEW=[
  {version:'4.6.31',title:'📅 Schedule outside-app trades',desc:'Schedule can now reserve regular, special, or remote trades with someone who is not on the app, so your daily counters stay accurate.'},
  {version:'4.6.27',title:'🤝 Trade match in Inventory',desc:'Trade Match now lives in Inventory → Browse community beside each trainer, where their posted inventory is already in context.'},
  {version:'4.6.26',notify:false,title:'🤝 Trade match view',desc:'Trade Match shows what they have that you want, what you have that they want, and possible mirrors.'},
  {version:'4.6.25',notify:false,title:'Small reliability cleanup',desc:'Mobile username suggestions are more reliable, Health Check is clearer, and string import copy now explains the dex-only format without ringing the update bell.'},
  {version:'4.6.18',title:'🚫 Untradeable Mythicals out of the trade list',desc:'Mythicals that can\'t actually be traded in PoGo no longer appear in the trade dropdown. Meltan / Melmetal / Gimmighoul still do.'},
  {version:'4.6.15',title:'🎯 Sprite rework — size & alignment',desc:'Inventory and Browse sprites now scale and center cleanly even for small-bodied species like Cleffa, Igglybuff, Mime Jr.'},
  {version:'4.6.14',title:'🗑️ "Safe-to-transfer" search string',desc:'Strings tab → generate a PoGo bag-search string for every species nobody on your chosen trade-partner list wants. Auto-filters favorites, shinies, hundos, shadows, and events.'},
  {version:'4.6.6',title:'↩️ Cancelling a trade restores both inventories',desc:'When you ✗ cancel a reserved trade, your Pokémon return immediately. The other trainer\'s side restores on their next sync.'},
  {version:'4.6.4',title:'🎒 Inventory tab rename',desc:'The old Have tab is now Inventory. Keyboard shortcut works as both `i` and `h`. Posting a public offer also no longer silently fails when the browser blocks the clipboard.'},
  {version:'4.6.3',title:'⚖️ Clearer priority mismatches in Compare mode',desc:'Badges now label whose H/M/L is whose ("You H · AC53 M"). Matching priorities show a ✓.'},
  {version:'4.6.0',title:'📱 Cross-device "What\'s New" sync',desc:'Read the changelog on desktop, your phone won\'t re-prompt.'},
  {version:'4.5.2',title:'📵 "Edits not syncing" banner',desc:'When your sign-in quietly expires, an amber banner explains and offers one-tap re-sign-in.'},
  {version:'4.5',title:'⚡ Speed-add mode',desc:'My List toggle so priority and flags stay selected while you add a big batch of Pokémon.'},
  {version:'4.4',title:'🩺 Login health check',desc:'"Having trouble signing in?" link on the login screen runs diagnostics and tells you what\'s wrong.'},
  {version:'4.3',title:'🎯 Special Trade Board (image export)',desc:'Build a Looking-For / For-Trade board with shiny + mirror toggles, export as a clean image ready for Discord.'},
  {version:'4.2',title:'🌟 Every legendary + multi-form Pokémon',desc:'Mewtwo, Mew, all Ultra Beasts, Galar/Hisui/Paldea legendaries, and Paradox Pokémon. Multi-form Pokémon each get their own entry.'},
  {version:'4.1',title:'♂ ♀ Track Pokémon by gender',desc:'Keep separate ♂ / ♀ rows for species where gender matters (Heracross, Nidoran, etc.).'},
  {version:'4.0',title:'✨ Shiny flag, offline mode, shortcuts, welcome tour',desc:'New ✨ Shiny flag. App works offline once loaded. Press ? for keyboard shortcuts. New users get a quick tour.'},
  {version:'3.6',title:'🔓 Stay signed in',desc:'Sessions now last 30 days and refresh every time you use the app. No more re-entering your PIN every time you open the app.'},
  {version:'3.5',title:'🌙 New "Dark Cards" image export style',desc:'Image exports come in two styles now — Classic (light) and Dark Cards. Both have cleaner, more consistent sprite quality.'},
  {version:'3.4',title:'☑ Bulk inventory edits',desc:'Select multiple inventory entries to change their return mode, bump quantities, or delete in one go.'},
  {version:'3.3',title:'🤝 + 📤 Two new inventory modes',desc:'Mark items as "Fair trade" (comparable rarity from your wishlist) or "Giveaway" (take it off my hands for anything reasonable).'},
  {version:'3.2',title:'🎒 Mirror-only inventory',desc:'Mark items as "Mirror only" when you only want the exact same Pokémon back. Browse and offer screens show this clearly.'},
  {version:'3.1',title:'📅 Edit scheduled trades',desc:'You can now edit a scheduled trade after creating it — switch between Regular / Special / Remote, change date/time, etc.'},
  {version:'3.0',title:'📅 Trade Schedule tab',desc:'New Schedule tab with a week-view calendar. Plan trades with specific trainers, track your daily quota, and see live Pokémon GO events.'},
  {version:'2.9',title:'🔔 Public offers (first-come-first-served)',desc:'Offers on inventory items are now public, so you can see who offered what and when. The first offer gets a green "1st" badge so everyone respects FCFS.'},
  {version:'2.8',title:'🎒 Inventory ("Have" tab)',desc:'Track what Pokémon you have to trade. Others can browse your inventory and offer trades. ⭐ Auto-highlights items that match your wishlist.'},
  {version:'2.7',title:'Updated Max lists',desc:'Dynamax list matches the current Pokémon GO roster, including Drilbur and Excadrill.'},
  {version:'2.6',title:'Compare two trainers',desc:'Tap the scale icon in Strings to compare your list against another trainer. See what you both want, only you want, or only they want.'},
  {version:'2.5',title:'Visual polish',desc:'Type colors, theme toggle, smoother animations, nicer empty states, "what\'s new" notifications.'},
  {version:'2.4',title:'Export & share',desc:'Export your list as Markdown (Discord/Reddit) or CSV. Send a read-only share link to anyone.'},
  {version:'2.3',title:'Mobile-first',desc:'Swipe to delete on My List. Pull to refresh. Cleaner mobile add form.'},
  {version:'2.2',title:'Trainer profiles',desc:'Custom Pokémon avatars, bios, Discord handles. Diff view shows what changed in someone\'s list since you last looked.'},
  {version:'2.1',title:'Bulk operations',desc:'Toggle bulk edit to select multiple entries and apply priority, flags, or delete in one go.'},
  {version:'2.0',title:'Flags & filters',desc:'Independent ⚡ Lucky / XXL / XXS flags with their own search strings. Filter Browse by any combination.'}
];
function whatsNewVisibleEntries(){
  const isAdmin=!!(cur&&allData.users?.[cur]?.isAdmin);
  return WHATS_NEW.filter(w=>!w.adminOnly||isAdmin);
}
function whatsNewNotifiableEntries(){
  return whatsNewVisibleEntries().filter(w=>w.notify!==false);
}
function whatsNewLatestVersion(){return whatsNewNotifiableEntries()[0]?.version||whatsNewVisibleEntries()[0]?.version||'1.0';}
// "Have I seen the latest changelog yet?" — used to live in localStorage, which
// meant the bell badge re-fired on every device (mobile would show it again
// even after you read it on desktop). Now we prefer the value stored on the
// user record (users/{cur}/whatsNewSeen), which syncs across devices via
// Firebase. localStorage stays as a fallback for unauthenticated/offline use
// and gets updated alongside the user record so we degrade gracefully.
function _maxSemver(a,b){
  const sa=String(a||''),sb=String(b||'');
  if(!sa)return sb;if(!sb)return sa;
  const pa=sa.split('.').map(n=>parseInt(n)||0);
  const pb=sb.split('.').map(n=>parseInt(n)||0);
  for(let i=0;i<Math.max(pa.length,pb.length);i++){
    const x=pa[i]||0,y=pb[i]||0;
    if(x>y)return sa;
    if(y>x)return sb;
  }
  return sa;
}
function getWhatsNewSeen(){
  // Take the HIGHER of (user-record value, localStorage value) so the badge
  // doesn't re-fire during the brief window between local mark-as-seen and
  // the Firebase echo, AND so cross-device "I saw it on desktop" propagates
  // correctly the moment Firebase syncs.
  return _maxSemver(allData.users?.[cur]?.whatsNewSeen||'',lsGet('pogoWhatsNewSeen','')||'');
}
function checkWhatsNew(){
  const seen=getWhatsNewSeen();
  const latest=whatsNewLatestVersion();
  const badge=document.getElementById('bell-badge');
  if(seen!==latest)badge?.classList.add('show');
  else badge?.classList.remove('show');
}
function openWhatsNew(){
  const list=document.getElementById('whatsnew-list');
  if(list){
    list.innerHTML=whatsNewVisibleEntries().map(w=>`<div class="whats-new-item">
      <div class="whats-new-version">v${w.version}</div>
      <div class="whats-new-title">${w.title}</div>
      <div class="whats-new-desc">${w.desc}</div>
    </div>`).join('');
  }
  openModal('whatsnew-modal');
  // Mark as seen — both locally (offline-safe) and in the user record (cross-device)
  const latest=whatsNewLatestVersion();
  lsSet('pogoWhatsNewSeen',latest);
  if(cur&&allData.users?.[cur]?.whatsNewSeen!==latest){
    writeUser(cur,{whatsNewSeen:latest}).catch(e=>console.warn('Could not sync whatsNewSeen',e));
  }
  document.getElementById('bell-badge')?.classList.remove('show');
}
function closeWhatsNew(){closeModal('whatsnew-modal');}

// ── PROFILE CUSTOMIZATION (#8) ───────────────────────────────
let avatarPickerEntriesCache=null,avatarPickerFocusIndex=-1,avatarPickerReturnFocus=null;
function avatarOptionEntries(){
  if(avatarPickerEntriesCache)return avatarPickerEntriesCache;
  avatarPickerEntriesCache=pokemonCatalogDomain.canonicalizeEntries(uniqueEntries(DB.wishlist,DB.dynamax,DB.gmax,allCostumeEntries(),LEGENDARY_AVATAR_ENTRIES))
    .filter(entry=>entry?.no&&!entry.spriteLookupKeys?.some(isUnresolvedSpriteKey)&&spriteFallbackChain(entry.no,entry.name,'',entry.displayName||entry.name,entry.catalogId).length)
    .map(entry=>({...entry,displayName:pokemonDisplayName(entry),search:normalizeAcText(pokemonSearchLabels(entry).join(' '))}))
    .sort((a,b)=>(parseInt(a.no)||9999)-(parseInt(b.no)||9999)||pokemonNamesI18n.compareDisplay(a,b,{locale:i18nCore.getLocale()}));
  return avatarPickerEntriesCache;
}
function avatarEntryForCatalogId(catalogId){return avatarOptionEntries().find(entry=>entry.catalogId===catalogId)||null;}
function avatarEntryForName(name){
  const norm=normalizeSpriteKey(name);
  if(!norm)return null;
  const resolved=pokemonCatalogDomain.resolveLegacyKey(name);
  const direct=avatarOptionEntries().find(e=>(resolved&&e.catalogId===resolved.catalogId)||normalizeSpriteKey(e.displayName)===norm||normalizeSpriteKey(e.name)===norm||(e.legacyAliases||[]).some(alias=>normalizeSpriteKey(alias)===norm));
  if(direct)return direct;
  const legacy=spriteSourceIndex().get(norm)||null;
  return legacy?pokemonCatalogDomain.decorateCatalogEntry(legacy):null;
}
function updateAvatarPreview(name){
  const prev=document.getElementById('prof-av-preview');
  const label=document.getElementById('prof-av-name'),clear=document.getElementById('prof-av-clear');
  if(!prev)return;
  if(!name||!name.trim()){
    prev.innerHTML=(cur||'?').slice(0,2).toUpperCase();
    if(label)label.textContent=i18nCore.t('avatar.choose');if(clear)clear.hidden=true;
    return;
  }
  // Look up Pokemon by name (case-insensitive)
  const found=avatarEntryForName(name);
  if(found?.no){
    const img=_avatarImgHtml(found.no,found.name,found.catalogId);
    if(img){prev.innerHTML=img;if(label)label.textContent=found.displayName||found.name;if(clear)clear.hidden=false;return;}
  }
  prev.innerHTML=(cur||'?').slice(0,2).toUpperCase();
  if(label)label.textContent=name;if(clear)clear.hidden=false;
}
function openAvatarPicker(){
  const dialog=document.getElementById('prof-av-dialog'),search=document.getElementById('prof-av-search');if(!dialog)return;
  avatarPickerReturnFocus=document.activeElement;dialog.hidden=false;renderAvatarPicker('');requestAnimationFrame(()=>search?.focus());
}
function closeAvatarPicker(){
  const dialog=document.getElementById('prof-av-dialog');if(dialog)dialog.hidden=true;
  avatarPickerReturnFocus?.focus?.();avatarPickerReturnFocus=null;avatarPickerFocusIndex=-1;
}
function renderAvatarPicker(query=''){
  const out=document.getElementById('prof-av-results');if(!out)return;
  const q=normalizeAcText(query),selected=document.getElementById('prof-av-input')?.value||'';
  const matches=avatarOptionEntries().filter(entry=>!q||entry.search.includes(q)).slice(0,q?48:24);
  avatarPickerFocusIndex=Math.min(Math.max(avatarPickerFocusIndex,0),Math.max(0,matches.length-1));
  out.innerHTML=matches.length?matches.map((entry,index)=>`<button type="button" class="profile-avatar-option${entry.name===selected?' selected':''}" role="option" aria-selected="${entry.name===selected}" data-catalog-id="${escAttr(entry.catalogId)}" onclick="selectAvatarOption(this.dataset.catalogId)" tabindex="${index===avatarPickerFocusIndex?'0':'-1'}"><span class="profile-avatar-option-sprite sprite-slot-profile">${spriteImg(entry.no,48,'avatar-picker-sprite',entry.name,'',entry.displayName,{catalogId:entry.catalogId,scaleCap:1.8})}</span><span>${escHtml(entry.displayName)}</span></button>`).join(''):`<p class="profile-avatar-empty">${escHtml(i18nCore.t('common.noResults'))}</p>`;
}
function avatarPickerKeydown(event){
  const options=[...document.querySelectorAll('#prof-av-results .profile-avatar-option')];if(!options.length)return;
  if(event.key==='Escape'){event.preventDefault();closeAvatarPicker();return;}
  if(!['ArrowDown','ArrowUp','Home','End','Enter'].includes(event.key))return;
  event.preventDefault();
  if(event.key==='Enter'){options[avatarPickerFocusIndex]?.click();return;}
  if(event.key==='Home')avatarPickerFocusIndex=0;else if(event.key==='End')avatarPickerFocusIndex=options.length-1;else avatarPickerFocusIndex=(avatarPickerFocusIndex+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
  options.forEach((option,index)=>option.tabIndex=index===avatarPickerFocusIndex?0:-1);options[avatarPickerFocusIndex]?.focus();
}
function selectAvatarOption(catalogId){
  const entry=avatarEntryForCatalogId(catalogId),input=document.getElementById('prof-av-input');if(!entry||!input)return;
  input.value=entry.name;updateAvatarPreview(entry.name);closeAvatarPicker();
}
function clearAvatarSelection(){
  const input=document.getElementById('prof-av-input');if(input)input.value='';updateAvatarPreview('');
}
// Build a <img> that uses the full sprite fallback chain — same cascade
// logic spriteImg() uses, but with avatar styling (no transform-scale, just
// object-fit:contain in a fixed box). Avatars previously hardcoded a single
// URL with no onerror handler, so any 404 (e.g. Wooloo / Sprigatito before
// v4.6.17 routed them to PokemonDB HOME) showed a broken-image icon.
function _avatarImgHtml(no,name,catalogId='',extraStyle=''){
  if(!no||!name)return'';
  return spriteImg(no,48,'avatar-sprite',name,'',name,{catalogId,scaleCap:1.8}).replace('style="','style="width:100%;height:100%;'+extraStyle);
}
function userAvatarHtml(username,size=28){
  const ud=allData.users?.[username]||{};
  const avPok=ud.avatarPokemon;
  if(avPok){
    const found=avatarEntryForName(avPok);
    if(found?.no){
      const img=_avatarImgHtml(found.no,found.name,found.catalogId);
      if(img)return `<div class="av" style="width:${size}px;height:${size}px;overflow:hidden;font-size:0">${img}</div>`;
    }
  }
  return `<div class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size*.35)}px">${username.slice(0,2).toUpperCase()}</div>`;
}

// ── DIFF VIEW (#17) ──────────────────────────────────────────
const DIFF_SNAPSHOT_KEY='pogoListSnapshots_v1';
const DIFF_SNAPSHOT_MAX_TRAINERS_PER_TYPE=100;
const DIFF_SNAPSHOT_MAX_LIST_ENTRIES=2000;
function loadSnapshots(){
  try{
    const value=JSON.parse(localStorage.getItem(DIFF_SNAPSHOT_KEY)||'{}');
    return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  }catch{return{};}
}
function snapshotViewerKey(){
  const uid=String(auth?.currentUser?.uid||'').trim(),username=String(cur||'').trim();
  return uid&&username?`${encodeURIComponent(uid)}:${encodeURIComponent(username)}`:null;
}
function viewerSnapshotBucket(snaps,create=false){
  const viewer=snapshotViewerKey();
  if(!viewer)return null;
  if(create){
    if(!snaps.viewers||typeof snaps.viewers!=='object'||Array.isArray(snaps.viewers))snaps.viewers={};
    if(!snaps.viewers[viewer]||typeof snaps.viewers[viewer]!=='object'||Array.isArray(snaps.viewers[viewer]))snaps.viewers[viewer]={};
    return snaps.viewers[viewer];
  }
  return snaps.viewers?.[viewer]||null;
}
function saveSnapshot(type,username,list){
  const entries=Object.entries(list||{});
  if(!username||entries.length>DIFF_SNAPSHOT_MAX_LIST_ENTRIES)return false;
  const snaps=loadSnapshots();
  const bucket=viewerSnapshotBucket(snaps,true);
  if(!bucket)return false;
  if(!bucket[type])bucket[type]={};
  bucket[type][username]={keys:entries.map(([key])=>key),values:Object.fromEntries(entries),savedAt:Date.now()};
  const retained=Object.entries(bucket[type])
    .sort((a,b)=>Number(b[1]?.savedAt||0)-Number(a[1]?.savedAt||0))
    .slice(0,DIFF_SNAPSHOT_MAX_TRAINERS_PER_TYPE);
  bucket[type]=Object.fromEntries(retained);
  try{localStorage.setItem(DIFF_SNAPSHOT_KEY,JSON.stringify(snaps));}catch{}
  return true;
}
function computeSnapshotDiff(type,username){
  const snaps=loadSnapshots();
  const bucket=viewerSnapshotBucket(snaps,false);
  const prev=bucket?.[type]?.[username];
  const cur=allData[type]?.[username]||{};
  if(!prev)return{firstVisit:true,added:[],removed:[],changed:[]};
  const prevSet=new Set(prev.keys||[]);
  const curSet=new Set(Object.keys(cur));
  const added=[...curSet].filter(k=>!prevSet.has(k));
  const removed=[...prevSet].filter(k=>!curSet.has(k));
  const changed=[...curSet].filter(k=>prevSet.has(k)&&prev.values?.[k]!==cur[k]);
  return{firstVisit:false,added,removed,changed,savedAt:prev.savedAt,prevValues:prev.values||{},curValues:{...cur}};
}
let stringDiffCacheSeq=0;
const stringDiffCache=new Map();
function resetStringDiffCache(){stringDiffCacheSeq=0;stringDiffCache.clear();}
function registerStringDiff(type,username,diff){
  const key=`sd${++stringDiffCacheSeq}`;
  stringDiffCache.set(key,{type,username,diff});
  return key;
}
function diffDisplayNames(type){
  const srcArr=listSource(type);
  const dn={};srcArr.forEach(e=>{dn[e.name]=pokemonDisplayName(e);});
  return dn;
}
function diffValueSummary(v){
  if(v===undefined||v===null||v==='')return'No priority';
  const{p,mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(v);
  const bits=[];
  bits.push(p?priName(p):'No priority');
  if(lucky)bits.push('Lucky');
  if(shiny)bits.push('Shiny');
  if(xxl)bits.push('XXL');
  if(xxs)bits.push('XXS');
  if(backgroundId)bits.push(`${backgroundDisplayName(backgroundId)} BG`);
  if(mod)bits.push(mod);
  return bits.join(' · ');
}
function diffLineHtml(kind,k,dn,diff){
  const name=escHtml(dn[k]||k);
  if(kind==='changed'){
    const before=diffValueSummary(diff.prevValues?.[k]);
    const after=diffValueSummary(diff.curValues?.[k]);
    return`<div class="diff-line changed">${name}<span class="diff-change-meta">${escHtml(before)} → ${escHtml(after)}</span></div>`;
  }
  return`<div class="diff-line ${kind}">${name}</div>`;
}
function diffDetailsHtml(diff,type,username){
  if(diff.firstVisit)return`<div class="diff-track-note">Tracking changes for ${escHtml(username)} from now on. Future edits will show added, removed, and changed entries here.</div>`;
  const total=diff.added.length+diff.removed.length+diff.changed.length;
  if(!total)return'';
  const dn=diffDisplayNames(type);
  const dt=diff.savedAt?new Date(diff.savedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'last visit';
  const lines=[];
  diff.added.slice(0,8).forEach(k=>lines.push(diffLineHtml('added',k,dn,diff)));
  diff.removed.slice(0,4).forEach(k=>lines.push(diffLineHtml('removed',k,dn,diff)));
  diff.changed.slice(0,4).forEach(k=>lines.push(diffLineHtml('changed',k,dn,diff)));
  const omitted=total-(Math.min(8,diff.added.length)+Math.min(4,diff.removed.length)+Math.min(4,diff.changed.length));
  const diffKey=omitted>0?registerStringDiff(type,username,diff):'';
  return `<div class="diff-summary">📊 Changes since ${dt}: <strong>+${diff.added.length} added · −${diff.removed.length} removed · ~${diff.changed.length} changed</strong>
    <div style="margin-top:6px">${lines.join('')}${omitted>0?`<div class="diff-line" style="color:var(--muted)">…and ${omitted} more</div><button type="button" class="diff-see-all" onclick="event.stopPropagation();openStringDiffDetails('${diffKey}')">See all changes</button>`:''}</div>
  </div>`;
}
function markSnapshotSeen(type,username){saveSnapshot(type,username,allData[type]?.[username]||{});}
function stringDiffSectionHtml(title,items,kind,dn,diff){
  if(!items.length)return'';
  return`<div class="diff-section">
    <div class="diff-section-hdr">${title} (${items.length})</div>
    <div class="string-diff-list">${items.map(k=>diffLineHtml(kind,k,dn,diff)).join('')}</div>
  </div>`;
}
function closeStringDiffDetails(){document.getElementById('string-diff-modal')?.remove();}
function openStringDiffDetails(key){
  const rec=stringDiffCache.get(key);
  if(!rec){toast('Changes were refreshed. Re-open this trainer to view them.');return;}
  const{type,username,diff}=rec;
  const dn=diffDisplayNames(type);
  const dt=diff.savedAt?new Date(diff.savedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'last visit';
  const total=diff.added.length+diff.removed.length+diff.changed.length;
  const html=`<div class="diff-modal-overlay open" id="string-diff-modal" role="dialog" aria-modal="true" onclick="if(event.target===this)closeStringDiffDetails()">
    <div class="diff-modal" onclick="event.stopPropagation()">
      <div class="diff-hdr">
        <div class="diff-hdr-title">📊 ${escHtml(username)} changes since ${escHtml(dt)}</div>
        <button class="diff-hdr-close" onclick="closeStringDiffDetails()" aria-label="Close">×</button>
      </div>
      <div class="diff-summary-row">
        <span class="diff-summary-chip both">+${diff.added.length} added</span>
        <span class="diff-summary-chip theirs">−${diff.removed.length} removed</span>
        <span class="diff-summary-chip mine">~${diff.changed.length} changed</span>
      </div>
      <div class="diff-body">
        ${total?[
          stringDiffSectionHtml('Added',diff.added,'added',dn,diff),
          stringDiffSectionHtml('Removed',diff.removed,'removed',dn,diff),
          stringDiffSectionHtml('Changed priority / flags',diff.changed,'changed',dn,diff)
        ].join(''):'<div class="diff-empty">No changes.</div>'}
      </div>
    </div>
  </div>`;
  closeStringDiffDetails();
  const wrap=document.createElement('div');wrap.innerHTML=html;
  document.body.appendChild(wrap.firstElementChild);
}

// ── EXPORT TO FORMATS (#10) ──────────────────────────────────
function toggleExportMenu(ev){
  ev?.stopPropagation();
  const menu=document.getElementById('export-menu');
  const btn=document.getElementById('export-menu-btn');
  const open=!menu.classList.contains('open');
  menu.classList.toggle('open',open);
  btn.setAttribute('aria-expanded',open?'true':'false');
  if(open){
    setTimeout(()=>document.addEventListener('click',_closeExportOnOutside),0);
    requestAnimationFrame(()=>menu.querySelector('[role^="menuitem"]')?.focus());
  }
}
function toolsMenuKeydown(event){
  const items=[...event.currentTarget.querySelectorAll('[role^="menuitem"]')],index=items.indexOf(document.activeElement);
  if(event.key==='Escape'){event.preventDefault();closeExportMenu();document.getElementById('export-menu-btn')?.focus();return;}
  if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
  event.preventDefault();const step=event.key==='ArrowDown'?1:-1;items[(index+step+items.length)%items.length]?.focus();
}
function _closeExportOnOutside(e){
  const wrap=document.querySelector('.export-menu-wrap');
  if(wrap&&!wrap.contains(e.target))closeExportMenu();
}
function closeExportMenu(){
  document.getElementById('export-menu')?.classList.remove('open');
  document.getElementById('export-menu-btn')?.setAttribute('aria-expanded','false');
  document.removeEventListener('click',_closeExportOnOutside);
}
function exportMyListMarkdown(){
  const entries=currentListEntries(myListType).filter(e=>e.p&&PRI[e.p]);
  if(!entries.length){toast(i18nCore.t('export.priorityRequired'));return;}
  const groups={H:[],M:[],L:[]};
  entries.forEach(e=>{if(groups[e.p])groups[e.p].push(e);});
  const ud=allData.users?.[cur]||{};
  let md=`## ${cur}'s ${listLabel(myListType)} List\n\n`;
  if(ud.friendCode)md+=`**Friend Code:** \`${ud.friendCode}\`\n`;
  if(ud.bio)md+=`*${ud.bio}*\n`;
  if(ud.discord)md+=`**Discord:** ${ud.discord}\n`;
  md+=`\n_${entries.length} entries · Updated ${new Date().toLocaleDateString()}_\n\n`;
  ['H','M','L'].forEach(p=>{
    if(!groups[p].length)return;
    md+=`### ${priLabel(p)} Priority (${groups[p].length})\n`;
    groups[p].forEach(e=>{
      const flags=[e.lucky?'⚡ Lucky':'',e.shiny?'✨ Shiny':'',e.xxl?'XXL':'',e.xxs?'XXS':'',e.backgroundId?`🖼 ${backgroundDisplayName(e.backgroundId)} BG`:''].filter(Boolean).join(' · ');
      md+=`- ${e.dn}${e.mod?` *(${e.mod})*`:''}${flags?` — ${flags}`:''}\n`;
    });
    md+='\n';
  });
  copyText(md).then(()=>toast(i18nCore.t('export.markdownCopied')));
}
function exportMyListCSV(){
  const entries=currentListEntries(myListType);
  if(!entries.length){toast(i18nCore.t('export.entriesRequired'));return;}
  const rows=[['Name','Dex','Priority','Lucky','Shiny','XXL','XXS','Background ID','Background','Notes']];
  entries.forEach(e=>{
    rows.push([e.dn,e.no||'',e.p||'',e.lucky?'Y':'',e.shiny?'Y':'',e.xxl?'Y':'',e.xxs?'Y':'',e.backgroundId||'',e.backgroundId?backgroundDisplayName(e.backgroundId):'',e.mod||'']);
  });
  const csv=rows.map(r=>r.map(c=>{
    const s=String(c||'');
    return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
  }).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`pogo-${safeFilePart(cur)}-${safeFilePart(listLabel(myListType))}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  toast(i18nCore.t('export.csvDownloaded'));
}
async function copyShareLink(){
  const url=`${location.origin}${location.pathname}?view=${encodeURIComponent(cur)}&list=${myListType}`;
  try{
    await copyText(url);
  }catch(e){
    console.warn('Could not copy share link',e);
    toast(i18nCore.t('export.shareCopyFailed'),6000);
    return;
  }
  toast(i18nCore.t('export.shareCopiedUpdating'),3500);
  publishPublicShareNow(cur,'explicit_share').then(result=>{
    if(result?.status==='published'){
      toast(i18nCore.t('share.publicationUpdated'),3500);
      inspectOwnPublicShareAfterHydration(activePublicShareHydrationToken);
    }
    else if(result?.status==='pending')toast(i18nCore.t('share.publicationPending'),6000);
    else toast(i18nCore.t('share.publicationNotReady'),6000);
  }).catch(e=>{
    console.warn('Could not publish public share snapshot',e);
    toast(i18nCore.t('export.shareCopiedPublishFailed'),7000);
  });
}

// ── SPECIAL TRADE BOARD ──────────────────────────────────────
// Manually-curated LF/FT board for one-off special trades. Persisted under
// the user record so it survives reloads + syncs to Firebase.
function getSpecialBoard(){
  const b=allData.users?.[cur]?.specialTradeBoard;
  return accountSyncClone({lf:Array.isArray(b?.lf)?b.lf:[],ft:Array.isArray(b?.ft)?b.ft:[]});
}
async function writeSpecialBoard(board){
  const session={uid:String(auth?.currentUser?.uid||''),username:cur};
  const authority=await accountSyncMutationAuthority();
  if(session.username!==cur||session.uid!==String(auth?.currentUser?.uid||''))return false;
  if(authority.mode==='blocked'){toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);return false;}
  if(authority.mode==='canonical'){
    const result=await writeAccountSyncSpecialBoard(board,{authority});
    if(!result?.ok||!accountSyncAuthorityCurrent(authority)){toast(i18nCore.t('storage.offlineRecoveryUnavailable'),5000);return false;}
    return true;
  }
  await writeUser(session.username,{specialTradeBoard:board});
  if(session.username!==cur||session.uid!==String(auth?.currentUser?.uid||''))return false;
  return true;
}
let _specialAcFocus={lf:-1,ft:-1};
function _specialAllItems(){
  // Reuse the wishlist autocomplete pool (now includes legendaries via listSource)
  const seen=new Set();const out=[];
  ['wishlist','dynamax','gmax','costumes'].forEach(t=>{
    listSource(t).forEach(e=>{
      const key=e?.catalogId||pokemonCatalogDomain.catalogKey(e?.name);
      if(!e?.name||seen.has(key))return;
      seen.add(key);
      const item={name:e.name,dn:pokemonDisplayName(e),canonicalDn:e.displayName||e.name,no:e.no||null,spriteUrl:entrySpriteUrl(e,e.name),catalogId:key,gender:['f','m'].includes(e.gender)?e.gender:'',legacyAliases:e.legacyAliases,searchAliases:e.searchAliases};
      item.search=normalizeAcText(pokemonSearchLabels(e).join(' '));
      out.push(item);
    });
  });
  return out;
}
let _specialAcItems=null;
function _ensureSpecialAcItems(){if(!_specialAcItems)_specialAcItems=_specialAllItems();return _specialAcItems;}
function _closeSpecialAc(side){
  const input=document.getElementById(`special-${side}-ac`),dd=document.getElementById(`special-${side}-dd`);
  _specialAcFocus[side]=-1;
  dd?.classList.remove('open');
  input?.setAttribute('aria-expanded','false');
  input?.removeAttribute('aria-activedescendant');
  dd?.querySelectorAll('[role="option"]').forEach(option=>option.setAttribute('aria-selected','false'));
}
function specialAcSearch(side,q){
  const input=document.getElementById(`special-${side}-ac`);
  document.getElementById(`special-${side}-sel`).value='';
  const dd=document.getElementById(`special-${side}-dd`);
  _specialAcFocus[side]=-1;
  input?.removeAttribute('aria-activedescendant');
  if(!q||q.length<1){dd.innerHTML='';dd.dataset.matches='[]';dd._specialMatches=[];_closeSpecialAc(side);return;}
  const items=_ensureSpecialAcItems();
  const filtered=rankAutocompleteItems(items,q,{alphaTieBreak:false});
  if(!filtered.length){dd.innerHTML=`<div class="ac-empty">${escHtml(i18nCore.t('common.noResults'))}</div>`;}
  else{
    dd.innerHTML=filtered.map((e,i)=>`
      <button type="button" class="ac-item" id="special-${side}-option-${i}" role="option" aria-selected="false" data-idx="${i}" onpointerdown="event.preventDefault();specialAcSelect('${side}',${i})">
        ${e.no||e.spriteUrl?spriteImg(e.no,28,'ac-item-sprite',e.name):''}
        <span class="ac-item-no">${e.no?`#${e.no}`:''}</span>
        <span class="ac-item-name">${escHtml(e.dn)}</span>
      </button>`).join('');
  }
  dd.dataset.matches=JSON.stringify(filtered.map(e=>e.name));
  dd._specialMatches=filtered;
  dd.classList.add('open');
  input?.setAttribute('aria-expanded','true');
}
function specialAcSelect(side,idx){
  const dd=document.getElementById(`special-${side}-dd`);
  const e=dd._specialMatches?.[idx];if(!e)return;
  const name=e.name;
  document.getElementById(`special-${side}-sel`).value=name;
  document.getElementById(`special-${side}-ac`).value=e?.dn||name;
  _closeSpecialAc(side);
}
function specialAcKeydown(ev,side){
  const dd=document.getElementById(`special-${side}-dd`);
  if(!dd.classList.contains('open'))return;
  const matches=dd._specialMatches||[];
  if(ev.key==='ArrowDown'){ev.preventDefault();_specialAcFocus[side]=Math.min((_specialAcFocus[side]??-1)+1,matches.length-1);_paintSpecialAcFocus(side);}
  else if(ev.key==='ArrowUp'){ev.preventDefault();const current=_specialAcFocus[side]??-1;_specialAcFocus[side]=current<0?matches.length-1:Math.max(current-1,0);_paintSpecialAcFocus(side);}
  else if(ev.key==='Enter'){
    ev.preventDefault();
    const i=_specialAcFocus[side]>=0?_specialAcFocus[side]:0;
    if(matches[i])specialAcSelect(side,i);
  }else if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();_closeSpecialAc(side);}
}
function _paintSpecialAcFocus(side){
  const input=document.getElementById(`special-${side}-ac`),dd=document.getElementById(`special-${side}-dd`);
  let active=null;
  [...dd.querySelectorAll('.ac-item')].forEach((el,i)=>{const selected=i===_specialAcFocus[side];el.classList.toggle('focused',selected);el.setAttribute('aria-selected',String(selected));if(selected)active=el;});
  if(active){input?.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}
  else input?.removeAttribute('aria-activedescendant');
}

function openSpecialTradeBoard(){
  openModal('special-board-modal');
  // Reset add-form state
  ['lf','ft'].forEach(s=>{
    document.getElementById(`special-${s}-ac`).value='';
    document.getElementById(`special-${s}-sel`).value='';
    _closeSpecialAc(s);
  });
  renderSpecialBoard();
}
function renderSpecialBoard(){
  const board=getSpecialBoard();
  ['lf','ft'].forEach(side=>{
    const el=document.getElementById(`special-${side}-list`);if(!el)return;
    el.innerHTML=board[side].map((e,i)=>{
      const sprHtml=spriteImg(e.no,24,'sb-row-sprite',e.name,'',e.dn||e.name,{catalogId:e.catalogId,scaleCap:1});
      const display=pokemonDisplayName({name:e.name,no:e.no,displayName:e.dn||e.name});
      const gender=['f','m'].includes(e.gender)?e.gender:'';
      const genderHtml=gender?`<span class="sb-row-gender ${gender==='f'?'is-female':'is-male'}" aria-label="${gender==='f'?'Female':'Male'}"><span aria-hidden="true">${gender==='f'?'♀︎':'♂︎'}</span></span>`:'';
      return`<div class="sb-row" data-idx="${i}">
        ${sprHtml}
        <span class="sb-row-name" title="${escAttr(display)}">${escHtml(display)}</span>
        ${genderHtml}
        <button class="sb-row-flag ${e.shiny?'on shiny':''}" onclick="toggleSpecialFlag('${side}',${i},'shiny')" title="✨ Shiny variant" aria-pressed="${!!e.shiny}">✨</button>
        <button class="sb-row-rm" onclick="removeSpecialEntry('${side}',${i})" title="Remove" aria-label="Remove">×</button>
      </div>`;
    }).join('');
  });
}
async function addSpecialEntry(side){
  const name=document.getElementById(`special-${side}-sel`).value;
  if(!name){toast(i18nCore.t('specialBoard.pickPokemon'));return;}
  const items=_ensureSpecialAcItems();
  const it=items.find(x=>x.name===name);if(!it){toast(i18nCore.t('specialBoard.notFound'));return;}
  const board=getSpecialBoard();
  // Keep one visual entry per Pokémon variation on each side.
  if(board[side].some(e=>e.name===name))toast(i18nCore.t('specialBoard.alreadyOnSide'));
  else{
    const entry={name:it.name,dn:it.canonicalDn||it.name,no:it.no||null,shiny:false,gender:['f','m'].includes(it.gender)?it.gender:''};
    board[side].push(entry);
    if(!await writeSpecialBoard(board))return;
  }
  document.getElementById(`special-${side}-ac`).value='';
  document.getElementById(`special-${side}-sel`).value='';
  document.getElementById(`special-${side}-dd`).classList.remove('open');
  renderSpecialBoard();
}
async function removeSpecialEntry(side,idx){
  const board=getSpecialBoard();
  board[side].splice(idx,1);
  if(!await writeSpecialBoard(board))return;
  renderSpecialBoard();
}
async function toggleSpecialFlag(side,idx,flag){
  const board=getSpecialBoard();
  const e=board[side][idx];if(!e)return;
  e[flag]=!e[flag];
  if(!await writeSpecialBoard(board))return;
  renderSpecialBoard();
}
async function clearSpecialBoard(){
  if(!confirm(i18nCore.t('specialBoard.clearConfirm')))return;
  if(!await writeSpecialBoard({lf:[],ft:[]}))return;
  renderSpecialBoard();
}

// ── QUICK-ADD BULK PICKER ────────────────────────────────────
// LF side: candidates = my wishlist (wishlist + dynamax + gmax + costumes),
// excluding entries already on the LF board.
// FT side: candidates = my Have inventory (per-gender rows), qty > 0,
// excluding entries already on the FT board.
let _qaSelected={lf:new Set(),ft:new Set()};
let _qaCandidatesCache={lf:null,ft:null};
function _buildQuickAddCandidates(side){
  const board=getSpecialBoard();
  const onBoard=new Set(board[side].map(e=>e.name));
  if(side==='lf'){
    // Wishlist union across list types
    const out=[];const seen=new Set();
    ['wishlist','dynamax','gmax','costumes'].forEach(t=>{
      const list=allData[t]?.[cur]||{};
      Object.entries(list).forEach(([name,value])=>{
        if(seen.has(name)||onBoard.has(name))return;
        seen.add(name);
        const sp=spriteEntryForListItem(t,name,{})||{};
        const items=_ensureSpecialAcItems();
        const ac=items.find(x=>x.name===name);
        const intent=parsePri(value);
        const gender=intent.gender||entryGender(intent.mod||'');
        if(ac)out.push({...ac,gender,shiny:intent.shiny});
        else if(sp.no)out.push({name,dn:pokemonDisplayName({...sp,name:sp.name||name,displayName:sp.displayName||name}),no:sp.no,spriteUrl:entrySpriteUrl(sp,name),gender,shiny:intent.shiny});
      });
    });
    out.sort((a,b)=>(parseInt(a.no)||9999)-(parseInt(b.no)||9999)||a.dn.localeCompare(b.dn));
    return out;
  }
  // FT side: inventory entries with qty > 0
  const inv=allData.have?.[cur]||{};
  const out=[];
  Object.entries(inv).forEach(([key,val])=>{
    const info=haveEntryInfo(val);
    if(info.qty<=0)return;
    const{name,gender}=splitHaveKey(key);
    if(onBoard.has(name))return; // dedupe by base name (board doesn't track gender separately)
    const e=_nameToSpriteEntry(name);
    out.push({name,dn:pokemonDisplayName({...e,name:e.name||name,displayName:e.displayName||name}),no:e.no||null,_qty:info.qty,gender,spriteUrl:entrySpriteUrl(e,name,gender),shiny:info.shiny});
  });
  // Sort: highest qty first, then by dex
  out.sort((a,b)=>(b._qty||0)-(a._qty||0)||(parseInt(a.no)||9999)-(parseInt(b.no)||9999));
  return out;
}
function openQuickAdd(side){
  const panel=document.getElementById(`special-${side}-quickadd`);if(!panel)return;
  // Close the autocomplete dropdown if it's open
  document.getElementById(`special-${side}-dd`)?.classList.remove('open');
  _qaSelected[side]=new Set();
  _qaCandidatesCache[side]=_buildQuickAddCandidates(side);
  const label=side==='lf'?'your wishlist':'your inventory';
  panel.innerHTML=`
    <div class="sb-quickadd-hdr">
      <span>From ${label} · <strong>${_qaCandidatesCache[side].length}</strong> available · <strong id="${side}-qa-count">0</strong> picked</span>
      <input type="text" class="sb-quickadd-filter" placeholder="Filter…" oninput="filterQuickAdd('${side}',this.value)">
      <button onclick="closeQuickAdd('${side}')" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:0 4px" aria-label="Close">×</button>
    </div>
    <div class="sb-quickadd-grid" id="${side}-qa-grid"></div>
    <div class="sb-quickadd-foot">
      <button class="sb-qa-select-all" onclick="qaSelectAll('${side}')">Select all (visible)</button>
      <div style="display:flex;gap:6px">
        <button onclick="closeQuickAdd('${side}')">Cancel</button>
        <button class="bpri" id="${side}-qa-commit" onclick="commitQuickAdd('${side}')" disabled>Add 0</button>
      </div>
    </div>`;
  panel.style.display='flex';
  renderQuickAddGrid(side,'');
}
function closeQuickAdd(side){
  const panel=document.getElementById(`special-${side}-quickadd`);
  if(panel){panel.style.display='none';panel.innerHTML='';}
  _qaSelected[side]=new Set();
  _qaCandidatesCache[side]=null;
}
function renderQuickAddGrid(side,filterStr){
  const grid=document.getElementById(`${side}-qa-grid`);if(!grid)return;
  const q=String(filterStr||'').toLowerCase().trim();
  const cands=(_qaCandidatesCache[side]||[]).filter(c=>!q||(c.dn||c.name).toLowerCase().includes(q)||String(c.no||'').includes(q));
  grid.innerHTML=cands.map(c=>{
    const sel=_qaSelected[side].has(c.name);
    const spr=c.spriteUrl||spriteUrl(c.no,c.name);
    return`<button type="button" class="sb-qa-chip ${sel?'sel':''}" data-name="${escAttr(c.name)}" onclick="toggleQuickAddPick('${side}','${escAttr(c.name)}')" title="${escAttr(c.dn||c.name)}">
      ${spr?`<img src="${escAttr(spr)}" alt="" loading="lazy">`:'<span style="font-size:22px">🎮</span>'}
      <span class="sb-qa-chip-name">${escHtml(c.dn||c.name)}</span>
    </button>`;
  }).join('');
}
function filterQuickAdd(side,v){renderQuickAddGrid(side,v);}
function toggleQuickAddPick(side,name){
  if(_qaSelected[side].has(name))_qaSelected[side].delete(name);
  else _qaSelected[side].add(name);
  const chip=document.querySelector(`#${side}-qa-grid .sb-qa-chip[data-name="${name.replace(/"/g,'\\"')}"]`);
  if(chip)chip.classList.toggle('sel',_qaSelected[side].has(name));
  _updateQuickAddCount(side);
}
function qaSelectAll(side){
  const grid=document.getElementById(`${side}-qa-grid`);if(!grid)return;
  // Toggle all visible: if all visible are already selected, deselect them; else select them
  const visibleNames=[...grid.querySelectorAll('.sb-qa-chip')].map(c=>c.dataset.name);
  const allSel=visibleNames.length&&visibleNames.every(n=>_qaSelected[side].has(n));
  visibleNames.forEach(n=>{
    if(allSel)_qaSelected[side].delete(n);
    else _qaSelected[side].add(n);
  });
  renderQuickAddGrid(side,document.querySelector(`#special-${side}-quickadd .sb-quickadd-filter`)?.value||'');
  _updateQuickAddCount(side);
}
function _updateQuickAddCount(side){
  const n=_qaSelected[side].size;
  const lbl=document.getElementById(`${side}-qa-count`);
  if(lbl)lbl.textContent=n;
  const btn=document.getElementById(`${side}-qa-commit`);
  if(btn){btn.disabled=n===0;btn.textContent=`Add ${n}`;}
}
async function commitQuickAdd(side){
  const picks=[..._qaSelected[side]];
  if(!picks.length){closeQuickAdd(side);return;}
  const items=_ensureSpecialAcItems();
  const cands=_qaCandidatesCache[side]||[];
  const board=getSpecialBoard();
  let added=0;
  picks.forEach(name=>{
    if(board[side].some(e=>e.name===name))return; // already on board
    const it=cands.find(c=>c.name===name)||items.find(x=>x.name===name);
    if(!it)return;
    board[side].push({
      name:it.name,dn:it.dn,no:it.no||null,
      shiny:!!it.shiny,gender:['f','m'].includes(it.gender)?it.gender:''
    });
    added++;
  });
  if(added){
    if(!await writeSpecialBoard(board))return;
    toast(`✅ Added ${added} to ${side.toUpperCase()}`);
  }
  closeQuickAdd(side);
  renderSpecialBoard();
}

// ── SPECIAL TRADE BOARD — IMAGE EXPORT ───────────────────────
async function exportSpecialBoardImage(){
  const board=getSpecialBoard();
  if(!board.lf.length&&!board.ft.length){toast(i18nCore.t('specialBoard.emptyExport'));return;}
  try{
    const blob=await renderSpecialBoardImage(board,cur);
    const filename=`pogo-${safeFilePart(cur)}-special-trade-${new Date().toISOString().slice(0,10)}.png`;
    const delivery=await deliverImageBlob(blob,filename,`${cur}'s Special Trade Board`);
    if(delivery==='cancelled')toast(i18nCore.t('export.cancelled'));
    else toast(i18nCore.t(delivery==='shared'?'specialBoard.ready':'specialBoard.exported'));
  }catch(e){console.error(e);toast(i18nCore.t('export.failed'));}
}
function ensureSpecialTradeBoardExportDomain(){
  if(specialTradeBoardExportDomain)return Promise.resolve(specialTradeBoardExportDomain);
  if(specialTradeBoardExportDomainPromise)return specialTradeBoardExportDomainPromise;
  specialTradeBoardExportDomainPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=`js/domain/specialTradeBoardExport.js?v=${encodeURIComponent(window.__POGO_RELEASE_ID||'')}`;
    script.async=false;
    script.addEventListener('load',()=>{
      specialTradeBoardExportDomain=window.PogoDomain?.specialTradeBoardExport||null;
      if(specialTradeBoardExportDomain)resolve(specialTradeBoardExportDomain);
      else reject(new Error('Special Trade Board export helpers failed to initialize'));
    },{once:true});
    script.addEventListener('error',()=>reject(new Error('Special Trade Board export helpers failed to load')),{once:true});
    document.head.appendChild(script);
  }).catch(error=>{specialTradeBoardExportDomainPromise=null;throw error;});
  return specialTradeBoardExportDomainPromise;
}
async function renderSpecialBoardImage(board,username){
  await ensureSpecialTradeBoardExportDomain();
  const sourceBoard={lf:Array.isArray(board?.lf)?board.lf:[],ft:Array.isArray(board?.ft)?board.ft:[]};
  const allEntries=[...sourceBoard.lf,...sourceBoard.ft];
  const boardEntryGender=e=>['f','m'].includes(e?.gender)?e.gender:entryGender(e?.mod||'');
  const boardEntryImageKey=e=>[e.catalogId||'',e.name,e.spriteName||'',e.dn||'',e.shiny?'s':'n',boardEntryGender(e)].join('|');
  const imgMap=new Map();
  await Promise.all(allEntries.map(async e=>{
    const urls=exportSpriteFallbackUrls({...e,spriteUrl:entrySpriteUrl(e,e.name)});
    const img=await loadCanvasImageWithFallback(urls);
    if(img)imgMap.set(boardEntryImageKey(e),img);
  }));
  const drawableBoard={
    lf:sourceBoard.lf.filter(entry=>imgMap.has(boardEntryImageKey(entry))),
    ft:sourceBoard.ft.filter(entry=>imgMap.has(boardEntryImageKey(entry)))
  };
  if(!drawableBoard.lf.length&&!drawableBoard.ft.length)throw new Error('No reviewed artwork is available for this board export');
  const layout=specialTradeBoardExportDomain.buildLayout(drawableBoard);
  const W=layout.width,pad=layout.padding,headerH=layout.headerHeight,footerH=layout.footerHeight;
  const gridCols=layout.columns,gridGap=layout.cardGap,gridCellH=layout.cardHeight,gridSprSize=48,sectionHdrH=layout.sectionHeaderHeight;
  const gridCellW=layout.cardWidth;
  const H=layout.height;
  const scale=2;
  const canvas=document.createElement('canvas');
  canvas.width=W*scale;canvas.height=H*scale;
  const ctx=canvas.getContext('2d');
  ctx.scale(scale,scale);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';

  // Background
  ctx.fillStyle='#0f1419';ctx.fillRect(0,0,W,H);

  // Compact product header.
  ctx.fillStyle='#171e29';ctx.fillRect(0,0,W,headerH);
  ctx.fillStyle='#6366f1';ctx.fillRect(0,headerH-2,W,2);
  drawFittedText(ctx,'Special Trade Board',pad,21,W-250,{max:18,min:14,color:'#ffffff'});
  ctx.font='650 9px Space Grotesk, sans-serif';ctx.fillStyle='rgba(255,255,255,.62)';
  ctx.fillText(String(username||''),pad,38);
  const date=new Date().toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  ctx.font='600 9px Space Grotesk, sans-serif';ctx.fillStyle='rgba(255,255,255,.5)';ctx.textAlign='right';
  ctx.fillText(`Generated ${date}`,W-pad,20);
  ctx.fillText(`${layout.entryCount} entries`,W-pad,37);
  ctx.textAlign='left';

  // ── Geometry-owned section and card rendering ───────────────
  const drawSectionHeader=(label,count,color,x,y,w)=>{
    roundedRect(ctx,x,y,w,sectionHdrH,5);ctx.fillStyle='#171e29';ctx.fill();
    roundedRect(ctx,x,y,4,sectionHdrH,2);ctx.fillStyle=color;ctx.fill();
    ctx.font='750 11px Space Grotesk, sans-serif';ctx.fillStyle='#f1f5f9';
    ctx.fillText(label,x+11,y+15);
    ctx.font='700 9px Space Grotesk, sans-serif';ctx.fillStyle='rgba(255,255,255,.52)';ctx.textAlign='right';
    ctx.fillText(String(count),x+w-10,y+15);ctx.textAlign='left';
  };
  const drawStarburst=(x,y,outerRadius,innerRadius,color)=>{
    ctx.beginPath();
    for(let point=0;point<8;point++){
      const angle=-Math.PI/2+point*Math.PI/4,radius=point%2?innerRadius:outerRadius;
      const px=x+Math.cos(angle)*radius,py=y+Math.sin(angle)*radius;
      if(point===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    ctx.closePath();ctx.fillStyle=color;ctx.fill();
  };
  const drawShinySparkles=(x,y)=>{
    ctx.save();
    drawStarburst(x,y,4.8,1.15,'#f8fafc');
    drawStarburst(x+6,y+2,2.4,.65,'#67e8f9');
    ctx.restore();
  };
  const drawGenderMarker=(gender,x,y)=>{
    const female=gender==='f',color=female?'#f472b6':'#60a5fa';
    ctx.save();
    roundedRect(ctx,x-7,y-7,14,14,4);ctx.fillStyle='rgba(15,20,25,.94)';ctx.fill();
    ctx.strokeStyle=color;ctx.lineWidth=.8;ctx.stroke();
    ctx.strokeStyle=color;ctx.lineWidth=1.3;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();
    if(female){
      ctx.arc(x,y-2.1,2.35,0,Math.PI*2);
      ctx.moveTo(x,y+.25);ctx.lineTo(x,y+4.8);
      ctx.moveTo(x-1.9,y+3.1);ctx.lineTo(x+1.9,y+3.1);
    }else{
      ctx.arc(x-1.35,y+1.35,2.35,0,Math.PI*2);
      ctx.moveTo(x+.35,y-.35);ctx.lineTo(x+4.35,y-4.35);
      ctx.moveTo(x+1.9,y-4.35);ctx.lineTo(x+4.35,y-4.35);ctx.lineTo(x+4.35,y-1.9);
    }
    ctx.stroke();
    ctx.restore();
  };
  const spriteMaskCache=new WeakMap();
  const spriteMask=(img,w)=>{
    if(spriteMaskCache.has(img))return spriteMaskCache.get(img);
    const canvas=document.createElement('canvas');
    canvas.width=Math.ceil(w);canvas.height=gridSprSize+8;
    const maskCtx=canvas.getContext('2d',{willReadFrequently:true});
    drawImageContain(maskCtx,img,(w-gridSprSize)/2,4,gridSprSize,gridSprSize);
    const mask={data:maskCtx.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height};
    spriteMaskCache.set(img,mask);
    return mask;
  };
  const markerRectHasSprite=(mask,left,top,right,bottom)=>{
    const minX=Math.max(0,Math.ceil(left)),maxX=Math.min(mask.width-1,Math.floor(right));
    const minY=Math.max(0,Math.ceil(top)),maxY=Math.min(mask.height-1,Math.floor(bottom));
    for(let py=minY;py<=maxY;py++)for(let px=minX;px<=maxX;px++)if(mask.data[(py*mask.width+px)*4+3]>10)return true;
    return false;
  };
  const shinyMarkerY=(img,w)=>{
    try{
      const mask=spriteMask(img,w),markerX=w-11;
      for(let markerY=7;markerY>=1;markerY--){
        const mainCollision=markerRectHasSprite(mask,markerX-4.8,markerY-4.8,markerX+4.8,markerY+4.8);
        const accentCollision=markerRectHasSprite(mask,markerX+3.6,markerY-.4,markerX+8.4,markerY+4.4);
        if(!mainCollision&&!accentCollision)return markerY;
      }
    }catch{}
    return 1;
  };
  const drawEntryMarkers=(entry,x,y,w,gender,img)=>{
    if(entry.shiny)drawShinySparkles(x+w-11,y+shinyMarkerY(img,w));
    if(gender==='f'||gender==='m')drawGenderMarker(gender,x+w/2,y+61);
  };
  const drawGridSection=(entries,xBase,startY)=>{
    entries.forEach((e,index)=>{
      const col=index%gridCols,row=Math.floor(index/gridCols);
      const cx=xBase+col*(gridCellW+gridGap),cy=startY+row*(gridCellH+gridGap);
      ctx.save();
      const gender=boardEntryGender(e);
      const sx=cx+(gridCellW-gridSprSize)/2,sy=cy+4,img=imgMap.get(boardEntryImageKey(e));
      drawImageContain(ctx,img,sx,sy,gridSprSize,gridSprSize);
      drawEntryMarkers(e,cx,cy,gridCellW,gender,img);
      ctx.restore();
    });
  };

  layout.sections.forEach(section=>{
    drawSectionHeader(section.label,section.count,section.accent,section.header.x,section.header.y,section.header.width);
    drawGridSection(drawableBoard[section.id],section.header.x,section.header.y+sectionHdrH+layout.sectionHeaderGap);
  });

  // Footer
  const footY=H-footerH;
  ctx.fillStyle='#0f1419';ctx.fillRect(0,footY,W,footerH);
  ctx.fillStyle='rgba(148,163,184,.18)';ctx.fillRect(pad,footY,W-pad*2,1);
  ctx.fillStyle='rgba(255,255,255,.38)';ctx.font='600 8px Space Grotesk, sans-serif';ctx.textAlign='right';
  ctx.fillText('PoGo Trades',W-pad,footY+12);
  ctx.textAlign='left';

  return new Promise(res=>canvas.toBlob(b=>res(b),'image/png'));
}

// ── READ-ONLY SHARE VIEW (#9) ────────────────────────────────
function checkShareViewParam(){
  const params=new URLSearchParams(location.search);
  const view=params.get('view');
  const list=params.get('list')||'wishlist';
  if(view)return{username:view,type:list};
  return null;
}
function resetNewTrainerProfileScroll(previousUsername,username){
  if(previousUsername===username)return false;
  window.scrollTo({top:0,left:0,behavior:'auto'});
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'auto'})));
  return true;
}
function enterShareLoadingShell(username,type='wishlist'){
  const previousUsername=_activeShareView?.username||'',startedAt=performance.now();
  if(document.getElementById('app')?.style.display!=='none')_shareReturnScroll={x:window.scrollX,y:window.scrollY};
  if(previousUsername!==username)clearShareViewSubscriptions();
  _pendingShareRequest={username,type};
  _activeShareView={username,type};
  hidePreAuth();
  document.getElementById('app').style.display='none';
  document.getElementById('login-pg').style.display='none';
  document.getElementById('config-pg').style.display='none';
  document.getElementById('share-view').classList.add('active');
  const hdr=document.getElementById('share-hdr');
  if(hdr)hdr.innerHTML=`<div class="share-loading-avatar" aria-hidden="true">${escHtml(String(username||'?').slice(0,2).toUpperCase())}</div><div class="share-hdr-info"><div class="share-hdr-name">${escHtml(i18nCore.t('share.listTitle',{username}))}</div><div class="share-hdr-meta"><span class="meta-item">${escHtml(i18nCore.t('trainer.profileLoading'))}</span></div></div>`;
  const tabs=document.getElementById('share-list-tabs');if(tabs)tabs.innerHTML='';
  const out=document.getElementById('share-list-out');if(out)out.innerHTML=stateHtml(stateModel('loading',{title:i18nCore.t('trainer.profileLoading'),detail:i18nCore.t('trainer.profileLoadingHelp')}));
  resetNewTrainerProfileScroll(previousUsername,username);
  window.__pogoTrainerProfileShellAt=performance.now();
  try{performance.measure('pogo:trainer-profile-shell',{start:startedAt,end:window.__pogoTrainerProfileShellAt});}catch{}
  return window.__pogoTrainerProfileShellAt-startedAt;
}
function enterShareView(username,type){
  const previousUsername=_activeShareView?.username||'';
  if(document.getElementById('app')?.style.display!=='none')_shareReturnScroll={x:window.scrollX,y:window.scrollY};
  if(_activeShareView?.username!==username)clearShareViewSubscriptions();
  _pendingShareRequest=null;
  document.getElementById('app').style.display='none';
  document.getElementById('login-pg').style.display='none';
  document.getElementById('config-pg').style.display='none';
  document.getElementById('share-view').classList.add('active');
  // Share view needs all list types to allow tab switching
  ensureShareViewSubscriptions(username);
  renderShareView(username,type);
  resetNewTrainerProfileScroll(previousUsername,username);
}
function exitShareView(){
  _publicShareRequestGeneration++;
  _pendingShareRequest=null;
  _activeShareView=null;
  clearShareViewSubscriptions();
  document.getElementById('share-view').classList.remove('active');
  history.replaceState({},'',location.pathname);
  // Re-init normal flow
  const s=checkSession();
  if(s&&allData.users?.[s]){cur=s;showApp();const restore=_shareReturnScroll;_shareReturnScroll=null;if(restore)requestAnimationFrame(()=>window.scrollTo({left:restore.x,top:restore.y,behavior:'auto'}));}
  else showLogin();
}
const PUBLIC_SHARE_LIST_KEYS=Object.freeze({wishlist:'list.wishlist',dynamax:'list.dynamax',gmax:'list.gigantamax',costumes:'list.others'});
const PUBLIC_SHARE_PRIORITY_KEYS=Object.freeze({H:'priority.high',M:'priority.medium',L:'priority.low'});
function publicShareListLabel(type){
  return i18nCore.t(PUBLIC_SHARE_LIST_KEYS[type]||'list.others');
}
function publicSharePriorityLabel(priority){
  return i18nCore.t(PUBLIC_SHARE_PRIORITY_KEYS[priority]||'priority.low');
}
function publicSharePriorityBadge(priority){
  const emoji=priority==='H'?'🔴':priority==='M'?'🟡':'🟢';
  return`${emoji} ${escHtml(publicSharePriorityLabel(priority))}`;
}
function publicShareUpdatedLabel(timestamp){
  const value=Number(timestamp);
  if(!Number.isFinite(value)||value<=0)return i18nCore.t('share.updatedNever');
  return i18nCore.t('share.updated',{time:i18nCore.relativeTimeFromTimestamp(value)});
}
function publicShareAction(event){
  const control=event.target.closest('[data-share-action]');if(!control)return;
  const username=control.dataset.username||_activeShareView?.username||'';
  if(control.dataset.shareAction==='favorite')toggleTrainerFavorite(username);
  else if(control.dataset.shareAction==='list')renderShareView(username,control.dataset.listType||'wishlist');
}
document.getElementById('share-hdr')?.addEventListener('click',publicShareAction);
document.getElementById('share-list-tabs')?.addEventListener('click',publicShareAction);
function renderShareView(username,type){
  _activeShareView={username,type};
  const ud=allData.users?.[username]||{};
  const list=allData[type]?.[username]||{};
  const favorite=ensureTrainerHistoryStore()?.isFavorite(username)||false;
  const hdr=document.getElementById('share-hdr');
  const bioHtml=ud.bio?`<div class="share-hdr-bio">"${escHtml(ud.bio)}"</div>`:'';
  const matchSummary=cur&&cur!==username?computeTradeMatchSummary(username):null;
  const hasVisibleMatches=!!(matchSummary&&(matchSummary.both.length||matchSummary.onlyMine.length||matchSummary.onlyTheirs.length));
  const matchOverview=hasVisibleMatches?`<div class="share-match-overview" aria-label="${escAttr(i18nCore.t('tradeMatch.detailsLabel'))}">${tradeMatchMetric(i18nCore.t('tradeMatch.bothWant'),matchSummary.both,matchSummary.availability.wants)}${tradeMatchMetric(i18nCore.t('tradeMatch.onlyIWant'),matchSummary.onlyMine,matchSummary.availability.wants)}${tradeMatchMetric(i18nCore.t('tradeMatch.onlyTheyWant',{trainer:username}),matchSummary.onlyTheirs,matchSummary.availability.wants)}</div>`:'';
  hdr.innerHTML=`${userAvatarHtml(username,64)}
    <div class="share-hdr-info">
      <div class="share-hdr-name">${escHtml(i18nCore.t('share.listTitle',{username}))}</div>
      ${matchOverview}
      <div class="share-hdr-meta">
        ${ud.friendCode?`<span class="meta-item">🎮 <code style="font-family:var(--mono);font-size:12px">${escHtml(ud.friendCode)}</code></span>`:''}
        ${ud.discord?`<span class="meta-item profile-discord">${escHtml(ud.discord)}</span>`:''}
        <span class="meta-item">📅 ${escHtml(publicShareUpdatedLabel(ud.lastUpdated))}</span>
      </div>
      ${cur&&cur!==username?`<div class="share-profile-actions"><button class="bpri" onclick="openActiveShareComparison()">${escHtml(i18nCore.t('trainer.compareAction'))}</button><button class="bghost" data-share-action="favorite" data-username="${escAttr(username)}" aria-pressed="${favorite}">${favorite?'★':'☆'} ${escHtml(i18nCore.t(favorite?'trainer.favoriteRemove':'trainer.favoriteAdd'))}</button></div>`:''}
      ${bioHtml}
    </div>`;
  // Tabs
  const tabs=document.getElementById('share-list-tabs');
  tabs.innerHTML=['wishlist','dynamax','gmax','costumes'].map(t=>{
    const count=Object.keys(allData[t]?.[username]||{}).length;
    if(!count)return'';
    const label=publicShareListLabel(t);
    return `<button class="ltab ${t===type?'active':''}" data-share-action="list" data-username="${escAttr(username)}" data-list-type="${t}">${escHtml(i18nCore.t('share.listTab',{label,count:i18nCore.formatNumber(count)}))}</button>`;
  }).join('');
  // Body — render in same style as user-str-block
  const out=document.getElementById('share-list-out');
  if(!Object.keys(list).length){
    out.innerHTML=emptyHtml(i18nCore.t('share.emptyTitle'),i18nCore.t('share.emptyHelp'),'📋');
    return;
  }
  const strs=buildStrings(type,username);
  // Build grouped visual + strings
  const srcArr=listSource(type);
  const dispMap={},noMap={};
  srcArr.forEach(e=>addPokemonEntryAliases(e,dispMap,noMap));
  const grouped={H:[],M:[],L:[],Other:[]};
  Object.entries(list).forEach(([name,val])=>{
    const{p,mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(val);
    const tag=(p&&grouped[p])?p:'Other';
    const gender=entryGender(mod);
    grouped[tag].push({name,dn:dispMap[name]||name,no:noMap[name]||'',p,mod,lucky,xxl,xxs,shiny,backgroundId,gender});
  });
  let html='';
  ['H','M','L'].forEach(p=>{
    if(!grouped[p].length)return;
    // Cluster by family (Vivillon, Unown, Furfrou variants stay together)
    const sorted=[...grouped[p]].sort(_familySort);
    html+=`<div class="share-section card-content">
      <div class="share-section-hdr">
        <span class="badge ${p}"><span class="prio-mark">${p}</span>${publicSharePriorityBadge(p)}</span>
        <span class="share-section-count">${escHtml(i18nCore.formatPlural('share.entryCount',sorted.length))}</span>
      </div>
      <div class="share-pgrid">${sorted.map(e=>{
        const flagsHtml=[
          e.gender==='f'?`<span class="share-pcard-flag gender-f" title="${escAttr(i18nCore.t('share.flagFemale'))}">♀</span>`:'',
          e.gender==='m'?`<span class="share-pcard-flag gender-m" title="${escAttr(i18nCore.t('share.flagMale'))}">♂</span>`:'',
          e.lucky?`<span class="share-pcard-flag lucky" title="${escAttr(i18nCore.t('share.flagLucky'))}">⚡</span>`:'',
          e.shiny?`<span class="share-pcard-flag shiny" title="${escAttr(i18nCore.t('share.flagShiny'))}" style="color:#f472b6">✨</span>`:'',
          e.xxl?`<span class="share-pcard-flag xxl" title="${escAttr(i18nCore.t('share.flagXxl'))}">XXL</span>`:'',
          e.xxs?`<span class="share-pcard-flag xxs" title="${escAttr(i18nCore.t('share.flagXxs'))}">XXS</span>`:''
          ,e.backgroundId?backgroundBadgeHtml(e.backgroundId,'share-pcard-flag background'):''
        ].filter(Boolean).join('');
        // Strip gender markers from mod display since we show ♂/♀ explicitly
        const modDisplay=String(e.mod||'').replace(/\b(female|male|f|m)\b/gi,'').replace(/\s+/g,' ').trim();
        const metaHtml=(modDisplay||flagsHtml)?`<div class="share-pcard-meta">${modDisplay?`<span class="share-pcard-mod">${escHtml(modDisplay)}</span>`:''}${flagsHtml}</div>`:'';
        // Use female sprite when applicable and cascade through approved sprite fallbacks.
        const spriteHtml=e.no
          ?`<div class="share-pcard-sprite-wrap">${spriteImg(e.no,26,'share-pcard-sprite',e.name,e.gender,e.dn)}${e.gender?`<span class="share-pcard-gender ${e.gender}">${e.gender==='f'?'♀':'♂'}</span>`:''}</div>`
          :'<div class="share-pcard-sprite" style="display:flex;align-items:center;justify-content:center;background:var(--bg2);border-radius:var(--radius-sm)">🎮</div>';
        return `<div class="share-pcard card-row${e.backgroundId?` background-visual-card ${backgroundVisualClass(e.backgroundId)}`:''}" ${e.backgroundId?backgroundVisualAttrs(e.backgroundId):''} title="${escAttr(e.dn)}">
          ${backgroundVisualMotifHtml(e.backgroundId)}
          ${spriteHtml}
          <div class="share-pcard-info">
            <span class="share-pcard-name">${escHtml(e.dn)}</span>
            ${metaHtml}
          </div>
        </div>`;
      }).join('')}</div>
    </div>`;
  });
  if(strs)html+=strLevelsHtml(strs,{t:i18nCore.t,formatNumber:i18nCore.formatNumber,priorityLabel:publicSharePriorityLabel,searchLocale:pokemonGoSearchLocale()});
  out.innerHTML=html;
}

// ── SWIPE GESTURES (#12) ─────────────────────────────────────
let _swipeState=null;
function attachSwipeHandlers(){
  if(!('ontouchstart'in window))return;
  const grid=document.getElementById('mylist-out');
  if(!grid||grid._swipeAttached)return;
  grid._swipeAttached=true;
  grid.addEventListener('touchstart',swipeStart,{passive:true});
  grid.addEventListener('touchmove',swipeMove,{passive:false});
  grid.addEventListener('touchend',swipeEnd,{passive:true});
}
function swipeStart(ev){
  const row=ev.target.closest('.myrow');
  if(!row||ev.target.closest('button,input,select,.drag-handle'))return;
  const t=ev.touches[0];
  _swipeState={row,startX:t.clientX,startY:t.clientY,dx:0,dy:0,vert:false};
}
function swipeMove(ev){
  if(!_swipeState)return;
  const t=ev.touches[0];
  _swipeState.dx=t.clientX-_swipeState.startX;
  _swipeState.dy=t.clientY-_swipeState.startY;
  if(!_swipeState.vert&&Math.abs(_swipeState.dy)>Math.abs(_swipeState.dx)+10){
    _swipeState.vert=true;_swipeState.row.style.transform='';
    return;
  }
  if(_swipeState.vert)return;
  if(Math.abs(_swipeState.dx)>10)ev.preventDefault();
  _swipeState.row.classList.add('swiping');
  _swipeState.row.style.transform=`translateX(${_swipeState.dx}px)`;
  _swipeState.row.classList.toggle('swipe-action',_swipeState.dx<-60);
  _swipeState.row.classList.toggle('swipe-action-select',_swipeState.dx>60);
}
function swipeEnd(ev){
  if(!_swipeState)return;
  const{row,dx,vert}=_swipeState;
  row.classList.remove('swiping','swipe-action','swipe-action-select');
  if(!vert&&dx<-80){
    // Swipe left = delete
    row.style.transform='translateX(-100%)';
    setTimeout(sessionTransientCallback(()=>{const n=row.dataset.name;if(!n||!confirmRemove(n,row.dataset.full||n))row.style.transform='';}),150);
  }else if(!vert&&dx>80){
    // Swipe right = toggle bulk select
    row.style.transform='';
    const n=row.dataset.name;
    if(n){
      if(!bulkMode)toggleBulkMode();
      toggleBulkSelection(n);
    }
  }else{
    row.style.transform='';
  }
  _swipeState=null;
}

// ── PULL TO REFRESH (#13) ────────────────────────────────────
let _ptrState=null;
function attachPullToRefresh(){
  if(!('ontouchstart'in window))return;
  document.addEventListener('touchstart',ptrStart,{passive:true});
  document.addEventListener('touchmove',ptrMove,{passive:false});
  document.addEventListener('touchend',ptrEnd,{passive:true});
}
function ptrStart(ev){
  if(window.scrollY>0)return;
  const t=ev.touches[0];
  _ptrState={startY:t.clientY,dy:0,active:false};
}
function ptrMove(ev){
  if(!_ptrState)return;
  const t=ev.touches[0];
  _ptrState.dy=t.clientY-_ptrState.startY;
  if(_ptrState.dy<10){return;}
  if(window.scrollY>0){_ptrState=null;return;}
  ev.preventDefault();
  _ptrState.active=true;
  const ind=document.getElementById('ptr-indicator');
  if(ind){
    ind.classList.add('visible');
    if(_ptrState.dy>70){ind.classList.add('pulling');ind.textContent='↑';}
    else{ind.classList.remove('pulling');ind.textContent='↓';}
  }
}
function ptrEnd(){
  if(!_ptrState||!_ptrState.active){_ptrState=null;return;}
  const ind=document.getElementById('ptr-indicator');
  if(_ptrState.dy>70){
    // Trigger refresh
    if(ind){ind.classList.add('refreshing');ind.innerHTML='<svg width="14" height="14" viewBox="0 0 14 14"><path d="M12 2v3h-3M2 12v-3h3M12 5a5 5 0 0 0-9-1m-1 5a5 5 0 0 0 9 1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';}
    syncFromLocal();
    if(fbOn&&db)flushSyncQueue();
    setTimeout(()=>{
      ind?.classList.remove('visible','pulling','refreshing');
      if(ind)ind.textContent='↓';
      toast('🔄 Refreshed');
    },800);
  }else{
    ind?.classList.remove('visible','pulling','refreshing');
  }
  _ptrState=null;
}

// ── EMPTY STATE SVGS (#25) ───────────────────────────────────

// ── LOADING SKELETONS (#26) ──────────────────────────────────
function skeletonRows(count=5,cls='skel-row'){return Array.from({length:count}).map(()=>`<div class="skel ${cls}"></div>`).join('');}
function showSkeletonMyList(){
  const el=document.getElementById('mylist-out');
  if(el&&!el.children.length)el.innerHTML=`<div class="mygrid">${skeletonRows(6)}</div>`;
}

// ── THEME TOGGLE (#18) ────────────────────────────────────────
function applyTheme(theme){
  if(theme==='auto'){document.documentElement.removeAttribute('data-theme');}
  else document.documentElement.setAttribute('data-theme',theme);
  const btn=document.getElementById('theme-toggle');
  if(btn){
    const effective=effectiveTheme(theme);
    btn.innerHTML=uiIconMarkup(effective==='dark'?'moon':'sun','ui-icon ui-icon-sm');
    btn.title=`Theme: ${theme} (click to cycle)`;
  }
  lsSet('pogoTheme',theme);
  applyWallpaperForTheme(allData?.users?.[cur]?.wallpaper||document.getElementById('prof-wallpaper')?.value||'mono');
  syncAppearanceControls();
}
function setSettingsTheme(theme){applyTheme(theme);}
function syncAppearanceControls(){
  const theme=lsGet('pogoTheme','auto'),effective=effectiveTheme(theme),wallpaper=allData?.users?.[cur]?.wallpaper||document.getElementById('prof-wallpaper')?.value||'mono';
  document.querySelectorAll('[data-settings-theme]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.settingsTheme===theme)));
  const hidden=document.getElementById('prof-wallpaper');if(hidden)hidden.value=wallpaper;
  const picker=document.getElementById('wp-picker');if(picker){picker.innerHTML=wallpaperPickerHtml(wallpaper);picker.querySelectorAll('button').forEach(button=>{button.disabled=effective!=='dark';button.setAttribute('aria-disabled',String(effective!=='dark'));});}
  const group=document.getElementById('settings-background-group');group?.classList.toggle('settings-background-inactive',effective!=='dark');group?.setAttribute('aria-disabled',String(effective!=='dark'));
  const status=document.getElementById('settings-background-status');if(status)status.textContent=effective==='dark'?'':i18nCore.t('settings.backgroundInactive');
}
function toggleTheme(){
  const cur=lsGet('pogoTheme','auto');
  const next=cur==='auto'?'light':cur==='light'?'dark':'auto';
  applyTheme(next);
}
function initTheme(){applyTheme(lsGet('pogoTheme','auto'));}

// ── POKEMON TYPE COLORS ───────────────────────────────────────
function applyTypeColorToElement(el){
  const dex=parseInt(el?.dataset.dex);if(!dex)return;
  const type=primaryTypeForDex(dex);
  if(type&&TYPE_COLORS[type])el.style.setProperty('--type-color',TYPE_COLORS[type]);
}
function applyTypeColors(root=document){
  root.querySelectorAll('.myrow[data-dex],.pgrid .pc[data-dex]').forEach(applyTypeColorToElement);
}

// ── TRADE SCHEDULE ──────────────────────────────────────────
// Compute special trade bonus from explicit event detail text for a given date.
// Returns {specialBonus, regularBonus, events: [{name, link, image, bonus, bonusText}]}
function dailyEventBonuses(isoD){
  const out={specialBonus:0,regularBonus:0,manualBonus:0,events:[]};
  if(!_eventData||!_eventData.events)return out;
  const dayStart=new Date(parseIsoDate(isoD));dayStart.setHours(0,0,0,0);
  const dayEnd=new Date(dayStart);dayEnd.setHours(23,59,59,999);
  _eventData.events.forEach(ev=>{
    const s=new Date(ev.start||0).getTime();
    const e=new Date(ev.end||0).getTime();
    if(!s||!e)return;
    if(e<dayStart.getTime()||s>dayEnd.getTime())return;
    const cls=classifyEvent(ev);
    const eventId=getEventId(ev);
    if(cls.bonus)out.specialBonus+=cls.bonus;
    out.events.push({
      name:ev.name,heading:ev.heading,link:ev.link,image:ev.image,
      bonus:cls.bonus,bonusType:cls.bonusType,bonusText:cls.bonusText,bonusKind:cls.bonusKind,
      ambiguous:cls.ambiguous,eventId,
      start:ev.start,end:ev.end
    });
  });
  // Apply user's manual special-trade bonus override for this date
  const customBonus=parseInt(allData.users?.[cur]?.customBonuses?.[isoD])||0;
  if(customBonus>0){out.specialBonus+=customBonus;out.manualBonus=customBonus;}
  return out;
}
async function setManualBonus(isoD,delta){
  const ud=allData.users?.[cur]||{};
  const customBonuses={...(ud.customBonuses||{})};
  const cur_val=parseInt(customBonuses[isoD])||0;
  const new_val=Math.max(0,Math.min(10,cur_val+delta));
  if(new_val===0)delete customBonuses[isoD];
  else customBonuses[isoD]=new_val;
  await writeUser(cur,{customBonuses});
  renderSchedule();
}
function tradesOnDate(isoD){
  const trades=allData.trades||{};
  return Object.entries(trades)
    .filter(([id,t])=>t&&t.date===isoD&&t.status!=='cancelled')
    .filter(([id,t])=>!t.participants||t.participants[cur]||t.organizer===cur)
    .map(([id,t])=>({id,...t}));
}
function scheduledTradeOtherUsers(t){
  const names=new Set(Object.keys(t?.participants||{}));
  if(t?.organizer)names.add(t.organizer);
  if(t?.counterparty)names.add(t.counterparty);
  names.delete(cur);
  return [...names].filter(Boolean);
}
function schedulePreviewAllowsTrade(t){
  const members=readScopeMemberUsernames();
  if(!members)return true;
  const scopedCommunityId=ownerCommunityPreviewOn()?ownerPreviewCommunityId():getCurrentCommunityId();
  if(recordCommunityId(t)!==scopedCommunityId)return false;
  return scheduledTradeOtherUsers(t).every(u=>members.has(u));
}
function visibleTradesOnDate(isoD){
  return tradesOnDate(isoD).filter(schedulePreviewAllowsTrade);
}
function tradeCountsForDay(isoD){
  return summarizeScheduledTrades(tradesOnDate(isoD));
}
function visibleTradeCountsForDay(isoD){
  return summarizeScheduledTrades(visibleTradesOnDate(isoD));
}

async function writeTrade(id,trade){
  const s=getLocal();
  if(!s.trades)s.trades={};
  if(trade===null){delete s.trades[id];}
  else s.trades[id]=trade;
  saveLocal(s);
  if(fbOn&&db)queueSync(`trades/${id}`,trade);
  syncFromLocal();
}

function navigateSchedWeek(dir){
  if(!schedAnchor)schedAnchor=startOfWeek(new Date());
  schedAnchor=addDays(schedAnchor,dir*7);
  renderSchedule();
}
function navigateSchedToday(){
  schedAnchor=startOfWeek(new Date());
  schedSelectedDate=todayIso();
  renderSchedule();
}
function selectSchedDay(isoD){
  schedSelectedDate=isoD;
  renderSchedule();
}

function setEventTypeFilter(type){
  eventTypeFilter=eventPresentationDomain.TYPES.includes(type)?type:'all';
  renderEventsOnly();
}
function eventFilterKeydown(event,type){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const buttons=[...document.querySelectorAll('.event-filter')],current=buttons.findIndex(button=>button.dataset.type===type);
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
  buttons[next]?.focus();buttons[next]?.click();
}
function openEventDetails(link){
  const safe=eventPresentationDomain.safeHttpsUrl(link);
  if(safe)window.open(safe,'_blank','noopener,noreferrer');
}
function eventTypeLabel(type){
  return i18nCore.t({spotlight:'events.filterSpotlight',raids:'events.filterRaids',max:'events.filterMax',gbl:'events.filterGbl',research:'events.filterResearch',general:'events.filterGeneral'}[type]||'events.filterGeneral');
}
function localizedEventTypeLabel(event){
  const source=String(event?.eventType||'');
  const localized=eventLabelsI18n.typeLabel(source,i18nCore.getLocale());
  return localized&&localized!==source?localized:eventTypeLabel(event?.uiType);
}
function localizedEventBonuses(event){
  if(!Array.isArray(event?.bonuses))return[];
  return event.bonuses.map(bonus=>{
    const label=eventLabelsI18n.bonusLabel(bonus?.kind||bonus?.type,i18nCore.getLocale());
    return label?`${label}${bonus?.value!==undefined?`: ${bonus.value}`:''}`:'';
  }).filter(Boolean);
}
function eventGroupLabel(group){
  return i18nCore.t({now:'events.groupNow',soon:'events.groupSoon',later:'events.groupLater'}[group]||'events.groupLater');
}
function eventRelativeLabel(timing){
  if(!timing?.relative)return'';
  if(timing.relative.kind==='starts'&&timing.dayOffset===0)return i18nCore.t('events.startsToday');
  if(timing.relative.kind==='starts'&&timing.dayOffset===1)return i18nCore.t('events.startsTomorrow');
  const relative=i18nCore.formatRelativeTime(timing.relative.value,timing.relative.unit,{numeric:'always'});
  return i18nCore.t(timing.relative.kind==='ends'?'events.endsRelative':'events.startsRelative',{time:relative});
}
function eventStateHtml(kind,title,detail='',actionLabel='',action=''){
  const state=stateHtml(stateModel(kind,{title,detail}));
  const actionButton=actionLabel&&action?`<button type="button" class="events-state-action btn btn-secondary" data-event-action="${escAttr(action)}">${escHtml(actionLabel)}</button>`:'';
  return`<div class="events-state">${state}${actionButton}</div>`;
}
function eventStableId(event){return eventLabelsI18n.eventId(event);}
function setEventCalendarDate(date){
  eventCalendarDate=eventCalendarDate===date?'':date;
  renderEventsOnly();
}
function moveEventCalendarMonth(delta){
  eventCalendarAnchor=new Date(eventCalendarAnchor.getFullYear(),eventCalendarAnchor.getMonth()+delta,1);
  eventCalendarDate='';
  renderEventsOnly();
}
function eventCalendarKeydown(event,dateKey){
  const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
  if(!(event.key in offsets)&&!['Home','End'].includes(event.key))return;
  event.preventDefault();
  const current=new Date(`${dateKey}T12:00:00`);
  const next=new Date(current);
  if(event.key==='Home')next.setDate(current.getDate()-current.getDay());
  else if(event.key==='End')next.setDate(current.getDate()+(6-current.getDay()));
  else next.setDate(current.getDate()+offsets[event.key]);
  eventCalendarAnchor=new Date(next.getFullYear(),next.getMonth(),1);
  eventCalendarDate=isoDate(next);
  renderEventsOnly();
  requestAnimationFrame(()=>document.querySelector(`.event-calendar-day[data-date="${eventCalendarDate}"]`)?.focus());
}
function jumpToEvent(eventId){
  eventCalendarDate='';
  eventTypeFilter='all';
  renderEventsOnly();
  requestAnimationFrame(()=>{
    const card=[...document.querySelectorAll('.event-card')].find(node=>node.dataset.eventId===eventId);
    if(!card)return;
    card.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    card.focus({preventScroll:true});
  });
}
function renderEventCalendar(events,{variant='desktop'}={}){
  const locale=i18nCore.getLocale(),calendar=eventPresentationDomain.calendarMonth(events,{year:eventCalendarAnchor.getFullYear(),month:eventCalendarAnchor.getMonth()});
  const heading=new Intl.DateTimeFormat(locale,{month:'long',year:'numeric'}).format(new Date(calendar.year,calendar.month,1));
  const weekdays=Array.from({length:7},(_,index)=>new Intl.DateTimeFormat(locale,{weekday:'narrow'}).format(new Date(2026,7,2+index)));
  const titleId=`event-calendar-title-${variant}`;
  return`<section class="event-rail-module event-calendar event-calendar-${escAttr(variant)}" aria-labelledby="${titleId}"><div class="event-rail-heading"><h2 id="${titleId}">${escHtml(i18nCore.t('events.calendar'))}</h2><div class="event-calendar-nav"><button type="button" data-event-action="month" data-event-month-delta="-1" aria-label="${escAttr(i18nCore.t('events.previousMonth'))}">${uiIconMarkup('chevron-left','ui-icon')}</button><button type="button" data-event-action="month" data-event-month-delta="1" aria-label="${escAttr(i18nCore.t('events.nextMonth'))}">${uiIconMarkup('chevron-right','ui-icon')}</button></div></div><div class="event-calendar-month">${escHtml(heading)}</div><div class="event-calendar-grid" role="grid" aria-label="${escAttr(heading)}">${weekdays.map(day=>`<span class="event-calendar-weekday" aria-hidden="true">${escHtml(day)}</span>`).join('')}${calendar.cells.map(cell=>{const selected=cell.key===eventCalendarDate,label=i18nCore.t('events.calendarDate',{date:new Intl.DateTimeFormat(locale,{dateStyle:'long'}).format(new Date(`${cell.key}T12:00:00`)),status:i18nCore.t(cell.markerCount?'events.calendarHasEvents':'events.calendarNoEvents')});return`<button type="button" class="event-calendar-day${cell.inMonth?'':' outside'}${cell.today?' today':''}${selected?' selected':''}${cell.markerCount?' has-events':''}" data-event-action="date" data-date="${cell.key}" role="gridcell" aria-selected="${selected}" aria-label="${escAttr(label)}"><span>${cell.day}</span>${cell.markerCount?'<i aria-hidden="true"></i>':''}</button>`;}).join('')}</div><div class="event-calendar-legend"><i aria-hidden="true"></i><span>${escHtml(i18nCore.t('events.calendarLegend'))}</span></div>${renderEventSelectedDay(events)}${eventCalendarDate?`<button type="button" class="event-calendar-clear" data-event-action="clear-date" data-date="${eventCalendarDate}">${escHtml(i18nCore.t('events.clearDate'))}</button>`:''}</section>`;
}
function renderEventSelectedDay(events){
  if(!eventCalendarDate)return'';
  const locale=i18nCore.getLocale(),dateLabel=new Intl.DateTimeFormat(locale,{dateStyle:'long'}).format(new Date(`${eventCalendarDate}T12:00:00`));
  const matches=eventPresentationDomain.eventsOnDate(events,eventCalendarDate);
  const rows=matches.map(event=>{const localized=eventLabelsI18n.localizeEvent(event,locale),timing=eventPresentationDomain.eventTiming(event,{locale}),id=eventStableId(event);return`<button type="button" class="event-selected-day-row" data-event-action="jump" data-event-id="${escAttr(id)}"><strong>${escHtml(localized.localizedTitle)}</strong><span>${escHtml(timing.timeLabel||timing.dateLabel)}</span></button>`;}).join('');
  return`<div class="event-selected-day" aria-live="polite"><h3>${escHtml(i18nCore.t('events.onDate',{date:dateLabel}))}</h3>${rows?`<div class="event-selected-day-list">${rows}</div>`:`<p class="event-selected-day-empty">${escHtml(i18nCore.t('events.noneOnDate',{date:dateLabel}))}</p>`}</div>`;
}
function renderEventFeaturedPokemonNames(event){
  const parts=eventLabelsI18n.recurringParts(event),locale=i18nCore.getLocale();
  if(!parts?.speciesIds?.length)return'';
  const names=parts.speciesIds.map(no=>pokemonNamesI18n.speciesName({no},locale));
  return`<span class="event-up-next-pokemon-names" aria-label="${escAttr(i18nCore.t('events.featuredPokemon'))}">${escHtml(new Intl.ListFormat(locale,{style:'short',type:'conjunction'}).format(names))}</span>`;
}
function renderEventUpNext(events){
  const locale=i18nCore.getLocale(),items=eventPresentationDomain.upNextEvents(events);
  if(!items.length)return'';
  return`<section class="event-rail-module event-up-next" aria-labelledby="event-up-next-title"><div class="event-rail-heading"><h2 id="event-up-next-title">${escHtml(i18nCore.t('events.upNext'))}</h2></div><div class="event-up-next-list">${items.map(event=>{const localized=eventLabelsI18n.localizeEvent(event,locale),timing=eventPresentationDomain.eventTiming(event,{locale}),relative=eventRelativeLabel(timing),id=eventStableId(event);return`<button type="button" class="event-up-next-row" data-event-action="jump" data-event-id="${escAttr(id)}"><span class="event-up-next-category">${escHtml(eventLabelsI18n.typeLabel(event.upNextCategory,locale))}</span><strong>${escHtml(localized.localizedTitle)}</strong>${renderEventFeaturedPokemonNames(event)}<span class="event-up-next-time">${escHtml(timing.dateLabel)}${timing.timeLabel?` · ${escHtml(timing.timeLabel)}`:''}${relative?` · ${escHtml(relative)}`:''}</span></button>`;}).join('')}</div></section>`;
}
function renderEventsRail(events){return`<aside class="events-context-rail" aria-label="${escAttr(i18nCore.t('events.context'))}">${renderEventCalendar(events,{variant:'desktop'})}${renderEventUpNext(events)}<details class="event-calendar-disclosure"><summary>${uiIconMarkup('calendar','ui-icon ui-icon-sm')}<span>${escHtml(i18nCore.t('events.calendar'))}</span></summary>${renderEventCalendar(events,{variant:'mobile'})}</details></aside>`;}
function renderEventsLayout(timeline,events){return`<div class="events-layout"><div class="events-timeline">${timeline}</div>${renderEventsRail(events)}</div>`;}
function syncEventFilterScrollState(row){
  if(!row)return;
  row.parentElement?.classList.toggle('is-at-end',row.scrollLeft+row.clientWidth>=row.scrollWidth-2);
}
async function retryEvents(){
  _eventData=null;_eventLoadState='loading';renderEventsOnly();await fetchPogoEvents(true);renderEventsOnly();
}
function renderEventsOnly(){
  const out=document.getElementById('events-out');if(!out)return;
  out.setAttribute('aria-busy',String(_eventLoadState==='loading'||!_eventData));
  if(_eventLoadState==='loading'||!_eventData){out.innerHTML=eventStateHtml('loading',i18nCore.t('events.loading'));return;}
  if(_eventLoadState==='offline'||navigator.onLine===false&&!(_eventData.events||[]).length){out.innerHTML=eventStateHtml('offline',i18nCore.t('events.offlineTitle'),i18nCore.t('events.offline'),i18nCore.t('events.retry'),'retry');return;}
  if(_eventLoadState==='error'||!_eventData.fetchedAt&&!(_eventData.events||[]).length){out.innerHTML=eventStateHtml('unavailable',i18nCore.t('events.errorTitle'),i18nCore.t('events.error'),i18nCore.t('events.retry'),'retry');return;}
  const allEvents=_eventData.events||[],sections=eventPresentationDomain.prepareEvents(allEvents,{filter:eventTypeFilter,date:eventCalendarDate});
  const filters=[['all','events.filterAll'],['spotlight','events.filterSpotlight'],['raids','events.filterRaids'],['max','events.filterMax'],['gbl','events.filterGbl'],['research','events.filterResearch'],['general','events.filterGeneral']];
  const filterHtml=`<div class="event-filter-scroll"><div class="event-filter-row" role="group" aria-label="${escAttr(i18nCore.t('events.filtersLabel'))}" tabindex="0">${filters.map(([type,key])=>`<button class="event-filter chip chip-filter" data-event-action="filter" data-type="${type}" aria-pressed="${eventTypeFilter===type}">${escHtml(i18nCore.t(key))}</button>`).join('')}</div></div>`;
  if(!sections.length){const filtered=eventTypeFilter!=='all'||!!eventCalendarDate,clear=eventCalendarDate?'clear-date':'clear-filters';out.innerHTML=renderEventsLayout(`${filterHtml}${eventStateHtml('empty',i18nCore.t(filtered?'events.filteredEmptyTitle':'events.emptyTitle'),i18nCore.t(filtered?'events.filteredEmpty':'events.empty'),filtered?i18nCore.t(eventCalendarDate?'events.clearDate':'events.clearFilters'):'',filtered?clear:'')}`,allEvents);syncEventFilterScrollState(out.querySelector('.event-filter-row'));return;}
  const timeline=`${filterHtml}${sections.map(section=>`<section class="event-group" data-group="${section.group}" aria-labelledby="event-group-${section.group}"><div class="event-group-heading"><h2 class="event-group-title" id="event-group-${section.group}">${escHtml(eventGroupLabel(section.group))}</h2><span class="event-group-count" aria-label="${escAttr(i18nCore.t('events.eventCount',{count:i18nCore.formatNumber(section.events.length)}))}">${escHtml(i18nCore.formatNumber(section.events.length))}</span></div><div class="event-card-grid">${section.events.map(event=>{
    const locale=i18nCore.getLocale(),timing=eventPresentationDomain.eventTiming(event,{locale}),relative=eventRelativeLabel(timing);
    const localized=eventLabelsI18n.localizeEvent(event,locale),title=localized.localizedTitle||i18nCore.t('events.title'),link=eventPresentationDomain.safeHttpsUrl(event.link);
    const bonuses=localizedEventBonuses(event),summary=localized.localizedSummary||bonuses[0]||'';
    const tag=link?'a':'article',linkAttrs=link?` href="${escAttr(link)}" target="_blank" rel="noopener noreferrer" aria-label="${escAttr(i18nCore.t('events.openDetailsFor',{event:title}))}"`:' tabindex="-1"';
    return`<${tag} class="event-card card-row ${section.group==='now'?'is-active':''}" data-event-id="${escAttr(localized.stableId)}"${linkAttrs}><div class="event-card-main"><div class="event-card-kicker">${section.group==='now'?`<span class="event-current-badge">${escHtml(i18nCore.t('events.nowBadge'))}</span>`:''}<span class="event-type-tag chip chip-status">${escHtml(localizedEventTypeLabel(event))}</span></div><h3 class="event-card-title type-card">${escHtml(title)}</h3><div class="event-card-time type-meta"><span class="event-card-date">${escHtml(timing.dateLabel)}</span>${timing.timeLabel?`<span class="event-card-time-separator" aria-hidden="true">·</span><span>${escHtml(timing.timeLabel)}</span>`:''}${relative?`<span class="event-card-time-separator" aria-hidden="true">·</span><span class="event-card-relative">${escHtml(relative)}</span>`:''}</div>${summary?`<div class="event-card-summary type-meta">${escHtml(summary)}</div>`:''}</div>${link?`<span class="event-card-cue"><span class="event-card-cue-label">${escHtml(i18nCore.t('events.details'))}</span>${uiIconMarkup('chevron-right','ui-icon event-card-cue-icon')}</span>`:''}</${tag}>`;
  }).join('')}</div></section>`).join('')}`;
  out.innerHTML=renderEventsLayout(timeline,allEvents);
  syncEventFilterScrollState(out.querySelector('.event-filter-row'));
}
function eventsAction(event){
  const control=event.target.closest?.('[data-event-action]');if(!control||!event.currentTarget.contains(control))return;
  const action=control.dataset.eventAction;
  if(action==='filter'){setEventTypeFilter(control.dataset.type||'all');return;}
  if(action==='date'||action==='clear-date'){setEventCalendarDate(control.dataset.date||eventCalendarDate);return;}
  if(action==='month'){
    const delta=Number.parseInt(control.dataset.eventMonthDelta||'',10);if(delta===-1||delta===1)moveEventCalendarMonth(delta);return;
  }
  if(action==='jump'){jumpToEvent(control.dataset.eventId||'');return;}
  if(action==='retry'){retryEvents();return;}
  if(action==='clear-filters')setEventTypeFilter('all');
}
function eventsKeydown(event){
  const filter=event.target.closest?.('.event-filter');if(filter){eventFilterKeydown(event,filter.dataset.type||'all');return;}
  const day=event.target.closest?.('.event-calendar-day');if(day)eventCalendarKeydown(event,day.dataset.date||'');
}
function eventsScroll(event){
  const row=event.target.closest?.('.event-filter-row');if(row)syncEventFilterScrollState(row);
}
document.getElementById('events-out')?.addEventListener('click',eventsAction);
document.getElementById('events-out')?.addEventListener('keydown',eventsKeydown);
document.getElementById('events-out')?.addEventListener('scroll',eventsScroll,true);
window.addEventListener('resize',()=>document.querySelectorAll('.event-filter-row').forEach(syncEventFilterScrollState));
function renderSchedule(){
  if(TRAINER_FIRST_INTERIM_ENABLED){renderEventsOnly();return;}
  if(!schedAnchor)schedAnchor=startOfWeek(new Date());
  if(!schedSelectedDate)schedSelectedDate=todayIso();
  const scheduleAllowed=scheduleAllowedUsers();
  renderOwnerSchedulePreviewBanner(scheduleAllowed);
  const labelEl=document.getElementById('sched-week-label');
  if(labelEl)labelEl.textContent=fmtWeekRange(schedAnchor);
  const strip=document.getElementById('sched-week-strip');
  if(strip){
    const today=todayIso();
    strip.innerHTML=Array.from({length:7}).map((_,i)=>{
      const d=addDays(schedAnchor,i);
      const iso=isoDate(d);
      const isToday=iso===today;
      const isSel=iso===schedSelectedDate;
      const isPast=d<new Date()&&!isToday;
      const evt=dailyEventBonuses(iso);
      const counts=visibleTradeCountsForDay(iso);
      const trade_total=counts.total;
      const tradeTitle=trade_total?`${counts.scheduled} open · ${counts.completed} done`:'';
      return`<div class="sched-day-card ${isToday?'today':''} ${isSel?'selected':''} ${isPast?'past':''}" onclick="selectSchedDay('${iso}')" role="button" tabindex="0">
        <span class="sched-day-wkd">${WKDS[d.getDay()]}</span>
        <span class="sched-day-num">${d.getDate()}</span>
        <div class="sched-day-meta">
          ${evt.events.length?'<span class="sched-day-event-dot" title="Event"></span>':''}
          ${trade_total?`<span class="sched-day-trade-count" title="${escAttr(tradeTitle)}">${trade_total}</span>`:''}
        </div>
        ${evt.specialBonus?`<span class="sched-day-special-bonus" title="+${evt.specialBonus} confirmed bonus special trades">+${evt.specialBonus}⭐</span>`:''}
      </div>`;
    }).join('');
  }
  renderReservedSection();
  renderSchedDayDetail();
}

// ── RESERVED TRADES (from offer-accept flow) ─────────────────
// Accepted offers create a no-date "reserved" trade. This section surfaces
// them at the top of the Schedule view so they don't get lost. From here the
// user can pick a date, mark traded, or cancel.
function reservedTrades(){
  const trades=allData.trades||{};
  return Object.entries(trades)
    .filter(([id,t])=>t&&t.status==='reserved')
    .filter(([id,t])=>!t.participants||t.participants[cur]||t.organizer===cur)
    .map(([id,t])=>({id,...t}))
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
function visibleReservedTrades(){
  return reservedTrades().filter(schedulePreviewAllowsTrade);
}
function renderReservedSection(){
  const el=document.getElementById('sched-reserved-block');
  if(!el)return;
  const reserved=visibleReservedTrades();
  if(!reserved.length){el.innerHTML='';el.style.display='none';return;}
  el.style.display='';
  el.innerHTML=`
    <div class="sched-reserved-hdr">
      📌 Reserved trades <span class="sched-reserved-count">${reserved.length}</span>
      <span class="sched-reserved-hint">Accepted offers waiting on a meet-up date</span>
    </div>
    <div class="sched-reserved-list">
      ${reserved.map(t=>renderReservedCard(t)).join('')}
    </div>`;
}
function renderReservedCard(t){
  const cp=t.counterparty||Object.keys(t.participants||{}).find(u=>u!==cur)||'?';
  const isMine=t.organizer===cur;
  const giveLabel=t.gave?`${t.gave.qty||1}× ${t.gave.name||'?'}${t.gave.gender==='m'?' ♂':t.gave.gender==='f'?' ♀':''}`:'?';
  const getLabel=t.received?`${t.received.qty||1}× ${t.received.name||'?'}${t.received.gender==='m'?' ♂':t.received.gender==='f'?' ♀':''}`:'?';
  const giveSpr=t.gave?.name?spriteUrl(_nameToSpriteEntry(t.gave.name).no,t.gave.name,t.gave.gender||''):'';
  const getSpr=t.received?.name?spriteUrl(_nameToSpriteEntry(t.received.name).no,t.received.name,t.received.gender||''):'';
  const ageMin=t.createdAt?Math.max(0,Math.floor((Date.now()-t.createdAt)/60000)):0;
  const ageLabel=ageMin<60?`${ageMin}m ago`:ageMin<1440?`${Math.floor(ageMin/60)}h ago`:`${Math.floor(ageMin/1440)}d ago`;
  // From the accepting trainer's POV, we GAVE recipient-item and GOT bidder-item.
  // From the bidder's POV (the other participant), the labels swap.
  const youGive=isMine?giveLabel:getLabel;
  const youGet=isMine?getLabel:giveLabel;
  const youGiveSpr=isMine?giveSpr:getSpr;
  const youGetSpr=isMine?getSpr:giveSpr;
  return`<div class="sched-reserved-card" data-id="${escAttr(t.id)}">
    <div class="sched-reserved-with">with <strong>${escHtml(cp)}</strong> <span class="sched-reserved-age">· reserved ${ageLabel}</span></div>
    <div class="sched-reserved-deal">
      <div class="srd-side give">
        <div class="srd-side-label">You give</div>
        <div class="srd-side-body">${youGiveSpr?`<img src="${escAttr(youGiveSpr)}" alt="" loading="lazy">`:'🎮'}<span>${escHtml(youGive)}</span></div>
      </div>
      <div class="srd-arrow">↔</div>
      <div class="srd-side get">
        <div class="srd-side-label">You get</div>
        <div class="srd-side-body">${youGetSpr?`<img src="${escAttr(youGetSpr)}" alt="" loading="lazy">`:'🎮'}<span>${escHtml(youGet)}</span></div>
      </div>
    </div>
    <div class="sched-reserved-actions">
      <button class="srvd-btn schedule" onclick="scheduleReservedTrade('${escAttr(t.id)}')" title="Pick a date/time">📅 Schedule date</button>
      <button class="srvd-btn done" onclick="markReservedTraded('${escAttr(t.id)}')" title="Mark as actually traded (saves to your trade history)">✓ Mark traded</button>
      ${isMine?`<button class="srvd-btn cancel" onclick="cancelReservedTrade('${escAttr(t.id)}')" title="Cancel the reservation">✗ Cancel</button>`:''}
    </div>
  </div>`;
}
function scheduleReservedTrade(id){
  const t=allData.trades?.[id];
  if(!t){toast('Trade not found');return;}
  // Open the existing schedule modal pre-filled with the reservation. Saving
  // the modal upgrades status:'reserved' → 'scheduled' (handled in submitScheduledTrade).
  openScheduleModal(todayIso(),id);
}
async function markReservedTraded(id){
  const t=allData.trades?.[id];
  if(!t){toast('Trade not found');return;}
  const cp=t.counterparty||Object.keys(t.participants||{}).find(u=>u!==cur)||'partner';
  if(!confirm(`Confirm that you actually completed this trade with ${cp} in-game? This moves it into your trade history.`))return;
  await writeTrade(id,{
    ...t,
    date:t.date||todayIso(),
    status:'completed',
    completedAt:Date.now(),
    updatedAt:Date.now()
  });
  toast('✅ Trade marked as completed');
}
async function cancelReservedTrade(id){
  // Same behavior as cancelling a scheduled trade — restore both sides' inventory.
  // The cancelScheduledTrade helper handles the autoLogged / gave / received branching.
  return cancelScheduledTrade(id);
}

function renderSchedDayDetail(){
  const el=document.getElementById('sched-day-detail');
  if(!el)return;
  const iso=schedSelectedDate||todayIso();
  const d=parseIsoDate(iso);
  const evt=dailyEventBonuses(iso);
  const counts=tradeCountsForDay(iso);
  const visibleCounts=visibleTradeCountsForDay(iso);
  // PoGo trade rules:
  //   - 100 regular trades/day cap (does NOT include special trades)
  //   - 1 special trade/day base + event bonuses (independent counter)
  //   - Remote trades require Forever Friend (the level above Best Friend, added 2024).
  //     Tracked as a separate counter, doesn't count toward the regular 100 cap.
  const SPECIAL_BASE=1, REGULAR_CAP=100;
  const specialCap=SPECIAL_BASE+evt.specialBonus;
  const specialLeft=Math.max(0,specialCap-counts.special);
  const regularLeft=Math.max(0,REGULAR_CAP-counts.regular);
  const quotaMeta=(kind,total,emptyText)=>{
    if(!total)return emptyText;
    const st=counts.byStatus?.[kind]||{scheduled:0,completed:0};
    const bits=[`${total} used/reserved`];
    if(st.scheduled)bits.push(`${st.scheduled} open`);
    if(st.completed)bits.push(`${st.completed} done`);
    return bits.join(' · ');
  };
  const dayLabel=d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const eventsHtml=evt.events.length?`<div class="sched-events-panel">
    <details class="sched-events-details" ${evt.events.length<=2?'open':''}>
      <summary class="sched-events-summary">
        <span class="sched-events-kicker">🎉 Live events</span>
        <span class="sched-events-count">${evt.events.length}</span>
        <span class="sched-events-note">${evt.specialBonus?`+${evt.specialBonus} confirmed extra special trade${evt.specialBonus===1?'':'s'} today`:'No confirmed extra special trades found in the live event details'}</span>
        <span class="sched-events-caret">▾</span>
      </summary>
      <div class="sched-event-chip-list">
        ${evt.events.map(ev=>{
          const link=eventPresentationDomain.safeHttpsUrl(ev.link);
          const badge=ev.bonus?`<span class="sched-event-bonus" title="${escAttr(ev.bonusText||'Confirmed in event details')}">+${ev.bonus} ${escHtml(ev.bonusType||'special')}</span>`:'';
          const body=`<span class="sched-event-chip-name">${escHtml(ev.name||ev.heading||'Event')}</span>${badge}${link?'<span class="sched-event-chip-link">↗</span>':''}`;
          return link
            ?`<a class="sched-event-chip" href="${escAttr(link)}" target="_blank" rel="noopener noreferrer">${body}</a>`
            :`<div class="sched-event-chip">${body}</div>`;
        }).join('')}
      </div>
    </details>
  </div>`:'';
  // Manual override row — let user add a custom special-trade bonus for this date
  const manualBonus=parseInt(allData.users?.[cur]?.customBonuses?.[iso])||0;
  const manualBonusHtml=`<div class="sched-manual-bonus">
    <div class="sched-manual-bonus-text">
      <strong>Custom bonus:</strong>
      <span style="color:var(--muted);font-size:11px">If event details confirm extra special trades, add them here.</span>
    </div>
    <div class="sched-manual-bonus-ctrl">
      <button onclick="setManualBonus('${iso}',-1)" class="sched-manual-bonus-btn" aria-label="Decrease custom bonus" ${manualBonus<=0?'disabled':''}>−</button>
      <span class="sched-manual-bonus-val">+${manualBonus}</span>
      <button onclick="setManualBonus('${iso}',1)" class="sched-manual-bonus-btn" aria-label="Increase custom bonus">+</button>
    </div>
  </div>`;
  const tradesHtml=visibleCounts.trades.length?`<div class="sched-trades-list">${visibleCounts.trades.map(t=>renderTradeCard(t)).join('')}</div>`
    :'<div class="sched-empty-trades">No trades scheduled for this day yet.</div>';
  el.innerHTML=`<div class="sched-day-detail">
    <div class="sched-day-detail-hdr">
      <div class="sched-day-detail-date">${dayLabel}</div>
      <button class="sched-day-detail-quick-add" onclick="openScheduleModal('${iso}')">+ Schedule</button>
    </div>
    <div class="sched-quota-row">
      <div class="sched-quota">
        <div class="sched-quota-label">⭐ Special left</div>
        <div class="sched-quota-val ${specialLeft<=0?'danger':specialLeft<=1?'warn':''}">${specialLeft}/${specialCap}</div>
        <div class="${evt.specialBonus?'sched-quota-bonus':'sched-quota-meta'}">${quotaMeta('special',counts.special,evt.specialBonus?`+${evt.specialBonus} bonus${evt.manualBonus?` (incl. ${evt.manualBonus} manual)`:''}`:'1 base · separate counter')}</div>
      </div>
      <div class="sched-quota">
        <div class="sched-quota-label">🤝 Regular left</div>
        <div class="sched-quota-val ${regularLeft<=0?'danger':regularLeft<=20?'warn':''}">${regularLeft}/${REGULAR_CAP}</div>
        <div class="sched-quota-meta">${quotaMeta('regular',counts.regular,'in-person · specials excluded')}</div>
      </div>
      <div class="sched-quota">
        <div class="sched-quota-label">📡 Remote open</div>
        <div class="sched-quota-val">${counts.byStatus?.remote?.scheduled||0}</div>
        <div class="sched-quota-meta">${quotaMeta('remote',counts.remote,'Forever Friend only')}</div>
      </div>
    </div>
    ${eventsHtml}
    ${manualBonusHtml}
    ${tradesHtml}
  </div>`;
}
function renderTradeCard(t){
  const others=Object.keys(t.participants||{}).filter(u=>u!==cur);
  const externalPartners=externalTradePartners(t);
  const isMine=t.organizer===cur||others.length>0;
  const completed=t.status==='completed';
  const time=t.time?`${t.time}`:'flexible';
  const typeClass=t.type||'regular';
  const typeLabel=t.type==='special'?'Special':t.type==='remote'?'Remote':'Regular';
  const regularCount=typeClass==='regular'?scheduledTradeQuantity(t):1;
  const pokemonHtml=(t.pokemon||[]).length?`<div class="sched-trade-pokemon">${t.pokemon.slice(0,8).map(n=>{
    const e=_nameToSpriteEntry(n);
    const url=spriteUrl(e.no,e.name,'',e.displayName||e.name);
    return`<span class="sched-trade-pkmn-chip" title="${escAttr(e.displayName||n)}">${url?`<img src="${url}" alt="">`:''}${escHtml(e.displayName||n)}</span>`;
  }).join('')}</div>`:'';
  const noteHtml=t.note?`<div class="sched-trade-note">"${escHtml(t.note)}"</div>`:'';
  const canEdit=t.organizer===cur;
  return`<div class="sched-trade-card ${isMine?'is-mine':''} ${completed?'completed':''} ${t.status==='cancelled'?'cancelled':''}">
    <div class="sched-trade-info">
      <div class="sched-trade-when">${escHtml(time)} <span class="sched-trade-type-pill ${typeClass}">${typeLabel}</span>${regularCount>1?` <span class="sched-trade-count-pill" title="${regularCount} regular trades reserved">×${regularCount}</span>`:''}</div>
      <div class="sched-trade-with">
        with ${others.length?others.map(u=>escHtml(u)).join(', '):''}
        ${externalPartners.map(n=>`<span class="sched-external-pill" title="Not on the app">Outside app: ${escHtml(n)}</span>`).join('')}
        ${!others.length&&!externalPartners.length?'<em>no one yet</em>':''}
        ${t.organizer&&t.organizer!==cur?` · organized by ${escHtml(t.organizer)}`:''}
      </div>
      ${pokemonHtml}
      ${noteHtml}
    </div>
    <div class="sched-trade-actions">
      ${!completed&&t.status!=='cancelled'?`<button class="sched-trade-btn complete" onclick="markTradeComplete('${t.id}')" title="Mark as completed">✓ Done</button>`:''}
      ${canEdit&&!completed&&t.status!=='cancelled'?`<button class="sched-trade-btn edit" onclick="openScheduleModal('${escAttr(t.date||schedSelectedDate||todayIso())}','${escAttr(t.id)}')" title="Edit scheduled trade">Edit</button>`:''}
      ${canEdit&&!completed&&t.status!=='cancelled'?`<button class="sched-trade-btn cancel" onclick="cancelScheduledTrade('${t.id}')" title="Cancel">✗</button>`:''}
    </div>
  </div>`;
}

async function markTradeComplete(id){
  const t=allData.trades?.[id];if(!t)return;
  await writeTrade(id,{...t,status:'completed',completedAt:Date.now()});
  toast('✓ Trade marked as completed');
}
async function cancelScheduledTrade(id){
  const t=allData.trades?.[id];if(!t)return;
  // Only auto-logged trades (from offer-accept) decremented inventory at create time,
  // so only those have inventory to restore. Manual schedule entries just go away.
  // IMPORTANT: t.counterparty is set from the ORGANIZER's perspective at create
  // time (see _logAcceptedTrade), so when the OTHER side views/cancels the trade
  // we'd pick ourselves and write the restoration record into our own bucket —
  // a no-op for the real partner and a silent +qty inflation for us. Always
  // resolve "the other person" from participants relative to cur.
  const cp=Object.keys(t.participants||{}).find(u=>u!==cur)
    ||(t.counterparty&&t.counterparty!==cur?t.counterparty:'')
    ||(t.organizer&&t.organizer!==cur?t.organizer:'')
    ||'';
  if(t.autoLogged&&(t.gave||t.received)){
    const giveBack=cur===t.organizer?t.gave:t.received;     // what I gave at accept time
    const theyGetBack=cur===t.organizer?t.received:t.gave;  // what counterparty gave
    const giveBackLabel=giveBack?`${giveBack.qty}× ${giveBack.name}`:'';
    const theirLabel=theyGetBack?`${theyGetBack.qty}× ${theyGetBack.name}`:'';
    const msg=`Cancel this trade with ${cp||'partner'}?\n\nYour ${giveBackLabel} will be restored to your inventory immediately.${theirLabel?`\n${cp}'s ${theirLabel} will be restored on their next sync.`:''}\n\nThe trade record stays in your history marked "cancelled".`;
    if(!confirm(msg))return;
    // 1) Restore my own inventory (own path — direct write)
    if(giveBack&&giveBack.key&&giveBack.qty>0){
      const inv={...(allData.have?.[cur]||{})};
      const cur1=haveEntryInfo(inv[giveBack.key]).qty;
      const newQty=Math.min(999,cur1+giveBack.qty);
      setHaveEntry(inv,giveBack.key,newQty);
      await writeHave(cur,inv);
    }
    // 2) Queue restoration to counterparty via pendingDecrements with NEGATIVE qty.
    //    _applyPendingDecrements reads negative qty as "add this amount back".
    if(cp&&theyGetBack&&theyGetBack.key&&theyGetBack.qty>0){
      await _writePendingDecrement(cp,{
        key:theyGetBack.key,
        qty:-theyGetBack.qty,
        inReturnFor:`Trade cancelled by ${cur} — restoring ${theyGetBack.qty}× ${theyGetBack.name}`
      });
    }
    // 3) Mark cancelled (preserve record so both parties see it)
    await writeTrade(id,{...t,status:'cancelled',cancelledAt:Date.now(),cancelledBy:cur,updatedAt:Date.now()});
    toast(`✗ Cancelled — ${giveBackLabel} restored to your inventory${theirLabel?`, ${cp} gets ${theirLabel} back on their next sync`:''}`,4500);
    return;
  }
  // Plain manual-scheduled trade — just confirm + mark cancelled
  if(!confirm('Cancel this scheduled trade?'))return;
  await writeTrade(id,{...t,status:'cancelled',cancelledAt:Date.now(),cancelledBy:cur,updatedAt:Date.now()});
  toast('Trade cancelled');
}

function openScheduleModal(dateIso,editTradeId=''){
  const editTrade=editTradeId?allData.trades?.[editTradeId]:null;
  if(editTradeId&&!editTrade){toast('⚠️ Could not find that scheduled trade');renderSchedule();return;}
  const d=editTrade?.date||dateIso||schedSelectedDate||todayIso();
  const selectedType=editTrade?.type||'regular';
  const regularCount=selectedType==='regular'?scheduledTradeQuantity(editTrade||{}):1;
  const selectedPartners=new Set(editTrade?Object.keys(editTrade.participants||{}).filter(u=>u!==cur):[]);
  const externalValue=externalTradePartners(editTrade||{}).join(', ');
  const pokemonValue=(editTrade?.pokemon||[]).join(', ');
  const noteValue=editTrade?.note||'';
  const modalTitle=editTrade?'Edit Scheduled Trade':'Schedule a Trade';
  const submitText=editTrade?'Save Changes':'Schedule';
  // Pull trainer list (exclude self, only active users from the community)
  const myInv=allData.have?.[cur]||{};
  const allowed=scheduleAllowedUsers();
  const otherUsers=Object.keys(allData.users||{}).filter(u=>u!==cur&&(!allowed||allowed.has(u)||selectedPartners.has(u))).sort();
  // Find Pokemon I have that match others' wants (and vice versa) for suggestions
  const html=`<div class="ov open" id="sched-modal" role="dialog" aria-modal="true" onclick="if(event.target===this)closeScheduleModal()">
    <div class="modal schedule-modal" onclick="event.stopPropagation()">
      <h3>📅 ${modalTitle}</h3>
      <input type="hidden" id="sched-edit-id" value="${escAttr(editTradeId||'')}">
      <div class="sched-form-time-row">
        <div class="sched-form-row">
          <label>Date</label>
          <input type="date" id="sched-date" value="${d}">
        </div>
        <div class="sched-form-row">
          <label>Time (optional)</label>
          <input type="time" id="sched-time" value="${escAttr(editTrade?.time||'')}" placeholder="--:--">
        </div>
      </div>
      <div class="sched-form-row">
        <label>Trade Type</label>
        <div class="sched-type-picker" id="sched-type-picker">
          <button type="button" class="sched-type-btn regular ${selectedType==='regular'?'selected':''}" data-type="regular" onclick="selectSchedType('regular')">🤝 Regular</button>
          <button type="button" class="sched-type-btn special ${selectedType==='special'?'selected':''}" data-type="special" onclick="selectSchedType('special')">⭐ Special</button>
          <button type="button" class="sched-type-btn remote ${selectedType==='remote'?'selected':''}" data-type="remote" onclick="selectSchedType('remote')" title="Remote trade — requires Forever Friend">📡 Remote</button>
        </div>
      </div>
      <input type="hidden" id="sched-type" value="${escAttr(selectedType)}">
      <div class="sched-form-row" id="sched-regular-count-row" style="${selectedType==='regular'?'':'display:none'}">
        <label>Number of regular trades</label>
        <div class="sched-count-control">
          <button type="button" class="sched-count-btn" onclick="adjustSchedRegularCount(-1)" aria-label="Decrease regular trade count">−</button>
          <input type="number" class="sched-count-input" id="sched-regular-count" min="1" max="100" step="1" value="${regularCount}" inputmode="numeric">
          <button type="button" class="sched-count-btn" onclick="adjustSchedRegularCount(1)" aria-label="Increase regular trade count">+</button>
        </div>
        <div class="sched-field-help">Reserve several regular swaps at once, e.g. 25 mirror trades. Special and remote trades still count as one scheduled trade.</div>
      </div>
      <div class="sched-form-row">
        <label>Trade With</label>
        <div class="sched-trainer-picker" id="sched-trainer-picker">
          ${otherUsers.length?otherUsers.map(u=>{
            const ud=allData.users?.[u]||{};
            const fresh=Date.now()-(ud.lastSeen||ud.lastUpdated||0)<7*86400000;
            return`<span class="sched-trainer-chip ${selectedPartners.has(u)?'selected':''}" data-user="${escAttr(u)}" onclick="this.classList.toggle('selected')" title="${escAttr(u)}${ud.friendCode?' · '+escAttr(ud.friendCode):''}">
              ${userAvatarHtml(u,20)} <span>${escHtml(u)}</span>${fresh?'<span style="font-size:10px;color:var(--ok)">●</span>':''}
            </span>`;
          }).join(''):'<div style="font-size:12px;color:var(--muted);font-style:italic">No other trainers yet</div>'}
        </div>
        <div class="sched-external-input-wrap">
          <input type="text" id="sched-external-partners" value="${escAttr(externalValue)}" placeholder="Outside app: trainer name or Discord handle">
          <div class="sched-external-hint">Use this for trades with people who are not app members. Separate multiple names with commas.</div>
        </div>
      </div>
      <div class="sched-form-row">
        <label>Pokémon (optional, comma-separated names)</label>
        <input type="text" id="sched-pokemon" value="${escAttr(pokemonValue)}" placeholder="A-Raichu, Vivillon (Garden)">
      </div>
      <div class="sched-form-row">
        <label>Note (optional)</label>
        <textarea id="sched-note" placeholder="Meet at Bryant Park · hundo hunt · etc.">${escHtml(noteValue)}</textarea>
      </div>
      <div class="mact">
        <button class="bghost" onclick="closeScheduleModal()">Cancel</button>
        <button class="bpri" onclick="submitScheduledTrade()">${submitText}</button>
      </div>
    </div>
  </div>`;
  closeScheduleModal();
  const wrap=document.createElement('div');wrap.innerHTML=html;
  document.body.appendChild(wrap.firstElementChild);
}
function closeScheduleModal(){document.getElementById('sched-modal')?.remove();}
function adjustSchedRegularCount(delta){
  const input=document.getElementById('sched-regular-count');if(!input)return;
  const curN=parseInt(input.value,10)||1;
  input.value=String(Math.max(1,Math.min(100,curN+delta)));
}
function selectSchedType(t){
  document.getElementById('sched-type').value=t;
  document.querySelectorAll('#sched-type-picker .sched-type-btn').forEach(b=>b.classList.toggle('selected',b.dataset.type===t));
  const row=document.getElementById('sched-regular-count-row');
  if(row)row.style.display=t==='regular'?'':'none';
}
async function submitScheduledTrade(){
  const editId=document.getElementById('sched-edit-id')?.value||'';
  const existing=editId?allData.trades?.[editId]:null;
  if(editId&&!existing){toast('⚠️ Could not find that scheduled trade');closeScheduleModal();renderSchedule();return;}
  const date=document.getElementById('sched-date')?.value;
  const time=document.getElementById('sched-time')?.value||'';
  const type=document.getElementById('sched-type')?.value||'regular';
  const regularCount=Math.max(1,Math.min(100,parseInt(document.getElementById('sched-regular-count')?.value,10)||1));
  const partners=[...document.querySelectorAll('#sched-trainer-picker .sched-trainer-chip.selected')].map(c=>c.dataset.user);
  const externalPartners=parseExternalTradePartners(document.getElementById('sched-external-partners')?.value||'');
  const pokemonRaw=document.getElementById('sched-pokemon')?.value||'';
  const note=document.getElementById('sched-note')?.value||'';
  if(!date){toast('⚠️ Pick a date');return;}
  if(!partners.length&&!externalPartners.length){toast('⚠️ Pick an app trainer or enter someone outside the app');return;}
  const allowed=scheduleAllowedUsers();
  const blocked=allowed?partners.filter(p=>!allowed.has(p)):[];
  if(blocked.length){toast(`🔭 Owner preview: ${blocked.join(', ')} ${blocked.length===1?'is':'are'} outside ${DEFAULT_COMMUNITY_NAME}. Turn preview off or add them to the community first.`,6500);return;}
  if(type==='regular'){
    const currentDayRegular=tradeCountsForDay(date).regular;
    const existingRegular=existing&&existing.date===date&&(existing.type||'regular')==='regular'?scheduledTradeQuantity(existing):0;
    const projected=currentDayRegular-existingRegular+regularCount;
    if(projected>100){toast(`⚠️ That would reserve ${projected}/100 regular trades for ${date}. Lower the count first.`,6000);return;}
  }
  const pokemon=pokemonRaw.split(',').map(s=>s.trim()).filter(Boolean);
  const id=editId||`${Date.now()}_${cur}_${Math.random().toString(36).slice(2,7)}`;
  const organizer=existing?.organizer||cur;
  const participants={[organizer]:'organizer'};
  partners.forEach(p=>{participants[p]=existing?.participants?.[p]||'pending';});
  const trade={
    ...(existing||{}),
    date,time,type,
    regularCount:type==='regular'?regularCount:null,
    organizer,
    participants,
    externalPartners,
    externalPartner:externalPartners[0]||null,
    pokemon,
    note:String(note).slice(0,500),
    createdAt:existing?.createdAt||Date.now(),
    updatedAt:Date.now(),
    // Stamp the current community on new records; preserve any explicit
    // communityId already on the existing record so edits don't reassign.
    // Legacy records without communityId fall back to getCurrentCommunityId(),
    // which resolves to DEFAULT_COMMUNITY_ID while MULTI_COMMUNITY_ENABLED=false.
    communityId:existing?.communityId||getCurrentCommunityId(),
    // 'reserved' upgrades to 'scheduled' once the user picks a real date in this modal
    status:existing?.status==='reserved'?'scheduled':(existing?.status||'scheduled')
  };
  await writeTrade(id,trade);
  closeScheduleModal();
  toast(editId?`✅ Trade updated for ${date}${time?' at '+time:''}`:`📅 Trade scheduled for ${date}${time?' at '+time:''}`);
  schedSelectedDate=date;
  // Jump to the right week if needed
  const d=parseIsoDate(date);
  schedAnchor=startOfWeek(d);
  renderSchedule();
}

function updateScheduleNotif(){
  // Show badge on Schedule tab for: (a) trades within the next 24 hours,
  // (b) any open reservations that still need a date. Both are user-actionable.
  const badge=document.getElementById('schedule-notif');
  if(!badge||!cur)return;
  const now=Date.now();
  const inDay=now+24*60*60*1000;
  let count=0;
  Object.values(allData.trades||{}).forEach(t=>{
    if(!t||!t.participants||!t.participants[cur])return;
    if(!schedulePreviewAllowsTrade(t))return;
    if(t.status==='reserved'){count++;return;}
    if(t.status!=='scheduled'||!t.date)return;
    const tDate=parseIsoDate(t.date).getTime();
    if(tDate>=now-86400000&&tDate<=inDay)count++;
  });
  badge.textContent=count>0?count:'';
  badge.style.display=count>0?'':'none';
}

// ── HAVE / INVENTORY ─────────────────────────────────────────
// Inventory entry return-preference modes (mutually exclusive):
//   'any'          — Open: mirror preferred, but anything from the user's want list is okay
//   'mirror'       — only accept the same Pokémon/form in return
//   'dontNeedBack' — "Fair trade" — the item is rare / valuable and expects
//                    comparable rarity from the user's want list.
//   'giveaway'     — "Take it" — I can't hold this any longer; literally take it
//                    for anything. Optional `note` field for trader to specify
//                    preferences (e.g., "common Kanto starters work").
// Cycle gender for a row: rekey the inventory entry to '' → 'm' → 'f' → ''.
// If the target gender already has an entry for this Pokémon, merge quantities.
function cycleInventoryGender(key){
  const inv={...(allData.have?.[cur]||{})};
  const cur1=splitHaveKey(key);
  const info=haveEntryInfo(inv[key]);
  if(!info.qty)return;
  const nextGender=cur1.gender===''?'m':cur1.gender==='m'?'f':'';
  if(nextGender===cur1.gender)return;
  const newKey=joinHaveKey(cur1.name,nextGender);
  if(newKey===key)return;
  const existing=inv[newKey]?haveEntryInfo(inv[newKey]):null;
  if(existing&&existing.qty>0){
    const e=_nameToSpriteEntry(cur1.name);
    const dn=e.displayName||cur1.name;
    const label=nextGender==='m'?'male':nextGender==='f'?'female':'genderless';
    if(!confirm(`You already have a ${label} ${dn} entry (×${existing.qty}). Merge ${info.qty} into it (total ×${existing.qty+info.qty})?`))return;
    // Merge quantities into existing entry, drop source
    setHaveEntry(inv,newKey,Math.min(999,existing.qty+info.qty),{mode:existing.mode,note:existing.note});
    delete inv[key];
  }else{
    // Simple rename — same value object, new key
    inv[newKey]=inv[key];
    delete inv[key];
  }
  writeHave(cur,inv,{refresh:'mine'});
}
function setHaveEntry(inv,name,qty,opts={}){
  const q=Math.max(0,Math.min(999,parseInt(qty)||0));
  if(q<=0)delete inv[name];
  else inv[name]=haveEntryValue(q,inv[name],opts);
}
function isMirrorOnlyHave(username,name){
  return haveEntryInfo(allData.have?.[username]?.[name]).mirrorOnly;
}
function isDontNeedBackHave(username,name){
  return haveEntryInfo(allData.have?.[username]?.[name]).dontNeedBack;
}
function isGiveawayHave(username,name){
  return haveEntryInfo(allData.have?.[username]?.[name]).giveaway;
}
let _myHaveRenderTimer=0;
function queueRenderMyHave(delay=60){
  clearTimeout(_myHaveRenderTimer);
  _myHaveRenderTimer=setTimeout(()=>renderMyHave(),delay);
}
function refreshAfterHaveWrite(username,scope='all'){
  allData=getLocal();
  Object.values(syncQueue||{}).forEach(item=>applyQueuedData(allData,item));
  if(scope==='mine'&&username===cur){
    queueRenderMyHave();
    const inCount=totalOffersForRecipient(cur);
    const badge=document.getElementById('have-notif');
    if(badge){badge.textContent=inCount>0?inCount:'';badge.style.display=inCount>0?'':'none';}
  }else{
    refreshAll();
  }
}
async function writeHave(username,inv,opts={}){
  if(LEGACY_INVENTORY_READ_ONLY){toast(i18nCore.t('inventory.legacyReadOnly'),4500);return false;}
  const s=getLocal();
  if(!s.have)s.have={};
  // Track inventory entry changes for activity sparkline
  const prevCount=Object.keys(s.have[username]||{}).length;
  const newCount=Object.keys(inv||{}).length;
  if(prevCount!==newCount)recordActivityEvent(username,newCount-prevCount);
  s.have[username]=inv;
  const now=Date.now();
  s.users[username]={...s.users[username],lastUpdated:now,lastSeen:now};
  saveLocal(s);
  if(fbOn&&db){
    queueSync(`have/${username}`,inv);
    queueSync(`users/${username}/lastUpdated`,now);
    queueSync(`users/${username}/lastSeen`,now);
  }
  refreshAfterHaveWrite(username,opts.refresh||'all');
  return true;
}
function setHaveView(v){
  haveView=v;
  document.querySelectorAll('.have-toggle-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  document.getElementById('have-mine-view').classList.toggle('active',v==='mine');
  document.getElementById('have-browse-view').classList.toggle('active',v==='browse');
  if(v==='mine')renderMyHave();
  else renderHaveBrowse();
}
function setHaveSubTab(t){
  haveSubTab=t;
  document.querySelectorAll('.have-sub-tab').forEach(b=>b.classList.toggle('on',b.dataset.sub===t));
  renderHaveBrowse();
}
function toggleHaveMatchOnly(){
  haveMatchOnly=!haveMatchOnly;
  const btn=document.getElementById('have-match-btn');
  btn?.classList.toggle('on',haveMatchOnly);
  btn?.setAttribute('aria-pressed',haveMatchOnly?'true':'false');
  renderHaveBrowse();
}
function buildHaveAcItems(){
  // Build autocomplete items from ALL Pokemon (every list type), unique by name
  haveAcItems=[];
  const seen=new Set();
  ['wishlist','dynamax','gmax','costumes'].forEach(type=>{
    listSource(type).forEach(e=>{
      const key=e.catalogId||pokemonCatalogDomain.catalogKey(e.name);
      if(seen.has(key)||!e.name)return;
      seen.add(key);
      const item={name:e.name,dn:pokemonDisplayName(e),no:e.no||null,catalogId:key,legacyAliases:e.legacyAliases,searchAliases:e.searchAliases};
      item.search=normalizeAcText(pokemonSearchLabels(e).join(' '));
      haveAcItems.push(item);
    });
  });
}
function haveAcSearch(q){
  document.getElementById('have-pmon-sel').value='';
  const dd=document.getElementById('have-ac-dropdown');
  if(!q||q.length<1){dd.classList.remove('open');return;}
  if(!haveAcItems.length)buildHaveAcItems();
  haveAcFiltered=rankAutocompleteItems(haveAcItems,q);
  haveAcFocusIdx=-1;
  if(!haveAcFiltered.length){
    dd.innerHTML=`<div class="ac-empty">${escHtml(i18nCore.t('common.noResults'))}</div>`;
  }else{
    dd.innerHTML=haveAcFiltered.map((e,i)=>`
      <div class="ac-item" data-idx="${i}" onmousedown="haveAcSelect(${i})">
        ${e.no||e.spriteUrl?spriteImg(e.no,28,'ac-item-sprite',e.name,'',e.dn):''}
        ${e.no?`<span class="ac-item-no">#${e.no}</span>`:''}
        <span class="ac-item-name">${e.dn}</span>
      </div>`).join('');
  }
  dd.classList.add('open');
}
function haveAcSelect(idx){
  const e=haveAcFiltered[idx];if(!e)return;
  document.getElementById('have-ac-input').value=e.dn;
  document.getElementById('have-pmon-sel').value=e.name;
  document.getElementById('have-ac-dropdown').classList.remove('open');
  document.getElementById('have-qty')?.focus();
}
function haveAcKeydown(ev){
  const dd=document.getElementById('have-ac-dropdown');
  if(!dd.classList.contains('open'))return;
  if(ev.key==='ArrowDown'){ev.preventDefault();haveAcFocusIdx=Math.min(haveAcFocusIdx+1,haveAcFiltered.length-1);updateHaveAcFocus();}
  else if(ev.key==='ArrowUp'){ev.preventDefault();haveAcFocusIdx=Math.max(haveAcFocusIdx-1,0);updateHaveAcFocus();}
  else if(ev.key==='Enter'){ev.preventDefault();if(haveAcFocusIdx>=0)haveAcSelect(haveAcFocusIdx);else if(haveAcFiltered.length)haveAcSelect(0);}
  else if(ev.key==='Escape'){dd.classList.remove('open');}
}
function updateHaveAcFocus(){
  document.querySelectorAll('#have-ac-dropdown .ac-item').forEach((el,i)=>el.classList.toggle('focused',i===haveAcFocusIdx));
}
function setHaveAddMode(mode){
  const hidden=document.getElementById('have-return-mode');
  if(hidden)hidden.value=mode;
  document.querySelectorAll('.have-return-picker .hrp-btn').forEach(b=>b.classList.toggle('selected',b.dataset.mode===mode));
  // Show/hide giveaway note field — only relevant when Giveaway mode is selected
  const noteRow=document.getElementById('have-giveaway-note-row');
  if(noteRow)noteRow.style.display=mode==='giveaway'?'block':'none';
  if(mode!=='giveaway'){const ni=document.getElementById('have-giveaway-note');if(ni)ni.value='';}
}
// Add-form gender pill state (none/m/f). Independent per session.
let _haveAddGender='';
function setHaveAddGender(g){
  _haveAddGender=_normGender(g);
  document.querySelectorAll('.have-add-gender-btn').forEach(b=>{
    b.classList.toggle('on',b.dataset.gender===_haveAddGender);
    b.setAttribute('aria-pressed',b.dataset.gender===_haveAddGender?'true':'false');
  });
}
function addInventoryEntry(){
  const name=document.getElementById('have-pmon-sel').value;
  const qty=Math.max(1,Math.min(999,parseInt(document.getElementById('have-qty').value)||1));
  const mode=document.getElementById('have-return-mode')?.value||'any';
  const note=mode==='giveaway'?(document.getElementById('have-giveaway-note')?.value||'').trim():'';
  if(!name){toast(i18nCore.t('myList.selectPokemon'));return;}
  const gender=_normGender(_haveAddGender);
  const key=joinHaveKey(name,gender);
  const inv={...(allData.have?.[cur]||{})};
  const curInfo=haveEntryInfo(inv[key]);
  // If user selected a non-default mode, override the existing entry's mode.
  // Otherwise preserve existing mode (so re-adding doesn't reset to 'any').
  const newMode=mode!=='any'?mode:curInfo.mode;
  const finalNote=newMode==='giveaway'?(note||curInfo.note):curInfo.note;
  setHaveEntry(inv,key,curInfo.qty+qty,{mode:newMode,note:finalNote});
  writeHave(cur,inv,{refresh:'mine'});
  document.getElementById('have-ac-input').value='';
  document.getElementById('have-pmon-sel').value='';
  document.getElementById('have-qty').value='1';
  setHaveAddMode('any');
  setHaveAddGender('');
  document.getElementById('have-ac-dropdown').classList.remove('open');
  const dn=haveAcItems.find(x=>x.name===name)?.dn||name;
  const genderLabel=gender==='m'?' ♂':gender==='f'?' ♀':'';
  const modeLabel=newMode==='mirror'?' (mirror only)':newMode==='dontNeedBack'?' (fair trade)':newMode==='giveaway'?' (giveaway)':'';
  toast(`✅ Added ${qty}× ${dn}${genderLabel}${modeLabel}`);
}
// Edit just the note on an existing giveaway entry
async function editInventoryNote(key){
  const inv={...(allData.have?.[cur]||{})};
  const info=haveEntryInfo(inv[key]);
  if(info.mode!=='giveaway')return;
  const{name,gender}=splitHaveKey(key);
  const label=name+(gender==='m'?' ♂':gender==='f'?' ♀':'');
  const newNote=prompt(`Giveaway preference for ${label} (optional, e.g. "any common Kanto starter"):`,info.note||'');
  if(newNote===null)return; // cancelled
  setHaveEntry(inv,key,info.qty,{mode:'giveaway',note:String(newNote||'').trim()});
  writeHave(cur,inv,{refresh:'mine'});
}
function updateInventoryQty(name,delta){
  const inv={...(allData.have?.[cur]||{})};
  const curInfo=haveEntryInfo(inv[name]);
  const new_qty=curInfo.qty+delta;
  if(new_qty>999)return;
  setHaveEntry(inv,name,new_qty);
  writeHave(cur,inv,{refresh:'mine'});
}
function setInventoryQty(name,val){
  const v=parseInt(val);
  if(!Number.isFinite(v))return;
  const inv={...(allData.have?.[cur]||{})};
  setHaveEntry(inv,name,Math.min(999,v));
  writeHave(cur,inv,{refresh:'mine'});
}
function toggleInventoryMirror(name){
  const inv={...(allData.have?.[cur]||{})};
  const info=haveEntryInfo(inv[name]);
  if(!info.qty)return;
  setHaveEntry(inv,name,info.qty,{mirrorOnly:!info.mirrorOnly});
  writeHave(cur,inv,{refresh:'mine'});
}
// Cycle: any → mirror → dontNeedBack → giveaway → any
function cycleInventoryMode(name){
  const inv={...(allData.have?.[cur]||{})};
  const info=haveEntryInfo(inv[name]);
  if(!info.qty)return;
  const next=info.mode==='any'?'mirror'
    :info.mode==='mirror'?'dontNeedBack'
    :info.mode==='dontNeedBack'?'giveaway'
    :'any';
  setHaveEntry(inv,name,info.qty,{mode:next});
  writeHave(cur,inv,{refresh:'mine'});
}
// ── INVENTORY BULK OPERATIONS ────────────────────────────────
function toggleHaveBulkMode(){
  haveBulkMode=!haveBulkMode;
  haveBulkSelected.clear();
  document.body.classList.toggle('have-bulk-mode',haveBulkMode);
  document.getElementById('have-bulk-bar')?.classList.toggle('active',haveBulkMode);
  const btn=document.getElementById('have-bulk-toggle-btn');
  if(btn)btn.setAttribute('aria-pressed',haveBulkMode?'true':'false');
  if(haveBulkMode){
    const sel=document.getElementById('have-bulk-mode-sel');
    if(sel){sel.value='';sel.onchange=bulkHaveSetMode;}
  }
  renderMyHave();
  updateHaveBulkCount();
}
function toggleHaveBulkSelection(key){
  if(haveBulkSelected.has(key))haveBulkSelected.delete(key);else haveBulkSelected.add(key);
  document.querySelector(`.have-row[data-key="${key.replace(/"/g,'\\"')}"]`)?.classList.toggle('bulk-selected',haveBulkSelected.has(key));
  const chk=document.querySelector(`.have-row .bulk-chk[data-key="${key.replace(/"/g,'\\"')}"]`);
  if(chk)chk.checked=haveBulkSelected.has(key);
  updateHaveBulkCount();
}
function updateHaveBulkCount(){
  const el=document.getElementById('have-bulk-count');
  if(el)el.textContent=i18nCore.t('bulk.selected',{count:i18nCore.formatNumber(haveBulkSelected.size)});
}
function bulkHaveSetMode(){
  const sel=document.getElementById('have-bulk-mode-sel');
  const v=sel?.value;
  if(!v||!haveBulkSelected.size){if(sel)sel.value='';return;}
  const inv={...(allData.have?.[cur]||{})};
  let count=0;
  haveBulkSelected.forEach(name=>{
    const info=haveEntryInfo(inv[name]);
    if(!info.qty)return;
    setHaveEntry(inv,name,info.qty,{mode:v});
    count++;
  });
  writeHave(cur,inv,{refresh:'mine'});
  if(sel)sel.value='';
  const label=i18nCore.t(`inventory.mode.${v}`);
  toast(i18nCore.t('inventory.bulkModeSet',{count:i18nCore.formatNumber(count),mode:label}));
}
function bulkHaveAdjustQty(delta){
  if(!haveBulkSelected.size){toast(i18nCore.t('bulk.selectFirst'));return;}
  const inv={...(allData.have?.[cur]||{})};
  let changed=0,removed=0;
  haveBulkSelected.forEach(name=>{
    const info=haveEntryInfo(inv[name]);
    if(!info.qty)return;
    const newQty=info.qty+delta;
    if(newQty<=0){delete inv[name];removed++;}
    else if(newQty<=999){setHaveEntry(inv,name,newQty,{mode:info.mode,note:info.note});changed++;}
  });
  writeHave(cur,inv,{refresh:'mine'});
  toast(i18nCore.t(delta>0?'inventory.bulkAdded':'inventory.bulkRemoved',{amount:i18nCore.formatNumber(Math.abs(delta)),changed:i18nCore.formatNumber(changed),removed:i18nCore.formatNumber(removed)}));
  if(removed)haveBulkSelected=new Set([...haveBulkSelected].filter(n=>inv[n]));
}
function bulkHaveDelete(){
  if(!haveBulkSelected.size){toast(i18nCore.t('bulk.selectFirst'));return;}
  if(!confirm(i18nCore.t('inventory.bulkDeleteConfirm',{count:i18nCore.formatNumber(haveBulkSelected.size)})))return;
  const inv={...(allData.have?.[cur]||{})};
  const count=haveBulkSelected.size;
  haveBulkSelected.forEach(name=>{delete inv[name];});
  writeHave(cur,inv,{refresh:'mine'});
  haveBulkSelected.clear();
  updateHaveBulkCount();
  toast(i18nCore.t('inventory.bulkDeleted',{count:i18nCore.formatNumber(count)}));
}
function removeInventoryEntry(name){
  const inv={...(allData.have?.[cur]||{})};
  delete inv[name];
  writeHave(cur,inv,{refresh:'mine'});
}
function _nameToSpriteEntry(name){
  // Lookup sprite metadata for a Pokemon name across all sources
  const srcs=['wishlist','dynamax','gmax','costumes'];
  for(const t of srcs){
    const e=pokemonEntryForLegacyKey(listSource(t),name);
    if(e)return e;
  }
  return{name,displayName:name,no:null};
}
function renderMyHave(filterVal){
  const q=String(filterVal??document.getElementById('have-filter')?.value??'').toLowerCase();
  const el=document.getElementById('have-mine-out');if(!el)return;
  const inv=allData.have?.[cur]||{};
  let entries=Object.entries(inv).map(([key,val])=>{
    const {name,gender}=splitHaveKey(key);
    const info=haveEntryInfo(val);
    const e=_nameToSpriteEntry(name);
    const sourceEntry={...e,name:e.name||name,displayName:e.displayName||name};
    return{key,name,gender,qty:info.qty,mirrorOnly:info.mirrorOnly,dontNeedBack:info.dontNeedBack,giveaway:info.giveaway,note:info.note,mode:info.mode,dn:pokemonDisplayName(sourceEntry),search:normalizeAcText(pokemonSearchLabels(sourceEntry).join(' ')),no:e.no};
  }).filter(e=>e.qty>0);
  const normalizedQuery=normalizeAcText(q);
  if(normalizedQuery)entries=entries.filter(e=>e.search.includes(normalizedQuery));
  // Sort by dex, then base name, then gender (genderless first, then ♂, then ♀ — stable grouping)
  const _gOrder={'':0,'m':1,'f':2};
  entries.sort((a,b)=>(parseInt(a.no)||9999)-(parseInt(b.no)||9999)||comparePokemonLabels(a.dn,b.dn)||(_gOrder[a.gender]??9)-(_gOrder[b.gender]??9));
  const totalCount=Object.values(inv).reduce((s,n)=>s+haveEntryInfo(n).qty,0);
  const entryCount=Object.keys(inv).length;
  const countEl=document.getElementById('have-count');
  if(countEl)countEl.textContent=q?i18nCore.t('myList.filteredCount',{visible:i18nCore.formatNumber(entries.length),total:i18nCore.formatNumber(entryCount)}):i18nCore.t('myList.count',{count:i18nCore.formatNumber(entryCount)});
  const totalEl=document.getElementById('have-total');
  if(totalEl)totalEl.textContent=totalCount?i18nCore.t('inventory.totalPokemon',{count:i18nCore.formatNumber(totalCount)}):'';
  if(!entries.length){
    el.innerHTML=q?emptyHtml(i18nCore.t('myList.noMatches'),i18nCore.t('myList.clearFilter'),'search'):emptyHtml(i18nCore.t('inventory.legacyEmpty'),i18nCore.t('inventory.archiveHelp'),'archive');
    return;
  }
  if(LEGACY_INVENTORY_READ_ONLY){
    el.innerHTML=entries.map(e=>{
      const gender=e.gender==='m'?' ♂':e.gender==='f'?' ♀':'';
      const mode=i18nCore.t(`inventory.mode.${e.mode||'any'}`);
      return`<div class="have-row" data-name="${escAttr(e.name)}" data-key="${escAttr(e.key)}">
        <div class="have-row-sprite">${e.no?spriteImg(e.no,32,'',e.name,e.gender||'',e.dn):'🎮'}</div>
        <div class="have-row-info"><div class="have-row-name">${escHtml(e.dn)}${gender}</div><div class="have-row-meta"><span>${escHtml(mode)}</span>${e.note?`<span> · ${escHtml(e.note)}</span>`:''}</div></div>
        <span class="cb">×${e.qty}</span>
      </div>`;
    }).join('');
    return;
  }
  // Incoming offers count
  const incomingCount=totalOffersForRecipient(cur);
  const inboxBanner=incomingCount>0?`<div class="inbox-banner" onclick="openIncomingOffersModal()">
    <div class="inbox-banner-icon">📬</div>
    <div class="inbox-banner-text">
      <div class="inbox-banner-title">${incomingCount} incoming offer${incomingCount===1?'':'s'}</div>
      <div class="inbox-banner-sub">Tap to review who's offering what (first-come-first-served)</div>
    </div>
    <div class="inbox-banner-arrow">→</div>
  </div>`:'';
  el.innerHTML=inboxBanner+entries.map(e=>{
    // sk = escaped composite KEY (Heracross::m). snName = base name for offer-lookups etc.
    const sk=e.key.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    const snName=e.name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    const offerCount=countOffersForItem(cur,e.key);
    const modeBadge=e.mirrorOnly
      ?'<span class="have-mirror-badge" title="Only accepting the same Pokémon/form in return">🪞 Mirror only</span>'
      :e.dontNeedBack
        ?'<span class="have-dnb-badge" title="Fair trade — comparable rarity from my want list">🤝 Fair trade</span>'
        :e.giveaway
          ?`<span class="have-giveaway-badge" title="Giveaway — can't hold these any longer, take it for anything${e.note?'. Preference: '+escAttr(e.note):''}">📤 Giveaway${e.note?` · ${escHtml(e.note)}`:''}</span>`
          :'';
    const modeBtnClass=e.mirrorOnly?'mirror':e.dontNeedBack?'dnb':e.giveaway?'giveaway':'';
    const modeBtnLabel=e.mirrorOnly?'🪞':e.dontNeedBack?'🤝':e.giveaway?'📤':'Open';
    const modeBtnTitle=e.mirrorOnly?'Mirror only — click to switch to Fair trade'
      :e.dontNeedBack?'Fair trade — click to switch to Giveaway'
      :e.giveaway?'Giveaway — click to switch to Open'
      :'Open — mirror preferred, but any want-list offer is okay; click to switch to Mirror only';
    const editNoteBtn=e.giveaway?`<button class="have-mode-btn giveaway" onclick="event.stopPropagation();editInventoryNote('${sk}')" title="Edit giveaway preference note" style="min-width:32px;padding:5px 6px">✎</button>`:'';
    const genderLabel=e.gender==='m'?'♂':e.gender==='f'?'♀':'⚥';
    const genderTitle=e.gender==='m'?'Male — click for Female'
      :e.gender==='f'?'Female — click to clear'
      :'Gender (optional) — click to mark Male. Splits this entry off as a separate ♂ / ♀ row.';
    const genderBtn=`<button class="have-gender-btn ${e.gender||'unset'}" onclick="event.stopPropagation();cycleInventoryGender('${sk}')" title="${genderTitle}" aria-label="${genderTitle}">${genderLabel}</button>`;
    const genderMetaPill=e.gender?`<span class="have-gender-pill ${e.gender}" title="${e.gender==='f'?'Female':'Male'}-only listing">${e.gender==='f'?'♀':'♂'}</span>`:'';
    const isSel=haveBulkSelected.has(e.key);
    const rowClick=haveBulkMode?`onclick="event.stopPropagation();toggleHaveBulkSelection('${sk}')"`:'';
    return`<div class="have-row${isSel?' bulk-selected':''}" data-name="${escAttr(e.name)}" data-key="${escAttr(e.key)}" ${rowClick}>
      <input type="checkbox" class="bulk-chk" data-key="${sk}" ${isSel?'checked':''} onclick="event.stopPropagation();toggleHaveBulkSelection('${sk}')" aria-label="Select ${escAttr(e.dn)}">
      <div class="have-row-sprite">${e.no?spriteImg(e.no,32,'',e.name,e.gender||'',e.dn):'🎮'}</div>
      <div class="have-row-info">
        <div class="have-row-name">${escHtml(e.dn)} ${genderMetaPill} ${offerCount?`<span class="offer-count-badge unseen" onclick="event.stopPropagation();openIncomingOffersModal('${sk}')" style="margin-left:4px">🔔 ${offerCount}</span>`:''}</div>
        <div class="have-row-meta">
          ${e.no?`<span class="have-row-dex">#${e.no}</span>`:''}
          ${modeBadge}
        </div>
      </div>
      ${editNoteBtn}
      ${genderBtn}
      <button class="have-mode-btn ${modeBtnClass}" onclick="event.stopPropagation();cycleInventoryMode('${sk}')" title="${modeBtnTitle}">${modeBtnLabel}</button>
      <div class="have-row-qty-wrap">
        <button class="have-row-qty-btn" onclick="event.stopPropagation();updateInventoryQty('${sk}',-1)" aria-label="Decrease quantity">−</button>
        <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" class="have-row-qty" value="${e.qty}"
          onclick="event.stopPropagation();this.select()"
          onfocus="this.select()"
          onchange="event.stopPropagation();setInventoryQty('${sk}',this.value)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}else if(event.key==='Escape'){this.value='${e.qty}';this.blur();}"
          aria-label="Quantity for ${escAttr(e.dn)} — click to edit">
        <button class="have-row-qty-btn" onclick="event.stopPropagation();updateInventoryQty('${sk}',1)" aria-label="Increase quantity">+</button>
      </div>
      <button class="have-row-rm" onclick="event.stopPropagation();removeInventoryEntry('${sk}')" aria-label="Remove">×</button>
    </div>`;
  }).join('');
}
function exportLegacyInventoryCsv(){
  const inv=allData.have?.[cur]||{};
  const rows=[['Pokemon','Gender','Quantity','Mode','Note']];
  Object.entries(inv).forEach(([key,value])=>{
    const{name,gender}=splitHaveKey(key);
    const info=haveEntryInfo(value);
    if(info.qty<=0)return;
    rows.push([name,gender,info.qty,info.mode,info.note||'']);
  });
  const csv=rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`${String(cur||'trainer').replace(/[^A-Za-z0-9_-]/g,'_')}-legacy-inventory.csv`);
}
function openIncomingOffersModal(scrollToItem=''){
  const myOffers=Object.fromEntries(Object.entries(allData.offers?.[cur]||{}).filter(([,o])=>offerInReadScope(o,cur)));
  // Group by itemName
  const grouped={};
  Object.entries(myOffers).forEach(([id,o])=>{
    if(!grouped[o.itemName])grouped[o.itemName]=[];
    grouped[o.itemName].push({id,...o});
  });
  Object.values(grouped).forEach(arr=>arr.sort((a,b)=>(a.t||0)-(b.t||0)));
  const itemNames=Object.keys(grouped).sort();
  const html=`<div class="ov open" id="incoming-modal" role="dialog" aria-modal="true" onclick="if(event.target===this)closeIncomingOffersModal()">
    <div class="modal offer-modal" onclick="event.stopPropagation()">
      <h3>📬 Incoming offers (${Object.keys(myOffers).length})</h3>
      ${itemNames.length?itemNames.map(key=>{
        const{name,gender}=splitHaveKey(key);
        const e=_nameToSpriteEntry(name);
        const offers=grouped[key];
        const genderPill=gender?`<span class="have-gender-pill ${gender}" style="margin-left:4px">${gender==='f'?'♀':'♂'}</span>`:'';
        return`<div class="have-pmon-card" id="inbox-${escAttr(offerKey(key))}" style="margin-bottom:8px;cursor:default">
          <div class="have-row-sprite" style="width:32px;height:32px">${e.no?spriteImg(e.no,32,'',name,gender||'',e.displayName||name):'🎮'}</div>
          <div class="have-pmon-info">
            <div class="have-pmon-name" style="font-size:14px">${escHtml(pokemonDisplayName({...e,name:e.name||name,displayName:e.displayName||name}))}${genderPill}</div>
            <div class="have-pmon-meta">${offers.length} offer${offers.length===1?'':'s'}</div>
          </div>
        </div>
        <div class="offer-list" style="margin-bottom:14px">${renderOfferList(cur,key,{myView:true})}</div>`;
      }).join(''):'<div class="offer-list-empty" style="padding:20px">No incoming offers yet. When trainers want to trade for your inventory items, they\'ll appear here.</div>'}
      <div class="mact"><button class="bpri" onclick="closeIncomingOffersModal()">Done</button></div>
    </div>
  </div>`;
  closeIncomingOffersModal();
  const wrap=document.createElement('div');wrap.innerHTML=html;
  document.body.appendChild(wrap.firstElementChild);
  if(scrollToItem){
    setTimeout(()=>document.getElementById('inbox-'+offerKey(scrollToItem))?.scrollIntoView({behavior:'smooth',block:'center'}),100);
  }
}
function closeIncomingOffersModal(){document.getElementById('incoming-modal')?.remove();}
function entryWantedByCur(name){
  const special=(allData.users?.[cur]?.specialTradeBoard?.lf||[]).find(entry=>pokemonCatalogDomain.catalogKey(entry?.name)===pokemonCatalogDomain.catalogKey(name));
  if(special)return{type:'special',p:'',lucky:false,xxl:false,xxs:false,shiny:!!special.shiny,mod:'',backgroundId:normalizeBackgroundId(special.backgroundId)};
  // Check if current user wants this Pokemon (any list, any priority/flag/background)
  for(const t of['wishlist','dynamax','gmax','costumes']){
    const val=pokemonListValueForCanonicalName(allData[t]?.[cur],name);
    if(val){
      const{p,lucky,xxl,xxs,shiny,mod,backgroundId}=parsePri(val);
      if(p||lucky||xxl||xxs||shiny||backgroundId)return{type:t,p,lucky,xxl,xxs,shiny,mod,backgroundId};
    }
  }
  return null;
}
// Check what the OTHER user wants for this Pokémon — used by offer message
function entryWantedByOther(otherUser,name){
  const special=(allData.users?.[otherUser]?.specialTradeBoard?.lf||[]).find(entry=>pokemonCatalogDomain.catalogKey(entry?.name)===pokemonCatalogDomain.catalogKey(name));
  if(special)return{type:'special',p:'',lucky:false,xxl:false,xxs:false,shiny:!!special.shiny,mod:'',backgroundId:normalizeBackgroundId(special.backgroundId)};
  for(const t of['wishlist','dynamax','gmax','costumes']){
    const val=pokemonListValueForCanonicalName(allData[t]?.[otherUser],name);
    if(val){
      const{p,lucky,xxl,xxs,shiny,mod,backgroundId}=parsePri(val);
      if(p||lucky||xxl||xxs||shiny||backgroundId)return{type:t,p,lucky,xxl,xxs,shiny,mod,backgroundId};
    }
  }
  return null;
}
let _haveBrowseRenderTimer=0;
function queueRenderHaveBrowse(){
  clearTimeout(_haveBrowseRenderTimer);
  _haveBrowseRenderTimer=setTimeout(()=>renderHaveBrowse(),120);
}
function makeHaveBrowseContext(qRaw=''){
  const q=String(qRaw||'').toLowerCase().trim();
  const wanted=new Map();
  for(const t of['wishlist','dynamax','gmax','costumes']){
    Object.entries(allData[t]?.[cur]||{}).forEach(([name,val])=>{
      if(wanted.has(name))return;
      const{p,lucky,xxl,xxs,shiny,mod,backgroundId}=parsePri(val);
      if(p||lucky||xxl||xxs||shiny||backgroundId)wanted.set(name,{type:t,p,lucky,xxl,xxs,shiny,mod,backgroundId});
    });
  }
  const spriteCache=new Map();
  const offerIndex=new Map();
  const spriteEntry=name=>{
    if(!spriteCache.has(name))spriteCache.set(name,_nameToSpriteEntry(name));
    return spriteCache.get(name);
  };
  const offersFor=(recipient,itemName)=>{
    if(!offerIndex.has(recipient)){
      const grouped=new Map();
      Object.entries(allData.offers?.[recipient]||{}).forEach(([id,o])=>{
        if(!o?.itemKey)return;
        const arr=grouped.get(o.itemKey)||[];
        arr.push({id,...o});
        grouped.set(o.itemKey,arr);
      });
      grouped.forEach(arr=>arr.sort((a,b)=>(a.t||0)-(b.t||0)));
      offerIndex.set(recipient,grouped);
    }
    return offerIndex.get(recipient).get(offerKey(itemName))||[];
  };
  return{
    q,
    wantFor:name=>wanted.get(name)||null,
    spriteEntry,
    offerCount:(recipient,itemName)=>offersFor(recipient,itemName).length,
    offersFor
  };
}
function haveBrowseItemsForTrainer(u,ctx,opts={}){
  const inv=allData.have?.[u]||{};
  const applyMatchOnly=opts.applyMatchOnly!==false;
  const userMatch=!!(ctx.q&&u.toLowerCase().includes(ctx.q));
  let items=Object.entries(inv).map(([key,val])=>{
    const{name:n,gender}=splitHaveKey(key);
    const info=haveEntryInfo(val);
    if(info.qty<=0)return null;
    const e=ctx.spriteEntry(n);
    const want=ctx.wantFor(n);
    return{key,name:n,gender,qty:info.qty,mirrorOnly:info.mirrorOnly,dontNeedBack:info.dontNeedBack,giveaway:info.giveaway,note:info.note,mode:info.mode,dn:pokemonDisplayName({...e,name:e.name||n,displayName:e.displayName||n}),no:e.no,match:want};
  }).filter(Boolean);
  if(applyMatchOnly&&haveMatchOnly)items=items.filter(it=>it.match);
  if(ctx.q&&!userMatch)items=items.filter(it=>it.dn.toLowerCase().includes(ctx.q));
  return sortHaveBrowseItems(items,opts.sortMode||'default');
}
function sortHaveBrowseItems(items,sortMode='default'){
  const flagScore=it=>{
    if(sortMode==='match')return it.match?1:0;
    if(sortMode==='mirror')return it.mirrorOnly?1:0;
    if(sortMode==='dnb')return it.dontNeedBack?1:0;
    if(sortMode==='giveaway')return it.giveaway?1:0;
    return 0;
  };
  const qtyFirst=sortMode==='all';
  return [...items].sort((a,b)=>
    flagScore(b)-flagScore(a)
    || (qtyFirst?b.qty-a.qty:0)
    || (b.match?1:0)-(a.match?1:0)
    || (parseInt(a.no)||9999)-(parseInt(b.no)||9999)
    || a.dn.localeCompare(b.dn)
  );
}
function haveBrowseTrainerSummary(u,ctx){
  const allItems=haveBrowseItemsForTrainer(u,ctx,{applyMatchOnly:false});
  const items=haveMatchOnly?allItems.filter(it=>it.match):allItems;
  const matchCount=allItems.filter(it=>it.match).length;
  const totalQty=allItems.reduce((s,it)=>s+it.qty,0);
  return{
    items,
    visibleCount:items.length,
    totalCount:allItems.length,
    matchCount,
    totalQty,
    mirrorCount:allItems.filter(it=>it.mirrorOnly).length,
    dnbCount:allItems.filter(it=>it.dontNeedBack).length,
    giveawayCount:allItems.filter(it=>it.giveaway).length
  };
}
function renderHaveBrowseItemCard(u,it,ctx){
  const sk=it.key.replace(/'/g,"\\'").replace(/"/g,'&quot;');
  const offerCount=ctx.offerCount(u,it.key);
  const cardCls=`have-pmon-card ${it.match?'match':''} ${it.mirrorOnly?'mirror-only':''} ${it.dontNeedBack?'dnb':''} ${it.giveaway?'giveaway':''}`;
  const cardTitle=it.mirrorOnly?`${it.dn}${it.gender?(it.gender==='f'?' ♀':' ♂'):''} — mirror only, same Pokémon/form only`
    :it.dontNeedBack?`${it.dn}${it.gender?(it.gender==='f'?' ♀':' ♂'):''} — fair trade: comparable rarity from their want list`
    :it.giveaway?`${it.dn}${it.gender?(it.gender==='f'?' ♀':' ♂'):''} — giveaway${it.note?', note: '+it.note:''}`
    :it.dn+(it.gender?(it.gender==='f'?' ♀':' ♂'):'')+' — click to offer';
  return`<div class="${cardCls}" title="${escAttr(cardTitle)}" onclick="openOfferModal('${escAttr(u)}','${sk}')" style="cursor:pointer">
    <div class="have-row-sprite" style="width:24px;height:24px">${it.no?spriteImg(it.no,24,'',it.name,it.gender||'',it.dn,{scaleCap:1}):'🎮'}</div>
    <div class="have-pmon-info">
      <div class="have-pmon-name">${escHtml(it.dn)}${it.gender?` <span class="have-gender-pill ${it.gender}" title="${it.gender==='f'?'Female':'Male'} only">${it.gender==='f'?'♀':'♂'}</span>`:''}</div>
      ${it.match?`<div class="have-pmon-meta">You want · ${it.match.p||(it.match.lucky?'⚡':'')||(it.match.xxl?'XXL':'')||(it.match.xxs?'XXS':'')}</div>`:''}
      ${it.mirrorOnly?'<div class="have-pmon-meta mirror">🪞 Mirror only</div>':''}
      ${it.dontNeedBack?'<div class="have-pmon-meta dnb">🤝 Fair trade</div>':''}
      ${it.giveaway?`<div class="have-pmon-meta giveaway">📤 Giveaway</div>${it.note?`<div class="have-pmon-note" title="${escAttr(it.note)}">"${escHtml(it.note)}"</div>`:''}`:''}
    </div>
    <div class="have-pmon-qty">×${it.qty}</div>
    ${offerCount?`<span class="offer-count-badge" title="${offerCount} pending offer${offerCount===1?'':'s'}">🔔 ${offerCount}</span>`:''}
    ${it.match?'<span class="match-badge" title="Wishlist match" aria-label="Wishlist match">⭐</span>':''}
  </div>`;
}
function hydrateHaveTrainerCard(card){
  if(!card)return;
  const body=card.querySelector('.have-trainer-body');
  if(!body||body.dataset.loaded==='1')return;
  const u=card.dataset.user||'';
  const ctx=makeHaveBrowseContext(document.getElementById('have-browse-q')?.value||'');
  const sortMode=card.dataset.sort||'default';
  const items=sortHaveBrowseItems(haveBrowseTrainerSummary(u,ctx).items,sortMode);
  body.innerHTML=items.length
    ?`<div class="have-trainer-grid">${items.map(it=>renderHaveBrowseItemCard(u,it,ctx)).join('')}</div>
      <button class="have-offer-btn" onclick="openOfferModal('${escAttr(u)}')">💬 General offer message to ${escHtml(u)}</button>`
    :'<div class="have-empty-pmon">No visible inventory matches this filter.</div>';
  body.dataset.loaded='1';
}
function sortHaveTrainerInventory(ev,btn,sortMode='default'){
  if(ev){ev.preventDefault();ev.stopPropagation();}
  const card=btn?.closest?.('.have-trainer-card');
  if(!card)return;
  card.dataset.sort=sortMode;
  const body=card.querySelector('.have-trainer-body');
  if(body)body.dataset.loaded='0';
  if(!card.classList.contains('expanded'))card.classList.add('expanded');
  hydrateHaveTrainerCard(card);
  card.querySelectorAll('.have-trainer-pill').forEach(p=>p.classList.toggle('sort-on',p===btn));
}
function toggleHaveTrainerCard(card){
  if(!card)return;
  const expanded=card.classList.toggle('expanded');
  if(expanded)hydrateHaveTrainerCard(card);
}
function renderHaveBrowse(){
  return perfTime('render:inventory-browse',()=>_renderHaveBrowseInner());
}
function _renderHaveBrowseInner(){
  const q=String(document.getElementById('have-browse-q')?.value||'').toLowerCase();
  const el=document.getElementById('have-browse-out');if(!el)return;
  const haveData=allData.have||{};
  const ctx=makeHaveBrowseContext(q);
  // Filter trainers (exclude self, only active users)
  const allowed=inventoryBrowseAllowedUsers();
  renderOwnerInventoryPreviewBanner(allowed);
  if(haveSubTab==='trainer'){
    const trainerSummaryCache=new Map();
    const summaryFor=u=>{
      if(!trainerSummaryCache.has(u))trainerSummaryCache.set(u,haveBrowseTrainerSummary(u,ctx));
      return trainerSummaryCache.get(u);
    };
    let trainers=Object.keys(haveData).filter(u=>{
      if(u===cur)return false;
      if(allowed&&!allowed.has(u))return false;
      return summaryFor(u).visibleCount>0;
    }).sort((a,b)=>{
      const sa=summaryFor(a),sb=summaryFor(b);
      return sb.matchCount-sa.matchCount
        || sb.totalQty-sa.totalQty
        || sb.totalCount-sa.totalCount
        || (allData.users?.[b]?.lastUpdated||0)-(allData.users?.[a]?.lastUpdated||0)
        || a.localeCompare(b);
    });
    if(!trainers.length){
      el.innerHTML=emptyHtml(haveMatchOnly?'No matching trainers':'No inventories yet',haveMatchOnly?'Turn off "Only matches" to see all inventories.':'When trainers add to their inventory, they\'ll appear here.','🎒');
      return;
    }
    el.innerHTML=trainers.map(u=>{
      const summary=summaryFor(u);
      return`<div class="have-trainer-card" data-user="${escAttr(u)}">
        <div class="have-trainer-hdr" onclick="toggleHaveTrainerCard(this.parentElement)">
          <div class="have-trainer-id">
            ${userAvatarHtml(u,32)}
            <div style="min-width:0">
              <div class="have-trainer-name">${escHtml(u)}</div>
              <div class="have-trainer-count">${summary.totalCount} Pokémon · ${summary.totalQty} total</div>
            </div>
          </div>
          <div class="have-trainer-summary" aria-label="${escAttr(u)} inventory summary">
            <button type="button" class="have-trainer-pill match" onclick="sortHaveTrainerInventory(event,this,'match')" title="Sort this trainer by wishlist matches" aria-label="${summary.matchCount} Pokémon match your wishlist">⭐ ${summary.matchCount}</button>
            <button type="button" class="have-trainer-pill total" onclick="sortHaveTrainerInventory(event,this,'all')" title="Sort this trainer by all visible entries" aria-label="${summary.visibleCount} visible inventory entries for this trainer">🎒 ${summary.visibleCount}</button>
            ${summary.mirrorCount?`<button type="button" class="have-trainer-pill mirror" onclick="sortHaveTrainerInventory(event,this,'mirror')" title="Sort this trainer by mirror-only listings" aria-label="${summary.mirrorCount} mirror-only listing${summary.mirrorCount===1?'':'s'}">🪞 ${summary.mirrorCount}</button>`:''}
            ${summary.dnbCount?`<button type="button" class="have-trainer-pill dnb" onclick="sortHaveTrainerInventory(event,this,'dnb')" title="Sort this trainer by fair-trade listings" aria-label="${summary.dnbCount} fair-trade listing${summary.dnbCount===1?'':'s'}">🤝 ${summary.dnbCount}</button>`:''}
            ${summary.giveawayCount?`<button type="button" class="have-trainer-pill giveaway" onclick="sortHaveTrainerInventory(event,this,'giveaway')" title="Sort this trainer by giveaway listings" aria-label="${summary.giveawayCount} giveaway listing${summary.giveawayCount===1?'':'s'}">📤 ${summary.giveawayCount}</button>`:''}
          </div>
          <div class="have-trainer-actions">
            <button type="button" class="have-trainer-action trade-match-fab" onclick="event.stopPropagation();openTradeMatchModal(this.closest('.have-trainer-card').dataset.user)" aria-label="Trade match with ${escAttr(u)}" title="Trade match with ${escAttr(u)}">🤝</button>
          </div>
          <span class="collapse-icon">▼</span>
        </div>
        <div class="have-trainer-body" data-loaded="0"></div>
      </div>`;
    }).join('');
  }else{
    // By Pokemon view: group inventory by BASE Pokemon name (♂/♀ variants of the
    // same species merge into the same card, with gender shown per owner-chip).
    const byPokemon={};
    Object.entries(haveData).forEach(([user,inv])=>{
      if(user===cur)return;
      if(allowed&&!allowed.has(user))return;
      Object.entries(inv||{}).forEach(([key,val])=>{
        const{name,gender}=splitHaveKey(key);
        const info=haveEntryInfo(val);
        if(info.qty<=0)return;
        if(!byPokemon[name])byPokemon[name]=[];
        byPokemon[name].push({user,key,gender,qty:info.qty,mirrorOnly:info.mirrorOnly,dontNeedBack:info.dontNeedBack,giveaway:info.giveaway,note:info.note,mode:info.mode});
      });
    });
    let pokemonList=Object.entries(byPokemon).map(([name,owners])=>{
      const e=ctx.spriteEntry(name);
      const want=ctx.wantFor(name);
      const sourceEntry={...e,name:e.name||name,displayName:e.displayName||name};
      return{name,dn:pokemonDisplayName(sourceEntry),search:normalizeAcText(pokemonSearchLabels(sourceEntry).join(' ')),no:e.no,owners,want};
    });
    if(haveMatchOnly)pokemonList=pokemonList.filter(p=>p.want);
    if(q)pokemonList=pokemonList.filter(p=>p.search.includes(normalizeAcText(q))||p.owners.some(o=>o.user.toLowerCase().includes(q)));
    pokemonList.sort((a,b)=>(b.want?1:0)-(a.want?1:0)||(parseInt(a.no)||9999)-(parseInt(b.no)||9999)||a.dn.localeCompare(b.dn));
    if(!pokemonList.length){
      el.innerHTML=emptyHtml(haveMatchOnly?'No matching Pokémon':'No inventories yet',haveMatchOnly?'Turn off "Only matches" to see all inventories.':'When trainers add to their inventory, they\'ll appear here.','🎒');
      return;
    }
    el.innerHTML=pokemonList.map(p=>{
      const totalQty=p.owners.reduce((s,o)=>s+o.qty,0);
      const wantBadge=p.want?`<span class="event-pill" style="background:rgba(245,158,11,.15);color:var(--warn);border-color:rgba(245,158,11,.3)">⭐ You want (${p.want.p||''})</span>`:'';
      return`<div class="have-by-pokemon-card">
        <div class="have-by-pokemon-hdr">
          <div class="have-row-sprite" style="width:34px;height:34px">${p.no?spriteImg(p.no,34,'',p.name,'',p.dn,{scaleCap:1}):'🎮'}</div>
          <div class="have-by-pokemon-name">
            <span class="pmname-text">${escHtml(p.dn)}</span>
            ${wantBadge}
          </div>
          <div style="font-size:11px;color:var(--muted)">${p.owners.length} trainer${p.owners.length===1?'':'s'} · ${totalQty} total</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${p.owners.sort((a,b)=>b.qty-a.qty).map(o=>{
            const ud=allData.users?.[o.user]||{};
            const canDm=!!ud.discord;
            const offerCount=ctx.offerCount(o.user,o.key);
            const tooltip=o.mirrorOnly?'Mirror only: same Pokémon/form only'
              :o.dontNeedBack?'Fair trade: comparable rarity from their want list'
              :o.giveaway?`Giveaway — anything works${o.note?' · '+o.note:''}`
              :canDm?'Click to offer trade':'No Discord linked, click to copy message';
            return`<button class="have-trainer-chip ${p.want?'match':''}" onclick="openOfferModal('${escAttr(o.user)}','${escAttr(o.key)}')" title="${escAttr(tooltip)}">
              ${escHtml(o.user)} <span class="qty">×${o.qty}</span>${o.gender?`<span class="have-gender-pill ${o.gender}" title="${o.gender==='f'?'Female':'Male'} only">${o.gender==='f'?'♀':'♂'}</span>`:''}${o.mirrorOnly?'<span class="have-mirror-badge mini">🪞</span>':''}${o.dontNeedBack?'<span class="have-dnb-badge mini">🤝</span>':''}${o.giveaway?'<span class="have-giveaway-badge mini">📤</span>':''}${offerCount?`<span class="offer-count-badge" style="margin-left:2px;padding:1px 5px;font-size:9px">🔔 ${offerCount}</span>`:''}
            </button>`;
          }).join('')}
        </div>
        ${(()=>{
          // Show consolidated offers list under this Pokémon across all owners + gender variants
          const allOwnerOffers=p.owners.flatMap(o=>ctx.offersFor(o.user,o.key).map(of=>({...of,recipient:o.user})));
          if(!allOwnerOffers.length)return'';
          allOwnerOffers.sort((a,b)=>(a.t||0)-(b.t||0));
          return`<div style="margin-top:8px"><div class="offer-section-label" style="margin:6px 0 4px">Pending offers (FCFS):</div>
            <div class="offer-list">${allOwnerOffers.map((o,i)=>{
              const isFirst=i===0,isMine=o.from===cur;
              const offeringHtml=(o.offering||[]).slice(0,4).map(n=>{
                const e=ctx.spriteEntry(n);
                const url=spriteUrl(e.no,e.name,'',e.displayName||e.name);
                return`<span class="offer-item-chip">${url?`<img src="${url}" alt="" loading="lazy">`:'🎮'}${escHtml(pokemonDisplayName({...e,name:e.name||n,displayName:e.displayName||n}))}</span>`;
              }).join('');
              return`<div class="offer-row ${isFirst?'fcfs-first':''} ${isMine?'my-offer':''}">
                <div class="offer-av">${userAvatarHtml(o.from,24)}</div>
                <div class="offer-info">
                  <div class="offer-from">${escHtml(o.from)}${isMine?' (you)':''} → ${escHtml(o.recipient)} ${isFirst?'<span class="fcfs-tag">1st</span>':''}<span class="time-tag">${relativeTime(o.t)}</span></div>
                  ${o.offering&&o.offering.length?`<div class="offer-items">${offeringHtml}</div>`:'<div style="font-size:11px;color:var(--muted);font-style:italic">No specific items listed</div>'}
                </div>
                ${isMine?`<button class="offer-withdraw-btn" onclick="withdrawOffer('${escAttr(o.recipient)}','${o.id}').then(t=>{if(t)toast('Offer withdrawn');});">Withdraw</button>`:''}
              </div>`;
            }).join('')}</div>
          </div>`;
        })()}
      </div>`;
    }).join('');
  }
}
// ── OFFER HISTORY (FCFS visibility) ──────────────────────────
// Sanitize a Pokemon name for use as a Firebase key (no ., /, $, #, [, ])
function offerKey(name){return String(name).replace(/[^A-Za-z0-9_-]/g,'_');}
function offersForItem(recipient,itemName){
  const all=allData.offers?.[recipient]||{};
  const key=offerKey(itemName);
  return Object.entries(all)
    .filter(([id,o])=>o&&o.itemKey===key&&offerInReadScope(o,recipient))
    .map(([id,o])=>({id,...o}))
    .sort((a,b)=>(a.t||0)-(b.t||0)); // oldest first for FCFS visibility
}
function countOffersForItem(recipient,itemName){return offersForItem(recipient,itemName).length;}
function totalOffersForRecipient(recipient){
  return Object.values(allData.offers?.[recipient]||{}).filter(o=>offerInReadScope(o,recipient)).length;
}
async function submitOffer(recipient,itemName,offering,message){
  if(!cur||!recipient||!itemName)return false;
  const id=`${Date.now()}_${cur}_${Math.random().toString(36).slice(2,7)}`;
  const offer={
    from:cur,
    itemKey:offerKey(itemName),
    itemName:itemName,
    communityId:getCurrentCommunityId(),
    offering:Array.isArray(offering)?offering:[],
    message:String(message||'').slice(0,500),
    t:Date.now()
  };
  // Update local cache
  const s=getLocal();
  if(!s.offers)s.offers={};
  if(!s.offers[recipient])s.offers[recipient]={};
  s.offers[recipient][id]=offer;
  saveLocal(s);
  // Queue Firebase write
  if(fbOn&&db)queueSync(`offers/${recipient}/${id}`,offer);
  syncFromLocal();
  return true;
}
async function withdrawOffer(recipient,offerId){
  const offer=allData.offers?.[recipient]?.[offerId];
  if(!offer)return false;
  if(offer.from!==cur&&recipient!==cur){toast('Not allowed');return false;}
  const s=getLocal();
  if(s.offers?.[recipient]){delete s.offers[recipient][offerId];}
  saveLocal(s);
  if(fbOn&&db)queueSync(`offers/${recipient}/${offerId}`,null);
  syncFromLocal();
  return true;
}
async function markOfferTraded(recipient,offerId){
  // Just removes the offer; recipient is asserting "the trade happened externally"
  return withdrawOffer(recipient,offerId);
}
// ── PER-ITEM TRADE ACCEPTANCE WITH QTY MATCHING ──────────────
// State captured when the accept modal opens. Read inside confirmAcceptTrade.
let _acceptCtx=null;
function _acceptItemDetails(recipient,offerId,offerItemKey){
  const offer=allData.offers?.[recipient]?.[offerId];
  if(!offer)return null;
  const bidder=offer.from;
  const recipientItemKey=offer.itemName;
  const recipientInv=allData.have?.[recipient]||{};
  const bidderInv=allData.have?.[bidder]||{};
  const recipientQty=haveEntryInfo(recipientInv[recipientItemKey]).qty;
  const bidderQty=haveEntryInfo(bidderInv[offerItemKey]).qty;
  const rSplit=splitHaveKey(recipientItemKey);
  const bSplit=splitHaveKey(offerItemKey);
  const rEntry=_nameToSpriteEntry(rSplit.name);
  const bEntry=_nameToSpriteEntry(bSplit.name);
  return{
    offer,bidder,recipient,offerId,offerItemKey,recipientItemKey,
    recipientQty,bidderQty,
    recipientName:pokemonDisplayName({...rEntry,name:rEntry.name||rSplit.name,displayName:rEntry.displayName||rSplit.name}),recipientGender:rSplit.gender,recipientNo:rEntry.no,
    bidderName:pokemonDisplayName({...bEntry,name:bEntry.name||bSplit.name,displayName:bEntry.displayName||bSplit.name}),bidderGender:bSplit.gender,bidderNo:bEntry.no,
    maxQty:Math.min(recipientQty,bidderQty)
  };
}
function openAcceptModal(recipient,offerId,offerItemKey){
  const d=_acceptItemDetails(recipient,offerId,offerItemKey);
  if(!d){toast('Offer no longer exists');return;}
  if(d.recipientQty<=0){toast(`You have no ${d.recipientName} left in your inventory.`);return;}
  if(d.bidderQty<=0){toast(`${d.bidder} no longer has any ${d.bidderName}.`);return;}
  _acceptCtx=d;
  // Render the give/take summary
  const giveSpr=d.recipientNo?spriteImg(d.recipientNo,48,'',d.recipientName,d.recipientGender||'',d.recipientName):'<span style="font-size:36px">🎮</span>';
  const takeSpr=d.bidderNo?spriteImg(d.bidderNo,48,'',d.bidderName,d.bidderGender||'',d.bidderName):'<span style="font-size:36px">🎮</span>';
  const gp=g=>g?` <span class="have-gender-pill ${g}" style="margin-left:2px">${g==='f'?'♀':'♂'}</span>`:'';
  document.getElementById('accept-trade-summary').innerHTML=`
    <div class="accept-side accept-side-give">
      <div class="accept-side-label">You give</div>
      <div class="accept-side-pkmn">${giveSpr}<div class="accept-side-name">${escHtml(d.recipientName)}${gp(d.recipientGender)}</div></div>
      <div class="accept-side-stock">In stock: ×${d.recipientQty}</div>
    </div>
    <div class="accept-arrow">↔</div>
    <div class="accept-side accept-side-take">
      <div class="accept-side-label">You receive (from ${escHtml(d.bidder)})</div>
      <div class="accept-side-pkmn">${takeSpr}<div class="accept-side-name">${escHtml(d.bidderName)}${gp(d.bidderGender)}</div></div>
      <div class="accept-side-stock">They have: ×${d.bidderQty}</div>
    </div>`;
  document.getElementById('accept-qty-input').value=String(d.maxQty);
  document.getElementById('accept-qty-input').max=String(d.maxQty);
  _updateAcceptQtyHint();
  openModal('accept-offer-modal');
}
function closeAcceptModal(){closeModal('accept-offer-modal');_acceptCtx=null;}
function _updateAcceptQtyHint(){
  if(!_acceptCtx)return;
  const q=parseInt(document.getElementById('accept-qty-input').value)||1;
  const hint=document.getElementById('accept-qty-hint');
  const max=_acceptCtx.maxQty;
  if(q>max)hint.innerHTML=`<span class="warn">⚠ Capped at ${max} — the smaller side can't cover more.</span>`;
  else if(q===max)hint.innerHTML=`Max possible (capped by ${_acceptCtx.recipientQty===max?'your':'their'} stock).`;
  else hint.innerHTML=`Up to <strong>${max}</strong> trade${max===1?'':'s'} possible — capped by min(your ×${_acceptCtx.recipientQty}, their ×${_acceptCtx.bidderQty}).`;
}
function adjustAcceptQty(delta){
  if(!_acceptCtx)return;
  const inp=document.getElementById('accept-qty-input');
  const v=Math.max(1,Math.min(_acceptCtx.maxQty,(parseInt(inp.value)||1)+delta));
  inp.value=String(v);
  _updateAcceptQtyHint();
}
function clampAcceptQty(){
  if(!_acceptCtx)return;
  const inp=document.getElementById('accept-qty-input');
  const v=Math.max(1,Math.min(_acceptCtx.maxQty,parseInt(inp.value)||1));
  inp.value=String(v);
  _updateAcceptQtyHint();
}
function maxAcceptQty(){
  if(!_acceptCtx)return;
  document.getElementById('accept-qty-input').value=String(_acceptCtx.maxQty);
  _updateAcceptQtyHint();
}
async function confirmAcceptTrade(){
  if(!_acceptCtx){closeAcceptModal();return;}
  const ctx=_acceptCtx;
  const qty=Math.max(1,Math.min(ctx.maxQty,parseInt(document.getElementById('accept-qty-input').value)||1));
  // Re-check current state in case inventory changed since modal opened
  const recipientInv={...(allData.have?.[ctx.recipient]||{})};
  const bidderInv={...(allData.have?.[ctx.bidder]||{})};
  const liveRecipientQty=haveEntryInfo(recipientInv[ctx.recipientItemKey]).qty;
  const liveBidderQty=haveEntryInfo(bidderInv[ctx.offerItemKey]).qty;
  if(liveRecipientQty<qty||liveBidderQty<qty){
    toast(`⚠️ Stock changed — your ×${liveRecipientQty}, their ×${liveBidderQty}. Re-open the trade.`);
    closeAcceptModal();return;
  }
  // Decrement recipient
  const newR=liveRecipientQty-qty;
  if(newR<=0)delete recipientInv[ctx.recipientItemKey];
  else setHaveEntry(recipientInv,ctx.recipientItemKey,newR);
  // Decrement bidder (skip lastSeen bump since they're not active)
  const newB=liveBidderQty-qty;
  if(newB<=0)delete bidderInv[ctx.offerItemKey];
  else setHaveEntry(bidderInv,ctx.offerItemKey,newB);
  // Confirmation
  const btn=document.getElementById('accept-confirm-btn');
  if(btn){btn.disabled=true;btn.textContent='Trading…';}
  try{
    // 1) Decrement OUR inventory — we own this path, write goes through.
    await writeHave(ctx.recipient,recipientInv);
    // 2) Optimistic local update for the BIDDER's inventory so our own UI
    //    shows the correct count right away. We do NOT queue this to Firebase
    //    because we don't have write access to have/{bidder}. Their actual
    //    Firebase row stays stale until they apply the pending decrement (3).
    const s=getLocal();
    if(!s.have)s.have={};
    s.have[ctx.bidder]=bidderInv;
    saveLocal(s);
    syncFromLocal();
    // 3) Queue a PENDING DECREMENT under the bidder's bucket — their client
    //    will apply it on next sync (next time they open the app or while
    //    they're already online via the subscription). This is the only
    //    cross-user write needed and is allowed by the security rules
    //    because the bidder's bucket explicitly accepts creates from any
    //    authenticated user.
    await _writePendingDecrement(ctx.bidder,{
      key:ctx.offerItemKey,
      qty,
      inReturnFor:`${qty}× ${ctx.recipientName} from ${cur}`
    });
    // 4) Remove the offer.
    await withdrawOffer(ctx.recipient,ctx.offerId);
    // 5) Log a completed trade record so it shows up in both parties' Schedule
    //    views for posterity (and to satisfy "I want a record of what happened").
    await _logAcceptedTrade(ctx,qty).catch(e=>console.warn('Trade log write failed',e));
    toast(`📌 Reserved ${qty}× ${ctx.recipientName} ↔ ${qty}× ${ctx.bidderName} with ${ctx.bidder} — see Schedule tab to plan a meet-up date`,4500);
  }catch(e){
    console.error(e);
    toast('⚠️ Trade failed to save — try again');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='✓ Confirm trade';}
    closeAcceptModal();
  }
}
// Write a completed-trade record for an accepted offer. Lands in allData.trades
// and shows up in the Schedule tab for both the recipient (organizer) and the
// bidder (participant). Auto-tagged with `autoLogged:true` so the UI can
// distinguish these from manually-scheduled trades if we ever want to filter.
async function _logAcceptedTrade(ctx,qty){
  const id=`accept_${Date.now()}_${cur}_${Math.random().toString(36).slice(2,7)}`;
  const now=Date.now();
  const giveLabel=`${qty}× ${ctx.recipientName}${ctx.recipientGender==='m'?' ♂':ctx.recipientGender==='f'?' ♀':''}`;
  const getLabel=`${qty}× ${ctx.bidderName}${ctx.bidderGender==='m'?' ♂':ctx.bidderGender==='f'?' ♀':''}`;
  // A reservation, not a completed trade — the in-game swap hasn't happened
  // yet. Both inventories are already decremented (earmarked for this trade)
  // but the actual meetup may be days away. From the Schedule tab the user
  // can pick a date (→ status:'scheduled'), mark it actually traded
  // (→ status:'completed' with completedAt), or cancel the reservation.
  const trade={
    id,
    date:'',  // empty — reservation has no date yet
    time:'',
    type:'regular',
    organizer:cur,
    participants:{[cur]:'organizer',[ctx.bidder]:'confirmed'},
    pokemon:[ctx.recipientName,ctx.bidderName],
    note:`Reserved via offer accept · ${cur} earmarked ${giveLabel} ↔ ${ctx.bidder} earmarked ${getLabel}`,
    createdAt:now,
    updatedAt:now,
    status:'reserved',
    autoLogged:true,
    // Stamp the organizer's current community so flag-on read scoping
    // surfaces the reservation in the same community as the accepting user.
    communityId:getCurrentCommunityId(),
    gave:{key:ctx.recipientItemKey,name:ctx.recipientName,gender:ctx.recipientGender||'',qty},
    received:{key:ctx.offerItemKey,name:ctx.bidderName,gender:ctx.bidderGender||'',qty},
    counterparty:ctx.bidder
  };
  await writeTrade(id,trade);
  return id;
}
// Queue a one-way "decrement N of {key} from {bidder}'s have/" instruction.
// Only the bidder can read/clear their bucket; any signed-in user can create
// records in it. The bidder reconciles via _applyPendingDecrements.
async function _writePendingDecrement(bidder,payload){
  if(!cur||!bidder)return;
  const id=`${Date.now()}_${cur}_${Math.random().toString(36).slice(2,7)}`;
  // Positive qty = decrement (someone accepted my offer, subtract from them).
  // Negative qty = restoration (I cancelled a trade, give them back what I had).
  // Clamp magnitude only — preserve sign — so the reconciler can branch on it.
  const rawQty=parseInt(payload.qty)||1;
  const sign=rawQty<0?-1:1;
  const mag=Math.max(1,Math.min(999,Math.abs(rawQty)));
  const record={
    from:cur,
    key:String(payload.key||''),
    qty:sign*mag,
    t:Date.now(),
    inReturnFor:String(payload.inReturnFor||'').slice(0,140)
  };
  // Optimistic local cache so a same-device test (e.g. dev with two windows)
  // sees the record immediately even before Firebase round-trips.
  const s=getLocal();
  if(!s.pendingDecrements)s.pendingDecrements={};
  if(!s.pendingDecrements[bidder])s.pendingDecrements[bidder]={};
  s.pendingDecrements[bidder][id]=record;
  saveLocal(s);
  syncFromLocal();
  if(fbOn&&db){
    try{
      await set(ref(db,`pendingDecrements/${bidder}/${id}`),record);
    }catch(e){
      // Distinguish PERMANENT rejection (Firebase rules said no — retrying
      // won't help) from TRANSIENT failure (offline, network blip — should
      // queue for retry). The permanent case is dangerous: leaving the
      // optimistic local record in place means _applyPendingDecrements will
      // re-apply it on the next snapshot in this bucket, silently mutating
      // inventory based on data the server never accepted. Roll it back.
      const code=String(e?.code||e?.message||'').toUpperCase();
      const permanent=code.includes('PERMISSION_DENIED')||code.includes('INVALID_TOKEN')||code.includes('UNAUTH');
      if(permanent){
        const s2=getLocal();
        if(s2.pendingDecrements?.[bidder]?.[id]){
          delete s2.pendingDecrements[bidder][id];
          if(!Object.keys(s2.pendingDecrements[bidder]).length)delete s2.pendingDecrements[bidder];
          saveLocal(s2);
          syncFromLocal();
        }
        console.warn(`_writePendingDecrement: server rejected (${code}). Rolled back local optimistic record so it doesn't apply spuriously.`);
        toast(`⚠️ Couldn't reach the community for that trade adjustment — try again, or sign back in if the issue persists.`,4000);
        return null;
      }
      // Transient — keep local optimism, queue for retry when network returns.
      queueSync(`pendingDecrements/${bidder}/${id}`,record);
    }
  }
  return id;
}
// Apply pending decrements queued for the current user. Runs whenever the
// pendingDecrements/{cur} subscription delivers a snapshot. Idempotent:
// gated by an inflight flag so concurrent snapshot bursts don't double-apply.
let _pendingDecrementsInflight=false;
async function _applyPendingDecrements(){
  if(LEGACY_INVENTORY_READ_ONLY)return;
  if(_pendingDecrementsInflight||!cur)return;
  const pending=allData.pendingDecrements?.[cur]||{};
  const ids=Object.keys(pending);
  if(!ids.length)return;
  _pendingDecrementsInflight=true;
  try{
    const inv={...(allData.have?.[cur]||{})};
    // Sort by t so order is deterministic across clients (oldest first)
    ids.sort((a,b)=>(pending[a]?.t||0)-(pending[b]?.t||0));
    // Separate the two flows so we can craft distinct user-facing toasts.
    // Negative qty = restoration (a trade we accepted was later cancelled).
    // Positive qty = standard decrement (someone accepted our offer).
    const removed=[],restored=[];
    for(const id of ids){
      const dec=pending[id];
      if(!dec)continue;
      const qty=parseInt(dec.qty)||0;
      if(!dec.key||qty===0)continue;
      const cur1=haveEntryInfo(inv[dec.key]).qty;
      if(qty>0){
        const applied=Math.min(qty,cur1);
        const newQty=Math.max(0,cur1-applied);
        if(newQty<=0)delete inv[dec.key];
        else setHaveEntry(inv,dec.key,newQty);
        removed.push({from:dec.from||'someone',key:dec.key,applied,requested:qty});
      }else{
        // Restoration — add Math.abs(qty) back. Capped at 999.
        const give=Math.abs(qty);
        const newQty=Math.min(999,cur1+give);
        setHaveEntry(inv,dec.key,newQty);
        restored.push({from:dec.from||'someone',key:dec.key,added:newQty-cur1,requested:give});
      }
    }
    const summary=[...removed,...restored];
    if(summary.length){
      await writeHave(cur,inv);
      // Clear processed records — own bucket, so the write is allowed.
      for(const id of ids){
        if(fbOn&&db)queueSync(`pendingDecrements/${cur}/${id}`,null);
      }
      const s=getLocal();
      if(s.pendingDecrements?.[cur]){
        ids.forEach(id=>{delete s.pendingDecrements[cur][id];});
        if(!Object.keys(s.pendingDecrements[cur]).length)delete s.pendingDecrements[cur];
        saveLocal(s);
      }
      // Separate toasts for clarity — accepted offers vs cancelled-trade restorations
      if(removed.length){
        const totalQty=removed.reduce((acc,r)=>acc+r.applied,0);
        const fromSet=[...new Set(removed.map(r=>r.from))];
        const fromLabel=fromSet.length===1?fromSet[0]:`${fromSet.length} trainers`;
        const shortage=removed.some(r=>r.applied<r.requested);
        toast(`✅ Synced ${removed.length} accepted trade${removed.length===1?'':'s'} from ${fromLabel} · ${totalQty} item${totalQty===1?'':'s'} removed from your inventory${shortage?' (some capped at 0 — stock was already short)':''}`,4500);
      }
      if(restored.length){
        const totalGiven=restored.reduce((acc,r)=>acc+r.added,0);
        const fromSet=[...new Set(restored.map(r=>r.from))];
        const fromLabel=fromSet.length===1?fromSet[0]:`${fromSet.length} trainers`;
        toast(`↩️ ${restored.length} trade${restored.length===1?'':'s'} cancelled by ${fromLabel} — ${totalGiven} item${totalGiven===1?'':'s'} restored to your inventory`,4500);
      }
    }
  }catch(e){
    console.error('Pending decrement reconcile failed',e);
  }finally{
    _pendingDecrementsInflight=false;
  }
}
// Look up the live qty a given bidder has of an offered key (used to disable
// chips for items that have been depleted since the offer was made).
function _bidderLiveQty(bidder,offerItemKey){
  return haveEntryInfo(allData.have?.[bidder]?.[offerItemKey]).qty;
}
// Render a list of offer rows for a specific item.
// When the viewer IS the recipient, each offered item becomes a clickable
// "✓ Accept" chip — clicking opens the accept modal where qty is auto-capped
// at min(your stock of the listed item, their stock of the offered item) and
// confirming decrements both inventories.
function renderOfferList(recipient,itemName,opts={}){
  const offers=offersForItem(recipient,itemName);
  if(!offers.length)return'<div class="offer-list-empty">No offers yet — be the first!</div>';
  // Live qty of the listed item — drives whether Accept is even possible
  const recipientLiveQty=haveEntryInfo(allData.have?.[recipient]?.[itemName]).qty;
  return offers.map((o,i)=>{
    const isFirst=i===0;
    const isMine=o.from===cur;
    const amRecipient=recipient===cur;
    const canAccept=amRecipient&&!isMine&&recipientLiveQty>0;
    const offeringHtml=(o.offering||[]).slice(0,6).map(k=>{
      const{name,gender}=splitHaveKey(k);
      const e=_nameToSpriteEntry(name);
      const url=spriteUrl(e.no,e.name,gender||'',e.displayName||e.name);
      const genderPill=gender?`<span class="have-gender-pill ${gender}" style="margin-left:2px">${gender==='f'?'♀':'♂'}</span>`:'';
      // Live qty the bidder still has of this offering item (may be 0 if they've
      // traded it away or removed it since posting the offer)
      const bidderQty=_bidderLiveQty(o.from,k);
      const qtyTag=bidderQty>0?`<span class="ofc-qty">×${bidderQty}</span>`:'';
      const cls=canAccept?(bidderQty>0?'offer-item-chip acceptable':'offer-item-chip out-of-stock'):'offer-item-chip';
      const sk=String(k).replace(/'/g,"\\'").replace(/"/g,'&quot;');
      const onClick=(canAccept&&bidderQty>0)?` onclick="openAcceptModal('${escAttr(recipient)}','${o.id}','${sk}')" role="button" tabindex="0"`:'';
      const display=pokemonDisplayName({...e,name:e.name||name,displayName:e.displayName||name});
      const title=canAccept?(bidderQty>0?`Accept ${display} — opens qty picker`:`${o.from} no longer has any ${display}`):display;
      return`<span class="${cls}" title="${escAttr(title)}"${onClick}>${url?`<img src="${url}" alt="" loading="lazy">`:'🎮'}${escHtml(display)}${genderPill}${qtyTag}</span>`;
    }).join('');
    const noneOffered=!o.offering||!o.offering.length;
    const msgHtml=o.message?`<button class="offer-msg-toggle" onclick="this.nextElementSibling.classList.toggle('shown')" aria-expanded="false">💬 Message</button><div class="offer-msg-collapsed">${escHtml(o.message)}</div>`:'';
    const acceptHint=canAccept&&!noneOffered?`<div style="font-size:11px;color:var(--muted);margin-top:6px">↑ Tap an item's green <strong style="color:#10b981">Trade →</strong> button to swap it for your <strong>×${recipientLiveQty}</strong> — qty auto-caps at the smaller side.</div>`:'';
    const noStockHint=amRecipient&&!isMine&&recipientLiveQty<=0?`<div style="font-size:11px;color:var(--warn);margin-top:4px">⚠ You\'re out of stock for this item — can\'t accept any offers until you add some back.</div>`:'';
    return`<div class="offer-row ${isFirst?'fcfs-first':''} ${isMine?'my-offer':''}">
      <div class="offer-av">${userAvatarHtml(o.from,28)}</div>
      <div class="offer-info">
        <div class="offer-from">
          ${escHtml(o.from)}${isMine?' (you)':''}
          ${isFirst?'<span class="fcfs-tag">1st</span>':''}
          <span class="time-tag" title="${new Date(o.t).toLocaleString()}">${relativeTime(o.t)}</span>
        </div>
        ${noneOffered?'<div style="font-size:11px;color:var(--muted);font-style:italic">No specific offering listed</div>':`<div class="offer-items">${offeringHtml}</div>`}
        ${acceptHint}${noStockHint}
        ${msgHtml}
      </div>
      <div class="offer-actions">
        ${isMine?`<button class="offer-withdraw-btn" onclick="withdrawOffer('${escAttr(recipient)}','${o.id}').then(t=>{if(t)toast('Offer withdrawn');});">Withdraw</button>`:''}
        ${amRecipient&&!isMine?`<button class="offer-mark-traded-btn" onclick="markOfferTraded('${escAttr(recipient)}','${o.id}').then(t=>{if(t)toast('Offer removed — assumed traded externally');});" title="Trade happened outside the app — just clear this offer (no inventory change)">Clear (traded externally)</button>`:''}
      </div>
    </div>`;
  }).join('');
}

let activeOfferDraft=null;
function offerSelectedKeys(){
  return[...document.querySelectorAll('#offer-pick-row .offer-pick-chip.selected')].map(el=>el.dataset.key||'').filter(Boolean);
}
function offerItemsLine(draft,keys=[]){
  if(!draft)return'';
  const items=keys.map(k=>draft.myInvByKey?.[k]).filter(Boolean);
  if(!items.length)return'';
  const shown=items.slice(0,4).map(it=>`${it.qty}× ${it.dn}`);
  return shown.join(', ')+(items.length>4?`, and ${items.length-4} more`:'');
}
function buildOfferMessage(draft,selectedKeys=[]){
  if(!draft)return'';
  const{otherUser,focusedPokemon,matches,theyWantNotes}=draft;
  const selectedLine=offerItemsLine(draft,selectedKeys);
  const fallbackLine=draft.theyWant?.length?draft.theyWant.slice(0,3).map(t=>`${t.qty}× ${_nameToSpriteEntry(t.name).displayName||t.name}`).join(', '):'';
  const offeredLine=selectedLine||fallbackLine;
  const myReqLine=focusedPokemon?.want?.shiny?`Heads up — I'm looking for a shiny ${focusedPokemon.dn}.\n\n`:'';
  return`Hey ${otherUser}! 👋\n\n`+
    (focusedPokemon?`I'd love to trade for your ${focusedPokemon.dn}.\n\n`:matches.length?`I saw you have ${matches.slice(0,3).map(m=>m.dn).join(', ')} on your inventory — interested in trading?\n\n`:'')+
    myReqLine+
    (theyWantNotes.length?`Quick note on your wishlist requirements: ${theyWantNotes.slice(0,3).join('; ')}.\n\n`:'')+
    (focusedPokemon?.mirrorOnly?`I saw this is marked mirror only, so I'm offering ${offeredLine||`the same ${focusedPokemon.dn}`} in return.\n\n`:'')+
    (focusedPokemon?.dontNeedBack?`I saw this is marked fair trade — I can offer ${offeredLine||'a few things from your wishlist'} for it. Let me know which feels comparable.\n\n`:'')+
    (focusedPokemon?.giveaway?`Noticed this is marked as a giveaway${focusedPokemon.note?` (note: "${focusedPokemon.note}")`:''} — happy to take it off your hands. ${offeredLine?`I can send ${offeredLine} or anything else from your list — just let me know.`:'Let me know what works!'}\n\n`:'')+
    (!focusedPokemon?.giveaway&&!focusedPokemon?.mirrorOnly&&!focusedPokemon?.dontNeedBack&&offeredLine?`I have ${offeredLine} that match your wishlist.\n\n`:'')+
    `Let me know! 🎮`;
}
function refreshOfferMessage(force=false){
  const msg=document.getElementById('offer-msg');
  if(!msg||!activeOfferDraft)return;
  if(!force&&msg.dataset.dirty==='1')return;
  msg.value=buildOfferMessage(activeOfferDraft,offerSelectedKeys());
}
function toggleOfferPickChip(el){
  el?.classList.toggle('selected');
  refreshOfferMessage(false);
}
function markOfferMessageEdited(el){
  if(el)el.dataset.dirty='1';
}

function openOfferModal(otherUser,specificPokemon=''){
  if(!guardOwnerPreviewTrainer(otherUser,'offers'))return;
  const otherUd=allData.users?.[otherUser]||{};
  const otherInv=allData.have?.[otherUser]||{};
  const myInv=allData.have?.[cur]||{};
  // Pokemon they have that I want (matched on BASE name across ♂/♀ rows)
  const matches=Object.entries(otherInv).filter(([k,val])=>{
    const{name}=splitHaveKey(k);
    return entryWantedByCur(name)&&haveEntryInfo(val).qty>0;
  }).map(([k,val])=>{
    const{name,gender}=splitHaveKey(k);
    const info=haveEntryInfo(val);
    const e=_nameToSpriteEntry(name);
    return{key:k,name,gender,dn:pokemonDisplayName({...e,name:e.name||name,displayName:e.displayName||name}),no:e.no,qty:info.qty,mirrorOnly:info.mirrorOnly,dontNeedBack:info.dontNeedBack,giveaway:info.giveaway,note:info.note,want:entryWantedByCur(name)};
  });
  const focusedPokemon=specificPokemon?(()=>{
    const{name,gender}=splitHaveKey(specificPokemon);
    const info=haveEntryInfo(otherInv[specificPokemon]);
    const e=_nameToSpriteEntry(name);
    return{key:specificPokemon,name,gender,dn:pokemonDisplayName({...e,name:e.name||name,displayName:e.displayName||name}),no:e.no,qty:info.qty,mirrorOnly:info.mirrorOnly,dontNeedBack:info.dontNeedBack,giveaway:info.giveaway,note:info.note,want:entryWantedByCur(name)};
  })():null;
  // Pokemon I have that they want — match BASE name (♂/♀ rows count individually)
  const theyWant=[];
  Object.keys(myInv).forEach(k=>{
    const{name,gender}=splitHaveKey(k);
    const info=haveEntryInfo(myInv[k]);
    if(info.qty<=0)return;
    for(const t of['wishlist','dynamax','gmax','costumes']){
      const val=allData[t]?.[otherUser]?.[name];
      if(val){const{p}=parsePri(val);if(p){theyWant.push({key:k,name,gender,qty:info.qty,p,type:t});break;}}
    }
  });
  // Mirror-match qty: sum my ♂+♀+genderless of the same base name
  const mirrorMatchQty=focusedPokemon?totalQtyForName(myInv,focusedPokemon.name):0;
  // Default selection: pre-select MY rows whose base name they want
  const preSelected=new Set(focusedPokemon?.mirrorOnly&&mirrorMatchQty>0
    ?Object.keys(myInv).filter(k=>splitHaveKey(k).name===focusedPokemon.name&&haveEntryInfo(myInv[k]).qty>0)
    :theyWant.slice(0,5).map(t=>t.key));
  // Build per-item "they want" notes (shiny preference) for items I'm likely offering
  const theyWantNotes=theyWant.map(t=>{
    const w=entryWantedByOther(otherUser,t.name);
    if(!w?.shiny)return null;
    const e=_nameToSpriteEntry(t.name);return `${pokemonDisplayName({...e,name:e.name||t.name,displayName:e.displayName||t.name})} (shiny)`;
  }).filter(Boolean);
  // Show existing offers on the focused item for context (offers are scoped to the gendered key)
  const existingOffers=focusedPokemon?offersForItem(otherUser,focusedPokemon.key):[];
  let myInvEntries=Object.entries(myInv).map(([k,val])=>{
    const{name,gender}=splitHaveKey(k);
    const info=haveEntryInfo(val);
    const e=_nameToSpriteEntry(name);
    return{key:k,name,gender,dn:pokemonDisplayName({...e,name:e.name||name,displayName:e.displayName||name}),no:e.no,qty:info.qty,theyWant:theyWant.some(t=>t.key===k)};
  }).filter(it=>it.qty>0);
  if(focusedPokemon?.mirrorOnly)myInvEntries=myInvEntries.filter(it=>it.name===focusedPokemon.name);
  myInvEntries.sort((a,b)=>(b.theyWant?1:0)-(a.theyWant?1:0)||a.dn.localeCompare(b.dn)||({'':0,'m':1,'f':2}[a.gender]??9)-({'':0,'m':1,'f':2}[b.gender]??9));
  const myInvByKey=Object.fromEntries(myInvEntries.map(it=>[it.key,it]));
  const offerDraft={otherUser,focusedPokemon,matches,theyWant,theyWantNotes,myInvByKey};
  const defaultMessage=buildOfferMessage(offerDraft,[...preSelected]);
  const html=`<div class="ov open" id="offer-modal" role="dialog" aria-modal="true" onclick="if(event.target===this)closeOfferModal()">
    <div class="modal offer-modal" onclick="event.stopPropagation()">
      <h3>💬 Offer trade with ${escHtml(otherUser)}</h3>
      ${focusedPokemon?`<div class="offer-pkmn-display">
        <div class="sprite-wrap">${focusedPokemon.no?spriteImg(focusedPokemon.no,42,'',focusedPokemon.name,focusedPokemon.gender||'',focusedPokemon.dn):'🎮'}</div>
        <div style="flex:1">
          <div class="offer-name">${escHtml(focusedPokemon.dn)}${focusedPokemon.gender?` <span class="have-gender-pill ${focusedPokemon.gender}" title="${focusedPokemon.gender==='f'?'Female':'Male'} only">${focusedPokemon.gender==='f'?'♀':'♂'}</span>`:''} <span style="color:var(--ac2);font-family:var(--mono);font-size:13px">×${focusedPokemon.qty}</span></div>
          <div class="offer-meta">${focusedPokemon.mirrorOnly?'<span class="have-mirror-badge">🪞 Mirror only</span> ':''}${focusedPokemon.dontNeedBack?'<span class="have-dnb-badge">🤝 Fair trade</span> ':''}${focusedPokemon.giveaway?'<span class="have-giveaway-badge">📤 Giveaway</span> ':''}${focusedPokemon.want?`You want this at ${focusedPokemon.want.p||'flag'}${focusedPokemon.want.shiny?' · <span style="color:#f472b6">✨ shiny only</span>':''}`:''}${existingOffers.length?` · <strong style="color:var(--warn)">🔔 ${existingOffers.length} existing offer${existingOffers.length===1?'':'s'}</strong>`:''}</div>
        </div>
      </div>
      ${focusedPokemon.mirrorOnly?`<div class="offer-no-discord" style="border-color:rgba(14,165,233,.35);color:#38bdf8;background:rgba(14,165,233,.08)">🪞 Mirror only: ${escHtml(otherUser)} is only accepting the same exact Pokémon/form for this.</div>`:''}
      ${focusedPokemon.dontNeedBack?`<div class="offer-no-discord" style="border-color:rgba(20,184,166,.4);color:#14b8a6;background:rgba(20,184,166,.08)">🤝 Fair trade: ${escHtml(otherUser)} is looking for comparable rarity from their want list.</div>`:''}
      ${focusedPokemon.giveaway?`<div class="offer-no-discord" style="border-color:rgba(251,146,60,.4);color:#fb923c;background:rgba(251,146,60,.08)">📤 Giveaway: ${escHtml(otherUser)} can't hold these any longer — they'll take anything reasonable.${focusedPokemon.note?` Their preference: <em>"${escHtml(focusedPokemon.note)}"</em>`:''}</div>`:''}
      ${existingOffers.length?`<div class="offer-section-label">Existing offers (FCFS):</div>
        <div class="offer-list">${renderOfferList(otherUser,focusedPokemon.name)}</div>`:''}
      `:''}
      ${!focusedPokemon&&matches.length?`<div class="offer-section-label">They have (you want):</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
          ${matches.slice(0,8).map(m=>`<span class="have-trainer-chip match" title="${escAttr(m.dn)}">${escHtml(m.dn)}${m.gender?`<span class="have-gender-pill ${m.gender}">${m.gender==='f'?'♀':'♂'}</span>`:''} <span class="qty">×${m.qty}</span></span>`).join('')}
        </div>`:''}
      <div class="offer-section-label">What are you offering?${focusedPokemon?.mirrorOnly?' <span style="color:#38bdf8;font-weight:700;text-transform:none;letter-spacing:0">Mirror only</span>':''}${myInvEntries.length?'':` <span style="color:var(--muted);font-weight:400;font-style:italic">— ${focusedPokemon?.mirrorOnly?'add the same Pokémon':'add some'} to your 🎒 inventory first</span>`}</div>
      ${myInvEntries.length?`<div class="offer-pick-row" id="offer-pick-row">
        ${myInvEntries.map(it=>{
          const url=spriteUrl(it.no,it.name,it.gender||'',it.dn);
          const genderPill=it.gender?`<span class="have-gender-pill ${it.gender}" style="margin-left:2px">${it.gender==='f'?'♀':'♂'}</span>`:'';
          return`<span class="offer-pick-chip ${preSelected.has(it.key)?'selected':''}" data-key="${escAttr(it.key)}" onclick="toggleOfferPickChip(this)" title="${escAttr(it.dn)}">
            ${url?`<img src="${url}" alt="" loading="lazy">`:''}<span>${escHtml(it.dn)}</span>${genderPill}<span style="color:var(--ac2);font-family:var(--mono);font-size:11px">×${it.qty}</span>${it.theyWant?'<span style="font-size:9px;color:var(--warn);font-weight:700">⭐</span>':''}
          </span>`;
        }).join('')}
      </div>`:'<div class="offer-pick-empty">Your inventory is empty. You can still send a message offer without specific items.</div>'}
      <div class="offer-section-label">Message:</div>
      <textarea class="offer-textarea" id="offer-msg" placeholder="Optional message..." oninput="markOfferMessageEdited(this)">${escHtml(defaultMessage)}</textarea>
      ${otherUd.discord?`<div style="margin-top:10px;font-size:12px;color:var(--muted)">
        Discord: <code style="color:var(--ac2);font-family:var(--mono)">${escHtml(otherUd.discord)}</code>
        <a class="offer-discord-link" href="https://discord.com/channels/@me" target="_blank" rel="noopener">Open Discord ↗</a>
      </div>`:`<div class="offer-no-discord">
        ⚠️ ${escHtml(otherUser)} hasn't added a Discord handle. Use the public offer or reach out via your community channel.
      </div>`}
      <div class="offer-public-toggle">
        <input type="checkbox" id="offer-public" checked>
        <label for="offer-public">
          <strong>Make this offer public</strong>
          <div class="offer-public-toggle-hint">Everyone in the community sees who offered what & when. Enforces fairness (first-come-first-served).</div>
        </label>
      </div>
      <div class="mact">
        <button class="bghost" onclick="closeOfferModal()">Cancel</button>
        <button class="bpri" onclick="submitOfferAction('${escAttr(otherUser)}','${escAttr(focusedPokemon?focusedPokemon.key:'')}')">${focusedPokemon?'Send Offer':'Copy Message'}</button>
      </div>
    </div>
  </div>`;
  closeOfferModal();
  activeOfferDraft=offerDraft;
  const wrap=document.createElement('div');wrap.innerHTML=html;
  document.body.appendChild(wrap.firstElementChild);
}
function closeOfferModal(){activeOfferDraft=null;document.getElementById('offer-modal')?.remove();}
async function submitOfferAction(otherUser,itemKey){
  const msg=document.getElementById('offer-msg')?.value||'';
  const makePublic=!!document.getElementById('offer-public')?.checked;
  // Collect selected offering items — keys include gender suffix when applicable
  const offering=[...document.querySelectorAll('#offer-pick-row .offer-pick-chip.selected')].map(el=>el.dataset.key||el.dataset.name);
  if(makePublic&&itemKey&&isMirrorOnlyHave(otherUser,itemKey)){
    // Mirror match is on base name (♂↔♀ both count as the same species for "same Pokémon back")
    const itemBase=splitHaveKey(itemKey).name;
    const allMatch=offering.length&&offering.every(o=>splitHaveKey(o).name===itemBase);
    if(!allMatch){
      toast('⚠️ Mirror only: select the same Pokémon (any gender ok) before posting an offer');
      return;
    }
  }
  // Try to copy the message to the clipboard for convenience — but don't let a
  // clipboard failure (no permission, locked screen, PWA quirks, etc.) abort
  // the offer submission. The offer posting is the important part.
  let copied=true;
  try{await copyText(msg);}catch{copied=false;}
  const ud=allData.users?.[otherUser]||{};
  // Submit public offer if applicable
  if(makePublic&&itemKey){
    await submitOffer(otherUser,itemKey,offering,msg);
    toast(copied
      ?`📋 Copied & offer posted — ${ud.discord?`now message ${ud.discord} on Discord`:'send to '+otherUser}`
      :`✅ Offer posted — couldn't copy the message to clipboard, ${ud.discord?`grab it from below and message ${ud.discord} on Discord`:'send manually to '+otherUser}`,
      copied?2500:4500);
  }else if(makePublic&&!itemKey){
    toast(copied?'📋 Copied — pick a specific Pokémon to post a public offer':'⚠️ Couldn\'t copy. Pick a specific Pokémon to post a public offer.');
  }else{
    toast(copied
      ?`📋 Copied — ${ud.discord?`paste in Discord (${ud.discord})`:'send to '+otherUser}`
      :`⚠️ Couldn\'t copy automatically. ${ud.discord?`Message ${ud.discord} on Discord manually.`:'Send manually to '+otherUser+'.'}`);
  }
  closeOfferModal();
}
// Legacy alias for old call sites
function copyOfferMessage(otherUser){return submitOfferAction(otherUser,'');}

// ── BULK OPERATIONS (#2) ──────────────────────────────────────
function toggleBulkMode(){
  bulkMode=!bulkMode;
  if(bulkMode&&reorderMode){reorderMode=false;document.body.classList.remove('reorder-mode');const reorderButton=document.getElementById('mylist-reorder-toggle');if(reorderButton){reorderButton.setAttribute('aria-pressed','false');reorderButton.querySelector('span').textContent=i18nCore.t('myList.reorder');}}
  bulkSelected.clear();
  document.body.classList.toggle('bulk-mode',bulkMode);
  document.getElementById('bulk-bar')?.classList.toggle('active',bulkMode);
  const btn=document.getElementById('bulk-toggle-btn');
  if(btn)btn.setAttribute('aria-checked',bulkMode?'true':'false');
  if(bulkMode){
    const sel=document.getElementById('bulk-pri-sel');
    if(sel){sel.value='';sel.onchange=bulkSetPri;}
  }
  renderMyList();
  updateBulkCount();
}
function toggleBulkSelection(name){
  if(bulkSelected.has(name))bulkSelected.delete(name);else bulkSelected.add(name);
  document.querySelectorAll('.myrow').forEach(row=>{
    if(row.dataset.name===name)row.classList.toggle('bulk-selected',bulkSelected.has(name));
  });
  const chk=[...document.querySelectorAll('.bulk-chk')].find(el=>el.dataset.name===name);
  if(chk)chk.checked=bulkSelected.has(name);
  updateBulkCount();
}
function updateBulkCount(){
  const el=document.getElementById('bulk-count');
  if(el)el.textContent=i18nCore.t('bulk.selected',{count:i18nCore.formatNumber(bulkSelected.size)});
}
async function bulkSetPri(){
  const sel=document.getElementById('bulk-pri-sel');
  const v=sel.value;
  if(!v||!bulkSelected.size){sel.value='';return;}
  const list={...(allData[myListType]?.[cur]||{})};
  bulkSelected.forEach(name=>{
    if(!list[name])return;
    const{mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(list[name]);
    list[name]=priValue(v==='_clear'?'':v,mod,lucky,xxl,xxs,shiny,backgroundId);
  });
  if(!await writeList(myListType,cur,list))return;
  sel.value='';
  toast(i18nCore.t('bulk.updated',{count:i18nCore.formatNumber(bulkSelected.size)}));
}
async function bulkToggleFlag(flag){
  if(!bulkSelected.size){toast(i18nCore.t('bulk.selectFirst'));return;}
  const list={...(allData[myListType]?.[cur]||{})};
  // Determine if MOST are already set — toggle to opposite
  let setCount=0;
  bulkSelected.forEach(name=>{
    if(!list[name])return;
    const parsed=parsePri(list[name]);
    if(parsed[flag])setCount++;
  });
  const turnOn=setCount<bulkSelected.size/2;
  bulkSelected.forEach(name=>{
    if(!list[name])return;
    const{p,mod,lucky,xxl,xxs,shiny,backgroundId}=parsePri(list[name]);
    let nl=lucky,nx=xxl,ns=xxs,nsh=shiny;
    if(flag==='lucky')nl=turnOn;
    if(flag==='shiny')nsh=turnOn;
    if(flag==='xxl'){nx=turnOn;if(turnOn)ns=false;}
    if(flag==='xxs'){ns=turnOn;if(turnOn)nx=false;}
    list[name]=priValue(p,mod,nl,nx,ns,nsh,backgroundId);
  });
  if(!await writeList(myListType,cur,list))return;
  toast(i18nCore.t(turnOn?'bulk.flagAdded':'bulk.flagRemoved',{flag:flag.toUpperCase(),count:i18nCore.formatNumber(bulkSelected.size)}));
}
async function bulkDelete(){
  if(!bulkSelected.size){toast(i18nCore.t('bulk.selectFirst'));return;}
  if(!confirm(i18nCore.t('bulk.deleteConfirm',{count:i18nCore.formatNumber(bulkSelected.size)})))return;
  const prevList={...(allData[myListType]?.[cur]||{})};
  const list={...prevList};
  bulkSelected.forEach(name=>{delete list[name];});
  const count=bulkSelected.size;
  if(!await writeList(myListType,cur,list))return;
  // Single undo for the batch
  undoStack={type:myListType,username:cur,list:prevList,name:i18nCore.t('bulk.entries',{count:i18nCore.formatNumber(count)})};
  showUndo(i18nCore.t('bulk.entries',{count:i18nCore.formatNumber(count)}));
  bulkSelected.clear();
  updateBulkCount();
}

// ── VOICE INPUT (#3) ──────────────────────────────────────────
// ── PHONETIC POKEMON NAME MATCHING ───────────────────────────
// Pokemon names are foreign to most speech recognition engines.
// Use phonetic encoding + Levenshtein distance to find the best match.
function fuzzyMatchPokemon(spoken){
  if(!spoken)return null;
  const cleaned=String(spoken).toLowerCase().trim();
  // Try direct hit on autocomplete items first
  const items=acItems||[];
  // 1. Exact substring match in display name
  let direct=items.find(e=>(e.dn||'').toLowerCase()===cleaned);
  if(direct)return{match:direct,confidence:'exact',spoken};
  // 2. Strip filler words ("the", "a", "uh", "um", "add")
  const filler=cleaned.replace(/\b(the|a|an|uh|um|add|put|find|search|for|please)\b/g,'').trim();
  direct=items.find(e=>(e.dn||'').toLowerCase()===filler||(e.dn||'').toLowerCase().includes(filler));
  if(direct&&filler.length>2)return{match:direct,confidence:'substring',spoken};
  // 3. Phonetic + Levenshtein
  const targetPh=_phoneticCode(filler||cleaned);
  if(!targetPh)return null;
  let best=null,bestScore=Infinity;
  items.forEach(e=>{
    const namePh=_phoneticCode(e.dn||e.name);
    if(!namePh)return;
    // Distance normalized by length
    const dist=_levenshtein(targetPh,namePh);
    const score=dist/Math.max(targetPh.length,namePh.length,1);
    if(score<bestScore&&score<0.45){bestScore=score;best=e;}
  });
  if(best)return{match:best,confidence:bestScore<0.2?'high':bestScore<0.35?'medium':'low',spoken};
  return null;
}

function startVoiceInput(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const btn=document.getElementById('voice-btn');
  const input=document.getElementById('ac-input');
  if(!SR){toast(i18nCore.t('voice.unsupported'));return;}
  if(!window.isSecureContext){toast(i18nCore.t('voice.requiresHttps'));return;}
  if(voiceRecognition){
    try{voiceRecognition.stop();}catch{}
    voiceRecognition=null;
    btn?.classList.remove('listening');
    return;
  }
  voiceRecognition=new SR();
  voiceRecognition.lang=navigator.language||'en-US';
  voiceRecognition.continuous=false;
  voiceRecognition.interimResults=true; // show live feedback
  voiceRecognition.maxAlternatives=5;   // get multiple guesses
  btn?.classList.add('listening');
  if(input)input.placeholder=i18nCore.t('voice.listeningPlaceholder');
  toast(i18nCore.t('voice.listening'));
  let finalTranscript='';
  voiceRecognition.onresult=ev=>{
    let interim='';
    let alternatives=[];
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const r=ev.results[i];
      if(r.isFinal){
        finalTranscript=r[0].transcript;
        // Collect all alternatives for fuzzy matching
        for(let j=0;j<r.length;j++)alternatives.push(r[j].transcript);
      }else{
        interim+=r[0].transcript;
      }
    }
    // Live update input with interim text
    if(input&&interim){input.value=interim;}
    if(finalTranscript&&alternatives.length){
      // Try each alternative against Pokemon database, pick best match
      let bestMatch=null;
      for(const alt of alternatives){
        const m=fuzzyMatchPokemon(alt);
        if(m&&(!bestMatch||['exact','high'].includes(m.confidence))){
          bestMatch=m;
          if(m.confidence==='exact')break;
        }
      }
      if(bestMatch){
        if(input){
          input.value=bestMatch.match.dn;
          input.focus();
          acSearch(bestMatch.match.dn);
          // Auto-select if confidence is high
          if(['exact','high'].includes(bestMatch.confidence)){
            setTimeout(()=>{
              const sel=document.getElementById('add-pmon-sel');
              if(sel&&!sel.value){
                sel.value=bestMatch.match.name;
                closeAddAutocomplete();
              }
            },100);
          }
        }
        const confEmoji={exact:'✅',high:'✅',medium:'🤔',low:'❓',substring:'✅'}[bestMatch.confidence]||'';
        toast(`${confEmoji} ${i18nCore.t('voice.heardMatch',{heard:finalTranscript,name:bestMatch.match.dn})}`);
      }else if(input){
        input.value=finalTranscript;
        acSearch(finalTranscript);
        toast(i18nCore.t('voice.heardNoMatch',{heard:finalTranscript}));
      }
    }
  };
  voiceRecognition.onend=()=>{
    btn?.classList.remove('listening');
    voiceRecognition=null;
    if(input)input.placeholder=i18nCore.t('myList.searchPlaceholder');
  };
  voiceRecognition.onerror=ev=>{
    btn?.classList.remove('listening');
    voiceRecognition=null;
    if(input)input.placeholder=i18nCore.t('myList.searchPlaceholder');
    const msg={
      'not-allowed':i18nCore.t('voice.permissionDenied'),
      'no-speech':i18nCore.t('voice.noSpeech'),
      'audio-capture':i18nCore.t('voice.noMicrophone'),
      'network':i18nCore.t('voice.networkError'),
      'aborted':null,
      'service-not-allowed':i18nCore.t('voice.serviceBlocked')
    }[ev.error]||i18nCore.t('voice.error',{code:ev.error});
    if(msg)toast(msg);
  };
  try{voiceRecognition.start();}catch(e){
    btn?.classList.remove('listening');voiceRecognition=null;
    if(input)input.placeholder=i18nCore.t('myList.searchPlaceholder');
    toast(i18nCore.t('voice.startFailed'));
  }
}

// ── MULTI-SELECT FLAG FILTERS (#9) ────────────────────────────
function toggleFlagFilter(flag){
  browseFlagFilters[flag]=!browseFlagFilters[flag];
  const map={lucky:'fLucky',xxl:'fXxl',xxs:'fXxs',shiny:'fShiny'};
  const btn=document.querySelector(`.fbtn.${map[flag]}`);
  if(btn){
    btn.classList.toggle('on',browseFlagFilters[flag]);
    btn.setAttribute('aria-pressed',browseFlagFilters[flag]?'true':'false');
  }
  renderBrowse();
}
function entryMatchesFlagFilters(x){
  const f=browseFlagFilters;
  if(!f.lucky&&!f.xxl&&!f.xxs&&!f.shiny)return true;
  return(f.lucky&&x.lucky)||(f.xxl&&x.xxl)||(f.xxs&&x.xxs)||(f.shiny&&x.shiny);
}

// ── BACKUP REMINDER (#14) ─────────────────────────────────────
function recordBackup(){lsSet('pogoLastBackup',Date.now());renderBackupReminder();}
function renderBackupReminder(){
  const slot=document.getElementById('backup-reminder-slot');if(!slot)return;
  const ud=allData.users?.[cur]||{};
  if(!ud.admin){slot.innerHTML='';return;}
  const last=lsGet('pogoLastBackup',0);
  const dismissed=lsGet('pogoBackupDismissed',0);
  const since=Date.now()-last;
  if(since<BACKUP_REMINDER_INTERVAL||Date.now()-dismissed<BACKUP_REMINDER_INTERVAL){slot.innerHTML='';return;}
  const days=last?Math.floor(since/(24*60*60*1000)):'never';
  slot.innerHTML=`<div class="backup-reminder">
    <span>📦 Last backup: ${last?days+' days ago':'never'}. Recommended weekly to protect community data.</span>
    <div style="display:flex;gap:6px">
      <button class="backup-reminder-btn" onclick="if(exportData())recordBackup()">Backup now</button>
      <button class="backup-reminder-dismiss" onclick="lsSet('pogoBackupDismissed',Date.now());renderBackupReminder()" aria-label="Dismiss reminder">×</button>
    </div>
  </div>`;
}

// ── CONFLICT DETECTION (#13) ──────────────────────────────────
function checkConflict(type,username,localList,remoteList){
  // Compare keys. If both have same key with different values, that's a conflict.
  const conflicts=[];
  Object.keys(localList||{}).forEach(k=>{
    if(remoteList&&remoteList[k]!==undefined&&remoteList[k]!==localList[k]){
      conflicts.push({key:k,local:localList[k],remote:remoteList[k]});
    }
  });
  return conflicts;
}
function showConflictModal(conflicts,onLocal,onRemote,{savedOnly=false}={}){
  const previousFocus=document.activeElement;
  const canKeepDevice=typeof onLocal==='function'&&!savedOnly;
  const html=conflicts.slice(0,5).map(c=>`<div><strong>${escHtml(c.key)}</strong><br>${escHtml(i18nCore.t('conflict.onDevice'))}: <code>${escHtml(c.local)}</code><br>${escHtml(i18nCore.t('conflict.savedCopy'))}: <code>${escHtml(c.remote)}</code></div>`).join('');
  const more=conflicts.length>5?`<div style="margin-top:4px;color:var(--muted)">${escHtml(i18nCore.t('conflict.more',{count:conflicts.length-5}))}</div>`:'';
  const id='conflict-toast-'+Date.now();
  const keepDeviceButton=canKeepDevice?`<button class="bsave" id="${id}-local">${escHtml(i18nCore.t('conflict.keepDevice'))}</button>`:'';
  const el=document.createElement('div');
  el.className='conflict-notice';el.setAttribute('role','alertdialog');el.setAttribute('aria-labelledby',`${id}-title`);el.setAttribute('aria-describedby',`${id}-help`);
  el.innerHTML=`<h2 id="${id}-title">${escHtml(i18nCore.t('conflict.title',{count:conflicts.length}))}</h2>
    <p id="${id}-help">${escHtml(i18nCore.t(savedOnly?'accountSync.savedOnlyConflictHelp':'conflict.help'))}</p>
    <div class="conflict-preview">${html}${more}</div>
    <div class="conflict-actions">
      <button class="bghost" id="${id}-later">${escHtml(i18nCore.t('conflict.reviewLater'))}</button>
      <button class="bghost" id="${id}-remote">${escHtml(i18nCore.t('conflict.useSaved'))}</button>
      ${keepDeviceButton}
    </div>`;
  document.body.appendChild(el);
  const close=()=>{el.remove();previousFocus?.focus?.({preventScroll:true});};
  if(canKeepDevice)document.getElementById(`${id}-local`).onclick=()=>{onLocal();close();};
  document.getElementById(`${id}-remote`).onclick=()=>{onRemote();close();};
  document.getElementById(`${id}-later`).onclick=close;
  el.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
  document.getElementById(`${id}-later`)?.focus({preventScroll:true});
}

// ── IMPORT FROM SEARCH STRING ─────────────────────────────────
let importPri='M';
let importMatches=[];

function openImport(){
  importPri='M';importMatches=[];
  document.getElementById('import-str-input').value='';
  document.getElementById('import-err').textContent='';
  document.getElementById('import-warn-box').innerHTML='';
  document.getElementById('import-preview-list').innerHTML=`<div class="select-all-row" onclick="toggleSelectAll()"><input type="checkbox" id="select-all-chk" checked class="import-check"> ${escHtml(i18nCore.t('common.selectAll'))}</div>`;
  document.getElementById('import-step1').classList.add('active');
  document.getElementById('import-step2').classList.remove('active');
  document.querySelectorAll('.import-pri-btn').forEach(b=>{
    b.classList.remove('sel','H','M','L');
    if(b.dataset.pri==='M')b.classList.add('sel','M');
  });
  openModal('import-modal');
}

function setImportPri(p){
  importPri=p;
  document.querySelectorAll('.import-pri-btn').forEach(b=>{
    b.classList.remove('sel','H','M','L');
    if(b.dataset.pri===p)b.classList.add('sel',p);
  });
}

function parseImportString(){
  const raw=document.getElementById('import-str-input').value.trim();
  const err=document.getElementById('import-err');
  err.textContent='';
  if(!raw){err.textContent=i18nCore.t('import.required');return;}
  const srcArr=listSource(myListType);
  const dexToEntries={},dexHasRegional={};
  srcArr.forEach(e=>{if(e.no&&regionalFormTerm(e.name))dexHasRegional[e.no]=true;});
  srcArr.forEach(e=>{
    if(!e.no)return;
    const n=parseInt(e.no);if(isNaN(n))return;
    if(!dexToEntries[n])dexToEntries[n]=[];
    if(!dexToEntries[n].find(x=>x.name===e.name))
      dexToEntries[n].push({name:e.name,dn:pokemonDisplayName(e),no:e.no,region:e.region,maxType:maxTypeForEntry(e,myListType),regionTerm:dexRegionTerm(e,dexHasRegional)});
  });
  let working=raw;
  const preIdx=working.indexOf('!4*&');
  if(preIdx!==-1){
    const afterPre=working.slice(preIdx);
    const numStart=afterPre.search(/[0-9]/);
    if(numStart!==-1)working=afterPre.slice(numStart);
  }
  const tokens=working.split(/[,:;\n]+/).map(t=>t.trim()).filter(Boolean);
  const matched=[];const skipped=[];
  const regionalTermsSeen=new Set(),filterTermsSeen=new Set();
  tokens.forEach(token=>{
    let mod='',numStr=token;
    let regionTerm='',castformType='',formVariant='',maxType='';
    if(token.includes('&')){
      const parts=token.split('&').map(p=>p.trim()).filter(Boolean);
      numStr=parts[parts.length-1];
      const filters=parts.slice(0,-1).map(p=>p.toLowerCase());
      mod=modFromSearchFilters(filters);
      regionTerm=filters.find(p=>REGION_SEARCH_TERMS.has(p))||'';
      if(regionTerm)regionalTermsSeen.add(regionTerm);
      filters.forEach(f=>{if(f&&!/^\d+$/.test(f)&&!f.startsWith('!'))filterTermsSeen.add(f);});
      maxType=filters.find(p=>p==='dynamax'||p==='gigantamax')||'';
      castformType=castformTypeFromSearchFilters(filters);
      formVariant=formVariantFromSearchFilters(filters);
    }
    numStr=numStr.replace(/[^0-9]/g,'');
    const dex=parseInt(numStr);
    if(isNaN(dex)||dex<=0)return;
    let entries=dexToEntries[dex];
    if(regionTerm)entries=(entries||[]).filter(e=>e.regionTerm===regionTerm);
    if(maxType)entries=(entries||[]).filter(e=>MAX_TYPE_SEARCH[e.maxType]===maxType);
    if(castformType)entries=(entries||[]).filter(e=>castformTypeFilter(e)===castformType);
    if(formVariant)entries=(entries||[]).filter(e=>formVariantFilter(e)===formVariant);
    if(!entries||!entries.length){skipped.push(dex);return;}
    entries.forEach(e=>{
      if(matched.find(m=>m.name===e.name&&m.mod===mod))return;
      matched.push({...e,mod,dex,checked:true});
    });
  });
  if(!matched.length){err.textContent=i18nCore.t('import.noMatches');return;}
  importMatches=matched;
  const warnBox=document.getElementById('import-warn-box');
  const warnings=[];
  if(regionalTermsSeen.size){
    warnings.push(i18nCore.t('import.regionalWarning',{filters:[...regionalTermsSeen].join(', ')}));
  }else if(filterTermsSeen.size){
    warnings.push(i18nCore.t('import.filterWarning'));
  }
  if(skipped.length)warnings.push(i18nCore.t('import.skipped',{count:i18nCore.formatNumber(skipped.length),numbers:[...new Set(skipped)].join(', ')}));
  warnBox.innerHTML=warnings.map(w=>`<div class="import-warn">${escHtml(i18nCore.t('import.warning'))}: ${escHtml(w)}</div>`).join('');
  const existing=allData[myListType]?.[cur]||{};
  const rows=matched.map(function(e,i){
    const alreadyHas=!!existing[e.name];
    const modLabel=e.mod?' ('+e.mod+')':'';
    const spriteSrc=e.no?spriteUrl(e.no,e.name):'';
    const sprite=spriteSrc?('<img src="'+escAttr(spriteSrc)+'" class="import-sprite" width="28" height="28" alt="" title="'+escAttr(e.dn)+'" loading="lazy">'):"<div class=\"import-sprite-ph\"></div>";
    const already=alreadyHas?`<span style="font-size:10px;color:var(--muted)">${escHtml(i18nCore.t('import.alreadyListed'))}</span>`:'';
    return '<div class="import-preview-row '+(alreadyHas?'skip':'')+'" id="import-row-'+i+'">'+
      '<input type="checkbox" class="import-check" id="import-chk-'+i+'" '+(e.checked&&!alreadyHas?'checked':'')+' onchange="toggleImportRow('+i+')">'+
      sprite+
      '<span class="import-dex">#'+e.dex+'</span>'+
      '<span class="import-name">'+e.dn+modLabel+'</span>'+
      already+
      '</div>';
  }).join('');
  document.getElementById('import-preview-list').innerHTML=
    `<div class="select-all-row" onclick="toggleSelectAll()"><input type="checkbox" id="select-all-chk" checked class="import-check"> ${escHtml(i18nCore.t('import.selectAllCount',{count:i18nCore.formatNumber(matched.length)}))}</div>`+rows;
  importMatches.forEach(function(e,i){if(!!existing[e.name])importMatches[i].checked=false;});
  const checkedCount=importMatches.filter(function(m){return m.checked;}).length;
  document.getElementById('import-summary').textContent=i18nCore.t('import.summary',{found:i18nCore.formatNumber(matched.length),selected:i18nCore.formatNumber(checkedCount),priority:priLabel(importPri)});
  document.getElementById('import-confirm-btn').textContent=i18nCore.t('import.actionCount',{count:i18nCore.formatNumber(checkedCount)});
  document.getElementById('import-step1').classList.remove('active');
  document.getElementById('import-step2').classList.add('active');
}

function toggleImportRow(i){
  importMatches[i].checked=document.getElementById('import-chk-'+i).checked;
  updateImportCount();
}
function toggleSelectAll(){
  const chk=document.getElementById('select-all-chk');
  const newVal=chk.checked;
  importMatches.forEach(function(m,i){
    importMatches[i].checked=newVal;
    const el=document.getElementById('import-chk-'+i);
    if(el)el.checked=newVal;
  });
  updateImportCount();
}
function updateImportCount(){
  const count=importMatches.filter(function(m){return m.checked;}).length;
  document.getElementById('import-summary').textContent=i18nCore.t('import.selectedSummary',{selected:i18nCore.formatNumber(count),priority:priLabel(importPri)});
  document.getElementById('import-confirm-btn').textContent=i18nCore.t('import.actionCount',{count:i18nCore.formatNumber(count)});
}
function backToStep1(){
  document.getElementById('import-step2').classList.remove('active');
  document.getElementById('import-step1').classList.add('active');
}
async function confirmImport(){
  const toAdd=importMatches.filter(function(m){return m.checked;});
  if(!toAdd.length){toast(i18nCore.t('import.nothingSelected'));return;}
  const list=Object.assign({},allData[myListType]&&allData[myListType][cur]||{});
  toAdd.forEach(function(e){list[e.name]=importPri+(e.mod?'('+e.mod+')':'');});
  if(!await writeList(myListType,cur,list))return;
  closeModal('import-modal');
  toast(i18nCore.t('import.completed',{count:i18nCore.formatNumber(toAdd.length),priority:priLabel(importPri)}));
}

// ── GLOBAL KEYBOARD SHORTCUTS (#17) ───────────────────────────
function isTypingTarget(t){
  if(!t)return false;
  const tag=t.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return true;
  if(t.isContentEditable)return true;
  return false;
}
function anyOpenModal(){
  return!!document.querySelector('.ov.open');
}
function _focusActiveTabSearch(){
  const map={find:'find-trainer-input',mylist:'mylist-filter',have:'have-filter',schedule:''};
  // Detect active tab
  const active=document.querySelector('.tab.active')?.dataset.tab;
  // Special case: have tab has subtab-specific filters
  if(active==='have'){
    const haveQ=document.getElementById('have-q')||document.getElementById('have-browse-q');
    haveQ?.focus();haveQ?.select?.();return;
  }
  const id=map[active];
  if(id){const el=document.getElementById(id);el?.focus();el?.select?.();}
}
function _handleGlobalShortcut(ev){
  if(ev.metaKey||ev.ctrlKey||ev.altKey)return;
  if(isTypingTarget(ev.target))return;
  // ? opens cheat sheet (Shift+/ on US layout)
  if(ev.key==='?'){
    if(anyOpenModal())return;
    ev.preventDefault();
    openModal('shortcuts-modal');
    return;
  }
  if(anyOpenModal())return; // other shortcuts disabled while modal open
  // Only handle inside the main app, not on login/share view
  if(document.getElementById('app')?.style.display==='none')return;
  switch(ev.key.toLowerCase()){
    case'b':switchTab('find');ev.preventDefault();break;
    case'm':switchTab('mylist');ev.preventDefault();break;
    case's':switchTab('mylist');setTimeout(()=>document.getElementById('my-strings-out')?.scrollIntoView({behavior:'smooth'}),0);ev.preventDefault();break;
    case'h':case'i':switchTab('have');ev.preventDefault();break;
    case'c':switchTab('schedule');ev.preventDefault();break;
    case'n':
      switchTab('mylist');
      setTimeout(()=>document.getElementById('ac-input')?.focus(),60);
      ev.preventDefault();break;
    case'/':
      ev.preventDefault();
      _focusActiveTabSearch();
      break;
  }
}

// ── FIRST-RUN TOUR (#25) ──────────────────────────────────────
const TOUR_STEPS=[
  {title:'👋 Welcome to PoGo Trades',body:`<p>Build your trade list, find a trainer, and compare your published lists. Let's take a quick look around.</p>`},
  {title:'📋 My List',body:`<p>This is your wishlist. Tap <strong>+ Add</strong>, type a Pokémon, set priority and flags.</p><ul><li>Add variant details for gender or costume when needed</li><li>Drag rows to reorder, or bulk-select to update many at once</li><li>Hit ✨ for shiny-only, ⚡ for Lucky Dex, XXL/XXS for size hunting</li></ul><p>Your list powers search strings and comparisons with trainers whose published lists you open.</p>`,tab:'mylist'},
  {title:'📤 Search strings',body:`<p>Auto-generated Pokémon GO search strings live at the bottom of My List, split by priority and flag. Copy → paste into the in-game search bar.</p><p>They update automatically whenever you change My List — no manual maintenance needed.</p>`,tab:'mylist'},
  {title:'🔍 Find Trainer',body:`<p>Search by trainer name, open a published list, and compare it with your own list. Favorites and recent trainers make repeat visits faster.</p><p>Only the selected trainer's published share is loaded; private trainer records are never used as fallback.</p>`,tab:'find'},
  {title:'📅 Events',body:`<p>Browse upcoming Pokémon GO events by type and timing. Event details open from their source page.</p>`,tab:'schedule'},
  {title:'🎒 Legacy Inventory',body:`<p>Your existing Inventory is preserved as a private, read-only archive. You can review it and export a CSV, but new Inventory editing is retired.</p>`,tab:'have'},
  {title:'🚀 First steps',body:`<p>Recommended order for a new account:</p><ol style="padding-left:22px;margin:6px 0 10px"><li>Build <strong>My List</strong> with priorities and flags</li><li>Copy your Pokémon GO <strong>search strings</strong></li><li>Use <strong>Find Trainer</strong> to open and compare a published list</li><li>Review profile and sharing choices in <strong>Settings</strong></li></ol><p>Press <kbd>?</kbd> any time for keyboard shortcuts, or <kbd>n</kbd> to jump straight to adding a Pokémon.</p>`}
];
let _tourIdx=0;
function startTour(){
  _tourIdx=0;
  openModal('tour-modal');
  renderTourStep();
}
function renderTourStep(){
  const s=TOUR_STEPS[_tourIdx];if(!s)return;
  document.getElementById('tour-title').textContent=s.title;
  document.getElementById('tour-body').innerHTML=s.body;
  const prog=document.getElementById('tour-progress');
  if(prog)prog.innerHTML=TOUR_STEPS.map((_,i)=>`<div class="dot${i<=_tourIdx?' done':''}"></div>`).join('');
  const prev=document.getElementById('tour-prev-btn');
  const next=document.getElementById('tour-next-btn');
  if(prev)prev.style.visibility=_tourIdx===0?'hidden':'visible';
  if(next)next.textContent=_tourIdx===TOUR_STEPS.length-1?'Finish':'Next →';
  if(s.tab){try{switchTab(s.tab);}catch{}}
}
function tourNext(){
  if(_tourIdx>=TOUR_STEPS.length-1){finishTour();return;}
  _tourIdx++;renderTourStep();
}
function tourPrev(){
  if(_tourIdx<=0)return;
  _tourIdx--;renderTourStep();
}
function finishTour(){
  lsSet('pogoTourSeen',Date.now());
  closeModal('tour-modal');
  toast('🎉 You\'re ready! Press ? any time for shortcuts.');
}
function skipTour(){
  lsSet('pogoTourSeen',Date.now());
  closeModal('tour-modal');
}
function maybeStartTour(){
  if(TRAINER_FIRST_INTERIM_ENABLED)return;
  if(lsGet('pogoTourSeen',null))return;
  // Delay so the app finishes rendering first
  setTimeout(()=>{if(!anyOpenModal())startTour();},800);
}

// ── EXPOSE ────────────────────────────────────────────────────
Object.assign(window,{
  openImport,setImportPri,parseImportString,toggleImportRow,toggleSelectAll,backToStep1,confirmImport,
  setFilter,setBrowseList,setMyList,setStaleFilter,switchTab,openLegacyInventoryTool,clearTrainerSearch,focusTrainerSearch,
  doLogin,logout,connectFirebase,skipFirebase,openLoginHealthCheck,runLoginHealthCheck,clearLoginLocalCache,selectLoginUserByIndex,
  addEntry,addToTrayFromAc,removeFromAddTray,clearAddTray,confirmAddTray,renderAddTray,setPri,setNotes,setLucky,setXxl,setXxs,removeEntry,doUndo,copyStr,
  exportMyListImage,
  dragStart,dragOver,dragDrop,dragEnd,
  addUser,openReset,confirmReset,repairAccount,repairLoginDirectory,repairLoginDirectories,toggleAdmin,setAdminSection,exportData,
  saveProfile,openModal,closeModal,renderStrings,renderBrowse,setStrList,
  showRequestForm,hideRequestForm,submitRequest,approveRequest,copyApprovedLogin,denyRequest,
  acSearch,acSelect,acKeydown,formatFc,toggleStrUser,toggleComboStrings,renderMyList,
  // New enhancements
  toggleTheme,toggleBulkMode,toggleBulkSelection,bulkSetPri,bulkToggleFlag,bulkDelete,
  // Sync health UI (banner + pill)
  reconnectAuth,dismissSyncBanner,openSyncDetail,showSyncBanner,hideSyncBanner,
  setOwnerCommunityPreview,
  startVoiceInput,toggleFlagFilter,recordBackup,renderBackupReminder,confirmRemove,lsSet,
  // Latest batch
  triggerInstall,openWhatsNew,closeWhatsNew,updateAvatarPreview,changeInterfaceLocale,
  toggleExportMenu,closeExportMenu,exportMyListMarkdown,exportMyListCSV,copyShareLink,
  exitShareView,renderShareView,setAddPri,toggleAddAdvanced,trySpriteFallback,validateSpriteLoad,
  openAvatarPicker,closeAvatarPicker,renderAvatarPicker,avatarPickerKeydown,selectAvatarOption,clearAvatarSelection,
  toggleReorderMode,movePriority,moveMyListEntry,myListPointerStart,myListPointerMove,myListPointerEnd,myListPointerCancel,
  // Latest batch
  openDiffModal,closeDiffModal,setDiffListType,copyDiffSearch,openTradeMatchModal,closeTradeMatchModal,toggleTradeMatchSection,editMyListFromTradeMatch,returnToTradeComparison,
  openSafeTransferModal,toggleSafeTransferTrainer,setAllSafeTransferTrainers,saveSafeTransferAsDefault,copySafeTransferString,toggleSafeTransferPrefilter,
  openAddAllVariantsModal,closeAddAllVariants,confirmAddAllVariants,
  openAddShownResultsModal,closeAddShownResults,confirmAddShownResults,
  selectWallpaper,applyWallpaper,
  // Inventory / Have
  setHaveView,setHaveSubTab,toggleHaveMatchOnly,haveAcSearch,haveAcSelect,haveAcKeydown,
  addInventoryEntry,updateInventoryQty,setInventoryQty,toggleInventoryMirror,cycleInventoryMode,cycleInventoryGender,setHaveAddMode,setHaveAddGender,editInventoryNote,removeInventoryEntry,
  toggleHaveBulkMode,toggleHaveBulkSelection,bulkHaveSetMode,bulkHaveAdjustQty,bulkHaveDelete,
  renderMyHave,renderHaveBrowse,openOfferModal,closeOfferModal,copyOfferMessage,
  exportLegacyInventoryCsv,openTrainerPublicShare,
  toggleOfferPickChip,markOfferMessageEdited,refreshOfferMessage,
  // Offer history
  submitOffer,submitOfferAction,withdrawOffer,markOfferTraded,
  // Per-item trade acceptance
  openAcceptModal,closeAcceptModal,adjustAcceptQty,clampAcceptQty,maxAcceptQty,confirmAcceptTrade,
  openIncomingOffersModal,closeIncomingOffersModal,
  // Update checker
  reloadForUpdate,checkForUpdate,
  // Schedule
  navigateSchedWeek,navigateSchedToday,selectSchedDay,openScheduleModal,closeScheduleModal,
  selectSchedType,adjustSchedRegularCount,submitScheduledTrade,markTradeComplete,cancelScheduledTrade,setManualBonus,
  scheduleReservedTrade,markReservedTraded,cancelReservedTrade,
  // Shiny + tour + shortcuts
  setShiny,startTour,tourNext,tourPrev,skipTour,finishTour,
  // Special Trade Board
  openSpecialTradeBoard,specialAcSearch,specialAcSelect,specialAcKeydown,
  addSpecialEntry,removeSpecialEntry,toggleSpecialFlag,
  clearSpecialBoard,exportSpecialBoardImage,
  // Quick-add bulk picker for the Special Trade Board
  openQuickAdd,closeQuickAdd,filterQuickAdd,toggleQuickAddPick,qaSelectAll,commitQuickAdd
});

function afterFirstPaint(task){
  let started=false;
  const run=()=>{if(started)return;started=true;task();};
  const fallback=setTimeout(run,250);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(fallback);run();}));
}
function startBackgroundStartup(){
  initUpdateCheck();
  if('serviceWorker'in navigator&&location.protocol!=='file:'){
    const registration=window.__pogoServiceWorkerRegistration||navigator.serviceWorker.register(`./sw.js?v=${window.__POGO_RELEASE_ID}`);
    registration.then(reg=>{
      reg.addEventListener('updatefound',()=>{
        const nw=reg.installing;if(!nw)return;
        nw.addEventListener('statechange',()=>{
          if(nw.state==='installed'&&navigator.serviceWorker.controller){
            try{checkForUpdate();}catch{}
          }
        });
      });
    }).catch(e=>console.warn('SW registration failed',e));
  }
}
async function startFirebaseStartup(shareReq){
  try{
    await loadFirebaseSdk();
    setupFirebase(FIREBASE_URL);
    const restoredUser=await waitForAuthState();
    if(!restoredUser&&!shareReq)showLogin({preserveCredentials:true});
    try{
      await ensureFirebaseDataProtection();
    }catch(error){
      console.warn('Protected Firebase startup unavailable',error);
      setSyncStatus('offline');
      if(shareReq)renderUnavailableShareView(shareReq.username,i18nCore.t('share.offlineLoadFailed'));
      else showBootError(error);
      return;
    }
    window.__pogoStartup.protectedReadyAt=performance.now();
    try{performance.mark('pogo:protected-ready')}catch{}
    startListener();
    flushSyncQueue();
    if(shareReq)await openShareViewFromRequest(shareReq);
    else if(restoredUser&&auth?.currentUser?.uid===restoredUser.uid&&currentAuthUid===restoredUser.uid&&cur){
      if(document.getElementById('app')?.style.display==='none')showApp();
    }else showLogin();
  }catch(e){
    console.warn('Firebase SDK failed to load',e);
    setSyncStatus('offline');
    showBootError(e);
  }finally{
    window.__pogoStartup.firebaseStartupSettledAt=performance.now();
    try{performance.mark('pogo:firebase-startup-settled')}catch{}
  }
}

// ── BOOT ──────────────────────────────────────────────────────
function bootPogoApp(){
  if(window.__pogoBootComplete)return;
  try{
  renderInterimProductLabels();
  // The neutral pre-auth shell is already visible. Keep synchronous work here
  // limited to presentation and interaction wiring.
  initTheme();
  // React to system theme changes when in auto mode
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{
    if(lsGet('pogoTheme','auto')==='auto')applyTheme('auto');
  });
  // Bump last-seen + check for updates when user returns to the tab
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){bumpLastSeen();checkForUpdate();}
  });
  window.addEventListener('focus',()=>{bumpLastSeen();checkForUpdate();});
  // Mobile keyboard: Enter on PIN = submit login
  document.getElementById('login-pin').addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();doLogin();}
  });
  // Datalist pick or Enter on username field → focus PIN
  const loginUserInput=document.getElementById('login-user');
  loginUserInput?.addEventListener('change',()=>{
    setTimeout(()=>document.getElementById('login-pin').focus(),50);
  });
  loginUserInput?.addEventListener('input',()=>{loginUserFocusIdx=0;renderLoginUserSuggestions(true);});
  loginUserInput?.addEventListener('focus',()=>{loginUserFocusIdx=0;renderLoginUserSuggestions(true);});
  loginUserInput?.addEventListener('blur',()=>setTimeout(hideLoginUserSuggestions,120));
  loginUserInput?.addEventListener('keydown',loginUserKeydown);
  document.addEventListener('pointerdown',e=>{
    if(!e.target.closest?.('.login-user-field'))hideLoginUserSuggestions();
    if(!e.target.closest?.('.account-control'))closeAccountMenu(false);
  });
      document.querySelectorAll('.ov').forEach(el=>el.addEventListener('click',e=>{
        if(e.target===el){if(el.id==='trainer-organizer-modal')closeTrainerOrganizer();else closeModal(el.id);}
      }));
  document.addEventListener('keydown',e=>{
    const popover=document.getElementById('account-popover');
    if(e.key==='Escape'&&popover&&!popover.hidden){e.preventDefault();closeAccountMenu();}
  });
  window.addEventListener('popstate',syncSettingsRoute);
  window.addEventListener('hashchange',syncSettingsRoute);
  matchMedia(SETTINGS_DESKTOP_QUERY).addEventListener('change',()=>{
    if(document.getElementById('settings-modal')?.classList.contains('open'))configureSettingsPanel(_settingsContext);
  });
  // Global keyboard shortcuts (#17)
  document.addEventListener('keydown',_handleGlobalShortcut);
  // Hardcoded Firebase URL — config screen never shown
  lsSet('fbUrl',FIREBASE_URL);
  syncFromLocal();
  showSessionStorageNotices();
  // Check for read-only share view
  const shareReq=checkShareViewParam();
  if(!window.__pogoShellReady)showPreAuth();
  if(parseSettingsRoute().matches)setTimeout(()=>syncSettingsRoute({captureScroll:false}),0);
  setSyncStatus('syncing');
  afterFirstPaint(()=>{
    startBackgroundStartup();
    startFirebaseStartup(shareReq);
  });
  window.__pogoBootComplete=true;
  clearTimeout(window.__pogoBootWatch);
  try{performance.mark('pogo:boot-wired')}catch{}
  setTimeout(()=>{if(!hasVisibleScreen())showBootError('No visible screen after startup');},2500);
  }catch(e){
    showBootError(e);
  }
}
window.__pogoAppReadyPromise=Promise.resolve().then(()=>{
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootPogoApp,{once:true});
  else bootPogoApp();
  return true;
});
