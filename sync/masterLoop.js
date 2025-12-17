
const SafeStatsSchema = require('../modules/SafeStatsSchema');
const spotify = require('../integrations/spotify');

/**
 * Master Sync Loop
 * Iterates through active artists, fetches data from integrations, verifies it, and persists to DB.
 * 
 * @param {Object} db - Sequelize database instance containing Artist and Stats models
 * @param {Object} [spotifyClient] - Optional spotify integration (for mocking)
 */
async function masterSyncLoop(db, spotifyClient) {
    const api = spotifyClient || spotify;
    console.log('[Sync] Starting Master Sync Loop...');

    try {
        // 1. Fetch active artists
        // Note: In the main file, Artist model might use 'data' JSON column or standard fields. 
        // We assume standard Sequelize usage based on the user's snippet.
        const artists = await db.Artist.findAll({
            where: {
                status: 'active'
            }
        });

        console.log(`[Sync] Found ${artists.length} artists.`);

        for (const artist of artists) {
            // Check if artist has a Spotify ID (assuming it's in the 'data' JSON or valid field)
            // The snippet suggests `artist.id` and we know from previous files artist.id is 'art_name'
            // We need the ACTUAL spotify ID. Let's assume it's stored in `artist.data.meta.spotifyId` or we rely on the integration to search?
            // "safeStats.spotifyId" implies we get it BACK from the API.
            // But to call getArtistData we need an ID. 
            // In `spotify.js`, `getArtistData` takes `spotifyArtistId`.
            // We will look for it in artist.data.meta?.spotifyId OR fallback to searching?
            // For safety in this loop, we'll skip if no specific spotify ID is known, OR try to use the artist name if the integration supports it?

            // Actually, let's look at how the main file stores data: 
            // artist.data = { meta: { ... }, ... }
            const spotifyId = artist.data?.meta?.spotifyId;

            if (!spotifyId) {
                console.log(`[Sync] Skipping ${artist.name} - No Spotify ID linked.`);
                continue;
            }

            try {
                console.log(`[Sync] Fetching Spotify data for ${artist.name}...`);
                const rawStats = await api.getArtistData(spotifyId);

                // 2. Validate & Sanitize
                const safeStats = SafeStatsSchema.parse(rawStats);

                // 3. Persist to DB
                await db.Stats.create({
                    artistId: artist.id,
                    platform: "spotify",
                    listeners: safeStats.monthlyListeners,
                    streams: safeStats.totalStreams,
                    recordedAt: new Date(),
                });

                console.log(`[Sync] Saved stats for ${artist.name}.`);

            } catch (err) {
                console.error(`[Sync] Failed to sync ${artist.name}:`, err.message);
            }

            // Simple rate limit helper (1 sec pause)
            await new Promise(r => setTimeout(r, 1000));
        }

    } catch (error) {
        console.error('[Sync] Fatal Error in Loop:', error);
    }

    console.log('[Sync] Cycle Complete.');
}

module.exports = masterSyncLoop;
