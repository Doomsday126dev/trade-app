'use strict';
const { createCallableHandler } = require('./common');
module.exports = ({ operations, logger, env, makePublicError }) => createCallableHandler({ operation: 'reserveTrainerHandle', invoke: operations.reserveTrainerHandle, logger, env, makePublicError });
