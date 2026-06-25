import { Badge, Box, Code, Divider, Modal, ScrollArea, Stack, Text } from '@mantine/core'
import type { LogEntry } from '../types'

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <Badge color={ok ? 'green' : 'red'} variant='light' size='sm'>
      {ok ? 'OK' : 'Failed'}
    </Badge>
  )
}

function Row({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null
  const display =
    typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
  return (
    <Box>
      <Text size='xs' c='dimmed' mb={2}>
        {label}
      </Text>
      {display.includes('\n') ? (
        <Code block style={{ fontSize: 11 }}>
          {display}
        </Code>
      ) : (
        <Text size='sm'>{display}</Text>
      )}
    </Box>
  )
}

interface SubmissionDetailModalProps {
  entry: LogEntry | null
  onClose: () => void
}

export function SubmissionDetailModal({ entry, onClose }: SubmissionDetailModalProps) {
  if (!entry) return null

  const ts = new Date(entry.ts).toLocaleString()

  const KNOWN_KEYS = new Set([
    'id', 'ts', 'uuid', 'submission_id', 'ok', 'httpStatus', 'responseBody', 'error',
    'editOk', 'editHttpStatus', 'editError',
    'validateOk', 'validateHttpStatus', 'validateError',
    'geocodeOk', 'geocodeError', 'geocodeAddressSteps',
    'transcribeSteps', 'analyzeAudioSteps', 'extractSteps', 'extractTextSteps',
    'emailOk', 'emailError', 'failureEmailOk', 'failureEmailError',
  ])

  const extra = Object.entries(entry).filter(([k]) => !KNOWN_KEYS.has(k))

  return (
    <Modal
      opened={!!entry}
      onClose={onClose}
      title={`Submission ${entry.uuid || entry.submission_id || entry.id}`}
      size='lg'
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap='sm'>
        <Row label='Timestamp' value={ts} />
        <Row label='UUID' value={entry.uuid} />
        <Row label='Submission ID' value={entry.submission_id} />

        <Divider label='Pipeline result' />
        <Box>
          <Text size='xs' c='dimmed' mb={4}>Status</Text>
          <StatusBadge ok={entry.ok} />
        </Box>
        <Row label='HTTP status' value={entry.httpStatus} />
        <Row label='Response' value={entry.responseBody} />
        <Row label='Error' value={entry.error} />

        {(entry.editOk !== undefined || entry.editError) && (
          <>
            <Divider label='Kobo edit-back' />
            {entry.editOk !== undefined && (
              <Box>
                <Text size='xs' c='dimmed' mb={4}>Status</Text>
                <StatusBadge ok={!!entry.editOk} />
              </Box>
            )}
            <Row label='HTTP status' value={entry.editHttpStatus} />
            <Row label='Error' value={entry.editError} />
          </>
        )}

        {(entry.validateOk !== undefined || entry.validateError) && (
          <>
            <Divider label='AI validation' />
            {entry.validateOk !== undefined && (
              <Box>
                <Text size='xs' c='dimmed' mb={4}>Status</Text>
                <StatusBadge ok={!!entry.validateOk} />
              </Box>
            )}
            <Row label='HTTP status' value={entry.validateHttpStatus} />
            <Row label='Error' value={entry.validateError} />
          </>
        )}

        {(entry.geocodeOk !== undefined || entry.geocodeAddressSteps) && (
          <>
            <Divider label='Geocoding' />
            {entry.geocodeOk !== undefined && (
              <Box>
                <Text size='xs' c='dimmed' mb={4}>Coordinates</Text>
                <StatusBadge ok={!!entry.geocodeOk} />
              </Box>
            )}
            <Row label='Geocode error' value={entry.geocodeError} />
            <Row label='Address steps' value={entry.geocodeAddressSteps} />
          </>
        )}

        {!!(entry.transcribeSteps || entry.analyzeAudioSteps || entry.extractSteps || entry.extractTextSteps) && (
          <>
            <Divider label='AI enrichment steps' />
            <Row label='Transcribe' value={entry.transcribeSteps} />
            <Row label='Analyze audio' value={entry.analyzeAudioSteps} />
            <Row label='Extract (image)' value={entry.extractSteps} />
            <Row label='Extract (text)' value={entry.extractTextSteps} />
          </>
        )}

        {(entry.emailOk !== undefined || entry.failureEmailOk !== undefined) && (
          <>
            <Divider label='Email' />
            {entry.emailOk !== undefined && (
              <Box>
                <Text size='xs' c='dimmed' mb={4}>Notification email</Text>
                <StatusBadge ok={!!entry.emailOk} />
              </Box>
            )}
            <Row label='Email error' value={entry.emailError} />
            {entry.failureEmailOk !== undefined && (
              <Box>
                <Text size='xs' c='dimmed' mb={4}>Failure email</Text>
                <StatusBadge ok={!!entry.failureEmailOk} />
              </Box>
            )}
            <Row label='Failure email error' value={entry.failureEmailError} />
          </>
        )}

        {extra.length > 0 && (
          <>
            <Divider label='Raw data' />
            {extra.map(([k, v]) => (
              <Row key={k} label={k} value={v} />
            ))}
          </>
        )}
      </Stack>
    </Modal>
  )
}
