import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt } from "../helpers";
import { generatePrefixedCuid, ID_PREFIXES } from "../ids";
import { users } from "./auth";

export const authRelationsTable = pgTable(
  "auth_relations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.relation)),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    relation: text("relation").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    // Nullable so onDelete "set null" applies when the creating user is deleted.
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Intentionally immutable, no updatedAt: callers delete + recreate.
    createdAt: createdAt(),
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
