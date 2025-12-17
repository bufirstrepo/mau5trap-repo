// mau5trap-production-api.js
// Production API with authentication, multi-tenant access, and reporting

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const helmet = require('helmet');
const compression = require('compression');
const winston = require('winston');
const { Sequelize, DataTypes } = require('sequelize');
const PDFDocument = require('pdfkit-table');

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const Groq = require('groq-sdk');
const NodeCache = require('node-cache');
const math = require('mathjs'); // Predictive Analytics
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // Cache for 1hr

// Global Chart Instantiation (Performance Optimization)
const chartJSNodeCanvasPie = new ChartJSNodeCanvas({ width: 400, height: 400, backgroundColour: 'white' });
const chartJSNodeCanvasBar = new ChartJSNodeCanvas({ width: 600, height: 300, backgroundColour: 'white' });
const chartJSNodeCanvasLine = new ChartJSNodeCanvas({ width: 600, height: 300, backgroundColour: 'white' });
const chartJSNodeCanvasDonut = new ChartJSNodeCanvas({ width: 400, height: 400, backgroundColour: 'white' });

async function generatePieChart(labels, data) {
    const configuration = {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: ['#00FF00', '#1a1a1a', '#666666', '#999999', '#cccccc', '#333333']
            }]
        },
        options: {
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 14 } } },
                title: { display: true, text: 'Revenue Distribution', font: { size: 18, weight: 'bold' } }
            }
        }
    };
    return await chartJSNodeCanvasPie.renderToBuffer(configuration);
}

async function generateBarChart(labels, data) {
    const configuration = {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Revenue by Region',
                data,
                backgroundColor: '#00FF00'
            }]
        },
        options: {
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: 14 } } },
                x: { ticks: { font: { size: 14 } } }
            },
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Streaming Geography', font: { size: 18, weight: 'bold' } }
            }
        }
    };
    return await chartJSNodeCanvasBar.renderToBuffer(configuration);
}

async function generateLineChart(labels, data) {
    const configuration = {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Monthly Sales',
                data,
                borderColor: '#00FF00',
                backgroundColor: 'rgba(0, 255, 0, 0.2)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: 14 } } },
                x: { ticks: { font: { size: 14 } } }
            },
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Sales Trend', font: { size: 18, weight: 'bold' } }
            }
        }
    };
    return await chartJSNodeCanvasLine.renderToBuffer(configuration);
}

async function generateDonutChart(labels, data) {
    const configuration = {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: ['#00FF00', '#333333'],
                borderWidth: 0
            }]
        },
        options: {
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 14 } } },
                title: { display: true, text: 'Forecast vs Target', font: { size: 18, weight: 'bold' } }
            }
        }
    };
    return await chartJSNodeCanvasDonut.renderToBuffer(configuration);
}

// DATABASE SETUP
const dbDialect = process.env.DB_DIALECT || 'sqlite';
let sequelize;

if (dbDialect === 'postgres') {
    sequelize = new Sequelize(process.env.DATABASE_URL, {
        dialect: 'postgres',
        logging: false
    });
} else {
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: 'mau5trap_v5.sqlite', // persistent file storage
        logging: false
    });
}

// MODELS
const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'viewer' }, // admin, artist, viewer
    artistAccess: { type: DataTypes.STRING, defaultValue: 'none' }, // 'all', 'none', or 'art_id'
    pageAccess: { type: DataTypes.STRING, defaultValue: '["overview"]' }, // Store as stringified JSON manually
    integrationCount: { type: DataTypes.INTEGER, defaultValue: 1 },
    resetToken: { type: DataTypes.STRING },
    resetTokenExpiry: { type: DataTypes.STRING } // SQLite date handling is strict, use String for safety
});

const Artist = sequelize.define('Artist', {
    id: { type: DataTypes.STRING, primaryKey: true }, // e.g., 'art_deadmau5'
    name: { type: DataTypes.STRING, allowNull: false },
    data: { type: DataTypes.JSON, allowNull: false } // Stores the entire complex object
});

// INITIALIZATION & SEEDING
async function initDB() {
    try {
        await sequelize.authenticate();
        logger.info('Database connection established.');
        await sequelize.sync({ alter: true }); // Ensure schema updates are applied

        // SEED USERS IF EMPTY
        const userCount = await User.count();
        if (userCount === 0) {
            logger.info('Seeding initial users...');
            const adminHash = await bcrypt.hash('admin123', 10);
            const artistHash = await bcrypt.hash('rezz123', 10);

            await User.create({ email: 'admin@mau5trap.com', passwordHash: adminHash, name: 'Admin User', role: 'admin', artistAccess: 'all', pageAccess: JSON.stringify(['all']), integrationCount: 10 });
            await User.create({ email: 'tours@rezz.com', passwordHash: artistHash, name: 'Isabelle Rezazadeh', role: 'artist', artistAccess: 'art_rezz', pageAccess: JSON.stringify(['overview', 'roster']), integrationCount: 5 });
        }

        // SEED ARTISTS IF EMPTY (Using the hardcoded labelData below)
        const artistCount = await Artist.count();
        if (artistCount === 0 && typeof labelData !== 'undefined') {
            logger.info('Seeding initial artists...');
            for (const artist of labelData.artists) {
                // Ensure we store the ID separately, but also keep the full object in 'data'
                await Artist.create({
                    id: artist.id,
                    name: artist.name,
                    data: artist
                });
            }
        }

    } catch (error) {
        logger.error('Unable to connect to the database:', error);
    }
}

// Call init on startup
initDB();

// 1. ENVIRONMENT VALIDATION
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    console.error('CRITICAL: JWT_SECRET missing in production environment.');
    process.exit(1);
}

// 2. LOGGING CONFIGURATION (Winston)
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'mau5trap-api' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple(),
    }));
}

const app = express();
const PORT = process.env.PORT || 3000;

// 3. MIDDLEWARE
// Security Headers
app.use(helmet());
// Gzip Compression
app.use(compression());
// CORS
app.use(cors({
    origin: true, // Allow all origins (including file:// for local testing)
    credentials: true
}));
app.use(express.json());

// Request Logger Middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`, { ip: req.ip });
    next();
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 1000
});
app.use('/v3/', limiter);

// ============================================================================
// DATABASE (Replace with PostgreSQL in production)
// ============================================================================

// User database migrated to Sequelize (See models above)

// Artist data (same as before, but now with access control)
// ============================================================================
// DATA LAYER - Real API Integration with Mock Fallback
// ============================================================================

const mockLabelData = require('./mock/artistData');
const { fetchArtistData, getIntegrationStatus } = require('./integrations');

// Use real data if configured, otherwise use mock
const USE_REAL_DATA = process.env.USE_REAL_DATA === 'true';

/**
 * Get artist data with hybrid real/mock approach
 * @param {string} artistId - Artist ID
 * @returns {Promise<Object>} Artist data object
 */
async function getArtistData(artistId, forceRefresh = false) {
    const mockArtist = mockLabelData.artists.find(a => a.id === artistId);

    if (!mockArtist) {
        return null; // Artist not found
    }

    // Check Cache (24-hour TTL for general artist data like Ticketmaster/Spotify)
    // User requested "Ticketmaster... cache for the time", "Spotify... when needed"
    const cacheKey = `artist_data_${artistId}`;
    if (!forceRefresh) {
        const cachedData = cache.get(cacheKey);
        if (cachedData) return cachedData;
    }

    if (!USE_REAL_DATA) {
        return mockArtist; // Use mock data
    }

    try {
        // Fetch real data and merge with mock fallback
        const artistData = await fetchArtistData(artistId, mockArtist);

        // Cache successful fetch for 24 hours (86400 seconds)
        cache.set(cacheKey, artistData, 86400);

        return artistData;
    } catch (error) {
        console.warn(`Failed to fetch real data for ${artistId}, using mock:`, error.message);
        return mockArtist;
    }
}

/**
 * Get all artists (with optional real data)
 * @returns {Promise<Array>} Array of artist objects
 */
async function getAllArtists() {
    if (!USE_REAL_DATA) {
        return mockLabelData.artists;
    }

    // Fetch real data for all artists concurrently
    const artistPromises = mockLabelData.artists.map(async (mockArtist) => {
        try {
            return await fetchArtistData(mockArtist.id, mockArtist);
        } catch (error) {
            console.warn(`Failed to fetch ${mockArtist.id}, using mock`);
            return mockArtist;
        }
    });

    return await Promise.all(artistPromises);
}

// Export for compatibility (labelData is now dynamically generated)
const labelData = mockLabelData;


// ============================================================================
// RATE LIMITER & INTEGRATION MANAGER
// ============================================================================

class RateLimiter {
    constructor(requestsPerSecond, burst) {
        this.tokens = burst;
        this.maxTokens = burst;
        this.fillRate = requestsPerSecond;
        this.lastRefill = Date.now();
    }

    async throttle() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        } else {
            // Queue logic would go here for stricter enforcement
            // For now, we simulate a wait or return false to indicate limiting
            const waitTime = (1 / this.fillRate) * 1000;
            return new Promise(resolve => setTimeout(() => {
                this.tokens -= 1; // Take debt
                resolve(true);
            }, waitTime));
        }
    }

    refill() {
        const now = Date.now();
        const delta = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.maxTokens, this.tokens + (delta * this.fillRate));
        this.lastRefill = now;
    }
}

// Service Configuration Map
const SERVICES = {
    spotify: { name: 'Spotify Web API', rateLimit: 10, burst: 50 },
    youtube: { name: 'YouTube Analytics', rateLimit: 5, burst: 20 },
    tiktok: { name: 'TikTok API', rateLimit: 5, burst: 20 },
    instagram: { name: 'Instagram Graph', rateLimit: 2, burst: 10 },
    shopify: { name: 'Shopify API', rateLimit: 2, burst: 4 }, // Leaky bucket standard
    ticketmaster: { name: 'Ticketmaster Discovery', rateLimit: 5, burst: 10 },
    bandsintown: { name: 'Bandsintown API', rateLimit: 10, burst: 20 },
    chartmetric: { name: 'Chartmetric API', rateLimit: 2, burst: 10 },
    revelator: { name: 'Revelator API', rateLimit: 5, burst: 20 }
};

// Initialize Limiters
const limiters = {};
Object.keys(SERVICES).forEach(key => {
    limiters[key] = new RateLimiter(SERVICES[key].rateLimit, SERVICES[key].burst);
});

// Mock Data Store for Integrations
const userIntegrations = {
    // userId -> { serviceId: { connected: bool, token: string, lastSync: date } }
};

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

// JWT secret (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Generate JWT token
function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
            artistAccess: user.artistAccess
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
}

// Verify JWT token middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // Authenticate with JWT checks only
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Check if user has access to specific artist
function hasArtistAccess(user, artistId) {
    if (user.role === 'admin') return true;
    if (user.artistAccess === 'all') return true;
    if (Array.isArray(user.artistAccess)) {
        return user.artistAccess.includes(artistId);
    }
    return false;
}

// Filter data based on user permissions
function filterDataByAccess(data, user) {
    if (user.role === 'admin' || user.artistAccess === 'all') {
        return data;
    }

    // Filter to only artists user has access to
    if (Array.isArray(data.artists)) {
        return {
            ...data,
            artists: data.artists.filter(a => hasArtistAccess(user, a.id))
        };
    }

    return data;
}

// ============================================================================
// AUTHENTICATION ENDPOINTS
// ============================================================================

// Login Endpoint
app.post('/v3/auth/login', async (req, res) => {
    const { email, password } = req.body;

    // Admin Override
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASS) {
        const token = jwt.sign({ email, role: 'admin', artistAccess: 'all', integrationCount: 10 }, JWT_SECRET, { expiresIn: '24h' });
        return res.json({
            token,
            user: { name: 'Admin', email, role: 'admin', pageAccess: ['all'] }
        });
    }

    try {
        const user = await User.findOne({ where: { email } });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        // Parse pageAccess
        const parsedPageAccess = JSON.parse(user.pageAccess || '["overview"]');

        const token = jwt.sign({
            email: user.email,
            role: user.role,
            artistAccess: user.artistAccess,
            integrationCount: user.integrationCount
        }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            token,
            user: {
                name: user.name,
                email: user.email,
                role: user.role,
                artistAccess: user.artistAccess,
                role: user.role,
                artistAccess: user.artistAccess,
            }
        });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// EMAIL SERVICES (MAU5TRAP MAIL)
// ============================================================================

const nodemailer = require('nodemailer');

const enableEmail = process.env.SMTP_HOST || process.env.SENDGRID_API_KEY;
const transporter = nodemailer.createTransport(
    enableEmail ? {
        host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
        port: process.env.SMTP_PORT || 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER || 'apikey',
            pass: process.env.SMTP_PASS || process.env.SENDGRID_API_KEY
        }
    } : {
        jsonTransport: true // Logs to console if no keys provided
    }
);

