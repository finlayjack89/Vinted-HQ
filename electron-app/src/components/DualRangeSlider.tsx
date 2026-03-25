import React from 'react';
import { colors } from '../theme';

const THUMB_SIZE = 20;
const TRACK_HEIGHT = 6;
const HALF_THUMB = THUMB_SIZE / 2;

export function DualRangeSlider({
  min,
  max,
  valueMin,
  valueMax,
  onChange,
}: {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onChange: (low: number, high: number) => void;
}) {
  const range = max - min || 1;
  const pctMin = ((valueMin - min) / range) * 100;
  const pctMax = ((valueMax - min) / range) * 100;

  return (
    <div style={{ position: 'relative', height: 36 }}>
      {/*
        The native range thumb can't travel past the edges of the input —
        it stops HALF_THUMB pixels inward on each side.
        We inset the visual track by that same amount so the colored bar
        lines up exactly with the thumb centers at min and max.
      */}
      <div style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        left: HALF_THUMB, right: HALF_THUMB, height: TRACK_HEIGHT,
        background: 'rgba(0,0,0,0.06)', borderRadius: TRACK_HEIGHT / 2,
      }}>
        {/* Active Highlight — positioned within the inset track */}
        <div style={{
          position: 'absolute', top: 0, height: '100%',
          left: `${pctMin}%`, width: `${Math.max(pctMax - pctMin, 0)}%`,
          background: `linear-gradient(90deg, ${colors.primary}, ${colors.primaryHover})`,
          borderRadius: TRACK_HEIGHT / 2,
          boxShadow: `0 0 8px ${colors.primaryGlow}`,
        }} />
      </div>

      {/* Min handle */}
      <input
        type="range" min={min} max={max} value={valueMin}
        onChange={(e) => onChange(Math.min(Number(e.target.value), valueMax - 1), valueMax)}
        style={{ ...sliderInputStyle, zIndex: valueMin > max - 2 ? 5 : 3 }}
      />
      {/* Max handle */}
      <input
        type="range" min={min} max={max} value={valueMax}
        onChange={(e) => onChange(valueMin, Math.max(Number(e.target.value), valueMin + 1))}
        style={{ ...sliderInputStyle, zIndex: 4 }}
      />

      <style>{`
        input[type="range"]::-webkit-slider-runnable-track {
          height: ${TRACK_HEIGHT}px;
          background: transparent;
          border-radius: ${TRACK_HEIGHT / 2}px;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: ${THUMB_SIZE}px; height: ${THUMB_SIZE}px; border-radius: 50%;
          background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
          box-shadow: 0 2px 8px ${colors.primaryGlow};
          cursor: pointer; pointer-events: all;
          border: 2.5px solid ${colors.bgElevated};
          margin-top: -${(THUMB_SIZE - TRACK_HEIGHT) / 2}px;
        }
        input[type="range"]::-moz-range-track {
          height: ${TRACK_HEIGHT}px;
          background: transparent;
          border-radius: ${TRACK_HEIGHT / 2}px;
          border: none;
        }
        input[type="range"]::-moz-range-thumb {
          width: ${THUMB_SIZE}px; height: ${THUMB_SIZE}px; border-radius: 50%;
          background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
          box-shadow: 0 2px 8px ${colors.primaryGlow};
          cursor: pointer; pointer-events: all;
          border: 2.5px solid ${colors.bgElevated};
        }
      `}</style>
    </div>
  );
}

const sliderInputStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: 0,
  width: '100%',
  height: THUMB_SIZE,
  transform: 'translateY(-50%)',
  appearance: 'none',
  WebkitAppearance: 'none',
  background: 'transparent',
  pointerEvents: 'none',
  cursor: 'pointer',
  margin: 0,
  padding: 0,
};
