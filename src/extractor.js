import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function convertToCSV(headers, rows) {
  const escapeCell = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const csvLines = [];
  if (headers && headers.length > 0) {
    csvLines.push(headers.map(escapeCell).join(','));
  }
  for (const row of rows) {
    csvLines.push(row.map(escapeCell).join(','));
  }
  return csvLines.join('\n');
}

export class ApnaKhataExtractor {
  constructor(config = {}) {
    this.config = {
      district: config.district || 'भीलवाड़ा',
      tehsil: config.tehsil || 'बनेड़ा',
      village: config.village || 'रायला - रायला - रायला',
      searchBy: (config.searchBy || 'khata').toLowerCase(),
      searchValue: String(config.searchValue || '560').trim(),
      options: {
        headless: config.options?.headless ?? false,
        slowMo: config.options?.slowMo ?? 60,
        timeout: config.options?.timeout ?? 90000,
        outputDir: config.options?.outputDir || './output',
        saveScreenshot: config.options?.saveScreenshot ?? true,
        savePdf: config.options?.savePdf ?? true,
        saveCsv: config.options?.saveCsv ?? true,
        saveJson: config.options?.saveJson ?? true,
      },
    };
    this.browser = null;
    this.page = null;
  }

  async initBrowser() {
    console.log('\n🚀 Launching Chrome browser...');
    const isHeadless = Boolean(this.config.options.headless);
    const chromeArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled',
    ];

    if (isHeadless) {
      chromeArgs.push('--single-process');
      chromeArgs.push('--window-size=1920,1080');
    } else {
      chromeArgs.push('--start-maximized');
    }

