module.exports = {
  apps: [
    {
      name: 'flighttracker-api',
      cwd: __dirname,
      script: './server/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development',
        SERVER_PORT: '6667',
      },
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
    },
    {
      name: 'flighttracker-web',
      cwd: __dirname,
      script: './node_modules/vite/bin/vite.js',
      interpreter: 'node',
      args: '--host 0.0.0.0 --port 6666',
      env: {
        NODE_ENV: 'development',
      },
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
    },
  ],
};
