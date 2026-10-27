import assert from 'node:assert/strict'
import test from 'node:test'
import { skillForTool } from '../lib/sim/tool-skill.js'

test('工具名 → 技能：内容/搜索去 research', () => {
  assert.equal(skillForTool('agent_world_content'), 'research')
  assert.equal(skillForTool('search'), 'research')
  assert.equal(skillForTool('read_file'), 'research')
})

test('工具名 → 技能：终端/执行去 compute', () => {
  assert.equal(skillForTool('bash'), 'compute')
  assert.equal(skillForTool('terminal'), 'compute')
  assert.equal(skillForTool('run_tests'), 'compute')
})

test('工具名 → 技能：评审去 review，其余 code', () => {
  assert.equal(skillForTool('review'), 'review')
  assert.equal(skillForTool('verify'), 'review')
  assert.equal(skillForTool('agent_world_dispatch'), 'code')
  assert.equal(skillForTool(''), 'code')
})
