# Meridian Frontend - Code Standards

> Production-grade coding standards for the Meridian crypto analysis platform.
> Reference this document for all frontend development.

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS with CSS variable theme system
- **State**: React hooks + context
- **API**: REST calls to NestJS backend at `localhost:3001` (dev) or production URL

---

## Folder Structure

```
apps/web/
├── app/
│   ├── (auth)/                 # Auth route group
│   │   └── sign-in/
│   ├── (dashboard)/            # Main app route group
│   │   ├── layout.tsx          # Dashboard layout with sidebar
│   │   ├── page.tsx            # Dashboard home
│   │   ├── analysis/
│   │   ├── history/
│   │   ├── strategies/
│   │   ├── alerts/
│   │   └── settings/
│   ├── layout.tsx              # Root layout
│   ├── globals.css             # Theme CSS variables
│   └── page.tsx                # Landing redirect
│
├── components/
│   ├── ui/                     # Reusable UI primitives
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── toast.tsx
│   │   └── skeleton.tsx
│   ├── layout/                 # Layout components
│   │   ├── sidebar.tsx
│   │   ├── topbar.tsx
│   │   └── app-shell.tsx
│   └── features/               # Feature-specific components
│       ├── analysis/
│       ├── dashboard/
│       ├── history/
│       ├── alerts/
│       ├── strategies/
│       └── settings/
│
├── lib/
│   ├── api/                    # API client functions
│   │   ├── client.ts           # Base fetch config
│   │   └── analysis.ts
│   ├── hooks/                  # Custom React hooks
│   │   ├── use-theme.ts
│   │   └── use-debounce.ts
│   ├── utils/                  # Utility functions
│   │   ├── cn.ts               # classnames utility
│   │   └── format.ts           # formatPrice, formatDate
│   ├── types/                  # TypeScript types
│   │   ├── analysis.ts
│   │   └── index.ts
│   └── constants/              # App constants
│       ├── coins.ts
│       └── navigation.ts
│
└── public/                     # Static assets
```

### Rules

- ✅ Group feature components in `components/features/`
- ✅ Keep UI primitives in `components/ui/`
- ✅ All business logic in `lib/`
- ✅ Use route groups `(name)` for layout variants
- ❌ NO logic in page.tsx - only composition
- ❌ NO "utils/helpers" dumping ground - be specific

---

## Naming Conventions

### Files

```
✅ CORRECT (kebab-case):
analysis-form.tsx
use-analysis.ts
page.tsx, layout.tsx, loading.tsx

❌ WRONG:
AnalysisForm.tsx (PascalCase)
analysisForm.tsx (camelCase)
```

### Components

```tsx
// ✅ PascalCase, descriptive
export function AnalysisForm() {}
export function SignalCard() {}

// ❌ WRONG
export function analysisform() {}
export function Form() {} // Too generic
```

### Functions & Variables

```tsx
// ✅ camelCase, verb prefix for functions
const analysisData = await fetchAnalysis();
function handleSubmit() {}
const isLoading = true;
const hasError = false;

// ❌ WRONG
const AnalysisData = {}; // PascalCase
function get_analysis() {} // snake_case
```

### Custom Hooks

```tsx
// ✅ Prefix with "use", camelCase
export function useAnalysis() {}
export function useDebounce() {}

// ❌ WRONG
export function UseAnalysis() {} // PascalCase
export function analysis() {} // Missing prefix
```

### Constants

```tsx
// ✅ SCREAMING_SNAKE_CASE for true constants
export const API_BASE_URL = 'http://localhost:3001';
export const MAX_LEVERAGE = 20;

// Arrays/objects that don't change
export const SUPPORTED_COINS = ['BTC', 'ETH', 'SOL'] as const;
```

### Types/Interfaces

```tsx
// ✅ PascalCase, descriptive
export interface AnalysisResult {}
export type CoinSymbol = 'BTC' | 'ETH' | 'SOL';
export type ApiResponse<T> = { data: T; error?: string };

// ❌ WRONG
export interface analysisResult {} // camelCase
```

---

## Component Patterns

### Structure Order

