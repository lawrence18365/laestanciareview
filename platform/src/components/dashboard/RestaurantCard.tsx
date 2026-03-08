'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { t } from '@/lib/i18n';

interface RestaurantCardProps {
  name: string;
  slug: string;
  reviewCount: number;
  index: number;
}

export default function RestaurantCard({
  name,
  slug,
  reviewCount,
  index,
}: RestaurantCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="group relative"
      style={{
        background: 'var(--warm-white)',
        borderRadius: 16,
        border: '1px solid var(--stone-200)',
        padding: '28px 24px',
        transition: 'transform 0.2s ease, box-shadow 0.25s ease',
        animation: `cardLift 0.4s ease-out ${index * 80}ms both`,
      }}
      onMouseEnter={() => {
        if (ref.current) {
          ref.current.style.transform = 'translateY(-2px)';
          ref.current.style.boxShadow = 'var(--shadow-md)';
        }
      }}
      onMouseLeave={() => {
        if (ref.current) {
          ref.current.style.transform = 'translateY(0)';
          ref.current.style.boxShadow = 'none';
        }
      }}
    >
      <h3
        className="text-xl font-semibold mb-1"
        style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
      >
        {name}
      </h3>
      <p
        className="text-[13px] mb-1"
        style={{ color: 'var(--stone-400)', fontFamily: 'monospace' }}
      >
        /{slug}
      </p>
      <p className="text-[13px] mb-5" style={{ color: 'var(--stone-500)' }}>
        {t.restaurantCard.reviews(reviewCount)}
      </p>

      <div className="flex gap-2">
        <Link
          href={`/r/${slug}`}
          className="text-[13px] font-medium px-4 py-2 rounded-lg transition-colors duration-150 hover:opacity-90"
          style={{
            background: 'var(--espresso)',
            color: 'var(--warm-white)',
          }}
        >
          {t.restaurantCard.reviewPage}
        </Link>
        <a
          href={`/api/reviews/dashboard?restaurant=${slug}`}
          className="text-[13px] font-medium px-4 py-2 rounded-lg transition-colors duration-150 hover:bg-[var(--stone-100)]"
          style={{
            border: '1px solid var(--stone-200)',
            color: 'var(--stone-700)',
          }}
        >
          {t.restaurantCard.dashboard}
        </a>
      </div>
    </div>
  );
}
