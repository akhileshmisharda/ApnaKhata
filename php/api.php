<?php
/**
 * Apna Khata (Rajasthan) Jamabandi Extraction API
 * Endpoint: http://fabkraft.in/api.php
 * Supports: GET and POST requests
 * Returns: Clean JSON
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$backendUrl = 'https://apnakhata-juof.onrender.com/api/jamabandi';

// Read parameters from GET, POST, or raw JSON body
$district = $_GET['district'] ?? $_POST['district'] ?? null;
$tehsil = $_GET['tehsil'] ?? $_POST['tehsil'] ?? null;
$village = $_GET['village'] ?? $_POST['village'] ?? null;
$khata = $_GET['khata'] ?? $_GET['searchValue'] ?? $_POST['khata'] ?? $_POST['searchValue'] ?? null;

if (!$district || !$tehsil || !$village || !$khata) {
    $rawInput = file_get_contents('php://input');
    if ($rawInput) {
        $jsonInput = json_decode($rawInput, true);
        if ($jsonInput) {
            $district = $district ?? $jsonInput['district'] ?? null;
            $tehsil = $tehsil ?? $jsonInput['tehsil'] ?? null;
            $village = $village ?? $jsonInput['village'] ?? null;
            $khata = $khata ?? $jsonInput['khata'] ?? $jsonInput['searchValue'] ?? null;
        }
    }
}

// Defaults if not provided
$district = $district ?: 'भीलवाड़ा';
$tehsil = $tehsil ?: 'बनेड़ा';
$village = $village ?: 'रायला - रायला - रायला';
$khata = $khata ?: '560';

$payload = json_encode([
    'district' => $district,
    'tehsil'   => $tehsil,
    'village'  => $village,
    'khata'    => (string)$khata,
], JSON_UNESCAPED_UNICODE);

$ch = curl_init($backendUrl);
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
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'status'  => 'error',
        'message' => 'Backend Connection Error: ' . $curlError,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

if ($httpCode === 502 || $httpCode === 504) {
    http_response_code(503);
    echo json_encode([
        'success' => false,
        'status'  => 'error',
        'message' => 'Scraper engine is waking up from idle state. Please retry in 20 seconds.',
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

http_response_code($httpCode);
echo $response;

