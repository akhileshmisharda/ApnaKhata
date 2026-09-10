import express from 'express';
import { ApnaKhataExtractor } from './src/extractor.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check / welcome message for browser GET requests
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Apna Khata Jamabandi Scraper API is running successfully!',
    endpoint: 'POST /api/extract',
    samplePayload: {
      district: 'भीलवाड़ा',
      tehsil: 'बनेड़ा',
      village: 'रायला - रायला - रायला',
      searchBy: 'khata',
      searchValue: '560',
      headless: true,
    },
  });
});

app.get('/api/extract', (req, res) => {
  res.json({
    status: 'ready',
    message: 'Please send an HTTP POST request to this endpoint with JSON payload (district, tehsil, village, searchValue).',
  });
});

/**
 * POST /api/extract
 * Body: { district, tehsil, village, searchBy, searchValue, headless }
 */
app.post('/api/extract', async (req, res) => {
  console.log('\n📥 Received extraction request:');
  console.log(req.body);

  try {
    const config = {
      district: req.body.district || 'भीलवाड़ा',
      tehsil: req.body.tehsil || 'बनेड़ा',
      village: req.body.village || 'रायला - रायला - रायला',
      searchBy: req.body.searchBy || 'khata',
      searchValue: String(req.body.searchValue || '560').trim(),
      options: {
        headless: req.body.headless ?? true, // Default to headless on cloud server
        saveJson: true,
        saveCsv: true,
        saveScreenshot: true,
        savePdf: true,
        outputDir: './output',
      },
    };

    const extractor = new ApnaKhataExtractor(config);
    const result = await extractor.run();

    if (result.success) {
      res.json({
        status: 'success',
        message: 'Jamabandi extracted successfully',
        data: result.data,
        files: result.files,
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: result.error,
      });
    }
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Apna Khata Extraction API listening on port ${PORT}`);
});
