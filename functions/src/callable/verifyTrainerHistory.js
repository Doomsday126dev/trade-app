'use strict';
const { createCallableHandler } = require('./common');
module.exports = ({ operations, logger, env, makePublicError }) => createCallableHandler({ operation: 'verifyTrainerHistory', invoke: operations.verifyTrainerHistory, logger, env, makePublicError });
