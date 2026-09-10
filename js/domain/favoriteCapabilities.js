(function(global){
  'use strict';
  const root=global.PogoDomain=global.PogoDomain||{};
  // Activation requires the separately approved backend/Rules canary and a
  // guarded client release. The picker additionally requires visual approval.
  root.favoriteCapabilities=Object.freeze({resolverEnabled:false,pickerEnabled:false});
})(window);
