/**
 * Skills 模块入口
 *
 * 对齐 Codex codex-rs/skills/ + codex-rs/core/src/skills.rs
 * 提供 SKILL.md 发现、解析和上下文注入能力
 */

export { loadSkills, parseSkillMd, formatSkillsSummary, formatSkillInjection, type Skill } from './loader.js'
