// Injects a small "back to portal" banner right after <body> in proxied
// HTML pages, so every module gets consistent navigation without any of
// the module repos needing to know the gateway exists. Non-HTML responses
// (css/json/xlsx/pptx/...) are never touched - see proxyRequest.js.
const BANNER_HEIGHT = '32px';

function injectPortalBanner(html, moduleLabel) {
  // position:fixed removes the banner from the target page's own layout
  // flow entirely - without this, a target page whose body uses
  // display:flex/grid (e.g. nissan-report-tool centers its card with
  // `body{display:flex}`) turns the banner into a flex sibling and it
  // renders as a sidebar instead of a top bar. The `!important` body
  // margin-top pushes real content down so it isn't hidden underneath.
  const banner = `<style>body{margin-top:${BANNER_HEIGHT} !important;}</style>
<div style="position:fixed;top:0;left:0;right:0;height:${BANNER_HEIGHT};box-sizing:border-box;z-index:2147483647;background:#20232a;color:#fff;padding:0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;display:flex;align-items:center;gap:8px;">
  <a href="/" style="color:#fff;text-decoration:none;font-weight:600;">&#127968; Muze Ops Portal</a>
  <span style="opacity:0.5">/</span>
  <span style="opacity:0.85">${moduleLabel}</span>
</div>`;

  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (match) => `${match}\n${banner}`);
  }
  // No <body> tag found (unexpected/partial HTML) - prepend instead of dropping the banner.
  return banner + html;
}

module.exports = { injectPortalBanner };
