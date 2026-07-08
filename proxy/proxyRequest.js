const { Readable } = require('stream');
const { injectPortalBanner } = require('./portalBanner');

// Generic streaming reverse proxy. Streams both directions so binary
// downloads (.xlsx/.pptx) and their Content-Type/Content-Disposition
// headers pass through unmodified - never buffer/re-encode the body here.
// The one exception is text/html responses when `bannerLabel` is set: those
// are buffered (pages are small) so the portal nav banner can be injected -
// see portalBanner.js.
async function proxyRequest(req, res, opts) {
  const { targetBase, stripPrefix = '', injectHeaders = {}, injectQuery = {}, timeoutMs = 55000, bannerLabel } = opts;

  const incomingUrl = new URL(req.originalUrl, 'http://placeholder');
  let path = incomingUrl.pathname;
  if (stripPrefix && path.startsWith(stripPrefix)) {
    path = path.slice(stripPrefix.length) || '/';
  }

  const targetUrl = new URL(path, targetBase);
  incomingUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));
  Object.entries(injectQuery).forEach(([k, v]) => targetUrl.searchParams.set(k, v));

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    // accept-encoding: forwarding the browser's value (e.g. "gzip, br")
    // disables undici's automatic response decompression, so we'd receive
    // still-compressed bytes in upstreamResp.body - but we strip
    // content-encoding on the way back out (see below), which would then
    // serve compressed bytes to the browser as if they were plain text.
    // Omitting it lets fetch negotiate + auto-decompress transparently.
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(k)) continue;
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  Object.entries(injectHeaders).forEach(([k, v]) => headers.set(k, v));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const hasBody = !['GET', 'HEAD'].includes(req.method);

  try {
    const upstreamResp = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = upstreamResp.headers.get('content-type') || '';
    const isHtml = bannerLabel && contentType.includes('text/html');

    res.status(upstreamResp.status);
    upstreamResp.headers.forEach((value, key) => {
      if (['content-encoding', 'transfer-encoding', 'connection'].includes(key)) return;
      if (isHtml && key === 'content-length') return; // body length changes once we inject the banner
      res.setHeader(key, value);
    });

    if (isHtml) {
      const html = await upstreamResp.text();
      return res.send(injectPortalBanner(html, bannerLabel));
    }

    if (!upstreamResp.body) {
      return res.end();
    }
    Readable.fromWeb(upstreamResp.body).pipe(res);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).send('Upstream request timed out');
    }
    console.error('Proxy error:', err.message);
    return res.status(502).send('Bad gateway');
  }
}

module.exports = proxyRequest;
