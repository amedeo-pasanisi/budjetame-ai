/** The Assistant turn client (ADR-0035, issues #122/#132): the web app is a
 * thin chat screen that carries the transcript. `POST /assistant/turns` is
 * stateless — the body is the transcript exactly as the client last
 * received it plus the new sentence, the answer is the written reply and
 * the messages appended this turn (the user message first), so the next
 * transcript is the previous one followed by the tail, unchanged.
 *
 * The message shape is the server's (app/assistant_seam.py); the client
 * only renders the user's text and the reply and carries everything else —
 * tool calls and tool results included — back opaquely, so the types below
 * are loose on purpose: a block detail changing on the server must not
 * break the client.
 *
 * The POST goes through the transport like every write, so a successful
 * turn bumps the cache clock (ADR-0022) and the Transactions tab refetches
 * its Drafts in the background. A rejected turn keeps its status on the
 * ApiError: 409 no Assistant Settings (the shell hides the Assistant), 429
 * the hourly bound, 501/502 the provider could not answer (issue #129). */

import { request } from './transport'

/** One content block of a message: a text block, a tool call (assistant)
 * or a tool result (user). Anything else the server adds rides along. */
export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_call_id: string; content: string; is_error?: boolean }
  | { type: string; [key: string]: unknown }

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: AssistantBlock[]
}

export type AssistantTurnResult = {
  /** The written reply in the Account's Locale. */
  reply: string
  /** The messages appended this turn, the user message first. */
  transcript_tail: AssistantMessage[]
}

/** One user turn: the transcript as last received plus the new text. */
export async function sendAssistantTurn(
  token: string,
  transcript: AssistantMessage[],
  text: string,
): Promise<AssistantTurnResult> {
  const response = await request('/assistant/turns', {
    method: 'POST',
    token,
    json: { transcript, text },
    errorMessage: 'The Assistant could not answer',
  })
  return (await response.json()) as AssistantTurnResult
}