```tsx
'use client'; // Only if needed

// 1. React/Next imports
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// 2. External libraries
import { format } from 'date-fns';

// 3. Internal components
import { Button } from '@/components/ui/button';

// 4. Internal hooks/utils
import { useAnalysis } from '@/lib/hooks/use-analysis';
import { formatPrice } from '@/lib/utils/format';

// 5. Types (use type imports)
import type { AnalysisResult } from '@/lib/types/analysis';

// Props interface
interface AnalysisFormProps {
  onSubmit: (coin: string) => void;
  defaultValue?: string;
}

export function AnalysisForm({ onSubmit, defaultValue = '' }: AnalysisFormProps) {
  // 1. Hooks (context, state, refs, custom hooks)
  const [coin, setCoin] = useState(defaultValue);
  const { data, isLoading } = useAnalysis(coin);

  // 2. Derived state
  const isValid = coin.length > 0;

  // 3. Event handlers
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(coin);
  };

  // 4. Effects (if needed)
  // useEffect(() => {}, []);

  // 5. Early returns for loading/error
  if (isLoading) return <LoadingSpinner />;

  // 6. Main render
  return (
    <form onSubmit={handleSubmit}>
      {/* JSX */}
    </form>
  );
}
```

### Props Patterns

```tsx
// ✅ Explicit interface, defaults for optional props
interface CardProps {
  title: string;
  children: React.ReactNode;
  variant?: 'default' | 'outlined';
  onClose?: () => void;
}

export function Card({
  title,
  children,
  variant = 'default',
  onClose,
}: CardProps) {}
```

### Conditional Rendering

```tsx
// ✅ Clear and readable
{isLoading && <LoadingSpinner />}
{error && <ErrorMessage error={error} />}
{data && <AnalysisResult data={data} />}

// ❌ WRONG - nested ternaries
{isLoading ? <Spinner /> : error ? <Error /> : data ? <Result /> : null}
```

### Event Handlers

```tsx
// ✅ "handle" prefix for internal handlers
const handleSubmit = () => {};
const handleInputChange = (value: string) => {};

// ❌ WRONG
const onSubmit = () => {}; // Use for props only
const submit = () => {}; // Ambiguous
```

---

## API Client Pattern

```tsx
// lib/api/client.ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function apiClient<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response.json();
}

// lib/api/analysis.ts
export async function fetchAnalysis(coin: string): Promise<AnalysisResult> {
  return apiClient<AnalysisResult>('/analysis/analyze', {
    method: 'POST',
    body: JSON.stringify({ coin }),
  });
}
```

---

## Custom Hook Pattern

```tsx
// ✅ Single responsibility, clear return type
export function useAnalysis(coin: string) {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coin) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchAnalysis(coin);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [coin]);

  return { data, isLoading, error };
}
```

---

## Styling with Tailwind

### Theme Variables

All colors use CSS variables defined in `globals.css`:

```tsx
// ✅ CORRECT - Use theme classes
<div className="bg-surface border border-border text-text-primary">
<button className="bg-primary text-primary-foreground">

// ❌ WRONG - Hardcoded colors
<div className="bg-[#1a1d23]">
<div style={{ color: '#113329' }}>
```

### Available Theme Colors

| Class | Usage |
|-------|-------|
| `bg-background` | Page backgrounds |
| `bg-surface` | Cards, panels |
| `bg-surface-hover` | Hover states |
| `bg-primary` | Primary buttons |
| `text-text-primary` | Main text |
| `text-text-secondary` | Muted text |
| `text-text-tertiary` | Subtle text |
| `border-border` | Default borders |
| `border-border-hover` | Hover borders |
| `text-gold`, `bg-gold` | Accents, highlights |
| `text-sage`, `bg-sage` | Bullish/success (light mode) |
| `text-green`, `bg-green` | Bullish/success (dark mode) |
| `text-rust`, `bg-rust` | Bearish/error |

### Dark Mode

Use `dark:` prefix for dark mode variants:

```tsx
<div className="bg-sage/20 text-deep-green dark:bg-green/20 dark:text-green">
```

### cn() Utility

Use for conditional classes:

