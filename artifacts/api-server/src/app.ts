import express from 'express';
import cors from 'cors';
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

const SYSTEM_PROMPT = `You are Smit AI Sahayak, a helpful AI assistant for CSC (Common Service Centre) operators, students, and farmers in Gujarat, India.
Always respond in Gujarati unless the user writes in English. Be concise and practical.

Knowledge Base:
${knowledgeBase}`;

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
// Provider waterfall: SambaNova → Gemini
app.post('/api/chat', async (req, res) => {
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

    // ── Priority 1: SambaNova (DeepSeek) ───────────────────────────────────────
    if (sambaKey) {
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
            model: 'DeepSeek-V3-0324',
            messages,
            temperature: 0.4,
            max_tokens: 1024,
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (upstream.ok) {
          const json = (await upstream.json()) as any;
          const reply = (json?.choices?.[0]?.message?.content as string) ?? '';
          if (reply) {
            res.json({ reply });
            return;
          }
          console.warn('[Smit AI Sahayak] SambaNova empty reply — falling through to Gemini');
        } else {
          const text = await upstream.text();
          console.warn(`[Smit AI Sahayak] SambaNova ${upstream.status}: ${text.slice(0, 200)} — falling through to Gemini`);
        }
      } catch (err) {
        console.warn('[Smit AI Sahayak] SambaNova call failed — falling through to Gemini:', err);
      }
    }

    // ── Priority 2: Gemini ─────────────────────────────────────────────────────
    if (geminiKey) {
      try {
        const geminiBaseUrl =
          process.env['AI_INTEGRATIONS_GEMINI_BASE_URL'] ||
          'https://generativelanguage.googleapis.com/v1beta';

        const contents = [
          ...history.slice(-10),
          { role: 'user', parts: [{ text: trimmed }] },
        ];

        const url = `${geminiBaseUrl.replace(/\/$/, '')}/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;

        const upstream = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (upstream.ok) {
          const json = (await upstream.json()) as any;
          const reply =
            json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
          if (reply) {
            res.json({ reply });
            return;
          }
          console.warn('[Smit AI Sahayak] Gemini empty reply');
        } else {
          const text = await upstream.text();
          console.warn(`[Smit AI Sahayak] Gemini ${upstream.status}: ${text.slice(0, 200)}`);
        }
      } catch (err) {
        console.warn('[Smit AI Sahayak] Gemini call failed:', err);
      }
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
    res.status(500).json({ error: 'AI service error', reply: 'ક્ષમા કરશો, સર્વર ભૂલ આવી.' });
  }
});

export default app;
