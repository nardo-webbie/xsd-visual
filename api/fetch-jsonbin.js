export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { binId, key } = req.query;

  if (!binId || !/^[a-f0-9]{24}$/i.test(binId.trim())) {
    return res.status(400).json({ error: 'Ongeldig Bin ID (verwacht 24 hex tekens)' });
  }

  const url = `https://api.jsonbin.io/v3/b/${binId.trim()}/latest`;
  const headers = { 'Content-Type': 'application/json' };
  if (key && key.trim()) headers['X-Master-Key'] = key.trim();

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 401) {
      return res.status(401).json({ error: 'Toegang geweigerd — bin is privé, voer een geldige Master Key in' });
    }
    if (response.status === 404) {
      return res.status(404).json({ error: `Bin '${binId}' niet gevonden` });
    }
    if (!response.ok) {
      return res.status(502).json({ error: `JSONBin antwoordde met HTTP ${response.status}` });
    }

    const json = await response.json();
    const record = json.record;

    // Try to extract XSD from the record
    let xsd = null;

    // Case 1: record itself is a string containing XSD
    if (typeof record === 'string') {
      xsd = record;
    }
    // Case 2: record has a known XSD property
    else if (typeof record === 'object' && record !== null) {
      const xsdKeys = ['xsd', 'schema', 'content', 'data', 'xml', 'body'];
      for (const k of xsdKeys) {
        if (typeof record[k] === 'string' && record[k].trim().length > 0) {
          xsd = record[k];
          break;
        }
      }
      // Case 3: only one string property in the record — use it
      if (!xsd) {
        const strProps = Object.entries(record).filter(([, v]) => typeof v === 'string' && v.trim().length > 50);
        if (strProps.length === 1) xsd = strProps[0][1];
      }
    }

    if (!xsd) {
      return res.status(422).json({
        error: 'Geen XSD gevonden in de bin. Sla de XSD op als string onder een key zoals "xsd" of "schema".',
        hint: 'structure',
        keys: typeof record === 'object' ? Object.keys(record) : [],
      });
    }

    // Validate it looks like XML/XSD
    const trimmed = xsd.trimStart();
    if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<xs:') &&
        !trimmed.startsWith('<xsd:') && !trimmed.includes('XMLSchema')) {
      return res.status(422).json({
        error: 'De gevonden string lijkt geen geldig XSD schema te zijn',
      });
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('X-Bin-Id', binId);
    res.setHeader('X-Bin-Name', json.metadata?.name || '');
    return res.status(200).send(xsd);

  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'JSONBin verzoek verlopen na 10 seconden' });
    }
    return res.status(502).json({ error: `Fout bij ophalen: ${err.message}` });
  }
}
