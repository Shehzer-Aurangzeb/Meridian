import { IconProps, defaultIconProps } from './icon-props';

export function AlertIcon(props: IconProps) {
  return (
    <svg {...defaultIconProps} {...props}>
      <path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