// Helper: Send Email
async function sendEmail({ to, subject, html }) {
    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || '"mau5trap OS" <notify@mau5trap.com>',
            to,
            subject,
            html
        });

        if (info.messageId) {
            logger.info(`[EMAIL SENT] MessageID: ${info.messageId} to ${to}`);
        } else {
            // JSON Transport Fallback
            console.log('---------------------------------------------------');
            console.log(`[EMAIL SIMULATION] To: ${to} | Subject: ${subject}`);
            console.log('Body:', html);
            console.log('---------------------------------------------------');
        }
        return true;
    } catch (err) {
        logger.error('[EMAIL FAIL]', err);
        return false;
    }
}

// Forgot Password (Real Email)
app.post('/v3/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ where: { email } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const resetToken = require('crypto').randomBytes(32).toString('hex');
        user.resetToken = resetToken;
        user.resetTokenExpiry = Date.now() + 3600000; // 1 hour
        await user.save();

        const resetLink = `http://localhost:8080/reset-password?token=${resetToken}`;

        await sendEmail({
            to: email,
            subject: 'mau5trap OS - Password Reset Request',
            html: `
                <div style="font-family: monospace; background: #000; color: #fff; padding: 20px;">
                    <h2 style="color: #00ff00;">PASSWORD RESET REQUIRED</h2>
                    <p>A request was received to reset the credentials for <strong>${email}</strong>.</p>
                    <p>Click the secure link below to proceed:</p>
                    <a href="${resetLink}" style="color: #00ff00; font-size: 16px;">${resetLink}</a>
                    <p style="margin-top: 20px; color: #666;">If you did not request this, ignore this transmission.</p>
                </div>
            `
        });

        res.json({ message: 'Password reset link sent to email.' });
    } catch (err) {
        logger.error('Forgot Password error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GDPR: Delete Account
app.delete('/v3/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Prevent deleting the main admin for safety in this demo
        if (user.email === 'admin@mau5trap.com') {
            return res.status(403).json({ error: 'Cannot delete root admin account.' });
        }

        await user.destroy();
        // In production, also cascade delete related data or anonymize logs

        res.json({ success: true, message: 'Account permanently deleted.' });
    } catch (err) {
        logger.error('GDPR Delete error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Get current user info
app.get('/v3/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            artistAccess: user.artistAccess
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal error' });
    }
});

// Change password
app.post('/v3/auth/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password required' });
    }

    try {
        const user = await User.findByPk(req.user.id);
        const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Current password incorrect' });
        }

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Internal error' });
    }
});

// ============================================================================
// USER MANAGEMENT (Admin only)
// ============================================================================

// Create new user
app.post('/v3/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { email, password, name, role, artistAccess } = req.body;

    if (!email || !password || !name || !role) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const newUser = await User.create({
            id: `user_${Date.now()}`,
            email,
            passwordHash: await bcrypt.hash(password, 10),
            name,
            role,
            role,
            artistAccess: artistAccess || 'none'
        });

        res.json({
            id: newUser.id,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role,
            artistAccess: newUser.artistAccess
        });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: 'Failed to create user' });
    }
});



// ============================================================================
// ARTIST ENDPOINTS (with access control)
// ============================================================================

// Simple In-Memory Cache for Artists List
const apiCache = {
    artists: { data: null, timestamp: 0 }
};

// Get all artists (with pagination/search)
app.get('/v3/artists', authenticateToken, async (req, res) => {
    const { search, limit = 50, offset = 0 } = req.query;

    try {
        const dbArtists = await Artist.findAll();
        // Merge DB schema with the JSON data
        let fullList = dbArtists.map(a => ({ ...a.data, id: a.id, name: a.name }));

        // HYBRID MERGE: Add memory-only artists (e.g. from failed DB writes or mock mode)
        const dbIds = new Set(fullList.map(a => a.id));
        const memoryArtists = labelData.artists.filter(a => !dbIds.has(a.id));
        fullList = [...fullList, ...memoryArtists];

        // Filter by Search
        if (search) {
            fullList = fullList.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));
        }

        // Access Control
        const wrapper = filterDataByAccess({ artists: fullList }, req.user);
        fullList = wrapper.artists || [];

        // Pagination
        const paginated = fullList.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

        res.json({
            artists: paginated,
            total: fullList.length,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create new artist (Admin only)
app.post('/v3/artists', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { name, tier } = req.body;
    if (!name || !tier) return res.status(400).json({ error: 'Name/Tier required' });

    const id = `art_${name.toLowerCase().replace(/\s+/g, '')}`;
    const newArtist = {
        id, name, displayName: name, tier,
        status: 'active',
        monthlyListeners: 0,
        totalStreams: 0,
        growthRate: 0,
        revenue: { streaming: 0, touring: 0, merch: 0, sync: 0, branding: 0, youtube: 0 },
        touring: { upcomingShows: 0, avgTicketPrice: 0, avgAttendance: 0, merchPerHead: 0, shows: [] },
        social: { instagram: 0, twitter: 0, tiktok: 0, engagementRate: 0 },
        merch: { onlineSales: 0, tourSales: 0, monthlySales: [] },
        brandDeals: [],
        collaborations: [],
        meta: { dataSource: 'manual_entry', lastUpdated: new Date().toISOString() }
    };

    try {
        await Artist.create({ id, name, data: newArtist });
        // Sync to memory
        const exists = labelData.artists.find(a => a.id === id);
        if (!exists) labelData.artists.push(newArtist);
        res.json({ success: true, artist: newArtist });
    } catch (err) {
        // Fallback to memory if DB fails (for prototype robustness)
        labelData.artists.push(newArtist);
        res.json({ success: true, artist: newArtist, warning: 'Persisted to memory only' });
    }
});

// Archive Artist
app.post('/v3/artists/:id/archive', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;

    const artist = labelData.artists.find(a => a.id === id);
    if (!artist) return res.status(404).json({ error: 'Artist not found' });

    artist.tier = 'archived';
    artist.status = 'archived';

    // Attempt DB update
    try {
        await Artist.update({ data: artist }, { where: { id } });
    } catch (e) { console.error('DB Update failed, using memory'); }

    res.json({ success: true, message: `${artist.name} archived` });
});

// Restore Artist
app.post('/v3/artists/:id/restore', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;

    const artist = labelData.artists.find(a => a.id === id);
    if (!artist) return res.status(404).json({ error: 'Artist not found' });

    artist.tier = 'developing'; // Default back to developing
    artist.status = 'active';

    // Attempt DB update
    try {
        await Artist.update({ data: artist }, { where: { id } });
    } catch (e) { console.error('DB Update failed, using memory'); }

    res.json({ success: true, message: `${artist.name} restored` });
});

// Update Artist Image (Manual Override)
app.put('/v3/artists/:id/image', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const { imageUrl } = req.body;

    const artist = labelData.artists.find(a => a.id === id);
    if (!artist) return res.status(404).json({ error: 'Artist not found' });

    // Update in-memory data
    artist.manualImage = imageUrl;

    // In a real app with DB, we'd save this to the 'data' JSON column or a specific column
    // For this session's hybrid mock approach:
    try {
        const dbArtist = await Artist.findByPk(id);
        if (dbArtist) {
            const newData = { ...dbArtist.data, manualImage: imageUrl };
            dbArtist.data = newData;
            await dbArtist.save();
        }
    } catch (e) { console.error('Failed to persist manual image:', e); }

    res.json({ success: true, manualImage: imageUrl });
});

// Get global tours (consolidated)
app.get('/v3/tours', authenticateToken, async (req, res) => {
    const { artistId } = req.query;
    try {
        const artists = await Artist.findAll();
        let relevantArtists = artists.map(a => a.data);

        if (artistId) {
            relevantArtists = relevantArtists.filter(a => a.id === artistId);
        }

        // ... rest of logic relies on mapping relevantArtists
        // We reuse existing logic but inserted async fetch first
        const tours = relevantArtists.flatMap(a => {
            if (!a.touring || !a.touring.shows) return [];
            return a.touring.shows.map(s => ({ ...s, artist: a.id, artistName: a.displayName }));
        });

        res.json({ tours });
    } catch (err) {
        res.status(500).json({ error: 'DB Error' });
    }
});


// AI Analysis Endpoint (Grok Mock)
app.post('/v3/ai/analyze', authenticateToken, (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const lowerQuery = query.toLowerCase();
    let response = "I'm analyzing your request...";

    // Simple keyword matching Mock AI
    if (lowerQuery.includes('roi')) {
        const bestRoi = labelData.artists.sort((a, b) => b.roi - a.roi)[0];
        response = `Based on current data, ${bestRoi.name} has the highest ROI at ${bestRoi.roi}x. Rezz is second at 6.5x.`;
    } else if (lowerQuery.includes('tour') || lowerQuery.includes('revenue')) {
        const topTouring = labelData.artists.sort((a, b) => (b.revenue.touring) - (a.revenue.touring))[0];
        response = `${topTouring.name} is leading touring revenue with $${topTouring.revenue.touring.toLocaleString()}. Suggest increasing ticket prices for ${labelData.artists[1].name} to match demand.`;
    } else if (lowerQuery.includes('growth') || lowerQuery.includes('trend')) {
        const topGrower = labelData.artists.sort((a, b) => b.growthRate - a.growthRate)[0];
        response = `${topGrower.name} is the fastest growing artist (${topGrower.growthRate}%). This aligns with the viral TikTok trend observed last week.`;
    } else {
        response = "I've analyzed the label metrics. Overall revenue is up 15% YoY. Would you like a breakdown by genre?";
    }

    res.json({
        query,
        response,
        timestamp: new Date().toISOString(),
        confidence: 0.98
    });
});

// Get single artist (with access check)
app.get('/v3/artists/:id', authenticateToken, async (req, res) => {
    if (!hasArtistAccess(req.user, req.params.id)) {
        return res.status(403).json({ error: 'Access denied to this artist' });
    }

    const artist = labelData.artists.find(a => a.id === req.params.id);

    if (!artist) {
        return res.status(404).json({ error: 'Artist not found' });
    }

    // Enhance with Wikipedia Data (Cached)
    let wikiData = null;
    try {
        const cacheKey = `wiki_bio_${artist.id}`;
        const cachedWiki = cache.get(cacheKey);

        if (cachedWiki) {
            wikiData = cachedWiki;
        } else {
            // Use entityAudit module to fetch summary
            const wikiAudit = await entityAudit.auditWikipedia(artist.name);
            if (wikiAudit.exists && wikiAudit.bioShort) {
                wikiData = {
                    summary: wikiAudit.bioShort,
                    thumbnail: wikiAudit.thumbnail,
                    wikiUrl: wikiAudit.url
                };
                cache.set(cacheKey, wikiData, 3600 * 24); // Cache for 24 hours
            }
        }
    } catch (err) {
        console.warn('Wikipedia enrichment failed:', err.message);
    }

    res.json({
        ...artist,
        wikipedia: wikiData,
        totalRevenue: calculateTotalRevenue(artist),
        projectedAnnual: calculateTotalRevenue(artist) * 12
    });
});


