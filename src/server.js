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
app.use(express.urlencoded({ extended: true }));

// Enable CORS for all clients (Web, Mobile, Apps)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

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

/**
 * 1. Live Interactive Web Dashboard (GET /)
 */
app.get('/', (req, res) => {
  // If client wants JSON (Accept: application/json), return API metadata
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(200).json({
      status: 'online',
      service: 'Rajasthan Apna Khata Jamabandi Extractor (Cloud Run)',
      version: '2.5.0-live-stage-stream',
      browserWarm: Boolean(globalBrowser && globalBrowser.isConnected()),
      endpoints: {
        'GET /api/jamabandi': 'Standard JSON Extraction (query params: district, tehsil, village, khata)',
        'GET /api/jamabandi/stream': '⚡ Real-time Server-Sent Events (SSE) Live Stage Progress Stream',
        'POST /api/jamabandi': 'JSON body: { district, tehsil, village, khata }',
        'POST /api/extract': 'Compatible with web forms',
      },
    });
  }

  // Otherwise serve the rich Live Progress Dashboard
  res.send(`<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Apna Khata - Live Cloud Run Extractor</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { background-color: #f0f3f8; font-family: system-ui, -apple-system, sans-serif; }
    .header-box { background: linear-gradient(135deg, #0b3c6d, #1a6fb0); color: white; border-radius: 12px; }
    .card-custom { border-radius: 12px; border: none; box-shadow: 0 4px 14px rgba(0,0,0,0.06); }
    .step-item { display: flex; align-items: center; padding: 10px 14px; margin-bottom: 8px; border-radius: 8px; background: #f8f9fa; border-left: 4px solid #dee2e6; transition: all 0.3s; }
    .step-item.active { background: #e7f1ff; border-left-color: #0d6efd; color: #0d6efd; font-weight: 600; }
    .step-item.completed { background: #e8f7ee; border-left-color: #198754; color: #198754; }
    .terminal-box { background: #1a1a1a; color: #4af626; font-family: monospace; font-size: 0.85rem; border-radius: 8px; max-height: 200px; overflow-y: auto; padding: 12px; }
  </style>
</head>
<body class="p-3 p-md-4">
<div class="container" style="max-width: 960px;">
  <div class="header-box p-4 mb-4 text-center shadow-sm">
    <h2 class="fw-bold mb-1">🏛️ राजस्थान अपना खाता - लाइव जमाबंदी एक्सट्रेक्टर</h2>
    <p class="mb-0 text-light opacity-75">Google Cloud Run (asia-south1 Mumbai) • Real-time Stage-by-Stage Stream</p>
  </div>

  <div class="card card-custom p-4 bg-white mb-4">
    <form id="extractForm">
      <div class="row g-3">
        <div class="col-md-3">
          <label class="form-label fw-bold">जिला (District)</label>
          <input type="text" id="district" class="form-control" value="भीलवाड़ा" required>
        </div>
        <div class="col-md-3">
          <label class="form-label fw-bold">तहसील (Tehsil)</label>
          <input type="text" id="tehsil" class="form-control" value="बनेड़ा" required>
        </div>
        <div class="col-md-4">
          <label class="form-label fw-bold">गाँव (Village)</label>
          <input type="text" id="village" class="form-control" value="रायला - रायला - रायला" required>
        </div>
        <div class="col-md-2">
          <label class="form-label fw-bold">खाता संख्या</label>
          <input type="text" id="khata" class="form-control" value="525" required>
        </div>
      </div>
      <div class="mt-4 text-center">
        <button type="submit" id="submitBtn" class="btn btn-primary btn-lg px-5 shadow">
          🚀 लाइव एक्सट्रैक्ट करें (Start Live Stream)
        </button>
      </div>
    </form>
  </div>

  <!-- Live Stage Tracker -->
  <div id="trackerCard" class="card card-custom p-4 bg-white mb-4 d-none">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h5 class="fw-bold text-primary mb-0">
        <span class="spinner-border spinner-border-sm me-2"></span>
        लाइव स्टेज एवं UI ट्रैकर (Real-time Live Stages & UI Updates)
      </h5>
      <span id="liveTimer" class="badge bg-secondary p-2">⏱️ 0s बीत चुके</span>
    </div>

    <div class="mb-3">
      <div id="stage1" class="step-item"><span class="me-2">🌐</span> 1. पोर्टल कनेक्शन एवं पॉपअप बंद (Connecting & Dismissing Popups)</div>
      <div id="stage2" class="step-item"><span class="me-2">📍</span> 2. जिला चयन: <span class="distLabel">भीलवाड़ा</span> (District Selected)</div>
      <div id="stage3" class="step-item"><span class="me-2">🏛️</span> 3. तहसील चयन: <span class="tehsilLabel">बनेड़ा</span> (Tehsil Selected)</div>
      <div id="stage4" class="step-item"><span class="me-2">📑</span> 4. "चोसाला पद्धति जमाबंदी" चयन (Chosala Padhti Active)</div>
      <div id="stage5" class="step-item"><span class="me-2">🌾</span> 5. गाँव चयन: <span class="villageLabel">रायला</span> (Village Selected)</div>
      <div id="stage6" class="step-item"><span class="me-2">🎯</span> 6. खाता चयन (<span class="khataLabel">525</span>) एवं तालिका लोड (Khata Placed & Table Rendered)</div>
      <div id="stage7" class="step-item"><span class="me-2">📊</span> 7. काश्तकार व खसरा विवरण विश्लेषण (Complete Data Extracted)</div>
    </div>

    <div class="mb-2">
      <small class="fw-bold text-muted text-uppercase">🔍 लाइव सब-स्टेप्स और DOM/UI स्थिति (Live Action & UI Verification Log):</small>
    </div>
    <div class="terminal-box" id="liveConsole">
      <div>[0.0s] ⚡ Initializing Live Stream from Google Cloud Run...</div>
    </div>
  </div>

  <!-- Results View -->
  <div id="resultsCard" class="card card-custom p-4 bg-white mb-4 d-none">
    <h4 class="text-success fw-bold border-bottom pb-2 mb-3">✅ जमाबंदी नकल विवरण प्राप्त हुआ</h4>
    <div class="card bg-light p-3 border-0 mb-3">
      <h6 class="fw-bold mb-2">👥 काश्तकार / खातेदार विवरण:</h6>
      <ul id="ownersList" class="list-group list-group-flush rounded border"></ul>
    </div>

    <h6 class="fw-bold mb-2">🌾 खसरा एवं क्षेत्रफल विवरण:</h6>
    <div class="table-responsive">
      <table class="table table-bordered table-hover mb-0 bg-white">
        <thead class="table-dark">
          <tr><th>खाता</th><th>खसरा नंबर</th><th>रकबा (हेक्टेयर)</th><th>सिंचाई</th><th>भूमि वर्गीकरण / लगान</th></tr>
        </thead>
        <tbody id="khasraBody"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
let timer = null, sec = 0;

function setStageUI(num) {
  for (let i = 1; i <= 7; i++) {
    const el = document.getElementById('stage' + i);
    if (!el) continue;
    if (i < num) el.className = 'step-item completed';
    else if (i === num) el.className = 'step-item active';
    else el.className = 'step-item';
  }
}

function appendLog(msg, latestStep) {
  const box = document.getElementById('liveConsole');
  const d = document.createElement('div');
  
  if (latestStep && latestStep.status) {
    let badgeClass = 'text-warning';
    if (latestStep.uiVerified) badgeClass = 'text-success fw-bold';
    else if (latestStep.status === 'click_accepted') badgeClass = 'text-info';
    d.innerHTML = '<span class="' + badgeClass + '">' + escapeHtml(msg) + '</span>';
  } else {
    d.textContent = msg;
  }
  
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.getElementById('extractForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const district = document.getElementById('district').value.trim();
  const tehsil = document.getElementById('tehsil').value.trim();
  const village = document.getElementById('village').value.trim();
  const khata = document.getElementById('khata').value.trim();

  document.querySelectorAll('.distLabel').forEach(e => e.textContent = district);
  document.querySelectorAll('.tehsilLabel').forEach(e => e.textContent = tehsil);
  document.querySelectorAll('.villageLabel').forEach(e => e.textContent = village);
  document.querySelectorAll('.khataLabel').forEach(e => e.textContent = khata);

  document.getElementById('trackerCard').classList.remove('d-none');
  document.getElementById('resultsCard').classList.add('d-none');
  document.getElementById('submitBtn').disabled = true;

  sec = 0;
  document.getElementById('liveConsole').innerHTML = '';
  setStageUI(1);

  clearInterval(timer);
  timer = setInterval(() => {
    sec++;
    document.getElementById('liveTimer').textContent = '⏱️ ' + sec + 's बीत चुके';
  }, 1000);

  // Connect to Live SSE Stream
  const sseUrl = '/api/jamabandi/stream?district=' + encodeURIComponent(district) +
    '&tehsil=' + encodeURIComponent(tehsil) +
    '&village=' + encodeURIComponent(village) +
    '&khata=' + encodeURIComponent(khata);

  const evtSource = new EventSource(sseUrl);

  evtSource.onmessage = function(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'progress') {
        appendLog('[' + data.time + '] ' + data.message, data.latestStep);
        if (data.stage) {
          setStageUI(data.stage);
        } else {
          if (data.message.includes('1. Portal') || data.message.includes('Connecting')) setStageUI(1);
          else if (data.message.includes('District')) setStageUI(2);
          else if (data.message.includes('Tehsil')) setStageUI(3);
          else if (data.message.includes('चोसाला')) setStageUI(4);
          else if (data.message.includes('Village')) setStageUI(5);
          else if (data.message.includes('Khata') || data.message.includes('Nakal')) setStageUI(6);
          else if (data.message.includes('Extract')) setStageUI(7);
        }
      } else if (data.type === 'complete' && data.success) {
        clearInterval(timer);
        evtSource.close();
        setStageUI(8);
        document.getElementById('submitBtn').disabled = false;
        renderResults(data.data);
      } else if (data.type === 'error') {
        clearInterval(timer);
        evtSource.close();
        document.getElementById('submitBtn').disabled = false;
        appendLog('❌ Error: ' + (data.message || 'Unknown error'));
      }
    } catch (err) {}
  };

  evtSource.onerror = function() {
    evtSource.close();
    document.getElementById('submitBtn').disabled = false;
  };
});

function renderResults(data) {
  const oList = document.getElementById('ownersList');
  oList.innerHTML = '';
  if (data.owners && data.owners.length) {
    data.owners.forEach(o => {
      const li = document.createElement('li');
      li.className = 'list-group-item';
      li.textContent = '👤 ' + o;
      oList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.className = 'list-group-item text-muted';
    li.textContent = 'कोई काश्तकार विवरण नहीं मिला';
    oList.appendChild(li);
  }

  const tbody = document.getElementById('khasraBody');
  tbody.innerHTML = '';
  if (data.khasraRecords && data.khasraRecords.length) {
    data.khasraRecords.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (r.khataNo || '') + '</td><td><span class="badge bg-secondary">' + (r.khasraNo || '') + '</span></td><td><strong>' + (r.rakbaHectare || '') + '</strong></td><td>' + (r.irrigation || '-') + '</td><td>' + (r.soilAndTax || '-') + '</td>';
      tbody.appendChild(tr);
    });
  } else {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="text-center text-muted p-3">कोई खसरा विवरण नहीं मिला</td>';
    tbody.appendChild(tr);
  }
  document.getElementById('resultsCard').classList.remove('d-none');
}
</script>
</body>
</html>`);
});

