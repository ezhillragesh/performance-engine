import { memo } from 'react'

interface StatTilesProps {
  unread: number
  starred: number
  openTasks: number
  showing: number
}

export const StatTiles = memo(function StatTiles({ unread, starred, openTasks, showing }: StatTilesProps) {
  const tiles = [
    { label: 'Unread', value: unread },
    { label: 'Starred', value: starred },
    { label: 'Open tasks', value: openTasks },
    { label: 'Showing', value: showing },
  ]
  return (
    <dl className="stat-tiles">
      {tiles.map((tile) => (
        <div key={tile.label} className="stat-tile">
          <dt className="stat-tile__label">{tile.label}</dt>
          <dd className="stat-tile__value tabular">{tile.value}</dd>
        </div>
      ))}
    </dl>
  )
})