// Google KG Proxy for Artist Entity
// Google KG Proxy for Artist Entity
app.get('/v3/integrations/google-kg', authenticateToken, async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: 'Query required' });

        let result = await entityAudit.auditGoogleKG(query);

        // 1. Fallback: Fandom Image
        if (result.exists && !result.image) {
            try {
                const fandomResult = await entityAudit.auditFandom(query);
                if (fandomResult.exists && fandomResult.image) {
                    result.image = fandomResult.image;
                    result.sourceFallback = 'fandom';
                }
            } catch (e) { /* ignore */ }
        }

        // 2. Fallback: Contextual Search (Google KG with 'mau5trap' prefix)
        // If we STILL have no image (or entity not found initially), try searching "mau5trap [Artist]"
        if (!result.image) {
            try {
                const contextualQuery = `mau5trap ${query}`;
                const contextResult = await entityAudit.auditGoogleKG(contextualQuery);
                if (contextResult.exists && contextResult.image) {
                    // Only adopt the image if the main result failed or lacked one
                    result.image = contextResult.image;
                    if (!result.exists) {
                        // If original didn't exist, adopt the whole contextual result
                        result = contextResult;
                    }
                    result.sourceFallback = 'google_contextual';
                }
            } catch (e) { /* ignore */ }
        }

        res.json(result);
    } catch (err) {
        logger.error('Google KG Proxy Error:', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

// Fandom Wiki Roster (Scraped)
app.get('/v3/integrations/fandom/roster', authenticateToken, async (req, res) => {
    try {
        const result = await entityAudit.getFandomRoster();
        res.json(result);
    } catch (err) {
        logger.error('Fandom Roster Error:', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

// Fandom Wiki Audit for specific artist
app.get('/v3/integrations/fandom/audit', authenticateToken, async (req, res) => {
    try {
        const { artist } = req.query;
        if (!artist) return res.status(400).json({ error: 'Artist required' });

        const result = await entityAudit.auditFandom(artist);
        res.json(result);
    } catch (err) {
        logger.error('Fandom Audit Error:', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

const entityAudit = require('./modules/entityAudit');

app.get('/v3/artists/:id/entity-audit', authenticateToken, async (req, res) => {
    try {
        const artistId = req.params.id;
        const forceRefresh = req.query.refresh === 'true';

        // Check cache first (2-week TTL for entity audits to save quotas)
        const cacheKey = `entity_audit_${artistId}`;
        const cached = cache.get(cacheKey);

        if (cached && !forceRefresh) {
            return res.json({ ...cached, cached: true });
        }

        // Get artist data (Pass forceRefresh to trigger Spotify/Ticketmaster updates if requested)
        const artist = await getArtistData(artistId, forceRefresh);

        if (!artist) {
            return res.status(404).json({ error: 'Artist not found' });
        }

        // --- GENIUS CACHING (Indefinite) ---
        const geniusCacheKey = `audit_genius_${artistId}`;
        let geniusResult = cache.get(geniusCacheKey);

        // If forcing refresh, we still might want to keep Genius cached unless specifically clearing it?
        // User said: "genius, have them cache indefinitely". So even on 'refresh', we stick to cache if available?
        // But the '$' button implies FRESH data. I'll make it so forceRefresh updates Genius too, 
        // OR we can strictly obey "cache indefinitely" and only update if empty.
        // Let's assume forceRefresh means "I paid money, give me everything fresh", BUT 
        // re-fetching Genius lyrics/data rarely changes. I will prefer cache for Genius unless it's missing.
        if (!geniusResult) {
            geniusResult = await entityAudit.auditGenius(artist.name);
            cache.set(geniusCacheKey, geniusResult, 0); // 0 = Unlimited TTL
        }

        // Run other entity audits
        // Google KG etc. should run fresh if forceRefresh is true (via bypassing the main cacheKey check above)
        const [googleKG, wikipedia, discogs, fandom] = await Promise.all([
            entityAudit.auditGoogleKG(artist.name),
            entityAudit.auditWikipedia(artist.name),
            entityAudit.auditDiscogs(artist.name),
            entityAudit.auditFandom(artist.name)
        ]);

        const genius = geniusResult;

        const auditResults = {
            googleKG,
            wikipedia,
            discogs,
            genius,
            fandom,
            schemaValid: googleKG.schemaValid || false,
            linksAccurate: true
        };

        const healthScore = entityAudit.calculateHealthScore(auditResults);
        const inconsistencies = entityAudit.detectInconsistencies(auditResults, artist);
        const schemaLD = entityAudit.generateSchemaLD(artist, auditResults);

        // --- GROQ AI ANALYSIS CACHING (Indefinite for specific report state) ---
        // User said: "cache the initial reports... one pull, the rest let them know money is being spent"
        // If we forceRefresh, we pay for new AI.
        // The AI output is part of the 'result' object which is cached for 2 weeks.
        // But if we bypass that 2 week cache, we hit this block.
        // To save money even when refreshing other things, we *could* cache the AI part separately.
        // But usually a refresh implies "Analyze the NEW data".
        // So I will regenerate AI analysis on refresh.

        let aiAnalysis = null;
        try {
            const groqPrompt = `Analyze entity health for ${artist.name}: Google=${googleKG.status}, Wiki=${wikipedia.status}, Score=${healthScore}/100. Provide: summary, top 3 actions, streaming correlation insight. Format as JSON.`;

            const groqResponse = await groq.chat.completions.create({
                messages: [{ role: 'user', content: groqPrompt }],
                model: 'llama-3.1-8b-instant',
                temperature: 0.7,
                max_tokens: 400
            });

            aiAnalysis = JSON.parse(groqResponse.choices[0]?.message?.content || '{}');
        } catch (error) {
            aiAnalysis = { summary: 'AI analysis unavailable', criticalActions: [], correlationInsight: 'Manual review needed' };
        }

        const issues = inconsistencies.map(inc => ({
            severity: inc.severity || 'medium',
            platform: inc.platform || 'multiple',
            issue: inc.type,
            recommendation: inc.impact || 'Review entity data'
        }));

        const result = {
            artistId, artistName: artist.name, auditDate: new Date().toISOString(),
            healthScore, platforms: { googleKG, wikipedia, discogs, genius, fandom },
            schemaLD, issues, aiAnalysis, cached: false
        };

        cache.set(cacheKey, result, 1209600);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Entity audit failed', message: error.message });
    }
});

// Get monthly sales (with access check)
app.get('/v3/artists/:id/monthly-sales', authenticateToken, (req, res) => {
    if (!hasArtistAccess(req.user, req.params.id)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const artist = labelData.artists.find(a => a.id === req.params.id);
    if (!artist) {
        return res.status(404).json({ error: 'Artist not found' });
    }

    res.json({
        artistId: artist.id,
        artistName: artist.name,
        merchSales: artist.merch.monthlySales,
        tourRevenue: artist.touring.shows.map(show => ({
            date: show.date,
            venue: show.venue,
            revenue: show.revenue
        }))
    });
});

// THIRD-PARTY INTEGRATION ENDPOINTS
// ============================================================================

// Get integration status
app.get('/v3/integrations/status', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const integrations = userIntegrations[userId] || {};

    // Return status for all supported services
    const status = Object.keys(SERVICES).map(key => ({
        id: key,
        name: SERVICES[key].name,
        connected: integrations[key]?.connected || false,
        lastSync: integrations[key]?.lastSync || null,
        quotaUsed: Math.floor(Math.random() * 80) // Mock quota usage 0-80%
    }));

    res.json({ services: status });
});

// Start OAuth flow (Mock / Stub)
app.get('/v3/integrations/auth/:service', authenticateToken, (req, res) => {
    const service = req.params.service;
    if (!SERVICES[service]) return res.status(404).json({ error: 'Service not found' });

    // In a real app, this would redirect to the provider's OAuth page
    // For now, we'll simulate the mock connection immediately

    // Initialize user store if needed
    if (!userIntegrations[req.user.id]) userIntegrations[req.user.id] = {};

    // Simulate success
    userIntegrations[req.user.id][service] = {
        connected: true,
        token: `mock_token_${Date.now()}`,
        lastSync: new Date().toISOString()
    };

    res.json({ success: true, message: `Connected to ${SERVICES[service].name} (Mock)` });
});

// Disconnect
app.post('/v3/integrations/disconnect', authenticateToken, (req, res) => {
    const { service } = req.body;
    if (!userIntegrations[req.user.id]) return res.json({ success: true });

    if (userIntegrations[req.user.id][service]) {
        userIntegrations[req.user.id][service].connected = false;
        delete userIntegrations[req.user.id][service];
    }

    res.json({ success: true });
});

// ============================================================================
// AI INTELLIGENCE (Groq Integration)
// ============================================================================

// Analyze with Groq (Real LPU) + Optimization
app.post('/v3/ai/query', authenticateToken, async (req, res) => {
    try {
        const { prompt, artistId, query, forceRefresh } = req.body;
        const userPrompt = prompt || query;

        if (!userPrompt) return res.status(400).json({ error: 'Prompt required' });

        // Optimization: Check Cache
        const cacheKey = `${userPrompt.trim()}_${artistId || 'label'}`;

        if (!forceRefresh) {
            const cached = cache.get(cacheKey);
            if (cached) {
                return res.json({
                    success: true,
                    answer: cached,
                    insights: cached,
                    source: 'cache'
                });
            }
        }

        // Retrieve & Summarize Context Data
        let contextData = {};
        if (artistId) {
            const artist = labelData.artists.find(a => a.id === artistId);
            if (artist && (req.user.role === 'admin' || hasArtistAccess(req.user, artistId))) {
                // Compressed context to save tokens
                contextData = {
                    name: artist.name,
                    stats: `Listeners: ${artist.monthlyListeners}, Streams: ${artist.totalStreams}, Growth: ${artist.growthRate}%`,
                    revenue: `Total: $${calculateTotalRevenue(artist)} (Top: ${Object.entries(artist.revenue).sort((a, b) => b[1] - a[1])[0]?.[0]})`
                };
            }
        }

        // Call Groq (Use Global Client)
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'AI analyst for mau5trap. Concise, data-driven insights.',
                },
                {
                    role: 'user',
                    content: `${userPrompt.slice(0, 500)}\nData: ${JSON.stringify(contextData)}`,
                },
            ],
            model: 'llama-3.1-8b-instant',
            temperature: 0.7,
            max_tokens: 300,
        });

        const insights = chatCompletion.choices[0]?.message?.content || 'No insights generated.';

        // Cache result
        cache.set(cacheKey, insights);

        // Log usage (Mock logging)
        console.log(`[Groq Usage] Tokens: ${chatCompletion.usage?.total_tokens || 'N/A'}`);

        res.json({
            success: true,
            answer: insights,
            insights,
            model: 'llama-3.1-8b-instant'
        });

    } catch (err) {
        console.error('Groq API Error:', err);

        if (process.env.NODE_ENV === 'development') {
            return res.json({
                success: true,
                answer: "[Dev Fallback] Growth is stable at 2.5%. Recommend increasing tour frequency in EU.",
                source: 'fallback'
            });
        }

        res.status(500).json({
            error: 'AI query failed',
            details: err.message
        });
    }
});

// Alias old endpoint to new one for compatibility
app.post('/v3/ai/analyze', authenticateToken, (req, res) => {
    // Redirect logic handled by reusing the handler if express supports it, or just 307 redirect
    // easier to just copy logic or call internal function, but for now let's just expose Query above and update frontend?
    // Actually, let's make this endpoint strictly call the new logic.
    res.redirect(307, '/v3/ai/query');
});

// ============================================================================
// CORE OPS: ROYALTIES & RIGHTS
// ============================================================================

// Calculate Royalties
app.post('/v3/royalties/calculate', authenticateToken, (req, res) => {
    const { artistId, revenueSources, splits } = req.body;

    // Default logic if not provided
    const targetSplits = splits || { artist: 0.7, label: 0.3 };
    const targetSources = revenueSources || ['streaming', 'merch', 'touring'];

    const artist = labelData.artists.find(a => a.id === artistId);
    if (!artist) return res.status(404).json({ error: 'Artist not found' });

    let totalRevenue = 0;
    const breakdown = {};

    targetSources.forEach(source => {
        let amount = 0;
        if (source === 'streaming') amount = artist.revenue.streaming;
        if (source === 'merch') amount = artist.revenue.merch;
        if (source === 'touring') amount = artist.revenue.touring;

        breakdown[source] = amount;
        totalRevenue += amount;
    });

    res.json({
        artistName: artist.name,
        totalRevenue,
        payout: {
            artist: totalRevenue * targetSplits.artist,
            label: totalRevenue * targetSplits.label
        },
        breakdown,
        splits: targetSplits
    });
});

// Generate Contract (PDF Mock)
app.get('/v3/rights/contracts', authenticateToken, (req, res) => {
    const { artistId } = req.query;
    const artist = labelData.artists.find(a => a.id === artistId);

    // In production, use PDFKit to generate real file
    res.json({
        success: true,
        message: `Contract generated for ${artist ? artist.name : 'Unknown Artist'}`,
        downloadUrl: `/v3/reports/contracts/${artistId || 'template'}.pdf`,
        status: 'draft',
        terms: {
            term: '3 Years',
            territory: 'World',
            royaltyRate: '70% Net Receipts'
        }
    });
});

// ============================================================================
// ============================================================================
// CORE OPS: ARTIST DISCOVERY (SCOUTING)
// ============================================================================

// Mutable Prospects Store
let prospects = [
    { id: 'p1', name: 'Neon Horizon', genre: 'Progressive House', listeners: 12000, engagement: 15000, 'matchScore': 95, socialGrowth: '+15%' },
    { id: 'p2', name: 'Glitch Protocol', genre: 'Techno', listeners: 8500, engagement: 9000, 'matchScore': 88, socialGrowth: '+22%' },
    { id: 'p3', name: 'Analog Soul', genre: 'Deep House', listeners: 45000, engagement: 55000, 'matchScore': 72, socialGrowth: '+5%' },
    { id: 'p4', name: 'Cyber Breath', genre: 'Progressive House', listeners: 15000, engagement: 18000, 'matchScore': 91, socialGrowth: '+12%' },
    { id: 'p5', name: 'System 404', genre: 'Techno', listeners: 2000, engagement: 2500, 'matchScore': 60, socialGrowth: '+8%' },
    { id: 'p6', name: 'Velvet Coding', genre: 'Electronica', listeners: 32000, engagement: 40000, 'matchScore': 85, socialGrowth: '+30%' }
];

// Search Prospects
// [DEPRECATED] Old Scout Endpoints - See lines 2680+ for v3.1 implementation
// app.get('/v3/anr/scout', authenticateToken, (req, res) => { ... });
// app.post('/v3/anr/scout', authenticateToken, (req, res) => { ... });

// A&R Submissions Store (In-Memory for Demo)
const anrSubmissions = [
    {
        id: 'sub_1',
        artist: 'Ghost Data',
        track: 'Void Walker',
        genre: 'Synthwave',
        url: 'https://soundcloud.com/ghost-data/void-walker',
        votes: 15,
        status: 'pending',
        submittedAt: new Date().toISOString()
    },
    {
        id: 'sub_2',
        artist: 'Testpilot',
        track: 'Sunspot',
        genre: 'Techno',
        url: 'https://open.spotify.com/track/0abcdef123456',
        votes: 42,
        status: 'shortlisted',
        submittedAt: new Date().toISOString()
    }
];

// Get Submissions
app.get('/v3/anr/submissions', authenticateToken, (req, res) => {
    res.json({ submissions: anrSubmissions });
});

// Submit Demos
app.post('/v3/anr/submissions', authenticateToken, (req, res) => {
    const { artist, track, url, genre } = req.body;
    if (!artist || !track || !url) return res.status(400).json({ error: 'Missing fields' });

    const newSub = {
        id: `sub_${Date.now()}`,
        artist,
        track,
        genre: genre || 'Electronic',
        url,
        votes: 0,
        voters: {}, // Tracks userId -> direction
        status: 'pending',
        submittedAt: new Date().toISOString()
    };

    anrSubmissions.unshift(newSub);
    res.json({ success: true, submission: newSub });
});

// Vote on Submission
// Vote on Submission (One Vote Per User Logic)
app.post('/v3/anr/submissions/:id/vote', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { direction } = req.body; // 'up' or 'down'
    const userId = req.user.id;

    const sub = anrSubmissions.find(s => s.id === id);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    // Initialize voters map if missing (migration safety)
    if (!sub.voters) sub.voters = {};

    const previousVote = sub.voters[userId];

    if (previousVote === direction) {
        // Toggle off (remove vote)
        if (direction === 'up') sub.votes--;
        else sub.votes++;
        delete sub.voters[userId];
    } else {
        // Vote (or Switch)
        if (previousVote === 'up') sub.votes--; // Undo previous up
        if (previousVote === 'down') sub.votes++; // Undo previous down

        if (direction === 'up') sub.votes++;
        if (direction === 'down') sub.votes--;

        sub.voters[userId] = direction;
    }

    res.json({ success: true, votes: sub.votes, userVote: sub.voters[userId] || null });
});

// Delete Submission (Admin Only)
app.delete('/v3/anr/submissions/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { id } = req.params;
    const index = anrSubmissions.findIndex(s => s.id === id);
    if (index === -1) return res.status(404).json({ error: 'Submission not found' });

    anrSubmissions.splice(index, 1);
    res.json({ success: true });
});

// Get Detailed Stats (Aggregated/Privacy-Safe)
// Get Demo Rating (Public/Aggregated)
app.get('/v3/anr/demos/:demoId/rating', authenticateToken, async (req, res) => {
    const { demoId } = req.params;
    const includeTally = req.query.includeTally === 'true';

    // Look in active state
    let demo = anrState.demos.find(s => s.id === demoId);
    let votes = 0;

    if (demo) {
        votes = (demo.ratings || []).length;
    } else {
        // Fallback to legacy submissions
        const sub = anrSubmissions.find(s => s.id === demoId);
        if (!sub) return res.status(404).json({ error: 'Not found' });
        votes = sub.votes || 0;
    }

    // Logic: Calculate Stars & Ratio (Real User Count)
    const totalUsers = await User.count(); // Real Denominator

    let stars = 0;
    let ratio = 0;

    if (votes > 0 && totalUsers > 0) {
        ratio = votes / totalUsers;
        stars = Math.round(ratio * 5);
    }

    const response = { stars };

    if (includeTally) {
        response.artistVotes = votes;
        response.totalVotes = totalUsers;
        response.ratio = parseFloat(ratio.toFixed(4));
    }

    res.json(response);
});

// AI Competitive Evaluation
app.post('/v3/anr/evaluate', authenticateToken, (req, res) => {
    const { prospectId } = req.body;
    const prospectName = prospectId === 'p1' ? 'Neon Horizon' : 'Unknown Artist';

    const report = {
        prospect: prospectName,
        benchmark: 'deadmau5',
        signabilityScore: Math.floor(Math.random() * (95 - 70) + 70),
        analysis: `AI analysis indicates ${prospectName} shares 82% sonic similarity with the benchmark.`,
        projectedRevenue: { y1: 150000, y2: 450000, y3: 1200000 },
        risks: ['High competition in genre', 'Limited touring history'],
        recommendedDeal: '360 Deal / 50-50 Split'
    };

    setTimeout(() => res.json(report), 1000);
});

// Development Report (AI) - Legacy Endpoint (Keep for compatibility)
app.get('/v3/artists/:id/development', authenticateToken, (req, res) => {
    const artist = labelData.artists.find(a => a.id === req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artist not found' });

    res.json({
        artist: artist.name,
        projection: 'Positive',
        insights: [
            `${artist.name}'s streaming growth is outpacing the genre average by 15%.`,
            "Strong engagement in South America suggests potential for a Q3 tour leg.",
            "Merch sales per listener are lower than expected; strictly limit supply for next drop."
        ],
        focusAreas: ['TikTok Content', 'LATAM Tour', 'Limited Merch']
    });
});

// ============================================================================
// CORE OPS: MARKETING AUTOMATION
// ============================================================================

app.post('/v3/marketing/campaigns', authenticateToken, (req, res) => {
    const { artistId, type, platforms } = req.body;

    const strategies = {
        'playlist-push': ['Submit to Spotify Editorial', 'Hire independent curators', 'Run marquee ads'],
        'social-growth': ['Post 15s clips daily', 'Collaborate with influencers', 'Host AMA'],
        'tour-promo': ['Run geo-targeted ads', 'Email presale codes', 'Ticket giveaways']
    };

    const plan = strategies[type] || ['General brand awareness ads'];

    res.json({
        campaignId: `cmp_${Date.now()}`,
        status: 'created',
        plan: plan.map((step, i) => ({ step: i + 1, action: step, platform: platforms ? platforms[i % platforms.length] : 'all' })),
        budget: 'Pending Approval'
    });
});

// Test Rate Limit (Debug Endpoint)
app.get('/v3/integrations/test-limit/:service', authenticateToken, async (req, res) => {
    const service = req.params.service;
    if (!limiters[service]) return res.status(404).json({ error: 'Service not found' });

    const limiter = limiters[service];
    const startTime = Date.now();

    // Attempt to consume a token
    await limiter.throttle();

    res.json({
        service,
        waited: Date.now() - startTime,
        tokensRemaining: limiter.tokens.toFixed(2)
    });
});

// ============================================================================
// FAN ENGAGEMENT ENDPOINTS
// ============================================================================

// Fan Demographics & Engagement Endpoint
app.get('/v3/fans/demographics', authenticateToken, (req, res) => {
    // 1. Calculate Top Movers (highest growth rate)
    const validArtists = labelData.artists.filter(a => typeof a.growthRate === 'number');
    const topMovers = validArtists
        .sort((a, b) => b.growthRate - a.growthRate)
        .slice(0, 5)
        .map(a => ({
            id: a.id,
            name: a.name,
            growth: a.growthRate,
            engagement: a.social?.engagementRate || 0
        }));

    // 2. Global Demographics (Mock Aggregation)
    const demographics = {
        age: [
            { range: '18-24', value: 35 },
            { range: '25-34', value: 45 },
            { range: '35-44', value: 15 },
            { range: '45+', value: 5 }
        ],
        gender: [
            { label: 'Male', value: 55 },
            { label: 'Female', value: 42 },
            { label: 'Other', value: 3 }
        ],
        locations: [
            { city: 'Los Angeles', country: 'USA', value: 120000 },
            { city: 'London', country: 'UK', value: 85000 },
            { city: 'Toronto', country: 'Canada', value: 60000 },
            { city: 'Berlin', country: 'Germany', value: 45000 },
            { city: 'Sydney', country: 'Australia', value: 30000 }
        ],
        platformGrowth: [
            { platform: 'Spotify', growth: 12.5 },
            { platform: 'TikTok', growth: 28.4 },
            { platform: 'Instagram', growth: 5.2 },
            { platform: 'YouTube', growth: 8.1 }
        ]
    };

    res.json({ topMovers, demographics });

});

// ============================================================================
// AUTHENTICATION & SECURITY ENDPOINTS
// ============================================================================

// [REMOVED DUPLICATE AUTH ROUTES]
// [DUPLICATE LOGIC REMOVED]

// ============================================================================
// USER MANAGEMENT (ADMIN)
// ============================================================================

// Create User
app.post('/v3/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { email, password, name, role, pageAccess } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({
            email,
            passwordHash: hashedPassword,
            name,
            role: role || 'viewer',
            pageAccess: pageAccess || []
        });
        res.json({ success: true, user: { id: newUser.id, email: newUser.email, name: newUser.name } });
    } catch (err) {
        res.status(400).json({ error: 'User creation failed (Email likely exists)' });
    }
});

// Update User
app.put('/v3/users/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { id } = req.params;
    const { email, role, pageAccess, name, password } = req.body;

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (email) user.email = email;
    if (name) user.name = name;
    if (role) user.role = role;
    if (pageAccess) user.pageAccess = pageAccess;
    if (password) user.passwordHash = await bcrypt.hash(password, 10);

    await user.save();
    res.json({ success: true });
});

