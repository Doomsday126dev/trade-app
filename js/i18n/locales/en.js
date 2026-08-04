(function(global){
  const root=global.PogoLocales=global.PogoLocales||{};
  root.en=Object.freeze({
    'data.loading':'Loading {resource}…',
    'data.empty':'No {resource} found.',
    'data.readError':'Could not load {resource}. Try again.',
    'data.ownedReadUnavailable':'Some account data could not be refreshed. Your verified offline cache remains available.',
    'storage.pendingChangesDiscarded':'Pending offline changes were discarded because their account ownership could not be verified.',
    'storage.cacheReset':'Cached session data was reset because its account ownership could not be verified.',
    'storage.sessionOwnershipMismatch':'This saved session does not match the authenticated account. Sign out and sign in again.',
    'storage.offlineRecoveryUnavailable':'Offline recovery is unavailable until this account is securely verified again.'
  });
})(window);
