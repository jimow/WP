// Provider-agnostic LLM client. Supports Anthropic (Messages API), OpenAI and
// DeepSeek (both OpenAI-compatible Chat Completions). The rest of the app calls
// ai.complete() / ai.json() and doesn't care which provider is active.
import cfg from '../config.js';

function provider() {
  return (cfg.get('ai_provider') || 'anthropic').toLowerCase();
}

// OpenAI-compatible chat providers (OpenAI + DeepSeek share the same API shape).
const OPENAI_COMPATIBLE = {
  openai: { base: 'https://api.openai.com/v1', keyName: 'openai_api_key', defaultModel: 'gpt-4o' },
  // DeepSeek OpenAI-compatible base is https://api.deepseek.com (no /v1).
  deepseek: { base: 'https://api.deepseek.com', keyName: 'deepseek_api_key', defaultModel: 'deepseek-chat' },
};

async function anthropic({ system, prompt, maxTokens }) {
  const key = cfg.get('anthropic_api_key');
  if (!key) throw new Error('Anthropic API key not set (Settings > AI writer).');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.get('ai_model') || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic error: ${data?.error?.message || res.status}`);
  return data.content.map((b) => b.text || '').join('');
}

async function openaiCompatible(prov, { system, prompt, maxTokens }) {
  const conf = OPENAI_COMPATIBLE[prov];
  const key = cfg.get(conf.keyName);
  if (!key) throw new Error(`${prov} API key not set (Settings > AI writer).`);
  const model = cfg.get('ai_model') || conf.defaultModel;
  const messages = [
    { role: 'system', content: system || '' },
    { role: 'user', content: prompt },
  ];
  const call = (tokenParam) => fetch(`${conf.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, [tokenParam]: maxTokens }),
  });
  // DeepSeek uses max_tokens; newer OpenAI models require max_completion_tokens.
  let res = await call(prov === 'deepseek' ? 'max_tokens' : 'max_completion_tokens');
  let data = await res.json();
  if (!res.ok && /max_completion_tokens|max_tokens|Unsupported parameter/i.test(data?.error?.message || '')) {
    res = await call(prov === 'deepseek' ? 'max_completion_tokens' : 'max_tokens');
    data = await res.json();
  }
  if (!res.ok) throw new Error(`${prov} error: ${data?.error?.message || res.status}`);
  return data.choices?.[0]?.message?.content || '';
}

export const ai = {
  configured() {
    const p = provider();
    if (OPENAI_COMPATIBLE[p]) return !!cfg.get(OPENAI_COMPATIBLE[p].keyName);
    return !!cfg.get('anthropic_api_key');
  },

  async complete({ system, prompt, maxTokens = 4096 }) {
    const p = provider();
    if (OPENAI_COMPATIBLE[p]) return openaiCompatible(p, { system, prompt, maxTokens });
    return anthropic({ system, prompt, maxTokens });
  },

  // Multimodal: take an image (base64) + prompt, return text. Used by the
  // "replicate a design" feature so the AI can SEE the uploaded mockup.
  // - Anthropic: vision via image content block (claude-sonnet-4-*, opus-4-*).
  // - OpenAI: vision via image_url data URL (gpt-4o, gpt-4o-mini, gpt-5*).
  // - DeepSeek: NO vision in chat completions — throws a friendly error.
  async fromImage({ system, prompt, imageBase64, mimeType = 'image/png', maxTokens = 4096 }) {
    const p = provider();
    if (p === 'deepseek') throw new Error('DeepSeek has no vision model. Switch ai_provider to anthropic or openai in Settings to use design replication.');
    if (p === 'openai') {
      const key = cfg.get('openai_api_key');
      if (!key) throw new Error('OpenAI API key not set.');
      const model = cfg.get('ai_model_vision') || cfg.get('ai_model') || 'gpt-4o';
      const messages = [
        { role: 'system', content: system || '' },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ] },
      ];
      const call = (tp) => fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, [tp]: maxTokens }),
      });
      let res = await call('max_completion_tokens');
      let data = await res.json();
      if (!res.ok && /max_completion_tokens|max_tokens|Unsupported parameter/i.test(data?.error?.message || '')) {
        res = await call('max_tokens'); data = await res.json();
      }
      if (!res.ok) throw new Error(`OpenAI vision error: ${data?.error?.message || res.status}`);
      return data.choices?.[0]?.message?.content || '';
    }
    // Anthropic
    const key = cfg.get('anthropic_api_key');
    if (!key) throw new Error('Anthropic API key not set.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.get('ai_model_vision') || cfg.get('ai_model') || 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: prompt },
        ] }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Anthropic vision error: ${data?.error?.message || res.status}`);
    return data.content.map((b) => b.text || '').join('');
  },

  // JSON variant of fromImage().
  async jsonFromImage({ system, prompt, imageBase64, mimeType, maxTokens = 6000 }) {
    const raw = await this.fromImage({
      system: (system || '') + '\nRespond with ONLY valid JSON, no markdown, no commentary.',
      prompt, imageBase64, mimeType, maxTokens,
    });
    return parseJson(raw);
  },

  // Image generation (OpenAI Images API). Returns { bytes, contentType } ready
  // for wp.uploadMedia. Always uses the OpenAI key (Anthropic has no image API).
  async generateImage({ prompt, size = '1536x1024' }) {
    const key = cfg.get('openai_api_key');
    if (!key) throw new Error('Image generation needs an OpenAI API key (Settings → AI writer).');
    const model = cfg.get('image_model') || 'gpt-image-1';
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Image API error: ${data?.error?.message || res.status}`);
    const item = data.data[0];
    if (item.b64_json) return { bytes: Buffer.from(item.b64_json, 'base64'), contentType: 'image/png' };
    if (item.url) {
      const img = await fetch(item.url);
      return { bytes: Buffer.from(await img.arrayBuffer()), contentType: img.headers.get('content-type') || 'image/png' };
    }
    throw new Error('Image API returned no image');
  },

  // Ask for JSON and parse it robustly (strips markdown fences / prose). If the
  // model returns nothing (usually the output was cut off / consumed by
  // reasoning), retry ONCE with a larger token budget before giving up.
  async json({ system, prompt, maxTokens = 4096 }) {
    const sys = (system || '') + '\nRespond with ONLY valid JSON, no markdown, no commentary.';
    let raw = await this.complete({ system: sys, prompt, maxTokens });
    if (!raw || !raw.trim()) {
      raw = await this.complete({ system: sys, prompt, maxTokens: Math.min(16000, Math.round(maxTokens * 1.6)) });
    }
    return parseJson(raw);
  },

  // Ask for a DOCUMENT: a small JSON metadata block + a RAW content block kept
  // OUTSIDE of JSON. This is the right shape for article bodies that contain
  // LaTeX/HTML (backslashes & quotes) which would otherwise break JSON parsing.
  // Returns { ...metadata, content }.
  async doc({ system, prompt, maxTokens = 8000 }) {
    let raw = await this.complete({ system, prompt, maxTokens });
    if (!raw || !raw.trim()) {
      raw = await this.complete({ system, prompt, maxTokens: Math.min(16000, Math.round(maxTokens * 1.4)) });
    }
    return splitDoc(raw);
  },
};

