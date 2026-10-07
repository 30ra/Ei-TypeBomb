const { writeFileSync } = require('node:fs');

// Including ../shared in tsc preserves the repository layout under dist.
// Keep the existing compiled entry usable and replace any stale previous build.
writeFileSync('dist/index.js', 'require("./server/src/index.js");\n');
