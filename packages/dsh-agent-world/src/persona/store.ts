import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Persona, PersonaFile } from './types.js'
import { levelForXp, normalizeXp } from './level.js'

export interface PersonaInput {
  id: string
  name?: string
  role?: string
  xp?: number
  skills?: string[]
  taskIds?: string[]
  prompt?: string
}

export interface PersonaStore {
  list(): Persona[]
  get(id: string): Persona | null
  upsert(input: PersonaInput): Persona
  addXp(id: string, amount: number): Persona | null
  linkTask(id: string, taskId: string): Persona | null
  save(): void
}

function make(input: PersonaInput, previous: Persona | undefined): Persona {
  const xp = normalizeXp(input.xp ?? previous?.xp ?? 0)
  return {
    id: input.id,
    name: input.name ?? previous?.name ?? input.id,
    role: input.role ?? previous?.role ?? 'engineer',
    level: levelForXp(xp),
    xp,
    skills: Array.isArray(input.skills) ? [...new Set(input.skills.filter((s) => typeof s === 'string' && s.trim() !== ''))] : (previous?.skills ?? []),
    taskIds: Array.isArray(input.taskIds) ? [...new Set(input.taskIds.filter((s) => typeof s === 'string' && s !== ''))] : (previous?.taskIds ?? []),
    prompt: input.prompt ?? previous?.prompt ?? '',
    updatedAt: Date.now(),
  }
}

export function createPersonaStore(path: string): PersonaStore {
  const read = (): PersonaFile => {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as PersonaFile
      return raw && typeof raw.personas === 'object' && raw.personas !== null ? raw : { personas: {} }
    } catch {
      return { personas: {} }
    }
  }
  const file = read()
  const save = (): void => {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2))
    renameSync(tmp, path)
  }
  const store: PersonaStore = {
    list: () => Object.values(file.personas),
    get: (id) => file.personas[id] ?? null,
    upsert(input) {
      const next = make(input, file.personas[input.id])
      file.personas[input.id] = next
      save()
      return next
    },
    addXp(id, amount) {
      const current = file.personas[id]
      if (current === undefined) return null
      const next = make({ id, xp: current.xp + (Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0) }, current)
      file.personas[id] = next
      save()
      return next
    },
    linkTask(id, taskId) {
      const current = file.personas[id]
      if (current === undefined || typeof taskId !== 'string' || taskId === '') return null
      const next = make({ id, taskIds: [...current.taskIds, taskId] }, current)
      file.personas[id] = next
      save()
      return next
    },
    save,
  }
  return store
}

export { existsSync }
