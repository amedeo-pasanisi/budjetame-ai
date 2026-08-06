import type { ReactNode } from 'react'

/** The app's mobile-first shell: a centered card on a slate background. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-slate-50 px-4">
      {children}
    </div>
  )
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <main className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {children}
    </main>
  )
}
