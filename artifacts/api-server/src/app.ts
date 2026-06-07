import express from 'express';
  import cors from 'cors';
  import { readFileSync, existsSync } from 'fs';
  import { join, dirname } from 'path';
  import { fileURLToPath } from 'url';
  import { GoogleGenerativeAI } from '@google/generative-ai';

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const app = express();

  // Allow any origin so the embed widget works from any website
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // Load knowledge.txt from repo root (3 levels up: src → api-server → artifacts → root)
  const knowledgePath = join(__dirname, '../../../knowledge.txt');
  let knowledgeBase = '';
  if (existsSync(knowledgePath)) {
    knowledgeBase = readFileSync(knowledgePath, 'utf-8');
    console.log(`[Smit AI Sahayak] Loaded knowledge base (${knowledgeBase.length} chars)`);
  } else {
    console.warn('[Smit AI Sahayak] knowledge.txt not found — running without custom context');
  }

  const genAI = new GoogleGenerativeAI(process.env['GEMINI_API_KEY'] ?? '');

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'smit-ai-sahayak', port: process.env['PORT'] ?? 5001 });
  });

  // Chat endpoint — called by the embed widget
  app.post('/api/chat', async (req, res) => {
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

      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const chat = model.startChat({
        history: [
          {
            role: 'user',
            parts: [{
              text: `You are Smit AI Sahayak, a helpful AI assistant for CSC (Common Service Centre) operators, students, and farmers in Gujarat, India. Always respond in Gujarati unless the user writes in English. Be concise and practical.\n\nKnowledge Base:\n${knowledgeBase}`,
            }],
          },
          {
            role: 'model',
            parts: [{ text: 'સમਜ્યો, હું Smit AI Sahayak તરીકે ગુજરાતીમાં મદદ કરીશ.' }],
          },
          ...history,
        ],
      });

      const result = await chat.sendMessage(message);
      const reply = result.response.text();
      res.json({ reply });
    } catch (err) {
      console.error('[Smit AI Sahayak] Chat error:', err);
      res.status(500).json({ error: 'AI service error', reply: 'ક્ષમા કરશો, સર્વર ભૂલ આવી.' });
    }
  });

  export default app;
  