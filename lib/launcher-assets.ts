export function launcherAssetUrl(url: string): string {
  const assetBase = window.xneonAssetBase
  return assetBase ? url.replace(/^(avatar|xnl-theme):\/\//, assetBase + "$1/") : url
}

