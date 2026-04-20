import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client";

/**
 * Models whose queries are filtered by `deleted_at IS NULL` automatically and whose
 * `delete` / `deleteMany` calls are rewritten into an `update` that sets `deletedAt`.
 * Keep in sync with the schema — every model with a `deletedAt` column goes here.
 */
const SOFT_DELETE_MODELS = new Set<string>([
  "User",
  "Resume",
  "JobDescription",
  "InterviewSession",
]);

/**
 * Merge a soft-delete filter (`deletedAt: null`) into an existing `where` clause.
 * Returns a new object; does not mutate the input.
 */
function withSoftDeleteWhere(where: unknown): Record<string, unknown> {
  const base = { deletedAt: null } as Record<string, unknown>;
  if (!where || typeof where !== "object") return base;
  return { AND: [base, where as Record<string, unknown>] };
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set before importing lib/prisma.");
}
const baseClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * Soft-delete client extension. Rewrites read queries to exclude rows with
 * `deletedAt IS NOT NULL`, and rewrites `delete` / `deleteMany` into soft
 * deletes (`update` setting `deletedAt = now()`).
 *
 * Known limitations — see prisma/migrations-plan.md §5:
 *   - `findUnique` / `findUniqueOrThrow` cannot accept extra where predicates,
 *     so we only auto-filter `findFirst` / `findMany` / `count` / `aggregate`.
 *     Callers that need soft-delete filtering on a unique lookup must use
 *     `findFirst` instead. This is documented inline.
 *   - Nested `include` of soft-deletable relations is NOT auto-filtered. Callers
 *     must write `include: { sessions: { where: { deletedAt: null } } }`.
 *   - Raw SQL ($queryRaw / $executeRaw) is NOT filtered. Add `WHERE deleted_at
 *     IS NULL` manually.
 *   - Hard deletes through the default `prisma` client become soft deletes.
 *     If you truly need a hard delete (e.g. admin purge, GDPR), import
 *     `prismaAdmin` instead and leave a `// why:` comment.
 */
const extended = baseClient.$extends({
  name: "soft-delete",
  query: {
    $allModels: {
      async findFirst({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model)) {
          args.where = withSoftDeleteWhere(args.where);
        }
        return query(args);
      },
      async findFirstOrThrow({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model)) {
          args.where = withSoftDeleteWhere(args.where);
        }
        return query(args);
      },
      async findMany({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model)) {
          args.where = withSoftDeleteWhere(args.where);
        }
        return query(args);
      },
      async count({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model)) {
          args = { ...args, where: withSoftDeleteWhere(args?.where) };
        }
        return query(args);
      },
      async aggregate({ model, args, query }) {
        if (SOFT_DELETE_MODELS.has(model)) {
          args = { ...args, where: withSoftDeleteWhere(args?.where) };
        }
        return query(args);
      },
      async delete({ model, args, query }) {
        if (!SOFT_DELETE_MODELS.has(model)) return query(args);
        const delegate = (baseClient as unknown as Record<string, { update: (x: unknown) => Promise<unknown> }>)[
          lowerFirst(model)
        ];
        return delegate.update({ where: args.where, data: { deletedAt: new Date() } });
      },
      async deleteMany({ model, args, query }) {
        if (!SOFT_DELETE_MODELS.has(model)) return query(args);
        const delegate = (baseClient as unknown as Record<string, { updateMany: (x: unknown) => Promise<unknown> }>)[
          lowerFirst(model)
        ];
        return delegate.updateMany({ where: args?.where, data: { deletedAt: new Date() } });
      },
    },
  },
});

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

const globalForPrisma = globalThis as unknown as {
  prisma?: typeof extended;
  prismaAdmin?: PrismaClient;
};

/**
 * Default Prisma client. Applies soft-delete filtering automatically. Use this
 * everywhere except admin tools.
 */
export const prisma = globalForPrisma.prisma ?? extended;

/**
 * Unfiltered Prisma client — bypasses the soft-delete extension.
 *
 * USE ONLY FOR: admin tools, data export scripts, restore flows, or when you
 * deliberately need to see or modify soft-deleted rows. Every import site must
 * include a `// why:` comment explaining the exception.
 */
export const prismaAdmin = globalForPrisma.prismaAdmin ?? baseClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaAdmin = prismaAdmin;
}

export default prisma;