// Parse the delimited doc format. Robust to LaTeX/HTML in the content block
// because that block is extracted as RAW text (never JSON-decoded). Falls back
// to whole-response JSON parsing if the markers aren't present.
function splitDoc(raw) {
  const text = String(raw || '');
  if (!text.trim()) throw new Error('AI returned an empty response (the model likely hit its token limit — try increasing max tokens or reducing the request size).');
  // Match the blocks even if the CLOSING marker is missing (truncated output) —
  // the closing alternative is end-of-string. This is the #1 robustness win.
  const metaM = text.match(/<<<\s*META\b([\s\S]*?)(?:META\s*>>>|$)/i);
  const contentM = text.match(/<<<\s*CONTENT\b([\s\S]*?)(?:CONTENT\s*>>>|$)/i);
  if (contentM) {
    let meta = {};
    if (metaM) { try { meta = parseJson(metaM[1]); } catch { meta = {}; } }
    return { ...meta, content: contentM[1].replace(/^\s*\n/, '').replace(/\s+$/, '') };
  }
  // No CONTENT marker. Try plain JSON (older format with a "content" field).
  try {
    const obj = parseJson(text);
    if (obj && typeof obj === 'object' && (obj.content || obj.title)) return obj;
  } catch { /* not JSON — fall through */ }
  // Last resort: the model returned the body directly (markdown/HTML, no markers).
  // Strip any leading META JSON, use the remainder as raw content so we NEVER
  // hard-fail on a formatting quirk.
  const body = text.replace(/<<<\s*META[\s\S]*?(?:META\s*>>>|$)/i, '').replace(/<<<\s*CONTENT\b/i, '').trim();
  return { content: body || text.trim() };
}

function parseJson(raw) {
  let s = (raw || '').trim();
  if (!s) throw new Error('AI returned an empty response (the model likely hit its token limit — try increasing max tokens or reducing the request size).');
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s); }
  catch { /* try repairs below */ }
  try { return JSON.parse(sanitizeEscapes(s)); }      // fix illegal \x escapes (e.g. LaTeX \alpha)
  catch { /* try harder */ }
  return JSON.parse(repairJson(sanitizeEscapes(s)));   // fix escapes + balance/truncation
}

// Double any backslash that doesn't introduce a valid JSON escape, so stray
// LaTeX/Windows-path backslashes (\alpha, \sum, \mathbf, …) don't throw
// "Bad escaped character". Valid introducers: " \ / b f n r t u(XXXX).
function sanitizeEscapes(s) {
  return s.replace(/\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])?/g, (m) => (m.length > 1 ? m : '\\\\'));
}

// Salvage truncated JSON: cut to the last complete object, then balance brackets.
function repairJson(s) {
  const lastClose = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  let t = lastClose >= 0 ? s.slice(0, lastClose + 1) : s;
  let inStr = false, esc = false; const stack = [];
  for (const ch of t) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  t = t.replace(/,\s*$/, '');
  const closers = stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
  return t + closers;
}

export default ai;
