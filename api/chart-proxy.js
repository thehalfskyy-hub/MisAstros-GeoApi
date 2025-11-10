// api/chart-proxy.js
module.exports = async (req, res) => {
  try {
    const u = (req.query && req.query.u) || (req.url.split('?u=')[1] || '');
    if (!u) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Missing u param' }));
    }
    // Solo permitimos imágenes SVG/PNG de AstrologyAPI (o su S3)
    const url = decodeURIComponent(u);
    if (!/^https:\/\/(json\.astrologyapi\.com|s3\.ap-south-1\.amazonaws\.com)\//.test(url)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Blocked host' }));
    }

    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) {
      res.statusCode = r.status || 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Upstream error', status: r.status }));
    }

    // Copiamos content-type tal cual (image/svg+xml o image/png)
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Type', ct);
    // Permitir que Shopify lo embeba sin CORS problemas
    res.setHeader('Access-Control-Allow-Origin', '*');

    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Proxy error', detail: String(e.message || e) }));
  }
};
