#!/usr/bin/env node

/**
 * Development startup: compiles main, starts the Vite dev server and opens
 * Electron on it once it is up. .env is loaded for main (API URL, Turnstile).
 */

require('dotenv').config();

const { execSync } = require('child_process');

// Fixed: public/electron.js loads this URL in dev, and the page's CSP allows
// live reload on it (see vite.config.ts)
const URL = 'http://localhost:3002';

console.log(`\n🚀 Starting Vinbot Authenticator Development Server`);
console.log(`   ${URL}\n`);

const command = `npm run compile:main && concurrently "npm run renderer:dev" "wait-on ${URL} && cross-env ELECTRON_DEV=true electron ."`;

try {
  execSync(command, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
} catch (error) {
  process.exit(1);
}
