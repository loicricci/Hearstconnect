'use client';

import React from 'react';

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
  disabled?: boolean;
  placeholder?: string;
}

export default function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  disabled = false,
  placeholder,
}: SelectFieldProps) {
  const showPlaceholder = placeholder !== undefined || !options.some(opt => opt.value === value);

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-neutral-400">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full"
      >
        {showPlaceholder && (
          <option value="" disabled>
            {placeholder || '— Select —'}
          </option>
        )}
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint && <p className="text-[10px] text-neutral-600">{hint}</p>}
    </div>
  );
}
