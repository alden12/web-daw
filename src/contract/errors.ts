/**
 * Shared contract primitives: the request-parameter schemas and the error-body shape,
 * defined once so the server (which validates against them) and the client (which is
 * typed by them) cannot disagree. Pure zod, DOM/Node-free - the server imports this.
 */
import { z } from "zod";

/** Project ids are minted by the client (`p-xxxxxxxx` / "default"); keep them tame. */
export const projectId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/);

/** Bundle-relative path: the known shape (segments + optional extension), never "..". */
export const filePath = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine((value) => !value.split("/").includes(".."), "no traversal");

/** The JSON body every error response carries: a stable code, plus an optional detail. */
export const errorBodySchema = z.object({ error: z.string(), detail: z.string().optional() });
export type ErrorBody = z.infer<typeof errorBodySchema>;