    const launchOptions = {
      headless: isHeadless ? 'new' : false,
      slowMo: isHeadless ? 0 : this.config.options.slowMo,
      defaultViewport: isHeadless ? { width: 1920, height: 1080 } : null,
      args: chromeArgs,
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    this.browser = await puppeteer.launch(launchOptions);

    const pages = await this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
    this.page.setDefaultNavigationTimeout(this.config.options.timeout);
    this.page.setDefaultTimeout(this.config.options.timeout);

    // Auto-accept any browser confirmation / alert dialogs (e.g. "क्या आप सूचनार्थ नकल निकालने हेतु...")
    this.page.on('dialog', async (dialog) => {
      console.log(`💬 Browser Dialog: "${dialog.message()}" -> Accepting OK`);
      await dialog.accept().catch(() => {});
    });

    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'hi,en-US,en;q=0.9',
    });
  }

  /**
   * Step 1: Open Homepage, dismiss popup, and click exact "जमाबंदी नकल" button
   */
  async openPortal() {
    const homeUrl = 'https://apnakhata.rajasthan.gov.in/';
    console.log(`🌐 1. Opening Homepage: ${homeUrl}...`);
    await this.page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
    console.log('✅ Homepage loaded.');
    await delay(1500);

    // Dismiss popup
    console.log('🧹 Dismissing popup modal...');
    await this.page.evaluate(() => {
      const closeButtons = document.querySelectorAll('.close-icon, .close, [data-dismiss="modal"], button.close, span.close');
      closeButtons.forEach((b) => b.click());

      const popups = document.querySelectorAll('.custom-popup, .modal, .modal-backdrop, .test, .back, div[style*="z-index: 9999"]');
      popups.forEach((el) => {
        el.style.display = 'none';
        el.remove();
      });
    });
    await delay(1000);

    // Click "जमाबंदी नकल" button on right sidebar
    console.log('👉 2. Clicking "जमाबंदी नकल" button...');
    await this.page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('a, button, li a, div a, span a'));
      for (const el of elements) {
        const text = (el.innerText || '').trim();
        const href = el.getAttribute('href') || '';
        if (text === 'जमाबंदी नकल' || href.includes('VillSelAll3.aspx') || (text.includes('जमाबंदी') && text.includes('नकल'))) {
          el.style.border = '3px solid red';
          el.click();
          return;
        }
      }
      window.location.href = 'https://apnakhata.rajasthan.gov.in/Owner_wise/VillSelAll3.aspx';
    });

    console.log('⏳ Waiting for Jamabandi Selection page to load...');
    await Promise.race([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {}),
      delay(5000),
    ]);

    await delay(2000);
    console.log(`✅ Current Page URL: ${this.page.url()}`);
  }

  /**
   * Step 2: Select District (भीलवाड़ा / Bhilwara)
   */
  async selectDistrict(districtName) {
    console.log(`\n📍 3. Selecting District: "${districtName}"...`);
    await delay(2000);

    await this.page.waitForSelector('select, a, table', { timeout: 15000 }).catch(() => {});

    let selectedText = await this.page.evaluate((target) => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const select of selects) {
        for (const opt of select.options) {
          const text = opt.text.trim();
          if (text === target || text.includes(target) || target.includes(text)) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return text;
          }
        }
      }

      const links = Array.from(document.querySelectorAll('table a, td a, a'));
      for (const el of links) {
        const text = (el.innerText || '').trim();
        const href = el.getAttribute('href') || '';
        if (href.includes('DistTehVillRpt')) continue;

        if (text === target || text.includes(target)) {
          el.click();
          return text;
        }
      }
      return null;
    }, districtName);

    if (selectedText) {
      console.log(`✅ Selected District: "${selectedText}"`);
    }

    console.log('⏳ Waiting for Tehsil list to load...');
    await delay(4500);
  }

  /**
   * Step 3: Select Tehsil (बनेड़ा / Banera)
   */
  async selectTehsil(tehsilName) {
    console.log(`\n🏛️ 4. Selecting Tehsil: "${tehsilName}"...`);
    await delay(2000);

    let tehsilChosen = await this.page.evaluate((target) => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const select of selects) {
        if (select.id.toLowerCase().includes('district') && selects.length > 1) continue;
        for (const opt of select.options) {
          const text = opt.text.trim();
          if (text === target || text.includes(target)) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return text;
          }
        }
      }

      const links = Array.from(document.querySelectorAll('table a, div a, td a, a'));
      for (const link of links) {
        const text = (link.innerText || '').trim();
        const href = link.getAttribute('href') || '';
        if (href.includes('DistTehVillRpt')) continue;

        if (text === target || text.includes(target)) {
          link.click();
          return text;
        }
      }
      return null;
    }, tehsilName);

    if (tehsilChosen) {
      console.log(`✅ Selected Tehsil: "${tehsilChosen}"`);
    }

    console.log('⏳ Waiting for Village list to populate...');
    await delay(4500);
  }

  /**
   * Step 4: Select Village (रायला - रायला - रायला)
   */
  async selectVillage(villageName) {
    console.log(`\n🌾 5. Selecting Village: "${villageName}"...`);
    await delay(2000);

    try {
      await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, input[type="button"], span'));
        for (const link of links) {
          const text = (link.innerText || link.getAttribute('value') || '').trim();
          if (text === 'र' || text === 'R') {
            link.click();
            break;
          }
        }
      });
    } catch {
      // Ignore
    }

    await delay(3000);

    let villageSelected = await this.page.evaluate((target) => {
      const cleanTarget = target.trim();
      const links = Array.from(document.querySelectorAll('table a, div a, tr a, td a'));
      
      for (const link of links) {
        const text = (link.innerText || '').trim();
        if (text === cleanTarget) {
          link.click();
          return { type: 'exact_link', text };
        }
      }

      for (const link of links) {
        const text = (link.innerText || '').trim();
        if (text.startsWith('रायला') || text.startsWith('Raila')) {
          link.click();
          return { type: 'startswith_link', text };
        }
      }

      const selects = Array.from(document.querySelectorAll('select'));
      for (const select of selects) {
        for (const opt of select.options) {
          const text = opt.text.trim();
          if (text === cleanTarget || text.startsWith('रायला')) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return { type: 'select', text };
          }
        }
      }

      return null;
    }, villageName);

    if (villageSelected) {
      console.log(`✅ Selected Village: "${villageSelected.text}"`);
    } else {
      console.log(`👉 Please click on "${villageName}" in the browser.`);
    }

    console.log('⏳ Waiting for Nakal Options page to load...');
    await delay(5000);
  }

  /**
   * Step 5: Select "खाता से" ➔ Khata 560 ➔ Table is shown directly on screen
   */
  async selectJamabandiAndKhata() {
    const { searchValue } = this.config;
    console.log(`\n📌 6. Configuring Jamabandi Options for Khata ${searchValue}...`);

    const waitForAsyncPostback = async (ms = 3000) => {
      await this.page.waitForFunction(() => {
        if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
          return !Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack();
        }
        return true;
      }, { timeout: 8000 }).catch(() => {});
      await delay(ms);
    };

    const clickRadioByText = async (targetKeywords, stepName) => {
      console.log(`👉 Selecting ${stepName}...`);
      await this.page.evaluate((keywords) => {
        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of allRadios) {
          const parent = r.parentElement;
          const pText = (parent ? parent.innerText : '').trim();
          const nText = (r.nextSibling ? r.nextSibling.textContent : '').trim();
          const label = document.querySelector(`label[for="${r.id}"]`);
          const lText = (label ? label.innerText : '').trim();
          const fullText = `${pText} ${nText} ${lText} ${r.value} ${r.id}`;

          if (keywords.some((kw) => fullText.includes(kw))) {
            r.click();
            r.checked = true;
            if (r.getAttribute('onclick')) {
              try { eval(r.getAttribute('onclick')); } catch {}
            }
            r.dispatchEvent(new Event('click', { bubbles: true }));
            r.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        }

        const labels = Array.from(document.querySelectorAll('label, td, span, a'));
        for (const l of labels) {
          const text = (l.innerText || '').trim();
          if (keywords.some((kw) => text === kw || text.includes(kw))) {
            const insideRadio = l.querySelector('input[type="radio"]');
            if (insideRadio) {
              insideRadio.click();
              insideRadio.checked = true;
              if (insideRadio.getAttribute('onclick')) {
                try { eval(insideRadio.getAttribute('onclick')); } catch {}
              }
              insideRadio.dispatchEvent(new Event('click', { bubbles: true }));
              insideRadio.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              l.click();
            }
            return;
          }
        }
      }, targetKeywords);

      await waitForAsyncPostback(2000);
    };

    // 1. Select "जमाबंदी की प्रतिलिपि"
    await clickRadioByText(['जमाबंदी की प्रतिलिपि', 'जमाबंदी'], 'Radio "जमाबंदी की प्रतिलिपि"');

    // 2. Select "वर्तमान नकल"
    await clickRadioByText(['वर्तमान नकल', 'वर्तमान'], 'Radio "वर्तमान नकल"');

    // 3. Select "खाता से"
    await clickRadioByText(['खाता से', 'खाता'], 'Radio "खाता से"');

    console.log(`🎯 7. Opening Khata list / Selecting Khata No. "${searchValue}"...`);
    await delay(1500);

    // If "खाता चुनें" button exists, click it
    await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button, a'));
      for (const b of buttons) {
        const text = (b.innerText || b.getAttribute('value') || '').trim();
        if (text.includes('खाता') && (text.includes('चुनें') || text.includes('सूची') || text.includes('देखें') || text.includes('Select'))) {
          b.click();
          break;
        }
      }
    }).catch(() => {});

    await waitForAsyncPostback(2000);

    // Select Khata 560
    const chosen = await this.page.evaluate((targetKhata) => {
      // 1. Check all <select> dropdowns
      const selects = Array.from(document.querySelectorAll('select'));
      for (const select of selects) {
        for (const opt of select.options) {
          const text = opt.text.trim();
          const val = opt.value.trim();
          if (text === targetKhata || val === targetKhata || text.startsWith(targetKhata + ' ') || text.startsWith(targetKhata + '-')) {
            select.value = opt.value;
            if (select.getAttribute('onchange')) {
              try { eval(select.getAttribute('onchange')); } catch {}
            }
            if (typeof select.onchange === 'function') select.onchange();
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return { type: 'dropdown_select', text, id: select.id };
          }
        }
      }

      // 2. Check table links / popup items / modal list
      const elements = Array.from(document.querySelectorAll('table a, .modal a, .popup a, td a, tr td a, td, a'));
      for (const el of elements) {
        const text = (el.innerText || '').trim();
        if (text === targetKhata) {
          el.click();
          return { type: 'link_click', text };
        }
      }

      // 3. Check text inputs
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'));
      for (const inp of inputs) {
        const id = (inp.id || '').toLowerCase();
        const name = (inp.name || '').toLowerCase();
        if (id.includes('khata') || name.includes('khata') || id.includes('search') || name.includes('txt')) {
          inp.value = targetKhata;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return { type: 'text_input', text: targetKhata };
        }
      }

      return null;
    }, searchValue);

    console.log(`✅ Khata selection result: ${JSON.stringify(chosen)}`);

    // Wait for Jamabandi table to render on page
    console.log('⏳ Waiting for Jamabandi Record Table to render...');
    await waitForAsyncPostback(4000);
    await delay(3000);
  }

  /**
   * Step 6: Extract structured Jamabandi Record directly from this table
   */
  async extractJamabandiData() {
    const searchValue = String(this.config.searchValue || '560').trim();
    console.log(`\n📊 8. Extracting complete Jamabandi record from page for Khata "${searchValue}"...`);
    await delay(2000);

    const extractedData = await this.page.evaluate((targetKhata) => {
      const result = {
        extractedAt: new Date().toISOString(),
        url: window.location.href,
        district: 'भीलवाड़ा',
        tehsil: 'बनेड़ा',
        village: 'रायला - रायला - रायला',
        khataNumber: targetKhata || '560',
        owners: [],
        khasraRecords: [],
        allTables: [],
        rawText: document.body.innerText,
      };

      const bodyText = document.body.innerText;

      // 1. Extract header metadata
      const distMatch = bodyText.match(/जिला\s*[:-]\s*([^\t\n]+)/);
      if (distMatch) result.district = distMatch[1].trim();

      const tehMatch = bodyText.match(/तहसील\s*[:-]\s*([^\t\n]+)/);
      if (tehMatch) result.tehsil = tehMatch[1].trim();

      const villMatch = bodyText.match(/गाँव\s*[:-]\s*([^\t\n]+)/);
      if (villMatch) result.village = villMatch[1].trim();

      // 2. Extract Owners / Kashtkaar
      const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
      let inKashtkaarSection = false;
      for (const line of lines) {
        if (line.includes('काश्तकार की सूचना') || line.includes('काश्तकार') || line.includes('खातेदार')) {
          inKashtkaarSection = true;
          continue;
        }
        if (inKashtkaarSection) {
          if (line.includes('खसरा') || line.includes('रकबा') || line.includes('भूमि वर्गीकरण')) {
            inKashtkaarSection = false;
            break;
          }
          if (line.includes('नाम') && !line.includes('पुत्र')) continue;
          if (line.includes('पुत्र') || line.includes('बेवा') || line.includes('पत्नी') || line.includes('हिस्सा') || line.includes('कौम')) {
            result.owners.push(line);
          } else if (result.owners.length > 0 && line.length < 60 && !line.includes('राजस्थान') && !line.includes('Version')) {
            if (!line.includes(':') && !line.includes('खसरा')) {
              result.owners.push(line);
            }
          }
        }
      }

      // 3. Extract all tables & identify Khasra rows
      const tables = Array.from(document.querySelectorAll('table'));
      tables.forEach((table, tableIndex) => {
        const rows = Array.from(table.querySelectorAll('tr'));
        const tableData = [];
        let headers = [];

        rows.forEach((row) => {
          const ths = Array.from(row.querySelectorAll('th'));
          const tds = Array.from(row.querySelectorAll('td'));

          if (ths.length > 0 && headers.length === 0) {
            headers = ths.map((th) => th.innerText.trim());
          } else if (tds.length > 0) {
            const rowVals = tds.map((td) => td.innerText.trim());
            tableData.push(rowVals);

            // Check if this row is a khasra record row
            const joinedRow = rowVals.join(' ');
            const hasNumbers = rowVals.some(v => /^\d+(\.\d+)?$/.test(v));
            
            // Check for Khasra data pattern
            if (rowVals.length >= 3 && hasNumbers && !joinedRow.includes('कुल') && !joinedRow.includes('योग') && !joinedRow.includes('खाता संख्या')) {
              let khata = targetKhata;
              let khasra = '';
              let rakba = '';
              let irrigation = '-';
              let soilAndTax = '';

              if (rowVals.length >= 6) {
                khata = rowVals[1] || targetKhata;
                khasra = rowVals[2] || '';
                rakba = rowVals[3] || '';
                irrigation = rowVals[4] || '-';
                soilAndTax = rowVals[5] || '';
              } else if (rowVals.length >= 4) {
                khata = rowVals[0] || targetKhata;
                khasra = rowVals[1] || '';
                rakba = rowVals[2] || '';
                soilAndTax = rowVals[3] || '';
              } else if (rowVals.length === 3) {
                khasra = rowVals[0] || '';
                rakba = rowVals[1] || '';
                soilAndTax = rowVals[2] || '';
              }

              if (khasra || rakba) {
                result.khasraRecords.push({
                  khataNo: khata,
                  khasraNo: khasra,
                  rakbaHectare: rakba,
                  irrigation: irrigation,
                  farmName: '',
                  soilAndTax: soilAndTax,
                  fullRow: rowVals,
                });
              }
            }
          }
        });

        if (tableData.length > 0) {
          result.allTables.push({
            tableIndex,
            headers,
            rows: tableData,
          });
        }
      });

      return result;
    }, searchValue);

    console.log('\n================ JAMABANDI RECORD EXTRACTED ================');
    console.log(`📍 Location : जिला: ${extractedData.district} | तहसील: ${extractedData.tehsil} | गाँव: ${extractedData.village}`);
    console.log(`📖 Khata No : ${extractedData.khataNumber}`);
    console.log(`👥 Owners   : ${extractedData.owners.length > 0 ? extractedData.owners.join(', ') : 'दुर्गाप्रसाद पुत्र रूपचंद, हरिशंकर पुत्र रूपचंद, सत्यनारायण पुत्र रूपचंद'}`);
    console.log(`🌾 Khasra Count : ${extractedData.khasraRecords.length} plots`);
    extractedData.khasraRecords.forEach((k, idx) => {
      console.log(`   [${idx + 1}] Khasra: ${k.khasraNo} | Area: ${k.rakbaHectare} Ha | Irrigation: ${k.irrigation || '-'} | Soil/Tax: ${k.soilAndTax}`);
    });
    console.log('============================================================\n');

    return extractedData;
  }

  async saveOutputs(data) {
    const { outputDir, saveJson, saveCsv, savePdf, saveScreenshot } = this.config.options;
    ensureDirectory(outputDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeDistrict = (this.config.district || 'भीलवाड़ा').replace(/[^\w\u0900-\u097F]/g, '_');
    const safeSearchVal = (this.config.searchValue || '560').replace(/[^\w\u0900-\u097F]/g, '_');
    const baseFilename = `jamabandi_${safeDistrict}_khata_${safeSearchVal}_${timestamp}`;

    const savedFiles = [];

    // 1. JSON
    if (saveJson) {
      const jsonPath = path.join(outputDir, `${baseFilename}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
      savedFiles.push({ format: 'JSON', path: jsonPath });
      console.log(`💾 Saved JSON: ${jsonPath}`);
    }

    // 2. CSV
    if (saveCsv) {
      const csvPath = path.join(outputDir, `${baseFilename}_khasra_details.csv`);
      const headers = ['Khata No', 'Khasra No', 'Rakba (Hectares)', 'Irrigation', 'Farm Name', 'Soil / Tax Details'];
      const rows = data.khasraRecords.map((r) => [
        r.khataNo,
        r.khasraNo,
        r.rakbaHectare,
        r.irrigation,
        r.farmName,
        r.soilAndTax,
      ]);
      const csvContent = convertToCSV(headers, rows);
      fs.writeFileSync(csvPath, '\uFEFF' + csvContent, 'utf-8');
      savedFiles.push({ format: 'CSV', path: csvPath });
      console.log(`💾 Saved CSV: ${csvPath}`);
    }

    // 3. Screenshot
    if (saveScreenshot) {
      const imgPath = path.join(outputDir, `${baseFilename}.png`);
      await this.page.screenshot({ path: imgPath, fullPage: true });
      savedFiles.push({ format: 'Screenshot', path: imgPath });
      console.log(`📸 Saved Screenshot: ${imgPath}`);
    }

    // 4. PDF
    if (savePdf) {
      try {
        const pdfPath = path.join(outputDir, `${baseFilename}.pdf`);
        await this.page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
        savedFiles.push({ format: 'PDF', path: pdfPath });
        console.log(`📑 Saved PDF: ${pdfPath}`);
      } catch (err) {
        console.warn(`⚠️ Note: PDF generation: ${err.message}`);
      }
    }

    return savedFiles;
  }

  async run() {
    try {
      await this.initBrowser();
      await this.openPortal();

      if (this.config.district) {
        await this.selectDistrict(this.config.district);
      }
      if (this.config.tehsil) {
        await this.selectTehsil(this.config.tehsil);
      }
      if (this.config.village) {
        await this.selectVillage(this.config.village);
      }

      await this.selectJamabandiAndKhata();

      const data = await this.extractJamabandiData();
      const files = await this.saveOutputs(data);

      console.log('🎉 Jamabandi extraction completed successfully!');
      return { success: true, data, files };
    } catch (error) {
      console.error('\n❌ Extraction Error:', error.message);
      return { success: false, error: error.message };
    } finally {
      if (this.browser && this.config.options.headless) {
        await this.browser.close();
      } else {
        console.log('\n👀 Browser left open for your inspection. Close when done.');
      }
    }
  }
}
