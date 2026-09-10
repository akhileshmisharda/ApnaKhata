import express from 'express';
import { ApnaKhataExtractor } from './src/extractor.js';

const app = express();
const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

app.use(express.json());

// Health check & Documentation for browser GET requests
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: '🏛️ Rajasthan Apna Khata Jamabandi Extraction API is Live!',
    endpoints: {
      'GET /api/jamabandi': {
        description: 'Extract Jamabandi using URL query parameters',
        example: `${req.protocol}://${req.get('host')}/api/jamabandi?district=भीलवाड़ा&tehsil=बनेड़ा&village=रायला - रायला - रायला&khata=560`,
      },
      'POST /api/jamabandi': {
        description: 'Extract Jamabandi using JSON Body payload',
        samplePayload: {
          district: 'भीलवाड़ा',
          tehsil: 'बनेड़ा',
          village: 'रायला - रायला - रायला',
          khata: '560',
        },
      },
      'POST /api/extract': {
        description: 'Legacy endpoint for web UI and forms',
      },
    },
  });
});

/**
 * Common handler function for Jamabandi extraction
 */
async function handleJamabandiExtraction(req, res) {
  const district = (req.query.district || req.body.district || 'भीलवाड़ा').trim();
  const tehsil = (req.query.tehsil || req.body.tehsil || 'बनेड़ा').trim();
  const village = (req.query.village || req.body.village || 'रायला - रायला - रायला').trim();
  const rawKhata = req.query.khata || req.body.khata || req.query.searchValue || req.body.searchValue || '560';
  const khata = String(rawKhata).replace(/[^\d]/g, '').trim() || '560';

  console.log(`\n📥 [API Request] District: "${district}", Tehsil: "${tehsil}", Village: "${village}", Khata: "${khata}"`);

  try {
    const config = {
      district,
      tehsil,
      village,
      searchBy: 'khata',
      searchValue: khata,
      options: {
        headless: true,
        saveJson: false,
        saveCsv: false,
        saveScreenshot: false,
        savePdf: false,
        outputDir: './output',
      },
    };

    const extractor = new ApnaKhataExtractor(config);
    const result = await extractor.run();

    if (result.success && result.data) {
      // Calculate total area if numeric
      let totalRakba = 0;
      if (result.data.khasraRecords && result.data.khasraRecords.length > 0) {
        result.data.khasraRecords.forEach((r) => {
          const num = parseFloat(r.rakbaHectare);
          if (!isNaN(num)) totalRakba += num;
        });
      }

      res.json({
        success: true,
        status: 'success',
        message: 'Jamabandi extracted successfully',
        data: {
          district: result.data.district || district,
          tehsil: result.data.tehsil || tehsil,
          village: result.data.village || village,
          khataNumber: result.data.khataNumber || khata,
          selectedOptions: result.data.selectedOptions || {
            nakalType: 'जमाबंदी की प्रतिलिपि',
            nakalPeriod: 'वर्तमान नकल',
            searchMode: 'खाता से',
          },
          owners: result.data.owners || [],
          totalKhasraCount: result.data.khasraRecords ? result.data.khasraRecords.length : 0,
          totalRakbaHectare: totalRakba > 0 ? totalRakba.toFixed(4) : null,
          khasraRecords: result.data.khasraRecords || [],
          screenshotBase64: result.data.screenshotBase64 || null,
          stepScreenshots: result.data.stepScreenshots || {},
          extractedAt: result.data.extractedAt || new Date().toISOString(),
        },
      });
    } else {
      res.status(500).json({
        success: false,
        status: 'error',
        message: result.error || 'Failed to extract Jamabandi record',
      });
    }
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({
      success: false,
      status: 'error',
      message: err.message,
    });
  }
}

// 1. GET /api/jamabandi?district=...&tehsil=...&village=...&khata=560
app.get('/api/jamabandi', handleJamabandiExtraction);

// 2. POST /api/jamabandi { district, tehsil, village, khata }
app.post('/api/jamabandi', handleJamabandiExtraction);

// 3. POST /api/extract (compatible with existing extract.php)
app.post('/api/extract', handleJamabandiExtraction);

app.listen(PORT, () => {
  console.log(`🚀 Apna Khata Extraction API listening on port ${PORT}`);
});
