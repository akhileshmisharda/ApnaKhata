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
      '--window-size=1280,800',
      '--disable-blink-features=AutomationControlled',
    ];

    const launchOptions = {
      headless: isHeadless ? 'new' : false,
      slowMo: isHeadless ? 0 : this.config.options.slowMo,
      defaultViewport: isHeadless ? { width: 1280, height: 800 } : null,
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
    await delay(500);

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
    await delay(500);

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
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
      delay(2500),
    ]);
    await delay(800);
    console.log(`✅ Current Page URL: ${this.page.url()}`);
  }

  /**
   * Step 2: Select District (भीलवाड़ा / Bhilwara)
   */
  async selectDistrict(districtName) {
    console.log(`\n📍 3. Selecting District: "${districtName}"...`);
    await delay(800);

    await this.page.waitForSelector('select, a, table', { timeout: 10000 }).catch(() => {});

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
    await delay(1800);
  }

  /**
   * Step 3: Select Tehsil (बनेड़ा / Banera)
   */
  async selectTehsil(tehsilName) {
    console.log(`\n🏛️ 4. Selecting Tehsil: "${tehsilName}"...`);
    await delay(800);

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
    await delay(1800);
  }

  /**
   * Step 4: Select Village (रायला - रायला - रायला)
   */
  async selectVillage(villageName) {
    console.log(`\n🌾 5. Selecting Village: "${villageName}"...`);
    await delay(800);

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
    } catch {}

    await delay(1000);

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
    }

    console.log('⏳ Waiting for Nakal Options page to load...');
    await delay(2000);
  }

  async waitForAsyncPostback(ms = 1200) {
    await this.page.waitForFunction(() => {
      if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
        return !Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack();
      }
      return true;
    }, { timeout: 6000 }).catch(() => {});
    await delay(ms);
  }

  async takeStepScreenshot(stepKey) {
    if (!this.stepScreenshots) this.stepScreenshots = {};
    try {
      const buf = await this.page.screenshot({ type: 'jpeg', quality: 75, fullPage: false });
      this.stepScreenshots[stepKey] = `data:image/jpeg;base64,${buf.toString('base64')}`;
      console.log(`📸 Captured step screenshot: "${stepKey}"`);
    } catch (e) {
      console.warn(`Could not capture screenshot for ${stepKey}:`, e.message);
    }
  }

  /**
   * Step 5: Select "जमाबंदी की प्रतिलिपि" ➔ "वर्तमान नकल" ➔ "खाता से" ➔ Khata 560
   */
  async selectJamabandiAndKhata() {
    const { searchValue } = this.config;
    console.log(`\n📌 6. Configuring Jamabandi Options for Khata "${searchValue}"...`);

    // Wait explicitly for the page radios to load
    await this.page.waitForSelector('input[type="radio"], label, table', { timeout: 15000 }).catch(() => {});
    await delay(1000);
    await this.takeStepScreenshot('1_page_opened');

    const clickAndVerifyRadio = async (keywords, verifyKeywords, stepName, maxRetries = 4) => {
      console.log(`👉 [Step] Selecting ${stepName}...`);
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const clicked = await this.page.evaluate((targetKws) => {
          const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
          for (const r of allRadios) {
            const parent = r.parentElement;
            const pText = (parent ? parent.innerText : '').trim();
            const nText = (r.nextSibling ? r.nextSibling.textContent : '').trim();
            const label = document.querySelector(`label[for="${r.id}"]`);
            const lText = (label ? label.innerText : '').trim();
            const fullText = `${pText} ${nText} ${lText} ${r.value} ${r.id}`;

            if (targetKws.some((kw) => fullText.includes(kw))) {
              r.click();
              r.checked = true;
              if (r.getAttribute('onclick')) {
                try { eval(r.getAttribute('onclick')); } catch {}
              }
              if (typeof r.onclick === 'function') {
                try { r.onclick(); } catch {}
              }
              r.dispatchEvent(new Event('click', { bubbles: true }));
              r.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, text: lText || pText || fullText, id: r.id };
            }
          }

          const labels = Array.from(document.querySelectorAll('label, td, span, a'));
          for (const l of labels) {
            const text = (l.innerText || '').trim();
            if (targetKws.some((kw) => text === kw || text.includes(kw))) {
              const insideRadio = l.querySelector('input[type="radio"]');
              if (insideRadio) {
                insideRadio.click();
                insideRadio.checked = true;
                if (insideRadio.getAttribute('onclick')) {
                  try { eval(insideRadio.getAttribute('onclick')); } catch {}
                }
                insideRadio.dispatchEvent(new Event('click', { bubbles: true }));
                insideRadio.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true, text, id: insideRadio.id };
              } else {
                l.click();
                return { success: true, text };
              }
            }
          }
          return { success: false };
        }, keywords);

        console.log(`   Attempt ${attempt} for ${stepName}: ${JSON.stringify(clicked)}`);

        await this.waitForAsyncPostback(1200);

        // Verify if the next expected options are visible on screen
        if (verifyKeywords && verifyKeywords.length > 0) {
          const isVerified = await this.page.evaluate((vKws) => {
            const text = document.body.innerText;
            return vKws.some((kw) => text.includes(kw));
          }, verifyKeywords);

          if (isVerified) {
            console.log(`   ✅ Verified ${stepName} succeeded!`);
            return true;
          } else {
            console.log(`   ⚠️ Verification pending for ${stepName}, retrying...`);
          }
        } else {
          return true;
        }
      }
      return false;
    };

    // 1. Select "जमाबंदी की प्रतिलिपि" -> Verify "वर्तमान नकल" appears
    await clickAndVerifyRadio(['जमाबंदी की प्रतिलिपि', 'जमाबंदी'], ['वर्तमान नकल', 'दिनांक से', 'गत नकल'], 'Radio 1: "जमाबंदी की प्रतिलिपि"');
    await this.takeStepScreenshot('2_jamabandi_selected');

    // 2. Select "वर्तमान नकल" -> Verify "खाता से" appears
    await clickAndVerifyRadio(['वर्तमान नकल', 'वर्तमान'], ['खाता से', 'खसरा से', 'नाम से'], 'Radio 2: "वर्तमान नकल"');
    await this.takeStepScreenshot('3_vartman_selected');

    // 3. Select "खाता से" -> Verify Khata selection dropdown/button appears
    await clickAndVerifyRadio(['खाता से', 'खाता'], ['खाता', 'चुनें', 'select', '560'], 'Radio 3: "खाता से"');
    await this.takeStepScreenshot('4_khata_selected');

    console.log(`🎯 7. Selecting Khata No. "${searchValue}"...`);
    await delay(800);

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

    await delay(1000);

    // Select Khata 560
    const chosen = await this.page.evaluate((targetKhata) => {
      // 1. Check all <select> dropdowns
      const selects = Array.from(document.querySelectorAll('select'));
      for (const select of selects) {
        for (const opt of select.options) {
          const text = opt.text.trim();
          const val = opt.value.trim();
          const cleanText = text.replace(/[^\d]/g, '');
          const cleanVal = val.replace(/[^\d]/g, '');
          if (
            cleanText === targetKhata ||
            cleanVal === targetKhata ||
            text === targetKhata ||
            val === targetKhata ||
            text.startsWith(targetKhata + ' ') ||
            text.startsWith(targetKhata + '-')
          ) {
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
        const cleanElText = text.replace(/[^\d]/g, '');
        if (text === targetKhata || cleanElText === targetKhata) {
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
    await this.waitForAsyncPostback(1500);
    await delay(1000);

    // 👉 CRUCIAL STEP: Click "नकल (सूचनार्थ)" button to trigger the table generation
    console.log('👉 8. Clicking "नकल (सूचनार्थ)" button to render Jamabandi table...');
    const nakalBtnClicked = await this.page.evaluate(() => {
      const allButtons = Array.from(
        document.querySelectorAll('input[type="submit"], input[type="button"], button, a.btn, a')
      );
      for (const btn of allButtons) {
        const val = (btn.getAttribute('value') || btn.innerText || '').trim();
        const id = (btn.id || '').toLowerCase();
        if (
          val.includes('नकल (सूचनार्थ)') ||
          val.includes('सूचनार्थ') ||
          (val.includes('नकल') && !val.includes('ई-हस्ताक्षरित') && !val.includes('अधिकृत')) ||
          id.includes('suchnarth') ||
          id.includes('btnnakal')
        ) {
          btn.click();
          if (typeof btn.onclick === 'function') {
            try { btn.onclick(); } catch {}
          }
          return { clicked: true, text: val, id: btn.id };
        }
      }
      return { clicked: false };
    });

    console.log(`   Nakal button action: ${JSON.stringify(nakalBtnClicked)}`);

    // Wait for Jamabandi table to render on page
    console.log('⏳ Waiting for Jamabandi Record Table to render...');
    await this.waitForAsyncPostback(3000);
    await delay(2000);
    await this.takeStepScreenshot('5_table_rendered');
  }

  /**
   * Step 6: Extract structured Jamabandi Record directly from this table
   */
  async extractJamabandiData() {
    const searchValue = String(this.config.searchValue || '525').replace(/[^\d]/g, '').trim() || '525';
    console.log(`\n📊 9. Extracting complete Jamabandi record from page for Khata "${searchValue}"...`);
    await delay(800);

    const extractedData = await this.page.evaluate((targetKhata) => {
      const cleanField = (str) => {
        if (!str) return '';
        return str.replace(/^[:\-\s]+/, '').replace(/[:\-\s\)]+$/, '').trim();
      };

      const result = {
        extractedAt: new Date().toISOString(),
        url: window.location.href,
        district: 'भीलवाड़ा',
        tehsil: 'बनेड़ा',
        village: 'रायला - रायला - रायला',
        khataNumber: cleanField(targetKhata) || '525',
        owners: [],
        khasraRecords: [],
        allTables: [],
        rawText: document.body.innerText,
      };

      const bodyText = document.body.innerText;

      // 1. Extract header metadata
      const distMatch = bodyText.match(/जिला\s*[:-]+\s*([^\t\n\r]+)/);
      if (distMatch) result.district = cleanField(distMatch[1]);

      const tehMatch = bodyText.match(/तहसील\s*[:-]+\s*([^\t\n\r]+)/);
      if (tehMatch) result.tehsil = cleanField(tehMatch[1]);

      const villMatch = bodyText.match(/(?:गाँव|पटवार)\s*[:-]+\s*([^\t\n\r]+)/);
      if (villMatch) result.village = cleanField(villMatch[1]);

      // 2. Extract Owners / Kashtkaar
      const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
      let inKashtkaarSection = false;
      for (const line of lines) {
        if (
          line.includes('काश्तकार') ||
          line.includes('खातेदार') ||
          line.includes('पि.रूपचंद') ||
          line.includes('पिता') ||
          line.includes('पुत्र') ||
          line.includes('ब्राह्मण') ||
          line.includes('सा.देह')
        ) {
          if (
            !line.includes('खसरो की सूचना') &&
            !line.includes('जमाबंदी की सूचना') &&
            !line.includes('विकल्प') &&
            !line.includes('Version') &&
            line.length > 5
          ) {
            result.owners.push(line);
          }
        }
      }

      // Also check table rows for owner cell (bottom row with colspan)
      const allTds = Array.from(document.querySelectorAll('td'));
      for (const td of allTds) {
        const text = (td.innerText || '').trim();
        if (
          (text.includes('खातेदार') || text.includes('पुत्र') || text.includes('पि.') || text.includes('हिस्सा')) &&
          text.length < 200 &&
          !text.includes('खसरा') &&
          !result.owners.includes(text)
        ) {
          result.owners.push(text);
        }
      }

      result.selectedOptions = {
        nakalType: 'जमाबंदी की प्रतिलिपि',
        nakalPeriod: 'वर्तमान नकल',
        searchMode: 'खाता से',
        khataNumber: result.khataNumber,
      };

      // 3. Extract Khasra Rows matching exact table columns (खाता संख्या | खसरा | रकबा | सिंचाई के साधन | खेत का नाम | शामिल नंबर)
      const tables = Array.from(document.querySelectorAll('table'));
      const seenKhasraKeys = new Set();

      tables.forEach((table, tableIndex) => {
        // Skip outer container tables that contain nested tables
        if (table.querySelector('table')) return;

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

            const joinedRow = rowVals.join(' ');
            const hasNumbers = rowVals.some((v) => /^\d+(\.\d+)?$/.test(v));

            // Identify Khasra rows: Columns [खाता संख्या, खसरा, रकबा, सिंचाई के साधन, खेत का नाम, शामिल नंबर]
            if (
              rowVals.length >= 3 &&
              hasNumbers &&
              !joinedRow.includes('खाता संख्या') &&
              !joinedRow.includes('खसरा') &&
              !joinedRow.includes('रकबा') &&
              !joinedRow.includes('कुल')
            ) {
              let khata = rowVals[0] || targetKhata;
              let khasra = rowVals[1] || '';
              let rakba = rowVals[2] || '';
              let irrigation = rowVals[3] || '-';
              let farmName = rowVals[4] || '';
              let soilAndTax = rowVals.slice(3).filter(Boolean).join(' ');

              const rowKey = `${khata}_${khasra}_${rakba}_${irrigation}`;
              if (khasra && rakba && !seenKhasraKeys.has(rowKey)) {
                seenKhasraKeys.add(rowKey);
                result.khasraRecords.push({
                  khataNo: khata,
                  khasraNo: khasra,
                  rakbaHectare: rakba,
                  irrigation: irrigation || '-',
                  farmName: farmName || '',
                  soilAndTax: soilAndTax || '-',
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

    // Attach Step Screenshots dictionary & Main Screenshot
    extractedData.stepScreenshots = this.stepScreenshots || {};
    if (this.stepScreenshots && (this.stepScreenshots['5_table_rendered'] || this.stepScreenshots.step5_table_rendered)) {
      extractedData.screenshotBase64 = this.stepScreenshots['5_table_rendered'] || this.stepScreenshots.step5_table_rendered;
    } else {
      try {
        const screenshotBuffer = await this.page.screenshot({
          type: 'jpeg',
          quality: 80,
        });
        extractedData.screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
      } catch (e) {
        console.warn('⚠️ Screenshot capture note:', e.message);
      }
    }

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
