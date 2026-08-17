import { render, screen } from '@testing-library/react'
import {
  CastleIcon,
  HomeIcon,
  VillageIcon,
  pickVariant,
} from './StructureIcons'

describe('StructureIcons', () => {
  it('renders each icon with the expected accessible title', () => {
    render(
      <>
        <HomeIcon title="Domov" />
        <CastleIcon variant="castle-2" title="Hrad" />
        <VillageIcon variant="village-1" title="Vesnice" />
      </>
    )

    expect(screen.getByRole('img', { name: 'Domov' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Hrad' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Vesnice' })).toBeInTheDocument()
  })

  it('pickVariant is deterministic for the same seed', () => {
    const variants = ['castle-1', 'castle-2', 'castle-3'] as const

    expect(pickVariant('territory-42', variants)).toBe(pickVariant('territory-42', variants))
    expect(pickVariant('territory-42', variants)).toBe(pickVariant('territory-42', variants))
  })

  it('pickVariant reaches every option across many different seeds', () => {
    const castleVariants = ['castle-1', 'castle-2', 'castle-3'] as const
    const villageVariants = ['village-1', 'village-2', 'village-3'] as const

    const seenCastles = new Set<string>()
    const seenVillages = new Set<string>()

    for (let i = 0; i < 50; i++) {
      seenCastles.add(pickVariant(`castle-territory-${i}`, castleVariants))
      seenVillages.add(pickVariant(`village-territory-${i}`, villageVariants))
    }

    expect(seenCastles).toEqual(new Set(castleVariants))
    expect(seenVillages).toEqual(new Set(villageVariants))
  })
})
