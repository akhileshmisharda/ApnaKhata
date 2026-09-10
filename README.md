# Apna Khata Rajasthan Jamabandi Extractor

A robust Node.js and Puppeteer automation script to automatically navigate Rajasthan's [Apna Khata](https://apnakhata.rajasthan.gov.in/) portal, fill dropdowns (District, Tehsil, Village), search land records, and extract Jamabandi copies into **JSON**, **CSV**, **PDF**, and **Screenshot (PNG)**.

---

## 📌 Features

- **Automated Dropdown & Map Navigation**: Handles District, Tehsil, and Village selections with ASP.NET AJAX wait synchronization.
- **Multiple Search Methods**: Supports querying by:
  - Khata Number (खाता संख्या)
  - Khasra Number (खसरा संख्या)
  - Owner Name (खातेदार का नाम)
  - USN / GSN
- **Applicant Form Autofill**: Automatically populates required applicant details (Name, Address, City, Pincode).
- **Comprehensive Output**:
  - **JSON**: Full parsed record with header metadata, Khatedaar (owner) table, Khasra details (area/rakba, soil type, tax), and mutation history.
  - **CSV**: UTF-8 encoded with BOM for Excel compatibility with Hindi fonts.
  - **PDF & Screenshot**: Clean captured digital copy of the Jamabandi.
- **Two Execution Modes**: Automated (via `config.json` / CLI args) or Interactive prompt mode.

---

## 🚀 Quick Start

### 1. Install Dependencies
Open your terminal in `c:\D_Drive\ApnaKhata` and install packages:

```bash
npm install
```

### 2. Configure Your Search
Open `config.json` and adjust the district, tehsil, village, and search values:

```json
{
  "district": "जयपुर",
  "tehsil": "जयपुर",
  "village": "अमरसर",
  "searchBy": "khata",
  "searchValue": "1",
  "applicant": {
    "name": "राम कुमार",
    "city": "जयपुर",
    "address": "जयपुर, राजस्थान",
    "pinCode": "302001"
  },
  "options": {
    "headless": false,
    "slowMo": 50,
    "timeout": 60000,
    "saveScreenshot": true,
    "savePdf": true,
    "saveCsv": true,
    "saveJson": true,
    "outputDir": "./output"
  }
}
```

### 3. Run the Extractor

#### Option A: Run using Config File / CLI
```bash
npm start
```

Or pass command-line arguments:
```bash
node src/index.js --district "जयपुर" --tehsil "सांगानेर" --searchBy "khata" --searchValue "12"
```

#### Option B: Run in Interactive Mode
Prompt-by-prompt interactive terminal:
```bash
npm run interactive
```

---

## 📂 Output Files

Extracted results are saved in the `./output` directory:
- `jamabandi_<district>_<searchBy>_<val>_<timestamp>.json`
- `jamabandi_<district>_<searchBy>_<val>_<timestamp>_table_1.csv`
- `jamabandi_<district>_<searchBy>_<val>_<timestamp>.png`
- `jamabandi_<district>_<searchBy>_<val>_<timestamp>.pdf`

---

## ⚙️ Configuration Reference

| Field | Type | Description |
|---|---|---|
| `district` | `string` | District name in Hindi (e.g. `"जयपुर"`, `"जोधपुर"`) or English |
| `tehsil` | `string` | Tehsil name in Hindi |
| `village` | `string` | Village name (leave empty to select manually on screen) |
| `searchBy` | `string` | `"khata"`, `"khasra"`, `"name"`, or `"usn"` |
| `searchValue` | `string` | The account number, khasra number, or name |
| `options.headless` | `boolean` | `false` shows Chrome window; `true` runs in background |
| `options.slowMo` | `number` | Milliseconds to slow down actions for visual inspection |
| `options.outputDir` | `string` | Destination directory for output files |

