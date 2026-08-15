// One-off content-authoring script: generates lib/cards/catalog-data.json
// from hand-curated name lists per unit type/rank (spec section 6) and the
// unit type baseline stats (spec section 5). This script is NOT part of the
// running app — it's a content-authoring tool. The output JSON is the
// static, hand-authored catalog that lib/cards/catalog.ts loads/validates.
//
// Run with: node scripts/generate-catalog-data.js

const fs = require('fs')
const path = require('path')

const VARIANTS_PER_RANK = { common: 10, uncommon: 8, rare: 6, epic: 4, legend: 3 }
const RANKS = ['common', 'uncommon', 'rare', 'epic', 'legend']
const SUPPLY_RANGE = { rare: [20, 50], epic: [5, 15], legend: [1, 5] }

// Baseline stats per unit type (spec section 5), before rank multiplier and
// before per-variant flavor variance.
const UNIT_TYPE_BASELINES = {
  archers: { str: 1, lng: 8, def: 2, hp: 4 },
  crossbowmen: { str: 1, lng: 7, def: 5, hp: 4 },
  spearmen: { str: 4, lng: 1, def: 7, hp: 5 },
  swordsmen: { str: 7, lng: 1, def: 4, hp: 5 },
  halberdiers: { str: 6, lng: 1, def: 8, hp: 8 },
  knights: { str: 8, lng: 1, def: 5, hp: 7 },
  lightCavalry: { str: 5, lng: 4, def: 2, hp: 4 },
  siegeEngines: { str: 0, lng: 10, def: 1, hp: 3 },
}

// Czech plural label used in generated flavor text.
const TYPE_LABEL = {
  archers: 'lučištníci',
  crossbowmen: 'kušištníci',
  spearmen: 'kopiníci',
  swordsmen: 'mečíři',
  halberdiers: 'halapartníci',
  knights: 'rytíři',
  lightCavalry: 'jízdní harcovníci',
  siegeEngines: 'obléhací stroje',
}

