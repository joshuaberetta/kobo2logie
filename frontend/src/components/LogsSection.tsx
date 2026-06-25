import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Pagination,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LogEntry } from '../types'
import { SubmissionDetailModal } from './SubmissionDetailModal'

const WS_BASE = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}`
})()

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <Badge color={ok ? 'green' : 'red'} variant='dot' size='sm'>
      {ok ? 'ok' : 'fail'}
    </Badge>
  )
}

function RelativeTime({ ts }: { ts: number }) {
  const date = new Date(ts)
  const diff = Math.floor((Date.now() - ts) / 1000)
  let label: string
  if (diff < 60) label = `${diff}s ago`
  else if (diff < 3600) label = `${Math.floor(diff / 60)}m ago`
  else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`
  else label = date.toLocaleDateString()

  return (
    <Tooltip label={date.toLocaleString()}>
      <Text size='xs' c='dimmed' style={{ cursor: 'default' }}>
        {label}
      </Text>
    </Tooltip>
  )
}

interface LogsSectionProps {
  uid: string
}

export function LogsSection({ uid }: LogsSectionProps) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<LogEntry | null>(null)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [liveEntries, setLiveEntries] = useState<LogEntry[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  const PAGE_SIZE = 20

  const { data, isLoading } = useQuery({
    queryKey: ['logs', uid, page],
    queryFn: () => api.logs.list(uid, page, PAGE_SIZE),
    refetchInterval: 60_000,
  })

  // WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/stream/${uid}/`)
    wsRef.current = ws
    setWsStatus('connecting')

    ws.onopen = () => setWsStatus('open')
    ws.onclose = () => setWsStatus('closed')
    ws.onerror = () => setWsStatus('closed')

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { type: 'log' | 'submission'; data: unknown }
        if (msg.type === 'submission' || msg.type === 'log') {
          const entry = msg.data as LogEntry
          setLiveEntries((prev) => {
            // dedupe by uuid then trim to 50
            const exists = prev.some((e) => e.uuid && e.uuid === entry.uuid && e.ts === entry.ts)
            if (exists) return prev
            return [entry, ...prev].slice(0, 50)
          })
          // Invalidate page 1 so the list refreshes
          queryClient.invalidateQueries({ queryKey: ['logs', uid, 1] })
        }
      } catch (_) {}
    }

    return () => {
      ws.close()
    }
  }, [uid, queryClient])

  const { mutate: retry, isPending: retrying, variables: retryingUuid } = useMutation({
    mutationFn: (uuid: string) => api.submissions.retry(uid, uuid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logs', uid] })
    },
  })

  // Use page 1 results merged with live entries if on page 1
  const pageEntries: LogEntry[] = data?.results ?? []
  const displayEntries: LogEntry[] =
    page === 1
      ? (() => {
          const merged = [...liveEntries]
          for (const e of pageEntries) {
            if (!merged.some((x) => x.uuid && x.uuid === e.uuid && x.ts === e.ts)) {
              merged.push(e)
            }
          }
          return merged.sort((a, b) => b.ts - a.ts).slice(0, PAGE_SIZE)
        })()
      : pageEntries

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE)

  return (
    <Stack gap='sm'>
      <Group justify='space-between'>
        <Group gap='xs'>
          <Text size='sm' fw={500}>
            Submission log
          </Text>
          <Badge
            color={wsStatus === 'open' ? 'green' : wsStatus === 'connecting' ? 'yellow' : 'gray'}
            variant='dot'
            size='sm'
          >
            {wsStatus === 'open' ? 'live' : wsStatus === 'connecting' ? 'connecting' : 'offline'}
          </Badge>
        </Group>
        {liveEntries.length > 0 && (
          <Button
            size='xs'
            variant='transparent'
            onClick={() => {
              setLiveEntries([])
              queryClient.invalidateQueries({ queryKey: ['logs', uid] })
            }}
          >
            Clear live
          </Button>
        )}
      </Group>

      {isLoading && page === 1 && !displayEntries.length ? (
        <Box ta='center' py='xl'>
          <Loader size='sm' />
        </Box>
      ) : displayEntries.length === 0 ? (
        <Text size='sm' c='dimmed' ta='center' py='xl'>
          No submissions yet. Waiting for webhook…
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={500}>
          <Table highlightOnHover style={{ cursor: 'pointer' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>UUID</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th style={{ width: 40 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {displayEntries.map((entry) => (
                <Table.Tr key={`${entry.ts}-${entry.uuid}`} onClick={() => setSelected(entry)}>
                  <Table.Td>
                    <RelativeTime ts={entry.ts} />
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs' style={{ fontFamily: 'monospace' }}>
                      {entry.uuid ? entry.uuid.slice(0, 8) + '…' : entry.submission_id ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge ok={entry.ok} />
                  </Table.Td>
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    {entry.uuid && (
                      <Tooltip label='Retry pipeline'>
                        <ActionIcon
                          variant='transparent'
                          size='sm'
                          loading={retrying && retryingUuid === entry.uuid}
                          onClick={() => retry(entry.uuid)}
                        >
                          ↺
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {totalPages > 1 && (
        <Pagination
          total={totalPages}
          value={page}
          onChange={setPage}
          size='sm'
          style={{ alignSelf: 'center' }}
        />
      )}

      <SubmissionDetailModal entry={selected} onClose={() => setSelected(null)} />
    </Stack>
  )
}
