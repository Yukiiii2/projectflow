import type { Person } from '../domain/types'

interface AvatarProps {
  person: Person
  size?: 'sm' | 'md' | 'lg'
}

export function Avatar({ person, size = 'md' }: AvatarProps) {
  return (
    <span
      className={`avatar avatar--${size}`}
      style={{ '--avatar-color': person.color } as React.CSSProperties}
      aria-label={person.name}
      title={person.name}
    >
      {person.initials}
    </span>
  )
}
