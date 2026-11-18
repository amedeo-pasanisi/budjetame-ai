/** The Assistant turn client (ADR-0035, issues #122/#132): one POST that
 * carries the transcript as last received plus the new text, and hands
 * back the reply and the tail untouched — the client never builds or
 * interprets a message. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { request } from './transport'
import { sendAssistantTurn, type AssistantMessage } from './assistant'

vi.mock('./transport', () => ({
  request: vi.fn(),
}))

const requestMock = vi.mocked(request)

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response
}

beforeEach(() => {
  requestMock.mockReset()
})

describe('sendAssistantTurn', () => {
  it('posts the transcript and the text to /assistant/turns', async () => {
    const transcript: AssistantMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'ciao' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', id: 'c1', name: 'create_draft_transaction', input: { amount: 30 } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_call_id: 'c1', content: '{"id": 7}', is_error: false }],
      },
    ]
    requestMock.mockResolvedValue(jsonResponse({ reply: 'Ok', transcript_tail: [] }))

    await sendAssistantTurn('token', transcript, 'no, erano 35')

    expect(requestMock).toHaveBeenCalledWith(
      '/assistant/turns',
      expect.objectContaining({
        method: 'POST',
        token: 'token',
        json: { transcript, text: 'no, erano 35' },
      }),
    )
  })

  it('returns the reply and the tail exactly as the server sent them', async () => {
    const tail = [
      { role: 'user', content: [{ type: 'text', text: 'trenta euro di cibo' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Spesa 30,00 € oggi: Cibo' }] },
    ]
    requestMock.mockResolvedValue(
      jsonResponse({ reply: 'Spesa 30,00 € oggi: Cibo', transcript_tail: tail }),
    )

    const result = await sendAssistantTurn('token', [], 'trenta euro di cibo')

    expect(result).toEqual({ reply: 'Spesa 30,00 € oggi: Cibo', transcript_tail: tail })
  })
})
