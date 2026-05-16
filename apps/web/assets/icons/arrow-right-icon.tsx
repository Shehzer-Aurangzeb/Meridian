import { IconProps, defaultIconProps } from './icon-props';

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...defaultIconProps} strokeWidth={2} {...props}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
