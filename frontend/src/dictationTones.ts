/** The two short tones that frame a Dictation (issue #133), like a phone
 * assistant's: a rising chirp when the microphone is really listening, a
 * falling one when it stops. Synthesised with the Web Audio API, so no audio
 * file ships and no licence applies; they follow the device volume and there
 * is no setting to mute them. Where the browser has no Web Audio, or refuses
 * to play, the Dictation goes on in silence. The modal's tests mock this
 * module; the sound itself is judged by ear. */

type AudioContextConstructor = new () => AudioContext

let context: AudioContext | null = null

/** One context for the page, made on first use: browsers cap how many a page
 * may open. A context the browser suspended is resumed. */
function audioContext(): AudioContext | null {
  if (context === null) {
    const browser = window as unknown as {
      AudioContext?: AudioContextConstructor
      webkitAudioContext?: AudioContextConstructor
    }
    const Context = browser.AudioContext ?? browser.webkitAudioContext
    if (Context === undefined) return null
    context = new Context()
  }
  if (context.state === 'suspended') void context.resume().catch(() => {})
  return context
}

const NOTE_SECONDS = 0.07
const PEAK_GAIN = 0.15
/** How long each note takes to fade in, so it does not click. */
const FADE_IN_SECONDS = 0.01
/** Where each note fades out to: an exponential ramp cannot reach zero. */
const SILENT_GAIN = 0.0001

/** Two quick sine notes back to back, each faded in and out so neither
 * clicks. */
function chirp(fromHz: number, toHz: number) {
  try {
    const audio = audioContext()
    if (audio === null) return
    const start = audio.currentTime
    ;[fromHz, toHz].forEach((frequency, index) => {
      const at = start + index * NOTE_SECONDS
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, at)
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + FADE_IN_SECONDS)
      gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, at + NOTE_SECONDS)
      oscillator.connect(gain).connect(audio.destination)
      oscillator.start(at)
      oscillator.stop(at + NOTE_SECONDS)
    })
  } catch {
    // A tone is a courtesy: a browser that will not play it changes nothing.
  }
}

/** Makes or resumes the audio context while the user's tap still lets the
 * page start audio: the start tone comes later, once the microphone is open,
 * maybe after a permission prompt that outlasts the tap's grace. */
export function primeTones() {
  try {
    audioContext()
  } catch {
    // As for the tones themselves: silence changes nothing.
  }
}

/** The microphone is open: a rising chirp. */
export function playStartTone() {
  chirp(660, 880)
}

/** The Dictation ended: a falling chirp. */
export function playStopTone() {
  chirp(880, 660)
}
