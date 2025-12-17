require('dotenv').config();
const entityAudit = require('./modules/entityAudit');

console.log("Testing Discogs Audit for 'deadmau5'...");
entityAudit.auditDiscogs('deadmau5')
    .then(result => {
        console.log("Result:", JSON.stringify(result, null, 2));
    })
    .catch(err => {
        console.error("Error:", err);
    });
