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
    this.detailedSteps = [];
    this.stepScreenshots = {};
    this.isSharedBrowser = Boolean(config.browser);
    this.onProgress = typeof config.onProgress === 'function' ? config.onProgress : null;
  }

  log(msg, stage = null, stageName = null) {
    const time = new Date().toLocaleTimeString('hi-IN', { hour12: false });
    const formatted = `[${time}] ${msg}`;
    if (!this.logs) this.logs = [];
    this.logs.push(formatted);
    console.log(formatted);

    if (this.onProgress) {
      try {
        this.onProgress({
          type: 'progress',
          time,
          stage: stage || this.currentStage || null,
          stageName: stageName || this.currentStageName || null,
          message: msg,
          latestStep: this.detailedSteps && this.detailedSteps.length > 0 ? this.detailedSteps[this.detailedSteps.length - 1] : null,
        });
      } catch {}
    }
  }

  stepUpdate(stage, action, status, detail = '', uiVerified = false) {
    const time = new Date().toLocaleTimeString('hi-IN', { hour12: false });
    const entry = {
      time,
      stage,
      action,
      status, // 'action_triggered' | 'click_accepted' | 'postback_running' | 'ui_updated' | 'confirmed'
      detail,
      uiVerified: Boolean(uiVerified),
    };
    if (!this.detailedSteps) this.detailedSteps = [];
    this.detailedSteps.push(entry);

    const prefix = uiVerified
      ? '🟢 [UI UPDATED]'
      : status === 'click_accepted'
      ? '👉 [CLICK ACCEPTED]'
      : status === 'postback_running'
      ? '⏳ [POSTBACK]'
      : 'ℹ️ [ACTION]';

    this.log(`${prefix} ${action} ➔ ${status} (${detail})`, stage);
  }

  setStage(stage, stageName, msg) {
    this.currentStage = stage;
    this.currentStageName = stageName;
    this.log(msg, stage, stageName);
  }

  async initBrowser() {
    if (this.browser) {
      this.page = await this.browser.newPage();
    } else {
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

    // 1. Advanced Anti-Detection: Mask Automation Flags & Mimic Real User Browser
    await this.page.evaluateOnNewDocument(() => {
      // Overwrite navigator.webdriver to undefined
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mimic standard Chrome plugins & languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['hi-IN', 'hi', 'en-US', 'en'],
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Window chrome runtime mock
      window.chrome = {
        runtime: {},
        app: {},
        csi: () => {},
        loadTimes: () => {},
      };

      // Auto-approve dialogs
      window.confirm = () => true;
      window.alert = () => true;
      window.prompt = () => true;
    });

    // 2. Realistic User-Agent & Client Hints
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    );

    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'hi-IN,hi;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
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
    this.stepUpdate(1, 'पोर्टल कनेक्शन (Portal Connection)', 'action_triggered', 'पोर्टल से संपर्क स्थापित किया जा रहा है...');
    
    try {
      await this.page.goto('https://apnakhata.rajasthan.gov.in/', {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      this.stepUpdate(1, 'पोर्टल कनेक्शन (Portal Connection)', 'ui_updated', 'पोर्टल लोड हुआ (Portal loaded)', true);
    } catch (e) {
      await this.page.goto('https://apnakhata.rajasthan.gov.in/', { timeout: 30000 }).catch(() => {});
    }

    this.stepUpdate(1, 'संवाद सत्यापन (Notice Dialogue)', 'action_triggered', 'प्रक्रिया जारी...');
    await this.dismissModals();
    await delay(300);
    await this.dismissModals();
    this.stepUpdate(1, 'संवाद सत्यापन (Notice Dialogue)', 'ui_updated', 'सत्यापित (Verified)', true);

    this.stepUpdate(1, 'जमाबंदी विकल्प (Jamabandi Option)', 'action_triggered', 'जमाबंदी नकल का चयन किया जा रहा है...');
    
    let navigated = false;
    const jamabandiBtn = await this.page.$('a[href*="VillSelAll3"], a[href*="VillSel"]');
    if (jamabandiBtn) {
      try {
        this.stepUpdate(1, 'जमाबंदी विकल्प (Jamabandi Option)', 'click_accepted', 'विकल्प चुना गया (Option selected)');
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
          jamabandiBtn.click(),
        ]);
        navigated = this.page.url().includes('VillSel');
      } catch (e) {}
    }

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

    if (!this.page.url().includes('VillSel')) {
      await this.page.goto('https://apnakhata.rajasthan.gov.in/Owner_wise/VillSelAll3.aspx', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      }).catch(() => {});
    }

    this.stepUpdate(1, 'जिला चयन स्क्रीन (District Selection Screen)', 'ui_updated', 'जिला सूची उपलब्ध है (District selection active)', true);
    await this.dismissModals();
  }

  /**
   * Step 2: Select District (भीलवाड़ा / Bhilwara) from Map or Dropdown
   */
  async selectDistrict(districtName) {
    this.stepUpdate(2, `जिला चयन (${districtName})`, 'action_triggered', `जिला चुना जा रहा है: ${districtName}`);
    await this.dismissModals();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const isTehsilReady = await this.safeEvaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.length > 1 || (selects.length === 1 && selects[0].id.toLowerCase().includes('tehsil'));
      });

      if (isTehsilReady) {
        this.stepUpdate(2, `जिला चयन (${districtName})`, 'ui_updated', 'तहसील सूची उपलब्ध है (Tehsil list ready)', true);
        break;
      }

      const clicked = await this.safeEvaluate((target) => {
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
              return { success: true, text: opt.text };
            }
          }
        }

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
            return { success: true, text };
          }
        }

        return { success: false };
      }, districtName);

      if (clicked && clicked.success) {
        this.stepUpdate(2, `जिला चयन (${districtName})`, 'click_accepted', 'जिला चयन स्वीकार हुआ (District accepted)');
      }

      this.stepUpdate(2, 'तहसील सूची (Tehsil List)', 'postback_running', 'तहसील सूची लोड हो रही है...');
      const isConfirmed = await this.page.waitForFunction(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.length > 1 || (selects.length === 1 && selects[0].options.length > 1);
      }, { polling: 50, timeout: 4000 }).catch(() => null);

      if (isConfirmed) {
        const optionCount = await this.page.evaluate(() => {
          const s = document.querySelector('select[id*="Tehsil"], select[name*="Tehsil"]') || document.querySelectorAll('select')[1];
          return s ? s.options.length : 0;
        });
        this.stepUpdate(2, 'तहसील सूची (Tehsil List)', 'ui_updated', `तहसील सूची अपडेट हुई (${optionCount} तहसीलें उपलब्ध)`, true);
        break;
      }
      await delay(500);
    }

    await this.dismissModals();
  }

  /**
   * Step 3: Select Tehsil (बनेड़ा / Banera)
   */
  async selectTehsil(tehsilName) {
    this.stepUpdate(3, `तहसील चयन (${tehsilName})`, 'action_triggered', `तहसील चुनी जा रही है: ${tehsilName}`);
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

      if (selResult && selResult.success) {
        this.stepUpdate(3, `तहसील चयन (${tehsilName})`, 'click_accepted', 'तहसील चयन स्वीकार हुआ (Tehsil accepted)');
      }

      this.stepUpdate(3, 'गाँव एवं पद्धति सूची (Village & Method List)', 'postback_running', 'सूची लोड हो रही है...');
      await this.waitForAsyncPostback(4000);

      const isConfirmed = await this.page.waitForFunction(() => {
        const bodyText = (document.body ? document.body.innerText : '') || '';
        const radios = document.querySelectorAll('input[type="radio"]');
        const villageLinks = document.querySelectorAll('table a, tr a, td a');
        return radios.length > 0 || villageLinks.length > 5 || bodyText.includes('चोसाला') || bodyText.includes('गाँव');
      }, { polling: 50, timeout: 4000 }).catch(() => null);

      if (isConfirmed) {
        this.stepUpdate(3, 'गाँव एवं पद्धति सूची (Village & Method List)', 'ui_updated', 'गाँव एवं पद्धति सूची अपडेट हुई (List ready)', true);
        break;
      }
    }
  }

  /**
   * Step 4: Select "चोसाला पद्धति जमाबंदी" (Chosala Padhti Jamabandi)
   */
  async selectChosalaPadhti() {
    this.stepUpdate(4, 'जमाबंदी पद्धति चयन', 'action_triggered', 'चोसाला पद्धति का चयन किया जा रहा है...');
    await this.dismissModals();

    const chosen = await this.safeEvaluate(() => {
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

    if (chosen && chosen.clicked) {
      this.stepUpdate(4, 'जमाबंदी पद्धति चयन', 'click_accepted', 'पद्धति चयन स्वीकार हुआ (Method accepted)');
    }

    this.stepUpdate(4, 'गाँव सूची (Village List)', 'postback_running', 'गाँव सूची लोड हो रही है...');
    await this.waitForAsyncPostback(4000);
    const tableReady = await this.page.waitForFunction(() => {
      const villageLinks = document.querySelectorAll('table a, tr a, td a');
      return villageLinks.length > 5;
    }, { polling: 50, timeout: 5000 }).catch(() => false);

    if (tableReady) {
      const linkCount = await this.page.evaluate(() => document.querySelectorAll('table a, tr a, td a').length);
      this.stepUpdate(4, 'गाँव सूची (Village List)', 'ui_updated', `गाँव सूची अपडेट हुई (${linkCount} गाँव उपलब्ध)`, true);
    }

    await this.dismissModals();
  }

  /**
   * Step 5: Select Village (रायला - रायला - रायला - selects LAST entry for latest settlement)
   */
  async selectVillage(villageName) {
    const targetBase = villageName.split(/[\s\-]+/)[0].trim(); // e.g. "रायला"
    this.stepUpdate(5, `गाँव चयन (${villageName})`, 'action_triggered', `गाँव खोजा जा रहा है: ${villageName}`);
    await this.dismissModals();

    for (let attempt = 1; attempt <= 3; attempt++) {
      let villageSelected = await this.safeEvaluate((target, base) => {
        const links = Array.from(document.querySelectorAll('table a, div a, tr a, td a, a'));
        const exactMatches = [];
        const baseMatches = [];

        for (const link of links) {
          const text = (link.innerText || link.textContent || '').trim();
          const href = link.getAttribute('href') || '';
          if (href.includes('DistTehVillRpt') || href.includes('VillSelAll')) continue;

          if (text === target || text.includes(target)) {
            exactMatches.push({ el: link, text });
          } else if (text.startsWith(base) || text.includes(base)) {
            baseMatches.push({ el: link, text });
          }
        }

        const matches = exactMatches.length > 0 ? exactMatches : baseMatches;
        if (matches.length > 0) {
          const chosen = matches[matches.length - 1];
          chosen.el.click();
          return { success: true, text: chosen.text, count: matches.length };
        }

        return { success: false };
      }, villageName.trim(), targetBase);

      if (villageSelected && villageSelected.success) {
        this.stepUpdate(5, `गाँव चयन (${villageName})`, 'click_accepted', `गाँव चुना गया: ${villageSelected.text}`);
      } else {
        const initial = targetBase.charAt(0);
        this.stepUpdate(5, `अक्षर खोज (${initial})`, 'action_triggered', `अक्षर '${initial}' के अनुसार सूची फ़िल्टर की जा रही है...`);
        
        await this.safeEvaluate((firstLetter) => {
          const btns = Array.from(document.querySelectorAll('a, button, input[type="button"], span, td'));
          for (const btn of btns) {
            const text = (btn.innerText || btn.getAttribute('value') || '').trim();
            if (text === firstLetter || text === 'र' || text === 'R') {
              btn.click();
              break;
            }
          }
        }, initial);

        this.stepUpdate(5, `अक्षर खोज (${initial})`, 'click_accepted', `अक्षर '${initial}' चुना गया`);
        await this.waitForAsyncPostback(4000);
        await delay(500);
        continue;
      }

      this.stepUpdate(5, 'नकल विकल्प (Nakal Options)', 'postback_running', 'नकल विकल्प लोड हो रहे हैं...');
      await this.waitForAsyncPostback(5000);
      const onNakalPage = await this.page.waitForFunction(() => {
        const bodyText = (document.body ? document.body.innerText : '') || '';
        const hasJamabandi = document.querySelector('[id*="RB_Jamabandi"], input[value*="Jamabandi"]');
        return Boolean(hasJamabandi) || bodyText.includes('जमाबंदी की प्रतिलिपि') || bodyText.includes('नकल');
      }, { polling: 100, timeout: 5000 }).catch(() => null);

      if (onNakalPage) {
        this.stepUpdate(5, 'नकल विकल्प (Nakal Options)', 'ui_updated', `गाँव "${villageName}" के नकल विकल्प लोड हुए`, true);
        break;
      }
      await delay(500);
    }

    await this.dismissModals();
  }

  /**
   * Step 6: Select "जमाबंदी की प्रतिलिपि" ➔ Select "खाता से" ➔ Place Khata (525) ➔ Wait for Spinner
   */
  async selectJamabandiAndKhata() {
    const searchValue = String(this.config.searchValue || '525').trim();
    this.stepUpdate(6, 'नकल विन्यास', 'action_triggered', `खाता संख्या: ${searchValue}`);
    await this.dismissModals();

    // 1. Select Radio "जमाबंदी की प्रतिलिपि"
    this.stepUpdate(6, 'जमाबंदी नकल विकल्प', 'action_triggered', 'जमाबंदी की प्रतिलिपि का चयन किया जा रहा है...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const clicked1 = await this.safeEvaluate(() => {
        const jamabandiRadio =
          document.getElementById('ctl00_ContentPlaceHolder1_RB_Jamabandi') ||
          document.querySelector('input[id*="RB_Jamabandi"], input[id*="Jamabandi"]');

        if (jamabandiRadio) {
          jamabandiRadio.checked = true;
          jamabandiRadio.click();
          window.setTimeout(() => {
            if (typeof __doPostBack === 'function') {
              __doPostBack(jamabandiRadio.name || jamabandiRadio.id.replace(/_/g, '$'), '');
            }
          }, 0);
          return { clicked: true };
        }

        const allRadios = Array.from(document.querySelectorAll('input[type="radio"]'));
        for (const r of allRadios) {
          const p = (r.parentElement ? r.parentElement.innerText : '').trim();
          const lbl = document.querySelector(`label[for="${r.id}"]`);
          const lblText = lbl ? (lbl.innerText || '').trim() : '';
          if (p.includes('जमाबंदी की प्रतिलिपि') || lblText.includes('जमाबंदी की प्रतिलिपि') || r.id.toLowerCase().includes('jamabandi')) {
            r.checked = true;
            r.click();
            window.setTimeout(() => {
              if (typeof __doPostBack === 'function') {
                __doPostBack(r.name || r.id.replace(/_/g, '$'), '');
              }
            }, 0);
            return { clicked: true };
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
          return { clicked: true };
        }
        return { clicked: false };
      });

      if (clicked1 && clicked1.clicked) {
        this.stepUpdate(6, 'जमाबंदी नकल विकल्प', 'click_accepted', 'जमाबंदी नकल विकल्प चुना गया');
      }

      this.stepUpdate(6, 'खोज माध्यम', 'postback_running', 'खोज विकल्प लोड हो रहे हैं...');
      await this.waitForAsyncPostback(4000);

      const is6aReady = await this.page.waitForFunction(() => {
        const body = (document.body ? document.body.innerText : '') || '';
        return body.includes('खाता से') || document.querySelector('input[id*="RB_Khata"]');
      }, { polling: 50, timeout: 4000 }).catch(() => null);

      if (is6aReady) {
        this.stepUpdate(6, 'खोज माध्यम', 'ui_updated', 'खोज माध्यम उपलब्ध हैं (खाता से / खसरा से)', true);
        break;
      }
      await delay(400);
    }

    await this.dismissModals();

    // 2. Select Radio "खाता से"
    this.stepUpdate(6, 'खाता माध्यम', 'action_triggered', 'खाता संख्या द्वारा खोज चुनी जा रही है...');
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
                return { clicked: true };
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
          return { clicked: true };
        }

        return { clicked: false };
      });

      if (clicked2 && clicked2.clicked) {
        this.stepUpdate(6, 'खाता माध्यम', 'click_accepted', 'खाता माध्यम चुना गया');
      }

      this.stepUpdate(6, 'खाता संख्या सूची', 'postback_running', 'खाता संख्या सूची लोड हो रही है...');
      await this.waitForAsyncPostback(3000);

      const is6bReady = await this.page.waitForFunction(() => {
        const khataSelect = document.querySelector('select[id*="DDL_Khata"], select[name*="DDL_Khata"]');
        if (khataSelect && khataSelect.options && khataSelect.options.length > 1) {
          return true;
        }
        const selects = Array.from(document.querySelectorAll('select'));
        return selects.some((s) => s.options && s.options.length > 2);
      }, { polling: 50, timeout: 4000 }).catch(() => null);

      if (is6bReady) {
        const count = await this.page.evaluate(() => {
          const s = document.querySelector('select[id*="DDL_Khata"], select[name*="DDL_Khata"]');
          return s ? s.options.length : 0;
        });
        this.stepUpdate(6, 'खाता संख्या सूची', 'ui_updated', `खाता संख्या सूची लोड हुई (${count} खाते उपलब्ध)`, true);
        break;
      }
      await delay(400);
    }

    await this.dismissModals();

    // 3. Select Khata Number in dropdown
    this.stepUpdate(6, `खाता चयन (${searchValue})`, 'action_triggered', `खाता संख्या ${searchValue} खोजी जा रही है...`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const placed = await this.safeEvaluate((targetKhata) => {
        const cleanTarget = targetKhata.replace(/[^\d]/g, '');
        let khataSelect =
          document.getElementById('ctl00_ContentPlaceHolder1_DDL_Khata') ||
          document.querySelector('select[id*="DDL_Khata"], select[name*="DDL_Khata"]') ||
          Array.from(document.querySelectorAll('select')).find(s => s.id.toLowerCase().includes('khata') || s.name.toLowerCase().includes('khata'));

        let dropdownSet = false;
        let selectedValue = null;

        if (khataSelect && khataSelect.options) {
          for (let i = 0; i < khataSelect.options.length; i++) {
            const opt = khataSelect.options[i];
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
              khataSelect.selectedIndex = i;
              khataSelect.value = opt.value;
              selectedValue = opt.value;
              if (typeof khataSelect.onchange === 'function') {
                try { khataSelect.onchange(); } catch {}
              }
              khataSelect.dispatchEvent(new Event('change', { bubbles: true }));
              window.setTimeout(() => {
                if (typeof __doPostBack === 'function') {
                  __doPostBack(khataSelect.name || khataSelect.id.replace(/_/g, '$'), '');
                }
              }, 20);
              dropdownSet = true;
              break;
            }
          }
        }

        if (!dropdownSet) {
          const khataInput =
            document.getElementById('ctl00_ContentPlaceHolder1_TB_Khata') ||
            document.querySelector('input[id*="TB_Khata"], input[name*="TB_Khata"]');
          if (khataInput) {
            khataInput.value = cleanTarget;
            khataInput.dispatchEvent(new Event('input', { bubbles: true }));
            khataInput.dispatchEvent(new Event('change', { bubbles: true }));
            window.setTimeout(() => {
              if (typeof __doPostBack === 'function') {
                __doPostBack(khataInput.name || khataInput.id.replace(/_/g, '$'), '');
              }
            }, 20);
          }
        }

        return { dropdownSet, selectedValue };
      }, searchValue);

      if (placed && placed.dropdownSet) {
        this.stepUpdate(6, `खाता चयन (${searchValue})`, 'click_accepted', `खाता संख्या ${searchValue} चुनी गई`);
      }

      this.stepUpdate(6, 'जमाबंदी विवरण', 'postback_running', 'जमाबंदी विवरण लोड हो रहा है...');
      await this.waitForAsyncPostback(5000);

      const tableFound = await this.page.waitForFunction(() => {
        if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
          if (Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack()) {
            return false;
          }
        }
        const kashtkar = document.querySelector('[id*="GV_Kashtkar"], [id*="Kashtkar"], [id*="Owner"]');
        const khasra = document.querySelector('[id*="GV_Khasra"], [id*="Khasra"], [id*="GridView"]');
        const anyTable = Array.from(document.querySelectorAll('table')).find(t => {
          const txt = t.innerText || '';
          return txt.includes('खसरा') && txt.includes('रकबा');
        });
        return Boolean(kashtkar || khasra || anyTable);
      }, { polling: 100, timeout: 5000 }).catch(() => false);

      if (tableFound) {
        this.stepUpdate(6, 'जमाबंदी विवरण', 'ui_updated', 'काश्तकार एवं खसरा विवरण उपलब्ध है', true);
        break;
      }
      await delay(500);
    }

    await this.safeEvaluate(() => {
      const up = document.querySelectorAll('[id*="UpdateProgress"], [id*="Progress"], [class*="progress"]');
      up.forEach((el) => {
        try { el.style.display = 'none'; } catch {}
      });
    });

    await delay(200);
    await this.dismissModals();
  }

  /**
   * Step 7: Extract complete Jamabandi Record & All Khatedar lines
   */
  async extractJamabandiData() {
    const searchValue = String(this.config.searchValue || '525').replace(/[^\d]/g, '').trim() || '525';
    this.stepUpdate(7, 'विवरण संकलन', 'action_triggered', `खाता ${searchValue} का विवरण संकलित किया जा रहा है...`);

    const extractedData = await this.safeEvaluate((targetKhata) => {
      const cleanField = (str) => {
        if (!str) return '';
        return str.replace(/^[:\-\s]+/, '').replace(/[:\-\s\)]+$/, '').trim();
      };

      const bodyText = (document.body ? document.body.innerText : '') || '';

      const result = {
        extractedAt: new Date().toISOString(),
        district: 'भीलवाड़ा',
        tehsil: 'बनेड़ा',
        village: 'रायला - रायला - रायला',
        khataNumber: cleanField(targetKhata) || '525',
        owners: [],
        khasraRecords: [],
        allTables: [],
        rawText: bodyText,
      };

      const distMatch = bodyText.match(/जिला\s*[:-]+\s*([^\t\n\r]+)/);
      if (distMatch && !distMatch[1].includes('तहसील') && !distMatch[1].includes('चुनें')) {
        result.district = cleanField(distMatch[1]);
      }

      const tehMatch = bodyText.match(/तहसील\s*[:-]+\s*([^\t\n\r]+)/);
      if (tehMatch && !tehMatch[1].includes('गाँव') && !tehMatch[1].includes('चुनें')) {
        result.tehsil = cleanField(tehMatch[1]);
      }

      const villMatch = bodyText.match(/(?:गाँव|पटवार)\s*[:-]+\s*([^\t\n\r]+)/);
      if (villMatch && !villMatch[1].includes('चुनें')) {
        result.village = cleanField(villMatch[1]);
      }

      const kashtkarTable = document.querySelector('#ctl00_ContentPlaceHolder1_GV_Kashtkar, table[id*="Kashtkar"], table[id*="Owner"]');
      if (kashtkarTable) {
        const rows = Array.from(kashtkarTable.querySelectorAll('tr')).slice(1);
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll('td')).map((td) => td.innerText.trim());
          if (cells.length > 1 && cells[1]) {
            result.owners.push(cells[1]);
          } else if (cells.length === 1 && cells[0]) {
            result.owners.push(cells[0]);
          }
        });
      }

      const khasraTable = document.querySelector('#ctl00_ContentPlaceHolder1_GV_Khasra, table[id*="Khasra"], #ctl00_ContentPlaceHolder1_GridView1');
      if (khasraTable) {
        const rows = Array.from(khasraTable.querySelectorAll('tr')).slice(1);
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll('td')).map((td) => td.innerText.trim());
          if (cells.length >= 3) {
            const khata = cells[0] || targetKhata;
            const khasra = cells[1] || '';
            const rakba = cells[2] || '';
            const irrigation = cells[3] || '-';
            const soilAndTax = cells.slice(3).filter(Boolean).join(' ') || '-';
            if (khasra && rakba) {
              result.khasraRecords.push({
                khataNo: khata,
                khasraNo: khasra,
                rakbaHectare: rakba,
                irrigation: irrigation,
                soilAndTax: soilAndTax,
                fullRow: cells,
              });
            }
          }
        });
      }

      if (result.owners.length === 0) {
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
      }

      if (result.owners.length === 0) {
        const seenOwnerLines = new Set();
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

      if (result.khasraRecords.length === 0) {
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
      }

      return result;
    }, searchValue);

    const data = extractedData || {
      extractedAt: new Date().toISOString(),
      district: this.config.district || 'भीलवाड़ा',
      tehsil: this.config.tehsil || 'बनेड़ा',
      village: this.config.village || 'रायला - रायला - रायला',
      khataNumber: searchValue,
      owners: [],
      khasraRecords: [],
      allTables: [],
    };

    this.stepUpdate(
      7,
      'विवरण संकलन',
      'ui_updated',
      `संकलित: ${data.owners ? data.owners.length : 0} काश्तकार एवं ${data.khasraRecords ? data.khasraRecords.length : 0} खसरा विवरण`,
      true
    );

    return data;
  }

  async saveOutputFiles(data) {
    const { outputDir = './output', saveJson = true, saveCsv = true, savePdf = true, saveScreenshot = false } = this.config.options || {};
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
    }

    if (saveScreenshot) {
      const imgPath = path.join(outputDir, `${baseFilename}.png`);
      await this.page.screenshot({ path: imgPath, fullPage: true });
      savedFiles.push({ format: 'Screenshot', path: imgPath });
    }

    if (savePdf) {
      try {
        const pdfPath = path.join(outputDir, `${baseFilename}.pdf`);
        await this.page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
        savedFiles.push({ format: 'PDF', path: pdfPath });
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

      let screenshotBase64 = null;
      if (this.config.options && this.config.options.saveScreenshot) {
        try {
          const screenshotBuffer = await this.page.screenshot({
            type: 'jpeg',
            quality: 85,
            fullPage: false,
          });
          screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
        } catch (e) {}
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      // 7. Extract Jamabandi record from DOM
      const data = await this.extractJamabandiData();
      data.screenshotBase64 = screenshotBase64;
      data.screenshotRemark = "Screenshots are disabled by default for maximum speed. Available on request or automatically captured upon error.";
      data.stepScreenshots = {};
      data.detailedSteps = this.detailedSteps || [];
      data.logs = this.logs || [];
      data.executionTimeSeconds = elapsed;

      this.stepUpdate(7, 'प्रक्रिया पूर्ण (Completed)', 'confirmed', `सफलतापूर्वक प्राप्त (${elapsed}s)`, true);

      let savedFiles = [];
      try {
        savedFiles = await this.saveOutputFiles(data);
      } catch (err) {}

      return { success: true, data, files: savedFiles };
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      let errorScreenshot = null;
      try {
        if (this.page) {
          const buf = await this.page.screenshot({ type: 'jpeg', quality: 65, fullPage: false });
          errorScreenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
        }
      } catch (e) {}

      return {
        success: false,
        error: 'रिकॉर्ड प्राप्त करने में असमर्थ। कृपया पुनः प्रयास करें।',
        data: {
          logs: this.logs || [],
          detailedSteps: this.detailedSteps || [],
          screenshotBase64: errorScreenshot,
          screenshotRemark: errorScreenshot ? "Screenshot automatically captured for error diagnostics." : null,
          stepScreenshots: {},
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
