import {
  Alert,
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type {
  AppendValue,
  EmailNotificationConfig,
  EnrichConfig,
  FailureNotificationConfig,
  ProjectConfig,
  SurveyQuestion,
  ValidateSubmissionConfig,
} from '../types'
import { ConditionBuilder } from './ConditionBuilder'

// ── Helpers ───────────────────────────────────────────────────────────────────

function TagListInput({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string
  description?: string
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')

  function add() {
    const trimmed = input.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
    }
    setInput('')
  }

  return (
    <Box>
      {label && <Text size='sm' fw={500} mb={4}>{label}</Text>}
      {description && <Text size='xs' c='dimmed' mb={6}>{description}</Text>}
      <Group gap='xs' mb={4} wrap='wrap'>
        {value.map((v) => (
          <Group
            key={v}
            gap={2}
            style={{
              background: 'var(--mantine-color-dark-5)',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 12,
            }}
          >
            <Text size='xs'>{v}</Text>
            <ActionX onClick={() => onChange(value.filter((x) => x !== v))} />
          </Group>
        ))}
      </Group>
      <Group gap='xs'>
        <TextInput
          placeholder={placeholder || 'Add item'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          size='xs'
          style={{ flex: 1 }}
        />
        <Button size='xs' variant='light' onClick={add} disabled={!input.trim()}>
          Add
        </Button>
      </Group>
    </Box>
  )
}

function ActionX({ onClick }: { onClick: () => void }) {
  return (
    <Box
      component='button'
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--mantine-color-dimmed)',
        padding: '0 2px',
        lineHeight: 1,
      }}
    >
      ×
    </Box>
  )
}

// ── Enrich block (transcribe / extract / analyzeAudio / extractText) ──────────

const ENRICH_LABELS: Record<string, string> = {
  transcribe: 'Transcribe audio',
  extract: 'Extract from images',
  analyzeAudio: 'Analyze audio text',
  extractText: 'Extract from text fields',
}

function EnrichBlock({
  name,
  value,
  onChange,
  questions,
}: {
  name: string
  value: EnrichConfig | null | undefined
  onChange: (v: EnrichConfig | null) => void
  questions: SurveyQuestion[]
}) {
  const enabled = value != null
  const cfg: EnrichConfig = value ?? { questions: [] }

  const questionOptions = questions.map((q) => ({ value: q.xpath, label: q.label || q.xpath }))

  return (
    <Paper withBorder p='sm'>
      <Group justify='space-between' mb='xs'>
        <Text fw={500} size='sm'>
          {ENRICH_LABELS[name] ?? name}
        </Text>
        <Switch
          checked={enabled}
          onChange={(e) => onChange(e.currentTarget.checked ? { questions: [] } : null)}
          size='sm'
        />
      </Group>
      <Collapse in={enabled}>
        <Stack gap='sm'>
          <MultiSelect
            label='Questions (XPaths)'
            data={questionOptions}
            value={cfg.questions}
            onChange={(v) => onChange({ ...cfg, questions: v })}
            searchable
            placeholder='Select questions'
            size='sm'
          />
          <TextInput
            label='Model override'
            placeholder='gpt-4o-mini'
            value={cfg.model || ''}
            onChange={(e) => onChange({ ...cfg, model: e.target.value || undefined })}
            size='sm'
          />
          <Textarea
            label='Prompt override'
            placeholder='Custom system prompt…'
            value={cfg.prompt || ''}
            onChange={(e) => onChange({ ...cfg, prompt: e.target.value || undefined })}
            autosize
            minRows={2}
            size='sm'
          />
        </Stack>
      </Collapse>
    </Paper>
  )
}

// ── AppendValues table ─────────────────────────────────────────────────────────

function AppendValuesEditor({
  value,
  onChange,
}: {
  value: AppendValue[]
  onChange: (v: AppendValue[]) => void
}) {
  const [key, setKey] = useState('')
  const [val, setVal] = useState('')

  function add() {
    const k = key.trim()
    const v = val.trim()
    if (!k) return
    onChange([...value.filter((x) => x.key !== k), { key: k, value: v }])
    setKey('')
    setVal('')
  }

  return (
    <Stack gap='xs'>
      <Text size='sm' fw={500}>
        Append values
      </Text>
      <Text size='xs' c='dimmed'>
        Key/value pairs appended to every forwarded payload under{' '}
        <code>_metadata</code>.
      </Text>
      {value.map((row) => (
        <Group key={row.key} gap='xs'>
          <TextInput value={row.key} size='xs' readOnly style={{ flex: 1 }} />
          <TextInput value={row.value} size='xs' readOnly style={{ flex: 1 }} />
          <ActionX onClick={() => onChange(value.filter((x) => x.key !== row.key))} />
        </Group>
      ))}
      <Group gap='xs'>
        <TextInput
          placeholder='key'
          value={key}
          onChange={(e) => setKey(e.target.value)}
          size='xs'
          style={{ flex: 1 }}
        />
        <TextInput
          placeholder='value'
          value={val}
          onChange={(e) => setVal(e.target.value)}
          size='xs'
          style={{ flex: 1 }}
        />
        <Button size='xs' variant='light' onClick={add} disabled={!key.trim()}>
          Add
        </Button>
      </Group>
    </Stack>
  )
}

