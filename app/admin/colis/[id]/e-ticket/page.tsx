'use client';

import { use } from 'react';
import { ColisTicket } from '@/components/admin/ColisTicket';

export default function ETicketColisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ColisTicket id={id} variant="e-ticket" />;
}
