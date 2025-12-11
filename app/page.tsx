'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Badge, Button, Checkbox, Container, Group, Loader, Paper, Progress, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconAlertTriangle, IconCheck, IconClockHour3, IconSearch } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useDeckStore } from '@/store/deckStore'
import { DeckList } from '@/components/DeckList'
import { Header } from '@/components/Header'
import { BackgroundElements } from '@/components/BackgroundElements'

export default function Home() {
  const [playerName, setPlayerName] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [forceRefresh, setForceRefresh] = useState(false)
  const searchedNameRef = useRef<string>('')
  const { decks, fusedDecks, loading, fetchDecks, progress, tagIndex, cardNameIndex, deckNameIndex, forgebornNameIndex, deckTags } = useDeckStore()
  const lastSearchRef = useRef<string>('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [progressVisible, setProgressVisible] = useState(false)
  const [lastNonTagMessage, setLastNonTagMessage] = useState('')

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    if (progress.status === 'running' && progress.startedAt) {
      const tick = () => {
        setElapsedMs(Date.now() - (progress.startedAt || Date.now()))
      }
      tick()
      timer = setInterval(tick, 400)
    } else if (progress.startedAt && progress.finishedAt) {
      setTimeout(() => setElapsedMs(progress.finishedAt! - progress.startedAt!), 0)
    } else {
      setTimeout(() => setElapsedMs(0), 0)
    }

    return () => {
      if (timer) {
        clearInterval(timer)
      }
    }
  }, [progress.finishedAt, progress.startedAt, progress.status])

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null

    if (progress.status === 'running' || progress.status === 'error') {
      showTimer = setTimeout(() => setProgressVisible(true), 0)
    } else if (progress.status === 'done' || progress.status === 'cached') {
      showTimer = setTimeout(() => setProgressVisible(true), 0)
      hideTimer = setTimeout(() => setProgressVisible(false), 2000)
    } else if (progress.status === 'idle') {
      hideTimer = setTimeout(() => setProgressVisible(false), 0)
    }

    return () => {
      if (showTimer) clearTimeout(showTimer)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [progress.status])

  const formatDuration = useCallback((ms: number) => {
    const totalSeconds = Math.max(0, Math.round(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes > 0) {
      return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
    }
    return `${seconds}s`
  }, [])

  const stackGap = progressVisible ? 'lg' : 'xl'

  const totalSteps = progress.totalSteps || progress.steps.length || 1
  const completedSteps = progress.steps.filter((step) => step.status === 'done').length
  const hasActiveStep = progress.steps.some((step) => step.status === 'active')
  const errorStepIndex = progress.steps.findIndex((step) => step.status === 'error')
  const activeIndex = errorStepIndex >= 0
    ? errorStepIndex
    : progress.currentStepIndex >= 0
      ? progress.currentStepIndex
      : Math.min(totalSteps - 1, completedSteps)
  const progressPercent = Math.min(
    100,
    Math.round(((completedSteps + (progress.status === 'running' && hasActiveStep ? 0.35 : 0)) / totalSteps) * 100)
  )
  const finalizeDone = progress.steps.some((step) => step.key === 'finalize' && step.status === 'done')
  const canShowDecks =
    !loading &&
    !isTyping &&
    (decks.length > 0 || fusedDecks.length > 0) &&
    (progress.status === 'done' || progress.status === 'cached' || finalizeDone)

  const etaMs =
    progress.status === 'running' && (completedSteps > 0 || hasActiveStep)
      ? Math.max(
          0,
          Math.round(
            (elapsedMs / Math.max(1, completedSteps + (hasActiveStep ? 1 : 0))) *
              Math.max(0, totalSteps - completedSteps - (hasActiveStep ? 1 : 0))
          )
        )
      : 0
  const statusLabels: Record<'pending' | 'active' | 'done' | 'error', string> = {
    pending: 'Waiting',
    active: 'In progress',
    done: 'Done',
    error: 'Failed',
  }
  const statusColors: Record<'pending' | 'active' | 'done' | 'error', string> = {
    pending: 'gray',
    active: 'blue',
    done: 'teal',
    error: 'red',
  }
  const counters = progress.counters || {}
  const showProgress = progressVisible
  const [lastSearchedName, setLastSearchedName] = useState('')
  const activeStepForMessage =
    progress.steps.find((step) => step.status !== 'done') ||
    progress.steps.find((step) => step.status === 'pending')

  useEffect(() => {
    const msg = progress.message?.trim()
    if (msg && !msg.toLowerCase().includes('tag')) {
      setTimeout(() => setLastNonTagMessage(msg), 0)
    }
  }, [progress.message])

  const primaryMessage = (() => {
    const msg = progress.message?.trim()
    const isTagMsg = !!msg && msg.toLowerCase().includes('tag')
    const deckStageFallback =
      lastNonTagMessage ||
      progress.steps.find((s) => s.key === 'fetchFused' && s.status === 'active')?.label ||
      progress.steps.find((s) => s.key === 'fetchRegular' && s.status === 'active')?.label ||
      progress.steps.find((s) => s.key === 'fetchFused')?.label ||
      progress.steps.find((s) => s.key === 'fetchRegular')?.label ||
      'Requesting decks'

    if (activeStepForMessage && ['fetchRegular', 'fetchFused'].includes(activeStepForMessage.key)) {
      if (msg && !isTagMsg) {
        return msg
      }
      return deckStageFallback || activeStepForMessage.label || 'Requesting decks'
    }

    if (activeStepForMessage?.key === 'tags') {
      // В фазе тегов показываем текущее сообщение по тегам или метку шага,
      // не подменяя его прошлым статусом загрузки колод.
      if (msg) return msg
      return activeStepForMessage.label || 'Collecting tags'
    }

    if (msg && !isTagMsg) return msg
    if (activeStepForMessage?.label) return activeStepForMessage.label
    return progress.status === 'error' ? 'Something went wrong' : 'Working on it...'
  })()

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
    setLastSearchedName(playerName.trim())

    try {
      await fetchDecks(playerName.trim(), { force: forceRefresh })
      const { decks: loadedDecks, fusedDecks: loadedFusedDecks } = useDeckStore.getState()
      const latestProgress = useDeckStore.getState().progress
      const totalMs =
        latestProgress?.finishedAt && latestProgress?.startedAt
          ? latestProgress.finishedAt - latestProgress.startedAt
          : null
      const timeLabel = totalMs !== null ? formatDuration(totalMs) : null

      if (loadedDecks.length > 0 || loadedFusedDecks.length > 0) {
        const totalDecks = loadedDecks.length + loadedFusedDecks.length
        notifications.show({
          title: 'Success',
          message: `Found ${totalDecks} deck${totalDecks !== 1 ? 's' : ''}${timeLabel ? ` in ${timeLabel}` : ''}`,
          color: 'green',
        })
      } else {
        notifications.show({
          title: 'Information',
          message: `No decks found. Please check the player nickname.${timeLabel ? ` Search time: ${timeLabel}.` : ''}`,
          color: 'blue',
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Page] Error loading decks:', error)
      
      let userMessage = 'Failed to load decks. Please check your internet connection and try again.'
      
      if (errorMessage.includes('cannot be empty')) {
        userMessage = 'Please enter a player nickname'
      } else if (errorMessage.includes('timeout')) {
        userMessage = 'Request timeout. Please try again.'
      } else if (errorMessage.includes('network')) {
        userMessage = 'Network error. Please check your internet connection.'
      } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        userMessage = 'Player not found. Please check the nickname.'
      }
      
      notifications.show({
        title: 'Error',
        message: userMessage,
        color: 'red',
      })
    }
  }

  return (
    <main className="min-h-screen relative overflow-hidden">
      <BackgroundElements />
      <Header />
      <Container size="xl" className="relative z-10 py-6">
        <Stack gap={stackGap} align="center">
          <div className="text-center space-y-4">
            <Title
              order={1}
              className="text-5xl md:text-6xl font-bold text-white mb-2"
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
          p="lg"
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
              <Group justify="space-between" align="center" wrap="nowrap" className="w-full">
                <div className="flex-1" />
                <Button
                  size="xl"
                  onClick={handleSearch}
                  loading={loading}
                  className="bg-gradient-to-r from-sf-primary to-sf-secondary hover:from-sf-primary/90 hover:to-sf-secondary/90 transition-all shadow-lg hover:shadow-xl"
                  style={{ minWidth: 270, height: 60 }}
                >
                  Search Decks
                </Button>
                <div className="flex-1 flex justify-end">
                  <Checkbox
                    label={
                      <div className="leading-tight text-white text-center">
                        <div>Force refresh  </div>
                        <div className="text-xs text-gray-300">(ignore 24h cache)</div>
                      </div>
                    }
                    checked={forceRefresh}
                    onChange={(e) => setForceRefresh(e.currentTarget.checked)}
                    color="blue"
                  />
                </div>
              </Group>
            </Stack>
          </Paper>

          {showProgress && (
            <Paper
              p="lg"
              className="w-full max-w-2xl bg-slate-800/60 backdrop-blur-md border border-sf-primary/30 rounded-xl"
              style={{ backgroundColor: 'rgba(30, 41, 59, 0.6)' }}
            >
              <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text fw={600} className="text-white">
                      {progress.status === 'error'
                        ? 'Search failed'
                        : `Searching decks${lastSearchedName ? ` for ${lastSearchedName}` : ''}`}
                    </Text>
                    <Text size="sm" className="text-gray-300">
                      {primaryMessage}
                    </Text>
                  </div>
                  <Badge color="blue" variant="light">
                    Step {Math.max(1, activeIndex + 1)} / {totalSteps}
                  </Badge>
                </Group>

                <Progress
                  value={progressPercent}
                  color={progress.status === 'running' ? 'blue' : progress.status === 'error' ? 'red' : 'teal'}
                  size="lg"
                  striped
                  animated
                />

                <Group gap="xl">
                  <div>
                    <Text size="xs" className="text-gray-400 uppercase tracking-wide">
                      Elapsed
                    </Text>
                    <Text fw={600} className="text-white">
                      {formatDuration(elapsedMs)}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" className="text-gray-400 uppercase tracking-wide">
                      ETA
                    </Text>
                    <Text fw={600} className="text-white">
                      {progress.status === 'error'
                        ? '—'
                        : etaMs > 0
                          ? `~${formatDuration(etaMs)}`
                          : 'Estimating...'}
                    </Text>
                  </div>
                </Group>

                <Stack gap={6}>
                  {progress.steps.map((step) => {
                    const durationLabel = (() => {
                      if (step.finishedAt && step.startedAt) {
                        const ms = step.finishedAt - step.startedAt
                        const secs = Math.max(0, Math.round(ms / 1000))
                        if (secs >= 60) {
                          const mins = Math.floor(secs / 60)
                          const rem = secs % 60
                          return `${mins}m ${rem}s`
                        }
                        return `${secs}s`
                      }
                      return null
                    })()
                    return (
                      <Group
                        key={step.key}
                        justify="space-between"
                        className="bg-slate-700/30 rounded-md px-3 py-2"
                      >
                        <Group gap={8}>
                          {step.status === 'done' ? (
                            <IconCheck size={16} className="text-teal-400" />
                          ) : step.status === 'error' ? (
                            <IconAlertTriangle size={16} className="text-red-400" />
                          ) : step.status === 'active' ? (
                            <Loader size="xs" color="blue" />
                          ) : (
                            <IconClockHour3 size={16} className="text-gray-400" />
                          )}
                          <Text className="text-white" size="sm">
                            {step.label}
                          </Text>
                        </Group>
                        <Group gap={6} align="center">
                          {durationLabel && (
                            <Text size="xs" className="text-gray-300 whitespace-nowrap">
                              {durationLabel}
                            </Text>
                          )}
                          <Badge color={statusColors[step.status]} variant="light" size="sm">
                          {statusLabels[step.status]}
                          </Badge>
                        </Group>
                      </Group>
                    )
                  })}
                </Stack>

                <Stack gap={6}>
                  <Text size="xs" className="text-gray-400 uppercase tracking-wide">
                    Deck progress
                  </Text>
                  <Group gap={6} wrap="wrap">
                    <Badge color="teal" variant="light">
                      Total decks: {counters.totalCount ?? '—'}
                    </Badge>
                    <Badge color="blue" variant="light">
                      Regular: {counters.regularCount ?? '—'}
                    </Badge>
                    <Badge color="violet" variant="light">
                      Fused: {counters.fusedCount ?? '—'}
                    </Badge>
                    <Badge color="cyan" variant="light">
                      Regular pages: {counters.regularPages ?? '—'}
                    </Badge>
                    <Badge color="grape" variant="light">
                      Fused pages: {counters.fusedPages ?? '—'}
                    </Badge>
                  </Group>
                </Stack>
              </Stack>
            </Paper>
          )}

          {canShowDecks && (
            <DeckList
              decks={decks}
              fusedDecks={fusedDecks}
              precomputedTags={tagIndex}
              precomputedCardNames={cardNameIndex}
              precomputedDeckNames={deckNameIndex}
              precomputedForgebornNames={forgebornNameIndex}
              deckTagsMap={deckTags}
            />
          )}
          
          {!loading && !isTyping && (progress.status === 'done' || progress.status === 'cached' || finalizeDone) && decks.length === 0 && fusedDecks.length === 0 && hasSearched && (
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
