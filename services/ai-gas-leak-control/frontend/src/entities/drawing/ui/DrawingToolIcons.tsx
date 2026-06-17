type IconProps = {
  className?: string
}

type MaterialSymbolIconProps = IconProps & {
  name: string
}

function MaterialSymbolIcon({ name, className }: MaterialSymbolIconProps) {
  return (
    <span
      className={`material-symbols-rounded text-[#61718C] ${className ?? ''}`.trim()}
      aria-hidden
    >
      {name}
    </span>
  )
}

export function DrawingZoomInIcon({ className }: IconProps) {
  return <MaterialSymbolIcon name="add_circle" className={className} />
}

export function DrawingZoomOutIcon({ className }: IconProps) {
  return <MaterialSymbolIcon name="remove_circle" className={className} />
}

export function DrawingResetIcon({ className }: IconProps) {
  return <MaterialSymbolIcon name="restart_alt" className={className} />
}

export function DrawingEditIcon({ className }: IconProps) {
  return <MaterialSymbolIcon name="edit_square" className={className} />
}
