import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseCancellationFromEplay } from '../../lib/eplay.js';
import { cleanAndParseJSON } from '../../lib/helpers.js';

function verifyToken(token: string | null): boolean {
  return token === `Bearer ${process.env.EPLAY_TOKEN}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const token = req.headers['x-api-key'] as string | null;
    if (!token || !verifyToken(token)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const body = cleanAndParseJSON(req.body);
    if (!body) {
      return res.status(400).json({ message: 'Error in processing the request body payload.' });
    }

    const result = await parseCancellationFromEplay(body.cancellation);
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
