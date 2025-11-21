'use client'

import { Container, Group, Button, Text } from '@mantine/core'
import { IconSettings, IconBrandDiscord, IconPower } from '@tabler/icons-react'
import Image from 'next/image'
import { useState } from 'react'

export function Header() {
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

  return (
    <header className="w-full py-4 px-6 bg-slate-800/60 backdrop-blur-md border-b border-sf-primary/20">
      <Container size="xl">
        <Group justify="space-between" align="center">
          <Group gap="sm" align="center">
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
          <Group gap="xs">
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              className="text-white hover:bg-sf-primary/20 transition-colors"
            >
              <IconSettings size={18} />
            </Button>
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              className="text-white hover:bg-sf-primary/20 transition-colors"
            >
              <IconBrandDiscord size={18} />
            </Button>
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              className="text-white hover:bg-sf-primary/20 transition-colors"
            >
              <IconPower size={18} />
            </Button>
          </Group>
        </Group>
      </Container>
    </header>
  )
}

