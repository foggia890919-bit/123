-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SALES_REP', 'DOCTOR', 'PHARMACIST');

-- CreateEnum
CREATE TYPE "MedSource" AS ENUM ('EXCEL', 'PUBLIC_API');

-- CreateEnum
CREATE TYPE "FilterStatus" AS ENUM ('PENDING', 'REVIEWING', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SALES_REP',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "carrier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberCompanyRate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "additionalRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberCompanyRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL,
    "categoryA" TEXT,
    "ingredientName" TEXT NOT NULL,
    "categoryB" TEXT,
    "commissionRate" DOUBLE PRECISION,
    "companyName" TEXT NOT NULL,
    "bioStatus" TEXT,
    "productName" TEXT NOT NULL,
    "price" INTEGER,
    "originalDrug" TEXT,
    "insuranceCode" TEXT,
    "notes" TEXT,
    "isSettlement" BOOLEAN NOT NULL DEFAULT false,
    "settlementType" TEXT,
    "source" "MedSource" NOT NULL DEFAULT 'EXCEL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalItem" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "originalMedicationId" TEXT,
    "altMedicationId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProposalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientCompany" (
    "id" TEXT NOT NULL,
    "businessNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "representative" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "FilterRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "bizNumber" TEXT NOT NULL,
    "bizDocument" TEXT,
    "bizFileName" TEXT,
    "companyName" TEXT NOT NULL,
    "status" "FilterStatus" NOT NULL DEFAULT 'PENDING',
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "telegramBotToken" TEXT,
    "telegramChatId" TEXT,
    "googleSheetsId" TEXT,
    "googleServiceAccountEmail" TEXT,
    "googleServiceAccountKey" TEXT,
    "reportTime" TEXT NOT NULL DEFAULT '09:00',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaverStore" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bizName" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaverStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaverProduct" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "channelProductNo" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "watched" BOOLEAN NOT NULL DEFAULT true,
    "lastImportedAt" TIMESTAMP(3),
    "notifiedNew" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaverProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCost" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "optionName" TEXT NOT NULL DEFAULT '',
    "keyword" TEXT NOT NULL DEFAULT '',
    "bottlesPerUnit" INTEGER NOT NULL DEFAULT 1,
    "unitCost" INTEGER NOT NULL DEFAULT 0,
    "shippingCost" INTEGER NOT NULL DEFAULT 0,
    "fulfillCost" INTEGER NOT NULL DEFAULT 0,
    "packagingCost" INTEGER NOT NULL DEFAULT 0,
    "etcCost" INTEGER NOT NULL DEFAULT 0,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaverOrder" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "buyerName" TEXT,
    "totalAmount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NaverOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaverOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "productOrderId" TEXT NOT NULL,
    "channelProductNo" TEXT,
    "sellerProductCode" TEXT,
    "productName" TEXT NOT NULL,
    "optionName" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL DEFAULT 0,
    "optionPrice" INTEGER NOT NULL DEFAULT 0,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "salesAmount" INTEGER NOT NULL DEFAULT 0,
    "channelCommission" INTEGER NOT NULL DEFAULT 0,
    "payCommission" INTEGER NOT NULL DEFAULT 0,
    "settlementAmount" INTEGER NOT NULL DEFAULT 0,
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "channelName" TEXT,
    "status" TEXT,
    "detailStatus" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "orderedAt" TIMESTAMP(3),

    CONSTRAINT "NaverOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReportLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "message" TEXT,

    CONSTRAINT "DailyReportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackfillJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "cursor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ordersAdded" INTEGER NOT NULL DEFAULT 0,
    "itemsAdded" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackfillJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "patterns" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "bottlesRule" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "MemberCompanyRate_userId_idx" ON "MemberCompanyRate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberCompanyRate_userId_companyName_key" ON "MemberCompanyRate"("userId", "companyName");

-- CreateIndex
CREATE INDEX "Medication_ingredientName_idx" ON "Medication"("ingredientName");

-- CreateIndex
CREATE INDEX "Medication_productName_idx" ON "Medication"("productName");

-- CreateIndex
CREATE INDEX "Medication_insuranceCode_idx" ON "Medication"("insuranceCode");

-- CreateIndex
CREATE INDEX "Medication_companyName_idx" ON "Medication"("companyName");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCompany_businessNumber_key" ON "ClientCompany"("businessNumber");

-- CreateIndex
CREATE INDEX "FilterRequest_userId_idx" ON "FilterRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "NaverStore_workspaceId_idx" ON "NaverStore"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "NaverStore_workspaceId_code_key" ON "NaverStore"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "NaverProduct_storeId_idx" ON "NaverProduct"("storeId");

-- CreateIndex
CREATE INDEX "NaverProduct_watched_idx" ON "NaverProduct"("watched");

-- CreateIndex
CREATE UNIQUE INDEX "NaverProduct_storeId_channelProductNo_key" ON "NaverProduct"("storeId", "channelProductNo");

-- CreateIndex
CREATE INDEX "ProductCost_productId_idx" ON "ProductCost"("productId");

-- CreateIndex
CREATE INDEX "ProductCost_keyword_idx" ON "ProductCost"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCost_productId_optionName_effectiveAt_key" ON "ProductCost"("productId", "optionName", "effectiveAt");

-- CreateIndex
CREATE INDEX "NaverOrder_storeId_paymentDate_idx" ON "NaverOrder"("storeId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "NaverOrder_storeId_orderId_key" ON "NaverOrder"("storeId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "NaverOrderItem_productOrderId_key" ON "NaverOrderItem"("productOrderId");

-- CreateIndex
CREATE INDEX "NaverOrderItem_orderId_idx" ON "NaverOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "NaverOrderItem_productId_idx" ON "NaverOrderItem"("productId");

-- CreateIndex
CREATE INDEX "NaverOrderItem_paymentDate_idx" ON "NaverOrderItem"("paymentDate");

-- CreateIndex
CREATE INDEX "DailyReportLog_workspaceId_idx" ON "DailyReportLog"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReportLog_workspaceId_reportDate_key" ON "DailyReportLog"("workspaceId", "reportDate");

-- CreateIndex
CREATE INDEX "BackfillJob_workspaceId_idx" ON "BackfillJob"("workspaceId");

-- CreateIndex
CREATE INDEX "BackfillJob_storeId_idx" ON "BackfillJob"("storeId");

-- CreateIndex
CREATE INDEX "BackfillJob_status_idx" ON "BackfillJob"("status");

-- CreateIndex
CREATE INDEX "KeywordRule_workspaceId_idx" ON "KeywordRule"("workspaceId");

-- CreateIndex
CREATE INDEX "KeywordRule_workspaceId_enabled_priority_idx" ON "KeywordRule"("workspaceId", "enabled", "priority");

-- AddForeignKey
ALTER TABLE "MemberCompanyRate" ADD CONSTRAINT "MemberCompanyRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_originalMedicationId_fkey" FOREIGN KEY ("originalMedicationId") REFERENCES "Medication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_altMedicationId_fkey" FOREIGN KEY ("altMedicationId") REFERENCES "Medication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterRequest" ADD CONSTRAINT "FilterRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NaverStore" ADD CONSTRAINT "NaverStore_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NaverProduct" ADD CONSTRAINT "NaverProduct_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "NaverStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "NaverProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NaverOrder" ADD CONSTRAINT "NaverOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "NaverStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NaverOrderItem" ADD CONSTRAINT "NaverOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "NaverOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NaverOrderItem" ADD CONSTRAINT "NaverOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "NaverProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportLog" ADD CONSTRAINT "DailyReportLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillJob" ADD CONSTRAINT "BackfillJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "NaverStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordRule" ADD CONSTRAINT "KeywordRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
