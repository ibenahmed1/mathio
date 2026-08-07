"use client";

import { useCallback, useState } from "react";
import CashflowReport from "./CashflowReport";
import InventoryOrders from "./InventoryOrders";
import TransactionsTable from "./TransactionsTable";
import a from "./Accounting.module.css";

// Coordonne le rafraîchissement entre les deux cartes qui lisent
// /api/finance : sans ça, créer/annuler une transaction dans TransactionsTable
// ne met pas à jour les totaux déjà chargés par CashflowReport (composants
// frères, chacun avec son propre fetch).
export default function ComptabiliteBoard() {
  const [refreshToken, setRefreshToken] = useState(0);
  const rafraichir = useCallback(() => setRefreshToken((v) => v + 1), []);

  return (
    <div className={a.grid}>
      <div className={a.colLeft}>
        <CashflowReport refreshToken={refreshToken} />
        <InventoryOrders />
      </div>
      <TransactionsTable refreshToken={refreshToken} onMutate={rafraichir} />
    </div>
  );
}
