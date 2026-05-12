/**
 * Twilio WhatsApp incoming message webhook.
 * Receives a message from a prospect, calls Claude, replies instantly.
 *
 * Configure in Twilio Console → Messaging → WhatsApp Senders →
 * your number → "When a message comes in" → set URL to:
 * https://app.ratetapmx.com/api/webhooks/whatsapp
 */
import { NextRequest } from 'next/server';
import { getAnthropic, RATETAP_SYSTEM_PROMPT } from '@/lib/anthropic';
import { markProspectReplied } from '@/lib/outreach-tracking';

export const dynamic = 'force-dynamic';

// Conversation memory — in-memory per serverless instance, good enough for short sessions
const conversations = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

function twimlReply(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message></Response>`;
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
}

export async function POST(req: NextRequest) {
  const body = await req.formData();
  const from = (body.get('From') as string)?.replace('whatsapp:', '') ?? '';
  const text = (body.get('Body') as string)?.trim() ?? '';

  if (!text || !from) return twimlReply('Hola, ¿en qué puedo ayudarte?');

  await markProspectReplied({
    phone: from,
    text,
    provider: 'whatsapp',
  });

  // Build conversation history (last 6 messages for context)
  const history = conversations.get(from) ?? [];
  history.push({ role: 'user', content: text });
  if (history.length > 12) history.splice(0, 2);
  conversations.set(from, history);

  try {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: RATETAP_SYSTEM_PROMPT,
      messages: history,
    });

    const reply = (response.content[0] as { type: string; text: string }).text ?? '¿En qué puedo ayudarte?';
    history.push({ role: 'assistant', content: reply });
    conversations.set(from, history);

    return twimlReply(reply);
  } catch (err) {
    console.error('[whatsapp-ai] Claude error:', err);
    return twimlReply('Hola! Para más información escríbenos a https://app.ratetapmx.com/contacto o llámanos.');
  }
}
