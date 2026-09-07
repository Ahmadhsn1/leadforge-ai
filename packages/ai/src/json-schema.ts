import { z } from 'zod';

/**
 * Minimal Zod → JSON Schema converter.
 *
 * Only covers the constructs used by the task schemas in @leadforge/shared,
 * and emits the strict, additionalProperties:false shape that OpenRouter's
 * structured-output mode requires. A dedicated library would be heavier than
 * the surface we actually need, and would still need this strictness pass.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName?: string } & Record<string, unknown>;

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString: {
      const node: Record<string, unknown> = { type: 'string' };
      const checks = (def.checks ?? []) as { kind: string; value?: number }[];
      for (const check of checks) {
        if (check.kind === 'min' && typeof check.value === 'number') node.minLength = check.value;
        if (check.kind === 'max' && typeof check.value === 'number') node.maxLength = check.value;
      }
      return node;
    }

    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const node: Record<string, unknown> = { type: 'number' };
      const checks = (def.checks ?? []) as { kind: string; value?: number }[];
      for (const check of checks) {
        if (check.kind === 'min' && typeof check.value === 'number') node.minimum = check.value;
        if (check.kind === 'max' && typeof check.value === 'number') node.maximum = check.value;
        if (check.kind === 'int') node.type = 'integer';
      }
      return node;
    }

    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: 'boolean' };

    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { type: 'string', enum: [...((def.values ?? []) as string[])] };

    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return { const: def.value };

    case z.ZodFirstPartyTypeKind.ZodArray: {
      const node: Record<string, unknown> = {
        type: 'array',
        items: convert(def.type as z.ZodTypeAny),
      };
      const exact = def.exactLength as { value: number } | null | undefined;
      const min = def.minLength as { value: number } | null | undefined;
      const max = def.maxLength as { value: number } | null | undefined;
      if (exact) {
        node.minItems = exact.value;
        node.maxItems = exact.value;
      } else {
        if (min) node.minItems = min.value;
        if (max) node.maxItems = max.value;
      }
      return node;
    }

    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value);
        // Strict mode requires every property in `required`; optional fields
        // are expressed by allowing null instead.
        required.push(key);
        if (isOptional(value)) {
          const current = properties[key] as Record<string, unknown>;
          properties[key] = nullable(current);
        }
      }

      return { type: 'object', properties, required, additionalProperties: false };
    }

    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable:
      return nullable(convert(def.innerType as z.ZodTypeAny));

    case z.ZodFirstPartyTypeKind.ZodDefault:
      return convert(def.innerType as z.ZodTypeAny);

    case z.ZodFirstPartyTypeKind.ZodEffects:
      return convert(def.schema as z.ZodTypeAny);

    case z.ZodFirstPartyTypeKind.ZodUnion: {
      const options = (def.options as z.ZodTypeAny[]).map(convert);
      return { anyOf: options };
    }

    case z.ZodFirstPartyTypeKind.ZodRecord:
      return { type: 'object', additionalProperties: convert(def.valueType as z.ZodTypeAny) };

    case z.ZodFirstPartyTypeKind.ZodLazy:
      return convert((def.getter as () => z.ZodTypeAny)());

    default:
      // Unknown constructs degrade to "any object"; the Zod parse afterwards
      // is what actually enforces correctness.
      return {};
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema._def as { typeName?: string }).typeName;
  return (
    typeName === z.ZodFirstPartyTypeKind.ZodOptional ||
    typeName === z.ZodFirstPartyTypeKind.ZodNullable ||
    typeName === z.ZodFirstPartyTypeKind.ZodDefault
  );
}

function nullable(node: Record<string, unknown>): Record<string, unknown> {
  if (typeof node.type === 'string') return { ...node, type: [node.type, 'null'] };
  if (node.anyOf) return { anyOf: [...(node.anyOf as unknown[]), { type: 'null' }] };
  return node;
}
