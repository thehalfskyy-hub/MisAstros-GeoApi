// api/chart-proxy.js
module.exports = async (req, res) => {
  try {
    const u = (req.query && req.query.u) || (new URL(req.url, 'http://x')).searchParams.get('u');
    if (!u) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Falta parámetro u (URL del SVG)' }));
    }
    const r = await fetch(u);
    if (!r.ok) {
      res.statusCode = r.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: `Upstream ${r.status}` }));
    }
    // CORS abierto para que ningún script marque error
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min
    // Copiamos content-type del origen (debería ser image/svg+xml)
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/svg+xml');
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    return res.end(buf);
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Proxy error', detail: e.message }));
  }
};
