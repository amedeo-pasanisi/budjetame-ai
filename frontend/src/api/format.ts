/** Display helpers shared by the screens (issue #17: the API client is split
 * by resource, and this small shared module keeps the display helpers out of
 * the transport and resource modules).
 */

/** Display an amount string from the API as euros ("€100.00", "€-15.00"). */
export function formatEuros(amount: string): string {
  return `€${amount}`
}
