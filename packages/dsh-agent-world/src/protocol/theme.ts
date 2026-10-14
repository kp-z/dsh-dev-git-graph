/**
 * 主题的**渲染就绪**形状（BACKLOG M4-0）。
 *
 * ## 为什么它住在协议层
 *
 * 主题是内容（`themes` 库），内容是自由形状的 JSON；而浏览器要拿它去配相机、光照、雾。
 * 浏览器只许 import 协议层（决策 D16/D19），所以"渲染器要读的那几个字段"必须是一条
 * **明确的、跨进程的契约**——不能让面板对着自由 JSON 猜字段名。
 *
 * 于是分工是：
 * - **内容层**（`content/port.ts`）知道主题条目的原始形状，负责把 token 解析成色值、
 *   把缺省补齐，映射成这里的 `ThemePlan`；
 * - **协议层**（本文件）只声明形状；
 * - **渲染层**拿到的是可直接用的值，不认识任何 token。
 *
 * ## 加了新主题字段怎么办
 *
 * 在内容层的映射里填上、在这里加字段。**这是有意的摩擦**：加一个渲染器要读的字段，
 * 就该同时改这三处（内容形状、协议形状、渲染器），否则漏掉哪一处都会变成
 * "配了但没生效"这种最难查的问题。
 */

/** 相机。等距沙盘用 `orthographic`；`perspective` 用于近景或影院感视角。 */
export interface ThemeCamera {
  projection: 'orthographic' | 'perspective'
  /** 绕 Y 轴旋转角度（度）。 */
  yawDeg: number
  /** 俯角（度）。等距沙盘常用 35.264（= atan(1/√2)）。 */
  pitchDeg: number
  /** 透视相机的竖直视角；正交相机为 null。 */
  fov: number | null
  /** 正交相机的缩放系数。 */
  zoom: number
}

/** 雾。颜色**已解析成色值**。 */
export interface ThemeFog {
  color: string
  density: number
}

/** 光照。三个光源都可缺省——缺省就说明这套主题不用它。 */
export interface ThemeLighting {
  hemisphere: { sky: string; ground: string; intensity: number } | null
  directional: {
    color: string
    intensity: number
    position: { x: number; y: number; z: number }
    castShadow: boolean
    shadowMapSize: number
  } | null
  ambient: { color: string; intensity: number } | null
}

/** 后期。`bloom.enabled` 为假时渲染器不该建那条 pass（省一次全屏采样）。 */
export interface ThemePost {
  toneMapping: string
  exposure: number
  bloom: { enabled: boolean; threshold: number; strength: number }
}

/** 一套渲染就绪的主题。 */
export interface ThemePlan {
  id: string
  name: string
  camera: ThemeCamera
  fog: ThemeFog | null
  lighting: ThemeLighting
  post: ThemePost
}
