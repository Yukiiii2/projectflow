interface BrandProps {
  collapsed?: boolean
}

export function Brand({ collapsed = false }: BrandProps) {
  return (
    <div className="brand" role="img" aria-label="ProjectFlow">
      <span className="brand__mark" aria-hidden="true">
        <span />
        <span />
      </span>
      {!collapsed && <span className="brand__name">ProjectFlow</span>}
    </div>
  )
}
