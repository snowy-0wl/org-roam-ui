export function getWebSocketUrl(location: Pick<Location, 'protocol' | 'hostname' | 'search'>): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const port = new URLSearchParams(location.search).get('wsPort') ?? '35903'
  return `${protocol}//${location.hostname}:${port}`
}
