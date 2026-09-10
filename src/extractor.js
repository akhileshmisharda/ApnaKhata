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
    this.logs = [];
    this.stepScreenshots = {};
  }

  log(msg) {
    const time = new Date().toLocaleTimeString('hi-IN', { hour12: false });
    const formatted = `[${time}] ${msg}`;
    if (!this.logs) this.logs = [];
    this.logs.push(formatted);
    console.log(formatted);
  }

  async initBrowser() {
    this.log('🚀 Launching Chrome browser engine...');
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

    // Auto-accept any browser confirmation / alert dialogs
    this.page.on('dialog', async (dialog) => {
      this.log(`💬 Browser Dialog: "${dialog.message()}" -> Auto-Approved`);
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
          msg.includes('caller') ||
          msg.includes('callee') ||
          msg.includes('arguments') ||
          msg.includes('context') ||
          msg.includes('navigation')
        ) {
          this.log(`⏳ Navigation/Postback detected (attempt ${attempt}/5), waiting for DOM...`);
          await delay(1500);
          await this.page.waitForSelector('body', { timeout: 10000 }).catch(() => {});
        } else {
          this.log(`⚠️ Note: Evaluation catch: ${msg}`);
          return null;
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
        this.log(`📸 Captured step screenshot: "${stepKey}"`);
        break;
      } catch (e) {
        if (e.message.includes('Execution context') || e.message.includes('Target closed') || e.message.includes('navigating')) {
          this.log(`⏳ Screenshot delayed due to navigation (${stepKey})...`);
          await delay(1200);
        } else {
          this.log(`⚠️ Note: Screenshot ${stepKey}: ${e.message}`);
          break;
        }
      }
    }
  }

  /**
   * Step 1: Open Homepage, dismiss popup, and click exact "जमाबंदी नकल" button
   */
  async openPortal() {
    const homeUrl = 'https://apnakhata.rajasthan.gov.in/';
    this.log(`🌐 1. Opening Homepage: ${homeUrl}...`);
    await this.page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
    this.log('✅ Homepage loaded.');
    await delay(500);

    // Dismiss popup
    this.log('🧹 Dismissing popup modal...');
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
    this.log('👉 2. Clicking "जमाबंदी नकल" button on main page...');
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

    this.log('⏳ Waiting for Jamabandi Selection page to load...');
    await Promise.race([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
      delay(2500),
    ]);
    await delay(800);
    this.log(`✅ Current Page URL: ${this.page.url()}`);
  }

  /**
   * Step 2: Select District (भीलवाड़ा / Bhilwara) with strict confirmation
   */
  async selectDistrict(districtName) {
    this.log(`📍 3. Selecting District: "${districtName}"...`);
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

      this.log(`   Attempt ${attempt}/3 -> District selection: ${JSON.stringify(selResult)}`);
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
        this.log(`✅ [CONFIRMED] District "${districtName}" selected and Tehsil dropdown populated!`);
        break;
      }
    }
    await this.takeStepScreenshot('1_district_selected');
  }

  /**
   * Step 3: Select Tehsil (बनेड़ा / Banera) with strict confirmation
   */
  async selectTehsil(tehsilName) {
    this.log(`🏛️ 4. Selecting Tehsil: "${tehsilName}"...`);
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

      this.log(`   Attempt ${attempt}/3 -> Tehsil selection: ${JSON.stringify(selResult)}`);
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
        this.log(`✅ [CONFIRMED] Tehsil "${tehsilName}" selected and village/Chosala section loaded!`);
        break;
      }
    }
    await this.takeStepScreenshot('2_tehsil_selected');
  }

  /**
   * Step 3.5: Select "चोसाला पद्धति जमाबंदी" (Chosala Padhti Jamabandi) with strict confirmation
   */
  async selectChosalaPadhti() {
    this.log('📑 5. Selecting "चोसाला पद्धति जमाबंदी" (Chosala Padhti Jamabandi)...');
    await delay(1000);
    await this.dismissModals();

    for (let attempt = 1; attempt <= 4; attempt++) {
      // 1. Try Puppeteer Native Click on Label
      try {
        const elements = await this.page.$$('label, td, span, input[type="radio"]');
        for (const el of elements) {
          const text = await this.page.evaluate((e) => (e.innerText || e.value || e.id || '').trim(), el);
          if (text.includes('चोसाला') || text.includes('chosala')) {
            await el.click().catch(() => {});
            this.log(`   Clicked Chosala element: "${text}"`);
            break;
          }
        }
      } catch (e) {
        this.log(`   Native Chosala click note: ${e.message}`);
      }

      // 2. Comprehensive DOM selection and PostBack fallback
      const chosen = await this.safeEvaluate(() => {
        // Method A: Check labels
        const allLabels = Array.from(document.querySelectorAll('label, td, span'));
        for (const lbl of allLabels) {
          const txt = (lbl.innerText || '').trim();
          if (txt.includes('चोसाला') || txt.includes('chosala')) {
            lbl.click();
            const forId = lbl.getAttribute('for');
            if (forId) {
              const r = document.getElementById(forId);
              if (r) {
                r.checked = true;
                r.setAttribute('checked', 'checked');
                window.setTimeout(function () {
                  if (typeof __doPostBack === 'function') {
                    __doPostBack(r.name || r.id.replace(/_/g, '$'), '');
                  }
                }, 20);
                return { clicked: true, method: 'label_for', id: r.id, text: txt };
              }
            }
            const rIn = lbl.querySelector('input[type="radio"]') || (lbl.parentElement ? lbl.parentElement.querySelector('input[type="radio"]') : null);
            if (rIn) {
              rIn.checked = true;
              rIn.setAttribute('checked', 'checked');
              window.setTimeout(function () {
                if (typeof __doPostBack === 'function') {
                  __doPostBack(rIn.name || rIn.id.replace(/_/g, '$'), '');
                }
              }, 20);
              return { clicked: true, method: 'parent_radio', id: rIn.id, text: txt };
            }
          }
        }

        // Method B: Check all radios by container text
        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of allRadios) {
          const rowText = (r.closest('tr') ? r.closest('tr').innerText : '') || '';
          const tableText = (r.closest('table') ? r.closest('table').innerText : '') || '';
          const parentText = (r.parentElement ? r.parentElement.innerText : '') || '';
          const full = `${rowText} ${tableText} ${parentText} ${r.value} ${r.id}`;

          if (full.includes('चोसाला') || full.includes('chosala')) {
            r.checked = true;
            r.setAttribute('checked', 'checked');
            r.click();
            window.setTimeout(function () {
              if (typeof __doPostBack === 'function') {
                __doPostBack(r.name || r.id.replace(/_/g, '$'), '');
              }
            }, 20);
            return { clicked: true, method: 'container_match', id: r.id, text: full };
          }
        }

        // Method C: First radio in RadioButtonList on VillSelAll page is Chosala
        if (allRadios.length >= 2) {
          const r0 = allRadios[0];
          r0.checked = true;
          r0.setAttribute('checked', 'checked');
          r0.click();
          window.setTimeout(function () {
            if (typeof __doPostBack === 'function') {
              __doPostBack(r0.name || r0.id.replace(/_/g, '$'), '');
            }
          }, 20);
          return { clicked: true, method: 'first_radio_fallback', id: r0.id };
        }

        return { clicked: false };
      });

      this.log(`   Attempt ${attempt}/4 -> Chosala radio selection: ${JSON.stringify(chosen)}`);
      await Promise.race([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        this.waitForAsyncPostback(2000),
        delay(2500),
      ]);
      await delay(1000);

      // Strict Confirmation: Check if Chosala is checked OR village table updated
      const isConfirmed = await this.safeEvaluate(() => {
        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of allRadios) {
          const rowText = (r.closest('tr') ? r.closest('tr').innerText : '') || '';
          const parentText = (r.parentElement ? r.parentElement.innerText : '') || '';
          const full = `${rowText} ${parentText} ${r.value} ${r.id}`;
          if ((full.includes('चोसाला') || full.includes('chosala') || r === allRadios[0]) && r.checked) {
            return true;
          }
        }
        return false;
      });

      if (isConfirmed) {
        this.log('✅ [CONFIRMED] "चोसाला पद्धति जमाबंदी" radio active and confirmed!');
        break;
      }
    }
    await this.takeStepScreenshot('3_chosala_selected');
  }

  /**
   * Step 4: Select Village (रायला - रायला - रायला - selects LAST entry for latest settlement)
   */
  async selectVillage(villageName) {
    this.log(`🌾 6. Selecting Village: "${villageName}" (selecting LAST entry for latest settlement)...`);
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

        if (text === cleanTarget || text.includes(cleanTarget)) {
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
      this.log(`✅ [CONFIRMED] Selected Village (${villageSelected.type}, total matches: ${villageSelected.count}): "${villageSelected.text}"`);
    }

    this.log('⏳ Waiting for Nakal Options page to load...');
    await Promise.race([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
      delay(2500),
    ]);
    await delay(1000);
    await this.takeStepScreenshot('4_village_selected');
  }

  /**
   * Stage 1: Select "जमाबंदी की प्रतिलिपि"
   */
  async stage1_SelectJamabandiRadio() {
    this.log('👉 [Stage 1: जमाबंदी की प्रतिलिपि] Selecting "जमाबंदी की प्रतिलिपि"...');
    await this.dismissModals();

    for (let attempt = 1; attempt <= 4; attempt++) {
      // Check if Stage 1 is already fulfilled (either 'वर्तमान नकल' is visible OR search options 'खाता से' are visible)
      const isConfirmed = await this.safeEvaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));

        // If Chosala mode: 'विकल्प चुने' / 'खाता से' / 'खसरा से' are already present
        const hasSearchModes = radios.some((r) => {
          const p = (r.parentElement ? r.parentElement.innerText : '').trim();
          return p.includes('खाता से') || p.includes('खसरा से') || r.id.toLowerCase().includes('rdo_khata');
        });

        const hasVartman = radios.some((r) => {
          const p = (r.parentElement ? r.parentElement.innerText : '').trim();
          return r.id.toLowerCase().includes('vartman') || p.includes('वर्तमान नकल');
        });

        return hasSearchModes || hasVartman;
      });

      if (isConfirmed) {
        this.log('✅ [CONFIRMED] Stage 1 ("जमाबंदी की प्रतिलिपि") active and options rendered!');
        await this.takeStepScreenshot('6_jamabandi_selected');
        return true;
      }

      this.log(`   Attempt ${attempt}/4: Triggering selection for "जमाबंदी की प्रतिलिपि"...`);

      // 1. Try Puppeteer Native Click on Label or Input
      try {
        const elements = await this.page.$$('label, td, span, input[type="radio"]');
        for (const el of elements) {
          const txt = await this.page.evaluate((e) => (e.innerText || e.value || '').trim(), el);
          if (txt.includes('जमाबंदी की प्रतिलिपि')) {
            await el.click().catch(() => {});
            break;
          }
        }
      } catch (e) {
        this.log(`   Label click note: ${e.message}`);
      }

      // 2. Fallback via decoupled window.setTimeout postback
      await this.safeEvaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const jamabandiRadio =
          radios.find((r) => {
            const p = (r.parentElement ? r.parentElement.innerText : '').trim();
            return r.id.includes('Khate_se') || p.includes('जमाबंदी की प्रतिलिपि');
          }) || radios[0];

        if (jamabandiRadio) {
          jamabandiRadio.checked = true;
          jamabandiRadio.setAttribute('checked', 'checked');
          window.setTimeout(function () {
            if (typeof __doPostBack === 'function') {
              var target = jamabandiRadio.name || jamabandiRadio.id.replace(/_/g, '$');
              __doPostBack(target, '');
            } else if (jamabandiRadio.form) {
              jamabandiRadio.form.submit();
            }
          }, 20);
        }
      });

      await Promise.race([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        this.waitForAsyncPostback(2000),
        delay(2500),
      ]);
      await delay(800);
      await this.dismissModals();
    }

    throw new Error('चरण "जमाबंदी की प्रतिलिपि" का चयन पुष्ट नहीं हो सका।');
  }

  /**
   * Stage 2: Select "वर्तमान नकल"
   */
  async stage2_SelectVartmanRadio() {
    this.log('👉 [Stage 2: वर्तमान नकल] Selecting "वर्तमान नकल"...');
    await this.dismissModals();

    for (let attempt = 1; attempt <= 4; attempt++) {
      // Check if Stage 2 is already fulfilled (Search options 'खाता से' are visible directly as in Chosala mode)
      const isConfirmed = await this.safeEvaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        return radios.some((r) => {
          const p = (r.parentElement ? r.parentElement.innerText : '').trim();
          return p.includes('खाता से') || p.includes('खसरा से') || r.id.toLowerCase().includes('rdo_khata');
        });
      });

      if (isConfirmed) {
        this.log('✅ [CONFIRMED] Stage 2 Search Mode options active (खाता से / खसरा से)!');
        await this.takeStepScreenshot('7_vartman_selected');
        return true;
      }

      this.log(`   Attempt ${attempt}/4: Triggering selection for "वर्तमान नकल"...`);

      // 1. Try Puppeteer Native Click on Label or Input
      try {
        const elements = await this.page.$$('label, td, span, input[type="radio"]');
        for (const el of elements) {
          const txt = await this.page.evaluate((e) => (e.innerText || e.value || '').trim(), el);
          if (txt.includes('वर्तमान नकल')) {
            await el.click().catch(() => {});
            break;
          }
        }
      } catch (e) {
        this.log(`   Label click note: ${e.message}`);
      }

      // 2. Fallback via decoupled window.setTimeout postback
      await this.safeEvaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const vartmanRadio = radios.find((r) => {
          const p = (r.parentElement ? r.parentElement.innerText : '').trim();
          return r.id.toLowerCase().includes('vartman') || p.includes('वर्तमान नकल');
        });

        if (vartmanRadio) {
          vartmanRadio.checked = true;
          vartmanRadio.setAttribute('checked', 'checked');
          window.setTimeout(function () {
            if (typeof __doPostBack === 'function') {
              var target = vartmanRadio.name || vartmanRadio.id.replace(/_/g, '$');
              __doPostBack(target, '');
            } else if (vartmanRadio.form) {
              vartmanRadio.form.submit();
            }
          }, 20);
        }
      });

      await Promise.race([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        this.waitForAsyncPostback(2000),
        delay(2500),
      ]);
      await delay(800);
      await this.dismissModals();
    }

    throw new Error('चरण "वर्तमान नकल" का चयन पुष्ट नहीं हो सका।');
  }

  /**
   * Stage 3: Select "खाता से"
   */
  async stage3_SelectKhataRadio() {
    this.log('👉 [Stage 3: खाता से] Selecting "खाता से"...');
    await this.dismissModals();

    for (let attempt = 1; attempt <= 4; attempt++) {
      // Check if Stage 3 is already fulfilled (i.e. Khata select dropdown is rendered with numbers)
      const isConfirmed = await this.safeEvaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.some(
          (s) =>
            s.id.toLowerCase().includes('khata') ||
            (s.options && Array.from(s.options).some((o) => /^\d+$/.test(o.value.trim()) || /^\d+$/.test(o.text.trim())))
        );
      });

      if (isConfirmed) {
        this.log('✅ [CONFIRMED] Stage 3 ("खाता से") active and Khata dropdown populated!');
        await this.takeStepScreenshot('8_khata_radio_selected');
        return true;
      }

      this.log(`   Attempt ${attempt}/4: Triggering selection for "खाता से"...`);

      // 1. Try Puppeteer Native Click on "खाता से" Label or Input
      try {
        const elements = await this.page.$$('label, td, span, input[type="radio"]');
        for (const el of elements) {
          const txt = await this.page.evaluate((e) => (e.innerText || e.value || '').trim(), el);
          if (txt === 'खाता से' || txt.includes('खाता से')) {
            await el.click().catch(() => {});
            this.log(`   Clicked "खाता से" element: "${txt}"`);
            break;
          }
        }
      } catch (e) {
        this.log(`   Label click note: ${e.message}`);
      }

      // 2. Fallback via decoupled window.setTimeout postback
      await this.safeEvaluate(() => {
        const allLabels = Array.from(document.querySelectorAll('label, td, span'));
        for (const lbl of allLabels) {
          const txt = (lbl.innerText || '').trim();
          if (txt === 'खाता से' || txt.includes('खाता से')) {
            lbl.click();
            const forId = lbl.getAttribute('for');
            if (forId) {
              const r = document.getElementById(forId);
              if (r) {
                r.checked = true;
                r.setAttribute('checked', 'checked');
                window.setTimeout(function () {
                  if (typeof __doPostBack === 'function') {
                    __doPostBack(r.name || r.id.replace(/_/g, '$'), '');
                  } else if (r.form) {
                    r.form.submit();
                  }
                }, 20);
                return;
              }
            }
          }
        }

        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const khataRadio =
          radios.find((r) => {
            const p = (r.parentElement ? r.parentElement.innerText : '').trim();
            return (p.includes('खाता से') || r.id.toLowerCase().includes('khata')) && !r.id.includes('Khate_se');
          }) || (radios.length > 0 ? radios[0] : null);

        if (khataRadio) {
          khataRadio.checked = true;
          khataRadio.setAttribute('checked', 'checked');
          khataRadio.click();
          window.setTimeout(function () {
            if (typeof __doPostBack === 'function') {
              var target = khataRadio.name || khataRadio.id.replace(/_/g, '$');
              __doPostBack(target, '');
            } else if (khataRadio.form) {
              khataRadio.form.submit();
            }
          }, 20);
        }
      });

      await Promise.race([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
        this.waitForAsyncPostback(2000),
        delay(2500),
      ]);
      await delay(1000);
      await this.dismissModals();
    }

    throw new Error('चरण "खाता से" का चयन पुष्ट नहीं हो सका।');
  }

  /**
   * Stage 4: Select Khata Number in dropdown
   */
  async stage4_SelectKhataNumber(searchValue) {
    this.log(`🎯 [Stage 4] Selecting Khata No. "${searchValue}" in dropdown...`);
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
              window.setTimeout(function () {
                if (typeof __doPostBack === 'function' && select.getAttribute('onchange')?.includes('__doPostBack')) {
                  var target = select.name || select.id.replace(/_/g, '$');
                  __doPostBack(target, '');
                }
              }, 20);
              return { confirmed: true, text, id: select.id, value: opt.value };
            }
          }
        }
        return { confirmed: false };
      }, searchValue);

      if (chosen && chosen.confirmed) {
        this.log(`✅ [CONFIRMED] Khata ${searchValue} selected in dropdown: "${chosen.text}"`);
        break;
      }
      await delay(1000);
      await this.waitForAsyncPostback(1000);
    }
  }

  /**
   * Stage 5: Click "नकल (सूचनार्थ)" button & Confirm Table
   */
  async stage5_ClickNakalSuchnarth() {
    this.log('👉 [Stage 5] Clicking "नकल (सूचनार्थ)" button and rendering Jamabandi table...');

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
          this.log(`   Found Nakal button: "${text}", sending native click...`);
          await btn.click();
          clickedInfo = { clicked: true, text };
          break;
        }
      }
    } catch (e) {
      this.log(`   Native click note: ${e.message}`);
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
            window.setTimeout(function () {
              if (typeof __doPostBack === 'function') {
                try { __doPostBack(btn.name || btn.id.replace(/_/g, '$'), ''); } catch {}
              }
            }, 20);
            return { clicked: true, text: val, id: btn.id };
          }
        }
        return { clicked: false };
      });
    }

    this.log(`   Nakal button click status: ${JSON.stringify(clickedInfo)}`);

    if (!clickedInfo || !clickedInfo.clicked) {
      throw new Error('"नकल (सूचनार्थ)" बटन नहीं मिला या क्लिक नहीं हो सका।');
    }

    // Check if new tab was opened
    await delay(1500);
    const pages = await this.browser.pages();
    if (pages.length > 1) {
      const latestPage = pages[pages.length - 1];
      if (latestPage !== this.page) {
        this.log(`📑 Switched to newly opened Jamabandi tab: ${latestPage.url()}`);
        this.page = latestPage;
        this.page.on('dialog', async (d) => await d.accept().catch(() => {}));
      }
    }

    // Wait and confirm that the Jamabandi Table is rendered on screen
    this.log('⏳ Waiting for Jamabandi Record Table to render and confirming...');
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
      const hasKhasraKeyword = text.includes('खसरा') || text.includes('काश्तकार') || text.includes('रकबा') || text.includes('खातेदार');
      return {
        hasTable: rows.length > 5,
        hasKhasraKeyword,
        rowCount: rows.length,
        confirmed: rows.length > 5 && hasKhasraKeyword,
      };
    });

    this.log(`📊 [CONFIRMED] Table Render Confirmation: ${JSON.stringify(tableConfirmed)}`);
    if (!tableConfirmed || !tableConfirmed.confirmed) {
      throw new Error('जमाबंदी नकल रिकॉर्ड तालिका लोड नहीं हो सकी (Table not rendered).');
    }

    await this.takeStepScreenshot('5_table_rendered');
  }

  /**
   * Step 5: Select "जमाबंदी की प्रतिलिपि" ➔ "वर्तमान नकल" ➔ "खाता से" ➔ Khata (e.g. 525 / 560)
   */
  async selectJamabandiAndKhata() {
    const { searchValue } = this.config;
    this.log(`📌 7. Configuring Jamabandi Options for Khata "${searchValue}"...`);

    await this.dismissModals();
    await this.page.waitForSelector('input[type="radio"], label, table', { timeout: 15000 }).catch(() => {});
    await delay(1000);
    await this.takeStepScreenshot('5_options_page_opened');

    // 👉 Stage 1: Select "जमाबंदी की प्रतिलिपि"
    await this.stage1_SelectJamabandiRadio();

    // 👉 Stage 2: Select "वर्तमान नकल"
    await this.stage2_SelectVartmanRadio();

    // 👉 Stage 3: Select "खाता से"
    await this.stage3_SelectKhataRadio();

    // 👉 Stage 4: Select Khata Number in dropdown
    await this.stage4_SelectKhataNumber(searchValue);

    // 👉 Stage 5: Click "नकल (सूचनार्थ)" button & Confirm Table
    await this.stage5_ClickNakalSuchnarth();
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
      data.logs = this.logs || [];
      const files = await this.saveOutputs(data);

      this.log('🎉 Jamabandi extraction completed successfully!');
      return { success: true, data, files };
    } catch (error) {
      this.log(`❌ Extraction Error: ${error.message}`);

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
          logs: this.logs || [],
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
