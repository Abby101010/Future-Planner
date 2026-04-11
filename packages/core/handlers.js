"use strict";
// Thin shim so `@northstar/core/handlers` resolves under classic Node
// module resolution (used by the server's tsconfig). Forwards to the
// compiled server-only handler barrel in dist/.
module.exports = require("./dist/handlers.js");
