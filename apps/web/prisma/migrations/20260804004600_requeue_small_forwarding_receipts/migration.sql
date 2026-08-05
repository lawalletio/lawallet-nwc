UPDATE "RemoteWalletForwardReceipt" AS receipt
SET
  "status" = 'RECEIVED',
  "lastError" = NULL,
  "nextRetryAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE receipt."status" = 'BLOCKED'
  AND receipt."targetAmountMsats" > 0
  AND receipt."lastError" = 'Forwarding amount is too small for all configured destinations'
  AND NOT EXISTS (
    SELECT 1
    FROM "RemoteWalletForwardLeg" AS leg
    WHERE leg."receiptId" = receipt."id"
      AND leg."status" <> 'SUPERSEDED'
  );