// Delete User
app.delete('/v3/users/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    await User.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
});

// ============================================================================
// A&R WAR ROOM ENDPOINTS
// ============================================================================

// In-memory Shared State
// In-memory Shared State
const anrState = {
    whiteboard: "Currently Reviewing: Q1 2026 Compilation Submissions.\nFocus: Tech House / Minimal.",
    nowListening: {
        url: "https://soundcloud.com/mau5trap/example-demo",
        updatedBy: "deadmau5",
        timestamp: new Date().toISOString()
    },
    demos: [
        {
            id: 'demo1',
            title: 'Analog Dreams',
            artist: 'Unknown Producer',
            ratings: [],
            submittedBy: 'admin',
            status: 'reviewing'
        },
        {
            id: 'demo2',
            title: 'Cyberpunk Bass',
            artist: 'Neon Glitch',
            ratings: [],
            submittedBy: 'rezz',
            status: 'high-priority'
        },
        {
            id: 'demo3',
            title: 'Deep Space',
            artist: 'Void Walker',
            ratings: [],
            submittedBy: 'admin',
            status: 'new'
        }
    ]
};

// --- USER MANAGEMENT ENDPOINTS ---

// List Users (Admin Only)
app.get('/v3/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    try {
        const users = await User.findAll({ attributes: { exclude: ['passwordHash', 'resetToken', 'resetTokenExpiry'] } });
        // Parse pageAccess for frontend
        const parsedUsers = users.map(u => ({ ...u.toJSON(), pageAccess: JSON.parse(u.pageAccess || '[]') }));
        res.json(parsedUsers);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create User (Admin Only)
app.post('/v3/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { email, password, name, role, artistAccess, pageAccess } = req.body;
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await User.create({
            email, passwordHash, name, role, artistAccess,
            pageAccess: JSON.stringify(pageAccess || ['overview'])
        });
        res.json({ success: true, user: { id: newUser.id, email: newUser.email } });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// Update User (Admin Only)
app.put('/v3/users/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    const { name, role, artistAccess, pageAccess, password } = req.body;
    try {
        const user = await User.findByPk(id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (name) user.name = name;
        if (role) user.role = role;
        if (artistAccess) user.artistAccess = artistAccess;
        if (pageAccess) user.pageAccess = JSON.stringify(pageAccess);
        if (password) user.passwordHash = await bcrypt.hash(password, 10);

        await user.save();
        res.json({ success: true, user: { id: user.id, email: user.email } });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete User (Admin Only)
app.delete('/v3/users/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { id } = req.params;
    try {
        const user = await User.findByPk(id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Prevent deleting self (simple safety)
        if (user.email === req.user.email) return res.status(400).json({ error: 'Cannot delete yourself' });

        await user.destroy();
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get Full State (Sanitized)
app.get('/v3/anr/state', authenticateToken, (req, res) => {
    // Deep copy to avoid mutating shared state
    const safeState = JSON.parse(JSON.stringify(anrState));

    // Sanitize demos: Remove raw ratings, add user context
    safeState.demos = safeState.demos.map(d => {
        const hasVoted = d.ratings ? d.ratings.some(r => r.user === req.user.email) : false;
        // aggregate counts are meant to be hidden until toggle, 
        // but we can send basic status or just strip ratings.
        // The user requirement says "Votes remain hidden by default", implies we shouldn't even send the count?
        // "When the current user clicks that icon it reveals... Sends a request to the API"
        // This implies the count is NOT present in the initial state load.

        const { ratings, ...demoData } = d; // Destructure to exclude ratings
        return {
            ...demoData,
            hasVoted
        };
    });

    res.json(safeState);
});

// Update Whiteboard
app.post('/v3/anr/whiteboard', authenticateToken, (req, res) => {
    const { message } = req.body;
    if (typeof message === 'string') {
        anrState.whiteboard = message;
        res.json({ success: true, whiteboard: anrState.whiteboard });
    } else {
        res.status(400).json({ error: 'Invalid message format' });
    }
});

// Update Now Listening
app.post('/v3/anr/listening', authenticateToken, (req, res) => {
    const { url } = req.body;
    if (url) {
        anrState.nowListening = {
            url,
            updatedBy: req.user.email.split('@')[0],
            timestamp: new Date().toISOString()
        };
        res.json({ success: true, nowListening: anrState.nowListening });
    } else {
        res.status(400).json({ error: 'URL is required' });
    }
});

// Vote on Demo (5-Star Rating)
// Vote Toggle (Binary Support)
// Vote on Demo (Explicit Action)
app.post('/v3/anr/vote/:demoId', authenticateToken, async (req, res) => {
    const { demoId } = req.params;
    const { action } = req.body; // 'add' or 'remove'
    const userEmail = req.user.email;

    const demo = anrState.demos.find(d => d.id === demoId);
    if (!demo) return res.status(404).json({ error: 'Demo not found' });

    if (!demo.ratings) demo.ratings = [];

    const existingVoteIndex = demo.ratings.findIndex(r => r.user === userEmail);
    let hasVoted = existingVoteIndex >= 0;

    if (action === 'add') {
        if (existingVoteIndex >= 0) {
            // Already voted
            demo.ratings[existingVoteIndex].timestamp = new Date().toISOString();
        } else {
            demo.ratings.push({ user: userEmail, timestamp: new Date().toISOString() });
        }
        hasVoted = true; // Ensure hasVoted is true after adding/updating
    } else if (action === 'remove') {
        if (existingVoteIndex >= 0) {
            demo.ratings.splice(existingVoteIndex, 1);
        }
        hasVoted = false;
    } else {
        return res.status(400).json({ error: 'Invalid action. Use "add" or "remove".' });
    }

    // Calculate Aggregated Stats for Response (Real User Count)
    const votes = demo.ratings.length;
    const totalUsers = await User.count();

    let stars = 0;
    let ratio = 0;

    if (votes > 0 && totalUsers > 0) {
        ratio = votes / totalUsers;
        stars = Math.round(ratio * 5);
    }

    res.json({
        success: true,
        hasVoted,
        demo: {
            id: demo.id,
            artistVotes: votes,
            totalVotes: totalUsers,
            ratio: parseFloat(ratio.toFixed(4)),
            stars
        }
    });
});

// Get Vote Stats (Reveal)
app.get('/v3/anr/stats/:demoId', authenticateToken, async (req, res) => {
    const { demoId } = req.params;
    const demo = anrState.demos.find(d => d.id === demoId);
    if (!demo) return res.status(404).json({ error: 'Demo not found' });

    const artistVotes = demo.ratings ? demo.ratings.length : 0;

    // Get total active users for ratio context
    let totalVotes = 10;
    try {
        const dbCount = await User.count();
        if (dbCount > 0) totalVotes = dbCount;
    } catch (e) { console.error('Error counting users:', e.message); }

    // Ratio and Stars Calculation
    const ratio = totalVotes > 0 ? (artistVotes / totalVotes) : 0;
    const stars = Math.min(5, parseFloat((ratio * 5).toFixed(1)));

    res.json({
        artistVotes,
        totalVotes,
        ratio: parseFloat(ratio.toFixed(2)),
        stars
    });
});

// Submit Demo (Mock)
app.post('/v3/anr/demos', authenticateToken, (req, res) => {
    const { title, artist } = req.body;
    const newDemo = {
        id: `demo${Date.now()}`,
        title: title || 'Untitled',
        artist: artist || 'Unknown',
        ratings: [], // Initialize empty ratings
        submittedBy: req.user.email.split('@')[0],
        status: 'new'
    };
    anrState.demos.unshift(newDemo);
    res.json({ success: true, demos: anrState.demos });
});

// ============================================================================
// CAMPAIGNS / CRM ENDPOINTS
// ============================================================================

app.get('/v3/campaigns/stats', authenticateToken, (req, res) => {
    // Aggregate global CRM stats
    const stats = labelData.artists.reduce((acc, artist) => {
        if (artist.crm) {
            acc.totalEmails += artist.crm.emailCount;
            acc.totalSMS += artist.crm.smsCount;
            acc.presaleSignups += artist.crm.presaleSignups;
        }
        return acc;
    }, { totalEmails: 0, totalSMS: 0, presaleSignups: 0 });

    // Mock Database Health History (last 6 months)
    const history = [
        { month: 'Jul', email: Math.floor(stats.totalEmails * 0.7), sms: Math.floor(stats.totalSMS * 0.6) },
        { month: 'Aug', email: Math.floor(stats.totalEmails * 0.75), sms: Math.floor(stats.totalSMS * 0.7) },
        { month: 'Sep', email: Math.floor(stats.totalEmails * 0.8), sms: Math.floor(stats.totalSMS * 0.8) },
        { month: 'Oct', email: Math.floor(stats.totalEmails * 0.85), sms: Math.floor(stats.totalSMS * 0.85) },
        { month: 'Nov', email: Math.floor(stats.totalEmails * 0.9), sms: Math.floor(stats.totalSMS * 0.9) },
        { month: 'Dec', email: stats.totalEmails, sms: stats.totalSMS }
    ];

    res.json({ stats, history });
});

// ============================================================================
// REPORT GENERATION (PDF)
// ============================================================================

// Generate monthly report (PDF)
app.get('/v3/reports/monthly/:artistId/:month', authenticateToken, async (req, res) => {
    const { artistId, month } = req.params;

    if (!hasArtistAccess(req.user, artistId)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const artist = labelData.artists.find(a => a.id === artistId);
    if (!artist) {
        return res.status(404).json({ error: 'Artist not found' });
    }

    try {
        const pdfBuffer = await generateMonthlyReport(artist, month);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${artist.name}_${month}_report.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        res.status(500).json({ error: 'Report generation failed', message: error.message });
    }
});

// Generate and save monthly report for auto-printing
app.post('/v3/reports/generate-all', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const { month } = req.body;
    if (!month) {
        return res.status(400).json({ error: 'Month parameter required (YYYY-MM)' });
    }

    const reportsDir = path.join(__dirname, 'reports', month);
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    const generatedReports = [];

    for (const artist of labelData.artists) {
        try {
            const pdfBuffer = await generateMonthlyReport(artist, month);
            const filename = `${artist.name}_${month}_report.pdf`;
            const filepath = path.join(reportsDir, filename);

            fs.writeFileSync(filepath, pdfBuffer);
            generatedReports.push({ artist: artist.name, filename, path: filepath });
        } catch (error) {
            console.error(`Failed to generate report for ${artist.name}:`, error);
        }
    }

    res.json({
        message: 'Reports generated successfully',
        count: generatedReports.length,
        reports: generatedReports,
        directory: reportsDir
    });
});

// Helper function to calculate total revenue
// Helper: Calculate Total Revenue
function calculateTotalRevenue(artist) {
    if (!artist.revenue) return 0;
    return Object.values(artist.revenue).reduce((sum, val) => sum + (typeof val === 'number' ? val : 0), 0);
}

// Helper function to generate PDF report
async function generateMonthlyReport(artist, month) {
    return new Promise(async (resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // --- STYLES ---
        const colors = {
            primary: '#00FF00', // mau5trap green
            dark: '#1a1a1a',
            text: '#000000',
            grey: '#666666',
            lightGrey: '#f5f5f5'
        };

        // --- HEADER ---
        doc.rect(0, 0, 612, 100).fill(colors.dark);
        doc.fillColor('white').fontSize(26).font('Helvetica-Bold').text('mau5trap', 50, 35);
        doc.fillColor(colors.primary).fontSize(10).font('Helvetica').text('INTELLIGENCE REPORT', 50, 65);

        doc.fillColor('white').fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, 400, 35, { align: 'right', width: 160 });
        doc.fontSize(10).text(`Period: ${month}`, 400, 55, { align: 'right', width: 160 });

        doc.fillColor('black');
        doc.moveDown(5);

        // --- HELPER: DIVIDER ---
        function addDivider() {
            doc.moveDown(0.5).lineWidth(1).strokeColor('#e0e0e0').moveTo(50, doc.y).lineTo(562, doc.y).stroke().moveDown(1);
        }

        // --- ARTIST SUMMARY ---
        doc.fontSize(20).font('Helvetica-Bold').text(artist.displayName || artist.name);
        doc.fontSize(12).font('Helvetica').fillColor(colors.grey).text(`${artist.tier.toUpperCase()} TIER • ${artist.id}`);
        doc.moveDown(0.5);

        // --- EXECUTIVE SUMMARY ---
        doc.fillColor(colors.dark).fontSize(16).font('Helvetica-Bold').text('Executive Summary');
        addDivider();
        doc.fontSize(12).font('Helvetica').fillColor(colors.text);

        const totalRevenue = calculateTotalRevenue(artist); // Ensure helper is defined above or hoisted
        const topSourceEntry = Object.entries(artist.revenue).filter(([k, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1])[0];
        const topSource = topSourceEntry ? topSourceEntry[0].toUpperCase() : 'N/A';

        doc.text(`Total Revenue: $${totalRevenue.toLocaleString()}`);
        doc.text(`Growth Rate: ${artist.growthRate || 0}% (${(artist.growthRate || 0) > 0 ? 'Positive' : 'Stable'} Trend)`);
        doc.text(`Top Revenue Source: ${topSource}`);

        // --- AI STRATEGIC INSIGHTS (Groq LPU) ---
        doc.moveDown(1);
        doc.fillColor(colors.primary).fontSize(14).font('Helvetica-Bold').text('AI STRATEGIC INSIGHTS');
        doc.fontSize(10).font('Helvetica').fillColor(colors.text);

        try {
            // Check cache for this report's AI insight
            const reportCacheKey = `report_ai_${artist.id}_${month}`;
            let insightText = cache.get(reportCacheKey);

            if (!insightText) {
                // Generate real-time insights (Costly)
                const aiPrompt = `Analyze these music artist metrics: Name: ${artist.name}, Monthly Listeners: ${artist.monthlyListeners}, Growth Rate: ${artist.growthRate}%, Revenue: $${totalRevenue}. Provide 2 sentences: 1) projected growth, 2) one strategic key decision. No preamble.`;

                const aiResponse = await groq.chat.completions.create({
                    messages: [{ role: 'user', content: aiPrompt }],
                    model: 'llama-3.1-8b-instant',
                    max_tokens: 100
                });
                insightText = aiResponse.choices[0]?.message?.content || "AI analysis unavailable.";

                // Cache indefinitely for this month's report
                cache.set(reportCacheKey, insightText, 0);
            }

            doc.text(insightText, { indent: 10, align: 'justify', width: 500 });
        } catch (err) {
            console.error("PDF AI Error:", err.message);
            doc.text("AI Insights unavailable at this time (Service Offline).", { indent: 10 });
        }

        doc.moveDown(1);

        // --- KPIS (Grid) ---
        const kpiStart = doc.y;

        function drawKPI(label, value, x, y, color = colors.text) {
            doc.fillColor(colors.grey).fontSize(9).font('Helvetica-Bold').text(label, x, y);
            doc.fillColor(color).fontSize(14).text(value, x, y + 15);
        }

        drawKPI('LISTENERS', artist.monthlyListeners.toLocaleString(), 50, kpiStart);
        drawKPI('STREAMS', artist.totalStreams.toLocaleString(), 180, kpiStart);
        drawKPI('GROWTH', `${artist.growthRate}%`, 310, kpiStart, artist.growthRate > 0 ? 'green' : 'red');
        drawKPI('ROI', `${artist.roi}x`, 440, kpiStart);

        doc.y = kpiStart + 45; // Manual spacing after custom KPI grid

        // --- METRICS LIST ---
        doc.fillColor(colors.text).fontSize(10).font('Helvetica');
        doc.text(`Genres: ${artist.genreHybrids || 'N/A'}`);
        if (artist.influences) doc.text(`Influences: ${artist.influences.join(', ')}`);
        if (artist.collaborations) doc.text(`Collaborations: ${artist.collaborations.join(', ')}`);
        doc.moveDown(2);

        // --- REVENUE TABLE ---
        doc.font('Helvetica-Bold').fontSize(14).text('Revenue Breakdown');
        doc.moveDown(0.5);


        const revenueTable = {
            headers: [
                { label: "Source", property: 'source', width: 220 },
                { label: "Amount", property: 'amount', width: 100, align: 'right' },
                { label: "Share", property: 'share', width: 100, align: 'right' }
            ],
            datas: Object.entries(artist.revenue).map(([key, val]) => {
                if (key === 'streamingBreakdown' || typeof val === 'object') return null; // Skip non-numeric
                return {
                    source: key.charAt(0).toUpperCase() + key.slice(1),
                    amount: `$${val.toLocaleString()}`,
                    share: `${(val / totalRevenue * 100).toFixed(1)}%`
                };
            }).filter(Boolean)
        };
        // Total Row
        revenueTable.datas.push({
            source: 'TOTAL REVENUE',
            amount: `$${totalRevenue.toLocaleString()}`,
            share: '100%',
            options: { fontSize: 12, bold: true }
        });

        await doc.table(revenueTable, {
            prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
            prepareRow: (row, i) => {
                doc.font("Helvetica").fontSize(10);
                if (i % 2 === 0) doc.addBackground(doc.y, doc.page.width - 80, 20, { color: colors.lightGrey }); // Custom stripe attempt or let library handle
            }
        });
        doc.moveDown(2);

        // --- SUSTAINABILITY (CAREER LONGEVITY) ---
        if (artist.sustainability) {
            doc.addPage();
            doc.fillColor(colors.dark).fontSize(16).font('Helvetica-Bold').text('SUSTAINABILITY (CAREER LONGEVITY)');
            addDivider();

            const sustain = artist.sustainability;
            const startY = doc.y;

            // DYNAMIC CALCULATION: Diversification Ratio
            const revenueStreams = artist.revenue || {};
            const totalRev = calculateTotalRevenue(artist);
            const diversification = {};
            if (totalRev > 0) {
                // Calculate percentage for each numeric revenue source
                Object.entries(revenueStreams).forEach(([key, val]) => {
                    if (typeof val === 'number') { // ignore 'streamingBreakdown' objects etc
                        const pct = ((val / totalRev) * 100).toFixed(1);
                        diversification[key] = parseFloat(pct);
                    }
                });
            }

            // DYNAMIC CALCULATION: Revenue Stability (Mock Logic based on growthRate)
            // Ideally we'd scan `artist.revenueHistory` but we lack that data structure.
            // Proxy: High growth (>5%) = Medium Stability (Volatile success). Low growth (-2 to 2%) = High Stability.
            let stabilityScore = 85;
            let stabilityContext = "(Low variance; established catalog)";
            const growth = artist.growthRate || 0;

            if (growth > 10) {
                stabilityScore = 70;
                stabilityContext = "(High volatility due to rapid growth)";
            } else if (growth < -5) {
                stabilityScore = 60;
                stabilityContext = "(Declining revenue trend)";
            }
            const calculatedRevenueStability = `${stabilityScore}% ${stabilityContext}`;


            // Metrics Grid (Reusing drawKPI)
            drawKPI('LONGEVITY SCORE', sustain.longevityScore.toString(), 50, startY);
            drawKPI('LEGACY IMPACT', sustain.legacyImpact.toString(), 200, startY);

            doc.y = startY + 60;

            // Detailed Metrics
            doc.fillColor(colors.text).fontSize(12).font('Helvetica-Bold').text('Revenue Stability Index');
            // Prefer dynamic calculation if mocked "string" is generic, or enhance existing
            doc.fontSize(10).font('Helvetica').text(calculatedRevenueStability); // Use our new calc
            doc.moveDown(0.5);

            doc.fontSize(12).font('Helvetica-Bold').text('Burnout Risk');
            const riskColor = sustain.burnoutRisk.toLowerCase().includes('high') ? 'red' : (sustain.burnoutRisk.toLowerCase().includes('medium') ? '#FFA500' : 'green');
            doc.fillColor(riskColor).fontSize(10).font('Helvetica-Bold').text(sustain.burnoutRisk);
            doc.fillColor(colors.text); // Reset
            doc.moveDown(1);

            // Diversification (Dynamic Render)
            doc.fontSize(12).font('Helvetica-Bold').text('Income Diversification Ratio (Calculated)');
            doc.moveDown(0.2);
            Object.entries(diversification).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
                doc.fontSize(10).font('Helvetica').text(`• ${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}%`, { indent: 10 });
            });
            doc.moveDown(1);

            // Milestones
            if (sustain.progressionMilestones) {
                doc.fontSize(12).font('Helvetica-Bold').text('Progression Milestones');
                doc.moveDown(0.2);
                sustain.progressionMilestones.forEach(m => {
                    doc.fontSize(10).font('Helvetica').text(`• ${m.year}: ${m.milestone}`, { indent: 10 });
                });
            }
        }

        // --- VISUAL ANALYTICS ---
        doc.addPage();
        doc.fontSize(16).font('Helvetica-Bold').text('Visual Analytics');
        addDivider();

        // 1. Revenue Distribution (Pie)
        try {
            const pieLabels = Object.keys(artist.revenue).filter(k => k !== 'streamingBreakdown' && typeof artist.revenue[k] === 'number').map(k => k.toUpperCase());
            const pieData = Object.keys(artist.revenue).filter(k => k !== 'streamingBreakdown' && typeof artist.revenue[k] === 'number').map(k => artist.revenue[k]);
            const pieBuffer = await generatePieChart(pieLabels, pieData);

            doc.image(pieBuffer, 50, doc.y, { width: 250 });
            doc.fontSize(10).text('Revenue Distribution', 120, doc.y + 260);
        } catch (e) { console.error(e); }

        // 2. Sales Trend (Line) - Mocking historical data if missing
        try {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
            // Simulate trend based on current revenue
            const base = totalRevenue / 10;
            const trendData = months.map((_, i) => base + (Math.random() * base * 0.2 * (i % 2 === 0 ? 1 : -1)));

            const lineBuffer = await generateLineChart(months, trendData);
            doc.image(lineBuffer, 320, doc.y - 280, { width: 250 }); // Place next to Pie
            doc.text('6-Month Trend', 400, doc.y + 260); // Label position approximation
        } catch (e) { console.error(e); }

        doc.moveDown(20); // Push past images

        // 3. Forecast (Donut)
        if (artist.forecast) {
            try {
                const donutBuffer = await generateDonutChart(['Next Month', 'Target'], [artist.forecast.nextMonth, artist.forecast.nextMonth * 1.1]);
                doc.image(donutBuffer, 50, doc.y, { width: 250 });
                doc.text('Forecast Achievement', 120, doc.y + 260);
            } catch (e) { console.error(e); }
        }

        doc.moveDown(15);

        // --- STREAMING BAR CHART ---
        if (artist.revenue.streamingBreakdown && artist.revenue.streamingBreakdown.byLocation) {
            try {
                const barLabels = artist.revenue.streamingBreakdown.byLocation.map(l => l.region);
                const barData = artist.revenue.streamingBreakdown.byLocation.map(l => l.value);

                const barBuffer = await generateBarChart(barLabels, barData);
                if (doc.y > 500) doc.addPage();
                doc.image(barBuffer, 50, doc.y, { width: 500, align: 'center' });
                doc.moveDown(12);
            } catch (chartErr) {
                console.error("Bar Chart Error:", chartErr);
            }
        }

        // --- STREAMING LOCATION (If available) ---
        if (artist.revenue.streamingBreakdown && artist.revenue.streamingBreakdown.byLocation) {
            doc.font('Helvetica-Bold').fontSize(14).text('Streaming Geography');
            doc.moveDown(0.5);

            const geoTable = {
                headers: [
                    { label: "Region", property: 'region', width: 200 },
                    { label: "Value", property: 'value', width: 100, align: 'right' },
                    { label: "Percent", property: 'percent', width: 100, align: 'right' }
                ],
                datas: artist.revenue.streamingBreakdown.byLocation.map(l => ({
                    region: l.region,
                    value: `$${l.value.toLocaleString()}`,
                    percent: `${l.percent}%`
                }))
            };
            await doc.table(geoTable, { prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10) });
            doc.moveDown(2);
        }

        // --- SOCIAL & CRM (Grid) ---
        doc.font('Helvetica-Bold').fontSize(14).text('Social & CRM Data');
        doc.moveDown(0.5);

        const socialY = doc.y;
        if (artist.social) {
            drawKPI('INSTAGRAM', artist.social.instagram.toLocaleString(), 50, socialY);
            drawKPI('TIKTOK', artist.social.tiktok.toLocaleString(), 180, socialY);
            drawKPI('TWITTER', artist.social.twitter.toLocaleString(), 310, socialY);
            drawKPI('ENGAGEMENT', `${artist.social.engagementRate}%`, 440, socialY);
        }

        // CRM Row
        const crmY = socialY + 45;
        if (artist.crm) {
            drawKPI('EMAIL LIST', artist.crm.emailCount.toLocaleString(), 50, crmY);
            drawKPI('SMS LIST', artist.crm.smsCount.toLocaleString(), 180, crmY);
            drawKPI('PRESALES', artist.crm.presaleSignups.toLocaleString(), 310, crmY);
        }
        doc.y = crmY + 45;
        doc.moveDown(2);

        // --- RECENT SHOWS ---
        if (artist.touring && artist.touring.shows && artist.touring.shows.length > 0) {
            doc.font('Helvetica-Bold').fontSize(14).text('Tour Performance');
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica').text(`Upcoming Shows: ${artist.touring.upcomingShows} | Avg Attendance: ${artist.touring.avgAttendance.toLocaleString()}`);
            doc.moveDown(0.5);

            const tourTable = {
                headers: [
                    { label: "Date", property: 'date', width: 90 },
                    { label: "Venue", property: 'venue', width: 150 },
                    { label: "City", property: 'city', width: 100 },
                    { label: "Rev ($)", property: 'revenue', width: 80, align: 'right' }
                ],
                datas: artist.touring.shows.map(s => ({
                    date: s.date,
                    venue: s.venue,
                    city: s.city,
                    revenue: s.revenue.toLocaleString()
                }))
            };
            await doc.table(tourTable, {
                prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
                prepareRow: () => doc.font("Helvetica").fontSize(10)
            });
            doc.moveDown(2);
        }

        // --- BRAND DEALS ---
        if (artist.brandDeals && artist.brandDeals.length > 0) {
            doc.addPage(); // Start Brand Deals on new page if getting cramped, or just let flow
            doc.font('Helvetica-Bold').fontSize(14).text('Active Brand Partnerships');
            doc.moveDown(0.5);

            const brandTable = {
                headers: [
                    { label: "Brand", property: 'brand', width: 200 },
                    { label: "Value", property: 'value', width: 100, align: 'right' },
                    { label: "Status", property: 'status', width: 100 }
                ],
                datas: artist.brandDeals.map(b => ({
                    brand: b.brand,
                    value: `$${b.value.toLocaleString()}`,
                    status: b.status.toUpperCase()
                }))
            };
            await doc.table(brandTable, { prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10) });
            doc.moveDown(2);
        }

        // --- FORECAST ---
        if (artist.forecast) {
            doc.font('Helvetica-Bold').fontSize(14).text('Financial Forecast');
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica')
                .text(`Next Month Projection: $${artist.forecast.nextMonth.toLocaleString()}`)
                .text(`3-Month Projection: $${artist.forecast.threeMonth.toLocaleString()}`)
                .text(`Trend Analysis: ${artist.forecast.trend.toUpperCase()}`);
        }

        // --- FOOTER ---
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);
            doc.fontSize(8).fillColor(colors.grey).text(
                `MAU5TRAP INTELLIGENCE • CONFIDENTIAL • PAGE ${i + 1}/${pageCount}`,
                50,
                doc.page.height - 40,
                { align: 'center', width: doc.page.width - 100 }
            );
        }

        doc.end();
    });
}

// ============================================================================
// AUTO-PRINTING SCHEDULER
// ============================================================================

// Schedule monthly report generation (runs on 1st of each month at 3am)
cron.schedule('0 3 1 * *', async () => {
    console.log('Running scheduled monthly report generation...');

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const month = lastMonth.toISOString().slice(0, 7); // YYYY-MM

    try {
        const reportsDir = path.join(__dirname, 'reports', month);
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        for (const artist of labelData.artists) {
            const pdfBuffer = await generateMonthlyReport(artist, month);
            const filename = `${artist.name}_${month}_report.pdf`;
            const filepath = path.join(reportsDir, filename);

            fs.writeFileSync(filepath, pdfBuffer);

            // Auto-print to home PC
            if (process.env.AUTO_PRINT === 'true') {
                autoPrintReport(filepath);
            }
        }

        console.log(`Monthly reports generated for ${month}`);
    } catch (error) {
        console.error('Error generating monthly reports:', error);
    }
});

// Auto-print function (works on Windows/Mac/Linux)
function autoPrintReport(filepath) {
    const { exec } = require('child_process');
    const platform = process.platform;

    let printCommand;

    if (platform === 'win32') {
        // Windows
        printCommand = `powershell -Command "Start-Process -FilePath '${filepath}' -Verb Print"`;
    } else if (platform === 'darwin') {
        // macOS
        printCommand = `lpr "${filepath}"`;
    } else {
        // Linux
        printCommand = `lp "${filepath}"`;
    }

    exec(printCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(`Print error: ${error.message}`);
            return;
        }
        console.log(`Report printed: ${filepath}`);
    });
}

