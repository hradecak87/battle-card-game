import { render, screen } from '@testing-library/react'
import { act } from 'react'
import userEvent from '@testing-library/user-event'
import { DailyRewardCard } from './DailyRewardCard'

const claimDailyReward = jest.fn()

jest.mock('@/lib/players/api', () => ({
  claimDailyReward: () => claimDailyReward(),
}))

describe('DailyRewardCard', () => {
  beforeEach(() => {
    claimDailyReward.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders the current streak and an enabled claim button when today is still available', () => {
    render(<DailyRewardCard initialStreak={3} initialLastClaimAt="2026-08-15T09:00:00Z" />)

    expect(screen.getByText(/Aktuální série: 3 dní/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vyzvednout denní odměnu/i })).toBeEnabled()
  })

  it('shows granted cards and the updated streak after a successful claim', async () => {
    claimDailyReward.mockResolvedValue({
      data: {
        streak: 7,
        claimed_at: '2026-08-17T10:00:00Z',
        granted_cards: [
          { template_id: 'archers-common-01', rank: 'common' },
          { template_id: 'archers-uncommon-01', rank: 'uncommon' },
        ],
      },
      error: null,
    })

    render(<DailyRewardCard initialStreak={6} initialLastClaimAt="2026-08-16T08:00:00Z" />)

    await userEvent.click(screen.getByRole('button', { name: /Vyzvednout denní odměnu/i }))

    expect(claimDailyReward).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Aktuální série: 7 dní/i)).toBeInTheDocument()
    expect(screen.getByText(/Práčata/)).toBeInTheDocument()
    expect(screen.getByText(/Královští střelci/)).toBeInTheDocument()
  })

  it('shows a friendly already-claimed message instead of the raw RPC error', async () => {
    claimDailyReward.mockResolvedValue({
      data: null,
      error: { message: 'daily reward already claimed today' },
    })

    render(<DailyRewardCard initialStreak={2} initialLastClaimAt="2026-08-16T08:00:00Z" />)

    await userEvent.click(screen.getByRole('button', { name: /Vyzvednout denní odměnu/i }))

    expect(await screen.findByText(/Dnešní odměna už byla vyzvednuta/i)).toBeInTheDocument()
    expect(screen.queryByText('daily reward already claimed today')).not.toBeInTheDocument()
  })

  it('re-enables claiming after UTC midnight without requiring a reload', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-08-17T23:59:30Z'))

    render(<DailyRewardCard initialStreak={2} initialLastClaimAt="2026-08-17T08:00:00Z" />)

    expect(screen.getByRole('button', { name: /Vyzvednuto dnes/i })).toBeDisabled()

    act(() => {
      jest.advanceTimersByTime(60_000)
    })

    expect(screen.getByRole('button', { name: /Vyzvednout denní odměnu/i })).toBeEnabled()
  })
})
