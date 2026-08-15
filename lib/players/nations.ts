export type NationId =
  | 'england'
  | 'francia'
  | 'hre'
  | 'byzantium'
  | 'mongol_horde'
  | 'scandinavia'

export interface Nation {
  id: NationId
  name: string
  perkDescription: string
}

/**
 * The 6 permanent, registration-time nation choices (design spec §3).
 * Perks are reference data only here — no combat/transfer/occupation
 * calculation reads these yet (deferred to later subsystems, spec §3.1).
 */
export const NATIONS: Nation[] = [
  {
    id: 'england',
    name: 'Anglické království',
    perkDescription: 'Tisové luky: +15% k útoku na dálku (LNG) v boji.',
  },
  {
    id: 'francia',
    name: 'Franská říše',
    perkDescription: 'Těžká rytířská jízda: +15% k útoku zblízka (STR) v boji.',
  },
  {
    id: 'hre',
    name: 'Svatá říše římská',
    perkDescription: 'Železná disciplína a plátové brnění: +15% k obraně (DEF) v boji.',
  },
  {
    id: 'byzantium',
    name: 'Byzantská říše',
    perkDescription: 'Bohatství a dlouhé posádky: +15% ke zdraví (HP) v boji.',
  },
  {
    id: 'mongol_horde',
    name: 'Mongolská horda',
    perkDescription: 'Rychlé jízdní kmeny: -25% doby přesunu vojsk mezi územími.',
  },
  {
    id: 'scandinavia',
    name: 'Skandinávské království (Vikingové)',
    perkDescription: 'Bleskové nájezdy: -20% doby zabírání prázdného území.',
  },
]
