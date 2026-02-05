// DiviBalance - Display user's DIVI currency balance

import React from 'react';
import { formatDivi } from '../types';

interface DiviBalanceProps {
  balance: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function DiviBalance({ balance, size = 'md', showLabel = true }: DiviBalanceProps) {
  const sizeClasses = {
    sm: 'text-sm gap-1',
    md: 'text-base gap-2',
    lg: 'text-lg gap-2',
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  return (
    <div className={`flex items-center ${sizeClasses[size]}`}>
      {showLabel && (
        <span className="text-muted-foreground font-medium">DIVI:</span>
      )}
      <div className="flex items-center gap-1">
        <div
          className={`${iconSizes[size]} rounded-full flex items-center justify-center font-bold`}
          style={{
            background: 'linear-gradient(135deg, #ffd700 0%, #ffb800 50%, #cc8800 100%)',
            color: '#1a1a1a',
            fontSize: size === 'sm' ? '10px' : size === 'md' ? '12px' : '14px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        >
          D
        </div>
        <span className="font-bold" style={{ color: '#ffd700' }}>
          {formatDivi(balance)}
        </span>
      </div>
    </div>
  );
}
