const LAUNCHER_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: oklch(0.08 0.01 260);
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: oklch(1 0 0);
    overflow: hidden;
  }
  .bg-glow {
    position: fixed;
    width: 600px;
    height: 600px;
    border-radius: 50%;
    filter: blur(150px);
    opacity: 0.12;
    pointer-events: none;
  }
  .bg-glow.primary { background: oklch(0.65 0.22 40); top: -200px; left: -200px; }
  .bg-glow.accent { background: oklch(0.6 0.25 80); bottom: -200px; right: -200px; }
  .card {
    position: relative;
    z-index: 1;
    background: oklch(0.09 0.01 260);
    border: 1px solid oklch(0.17 0.01 260);
    border-radius: 0.75rem;
    padding: 3rem 2.5rem;
    text-align: center;
    max-width: 420px;
    width: 90%;
    box-shadow: 0 0 80px oklch(0.65 0.22 40 / 0.06);
  }
  .icon-wrap {
    width: 72px;
    height: 72px;
    margin: 0 auto 1.5rem;
    background: oklch(0.14 0.01 260);
    border-radius: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid oklch(0.17 0.01 260);
  }
  .icon-wrap svg { width: 36px; height: 36px; }
  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    background: linear-gradient(135deg, #f97316 0%, #fbbf24 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  p {
    color: oklch(0.45 0 0);
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 2rem;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.75rem;
    border-radius: 0.75rem;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.2s ease;
    background: linear-gradient(135deg, #f97316 0%, #fbbf24 100%);
    color: oklch(0.1 0 0);
    box-shadow: 0 4px 20px oklch(0.65 0.22 40 / 0.3);
  }
  .btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 30px oklch(0.65 0.22 40 / 0.4);
  }
  .error .icon-wrap {
    background: oklch(0.55 0.22 40 / 0.1);
    border-color: oklch(0.55 0.22 40 / 0.2);
  }
  .error .bg-glow.primary { background: oklch(0.55 0.22 40); }
  .error .card { box-shadow: 0 0 80px oklch(0.55 0.22 40 / 0.06); }
  .error-detail {
    background: oklch(0.55 0.22 40 / 0.08);
    border: 1px solid oklch(0.55 0.22 40 / 0.15);
    border-radius: 0.75rem;
    padding: 0.75rem 1rem;
    margin-bottom: 2rem;
    font-size: 0.85rem;
    color: oklch(0.45 0 0);
    word-break: break-word;
  }
  .btn-secondary {
    background: oklch(0.14 0.01 260);
    color: oklch(0.45 0 0);
    box-shadow: none;
  }
  .btn-secondary:hover {
    background: oklch(0.17 0.01 260);
    color: oklch(1 0 0);
    transform: none;
  }
`

export function callbackSuccessPage(provider: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${provider} подключён</title>
  <style>${LAUNCHER_STYLES}</style>
</head>
<body>
  <div class="bg-glow primary"></div>
  <div class="bg-glow accent"></div>
  <div class="card">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    </div>
    <h1>${provider} подключён</h1>
    <p>Хранилище успешно подключено.<br>Можете закрыть это окно.</p>
    <button class="btn" onclick="window.close()">Закрыть окно</button>
  </div>
</body>
</html>`
}

export function callbackErrorPage(provider: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ошибка подключения</title>
  <style>${LAUNCHER_STYLES}</style>
</head>
<body class="error">
  <div class="bg-glow primary"></div>
  <div class="bg-glow accent"></div>
  <div class="card">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    </div>
    <h1>Ошибка подключения</h1>
    <p>Не удалось подключить ${provider}</p>
    ${error ? `<div class="error-detail">${error}</div>` : ""}
    <button class="btn btn-secondary" onclick="window.close()">Закрыть окно</button>
  </div>
</body>
</html>`
}
