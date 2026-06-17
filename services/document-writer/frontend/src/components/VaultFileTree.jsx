import React, { useMemo, useState, useCallback, useEffect } from 'react'

/**
 * @param {string[]} filePaths  볼트 기준 상대 경로 (예: "dir/a.md")
 */
function buildFolderTree(filePaths) {
  const root = { dirs: new Map(), files: [] }
  for (const rel of filePaths) {
    const parts = rel.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let n = root
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      if (i === parts.length - 1) {
        if (!n.files) n.files = []
        n.files.push({ name: seg, relPath: rel })
      } else {
        if (!n.dirs) n.dirs = new Map()
        if (!n.dirs.has(seg)) {
          n.dirs.set(seg, {
            name: seg,
            relPath: parts.slice(0, i + 1).join('/'),
            dirs: new Map(),
            files: [],
          })
        }
        n = n.dirs.get(seg)
      }
    }
  }
  return root
}

function sortFolderEntries(node) {
  const dirs = node.dirs ? Array.from(node.dirs.entries()) : []
  const files = node.files || []
  dirs.sort((a, b) => a[0].localeCompare(b[0], 'ko', { numeric: true }))
  files.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))
  return { dirs, files }
}

function filterPathsByQuery(paths, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return paths
  const tokens = q.split(/\s+/).filter(Boolean)
  return paths.filter((p) => {
    const t = p.toLowerCase()
    return tokens.every((tok) => t.includes(tok))
  })
}

function collectAllFolderRelPathsFromTree(node, out = new Set()) {
  if (!node?.dirs) return out
  for (const [, child] of node.dirs) {
    out.add(child.relPath)
    collectAllFolderRelPathsFromTree(child, out)
  }
  return out
}

export function VaultFileTree({ filePaths, filterText, previewPath, onFileClick, onFileDoubleClick }) {
  const filteredPaths = useMemo(
    () => filterPathsByQuery(filePaths, filterText),
    [filePaths, filterText],
  )
  const tree = useMemo(() => buildFolderTree(filteredPaths), [filteredPaths])

  const [expanded, setExpanded] = useState(() => new Set())

  const hasFilter = (filterText || '').trim().length > 0

  useEffect(() => {
    const fullTree = buildFolderTree(filePaths)
    const allFolders = collectAllFolderRelPathsFromTree(fullTree)
    if (hasFilter) {
      const pruned = buildFolderTree(filteredPaths)
      setExpanded(collectAllFolderRelPathsFromTree(pruned))
    } else {
      setExpanded(allFolders)
    }
  }, [filePaths, hasFilter, filteredPaths])

  const toggle = useCallback((relPath) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(relPath)) n.delete(relPath)
      else n.add(relPath)
      return n
    })
  }, [])

  return (
    <div className="sayu-vault-tree" role="tree">
      <TreeLevel
        node={tree}
        depth={0}
        expanded={expanded}
        onToggle={toggle}
        previewPath={previewPath}
        onFileClick={onFileClick}
        onFileDoubleClick={onFileDoubleClick}
      />
      {filteredPaths.length === 0 && filePaths.length > 0 && (
        <p className="sayu-tree-empty">필터와 일치하는 파일이 없습니다.</p>
      )}
      {filePaths.length === 0 && <p className="sayu-tree-empty">마크다운 파일이 없습니다.</p>}
    </div>
  )
}

function TreeLevel({ node, depth, expanded, onToggle, previewPath, onFileClick, onFileDoubleClick }) {
  const { dirs, files } = sortFolderEntries(node)

  return (
    <ul className="sayu-tree-level" data-depth={depth} role="group">
      {dirs.map(([, child]) => {
        const isOpen = expanded.has(child.relPath)
        return (
          <li key={child.relPath} className="sayu-tree-node sayu-tree-folder" role="none">
            <div className="sayu-tree-row" style={{ paddingLeft: 4 + depth * 14 }} role="treeitem" aria-expanded={isOpen}>
              <button
                type="button"
                className="sayu-tree-chevron"
                onClick={() => onToggle(child.relPath)}
                aria-label={isOpen ? '폴더 접기' : '펼치기'}
              >
                {isOpen ? '▾' : '▸'}
              </button>
              <span className="sayu-tree-folder-name" title={child.relPath}>
                {child.relPath}
              </span>
            </div>
            {isOpen && (
              <TreeLevel
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                previewPath={previewPath}
                onFileClick={onFileClick}
                onFileDoubleClick={onFileDoubleClick}
              />
            )}
          </li>
        )
      })}
      {files.map((f) => (
        <li key={f.relPath} className="sayu-tree-node sayu-tree-file" role="none">
          <button
            type="button"
            className={
              'sayu-tree-file-btn' + (previewPath === f.relPath ? ' active' : '')
            }
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => onFileClick(f.relPath)}
            onDoubleClick={() => onFileDoubleClick(f.relPath)}
            title={`${f.relPath} — 더블클릭: 에디터로 열기`}
            role="treeitem"
          >
            {f.relPath}
          </button>
        </li>
      ))}
    </ul>
  )
}

export { filterPathsByQuery }
