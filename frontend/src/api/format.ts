/** Display helpers shared by the screens (issue #17: the API client is split
 * by resource, and this small shared module keeps the display helpers out of
 * the transport and resource modules).
 */

/** Display an amount string from the API as euros ("€100.00", "€-15.00"). */
export function formatEuros(amount: string): string {
  return `€${amount}`
}

/** Display a Wallet balance with a sign, in the transaction-amount convention
 * (issue #47): "+€50.00" for a positive balance, "-€30.00" for a negative
 * one, and unsigned "€0.00" for zero — a settled Contact is neutral, like a
 * Transfer. The sign is informative everywhere: a positive Credit Card
 * balance means the bank owes the user. */
export function formatSignedEuros(amount: string): string {
  if (amount.startsWith('-')) {
    return `-€${amount.slice(1)}`
  }
  if (Number.parseFloat(amount) > 0) {
    return `+€${amount}`
  }
  return `€${amount}`
}
