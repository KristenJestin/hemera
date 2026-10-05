import { Schema, SchemaAST } from 'effect'
import type { JsonSchema } from 'effect'

/** The JSON Schema an MCP tool declares for its input. */
export interface ToolInputSchema extends JsonSchema.JsonSchema {
  readonly type: 'object'
  readonly $defs?: JsonSchema.Definitions
}

/**
 * The input schema of an MCP tool, generated from the Effect schema the tool decodes with. Every
 * Hemera MCP tool takes its input schema from here and from nowhere else.
 *
 * Everything is inlined, since an agent reads the schema rather than resolving references; only
 * a recursive schema keeps references, each one to a definition carried in the same document.
 */
export function toToolInputSchema(schema: Schema.Top): ToolInputSchema {
  const document = Schema.toJsonSchemaDocument(schema, { referencePolicy: () => undefined })
  const root = document.schema
  // A struct with no field is an object all the same: a tool that takes no argument.
  if (isEmptyStruct(schema.ast)) {
    return { type: 'object', properties: {}, description: root.description }
  }
  if (root.type !== 'object') {
    throw new Error('An MCP tool input must be a JSON object at the root: decode it with a Struct.')
  }
  const input: ToolInputSchema = { ...root, type: 'object' }
  return Object.keys(document.definitions).length === 0
    ? input
    : { ...input, $defs: document.definitions }
}

const isEmptyStruct = (ast: SchemaAST.AST): boolean =>
  SchemaAST.isObjects(ast) &&
  ast.propertySignatures.length === 0 &&
  ast.indexSignatures.length === 0
