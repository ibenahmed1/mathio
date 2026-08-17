import Image from 'next/image';

export function Logo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  if (size === 'lg') {
    return (
      <Image
        src="/mathio.jpg"
        alt="Mathio Delivery"
        width={160}
        height={160}
        priority
        className="h-24 w-24 rounded-xl shadow-md sm:h-32 sm:w-32"
      />
    );
  }

  return (
    <span className="flex items-center gap-2">
      <Image src="/mathio.jpg" alt="Mathio Delivery" width={64} height={64} className="h-9 w-9 rounded-md" />
      <span className="hidden leading-none sm:block">
        <span className="block text-base font-black tracking-tight text-black dark:text-white">MATHIO</span>
        <span className="block text-[10px] font-bold tracking-[0.2em] text-brand-ink dark:text-brand">DELIVERY</span>
      </span>
    </span>
  );
}
