import {
  ActionIcon,
  Box,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import { useState } from 'react'
import { api } from '../api/client'
import type { Combinator, ConditionGroup, ConditionRule, Operator, SurveyQuestion } from '../types'

const OPERATORS: { value: Operator; label: string; noValue?: boolean }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'is_empty', label: 'is empty', noValue: true },
  { value: 'is_not_empty', label: 'is not empty', noValue: true },
  { value: 'greater_than', label: '>' },
  { value: 'less_than', label: '<' },
  { value: 'greater_than_or_equal', label: '>=' },
  { value: 'less_than_or_equal', label: '<=' },
]

function emptyGroup(): ConditionGroup {
  return { type: 'group', combinator: 'and', rules: [] }
}

function emptyRule(): ConditionRule {
  return { type: 'rule', field: '', operator: 'equals', value: '' }
}

interface RuleRowProps {
  rule: ConditionRule
  questions: SurveyQuestion[]
  onChange: (r: ConditionRule) => void
  onRemove: () => void
}

function RuleRow({ rule, questions, onChange, onRemove }: RuleRowProps) {
  const opDef = OPERATORS.find((o) => o.value === rule.operator)
  const fieldOptions = questions.map((q) => ({ value: q.xpath, label: q.label || q.xpath }))

  return (
    <Group gap='xs' wrap='nowrap' align='flex-start'>
      <Select
        placeholder='Field'
        data={fieldOptions}
        value={rule.field || null}
        onChange={(v) => onChange({ ...rule, field: v || '' })}
        searchable
        clearable
        style={{ flex: 2, minWidth: 120 }}
        size='sm'
      />
      <Select
        data={OPERATORS.map((o) => ({ value: o.value, label: o.label }))}
        value={rule.operator}
        onChange={(v) => onChange({ ...rule, operator: (v as Operator) || 'equals', value: '' })}
        style={{ flex: 1.5, minWidth: 100 }}
        size='sm'
      />
      {!opDef?.noValue && (
        <TextInput
          placeholder='Value'
          value={rule.value || ''}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
          style={{ flex: 2, minWidth: 100 }}
          size='sm'
        />
      )}
      <ActionIcon variant='transparent' color='red' onClick={onRemove} size='sm' mt={4}>
        ×
      </ActionIcon>
    </Group>
  )
}

interface GroupEditorProps {
  group: ConditionGroup
  questions: SurveyQuestion[]
  onChange: (g: ConditionGroup) => void
  onRemove?: () => void
  depth?: number
}

function GroupEditor({ group, questions, onChange, onRemove, depth = 0 }: GroupEditorProps) {
  function updateRule(i: number, r: ConditionRule | ConditionGroup) {
    const rules = [...group.rules]
    rules[i] = r
    onChange({ ...group, rules })
  }
  function removeRule(i: number) {
    const rules = group.rules.filter((_, idx) => idx !== i)
    onChange({ ...group, rules })
  }
  function addRule() {
    onChange({ ...group, rules: [...group.rules, emptyRule()] })
  }
  function addGroup() {
    onChange({ ...group, rules: [...group.rules, emptyGroup()] })
  }

  return (
    <Paper withBorder p='sm' style={{ background: depth % 2 === 0 ? undefined : 'var(--mantine-color-dark-6)' }}>
      <Stack gap='xs'>
        <Group justify='space-between'>
          <Select
            data={[
              { value: 'and', label: 'ALL of (AND)' },
              { value: 'or', label: 'ANY of (OR)' },
            ]}
            value={group.combinator}
            onChange={(v) => onChange({ ...group, combinator: (v as Combinator) || 'and' })}
            size='xs'
            style={{ width: 140 }}
          />
          {onRemove && (
            <ActionIcon variant='transparent' color='red' onClick={onRemove} size='sm'>
              ×
            </ActionIcon>
          )}
        </Group>

        {group.rules.map((rule, i) =>
          rule.type === 'rule' ? (
            <RuleRow
              key={i}
              rule={rule}
              questions={questions}
              onChange={(r) => updateRule(i, r)}
              onRemove={() => removeRule(i)}
            />
          ) : (
            <GroupEditor
              key={i}
              group={rule}
              questions={questions}
              onChange={(g) => updateRule(i, g)}
              onRemove={() => removeRule(i)}
              depth={depth + 1}
            />
          ),
        )}

        <Group gap='xs'>
          <Button variant='transparent' size='xs' onClick={addRule}>
            + rule
          </Button>
          <Button variant='transparent' size='xs' onClick={addGroup}>
            + group
          </Button>
        </Group>
      </Stack>
    </Paper>
  )
}

interface ConditionBuilderProps {
  value: ConditionGroup | null | undefined
  onChange: (v: ConditionGroup | null) => void
  questions: SurveyQuestion[]
}

export function ConditionBuilder({ value, onChange, questions }: ConditionBuilderProps) {
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const active = value ?? emptyGroup()

  async function handleGenerate() {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await api.config.generateCondition(aiPrompt, value)
      onChange(res.condition)
      setAiPrompt('')
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <Stack gap='sm'>
      <GroupEditor
        group={active}
        questions={questions}
        onChange={onChange}
      />

      <Box>
        <Text size='xs' c='dimmed' mb={4}>
          Describe a condition in plain language (AI will generate it)
        </Text>
        <Group gap='xs' align='flex-end'>
          <Textarea
            placeholder='e.g. only when country is Kenya and age is greater than 18'
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            autosize
            minRows={1}
            maxRows={3}
            style={{ flex: 1 }}
            size='sm'
          />
          <Button
            size='sm'
            onClick={handleGenerate}
            loading={aiLoading}
            disabled={!aiPrompt.trim()}
          >
            Generate
          </Button>
        </Group>
        {aiError && (
          <Text size='xs' c='red' mt={4}>
            {aiError}
          </Text>
        )}
      </Box>

      {value && (
        <Button
          variant='transparent'
          color='red'
          size='xs'
          onClick={() => onChange(null)}
          style={{ alignSelf: 'flex-start' }}
        >
          Clear condition
        </Button>
      )}
    </Stack>
  )
}
