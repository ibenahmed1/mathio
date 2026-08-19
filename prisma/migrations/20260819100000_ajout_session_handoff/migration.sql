-- § Séparation des espaces par domaine : jetons de transfert de session entre
-- le domaine du back-office et le domaine métier (cf. model SessionHandoff
-- dans prisma/schema.prisma et lib/auth.ts).

-- CreateTable
CREATE TABLE "session_handoffs" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "espace" TEXT NOT NULL,
    "impersonation" BOOLEAN NOT NULL DEFAULT false,
    "expire_le" TIMESTAMP(3) NOT NULL,
    "consomme_le" TIMESTAMP(3),
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utilisateur_id" TEXT NOT NULL,
    "emis_par_id" TEXT NOT NULL,

    CONSTRAINT "session_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_handoffs_token_hash_key" ON "session_handoffs"("token_hash");

-- CreateIndex
CREATE INDEX "session_handoffs_expire_le_idx" ON "session_handoffs"("expire_le");

-- AddForeignKey
ALTER TABLE "session_handoffs" ADD CONSTRAINT "session_handoffs_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_handoffs" ADD CONSTRAINT "session_handoffs_emis_par_id_fkey" FOREIGN KEY ("emis_par_id") REFERENCES "utilisateurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
