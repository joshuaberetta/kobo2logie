import { Alert, Box, Button, Divider, Select, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { api } from '../api/client'

const SERVERS = [
  { value: 'https://kf.kobotoolbox.org', label: 'Global (kf.kobotoolbox.org)' },
  { value: 'https://eu.kobotoolbox.org', label: 'EU (eu.kobotoolbox.org)' },
]

interface SetupSectionProps {
  uid: string
  currentServer: string
}

export function SetupSection({ uid, currentServer }: SetupSectionProps) {
  const [server, setServer] = useState(currentServer || 'https://kf.kobotoolbox.org')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState<'hook' | 'perms' | null>(null)
  const [results, setResults] = useState<{ hook?: string; perms?: string } | null>(null)

  async function handleSetupHook() {
    setLoading('hook')
    setResults(null)
    try {
      const res = await api.config.setupRestService(server, uid, token)
      if (res.already_exists) {
        setResults({ hook: 'REST service already exists — no change made.' })
      } else {
        setResults({ hook: 'REST service registered successfully.' })
      }
    } catch (err) {
      setResults({ hook: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` })
    } finally {
      setLoading(null)
    }
  }

  async function handleSetupPerms() {
    setLoading('perms')
    setResults(null)
    try {
      const res = await api.config.setupPermissions(server, uid, token)
      if (res.already_exists) {
        setResults({ perms: 'Permission already exists — no change made.' })
      } else {
        setResults({ perms: 'View submissions permission granted to wfp_logie.' })
      }
    } catch (err) {
      setResults({ perms: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` })
    } finally {
      setLoading(null)
    }
  }

  return (
    <Stack gap='md'>
      <Text size='sm' c='dimmed'>
        Enter your KoboToolbox API token to register the webhook and grant the LogIE service account
        read access to this form.
      </Text>

      <Select
        label='KoboToolbox server'
        data={SERVERS}
        value={server}
        onChange={(v) => setServer(v || SERVERS[0].value)}
        size='sm'
      />

      <TextInput
        label='API token'
        placeholder='Paste your KoboToolbox API token'
        value={token}
        onChange={(e) => setToken(e.target.value)}
        size='sm'
        type='password'
      />

      <Text size='xs' c='dimmed'>
        Form UID: <strong>{uid}</strong>
      </Text>

      <Divider />

      <Stack gap='xs'>
        <Box>
          <Button
            onClick={handleSetupHook}
            loading={loading === 'hook'}
            disabled={!token.trim() || loading !== null}
            size='sm'
          >
            Register REST service webhook
          </Button>
          {results?.hook && (
            <Text size='xs' mt={4} c={results.hook.startsWith('Error') ? 'red' : 'green'}>
              {results.hook}
            </Text>
          )}
        </Box>

        <Box>
          <Button
            onClick={handleSetupPerms}
            loading={loading === 'perms'}
            disabled={!token.trim() || loading !== null}
            size='sm'
            variant='light'
          >
            Grant view_submissions permission
          </Button>
          {results?.perms && (
            <Text size='xs' mt={4} c={results.perms.startsWith('Error') ? 'red' : 'green'}>
              {results.perms}
            </Text>
          )}
        </Box>
      </Stack>

      <Alert color='blue' variant='light'>
        <Text size='xs'>
          The REST service sends each new submission to LogIE automatically. The permission grant
          allows LogIE to fetch attachment files for transcription, extraction, and email
          attachments.
        </Text>
      </Alert>
    </Stack>
  )
}
