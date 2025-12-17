// integrations/spotify.js
// Spotify for Artists API Integration

const SpotifyWebApi = require('spotify-web-api-node');

class SpotifyIntegration {
    constructor() {
        this.spotifyApi = new SpotifyWebApi({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            refreshToken: process.env.SPOTIFY_REFRESH_TOKEN
        });
        this.tokenExpiresAt = null;
    }

    /**
     * Ensure we have a valid access token
     */
    async ensureToken() {
        const now = Date.now();
        if (!this.tokenExpiresAt || now >= this.tokenExpiresAt) {
            try {
                const data = await this.spotifyApi.refreshAccessToken();
                this.spotifyApi.setAccessToken(data.body['access_token']);
                // Token typically expires in 3600 seconds
                this.tokenExpiresAt = now + (data.body['expires_in'] * 1000);
            } catch (error) {
                throw new Error(`Spotify token refresh failed: ${error.message}`);
            }
        }
    }

    /**
     * Fetch artist data by Spotify Artist ID
     * @param {string} spotifyArtistId - Spotify artist ID (e.g., "2CIMQHirSU0MQqyYHq0eOx" for deadmau5)
     * @returns {Object} Artist data mapped to mau5trap schema
     */
    async getArtistData(spotifyArtistId) {
        try {
            await this.ensureToken();

            // Fetch artist profile
            const artistData = await this.spotifyApi.getArtist(spotifyArtistId);
            const artist = artistData.body;

            // Fetch top tracks to estimate total streams
            const topTracksData = await this.spotifyApi.getArtistTopTracks(spotifyArtistId, 'US');
            const topTracks = topTracksData.body.tracks;

            // Calculate estimated monthly listeners from followers (Spotify doesn't expose this directly)
            const monthlyListeners = artist.followers.total;

            // Estimate total streams from top tracks popularity
            // Note: This is an approximation. Real stream counts require Spotify for Artists access
            const estimatedStreams = topTracks.reduce((sum, track) => {
                // Popularity ranges 0-100, we'll use it as a multiplier
                return sum + (track.popularity * 1000000);
            }, 0);

            // Map Spotify data to mau5trap schema
            return {
                monthlyListeners: monthlyListeners,
                totalStreams: estimatedStreams,
                growthRate: this.calculateGrowthRate(artist.popularity), // Derived from popularity
                social: {
                    spotify: artist.followers.total
                },
                meta: {
                    dataSource: 'spotify_api',
                    lastUpdated: new Date().toISOString(),
                    spotifyId: artist.id,
                    spotifyUrl: artist.external_urls.spotify
                }
            };
        } catch (error) {
            console.error('Spotify API Error:', error.message);
            throw error;
        }
    }

    /**
     * Derive growth rate from Spotify popularity score
     * @param {number} popularity - Spotify popularity (0-100)
     * @returns {number} Growth rate percentage
     */
    calculateGrowthRate(popularity) {
        // High popularity (80-100) = Strong growth (5-10%)
        // Medium popularity (50-79) = Moderate growth (2-5%)
        // Low popularity (0-49) = Slow/declining growth (0-2%)
        if (popularity >= 80) return 5 + ((popularity - 80) / 4);
        if (popularity >= 50) return 2 + ((popularity - 50) / 10);
        return popularity / 25;
    }

    /**
     * Search for artist by name (for initial setup)
     * @param {string} artistName - Artist name to search
     * @returns {Array} Array of matching artists with IDs
     */
    async searchArtist(artistName) {
        try {
            await this.ensureToken();
            const data = await this.spotifyApi.searchArtists(artistName, { limit: 5 });
            return data.body.artists.items.map(artist => ({
                id: artist.id,
                name: artist.name,
                followers: artist.followers.total,
                popularity: artist.popularity,
                genres: artist.genres,
                url: artist.external_urls.spotify
            }));
        } catch (error) {
            console.error('Spotify Search Error:', error.message);
            throw error;
        }
    }

    /**
     * Check if Spotify credentials are configured
     * @returns {boolean}
     */
    isConfigured() {
        return !!(
            process.env.SPOTIFY_CLIENT_ID &&
            process.env.SPOTIFY_CLIENT_SECRET &&
            process.env.SPOTIFY_REFRESH_TOKEN &&
            process.env.SPOTIFY_CLIENT_ID !== 'your_spotify_client_id_here'
        );
    }
}

module.exports = new SpotifyIntegration();
