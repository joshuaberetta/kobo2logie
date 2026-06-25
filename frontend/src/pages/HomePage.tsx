import {
  Alert,
  Avatar,
  Badge,
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
import { type User, api } from '../api/client'

export function HomePage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

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

  if (checkingAuth) {
    return (
      <Center mih="100vh" bg="gray.8">
        <Text c="gray.2">Loading...</Text>
      </Center>
    )
  }

  return (
    <Box mih="100vh" bg="gray.8" display="flex" flex={1} style={{ flexDirection: 'column' }}>
      {/* Main content */}
      <Center flex={1} p="xl">
        <Container size="xs" w="100%">
          {user ? (
            <Stack align="center" gap="lg">
              <Avatar size="xl" radius="xl" color="blue">
                {user.username.charAt(0).toUpperCase()}
              </Avatar>
              <Box ta="center">
                <Title order={3} mb="xs">
                  Welcome back
                </Title>
                <Text size="lg" fw={600} c="blue.6">
                  {user.username}
                </Text>
                {user.email && (
                  <Text size="sm" c="gray.3" mt="xs">
                    {user.email}
                  </Text>
                )}
              </Box>
              <Button
                variant="danger-secondary"
                onClick={handleLogout}
                loading={loading}
                fullWidth
                size="md"
              >
                Sign out
              </Button>
            </Stack>
          ) : (
            <Stack align="center" gap="xl">
              {/* Server badge */}
              <Badge size="lg" radius="xl" color="blue" variant="light">
                POC App Template
              </Badge>

              {/* Logo */}
              <Image
                src="/KoboToolbox_logo_dark.svg"
                alt="KoboToolbox"
                mah={32}
                maw={180}
                fit="contain"
              />

              {/* Title */}
              <Title order={2} ta="center">
                Log in to your account
              </Title>

              {/* Form */}
              <Box w="100%">
                <form onSubmit={handleLogin}>
                  <Stack gap="md">
                    {error && <Alert type="error">{error}</Alert>}

                    <TextInput
                      label="Username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      size="md"
                    />

                    <PasswordInput
                      label="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      size="md"
                    />

                    <Button type="submit" loading={loading} fullWidth size="md" mt="sm">
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
