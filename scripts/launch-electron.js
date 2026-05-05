#!/usr/bin/env node
/* eslint-disable */
// Launcher that ensures ELECTRON_RUN_AS_NODE is unset before spawning Electron.
// Some shells (and globally-installed Electron-based tools) leak this env var,
// which silently turns Electron into a plain Node runtime when launched via
// `electron .` and breaks `require('electron')`.

const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ASAR;

const args = process.argv.slice(2);
if (args.length === 0) args.push('.');

const child = spawn(electronPath, args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('[launch-electron]', err);
  process.exit(1);
});