// Hand-curated honorific names, "common folk -> legendary named individuals"
// progression per unit type (spec section 6). Array lengths must match
// VARIANTS_PER_RANK.
const NAMES = {
  archers: {
    common: [
      'Práčata', 'Venkovští lučištníci', 'Lesní hlídka', 'Ostrostřelci z vesnice',
      'Chlapci s tisovým lukem', 'Pastýři šípů', 'Robotníci s prakem',
      'Hraniční hlídka', 'Sběrači per', 'Mladí střelci',
    ],
    uncommon: [
      'Královští střelci', 'Yeomani', 'Lovci jelenů', 'Ostrostřelci hradní stráže',
      'Zálesáci', 'Bratrstvo šípu', 'Střelci Severní marky', 'Lovci z Temného hvozdu',
    ],
    rare: ['Sokolí oko', 'Setníci šípů', 'Bratrstvo tisu', 'Stříbrní lučištníci', 'Krkavčí zrak', 'Tichá smrt'],
    epic: ['Vlčí luk', 'Stíny lesa', 'Poslední salva', 'Oheň z nebes'],
    legend: ['Nejostřejší šípy', 'Král střelců', 'Šíp osudu'],
  },
  crossbowmen: {
    common: [
      'Vesnická hlídka s kušemi', 'Ozbrojenci z celnice', 'Formani s kuší',
      'Strážci mostů', 'Havíři s kuší', 'Pohraniční kušištníci',
      'Žoldnéři z bažin', 'Městská hotovost', 'Verbíři s kuší', 'Obecní kušníci',
    ],
    uncommon: [
      'Cechovní kušištníci', 'Pavézníci', 'Střelci z bašt', 'Žoldáci Severní marky',
      'Bratrstvo pavézy', 'Hradní kušištníci', 'Celní stráž', 'Karavanní doprovod',
    ],
    rare: ['Ocelové tětivy', 'Bratrstvo železné pavézy', 'Setníci kuše', 'Strážci brány', 'Tichý svist', 'Železný mrak'],
    epic: ['Poslední bašta', 'Kovová smrt', 'Bouře šipek', 'Ocelový soumrak'],
    legend: ['Neprůstřelná stěna', 'Král pavéz', 'Poslední salva oceli'],
  },
  spearmen: {
    common: [
      'Rolníci s kopím', 'Vesnická domobrana', 'Robotníci s oštěpem',
      'Ostraha stád', 'Hraniční hlídka s kopím', 'Mladí kopiníci',
      'Formani s oštěpem', 'Sběrači daní s kopím', 'Sedláci s vidlemi', 'Nováčci setniny',
    ],
    uncommon: [
      'Královská pěší garda', 'Bratrstvo kopí', 'Hradní kopiníci', 'Pohraniční setnina',
      'Železná linie', 'Strážci brodu', 'Kopiníci Severní marky', 'Obranná falanga',
    ],
    rare: ['Železná stěna', 'Bratrstvo dlouhého kopí', 'Setníci obrany', 'Nezlomná linie', 'Ocelový plot', 'Strážci hranice'],
    epic: ['Poslední val', 'Hradba masa a oceli', 'Nedobytná linie', 'Kopí posledního odporu'],
    legend: ['Nezlomná hradba', 'Král obrany', 'Poslední bašta říše'],
  },
  swordsmen: {
    common: [
      'Městská hotovost s mečem', 'Řemeslníci v zbroji', 'Verbíři s mečem',
      'Žoldnéři nováčci', 'Ozbrojenci z krčmy', 'Mladí mečíři',
      'Sedláci s krátkým mečem', 'Formani s tesákem', 'Strážci trhu', 'Obecní ozbrojenci',
    ],
    uncommon: [
      'Cechovní šermíři', 'Bratrstvo čepele', 'Žoldáci Jižní marky', 'Městská garda',
      'Ostří meče', 'Šermíři z Akademie', 'Strážci paláce', 'Bojovníci arény',
    ],
    rare: ['Krvavá čepel', 'Bratrstvo oceli', 'Setníci meče', 'Tanec smrti', 'Stříbrná čepel', 'Mistr šermu'],
    epic: ['Ostří spravedlnosti', 'Krvavý tanec', 'Poslední soud', 'Čepel bouře'],
    legend: ['Čepel králů', 'Mistr posledního tance', 'Ostří osudu'],
  },
  halberdiers: {
    common: [
      'Vesnická obrana se sudlicí', 'Robotníci s halapartnou', 'Strážci vrat',
      'Formani s halapartnou', 'Sedláci s dřevcovou zbraní', 'Mladí halapartníci',
      'Hraniční obránci', 'Ostraha skladů', 'Obecní stráž', 'Verbíři s halapartnou',
    ],
    uncommon: [
      'Cechovní halapartníci', 'Bratrstvo dřevce', 'Hradní stráž s halapartnou',
      'Železní strážci', 'Palácová garda', 'Strážci pokladu', 'Setnina obránců', 'Halapartníci Severní marky',
    ],
    rare: ['Ocelová hradba', 'Bratrstvo železného dřevce', 'Setníci obrany hradeb', 'Nezdolní strážci', 'Železný val', 'Strážci koruny'],
    epic: ['Poslední hradba', 'Ocelový strom', 'Nezlomný val', 'Strážci posledního dechu'],
    legend: ['Strážce brány království', 'Král obránců', 'Poslední val impéria'],
  },
  knights: {
    common: [
      'Panoši v sedle', 'Mladí rytíři', 'Zeměpanská jízda', 'Ozbrojenci na koni',
      'Formani ve zbroji', 'Hraniční jízda', 'Obecní jízdní hlídka', 'Verbíři na koních',
      'Nováčci turnaje', 'Sedláci na koni s kopím',
    ],
    uncommon: [
      'Cechovní rytíři', 'Bratrstvo ostruh', 'Rytíři Severní marky', 'Turnajoví šampioni',
      'Královská jízda', 'Bojovníci kulatého stolu', 'Rytíři žehnané čepele', 'Strážci praporu',
    ],
    rare: ['Železný jezdec', 'Bratrstvo dračí korouhve', 'Setníci jízdy', 'Rytíři posledního tažení', 'Stříbrná ostruha', 'Jezdec bouře'],
    epic: ['Poslední výpad', 'Hromobití kopyt', 'Rytíř nekonečné bitvy', 'Dračí ostruha'],
    legend: ['Král rytířů', 'Poslední paladin', 'Rytíř korunovaný slávou'],
  },
  lightCavalry: {
    common: [
      'Zvědové na koních', 'Mladí harcovníci', 'Pohraniční jezdci', 'Formani na rychlých koních',
      'Verbíři jízdní hlídky', 'Obecní jezdci', 'Zvědové hranic', 'Rychlí poslové',
      'Sedláci na koních s prakem', 'Nováčci jízdní hlídky',
    ],
    uncommon: [
      'Cechovní harcovníci', 'Bratrstvo rychlého jezdce', 'Jízdní hlídka Severní marky',
      'Zvědové královské armády', 'Rychlí jezdci', 'Harcovníci bouře', 'Strážci karavan', 'Jezdci větru',
    ],
    rare: ['Stín na koni', 'Bratrstvo tichého jezdce', 'Setníci zvědů', 'Blesk stepí', 'Rychlý jako vítr', 'Jezdec přízraku'],
    epic: ['Vítr z východu', 'Přízrak stepí', 'Poslední zvěd', 'Harcovník bouře'],
    legend: ['Král zvědů', 'Jezdec bez stínu', 'Vítr osudu'],
  },
  siegeEngines: {
    common: [
      'Vesnický katapult', 'Improvizovaný trebuchet', 'Dřevěný prak', 'Obléhací žebřík s vrhačem',
      'Formanský katapult', 'Obecní balista', 'Nouzový vrhač kamenů', 'Polní katapult',
      'Rolnický trebuchet', 'Provizorní obléhací stroj',
    ],
    uncommon: [
      'Cechovní trebuchet', 'Železný katapult', 'Obléhací balista Severní marky',
      'Královská balista', 'Ocelový vrhač', 'Obléhací věž', 'Bratrstvo obléhačů', 'Trebuchet posádky',
    ],
    rare: ['Zkáza hradeb', 'Bratrstvo ohnivého kamene', 'Setníci obléhání', 'Drtič bran', 'Ocelový hrom', 'Poslední salva kamenů'],
    epic: ['Zkáza království', 'Ohnivý déšť', 'Drtič impérií', 'Poslední bašta obležení'],
    legend: ['Zkáza všech hradeb', 'Poslední soud kamenů', 'Trebuchet bohů'],
  },
}

