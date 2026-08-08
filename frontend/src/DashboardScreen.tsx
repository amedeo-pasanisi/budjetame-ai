import { useEffect, useState } from 'react'

import {
  TOKEN_KEY,
  fetchDashboardSummary,
  fetchExpenseTrend,
  formatEuros,
  type CategoryExpense,
  type DashboardSummary,
  type ExpenseTrend,
  type MonthBucket,
} from './api'
import { todayInRome } from './transactions'

/** The Dashboard: Net Worth, the reference month's Income vs Expenses and
 * expense pie, and a monthly expense trend over a user-picked range (T10,
 * T11, T12). All numbers come from the API — the frontend only renders
 * (spec decision #14): the bar chart's geometry and the month labels.
 *
 * The reference-month selector drives the month-scoped cards; the trend card
 * has its own From/To range (US27, US28). */
export function DashboardScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const currentMonth = todayInRome().slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [trendFrom, setTrendFrom] = useState(() => monthsAgo(currentMonth, 5))
  const [trendTo, setTrendTo] = useState(currentMonth)
  const [trend, setTrend] = useState<ExpenseTrend | null>(null)
  const [trendError, setTrendError] = useState<string | null>(null)

  // Keep the trend range valid: picking From after To (or To before From)
  // swaps the two instead of letting a reversed range 422 the request — the
  // user's intent was a range between the two months (T12).
  const handleTrendFrom = (value: string) => {
    if (value > trendTo) {
      setTrendFrom(trendTo)
      setTrendTo(value)
    } else {
      setTrendFrom(value)
    }
  }
  const handleTrendTo = (value: string) => {
    if (value < trendFrom) {
      setTrendTo(trendFrom)
      setTrendFrom(value)
    } else {
      setTrendTo(value)
    }
  }

  useEffect(() => {
    let cancelled = false
    // A refetch that fails must not leave a stale error on screen: clear it
    // before every load (a month change retries the summary).
    setLoadError(null)
    fetchDashboardSummary(token, month)
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your dashboard.')
      })
    return () => {
      cancelled = true
    }
  }, [token, month])

  useEffect(() => {
    let cancelled = false
    setTrendError(null)
    fetchExpenseTrend(token, trendFrom, trendTo)
      .then((data) => {
        if (!cancelled) setTrend(data)
      })
      .catch(() => {
        if (!cancelled) setTrendError('Could not load the expense trend.')
      })
    return () => {
      cancelled = true
    }
  }, [token, trendFrom, trendTo])

  if (loadError !== null) {
    return (
      <>
        <h2 className="font-semibold text-slate-900">Dashboard</h2>
        <p className="mt-2 text-sm text-red-600">{loadError}</p>
      </>
    )
  }
  if (summary === null) {
    return (
      <>
        <h2 className="font-semibold text-slate-900">Dashboard</h2>
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      </>
    )
  }

  return (
    <>
      <h2 className="font-semibold text-slate-900">Dashboard</h2>

      <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          Net Worth
        </p>
        <p className="mt-1 text-3xl font-semibold text-slate-900">
          {formatEuros(summary.net_worth)}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          The sum of every wallet balance — contact wallets included.
        </p>
      </section>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">Reference month</span>
        <input
          id="dashboard-month"
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {/* While the new month's summary is in flight, the loaded data is still
       * the previous month's — never title it with the new month (US27). */}
      {summary.month === month ? (
        <>
          <MonthCard summary={summary} month={month} />
          <PieCard summary={summary} month={month} />
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      )}

      <TrendCard
        trend={trend}
        fromMonth={trendFrom}
        toMonth={trendTo}
        onFromChange={handleTrendFrom}
        onToChange={handleTrendTo}
        error={trendError}
      />
    </>
  )
}


