import React, { useMemo, useState } from 'react'

function toDateMs(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

function compareValues(a, b, sortType) {
  if (sortType === 'date') {
    const da = toDateMs(a)
    const db = toDateMs(b)
    if (da == null && db == null) return 0
    if (da == null) return 1
    if (db == null) return -1
    return da - db
  }
  if (sortType === 'number') {
    const na = Number(a)
    const nb = Number(b)
    const fa = Number.isFinite(na) ? na : 0
    const fb = Number.isFinite(nb) ? nb : 0
    return fa - fb
  }
  return String(a ?? '').localeCompare(String(b ?? ''), 'ko', { numeric: true, sensitivity: 'base' })
}

function filterRows(rows, columns, filters) {
  return rows.filter((row) => {
    for (const col of columns) {
      if (col.filterable === false) continue
      const rawFilter = filters[col.key]
      if (rawFilter == null || String(rawFilter).trim() === '') continue
      const raw =
        col.filterType === 'select'
          ? col.getValue(row)
          : col.getFilterValue
            ? col.getFilterValue(row)
            : col.getValue(row)
      if (col.filterType === 'select') {
        if (String(raw ?? '') !== String(rawFilter)) return false
      } else {
        const f = String(rawFilter).trim().toLowerCase()
        if (!String(raw ?? '').toLowerCase().includes(f)) return false
      }
    }
    return true
  })
}

function sortRows(rows, columns, sortKey, sortDir) {
  if (!sortKey || !sortDir) return rows
  const col = columns.find((c) => c.key === sortKey)
  if (!col || col.sortable === false) return rows
  const mult = sortDir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => mult * compareValues(col.getValue(a), col.getValue(b), col.sortType || 'text'))
}

/**
 * @param {{
 *   className?: string
 *   columns: Array<{
 *     key: string
 *     label: string
 *     getValue: (row: unknown) => unknown
 *     getFilterValue?: (row: unknown) => string
 *     sortType?: 'text' | 'number' | 'date'
 *     filterType?: 'text' | 'select'
 *     filterOptions?: Array<{ value: string, label: string }>
 *     filterable?: boolean
 *     sortable?: boolean
 *     filterPlaceholder?: string
 *   }>
 *   rows: unknown[]
 *   rowKey: (row: unknown) => string | number
 *   renderRow: (row: unknown) => React.ReactNode
 *   emptyMessage?: string
 * }} props
 */
export default function AdminSortableTable({
  className = 'admin-table',
  columns,
  rows,
  rowKey,
  renderRow,
  emptyMessage,
}) {
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('')
  const [filters, setFilters] = useState({})

  const displayed = useMemo(() => {
    const filtered = filterRows(rows, columns, filters)
    return sortRows(filtered, columns, sortKey, sortDir)
  }, [rows, columns, filters, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
      return
    }
    if (sortDir === 'asc') {
      setSortDir('desc')
      return
    }
    setSortKey('')
    setSortDir('')
  }

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const hasActiveFilters = Object.values(filters).some((v) => String(v ?? '').trim() !== '')

  return (
    <>
      <div className="admin-table-wrap">
        <table className={className}>
          <thead>
            <tr className="admin-table-head-row">
              {columns.map((col) => (
                <th key={col.key}>
                  {col.sortable === false ? (
                    col.label
                  ) : (
                    <button
                      type="button"
                      className={`admin-th-sort${sortKey === col.key ? ` is-${sortDir}` : ''}`}
                      onClick={() => toggleSort(col.key)}
                      title="클릭하여 정렬"
                    >
                      <span>{col.label}</span>
                      <span className="admin-sort-icon" aria-hidden="true">
                        {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
            <tr className="admin-table-filter-row">
              {columns.map((col) => (
                <th key={col.key}>
                  {col.filterable === false ? null : col.filterType === 'select' ? (
                    <select
                      className="admin-col-filter admin-col-filter--select"
                      value={filters[col.key] || ''}
                      onChange={(e) => setFilter(col.key, e.target.value)}
                      aria-label={`${col.label} 필터`}
                    >
                      <option value="">전체</option>
                      {(col.filterOptions || []).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="admin-col-filter"
                      placeholder={col.filterPlaceholder || '필터'}
                      value={filters[col.key] || ''}
                      onChange={(e) => setFilter(col.key, e.target.value)}
                      aria-label={`${col.label} 필터`}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{displayed.map((row) => renderRow(row, rowKey(row)))}</tbody>
        </table>
      </div>
      {displayed.length === 0 && emptyMessage ? <p className="muted">{emptyMessage}</p> : null}
      {hasActiveFilters && displayed.length > 0 ? (
        <p className="admin-table-filter-hint muted">{displayed.length}건 표시 (필터 적용 중)</p>
      ) : null}
    </>
  )
}
