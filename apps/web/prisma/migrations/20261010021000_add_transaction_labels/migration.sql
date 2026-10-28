CREATE TABLE "TransactionLabel" (
    "userId" TEXT NOT NULL,
    "paymentHash" VARCHAR(64) NOT NULL,
    "label" VARCHAR(100) NOT NULL,

    CONSTRAINT "TransactionLabel_pkey" PRIMARY KEY ("userId", "paymentHash")
);

ALTER TABLE "TransactionLabel" ADD CONSTRAINT "TransactionLabel_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
