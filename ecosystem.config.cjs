module.exports = {
  apps: [
    {
      name: 'peer-lp-bot',
      script: 'dist/index.js',
      cwd: __dirname,
      node_args: '--experimental-vm-modules',
      env: {
        NODE_ENV: 'production',
      },
      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './data/logs/error.log',
      out_file: './data/logs/out.log',
      merge_logs: true,
      // Memory limit (restart if exceeded)
      max_memory_restart: '200M',
    },
  ],
};