// ============================================================================
// DATA EXPORT (PDF & CSV)
// ============================================================================

// Middleware to check export permissions
const checkExportAccess = (req, res, next) => {
    const user = req.user;
    const { artistId } = req.query;

    // Admin sees all
    if (user.role === 'admin') return next();

    // Label-wide export attempt by non-admin
    if (!artistId) {
        return res.status(403).json({ error: 'Only admins can export label-wide data' });
    }

    // Check specific artist access
    if (hasArtistAccess(user, artistId)) {
        next();
    } else {
        res.status(403).json({ error: 'Access denied for this artist' });
    }
};

// Helper: Flatten nested data for CSV
function flattenData(data, prefix = '') {
    let flat = {};
    for (let key in data) {
        if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
            Object.assign(flat, flattenData(data[key], `${prefix}${key}.`));
        } else {
            flat[`${prefix}${key}`] = Array.isArray(data[key]) ? JSON.stringify(data[key]) : data[key];
        }
    }
    return flat;
}

// Helper: Filter specific metrics
function filterMetrics(data, selectedMetrics) {
    const filtered = {};
    selectedMetrics.forEach(metric => {
        if (data[metric] !== undefined) filtered[metric] = data[metric];
    });
    return filtered;
}

// Helper: Get Label Overview
function getLabelOverview(timeframe) {
    const totalRevenue = labelData.artists.reduce((sum, a) => sum + calculateTotalRevenue(a), 0);
    const totalStreams = labelData.artists.reduce((sum, a) => sum + (a.totalStreams || 0), 0);
    const topArtist = labelData.artists.sort((a, b) => b.monthlyListeners - a.monthlyListeners)[0];

    return {
        metric: 'Label Overview',
        timeframe,
        totalRevenue,
        totalStreams,
        activeArtists: labelData.artists.length,
        topArtist: topArtist ? topArtist.name : 'N/A'
    };
}

