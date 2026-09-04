/**
 * The monthly trend plot's geometry in pixels — the web twin of the
 * Android app's TrendChartGeometry (issue #95): one shared description of
 * where bars and gridlines sit, so drawing and the tap hit targets can
 * never drift apart.
 *
 * The rule: the plot always fills the card's inner width — the content
 * width is max(fixed geometry, available card width). While the fixed
 * geometry fits, the bars keep the original layout exactly: a [barGap]
 * leading slot, then the bars with [barGap] between them, the last bar
 * flush with the plot's end. Once the canvas is wider, the leftover
 * width splits evenly across count + 1 slots — leading, between the
 * bars, and trailing all equal — so the bars spread evenly across the
 * full plot with their widths unchanged, the gaps grown symmetrically,
 * and the gridlines spanning the whole content width.
 */
export interface TrendChartGeometry {
  /** Number of bars (months). */
  count: number
  /** Bar width, px. */
  barWidth: number
  /** The fixed layout's gap between bars, px. */
  barGap: number
  /** The left pad, px, reserved for the Y axis' € labels. */
  leftPad: number
  /** The content (canvas) width, px, the plot must fill. */
  contentWidth: number
  /** The fixed geometry's content width: the left pad plus one full
   * bar+gap slot per bar. */
  fixedWidth: number
  /** True when the canvas is wider than the fixed geometry, so the slots
   * grow and the bars spread to fill it. */
  stretched: boolean
  /** The slot between two bar starts minus the bar width: [barGap] while
   * the fixed geometry fits; once stretched, the whole leftover
   * (contentWidth − leftPad − count·barWidth) splits evenly across the
   * count + 1 slots, so the leading and trailing insets equal the gaps
   * between the bars. */
  gap: number
  /** One column's pitch: the bar width plus the following slot. */
  barStep: number
  /** The left edge of bar [index]. */
  barLeft(index: number): number
  /** The horizontal center of bar [index]. */
  barCenter(index: number): number
}

export function trendChartGeometry({
  count,
  barWidth,
  barGap,
  leftPad,
  contentWidth,
}: {
  /** Number of bars (months). */
  count: number
  /** Bar width, px. */
  barWidth: number
  /** The fixed layout's gap between bars, px. */
  barGap: number
  /** The left pad, px, reserved for the Y axis' € labels. */
  leftPad: number
  /** The content (canvas) width, px, the plot must fill. */
  contentWidth: number
}): TrendChartGeometry {
  if (count < 1) throw new Error('a trend chart needs at least one bar')
  if (barWidth <= 0) throw new Error('barWidth must be positive')
  if (barGap < 0) throw new Error('barGap must be non-negative')
  if (leftPad < 0) throw new Error('leftPad must be non-negative')
  if (contentWidth < 0) throw new Error('contentWidth must be non-negative')

  const fixedWidth = leftPad + count * (barWidth + barGap)
  const gap =
    contentWidth <= fixedWidth
      ? barGap
      : (contentWidth - leftPad - count * barWidth) / (count + 1)
  const barStep = barWidth + gap
  return {
    count,
    barWidth,
    barGap,
    leftPad,
    contentWidth,
    fixedWidth,
    stretched: contentWidth > fixedWidth,
    gap,
    barStep,
    barLeft: (index) => leftPad + gap + index * barStep,
    barCenter: (index) => leftPad + gap + index * barStep + barWidth / 2,
  }
}

/**
 * The tapped bar's value chip top edge (issue #95): the chip floats
 * [chipGap] above the bar's top — and never above the chart's top edge,
 * so a near-full-height bar's chip stays inside the chart. In content
 * pixels, whose y = 0 is the chart's top edge.
 */
export function chipTopForBar(topOfBar: number, chipHeight: number, chipGap: number): number {
  return Math.max(topOfBar - chipGap - chipHeight, 0)
}

/**
 * The tapped bar's value chip left edge (issue #95): centered on the bar
 * and kept inside the chart's sides — a chip wider than the first bar's
 * inset never starts left of the chart, and over the last fixed-layout
 * bar (flush with the content's end) it never runs past the content's
 * right edge.
 */
export function chipLeftForBar(
  barCenter: number,
  chipWidth: number,
  contentWidth: number,
): number {
  return Math.min(
    Math.max(barCenter - chipWidth / 2, 0),
    Math.max(contentWidth - chipWidth, 0),
  )
}