const TIER_FLAVOR = {
  common: (name, typeLabel) => `${name}: řadoví ${typeLabel}, snadno dostupní, ale o to početnější.`,
  uncommon: (name, typeLabel) => `${name}: zkušení ${typeLabel}, prošli výcvikem cechovních mistrů.`,
  rare: (name, typeLabel) => `${name}: elitní ${typeLabel}, o kterých se vypráví u ohňů.`,
  epic: (name, typeLabel) => `${name}: legendami opředení ${typeLabel}, jejichž činy zná celé království.`,
  legend: (name, typeLabel) => `${name}: jediní svého druhu — ${typeLabel}, kteří se zapsali do dějin navždy.`,
}

// Deterministic ±10% variance, seeded by the template id, so re-running
// this script produces byte-identical output.
function seededFactor(seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  // map hash to [0.9, 1.1]
  const normalized = (h % 2000) / 2000 // [0, 1)
  return 0.9 + normalized * 0.2
}

function varyStats(baseline, idSeed) {
  return {
    str: baseline.str * seededFactor(idSeed + ':str'),
    lng: baseline.lng * seededFactor(idSeed + ':lng'),
    def: baseline.def * seededFactor(idSeed + ':def'),
    hp: baseline.hp * seededFactor(idSeed + ':hp'),
  }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function supplyForIndex(rank, index, count) {
  if (rank === 'common' || rank === 'uncommon') return null
  const [min, max] = SUPPLY_RANGE[rank]
  if (count === 1) return min
  return Math.round(min + ((max - min) * index) / (count - 1))
}

const templates = []

for (const unitType of Object.keys(UNIT_TYPE_BASELINES)) {
  const baseline = UNIT_TYPE_BASELINES[unitType]
  const typeLabel = TYPE_LABEL[unitType]
  for (const rank of RANKS) {
    const names = NAMES[unitType][rank]
    const expectedCount = VARIANTS_PER_RANK[rank]
    if (names.length !== expectedCount) {
      throw new Error(
        `${unitType}/${rank}: expected ${expectedCount} names, got ${names.length}`
      )
    }
    names.forEach((name, index) => {
      const idIndex = String(index + 1).padStart(2, '0')
      const id = `${unitType}-${rank}-${idIndex}`
      const rawVaried = varyStats(baseline, id)
      const baseStats = {
        str: round1(rawVaried.str),
        lng: round1(rawVaried.lng),
        def: round1(rawVaried.def),
        hp: round1(rawVaried.hp),
      }
      templates.push({
        id,
        unitType,
        rank,
        name,
        flavorText: TIER_FLAVOR[rank](name, typeLabel),
        baseStats,
        totalSupply: supplyForIndex(rank, index, expectedCount),
      })
    })
  }
}

const outPath = path.join(__dirname, '..', 'lib', 'cards', 'catalog-data.json')
fs.writeFileSync(outPath, JSON.stringify(templates, null, 2) + '\n', 'utf-8')
console.log(`Wrote ${templates.length} card templates to ${outPath}`)
