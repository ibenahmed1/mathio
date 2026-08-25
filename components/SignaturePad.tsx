'use client';

import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

// Signature tracée au doigt sur le téléphone du ramasseur (§ décharge d'un
// bon de retour). Rendue en data URL PNG, stockée telle quelle en base —
// même convention que les preuves de livraison (Commande.signatureUrl), ce
// projet n'ayant pas d'infrastructure de stockage objet.
//
// Le canvas est dimensionné en pixels RÉELS (largeur CSS × devicePixelRatio)
// puis remis à l'échelle : sans ça, le trait est flou sur mobile et les
// coordonnées du pointeur ne tombent pas où le doigt touche.
export function SignaturePad({
  onChange,
  hauteur = 180,
}: {
  onChange: (dataUrl: string | null) => void;
  hauteur?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dessineRef = useRef(false);
  const [vide, setVide] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const largeur = canvas.clientWidth;
    canvas.width = largeur * ratio;
    canvas.height = hauteur * ratio;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
    // Fond blanc explicite : un canvas transparent exporté en PNG donne une
    // signature invisible une fois imprimée sur fond blanc.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largeur, hauteur);
  }, [hauteur]);

  function position(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function debut(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dessineRef.current = true;
    const { x, y } = position(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function trace(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dessineRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = position(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function fin() {
    if (!dessineRef.current) return;
    dessineRef.current = false;
    setVide(false);
    onChange(canvasRef.current?.toDataURL('image/png') ?? null);
  }

  function effacer() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.clientWidth, hauteur);
    setVide(true);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        style={{ height: hauteur, touchAction: 'none' }}
        className="w-full rounded-md border-2 border-dashed border-black/25 bg-white dark:border-white/30"
        onPointerDown={debut}
        onPointerMove={trace}
        onPointerUp={fin}
        onPointerLeave={fin}
      />
      <div className="flex items-center justify-between text-xs opacity-60">
        <span>{vide ? 'Faites signer le marchand ci-dessus' : 'Signature capturée'}</span>
        <button type="button" onClick={effacer} className="flex items-center gap-1 hover:opacity-100">
          <Eraser className="h-3.5 w-3.5" />
          Effacer
        </button>
      </div>
    </div>
  );
}