function MonthCard({ summary, month }: { summary: DashboardSummary; month: string }) {
  const income = Number.parseFloat(summary.income)
  const expenses = Number.parseFloat(summary.expenses)
  // Spending exceeds (or has no) income to compare against → the deficit bar.
  const overspent = expenses > 0 && (income === 0 || expenses > income)
  const barWidth =
    expenses === 0
      ? '0%'
      : income <= 0
        ? '100%'
        : `${Math.min((expenses / income) * 100, 100)}%`

  const comparisonText = (() => {
    if (income === 0 && expenses === 0) {
      return 'No income or expenses recorded this month yet.'
    }
    if (income === 0) {
      return `You spent ${formatEuros(summary.expenses)} with no income recorded this month.`
    }
    const percent = Math.round((expenses / income) * 100)
    if (expenses > income) {
      return `You spent ${percent}% of what you earned — ${formatEuros(
        summary.expenses,
      )} out of ${formatEuros(summary.income)}.`
    }
    const kept = (income - expenses).toFixed(2)
    return `You kept ${formatEuros(kept)} of the ${formatEuros(
      summary.income,
    )} you earned this month.`
  })()

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {monthLabel(month)} · Income vs Expenses
      </p>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">Income</span>
          <span className="font-semibold text-emerald-700">
            {formatEuros(summary.income)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">Expenses</span>
          <span className="font-semibold text-red-600">
            {formatEuros(summary.expenses)}
          </span>
        </div>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${overspent ? 'bg-red-500' : 'bg-indigo-600'}`}
          style={{ width: barWidth }}
        />
      </div>

      <p className="mt-3 text-sm text-slate-600">{comparisonText}</p>
    </section>
  )
}

function PieCard({ summary, month }: { summary: DashboardSummary; month: string }) {
  const slices = summary.expenses_by_category
  const total = slices.reduce(
    (sum, slice) => sum + Number.parseFloat(slice.amount),
    0,
  )

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {monthLabel(month)} · Expenses by Category
      </p>

      {slices.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No expenses recorded in {monthLabel(month)}.
        </p>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-around">
          <DonutChart slices={slices} total={total} centerLabel={formatEuros(summary.expenses)} />
          <PieLegend slices={slices} total={total} />
        </div>
      )}
    </section>
  )
}

/** The neutral gray for the "Uncategorized" slice — the backend sends no
 * color for it, and the rendering choice stays in the frontend (decision #14). */
const UNCATEGORIZED_COLOR = '#94a3b8'

function sliceColor(slice: CategoryExpense): string {
  return slice.color ?? UNCATEGORIZED_COLOR
}

/** A lightweight SVG donut (no chart dependency): one stroke segment per slice,
 * laid out clockwise from 12 o'clock. */
function DonutChart({
  slices,
  total,
  centerLabel,
}: {
  slices: CategoryExpense[]
  total: number
  centerLabel: string
}) {
  const radius = 40
  const circumference = 2 * Math.PI * radius
  let cumulative = 0
  return (
    <svg
      viewBox="0 0 100 100"
      className="h-44 w-44"
      role="img"
      aria-label="Expenses by category"
    >
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth="18"
      />
      {total > 0 &&
        slices.map((slice) => {
          const length = (Number.parseFloat(slice.amount) / total) * circumference
          const offset = cumulative
          cumulative += length
          return (
            <circle
              key={slice.category_id ?? 'uncategorized'}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={sliceColor(slice)}
              strokeWidth="18"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          )
        })}
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-slate-900 text-xl font-semibold"
      >
        {centerLabel}
      </text>
    </svg>
  )
}

function PieLegend({ slices, total }: { slices: CategoryExpense[]; total: number }) {
  return (
    <ul className="w-full space-y-2">
      {slices.map((slice) => {
        const share =
          total > 0 ? Math.round((Number.parseFloat(slice.amount) / total) * 100) : 0
        return (
          <li key={slice.category_id ?? 'uncategorized'} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: sliceColor(slice) }}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
              {slice.icon !== null ? `${slice.icon} ` : ''}
              {slice.name}
            </span>
            <span className="shrink-0 text-sm font-medium text-slate-900">
              {formatEuros(slice.amount)} · {share}%
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** The monthly expense trend over a user-picked month range (T12, US28): a
 * From/To range picker and a bar chart — X-axis months, Y-axis total expenses,
 * bucketed server-side in Europe/Rome. While a new range's data is in flight,
 * the loaded trend is still the old range's — never title it with the new one. */
function TrendCard({
  trend,
  fromMonth,
  toMonth,
  onFromChange,
  onToChange,
  error,
}: {
  trend: ExpenseTrend | null
  fromMonth: string
  toMonth: string
  onFromChange: (month: string) => void
  onToChange: (month: string) => void
  error: string | null
}) {
  const loaded = trend !== null && trend.from_month === fromMonth && trend.to_month === toMonth
  const empty =
    loaded &&
    trend.months.every((bucket) => Number.parseFloat(bucket.expenses) === 0)

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        Expenses Trend · {monthLabel(fromMonth)} – {monthLabel(toMonth)}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="trend-from" className="block text-sm font-medium text-slate-700">
            From
          </label>
          <input
            id="trend-from"
            type="month"
            value={fromMonth}
            onChange={(event) => onFromChange(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="trend-to" className="block text-sm font-medium text-slate-700">
            To
          </label>
          <input
            id="trend-to"
            type="month"
            value={toMonth}
            onChange={(event) => onToChange(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      {error !== null && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!loaded ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : empty ? (
        <p className="mt-4 text-sm text-slate-500">
          No expenses recorded between {monthLabel(fromMonth)} and {monthLabel(toMonth)}.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <TrendChart months={trend.months} />
        </div>      )}
    </section>
  )
}

/** A dependency-free SVG bar chart: one bar per month, scaled to the tallest,
 * with the amount above each bar and a Y-axis (gridlines + € labels) so the
 * euro magnitude is readable at a glance (T12 AC: X months, Y total expenses).
 * Wide ranges scroll horizontally so every month stays readable. */
function TrendChart({ months }: { months: MonthBucket[] }) {
  const values = months.map((bucket) => Number.parseFloat(bucket.expenses))
  const max = Math.max(...values, 1)
  const barWidth = 22
  const gap = 12
  const leftPad = 30
  const topPad = 20
  const labelHeight = 16
  const height = 150
  const plotHeight = height - topPad - labelHeight
  const plotWidth = months.length * (barWidth + gap)
  const gridlines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <svg
      viewBox={`0 0 ${leftPad + gap + plotWidth} ${height}`}
      style={{ minWidth: `${leftPad + months.length * 40}px` }}
      className="block"
      role="img"
      aria-label="Monthly expenses trend"
    >
      {gridlines.map((frac) => {
        const y = topPad + plotHeight * (1 - frac)
        return (
          <g key={frac}>
            <line
              x1={leftPad}
              x2={leftPad + plotWidth}
              y1={y}
              y2={y}
              className="stroke-slate-200"
              strokeDasharray="3 3"
            />
            <text
              x={leftPad - 4}
              y={y + 3}
              textAnchor="end"
              className="fill-slate-400 text-[8px]"
            >
              {frac === 0 ? '0' : `€${Math.round(max * frac)}`}
            </text>
          </g>
        )
      })}
      {months.map((bucket, index) => {
        const value = Number.parseFloat(bucket.expenses)
        const barHeight = (value / max) * plotHeight
        const x = leftPad + gap + index * (barWidth + gap)
        const y = topPad + plotHeight - barHeight
        return (
          <g key={bucket.month}>
            {value > 0 && (
              <text
                x={x + barWidth / 2}
                y={y - 5}
                textAnchor="middle"
                className="fill-slate-600 text-[9px]"
              >
                {formatEuros(bucket.expenses)}
              </text>
            )}
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, value > 0 ? 2 : 0)}
              rx={3}
              className={value > 0 ? 'fill-indigo-600' : 'fill-slate-200'}
            />
            <text
              x={x + barWidth / 2}
              y={height - 5}
              textAnchor="middle"
              className="fill-slate-500 text-[9px]"
            >
              {shortMonthLabel(bucket.month)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** "2026-08" → "Aug"; January bars also carry the year so long ranges stay
 * readable ("Jan ’26"). */
function shortMonthLabel(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number)
  const short = new Date(year, monthIndex - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
  })
  return monthIndex === 1 ? `${short} ’${String(year).slice(2)}` : short
}

/** "2026-08" → "August 2026", rendered in the user's locale. */
function monthLabel(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number)
  return new Date(year, monthIndex - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

/** The YYYY-MM month `count` months before `current`, e.g. monthsAgo("2026-08", 5). */
function monthsAgo(current: string, count: number): string {
  const [year, month] = current.split('-').map(Number)
  const total = year * 12 + (month - 1) - count
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`
}
