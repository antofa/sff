'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Container, Title, TextInput, Button, Paper, Loader, Stack } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useDeckStore } from '@/store/deckStore'
import { DeckList } from '@/components/DeckList'
import { Header } from '@/components/Header'
import { BackgroundElements } from '@/components/BackgroundElements'

export default function Home() {
  const [playerName, setPlayerName] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const searchedNameRef = useRef<string>('')
  const { decks, fusedDecks, loading, fetchDecks } = useDeckStore()
  const lastSearchRef = useRef<string>('')


  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setPlayerName(newValue)
    // Mark as typing to hide DeckList and prevent blocking
    setIsTyping(true)
    // Reset search flag when text changes (using functional update to avoid dependency)
    setHasSearched(prev => prev ? false : prev)
    
    // If field is cleared, reset typing state immediately
    if (newValue === '') {
      setIsTyping(false)
      searchedNameRef.current = ''
    }
  }, [])

  const handleInputFocus = useCallback(() => {
    // Clear the field when user focuses on the input after successful search
    // Only clear if results are displayed (not loading, has searched, and has results)
    if (hasSearched && !loading && playerName && searchedNameRef.current === playerName && (decks.length > 0 || fusedDecks.length > 0)) {
      setPlayerName('')
      setHasSearched(false)
      setIsTyping(false)
      searchedNameRef.current = ''
    }
  }, [hasSearched, loading, playerName, decks.length, fusedDecks.length])

  const handleSearch = async () => {
    if (!playerName.trim()) {
      notifications.show({
        title: 'Error',
        message: 'Please enter a player nickname',
        color: 'red',
      })
      return
    }

    setIsTyping(false)
    setHasSearched(true)
    // Store the searched name to detect when user starts typing new text
    searchedNameRef.current = playerName.trim()
    lastSearchRef.current = playerName.trim()

    try {
      await fetchDecks(playerName.trim())
      const { decks: loadedDecks, fusedDecks: loadedFusedDecks } = useDeckStore.getState()
      
      if (loadedDecks.length > 0 || loadedFusedDecks.length > 0) {
        const totalDecks = loadedDecks.length + loadedFusedDecks.length
        notifications.show({
          title: 'Success',
          message: `Found ${totalDecks} deck${totalDecks !== 1 ? 's' : ''}`,
          color: 'green',
        })
      } else {
        notifications.show({
          title: 'Information',
          message: 'No decks found. Please check the player nickname.',
          color: 'blue',
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Page] Error loading decks:', error)
      
      let userMessage = 'Failed to load decks. Please check your internet connection and try again.'
      
      if (errorMessage.includes('cannot be empty') || errorMessage.includes('не может быть пустым')) {
        userMessage = 'Please enter a player nickname'
      } else if (errorMessage.includes('timeout') || errorMessage.includes('время ожидания')) {
        userMessage = 'Request timeout. Please try again.'
      } else if (errorMessage.includes('network') || errorMessage.includes('сеть')) {
        userMessage = 'Network error. Please check your internet connection.'
      } else if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('не найден')) {
        userMessage = 'Player not found. Please check the nickname.'
      }
      
      notifications.show({
        title: 'Error',
        message: userMessage,
        color: 'red',
      })
    }
  }

  // If вкладка была свернута и загрузка застыла, повторно дергаем поиск при возврате фокуса
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && loading && lastSearchRef.current) {
        fetchDecks(lastSearchRef.current).catch(() => {
          /* ошибки уже логируются внутри fetchDecks */
        })
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [loading, fetchDecks])

  return (
    <main className="min-h-screen relative overflow-hidden">
      <BackgroundElements />
      <Header />
      <Container size="xl" className="relative z-10 py-12">
        <Stack gap="xl" align="center">
          <div className="text-center space-y-4">
            <Title
              order={1}
              className="text-5xl md:text-6xl font-bold text-white mb-4"
              style={{
                textShadow: '0 0 25px rgba(74, 144, 226, 0.4), 0 0 50px rgba(80, 200, 120, 0.2)',
              }}
            >
              SolForge Fusion
            </Title>
            <Title
              order={2}
              className="text-2xl md:text-3xl mb-8"
              style={{
                background: 'linear-gradient(135deg, #4a90e2 0%, #50c878 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Player Deck Viewer
            </Title>
          </div>

          <Paper
            p="xl"
            className="w-full max-w-2xl bg-slate-800/60 backdrop-blur-md border border-sf-primary/30 rounded-xl shadow-2xl"
            style={{ backgroundColor: 'rgba(30, 41, 59, 0.6)' }}
          >
            <Stack gap="md">
              <TextInput
                size="lg"
                placeholder="Enter player nickname"
                value={playerName}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                  }
                }}
                leftSection={<IconSearch size={20} />}
                classNames={{
                  input: 'bg-slate-700/40 text-white border-sf-primary/40 focus:border-sf-primary placeholder:text-gray-400',
                }}
              />
              <Button
                size="lg"
                onClick={handleSearch}
                loading={loading}
                className="bg-gradient-to-r from-sf-primary to-sf-secondary hover:from-sf-primary/90 hover:to-sf-secondary/90 transition-all shadow-lg hover:shadow-xl"
                fullWidth
              >
                Search Decks
              </Button>
            </Stack>
          </Paper>

          {loading && (
            <div className="flex justify-center py-8">
              <Loader size="lg" color="blue" />
            </div>
          )}

          {!loading && !isTyping && (decks.length > 0 || fusedDecks.length > 0) && (
            <DeckList decks={decks} fusedDecks={fusedDecks} />
          )}
          
          {!loading && !isTyping && decks.length === 0 && fusedDecks.length === 0 && hasSearched && (
            <Paper
              p="xl"
              className="w-full max-w-2xl backdrop-blur-md border border-sf-primary/30 rounded-xl"
              style={{ backgroundColor: 'rgba(30, 41, 59, 0.6)' }}
            >
              <div className="text-center text-gray-400">
                <p className="text-lg mb-2">No decks found</p>
                <p className="text-sm">Please check the player nickname: <span className="text-white font-semibold">{playerName}</span></p>
              </div>
            </Paper>
          )}
        </Stack>
      </Container>
    </main>
  )
}
