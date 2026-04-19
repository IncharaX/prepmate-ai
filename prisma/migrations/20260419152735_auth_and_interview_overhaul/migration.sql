-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- AlterTable
ALTER TABLE "InterviewResult" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InterviewSession" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "mode" "InterviewMode" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "plannedQuestions" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "status" "InterviewStatus" NOT NULL DEFAULT 'IN_PROGRESS',
ADD COLUMN     "summary" JSONB,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Interview';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "InterviewResult_sessionId_order_idx" ON "InterviewResult"("sessionId", "order");
