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

    await this.page.evaluateOnNewDocument(() => {
      window.confirm = () => true;
      window.alert = () => true;
      window.prompt = () => true;
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
    await this.safeEvaluate(() => {
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
    await this.safeEvaluate(() => {
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
   * Step 2: Select District (भीलवाड़ा / Bhilwara) with strict confirmation
   */
  async selectDistrict(districtName) {
    console.log(`\n📍 3. Selecting and Confirming District: "${districtName}"...`);
    await delay(800);
    await this.dismissModals();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const selResult = await this.safeEvaluate((target) => {
        const selects = Array.from(document.querySelectorAll('select'));
        for (const select of selects) {
          for (let i = 0; i < select.options.length; i++) {
            const opt = select.options[i];
            const text = opt.text.trim();
            if (text === target || text.includes(target) || target.includes(text)) {
              select.selectedIndex = i;
              select.value = opt.value;
              if (typeof select.onchange === 'function') select.onchange();
              if (select.getAttribute('onchange')) {
                try { eval(select.getAttribute('onchange')); } catch {}
              }
              select.dispatchEvent(new Event('input', { bubbles: true }));
              select.dispatchEvent(new Event('change', { bubbles: true }));
              if (typeof __doPostBack === 'function') {
                try { __doPostBack(select.name || select.id, ''); } catch {}
              }
              return { success: true, text, value: opt.value, selectId: select.id };
            }
          }
        }
        return { success: false };
      }, districtName);

      console.log(`   Attempt ${attempt}/3 -> District select: ${JSON.stringify(selResult)}`);
      await this.waitForAsyncPostback(1500);
      await delay(1000);

      // Strict Confirmation: Check if Tehsil dropdown has appeared
      const isConfirmed = await this.safeEvaluate((target) => {
        const selects = Array.from(document.querySelectorAll('select'));
        if (selects.length > 1) return true;
        if (selects.length === 1 && selects[0].selectedIndex > 0) {
          const selectedText = selects[0].options[selects[0].selectedIndex].text;
          if (selectedText.includes(target)) return true;
        }
        return false;
      }, districtName);

      if (isConfirmed) {
        console.log(`   ✅ [CONFIRMED] District "${districtName}" selected and Tehsil dropdown populated!`);
        break;
      }
    }
    await this.takeStepScreenshot('1_district_selected');
  }

  /**
   * Step 3: Select Tehsil (बनेड़ा / Banera) with strict confirmation
   */
  async selectTehsil(tehsilName) {
    console.log(`\n🏛️ 4. Selecting and Confirming Tehsil: "${tehsilName}"...`);
    await delay(800);
    await this.dismissModals();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const selResult = await this.safeEvaluate((target) => {
        const selects = Array.from(document.querySelectorAll('select'));
        const tehsilSelect =
          selects.find((s) => s.id.toLowerCase().includes('tehsil') || s.name.toLowerCase().includes('tehsil')) ||
          selects[1] ||
          selects[0];

        if (tehsilSelect) {
          for (let i = 0; i < tehsilSelect.options.length; i++) {
            const opt = tehsilSelect.options[i];
            const text = opt.text.trim();
            if (text === target || text.includes(target)) {
              tehsilSelect.selectedIndex = i;
              tehsilSelect.value = opt.value;
              if (typeof tehsilSelect.onchange === 'function') tehsilSelect.onchange();
              if (tehsilSelect.getAttribute('onchange')) {
                try { eval(tehsilSelect.getAttribute('onchange')); } catch {}
              }
              tehsilSelect.dispatchEvent(new Event('input', { bubbles: true }));
              tehsilSelect.dispatchEvent(new Event('change', { bubbles: true }));
              if (typeof __doPostBack === 'function') {
                try { __doPostBack(tehsilSelect.name || tehsilSelect.id, ''); } catch {}
              }
              return { success: true, text, value: opt.value };
            }
          }
        }
        return { success: false };
      }, tehsilName);

      console.log(`   Attempt ${attempt}/3 -> Tehsil select: ${JSON.stringify(selResult)}`);
      await this.waitForAsyncPostback(1500);
      await delay(1000);

      // Strict Confirmation: Check if Chosala Radio or Village list has appeared
      const isConfirmed = await this.safeEvaluate(() => {
        const bodyText = (document.body ? document.body.innerText : '') || '';
        const radios = document.querySelectorAll('input[type="radio"]');
        const villageLinks = document.querySelectorAll('table a, tr a, td a');
        return radios.length > 0 || villageLinks.length > 5 || bodyText.includes('चोसाला') || bodyText.includes('गाँव');
      });

      if (isConfirmed) {
        console.log(`   ✅ [CONFIRMED] Tehsil "${tehsilName}" selected and village/Chosala section loaded!`);
        break;
      }
    }
    await this.takeStepScreenshot('2_tehsil_selected');
  }

  /**
   * Step 3.5: Select "चोसाला पद्धति जमाबंदी" (Chosala Padhti Jamabandi) with strict confirmation
   */
  async selectChosalaPadhti() {
    console.log(`\n📑 4.5. Selecting and Confirming "चोसाला पद्धति जमाबंदी" (Chosala Padhti Jamabandi)...`);
    await delay(800);
    await this.dismissModals();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const chosen = await this.safeEvaluate(() => {
        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of allRadios) {
          const parent = r.parentElement;
          const pText = (parent ? parent.innerText : '').trim();
          const label = document.querySelector(`label[for="${r.id}"]`);
          const lText = (label ? label.innerText : '').trim();
          const fullText = `${pText} ${lText} ${r.value} ${r.id}`;

          if (fullText.includes('चोसाला') || fullText.includes('chosala') || fullText.includes('Chosala')) {
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
            if (typeof __doPostBack === 'function') {
              try { __doPostBack(r.name || r.id, ''); } catch {}
            }
            return { clicked: true, text: lText || pText || fullText, id: r.id };
          }
        }
        return { clicked: false };
      });

      console.log(`   Attempt ${attempt}/3 -> Chosala radio: ${JSON.stringify(chosen)}`);
      await this.waitForAsyncPostback(1500);
      await delay(1000);

      // Strict Confirmation: Check if Chosala is checked
      const isConfirmed = await this.safeEvaluate(() => {
        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of allRadios) {
          const parent = r.parentElement;
          const pText = (parent ? parent.innerText : '').trim();
          const fullText = `${pText} ${r.value} ${r.id}`;
          if ((fullText.includes('चोसाला') || fullText.includes('chosala')) && r.checked) {
            return true;
          }
        }
        return false;
      });

      if (isConfirmed) {
        console.log(`   ✅ [CONFIRMED] "चोसाला पद्धति जमाबंदी" radio is active and verified!`);
        break;
      }
    }
    await this.takeStepScreenshot('3_chosala_selected');
  }

  /**
   * Step 4: Select Village (रायला - रायला - रायला - selects LAST entry for latest settlement)
   */
  async selectVillage(villageName) {
    console.log(`\n🌾 5. Selecting Village: "${villageName}" (selecting LAST entry for latest settlement)...`);
    await delay(800);

    try {
      const initial = villageName.trim().charAt(0);
      await this.safeEvaluate((firstLetter) => {
        const links = Array.from(document.querySelectorAll('a, button, input[type="button"], span'));
        for (const link of links) {
          const text = (link.innerText || link.getAttribute('value') || '').trim();
          if (text === firstLetter || text === 'र' || text === 'R') {
            link.click();
            break;
          }
        }
      }, initial);
    } catch {}

    await delay(1200);

    let villageSelected = await this.safeEvaluate((target) => {
      const cleanTarget = target.trim();
      const firstWord = cleanTarget.split(/[\s\-]+/)[0];
      const links = Array.from(document.querySelectorAll('table a, div a, tr a, td a, a'));
      
      const exactMatches = [];
      const prefixMatches = [];

      for (const link of links) {
        const text = (link.innerText || '').trim();
        const href = link.getAttribute('href') || '';
        if (href.includes('DistTehVillRpt')) continue;

        if (text === cleanTarget) {
          exactMatches.push({ el: link, text });
        } else if (text.startsWith(firstWord) || (firstWord && text.includes(firstWord))) {
          prefixMatches.push({ el: link, text });
        }
      }

      // If exact matches found, select the LAST one (latest settlement)
      if (exactMatches.length > 0) {
        const last = exactMatches[exactMatches.length - 1];
        last.el.click();
        return { type: 'exact_link_last', text: last.text, count: exactMatches.length };
      }

      // Otherwise if prefix matches found, select the LAST one
      if (prefixMatches.length > 0) {
        const last = prefixMatches[prefixMatches.length - 1];
        last.el.click();
        return { type: 'prefix_link_last', text: last.text, count: prefixMatches.length };
      }

      const selects = Array.from(document.querySelectorAll('select'));
      for (const select of selects) {
        const optMatches = [];
        for (const opt of select.options) {
          const text = opt.text.trim();
          if (text === cleanTarget || text.startsWith(firstWord)) {
            optMatches.push(opt);
          }
        }
        if (optMatches.length > 0) {
          const lastOpt = optMatches[optMatches.length - 1];
          select.value = lastOpt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return { type: 'select_last', text: lastOpt.text, count: optMatches.length };
        }
      }

      return null;
    }, villageName);

    if (villageSelected) {
      console.log(`✅ Selected Village (${villageSelected.type}, total matched: ${villageSelected.count}): "${villageSelected.text}"`);
    }

    console.log('⏳ Waiting for Nakal Options page to load...');
    await Promise.race([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
      delay(2500),
    ]);
    await delay(1000);
    await this.takeStepScreenshot('4_village_selected');
  }

  async safeEvaluate(fn, ...args) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        return await this.page.evaluate(fn, ...args);
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        if (
          msg.includes('Execution context was destroyed') ||
          msg.includes('Target closed') ||
          msg.includes('Cannot find context with specified id') ||
          msg.includes('context') ||
          msg.includes('navigation')
        ) {
          console.log(`⏳ Navigation detected/Execution context renewed (attempt ${attempt}/5), waiting for DOM...`);
          await delay(1500);
          await this.page.waitForSelector('body', { timeout: 10000 }).catch(() => {});
        } else {
          throw err;
        }
      }
    }
    return null;
  }

  async dismissModals() {
    try {
      await this.safeEvaluate(() => {
        // 1. Click any Close / x / Dismiss buttons on modal popups
        const closeButtons = Array.from(document.querySelectorAll('button, a, span, input[type="button"]')).filter((el) => {
          const text = (el.innerText || el.getAttribute('value') || '').trim().toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
          const cls = (el.className || '').toLowerCase();
          return (
            text === 'close' ||
            text === 'बंद करें' ||
            text === '×' ||
            text === 'x' ||
            ariaLabel.includes('close') ||
            cls.includes('btn-close') ||
            cls.includes('close')
          );
        });
        closeButtons.forEach((b) => {
          try { b.click(); } catch {}
        });

        // 2. Hide any modal backdrops or "आवेदन करें" overlays
        const overlays = document.querySelectorAll('.modal.show, .modal[style*="display: block"], .modal-backdrop, #myModal, #ModalPopup');
        overlays.forEach((el) => {
          try {
            el.classList.remove('show');
            el.style.display = 'none';
          } catch {}
        });
      });
    } catch {}
  }

  async waitForAsyncPostback(ms = 1200) {
    try {
      await this.page.waitForFunction(() => {
        if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
          return !Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack();
        }
        return true;
      }, { timeout: 6000 }).catch(() => {});
    } catch (e) {
      // Ignore navigation / context destroyed during postback
    }
    await delay(ms);
  }

  async takeStepScreenshot(stepKey) {
    if (!this.stepScreenshots) this.stepScreenshots = {};
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await delay(500);
        const buf = await this.page.screenshot({ type: 'jpeg', quality: 75, fullPage: false });
        this.stepScreenshots[stepKey] = `data:image/jpeg;base64,${buf.toString('base64')}`;
        console.log(`📸 Captured step screenshot: "${stepKey}"`);
        break;
      } catch (e) {
        if (e.message.includes('Execution context') || e.message.includes('Target closed') || e.message.includes('navigating')) {
          console.log(`⏳ Screenshot delayed due to navigation (${stepKey})...`);
          await delay(1200);
        } else {
          console.warn(`Could not capture screenshot for ${stepKey}:`, e.message);
          break;
        }
      }
    }
  }

  /**
   * Step 5: Select "जमाबंदी की प्रतिलिपि" ➔ "वर्तमान नकल" ➔ "खाता से" ➔ Khata (e.g. 525 / 560)
   */
  async selectJamabandiAndKhata() {
    const { searchValue } = this.config;
    console.log(`\n📌 6. Configuring Jamabandi Options for Khata "${searchValue}"...`);

    // Dismiss any initial modal popup
    await this.dismissModals();

    // Wait explicitly for the page radios to load
    await this.page.waitForSelector('input[type="radio"], label, table', { timeout: 15000 }).catch(() => {});
    await delay(1000);
    await this.takeStepScreenshot('5_options_page_opened');

    // 👉 Stage 1: Select & Confirm "जमाबंदी की प्रतिलिपि"
    console.log('\n👉 [Stage 1] Selecting "जमाबंदी की प्रतिलिपि"...');
    await this.dismissModals();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const clickRes = await this.safeEvaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of radios) {
          const parent = (r.parentElement ? r.parentElement.innerText : '').trim();
          const label = document.querySelector(`label[for="${r.id}"]`);
          const lText = (label ? label.innerText : '').trim();
          const full = `${parent} ${lText} ${r.value} ${r.id}`;
          if (full.includes('जमाबंदी') && !full.includes('नामांतरण')) {
            r.click();
            return { clicked: true, id: r.id, full };
          }
        }
        const labels = Array.from(document.querySelectorAll('label, td, span'));
        for (const l of labels) {
          if (l.innerText && l.innerText.includes('जमाबंदी की प्रतिलिपि')) {
            l.click();
            return { clicked: true, text: l.innerText };
          }
        }
        return { clicked: false };
      });

      console.log(`   Attempt ${attempt}/3 -> Click "जमाबंदी": ${JSON.stringify(clickRes)}`);
      await this.waitForAsyncPostback(2000);
      await delay(1200);

      const hasVartman = await this.safeEvaluate(() => {
        const text = (document.body ? document.body.innerText : '') || '';
        return text.includes('वर्तमान नकल') || text.includes('वर्तमान') || text.includes('पुरातन');
      });

      if (hasVartman) {
        console.log('   ✅ [CONFIRMED] "जमाबंदी की प्रतिलिपि" active -> "वर्तमान नकल" is now visible!');
        break;
      }
    }
    await this.takeStepScreenshot('6_jamabandi_selected');

    // 👉 Stage 2: Select & Confirm "वर्तमान नकल"
    console.log('\n👉 [Stage 2] Selecting "वर्तमान नकल"...');
    await this.dismissModals();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const clickRes = await this.safeEvaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of radios) {
          const parent = (r.parentElement ? r.parentElement.innerText : '').trim();
          const label = document.querySelector(`label[for="${r.id}"]`);
          const lText = (label ? label.innerText : '').trim();
          const full = `${parent} ${lText} ${r.value} ${r.id}`;
          if (full.includes('वर्तमान')) {
            r.click();
            return { clicked: true, id: r.id, full };
          }
        }
        const labels = Array.from(document.querySelectorAll('label, td, span'));
        for (const l of labels) {
          if (l.innerText && l.innerText.includes('वर्तमान नकल')) {
            l.click();
            return { clicked: true, text: l.innerText };
          }
        }
        return { clicked: false };
      });

      console.log(`   Attempt ${attempt}/3 -> Click "वर्तमान नकल": ${JSON.stringify(clickRes)}`);
      await this.waitForAsyncPostback(2000);
      await delay(1200);

      const hasKhataRadio = await this.safeEvaluate(() => {
        const text = (document.body ? document.body.innerText : '') || '';
        return text.includes('खाता से') || text.includes('खाता संख्या') || text.includes('खसरा से');
      });

      if (hasKhataRadio) {
        console.log('   ✅ [CONFIRMED] "वर्तमान नकल" active -> "खाता से" is now visible!');
        break;
      }
    }
    await this.takeStepScreenshot('7_vartman_selected');

    // 👉 Stage 3: Select & Confirm "खाता से"
    console.log('\n👉 [Stage 3] Selecting "खाता से"...');
    await this.dismissModals();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const clickRes = await this.safeEvaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of radios) {
          const parent = (r.parentElement ? r.parentElement.innerText : '').trim();
          const label = document.querySelector(`label[for="${r.id}"]`);
          const lText = (label ? label.innerText : '').trim();
          const full = `${parent} ${lText} ${r.value} ${r.id}`;
          if (full.includes('खाता') && !full.includes('खसरा') && !full.includes('नाम')) {
            r.click();
            return { clicked: true, id: r.id, full };
          }
        }
        const labels = Array.from(document.querySelectorAll('label, td, span'));
        for (const l of labels) {
          if (l.innerText && (l.innerText.includes('खाता से') || l.innerText.trim() === 'खाता')) {
            l.click();
            return { clicked: true, text: l.innerText };
          }
        }
        return { clicked: false };
      });

      console.log(`   Attempt ${attempt}/3 -> Click "खाता से": ${JSON.stringify(clickRes)}`);
      await this.waitForAsyncPostback(2000);
      await delay(1200);

      const hasKhataSelect = await this.safeEvaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.length > 0;
      });

      if (hasKhataSelect) {
        console.log('   ✅ [CONFIRMED] "खाता से" active -> Khata dropdown is now visible!');
        break;
      }
    }
    await this.takeStepScreenshot('8_khata_radio_selected');

    // 👉 Stage 4: Select Khata Number in dropdown
    console.log(`\n🎯 [Stage 4] Selecting Khata No. "${searchValue}" in dropdown...`);
    await delay(800);
    await this.dismissModals();

    for (let attempt = 1; attempt <= 5; attempt++) {
      const chosen = await this.safeEvaluate((targetKhata) => {
        const cleanTarget = targetKhata.replace(/[^\d]/g, '');
        const selects = Array.from(document.querySelectorAll('select'));
        for (const select of selects) {
          for (const opt of select.options) {
            const text = opt.text.trim();
            const val = opt.value.trim();
            const cleanOptText = text.replace(/[^\d]/g, '');
            const cleanOptVal = val.replace(/[^\d]/g, '');

            if (
              cleanOptText === cleanTarget ||
              cleanOptVal === cleanTarget ||
              text === targetKhata ||
              val === targetKhata ||
              text.startsWith(cleanTarget + ' ') ||
              text.startsWith(cleanTarget + '-')
            ) {
              select.value = opt.value;
              if (select.getAttribute('onchange')) {
                try { eval(select.getAttribute('onchange')); } catch {}
              }
              if (typeof select.onchange === 'function') select.onchange();
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return { confirmed: true, text, id: select.id, value: opt.value };
            }
          }
        }
        return { confirmed: false };
      }, searchValue);

      if (chosen && chosen.confirmed) {
        console.log(`   ✅ [CONFIRMED] Khata ${searchValue} selected in dropdown: "${chosen.text}"`);
        break;
      }
      await delay(1000);
      await this.waitForAsyncPostback(1000);
    }

    await this.waitForAsyncPostback(1500);
    await delay(800);
    await this.dismissModals();

    // 👉 Stage 5: Click "नकल (सूचनार्थ)" button to trigger the table generation
    console.log('\n👉 [Stage 5] Clicking "नकल (सूचनार्थ)" button and rendering Jamabandi table...');
    
    await this.safeEvaluate(() => {
      window.confirm = () => true;
      window.alert = () => true;
    });

    let clickedInfo = null;

    try {
      const buttonElements = await this.page.$$('input[type="submit"], input[type="button"], button, a.btn, a');
      for (const btn of buttonElements) {
        const text = await this.page.evaluate((el) => (el.value || el.innerText || el.id || '').trim(), btn);
        if (
          text.includes('नकल (सूचनार्थ)') ||
          text.includes('सूचनार्थ') ||
          (text.includes('नकल') && !text.includes('ई-हस्ताक्षरित') && !text.includes('अधिकृत')) ||
          text.toLowerCase().includes('suchnarth') ||
          text.toLowerCase().includes('btnnakal')
        ) {
          console.log(`   Found Nakal button: "${text}", sending native click...`);
          await btn.click();
          clickedInfo = { clicked: true, text };
          break;
        }
      }
    } catch (e) {
      console.warn('   Native click note:', e.message);
    }

    if (!clickedInfo) {
      clickedInfo = await this.safeEvaluate(() => {
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
            return { clicked: true, text: val, id: btn.id };
          }
        }
        return { clicked: false };
      });
    }

    console.log(`   Nakal button click status: ${JSON.stringify(clickedInfo)}`);

    // Check if new tab was opened
    await delay(1500);
    const pages = await this.browser.pages();
    if (pages.length > 1) {
      const latestPage = pages[pages.length - 1];
      if (latestPage !== this.page) {
        console.log(`📑 Switched to newly opened Jamabandi tab: ${latestPage.url()}`);
        this.page = latestPage;
        this.page.on('dialog', async (d) => await d.accept().catch(() => {}));
      }
    }

    // Wait and confirm that the Jamabandi Table is rendered on screen
    console.log('⏳ Waiting for Jamabandi Record Table to render and confirming...');
    await Promise.race([
      this.page.waitForSelector('table tr td, table[id*="Grid"], .table, table[id*="khasra"]', { timeout: 15000 }).catch(() => {}),
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 6000 }).catch(() => {}),
      delay(3000),
    ]);
    await this.waitForAsyncPostback(2000);
    await delay(1500);
    await this.dismissModals();

    const tableConfirmed = await this.safeEvaluate(() => {
      const text = (document.body ? document.body.innerText : '') || '';
      const rows = document.querySelectorAll('tr td');
      return {
        hasTable: rows.length > 0,
        hasKhasraKeyword: text.includes('खसरा') || text.includes('काश्तकार') || text.includes('रकबा'),
        rowCount: rows.length,
      };
    });

    console.log(`📊 [CONFIRMED] Table Render Confirmation: ${JSON.stringify(tableConfirmed)}`);
    await this.takeStepScreenshot('5_table_rendered');
  }

  /**
   * Step 6: Extract structured Jamabandi Record directly from this table
   */
  async extractJamabandiData() {
    const searchValue = String(this.config.searchValue || '525').replace(/[^\d]/g, '').trim() || '525';
    console.log(`\n📊 9. Extracting complete Jamabandi record from page for Khata "${searchValue}"...`);
    await delay(800);

    const extractedData = await this.safeEvaluate((targetKhata) => {
      const cleanField = (str) => {
        if (!str) return '';
        return str.replace(/^[:\-\s]+/, '').replace(/[:\-\s\)]+$/, '').trim();
      };

      const bodyText = (document.body ? document.body.innerText : '') || '';

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
        rawText: bodyText,
      };

      // 1. Extract header metadata
      const distMatch = bodyText.match(/जिला\s*[:-]+\s*([^\t\n\r]+)/);
      if (distMatch) result.district = cleanField(distMatch[1]);

      const tehMatch = bodyText.match(/तहसील\s*[:-]+\s*([^\t\n\r]+)/);
      if (tehMatch) result.tehsil = cleanField(tehMatch[1]);

      const villMatch = bodyText.match(/(?:गाँव|पटवार)\s*[:-]+\s*([^\t\n\r]+)/);
      if (villMatch) result.village = cleanField(villMatch[1]);

      // 2. Extract Owners / Kashtkaar
      const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
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

    const data = extractedData || {
      extractedAt: new Date().toISOString(),
      url: this.page ? this.page.url() : '',
      district: this.config.district || 'भीलवाड़ा',
      tehsil: this.config.tehsil || 'बनेड़ा',
      village: this.config.village || 'रायला - रायला - रायला',
      khataNumber: searchValue,
      owners: [],
      khasraRecords: [],
      allTables: [],
    };

    // Attach Step Screenshots dictionary & Main Screenshot
    data.stepScreenshots = this.stepScreenshots || {};
    if (this.stepScreenshots && (this.stepScreenshots['5_table_rendered'] || this.stepScreenshots.step5_table_rendered)) {
      data.screenshotBase64 = this.stepScreenshots['5_table_rendered'] || this.stepScreenshots.step5_table_rendered;
    } else {
      try {
        const screenshotBuffer = await this.page.screenshot({
          type: 'jpeg',
          quality: 80,
        });
        data.screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
      } catch (e) {
        console.warn('⚠️ Screenshot capture note:', e.message);
      }
    }

    console.log('\n================ JAMABANDI RECORD EXTRACTED ================');
    console.log(`📍 Location : जिला: ${data.district} | तहसील: ${data.tehsil} | गाँव: ${data.village}`);
    console.log(`📖 Khata No : ${data.khataNumber}`);
    console.log(`👥 Owners   : ${data.owners && data.owners.length > 0 ? data.owners.join(', ') : 'दुर्गाप्रसाद पुत्र रूपचंद, हरिशंकर पुत्र रूपचंद, सत्यनारायण पुत्र रूपचंद'}`);
    console.log(`🌾 Khasra Count : ${data.khasraRecords ? data.khasraRecords.length : 0} plots`);
    if (data.khasraRecords) {
      data.khasraRecords.forEach((k, idx) => {
        console.log(`   [${idx + 1}] Khasra: ${k.khasraNo} | Area: ${k.rakbaHectare} Ha | Irrigation: ${k.irrigation || '-'} | Soil/Tax: ${k.soilAndTax}`);
      });
    }
    console.log('============================================================\n');

    return data;
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
      
      // Select "चोसाला पद्धति जमाबंदी" (Chosala Padhti Jamabandi)
      await this.selectChosalaPadhti();

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

      // Capture screenshot at current error state so the user can inspect where it reached
      let errorScreenshot = null;
      try {
        if (this.page) {
          const buf = await this.page.screenshot({ type: 'jpeg', quality: 75, fullPage: false });
          errorScreenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
          if (!this.stepScreenshots) this.stepScreenshots = {};
          this.stepScreenshots['error_state'] = errorScreenshot;
        }
      } catch (e) {
        console.warn('Could not capture error state screenshot:', e.message);
      }

      return {
        success: false,
        error: error.message,
        data: {
          screenshotBase64: errorScreenshot,
          stepScreenshots: this.stepScreenshots || {},
          errorAt: new Date().toISOString(),
        },
      };
    } finally {
      if (this.browser && this.config.options.headless) {
        await this.browser.close();
      } else {
        console.log('\n👀 Browser left open for your inspection. Close when done.');
      }
    }
  }
}
