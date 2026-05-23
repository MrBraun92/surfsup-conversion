-- 0000_initial.sql — schema completo Surfsup Conversão

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surfsup_client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  telegram_chat_id TEXT,
  total_rentals INTEGER NOT NULL DEFAULT 0,
  total_days_rented INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER,
  cooldown_reason TEXT,
  cooldown_trigger_board_id INTEGER,
  cooldown_trigger_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX ux_clients_surfsup_id ON clients(surfsup_client_id);

CREATE TABLE boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surfsup_board_id TEXT NOT NULL,
  model TEXT NOT NULL,
  brand TEXT,
  size TEXT NOT NULL,
  liters REAL,
  board_type TEXT,
  preco_site REAL NOT NULL,
  preco_amigo REAL NOT NULL,
  preco_minimo REAL,
  status TEXT NOT NULL DEFAULT 'Disponivel',
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX ux_boards_surfsup_id ON boards(surfsup_board_id);

CREATE TABLE rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surfsup_rental_id TEXT NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  board_id INTEGER NOT NULL REFERENCES boards(id),
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  returned_at INTEGER,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX ux_rentals_surfsup_id ON rentals(surfsup_rental_id);
CREATE INDEX ix_rentals_client ON rentals(client_id);
CREATE INDEX ix_rentals_board ON rentals(board_id);
CREATE INDEX ix_rentals_status ON rentals(status);

CREATE TABLE conversion_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_id INTEGER NOT NULL REFERENCES rentals(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  board_id INTEGER NOT NULL REFERENCES boards(id),
  score REAL NOT NULL,
  scoring_reason TEXT,
  status TEXT NOT NULL DEFAULT 'NoOffer',
  scheduled_for INTEGER,
  offer_expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX ux_offers_rental ON conversion_offers(rental_id);
CREATE INDEX ix_offers_status ON conversion_offers(status);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES conversion_offers(id),
  content TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  approved_at INTEGER,
  sent_at INTEGER,
  telegram_message_id INTEGER,
  response TEXT,
  response_at INTEGER,
  response_type TEXT,
  operator_took_over INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX ix_messages_offer ON messages(offer_id);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES conversion_offers(id),
  rental_id INTEGER NOT NULL REFERENCES rentals(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  board_id INTEGER NOT NULL REFERENCES boards(id),
  sale_price REAL NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT,
  stripe_link_url TEXT,
  paid_at INTEGER,
  surfsup_notified_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX ix_sales_offer ON sales(offer_id);
CREATE INDEX ix_sales_stripe ON sales(stripe_session_id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE client_board_stats (
  client_id INTEGER NOT NULL REFERENCES clients(id),
  board_id INTEGER NOT NULL REFERENCES boards(id),
  rentals_count INTEGER NOT NULL DEFAULT 0,
  days_count INTEGER NOT NULL DEFAULT 0,
  last_rental_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX ux_cbs_client_board ON client_board_stats(client_id, board_id);

-- defaults de settings
INSERT INTO settings (key, value) VALUES
  ('offer_window_days', '2'),
  ('cooldown_days', '90'),
  ('min_score_to_generate', '50'),
  ('stripe_mode', 'stub'),
  ('telegram_bot_token', ''),
  ('surfsup_notify_email', '');
