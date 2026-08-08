import { useEffect, useState } from 'react'

import {
  TOKEN_KEY,
  fetchDashboardSummary,
  formatEuros,
  type DashboardSummary,
} from './api'

/** The Dashboard (T10): Net Worth and the current month's Income vs Expenses,
 * compared with a progress bar and text. Every number comes from the API —
 * the frontend holds no business rules, only presentation (spec decision #14):
 * the bar's share and the comparison sentence are derived from the summary. */
export function DashboardScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchDashboardSummary(token)
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your dashboard.')
      })
    return () => {
      cancelled = true
    }
  }, [token])

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

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {monthLabel(summary.month)} · Income vs Expenses
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
    </>
  )
}

/** "2026-08" → "August 2026", rendered in the user's locale. */
function monthLabel(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number)
  return new Date(year, monthIndex - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}
