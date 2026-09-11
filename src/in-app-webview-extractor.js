/**
 * Apna Khata (Rajasthan) In-App Native WebView Automation Engine
 * =============================================================
 * Zero-Server Client-Side Script for Android, Flutter, React Native & iOS.
 * Runs directly inside a hidden native WebView on the user's phone.
 * Runs directly inside a visible or hidden native WebView on the user's phone.
 * 
 * Execution Time: ~10 - 15 Seconds (No cloud latency, no server costs)
 * Features:
 * - Read-Only / View-Only Mode: Prevents user touch interference while watching progress.
 * - Live Floating HUD: Shows real-time step badges directly on the WebView screen.
 * - Execution Time: ~10 - 15 Seconds (Zero server latency).
 */

(function () {
  // 1. Configurable Parameters (passed dynamically by host mobile app)
  const PARAMS = window.APNA_KHATA_PARAMS || {
    district: 'भीलवाड़ा',
    tehsil: 'बनेड़ा',
    village: 'रायला - रायला - रायला',
    khata: '525',
    showLiveHud: true,      // Set to true to show a sleek progress banner on the webpage
    lockUserTouches: true,  // Set to true to make WebView non-editable/view-only
  };

  // 2. Universal Mobile App Bridge Communicator
  // 2. Lock User Touches & Show Live Status HUD
  function setupViewOnlyMode() {
    if (PARAMS.lockUserTouches && !document.getElementById('apnakhata_touch_blocker')) {
      // Create transparent touch interceptor overlay
      const overlay = document.createElement('div');
      overlay.id = 'apnakhata_touch_blocker';
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.zIndex = '999998';
      overlay.style.background = 'transparent';
      overlay.style.cursor = 'wait';
      // Prevent user touch/click/drag from interfering with automation
      overlay.addEventListener('click', (e) => e.stopPropagation(), true);
      overlay.addEventListener('touchstart', (e) => e.stopPropagation(), true);
      overlay.addEventListener('mousedown', (e) => e.stopPropagation(), true);
      document.body.appendChild(overlay);
    }

    if (PARAMS.showLiveHud && !document.getElementById('apnakhata_hud')) {
      const hud = document.createElement('div');
      hud.id = 'apnakhata_hud';
      hud.style.position = 'fixed';
      hud.style.top = '10px';
      hud.style.left = '50%';
      hud.style.transform = 'translateX(-50%)';
      hud.style.background = 'rgba(11, 60, 109, 0.95)';
      hud.style.color = '#ffffff';
      hud.style.padding = '10px 18px';
      hud.style.borderRadius = '30px';
      hud.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
      hud.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      hud.style.fontSize = '13px';
      hud.style.fontWeight = '600';
      hud.style.zIndex = '999999';
      hud.style.display = 'flex';
      hud.style.alignItems = 'center';
      hud.style.gap = '8px';
      hud.style.pointerEvents = 'none';
      hud.innerHTML = `
        <span style="display:inline-block;width:10px;height:10px;background:#28a745;border-radius:50%;animation:pulse 1s infinite alternate;"></span>
        <span id="apnakhata_hud_text">⚡ जमाबंदी लोड हो रही है...</span>
      `;
      document.body.appendChild(hud);

      // Add pulse animation style
      const style = document.createElement('style');
      style.textContent = `
        @keyframes pulse { from { opacity: 0.4; } to { opacity: 1; transform: scale(1.2); } }
      `;
      document.head.appendChild(style);
    }
  }

  function updateHud(step, message) {
    const textEl = document.getElementById('apnakhata_hud_text');
    if (textEl) {
      textEl.textContent = `[${step}/7] ${message}`;
    }
  }

  // 3. Universal Mobile App Bridge Communicator
  function sendToApp(payload) {
    const jsonStr = JSON.stringify(payload);
    console.log('[ApnaKhataAppBridge]', jsonStr);

    // Android Native JavascriptInterface
    if (window.AndroidBridge && typeof window.AndroidBridge.postMessage === 'function') {
      window.AndroidBridge.postMessage(jsonStr);
    }
    // Flutter WebView JavaScriptChannel
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === 'function') {
      window.FlutterBridge.postMessage(jsonStr);
    }
    // React Native WebView
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      window.ReactNativeWebView.postMessage(jsonStr);
    }
    // iOS WKWebView
    if (
      window.webkit &&
      window.webkit.messageHandlers &&
      window.webkit.messageHandlers.AppBridge &&
      typeof window.webkit.messageHandlers.AppBridge.postMessage === 'function'
    ) {
      window.webkit.messageHandlers.AppBridge.postMessage(payload);
    }
  }

  function reportProgress(step, message) {
    updateHud(step, message);
    sendToApp({ type: 'progress', step: step, message: message });
  }

  function reportSuccess(data) {
    updateHud(7, '✅ जमाबंदी विवरण प्राप्त हुआ!');
    sendToApp({ type: 'success', status: 'success', data: data });
  }

  function reportError(errorMsg) {
    updateHud('!', `⚠️ ${errorMsg}`);
    sendToApp({ type: 'error', status: 'error', message: errorMsg });
  }

  // 3. Helper Utility Functions
  // 4. Helper Utility Functions
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForCondition(fn, timeoutMs = 15000, intervalMs = 100) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        try {
          const res = fn();
          if (res) return resolve(res);
        } catch (e) {}
        if (Date.now() - startTime > timeoutMs) {
          return reject(new Error(`Timeout waiting for condition (${timeoutMs}ms)`));
        }
        setTimeout(check, intervalMs);
      };
      check();
    });
  }

  function triggerPostBack(controlId, argument = '') {
    if (typeof window.__doPostBack === 'function') {
      setTimeout(() => {
        try {
          window.__doPostBack(controlId, argument);
        } catch (e) {
          console.error('PostBack error:', e);
        }
      }, 0);
    }
  }

  // 4. Main Step-by-Step Extractor Workflow
  // 5. Main Step-by-Step Extractor Workflow
  async function runExtractor() {
    setupViewOnlyMode();
    const startTime = Date.now();
    try {
      reportProgress(1, 'Dismissing popups and navigating to Jamabandi portal...');
      reportProgress(1, 'पोर्टल से कनेक्ट किया जा रहा है...');

      // Step 1: Close initial popup if visible
      const closePopupBtn =
        document.querySelector('.custom-popup .close') ||
        document.querySelector('.custom-popup button') ||
        document.querySelector('#popupClose') ||
        document.querySelector('button[aria-label="Close"]');
      if (closePopupBtn) {
        closePopupBtn.click();
        await sleep(200);
      }

      // Step 1b: If on homepage, click "जमाबंदी नकल" button
      if (!window.location.href.includes('VillSelAll3.aspx')) {
        const jamabandiBtn =
          document.querySelector('a[href*="VillSelAll3"]') ||
          Array.from(document.querySelectorAll('a, button')).find(
            (el) => el.textContent && el.textContent.includes('जमाबंदी नकल')
          );
        if (jamabandiBtn) {
          jamabandiBtn.click();
          await sleep(1500);
        }
      }

      // Step 2: Select District
      reportProgress(2, `Selecting District: "${PARAMS.district}"...`);
      reportProgress(2, `जिला चुना जा रहा है: ${PARAMS.district}`);
      const distSelect = await waitForCondition(() =>
        document.querySelector('select[id*="DDL_District"], select[name*="DDL_District"]')
      );

      let distOption = Array.from(distSelect.options).find(
        (o) => o.text && (o.text.trim() === PARAMS.district.trim() || o.text.includes(PARAMS.district.trim()))
      );

      if (distOption && distSelect.value !== distOption.value) {
        distSelect.value = distOption.value;
        distSelect.dispatchEvent(new Event('change', { bubbles: true }));
        triggerPostBack(distSelect.name || distSelect.id, '');
      }

      // Step 3: Select Tehsil
      reportProgress(3, `Selecting Tehsil: "${PARAMS.tehsil}"...`);
      reportProgress(3, `तहसील चुनी जा रही है: ${PARAMS.tehsil}`);
      const tehsilSelect = await waitForCondition(() => {
        const sel = document.querySelector('select[id*="DDL_Tehsil"], select[name*="DDL_Tehsil"]');
        return sel && sel.options.length > 1 ? sel : null;
      }, 10000);

      let tehsilOption = Array.from(tehsilSelect.options).find(
        (o) => o.text && (o.text.trim() === PARAMS.tehsil.trim() || o.text.includes(PARAMS.tehsil.trim()))
      );

      if (tehsilOption && tehsilSelect.value !== tehsilOption.value) {
        tehsilSelect.value = tehsilOption.value;
        tehsilSelect.dispatchEvent(new Event('change', { bubbles: true }));
        triggerPostBack(tehsilSelect.name || tehsilSelect.id, '');
      }

      // Step 4: Select "चोसाला पद्धति जमाबंदी"
      reportProgress(4, 'Selecting "चोसाला पद्धति जमाबंदी"...');
      reportProgress(4, 'चोसाला पद्धति जमाबंदी चुनी जा रही है...');
      const chosalaRadio = await waitForCondition(() => {
        return (
          document.querySelector('#ctl00_ContentPlaceHolder1_old_RB') ||
          document.querySelector('input[type="radio"][value*="old"]') ||
          Array.from(document.querySelectorAll('input[type="radio"]')).find((r) => {
            const lbl = r.closest('td, div, label') || document.querySelector(`label[for="${r.id}"]`);
            return lbl && lbl.textContent.includes('चोसाला');
          })
        );
      }, 8000);

      if (chosalaRadio && !chosalaRadio.checked) {
        chosalaRadio.checked = true;
        chosalaRadio.click();
        triggerPostBack(chosalaRadio.name || chosalaRadio.id, '');
        await sleep(400);
      }

      // Step 5: Select Village (Latest Settlement)
      reportProgress(5, `Selecting Village: "${PARAMS.village}"...`);
      reportProgress(5, `गाँव चुना जा रहा है: ${PARAMS.village}`);
      const targetLink = await waitForCondition(() => {
        const baseName = PARAMS.village.split('-')[0].trim();
        const links = Array.from(document.querySelectorAll('a[id*="LinkButton"], a[href*="doPostBack"]'));
        const matched = links.filter((a) => a.textContent && a.textContent.includes(baseName));
        if (matched.length === 0) return null;

        let latest = matched[0];
        let maxYear = 0;
        matched.forEach((a) => {
          const match = a.textContent.match(/(\d{4})-(\d{4})/);
          if (match) {
            const endYear = parseInt(match[2], 10);
            if (endYear > maxYear) {
              maxYear = endYear;
              latest = a;
            }
          }
        });
        return latest;
      }, 10000);

      targetLink.click();
      await sleep(1000);

      // Step 6a: Select Radio "जमाबंदी की प्रतिलिपि"
      reportProgress(6, 'Selecting "जमाबंदी की प्रतिलिपि" radio...');
      reportProgress(6, 'जमाबंदी की प्रतिलिपि विकल्प चुना जा रहा है...');
      const jamabandiRadio = await waitForCondition(() => {
        return (
          document.querySelector('#ctl00_ContentPlaceHolder1_RB_Jamabandi') ||
          document.querySelector('input[type="radio"][id*="RB_Jamabandi"]') ||
          Array.from(document.querySelectorAll('input[type="radio"]')).find((r) => {
            const lbl = r.closest('td, div, label') || document.querySelector(`label[for="${r.id}"]`);
            return lbl && lbl.textContent.includes('जमाबंदी की प्रतिलिपि');
          })
        );
      }, 10000);

      if (jamabandiRadio && !jamabandiRadio.checked) {
        jamabandiRadio.checked = true;
        jamabandiRadio.click();
        triggerPostBack(jamabandiRadio.name || jamabandiRadio.id, '');
        await sleep(500);
      }

      // Step 6b: Select Radio "खाता से"
      reportProgress(6, 'Selecting "खाता से" radio & waiting for Khata list...');
      reportProgress(6, 'खाता संख्या विकल्प चुना जा रहा है...');
      const khataRadio = await waitForCondition(() => {
        return (
          document.querySelector('#ctl00_ContentPlaceHolder1_RB_Khata') ||
          document.querySelector('input[type="radio"][id*="RB_Khata"]') ||
          Array.from(document.querySelectorAll('input[type="radio"]')).find((r) => {
            const lbl = r.closest('td, div, label') || document.querySelector(`label[for="${r.id}"]`);
            return lbl && lbl.textContent.includes('खाता से');
          })
        );
      }, 8000);

      if (khataRadio && !khataRadio.checked) {
        khataRadio.checked = true;
        khataRadio.click();
        triggerPostBack(khataRadio.name || khataRadio.id, '');
        await sleep(600);
      }

      // Step 6c: Select/Input Khata Number
      reportProgress(6, `Setting Khata Number: ${PARAMS.khata}...`);
      reportProgress(6, `खाता संख्या ${PARAMS.khata} दर्ज की जा रही है...`);
      const khataSelect = await waitForCondition(() => {
        const sel = document.querySelector('select[id*="DDL_Khata"], select[name*="DDL_Khata"]');
        return sel && sel.options.length > 1 ? sel : null;
      }, 8000).catch(() => null);

      if (khataSelect) {
        let opt = Array.from(khataSelect.options).find(
          (o) => o.text.trim() === String(PARAMS.khata).trim() || o.value.trim() === String(PARAMS.khata).trim()
        );
        if (opt) {
          khataSelect.value = opt.value;
          khataSelect.dispatchEvent(new Event('change', { bubbles: true }));
          triggerPostBack(khataSelect.name || khataSelect.id, '');
        }
      }

      const khataInput = document.querySelector('#ctl00_ContentPlaceHolder1_TB_Khata, input[name*="TB_Khata"]');
      if (khataInput) {
        khataInput.value = String(PARAMS.khata);
        khataInput.dispatchEvent(new Event('input', { bubbles: true }));
        khataInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Wait for loading spinner to clear
      await waitForCondition(() => {
        const spinner = document.querySelector('#UpdateProgress1, div[id*="UpdateProgress"]');
        if (!spinner) return true;
        const style = window.getComputedStyle(spinner);
        return style.display === 'none' || spinner.getAttribute('aria-hidden') === 'true';
      }, 8000).catch(() => true);

      await sleep(1000);

      // Step 7: Parse Extracted Data from DOM
      reportProgress(7, 'Parsing extracted Jamabandi data...');
      reportProgress(7, 'काश्तकार व खसरा विवरण निकाला जा रहा है...');
      const extractedData = {
        district: PARAMS.district,
        tehsil: PARAMS.tehsil,
        village: PARAMS.village,
        khataNumber: PARAMS.khata,
        owners: [],
        khasraRecords: [],
        totalRakbaHectare: 0,
        executionTimeSeconds: ((Date.now() - startTime) / 1000).toFixed(2),
      };

      // 7a: Parse Kashtkaar / Owners
      const kashtkaarTable =
        document.querySelector('#ctl00_ContentPlaceHolder1_GV_Kashtkar') ||
        document.querySelector('table[id*="Kashtkar"]') ||
        document.querySelector('table[id*="Owner"]');

      if (kashtkaarTable) {
        const rows = Array.from(kashtkaarTable.querySelectorAll('tr')).slice(1);
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll('td')).map((td) => td.innerText.trim());
          if (cells.length > 1) {
            extractedData.owners.push(cells[1]);
          } else if (cells.length === 1 && cells[0]) {
            extractedData.owners.push(cells[0]);
          }
        });
      }

      // 7b: Parse Khasra Table
      const khasraTable =
        document.querySelector('#ctl00_ContentPlaceHolder1_GV_Khasra') ||
        document.querySelector('table[id*="Khasra"]') ||
        document.querySelector('#ctl00_ContentPlaceHolder1_GridView1');

      if (khasraTable) {
        const rows = Array.from(khasraTable.querySelectorAll('tr')).slice(1);
        let totalRakba = 0;
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll('td')).map((td) => td.innerText.trim());
          if (cells.length >= 3) {
            const rakba = cells[2] || '';
            const num = parseFloat(rakba);
            if (!isNaN(num)) totalRakba += num;

            extractedData.khasraRecords.push({
              khataNo: cells[0] || PARAMS.khata,
              khasraNo: cells[1] || '',
              rakbaHectare: rakba,
              irrigation: cells[3] || '',
              soilAndTax: cells[4] || '',
            });
          }
        });
        extractedData.totalRakbaHectare = totalRakba.toFixed(4);
      }

      reportSuccess(extractedData);
    } catch (err) {
      reportError(err.message || String(err));
    }
  }

  // Run automatically when injected into page
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    runExtractor();
  } else {
    window.addEventListener('DOMContentLoaded', runExtractor);
  }
})();

