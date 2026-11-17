import { type Wallet, type WalletType } from './api'
import { ModalShell } from './ModalShell'
import { WalletForm } from './WalletForm'

type WalletModalProps = {
  wallet?: Wallet
  /** Eligibility locking (ADR-0013): when set, the create form's Type
   * selector is restricted to these types — e.g. inline wallet creation
   * from a cost form accepts Checking, Credit Card, and Cash, never
   * Contact. */
  allowedTypes?: WalletType[]
  /** The create form's prefilled Name (issue #77): the row editor opens
   * this modal with the missing name from the file, so the user does not
   * retype it. Create mode only — an edited Wallet keeps its own name. */
  prefillName?: string
  onSaved: (wallet: Wallet) => void
  onFrozen?: (walletId: number) => void
  onUnfrozen?: (wallet: Wallet) => void
  /** A frozen Wallet was deleted for good (ADR-0034). */
  onDeleted?: (wallet: Wallet) => void
  onClose: () => void
}

/** The create/edit/freeze Wallet form inside the shared modal shell
 * (issue #49). Create and edit share this one modal: the Type selector and
 * Opening balance only appear while creating, and the tap-again freeze
 * or one-tap unfreeze confirmation only while editing. The shell adds the
 * dismissal paths — backdrop click, Cancel, and Escape all abandon the
 * draft without saving. Frozen wallets show an indigo Unfreeze button
 * instead of the red Freeze button (ADR-0028), and below it the red Delete
 * for a Wallet with no history (ADR-0034). */
export function WalletModal({
  wallet,
  allowedTypes,
  prefillName,
  onSaved,
  onFrozen,
  onUnfrozen,
  onDeleted,
  onClose,
}: WalletModalProps) {
  const editing = wallet !== undefined
  return (
    <ModalShell label={editing ? 'Edit wallet' : 'New wallet'} onClose={onClose}>
      <WalletForm
        key={editing ? wallet.id : 'create'}
        wallet={wallet}
        allowedTypes={allowedTypes}
        prefillName={prefillName}
        onSaved={onSaved}
        onFrozen={onFrozen}
        onUnfrozen={onUnfrozen}
        onDeleted={onDeleted}
        onCancel={onClose}
      />
    </ModalShell>
  )
}
