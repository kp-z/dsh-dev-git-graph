/**
 * **本文件由脚本生成，不要手改**：`scripts/gen-office-scene.mjs`。
 *
 * 内容来源：Microverse 原版场景解出来的 `office-map.ts`。
 * **房间名与描述是原版写好的中文**。
 *
 * - 9 个房间 = 分区（`desc` 是原版给的房间描述）
 * - 24 把椅子 = 站点（**不需要 props**：地图已经把家具画好了）
 * - 椅子数与原版描述逐房间吻合（办公室 14 = 财务 6 + 工程 8、会议室 4、HR 3、老板 2、接待 1）
 *
 * 重新生成：`node scripts/gen-office-scene.mjs`
 */

export interface OfficeSceneDistrict {
  readonly id: string
  readonly name: string
  readonly desc: string
  readonly kind: string
  readonly bounds: { readonly min: { readonly x: number; readonly z: number }; readonly max: { readonly x: number; readonly z: number } }
}

export interface OfficeSceneStation {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly district: string
  readonly anchor: { readonly x: number; readonly z: number }
  readonly capacity: number
  readonly capabilities: readonly string[]
  readonly slots: ReadonlyArray<{ readonly x: number; readonly z: number }>
}

/** 世界尺寸（世界单位）——由地图格数 × 2 得来。 */
export const OFFICE_WORLD = { halfW: 37, halfH: 21 } as const

/** 底图（已烘好的整张办公室）。 */
export const OFFICE_BACKGROUND = {
  url: 'microverse/scene/office.png',
  width: 37,
  height: 21,
  cellPx: 32,
  /** 一格 = 多少世界单位。 */
  unitsPerCell: 2,
} as const

export const OFFICE_DISTRICTS: readonly OfficeSceneDistrict[] = [
  {
    "id": "district.0",
    "name": "会议室",
    "desc": "会议室里面有一个大显示屏、两个写字板、一个大会议桌以及四个座位",
    "kind": "meeting",
    "bounds": {
      "min": {
        "x": -17,
        "z": 5
      },
      "max": {
        "x": 9,
        "z": 17
      }
    }
  },
  {
    "id": "district.1",
    "name": "HR办公室",
    "desc": "HR办公室有两个HR的座位，一个面试者座位，HR办公桌前面是一大堆的面试者简历",
    "kind": "engineering",
    "bounds": {
      "min": {
        "x": -35,
        "z": -21
      },
      "max": {
        "x": -17,
        "z": -5
      }
    }
  },
  {
    "id": "district.2",
    "name": "卫生间",
    "desc": "卫生间门口有一个洗漱台、里面有三个带马桶的隔间",
    "kind": "infra",
    "bounds": {
      "min": {
        "x": -17,
        "z": -21
      },
      "max": {
        "x": 3,
        "z": -15
      }
    }
  },
  {
    "id": "district.3",
    "name": "老板办公室",
    "desc": "老板办公室里面有老板的办公桌、老板的办公桌对面是老板秘书的办公桌",
    "kind": "engineering",
    "bounds": {
      "min": {
        "x": 9,
        "z": 5
      },
      "max": {
        "x": 35,
        "z": 17
      }
    }
  },
  {
    "id": "district.4",
    "name": "办公室",
    "desc": "办公室的北半部分是财务团队办公区一共六个工位，南边是软件工程师办公区共八个工位",
    "kind": "engineering",
    "bounds": {
      "min": {
        "x": 3,
        "z": -21
      },
      "max": {
        "x": 35,
        "z": 5
      }
    }
  },
  {
    "id": "district.5",
    "name": "健身房",
    "desc": "健身房里面有瑜伽垫、瑜伽球、拳击桩、力量训练的哑铃、动感单车",
    "kind": "commons",
    "bounds": {
      "min": {
        "x": -17,
        "z": -7
      },
      "max": {
        "x": 3,
        "z": 5
      }
    }
  },
  {
    "id": "district.6",
    "name": "茶水间",
    "desc": "茶水间是一个长廊，西边连通HR办公室、东边连通员工办公室、正中间有一个饮料自动贩卖机、贩卖机西边有一个饮水机、东边有一个咖啡机",
    "kind": "commons",
    "bounds": {
      "min": {
        "x": -17,
        "z": -15
      },
      "max": {
        "x": 3,
        "z": -7
      }
    }
  },
  {
    "id": "district.7",
    "name": "接待处",
    "desc": "接待处有一个前台",
    "kind": "commons",
    "bounds": {
      "min": {
        "x": -35,
        "z": 5
      },
      "max": {
        "x": -17,
        "z": 17
      }
    }
  },
  {
    "id": "district.8",
    "name": "等候大厅",
    "desc": "等候大厅有三个座位和一个自动贩卖机",
    "kind": "commons",
    "bounds": {
      "min": {
        "x": -35,
        "z": -5
      },
      "max": {
        "x": -17,
        "z": 5
      }
    }
  }
]

