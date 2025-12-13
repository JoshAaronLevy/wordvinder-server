const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const dictionaryPath = path.join(__dirname, 'data', 'dictionary', 'full.json');

// Load dictionary data at startup. Exit early if the file is inaccessible.
let dictionaryData;
try {
  const rawDictionary = fs.readFileSync(dictionaryPath, 'utf-8');
  dictionaryData = JSON.parse(rawDictionary);
} catch (error) {
  console.error('Failed to load dictionary data:', error.message);
  process.exit(1);
}

app.use(helmet());
app.use(cors());

app.get('/api/v1/dictionary', (_req, res) => {
  res.json(dictionaryData);
});

app.listen(PORT, () => {
  console.log(`Word Vinder API listening on http://localhost:${PORT}`);
  console.log(`Full dictionary at http://localhost:${PORT}/api/v1/dictionary`);
});
