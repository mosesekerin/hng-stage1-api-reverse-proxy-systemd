// app.js
'use strict';

const express = require('express');
const app = express();

const HOST = '127.0.0.1';
const PORT = 3000;

// Disable Express's default "X-Powered-By: Express" header — no need to
// advertise your stack to the public internet.
app.disable('x-powered-by');

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.status(200).json({ message: 'API is running' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ message: 'healthy' });
});

app.get('/me', (req, res) => {
  res.status(200).json({
    name: 'Ekerin Oluwatimileyin',
    email: 'mosesekerin.com',
    github: 'https://github.com/mosesekerin',
  });
});

// ── Catch-all for undefined routes ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