// Export Endpoint
app.get('/v3/exports', authenticateToken, checkExportAccess, async (req, res) => {
    const { format = 'pdf', artistId, timeframe = '30d', metrics = 'all' } = req.query;

    try {
        // Fetch data
        let data;
        if (artistId) {
            data = labelData.artists.find(a => a.id === artistId);
            if (!data) return res.status(404).json({ error: 'Artist not found' });
        } else {
            data = getLabelOverview(timeframe);
        }

        // Filter metrics if not 'all'
        const dataToExport = metrics === 'all' ? data : filterMetrics(data, metrics.split(','));

        if (format === 'pdf') {
            const doc = new PDFDocument();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${artistId || 'label_overview'}_${Date.now()}.pdf"`);

            doc.pipe(res);

            // Header
            doc.fontSize(25).text('mau5trap Intelligence Report', { align: 'center' });
            doc.moveDown();
            doc.fontSize(16).text(`Subject: ${data.name || 'Label Overview'}`, { align: 'left' });
            doc.fontSize(12).text(`Timeframe: ${timeframe}`, { align: 'left' });
            doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, { align: 'left' });
            doc.moveDown();

            // Divider
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown();

            // Content
            doc.fontSize(14).text('Metrics Breakdown:', { underline: true });
            doc.moveDown(0.5);

            Object.entries(dataToExport).forEach(([key, value]) => {
                if (typeof value === 'object') {
                    doc.fontSize(12).font('Helvetica-Bold').text(`${key.toUpperCase()}:`);
                    doc.font('Helvetica').fontSize(10).text(JSON.stringify(value, null, 2));
                } else {
                    doc.fontSize(12).text(`${key}: ${value}`);
                }
                doc.moveDown(0.5);
            });

            // Footer
            doc.fontSize(10).text('Generated by mau5trap OS v5.0', 50, 700, { align: 'center', color: 'grey' });

            doc.end();

        } else if (format === 'csv') {
            const createCsvWriter = require('csv-writer').createObjectCsvWriter;
            const filePath = path.join(__dirname, `temp_${Date.now()}.csv`);

            const flattened = flattenData(dataToExport);
            const headers = Object.keys(flattened).map(key => ({ id: key, title: key }));

            const csvWriter = createCsvWriter({
                path: filePath,
                header: headers
            });

            await csvWriter.writeRecords([flattened]);

            res.download(filePath, `${artistId || 'label'}_export.csv`, (err) => {
                if (err) console.error('Download error:', err);
                try {
                    fs.unlinkSync(filePath); // Clean up temp file
                } catch (e) {
                    console.error('Cleanup error:', e);
                }
            });

        } else {
            res.status(400).json({ error: 'Invalid format. Use pdf or csv' });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Export failed', message: err.message });
    }
});

