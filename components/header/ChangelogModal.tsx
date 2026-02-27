import { Divider, Group, Modal, ScrollArea, Text } from '@mantine/core'
import { CHANGELOG_HISTORY, CHANGELOG_SUMMARY, formatChangelogDate } from '@/lib/changelog'

type ChangelogModalProps = {
  opened: boolean
  onClose: () => void
}

export function ChangelogModal({ opened, onClose }: ChangelogModalProps) {
  const releaseDate = formatChangelogDate(CHANGELOG_SUMMARY.date)

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Changelog"
      size="lg"
      centered
    >
      <Text size="xs" c="dimmed" mb="sm">
        Latest release: v{CHANGELOG_SUMMARY.version} ({releaseDate})
      </Text>
      <ScrollArea h={420} offsetScrollbars>
        <div className="space-y-5">
          {CHANGELOG_HISTORY.map((entry, index) => (
            <div key={`changelog-${entry.version}-${entry.date}`} className="space-y-4">
              <Group justify="space-between" align="center">
                <Text size="sm" fw={700} c="gray.0">
                  Version {entry.version}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatChangelogDate(entry.date)}
                </Text>
              </Group>

              {entry.added.length > 0 && (
                <div>
                  <Text size="xs" fw={700} c="teal.3" tt="uppercase">
                    Added
                  </Text>
                  <div className="mt-2 space-y-1">
                    {entry.added.map((item) => (
                      <Text key={`added-${entry.version}-${item}`} size="xs" c="gray.1">
                        • {item}
                      </Text>
                    ))}
                  </div>
                </div>
              )}

              {entry.changed.length > 0 && (
                <div>
                  <Text size="xs" fw={700} c="yellow.3" tt="uppercase">
                    Changed
                  </Text>
                  <div className="mt-2 space-y-1">
                    {entry.changed.map((item) => (
                      <Text key={`changed-${entry.version}-${item}`} size="xs" c="gray.1">
                        • {item}
                      </Text>
                    ))}
                  </div>
                </div>
              )}

              {entry.fixed.length > 0 && (
                <div>
                  <Text size="xs" fw={700} c="blue.3" tt="uppercase">
                    Fixed
                  </Text>
                  <div className="mt-2 space-y-1">
                    {entry.fixed.map((item) => (
                      <Text key={`fixed-${entry.version}-${item}`} size="xs" c="gray.1">
                        • {item}
                      </Text>
                    ))}
                  </div>
                </div>
              )}

              {index < CHANGELOG_HISTORY.length - 1 && <Divider />}
            </div>
          ))}
        </div>
      </ScrollArea>
    </Modal>
  )
}
