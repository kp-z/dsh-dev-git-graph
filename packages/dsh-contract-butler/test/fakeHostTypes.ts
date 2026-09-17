/** 假宿主的类型，单独放一个文件是为了让脚本和测试都能引用而不必跑一遍实现。 */

export interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: unknown, res: unknown) => void
}

export interface FakeCtx {
  ctx: unknown
  routes: RouteSpec[]
  logs: string[]
  match(url: string): RouteSpec | undefined
  mount(name: string, value: unknown): void
  emit(name: string, ...args: unknown[]): void
  call(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }>
}
