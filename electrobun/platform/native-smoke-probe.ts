/** Только явный нативный E2E: настоящий renderer вызывает существующий IPC, без mock API. */
export function startNativeSmokeProbe(evaluate: (script: string) => void) {
  const endpoint = process.env.XNLC_NATIVE_E2E_ENDPOINT
  const nonce = process.env.XNLC_NATIVE_E2E_NONCE
  if (!endpoint || !nonce) return () => {}
  const url = new URL(endpoint)
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || !/^[a-f0-9]{32}$/.test(nonce) || url.pathname !== "/" + nonce) throw new Error("Unsafe native E2E endpoint")
  const timer = setInterval(() => evaluate(`void (async () => {
    if (window.__xneonNativeProbe || !window.electrobunAPI || !document.querySelector('[data-ui="app-div-1"]')) return;
    window.__xneonNativeProbe = true;
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let report;
    try {
      const error = await window.electrobunAPI.startupReady(); if (error) throw Error(error);
      const settings = await window.electrobunAPI.getSettings(['theme']);
      if (!settings || typeof settings !== 'object') throw Error('IPC did not return settings');
      document.querySelector('[data-component="onboarding-modal"] [data-modal-close]')?.click();
      await pause(500);
      const button = document.querySelector('[data-sidebar-item="settings"] button');
      if (!button) throw Error('Settings navigation is missing');
      button.click();
      let visible = false;
      for (let i = 0; i < 40 && !visible; i++) { await pause(250); visible = !!document.querySelector('#settings-page')?.getBoundingClientRect().width; }
      if (!visible) throw Error('Settings page did not render after navigation');
      report = { nonce: ${JSON.stringify(nonce)}, status: 'PASS', userAgent: navigator.userAgent, ipc: true, rendered: true, settingsNavigation: true };
    } catch (error) { report = { nonce: ${JSON.stringify(nonce)}, status: 'FAIL', error: String(error) }; }
    await fetch(${JSON.stringify(endpoint)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
  })()`), 1000)
  timer.unref()
  return () => clearInterval(timer)
}
