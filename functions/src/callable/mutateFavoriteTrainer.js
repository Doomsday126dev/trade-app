'use strict';
const { createCallableHandler } = require('./common');
module.exports = ({ operations, logger, env, makePublicError }) => createCallableHandler({ operation: 'mutateFavoriteTrainer', invoke: operations.mutateFavoriteTrainer, logger, env, makePublicError });
