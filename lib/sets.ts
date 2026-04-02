type KnownLegacySetCode = 'S99' | 'S1' | 'S2' | 'S3' | 'S4' | 'B1' | 'B2' | 'B3' | 'B4'

type SetDefinition = {
  shortCode: string
  fullName: string
  aliases: string[]
}

const SET_DEFINITIONS: Record<KnownLegacySetCode, SetDefinition> = {
  S99: {
    shortCode: 'S0',
    fullName: 'Starter',
    aliases: ['S99', 'S0', 'D0', '99', 'STARTER'],
  },
  S1: {
    shortCode: 'A',
    fullName: 'Set 1 - Alpha',
    aliases: ['S1', '1', 'A', 'ALPHA', 'SET 1 - ALPHA'],
  },
  S2: {
    shortCode: 'BfWP',
    fullName: 'Set 2 - Battle for Whitefang Pass',
    aliases: ['S2', '2', 'BFWP', 'SET 2 - BATTLE FOR WHITEFANG PASS'],
  },
  S3: {
    shortCode: 'TLW',
    fullName: 'Set 3 - The Last Winter',
    aliases: ['S3', '3', 'TLW', 'SET 3 - THE LAST WINTER'],
  },
  S4: {
    shortCode: 'SoS',
    fullName: 'Set 4 - Shadows over Solis',
    aliases: ['S4', '4', 'SOS', 'SET 4 - SHADOWS OVER SOLIS'],
  },
  B1: {
    shortCode: 'TnC',
    fullName: 'LD - Tooth and Claws',
    aliases: ['B1', 'TNC', 'LD - TOOTH AND CLAWS', 'TOOTH AND CLAWS'],
  },
  B2: {
    shortCode: 'BnB',
    fullName: 'LD - Beakers & Bones',
    aliases: ['B2', 'BNB', 'LD - BEAKERS & BONES', 'BEAKERS & BONES'],
  },
  B3: {
    shortCode: 'AnA',
    fullName: 'LD - Axes and Allies',
    aliases: ['B3', 'ANA', 'LD - AXES AND ALLIES', 'AXES AND ALLIES'],
  },
  B4: {
    shortCode: 'WnW',
    fullName: 'LD - Wizards & Warlocks',
    aliases: ['B4', 'WNW', 'LD - WIZARDS AND WARLOCKS', 'WIZARDS AND WARLOCKS'],
  },
}

const normalizeAliasKey = (value: string) => value.trim().toUpperCase().replace(/[\s_-]+/g, '')

const ALIAS_TO_LEGACY = new Map<string, KnownLegacySetCode>()

;(Object.keys(SET_DEFINITIONS) as KnownLegacySetCode[]).forEach((legacyCode) => {
  const { aliases, shortCode } = SET_DEFINITIONS[legacyCode]
  ALIAS_TO_LEGACY.set(normalizeAliasKey(legacyCode), legacyCode)
  ALIAS_TO_LEGACY.set(normalizeAliasKey(shortCode), legacyCode)
  aliases.forEach((alias) => ALIAS_TO_LEGACY.set(normalizeAliasKey(alias), legacyCode))
})

const isKnownLegacySetCode = (value: string): value is KnownLegacySetCode =>
  Object.prototype.hasOwnProperty.call(SET_DEFINITIONS, value)

export const normalizeSetCode = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  const raw = String(value).trim()
  if (!raw) return null

  const mapped = ALIAS_TO_LEGACY.get(normalizeAliasKey(raw))
  if (mapped) return mapped

  const upper = raw.toUpperCase()

  if (/^\d+$/.test(upper)) {
    const numeric = Number(upper)
    if (numeric === 99 || numeric === 0) return 'S99'
    return `S${numeric}`
  }

  const sMatch = upper.match(/^S(\d+)$/)
  if (sMatch?.[1]) {
    const numeric = Number(sMatch[1])
    if (numeric === 99 || numeric === 0) return 'S99'
    return `S${numeric}`
  }

  const bMatch = upper.match(/^B(\d+)$/)
  if (bMatch?.[1]) {
    return `B${Number(bMatch[1])}`
  }

  return raw
}

export const getSetShortLabel = (value: unknown): string | null => {
  const normalized = normalizeSetCode(value)
  if (!normalized) return null
  if (isKnownLegacySetCode(normalized)) return SET_DEFINITIONS[normalized].shortCode
  return normalized
}

export const getSetFullLabel = (value: unknown): string | null => {
  const normalized = normalizeSetCode(value)
  if (!normalized) return null
  if (isKnownLegacySetCode(normalized)) return SET_DEFINITIONS[normalized].fullName
  return getSetShortLabel(normalized)
}
