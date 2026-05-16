import { IconProps, defaultIconProps } from './icon-props';

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...defaultIconProps} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
