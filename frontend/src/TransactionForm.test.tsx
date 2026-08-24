/** The Place reference end-to-end in the form (issue #34): a search pick
 * stores name + place_id with the Transaction; the form shows "📍 {name}"
 * instead of raw coordinates when a Place is present; and a tap re-pick, a
 * GPS pick, or Remove clears the Place. The API client and the map picker are
 * mocked; the location module is real except for getGpsPosition (device GPS
 * does not exist in jsdom). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { TransactionForm } from './TransactionForm'
import type { Category, RecurringCost, RecurringIncome, Transaction, Wallet } from './api'
import type { LatLng, Place } from './location'

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  TOKEN_KEY: 'budjetame.token',
  apiErrorMessage: () => 'Could not save the transaction.',
  formatEuros: (value: string) => `€${value}`,
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))

// The map picker is a separate seam (issue #27); its onPick is captured so a
// test can simulate a tap or a search pick from the map.
const picker = vi.hoisted(() => ({
  onPick: null as null | ((position: LatLng, place?: Place) => void),
}))

vi.mock('./MapPicker', () => ({
  MapPicker: ({ onPick }: { onPick: (position: LatLng, place?: Place) => void }) => {
    picker.onPick = onPick
    return <div data-testid="map-picker" />
  },
}))

// Device GPS does not exist in jsdom; the mocked lookup resolves per test.
vi.mock('./location', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./location')>()
  return { ...actual, getGpsPosition: vi.fn() }
})

import { createTransaction, updateTransaction } from './api'
import { getGpsPosition } from './location'

const createTransactionMock = vi.mocked(createTransaction)
const updateTransactionMock = vi.mocked(updateTransaction)
const getGpsPositionMock = vi.mocked(getGpsPosition)

const wallet: Wallet = {
  id: 1,
  name: 'Cash',
  type: 'cash',
  balance: '100.00',
  frozen: false,
  created_at: '2026-01-01T00:00:00Z',
}

const frozenWallet: Wallet = {
  id: 2,
  name: 'Old Card',
  type: 'checking',
  balance: '0.00',
  frozen: true,
  created_at: '2026-01-01T00:00:00Z',
}

const categories: Category[] = []

const recurringCosts: RecurringCost[] = [
  {
    id: 1,
    name: 'Rent',
    amount: '850.00',
    interval_value: 1,
    interval_unit: 'months',
    start_date: '2030-03-01',
    due_day: null,
    due_month: null,
    next_due_date: '2030-03-01',
    next_unpaid_occurrence_date: '2030-03-01',
    backlog_count: 0,
    overdue: false,
    next_skip_action: 'skip',
    created_at: '2026-08-01T10:00:00Z'
  },
  {
    id: 2,
    name: 'Insurance',
    amount: '120.00',
    interval_value: 1,
    interval_unit: 'years',
    start_date: '2030-06-01',
    due_day: null,
    due_month: null,
    next_due_date: '2030-06-01',
    next_unpaid_occurrence_date: '2030-06-01',
    backlog_count: 0,
    overdue: false,
    next_skip_action: 'skip',
    created_at: '2026-08-01T10:00:00Z'
  },
]

const recurringIncomes: RecurringIncome[] = [
  {
    id: 1,
    name: 'Salary',
    amount: '2100.00',
    interval_value: 1,
    interval_unit: 'months',
    start_date: '2030-03-01',
    due_day: null,
    due_month: null,
    next_due_date: '2030-03-01',
    next_unpaid_occurrence_date: '2030-03-01',
    backlog_count: 0,
    overdue: false,
    next_skip_action: 'skip',
    created_at: '2026-08-01T10:00:00Z'
  },
  {
    id: 2,
    name: 'Rent from tenant',
    amount: '600.00',
    interval_value: 1,
    interval_unit: 'months',
    start_date: '2030-06-01',
    due_day: null,
    due_month: null,
    next_due_date: '2030-06-01',
    next_unpaid_occurrence_date: '2030-06-01',
    backlog_count: 0,
    overdue: false,
    next_skip_action: 'skip',
    created_at: '2026-08-01T10:00:00Z'
  },
]

const baseTransaction: Transaction = {
  id: 7,
  type: 'expense',
  amount: '4.50',
  date: '2026-08-01',
  wallet_id: 1,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: null,
  recurring_cost_id: null,
  recurring_income_id: null,
  occurrence_date: null,
  description: null,
  latitude: '41.9028',
  longitude: '12.4964',
  place_name: 'Esselunga',
  place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  warning: false,
  created_at: '2026-08-01T10:00:00Z',
}

beforeEach(() => {
  // A fresh session keeps the GPS prefill quiet: markGpsGranted from earlier
  // tests would otherwise arm it for create-form tests and consume the mock.
  sessionStorage.clear()
  picker.onPick = null
  getGpsPositionMock.mockReset()
  getGpsPositionMock.mockResolvedValue(null)
  createTransactionMock.mockReset()
  createTransactionMock.mockResolvedValue({ ...baseTransaction })
  updateTransactionMock.mockReset()
  updateTransactionMock.mockResolvedValue({ ...baseTransaction })
})

function renderForm(
  editing: Transaction | null,
  costs: RecurringCost[] = recurringCosts,
  incomes: RecurringIncome[] = recurringIncomes,
  wallets: Wallet[] = [wallet],
) {
  return render(
    <TransactionForm
      wallets={wallets}
      categories={categories}
      recurringCosts={costs}
      recurringIncomes={incomes}
      editing={editing}
      onSaved={() => {}}
      onDeleted={() => {}}
      onCancel={() => {}}
      onAddCategory={() => {}}
      categoryToSelect={null}
      onAddWallet={() => {}}
      walletToSelect={null}
      onAddRecurringCost={() => {}}
      recurringCostToSelect={null}
      onAddRecurringIncome={() => {}}
      recurringIncomeToSelect={null}
    />,
  )
}

describe('TransactionForm place display (issue #34)', () => {
  it('shows the place name instead of coordinates when a Place is present', () => {
    renderForm(baseTransaction)

    expect(screen.getByText('📍 Esselunga')).toBeInTheDocument()
    expect(screen.queryByText('📍 41.9028, 12.4964')).not.toBeInTheDocument()
    // The link is Google's place-with-pin search URL (coordinates as the
    // query, place_id as query_place_id): the mobile Maps apps run it as a
    // search, so an unresolvable place_id still lands a pin on the spot.
    expect(screen.getByRole('link', { name: /Open in Google Maps/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=41.9028,12.4964&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4',
    )
  })

  it('shows coordinates when no Place was picked (tap or GPS)', () => {
    renderForm({ ...baseTransaction, place_name: null, place_id: null })

    expect(screen.getByText('📍 41.9028, 12.4964')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in Google Maps/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=41.9028,12.4964',
    )
  })

  it('a search pick stores name + place_id and saves them with the Transaction', async () => {
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))
    await screen.findByTestId('map-picker')
    act(() => {
      picker.onPick!({ lat: 45.4642, lng: 9.19 }, { name: 'Duomo', placeId: 'ChIJduomo' })
    })

    expect(screen.getByText('📍 Duomo')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Amount (€)'), { target: { value: '5.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))

    await waitFor(() => expect(createTransactionMock).toHaveBeenCalled())
    expect(createTransactionMock).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        latitude: '45.4642',
        longitude: '9.19',
        place_name: 'Duomo',
        place_id: 'ChIJduomo',
      }),
    )
  })
})

describe('TransactionForm place clearing (issue #34)', () => {
  it('a tap re-pick clears the Place and saves coordinates only', async () => {
    renderForm(baseTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Change location' }))
    await screen.findByTestId('map-picker')
    // A tap reports a position with no Place.
    act(() => {
      picker.onPick!({ lat: 45, lng: 9 })
    })

    expect(screen.getByText('📍 45, 9')).toBeInTheDocument()
    expect(screen.queryByText('📍 Esselunga')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({
        latitude: '45',
        longitude: '9',
        place_name: null,
        place_id: null,
      }),
    )
  })

  it('a GPS pick clears the Place', async () => {
    getGpsPositionMock.mockResolvedValue({ lat: 44, lng: 7 })
    renderForm(baseTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))

    expect(await screen.findByText('📍 44, 7')).toBeInTheDocument()
    expect(screen.queryByText('📍 Esselunga')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({ place_name: null, place_id: null }),
    )
  })

  it('Remove clears the location and the Place', async () => {
    renderForm(baseTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.getByText('No location attached.')).toBeInTheDocument()
    expect(screen.queryByText('📍 Esselunga')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({
        latitude: null,
        longitude: null,
        place_name: null,
        place_id: null,
      }),
    )
  })
})

describe('TransactionForm GPS feedback (issue #35)', () => {
  it('disables the button with a "Locating…" label while the lookup runs, then restores', async () => {
    let resolveGps!: (position: LatLng | null) => void
    getGpsPositionMock.mockReturnValue(
      new Promise<LatLng | null>((resolve) => {
        resolveGps = resolve
      }),
    )
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))

    const locatingButton = screen.getByRole('button', { name: 'Locating…' })
    expect(locatingButton).toBeDisabled()

    await act(async () => {
      resolveGps({ lat: 44, lng: 7 })
    })

    // Success attaches the position as before and restores the button.
    expect(await screen.findByText('📍 44, 7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled()
  })

  it('failure shows the inline message and keeps the map picker available', async () => {
    getGpsPositionMock.mockResolvedValue(null)
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))

    expect(
      await screen.findByText(
        "Couldn't get your location — check permissions or pick it on the map.",
      ),
    ).toBeInTheDocument()
    // The button restores so the lookup can be retried…
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled()
    // …and the map picker buttons remain available after the failure.
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))
    expect(await screen.findByTestId('map-picker')).toBeInTheDocument()
  })

  it('a successful retry clears the failure message', async () => {
    getGpsPositionMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ lat: 44, lng: 7 })
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    await screen.findByText(
      "Couldn't get your location — check permissions or pick it on the map.",
    )

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))

    expect(await screen.findByText('📍 44, 7')).toBeInTheDocument()
    expect(
      screen.queryByText(
        "Couldn't get your location — check permissions or pick it on the map.",
      ),
    ).not.toBeInTheDocument()
  })
})

describe('TransactionForm recurring-cost link (issue #57)', () => {
  const linkedTransaction: Transaction = {
    ...baseTransaction,
    recurring_cost_id: 1,
    occurrence_date: '2030-02-15',
  }

  it('shows the picker in expense mode only, listing the Account costs', () => {
    renderForm(null)

    // Expense is the default type: the picker is visible with every cost,
    // plus the inline create sentinel (ADR-0013) last.
    const picker = screen.getByLabelText('Recurring Cost')
    expect(
      Array.from(picker.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['None', 'Rent', 'Insurance', '＋ Add recurring cost…'])

    // Income and Transfer never carry a link: the picker hides.
    fireEvent.click(screen.getByRole('button', { name: 'Income' }))
    expect(screen.queryByLabelText('Recurring Cost')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    expect(screen.queryByLabelText('Recurring Cost')).not.toBeInTheDocument()
  })

  it('picking a cost shows the Occurrence the link will pay', () => {
    renderForm(null)

    fireEvent.change(screen.getByLabelText('Recurring Cost'), {
      target: { value: '1' },
    })

    expect(screen.getByText('Pays the occurrence of 2030-03-01.')).toBeInTheDocument()
  })

  it('create submits the chosen link', async () => {
    renderForm(null)

    fireEvent.change(screen.getByLabelText('Amount (€)'), { target: { value: '5.00' } })
    fireEvent.change(screen.getByLabelText('Recurring Cost'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))

    await waitFor(() => expect(createTransactionMock).toHaveBeenCalled())
    expect(createTransactionMock).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ recurringCostId: 1 }),
    )
  })

  it('editing a linked Expense shows its pinned Occurrence, not the fresher next unpaid', () => {
    // The API's next unpaid for Rent is 2030-03-01; the Transaction pinned
    // 2030-02-15 at link time. The form shows the pin: a later edit must
    // never reassign the paid Occurrence (issue #57).
    renderForm(linkedTransaction)

    expect(screen.getByLabelText('Recurring Cost')).toHaveValue('1')
    expect(screen.getByText('Pays the occurrence of 2030-02-15.')).toBeInTheDocument()
    expect(screen.queryByText('Pays the occurrence of 2030-03-01.')).not.toBeInTheDocument()
  })

  it('an edit that keeps the link leaves it out of the PATCH, so the pin stays', async () => {
    renderForm(linkedTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.not.objectContaining({ recurringCostId: expect.anything() }),
    )
  })

  it('unlinking on edit sends recurringCostId: null, freeing the Occurrence', async () => {
    renderForm(linkedTransaction)

    fireEvent.change(screen.getByLabelText('Recurring Cost'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({ recurringCostId: null }),
    )
  })

  it('changing the link on edit sends the new cost id', async () => {
    renderForm(linkedTransaction)

    fireEvent.change(screen.getByLabelText('Recurring Cost'), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({ recurringCostId: 2 }),
    )
  })
})

describe('TransactionForm recurring-income link (issue #61)', () => {
  const linkedIncomeTransaction: Transaction = {
    ...baseTransaction,
    type: 'income',
    recurring_income_id: 1,
    occurrence_date: '2030-02-15',
  }

  it('shows the picker in income mode only, listing the Account incomes', () => {
    renderForm(null)

    // Expense is the default type: the income picker is hidden.
    expect(screen.queryByLabelText('Recurring Income')).not.toBeInTheDocument()

    // Income mode shows the picker with every income; Transfer hides it.
    fireEvent.click(screen.getByRole('button', { name: 'Income' }))
    const picker = screen.getByLabelText('Recurring Income')
    expect(
      Array.from(picker.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['None', 'Salary', 'Rent from tenant', '＋ Add recurring income…'])

    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    expect(screen.queryByLabelText('Recurring Income')).not.toBeInTheDocument()
    // Expense never carries it either.
    fireEvent.click(screen.getByRole('button', { name: 'Expense' }))
    expect(screen.queryByLabelText('Recurring Income')).not.toBeInTheDocument()
  })

  it('picking an income shows the Occurrence the link will pay', () => {
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Income' }))
    fireEvent.change(screen.getByLabelText('Recurring Income'), {
      target: { value: '1' },
    })

    expect(screen.getByText('Pays the occurrence of 2030-03-01.')).toBeInTheDocument()
  })

  it('create submits the chosen link', async () => {
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Income' }))
    fireEvent.change(screen.getByLabelText('Amount (€)'), { target: { value: '5.00' } })
    fireEvent.change(screen.getByLabelText('Recurring Income'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))

    await waitFor(() => expect(createTransactionMock).toHaveBeenCalled())
    expect(createTransactionMock).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ recurringIncomeId: 1 }),
    )
  })

  it('editing a linked Income shows its pinned Occurrence, not the fresher next unpaid', () => {
    // The API's next unpaid for Salary is 2030-03-01; the Transaction pinned
    // 2030-02-15 at link time. The form shows the pin: a later edit must
    // never reassign the paid Occurrence (issue #61).
    renderForm(linkedIncomeTransaction)

    expect(screen.getByLabelText('Recurring Income')).toHaveValue('1')
    expect(screen.getByText('Pays the occurrence of 2030-02-15.')).toBeInTheDocument()
    expect(screen.queryByText('Pays the occurrence of 2030-03-01.')).not.toBeInTheDocument()
  })

  it('an edit that keeps the link leaves it out of the PATCH, so the pin stays', async () => {
    renderForm(linkedIncomeTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.not.objectContaining({ recurringIncomeId: expect.anything() }),
    )
  })

  it('unlinking on edit sends recurringIncomeId: null, freeing the Occurrence', async () => {
    renderForm(linkedIncomeTransaction)

    fireEvent.change(screen.getByLabelText('Recurring Income'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({ recurringIncomeId: null }),
    )
  })

  it('changing the link on edit sends the new income id', async () => {
    renderForm(linkedIncomeTransaction)

    fireEvent.change(screen.getByLabelText('Recurring Income'), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({ recurringIncomeId: 2 }),
    )
  })
})

describe('TransactionForm frozen wallets (ADR-0002)', () => {
  it('does not offer Frozen Wallets in the Wallet select for an Expense or Income', () => {
    renderForm(null, undefined, undefined, [frozenWallet, wallet])

    const select = screen.getByLabelText('Wallet')
    const options = Array.from(select.querySelectorAll('option')).map(
      (option) => option.textContent,
    )
    // The inline-create sentinel (ADR-0013) rides alongside the active
    // Wallets; Frozen ones stay out.
    expect(options).toEqual(['Cash (€100.00)', '＋ Add wallet…'])
  })

  it('does not offer Frozen Wallets in the From/To selects for a Transfer', () => {
    renderForm(null, undefined, undefined, [frozenWallet, wallet])

    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))

    for (const label of ['From', 'To']) {
      const select = screen.getByLabelText(label)
      expect(
        Array.from(select.querySelectorAll('option')).map((option) => option.textContent),
      ).toEqual(['Cash (€100.00)', '＋ Add wallet…'])
    }
  })

  it('defaults to the first active Wallet when a Frozen one is first in the list', () => {
    renderForm(null, undefined, undefined, [frozenWallet, wallet])

    // Expense is the default type: the initial selection skips the Frozen
    // Wallet and lands on the first active one.
    expect(screen.getByLabelText('Wallet')).toHaveValue('1')

    // Transfer mode seeds both legs from the active Wallets too.
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    expect(screen.getByLabelText('From')).toHaveValue('1')
    expect(screen.getByLabelText('To')).toHaveValue('1')
  })
})

describe('TransactionForm readable description (issue #53)', () => {
  const longDescription = [
    'Groceries at the market',
    'Fresh bread, cheese, and a bottle of wine',
    'Dinner with friends on Saturday night',
  ].join('\n')

  it('shows the full Description, sized to its lines, when the modal opens', () => {
    renderForm({ ...baseTransaction, description: longDescription })

    const field = screen.getByLabelText('Description')
    expect(field).toHaveValue(longDescription)
    // The field is a multi-line box that grows to hold every line.
    expect(field).toHaveAttribute('rows', '3')
  })

  it('grows as the user types more lines, and stays put for a single line', () => {
    renderForm(null)

    const field = screen.getByLabelText('Description')
    expect(field).toHaveAttribute('rows', '2')

    fireEvent.change(field, { target: { value: 'one line' } })
    expect(field).toHaveAttribute('rows', '2')

    fireEvent.change(field, { target: { value: 'one\ntwo\nthree\nfour' } })
    expect(field).toHaveAttribute('rows', '4')
  })

  it('keeps the 500-character cap', () => {
    renderForm(null)

    expect(screen.getByLabelText('Description')).toHaveAttribute('maxlength', '500')
  })

  it('save submits the complete Description', async () => {
    renderForm(null)

    fireEvent.change(screen.getByLabelText('Amount (€)'), { target: { value: '5.00' } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: longDescription },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))

    await waitFor(() => expect(createTransactionMock).toHaveBeenCalled())
    expect(createTransactionMock).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ description: longDescription }),
    )
  })

  it('save on edit keeps the complete Description', async () => {
    renderForm({ ...baseTransaction, description: longDescription })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({ description: longDescription }),
    )
  })
})
