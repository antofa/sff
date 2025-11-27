'use client'

import { Container, Group, Button, Text, Avatar, Menu, Loader } from '@mantine/core'
import { IconSettings, IconBrandDiscord, IconLogout, IconUser } from '@tabler/icons-react'
import { useSession, signIn, signOut } from 'next-auth/react'
import Image from 'next/image'
import { useState } from 'react'

export function Header() {
  const { data: session, status } = useSession()
  const [logoError, setLogoError] = useState(false)
  const [logoSrc, setLogoSrc] = useState('https://solforgefusion.com/images/logo.png')

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
    </header>
  )
}
