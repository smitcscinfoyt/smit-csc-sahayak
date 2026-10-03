import express from 'express';
import cors from 'cors';

let isSambaNovaDisabled = false;
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());


// Load knowledge.txt from repo root
const knowledgePath = join(__dirname, '../../../knowledge.txt');
let knowledgeBase = '';
if (existsSync(knowledgePath)) {
  knowledgeBase = readFileSync(knowledgePath, 'utf-8');
  console.log(`[Smit AI Sahayak] Loaded knowledge base (${knowledgeBase.length} chars)`);
} else {
  console.warn('[Smit AI Sahayak] knowledge.txt not found — running without custom context');
}

const SYSTEM_PROMPT = `You are "Smit AI Sahayak", the official assistant of Smit CSC Info. Give ONLY real, exact, relevant information. Never guess.
1. Answer ONLY the exact question. Use CONTEXT silently; never print or summarize it; never add other topics (income/caste certificate, PAN, EWS) unless asked.
2. Clean, professional Gujarati only (English for technical terms). Plain text, no markdown symbols.
3. Never write phone, helpline or toll-free numbers.
4. Never write a URL, email or link unless it is in CONTEXT verbatim. Never write a footer.
5. If CONTEXT lacks the answer, reply exactly: "\u0A86 \u0AB5\u0ABF\u0AB7\u0AAF\u0AA8\u0AC0 verified \u0AAE\u0ABE\u0AB9\u0ABF\u0AA4\u0AC0 \u0AB9\u0ABE\u0AB2 \u0A89\u0AAA\u0AB2\u0AAC\u0ACD\u0AA7 \u0AA8\u0AA5\u0AC0." Never use memory for fees, dates, forms, laws or links.
6. Affidavit/application: draft in Gujarati ONLY from a template in CONTEXT; no invented legal text.
7. Be brief: steps, documents, official link (if in CONTEXT).

CONTEXT:
${knowledgeBase}`;

(async function verifyProviders() {
  const sambaKey = process.env['SAMBANOVA_API_KEY'];
  if (sambaKey) {
    try {
      const res = await fetch('https://api.sambanova.ai/v1/models', {
        headers: { Authorization: `Bearer ${sambaKey}` },
        signal: AbortSignal.timeout(5000)
      });
      console.log(`[Startup] SambaNova models check: HTTP ${res.status}`);
    } catch (err: any) {
      console.warn(`[Startup] SambaNova models check failed: ${err.message}`);
    }
  }

  const geminiKey = process.env['GEMINI_API_KEY'] || process.env['AI_INTEGRATIONS_GEMINI_API_KEY'];
  if (geminiKey) {
    try {
      const geminiBaseUrl = process.env['AI_INTEGRATIONS_GEMINI_BASE_URL'] || 'https://generativelanguage.googleapis.com/v1beta';
      // no keys in URL - using x-goog-api-key header
      const res = await fetch(`${geminiBaseUrl.replace(new RegExp('/$'), '')}/models`, {
        headers: { 'x-goog-api-key': geminiKey },
        signal: AbortSignal.timeout(5000)
      });
      console.log(`[Startup] Gemini models check: HTTP ${res.status}`);
    } catch (err: any) {
      console.warn(`[Startup] Gemini models check failed: ${err.message}`);
    }
  }
})();

// Health check
app.get('/api/health', (_req, res) => {
  const sambaKey = process.env['SAMBANOVA_API_KEY'];
  const geminiKey = process.env['GEMINI_API_KEY'] || process.env['AI_INTEGRATIONS_GEMINI_API_KEY'];
  res.json({
    status: 'ok',
    service: 'smit-ai-sahayak',
    port: process.env['PORT'] ?? 5001,
    providers: {
      sambanova: !!sambaKey,
      gemini: !!geminiKey,
    },
  });
});

