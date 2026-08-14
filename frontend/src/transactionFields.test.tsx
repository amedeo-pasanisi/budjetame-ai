/** Component-test seam (issue #29): jsdom + @testing-library/react render a
 * real component and assert on its output. TypeSelector is the smoke target —
 * pure presentational props, no API or map dependencies — and doubles as the
 * first test for the type-cascade forks module (issue #17). */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TypeSelector } from './transactionFields'

describe('TypeSelector', () => {
  it('renders the three transaction type buttons', () => {
    render(<TypeSelector active="expense" disabled={false} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Expense' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Income' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeInTheDocument()
  })

  it('reports a click with the selected type', () => {
    const onSelect = vi.fn()
    render(<TypeSelector active="expense" disabled={false} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    expect(onSelect).toHaveBeenCalledWith('transfer')
  })

  it('disables the type buttons while a transaction is being saved', () => {
    render(<TypeSelector active="expense" disabled={true} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Income' })).toBeDisabled()
  })
})
