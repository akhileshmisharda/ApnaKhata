import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ApnaKhataExtractor } from './extractor.js';

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 8080;

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

app.use(express.json());

// Browser Pool Singleton for Cloud Run Warm Containers
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
    console.log('⚡ Initializing Chrome browser instance for Cloud Run...');
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
    console.log('✅ Chrome browser warm and ready on Cloud Run.');
    return globalBrowser;
  } catch (err) {
    console.error('⚠️ Note: Could not launch shared browser, fallback to per-request launch:', err.message);
    return null;
  } finally {
    browserInitializing = false;
  }
}

// Liveness / Health Check for Google Cloud Run
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'Rajasthan Apna Khata Jamabandi Extractor (Cloud Run)',
    version: '2.4.0-cloud-run-optimized',
    browserWarm: Boolean(globalBrowser && globalBrowser.isConnected()),
    endpoints: {
      'GET /api/jamabandi': 'Query params: district, tehsil, village, khata',
      'POST /api/jamabandi': 'JSON body: { district, tehsil, village, khata }',
      'POST /api/extract': 'Compatible with web UI and PHP forms',
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

  console.log(`\n📥 [Cloud Run Request] District: "${district}", Tehsil: "${tehsil}", Village: "${village}", Khata: "${khata}"`);

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

      res.status(200).json({
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
        data: result.data || null,
      });
    }
  } catch (err) {
    console.error('Cloud Run Handler Error:', err);
    res.status(500).json({
      success: false,
      status: 'error',
      message: err.message,
    });
  }
}

// API Routes
app.get('/api/jamabandi', handleJamabandiExtraction);
app.post('/api/jamabandi', handleJamabandiExtraction);
app.post('/api/extract', handleJamabandiExtraction);

// Bind to 0.0.0.0 on Cloud Run PORT
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Apna Khata Service listening on 0.0.0.0:${PORT} (Cloud Run Ready)`);
  getBrowser().catch(() => {});
});