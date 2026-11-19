/** The Assistant modal (ADR-0035, issues #122/#132/#133): a thin chat
 * screen that carries the transcript back untouched on every Send, shows
 * the user's sentence and the written reply, turns the statuses that are
 * not replies (429, 501/502) into lines of its own, hands a 409 to the
 * shell, and — only where the browser has speech recognition — starts a
 * Dictation on open, in the Account's Locale, framed by two tones and sent
 * as the next turn when it ends. The tones module is mocked. The api
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

vi.mock('./dictationTones', () => ({ primeTones: vi.fn(), playStartTone: vi.fn(), playStopTone: vi.fn() }))

import { ApiError, sendAssistantTurn, type AssistantMessage } from './api'
import { playStartTone, playStopTone, primeTones } from './dictationTones'

const sendAssistantTurnMock = vi.mocked(sendAssistantTurn)

/** The browser's recognizer, faked: records the language it was given and
 * the start/stop calls, and lets a test fire a result or an end. */
class FakeRecognizer {
  static instances: FakeRecognizer[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: { results: { length: number; [index: number]: { length: number; [index: number]: { transcript: string } } } }) => void) | null = null
  onerror: ((event: { error: SpeechRecognitionErrorCode }) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  // Like Chrome, an abort ends the recognizer later, not inside the call:
  // a test fires the late `onend` itself when it matters.
  abort = vi.fn()

  constructor() {
    FakeRecognizer.instances.push(this)
  }

  /** The microphone is open and the recognizer is really listening. */
  begin() {
    this.onstart?.()
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
  const rendered = renderWithIntl(
    <AssistantModal locale={locale} onClose={vi.fn()} onNoSettings={onNoSettings} />,
    { locale },
  )
  return { onNoSettings, unmount: rendered.unmount }
}

function send(sentence: string, labels = { input: 'Your sentence', send: 'Send' }) {
  fireEvent.change(screen.getByLabelText(labels.input), { target: { value: sentence } })
  fireEvent.click(screen.getByRole('button', { name: labels.send }))
}

beforeEach(() => {
  localStorage.setItem('budjetame.token', 'test-token')
  sendAssistantTurnMock.mockReset()
  vi.mocked(playStartTone).mockClear()
  vi.mocked(playStopTone).mockClear()
  vi.mocked(primeTones).mockClear()
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
    const { onNoSettings } = renderModal()

    send('30 euro of food')

    await waitFor(() => expect(onNoSettings).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('The Assistant could not answer. Try again.')).not.toBeInTheDocument()
  })
})

