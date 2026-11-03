// marker writer — keeps a build step present so deploy metadata lands in the publish dir
const fs = require('fs');
fs.writeFileSync('probe-out.json', JSON.stringify({ build_marker: true, t: new Date().toISOString() }));
console.log('marker written');
