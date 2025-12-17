require('dotenv').config();
const { auditGoogleKG } = require('./modules/entityAudit');
const axios = require('axios');

const artistName = "Donald Glover";

console.log(`Testing auditGoogleKG for: ${artistName}`);

// Debug: Raw search to see what KG returns
const apiKey = process.env.GOOGLE_KG_API_KEY;
axios.get('https://kgsearch.googleapis.com/v1/entities:search', {
    params: {
        query: artistName,
        limit: 5,
        key: apiKey
    }
}).then(res => {
    console.log("RAW RESULTS:");
    res.data.itemListElement.forEach(item => {
        console.log(`- Name: ${item.result.name}`);
        console.log(`  Type: ${item.result['@type']}`);
        console.log(`  Desc: ${item.result.description}`);
        console.log(`  Score: ${item.resultScore}`);
    });
    console.log("--------------------------------");

    // Now run the audit
    auditGoogleKG(artistName).then(res => {
        console.log("\nAUDIT FUNCTION RESULT:");
        console.log(JSON.stringify(res, null, 2));
    }).catch(err => console.error(err));

}).catch(err => console.error("Raw search error:", err.message));

