<?php
/**
 * Apna Khata (Rajasthan) Jamabandi Extractor - Modern PHP Client
 * Hosted on: http://fabkraft.in/
 * Connected to Render Scraper API: https://apnakhata-juof.onrender.com/api/extract
 */

header('Content-Type: text/html; charset=UTF-8');

$apiUrl = 'https://apnakhata-juof.onrender.com/api/extract';

// Handle AJAX Request directly if sent by frontend
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest') {
    header('Content-Type: application/json; charset=utf-8');
    
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true) ?: $_POST;

    $payload = json_encode([
        'district'    => $data['district'] ?? 'भीलवाड़ा',
        'tehsil'      => $data['tehsil'] ?? 'बनेड़ा',
        'village'     => $data['village'] ?? 'रायला - रायला - रायला',
        'searchBy'    => 'khata',
        'searchValue' => $data['searchValue'] ?? '560',
        'headless'    => true
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json; charset=utf-8']);
    curl_setopt($ch, CURLOPT_TIMEOUT, 180);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        echo json_encode(['status' => 'error', 'message' => 'cURL Error: ' . $curlError]);
        exit;
    }

    if ($httpCode === 502 || $httpCode === 504) {
        echo json_encode(['status' => 'error', 'message' => 'Cloud server is waking up (Cold Start) or timeout. Please retry in 20 seconds.']);
        exit;
    }

    if ($httpCode !== 200) {
        $json = json_decode($response, true);
        echo json_encode(['status' => 'error', 'message' => $json['message'] ?? 'Server Error (HTTP ' . $httpCode . ')']);
        exit;
    }

    echo $response;
    exit;
}
?>
<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>अपना खाता - लाइव जमाबंदी एक्सट्रेक्टर</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
    <style>
        body { background-color: #f0f3f8; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .header-card { background: linear-gradient(135deg, #0b3c6d, #1a6fb0); color: white; border-radius: 12px; }
        .card-custom { border-radius: 12px; border: none; box-shadow: 0 4px 14px rgba(0,0,0,0.06); }
        .badge-khata { background-color: #0b3c6d; font-size: 1.1rem; }
        .step-item { display: flex; align-items: center; padding: 8px 12px; margin-bottom: 6px; border-radius: 8px; background: #f8f9fa; transition: all 0.3s; }
        .step-item.active { background: #e7f1ff; border-left: 4px solid #0d6efd; font-weight: 600; color: #0d6efd; }
        .step-item.completed { background: #e8f7ee; border-left: 4px solid #198754; color: #198754; }
        .terminal-log { background: #1e1e1e; color: #38ef7d; font-family: 'Courier New', Courier, monospace; font-size: 0.85rem; border-radius: 8px; max-height: 140px; overflow-y: auto; }
    </style>
</head>
<body class="p-3 p-md-4">
<div class="container" style="max-width: 980px;">

    <!-- Header -->
    <div class="header-card p-4 mb-4 text-center shadow-sm">
        <h2 class="fw-bold mb-1">🏛️ राजस्थान अपना खाता - लाइव जमाबंदी नकल</h2>
        <p class="mb-0 text-light opacity-75">Cloud Microservice Live Extractor • fabkraft.in</p>
    </div>

    <!-- Input Form -->
    <div class="card card-custom p-4 mb-4 bg-white">
        <form id="extractForm">
            <div class="row g-3">
                <div class="col-md-3">
                    <label class="form-label fw-bold">जिला (District)</label>
                    <input type="text" id="district" name="district" class="form-control" value="भीलवाड़ा" required>
                </div>
                <div class="col-md-3">
                    <label class="form-label fw-bold">तहसील (Tehsil)</label>
                    <input type="text" id="tehsil" name="tehsil" class="form-control" value="बनेड़ा" required>
                </div>
                <div class="col-md-4">
                    <label class="form-label fw-bold">गाँव (Village)</label>
                    <input type="text" id="village" name="village" class="form-control" value="रायला - रायला - रायला" required>
                </div>
                <div class="col-md-2">
                    <label class="form-label fw-bold">खाता संख्या</label>
                    <input type="text" id="searchValue" name="searchValue" class="form-control" value="560" required>
                </div>
            </div>
            <div class="mt-4 text-center">
                <button type="submit" id="submitBtn" class="btn btn-primary btn-lg px-5 shadow">
                    <span id="btnIcon">🔍</span> <span id="btnText">जमाबंदी प्राप्त करें (Extract)</span>
                </button>
            </div>
        </form>
    </div>

    <!-- Live Progress & Activity Tracker (Visible while extracting) -->
    <div id="progressCard" class="card card-custom p-4 bg-white mb-4 d-none">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="fw-bold text-primary mb-0">
                <span class="spinner-border spinner-border-sm text-primary me-2"></span>
                लाइव प्रोसेस स्थिति (Live Extraction Progress)
            </h5>
            <span id="timerBadge" class="badge bg-secondary p-2">⏱️ 0s बीत चुके</span>
        </div>

        <!-- Stepper -->
        <div class="mb-3">
            <div id="step1" class="step-item active">
                <span class="step-icon me-2">🌐</span> 1. राजस्थान अपना खाता पोर्टल से कनेक्शन स्थापित किया जा रहा है...
            </div>
            <div id="step2" class="step-item">
                <span class="step-icon me-2">📜</span> 2. जमाबंदी नकल पोर्टल एवं पॉपअप नोटिस को बायपास किया जा रहा है...
            </div>
            <div id="step3" class="step-item">
                <span class="step-icon me-2">📍</span> 3. जिला ➔ तहसील ➔ "चोसाला पद्धति जमाबंदी" ➔ गाँव का चयन हो रहा है...
            </div>
            <div id="step4" class="step-item">
                <span class="step-icon me-2">🎯</span> 4. "वर्तमान नकल" ➔ "खाता से" चुनकर खाता सं. 560 लोड किया जा रहा है...
            </div>
            <div id="step5" class="step-item">
                <span class="step-icon me-2">🌾</span> 5. काश्तकार, खसरा नंबर और रकबा रिकॉर्ड का विश्लेषण हो रहा है...
            </div>
        </div>

        <!-- Terminal Console -->
        <div class="terminal-log p-3" id="liveConsole">
            <div>[0.0s] 🚀 Extraction initialized. Sending request to cloud browser engine...</div>
        </div>
    </div>

    <!-- Alert Box -->
    <div id="alertBox" class="alert alert-danger d-none shadow-sm" role="alert">
        <h5 class="fw-bold">❌ Error</h5>
        <div id="alertMessage"></div>
    </div>

    <!-- Results Display -->
    <div id="resultContainer" class="d-none">
        <div class="card card-custom p-4 bg-white mb-4">
            <div class="d-flex justify-content-between align-items-center border-bottom pb-3">
                <h4 class="text-success fw-bold mb-0">
                    ✅ जमाबंदी प्रतिलिपि विवरण
                </h4>
                <div>
                    खाता संख्या: <span id="resKhataBadge" class="badge badge-khata">560</span>
                </div>
            </div>

            <!-- Selected Options Verification Badges -->
            <div class="p-3 my-3 bg-light rounded-3 border d-flex flex-wrap gap-2 align-items-center">
                <span class="fw-bold text-dark me-2">⚙️ चयनित विकल्प (Selected Options):</span>
                <span class="badge bg-primary px-3 py-2">📄 नकल: जमाबंदी की प्रतिलिपि</span>
                <span class="badge bg-info text-dark px-3 py-2">⏱️ प्रकार: वर्तमान नकल</span>
                <span class="badge bg-success px-3 py-2">🎯 आधार: खाता से (<span id="optKhataBadge">560</span>)</span>
            </div>

            <!-- Metadata -->
            <div class="row mt-2 mb-3 text-secondary">
                <div class="col-md-4"><strong>जिला:</strong> <span id="resDistrict"></span></div>
                <div class="col-md-4"><strong>तहसील:</strong> <span id="resTehsil"></span></div>
                <div class="col-md-4"><strong>गाँव:</strong> <span id="resVillage"></span></div>
            </div>

            <!-- Owners Section -->
            <div class="mb-4">
                <h5 class="text-primary fw-bold">👥 काश्तकार / खातेदार की सूचना:</h5>
                <ul class="list-group" id="ownersList"></ul>
            </div>

            <!-- Khasra Table -->
            <div class="mb-4">
                <h5 class="text-primary fw-bold">🌾 खसरा एवं रकबा विवरण:</h5>
                <div class="table-responsive">
                    <table class="table table-bordered table-hover mt-2">
                        <thead class="table-dark">
                            <tr>
                                <th style="width: 80px;">क्र. सं.</th>
                                <th>खसरा संख्या (Khasra No)</th>
                                <th>रकबा / क्षेत्रफल (हेक्टेयर)</th>
                                <th>सिंचाई साधन</th>
                                <th>भूमि वर्गीकरण एवं लगान विवरण</th>
                            </tr>
                        </thead>
                        <tbody id="khasraTableBody"></tbody>
                    </table>
                </div>
            </div>

            <!-- Official Webpage Screenshot Preview Card with Multi-Step Tabs -->
            <div id="screenshotCard" class="card border p-3 rounded-3 bg-light d-none">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <h5 class="text-secondary fw-bold mb-0">
                        📸 चरण-दर-चरण स्क्रीनशॉट गैलरी (Step-by-Step Live Screenshots)
                    </h5>
                    <a id="downloadScreenshotBtn" href="#" download="apnakhata_step_screenshot.jpg" class="btn btn-sm btn-outline-primary">
                        💾 डाउनलोड स्क्रीनशॉट
                    </a>
                </div>
                <p class="text-muted small mb-2">प्रत्येक चरण पर वेबपेज की वास्तविक स्थिति देखने के लिए नीचे दिए गए बटन पर क्लिक करें:</p>
                
                <!-- Step Buttons -->
                <div class="btn-group w-100 mb-3 flex-wrap" role="group" id="stepButtonsGroup">
                    <button type="button" class="btn btn-outline-secondary active btn-sm" onclick="showStepImg('1_page_opened', this)">1️⃣ पेज खुला</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="showStepImg('2_jamabandi_selected', this)">2️⃣ जमाबंदी नकल</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="showStepImg('3_vartman_selected', this)">3️⃣ वर्तमान नकल</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="showStepImg('4_khata_selected', this)">4️⃣ खाता से</button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="showStepImg('5_table_rendered', this)">5️⃣ फाइनल टेबल</button>
                </div>

                <div class="text-center p-2 bg-white rounded border">
                    <img id="webScreenshotImg" src="" alt="Apna Khata Step Screenshot" class="img-fluid rounded shadow-sm border" style="max-height: 550px; width: auto;">
                </div>
            </div>

        </div>
    </div>

</div>

<script>
let timerInterval = null;
let secondsElapsed = 0;
let currentStepScreenshots = {};

function showStepImg(stepKey, btnEl) {
    if (btnEl) {
        document.querySelectorAll('#stepButtonsGroup button').forEach(b => b.classList.remove('active', 'btn-primary'));
        btnEl.classList.add('active', 'btn-primary');
        btnEl.classList.remove('btn-outline-secondary');
    }
    const imgEl = document.getElementById('webScreenshotImg');
    const dlBtn = document.getElementById('downloadScreenshotBtn');
    if (currentStepScreenshots && currentStepScreenshots[stepKey]) {
        imgEl.src = currentStepScreenshots[stepKey];
        dlBtn.href = currentStepScreenshots[stepKey];
    } else if (currentStepScreenshots && currentStepScreenshots['5_table_rendered']) {
        imgEl.src = currentStepScreenshots['5_table_rendered'];
        dlBtn.href = currentStepScreenshots['5_table_rendered'];
    }
}

function logStatus(msg) {
    const consoleEl = document.getElementById('liveConsole');
    const timeStr = `[${secondsElapsed}s]`;
    const line = document.createElement('div');
    line.textContent = `${timeStr} ${msg}`;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

function updateStep(activeStepIndex) {
    for (let i = 1; i <= 5; i++) {
        const stepEl = document.getElementById(`step${i}`);
        if (i < activeStepIndex) {
            stepEl.className = 'step-item completed';
        } else if (i === activeStepIndex) {
            stepEl.className = 'step-item active';
        } else {
            stepEl.className = 'step-item';
        }
    }
}

document.getElementById('extractForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const district = document.getElementById('district').value.trim();
    const tehsil = document.getElementById('tehsil').value.trim();
    const village = document.getElementById('village').value.trim();
    const searchValue = document.getElementById('searchValue').value.trim();

    // UI Reset
    document.getElementById('alertBox').classList.add('d-none');
    document.getElementById('resultContainer').classList.add('d-none');
    document.getElementById('progressCard').classList.remove('d-none');
    document.getElementById('submitBtn').disabled = true;
    document.getElementById('btnText').textContent = 'डेटा निकाला जा रहा है...';

    // Reset console & timer
    secondsElapsed = 0;
    document.getElementById('liveConsole').innerHTML = '';
    logStatus(`🚀 Starting Jamabandi Extraction for Khata ${searchValue} in ${village}...`);

    updateStep(1);

    timerInterval = setInterval(() => {
        secondsElapsed++;
        document.getElementById('timerBadge').textContent = `⏱️ ${secondsElapsed}s बीत चुके`;

        if (secondsElapsed === 2) {
            updateStep(2);
            logStatus("🌐 Connected to https://apnakhata.rajasthan.gov.in/");
        } else if (secondsElapsed === 4) {
            updateStep(3);
            logStatus(`📍 District '${district}' and Tehsil '${tehsil}' selected...`);
        } else if (secondsElapsed === 7) {
            updateStep(4);
            logStatus(`🌾 Village '${village}' matched. Opening Jamabandi options...`);
        } else if (secondsElapsed === 11) {
            updateStep(5);
            logStatus(`🎯 Selecting Khata '${searchValue}' and capturing official page screenshot...`);
        } else if (secondsElapsed > 18 && secondsElapsed % 5 === 0) {
            logStatus("⏳ Parsing comprehensive land records from server...");
        }
    }, 1000);

    try {
        const response = await fetch(window.location.href, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                district: district,
                tehsil: tehsil,
                village: village,
                searchValue: searchValue
            })
        });

        const data = await response.json();
        clearInterval(timerInterval);

        if (data.status === 'success' && data.data) {
            updateStep(6);
            logStatus(`✅ SUCCESS! Jamabandi record and screenshots extracted in ${secondsElapsed}s.`);
            renderResults(data.data, searchValue);
        } else {
            throw new Error(data.message || 'Extraction failed or returned invalid response.');
        }

    } catch (err) {
        clearInterval(timerInterval);
        logStatus(`❌ Failed: ${err.message}`);
        document.getElementById('alertMessage').textContent = err.message;
        document.getElementById('alertBox').classList.remove('d-none');
    } finally {
        document.getElementById('submitBtn').disabled = false;
        document.getElementById('btnText').textContent = 'जमाबंदी प्राप्त करें (Extract)';
    }
});

function renderResults(result, searchVal) {
    const kNum = result.khataNumber || searchVal;
    document.getElementById('resKhataBadge').textContent = kNum;
    if (document.getElementById('optKhataBadge')) {
        document.getElementById('optKhataBadge').textContent = kNum;
    }
    document.getElementById('resDistrict').textContent = result.district || '-';
    document.getElementById('resTehsil').textContent = result.tehsil || '-';
    document.getElementById('resVillage').textContent = result.village || '-';

    // Render Owners
    const ownersList = document.getElementById('ownersList');
    ownersList.innerHTML = '';
    if (result.owners && result.owners.length > 0) {
        result.owners.forEach(owner => {
            const li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = `👤 ${escapeHtml(owner)}`;
            ownersList.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.className = 'list-group-item text-muted';
        li.textContent = 'खातेदार विवरण उपलब्ध';
        ownersList.appendChild(li);
    }

    // Render Khasra Table (5 columns)
    const tbody = document.getElementById('khasraTableBody');
    tbody.innerHTML = '';
    if (result.khasraRecords && result.khasraRecords.length > 0) {
        result.khasraRecords.forEach((rec, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td><span class="badge bg-secondary fs-6">${escapeHtml(rec.khasraNo || '')}</span></td>
                <td><strong>${escapeHtml(rec.rakbaHectare || '')}</strong></td>
                <td>${escapeHtml(rec.irrigation || '-')}</td>
                <td>${escapeHtml(rec.soilAndTax || '')}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">कोई खसरा रिकॉर्ड नहीं मिला</td></tr>`;
    }

    // Render Step Screenshots
    const screenshotCard = document.getElementById('screenshotCard');
    currentStepScreenshots = result.stepScreenshots || {};
    if (result.screenshotBase64 && !currentStepScreenshots['5_table_rendered']) {
        currentStepScreenshots['5_table_rendered'] = result.screenshotBase64;
    }

    if (Object.keys(currentStepScreenshots).length > 0) {
        screenshotCard.classList.remove('d-none');
        // Show last available step by default
        const keys = Object.keys(currentStepScreenshots);
        const lastKey = keys[keys.length - 1];
        showStepImg(lastKey, document.querySelector(`#stepButtonsGroup button:nth-child(${keys.length})`));
    } else {
        screenshotCard.classList.add('d-none');
    }

    document.getElementById('resultContainer').classList.remove('d-none');
    document.getElementById('resultContainer').scrollIntoView({ behavior: 'smooth' });
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
</script>
</body>
</html>
