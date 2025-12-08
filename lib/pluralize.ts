export const pluralize = (count: number, one: string, many?: string) =>
  `${count} ${count === 1 ? one : many || `${one}s`}`
