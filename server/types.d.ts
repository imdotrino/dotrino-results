// Formas de datos del relay de resultados. Solo tipos: no hay código que importar.

/** Estado de un partido, igual para todos los proveedores y para el override manual. */
export type MatchStatus = 'scheduled' | 'in' | 'final'

/** Partido normalizado (el shape app-agnóstico que sirve el feed). */
export interface Match {
  /** código FIFA del local */
  home: string
  /** código FIFA del visitante */
  away: string
  /** inicio en ISO (UTC), o null si el proveedor no lo da */
  kickoff: string | null
  stage: string | null
  status: MatchStatus
  started: boolean
  finished: boolean
  homeGoals: number | null
  awayGoals: number | null
  homePens: number | null
  awayPens: number | null
  /** código FIFA del ganador, o null (sin decidir o empate) */
  winner: string | null
  source: 'espn' | 'fifa' | 'manual'
}

/** Override manual del admin: un Match con quién y cuándo lo cargó. */
export interface Override extends Match {
  source: 'manual'
  /** pubkeyId del admin que lo firmó */
  by: string
  /** ms epoch */
  at: number
}

/** Lo que manda el admin por cada partido en POST /admin/result (sin validar). */
export interface OverrideInput {
  home: string
  away: string
  kickoff?: string | null
  homeGoals?: unknown
  awayGoals?: unknown
  homePens?: unknown
  awayPens?: unknown
  winner?: unknown
  stage?: string | null
  clear?: boolean
}

/** Rango de fechas (YYYYMMDD) y tope de espera para pedir a un proveedor. */
export interface FetchOpts {
  fromYmd: string
  toYmd: string
  timeoutMs?: number
}

export interface Provider {
  id: string
  label: string
  fetchMatches (opts: FetchOpts): Promise<Match[]>
}

/** Resultado de una pasada por un proveedor. */
export type ProviderResult =
  | { ok: true, count: number, matches: Match[], fetchedAt: number, error?: undefined }
  | { ok: false, error: string, matches: Match[], fetchedAt: number, count?: undefined }

export type ProviderResults = Record<string, ProviderResult>

// --- Lo que contestan los proveedores (solo los campos que se leen; todo opcional:
// es JSON de un tercero y se valida al normalizar). ---

export interface EspnCompetitor {
  homeAway?: 'home' | 'away'
  team?: { abbreviation?: string }
  score?: string | number
  shootoutScore?: string | number
  winner?: boolean
}

export interface EspnStatusType {
  state?: 'pre' | 'in' | 'post'
  completed?: boolean
}

export interface EspnEvent {
  date?: string
  season?: { slug?: string }
  status?: { type?: EspnStatusType }
  competitions?: Array<{
    competitors?: EspnCompetitor[]
    status?: { type?: EspnStatusType }
  }>
}

export interface EspnScoreboard {
  events?: EspnEvent[]
}

export interface FifaTeam {
  Abbreviation?: string
  IdCountry?: string
  IdTeam?: string
}

export interface FifaMatch {
  Home?: FifaTeam | null
  Away?: FifaTeam | null
  /** 1 = programado, 0 = terminado, otro = en juego */
  MatchStatus?: number
  HomeTeamScore?: number | null
  AwayTeamScore?: number | null
  /** 2 = penales */
  ResultType?: number
  HomeTeamPenaltyScore?: number | null
  AwayTeamPenaltyScore?: number | null
  /** IdTeam del ganador */
  Winner?: string | null
  Date?: string
}

export interface FifaCalendar {
  Results?: FifaMatch[]
  results?: FifaMatch[]
}
