'use client';

import { useState } from 'react';

export interface ProfileData {
  firstName: string;
  lastName: string;
  email: string;
  timezone: string;
  initials: string;
}

export const DEFAULT_PROFILE: ProfileData = {
  firstName: 'Elena',
  lastName: 'Marchetti',
  email: 'elena.marchetti@dedicate.com',
  timezone: 'Europe/London · GMT+1',
  initials: 'EM',
};

const TIMEZONES = [
  'Europe/London · GMT+1',
  'America/New_York · GMT−4',
  'America/Los_Angeles · GMT−7',
  'Asia/Singapore · GMT+8',
];

interface FieldProps {
  label: string;
  id: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
}

function Field({ label, id, type = 'text', value, onChange, help }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold tracking-[0.16em] uppercase text-muted-2">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 bg-transparent border border-border/10 dark:border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-hover/18 dark:focus:border-border-hover transition-colors"
      />
      {help && (
        <span className="text-xs text-muted-2">{help}</span>
      )}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

function SelectField({ label, id, value, options, onChange }: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold tracking-[0.16em] uppercase text-muted-2">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 bg-transparent border border-border/10 dark:border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-border-hover/18 dark:focus:border-border-hover transition-colors appearance-none bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27currentColor%27%20stroke-width=%271.6%27><polyline%20points=%276%209%2012%2015%2018%209%27/></svg>')] bg-no-repeat bg-[right_14px_center] bg-[length:14px] pr-10"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

interface ProfileCardProps {
  profile?: ProfileData;
  onSave?: (profile: ProfileData) => void;
}

export function ProfileCard({ profile = DEFAULT_PROFILE, onSave }: ProfileCardProps) {
  const [formData, setFormData] = useState<ProfileData>(profile);

  const updateField = <K extends keyof ProfileData>(key: K, value: ProfileData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleDiscard = () => {
    setFormData(profile);
  };

  const handleSave = () => {
    onSave?.(formData);
  };

  return (
    <div id="profile" className="bg-surface border border-border/10 dark:border-border rounded-lg p-6 md:p-9 mb-6">
      <h2 className="font-display text-[26px] font-semibold tracking-[0.04em] uppercase text-text-primary mb-1.5">
        Profile
      </h2>
      <p className="text-sm text-text-secondary mb-7 max-w-md">
        How Meridian addresses you, and where notifications land.
      </p>

      {/* Avatar row */}
      <div className="flex items-center gap-5 pb-5 border-b border-border/10 dark:border-border mb-6">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gold-ink to-gold-dark flex items-center justify-center text-primary font-semibold text-xl flex-shrink-0">
          {formData.initials}
        </div>
        <div>
          <div className="text-sm font-medium text-text-primary">Profile photo</div>
          <div className="text-[13px] text-text-secondary">PNG or JPG, square, up to 2 MB</div>
        </div>
        <div className="ml-auto flex gap-2">
          <button className="px-4 py-2 border border-border/10 dark:border-border rounded-full text-[13px] font-medium text-text-primary hover:border-border-hover/18 dark:hover:border-border-hover transition-colors">
            Upload
          </button>
          <button className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors">
            Remove
          </button>
        </div>
      </div>

      {/* Form fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <Field
          label="First name"
          id="first"
          value={formData.firstName}
          onChange={(v) => updateField('firstName', v)}
        />
        <Field
          label="Last name"
          id="last"
          value={formData.lastName}
          onChange={(v) => updateField('lastName', v)}
        />
      </div>

      <div className="mb-5">
        <Field
          label="Email"
          id="email"
          type="email"
          value={formData.email}
          onChange={(v) => updateField('email', v)}
          help="Where alerts and weekly summaries are sent."
        />
      </div>

      <div className="mb-6">
        <SelectField
          label="Time zone"
          id="timezone"
          value={formData.timezone}
          options={TIMEZONES}
          onChange={(v) => updateField('timezone', v)}
        />
      </div>

      {/* Form footer */}
      <div className="flex justify-end gap-2.5 pt-6 border-t border-border/10 dark:border-border">
        <button
          onClick={handleDiscard}
          className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          Discard
        </button>
        <button
          onClick={handleSave}
          className="px-5 py-2.5 bg-primary text-background rounded-full text-[13px] font-semibold tracking-[0.08em] uppercase hover:bg-primary/90 transition-colors"
        >
          Save profile
        </button>
      </div>
    </div>
  );
}
