/** The shared validation layer (ADR-0029, issue #102): the tolerant Amount
 * Input parser, the FieldErrors type and the Field Error render helper. This
 * is the umbrella spec's Seam 2 — the exhaustive Amount Input matrix lives
 * here; the forms' parse-through-the-UI cases live in their own suites. */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldError } from './FieldError'
import { fieldErrorId, fieldErrorProps, parseAmount } from './validation'

describe('parseAmount — the Amount Input contract (ADR-0029)', () => {
  it('parses a dot-decimal amount', () => {
    expect(parseAmount('17.5')).toBe(17.5)
  })

  it('parses a comma-decimal amount to the same value', () => {
    expect(parseAmount('17,5')).toBe(17.5)
  })

  it('parses a US grouped amount', () => {
    expect(parseAmount('2,002.01')).toBe(2002.01)
  })

  it('parses an Italian grouped amount', () => {
    expect(parseAmount('1.000.420,45')).toBe(1000420.45)
  })

  it('reads a lone dot-grouped amount as an integer, not a decimal', () => {
    expect(parseAmount('1.000')).toBe(1000)
  })

  it('reads a lone comma-grouped amount as an integer, not a decimal', () => {
    expect(parseAmount('2,500')).toBe(2500)
  })

  it('parses a grouped amount with comma decimals', () => {
    expect(parseAmount('1.000,00')).toBe(1000)
  })

  it('trims surrounding whitespace', () => {
    expect(parseAmount('  17.5  ')).toBe(17.5)
  })

  it('rejects the empty string', () => {
    expect(parseAmount('')).toBeNull()
  })

  it('rejects a whitespace-only string', () => {
    expect(parseAmount('   ')).toBeNull()
  })

  it('rejects letters', () => {
    expect(parseAmount('abc')).toBeNull()
  })

  it('rejects a trailing letter', () => {
    expect(parseAmount('17.5abc')).toBeNull()
  })

  it('rejects an exponent', () => {
    expect(parseAmount('1e5')).toBeNull()
  })

  it('rejects a whitespace grouping', () => {
    expect(parseAmount('1 000')).toBeNull()
  })

  it('rejects multiple decimal points', () => {
    expect(parseAmount('1.2.3')).toBeNull()
  })

  it('rejects a second comma decimal', () => {
    expect(parseAmount('1,2,3')).toBeNull()
  })

  it('rejects a broken grouping chain', () => {
    expect(parseAmount('1.5.5')).toBeNull()
  })

  it('rejects zero', () => {
    expect(parseAmount('0')).toBeNull()
  })

  it('rejects zero with cents', () => {
    expect(parseAmount('0.00')).toBeNull()
  })

  it('rejects a negative amount', () => {
    expect(parseAmount('-5')).toBeNull()
  })

  it('rejects a leading sign', () => {
    expect(parseAmount('+5')).toBeNull()
  })

  it('rejects an empty integer part', () => {
    expect(parseAmount(',5')).toBeNull()
  })
})

describe('FieldError — the Field Error render helper (ADR-0029)', () => {
  it('renders nothing when the field has no error', () => {
    render(<FieldError field="amount" errors={{}} />)
    expect(screen.queryByText('Enter an amount')).not.toBeInTheDocument()
  })

  it('ignores errors that belong to other fields', () => {
    render(<FieldError field="wallet" errors={{ amount: 'Enter an amount' }} />)
    expect(screen.queryByText('Enter an amount')).not.toBeInTheDocument()
  })

  it('renders the message beneath its field with the field error id', () => {
    render(<FieldError field="amount" errors={{ amount: 'Enter an amount' }} />)
    const error = screen.getByText('Enter an amount')
    expect(error).toHaveAttribute('id', fieldErrorId('amount'))
  })

  it('wires aria-invalid and aria-describedby onto the field it describes', () => {
    const errors = { amount: 'Enter an amount' }
    render(
      <>
        <input id="amount" {...fieldErrorProps('amount', errors)} />
        <FieldError field="amount" errors={errors} />
      </>,
    )
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    // The described-by target is exactly the rendered error's id.
    expect(input).toHaveAttribute('aria-describedby', fieldErrorId('amount'))
    expect(screen.getByText('Enter an amount')).toHaveAttribute('id', fieldErrorId('amount'))
  })

  it('leaves a valid field without any error aria wiring', () => {
    render(<input id="amount" {...fieldErrorProps('amount', {})} />)
    const input = screen.getByRole('textbox')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
  })
})