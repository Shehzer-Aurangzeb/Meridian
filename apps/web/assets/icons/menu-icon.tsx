import { IconProps, defaultIconProps } from './icon-props';

export function MenuIcon(props: IconProps) {
  return (
    <svg {...defaultIconProps} strokeWidth={1.8} {...props}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
