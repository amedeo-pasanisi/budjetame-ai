/**
 * Test helpers: render a component wrapped in IntlProvider with the given
 * locale's message catalog, so component tests can assert translated strings.
 */

import { type ReactElement } from 'react'
import { IntlProvider } from 'react-intl'
import { render, type RenderOptions } from '@testing-library/react'

import { enMessages, itMessages } from '../i18n/catalogs'

/**
 * Render a component inside an IntlProvider with the specified locale.
 * Defaults to English. Pass `locale="it"` to assert Italian strings.
 */
export function renderWithIntl(
  ui: ReactElement,
  { locale = 'en', ...options }: RenderOptions & { locale?: string } = {},
) {
  const messages = locale === 'it' ? itMessages : enMessages
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <IntlProvider messages={messages} locale={locale === 'it' ? 'it' : 'en'} defaultLocale="en">
      {children}
    </IntlProvider>
  )
  return render(ui, { wrapper, ...options })
}