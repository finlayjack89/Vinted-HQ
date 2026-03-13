/**
 * GlassSkeleton — A frosted glass skeleton loader.
 * Uses the .liquid-glass-skeleton CSS class which animates a specular
 * highlight across the X-axis (background-position: -200% → 200%)
 * instead of a standard opacity pulse.
 */

import React from 'react';
import { radius, spacing } from '../theme';

interface GlassSkeletonProps {
  /** Width of the skeleton element */
  width?: number | string;
  /** Height of the skeleton element */
  height?: number | string;
  /** Border radius override */
  borderRadius?: number;
  /** Number of skeleton items to render */
  count?: number;
}

export default function GlassSkeleton({
  width = '100%',
  height = 200,
  borderRadius = radius.xl,
  count = 1,
}: GlassSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="liquid-glass-skeleton"
          style={{
            width,
            height,
            borderRadius,
            marginBottom: i < count - 1 ? spacing.lg : 0,
          }}
        />
      ))}
    </>
  );
}
