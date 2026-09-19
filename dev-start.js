#!/usr/bin/env node

/**
 * Development startup script that reads PORT from .env
 * and starts the dev server with proper environment variables
 */

require('dotenv').config();

const { execSync } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || 'localhost';

console.log(`\n🚀 Starting Vinted Authenticator Development Server`);
console.log(`   PORT: ${PORT}`);
console.log(`   HOST: ${HOST}\n`);

const command = `npm run compile:main && concurrently "npm run css:watch" "cross-env PORT=${PORT} BROWSER=none npm run react-start" "wait-on http://${HOST}:${PORT} && cross-env ELECTRON_DEV=true electron ."`;

try {
  execSync(command, {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PORT,
      HOST,
    },
  });
} catch (error) {
  process.exit(1);
}
