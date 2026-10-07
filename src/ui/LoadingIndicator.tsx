/**
 * LoadingIndicator — displayed while the game state is loading from localStorage
 * or during initial hydration.
 */

import React from 'react';

interface LoadingIndicatorProps {
  /** Optional message to display. */
  message?: string;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = 'Loading game...',
}) => {
  return (
    <div className="loading-indicator">
      <p>{message}</p>
    </div>
  );
};