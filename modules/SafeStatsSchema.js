const z = require('zod');

// User-defined schema
const SafeStatsSchema = z
    .object({
        monthlyListeners: z.number(),
        totalStreams: z.number(),
        growthRate: z.number(),
        social: z
            .object({
                spotify: z.number(),
            })
            .strict(),
        meta: z
            .object({
                dataSource: z.string(),
                lastUpdated: z.string(),
                spotifyId: z.string(),
                spotifyUrl: z.string(),
            })
            .strict(),
    })
    .strict();

module.exports = SafeStatsSchema;
