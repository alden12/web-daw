/**
 * Strict validation of a value against a ParamSpec, returning an error message
 * (or null if valid). Used by the MCP server to give the model clear feedback
 * instead of silently clamping (the store itself coerces; this rejects).
 */
import type { ParamSpec, ParamValue } from './types';

export function validateParam(spec: ParamSpec, value: ParamValue): string | null {
  switch (spec.kind) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `"${spec.id}" expects a number.`;
      if (value < spec.min || value > spec.max) {
        const unit = spec.unit ? ` ${spec.unit}` : '';
        return `"${spec.id}" out of range: must be ${spec.min}..${spec.max}${unit}.`;
      }
      return null;
    case 'enum':
      return spec.options.includes(value as string)
        ? null
        : `"${spec.id}" must be one of: ${spec.options.join(', ')}.`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `"${spec.id}" expects a boolean.`;
  }
}
