import type { ComponentPropsWithoutRef } from 'react'

type SvgIconProps = Omit<ComponentPropsWithoutRef<'svg'>, 'viewBox'> & {
  title?: string
}

export const CASTLE_VARIANTS = ['ruin', 'chateau', 'tower'] as const
export type CastleVariant = (typeof CASTLE_VARIANTS)[number]

export const VILLAGE_VARIANTS = ['stone', 'romanesque', 'timber'] as const
export type VillageVariant = (typeof VILLAGE_VARIANTS)[number]

function hashStringToIndex(value: string, modulo: number) {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % modulo
}

export function pickVariant<T>(seed: string, variants: readonly T[]): T {
  return variants[hashStringToIndex(seed, variants.length)]
}

function IconBase({ title, children, ...props }: SvgIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  )
}

export function HomeIcon(props: SvgIconProps) {
  return (
    <IconBase {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M4 11.5 11.7 5l2.5 2.1V5.7h2.1V9l3.7 3.2v1.6h-1.6V19H5.6v-5.9H4v-1.6Zm3.4 6h8.8v-5.7l-4.4-3.7-4.4 3.7v5.7Zm3-2.1h2.9v-3.5h-2.9v3.5Z"
        clipRule="evenodd"
      />
      <path fill="currentColor" d="M16.8 6.5h1.5V8h-1.5z" opacity="0.85" />
    </IconBase>
  )
}

export function CastleIcon({ variant, ...props }: SvgIconProps & { variant: CastleVariant }) {
  if (variant === 'ruin') {
    return (
      <IconBase {...props}>
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M3 18h18v2H3v-2Zm2.4-1.6h4.2V8.6H8.5V7h2.2v1.6h2.2v7.8h1.6v-4.8h1.3v-1.3h1.2v2.6h-1.2v3.5h2.8l-1-3.1-1.3.5.6-4.8 2.4-1.5L21 16.4h-2.1l-1.2-3.9-.7.2.6 2h-2.3V7h-.9V5.5h1.9V7h.9v2.1l1.1-.7-.3-1h-.9V5.8h1.8v1l1.9-1.2 1.4 4.3-.8.5-1-3.1-.7.4.3 1-2.2 1.4-.3 2.3 1.3-.5 1.7 5.4H3.9l1.5-3.2Z"
          clipRule="evenodd"
        />
        <path fill="currentColor" d="M6.7 12.6h1.2v1.5H6.7zm1.3-2.3h1.1v1.4H8z" opacity="0.75" />
      </IconBase>
    )
  }

  if (variant === 'tower') {
    return (
      <IconBase {...props}>
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M7 20h10v-1.9h2V16h-1.4V8.5h-1.4V7h-1.1V5h-6.2v2H7.8v1.5H6.4V16H5v2.1h2V20Zm2.1-2.1h5.8V7.1H9.1v10.8Zm1.5-8.8h1.2v1.6h-1.2V9.1Zm2.1 0h1.2v1.6h-1.2V9.1Zm-1.6 7h2v-3.4c0-.6-.5-1-1-1s-1 .4-1 1v3.4Z"
          clipRule="evenodd"
        />
        <path fill="currentColor" d="M12 3.8 13 5h-2z" opacity="0.9" />
      </IconBase>
    )
  }

  return (
    <IconBase {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3 19h18v1.8H3V19Zm2-1.7h14v-6.1h-1.8v1.4h-1.5V7.9h-.9V5.3H13v2.6h-2V5.7H9.2v2.2h-1v4.7H6.7v-1.4H5v6.1Zm4.9 0h4.1V9.6H9.9v7.7Zm-2.2 0h1V9.7h-1v7.6Zm7.7 0h1V9.7h-1v7.6Z"
        clipRule="evenodd"
      />
      <path fill="currentColor" d="M7.2 6.9h2L8.2 4.6zm7.6-1.8h-1.4l1.4-1.7z" opacity="0.9" />
      <path fill="currentColor" d="M15.8 4.8v2.1l2 .4-2-.1z" opacity="0.8" />
    </IconBase>
  )
}

export function VillageIcon({ variant, ...props }: SvgIconProps & { variant: VillageVariant }) {
  if (variant === 'romanesque') {
    return (
      <IconBase {...props}>
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M3.5 19h17v1.7h-17V19Zm1.8-1.7h3v-5h1.5v5h8.7V11h-2.3V8.5h-1.2V6.1h-4.6v1.8H9.1V11H5.3v6.3Zm6-6.3h3.1V7.8h-3.1V11Zm-1 6.3h2.1v-3.1c0-.8-.5-1.4-1-1.4-.6 0-1.1.6-1.1 1.4v3.1Zm4.2-3.3h1.6v1.2h-1.6z"
          clipRule="evenodd"
        />
        <path fill="currentColor" d="M16.6 8.1h1.2v1.5h-1.2z" opacity="0.8" />
      </IconBase>
    )
  }

  if (variant === 'timber') {
    return (
      <IconBase {...props}>
        <path
          fill="currentColor"
          d="M4.2 18.7h6.9v-5.2H4.2zm8.1 0h7.5v-6H12.3z"
          opacity="0.32"
        />
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M3 19h18v1.7H3V19Zm1.2-1.6h7v-4.8H4.2v4.8Zm8.1 0h7.5v-5.6h-7.5v5.6Zm-8.9-6.2 4-3.2 4 3.2H3.4Zm8.2-.2 4.4-3.6 4.5 3.6h-8.9Zm8.4 6.4h-2v-2.8h-1.4v2.8h-2.1V13h5.5v4.4Zm-13.4 0h2V14h-2v3.4Z"
          clipRule="evenodd"
        />
        <path
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.3"
          d="m5.2 17 2.4-3.2L10 17m5.1.1 3.5-4m-3.5 0 3.5 4M7.7 9.2v7.3m8.3-8.4v8.7"
        />
      </IconBase>
    )
  }

  return (
    <IconBase {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3 19h18v1.7H3V19Zm1.3-1.7h6.4v-5H4.3v5Zm7.5 0h7.9v-5.8h-3.1V8.7h-1.5V7h-4v4.5h.7v5.8Zm-8.5-6.2L7.5 8l4.1 3.1H3.3Zm8.1-.1h4.2V8.5h-4.2V11Zm1 6.3h2v-3.1c0-.8-.4-1.4-1-1.4-.5 0-1 .6-1 1.4v3.1Zm-6.3-2.4h1.3v1.2H6.1Zm9-.4h1.5v1.3h-1.5z"
        clipRule="evenodd"
      />
    </IconBase>
  )
}
