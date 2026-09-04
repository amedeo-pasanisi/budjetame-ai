import { describe, expect, it } from 'vitest'
import {
  chipLeftForBar,
  chipTopForBar,
  trendChartGeometry,
} from './trendChart'

/**
 * The trend plot's pure geometry (issue #95, mirroring the Android
 * TrendChartGeometryTest): while the fixed geometry fits the card, the
 * bars keep the original layout — a barGap leading slot, the last bar
 * flush with the plot's end; once the canvas is wider, the leftover
 * width splits evenly across count + 1 slots, so the bars spread across
 * the full plot with their widths unchanged, symmetric gaps, and
 * gridlines spanning the whole content width. The tap columns always
 * track the bars, in both layouts.
 */

const barWidth = 22
const barGap = 12
const leftPad = 30

function geometry(count: number, contentWidth: number) {
  return trendChartGeometry({
    count,
    barWidth,
    barGap,
    leftPad,
    contentWidth,
  })
}

/** fixedWidth for count bars at the chart's constants. */
function fixedWidth(count: number): number {
  return leftPad + count * (barWidth + barGap)
}

describe('fixed layout — a wide range never stretches', () => {
  it('keeps the fixed geometry at exactly the fixed content width', () => {
    const g = geometry(12, fixedWidth(12)) // 438

    expect(g.stretched).toBe(false)
    expect(g.gap).toBe(barGap)
    // Bars sit exactly where they always did: barGap leading slot,
    // barGap between bars, the last bar flush with the plot's end.
    expect(g.barLeft(0)).toBe(leftPad + barGap)
    expect(g.barStep).toBe(barWidth + barGap)
    expect(g.barLeft(11) + barWidth).toBe(g.contentWidth)
    expect(g.contentWidth).toBe(fixedWidth(12))
  })

  it('survives a scrolling canvas wider than the card', () => {
    // The 12-month content (438) inside a card that is only 300 wide:
    // the content width stays the fixed geometry — unchanged, scrollable.
    const g = geometry(12, 438)

    expect(g.stretched).toBe(false)
    expect(g.contentWidth).toBe(fixedWidth(12))
    expect(g.gap).toBe(barGap)
    expect(g.barLeft(0)).toBe(leftPad + barGap)
  })
})

describe('stretched layout — short ranges fill the card', () => {
  it('spreads three bars evenly across the wider canvas', () => {
    const g = geometry(3, 300)

    expect(g.stretched).toBe(true)
    // 300 − leftPad(30) − 3·22 leaves 204 over 4 symmetric slots.
    expect(g.gap).toBe(51)
    expect(g.barLeft(0)).toBe(81)
    expect(g.barLeft(1)).toBe(154)
    expect(g.barLeft(2)).toBe(227)
    // Leading inset == trailing inset == the grown gap: symmetric.
    expect(g.barLeft(0) - leftPad).toBe(g.gap)
    expect(g.contentWidth - (g.barLeft(2) + barWidth)).toBe(g.gap)
    // Bar widths never change.
    expect(g.barStep - g.gap).toBe(barWidth)
  })

  it('centers a single bar in the wider canvas', () => {
    const g = geometry(1, 300)

    expect(g.stretched).toBe(true)
    expect(g.barCenter(0)).toBe(leftPad + (g.contentWidth - leftPad) / 2)
    expect(g.barLeft(0) - leftPad).toBe(g.gap)
    expect(g.contentWidth - (g.barLeft(0) + barWidth)).toBe(g.gap)
  })

  it('spreads two bars with symmetric insets', () => {
    const g = geometry(2, 300)

    expect(g.stretched).toBe(true)
    // 300 − 30 − 44 = 226 over 3 slots.
    expect(g.gap).toBeCloseTo(226 / 3, 6)
    // Bar widths never change.
    expect(g.barWidth).toBe(barWidth)
    expect(g.barLeft(0) - leftPad).toBeCloseTo(g.gap, 6)
    expect(g.contentWidth - (g.barLeft(1) + barWidth)).toBeCloseTo(g.gap, 6)
  })
})

describe('the tapped bar\'s value chip — pure placement rules', () => {
  it('floats just above the bar', () => {
    // A baseline bar's top sits 134 px down the 150 px chart; the
    // 20 px chip keeps its 4 px gap below it.
    expect(chipTopForBar(134, 20, 4)).toBe(110)
  })

  it('never rises above the chart\'s top edge', () => {
    // A full-height bar's top sits at the plot's top (ChartTopPad, 20):
    // the chip would start above the chart, so it clamps to the chart's
    // top edge — and so does any bar closer to the top than the chip
    // plus its gap.
    expect(chipTopForBar(20, 20, 4)).toBe(0)
    expect(chipTopForBar(23, 20, 4)).toBe(0)
    // The threshold bar top (gap + chip height) exactly touches the top
    // edge; just below it the chip floats normally.
    expect(chipTopForBar(24, 20, 4)).toBe(0)
    expect(chipTopForBar(25, 20, 4)).toBe(1)
  })

  it('centers on the bar', () => {
    expect(chipLeftForBar(53, 40, 234)).toBe(33)
  })

  it('stays inside the chart at both edges', () => {
    // A chip wider than the first bar's inset never starts left of the
    // chart.
    expect(chipLeftForBar(53, 120, 234)).toBe(0)
    // The last fixed-layout bar sits flush with the content's end
    // (center 234 − 11); a chip centered on it would run past the right
    // edge, so it is pushed back inside the content.
    expect(chipLeftForBar(223, 46, 234)).toBe(188)
    // A mid-plot bar keeps the chip centered on it (never clamped).
    expect(chipLeftForBar(100, 58, 234)).toBe(71)
  })
})