/**
 * 2. Real-time Server-Sent Events (SSE) Live Stage Stream Endpoint
 * GET /api/jamabandi/stream?district=...&tehsil=...&village=...&khata=525
 */
app.get('/api/jamabandi/stream', async (req, res) => {
  const district = (req.query.district || 'भीलवाड़ा').trim();
  const tehsil = (req.query.tehsil || 'बनेड़ा').trim();
  const village = (req.query.village || 'रायला - रायला - रायला').trim();
  const rawKhata = req.query.khata || req.query.searchValue || '525';
  const khata = String(rawKhata).replace(/[^\d]/g, '').trim() || '525';

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({
    type: 'progress',
    time: new Date().toLocaleTimeString('hi-IN', { hour12: false }),
    message: `🚀 Extraction initialized for District: "${district}", Tehsil: "${tehsil}", Village: "${village}", Khata: "${khata}"`,
  });

  try {
    const browser = await getBrowser();

    const config = {
      district,
      tehsil,
      village,
      searchBy: 'khata',
      searchValue: khata,
      browser,
      onProgress: (prog) => {
        sendEvent(prog);
      },
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
      sendEvent({
        type: 'complete',
        success: true,
        data: result.data,
      });
    } else {
      sendEvent({
        type: 'error',
        success: false,
        message: result.error || 'Failed to extract Jamabandi',
      });
    }
  } catch (err) {
    sendEvent({
      type: 'error',
      success: false,
      message: err.message,
    });
  } finally {
    res.end();
  }
});

/**
 * 3. Standard JSON REST Endpoint
 * GET /api/jamabandi & POST /api/jamabandi & POST /api/extract
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
          detailedSteps: result.data.detailedSteps || [],
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
        data: {
          detailedSteps: result.data ? result.data.detailedSteps || [] : [],
          logs: result.data ? result.data.logs || [] : [],
          screenshotBase64: result.data ? result.data.screenshotBase64 || null : null,
          stepScreenshots: result.data ? result.data.stepScreenshots || {} : {},
          errorAt: new Date().toISOString(),
        },
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

app.get('/api/jamabandi', handleJamabandiExtraction);
app.post('/api/jamabandi', handleJamabandiExtraction);
app.post('/api/extract', handleJamabandiExtraction);

// Bind to 0.0.0.0 on Cloud Run PORT
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Apna Khata Service listening on 0.0.0.0:${PORT} (Cloud Run Ready)`);
  getBrowser().catch(() => {});
});