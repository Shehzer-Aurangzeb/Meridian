import { IconProps, defaultIconProps } from './icon-props';

export function StrategiesIcon(props: IconProps) {
  return (
    <svg {...defaultIconProps} {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  );
}
