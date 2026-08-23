/**
 * Stands in for the DMK, whose per-file CJS output does `require("uuid")` at 4 call sites.
 * Used to check that Bare's import map reaches a CJS subgraph, not just the module it is
 * attached to.
 */
const { v4 } = require('uuid')

module.exports = { id: () => v4() }
