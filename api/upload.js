module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Filename');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const password = req.headers.authorization?.replace('Bearer ', '');
  if (password !== (process.env.ADMIN_PASSWORD || 'dripping2026')) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'Blob storage not configured' });

  const filename = (req.headers['x-filename'] || 'rider.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const blobRes = await fetch(`https://blob.vercel-storage.com/riders/${filename}`, {
      method: 'PUT',
      headers: {
        'authorization': `Bearer ${token}`,
        'x-api-version': '7',
        'x-content-type': 'application/pdf',
        'x-access': 'public',
        'content-type': 'application/octet-stream',
      },
      body: buffer,
    });

    const result = await blobRes.json();
    if (!blobRes.ok) return res.status(500).json({ error: result.error || 'Upload failed' });

    return res.status(200).json({ ok: true, url: result.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
