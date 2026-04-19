#!/usr/bin/env node

const { spawn } = require('child_process');

const args = ['playwright', 'test', ...process.argv.slice(2)];
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});
