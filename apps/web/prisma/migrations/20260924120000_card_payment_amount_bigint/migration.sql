-- BoltCard spends were stored as INTEGER, which caps a payment at
-- 2,147,483,647 msats (~2.1M sats). Widen the column so the recorded amount
-- can be whatever the bound wallet actually sends.
ALTER TABLE "CardPaymentAttempt"
  ALTER COLUMN "amountMsats" TYPE BIGINT;