export const OFFICE_STATIONS: readonly OfficeSceneStation[] = [
  {
    "id": "station.seat-01",
    "name": "接待处座位 1",
    "kind": "mailroom",
    "district": "district.7",
    "anchor": {
      "x": -19.5,
      "z": 10
    },
    "capacity": 1,
    "capabilities": [
      "deliver",
      "converse"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-02",
    "name": "HR办公室座位 2",
    "kind": "desk",
    "district": "district.1",
    "anchor": {
      "x": -30,
      "z": -18
    },
    "capacity": 1,
    "capabilities": [
      "review",
      "converse",
      "research"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-03",
    "name": "HR办公室座位 3",
    "kind": "desk",
    "district": "district.1",
    "anchor": {
      "x": -34,
      "z": -18
    },
    "capacity": 1,
    "capabilities": [
      "review",
      "converse",
      "research"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-04",
    "name": "办公室座位 4",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 24,
      "z": -6
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-05",
    "name": "办公室座位 5",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 18,
      "z": -6
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-06",
    "name": "办公室座位 6",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 12,
      "z": -6
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-07",
    "name": "办公室座位 7",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 6,
      "z": -6
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-08",
    "name": "办公室座位 8",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 8,
      "z": -16
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-09",
    "name": "办公室座位 9",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 14,
      "z": -16
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-10",
    "name": "办公室座位 10",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 20,
      "z": -16
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-11",
    "name": "会议室座位 11",
    "kind": "meeting",
    "district": "district.0",
    "anchor": {
      "x": -13,
      "z": 11
    },
    "capacity": 1,
    "capabilities": [
      "converse"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-12",
    "name": "会议室座位 12",
    "kind": "meeting",
    "district": "district.0",
    "anchor": {
      "x": -13,
      "z": 14.5
    },
    "capacity": 1,
    "capabilities": [
      "converse"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-13",
    "name": "会议室座位 13",
    "kind": "meeting",
    "district": "district.0",
    "anchor": {
      "x": -3,
      "z": 11
    },
    "capacity": 1,
    "capabilities": [
      "converse"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-14",
    "name": "会议室座位 14",
    "kind": "meeting",
    "district": "district.0",
    "anchor": {
      "x": -3,
      "z": 14.5
    },
    "capacity": 1,
    "capabilities": [
      "converse"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-15",
    "name": "办公室座位 15",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 26,
      "z": 1
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-16",
    "name": "办公室座位 16",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 20,
      "z": 1
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-17",
    "name": "办公室座位 17",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 14,
      "z": 1
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-18",
    "name": "办公室座位 18",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 8,
      "z": 1
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-19",
    "name": "办公室座位 19",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 10,
      "z": -9
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-20",
    "name": "办公室座位 20",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 16,
      "z": -9
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-21",
    "name": "办公室座位 21",
    "kind": "desk",
    "district": "district.4",
    "anchor": {
      "x": 22,
      "z": -9
    },
    "capacity": 1,
    "capabilities": [
      "code",
      "review",
      "compute"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-22",
    "name": "HR办公室座位 22",
    "kind": "desk",
    "district": "district.1",
    "anchor": {
      "x": -28,
      "z": -12.5
    },
    "capacity": 1,
    "capabilities": [
      "review",
      "converse",
      "research"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-23",
    "name": "老板办公室座位 23",
    "kind": "desk",
    "district": "district.3",
    "anchor": {
      "x": 30,
      "z": 10
    },
    "capacity": 1,
    "capabilities": [
      "review",
      "converse"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  },
  {
    "id": "station.seat-24",
    "name": "老板办公室座位 24",
    "kind": "desk",
    "district": "district.3",
    "anchor": {
      "x": 18,
      "z": 8
    },
    "capacity": 1,
    "capabilities": [
      "review",
      "converse"
    ],
    "slots": [
      {
        "x": 0,
        "z": 0
      }
    ]
  }
]
