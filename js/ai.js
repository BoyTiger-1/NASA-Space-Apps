// Earthset: optional AI assistant for the "Ask" bar (Google Gemini API).
// The key is never stored in this repository: a visitor pastes their own key,
// which stays in their browser. Without a key, Earthset uses its offline parser.
// All numbers shown come from Earthset's own NASA-data calculations; the model
// only (1) turns a question into settings and (2) words a short summary of
// numbers we hand it.
// SI disclosure: written with the assistance of an SI coding tool (Claude).

// Try the main model first; if it is rate-limited or busy, fall back to the lighter one.
const MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite'];
const URL_ = (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
const STORE = 'earthset.aikey';

export function getKey() { try { return localStorage.getItem(STORE) || ''; } catch (e) { return ''; } }
export function setKey(k) { try { k ? localStorage.setItem(STORE, k) : localStorage.removeItem(STORE); return true; } catch (e) { return false; } }

async function call1(model, key, prompt, schema, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } } };
    if (schema) { body.generationConfig.responseMimeType = 'application/json'; body.generationConfig.responseSchema = schema; }
    const r = await fetch(URL_(model, key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(r.status === 429 ? 'the free AI quota is used up for now, try again in a minute' : r.status === 400 || r.status === 403 ? 'the API key was not accepted' : r.status >= 500 ? 'the AI service is busy right now' : 'AI error ' + r.status); e.status = r.status; throw e; }
    const txt = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('').trim();
    if (!txt) throw new Error('empty reply');
    return schema ? JSON.parse(txt) : txt;
  } catch (e) { if (e.name === 'AbortError') { const x = new Error('the AI took too long to answer'); x.status = 408; throw x; } throw e; }
  finally { clearTimeout(t); }
}
async function call(key, prompt, schema, ms = 15000) {
  let last;
  for (const m of MODELS) {
    try { return await call1(m, key, prompt, schema, ms); }
    catch (e) { last = e; if (!(e.status === 429 || e.status >= 500 || e.status === 404 || e.status === 408)) break; }
  }
  throw last;
}

const PARSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sites: { type: 'ARRAY', items: { type: 'STRING' }, description: 'ids of sites the user explicitly named, max 4, in the order mentioned; empty if the user asks for a recommendation without naming sites' },
    date: { type: 'STRING', nullable: true, description: 'landing date YYYY-MM-DD, or null if not given' },
    days: { type: 'INTEGER', nullable: true, description: 'mission length in days, or null' },
    slip: { type: 'INTEGER', nullable: true, description: 'launch slip / delay in days, or null' },
    best: { type: 'BOOLEAN', description: 'true if the user asks which site is best, safest, or for a recommendation' },
    southPole: { type: 'BOOLEAN', description: 'true if the user limits the question to the south pole / polar sites' },
  },
  required: ['sites', 'best', 'southPole'],
};

// Turn a free-form question into Earthset settings.
export function aiParse(key, question, sites, todayIso) {
  const list = sites.map(s => `${s.id}: ${s.name} (${s.group})`).join('\n');
  const prompt = `You convert questions about lunar landings into settings for a planning tool. Today is ${todayIso}.
Available sites (id: name):
${list}

Rules: only use ids from the list. Put a site in "sites" only if the user names it; for "which is best/safest" questions leave "sites" empty and set best=true (and southPole=true if they mean the south pole). Dates without a year mean the next such date after today. "two weeks" = 14 days, "a month" = 28 days. A "slip" or "delay" is days added to the planned landing date. Leave fields null if the question does not say.

Question: ${question}`;
  return call(key, prompt, PARSE_SCHEMA);
}

// Word a short answer from numbers Earthset computed. The model must not invent numbers.
export function aiExplain(key, question, facts) {
  const prompt = `You are the voice of Earthset, a lunar landing-window tool. Answer the user's question in at most 3 short, plain sentences for a general audience.
Use ONLY the facts below (computed from NASA data). Do not invent or round differently any number. Mention which sites are GO or NO-GO and the main reason. No markdown.

Question: ${question}
Facts (JSON): ${JSON.stringify(facts)}`;
  return call(key, prompt, null);
}