describe('AssistantModal Dictation (issue #133)', () => {
  it('has no microphone, and listens to nothing, where the browser has no speech recognition', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop dictating' })).not.toBeInTheDocument()
  })

  it('opening the Assistant starts a Dictation in the Locale without a tap', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal('en')

    expect(FakeRecognizer.instances).toHaveLength(1)
    expect(FakeRecognizer.instances[0].lang).toBe('en-US')
    expect(FakeRecognizer.instances[0].start).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Stop dictating' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Listening…')).toBeInTheDocument()
  })

  it('a heard sentence is sent when the user falls silent, without pressing Send', async () => {
    sendAssistantTurnMock.mockResolvedValue({ reply: 'Ok', transcript_tail: tail('30 euro of food', 'Ok') })
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    const recognizer = FakeRecognizer.instances[0]

    act(() => recognizer.hear('30 euro of food'))
    expect(sendAssistantTurnMock).not.toHaveBeenCalled()
    act(() => recognizer.onend?.())

    expect(sendAssistantTurnMock).toHaveBeenCalledWith('test-token', [], '30 euro of food')
    expect(await screen.findByText('Ok')).toBeInTheDocument()
    expect(screen.getByText('30 euro of food')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('an Italian Account listens in it-IT, through the webkit-prefixed recognizer too', () => {
    sendAssistantTurnMock.mockResolvedValue({ reply: 'Ok', transcript_tail: tail('trenta euro di cibo', 'Ok') })
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognizer)
    renderModal('it')
    const recognizer = FakeRecognizer.instances[0]

    expect(recognizer.lang).toBe('it-IT')
    expect(screen.getByRole('button', { name: 'Ferma la dettatura' })).toBeInTheDocument()
    act(() => recognizer.hear('trenta euro di cibo'))
    act(() => recognizer.onend?.())

    expect(sendAssistantTurnMock).toHaveBeenCalledWith('test-token', [], 'trenta euro di cibo')
  })

  it('typing while it listens cancels the Dictation without sending', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    const recognizer = FakeRecognizer.instances[0]
    act(() => recognizer.hear('thirty'))

    fireEvent.change(screen.getByLabelText('Your sentence'), { target: { value: '30 euro' } })

    expect(recognizer.abort).toHaveBeenCalledTimes(1)
    expect(sendAssistantTurnMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Your sentence')).toHaveValue('30 euro')
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('tapping the microphone ends the Dictation and sends it after what is typed', async () => {
    sendAssistantTurnMock.mockResolvedValue({ reply: 'Ok', transcript_tail: tail('30 euro of food', 'Ok') })
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    fireEvent.change(screen.getByLabelText('Your sentence'), { target: { value: '30 euro' } })

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    const recognizer = FakeRecognizer.instances[1]
    act(() => recognizer.hear('of food'))
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictating' }))

    expect(recognizer.stop).toHaveBeenCalledTimes(1)
    expect(sendAssistantTurnMock).toHaveBeenCalledWith('test-token', [], '30 euro of food')
    expect(await screen.findByText('Ok')).toBeInTheDocument()
    expect(screen.getByLabelText('Your sentence')).toHaveValue('')
  })

  it('a Dictation that heard nothing sends nothing and says nothing', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()

    act(() => FakeRecognizer.instances[0].onerror?.({ error: 'no-speech' }))
    act(() => FakeRecognizer.instances[0].onend?.())

    expect(sendAssistantTurnMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Dictation did not work. Type the sentence instead.')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeInTheDocument()
  })

  it('a tone marks when it is really listening and another when it ends', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    const recognizer = FakeRecognizer.instances[0]
    // Asked to start is not yet listening: the microphone may still be refused.
    expect(playStartTone).not.toHaveBeenCalled()

    act(() => recognizer.begin())
    expect(playStartTone).toHaveBeenCalledTimes(1)
    expect(playStopTone).not.toHaveBeenCalled()

    act(() => recognizer.onend?.())
    expect(playStopTone).toHaveBeenCalledTimes(1)
  })

  it('refusing the microphone shows nothing and makes no sound', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    const recognizer = FakeRecognizer.instances[0]

    act(() => recognizer.onerror?.({ error: 'not-allowed' }))
    act(() => recognizer.onend?.())

    expect(screen.queryByText('Dictation did not work. Type the sentence instead.')).not.toBeInTheDocument()
    expect(playStartTone).not.toHaveBeenCalled()
    expect(playStopTone).not.toHaveBeenCalled()
    // The microphone stays, and a tap asks again.
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    expect(FakeRecognizer.instances).toHaveLength(2)
  })

  it('a failure the user did not choose says so, and still sounds the end', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    const recognizer = FakeRecognizer.instances[0]
    act(() => recognizer.begin())

    act(() => recognizer.onerror?.({ error: 'audio-capture' }))
    act(() => recognizer.onend?.())

    expect(screen.getByText('Dictation did not work. Type the sentence instead.')).toBeInTheDocument()
    expect(playStopTone).toHaveBeenCalledTimes(1)
  })

  it('the microphone waits while a reply is pending, and listening does not restart after it', async () => {
    let resolveTurn: (value: { reply: string; transcript_tail: AssistantMessage[] }) => void = () => {}
    sendAssistantTurnMock.mockReturnValue(
      new Promise((resolve) => {
        resolveTurn = resolve
      }),
    )
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    act(() => FakeRecognizer.instances[0].hear('30 euro of food'))
    act(() => FakeRecognizer.instances[0].onend?.())

    expect(screen.getByRole('button', { name: 'Dictate' })).toBeDisabled()

    await act(async () => {
      resolveTurn({ reply: 'Ok', transcript_tail: tail('30 euro of food', 'Ok') })
    })
    await screen.findByText('Ok')
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeEnabled()
    expect(FakeRecognizer.instances).toHaveLength(1)
  })

  it('pressing Send while it listens drops the Dictation and sends the box', async () => {
    sendAssistantTurnMock.mockResolvedValue({ reply: 'Ok', transcript_tail: tail('30 euro of food', 'Ok') })
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    fireEvent.change(screen.getByLabelText('Your sentence'), { target: { value: '30 euro of food' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    const recognizer = FakeRecognizer.instances[1]
    act(() => recognizer.begin())
    act(() => recognizer.hear('thirty'))

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    act(() => recognizer.onend?.())

    expect(recognizer.abort).toHaveBeenCalledTimes(1)
    expect(sendAssistantTurnMock).toHaveBeenCalledTimes(1)
    expect(sendAssistantTurnMock).toHaveBeenCalledWith('test-token', [], '30 euro of food')
    expect(playStopTone).not.toHaveBeenCalled()
    await screen.findByText('Ok')
  })

  it('a recognizer that refuses to start says so and leaves the microphone ready', () => {
    class BrokenRecognizer extends FakeRecognizer {
      start = vi.fn(() => {
        throw new Error('InvalidStateError')
      })
    }
    vi.stubGlobal('SpeechRecognition', BrokenRecognizer)
    renderModal()

    expect(screen.getByText('Dictation did not work. Type the sentence instead.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('opening the Assistant readies the tones within the tap that opened it', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    expect(primeTones).toHaveBeenCalled()
  })

  it('the late end of a dropped recognizer leaves the live Dictation alone', () => {
    // Chrome ends an aborted recognizer after `abort` returns, and StrictMode
    // drops the first recognizer of every open: that late end must not
    // clear, sound or send the Dictation now running.
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    renderModal()
    const dropped = FakeRecognizer.instances[0]
    act(() => dropped.begin())
    act(() => dropped.hear('thirty'))
    fireEvent.change(screen.getByLabelText('Your sentence'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    const live = FakeRecognizer.instances[1]

    act(() => dropped.onend?.())

    expect(sendAssistantTurnMock).not.toHaveBeenCalled()
    expect(playStopTone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stop dictating' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your sentence'), { target: { value: '30 euro' } })
    expect(live.abort).toHaveBeenCalledTimes(1)
  })

  it('closing the Assistant drops a running Dictation without sending it', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognizer)
    const { unmount } = renderModal()
    const recognizer = FakeRecognizer.instances[0]
    act(() => recognizer.begin())
    act(() => recognizer.hear('30 euro of food'))

    unmount()

    expect(recognizer.abort).toHaveBeenCalledTimes(1)
    expect(playStopTone).not.toHaveBeenCalled()
    expect(sendAssistantTurnMock).not.toHaveBeenCalled()
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
