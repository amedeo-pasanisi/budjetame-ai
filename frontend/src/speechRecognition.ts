/** The browser's speech recognition behind one small seam (ADR-0035,
 * issues #122/#132/#133): the Assistant modal's Dictation listens through
 * `window.SpeechRecognition` (Chrome ships it prefixed as
 * `webkitSpeechRecognition`) in the Account's Locale. TypeScript's DOM lib
 * declares the event types but not the constructor, so the minimal surface
 * the modal uses is declared here; where the browser has no recognizer the
 * modal shows no microphone. Tests put a fake constructor on `window`. */

export type SpeechRecognizer = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  /** The recognizer has begun listening. Chrome fires it once the
   * microphone is granted, never for a refused one. */
  onstart: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognizerConstructor = new () => SpeechRecognizer

/** The recognizer constructor the browser offers, or null where it has
 * none. Read at call time, not module load, so a page that gains one (or
 * a test that stubs one) is seen. */
export function speechRecognizerConstructor(): SpeechRecognizerConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognizerConstructor
    webkitSpeechRecognition?: SpeechRecognizerConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** The BCP 47 tag the recognizer listens in, from the Account's Locale:
 * Italian is `it-IT`, everything else `en-US`. */
export function recognitionLanguage(locale: string): string {
  return locale === 'it' ? 'it-IT' : 'en-US'
}

/** The recognizer errors that are the user's own choice — the microphone
 * refused, now or for good (the browser cannot tell the two apart), or a
 * Dictation the app dropped — and silence: none is a failure worth a line
 * (issue #133). */
const QUIET_ERRORS = new Set<SpeechRecognitionErrorCode>([
  'not-allowed',
  'service-not-allowed',
  'aborted',
  'no-speech',
])

/** Whether a recognizer error is a failure the user did not choose. */
export function isDictationFailure(error: SpeechRecognitionErrorCode): boolean {
  return !QUIET_ERRORS.has(error)
}

/** The sentence a result event carries: the best alternative of every
 * final result, joined — one dictation, one sentence. */
export function recognizedText(event: SpeechRecognitionEvent): string {
  const parts: string[] = []
  for (let i = 0; i < event.results.length; i += 1) {
    const result = event.results[i]
    if (result.length > 0) parts.push(result[0].transcript)
  }
  return parts.join(' ').trim()
}
