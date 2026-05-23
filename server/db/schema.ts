import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const tsCol = (name: string) =>
  integer(name, { mode: "timestamp" }).notNull().default(sql`(unixepoch())`);

// -------------------- clients --------------------
export const clients = sqliteTable(
  "clients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    surfsupClientId: text("surfsup_client_id").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    telegramChatId: text("telegram_chat_id"),
    totalRentals: integer("total_rentals").notNull().default(0),
    totalDaysRented: integer("total_days_rented").notNull().default(0),
    cooldownUntil: integer("cooldown_until"),
    cooldownReason: text("cooldown_reason"), // 'rejected' | 'no_response' | 'accepted_unpaid'
    cooldownTriggerBoardId: integer("cooldown_trigger_board_id"),
    cooldownTriggerAt: integer("cooldown_trigger_at"),
    createdAt: tsCol("created_at"),
    updatedAt: tsCol("updated_at"),
  },
  (t) => ({
    ux: uniqueIndex("ux_clients_surfsup_id").on(t.surfsupClientId),
  }),
);

// -------------------- boards --------------------
export const boards = sqliteTable(
  "boards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    surfsupBoardId: text("surfsup_board_id").notNull(),
    model: text("model").notNull(),
    brand: text("brand"),
    size: text("size").notNull(),
    liters: real("liters"),
    boardType: text("board_type"), // Shortboard | Longboard | Fish | Funboard | Mid-length
    precoSite: real("preco_site").notNull(),
    precoAmigo: real("preco_amigo").notNull(),
    precoMinimo: real("preco_minimo"),
    status: text("status").notNull().default("Disponivel"),
    notes: text("notes"),
    createdAt: tsCol("created_at"),
    updatedAt: tsCol("updated_at"),
  },
  (t) => ({
    ux: uniqueIndex("ux_boards_surfsup_id").on(t.surfsupBoardId),
  }),
);

// -------------------- rentals --------------------
export const rentals = sqliteTable(
  "rentals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    surfsupRentalId: text("surfsup_rental_id").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id),
    startDate: integer("start_date").notNull(),
    endDate: integer("end_date").notNull(),
    returnedAt: integer("returned_at"),
    status: text("status").notNull().default("Active"), // Active | Returned | Overdue | ConvertedToSale
    createdAt: tsCol("created_at"),
    updatedAt: tsCol("updated_at"),
  },
  (t) => ({
    ux: uniqueIndex("ux_rentals_surfsup_id").on(t.surfsupRentalId),
    ixClient: index("ix_rentals_client").on(t.clientId),
    ixBoard: index("ix_rentals_board").on(t.boardId),
    ixStatus: index("ix_rentals_status").on(t.status),
  }),
);

// -------------------- conversionOffers --------------------
export const conversionOffers = sqliteTable(
  "conversion_offers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    rentalId: integer("rental_id")
      .notNull()
      .references(() => rentals.id),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id),
    score: real("score").notNull(),
    scoringReason: text("scoring_reason"),
    status: text("status").notNull().default("NoOffer"),
    // NoOffer | Draft | PendingApproval | Scheduled | Sent | Accepted | Rejected | Expired | Paid
    scheduledFor: integer("scheduled_for"),
    offerExpiresAt: integer("offer_expires_at"),
    createdAt: tsCol("created_at"),
    updatedAt: tsCol("updated_at"),
  },
  (t) => ({
    uxRental: uniqueIndex("ux_offers_rental").on(t.rentalId),
    ixStatus: index("ix_offers_status").on(t.status),
  }),
);

// -------------------- messages --------------------
export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    offerId: integer("offer_id")
      .notNull()
      .references(() => conversionOffers.id),
    content: text("content").notNull(),
    approved: integer("approved").notNull().default(0),
    approvedAt: integer("approved_at"),
    sentAt: integer("sent_at"),
    telegramMessageId: integer("telegram_message_id"),
    response: text("response"),
    responseAt: integer("response_at"),
    responseType: text("response_type"), // Interested | NotInterested | NoResponse | Responding
    operatorTookOver: integer("operator_took_over").notNull().default(0),
    createdAt: tsCol("created_at"),
    updatedAt: tsCol("updated_at"),
  },
  (t) => ({
    ixOffer: index("ix_messages_offer").on(t.offerId),
  }),
);

// -------------------- sales --------------------
export const sales = sqliteTable(
  "sales",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    offerId: integer("offer_id")
      .notNull()
      .references(() => conversionOffers.id),
    rentalId: integer("rental_id")
      .notNull()
      .references(() => rentals.id),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id),
    salePrice: real("sale_price").notNull(),
    paymentStatus: text("payment_status").notNull().default("pending"),
    stripeSessionId: text("stripe_session_id"),
    stripeLinkUrl: text("stripe_link_url"),
    paidAt: integer("paid_at"),
    surfsupNotifiedAt: integer("surfsup_notified_at"),
    createdAt: tsCol("created_at"),
    updatedAt: tsCol("updated_at"),
  },
  (t) => ({
    ixOffer: index("ix_sales_offer").on(t.offerId),
    ixStripe: index("ix_sales_stripe").on(t.stripeSessionId),
  }),
);

// -------------------- notifications --------------------
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  read: integer("read").notNull().default(0),
  metadata: text("metadata"), // json
  createdAt: tsCol("created_at"),
});

// -------------------- settings --------------------
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: tsCol("updated_at"),
});

// -------------------- clientBoardStats (denormalized for scoring) --------------------
export const clientBoardStats = sqliteTable(
  "client_board_stats",
  {
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id),
    rentalsCount: integer("rentals_count").notNull().default(0),
    daysCount: integer("days_count").notNull().default(0),
    lastRentalAt: integer("last_rental_at"),
    updatedAt: tsCol("updated_at"),
  },
  (t) => ({
    ux: uniqueIndex("ux_cbs_client_board").on(t.clientId, t.boardId),
  }),
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Board = typeof boards.$inferSelect;
export type Rental = typeof rentals.$inferSelect;
export type ConversionOffer = typeof conversionOffers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Sale = typeof sales.$inferSelect;
