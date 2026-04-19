/**
 * AST 符号解析器 — 使用 TypeScript Compiler API
 *
 * 用 ts.createSourceFile 解析 TypeScript/JavaScript 文件，
 * 遍历 AST 提取符号信息（函数、类、接口、类型、变量等）。
 *
 * 学习重点：
 * - TypeScript Compiler API 的 createSourceFile 可以独立解析文件
 * - 不需要完整的 TypeScript 程序（ts.createProgram），更轻量
 * - AST 节点类型判断用 ts.isXxxDeclaration 系列函数
 * - 位置信息通过 getStart()/getEnd() 获取，再转行号
 */

import * as ts from 'typescript'
import { readFileSync, statSync } from 'fs'
import { relative, extname } from 'path'
import type { SymbolEntry, SymbolKind, IndexerConfig } from './types.js'

/** 默认索引配置 */
export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
  projectRoot: process.cwd(),
  includePatterns: ['.ts', '.tsx', '.js', '.jsx'],
  excludeDirs: ['node_modules', 'dist', 'build', '.git', 'chitu-data', 'web-ui/node_modules'],
  maxFileSize: 100_000, // 100KB
}

/**
 * 解析单个文件的 AST，提取所有符号
 */
export function parseFileSymbols(filePath: string, projectRoot: string): SymbolEntry[] {
  const relativePath = relative(projectRoot, filePath)
  const ext = extname(filePath)

  // 只处理 TS/JS 文件
  if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    return []
  }

  // .d.ts 声明文件跳过
  if (filePath.endsWith('.d.ts')) {
    return []
  }

  let sourceText: string
  try {
    // 检查文件大小
    const stat = statSync(filePath)
    if (stat.size > DEFAULT_INDEXER_CONFIG.maxFileSize) {
      return []
    }
    sourceText = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    ext === '.tsx' || ext === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const symbols: SymbolEntry[] = []
  const lineStarts = sourceFile.getLineStarts()

  /** 将字符偏移转换为行号（1-based） */
  function getLineNumber(position: number): number {
    let low = 0
    let high = lineStarts.length - 1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (lineStarts[mid] <= position) {
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return high + 1
  }


  /** 获取函数/方法签名 */
  function getSignature(node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction): string {
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    const text = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile)
    // 截取第一行作为签名
    const firstLine = text.split('\n')[0]
    return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine
  }

  /** 检查是否被导出 */
  function getExportName(node: ts.Node): string | undefined {
    // 检查是否有 export 修饰符
    if (ts.isVariableDeclaration(node)) {
      const list = node.parent
      if (ts.isVariableDeclarationList(list)) {
        const stmt = list.parent
        if (ts.isVariableStatement(stmt) && isExported(stmt)) {
          return node.name.getText(sourceFile)
        }
      }
      return undefined
    }

    if (isExported(node)) {
      return getNodeName(node)
    }
    return undefined
  }

  function isExported(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    if (modifiers) {
      return modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    }
    // 检查是否在 export default 中
    if (node.parent && ts.isExportAssignment(node.parent)) {
      return true
    }
    return false
  }

  function getNodeName(node: ts.Node): string | undefined {
    if ('name' in node && node.name) {
      return (node.name as ts.Identifier).getText(sourceFile)
    }
    return undefined
  }

  /** 创建符号条目 */
  function createEntry(
    node: ts.Node,
    kind: SymbolKind,
    name: string,
    signature?: string,
  ): SymbolEntry {
    const start = node.getStart(sourceFile)
    const end = node.getEnd()
    return {
      name,
      kind,
      filePath: relativePath,
      startLine: getLineNumber(start),
      endLine: getLineNumber(end),
      exportName: getExportName(node),
      signature,
    }
  }

  // 遍历 AST
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.getText(sourceFile)
      symbols.push(createEntry(node, 'function', name, getSignature(node)))
    } else if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.getText(sourceFile)
      symbols.push(createEntry(node, 'class', name))
    } else if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.getText(sourceFile)
      symbols.push(createEntry(node, 'interface', name))
    } else if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.getText(sourceFile)
      symbols.push(createEntry(node, 'type', name))
    } else if (ts.isEnumDeclaration(node)) {
      const name = node.name.getText(sourceFile)
      symbols.push(createEntry(node, 'enum', name))
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const name = decl.name.getText(sourceFile)
        // 判断变量是否是函数类型（箭头函数/函数表达式）
        if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
          symbols.push(createEntry(decl, 'function', name, getSignature(decl.initializer)))
        } else if (decl.initializer && ts.isFunctionExpression(decl.initializer)) {
          symbols.push(createEntry(decl, 'function', name, getSignature(decl.initializer)))
        } else {
          symbols.push(createEntry(decl, 'variable', name))
        }
      }
    } else if (ts.isMethodDeclaration(node) && node.name) {
      const name = node.name.getText(sourceFile)
      symbols.push(createEntry(node, 'method', name, getSignature(node)))
    } else if (ts.isPropertyDeclaration(node) && node.name) {
      const name = node.name.getText(sourceFile)
      symbols.push(createEntry(node, 'property', name))
    } else if (ts.isImportDeclaration(node)) {
      const importClause = node.importClause
      if (importClause) {
        const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text
        if (importClause.name) {
          // default import
          symbols.push({
            name: importClause.name.getText(sourceFile),
            kind: 'import',
            filePath: relativePath,
            startLine: getLineNumber(node.getStart(sourceFile)),
            endLine: getLineNumber(node.getEnd()),
            signature: `from '${moduleSpecifier}'`,
          })
        }
        if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
          for (const element of importClause.namedBindings.elements) {
            symbols.push({
              name: element.name.getText(sourceFile),
              kind: 'import',
              filePath: relativePath,
              startLine: getLineNumber(element.getStart(sourceFile)),
              endLine: getLineNumber(element.getEnd()),
              signature: `from '${moduleSpecifier}'`,
            })
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return symbols
}
