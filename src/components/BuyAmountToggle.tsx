/**
 * BuyAmountToggle — ×1 / ×10 / ×100 / MAX bulk purchase selector.
 *
 * Controlled: the owning GeneratorCard holds the state so the toggle and the
 * buy button can never disagree about the quantity.
 */
import type { BuyAmount } from '../game/gameStore';

const OPTIONS: { value: BuyAmount; label: string }[] = [
  { value: 1, label: '×1' },
  { value: 10, label: '×10' },
  { value: 100, label: '×100' },
  { value: 'max', label: 'MAX' },
];

export interface BuyAmountToggleProps {
  value: BuyAmount;
  onChange: (value: BuyAmount) => void;
  disabled?: boolean;
}

export function BuyAmountToggle({ value, onChange, disabled }: BuyAmountToggleProps) {
  return (
    <div className="buy-amount-toggle" role="group" aria-label="Purchase quantity">
      {OPTIONS.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={`chip-button ${value === option.value ? 'active' : ''}`}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
