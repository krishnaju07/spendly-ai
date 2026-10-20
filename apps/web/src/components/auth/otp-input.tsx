import { useState, type Ref } from 'react';
import { OTP_LENGTH } from '@spendly/shared';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Called once when the last digit is typed or a full code is pasted / autofilled. */
  onComplete?: (value: string) => void;
  state?: 'idle' | 'invalid' | 'ok';
  disabled?: boolean;
  ref?: Ref<HTMLInputElement>;
  describedBy?: string;
}

/**
 * Six boxes that are really one text field. The real input is invisible and covers the boxes, so
 * paste, the keyboard's "code from Messages" suggestion, backspace and screen readers all behave
 * like a normal field; the boxes only show what has been typed.
 */
export function OtpInput({ value, onChange, onComplete, state = 'idle', disabled, ref, describedBy }: Props) {
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, OTP_LENGTH - 1);

  return (
    <div className="otp" data-state={state} data-focused={focused}>
      <input
        ref={ref}
        className="otp-native"
        name="otp"
        value={value}
        disabled={disabled}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        enterKeyHint="go"
        aria-label={`${OTP_LENGTH}-digit sign-in code`}
        aria-invalid={state === 'invalid'}
        aria-describedby={describedBy}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH);
          onChange(digits);
          if (digits.length === OTP_LENGTH && digits !== value) onComplete?.(digits);
        }}
        // a tap or arrow key must not move the caret away from the end: the boxes fill strictly left to right
        onSelect={(e) => {
          const el = e.currentTarget;
          const end = el.value.length;
          if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
        }}
      />
      {Array.from({ length: OTP_LENGTH }, (_, i) => {
        const digit = value[i];
        return (
          <span key={i} className="otp-cell" aria-hidden data-filled={digit !== undefined} data-active={focused && i === active} style={{ '--i': i } as React.CSSProperties}>
            {digit !== undefined ? <span key={digit} className="otp-digit">{digit}</span> : focused && i === active ? <span className="otp-caret" /> : null}
          </span>
        );
      })}
    </div>
  );
}
