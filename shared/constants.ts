// Vocabulário e enums compartilhados client/server

export const RENTAL_STATUS = ["Active", "Returned", "Overdue", "ConvertedToSale"] as const;
export type RentalStatus = (typeof RENTAL_STATUS)[number];

export const OFFER_STATUS = [
  "NoOffer",
  "Draft",
  "PendingApproval",
  "Scheduled",
  "Sent",
  "Accepted",
  "Rejected",
  "Expired",
  "Paid",
] as const;
export type OfferStatus = (typeof OFFER_STATUS)[number];

export const BOARD_TYPES = ["Shortboard", "Longboard", "Fish", "Funboard", "Mid-length"] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

export const COOLDOWN_REASONS = ["rejected", "no_response", "accepted_unpaid"] as const;
export type CooldownReason = (typeof COOLDOWN_REASONS)[number];

export const RESPONSE_TYPES = ["Interested", "NotInterested", "NoResponse", "Responding"] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

export const SETTINGS_KEYS = [
  "offer_window_days",
  "cooldown_days",
  "min_score_to_generate",
  "stripe_mode",
  "telegram_bot_token",
  "telegram_test_chat_id",
  "surfsup_notify_email",
] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];
