import { type Wallet } from './api'
import { BottomSheet } from './BottomSheet'
import { WalletForm } from './WalletForm'

type WalletModalProps = {
  wallet?: Wallet
  onSaved: (wallet: Wallet) => void
  onFrozen?: (walletId: number) => void
  onClose: () => void
}

/** The create/edit/freeze Wallet form inside the shared bottom-sheet shell
 * (issue #49). Create and edit share this one modal: the Type selector and
 * Opening balance only appear while creating, and the tap-again freeze
 * confirmation only while editing. The shell adds the dismissal paths —
 * backdrop click, Cancel, and Escape all abandon the draft without saving. */
export function WalletModal({ wallet, onSaved, onFrozen, onClose }: WalletModalProps) {
  const editing = wallet !== undefined
  return (
    <BottomSheet label={editing ? 'Edit wallet' : 'New wallet'} onClose={onClose}>
      <WalletForm
        key={editing ? wallet.id : 'create'}
        wallet={wallet}
        onSaved={onSaved}
        onFrozen={onFrozen}
        onCancel={onClose}
      />
    </BottomSheet>
  )
}
