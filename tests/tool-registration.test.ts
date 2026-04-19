/**
 * Tool Registration Tests
 *
 * Tests the tool registry: creation, tool metadata, schema validation.
 * No LLM or DB required -- purely synchronous tests.
 */

import { describe, it, expect } from 'vitest'
import { createToolRegistry } from '../src/tools/index.js'

describe('Tool Registration', () => {
  it('createToolRegistry() returns a registry with expected tools', () => {
    const registry = createToolRegistry()
    const tools = registry.list()

    expect(tools.length).toBeGreaterThan(0)
  })

  it('each tool has a valid name, description, and JSON Schema parameters', () => {
    const registry = createToolRegistry()
    const tools = registry.list()

    for (const tool of tools) {
      // Name: non-empty string
      expect(tool.name, `Tool name should be a non-empty string`).toBeTruthy()
      expect(typeof tool.name).toBe('string')

      // Description: non-empty string
      expect(tool.description, `Tool "${tool.name}" should have a description`).toBeTruthy()
      expect(typeof tool.description).toBe('string')

      // Parameters: object with at least a "type" field
      expect(tool.parameters, `Tool "${tool.name}" should have parameters`).toBeDefined()
      expect(typeof tool.parameters).toBe('object')
      expect(tool.parameters.type).toBe('object')
    }
  })

  it('registry.get() returns a specific tool by name', () => {
    const registry = createToolRegistry()
    const list = registry.list()
    const firstName = list[0].name

    const tool = registry.get(firstName)
    expect(tool).toBeDefined()
    expect(tool!.name).toBe(firstName)
  })

  it('registry.get() returns undefined for unknown tool name', () => {
    const registry = createToolRegistry()

    const tool = registry.get('nonexistent_tool_xyz')
    expect(tool).toBeUndefined()
  })

  it('toDefinitions() returns GLM function calling format', () => {
    const registry = createToolRegistry()
    const definitions = registry.toDefinitions()

    expect(Array.isArray(definitions)).toBe(true)
    expect(definitions.length).toBeGreaterThan(0)

    for (const def of definitions) {
      expect(def.type).toBe('function')
      expect(def.function).toBeDefined()
      expect(def.function.name).toBeTruthy()
      expect(def.function.description).toBeTruthy()
      expect(def.function.parameters).toBeDefined()
    }
  })

  it('each tool has a unique name', () => {
    const registry = createToolRegistry()
    const tools = registry.list()
    const names = tools.map((t) => t.name)

    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(names.length)
  })

  it('each tool has an execute function', () => {
    const registry = createToolRegistry()
    const tools = registry.list()

    for (const tool of tools) {
      expect(typeof tool.execute, `Tool "${tool.name}" should have an execute function`).toBe('function')
    }
  })

  it('contains expected core tools', () => {
    const registry = createToolRegistry()
    const names = registry.list().map((t) => t.name)

    // exec plugin
    expect(names).toContain('exec')

    // files plugin
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')

    // plan plugin
    expect(names).toContain('update_plan')

    // milestone plugin
    expect(names).toContain('milestone_plan')
  })

  it('tool parameters have properties defined', () => {
    const registry = createToolRegistry()
    const tools = registry.list()

    for (const tool of tools) {
      // Each tool's parameters should have a "properties" field
      // (even if it's an empty object for tools with no params)
      expect(
        tool.parameters.properties,
        `Tool "${tool.name}" parameters should have a "properties" field`,
      ).toBeDefined()
    }
  })

  it('pluginLoader is accessible from the registry', () => {
    const registry = createToolRegistry()

    expect(registry.pluginLoader).toBeDefined()
    expect(typeof registry.pluginLoader.getTools).toBe('function')
    expect(typeof registry.pluginLoader.listPlugins).toBe('function')
  })

  it('pluginLoader lists all registered plugins', () => {
    const registry = createToolRegistry()
    const plugins = registry.pluginLoader.listPlugins()

    expect(plugins.length).toBeGreaterThan(0)

    const pluginNames = plugins.map((p) => p.meta.name)
    expect(pluginNames).toContain('exec')
    expect(pluginNames).toContain('files')
    expect(pluginNames).toContain('plan')
    expect(pluginNames).toContain('milestone')
    expect(pluginNames).toContain('git')
    expect(pluginNames).toContain('indexer')
  })
})
