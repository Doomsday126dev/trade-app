#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const baselineFile=path.join(root,'tests/firebase/database.rules.narrow-read.json');
const outputFile=path.join(root,'tests/firebase/database.rules.share-visibility.json');
const prior=JSON.parse(fs.readFileSync(outputFile,'utf8')).rules;
const preferenceRootsSha=crypto.createHash('sha256').update(JSON.stringify({trainerPreferencesConfig:prior.trainerPreferencesConfig,userPreferences:prior.userPreferences})).digest('hex');
if(preferenceRootsSha!=='0a9ac481a3a73a3918929624bd58d089be9a3744314086f49bd97a6acffc2dae')throw new Error('Reviewed preference rules changed; update only after emulator review');
const candidate=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
const rules=candidate.rules;
const admin="root.child('admins').child(auth.uid).val() === true";
const visibilityGate="root.child('shareVisibilityConfig').child('writesEnabled').val() === true";

rules.accounts={"$uid":{
  ".read":`auth != null && (auth.uid === $uid || ${admin})`,
  ".write":`auth != null && ${visibilityGate} && ${admin}`,
  ".validate":"newData.hasChildren(['trainerName', 'normalizedTrainerName']) && newData.child('trainerName').isString() && newData.child('trainerName').val().length > 0 && newData.child('trainerName').val().length <= 64 && newData.child('normalizedTrainerName').isString() && newData.child('normalizedTrainerName').val().length > 0 && newData.child('normalizedTrainerName').val().length <= 64",
  "$other":{".validate":"$other === 'trainerName' || $other === 'normalizedTrainerName'"}
}};
rules.shareVisibilityConfig={
  ".read":`auth != null && ${admin}`,
  ".write":`auth != null && ${admin}`,
  "writesEnabled":{".validate":"newData.isBoolean()"},
  "legacyCompatEnabled":{".validate":"newData.isBoolean()"},
  "$other":{".validate":false}
};
rules.shareVisibility={"$ownerUid":{
  ".read":`auth != null && (auth.uid === $ownerUid || ${admin})`,
  ".write":`auth != null && ${visibilityGate} && (auth.uid === $ownerUid || ${admin})`,
  ".validate":"newData.hasChildren(['mode', 'updatedAt']) && (newData.child('mode').val() === 'public' || newData.child('mode').val() === 'approved_viewers' || newData.child('mode').val() === 'private') && newData.child('updatedAt').isNumber()",
  "mode":{".read":"auth != null"},
  "$other":{".validate":"$other === 'mode' || $other === 'updatedAt'"}
}};
rules.shareAccess={"$ownerUid":{
  ".read":`auth != null && (auth.uid === $ownerUid || ${admin})`,
  "$viewerUid":{
    ".write":`auth != null && ${visibilityGate} && (auth.uid === $ownerUid || ${admin})`,
    ".validate":"newData.val() === true || !newData.exists()"
  }
}};
rules.shareDirectory={"$normalizedTrainerName":{
  ".read":true,
  ".write":`auth != null && ${visibilityGate} && (newData.child('ownerUid').val() === auth.uid || ${admin})`,
  ".validate":"newData.hasChildren(['ownerUid', 'trainerName', 'state']) && newData.child('ownerUid').isString() && newData.child('ownerUid').val().length > 0 && newData.child('trainerName').isString() && newData.child('trainerName').val().length > 0 && newData.child('trainerName').val().length <= 64 && (newData.child('state').val() === 'published' || newData.child('state').val() === 'unpublished') && root.child('accounts').child(newData.child('ownerUid').val()).child('normalizedTrainerName').val() === $normalizedTrainerName",
  "$other":{".validate":"$other === 'ownerUid' || $other === 'trainerName' || $other === 'state'"}
}};
rules.trainerShares={"$ownerUid":{
  ".read":`root.child('shareVisibility').child($ownerUid).child('mode').val() === 'public' || (auth != null && (auth.uid === $ownerUid || ${admin} || (root.child('shareVisibility').child($ownerUid).child('mode').val() === 'approved_viewers' && root.child('shareAccess').child($ownerUid).child(auth.uid).val() === true)))`,
  ".write":`auth != null && ${visibilityGate} && (auth.uid === $ownerUid || ${admin})`,
  ".validate":"newData.hasChildren(['schemaVersion', 'shareVersion', 'trainerName', 'profile', 'publishedListTypes', 'publishedAt', 'updatedAt']) && newData.child('schemaVersion').val() === 1 && newData.child('shareVersion').isNumber() && newData.child('shareVersion').val() >= 1 && (!data.exists() || newData.child('shareVersion').val() > data.child('shareVersion').val()) && newData.child('trainerName').isString() && newData.child('trainerName').val().length > 0 && newData.child('trainerName').val().length <= 64 && newData.child('profile').exists() && newData.child('publishedListTypes').hasChildren(['wishlist', 'dynamax', 'gmax', 'costumes']) && newData.child('publishedListTypes').child('wishlist').val() === true && newData.child('publishedListTypes').child('dynamax').val() === true && newData.child('publishedListTypes').child('gmax').val() === true && newData.child('publishedListTypes').child('costumes').val() === true && newData.child('publishedAt').isNumber() && newData.child('updatedAt').isNumber() && (!data.exists() || newData.child('publishedAt').val() === data.child('publishedAt').val())",
  "profile":{"friendCode":{".validate":"newData.isString() && newData.val().length <= 32"},"bio":{".validate":"newData.isString() && newData.val().length <= 120"},"discord":{".validate":"newData.isString() && newData.val().length <= 40"},"avatarPokemon":{".validate":"newData.isString() && newData.val().length <= 80"},"$other":{".validate":false}},
  "lists":{"$listType":{".validate":"$listType === 'wishlist' || $listType === 'dynamax' || $listType === 'gmax' || $listType === 'costumes'","$pokemonKey":{".validate":"newData.isString() || newData.child('p').isString()","p":{".validate":"newData.val() === 'H' || newData.val() === 'M' || newData.val() === 'L'"},"mod":{".validate":"newData.isString() && newData.val().length <= 200"},"lucky":{".validate":"newData.isBoolean()"},"shiny":{".validate":"newData.isBoolean()"},"xxl":{".validate":"newData.isBoolean()"},"xxs":{".validate":"newData.isBoolean()"},"$other":{".validate":false}}}},
  "publishedListTypes":{"$listType":{".validate":"($listType === 'wishlist' || $listType === 'dynamax' || $listType === 'gmax' || $listType === 'costumes') && newData.val() === true"}},
  "$other":{".validate":"$other === 'schemaVersion' || $other === 'shareVersion' || $other === 'trainerName' || $other === 'publishedAt' || $other === 'updatedAt' || $other === 'lists'"}
}};
rules.legacyShareOwners={"$username":{
  ".read":`auth != null && (data.val() === auth.uid || ${admin})`,
  ".write":`auth != null && ${visibilityGate} && ${admin}`,
  ".validate":"newData.isString() && newData.val().length > 0"
}};

// Preference roots are authored and emulator-reviewed in the additive fixture.
// Rebase preserves those roots while replacing every live root from baseline.
rules.trainerPreferencesConfig=prior.trainerPreferencesConfig;
rules.userPreferences=prior.userPreferences;
rules.shareGroupAccess={"$ownerUid":{".read":`auth != null && (auth.uid === $ownerUid || ${admin})`,".write":false}};
rules.groups={".read":false,".write":false};

fs.writeFileSync(outputFile,`${JSON.stringify(candidate,null,2)}\n`);
console.log(path.relative(root,outputFile));