// Chat endpoint — called by the embed widget and CSC Info proxy
// Provider waterfall: SambaNova -> Gemini
app.post('/api/chat', async (req, res) => {
  const requestStartTime = Date.now();
  const OVERALL_DEADLINE_MS = 30000;
  
  const getRemainingTime = () => Math.max(0, OVERALL_DEADLINE_MS - (Date.now() - requestStartTime));

  const sambaKey = process.env['SAMBANOVA_API_KEY'];
  const geminiKey = process.env['GEMINI_API_KEY'] || process.env['AI_INTEGRATIONS_GEMINI_API_KEY'];

  try {
    const { message, history = [], isPrime = false } = req.body as {
      message: string;
      history: Array<{ role: string; parts: Array<{ text: string }> }>;
      isPrime: boolean;
    };

    if (!message || typeof message !== 'string' || message.trim() === '') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    if (!isPrime) {
      res.status(403).json({ error: 'Prime membership required' });
      return;
    }

    const trimmed = message.trim().slice(0, 1000);

    // ── Priority 1: SambaNova ──────────────────────────────────────────────────
    if (sambaKey && !isSambaNovaDisabled) {
      const sambaModelsStr = process.env['SAMBANOVA_MODELS'] || process.env['SAMBANOVA_MODEL'] || "DeepSeek-V3.1,Meta-Llama-3.3-70B-Instruct";
      const sambaModels = sambaModelsStr.split(',').map(m => m.trim()).filter(Boolean);
      let sambaSuccess = false;
      for (const sambaModel of sambaModels) {
        const remaining = getRemainingTime();
        if (remaining < 1000) break; // Not enough time left for this request

        try {
          const safeHistory = Array.isArray(history)
            ? history.slice(-10).map((m) => ({
                role: m.role === 'model' ? 'assistant' : 'user',
                content: Array.isArray(m.parts) ? m.parts.map((p) => p?.text ?? '').join('') : '',
              }))
            : [];

          const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...safeHistory,
            { role: 'user', content: trimmed },
          ];

          const upstream = await fetch('https://api.sambanova.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sambaKey}`,
            },
            body: JSON.stringify({
              model: sambaModel,
              messages,
              temperature: 0.4,
              max_tokens: 4096,
            }),
            signal: AbortSignal.timeout(Math.min(20000, remaining)),
          });

          if (upstream.status === 402) {
            console.warn('[Smit AI Sahayak] SambaNova is disabled (402 Payment Required). Skipping for future requests.');
            isSambaNovaDisabled = true;
            break;
          }

          if (upstream.ok) {
            const json = (await upstream.json()) as any;
            const reply = (json?.choices?.[0]?.message?.content as string) ?? '';
            if (reply) {
              res.json({ reply });
              sambaSuccess = true;
              break;
            }
            console.warn(JSON.stringify({ provider: 'sambanova', model: sambaModel, status: upstream.status, reason: 'empty_reply' }));
          } else {
            console.warn(JSON.stringify({ provider: 'sambanova', model: sambaModel, status: upstream.status, reason: 'http_error' }));
            if (upstream.status === 404 || upstream.status === 429 || upstream.status >= 500) continue;
            break;
          }
        } catch (err: any) {
          console.warn(JSON.stringify({ provider: 'sambanova', model: sambaModel, status: null, reason: err.name === 'TimeoutError' ? 'timeout' : 'exception' }));
          continue;
        }
      }
      if (sambaSuccess) return;
    }

    // ── Priority 2: Gemini ─────────────────────────────────────────────────────
    if (geminiKey) {
      const geminiModelsStr = process.env['GEMINI_MODELS'] || process.env['GEMINI_MODEL'] || "gemini-3.5-flash,gemini-3.8-flash,gemini-3.7-flash,gemini-flash-latest";
      const geminiModels = geminiModelsStr.split(',').map(m => m.trim()).filter(Boolean);
      let geminiSuccess = false;
      for (const geminiModel of geminiModels) {
        const remaining = getRemainingTime();
        if (remaining < 1000) break;

        try {
          const geminiBaseUrl =
            process.env['AI_INTEGRATIONS_GEMINI_BASE_URL'] ||
            'https://generativelanguage.googleapis.com/v1beta';

          const contents = [
            ...history.slice(-10),
            { role: 'user', parts: [{ text: trimmed }] },
          ];

          const url = `${geminiBaseUrl.replace(new RegExp('/$'), '')}/models/${geminiModel}:generateContent`;

          const upstream = await fetch(url, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-goog-api-key': geminiKey
            },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents,
              generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
            }),
            signal: AbortSignal.timeout(Math.min(20000, remaining)),
          });

          if (upstream.ok) {
            const json = (await upstream.json()) as any;
            const reply =
              json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
            if (reply) {
              res.json({ reply });
              geminiSuccess = true;
              break;
            }
            console.warn(JSON.stringify({ provider: 'gemini', model: geminiModel, status: upstream.status, reason: 'empty_reply' }));
          } else {
            console.warn(JSON.stringify({ provider: 'gemini', model: geminiModel, status: upstream.status, reason: 'http_error' }));
            if (upstream.status === 404 || upstream.status === 429 || upstream.status >= 500) continue;
          }
        } catch (err: any) {
          console.warn(JSON.stringify({ provider: 'gemini', model: geminiModel, status: null, reason: err.name === 'TimeoutError' ? 'timeout' : 'exception' }));
          continue;
        }
      }
      if (geminiSuccess) return;
    }

    // ── All providers exhausted ────────────────────────────────────────────────
    if (!sambaKey && !geminiKey) {
      console.error('[Smit AI Sahayak] No AI provider configured');
      res.status(503).json({ error: 'AI service not configured', reply: 'ક્ષમા કરશો, AI service configured નથી.' });
    } else {
      console.error('[Smit AI Sahayak] All AI providers failed');
      res.status(502).json({ error: 'AI service error', reply: 'ક્ષમા કરશો, AI service unavailable છે. ફરી try કરો.' });
    }
  } catch (err) {
    console.error('[Smit AI Sahayak] Chat error:', err);
    res.status(500).json({ error: 'AI service error', reply: 'ક્ષમા કરશો, અડચણ આવી. ફરી try કરો.' });
  }
});

export default app;
