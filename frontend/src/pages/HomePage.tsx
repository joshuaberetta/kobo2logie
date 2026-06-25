import {
  Alert,
  Box,
  Button,
  Center,
  Container,
  Image,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type User, api } from '../api/client'

export function HomePage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [formUid, setFormUid] = useState('')

  useEffect(() => {
    api.auth
      .me()
      .then((res) => {
        if (res.authenticated && res.user) {
          setUser(res.user)
        }
      })
      .catch(() => {})
      .finally(() => setCheckingAuth(false))
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.auth.login(username, password)
      setUser(res.user)
      setUsername('')
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    setLoading(true)
    try {
      await api.auth.logout()
      setUser(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed')
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = (e: React.FormEvent) => {
    e.preventDefault()
    const uid = formUid.trim()
    if (uid) navigate(`/${uid}`)
  }

  if (checkingAuth) {
    return (
      <Center mih='100vh' bg='gray.9'>
        <Text c='gray.4'>Loading…</Text>
      </Center>
    )
  }

  return (
    <Box mih='100vh' bg='gray.9' display='flex' flex={1} style={{ flexDirection: 'column' }}>
      <Center flex={1} p='xl'>
        <Container size='xs' w='100%'>
          {user ? (
            <Stack gap='lg'>
              <Stack align='center' gap='xs'>
                <Image
                  src='/KoboToolbox_logo_white.svg'
                  alt='KoboToolbox'
                  mah={28}
                  maw={160}
                  fit='contain'
                />
                <Title order={4} c='white'>
                  LogIE
                </Title>
                <Text size='xs' c='dimmed'>
                  Signed in as <strong>{user.username}</strong>
                </Text>
              </Stack>

              <form onSubmit={handleOpen}>
                <Stack gap='sm'>
                  <TextInput
                    label='Form UID'
                    placeholder='aXXXXXXXXXXXXXXXXXXXXXX'
                    value={formUid}
                    onChange={(e) => setFormUid(e.target.value)}
                    size='md'
                    description='Paste the KoboToolbox asset UID to open its LogIE configuration'
                  />
                  <Button type='submit' fullWidth size='md' disabled={!formUid.trim()}>
                    Open form
                  </Button>
                </Stack>
              </form>

              {error && <Alert color='red'>{error}</Alert>}

              <Button
                variant='transparent'
                color='gray'
                size='xs'
                onClick={handleLogout}
                loading={loading}
              >
                Sign out
              </Button>
            </Stack>
          ) : (
            <Stack align='center' gap='xl'>
              <Image
                src='/KoboToolbox_logo_white.svg'
                alt='KoboToolbox'
                mah={32}
                maw={180}
                fit='contain'
              />
              <Title order={2} ta='center' c='white'>
                LogIE
              </Title>
              <Text size='sm' c='dimmed' ta='center'>
                KoboToolbox submission pipeline
              </Text>

              <Box w='100%'>
                <form onSubmit={handleLogin}>
                  <Stack gap='md'>
                    {error && <Alert color='red'>{error}</Alert>}
                    <TextInput
                      label='Username'
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      size='md'
                    />
                    <PasswordInput
                      label='Password'
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      size='md'
                    />
                    <Button type='submit' loading={loading} fullWidth size='md' mt='sm'>
                      Log in
                    </Button>
                  </Stack>
                </form>
              </Box>
            </Stack>
          )}
        </Container>
      </Center>
    </Box>
  )
}
