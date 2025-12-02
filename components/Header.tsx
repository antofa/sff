'use client'

import { Container, Group, Button, Text, Avatar, Menu, Loader, Modal, TextInput, Stack, Alert } from '@mantine/core'
import { IconSettings, IconBrandDiscord, IconLogout, IconUser, IconAlertCircle, IconEdit } from '@tabler/icons-react'
import { useSession, signIn, signOut } from 'next-auth/react'
import Image from 'next/image'
import { useEffect, useState } from 'react'

export function Header() {
  const { data: session, status } = useSession()
  const [logoError, setLogoError] = useState(false)
  const [logoSrc, setLogoSrc] = useState('https://solforgefusion.com/images/logo.png')
  const [profileOpen, setProfileOpen] = useState(false)
  const [gameNick, setGameNick] = useState('')
  const [friendCode, setFriendCode] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [currentGameNick, setCurrentGameNick] = useState('')
  const [isEditingNick, setIsEditingNick] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)

  const handleLogoError = () => {
    // Try alternative URLs
    if (logoSrc.includes('images/logo.png')) {
      setLogoSrc('https://www.solforgefusion.com/images/logo.png')
    } else if (logoSrc.includes('www.solforgefusion.com')) {
      setLogoSrc('https://solforgefusion.com/logo.png')
    } else {
      setLogoError(true)
    }
  }

  const handleDiscordLogin = () => {
    signIn('discord')
  }

  const handleLogout = () => {
    signOut()
  }

  // Persist friend code and verification code locally to avoid losing input on tab changes
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

  const loadProfile = async () => {
    if (!session) return
    setProfileLoading(true)
    setProfileError(null)
    setProfileSaved(false)
    try {
      const res = await fetch('/api/profile')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load profile')
      const apiNick = json.profile?.player_name || ''
      const apiFriend = json.profile?.friend_code || ''
      setCurrentGameNick(apiNick)
      setGameNick(apiNick)
      // preserve manually entered friend code if no value from API
      if (apiFriend) {
        setFriendCode(apiFriend)
      }
      setIsEditingNick(!apiNick)
    } catch (e: any) {
      setProfileError(e.message || 'Failed to load profile')
    } finally {
      setProfileLoading(false)
    }
  }

  useEffect(() => {
    if (profileOpen && session) {
      loadProfile()
    }
  }, [profileOpen, session])

  const saveProfile = async (payload?: { gameNick?: string; friendCode?: string }) => {
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
      setProfileSaved(true)
      setCurrentGameNick(payload?.gameNick ?? gameNick)
      setIsEditingNick(false)
    } catch (e: any) {
      setProfileError(e.message || 'Failed to save profile')
    } finally {
      setProfileLoading(false)
    }
  }

  // Get Discord avatar URL
  const getDiscordAvatarUrl = () => {
    if (session?.user?.discordId && session?.user?.avatar) {
      return `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatar}.png`
    }
    return session?.user?.image || null
  }

  return (
    <header className="w-full py-4 px-6 bg-slate-800/60 backdrop-blur-md border-b border-sf-primary/20">
      <Container size="xl">
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="sm" align="center" wrap="nowrap">
            {!logoError ? (
              <Image
                src={logoSrc}
                alt="SolForge Fusion"
                width={194}
                height={63}
                className="h-16 w-auto"
                style={{ objectFit: 'contain' }}
                onError={handleLogoError}
                priority
                unoptimized
              />
            ) : (
              <Text
                size="xl"
                fw={700}
                className="text-white"
                style={{
                  textShadow: '0 0 15px rgba(74, 144, 226, 0.4)',
                }}
              >
                SolForge Fusion
              </Text>
            )}
          </Group>

          <Group gap="xs" wrap="nowrap">
            <Button
              component="a"
              href="/"
              variant="light"
              size="sm"
              className="bg-slate-700/40 text-white border border-sf-primary/30 hover:border-sf-primary/60"
            >
              Search by player
            </Button>
            <Button
              component="a"
              href="/players"
              variant="light"
              size="sm"
              className="bg-slate-700/40 text-white border border-sf-primary/30 hover:border-sf-primary/60"
            >
              Players
            </Button>
            <Button
              component="a"
              href="/all-decks"
              variant="light"
              size="sm"
              className="bg-slate-700/40 text-white border border-sf-primary/30 hover:border-sf-primary/60"
            >
              All decks
            </Button>
          </Group>

          <Group gap="xs" wrap="nowrap">
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              className="text-white hover:bg-sf-primary/20 transition-colors"
            >
              <IconSettings size={18} />
            </Button>

            {status === 'loading' ? (
              <Loader size="sm" color="blue" />
            ) : session ? (
              // User is authenticated
              <Menu shadow="md" width={200} position="bottom-end">
                <Menu.Target>
                  <Button
                    variant="subtle"
                    color="gray"
                    size="sm"
                    className="text-white hover:bg-sf-primary/20 transition-colors"
                    leftSection={
                      <Avatar
                        src={getDiscordAvatarUrl()}
                        size={24}
                        radius="xl"
                        alt={session.user?.name || 'User'}
                      >
                        <IconUser size={14} />
                      </Avatar>
                    }
                  >
                    <Text size="sm" truncate maw={100}>
                      {session.user?.username || session.user?.name || 'User'}
                    </Text>
                  </Button>
                </Menu.Target>

                <Menu.Dropdown>
                  <Menu.Label>
                    <Group gap="xs">
                      <IconBrandDiscord size={14} />
                      <Text size="xs">{session.user?.email || 'Discord'}</Text>
                    </Group>
                  </Menu.Label>
                  <Menu.Item
                    leftSection={<IconEdit size={14} />}
                    onClick={() => setProfileOpen(true)}
                  >
                    Profile
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<IconLogout size={14} />}
                    onClick={handleLogout}
                  >
                    Sign Out
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : (
              // User is not authenticated
              <Button
                variant="filled"
                color="indigo"
                size="sm"
                leftSection={<IconBrandDiscord size={18} />}
                onClick={handleDiscordLogin}
                className="transition-all hover:scale-105"
              >
                Sign in with Discord
              </Button>
            )}
          </Group>
        </Group>
      </Container>

      <Modal
        opened={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Edit profile"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Current in-game nickname: <Text span fw={600}>{currentGameNick || 'not set'}</Text>
          </Text>
          <Text size="sm" c="dimmed">
            Friend code (saved): <Text span fw={600}>{friendCode || 'not set'}</Text>
          </Text>
          {!isEditingNick ? (
            <Group justify="flex-end">
              <Button onClick={() => setIsEditingNick(true)}>Change game account</Button>
            </Group>
          ) : (
            <>
              <Text size="sm" c="dimmed">
                To verify ownership, enter your friend code, generate a verification code, set it as your in-game last name, then verify.
              </Text>
              <TextInput
                label="Friend code"
                placeholder="Enter your friend code (e.g. 0ECQKGDPCF)"
                value={friendCode}
                onChange={(e) => setFriendCode(e.currentTarget.value)}
                disabled={profileLoading}
              />
              <Group gap="xs" justify="space-between">
                <Text size="sm">
                  Verification code: <Text span fw={600}>{verificationCode || '—'}</Text>
                </Text>
                <Button
                  variant="light"
                  size="xs"
                  onClick={() => {
                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
                    let code = ''
                    for (let i = 0; i < 10; i++) {
                      code += chars[Math.floor(Math.random() * chars.length)]
                    }
                    setVerificationCode(code)
                    setProfileSaved(false)
                    setProfileError(null)
                  }}
                  disabled={profileLoading}
                >
                  Generate code
                </Button>
              </Group>
              <Text size="sm" c="dimmed">
                Set your in-game last name to the verification code, then click verify. We will read your nickname from the API if the code matches.
              </Text>
            </>
          )}
          {profileError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {profileError}
            </Alert>
          )}
          {profileSaved && (
            <Alert color="green">
              Profile updated
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setProfileOpen(false)}>
              Close
            </Button>
            {isEditingNick && (
              <Button
                loading={profileLoading}
                onClick={async () => {
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
                }}
                disabled={profileLoading}
              >
                Verify & save
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </header>
  )
}
