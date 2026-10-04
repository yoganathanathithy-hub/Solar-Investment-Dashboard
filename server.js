// Solar Investment Dashboard: backend
// Serves the dashboard and exposes the same financial model as a JSON API.
const path = require('path');
const express = require('express');
const compression = require('compression');
const Model = require('./shared/model.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '50kb' }));

// Allow the page to be embedded (for example in a PowerPoint web viewer or an iframe)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

// Shared model and the charting library, served from local packages (no external CDN needed)
app.get('/model.js', (req, res) => res.sendFile(path.join(__dirname, 'shared', 'model.js')));
app.get('/vendor/chart.umd.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// API
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/defaults', (req, res) => res.json({ defaults: Model.DEFAULTS, limits: Model.LIMITS }));

app.post('/api/calculate', (req, res) => {
  try {
    res.json(Model.calculate(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: 'Could not calculate with these inputs. Check that every value is a number.', detail: String(err.message || err) });
  }
});

// Same calculation through query parameters, e.g. /api/calculate?discountRate=0.10&outputFactor=0.8
app.get('/api/calculate', (req, res) => {
  try {
    res.json(Model.calculate(req.query || {}));
  } catch (err) {
    res.status(400).json({ error: 'Could not calculate with these inputs. Check that every value is a number.', detail: String(err.message || err) });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Solar dashboard running on port ${PORT}`));
