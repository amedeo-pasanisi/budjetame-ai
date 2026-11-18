/** The Assistant modal (ADR-0035, issues #122/#132): a thin chat screen
 * that carries the transcript back untouched on every Send, shows the
 * user's sentence and the written reply, turns the statuses that are not
 * replies (429, 501/502) into lines of its own, hands a 409 to the shell,
 * and dictates into the text box — in the Account's Locale, never sending
 * on its own — only where the browser has speech recognition. The api
 * barrel is mocked; a fake recognizer is put on `window`. Rendered in
 * English and Italian. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithIntl } from './test/renderWithIntl'
import { AssistantModal } from './AssistantModal'

vi.mock('./api', () => {
  class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return {
    ApiError,
    TOKEN_KEY: 'budjetame.token',
    sendAssistantTurn: vi.fn(),
  }
})

import { ApiError, sendAssistantTurn, type AssistantMessage } from './api'

const sendAssistantTurnMock = vi.mocked(sendAssistantTurn)

/** The browser's recognizer, faked: records the language it was given and
 * the start/stop calls, and lets a test fire a result or an end. */
class FakeRecognizer {
  static instances: FakeRecognizer[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: { results: { length: number; [index: number]: { length: number; [index: number]: { transcript: string } } } }) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()

  constructor() {
    FakeRecognizer.instances.push(this)
  }

  /** One final result with one alternative — what the browser fires once
   * the user stops talking. */
  hear(transcript: string) {
    this.onresult?.({ results: { length: 1, 0: { length: 1, 0: { transcript } } } })
  }
}

const tail = (userText: string, replyText: string): AssistantMessage[] => [
  { role: 'user', content: [{ type: 'text', text: userText }] },
  {
    role: 'assistant',
    content: [
      { type: 'tool_call', id: 'c1', name: 'create_draft_transaction', input: { amount: 30 } },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_call_id: 'c1', content: '{"id": 7}', is_error: false }] },
  { role: 'assistant', content: [{ type: 'text', text: replyText }] },
]

function renderModal(locale: 'en' | 'it' = 'en', onNoSettings = vi.fn()) {
  renderWithIntl(<AssistantModal locale={locale} onClose={vi.fn()} onNoSettings={onNoSettings} />, {
    locale,
  })
  return onNoSettings
}

function send(sentence: string, labels = { input: 'Your sentence', send: 'Send' }) {
  fireEvent.change(screen.getByLabelText(labels.input), { target: { value: sentence } })
  fireEvent.click(screen.getByRole('button', { name: labels.send }))
}

beforeEach(() => {
  localStorage.setItem('budjetame.token', 'test-token')
  sendAssistantTurnMock.mockReset()
  FakeRecognizer.instances = []
})

afterEach(() => {
  localStorage.removeItem('budjetame.token')
  vi.unstubAllGlobals()
})

