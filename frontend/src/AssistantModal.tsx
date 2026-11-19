import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'

import { ApiError, TOKEN_KEY, sendAssistantTurn, type AssistantMessage } from './api'
import { playStartTone, playStopTone, primeTones } from './dictationTones'
import { ModalShell } from './ModalShell'
import {
  isDictationFailure,
  recognitionLanguage,
  recognizedText,
  speechRecognizerConstructor,
  type SpeechRecognizer,
} from './speechRecognition'

type AssistantModalProps = {
  /** The Account's Locale: the language dictation listens in. */
  locale: string
  onClose: () => void
  /** The server answered 409: the Account has no Assistant Settings any
   * more (removed on another device, or a rotated secret). The shell
   * closes the modal and hides the button. */
  onNoSettings: () => void
}

/** One line of the conversation as shown: the user's sentence or the
 * Assistant's written reply. Error lines are the client's own words for a
 * failed turn, styled apart. */
type Line = {
  id: number
  role: 'user' | 'assistant'
  text: string
  error?: boolean
}

let nextLineId = 0

/** The running Dictation: its recognizer, to stop it and send what was
 * heard, and how to drop it — end it without sending or sounding its end. */
type Dictation = {
  recognizer: SpeechRecognizer
  drop: () => void
}

/** The Assistant modal (ADR-0035, issues #122/#132): a thin chat screen,
 * centered like every modal (ADR-0008). The transcript the server needs —
 * every message as last received, tool calls and results included — is
 * component state carried back untouched on each Send; what the user sees
 * is only their sentences and the written replies. Nothing is stored:
 * closing the modal unmounts it and the conversation is gone, as the ADR
 * wants (the server derives from the transcript which Drafts belong to
 * the open conversation, so a new conversation cannot touch the old one's
 * Drafts).
 *
 * Send posts through the api, whose transport bumps the cache clock on
 * success (ADR-0022), so the Transactions tab refetches its Drafts in the
 * background while the reply is read. The server's replies for its bounds
 * and the provider's failures (issue #129) come back as ordinary replies
 * and show as ordinary lines; only the statuses that are not replies get
 * the client's own line: the hourly bound (429) as an ordinary Assistant
 * line, since it is the server's bound speaking, anything else as a
 * failure line. On a failed turn the sentence goes back into the box.
 *
 * Dictation (issue #133; its rules are the CONTEXT.md term) listens through
 * the browser's speech recognition in the Account's Locale and is sent as
 * an ordinary turn, so a phone-like "open and speak" needs no Send. Where
 * the browser has no recognizer there is no microphone and the modal opens
 * to the box alone. */
