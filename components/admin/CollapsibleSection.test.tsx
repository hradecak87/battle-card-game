import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsibleSection } from './CollapsibleSection'

describe('CollapsibleSection', () => {
  it('renders the title and description', () => {
    render(<CollapsibleSection title="My Title" description="My Description">content</CollapsibleSection>)
    expect(screen.getByText('My Title')).toBeInTheDocument()
    expect(screen.getByText('My Description')).toBeInTheDocument()
  })

  it('hides children by default (collapsed)', () => {
    render(<CollapsibleSection title="Section"><span>Hidden child</span></CollapsibleSection>)
    expect(screen.queryByText('Hidden child')).not.toBeInTheDocument()
  })

  it('starts collapsed by default — button has aria-expanded=false', () => {
    render(<CollapsibleSection title="Section">child</CollapsibleSection>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  it('clicking the header button toggles aria-expanded and shows children', async () => {
    const user = userEvent.setup()
    render(<CollapsibleSection title="Section"><span>My child</span></CollapsibleSection>)

    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('My child')).not.toBeInTheDocument()

    await user.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('My child')).toBeInTheDocument()

    await user.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('My child')).not.toBeInTheDocument()
  })

  it('defaultOpen prop opens the section on mount', () => {
    render(<CollapsibleSection title="Section" defaultOpen><span>Visible child</span></CollapsibleSection>)
    expect(screen.getByText('Visible child')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })
})
