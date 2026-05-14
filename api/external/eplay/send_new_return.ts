import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseReturnFromEplay, verifyEplayCredential } from '../../lib/eplay.js';
import { cleanAndParseJSON } from '../../lib/helpers.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const header = req.headers['x-api-key'] as string | null;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const credential = token ? await verifyEplayCredential(token) : null;
    if (!credential) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const body = cleanAndParseJSON(req.body);
    if (!body) {
      return res.status(400).json({ message: 'Error in processing the request body payload.' });
    }

    const result = await parseReturnFromEplay(body.return, credential);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
