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
      searchValue: String(config.searchValue || '525').trim(),
      browser: config.browser || null,
      options: {
        headless: config.options?.headless ?? true,
        slowMo: config.options?.slowMo ?? 0,
        timeout: config.options?.timeout ?? 60000,
        outputDir: config.options?.outputDir || './output',
        saveScreenshot: config.options?.saveScreenshot ?? false,
        savePdf: config.options?.savePdf ?? false,
        saveCsv: config.options?.saveCsv ?? false,
        saveJson: config.options?.saveJson ?? false,
      },
    };
    this.browser = config.browser || null;
    this.page = null;
    this.logs = [];
    this.stepScreenshots = {};
    this.isSharedBrowser = Boolean(config.browser);
  }

  log(msg) {
    const time = new Date().toLocaleTimeString('hi-IN', { hour12: false });
    const formatted = `[${time}] ${msg}`;
    if (!this.logs) this.logs = [];
    this.logs.push(formatted);
    console.log(formatted);
  }

  async initBrowser() {
    if (this.browser) {
      this.log('⚡ Reusing active Chrome browser instance (0ms startup)...');
      this.page = await this.browser.newPage();
    } else {
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
    }

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
    try {
      return await this.page.evaluate(fn, ...args);
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      if (
        msg.includes('Execution context was destroyed') ||
        msg.includes('Cannot find context') ||
        msg.includes('Target closed')
      ) {
        return { postbackTriggered: true };
      }
      this.log(`⚠️ Note: Evaluation catch: ${msg}`);
      return null;
    }
  }

  async dismissModals() {
    try {
      await this.safeEvaluate(() => {
        // 1. Click any Close / x / Dismiss buttons on modal popups
        const closeButtons = Array.from(document.querySelectorAll('button, a, span, input[type="button"], .close-icon')).filter((el) => {
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
            cls.includes('close') ||
            cls.includes('close-icon')
          );
        });
        closeButtons.forEach((b) => {
          try { b.click(); } catch {}
        });

        // 2. Hide any modal backdrops or popups
        const overlays = document.querySelectorAll('.custom-popup, .popup-content, .modal.show, .modal[style*="display: block"], .modal-backdrop, #myModal, #ModalPopup, .test, .back');
        overlays.forEach((el) => {
          try {
            el.classList.remove('show');
            el.style.display = 'none';
          } catch {}
        });
      });
    } catch {}
  }

  /**
   * Fast ASP.NET async postback polling (50ms intervals)
   */
  async waitForAsyncPostback(timeout = 6000) {
    try {
      await this.page.waitForFunction(() => {
        if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
          return !Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack();
        }
        return true;
      }, { polling: 50, timeout }).catch(() => {});
    } catch (e) {}
    await delay(100);
  }

  /**
   * Wait reactively for ASP.NET AJAX loading spinner / speed-meter overlay to completely disappear
   */
  async waitForLoadingToDisappear(timeout = 15000) {
    this.log('⏳ Waiting for loading icon / spinner to disappear...');
    try {
      await this.page.waitForFunction(() => {
        // 1. Check ASP.NET async postback status
        if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
          if (Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack()) {
            return false;
          }
        }

        // 2. Check for any visible loading/spinner images or containers
        const spinnerElements = Array.from(document.querySelectorAll('img, div, span')).filter((el) => {
          const id = (el.id || '').toLowerCase();
          const cls = (el.className || '').toLowerCase();
          const src = (el.getAttribute('src') || '').toLowerCase();
          const isSpinner =
            id.includes('progress') ||
            id.includes('loading') ||
            id.includes('updateprogress') ||
            cls.includes('progress') ||
            cls.includes('loading') ||
            cls.includes('spinner') ||
            src.includes('load') ||
            src.includes('spin') ||
            src.includes('prog');

          if (!isSpinner) return false;

          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0
          );
        });

        return spinnerElements.length === 0;
      }, { polling: 50, timeout }).catch(() => {});

      // Extra guarantee: forcibly hide any remaining loading overlays
      await this.safeEvaluate(() => {
        const loaders = document.querySelectorAll('[id*="UpdateProgress"], [id*="Progress"], [class*="progress"], [class*="loading"], img[src*="load"], img[src*="prog"]');
        loaders.forEach((el) => {
          try { el.style.display = 'none'; } catch {}
        });
      });
    } catch (e) {}

    await delay(200);
  }

  async takeStepScreenshot(stepKey) {
    if (!this.stepScreenshots) this.stepScreenshots = {};
    try {
      const buf = await this.page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
      this.stepScreenshots[stepKey] = `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (e) {}
  }

  /**
   * Step 1: Open Homepage, Close Opening Screen Popup, and Click "जमाबंदी नकल"
   */
  async openPortal() {
    this.log('🌐 1. Opening Rajasthan Apna Khata Portal...');
    
    try {
      await this.page.goto('https://apnakhata.rajasthan.gov.in/', {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
    } catch (e) {
      this.log('   Retrying portal connect...');
      await this.page.goto('https://apnakhata.rajasthan.gov.in/', { timeout: 30000 }).catch(() => {});
    }

    this.log('❌ Closing opening screen popup...');
    await this.dismissModals();
    await delay(300);
    await this.dismissModals();

    this.log('📑 Clicking "जमाबंदी नकल" button (Owner_wise/VillSelAll3.aspx)...');
    
    // Method 1: Try native Puppeteer selector click with navigation wait
    let navigated = false;
    const jamabandiBtn = await this.page.$('a[href*="VillSelAll3"], a[href*="VillSel"]');
    if (jamabandiBtn) {
      try {
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
          jamabandiBtn.click(),
        ]);
        navigated = this.page.url().includes('VillSel');
      } catch (e) {}
    }

    // Method 2: DOM Evaluate Click & window.location.href fallback
    if (!navigated) {
      await this.safeEvaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, div, span'));
        const btn = links.find((l) => {
          const t = (l.innerText || l.textContent || '').trim();
          const h = l.getAttribute('href') || '';
          return t === 'जमाबंदी नकल' || t.includes('जमाबंदी नकल') || h.includes('VillSelAll3');
        });
        if (btn) {
          if (btn.href) window.location.href = btn.href;
          else btn.click();
        } else {
          window.location.href = 'https://apnakhata.rajasthan.gov.in/Owner_wise/VillSelAll3.aspx';
        }
      });
      await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    }

    // If still on homepage, directly open VillSelAll3.aspx with active session
    if (!this.page.url().includes('VillSel')) {
      await this.page.goto('https://apnakhata.rajasthan.gov.in/Owner_wise/VillSelAll3.aspx', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }).catch(() => {});
    }

    await this.dismissModals();
    await this.page.waitForSelector('select, svg, map, area, table, body', { timeout: 8000 }).catch(() => {});
    this.log(`✅ Loaded District Selection Screen: ${this.page.url()}`);
    await this.takeStepScreenshot('0_portal_opened');
  }

  /**
   * Step 2: Select District (भीलवाड़ा / Bhilwara) from Map or Dropdown
   */
  async selectDistrict(districtName) {
    this.log(`📍 2. Selecting District: "${districtName}"...`);
    await this.dismissModals();

    for (let attempt = 1; attempt <= 3; attempt++) {
      // 1. If Tehsil select is already active on VillSelAll3
      const isTehsilReady = await this.safeEvaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.length > 1 || (selects.length === 1 && selects[0].id.toLowerCase().includes('tehsil'));
      });

      if (isTehsilReady) {
        this.log('✅ District already active, Tehsil dropdown ready!');
        break;
      }

      // 2. Click District from Map / Links / SVG / Dropdown
      const clicked = await this.safeEvaluate((target) => {
        // A. Check dropdown
        const selects = Array.from(document.querySelectorAll('select'));
        for (const select of selects) {
          for (let i = 0; i < select.options.length; i++) {
            const opt = select.options[i];
            const text = opt.text.trim();
            if (text === target || text.includes(target) || target.includes(text)) {
              select.selectedIndex = i;
              select.value = opt.value;
              if (typeof select.onchange === 'function') select.onchange();
              window.setTimeout(() => {
                if (typeof __doPostBack === 'function') {
                  __doPostBack(select.name || select.id.replace(/_/g, '$'), '');
                }
              }, 0);
              return { success: true, text: opt.text, method: 'dropdown' };
            }
          }
        }

        // B. Check links / SVG map paths / area
        const links = Array.from(document.querySelectorAll('a, button, area, div, span, path, rect, g'));
        for (const el of links) {
          const text = (el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('data-name') || el.getAttribute('id') || '').trim();
          const href = el.getAttribute('href') || '';
          if (
            text === target ||
            text.includes(target) ||
            (target === 'भीलवाड़ा' && (text.includes('Bhilwara') || href.includes('bhilwara') || href.includes('27') || (el.id && el.id.includes('27'))))
          ) {
            el.click();
            return { success: true, text, method: 'link_or_map' };
          }
        }

        return { success: false };
      }, districtName);

      this.log(`   Attempt ${attempt}/3 -> District selection: ${JSON.stringify(clicked)}`);

      // Reactively wait for Tehsil dropdown to appear / populate
      const isConfirmed = await this.page.waitForFunction(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.length > 1 || (selects.length === 1 && selects[0].options.length > 1);
      }, { polling: 50, timeout: 4000 }).catch(() => null);

      if (isConfirmed) {
        this.log(`✅ [CONFIRMED] District "${districtName}" selected and Tehsil dropdown ready!`);
        break;
      }
      await delay(500);
    }

    await this.dismissModals();
    await this.takeStepScreenshot('1_district_selected');
  }

  /**
   * Step 3: Select Tehsil (बनेड़ा / Banera)
   */
  async selectTehsil(tehsilName) {
    this.log(`🏛️ 3. Selecting Tehsil: "${tehsilName}"...`);
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
              window.setTimeout(function () {
                if (typeof __doPostBack === 'function') {
                  __doPostBack(tehsilSelect.name || tehsilSelect.id.replace(/_/g, '$'), '');
                }
              }, 20);
              return { success: true, text, value: opt.value };
            }
          }
        }
        return { success: false };
      }, tehsilName);

      this.log(`   Attempt ${attempt}/3 -> Tehsil selection: ${JSON.stringify(selResult)}`);
      await this.waitForAsyncPostback(4000);

      // Fast reactive confirmation for Chosala radio or village list
      const isConfirmed = await this.page.waitForFunction(() => {
        const bodyText = (document.body ? document.body.innerText : '') || '';
        const radios = document.querySelectorAll('input[type="radio"]');
        const villageLinks = document.querySelectorAll('table a, tr a, td a');
        return radios.length > 0 || villageLinks.length > 5 || bodyText.includes('चोसाला') || bodyText.includes('गाँव');
      }, { polling: 50, timeout: 4000 }).catch(() => null);

      if (isConfirmed) {
        this.log(`✅ [CONFIRMED] Tehsil "${tehsilName}" selected and village section ready!`);
        break;
      }
    }
    await this.takeStepScreenshot('2_tehsil_selected');
  }

  /**
   * Step 4: Select "चोसाला पद्धति जमाबंदी" (Chosala Padhti Jamabandi)
   */
  async selectChosalaPadhti() {
    this.log('📑 4. Selecting "चोसाला पद्धति जमाबंदी"...');
    await this.dismissModals();

    const chosen = await this.safeEvaluate(() => {
      // 1. Direct ID match for Chosala radio
      const radio =
        document.getElementById('ctl00_ContentPlaceHolder1_old_RB') ||
        document.querySelector('input[id*="old_RB"], input[value*="old"]') ||
        Array.from(document.querySelectorAll('input[type="radio"]')).find((r) => {
          const p = (r.parentElement ? r.parentElement.innerText : '').trim();
          const lbl = document.querySelector(`label[for="${r.id}"]`);
          const lblText = lbl ? lbl.innerText : '';
          return p.includes('चोसाला') || lblText.includes('चोसाला');
        });

      if (radio) {
        radio.checked = true;
        radio.setAttribute('checked', 'checked');
        radio.click();
        window.setTimeout(() => {
          if (typeof __doPostBack === 'function') {
            __doPostBack(radio.name || radio.id.replace(/_/g, '$'), '');
          }
        }, 0);
        return { clicked: true, id: radio.id };
      }

      return { clicked: false };
    });

    this.log(`   Chosala radio selection: ${JSON.stringify(chosen)}`);

    // Reactively wait for Village table links to load (50ms polling, max 4s)
    await this.page.waitForFunction(() => {
      const villageLinks = document.querySelectorAll('table a, tr a, td a');
      return villageLinks.length > 5;
    }, { polling: 50, timeout: 4000 }).catch(() => {});

    await this.dismissModals();
    await this.takeStepScreenshot('3_chosala_selected');
  }

  /**
   * Step 5: Select Village (रायला - रायला - रायला - selects LAST entry for latest settlement)
   */
  async selectVillage(villageName) {
    this.log(`🌾 5. Selecting Village: "${villageName}" (latest settlement)...`);

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

    await delay(300);

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

      if (exactMatches.length > 0) {
        const last = exactMatches[exactMatches.length - 1];
        last.el.click();
        return { type: 'exact_link_last', text: last.text, count: exactMatches.length };
      }

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
      this.log(`✅ [CONFIRMED] Selected Village: "${villageSelected.text}"`);
    }

    // Fast reactive wait for Nakal Options page
    await Promise.race([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
      this.page.waitForSelector('input[type="radio"], select, table', { timeout: 8000 }).catch(() => {}),
    ]);
    await this.takeStepScreenshot('4_village_selected');
  }

  /**
   * Step 6: Select "जमाबंदी की प्रतिलिपि" ➔ Select "खाता से" ➔ Place Khata (525) ➔ Wait for Spinner
   */
  async selectJamabandiAndKhata() {
    const searchValue = String(this.config.searchValue || '525').trim();
    this.log(`📌 6. Configuring Nakal Options for Khata "${searchValue}"...`);

    await this.dismissModals();

    // 1. Select Radio "जमाबंदी की प्रतिलिपि"
    this.log('👉 Step 6a: Selecting "जमाबंदी की प्रतिलिपि" radio...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const clicked1 = await this.safeEvaluate(() => {
        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of allRadios) {
          const p = (r.parentElement ? r.parentElement.innerText : '').trim();
          const lbl = document.querySelector(`label[for="${r.id}"]`);
          const lblText = lbl ? (lbl.innerText || '').trim() : '';
          if (p.includes('जमाबंदी की प्रतिलिपि') || lblText.includes('जमाबंदी की प्रतिलिपि') || r.id.toLowerCase().includes('khate_se')) {
            r.checked = true;
            r.click();
            window.setTimeout(() => {
              if (typeof __doPostBack === 'function') {
                __doPostBack(r.name || r.id.replace(/_/g, '$'), '');
              }
            }, 0);
            return { clicked: true, id: r.id, name: r.name };
          }
        }
        if (allRadios.length > 0) {
          allRadios[0].checked = true;
          allRadios[0].click();
          window.setTimeout(() => {
            if (typeof __doPostBack === 'function') {
              __doPostBack(allRadios[0].name || allRadios[0].id.replace(/_/g, '$'), '');
            }
          }, 0);
          return { clicked: true, id: allRadios[0].id, fallback: true };
        }
        return { clicked: false };
      });

      this.log(`   Step 6a status: ${JSON.stringify(clicked1)}`);
      await this.waitForAsyncPostback(3000);

      // Check if "खाता से" or "वर्तमान नकल" options appeared
      const is6aReady = await this.safeEvaluate(() => {
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        return radios.some((r) => {
          const p = (r.parentElement ? r.parentElement.innerText : '').trim();
          return p.includes('खाता से') || p.includes('वर्तमान नकल') || r.id.toLowerCase().includes('khata');
        });
      });

      if (is6aReady) {
        this.log('✅ [CONFIRMED] "जमाबंदी की प्रतिलिपि" active!');
        break;
      }
      await delay(400);
    }

    await this.dismissModals();

    // 2. Select Radio "खाता से"
    this.log('👉 Step 6b: Selecting "खाता से" radio...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const clicked2 = await this.safeEvaluate(() => {
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
                window.setTimeout(() => {
                  if (typeof __doPostBack === 'function') {
                    __doPostBack(r.name || r.id.replace(/_/g, '$'), '');
                  }
                }, 0);
                return { clicked: true, id: r.id, method: 'label_for' };
              }
            }
          }
        }

        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const khataRadio = allRadios.find((r) => {
          const p = (r.parentElement ? r.parentElement.innerText : '').trim();
          return (p.includes('खाता से') || r.id.toLowerCase().includes('khata')) && !r.id.toLowerCase().includes('khate_se');
        });

        if (khataRadio) {
          khataRadio.checked = true;
          khataRadio.click();
          window.setTimeout(() => {
            if (typeof __doPostBack === 'function') {
              __doPostBack(khataRadio.name || khataRadio.id.replace(/_/g, '$'), '');
            }
          }, 0);
          return { clicked: true, id: khataRadio.id, method: 'radio' };
        }

        return { clicked: false };
      });

      this.log(`   Step 6b status: ${JSON.stringify(clicked2)}`);
      await this.waitForAsyncPostback(3000);

      // Check if Khata dropdown is populated with numbers
      const is6bReady = await this.page.waitForFunction(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.some((s) => s.options && s.options.length > 2);
      }, { polling: 50, timeout: 3000 }).catch(() => null);

      if (is6bReady) {
        this.log('✅ [CONFIRMED] "खाता से" active & Khata dropdown populated!');
        break;
      }
      await delay(400);
    }

    await this.dismissModals();

    // 3. Select Khata Number in dropdown & set textbox
    this.log(`👉 Step 6c: Placing Khata No. "${searchValue}"...`);
    const placed = await this.safeEvaluate((targetKhata) => {
      const cleanTarget = targetKhata.replace(/[^\d]/g, '');
      const selects = Array.from(document.querySelectorAll('select'));
      let dropdownSet = false;

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
            if (typeof select.onchange === 'function') select.onchange();
            select.dispatchEvent(new Event('change', { bubbles: true }));
            window.setTimeout(() => {
              if (typeof __doPostBack === 'function') {
                __doPostBack(select.name || select.id.replace(/_/g, '$'), '');
              }
            }, 0);
            dropdownSet = true;
            break;
          }
        }
        if (dropdownSet) break;
      }

      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
      for (const inp of inputs) {
        inp.value = cleanTarget;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }

      return { dropdownSet };
    }, searchValue);

    this.log(`   Khata placement status: ${JSON.stringify(placed)}`);

    // 4. Reactively wait for UpdateProgress / Loading Spinner to disappear
    await this.page.waitForFunction(() => {
      if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
        if (Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack()) {
          return false;
        }
      }
      const up = document.getElementById('UpdateProgress1') || document.querySelector('[id*="UpdateProgress"]');
      if (up) {
        const style = window.getComputedStyle(up);
        if (style.display !== 'none' && style.visibility !== 'hidden' && up.offsetWidth > 0) {
          return false;
        }
      }
      return true;
    }, { polling: 50, timeout: 5000 }).catch(() => {});

    // Forcibly hide any lingering loading overlay
    await this.safeEvaluate(() => {
      const up = document.querySelectorAll('[id*="UpdateProgress"], [id*="Progress"], [class*="progress"]');
      up.forEach((el) => {
        try { el.style.display = 'none'; } catch {}
      });
    });

    await delay(200);
    await this.dismissModals();
    await this.takeStepScreenshot('5_khata_placed');
  }

  /**
   * Step 7: Extract complete Jamabandi Record & All Khatedar lines
   */
  async extractJamabandiData() {
    const searchValue = String(this.config.searchValue || '525').replace(/[^\d]/g, '').trim() || '525';
    this.log(`📊 7. Extracting complete Jamabandi record from page for Khata "${searchValue}"...`);

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

      // 2. Extract Complete Owners / Kashtkaar (all lines under Khasra table)
      const seenOwnerLines = new Set();
      const allTds = Array.from(document.querySelectorAll('td, th, tr, div'));

      for (const el of allTds) {
        if (el.querySelectorAll('table').length > 0) continue;
        const text = (el.innerText || '').trim();
        if (
          (text.includes('खातेदार') || text.includes('काश्तकार') || text.includes('सा.देह') || text.includes('पुत्र') || text.includes('पि.')) &&
          !text.includes('खसरो की सूचना') &&
          !text.includes('जमाबंदी की सूचना') &&
          !text.includes('विकल्प') &&
          text.length > 3
        ) {
          const splitLines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 2 && !l.includes('खसरा') && !l.includes('रकबा') && !l.includes('खाता संख्या'));
          splitLines.forEach((l) => {
            if (!seenOwnerLines.has(l)) {
              seenOwnerLines.add(l);
              result.owners.push(l);
            }
          });
        }
      }

      // Fallback text parsing if not found in TD
      if (result.owners.length === 0) {
        const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('काश्तकार') || line.includes('खातेदार') || line.includes('सा.देह') || line.includes('पि.')) {
            if (i > 0 && lines[i - 1].length > 3 && !lines[i - 1].includes('रकबा') && !lines[i - 1].includes('खसरा') && !lines[i - 1].includes('खाता')) {
              if (!seenOwnerLines.has(lines[i - 1])) {
                seenOwnerLines.add(lines[i - 1]);
                result.owners.push(lines[i - 1]);
              }
            }
            if (!seenOwnerLines.has(line)) {
              seenOwnerLines.add(line);
              result.owners.push(line);
            }
          }
        }
      }

      result.selectedOptions = {
        nakalType: 'जमाबंदी की प्रतिलिपि',
        nakalPeriod: 'वर्तमान नकल',
        searchMode: 'खाता से',
        khataNumber: result.khataNumber,
      };

      // 3. Extract Khasra Rows (खाता संख्या | खसरा | रकबा | सिंचाई के साधन | खेत का नाम | शामिल नंबर)
      const tables = Array.from(document.querySelectorAll('table'));

      tables.forEach((table, tableIndex) => {
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

            if (
              rowVals.length >= 3 &&
              hasNumbers &&
              !joinedRow.includes('खाता संख्या') &&
              !joinedRow.includes('खसरो की सूचना') &&
              !joinedRow.includes('जमाबंदी की सूचना') &&
              !joinedRow.includes('कुल') &&
              !joinedRow.includes('खातेदार') &&
              !joinedRow.includes('काश्तकार') &&
              !joinedRow.includes('सा.देह')
            ) {
              let khata = rowVals[0] || targetKhata;
              let khasra = rowVals[1] || '';
              let rakba = rowVals[2] || '';
              let irrigation = rowVals[3] || '-';
              let farmName = rowVals[4] || '';
              let soilAndTax = rowVals.slice(3).filter(Boolean).join(' ');

              if (khasra && rakba) {
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

    data.stepScreenshots = this.stepScreenshots || {};
    if (this.stepScreenshots && this.stepScreenshots['5_table_rendered']) {
      data.screenshotBase64 = this.stepScreenshots['5_table_rendered'];
    } else {
      try {
        const screenshotBuffer = await this.page.screenshot({
          type: 'jpeg',
          quality: 75,
        });
        data.screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
      } catch (e) {}
    }

    return data;
  }

  async saveOutputFiles(data) {
    const { outputDir = './output', saveJson = true, saveCsv = true, savePdf = true, saveScreenshot = true } = this.config.options || {};
    ensureDirectory(outputDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeDistrict = (this.config.district || 'भीलवाड़ा').replace(/[^\w\u0900-\u097F]/g, '_');
    const safeSearchVal = (this.config.searchValue || '525').replace(/[^\w\u0900-\u097F]/g, '_');
    const baseFilename = `jamabandi_${safeDistrict}_khata_${safeSearchVal}_${timestamp}`;

    const savedFiles = [];

    if (saveJson) {
      const jsonPath = path.join(outputDir, `${baseFilename}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
      savedFiles.push({ format: 'JSON', path: jsonPath });
      this.log(`💾 JSON Data saved: ${jsonPath}`);
    }

    if (saveCsv) {
      const csvPath = path.join(outputDir, `${baseFilename}_khasra_details.csv`);
      const headers = ['Khata No', 'Khasra No', 'Rakba (Hectares)', 'Irrigation', 'Farm Name', 'Soil / Tax Details'];
      const rows = (data.khasraRecords || []).map((r) => [
        r.khataNo || data.khataNumber || '',
        r.khasraNo || '',
        r.rakbaHectare || '',
        r.irrigation || '-',
        r.farmName || '',
        r.soilAndTax || '-',
      ]);
      const csvContent = convertToCSV(headers, rows);
      fs.writeFileSync(csvPath, '\uFEFF' + csvContent, 'utf-8');
      savedFiles.push({ format: 'CSV', path: csvPath });
      this.log(`📊 CSV Details saved: ${csvPath}`);
    }

    if (saveScreenshot) {
      const imgPath = path.join(outputDir, `${baseFilename}.png`);
      await this.page.screenshot({ path: imgPath, fullPage: true });
      savedFiles.push({ format: 'Screenshot', path: imgPath });
      this.log(`📸 Screenshot saved: ${imgPath}`);
    }

    if (savePdf) {
      try {
        const pdfPath = path.join(outputDir, `${baseFilename}.pdf`);
        await this.page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
        savedFiles.push({ format: 'PDF', path: pdfPath });
        this.log(`📄 PDF Document saved: ${pdfPath}`);
      } catch (err) {}
    }

    return savedFiles;
  }

  async saveOutputs(data) {
    return this.saveOutputFiles(data);
  }

  async run() {
    const startTime = Date.now();
    try {
      await this.initBrowser();
      await this.openPortal();

      if (this.config.district) {
        await this.selectDistrict(this.config.district);
      }
      if (this.config.tehsil) {
        await this.selectTehsil(this.config.tehsil);
      }
      
      await this.selectChosalaPadhti();

      if (this.config.village) {
        await this.selectVillage(this.config.village);
      }

      await this.selectJamabandiAndKhata();

      let screenshotBase64 = this.stepScreenshots['5_khata_placed'];
      if (!screenshotBase64) {
        const screenshotBuffer = await this.page.screenshot({
          type: 'jpeg',
          quality: 90,
          fullPage: false,
        });
        screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
        if (!this.stepScreenshots) this.stepScreenshots = {};
        this.stepScreenshots['5_table_rendered'] = screenshotBase64;
        this.stepScreenshots['5_khata_placed'] = screenshotBase64;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      this.log(`📸 Khata placed & Loading icon gone in ${elapsed}s! Extracting data...`);

      // 7. Extract Jamabandi record (Kashtkaar & Khasra Table) from the active page DOM
      const data = await this.extractJamabandiData();
      data.screenshotBase64 = screenshotBase64;
      data.stepScreenshots = this.stepScreenshots;
      data.logs = this.logs || [];
      data.executionTimeSeconds = elapsed;

      this.log(`✅ Extracted ${data.owners ? data.owners.length : 0} Owners / Kashtkaar and ${data.khasraRecords ? data.khasraRecords.length : 0} Khasra records!`);

      // Save output files if configured
      let savedFiles = [];
      try {
        savedFiles = await this.saveOutputFiles(data);
      } catch (err) {}

      return { success: true, data, files: savedFiles };
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      this.log(`❌ Extraction Error (${elapsed}s): ${error.message}`);

      let errorScreenshot = null;
      try {
        if (this.page) {
          const buf = await this.page.screenshot({ type: 'jpeg', quality: 65, fullPage: false });
          errorScreenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
          if (!this.stepScreenshots) this.stepScreenshots = {};
          this.stepScreenshots['error_state'] = errorScreenshot;
        }
      } catch (e) {}

      return {
        success: false,
        error: error.message,
        data: {
          logs: this.logs || [],
          screenshotBase64: errorScreenshot,
          stepScreenshots: this.stepScreenshots || {},
          errorAt: new Date().toISOString(),
          executionTimeSeconds: elapsed,
        },
      };
    } finally {
      if (this.page) {
        await this.page.close().catch(() => {});
      }
      if (this.browser && !this.isSharedBrowser && this.config.options.headless) {
        await this.browser.close().catch(() => {});
      }
    }
  }
}