// ── Email notification editor ─────────────────────────────────────────────────

function EmailEditor({
  value,
  onChange,
  questions,
}: {
  value: EmailNotificationConfig | null | undefined
  onChange: (v: EmailNotificationConfig | null) => void
  questions: SurveyQuestion[]
}) {
  const enabled = value != null
  const cfg: EmailNotificationConfig = value ?? { to: [], subject: '' }

  return (
    <Paper withBorder p='sm'>
      <Group justify='space-between' mb='xs'>
        <Text fw={500} size='sm'>
          Email notification
        </Text>
        <Switch
          checked={enabled}
          onChange={(e) => onChange(e.currentTarget.checked ? { to: [], subject: '' } : null)}
          size='sm'
        />
      </Group>
      <Collapse in={enabled}>
        <Stack gap='sm'>
          <TagListInput
            label='To'
            value={cfg.to}
            onChange={(v) => onChange({ ...cfg, to: v })}
            placeholder='recipient@example.com'
          />
          <TextInput
            label='Subject'
            placeholder='New submission {{_uuid}}'
            value={cfg.subject}
            onChange={(e) => onChange({ ...cfg, subject: e.target.value })}
            size='sm'
          />
          <Textarea
            label='Body (plain text — use {{field}} for values, or enable AI body below)'
            value={cfg.body || ''}
            onChange={(e) => onChange({ ...cfg, body: e.target.value || undefined })}
            autosize
            minRows={3}
            size='sm'
          />
          <Switch
            label='Use AI to generate email body'
            checked={!!cfg.aiBody}
            onChange={(e) =>
              onChange({
                ...cfg,
                aiBody: e.currentTarget.checked
                  ? { instructions: '' }
                  : undefined,
              })
            }
            size='sm'
          />
          {cfg.aiBody && (
            <Textarea
              label='AI instructions'
              placeholder='Summarize the key fields and flag any urgent items…'
              value={cfg.aiBody.instructions}
              onChange={(e) =>
                onChange({ ...cfg, aiBody: { instructions: e.target.value } })
              }
              autosize
              minRows={2}
              size='sm'
            />
          )}
          <Switch
            label='Include PDF report'
            checked={!!cfg.pdfReport}
            onChange={(e) =>
              onChange({ ...cfg, pdfReport: e.currentTarget.checked ? {} : undefined })
            }
            size='sm'
          />
          {cfg.pdfReport && (
            <Group gap='sm'>
              <TextInput
                label='PDF template name'
                value={cfg.pdfReport.template || ''}
                onChange={(e) =>
                  onChange({ ...cfg, pdfReport: { ...cfg.pdfReport, template: e.target.value || undefined } })
                }
                size='sm'
                style={{ flex: 1 }}
              />
              <TextInput
                label='Form title override'
                value={cfg.pdfReport.formTitle || ''}
                onChange={(e) =>
                  onChange({ ...cfg, pdfReport: { ...cfg.pdfReport, formTitle: e.target.value || undefined } })
                }
                size='sm'
                style={{ flex: 1 }}
              />
            </Group>
          )}
          <Box>
            <Text size='xs' fw={500} mb={4}>
              Send condition (optional)
            </Text>
            <ConditionBuilder
              value={cfg.condition}
              onChange={(c) => onChange({ ...cfg, condition: c ?? undefined })}
              questions={questions}
            />
          </Box>
        </Stack>
      </Collapse>
    </Paper>
  )
}

// ── Failure notification editor ───────────────────────────────────────────────

function FailureNotifEditor({
  value,
  onChange,
}: {
  value: FailureNotificationConfig | null | undefined
  onChange: (v: FailureNotificationConfig | null) => void
}) {
  const enabled = value != null
  const cfg: FailureNotificationConfig = value ?? { to: [], subject: '' }

  return (
    <Paper withBorder p='sm'>
      <Group justify='space-between' mb='xs'>
        <Text fw={500} size='sm'>
          Failure notification
        </Text>
        <Switch
          checked={enabled}
          onChange={(e) =>
            onChange(e.currentTarget.checked ? { to: [], subject: '' } : null)
          }
          size='sm'
        />
      </Group>
      <Collapse in={enabled}>
        <Stack gap='sm'>
          <TagListInput
            label='To'
            value={cfg.to}
            onChange={(v) => onChange({ ...cfg, to: v })}
            placeholder='ops@example.com'
          />
          <TextInput
            label='Subject'
            placeholder='Pipeline failure for {{_uuid}}'
            value={cfg.subject}
            onChange={(e) => onChange({ ...cfg, subject: e.target.value })}
            size='sm'
          />
          <Textarea
            label='Body'
            placeholder='{{error}}'
            value={cfg.body || ''}
            onChange={(e) => onChange({ ...cfg, body: e.target.value || undefined })}
            autosize
            minRows={2}
            size='sm'
          />
        </Stack>
      </Collapse>
    </Paper>
  )
}

