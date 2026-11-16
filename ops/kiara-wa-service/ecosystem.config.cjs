/**
 * Two engines, one copy of the code.
 *
 * - kiara-wa:    the orders number (field team). Settings in
 *                /var/www/kiara-wa-service/.env, port 2787.
 * - kiara-wa-cs: the second customer-facing number. Same server.js, but run
 *                from /var/www/kiara-wa-cs so `dotenv/config` reads that
 *                folder's .env (its own PORT, WA_CLIENT_ID, SESSIONS_DIR,
 *                SEND_TOKEN, INGEST_TOKEN). Packages still resolve from the
 *                script's folder, so nothing is installed twice.
 *
 * Never point both at one SESSIONS_DIR / WA_CLIENT_ID: two sockets on one
 * WhatsApp login knock each other off.
 */
module.exports = {
  apps: [
    {
      name: "kiara-wa",
      script: "src/server.js",
      cwd: "/var/www/kiara-wa-service",
      autorestart: true,
      max_memory_restart: "900M",
      time: true,
    },
    {
      name: "kiara-wa-cs",
      script: "/var/www/kiara-wa-service/src/server.js",
      cwd: "/var/www/kiara-wa-cs",
      autorestart: true,
      max_memory_restart: "900M",
      time: true,
    },
  ],
};
