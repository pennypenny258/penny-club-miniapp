'use strict';

const target = require('./runtime-target');
const { resolveRuntime } = require('./runtime-profiles');

module.exports = resolveRuntime(target);
