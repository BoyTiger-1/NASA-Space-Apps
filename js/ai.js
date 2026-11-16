// Earthset: optional AI assistant for the "Ask" bar (Google Gemini).
// Two ways to switch it on, and the key never goes into this repository:
//  1. Hosted on Vercel with GEMINI_API_KEY set: the page calls /api/ask and the
//     key stays on the server, so every visitor gets the assistant.
//  2. A visitor pastes their own key under More > AI assistant; it stays in
//     their browser and is sent only to Google.
// Without either, Earthset uses its offline parser. All numbers shown come from
// Earthset's own NASA-data calculations; the model only (1) turns a question into
// settings and (2) words a short summary of numbers we hand it.
import { PARSE_SCHEMA, parsePrompt, explainPrompt, gemini } from './ai-prompts.js';

const STORE = 'earthset.aikey';
export function getKey() { try { return localStorage.getItem(STORE) || ''; } catch (e) { return ''; } }
export function setKey(k) { try { k ? localStorage.setItem(STORE, k) : localStorage.removeItem(STORE); return true; } catch (e) { return false; } }

// The /api/ask endpoint only exists on a server deployment (e.g. Vercel), not on GitHub Pages or a plain file server.
let serverOk = !/github\.io$/.test(location.hostname) && location.protocol !== 'file:' && !['localhost', '127.0.0.1'].includes(location.hostname);
export function aiMode() { return getKey() ? 'key' : serverOk ? 'server' : null; }

async function viaServer(payload) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch('api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 || r.status === 405 || r.status === 501) { serverOk = false; throw new Error('the AI assistant is not set up on this site'); }
    if (!r.ok) throw new Error(j.error || 'AI error ' + r.status);
    return j.result;
  } catch (e) { if (e.name === 'AbortError') throw new Error('the AI took too long to answer'); throw e; }
  finally { clearTimeout(t); }
}

// Turn a free-form question into Earthset settings.
export function aiParse(question, sites, todayIso) {
  const key = getKey();
  if (key) return gemini(key, parsePrompt(question, sites.map(s => ({ id: s.id, name: s.name, group: s.group })), todayIso), PARSE_SCHEMA);
  return viaServer({ mode: 'parse', question, today: todayIso, custom: sites.filter(s => s.custom).map(s => ({ id: s.id, name: s.name, group: s.group })) });
}

// Word a short answer from numbers Earthset computed. The model must not invent numbers.
export function aiExplain(question, facts) {
  const key = getKey();
  if (key) return gemini(key, explainPrompt(question, facts), null);
  return viaServer({ mode: 'explain', question, facts });
}
