import { describe, expect, it } from 'vitest'
import { projectBalance, projectTransfer } from './balanceProjection'

/** Regression suite for the double-count bug (issue #24): the "before" number
 * must exclude the Transaction being edited, so editing an Income from €200
 * to €50 on a €0 Wallet shows "0 → 50", never "200 → 250". */

describe('projectBalance (Expense/Income)', () => {
  it('creating an Income projects current Balance → current Balance + amount', () => {
    expect(projectBalance({ currentBalance: '200.00', type: 'income', newAmount: 50, editedAmount: null }))
      .toEqual({ before: 200, after: 250 })
  })

  it('creating an Expense projects current Balance → current Balance − amount', () => {
    expect(projectBalance({ currentBalance: '200.00', type: 'expense', newAmount: 50, editedAmount: null }))
      .toEqual({ before: 200, after: 150 })
  })

  it('editing an Income excludes the old amount from "before" (issue example)', () => {
    // Wallet was €0 before the Income of €200; editing it to €50.
    expect(projectBalance({ currentBalance: '200.00', type: 'income', newAmount: 50, editedAmount: '200.00' }))
      .toEqual({ before: 0, after: 50 })
  })

  it('editing an Expense excludes the old amount from "before"', () => {
    // Wallet was €0 before the Expense of €200; editing it to €50.
    expect(projectBalance({ currentBalance: '-200.00', type: 'expense', newAmount: 50, editedAmount: '200.00' }))
      .toEqual({ before: 0, after: -50 })
  })

  it('editing back to the same amount shows the Wallet Balance without the Transaction', () => {
    expect(projectBalance({ currentBalance: '200.00', type: 'income', newAmount: 200, editedAmount: '200.00' }))
      .toEqual({ before: 0, after: 200 })
  })

  it('an Expense exactly matching the Balance lands on zero — not negative', () => {
    expect(projectBalance({ currentBalance: '50.00', type: 'expense', newAmount: 50, editedAmount: null }).after)
      .toBe(0)
  })

  it('an Expense one cent over the Balance goes negative — the warning threshold', () => {
    expect(projectBalance({ currentBalance: '50.00', type: 'expense', newAmount: 50.01, editedAmount: null }).after)
      .toBe(-0.01)
  })
})

describe('projectTransfer', () => {
  it('creating a Transfer projects both Wallets from their current Balances', () => {
    expect(projectTransfer({ sourceBalance: '200.00', destinationBalance: '0.00', newAmount: 50, editedAmount: null }))
      .toEqual({
        source: { before: 200, after: 150 },
        destination: { before: 0, after: 50 },
      })
  })

  it('editing a Transfer excludes the old amount on both Wallets (issue example)', () => {
    // Both Wallets were €0 before the Transfer of €200; editing it to €50.
    expect(projectTransfer({ sourceBalance: '-200.00', destinationBalance: '200.00', newAmount: 50, editedAmount: '200.00' }))
      .toEqual({
        source: { before: 0, after: -50 },
        destination: { before: 0, after: 50 },
      })
  })

  it('editing a Transfer on Wallets with other history projects from the pre-Transfer Balance', () => {
    // Source was €1000 and destination €50 before the Transfer of €200.
    expect(projectTransfer({ sourceBalance: '800.00', destinationBalance: '250.00', newAmount: 50, editedAmount: '200.00' }))
      .toEqual({
        source: { before: 1000, after: 950 },
        destination: { before: 50, after: 100 },
      })
  })

  it('a Transfer exactly emptying a Cash source lands on zero — not negative', () => {
    expect(projectTransfer({ sourceBalance: '50.00', destinationBalance: '0.00', newAmount: 50, editedAmount: null })
      .source.after).toBe(0)
  })
})