describe('AssistantModal turns (ADR-0035)', () => {
  it('Send posts the sentence with an empty transcript and shows the sentence and the reply', async () => {
    sendAssistantTurnMock.mockResolvedValue({
      reply: 'Expense 30.00 € today: Food',
      transcript_tail: tail('30 euro of food', 'Expense 30.00 € today: Food'),
    })
    renderModal()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    send('30 euro of food')

    expect(sendAssistantTurnMock).toHaveBeenCalledWith('test-token', [], '30 euro of food')
    expect(await screen.findByText('Expense 30.00 € today: Food')).toBeInTheDocument()
    expect(screen.getByText('30 euro of food')).toBeInTheDocument()
    // The box is empty again, ready for the next sentence.
    expect(screen.getByLabelText('Your sentence')).toHaveValue('')
    // Only the texts show: the tool call and its result are carried, not rendered.
    expect(screen.queryByText(/create_draft_transaction/)).not.toBeInTheDocument()
  })

  it('a second Send carries the whole transcript back, tool blocks included', async () => {
    const firstTail = tail('30 euro of food', 'Expense 30.00 € today: Food')
    sendAssistantTurnMock.mockResolvedValueOnce({ reply: 'Expense 30.00 € today: Food', transcript_tail: firstTail })
    const secondTail = tail('no, it was 35', 'Expense 35.00 € today: Food')
    sendAssistantTurnMock.mockResolvedValueOnce({ reply: 'Expense 35.00 € today: Food', transcript_tail: secondTail })
    renderModal()

    send('30 euro of food')
    await screen.findByText('Expense 30.00 € today: Food')
    send('no, it was 35')
    await screen.findByText('Expense 35.00 € today: Food')

    expect(sendAssistantTurnMock).toHaveBeenLastCalledWith('test-token', firstTail, 'no, it was 35')
    // Both exchanges stay on screen, in order.
    const log = screen.getByRole('log', { name: 'Conversation' })
    expect(log.textContent).toMatch(/30 euro of food.*Expense 30\.00 € today: Food.*no, it was 35.*Expense 35\.00 € today: Food/)
  })

  it('Send is disabled while a turn is in flight and the box only takes whitespace as empty', async () => {
    let resolveTurn: (value: { reply: string; transcript_tail: AssistantMessage[] }) => void = () => {}
    sendAssistantTurnMock.mockReturnValue(
      new Promise((resolve) => {
        resolveTurn = resolve
      }),
    )
    renderModal()
    fireEvent.change(screen.getByLabelText('Your sentence'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    send('30 euro of food')
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(screen.getByText('The Assistant is writing…')).toBeInTheDocument()

    await act(async () => {
      resolveTurn({ reply: 'Ok', transcript_tail: tail('30 euro of food', 'Ok') })
    })
    await screen.findByText('Ok')
    expect(screen.queryByText('The Assistant is writing…')).not.toBeInTheDocument()
  })

  it('a 429 shows the hourly-bound line, keeps the sentence in the box, and the transcript unchanged', async () => {
    sendAssistantTurnMock.mockRejectedValueOnce(new ApiError('too many', 429))
    sendAssistantTurnMock.mockResolvedValueOnce({ reply: 'Ok', transcript_tail: tail('30 euro of food', 'Ok') })
    renderModal()

    send('30 euro of food')

    expect(
      await screen.findByText('You have reached the hourly limit of Assistant requests. Try again later.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Your sentence')).toHaveValue('30 euro of food')
    // The failed sentence is not part of the conversation: the retry sends
    // the same empty transcript.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Ok')
    expect(sendAssistantTurnMock).toHaveBeenLastCalledWith('test-token', [], '30 euro of food')
  })

  it('a provider failure shows the generic line', async () => {
    sendAssistantTurnMock.mockRejectedValue(new ApiError('bad gateway', 502))
    renderModal()

    send('30 euro of food')

    expect(await screen.findByText('The Assistant could not answer. Try again.')).toBeInTheDocument()
  })

  it('a 409 is handed to the shell instead of a line', async () => {
    sendAssistantTurnMock.mockRejectedValue(new ApiError('no settings', 409))
    const onNoSettings = renderModal()

    send('30 euro of food')

    await waitFor(() => expect(onNoSettings).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('The Assistant could not answer. Try again.')).not.toBeInTheDocument()
  })
})

describe('AssistantModal dictation (issue #132)', () => {
  it('has no microphone where the browser has no speech recognition', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument()
  })

  it('listens in en-US for an English Account and fills the box without sending', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal('en')

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))

    expect(FakeRecognizer.instances).toHaveLength(1)
    const recognizer = FakeRecognizer.instances[0]
    expect(recognizer.lang).toBe('en-US')
    expect(recognizer.start).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Stop dictating' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Listening…')).toBeInTheDocument()

    act(() => recognizer.hear('30 euro of food'))
    act(() => recognizer.onend?.())

    expect(screen.getByLabelText('Your sentence')).toHaveValue('30 euro of food')
    expect(sendAssistantTurnMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'false')
    // Send is the user's move.
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('listens in it-IT for an Italian Account, through the webkit-prefixed recognizer too', () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognizer)
    renderModal('it')

    fireEvent.click(screen.getByRole('button', { name: 'Detta' }))

    expect(FakeRecognizer.instances[0].lang).toBe('it-IT')
    act(() => FakeRecognizer.instances[0].hear('trenta euro di cibo'))
    expect(screen.getByLabelText('La tua frase')).toHaveValue('trenta euro di cibo')
    expect(sendAssistantTurnMock).not.toHaveBeenCalled()
  })

  it('a second dictation appends to what is already typed', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    fireEvent.change(screen.getByLabelText('Your sentence'), { target: { value: '30 euro' } })

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    act(() => FakeRecognizer.instances[0].hear('of food'))

    expect(screen.getByLabelText('Your sentence')).toHaveValue('30 euro of food')
  })

  it('pressing the microphone again stops listening', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))

    fireEvent.click(screen.getByRole('button', { name: 'Stop dictating' }))

    expect(FakeRecognizer.instances[0].stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument()
  })

  it('a recognizer failure says so under the log; silence does not', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    act(() => FakeRecognizer.instances[0].onerror?.({ error: 'no-speech' }))
    expect(screen.queryByText('Dictation did not work. Type the sentence instead.')).not.toBeInTheDocument()

    act(() => FakeRecognizer.instances[0].onerror?.({ error: 'not-allowed' }))
    expect(screen.getByText('Dictation did not work. Type the sentence instead.')).toBeInTheDocument()
  })
})

describe('AssistantModal in Italian', () => {
  it('renders the Italian strings and lines', async () => {
    sendAssistantTurnMock.mockRejectedValue(new ApiError('too many', 429))
    renderModal('it')

    expect(screen.getByRole('dialog', { name: 'Assistente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Chiudi l'Assistente" })).toBeInTheDocument()
    expect(screen.getByText(/Ogni bozza finisce nella scheda Transazioni/)).toBeInTheDocument()

    send('trenta euro di cibo', { input: 'La tua frase', send: 'Invia' })

    expect(
      await screen.findByText("Hai raggiunto il limite orario di richieste all'Assistente. Riprova più tardi."),
    ).toBeInTheDocument()
  })
})
