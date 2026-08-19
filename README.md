# Battle Card Game V2

A medieval card-collection and combat web game. Next.js 14 (App Router) +
TypeScript + Tailwind, no backend/database yet — this is subsystem #1 of a
larger planned game (see `docs/superpowers/PROGRESS.md` for the full context,
decisions, and roadmap).

## What's implemented so far

**Subsystem #1 — Card Collection & Combat Core** (fully done):

- A catalog of 279 unique card templates: 9 medieval unit types (archers,
  crossbowmen, spearmen, swordsmen, halberdiers, knights, light cavalry,
  siege engines, settlers) × 5 ranks (common/uncommon/rare/epic/legend), each
  with its own honorific Czech name, flavor text, and stats.
- A deterministic 1v1 duel resolution algorithm (`lib/cards/combat.ts`)
  based on a time-to-kill "damage race" formula.
- `/collection` — browse and filter the full card catalog.
- `/arena` — pick two cards and resolve a duel, with the full attack/damage/
  time-to-kill breakdown shown.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the landing page,
or go directly to `/collection` or `/arena`.

## Testing

```bash
npm test        # full Jest + React Testing Library suite
npx tsc --noEmit # type check
npm run build    # production build (also lints)
```

## Deploying

This is a plain Next.js app — it deploys to [Vercel](https://vercel.com) the
same way as any other Next.js project (`vercel` CLI or connect the git repo
in the Vercel dashboard). No environment variables or external services are
required for this subsystem.

## Project docs

- `docs/superpowers/PROGRESS.md` — **source of truth**: full project
  context, every design decision, the complete implementation plan with
  status, and process/policy notes. Read this first when resuming work.
- `docs/superpowers/specs/` — approved subsystem specs.
- `docs/superpowers/plans/` — implementation plans.
