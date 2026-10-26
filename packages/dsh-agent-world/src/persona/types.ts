/** R351：一个 subagent 在游戏里的长期档案。 */
export interface Persona {
  id: string
  name: string
  role: string
  level: number
  xp: number
  skills: string[]
  taskIds: string[]
  prompt: string
  updatedAt: number
}

export interface PersonaFile { personas: Record<string, Persona> }
