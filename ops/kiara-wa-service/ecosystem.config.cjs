module.exports = {
  apps: [{
    name: "kiara-wa",
    script: "src/server.js",
    cwd: "/var/www/kiara-wa-service",
    autorestart: true,
    max_memory_restart: "900M",
    time: true,
  }],
};
