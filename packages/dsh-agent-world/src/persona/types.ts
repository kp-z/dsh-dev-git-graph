/** R351：一个 subagent 在游戏里的长期档案。 */
export interface Persona {
  id: string
  name: string
  role: string
  level: number
  xp: number
  skills: string[]
  taskIds: string[]
  /** 已经结算过 XP 的任务，防止重复加经验。 */
  awardedTaskIds: string[]
  prompt: string
  updatedAt: number
}

export interface PersonaFile { personas: Record<string, Persona> }
