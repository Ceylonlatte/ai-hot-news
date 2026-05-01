-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TWITTER', 'RSS', 'HACKERNEWS', 'REDDIT');

-- CreateEnum
CREATE TYPE "HeatLevel" AS ENUM ('BURST', 'HOT', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'PENDING');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('NORMAL', 'FAILED', 'LIMITED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('KEYWORD_HIT', 'BURST_HOTNEWS', 'SYSTEM');

-- CreateTable
CREATE TABLE "hot_news" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "rawHtml" TEXT,
    "sourcePlatform" "Platform" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "crawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heatScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heatLevel" "HeatLevel" NOT NULL DEFAULT 'LOW',
    "embedding" vector(1536),
    "dedupeHash" TEXT NOT NULL,
    "groupId" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'VISIBLE',
    "interactionData" JSONB,

    CONSTRAINT "hot_news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_configs" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "identifier" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "crawlInterval" INTEGER NOT NULL DEFAULT 1800,
    "lastCrawledAt" TIMESTAMP(3),
    "status" "SourceStatus" NOT NULL DEFAULT 'NORMAL',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_monitors" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_hits" (
    "id" TEXT NOT NULL,
    "hotNewsId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "hitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hot_news_sourceUrl_key" ON "hot_news"("sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "hot_news_dedupeHash_key" ON "hot_news"("dedupeHash");

-- CreateIndex
CREATE INDEX "hot_news_publishedAt_idx" ON "hot_news"("publishedAt" DESC);

-- CreateIndex
CREATE INDEX "hot_news_heatScore_idx" ON "hot_news"("heatScore" DESC);

-- CreateIndex
CREATE INDEX "hot_news_groupId_idx" ON "hot_news"("groupId");

-- CreateIndex
CREATE INDEX "hot_news_sourcePlatform_publishedAt_idx" ON "hot_news"("sourcePlatform", "publishedAt");

-- CreateIndex
CREATE INDEX "source_configs_platform_enabled_idx" ON "source_configs"("platform", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "keyword_monitors_userId_idx" ON "keyword_monitors"("userId");

-- CreateIndex
CREATE INDEX "keyword_hits_keywordId_hitAt_idx" ON "keyword_hits"("keywordId", "hitAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "keyword_hits_hotNewsId_keywordId_key" ON "keyword_hits"("hotNewsId", "keywordId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "keyword_monitors" ADD CONSTRAINT "keyword_monitors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_hits" ADD CONSTRAINT "keyword_hits_hotNewsId_fkey" FOREIGN KEY ("hotNewsId") REFERENCES "hot_news"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_hits" ADD CONSTRAINT "keyword_hits_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "keyword_monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
