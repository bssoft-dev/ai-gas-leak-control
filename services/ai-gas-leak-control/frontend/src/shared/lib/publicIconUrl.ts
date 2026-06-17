/** `public/icons/` 아이콘 URL. `import.meta.env.BASE`가 없을 때도 루트 경로로 동작하게 처리 */
export function publicIconUrl(file: string): string {
  const raw = import.meta.env.BASE
  const trimmed = typeof raw === 'string' && raw.length > 0 ? raw.replace(/\/$/, '') : ''
  return trimmed ? `${trimmed}/icons/${file}` : `/icons/${file}`
}
