import {
  boolean,
  index,
  pgTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { idFor } from "../ids";
import { users } from "./auth";
import { createdAt, updatedAt } from "./columns";

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: varchar("id", { length: 255 })
      .primaryKey()
      .$defaultFn(() => idFor("notificationPreference")),

    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // type pattern such as "security.*", "user.*", or "*" for global
    typePattern: varchar("type_pattern", { length: 100 }).notNull(),

    emailEnabled: boolean("email_enabled").notNull().default(true),
    smsEnabled: boolean("sms_enabled").notNull().default(false),
    pushEnabled: boolean("push_enabled").notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("notification_preferences_user_id_idx").on(table.userId),
    uniqueIndex("notification_preferences_user_type_idx").on(
      table.userId,
      table.typePattern
    ),
  ]
);

export type NotificationPreference =
  typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference =
  typeof notificationPreferences.$inferInsert;
