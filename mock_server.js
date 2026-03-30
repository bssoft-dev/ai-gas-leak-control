const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const cors = require('cors');

const app = express();
const port = 26025;

app.use(cors());
app.use(express.json());

const dataDir = path.join(__dirname, 'data', 'ai_gas_leak');
const serviceFilePath = path.join(__dirname, 'service.yaml');

// Helper function to read and send JSON files
const sendJsonFile = (req, res, fileName) => {
  const filePath = path.join(dataDir, fileName);
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      res.status(500).send({ error: `Failed to read ${fileName}` });
      return;
    }
    res.json(JSON.parse(data));
  });
};

// --- API Routes based on README.md ---

// GET /api/service
app.get('/api/service', (req, res) => {
  try {
    const fileContents = fs.readFileSync(serviceFilePath, 'utf8');
    const data = yaml.load(fileContents);
    res.json(data.service);
  } catch (e) {
    res.status(500).send({ error: 'Failed to load or parse service.yaml' });
  }
});

// GET /api/interfaces
app.get('/api/interfaces', (req, res) => {
  try {
    const fileContents = fs.readFileSync(serviceFilePath, 'utf8');
    const data = yaml.load(fileContents);
    res.json(data.interface);
  } catch (e) {
    res.status(500).send({ error: 'Failed to load or parse service.yaml' });
  }
});

// GET /api/gas-leak/state
app.get('/api/gas-leak/state', (req, res) => sendJsonFile(req, res, 'state.json'));

// GET /api/gas-leak/sensors
app.get('/api/gas-leak/sensors', (req, res) => sendJsonFile(req, res, 'sensors.json'));

// GET /api/gas-leak/timeseries
app.get('/api/gas-leak/timeseries', (req, res) => sendJsonFile(req, res, 'timeseries.json'));

// GET /api/gas-leak/drawings
app.get('/api/gas-leak/drawings', (req, res) => sendJsonFile(req, res, 'drawings.json'));

// GET /api/gas-leak/ai-history
app.get('/api/gas-leak/ai-history', (req, res) => sendJsonFile(req, res, 'ai_history.json'));

// GET /api/gas-leak/drawings/:id
app.get('/api/gas-leak/drawings/:id', (req, res) => {
  const { id } = req.params;
  const drawingsPath = path.join(dataDir, 'drawings.json');
  const pointsPath = path.join(dataDir, 'points', `${id}.json`);

  fs.readFile(drawingsPath, 'utf8', (err, drawingsData) => {
    if (err) return res.status(500).send({ error: 'Failed to read drawings.json' });

    const drawings = JSON.parse(drawingsData);
    const drawing = drawings.find(d => d.id === id);

    if (!drawing) return res.status(404).send({ error: 'Drawing not found' });

    fs.readFile(pointsPath, 'utf8', (err, pointsData) => {
      let sensors = [];
      if (!err) {
        sensors = JSON.parse(pointsData);
      } // If points file doesn't exist, just return empty sensors array
      
      res.json({ drawing, sensors });
    });
  });
});

// GET /api/gas-leak/drawings/:id/file
app.get('/api/gas-leak/drawings/:id/file', (req, res) => {
    const { id } = req.params;
    const drawingsPath = path.join(dataDir, 'drawings.json');

    fs.readFile(drawingsPath, 'utf8', (err, drawingsData) => {
        if (err) return res.status(500).send({ error: 'Failed to read drawings.json' });

        const drawings = JSON.parse(drawingsData);
        const drawing = drawings.find(d => d.id === id);

        if (!drawing || !drawing.file_path) {
            return res.status(404).send({ error: 'Drawing file path not found' });
        }
        
        // The file_path in drawings.json is relative to the project root.
        // e.g., "uploads/dac6812b-65ae-4416-ab18-a39a3d34bbb3.jpg"
        // The README says the data directory contains an uploads folder, but the initial file listing does not.
        // Let's assume the path is relative to the data directory for now.
        const imagePath = path.join(dataDir, drawing.file_path);
        
        if (fs.existsSync(imagePath)) {
            res.sendFile(imagePath);
        } else {
            // Let's try to find the file in the root directory if it's not in data
            const rootImagePath = path.join(__dirname, drawing.file_path);
            if (fs.existsSync(rootImagePath)) {
                res.sendFile(rootImagePath);
            } else {
                 res.status(404).send({ error: 'Drawing image file not found', triedPath: imagePath });
            }
        }
    });
});

// POST /api/events/publish (dummy)
app.post('/api/events/publish', (req, res) => {
  console.log('Event published:', req.body);
  res.status(200).send({ success: true });
});

// GET /api/events/stream (SSE)
app.get('/api/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send a comment to keep the connection alive
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});


app.listen(port, () => {
  console.log(`Mock API server listening on http://localhost:${port}`);
  console.log('Press Ctrl+C to stop the server.');
});