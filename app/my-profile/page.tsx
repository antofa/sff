'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  ActionIcon,
  Container,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { IconAlertCircle, IconBrandDiscord, IconCards, IconCheck, IconRefresh, IconShieldCheck, IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useSession } from 'next-auth/react'
import { BackgroundElements } from '@/components/BackgroundElements'
import { Header } from '@/components/Header'
import { DeckList } from '@/components/DeckList'
import { useDeckStore } from '@/store/deckStore'

const VERIFICATION_HELP = 'Enter your friend code, generate a verification code, set it as your in-game last name, then verify to save.'

export default function MyProfilePage() {
  const { data: session, status } = useSession()
  const [friendCode, setFriendCode] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [gameNick, setGameNick] = useState('')
  const [currentGameNick, setCurrentGameNick] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  const [isEditingNick, setIsEditingNick] = useState(true)
  const lastFetchedPlayer = useRef<string | null>(null)
  const [profileCollapsed, setProfileCollapsed] = useState(true)

  const { decks, fusedDecks, loading: decksLoading, error: decksError, fetchDecks, clearDecks } = useDeckStore()

  // Persist friend/verification locally
  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedFriend = window.localStorage.getItem('sff_friend_code')
    const storedVerification = window.localStorage.getItem('sff_verification_code')
    if (storedFriend) setFriendCode(storedFriend)
    if (storedVerification) setVerificationCode(storedVerification)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('sff_friend_code', friendCode)
  }, [friendCode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('sff_verification_code', verificationCode)
  }, [verificationCode])

  const loadProfile = useCallback(async () => {
    if (!session) return
    setProfileLoading(true)
    setProfileError(null)
    setProfileSaved(false)
    try {
      const res = await fetch('/api/profile')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load profile')
      const apiNick =
        json.profile?.player_name ||
        json.profile?.display_name ||
        ''
      const apiFriend = json.profile?.friend_code || ''
      setCurrentGameNick(apiNick)
      setGameNick(apiNick)
      if (apiFriend) {
        setFriendCode(apiFriend)
      }
      setIsEditingNick(!apiNick)
    } catch (e: any) {
      setProfileError(e.message || 'Failed to load profile')
    } finally {
      setProfileLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (status === 'authenticated') {
      loadProfile().catch(() => {
        /* handled above */
      })
    }
  }, [status, loadProfile])

  const saveProfile = useCallback(
    async (payload?: { gameNick?: string; friendCode?: string }) => {
      setProfileLoading(true)
      setProfileError(null)
      setProfileSaved(false)
      try {
        const res = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameNick: payload?.gameNick ?? gameNick,
            friendCode: payload?.friendCode ?? friendCode,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to save profile')
        const newNick = payload?.gameNick ?? gameNick
        setProfileSaved(true)
        setCurrentGameNick(newNick)
        setIsEditingNick(false)
      } catch (e: any) {
        setProfileError(e.message || 'Failed to save profile')
      } finally {
        setProfileLoading(false)
      }
    },
    [friendCode, gameNick]
  )

  const handleVerifyAndSave = useCallback(async () => {
    setProfileError(null)
    setProfileSaved(false)
    if (!friendCode) {
      setProfileError('Friend code is required')
      return
    }
    if (!verificationCode) {
      setProfileError('Generate a verification code first')
      return
    }
    try {
      setProfileLoading(true)
      const res = await fetch(`https://hpp2exnbyd.execute-api.us-east-1.amazonaws.com/solforprod/users/${friendCode}`)
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || 'Failed to fetch player data')
      }
      const lastName = json.lastName || json.last_name
      if (lastName !== verificationCode) {
        throw new Error('Verification code was not found in last name. Update last name to the generated code and try again.')
      }
      const nicknameFromApi = json.nickname || json.nickName || ''
      if (!nicknameFromApi) {
        throw new Error('Nickname not found in response.')
      }
      setGameNick(nicknameFromApi)
      setCurrentGameNick(nicknameFromApi)
      await saveProfile({ gameNick: nicknameFromApi, friendCode })
    } catch (e: any) {
      setProfileError(e.message || 'Verification failed')
    } finally {
      setProfileLoading(false)
    }
  }, [friendCode, verificationCode, saveProfile])

  const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let code = ''
    for (let i = 0; i < 10; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }
    setVerificationCode(code)
    setProfileSaved(false)
    setProfileError(null)
  }

  const playerNameForDecks = useMemo(() => {
    const resolved = currentGameNick || gameNick
    return resolved?.trim() || ''
  }, [currentGameNick, gameNick])

  useEffect(() => {
    if (!playerNameForDecks) return
    const normalized = playerNameForDecks.toLowerCase()
    if (lastFetchedPlayer.current === normalized) return
    lastFetchedPlayer.current = normalized
    fetchDecks(playerNameForDecks).catch((err) => {
      console.error('[MyProfile] Failed to fetch decks:', err)
    })
  }, [playerNameForDecks, fetchDecks])

  const handleRefreshDecks = () => {
    if (!playerNameForDecks) return
    clearDecks()
    lastFetchedPlayer.current = null
    fetchDecks(playerNameForDecks).catch((err) => {
      console.error('[MyProfile] Failed to refresh decks:', err)
    })
  }

  const hasLinkedNick = !!currentGameNick

  if (status === 'loading') {
    return (
      <main className="min-h-screen relative overflow-hidden">
        <BackgroundElements />
        <Header />
        <Container size="lg" className="py-12">
          <Group justify="center">
            <Loader size="lg" />
          </Group>
        </Container>
      </main>
    )
  }

  if (status !== 'authenticated' || !session) {
    return (
      <main className="min-h-screen relative overflow-hidden">
        <BackgroundElements />
        <Header />
        <Container size="lg" className="py-12">
          <Paper p="xl" className="bg-slate-800/60 border border-sf-primary/30 rounded-xl">
            <Stack gap="md" align="center">
              <IconBrandDiscord size={32} className="text-gray-300" />
              <Title order={3} className="text-white">Sign in required</Title>
              <Text className="text-gray-300" ta="center">
                Please sign in with Discord to edit your profile and view your decks.
              </Text>
            </Stack>
          </Paper>
        </Container>
      </main>
    )
  }

  return (
    <main className="min-h-screen relative overflow-hidden">
      <BackgroundElements />
      <Header />
      <Container size="xl" className="relative z-10 py-12">
        <Stack gap="xl" align="center">
          <div className="w-full max-w-6xl">
            <Title order={2} className="text-white">My Profile</Title>
            <Text className="text-gray-400">
              Manage your linked SolForge Fusion account and view your decks.
            </Text>
          </div>

          <Paper
            p="lg"
            className="bg-slate-800/60 backdrop-blur-md border border-sf-primary/30 rounded-lg max-w-6xl mx-auto w-full"
          >
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Group gap="xs" align="center">
                  <Badge color="violet" variant="light" leftSection={<IconBrandDiscord size={14} />}>
                    {session.user?.username || session.user?.name || 'Discord user'}
                  </Badge>
                  {hasLinkedNick && (
                    <Badge color="green" variant="light" leftSection={<IconCheck size={14} />}>
                      Linked: {currentGameNick}
                    </Badge>
                  )}
                </Group>
                <Group gap="xs">
                  <Button variant="light" size="sm" onClick={loadProfile} loading={profileLoading}>
                    Reload profile
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshDecks}
                    leftSection={<IconRefresh size={16} />}
                    disabled={!playerNameForDecks}
                    loading={decksLoading}
                  >
                    Refresh decks
                  </Button>
                  <ActionIcon
                    variant="filled"
                    color="gray"
                    size="lg"
                    onClick={() => setProfileCollapsed((prev) => !prev)}
                    aria-label={profileCollapsed ? 'Expand profile panel' : 'Collapse profile panel'}
                  >
                    {profileCollapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
                  </ActionIcon>
                </Group>
              </Group>

              {!profileCollapsed && (
                <>
                  <Divider opacity={0.2} />

                  <Stack gap="sm">
                    <Text size="sm" className="text-gray-300">
                      {hasLinkedNick
                        ? 'You are linked. Change linked account only if you need to re-verify.'
                        : VERIFICATION_HELP}
                    </Text>
                    <TextInput
                      label="Friend code"
                      placeholder="Enter your friend code (e.g. 0ECQKGDPCF)"
                      value={friendCode}
                      onChange={(e) => setFriendCode(e.currentTarget.value)}
                      disabled={profileLoading}
                    />
                    {currentGameNick && (
                      <Text size="sm" className="text-gray-300">
                        Current linked nickname: <Text span fw={700}>{currentGameNick}</Text>
                      </Text>
                    )}
                    {isEditingNick && (
                      <>
                        <Group gap="xs" justify="space-between" wrap="wrap">
                          <Text size="sm" className="text-gray-300">
                            Verification code: <Text span fw={600}>{verificationCode || '—'}</Text>
                          </Text>
                          <Button variant="light" size="xs" onClick={generateCode} disabled={profileLoading}>
                            Generate code
                          </Button>
                        </Group>
                        <Alert color="blue" icon={<IconShieldCheck size={16} />}>
                          {VERIFICATION_HELP}
                        </Alert>
                      </>
                    )}
                  </Stack>

                  {profileError && (
                    <Alert color="red" icon={<IconAlertCircle size={16} />}>
                      {profileError}
                    </Alert>
                  )}
                  {profileSaved && (
                    <Alert color="green" icon={<IconCheck size={16} />}>
                      Profile updated
                    </Alert>
                  )}

                  <Group justify="flex-end" gap="sm">
                    {!isEditingNick && (
                      <Button
                        variant="default"
                        onClick={() => {
                          setIsEditingNick(true)
                          setProfileSaved(false)
                          setProfileError(null)
                          setVerificationCode('')
                        }}
                      >
                        Change linked account
                      </Button>
                    )}
                    <Button
                      variant="light"
                      onClick={() => saveProfile()}
                      loading={profileLoading}
                      disabled={profileLoading}
                    >
                      Save friend code
                    </Button>
                    {isEditingNick && (
                      <Button
                        onClick={handleVerifyAndSave}
                        loading={profileLoading}
                        disabled={profileLoading}
                      >
                        Verify & save
                      </Button>
                    )}
                  </Group>
                </>
              )}
            </Stack>
          </Paper>

          <Paper
            p="lg"
            className="bg-slate-800/60 backdrop-blur-md border border-sf-primary/30 rounded-lg max-w-6xl mx-auto w-full"
          >
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Group gap="sm" align="center">
                  <IconCards size={20} className="text-sf-primary" />
                  <Group gap="xs" align="center">
                    <Title order={4} className="text-white" style={{ marginBottom: 0 }}>
                      My decks
                    </Title>
                    {playerNameForDecks && (
                      <Badge color="blue" variant="light" size="sm">
                        Player: {playerNameForDecks}
                      </Badge>
                    )}
                  </Group>
                </Group>
                <div />
              </Group>
              {decksError && (
                <Alert color="red" icon={<IconAlertCircle size={16} />}>
                  Failed to load decks: {decksError}
                </Alert>
              )}
              {decksLoading && (
                <Group justify="center" py="md">
                  <Loader />
                </Group>
              )}
              {!decksLoading && playerNameForDecks && (decks.length > 0 || fusedDecks.length > 0) && (
                <div className="flex justify-center">
                  <div className="w-full max-w-6xl">
                    <DeckList decks={decks} fusedDecks={fusedDecks} />
                  </div>
                </div>
              )}
              {!decksLoading && playerNameForDecks && decks.length === 0 && fusedDecks.length === 0 && !decksError && (
                <Alert color="yellow" variant="light">
                  No decks found for this player yet.
                </Alert>
              )}
              {!playerNameForDecks && (
                <Alert color="blue" variant="light">
                  Link your in-game nickname to see your decks.
                </Alert>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </main>
  )
}