// ── Validate submission editor ────────────────────────────────────────────────

function ValidateEditor({
  value,
  onChange,
  questions,
}: {
  value: ValidateSubmissionConfig | null | undefined
  onChange: (v: ValidateSubmissionConfig | null) => void
  questions: SurveyQuestion[]
}) {
  const enabled = value != null
  const cfg: ValidateSubmissionConfig = value ?? { instructions: '' }

  return (
    <Paper withBorder p='sm'>
      <Group justify='space-between' mb='xs'>
        <Text fw={500} size='sm'>
          AI validation
        </Text>
        <Switch
          checked={enabled}
          onChange={(e) => onChange(e.currentTarget.checked ? { instructions: '' } : null)}
          size='sm'
        />
      </Group>
      <Collapse in={enabled}>
        <Stack gap='sm'>
          <Textarea
            label='Instructions'
            placeholder='Approve if all required fields are filled in and GPS coordinates are present…'
            value={cfg.instructions}
            onChange={(e) => onChange({ ...cfg, instructions: e.target.value })}
            autosize
            minRows={3}
            size='sm'
          />
          <Switch
            label='Write AI reasoning back to Kobo'
            checked={cfg.includeReasoning !== false}
            onChange={(e) => onChange({ ...cfg, includeReasoning: e.currentTarget.checked })}
            size='sm'
          />
          <Box>
            <Text size='xs' fw={500} mb={4}>
              Condition (skip validation if not met)
            </Text>
            <ConditionBuilder
              value={cfg.condition}
              onChange={(c) => onChange({ ...cfg, condition: c ?? undefined })}
              questions={questions}
            />
          </Box>
        </Stack>
      </Collapse>
    </Paper>
  )
}

// ── Main ConfigSection ────────────────────────────────────────────────────────

interface ConfigSectionProps {
  uid: string
  initialConfig: ProjectConfig
}