// ============================================================================
// LABEL OVERVIEW (filtered by access)
// ============================================================================

// ============================================================================
// A&R SCOUTING & SPOTIFY INTEGRATION
// ============================================================================
const SpotifyWebApi = require('spotify-web-api-node');

// Init Spotify API (Env vars would be implemented here)
const spotifyApi = new SpotifyWebApi({
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret'
});

// GET /v3/anr/scout
app.get('/v3/anr/scout', authenticateToken, async (req, res) => {
    const query = req.query.query || '';

    try {
        // MOCK FALLBACK (Since no real keys provided)
        console.log(`[Spotify] Mock Searching for: ${query}`);

        // Simulate network delay
        setTimeout(() => {
            const mockScouts = [
                {
                    spotifyId: 's_k5',
                    name: "K5",
                    image: "https://i.scdn.co/image/ab67616d0000b273b5", // Placeholder
                    followers: 12500,
                    popularity: 45,
                    genres: ['techno', 'dark ambient'],
                    url: 'https://open.spotify.com/artist/k5'
                },
                {
                    spotifyId: 's_neon',
                    name: "Neon Flux",
                    image: null,
                    followers: 48200,
                    popularity: 62,
                    genres: ['bass house', 'electro'],
                    url: 'https://open.spotify.com/artist/neonflux'
                },
                {
                    spotifyId: 's_cyber',
                    name: "Cyber Mode",
                    image: null,
                    followers: 8200,
                    popularity: 38,
                    genres: ['industrial', 'midtempo'],
                    url: 'https://open.spotify.com/artist/cybermode'
                },
                {
                    spotifyId: 's_analog',
                    name: "Analog Soul",
                    image: null,
                    followers: 22100,
                    popularity: 55,
                    genres: ['prog house', 'melodic techno'],
                    url: 'https://open.spotify.com/artist/analogsoul'
                }
            ];

            // Simple filter if query exists
            const filtered = query
                ? mockScouts.filter(s => s.name.toLowerCase().includes(query.toLowerCase()) || s.genres.some(g => g.includes(query.toLowerCase())))
                : mockScouts;

            res.json({ scouts: filtered });
        }, 500);

    } catch (err) {
        console.error('Spotify Search Error:', err);
        res.status(500).json({ error: 'Failed to access Spotify Scouting Network' });
    }
});

// POST /v3/anr/shortlist
app.post('/v3/anr/shortlist', authenticateToken, (req, res) => {
    const artist = req.body;

    // Create a new submission/prospect entry
    const newEntry = {
        id: `scout_${artist.spotifyId || Date.now()}`,
        artist: artist.name,
        track: '—', // Placeholder for scouted artists
        genre: artist.genres ? artist.genres[0] : 'Unknown',
        imageUrl: artist.image,
        followers: artist.followers,
        url: artist.url,
        status: 'shortlisted', // Special status
        submittedAt: new Date().toISOString(),
        votes: 0
    };

    // Persist to in-memory store
    // Check if duplicate
    const exists = anrSubmissions.find(s => s.artist === artist.name);
    if (!exists) {
        anrSubmissions.unshift(newEntry);
        console.log(`[A&R] Shortlisted and Persisted: ${artist.name}`);
        res.json({ success: true, message: `${artist.name} added to shortlist`, entry: newEntry });
    } else {
        res.json({ success: true, message: `${artist.name} is already in the shortlist` });
    }
});

// ============================================================================
// OPERATIONS MODULE (Logistics, Assets, Contracts)
// ============================================================================

