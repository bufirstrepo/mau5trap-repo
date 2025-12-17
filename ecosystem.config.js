module.exports = {
    apps: [{
        name: 'mau5trap-api',
        script: './mau5trap-production-api.js',
        instances: 'max', // Use all available cores (Clustering)
        exec_mode: 'cluster',
        watch: false, // Don't watch in production to save CPU
        max_memory_restart: '1G', // Auto-restart if memory leaks
        env: {
            NODE_ENV: 'development'
        },
        env_production: {
            NODE_ENV: 'production'
        },
        error_file: './logs/pm2-error.log',
        out_file: './logs/pm2-out.log',
        time: true
    }]
};
