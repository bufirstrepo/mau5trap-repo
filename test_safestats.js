
const SafeStatsSchema = require('./modules/SafeStatsSchema');

console.log('--- Testing SafeStatsSchema (Zod) ---');

const testCases = [
    {
        name: 'Valid Data',
        input: {
            monthlyListeners: 1000,
            totalStreams: 50000,
            growthRate: 5.5,
            social: { spotify: 200 },
            meta: { dataSource: 'test', lastUpdated: new Date().toISOString(), spotifyId: '123', spotifyUrl: 'https://spotify.com/artist/123' }
        },
        shouldPass: true
    },
    {
        name: 'Invalid Data Type (String for Number)',
        input: {
            monthlyListeners: "1000", // Zod expects number strictly unless coerced
            totalStreams: 50000,
            growthRate: 5.5,
            social: { spotify: 200 },
            meta: { dataSource: 'test', lastUpdated: 'now', spotifyId: '123', spotifyUrl: 'url' }
        },
        shouldPass: false
    },
    {
        name: 'Extra Fields (Strict Schema)',
        input: {
            monthlyListeners: 1000,
            totalStreams: 50000,
            growthRate: 5.5,
            social: { spotify: 200 },
            meta: { dataSource: 'test', lastUpdated: 'now', spotifyId: '123', spotifyUrl: 'url' },
            extraField: 'should fail'
        },
        shouldPass: false
    },
    {
        name: 'Missing Fields',
        input: {
            monthlyListeners: 1000
        },
        shouldPass: false
    }
];

let failures = 0;

testCases.forEach((test) => {
    try {
        SafeStatsSchema.parse(test.input);
        if (test.shouldPass) {
            console.log(`[PASS] ${test.name}`);
        } else {
            console.error(`[FAIL] ${test.name} - Expected Error but passed`);
            failures++;
        }
    } catch (e) {
        if (!test.shouldPass) {
            console.log(`[PASS] ${test.name} - Caught expected error: ${e.errors ? e.errors[0].message : e.message}`);
        } else {
            console.error(`[FAIL] ${test.name} - Unexpected error:`, e.message);
            if (e.errors) console.error(e.errors);
            failures++;
        }
    }
});

if (failures === 0) {
    console.log('\nAll tests passed successfully.');
} else {
    console.log(`\n${failures} tests failed.`);
    process.exit(1);
}
