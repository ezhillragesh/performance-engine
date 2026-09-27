import { memo } from 'react'
import { SegmentedControl, type Segment } from '../shell/SegmentedControl'
import { CATEGORIES, type CategoryFilter } from './model'

const SEGMENTS: Segment<CategoryFilter>[] = CATEGORIES.map((category) => ({ value: category, label: category }))

export const FilterBar = memo(function FilterBar({
  value,
  onChange,
}: {
  value: CategoryFilter
  onChange: (value: CategoryFilter) => void
}) {
  return (
    <div className="filter-bar">
      <SegmentedControl className="segmented--scroll" label="Filter by category" segments={SEGMENTS} value={value} onChange={onChange} />
    </div>
  )
})
