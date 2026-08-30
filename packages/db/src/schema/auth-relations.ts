import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt } from "../helpers";
import { generatePrefixedCuid, ID_PREFIXES } from "../ids";
import { users } from "./auth";

export const authRelationsTable = pgTable(
  "auth_relations",
  {
    // Intentionally immutable, no updatedAt: callers delete + recreate.
    createdAt: createdAt(),
    // Nullable so onDelete "set null" applies when the creating user is deleted.
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    id: text("id")
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.relation)),
    objectId: text("object_id").notNull(),
    objectType: text("object_type").notNull(),
    relation: text("relation").notNull(),
    subjectId: text("subject_id").notNull(),
    subjectType: text("subject_type").notNull(),
  },
  (t) => [
    uniqueIndex("auth_rel_unique").on(
      t.subjectType,
      t.subjectId,
      t.relation,
      t.objectType,
      t.objectId
    ),
    index("auth_rel_subject_lookup").on(t.subjectType, t.subjectId, t.relation),
    index("auth_rel_object_lookup").on(t.objectType, t.objectId, t.relation),
    index("auth_rel_created_by_idx").on(t.createdBy),
  ]
);
