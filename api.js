import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ApnaKhataExtractor } from './src/extractor.js';

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

app.use(express.json());

// Browser Pool Singleton
let globalBrowser = null;
let browserInitializing = false;

async function getBrowser() {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }
  if (browserInitializing) {
    while (browserInitializing) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (globalBrowser && globalBrowser.isConnected()) return globalBrowser;
  }

  browserInitializing = true;
  try {
    console.log('⚡ Initializing shared global Chrome browser instance...');
    const chromeArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--window-size=1280,800',
      '--disable-blink-features=AutomationControlled',
    ];
    const launchOptions = {
      headless: 'new',
      slowMo: 0,
      defaultViewport: { width: 1280, height: 800 },
      args: chromeArgs,
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    globalBrowser = await puppeteer.launch(launchOptions);
    console.log('✅ Global Chrome browser warm and ready.');
    return globalBrowser;
  } catch (err) {
    console.error('⚠️ Note: Could not launch shared browser, fallback to per-request launch:', err.message);
    return null;
  } finally {
    browserInitializing = false;
  }
}

// Health check & Documentation
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    version: '2.2.0-homepage-district-fix',
    message: '🏛️ Rajasthan Apna Khata Jamabandi Extraction API is Live & Fast!',
    browserWarm: Boolean(globalBrowser && globalBrowser.isConnected()),
    endpoints: {
      'GET /api/jamabandi': {
        description: 'Extract Jamabandi using URL query parameters',
        example: `${req.protocol}://${req.get('host')}/api/jamabandi?district=भीलवाड़ा&tehsil=बनेड़ा&village=रायला - रायला - रायला&khata=525`,
      },
      'POST /api/jamabandi': {
        description: 'Extract Jamabandi using JSON Body payload',
        samplePayload: {
          district: 'भीलवाड़ा',
          tehsil: 'बनेड़ा',
          village: 'रायला - रायला - रायला',
          khata: '525',
        },
      },
      'POST /api/extract': {
        description: 'Legacy endpoint for web UI and forms',
      },
    },
  });
});

/**
 * Common handler function for ultra-fast Jamabandi extraction
 */
async function handleJamabandiExtraction(req, res) {
  const district = (req.query.district || req.body.district || 'भीलवाड़ा').trim();
  const tehsil = (req.query.tehsil || req.body.tehsil || 'बनेड़ा').trim();
  const village = (req.query.village || req.body.village || 'रायला - रायला - रायला').trim();
  const rawKhata = req.query.khata || req.body.khata || req.query.searchValue || req.body.searchValue || '525';
  const khata = String(rawKhata).replace(/[^\d]/g, '').trim() || '525';

  console.log(`\n📥 [API Request] District: "${district}", Tehsil: "${tehsil}", Village: "${village}", Khata: "${khata}"`);

  try {
    const browser = await getBrowser();

    const config = {
      district,
      tehsil,
      village,
      searchBy: 'khata',
      searchValue: khata,
      browser,
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
        executionTimeSeconds: result.data.executionTimeSeconds || null,
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
          logs: result.data.logs || [],
          extractedAt: result.data.extractedAt || new Date().toISOString(),
        },
      });
    } else {
      res.status(500).json({
        success: false,
        status: 'error',
        message: result.error || 'Failed to extract Jamabandi record',
        executionTimeSeconds: result.data ? result.data.executionTimeSeconds : null,
        data: result.data || {
          screenshotBase64: null,
          stepScreenshots: {},
          logs: [],
        },
      });
    }
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({
      success: false,
      status: 'error',
      message: err.message,
      data: {
        screenshotBase64: null,
        stepScreenshots: {},
        logs: [],
      },
    });
  }
}

// 1. GET /api/jamabandi?district=...&tehsil=...&village=...&khata=525
app.get('/api/jamabandi', handleJamabandiExtraction);

// 2. POST /api/jamabandi { district, tehsil, village, khata }
app.post('/api/jamabandi', handleJamabandiExtraction);

// 3. POST /api/extract (compatible with existing extract.php)
app.post('/api/extract', handleJamabandiExtraction);

app.listen(PORT, async () => {
  console.log(`🚀 Apna Khata Extraction API listening on port ${PORT}`);
  // Pre-warm browser in background so requests are instant
  getBrowser().catch(() => {});
});
