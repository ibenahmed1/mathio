'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, Flashlight, FlashlightOff, Keyboard, RefreshCw } from 'lucide-react';

// Ré-application d'un même code déjà traité dans cette fenêtre de temps :
// ignorée. Laisse le temps au ramasseur de retirer le colis du cadre avant
// qu'un nouveau scan ne soit accepté (le flux vidéo continue de tourner).
const RESCAN_COOLDOWN_MS = 2500;

type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';

interface TorchCapableTrack extends MediaStreamTrack {
  // `torch` n'est pas encore dans les types DOM standard (extension Chrome/Android).
  getCapabilities(): MediaTrackCapabilities & { torch?: boolean };
  applyConstraints(constraints: MediaTrackConstraints & { advanced?: Array<{ torch?: boolean }> }): Promise<void>;
}

export function QrScanner({
  active,
  onScan,
  disabled,
}: {
  /** Piloté par le parent : coupe la caméra quand l'écran de scan n'est pas visible. */
  active: boolean;
  onScan: (raw: string, source: 'camera' | 'manual') => void;
  /** Désactive temporairement la détection (ex: pendant l'appel réseau du scan précédent). */
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [flash, setFlash] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState('');

  // La boucle requestAnimationFrame vit indépendamment du cycle de rendu React
  // (elle est lancée une fois par startCamera) : elle doit lire ces valeurs via
  // ref pour ne jamais rester bloquée sur la version capturée au démarrage.
  const onScanRef = useRef(onScan);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    onScanRef.current = onScan;
    disabledRef.current = disabled;
  }, [onScan, disabled]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    // Sous-échantillonnage : jsQR n'a pas besoin de la pleine résolution
    // caméra pour décoder, et une plus petite image traite plus vite (fluide
    // même sur bas de gamme).
    const scale = Math.min(1, 640 / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });

    if (code && code.data && !disabledRef.current) {
      const now = Date.now();
      const last = lastScanRef.current;
      if (!last || last.value !== code.data || now - last.at > RESCAN_COOLDOWN_MS) {
        lastScanRef.current = { value: code.data, at: now };
        setFlash(true);
        setTimeout(() => setFlash(false), 500);
        onScanRef.current(code.data, 'camera');
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startCamera = useCallback(async () => {
    setStatus('requesting');
    try {
      const constraints: MediaStreamConstraints = {
        video:
          devices.length && devices[deviceIndex]
            ? { deviceId: { exact: devices[deviceIndex].deviceId } }
            : { facingMode: { ideal: 'environment' } },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const track = stream.getVideoTracks()[0] as TorchCapableTrack | undefined;
      const caps = track?.getCapabilities?.();
      setTorchSupported(Boolean(caps?.torch));

      if (!devices.length) {
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === 'videoinput'));
      }

      setStatus('active');
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      stopCamera();
      const name = err instanceof DOMException ? err.name : '';
      setStatus(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable' : 'denied');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIndex]);

  useEffect(() => {
    if (active) {
      startCamera();
    } else {
      stopCamera();
      setStatus('idle');
    }
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, deviceIndex]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0] as TorchCapableTrack | undefined;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch {
      // Torche refusée par le pilote/l'OS : on masque simplement le bouton au prochain rendu.
      setTorchSupported(false);
    }
  }

  function switchCamera() {
    setDeviceIndex((i) => (devices.length ? (i + 1) % devices.length : 0));
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const value = manualValue.trim();
    if (!value) return;
    onScan(value, 'manual');
    setManualValue('');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black shadow-lg shadow-black/20 sm:aspect-[4/3]">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          style={{ display: status === 'active' ? 'block' : 'none' }}
        />
        <canvas ref={canvasRef} className="hidden" />

        {status !== 'active' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/80">
            {status === 'requesting' && (
              <>
                <Camera className="h-10 w-10 animate-pulse text-brand" />
                <p className="text-sm font-medium">Activation de la caméra…</p>
              </>
            )}
            {status === 'denied' && (
              <>
                <CameraOff className="h-10 w-10 text-red-400" />
                <p className="text-sm font-medium">Accès caméra refusé.</p>
                <p className="text-xs text-white/60">
                  Autorisez la caméra dans les réglages du navigateur, ou saisissez le code manuellement.
                </p>
                <button type="button" onClick={startCamera} className="btn-primary mt-1">
                  Réessayer
                </button>
              </>
            )}
            {status === 'unavailable' && (
              <>
                <CameraOff className="h-10 w-10 text-white/50" />
                <p className="text-sm font-medium">Aucune caméra détectée.</p>
                <p className="text-xs text-white/60">Utilisez la saisie manuelle ci-dessous.</p>
              </>
            )}
            {status === 'idle' && <Camera className="h-10 w-10 text-white/40" />}
          </div>
        )}

        {status === 'active' && (
          <>
            {/* Cadre de visée + coins accentués thème Mathio */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`relative aspect-square w-[62%] max-w-[280px] transition-all duration-200 ${
                  flash ? 'scale-[1.03]' : ''
                }`}
              >
                <div className="absolute inset-0 rounded-2xl border-2 border-white/30" />
                {(['-top-0.5 -left-0.5 border-r-0 border-b-0', '-top-0.5 -right-0.5 border-l-0 border-b-0', '-bottom-0.5 -left-0.5 border-r-0 border-t-0', '-bottom-0.5 -right-0.5 border-l-0 border-t-0'] as const).map(
                  (pos, i) => (
                    <span
                      key={i}
                      className={`absolute ${pos} h-8 w-8 rounded-lg border-[3px] transition-colors duration-200 ${
                        flash ? 'border-green-400' : 'border-brand'
                      }`}
                    />
                  )
                )}
                {!flash && (
                  <div className="absolute inset-x-2 h-0.5 animate-[scan-line_2.2s_ease-in-out_infinite] rounded-full bg-brand/80 shadow-[0_0_8px_2px_rgba(255,209,0,0.6)]" />
                )}
                {flash && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-green-500/20">
                    <div className="rounded-full bg-green-500 p-2 shadow-lg">
                      <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="absolute inset-x-0 top-3 flex justify-center px-3">
              <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {flash ? 'Colis détecté !' : 'Positionnez le QR code dans le cadre'}
              </span>
            </div>

            <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 px-3">
              {torchSupported && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  className="rounded-full bg-black/50 p-2.5 text-white backdrop-blur-sm transition hover:bg-black/70"
                  aria-label="Torche"
                >
                  {torchOn ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
                </button>
              )}
              {devices.length > 1 && (
                <button
                  type="button"
                  onClick={switchCamera}
                  className="rounded-full bg-black/50 p-2.5 text-white backdrop-blur-sm transition hover:bg-black/70"
                  aria-label="Changer de caméra"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setManualOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-2.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/70"
              >
                <Keyboard className="h-4 w-4" />
                Saisie manuelle
              </button>
            </div>
          </>
        )}
      </div>

      {(manualOpen || status !== 'active') && (
        <form onSubmit={submitManual} className="flex gap-2">
          <input
            className="input-basic flex-1 font-mono"
            placeholder="PD-100000"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
          />
          <button type="submit" className="btn-primary shrink-0" disabled={!manualValue.trim()}>
            Valider
          </button>
        </form>
      )}
    </div>
  );
}
