"use client";

import { useState, type InputHTMLAttributes } from "react";
import { formatPhoneInput, formatPhoneNumber } from "./phone";

type BaseProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange"
>;

export interface PhoneInputProps extends BaseProps {
  /** Controlled value. Omit to let the input manage its own state. */
  value?: string | null;
  defaultValue?: string | number | null;
  /** Receives the already-formatted value. */
  onValueChange?: (value: string) => void;
}

/**
 * Phone entry that auto-formats to the app-wide house format: NANP numbers
 * become `(###) ###-####` while typing, and anything else is normalized on
 * blur (see `formatPhoneNumber`).
 */
export function PhoneInput({
  value,
  defaultValue,
  onValueChange,
  onBlur,
  ...rest
}: PhoneInputProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(() => {
    if (defaultValue == null || defaultValue === "") return "";
    return formatPhoneNumber(String(defaultValue)) ?? "";
  });

  function commit(next: string) {
    if (!isControlled) setInternal(next);
    onValueChange?.(next);
  }

  return (
    <input
      {...rest}
      type="tel"
      inputMode="tel"
      autoComplete={rest.autoComplete ?? "tel"}
      value={isControlled ? (value ?? "") : internal}
      onChange={(e) => commit(formatPhoneInput(e.target.value))}
      onBlur={(e) => {
        commit(formatPhoneNumber(e.target.value) ?? "");
        onBlur?.(e);
      }}
    />
  );
}