```tsx
import { cn } from '@/lib/utils';

<button className={cn(
  "px-4 py-2 rounded-lg font-medium",
  variant === 'primary' && "bg-primary text-primary-foreground",
  variant === 'secondary' && "bg-surface border border-border",
  isDisabled && "opacity-50 cursor-not-allowed"
)} />
```

---

## Comments - When to Use

### ✅ KEEP

```tsx
// Complex business logic
// Calculate position size using 1-2% risk formula
const positionSize = (accountBalance * riskPercentage) / stopLossDistance;

// Non-obvious workarounds
// HACK: Chrome doesn't support blur on iOS

// TODO with context
// TODO: Add caching once Redis is configured

// JSDoc for public APIs
/**
 * Fetches analysis for a given coin
 * @param coin - Coin symbol (e.g., 'BTC')
 */
```

### ❌ REMOVE

```tsx
// State the obvious
// Set loading to true
setLoading(true);

// Redundant with code
// Function to handle submit
function handleSubmit() {}

// Commented out code
// const oldFunction = () => {};

// Divider comments
// ========================================
```

---

## Error Handling

```tsx
// ✅ Proper error handling with user feedback
try {
  const data = await fetchAnalysis(coin);
  setData(data);
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : 'Failed to fetch analysis';
  setError(message);
  console.error('Analysis fetch failed:', error);
}

// ❌ WRONG - Silent failure
try {
  await fetchAnalysis(coin);
} catch (e) {
  console.log(e);
}
```

---

## TypeScript

### Strict Types

```tsx
// ✅ Specific types, no any
interface AnalysisResult {
  coin: string;
  action: 'LONG' | 'SHORT' | 'WAIT';
  entryPrice: number;
  reasoning: string;
}

// ❌ WRONG
interface AnalysisResult {
  coin: any; // No any!
  action: string; // Too broad
}
```

### Type Imports

```tsx
// ✅ Explicit type imports
import type { AnalysisResult } from '@/lib/types/analysis';

// ❌ Mixed imports
import { AnalysisResult, fetchAnalysis } from '@/lib/api';
```

---

## Performance

```tsx
// ✅ Memoize expensive calculations
const memoizedValue = useMemo(() => {
  return expensiveCalculation(data);
}, [data]);

// ✅ Memoize callbacks passed to children
const handleClick = useCallback(() => {
  doSomething(id);
}, [id]);

// ❌ Over-memoizing simple operations
const simpleValue = useMemo(() => count + 1, [count]);
```

---

## Common Patterns in Meridian

### Badge Component

```tsx
function SignalBadge({ signal }: { signal: 'long' | 'short' | 'skip' }) {
  return (
    <span className={cn(
      'text-[10px] font-bold tracking-[0.16em] uppercase px-2.5 py-1 rounded',
      signal === 'long' && 'bg-sage/20 text-deep-green dark:bg-green/20 dark:text-green',
      signal === 'short' && 'bg-rust/15 text-rust',
      signal === 'skip' && 'bg-primary/[0.08] text-text-secondary'
    )}>
      {signal}
    </span>
  );
}
```

### Page Header Pattern

```tsx
function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-8">
      <h1 className="font-display text-4xl font-bold uppercase tracking-headline text-text-primary">
        {title}
      </h1>
      {subtitle && (
        <p className="text-text-secondary mt-2">{subtitle}</p>
      )}
    </header>
  );
}
```

### Card Pattern

```tsx
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'bg-surface border border-border/10 dark:border-border rounded-xl p-6',
      className
    )}>
      {children}
    </div>
  );
}
```

---

## Commands

```bash
# Development
pnpm dev

# Type check
pnpm typecheck
# or
npx tsc --noEmit

# Build
pnpm build

# Lint
pnpm lint
```

---

## Checklist for New Components

- [ ] File named in kebab-case
- [ ] Component named in PascalCase
- [ ] Props interface defined
- [ ] TypeScript types (no `any`)
- [ ] Uses theme colors (no hardcoded hex)
- [ ] Has dark mode variants where needed
- [ ] Loading/error states handled
- [ ] No unnecessary comments
- [ ] Imports ordered correctly
- [ ] No console.logs (except errors)
