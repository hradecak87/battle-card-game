import { render, screen, fireEvent } from '@testing-library/react'
import Minimap from './Minimap'
import { MinimapTile } from '@/lib/territories/api'

const tiles: MinimapTile[] = [
  { x: 10, y: 10, owner_id: 'me', owner_is_npc: false, castle_rank: null, village_rank: null, claim_locked_by: null, battle_locked_by: null, battle_id: null },
  { x: 20, y: 20, owner_id: 'other', owner_is_npc: false, castle_rank: null, village_rank: null, claim_locked_by: null, battle_locked_by: null, battle_id: null },
  { x: 30, y: 30, owner_id: null, owner_is_npc: false, castle_rank: 'rare', village_rank: null, claim_locked_by: null, battle_locked_by: null, battle_id: null },
  { x: 40, y: 40, owner_id: null, owner_is_npc: false, castle_rank: null, village_rank: null, claim_locked_by: 'someone', battle_locked_by: null, battle_id: null },
  { x: 50, y: 50, owner_id: 'npc-owner', owner_is_npc: true, castle_rank: null, village_rank: null, claim_locked_by: null, battle_locked_by: null, battle_id: null },
]

describe('Minimap', () => {
  it('renders one dot per sparse tile', () => {
    render(<Minimap tiles={tiles} myPlayerId="me" onRecenter={jest.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('invokes the recenter callback with the clicked tile coordinates', () => {
    const onRecenter = jest.fn()
    render(<Minimap tiles={tiles} myPlayerId="me" onRecenter={onRecenter} />)
    fireEvent.click(screen.getByLabelText('Přejít na (20, 20)'))
    expect(onRecenter).toHaveBeenCalledWith(20, 20)
  })

  it('colors my own territory differently from another player’s', () => {
    render(<Minimap tiles={tiles} myPlayerId="me" onRecenter={jest.fn()} />)
    const mine = screen.getByLabelText('Přejít na (10, 10)')
    const other = screen.getByLabelText('Přejít na (20, 20)')
    expect(mine.className).not.toEqual(other.className)
  })

  it('renders NPC-garrisoned structure tiles and in-progress claims distinctly', () => {
    render(<Minimap tiles={tiles} myPlayerId="me" onRecenter={jest.fn()} />)
    const npcTile = screen.getByLabelText('Přejít na (30, 30)')
    const claimTile = screen.getByLabelText('Přejít na (40, 40)')
    expect(npcTile.className).toMatch(/bg-zinc-400/)
    expect(claimTile.className).toMatch(/bg-yellow-400/)
  })

  it('colors NPC-owned territories differently from human-owned ones', () => {
    render(<Minimap tiles={tiles} myPlayerId="me" onRecenter={jest.fn()} />)
    const humanTile = screen.getByLabelText('Přejít na (20, 20)')
    const npcTile = screen.getByLabelText('Přejít na (50, 50)')
    expect(npcTile.className).not.toEqual(humanTile.className)
  })
})
