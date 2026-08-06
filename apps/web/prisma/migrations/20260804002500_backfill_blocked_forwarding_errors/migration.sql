UPDATE "RemoteWalletForwardReceipt" AS receipt
SET
  "lastError" = 'Forwarding amount is too small for all configured destinations',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE receipt."status" = 'BLOCKED'
  AND receipt."lastError" IS NULL
  AND receipt."targetAmountMsats" > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "RemoteWalletForwardLeg" AS leg
    WHERE leg."receiptId" = receipt."id"
      AND leg."status" <> 'SUPERSEDED'
  );
