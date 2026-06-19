export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL parameter ontbreekt' });

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Ongeldige URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Alleen HTTP/HTTPS URLs zijn toegestaan' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/xml, text/xml, text/plain, */*',
        'User-Agent': 'XSD-Visualizer/1.0',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!response.ok) {
      let msg = `HTTP ${response.status}: ${response.statusText}`;
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('json')) {
        try { const j = await response.json(); msg = j.error || j.message || msg; } catch {}
      }
      return res.status(502).json({ error: msg });
    }

    const contentType = response.headers.get('content-type') || '';

    // Content-Type already tells us it's HTML
    if (contentType.includes('text/html')) {
      return res.status(422).json({
        error: `De server stuurt een HTML pagina terug (geen XSD). De URL vereist mogelijk authenticatie of is niet publiek bereikbaar vanaf Vercel's servers.`,
        hint: 'html',
      });
    }

    const text = await response.text();
    const trimmed = text.trimStart();

    // Detect HTML by content
    const lc = trimmed.slice(0, 200).toLowerCase();
    if (lc.startsWith('<!doctype') || lc.startsWith('<html') ||
        (lc.startsWith('<?xml') && lc.includes('<html'))) {
      return res.status(422).json({
        error: `De URL geeft een HTML pagina terug in plaats van XSD. De bron vereist mogelijk inloggen of is alleen intern bereikbaar.`,
        hint: 'html',
      });
    }

    // Must look like XML/XSD
    if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<xs:') &&
        !trimmed.startsWith('<xsd:') && !trimmed.startsWith('<schema') &&
        !trimmed.includes('XMLSchema')) {
      return res.status(422).json({
        error: `De URL lijkt geen XSD/XML te bevatten (onbekend formaat).`,
      });
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(text);

  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'Verzoek verlopen na 15 seconden' });
    }
    return res.status(502).json({ error: `Kan URL niet bereiken: ${err.message}` });
  }
}
