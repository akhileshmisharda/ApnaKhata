<?php
/**
 * Apna Khata (Rajasthan) Jamabandi Extractor - PHP Client
 * Hosted on: http://fabkraft.in/
 * Connected to Render Scraper API: https://apnakhata-juof.onrender.com/api/extract
 */

header('Content-Type: text/html; charset=UTF-8');

$district = $_POST['district'] ?? 'भीलवाड़ा';
$tehsil = $_POST['tehsil'] ?? 'बनेड़ा';
$village = $_POST['village'] ?? 'रायला - रायला - रायला';
$searchValue = $_POST['searchValue'] ?? '560';

$resultData = null;
$errorMessage = null;

// The Live Scraper API URL on Render
$apiUrl = 'https://apnakhata-juof.onrender.com/api/extract';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $payload = json_encode([
        'district'    => $district,
        'tehsil'      => $tehsil,
        'village'     => $village,
        'searchBy'    => 'khata',
        'searchValue' => $searchValue,
        'headless'    => true // Headless on Render server
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
        $errorMessage = "cURL Connection Error: " . $curlError;
    } elseif ($httpCode === 502 || $httpCode === 504) {
        $errorMessage = "The Render cloud server is waking up from idle state (Cold Start) or hit a temporary gateway timeout. Please wait 30 seconds and click 'Extract' again.";
    } elseif ($httpCode !== 200) {
        $json = json_decode($response, true);
        if ($json && isset($json['message'])) {
            $errorMessage = "Extraction Error (HTTP " . $httpCode . "): " . $json['message'];
        } else {
            $errorMessage = "Extraction Server Error (HTTP " . $httpCode . "): " . strip_tags(substr($response, 0, 300));
        }
    } else {
        $json = json_decode($response, true);
        if ($json && isset($json['status']) && $json['status'] === 'success') {
            $resultData = $json['data'];
        } else {
            $errorMessage = $json['message'] ?? 'Unknown error occurred during extraction.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>अपना खाता - जमाबंदी एक्सट्रेक्टर (fabkraft.in)</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .header-card { background: linear-gradient(135deg, #002e5b, #005691); color: white; border-radius: 10px; }
        .result-card { border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .badge-khata { background-color: #002e5b; font-size: 1rem; }
    </style>
</head>
<body class="p-4">
<div class="container" style="max-width: 950px;">

    <!-- Header -->
    <div class="header-card p-4 mb-4 text-center">
        <h2>🏛️ राजस्थान अपना खाता - जमाबंदी नकल</h2>
        <p class="mb-0">Powered by Fabkraft (PHP + Render Cloud API)</p>
    </div>

    <!-- Input Form -->
    <div class="card result-card p-4 mb-4 bg-white">
        <form method="POST" action="">
            <div class="row g-3">
                <div class="col-md-3">
                    <label class="form-label fw-bold">जिला (District)</label>
                    <input type="text" name="district" class="form-control" value="<?= htmlspecialchars($district) ?>" required>
                </div>
                <div class="col-md-3">
                    <label class="form-label fw-bold">तहसील (Tehsil)</label>
                    <input type="text" name="tehsil" class="form-control" value="<?= htmlspecialchars($tehsil) ?>" required>
                </div>
                <div class="col-md-4">
                    <label class="form-label fw-bold">गाँव (Village)</label>
                    <input type="text" name="village" class="form-control" value="<?= htmlspecialchars($village) ?>" required>
                </div>
                <div class="col-md-2">
                    <label class="form-label fw-bold">खाता सं. (Khata No)</label>
                    <input type="text" name="searchValue" class="form-control" value="<?= htmlspecialchars($searchValue) ?>" required>
                </div>
            </div>
            <div class="mt-4 text-center">
                <button type="submit" class="btn btn-primary btn-lg px-5">
                    🔍 जमाबंदी प्राप्त करें (Extract)
                </button>
            </div>
        </form>
    </div>

    <!-- Error Message -->
    <?php if ($errorMessage): ?>
        <div class="alert alert-danger" role="alert">
            <h5>❌ Error</h5>
            <p class="mb-0"><?= htmlspecialchars($errorMessage) ?></p>
        </div>
    <?php endif; ?>

    <!-- Results Display -->
    <?php if ($resultData): ?>
        <div class="card result-card p-4 bg-white mb-4">
            <h4 class="text-success border-bottom pb-2">
                ✅ जमाबंदी प्रतिलिपि विवरण (खाता संख्या: <span class="badge badge-khata"><?= htmlspecialchars($resultData['khataNumber'] ?? $searchValue) ?></span>)
            </h4>

            <!-- Metadata -->
            <div class="row mt-3 mb-3 text-muted">
                <div class="col-md-4"><strong>जिला:</strong> <?= htmlspecialchars($resultData['district'] ?? '') ?></div>
                <div class="col-md-4"><strong>तहसील:</strong> <?= htmlspecialchars($resultData['tehsil'] ?? '') ?></div>
                <div class="col-md-4"><strong>गाँव:</strong> <?= htmlspecialchars($resultData['village'] ?? '') ?></div>
            </div>

            <!-- Owners Section -->
            <div class="mb-4">
                <h5 class="text-primary">👥 काश्तकार / खातेदार की सूचना:</h5>
                <ul class="list-group">
                    <?php if (!empty($resultData['owners'])): ?>
                        <?php foreach ($resultData['owners'] as $owner): ?>
                            <li class="list-group-item">👤 <?= htmlspecialchars($owner) ?></li>
                        <?php endforeach; ?>
                    <?php else: ?>
                        <li class="list-group-item text-muted">खातेदार उपलब्ध</li>
                    <?php endif; ?>
                </ul>
            </div>

            <!-- Khasra Table -->
            <div>
                <h5 class="text-primary">🌾 खसरा एवं रकबा विवरण:</h5>
                <div class="table-responsive">
                    <table class="table table-bordered table-hover mt-2">
                        <thead class="table-dark">
                            <tr>
                                <th>क्र. सं.</th>
                                <th>खाता संख्या</th>
                                <th>खसरा संख्या</th>
                                <th>रकबा (हेक्टेयर)</th>
                                <th>सिंचाई साधन</th>
                                <th>भूमि वर्गीकरण एवं लगान विवरण</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php if (!empty($resultData['khasraRecords'])): ?>
                                <?php foreach ($resultData['khasraRecords'] as $idx => $record): ?>
                                    <tr>
                                        <td><?= $idx + 1 ?></td>
                                        <td><strong><?= htmlspecialchars($record['khataNo'] ?? '') ?></strong></td>
                                        <td><span class="badge bg-secondary"><?= htmlspecialchars($record['khasraNo'] ?? '') ?></span></td>
                                        <td><?= htmlspecialchars($record['rakbaHectare'] ?? '') ?></td>
                                        <td><?= htmlspecialchars($record['irrigation'] ?? '-') ?></td>
                                        <td><?= htmlspecialchars($record['soilAndTax'] ?? '') ?></td>
                                    </tr>
                                <?php endforeach; ?>
                            <?php else: ?>
                                <tr>
                                    <td colspan="6" class="text-center text-muted">No Khasra records parsed.</td>
                                </tr>
                            <?php endif; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    <?php endif; ?>

</div>
</body>
</html>
