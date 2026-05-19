-- CreateTable
CREATE TABLE "heat_history" (
    "id" TEXT NOT NULL,
    "hotNewsId" TEXT NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "heatScore" DOUBLE PRECISION NOT NULL,
    "heatLevel" "HeatLevel" NOT NULL,

    CONSTRAINT "heat_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "heat_history_hotNewsId_bucketAt_idx" ON "heat_history"("hotNewsId", "bucketAt" DESC);

-- CreateIndex
CREATE INDEX "heat_history_bucketAt_idx" ON "heat_history"("bucketAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "heat_history_hotNewsId_bucketAt_key" ON "heat_history"("hotNewsId", "bucketAt");

-- AddForeignKey
ALTER TABLE "heat_history" ADD CONSTRAINT "heat_history_hotNewsId_fkey" FOREIGN KEY ("hotNewsId") REFERENCES "hot_news"("id") ON DELETE CASCADE ON UPDATE CASCADE;
