'use strict';
const { createCallableHandler } = require('./common');
module.exports = ({ operations, logger, env, makePublicError }) => createCallableHandler({ operation: 'setApprovedViewer', invoke: operations.setApprovedViewer, logger, env, makePublicError });
