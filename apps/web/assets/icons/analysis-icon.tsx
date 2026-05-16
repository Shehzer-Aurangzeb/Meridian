import { IconProps, defaultIconProps } from './icon-props';

export function AnalysisIcon(props: IconProps) {
  return (
    <svg {...defaultIconProps} {...props}>
      <path d="M3 12l6-6 4 4 8-8" />
      <path d="M21 4v6h-6" />
    </svg>
  );
}