export function AssistantModal({ locale, onClose, onNoSettings }: AssistantModalProps) {
  const { formatMessage } = useIntl()
  const [transcript, setTranscript] = useState<AssistantMessage[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [dictationFailed, setDictationFailed] = useState(false)
  const dictationRef = useRef<Dictation | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const Recognizer = speechRecognizerConstructor()

  // Opening the Assistant starts a Dictation (issue #133); one still running
  // when the modal closes is dropped with it.
  useEffect(() => {
    startDictation()
    return () => dictationRef.current?.drop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, [])

  // Keep the newest line in view as the conversation grows.
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [lines, busy])

  const handleSend = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Sending the box is choosing the box: the Dictation gives way.
    dictationRef.current?.drop()
    void sendSentence(text.trim())
  }

  /** One turn: the sentence typed or dictated goes to the server with the
   * transcript as last received. */
  const sendSentence = async (sentence: string) => {
    if (sentence === '' || busy) return
    const userLine: Line = { id: ++nextLineId, role: 'user', text: sentence }
    setLines((current) => [...current, userLine])
    setText('')
    setBusy(true)
    try {
      const result = await sendAssistantTurn(token, transcript, sentence)
      setTranscript((current) => [...current, ...result.transcript_tail])
      setLines((current) => [
        ...current,
        { id: ++nextLineId, role: 'assistant', text: result.reply },
      ])
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.status === 409) {
        onNoSettings()
        return
      }
      const hourlyBound = failure instanceof ApiError && failure.status === 429
      // The turn did not happen: the sentence is not in the transcript and
      // goes back into the box for a retry; the line that failed says why.
      setLines((current) => [
        ...current.filter((line) => line.id !== userLine.id),
        {
          id: ++nextLineId,
          role: 'assistant',
          text: formatMessage({ id: hourlyBound ? 'assistant.error.hourly' : 'assistant.error.generic' }),
          error: !hourlyBound,
        },
      ])
      setText(sentence)
    } finally {
      setBusy(false)
    }
  }

  // A Dictation outlives the render that started it: its end reads the box
  // and sends through the latest render's state.
  const textRef = useRef(text)
  textRef.current = text
  const sendRef = useRef(sendSentence)
  sendRef.current = sendSentence

  const toggleDictation = () => {
    if (dictationRef.current !== null) {
      dictationRef.current.recognizer.stop()
      return
    }
    startDictation()
  }

  function startDictation() {
    if (Recognizer === null) return
    // Within the tap that opened the Assistant or pressed the microphone, so
    // the browser lets the tones play once the microphone is open.
    primeTones()
    const recognizer = new Recognizer()
    recognizer.lang = recognitionLanguage(locale)
    recognizer.continuous = false
    recognizer.interimResults = false
    let heard = ''
    let dropped = false
    let started = false
    const release = () => {
      dictationRef.current = null
      setListening(false)
    }
    recognizer.onstart = () => {
      if (dropped) return
      started = true
      playStartTone()
    }
    recognizer.onresult = (event) => {
      heard = recognizedText(event)
    }
    recognizer.onerror = (event) => {
      if (!dropped && isDictationFailure(event.error)) setDictationFailed(true)
    }
    recognizer.onend = () => {
      // A dropped recognizer was released when it was dropped and ends late
      // (Chrome fires `end` after `abort` returns; StrictMode drops the
      // first recognizer of every open): its end must not touch the
      // Dictation running now.
      if (dropped) return
      release()
      // The end tone answers a start tone: a refused microphone sounds nothing.
      if (started) playStopTone()
      // What was heard is the next turn, after anything already typed.
      if (heard !== '') void sendRef.current(`${textRef.current.trim()} ${heard}`.trim())
    }
    dictationRef.current = {
      recognizer,
      drop: () => {
        dropped = true
        release()
        recognizer.abort()
      },
    }
    setDictationFailed(false)
    setListening(true)
    try {
      recognizer.start()
    } catch {
      // A recognizer that will not start is a failure the user did not choose.
      release()
      setDictationFailed(true)
    }
  }

  const title = formatMessage({ id: 'assistant.title' })

  return (
    <ModalShell label={title} onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={formatMessage({ id: 'assistant.closeAria' })}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600"
        >
          ✕
        </button>
      </div>

      <div
        ref={logRef}
        role="log"
        aria-label={formatMessage({ id: 'assistant.log' })}
        className="mt-3 flex max-h-[50svh] min-h-32 flex-col gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3"
      >
        {lines.length === 0 && !busy && (
          <p className="text-xs text-slate-500">{formatMessage({ id: 'assistant.empty' })}</p>
        )}
        {lines.map((line) => (
          <p
            key={line.id}
            className={
              line.role === 'user'
                ? 'self-end rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white'
                : line.error
                  ? 'self-start rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800'
                  : 'self-start rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900'
            }
          >
            <span className="sr-only">
              {formatMessage({ id: line.role === 'user' ? 'assistant.line.user' : 'assistant.line.assistant' })}
              {': '}
            </span>
            {line.text}
          </p>
        ))}
        {busy && (
          <p className="self-start text-xs text-slate-500">
            {formatMessage({ id: 'assistant.thinking' })}
          </p>
        )}
      </div>

      {dictationFailed && (
        <p className="mt-2 text-xs text-red-700">{formatMessage({ id: 'assistant.dictation.error' })}</p>
      )}
      {listening && (
        <p className="mt-2 text-xs text-slate-500">{formatMessage({ id: 'assistant.dictation.listening' })}</p>
      )}

      <form onSubmit={handleSend} className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(event) => {
            // Typing means the user chose the box: the Dictation gives way.
            dictationRef.current?.drop()
            setText(event.target.value)
          }}
          aria-label={formatMessage({ id: 'assistant.input' })}
          placeholder={formatMessage({ id: 'assistant.input.placeholder' })}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
        />
        {Recognizer !== null && (
          <button
            type="button"
            onClick={toggleDictation}
            disabled={busy}
            aria-pressed={listening}
            aria-label={formatMessage({
              id: listening ? 'assistant.dictation.stop' : 'assistant.dictation.start',
            })}
            className={`rounded-lg border px-3 py-2 text-sm ${
              listening
                ? 'border-red-300 bg-red-50 text-red-700'
                : 'border-slate-300 text-slate-600'
            } disabled:opacity-60`}
          >
            🎤
          </button>
        )}
        <button
          type="submit"
          disabled={busy || text.trim() === ''}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {formatMessage({ id: busy ? 'assistant.sending' : 'assistant.send' })}
        </button>
      </form>
    </ModalShell>
  )
}
