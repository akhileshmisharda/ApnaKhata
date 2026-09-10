import express from 'express';
import { ApnaKhataExtractor } from './src/extractor.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/**
 * POST /api/extract
 * Body: { district, tehsil, village, searchBy, searchValue }
 */
app.post('/api/extract', async (req, res) => {
  console.log('\n📥 Received extraction request from PHP:');
  console.log(req.body);

  try {
    const config = {
      district: req.body.district || 'भीलवाड़ा',
      tehsil: req.body.tehsil || 'बनेड़ा',
      village: req.body.village || 'रायला - रायला - रायला',
      searchBy: req.body.searchBy || 'khata',
      searchValue: String(req.body.searchValue || '560').trim(),
      options: {
        headless: req.body.headless ?? false,
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
  console.log(`🚀 Apna Khata Extraction API listening on http://localhost:${PORT}`);
  console.log(`👉 PHP can now POST to: http://localhost:${PORT}/api/extract`);
});

