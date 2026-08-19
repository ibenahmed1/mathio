'use client';

import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

// § /livreur/colis, action "Livré" (RG-02) : la preuve de livraison est une
// photo OU une signature. La signature est capturée ici au doigt puis émise
// en data URL PNG — même convention de stockage que la photo (data URL en
// base, cf. lib/read-file.ts et Commande.cinUrl), pas de stockage objet.
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dessine = useRef(false);
  const [vierge, setVierge] = useState(true);

  // Le canvas est dimensionné en pixels réels (densité d'écran comprise) une
  // fois monté : sans ça le trait est flou et décalé du doigt sur mobile.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  function positionDe(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function commencer(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dessine.current = true;
    const { x, y } = positionDe(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function tracer(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dessine.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = positionDe(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (vierge) setVierge(false);
  }

  function terminer() {
    if (!dessine.current) return;
    dessine.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(vierge ? null : canvas.toDataURL('image/png'));
  }

  function effacer() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setVierge(true);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvasRef}
        onPointerDown={commencer}
        onPointerMove={tracer}
        onPointerUp={terminer}
        onPointerLeave={terminer}
        className="h-36 w-full touch-none rounded-md border border-dashed border-black/25 bg-white dark:border-white/25"
      />
      <button type="button" onClick={effacer} className="flex items-center gap-1 self-end text-xs font-semibold opacity-70 hover:opacity-100">
        <Eraser className="h-3.5 w-3.5" />
        Effacer
      </button>
    </div>
  );
}
