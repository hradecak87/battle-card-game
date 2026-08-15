import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 p-8 text-center">
      <div>
        <h1 className="text-4xl sm:text-5xl font-bold mb-3">Battle Card Game</h1>
        <p className="text-zinc-400 max-w-xl">
          Sbírej karty středověkých vojsk pěti ranků a otestuj je v aréně
          soubojů. Toto je raná ukázka první části hry — sbírka karet a
          jádro soubojového systému.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          href="/collection"
          className="rounded-full bg-zinc-100 text-zinc-900 hover:bg-white px-8 py-3 font-semibold transition-colors"
        >
          Sbírka karet
        </Link>
        <Link
          href="/arena"
          className="rounded-full border border-zinc-600 hover:border-zinc-400 px-8 py-3 font-semibold transition-colors"
        >
          Aréna soubojů
        </Link>
      </div>

      <p className="text-xs text-zinc-600">248 karet · 8 typů vojsk · 5 ranků</p>
    </main>
  )
}
