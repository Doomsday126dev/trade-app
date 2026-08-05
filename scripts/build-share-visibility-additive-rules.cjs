#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const baselineFile=path.join(root,'tests/firebase/database.rules.narrow-read.json');
const outputFile=path.join(root,'tests/firebase/database.rules.share-visibility.json');
const candidate=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
const rules=candidate.rules;
const admin="root.child('admins').child(auth.uid).val() === true";
const visibilityGate="root.child('shareVisibilityConfig').child('writesEnabled').val() === true";
const preferencesGate="root.child('trainerPreferencesConfig').child('writesEnabled').val() === true";

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
rules.trainerPreferencesConfig={
  ".read":`auth != null && ${admin}`,
  ".write":`auth != null && ${admin}`,
  "writesEnabled":{".validate":"newData.isBoolean()"},
  "$other":{".validate":false}
};
rules.userPreferences={"$viewerUid":{
  ".read":`auth != null && (auth.uid === $viewerUid || ${admin})`,
  ".write":`auth != null && ${preferencesGate} && (auth.uid === $viewerUid || ${admin})`,
  "favoriteTrainers":{"$ownerUid":{".validate":"newData.hasChildren(['trainerName', 'addedAt']) && newData.child('trainerName').isString() && newData.child('trainerName').val().length > 0 && newData.child('trainerName').val().length <= 64 && newData.child('addedAt').isNumber() && (!data.exists() || newData.child('addedAt').val() === data.child('addedAt').val())","note":{".validate":"newData.isString() && newData.val().length <= 240"},"tagIds":{"$tagId":{".validate":"newData.val() === true && root.child('userPreferences').child($viewerUid).child('trainerTags').child($tagId).child('active').val() === true"}},"$other":{".validate":"$other === 'trainerName' || $other === 'addedAt'"}}},
  "trainerTags":{"$tagId":{".validate":"newData.hasChildren(['label', 'normalizedLabel', 'labelKey', 'active', 'createdAt', 'updatedAt']) && newData.child('label').isString() && newData.child('label').val().length > 0 && newData.child('label').val().length <= 160 && newData.child('normalizedLabel').isString() && newData.child('normalizedLabel').val().length > 0 && newData.child('normalizedLabel').val().length <= 160 && newData.child('labelKey').isString() && newData.child('labelKey').val().length > 0 && newData.child('labelKey').val().length <= 500 && newData.child('active').isBoolean() && newData.child('createdAt').isNumber() && newData.child('updatedAt').isNumber() && (!data.exists() || newData.child('createdAt').val() === data.child('createdAt').val()) && root.child('userPreferences').child($viewerUid).child('trainerTagLabels').child(newData.child('labelKey').val()).val() === $tagId","$other":{".validate":"$other === 'label' || $other === 'normalizedLabel' || $other === 'labelKey' || $other === 'active' || $other === 'createdAt' || $other === 'updatedAt'"}}},
  "trainerTagLabels":{"$labelKey":{".validate":"!newData.exists() || (newData.isString() && (!data.exists() || newData.val() === data.val()))"}},
  "recentTrainerSlots":{"$slot":{".validate":"($slot === '00' || $slot === '01' || $slot === '02' || $slot === '03' || $slot === '04' || $slot === '05' || $slot === '06' || $slot === '07' || $slot === '08' || $slot === '09' || $slot === '10' || $slot === '11' || $slot === '12' || $slot === '13' || $slot === '14' || $slot === '15' || $slot === '16' || $slot === '17' || $slot === '18' || $slot === '19' || $slot === '20' || $slot === '21' || $slot === '22' || $slot === '23' || $slot === '24' || $slot === '25' || $slot === '26' || $slot === '27' || $slot === '28' || $slot === '29') && newData.hasChildren(['ownerUid', 'trainerName', 'lastOpenedAt']) && newData.child('ownerUid').isString() && newData.child('ownerUid').val().length > 0 && newData.child('trainerName').isString() && newData.child('trainerName').val().length > 0 && newData.child('trainerName').val().length <= 64 && newData.child('lastOpenedAt').isNumber()","$other":{".validate":"$other === 'ownerUid' || $other === 'trainerName' || $other === 'lastOpenedAt'"}}},
  "trainerHistory":{"$ownerUid":{".validate":"newData.hasChildren(['lastSeenShareVersion', 'lastSeenUpdatedAt', 'lastSeenFingerprint', 'entryCount']) && newData.child('lastSeenShareVersion').isNumber() && newData.child('lastSeenShareVersion').val() >= 1 && (!data.exists() || newData.child('lastSeenShareVersion').val() >= data.child('lastSeenShareVersion').val()) && (!data.exists() || newData.child('lastSeenShareVersion').val() !== data.child('lastSeenShareVersion').val() || newData.child('lastSeenFingerprint').val() === data.child('lastSeenFingerprint').val()) && newData.child('lastSeenUpdatedAt').isNumber() && (!data.exists() || newData.child('lastSeenUpdatedAt').val() >= data.child('lastSeenUpdatedAt').val()) && newData.child('lastSeenFingerprint').isString() && newData.child('lastSeenFingerprint').val().length > 0 && newData.child('lastSeenFingerprint').val().length <= 128 && newData.child('entryCount').isNumber() && newData.child('entryCount').val() >= 0 && newData.child('entryCount').val() <= 1500","lastSeenSnapshot":{"$entryId":{".validate":"newData.hasChildren(['category', 'fingerprint']) && (newData.child('category').val() === 'wishlist' || newData.child('category').val() === 'dynamax' || newData.child('category').val() === 'gmax' || newData.child('category').val() === 'costumes') && newData.child('fingerprint').isString() && newData.child('fingerprint').val().length > 0 && newData.child('fingerprint').val().length <= 128","$other":{".validate":"$other === 'category' || $other === 'fingerprint'"}}},"$other":{".validate":"$other === 'lastSeenShareVersion' || $other === 'lastSeenUpdatedAt' || $other === 'lastSeenFingerprint' || $other === 'entryCount'"}}},
  "$other":{".validate":false}
}};
rules.shareGroupAccess={"$ownerUid":{".read":`auth != null && (auth.uid === $ownerUid || ${admin})`,".write":false}};
rules.groups={".read":false,".write":false};

fs.writeFileSync(outputFile,`${JSON.stringify(candidate,null,2)}\n`);
console.log(path.relative(root,outputFile));
