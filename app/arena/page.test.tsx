import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ArenaPage from './page'

describe('ArenaPage', () => {
  it('resolves a duel and shows the matching atk/dmg/ttk breakdown and winner', async () => {
    const user = userEvent.setup()
    render(<ArenaPage />)

    await user.selectOptions(screen.getByLabelText('Útočník'), 'archers-common-01')
    await user.selectOptions(screen.getByLabelText('Obránce'), 'spearmen-common-01')
    await user.click(screen.getByRole('button', { name: 'Souboj!' }))

    // archers-common-01: str=1,lng=8.7->9,def=2.2->2,hp=4 (rank common, x1.0)
    // spearmen-common-01: str=4.3->4,lng=1,def=7,hp=4.7->5
    // attacker atk=max(1,9)=9, dmg to defender=max(0,9-7)=2, ttk=5/2=2.50
    // defender atk=max(4,1)=4, dmg to attacker=max(0,4-2)=2, ttk=4/2=2.00
    // lower ttk wins -> defender (2.00 < 2.50)
    const attackerCard = screen.getByText('Práčata').closest('div') as HTMLElement
    const defenderCard = screen.getByText('Rolníci s kopím').closest('div') as HTMLElement

    expect(attackerCard).toHaveTextContent('9') // atk
    expect(attackerCard).toHaveTextContent('2.50') // ttk
    expect(defenderCard).toHaveTextContent('4') // atk
    expect(defenderCard).toHaveTextContent('2.00') // ttk
    expect(defenderCard).toHaveTextContent('VÍTĚZ')
    expect(attackerCard).not.toHaveTextContent('VÍTĚZ')
  })

  it('shows no result before fighting', () => {
    render(<ArenaPage />)
    expect(screen.queryByText('VÍTĚZ')).not.toBeInTheDocument()
  })
})
