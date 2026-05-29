module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (req.method === 'GET') {
    try {
      const resp = await fetch(`${KV_URL}/get/staff-data`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const { result } = await resp.json();
      if (!result) return res.status(200).json({ exists: false });
      return res.status(200).json({ exists: true, data: JSON.parse(result) });
    } catch (err) {
      return res.status(200).json({ exists: false, error: err.message });
    }
  }

  if (req.method === 'POST') {
    const password = req.headers.authorization?.replace('Bearer ', '');
    if (password !== (process.env.ADMIN_PASSWORD || 'dripping2026')) {
      return res.status(401).json({ error: 'Wrong password' });
    }

    try {
      const data = req.body;
      if (!data || !data._config) {
        return res.status(400).json({ error: 'Invalid data' });
      }

      const resp = await fetch(KV_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SET', 'staff-data', JSON.stringify(data)])
      });
      const result = await resp.json();

      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