export function ConfigSection({ uid, initialConfig }: ConfigSectionProps) {
  const queryClient = useQueryClient()

  const { data: surveyData } = useQuery({
    queryKey: ['survey', uid],
    queryFn: () => api.config.survey(uid),
    staleTime: 5 * 60 * 1000,
  })
  const questions: SurveyQuestion[] = surveyData?.questions ?? []

  const [cfg, setCfg] = useState<ProjectConfig>(initialConfig)

  // Sync if parent refetches
  useEffect(() => {
    setCfg(initialConfig)
  }, [initialConfig])

  const { mutate: save, isPending: saving, isSuccess, error: saveError } = useMutation({
    mutationFn: () => api.config.save(uid, cfg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', uid] })
    },
  })

  const FORWARD_MEDIA_OPTIONS = [
    { value: 'image', label: 'Images' },
    { value: 'audio', label: 'Audio' },
    { value: 'video', label: 'Video' },
    { value: 'application', label: 'Other (application)' },
  ]

  return (
    <Stack gap='lg'>
      {saveError && (
        <Alert color='red' variant='light'>
          {saveError instanceof Error ? saveError.message : 'Save failed'}
        </Alert>
      )}
      {isSuccess && (
        <Alert color='green' variant='light'>
          Configuration saved.
        </Alert>
      )}

      {/* ── Forwarding ─────────────────────────────────────────────────── */}
      <Box>
        <Title order={5} mb='sm'>
          Forwarding
        </Title>
        <Stack gap='sm'>
          <Switch
            label='Forward to LogIE'
            checked={cfg.forwardToLogie}
            onChange={(e) => setCfg({ ...cfg, forwardToLogie: e.currentTarget.checked })}
            size='sm'
          />
          {!cfg.forwardToLogie && (
            <>
              <TextInput
                label='Forward URL'
                placeholder='https://your-system.example.com/receive'
                value={cfg.forwardUrl}
                onChange={(e) => setCfg({ ...cfg, forwardUrl: e.target.value })}
                size='sm'
              />
              <TextInput
                label='Forward token (Bearer)'
                placeholder='Optional auth token'
                value={cfg.forwardToken}
                onChange={(e) => setCfg({ ...cfg, forwardToken: e.target.value })}
                size='sm'
                type='password'
              />
            </>
          )}

          <Box>
            <Text size='xs' fw={500} mb={4}>
              Forward condition (skip forward if not met)
            </Text>
            <ConditionBuilder
              value={cfg.forwardCondition}
              onChange={(c) => setCfg({ ...cfg, forwardCondition: c })}
              questions={questions}

            />
          </Box>

          <MultiSelect
            label='Restrict fields forwarded'
            description='Leave empty to forward all fields'
            data={questions.map((q) => ({ value: q.xpath, label: q.label || q.xpath }))}
            value={cfg.fields}
            onChange={(v) => setCfg({ ...cfg, fields: v })}
            searchable
            size='sm'
          />

          <MultiSelect
            label='Forward media types'
            data={FORWARD_MEDIA_OPTIONS}
            value={cfg.forwardMedia ?? []}
            onChange={(v) => setCfg({ ...cfg, forwardMedia: v.length ? v : null })}
            size='sm'
          />

          <AppendValuesEditor
            value={cfg.appendValues}
            onChange={(v) => setCfg({ ...cfg, appendValues: v })}
          />
        </Stack>
      </Box>

      <Divider />

      {/* ── Geocoding ──────────────────────────────────────────────────── */}
      <Box>
        <Title order={5} mb='sm'>
          Geocoding
        </Title>
        <Stack gap='sm'>
          <Switch
            label='Geocode GPS coordinates → admin pcodes'
            checked={cfg.geocode}
            onChange={(e) => setCfg({ ...cfg, geocode: e.currentTarget.checked })}
            size='sm'
          />
          {cfg.geocode && (
            <>
              <Select
                label='GPS field (leave empty to use _geolocation)'
                data={[
                  { value: '', label: '(default: _geolocation)' },
                  ...questions
                    .filter((q) => q.type === 'geopoint')
                    .map((q) => ({ value: q.xpath, label: q.label || q.xpath })),
                ]}
                value={cfg.geocodeField || ''}
                onChange={(v) => setCfg({ ...cfg, geocodeField: v || '' })}
                size='sm'
                clearable
              />
              <Box>
                <Text size='xs' fw={500} mb={4}>
                  Geocode condition
                </Text>
                <ConditionBuilder
                  value={cfg.geocodeCondition}
                  onChange={(c) => setCfg({ ...cfg, geocodeCondition: c })}
                  questions={questions}
    
                />
              </Box>
            </>
          )}

          <MultiSelect
            label='Geocode address text fields'
            description='Resolve address strings to lat/lon + pcodes'
            data={questions
              .filter((q) => q.type === 'text')
              .map((q) => ({ value: q.xpath, label: q.label || q.xpath }))}
            value={cfg.geocodeAddressFields ?? []}
            onChange={(v) => setCfg({ ...cfg, geocodeAddressFields: v.length ? v : undefined })}
            searchable
            size='sm'
          />
        </Stack>
      </Box>

      <Divider />

      {/* ── Edit back ──────────────────────────────────────────────────── */}
      <Box>
        <Title order={5} mb='sm'>
          Edit back to Kobo
        </Title>
        <Switch
          label='Write enrichment results back to the original submission'
          checked={cfg.editOriginal}
          onChange={(e) => setCfg({ ...cfg, editOriginal: e.currentTarget.checked })}
          size='sm'
        />
      </Box>

      <Divider />

      {/* ── Enrichment ─────────────────────────────────────────────────── */}
      <Box>
        <Title order={5} mb='sm'>
          AI enrichment
        </Title>
        <Stack gap='sm'>
          {(['transcribe', 'extract', 'analyzeAudio', 'extractText'] as const).map((name) => (
            <EnrichBlock
              key={name}
              name={name}
              value={cfg[name]}
              onChange={(v) => setCfg({ ...cfg, [name]: v })}
              questions={questions}
            />
          ))}
        </Stack>
      </Box>

      <Divider />

      {/* ── Notifications ──────────────────────────────────────────────── */}
      <Box>
        <Title order={5} mb='sm'>
          Notifications
        </Title>
        <Stack gap='sm'>
          <EmailEditor
            value={cfg.emailNotification}
            onChange={(v) => setCfg({ ...cfg, emailNotification: v })}
            questions={questions}
          />
          <FailureNotifEditor
            value={cfg.failureNotification}
            onChange={(v) => setCfg({ ...cfg, failureNotification: v })}
          />
        </Stack>
      </Box>

      <Divider />

      {/* ── AI validation ──────────────────────────────────────────────── */}
      <Box>
        <Title order={5} mb='sm'>
          AI validation
        </Title>
        <ValidateEditor
          value={cfg.validateSubmission}
          onChange={(v) => setCfg({ ...cfg, validateSubmission: v })}
          questions={questions}
        />
      </Box>

      <Divider />

      <Group justify='flex-end'>
        <Button onClick={() => save()} loading={saving} size='sm'>
          Save configuration
        </Button>
      </Group>
    </Stack>
  )
}
