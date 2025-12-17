const entityAudit = require('./modules/entityAudit');

console.log("Testing Wikipedia Audit for 'deadmau5'...");
entityAudit.auditWikipedia('deadmau5')
    .then(result => {
        console.log("Result:", JSON.stringify(result, null, 2));
    })
    .catch(err => {
        console.error("Error:", err);
    });
