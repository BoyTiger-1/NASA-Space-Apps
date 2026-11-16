// Earthset: prompts for the optional Gemini assistant, shared by the browser
// (visitor's own key) and the Vercel function in /api/ask.js (key kept on the server).

export const MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite'];

export const PARSE_SCHEMA = {
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

// sites: [{ id, name, group }]
export function parsePrompt(question, sites, todayIso) {
  const list = sites.map(s => `${s.id}: ${s.name} (${s.group})`).join('\n');
  return `You convert questions about lunar landings into settings for a planning tool. Today is ${todayIso}.
Available sites (id: name):
${list}

Rules: only use ids from the list. Put a site in "sites" only if the user names it; for "which is best/safest" questions leave "sites" empty and set best=true (and southPole=true if they mean the south pole). Dates without a year mean the next such date after today. "two weeks" = 14 days, "a month" = 28 days. A "slip" or "delay" is days added to the planned landing date. Leave fields null if the question does not say.

Question: ${question}`;
}

export function explainPrompt(question, facts) {
  return `You are the voice of Earthset, a lunar landing-window tool. Answer the user's question in at most 3 short, plain sentences for a general audience.
Use ONLY the facts below (computed from NASA data). Do not invent or round differently any number. Mention which sites are GO or NO-GO and the main reason. No markdown.

Question: ${question}
Facts (JSON): ${JSON.stringify(facts)}`;
}

// One Gemini request with fallback to the lighter model when busy or rate-limited.
export async function gemini(key, prompt, schema, ms = 15000, fetchImpl = fetch) {
  let last;
  for (const model of MODELS) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } } };
      if (schema) { body.generationConfig.responseMimeType = 'application/json'; body.generationConfig.responseSchema = schema; }
      const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(r.status === 429 ? 'the free AI quota is used up for now, try again in a minute' : r.status === 400 || r.status === 403 ? 'the API key was not accepted' : r.status >= 500 ? 'the AI service is busy right now' : 'AI error ' + r.status); e.status = r.status; throw e; }
      const txt = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('').trim();
      if (!txt) throw Object.assign(new Error('empty reply'), { status: 502 });
      return schema ? JSON.parse(txt) : txt;
    } catch (e) {
      last = e.name === 'AbortError' ? Object.assign(new Error('the AI took too long to answer'), { status: 408 }) : e;
      if (!(last.status === 429 || last.status >= 500 || last.status === 404 || last.status === 408)) break;
    } finally { clearTimeout(t); }
  }
  throw last;
}
