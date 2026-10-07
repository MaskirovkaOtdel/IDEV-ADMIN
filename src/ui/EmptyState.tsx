/**
 * EmptyState — displayed when no generators are owned and no progress has been made.
 * Used in the game canvas area to show a friendly "start playing" message.
 */

import React from 'react';

interface EmptyStateProps {
  /** Optional message to display instead of the default. */
  message?: string;
  /** Optional button label and onClick. */
  startAction?: { label: string; onClick: () => void };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  startAction,
}) => {
  const displayMessage =
    message || 'Start by buying your first generator!';

  return (
    <div className="empty-state">
      <p>{displayMessage}</p>
      {startAction && (
        <button className="btn btn-start" onClick={startAction.onClick}>
          {startAction.label}
        </button>
      )}
    </div>
  );
};