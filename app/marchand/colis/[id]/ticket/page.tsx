'use client';

import { use } from 'react';
import { ColisTicket } from '@/components/admin/ColisTicket';

export default function MarchandTicketColisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ColisTicket id={id} variant="ticket" />;
}
