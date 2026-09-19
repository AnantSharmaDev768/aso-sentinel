// Type declarations for shared/historical.mjs.
export interface Incident {
  id: string
  name: string
  protocol: string
  date: string
  pattern: string
  facts: string[]
  sources: { label: string; url: string }[]
  mapping: string
  reproduced: string[]
  notModeled: string
}
export declare const HISTORICAL: Incident[]
