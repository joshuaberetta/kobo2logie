import {
  Alert,
  Box,
  Center,
  Container,
  Group,
  Image,
  Loader,
  Tabs,
  Text,
  Title,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { ConfigSection } from '../components/ConfigSection'
import { LogsSection } from '../components/LogsSection'
import { SetupSection } from '../components/SetupSection'

export function FormPage() {
  const { uid } = useParams<{ uid: string }>()
  const navigate = useNavigate()

  const {
    data: config,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['config', uid],
    queryFn: () => api.config.get(uid!),
    enabled: !!uid,
    retry: false,
  })

  if (!uid) {
    return (
      <Center mih='100vh'>
        <Text c='dimmed'>No form UID</Text>
      </Center>
    )
  }

  if (isLoading) {
    return (
      <Center mih='100vh'>
        <Loader />
      </Center>
    )
  }

  if (error) {
    return (
      <Center mih='100vh'>
        <Alert color='red' title='Error loading config'>
          {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      </Center>
    )
  }

  return (
    <Box mih='100vh' bg='gray.9'>
      {/* Header */}
      <Box bg='dark.7' px='xl' py='sm' style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
        <Container size='lg'>
          <Group justify='space-between'>
            <Group gap='sm'>
              <Image
                src='/KoboToolbox_logo_icon_white.svg'
                alt='Kobo'
                h={24}
                w='auto'
                style={{ cursor: 'pointer' }}
                onClick={() => navigate('/')}
              />
              <Title order={5} c='white'>
                LogIE
              </Title>
            </Group>
            <Text size='xs' c='dimmed' style={{ fontFamily: 'monospace' }}>
              {uid}
            </Text>
          </Group>
        </Container>
      </Box>

      <Container size='lg' py='xl'>
        <Tabs defaultValue='logs' variant='outline'>
          <Tabs.List mb='lg'>
            <Tabs.Tab value='logs'>Submissions</Tabs.Tab>
            <Tabs.Tab value='config'>Configure</Tabs.Tab>
            <Tabs.Tab value='setup'>Setup</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value='logs'>
            <LogsSection uid={uid} />
          </Tabs.Panel>

          <Tabs.Panel value='config'>
            {config && <ConfigSection uid={uid} initialConfig={config} />}
          </Tabs.Panel>

          <Tabs.Panel value='setup'>
            <SetupSection uid={uid} currentServer={config?.server ?? ''} />
          </Tabs.Panel>
        </Tabs>
      </Container>
    </Box>
  )
}
