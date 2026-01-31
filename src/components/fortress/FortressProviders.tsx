import React from 'react';

type Props = {
  children: React.ReactNode;
};

/**
 * Wrapper reserved for Fortress-specific providers if needed later.
 * Intentionally a no-op to keep blast radius minimal.
 */
export function FortressProviders({ children }: Props) {
  return <>{children}</>;
}
