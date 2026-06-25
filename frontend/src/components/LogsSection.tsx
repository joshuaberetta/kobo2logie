import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Loader,
  Pagination,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LogEntry } from '../types'
import { SubmissionDetailModal } from './SubmissionDetailModal'

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

  const PAGE_SIZE = 20

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['logs', uid, page],
    queryFn: () => api.logs.list(uid, page, PAGE_SIZE),
    refetchInterval: 15_000,
  })

  const { mutate: retry, isPending: retrying, variables: retryingUuid } = useMutation({
    mutationFn: (uuid: string) => api.submissions.retry(uid, uuid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logs', uid] })
    },
  })

  const entries: LogEntry[] = data?.results ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE)

  return (
    <Stack gap='sm'>
      <Group justify='space-between'>
        <Text size='sm' fw={500}>
          Submission log
        </Text>
        <Tooltip label='Refresh'>
          <ActionIcon
            variant='transparent'
            size='sm'
            loading={isFetching}
            onClick={() => queryClient.invalidateQueries({ queryKey: ['logs', uid] })}
          >
            ↺
          </ActionIcon>
        </Tooltip>
      </Group>

      {isLoading ? (
        <Box ta='center' py='xl'>
          <Loader size='sm' />
        </Box>
      ) : entries.length === 0 ? (
        <Text size='sm' c='dimmed' ta='center' py='xl'>
          No submissions yet.
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
              {entries.map((entry) => (
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
