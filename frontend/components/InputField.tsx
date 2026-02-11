'use client';

import React from 'react';

interface InputFieldProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  disabled?: boolean;
}

export default function InputField({
  label,
  value,
  onChange,
  type = 'text',
  min,
  max,
  step,
  hint,
  disabled = false,
}: InputFieldProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center min-h-[20px]">
        <label className="text-xs font-medium text-neutral-400">{label}</label>
      </div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="w-full"
      />
      {hint && <p className="text-[10px] text-neutral-600">{hint}</p>}
    </div>
  );
}
