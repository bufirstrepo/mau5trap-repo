const fs = require('fs');
const PDFDocument = require('pdfkit');
const axios = require('axios');
const sqlite3 = require('sqlite3');

async function testDependencies() {
    console.log("Starting Dependency Check...");
    let errors = [];

    // 1. Test PDFKit
    try {
        const doc = new PDFDocument();
        doc.pipe(fs.createWriteStream('test_dependency_output.pdf'));
        doc.text('Dependency Check Passed', 100, 100);
        doc.end();
        console.log("✓ PDFKit: Functional (generated test_dependency_output.pdf)");
    } catch (e) {
        console.error("✗ PDFKit Failed:", e.message);
        errors.push("PDFKit");
    }

    // 2. Test Axios (Fetch Google.com)
    try {
        const res = await axios.get('https://www.google.com', { timeout: 5000 });
        if (res.status === 200) {
            console.log("✓ Axios: Functional (External connectivity verified)");
        } else {
            throw new Error(`Status ${res.status}`);
        }
    } catch (e) {
        console.error("✗ Axios Failed:", e.message);
        errors.push("Axios");
    }

    // 3. Test SQLite3 (Native Binding Check)
    try {
        const db = new sqlite3.Database(':memory:');
        db.serialize(() => {
            db.run("CREATE TABLE lorem (info TEXT)");
            const stmt = db.prepare("INSERT INTO lorem VALUES (?)");
            stmt.run("Ipsum");
            stmt.finalize();

            db.each("SELECT rowid AS id, info FROM lorem", (err, row) => {
                if (err) throw err;
                console.log(`✓ SQLite3: Functional (Read/Write Memory DB: ${row.id}: ${row.info})`);
            });
        });
        db.close();
    } catch (e) {
        console.error("✗ SQLite3 Failed:", e.message);
        errors.push("SQLite3");
    }

    if (errors.length > 0) {
        console.error("\nDependency Check FAILED for:", errors.join(", "));
        process.exit(1);
    } else {
        console.log("\nAll Critical Dependencies Verified.");
    }
}

testDependencies();
