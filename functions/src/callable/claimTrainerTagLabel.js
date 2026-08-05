'use strict';
const { createCallableHandler } = require('./common');
module.exports = ({ operations, logger, env, makePublicError }) => createCallableHandler({ operation: 'claimTrainerTagLabel', invoke: operations.claimTrainerTagLabel, logger, env, makePublicError });