// OPERATIONS DATA (Mock)
// OPERATIONS DATA (Mock)
const operationsData = {
    logistics: [
        {
            id: 1,
            item: "Mau5head Replica (Gen 4)",
            quantity: 150,
            status: "In Transit",
            vendor: "Fourthwall",
            tracking: "FW123456789",
            eta: "2025-12-18",
            location: "Los Angeles Warehouse"
        },
        {
            id: 2,
            item: "Tour Tee (BlackGummy)",
            quantity: 800,
            status: "Stocked",
            vendor: "Printful",
            tracking: "PF987654321",
            eta: null,
            location: "EU Fulfillment Center"
        },
        {
            id: 3,
            item: "REZZ Goggles Replica",
            quantity: 45,
            status: "Low Stock",
            vendor: "Merchbar",
            tracking: "MB456789123",
            eta: null,
            location: "Toronto Warehouse"
        }
    ],
    assets: [
        { id: 1, title: "deadmau5 - Strobe (Master WAV)", type: "Audio Master", artist: "deadmau5", uploaded: "2024-03-15", size: "248 MB", status: "Approved" },
        { id: 2, title: "REZZ - Edge (Official Video)", type: "Video", artist: "REZZ", uploaded: "2025-01-10", size: "1.8 GB", status: "Processing" },
        { id: 3, title: "BlackGummy - Album Artwork Pack", type: "Artwork", artist: "BlackGummy", uploaded: "2025-02-20", size: "89 MB", status: "Approved" }
    ],
    contracts: [
        {
            id: 1,
            artist: "deadmau5",
            type: "Master Recording",
            signedDate: "2018-06-01",
            term: "Perpetuity",
            advance: "$0",
            recoupable: null,
            royaltyRate: "50%",
            status: "Active",
            nextMilestone: null
        },
        {
            id: 2,
            artist: "REZZ",
            type: "Exclusive Recording",
            signedDate: "2022-11-15",
            term: "3 Albums",
            advance: "$150k",
            recoupable: "$120k remaining",
            royaltyRate: "Standard",
            status: "Active",
            nextMilestone: "Album 3 Q2 2026"
        },
        {
            id: 3,
            artist: "BlackGummy",
            type: "Single Deal + Option",
            signedDate: "2024-08-20",
            term: "2+2",
            advance: "$40k",
            recoupable: "Fully Recouped",
            royaltyRate: "18%",
            status: "Active",
            nextMilestone: "Option Mar 2026"
        }
    ]
};


// === OPERATIONS ENDPOINTS ===

// 1. Logistics
app.get('/v3/operations/logistics', authenticateToken, (req, res) => {
    res.json({ logistics: operationsData.logistics });
});

// 2. Asset Vault
app.get('/v3/operations/assets', authenticateToken, (req, res) => {
    res.json({ assets: operationsData.assets });
});

// 3. Contracts
app.get('/v3/operations/contracts', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }
    res.json({ contracts: operationsData.contracts });
});

app.get('/v3/label/overview', authenticateToken, (req, res) => {
    // Filter artists by access
    const accessibleArtists = labelData.artists.filter(artist =>
        hasArtistAccess(req.user, artist.id)
    );

    const topArtists = [...accessibleArtists]
        .sort((a, b) => calculateTotalRevenue(b) - calculateTotalRevenue(a))
        .slice(0, 5)
        .map(a => ({
            name: a.name,
            revenue: calculateTotalRevenue(a),
            roi: a.roi
        }));

    // Calculate totals for accessible artists only
    const totalRevenue = accessibleArtists.reduce((sum, a) => sum + calculateTotalRevenue(a), 0);

    res.json({
        monthlyRevenue: req.user.role === 'admin' ? labelData.labelTotals.monthlyRevenue : totalRevenue,
        quarterlyProjection: totalRevenue * 3,
        annualProjection: totalRevenue * 12,
        activeArtists: accessibleArtists.length,
        topArtists,
        timestamp: new Date().toISOString()
    });
});


// Endpoint: Get Geographic Analysis
app.get('/v3/analytics/geography', authenticateToken, async (req, res) => {
    try {
        const geography = {};

        // Aggregate data
        labelData.artists.forEach(artist => {
            if (artist.revenue && artist.revenue.streamingBreakdown && artist.revenue.streamingBreakdown.byLocation) {
                artist.revenue.streamingBreakdown.byLocation.forEach(loc => {
                    if (!geography[loc.region]) {
                        geography[loc.region] = { value: 0, percent: 0, count: 0 };
                    }
                    geography[loc.region].value += loc.value;
                    geography[loc.region].count++;
                });
            }
        });

        // Normalize percentages (just relative to total tracked value)
        const totalValue = Object.values(geography).reduce((acc, curr) => acc + curr.value, 0);
        Object.keys(geography).forEach(key => {
            geography[key].percent = parseFloat(((geography[key].value / totalValue) * 100).toFixed(1));
        });

        res.json({
            regions: Object.entries(geography).map(([region, data]) => ({
                region,
                value: data.value,
                percent: data.percent
            }))
        });

    } catch (err) {
        logger.error('Geography error:', err);
        res.status(500).json({ error: 'Geography analysis failed' });
    }
});

// ============================================================================
// PREDICTIVE ANALYTICS (Math.js)
// ============================================================================

/**
 * Perform Simple Linear Regression using Math.js (Matrix Operations)
 * @param {Array<number>} xValues - Independent variable (e.g., time/months)
 * @param {Array<number>} yValues - Dependent variable (e.g., revenue)
 * @returns {Object} { slope, intercept, predict(x) }
 */
function performLinearRegression(xValues, yValues) {
    // Model: y = b0 + b1*x
    // Matrix Form: Y = X*B + E
    // B = (X'X)^-1 X'Y

    const N = xValues.length;
    // Construct Design Matrix X: [ [1, x1], [1, x2], ... ]
    const X = xValues.map(x => [1, x]);
    // Construct Y Vector: [ [y1], [y2], ... ]
    const Y = yValues.map(y => [y]);

    try {
        const matrixX = math.matrix(X);
        const matrixY = math.matrix(Y);

        // Calculate Transpose X'
        const transposedX = math.transpose(matrixX);

        // Calculate (X'X)
        const xTx = math.multiply(transposedX, matrixX);

        // Calculate Inverse (X'X)^-1
        const inverseXtX = math.inv(xTx);

        // Calculate (X'X)^-1 X'
        const pseudoInverse = math.multiply(inverseXtX, transposedX);

        // Calculate B = ((X'X)^-1 X') Y
        const B = math.multiply(pseudoInverse, matrixY);

        // Extract Coefficients
        const intercept = B.get([0, 0]);
        const slope = B.get([1, 0]);

        return {
            slope,
            intercept,
            predict: (x) => (slope * x) + intercept
        };
    } catch (error) {
        console.error("Regression error:", error);
        // Fallback for singular matrices or errors: Simple average slope
        return { slope: 0, intercept: 0, predict: () => 0 };
    }
}

/**
 * Generate synthetic historical data for demo purposes
 * @param {number} currentVal - Current actual value
 * @param {number} growthRate - Annual growth percentage (e.g. 20.7)
 * @returns {Array<{month: number, value: number}>} Last 12 months data
 */
function generateSyntheticHistory(currentVal, growthRate) {
    const history = [];
    const monthlyGrowth = (growthRate / 100) / 12;

    // Work backwards from current
    for (let i = 0; i < 12; i++) {
        // value = current / (1 + rate)^months_back
        // Adding Random Noise (+/- 5%)
        const noise = 0.95 + (Math.random() * 0.1);
        const monthsBack = 11 - i;
        const base = currentVal / Math.pow(1 + monthlyGrowth, monthsBack);
        history.push(Math.round(base * noise));
    }
    return history;
}

// Real Sales Data Store (ArtistID -> [{month, revenue}])
const salesData = {};

// Endpoint: Log Real Sales Data
app.post('/v3/analytics/sales', authenticateToken, (req, res) => {
    const { artistId, month, revenue } = req.body;
    if (!artistId || !month || !revenue) return res.status(400).json({ error: 'Missing fields' });

    if (!salesData[artistId]) salesData[artistId] = [];

    // Remove existing entry for same month if exists
    salesData[artistId] = salesData[artistId].filter(e => e.month !== month);

    salesData[artistId].push({ month, revenue: parseFloat(revenue) });
    res.json({ success: true, count: salesData[artistId].length });
});

// Endpoint: Get Revenue Projections
app.get('/v3/analytics/projections', authenticateToken, async (req, res) => {
    const { artistId, months = 6 } = req.query;

    try {
        let currentRevenue = 0;
        let growthRate = 0;
        let name = "Label Wide";
        let historyValues = [];

        if (artistId) {
            const artist = labelData.artists.find(a => a.id === artistId);
            if (!artist) return res.status(404).json({ error: 'Artist not found' });

            name = artist.name;
            growthRate = artist.growthRate || 5;

            // USE REAL DATA IF AVAILABLE
            if (salesData[artistId] && salesData[artistId].length >= 3) {
                // Sort by month (simple string sort for now, assuming ISO or 1-12)
                const sorted = salesData[artistId].sort((a, b) => a.month.localeCompare(b.month));
                historyValues = sorted.map(s => s.revenue);
                currentRevenue = historyValues[historyValues.length - 1]; // Last known
            } else {
                // Fallback to Synthetic
                currentRevenue = (artist.revenue.streaming || 0) + (artist.revenue.touring || 0) + (artist.revenue.merch || 0);
                historyValues = generateSyntheticHistory(currentRevenue, growthRate);
            }

        } else {
            // Check if labelData exists and has artists
            if (labelData && labelData.artists) {
                // Calculate Sum manually to avoid dependency on getLabelOverview if undefined here
                currentRevenue = labelData.artists.reduce((sum, a) =>
                    sum + ((a.revenue.streaming || 0) + (a.revenue.touring || 0) + (a.revenue.merch || 0)), 0);
            } else {
                currentRevenue = 500000;
            }
            growthRate = 12; // Assumed label growth
            historyValues = generateSyntheticHistory(currentRevenue, growthRate);
        }

        // If we didn't get history from real data (or it wasn't enough points), we generated it above.
        const xHistory = Array.from({ length: historyValues.length }, (_, i) => i + 1);

        // 2. Perform Regression
        const model = performLinearRegression(xHistory, historyValues);

        // 3. Project Future (Next 'months')
        const projections = [];
        for (let i = 1; i <= parseInt(months); i++) {
            const nextMonthIndex = 12 + i;
            projections.push(Math.round(model.predict(nextMonthIndex)));
        }

        // 4. Format for Chart.js
        res.json({
            entity: name,
            stats: { slope: model.slope, intercept: model.intercept },
            chartData: {
                labels: [...Array.from({ length: 12 }, (_, i) => `M${i + 1}`), ...Array.from({ length: parseInt(months) }, (_, i) => `Fut${i + 1}`)],
                datasets: [
                    {
                        label: 'Historical',
                        data: [...historyValues, ...Array(parseInt(months)).fill(null)],
                        borderColor: '#666666',
                        backgroundColor: 'rgba(255,255,255,0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Projection (Linear)',
                        data: [...Array(11).fill(null), historyValues[11], ...projections],
                        borderColor: '#00FF5F',
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0
                    }
                ]
            }
        });

    } catch (err) {
        logger.error('Projection error:', err);
        res.status(500).json({ error: 'Projection failed' });
    }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
    res.json({
        status: 'operational',
        version: '3.0-production',
        timestamp: new Date().toISOString()
    });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path
    });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   mau5trap Production API                                ║
║   Multi-Tenant Access Control Enabled                    ║
║                                                           ║
║   Server: http://localhost:${PORT}                         ║
║   Environment: ${process.env.NODE_ENV || 'development'}                              ║
║                                                           ║
║   Features:                                              ║
║   ✓ User Authentication (JWT)                           ║
║   ✓ Role-Based Access Control                           ║
║   ✓ Monthly Report Generation                           ║
║   ✓ Auto-Printing Enabled                               ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

Default Users:
- admin@mau5trap.com (admin123) - Full access
- tours@rezz.com (rezz123) - REZZ only
- joel@deadmau5.com (mau5123) - deadmau5 only

⚠️  CHANGE DEFAULT PASSWORDS IMMEDIATELY!
    `);
});

module.exports = app;
