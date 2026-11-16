// Earthset: Vercel serverless function for the "Ask" assistant.
// The Gemini key lives in the GEMINI_API_KEY environment variable on Vercel and
// never reaches the browser. The endpoint only accepts Earthset's two request
// types with size limits, so it cannot be used as a general chatbot proxy.
import { SITES } from '../js/sitelist.js';
import { PARSE_SCHEMA, parsePrompt, explainPrompt, gemini } from '../js/ai-prompts.js';

const hits = new Map(); // best-effort per-IP limit (per warm instance)
function limited(ip) {
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 60000);
  h.push(now); hits.set(ip, h); if (hits.size > 5000) hits.clear();
  return h.length > 12;
}
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(501).json({ error: 'AI assistant not configured' }); return; }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) { res.status(429).json({ error: 'too many questions, try again in a minute' }); return; }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || !str(b.question, 300)) { res.status(400).json({ error: 'bad request' }); return; }
  try {
    if (b.mode === 'parse') {
      const today = /^\d{4}-\d{2}-\d{2}$/.test(b.today || '') ? b.today : new Date().toISOString().slice(0, 10);
      const custom = Array.isArray(b.custom) ? b.custom.slice(0, 8).filter(s => s && str(s.id, 24) && str(s.name, 80)).map(s => ({ id: s.id, name: s.name, group: 'Custom' })) : [];
      const sites = SITES.map(s => ({ id: s.id, name: s.name, group: s.group })).concat(custom);
      res.status(200).json({ result: await gemini(key, parsePrompt(b.question, sites, today), PARSE_SCHEMA) });
    } else if (b.mode === 'explain') {
      const facts = JSON.stringify(b.facts || {});
      if (facts.length > 6000) { res.status(400).json({ error: 'bad request' }); return; }
      res.status(200).json({ result: await gemini(key, explainPrompt(b.question, JSON.parse(facts)), null) });
    } else res.status(400).json({ error: 'bad request' });
  } catch (e) {
    res.status(e.status === 429 ? 429 : 502).json({ error: String(e.message || 'AI error').slice(0, 120) });
  }
}
