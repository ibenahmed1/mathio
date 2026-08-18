-- CreateTable
CREATE TABLE "rate_limit_entries" (
    "id" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "compteur" INTEGER NOT NULL DEFAULT 1,
    "fenetre_debut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_entries_cle_key" ON "rate_limit_entries"("cle");
