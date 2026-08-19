import { useRef } from 'react'
import type { DOMAttributes, Touch, TouchEvent } from 'react'

/** The minimum horizontal travel for a gesture to count as a tab swipe. */
const SWIPE_THRESHOLD = 60

/** Gestures starting within this many pixels of a screen edge belong to the
 * browser (back/forward) and are ignored. */
const EDGE_MARGIN = 20

/** Controls that own horizontal gestures (text selection, sliders, links):
 * a swipe starting on one never switches tabs. Links share this selector —
 * today none live outside the modals, whose overlay stops its own touches. */
const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a'

type SwipePoint = { x: number; y: number }

/** Would a gesture starting on this touch have to be ignored by the tab
 * swipe? Two owners beat it: the browser's edge gestures, and the control's
 * own horizontal interactions (text selection, sliders, links). */
function isIgnorableStart(touch: Touch): boolean {
  const { clientX, clientY } = touch
  if (
    clientX <= EDGE_MARGIN ||
    clientY <= EDGE_MARGIN ||
    clientX >= window.innerWidth - EDGE_MARGIN ||
    clientY >= window.innerHeight - EDGE_MARGIN
  ) {
    return true
  }
  const target = touch.target
  return !(target instanceof Element) || target.closest(INTERACTIVE_SELECTOR) !== null
}

/**
 * Tab switching by horizontal swipe (issue #51). Attach the returned handlers
 * to the content area: a single-touch gesture that travels at least
 * {@link SWIPE_THRESHOLD}px horizontally — and farther horizontally than
 * vertically — switches the tab once, on touch end, in the gesture's
 * direction (right-to-left: next, left-to-right: previous). The switch is
 * instant; there is no finger-following. Vertical scrolls, gestures that
 * start on a control or within {@link EDGE_MARGIN}px of a screen edge, and
 * touches inside an open modal (the modal shell stops its own touches) never
 * switch. Touch events only — mouse drags do nothing.
 */
export function useTabSwipe(onSwipe: (direction: 1 | -1) => void): Pick<
  DOMAttributes<HTMLElement>,
  'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel'
> {
  const gesture = useRef<{ start: SwipePoint; last: SwipePoint } | null>(null)

  const startGesture = (event: TouchEvent<HTMLElement>) => {
    // A swipe is a single-touch gesture; a second finger cancels it.
    if (event.touches.length !== 1) {
      gesture.current = null
      return
    }
    const touch = event.touches[0]
    gesture.current = isIgnorableStart(touch)
      ? null
      : {
          start: { x: touch.clientX, y: touch.clientY },
          last: { x: touch.clientX, y: touch.clientY },
        }
  }

  const moveGesture = (event: TouchEvent<HTMLElement>) => {
    if (gesture.current === null) {
      return
    }
    if (event.touches.length !== 1) {
      gesture.current = null
      return
    }
    gesture.current.last = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    }
  }

  const finishGesture = () => {
    const current = gesture.current
    gesture.current = null
    if (current === null) {
      return
    }
    const dx = current.last.x - current.start.x
    const dy = current.last.y - current.start.y
    if (Math.abs(dx) < SWIPE_THRESHOLD) {
      return
    }
    // Horizontal travel must exceed vertical travel — ties go to the scroll,
    // never to the tab switch.
    if (Math.abs(dx) <= Math.abs(dy)) {
      return
    }
    onSwipe(dx < 0 ? 1 : -1)
  }

  return {
    onTouchStart: startGesture,
    onTouchMove: moveGesture,
    onTouchEnd: finishGesture,
    // The browser took over (e.g. it turned the gesture into a scroll): a
    // cancelled gesture never switches tabs.
    onTouchCancel: () => {
      gesture.current = null
    },
  }
}
