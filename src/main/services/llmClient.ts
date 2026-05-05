import Anthropic from '@anthropic-ai/sdk';
import { getApiKey, getModel, isAiAvailable } from '../aiConfig';
import log from '../utils/logger';

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!isAiAvailable()) return null;
  if (cachedClient) return cachedClient;
  const apiKey = getApiKey();
  if (!apiKey) return null;
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status === 429 || (status !== undefined && status >= 500 && status < 600)) {
        const backoffMs = 1000 * Math.pow(2, i);
        log.warn(`[llm] retry ${i + 1}/${attempts} after ${backoffMs}ms (status=${status})`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function rewriteEmail(
  draftBody: string,
  language: 'pl' | 'en',
  context?: { supplierName?: string; subject?: string },
): Promise<string> {
  const client = getClient();
  if (!client) throw new Error('AI is not available');

  const systemPrompt =
    language === 'pl'
      ? 'Jesteś specjalistą ds. zakupów piszącym profesjonalne maile w języku polskim. ' +
        'Otrzymasz roboczą wersję maila z zapytaniem ofertowym (RFQ). Twoim zadaniem jest poprawić ' +
        'styl: ma być uprzejmie, krótko, profesjonalnie. KRYTYCZNE: nie zmieniaj żadnych liczb, ' +
        'nazw produktów, ilości, jednostek ani szczegółów technicznych. Zwróć WYŁĄCZNIE finalną ' +
        'treść maila, bez nagłówków, bez komentarza.'
      : 'You are a procurement specialist writing professional emails in English. You will receive ' +
        'a draft RFQ email. Improve the style: polite, concise, professional. CRITICAL: do not ' +
        'change any numbers, product names, quantities, units, or technical details. Return ONLY ' +
        'the final email body, no headers, no commentary.';

  const userMessage = context?.supplierName
    ? `Supplier: ${context.supplierName}\n\nDraft:\n${draftBody}`
    : `Draft:\n${draftBody}`;

  const response = await withRetry(() =>
    client.messages.create({
      model: getModel(),
      max_tokens: 1500,
      // Cache the system prompt across requests in the same 5-minute window.
      // Saves ~90% on cache hits when the user refines several emails in a row.
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    }),
  );

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('AI returned no text');
  return block.text.trim();
}

export async function suggestMatch(
  sourceName: string,
  candidateNames: { id: string; name: string }[],
): Promise<{ id: string; confidence: number } | null> {
  const client = getClient();
  if (!client) throw new Error('AI is not available');
  if (candidateNames.length === 0) return null;

  const systemPrompt =
    'You match cosmetic raw material / packaging names imported from an inventory system to ' +
    'an internal master list. Names may differ in formatting, abbreviations, or supplier-specific ' +
    'codes. Return JSON: {"id": "<best id or null>", "confidence": 0..1}. If unsure, return null.';

  const candidateText = candidateNames.map((c) => `- ${c.id}: ${c.name}`).join('\n');
  const userMessage = `Imported name: "${sourceName}"\n\nCandidates:\n${candidateText}\n\nReturn JSON only.`;

  const response = await withRetry(() =>
    client.messages.create({
      model: getModel(),
      max_tokens: 200,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    }),
  );

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return null;
  try {
    const parsed = JSON.parse(block.text.trim());
    if (!parsed.id) return null;
    return { id: String(parsed.id), confidence: Number(parsed.confidence) || 0 };
  } catch {
    return null;
  }
}
